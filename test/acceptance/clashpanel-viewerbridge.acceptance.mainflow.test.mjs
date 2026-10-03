// test/acceptance/clashpanel-viewerbridge.acceptance.mainflow.test.mjs
//
// Offline end-to-end DRY RUN of the G2 main flow (procedure §4.1 W0-W3 + Phase 0, §5 phase order,
// §9 cleanup, §9.1 closeout, §8 exit codes) with an ENTIRELY FAKE browser package, page, viewer
// and filesystem. main() is never run on the real harness module: the dormant refusal is asserted on a
// copy with LIVE_PATH_WIRED FORCED false (support/g2-harness-copy.mjs; the real value is pinned only in
// live-path-isolation.test.mjs). To exercise the wired flow, this file imports a MUTATED COPY of the harness
// written to an os.tmpdir() sandbox (<SANDBOX>/test/acceptance/<harness>, so the copy's own REPO_ROOT is the
// sandbox) with exactly two constants changed -- LIVE_PATH_WIRED FORCED true
// (G2_DUAL_COUNTER_GATE.resolved is already true in the real harness; M2 uses a second copy with it forced
// back to false) and EXPECTED_VIEWER_SHA256 = the SHA-256 of this
// file's fake viewer3D.js body -- and drives its
// main() with deps: a recording fake fs, a fake git, a fake module server and a fake browser
// package whose page answers the in-page registry keys. Nothing here imports playwright, launches a
// browser, touches the network, or writes under test/acceptance/results/.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as REAL from './clashpanel-viewerbridge.acceptance.mjs';
import { forceLivePathWired, importDormantHarness } from './support/g2-harness-copy.mjs';
import { passingRuntimeGateSeams } from './support/g2-runtime-gate-fakes.mjs';

const vr = REAL.checkVerdictLabel;

const HARNESS_FILE = fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url));
const REAL_SOURCE = readFileSync(HARNESS_FILE, 'utf8');
const sha = (b) => createHash('sha256').update(b).digest('hex');

// ---- the mutated copy (tmp sandbox) -------------------------------------------------------------

const FAKE_VIEWER_BODY = Buffer.from('/* fake viewer3D.js body for the offline dry run */\n');
const SHA_LINE = `const EXPECTED_VIEWER_SHA256 = '${REAL.EXPECTED_VIEWER_SHA256}';`;
const GATE_LINE = "const G2_DUAL_COUNTER_GATE = Object.freeze({ resolved: true, ";
assert.equal(REAL_SOURCE.split(SHA_LINE).length - 1, 1);
assert.equal(REAL_SOURCE.split(GATE_LINE).length - 1, 1);
const WIRED_ONLY_SOURCE = forceLivePathWired(REAL_SOURCE, true).replace(SHA_LINE, `const EXPECTED_VIEWER_SHA256 = '${sha(FAKE_VIEWER_BODY)}';`);
const MUTATED_SOURCE = WIRED_ONLY_SOURCE;
const UNRESOLVED_SOURCE = WIRED_ONLY_SOURCE.replace(GATE_LINE, 'const G2_DUAL_COUNTER_GATE = Object.freeze({ resolved: false, ');
const SANDBOX = mkdtempSync(path.join(os.tmpdir(), 'g2-mainflow-'));
const MUTATED_FILE = path.join(SANDBOX, 'test', 'acceptance', 'clashpanel-viewerbridge.acceptance.mjs');
mkdirSync(path.dirname(MUTATED_FILE), { recursive: true });
writeFileSync(MUTATED_FILE, MUTATED_SOURCE);
const H = await import(pathToFileURL(MUTATED_FILE).href);
// M2: a copy with the wiring flag set but the gate forced back to unresolved.
const WIRED_ONLY_FILE = path.join(SANDBOX, 'wired-only', 'test', 'acceptance', 'clashpanel-viewerbridge.acceptance.mjs');
mkdirSync(path.dirname(WIRED_ONLY_FILE), { recursive: true });
writeFileSync(WIRED_ONLY_FILE, UNRESOLVED_SOURCE);
const HW = await import(pathToFileURL(WIRED_ONLY_FILE).href);
after(() => { rmSync(SANDBOX, { recursive: true, force: true }); });

// ---- fixture: repo tree in the fake fs + a valid authorization record ---------------------------

const ROOT = '/repo';
const HEAD = '82dab8244d8d83f3cb824b05199d7a2ce5b0f2e0';
const RECORD = 'docs/prompts/g2-live-authorization.md';
const AUTH_ID = 'g2-live-dryrun-0001';
// The real accepted procedure bytes: W1 binds ACCEPTED_PROCEDURE_SHA256, so a stand-in would be refused
// (`procedure-sha256-not-accepted`) before reservation.
const PROC_BYTES = readFileSync(path.join(path.dirname(HARNESS_FILE), '..', '..', H.PROCEDURE_REL_PATH), 'utf8');
assert.equal(sha(Buffer.from(PROC_BYTES)), H.ACCEPTED_PROCEDURE_SHA256);
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

const PASS_CHECK = () => ({ recordType: 'check-run', verdict: 'PASS', reason: null, fields: {}, evidence: {} });
const AT = '2026-09-30T00:00:01.000Z';

function passRun(over = {}) {
  const checks = {};
  for (const n of H.CHECK_NAMES) checks[n] = PASS_CHECK();
  checks.C1 = { ...checks.C1, finalizedSeq: 1, finalizedAt: AT };
  const controls = {};
  H.CONTROL_NAMES.forEach((n, i) => {
    controls[n] = H.makeControlRunRecord(n, { state: H.CONTROL_ACCEPTABLE_STATE[n], fields: {}, evidence: {} }, { start: { startSeq: 10 + 2 * i, startedAt: AT }, terminalSeq: 11 + 2 * i, terminalAt: AT });
  });
  return {
    checks, controls, subchecks: {}, extras: { c4Table: [], sceneOwnership: [], c17: null, c20: null, eventLog: [] },
    // slice B2: every runner result carries the global C1 gate (OPEN for an all-PASS run) and C1's single check-finalized event
    c1FinalizedEvent: { seq: 1, kind: 'check-finalized', check: 'C1', verdict: 'PASS', reason: null, phase: 'P1', activeCheck: 'C1', activeControl: null },
    gates: { C1: { gateSeq: 2, gateAt: AT, c1Verdict: 'PASS', c1Reason: null, c1FinalizedSeq: 1, fatalCountAtGate: 0, outcome: 'OPEN', notStarted: [] } },
    markers: [{ seq: 0, name: 'P1' }, { seq: 3, name: 'P2' }, { seq: 40, name: 'cleanup' }],
    spyInstall: null, sessionTainted: false, taintPhase: null, phaseLog: [], spyLedger: [], screenshots: [], stateSnapshots: [],
    staleContinuationsDropped: 0, ...over,
  };
}

/**
 * H1 single-Node-allocator model: the page numbers its records with NON-AUTHORITATIVE page-local ordinals
 * (`createPageOrdinalSource`, values > PAGE_LOCAL_BASE) and delivers them to Node through the real exposed
 * bindings' contract (`{pending, hw}` reports exactly like g2FenceReport; here the final drain fence of
 * `__g2NodeSync`). Node ingests them in ordinal order (allocating the authoritative seqs) and the final
 * transfer rewrites the run through the ordinal->seq map. The passRun fixture is written as plain small
 * ordinals 0,1,2,...; the fake page maps every ordinal s to the page-local ordinal BASE + s + 1 and then
 * reports the contiguous pending queue 1..max (what a page allocating that many ordinals would hold).
 * Runs built by the REAL runner (`absoluteSeqs`) carry real page-local ordinals from a real
 * `createPageOrdinalSource()` that the test hands over as `pageSource` (its real pending queue is reported).
 */
const PAGE_BASE = H.PAGE_LOCAL_BASE;
const pageSeqOf = (s) => PAGE_BASE + s + 1;
const ACK_ATTR = Object.freeze({ phase: 'P1', activeCheck: null, activeControl: null }); // what Node acknowledged before g2RunPhases
function maxOrdinalOf(run) {
  let max = PAGE_BASE;
  const visit = (v) => {
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (Number.isInteger(x) && /Seq$|^seq$/.test(k) && H.isPageLocalOrdinal(x)) max = Math.max(max, x);
      else visit(x);
    }
  };
  visit(run);
  return max;
}
/**
 * Per-world fake-page ordinal queue (what the real page's `g.seq` page-ordinal source holds), keyed by the
 * bindings object: `last` = the page high-water, `pending` = allocated-but-unacknowledged entries,
 * `runHw` = `g.runResultHw` (the cleanup-delta boundary), `fatalSent` = `g.pageFatalSent`.
 */
const PAGE_Q = new WeakMap();
function pageQueue(bindings) {
  if (!PAGE_Q.has(bindings)) PAGE_Q.set(bindings, { last: PAGE_BASE, pending: [], runHw: null, fatalSent: 0 });
  return PAGE_Q.get(bindings);
}
/** A fake-page fence report `{pending, hw}` exactly like g2FenceReport (every unacknowledged ordinal + the page high-water). */
const fenceReport = (bindings) => { const q = pageQueue(bindings); return { pending: q.pending.map((e) => ({ ...e })), hw: q.last }; };
/** Like g2FenceAck: prunes acknowledged entries only after Node accepted the fence. */
const fenceAck = (bindings, report, result) => { if (result && result.ok === true) { const q = pageQueue(bindings); q.pending = q.pending.filter((e) => e.ord > report.hw); } };
const CLEANUP_ATTR = Object.freeze({ phase: 'cleanup', activeCheck: null, activeControl: null });
/** The fake page's final drain fence: `{pending, hw}` through the real `__g2NodeSync` binding, then the transfer fields. */
async function pageTransfer(run, bindings) {
  if (!run || typeof run !== 'object') return run;
  // (ADDENDUM 4) `attributionFence: {upTo, attribution}`: the page crossed an attribution change during the run (g2RunPhases'
  // mark('cleanup')): the pending entries keep their OWN attribution, entries <= upTo go through the real attribution
  // fence (`__g2NodeSync('attribution', ...)` -> authority.syncPage, which adopts `attribution`), the rest through the drain.
  const { pageSource = null, leakUningested = false, attributionFence = null, ...rest } = run;
  let pending;
  if (leakUningested) pending = []; // a faulty page: it never reports its ordinals to Node (hw stays at the base)
  else if (pageSource) pending = pageSource.pending();
  else {
    // the kind a real recorder would have tagged each ordinal with (stamp('spy'|'event'|'snapshot'); everything else 'alloc')
    // and its label (ADDENDUM 5: an event ordinal MUST carry its event's own kind -- Node refuses an unlabeled one;
    // a marker ordinal carries `marker:<name>` like the real runner's mark(); spy/snapshot/other allocs carry null)
    const kindOf = new Map();
    const labelOf = new Map();
    for (const [k, kind] of [['spyLedger', 'spy'], ['eventLog', 'event'], ['stateSnapshots', 'snapshot']]) {
      for (const e of rest[k] || []) if (e && H.isPageLocalOrdinal(e.seq)) { kindOf.set(e.seq, kind); if (kind === 'event') labelOf.set(e.seq, e.kind); }
    }
    for (const m of rest.markers || []) if (m && H.isPageLocalOrdinal(m.seq) && !kindOf.has(m.seq)) labelOf.set(m.seq, `marker:${m.name}`);
    const max = maxOrdinalOf(rest); pending = [];
    for (let o = PAGE_BASE + 1; o <= max; o += 1) pending.push({ ord: o, kind: kindOf.get(o) || 'alloc', label: labelOf.has(o) ? labelOf.get(o) : null, ...ACK_ATTR });
  }
  if (attributionFence === null) pending = pending.map((e) => ({ ...e, ...ACK_ATTR })); // the page stayed in P1/no active check for the whole fake run
  const hw = pending.length ? pending[pending.length - 1].ord : PAGE_BASE;
  const pageFatalSent = Number.isInteger(rest.pageFatalSent) ? rest.pageFatalSent : 0;
  if (attributionFence !== null) {
    const head = pending.filter((e) => e.ord <= attributionFence.upTo);
    const s = await bindings[H.G2_NODE_SYNC_BINDING]('attribution', { ...attributionFence.attribution, pending: head, hw: attributionFence.upTo });
    if (!s || s.ok !== true) throw new Error(`attribution sync refused by the node authority (${s && s.reason})`);
    pending = pending.filter((e) => e.ord > attributionFence.upTo);
  }
  const r = await bindings[H.G2_NODE_SYNC_BINDING]('drain', { pending, hw, pageFatalSent });
  if (!r || r.ok !== true) throw new Error(`drain sync refused by the node authority (${r && r.reason})`);
  if (pageSource && !leakUningested) pageSource.ack(hw);
  // g2RunPhases sets g.runResultHw right before it builds its result: everything allocated later is cleanup evidence.
  Object.assign(pageQueue(bindings), { last: hw, pending: [], runHw: hw, fatalSent: pageFatalSent });
  return { pageHighWater: hw, pageFatalSent, ...rest };
}
function shiftRunSeqs(run) {
  if (run && run.absoluteSeqs === true) { const { absoluteSeqs, ...rest } = run; void absoluteSeqs; return rest; }
  if (!run || typeof run !== 'object') return run;
  const r = JSON.parse(JSON.stringify(run));
  const sh = (o, k) => { if (o && Number.isInteger(o[k])) o[k] = pageSeqOf(o[k]); };
  for (const m of r.markers || []) sh(m, 'seq');
  if (r.c1FinalizedEvent) sh(r.c1FinalizedEvent, 'seq');
  if (r.gates && r.gates.C1) { sh(r.gates.C1, 'gateSeq'); sh(r.gates.C1, 'c1FinalizedSeq'); }
  if (r.checks && r.checks.C1) sh(r.checks.C1, 'finalizedSeq');
  for (const c of Object.values(r.controls || {})) {
    if (c && c.executionRecord) { sh(c.executionRecord, 'startSeq'); sh(c.executionRecord, 'terminalSeq'); }
    if (c && c.recordType === 'gate-disposition') sh(c, 'dispositionSeq');
  }
  for (const c of Object.values(r.checks || {})) if (c && c.recordType === 'gate-disposition') sh(c, 'dispositionSeq');
  for (const k of ['eventLog', 'spyLedger', 'stateSnapshots']) for (const e of r[k] || []) sh(e, 'seq');
  if (r.extras) for (const e of r.extras.eventLog || []) sh(e, 'seq');
  return r;
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
  // `opts.mod`: a further-mutated harness copy (non-vacuity tests); its text must then be `opts.harnessText` too.
  const M = opts.mod ?? H;
  const harnessText = opts.harnessText ?? MUTATED_SOURCE;
  const fs = M.createRecordingFakeFs({
    seedDirs: [`${ROOT}/docs/prompts`, `${ROOT}/docs/research`, `${ROOT}/test/acceptance`, `${ROOT}/node_modules/playwright`],
    seedFiles: {
      [`${ROOT}/${M.PROCEDURE_REL_PATH}`]: PROC_BYTES,
      [`${ROOT}/${M.HARNESS_REL_PATH}`]: harnessText,
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
  // ---- the fake page's cleanup-phase evidence (H1 cleanup completeness) ----
  // The real page keeps ONE recorder on the page-ordinal source for the whole session; after g2RunPhases the
  // runner's last attribution is the acknowledged `cleanup` phase, so every record a cleanup step produces
  // (spy records of still-wrapped Viewer calls, `wrapper-restore` events, a cleanup baseline snapshot) gets a
  // page-local ordinal of kind spy/event/snapshot with cleanup attribution. Here a REAL createCallRecorder
  // draws its ordinals from the fake page queue (continuing after the run's high-water).
  // (ADDENDUM 3) like the real page-ordinal source, each entry carries the recorder's `label` (an event's own kind;
  // null for spy/snapshot). (ADDENDUM 5) `opts.unlabeledEvents` models a FAULTY page source that registers no label for
  // its event ordinals: Node now refuses such an entry at the fence (ingest-entry-invalid), it is never exempt.
  const cleanupRec = M.createCallRecorder({
    nextSeq: (attr, kind, label) => { const q = pageQueue(bindings); q.last += 1; q.pending.push({ ord: q.last, kind, ...attr, label: opts.unlabeledEvents && kind === 'event' ? null : label }); return q.last; },
  });
  cleanupRec.setAttribution(CLEANUP_ATTR);
  const cleanupSnapshots = [];
  /** What the page-owned cleanup step `name` records on the page (before the step's Node-visible result). */
  const emitCleanupEvidence = (name) => {
    if (opts.noCleanupEvidence) return;
    if (name === 'bridgeDispose') cleanupRec.withOrigin('harness', () => cleanupRec.record('overlays.removeScene', ['clash-panel-markers:g2a'])); // still wrapped at this step
    if (name === 'restoreRecordingWrappers') {
      for (const label of ['overlays.removeScene', 'viewer.isolate']) cleanupRec.logEvent('wrapper-restore', { label, layer: 'recording', ok: true });
    }
    if (name === 'verifyViewerStateBaseline') cleanupSnapshots.push({ ...cleanupRec.stamp('snapshot'), baselinePhase: 'cleanup', loadedModels: ['A', 'B'], isolationEmpty: true, hiddenEmpty: true });
  };
  /**
   * The fake g2CleanupDrain, mirroring the real in-page function (ADDENDUM 5: a bounded STABLE-FENCE loop of at most
   * DRAIN_ROUNDS rounds): each round snapshots the cleanup DELTA (seq > runResultHw) + page high-water in the same tick
   * as the fence report, awaits the drain fence through the REAL `__g2NodeSync` binding (`{pending, hw, pageFatalSent}`),
   * acks on success, and returns `{ok:true, delta}` only once the page high-water did not move across the awaited
   * fence; otherwise it repeats; after DRAIN_ROUNDS rounds `{ok:false, error:{message:'cleanup drain did not stabilize'}}`.
   * `mutate(delta)` lets a test corrupt the returned delta AFTER a correct fence; `duringFence(round)` runs while a
   * round's fence is in flight (after its report was taken, before its result is awaited) -- a cleanup callback.
   */
  const DRAIN_ROUNDS = 8;
  const pageCleanupDrain = async ({ mutate = null, duringFence = null } = {}) => {
    const q = pageQueue(bindings);
    const after = q.runHw === null ? PAGE_BASE : q.runHw;
    for (let round = 0; round < DRAIN_ROUNDS; round += 1) {
      const delta = JSON.parse(JSON.stringify({
        spyLedger: cleanupRec.records.filter((r) => r.seq > after),
        eventLog: cleanupRec.events.filter((e) => e.seq > after),
        stateSnapshots: cleanupSnapshots.filter((e) => e.seq > after),
        pageHighWater: q.last, pageFatalSent: q.fatalSent,
      }));
      const report = fenceReport(bindings);
      log.push({ kind: 'page', call: 'cleanup-drain', round, pageClosed: closed.page, report: { hw: report.hw, kinds: report.pending.map((e) => e.kind) } });
      const inFlight = bindings[M.G2_NODE_SYNC_BINDING]('drain', { ...report, pageFatalSent: q.fatalSent });
      if (duringFence) duringFence(round);
      const r = await inFlight;
      if (!r || r.ok !== true) return { ok: false, delta: null, error: { name: 'Error', message: `drain sync refused by the node authority (${r && r.reason})` } };
      fenceAck(bindings, report, r);
      if (q.last === delta.pageHighWater) return { ok: true, delta: mutate ? mutate(delta) : delta, error: null };
    }
    return { ok: false, delta: null, error: { name: 'Error', message: 'cleanup drain did not stabilize' } };
  };
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
    g2CleanupDrain: () => pageCleanupDrain(),
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
        const req = { resourceType: () => 'script', redirectedFrom: () => null, url: () => M.G2_VIEWER_SCRIPT_URL };
        pageEmitter.emit('response', { request: () => req, status: () => 200, fromServiceWorker: () => false, body: async () => FAKE_VIEWER_BODY });
      }
    },
    async waitForFunction() { log.push({ kind: 'pw', call: 'waitForFunction' }); if (opts.world && opts.world.bootstrapThrows) throw new Error('bootstrap not ready'); return true; },
    async evaluate(fn, payload) {
      assert.equal(fn, M.G2_PAGE_DISPATCH, 'every page call goes through the single registry dispatcher');
      log.push({ kind: 'rpc', key: payload.key, arg: payload.arg });
      const h = handlers[payload.key];
      if (typeof h !== 'function') throw new Error(`no fake handler for ${payload.key}`);
      if (payload.key === 'g2CleanupStep') emitCleanupEvidence(payload.arg && payload.arg.name);
      // passRun numbers ordinals from 0; the fake page maps them to page-local ordinals (see shiftRunSeqs)
      // and delivers them to Node through the real sync binding (pageTransfer); Node allocates every authoritative seq.
      if (payload.key === 'g2RunPhases') {
        assert.equal(payload.arg && Object.hasOwn(payload.arg, 'seqBase'), false, 'g2RunPhases no longer receives a seqBase');
        return pageTransfer(shiftRunSeqs(await h(payload.arg, { page, log })), bindings);
      }
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
    // live plan §3.1: the Phase-0 browser-launch step requires exactly the headless-shell version; a world may override it.
    version: () => { if (opts.world && opts.world.versionThrows) throw new Error('version unavailable'); return opts.world && Object.hasOwn(opts.world, 'browserVersion') ? opts.world.browserVersion : REAL.G2_REQUIRED_RUNTIME.headlessShell.browserVersion; },
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
    runtimeGateSeams: passingRuntimeGateSeams({ repoRoot: ROOT, required: REAL.G2_REQUIRED_RUNTIME }).seams,
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
    commitFs: { linkSync: M.brandSyncLinkForTest((a, b) => fs.link(a, b)) },
    allowTestLinkPrimitive: true,
    timers: makeTimers(opts.fireNow || []),
    print: (l) => { print.push(l); },
    proc,
    onEvent: (e) => { log.push({ kind: 'event', ...e }); },
  };
  return { fs, log, deps, page, browser, closed, routes, bindings, print, proc, handlers, getInitScript: () => initScript, durableJournalStates, mod: M, cleanupPage: { recorder: cleanupRec, snapshots: cleanupSnapshots, drain: pageCleanupDrain, queue: () => pageQueue(bindings) } };
}

async function runMain(w) {
  return w.mod.main({ argv: ARGV, env: ENV, deps: w.deps });
}

function readerVerdict(w) {
  return H.deriveVerdictFromArtifacts({ ...H.readArtifactFileMap({ fs: w.fs.processCrashView(), chain: CHAIN }), authorizationId: AUTH_ID });
}

const idx = (log, pred) => log.findIndex(pred);
const isJournalRename = (e) => e.kind === 'fs' && e.op === 'rename' && e.to === JOURNAL_PATH;

// ------------------------------------------------------------------------------------------
// A DORMANT copy (LIVE_PATH_WIRED forced false) => nothing is read, written, imported or launched.
// ------------------------------------------------------------------------------------------

test('dormant copy (LIVE_PATH_WIRED forced false): main() refuses right after W0 with no fs/git/browser/event activity', async () => {
  const { module: DORMANT } = await importDormantHarness();
  assert.equal(DORMANT.LIVE_PATH_WIRED, false);
  const calls = [];
  const trapFs = new Proxy({}, { get: (_t, k) => (...a) => { calls.push(['fs', String(k), ...a]); throw new Error('fs must not be touched'); } });
  const trapPkg = new Proxy({}, { get: (_t, k) => { calls.push(['browserPackage', String(k)]); throw new Error('browser package must not be touched'); } });
  await assert.rejects(
    DORMANT.main({ argv: ARGV, env: ENV, deps: { fs: trapFs, repoRoot: ROOT, gitHead: () => { calls.push(['gitHead']); return HEAD; }, git: () => { calls.push(['git']); return ''; }, browserPackage: trapPkg, onEvent: (e) => calls.push(['event', e]), serveModule: () => { calls.push(['serve']); } } }),
    (err) => err instanceof DORMANT.G2RefusalError && err.reason === 'live-path-not-wired',
  );
  assert.deepEqual(calls, []);
});

test('mutated copy differs from the (dormant-normalized) real harness in exactly the two constants (wiring flag, fake viewer SHA)', () => {
  // Compared against the real bytes with the flag FORCED false, so this holds whatever the real file currently declares.
  const a = forceLivePathWired(REAL_SOURCE, false).split('\n');
  const b = MUTATED_SOURCE.split('\n');
  assert.equal(a.length, b.length);
  const diff = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i !== null);
  assert.equal(diff.length, 2);
  assert.equal(H.LIVE_PATH_WIRED, true);
  assert.equal(H.G2_DUAL_COUNTER_GATE.resolved, true);
  assert.equal(REAL.G2_DUAL_COUNTER_GATE.resolved, true);
  assert.equal(H.REPO_ROOT, realpathSync(SANDBOX), 'the wired copy resolves REPO_ROOT to its own sandbox, never the real repository');
});

