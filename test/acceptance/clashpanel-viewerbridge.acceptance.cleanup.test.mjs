// test/acceptance/clashpanel-viewerbridge.acceptance.cleanup.test.mjs
//
// Offline tests for model ownership and cleanup semantics (procedure §4.8, §9 cleanup ledger) and the
// scene ownership oracle (§C7alpha / §C18b / N3) over fake resources and synthetic ledgers.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLEANUP_STEP_NAMES,
  runCleanup,
  createTimeoutQuarantine,
  guardedUnloadModel,
  verifyViewerModelSetEmpty,
  createModelCleanupSteps,
  SCENE_CLASS,
  sceneOwnershipOracle,
  injectSyntheticRemoveScene,
  runSceneOwnershipControlN3,
  createCallRecorder,
  createWrapperRegistry,
  recordingWrap,
} from './clashpanel-viewerbridge.acceptance.mjs';

// ------------------------------------------------------------------------------------------
// runCleanup
// ------------------------------------------------------------------------------------------

function allSteps(log, overrides = {}) {
  const steps = {};
  for (const name of CLEANUP_STEP_NAMES) steps[name] = () => { log.push(name); };
  return { ...steps, ...overrides };
}

test('ledger: the 17 steps of procedure 9 in the exact order; every step runs on the happy path', async () => {
  assert.deepEqual([...CLEANUP_STEP_NAMES], [
    'drainPendingTokens', 'bridgeDispose', 'shellDispose', 'removeInjectedFailureWrappers', 'restoreRecordingWrappers',
    'removeHarnessForeignScenes', 'restoreIsolationEmpty', 'showHiddenNodes', 'restoreHiddenModel', 'verifyViewerStateBaseline',
    'unloadModelA', 'unloadModelB', 'verifyViewerModelSetEmpty', 'closePage', 'closeContext', 'closeBrowser', 'httpServerOwnership',
  ]);
  const log = [];
  const r = await runCleanup({ steps: allSteps(log) });
  assert.deepEqual(log, [...CLEANUP_STEP_NAMES]);
  assert.deepEqual(r.cleanupFailures, []);
  assert.equal(r.cleanupUnresolvedOwnership, false);
  assert.ok(CLEANUP_STEP_NAMES.every((n) => r.cleanupStepStatus[n] === 'ran'));
  assert.equal(r.staleContinuationsDropped, 0);
});

test('cleanup continues after a failure: every later step still runs; the failure is recorded, not blocking', async () => {
  const log = [];
  const r = await runCleanup({
    steps: allSteps(log, {
      bridgeDispose: () => { log.push('bridgeDispose'); throw new Error('dispose failed'); },
      removeHarnessForeignScenes: async () => { log.push('removeHarnessForeignScenes'); throw new TypeError('scene gone'); },
    }),
  });
  assert.deepEqual(log, [...CLEANUP_STEP_NAMES]);
  assert.deepEqual(r.cleanupFailures.map((f) => [f.step, f.reason, f.error.name]), [['bridgeDispose', 'threw', 'Error'], ['removeHarnessForeignScenes', 'threw', 'TypeError']]);
  assert.equal(r.cleanupStepStatus.bridgeDispose, 'threw');
  assert.equal(r.cleanupStepStatus.unloadModelB, 'ran');
  assert.equal(r.cleanupUnresolvedOwnership, true, 'no ownership probe => indeterminate => fail-closed unresolved (row 2)');
  assert.ok(r.cleanupFailures.every((f) => f.ownership === 'indeterminate'));
});

test('ownership re-check after a failed step: still owned => unresolved (row 2); gone => resolved; a throwing re-check is indeterminate and fails closed (unresolved)', async () => {
  const mk = (remains) => runCleanup({ steps: allSteps([], { closePage: { run: () => { throw new Error('x'); }, ownershipRemains: remains } }) });
  const a = await mk(() => true);
  assert.equal(a.cleanupUnresolvedOwnership, true);
  assert.equal(a.cleanupFailures[0].ownership, 'unresolved');
  const b = await mk(() => false);
  assert.equal(b.cleanupUnresolvedOwnership, false);
  assert.equal(b.cleanupFailures[0].ownership, 'resolved');
  const c = await mk(() => { throw new Error('page already dead'); });
  assert.equal(c.cleanupUnresolvedOwnership, true, 'a throwing probe is indeterminate => fail-closed unresolved');
  assert.equal(c.cleanupFailures[0].ownership, 'indeterminate');
  // a successful step never triggers the re-check
  let rechecked = false;
  const d = await runCleanup({ steps: allSteps([], { closePage: { run: () => {}, ownershipRemains: () => { rechecked = true; return true; } } }) });
  assert.equal(rechecked, false);
  assert.equal(d.cleanupUnresolvedOwnership, false);
});

