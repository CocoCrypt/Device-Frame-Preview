(function () {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  const init = window.__INITIAL__;

  const $ = (id) => document.getElementById(id);
  const deviceSel = $('device'), zoomSel = $('zoom'), urlInput = $('url');
  const scaler = $('scaler'), stage = $('stage'), container = $('devices'), dims = $('dims');
  const cw = $('cw'), ch = $('ch'), customSize = $('customSize');
  const offline = $('offline');

  let conf = { customDevices: init.customDevices, multiDevices: init.multiDevices };
  let groups = [], all = [];

  let state = {
    device: saved.device || init.device,
    landscape: !!saved.landscape,
    showFrame: saved.showFrame !== false,
    zoom: saved.zoom || 'fit',
    multi: !!saved.multi,
    custom: saved.custom || { w: 800, h: 600 },
    url: init.url || saved.url,
    server: init.server !== undefined ? init.server : saved.server || null
  };

  function save() { vscode.setState(state); }
  const byId = (id) => all.find((d) => d.id === id);

  /* ---------- Liste des appareils ---------- */

  function buildDeviceList() {
    groups = window.DEVICES.slice();
    if (conf.customDevices.length) groups.push({ group: 'Mes appareils', items: conf.customDevices });
    groups.push({ group: 'Autre', items: [{ id: 'custom', name: 'Taille personnalisée…', type: 'responsive' }] });
    all = groups.flatMap((g) => g.items);

    deviceSel.textContent = '';
    for (const g of groups) {
      const og = document.createElement('optgroup');
      og.label = g.group;
      for (const d of g.items) {
        const o = document.createElement('option');
        o.value = d.id; o.textContent = d.name;
        og.appendChild(o);
      }
      deviceSel.appendChild(og);
    }
    if (!byId(state.device)) state.device = all[0].id;
  }

  function sizeOf(d) {
    let w = d.id === 'custom' ? state.custom.w : d.w;
    let h = d.id === 'custom' ? state.custom.h : d.h;
    // un portable est déjà en paysage : la rotation le passe en portrait
    if (state.landscape) [w, h] = [h, w];
    return { w, h };
  }

  function activeDevices() {
    if (state.multi) {
      const list = conf.multiDevices.map(byId).filter(Boolean);
      if (list.length) return list;
    }
    return [byId(state.device)];
  }

  /* ---------- Cadres ---------- */

  let views = [];

  function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }

  function createView() {
    const root = el('div', 'device');
    const label = el('div', 'device-label');
    const frame = el('div', 'device-frame');
    const screen = el('div', 'screen');
    const iframe = el('iframe');
    iframe.title = 'Aperçu';
    iframe.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen; autoplay');
    screen.appendChild(iframe);
    // Barre d'état (heure, réseau, batterie) : au-dessus de la page, comme sur un vrai téléphone
    const bar = el('div', 'statusbar');
    bar.innerHTML = '<span class="sb-time">9:41</span><span class="sb-icons">' +
      '<svg viewBox="0 0 18 12" width="18" height="12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>' +
      '<svg viewBox="0 0 16 12" width="16" height="12"><path d="M8 2.2c2.4 0 4.6.9 6.3 2.5l1.2-1.3A10.6 10.6 0 0 0 8 .4C5.1.4 2.5 1.5.5 3.4l1.2 1.3A9 9 0 0 1 8 2.2Zm0 3.6c1.4 0 2.7.5 3.7 1.4l1.2-1.3A7.2 7.2 0 0 0 8 4a7.2 7.2 0 0 0-4.9 1.9l1.2 1.3c1-.9 2.3-1.4 3.7-1.4Zm0 3.5c.6 0 1.1.2 1.5.6L8 11.6 6.5 9.9c.4-.4.9-.6 1.5-.6Z"/></svg>' +
      '<svg viewBox="0 0 27 13" width="27" height="13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2"/><rect x="25" y="4.5" width="1.8" height="4" rx=".9" opacity=".4"/></svg>' +
      '</span>';
    frame.append(el('div', 'notch'), bar, screen, el('div', 'laptop-base'));
    root.append(label, frame);
    container.appendChild(root);
    if (state.url && frameReady) iframe.src = toFrame(state.url);
    return { root, label, frame, iframe };
  }

  function layout() {
    const list = activeDevices();
    while (views.length < list.length) views.push(createView());
    while (views.length > list.length) views.pop().root.remove();

    list.forEach((d, i) => {
      const v = views[i];
      const { w, h } = sizeOf(d);
      const plain = !state.showFrame || d.type === 'responsive';
      v.frame.className = `device-frame type-${d.type}` + (plain ? ' no-frame' : '') +
        (d.notch && !state.landscape ? ' has-notch notch-' + (d.notch === true ? 'island' : d.notch) : '') +
        (state.landscape ? ' landscape' : '');
      v.frame.style.setProperty('--w', w + 'px');
      v.frame.style.setProperty('--h', h + 'px');
      v.frame.style.setProperty('--r', (d.radius || 0) + 'px');
      v.label.textContent = `${d.name === 'Taille personnalisée…' ? 'Personnalisé' : d.name} · ${w}×${h}`;
    });
    container.classList.toggle('multi', state.multi);

    // Échelle (offsetWidth/Height ignorent la transformation)
    const fw = container.offsetWidth, fh = container.offsetHeight;
    let scale;
    if (state.zoom === 'fit') {
      const pad = 32;
      scale = Math.min((stage.clientWidth - pad) / fw, (stage.clientHeight - pad) / fh, 1);
    } else {
      scale = parseFloat(state.zoom);
    }
    scale = Math.max(scale, 0.05);
    container.style.transform = `scale(${scale})`;
    scaler.style.width = fw * scale + 'px';
    scaler.style.height = fh * scale + 'px';

    const pct = Math.round(scale * 100) + ' %';
    if (state.multi) {
      dims.textContent = `${list.length} appareils · ${pct}`;
    } else {
      const { w, h } = sizeOf(list[0]);
      dims.textContent = `${w} × ${h} · ${pct}`;
    }

    deviceSel.value = state.device;
    deviceSel.disabled = state.multi;
    zoomSel.value = state.zoom;
    customSize.hidden = state.multi || state.device !== 'custom';
    cw.value = state.custom.w; ch.value = state.custom.h;
    $('multi').classList.toggle('active', state.multi);
    $('frameToggle').classList.toggle('active', state.showFrame);
    $('rotate').classList.toggle('active', state.landscape);
  }

  /* ---------- Navigation ---------- */

  function normalize(url) {
    url = (url || '').trim();
    if (!url) return null;
    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
    return url;
  }

  function withBust(url) {
    try { const u = new URL(url); u.searchParams.set('_dp', Date.now()); return u.toString(); }
    catch { return url; }
  }

  // L'extension peut faire passer un site par son proxy local (pour contourner
  // X-Frame-Options) : on affiche l'URL réelle mais on charge celle du proxy.
  let frameReady = false, resolveSeq = 0;

  function swapOrigin(url, from, to) {
    try {
      const u = new URL(url);
      return u.origin === from ? to + url.slice(u.origin.length) : url;
    } catch { return url; }
  }
  const toFrame = (url) => (state.map ? swapOrigin(url, state.map.from, state.map.to) : url);
  const toDisplay = (url) => (state.map ? swapOrigin(url, state.map.to, state.map.from) : url);

  function navigate(url) {
    url = normalize(url);
    if (!url) return;
    state.url = url; urlInput.value = url; save();
    frameReady = false;
    dismissed = null;
    vscode.postMessage({ type: 'resolve', url, seq: ++resolveSeq });
  }

  function onResolved(m) {
    if (m.seq !== resolveSeq) return;
    state.map = m.map; frameReady = true; save();
    for (const v of views) v.iframe.src = toFrame(state.url);
    check();
  }

  function reload() {
    if (!state.url || !frameReady) return;
    for (const v of views) v.iframe.src = withBust(toFrame(state.url));
  }

  /* ---------- Serveur injoignable ---------- */

  let checkSeq = 0, checkTimer = null, dismissed = null;

  function check() {
    clearTimeout(checkTimer);
    if (!state.url) return;
    vscode.postMessage({ type: 'check', url: state.url, seq: ++checkSeq });
  }

  function onCheckResult(m) {
    if (m.seq !== checkSeq || m.url !== state.url) return;
    if (m.ok) {
      if (!offline.hidden) { offline.hidden = true; reload(); }
      return;
    }
    if (dismissed !== state.url) {
      $('offlineUrl').textContent = m.url;
      $('offlineErr').textContent = m.error ? `(${m.error})` : '';
      offline.hidden = false;
    }
    checkTimer = setTimeout(check, 2000);
  }

  $('offlineDismiss').addEventListener('click', () => { dismissed = state.url; offline.hidden = true; });

  /* ---------- Événements ---------- */

  deviceSel.addEventListener('change', () => {
    state.device = deviceSel.value; state.landscape = false; save(); layout();
    vscode.postMessage({ type: 'deviceChanged', device: state.device });
  });
  const toggle = (key) => () => { state[key] = !state[key]; save(); layout(); };
  $('rotate').addEventListener('click', toggle('landscape'));
  $('frameToggle').addEventListener('click', toggle('showFrame'));
  $('multi').addEventListener('click', toggle('multi'));
  zoomSel.addEventListener('change', () => { state.zoom = zoomSel.value; save(); layout(); });
  $('urlForm').addEventListener('submit', (e) => { e.preventDefault(); navigate(urlInput.value); });
  $('reload').addEventListener('click', reload);
  $('external').addEventListener('click', () => vscode.postMessage({ type: 'openExternal', url: state.url }));

  function onCustomSize() {
    const clamp = (v, def) => { v = parseInt(v, 10); return isNaN(v) ? def : Math.min(Math.max(v, 100), 4000); };
    state.custom = { w: clamp(cw.value, state.custom.w), h: clamp(ch.value, state.custom.h) };
    save(); layout();
  }
  cw.addEventListener('change', onCustomSize);
  ch.addEventListener('change', onCustomSize);

  // Raccourcis clavier (hors champs de saisie)
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'r') toggle('landscape')();
    else if (k === 'f') toggle('showFrame')();
    else if (k === 'm') toggle('multi')();
  });

  window.addEventListener('resize', layout);
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;

    // Messages envoyés par le script injecté dans les pages (mode fichier)
    if (m.__dp === 'location') {
      const src = views.find((v) => v.iframe.contentWindow === e.source);
      if (!src || typeof m.href !== 'string' || !/^https?:\/\//i.test(m.href)) return;
      if (src === views[0]) vscode.postMessage({ type: 'title', title: String(m.title || '') });
      const href = toDisplay(m.href);
      if (href !== state.url) {
        // Navigation synchronisée entre tous les appareils
        state.url = href; urlInput.value = href; save();
        for (const v of views) if (v !== src) v.iframe.src = m.href;
      }
      return;
    }

    // Messages de l'extension
    switch (m.type) {
      case 'navigate':
        if (m.server !== undefined) state.server = m.server;
        navigate(m.url);
        break;
      case 'reload': reload(); break;
      case 'resolved': onResolved(m); break;
      case 'checkResult': onCheckResult(m); break;
      case 'config':
        conf = { customDevices: m.customDevices, multiDevices: m.multiDevices };
        buildDeviceList(); save(); layout();
        break;
    }
  });

  buildDeviceList();
  layout();
  navigate(state.url);
})();
