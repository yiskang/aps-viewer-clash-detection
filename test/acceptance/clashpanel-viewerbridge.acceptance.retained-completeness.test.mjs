// test/acceptance/clashpanel-viewerbridge.acceptance.retained-completeness.test.mjs
//
// Retained-snapshot completeness (owner-authorized fix of the 2026-10-02 independent re-review Medium M1). On the Node
// transport fallback (the g2RunPhases RPC did not complete; nothing was transferred) runPostReservation admits page
// evidence (eventLog / spyLedger / stateSnapshots) from Node's OWN retained snapshot (retain fence) into failed-run R1.
// That evidence now passes the SAME `authority.pageEvidenceProblems` completeness/provenance validation a transferred
// run passes, with one explicit scoping difference: the ingested side is restricted to the page ordinals Node had
// ingested when it accepted that retain fence (`retainedThroughOrdinal()`), because ordinals ingested later (e.g. the
// phase baseline snapshot taken after the retain, the next marker) are legitimately absent from the retained prefix.
// A problem ADDS one fatal (`retained-evidence:<first label>(+n)`): the run stays FAIL, the root phaseRunFailure and the
// completed history stay, nothing is fabricated.
//
// End to end through the REAL main() on a wired sandbox copy with the REAL page-agent bundle in node:vm (exactly the
// node-partial-transfer.test.mjs world), plus authority-level unit tests. Non-vacuity: a copy that bypasses the
// completeness pass again misses every tampered snapshot; an unscoped copy false-flags a valid retained prefix.
// Offline only: no browser, no network, no Viewer; the real harness keeps LIVE_PATH_WIRED=false.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as H from './clashpanel-viewerbridge.acceptance.mjs';
import { forceLivePathWired } from './support/g2-harness-copy.mjs';
import { passingRuntimeGateSeams } from './support/g2-runtime-gate-fakes.mjs';

const HARNESS_FILE = fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url));
const SOURCE = readFileSync(HARNESS_FILE, 'utf8');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const vr = H.checkVerdictLabel;

function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length - 1, 1, `anchor must occur exactly once: ${from.slice(0, 80)}`);
  return text.replace(from, () => to);
}


// ---- anchors of the fix and the two mutants ------------------------------------------------------------------------------
const GUARD = "if (retainedRun !== null && isPlainObject(state.phaseRunFailure) && state.phaseRunFailure.c1Stage === 'post-c1') {";
const SCOPED_CALL = 'authority.pageEvidenceProblems(state, { throughOrdinal: authority.retainedThroughOrdinal() })';
const NO_CHECK_SOURCE = replaceOnce(SOURCE, GUARD, 'if (false) {'); // completeness bypassed again (the pre-fix behaviour)
const UNSCOPED_SOURCE = replaceOnce(SOURCE, SCOPED_CALL, 'authority.pageEvidenceProblems(state)'); // no retained-prefix scope

// ---- wired sandbox copies (main() runs past W0 only on a copy; mainflow.test.mjs pattern) ---------------------------
const FAKE_VIEWER_BODY = Buffer.from('/* fake viewer3D.js body for the offline dry run */\n');
// LIVE_PATH_WIRED is FORCED true via the shared helper (tolerates either current value; fails loudly if ambiguous).
const wired = (src) => replaceOnce(forceLivePathWired(src, true),
  `const EXPECTED_VIEWER_SHA256 = '${H.EXPECTED_VIEWER_SHA256}';`, `const EXPECTED_VIEWER_SHA256 = '${sha(FAKE_VIEWER_BODY)}';`);
const SANDBOX = mkdtempSync(path.join(os.tmpdir(), 'g2-retained-complete-'));
after(() => { rmSync(SANDBOX, { recursive: true, force: true }); });

// The page bundle differs from the real one only by the Viewer-bound env / drivers / baseline (and the offline-fake mode).
const TEST_ENV_SUBST = Object.freeze([
  ['  const env = g2BuildEnv({ nodeLoadOutcomes: arg && isPlainObject(arg.nodeLoadOutcomes) ? arg.nodeLoadOutcomes : null });\n', '  const env = window.__testEnv;\n'],
  ["      drivers: createLivePhaseDrivers(env),\n      mode: 'live',\n      assertPhaseBaseline: async (phase) => g2PhaseBaseline(env, phase),", "      drivers: env.drivers,\n      mode: 'offline-fake',\n      assertPhaseBaseline: env.baseline,"],
]);
const PAGE_EXPOSE = ['g2RunPhases', 'g2CleanupDrain', 'g2PageState', 'createPageOrdinalSource', 'createCallRecorder', 'makeCheckRecord', 'makeControlRecord', 'PHASE_ORDER'];
function pageBundle(text) {
  let s = text;
  for (const [a, b] of TEST_ENV_SUBST) s = replaceOnce(s, a, b);
  const reg = 'window.__g2HarnessFns = Object.freeze(';
  return replaceOnce(H.buildPageAgentSource(s).source, reg, `window.__t = { ${PAGE_EXPOSE.join(', ')} };\n${reg}`);
}
async function copyOf(name, src) {
  const text = wired(src);
  // <SANDBOX>/<name>/test/acceptance/<harness>: the copy's own REPO_ROOT is the isolated <SANDBOX>/<name> root.
  const dir = path.join(SANDBOX, name, 'test', 'acceptance');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'clashpanel-viewerbridge.acceptance.mjs');
  writeFileSync(file, text);
  return { name, M: await import(pathToFileURL(file).href), text, bundle: pageBundle(text) };
}
const CUR = await copyOf('current', SOURCE);
const NO_CHECK = await copyOf('no-completeness-check', NO_CHECK_SOURCE);
const UNSCOPED = await copyOf('unscoped', UNSCOPED_SOURCE);

