const vscode = require('vscode');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const tls = require('tls');
const core = require('./lib/core');

let panel = null;

/** Traduction (vscode.l10n) : la chaîne source est en anglais, les traductions sont dans l10n/. */
const tr = (msg, ...args) => vscode.l10n.t(msg, ...args);

// Textes utilisés par media/preview.js et media/devices.js
const WEBVIEW_STRINGS = [
  'Custom size…', 'Custom', 'My devices', 'Other', '{0} devices', 'Favorites', 'Recent',
  'Add to favorites (★)', 'Remove from favorites (★)',
  'Color scheme: page default (D)', 'Color scheme: light (D)', 'Color scheme: dark (D)',
  'iPhone', 'Android', 'Foldables', 'iPad', 'Android tablets & more', 'Laptops', 'Desktop monitors',
  'iPhone 5 / SE (1st gen)', 'Android compact (360×800)', 'Android legacy (360×640)',
  'Galaxy Z Fold (folded)', 'Galaxy Z Fold (unfolded)', 'Pixel 9 Pro Fold (unfolded)',
  'iPad mini (6th gen+)', 'iPad classic / mini 5',
  'Laptop HD (1366×768)', 'Laptop 13" (1280×800)', 'Laptop 1440×900', 'Laptop 15" (1536×864)',
  'Laptop Full HD (1920×1080)', 'HD+ monitor (1600×900)', 'Full HD monitor (1920×1080)',
  'QHD monitor (2560×1440)', 'Ultrawide monitor (3440×1440)'
];
const webviewStrings = () => Object.fromEntries(WEBVIEW_STRINGS.map((k) => [k, tr(k, '{0}')]));

/* =====================================================================
 * Accès depuis l'interface (local, Remote SSH/WSL/conteneur, Codespaces)
 * ===================================================================== */

const isRemote = () => !!vscode.env.remoteName || vscode.env.uiKind === vscode.UIKind.Web;
const isLoopback = (host) => /^(localhost|127(?:\.\d+){3}|\[::1\]|0\.0\.0\.0)$/i.test(host);

/** Origine sous laquelle l'aperçu atteint un port local de l'hôte de l'extension. */
async function publicOrigin(port) {
  const local = `http://127.0.0.1:${port}`;
  if (!isRemote()) return local;
  try {
    // En distant, VS Code ouvre un tunnel et renvoie l'adresse joignable par l'interface
    const ext = await vscode.env.asExternalUri(vscode.Uri.parse(`http://localhost:${port}/`));
    return new URL(ext.toString(true)).origin;
  } catch {
    return local;
  }
}

/* =====================================================================
 * Simulation de réseau lent (appliquée au serveur de fichiers et au proxy)
 * ===================================================================== */

let limiter = null;
function setNetwork(key) { limiter = core.createLimiter(core.NETWORK_PRESETS[key]); }

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Envoie un corps de réponse (Buffer, texte ou flux) au débit simulé. */
function sendBody(res, body) {
  const isData = Buffer.isBuffer(body) || typeof body === 'string';
  if (!limiter) return isData ? res.end(body) : body.pipe(res);
  const out = core.throttleStream(limiter);
  res.on('close', () => out.destroy());
  out.pipe(res);
  if (isData) out.end(Buffer.from(body)); else body.pipe(out);
}

/* =====================================================================
 * Serveur statique local (mode « fichier HTML ») + rechargement à chaud
 * ===================================================================== */

let server = null;
let serverRoot = null;
let serverPort = null;
let serverOrigin = null; // origine vue par l'aperçu (différente en distant)
let watcher = null;
let pingTimer = null;
const sseClients = new Set();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.avif': 'image/avif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.wasm': 'application/wasm',
  '.pdf': 'application/pdf'
};

// Script et styles injectés dans les pages (voir media/client.js)
let clientAssets = null;
function client() {
  if (!clientAssets) {
    const read = (f) => fs.readFileSync(path.join(__dirname, 'media', f), 'utf8');
    clientAssets = {
      js: `(function () {\nvar rewriteMedia = ${core.rewriteMedia};\nvar rewriteSafeArea = ${core.rewriteSafeArea};\n${read('client.js')}\n})();`,
      css: read('client.css')
    };
  }
  return clientAssets;
}