test('M2: LIVE_PATH_WIRED=true while G2_DUAL_COUNTER_GATE is unresolved => main() refuses (dual-counter-gate-unresolved) right after the wiring gate, with no fs/git/browser/event activity; live-mode runChecksInPhaseOrder refuses too', async () => {
  assert.equal(HW.LIVE_PATH_WIRED, true);
  assert.equal(HW.G2_DUAL_COUNTER_GATE.resolved, false);
  const calls = [];
  const trapFs = new Proxy({}, { get: (_t, k) => (...a) => { calls.push(['fs', String(k), ...a]); throw new Error('fs must not be touched'); } });
  const trapPkg = new Proxy({}, { get: (_t, k) => { calls.push(['browserPackage', String(k)]); throw new Error('browser package must not be touched'); } });
  await assert.rejects(
    HW.main({ argv: ARGV, env: ENV, deps: { fs: trapFs, repoRoot: ROOT, gitHead: () => { calls.push(['gitHead']); return HEAD; }, git: () => { calls.push(['git']); return ''; }, browserPackage: trapPkg, onEvent: (e) => calls.push(['event', e]), serveModule: () => { calls.push(['serve']); } } }),
    (err) => err instanceof HW.G2RefusalError && err.reason === 'dual-counter-gate-unresolved',
  );
  assert.deepEqual(calls, []);
  await assert.rejects(HW.runChecksInPhaseOrder({ mode: 'live', drivers: {} }), (err) => err instanceof HW.G2RefusalError && err.reason === 'dual-counter-gate-unresolved');
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
  assert.equal(r.state.runtimeEnvelope.chromium, '151.0.7922.34');
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
  // live plan §3.1/§3.2 post-launch check: launched browser.version() must be exactly 151.0.7922.34.
  ['browser-launch', { world: { browserVersion: '151.0.7922.33' } }],
  ['browser-launch', { world: { browserVersion: '999.0.0.0-fake' } }],
  ['browser-launch', { world: { versionThrows: true } }],
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

test('in-page phase run throws (no transfer) => every check BLOCKED, session tainted, controls not started => a durably committed FAIL (row 3 phase-run-failed; never PASS); the root failure is a schema-valid R1 record', async () => {
  const { w, r, reader } = await consumedRun({ handlers: { g2RunPhases: () => { throw new Error('page crashed'); } } });
  assert.equal(r.state.sessionTainted, true);
  assert.ok(Object.values(r.state.checks).every((c) => vr(c) === 'BLOCKED(phase-run-threw)'));
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.closeout.primaryRow, 3, 'the phase-run-failed reason of row 3 (no longer an incidental row 4)');
  assert.equal(r.closeout.committed, true, 'a failed run closes out normally: R1/R2/R3/J/K');
  assert.deepEqual(r.closeout.causes, []);
  assert.equal(reader.verdict, 'FAIL');
  assert.equal(reader.witness, 'W-6');
  assert.equal(reader.detail.failedRun.source, 'node-phase-run-transport');
  assert.equal(r.state.phaseRunFailure.seqSource, 'node-observed');
});

test('page records are re-validated Node-side: an invalid check record fails closed', async () => {
  const { r } = await consumedRun({ handlers: { g2RunPhases: () => { const run = passRun(); run.checks.C9 = { verdict: 'MAYBE' }; delete run.controls.N4; return run; } } });
  assert.equal(vr(r.state.checks.C9), 'BLOCKED(invalid-or-missing-page-record)');
  assert.equal(r.state.controls.N4.state, 'NOT_DETECTED');
  assert.equal(r.finalOverall, 'FAIL');
});

test('fatal page event during the phase run => row 1 FAIL committed through K; the page fatal latch is set', async () => {
  // A faithful fake page: the node-observed pageerror reaches the page latch BEFORE the gate, so the real
  // runner (offline-fake drivers, recorder on the page realm of the composite sequence) counts it =>
  // fatalCountAtGate 1 => CLOSED_OTHER; the node ledger's sequenced entry recomputes the same count.
  const g2RunPhases = async (_arg, { page }) => {
    page.emit('pageerror', new Error('Bearer abc.def leaked?'));
    const src = H.createPageOrdinalSource(); const rec = H.createCallRecorder({ nextSeq: src.next });
    const M = { loaded: true, classification: 'CONFIRMED_SVF2', inAllModels: true };
    const run = await H.runChecksInPhaseOrder({ drivers: { P1: () => ({ checks: { C1: H.evaluateC1({ A: M, B: M, loadedCount: 2 }) } }) }, recorder: rec, errorLedger: () => ({ fatalCount: 1, entries: [{ kind: 'pageerror' }] }) });
    assert.equal(run.gates.C1.outcome, 'CLOSED_OTHER');
    return {
      absoluteSeqs: true, pageSource: src, checks: run.checks, controls: run.controls, subchecks: run.subchecks, extras: { c4Table: [], sceneOwnership: [], c17: null, c20: null, eventLog: [] },
      c1FinalizedEvent: run.c1FinalizedEvent, gates: run.gates, markers: run.markers, eventLog: run.eventLog, spyInstall: null, sessionTainted: false, taintPhase: null,
      phaseLog: run.phaseLog, spyLedger: rec.records, screenshots: [], stateSnapshots: [], staleContinuationsDropped: 0,
    };
  };
  const { w, r, reader } = await consumedRun({ handlers: { g2RunPhases } });
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.closeout.primaryRow, 1);
  assert.equal(r.closeout.committed, true, JSON.stringify(r.closeout.causes));
  assert.equal(r.state.gates.C1.fatalCountAtGate, 1);
  assert.ok(r.state.errorLedger.entries[0].seq < r.state.gates.C1.gateSeq, 'the node-sequenced entry precedes the gate');
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
  // A page step whose ownership re-check itself is unknown => indeterminate => fail-closed unresolved (row 2 FAIL), never PARTIAL.
  x = await consumedRun({ handlers: { g2CleanupStep: (arg) => (arg.name === 'bridgeDispose' ? { ok: false, result: null, error: { name: 'Error', message: 'x' }, ownershipRemains: null } : { ok: true, result: null, ownershipRemains: false }) } });
  assert.deepEqual(x.r.state.cleanupFailures.map((f) => [f.step, f.ownership]), [['bridgeDispose', 'indeterminate']]);
  assert.equal(x.r.state.cleanupUnresolvedOwnership, true);
  assert.equal(x.r.finalOverall, 'FAIL');
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
  const { w, r } = await consumedRun({ handlers: { g2RunPhases: () => passRun({ spyLedger: [{ seq: 35, phase: 'P6', activeCheck: 'C6', activeControl: null, method: 'viewer.fitToView', origin: 'bridge', argSummaries: [{ kind: 'string', value: 'https://h.invalid/x?access_token=SECRET' }] }] }) } });
  assert.equal(r.finalOverall, 'PASS');
  const r1 = JSON.parse(H.readArtifactFileMap({ fs: w.fs.processCrashView(), chain: CHAIN }).results[H.R1_NAME].toString('utf8'));
  assert.equal(r1.spyLedger.truncated, false);
  // the run's record + the fake page's one cleanup-phase spy record (H1 cleanup drain)
  assert.deepEqual(r1.spyLedger.records.map((x) => [x.method, x.phase]), [['viewer.fitToView', 'P6'], ['overlays.removeScene', 'cleanup']]);
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
  assert.deepEqual(Object.keys(w.bindings).sort(), [H.G2_NODE_FATAL_BINDING, H.G2_NODE_INGEST_BINDING, H.G2_NODE_OPLEDGER_BINDING, H.G2_NODE_SCREENSHOT_BINDING, H.G2_NODE_SYNC_BINDING].sort());
  // slice C2: the operation-ledger barrier accepts only the §9.2 page mutations (C16 hide B, C17 unload B, a cleanup unload)
  const opb = w.bindings[H.G2_NODE_OPLEDGER_BINDING];
  assert.deepEqual(await opb('begin', { operationType: 'hide', modelId: 'A', phase: 'P9', invokedBy: 'C16', ...fenceReport(w.bindings) }), { ok: false, reason: 'refused' });
  assert.deepEqual(await opb('begin', { operationType: 'teardown', teardownTarget: 'closePage', modelId: null, phase: 'cleanup', invokedBy: 'cleanup:closePage', ...fenceReport(w.bindings) }), { ok: false, reason: 'refused' });
  await assert.rejects(w.bindings[H.G2_NODE_SCREENSHOT_BINDING]({ x: 0.5, y: 0, width: 10, height: 10 }), /integer clip/);
});

// ------------------------------------------------------------------------------------------
// Slice C2 (§9.2): the operation ledger, the frozen prefix-source snapshot and the acknowledgement
// barrier wired through the whole (fake) main flow.
// ------------------------------------------------------------------------------------------

const C2_CDN = 'https://cdn.derivative.invalid';
const c2Req = (url, { resourceType = 'fetch', errorText = 'net::ERR_ABORTED' } = {}) => ({
  url: () => url, method: () => 'GET', resourceType: () => resourceType, isNavigationRequest: () => false, failure: () => ({ errorText }), redirectedFrom: () => null, frame: () => null,
});
/** Emits finished-2xx evidence for model `label` while its load window is open (inside g2DocumentLoad). */
function c2LoadEvidence(page, label) {
  const r = c2Req(`${C2_CDN}/model${label}/output/0/geom.bin`);
  page.emit('request', r);
  page.emit('response', { request: () => r, status: () => 200, fromServiceWorker: () => false, body: async () => Buffer.alloc(0) });
  page.emit('requestfinished', r);
}

/** World whose cleanup unload of B goes through the node acknowledgement barrier while `abortUrl` is in flight. */
function c2CleanupAbortWorld(abortUrl) {
  const w = makeWorld({ handlers: { g2DocumentLoad: (arg, { page }) => { c2LoadEvidence(page, arg.label); return { status: 'completed' }; } } });
  w.handlers.g2CleanupStep = async (arg) => {
    if (arg.name !== 'unloadModelB') return { ok: true, result: null, error: null, ownershipRemains: false };
    const req = c2Req(abortUrl);
    w.page.emit('request', req);
    const op = await w.bindings[H.G2_NODE_OPLEDGER_BINDING]('begin', { operationType: 'unload', modelId: 'B', phase: 'cleanup', invokedBy: 'cleanup:unloadModelB', ...fenceReport(w.bindings) });
    assert.equal(op.ok, true);
    w.page.emit('requestfailed', req); // the abort caused by viewer.unloadModel(B), after the node-side ack
    await w.bindings[H.G2_NODE_OPLEDGER_BINDING]('end', { operationId: op.operationId, terminalOutcome: 'settled', ...fenceReport(w.bindings) });
    return { ok: true, result: { outcome: 'unloaded' }, error: null, ownershipRemains: false };
  };
  return w;
}

test('slice C2 dry run: load A/B and the page/context/browser teardown are recorded in opLedger; the prefix snapshot is frozen at the B window close; PASS', async () => {
  const w = makeWorld({ handlers: { g2DocumentLoad: (arg, { page }) => { c2LoadEvidence(page, arg.label); return { status: 'completed' }; } } });
  const r = await runMain(w);
  assert.equal(r.finalOverall, 'PASS', JSON.stringify(r.closeout && r.closeout.causes));
  const L = r.state.errorLedger;
  assert.deepEqual(L.opLedger.map((o) => [o.recordType, o.operationType || o.modelId, o.completionOutcome || o.terminalOutcome]), [
    ['load', 'A', 'ready'], ['load', 'B', 'ready'], ['mutation', 'teardown', 'settled'], ['mutation', 'teardown', 'settled'], ['mutation', 'teardown', 'settled'],
  ]);
  assert.deepEqual(L.opLedger.slice(2).map((o) => o.teardownTarget), ['closePage', 'closeContext', 'closeBrowser']);
  const firstDocLoadSeq = L.requestObservations.find((o) => o.urlRedacted.includes('/modelA/')).startSeq;
  assert.ok(L.opLedger[0].startSeq < firstDocLoadSeq && firstDocLoadSeq <= L.opLedger[0].endSeq, 'the A evidence lies inside the A window');
  assert.deepEqual(L.prefixDerivation.modelPrefixes, { A: [`${C2_CDN}/modelA/output/0`], B: [`${C2_CDN}/modelB/output/0`] });
  assert.equal(L.prefixDerivation.bindingAvailable, true);
  assert.deepEqual(L.modelPrefixes, L.prefixDerivation.modelPrefixes);
  assert.ok(H.isPrefixLedgerFrozen(L));
  assert.deepEqual(H.recordSchemaProblems(r.state), []);
});