// ---- fixture: repo tree + a valid authorization record (as mainflow.test.mjs) --------------------------------------
const ROOT = '/repo';
const HEAD = '82dab8244d8d83f3cb824b05199d7a2ce5b0f2e0';
const RECORD = 'docs/prompts/g2-live-authorization.md';
const AUTH_ID = 'g2-live-dryrun-0001';
const PROC_BYTES = readFileSync(path.join(path.dirname(HARNESS_FILE), '..', '..', H.PROCEDURE_REL_PATH), 'utf8');
const CHAIN = H.resolveAttemptsChain(ROOT);
const JOURNAL_PATH = path.join(CHAIN.D2, H.journalName(AUTH_ID));
const ARGV = ['node', 'h.mjs', '--execute-live-g2', '--authorization-record', RECORD];
const ENV = { G2_LIVE_AUTHORIZED: 'YES' };
const FACTS = Object.freeze({
  loadedCount: 2,
  A: { loaded: true, classification: 'CONFIRMED_SVF2', otg: { available: true, value: true }, svf2: { available: true, value: true }, inAllModels: true, unitScale: 0.3048, unitString: 'ft' },
  B: { loaded: true, classification: 'CONFIRMED_SVF2', otg: { available: true, value: true }, svf2: { available: true, value: true }, inAllModels: true, unitScale: 0.3048, unitString: 'ft' },
});
const recordText = (harness) => [
  '# G2 live execution authorization (offline dry-run fixture)', '',
  H.MARKER_LIVE_LINE, `Authorization-ID: ${AUTH_ID}`, `Baseline-HEAD: ${HEAD}`,
  `Procedure-SHA256: ${sha(Buffer.from(PROC_BYTES))}`, `Harness-SHA256: ${sha(Buffer.from(harness))}`,
  `Model-A-URN-SHA256: ${sha(Buffer.from(H.MODEL_A_URN))}`, `Model-B-URN-SHA256: ${sha(Buffer.from(H.MODEL_B_URN))}`,
  H.RUNTIME_LINE, '',
].join('\n');

// ---- the page realm (REAL page-agent bundle in node:vm) ---------------------------------------------------------------
function pageRealm(bundle) {
  const window = { addEventListener: () => {}, removeEventListener: () => {} };
  const ctx = vm.createContext({ window, TextEncoder, TextDecoder, URL, performance, setTimeout, clearTimeout, setInterval, clearInterval, crypto: { randomUUID }, console });
  vm.runInContext(bundle, ctx);
  const t = window.__t;
  const g = t.g2PageState();
  const inRealm = vm.runInContext('(o) => Object.assign({}, o)', ctx);
  // a binding result is deserialised IN the page realm (as Playwright does), so g2JsonSafe keeps it as a plain object
  const fromJson = vm.runInContext('(s) => (s === undefined ? undefined : JSON.parse(s))', ctx);
  // As g2BuildEnv: NON-authoritative page ordinals; the early best-effort hint goes through the ingest binding.
  const pageSeq = t.createPageOrdinalSource({ deliver: (entry) => { const fn = window[H.G2_NODE_INGEST_BINDING]; if (typeof fn === 'function') Promise.resolve(fn(entry)).catch(() => {}); } });
  g.seq = pageSeq;
  const recorder = t.createCallRecorder({ nextSeq: pageSeq.next });
  const env = { recorder, state: { stateSnapshots: [] }, quarantine: { staleContinuationsDropped: 0 }, cameraHomeCaptured: true, bridgeTracker: { history: [] }, drivers: null };
  // phase-end baseline (as g2PhaseBaseline, after the clear fence): one recorder-stamped snapshot per phase
  env.baseline = async (phase) => { env.state.stateSnapshots.push(inRealm({ ...recorder.stamp('snapshot'), baselinePhase: phase, loadedModels: ['A', 'B'], isolationEmpty: true, hiddenEmpty: true })); return { ok: true }; };
  window.__testEnv = env;
  g.env = env;
  return { window, t, g, recorder, env, fromJson };
}

/**
 * Fake phase drivers (page realm): every runnable check is begun (attribution fence) and logs one `ran:<unit>` event,
 * every runnable control likewise; every unit PASSes / reaches its acceptable state. `before[phase]` runs first.
 */
function drivers(pr, { before = {} } = {}) {
  const pass = () => pr.t.makeCheckRecord({ verdict: 'PASS' });
  const ok = (n) => pr.t.makeControlRecord(n, { N1: 'DETECTED', N6: 'DETECTED', N8: 'DETECTED' }[n] || 'DETECTED_RESTORED');
  const d = {};
  for (const p of pr.t.PHASE_ORDER) {
    d[p.id] = async (ctx) => {
      if (before[p.id]) before[p.id](ctx);
      // (a unit whose parent check is not owned by this phase is not begun: Node would refuse that attribution as
      // phase-inconsistent; since C13 is P8-owned every runnable unit is owned by its phase, so this guard never skips)
      for (const c of ctx.runnable.checks) {
        if (!H.CHECK_OWNING_PHASES[H.SUBCHECK_OF[c] || c].includes(p.id)) continue;
        await ctx.beginCheck(c);
        pr.recorder.logEvent(`ran:${c}`, { note: 'executed' });
      }
      for (const n of ctx.runnable.controls) { await ctx.beginControl(n); pr.recorder.logEvent(`ran:${n}`, { note: 'executed' }); }
      return { checks: Object.fromEntries(ctx.runnable.checks.map((c) => [c, pass()])), controls: Object.fromEntries(ctx.runnable.controls.map((n) => [n, ok(n)])) };
    };
  }
  return d;
}

/** Arms a page fault: the runner's `fatalObserved()` (evaluated at a phase start, outside the driver try) throws once armed. */
function pageFault(pr, label) {
  let armed = false;
  Object.defineProperty(pr.g.fatal, 'flag', { configurable: true, get() { if (armed) throw new Error(`injected page fault ${label}`); return false; } });
  return () => { armed = true; };
}

