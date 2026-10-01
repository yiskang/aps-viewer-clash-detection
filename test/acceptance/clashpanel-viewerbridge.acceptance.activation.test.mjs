// test/acceptance/clashpanel-viewerbridge.acceptance.activation.test.mjs
//
// Offline tests for the G2 harness W0 activation interlock and main()'s fail-closed prefix
// (procedure §4.1 "Interlock"; §4.2 "interlock matrix", source-order tests, static import and
// theming guards). Never launches a browser, never imports playwright, never reaches a durable
// act: main() is only invoked with inputs that refuse before record validation.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseLiveActivation,
  main,
  G2RefusalError,
  LIVE_PATH_WIRED,
  isDirectInvocation,
} from './clashpanel-viewerbridge.acceptance.mjs';

const HARNESS_FILE = fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url));
const HARNESS_SOURCE = readFileSync(HARNESS_FILE, 'utf8');

/** Strip // and /* *\/ comments while respecting '...', "..." and `...` literals (static checks). */
function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 2; continue; }
    if (c === '\'' || c === '"' || c === '`') quote = c;
    out += c;
    i += 1;
  }
  return out;
}

const CODE = stripComments(HARNESS_SOURCE);

function mainBody() {
  const start = CODE.indexOf('async function main(');
  assert.ok(start >= 0, 'main() must exist');
  const end = CODE.indexOf('\n}\n', start);
  assert.ok(end > start);
  return CODE.slice(start, end + 2);
}

// Split so this file never matches the repo's own offline-suite browser-package import scan
// (test/clashpanel/domIsolation.test.mjs).
const PKG = ['play', 'wright'].join('');
const DYNAMIC_IMPORT = `import('${PKG}')`;

const FLAG = '--execute-live-g2';
const REC = ['--authorization-record', 'docs/prompts/g2-live-authorization.md'];
const ENV_OK = { G2_LIVE_AUTHORIZED: 'YES' };

// ------------------------------------------------------------------------------------------
// Interlock matrix
// ------------------------------------------------------------------------------------------

test('interlock matrix: all 8 combinations of flag/env/record -- only all three authorize', () => {
  for (const flag of [false, true]) {
    for (const env of [false, true]) {
      for (const rec of [false, true]) {
        const argv = ['node', 'h.mjs', ...(flag ? [FLAG] : []), ...(rec ? REC : [])];
        const r = parseLiveActivation({ argv, env: env ? ENV_OK : {} });
        const missing = [!flag && 'flag', !env && 'env', !rec && 'record'].filter(Boolean);
        if (missing.length === 0) {
          assert.deepEqual(r, { authorized: true, reason: null, recordPath: REC[1] });
        } else {
          assert.deepEqual(r, { authorized: false, reason: `missing:${missing.join(',')}`, recordPath: null });
        }
      }
    }
  }
});

test('interlock: env must be exactly the string YES (no truthy coercion)', () => {
  for (const v of ['yes', 'Yes', 'YES ', ' YES', '1', 'true', '', undefined, null, true]) {
    const r = parseLiveActivation({ argv: [FLAG, ...REC], env: { G2_LIVE_AUTHORIZED: v } });
    assert.equal(r.authorized, false, `value ${JSON.stringify(v)}`);
    assert.equal(r.reason, 'missing:env');
  }
});

test('interlock: record flag value missing, a flag, or duplicated => refused', () => {
  assert.equal(parseLiveActivation({ argv: [FLAG, '--authorization-record'], env: ENV_OK }).reason, 'record-value-missing');
  assert.equal(parseLiveActivation({ argv: [FLAG, '--authorization-record', ''], env: ENV_OK }).reason, 'record-value-missing');
  // the live flag used as the record value is never accepted as a path
  assert.equal(parseLiveActivation({ argv: ['--authorization-record', FLAG], env: ENV_OK }).reason, 'record-value-missing');
  assert.equal(parseLiveActivation({ argv: [FLAG, '--authorization-record', '--x'], env: ENV_OK }).reason, 'record-value-missing');
  assert.equal(parseLiveActivation({ argv: [FLAG, ...REC, ...REC], env: ENV_OK }).reason, 'record-flag-duplicate');
});

test('interlock: near-miss flag spellings and malformed inputs never authorize; never throws', () => {
  for (const f of ['--execute-live-g1', '--execute-live-G2', '--execute-live-g2=1', '-execute-live-g2', 'execute-live-g2']) {
    assert.equal(parseLiveActivation({ argv: [f, ...REC], env: ENV_OK }).authorized, false, f);
  }
  assert.equal(parseLiveActivation().authorized, false);
  assert.equal(parseLiveActivation({ argv: 'x', env: 'y' }).authorized, false);
  assert.equal(parseLiveActivation({ argv: null, env: null }).authorized, false);
  // --authorization-record=<path> form is not accepted (exactly one explicit separate argument).
  assert.equal(parseLiveActivation({ argv: [FLAG, '--authorization-record=docs/prompts/a.md'], env: ENV_OK }).reason, 'missing:record');
});

