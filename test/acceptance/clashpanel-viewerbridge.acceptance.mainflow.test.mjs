// test/acceptance/clashpanel-viewerbridge.acceptance.mainflow.test.mjs
//
// Offline end-to-end DRY RUN of the G2 main flow (procedure §4.1 W0-W3 + Phase 0, §5 phase order,
// §9 cleanup, §9.1 closeout, §8 exit codes) with an ENTIRELY FAKE browser package, page, viewer
// and filesystem. The real harness keeps LIVE_PATH_WIRED=false, so its main() can never get past
// W0 (asserted below). To exercise the wired flow, this file imports a MUTATED COPY of the harness
// written to an os.tmpdir() sandbox with exactly two constants changed -- LIVE_PATH_WIRED=true and
// EXPECTED_VIEWER_SHA256 = the SHA-256 of this file's fake viewer3D.js body -- and drives its
// main() with deps: a recording fake fs, a fake git, a fake module server and a fake browser
// package whose page answers the in-page registry keys. Nothing here imports playwright, launches a
// browser, touches the network, or writes under test/acceptance/results/.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as REAL from './clashpanel-viewerbridge.acceptance.mjs';

const HARNESS_FILE = fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url));
const REAL_SOURCE = readFileSync(HARNESS_FILE, 'utf8');
const sha = (b) => createHash('sha256').update(b).digest('hex');

// ---- the mutated copy (tmp sandbox) -------------------------------------------------------------

const FAKE_VIEWER_BODY = Buffer.from('/* fake viewer3D.js body for the offline dry run */\n');
const WIRED_LINE = 'const LIVE_PATH_WIRED = false;';
const SHA_LINE = `const EXPECTED_VIEWER_SHA256 = '${REAL.EXPECTED_VIEWER_SHA256}';`;
assert.equal(REAL_SOURCE.split(WIRED_LINE).length - 1, 1);
assert.equal(REAL_SOURCE.split(SHA_LINE).length - 1, 1);
const MUTATED_SOURCE = REAL_SOURCE.replace(WIRED_LINE, 'const LIVE_PATH_WIRED = true;').replace(SHA_LINE, `const EXPECTED_VIEWER_SHA256 = '${sha(FAKE_VIEWER_BODY)}';`);
const SANDBOX = mkdtempSync(path.join(os.tmpdir(), 'g2-mainflow-'));
const MUTATED_FILE = path.join(SANDBOX, 'clashpanel-viewerbridge.acceptance.mjs');
writeFileSync(MUTATED_FILE, MUTATED_SOURCE);
const H = await import(pathToFileURL(MUTATED_FILE).href);
after(() => { rmSync(SANDBOX, { recursive: true, force: true }); });

// ---- fixture: repo tree in the fake fs + a valid authorization record ---------------------------

const ROOT = '/repo';
const HEAD = '82dab8244d8d83f3cb824b05199d7a2ce5b0f2e0';
const RECORD = 'docs/prompts/g2-live-authorization.md';
const AUTH_ID = 'g2-live-dryrun-0001';
const PROC_BYTES = 'procedure bytes (stand-in)\n';
const CHAIN = H.resolveAttemptsChain(ROOT);
const JOURNAL_PATH = path.join(CHAIN.D2, H.journalName(AUTH_ID));

function recordText({ harness = MUTATED_SOURCE } = {}) {
  return [
    '# G2 live execution authorization (offline dry-run fixture)', '',
    H.MARKER_LIVE_LINE,
    `Authorization-ID: ${AUTH_ID}`,
    `Baseline-HEAD: ${HEAD}`,
    `Procedure-SHA256: ${sha(Buffer.from(PROC_BYTES))}`,
    `Harness-SHA256: ${sha(Buffer.from(harness))}`,
    `Model-A-URN-SHA256: ${sha(Buffer.from(H.MODEL_A_URN))}`,
    `Model-B-URN-SHA256: ${sha(Buffer.from(H.MODEL_B_URN))}`,
    H.RUNTIME_LINE, '',
  ].join('\n');
}

const FLAG = '--execute-live-g2';
const ARGV = ['node', 'h.mjs', FLAG, '--authorization-record', RECORD];
const ENV = { G2_LIVE_AUTHORIZED: 'YES' };

const PASS_CHECK = () => ({ verdict: 'PASS', reason: null, fields: {}, evidence: {} });

function passRun(over = {}) {
  const checks = {};
  for (const n of H.CHECK_NAMES) checks[n] = PASS_CHECK();
  const controls = {};
  for (const n of H.CONTROL_NAMES) controls[n] = { state: H.CONTROL_ACCEPTABLE_STATE[n], fields: {}, evidence: {} };
  return {
    checks, controls, subchecks: {}, extras: { c4Table: [], sceneOwnership: [], c17: null, c20: null, eventLog: [] },
    spyInstall: null, sessionTainted: false, taintPhase: null, phaseLog: [], spyLedger: [], screenshots: [], stateSnapshots: [],
    staleContinuationsDropped: 0, ...over,
  };
}

const FACTS = Object.freeze({
  loadedCount: 2,
  A: { loaded: true, classification: 'CONFIRMED_SVF2', otg: { available: true, value: true }, svf2: { available: true, value: true }, inAllModels: true, unitScale: 0.3048, unitString: 'ft' },
  B: { loaded: true, classification: 'CONFIRMED_SVF2', otg: { available: true, value: true }, svf2: { available: true, value: true }, inAllModels: true, unitScale: 0.3048, unitString: 'ft' },
});