// ---- fence / snapshot injection on the page -> Node sync channel --------------------------------------------------------
// Fence refusals bump the reported high-water by one (Node refuses `ingest-hw-mismatch`, one violation, ingests nothing).
// A snapshot tamper edits the retain report's snapshot of `phase` in flight (page ordinals; Node remaps them on acceptance).
const inj = {
  clear: (phase) => ({ phase, clear: true }),
  retain: (phase) => ({ phase, retain: true }),
  snap: (phase, fn) => ({ phase, snap: fn }),
};
function tamperer(specs, { entry = false } = {}) {
  const st = { phase: null, active: new Set(), clearHit: new Set() };
  return (a) => {
    const [action, arg] = a;
    if (action === 'attribution') {
      st.phase = arg.phase;
      if (entry && arg.phase === 'cleanup') { arg.hw += 1; return; }
      const nulls = arg.activeCheck === null && arg.activeControl === null;
      for (const s of specs) {
        if (s.clear && arg.phase === s.phase && nulls && st.active.has(s.phase) && !st.clearHit.has(s.phase)) { st.clearHit.add(s.phase); arg.hw += 1; return; }
      }
      if (!nulls) st.active.add(arg.phase);
    }
    if (action === 'retain') {
      for (const s of specs) {
        if (s.retain && st.phase === s.phase) { arg.hw += 1; return; }
        if (s.snap && st.phase === s.phase) s.snap(arg.snapshot);
      }
    }
  };
}

// ---- the fake world around the REAL main() ------------------------------------------------------------------------------
function makeWorld(copy, { drv = (pr) => drivers(pr), tamper = null, pageSetup = null } = {}) {
  const M = copy.M;
  const fs = M.createRecordingFakeFs({
    seedDirs: [`${ROOT}/docs/prompts`, `${ROOT}/docs/research`, `${ROOT}/test/acceptance`, `${ROOT}/node_modules/playwright`],
    seedFiles: {
      [`${ROOT}/${M.PROCEDURE_REL_PATH}`]: PROC_BYTES,
      [`${ROOT}/${M.HARNESS_REL_PATH}`]: copy.text,
      [`${ROOT}/${RECORD}`]: recordText(copy.text),
      [`${ROOT}/node_modules/playwright/package.json`]: JSON.stringify({ name: 'playwright', version: '9.99.0-fake' }),
    },
    fault: () => null,
  });
  const bindings = {};
  const pr = pageRealm(copy.bundle);
  if (pageSetup) pageSetup(pr);
  const calls = []; // every page -> Node sync call, in Node-arrival order: {action, phase, activeCheck, activeControl, ok, reason}
  // Playwright exposeFunction stand-in: delayed, JSON-serialising, to the REAL bindings runPostReservation exposed.
  for (const name of [M.G2_NODE_SYNC_BINDING, M.G2_NODE_INGEST_BINDING, M.G2_NODE_FATAL_BINDING, M.G2_NODE_OPLEDGER_BINDING]) {
    pr.window[name] = (...args) => (async () => {
      const a = clone(args);
      await sleep(1);
      if (name === M.G2_NODE_SYNC_BINDING && tamper) tamper(a);
      const r = clone(await bindings[name](...a));
      if (name === M.G2_NODE_SYNC_BINDING) calls.push({ action: a[0], phase: a[1].phase, activeCheck: a[1].activeCheck, activeControl: a[1].activeControl, ok: Boolean(r && r.ok === true), reason: r && r.reason });
      return pr.fromJson(JSON.stringify(r));
    })();
  }
  const handlers = {
    g2InstallModules: (specs) => Object.fromEntries(specs.map((s) => [s, { ok: true, exports: ['x'] }])),
    g2AgentReady: () => ({ ok: true, webgl: { available: true, version: 'webgl2' } }),
    g2MarkFatal: (arg) => ({ flag: true, abort: arg && arg.abort === true }),
    g2DocumentLoad: () => ({ status: 'completed' }),
    g2LoadDocumentNode: () => ({ status: 'completed' }),
    g2AwaitModelReady: () => ({ status: 'ready', tree: true, geometry: true }),
    g2CollectModelFacts: () => clone(FACTS),
    g2PrepareTargets: () => ({ a1: 11, b1: 22, fitPair: { a: 11, b: 22 }, rule: 'fake' }),
    g2RunPhases: async (arg) => { pr.env.drivers = drv(pr); return pr.t.g2RunPhases(arg); }, // REAL in-page g2RunPhases
    g2CleanupStep: () => ({ ok: true, result: null, error: null, ownershipRemains: false }),
    g2CleanupDrain: () => pr.t.g2CleanupDrain(), // REAL in-page cleanup drain (page-transfer runs only)
  };
  const rpcLog = [];
  const pageEmitter = new EventEmitter();
  const closed = { page: false, context: false, browser: false };
  const page = {
    on: (ev, fn) => pageEmitter.on(ev, fn),
    off: (ev, fn) => pageEmitter.off(ev, fn),
    emit: (ev, ...a) => pageEmitter.emit(ev, ...a),
    async route() {},
    async exposeFunction(name, fn) { bindings[name] = fn; },
    async addInitScript() {},
    async goto() {
      const req = { resourceType: () => 'script', redirectedFrom: () => null, url: () => M.G2_VIEWER_SCRIPT_URL };
      pageEmitter.emit('response', { request: () => req, status: () => 200, fromServiceWorker: () => false, body: async () => FAKE_VIEWER_BODY });
    },
    async waitForFunction() { return true; },
    async evaluate(fn, payload) {
      assert.equal(fn, M.G2_PAGE_DISPATCH);
      rpcLog.push(payload.key);
      const h = handlers[payload.key];
      if (typeof h !== 'function') throw new Error(`no fake handler for ${payload.key}`);
      return clone(await h(clone(payload.arg)));
    },
    async screenshot() { return Buffer.from('png'); },
    async close() { closed.page = true; pageEmitter.emit('close'); },
    isClosed: () => closed.page,
  };
  const context = { async newPage() { return page; }, async close() { closed.context = true; } };
  const browserEmitter = new EventEmitter();
  const browser = {
    version: () => H.G2_REQUIRED_RUNTIME.headlessShell.browserVersion, on: (ev, fn) => browserEmitter.on(ev, fn), off: (ev, fn) => browserEmitter.off(ev, fn),
    async newContext() { return context; }, async close() { closed.browser = true; browserEmitter.emit('disconnected'); }, isConnected: () => !closed.browser,
  };
  const deps = {
    fs, repoRoot: ROOT,
    runtimeGateSeams: passingRuntimeGateSeams({ repoRoot: ROOT, required: H.G2_REQUIRED_RUNTIME }).seams,
    gitHead: () => HEAD,
    git: (args) => { if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main\n'; if (args[0] === 'rev-parse') return `${HEAD}\n`; return ''; },
    serveModule: ({ requestUrl, manifest }) => {
      const bytes = Buffer.from(`// fake module ${requestUrl}\n`);
      return { status: 200, contentType: 'text/javascript; charset=utf-8', body: bytes, sha256: manifest ? manifest.record(requestUrl, bytes) : sha(bytes), repoRelative: requestUrl };
    },
    browserPackage: { chromium: { async launch() { return browser; } } },
    commitFs: { linkSync: M.brandSyncLinkForTest((a, b) => fs.link(a, b)) },
    allowTestLinkPrimitive: true,
    timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h) },
    print: () => {},
    proc: new EventEmitter(),
    onEvent: () => {},
  };
  return { M, fs, pr, calls, rpcLog, deps };
}

