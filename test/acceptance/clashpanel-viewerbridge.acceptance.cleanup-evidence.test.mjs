// test/acceptance/clashpanel-viewerbridge.acceptance.cleanup-evidence.test.mjs
//
// H1 cleanup completeness (2026-10-02 addendum), unit level, against the REAL harness exports:
// the page-ordinal source + a real call recorder / recording wrapper produce cleanup-phase evidence
// (cleanup spy records, `wrapper-restore` events, a cleanup snapshot); Node ingests it through the
// authority's fence (single allocator), rewrites the cleanup delta (`rewritePageRun`), merges it exactly
// once (`mergeCleanupDelta`) and proves completeness (`pageEvidenceProblems`). The closePage step runs the
// drain (`beforeClose`) before its teardown op and the close. Guards are shown non-vacuous on mutated
// copies of the harness TEXT. The end-to-end main-flow wiring is covered in
// clashpanel-viewerbridge.acceptance.mainflow.test.mjs. Offline only: no browser, no network.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as H from './clashpanel-viewerbridge.acceptance.mjs';

const SOURCE = readFileSync(fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url)), 'utf8');
const SANDBOX = mkdtempSync(path.join(os.tmpdir(), 'g2-cleanup-evidence-'));
after(() => { rmSync(SANDBOX, { recursive: true, force: true }); });

let mutations = 0;
/** Imports a copy of the harness with each `[from, to]` needle replaced exactly once. */
async function mutated(pairs) {
  let s = SOURCE;
  for (const [from, to] of pairs) {
    assert.equal(s.split(from).length - 1, 1, `mutation anchor must occur exactly once: ${from}`);
    s = s.replace(from, () => to);
  }
  mutations += 1;
  const file = path.join(SANDBOX, String(mutations), 'clashpanel-viewerbridge.acceptance.mjs');
  mkdirSync(path.dirname(file));
  writeFileSync(file, s);
  return import(pathToFileURL(file).href);
}

const BASE = H.PAGE_LOCAL_BASE;
const CLEANUP = Object.freeze({ phase: 'cleanup', activeCheck: null, activeControl: null });

/**
 * A page realm + Node authority pair built from the real primitives. The page: a page-ordinal source, a
 * real recorder on it, a real recording wrapper on a fake viewer (installed during the run). The run ends
 * with an awaited drain fence (as g2RunPhases does) and records `runHw` (g.runResultHw). Node: the single
 * allocator + a run authority whose acknowledged attribution follows the page (the fake sync).
 */
function world(M = H, {
  runStage = 'run', cleanupAttr = CLEANUP, cleanupEventInRun = false,
  // (ADDENDUM 4) the run crosses g2RunPhases' mark('cleanup') before its result: the marker's alloc ordinal (seqOf =
  // rec.nextSeq) is allocated under the cleanup attribution and acknowledged by the sync fence, and is persisted as the
  // authoritative 'cleanup' marker (state.errorLedger.markers, as applyPhaseRunToState appends it).
  cleanupMarker = cleanupEventInRun,
  markerAttr = CLEANUP, // the attribution the marker ordinal is allocated under (P1 => a marker that is not phase cleanup)
  eventBeforeMarker = false, // a phase-'cleanup' event recorded BEFORE the marker ordinal (same run-stage transfer)
  p5Event = false, // a NON-cleanup run-phase (P5a) event recorded during the run, before the marker
  // (ADDENDUM 5) the runner's mark(name) allocates the marker ordinal as rec.nextSeq('alloc', `marker:${name}`): the
  // simulated mark('cleanup') registers label 'marker:cleanup' (override only to forge a wrong marker identity).
  markerLabel = 'marker:cleanup',
  // (ADDENDUM 5) a cleanup-attributed `alloc` ordinal with this label allocated just BEFORE the marker (an execution /
  // another allocation that a forged state could substitute as the 'cleanup' marker seq). null => none.
  preMarkerAllocLabel = null,
  // (ADDENDUM 5) a page that registers the `event` ordinal of this kind UNLABELED (null). If the run fence refuses it the
  // world stops right there and returns { refused, ... } (nothing after the refused fence is built).
  unlabeledKind = null,
} = {}) {
  const violations = [];
  const allocator = M.createRunSeqAllocator();
  const attribution = { phase: 'P1', activeCheck: null, activeControl: null };
  const authority = M.createRunAuthority({ allocator, attribution, onViolation: (r) => violations.push(r) });
  const src = M.createPageOrdinalSource();
  // (ADDENDUM 5) the recorder labels every `event` ordinal with the event's own kind (ingestion now REFUSES an unlabeled
  // event ordinal, so the former `labels: false` fixture option is gone; see the ADDENDUM 5 ingestion tests)
  // `unlabeledKind` (a test-only page defect): the event of that kind is allocated WITHOUT its label (label null)
  const rec = M.createCallRecorder({ nextSeq: unlabeledKind === null ? src.next : (attr, kind, label) => src.next(attr, kind, label === unlabeledKind ? null : label) });
  const registry = M.createWrapperRegistry();
  const viewer = { isolate: () => 'iso', overlays: { removeScene: () => true } };
  const snapshots = [];
  const fence = (fn) => { const rep = { pending: src.pending(), hw: src.highWater() }; const r = fn(rep); if (r.ok) src.ack(rep.hw); return r; };
  // ---- the run (P1): wrappers installed and a call recorded, then the run's drain fence
  rec.setAttribution({ phase: 'P1', activeCheck: null, activeControl: null });
  M.recordingWrap(viewer, 'isolate', { recorder: rec, registry, label: 'viewer.isolate' });
  M.recordingWrap(viewer.overlays, 'removeScene', { recorder: rec, registry, label: 'overlays.removeScene' });
  viewer.isolate([1]);
  if (p5Event) {
    const P5 = { phase: 'P5a', activeCheck: null, activeControl: null };
    rec.setAttribution(P5);
    assert.equal(fence((rep) => authority.syncPage({ ...P5, ...rep })).ok, true);
    rec.logEvent('p5-event', { note: 'an ordinary run-phase event' });
  }
  let markerOrd = null;
  let preMarkerOrd = null;
  if (cleanupMarker || cleanupEventInRun || eventBeforeMarker || preMarkerAllocLabel !== null) {
    // g2RunPhases' mark('cleanup'): the attribution switches, the marker's alloc ordinal is allocated, the sync fence
    // acknowledges it; an event recorded during the await after it -- BEFORE g.runResultHw / the run result -- is a
    // phase-'cleanup' event that travels in the RUN result.
    rec.setAttribution(eventBeforeMarker ? CLEANUP : markerAttr);
    if (eventBeforeMarker) rec.logEvent('early-callback', { note: 'phase cleanup, recorded BEFORE the cleanup marker ordinal' });
    if (preMarkerAllocLabel !== null) preMarkerOrd = rec.nextSeq('alloc', preMarkerAllocLabel);
    if (cleanupMarker) markerOrd = rec.nextSeq('alloc', markerLabel);
    rec.setAttribution(CLEANUP);
    assert.equal(fence((rep) => authority.syncPage({ ...CLEANUP, ...rep })).ok, true);
    if (cleanupEventInRun) rec.logEvent('late-callback', { note: 'recorded after mark(cleanup), before the run result' });
  }
  const runFence = fence((rep) => authority.ingestFence(rep));
  if (unlabeledKind !== null && runFence.ok !== true) return { M, violations, allocator, authority, src, rec, refused: runFence };
  assert.equal(runFence.ok, true);
  const runHw = src.highWater();
  const run = { spyLedger: rec.records.map((r) => ({ ...r })), eventLog: rec.events.map((e) => ({ ...e })), stateSnapshots: [], markers: markerOrd === null ? [] : [{ seq: markerOrd, name: 'cleanup' }], pageHighWater: runHw, pageFatalSent: 0 };
  const state = {};
  const out = authority.rewritePageRun(run, runStage === null ? {} : { stage: runStage });
  state.spyLedger = out.spyLedger; state.eventLog = out.eventLog; state.stateSnapshots = out.stateSnapshots;
  state.errorLedger = { markers: out.markers };
  const markerSeq = markerOrd === null ? null : authority.seqOfOrdinal(markerOrd);
  const preMarkerSeq = preMarkerOrd === null ? null : authority.seqOfOrdinal(preMarkerOrd);
  // ---- Node allocates between the run and the cleanup (a network event, the cleanup boundary)
  const nodeSeqs = [allocator.next(), allocator.next()];
  // ---- cleanup (page): attribution cleanup (acknowledged on both sides), a still-wrapped call, restore, baseline
  rec.setAttribution(cleanupAttr);
  assert.equal(fence((rep) => authority.syncPage({ ...cleanupAttr, ...rep })).ok, true);
  rec.withOrigin('harness', () => viewer.overlays.removeScene('clash-panel-markers:g2a'));
  const restored = registry.restoreAll();
  assert.equal(restored.ok, true);
  snapshots.push({ ...rec.stamp('snapshot'), baselinePhase: 'cleanup', loadedModels: ['A', 'B'], isolationEmpty: true, hiddenEmpty: true });
  /** The in-page g2CleanupDrain: delta (seq > runHw) + hw snapshotted with the fence report; Node ingests; ack. */
  const drain = () => {
    const delta = JSON.parse(JSON.stringify({
      spyLedger: rec.records.filter((r) => r.seq > runHw), eventLog: rec.events.filter((e) => e.seq > runHw),
      stateSnapshots: snapshots.filter((e) => e.seq > runHw), pageHighWater: src.highWater(), pageFatalSent: 0,
    }));
    const r = fence((rep) => authority.ingestFence(rep));
    return { r, delta };
  };
  return { M, violations, allocator, attribution, authority, src, rec, registry, viewer, state, runHw, run, nodeSeqs, drain, fence, markerOrd, markerSeq, preMarkerOrd, preMarkerSeq, snapshots };
}

// ---------------------------------------------------------------------------------------------
// transfer + single allocator
// ---------------------------------------------------------------------------------------------

test('cleanup drain: wrapper-restore events and cleanup spy records are transferred, Node-sequenced by the one allocator (unique, contiguous, < PAGE_LOCAL_BASE) and merged with phase cleanup; pageEvidenceProblems is []', () => {
  const w = world();
  const { r, delta } = w.drain();
  assert.equal(r.ok, true);
  // the delta holds page-local ordinals only (non-authoritative) ...
  for (const k of ['spyLedger', 'eventLog', 'stateSnapshots']) for (const e of delta[k]) assert.ok(H.isPageLocalOrdinal(e.seq));
  const rewritten = w.authority.rewritePageRun(delta, { stage: 'cleanup' });
  H.mergeCleanupDelta(w.state, rewritten);
  assert.deepEqual(w.violations, []);
  const cs = w.state.spyLedger.filter((x) => x.phase === 'cleanup');
  const ce = w.state.eventLog.filter((x) => x.phase === 'cleanup');
  const cn = w.state.stateSnapshots.filter((x) => x.phase === 'cleanup');
  assert.deepEqual(cs.map((x) => [x.method, x.origin]), [['overlays.removeScene', 'harness']]);
  // restoreAll restores in reverse install order: removeScene, then isolate
  assert.deepEqual(ce.map((x) => [x.kind, x.label, x.layer, x.ok]), [['wrapper-restore', 'overlays.removeScene', 'recording', true], ['wrapper-restore', 'viewer.isolate', 'recording', true]]);
  assert.equal(cn.length, 1);
  // ... and the authoritative state none: every seq came from the single allocator, after the Node allocations
  const seqs = [...cs, ...ce, ...cn].map((x) => x.seq).sort((a, b) => a - b);
  const last = w.nodeSeqs[1];
  assert.deepEqual(seqs, [last + 1, last + 2, last + 3, last + 4], 'contiguous with the allocator right after the Node allocations');
  assert.equal(w.allocator.peek(), last + 4);
  for (const s of seqs) assert.ok(s < BASE && !H.isPageLocalOrdinal(s));
  assert.deepEqual(w.authority.assertAllocated(H.maxRecordedSeq(w.state)), { ok: true });
  assert.deepEqual(H.primarySeqAllocations(w.state).problems, []);
  assert.deepEqual(w.authority.ingested().filter((e) => e.phase === 'cleanup').map((e) => [e.seq, e.kind]), seqs.map((s, i) => [s, ['spy', 'event', 'event', 'snapshot'][i]]));
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), []);
  assert.deepEqual(w.violations, []);
});

test('cleanup drain: an idempotent re-send of the same pending entries allocates nothing new; a conflicting re-send is ONE ingest-conflict violation and ingests nothing', () => {
  const w = world();
  const pending = w.src.pending();
  const hw = w.src.highWater();
  assert.deepEqual(w.authority.ingestFence({ pending, hw }), { ok: true, count: 4 });
  const peek = w.allocator.peek();
  assert.deepEqual(w.authority.ingestFence({ pending, hw }), { ok: true, count: 0 });
  assert.equal(w.allocator.peek(), peek);
  // (ADDENDUM 5) a well-formed (labelled) event entry, so the refusal is the conflict, not an unlabeled-event refusal
  const bad = pending.map((e, i) => (i === 0 ? { ...e, kind: 'event', label: 'wrapper-restore' } : e));
  assert.deepEqual(w.authority.ingestFence({ pending: bad, hw }), { ok: false, reason: 'ingest-conflict' });
  assert.deepEqual(w.violations, ['ingest-conflict']);
  assert.equal(w.allocator.peek(), peek);
});

