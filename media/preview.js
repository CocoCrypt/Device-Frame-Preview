(function () {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  const init = window.__INITIAL__;

  const $ = (id) => document.getElementById(id);
  const deviceSel = $('device'), zoomSel = $('zoom'), urlInput = $('url'), netSel = $('network');
  const scaler = $('scaler'), stage = $('stage'), container = $('devices'), dims = $('dims');
  const cw = $('cw'), ch = $('ch'), customSize = $('customSize');
  const offline = $('offline');

  // Traductions fournies par l'extension (vscode.l10n) ; à défaut, texte anglais d'origine
  const T = (s, ...a) => ((init.strings && init.strings[s]) || s).replace(/\{(\d+)\}/g, (m, i) => a[i]);

  const pickConf = (m) => ({
    customDevices: m.customDevices || [], multiDevices: m.multiDevices || [],
    breakpoints: m.breakpoints && m.breakpoints.length ? m.breakpoints : [320, 768, 1024, 1440],
    emulateUserAgent: m.emulateUserAgent !== false, syncScroll: m.syncScroll !== false
  });
  let conf = pickConf(init);
  let prefs = init.prefs || { favorites: [], recents: [] };
  let groups = [], all = [];

  let state = {
    device: saved.device || init.device,
    landscape: !!saved.landscape,
    showFrame: saved.showFrame !== false,
    zoom: saved.zoom || 'fit',
    mode: saved.mode || (saved.multi ? 'multi' : 'single'), // single | multi | grid
    custom: saved.custom || { w: 800, h: 600 },
    touch: saved.touch !== false,
    scheme: saved.scheme || 'auto', // auto | light | dark
    network: saved.network || '',
    url: init.url || saved.url,
    server: init.server !== undefined ? init.server : saved.server || null
  };

  function save() { vscode.setState(state); }
  const byId = (id) => all.find((d) => d.id === id);

  /* ---------- Liste des appareils ---------- */

  function buildDeviceList() {
    const base = window.DEVICES.slice();
    if (conf.customDevices.length) base.push({ group: 'My devices', items: conf.customDevices });
    base.push({ group: 'Other', items: [{ id: 'custom', name: 'Custom size…', type: 'responsive' }] });
    groups = base;
    all = base.flatMap((g) => g.items);

    // Favoris et appareils récents en tête de liste
    const pick = (ids) => ids.map(byId).filter(Boolean);
    const favs = pick(prefs.favorites);
    const recents = pick(prefs.recents.filter((id) => !prefs.favorites.includes(id))).slice(0, 5);
    const shown = [];
    if (favs.length) shown.push({ group: 'Favorites', items: favs });
    if (recents.length) shown.push({ group: 'Recent', items: recents });

    deviceSel.textContent = '';
    for (const g of shown.concat(base)) {
      const og = document.createElement('optgroup');
      og.label = T(g.group);
      for (const d of g.items) {
        const o = document.createElement('option');
        o.value = d.id; o.textContent = T(d.name);
        og.appendChild(o);
      }
      deviceSel.appendChild(og);
    }
    if (!byId(state.device)) state.device = all[0].id;
  }

  const GRID_H = 900;

  function sizeOf(d) {
    if (d.bp) return { w: d.w, h: d.h };
    let w = d.id === 'custom' ? state.custom.w : d.w;
    let h = d.id === 'custom' ? state.custom.h : d.h;
    // un portable est déjà en paysage : la rotation le passe en portrait
    if (state.landscape) [w, h] = [h, w];
    return { w, h };
  }

  function activeDevices() {
    if (state.mode === 'multi') {
      const list = conf.multiDevices.map(byId).filter(Boolean);
      if (list.length) return list;
    }
    if (state.mode === 'grid') {
      return conf.breakpoints.map((w) => ({ id: 'bp-' + w, name: w + ' px', w, h: GRID_H, type: 'responsive', bp: true }));
    }
    return [byId(state.device)];
  }

  /* ---------- Émulation (user-agent, tactile, thème, zones sûres) ---------- */

  const chrome = (/Chrome\/(\d+)/.exec(navigator.userAgent) || [])[1] || '140';
  const notchOf = (d) => (d.notch === true ? 'island' : d.notch);

  function profileOf(d) {
    if (!conf.emulateUserAgent) return 'none';
    if (d.ua) return d.ua;
    if (d.type === 'phone') return /^iphone/.test(d.id) ? 'ios' : 'android';
    if (d.type === 'tablet') return /^ipad/.test(d.id) ? 'ipados' : d.id === 'surface-pro' ? 'none' : 'android-tablet';
    return 'none';
  }

  // env(safe-area-inset-*) des iPhone à encoche / Dynamic Island
  function safeOf(d) {
    const n = notchOf(d);
    if (d.type !== 'phone' || !state.showFrame || (n !== 'island' && n !== 'notch')) return null;
    const top = n === 'island' ? 59 : 47;
    return state.landscape ? { top: 0, right: top, bottom: 21, left: top } : { top, right: 0, bottom: 34, left: 0 };
  }

  function emuOf(d) {
    const profile = profileOf(d);
    const p = init.profiles && init.profiles[profile];
    return {
      profile,
      ua: p ? p.ua.replace('{chrome}', chrome) : null,
      platform: p ? p.platform : null, vendor: p ? p.vendor : null, hints: p ? p.hints : null,
      touch: state.touch && (d.type === 'phone' || d.type === 'tablet'),
      scheme: state.scheme === 'auto' ? null : state.scheme,
      safe: safeOf(d)
    };
  }

  function postConfig(v) {
    try { v.iframe.contentWindow.postMessage({ __dp: 'config', scheme: v.emu.scheme, safe: v.emu.safe }, '*'); } catch {}
  }

  /* ---------- Cadres ---------- */

  let views = [];
  let scale = 1, resizeScale = null;

  function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }

  // La configuration d'émulation passe par le nom du cadre (window.name). Chrome ne
  // le transmet à la page que s'il est posé AVANT l'insertion de l'iframe dans le
  // document : on recrée donc l'iframe quand cette configuration change.
  function newFrame(name) {
    const f = el('iframe');
    f.title = 'Preview';
    f.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen; autoplay');
    f.name = name;
    return f;
  }

  function setSrc(v, url) {
    const name = '__dp' + JSON.stringify(v.emu);
    if (v.iframe.name !== name) {
      const f = newFrame(name);
      v.iframe.replaceWith(f);
      v.iframe = f;
    }
    v.iframe.src = url;
  }

  function createView() {
    const root = el('div', 'device');
    const label = el('div', 'device-label');
    const frame = el('div', 'device-frame');
    const screen = el('div', 'screen');
    const iframe = newFrame('');
    screen.appendChild(iframe);
    // Barre d'état (heure, réseau, batterie) : au-dessus de la page, comme sur un vrai téléphone
    const bar = el('div', 'statusbar');
    bar.innerHTML = '<span class="sb-time">9:41</span><span class="sb-icons">' +
      '<svg viewBox="0 0 18 12" width="18" height="12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>' +
      '<svg viewBox="0 0 16 12" width="16" height="12"><path d="M8 2.2c2.4 0 4.6.9 6.3 2.5l1.2-1.3A10.6 10.6 0 0 0 8 .4C5.1.4 2.5 1.5.5 3.4l1.2 1.3A9 9 0 0 1 8 2.2Zm0 3.6c1.4 0 2.7.5 3.7 1.4l1.2-1.3A7.2 7.2 0 0 0 8 4a7.2 7.2 0 0 0-4.9 1.9l1.2 1.3c1-.9 2.3-1.4 3.7-1.4Zm0 3.5c.6 0 1.1.2 1.5.6L8 11.6 6.5 9.9c.4-.4.9-.6 1.5-.6Z"/></svg>' +
      '<svg viewBox="0 0 27 13" width="27" height="13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2"/><rect x="25" y="4.5" width="1.8" height="4" rx=".9" opacity=".4"/></svg>' +
      '</span>';
    // Règles et poignées de redimensionnement (taille personnalisée)
    const rx = el('div', 'ruler ruler-x'), ry = el('div', 'ruler ruler-y'), tip = el('div', 'size-tip');
    const handles = ['r', 'b', 'rb'].map((dir) => {
      const h = el('div', 'handle handle-' + dir);
      h.addEventListener('pointerdown', (e) => startResize(e, dir, view));
      return h;
    });
    frame.append(el('div', 'notch'), bar, screen, el('div', 'home-indicator'), el('div', 'laptop-base'), rx, ry, tip, ...handles);
    root.append(label, frame);
    container.appendChild(root);
    const view = { root, label, frame, iframe, rx, ry, tip, key: null, live: null, cover: false, emu: null };
    return view;
  }

  function updateRulers(v, w, h) {
    const marks = (n) => {
      let s = '';
      for (let i = 0; i <= n; i += 100) s += `<span style="--at:${i}px">${i}</span>`;
      return s;
    };
    if (v.rw !== w) { v.rw = w; v.rx.innerHTML = marks(w); }
    if (v.rh !== h) { v.rh = h; v.ry.innerHTML = marks(h); }
    v.tip.textContent = `${w} × ${h}`;
  }

  function layout() {
    const list = activeDevices();
    while (views.length < list.length) views.push(createView());
    while (views.length > list.length) views.pop().root.remove();

    list.forEach((d, i) => {
      const v = views[i];
      const { w, h } = sizeOf(d);
      const plain = !state.showFrame || d.type === 'responsive';
      const notch = notchOf(d);
      const emu = emuOf(d);
      const resizable = state.mode === 'single' && d.id === 'custom';
      v.emu = emu;
      v.frame.className = `device-frame type-${d.type}` + (plain ? ' no-frame' : '') +
        (notch && !state.landscape ? ' has-notch notch-' + notch : '') +
        (state.landscape ? ' landscape' : '') +
        (v.cover && emu.safe && !state.landscape ? ' cover' : '') +
        (state.scheme === 'dark' ? ' dark' : '') +
        (resizable ? ' resizable' : '');
      v.root.classList.toggle('has-ruler', resizable);
      v.frame.style.setProperty('--w', w + 'px');
      v.frame.style.setProperty('--h', h + 'px');
      v.frame.style.setProperty('--r', (d.radius || 0) + 'px');
      v.label.textContent = d.bp ? d.name : `${d.id === 'custom' ? T('Custom') : T(d.name)} · ${w}×${h}`;
      if (resizable) updateRulers(v, w, h);

      // L'identité (user-agent, tactile) exige un rechargement ; le reste s'applique à chaud
      const key = emu.profile + '|' + emu.touch;
      const live = JSON.stringify([emu.scheme, emu.safe]);
      if (v.key !== key) { v.key = key; v.live = live; loadView(v); }
      else if (v.live !== live) { v.live = live; postConfig(v); }
    });
    container.classList.toggle('multi', state.mode !== 'single');

    // Échelle (offsetWidth/Height ignorent la transformation)
    const fw = container.offsetWidth, fh = container.offsetHeight;
    if (resizeScale) {
      scale = resizeScale;
    } else if (state.zoom === 'fit') {
      const pad = 32;
      scale = Math.min((stage.clientWidth - pad) / fw, (stage.clientHeight - pad) / fh, 1);
    } else {
      scale = parseFloat(state.zoom);
    }
    scale = Math.max(scale, 0.05);
    container.style.transform = `scale(${scale})`;
    container.style.setProperty('--scale', scale);
    scaler.style.width = fw * scale + 'px';
    scaler.style.height = fh * scale + 'px';

    const pct = Math.round(scale * 100) + ' %';
    if (state.mode === 'grid') {
      dims.textContent = `${list.map((d) => d.w).join(' · ')} px · ${pct}`;
    } else if (state.mode === 'multi') {
      dims.textContent = `${T('{0} devices', list.length)} · ${pct}`;
    } else {
      const { w, h } = sizeOf(list[0]);
      dims.textContent = `${w} × ${h} · ${pct}`;
    }

    const single = state.mode === 'single';
    deviceSel.value = state.device;
    deviceSel.disabled = !single;
    zoomSel.value = state.zoom;
    netSel.value = state.network;
    customSize.hidden = !single || state.device !== 'custom';
    cw.value = state.custom.w; ch.value = state.custom.h;
    $('multi').classList.toggle('active', state.mode === 'multi');
    $('grid').classList.toggle('active', state.mode === 'grid');
    $('frameToggle').classList.toggle('active', state.showFrame);
    $('rotate').classList.toggle('active', state.landscape);
    $('rotate').disabled = state.mode === 'grid';
    $('touch').classList.toggle('active', state.touch);

    const isFav = prefs.favorites.includes(state.device);
    const fav = $('fav');
    fav.textContent = isFav ? '★' : '☆';
    fav.title = T(isFav ? 'Remove from favorites (★)' : 'Add to favorites (★)');
    fav.disabled = !single || state.device === 'custom';
    fav.classList.toggle('active', isFav);

    const scheme = $('scheme');
    scheme.textContent = { auto: '◐', light: '☀', dark: '☾' }[state.scheme];
    scheme.title = T({ auto: 'Color scheme: page default (D)', light: 'Color scheme: light (D)', dark: 'Color scheme: dark (D)' }[state.scheme]);
    scheme.classList.toggle('active', state.scheme !== 'auto');
  }

  /* ---------- Redimensionnement à la souris (taille personnalisée) ---------- */

  function startResize(e, dir, v) {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const s0 = sizeOf(byId('custom')), x0 = e.clientX, y0 = e.clientY;
    resizeScale = scale;
    // Fige la position du coin haut-gauche pendant le glisser (sinon le centrage le déplace)
    const cs = getComputedStyle(stage);
    scaler.style.margin = `${scaler.offsetTop - parseFloat(cs.paddingTop)}px auto auto ${scaler.offsetLeft - parseFloat(cs.paddingLeft)}px`;
    document.body.classList.add('resizing');
    const clamp = (n) => Math.min(Math.max(Math.round(n), 100), 4000);

    const move = (ev) => {
      const nw = dir.includes('r') ? clamp(s0.w + (ev.clientX - x0) / resizeScale) : s0.w;
      const nh = dir.includes('b') ? clamp(s0.h + (ev.clientY - y0) / resizeScale) : s0.h;
      state.custom = state.landscape ? { w: nh, h: nw } : { w: nw, h: nh };
      layout();
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      resizeScale = null;
      scaler.style.margin = '';
      document.body.classList.remove('resizing');
      save(); layout();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
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
  // X-Frame-Options et présenter le bon user-agent) : on affiche l'URL réelle
  // mais chaque cadre charge celle du proxy correspondant à son profil.
  let frameReady = false, resolveSeq = 0, requested = [], pendingProfiles = [];

  function swapOrigin(url, from, to) {
    try {
      const u = new URL(url);
      return u.origin === from ? to + url.slice(u.origin.length) : url;
    } catch { return url; }
  }
  function toFrame(url, profile) {
    const m = state.map;
    if (!m || !m.to) return url;
    const to = m.to[profile] || m.to['*'] || m.to.none;
    return to ? swapOrigin(url, m.from, to) : url;
  }
  function toDisplay(url) {
    const m = state.map;
    if (!m || !m.to) return url;
    for (const o of Object.values(m.to)) {
      const out = swapOrigin(url, o, m.from);
      if (out !== url) return out;
    }
    return url;
  }

  const neededProfiles = () => [...new Set(activeDevices().map((d) => emuOf(d).profile))];

  function resolve() {
    frameReady = false;
    pendingProfiles = neededProfiles();
    vscode.postMessage({ type: 'resolve', url: state.url, seq: ++resolveSeq, profiles: pendingProfiles });
  }

  function navigate(url) {
    url = normalize(url);
    if (!url) return;
    state.url = url; urlInput.value = url; save();
    dismissed = null;
    resolve();
  }

  function loadView(v) {
    if (!frameReady || !state.url) return;
    // Nouveau profil d'appareil pas encore servi par le proxy : on le demande
    if (state.map && state.map.to && !state.map.to['*'] && !requested.includes(v.emu.profile)) return resolve();
    setSrc(v, toFrame(state.url, v.emu.profile));
  }

  function onResolved(m) {
    if (m.seq !== resolveSeq) return;
    state.map = m.map; requested = pendingProfiles; frameReady = true; save();
    for (const v of views) setSrc(v, toFrame(state.url, v.emu.profile));
    check();
  }

  function reload() {
    if (!state.url || !frameReady) return;
    for (const v of views) setSrc(v, withBust(toFrame(state.url, v.emu.profile)));
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

  /* ---------- Actions ---------- */

  function selectDevice(id) {
    if (!byId(id)) return;
    state.device = id; state.landscape = false; state.mode = 'single';
    save(); layout();
    vscode.postMessage({ type: 'deviceChanged', device: id });
  }

  function requestPick() {
    const items = groups.flatMap((g) => g.items.map((d) => ({
      id: d.id, label: T(d.name), group: T(g.group), w: d.w, h: d.h
    })));
    vscode.postMessage({ type: 'pickDevice', items, current: state.mode === 'single' ? state.device : null });
  }

  const setMode = (mode) => () => { state.mode = state.mode === mode ? 'single' : mode; save(); layout(); };
  const toggle = (key) => () => { state[key] = !state[key]; save(); layout(); };
  const cycleScheme = () => {
    state.scheme = { auto: 'light', light: 'dark', dark: 'auto' }[state.scheme] || 'auto';
    save(); layout();
  };
  const toggleFav = () => {
    if (state.mode === 'single' && state.device !== 'custom') vscode.postMessage({ type: 'toggleFavorite', id: state.device });
  };

  deviceSel.addEventListener('change', () => selectDevice(deviceSel.value));
  $('fav').addEventListener('click', toggleFav);
  $('search').addEventListener('click', requestPick);
  $('rotate').addEventListener('click', toggle('landscape'));
  $('frameToggle').addEventListener('click', toggle('showFrame'));
  $('multi').addEventListener('click', setMode('multi'));
  $('grid').addEventListener('click', setMode('grid'));
  $('touch').addEventListener('click', toggle('touch'));
  $('scheme').addEventListener('click', cycleScheme);
  netSel.addEventListener('change', () => {
    state.network = netSel.value; save();
    vscode.postMessage({ type: 'network', value: state.network });
  });
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
    const actions = {
      r: () => state.mode !== 'grid' && toggle('landscape')(), f: toggle('showFrame'),
      m: setMode('multi'), b: setMode('grid'), t: toggle('touch'), d: cycleScheme,
      '/': requestPick, '*': toggleFav
    };
    if (actions[k]) { e.preventDefault(); actions[k](); }
  });

  // Vrai si le message vient d'une page affichée (ou d'un de ses cadres), pas de l'extension
  function fromPreview(source) {
    for (let w = source, i = 0; w && i < 20; i++) {
      if (views.some((v) => v.iframe.contentWindow === w)) return true;
      if (w === window || w.parent === w) return false;
      w = w.parent;
    }
    return false;
  }

  window.addEventListener('resize', layout);
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    // Une page affichée ne doit pas pouvoir piloter l'aperçu (naviguer, changer de réglages…)
    if (!m.__dp && fromPreview(e.source)) return;

    // Messages envoyés par le script injecté dans les pages
    if (m.__dp) {
      const src = views.find((v) => v.iframe.contentWindow === e.source);
      if (!src) return;
      if (m.__dp === 'location') {
        if (typeof m.href !== 'string' || !/^https?:\/\//i.test(m.href)) return;
        if (src === views[0]) vscode.postMessage({ type: 'title', title: String(m.title || '') });
        const href = toDisplay(m.href);
        if (href !== state.url) {
          // Navigation synchronisée entre tous les appareils
          state.url = href; urlInput.value = href; save();
          for (const v of views) if (v !== src) setSrc(v, toFrame(href, v.emu.profile));
        }
      } else if (m.__dp === 'viewport') {
        if (src.cover !== !!m.cover) { src.cover = !!m.cover; layout(); }
      } else if (m.__dp === 'scroll') {
        // Défilement synchronisé (en proportion de la hauteur de chaque page)
        if (!conf.syncScroll || views.length < 2) return;
        for (const v of views) {
          if (v === src) continue;
          try { v.iframe.contentWindow.postMessage({ __dp: 'scrollTo', x: +m.x || 0, y: +m.y || 0 }, '*'); } catch {}
        }
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
      case 'setDevice': selectDevice(m.id); break;
      case 'requestPick': requestPick(); break;
      case 'prefs':
        prefs = { favorites: m.favorites || [], recents: m.recents || [] };
        buildDeviceList(); layout();
        break;
      case 'config':
        conf = pickConf(m);
        buildDeviceList(); save(); layout();
        break;
    }
  });

  buildDeviceList();
  layout();
  vscode.postMessage({ type: 'network', value: state.network });
  navigate(state.url);
})();