test('slice C2 dry run: an ERR_ABORTED of a B-bound request inside the acknowledged cleanup unload of B => EC-unload, no fatal, PASS; the same abort on an A-bound or unbound request => FATAL (row 1)', async () => {
  const ok = c2CleanupAbortWorld(`${C2_CDN}/modelB/output/0/stream.bin`);
  const r = await runMain(ok);
  assert.equal(r.finalOverall, 'PASS', JSON.stringify(r.closeout && r.closeout.causes));
  const L = r.state.errorLedger;
  const ec = L.requestFailures[0];
  assert.deepEqual([ec.closeout.classification, ec.closeout.rule, ec.closeout.modelId, ec.closeout.boundPrefix, ec.agree], ['expected-cancellation', 'EC-unload', 'B', `${C2_CDN}/modelB/output/0`, true]);
  assert.ok(ec.closeout.evidenceRefs.some((p) => p.startsWith('/errorLedger/prefixSourceLedger/')));
  const unload = L.opLedger.find((o) => o.invokedBy === 'cleanup:unloadModelB');
  assert.deepEqual([unload.causalEvidence.cleanupStepRef, unload.startSeq < ec.failSeq, ec.failSeq < unload.cancellationWindow.toSeqExclusive], ['/cleanupStepStatus/unloadModelB', true, true]);
  assert.equal(L.fatalCount, 0);
  for (const url of [`${C2_CDN}/modelA/output/0/stream.bin`, `${C2_CDN}/elsewhere/x.bin`]) {
    const bad = c2CleanupAbortWorld(url);
    const rb = await runMain(bad);
    assert.equal(rb.finalOverall, 'FAIL', url);
    assert.equal(rb.closeout.primaryRow, 1, url);
    assert.equal(rb.state.errorLedger.requestFailures[0].closeout.classification, 'fatal-required-resource', url);
  }
});

// ------------------------------------------------------------------------------------------
// H1 / M2 (2026-10-01 follow-up review): node-side P1 load outcomes vs C1, and the real page
// numbering against node allocations during the in-page run.
// ------------------------------------------------------------------------------------------

const NOT_LOADED_A = (loadStatus) => ({ ...JSON.parse(JSON.stringify(FACTS)), loadedCount: 1, A: { loaded: false, classification: null, inAllModels: false, unitScale: null, unitString: null, loadStatus } });

/**
 * A fake g2RunPhases that runs the REAL runner over `facts` (P1 driver = the real evaluateC1). With
 * `feedNode` the facts go through the real `withNodeLoadOutcomes(facts, arg.nodeLoadOutcomes)` -- what
 * the real g2BuildEnv's env.modelFacts does; without it the page ignores the node outcomes (the pre-H1
 * wiring). The page recorder is numbered exactly like the real g2BuildEnv: a fresh `createPageOrdinalSource()`
 * (page-local ordinals, handed to the fake page as `pageSource`; `leak` makes it skip the Node delivery).
 */
function realRunnerPhases(facts, { feedNode = true, before = null, leak = false } = {}) {
  return async (arg, ctx) => {
    if (before) before(arg, ctx);
    const src = H.createPageOrdinalSource(); const rec = H.createCallRecorder({ nextSeq: src.next });
    const f = feedNode ? H.withNodeLoadOutcomes(facts, arg.nodeLoadOutcomes) : facts;
    const run = await H.runChecksInPhaseOrder({ drivers: { P1: () => ({ checks: { C1: H.evaluateC1(f) } }) }, recorder: rec, errorLedger: () => ({ fatalCount: 0, entries: [] }) });
    return {
      absoluteSeqs: true, pageSource: src, ...(leak ? { leakUningested: true } : {}), checks: run.checks, controls: run.controls, subchecks: run.subchecks, extras: { c4Table: [], sceneOwnership: [], c17: null, c20: null, eventLog: [] },
      c1FinalizedEvent: run.c1FinalizedEvent, gates: run.gates, markers: run.markers, eventLog: run.eventLog, spyInstall: null, sessionTainted: false, taintPhase: null,
      phaseLog: run.phaseLog, spyLedger: rec.records, screenshots: [], stateSnapshots: [], staleContinuationsDropped: 0,
    };
  };
}
const throwingDocLoadA = (arg) => { if (arg.label === 'A') throw new Error('RPC transport failure before the page recorded the load'); return { status: 'completed' }; };

test('H1 dry run: the node passes its load completionOutcomes to g2RunPhases; a P1 load that THREW node-side (page never recorded it) => C1 BLOCKED(harness-exception) => CLOSED_OTHER => row 4 FAIL, never BLOCKED', async () => {
  const { w, r, reader } = await consumedRun({ handlers: { g2DocumentLoad: throwingDocLoadA, g2CollectModelFacts: () => NOT_LOADED_A(null), g2RunPhases: realRunnerPhases(NOT_LOADED_A(null)) } });
  const call = w.log.find((e) => e.kind === 'rpc' && e.key === 'g2RunPhases');
  assert.deepEqual(call.arg.nodeLoadOutcomes, { A: 'harness-exception', B: 'ready' });
  assert.deepEqual(r.state.errorLedger.opLedger.filter((o) => o.recordType === 'load').map((o) => [o.modelId, o.completionOutcome]), [['A', 'harness-exception'], ['B', 'ready']]);
  assert.deepEqual([r.state.checks.C1.verdict, r.state.checks.C1.reason, r.state.gates.C1.outcome], ['BLOCKED', 'harness-exception', 'CLOSED_OTHER']);
  assert.equal(r.state.controls.N3.disposition, 'NOT_EXECUTABLE');
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.closeout.primaryRow, 4);
  assert.equal(r.closeout.committed, true, JSON.stringify(r.closeout.causes));
  assert.equal(reader.verdict, 'FAIL');
});

test('H1 dry run backstop: the same node-side harness exception with a page that IGNORES the node outcomes (C1 normalized to prerequisite, legal-looking NRDB) => row 5 c1-load-ledger-mismatch => FAIL, not BLOCKED', async () => {
  const { r, reader } = await consumedRun({ handlers: { g2DocumentLoad: throwingDocLoadA, g2CollectModelFacts: () => NOT_LOADED_A(null), g2RunPhases: realRunnerPhases(NOT_LOADED_A(null), { feedNode: false }) } });
  assert.deepEqual([r.state.checks.C1.reason, r.state.gates.C1.outcome], ['prerequisite', 'CLOSED_DEPENDENCY_BLOCKED']);
  assert.ok(H.recordSchemaProblems(r.state).includes('c1-load-ledger-mismatch:harness-exception'));
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.closeout.primaryRow, 5);
  assert.equal(reader.verdict, 'FAIL');
});

test('H1 dry run control: a page-side load REJECTION (node outcome rejected) => C1 BLOCKED(prerequisite) => CLOSED_DEPENDENCY_BLOCKED => legal NRDB => row 6 BLOCKED (exit 2)', async () => {
  const { w, r, reader } = await consumedRun({ handlers: {
    g2DocumentLoad: (arg) => (arg.label === 'A' ? { status: 'failed', error: { name: 'DocumentLoadError', message: 'x' } } : { status: 'completed' }),
    g2CollectModelFacts: () => NOT_LOADED_A('failed'), g2RunPhases: realRunnerPhases(NOT_LOADED_A('failed')),
  } });
  assert.deepEqual(w.log.find((e) => e.kind === 'rpc' && e.key === 'g2RunPhases').arg.nodeLoadOutcomes, { A: 'rejected', B: 'ready' });
  assert.deepEqual([r.state.checks.C1.verdict, r.state.checks.C1.reason, r.state.gates.C1.outcome], ['BLOCKED', 'prerequisite', 'CLOSED_DEPENDENCY_BLOCKED']);
  assert.deepEqual(H.recordSchemaProblems(r.state), []);
  assert.equal(r.finalOverall, 'BLOCKED', JSON.stringify(r.closeout.causes));
  assert.equal(r.closeout.primaryRow, 6);
  assert.equal(r.exitCode, 2);
  assert.equal(reader.verdict, 'BLOCKED');
});

test('H1 single-allocator: with the REAL g2BuildEnv page-local ordinals node network events during the in-page run never collide with page seqs (one Node allocator) => row 6 BLOCKED; a page that leaks an UN-ingested ordinal => page-ordinal-unmapped / page-ordinal-leaked => row 5 FAIL, never PASS', async () => {
  // the real numbering this test reproduces (static coupling: if g2BuildEnv changes, revisit this test)
  const env = REAL_SOURCE.slice(REAL_SOURCE.indexOf('function g2BuildEnv('), REAL_SOURCE.indexOf('function g2PhaseBaseline('));
  assert.ok(env.includes('const pageSeq = createPageOrdinalSource(') && env.includes('createCallRecorder({ nextSeq: pageSeq.next })'), 'g2BuildEnv numbers page records with page-local ordinals');
  assert.equal(env.includes('seqBase'), false, 'no seqBase seeding is left in g2BuildEnv');
  const nodeEvents = (_arg, { page }) => { for (const u of ['x1.bin', 'x2.bin']) c2LoadEvidence(page, `B/${u}`); };
  const handlers = (g2RunPhases) => ({
    g2DocumentLoad: (arg) => (arg.label === 'A' ? { status: 'failed', error: { name: 'DocumentLoadError', message: 'x' } } : { status: 'completed' }),
    g2CollectModelFacts: () => NOT_LOADED_A('failed'), g2RunPhases,
  });
  // (a) real page ordinals, ingested by Node through the real binding: no collision, no ordinal survives, one allocator.
  const real = await consumedRun({ handlers: handlers(realRunnerPhases(NOT_LOADED_A('failed'), { before: nodeEvents })) });
  const S = real.r.state;
  assert.deepEqual(H.recordSchemaProblems(S).filter((p) => p.startsWith('seq-not-unique:')), []);
  assert.deepEqual(H.primarySeqAllocations(S).problems.filter((p) => p.startsWith('page-ordinal-leaked:')), []);
  assert.deepEqual(real.r.state.errorLedger.entries.filter((e) => e.kind === 'harness-exception'), [], 'no ingestion violation');
  const runObs = S.errorLedger.requestObservations.filter((o) => o.urlRedacted.includes('/x1.bin') || o.urlRedacted.includes('/x2.bin'));
  assert.equal(runObs.length, 2, 'the node events during the run were recorded');
  for (const o of runObs) assert.ok(Number.isInteger(o.startSeq) && o.startSeq < H.PAGE_LOCAL_BASE, 'node events carry authoritative (allocator) seqs');
  const pageMarkers = S.errorLedger.markers.filter((x) => x.name === 'P1');
  assert.equal(pageMarkers.length, 1);
  assert.ok(pageMarkers[0].seq < H.PAGE_LOCAL_BASE, 'the page-run P1 marker was rewritten to an authoritative seq');
  assert.ok(runObs.every((o) => o.startSeq < pageMarkers[0].seq), 'authoritative order is Node ingestion order: the page records were ingested at the drain, after the node events');
  assert.equal(real.r.finalOverall, 'BLOCKED', JSON.stringify(real.r.closeout.causes));
  assert.equal(real.r.closeout.primaryRow, 6);
  assert.equal(real.reader.verdict, 'BLOCKED');
  // (b) control: a page that leaks page-local ordinals Node never ingested (it reports none at the drain fence)
  // => the final rewrite finds them unmapped (violation 'page-ordinal-unmapped', one fail-closed fatal) => row 5 FAIL.
  const leaking = realRunnerPhases(NOT_LOADED_A('failed'), { before: nodeEvents, leak: true });
  const coll = await consumedRun({ handlers: handlers(leaking) });
  assert.ok(coll.r.state.errorLedger.entries.some((e) => e.kind === 'harness-exception' && /cross-realm-fence:page-ordinal-unmapped/.test(e.detail)), 'the unmapped ordinal is a recorded violation');
  assert.notEqual(coll.r.finalOverall, 'PASS');
  assert.equal(coll.r.finalOverall, 'FAIL');
  assert.ok(H.primarySeqAllocations(coll.r.state).problems.some((p) => p.startsWith('page-ordinal-leaked:')), 'the surviving page ordinal is reported as page-ordinal-leaked');
  assert.ok(H.recordSchemaProblems(coll.r.state).some((p) => p.startsWith('page-ordinal-leaked:')));
  // the ingestion violation is itself a fail-closed fatal (row 1), which outranks the row-5 contradiction; never PASS either way.
  assert.equal(coll.r.closeout.primaryRow, 1);
  assert.equal(coll.reader.verdict, 'FAIL');
});

// ------------------------------------------------------------------------------------------
// H1 cleanup completeness (2026-10-02 addendum): the page's cleanup-generated records (cleanup spy
// records, `wrapper-restore` events, a cleanup baseline snapshot) reach the authoritative state only
// through the awaited cleanup drain (rpc g2CleanupDrain -> drain fence -> rewrite -> mergeCleanupDelta),
// which runs inside the closePage step BEFORE the teardown op while the page is open. A missing/partial
// transfer is exactly ONE fatal 'cleanup-evidence:*' (row 1), never PASS.
// ------------------------------------------------------------------------------------------

let cleanupMutationCount = 0;
/** A further-mutated copy of MUTATED_SOURCE (each needle replaced exactly once), imported from the sandbox. */
async function mutatedHarness(pairs) {
  let text = MUTATED_SOURCE;
  for (const [from, to] of pairs) {
    assert.equal(text.split(from).length - 1, 1, `mutation anchor must occur exactly once: ${from}`);
    text = text.replace(from, () => to);
  }
  cleanupMutationCount += 1;
  const file = path.join(SANDBOX, `cleanup-${cleanupMutationCount}`, 'test', 'acceptance', 'clashpanel-viewerbridge.acceptance.mjs');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return { mod: await import(pathToFileURL(file).href), text };
}

const isCleanupEvidenceFatal = (e) => e.kind === 'harness-exception' && typeof e.detail === 'string' && e.detail.startsWith('cleanup-evidence:');
/** The fake page's cleanup records as they landed in the authoritative state. */
function cleanupRecordsOf(S) {
  return {
    spy: S.spyLedger.filter((x) => x.phase === 'cleanup'),
    restore: S.eventLog.filter((x) => x.kind === 'wrapper-restore' && x.phase === 'cleanup'),
    snap: S.stateSnapshots.filter((x) => x.baselinePhase === 'cleanup'),
  };
}

test('H1 cleanup evidence: wrapper-restore events, cleanup spy records and the cleanup snapshot are drained before closePage, Node-sequenced by the single allocator, merged once with phase cleanup => PASS', async () => {
  const w = makeWorld();
  const r = await runMain(w);
  assert.equal(r.finalOverall, 'PASS', JSON.stringify(r.closeout && r.closeout.causes));
  assert.equal(readerVerdict(w).verdict, 'PASS');
  const S = r.state;
  // (1) transferred: exactly the records the page produced, each once, with cleanup attribution
  const c = cleanupRecordsOf(S);
  assert.deepEqual(c.spy.map((x) => [x.method, x.origin, x.activeCheck, x.activeControl]), [['overlays.removeScene', 'harness', null, null]]);
  assert.deepEqual(c.restore.map((x) => [x.label, x.layer, x.ok, x.activeCheck, x.activeControl]), [['overlays.removeScene', 'recording', true, null, null], ['viewer.isolate', 'recording', true, null, null]]);
  assert.deepEqual(c.snap.map((x) => [x.phase, x.isolationEmpty, x.hiddenEmpty]), [['cleanup', true, true]]);
  // (2) single allocator: authoritative (< PAGE_LOCAL_BASE), unique across every primary allocation, and contiguous
  // (one drain batch => consecutive allocator values), in page-ordinal order (bridgeDispose < restore < baseline)
  const seqs = [...c.spy, ...c.restore, ...c.snap].map((x) => x.seq);
  for (const s of seqs) assert.ok(Number.isSafeInteger(s) && s > 0 && s < H.PAGE_LOCAL_BASE && !H.isPageLocalOrdinal(s), `authoritative seq ${s}`);
  assert.deepEqual(seqs, Array.from({ length: 4 }, (_, i) => seqs[0] + i), 'consecutive allocator values');
  assert.deepEqual(H.primarySeqAllocations(S).problems, []);
  assert.deepEqual(H.recordSchemaProblems(S), []);
  assert.ok(seqs[3] <= H.maxRecordedSeq(S));
  const runMax = Math.max(...S.spyLedger.concat(S.eventLog, S.stateSnapshots).filter((x) => x.phase !== 'cleanup').map((x) => x.seq), S.errorLedger.markers.find((m) => m.name === 'cleanup').seq);
  assert.ok(seqs[0] > runMax, 'cleanup records are ingested after every run record');
  // (3) ordering: drained inside closePage BEFORE its teardown op and the close, after every page-owned step, page still open
  const closePageOp = S.errorLedger.opLedger.find((o) => o.teardownTarget === 'closePage');
  assert.ok(seqs[3] < closePageOp.startSeq, 'the drain precedes the closePage teardown operation');
  assert.ok(seqs[3] < S.errorLedger.markers.find((m) => m.name === 'closeout').seq);
  const drainRpc = idx(w.log, (e) => e.kind === 'rpc' && e.key === 'g2CleanupDrain');
  const lastStep = w.log.map((e, i) => (e.kind === 'rpc' && e.key === 'g2CleanupStep' ? i : -1)).filter((i) => i >= 0).pop();
  const pageClose = idx(w.log, (e) => e.kind === 'pw' && e.call === 'page.close');
  assert.ok(lastStep < drainRpc && drainRpc < pageClose, 'page steps -> drain -> page.close');
  assert.equal(w.log.filter((e) => e.kind === 'rpc' && e.key === 'g2CleanupDrain').length, 1, 'one drain');
  const fence = w.log.find((e) => e.kind === 'page' && e.call === 'cleanup-drain');
  assert.equal(fence.pageClosed, false, 'the drain runs while the page is still open');
  assert.deepEqual(fence.report.kinds, ['spy', 'event', 'event', 'snapshot'], 'every cleanup ordinal goes through the real drain fence');
  assert.deepEqual(w.cleanupPage.queue().pending, [], 'Node acknowledged the drain');
  // (4) no fatal, R1 carries the merged cleanup evidence
  assert.deepEqual(S.errorLedger.entries.filter((e) => e.kind === 'harness-exception'), []);
  const r1 = JSON.parse(H.readArtifactFileMap({ fs: w.fs.processCrashView(), chain: CHAIN }).results[H.R1_NAME].toString('utf8'));
  assert.equal(r1.eventLog.filter((x) => x.kind === 'wrapper-restore' && x.phase === 'cleanup').length, 2);
  assert.equal(r1.stateSnapshots.filter((x) => x.phase === 'cleanup').length, 1);
});

