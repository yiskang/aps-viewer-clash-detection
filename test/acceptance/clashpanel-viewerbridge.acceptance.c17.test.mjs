// test/acceptance/clashpanel-viewerbridge.acceptance.c17.test.mjs
//
// Offline tests for the C17 departure oracle (procedure §C17 V0–V7, T13/T6, E4) with mutated
// ledgers/observations, its non-vacuous control N7 (§7), and the model-argument tagger that lets V5
// see which model a fitToView / setAggregateIsolation call references (composition over the Section
// 19 recorder; identity-keyed labels, never modelId).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  c17Oracle, evaluateN7, C17_PREDICATES, C17_NOT_IN_SCENE_NOTE, createModelLabeler, modelLabelsInArgs, attachModelArgumentTagger,
  createCallRecorder, createWrapperRegistry, recordingWrap, createMonotonicEventLog, summarizeBridgeLedger, validateCheckRecord,
  checkVerdictLabel as vr,
} from './clashpanel-viewerbridge.acceptance.mjs';

const NAMES = { BEFORE_MODEL_UNLOAD: 'beforeModelUnload', MODEL_REMOVED: 'modelRemoved' };

function goodObs() {
  return {
    a1: 11,
    r0: { superseded: false, isolated: true, marked: true, fitted: false, notes: [] },
    L0: { markerMeshCount: 3, isolation: { confirmed: true, target: [{ model: 'A', ids: [11] }, { model: 'B', ids: [22] }] } },
    eventNames: NAMES,
    eventLog: [
      { seq: 0, kind: 'listener-entry', eventName: NAMES.BEFORE_MODEL_UNLOAD, modelLabel: 'B' },
      { seq: 1, kind: 'bridge-callback', modelLabel: 'B', reason: 'unload' },
      { seq: 2, kind: 'listener-exit', eventName: NAMES.BEFORE_MODEL_UNLOAD, modelLabel: 'B' },
      { seq: 3, kind: 'listener-entry', eventName: NAMES.MODEL_REMOVED, modelLabel: 'B' },
      { seq: 4, kind: 'bridge-callback', modelLabel: 'B', reason: 'removed' },
    ],
    models: { containsA: true, containsB: false },
    r1: { superseded: false, isolated: true, marked: true, fitted: true, notes: [C17_NOT_IN_SCENE_NOTE] },
    L1: { markerMeshCount: 2, isolation: { confirmed: true, target: [{ model: 'A', ids: [11] }] } },
    s4BridgeRecords: [
      { method: 'viewer.getAllModels', origin: 'bridge' },
      { method: 'viewer.setAggregateIsolation', origin: 'bridge', modelLabels: ['A'] },
      { method: 'viewer.fitToView', origin: 'bridge', modelLabels: ['A'] },
    ],
    c: { isolation: 'restored', markersRemoved: 2, notes: [] },
    post: { isolationEqualsBaseline: true, hiddenHasNonEmptyA: false, ledgerNull: true, netAddMinusRemove: { 'clash-panel-markers:g2a': 0, 'clash-panel-outlines:g2a': 0 } },
  };
}

test('C17 PASS on the conforming observation; record is a valid §10 check record with named booleans', () => {
  const r = c17Oracle(goodObs());
  assert.equal(r.record.verdict, 'PASS');
  assert.deepEqual(Object.keys(r.c17.V), ['V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7']);
  assert.ok(Object.values(r.c17.V).every(Boolean));
  assert.equal(validateCheckRecord(r.record).ok, true);
});