test('mergeCleanupDelta is exactly-once per seq (calling it twice adds nothing), appends spy/snapshots, merges eventLog seq-ordered (stable) and never mutates the delta', () => {
  const state = {
    spyLedger: [{ seq: 3, phase: 'P2', method: 'a' }],
    stateSnapshots: [{ seq: 4, phase: 'P2' }],
    eventLog: [{ seq: 1, kind: 'x' }, { seq: 5, kind: 'y' }, { seq: 9, kind: 'z' }],
  };
  const delta = {
    spyLedger: [{ seq: 6, phase: 'cleanup', method: 'b' }, { seq: 3, phase: 'P2', method: 'a' }, null],
    stateSnapshots: [{ seq: 8, phase: 'cleanup' }],
    eventLog: [{ seq: 7, kind: 'wrapper-restore' }, { seq: 2, kind: 'wrapper-restore' }, { seq: 5, kind: 'y' }],
  };
  const frozen = JSON.stringify(delta);
  H.mergeCleanupDelta(state, delta);
  const once = JSON.stringify(state);
  H.mergeCleanupDelta(state, delta);
  assert.equal(JSON.stringify(state), once, 'a second merge of the same delta changes nothing');
  assert.equal(JSON.stringify(delta), frozen);
  assert.deepEqual(state.spyLedger.map((e) => e.seq), [3, 6]);
  assert.deepEqual(state.stateSnapshots.map((e) => e.seq), [4, 8]);
  assert.deepEqual(state.eventLog.map((e) => e.seq), [1, 2, 5, 7, 9]);
  // missing collections / a non-object delta are tolerated
  const empty = {};
  H.mergeCleanupDelta(empty, null);
  assert.deepEqual(empty, { spyLedger: [], stateSnapshots: [], eventLog: [] });
});

// ---------------------------------------------------------------------------------------------
// pageEvidenceProblems: missing / duplicate / unsourced (both directions)
// ---------------------------------------------------------------------------------------------

/** A merged world (complete) to corrupt. */
function merged() {
  const w = world();
  const { delta } = w.drain();
  H.mergeCleanupDelta(w.state, w.authority.rewritePageRun(delta, { stage: 'cleanup' }));
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), []);
  const seqOf = (kind) => w.authority.ingested().filter((e) => e.phase === 'cleanup' && e.kind === kind).map((e) => e.seq);
  return { ...w, seqOf };
}

test('pageEvidenceProblems: a missing cleanup spy record / wrapper-restore event / snapshot is page-evidence-missing:<kind>:<seq> (a cleanup-drain event also cleanup-event-missing:<seq>)', () => {
  for (const [coll, kind] of [['spyLedger', 'spy'], ['eventLog', 'event'], ['stateSnapshots', 'snapshot']]) {
    const w = merged();
    const victim = w.seqOf(kind)[0];
    w.state[coll] = w.state[coll].filter((e) => e.seq !== victim);
    const extra = kind === 'event' ? [`cleanup-event-missing:${victim}`] : [];
    assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`page-evidence-missing:${kind}:${victim}`, ...extra], coll);
  }
  // run-phase evidence is mandatory too (a dropped wrapper-install event of the run)
  const w = merged();
  const install = w.state.eventLog.find((e) => e.kind === 'wrapper-install');
  w.state.eventLog = w.state.eventLog.filter((e) => e !== install);
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`page-evidence-missing:event:${install.seq}`]);
});

test('pageEvidenceProblems: a duplicated record is page-evidence-duplicate:<kind>:<seq> (a cleanup-drain event also cleanup-event-duplicate:<seq>, reported once)', () => {
  for (const [coll, kind] of [['spyLedger', 'spy'], ['eventLog', 'event'], ['stateSnapshots', 'snapshot']]) {
    const w = merged();
    const s = w.seqOf(kind)[0];
    w.state[coll] = [...w.state[coll], { ...w.state[coll].find((e) => e.seq === s) }];
    const extra = kind === 'event' ? [`cleanup-event-duplicate:${s}`] : [];
    assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`page-evidence-duplicate:${kind}:${s}`, ...extra], coll);
  }
});

test('pageEvidenceProblems: a spy record / snapshot whose seq is not an ingested page ordinal of that kind is page-evidence-unsourced (incl. a leaked page-local ordinal); a NON-cleanup Node-style eventLog entry is not flagged, a phase-cleanup one is cleanup-event-unsourced', () => {
  let w = merged();
  w.state.spyLedger.push({ ...w.state.spyLedger[0], seq: w.allocator.next() }); // Node-allocated, never a page spy ordinal
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`page-evidence-unsourced:spy:${w.allocator.peek()}`]);
  w = merged();
  const ev = w.seqOf('event')[0];
  w.state.stateSnapshots.push({ seq: ev, phase: 'cleanup', activeCheck: null, activeControl: null }); // ingested, but as an event
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`page-evidence-unsourced:snapshot:${ev}`]);
  w = merged();
  w.state.spyLedger.push({ ...w.state.spyLedger[0], seq: BASE + 999 });
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`page-evidence-unsourced:spy:${BASE + 999}`]);
  w = merged();
  // (ADDENDUM 2) Node never pushes into state.eventLog: a phase-'cleanup' entry without an ingested page ordinal is unsourced
  w.state.eventLog.push({ seq: w.allocator.next(), phase: 'cleanup', activeCheck: null, activeControl: null, kind: 'pageerror' });
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`cleanup-event-unsourced:${w.allocator.peek()}`]);
  // ... while a non-cleanup-phase Node-style entry with no source is still not flagged (unchanged)
  w = merged();
  w.state.eventLog.push({ seq: w.allocator.next(), phase: 'P11', activeCheck: null, activeControl: null, kind: 'pageerror' });
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), []);
  // alloc-kind ordinals (markers, executions, C1 event) are not independently mandatory
  w = world();
  const a = w.src.next(CLEANUP, 'alloc');
  void a;
  const { delta } = w.drain();
  H.mergeCleanupDelta(w.state, w.authority.rewritePageRun(delta, { stage: 'cleanup' }));
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), []);
});

// ---------------------------------------------------------------------------------------------
// page-local ordinals cannot leak through the delta
// ---------------------------------------------------------------------------------------------

test('rewritePageRun(delta): an un-ingested ordinal in the delta => page-ordinal-unmapped (the ordinal stays => page-ordinal-leaked + unsourced); a stale high-water => final-ingest-mismatch', () => {
  let w = world();
  let { delta } = w.drain();
  const ghost = w.src.next(CLEANUP, 'spy'); // allocated AFTER the fence: never ingested
  delta.spyLedger.push({ ...delta.spyLedger[0], seq: ghost });
  let out = w.authority.rewritePageRun(delta, { stage: 'cleanup' });
  assert.deepEqual(w.violations, ['page-ordinal-unmapped']);
  H.mergeCleanupDelta(w.state, out);
  assert.ok(H.primarySeqAllocations(w.state).problems.some((p) => p === `page-ordinal-leaked:${ghost}:spyLedger[${w.state.spyLedger.length - 1}]`));
  assert.ok(w.authority.pageEvidenceProblems(w.state).includes(`page-evidence-unsourced:spy:${ghost}`));
  // the page never fenced: its high-water is not what Node ingested
  w = world();
  ({ delta } = { delta: { spyLedger: w.rec.records.filter((r) => r.seq > w.runHw), eventLog: [], stateSnapshots: [], pageHighWater: w.src.highWater(), pageFatalSent: 0 } });
  out = w.authority.rewritePageRun(delta, { stage: 'cleanup' });
  assert.deepEqual(w.violations, ['final-ingest-mismatch', 'page-ordinal-unmapped']);
  assert.ok(H.isPageLocalOrdinal(out.spyLedger[0].seq));
});

// ---------------------------------------------------------------------------------------------
// ordering: the drain runs inside closePage BEFORE the teardown op and the close (page still open)
// ---------------------------------------------------------------------------------------------

test('buildCleanupSteps: closePage awaits beforeClose (the cleanup drain) BEFORE the teardown op begins and BEFORE page.close; the page is open during the drain', async () => {
  const order = [];
  const page = { closed: false, isClosed() { return this.closed; }, async close() { order.push('page.close'); this.closed = true; } };
  const live = { page, context: null, browser: null };
  const ops = {
    beginMutation: (d) => { order.push(`begin:${d.teardownTarget}`); return { operationId: 'op1' }; },
    endMutation: (id, outcome) => { order.push(`end:${outcome}`); },
  };
  const beforeClose = async () => { order.push(`drain(open=${!page.isClosed()})`); await new Promise((r) => { setTimeout(r, 5); }); order.push('drain-done'); };
  const steps = H.buildCleanupSteps({ live, rpcCall: async () => ({ ok: true }), timers: { setTimeout, clearTimeout }, ops, beforeClose });
  await steps.closePage.run();
  assert.deepEqual(order, ['drain(open=true)', 'drain-done', 'begin:closePage', 'page.close', 'end:settled']);
  // no beforeClose => unchanged teardown (offline callers)
  const order2 = [];
  const page2 = { closed: false, isClosed() { return this.closed; }, async close() { order2.push('page.close'); this.closed = true; } };
  await H.buildCleanupSteps({ live: { page: page2 }, rpcCall: async () => ({}), timers: { setTimeout, clearTimeout }, ops: null }).closePage.run();
  assert.deepEqual(order2, ['page.close']);
});

test('static wiring: g2CleanupDrain is a registered page function that snapshots the delta before awaiting the drain fence; runPostReservation rewrites before merging and checks completeness before the closeout marker', () => {
  assert.ok(H.G2_IN_PAGE_FUNCTION_NAMES.includes('g2CleanupDrain'));
  const fnText = (name) => { const i = SOURCE.indexOf(`function ${name}(`); assert.ok(i >= 0, name); return SOURCE.slice(i, SOURCE.indexOf('\n}\n', i)); };
  const drain = fnText('g2CleanupDrain');
  assert.ok(drain.indexOf('pageHighWater: g2FenceReport().hw') < drain.indexOf('await sync.drain()'), 'delta + high-water snapshotted before the awaited fence (same tick)');
  const rpr = fnText('runPostReservation');
  const at = (tok) => { const i = rpr.indexOf(tok); assert.ok(i >= 0, tok); return i; };
  assert.ok(at("rpcCall('g2CleanupDrain'") < at("mergeCleanupDelta(state, authority.rewritePageRun(out.value.delta, { stage: 'cleanup' }))"));
  // drain provenance: the phase result is rewritten as stage 'run' (fixes the boundary) before the cleanup delta (stage 'cleanup')
  assert.ok(at("authority.rewritePageRun(runOut.value, { stage: 'run' })") < at("authority.rewritePageRun(out.value.delta, { stage: 'cleanup' })"));
  assert.ok(at('beforeClose: drainCleanup') < at("sink.recordFatal('harness-exception', `cleanup-evidence:${cleanupEvidence.failure || 'drain-not-run'}`)"));
  assert.ok(at('authority.pageEvidenceProblems(state)') < at("state.errorLedger.markers.push({ seq: runSeq.next(), name: 'closeout' })"));
});

// ---------------------------------------------------------------------------------------------
// non-vacuity on mutated harness text
// ---------------------------------------------------------------------------------------------