/** Ressources internes /__dp/… (script client, styles, événements de rechargement). */
function handleInternal(req, res, pathname) {
  if (pathname === '/__dp/client.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
    res.end(client().js);
  } else if (pathname === '/__dp/client.css') {
    res.writeHead(200, { 'Content-Type': MIME['.css'], 'Cache-Control': 'no-store' });
    res.end(client().css);
  } else if (pathname === '/__dp/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive'
    });
    res.write(': ok\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  } else {
    res.writeHead(404); res.end();
  }
}

async function handleRequest(root, req, res) {
  let urlObj;
  try { urlObj = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); }
  if (urlObj.pathname.startsWith('/__dp/')) return handleInternal(req, res, urlObj.pathname);

  let urlPath;
  try { urlPath = decodeURIComponent(urlObj.pathname); } catch { res.writeHead(400); return res.end(); }
  let filePath = path.resolve(root, '.' + urlPath);
  if (!core.isInside(root, filePath)) { res.writeHead(403); return res.end('403 – forbidden'); }
  if (limiter) await delay(limiter.latency);

  try {
    let st = await fs.promises.stat(filePath);
    if (st.isDirectory()) {
      if (!urlObj.pathname.endsWith('/')) {
        res.writeHead(301, { Location: urlObj.pathname + '/' + urlObj.search });
        return res.end();
      }
      filePath = path.join(filePath, 'index.html');
      st = await fs.promises.stat(filePath);
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    };
    if (ext === '.html' || ext === '.htm') {
      const html = core.injectClient(await fs.promises.readFile(filePath, 'utf8'));
      res.writeHead(200, { ...headers, 'Content-Length': Buffer.byteLength(html) });
      return sendBody(res, html);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    sendBody(res, fs.createReadStream(filePath).on('error', () => res.destroy()));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 – not found: ' + urlPath);
  }
}

function stopServer() {
  for (const c of sseClients) c.end();
  sseClients.clear();
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  if (watcher) { watcher.dispose(); watcher = null; }
  if (server) {
    server.close();
    if (server.closeAllConnections) server.closeAllConnections();
    server = null;
  }
  serverRoot = serverPort = serverOrigin = null;
}

/** Démarre (ou réutilise) le serveur qui sert le dossier `root`. */
function ensureServer(root) {
  if (server && serverRoot === root) return Promise.resolve(serverPort);
  stopServer();

  return new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => {
      handleRequest(root, req, res).catch((e) => {
        if (!res.headersSent) res.writeHead(500);
        res.end(String(e));
      });
    });
    s.on('error', reject);
    s.listen(0, '127.0.0.1', async () => {
      const port = s.address().port;
      const origin = await publicOrigin(port);
      server = s; serverRoot = root; serverPort = port; serverOrigin = origin;

      // Surveille aussi les modifications faites hors de VS Code (build, git…)
      watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(root), '**/*'));
      const onFs = (uri) => queueChange(uri.fsPath);
      watcher.onDidChange(onFs); watcher.onDidCreate(onFs); watcher.onDidDelete(onFs);

      pingTimer = setInterval(() => { for (const c of sseClients) c.write(': ping\n\n'); }, 25000);
      resolve(serverPort);
    });
  });
}

let pendingChanges = new Set();
let changeTimer = null;

function queueChange(fsPath) {
  if (!serverRoot || !core.isInside(serverRoot, fsPath)) return;
  if (/[\\/](node_modules|\.git)([\\/]|$)/.test(fsPath)) return;
  pendingChanges.add(fsPath);
  clearTimeout(changeTimer);
  changeTimer = setTimeout(flushChanges, 120);
}

function flushChanges() {
  const files = [...pendingChanges];
  pendingChanges.clear();
  if (!files.length || !getConfig().autoReload) return;
  const cssOnly = files.every((f) => /\.css$/i.test(f));
  const msg = `data: ${JSON.stringify({ type: cssOnly ? 'css' : 'reload' })}\n\n`;
  for (const c of sseClients) c.write(msg);
}