const mutations = {
  V1: [
    (o) => { o.eventLog = o.eventLog.filter((e) => e.eventName !== NAMES.MODEL_REMOVED); }, // absent within T6 => FAIL (E4)
    (o) => { o.eventLog.push({ seq: 9, kind: 'listener-entry', eventName: NAMES.MODEL_REMOVED, modelLabel: 'A' }); },
    (o) => { o.eventLog[0].seq = 7; }, // BU after MR
  ],
  V2: [
    (o) => { o.eventLog = o.eventLog.filter((e) => !(e.kind === 'bridge-callback' && e.reason === 'unload')); },
    (o) => { o.eventLog.push({ seq: 9, kind: 'bridge-callback', modelLabel: 'A', reason: 'removed' }); },
    (o) => { o.eventLog.push({ seq: 10, kind: 'bridge-callback', modelLabel: 'B', reason: 'removed' }); },
  ],
  V3: [(o) => { o.models.containsB = true; }, (o) => { o.models.containsA = false; }],
  V4: [
    (o) => { o.r1.notes = []; },
    (o) => { o.r1.notes = [C17_NOT_IN_SCENE_NOTE, C17_NOT_IN_SCENE_NOTE]; },
    (o) => { o.L1.markerMeshCount = 3; },
    (o) => { o.L1.isolation.target = [{ model: 'A', ids: [11] }, { model: 'B', ids: [22] }]; },
    (o) => { o.L1.isolation.target = [{ model: 'A', ids: [12] }]; },
    (o) => { o.r1.fitted = false; },
    (o) => { o.r1.superseded = true; },
  ],
  V5: [
    (o) => { o.s4BridgeRecords.push({ method: 'viewer.fitToView', origin: 'bridge', modelLabels: ['B'] }); },
    (o) => { o.s4BridgeRecords.push({ method: 'viewer.setAggregateIsolation', origin: 'bridge', modelLabels: ['A', 'B'] }); },
    (o) => { o.s4BridgeRecords.push({ method: 'viewer.setAggregateIsolation', origin: 'bridge', modelLabels: ['A'] }); }, // > 1 set
    (o) => { delete o.s4BridgeRecords[1].modelLabels; }, // untagged => invalid => false
  ],
  V6: [(o) => { o.c.isolation = 'skipped-external'; }, (o) => { o.c.markersRemoved = 3; }, (o) => { o.c.notes = ['x']; }],
  V7: [
    (o) => { o.post.isolationEqualsBaseline = false; },
    (o) => { o.post.hiddenHasNonEmptyA = true; },
    (o) => { o.post.ledgerNull = false; },
    (o) => { o.post.netAddMinusRemove['clash-panel-outlines:g2a'] = 1; },
  ],
};

test('C17 mutated ledgers/observations: each V1–V7 violation => FAIL naming exactly that predicate', () => {
  for (const [v, list] of Object.entries(mutations)) {
    for (const [i, mutate] of list.entries()) {
      const o = goodObs();
      mutate(o);
      const r = c17Oracle(o);
      assert.equal(vr(r.record), `FAIL(${v})`, `${v} mutation #${i}: ${r.record.verdict}`);
    }
  }
});

test('C17 BLOCKED paths: V0 false => BLOCKED(precondition:apply); precondition; T5 timeout (never T6)', () => {
  const o = goodObs();
  o.L0.markerMeshCount = 2;
  assert.equal(vr(c17Oracle(o).record), 'BLOCKED(precondition:apply)');
  const o2 = goodObs();
  o2.L0.isolation.target = [{ model: 'A', ids: [11] }];
  assert.equal(vr(c17Oracle(o2).record), 'BLOCKED(precondition:apply)');
  assert.equal(vr(c17Oracle(goodObs(), { preconditionUnmet: 'c16-restoration' }).record), 'BLOCKED(precondition:c16-restoration)');
  assert.equal(vr(c17Oracle(goodObs(), { timedOut: 'present' }).record), 'BLOCKED(timeout:present)');
  assert.equal(vr(c17Oracle({}).record), 'BLOCKED(precondition:apply)');
});

function preDepartureObs() {
  // A present with focus+isolate+marker while B is STILL loaded (N7 input)
  return {
    a1: 11,
    models: { containsA: true, containsB: true },
    r1: { superseded: false, isolated: true, marked: true, fitted: true, notes: [] },
    L1: { markerMeshCount: 3, isolation: { confirmed: true, target: [{ model: 'A', ids: [11] }, { model: 'B', ids: [22] }] } },
    s4BridgeRecords: [
      { method: 'viewer.setAggregateIsolation', origin: 'bridge', modelLabels: ['A', 'B'] },
      { method: 'viewer.fitToView', origin: 'bridge', modelLabels: ['A', 'B'] },
    ],
  };
}