test('non-vacuity: removing the duplicate / unsourced checks of pageEvidenceProblems or the exactly-once filter of mergeCleanupDelta (mutated copies) lets the defect through', async () => {
  const noDup = await mutated([["if (n !== 1) out.push(`page-evidence-${n === 0 ? 'missing' : 'duplicate'}:${e.kind}:${e.seq}`);", "if (n === 0) out.push(`page-evidence-missing:${e.kind}:${e.seq}`);"]]);
  let w = world(noDup);
  let { delta } = w.drain();
  noDup.mergeCleanupDelta(w.state, w.authority.rewritePageRun(delta, { stage: 'cleanup' }));
  w.state.spyLedger.push({ ...w.state.spyLedger[w.state.spyLedger.length - 1] });
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [], 'duplicate undetected without the guard');
  const noUnsourced = await mutated([["for (const kind of ['spy', 'snapshot']) for (const seq of coll[kind].keys()) if (kindBySeq.get(seq) !== kind) out.push(`page-evidence-unsourced:${kind}:${seq}`);", '']]);
  w = world(noUnsourced);
  ({ delta } = w.drain());
  noUnsourced.mergeCleanupDelta(w.state, w.authority.rewritePageRun(delta, { stage: 'cleanup' }));
  w.state.spyLedger.push({ ...w.state.spyLedger[0], seq: BASE + 7 });
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [], 'a leaked/unsourced spy record undetected without the guard');
  // (ADDENDUM 3) mergeCleanupDelta counts what its exactly-once filter skips: retargeted to the `dup` predicate.
  const d = { spyLedger: [{ seq: 1 }], stateSnapshots: [{ seq: 2 }], eventLog: [{ seq: 3 }] };
  const lengths = (st) => [st.spyLedger.length, st.stateSnapshots.length, st.eventLog.length];
  const noOnce = await mutated([['const dup = !isPlainObject(e) || have.has(e.seq);', 'const dup = !isPlainObject(e);']]);
  const state = { spyLedger: [], stateSnapshots: [], eventLog: [] };
  assert.deepEqual(noOnce.mergeCleanupDelta(state, d), { duplicates: 0 });
  assert.deepEqual(noOnce.mergeCleanupDelta(state, d), { duplicates: 0 }, 'nothing is reported ...');
  assert.deepEqual(lengths(state), [2, 2, 2], '... and the state holds duplicates without the exactly-once filter');
  // removing only the counter: the state stays exactly-once but the repeat is SILENTLY deduplicated (the pre-ADDENDUM-3 behaviour)
  const noCount = await mutated([['if (dup) duplicates += 1;', '']]);
  const state2 = { spyLedger: [], stateSnapshots: [], eventLog: [] };
  noCount.mergeCleanupDelta(state2, d);
  assert.deepEqual(noCount.mergeCleanupDelta(state2, d), { duplicates: 0 }, 'a repeated merge is invisible without the counter');
  assert.deepEqual(lengths(state2), [1, 1, 1]);
  // the real harness: exactly-once AND reported
  const state3 = { spyLedger: [], stateSnapshots: [], eventLog: [] };
  assert.deepEqual(H.mergeCleanupDelta(state3, d), { duplicates: 0 });
  assert.deepEqual(H.mergeCleanupDelta(state3, d), { duplicates: 3 });
  assert.deepEqual(lengths(state3), [1, 1, 1]);
});

// ---------------------------------------------------------------------------------------------
// ADDENDUM 2 (2026-10-02): cleanup eventLog provenance, one-to-one in BOTH directions
//   page source -> authoritative event: every ingested cleanup-drain `event` ordinal has exactly one eventLog entry
//   authoritative event -> page source: every phase-'cleanup' (or cleanup-drain-sourced) eventLog entry is sourced by
//   exactly one ingested `event` ordinal of the cleanup drain range (run boundary, drain hw], with phase 'cleanup'.
// Labels: cleanup-event-missing|duplicate|unsourced|outside-drain|phase-mismatch|leaked-ordinal:<seq>.
// ---------------------------------------------------------------------------------------------

/** The harness text of the cleanup-eventLog provenance block of pageEvidenceProblems (removed => the pre-fix check). */
const PROVENANCE_BLOCK = (() => {
  const a = SOURCE.indexOf('      // Cleanup eventLog provenance, BOTH directions');
  const b = SOURCE.indexOf('      return [...new Set(out)];', a);
  assert.ok(a > 0 && b > a, 'provenance block anchors');
  return SOURCE.slice(a, b);
})();

/** A merged world plus the rows the cleanup provenance is checked against. */
function provenanceWorld(opts) {
  const w = world(H, opts);
  const { r, delta } = w.drain();
  assert.equal(r.ok, true);
  const rewritten = w.authority.rewritePageRun(delta, { stage: 'cleanup' });
  H.mergeCleanupDelta(w.state, rewritten);
  const rows = w.authority.provenance();
  const cleanupEvents = () => w.state.eventLog.filter((e) => e.phase === 'cleanup');
  return { ...w, delta, rewritten, rows, cleanupEvents };
}

test('provenance: stageOfOrdinal is null before the run stage, run (<= the phase-result high-water), null for post-run ordinals until the cleanup stage, then cleanup inside (run boundary, drain hw] and null beyond', () => {
  const w = world(H, { runStage: null });
  assert.equal(w.authority.stageOfOrdinal(BASE + 1), null, 'no run stage yet => no provenance stage at all');
  const w2 = world();
  assert.equal(w2.authority.stageOfOrdinal(BASE + 1), 'run');
  assert.equal(w2.authority.stageOfOrdinal(w2.runHw), 'run');
  const { delta } = w2.drain();
  assert.equal(w2.authority.stageOfOrdinal(w2.runHw + 1), null, 'ingested by the drain fence but the cleanup stage has not been rewritten yet');
  w2.authority.rewritePageRun(delta, { stage: 'cleanup' });
  assert.equal(w2.authority.stageOfOrdinal(w2.runHw + 1), 'cleanup');
  assert.equal(w2.authority.stageOfOrdinal(delta.pageHighWater), 'cleanup');
  assert.equal(w2.authority.stageOfOrdinal(delta.pageHighWater + 1), null, 'beyond the drain high-water');
  for (const bad of [null, undefined, '1', 1.5, Number.NaN]) assert.equal(w2.authority.stageOfOrdinal(bad), null);
  assert.deepEqual(w2.violations, []);
});

test('provenance(): one row per ingested page ordinal {seq, ord, realm:page, kind, label, phase, activeCheck, activeControl, stage}; seq = seqOfOrdinal(ord) from the single allocator; run rows stage run, drain rows stage cleanup', () => {
  const w = provenanceWorld();
  assert.equal(w.rows.length, w.authority.ingested().length);
  // (ADDENDUM 3) label = the identity the page registered for the ordinal: an event's own kind; spy/snapshot ordinals are unlabeled
  assert.deepEqual(w.rows.filter((x) => x.stage === 'cleanup').map((x) => [x.kind, x.label]), [['spy', null], ['event', 'wrapper-restore'], ['event', 'wrapper-restore'], ['snapshot', null]]);
  assert.ok(w.rows.filter((x) => x.stage === 'run' && x.kind === 'event').every((x) => x.label === 'wrapper-install'));
  assert.deepEqual(w.rows.map((x) => x.label), w.authority.ingested().map((x) => x.label));
  for (const row of w.rows) {
    assert.deepEqual(Object.keys(row).sort(), ['activeCheck', 'activeControl', 'kind', 'label', 'ord', 'phase', 'realm', 'seq', 'stage']);
    assert.equal(row.realm, 'page');
    assert.ok(H.isPageLocalOrdinal(row.ord));
    assert.ok(Number.isSafeInteger(row.seq) && row.seq > 0 && row.seq < BASE);
    assert.equal(w.authority.seqOfOrdinal(row.ord), row.seq);
    assert.equal(row.stage, row.ord <= w.runHw ? 'run' : 'cleanup');
    assert.equal(row.phase, row.stage === 'run' ? 'P1' : 'cleanup');
  }
  assert.deepEqual(w.rows.filter((x) => x.stage === 'cleanup').map((x) => x.kind), ['spy', 'event', 'event', 'snapshot']);
  assert.equal(new Set(w.rows.map((x) => x.seq)).size, w.rows.length, 'one seq per ordinal');
  // the rows are a copy: mutating them changes nothing in the authority
  w.rows[0].stage = 'cleanup'; w.rows[0].seq = -1;
  assert.notEqual(w.authority.provenance()[0].seq, -1);
});

test('cleanup provenance (1): complete one-to-one -- every cleanup eventLog entry <-> exactly one ingested cleanup-drain event ordinal (bijection), pageEvidenceProblems is []', () => {
  const w = provenanceWorld();
  const sources = w.rows.filter((x) => x.kind === 'event' && x.stage === 'cleanup');
  const events = w.cleanupEvents();
  assert.equal(sources.length, 2);
  assert.deepEqual(events.map((e) => e.seq), sources.map((x) => x.seq), 'source -> event and event -> source, same order');
  for (const ev of events) assert.equal(w.rows.filter((x) => x.seq === ev.seq).length, 1);
  // each event's seq is the rewrite of exactly its own delta ordinal
  assert.deepEqual(w.delta.eventLog.map((e) => w.authority.seqOfOrdinal(e.seq)), events.map((e) => e.seq));
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), []);
  assert.deepEqual(w.violations, []);
});

test('cleanup provenance (2): a phase-cleanup eventLog entry with NO source ordinal (Node-allocated seq) => cleanup-event-unsourced:<seq>; one whose seq is an ingested cleanup ordinal of another kind (spy) => unsourced too', () => {
  let w = provenanceWorld();
  const seq = w.allocator.next(); // a real authoritative seq, never an ingested page ordinal
  w.state.eventLog.push({ seq, kind: 'wrapper-restore', label: 'viewer.isolate', layer: 'recording', ok: true, ...CLEANUP });
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`cleanup-event-unsourced:${seq}`]);
  w = provenanceWorld();
  const spySeq = w.rows.find((x) => x.stage === 'cleanup' && x.kind === 'spy').seq;
  w.state.eventLog.push({ seq: spySeq, kind: 'wrapper-restore', label: 'x', layer: 'recording', ok: true, ...CLEANUP });
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`cleanup-event-unsourced:${spySeq}`]);
  // an ingested alloc-kind ordinal (marker/execution) is not an event source either
  w = provenanceWorld();
  const a = w.src.next(CLEANUP, 'alloc');
  assert.equal(w.fence((rep) => w.authority.ingestFence(rep)).ok, true);
  w.state.eventLog.push({ seq: w.authority.seqOfOrdinal(a), kind: 'wrapper-restore', ...CLEANUP });
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`cleanup-event-unsourced:${w.authority.seqOfOrdinal(a)}`]);
});

test('cleanup provenance (3): an ingested cleanup-drain event ordinal missing from eventLog => cleanup-event-missing:<seq> (+ page-evidence-missing:event:<seq>); both missing => both reported', () => {
  let w = provenanceWorld();
  const [e1, e2] = w.cleanupEvents().map((e) => e.seq);
  w.state.eventLog = w.state.eventLog.filter((e) => e.seq !== e2);
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`page-evidence-missing:event:${e2}`, `cleanup-event-missing:${e2}`]);
  // a delta whose eventLog was dropped entirely (merged without it)
  w = world();
  const { delta } = w.drain();
  H.mergeCleanupDelta(w.state, { ...w.authority.rewritePageRun(delta, { stage: 'cleanup' }), eventLog: [] });
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`page-evidence-missing:event:${e1}`, `page-evidence-missing:event:${e2}`, `cleanup-event-missing:${e1}`, `cleanup-event-missing:${e2}`]);
});

test('cleanup provenance (4): two authoritative cleanup events for ONE source ordinal (copy, or a different event re-using the seq) => cleanup-event-duplicate:<seq> (+ page-evidence-duplicate:event:<seq>), reported once', () => {
  for (const make of [(ev) => ({ ...ev }), (ev) => ({ ...ev, label: 'some-other-wrapper', ok: false })]) {
    const w = provenanceWorld();
    const ev = w.cleanupEvents()[1];
    w.state.eventLog.push(make(ev));
    assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`page-evidence-duplicate:event:${ev.seq}`, `cleanup-event-duplicate:${ev.seq}`]);
  }
});

test('cleanup provenance (5): a phase-cleanup event sourced by a run-stage ordinal must prove the cleanup boundary (ADDENDUM 4: boundary-unproven / before-boundary); one sourced by an ordinal ingested after the drain high-water (no stage) => cleanup-event-outside-drain:<seq>', () => {
  // (a) the run's wrapper-install event (stage run) re-labelled as a cleanup event: no 'cleanup' marker in the state =>
  // the boundary is unproven; with a proven marker it lies BEFORE the boundary. Never accepted (ADDENDUM 4 replaced the
  // former blanket outside-drain label for run-stage sources by the precise boundary labels).
  let w = provenanceWorld();
  const install = w.state.eventLog.find((e) => e.kind === 'wrapper-install');
  assert.equal(w.authority.stageOfOrdinal(w.rows.find((x) => x.seq === install.seq).ord), 'run');
  install.phase = 'cleanup';
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`cleanup-event-boundary-unproven:${install.seq}`]);
  w = provenanceWorld({ cleanupMarker: true });
  const install2 = w.state.eventLog.find((e) => e.kind === 'wrapper-install');
  assert.ok(install2.seq < w.markerSeq);
  install2.phase = 'cleanup';
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`cleanup-event-before-boundary:${install2.seq}`]);
  // (b) an event the page records AFTER the drain (ingested at a later fence, beyond the drain high-water)
  w = provenanceWorld();
  w.rec.logEvent('wrapper-restore', { label: 'late', layer: 'recording', ok: true });
  const late = w.rec.events[w.rec.events.length - 1];
  assert.equal(w.fence((rep) => w.authority.ingestFence(rep)).ok, true);
  const lateSeq = w.authority.seqOfOrdinal(late.seq);
  assert.equal(w.authority.stageOfOrdinal(late.seq), null);
  // not merged: only the generic page-evidence check sees it (it is not a cleanup-drain source)
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`page-evidence-missing:event:${lateSeq}`]);
  w.state.eventLog.push({ ...late, seq: lateSeq });
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`cleanup-event-outside-drain:${lateSeq}`]);
  // (c) fail closed: a cleanup stage without a prior run stage has no drain range => every cleanup event is outside it
  w = provenanceWorld({ runStage: null });
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), w.cleanupEvents().map((e) => `cleanup-event-outside-drain:${e.seq}`));
});

