// test/acceptance/clashpanel-viewerbridge.acceptance.oracles.test.mjs
//
// Offline tests for the Task 4 pure oracles and check-record machinery (procedure §6, §10):
// check/control record constructors and validators, the T13 marker-count helper (contract-derived
// from clashpanel/viewer/markers.js), the C4 containment oracle boundary behaviour (E1), the C6/C8
// frustum/projection helpers (T16, E2) and camera-settle rule (T4), the C2 title-element contract
// (page-portable), and the pure evaluators of C1, C3, C5, C7β, C9–C16, C18a, C19 (+ markers-only
// v1 / zero-theming). No Viewer, no browser, no network.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTENT } from '../../clashpanel/core/intents.js';
import {
  TABLE_T, CHECK_NAMES, computeOverall, checkVerdictBase, validateResultSchema,
  makeCheckRecord, validateCheckRecord, makeControlRecord, validateControlRecord, mergeCheckRecord, combineSubchecks,
  normalizeEvidence, expectedMarkerMeshCount,
  C4_OUTCOME, boundsContainmentOracle, c4ReferenceUnion, selectC4Sample, evaluateC4,
  mat4MulVec4, cameraSample, cameraFromSample, frustumPredicate, cameraSamplesWithin, cameraSamplesExactlyEqual, findSettleIndex,
  waitForCameraSettle, isAggregateFitRecord, isPerModelFitRecord, evaluateC6, evaluateN2, evaluateC8,
  titleElementContract, evaluateC2, evaluateC3, C2_REGION_ORDER,
  PANEL_SHOWN_INTENT_VALUE, PANEL_HIDDEN_INTENT_VALUE, countC2DomainWrites, buildPageAgentSource,
  evaluateC1, evaluateC5, evaluateC7Beta, evaluateSceneOwnership, SCENE_CLASS, evaluateC9, evaluateC10, evaluateC11, evaluateN5,
  evaluateC12, evaluateN4, evaluateC13, evaluateC14, evaluateC15, evaluateC16, evaluateC18a, evaluateC19,
  markersOnlyV1Violations, THEMING_SET_METHOD, C15_FIRST_ONLY_NOTE, C15_RESTORE_FAILED_NOTE,
  checkVerdictLabel as vr,
} from './clashpanel-viewerbridge.acceptance.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

// ---- records -------------------------------------------------------------------------------

test('check records: BASE(reason) form read by checkVerdictBase; PASS has no reason; validator is fail-closed', () => {
  const r = makeCheckRecord({ verdict: 'BLOCKED', reason: 'timeout:present', fields: { a: undefined, n: NaN }, evidence: { x: new Float32Array([1, 2]) } });
  assert.equal(vr(r), 'BLOCKED(timeout:present)');
  assert.equal(checkVerdictBase(r), 'BLOCKED');
  assert.deepEqual(r.fields, { a: null, n: 'NaN' });
  assert.deepEqual(r.evidence, { x: [1, 2] });
  assert.equal(validateCheckRecord(r).ok, true);
  assert.equal(makeCheckRecord({ verdict: 'PASS' }).verdict, 'PASS');
  assert.throws(() => makeCheckRecord({ verdict: 'PASS', reason: 'x' }));
  assert.throws(() => makeCheckRecord({ verdict: 'OK' }));
  assert.throws(() => makeCheckRecord({ verdict: 'FAIL', reason: 'a(b)' }));
  assert.throws(() => normalizeEvidence(new Map()));
  assert.equal(validateCheckRecord({ ...r, verdict: 'BLOCKED(other)' }).ok, false);
  assert.equal(validateCheckRecord({ ...r, extra: 1 }).ok, false);
  assert.equal(validateCheckRecord({ verdict: 'PASS', reason: 'x', fields: {}, evidence: {} }).ok, false);
});

test('control records: only §7-allowed states; validator exact keys', () => {
  assert.equal(validateControlRecord('N2', makeControlRecord('N2', 'NOT_DISCRIMINATING')).ok, true);
  assert.throws(() => makeControlRecord('N1', 'NOT_EXECUTABLE'));
  assert.throws(() => makeControlRecord('N9', 'DETECTED'));
  assert.equal(validateControlRecord('N6', { state: 'DETECTED', fields: {} }).ok, false);
});

test('taint rule: a recorded FAIL is never erased by a later BLOCKED; sub-check combination takes the worst base', () => {
  const fail = makeCheckRecord({ verdict: 'FAIL', reason: 'x' });
  const blocked = makeCheckRecord({ verdict: 'BLOCKED', reason: 'session-tainted:P7' });
  assert.equal(mergeCheckRecord(fail, blocked), fail);
  assert.equal(mergeCheckRecord(blocked, fail), fail);
  const pass = makeCheckRecord({ verdict: 'PASS' });
  const ne = makeCheckRecord({ verdict: 'NOT_EVIDENCED', reason: 'n' });
  assert.equal(combineSubchecks({ a: pass, b: pass }).verdict, 'PASS');
  assert.equal(vr(combineSubchecks({ a: pass, b: ne })), 'NOT_EVIDENCED(b:n)');
  assert.equal(vr(combineSubchecks({ a: ne, b: blocked })), 'BLOCKED(b:session-tainted:P7)');
  assert.equal(vr(combineSubchecks({ a: fail, b: blocked })), 'FAIL(a:x)');
  assert.equal(vr(combineSubchecks({ a: pass, b: null })), 'BLOCKED(sub-check-missing:b)');
});