/** A controllable timers object: a delay in `fireNow` fires on the next macrotask instead of after `ms`. */
function makeTimers(fireNow = []) {
  return {
    setTimeout: (fn, ms) => (fireNow.includes(ms) ? setTimeout(fn, 0) : setTimeout(fn, ms)),
    clearTimeout: (h) => clearTimeout(h),
  };
}

/**
 * The whole fake world. `opts.handlers` override the in-page registry answers; `opts.fault(rec, i,
 * log)` is the fake-fs fault hook; `opts.world` mutates Playwright fakes (launch/goto/... failures).
 */
function makeWorld(opts = {}) {
  const log = [];
  const harnessText = opts.harnessText ?? MUTATED_SOURCE;
  const fs = H.createRecordingFakeFs({
    seedDirs: [`${ROOT}/docs/prompts`, `${ROOT}/docs/research`, `${ROOT}/test/acceptance`, `${ROOT}/node_modules/playwright`],
    seedFiles: {
      [`${ROOT}/${H.PROCEDURE_REL_PATH}`]: PROC_BYTES,
      [`${ROOT}/${H.HARNESS_REL_PATH}`]: harnessText,
      [`${ROOT}/${RECORD}`]: recordText({ harness: harnessText }),
      [`${ROOT}/node_modules/playwright/package.json`]: JSON.stringify({ name: 'playwright', version: '9.99.0-fake' }),
    },
    fault: (rec, i) => {
      log.push({ kind: 'fs', op: rec.op, path: rec.path, to: rec.to || null, flags: rec.flags || null });
      return opts.fault ? opts.fault(rec, i, log) : null;
    },
  });
  const durableJournalStates = () => {
    try {
      const view = fs.osCrashView();
      return JSON.parse(view.readFile(JOURNAL_PATH).toString('utf8')).transitions.map((t) => t.state);
    } catch { return null; }
  };
  const pageEmitter = new EventEmitter();
  const closed = { page: false, context: false, browser: false };
  const routes = [];
  const bindings = {};
  let initScript = null;
  const handlers = {
    g2InstallModules: (specs) => Object.fromEntries(specs.map((s) => [s, { ok: true, exports: ['x'] }])),
    g2AgentReady: () => ({ ok: true, webgl: { available: true, version: 'webgl2' } }),
    g2MarkFatal: (arg) => ({ flag: true, abort: arg && arg.abort === true }),
    g2DocumentLoad: () => ({ status: 'completed' }),
    g2LoadDocumentNode: (arg) => { log.push({ kind: 'journal-at-load', label: arg.label, states: durableJournalStates() }); return { status: 'completed' }; },
    g2AwaitModelReady: () => ({ status: 'ready', tree: true, geometry: true }),
    g2CollectModelFacts: () => JSON.parse(JSON.stringify(FACTS)),
    g2PrepareTargets: () => ({ a1: 11, b1: 22, fitPair: { a: 11, b: 22 }, rule: 'fake' }),
    g2RunPhases: () => passRun(),
    g2CleanupStep: () => ({ ok: true, result: null, error: null, ownershipRemains: false }),
    ...(opts.handlers || {}),
  };
  const page = {
    on: (ev, fn) => pageEmitter.on(ev, fn),
    off: (ev, fn) => pageEmitter.off(ev, fn),
    emit: (ev, ...a) => pageEmitter.emit(ev, ...a),
    async route(pattern, handler) { log.push({ kind: 'pw', call: 'route', pattern }); if (opts.world && opts.world.routeThrows) throw new Error('route failed'); routes.push([pattern, handler]); },
    async exposeFunction(name, fn) { log.push({ kind: 'pw', call: 'exposeFunction', name }); bindings[name] = fn; },
    async addInitScript({ content }) { log.push({ kind: 'pw', call: 'addInitScript' }); initScript = content; },
    async goto(url) {
      log.push({ kind: 'pw', call: 'goto', url });
      if (opts.world && opts.world.gotoHangs) return new Promise(() => {});
      if (opts.world && opts.world.gotoThrows) throw new Error('goto failed');
      if (!(opts.world && opts.world.noViewerResponse)) {
        const req = { resourceType: () => 'script', redirectedFrom: () => null, url: () => H.G2_VIEWER_SCRIPT_URL };
        pageEmitter.emit('response', { request: () => req, status: () => 200, fromServiceWorker: () => false, body: async () => FAKE_VIEWER_BODY });
      }
    },
    async waitForFunction() { log.push({ kind: 'pw', call: 'waitForFunction' }); if (opts.world && opts.world.bootstrapThrows) throw new Error('bootstrap not ready'); return true; },
    async evaluate(fn, payload) {
      assert.equal(fn, H.G2_PAGE_DISPATCH, 'every page call goes through the single registry dispatcher');
      log.push({ kind: 'rpc', key: payload.key, arg: payload.arg });
      const h = handlers[payload.key];
      if (typeof h !== 'function') throw new Error(`no fake handler for ${payload.key}`);
      return h(payload.arg, { page, log });
    },
    async screenshot() { return Buffer.from('png'); },
    async close() { log.push({ kind: 'pw', call: 'page.close' }); closed.page = true; pageEmitter.emit('close'); },
    isClosed: () => closed.page,
  };
  const context = {
    async newPage() { log.push({ kind: 'pw', call: 'newPage' }); if (opts.world && opts.world.newPageThrows) throw new Error('newPage failed'); return page; },
    async close() { log.push({ kind: 'pw', call: 'context.close' }); closed.context = true; },
  };
  const browserEmitter = new EventEmitter();
  const browser = {
    version: () => '999.0.0.0-fake',
    on: (ev, fn) => browserEmitter.on(ev, fn),
    off: (ev, fn) => browserEmitter.off(ev, fn),
    async newContext(o) { log.push({ kind: 'pw', call: 'newContext', options: o }); if (opts.world && opts.world.contextThrows) throw new Error('context failed'); return context; },
    async close() { log.push({ kind: 'pw', call: 'browser.close' }); closed.browser = true; browserEmitter.emit('disconnected'); },
    isConnected: () => !closed.browser,
  };
  let browserPackage = {
    chromium: {
      async launch() { log.push({ kind: 'pw', call: 'launch' }); if (opts.world && opts.world.launchThrows) throw new Error('launch failed'); return browser; },
    },
  };
  if (opts.world && opts.world.importRejects) browserPackage = { then: (_res, rej) => rej(new Error('browser package import failed')) };
  const print = [];
  const proc = new EventEmitter();
  const deps = {
    fs, repoRoot: ROOT,
    gitHead: () => { log.push({ kind: 'git', args: ['rev-parse', 'HEAD'], at: 'W1' }); return HEAD; },
    git: (args) => {
      log.push({ kind: 'git', args });
      if (opts.gitOverride) { const v = opts.gitOverride(args); if (v !== undefined) return v; }
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main\n';
      if (args[0] === 'rev-parse') return `${HEAD}\n`;
      return '';
    },
    serveModule: ({ requestUrl, manifest }) => {
      log.push({ kind: 'serve', requestUrl });
      if (opts.serveFails) return { status: 404, body: '', reason: 'fake-404' };
      const bytes = Buffer.from(`// fake module ${requestUrl}\n`);
      const digest = manifest ? manifest.record(requestUrl, bytes) : sha(bytes);
      return { status: 200, contentType: 'text/javascript; charset=utf-8', body: bytes, sha256: digest, repoRelative: requestUrl };
    },
    browserPackage,
    commitFs: { linkSync: H.brandSyncLinkForTest((a, b) => fs.link(a, b)) },
    allowTestLinkPrimitive: true,
    timers: makeTimers(opts.fireNow || []),
    print: (l) => { print.push(l); },
    proc,
    onEvent: (e) => { log.push({ kind: 'event', ...e }); },
  };
  return { fs, log, deps, page, browser, closed, routes, bindings, print, proc, handlers, getInitScript: () => initScript, durableJournalStates };
}