test('cleanup provenance (6): the same delta merged twice stays one (exactly-once merge => []); a hand-duplicated state => cleanup-event-duplicate; a second cleanup-stage rewrite => violation cleanup-drain-repeated', () => {
  const w = provenanceWorld();
  H.mergeCleanupDelta(w.state, w.rewritten);
  H.mergeCleanupDelta(w.state, JSON.parse(JSON.stringify(w.rewritten)));
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), []);
  assert.equal(w.cleanupEvents().length, 2);
  // hand-duplicated (what a merge without the exactly-once filter would produce)
  const dup = { ...w.state, eventLog: [...w.state.eventLog, ...w.cleanupEvents().map((e) => ({ ...e }))] };
  const [e1, e2] = w.cleanupEvents().map((e) => e.seq);
  assert.deepEqual(w.authority.pageEvidenceProblems(dup), [`page-evidence-duplicate:event:${e1}`, `page-evidence-duplicate:event:${e2}`, `cleanup-event-duplicate:${e1}`, `cleanup-event-duplicate:${e2}`]);
  // a second cleanup drain rewrite is itself a fail-closed violation (exactly one drain per run)
  assert.deepEqual(w.violations, []);
  w.authority.rewritePageRun(w.delta, { stage: 'cleanup' });
  assert.deepEqual(w.violations, ['cleanup-drain-repeated']);
  w.authority.rewritePageRun(w.delta, { stage: 'cleanup' });
  assert.deepEqual(w.violations, ['cleanup-drain-repeated', 'cleanup-drain-repeated']);
});

test('cleanup provenance (7): a page-local ordinal in a cleanup eventLog entry => cleanup-event-leaked-ordinal:<ord> and primarySeqAllocations still reports page-ordinal-leaked; an UN-rewritten delta merged directly leaks every cleanup event', () => {
  let w = provenanceWorld();
  w.state.eventLog.push({ seq: BASE + 999, kind: 'wrapper-restore', ...CLEANUP });
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`cleanup-event-leaked-ordinal:${BASE + 999}`]);
  assert.ok(H.primarySeqAllocations(w.state).problems.includes(`page-ordinal-leaked:${BASE + 999}:eventLog[${w.state.eventLog.length - 1}]`));
  // the raw (page-ordinal) delta merged without the Node rewrite
  w = world();
  const { delta } = w.drain();
  w.authority.rewritePageRun(delta, { stage: 'cleanup' }); // the range is fixed, but the merge bypasses the rewritten value
  H.mergeCleanupDelta(w.state, delta);
  const p = w.authority.pageEvidenceProblems(w.state);
  for (const e of delta.eventLog) assert.ok(p.includes(`cleanup-event-leaked-ordinal:${e.seq}`), e.seq);
  for (const row of w.authority.provenance().filter((x) => x.stage === 'cleanup' && x.kind === 'event')) assert.ok(p.includes(`cleanup-event-missing:${row.seq}`));
  assert.ok(p.includes(`page-evidence-unsourced:spy:${delta.spyLedger[0].seq}`));
  assert.ok(H.primarySeqAllocations(w.state).problems.some((x) => x.startsWith(`page-ordinal-leaked:${delta.eventLog[0].seq}:eventLog[`)));
});

test('cleanup provenance: a cleanup-drain event whose phase is not cleanup => cleanup-event-phase-mismatch:<seq> (relabelled entry; page cleanup records attributed to a run phase)', () => {
  let w = provenanceWorld();
  const ev = w.cleanupEvents()[0];
  ev.phase = 'P11';
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`cleanup-event-phase-mismatch:${ev.seq}`]);
  // the page never switched to the cleanup attribution: its drain-range events carry P1 (source phase P1 too)
  w = provenanceWorld({ cleanupAttr: { phase: 'P1', activeCheck: null, activeControl: null } });
  const drained = w.rows.filter((x) => x.stage === 'cleanup' && x.kind === 'event');
  assert.equal(drained.length, 2);
  assert.ok(drained.every((x) => x.phase === 'P1'));
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), drained.map((x) => `cleanup-event-phase-mismatch:${x.seq}`));
});

test('cleanup provenance (8): spy/snapshot completeness is unchanged by the event provenance -- a complete world is [], and a missing/duplicate/unsourced spy or snapshot reports ONLY its page-evidence label', () => {
  const base = provenanceWorld();
  assert.deepEqual(base.authority.pageEvidenceProblems(base.state), []);
  for (const [coll, kind] of [['spyLedger', 'spy'], ['stateSnapshots', 'snapshot']]) {
    let w = provenanceWorld();
    const s = w.rows.find((x) => x.stage === 'cleanup' && x.kind === kind).seq;
    w.state[coll] = w.state[coll].filter((e) => e.seq !== s);
    assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`page-evidence-missing:${kind}:${s}`]);
    w = provenanceWorld();
    w.state[coll] = [...w.state[coll], { ...w.state[coll].find((e) => e.seq === s) }];
    assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`page-evidence-duplicate:${kind}:${s}`]);
    w = provenanceWorld();
    const n = w.allocator.next();
    w.state[coll] = [...w.state[coll], { ...w.state[coll].find((e) => e.seq === s), seq: n }];
    assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`page-evidence-unsourced:${kind}:${n}`]);
  }
});

test('cleanup provenance non-vacuity: the PRE-FIX check (provenance block removed from a mutated harness copy) lets unsourced / outside-drain / phase-mismatch / leaked cleanup events through and labels missing/duplicate only generically', async () => {
  const pre = await mutated([[PROVENANCE_BLOCK, '']]);
  const preWorld = (opts) => {
    const w = world(pre, opts);
    const { delta } = w.drain();
    pre.mergeCleanupDelta(w.state, w.authority.rewritePageRun(delta, { stage: 'cleanup' }));
    return w;
  };
  const postDrainCleanupEvent = (w) => {
    w.rec.logEvent('wrapper-restore', { label: 'late', layer: 'recording', ok: true });
    const late = w.rec.events[w.rec.events.length - 1];
    assert.equal(w.fence((rep) => w.authority.ingestFence(rep)).ok, true);
    w.state.eventLog.push({ ...late, seq: w.authority.seqOfOrdinal(late.seq) });
  };
  const cases = [
    ['unsourced', (w) => { w.state.eventLog.push({ seq: w.allocator.next(), kind: 'wrapper-restore', ...CLEANUP }); }, []],
    ['outside-drain', postDrainCleanupEvent, []],
    // (ADDENDUM 4) a run-stage event relabelled cleanup: no marker => boundary-unproven; with a proven marker => before-boundary
    ['boundary-unproven', (w) => { w.state.eventLog.find((e) => e.kind === 'wrapper-install').phase = 'cleanup'; }, []],
    ['before-boundary', (w) => { w.state.eventLog.find((e) => e.kind === 'wrapper-install').phase = 'cleanup'; }, [], { cleanupMarker: true }],
    ['phase-mismatch', (w) => { w.state.eventLog.find((e) => e.phase === 'cleanup').phase = 'P11'; }, []],
    ['leaked-ordinal', (w) => { w.state.eventLog.push({ seq: BASE + 999, kind: 'wrapper-restore', ...CLEANUP }); }, []],
  ];
  for (const [name, corrupt, expected, opts] of cases) {
    const w = preWorld(opts);
    corrupt(w);
    assert.deepEqual(w.authority.pageEvidenceProblems(w.state), expected, `${name} undetected before the fix`);
    // ... and the fixed harness detects the very same corruption
    const f = provenanceWorld(opts);
    corrupt(f);
    assert.ok(f.authority.pageEvidenceProblems(f.state).some((p) => p.startsWith(`cleanup-event-${name}:`)), `${name} detected after the fix`);
  }
  const w = preWorld();
  const victim = w.state.eventLog.filter((e) => e.phase === 'cleanup')[0].seq;
  w.state.eventLog = w.state.eventLog.filter((e) => e.seq !== victim);
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`page-evidence-missing:event:${victim}`], 'no cleanup-event-missing label before the fix');
  const w2 = preWorld();
  const ev = w2.state.eventLog.filter((e) => e.phase === 'cleanup')[1];
  w2.state.eventLog.push({ ...ev });
  assert.deepEqual(w2.authority.pageEvidenceProblems(w2.state), [`page-evidence-duplicate:event:${ev.seq}`], 'no cleanup-event-duplicate label before the fix');
});

test('cleanup provenance non-vacuity: removing the drain upper bound of stageOfOrdinal or the cleanup-drain-repeated guard (mutated copies) lets a post-drain event / a second drain through', async () => {
  const noHi = await mutated([["return drainRange !== null && ord > drainRange.lo && ord <= drainRange.hi ? 'cleanup' : null;", "return 'cleanup';"]]);
  const w = world(noHi);
  const { delta } = w.drain();
  noHi.mergeCleanupDelta(w.state, w.authority.rewritePageRun(delta, { stage: 'cleanup' }));
  w.rec.logEvent('wrapper-restore', { label: 'late', layer: 'recording', ok: true });
  const late = w.rec.events[w.rec.events.length - 1];
  assert.equal(w.fence((rep) => w.authority.ingestFence(rep)).ok, true);
  w.state.eventLog.push({ ...late, seq: w.authority.seqOfOrdinal(late.seq) });
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [], 'a post-drain event passes as a drained one without the upper bound');
  const noRepeat = await mutated([["if (drainCount > 1) violate('cleanup-drain-repeated');", '']]);
  const w2 = world(noRepeat);
  const d2 = w2.drain().delta;
  w2.authority.rewritePageRun(d2, { stage: 'cleanup' });
  w2.authority.rewritePageRun(d2, { stage: 'cleanup' });
  assert.deepEqual(w2.violations, [], 'a second drain is silent without the guard');
});

test('provenance labels are de-duplicated (one label per distinct problem) and two unsourced phase-cleanup entries sharing one seq are cleanup-event-duplicate', () => {
  const w = provenanceWorld();
  const ev = w.cleanupEvents()[0];
  // a run-stage-sourced event relabelled to cleanup and listed twice: each distinct problem is reported once
  // (ADDENDUM 4: no 'cleanup' marker in this state => the run-stage source's boundary is unproven)
  const runEv = w.rows.find((r) => r.kind === 'event' && r.stage === 'run');
  assert.ok(runEv);
  const dup = { ...ev, seq: runEv.seq, phase: 'cleanup' };
  const probs = w.authority.pageEvidenceProblems({ ...w.state, eventLog: [...w.state.eventLog, dup, { ...dup }] });
  assert.equal(probs.length, new Set(probs).size, JSON.stringify(probs));
  assert.ok(probs.includes(`cleanup-event-boundary-unproven:${runEv.seq}`), JSON.stringify(probs));
  assert.ok(probs.includes(`cleanup-event-duplicate:${runEv.seq}`), JSON.stringify(probs));
  assert.equal(probs.filter((p) => p === `cleanup-event-boundary-unproven:${runEv.seq}`).length, 1);
  // two unsourced phase-cleanup entries with one seq
  const seq = w.allocator.next();
  const probs2 = w.authority.pageEvidenceProblems({ ...w.state, eventLog: [...w.state.eventLog, { ...ev, seq }, { ...ev, seq }] });
  assert.ok(probs2.includes(`cleanup-event-unsourced:${seq}`) && probs2.includes(`cleanup-event-duplicate:${seq}`), JSON.stringify(probs2));
  assert.equal(probs2.length, new Set(probs2).size);
});

// ---------------------------------------------------------------------------------------------
// ADDENDUM 3 (2026-10-02, review round): ordinal labels (identity), reported duplicate merges, and the
// documented conservative outside-drain behaviour for a phase-'cleanup' event carried by the RUN result.
// ---------------------------------------------------------------------------------------------

/** The harness text of the identity check of pageEvidenceProblems (removed => no identity check). (ADDENDUM 5: unconditional.) */
const IDENTITY_LINE = '        else if (ev.kind !== src.label) out.push(`cleanup-event-identity-mismatch:${ev.seq}`);\n';
/** (ADDENDUM 5) the ingestion requirement that an `event` entry carries a non-empty string label (removed => unlabeled accepted). */
const EVENT_LABEL_GUARD = ["(e.kind === 'event' && !(typeof e.label === 'string' && e.label.length > 0)) || ", ''];
/** (ADDENDUM 5) the pre-ADDENDUM-5 conditional identity check (an unlabeled source was exempt). */
const OLD_CONDITIONAL_IDENTITY = [IDENTITY_LINE, '        else if (src.label !== null && ev.kind !== src.label) out.push(`cleanup-event-identity-mismatch:${ev.seq}`);\n'];
const FORGED = 'forged-different-event';
/** Replaces the drained wrapper-restore entry at `seq` by a DIFFERENT event keeping its seq and attribution. */
const forgeAt = (log, seq) => log.map((e) => (e.seq === seq ? { seq: e.seq, phase: e.phase, activeCheck: e.activeCheck, activeControl: e.activeControl, kind: FORGED } : e));