test('a hung step is bounded by its deadline: recorded timed-out, later steps run, late completion quarantined', async () => {
  const log = [];
  const quarantine = createTimeoutQuarantine();
  let finishHung;
  const r = await runCleanup(
    { steps: allSteps(log, { shellDispose: () => new Promise((resolve) => { finishHung = resolve; }) }) },
    { stepDeadlinesMs: { shellDispose: 20 }, quarantine },
  );
  assert.equal(r.cleanupStepStatus.shellDispose, 'timed-out');
  assert.deepEqual(r.cleanupFailures.map((f) => [f.step, f.reason, f.timeoutMs]), [['shellDispose', 'timed-out', 20]]);
  assert.ok(log.includes('closeBrowser'), 'later steps still ran');
  assert.equal(quarantine.staleContinuationsDropped, 0);
  finishHung();
  await new Promise((res) => setImmediate(res));
  assert.equal(quarantine.staleContinuationsDropped, 1);
});

test('a timed-out step with unresolved ownership escalates to row 2', async () => {
  const r = await runCleanup(
    { steps: allSteps([], { closeBrowser: { run: () => new Promise(() => {}), ownershipRemains: () => true } }) },
    { stepDeadlinesMs: { closeBrowser: 15 } },
  );
  assert.equal(r.cleanupUnresolvedOwnership, true);
  assert.equal(r.cleanupFailures[0].reason, 'timed-out');
  assert.equal(r.cleanupFailures[0].ownership, 'unresolved');
});

test('fail-closed: a step with no implementation is recorded as a failure, never silently skipped', async () => {
  const steps = allSteps([]);
  delete steps.restoreRecordingWrappers;
  const r = await runCleanup({ steps });
  assert.deepEqual(r.cleanupFailures, [{ step: 'restoreRecordingWrappers', reason: 'step-not-configured', ownership: 'indeterminate' }]);
  assert.equal(r.cleanupStepStatus.restoreRecordingWrappers, 'not-configured');
});

// ------------------------------------------------------------------------------------------
// model A/B cleanup
// ------------------------------------------------------------------------------------------

function fakeViewer(models, { failUnload = new Set(), noopUnload = new Set() } = {}) {
  const loaded = [...models];
  return {
    loaded,
    getAllModels: () => loaded.slice(),
    async unloadModel(m) {
      if (failUnload.has(m)) throw new Error('unload failed');
      if (noopUnload.has(m)) return;
      loaded.splice(loaded.indexOf(m), 1);
    },
  };
}

test('model cleanup: each model is unloaded independently by object identity (two models may share a modelId)', async () => {
  const A = { modelId: 1 };
  const B = { modelId: 1 };
  const viewer = fakeViewer([A, B]);
  const steps = createModelCleanupSteps({ viewer, getModelA: () => A, getModelB: () => B });
  assert.deepEqual(await steps.unloadModelA.run(), { outcome: 'unloaded' });
  assert.deepEqual(viewer.loaded, [B]);
  assert.deepEqual(await steps.unloadModelB.run(), { outcome: 'unloaded' });
  assert.deepEqual(await steps.verifyViewerModelSetEmpty.run(), { outcome: 'empty' });
});

test('model B after C17 (already unloaded) and never-loaded models are already-absent successes', async () => {
  const A = {};
  const B = {};
  const viewer = fakeViewer([A]);
  assert.deepEqual(await guardedUnloadModel({ viewer, model: B, label: 'unloadModelB' }), { outcome: 'already-absent' });
  assert.deepEqual(await guardedUnloadModel({ viewer, model: null, label: 'unloadModelB' }), { outcome: 'already-absent' });
  assert.deepEqual(await guardedUnloadModel({ viewer, model: A, label: 'unloadModelA' }), { outcome: 'unloaded' });
  assert.deepEqual(await guardedUnloadModel({ viewer, model: A, label: 'unloadModelA' }), { outcome: 'already-absent' });
});

test('unloadModelA failing does not stop unloadModelB or the empty-set verification; A is reported unresolved', async () => {
  const A = {};
  const B = {};
  const viewer = fakeViewer([A, B], { failUnload: new Set([A]) });
  const log = [];
  const modelSteps = createModelCleanupSteps({ viewer, getModelA: () => A, getModelB: () => B });
  const r = await runCleanup({ steps: allSteps(log, modelSteps), context: {} });
  assert.deepEqual(r.cleanupFailures.map((f) => f.step), ['unloadModelA', 'verifyViewerModelSetEmpty']);
  assert.equal(r.cleanupStepStatus.unloadModelB, 'ran');
  assert.deepEqual(viewer.loaded, [A]);
  assert.equal(r.cleanupUnresolvedOwnership, true);
  assert.equal(r.cleanupFailures[0].ownership, 'unresolved');
  assert.ok(log.includes('closeBrowser'));
});