async function run(copy, opts) {
  const w = makeWorld(copy, opts);
  const r = await w.M.main({ argv: ARGV, env: ENV, deps: w.deps });
  assert.equal(r.consumed, true);
  const files = w.M.readArtifactFileMap({ fs: w.fs.processCrashView(), chain: CHAIN });
  const json = (b) => (b ? JSON.parse(b.toString('utf8')) : null);
  const d = {
    files, r1Bytes: files.results[w.M.R1_NAME], r1: json(files.results[w.M.R1_NAME]),
    r2: files.results[w.M.R2_NAME] ? files.results[w.M.R2_NAME].toString('utf8') : null,
    r3: json(files.results[w.M.R3_NAME]), k: json(files.attempts[w.M.commitName(AUTH_ID)]), f: json(files.attempts[w.M.closeoutFailureName(AUTH_ID)]),
  };
  const reader = w.M.deriveVerdictFromArtifacts({ ...files, authorizationId: AUTH_ID });
  let journal = null;
  try { journal = JSON.parse(w.fs.osCrashView().readFile(JOURNAL_PATH).toString('utf8')).transitions.map((t) => t.state); } catch { journal = null; }
  return { w, r, d, reader, journal };
}

// ---- shared assertions -----------------------------------------------------------------------------------------------
const UNITS_OF = Object.fromEntries(H.PHASE_ORDER.map((p) => [p.id, H.phaseUnits(p)]));
const checksThrough = (phases) => ['C1', ...phases.flatMap((p) => UNITS_OF[p].checks)].map((c) => H.SUBCHECK_OF && H.SUBCHECK_OF[c] ? H.SUBCHECK_OF[c] : c);
const controlsThrough = (phases) => phases.flatMap((p) => UNITS_OF[p].controls);
const violationsOf = (S) => S.errorLedger.entries.filter((e) => typeof e.detail === 'string' && e.detail.startsWith('cross-realm-fence:'));

/**
 * The durable artifact chain of a failed run is committed FAIL and schema-valid (R1 / R2 / R3 / J / K) and the reader
 * reconstructs FAIL with the root failure. Returns the R1 phaseRunFailure.
 */
function assertFailChain(x, { source, c1Stage }) {
  const { r, d, reader } = x;
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.closeout.committed, true, JSON.stringify(r.closeout.causes));
  assert.deepEqual(H.validateResultSchema(d.r1, 'payload').errors, [], 'R1 schema-valid');
  assert.deepEqual(H.failedRunRecordProblems(d.r1), []);
  assert.deepEqual(H.primarySeqAllocations(d.r1).problems, [], 'every primary seq unique, no leaked page ordinal');
  assert.equal(d.r1.overall.verdict, 'FAIL');
  assert.equal(d.r1.sessionTainted, true);
  const pf = d.r1.phaseRunFailure;
  assert.deepEqual([pf.source, pf.c1Stage], [source, c1Stage]);
  assert.equal(d.r2.split('\n').filter((l) => l === `failedRun: ${pf.source}/${pf.category}/${pf.phase === null ? 'none' : pf.phase}/seq ${pf.failureSeq}/${pf.c1Stage}`).length, 1, 'R2 failedRun line');
  assert.deepEqual(H.validateCloseoutManifest(d.r3), { ok: true, errors: [] }, 'R3 valid');
  assert.equal(d.r3.artifacts[0].sha256, sha(d.r1Bytes), 'R3 hashes the on-disk R1');
  assert.equal(d.r3.artifacts[1].sha256, sha(d.files.results[H.R2_NAME]), 'R3 hashes the on-disk R2');
  assert.deepEqual(x.journal, ['AUTH_BOUND', 'ATTEMPT_CONSUMED', 'CLOSEOUT_STARTED']);
  assert.deepEqual([d.k.finalOverall, d.k.primaryOverall, d.k.resultSha256], ['FAIL', 'FAIL', sha(d.r1Bytes)], 'K commits FAIL over these R1 bytes');
  assert.equal(d.f, null);
  assert.deepEqual([reader.verdict, reader.witness], ['FAIL', 'W-6'], 'reader FAIL');
  assert.deepEqual({ ...reader.detail.failedRun }, { source: pf.source, category: pf.category, phase: pf.phase, failureSeq: pf.failureSeq, c1Stage: pf.c1Stage });
  return pf;
}

/**
 * Truthful post-C1 history in the durable R1: exactly `checks` (C1 included) / `controls` are the retained executed
 * records (PASS / started), every other check is BLOCKED(phase-run-threw) and every other control a not-started
 * placeholder (never fabricated); each retained executed item's attributed history is present and precedes the failure;
 * failureSeq follows every retained seq.
 */