test('ADDENDUM 3 label round-trip: recorder.logEvent(kind) -> pending entry label -> ingested()/provenance() label; spy/snapshot ordinals unlabeled; an early hint carries the label too', () => {
  const w = world();
  // page side: after the run and the cleanup sync fence, exactly the four cleanup ordinals are pending, labelled by the recorder
  const pend = w.src.pending();
  assert.deepEqual(pend.map((e) => [e.kind, e.label, e.phase]), [['spy', null, 'cleanup'], ['event', 'wrapper-restore', 'cleanup'], ['event', 'wrapper-restore', 'cleanup'], ['snapshot', null, 'cleanup']]);
  assert.deepEqual(w.rec.events.filter((e) => e.phase === 'cleanup').map((e) => e.kind), ['wrapper-restore', 'wrapper-restore']);
  assert.equal(w.drain().r.ok, true);
  const ing = w.authority.ingested().filter((e) => e.phase === 'cleanup');
  assert.deepEqual(ing.map((e) => [e.kind, e.label]), pend.map((e) => [e.kind, e.label]));
  assert.deepEqual(ing.map((e) => e.ord), pend.map((e) => e.ord));
  // the run's wrapper-install events registered their own kind as well
  assert.ok(w.authority.ingested().filter((e) => e.phase === 'P1' && e.kind === 'event').every((e) => e.label === 'wrapper-install'));
  w.authority.rewritePageRun({ spyLedger: [], eventLog: [], stateSnapshots: [], pageHighWater: w.src.highWater() }, { stage: 'cleanup' });
  assert.deepEqual(w.authority.provenance().filter((x) => x.stage === 'cleanup').map((x) => [x.kind, x.label]), pend.map((e) => [e.kind, e.label]));
  assert.deepEqual(w.violations, []);
  // the early best-effort hint (deliver) carries the label, and Node ingests it with that label
  const hints = [];
  const s = H.createPageOrdinalSource({ deliver: (e) => hints.push(e) });
  const rec = H.createCallRecorder({ nextSeq: s.next });
  rec.setAttribution({ phase: 'P1', activeCheck: null, activeControl: null });
  rec.logEvent('wrapper-install', { label: 'viewer.isolate', layer: 'recording', ok: true });
  assert.deepEqual(hints.map((e) => [e.kind, e.label]), [['event', 'wrapper-install']]);
  const v2 = [];
  const a2 = H.createRunAuthority({ allocator: H.createRunSeqAllocator(), attribution: { phase: 'P1', activeCheck: null, activeControl: null }, onViolation: (r) => v2.push(r) });
  assert.deepEqual(a2.ingestEarly(hints), { ok: true, count: 1 });
  assert.equal(a2.ingested()[0].label, 'wrapper-install');
  assert.deepEqual(v2, []);
});

test('ADDENDUM 3 label conflict: a re-send of an ingested ordinal with a different label is ONE ingest-conflict (fence) and ingests nothing; the early path defers it without a violation; undefined === null for an unlabeled ordinal', () => {
  const w = world();
  const pend = w.src.pending();
  const hw = w.src.highWater();
  assert.deepEqual(w.authority.ingestFence({ pending: pend, hw }), { ok: true, count: 4 });
  const peek = w.allocator.peek();
  const before = w.authority.ingested();
  // an unlabeled ordinal re-sent without the field is the same entry (idempotent)
  const { label: _drop, ...noLabel } = pend[0];
  void _drop;
  assert.deepEqual(w.authority.ingestFence({ pending: [noLabel, ...pend.slice(1)], hw }), { ok: true, count: 0 });
  // early path first: a relabelled re-send is DEFERRED (no violation), nothing changes
  const relabelled = pend.map((e, i) => (i === 1 ? { ...e, label: FORGED } : e));
  assert.deepEqual(w.authority.ingestEarly([relabelled[1]]), { ok: true, count: 0, deferred: true, reason: 'ingest-conflict' });
  assert.deepEqual(w.violations, []);
  // the awaited fence: ONE violation per refused fence, nothing ingested or allocated
  for (const bad of [relabelled, pend.map((e, i) => (i === 0 ? { ...e, label: 'spy' } : e))]) {
    const n = w.violations.length;
    assert.deepEqual(w.authority.ingestFence({ pending: bad, hw }), { ok: false, reason: 'ingest-conflict' });
    assert.deepEqual(w.violations.slice(n), ['ingest-conflict']);
  }
  // (ADDENDUM 5) a re-send of an ingested EVENT ordinal with label null is no longer a mere conflict: an unlabeled event
  // entry is malformed (ingest-entry-invalid) before any conflict comparison
  const n0 = w.violations.length;
  assert.deepEqual(w.authority.ingestFence({ pending: pend.map((e, i) => (i === 1 ? { ...e, label: null } : e)), hw }), { ok: false, reason: 'ingest-entry-invalid' });
  assert.deepEqual(w.violations.slice(n0), ['ingest-entry-invalid']);
  assert.equal(w.allocator.peek(), peek);
  assert.deepEqual(w.authority.ingested(), before);
  // a non-string label is malformed
  assert.deepEqual(w.authority.ingestFence({ pending: pend.map((e, i) => (i === 1 ? { ...e, label: 7 } : e)), hw }), { ok: false, reason: 'ingest-entry-invalid' });
  assert.equal(w.violations[w.violations.length - 1], 'ingest-entry-invalid');
});

test('ADDENDUM 3 cleanup-event-identity-mismatch: a drained wrapper-restore entry replaced by {kind: forged-different-event} keeping seq/phase => [cleanup-event-identity-mismatch:<seq>] (state-level and delta-level forgery)', () => {
  // (a) the authoritative state is corrupted after the merge
  let w = provenanceWorld();
  const victim = w.cleanupEvents()[0].seq;
  w.state.eventLog = forgeAt(w.state.eventLog, victim);
  assert.equal(w.state.eventLog.filter((e) => e.seq === victim).length, 1);
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`cleanup-event-identity-mismatch:${victim}`]);
  // (b) the page returns the forged entry in its delta after a CORRECT fence (same ordinal, same attribution)
  w = world();
  const { delta } = w.drain();
  const ord = delta.eventLog[1].seq;
  const forgedDelta = { ...delta, eventLog: forgeAt(delta.eventLog, ord) };
  assert.deepEqual(H.mergeCleanupDelta(w.state, w.authority.rewritePageRun(forgedDelta, { stage: 'cleanup' })), { duplicates: 0 });
  assert.deepEqual(w.violations, [], 'nothing else is wrong: ingested, mapped, merged once');
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`cleanup-event-identity-mismatch:${w.authority.seqOfOrdinal(ord)}`]);
  // (c) ordering: identity is checked AFTER outside-drain / phase-mismatch (a forged + run-phase entry is phase-mismatch only)
  w = provenanceWorld();
  const v = w.cleanupEvents()[1].seq;
  w.state.eventLog = forgeAt(w.state.eventLog, v).map((e) => (e.seq === v ? { ...e, phase: 'P11' } : e));
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`cleanup-event-phase-mismatch:${v}`]);
  // (d) an un-forged world stays clean (the identity check matches every real wrapper-restore)
  assert.deepEqual(provenanceWorld().authority.pageEvidenceProblems(provenanceWorld().state), []);
});

// (ADDENDUM 5) The former ADDENDUM 3 "unlabeled (label null) cleanup-drain ordinal is NOT identity-checked" exemption is
// REMOVED: an `event` ordinal without a non-empty string label is refused at INGESTION (fence: ONE ingest-entry-invalid
// violation, nothing ingested; early path: deferred, no violation), and the identity check is unconditional.

test('ADDENDUM 5 ingestion: an UNLABELED event ordinal (label null / absent / empty string) is refused -- fence: ONE ingest-entry-invalid, nothing ingested or allocated; early: deferred, no violation; spy/snapshot/alloc ordinals stay legal with label null', () => {
  const P1 = { phase: 'P1', activeCheck: null, activeControl: null };
  const fresh = () => {
    const violations = [];
    const allocator = H.createRunSeqAllocator();
    const authority = H.createRunAuthority({ allocator, attribution: { ...P1 }, onViolation: (r) => violations.push(r) });
    const src = H.createPageOrdinalSource();
    return { violations, allocator, authority, src };
  };
  /** spy, event(<label>), snapshot, alloc -- all under P1; `drop` removes the event entry's label field entirely. */
  const batch = (w, label, drop = false) => {
    w.src.next(P1, 'spy', null);
    w.src.next(P1, 'event', label);
    w.src.next(P1, 'snapshot', null);
    w.src.next(P1, 'alloc', null);
    const pending = w.src.pending().map((e) => (drop && e.kind === 'event' ? (({ label: _l, ...rest }) => rest)(e) : e));
    return { pending, hw: w.src.highWater() };
  };
  for (const [name, label, drop] of [['label null', null, false], ['label absent', null, true], ['empty label', '', false]]) {
    // the awaited fence: fail closed, atomically (not even the legal spy entry before it is ingested)
    let w = fresh();
    let rep = batch(w, label, drop);
    assert.equal(rep.pending[1].kind, 'event');
    assert.equal(drop ? 'label' in rep.pending[1] : rep.pending[1].label, drop ? false : label, name);
    const peek = w.allocator.peek();
    assert.deepEqual(w.authority.ingestFence(rep), { ok: false, reason: 'ingest-entry-invalid' }, name);
    assert.deepEqual(w.violations, ['ingest-entry-invalid'], name);
    assert.deepEqual(w.authority.ingested(), [], name);
    assert.equal(w.allocator.peek(), peek, `${name}: nothing allocated`);
    // the attribution fence (syncPage) ingests through the same validation
    w = fresh();
    rep = batch(w, label, drop);
    assert.deepEqual(w.authority.syncPage({ ...P1, ...rep }).ok, false, name);
    assert.deepEqual(w.violations, ['ingest-entry-invalid'], `${name} (syncPage)`);
    assert.deepEqual(w.authority.ingested(), [], name);
    // the early best-effort path: deferred to the awaited fence, never a violation, nothing ingested
    w = fresh();
    rep = batch(w, label, drop);
    assert.deepEqual(w.authority.ingestEarly(rep.pending), { ok: true, count: 0, deferred: true, reason: 'ingest-entry-invalid' }, name);
    assert.deepEqual(w.violations, [], name);
    assert.deepEqual(w.authority.ingested(), [], name);
  }
  // control: the same batch with the event labelled ingests completely; spy/snapshot/alloc keep label null (legal)
  const w = fresh();
  const rep = batch(w, 'wrapper-install');
  assert.deepEqual(w.authority.ingestFence(rep), { ok: true, count: 4 });
  assert.deepEqual(w.authority.ingested().map((e) => [e.kind, e.label]), [['spy', null], ['event', 'wrapper-install'], ['snapshot', null], ['alloc', null]]);
  assert.deepEqual(w.violations, []);
  // a non-event entry may also omit the field (undefined === null for spy/snapshot/alloc)
  const w2 = fresh();
  w2.src.next(P1, 'snapshot', null);
  const p2 = w2.src.pending().map(({ label: _l, ...rest }) => rest);
  assert.deepEqual(w2.authority.ingestFence({ pending: p2, hw: w2.src.highWater() }), { ok: true, count: 1 });
  assert.equal(w2.authority.ingested()[0].label, null);
});

test('ADDENDUM 5 the null-label forgery now FAILS at ingestion: a page that registers its drained wrapper-restore event ordinals unlabeled has its cleanup drain fence refused (ONE ingest-entry-invalid), nothing of the cleanup ingested, and the merged delta cannot pass pageEvidenceProblems', () => {
  const w = world(H, { unlabeledKind: 'wrapper-restore' });
  assert.equal(w.refused, undefined, 'the run fence carried no wrapper-restore');
  const pend = w.src.pending();
  assert.deepEqual(pend.map((e) => [e.kind, e.label]), [['spy', null], ['event', null], ['event', null], ['snapshot', null]]);
  const peek = w.allocator.peek();
  const { r, delta } = w.drain();
  assert.deepEqual(r, { ok: false, reason: 'ingest-entry-invalid' });
  assert.deepEqual(w.violations, ['ingest-entry-invalid']);
  assert.deepEqual(w.authority.ingested().filter((e) => e.phase === 'cleanup'), [], 'nothing of the cleanup ingested');
  assert.equal(w.allocator.peek(), peek);
  assert.equal(w.src.pending().length, 4, 'not acknowledged: the page still holds the refused ordinals');
  // the (forged, unlabeled) delta merged anyway cannot pass: its ordinals were never mapped
  const out = w.authority.rewritePageRun(delta, { stage: 'cleanup' });
  assert.ok(w.violations.includes('page-ordinal-unmapped'));
  H.mergeCleanupDelta(w.state, out);
  const victim = out.eventLog[0].seq;
  w.state.eventLog = forgeAt(w.state.eventLog, victim);
  const p = w.authority.pageEvidenceProblems(w.state);
  assert.notDeepEqual(p, []);
  for (const e of delta.eventLog) assert.ok(p.includes(`cleanup-event-leaked-ordinal:${e.seq}`), JSON.stringify(p));
});