test('an unloadModel that returns without removing the model is a failure, not a success', async () => {
  const A = {};
  const viewer = fakeViewer([A], { noopUnload: new Set([A]) });
  await assert.rejects(guardedUnloadModel({ viewer, model: A, label: 'unloadModelA' }), /still loaded after unloadModel/);
  assert.throws(() => verifyViewerModelSetEmpty(viewer), /not empty \(1\)/);
  assert.throws(() => verifyViewerModelSetEmpty({ getAllModels: () => null }), /unreadable/);
});

test('the model steps run even when C16/C17 were skipped, tainted or failed (no dependence on check state)', async () => {
  const A = {};
  const B = {};
  const viewer = fakeViewer([A, B]);
  const r = await runCleanup({ steps: allSteps([], createModelCleanupSteps({ viewer, getModelA: () => A, getModelB: () => B })), context: { sessionTainted: true, checks: {} } });
  assert.deepEqual(viewer.loaded, []);
  assert.deepEqual(r.cleanupFailures, []);
});

// ------------------------------------------------------------------------------------------
// sceneOwnershipOracle
// ------------------------------------------------------------------------------------------

const MARKERS = 'clash-panel-markers:g2b';
const OUTLINES = 'clash-panel-outlines:g2b';
const FOREIGN = 'g2-foreign-scene';

/** Builds the C7alpha scenario on recorded fake overlays; returns the ledger and scene table. */
function runScenario({ tweak = () => {} } = {}) {
  const recorder = createCallRecorder();
  const registry = createWrapperRegistry();
  const scenes = new Set();
  const overlays = {
    addScene(n) { scenes.add(n); },
    hasScene(n) { return scenes.has(n); },
    addMesh() {},
    removeMesh() {},
    removeScene(n) { scenes.delete(n); },
  };
  for (const m of ['addScene', 'addMesh', 'removeMesh', 'removeScene']) recordingWrap(overlays, m, { recorder, registry, label: `overlays.${m}` });
  const S1 = { name: 'sentinel-1' };
  const S2 = { name: 'sentinel-2' };
  const outline = { name: 'outline' };
  const marker = { name: 'location-marker' };
  recorder.withOrigin('harness', () => {
    overlays.addScene(MARKERS); overlays.addMesh(S1, MARKERS);
    overlays.addScene(FOREIGN); overlays.addMesh(S2, FOREIGN);
  });
  const ctx = { recorder, overlays, scenes, S1, S2, outline, marker };
  recorder.withOrigin('bridge', () => {
    overlays.addScene(OUTLINES);
    overlays.addMesh(marker, MARKERS);
    overlays.addMesh(outline, OUTLINES);
    // clear(): remove exactly the meshes the bridge added
    overlays.removeMesh(marker, MARKERS);
    overlays.removeMesh(outline, OUTLINES);
    // dispose(): remove only the scene the bridge created
    overlays.removeScene(OUTLINES);
  });
  tweak(ctx);
  const scenesTable = [
    { scene: OUTLINES, class: SCENE_CLASS.PANEL_OWNED, createdBy: 'bridge', bridgeInstance: 2, presentBefore: false, sentinelRefId: null },
    { scene: MARKERS, class: SCENE_CLASS.FOREIGN, createdBy: 'harness', bridgeInstance: null, presentBefore: true, sentinelRefId: recorder.refIdOf(S1) },
    { scene: FOREIGN, class: SCENE_CLASS.FOREIGN, createdBy: 'harness', bridgeInstance: null, presentBefore: true, sentinelRefId: recorder.refIdOf(S2) },
  ];
  const presentAfterDispose = { [OUTLINES]: overlays.hasScene(OUTLINES), [MARKERS]: overlays.hasScene(MARKERS), [FOREIGN]: overlays.hasScene(FOREIGN) };
  return { ledger: recorder.records, scenes: scenesTable, presentAfterDispose, ctx };
}