test('H1 cleanup evidence: records already ingested at an earlier cleanup fence (the acknowledged unload of B re-sends them twice) are still transferred by the drain exactly once (idempotent re-send) => PASS', async () => {
  const w = c2CleanupAbortWorld(`${C2_CDN}/modelB/output/0/stream.bin`);
  const r = await runMain(w);
  assert.equal(r.finalOverall, 'PASS', JSON.stringify(r.closeout && r.closeout.causes));
  const c = cleanupRecordsOf(r.state);
  assert.deepEqual([c.spy.length, c.restore.length, c.snap.length], [1, 2, 1]);
  const unload = r.state.errorLedger.opLedger.find((o) => o.invokedBy === 'cleanup:unloadModelB');
  // every cleanup record precedes the unload step (§9 order) => ingested at its begin fence, before its startSeq
  for (const x of [...c.spy, ...c.restore, ...c.snap]) assert.ok(x.seq < unload.startSeq);
  // the fake c2 page never acked those fences: the unload end AND the drain re-sent the same four entries
  assert.deepEqual(w.log.find((e) => e.kind === 'page' && e.call === 'cleanup-drain').report.kinds, ['spy', 'event', 'event', 'snapshot']);
  assert.deepEqual(H.primarySeqAllocations(r.state).problems, []);
  assert.deepEqual(r.state.errorLedger.entries.filter((e) => e.kind === 'harness-exception'), []);
});

test('H1 cleanup evidence: a drain whose fence is re-sent (same pending twice, no ack in between) allocates once => no duplicates, PASS', async () => {
  const w = makeWorld();
  w.handlers.g2CleanupDrain = async () => {
    const q = w.cleanupPage.queue();
    const first = await w.bindings[H.G2_NODE_SYNC_BINDING]('drain', { ...fenceReport(w.bindings), pageFatalSent: q.fatalSent });
    assert.equal(first.ok, true);
    return w.cleanupPage.drain(); // re-sends every (still unacknowledged) entry
  };
  const r = await runMain(w);
  assert.equal(r.finalOverall, 'PASS', JSON.stringify(r.closeout && r.closeout.causes));
  const c = cleanupRecordsOf(r.state);
  const seqs = [...c.spy, ...c.restore, ...c.snap].map((x) => x.seq);
  assert.deepEqual(seqs, Array.from({ length: 4 }, (_, i) => seqs[0] + i));
  assert.deepEqual(H.primarySeqAllocations(r.state).problems, []);
});

/** Timers whose most recently armed T8 (cleanup-step) deadline can be fired on demand (the drain's own withDeadline). */
function t8Timers() {
  const T8 = H.TABLE_T.T8.cleanupStepDeadlineMs;
  let last = null;
  return {
    timers: { setTimeout: (fn, ms) => { const h = setTimeout(fn, ms); if (ms === T8) last = { fn }; return h; }, clearTimeout: (h) => clearTimeout(h) },
    fireLastT8: () => { const t = last; setTimeout(() => t.fn(), 0); },
  };
}

const MISSING_TRANSFER_CASES = [
  ['rpc returns ok:false', /^cleanup-evidence:drain-refused:page env missing$/, () => () => ({ ok: false, delta: null, error: { name: 'Error', message: 'page env missing' } })],
  ['rpc returns a malformed result', /^cleanup-evidence:drain-refused:malformed$/, () => () => ({ delta: {} })],
  ['rpc throws', /^cleanup-evidence:drain-threw$/, () => () => { throw new Error('page gone'); }],
  ['rpc times out (T8)', /^cleanup-evidence:drain-timed-out$/, (w, t8) => () => { t8.fireLastT8(); return new Promise(() => {}); }],
  ['Node refuses the drain fence (gap in the pending report)', /^cleanup-evidence:drain-refused:drain sync refused by the node authority \(ingest-gap\)$/,
    (w) => () => { w.cleanupPage.queue().pending.shift(); return w.cleanupPage.drain(); }],
  // (ADDENDUM 2) an omitted ingested cleanup-drain event is BOTH page-evidence-missing:event and cleanup-event-missing (same seq)
  ['delta omits an ingested wrapper-restore event', /^cleanup-evidence:page-evidence-missing:event:\d+\(\+1\)$/,
    (w) => () => w.cleanupPage.drain({ mutate: (d) => ({ ...d, eventLog: d.eventLog.slice(1) }) })],
  ['delta omits the ingested cleanup spy record', /^cleanup-evidence:page-evidence-missing:spy:\d+$/,
    (w) => () => w.cleanupPage.drain({ mutate: (d) => ({ ...d, spyLedger: [] }) })],
  ['delta omits the ingested cleanup snapshot', /^cleanup-evidence:page-evidence-missing:snapshot:\d+$/,
    (w) => () => w.cleanupPage.drain({ mutate: (d) => ({ ...d, stateSnapshots: [] }) })],
  ['delta duplicates a cleanup spy record', /^cleanup-evidence:page-evidence-duplicate:spy:\d+$/,
    (w) => () => w.cleanupPage.drain({ mutate: (d) => ({ ...d, spyLedger: [...d.spyLedger, { ...d.spyLedger[0], callIndex: 99 }] }) })],
];

for (const [name, detail, make] of MISSING_TRANSFER_CASES) {
  test(`H1 cleanup evidence: missing transfer (${name}) => exactly ONE fatal cleanup-evidence:* => row 1 FAIL, never PASS`, async () => {
    const w = makeWorld();
    const t8 = t8Timers();
    w.deps.timers = t8.timers;
    w.handlers.g2CleanupDrain = make(w, t8);
    const r = await runMain(w);
    const fatals = r.state.errorLedger.entries.filter(isCleanupEvidenceFatal);
    assert.equal(fatals.length, 1, JSON.stringify(r.state.errorLedger.entries));
    assert.match(fatals[0].detail, detail);
    assert.equal(r.finalOverall, 'FAIL');
    assert.equal(r.closeout.primaryRow, 1);
    assert.equal(r.exitCode, 1);
    assert.equal(readerVerdict(w).verdict, 'FAIL');
    assert.ok(idx(w.log, (e) => e.kind === 'rpc' && e.key === 'g2CleanupDrain') < idx(w.log, (e) => e.kind === 'pw' && e.call === 'page.close'));
  });
}

test('H1 cleanup evidence: an UN-ingested page ordinal smuggled into the delta never reaches authoritative state silently => page-ordinal-unmapped + page-ordinal-leaked + ONE cleanup-evidence fatal => FAIL', async () => {
  const w = makeWorld();
  w.handlers.g2CleanupDrain = () => w.cleanupPage.drain({
    // a record allocated by the page AFTER the fence report (its ordinal was never ingested)
    mutate: (d) => ({ ...d, spyLedger: [...d.spyLedger, { ...d.spyLedger[0], seq: d.pageHighWater + 1, callIndex: 1 }] }),
  });
  const r = await runMain(w);
  const E = r.state.errorLedger.entries;
  assert.ok(E.some((e) => e.kind === 'harness-exception' && e.detail === 'cross-realm-fence:page-ordinal-unmapped'), JSON.stringify(E));
  assert.equal(E.filter(isCleanupEvidenceFatal).length, 1);
  assert.match(E.find(isCleanupEvidenceFatal).detail, /^cleanup-evidence:page-evidence-unsourced:spy:\d+$/);
  assert.ok(H.primarySeqAllocations(r.state).problems.some((p) => p.startsWith('page-ordinal-leaked:')));
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.closeout.primaryRow, 1);
});

test('H1 cleanup evidence: a delta whose high-water is not what Node ingested (the page skipped the fence) => final-ingest-mismatch / unmapped => FAIL, never PASS', async () => {
  const w = makeWorld();
  w.handlers.g2CleanupDrain = () => {
    const q = w.cleanupPage.queue();
    const delta = JSON.parse(JSON.stringify({ spyLedger: w.cleanupPage.recorder.records, eventLog: w.cleanupPage.recorder.events, stateSnapshots: w.cleanupPage.snapshots, pageHighWater: q.last, pageFatalSent: q.fatalSent }));
    return { ok: true, delta, error: null }; // no drain fence at all
  };
  const r = await runMain(w);
  const details = r.state.errorLedger.entries.filter((e) => e.kind === 'harness-exception').map((e) => e.detail);
  assert.ok(details.includes('cross-realm-fence:final-ingest-mismatch'), JSON.stringify(details));
  assert.ok(details.includes('cross-realm-fence:page-ordinal-unmapped'));
  assert.equal(details.filter((d) => d.startsWith('cleanup-evidence:')).length, 1);
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.closeout.primaryRow, 1);
});

test('H1 cleanup evidence non-vacuity: with the closeout completeness check REMOVED (mutated harness text) the same missing transfers PASS', async () => {
  const { mod, text } = await mutatedHarness([['  if (cleanupEvidence.runApplied) {\n    if (!cleanupEvidence.merged)', '  if (false) {\n    if (!cleanupEvidence.merged)']]);
  const cases = [
    ['refused', (w) => () => ({ ok: false, delta: null, error: { name: 'Error', message: 'x' } })],
    ['omitted event', (w) => () => w.cleanupPage.drain({ mutate: (d) => ({ ...d, eventLog: [] }) })],
    ['omitted spy', (w) => () => w.cleanupPage.drain({ mutate: (d) => ({ ...d, spyLedger: [] }) })],
  ];
  for (const [name, make] of cases) {
    const w = makeWorld({ mod, harnessText: text });
    w.handlers.g2CleanupDrain = make(w);
    const r = await runMain(w);
    assert.equal(r.finalOverall, 'PASS', `${name}: ${JSON.stringify(r.closeout && r.closeout.causes)}`);
    assert.equal(r.state.errorLedger.entries.filter(isCleanupEvidenceFatal).length, 0, name);
  }
  // and the unmutated harness fails the very same worlds (the check is what fails them)
  for (const [name, make] of cases) {
    const w = makeWorld();
    w.handlers.g2CleanupDrain = make(w);
    const r = await runMain(w);
    assert.equal(r.finalOverall, 'FAIL', name);
    assert.equal(r.state.errorLedger.entries.filter(isCleanupEvidenceFatal).length, 1, name);
  }
});

test('H1 cleanup evidence non-vacuity: a closePage step that never runs the drain (mutated harness text) => cleanup-evidence:drain-not-run => FAIL; the cleanup records never reach the state', async () => {
  const { mod, text } = await mutatedHarness([['run: async () => { if (typeof beforeClose === \'function\') await beforeClose(); return teardown(', 'run: async () => { return teardown(']]);
  const w = makeWorld({ mod, harnessText: text });
  const r = await runMain(w);
  assert.equal(w.log.some((e) => e.kind === 'rpc' && e.key === 'g2CleanupDrain'), false);
  const fatals = r.state.errorLedger.entries.filter(isCleanupEvidenceFatal);
  assert.deepEqual(fatals.map((e) => e.detail), ['cleanup-evidence:drain-not-run']);
  const c = cleanupRecordsOf(r.state);
  assert.deepEqual([c.spy.length, c.restore.length, c.snap.length], [0, 0, 0]);
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.closeout.primaryRow, 1);
});

test('H1 cleanup evidence: no drain when the run result was never applied (phase run threw) -- no spurious cleanup-evidence fatal; FAIL via the row-3 phase-run-failed reason', async () => {
  const { w, r } = await consumedRun({ handlers: { g2RunPhases: () => { throw new Error('page crashed'); } } });
  assert.equal(w.log.some((e) => e.kind === 'rpc' && e.key === 'g2CleanupDrain'), false);
  assert.equal(r.state.errorLedger.entries.filter(isCleanupEvidenceFatal).length, 0);
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.closeout.primaryRow, 3);
});

// ------------------------------------------------------------------------------------------
// ADDENDUM 2 (2026-10-02): cleanup eventLog provenance through the full main flow. Every authoritative
// cleanup eventLog entry must be sourced by exactly one ingested cleanup-drain `event` ordinal (and vice
// versa); any provenance defect is exactly ONE fatal 'cleanup-evidence:cleanup-event-*' (row 1), never PASS.
// ------------------------------------------------------------------------------------------

/** The cleanup-eventLog provenance block of pageEvidenceProblems in MUTATED_SOURCE (removed => the pre-fix check). */
const PROVENANCE_BLOCK = (() => {
  const a = MUTATED_SOURCE.indexOf('      // Cleanup eventLog provenance, BOTH directions');
  const b = MUTATED_SOURCE.indexOf('      return [...new Set(out)];', a);
  assert.ok(a > 0 && b > a, 'provenance block anchors');
  return MUTATED_SOURCE.slice(a, b);
})();

/**
 * An authoritative seq that a clean run ingested as an `alloc`-kind page ordinal (a passRun gap) and recorded
 * nowhere: deterministic across worlds (same allocation order), so an eventLog entry carrying it creates no
 * seq collision and no allocator overrun -- the ONLY defect is that no cleanup-drain event ordinal sources it.
 */
async function unrecordedRunSeq() {
  const w = makeWorld();
  const r = await runMain(w);
  assert.equal(r.finalOverall, 'PASS');
  const used = new Set(H.primarySeqAllocations(r.state).seqs.map((x) => x.seq));
  for (let s = 1; s <= H.maxRecordedSeq(r.state); s += 1) if (!used.has(s)) return s;
  throw new Error('no unrecorded seq in the baseline run');
}
const ghostCleanupEvent = (seq) => ({ seq, kind: 'wrapper-restore', label: 'ghost', layer: 'recording', ok: true, phase: 'cleanup', activeCheck: null, activeControl: null });

test('H1 cleanup provenance: a clean run is one-to-one -- every cleanup eventLog entry has a unique authoritative seq allocated by the drain batch, no other eventLog entry shares it => PASS', async () => {
  const w = makeWorld();
  const r = await runMain(w);
  assert.equal(r.finalOverall, 'PASS', JSON.stringify(r.closeout && r.closeout.causes));
  const S = r.state;
  const cleanupEvents = S.eventLog.filter((e) => e.phase === 'cleanup');
  assert.deepEqual(cleanupEvents.map((e) => e.kind), ['wrapper-restore', 'wrapper-restore']);
  const c = cleanupRecordsOf(S);
  const drainSeqs = [...c.spy, ...c.restore, ...c.snap].map((x) => x.seq);
  assert.deepEqual(cleanupEvents.map((e) => e.seq), drainSeqs.slice(1, 3), 'the two event ordinals of the drain batch, in page order');
  for (const ev of cleanupEvents) assert.equal(S.eventLog.filter((e) => e.seq === ev.seq).length, 1);
  assert.equal(S.errorLedger.entries.filter(isCleanupEvidenceFatal).length, 0);
});

const PROVENANCE_CASES = [
  ['an eventLog entry with phase cleanup and NO source ordinal (an unrecorded authoritative seq)', async () => {
    const g = await unrecordedRunSeq();
    return { detail: new RegExp(`^cleanup-evidence:cleanup-event-unsourced:${g}$`), mutate: (d) => ({ ...d, eventLog: [...d.eventLog, ghostCleanupEvent(g)] }), only: true };
  }],
  ['an eventLog entry with phase cleanup and a seq beyond the allocator (no source at all)', async () => ({
    detail: /^cleanup-evidence:cleanup-event-unsourced:1000000$/, mutate: (d) => ({ ...d, eventLog: [...d.eventLog, ghostCleanupEvent(1000000)] }), also: ['cross-realm-fence:seq-beyond-allocator'],
  })],
  ['a drained event re-labelled to a run phase', async () => ({
    detail: /^cleanup-evidence:cleanup-event-phase-mismatch:\d+$/, mutate: (d) => ({ ...d, eventLog: d.eventLog.map((e, i) => (i === 0 ? { ...e, phase: 'P11' } : e)) }), only: true,
  })],
  ['the same cleanup event delivered twice in the delta (one source, two authoritative events)', async () => ({
    detail: /^cleanup-evidence:page-evidence-duplicate:event:\d+\(\+1\)$/, mutate: (d) => ({ ...d, eventLog: [...d.eventLog, { ...d.eventLog[1] }] }),
  })],
  ['a page-local ordinal smuggled into a cleanup event (never ingested)', async () => ({
    detail: /^cleanup-evidence:cleanup-event-leaked-ordinal:\d+$/, mutate: (d) => ({ ...d, eventLog: [...d.eventLog, { ...d.eventLog[0], seq: d.pageHighWater + 1 }] }),
    also: ['cross-realm-fence:page-ordinal-unmapped'], leaked: true,
  })],
];

for (const [name, setup] of PROVENANCE_CASES) {
  test(`H1 cleanup provenance: ${name} => exactly ONE fatal cleanup-evidence:cleanup-event-* / page-evidence-* => row 1 FAIL, never PASS`, async () => {
    const c = await setup();
    const w = makeWorld();
    w.handlers.g2CleanupDrain = () => w.cleanupPage.drain({ mutate: c.mutate });
    const r = await runMain(w);
    const E = r.state.errorLedger.entries;
    const fatals = E.filter(isCleanupEvidenceFatal);
    assert.equal(fatals.length, 1, JSON.stringify(E));
    assert.match(fatals[0].detail, c.detail);
    const others = E.filter((e) => e.kind === 'harness-exception' && !isCleanupEvidenceFatal(e)).map((e) => e.detail);
    if (c.only) assert.deepEqual(others, [], 'the provenance defect is the only harness fatal');
    for (const d of c.also || []) assert.ok(others.includes(d), d);
    if (c.leaked) assert.ok(H.primarySeqAllocations(r.state).problems.some((p) => p.startsWith('page-ordinal-leaked:')));
    assert.equal(r.finalOverall, 'FAIL');
    assert.equal(r.closeout.primaryRow, 1);
    assert.equal(r.exitCode, 1);
    assert.equal(readerVerdict(w).verdict, 'FAIL');
  });
}