test('N7: the same V3/V4/V5 predicates evaluate FALSE on a pre-departure present => DETECTED_RESTORED; non-vacuous', () => {
  assert.equal(C17_PREDICATES.V3(preDepartureObs()).value, false);
  assert.equal(C17_PREDICATES.V4(preDepartureObs()).value, false);
  assert.equal(C17_PREDICATES.V5(preDepartureObs()).value, false);
  assert.equal(evaluateN7({ preObs: preDepartureObs(), restored: true }).state, 'DETECTED_RESTORED');
  assert.equal(evaluateN7({ preObs: preDepartureObs(), restored: false }).state, 'RESTORE_FAILED');
  // an oracle that cannot discriminate (predicate true while B still loaded) => NOT_DETECTED
  const o = preDepartureObs(); o.models.containsB = false;
  assert.equal(evaluateN7({ preObs: o, restored: true }).state, 'NOT_DETECTED');
  // invalid input can never make the control pass (untagged spy records => V5 invalid)
  const u = preDepartureObs(); u.s4BridgeRecords = u.s4BridgeRecords.map(({ modelLabels, ...rest }) => rest);
  assert.equal(evaluateN7({ preObs: u, restored: true }).state, 'NOT_DETECTED');
  assert.equal(evaluateN7({ preObs: {}, restored: true }).state, 'NOT_DETECTED');
  assert.equal(evaluateN7({ timedOut: true }).state, 'TIMED_OUT');
  assert.equal(evaluateN7({ executable: false }).state, 'NOT_EXECUTABLE');
});

test('model tagger: identity-keyed labels from raw args of per-model and aggregate forms; recorder unchanged otherwise; detach restores', () => {
  const A = { id: 1 }; const B = { id: 1 }; // same modelId, different identity
  const labelOf = createModelLabeler({ A, B });
  assert.equal(labelOf(A), 'A');
  assert.equal(labelOf(B), 'B');
  assert.equal(labelOf({ id: 1 }), null);
  assert.deepEqual(modelLabelsInArgs([[5], B, true], labelOf), ['B']);
  assert.deepEqual(modelLabelsInArgs([[{ model: B, selection: [1] }, { model: A, selection: [2] }], undefined, true], labelOf), ['A', 'B']);
  const recorder = createCallRecorder();
  const registry = createWrapperRegistry();
  const viewer = { fitToView() { return 'ok'; }, setAggregateIsolation() {}, other() {} };
  for (const m of ['fitToView', 'setAggregateIsolation', 'other']) recordingWrap(viewer, m, { recorder, registry, label: `viewer.${m}` });
  const tagger = attachModelArgumentTagger(recorder, { labelOf });
  assert.throws(() => attachModelArgumentTagger(recorder, { labelOf }));
  recorder.withOrigin('bridge', () => {
    assert.equal(viewer.fitToView([{ model: A, selection: [1] }], undefined, true), 'ok');
    viewer.setAggregateIsolation([{ model: B, ids: [2, 3] }, { model: A, ids: [] }]);
    viewer.other(B);
  });
  assert.deepEqual(recorder.records[0].modelLabels, ['A']);
  assert.deepEqual(recorder.records[1].modelLabels, ['A', 'B']);
  assert.deepEqual(recorder.records[1].isolationEntries, [{ model: 'B', idsLength: 2 }, { model: 'A', idsLength: 0 }]);
  assert.equal('modelLabels' in recorder.records[2], false);
  assert.equal(recorder.records[0].origin, 'bridge');
  tagger.detach();
  viewer.fitToView([{ model: A, selection: [1] }]);
  assert.equal('modelLabels' in recorder.records[3], false);
});

test('monotonic event log and ledger summary', () => {
  let t = 0;
  const log = createMonotonicEventLog({ clock: { monotonicMs: () => t++ } });
  log.push({ kind: 'listener-entry', eventName: 'x', modelLabel: 'B' });
  log.push({ kind: 'bridge-callback', modelLabel: 'B', reason: 'unload' });
  assert.deepEqual(log.entries.map((e) => [e.seq, e.t]), [[0, 0], [1, 1]]);
  assert.throws(() => log.push({ kind: 'other' }));
  const A = {}; const labelOf = createModelLabeler({ A });
  assert.deepEqual(summarizeBridgeLedger({ markerMeshes: [{}, {}], isolation: { confirmed: true, target: [{ model: A, ids: [3] }] } }, labelOf), { markerMeshCount: 2, isolation: { confirmed: true, target: [{ model: 'A', ids: [3] }] } });
  assert.equal(summarizeBridgeLedger(null, labelOf), null);
});