test('ADDENDUM 5 non-vacuity: removing the ingestion label requirement (mutated copy) lets unlabeled events in, and the now-UNCONDITIONAL identity check still rejects them; only with the old conditional identity check as well does the null-label forgery pass (the removed exemption)', async () => {
  const noGuard = await mutated([EVENT_LABEL_GUARD]);
  let w = world(noGuard, { unlabeledKind: 'wrapper-restore' });
  let { r, delta } = w.drain();
  assert.equal(r.ok, true, 'ingested without the guard');
  assert.ok(w.authority.provenance().filter((x) => x.kind === 'event' && x.phase === 'cleanup').every((x) => x.label === null));
  noGuard.mergeCleanupDelta(w.state, w.authority.rewritePageRun(delta, { stage: 'cleanup' }));
  const evs = w.state.eventLog.filter((e) => e.phase === 'cleanup').map((e) => e.seq);
  assert.equal(evs.length, 2);
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), evs.map((s) => `cleanup-event-identity-mismatch:${s}`), 'unconditional identity: an unlabeled source never matches');
  const exempt = await mutated([EVENT_LABEL_GUARD, OLD_CONDITIONAL_IDENTITY]);
  w = world(exempt, { unlabeledKind: 'wrapper-restore' });
  ({ r, delta } = w.drain());
  assert.equal(r.ok, true);
  exempt.mergeCleanupDelta(w.state, w.authority.rewritePageRun(delta, { stage: 'cleanup' }));
  const victim = w.state.eventLog.filter((e) => e.phase === 'cleanup')[0].seq;
  w.state.eventLog = forgeAt(w.state.eventLog, victim);
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [], 'the pre-ADDENDUM-5 exemption: a null-label forgery passes');
  // the real harness refuses the very same page at the drain fence
  const real = world(H, { unlabeledKind: 'wrapper-restore' });
  assert.deepEqual(real.drain().r, { ok: false, reason: 'ingest-entry-invalid' });
});

test('ADDENDUM 3 identity non-vacuity: with the identity check REMOVED (mutated harness copy) the forged cleanup event passes; the real harness rejects the same world', async () => {
  const noId = await mutated([[IDENTITY_LINE, '']]);
  const w = world(noId);
  const { delta } = w.drain();
  noId.mergeCleanupDelta(w.state, w.authority.rewritePageRun(delta, { stage: 'cleanup' }));
  const victim = w.state.eventLog.filter((e) => e.phase === 'cleanup')[0].seq;
  w.state.eventLog = forgeAt(w.state.eventLog, victim);
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [], 'forgery undetected without the identity check');
  const f = provenanceWorld();
  f.state.eventLog = forgeAt(f.state.eventLog, victim);
  assert.equal(f.cleanupEvents()[0].seq, victim, 'same deterministic seq in both worlds');
  assert.deepEqual(f.authority.pageEvidenceProblems(f.state), [`cleanup-event-identity-mismatch:${victim}`]);
});

test('ADDENDUM 3 double merge: mergeCleanupDelta returns {duplicates:0} for the first merge and {duplicates:n>0} for the same rewritten delta again, leaving the state unchanged; a partial overlap counts only the overlap', () => {
  const w = world();
  const { delta } = w.drain();
  const rw = w.authority.rewritePageRun(delta, { stage: 'cleanup' });
  const n = rw.spyLedger.length + rw.eventLog.length + rw.stateSnapshots.length;
  assert.equal(n, 4);
  assert.deepEqual(H.mergeCleanupDelta(w.state, rw), { duplicates: 0 });
  const once = JSON.stringify(w.state);
  assert.deepEqual(H.mergeCleanupDelta(w.state, rw), { duplicates: n });
  assert.equal(JSON.stringify(w.state), once, 'the state is unchanged by the repeated merge');
  assert.deepEqual(H.mergeCleanupDelta(w.state, JSON.parse(JSON.stringify(rw))), { duplicates: n }, 'a structurally equal copy counts the same');
  assert.equal(JSON.stringify(w.state), once);
  // the completeness check alone cannot see the repeat (state is exactly-once): only the returned count can --
  // which is why runPostReservation fails closed on duplicates > 0 (cleanup-evidence:merge-duplicate:<n>).
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), []);
  // a partial overlap: one already-present cleanup spy record + one new record
  const fresh = { seq: w.allocator.next(), phase: 'cleanup', method: 'x' };
  assert.deepEqual(H.mergeCleanupDelta(w.state, { spyLedger: [rw.spyLedger[0], fresh], eventLog: [], stateSnapshots: [] }), { duplicates: 1 });
  assert.equal(w.state.spyLedger.filter((e) => e.seq === rw.spyLedger[0].seq).length, 1);
  assert.equal(w.state.spyLedger[w.state.spyLedger.length - 1], fresh);
});


// ---------------------------------------------------------------------------------------------
// ADDENDUM 4 (M1 fix, 2026-10-02): SEMANTIC cleanup phase vs TRANSPORT stage. A phase-'cleanup' event is valid when it
// came through the cleanup drain (stage 'cleanup') OR when the run-stage transfer carried it past a PROVEN cleanup
// boundary: exactly ONE authoritative errorLedger.markers 'cleanup' entry whose seq is an ingested run-stage `alloc`
// ordinal with phase 'cleanup', and ev.seq > that seq. Labels: cleanup-event-boundary-unproven:<seq> /
// cleanup-event-before-boundary:<seq>; outside-drain is kept only for sources with no stage (post-drain / no run stage).
// The former ADDENDUM 3 point 3 pin (a run-carried post-marker cleanup event = conservative outside-drain false-FAIL)
// is FLIPPED: that event is now a valid PASS.
// ---------------------------------------------------------------------------------------------

/** A run that crossed mark('cleanup') (a `late-callback` cleanup event in the RUN result), drained + merged. */
function crossWorld(opts = {}, M = H) {
  const w = world(M, { cleanupEventInRun: true, ...opts });
  const { r, delta } = w.drain();
  assert.equal(r.ok, true);
  const rewritten = w.authority.rewritePageRun(delta, { stage: 'cleanup' });
  const merge = M.mergeCleanupDelta(w.state, rewritten);
  const late = w.state.eventLog.find((e) => e.kind === 'late-callback');
  const lateRow = late ? w.authority.provenance().find((x) => x.seq === late.seq) : undefined;
  const drainedEvents = () => w.state.eventLog.filter((e) => e.kind === 'wrapper-restore' && e.phase === 'cleanup');
  return { ...w, delta, rewritten, merge, late, lateRow, drainedEvents };
}

const P1_ATTR = Object.freeze({ phase: 'P1', activeCheck: null, activeControl: null });
const OLD_OUTSIDE_RULE = ["else if (!fromCleanupDrain && srcStage !== 'run')", 'else if (!fromCleanupDrain)'];
const OLD_FORWARD_RULE = ["!(stage === 'cleanup' || (stage === 'run' && e.phase === 'cleanup'))", "!(stage === 'cleanup')"];
const BEFORE_BOUNDARY_LINE = '        else if (!fromCleanupDrain && !(ev.seq > boundarySeq)) out.push(`cleanup-event-before-boundary:${ev.seq}`);\n';
const UNPROVEN_LINE = '        else if (!fromCleanupDrain && boundarySeq === null) out.push(`cleanup-event-boundary-unproven:${ev.seq}`);\n';
const MARKER_QUALIFIER = "markerSrc.kind === 'alloc' && markerSrc.label === 'marker:cleanup' && markerSrc.phase === 'cleanup' && api.stageOfOrdinal(markerSrc.ord) === 'run'";
/** (ADDENDUM 5) the marker-identity term of the qualification (removed => any qualifying-looking alloc is a marker). */
const MARKER_LABEL_TERM = ["markerSrc.label === 'marker:cleanup' && ", ''];
const MARKER_COUNT = 'cleanupMarkers.length === 1';

test('ADDENDUM 4 (1) cleanup-stage transfer: a phase-cleanup event sourced by the cleanup drain is valid with or without a cleanup marker; in the cross-boundary world the drained events are valid alongside the run-carried one', () => {
  // no marker at all: drain-sourced events never need the boundary proof
  const p = provenanceWorld();
  assert.deepEqual(p.state.errorLedger.markers, []);
  assert.ok(p.cleanupEvents().every((e) => p.authority.stageOfOrdinal(p.rows.find((x) => x.seq === e.seq).ord) === 'cleanup'));
  assert.deepEqual(p.authority.pageEvidenceProblems(p.state), []);
  const w = crossWorld();
  const drained = w.drainedEvents();
  assert.equal(drained.length, 2);
  for (const e of drained) assert.equal(w.authority.provenance().find((x) => x.seq === e.seq).stage, 'cleanup');
  assert.ok(drained.every((e) => e.seq > w.late.seq), 'drained after the run-carried event');
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), []);
});

test('ADDENDUM 4 (2) cross-boundary VALID (flipped from the ADDENDUM 3 point 3 false-FAIL): a phase-cleanup event recorded after mark(cleanup) but carried by the RUN-stage transfer, proven after the authoritative cleanup marker => pageEvidenceProblems []', () => {
  const w = crossWorld();
  assert.ok(w.late, 'the event is in the run result');
  assert.equal(w.late.phase, 'cleanup');
  assert.deepEqual([w.lateRow.kind, w.lateRow.label, w.lateRow.phase, w.lateRow.stage], ['event', 'late-callback', 'cleanup', 'run'], 'ingested, labelled, attributed; transport stage run');
  assert.ok(w.lateRow.ord <= w.runHw);
  // the boundary proof: ONE 'cleanup' marker = the authoritative seq of an ingested run-stage alloc ordinal with phase cleanup
  assert.deepEqual(w.state.errorLedger.markers.filter((m) => m.name === 'cleanup'), [{ seq: w.markerSeq, name: 'cleanup' }]);
  const mrow = w.authority.provenance().find((x) => x.seq === w.markerSeq);
  assert.deepEqual([mrow.ord, mrow.kind, mrow.phase, mrow.stage], [w.markerOrd, 'alloc', 'cleanup', 'run']);
  assert.ok(w.late.seq > w.markerSeq, 'Node seq order: after the marker');
  // carried exactly once, by the run stage only (not in the drain delta), identity = its label
  assert.equal(w.delta.eventLog.some((e) => e.kind === 'late-callback'), false);
  assert.deepEqual(w.merge, { duplicates: 0 });
  assert.equal(w.state.eventLog.filter((e) => e.seq === w.late.seq).length, 1);
  assert.equal(w.late.kind, w.lateRow.label);
  assert.deepEqual(w.violations, []);
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), []);
  // it is also allocated by the one allocator (< PAGE_LOCAL_BASE) and the whole state is leak-free
  assert.ok(!H.isPageLocalOrdinal(w.late.seq));
  assert.deepEqual(H.primarySeqAllocations(w.state).problems, []);
});

test('ADDENDUM 4 (2/7) forward-mandatory: the run-carried cleanup event is a MANDATORY cleanup source -- dropping it => [page-evidence-missing:event:<seq>, cleanup-event-missing:<seq>]; a dropped drained one too', () => {
  let w = crossWorld();
  const s = w.late.seq;
  w.state.eventLog = w.state.eventLog.filter((e) => e.seq !== s);
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`page-evidence-missing:event:${s}`, `cleanup-event-missing:${s}`]);
  w = crossWorld();
  const d = w.drainedEvents()[0].seq;
  w.state.eventLog = w.state.eventLog.filter((e) => e.seq !== d);
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`page-evidence-missing:event:${d}`, `cleanup-event-missing:${d}`]);
});

test('ADDENDUM 4 non-vacuity: restoring the OLD rule (every non-drain cleanup source => outside-drain; mutated harness copy) makes the valid cross-boundary world FAIL; the old forward rule (drain-only mandatory) loses the run-carried cleanup-event-missing', async () => {
  const old = await mutated([OLD_OUTSIDE_RULE]);
  const o = crossWorld({}, old);
  assert.deepEqual(o.authority.pageEvidenceProblems(o.state), [`cleanup-event-outside-drain:${o.late.seq}`], 'the old rule false-FAILs the valid world');
  const f = crossWorld();
  assert.equal(f.late.seq, o.late.seq, 'same deterministic seq');
  assert.deepEqual(f.authority.pageEvidenceProblems(f.state), []);
  const oldFwd = await mutated([OLD_FORWARD_RULE]);
  const m = crossWorld({}, oldFwd);
  m.state.eventLog = m.state.eventLog.filter((e) => e.seq !== m.late.seq);
  assert.deepEqual(m.authority.pageEvidenceProblems(m.state), [`page-evidence-missing:event:${m.late.seq}`], 'no cleanup-event-missing without the semantic forward rule');
});

