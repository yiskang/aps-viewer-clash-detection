// test/acceptance/clashpanel-viewerbridge.acceptance.node-partial-transfer.test.mjs
//
// Node-authoritative completed-result transfer (owner-authorized fix of the 2026-10-02 independent re-review H1).
// Completed post-C1 check/control results used to live only in the page `partialSink`: if the attribution-clear fence
// refused AND the cleanup-entry fence refused, g2RunPhases rethrew without transferring them and Node committed a
// `post-c1-untransferred` R1 claiming executed work was blocked / not started. Now the runner awaits a RETAIN fence
// (`__g2NodeSync('retain')`) after merging a phase's results and BEFORE the clear fence; Node ingests the page ordinals
// (drain-style), keeps its OWN snapshot rewritten through the ordinal->seq map (`authority.retainPageSnapshot`), and the
// transport-failure branch of runPostReservation uses that snapshot as the post-C1 history source.
//
// End to end through the REAL main() -> runPostReservation -> cleanup -> closeoutProtocol on a wired sandbox copy of the
// harness (LIVE_PATH_WIRED=true and the fake viewer's SHA only, as mainflow.test.mjs) with a recording fake fs and fake
// Playwright; the page is the REAL page-agent bundle (built from that copy) running the REAL g2RunPhases in node:vm (only
// the Viewer-bound env / drivers substituted, as final-transfer.test.mjs), talking to the REAL bindings runPostReservation
// exposed through a delayed JSON channel. Durable R1/R2/R3/K + the reader are checked. Non-vacuity: copies with the
// runner's retain hook removed (old behaviour) or with Node ignoring its retained snapshot lose the completed history.
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

// ---- anchors of the fix (each asserted to occur exactly once) and the two "old behaviour" mutations --------------------
const RETAIN_HOOK = "    if (sync && typeof sync.retain === 'function') await sync.retain();\n";
const CLEAR_FENCE = '    await setAttr({ activeCheck: null, activeControl: null });\n    let taintNow';
const TRANSPORT_RETAINED = 'markers: ingestedMarkers, retained: retainedRun });';
const SYNC_RETAIN_ACTION = "if (action === 'retain') {";
const OLD_NO_RETAIN_SOURCE = replaceOnce(SOURCE, RETAIN_HOOK, ''); // pre-fix page: completed results only in partialSink
const OLD_NODE_IGNORES_SOURCE = replaceOnce(SOURCE, TRANSPORT_RETAINED, 'markers: ingestedMarkers });'); // Node drops its own copy

// ---- wired sandbox copies (main() runs past W0 only on a copy; mainflow.test.mjs pattern) ---------------------------
const FAKE_VIEWER_BODY = Buffer.from('/* fake viewer3D.js body for the offline dry run */\n');
const wired = (src) => replaceOnce(replaceOnce(src, 'const LIVE_PATH_WIRED = false;', 'const LIVE_PATH_WIRED = true;'),
  `const EXPECTED_VIEWER_SHA256 = '${H.EXPECTED_VIEWER_SHA256}';`, `const EXPECTED_VIEWER_SHA256 = '${sha(FAKE_VIEWER_BODY)}';`);
const SANDBOX = mkdtempSync(path.join(os.tmpdir(), 'g2-node-partial-'));
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
  const dir = path.join(SANDBOX, name);
  mkdirSync(dir);
  const file = path.join(dir, 'clashpanel-viewerbridge.acceptance.mjs');
  writeFileSync(file, text);
  return { name, M: await import(pathToFileURL(file).href), text, bundle: pageBundle(text) };
}
const CUR = await copyOf('current', SOURCE);
const OLD_PAGE = await copyOf('old-no-retain', OLD_NO_RETAIN_SOURCE);
const OLD_NODE = await copyOf('old-node-ignores', OLD_NODE_IGNORES_SOURCE);

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

