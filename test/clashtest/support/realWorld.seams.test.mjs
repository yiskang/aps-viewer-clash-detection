// test/clashtest/support/realWorld.seams.test.mjs
//
// Task P7.8 Step 11 (P7.8b-1): smoke contracts for the seams `realWorld.mjs` gained for the six
// real-world families (F1-F6). Each seam is exercised against a REAL `CollisionWorld`, so a later
// family that builds on it cannot pass on a seam that silently does nothing. The Steps 1-10
// behaviour of the default fixture is pinned by `integration/differential.test.mjs` itself (its
// exact-vs-reference arms and AC-4/AC-6 digests run on the defaulted options).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameBudgetMs } from '../../../collision/constants.js';
import { createClashTestEngine } from '../../../clashtest/index.js';
import {
  makeRealWorldFixture, recordFindClashes, countWorldLifecycleCalls, createRecordingUnitExecutor,
} from './realWorld.mjs';
import { createFakeClock } from './fakeClock.mjs';

const ORIGIN = [0, 0, 0];
const NEAR = [0.25, 0, 0];
const FAR = [50, 0, 0];

const wholeTarget = (fx, sourceKey, sourceDbIds, targetKey) => ({
  source: { model: fx.modelFor(sourceKey), dbIds: sourceDbIds },
  target: { targets: [{ model: fx.modelFor(targetKey) }] },
  mode: 'volume-overlap', groupBy: 'dbId',
});
const reasonsOf = (statistics) => statistics.diagnostics.map((d) => d.reason);

// The AC-17 owner-class layout (F2's fixture): root 100 holds nested owner 900 (fragment 1); root 200
// owns fragment 0; fragment 2 is loaded, owned by 900 and in NO root subtree; fragment 3 belongs to
// 950 and to nothing reachable.
const OWNER_CLASS_MODELS = {
  m: { tree: [{ dbId: 100, children: [{ dbId: 900, fragments: [1] }] }, { dbId: 200, fragments: [0] }],
       positions: { 0: [0, 5, 0], 1: FAR, 2: ORIGIN, 3: NEAR } },
  x: { 700: [NEAR] },
};
const OWNER_CLASS_FRAGMENTS = { m: { fragmentCount: 4, ownerDbIdOverrides: new Map([[2, 900], [3, 950]]) } };

test('seam: the tree form + `fragments` build the mock model AND a matching enumerator (owner classes)', async () => {
  const fx = await makeRealWorldFixture({ models: OWNER_CLASS_MODELS, fragments: OWNER_CLASS_FRAGMENTS });
  const binding = fx.registry.bindingFor('m');
  const whole = await fx.enumerator.resolveRoots(binding, 'whole', null);
  assert.deepEqual(whole.roots.map((r) => [r.dbId, r.fragmentCount, r.ownerDbIds]), [[100, 1, [900]], [200, 1, [200]]]);
  assert.deepEqual(whole.unreachable, { count: 2, ownerDbIds: [900, 950], unattributable: { notLoaded: 0, ownerUnresolvable: 0 } });
  assert.equal(whole.population.count, 4, 'the population is every fragId 0..fragmentCount-1');
  assert.equal(whole.ownerMismatch.count, 0);
  // The library sees the SAME model: as a whole-model target, fragment 2 (owner 900 via the override)
  // and fragment 3 (owner 950) are extracted, and both overlap x:700.
  const { pairs, statistics } = await fx.world.findClashes(wholeTarget(fx, 'x', [700], 'm'));
  assert.deepEqual(pairs.map((p) => [p.source.dbId, p.target.dbId]).sort(), [[700, 900], [700, 950]]);
  assert.deepEqual(statistics.diagnostics, []);
});