test('H1 cleanup provenance non-vacuity: with the provenance block REMOVED (pre-fix pageEvidenceProblems, mutated harness text) an unsourced / phase-mismatched cleanup event PASSES; the fixed harness fails the same worlds', async () => {
  const { mod, text } = await mutatedHarness([[PROVENANCE_BLOCK, '']]);
  const g = await unrecordedRunSeq();
  const cases = [
    ['unsourced', (d) => ({ ...d, eventLog: [...d.eventLog, ghostCleanupEvent(g)] })],
    ['phase-mismatch', (d) => ({ ...d, eventLog: d.eventLog.map((e, i) => (i === 0 ? { ...e, phase: 'P11' } : e)) })],
  ];
  for (const [name, mutate] of cases) {
    const w = makeWorld({ mod, harnessText: text });
    w.handlers.g2CleanupDrain = () => w.cleanupPage.drain({ mutate });
    const r = await runMain(w);
    assert.equal(r.finalOverall, 'PASS', `${name}: ${JSON.stringify(r.closeout && r.closeout.causes)}`);
    assert.equal(r.state.errorLedger.entries.filter(isCleanupEvidenceFatal).length, 0, name);
  }
  for (const [name, mutate] of cases) {
    const w = makeWorld();
    w.handlers.g2CleanupDrain = () => w.cleanupPage.drain({ mutate });
    const r = await runMain(w);
    assert.equal(r.finalOverall, 'FAIL', name);
    assert.deepEqual(r.state.errorLedger.entries.filter(isCleanupEvidenceFatal).map((e) => e.detail.split(':')[1]), [`cleanup-event-${name}`], name);
  }
});

test('H1 cleanup provenance wiring: runPostReservation without the {stage} of either rewrite (mutated harness text) has no drain range => the clean world\'s cleanup events are cleanup-event-outside-drain => ONE cleanup-evidence fatal, row 1 FAIL (fail closed)', async () => {
  for (const [from, to] of [
    ["authority.rewritePageRun(out.value.delta, { stage: 'cleanup' })", 'authority.rewritePageRun(out.value.delta)'],
    ["authority.rewritePageRun(runOut.value, { stage: 'run' })", 'authority.rewritePageRun(runOut.value)'],
  ]) {
    const { mod, text } = await mutatedHarness([[from, to]]);
    const w = makeWorld({ mod, harnessText: text });
    const r = await runMain(w);
    const fatals = r.state.errorLedger.entries.filter(isCleanupEvidenceFatal);
    assert.equal(fatals.length, 1, to);
    assert.match(fatals[0].detail, /^cleanup-evidence:cleanup-event-outside-drain:\d+\(\+1\)$/, to);
    assert.equal(r.finalOverall, 'FAIL', to);
    assert.equal(r.closeout.primaryRow, 1, to);
  }
});

// ------------------------------------------------------------------------------------------
// ADDENDUM 3 (2026-10-02, review round) through the full main flow: ordinal labels (identity), a reported
// (never silently deduplicated) repeated merge, and the documented conservative outside-drain behaviour.
// ------------------------------------------------------------------------------------------

const FORGED_KIND = 'forged-different-event';
/** The page replaces its first drained wrapper-restore entry by a DIFFERENT event keeping its seq/attribution (after a correct fence). */
const forgeFirstRestore = (d) => {
  const i = d.eventLog.findIndex((e) => e.kind === 'wrapper-restore');
  return { ...d, eventLog: d.eventLog.map((e, j) => (j === i ? { seq: e.seq, phase: e.phase, activeCheck: e.activeCheck, activeControl: e.activeControl, kind: FORGED_KIND } : e)) };
};

test('ADDENDUM 3 labels: the fake page registers each cleanup ordinal\'s label (wrapper-restore for the events, null for spy/snapshot) through the real drain fence; a clean run PASSES with the identity check active', async () => {
  const w = makeWorld();
  const kinds = [];
  w.handlers.g2CleanupDrain = () => { kinds.push(w.cleanupPage.queue().pending.map((e) => [e.kind, e.label])); return w.cleanupPage.drain(); };
  const r = await runMain(w);
  assert.equal(r.finalOverall, 'PASS', JSON.stringify(r.closeout && r.closeout.causes));
  assert.deepEqual(kinds, [[['spy', null], ['event', 'wrapper-restore'], ['event', 'wrapper-restore'], ['snapshot', null]]]);
  assert.equal(r.state.errorLedger.entries.filter(isCleanupEvidenceFatal).length, 0);
});

test('ADDENDUM 3 cleanup-event-identity-mismatch: a drained wrapper-restore entry replaced by {kind: forged-different-event} keeping seq/phase => exactly ONE fatal cleanup-evidence:cleanup-event-identity-mismatch:<seq> => row 1 FAIL, never PASS', async () => {
  const w = makeWorld();
  let forgedSeq = null;
  w.handlers.g2CleanupDrain = () => w.cleanupPage.drain({ mutate: (d) => { const out = forgeFirstRestore(d); forgedSeq = out.eventLog.find((e) => e.kind === FORGED_KIND).seq; return out; } });
  const r = await runMain(w);
  const E = r.state.errorLedger.entries;
  const fatals = E.filter(isCleanupEvidenceFatal);
  assert.equal(fatals.length, 1, JSON.stringify(E));
  assert.match(fatals[0].detail, /^cleanup-evidence:cleanup-event-identity-mismatch:\d+$/);
  const seq = Number(fatals[0].detail.split(':').pop());
  assert.ok(H.isPageLocalOrdinal(forgedSeq) && !H.isPageLocalOrdinal(seq));
  assert.equal(r.state.eventLog.find((e) => e.seq === seq).kind, FORGED_KIND, 'the forged entry sits at the authoritative seq of the wrapper-restore ordinal');
  assert.deepEqual(E.filter((e) => e.kind === 'harness-exception' && !isCleanupEvidenceFatal(e)).map((e) => e.detail), [], 'the identity defect is the only harness fatal');
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.closeout.primaryRow, 1);
  assert.equal(r.exitCode, 1);
  assert.equal(readerVerdict(w).verdict, 'FAIL');
});

// ADDENDUM 5 (1): the former "unlabeled (label null) event ordinal is exempt from the identity check => PASS" pin is
// REMOVED. An event ordinal without a non-empty string label is refused at ingestion: on the awaited fence ONE
// ingest-entry-invalid violation and nothing ingested; on the early path a silent deferral (no violation). Through
// the full flow the unlabeled cleanup drain fence is refused => the fail-closed ingestion violation + exactly ONE
// cleanup-evidence fatal => row 1 FAIL, never PASS (with or without a forged event kind).
test('ADDENDUM 5 unlabeled event ordinals are REFUSED at ingestion (no exemption): fence => ONE ingest-entry-invalid violation, nothing ingested; early => deferred, no violation; spy/snapshot/alloc may stay unlabeled', () => {
  const ev = (ord, label) => ({ ord: PAGE_BASE + ord, kind: 'event', ...ACK_ATTR, ...(label === undefined ? {} : { label }) });
  for (const bad of [null, undefined, '', 7]) {
    const violations = [];
    const a = H.createRunAuthority({ allocator: H.createRunSeqAllocator(), attribution: { ...ACK_ATTR }, onViolation: (x) => violations.push(x) });
    const pending = [{ ord: PAGE_BASE + 1, kind: 'alloc', label: null, ...ACK_ATTR }, ev(2, bad)];
    const out = a.ingestFence({ pending, hw: PAGE_BASE + 2 });
    assert.deepEqual([out.ok, out.reason], [false, 'ingest-entry-invalid'], String(bad));
    assert.deepEqual(violations, ['ingest-entry-invalid'], String(bad));
    assert.deepEqual([a.ingested(), a.lastOrdinal()], [[], PAGE_BASE], 'atomic: nothing ingested');
    const e = H.createRunAuthority({ allocator: H.createRunSeqAllocator(), attribution: { ...ACK_ATTR }, onViolation: (x) => violations.push(x) });
    const early = e.ingestEarly([ev(1, bad)]);
    assert.equal(early.deferred, true, String(bad));
    assert.deepEqual([violations.length, e.ingested()], [1, []], 'the early path defers silently');
  }
  // control: the same entries labelled (event = its kind) are ingested; spy/snapshot/alloc with label null are fine
  const violations = [];
  const a = H.createRunAuthority({ allocator: H.createRunSeqAllocator(), attribution: { ...ACK_ATTR }, onViolation: (x) => violations.push(x) });
  const pending = [{ ord: PAGE_BASE + 1, kind: 'alloc', label: null, ...ACK_ATTR }, { ord: PAGE_BASE + 2, kind: 'spy', label: null, ...ACK_ATTR }, { ord: PAGE_BASE + 3, kind: 'snapshot', label: null, ...ACK_ATTR }, ev(4, 'wrapper-restore')];
  assert.equal(a.ingestFence({ pending, hw: PAGE_BASE + 4 }).ok, true);
  assert.deepEqual(violations, []);
  assert.deepEqual(a.ingested().map((x) => [x.kind, x.label]), [['alloc', null], ['spy', null], ['snapshot', null], ['event', 'wrapper-restore']]);
});

test('ADDENDUM 5 full flow: a page whose cleanup event ordinals carry NO label (formerly exempt) => the drain fence is refused (ingest-entry-invalid) => ONE cleanup-evidence:drain-refused fatal + the ingestion violation => row 1 FAIL, never PASS; the cleanup records never reach the state', async () => {
  for (const mutate of [null, forgeFirstRestore]) {
    const w = makeWorld({ unlabeledEvents: true });
    if (mutate) w.handlers.g2CleanupDrain = () => w.cleanupPage.drain({ mutate });
    const r = await runMain(w);
    const E = r.state.errorLedger.entries;
    assert.deepEqual(E.filter(isCleanupEvidenceFatal).map((e) => e.detail), ['cleanup-evidence:drain-refused:drain sync refused by the node authority (ingest-entry-invalid)'], JSON.stringify(E));
    assert.deepEqual(E.filter((e) => e.kind === 'harness-exception' && !isCleanupEvidenceFatal(e)).map((e) => e.detail), ['cross-realm-fence:ingest-entry-invalid']);
    const c = cleanupRecordsOf(r.state);
    assert.deepEqual([c.spy.length, c.restore.length, c.snap.length], [0, 0, 0], 'the atomic refusal ingested nothing');
    assert.equal(r.state.eventLog.some((e) => e.kind === FORGED_KIND), false);
    assert.notEqual(r.finalOverall, 'PASS');
    assert.equal(r.finalOverall, 'FAIL');
    assert.equal(r.closeout.primaryRow, 1);
    assert.equal(r.exitCode, 1);
    assert.equal(readerVerdict(w).verdict, 'FAIL');
  }
});

test('ADDENDUM 5 full flow: an UNLABELED event ordinal in the RUN transfer is refused at the run drain fence (never exempt) => the fail-closed ingestion violation => row 1 FAIL, never PASS', async () => {
  const w = crossWorldOf({ labels: { 41: null } });
  const r = await runMain(w);
  const E = r.state.errorLedger.entries;
  assert.ok(E.some((e) => e.kind === 'harness-exception' && e.detail === 'cross-realm-fence:ingest-entry-invalid'), JSON.stringify(E));
  assert.equal(r.state.eventLog.some((e) => e.kind === 'late-callback'), false, 'the refused ordinal never reached the state');
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.closeout.primaryRow, 1);
  assert.equal(readerVerdict(w).verdict, 'FAIL');
});

test('ADDENDUM 3/5 identity non-vacuity: with the (now unconditional) identity check REMOVED (mutated harness) the labelled forgery PASSES -- the check is what fails it', async () => {
  const { mod, text } = await mutatedHarness([['        else if (ev.kind !== src.label) out.push(`cleanup-event-identity-mismatch:${ev.seq}`);\n', '']]);
  const m = makeWorld({ mod, harnessText: text });
  m.handlers.g2CleanupDrain = () => m.cleanupPage.drain({ mutate: forgeFirstRestore });
  const rm = await runMain(m);
  assert.equal(rm.finalOverall, 'PASS', JSON.stringify(rm.closeout && rm.closeout.causes));
  assert.equal(rm.state.errorLedger.entries.filter(isCleanupEvidenceFatal).length, 0);
});

/** runPostReservation's single merge line, and an instrumented DOUBLE merge of the same rewritten delta (records both returns). */
const MERGE_LINE = "const { duplicates } = mergeCleanupDelta(state, authority.rewritePageRun(out.value.delta, { stage: 'cleanup' }));";
const DOUBLE_MERGE = "const g2Rw = authority.rewritePageRun(out.value.delta, { stage: 'cleanup' }); const g2M1 = mergeCleanupDelta(state, g2Rw); const g2M2 = mergeCleanupDelta(state, g2Rw); globalThis.__g2MergeReturns = [g2M1, g2M2]; const { duplicates } = g2M2;";
const DUP_GUARD = 'if (duplicates > 0) { cleanupEvidence.failure = `merge-duplicate:${duplicates}`; return; }';

test('ADDENDUM 3 double merge: the drain delta merged twice (instrumented harness copy) => first merge {duplicates:0}, second {duplicates:4} => exactly ONE fatal cleanup-evidence:merge-duplicate:4 => row 1 FAIL, never PASS; the state stays exactly-once', async () => {
  const { mod, text } = await mutatedHarness([[MERGE_LINE, DOUBLE_MERGE]]);
  globalThis.__g2MergeReturns = null;
  const w = makeWorld({ mod, harnessText: text });
  const r = await runMain(w);
  assert.deepEqual(globalThis.__g2MergeReturns, [{ duplicates: 0 }, { duplicates: 4 }]);
  globalThis.__g2MergeReturns = null;
  const E = r.state.errorLedger.entries;
  assert.deepEqual(E.filter(isCleanupEvidenceFatal).map((e) => e.detail), ['cleanup-evidence:merge-duplicate:4'], JSON.stringify(E));
  assert.deepEqual(E.filter((e) => e.kind === 'harness-exception' && !isCleanupEvidenceFatal(e)).map((e) => e.detail), []);
  const c = cleanupRecordsOf(r.state);
  assert.deepEqual([c.spy.length, c.restore.length, c.snap.length], [1, 2, 1], 'exactly-once state: the fatal is the ONLY trace of the repeat');
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.closeout.primaryRow, 1);
  assert.equal(r.exitCode, 1);
  assert.equal(readerVerdict(w).verdict, 'FAIL');
});

test('ADDENDUM 3 double merge: a delta carrying a record already present in the authoritative state (the run\'s C1 check-finalized event re-sent, unmutated harness) => ONE fatal cleanup-evidence:merge-duplicate:1 => row 1 FAIL', async () => {
  const w = makeWorld();
  const c1Event = { seq: pageSeqOf(1), kind: 'check-finalized', check: 'C1', verdict: 'PASS', reason: null, phase: 'P1', activeCheck: 'C1', activeControl: null };
  w.handlers.g2CleanupDrain = () => w.cleanupPage.drain({ mutate: (d) => ({ ...d, eventLog: [...d.eventLog, c1Event] }) });
  const r = await runMain(w);
  const E = r.state.errorLedger.entries;
  assert.deepEqual(E.filter(isCleanupEvidenceFatal).map((e) => e.detail), ['cleanup-evidence:merge-duplicate:1'], JSON.stringify(E));
  assert.equal(r.state.eventLog.filter((e) => e.kind === 'check-finalized' && e.check === 'C1').length, 1, 'never merged twice into the state');
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.closeout.primaryRow, 1);
});

test('ADDENDUM 3 double merge non-vacuity: with the merge-duplicate guard REMOVED (mutated harness) the double merge is silently deduplicated and the run PASSES; the guard is what fails it', async () => {
  const { mod, text } = await mutatedHarness([[MERGE_LINE, DOUBLE_MERGE], [DUP_GUARD, '']]);
  globalThis.__g2MergeReturns = null;
  const w = makeWorld({ mod, harnessText: text });
  const r = await runMain(w);
  assert.deepEqual(globalThis.__g2MergeReturns, [{ duplicates: 0 }, { duplicates: 4 }]);
  globalThis.__g2MergeReturns = null;
  assert.equal(r.finalOverall, 'PASS', JSON.stringify(r.closeout && r.closeout.causes));
  assert.equal(r.state.errorLedger.entries.filter(isCleanupEvidenceFatal).length, 0);
});

// ------------------------------------------------------------------------------------------
// ADDENDUM 4 (M1 fix, 2026-10-02) through the full main flow: semantic cleanup phase vs transport stage. A
// phase-'cleanup' event recorded after mark('cleanup') but carried by the RUN result is valid when the cleanup
// boundary is proven (exactly ONE authoritative 'cleanup' marker = an ingested run-stage alloc ordinal with phase
// cleanup, and the event's seq after it). The former ADDENDUM 3 point 3 pin (a conservative outside-drain
// false-FAIL for exactly that event) is FLIPPED to PASS. Every unproven / before-boundary / duplicate / identity /
// missing / unsourced variant is exactly ONE fatal cleanup-evidence:* (row 1), never PASS.
// ------------------------------------------------------------------------------------------

const LATE_EVENT = Object.freeze({ seq: 41, kind: 'late-callback', phase: 'cleanup', activeCheck: null, activeControl: null });
const EARLY_EVENT = Object.freeze({ seq: 39, kind: 'early-callback', phase: 'cleanup', activeCheck: null, activeControl: null });
const OLD_OUTSIDE_RULE = ["else if (!fromCleanupDrain && srcStage !== 'run')", 'else if (!fromCleanupDrain)'];
const BEFORE_BOUNDARY_LINE = '        else if (!fromCleanupDrain && !(ev.seq > boundarySeq)) out.push(`cleanup-event-before-boundary:${ev.seq}`);\n';
const UNPROVEN_LINE = '        else if (!fromCleanupDrain && boundarySeq === null) out.push(`cleanup-event-boundary-unproven:${ev.seq}`);\n';

/**
 * A fake g2RunPhases result whose page crossed mark('cleanup') before its result (passRun small ordinals: the 'cleanup'
 * marker is 40). `events` are appended to the run eventLog. The pending entries mirror the real page-ordinal source:
 * kind from the collections ('alloc' otherwise; `kinds` overrides by small seq), label = an event's own kind or
 * `marker:<name>` for a marker ordinal (ADDENDUM 5; `labels` overrides), attribution P1 below `cleanupFrom` and cleanup from it on. Entries up to the marker travel through the
 * REAL attribution fence (Node adopts the cleanup attribution), the rest through the run's drain fence.
 */