function assertTruthfulHistory(r1, { checks, controls }) {
  const pf = r1.phaseRunFailure;
  assert.deepEqual(r1.gates.C1.outcome, 'OPEN');
  assert.deepEqual([pf.gateSeq, pf.gateOutcome], [r1.gates.C1.gateSeq, 'OPEN']);
  for (const n of H.CHECK_NAMES) {
    if (checks.includes(n)) assert.equal(vr(r1.checks[n]), 'PASS', `${n}: completed result retained`);
    else assert.equal(vr(r1.checks[n]), 'BLOCKED(phase-run-threw)', `${n}: not completed => blocked, never fabricated`);
  }
  for (const n of H.CONTROL_NAMES) {
    const c = r1.controls[n];
    if (controls.includes(n)) {
      assert.deepEqual([c.recordType, c.executionRecord.started], ['control-run', true], `${n}: executed control retained`);
      assert.ok(c.executionRecord.startSeq < c.executionRecord.terminalSeq && c.executionRecord.terminalSeq < pf.failureSeq, `${n}: start < terminal < failure`);
    } else assert.deepEqual([c.executionRecord.started, c.fields.reason], [false, 'phase-run-threw'], `${n}: not started`);
  }
  // the executed items' own events are in the durable eventLog, Node-sequenced, before the failure
  for (const u of [...checks.filter((c) => c !== 'C1'), ...controls]) {
    const evs = r1.eventLog.filter((e) => e.kind === `ran:${u}` || (u === 'C7' && /^ran:C7(alpha|beta)$/.test(e.kind)) || (u === 'C18' && /^ran:C18[ab]$/.test(e.kind)));
    assert.ok(evs.length >= 1, `${u}: attributed history retained`);
    for (const e of evs) assert.ok(!H.isPageLocalOrdinal(e.seq) && e.seq < pf.failureSeq, `${u}: authoritative seq before the failure`);
  }
  // ordering: failureSeq follows every retained page-origin seq
  const retainedSeqs = [...r1.eventLog, ...r1.spyLedger.records, ...r1.stateSnapshots].map((e) => e.seq).concat(controls.flatMap((n) => [r1.controls[n].executionRecord.startSeq, r1.controls[n].executionRecord.terminalSeq]));
  assert.ok(retainedSeqs.length > 0 && retainedSeqs.every((s) => s < pf.failureSeq), 'failureSeq > every retained seq');
}

/** The both-fence-refusal ordering (procedure §9 completed-result retention): completed -> retained -> clear refused -> entry refused -> failure -> closeout. */
function assertRefusalOrdering(x, phase) {
  const { w, r, d } = x;
  const at = (pred) => w.calls.findIndex(pred);
  const retainAt = at((c) => c.action === 'retain' && c.ok && c.phase === undefined && w.calls.slice(0, w.calls.indexOf(c)).reverse().find((y) => y.action === 'attribution').phase === phase);
  const clearAt = at((c) => c.action === 'attribution' && c.phase === phase && c.activeCheck === null && c.activeControl === null && !c.ok);
  const entryAt = at((c) => c.action === 'attribution' && c.phase === 'cleanup');
  assert.ok(retainAt !== -1 && retainAt < clearAt && clearAt < entryAt, `retain fence ${retainAt} < refused clear fence ${clearAt} < cleanup-entry fence ${entryAt}`);
  assert.equal(w.calls[entryAt].ok, false, 'cleanup entry refused too');
  assert.equal(w.calls.filter((c) => c.action === 'drain').length, 0, 'no final transfer was made (the RPC threw)');
  assert.ok(w.rpcLog.includes('g2RunPhases') && !w.rpcLog.includes('g2CleanupDrain'), 'nothing transferred');
  const v = violationsOf(r.state);
  assert.deepEqual(v.map((e) => e.detail), ['cross-realm-fence:ingest-hw-mismatch', 'cross-realm-fence:ingest-attribution'], 'clear-fence refusal, then cleanup-entry refusal');
  const pf = d.r1.phaseRunFailure;
  const closeoutSeq = d.r1.errorLedger.markers.find((m) => m.name === 'closeout').seq;
  const lastRetained = Math.max(...d.r1.eventLog.map((e) => e.seq));
  assert.ok(lastRetained < v[0].seq && v[0].seq < v[1].seq && v[1].seq < pf.failureSeq && pf.failureSeq < closeoutSeq, `${lastRetained} < ${v[0].seq} < ${v[1].seq} < ${pf.failureSeq} < ${closeoutSeq}`);
  assert.deepEqual([pf.source, pf.realm, pf.seqSource, pf.cleanupEntry, pf.status, pf.phase], ['node-phase-run-transport', 'node', 'node-observed', 'not-entered', 'threw', phase]);
  assert.match(pf.message, /attribution sync refused by the node authority \(ingest-hw-mismatch\)/);
}


const retainedFatals = (S) => S.errorLedger.entries.filter((e) => typeof e.detail === 'string' && e.detail.startsWith('retained-evidence:'));
const kindOrd = (snap, kind) => snap.eventLog.find((e) => e.kind === kind).seq;
/** A run whose retained P3 snapshot is tampered in flight, then the P3 clear fence and the cleanup-entry fence refuse (transport fallback). */
const tamperedRun = (copy, fn) => run(copy, { tamper: tamperer([inj.snap('P3', fn), inj.clear('P3')], { entry: true }) });

/** The tampered snapshot shapes (page ordinals, in flight) and the first problem label each must produce. */
const TAMPERS = {
  'missing eventLog provenance': { fn: (s) => { s.eventLog = s.eventLog.filter((e) => e.kind !== 'ran:C1'); }, label: /^retained-evidence:page-evidence-missing:event:\d+$/, committed: true },
  'duplicate event provenance': { fn: (s) => { s.eventLog.push(clone(s.eventLog.find((e) => e.kind === 'ran:C1'))); }, label: /^retained-evidence:page-evidence-duplicate:event:\d+$/, committed: false },
  'unsourced spy record': {
    fn: (s) => { const ord = kindOrd(s, 'ran:C1'); s.spyLedger.push({ callIndex: 0, seq: ord, phase: 'P1', activeCheck: 'C1', activeControl: null, method: 'probe', origin: 'harness', argSummaries: [], argRefIds: [], argsDigest: sha(Buffer.from('[]')), at: '2026-10-02T00:00:00.000Z', atMs: 0, outcome: null, injected: false }); },
    label: /^retained-evidence:page-evidence-unsourced:spy:\d+$/, committed: false,
  },
  'snapshot provenance mismatch': { fn: (s) => { s.stateSnapshots[s.stateSnapshots.length - 1].seq = kindOrd(s, 'ran:N1'); }, label: /^retained-evidence:page-evidence-missing:snapshot:\d+\(\+1\)$/, committed: false },
};

