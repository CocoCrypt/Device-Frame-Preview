'use strict';
// Fonctions pures (sans dépendance à VS Code) : testées par test/core.test.js.
// rewriteMedia et rewriteSafeArea sont aussi injectées telles quelles dans le
// script client (media/client.js) : elles doivent rester autonomes.

const path = require('path');
const { Transform } = require('stream');

function isInside(root, p) {
  const rel = path.relative(root, p);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

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

// Le script client doit s'exécuter AVANT ceux de la page (user-agent, tactile…) :
// on l'insère juste après <head>, à défaut après <html> ou le doctype.
const CLIENT_TAGS = '<link rel="stylesheet" href="/__dp/client.css"><script src="/__dp/client.js"></script>';

function injectClient(html) {
  for (const re of [/<head\b[^>]*>/i, /<html\b[^>]*>/i, /<!doctype[^>]*>/i]) {
    const m = re.exec(html);
    if (m) {
      const i = m.index + m[0].length;
      return html.slice(0, i) + CLIENT_TAGS + html.slice(i);
    }
  }
  return CLIENT_TAGS + html;
}

/* ---------- Identité des appareils (user-agent) ---------- */

// {chrome} = version majeure du Chromium de VS Code
const PROFILES = {
  ios: {
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
    platform: 'iPhone', vendor: 'Apple Computer, Inc.', hints: null
  },
  // iPadOS se présente comme un Mac (seul maxTouchPoints le trahit), comme en vrai
  ipados: {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    platform: 'MacIntel', vendor: 'Apple Computer, Inc.', hints: null
  },
  android: {
    ua: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome}.0.0.0 Mobile Safari/537.36',
    platform: 'Linux armv81', vendor: 'Google Inc.', hints: { mobile: true, platform: 'Android' }
  },
  'android-tablet': {
    ua: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome}.0.0.0 Safari/537.36',
    platform: 'Linux armv81', vendor: 'Google Inc.', hints: { mobile: false, platform: 'Android' }
  }
};

function chromeMajor(ua) {
  const m = /Chrome\/(\d+)/.exec(ua || '');
  return m ? m[1] : '140';
}

function userAgentFor(profile, baseUa) {
  const p = PROFILES[profile];
  return p ? p.ua.replace('{chrome}', chromeMajor(baseUa)) : null;
}

/** En-têtes de requête vus par le serveur pour un profil donné. */
function profileHeaders(headers, profile) {
  const p = PROFILES[profile];
  if (!p) return headers;
  const h = { ...headers, 'user-agent': userAgentFor(profile, headers['user-agent']) };
  if (p.hints) {
    h['sec-ch-ua-mobile'] = p.hints.mobile ? '?1' : '?0';
    h['sec-ch-ua-platform'] = `"${p.hints.platform}"`;
  } else {
    // Safari n'envoie pas de Client Hints
    for (const k of Object.keys(h)) if (/^sec-ch-ua/.test(k)) delete h[k];
  }
  return h;
}

/* ---------- Media queries et zones sûres (aussi exécutées dans la page) ---------- */

/**
 * Réécrit une media query pour émuler le thème (prefers-color-scheme) et un
 * écran tactile (pointer: coarse, hover: none).
 * emu = { scheme: 'light' | 'dark' | null, touch: boolean }
 */
function rewriteMedia(text, emu) {
  var T = '(min-width: 0px)', F = '(max-width: 0px)';
  return String(text).replace(
    /\(\s*(prefers-color-scheme|any-pointer|pointer|any-hover|hover)\s*(?::\s*([a-z-]+)\s*)?\)/gi,
    function (m, feat, val) {
      feat = feat.toLowerCase(); val = (val || '').toLowerCase();
      if (feat === 'prefers-color-scheme') {
        if (!emu.scheme) return m;
        return !val || val === emu.scheme ? T : F;
      }
      if (!emu.touch) return m;
      if (feat === 'pointer' || feat === 'any-pointer') return !val || val === 'coarse' ? T : F;
      return val === 'none' ? T : F; // (hover) / (hover: hover) sont faux sur un écran tactile
    });
}

/**
 * Remplace env(safe-area-inset-*) par des valeurs en px.
 * safe = { top, right, bottom, left } ou null (→ 0px, comme hors encoche).
 */
function rewriteSafeArea(text, safe) {
  return String(text).replace(
    /(?:env|constant)\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,(?:[^()]|\([^()]*\))*)?\)/gi,
    function (m, side) { return ((safe && safe[side.toLowerCase()]) || 0) + 'px'; });
}

/* ---------- Simulation de réseau lent ---------- */

// Valeurs des préréglages des DevTools de Chrome
const NETWORK_PRESETS = {
  '4g': { latency: 170, kbps: 9000 },
  'slow-4g': { latency: 560, kbps: 1600 },
  '3g': { latency: 2000, kbps: 400 }
};

/** Bande passante partagée par toutes les réponses (comme une vraie connexion). */
function createLimiter(preset) {
  return preset ? { latency: preset.latency, bytesPerMs: preset.kbps / 8, next: 0 } : null;
}

function throttleStream(limiter) {
  return new Transform({
    transform(chunk, enc, cb) {
      const pieces = [];
      for (let i = 0; i < chunk.length; i += 16384) pieces.push(chunk.subarray(i, i + 16384));
      const step = () => {
        if (this.destroyed) return;
        if (!pieces.length) return cb();
        const piece = pieces.shift();
        const now = Date.now();
        limiter.next = Math.max(now, limiter.next) + piece.length / limiter.bytesPerMs;
        setTimeout(() => { if (!this.destroyed) { this.push(piece); step(); } }, limiter.next - now);
      };
      step();
    }
  });
}

module.exports = {
  isInside, stripFrameAncestors, rewriteCookie, injectClient, CLIENT_TAGS,
  PROFILES, chromeMajor, userAgentFor, profileHeaders,
  rewriteMedia, rewriteSafeArea,
  NETWORK_PRESETS, createLimiter, throttleStream
};