async function serverUrlFor(fsPath) {
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(fsPath));
  const root = folder ? folder.uri.fsPath : path.dirname(fsPath);
  await ensureServer(root);
  const rel = path.relative(root, fsPath).split(path.sep).map(encodeURIComponent).join('/');
  return { url: `${serverOrigin}/${rel}`, server: { root, origin: serverOrigin } };
}

/* =====================================================================
 * Vérification qu'une URL répond (serveur de dev lancé ?)
 * ===================================================================== */

function checkUrl(url) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { return resolve({ ok: false, error: 'URL invalide' }); }
    if (!/^https?:$/.test(u.protocol)) return resolve({ ok: true });
    // Nos propres serveurs (éventuellement derrière un tunnel distant) répondent forcément
    if (serverOrigin && u.origin === serverOrigin) return resolve({ ok: !!server });

    const lib = u.protocol === 'https:' ? https : http;
    // « localhost » peut viser IPv4 ou IPv6 selon le serveur : on essaie les deux.
    const hosts = u.hostname === 'localhost' ? ['127.0.0.1', '::1'] : [u.hostname];
    let pending = hosts.length, finished = false, lastErr = null;
    const done = (ok) => {
      if (finished) return;
      if (ok) { finished = true; return resolve({ ok: true }); }
      if (--pending === 0) {
        finished = true;
        resolve({ ok: false, error: (lastErr && (lastErr.code || lastErr.message)) || 'injoignable' });
      }
    };
    for (const host of hosts) {
      const req = lib.request(u, {
        method: 'GET', hostname: host, timeout: 3000, rejectUnauthorized: false,
        servername: u.hostname, headers: { Host: u.host }
      }, (res) => { res.destroy(); done(true); });
      req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })));
      req.on('error', (e) => { lastErr = e; done(false); });
      req.end();
    }
  });
}

/* =====================================================================
 * Proxy local : permet d'afficher les sites qui interdisent l'affichage
 * dans un cadre (X-Frame-Options, CSP frame-ancestors — ex. Django).
 * Un port par « profil » d'appareil (iOS, Android…) : le serveur voit ainsi
 * le bon user-agent même quand plusieurs appareils sont affichés.
 * ===================================================================== */

// { target, entries: Map(profil → Promise<{ server, port, origin }>), ports: Set }
let proxy = null;

function proxyRequest(entry, req, res) {
  const t = new URL(proxy.target);
  const { origin } = entry;
  if (req.url.startsWith('/__dp/')) return handleInternal(req, res, req.url.split('?')[0]);

  let headers = { ...req.headers, host: t.host, 'accept-encoding': 'identity' };
  if (headers.origin === origin) headers.origin = t.origin;
  if (headers.referer && headers.referer.startsWith(origin)) {
    headers.referer = t.origin + headers.referer.slice(origin.length);
  }
  if (getConfig().emulateUserAgent) headers = core.profileHeaders(headers, entry.profile);

  const lib = t.protocol === 'https:' ? https : http;
  const start = () => {
    const preq = lib.request({
      protocol: t.protocol, hostname: t.hostname, port: t.port, method: req.method, path: req.url,
      headers, rejectUnauthorized: false, autoSelectFamily: true
    }, (pres) => {
      const h = { ...pres.headers };
      delete h['x-frame-options'];
      for (const k of ['content-security-policy', 'content-security-policy-report-only']) {
        if (h[k]) h[k] = core.stripFrameAncestors(String(h[k]));
      }
      if (h.location && h.location.startsWith(t.origin)) h.location = origin + h.location.slice(t.origin.length);
      if (h['set-cookie']) h['set-cookie'] = h['set-cookie'].map(core.rewriteCookie);

      if (!/text\/html/i.test(h['content-type'] || '') || req.method === 'HEAD') {
        res.writeHead(pres.statusCode, h);
        return sendBody(res, pres);
      }
      const chunks = [];
      pres.on('data', (c) => chunks.push(c));
      pres.on('end', () => {
        // Les liens absolus vers le site restent dans le proxy
        const html = core.injectClient(Buffer.concat(chunks).toString('utf8').split(t.origin).join(origin));
        delete h['transfer-encoding'];
        h['content-length'] = Buffer.byteLength(html);
        res.writeHead(pres.statusCode, h);
        sendBody(res, html);
      });
    });
    preq.on('error', (e) => {
      if (res.headersSent) return res.destroy();
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(tr('Device Frame Preview: cannot reach {0} ({1})', proxy ? proxy.target : '', e.code || e.message));
    });
    req.pipe(preq);
  };
  if (limiter) setTimeout(start, limiter.latency); else start();
}