// ------------------------------------------------------------------------------------------
// main() fail-closed prefix (dynamic)
// ------------------------------------------------------------------------------------------

function trapFs() {
  const calls = [];
  return {
    calls,
    fs: new Proxy({}, { get: (_t, k) => (...a) => { calls.push([k, ...a]); throw new Error(`fs.${String(k)} must not be called`); } }),
  };
}

test('main(): unauthorized => G2RefusalError before any fs/git access', async () => {
  const { calls, fs } = trapFs();
  let gitCalled = false;
  await assert.rejects(
    main({ argv: ['node', 'h'], env: {}, deps: { fs, gitHead: () => { gitCalled = true; return ''; } } }),
    (err) => err instanceof G2RefusalError && err.reason === 'missing:flag,env,record' && err.exitCode === 1,
  );
  assert.deepEqual(calls, []);
  assert.equal(gitCalled, false);
});

test('main(): fully authorized interlock but LIVE_PATH_WIRED=false => refuses before validation/reservation', async () => {
  assert.equal(LIVE_PATH_WIRED, false);
  const { calls, fs } = trapFs();
  await assert.rejects(
    main({ argv: ['node', 'h', FLAG, ...REC], env: ENV_OK, deps: { fs, gitHead: () => { throw new Error('git must not run'); } } }),
    (err) => err instanceof G2RefusalError && err.reason === 'live-path-not-wired',
  );
  assert.deepEqual(calls, [], 'no record read, no attempts-dir access, nothing spent');
});

// ------------------------------------------------------------------------------------------
// Static / source-order guarantees
// ------------------------------------------------------------------------------------------

test('static: no top-level/static playwright import; exactly one dynamic import of the browser package, inside main()', () => {
  assert.doesNotMatch(CODE, new RegExp(`^\\s*import\\s[^;]*['"]${PKG}['"]`, 'm'));
  assert.doesNotMatch(CODE, new RegExp(`require\\(\\s*['"]${PKG}['"]\\s*\\)`));
  const all = CODE.match(new RegExp(`import\\(\\s*['"]${PKG}['"]\\s*\\)`, 'g')) || [];
  assert.equal(all.length, 1);
  assert.ok(mainBody().includes(DYNAMIC_IMPORT));
});

test('source order in main(): interlock -> wiring gate -> dual-counter gate (M2) -> record validation -> startup scan -> W2a -> W2b (AUTH_BOUND) -> playwright', () => {
  const body = mainBody();
  const order = [
    'parseLiveActivation(',
    'if (!activation.authorized)',
    'if (!LIVE_PATH_WIRED)',
    'if (G2_DUAL_COUNTER_GATE.resolved !== true)',
    'validateAuthorizationRecord(',
    'if (!validation.ok)',
    'scanAttemptsDirectoryForStartup(',
    'if (!startup.ok)',
    'establishAttemptsDirectory(',
    'reserveAttempt(',
    DYNAMIC_IMPORT,
  ];
  let last = -1;
  for (const token of order) {
    const idx = body.indexOf(token);
    assert.ok(idx > last, `${token} must appear after the previous step (idx ${idx}, prev ${last})`);
    // each gating step appears exactly once in main
    assert.equal(body.split(token).length - 1, 1, `${token} must appear exactly once in main()`);
    last = idx;
  }
  // chromium / launch / any browser token never before the reservation
  const resIdx = body.indexOf('reserveAttempt(');
  for (const token of ['chromium', 'launch(', 'newPage', 'loadDocumentNode', 'getAccessToken', 'fetch(']) {
    const idx = body.indexOf(token);
    assert.ok(idx === -1 || idx > resIdx, `${token} must not precede reserveAttempt`);
  }
  // no await before reserveAttempt except none: W0-W2 are synchronous
  assert.equal(body.slice(0, resIdx).includes('await '), false, 'nothing asynchronous (no await) before B3');
});

test('static: harness never imports clashpanel/core, engine, catalog, createClashPanel, server.js', () => {
  const specifiers = [...CODE.matchAll(/(?:^|\s)import\s[^;]*?from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1])
    .concat([...CODE.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]));
  for (const s of specifiers) {
    assert.doesNotMatch(s, /clashpanel\/core|engine|catalog|createClashPanel|server(\.js)?$/i, s);
  }
  assert.doesNotMatch(CODE, /createClashPanel/);
});

test('static: the harness issues no theming call', () => {
  assert.doesNotMatch(CODE, /setThemingColor|clearThemingColors/);
});

test('isDirectInvocation: false under the test runner and for foreign argv[1]', () => {
  assert.equal(isDirectInvocation(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url).href, HARNESS_FILE, { NODE_TEST_CONTEXT: 'child' }), false);
  assert.equal(isDirectInvocation(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url).href, '/nonexistent', {}), false);
  assert.equal(isDirectInvocation(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url).href, HARNESS_FILE, {}), true);
});