async function runMain(w) {
  return H.main({ argv: ARGV, env: ENV, deps: w.deps });
}

function readerVerdict(w) {
  return H.deriveVerdictFromArtifacts({ ...H.readArtifactFileMap({ fs: w.fs.processCrashView(), chain: CHAIN }), authorizationId: AUTH_ID });
}

const idx = (log, pred) => log.findIndex(pred);
const isJournalRename = (e) => e.kind === 'fs' && e.op === 'rename' && e.to === JOURNAL_PATH;

// ------------------------------------------------------------------------------------------
// The real harness: LIVE_PATH_WIRED=false => nothing is read, written, imported or launched.
// ------------------------------------------------------------------------------------------

test('real harness: LIVE_PATH_WIRED is false and main() refuses right after W0 with no fs/git/browser/event activity', async () => {
  assert.equal(REAL.LIVE_PATH_WIRED, false);
  const calls = [];
  const trapFs = new Proxy({}, { get: (_t, k) => (...a) => { calls.push(['fs', String(k), ...a]); throw new Error('fs must not be touched'); } });
  const trapPkg = new Proxy({}, { get: (_t, k) => { calls.push(['browserPackage', String(k)]); throw new Error('browser package must not be touched'); } });
  await assert.rejects(
    REAL.main({ argv: ARGV, env: ENV, deps: { fs: trapFs, repoRoot: ROOT, gitHead: () => { calls.push(['gitHead']); return HEAD; }, git: () => { calls.push(['git']); return ''; }, browserPackage: trapPkg, onEvent: (e) => calls.push(['event', e]), serveModule: () => { calls.push(['serve']); } } }),
    (err) => err instanceof REAL.G2RefusalError && err.reason === 'live-path-not-wired',
  );
  assert.deepEqual(calls, []);
});

test('mutated copy differs from the real harness in exactly the two constants', () => {
  const a = REAL_SOURCE.split('\n');
  const b = MUTATED_SOURCE.split('\n');
  assert.equal(a.length, b.length);
  const diff = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i !== null);
  assert.equal(diff.length, 2);
  assert.equal(H.LIVE_PATH_WIRED, true);
});

// ------------------------------------------------------------------------------------------
// Happy path + order: interlock -> W1 -> W2 (AUTH_BOUND) -> import -> W3 -> first loadDocumentNode
// ------------------------------------------------------------------------------------------