function crossBoundaryRun({ events = [LATE_EVENT], markers = null, cleanupFrom = 40, kinds = {}, labels = {} } = {}) {
  const over = { eventLog: [passRun().c1FinalizedEvent, ...events] };
  if (markers) over.markers = markers;
  const run = shiftRunSeqs(passRun(over));
  const kindOf = new Map();
  const labelOf = new Map();
  for (const [k, kind] of [['spyLedger', 'spy'], ['eventLog', 'event'], ['stateSnapshots', 'snapshot']]) {
    for (const e of run[k] || []) { kindOf.set(e.seq, kind); if (kind === 'event') labelOf.set(e.seq, e.kind); }
  }
  // (ADDENDUM 5) like the real runner's mark(name): every marker ordinal is an alloc labelled `marker:<name>`
  for (const m of run.markers || []) if (!kindOf.has(m.seq)) labelOf.set(m.seq, `marker:${m.name}`);
  for (const [s, kind] of Object.entries(kinds)) kindOf.set(pageSeqOf(Number(s)), kind);
  for (const [s, label] of Object.entries(labels)) labelOf.set(pageSeqOf(Number(s)), label);
  const max = Math.max(maxOrdinalOf(run), ...Object.keys(kinds).map((s) => pageSeqOf(Number(s))));
  const entries = [];
  for (let o = PAGE_BASE + 1; o <= max; o += 1) {
    entries.push({ ord: o, kind: kindOf.get(o) || 'alloc', label: labelOf.has(o) ? labelOf.get(o) : null, ...(o >= pageSeqOf(cleanupFrom) ? CLEANUP_ATTR : ACK_ATTR) });
  }
  return { ...run, absoluteSeqs: true, pageSource: { pending: () => entries.map((e) => ({ ...e })), ack() {} }, attributionFence: { upTo: pageSeqOf(40), attribution: CLEANUP_ATTR } };
}
const crossWorldOf = (spec = {}, mod = null) => makeWorld({ ...(mod ? { mod: mod.mod, harnessText: mod.text } : {}), handlers: { g2RunPhases: () => crossBoundaryRun(spec) } });
const cleanupFatalsOf = (r) => r.state.errorLedger.entries.filter(isCleanupEvidenceFatal).map((e) => e.detail);
const otherHarnessFatalsOf = (r) => r.state.errorLedger.entries.filter((e) => e.kind === 'harness-exception' && !isCleanupEvidenceFatal(e)).map((e) => e.detail);
/** Exactly ONE cleanup-evidence fatal matching `re`, no other harness fatal, row 1 FAIL (harness + reader). Returns the seq in the detail. */
function assertOneCleanupFatal(w, r, re) {
  const f = cleanupFatalsOf(r);
  assert.equal(f.length, 1, JSON.stringify(r.state.errorLedger.entries));
  assert.match(f[0], re);
  assert.deepEqual(otherHarnessFatalsOf(r), []);
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.closeout.primaryRow, 1);
  assert.equal(r.exitCode, 1);
  assert.equal(readerVerdict(w).verdict, 'FAIL');
  return Number(/:(\d+)(\(\+\d+\))?$/.exec(f[0])[1]);
}

test('ADDENDUM 4 (2) FLIPPED (was the ADDENDUM 3 point 3 conservative false-FAIL): a phase-cleanup late-callback event recorded after mark(cleanup) and carried by the RUN result, proven after the authoritative cleanup marker => PASS, no cleanup-evidence fatal', async () => {
  const w = crossWorldOf();
  const r = await runMain(w);
  assert.equal(r.finalOverall, 'PASS', JSON.stringify(r.closeout && r.closeout.causes));
  assert.equal(readerVerdict(w).verdict, 'PASS');
  assert.deepEqual(cleanupFatalsOf(r), []);
  assert.deepEqual(otherHarnessFatalsOf(r), []);
  const S = r.state;
  const late = S.eventLog.filter((e) => e.kind === 'late-callback');
  assert.equal(late.length, 1, 'carried exactly once (by the run stage)');
  const marker = S.errorLedger.markers.filter((m) => m.name === 'cleanup');
  assert.equal(marker.length, 1);
  assert.ok(late[0].seq > marker[0].seq, 'after the authoritative cleanup marker');
  assert.ok(late[0].seq < cleanupRecordsOf(S).spy[0].seq, 'ingested with the run, before every drained cleanup record');
  assert.ok(!H.isPageLocalOrdinal(late[0].seq));
  assert.deepEqual(H.primarySeqAllocations(S).problems, []);
  // the drained cleanup evidence is still complete
  const c = cleanupRecordsOf(S);
  assert.deepEqual([c.spy.length, c.restore.length, c.snap.length], [1, 2, 1]);
});

test('ADDENDUM 4 non-vacuity (full flow): restoring the OLD rule (every non-drain cleanup source => outside-drain; mutated harness text) makes the same valid world FAIL with ONE fatal cleanup-evidence:cleanup-event-outside-drain:<seq>', async () => {
  const mod = await mutatedHarness([OLD_OUTSIDE_RULE]);
  const w = crossWorldOf({}, mod);
  const r = await runMain(w);
  const seq = assertOneCleanupFatal(w, r, /^cleanup-evidence:cleanup-event-outside-drain:\d+$/);
  assert.equal(r.state.eventLog.find((e) => e.seq === seq).kind, 'late-callback');
});

test('ADDENDUM 4 (3) full flow: a run-carried phase-cleanup event recorded BEFORE the cleanup marker => ONE fatal cleanup-evidence:cleanup-event-before-boundary:<seq> => FAIL (the post-marker one stays valid); removing the boundary check (mutated) => PASS', async () => {
  const spec = { events: [EARLY_EVENT, LATE_EVENT], cleanupFrom: 39 };
  const w = crossWorldOf(spec);
  const r = await runMain(w);
  const seq = assertOneCleanupFatal(w, r, /^cleanup-evidence:cleanup-event-before-boundary:\d+$/);
  assert.equal(r.state.eventLog.find((e) => e.seq === seq).kind, 'early-callback');
  assert.ok(seq < r.state.errorLedger.markers.find((m) => m.name === 'cleanup').seq);
  const mod = await mutatedHarness([[BEFORE_BOUNDARY_LINE, '']]);
  const m = crossWorldOf(spec, mod);
  const rm = await runMain(m);
  assert.equal(rm.finalOverall, 'PASS', JSON.stringify(rm.closeout && rm.closeout.causes));
  assert.deepEqual(cleanupFatalsOf(rm), []);
});

const UNPROVEN_CASES = [
  ['no cleanup marker in the run result', { markers: [{ seq: 0, name: 'P1' }, { seq: 3, name: 'P2' }] }],
  ['two cleanup markers (the real one + a P1 alloc ordinal)', { markers: [{ seq: 0, name: 'P1' }, { seq: 3, name: 'P2' }, { seq: 38, name: 'cleanup' }, { seq: 40, name: 'cleanup' }] }],
  ['the cleanup marker is a P1-phase alloc ordinal (the attribution changed only after it)', { cleanupFrom: 41 }],
];
for (const [name, spec] of UNPROVEN_CASES) {
  test(`ADDENDUM 4 (4) full flow: ordering unknown (${name}) => ONE fatal cleanup-evidence:cleanup-event-boundary-unproven:<seq> => row 1 FAIL, never PASS`, async () => {
    const w = crossWorldOf(spec);
    const r = await runMain(w);
    const seq = assertOneCleanupFatal(w, r, /^cleanup-evidence:cleanup-event-boundary-unproven:\d+$/);
    assert.equal(r.state.eventLog.find((e) => e.seq === seq).kind, 'late-callback');
  });
}

test('ADDENDUM 4 (4) full flow: a page whose run transfer never reported the cleanup attribution (every run ordinal ingested as P1, the pre-ADDENDUM-4 fake transfer) => boundary-unproven => FAIL; with the unproven check REMOVED (mutated) the zero-marker world PASSES', async () => {
  const w = makeWorld({ handlers: { g2RunPhases: () => passRun({ eventLog: [passRun().c1FinalizedEvent, LATE_EVENT] }) } });
  const r = await runMain(w);
  assertOneCleanupFatal(w, r, /^cleanup-evidence:cleanup-event-boundary-unproven:\d+$/);
  const mod = await mutatedHarness([[UNPROVEN_LINE, '']]);
  const m = crossWorldOf(UNPROVEN_CASES[0][1], mod);
  const rm = await runMain(m);
  assert.equal(rm.finalOverall, 'PASS', JSON.stringify(rm.closeout && rm.closeout.causes));
  assert.deepEqual(cleanupFatalsOf(rm), []);
});

test('ADDENDUM 4 (5) full flow: the same event carried by BOTH transfers (the cleanup delta re-sends the run-carried late-callback) => ONE fatal cleanup-evidence:merge-duplicate:1 => FAIL; the state holds it once', async () => {
  const w = crossWorldOf();
  w.handlers.g2CleanupDrain = () => w.cleanupPage.drain({ mutate: (d) => ({ ...d, eventLog: [...d.eventLog, { ...LATE_EVENT, seq: pageSeqOf(LATE_EVENT.seq) }] }) });
  const r = await runMain(w);
  assert.deepEqual(cleanupFatalsOf(r), ['cleanup-evidence:merge-duplicate:1']);
  assert.deepEqual(otherHarnessFatalsOf(r), []);
  assert.equal(r.state.eventLog.filter((e) => e.kind === 'late-callback').length, 1);
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.closeout.primaryRow, 1);
  assert.equal(readerVerdict(w).verdict, 'FAIL');
});

test('ADDENDUM 4 (6) full flow: identity mismatch of the run-carried cleanup event (its ordinal registered late-callback, the run result carries a forged kind) => ONE fatal cleanup-evidence:cleanup-event-identity-mismatch:<seq> => FAIL', async () => {
  const w = crossWorldOf({ events: [{ ...LATE_EVENT, kind: FORGED_KIND }], labels: { 41: 'late-callback' } });
  const r = await runMain(w);
  const seq = assertOneCleanupFatal(w, r, /^cleanup-evidence:cleanup-event-identity-mismatch:\d+$/);
  assert.equal(r.state.eventLog.find((e) => e.seq === seq).kind, FORGED_KIND);
});

test('ADDENDUM 4 (7) full flow: a run-stage cleanup event ordinal ingested by Node but missing from the run result => ONE fatal cleanup-evidence:page-evidence-missing:event:<seq>(+1) (with cleanup-event-missing) => FAIL', async () => {
  const w = crossWorldOf({ events: [], kinds: { 41: 'event' }, labels: { 41: 'late-callback' } });
  const r = await runMain(w);
  assertOneCleanupFatal(w, r, /^cleanup-evidence:page-evidence-missing:event:\d+\(\+1\)$/);
  assert.equal(r.state.eventLog.some((e) => e.kind === 'late-callback'), false);
});

test('ADDENDUM 4 (8) full flow: a run-result cleanup event whose ordinal Node ingested as an alloc (no event source) => ONE fatal cleanup-evidence:cleanup-event-unsourced:<seq> => FAIL', async () => {
  const w = crossWorldOf({ kinds: { 41: 'alloc' } });
  const r = await runMain(w);
  const seq = assertOneCleanupFatal(w, r, /^cleanup-evidence:cleanup-event-unsourced:\d+$/);
  assert.equal(r.state.eventLog.find((e) => e.seq === seq).kind, 'late-callback');
});

test('ADDENDUM 4 regression (full flow): the run-carried cleanup event with its phase rewritten to P11 (ordinal registered cleanup/late-callback) => ONE fatal cleanup-evidence:cleanup-event-phase-mismatch:<seq> => FAIL; removing `&& !semanticCleanupSrc` (mutated) => PASS', async () => {
  const spec = { events: [{ ...LATE_EVENT, phase: 'P11' }], labels: { 41: 'late-callback' } };
  const w = crossWorldOf(spec);
  const r = await runMain(w);
  const seq = assertOneCleanupFatal(w, r, /^cleanup-evidence:cleanup-event-phase-mismatch:\d+$/);
  assert.equal(r.state.eventLog.find((e) => e.seq === seq).kind, 'late-callback');
  const mod = await mutatedHarness([["if (ev.phase !== 'cleanup' && !fromCleanupDrain && !semanticCleanupSrc) continue;", "if (ev.phase !== 'cleanup' && !fromCleanupDrain) continue;"]]);
  const m = crossWorldOf(spec, mod);
  const rm = await runMain(m);
  assert.equal(rm.finalOverall, 'PASS', JSON.stringify(rm.closeout && rm.closeout.causes));
  assert.deepEqual(cleanupFatalsOf(rm), []);
});

// ------------------------------------------------------------------------------------------
// ADDENDUM 5 (4th pass review round) through the full main flow: (2) marker identity -- the single authoritative
// 'cleanup' marker must be sourced by the run-stage alloc ordinal the runner's mark('cleanup') allocated with label
// 'marker:cleanup' (a cleanup-attributed alloc with any other label never proves the boundary); (3) the stable
// cleanup drain -- an event allocated while the drain fence is in flight is carried by the next round, and a page
// that never stabilizes fails closed (ONE cleanup-evidence fatal).
// ------------------------------------------------------------------------------------------

const MARKER_LABEL_CLAUSE = ["markerSrc.kind === 'alloc' && markerSrc.label === 'marker:cleanup' && markerSrc.phase === 'cleanup'", "markerSrc.kind === 'alloc' && markerSrc.phase === 'cleanup'"];
const SUBSTITUTED_MARKERS = [{ seq: 0, name: 'P1' }, { seq: 3, name: 'P2' }, { seq: 39, name: 'cleanup' }];
const SUBSTITUTION_CASES = [
  // the run's 'cleanup' marker names an EARLIER cleanup-attributed alloc (39) whose label is not marker:cleanup, while the
  // genuine marker:cleanup ordinal (40) goes unreferenced
  ['an earlier cleanup-attributed alloc labelled exec:cleanup-step', { markers: SUBSTITUTED_MARKERS, cleanupFrom: 39, labels: { 39: 'exec:cleanup-step', 40: 'marker:cleanup' } }],
  ['an earlier cleanup-attributed unlabelled alloc', { markers: SUBSTITUTED_MARKERS, cleanupFrom: 39, labels: { 39: null, 40: 'marker:cleanup' } }],
  // the marker ordinal itself carries ANOTHER marker's label
  ['the cleanup marker ordinal labelled marker:P2', { labels: { 40: 'marker:P2' } }],
];
for (const [name, spec] of SUBSTITUTION_CASES) {
  test(`ADDENDUM 5 (2) marker substitution (${name}) => ONE fatal cleanup-evidence:cleanup-event-boundary-unproven:<seq> => row 1 FAIL, never PASS`, async () => {
    const w = crossWorldOf(spec);
    const r = await runMain(w);
    const seq = assertOneCleanupFatal(w, r, /^cleanup-evidence:cleanup-event-boundary-unproven:\d+$/);
    assert.equal(r.state.eventLog.find((e) => e.seq === seq).kind, 'late-callback');
    const markers = r.state.errorLedger.markers.filter((m) => m.name === 'cleanup');
    assert.equal(markers.length, 1, 'exactly one authoritative cleanup marker -- only its identity is wrong');
    assert.ok(seq > markers[0].seq, 'the event is after the substituted marker (not a before-boundary case)');
  });
}

test('ADDENDUM 5 (2) marker substitution non-vacuity: the genuine marker:cleanup ordinal proves the boundary (PASS); with the label clause REMOVED (mutated harness) the substituted exec:cleanup-step alloc PASSES too -- the label is what fails it', async () => {
  const ok = await runMain(crossWorldOf({}));
  assert.equal(ok.finalOverall, 'PASS', JSON.stringify(ok.closeout && ok.closeout.causes));
  const mod = await mutatedHarness([MARKER_LABEL_CLAUSE]);
  for (const [, spec] of SUBSTITUTION_CASES.slice(0, 2)) {
    const m = crossWorldOf(spec, mod);
    const rm = await runMain(m);
    assert.equal(rm.finalOverall, 'PASS', JSON.stringify(rm.closeout && rm.closeout.causes));
    assert.deepEqual(cleanupFatalsOf(rm), []);
  }
});

test('ADDENDUM 5 (3) static coupling: the REAL in-page g2CleanupDrain is a bounded stable-fence loop (8 rounds; returns only when the fence high-water did not move; otherwise "cleanup drain did not stabilize") -- the fake page mirrors it', () => {
  const a = REAL_SOURCE.indexOf('async function g2CleanupDrain(');
  const fn = REAL_SOURCE.slice(a, REAL_SOURCE.indexOf('\n}\n', a));
  assert.ok(a > 0);
  assert.ok(fn.includes('for (let round = 0; round < 8; round += 1)'), 'bounded at 8 rounds');
  assert.ok(fn.includes('await sync.drain()'), 'each round awaits the drain fence');
  assert.ok(fn.includes('if (g2FenceReport().hw === delta.pageHighWater) return { ok: true, delta, error: null };'), 'stable high-water => the delta');
  assert.ok(fn.includes("message: 'cleanup drain did not stabilize'"), 'unstable => fail closed');
});

test('ADDENDUM 5 (3) stable drain: a cleanup event allocated while the drain fence is IN FLIGHT is carried by the next round (ingested, merged once, phase cleanup, identity-checked) => PASS', async () => {
  const w = makeWorld();
  w.handlers.g2CleanupDrain = () => w.cleanupPage.drain({
    duringFence: (round) => { if (round === 0) w.cleanupPage.recorder.logEvent('late-cleanup-callback', { ok: true }); },
  });
  const r = await runMain(w);
  assert.equal(r.finalOverall, 'PASS', JSON.stringify(r.closeout && r.closeout.causes));
  assert.equal(readerVerdict(w).verdict, 'PASS');
  assert.deepEqual(r.state.errorLedger.entries.filter((e) => e.kind === 'harness-exception'), []);
  const rounds = w.log.filter((e) => e.kind === 'page' && e.call === 'cleanup-drain');
  assert.deepEqual(rounds.map((e) => [e.round, e.report.kinds]), [[0, ['spy', 'event', 'event', 'snapshot']], [1, ['event']]], 'round 0 races the callback; round 1 carries it and is stable');
  const late = r.state.eventLog.filter((e) => e.kind === 'late-cleanup-callback');
  assert.equal(late.length, 1, 'in the authoritative state exactly once');
  assert.equal(late[0].phase, 'cleanup');
  assert.ok(!H.isPageLocalOrdinal(late[0].seq));
  const c = cleanupRecordsOf(r.state);
  assert.ok(late[0].seq > Math.max(...[...c.spy, ...c.restore, ...c.snap].map((x) => x.seq)), 'ingested after the first round\'s batch');
  assert.deepEqual([c.spy.length, c.restore.length, c.snap.length], [1, 2, 1]);
  assert.deepEqual(w.cleanupPage.queue().pending, [], 'Node acknowledged every round');
  assert.deepEqual(H.primarySeqAllocations(r.state).problems, []);
});