// WebSockets (rechargement à chaud de Vite, Django Channels…)
function proxyUpgrade(req, socket, head) {
  if (!proxy) return socket.destroy();
  const t = new URL(proxy.target);
  const secure = t.protocol === 'https:';
  const port = Number(t.port) || (secure ? 443 : 80);
  const up = secure
    ? tls.connect({ host: t.hostname, port, servername: t.hostname, rejectUnauthorized: false })
    : net.connect({ host: t.hostname, port, autoSelectFamily: true });
  const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    let [k, v] = [req.rawHeaders[i], req.rawHeaders[i + 1]];
    if (/^host$/i.test(k)) v = t.host;
    else if (/^origin$/i.test(k)) v = t.origin;
    lines.push(`${k}: ${v}`);
  }
  up.write(lines.join('\r\n') + '\r\n\r\n');
  if (head && head.length) up.write(head);
  up.pipe(socket); socket.pipe(up);
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
}

function stopProxy() {
  if (!proxy) return;
  for (const p of proxy.entries.values()) {
    p.then((e) => {
      e.server.close();
      if (e.server.closeAllConnections) e.server.closeAllConnections();
    }, () => {});
  }
  proxy = null;
}

function ensureProxy(target, profile) {
  if (!proxy || proxy.target !== target) {
    stopProxy();
    proxy = { target, entries: new Map(), ports: new Set() };
  }
  const current = proxy;
  if (current.entries.has(profile)) return current.entries.get(profile);

  const p = new Promise((resolve, reject) => {
    const entry = { profile, server: null, port: 0, origin: '' };
    const s = http.createServer((req, res) => {
      try { proxyRequest(entry, req, res); } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    s.on('upgrade', proxyUpgrade);
    s.on('error', reject);
    s.listen(0, '127.0.0.1', async () => {
      entry.server = s; entry.port = s.address().port;
      current.ports.add(entry.port);
      entry.origin = await publicOrigin(entry.port);
      resolve(entry);
    });
  });
  current.entries.set(profile, p);
  p.catch(() => current.entries.delete(profile));
  return p;
}

/**
 * Indique au webview quelle adresse charger réellement pour une URL donnée :
 * { from: origine affichée, to: { profil: origine à charger } } ou null.
 */
async function resolveFrame(url, profiles) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  if (serverOrigin && u.origin === serverOrigin) return null; // déjà notre serveur
  if (serverPort && u.origin === `http://127.0.0.1:${serverPort}`) return null;
  const cfg = getConfig();

  if (!cfg.proxy) {
    // Sans proxy, un serveur local distant reste joignable via un tunnel VS Code
    if (!isRemote() || !isLoopback(u.hostname)) return null;
    const ext = await vscode.env.asExternalUri(vscode.Uri.parse(u.origin + '/'));
    return { from: u.origin, to: { '*': new URL(ext.toString(true)).origin } };
  }

  const keys = new Set(['none']);
  if (cfg.emulateUserAgent) for (const p of profiles || []) if (core.PROFILES[p]) keys.add(p);
  const to = {};
  for (const k of keys) to[k] = (await ensureProxy(u.origin, k)).origin;
  return { from: u.origin, to };
}

/* =====================================================================
 * Détection automatique des serveurs de dev lancés
 * ===================================================================== */

const COMMON_PORTS = [3000, 3001, 4200, 4321, 5000, 5173, 5174, 8000, 8080, 8081, 8888, 4000, 1234, 9000];

function canConnect(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const end = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(400, () => end(false));
    s.on('connect', () => end(true));
    s.on('error', () => end(false));
  });
}