test('dry run: all-PASS fake session commits K; exit 0; reader PASS; exact §4.1 order of effects', async () => {
  const w = makeWorld();
  const r = await runMain(w);
  assert.equal(r.finalOverall, 'PASS', JSON.stringify(r.closeout && r.closeout.causes));
  assert.equal(r.exitCode, 0);
  assert.equal(r.consumed, true);
  assert.equal(readerVerdict(w).verdict, 'PASS');
  const log = w.log;
  const recordRead = idx(log, (e) => e.kind === 'fs' && e.op === 'readFile' && e.path === `${ROOT}/${RECORD}`);
  const reservationWx = idx(log, (e) => e.kind === 'fs' && e.op === 'open' && e.flags === 'wx' && e.path.endsWith(H.reservationName(AUTH_ID)));
  const renames = log.map((e, i) => (isJournalRename(e) ? i : -1)).filter((i) => i >= 0);
  const imported = idx(log, (e) => e.kind === 'event' && e.type === 'browser-package-imported');
  const launched = idx(log, (e) => e.kind === 'pw' && e.call === 'launch');
  const consumedEvent = idx(log, (e) => e.kind === 'event' && e.type === 'attempt-consumed');
  const firstDocLoad = idx(log, (e) => e.kind === 'rpc' && e.key === 'g2DocumentLoad');
  const firstNodeLoad = idx(log, (e) => e.kind === 'rpc' && e.key === 'g2LoadDocumentNode');
  assert.ok(recordRead >= 0 && reservationWx > recordRead, 'W1 record read before the W2b reservation');
  assert.ok(renames.length >= 3, 'AUTH_BOUND, ATTEMPT_CONSUMED, CLOSEOUT_STARTED journal writes');
  assert.ok(renames[0] > reservationWx, 'AUTH_BOUND journal after the reservation');
  assert.ok(imported > renames[0], 'browser package imported only after AUTH_BOUND is durable');
  assert.ok(launched > imported);
  assert.ok(renames[1] > launched, 'ATTEMPT_CONSUMED after Phase 0');
  assert.ok(consumedEvent > renames[1]);
  assert.ok(firstDocLoad > renames[1] && firstNodeLoad > renames[1], 'no model-loading action before ATTEMPT_CONSUMED');
  // At the instant of each loadDocumentNode the OS-crash (fsync-durable) journal already ends at ATTEMPT_CONSUMED.
  const atLoad = log.filter((e) => e.kind === 'journal-at-load');
  assert.deepEqual(atLoad.map((e) => e.label), ['A', 'B'], 'loads ordered A then B, one per fixture');
  for (const e of atLoad) assert.deepEqual(e.states, ['AUTH_BOUND', 'ATTEMPT_CONSUMED']);
  // Phase-0 step order (§4.1).
  const steps = log.filter((e) => e.kind === 'event' && e.type === 'phase0-step').map((e) => e.step);
  assert.deepEqual(steps, ['evidence-writer', 'harness-sha256', 'git-tree', 'served-module-manifest', 'page-agent-build', 'browser-package-import', 'browser-launch', 'context-create', 'page-create', 'route-setup', 'goto', 'bootstrap-ready', 'module-install', 'agent-ready']);
  // browser context options (§4.1 Phase 0) and cleanup closes everything.
  const ctxCall = log.find((e) => e.kind === 'pw' && e.call === 'newContext');
  assert.deepEqual(ctxCall.options, { serviceWorkers: 'block', deviceScaleFactor: 1 });
  assert.deepEqual(w.closed, { page: true, context: true, browser: true });
  // Only registered keys were called, and the init script is the page agent built from the bound harness bytes.
  for (const e of log.filter((x) => x.kind === 'rpc')) assert.ok(H.G2_IN_PAGE_FUNCTION_NAMES.includes(e.key));
  assert.equal(w.getInitScript(), H.buildPageAgentSource(MUTATED_SOURCE).source);
  // The run state recorded the runtime envelope honestly (fake versions, nothing fabricated).
  assert.equal(r.state.runtimeEnvelope.chromium, '999.0.0.0-fake');
  assert.equal(r.state.runtimeEnvelope.playwright, '9.99.0-fake');
  assert.equal(r.state.script.integrityResult, 'VERIFIED');
  // Cleanup ran every §9 step in order: page-owned via the registry, Node-owned directly.
  const cleanupKeys = log.filter((e) => e.kind === 'rpc' && e.key === 'g2CleanupStep').map((e) => e.arg.name);
  assert.deepEqual(cleanupKeys, [...H.G2_PAGE_CLEANUP_STEPS]);
  assert.deepEqual(Object.keys(r.state.cleanupStepStatus), [...H.CLEANUP_STEP_NAMES]);
  assert.equal(r.state.cleanupFailures.length, 0);
  // Process-level handlers were installed on the injected process object only.
  assert.equal(w.proc.listenerCount('unhandledRejection'), 1);
  r.uninstallProcessHandlers();
  assert.equal(w.proc.listenerCount('unhandledRejection'), 0);
});

test('static source order: runPostReservation imports the browser package only after the pre-import Phase-0 steps, and W3 precedes every load RPC', () => {
  const start = REAL_SOURCE.indexOf('async function runPostReservation(');
  const end = REAL_SOURCE.indexOf('\n}\n', start);
  const body = REAL_SOURCE.slice(start, end);
  const at = (tok) => { const i = body.indexOf(tok); assert.ok(i >= 0, tok); return i; };
  const order = ["p0('evidence-writer'", "p0('harness-sha256'", "p0('git-tree'", "p0('served-module-manifest'", "p0('page-agent-build'", 'importBrowserPackage()', "p0('browser-launch'", 'chromium.launch()', 'markAttemptConsumed(attempt)', "'g2DocumentLoad'", "'g2LoadDocumentNode'", "'g2RunPhases'", 'runCleanup(', 'closeoutProtocol('];
  let last = -1;
  for (const tok of order) { const i = at(tok); assert.ok(i > last, `${tok} must follow the previous step`); last = i; }
  assert.equal(body.split('markAttemptConsumed(').length - 1, 1);
  assert.equal(body.split('importBrowserPackage()').length - 1, 1);
  // main(): runPostReservation is reached only after reserveAttempt, and holds the one dynamic import.
  const mStart = REAL_SOURCE.indexOf('async function main(');
  const mBody = REAL_SOURCE.slice(mStart, REAL_SOURCE.indexOf('\n}\n', mStart));
  assert.ok(mBody.indexOf('runPostReservation(') > mBody.indexOf('reserveAttempt('));
  assert.ok(mBody.indexOf(`import('${['play', 'wright'].join('')}')`) > mBody.indexOf('reserveAttempt('));
});