test('seam: `fragments` classifies unreachable not-loaded / owner-unresolvable fragments like the library', async () => {
  const fx = await makeRealWorldFixture({
    models: { t: { tree: [{ dbId: 1, fragments: [0, 1] }], positions: { 0: NEAR } }, s: { 10: [ORIGIN] } },
    // fragment 1 is tree-reachable and not loaded (NOT unattributable); 2 is unreachable and not
    // loaded (N); 3 is unclaimed (U).
    fragments: { t: { fragmentCount: 4, notLoadedFragIds: [1, 2] } },
  });
  const whole = await fx.enumerator.resolveRoots(fx.registry.bindingFor('t'), 'whole', null);
  assert.deepEqual(whole.unreachable, { count: 0, ownerDbIds: [], unattributable: { notLoaded: 1, ownerUnresolvable: 1 } });
  const { statistics } = await fx.world.findClashes(wholeTarget(fx, 's', [10], 't'));
  assert.deepEqual(reasonsOf(statistics).sort(), ['fragment-not-loaded', 'fragment-not-loaded', 'fragment-owner-unresolvable']);
});

test('seam: `renderProxy` / `setRenderProxyAvailable` gate one fragment; the REAL world reports geometry readiness', async () => {
  const fx = await makeRealWorldFixture({
    models: { a: { 1: [ORIGIN] }, b: { 2: [NEAR] } },
    renderProxy: (modelKey) => modelKey !== 'b',
  });
  const query = { source: { model: fx.modelFor('a'), dbIds: [1] }, target: { targets: [{ model: fx.modelFor('b'), dbIds: [2] }] },
    mode: 'volume-overlap', groupBy: 'dbId' };
  const gated = await fx.world.findClashes(query);
  assert.deepEqual(gated.pairs, []);
  assert.ok(reasonsOf(gated.statistics).includes('geometry-not-yet-available'), JSON.stringify(gated.statistics.diagnostics));
  fx.setRenderProxyAvailable('b', 0, true);                               // b's only fragment is fragId 0
  const open = await fx.world.findClashes(query);                          // the SAME world
  assert.deepEqual(open.pairs.map((p) => [p.source.dbId, p.target.dbId]), [[1, 2]]);
  assert.deepEqual(open.statistics.diagnostics, []);
  fx.setRenderProxyAvailable('b', 0, false);
  assert.deepEqual((await fx.world.findClashes(query)).pairs.length, 1, 'a settled BVH is not re-read through the proxy');
  assert.throws(() => fx.setRenderProxyAvailable('zz', 0, true), /unknown modelKey/);
  assert.throws(() => fx.setRenderProxyAvailable('b', 0, 1), /must be a boolean/, 'no silent coercion (review M-6)');
});

test('seam: `worldOptions` injects a counted fake clock -- every library checkpoint yields', async () => {
  const clock = createFakeClock({ tickMs: frameBudgetMs });
  const seen = [];
  clock.onYield((n) => { seen.push(n); });
  const fx = await makeRealWorldFixture({ models: { a: { 1: [ORIGIN] }, b: { 2: [NEAR] } },
    worldOptions: { now: clock.now, yieldToScheduler: clock.yieldToScheduler } });
  const { pairs } = await fx.world.findClashes(wholeTarget(fx, 'a', [1], 'b'));
  assert.equal(pairs.length, 1);
  assert.ok(clock.yieldCount > 0, 'the injected yield hook fired');
  assert.deepEqual(seen, Array.from({ length: clock.yieldCount }, (_, i) => i + 1), 'yields are counted, in order');
});

test('seam: `register` binds only the named models; the world still serves the others', async () => {
  const fx = await makeRealWorldFixture({ models: { a: { 1: [ORIGIN] }, b: { 2: [NEAR] } }, register: ['a'] });
  assert.notEqual(fx.registry.bindingFor('a'), null);
  assert.equal(fx.registry.bindingFor('b'), null);
  const { pairs } = await fx.world.findClashes(wholeTarget(fx, 'a', [1], 'b'));
  assert.equal(pairs.length, 1, 'an unregistered model is still in the world');
  await assert.rejects(() => makeRealWorldFixture({ models: { a: { 1: [ORIGIN] } }, register: ['nope'] }), /unknown modelKey/);
});