/** Completeness failure semantics: FAIL committed, the root failure retained, the completeness failure ADDED, validated history kept. */
function assertCompletenessFailure(x, label, { committed }) {
  const { r, d, reader } = x;
  assert.equal(r.finalOverall, 'FAIL');
  assert.notEqual(reader.verdict, 'PASS');
  assert.equal(reader.verdict, 'FAIL');
  // the original root failure is retained (Node transport, post-C1, the clear-fence refusal)
  const pf = r.state.phaseRunFailure;
  assert.deepEqual([pf.source, pf.c1Stage, pf.phase, pf.status], ['node-phase-run-transport', 'post-c1', 'P3', 'threw']);
  assert.match(pf.message, /attribution sync refused by the node authority \(ingest-hw-mismatch\)/);
  // ... ALONGSIDE the added completeness failure (one fatal), after the two fence violations
  assert.deepEqual(violationsOf(r.state).map((e) => e.detail), ['cross-realm-fence:ingest-hw-mismatch', 'cross-realm-fence:ingest-attribution']);
  const added = retainedFatals(r.state);
  assert.equal(added.length, 1);
  assert.match(added[0].detail, label);
  assert.ok(added[0].seq > pf.failureSeq, 'added after the root failure, never replacing it');
  // already-validated completed history is not erased and nothing later is fabricated (Node state)
  for (const n of ['C1', 'C2', 'C3']) assert.equal(vr(r.state.checks[n]), 'PASS', n);
  assert.equal(r.state.controls.N1.executionRecord.started, true);
  for (const n of H.CHECK_NAMES.filter((c) => !['C1', 'C2', 'C3'].includes(c))) assert.equal(vr(r.state.checks[n]), 'BLOCKED(phase-run-threw)', n);
  assert.deepEqual(r.state.gates.C1.outcome, 'OPEN');
  if (committed) {
    // omitted evidence (R1 still self-consistent): K commits FAIL over a schema-valid R1 that carries both failures
    assertFailChain(x, { source: 'node-phase-run-transport', c1Stage: 'post-c1' });
    assert.deepEqual(d.r1.phaseRunFailure, pf);
    assert.ok(d.r1.errorLedger.entries.some((e) => e.detail === added[0].detail), 'the completeness failure is in the durable R1');
    for (const n of ['C1', 'C2', 'C3']) assert.equal(vr(d.r1.checks[n]), 'PASS', n);
  } else {
    // a record colliding with another seq also makes R1 self-inconsistent: closeout's own R1 verification refuses it
    // (fail closed, exactly as for a transferred run): no K, journal FAILED, the failure witness F keeps the ROOT failure
    assert.equal(r.closeout.committed, false);
    assert.ok(r.closeout.causes.includes('r1-verify'), JSON.stringify(r.closeout.causes));
    assert.equal(d.k, null);
    assert.deepEqual(d.f.phaseRunFailure, pf, 'F retains the root failure');
    assert.deepEqual(x.journal, ['AUTH_BOUND', 'ATTEMPT_CONSUMED', 'CLOSEOUT_STARTED', 'FAILED']);
    assert.equal(reader.witness, 'W-1');
  }
}

// ==========================================================================================
// static
// ==========================================================================================

test('static: the transport branch validates the admitted retained evidence with the SAME pageEvidenceProblems, scoped to the retain high-water, right after admission and before cleanup/closeout; live stays dormant', () => {
  const rpr = H.locateFunctionSource(SOURCE, 'runPostReservation');
  const t = SOURCE.slice(rpr.start, rpr.end);
  for (const a of [GUARD, SCOPED_CALL, 'markers: ingestedMarkers, retained: retainedRun });']) assert.equal(t.split(a).length - 1, 1, a);
  const iAdmit = t.indexOf('markers: ingestedMarkers, retained: retainedRun });');
  const iGuard = t.indexOf(GUARD);
  assert.ok(iAdmit < iGuard && iGuard < t.indexOf(SCOPED_CALL) && t.indexOf(SCOPED_CALL) < t.indexOf("const drainCleanup = async () =>"), 'admit -> validate -> cleanup');
  assert.ok(t.includes("sink.recordFatal('harness-exception', `retained-evidence:${problems[0]}${problems.length > 1 ? `(+${problems.length - 1})` : ''}`);"));
  // the normal (transferred) path still validates unscoped
  assert.equal(t.split('const problems = authority.pageEvidenceProblems(state);').length - 1, 1);
  const auth = H.locateFunctionSource(SOURCE, 'createRunAuthority');
  const at = SOURCE.slice(auth.start, auth.end);
  assert.ok(at.includes('retainedSnapshot = out.value;\n        retainedThroughOrd = lastOrd;'), 'the scope is fixed when (and only when) a retain is accepted');
  // LIVE_PATH_WIRED is deliberately not pinned here: the single pin of the real value is in live-path-isolation.test.mjs.
  assert.equal(H.G2_DUAL_COUNTER_GATE.resolved, true);
});

// ==========================================================================================
// authority unit: pageEvidenceProblems scoped to the retained prefix
// ==========================================================================================

