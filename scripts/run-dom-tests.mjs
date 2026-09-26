// scripts/run-dom-tests.mjs
//
// Runner for the Viewer Clash Panel real-browser DOM tests (`npm run test:clashpanel:dom`, which the default gate
// `npm test` runs after the offline suite). Mirrors
// scripts/run-tests.mjs: its own recursive walk (no shell/Node glob), an explicit file list for `node --test`,
// fail-closed on zero files and on a signal-killed child. These files are named `*.dom.mjs` precisely so that
// the OFFLINE suite (`test:offline`, which collects only `*.test.mjs`) never launches Chromium.
//
// A missing Playwright package or Chromium binary is a FAILURE with an actionable message — never a silent skip.
import { readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const ROOT = process.cwd();
const DOM_DIR = join(ROOT, 'test', 'clashpanel', 'dom');

function findDomTests(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) findDomTests(join(dir, entry.name), out);
    else if (entry.isFile() && entry.name.endsWith('.dom.mjs')) out.push(join(dir, entry.name));
  }
  return out;
}

if (!existsSync(DOM_DIR)) {
  console.error(`run-dom-tests.mjs: ${relative(ROOT, DOM_DIR)} does not exist (run from the repository root)`);
  process.exit(1);
}
const files = findDomTests(DOM_DIR).map((f) => relative(ROOT, f)).sort();
if (files.length === 0) {
  console.error('run-dom-tests.mjs: no *.dom.mjs files found under', relative(ROOT, DOM_DIR));
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (error) {
  console.error('run-dom-tests.mjs: the `playwright` devDependency is not installed (run `npm install`).', error?.message ?? '');
  process.exit(1);
}
// Probe with the harness's own launch args: a missing/incompatible browser build fails HERE with one clear message.
try {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote'] });
  await browser.close();
} catch (error) {
  console.error(
    'run-dom-tests.mjs: Playwright could not launch Chromium, so the DOM suite cannot run (this is a FAILURE, not a skip).\n' +
    'Install the browser with `npx playwright install chromium` (see test/acceptance/README.md, "First-time setup").\n' +
    `Launch error: ${String(error?.message ?? error).split('\n')[0]}`,
  );
  process.exit(1);
}

// One browser at a time: each file launches its own single-process Chromium (see harness.mjs).
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