function fetchTitle(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        body += c;
        const m = body.match(/<title[^>]*>([^<]*)<\/title>/i);
        if (m || body.length > 65536) { res.destroy(); resolve(m ? m[1].trim() : ''); }
      });
      res.on('end', () => resolve(''));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(''));
  });
}

/** Renvoie les serveurs HTTP locaux qui répondent sur les ports courants. */
async function detectServers() {
  const own = new Set([serverPort, ...(proxy ? proxy.ports : [])]);
  const found = await Promise.all(COMMON_PORTS.filter((p) => !own.has(p)).map(async (port) => {
    // 127.0.0.1 d'abord (Django, PHP…), sinon IPv6 (Vite, Node récents)
    let url = null;
    if (await canConnect('127.0.0.1', port)) url = `http://127.0.0.1:${port}/`;
    else if (await canConnect('::1', port)) url = `http://localhost:${port}/`;
    if (!url) return null;
    return { url, port, title: await fetchTitle(url) };
  }));
  return found.filter(Boolean);
}

/** Choisit l'URL à ouvrir : dernière URL du projet, sinon serveur détecté. */
async function pickUrl(context, { force = false } = {}) {
  const last = context.workspaceState.get('lastUrl');
  if (!force && last && (await checkUrl(last)).ok) return last;

  const servers = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: tr('Device Frame Preview: looking for servers…') },
    detectServers);

  if (!force && servers.length === 1) return servers[0].url;

  const items = servers.map((s) => ({
    label: `$(server) ${s.url}`, description: s.title || tr('port {0}', s.port), url: s.url
  }));
  items.push({ label: '$(edit) ' + tr('Enter another URL…'), url: null });
  if (!servers.length) {
    items.unshift({ label: `$(globe) ${getConfig().defaultUrl}`, description: tr('Default URL (no server detected)'), url: getConfig().defaultUrl });
  }
  const pick = await vscode.window.showQuickPick(items, {
    title: 'Device Frame Preview', placeHolder: servers.length ? tr('Which server do you want to preview?') : tr('No dev server detected')
  });
  if (!pick) return undefined;
  if (pick.url) return pick.url;
  return vscode.window.showInputBox({
    title: 'Device Frame Preview', prompt: tr('URL to preview'), value: last || getConfig().defaultUrl
  });
}

async function smartOpen(context, opts) {
  if (panel && !(opts && opts.force)) return panel.reveal(undefined, true);
  const url = await pickUrl(context, opts);
  if (url) openPanel(context, { url, server: null });
}

/* =====================================================================
 * Configuration et préférences
 * ===================================================================== */

const UA_CHOICES = ['ios', 'ipados', 'android', 'android-tablet', 'none'];

function getConfig() {
  const c = vscode.workspace.getConfiguration('devicePreview');
  const custom = c.get('customDevices', []);
  const bps = c.get('breakpoints', [320, 768, 1024, 1440]);
  return {
    defaultUrl: c.get('defaultUrl', 'http://localhost:3000'),
    defaultDevice: c.get('defaultDevice', 'iphone-15'),
    autoReload: c.get('autoReload', true),
    proxy: c.get('proxy', true),
    showStatusBar: c.get('showStatusBar', true),
    emulateUserAgent: c.get('emulateUserAgent', true),
    syncScroll: c.get('syncScroll', true),
    breakpoints: (Array.isArray(bps) ? bps : []).map(Number)
      .filter((n) => n >= 100 && n <= 4000).map(Math.round),
    multiDevices: c.get('multiDevices', ['iphone-15', 'ipad-air', 'laptop-13']),
    customDevices: (Array.isArray(custom) ? custom : [])
      .filter((d) => d && d.name && d.width > 0 && d.height > 0)
      .map((d) => {
        const type = ['phone', 'tablet', 'laptop'].includes(d.type) ? d.type : 'phone';
        return {
          id: 'user:' + d.name, name: d.name, w: Math.round(d.width), h: Math.round(d.height),
          type, radius: type === 'phone' ? 40 : type === 'tablet' ? 24 : 0, notch: !!d.notch,
          ua: UA_CHOICES.includes(d.userAgent) ? d.userAgent : undefined
        };
      })
  };
}