test('seam: a direct priming call is visible through the public epoch instance count (F4a/F4c)', async () => {
  const fx = await makeRealWorldFixture({ models: { a: { 1: [ORIGIN], 3: [FAR] }, b: { 2: [NEAR], 4: [FAR, FAR] } } });
  const epochOf = (key) => fx.registry.bindingFor(key).lease.epoch;
  assert.equal(fx.world.getEpochCollisionInstanceCount(epochOf('b')), 0);
  await fx.world.findClashes({ source: { model: fx.modelFor('a'), dbIds: [3] },
    target: { targets: [{ model: fx.modelFor('b'), dbIds: [4] }] }, mode: 'volume-overlap', groupBy: 'dbId', broadPhase: 'linear' });
  assert.equal(fx.world.getEpochCollisionInstanceCount(epochOf('b')), 2, 'b:4 owns two fragments');
  assert.equal(fx.world.getEpochCollisionInstanceCount(epochOf('a')), 1);
});

test('seam: countWorldLifecycleCalls counts the real calls and restores the prototype methods', async () => {
  const fx = await makeRealWorldFixture({ models: { a: { 1: [ORIGIN] }, b: { 2: [NEAR] } } });
  const proto = Object.getPrototypeOf(fx.world);
  const counts = countWorldLifecycleCalls(fx.world);
  fx.world.invalidateModelPlacement(fx.modelFor('a'));
  fx.world.evictModel(fx.modelFor('b'));
  assert.equal(fx.registry.bindingFor('b'), null, 'the real eviction happened');
  assert.deepEqual({ ...counts }, { evictModel: 1, dispose: 0, invalidateModelPlacement: 1 });
  counts.restore();
  for (const name of ['evictModel', 'dispose', 'invalidateModelPlacement']) {
    assert.equal(Object.hasOwn(fx.world, name), false);
    assert.equal(fx.world[name], proto[name]);
  }
  fx.world.dispose();
  assert.equal(counts.dispose, 0, 'a call after restore() is not counted');
});

test('seam: createRecordingUnitExecutor is the default executor, recorded -- same sealed set as the engine default', async () => {
  const models = { a: { 1: [ORIGIN], 3: [FAR] }, b: { 2: [NEAR] } };
  const def = { schemaVersion: 1, testId: 'seam-exec', revision: 1, name: 'seam-exec', mode: 'volume-overlap',
    selectionA: { entries: [{ kind: 'model', modelKey: 'a' }] }, selectionB: { entries: [{ kind: 'model', modelKey: 'b' }] } };
  const runWith = async (recording) => {
    const fx = await makeRealWorldFixture({ models });
    const clock = createFakeClock();
    const recorder = recording ? createRecordingUnitExecutor(fx, { now: clock.now, yieldToScheduler: clock.yieldToScheduler }) : null;
    const engine = createClashTestEngine({ world: fx.world, enumerator: fx.enumerator, now: clock.now,
      yieldToScheduler: clock.yieldToScheduler, scheduleTimeout: () => () => {},
      ...(recorder ? { unitExecutor: recorder.unitExecutor } : {}) });
    const { resultSet } = await engine.startRun(def, { maxSourceDbIdsPerUnit: 1 }).done;
    return { resultSet, outcomes: recorder?.outcomes ?? null };
  };
  const plain = await runWith(false);
  const recorded = await runWith(true);
  assert.equal(recorded.resultSet.outcome.status, 'completed');
  assert.equal(recorded.resultSet.digests.pairSetDigest, plain.resultSet.digests.pairSetDigest);
  assert.equal(recorded.resultSet.digests.ledgerDigest, plain.resultSet.digests.ledgerDigest);
  assert.deepEqual(recorded.outcomes.map((o) => o.outcome.unitId), recorded.resultSet.ledger.units.map((u) => u.unitId));
  assert.ok(recorded.outcomes.every((o) => o.outcome.outcome === 'evaluated' && Array.isArray(o.outcome.diagnostics)));
  assert.equal(recorded.outcomes.reduce((n, o) => n + o.outcome.pairs.length, 0), recorded.resultSet.results.length);
});

test('seam: recordFindClashes and countWorldLifecycleCalls refuse to stack on an existing override', async () => {
  const fx = await makeRealWorldFixture({ models: { a: { 1: [ORIGIN] } } });
  const r = recordFindClashes(fx.world);
  assert.throws(() => recordFindClashes(fx.world), /already overridden/);
  r.restore();
  const c = countWorldLifecycleCalls(fx.world);
  assert.throws(() => countWorldLifecycleCalls(fx.world), /already overridden/);
  c.restore();
});