function retainedWorld() {
  const B = H.PAGE_LOCAL_BASE;
  const allocator = H.createRunSeqAllocator();
  allocator.next(); // a Node-origin seq already handed out
  const violations = [];
  const a = H.createRunAuthority({ allocator, attribution: { phase: 'P3', activeCheck: 'C2', activeControl: null }, onViolation: (r) => violations.push(r) });
  const A = { phase: 'P3', activeCheck: 'C2', activeControl: null };
  const pend = [
    { ord: B + 1, kind: 'alloc', label: 'marker:P3', ...A }, { ord: B + 2, kind: 'event', label: 'ran:C2', ...A },
    { ord: B + 3, kind: 'spy', label: null, ...A }, { ord: B + 4, kind: 'snapshot', label: null, ...A },
  ];
  const snapshot = {
    partial: { checks: {}, controls: {} }, markers: [{ seq: B + 1, name: 'P3' }], screenshots: [], pageHighWater: B + 4,
    eventLog: [{ seq: B + 2, kind: 'ran:C2', ...A }], spyLedger: [{ seq: B + 3, ...A }], stateSnapshots: [{ seq: B + 4, ...A, baselinePhase: 'P2' }],
  };
  assert.deepEqual(a.retainPageSnapshot({ pending: pend, hw: B + 4, snapshot }), { ok: true });
  // AFTER the retain: a later event + the phase baseline snapshot are ingested (legitimately absent from the retained prefix)
  assert.deepEqual(a.ingestFence({ pending: [{ ord: B + 5, kind: 'event', label: 'ran:C3', ...A }, { ord: B + 6, kind: 'snapshot', label: null, ...A }], hw: B + 6 }).ok, true);
  const state = () => { const r = a.retained(); return { eventLog: r.eventLog, spyLedger: r.spyLedger, stateSnapshots: r.stateSnapshots, errorLedger: { markers: r.markers } }; };
  return { a, B, violations, state, through: a.retainedThroughOrdinal(), seq: (ord) => a.seqOfOrdinal(ord) };
}

test('(1) a valid retained snapshot passes pageEvidenceProblems in its retained scope; the scope is the retain high-water; later-ingested ordinals are out of scope (unscoped they would be reported missing)', () => {
  const w = retainedWorld();
  assert.equal(w.through, w.B + 4);
  assert.deepEqual(w.a.pageEvidenceProblems(w.state(), { throughOrdinal: w.through }), []);
  assert.deepEqual(w.a.pageEvidenceProblems(w.state()), [`page-evidence-missing:event:${w.seq(w.B + 5)}`, `page-evidence-missing:snapshot:${w.seq(w.B + 6)}`], 'unscoped: the post-retain ordinals');
  assert.deepEqual(w.violations, []);
  // no accepted retain => no scope; a malformed scope fails closed (never "no check")
  const fresh = H.createRunAuthority({ allocator: H.createRunSeqAllocator(), attribution: { phase: 'P0', activeCheck: null, activeControl: null } });
  assert.equal(fresh.retainedThroughOrdinal(), null);
  for (const bad of [0, 5, w.B, 'x', 1.5, undefined === 1 ? 0 : -1]) assert.deepEqual(w.a.pageEvidenceProblems(w.state(), { throughOrdinal: bad }), ['page-evidence-scope-invalid'], String(bad));
});

test('(2)-(6) in scope, the retained-evidence check rejects exactly as the normal one: missing event, duplicate event, unsourced spy, snapshot provenance mismatch, leaked page ordinal; cleanup provenance still applies', () => {
  const w = retainedWorld();
  const run = (mut) => { const s = w.state(); mut(s); return w.a.pageEvidenceProblems(s, { throughOrdinal: w.through }); };
  const ev = w.seq(w.B + 2);
  const spy = w.seq(w.B + 3);
  const snap = w.seq(w.B + 4);
  assert.deepEqual(run((s) => { s.eventLog = []; }), [`page-evidence-missing:event:${ev}`], 'missing eventLog provenance');
  assert.deepEqual(run((s) => { s.eventLog.push(clone(s.eventLog[0])); }), [`page-evidence-duplicate:event:${ev}`], 'duplicate event provenance');
  assert.deepEqual(run((s) => { s.spyLedger.push({ ...clone(s.spyLedger[0]), seq: ev }); }), [`page-evidence-unsourced:spy:${ev}`], 'unsourced spy record');
  assert.deepEqual(run((s) => { s.stateSnapshots[0].seq = ev; }), [`page-evidence-missing:snapshot:${snap}`, `page-evidence-unsourced:snapshot:${ev}`], 'snapshot provenance mismatch');
  // out-of-scope ordinals are not a source for the retained prefix: a snapshot claiming the post-retain baseline's seq is unsourced
  assert.deepEqual(run((s) => { s.stateSnapshots.push({ ...clone(s.stateSnapshots[0]), seq: w.seq(w.B + 6) }); }), [`page-evidence-unsourced:snapshot:${w.seq(w.B + 6)}`]);
  // leaked page ordinals (a record that kept its page-local ordinal instead of its authoritative seq)
  assert.deepEqual(run((s) => { s.eventLog[0].seq = w.B + 2; }), [`page-evidence-missing:event:${ev}`], 'leaked event ordinal');
  assert.deepEqual(run((s) => { s.spyLedger[0].seq = w.B + 3; }), [`page-evidence-missing:spy:${spy}`, `page-evidence-unsourced:spy:${w.B + 3}`], 'leaked spy ordinal');
  assert.deepEqual(run((s) => { s.stateSnapshots[0].seq = w.B + 4; }), [`page-evidence-missing:snapshot:${snap}`, `page-evidence-unsourced:snapshot:${w.B + 4}`], 'leaked snapshot ordinal');
  // a cleanup-phase event can never be part of a retained (pre-cleanup) prefix: the cleanup provenance rules still apply
  assert.deepEqual(run((s) => { s.eventLog.push({ seq: 999, kind: 'wrapper-restore', phase: 'cleanup', activeCheck: null, activeControl: null }); }), ['cleanup-event-unsourced:999']);
  assert.deepEqual(run((s) => { s.eventLog.push({ seq: w.B + 9, kind: 'wrapper-restore', phase: 'cleanup', activeCheck: null, activeControl: null }); }), [`cleanup-event-leaked-ordinal:${w.B + 9}`]);
});

// ==========================================================================================
// end to end (REAL main()): transport fallback after C2/C3 completed, clear + cleanup-entry fences refused
// ==========================================================================================

