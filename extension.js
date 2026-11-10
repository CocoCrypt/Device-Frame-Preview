const vscode = require('vscode');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const tls = require('tls');

let panel = null;

/** Traduction (vscode.l10n) : la chaîne source est en anglais, les traductions sont dans l10n/. */
const tr = (msg, ...args) => vscode.l10n.t(msg, ...args);

// Textes utilisés par media/preview.js et media/devices.js
const WEBVIEW_STRINGS = [
  'Custom size…', 'Custom', 'My devices', 'Other', '{0} devices',
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
 * Serveur statique local (mode « fichier HTML ») + rechargement à chaud
 * ===================================================================== */

let server = null;
let serverRoot = null;
let serverPort = null;
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

// Script injecté dans les pages HTML servies : rechargement live (CSS à chaud,
// position de scroll conservée) et remontée de l'URL courante vers la barre d'adresse.
const CLIENT_JS = `(function () {
  if (window.__dpClient) return; window.__dpClient = true;
  var KEY = '__dp_scroll:' + location.pathname;
  try {
    var s = sessionStorage.getItem(KEY);
    if (s) {
      sessionStorage.removeItem(KEY);
      var p = JSON.parse(s);
      var restore = function () { scrollTo(p[0], p[1]); };
      if (document.readyState === 'complete') restore(); else addEventListener('load', restore);
    }
  } catch (e) {}
  function report() {
    try {
      var u = new URL(location.href); u.searchParams.delete('_dp');
      parent.postMessage({ __dp: 'location', href: u.href, title: document.title }, '*');
    } catch (e) {}
  }
  report();
  addEventListener('load', report);
  addEventListener('hashchange', report);
  addEventListener('popstate', report);
  var es = new EventSource('/__dp/events');
  es.onmessage = function (e) {
    var d = JSON.parse(e.data);
    if (d.type === 'css') {
      var links = document.querySelectorAll('link[rel="stylesheet"]'), done = false;
      for (var i = 0; i < links.length; i++) {
        var u = new URL(links[i].href, location.href);
        if (u.origin !== location.origin) continue;
        u.searchParams.set('_dp', Date.now()); links[i].href = u.href; done = true;
      }
      if (done) return;
    }
    try { sessionStorage.setItem(KEY, JSON.stringify([scrollX, scrollY])); } catch (e) {}
    location.reload();
  };
})();`;

function isInside(root, p) {
  const rel = path.relative(root, p);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

// Masque les barres de défilement (invisibles sur un vrai téléphone), le scroll reste actif.
const CLIENT_CSS = `*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important}`;

function injectClient(html) {
  const css = '<link rel="stylesheet" href="/__dp/client.css">';
  const js = '<script src="/__dp/client.js"></script>';
  const lower = html.toLowerCase();
  const h = lower.indexOf('</head');
  if (h !== -1) html = html.slice(0, h) + css + html.slice(h);
  const i = html.toLowerCase().lastIndexOf('</body');
  const tail = h === -1 ? css + js : js;
  return i === -1 ? html + tail : html.slice(0, i) + tail + html.slice(i);
}

async function handleRequest(root, req, res) {
  let urlObj;
  try { urlObj = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); }

  if (urlObj.pathname === '/__dp/client.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
    return res.end(CLIENT_JS);
  }
  if (urlObj.pathname === '/__dp/client.css') {
    res.writeHead(200, { 'Content-Type': MIME['.css'], 'Cache-Control': 'no-store' });
    return res.end(CLIENT_CSS);
  }
  if (urlObj.pathname === '/__dp/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive'
    });
    res.write(': ok\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  let urlPath;
  try { urlPath = decodeURIComponent(urlObj.pathname); } catch { res.writeHead(400); return res.end(); }
  let filePath = path.resolve(root, '.' + urlPath);
  if (!isInside(root, filePath)) { res.writeHead(403); return res.end('403 – forbidden'); }

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
      const html = injectClient(await fs.promises.readFile(filePath, 'utf8'));
      res.writeHead(200, headers);
      return res.end(html);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
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
  serverRoot = serverPort = null;
}

/** Démarre (ou réutilise) le serveur qui sert le dossier `root`. */
function ensureServer(root) {
  if (server && serverRoot === root) return Promise.resolve(serverPort);
  stopServer();

  return new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => {
      handleRequest(root, req, res).catch((e) => { res.writeHead(500); res.end(String(e)); });
    });
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      server = s; serverRoot = root; serverPort = s.address().port;

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
  if (!serverRoot || !isInside(serverRoot, fsPath)) return;
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
  const port = await ensureServer(root);
  const rel = path.relative(root, fsPath).split(path.sep).map(encodeURIComponent).join('/');
  const origin = `http://127.0.0.1:${port}`;
  return { url: `${origin}/${rel}`, server: { root, origin } };
}