function webviewConfig() {
  const cfg = getConfig();
  return {
    customDevices: cfg.customDevices, multiDevices: cfg.multiDevices, breakpoints: cfg.breakpoints,
    emulateUserAgent: cfg.emulateUserAgent, syncScroll: cfg.syncScroll
  };
}

function prefs(context) {
  return {
    favorites: context.globalState.get('favoriteDevices', []),
    recents: context.globalState.get('recentDevices', [])
  };
}

async function toggleFavorite(context, id) {
  const fav = prefs(context).favorites;
  await context.globalState.update('favoriteDevices',
    fav.includes(id) ? fav.filter((x) => x !== id) : [...fav, id]);
}

/** Recherche d'appareil (Quick Pick) avec favoris, récents et filtre par nom ou taille. */
function pickDevice(context, webview, msg) {
  const devices = Array.isArray(msg.items) ? msg.items : [];
  const byId = new Map(devices.map((d) => [d.id, d]));
  const qp = vscode.window.createQuickPick();
  qp.title = tr('Choose a device');
  qp.placeholder = tr('Type a name or a width, e.g. “pixel” or “390”');
  qp.matchOnDescription = true;

  const build = () => {
    const { favorites, recents } = prefs(context);
    const fav = new Set(favorites);
    const out = [];
    const item = (d) => ({
      label: (d.id === msg.current ? '$(check) ' : '') + d.label,
      description: d.w ? `${d.w}×${d.h}` : '',
      id: d.id,
      buttons: d.id === 'custom' ? [] : [{
        iconPath: new vscode.ThemeIcon(fav.has(d.id) ? 'star-full' : 'star-empty'),
        tooltip: fav.has(d.id) ? tr('Remove from favorites') : tr('Add to favorites')
      }]
    });
    const section = (label, list) => {
      if (!list.length) return;
      out.push({ label, kind: vscode.QuickPickItemKind.Separator });
      list.forEach((d) => out.push(item(d)));
    };
    section(tr('Favorites'), favorites.map((id) => byId.get(id)).filter(Boolean));
    section(tr('Recent'), recents.filter((id) => !fav.has(id)).map((id) => byId.get(id)).filter(Boolean));
    let group = null, list = [];
    for (const d of devices) {
      if (d.group !== group) { section(group, list); group = d.group; list = []; }
      list.push(d);
    }
    section(group, list);
    return out;
  };

  const focus = (id) => {
    const it = qp.items.find((i) => i.id === id);
    if (it) qp.activeItems = [it];
  };
  qp.items = build();
  focus(msg.current);
  qp.onDidTriggerItemButton(async ({ item }) => {
    await toggleFavorite(context, item.id);
    qp.items = build();
    focus(item.id);
    webview.postMessage({ type: 'prefs', ...prefs(context) });
  });
  qp.onDidAccept(() => {
    const sel = qp.selectedItems[0] || qp.activeItems[0];
    if (sel && sel.id) webview.postMessage({ type: 'setDevice', id: sel.id });
    qp.hide();
  });
  qp.onDidHide(() => qp.dispose());
  qp.show();
}

/* =====================================================================
 * Panneau d'aperçu
 * ===================================================================== */

function webviewOptions(context) {
  return {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
  };
}

function openPanel(context, target) {
  if (panel) {
    panel.reveal(undefined, true);
    if (target) panel.webview.postMessage({ type: 'navigate', ...target });
    return;
  }
  const p = vscode.window.createWebviewPanel(
    'devicePreview', 'Device Frame Preview',
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    webviewOptions(context)
  );
  setupPanel(context, p, target || {});
}

