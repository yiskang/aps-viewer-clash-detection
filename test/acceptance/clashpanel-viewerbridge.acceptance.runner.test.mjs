// test/acceptance/clashpanel-viewerbridge.acceptance.runner.test.mjs
//
// Offline tests for the ordered check runner (procedure §5: phase order, dependency table, taint
// rule, fatal skip, "a BLOCKED never erases a FAIL") with fake drivers, the offline planner (every
// unit `pending live execution`, no verdict), and an end-to-end OFFLINE-FAKE run of the dormant
// live phase drivers against the repository's fake Viewer + fake THREE + the REAL ViewerBridge
// (clashpanel/viewer, not core): this exercises the §6 action sequences, the spy/tagger wiring and
// the bounded C15 failure injection on a branded fake. Page-side adapters (C1 model facts, C2/C3 DOM
// probes, camera, screenshots) are clearly-labelled test fakes; nothing here is live evidence.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASE_ORDER, CHECK_NAMES, CONTROL_NAMES, LIVE_PENDING_STATUS, planChecks, phaseUnits, runChecksInPhaseOrder, makeCheckRecord, makeControlRecord,
  checkVerdictBase, validateCheckRecord, validateControlRecord, evaluateOverallRows, G2RefusalError,
  createCallRecorder, createWrapperRegistry, createFailureInjectionController, createBridgeInstanceTracker, createModelLabeler,
  createLivePhaseDrivers, enumerateCandidates, selectFitUnionPair, OFFLINE_FAKE_TARGET_BRAND, C2_REGION_ORDER, CLASSIFIER_CONFIRMED,
} from './clashpanel-viewerbridge.acceptance.mjs';
import { createViewerBridge } from '../../clashpanel/viewer/ViewerBridge.js';
import { createViewerApi } from '../../clashpanel/viewer/viewerApi.js';
import { createFakeViewer, createFakeModel, FAKE_EVENTS } from '../clashpanel/support/fakeViewer.mjs';
import { createFakeThree } from '../clashpanel/support/fakeThree.mjs';

const pass = () => makeCheckRecord({ verdict: 'PASS' });
const ok = (n) => {
  const st = { N1: 'DETECTED', N6: 'DETECTED', N8: 'DETECTED' }[n] || 'DETECTED_RESTORED';
  return makeControlRecord(n, st);
};

/** Fake drivers that PASS every runnable unit and log call order. */
function passingDrivers(log, overrides = {}) {
  const drivers = {};
  for (const p of PHASE_ORDER) {
    drivers[p.id] = async ({ runnable }) => {
      log.push(p.id);
      if (overrides[p.id]) return overrides[p.id]({ runnable });
      return { checks: Object.fromEntries(runnable.checks.map((c) => [c, pass()])), controls: Object.fromEntries(runnable.controls.map((n) => [n, ok(n)])) };
    };
  }
  return drivers;
}

test('planner: every check/control unit, in §5 phase order, pending live execution; C13 runs with P8; no verdicts', () => {
  const plan = planChecks();
  assert.deepEqual(plan.map((p) => p.phase), ['P1', 'P2', 'P3', 'P4', 'P5a', 'P5b', 'P6', 'P6b', 'P7', 'P8', 'P9', 'P10', 'P11']);
  const units = plan.flatMap((p) => p.units);
  assert.ok(units.every((u) => u.status === LIVE_PENDING_STATUS && !('verdict' in u)));
  const feeds = new Set(units.map((u) => u.feeds));
  for (const n of [...CHECK_NAMES, ...CONTROL_NAMES]) assert.ok(feeds.has(n), n);
  assert.ok(phaseUnits(PHASE_ORDER.find((p) => p.id === 'P8')).checks.includes('C13'));
  assert.ok(!phaseUnits(PHASE_ORDER.find((p) => p.id === 'P7')).checks.includes('C13'));
  assert.deepEqual(phaseUnits(PHASE_ORDER.find((p) => p.id === 'P5b')).checks, ['C7beta']);
});

test('live mode is refused while the live path is not wired; unknown modes throw', async () => {
  await assert.rejects(runChecksInPhaseOrder({ mode: 'live' }), (e) => e instanceof G2RefusalError && e.reason === 'live-path-not-wired');
  await assert.rejects(runChecksInPhaseOrder({ mode: 'whatever' }), TypeError);
});

