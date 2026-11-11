// Script injecté dans les pages affichées (mode fichier et proxy), en tout premier
// dans <head>. L'extension le sert en le précédant de rewriteMedia et
// rewriteSafeArea (lib/core.js).
//  - émulation de l'appareil : user-agent, écran tactile, thème clair/sombre, zones sûres
//  - rechargement live (CSS à chaud, scroll conservé)
//  - remontée de l'URL, du viewport et du défilement vers l'aperçu
(function () {
  if (window.__dpClient) return;
  window.__dpClient = true;

  var inFrame = window.parent !== window;
  function post(m) { if (inFrame) try { parent.postMessage(m, '*'); } catch (e) {} }

  // Configuration transmise par l'aperçu via le nom du cadre (lisible dès le départ)
  var emu = {};
  try { if (window.name.indexOf('__dp') === 0) emu = JSON.parse(window.name.slice(4)) || {}; } catch (e) {}

  /* ---------- 1. Identité de l'appareil (avant les scripts de la page) ---------- */

  function def(obj, prop, value) {
    try { Object.defineProperty(obj, prop, { get: function () { return value; }, configurable: true }); } catch (e) {}
  }
  var N = Navigator.prototype;
  if (emu.ua) {
    def(N, 'userAgent', emu.ua);
    def(N, 'appVersion', emu.ua.replace(/^Mozilla\//, ''));
    def(N, 'platform', emu.platform);
    def(N, 'vendor', emu.vendor);
    if (emu.hints) {
      var brands = navigator.userAgentData ? navigator.userAgentData.brands : [];
      var low = { brands: brands, mobile: emu.hints.mobile, platform: emu.hints.platform };
      def(N, 'userAgentData', {
        brands: brands, mobile: emu.hints.mobile, platform: emu.hints.platform,
        getHighEntropyValues: function () {
          return Promise.resolve(Object.assign({ platformVersion: '10.0.0', model: '', architecture: '', bitness: '' }, low));
        },
        toJSON: function () { return low; }
      });
    } else {
      def(N, 'userAgentData', undefined);
    }
  }
  if (emu.touch) {
    def(N, 'maxTouchPoints', 5);
    try { window.ontouchstart = null; document.ontouchstart = null; } catch (e) {}
  }

  // (pointer: coarse), (hover: none), (prefers-color-scheme: dark) côté JavaScript
  var nativeMatchMedia = window.matchMedia;
  window.matchMedia = function (q) { return nativeMatchMedia.call(window, rewriteMedia(String(q), emu)); };

  /* ---------- 2. Remontée de l'URL, du viewport et du défilement ---------- */

  function report() {
    try {
      var u = new URL(location.href); u.searchParams.delete('_dp');
      post({ __dp: 'location', href: u.href, title: document.title });
    } catch (e) {}
  }
  report();
  addEventListener('DOMContentLoaded', report);
  addEventListener('load', report);
  addEventListener('hashchange', report);
  addEventListener('popstate', report);

  // viewport-fit=cover : la page s'étend sous la barre d'état (zones sûres)
  var cover = null; // null : pas encore signalé à l'aperçu
  function checkViewport() {
    var m = document.querySelector('meta[name="viewport"]');
    var c = !!m && /viewport-fit\s*=\s*cover/i.test(m.content || '');
    if (c !== cover) { cover = c; post({ __dp: 'viewport', cover: c }); }
  }

  var applyingScroll = 0, scrollQueued = false;
  function scrollMax() {
    var se = document.scrollingElement || document.documentElement;
    return { x: se.scrollWidth - innerWidth, y: se.scrollHeight - innerHeight };
  }
  addEventListener('scroll', function () {
    if (!inFrame || scrollQueued || Date.now() - applyingScroll < 150) return;
    scrollQueued = true;
    setTimeout(function () {
      scrollQueued = false;
      var m = scrollMax();
      post({ __dp: 'scroll', x: m.x > 0 ? scrollX / m.x : 0, y: m.y > 0 ? scrollY / m.y : 0 });
    }, 16);
  }, { passive: true });

  addEventListener('message', function (e) {
    var d = e.data;
    if (e.source !== parent || !d || typeof d !== 'object') return;
    if (d.__dp === 'scrollTo') {
      var m = scrollMax();
      applyingScroll = Date.now();
      scrollTo({ left: d.x * Math.max(m.x, 0), top: d.y * Math.max(m.y, 0), behavior: 'instant' });
    } else if (d.__dp === 'config') {
      emu.scheme = d.scheme; emu.safe = d.safe;
      try { window.name = '__dp' + JSON.stringify(emu); } catch (err) {}
      applyStyles();
    }
  });

  /* ---------- 3. Thème, tactile et zones sûres dans les feuilles de style ---------- */

  var MEDIA_RE = /(prefers-color-scheme|pointer|hover)/i;
  var SAFE_RE = /(?:env|constant)\(\s*safe-area-inset-/i;
  var origRule = new WeakMap(), origMedia = new WeakMap(), origAttr = new WeakMap();
  var busy = false, touched = false;

  function wanted() { return !!(emu.scheme || emu.touch || (cover && emu.safe)); }

  function fixMedia(list, key) {
    var orig = origMedia.has(key) ? origMedia.get(key) : list.mediaText;
    if (!MEDIA_RE.test(orig)) return;
    var out = rewriteMedia(orig, emu);
    if (out !== list.mediaText) { origMedia.set(key, orig); list.mediaText = out; touched = true; }
  }

  function walk(owner, rules) {
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (typeof CSSImportRule !== 'undefined' && r instanceof CSSImportRule) {
        if (r.media) fixMedia(r.media, r);
        try { if (r.styleSheet) walk(r.styleSheet, r.styleSheet.cssRules); } catch (e) {}
        continue;
      }
      if (r instanceof CSSMediaRule) fixMedia(r.media, r);
      if (r instanceof CSSStyleRule) {
        var orig = origRule.get(r), src = orig || r.cssText;
        if (orig || SAFE_RE.test(src)) {
          var out = rewriteSafeArea(src, cover ? emu.safe : null);
          if (out !== r.cssText) {
            try {
              owner.deleteRule(i); owner.insertRule(out, i);
              r = owner.cssRules[i]; origRule.set(r, src); touched = true;
            } catch (e) {}
          }
        }
      }
      if (r.cssRules) { try { walk(r, r.cssRules); } catch (e) {} }
    }
  }

  function fixAttr(el, attr, fn) {
    var orig = origAttr.has(el) ? origAttr.get(el) : el.getAttribute(attr);
    if (orig == null) return;
    var out = fn(orig);
    if (out !== el.getAttribute(attr)) { origAttr.set(el, orig); el.setAttribute(attr, out); touched = true; }
  }

  function applyStyles() {
    checkViewport();
    if (!wanted() && !touched) return;
    busy = true;
    try {
      var sheets = Array.prototype.slice.call(document.styleSheets);
      if (document.adoptedStyleSheets) sheets = sheets.concat(document.adoptedStyleSheets);
      sheets.forEach(function (s) {
        try { walk(s, s.cssRules); } catch (e) { /* feuille d'un autre domaine */ }
      });
      document.querySelectorAll('link[media],style[media],source[media]').forEach(function (el) {
        fixAttr(el, 'media', function (v) { return rewriteMedia(v, emu); });
      });
      document.querySelectorAll('[style*="safe-area-inset"]').forEach(function (el) {
        fixAttr(el, 'style', function (v) { return rewriteSafeArea(v, cover ? emu.safe : null); });
      });
    } finally { busy = false; }
  }

  var styleTimer = null;
  function schedule() {
    if (busy || styleTimer) return;
    styleTimer = setTimeout(function () { styleTimer = null; applyStyles(); }, 30);
  }

  // Feuilles ajoutées ou modifiées par la page (Vite, styled-components, emotion…)
  ['insertRule', 'replace', 'replaceSync'].forEach(function (k) {
    var fn = CSSStyleSheet.prototype[k];
    if (!fn) return;
    CSSStyleSheet.prototype[k] = function () {
      var r = fn.apply(this, arguments);
      if (!busy) schedule();
      return r;
    };
  });
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i], t = m.target;
      if (m.type === 'characterData') {
        if (t.parentNode && t.parentNode.nodeName === 'STYLE') return schedule();
        continue;
      }
      if (t.nodeName === 'STYLE') return schedule();
      for (var j = 0; j < m.addedNodes.length; j++) {
        var n = m.addedNodes[j];
        if (n.nodeType !== 1) continue;
        if (/^(STYLE|LINK|META|SOURCE)$/.test(n.nodeName) ||
            n.querySelector('style,link,source,[style*="safe-area-inset"]')) return schedule();
      }
    }
  }).observe(document, { childList: true, subtree: true, characterData: true });
  document.addEventListener('load', function (e) { if (e.target.nodeName === 'LINK') schedule(); }, true);
  addEventListener('DOMContentLoaded', applyStyles);
  addEventListener('load', applyStyles);

  /* ---------- 4. Écran tactile : la souris devient un doigt ---------- */

  if (emu.touch) {
    document.documentElement.classList.add('__dp-touch');
    var canTouch = typeof Touch === 'function' && typeof TouchEvent === 'function';
    var t = null, fling = 0;

    var fire = function (type, e) {
      if (!canTouch || !t) return true;
      try {
        var touch = new Touch({
          identifier: 1, target: t.target, clientX: e.clientX, clientY: e.clientY,
          pageX: e.pageX, pageY: e.pageY, screenX: e.screenX, screenY: e.screenY,
          radiusX: 11, radiusY: 11, force: 1
        });
        var list = type === 'touchend' ? [] : [touch];
        return t.target.dispatchEvent(new TouchEvent(type, {
          bubbles: true, cancelable: true, composed: true, view: window,
          touches: list, targetTouches: list, changedTouches: [touch]
        }));
      } catch (err) { return true; }
    };

    var scrollable = function (el, axis) {
      var s = getComputedStyle(el), o = axis === 'x' ? s.overflowX : s.overflowY;
      if (!/(auto|scroll|overlay)/.test(o)) return false;
      return axis === 'x' ? el.scrollWidth > el.clientWidth : el.scrollHeight > el.clientHeight;
    };
    var scrollerFor = function (el, axis) {
      for (; el && el.nodeType === 1 && el !== document.body && el !== document.documentElement; el = el.parentElement) {
        if (scrollable(el, axis)) return el;
      }
      return document.scrollingElement || document.documentElement;
    };
    // touch-action (pan-x, pan-y, none) décide si le geste fait défiler
    var panAllowed = function (el) {
      var x = true, y = true;
      for (; el && el.nodeType === 1; el = el.parentElement) {
        var ta = getComputedStyle(el).touchAction;
        if (ta === 'none') return { x: false, y: false };
        if (ta === 'auto' || ta === 'manipulation') continue;
        if (!/pan-(x|left|right)/.test(ta)) x = false;
        if (!/pan-(y|up|down)/.test(ta)) y = false;
      }
      return { x: x, y: y };
    };
    var scrollBy2 = function (dx, dy) {
      if (t.pan.x && dx) t.sx.scrollLeft -= dx;
      if (t.pan.y && dy) t.sy.scrollTop -= dy;
    };
    var editable = function (el) {
      return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(el.nodeName));
    };

    addEventListener('mousedown', function (e) {
      cancelAnimationFrame(fling);
      if (e.button !== 0) return;
      t = {
        target: e.target, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, lt: performance.now(),
        vx: 0, vy: 0, drag: false, noScroll: editable(e.target),
        sx: scrollerFor(e.target, 'x'), sy: scrollerFor(e.target, 'y'), pan: panAllowed(e.target)
      };
      if (!fire('touchstart', e)) t.noScroll = true;
    }, true);

    addEventListener('mousemove', function (e) {
      if (!t) return;
      if (!(e.buttons & 1)) { t = null; return; }
      if (!fire('touchmove', e)) t.noScroll = true;
      var dx = e.clientX - t.lx, dy = e.clientY - t.ly, now = performance.now(), dt = now - t.lt;
      t.lx = e.clientX; t.ly = e.clientY; t.lt = now;
      if (!t.drag && Math.hypot(e.clientX - t.x0, e.clientY - t.y0) > 6 && !t.noScroll) {
        t.drag = true;
        document.documentElement.classList.add('__dp-dragging');
        try { getSelection().removeAllRanges(); } catch (err) {}
      }
      if (!t.drag || t.noScroll) return;
      e.preventDefault();
      scrollBy2(dx, dy);
      if (dt > 0) { t.vx = 0.8 * (dx / dt) + 0.2 * t.vx; t.vy = 0.8 * (dy / dt) + 0.2 * t.vy; }
    }, true);

    addEventListener('mouseup', function (e) {
      if (!t || e.button !== 0) return;
      fire('touchend', e);
      var g = t;
      document.documentElement.classList.remove('__dp-dragging');
      if (g.drag) {
        // Un glisser n'est pas un « tap » : on avale le clic qui suit
        var swallow = function (ev) { ev.stopPropagation(); ev.preventDefault(); };
        addEventListener('click', swallow, true);
        setTimeout(function () { removeEventListener('click', swallow, true); }, 0);
        // Inertie, comme sur un téléphone
        if (performance.now() - g.lt < 80) {
          var vx = g.vx, vy = g.vy, last = performance.now();
          var step = function (now) {
            var dt = Math.min(now - last, 32); last = now;
            vx *= Math.pow(0.95, dt / 16); vy *= Math.pow(0.95, dt / 16);
            if (Math.abs(vx) < 0.02 && Math.abs(vy) < 0.02) return;
            t = g; scrollBy2(vx * dt, vy * dt); t = null;
            fling = requestAnimationFrame(step);
          };
          fling = requestAnimationFrame(step);
        }
      }
      t = null;
    }, true);

    // Pas de glisser-déposer de liens ou d'images au doigt
    addEventListener('dragstart', function (e) { e.preventDefault(); }, true);
  }

  /* ---------- 5. Rechargement live ---------- */

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

  try {
    var es = new EventSource('/__dp/events');
    es.onmessage = function (e) {
      var d = JSON.parse(e.data);
      if (d.type === 'css') {
        var links = document.querySelectorAll('link[rel="stylesheet"]'), done = false;
        for (var i = 0; i < links.length; i++) {
          var u = new URL(links[i].href, location.href);
          if (u.origin !== location.origin || u.pathname.indexOf('/__dp/') === 0) continue;
          u.searchParams.set('_dp', Date.now()); links[i].href = u.href; done = true;
        }
        if (done) return;
      }
      try { sessionStorage.setItem(KEY, JSON.stringify([scrollX, scrollY])); } catch (err) {}
      location.reload();
    };
  } catch (e) {}
})();