test('ADDENDUM 4 (3) before the marker: a run-stage phase-cleanup event whose seq precedes the cleanup marker seq => cleanup-event-before-boundary:<seq> (the post-marker one in the same transfer stays valid); removing the boundary check (mutated copy) lets it PASS', async () => {
  const w = crossWorld({ eventBeforeMarker: true });
  const early = w.state.eventLog.find((e) => e.kind === 'early-callback');
  const row = w.authority.provenance().find((x) => x.seq === early.seq);
  assert.deepEqual([row.kind, row.label, row.phase, row.stage], ['event', 'early-callback', 'cleanup', 'run'], 'a well-formed, labelled, cleanup-attributed run-stage source');
  assert.ok(early.seq < w.markerSeq && w.markerSeq < w.late.seq);
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`cleanup-event-before-boundary:${early.seq}`]);
  // the event AT the marker seq is not an event source at all (the marker is alloc-kind)
  const atMarker = { ...early, seq: w.markerSeq };
  assert.deepEqual(w.authority.pageEvidenceProblems({ ...w.state, eventLog: [...w.state.eventLog, atMarker] }), [`cleanup-event-before-boundary:${early.seq}`, `cleanup-event-unsourced:${w.markerSeq}`]);
  const noBoundary = await mutated([[BEFORE_BOUNDARY_LINE, '']]);
  const m = crossWorld({ eventBeforeMarker: true }, noBoundary);
  assert.deepEqual(m.authority.pageEvidenceProblems(m.state), [], 'before-boundary undetected without the check');
});

test('ADDENDUM 4 broad guard: an arbitrary run-stage event relabelled phase cleanup BEFORE the marker FAILS (wrapper-install P1, an ordinary P5a event); a NON-cleanup run-stage (P5a) event is never treated as cleanup', () => {
  // the P5 event is ordinary run evidence: valid, mandatory only generically
  let w = crossWorld({ p5Event: true });
  const p5 = w.state.eventLog.find((e) => e.kind === 'p5-event');
  assert.deepEqual([p5.phase, w.authority.provenance().find((x) => x.seq === p5.seq).stage], ['P5a', 'run']);
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), []);
  w.state.eventLog = w.state.eventLog.filter((e) => e.seq !== p5.seq);
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`page-evidence-missing:event:${p5.seq}`], 'no cleanup-event-missing for a P5 source');
  // relabelled to cleanup: before the proven boundary => FAIL (never accepted as cleanup)
  for (const kind of ['p5-event', 'wrapper-install']) {
    w = crossWorld({ p5Event: true });
    const ev = w.state.eventLog.find((e) => e.kind === kind);
    assert.ok(ev.seq < w.markerSeq);
    ev.phase = 'cleanup';
    assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`cleanup-event-before-boundary:${ev.seq}`], kind);
  }
  // ... and with no proven boundary at all it is boundary-unproven (still FAIL)
  w = crossWorld({ p5Event: true });
  w.state.errorLedger.markers = [];
  const ev = w.state.eventLog.find((e) => e.kind === 'p5-event');
  ev.phase = 'cleanup';
  assert.ok(w.authority.pageEvidenceProblems(w.state).includes(`cleanup-event-boundary-unproven:${ev.seq}`));
});

test('ADDENDUM 4 (4) ordering unknown => cleanup-event-boundary-unproven:<seq>: zero cleanup markers, no errorLedger, two cleanup markers, a marker that is a Node seq / an event / a spy / a P1-phase alloc / a cleanup-STAGE alloc ordinal', () => {
  const unproven = (w) => [`cleanup-event-boundary-unproven:${w.late.seq}`];
  let w = crossWorld();
  const marker = w.state.errorLedger.markers[0];
  const cases = [
    ['zero markers', () => ({ markers: [] })],
    ['a differently named marker only', () => ({ markers: [{ ...marker, name: 'P11' }] })],
    ['two cleanup markers (same seq)', () => ({ markers: [marker, { ...marker }] })],
    ['two cleanup markers (valid + another seq)', () => ({ markers: [marker, { seq: w.nodeSeqs[0], name: 'cleanup' }] })],
    ['marker = Node-allocated seq (no page source)', () => ({ markers: [{ seq: w.nodeSeqs[0], name: 'cleanup' }] })],
    ['marker = the event\'s own seq (kind event)', () => ({ markers: [{ seq: w.late.seq, name: 'cleanup' }] })],
    ['marker = a run spy seq (kind spy, phase P1)', () => ({ markers: [{ seq: w.state.spyLedger.find((x) => x.phase === 'P1').seq, name: 'cleanup' }] })],
    ['marker = a page-local ordinal', () => ({ markers: [{ seq: w.markerOrd, name: 'cleanup' }] })],
    ['markers not an array', () => ({ markers: null })],
  ];
  for (const [name, make] of cases) {
    w = crossWorld();
    w.state.errorLedger = make();
    assert.deepEqual(w.authority.pageEvidenceProblems(w.state), unproven(w), name);
  }
  w = crossWorld();
  delete w.state.errorLedger;
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), unproven(w), 'no errorLedger');
  // the marker ordinal was allocated under P1 (not phase cleanup)
  w = crossWorld({ markerAttr: P1_ATTR });
  assert.equal(w.authority.provenance().find((x) => x.seq === w.markerSeq).phase, 'P1');
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), unproven(w), 'P1-phase marker');
  // the marker is a cleanup-STAGE alloc ordinal (drain range), not a run-stage one
  w = world(H, { cleanupEventInRun: true });
  const a = w.src.next(CLEANUP, 'alloc');
  const { delta } = w.drain();
  H.mergeCleanupDelta(w.state, w.authority.rewritePageRun(delta, { stage: 'cleanup' }));
  const aSeq = w.authority.seqOfOrdinal(a);
  assert.deepEqual([w.authority.stageOfOrdinal(a), w.authority.provenance().find((x) => x.seq === aSeq).kind], ['cleanup', 'alloc']);
  w.state.errorLedger = { markers: [{ seq: aSeq, name: 'cleanup' }] };
  const late = w.state.eventLog.find((e) => e.kind === 'late-callback');
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`cleanup-event-boundary-unproven:${late.seq}`], 'cleanup-stage marker');
  // the run-stage transfer was never staged (no run boundary): no stage => outside-drain (fail closed)
  w = crossWorld({ runStage: null });
  assert.ok(w.authority.pageEvidenceProblems(w.state).includes(`cleanup-event-outside-drain:${w.late.seq}`));
});

test('ADDENDUM 4 (4) non-vacuity: removing the unproven check / the marker qualification / the exactly-one-marker count (mutated copies) lets an unproven boundary PASS', async () => {
  const noUnproven = await mutated([[UNPROVEN_LINE, '']]);
  let w = crossWorld({}, noUnproven);
  w.state.errorLedger.markers = [];
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [], 'zero markers undetected without the unproven check');
  const noQualifier = await mutated([[MARKER_QUALIFIER, 'true']]);
  w = crossWorld({}, noQualifier);
  w.state.errorLedger.markers = [{ seq: w.state.spyLedger.find((x) => x.phase === 'P1').seq, name: 'cleanup' }];
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [], 'a spy seq accepted as the boundary without the qualification');
  const noCount = await mutated([[MARKER_COUNT, 'cleanupMarkers.length >= 1']]);
  w = crossWorld({}, noCount);
  w.state.errorLedger.markers = [w.state.errorLedger.markers[0], { seq: w.nodeSeqs[0], name: 'cleanup' }];
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [], 'two markers accepted without the exactly-one count');
  // the real harness fails all three worlds
  const corruptions = [
    (x) => [],
    (x) => [{ seq: x.state.spyLedger.find((e) => e.phase === 'P1').seq, name: 'cleanup' }],
    (x) => [x.state.errorLedger.markers[0], { seq: x.nodeSeqs[0], name: 'cleanup' }],
  ];
  for (const corrupt of corruptions) {
    w = crossWorld();
    w.state.errorLedger.markers = corrupt(w);
    assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`cleanup-event-boundary-unproven:${w.late.seq}`]);
  }
});

test('ADDENDUM 4 (5) the same event carried by BOTH the run and the cleanup transfer: a delta re-sending the run-carried event is a duplicate merge ({duplicates:1}, runPostReservation fails closed); the same seq twice in eventLog => page-evidence-duplicate + cleanup-event-duplicate', () => {
  const w = world(H, { cleanupEventInRun: true });
  const { delta } = w.drain();
  const pageLate = w.rec.events.find((e) => e.kind === 'late-callback');
  assert.ok(pageLate.seq <= w.runHw, 'a run-stage ordinal');
  const resent = { ...delta, eventLog: [...delta.eventLog, { ...pageLate }] };
  const rw = w.authority.rewritePageRun(resent, { stage: 'cleanup' });
  assert.deepEqual(w.violations, [], 'the ordinal is mapped (it was ingested by the run)');
  const lateSeq = w.authority.seqOfOrdinal(pageLate.seq);
  assert.ok(rw.eventLog.some((e) => e.seq === lateSeq));
  assert.deepEqual(H.mergeCleanupDelta(w.state, rw), { duplicates: 1 }, 'the re-sent run-carried event is reported as a duplicate merge');
  assert.equal(w.state.eventLog.filter((e) => e.seq === lateSeq).length, 1, 'exactly-once state');
  // a state holding it twice (what a merge without the exactly-once filter would produce)
  const dup = { ...w.state, eventLog: [...w.state.eventLog, { ...w.state.eventLog.find((e) => e.seq === lateSeq) }] };
  assert.deepEqual(w.authority.pageEvidenceProblems(dup), [`page-evidence-duplicate:event:${lateSeq}`, `cleanup-event-duplicate:${lateSeq}`]);
});

test('ADDENDUM 4 (6) identity/provenance mismatch of a run-stage-carried cleanup event: a forged kind => cleanup-event-identity-mismatch:<seq>; (ADDENDUM 5) an unlabeled run-carried event ordinal is refused at ingestion (no exemption)', () => {
  let w = crossWorld();
  const s = w.late.seq;
  w.state.eventLog = forgeAt(w.state.eventLog, s);
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`cleanup-event-identity-mismatch:${s}`]);
  w = crossWorld();
  const drained = w.drainedEvents()[0];
  // a drained entry re-pointed at the run-carried event's seq (identity of another source) => the run-carried slot is
  // duplicated and the drained source missing
  const swapped = { ...w.state, eventLog: w.state.eventLog.map((e) => (e === drained ? { ...e, seq: w.late.seq } : e)) };
  const p = w.authority.pageEvidenceProblems(swapped);
  assert.ok(p.includes(`cleanup-event-identity-mismatch:${w.late.seq}`), JSON.stringify(p));
  assert.ok(p.includes(`cleanup-event-missing:${drained.seq}`) && p.includes(`cleanup-event-duplicate:${w.late.seq}`), JSON.stringify(p));
  // (ADDENDUM 5) an unlabeled run-carried cleanup event is no longer exempt: the run-stage fence that carries it is
  // refused at ingestion (ONE ingest-entry-invalid), nothing of that fence is ingested -- the world stops there
  const u = world(H, { cleanupEventInRun: true, unlabeledKind: 'late-callback' });
  assert.deepEqual(u.refused, { ok: false, reason: 'ingest-entry-invalid' });
  assert.deepEqual(u.violations, ['ingest-entry-invalid']);
  const lateOrd = u.rec.events.find((e) => e.kind === 'late-callback').seq;
  assert.equal(u.authority.seqOfOrdinal(lateOrd), undefined, 'the unlabeled event ordinal was never mapped');
  assert.ok(u.src.pending().some((e) => e.ord === lateOrd && e.kind === 'event' && e.label === null));
});

test('ADDENDUM 4 (8) unsourced / leaked in the cross-boundary world: a phase-cleanup event at a Node seq or at the marker\'s alloc seq => cleanup-event-unsourced; a page-local ordinal => cleanup-event-leaked-ordinal (+ page-ordinal-leaked)', () => {
  let w = crossWorld();
  const n = w.allocator.next();
  w.state.eventLog.push({ seq: n, kind: 'late-callback', ...CLEANUP });
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`cleanup-event-unsourced:${n}`]);
  w = crossWorld();
  w.state.eventLog.push({ seq: w.markerSeq, kind: 'late-callback', ...CLEANUP });
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`cleanup-event-unsourced:${w.markerSeq}`]);
  // the run-carried event left un-rewritten (its page ordinal) => leaked, and its authoritative slot missing
  w = crossWorld();
  const ord = w.lateRow.ord;
  w.state.eventLog = w.state.eventLog.map((e) => (e.seq === w.late.seq ? { ...e, seq: ord } : e));
  const p = w.authority.pageEvidenceProblems(w.state);
  assert.deepEqual(p, [`page-evidence-missing:event:${w.late.seq}`, `cleanup-event-missing:${w.late.seq}`, `cleanup-event-leaked-ordinal:${ord}`]);
  assert.ok(H.primarySeqAllocations(w.state).problems.some((x) => x.startsWith(`page-ordinal-leaked:${ord}:eventLog[`)));
});

// ADDENDUM 4 follow-up (harness fix): the reverse loop also enters for a SEMANTIC cleanup source (run-stage `event`
// ordinal registered with phase cleanup) whose authoritative entry no longer says phase 'cleanup'.
const SEMANTIC_GATE = ["if (ev.phase !== 'cleanup' && !fromCleanupDrain && !semanticCleanupSrc) continue;", "if (ev.phase !== 'cleanup' && !fromCleanupDrain) continue;"];

