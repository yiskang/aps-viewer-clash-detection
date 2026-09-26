// test/clashpanel/dom/support/harness.mjs
//
// Real-browser harness for the Viewer Clash Panel DOM tests (*.dom.mjs, run ONLY by `npm run test:clashpanel:dom`
// — which the default gate `npm test` includes — and never collected by the offline suite). One Chromium per withPage() call, closed in `finally`. No TCP server: every request to
// https://panel.test/ is answered by page.route from this repository's files, PATH-CONFINED to SERVED_ROOTS
// (anything else, including any `..` escape, is a 404). https (not http) so the page is a secure context
// (crypto.randomUUID exists, as it does for the real host on https/localhost).
//
// Launch args: see test/acceptance/README.md "Chromium launch args" (--single-process --no-zygote are needed in
// this repo's dev sandbox; harmless elsewhere).
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installAutodeskStub } from './stubAutodesk.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
export const ORIGIN = 'https://panel.test';
export const LAUNCH_ARGS = Object.freeze(['--no-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote']);

// Production clashpanel/ imports nothing outside clashpanel/ (only Node tests import clashtest/), so the page is
// confined to the package itself plus the browser-side test support. Nothing else is reachable.
export const SERVED_ROOTS = Object.freeze(['clashpanel/', 'test/clashpanel/dom/support/']);
const CONTENT_TYPES = Object.freeze({ '.js': 'text/javascript', '.mjs': 'text/javascript' });
const BLANK_PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>clash panel dom test</title></head><body></body></html>';

/** Maps a request pathname to an absolute repo file, or null when it is not servable (fail closed). */
export function resolveServedPath(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const rel = decoded.replace(/^\/+/, '');
  if (rel.split('/').some((seg) => seg === '..' || seg === '.')) return null;
  if (!SERVED_ROOTS.some((root) => rel.startsWith(root))) return null;
  if (!Object.hasOwn(CONTENT_TYPES, path.extname(rel))) return null;
  const abs = path.resolve(REPO_ROOT, rel);
  const within = SERVED_ROOTS.some((root) => abs.startsWith(path.resolve(REPO_ROOT, root) + path.sep));
  return within ? abs : null;
}

async function serve(route) {
  const url = new URL(route.request().url());
  if (url.origin !== ORIGIN) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not served' });
  if (url.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: BLANK_PAGE });
  const abs = resolveServedPath(url.pathname);
  if (abs === null) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not served' });
  try {
    const body = await readFile(abs, 'utf8');
    return route.fulfill({ status: 200, contentType: CONTENT_TYPES[path.extname(abs)], body });
  } catch {
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
  }
}

/**
 * withPage(fn, { allowConsoleErrors = false }) — fn receives { page, consoleErrors, pageErrors }.
 * After fn resolves, console errors and page errors must be empty (unless allowConsoleErrors) — a test that
 * expects some (the confinement negative control) inspects and empties `consoleErrors` itself.
 */
export async function withPage(fn, { allowConsoleErrors = false } = {}) {
  const browser = await chromium.launch({ args: [...LAUNCH_ARGS] });
  try {
    const page = await browser.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => { pageErrors.push(String(err?.message ?? err)); });
    await page.route('**/*', serve);
    await page.addInitScript(installAutodeskStub);
    await page.goto(`${ORIGIN}/`);
    const value = await fn({ page, consoleErrors, pageErrors });
    if (pageErrors.length > 0) throw new Error(`page errors: ${JSON.stringify(pageErrors)}`);
    if (!allowConsoleErrors && consoleErrors.length > 0) throw new Error(`console errors: ${JSON.stringify(consoleErrors)}`);
    return value;
  } finally {
    await browser.close();
  }
}

/** Mounts one renderer (module path + export name) with a recording dispatch; see mount.mjs. */
export async function mountRenderer(page, modulePath, exportName, vmPart) {
  await page.evaluate(async ([m, e, vm]) => {
    const { mount } = await import('/test/clashpanel/dom/support/mount.mjs');
    await mount(m, e, vm);
  }, [modulePath, exportName, vmPart]);
}

/** Re-renders the mounted renderer with a new view-model part (same root, same dispatch). */
export async function rerender(page, vmPart) {
  await page.evaluate((vm) => window.__clash.render(vm), vmPart);
}

/** The intents dispatched so far (JSON copies), in order. */
export async function intents(page) {
  return page.evaluate(() => window.__clash.intents.slice());
}

/** Structured DOM snapshot of the mounted root (tag, key, text, value, checked, disabled, aria-*). */
export async function snapshot(page, selector = '#clash-root') {
  return page.evaluate(async (sel) => {
    const { snapshotDom } = await import('/test/clashpanel/dom/support/mount.mjs');
    return snapshotDom(document.querySelector(sel));
  }, selector);
}