test('oracle: the correct C7alpha scenario PASSes all four clauses and produces the section 10 table', () => {
  const s = runScenario();
  const r = sceneOwnershipOracle(s);
  assert.equal(r.verdict, 'PASS');
  assert.deepEqual(r.clauses, { c1: true, c2: true, c3: true, c4: true });
  assert.deepEqual(r.violations, []);
  const markers = r.table.find((t) => t.scene === MARKERS);
  assert.deepEqual(markers, {
    scene: MARKERS, class: 'foreign-preexisting', createdBy: 'harness', bridgeInstance: null, presentBefore: true,
    presentAfterDispose: true, sentinelIntact: true, bridgeOriginRemoveSceneCalls: 0, bridgeOriginRemoveMeshOnForeign: 1, netAddMinusRemove: 0,
  });
  const outlines = r.table.find((t) => t.scene === OUTLINES);
  assert.equal(outlines.sentinelIntact, null);
  assert.equal(outlines.presentAfterDispose, false);
  assert.equal(outlines.bridgeOriginRemoveSceneCalls, 1);
});

test('oracle: a synthetic BAD ledger must FAIL -- bridge removeScene of a foreign scene', () => {
  const s = runScenario();
  const bad = { ...s, ledger: injectSyntheticRemoveScene(s.ledger, MARKERS) };
  const r = sceneOwnershipOracle(bad);
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.clauses.c3, false);
  assert.ok(r.violations.some((v) => v.detail === 'bridge-removed-foreign-scene' && v.scene === MARKERS && v.record.synthetic === true));
  assert.equal(r.table.find((t) => t.scene === MARKERS).bridgeOriginRemoveSceneCalls, 1);
  assert.equal(r.table.find((t) => t.scene === MARKERS).sentinelIntact, false);
});

test('oracle: real scene state violating ownership (foreign scene removed / panel scene left behind) FAILs c2 / c1', () => {
  const missing = runScenario({ tweak: (c) => c.recorder.withOrigin('bridge', () => c.overlays.removeScene(FOREIGN)) });
  const r1 = sceneOwnershipOracle(missing);
  assert.equal(r1.verdict, 'FAIL');
  assert.equal(r1.clauses.c2, false);
  assert.equal(r1.clauses.c3, false);
  const leaked = runScenario({ tweak: (c) => c.recorder.withOrigin('bridge', () => c.overlays.addScene(OUTLINES)) });
  const r2 = sceneOwnershipOracle(leaked);
  assert.equal(r2.verdict, 'FAIL');
  assert.equal(r2.clauses.c1, false);
});

test('oracle: bridge removing a harness sentinel mesh, or a mesh it never added, FAILs c3 (reference equality by refId)', () => {
  const sentinel = runScenario({ tweak: (c) => c.recorder.withOrigin('bridge', () => c.overlays.removeMesh(c.S1, MARKERS)) });
  const r1 = sceneOwnershipOracle(sentinel);
  assert.equal(r1.verdict, 'FAIL');
  assert.ok(r1.violations.some((v) => v.detail === 'bridge-removed-sentinel-mesh'));
  const stranger = runScenario({ tweak: (c) => c.recorder.withOrigin('bridge', () => c.overlays.removeMesh({ name: 'lookalike of the marker' }, MARKERS)) });
  const r2 = sceneOwnershipOracle(stranger);
  assert.equal(r2.verdict, 'FAIL');
  assert.ok(r2.violations.some((v) => v.detail === 'bridge-removed-mesh-it-did-not-add'));
});

test('oracle: net addMesh - removeMesh by bridge origin must be zero per scene (leak and over-removal both FAIL c4)', () => {
  const leak = runScenario({ tweak: (c) => c.recorder.withOrigin('bridge', () => c.overlays.addMesh({ name: 'leaked' }, OUTLINES)) });
  const r1 = sceneOwnershipOracle(leak);
  assert.equal(r1.verdict, 'FAIL');
  assert.equal(r1.clauses.c4, false);
  assert.equal(r1.table.find((t) => t.scene === OUTLINES).netAddMinusRemove, 1);
  const over = runScenario({ tweak: (c) => c.recorder.withOrigin('bridge', () => c.overlays.removeMesh(c.outline, OUTLINES)) });
  assert.equal(sceneOwnershipOracle(over).clauses.c4, false);
});

test('oracle: harness-origin overlay mutations are not charged to the bridge; unattributed calls are reported, not attributed', () => {
  const s = runScenario({ tweak: (c) => { c.recorder.withOrigin('harness', () => c.overlays.removeMesh(c.S1, MARKERS)); c.overlays.addScene('orphan'); } });
  const r = sceneOwnershipOracle({ ...s, presentAfterDispose: { ...s.presentAfterDispose } });
  assert.equal(r.clauses.c3, true);
  assert.equal(r.unattributedOverlayCalls, 1);
});