test('(1)/(8) end to end: a valid retained snapshot passes (no retained-evidence fatal); completed C2/C3/N1 history preserved; R1/R2/R3/K valid; reader FAIL', async () => {
  const x = await tamperedRun(CUR, () => {});
  assertFailChain(x, { source: 'node-phase-run-transport', c1Stage: 'post-c1' });
  assertRefusalOrdering(x, 'P3');
  assert.deepEqual(retainedFatals(x.r.state), []);
  assertTruthfulHistory(x.d.r1, { checks: checksThrough(['P3']), controls: controlsThrough(['P2', 'P3']) });
});

for (const [name, t] of Object.entries(TAMPERS)) {
  test(`(2)-(5)/(7) end to end: ${name} in the retained snapshot => FAIL; the root phase failure retained ALONGSIDE the added completeness failure; completed history kept`, async () => {
    const x = await tamperedRun(CUR, t.fn);
    assertCompletenessFailure(x, t.label, t);
  });
}

test('(6) end to end: a leaked page ordinal never reaches failed-run R1 through the retain path (an unmapped ordinal refuses the retain fence: fail closed, previous snapshot kept)', async () => {
  const x = await run(CUR, { tamper: tamperer([inj.snap('P3', (s) => { s.eventLog.push({ ...clone(s.eventLog[0]), seq: s.pageHighWater + 50 }); }), inj.clear('P3')], { entry: true }) });
  assert.equal(x.r.finalOverall, 'FAIL');
  assert.ok(violationsOf(x.r.state).map((e) => e.detail).includes('cross-realm-fence:retain-ordinal-unmapped'));
  assert.deepEqual(H.primarySeqAllocations(x.d.r1).problems, [], 'no leaked page ordinal in R1');
  assert.equal(x.d.r1.eventLog.some((e) => H.isPageLocalOrdinal(e.seq)), false);
  assert.deepEqual(retainedFatals(x.r.state), [], 'Node kept its previous (valid) snapshot');
});

test('scope: retain at P3 refused + cleanup entry refused => the P2 snapshot is admitted while later ordinals (P2 baseline after the retain, the P3 marker, C2/C3 events) were already ingested; the scoped check passes, an UNSCOPED check false-flags the valid prefix', async () => {
  const x = await run(CUR, { tamper: tamperer([inj.retain('P3')], { entry: true }) });
  assertFailChain(x, { source: 'node-phase-run-transport', c1Stage: 'post-c1' });
  assertTruthfulHistory(x.d.r1, { checks: ['C1'], controls: ['N1'] });
  assert.deepEqual(retainedFatals(x.r.state), []);
  // the retained stateSnapshots stop before P2's own baseline (taken after P2's retain): consistent with the scope
  assert.deepEqual(x.d.r1.stateSnapshots.map((s) => s.baselinePhase), ['P1']);
  const y = await run(UNSCOPED, { tamper: tamperer([inj.retain('P3')], { entry: true }) });
  const f = retainedFatals(y.r.state);
  assert.equal(f.length, 1);
  assert.match(f[0].detail, /^retained-evidence:page-evidence-missing:/, 'without the scope a truthful prefix is reported incomplete');
});

test('(9) no duplicate history: when the cleanup entry succeeds (page fault at P5a after P4 was retained) the page failure transfer wins -- the (tampered) retained snapshot is NOT admitted, no retained-evidence check runs, the normal provenance check passes, every seq once', async () => {
  let arm = null;
  const x = await run(CUR, {
    drv: (pr) => drivers(pr, { before: { P4: () => arm() } }),
    pageSetup: (pr) => { arm = pageFault(pr, 'at P5a'); },
    tamper: tamperer([inj.snap('P4', TAMPERS['duplicate event provenance'].fn)]),
  });
  const pf = assertFailChain(x, { source: 'page-phase-run', c1Stage: 'post-c1' });
  assert.equal(pf.cleanupEntry, 'marker-allocated');
  assert.deepEqual(retainedFatals(x.r.state), [], 'the retained snapshot is never admitted when the page transfer wins');
  assert.equal(x.r.state.errorLedger.entries.some((e) => /cleanup-evidence/.test(String(e.detail))), false, 'normal provenance check clean');
  const r1 = x.d.r1;
  for (const k of ['eventLog', 'stateSnapshots']) assert.equal(new Set(r1[k].map((e) => e.seq)).size, r1[k].length, `${k}: every seq once`);
  for (const u of ['C1', 'C2', 'C3', 'C4', 'C5', 'N1', 'N6']) assert.equal(r1.eventLog.filter((e) => e.kind === `ran:${u}`).length, 1, `${u} history exactly once`);
});

test('(10) PASS path unchanged: an all-PASS run is PASS with no retained-evidence check, and its R1 equals the R1 of a copy without the completeness pass (apart from timestamps)', async () => {
  const x = await run(CUR);
  const y = await run(NO_CHECK);
  assert.equal(x.r.finalOverall, 'PASS', JSON.stringify(x.r.closeout && x.r.closeout.causes));
  assert.deepEqual([x.d.r1.phaseRunFailure, x.reader.verdict, x.d.k.finalOverall], [null, 'PASS', 'PASS']);
  assert.deepEqual(retainedFatals(x.r.state), []);
  const iso = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
  const norm = (v) => JSON.parse(JSON.stringify(v, (k, val) => (typeof val === 'string' && iso.test(val) ? 'T' : val)));
  for (const k of ['checks', 'controls', 'gates', 'eventLog', 'stateSnapshots', 'n6', 'phaseRunFailure', 'overall']) assert.deepEqual(norm(x.d.r1[k]), norm(y.d.r1[k]), k);
  assert.deepEqual(norm(x.d.r1.errorLedger.entries), norm(y.d.r1.errorLedger.entries));
});

test('mutation / non-vacuity: a copy that bypasses the retained completeness pass again admits every tampered snapshot silently -- and the completeness-failure assertions catch it', async () => {
  for (const [name, t] of Object.entries(TAMPERS)) {
    const x = await tamperedRun(NO_CHECK, t.fn);
    assert.equal(x.r.finalOverall, 'FAIL', `${name}: still FAIL (phaseRunFailure), but ...`);
    assert.deepEqual(retainedFatals(x.r.state), [], `${name}: ... the incomplete retained evidence went unreported`);
    assert.throws(() => assertCompletenessFailure(x, t.label, t), name);
  }
});