// ------------------------------------------------------------------------------------------
// Fault injection before B3: W1 / W2 failures never reach the browser package.
// ------------------------------------------------------------------------------------------

test('fault: W1 record rejected => refusal, nothing written, no import', async () => {
  const w = makeWorld();
  w.deps.gitHead = () => '0'.repeat(40);
  await assert.rejects(runMain(w), (err) => err instanceof H.G2RefusalError);
  assert.equal(w.log.some((e) => e.kind === 'fs' && ['open', 'mkdir', 'rename', 'write', 'link'].includes(e.op)), false);
  assert.equal(w.log.some((e) => e.kind === 'event' || e.kind === 'pw' || e.kind === 'rpc'), false);
});

test('fault: every W2a/W2b durability op => G2DurabilityError, no import, no browser', async () => {
  const base = makeWorld();
  await runMain(base);
  const firstImport = idx(base.log, (e) => e.kind === 'event' && e.type === 'browser-package-imported');
  const w2Ops = base.log.slice(0, firstImport).filter((e) => e.kind === 'fs' && ['mkdir', 'open', 'write', 'fsync', 'close', 'rename'].includes(e.op));
  assert.ok(w2Ops.length > 8);
  for (let k = 0; k < w2Ops.length; k += 1) {
    const target = w2Ops[k];
    // temp names carry a fresh UUID per run: match the k-th W2 op by position among W2-kind ops.
    let n = -1;
    let armed = true;
    const w = makeWorld({ fault: (rec) => {
      if (!armed || !['mkdir', 'open', 'write', 'fsync', 'close', 'rename'].includes(rec.op)) return null;
      n += 1;
      if (n === k) { armed = false; assert.equal(rec.op, target.op); return 'error'; }
      return null;
    } });
    await assert.rejects(runMain(w), (err) => err instanceof H.G2DurabilityError || err instanceof H.G2RefusalError, `op ${k} ${target.op} ${target.path}`);
    assert.equal(w.log.some((e) => (e.kind === 'event' && e.type === 'browser-package-imported') || e.kind === 'pw' || e.kind === 'rpc'), false, `op ${k}`);
  }
});

// ------------------------------------------------------------------------------------------
// Phase-0 fault at every step => PREFLIGHT_FAILED (best-effort), exit 1, NOT consumed, no load.
// ------------------------------------------------------------------------------------------

const PHASE0_FAULTS = [
  ['evidence-writer', { fault: (rec, _i, log) => (rec.op === 'lstat' && rec.path === CHAIN.D1 && log.some(isJournalRename) ? 'error' : null) }],
  ['harness-sha256', { fault: (rec, _i, log) => (rec.op === 'readFile' && rec.path === `${ROOT}/${H.HARNESS_REL_PATH}` && log.some(isJournalRename) ? 'error' : null) }],
  ['git-tree', { gitOverride: (args) => (args[0] === 'status' ? ' M clashpanel/viewer/ViewerBridge.js\n' : undefined) }],
  ['git-tree', { gitOverride: (args) => (args[0] === 'rev-parse' && args[1] === 'HEAD' ? `${'1'.repeat(40)}\n` : undefined) }],
  ['served-module-manifest', { serveFails: true }],
  ['page-agent-build', { harnessText: 'harness text without the page-agent markers\n' }],
  ['browser-package-import', { world: { importRejects: true } }],
  ['browser-launch', { world: { launchThrows: true } }],
  ['context-create', { world: { contextThrows: true } }],
  ['page-create', { world: { newPageThrows: true } }],
  ['route-setup', { world: { routeThrows: true } }],
  ['goto', { world: { gotoThrows: true } }],
  ['goto', { world: { gotoHangs: true }, fireNow: [30_000] }],
  ['bootstrap-ready', { world: { bootstrapThrows: true } }],
  ['module-install', { handlers: { g2InstallModules: (specs) => Object.fromEntries(specs.map((s, i) => [s, i === 1 ? { ok: false } : { ok: true }])) } }],
  ['agent-ready', { handlers: { g2AgentReady: () => ({ ok: false }) } }],
];

for (const [step, opts] of PHASE0_FAULTS) {
  test(`Phase-0 fault at ${step}${opts.fireNow ? ' (T1 deadline)' : ''} => PREFLIGHT_FAILED, exit 1, not consumed, no model load`, async () => {
    const w = makeWorld(opts);
    const r = await runMain(w);
    assert.equal(r.finalOverall, 'FAIL');
    assert.equal(r.exitCode, 1);
    assert.equal(r.consumed, false);
    assert.equal(r.phase0.step, step);
    const states = w.durableJournalStates();
    assert.deepEqual(states, ['AUTH_BOUND', 'PREFLIGHT_FAILED']);
    const journal = JSON.parse(w.fs.processCrashView().readFile(JOURNAL_PATH).toString('utf8'));
    assert.equal(journal.transitions[1].detail.step, step);
    assert.equal(journal.transitions[1].detail.category, 'phase0');
    assert.equal(w.log.some((e) => e.kind === 'rpc' && (e.key === 'g2DocumentLoad' || e.key === 'g2LoadDocumentNode')), false);
    assert.equal(w.log.some((e) => e.kind === 'event' && e.type === 'attempt-consumed'), false);
    const importAt = idx(w.log, (e) => e.kind === 'event' && e.type === 'browser-package-imported');
    const preImport = ['evidence-writer', 'harness-sha256', 'git-tree', 'served-module-manifest', 'page-agent-build', 'browser-package-import'].includes(step);
    assert.equal(importAt === -1, preImport, 'the browser package is imported only once the pre-import steps passed');
    if (w.log.some((e) => e.kind === 'pw' && e.call === 'launch') && !opts.world?.launchThrows) assert.equal(w.closed.browser, true, 'a launched browser is closed on a Phase-0 failure');
    assert.equal(readerVerdict(w).verdict, 'FAIL');
    assert.ok(w.print.some((l) => l.includes('NOT consumed')));
  });
}