test('ADDENDUM 5 (3) stable drain: a page that keeps allocating cleanup events during every fence never stabilizes => {ok:false, "cleanup drain did not stabilize"} after 8 rounds => exactly ONE fatal cleanup-evidence:drain-refused:cleanup drain did not stabilize => row 1 FAIL, never PASS', async () => {
  const w = makeWorld();
  w.handlers.g2CleanupDrain = () => w.cleanupPage.drain({ duringFence: () => { w.cleanupPage.recorder.logEvent('chatty-cleanup-callback', { ok: true }); } });
  const r = await runMain(w);
  assert.equal(w.log.filter((e) => e.kind === 'page' && e.call === 'cleanup-drain').length, 8, 'bounded at 8 rounds');
  const E = r.state.errorLedger.entries;
  assert.deepEqual(E.filter(isCleanupEvidenceFatal).map((e) => e.detail), ['cleanup-evidence:drain-refused:cleanup drain did not stabilize'], JSON.stringify(E));
  assert.deepEqual(E.filter((e) => e.kind === 'harness-exception' && !isCleanupEvidenceFatal(e)).map((e) => e.detail), []);
  assert.equal(cleanupRecordsOf(r.state).restore.length, 0, 'nothing merged from an unstable drain');
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.closeout.primaryRow, 1);
  assert.equal(r.exitCode, 1);
  assert.equal(readerVerdict(w).verdict, 'FAIL');
});

// ------------------------------------------------------------------------------------------
// Before-live hardening Medium 2 (2026-10-02): cleanup evidence retained after a FAILED phase run, full main flow.
// The page side (g2RunPhases catching the runner throw, g2EnterCleanupAfterFailure, g2FinalizeRunTransfer) is covered
// on the real page bundle in clashpanel-viewerbridge.acceptance.final-transfer.test.mjs; here the fake page returns the
// failure transfer that path produces and runPostReservation handles it end to end (rewrite, apply, cleanup drain,
// provenance checks, closeout, reader).
// ------------------------------------------------------------------------------------------

const PAGE_FAILURE = Object.freeze({ name: 'TypeError', message: 'runChecksInPhaseOrder: authoritative gate refused (gates.C1.keys)' });
/**
 * The failure transfer of a run whose runner threw: the page evidence up to the throw (passRun's C1 finalization event
 * etc.), the failure path's ONE identity-bound marker:cleanup (40, acknowledged through the real attribution fence) and a
 * cleanup-phase callback event carried by the run stage after it (41); NO verdict fields -- unless `forge` (a page that
 * also sends PASS checks/controls/gate, which Node must ignore).
 */
function failedRunTransfer({ forge = false } = {}) {
  const r = crossBoundaryRun({ markers: [{ seq: 40, name: 'cleanup' }] });
  const { checks, controls, subchecks, extras, c1FinalizedEvent, gates, sessionTainted, taintPhase, phaseLog, spyInstall, ...evidence } = r;
  void subchecks; void extras; void taintPhase; void phaseLog; void spyInstall;
  return { ...evidence, ...(forge ? { checks, controls, gates, c1FinalizedEvent, sessionTainted } : {}), phaseRunFailure: { ...PAGE_FAILURE, cleanupEntry: 'marker-allocated' } };
}
/** The committed (schema-valid) R1 of the run, read back from the durable result directory. */
function r1Of(w) {
  const view = w.fs.processCrashView();
  return JSON.parse(view.readFile(path.join(CHAIN.D1, H.R1_NAME)).toString('utf8'));
}
const allBlockedByFailure = (S) => Object.values(S.checks).every((c) => vr(c) === 'BLOCKED(phase-run-threw)' && c.evidence.phaseRunFailure.message === PAGE_FAILURE.message);

test('Medium 2 (full flow): a phase run that threw in the page but made the failure transfer => run + cleanup page evidence retained in the state AND in the committed schema-valid R1, every check BLOCKED(phase-run-threw) with the exact page failure, no cleanup-evidence fatal, row 3 FAIL committed through K (R1/R2/R3/J/K); harness and reader agree', async () => {
  const { w, r, reader } = await consumedRun({ handlers: { g2RunPhases: () => failedRunTransfer() } });
  const S = r.state;
  assert.ok(allBlockedByFailure(S), JSON.stringify(S.checks.C1));
  assert.equal(S.sessionTainted, true);
  assert.equal(S.gates, null);
  assert.deepEqual(S.errorLedger.entries.filter((e) => e.kind === 'harness-exception'), [], 'no fence violation, no cleanup-evidence fatal');
  assert.ok(w.log.some((e) => e.kind === 'rpc' && e.key === 'g2CleanupDrain'), 'the cleanup drain ran after the failed run');
  const c = cleanupRecordsOf(S);
  assert.deepEqual([c.spy.length, c.restore.length, c.snap.length], [1, 2, 1], 'cleanup-step evidence retained');
  assert.equal(S.eventLog.filter((e) => e.kind === 'late-callback').length, 1, 'the run-carried cleanup callback retained once');
  assert.equal(S.eventLog.filter((e) => e.kind === 'check-finalized').length, 1, 'the failed run\'s page evidence retained');
  assert.equal(S.errorLedger.markers.filter((m) => m.name === 'cleanup').length, 1);
  // closeout: the failed run is durably closed by the UNCHANGED protocol
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.closeout.primaryRow, 3);
  assert.equal(r.closeout.committed, true);
  assert.deepEqual(r.closeout.causes, [], 'no closeout failure: R1 verifies (failed-run schema), R2, R3, Kc, K');
  assert.equal(reader.verdict, 'FAIL');
  assert.equal(reader.witness, 'W-6');
  assert.deepEqual(reader.detail.failedRun, { source: 'page-phase-run', category: PAGE_FAILURE.name, phase: null, failureSeq: S.phaseRunFailure.failureSeq, c1Stage: 'pre-c1' });
  // the persisted R1 is schema-valid and carries the retained evidence and the exact failure detail
  const r1 = r1Of(w);
  assert.deepEqual(H.validateResultSchema(r1, 'payload').errors, []);
  assert.equal(r1.phaseRunFailure.message, PAGE_FAILURE.message);
  assert.equal(r1.phaseRunFailure.category, 'TypeError');
  assert.equal(r1.checks.C9.evidence.phaseRunFailure.message, PAGE_FAILURE.message);
  assert.equal(r1.gates, null);
  assert.equal(r1.overall.row, 3);
  assert.equal(r1.eventLog.filter((e) => e.kind === 'wrapper-restore' && e.phase === 'cleanup').length, 2);
  assert.equal(r1.spyLedger.records.filter((e) => e.phase === 'cleanup').length, 1);
  assert.equal(r1.stateSnapshots.filter((e) => e.baselinePhase === 'cleanup').length, 1);
  assert.equal(r1.closeout.primaryRow, 3);
  // contrast: a page whose run THREW without a transfer retains no cleanup page evidence (no drain) but is ALSO durably closed
  const t = await consumedRun({ handlers: { g2RunPhases: () => { throw new Error('page crashed'); } } });
  assert.equal(t.w.log.some((e) => e.kind === 'rpc' && e.key === 'g2CleanupDrain'), false);
  const tc = cleanupRecordsOf(t.r.state);
  assert.deepEqual([tc.spy.length, tc.restore.length, tc.snap.length], [0, 0, 0]);
  assert.deepEqual(t.r.closeout.causes, []);
  assert.equal(t.reader.verdict, 'FAIL');
  const tr1 = r1Of(t.w);
  assert.deepEqual(H.validateResultSchema(tr1, 'payload').errors, []);
  assert.equal(tr1.eventLog.length, 0, 'its R1 holds no page evidence');
  assert.equal(tr1.phaseRunFailure.message, 'page crashed');
});

test('Medium 2 (full flow): phase threw AND the cleanup evidence has a problem => BOTH causes retained (checks BLOCKED(phase-run-threw) with the failure + exactly ONE cleanup-evidence fatal); FAIL, never PASS', async () => {
  const cases = [
    ['omitted cleanup event', (w) => () => w.cleanupPage.drain({ mutate: (d) => ({ ...d, eventLog: [] }) }), /^cleanup-evidence:page-evidence-missing:event:\d+\(\+\d+\)$/],
    ['refused drain', () => () => ({ ok: false, delta: null, error: { name: 'Error', message: 'x' } }), /^cleanup-evidence:drain-refused:x$/],
    ['duplicate merge', (w) => () => w.cleanupPage.drain({ mutate: (d) => ({ ...d, eventLog: [...d.eventLog, { ...LATE_EVENT, seq: pageSeqOf(LATE_EVENT.seq) }] }) }), /^cleanup-evidence:merge-duplicate:1$/],
  ];
  for (const [name, make, re] of cases) {
    const w = makeWorld({ handlers: { g2RunPhases: () => failedRunTransfer() } });
    w.handlers.g2CleanupDrain = make(w);
    const r = await runMain(w);
    assert.ok(allBlockedByFailure(r.state), name);
    const f = r.state.errorLedger.entries.filter(isCleanupEvidenceFatal).map((e) => e.detail);
    assert.equal(f.length, 1, `${name}: ${JSON.stringify(f)}`);
    assert.match(f[0], re, name);
    assert.equal(r.finalOverall, 'FAIL', name);
    assert.equal(r.closeout.primaryRow, 1, name);
    assert.equal(readerVerdict(w).verdict, 'FAIL', name);
  }
});

test('Medium 2 (full flow): a failure transfer that ALSO carries page PASS verdicts/gate never PASSes (Node ignores them); non-vacuity: without the Node failure verdict (mutated harness) the same forged transfer is taken at face value', async () => {
  const { r, reader } = await consumedRun({ handlers: { g2RunPhases: () => failedRunTransfer({ forge: true }) } });
  assert.ok(allBlockedByFailure(r.state));
  assert.equal(r.state.gates, null);
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(reader.verdict, 'FAIL');
  const mod = await mutatedHarness([["      if (isPlainObject(run) && Object.hasOwn(run, 'phaseRunFailure')) { applyPhaseRunFailureToState(state, authenticatedFailureRun(run, authority), { nextSeq: runSeq.next }); tainted = true; }\n", '']]);
  const w = makeWorld({ mod: mod.mod, harnessText: mod.text, handlers: { g2RunPhases: () => failedRunTransfer({ forge: true }) } });
  const rm = await runMain(w);
  assert.equal(vr(rm.state.checks.C9), 'PASS', 'the page verdict would have been applied');
  assert.equal(allBlockedByFailure(rm.state), false);
});

// ==========================================================================================
// FAILED-RUN CLOSEOUT (owner-authorized 2026-10-02), full main flow.
// A failed phase run is durably closed by the UNCHANGED closeout protocol (R1 -> R2 -> R3 -> J -> K, finalOverall =
// primaryOverall = FAIL): R1 carries the Node-set root failure `phaseRunFailure`; it is never replaced by later
// cleanup / closeout failures (they only ADD reasons); markers survive into the durable R1; a closeout failure keeps the
// root failure in F; a PASS run keeps `phaseRunFailure: null` and `failedRun: none`.
// ==========================================================================================

/** The exact page failure detail a runner throw at P4 produces (g2ErrOf + g2FailureDetail + attribution at the throw). */
const FR_FAILURE = Object.freeze({
  name: 'TypeError', message: PAGE_FAILURE.message, phase: 'P1', activeCheck: null, activeControl: null,
  operation: null, // (operation cross-validation against the opLedger is covered at the state level in the verdict file)
});
/** Every page marker emitted before the throw (P1..P4, small passRun ordinals) + the failure path's ONE marker:cleanup (40). */
const FR_MARKERS = Object.freeze([{ seq: 0, name: 'P1' }, { seq: 40, name: 'cleanup' }]); // PRE-C1 world: this fake page never reaches the gate, so no downstream marker may exist
const FR_FAILURE_ORDINAL = 38; // the page's identity-bound `phase-run-failure` alloc ordinal (between P4 and the cleanup marker)
/**
 * A failure transfer exactly like g2RunPhases' failure branch returns it: the whole marker log, the transferred page
 * evidence, and `phaseRunFailure` with the failure's own page ordinal (`seq`, rewritten by Node) + cleanupEntry; no verdicts.
 */
function frTransfer({ markers = FR_MARKERS } = {}) {
  const r = crossBoundaryRun({ markers: markers.map((m) => ({ ...m })), labels: { [FR_FAILURE_ORDINAL]: 'phase-run-failure' } });
  const { checks, controls, subchecks, extras, c1FinalizedEvent, gates, sessionTainted, taintPhase, phaseLog, spyInstall, ...evidence } = r;
  void checks; void controls; void subchecks; void extras; void c1FinalizedEvent; void gates; void sessionTainted; void taintPhase; void phaseLog; void spyInstall;
  return { ...evidence, phaseRunFailure: { ...FR_FAILURE, seq: pageSeqOf(FR_FAILURE_ORDINAL), cleanupEntry: 'marker-allocated' } };
}
/** The durable artifact set of a world (process-crash view). */
function durableOf(w) {
  const files = H.readArtifactFileMap({ fs: w.fs.processCrashView(), chain: CHAIN });
  const json = (b) => (b ? JSON.parse(b.toString('utf8')) : null);
  return {
    files,
    r1Bytes: files.results[H.R1_NAME], r1: json(files.results[H.R1_NAME]),
    r2: files.results[H.R2_NAME] ? files.results[H.R2_NAME].toString('utf8') : null,
    r3: json(files.results[H.R3_NAME]), k: json(files.attempts[H.commitName(AUTH_ID)]), f: json(files.attempts[H.closeoutFailureName(AUTH_ID)]),
  };
}
/** The expected Node-authoritative root-failure record of frTransfer (failureSeq = the authoritative seq of ordinal 38). */
function frExpectedRecord(failureSeq) {
  return {
    primary: true, source: 'page-phase-run', realm: 'page', status: 'threw', category: 'TypeError', message: PAGE_FAILURE.message,
    phase: 'P1', activeCheck: null, activeControl: null, operation: null, failureSeq, seqSource: 'page-alloc', cleanupEntry: 'marker-allocated', c1Stage: 'pre-c1', gateSeq: null, gateOutcome: null,
  };
}
const markerNamesOf = (r1) => r1.errorLedger.markers.map((m) => m.name);
const strictlyIncreasing = (xs) => xs.every((x, i) => i === 0 || x > xs[i - 1]);

test('FAILED-RUN CLOSEOUT (1): phase throws (page failure transfer) => valid failed-run R1, R2 (failedRun line), R3 (validates, hashes the on-disk R1), J, K committed; reader FAIL at W-6 with detail.failedRun; harness and reader agree', async () => {
  const { w, r, reader } = await consumedRun({ handlers: { g2RunPhases: () => frTransfer() } });
  assert.deepEqual([r.finalOverall, r.closeout.primaryRow, r.closeout.committed, r.exitCode], ['FAIL', 3, true, 1]);
  assert.deepEqual(r.closeout.causes, []);
  const d = durableOf(w);
  // R1: schema-valid failed-run record, FAIL row 3, tainted, no gate
  assert.deepEqual(H.validateResultSchema(d.r1, 'payload').errors, []);
  assert.deepEqual([d.r1.overall.verdict, d.r1.overall.row, d.r1.sessionTainted, d.r1.gates], ['FAIL', 3, true, null]);
  assert.deepEqual(H.phaseRunFailureShapeProblems(d.r1.phaseRunFailure), []);
  assert.deepEqual(H.failedRunRecordProblems(d.r1), []);
  // R2: exactly one failedRun line naming the root failure
  const pf = d.r1.phaseRunFailure;
  const line = `failedRun: page-phase-run/TypeError/P1/seq ${pf.failureSeq}/pre-c1`;
  assert.equal(d.r2.split('\n').filter((l) => l === line).length, 1, d.r2);
  assert.equal(d.r2.split('\n').filter((l) => l.startsWith('failedRun:')).length, 1);
  // R3: validates and its R1 / R2 hashes are those of the on-disk bytes
  assert.deepEqual(H.validateCloseoutManifest(d.r3), { ok: true, errors: [] });
  assert.equal(d.r3.artifacts[0].sha256, sha(d.r1Bytes));
  assert.equal(d.r3.artifacts[1].sha256, sha(d.files.results[H.R2_NAME]));
  assert.deepEqual([d.r3.primaryOverall, d.r3.primaryRow], ['FAIL', 3]);
  // J + K: journal ends CLOSEOUT_STARTED, K is the ordinary FAIL commit (finalOverall = primaryOverall), no F
  assert.deepEqual(w.durableJournalStates(), ['AUTH_BOUND', 'ATTEMPT_CONSUMED', 'CLOSEOUT_STARTED']);
  assert.deepEqual([d.k.finalOverall, d.k.primaryOverall, d.k.primaryRow, d.k.resultSha256], ['FAIL', 'FAIL', 3, sha(d.r1Bytes)]);
  assert.equal(d.f, null);
  // reader: W-6 FAIL carrying the root failure summary
  assert.deepEqual([reader.verdict, reader.label, reader.witness], ['FAIL', 'FAIL', 'W-6']);
  assert.deepEqual({ ...reader.detail.failedRun }, { source: 'page-phase-run', category: 'TypeError', phase: 'P1', failureSeq: pf.failureSeq, c1Stage: 'pre-c1' });
});

test('FAILED-RUN CLOSEOUT (1) non-vacuity: with the failed-run gate waiver REMOVED (mutated harness) the same failed run cannot be durably closed (R1 fails its own verify: no K, F written); with the row-3 phase-run-failed reason REMOVED it lands on row 4 by accident', async () => {
  const noWaiver = await mutatedHarness([["if (GATE_C1_REQUIRED && !failedRun) out.push('gates-missing');", "if (GATE_C1_REQUIRED) out.push('gates-missing');"]]);
  const w = makeWorld({ mod: noWaiver.mod, harnessText: noWaiver.text, handlers: { g2RunPhases: () => frTransfer() } });
  const r = await runMain(w);
  assert.equal(r.closeout.committed, false, JSON.stringify(r.closeout));
  assert.equal(r.finalOverall, 'FAIL');
  const d = durableOf(w);
  assert.equal(d.k, null, 'no K without the waiver');
  assert.ok(d.f, 'the closeout failure witness instead');
  assert.equal(readerVerdict(w).witness, 'W-1');
  const noRow3 = await mutatedHarness([["  if (phaseRunFailureOf(s) !== null) r3.push('phase-run-failed');\n", '']]);
  const w2 = makeWorld({ mod: noRow3.mod, harnessText: noRow3.text, handlers: { g2RunPhases: () => frTransfer() } });
  const r2 = await runMain(w2);
  assert.equal(r2.closeout.primaryRow, 4, 'pre-change: the incidental not-started-controls row');
});