test('T13 is derived from markers.js: location once per present + one outline per outlined side (Hard 3/2, Soft 5)', () => {
  assert.equal(expectedMarkerMeshCount({ variant: 'hard', outlinedSides: 2 }), 3);
  assert.equal(expectedMarkerMeshCount({ variant: 'hard', outlinedSides: 1 }), 2); // C17 V4, C20 A3
  assert.equal(expectedMarkerMeshCount({ variant: 'soft', outlinedSides: 2 }), 5);
  assert.equal(expectedMarkerMeshCount({ variant: 'hard', outlinedSides: 2 }), TABLE_T.T13.hard.totalForTwoSides);
  assert.equal(expectedMarkerMeshCount({ variant: 'soft', outlinedSides: 2 }), TABLE_T.T13.soft.totalForTwoSides);
  assert.throws(() => expectedMarkerMeshCount({ variant: 'soft', outlinedSides: 3 }));
  // Source evidence: addLocation pushes 1 (Hard) or 2 spheres + 1 line (Soft); addOutlines one line per valid side.
  const src = readFileSync(path.join(REPO, 'clashpanel/viewer/markers.js'), 'utf8');
  assert.match(src, /out\.push\(add\(sphere\(s\.soft, cp\.first[\s\S]*?out\.push\(add\(sphere\(s\.soft, cp\.second[\s\S]*?out\.push\(add\(lineThrough/);
  assert.match(src, /sides\.forEach\(\(side, i\) => \{[\s\S]*?meshes\.push\(add\(lineThrough\(boxEdgePath\(box\)/);
  const bridge = readFileSync(path.join(REPO, 'clashpanel/viewer/ViewerBridge.js'), 'utf8');
  assert.equal((bridge.match(/markers\.addLocation\(/g) || []).length, 1);
});

// ---- C4 ------------------------------------------------------------------------------------

const S = (b, r) => Math.max(Math.abs(b), Math.abs(r), 2 ** -126);

test('C4: contained / near-tolerance / not-contained at the exact A_a and T_a boundaries (strict >)', () => {
  const r = [0, 0, 0, 1024, 1024, 1024];
  // S_x = 1024 -> A = 16*2^-24*1024 = 2^-10, T = 2^-10*1024 = 1
  const A = 16 * 2 ** -24 * 1024;
  const T = 2 ** -10 * 1024;
  assert.equal(boundsContainmentOracle({ candidate: r, reference: r }).outcome, C4_OUTCOME.CONTAINED);
  assert.equal(boundsContainmentOracle({ candidate: [0, 0, 0, 1024 - A, 1024, 1024], reference: r }).outcome, C4_OUTCOME.CONTAINED); // d == A
  assert.equal(boundsContainmentOracle({ candidate: [0, 0, 0, 1024 - 2 * A, 1024, 1024], reference: r }).outcome, C4_OUTCOME.NEAR_TOLERANCE);
  assert.equal(boundsContainmentOracle({ candidate: [0, 0, 0, 1024 - T, 1024, 1024], reference: r }).outcome, C4_OUTCOME.NEAR_TOLERANCE); // d == T
  assert.equal(boundsContainmentOracle({ candidate: [0, 0, 0, 1024 - 2 * T, 1024, 1024], reference: r }).outcome, C4_OUTCOME.NOT_CONTAINED);
  assert.equal(boundsContainmentOracle({ candidate: [T * 2, 0, 0, 1024, 1024, 1024], reference: r }).outcome, C4_OUTCOME.NOT_CONTAINED); // min face
  // extent excess is observation only, never FAIL
  const ex = boundsContainmentOracle({ candidate: [-500, 0, 0, 5000, 1024, 1024], reference: r });
  assert.equal(ex.outcome, C4_OUTCOME.CONTAINED);
  assert.equal(ex.hasExcess, true);
  assert.equal(S(1, 2), 2);
});

test('C4 clause precedence: non-finite -> out-of-range -> no-bounds -> no-reference -> containment', () => {
  const r = [0, 0, 0, 1, 1, 1];
  assert.equal(boundsContainmentOracle({ candidate: [NaN, 0, 0, 1, 1, 1], reference: [0, 0, 0, 2 ** 901, 1, 1] }).outcome, C4_OUTCOME.NON_FINITE);
  assert.equal(boundsContainmentOracle({ candidate: [0, 0, 0, Infinity, 1, 1], reference: r }).outcome, C4_OUTCOME.NON_FINITE);
  assert.equal(boundsContainmentOracle({ candidate: [2, 0, 0, 1, 1, 1], reference: r }).outcome, C4_OUTCOME.NON_FINITE); // inverted
  assert.equal(boundsContainmentOracle({ candidate: [0, 0, 0, 1, 1], reference: r }).outcome, C4_OUTCOME.NON_FINITE); // malformed
  assert.equal(boundsContainmentOracle({ candidate: [0, 0, 0, 2 ** 900 * 2, 1, 1], reference: r }).outcome, C4_OUTCOME.OUT_OF_RANGE);
  assert.equal(boundsContainmentOracle({ candidate: [0, 0, 0, 2 ** 900, 1, 1], reference: [0, 0, 0, 2 ** 900, 1, 1] }).outcome, C4_OUTCOME.CONTAINED);
  assert.equal(boundsContainmentOracle({ candidate: null, reference: r }).outcome, C4_OUTCOME.NO_BOUNDS);
  assert.equal(boundsContainmentOracle({ candidate: null, reference: null }).outcome, C4_OUTCOME.NO_REFERENCE);
  assert.equal(boundsContainmentOracle({ candidate: r, reference: null }).outcome, C4_OUTCOME.NO_REFERENCE);
  assert.notEqual(C4_OUTCOME.OUT_OF_RANGE, C4_OUTCOME.NON_FINITE);
});

test('C4 reference union, T10 sample and check aggregation (FAIL > NOT_EVIDENCED/empty > PASS)', () => {
  assert.deepEqual(c4ReferenceUnion([[0, 0, 0, 1, 1, 1], [-1, 0.5, 0, 0.5, 2, 1]]).box, [-1, 0, 0, 1, 2, 1]);
  assert.equal(c4ReferenceUnion([]).problem, 'empty-fragment-list');
  assert.equal(c4ReferenceUnion([[0, 0, 0, 1, 1, 1], null]).problem, 'unreadable-fragment-bounds');
  const cands = Array.from({ length: 30 }, (_, i) => ({ dbId: i + 1 }));
  const sample = selectC4Sample(cands, cands.slice(0, 5));
  assert.equal(sample.length, 25);
  assert.deepEqual(sample[20], { model: 'B', dbId: 1 });
  const box = [0, 0, 0, 1, 1, 1];
  const ok = { model: 'A', dbId: 1, candidate: box, fragmentBoxes: [box] };
  assert.equal(evaluateC4({ rows: [ok] }).record.verdict, 'PASS');
  assert.equal(vr(evaluateC4({ rows: [] }).record), 'NOT_EVIDENCED(empty-sample)');
  assert.equal(vr(evaluateC4({ rows: [ok, { model: 'B', dbId: 2, candidate: box, fragmentBoxes: [] }] }).record), 'NOT_EVIDENCED(no-reference)');
  const bad = { model: 'B', dbId: 3, candidate: [0, 0, 0, 0.5, 1, 1], fragmentBoxes: [box] };
  const res = evaluateC4({ rows: [ok, { model: 'B', dbId: 2, candidate: box, fragmentBoxes: [] }, bad] });
  assert.equal(vr(res.record), 'FAIL(not-contained)');
  assert.equal(res.c4Table.length, 3);
  assert.deepEqual(Object.keys(res.c4Table[2]).sort(), ['candidateBox', 'dbId', 'detail', 'excess', 'fragmentCount', 'model', 'outcome', 'perAxis', 'referenceBox', 'referenceProblem']);
  assert.equal(validateCheckRecord(res.record).ok, true);
});

// ---- frustum / camera ----------------------------------------------------------------------

const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const ortho = (s, tx = 0) => ({ matrixWorldInverse: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -tx, 0, 0, 1], projectionMatrix: [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1] });

test('projection is column-major P·V·p; frustum predicate uses ε = T16 relative to clip.w', () => {
  assert.deepEqual(mat4MulVec4(IDENT, [1, 2, 3, 1]), [1, 2, 3, 1]);
  const cam = ortho(0.5);
  const inside = frustumPredicate({ camera: cam, boxes: [[-2, -2, -2, 2, 2, 2]] });
  assert.equal(inside.pass, true);
  assert.equal(inside.corners.length, 8);
  const eps = TABLE_T.T16.frustumEpsilon;
  assert.equal(frustumPredicate({ camera: cam, boxes: [[0, 0, 0, 2 * (1 + eps), 1, 1]] }).pass, true);
  assert.equal(frustumPredicate({ camera: cam, boxes: [[0, 0, 0, 2 * (1 + 2 * eps), 1, 1]] }).pass, false);
  const K = cameraSample(cam);
  assert.equal(K.length, 32);
  assert.deepEqual(cameraFromSample(K), cam);
  assert.equal(frustumPredicate({ camera: K, boxes: [[-2, -2, -2, 2, 2, 2]] }).pass, true);
  // w <= 0 never passes
  const behind = { matrixWorldInverse: IDENT, projectionMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0] };
  const pb = frustumPredicate({ camera: behind, boxes: [[0, 0, 1, 1, 1, 2]] });
  assert.equal(pb.pass, false);
  assert.equal(pb.worstExcess, null);
  assert.equal(frustumPredicate({ camera: { matrixWorldInverse: [1], projectionMatrix: IDENT }, boxes: [[0, 0, 0, 1, 1, 1]] }).evaluable, false);
  assert.equal(frustumPredicate({ camera: cam, boxes: [[0, 0, 0, NaN, 1, 1]] }).evaluable, false);
});

test('camera settle (T4): two consecutive samples within 1e-9; K equality (T19) is exact', () => {
  const a = cameraSample(ortho(1));
  const b = a.map((v, i) => (i === 0 ? v + 5e-10 : v));
  const c = a.map((v, i) => (i === 0 ? v + 1e-8 : v));
  assert.equal(cameraSamplesWithin(a, b), true);
  assert.equal(cameraSamplesWithin(a, c), false);
  assert.equal(cameraSamplesExactlyEqual(a, b), false);
  assert.equal(cameraSamplesExactlyEqual(a, [...a]), true);
  assert.equal(findSettleIndex([c, a, b]), 2);
  assert.equal(findSettleIndex([a, c, a]), -1);
});

test('waitForCameraSettle: settles on two equal frames; T4 deadline => timed-out (fake timers)', async () => {
  const seq = [ortho(1), ortho(0.9), ortho(0.8), ortho(0.8)];
  let k = 0;
  const settled = await waitForCameraSettle({ sampleCamera: () => seq[Math.min(k++, seq.length - 1)], waitFrame: () => Promise.resolve() });
  assert.equal(settled.status, 'settled');
  assert.equal(settled.sampleCount, 4);
  let fire = null;
  const timers = { setTimeout: (fn) => { fire = fn; return 1; }, clearTimeout: () => {} };
  let n = 0;
  const moving = waitForCameraSettle({ sampleCamera: () => ortho(1 + n++), waitFrame: () => new Promise((r) => setImmediate(r)), timers });
  await new Promise((r) => setImmediate(r));
  fire();
  assert.equal((await moving).status, 'timed-out');
});

const rec = (method, argSummaries, extra = {}) => ({ method, origin: 'bridge', argSummaries, outcome: { threw: false }, callIndex: 0, ...extra });
const aggArg = { kind: 'array', length: 2, items: [{ kind: 'object', keys: ['model', 'selection'] }, { kind: 'object', keys: ['model', 'selection'] }] };
const idsArg = { kind: 'array', length: 1, items: [{ kind: 'number', value: 5 }] };

test('fitToView form recognition from spy summaries: aggregate needs key `selection` (never `ids`)', () => {
  assert.equal(isAggregateFitRecord(rec('viewer.fitToView', [aggArg])), true);
  assert.equal(isAggregateFitRecord(rec('viewer.fitToView', [{ kind: 'array', length: 1, items: [{ kind: 'object', keys: ['ids', 'model'] }] }])), false);
  assert.equal(isPerModelFitRecord(rec('viewer.fitToView', [idsArg, { kind: 'object', keys: [] }])), true);
  assert.equal(isPerModelFitRecord(rec('viewer.fitToView', [aggArg])), false);
});

test('C6 + N2: PASS only with the aggregate form, fitted, all corners in and N2 discriminating; FAIL only if N2 discriminates', () => {
  const union = [[-2, -2, -2, 0, 0, 0], [0, 0, 0, 2, 2, 2]];
  const wide = { status: 'settled', camera: cameraSample(ortho(0.4)) };
  const narrow = { status: 'settled', camera: cameraSample(ortho(0.4, 3)) };
  const base = { pairSelected: true, present: { outcome: { fitted: true } }, fitRecords: [rec('viewer.fitToView', [aggArg])], settle: wide, boxes: union };
  const n2 = evaluateN2({ singleFit: {}, settle: narrow, boxes: union, restored: true });
  assert.equal(n2.state, 'DETECTED_RESTORED');
  assert.equal(evaluateC6({ ...base, n2State: n2.state }).verdict, 'PASS');
  assert.equal(evaluateN2({ singleFit: {}, settle: wide, boxes: union, restored: true }).state, 'NOT_DISCRIMINATING');
  assert.equal(vr(evaluateC6({ ...base, n2State: 'NOT_DISCRIMINATING' })), 'NOT_EVIDENCED(n2-not-discriminating)');
  assert.equal(vr(evaluateC6({ ...base, settle: narrow, n2State: 'DETECTED_RESTORED' })), 'FAIL(corner-outside-frustum)');
  assert.equal(vr(evaluateC6({ ...base, settle: narrow, n2State: 'NOT_DISCRIMINATING' })), 'NOT_EVIDENCED(n2-not-discriminating)');
  assert.equal(vr(evaluateC6({ ...base, fitRecords: [], n2State: 'DETECTED_RESTORED' })), 'FAIL(aggregate-selection-form-not-observed)');
  assert.equal(vr(evaluateC6({ ...base, fitRecords: [rec('viewer.fitToView', [aggArg], { outcome: { threw: true } })], n2State: 'DETECTED_RESTORED' })), 'FAIL(aggregate-form-threw)');
  assert.equal(vr(evaluateC6({ ...base, settle: { status: 'timed-out' }, n2State: 'DETECTED_RESTORED' })), 'BLOCKED(timeout:camera-settle)');
  assert.equal(vr(evaluateC6({ ...base, present: { timedOut: true } })), 'BLOCKED(timeout:present)');
  assert.equal(vr(evaluateC6({ pairSelected: false })), 'NOT_EVIDENCED(no-discriminating-pair)');
  assert.equal(evaluateN2({ singleFit: { timedOut: true } }).state, 'TIMED_OUT');
  assert.equal(evaluateN2({ singleFit: {}, settle: narrow, boxes: union, restored: false }).state, 'RESTORE_FAILED');
  assert.equal(evaluateN2({ singleFit: { threw: true }, settle: narrow, boxes: union, restored: true }).state, 'NOT_DETECTED');
});

test('C8: per-model form, element framed, superseded focus must leave P2 framed', () => {
  const perModel = [rec('viewer.fitToView', [idsArg, { kind: 'object', keys: [] }])];
  const box = [-1, -1, -1, 1, 1, 1];
  const good = { status: 'settled', camera: cameraSample(ortho(0.5)) };
  const off = { status: 'settled', camera: cameraSample(ortho(0.5, 10)) };
  const base = { present: { outcome: { fitted: true } }, fitRecords: perModel, settle: good, box, supersession: { settle: good, box } };
  assert.equal(evaluateC8(base).verdict, 'PASS');
  assert.equal(vr(evaluateC8({ ...base, supersession: { settle: off, box } })), 'FAIL(superseded-focus-overwrote-p2)');
  assert.equal(vr(evaluateC8({ ...base, settle: off })), 'FAIL(element-outside-frustum)');
  assert.equal(vr(evaluateC8({ ...base, fitRecords: [] })), 'FAIL(per-model-fit-form-not-observed)');
  assert.equal(vr(evaluateC8({ ...base, supersession: null })), 'BLOCKED(supersession-not-observed)');
});

// ---- C2 / C3 -------------------------------------------------------------------------------

function fakeDom() {
  const el = (tag, className = '') => {
    const node = { nodeType: 1, tagName: tag, className, children: [], parent: null };
    node.appendChild = (c) => { c.parent = node; node.children.push(c); return c; };
    node.contains = (c) => { for (let x = c; x; x = x.parent) if (x === node) return true; return false; };
    node.getElementsByTagName = () => { const out = []; const walk = (n) => { for (const c of n.children) { out.push(c); walk(c); } }; walk(node); return out; };
    return node;
  };
  return el;
}

test('C2 (vi) title-element contract: one createTitleBar call, attached, unique class; no fallback; page-portable', () => {
  const el = fakeDom();
  const container = el('DIV', 'docking-panel');
  const T = container.appendChild(el('DIV', 'docking-panel-title'));
  container.appendChild(el('DIV', 'clash-panel-body'));
  assert.deepEqual(titleElementContract([T], container), { ok: true, reason: null, calls: 1, className: 'docking-panel-title', tagName: 'DIV', sameClassCount: 1 });
  assert.equal(titleElementContract([], container).reason, 'no-createTitleBar-call');
  assert.equal(titleElementContract([T, T], container).reason, 'multiple-createTitleBar-calls');
  assert.equal(titleElementContract([el('DIV', 'x')], container).reason, 'title-not-attached');
  assert.equal(titleElementContract(['text'], container).reason, 'createTitleBar-returned-non-element');
  container.appendChild(el('DIV', 'docking-panel-title'));
  assert.equal(titleElementContract([T], container).reason, 'duplicate-title-class');
  // page-portable: the serialized source evaluates standalone with the same behaviour
  const portable = new Function(`return (${titleElementContract.toString()})`)();
  assert.equal(portable([T], container).reason, 'duplicate-title-class');
});

const c2ok = () => ({
  threw: false, containerFound: true, containerUnderViewer: true, regions: C2_REGION_ORDER.map((region) => ({ region, hasHeading: true, hasBody: true })),
  addVisibilityListenerCalls: 1, bodyChildCount: 1, title: { ok: true, reason: null }, baseInitializeCalls: 0, setVisibleFalseBeforeListener: true,
  dispatchesDuringConstruction: 0, domainWrites: 0, shellKeys: ['show', 'hide', 'toggle', 'isVisible', 'dispose'],
});

test('C2: PASS iff clauses (i)–(viii); base initialize count is recorded only', () => {
  assert.equal(evaluateC2(c2ok()).verdict, 'PASS');
  assert.equal(evaluateC2({ ...c2ok(), baseInitializeCalls: 1 }).verdict, 'PASS');
  assert.equal(vr(evaluateC2({ ...c2ok(), regions: [...c2ok().regions].reverse() })), 'FAIL(iii)');
  assert.equal(vr(evaluateC2({ ...c2ok(), title: { ok: false, reason: 'duplicate-title-class' } })), 'FAIL(vi:duplicate-title-class)');
  assert.equal(vr(evaluateC2({ ...c2ok(), shellKeys: ['show'] })), 'FAIL(viii)');
  assert.equal(evaluateC2({}).reason.split(',').length, 8);
});

test('C3: exactly 3 show/hide repetitions with one dispatch each, idempotent dispose, no residue', () => {
  const rep = { showSetVisibleTrue: true, showDispatches: ['panel/shown'], hideDispatches: ['panel/hidden'] };
  const dispose = { uninitializeCalls: 1, containerInDom: false, rootFound: false, byIdFound: false, retainedCallbackDispatches: 0, setVisibleAfterUninitialize: 0, postDisposeSpyCalls: 0, postDisposeIsVisible: false };
  const ok = { showHide: [rep, rep, rep], dispose, residue: [] };
  assert.equal(evaluateC3(ok).verdict, 'PASS');
  assert.equal(vr(evaluateC3({ ...ok, showHide: [rep, rep] })), 'FAIL(repetitions)');
  assert.equal(vr(evaluateC3({ ...ok, showHide: [rep, rep, { ...rep, hideDispatches: ['panel/hidden', 'panel/hidden'] }] })), 'FAIL(repetitions)');
  assert.equal(vr(evaluateC3({ ...ok, dispose: { ...dispose, uninitializeCalls: 2 } })), 'FAIL(dispose)');
  assert.equal(vr(evaluateC3({ ...ok, residue: [{ node: 'div' }] })), 'FAIL(residue)');
  // wrong-kind visibility intent must still FAIL
  assert.equal(vr(evaluateC3({ ...ok, showHide: [rep, rep, { ...rep, showDispatches: ['panel/hidden'] }] })), 'FAIL(repetitions)');
});

test('C3 regression: real product INTENT values PASS; the old symbolic NAMES FAIL (name/value defect)', () => {
  const dispose = { uninitializeCalls: 1, containerInDom: false, rootFound: false, byIdFound: false, retainedCallbackDispatches: 0, setVisibleAfterUninitialize: 0, postDisposeSpyCalls: 0, postDisposeIsVisible: false };
  const mk = (shown, hidden) => ({ showHide: [1, 2, 3].map(() => ({ showSetVisibleTrue: true, showDispatches: [shown], hideDispatches: [hidden] })), dispose, residue: [] });
  assert.equal(evaluateC3(mk(INTENT.PANEL_SHOWN, INTENT.PANEL_HIDDEN)).verdict, 'PASS');
  assert.equal(vr(evaluateC3(mk('PANEL_SHOWN', 'PANEL_HIDDEN'))), 'FAIL(repetitions)');
});

test('C2 regression (viii): panel-visibility intent VALUES are not domain writes; names and other intents are', () => {
  assert.equal(countC2DomainWrites([INTENT.PANEL_SHOWN, INTENT.PANEL_HIDDEN]), 0);
  assert.equal(countC2DomainWrites(['PANEL_SHOWN', 'PANEL_HIDDEN']), 2);
  assert.equal(countC2DomainWrites([INTENT.PANEL_SHOWN, INTENT.NAV_NEXT, '<non-intent>']), 2);
  assert.equal(countC2DomainWrites([]), 0);
  // observation path: a benign construction-time visibility dispatch reports 0 domain writes to clause (viii)
  const obs = { ...c2ok(), dispatchesDuringConstruction: 1, domainWrites: countC2DomainWrites([INTENT.PANEL_SHOWN]) };
  assert.equal(vr(evaluateC2(obs)), 'FAIL(vii)');
  // page portability: helper survives the page agent's verbatim shipping and works with only prelude constants
  const portable = new Function('PANEL_SHOWN_INTENT_VALUE', 'PANEL_HIDDEN_INTENT_VALUE', `return (${countC2DomainWrites.toString()})`)(PANEL_SHOWN_INTENT_VALUE, PANEL_HIDDEN_INTENT_VALUE);
  assert.equal(portable([INTENT.PANEL_SHOWN]), 0);
});

test('drift guard: harness panel-visibility intent constants equal the product INTENT values; harness imports no product module', () => {
  assert.equal(PANEL_SHOWN_INTENT_VALUE, INTENT.PANEL_SHOWN);
  assert.equal(PANEL_HIDDEN_INTENT_VALUE, INTENT.PANEL_HIDDEN);
  const src = readFileSync(path.join(HERE, 'clashpanel-viewerbridge.acceptance.mjs'), 'utf8');
  assert.equal(/from\s+['"][^'"]*clashpanel\/core\/intents/.test(src), false);
});

test('bounded static guard: no quoted product INTENT key NAME is used as a dispatched-intent literal in the G2 harness', () => {
  const src = readFileSync(path.join(HERE, 'clashpanel-viewerbridge.acceptance.mjs'), 'utf8');
  const names = Object.keys(INTENT);
  const hits = [];
  for (const n of names) {
    const re = new RegExp(`['"]${n}['"]`, 'g');
    if (re.test(src)) hits.push(n);
  }
  assert.deepEqual(hits, []);
});

test('C2 probe wiring guard: domainWrites is derived from the construction dispatches via countC2DomainWrites', () => {
  const src = readFileSync(path.join(HERE, 'clashpanel-viewerbridge.acceptance.mjs'), 'utf8');
  assert.ok(src.includes('domainWrites: countC2DomainWrites(constructionDispatches),'));
  assert.ok(src.includes('const constructionDispatches = dispatched.slice(dMark);'));
});

test('page agent ships the C2/C3 intent constants and helper into the page', () => {
  const harness = readFileSync(path.join(HERE, 'clashpanel-viewerbridge.acceptance.mjs'), 'utf8');
  const agent = buildPageAgentSource(harness).source;
  assert.ok(agent.includes("'panel/shown'") && agent.includes("'panel/hidden'") && agent.includes('countC2DomainWrites'));
  assert.equal(agent.includes("'PANEL_SHOWN'"), false);
});

// ---- remaining evaluators ------------------------------------------------------------------

test('C1: classifier/load/count unmet => BLOCKED(prerequisite), never FAIL; unit mismatch is a finding', () => {
  const m = { loaded: true, classification: 'CONFIRMED_SVF2', inAllModels: true, unitScale: 0.3048, unitString: 'ft' };
  assert.equal(evaluateC1({ A: m, B: m, loadedCount: 2 }).verdict, 'PASS');
  const mm = evaluateC1({ A: m, B: { ...m, unitScale: 1, unitString: 'm' }, loadedCount: 2 });
  assert.equal(mm.verdict, 'PASS');
  assert.equal(mm.fields.unitScaleMismatchFinding, true);
  // RC1-C1 C1 reason contract: normalized reason only; detail in fields.blockDetail (A, B, then model-independent).
  const cls = evaluateC1({ A: m, B: { ...m, classification: 'CONTRADICTORY' }, loadedCount: 2 });
  assert.deepEqual([cls.verdict, cls.reason], ['BLOCKED', 'prerequisite']);
  assert.deepEqual(cls.fields.blockDetail, [{ cause: 'classifier', model: 'B', observed: 'CONTRADICTORY' }]);
  const nl = evaluateC1({ A: m, B: { loaded: false }, loadedCount: 1 });
  assert.deepEqual([nl.verdict, nl.reason], ['BLOCKED', 'prerequisite']);
  assert.deepEqual(nl.fields.blockDetail, [{ cause: 'model-not-loaded', model: 'B', observed: null }, { cause: 'model-count', model: null, observed: '1' }]);
  const rej = evaluateC1({ A: { loaded: false, loadStatus: 'failed' }, B: m, loadedCount: 1 });
  assert.equal(rej.reason, 'prerequisite');
  assert.deepEqual(rej.fields.blockDetail[0], { cause: 'load-rejected', model: 'A', observed: 'failed' });
  // T2 deadline for either model => 'timeout:load' (takes precedence over 'prerequisite')
  const to = evaluateC1({ A: { ...m, classification: 'CONTRADICTORY' }, B: { loaded: false, loadStatus: 'timed-out' }, loadedCount: 1 });
  assert.deepEqual([to.verdict, to.reason], ['BLOCKED', 'timeout:load']);
  assert.deepEqual(to.fields.blockDetail.map((d) => [d.cause, d.model]), [['classifier', 'A'], ['load-deadline', 'B'], ['model-count', null]]);
  const notIn = evaluateC1({ A: m, B: { ...m, inAllModels: false }, loadedCount: 2 });
  assert.deepEqual(notIn.fields.blockDetail, [{ cause: 'model-not-loaded', model: 'B', observed: 'not-in-getAllModels' }]);
  for (const r of [cls, nl, rej, to, notIn]) {
    assert.ok(['prerequisite', 'timeout:load'].includes(r.reason), 'never a detailed/suffixed reason');
    assert.equal(r.recordType, 'check-run');
  }
});

test('C5: feet only for finite positive scale and metre-based unit; otherwise raw pair + reason; observation-only PASS', () => {
  const r = evaluateC5({ A: { unitScale: 1, unitString: 'm', nativeExtent: [0.3048, 1, 1] }, B: { unitScale: 0.3048, unitString: 'ft', nativeExtent: [1, 1, 1] } });
  assert.equal(r.verdict, 'PASS');
  assert.equal(r.fields.perModel.A.feet[0], 1);
  assert.equal(r.fields.perModel.B.feet, null);
  assert.equal(vr(evaluateC5({ A: {} })), 'NOT_EVIDENCED(values-not-captured)');
});

test('C7β: T13 counts per variant, exactly 5 replacements without accumulation, setFromPoints, clear', () => {
  const rep = { removedPriorExactly: true, ledgerCount: 3, expected: 3, cumulativeNet: 3 };
  const ok = {
    hard: { scenesPresent: true, marked: true, markerMeshCount: 3, outlinedSides: 2 },
    soft: { scenesPresent: true, marked: true, markerMeshCount: 5, outlinedSides: 2 },
    replacements: [rep, rep, rep, rep, rep], setFromPointsOk: true, clear: { markersRemoved: 3, priorCount: 3, ledgerNull: true },
  };
  assert.equal(evaluateC7Beta(ok).verdict, 'PASS');
  assert.equal(vr(evaluateC7Beta({ ...ok, soft: { ...ok.soft, markerMeshCount: 8 } })), 'FAIL(i)');
  assert.equal(vr(evaluateC7Beta({ ...ok, replacements: [rep, rep, rep, rep, { ...rep, cumulativeNet: 6 }] })), 'FAIL(ii)');
  assert.equal(vr(evaluateC7Beta({ ...ok, replacements: [rep, rep, rep, rep] })), 'FAIL(ii)');
});

test('C7α/C18b wrapper of the scene-ownership oracle produces the §10 sceneOwnership rows', () => {
  const scenes = [{ scene: 'p', class: SCENE_CLASS.PANEL_OWNED }, { scene: 'f', class: SCENE_CLASS.FOREIGN, sentinelRefId: 'o1' }];
  const r = evaluateSceneOwnership({ scenes, presentAfterDispose: { p: false, f: true }, ledger: [] });
  assert.equal(r.record.verdict, 'PASS');
  assert.equal(r.sceneOwnership.rows.length, 2);
  const bad = evaluateSceneOwnership({ scenes, presentAfterDispose: { p: true, f: true }, ledger: [] });
  assert.equal(vr(bad.record), 'FAIL(c1)');
});

test('C9–C12, N4, N5: pure evaluators', () => {
  assert.equal(evaluateC9({ isolationNormalizable: true, hiddenNormalizable: true, prerequisite: { available: true } }).verdict, 'PASS');
  assert.equal(checkVerdictBase(evaluateC9({ isolationNormalizable: false, hiddenNormalizable: true, prerequisite: { available: true } })), 'FAIL');
  const set = { method: 'viewer.setAggregateIsolation', modelLabels: ['A', 'B'] };
  const c10 = { records: [{ method: 'viewer.getAllModels' }, { method: 'viewer.getAggregateIsolation' }, { method: 'viewer.getAggregateHiddenNodes' }, set], nonEmptyIds: true, postEqualsTarget: true, isolated: true, clear: { isolation: 'restored', postIsolationEmpty: true, postHiddenEmpty: true, emptySetWithoutCompare: false } };
  assert.equal(evaluateC10(c10).verdict, 'PASS');
  assert.equal(vr(evaluateC10({ ...c10, records: [set, { method: 'viewer.getAggregateIsolation' }] })), 'FAIL(readsBeforeSet)');
  assert.equal(vr(evaluateC10({ ...c10, records: [...c10.records, set] })), 'FAIL(exactlyOneSet,onePerModel)');
  const c11 = { prerequisiteWhileHidden: { available: false, reason: 'hidden' }, presentOutcome: { isolated: false, notes: ['x'] }, setIsolationCallsDuringPresent: 0, nodeStillHidden: true };
  assert.equal(evaluateC11(c11).verdict, 'PASS');
  assert.equal(vr(evaluateC11({ ...c11, setIsolationCallsDuringPresent: 1 })), 'FAIL(zeroSets)');
  assert.equal(evaluateN5({ prerequisiteWhileHidden: { available: false }, prerequisiteAfterShow: { available: true } }).state, 'DETECTED_RESTORED');
  assert.equal(evaluateN5({ prerequisiteWhileHidden: { available: true } }).state, 'NOT_DETECTED');
  assert.equal(evaluateN5({ prerequisiteWhileHidden: { available: false }, prerequisiteAfterShow: { available: false } }).state, 'RESTORE_FAILED');
  const c12 = { clear: { isolation: 'skipped-external' }, bridgeSetsAfterForeign: 0, foreignUnchanged: true, markersRemoved: true, replacement: { bridgeRestoredOverForeign: false } };
  assert.equal(evaluateC12(c12).verdict, 'PASS');
  assert.equal(vr(evaluateC12({ ...c12, bridgeSetsAfterForeign: 1 })), 'FAIL(noBridgeSetAfterForeign)');
  assert.equal(evaluateN4({ clearIsolation: 'skipped-external', resetToEmpty: true }).state, 'DETECTED_RESTORED');
  assert.equal(evaluateN4({ clearIsolation: 'restored', resetToEmpty: true }).state, 'NOT_DETECTED');
  assert.equal(evaluateN4({ timedOut: true }).state, 'TIMED_OUT');
});

test('C13 outcome table: C15(e) is the only `failed`; `none` only where allowed', () => {
  const ok = { C10: { isolation: 'restored' }, C12: { isolation: 'skipped-external' }, C15b: { isolation: 'none', noneAllowed: true }, C15c: { isolation: 'restored' }, C15e: { isolation: 'failed', clear2: 'restored', clear3: 'none' } };
  assert.equal(evaluateC13(ok).verdict, 'PASS');
  assert.equal(vr(evaluateC13({ ...ok, C15b: { isolation: 'none' } })), 'FAIL(mismatch:C15b)');
  assert.equal(vr(evaluateC13({ ...ok, C10: { isolation: 'failed' } })), 'FAIL(mismatch:C10)');
  assert.equal(vr(evaluateC13({ ...ok, C15e: undefined })), 'BLOCKED(scenario-missing:C15e)');
  // RC1: the C15(e) second/third clear outcomes are part of the table (failed -> restored -> none)
  assert.equal(vr(evaluateC13({ ...ok, C15e: { isolation: 'failed', clear2: 'failed', clear3: 'none' } })), 'FAIL(mismatch:C15e)');
});

test('C14, C15, C16, C18a, C19: pure evaluators', () => {
  const c14 = { presentPresent: { p1Superseded: true, p2Superseded: false, ledgerOnlyP2: true, finalEqualsY: true }, presentClear: { superseded: true, finalEmpty: true }, presentDispose: { superseded: true, residueOk: true }, spyBalanced: true, finalIsolationEmpty: true };
  assert.equal(evaluateC14(c14).verdict, 'PASS');
  assert.equal(vr(evaluateC14({ ...c14, spyBalanced: false })), 'FAIL(noStranded)');
  // (e) is the RC1 three-clear oracle over fields.e (full mutation coverage in the .c15e test file);
  // here (e) stops before the oracle (driver-reported BLOCKED), so (a)-(d) decide FAIL vs BLOCKED.
  const e = { evidence: null, blocked: 'precondition:c15e', globalOk: true };
  const c15 = {
    a: { injectedFired: true, allAddedRemoved: true, ledgerNull: true, marked: false, failedNote: true, globalOk: true },
    b: { injectedFired: true, isolationUnchanged: true, noMarkerLeak: true, globalOk: true },
    c: { injectedFired: true, finalIsolationEmpty: true, globalOk: true },
    d: { injectedFired: true, fitted: true, notes: [C15_FIRST_ONLY_NOTE], globalOk: true }, e,
  };
  assert.equal(vr(evaluateC15(c15)), 'BLOCKED(precondition:c15e)');
  assert.equal(vr(evaluateC15({ ...c15, a: { ...c15.a, injectedFired: false } })), 'FAIL(a)');
  assert.equal(vr(evaluateC15({ ...c15, e: { evidence: null, blocked: null, globalOk: true } })), 'BLOCKED(precondition:c15e)'); // no evidence => never PASS
  assert.equal(C15_RESTORE_FAILED_NOTE, 'Isolation could not be restored (the Viewer reported an error).');
  const names = { BEFORE_MODEL_UNLOAD: 'bu', MODEL_REMOVED: 'mr' };
  const log = [{ seq: 0, kind: 'listener-entry', eventName: 'mr', modelLabel: 'B' }, { seq: 1, kind: 'bridge-callback', modelLabel: 'B', reason: 'removed' }];
  assert.equal(evaluateC16({ eventLog: log, eventNames: names, restored: true }).verdict, 'PASS');
  assert.equal(vr(evaluateC16({ eventLog: [...log, { seq: 2, kind: 'listener-entry', eventName: 'bu', modelLabel: 'B' }], eventNames: names, restored: true })), 'FAIL(event-behaviour-differs-from-spec-16)');
  assert.equal(vr(evaluateC16({ eventLog: [], eventNames: names, restored: true })), 'FAIL(event-behaviour-differs-from-spec-16)');
  assert.equal(vr(evaluateC16({ eventLog: log, eventNames: names, restored: false })), 'FAIL(RESTORE_FAILED)');
  const c18 = { panelScenesAbsent: true, foreignOk: true, listenerAddRemove: { bu: { add: 1, remove: 1 } }, ledgerNull: true, disposal: { disposed: true, releaseNotes: [], listenerErrors: [] }, postDispose: { presentDisposed: true, clearDisposed: true, bridgeMutatorCalls: 0 }, isolationHiddenEmpty: true };
  assert.equal(evaluateC18a(c18).verdict, 'PASS');
  assert.equal(vr(evaluateC18a({ ...c18, listenerAddRemove: { bu: { add: 1, remove: 0 } } })), 'FAIL(clause:3)');
  assert.equal(vr(evaluateC18a({ ...c18, postDispose: { ...c18.postDispose, bridgeMutatorCalls: 1 } })), 'FAIL(clause:5)');
});

test('C19 + markers-only v1: any theming call or non-harness selection call FAILs; N1 must be DETECTED', () => {
  const clean = [{ method: 'viewer.fitToView', origin: 'bridge', callIndex: 0 }, { method: 'viewer.select', origin: 'harness', callIndex: 1 }];
  assert.equal(evaluateC19({ records: clean, n1State: 'DETECTED' }).verdict, 'PASS');
  assert.equal(vr(evaluateC19({ records: clean, n1State: 'NOT_DETECTED' })), 'BLOCKED(dependency:N1)');
  const theming = [...clean, { method: `viewer.${THEMING_SET_METHOD}`, origin: 'viewer-internal', callIndex: 2 }];
  assert.equal(vr(evaluateC19({ records: theming, n1State: 'DETECTED' })), 'FAIL(theming)');
  assert.equal(vr(evaluateC19({ records: [...clean, { method: 'viewer.clearSelection', origin: 'unattributed', callIndex: 3 }], n1State: 'DETECTED' })), 'FAIL(selection)');
  const m = markersOnlyV1Violations([...theming, { method: 'viewer.hide', origin: 'bridge', callIndex: 4 }]);
  assert.equal(m.theming.length, 1);
  assert.deepEqual(m.nonE3Bridge.map((r) => r.method), ['viewer.hide']);
});

test('every evaluator output is a valid §10 check record accepted by computeOverall / validateResultSchema inputs', () => {
  const records = [evaluateC9({}), evaluateC13({}), evaluateC16({}), evaluateC19({ records: [], n1State: 'DETECTED' }), evaluateC1({})];
  for (const r of records) assert.equal(validateCheckRecord(r).ok, true, JSON.stringify(r));
  const checks = Object.fromEntries(CHECK_NAMES.map((n) => [n, makeCheckRecord({ verdict: 'PASS' })]));
  checks.C20 = makeCheckRecord({ verdict: 'NOT_EVIDENCED', reason: 'unstable-frame' });
  const o = computeOverall({ checks }, 'pre-closeout');
  assert.equal(o.overall, 'FAIL'); // other state absent => fail-closed rows; record form itself is readable
  assert.equal(typeof validateResultSchema, 'function');
});