test('W3 durable write failure => journal stays AUTH_BOUND, no loadDocumentNode, exit 1', async () => {
  let renames = 0;
  const w = makeWorld({ fault: (rec) => { if (rec.op === 'rename' && rec.to === JOURNAL_PATH) { renames += 1; if (renames === 2) return 'error'; } return null; } });
  const r = await runMain(w);
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.exitCode, 1);
  assert.equal(r.consumed, false);
  assert.ok(r.w3Failure);
  assert.deepEqual(w.durableJournalStates(), ['AUTH_BOUND']);
  assert.equal(w.log.some((e) => e.kind === 'rpc' && (e.key === 'g2DocumentLoad' || e.key === 'g2LoadDocumentNode')), false);
  assert.deepEqual(w.closed, { page: true, context: true, browser: true });
});

// ------------------------------------------------------------------------------------------
// After consumption: verdict mapping and faults (each run commits or fails closed; reader agrees).
// ------------------------------------------------------------------------------------------

async function consumedRun(opts) {
  const w = makeWorld(opts);
  const r = await runMain(w);
  assert.equal(r.consumed, true);
  return { w, r, reader: readerVerdict(w) };
}

test('exit-code mapping through the whole flow: BLOCKED 2, PARTIAL 3, FAIL 1 -- harness and reader agree', async () => {
  // BLOCKED: no attributable viewer3D.js response => PROVENANCE_AMBIGUOUS (row 6).
  let x = await consumedRun({ world: { noViewerResponse: true } });
  assert.equal(x.r.finalOverall, 'BLOCKED');
  assert.equal(x.r.exitCode, 2);
  assert.equal(x.reader.verdict, 'BLOCKED');
  // PARTIAL: a NOT_EVIDENCED check (row 7).
  x = await consumedRun({ handlers: { g2RunPhases: () => { const run = passRun(); run.checks.C5 = H.makeCheckRecord({ verdict: 'NOT_EVIDENCED', reason: 'values-not-captured' }); return run; } } });
  assert.equal(x.r.finalOverall, 'PARTIAL');
  assert.equal(x.r.exitCode, 3);
  assert.equal(x.reader.verdict, 'PARTIAL');
  // FAIL: a check FAIL (row 3), committed as FAIL through K.
  x = await consumedRun({ handlers: { g2RunPhases: () => { const run = passRun(); run.checks.C7 = H.makeCheckRecord({ verdict: 'FAIL', reason: 'ii' }); return run; } } });
  assert.equal(x.r.finalOverall, 'FAIL');
  assert.equal(x.r.exitCode, 1);
  assert.equal(x.r.closeout.committed, true);
  assert.equal(x.reader.verdict, 'FAIL');
});

test('model A load failure => B still loaded after A (order A then B); A unloadable => row 6 BLOCKED', async () => {
  const { w, r } = await consumedRun({
    handlers: {
      g2DocumentLoad: (arg) => (arg.label === 'A' ? { status: 'failed', error: { name: 'DocumentLoadError', message: 'x' } } : { status: 'completed' }),
      g2CollectModelFacts: () => ({ ...JSON.parse(JSON.stringify(FACTS)), A: { ...FACTS.A, loaded: false } }),
    },
  });
  const docLoads = w.log.filter((e) => e.kind === 'rpc' && e.key === 'g2DocumentLoad').map((e) => e.arg.label);
  assert.deepEqual(docLoads, ['A', 'B']);
  assert.deepEqual(w.log.filter((e) => e.kind === 'rpc' && e.key === 'g2LoadDocumentNode').map((e) => e.arg.label), ['B']);
  assert.equal(r.state.runtime.A.loaded, false);
  assert.equal(r.finalOverall, 'BLOCKED');
});

test('in-page phase run throws => every check BLOCKED, session tainted, controls not executable => FAIL row 4 (never PASS; §7 literal)', async () => {
  const { r, reader } = await consumedRun({ handlers: { g2RunPhases: () => { throw new Error('page crashed'); } } });
  assert.equal(r.state.sessionTainted, true);
  assert.ok(Object.values(r.state.checks).every((c) => c.verdict === 'BLOCKED(phase-run-threw)'));
  // §7: NOT_EXECUTABLE / NOT_DETECTED controls are non-acceptable => §8 row 4 FAIL (the X4 reading flagged by Task 4).
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.closeout.primaryRow, 4);
  assert.equal(reader.verdict, 'FAIL');
});

test('page records are re-validated Node-side: an invalid check record fails closed', async () => {
  const { r } = await consumedRun({ handlers: { g2RunPhases: () => { const run = passRun(); run.checks.C9 = { verdict: 'MAYBE' }; delete run.controls.N4; return run; } } });
  assert.equal(r.state.checks.C9.verdict, 'BLOCKED(invalid-or-missing-page-record)');
  assert.equal(r.state.controls.N4.state, 'NOT_DETECTED');
  assert.equal(r.finalOverall, 'FAIL');
});