/* =====================================================================
 * Vérification qu'une URL répond (serveur de dev lancé ?)
 * ===================================================================== */

function checkUrl(url) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { return resolve({ ok: false, error: 'URL invalide' }); }
    if (!/^https?:$/.test(u.protocol)) return resolve({ ok: true });

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
 * ===================================================================== */

let proxy = null; // { server, port, target (origine distante), origin (origine du proxy) }

function stripFrameAncestors(csp) {
  return csp.split(';').map((s) => s.trim())
    .filter((s) => s && !/^frame-ancestors\b/i.test(s)).join('; ');
}

// L'aperçu est affiché dans un contexte « tiers » : sans SameSite=None, les
// cookies (session, CSRF…) ne seraient pas renvoyés et la connexion échouerait.
function rewriteCookie(c) {
  const parts = c.split(';').map((s) => s.trim())
    .filter((p, i) => i === 0 || !/^(domain|samesite|secure)\b/i.test(p));
  return [...parts, 'SameSite=None', 'Secure'].join('; ');
}

function proxyRequest(req, res) {
  const { target, origin } = proxy;
  const t = new URL(target);
  if (req.url.startsWith('/__dp/')) {
    return handleRequest(__dirname, req, res); // script/CSS injectés + SSE
  }

  const headers = { ...req.headers, host: t.host, 'accept-encoding': 'identity' };
  if (headers.origin === origin) headers.origin = t.origin;
  if (headers.referer && headers.referer.startsWith(origin)) {
    headers.referer = t.origin + headers.referer.slice(origin.length);
  }

  const lib = t.protocol === 'https:' ? https : http;
  const preq = lib.request({
    protocol: t.protocol, hostname: t.hostname, port: t.port, method: req.method, path: req.url,
    headers, rejectUnauthorized: false, autoSelectFamily: true
  }, (pres) => {
    const h = { ...pres.headers };
    delete h['x-frame-options'];
    for (const k of ['content-security-policy', 'content-security-policy-report-only']) {
      if (h[k]) h[k] = stripFrameAncestors(String(h[k]));
    }
    if (h.location && h.location.startsWith(t.origin)) h.location = origin + h.location.slice(t.origin.length);
    if (h['set-cookie']) h['set-cookie'] = h['set-cookie'].map(rewriteCookie);

    if (!/text\/html/i.test(h['content-type'] || '') || req.method === 'HEAD') {
      res.writeHead(pres.statusCode, h);
      return pres.pipe(res);
    }
    const chunks = [];
    pres.on('data', (c) => chunks.push(c));
    pres.on('end', () => {
      // Les liens absolus vers le site restent dans le proxy
      const html = injectClient(Buffer.concat(chunks).toString('utf8').split(t.origin).join(origin));
      delete h['transfer-encoding'];
      h['content-length'] = Buffer.byteLength(html);
      res.writeHead(pres.statusCode, h);
      res.end(html);
    });
  });
  preq.on('error', (e) => {
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(tr('Device Frame Preview: cannot reach {0} ({1})', target, e.code || e.message));
  });
  req.pipe(preq);
}