// ---- fence injection on the page -> Node sync channel -------------------------------------------------------------------
// `phase` = the phase whose fences are targeted (tracked from the attribution reports). Every tamper bumps the reported
// high-water by one, so Node refuses (`ingest-hw-mismatch`, one violation) and ingests nothing.
const inj = {
  /** the attribution-clear fence of `phase` (its first all-null attribution after a check/control of that phase was begun) */
  clear: (phase) => ({ phase, clear: true }),
  /** the retain fence of `phase` */
  retain: (phase) => ({ phase, retain: true }),
  /** the phase-marker fence of `phase` */
  mark: (phase) => ({ phase, mark: true }),
};
/** `entry: true` additionally refuses the cleanup-entry fence (attribution `cleanup`). */
function tamperer(specs, { entry = false } = {}) {
  const st = { phase: null, active: new Set(), clearHit: new Set(), markHit: new Set() };
  return (a) => {
    const [action, arg] = a;
    if (action === 'attribution') {
      const first = arg.phase !== st.phase;
      st.phase = arg.phase;
      if (entry && arg.phase === 'cleanup') { arg.hw += 1; return; }
      const nulls = arg.activeCheck === null && arg.activeControl === null;
      for (const s of specs) {
        if (s.mark && first && arg.phase === s.phase && !st.markHit.has(s.phase)) { st.markHit.add(s.phase); arg.hw += 1; return; }
        if (s.clear && arg.phase === s.phase && nulls && st.active.has(s.phase) && !st.clearHit.has(s.phase)) { st.clearHit.add(s.phase); arg.hw += 1; return; }
      }
      if (!nulls) st.active.add(arg.phase);
    }
    if (action === 'retain') for (const s of specs) if (s.retain && st.phase === s.phase) { arg.hw += 1; return; }
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
    version: () => '999.0.0.0-fake', on: (ev, fn) => browserEmitter.on(ev, fn), off: (ev, fn) => browserEmitter.off(ev, fn),
    async newContext() { return context; }, async close() { closed.browser = true; browserEmitter.emit('disconnected'); }, isConnected: () => !closed.browser,
  };
  const deps = {
    fs, repoRoot: ROOT,
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

// ==========================================================================================
// static
// ==========================================================================================

test('static: retain hook precedes the clear fence in runPhase; g2RunPhases binds it; the Node sync binding has the retain action; the transport branch passes Node\'s retained snapshot; live stays dormant', () => {
  const runner = H.locateFunctionSource(SOURCE, 'runChecksInPhaseOrder');
  const rt = SOURCE.slice(runner.start, runner.end);
  assert.equal(rt.split(RETAIN_HOOK).length - 1, 1);
  assert.ok(rt.indexOf('if (got.extras) Object.assign(extras, got.extras);') < rt.indexOf(RETAIN_HOOK) && rt.indexOf(RETAIN_HOOK) < rt.indexOf(CLEAR_FENCE), 'merge -> retain -> clear');
  const g2 = H.locateFunctionSource(SOURCE, 'g2RunPhases');
  assert.ok(SOURCE.slice(g2.start, g2.end).includes('retain: async () => nodeSync.retainSnapshot(g2RetainSnapshot('));
  const rpr = H.locateFunctionSource(SOURCE, 'runPostReservation');
  const rprText = SOURCE.slice(rpr.start, rpr.end);
  assert.equal(rprText.split(SYNC_RETAIN_ACTION).length - 1, 1);
  assert.equal(rprText.split('const retainedRun = authority.retained();').length - 1, 1);
  assert.equal(rprText.split(TRANSPORT_RETAINED).length - 1, 1);
  assert.equal(H.LIVE_PATH_WIRED, false);
  assert.equal(H.G2_DUAL_COUNTER_GATE.resolved, true);
});

// ==========================================================================================
// authority unit: retainPageSnapshot (validation, remap, fail-closed, latest wins)
// ==========================================================================================

test('authority.retainPageSnapshot: ingests like drain, keeps Node\'s own REMAPPED copy (no page ordinal survives); latest snapshot replaces; malformed / hw-mismatch / unmapped / gap => exactly ONE violation each, nothing stored, previous snapshot kept', () => {
  const B = H.PAGE_LOCAL_BASE;
  const allocator = H.createRunSeqAllocator();
  allocator.next(); allocator.next(); // Node-origin seqs already handed out
  const violations = [];
  const a = H.createRunAuthority({ allocator, attribution: { phase: 'P3', activeCheck: 'C2', activeControl: null }, onViolation: (r) => violations.push(r) });
  const A = { phase: 'P3', activeCheck: 'C2', activeControl: null };
  const snap = (hw, extra = {}) => ({ partial: { checks: { C2: { recordType: 'check-run', verdict: 'PASS', reason: null, fields: {}, evidence: {} } }, controls: {} }, markers: [{ seq: B + 1, name: 'P3' }], eventLog: [{ seq: B + 2, kind: 'ran:C2', ref: `spyLedger:seq:${B + 3}` }], spyLedger: [{ seq: B + 3 }], stateSnapshots: [], screenshots: [], pageHighWater: hw, ...extra });
  const pend = [{ ord: B + 1, kind: 'alloc', label: 'marker:P3', ...A }, { ord: B + 2, kind: 'event', label: 'ran:C2', ...A }, { ord: B + 3, kind: 'spy', label: null, ...A }];
  assert.equal(a.retained(), null);
  assert.deepEqual(a.retainPageSnapshot({ pending: pend, hw: B + 3, snapshot: snap(B + 3) }), { ok: true });
  const r1 = a.retained();
  assert.deepEqual([r1.markers[0].seq, r1.eventLog[0].seq, r1.spyLedger[0].seq, r1.eventLog[0].ref], [3, 4, 5, 'spyLedger:seq:5'], 'rewritten through the ordinal->seq map');
  assert.equal(JSON.stringify(r1).match(/\d{16}/), null, 'no page ordinal survives');
  r1.markers.length = 0;
  assert.equal(a.retained().markers.length, 1, 'retained() hands out a copy');
  // refusals: each exactly one violation, nothing stored (the previous snapshot stays)
  const bad = [
    ['malformed (no partial)', { pending: [], hw: B + 3, snapshot: { ...snap(B + 3), partial: null } }, 'retain-snapshot-invalid'],
    ['malformed (no snapshot)', { pending: [], hw: B + 3 }, 'retain-snapshot-invalid'],
    ['fence hw mismatch', { pending: [{ ord: B + 4, kind: 'alloc', label: null, ...A }], hw: B + 5, snapshot: snap(B + 5) }, 'ingest-hw-mismatch'],
    ['gap', { pending: [{ ord: B + 6, kind: 'alloc', label: null, ...A }], hw: B + 6, snapshot: snap(B + 6) }, 'ingest-gap'],
    ['snapshot hw != ingested hw', { pending: [], hw: B + 3, snapshot: snap(B + 2) }, 'retain-hw-mismatch'],
    ['unmapped ordinal in the snapshot', { pending: [], hw: B + 3, snapshot: snap(B + 3, { spyLedger: [{ seq: B + 9 }] }) }, 'retain-ordinal-unmapped'],
  ];
  for (const [label, report, reason] of bad) {
    const before = violations.length;
    assert.deepEqual(a.retainPageSnapshot(report), { ok: false, reason }, label);
    assert.deepEqual(violations.slice(before), [reason], `${label}: exactly one violation`);
    assert.deepEqual(a.retained().eventLog, [{ seq: 4, kind: 'ran:C2', ref: 'spyLedger:seq:5' }], `${label}: previous snapshot kept`);
  }
  // a later accepted snapshot replaces the earlier one
  const more = [{ ord: B + 4, kind: 'event', label: 'ran:C3', ...A }];
  const s2 = snap(B + 4, { eventLog: [{ seq: B + 2, kind: 'ran:C2' }, { seq: B + 4, kind: 'ran:C3' }] });
  assert.deepEqual(a.retainPageSnapshot({ pending: more, hw: B + 4, snapshot: s2 }), { ok: true });
  assert.deepEqual(a.retained().eventLog.map((e) => e.seq), [4, 6]);
});

// ==========================================================================================
// end to end: both fences refuse after completed results => results retained in Node and in the durable R1
// ==========================================================================================

test('(1) C2 completed (P3 driver returns C2 only) -> attribution-clear refuses -> cleanup-entry refuses -> C2 retained in Node state and in R1 (C3 is the runner\'s own not-produced record, kept); R1/R2/R3/K valid; reader FAIL', async () => {
  const drvC2 = (pr) => {
    const d = drivers(pr);
    d.P3 = async (ctx) => { await ctx.beginCheck('C2'); pr.recorder.logEvent('ran:C2', { note: 'executed' }); return { checks: { C2: pr.t.makeCheckRecord({ verdict: 'PASS' }) } }; };
    return d;
  };
  const x = await run(CUR, { drv: drvC2, tamper: tamperer([inj.clear('P3')]) });
  const pf = assertFailChain(x, { source: 'node-phase-run-transport', c1Stage: 'post-c1' });
  assertRefusalOrdering(x, 'P3');
  const r1 = x.d.r1;
  assert.equal(vr(r1.checks.C2), 'PASS', 'C2 retained');
  assert.equal(vr(r1.checks.C3), 'BLOCKED(not-produced:P3)', 'the runner\'s own record for C3 (not produced), never fabricated as PASS');
  assert.equal(vr(r1.checks.C1), 'PASS');
  assert.ok(r1.controls.N1.executionRecord.started === true, 'N1 (P2) retained');
  for (const n of H.CHECK_NAMES.filter((c) => !['C1', 'C2', 'C3'].includes(c))) assert.equal(vr(r1.checks[n]), 'BLOCKED(phase-run-threw)', n);
  assert.equal(pf.activeCheck, null, 'Node\'s acknowledged activeCheck (C2) was retained as completed => not in flight');
  assert.deepEqual(x.r.state.checks.C2, r1.checks.C2, 'Node state == durable R1');
});

test('(2) C2+C3 completed -> both fences refuse -> both retained; (3) N1 completed (P2) -> both fences refuse -> N1 retained with its start/terminal seqs', async () => {
  const x = await run(CUR, { tamper: tamperer([inj.clear('P3')]) });
  assertFailChain(x, { source: 'node-phase-run-transport', c1Stage: 'post-c1' });
  assertRefusalOrdering(x, 'P3');
  assertTruthfulHistory(x.d.r1, { checks: checksThrough(['P3']), controls: controlsThrough(['P2', 'P3']) });
  assert.deepEqual([x.d.r1.phaseRunFailure.activeCheck, x.d.r1.phaseRunFailure.activeControl], [null, null]);

  const y = await run(CUR, { tamper: tamperer([inj.clear('P2')]) });
  assertFailChain(y, { source: 'node-phase-run-transport', c1Stage: 'post-c1' });
  assertRefusalOrdering(y, 'P2');
  assertTruthfulHistory(y.d.r1, { checks: ['C1'], controls: ['N1'] });
  const n1 = y.d.r1.controls.N1;
  assert.deepEqual([n1.state, n1.executionRecord.started], ['DETECTED', true]);
  assert.ok(n1.executionRecord.startSeq > y.d.r1.gates.C1.gateSeq, 'N1 started after the gate');
  assert.equal(y.d.r1.phaseRunFailure.activeControl, null, 'acknowledged activeControl N1 was retained as completed => not claimed in flight');
});

test('(4) mixed history (N1 in P2, C2+C3 in P3, C4+C5+N6 in P4) survives both refusals at P4; (8) later, not-started work is not fabricated (no record, no history for P5a..P11 items)', async () => {
  const x = await run(CUR, { tamper: tamperer([inj.clear('P4')]) });
  assertFailChain(x, { source: 'node-phase-run-transport', c1Stage: 'post-c1' });
  assertRefusalOrdering(x, 'P4');
  const done = ['P2', 'P3', 'P4'];
  assertTruthfulHistory(x.d.r1, { checks: checksThrough(done), controls: controlsThrough(done) });
  const r1 = x.d.r1;
  // (8) nothing after P4 started: no marker, no attributed history, no executed record
  const later = H.PHASE_ORDER.map((p) => p.id).slice(H.PHASE_ORDER.findIndex((p) => p.id === 'P5a')).filter((p) => /^P/.test(p));
  assert.deepEqual(r1.errorLedger.markers.map((m) => m.name), ['P0', 'P1', 'P2', 'P3', 'P4', 'closeout']);
  for (const k of ['eventLog', 'stateSnapshots']) assert.equal(r1[k].some((e) => later.includes(e.phase)), false, `${k}: no P5a+ history`);
  assert.equal(r1.spyLedger.records.some((e) => later.includes(e.phase)), false);
  for (const n of controlsThrough(later)) assert.equal(r1.controls[n].executionRecord.started, false, n);
  // the state snapshots retained are the phase baselines taken BEFORE the P4 retain (P1..P3); P4's baseline never ran
  assert.deepEqual(r1.stateSnapshots.map((s) => s.baselinePhase), ['P1', 'P2', 'P3']);
});

test('(5) retain succeeds (P3 complete and acknowledged), then the P4 marker fence refuses and cleanup entry refuses => truthful FAIL artifacts: P3 history retained, P4 not claimed; failure after the retained history', async () => {
  const x = await run(CUR, { tamper: tamperer([inj.mark('P4')]) });
  const pf = assertFailChain(x, { source: 'node-phase-run-transport', c1Stage: 'post-c1' });
  assertTruthfulHistory(x.d.r1, { checks: checksThrough(['P3']), controls: controlsThrough(['P2', 'P3']) });
  assert.deepEqual(violationsOf(x.r.state).map((e) => e.detail), ['cross-realm-fence:ingest-hw-mismatch', 'cross-realm-fence:ingest-attribution']);
  assert.equal(pf.phase, 'P3', 'Node\'s last acknowledged phase (the P4 marker was never acknowledged)');
  assert.equal(x.d.r1.errorLedger.markers.some((m) => m.name === 'P4'), false, 'the refused P4 marker is not claimed');
  assert.match(pf.message, /attribution sync refused by the node authority \(ingest-hw-mismatch\)/);
});

test('(6) retain itself fails => fail closed: the retain refusal IS the phase-run failure and is retained as a fatal violation; (a) cleanup entry ok => page failure transfer keeps P3 (merged before the retain); (b) cleanup entry refused too => only Node-accepted history (P2) is claimed, P3 BLOCKED', async () => {
  const a = await run(CUR, { tamper: tamperer([inj.retain('P3')]) });
  const pfa = assertFailChain(a, { source: 'page-phase-run', c1Stage: 'post-c1' });
  assert.match(pfa.message, /retain sync refused by the node authority \(ingest-hw-mismatch\)/);
  assert.deepEqual(violationsOf(a.r.state).map((e) => e.detail), ['cross-realm-fence:ingest-hw-mismatch'], 'the retain refusal, retained as fatal evidence');
  assert.equal(a.w.calls.filter((c) => c.action === 'retain' && !c.ok).length, 1);
  assertTruthfulHistory(a.d.r1, { checks: checksThrough(['P3']), controls: controlsThrough(['P2']) });
  assert.notEqual(a.d.r1.overall.verdict, 'PASS');

  const b = await run(CUR, { tamper: tamperer([inj.retain('P3')], { entry: true }) });
  const pfb = assertFailChain(b, { source: 'node-phase-run-transport', c1Stage: 'post-c1' });
  assert.match(pfb.message, /retain sync refused by the node authority \(ingest-hw-mismatch\)/);
  assert.deepEqual(violationsOf(b.r.state).map((e) => e.detail), ['cross-realm-fence:ingest-hw-mismatch', 'cross-realm-fence:ingest-hw-mismatch'], 'retain refusal + cleanup-entry refusal, both retained');
  assertTruthfulHistory(b.d.r1, { checks: ['C1'], controls: ['N1'] });
  assert.equal(pfb.activeCheck, 'C3', 'the in-flight check (acknowledged, never accepted as completed by Node)');
  assert.equal(b.d.r1.eventLog.some((e) => e.kind === 'ran:C2' || e.kind === 'ran:C3'), false, 'P3 history Node never accepted is not claimed');
});

test('(7) no duplicate history when the normal cleanup entry succeeds: a page fault at P5a after P4 was retained => the page failure transfer wins (source page-phase-run); the Node snapshot is NOT applied; every record once, cleanup provenance clean', async () => {
  let arm = null;
  const x = await run(CUR, { drv: (pr) => drivers(pr, { before: { P4: () => arm() } }), pageSetup: (pr) => { arm = pageFault(pr, 'at P5a'); } });
  const pf = assertFailChain(x, { source: 'page-phase-run', c1Stage: 'post-c1' });
  assert.equal(pf.cleanupEntry, 'marker-allocated');
  assertTruthfulHistory(x.d.r1, { checks: checksThrough(['P3', 'P4']), controls: controlsThrough(['P2', 'P3', 'P4']) });
  const r1 = x.d.r1;
  for (const k of ['eventLog', 'stateSnapshots']) assert.equal(new Set(r1[k].map((e) => e.seq)).size, r1[k].length, `${k}: every seq once`);
  assert.equal(new Set(r1.spyLedger.records.map((e) => e.seq)).size, r1.spyLedger.records.length);
  for (const u of ['C2', 'C3', 'C4', 'C5', 'N1', 'N6']) assert.equal(r1.eventLog.filter((e) => e.kind === `ran:${u}`).length, 1, `${u} history exactly once`);
  assert.deepEqual(violationsOf(x.r.state), [], 'no fence violation');
  assert.equal(x.r.state.errorLedger.entries.some((e) => /cleanup-evidence/.test(String(e.detail))), false, 'page-evidence/cleanup provenance complete (no duplicate, nothing missing)');
  assert.ok(x.w.rpcLog.includes('g2CleanupDrain'));
  // direct: a page failure transfer ignores a supplied Node snapshot (never both sources)
  const gate = { gateSeq: 4, gateAt: '2026-10-02T00:00:00.000Z', c1Verdict: 'PASS', c1Reason: null, c1FinalizedSeq: 3, fatalCountAtGate: 0, outcome: 'OPEN', notStarted: [] };
  const c1 = { ...H.makeCheckRecord({ verdict: 'PASS' }), finalizedSeq: 3, finalizedAt: '2026-10-02T00:00:00.000Z' };
  const st = { checks: {}, controls: {}, errorLedger: H.createEmptyErrorLedger(), authoritativeGate: gate };
  const seq = H.createRunSeqAllocator();
  for (let i = 0; i < 20; i += 1) seq.next();
  const retained = { partial: { checks: { C1: c1, C2: H.makeCheckRecord({ verdict: 'PASS' }) }, controls: {} }, eventLog: [{ seq: 9, kind: 'snapshot-only' }], spyLedger: [], stateSnapshots: [], screenshots: [], markers: [] };
  H.applyPhaseRunFailureToState(st, { phaseRunFailure: { name: 'Error', message: 'x', phase: 'P3', seq: 15, cleanupEntry: 'marker-allocated' }, partial: { checks: { C1: c1 }, controls: {} }, eventLog: [] }, { nextSeq: seq.next, retained });
  assert.equal(vr(st.checks.C2), 'BLOCKED(phase-run-threw)', 'the page transfer (without C2) wins');
  assert.equal(st.eventLog.some((e) => e.kind === 'snapshot-only'), false);
});

test('(9) the reader returns FAIL from the committed artifacts and the R1 bytes it verified (K.resultSha256) preserve the completed history; (10) every artifact of these runs is schema-valid (assertFailChain); an R1 that erases a retained executed record over its own history is a failed-run schema problem', async () => {
  const x = await run(CUR, { tamper: tamperer([inj.clear('P3')]) });
  assertFailChain(x, { source: 'node-phase-run-transport', c1Stage: 'post-c1' });
  assert.equal(x.d.k.resultSha256, sha(x.d.r1Bytes));
  const fromBytes = JSON.parse(x.d.r1Bytes.toString('utf8'));
  assert.deepEqual(['C2', 'C3'].map((c) => vr(fromBytes.checks[c])), ['PASS', 'PASS']);
  assert.equal(fromBytes.controls.N1.executionRecord.started, true);
  // erasure probe: C2 rewritten to BLOCKED(phase-run-threw) while its own ran:C2 history stays => failed-run schema problem
  const erased = clone(fromBytes);
  erased.checks.C2 = clone(fromBytes.checks.C5);
  assert.ok(H.failedRunRecordProblems(erased).includes('failed-run-blocked-check-has-history:C2'), JSON.stringify(H.failedRunRecordProblems(erased)));
});

test('(11) PASS path unchanged: an all-PASS run with the retain fences is PASS, R1.phaseRunFailure null, reader PASS; every phase made exactly one accepted retain fence BEFORE its clear fence; Node verdict state identical to the pre-fix page (no retain hook) apart from timestamps', async () => {
  const x = await run(CUR);
  const y = await run(OLD_PAGE);
  assert.equal(x.r.finalOverall, y.r.finalOverall, 'same verdict as the pre-fix page');
  assert.equal(x.r.finalOverall, 'PASS', JSON.stringify(x.r.closeout && x.r.closeout.causes));
  assert.deepEqual([x.d.r1.phaseRunFailure, x.reader.verdict, x.d.k.finalOverall], [null, 'PASS', 'PASS']);
  assert.deepEqual(H.validateResultSchema(x.d.r1, 'payload').errors, []);
  assert.deepEqual(violationsOf(x.r.state), []);
  const retains = x.w.calls.filter((c) => c.action === 'retain');
  const ran = H.PHASE_ORDER.filter((p) => /^P\d/.test(p.id) && p.id !== 'P0').length;
  assert.equal(retains.length, ran, 'one retain per executed phase');
  assert.ok(retains.every((c) => c.ok));
  for (let i = 0; i < x.w.calls.length; i += 1) {
    if (x.w.calls[i].action !== 'retain') continue;
    const next = x.w.calls.slice(i + 1).find((c) => c.action === 'attribution');
    assert.deepEqual([next.activeCheck, next.activeControl], [null, null], 'the fence right after a retain is that phase\'s clear fence');
  }
  assert.equal(y.w.calls.filter((c) => c.action === 'retain').length, 0, 'pre-fix page: no retain fence');
  const iso = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
  const norm = (v) => JSON.parse(JSON.stringify(v, (k, val) => (typeof val === 'string' && iso.test(val) ? 'T' : val)));
  for (const k of ['checks', 'controls', 'gates', 'eventLog', 'stateSnapshots', 'n6', 'phaseRunFailure', 'overall']) assert.deepEqual(norm(x.d.r1[k]), norm(y.d.r1[k]), k);
  assert.deepEqual(norm(x.d.r1.spyLedger.records), norm(y.d.r1.spyLedger.records));
  assert.deepEqual(norm(x.d.r1.errorLedger.markers), norm(y.d.r1.errorLedger.markers));
});

test('(12) mutation: the OLD behaviour (no retain fence: completed results only in partialSink, g2RunPhases rethrows before any transfer) and a Node that ignores its retained snapshot both LOSE the completed history (post-c1-untransferred, everything BLOCKED/unstarted) -- and the truthful-history assertions catch it', async () => {
  for (const copy of [OLD_PAGE, OLD_NODE]) {
    const x = await run(copy, { tamper: tamperer([inj.clear('P3')]) });
    // the artifact chain is still schema-valid FAIL (verdict-safe) ...
    const pf = assertFailChain(x, { source: 'node-phase-run-transport', c1Stage: 'post-c1-untransferred' });
    assert.equal(x.d.r1.gates, null, copy.name);
    // ... but its history is false: executed C1..C3 / N1 claimed blocked / not started
    assert.ok(H.CHECK_NAMES.every((n) => vr(x.d.r1.checks[n]) === `BLOCKED(phase-run-${pf.status})`), copy.name);
    assert.equal(x.d.r1.controls.N1.executionRecord.started, false, copy.name);
    assert.throws(() => assertTruthfulHistory(x.d.r1, { checks: checksThrough(['P3']), controls: controlsThrough(['P2', 'P3']) }), copy.name);
  }
  // the fixed harness on the same scenario keeps it (contrast)
  const fixed = await run(CUR, { tamper: tamperer([inj.clear('P3')]) });
  assertTruthfulHistory(fixed.d.r1, { checks: checksThrough(['P3']), controls: controlsThrough(['P2', 'P3']) });
});