test('fatal page event during the phase run => row 1 FAIL committed through K; the page fatal latch is set', async () => {
  const { w, r, reader } = await consumedRun({ handlers: { g2RunPhases: (_a, { page }) => { page.emit('pageerror', new Error('Bearer abc.def leaked?')); return passRun(); } } });
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.closeout.primaryRow, 1);
  assert.equal(r.closeout.committed, true);
  assert.equal(reader.verdict, 'FAIL');
  assert.equal(r.state.errorLedger.fatalCount, 1);
  assert.doesNotMatch(r.state.errorLedger.entries[0].detail, /abc\.def/, 'fatal detail is redacted');
  assert.ok(w.log.some((e) => e.kind === 'rpc' && e.key === 'g2MarkFatal'));
});

test('console.error and request failures are fatal (empty allow-list); page close during cleanup is not', async () => {
  const { r } = await consumedRun({
    handlers: {
      g2RunPhases: (_a, { page }) => {
        page.emit('console', { type: () => 'error', text: () => 'viewer noise' });
        page.emit('requestfailed', { url: () => 'https://x.invalid/a?token=secret', resourceType: () => 'xhr' });
        page.emit('console', { type: () => 'warning', text: () => 'not fatal' });
        return passRun();
      },
    },
  });
  assert.deepEqual(r.state.errorLedger.entries.map((e) => e.kind), ['console.error', 'required-resource-failure']);
  assert.doesNotMatch(JSON.stringify(r.state.errorLedger), /secret/);
});

test('T9 whole-attempt cap expiry => ATTEMPT_DEADLINE (row 5 FAIL), page abort latch requested', async () => {
  const { w, r } = await consumedRun({ fireNow: [H.TABLE_T.T9.wholeAttemptCapMs], handlers: { g2RunPhases: async () => { await new Promise((res) => setTimeout(res, 20)); return passRun(); } } });
  assert.equal(r.state.errorLedger.attemptDeadlineExpired, true);
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.closeout.primaryRow, 5);
  assert.ok(w.log.some((e) => e.kind === 'rpc' && e.key === 'g2MarkFatal' && e.arg.abort === true));
});

// H1 (internal review 2026-10-01): a T9 cap that elapses while its timer callback has NOT been
// dispatched (disarm() at closeout step 1 clears it first) must still end FAIL -- never commit PASS.
// The T9 timer here never dispatches; the injected clock jumps across the cap instead.
function overdueT9World({ shiftAtArm, shiftAfterPhases }) {
  const CAP = H.TABLE_T.T9.wholeAttemptCapMs;
  let shift = shiftAtArm;
  const w = makeWorld({ handlers: { g2RunPhases: () => { shift = shiftAfterPhases; return passRun(); } } });
  const DUMMY = Object.freeze({ neverDispatched: true });
  w.deps.timers = {
    setTimeout: (fn, ms) => (ms === CAP ? DUMMY : setTimeout(fn, ms)),
    clearTimeout: (h) => { if (h !== DUMMY) clearTimeout(h); },
  };
  w.deps.clock = { nowIso: () => new Date().toISOString(), monotonicMs: () => performance.now() + shift };
  return w;
}

test('H1: T9 overdue but never dispatched (clock past cap at closeout step 1) => row 5 ATTEMPT_DEADLINE FAIL, never PASS', async () => {
  const w = overdueT9World({ shiftAtArm: 0, shiftAfterPhases: H.TABLE_T.T9.wholeAttemptCapMs + 5000 });
  const r = await runMain(w);
  assert.equal(r.consumed, true);
  assert.equal(r.state.errorLedger.attemptDeadlineExpired, true);
  assert.equal(r.closeout.primaryRow, 5);
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.exitCode, 1);
  assert.equal(readerVerdict(w).verdict, 'FAIL');
});

test('H1: an armed T9 is always handed to the pre-link gate; overdue on the performance.now() basis => late-verdict-change(deadline-overdue), no link', async () => {
  // deadlineAbs lands in the real performance.now() past, so the gate's own re-check sees it overdue.
  const CAP = H.TABLE_T.T9.wholeAttemptCapMs;
  const w = overdueT9World({ shiftAtArm: -(CAP + 5000), shiftAfterPhases: 0 });
  const r = await runMain(w);
  assert.equal(r.consumed, true);
  assert.equal(r.closeout.committed, false);
  assert.ok(r.closeout.causes.includes('late-verdict-change(deadline-overdue)'), JSON.stringify(r.closeout.causes));
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.exitCode, 1);
  assert.equal(readerVerdict(w).verdict, 'FAIL');
});

test('cleanup: unresolved ownership after a failed page step => row 2 FAIL; a failed-but-resolved step => PARTIAL at best', async () => {
  let x = await consumedRun({ handlers: { g2CleanupStep: (arg) => (arg.name === 'unloadModelB' ? { ok: false, result: null, error: { name: 'Error', message: 'still loaded' }, ownershipRemains: true } : { ok: true, result: null, ownershipRemains: false }) } });
  assert.equal(x.r.state.cleanupUnresolvedOwnership, true);
  assert.equal(x.r.finalOverall, 'FAIL');
  assert.equal(x.r.closeout.primaryRow, 2);
  x = await consumedRun({ handlers: { g2CleanupStep: (arg) => (arg.name === 'showHiddenNodes' ? { ok: false, result: null, error: { name: 'Error', message: 'x' }, ownershipRemains: false } : { ok: true, result: null, ownershipRemains: false }) } });
  assert.equal(x.r.state.cleanupUnresolvedOwnership, false);
  assert.deepEqual(x.r.state.cleanupFailures.map((f) => [f.step, f.ownership]), [['showHiddenNodes', 'resolved']]);
  assert.equal(x.r.finalOverall, 'PARTIAL');
  // A page step whose ownership re-check itself is unknown => indeterminate (never unresolved, never resolved).
  x = await consumedRun({ handlers: { g2CleanupStep: (arg) => (arg.name === 'bridgeDispose' ? { ok: false, result: null, error: { name: 'Error', message: 'x' }, ownershipRemains: null } : { ok: true, result: null, ownershipRemains: false }) } });
  assert.deepEqual(x.r.state.cleanupFailures.map((f) => [f.step, f.ownership]), [['bridgeDispose', 'indeterminate']]);
});