function setupPanel(context, p, target) {
  panel = p;
  const cfg = getConfig();
  const webview = p.webview;
  webview.options = webviewOptions(context);
  p.iconPath = new vscode.ThemeIcon('device-mobile');

  const media = (f) => webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', f));
  const nonce = crypto.randomBytes(16).toString('base64');
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${webview.cspSource} data:`,
    'frame-src http: https:'
  ].join('; ');

  const init = {
    url: target.url || cfg.defaultUrl,
    server: target.server || null,
    device: context.globalState.get('lastDevice') || cfg.defaultDevice,
    ...webviewConfig(),
    prefs: prefs(context),
    profiles: core.PROFILES,
    strings: webviewStrings()
  };

  webview.html = `<!DOCTYPE html>
<html lang="${vscode.env.language}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${media('preview.css')}">
<title>Device Frame Preview</title>
</head>
<body>
  <header class="toolbar">
    <span class="tool-group">
      <select id="device" title="${tr('Device')}"></select>
      <button id="fav">☆</button>
      <button id="search" title="${tr('Search devices (/)')}">⌕</button>
    </span>
    <span id="customSize" class="custom-size" hidden>
      <input id="cw" type="number" min="100" max="4000" title="${tr('Width (px)')}">
      <span>×</span>
      <input id="ch" type="number" min="100" max="4000" title="${tr('Height (px)')}">
    </span>
    <span class="tool-group">
      <button id="rotate" title="${tr('Rotate (R)')}">⟳</button>
      <button id="frameToggle" title="${tr('Show / hide the frame (F)')}">▢</button>
      <button id="multi" title="${tr('Show several devices side by side (M)')}">⊞</button>
      <button id="grid" title="${tr('Breakpoints: frameless widths side by side (B)')}">▥</button>
    </span>
    <span class="tool-group">
      <button id="touch" title="${tr('Touch emulation: the mouse acts as a finger (T)')}">☝</button>
      <button id="scheme">◐</button>
      <select id="network" title="${tr('Network throttling')}">
        <option value="">${tr('No throttling')}</option>
        <option value="4g">${tr('Fast 4G')}</option>
        <option value="slow-4g">${tr('Slow 4G')}</option>
        <option value="3g">3G</option>
      </select>
    </span>
    <select id="zoom" title="Zoom">
      <option value="fit">${tr('Fit')}</option>
      <option value="0.25">25 %</option>
      <option value="0.5">50 %</option>
      <option value="0.75">75 %</option>
      <option value="1">100 %</option>
      <option value="1.25">125 %</option>
    </select>
    <form id="urlForm">
      <input id="url" type="text" spellcheck="false" placeholder="http://localhost:3000">
      <button type="submit" title="${tr('Load')}">↵</button>
    </form>
    <button id="reload" title="${tr('Reload')}">↻</button>
    <button id="external" title="${tr('Open in browser')}">↗</button>
    <span id="dims" class="dims"></span>
  </header>
  <main id="stage">
    <div id="scaler"><div id="devices"></div></div>
    <div id="offline" class="offline" hidden>
      <div class="offline-box">
        <div class="offline-title">${tr('Cannot reach the server')}</div>
        <code id="offlineUrl"></code>
        <div id="offlineErr" class="offline-err"></div>
        <p>${tr('Start your dev server: the preview will reload automatically as soon as it responds.')}</p>
        <button id="offlineDismiss">${tr('Dismiss')}</button>
      </div>
    </div>
  </main>
  <script nonce="${nonce}">window.__INITIAL__ = ${JSON.stringify(init).replace(/</g, '\\u003c')};</script>
  <script nonce="${nonce}" src="${media('devices.js')}"></script>
  <script nonce="${nonce}" src="${media('preview.js')}"></script>
</body>
</html>`;

  const sendPrefs = () => webview.postMessage({ type: 'prefs', ...prefs(context) });

  const subs = [
    webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'deviceChanged': {
          await context.globalState.update('lastDevice', msg.device);
          const rec = prefs(context).recents.filter((id) => id !== msg.device);
          await context.globalState.update('recentDevices', [msg.device, ...rec].slice(0, 6));
          sendPrefs();
          break;
        }
        case 'toggleFavorite':
          await toggleFavorite(context, msg.id);
          sendPrefs();
          break;
        case 'pickDevice':
          pickDevice(context, webview, msg);
          break;
        case 'network':
          setNetwork(msg.value);
          break;
        case 'resolve': {
          let map = null;
          try { map = await resolveFrame(msg.url, msg.profiles); } catch { /* chargement direct */ }
          // Mémorise la dernière URL de serveur pour ce projet (pas celles du mode fichier)
          if (!(serverOrigin && msg.url.startsWith(serverOrigin))) {
            context.workspaceState.update('lastUrl', msg.url);
          }
          webview.postMessage({ type: 'resolved', seq: msg.seq, map });
          break;
        }
        case 'check': {
          const r = await checkUrl(msg.url);
          webview.postMessage({ type: 'checkResult', seq: msg.seq, url: msg.url, ...r });
          break;
        }
        case 'openExternal':
          if (/^https?:\/\//i.test(msg.url)) {
            let uri = vscode.Uri.parse(msg.url);
            if (isRemote()) uri = await vscode.env.asExternalUri(uri);
            vscode.env.openExternal(uri);
          }
          break;
        case 'title':
          p.title = msg.title ? `Preview · ${msg.title}` : 'Device Frame Preview';
          break;
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('devicePreview')) {
        webview.postMessage({ type: 'config', ...webviewConfig() });
      }
    })
  ];

  p.onDidDispose(() => {
    subs.forEach((s) => s.dispose());
    if (panel === p) panel = null;
    setNetwork(null);
    stopServer();
    stopProxy();
  });
}

/* =====================================================================
 * Activation
 * ===================================================================== */

function isHtml(uri) {
  return uri && uri.scheme === 'file' && /\.html?$/i.test(uri.fsPath);
}

async function openFile(context, uri) {
  uri = uri || vscode.window.activeTextEditor?.document.uri;
  if (!isHtml(uri)) {
    vscode.window.showWarningMessage(tr('Device Frame Preview: open or select an HTML file.'));
    return;
  }
  try {
    openPanel(context, await serverUrlFor(uri.fsPath));
  } catch (e) {
    vscode.window.showErrorMessage(tr('Device Frame Preview: could not start the server – {0}', e.message));
  }
}

function activate(context) {

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = '$(device-mobile) Preview';
  status.tooltip = tr('Device Frame Preview (Ctrl+Alt+P): preview the active HTML file or your dev server');
  status.command = 'devicePreview.quickOpen';
  const refreshStatus = () => (getConfig().showStatusBar ? status.show() : status.hide());
  refreshStatus();

  context.subscriptions.push(
    status,
    vscode.commands.registerCommand('devicePreview.open', () => smartOpen(context)),
    vscode.commands.registerCommand('devicePreview.pickServer', () => smartOpen(context, { force: true })),
    vscode.commands.registerCommand('devicePreview.openFile', (uri) => openFile(context, uri)),
    vscode.commands.registerCommand('devicePreview.quickOpen', () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      return isHtml(uri) ? openFile(context, uri) : smartOpen(context);
    }),
    vscode.commands.registerCommand('devicePreview.pickDevice', async () => {
      if (!panel) await vscode.commands.executeCommand('devicePreview.quickOpen');
      if (panel) panel.webview.postMessage({ type: 'requestPick' });
    }),

    // Restaure l'aperçu au redémarrage de VS Code
    vscode.window.registerWebviewPanelSerializer('devicePreview', {
      async deserializeWebviewPanel(p, saved) {
        saved = saved || {};
        let target = { url: saved.url };
        const srv = saved.server;
        if (srv && srv.root && fs.existsSync(srv.root) && saved.url && saved.url.startsWith(srv.origin)) {
          try {
            await ensureServer(srv.root);
            target = {
              url: serverOrigin + saved.url.slice(srv.origin.length),
              server: { root: srv.root, origin: serverOrigin }
            };
          } catch { target = {}; }
        } else if (srv) {
          target = {};
        }
        setupPanel(context, p, target);
      }
    }),

    // Filet de sécurité si le watcher ne voit pas le dossier (hors espace de travail)
    vscode.workspace.onDidSaveTextDocument((doc) => queueChange(doc.uri.fsPath)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('devicePreview.showStatusBar')) refreshStatus();
    }),

    { dispose: () => { stopServer(); stopProxy(); } }
  );
}

function deactivate() {
  stopServer();
  stopProxy();
}

module.exports = {
  activate, deactivate,
  // Pour les tests d'intégration (serveurs sans interface)
  _internals: { resolveFrame, ensureServer, serverUrlFor, setNetwork, stopProxy, stopServer }
};