test('all-passing fake drivers: phases run in §5 order; records are total and valid; C7/C18 combine their sub-checks', async () => {
  const log = [];
  const r = await runChecksInPhaseOrder({ drivers: passingDrivers(log) });
  assert.deepEqual(log, ['P1', 'P2', 'P3', 'P4', 'P5a', 'P5b', 'P6', 'P6b', 'P7', 'P8', 'P9', 'P10', 'P11']);
  for (const n of CHECK_NAMES) { assert.equal(r.checks[n].verdict, 'PASS', n); assert.equal(validateCheckRecord(r.checks[n]).ok, true); }
  for (const n of CONTROL_NAMES) assert.equal(validateControlRecord(n, r.controls[n]).ok, true);
  assert.deepEqual(Object.keys(r.checks.C7.fields.parts), ['C7alpha', 'C7beta']);
  assert.equal(r.sessionTainted, false);
});

test('dependencies: C4 FAIL blocks C6/C7β/C8/C20; C9 FAIL blocks C10..C15 chain; C16 FAIL blocks C17; N1 NOT_DETECTED blocks C19', async () => {
  const log = [];
  const r = await runChecksInPhaseOrder({
    drivers: passingDrivers(log, {
      P2: () => ({ controls: { N1: makeControlRecord('N1', 'NOT_DETECTED') } }),
      P4: ({ runnable }) => ({ checks: { C4: makeCheckRecord({ verdict: 'FAIL', reason: 'not-contained' }), ...(runnable.checks.includes('C5') ? { C5: pass() } : {}) }, controls: { N6: ok('N6') } }),
      P7: () => ({ checks: { C9: makeCheckRecord({ verdict: 'FAIL', reason: 'x' }) }, controls: { N4: ok('N4'), N5: ok('N5') } }),
      P9: ({ runnable }) => ({ checks: { C16: makeCheckRecord({ verdict: 'FAIL', reason: 'y' }), ...(runnable.checks.includes('C17') ? { C17: pass() } : {}) }, controls: { N7: ok('N7') } }),
    }),
  });
  assert.equal(r.checks.C4.verdict, 'FAIL(not-contained)');
  assert.equal(r.checks.C6.verdict, 'BLOCKED(dependency:C4)');
  assert.equal(r.checks.C8.verdict, 'BLOCKED(dependency:C4)');
  assert.match(r.checks.C20.verdict, /^BLOCKED\(dependency:C4/);
  assert.equal(r.checks.C7.verdict, 'BLOCKED(C7alpha:dependency:C4,C7beta:dependency:C4)'); // CHECK_DEPENDENCIES C7 -> C4 applies to both sub-checks
  assert.equal(r.checks.C10.verdict, 'BLOCKED(dependency:C9)');
  assert.equal(r.checks.C11.verdict, 'BLOCKED(dependency:C9)');
  assert.equal(r.checks.C14.verdict, 'BLOCKED(dependency:C7,C10)');
  assert.equal(r.checks.C13.verdict, 'BLOCKED(dependency:C10)');
  assert.equal(r.checks.C17.verdict, 'BLOCKED(dependency:C16)'); // same phase: produced by driver? no -- C16 FAIL gate is cross-unit
  assert.equal(r.checks.C19.verdict, 'BLOCKED(dependency:N1)');
});

test('taint: a failed phase-boundary baseline blocks later MUTATING units (read-only C13/C19 continue; embedded controls follow their checks); FAIL never erased', async () => {
  const log = [];
  const r = await runChecksInPhaseOrder({
    drivers: passingDrivers(log, { P6: () => ({ checks: { C6: makeCheckRecord({ verdict: 'FAIL', reason: 'corner-outside-frustum' }), C8: pass() }, controls: { N2: ok('N2') } }) }),
    assertPhaseBaseline: (phase) => ({ ok: phase !== 'P6' }),
  });
  assert.equal(r.sessionTainted, true);
  assert.equal(r.taintPhase, 'P6');
  assert.equal(r.checks.C6.verdict, 'FAIL(corner-outside-frustum)');
  assert.equal(r.checks.C9.verdict, 'BLOCKED(session-tainted:P6)');
  assert.equal(r.checks.C17.verdict, 'BLOCKED(session-tainted:P6)');
  assert.equal(r.controls.N7.state, 'NOT_EXECUTABLE');
  assert.equal(r.controls.N8.state, 'NOT_APPLICABLE'); // C20 not runnable => its embedded control cannot run
  assert.equal(r.checks.C19.verdict, 'PASS');
  assert.ok(log.includes('P11') && !log.includes('P7'));
  // driver-reported taint and a FAIL recorded before a later BLOCKED of the same unit
  const r2 = await runChecksInPhaseOrder({ drivers: passingDrivers([], { P4: () => ({ checks: { C4: pass(), C5: pass() }, controls: { N6: ok('N6') }, tainted: true }) }) });
  assert.equal(r2.taintPhase, 'P4');
  assert.equal(r2.checks.C7.verdict, 'BLOCKED(C7alpha:session-tainted:P4,C7beta:session-tainted:P4)');
});

test('fatal event skips everything left to cleanup; driver exception => BLOCKED(harness-exception) + taint; missing/invalid records fail closed', async () => {
  let fatal = false;
  const r = await runChecksInPhaseOrder({ drivers: passingDrivers([], { P5b: () => { fatal = true; return { checks: { C7beta: pass() } }; } }), fatalObserved: () => fatal });
  assert.equal(r.checks.C6.verdict, 'BLOCKED(fatal-skip)');
  assert.equal(r.controls.N2.state, 'NOT_DETECTED');
  assert.equal(r.controls.N3.state, 'DETECTED_RESTORED');
  const r2 = await runChecksInPhaseOrder({ drivers: passingDrivers([], { P7: () => { throw new Error('boom'); } }) });
  assert.equal(r2.checks.C9.verdict, 'BLOCKED(harness-exception:P7)');
  assert.equal(r2.sessionTainted, true);
  assert.equal(r2.phaseLog.find((p) => p.phase === 'P7').error.message, 'boom');
  const r3 = await runChecksInPhaseOrder({ drivers: passingDrivers([], { P3: () => ({ checks: { C2: { verdict: 'PASS' } } }) }) });
  assert.equal(r3.checks.C2.verdict, 'BLOCKED(invalid-record:P3)');
  assert.equal(r3.checks.C3.verdict, 'BLOCKED(dependency:C2)'); // same-phase post-gate
  const r4 = await runChecksInPhaseOrder({ drivers: {} });
  assert.equal(r4.checks.C1.verdict, 'BLOCKED(driver-missing:P1)');
  assert.ok(CHECK_NAMES.every((n) => checkVerdictBase(r4.checks[n]) === 'BLOCKED'));
});

// ---- end-to-end offline-fake run of the live phase drivers --------------------------------

function boxA(k) { return [k * 10, 0, 0, k * 10 + 2, 2, 2]; }
function boxB(k) { return [500 + k * 10, 0, 0, 500 + k * 10 + 2, 2, 2]; }

function buildFakeEnv() {
  const idsA = [1, 2, 3, 4, 5, 6];
  const idsB = [101, 102, 103, 104, 105, 106];
  const boxesA = Object.fromEntries(idsA.map((id) => [id, boxA(id)]));
  const boxesB = Object.fromEntries(idsB.map((id, i) => [id, boxB(i + 1)]));
  const A = createFakeModel({ id: 1, boxes: boxesA });
  const B = createFakeModel({ id: 2, boxes: boxesB });
  const viewer = createFakeViewer({ models: [A, B] });
  viewer[OFFLINE_FAKE_TARGET_BRAND] = true;
  viewer.overlays[OFFLINE_FAKE_TARGET_BRAND] = true;
  const { THREE } = createFakeThree();
  const events = { BEFORE_MODEL_UNLOAD: FAKE_EVENTS.BEFORE_MODEL_UNLOAD, MODEL_REMOVED: FAKE_EVENTS.MODEL_REMOVED };
  // harness-side Viewer methods the fake forbids for the Panel (the procedure's harness uses them, origin 'harness')
  const hidden = [];
  viewer.hide = (dbId, model) => { hidden.push({ model, ids: [dbId] }); viewer.setHiddenNodes(hidden); };
  viewer.show = (dbId, model) => { const i = hidden.findIndex((e) => e.model === model && e.ids.includes(dbId)); if (i >= 0) hidden.splice(i, 1); viewer.setHiddenNodes(hidden); };
  const byId = (id) => [A, B].find((m) => m.id === id);
  viewer.hideModel = (id) => { const m = byId(id); viewer.removeModel(m); viewer.dispatch(events.MODEL_REMOVED, { model: m }); };
  viewer.showModel = (id) => { viewer.addModel(byId(id)); };
  viewer.unloadModel = (m) => { viewer.dispatch(events.BEFORE_MODEL_UNLOAD, { model: m }); viewer.removeModel(m); viewer.dispatch(events.MODEL_REMOVED, { model: m }); };
  // fake camera: fitToView frames the requested boxes (orthographic, identity rotation)
  const boxOf = (model, id) => (model === A ? boxesA[id] : boxesB[id]);
  const frame = (boxes) => {
    const lo = [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b[i])));
    const hi = [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b[i + 3])));
    const c = lo.map((v, i) => (v + hi[i]) / 2);
    const half = Math.max(...hi.map((v, i) => (v - lo[i]) / 2), 1e-6);
    const s = 0.3 / half; // loose framing keeps the outline narrower than W/2 so N8 (ii) can discriminate
    return { matrixWorldInverse: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -c[0], -c[1], -c[2], 1], projectionMatrix: [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1] };
  };
  let camera = frame([[-1, -1, -1, 1, 1, 1]]);
  const origFit = viewer.fitToView;
  viewer.fitToView = function fit(first, second, third) {
    const r = origFit.call(this, first, second, third);
    if (Array.isArray(first) && first[0] && typeof first[0] === 'object' && 'model' in first[0]) camera = frame(first.flatMap((e) => e.selection.map((id) => boxOf(e.model, id))));
    else camera = frame(first.map((id) => boxOf(second, id)));
    return r;
  };
  const recorder = createCallRecorder();
  const registry = createWrapperRegistry();
  const labelOf = createModelLabeler({ A, B });
  const viewerApi = createViewerApi(viewer, { events });
  const candidatesA = enumerateCandidates({ leafDbIds: idsA, fragmentCounts: Object.fromEntries(idsA.map((i) => [i, 1])), boxes: boxesA }).candidates;
  const candidatesB = enumerateCandidates({ leafDbIds: idsB, fragmentCounts: Object.fromEntries(idsB.map((i) => [i, 1])), boxes: boxesB }).candidates;
  const fit = selectFitUnionPair(candidatesA, candidatesB);
  // synthetic screenshots: paint the projected sphere centre and first outline vertex of the Panel meshes present
  const W = 400; const H = 400;
  const project = (p) => {
    const m = camera.matrixWorldInverse; const P = camera.projectionMatrix;
    const v = [p[0] + m[12], p[1] + m[13], p[2] + m[14]];
    return [Math.floor(((v[0] * P[0] + 1) / 2) * W), Math.floor(((1 - v[1] * P[5]) / 2) * H)];
  };
  const env = {
    viewer, THREE, eventNames: events, models: { A, B }, labelOf, recorder, registry,
    injection: createFailureInjectionController({ registry, allowOfflineFakes: true }),
    bridgeTracker: createBridgeInstanceTracker(),
    createBridge: (names) => createViewerBridge({ viewerApi, THREE, names }),
    targets: { a1: candidatesA[0].dbId, b1: candidatesB[0].dbId, fitPair: fit.pair, candidatesA, candidatesB },
    boundsOf: (model, dbId) => viewerApi.getElementWorldBounds(model, dbId),
    fragmentBoxesOf: (model, dbId) => { const b = boxOf(model, dbId); return b ? [b] : []; },
    makeSentinelMesh: () => new THREE.Mesh(new THREE.SphereGeometry(1, 4, 4), new THREE.MeshBasicMaterial({})),
    tick: () => new Promise((r) => setImmediate(r)),
    modelFacts: async () => ({ A: { loaded: true, classification: CLASSIFIER_CONFIRMED, inAllModels: true, unitScale: 0.3048, unitString: 'ft' }, B: { loaded: true, classification: CLASSIFIER_CONFIRMED, inAllModels: true, unitScale: 0.3048, unitString: 'ft' }, loadedCount: viewer.getAllModels().length }),
    unitFacts: async () => ({ A: { unitScale: 0.3048, unitString: 'ft', nativeExtent: [2, 2, 2] }, B: { unitScale: 0.3048, unitString: 'ft', nativeExtent: [2, 2, 2] } }),
    shellProbe: {
      c2: async () => ({ threw: false, containerFound: true, containerUnderViewer: true, regions: C2_REGION_ORDER.map((region) => ({ region, hasHeading: true, hasBody: true })), addVisibilityListenerCalls: 1, bodyChildCount: 1, title: { ok: true }, setVisibleFalseBeforeListener: true, dispatchesDuringConstruction: 0, domainWrites: 0, shellKeys: ['show', 'hide', 'toggle', 'isVisible', 'dispose'] }),
      c3: async () => ({ showHide: [1, 2, 3].map(() => ({ showSetVisibleTrue: true, showDispatches: ['PANEL_SHOWN'], hideDispatches: ['PANEL_HIDDEN'] })), dispose: { uninitializeCalls: 1, containerInDom: false, rootFound: false, byIdFound: false, retainedCallbackDispatches: 0, setVisibleAfterUninitialize: 0, postDisposeSpyCalls: 0, postDisposeIsVisible: false }, residue: [] }),
    },
    camera: { sample: () => camera, waitFrame: () => Promise.resolve(), resetHome: () => { camera = frame([[-1, -1, -1, 1, 1, 1]]); return true; } },
    capture: {
      canvas: async () => ({ W, H, dsf: 1, shellDisposed: true }),
      waitRafs: async () => {},
      frame: async () => {
        const f = new Uint8Array(W * H * 4);
        const meshes = [...viewer.overlayMeshes('clash-panel-markers:g2a'), ...viewer.overlayMeshes('clash-panel-outlines:g2a')];
        for (const m of meshes) {
          const p = m.isLine ? m.geometry.points[0] : m.position;
          const [x, y] = project([p.x, p.y, p.z]);
          if (x >= 0 && x < W && y >= 0 && y < H) f[(y * W + x) * 4] = 255;
        }
        return f;
      },
    },
    state: {},
  };
  return { env, viewer, A, B };
}