test('oracle: invalid or incomplete input fails closed', () => {
  const s = runScenario();
  for (const bad of [
    { ...s, scenes: [] },
    { ...s, scenes: null },
    { ...s, ledger: null },
    { ...s, presentAfterDispose: null },
    { ...s, scenes: [{ scene: 'x', class: 'weird' }] },
    { ...s, scenes: [s.scenes[0], s.scenes[0]] },
  ]) {
    const r = sceneOwnershipOracle(bad);
    assert.equal(r.verdict, 'FAIL');
    assert.equal(r.violations[0].clause, 'input');
  }
  const missingPresence = sceneOwnershipOracle({ ...s, presentAfterDispose: { [OUTLINES]: false, [MARKERS]: true } });
  assert.equal(missingPresence.verdict, 'FAIL');
  const noScene = { ...s, ledger: [...s.ledger, { callIndex: 99, method: 'overlays.removeScene', origin: 'bridge', argSummaries: [{ kind: 'number', value: 1 }], argRefIds: [null] }] };
  assert.equal(sceneOwnershipOracle(noScene).verdict, 'FAIL');
});

test('N3: the oracle discriminates (real ledger PASS, mutated copy FAIL); the real ledger is untouched; a blind oracle is NOT_DETECTED', () => {
  const s = runScenario();
  const before = JSON.stringify(s.ledger);
  const n3 = runSceneOwnershipControlN3(s);
  assert.equal(n3.state, 'DETECTED_RESTORED');
  assert.deepEqual([n3.realVerdict, n3.mutatedVerdict], ['PASS', 'FAIL']);
  assert.equal(JSON.stringify(s.ledger), before);
  const alwaysPass = () => ({ verdict: 'PASS', violations: [] });
  assert.equal(runSceneOwnershipControlN3({ ...s, oracle: alwaysPass }).state, 'NOT_DETECTED');
  const alwaysFail = () => ({ verdict: 'FAIL', violations: [] });
  assert.equal(runSceneOwnershipControlN3({ ...s, oracle: alwaysFail }).state, 'NOT_DETECTED');
  // a bad real ledger is not a valid control baseline either
  const badReal = { ...s, ledger: injectSyntheticRemoveScene(s.ledger, FOREIGN) };
  assert.equal(runSceneOwnershipControlN3(badReal).state, 'NOT_DETECTED');
});

// ------------------------------------------------------------------------------------------
// indeterminate cleanup ownership fails closed (procedure row 2 / row 7; plan §8, G-8)
// ------------------------------------------------------------------------------------------
test('G-8: closeContext timeout with no ownership probe => indeterminate recorded AND cleanupUnresolvedOwnership (row 2), never PARTIAL', async () => {
  const r = await runCleanup(
    { steps: allSteps([], { closeContext: () => new Promise(() => {}) }) },
    { stepDeadlinesMs: { closeContext: 15 } },
  );
  assert.equal(r.cleanupStepStatus.closeContext, 'timed-out');
  assert.equal(r.cleanupFailures[0].ownership, 'indeterminate');
  assert.equal(r.cleanupUnresolvedOwnership, true);
});

test('G-8: closeContext throw without a probe, and a timed-out step whose probe throws, both set cleanupUnresolvedOwnership', async () => {
  const a = await runCleanup({ steps: allSteps([], { closeContext: () => { throw new Error('ctx'); } }) });
  assert.equal(a.cleanupFailures[0].ownership, 'indeterminate');
  assert.equal(a.cleanupUnresolvedOwnership, true);
  const b = await runCleanup(
    { steps: allSteps([], { closePage: { run: () => new Promise(() => {}), ownershipRemains: () => { throw new Error('probe dead'); } } }) },
    { stepDeadlinesMs: { closePage: 15 } },
  );
  assert.equal(b.cleanupFailures[0].ownership, 'indeterminate');
  assert.equal(b.cleanupUnresolvedOwnership, true);
});

test('G-8: only resolved-ownership failures leave cleanupUnresolvedOwnership false (PARTIAL-eligible); a mix with one indeterminate is unresolved', async () => {
  const resolved = { run: () => { throw new Error('x'); }, ownershipRemains: () => false };
  const a = await runCleanup({ steps: allSteps([], { closePage: resolved, showHiddenNodes: resolved }) });
  assert.deepEqual(a.cleanupFailures.map((f) => f.ownership), ['resolved', 'resolved']);
  assert.equal(a.cleanupUnresolvedOwnership, false);
  const b = await runCleanup({ steps: allSteps([], { showHiddenNodes: resolved, closeContext: () => { throw new Error('x'); } }) });
  assert.deepEqual(b.cleanupFailures.map((f) => f.ownership), ['resolved', 'indeterminate']);
  assert.equal(b.cleanupUnresolvedOwnership, true);
});
