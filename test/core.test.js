const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
const fs = require('fs');
const { Readable } = require('stream');
const core = require('../lib/core');

test('isInside refuse de sortir du dossier servi', () => {
  const root = path.resolve('/site');
  assert.ok(core.isInside(root, path.join(root, 'a/b.html')));
  assert.ok(core.isInside(root, root));
  assert.ok(!core.isInside(root, path.resolve(root, '../secret.txt')));
  assert.ok(!core.isInside(root, path.resolve('/site-bis/x')));
});

test('stripFrameAncestors ne retire que frame-ancestors', () => {
  assert.equal(
    core.stripFrameAncestors("default-src 'self'; frame-ancestors 'none'; img-src *"),
    "default-src 'self'; img-src *");
});

test('rewriteCookie force SameSite=None; Secure et retire Domain', () => {
  assert.equal(
    core.rewriteCookie('sessionid=abc; Domain=example.com; Path=/; SameSite=Lax; HttpOnly'),
    'sessionid=abc; Path=/; HttpOnly; SameSite=None; Secure');
});

test('injectClient place le script en tête de <head>', () => {
  const out = core.injectClient('<!DOCTYPE html><html><head><title>x</title><script src="app.js"></script></head><body></body></html>');
  assert.ok(out.startsWith('<!DOCTYPE html><html><head>' + core.CLIENT_TAGS));
  assert.ok(out.indexOf(core.CLIENT_TAGS) < out.indexOf('app.js'));
});

test('injectClient sans <head> : après <html>, puis après le doctype', () => {
  assert.equal(core.injectClient('<html lang="fr"><p>x'), '<html lang="fr">' + core.CLIENT_TAGS + '<p>x');
  assert.equal(core.injectClient('<!doctype html><p>x'), '<!doctype html>' + core.CLIENT_TAGS + '<p>x');
  assert.equal(core.injectClient('<p>x'), core.CLIENT_TAGS + '<p>x');
  // <header> n'est pas <head>
  assert.equal(core.injectClient('<header>x</header>'), core.CLIENT_TAGS + '<header>x</header>');
});

test('user-agent et Client Hints par profil', () => {
  const base = { 'user-agent': 'Mozilla/5.0 ... Chrome/138.0.7204.0 Electron/37 Safari/537.36', 'sec-ch-ua': '"Chromium"', 'sec-ch-ua-mobile': '?0' };
  const android = core.profileHeaders(base, 'android');
  assert.match(android['user-agent'], /Android .* Chrome\/138\.0\.0\.0 Mobile Safari/);
  assert.equal(android['sec-ch-ua-mobile'], '?1');
  assert.equal(android['sec-ch-ua-platform'], '"Android"');
  const ios = core.profileHeaders(base, 'ios');
  assert.match(ios['user-agent'], /iPhone; CPU iPhone OS/);
  assert.equal(ios['sec-ch-ua'], undefined);
  assert.equal(core.profileHeaders(base, 'none'), base);
});

test('rewriteMedia : thème sombre forcé', () => {
  const emu = { scheme: 'dark', touch: false };
  assert.equal(core.rewriteMedia('(prefers-color-scheme: dark)', emu), '(min-width: 0px)');
  assert.equal(core.rewriteMedia('screen and (prefers-color-scheme:light)', emu), 'screen and (max-width: 0px)');
  assert.equal(core.rewriteMedia('(hover: hover)', emu), '(hover: hover)'); // pas de tactile
  assert.equal(core.rewriteMedia('(prefers-color-scheme: dark)', { scheme: null }), '(prefers-color-scheme: dark)');
});

test('rewriteMedia : écran tactile', () => {
  const emu = { scheme: null, touch: true };
  assert.equal(core.rewriteMedia('(hover: hover) and (pointer: fine)', emu), '(max-width: 0px) and (max-width: 0px)');
  assert.equal(core.rewriteMedia('(hover: none)', emu), '(min-width: 0px)');
  assert.equal(core.rewriteMedia('(any-pointer: coarse)', emu), '(min-width: 0px)');
  assert.equal(core.rewriteMedia('(min-width: 600px)', emu), '(min-width: 600px)');
});

test('rewriteSafeArea remplace env() et constant(), avec ou sans valeur de repli', () => {
  const safe = { top: 59, right: 0, bottom: 34, left: 0 };
  assert.equal(
    core.rewriteSafeArea('padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom, 20px)', safe),
    'padding: 59px 0 34px');
  assert.equal(core.rewriteSafeArea('top: calc(constant(safe-area-inset-top) + 8px)', safe), 'top: calc(59px + 8px)');
  assert.equal(core.rewriteSafeArea('margin: env(safe-area-inset-left, calc(1px + 2px))', null), 'margin: 0px');
});

test('rewriteMedia / rewriteSafeArea sont autonomes (injectées dans la page)', () => {
  const ctx = {};
  vm.runInNewContext(`var rewriteMedia = ${core.rewriteMedia}; var rewriteSafeArea = ${core.rewriteSafeArea};
    out = [rewriteMedia('(hover: none)', { touch: true }), rewriteSafeArea('env(safe-area-inset-top)', { top: 47 })];`, ctx);
  assert.deepEqual([...ctx.out], ['(min-width: 0px)', '47px']);
});

test('le script client est syntaxiquement valide une fois assemblé', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'media', 'client.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(`(function () {\nvar rewriteMedia = ${core.rewriteMedia};\nvar rewriteSafeArea = ${core.rewriteSafeArea};\n${src}\n})();`));
});

test('throttleStream respecte le débit simulé', async () => {
  const limiter = core.createLimiter({ latency: 0, kbps: 800 }); // 100 octets / ms
  const data = Buffer.alloc(30000, 1);
  const t0 = Date.now();
  const chunks = [];
  await new Promise((resolve, reject) => {
    Readable.from([data]).pipe(core.throttleStream(limiter))
      .on('data', (c) => chunks.push(c)).on('end', resolve).on('error', reject);
  });
  const elapsed = Date.now() - t0;
  assert.equal(Buffer.concat(chunks).length, data.length);
  assert.ok(elapsed >= 250, `trop rapide : ${elapsed} ms`);
});

test('createLimiter sans préréglage : pas de limitation', () => {
  assert.equal(core.createLimiter(undefined), null);
  assert.ok(core.NETWORK_PRESETS['3g'].latency > core.NETWORK_PRESETS['4g'].latency);
});