test('closeout write fault (R1) => closeout failure: F written, journal FAILED, exit 1, reader FAIL', async () => {
  const R1_DIR = CHAIN.D1;
  const { w, r, reader } = await consumedRun({ fault: (rec) => (rec.op === 'open' && rec.flags === 'wx' && rec.path.startsWith(`${R1_DIR}/${H.R1_NAME}`) ? 'error' : null) });
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.exitCode, 1);
  assert.equal(r.closeout.committed, false);
  assert.ok(r.closeout.causes.includes('r1-write'), JSON.stringify(r.closeout.causes));
  assert.equal(reader.verdict, 'FAIL');
  const files = H.readArtifactFileMap({ fs: w.fs.processCrashView(), chain: CHAIN });
  assert.ok(files.attempts[H.closeoutFailureName(AUTH_ID)]);
  assert.equal(files.attempts[H.commitName(AUTH_ID)], undefined);
});

test('EvidenceCapError (a verdict-critical field over the 4 KiB cap) => closeout failure evidence-cap:..., exit 1, no K', async () => {
  const { w, r, reader } = await consumedRun({ handlers: { g2RunPhases: () => passRun({ extras: { c4Table: [], sceneOwnership: [{ scene: 'x'.repeat(5000) }], c17: null, c20: null, eventLog: [] } }) } });
  assert.equal(r.finalOverall, 'FAIL');
  assert.ok(r.closeout.causes.includes('evidence-cap:verdict-critical-field-over-cap'), JSON.stringify(r.closeout.causes));
  assert.equal(reader.verdict, 'FAIL');
  assert.equal(H.readArtifactFileMap({ fs: w.fs.processCrashView(), chain: CHAIN }).attempts[H.commitName(AUTH_ID)], undefined);
});

test('R1 persisted by the live closeout is capped and redacted (spy ledger wrapper, secrets masked)', async () => {
  const { w, r } = await consumedRun({ handlers: { g2RunPhases: () => passRun({ spyLedger: [{ method: 'viewer.fitToView', origin: 'bridge', argSummaries: [{ kind: 'string', value: 'https://h.invalid/x?access_token=SECRET' }] }] }) } });
  assert.equal(r.finalOverall, 'PASS');
  const r1 = JSON.parse(H.readArtifactFileMap({ fs: w.fs.processCrashView(), chain: CHAIN }).results[H.R1_NAME].toString('utf8'));
  assert.equal(r1.spyLedger.truncated, false);
  assert.equal(r1.spyLedger.records.length, 1);
  assert.doesNotMatch(JSON.stringify(r1), /SECRET/);
  assert.equal(H.validateResultSchema(r1, 'payload').ok, true);
});

// ------------------------------------------------------------------------------------------
// runCli exit-code mapping and the served-module route.
// ------------------------------------------------------------------------------------------

test('runCli: exit code from finalOverall (PASS 0, FAIL 1, BLOCKED 2, PARTIAL 3, other 4); any throw => 1', async () => {
  const cases = [['PASS', 0], ['FAIL', 1], ['BLOCKED', 2], ['PARTIAL', 3], ['PASS-UNCONFIRMED', 4], [undefined, 4]];
  for (const [v, code] of cases) {
    const proc = { exitCode: undefined };
    await REAL.runCli(async () => ({ finalOverall: v }), { proc, logError: () => {} });
    assert.equal(proc.exitCode, code, String(v));
  }
  const p2 = { exitCode: undefined };
  await REAL.runCli(async () => undefined, { proc: p2, logError: () => {} });
  assert.equal(p2.exitCode, 4);
  const p3 = { exitCode: undefined };
  await REAL.runCli(async () => { throw new REAL.G2RefusalError('x', 'refused'); }, { proc: p3, logError: () => {} });
  assert.equal(p3.exitCode, 1);
});

test('route setup: the synthetic page is served at its exact URL; /clashpanel/** only via the module server; foreign origins pass through', async () => {
  const { w } = await consumedRun({});
  const byPattern = Object.fromEntries(w.routes.map(([p, h]) => [p, h]));
  const pageRoute = byPattern[`http://localhost:8080${H.G2_PAGE_PATH}`];
  let fulfilled = null;
  await pageRoute({ fulfill: (o) => { fulfilled = o; } });
  assert.equal(fulfilled.body, H.G2_BARE_PAGE_HTML);
  const mod = byPattern['**/clashpanel/**'];
  const call = async (url) => {
    let out = null;
    await mod({ request: () => ({ url: () => url }), fulfill: (o) => { out = { fulfill: o }; }, continue: () => { out = { continued: true }; } });
    return out;
  };
  const ok = await call('http://localhost:8080/clashpanel/viewer/ViewerBridge.js');
  assert.equal(ok.fulfill.status, 200);
  assert.equal((await call('https://elsewhere.invalid/clashpanel/viewer/ViewerBridge.js')).continued, true);
  assert.deepEqual(Object.keys(w.bindings).sort(), [H.G2_NODE_FATAL_BINDING, H.G2_NODE_SCREENSHOT_BINDING].sort());
  await assert.rejects(w.bindings[H.G2_NODE_SCREENSHOT_BINDING]({ x: 0.5, y: 0, width: 10, height: 10 }), /integer clip/);
});