test('ADDENDUM 4 regression: a run-carried cleanup event whose authoritative phase is rewritten (P11) => cleanup-event-phase-mismatch:<seq>; forged kind + P11 => phase-mismatch (first in the chain); forged kind with phase cleanup => identity-mismatch; a rewritten P5a event stays ignored', () => {
  const base = crossWorld({ p5Event: true });
  assert.deepEqual(base.authority.pageEvidenceProblems(base.state), [], 'valid cross-boundary state');
  const s = base.late.seq;
  const withLate = (w, make) => ({ ...w.state, eventLog: w.state.eventLog.map((e) => (e.seq === s ? make(e) : e)) });
  assert.deepEqual(base.authority.pageEvidenceProblems(withLate(base, (e) => ({ ...e, phase: 'P11' }))), [`cleanup-event-phase-mismatch:${s}`]);
  const forged = (phase) => (e) => ({ seq: e.seq, kind: FORGED, phase, activeCheck: null, activeControl: null });
  assert.deepEqual(base.authority.pageEvidenceProblems(withLate(base, forged('P11'))), [`cleanup-event-phase-mismatch:${s}`]);
  assert.deepEqual(base.authority.pageEvidenceProblems(withLate(base, forged('cleanup'))), [`cleanup-event-identity-mismatch:${s}`]);
  // a NON-cleanup run-stage source (P5a) with a rewritten phase is not a cleanup event: still ignored by the cleanup checks
  const p5 = base.state.eventLog.find((e) => e.kind === 'p5-event');
  const p5State = { ...base.state, eventLog: base.state.eventLog.map((e) => (e === p5 ? { ...e, phase: 'P6' } : e)) };
  assert.deepEqual(base.authority.pageEvidenceProblems(p5State), []);
});

test('ADDENDUM 4 regression non-vacuity: removing `&& !semanticCleanupSrc` (mutated harness copy) lets the phase-rewritten / forged run-carried cleanup event through', async () => {
  const pre = await mutated([SEMANTIC_GATE]);
  const w = crossWorld({}, pre);
  const s = w.late.seq;
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), []);
  for (const make of [(e) => ({ ...e, phase: 'P11' }), (e) => ({ seq: e.seq, kind: FORGED, phase: 'P11', activeCheck: null, activeControl: null })]) {
    const st = { ...w.state, eventLog: w.state.eventLog.map((e) => (e.seq === s ? make(e) : e)) };
    assert.deepEqual(w.authority.pageEvidenceProblems(st), [], 'undetected without the semantic gate');
    const f = crossWorld();
    assert.equal(f.late.seq, s);
    const fst = { ...f.state, eventLog: f.state.eventLog.map((e) => (e.seq === s ? make(e) : e)) };
    assert.deepEqual(f.authority.pageEvidenceProblems(fst), [`cleanup-event-phase-mismatch:${s}`]);
  }
});

// ---------------------------------------------------------------------------------------------
// ADDENDUM 5 (4th pass review round): (2) MARKER IDENTITY -- the runner's mark(name) allocates the marker ordinal with
// label `marker:<name>`; the boundary proof requires the single authoritative 'cleanup' marker's source ordinal to be
// kind 'alloc', label 'marker:cleanup', phase cleanup, run stage. (3) STABLE DRAIN -- g2CleanupDrain loops (<= 8 rounds)
// until the page high-water did not move across the awaited drain fence.
// ---------------------------------------------------------------------------------------------

test('ADDENDUM 5 marker identity: the simulated mark(cleanup) ordinal carries label marker:cleanup; an EARLIER cleanup-attributed run-stage alloc ordinal with a different label substituted as the marker seq => cleanup-event-boundary-unproven; a marker ordinal registered with another marker\'s label / no label => unproven', () => {
  const w = crossWorld({ preMarkerAllocLabel: 'exec:C1' });
  const mrow = w.authority.provenance().find((x) => x.seq === w.markerSeq);
  assert.deepEqual([mrow.kind, mrow.label, mrow.phase, mrow.stage], ['alloc', 'marker:cleanup', 'cleanup', 'run']);
  const sub = w.authority.provenance().find((x) => x.seq === w.preMarkerSeq);
  // the substitute looks qualifying in every respect except its identity, and it precedes the run-carried event
  assert.deepEqual([sub.kind, sub.label, sub.phase, sub.stage], ['alloc', 'exec:C1', 'cleanup', 'run']);
  assert.ok(w.preMarkerSeq < w.markerSeq && w.preMarkerSeq < w.late.seq);
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [], 'the genuine marker proves the boundary');
  w.state.errorLedger.markers = [{ seq: w.preMarkerSeq, name: 'cleanup' }];
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [`cleanup-event-boundary-unproven:${w.late.seq}`], 'substituted marker');
  // the marker ordinal itself registered under another marker's identity, or unlabeled
  for (const markerLabel of ['marker:P11', 'marker:cleanup-x', null]) {
    const x = crossWorld({ markerLabel });
    assert.equal(x.authority.provenance().find((r) => r.seq === x.markerSeq).label, markerLabel);
    assert.deepEqual(x.authority.pageEvidenceProblems(x.state), [`cleanup-event-boundary-unproven:${x.late.seq}`], String(markerLabel));
  }
});

test('ADDENDUM 5 marker identity non-vacuity: with the label term removed from the marker qualification (mutated copy) the substituted / wrongly-labelled marker proves the boundary (PASS); the real harness rejects both', async () => {
  const noLabel = await mutated([MARKER_LABEL_TERM]);
  const w = crossWorld({ preMarkerAllocLabel: 'exec:C1' }, noLabel);
  w.state.errorLedger.markers = [{ seq: w.preMarkerSeq, name: 'cleanup' }];
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [], 'substituted marker accepted without the identity term');
  const x = crossWorld({ markerLabel: 'marker:P11' }, noLabel);
  assert.deepEqual(x.authority.pageEvidenceProblems(x.state), [], 'another marker\'s label accepted without the identity term');
  const f = crossWorld({ preMarkerAllocLabel: 'exec:C1' });
  assert.equal(f.preMarkerSeq, w.preMarkerSeq, 'same deterministic seq');
  f.state.errorLedger.markers = [{ seq: f.preMarkerSeq, name: 'cleanup' }];
  assert.deepEqual(f.authority.pageEvidenceProblems(f.state), [`cleanup-event-boundary-unproven:${f.late.seq}`]);
  const y = crossWorld({ markerLabel: 'marker:P11' });
  assert.deepEqual(y.authority.pageEvidenceProblems(y.state), [`cleanup-event-boundary-unproven:${y.late.seq}`]);
});

/** Slices `[async] function <name>(...) {...}` (top-level, ends at the first `\n}\n`) out of harness text. */
function topLevelFn(text, name) {
  const head = `function ${name}(`;
  assert.equal(text.split(head).length - 1, 1, `exactly one ${head}`);
  let i = text.indexOf(head);
  if (text.slice(i - 6, i) === 'async ') i -= 6;
  const j = text.indexOf('\n}\n', i);
  assert.ok(j > i, name);
  return text.slice(i, j + 2);
}
const DRAIN_PAGE_FNS = Object.freeze(['g2PageState', 'g2FenceReport', 'g2FenceAck', 'g2NodeSync', 'g2ErrOf', 'g2CleanupDrain']);
const STABLE_CHECK = ['    if (g2FenceReport().hw === delta.pageHighWater) return { ok: true, delta, error: null };\n', '    return { ok: true, delta, error: null };\n'];

/**
 * The REAL in-page g2CleanupDrain (+ the real g2PageState / g2FenceReport / g2FenceAck / g2NodeSync / g2ErrOf it uses),
 * instantiated from the harness text (optionally mutated) over a fake `window` whose G2_NODE_SYNC_BINDING is the Node
 * drain fence of the world's authority. `inFlight(round)` runs while the fence is awaited (after the page took its
 * fence report, before Node ingests it) -- where a cleanup callback can allocate.
 */
function drainRealm(w, { inFlight = () => {}, mutate = null } = {}) {
  let text = DRAIN_PAGE_FNS.map((n) => topLevelFn(SOURCE, n)).join('\n');
  if (mutate) {
    assert.equal(text.split(mutate[0]).length - 1, 1, 'drain mutation anchor occurs exactly once');
    text = text.replace(mutate[0], () => mutate[1]);
  }
  const calls = [];
  const window = {
    __g2: { env: { recorder: w.rec, state: { stateSnapshots: w.snapshots } }, runResultHw: w.runHw, pageFatalSent: 0, seq: w.src },
    [H.G2_NODE_SYNC_BINDING]: async (action, arg) => {
      calls.push({ action, hw: arg.hw, pending: arg.pending.length });
      await Promise.resolve();
      inFlight(calls.length);
      return w.authority.ingestFence({ pending: arg.pending, hw: arg.hw });
    },
  };
  const scope = { window, PAGE_LOCAL_BASE: H.PAGE_LOCAL_BASE, G2_NODE_SYNC_BINDING: H.G2_NODE_SYNC_BINDING, g2JsonSafe: H.g2JsonSafe, truncateUtf8: H.truncateUtf8, redactEvidenceText: H.redactEvidenceText };
  const names = Object.keys(scope);
  // eslint-disable-next-line no-new-func
  const fns = new Function(...names, `'use strict';\n${text}\nreturn { g2CleanupDrain };`)(...names.map((n) => scope[n]));
  return { ...fns, calls };
}

const IN_FLIGHT = (w) => () => { w.rec.logEvent('wrapper-restore', { label: 'in-flight', layer: 'recording', ok: true }); };

test('ADDENDUM 5 stable drain (real g2CleanupDrain): an event allocated while the drain fence is in flight is carried by the NEXT round -- returned in the delta, ingested, merged; pageEvidenceProblems []; a quiet page returns after one round', async () => {
  // quiet page: one round, stable
  let w = world();
  let realm = drainRealm(w);
  let out = await realm.g2CleanupDrain();
  assert.equal(out.ok, true, JSON.stringify(out.error));
  assert.deepEqual(realm.calls.map((c) => c.action), ['drain']);
  assert.equal(out.delta.eventLog.length, 2);
  // an allocation during the first awaited fence
  w = world();
  const inFlight = IN_FLIGHT(w);
  realm = drainRealm(w, { inFlight: (round) => { if (round === 1) inFlight(); } });
  out = await realm.g2CleanupDrain();
  assert.equal(out.ok, true, JSON.stringify(out.error));
  assert.equal(realm.calls.length, 2, 'the high-water moved across round 1 => a second round');
  assert.equal(realm.calls[1].pending, 1, 'round 2 fences exactly the in-flight ordinal');
  const late = out.delta.eventLog.find((e) => e.label === 'in-flight');
  assert.ok(late, 'the in-flight event is in the returned delta');
  assert.equal(late.phase, 'cleanup');
  assert.equal(out.delta.pageHighWater, w.src.highWater());
  assert.deepEqual(w.src.pending(), [], 'everything acknowledged');
  assert.ok(Number.isSafeInteger(w.authority.seqOfOrdinal(late.seq)), 'ingested by Node');
  H.mergeCleanupDelta(w.state, w.authority.rewritePageRun(out.delta, { stage: 'cleanup' }));
  assert.deepEqual(w.violations, []);
  assert.ok(w.state.eventLog.some((e) => e.seq === w.authority.seqOfOrdinal(late.seq) && e.label === 'in-flight'));
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), []);
});

test('ADDENDUM 5 stable drain: a page that allocates during EVERY fence never stabilizes => {ok:false, error "cleanup drain did not stabilize"} after exactly 8 rounds (no delta)', async () => {
  const w = world();
  const realm = drainRealm(w, { inFlight: IN_FLIGHT(w) });
  const out = await realm.g2CleanupDrain();
  assert.deepEqual(out, { ok: false, delta: null, error: { name: 'Error', message: 'cleanup drain did not stabilize' } });
  assert.equal(realm.calls.length, 8);
  assert.ok(realm.calls.every((c) => c.action === 'drain'));
  assert.deepEqual(w.violations, [], 'each fence itself was valid; the failure is the instability');
});

test('ADDENDUM 5 stable drain non-vacuity: a mutated g2CleanupDrain that returns after ONE round (no stability check) loses the in-flight event -- absent from the delta, never ingested, still pending on the page -- and Node cannot see the loss', async () => {
  const w = world();
  const realm = drainRealm(w, { inFlight: (round) => { if (round === 1) IN_FLIGHT(w)(); }, mutate: STABLE_CHECK });
  const out = await realm.g2CleanupDrain();
  assert.equal(out.ok, true);
  assert.equal(realm.calls.length, 1);
  assert.equal(out.delta.eventLog.some((e) => e.label === 'in-flight'), false, 'lost from the delta');
  const lost = w.rec.events.find((e) => e.label === 'in-flight');
  assert.equal(w.authority.seqOfOrdinal(lost.seq), undefined, 'never ingested');
  assert.deepEqual(w.src.pending().map((e) => e.ord), [lost.seq], 'still pending on the page');
  H.mergeCleanupDelta(w.state, w.authority.rewritePageRun(out.delta, { stage: 'cleanup' }));
  assert.deepEqual(w.authority.pageEvidenceProblems(w.state), [], 'the loss is invisible to the completeness check: only the stable loop prevents it');
});
