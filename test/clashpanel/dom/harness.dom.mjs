// test/clashpanel/dom/harness.dom.mjs — smoke tests of the DOM harness itself (Task 27).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPage, resolveServedPath, REPO_ROOT } from './support/harness.mjs';
import path from 'node:path';

test('the page loads repo ES modules from clashpanel/ in a secure context', () => withPage(async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { PAGE_SIZE, SOFT_UNAVAILABLE_TEXT } = await import('/clashpanel/core/constants.js');
    return { pageSize: PAGE_SIZE, soft: SOFT_UNAVAILABLE_TEXT.length > 0, secure: window.isSecureContext, uuid: typeof crypto.randomUUID };
  });
  assert.deepEqual(r, { pageSize: 50, soft: true, secure: true, uuid: 'function' });
}));

test('textContent of hostile markup is inert (no element, no script execution)', () => withPage(async ({ page }) => {
  const r = await page.evaluate(async () => {
    const d = document.createElement('div');
    d.textContent = '<img src=x onerror=window.__pwned=1><script>window.__pwned=2</script>';
    document.body.appendChild(d);
    await new Promise((res) => requestAnimationFrame(() => res()));
    return { imgs: document.querySelectorAll('img').length, scripts: document.querySelectorAll('body script').length, pwned: window.__pwned === undefined ? null : window.__pwned, text: d.textContent };
  });
  assert.deepEqual(r, { imgs: 0, scripts: 0, pwned: null, text: '<img src=x onerror=window.__pwned=1><script>window.__pwned=2</script>' });
}));

test('route confinement: only clashpanel/ and dom/support are served; escapes and other roots are 404', () => withPage(async ({ page, consoleErrors }) => {
  const statuses = await page.evaluate(async () => {
    const paths = [
      '/clashpanel/core/constants.js',
      '/test/clashpanel/dom/support/mount.mjs',
      '/package.json',
      '/scripts/run-tests.mjs',
      '/test/clashtest/support/index.mjs',
      '/clashtest/index.js',
      '/collision/errors.js',
      '/test/clashpanel/support/fakeEngine.mjs',
      '/clashpanel/..%2fpackage.json',
      '/clashpanel/%2e%2e/scripts/run-tests.mjs',
      '/test/clashpanel/dom/support/..%2f..%2f..%2f..%2fscripts%2frun-tests.mjs',
      '/clashpanel/core/does-not-exist.js',
      '/clashpanel/README.md',
    ];
    const out = {};
    for (const p of paths) out[p] = (await fetch(p)).status;
    out.external = await fetch('https://example.com/').then((r) => r.status, () => 'blocked');
    return out;
  });
  assert.equal(statuses['/clashpanel/core/constants.js'], 200);
  assert.equal(statuses['/test/clashpanel/dom/support/mount.mjs'], 200);
  for (const [p, s] of Object.entries(statuses)) {
    if (p === '/clashpanel/core/constants.js' || p === '/test/clashpanel/dom/support/mount.mjs') continue;
    assert.notEqual(s, 200, `${p} must not be served`);
  }
  // Every refused fetch logs a "Failed to load resource" console error; that is this test's expected evidence.
  assert.ok(consoleErrors.length >= 1);
  consoleErrors.length = 0;
}));

test('resolveServedPath (Node side) rejects traversal, foreign roots and non-JS files', () => {
  assert.equal(resolveServedPath('/clashpanel/core/constants.js'), path.join(REPO_ROOT, 'clashpanel/core/constants.js'));
  for (const p of ['/package.json', '/clashpanel/../package.json', '/clashpanel/..%2fpackage.json', '/clashpanel/%2e%2e%2fpackage.json',
    '/clashpanel/a%00.js', '/clashpanel/README.md', '/test/clashpanel/support/fakeEngine.mjs', '/clashpanelx/a.js', '/%E0%A4%A.js',
    '/clashtest/index.js', '/collision/errors.js']) {
    assert.equal(resolveServedPath(p), null, p);
  }
});

test('stub DockingPanel: initialize before subclass fields, setVisible(false) after initialize, callbacks get booleans', () => withPage(async ({ page }) => {
  const r = await page.evaluate(() => {
    const Base = window.Autodesk.Viewing.UI.DockingPanel;
    const seen = [];
    class Sub extends Base {
      field = 'assigned-after-super';
      initialize() { seen.push(['initialize', this.field]); Base.prototype.initialize.call(this); }
    }
    const host = document.createElement('div');
    document.body.appendChild(host);
    const p = new Sub(host, 'p1', 'T');
    const initialDisplay = p.container.style.display;
    const got = [];
    p.addVisibilityListener((v) => got.push(v));
    p.setVisible(true);
    const vis1 = p.isVisible();
    p.closer.click();
    return { seen, initialDisplay, got, vis1, vis2: p.isVisible(), field: p.field, calls: window.Autodesk.__stubCalls.map((c) => c.op) };
  });
  assert.deepEqual(r.seen, [['initialize', undefined]]);
  assert.equal(r.initialDisplay, 'none');
  assert.deepEqual(r.got, [true, false]);
  assert.equal(r.vis1, true);
  assert.equal(r.vis2, false);
  assert.equal(r.field, 'assigned-after-super');
  assert.deepEqual(r.calls.slice(0, 5), ['construct', 'initialize:base', 'createTitleBar', 'createCloseButton', 'setVisible']);
}));

test('stub DockingPanel: no remove-listener; uninitialize removes and nulls container; setVisible afterwards throws', () => withPage(async ({ page }) => {
  const r = await page.evaluate(() => {
    const Base = window.Autodesk.Viewing.UI.DockingPanel;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const p = new Base(host, 'p2', 'T');
    const hasRemove = typeof p.removeVisibilityListener === 'function';
    p.uninitialize();
    let threw = null;
    try { p.setVisible(true); } catch (e) { threw = e.name; }
    return { hasRemove, container: p.container, inDom: document.getElementById('p2') !== null, threw };
  });
  assert.deepEqual(r, { hasRemove: false, container: null, inDom: false, threw: 'TypeError' });
}));

test('page errors fail withPage (negative control of the default assertion)', async () => {
  await assert.rejects(
    withPage(async ({ page }) => {
      const seen = page.waitForEvent('pageerror');
      await page.evaluate(() => { setTimeout(() => { throw new Error('boom-in-page'); }, 0); });
      await seen;
    }),
    /page errors: .*boom-in-page/,
  );
});