// WebSockets (rechargement à chaud de Vite, Django Channels…)
function proxyUpgrade(req, socket, head) {
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
  proxy.server.close();
  if (proxy.server.closeAllConnections) proxy.server.closeAllConnections();
  proxy = null;
}

function ensureProxy(target) {
  if (proxy && proxy.target === target) return Promise.resolve(proxy);
  stopProxy();
  return new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => {
      try { proxyRequest(req, res); } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    s.on('upgrade', proxyUpgrade);
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      proxy = { server: s, port, target, origin: `http://127.0.0.1:${port}` };
      resolve(proxy);
    });
  });
}

/** Indique au webview quelle adresse charger réellement pour une URL donnée. */
async function resolveFrame(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  if (serverPort && u.origin === `http://127.0.0.1:${serverPort}`) return null; // déjà notre serveur
  if (!getConfig().proxy) return null;
  const p = await ensureProxy(u.origin);
  return { from: u.origin, to: p.origin };
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
  const own = new Set([serverPort, proxy && proxy.port]);
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
 * Configuration
 * ===================================================================== */

function getConfig() {
  const c = vscode.workspace.getConfiguration('devicePreview');
  const custom = c.get('customDevices', []);
  return {
    defaultUrl: c.get('defaultUrl', 'http://localhost:3000'),
    defaultDevice: c.get('defaultDevice', 'iphone-15'),
    autoReload: c.get('autoReload', true),
    proxy: c.get('proxy', true),
    showStatusBar: c.get('showStatusBar', true),
    multiDevices: c.get('multiDevices', ['iphone-15', 'ipad-air', 'laptop-13']),
    customDevices: (Array.isArray(custom) ? custom : [])
      .filter((d) => d && d.name && d.width > 0 && d.height > 0)
      .map((d) => {
        const type = ['phone', 'tablet', 'laptop'].includes(d.type) ? d.type : 'phone';
        return {
          id: 'user:' + d.name, name: d.name, w: Math.round(d.width), h: Math.round(d.height),
          type, radius: type === 'phone' ? 40 : type === 'tablet' ? 24 : 0, notch: !!d.notch
        };
      })
  };
}

function webviewConfig() {
  const cfg = getConfig();
  return { customDevices: cfg.customDevices, multiDevices: cfg.multiDevices };
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
    <select id="device" title="${tr('Device')}"></select>
    <span id="customSize" class="custom-size" hidden>
      <input id="cw" type="number" min="100" max="4000" title="${tr('Width (px)')}">
      <span>×</span>
      <input id="ch" type="number" min="100" max="4000" title="${tr('Height (px)')}">
    </span>
    <button id="rotate" title="${tr('Rotate (R)')}">⟳</button>
    <button id="frameToggle" title="${tr('Show / hide the frame (F)')}">▢</button>
    <button id="multi" title="${tr('Show several devices side by side (M)')}">⊞</button>
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

  const subs = [
    webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'deviceChanged':
          context.globalState.update('lastDevice', msg.device);
          break;
        case 'resolve': {
          let map = null;
          try { map = await resolveFrame(msg.url); } catch { /* chargement direct */ }
          // Mémorise la dernière URL de serveur pour ce projet (pas celles du mode fichier)
          if (!(serverPort && msg.url.startsWith(`http://127.0.0.1:${serverPort}`))) {
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
          if (/^https?:\/\//i.test(msg.url)) vscode.env.openExternal(vscode.Uri.parse(msg.url));
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

    // Restaure l'aperçu au redémarrage de VS Code
    vscode.window.registerWebviewPanelSerializer('devicePreview', {
      async deserializeWebviewPanel(p, saved) {
        saved = saved || {};
        let target = { url: saved.url };
        const srv = saved.server;
        if (srv && srv.root && fs.existsSync(srv.root) && saved.url && saved.url.startsWith(srv.origin)) {
          try {
            const port = await ensureServer(srv.root);
            const origin = `http://127.0.0.1:${port}`;
            target = { url: origin + saved.url.slice(srv.origin.length), server: { root: srv.root, origin } };
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

module.exports = { activate, deactivate };