test('FAILED-RUN CLOSEOUT (2): phase throws + cleanup succeeds => the original failure is retained VERBATIM in R1 (category / message / phase / operation / page-alloc failureSeq / cleanupEntry) and unchanged by closeout', async () => {
  const { w, r, reader } = await consumedRun({ handlers: { g2RunPhases: () => frTransfer() } });
  assert.deepEqual(r.state.errorLedger.entries.filter((e) => e.kind === 'harness-exception'), [], 'cleanup succeeded: no cleanup-evidence fatal');
  const d = durableOf(w);
  const cleanupSeq = d.r1.errorLedger.markers.find((m) => m.name === 'cleanup').seq;
  // ordinals 38 (phase-run-failure) .. 40 (marker:cleanup) are ingested in ONE fence batch => consecutive authoritative seqs
  const expected = frExpectedRecord(cleanupSeq - 2);
  assert.deepEqual(d.r1.phaseRunFailure, expected);
  assert.deepEqual(r.state.phaseRunFailure, expected, 'the post-closeout state holds the identical record (closeout never edits it)');
  assert.ok(!H.isPageLocalOrdinal(expected.failureSeq), 'Node-authoritative seq, not the page ordinal');
  for (const n of H.CHECK_NAMES) {
    assert.equal(vr(d.r1.checks[n]), 'BLOCKED(phase-run-threw)', n);
    assert.deepEqual([d.r1.checks[n].evidence.phaseRunFailure.name, d.r1.checks[n].evidence.phaseRunFailure.message], ['TypeError', PAGE_FAILURE.message], n);
  }
  assert.equal(reader.detail.failedRun.failureSeq, expected.failureSeq);
});

test('FAILED-RUN CLOSEOUT (3): phase throws + cleanup ALSO fails (omitted cleanup event / refused drain / duplicate merge) => BOTH causes durable: R1.phaseRunFailure identical to the clean-cleanup run AND exactly ONE cleanup-evidence fatal in R1.errorLedger.entries after failureSeq; primaryRow 1; reader FAIL; the root failure is never replaced', async () => {
  const clean = await consumedRun({ handlers: { g2RunPhases: () => frTransfer() } });
  const root = durableOf(clean.w).r1.phaseRunFailure;
  assert.equal(clean.r.closeout.primaryRow, 3);
  const cases = [
    ['omitted cleanup event', (w) => () => w.cleanupPage.drain({ mutate: (dl) => ({ ...dl, eventLog: [] }) }), /^cleanup-evidence:page-evidence-missing:event:\d+\(\+\d+\)$/],
    ['refused drain', () => () => ({ ok: false, delta: null, error: { name: 'Error', message: 'x' } }), /^cleanup-evidence:drain-refused:x$/],
    ['duplicate merge', (w) => () => w.cleanupPage.drain({ mutate: (dl) => ({ ...dl, eventLog: [...dl.eventLog, { ...LATE_EVENT, seq: pageSeqOf(LATE_EVENT.seq) }] }) }), /^cleanup-evidence:merge-duplicate:1$/],
  ];
  for (const [name, make, re] of cases) {
    const w = makeWorld({ handlers: { g2RunPhases: () => frTransfer() } });
    w.handlers.g2CleanupDrain = make(w);
    const r = await runMain(w);
    const d = durableOf(w);
    assert.ok(d.r1, `${name}: R1 committed`);
    assert.deepEqual(H.validateResultSchema(d.r1, 'payload').errors, [], name);
    assert.deepEqual(d.r1.phaseRunFailure, root, `${name}: the ROOT failure is retained, not replaced`);
    const fatals = d.r1.errorLedger.entries.filter(isCleanupEvidenceFatal);
    assert.equal(fatals.length, 1, `${name}: ${JSON.stringify(d.r1.errorLedger.entries)}`);
    assert.match(fatals[0].detail, re, name);
    assert.ok(fatals[0].seq > root.failureSeq, `${name}: the added cause is sequenced after the root failure`);
    assert.deepEqual([r.finalOverall, r.closeout.primaryRow, d.r1.overall.row, r.closeout.committed], ['FAIL', 1, 1, true], name);
    const v = readerVerdict(w);
    assert.deepEqual([v.verdict, v.witness], ['FAIL', 'W-6'], name);
    assert.deepEqual({ ...v.detail.failedRun }, { source: root.source, category: root.category, phase: root.phase, failureSeq: root.failureSeq, c1Stage: root.c1Stage }, name);
    assert.ok(Object.values(d.r1.checks).every((c) => vr(c) === 'BLOCKED(phase-run-threw)'), name);
  }
});

test('FAILED-RUN CLOSEOUT (4): markers survive into the durable R1 -- Node P0, EVERY earlier page marker (P1), the single cleanup marker and closeout, in strictly increasing authoritative seq; non-vacuity: a transfer carrying only the cleanup marker (pre-F1 page) loses P1', async () => {
  const { w } = await consumedRun({ handlers: { g2RunPhases: () => frTransfer() } });
  const r1 = durableOf(w).r1;
  assert.deepEqual(markerNamesOf(r1), ['P0', 'P1', 'cleanup', 'closeout']);
  assert.ok(strictlyIncreasing(r1.errorLedger.markers.map((m) => m.seq)), JSON.stringify(r1.errorLedger.markers));
  const seqOf = (n) => r1.errorLedger.markers.find((m) => m.name === n).seq;
  assert.ok(r1.phaseRunFailure.failureSeq > seqOf('P1') && r1.phaseRunFailure.failureSeq < seqOf('cleanup'), 'failure between the last phase marker and the cleanup marker');
  const pre = await consumedRun({ handlers: { g2RunPhases: () => frTransfer({ markers: [{ seq: 40, name: 'cleanup' }] }) } });
  assert.deepEqual(markerNamesOf(durableOf(pre.w).r1), ['P0', 'cleanup', 'closeout'], 'the assertion above discriminates a marker-dropping transfer');
});

/** Timers that remember the most recently armed long deadline (the g2RunPhases T9-remaining `attempt` deadline) to fire it on demand. */
function attemptDeadlineTimers() {
  let last = null;
  return {
    timers: { setTimeout: (fn, ms) => { const h = setTimeout(fn, ms); if (ms > H.TABLE_T.T8.cleanupStepDeadlineMs) last = { fn, ms }; return h; }, clearTimeout: (h) => clearTimeout(h) },
    fireLast: () => { const t = last; setTimeout(() => t.fn(), 0); return t.ms; },
  };
}
/** Before the RPC fails, the fake page ingests marker:P1 (P1), then marker:P2 + one unlabelled alloc through the real P2 attribution fence. */
async function ingestMarkersThen(w, fail) {
  const sync = w.bindings[H.G2_NODE_SYNC_BINDING];
  const P2 = { phase: 'P2', activeCheck: null, activeControl: null };
  const a = await sync('drain', { pending: [{ ord: PAGE_BASE + 1, kind: 'alloc', label: 'marker:P1', ...ACK_ATTR }], hw: PAGE_BASE + 1, pageFatalSent: 0 });
  assert.equal(a.ok, true, JSON.stringify(a));
  // (pre-C1 world: no gate was ever established, so only marker:P1 and one unlabelled alloc are ingested -- a P2 marker would contradict pre-c1)
  const b = await sync('drain', { pending: [{ ord: PAGE_BASE + 2, kind: 'alloc', label: null, ...ACK_ATTR }], hw: PAGE_BASE + 2, pageFatalSent: 0 });
  assert.equal(b.ok, true, JSON.stringify(b));
  return fail();
}

test('FAILED-RUN CLOSEOUT (4) transport branch: g2RunPhases rpc THREW / TIMED OUT after the page ingested marker:P1 / marker:P2 => a valid failed-run R1 committed through K: source node-phase-run-transport, seqSource node-observed, status = the RPC status, checks BLOCKED(phase-run-<status>), markers reconstructed from Node provenance (P0, P1, P2, closeout)', async () => {
  for (const status of ['threw', 'timed-out']) {
    const w = makeWorld();
    const t = attemptDeadlineTimers();
    w.deps.timers = t.timers;
    let firedMs = null;
    w.handlers.g2RunPhases = () => ingestMarkersThen(w, () => {
      if (status === 'threw') throw new RangeError('page crashed mid-run');
      firedMs = t.fireLast();
      return new Promise(() => {});
    });
    const r = await runMain(w);
    assert.equal(r.consumed, true);
    if (status === 'timed-out') assert.ok(firedMs > 0 && firedMs <= H.TABLE_T.T9.wholeAttemptCapMs, `fired the attempt deadline (${firedMs})`);
    assert.deepEqual([r.finalOverall, r.closeout.primaryRow, r.closeout.committed], ['FAIL', 3, true], `${status}: ${JSON.stringify(r.closeout.causes)}`);
    const d = durableOf(w);
    assert.deepEqual(H.validateResultSchema(d.r1, 'payload').errors, [], status);
    const pf = d.r1.phaseRunFailure;
    assert.deepEqual([pf.source, pf.realm, pf.seqSource, pf.status, pf.cleanupEntry], ['node-phase-run-transport', 'node', 'node-observed', status, 'not-entered'], status);
    assert.deepEqual([pf.category, pf.message], status === 'threw' ? ['RangeError', 'page crashed mid-run'] : ['Error', 'phase run timed-out'], status);
    assert.ok(Object.values(d.r1.checks).every((c) => vr(c) === `BLOCKED(phase-run-${status})`), status);
    assert.deepEqual(markerNamesOf(d.r1), ['P0', 'P1', 'closeout'], `${status}: only identity-bound marker:<phase> allocs are reconstructed`);
    assert.ok(strictlyIncreasing(d.r1.errorLedger.markers.map((m) => m.seq)), status);
    assert.ok(pf.failureSeq > d.r1.errorLedger.markers.find((m) => m.name === 'P1').seq, `${status}: Node observed the failure after the ingested markers`);
    assert.equal(d.r2.split('\n').filter((l) => l === `failedRun: node-phase-run-transport/${pf.category}/${pf.phase === null ? 'none' : pf.phase}/seq ${pf.failureSeq}/${pf.c1Stage}`).length, 1, status);
    const v = readerVerdict(w);
    assert.deepEqual([v.verdict, v.witness, v.detail.failedRun.source], ['FAIL', 'W-6', 'node-phase-run-transport'], status);
  }
});

test('FAILED-RUN CLOSEOUT (5): a forced closeout failure on a failed run (R1 write fault) => no K, F written, F.phaseRunFailure is the original root failure, validateFailureWitness(F) ok, reader FAIL (W-1); contrast: the same fault on a PASS run leaves F.phaseRunFailure null', async () => {
  const R1_FAULT = (rec) => (rec.op === 'open' && rec.flags === 'wx' && rec.path.startsWith(`${CHAIN.D1}/${H.R1_NAME}`) ? 'error' : null);
  const { w, r, reader } = await consumedRun({ fault: R1_FAULT, handlers: { g2RunPhases: () => frTransfer() } });
  assert.deepEqual([r.finalOverall, r.closeout.committed, r.exitCode], ['FAIL', false, 1]);
  assert.ok(r.closeout.causes.includes('r1-write'), JSON.stringify(r.closeout.causes));
  const d = durableOf(w);
  assert.equal(d.k, null);
  assert.ok(d.f, 'F written');
  assert.deepEqual(H.validateFailureWitness(d.f), { ok: true, errors: [] });
  const cleanupSeq = r.state.errorLedger.markers.find((m) => m.name === 'cleanup').seq;
  assert.deepEqual(d.f.phaseRunFailure, frExpectedRecord(cleanupSeq - 2), 'the root failure survives the closeout failure');
  assert.deepEqual(d.f.phaseRunFailure, r.state.phaseRunFailure);
  assert.deepEqual([d.f.primaryOverall, d.f.primaryRow], ['FAIL', 3]);
  assert.ok(d.f.causes.includes('r1-write'));
  assert.equal(w.durableJournalStates().at(-1), 'FAILED');
  assert.deepEqual([reader.verdict, reader.witness], ['FAIL', 'W-1']);
  const pass = await consumedRun({ fault: R1_FAULT });
  const pf = durableOf(pass.w).f;
  assert.equal(pf.phaseRunFailure, null, 'a non-failed run carries no root failure in F');
  assert.deepEqual(H.validateFailureWitness(pf), { ok: true, errors: [] });
  assert.equal(H.validateFailureWitness({ ...d.f, phaseRunFailure: { ...d.f.phaseRunFailure, realm: 'node' } }).ok, false, 'F re-validates the carried record');
});

test('FAILED-RUN CLOSEOUT (7): the valid PASS path is unchanged -- R1.phaseRunFailure === null, schema valid, R2 "failedRun: none", reader PASS (W-6, detail.failedRun null); a failed run never yields a PASS K', async () => {
  const { w, r, reader } = await consumedRun({});
  assert.deepEqual([r.finalOverall, r.closeout.primaryRow, r.closeout.committed], ['PASS', 8, true]);
  const d = durableOf(w);
  assert.equal(Object.hasOwn(d.r1, 'phaseRunFailure'), true, 'always-present key');
  assert.equal(d.r1.phaseRunFailure, null);
  assert.equal(r.state.phaseRunFailure, null);
  assert.deepEqual(H.validateResultSchema(d.r1, 'payload').errors, []);
  assert.equal(d.r2.split('\n').filter((l) => l === 'failedRun: none').length, 1);
  assert.deepEqual([reader.verdict, reader.witness, reader.detail.failedRun], ['PASS', 'W-6', null]);
  assert.deepEqual([d.k.finalOverall, d.k.primaryOverall], ['PASS', 'PASS']);
  // every failed-run flavour commits a FAIL K, never PASS
  for (const g2RunPhases of [() => frTransfer(), () => frTransfer({ markers: [{ seq: 40, name: 'cleanup' }] }), () => { throw new Error('page crashed'); }]) {
    const x = await consumedRun({ handlers: { g2RunPhases } });
    const k = durableOf(x.w).k;
    assert.deepEqual([k.finalOverall, k.primaryOverall, x.reader.verdict], ['FAIL', 'FAIL', 'FAIL']);
    assert.notEqual(durableOf(x.w).r1.phaseRunFailure, null);
  }
});

test('FAILED-RUN CLOSEOUT (5b): an UNEXPECTED closeout abort (outer catch, before K) still writes F carrying the original phaseRunFailure; no K; reader FAIL; the failure is not erased', async () => {
  const w = makeWorld({ handlers: { g2RunPhases: () => failedRunTransfer() } });
  w.deps.scheduler = { setImmediate: () => { throw new Error('scheduler exploded'); } };
  const r = await runMain(w);
  assert.equal(r.finalOverall, 'FAIL');
  assert.equal(r.closeoutAbort.name, 'Error');
  const view = w.fs.processCrashView();
  const fName = view.readdir(CHAIN.D2).find((n) => n.endsWith('.closeout-failure.json'));
  assert.ok(fName, 'F written by the abort path');
  const f = JSON.parse(view.readFile(path.join(CHAIN.D2, fName)).toString('utf8'));
  assert.deepEqual(H.validateFailureWitness(f).errors, []);
  assert.equal(f.phaseRunFailure.message, PAGE_FAILURE.message);
  assert.equal(f.phaseRunFailure.failureSeq, r.state ? r.state.phaseRunFailure.failureSeq : f.phaseRunFailure.failureSeq);
  assert.ok(f.causes[0].startsWith('harness-abort:closeout-threw:'));
  assert.equal(readerVerdict(w).verdict, 'FAIL');
});

test('FAILED-RUN v2 L1: g2RunPhases rpc COMPLETED without a result (handler returns null / undefined) => status invalid-result (never "completed"): R1.phaseRunFailure {source node-phase-run-transport, status invalid-result, message "phase run completed without a result"}, checks BLOCKED(phase-run-invalid-result), committed FAIL row 3, reader FAIL', async () => {
  for (const [label, value] of [['null', null], ['undefined', undefined]]) {
    const { w, r, reader } = await consumedRun({ handlers: { g2RunPhases: () => value } });
    const rpc = w.log.filter((e) => e.kind === 'rpc' && e.key === 'g2RunPhases');
    assert.equal(rpc.length, 1, `${label}: the RPC was made and returned (completed)`);
    assert.deepEqual([r.finalOverall, r.closeout.primaryRow, r.closeout.committed], ['FAIL', 3, true], `${label}: ${JSON.stringify(r.closeout.causes)}`);
    const d = durableOf(w);
    assert.deepEqual(H.validateResultSchema(d.r1, 'payload').errors, [], label);
    const pf = d.r1.phaseRunFailure;
    assert.deepEqual([pf.source, pf.realm, pf.status, pf.seqSource, pf.cleanupEntry, pf.category, pf.message, pf.c1Stage], ['node-phase-run-transport', 'node', 'invalid-result', 'node-observed', 'not-entered', 'Error', 'phase run completed without a result', 'pre-c1'], label);
    assert.ok(Object.values(d.r1.checks).every((c) => vr(c) === 'BLOCKED(phase-run-invalid-result)'), label);
    assert.ok(Object.values(d.r1.controls).every((c) => c.executionRecord.started === false && c.fields.reason === 'phase-run-invalid-result'), label);
    assert.equal(Object.values(d.r1.checks).some((c) => c.reason === 'phase-run-completed'), false, `${label}: the misleading pre-L1 label is gone`);
    assert.equal(d.r2.split('\n').filter((l) => l === `failedRun: node-phase-run-transport/Error/${pf.phase === null ? 'none' : pf.phase}/seq ${pf.failureSeq}/pre-c1`).length, 1, label);
    assert.deepEqual([reader.verdict, reader.witness, reader.detail.failedRun.source], ['FAIL', 'W-6', 'node-phase-run-transport'], label);
  }
  // contrast: a completed RPC WITH a result is not a transport failure
  const ok = await consumedRun({});
  assert.equal(ok.r.state.phaseRunFailure, null);
});