test('end-to-end offline-fake run: dormant live drivers + real ViewerBridge on the fake Viewer => every check PASS except the reported C15(e) contradiction; every control acceptable', async () => {
  const { env, viewer } = buildFakeEnv();
  const drivers = createLivePhaseDrivers(env);
  const r = await runChecksInPhaseOrder({ drivers, mode: 'offline-fake' });
  // CONTRADICTION (reported, not silently changed): procedure §C15(e) expects `inspectLedger().isolation`
  // retained (confirmed:true) after the failed clear(), but the real ViewerBridge nulls its held ledger once
  // every marker is removed (ViewerBridge.js releaseHeld) while keeping the isolation session record. The
  // literal clause therefore FAILs against the real bridge; the retention itself is evidenced by clear2.
  assert.equal(r.checks.C15.verdict, 'FAIL(e)');
  const e = r.checks.C15.evidence.observation.e;
  assert.equal(e.ledgerIsolationConfirmedRetained, false);
  assert.equal(e.ledgerAfterClear1, null);
  assert.equal(e.retentionEvidencedByClear2Restored, true);
  assert.equal(e.clear1.isolation, 'failed');
  assert.deepEqual(Object.entries(r.checks.C15.fields.clauses).filter(([, v]) => !v).map(([k]) => k), ['e']);
  const notPass = CHECK_NAMES.filter((n) => n !== 'C15' && r.checks[n].verdict !== 'PASS').map((n) => `${n}=${r.checks[n].verdict} ${JSON.stringify(r.checks[n].fields).slice(0, 300)}`);
  assert.deepEqual(notPass, []);
  const bad = CONTROL_NAMES.filter((n) => !['DETECTED', 'DETECTED_RESTORED'].includes(r.controls[n].state)).map((n) => `${n}=${r.controls[n].state} ${JSON.stringify(r.controls[n].fields).slice(0, 300)}`);
  assert.deepEqual(bad, []);
  // the C15 injections really fired inside the recorder and were all removed again
  assert.ok(env.recorder.records.some((x) => x.injected === true));
  assert.deepEqual(env.injection.installed(), []);
  // the fake Viewer never saw a theming / forbidden Panel call
  assert.deepEqual(viewer.themingCalls, []);
  // verdict model consumes the records: no check/control row is triggered
  const rows = evaluateOverallRows({ checks: r.checks, controls: r.controls }, 'pre-closeout');
  assert.deepEqual(rows.find((x) => x.row === 3).reasons, ['check-fail:C15']);
  for (const row of rows.filter((x) => [4, 7].includes(x.row))) assert.equal(row.match, false, JSON.stringify(row));
  // the §10 extras are present
  for (const k of ['c4Table', 'sceneOwnership', 'c17', 'c20']) assert.ok(r.extras[k], k);
  assert.equal(r.extras.c17.V.V1, true);
  assert.equal(r.extras.c20.R.R7, true);
});

test('end-to-end negative: a bridge that removes a foreign sentinel scene is caught by C7α/C18b (FAIL), N3 still discriminates', async () => {
  const { env } = buildFakeEnv();
  const realCreate = env.createBridge;
  env.createBridge = (names) => {
    const b = realCreate(names);
    if (!names.overlayMarkers.endsWith(':g2b')) return b;
    return { ...b, dispose: async () => { await b.dispose(); env.viewer.overlays.removeScene('g2-foreign-scene'); } };
  };
  const drivers = createLivePhaseDrivers(env);
  const r = await runChecksInPhaseOrder({ drivers });
  assert.equal(checkVerdictBase(r.checks.C7), 'FAIL');
  assert.equal(checkVerdictBase(r.checks.C18), 'FAIL');
  assert.equal(r.controls.N3.state, 'NOT_DETECTED'); // live scene observation (foreign scene present) no longer holds
});
