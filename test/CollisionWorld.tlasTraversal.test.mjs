// test/CollisionWorld.tlasTraversal.test.mjs
//
// Task 12 (M2 Batch 4): target-scope membership filter.
// Task 13 (M2 Batch 4): the atomic TLAS traversal integration -- `_runTlasBroadPhase`,
// `_getTlasEntryForEpoch`, `_resolvePlacedFromTlasRecord`, and findClashes's real dispatch on
// `query.broadPhase === 'tlas'`.
//
// `CollisionWorld._addToTargetScopeFilter(filterByModel, model, dbIds, records)` is the plan's own
// `buildTargetScopeFilter` reworked to consume records findClashes's EXISTING per-targets-entry
// extraction loop already produces, rather than re-extracting a second time (per the plan's own
// note: "reuse the SAME extraction result Task 8 already computed... adjust this helper's
// signature accordingly once the real call site is in hand"). It is additive here -- not yet
// consumed by any broad-phase path (Task 13's job) -- so every test below calls it directly, using
// REAL extractFragments/extractAllFragments output as `records` for the assembly-rooted/whole-model
// cases, exactly like test/CollisionWorld.placementIndex.test.mjs's own established pattern of
// testing a purely-additive private method by reaching into it directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../collision/CollisionWorld.js';
import { CapacityExceededError } from '../collision/errors.js';
import { maxTlasCandidatePairs, maxCollisionInstancesPerEpoch } from '../collision/constants.js';
import { extractFragments, extractAllFragments } from '../collision/viewer/ViewerModelAdapter.js';
import { buildMockModel } from './fixtures/mockInstanceTree.mjs';

function boundsOf(geometry, [x, y, z]) {
  const g = geometry.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  g.computeBoundingBox();
  return { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}
const translationMatrix = ([x, y, z]) => new THREE.Matrix4().makeTranslation(x, y, z).toArray();
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

function makeFixture(rootNodes, fragSpecs = {}, modelOptions = {}) {
  const fragmentGeometry = new Map();
  for (const [fragIdKey, spec] of Object.entries(fragSpecs)) {
    const fragId = Number(fragIdKey);
    const at = spec.at || [0, 0, 0];
    fragmentGeometry.set(fragId, {
      geometryIndex: spec.geometryIndex,
      matrix: translationMatrix(at),
      bounds: spec.bounds || (spec.geometry ? boundsOf(spec.geometry, at) : { min: at, max: at }),
    });
  }
  const { model: baseModel } = buildMockModel(rootNodes, fragmentGeometry, modelOptions);
  return { ...baseModel, id: 1, getUnitScale: () => 1 };
}

function noopCheckpoint() { return undefined; }
function frozenClock() { return () => 0; }
// A checkpoint-port stand-in for unit-level tests calling _getTlasEntryForEpoch/_runTlasBroadPhase
// directly: real composite checkpoints (Task 14) expose `.assertCurrent()`, which these two methods
// now call before retrying (whole-batch review finding #2) -- a bare `() => undefined` lacks that
// property and would throw `TypeError: checkpoint.assertCurrent is not a function` the moment any
// retry path is exercised.
function fakeCheckpoint(assertCurrent = () => {}) {
  const cp = () => undefined;
  cp.assertCurrent = assertCurrent;
  return cp;
}

async function freshWorld(viewer = null, extra = {}) {
  return CollisionWorld.fromViewer(viewer, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone', ...extra });
}

test('an explicit-dbIds targets entry filters TLAS candidates to that entry\'s extracted fragment set', async () => {
  const model = makeFixture(
    [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }],
    { 100: { geometryIndex: 0 }, 200: { geometryIndex: 0 } },
  );
  const records = await extractFragments(model, [10], 1, { checkpoint: noopCheckpoint });
  const world = await freshWorld();
  const filterByModel = new Map();
  world._addToTargetScopeFilter(filterByModel, model, [10], records);
  const scope = filterByModel.get(model);
  assert.ok(scope instanceof Set, 'a narrow dbIds entry produces a real membership Set, not whole-model');
  assert.deepEqual([...scope], [100], 'only fragment 100 (under requested dbId 10) is in scope');
});

test('an assembly-rooted targets entry does NOT false-negative-exclude its own descendant fragments', async () => {
  // The exact bug the targeted design-resolution pass found and fixed in already-accepted text
  // (spec §7.1a): a filter comparing ownerDbId directly against requested dbIds would wrongly
  // exclude every descendant fragment of an assembly-rooted target request.
  const model = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 11, fragments: [101] }] }],
    { 100: { geometryIndex: 0 }, 101: { geometryIndex: 0 } },
  );
  const records = await extractFragments(model, [1], 1, { checkpoint: noopCheckpoint }); // requested dbId is the ASSEMBLY root
  const world = await freshWorld();
  const filterByModel = new Map();
  world._addToTargetScopeFilter(filterByModel, model, [1], records);
  const scope = filterByModel.get(model);
  assert.deepEqual([...scope].sort(), [100, 101],
    'both descendant fragments (owned by child dbIds 10/11, not the requested root 1) are in scope');
});

test('two targets entries naming the same model union their extracted-fragment-membership sets', async () => {
  const model = makeFixture(
    [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }],
    { 100: { geometryIndex: 0 }, 200: { geometryIndex: 0 } },
  );
  const world = await freshWorld();
  const filterByModel = new Map();
  const recordsA = await extractFragments(model, [10], 1, { checkpoint: noopCheckpoint });
  world._addToTargetScopeFilter(filterByModel, model, [10], recordsA);
  const recordsB = await extractFragments(model, [20], 1, { checkpoint: noopCheckpoint });
  world._addToTargetScopeFilter(filterByModel, model, [20], recordsB);
  assert.deepEqual([...filterByModel.get(model)].sort(), [100, 200]);
});

test('if ANY duplicate targets entry for a model omits dbIds, whole-model scope wins for that epoch', async () => {
  const model = makeFixture(
    [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }],
    { 100: { geometryIndex: 0 }, 200: { geometryIndex: 0 } },
  );
  const world = await freshWorld();

  // Order 1: narrow entry processed FIRST, whole-model SECOND -- whole-model must still win.
  const filterByModel1 = new Map();
  const recordsNarrow = await extractFragments(model, [10], 1, { checkpoint: noopCheckpoint });
  world._addToTargetScopeFilter(filterByModel1, model, [10], recordsNarrow);
  world._addToTargetScopeFilter(filterByModel1, model, undefined, new Map());
  assert.equal(filterByModel1.get(model), 'whole-model');

  // Order 2: whole-model processed FIRST -- a later narrower entry must NOT override it back to a Set.
  const filterByModel2 = new Map();
  world._addToTargetScopeFilter(filterByModel2, model, undefined, new Map());
  world._addToTargetScopeFilter(filterByModel2, model, [10], recordsNarrow);
  assert.equal(filterByModel2.get(model), 'whole-model');
});

test('a targets entry with dbIds omitted applies no filter at all (every matched primitive is in scope)', async () => {
  const model = makeFixture(
    [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }],
    { 100: { geometryIndex: 0 }, 200: { geometryIndex: 0 } },
  );
  const { records } = await extractAllFragments(model, 1, { checkpoint: noopCheckpoint });
  const world = await freshWorld();
  const filterByModel = new Map();
  world._addToTargetScopeFilter(filterByModel, model, undefined, records);
  assert.equal(filterByModel.get(model), 'whole-model',
    'the sentinel, not a Set built from the whole-model records -- callers treat this as "no filter"');
});

// === Task 13: atomic TLAS traversal integration =================================================

/**
 * Two independent models sharing one viewer -- mirrors
 * test/CollisionWorld.findClashes.crossModel.test.mjs's own `makeTwoModelFixture`, duplicated here
 * rather than imported (that file does not export it; this file's own single-model `makeFixture`
 * above is not reusable for a two-model case).
 */
function makeTwoModelFixture(opts = {}) {
  const {
    rootNodesA = [{ dbId: 1, fragments: [] }], fragSpecsA = {}, modelOptionsA = {},
    rootNodesB = [{ dbId: 1, fragments: [] }], fragSpecsB = {}, modelOptionsB = {},
  } = opts;
  const rawGeometryByFragIdA = new Map();
  const fragmentGeometryA = new Map();
  for (const [fragIdKey, spec] of Object.entries(fragSpecsA)) {
    const fragId = Number(fragIdKey);
    const at = spec.at || [0, 0, 0];
    fragmentGeometryA.set(fragId, { geometryIndex: spec.geometryIndex, matrix: translationMatrix(at), bounds: spec.bounds || (spec.geometry ? boundsOf(spec.geometry, at) : { min: at, max: at }) });
    if (spec.geometry) rawGeometryByFragIdA.set(fragId, spec.geometry);
  }
  const rawGeometryByFragIdB = new Map();
  const fragmentGeometryB = new Map();
  for (const [fragIdKey, spec] of Object.entries(fragSpecsB)) {
    const fragId = Number(fragIdKey);
    const at = spec.at || [0, 0, 0];
    fragmentGeometryB.set(fragId, { geometryIndex: spec.geometryIndex, matrix: translationMatrix(at), bounds: spec.bounds || (spec.geometry ? boundsOf(spec.geometry, at) : { min: at, max: at }) });
    if (spec.geometry) rawGeometryByFragIdB.set(fragId, spec.geometry);
  }
  const modelA = { ...buildMockModel(rootNodesA, fragmentGeometryA, modelOptionsA).model, id: 1, getUnitScale: () => 1 };
  const modelB = { ...buildMockModel(rootNodesB, fragmentGeometryB, modelOptionsB).model, id: 2, getUnitScale: () => 1 };
  const viewer = {
    impl: {
      getRenderProxy(queriedModel, fragId) {
        const map = queriedModel === modelA ? rawGeometryByFragIdA : queriedModel === modelB ? rawGeometryByFragIdB : null;
        const geometry = map?.get(fragId);
        return geometry ? { geometry } : null;
      },
    },
  };
  return { modelA, modelB, viewer };
}

test('broadPhase:"tlas" and broadPhase:"linear" produce IDENTICAL pairs for the same cross-model fixture', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }],
    fragSpecsA: { 10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [
      { dbId: 1, fragments: [100] }, // clashes
      { dbId: 2, fragments: [200] }, // disjoint AABB, does not clash
      { dbId: 3, fragments: [300] }, // clashes
    ],
    fragSpecsB: {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [50, 0, 0] },
      300: { geometryIndex: 2, geometry: box(2, 2, 2), at: [0, 0, 0] },
    },
  });
  const runQuery = async (broadPhase) => {
    const world = await freshWorld(viewer, { now: frozenClock() });
    return world.findClashes({
      source: { model: modelA, dbIds: [1] },
      target: { targets: [{ model: modelB, dbIds: [1, 2, 3] }] },
      mode: 'surface-intersection', groupBy: 'dbId', broadPhase,
    });
  };
  const key = (p) => `${p.source.modelId}:${p.source.dbId}:${p.target.modelId}:${p.target.dbId}`;
  const linearResult = await runQuery('linear');
  const tlasResult = await runQuery('tlas');
  assert.equal(linearResult.pairs.length, 2, 'sanity: the fixture has exactly 2 real clashes');
  assert.deepEqual(linearResult.pairs.map(key).sort(), tlasResult.pairs.map(key).sort());
});

test('broadPhase:"tlas" and broadPhase:"linear" agree for a whole-model target scope too', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }],
    fragSpecsA: { 10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [
      { dbId: 1, fragments: [100] },
      { dbId: 2, fragments: [200] },
      { dbId: 3, fragments: [300] },
    ],
    fragSpecsB: {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [50, 0, 0] },
      300: { geometryIndex: 2, geometry: box(2, 2, 2), at: [0, 0, 0] },
    },
  });
  const runQuery = async (broadPhase) => {
    const world = await freshWorld(viewer, { now: frozenClock() });
    return world.findClashes({
      source: { model: modelA, dbIds: [1] },
      target: { targets: [{ model: modelB }] }, // whole-model scope
      mode: 'surface-intersection', groupBy: 'dbId', broadPhase,
    });
  };
  const key = (p) => `${p.source.modelId}:${p.source.dbId}:${p.target.modelId}:${p.target.dbId}`;
  const linearResult = await runQuery('linear');
  const tlasResult = await runQuery('tlas');
  assert.equal(linearResult.pairs.length, 2);
  assert.deepEqual(linearResult.pairs.map(key).sort(), tlasResult.pairs.map(key).sort());
});

test('a narrow explicit-dbIds target scope excludes a spatially-overlapping fragment the TLAS itself still covers (Task 12 filter applied on the TLAS path)', async () => {
  // dbId 2's fragment genuinely overlaps the source -- but this call's own targets entry requests
  // ONLY dbId 1, so the TLAS-path result must exclude dbId 2's candidate even though the shared
  // per-epoch TLAS (built from the WHOLE epoch's placement table) would otherwise surface it.
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }],
    fragSpecsA: { 10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [100] }, { dbId: 2, fragments: [200] }],
    fragSpecsB: {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [0, 0, 0] }, // also overlaps source
    },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  // Prime the epoch's placement table / TLAS with BOTH dbIds first (whole-model scope), so the
  // cached TLAS genuinely contains dbId 2's fragment before the narrow-scope call below runs.
  await world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB }] },
    mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'linear',
  });
  const result = await world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB, dbIds: [1] }] }, // narrow -- dbId 2 excluded from SCOPE, not from the TLAS
    mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'tlas',
  });
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].target.dbId, 1);
});

test('CRITICAL regression: a repeated real query re-extracting the SAME fragment under a DIFFERENT dbId reports the CURRENT ownerDbId via broadPhase:"tlas", matching linear exactly -- never the FIRST call\'s now-stale cached ownerDbId', async () => {
  // codex-advisor review, Critical #1, reproduced end-to-end with two REAL sequential findClashes
  // calls on the SAME world (the exact class of case the fresh-world-only differential tests above
  // structurally cannot catch). Fragment 100 is reachable under BOTH target dbIds 1 and 2 (a real,
  // already-tested extraction scenario -- test/viewer/ViewerModelAdapter.test.mjs's own "reported
  // under two of the call's own requested dbIds" fixture, here split across two SEPARATE calls
  // instead of one call's own two dbIds).
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }],
    fragSpecsA: { 10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [100] }, { dbId: 2, fragments: [100] }], // fragment 100 shared by both dbIds
    fragSpecsB: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });

  const first = await world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB, dbIds: [1] }] }, // fragment 100 admitted with ownerDbId 1
    mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'tlas',
  });
  assert.equal(first.pairs.length, 1);
  assert.equal(first.pairs[0].target.dbId, 1, 'sanity: the FIRST call reports ownerDbId 1');

  const second = await world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB, dbIds: [2] }] }, // SAME fragment 100, now requested via dbId 2
    mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'tlas',
  });
  assert.equal(second.pairs.length, 1);
  assert.equal(second.pairs[0].target.dbId, 2,
    'the SECOND call must report the CURRENT ownerDbId (2), never the FIRST call\'s stale cached ownerDbId (1)');

  // Cross-check against the linear oracle for the exact same second call, on a fresh world (the
  // linear path has no cross-call cache to go stale in the first place -- this just confirms the
  // TLAS result above genuinely matches what "correct" means here).
  const linearWorld = await freshWorld(viewer, { now: frozenClock() });
  const linearResult = await linearWorld.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB, dbIds: [2] }] },
    mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(linearResult.pairs[0].target.dbId, 2);
});

test('CRITICAL regression: whole-model scope excludes a fragment historically admitted into the SAME epoch\'s placement table but absent from the CURRENT call\'s own real extraction', async () => {
  // codex-advisor review, Critical #1's second manifestation, end-to-end. Fragment 999 is seeded
  // DIRECTLY into modelB's epoch (simulating a fragment some now-irrelevant earlier mechanism
  // admitted -- write-once, never removed by ordinary extraction) but is NOT part of modelB's real
  // mock tree at all, so a real `extractAllFragments` walk can never discover it. A genuinely
  // whole-model findClashes call must still exclude it: 'whole-model' scope has no Set filter of
  // its own to catch this, so this is testing THIS task's own current-instances membership fix, not
  // Task 12's filter.
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }],
    fragSpecsA: { 10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [100] }],
    fragSpecsB: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const leaseB = world.admitModel(modelB);
  const historical = new Map([[999, {
    fragmentId: 999,
    geometryIdentity: { loadEpoch: leaseB.epoch, geometryIndex: 0 },
    worldMatrix: new THREE.Matrix4().toArray(), worldBounds: { min: [0, 0, 0], max: [2, 2, 2] }, // co-located with source, would spuriously clash
    ownerDbId: 999,
  }]]);
  world._recordPlacement(leaseB.epoch, modelB, historical);
  world.admitCollisionInstances(leaseB, historical);

  const result = await world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB }] }, // whole-model -- must reflect ONLY the real tree's own fragment 100
    mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'tlas',
  });
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].target.dbId, 1, 'only the real clash (dbId 1, fragment 100) -- the historical phantom (999) must never surface');
});

test('maxTlasCandidatePairs is enforced incrementally across the WHOLE call, upstream of the target-scope filter', async () => {
  // Pre-seed one target epoch's placement/instance tables directly with (maxCollisionInstancesPerEpoch
  // - 1) co-located synthetic fragments, bypassing extraction entirely (this scale would be slow and
  // pointless to build via a real tree walk, and admitCollisionInstances/`_recordPlacement` are the
  // exact same tables a real extraction would populate). Leaves headroom for exactly ONE more real
  // fragment (dbId 42), which this test's OWN call requests explicitly -- a narrow scope that would
  // reduce the FINAL candidate set to just that one fragment, even though raw TLAS expansion (built
  // from the epoch's WHOLE placement table) is co-located with every source instance and therefore
  // re-encounters all (maxCollisionInstancesPerEpoch) fragments on EVERY source instance's own query.
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 0, children: Array.from({ length: 11 }, (_, i) => ({ dbId: 1000 + i, fragments: [1000 + i] })) }],
    rootNodesB: [{ dbId: 42, fragments: [999_999] }],
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const leaseB = world.admitModel(modelB);
  const preSeeded = new Map();
  for (let i = 0; i < maxCollisionInstancesPerEpoch - 1; i++) {
    const fragmentId = 500_000 + i;
    preSeeded.set(fragmentId, {
      fragmentId, // _recordPlacement keys off record.fragmentId, NOT the Map's own key -- both must agree
      geometryIdentity: { loadEpoch: leaseB.epoch, geometryIndex: 0 },
      worldMatrix: new THREE.Matrix4().toArray(), worldBounds: { min: [0, 0, 0], max: [0, 0, 0] },
      ownerDbId: 42,
    });
  }
  world._recordPlacement(leaseB.epoch, modelB, preSeeded);
  world.admitCollisionInstances(leaseB, preSeeded);
  assert.equal(world.getEpochCollisionInstanceCount(leaseB.epoch), maxCollisionInstancesPerEpoch - 1);

  // 11 co-located source instances x (maxCollisionInstancesPerEpoch, once dbId 42's own fragment is
  // added by this call's own extraction) raw candidates each >> maxTlasCandidatePairs (200,000).
  const sourceDbIds = Array.from({ length: 11 }, (_, i) => 1000 + i);
  let caught = null;
  try {
    await world.findClashes({
      source: { model: modelA, dbIds: sourceDbIds },
      target: { targets: [{ model: modelB, dbIds: [42] }] }, // narrow -- would filter 19,999 of the 20,000 raw candidates away
      mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'tlas',
    });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof CapacityExceededError);
  assert.equal(caught.kind, 'tlas-candidate-budget');
  assert.equal(caught.limit, maxTlasCandidatePairs);
  assert.equal(caught.completed, maxTlasCandidatePairs);
  assert.equal(caught.attempted, maxTlasCandidatePairs + 1);
});

test('a TLAS candidate-budget overflow never throws from inside a shapecast callback -- queryBox itself returns cleanly, truncated', async () => {
  // Focused unit-level proof, isolated from findClashes's own plumbing: a single onLeafRange
  // report that alone exceeds the budget must make queryBox return {truncated:true} with NO
  // exception escaping queryBox itself -- the caller (_runTlasBroadPhase) is what throws, and only
  // after queryBox has already returned.
  const world = await freshWorld();
  let candidateBudgetUsed = 0;
  let pendingCapacityError = null;
  const records = [];
  for (let i = 0; i < 5; i++) {
    records.push({ loadEpoch: 1, fragmentId: i, ownerDbId: i, modelId: 'm', worldBounds: { min: [0, 0, 0], max: [1, 1, 1] } });
  }
  const { CollisionInstanceBVH } = await import('../collision/tlas/CollisionInstanceBVH.js');
  const bvh = new CollisionInstanceBVH(records);
  let candidateCalls = 0;
  let thrown = null;
  let truncated;
  try {
    ({ truncated } = bvh.queryBox([0, 0, 0], [1, 1, 1], {
      onLeafRange: (offset, count) => {
        candidateBudgetUsed += count;
        if (candidateBudgetUsed > 3) { // artificially tiny "budget" for this isolated test
          pendingCapacityError = new CapacityExceededError('tlas-candidate-budget', { limit: 3, completed: 3, attempted: 4 });
          return 'stop';
        }
        return undefined;
      },
      onCandidate: () => { candidateCalls++; },
    }));
  } catch (err) {
    thrown = err;
  }
  assert.equal(thrown, null, 'queryBox itself must never throw for a budget overflow signaled via onLeafRange');
  assert.equal(truncated, true);
  assert.ok(pendingCapacityError, 'the caller-side flag was set, ready for the CALLER to throw after queryBox returns');
  void world; // fixture symmetry only -- this test does not need a real CollisionWorld call
});

test('statistics inequality chain holds for a real TLAS-path call', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }],
    fragSpecsA: { 10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [100] }],
    fragSpecsB: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const { statistics } = await world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB, dbIds: [1] }] },
    mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'tlas',
  });
  assert.ok(statistics.tlasPrimitiveCandidatePairs >= statistics.broadPhasePairs);
  assert.ok(statistics.broadPhasePairs >= statistics.tlasExactRetestSurvivors);
  assert.equal(statistics.tlasExactRetestSurvivors, statistics.tlasNarrowPhaseInputPairs);
  assert.equal(statistics.tlasNarrowPhaseInputPairs, statistics.narrowPhasePairs);
});

test('tlasBuilds/tlasCacheHits correctly attribute a cold build vs. a warm reuse', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }],
    fragSpecsA: { 10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [100] }],
    fragSpecsB: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const query = {
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB, dbIds: [1] }] },
    mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'tlas',
  };
  const first = await world.findClashes(query);
  assert.ok(first.statistics.tlasBuilds >= 1);
  assert.equal(first.statistics.tlasCacheHits, 0);
  const second = await world.findClashes(query);
  assert.equal(second.statistics.tlasBuilds, 0, 'the SAME unchanged epoch must not rebuild');
  assert.ok(second.statistics.tlasCacheHits >= 1);
});

test('_getTlasEntryForEpoch attributes tlasBuilds/tlasSharedBuildWaits/tlasCacheHits/tlasBuildMs correctly per TlasCache outcome', async () => {
  // Focused unit test of the attribution logic itself (moved INTO _getTlasEntryForEpoch, per
  // codex-advisor review Medium #5, so it is correct even across an internal retry loop), stubbing
  // world._tlasCache.getEntry/getBuiltAtRevision directly rather than forcing genuine build
  // concurrency through the full stack -- TlasCache's own hit/built/shared-wait/superseded outcomes
  // are already exhaustively tested at its own level (test/tlas/TlasCache.test.mjs).
  const world = await freshWorld();
  world._modelByEpoch.set(1, {});
  world._liveEpochs.add(1);
  const bvh = {};

  for (const [outcome, expect] of [
    ['built', { tlasBuilds: 1, tlasSharedBuildWaits: 0, tlasCacheHits: 0, buildMsPositive: true }],
    ['shared-wait', { tlasBuilds: 0, tlasSharedBuildWaits: 1, tlasCacheHits: 0, buildMsPositive: false }],
    ['hit', { tlasBuilds: 0, tlasSharedBuildWaits: 0, tlasCacheHits: 1, buildMsPositive: false }],
  ]) {
    world._tlasCache.getEntry = async () => ({ bvh, outcome, builtAtRevision: 0 });
    world._tlasCache.getBuiltAtRevision = () => 0;
    const statistics = { tlasBuilds: 0, tlasCacheHits: 0, tlasSharedBuildWaits: 0, tlasBuildMs: 0 };
    const result = await world._getTlasEntryForEpoch(1, () => undefined, statistics);
    assert.equal(result.bvh, bvh);
    assert.equal(statistics.tlasBuilds, expect.tlasBuilds, `outcome=${outcome}`);
    assert.equal(statistics.tlasSharedBuildWaits, expect.tlasSharedBuildWaits, `outcome=${outcome}`);
    assert.equal(statistics.tlasCacheHits, expect.tlasCacheHits, `outcome=${outcome}`);
    if (!expect.buildMsPositive) assert.equal(statistics.tlasBuildMs, 0, `outcome=${outcome}: tlasBuildMs must stay 0 -- this call only shared/hit an existing build`);
  }
});

test('_getTlasEntryForEpoch attributes a refresh\'s own real elapsed time to tlasBuildMs even when the eventual outcome is shared-wait, never silently dropping it to zero', async () => {
  // codex-advisor review, Medium #5's own concrete scenario: a genuine refresh happens (real time
  // spent), then the SAME iteration's getEntry call resolves to 'shared-wait' -- the refresh time
  // must still be counted, not lost because the final outcome isn't 'built'.
  let clock = 0;
  const world = await freshWorld(null, { now: () => (clock += 3) });
  world._modelByEpoch.set(1, {});
  world._liveEpochs.add(1);
  world._placementByEpoch.set(1, new Map());
  world._placementRevisionByEpoch.set(1, 5);
  world._placementInvalidatedAtRevision.set(1, 5); // pending invalidation -- triggers a refresh
  let refreshCalls = 0;
  world._refreshPlacementForEpoch = async () => {
    refreshCalls++;
    world._placementInvalidatedAtRevision.delete(1); // mirrors the REAL method's own successful-publish side effect
    return { published: true };
  };
  let builtAtRevision = -1; // never built yet -- matches TlasCache.getBuiltAtRevision's own documented convention
  world._tlasCache.getEntry = async (epoch, expectedRevision) => {
    builtAtRevision = expectedRevision; // simulate: the cache now reports this revision as built
    return { bvh: {}, outcome: 'shared-wait' };
  };
  world._tlasCache.getBuiltAtRevision = () => builtAtRevision;
  const statistics = { tlasBuilds: 0, tlasCacheHits: 0, tlasSharedBuildWaits: 0, tlasBuildMs: 0 };
  await world._getTlasEntryForEpoch(1, () => undefined, statistics);
  assert.equal(refreshCalls, 1);
  assert.equal(statistics.tlasSharedBuildWaits, 1);
  assert.ok(statistics.tlasBuildMs > 0, 'the refresh\'s own real elapsed time must be counted, not dropped to zero');
});

test('a genuine revision bump racing getEntry (not just an invalidation marker) is caught and retried, even when the marker is already cleared', async () => {
  // codex-advisor review, High #4, SECOND pass: a DIFFERENT concurrent call can refresh this same
  // epoch, publish a NEWER revision, and CLEAR the invalidation marker -- all while THIS call's own
  // getEntry was in flight. Checking only the marker (the first-pass fix) missed this: the marker
  // being gone must NOT be read as "still fresh." The unconditional revision-equality recheck must
  // catch it regardless.
  const world = await freshWorld();
  world._modelByEpoch.set(1, {});
  world._liveEpochs.add(1);
  world._placementRevisionByEpoch.set(1, 1);
  let getEntryCalls = 0;
  world._tlasCache.getEntry = async (epoch, expectedRevision) => {
    getEntryCalls++;
    if (getEntryCalls === 1) {
      // Simulate: while THIS call's own getEntry was "in flight", a DIFFERENT concurrent call
      // published revision 2 and cleared any invalidation marker -- nothing here ever set one.
      world._placementRevisionByEpoch.set(1, 2);
      return { bvh: { which: 'stale' }, outcome: 'built', builtAtRevision: expectedRevision };
    }
    return { bvh: { which: 'fresh' }, outcome: 'hit', builtAtRevision: expectedRevision };
  };
  world._tlasCache.getBuiltAtRevision = () => 2; // whatever the second call sees is irrelevant to this test
  const statistics = { tlasBuilds: 0, tlasCacheHits: 0, tlasSharedBuildWaits: 0, tlasBuildMs: 0 };
  const result = await world._getTlasEntryForEpoch(1, fakeCheckpoint(), statistics);
  assert.equal(getEntryCalls, 2, 'the stale (revision 1) result must be discarded and retried, never returned directly');
  assert.equal(result.bvh.which, 'fresh');
  // codex-advisor review, Medium #5's own reproduction: the FIRST attempt's real 'built' work must
  // still be counted, not silently dropped just because it was discarded and retried.
  assert.equal(statistics.tlasBuilds, 1, 'the discarded first attempt\'s real build work must still be attributed');
  assert.equal(statistics.tlasCacheHits, 1, 'the retry\'s own successful hit must also be attributed');
});

test('a TLAS build failure aborts the whole call as an error, never as "no candidates from this epoch"', async () => {
  const world = await freshWorld();
  const sourceOperand = { model: {}, epoch: 99, fragmentIds: new Map() };
  const sourceInstances = [{ instance: { fragmentId: 1 }, worldMatrix: new THREE.Matrix4().toArray(), worldBounds: { min: [0, 0, 0], max: [1, 1, 1] }, ownerDbId: 1 }];
  // A non-empty target group -- an empty one (whole-batch review finding #1) is now skipped
  // entirely, before ever calling _getTlasEntryForEpoch, which would defeat this test's own point.
  const targetGroups = [{ targetOperand: { model: {}, epoch: 1 }, instances: [{ instance: { fragmentId: 100 } }] }];
  world._getTlasEntryForEpoch = async () => { throw new Error('tlas build boom'); };
  const statistics = { tlasLeafRangeEmissions: 0, tlasPrimitiveCandidatePairs: 0, tlasBuilds: 0, tlasCacheHits: 0, tlasSharedBuildWaits: 0, tlasBuildMs: 0, tlasQueryMs: 0, broadPhasePairs: 0 };
  await assert.rejects(
    world._runTlasBroadPhase(sourceOperand, sourceInstances, targetGroups, new Map(), statistics, () => undefined),
    /tlas build boom/,
  );
});

test('_runTlasBroadPhase resolves a TLAS hit through the CURRENT call\'s own target instances, never the cached placement table\'s ownerDbId', async () => {
  // codex-advisor review, Critical #1's own regression: a fragment's ownerDbId in the epoch-wide
  // placement table can be STALE relative to this call's own current extraction (extraction's own
  // first-discovery-wins promise is scoped to ONE call, never cross-call-stable). This is a direct
  // unit-level proof that _runTlasBroadPhase reads ownerDbId from the group's OWN `instances`
  // (current-call data), never from `_placementByEpoch`.
  const world = await freshWorld();
  const bvh = {
    recordAt: () => ({ fragmentId: 1 }),
    queryBox: (min, max, { onLeafRange, onCandidate }) => {
      onLeafRange(0, 1);
      onCandidate(0);
      return { truncated: false };
    },
  };
  world._modelByEpoch.set(1, {});
  world._liveEpochs.add(1);
  world._tlasCache.getEntry = async () => ({ bvh, outcome: 'hit', builtAtRevision: 0 });
  world._tlasCache.getBuiltAtRevision = () => 0;
  // Deliberately STALE cached placement -- ownerDbId 999 -- which must NEVER be consulted.
  world._placementByEpoch.set(1, new Map([[1, { worldMatrix: new THREE.Matrix4().toArray(), worldBounds: { min: [0, 0, 0], max: [1, 1, 1] }, ownerDbId: 999, modelId: 'm' }]]));

  const sourceOperand = { model: {}, epoch: 99, fragmentIds: new Map() };
  const sourceInstances = [{ instance: { fragmentId: 42 }, worldMatrix: new THREE.Matrix4().toArray(), worldBounds: { min: [0, 0, 0], max: [1, 1, 1] }, ownerDbId: 7 }];
  const currentTargetPlaced = Object.freeze({
    instance: { fragmentId: 1 }, worldMatrix: new THREE.Matrix4().toArray(),
    worldBounds: { min: [0, 0, 0], max: [1, 1, 1] }, ownerDbId: 2, // the CURRENT, correct ownerDbId
  });
  const targetGroups = [{ targetOperand: { model: {}, epoch: 1 }, instances: [currentTargetPlaced] }];
  const statistics = { tlasLeafRangeEmissions: 0, tlasPrimitiveCandidatePairs: 0, tlasBuilds: 0, tlasCacheHits: 0, tlasSharedBuildWaits: 0, tlasBuildMs: 0, tlasQueryMs: 0, broadPhasePairs: 0 };
  const candidates = await world._runTlasBroadPhase(sourceOperand, sourceInstances, targetGroups, new Map(), statistics, () => undefined);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0][1].ownerDbId, 2, 'ownerDbId must come from the CURRENT call\'s own target instance, never the cached placement table');
});

test('a whole-model scope excludes a historically-admitted fragment the CURRENT call\'s own extraction no longer includes', async () => {
  // codex-advisor review, Critical #1's second manifestation: 'whole-model' scope disables the
  // Set-based filter entirely, so without the current-instances membership check, a fragment
  // admitted by an EARLIER call (and never removed from the write-once placement table) would
  // remain an eligible TLAS candidate even after THIS call's own extraction excludes it.
  const world = await freshWorld();
  const bvh = {
    recordAt: () => ({ fragmentId: 999 }), // historically-admitted, no longer in THIS call's own scope
    queryBox: (min, max, { onLeafRange, onCandidate }) => {
      onLeafRange(0, 1);
      onCandidate(0);
      return { truncated: false };
    },
  };
  world._modelByEpoch.set(1, {});
  world._liveEpochs.add(1);
  world._tlasCache.getEntry = async () => ({ bvh, outcome: 'hit', builtAtRevision: 0 });
  world._tlasCache.getBuiltAtRevision = () => 0;

  const sourceOperand = { model: {}, epoch: 99, fragmentIds: new Map() };
  const sourceInstances = [{ instance: { fragmentId: 42 }, worldMatrix: new THREE.Matrix4().toArray(), worldBounds: { min: [0, 0, 0], max: [1, 1, 1] }, ownerDbId: 7 }];
  // 'whole-model' filter (no Set) -- CURRENT call's own extraction found NOTHING (empty instances).
  const targetGroups = [{ targetOperand: { model: {}, epoch: 1 }, instances: [] }];
  const targetScopeFilter = new Map([[targetGroups[0].targetOperand.model, 'whole-model']]);
  const statistics = { tlasLeafRangeEmissions: 0, tlasPrimitiveCandidatePairs: 0, tlasBuilds: 0, tlasCacheHits: 0, tlasSharedBuildWaits: 0, tlasBuildMs: 0, tlasQueryMs: 0, broadPhasePairs: 0 };
  const candidates = await world._runTlasBroadPhase(sourceOperand, sourceInstances, targetGroups, targetScopeFilter, statistics, () => undefined);
  assert.deepEqual(candidates, [], 'the historically-admitted fragment must be excluded -- it is not part of THIS call\'s own current target scope');
});

test('invalidateModelPlacement before a broadPhase:"tlas" query triggers a real placement refresh, threading this call\'s own checkpoint through', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }],
    fragSpecsA: { 10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [100] }],
    fragSpecsB: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const query = {
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB, dbIds: [1] }] },
    mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'tlas',
  };
  await world.findClashes(query); // builds the epoch's first TLAS entry
  world.invalidateModelPlacement(modelB);

  const refreshCalls = [];
  const originalRefresh = world._refreshPlacementForEpoch.bind(world);
  world._refreshPlacementForEpoch = (...args) => { refreshCalls.push(args); return originalRefresh(...args); };

  const result = await world.findClashes(query);
  assert.equal(refreshCalls.length, 1, 'the invalidation must trigger exactly one refresh on the next tlas-consuming query');
  assert.equal(typeof refreshCalls[0][3]?.checkpoint, 'function',
    'the refresh must receive THIS call\'s own composite checkpoint, not run un-preemptibly');
  assert.equal(result.pairs.length, 1, 'the query still finds the real clash after refreshing');
});

// === Task 14: placement-revision revalidation on the composite checkpoint =======================
//
// Deviates from the plan's own suggested test file (test/CollisionWorld.placementInvalidation.test.mjs)
// -- added here instead, where the two-model TLAS fixture (`makeTwoModelFixture`) this task's own
// cross-model scenarios need already lives, rather than duplicating it into that (single-model-only)
// file. All scenarios are genuinely about TLAS-consuming queries specifically (this task's own
// stated scope), so this is a better home for them.

test('Task 14: an externally-caused placement-revision change on a captured TLAS-consulted epoch aborts the whole query', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }],
    fragSpecsA: { 10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [100] }],
    fragSpecsB: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  // Prime the epoch first (a first-ever build has nothing to "change" yet -- this test is about a
  // change landing DURING an in-progress query, not about the very first build).
  await world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB, dbIds: [1] }] },
    mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'tlas',
  });
  let firstPairSeen = false;
  const originalTestPair = world._testBroadPhasePair.bind(world);
  world._testBroadPhasePair = (...args) => {
    if (!firstPairSeen) { firstPairSeen = true; world.invalidateModelPlacement(modelB); } // a DIFFERENT, external actor
    return originalTestPair(...args);
  };
  let caught = null;
  try {
    await world.findClashes({
      source: { model: modelA, dbIds: [1] },
      target: { targets: [{ model: modelB, dbIds: [1] }] },
      mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'tlas',
    });
  } catch (err) {
    caught = err;
  }
  assert.equal(firstPairSeen, true, 'the external change really did land mid-query');
  const { ModelPlacementChangedError } = await import('../collision/errors.js');
  assert.ok(caught instanceof ModelPlacementChangedError, `expected ModelPlacementChangedError, got ${caught?.constructor?.name}`);
  assert.equal(caught.modelId, modelB.id);
  assert.equal(typeof caught.loadEpoch, 'number');
  assert.equal(typeof caught.expectedRevision, 'number');
  assert.equal(typeof caught.actualRevision, 'number');
  assert.notEqual(caught.expectedRevision, caught.actualRevision, 'ModelPlacementChangedError carries the real mismatch, not two equal numbers');
});

test('Task 14: the query does NOT invalidate itself via its own ordinary extraction growth, across TWO distinct target epochs', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }],
    fragSpecsA: { 10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [100] }],
    fragSpecsB: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  // Two target groups sharing NO prior state -- modelA's own dbId 1 fragment growing into ITS OWN
  // epoch's placement table (same-model target, self-excluded from the actual pairs) and modelB's
  // dbId 1 growing into a SECOND epoch -- both are this query's OWN first-ever extraction into each
  // epoch (genuine growth), never an external change.
  const result = await world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelA, dbIds: [1] }, { model: modelB, dbIds: [1] }] },
    mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'tlas',
  });
  assert.equal(result.pairs.length, 1, 'the real cross-model clash is found -- the call must NOT have self-aborted');
  assert.equal(result.pairs[0].target.model, modelB);
});

test('Task 14: the pre-insertion compare-and-abort check catches a foreign revision bump BEFORE this query\'s own insertion into that epoch', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }],
    fragSpecsA: { 10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [100] }],
    fragSpecsB: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  // Admit modelB (the TARGET) up front so invalidateModelPlacement (no-op for a never-admitted
  // model) has a real lease to act on the moment it's called, before this query's own admitModel
  // call for modelB even runs.
  world.admitModel(modelB);
  const originalRecordPlacement = world._recordPlacement.bind(world);
  let recordPlacementCalls = 0;
  let caughtDuringSourceInsertion = false;
  world._recordPlacement = (loadEpoch, model, extractedRecords, expectedRevisionByEpoch) => {
    recordPlacementCalls++;
    if (recordPlacementCalls === 1) {
      // This is the SOURCE epoch's own insertion (findClashes records source before any target) --
      // a foreign actor bumps modelB's (the TARGET's) placement revision here, BEFORE this query's
      // own _recordPlacement for modelB's epoch has run at all.
      world.invalidateModelPlacement(modelB);
      try {
        return originalRecordPlacement(loadEpoch, model, extractedRecords, expectedRevisionByEpoch);
      } catch (err) {
        caughtDuringSourceInsertion = true;
        throw err;
      }
    }
    return originalRecordPlacement(loadEpoch, model, extractedRecords, expectedRevisionByEpoch);
  };
  let caught = null;
  try {
    await world.findClashes({
      source: { model: modelA, dbIds: [1] },
      target: { targets: [{ model: modelB, dbIds: [1] }] },
      mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'tlas',
    });
  } catch (err) {
    caught = err;
  }
  assert.equal(caughtDuringSourceInsertion, false, 'the source epoch\'s own insertion is untracked (not the epoch that was bumped) -- it must succeed normally');
  const { ModelPlacementChangedError } = await import('../collision/errors.js');
  assert.ok(caught instanceof ModelPlacementChangedError,
    `the SECOND _recordPlacement call (modelB's own epoch) must catch the foreign bump BEFORE its own insertion, got ${caught?.constructor?.name}`);
  assert.equal(recordPlacementCalls, 2, 'both the source and target _recordPlacement calls ran (the abort happens INSIDE the second, not by skipping it)');
});

test('Task 14: placement-revision revalidation is scoped to broadPhase:"tlas" epochs only -- a pure linear call is unaffected by unrelated concurrent growth', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }],
    fragSpecsA: { 10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [100] }],
    fragSpecsB: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB, dbIds: [1] }] },
    mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'linear',
  });
  let firstPairSeen = false;
  const originalTestPair = world._testBroadPhasePair.bind(world);
  world._testBroadPhasePair = (...args) => {
    if (!firstPairSeen) { firstPairSeen = true; world.invalidateModelPlacement(modelB); }
    return originalTestPair(...args);
  };
  const result = await world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB, dbIds: [1] }] },
    mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(firstPairSeen, true, 'the unrelated concurrent change really did land mid-query');
  assert.equal(result.pairs.length, 1, 'a pure linear call never consults _placementByEpoch/a cached TLAS -- it must NOT abort on this');
});

test('Task 14: validation precedence at every checkpoint is disposed -> evicted -> placement-revision mismatch', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }],
    fragSpecsA: { 10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [100] }],
    fragSpecsB: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB, dbIds: [1] }] },
    mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'tlas',
  });
  let firstPairSeen = false;
  const originalTestPair = world._testBroadPhasePair.bind(world);
  world._testBroadPhasePair = (...args) => {
    if (!firstPairSeen) {
      firstPairSeen = true;
      world.invalidateModelPlacement(modelB); // BOTH conditions true simultaneously --
      world.dispose();                        // disposal must win.
    }
    return originalTestPair(...args);
  };
  const { WorldDisposedError } = await import('../collision/errors.js');
  let caught = null;
  try {
    await world.findClashes({
      source: { model: modelA, dbIds: [1] },
      target: { targets: [{ model: modelB, dbIds: [1] }] },
      mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'tlas',
    });
  } catch (err) {
    caught = err;
  }
  assert.equal(firstPairSeen, true);
  assert.ok(caught instanceof WorldDisposedError, `disposed must win over a placement-revision mismatch, got ${caught?.constructor?.name}`);
});

test('Task 14 (2nd codex-advisor pass): a placement change landing during a real, deferred object-tree readiness wait is caught before the empty-extraction fast-path return', async () => {
  // codex-advisor review, finding #2: the revision snapshot used to be taken AFTER this wait (an
  // earlier draft's own ordering bug), so a change landing during a REAL multi-second wait was
  // silently absorbed as the accepted baseline. Verifies the fix: the snapshot happens at true
  // lease-capture time, before this wait even starts.
  let fireSuccess = null;
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [] }], // empty source -- exercises the FAST-PATH return specifically
    rootNodesB: [{ dbId: 1, fragments: [100] }],
    fragSpecsB: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    modelOptionsB: {
      objectTreeReady: false,
      settleObjectTree: (onSuccess, _onError, instanceTree) => { fireSuccess = () => onSuccess(instanceTree); },
    },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  // The target model must already be admitted (a real lease) for invalidateModelPlacement to have
  // any effect -- true here regardless, since findClashes's own lease-capture step runs BEFORE the
  // readiness wait it's about to block on.
  const pending = world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB, dbIds: [1] }] },
    mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'tlas',
  });
  await new Promise((resolve) => setTimeout(resolve, 0)); // let findClashes reach the readiness wait
  world.invalidateModelPlacement(modelB); // lands WHILE the wait is still pending
  fireSuccess();
  const { ModelPlacementChangedError } = await import('../collision/errors.js');
  let caught = null;
  try {
    await pending;
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof ModelPlacementChangedError,
    `expected ModelPlacementChangedError from the readiness-wait's own revalidation, got ${caught?.constructor?.name}`);
});

test('Task 14 (2nd codex-advisor pass): a placement change landing during the LAST candidate\'s shared geometry-build await is caught before the final success return', async () => {
  // codex-advisor review, finding #1's own real failure mode: "invalidate a tracked target while
  // the final candidate is awaiting a shared GeometryRegistry build. Surface-intersection performs
  // no later checkpoint, and the query can return a stale result." Verifies the fix:
  // checkpoint.assertCurrent() at the final return now catches exactly this.
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }],
    fragSpecsA: { 10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [100] }],
    fragSpecsB: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const originalGetOrBuildGeometry = world._registry.getOrBuildGeometry.bind(world._registry);
  let hookFired = false;
  world._registry.getOrBuildGeometry = async (...args) => {
    if (!hookFired) {
      hookFired = true;
      // Simulate: this candidate's own geometry build is a REAL await another concurrent caller is
      // also sharing -- an external actor invalidates modelB's placement WHILE this is in flight.
      await Promise.resolve();
      world.invalidateModelPlacement(modelB);
    }
    return originalGetOrBuildGeometry(...args);
  };
  const { ModelPlacementChangedError } = await import('../collision/errors.js');
  let caught = null;
  try {
    await world.findClashes({
      source: { model: modelA, dbIds: [1] },
      target: { targets: [{ model: modelB, dbIds: [1] }] },
      mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'tlas',
    });
  } catch (err) {
    caught = err;
  }
  assert.equal(hookFired, true, 'the injected await really did run during this call\'s own narrow phase');
  assert.ok(caught instanceof ModelPlacementChangedError,
    `expected ModelPlacementChangedError from the final return's own revalidation, got ${caught?.constructor?.name}`);
});

// === Whole-batch review (Batch 4, Tasks 12-14) findings ==========================================

test('WHOLE-BATCH REVIEW finding #1 (High): a target group historically populated but currently EMPTY (dbIds: []) alongside another non-empty target must not consume candidate budget or throw', async () => {
  // Three DISTINCT models, deliberately -- modelA (source), modelB (historically-populated but
  // THIS call's own dbIds:[] makes it currently empty), modelC (a genuinely non-empty target,
  // separate from source, so its own real TLAS build can't be confused with modelB's).
  const modelA = { ...buildMockModel([{ dbId: 1, fragments: [10] }], new Map([[10, { geometryIndex: 0, matrix: translationMatrix([0, 0, 0]), bounds: boundsOf(box(2, 2, 2), [0, 0, 0]) }]])).model, id: 1, getUnitScale: () => 1 };
  const modelB = { ...buildMockModel([{ dbId: 1, fragments: [100] }], new Map([[100, { geometryIndex: 0 }]])).model, id: 2, getUnitScale: () => 1 };
  const modelC = { ...buildMockModel([{ dbId: 1, fragments: [200] }], new Map([[200, { geometryIndex: 0, matrix: translationMatrix([0, 0, 0]), bounds: boundsOf(box(2, 2, 2), [0, 0, 0]) }]])).model, id: 3, getUnitScale: () => 1 };
  const viewer = {
    impl: {
      getRenderProxy: (queriedModel, fragId) => (queriedModel === modelA && fragId === 10) || (queriedModel === modelC && fragId === 200)
        ? { geometry: box(2, 2, 2) } : null,
    },
  };
  const world = await freshWorld(viewer, { now: frozenClock() });
  const leaseB = world.admitModel(modelB);
  // Historically populate modelB's epoch with SOME co-located fragments (a prior call/mechanism) --
  // this is the "historically populated" state finding #1 describes. The precise assertion below
  // (only ONE tlasBuild, for modelC) directly proves modelB's group is skipped BEFORE
  // _getTlasEntryForEpoch ever runs for it -- kept well within maxCollisionInstancesPerEpoch so
  // this call's own (zero-growth) admission for modelB's epoch doesn't trip the UNRELATED
  // bucket-capacity ceiling.
  const historical = new Map();
  for (let i = 0; i < 100; i++) {
    const fragmentId = 900_000 + i;
    historical.set(fragmentId, {
      fragmentId, geometryIdentity: { loadEpoch: leaseB.epoch, geometryIndex: 0 },
      worldMatrix: new THREE.Matrix4().toArray(), worldBounds: { min: [0, 0, 0], max: [0, 0, 0] },
      ownerDbId: 999,
    });
  }
  world._recordPlacement(leaseB.epoch, modelB, historical, new Map());
  // Directly seed _instanceCache too (admitCollisionInstances would reject > maxCollisionInstancesPerEpoch;
  // this test only needs the TLAS's own raw traversal content, not real per-instance admission).
  const bucket = new Map();
  for (const [fragmentId, rec] of historical) bucket.set(fragmentId, { fragmentId, geometryIdentity: rec.geometryIdentity });
  world._instanceCache.set(leaseB.epoch, bucket);

  const result = await world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB, dbIds: [] }, { model: modelC, dbIds: [1] }] },
    mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'tlas',
  });
  assert.equal(result.pairs.length, 1, 'the real cross-model clash (modelA vs modelC) is still found');
  assert.equal(result.pairs[0].target.model, modelC);
  assert.equal(result.statistics.tlasBuilds, 1, 'exactly ONE build -- modelC\'s own -- modelB\'s empty target group must never even fetch its TLAS');
});

test('WHOLE-BATCH REVIEW finding #2 (Medium): a foreign revision bump arriving during getEntry throws ModelPlacementChangedError immediately, before _getTlasEntryForEpoch retries again', async () => {
  const world = await freshWorld(null, { now: () => 0 });
  world._modelByEpoch.set(1, {});
  world._liveEpochs.add(1);
  world._placementRevisionByEpoch.set(1, 1);
  let getEntryCalls = 0;
  world._tlasCache.getEntry = async (epoch, expectedRevision) => {
    getEntryCalls++;
    // A DIFFERENT concurrent call bumps the revision WHILE this getEntry call is "in flight".
    world._placementRevisionByEpoch.set(1, 2);
    return { bvh: { which: 'stale' }, outcome: 'built', builtAtRevision: expectedRevision };
  };
  world._tlasCache.getBuiltAtRevision = () => 2;
  const statistics = { tlasBuilds: 0, tlasCacheHits: 0, tlasSharedBuildWaits: 0, tlasBuildMs: 0 };
  // A REAL composite checkpoint (Task 14), armed for epoch 1, snapshotting revision 1 -- exactly
  // what findClashes itself would construct for a genuine broadPhase:'tlas' call touching this epoch.
  const checkpoint = world.createCompositeCheckpointPort([{ model: {}, epoch: 1 }], new Set([1]));
  let caught = null;
  try {
    await world._getTlasEntryForEpoch(1, checkpoint, statistics);
  } catch (err) {
    caught = err;
  }
  const { ModelPlacementChangedError } = await import('../collision/errors.js');
  assert.ok(caught instanceof ModelPlacementChangedError,
    `expected ModelPlacementChangedError reported immediately, got ${caught?.constructor?.name}`);
  assert.equal(getEntryCalls, 1, 'must throw on the FIRST detection, never silently retry past a foreign revision bump');
});

// === Task 17: synthetic TLAS-vs-linear differential fixtures ====================================
//
// Every fixture below runs the IDENTICAL query twice -- once with broadPhase:'tlas', once with
// broadPhase:'linear' -- and requires an IDENTICAL final `pairs` set (compared as sets of
// `(sourceModelId, sourceDbId, targetModelId, targetDbId)` tuples, per collision/README.md:112-113's
// own "insertion-order, not canonicalized" disclaimer -- order is never asserted). `statistics`
// numeric fields are deliberately NOT required to match between the two runs (the TLAS path's raw
// candidate count may legitimately exceed the linear oracle's) -- only the post-retest,
// post-narrow-phase `pairs` set is a correctness requirement.
//
// `runBothBroadPhases` (below) is the shared plumbing every RESULT-producing fixture in this section
// uses: it runs the SAME query against a fresh world under both broadPhase values and asserts the
// direct pairs-set equality itself, so an individual fixture's own assertions only need to add
// whatever is SPECIFIC to that fixture's own point (a sanity check on the actual pairs, a
// narrowPhasePairs count, a post-query world-state check, a diagnostics shape). The one exception is
// the model-eviction fixture near the end -- it is about a THROWN error, not a `pairs` set, so it
// loops over both broadPhase values directly instead of going through the helper.
//
// Coverage already exercised elsewhere and deliberately NOT duplicated here: two-model federation,
// cross-model Hard Clash with correct (modelId, dbId) provenance on both operands -- this file's own
// "broadPhase:'tlas' and broadPhase:'linear' produce IDENTICAL pairs for the same cross-model
// fixture" test above (source in modelA, real volume-overlap targets in modelB, compared by a key
// that embeds each operand's modelId).

/**
 * Runs `query` against a FRESH world twice -- once per broadPhase value -- and asserts the two runs'
 * `pairs` sets are IDENTICAL (as sorted `(sourceModelId, sourceDbId, targetModelId, targetDbId)`
 * tuple keys). Returns `{ linear: { world, result }, tlas: { world, result } }` so a caller can still
 * make its own additional, fixture-specific assertions on either branch's full result or its world's
 * post-query state.
 */
async function runBothBroadPhases(viewer, query) {
  const key = (p) => `${p.source.modelId}:${p.source.dbId}:${p.target.modelId}:${p.target.dbId}`;
  const runOne = async (broadPhase) => {
    const world = await freshWorld(viewer, { now: frozenClock() });
    const result = await world.findClashes({ ...query, broadPhase });
    return { world, result };
  };
  const linear = await runOne('linear');
  const tlas = await runOne('tlas');
  assert.deepEqual(
    linear.result.pairs.map(key).sort(), tlas.result.pairs.map(key).sort(),
    'broadPhase:\'tlas\' and broadPhase:\'linear\' must produce an IDENTICAL pairs set for the same query',
  );
  return { linear, tlas };
}

test('SYNTHETIC (Task 17): single-model, single geometry pair, known Hard Clash -- confirms TLAS reduces correctly to M1 single-model behavior', async () => {
  const { modelA, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }, { dbId: 2, fragments: [20] }],
    fragSpecsA: {
      10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      20: { geometryIndex: 1, geometry: box(2, 2, 2), at: [0, 0, 0] }, // coincident boxes -- a real surface-intersection Hard Clash
    },
  });
  const { linear } = await runBothBroadPhases(viewer, {
    source: { model: modelA, dbIds: [1] },
    target: { model: modelA, dbIds: [2] }, // legacy single-model shape -- the simplest possible case
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  assert.equal(linear.result.pairs.length, 1, 'sanity: this is a genuine Hard Clash');
});

test('SYNTHETIC (Task 17): single-model, known non-clash -- AABBs overlap but a fully-contained box has no surface crossing; the pair genuinely reaches narrow phase (the broad-phase retest passes, since the AABBs really do overlap) and narrow phase is what correctly rejects it', async () => {
  const { modelA, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }, { dbId: 2, fragments: [20] }],
    fragSpecsA: {
      10: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      20: { geometryIndex: 1, geometry: box(6, 6, 6), at: [0, 0, 0] }, // fully contains fragment 10 -- AABBs overlap, no surface crossing
    },
  });
  const { linear, tlas } = await runBothBroadPhases(viewer, {
    source: { model: modelA, dbIds: [1] },
    target: { model: modelA, dbIds: [2] },
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  assert.equal(linear.result.statistics.broadPhasePairs, 1, 'sanity: the AABB-coarse pair DID pass broad phase');
  assert.equal(linear.result.statistics.narrowPhasePairs, 1, 'linear: the pair genuinely reached narrow phase');
  assert.equal(tlas.result.statistics.narrowPhasePairs, 1, 'tlas: the pair genuinely reached narrow phase too -- the SAME exact-retest passes in both paths, since the AABBs really do overlap');
  assert.equal(linear.result.pairs.length, 0, 'containment without surface crossing is not a surface-intersection clash');
});

test('SYNTHETIC (Task 17): two-model federation, source has a same-model AND a cross-model Hard Clash -- both target epochs are queried and aggregate into ONE pairs array, identically under both broad-phase paths', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 0, children: [{ dbId: 1, fragments: [10] }, { dbId: 2, fragments: [20] }] }],
    fragSpecsA: {
      10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      20: { geometryIndex: 1, geometry: box(2, 2, 2), at: [0, 0, 0] },
    },
    rootNodesB: [{ dbId: 1, fragments: [100] }],
    fragSpecsB: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
  });
  const { linear } = await runBothBroadPhases(viewer, {
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelA, dbIds: [2] }, { model: modelB, dbIds: [1] }] },
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  assert.equal(linear.result.pairs.length, 2, 'sanity: both the same-model and cross-model Hard Clash are found');
  assert.ok(linear.result.pairs.some((p) => p.target.model === modelA), 'the same-model target epoch was queried');
  assert.ok(linear.result.pairs.some((p) => p.target.model === modelB), 'the cross-model target epoch was queried');
});

test('SYNTHETIC (Task 17): source self-exclusion -- a target dbIds set including the source\'s own (loadEpoch, dbId) never appears in pairs, identically under both broad-phase paths', async () => {
  const { modelA, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 0, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    fragSpecsA: {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [1, 0, 0] }, // genuinely overlaps 100 too -- the real, non-self hit
    },
  });
  const { linear } = await runBothBroadPhases(viewer, {
    source: { model: modelA, dbIds: [10] },
    target: { targets: [{ model: modelA, dbIds: [10, 20] }] }, // dbId 10 shared with source -- must never self-clash
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  assert.equal(linear.result.pairs.length, 1, 'only the real (10,20) hit -- the (10,10) self-pair is excluded');
  assert.equal(linear.result.pairs[0].source.dbId, 10);
  assert.equal(linear.result.pairs[0].target.dbId, 20);
});

test('SYNTHETIC (Task 17): whole-model target scope, dense model -- extractAllFragments admits the same population a by-dbId-list extraction would for the same nominal element set, at a non-trivial fraction of the per-epoch ceiling', async () => {
  const DENSE_COUNT = 5000; // 25% of maxCollisionInstancesPerEpoch (20,000) -- non-trivial, deliberately not the ceiling itself
  const CLASH_INDEX = 2500;
  const rootNodesB = Array.from({ length: DENSE_COUNT }, (_, i) => ({ dbId: 1000 + i, fragments: [1000 + i] }));
  const fragSpecsB = {};
  for (let i = 0; i < DENSE_COUNT; i++) {
    fragSpecsB[1000 + i] = i === CLASH_INDEX
      ? { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } // the ONE real clash
      : { geometryIndex: 1, at: [10_000 + i, 0, 0] }; // explicit far-away degenerate-point bounds -- never reaches narrow phase
  }
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }],
    fragSpecsA: { 10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB,
    fragSpecsB,
  });
  const { linear, tlas } = await runBothBroadPhases(viewer, {
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB }] }, // whole-model scope -- exercises extractAllFragments
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  assert.equal(linear.result.pairs.length, 1, 'sanity: exactly one real clash amid the dense filler');
  assert.equal(linear.result.pairs[0].target.dbId, 1000 + CLASH_INDEX);
  const linearCount = linear.world.getEpochCollisionInstanceCount(linear.world.admitModel(modelB).epoch); // already-admitted lease -- idempotent, no re-extraction
  const tlasCount = tlas.world.getEpochCollisionInstanceCount(tlas.world.admitModel(modelB).epoch);
  assert.equal(linearCount, DENSE_COUNT,
    'whole-model extraction admitted every one of the dense model\'s own fragments -- the same admitted population a by-dbId-list extraction would produce for the same nominal element set');
  assert.equal(tlasCount, DENSE_COUNT);
});

test('SYNTHETIC (Task 17): zero clashes, correct negative -- a federated target set with every AABB genuinely disjoint (or self-excluded) returns pairs: [] and no diagnostics, distinct from the diagnosed-incomplete fixture below', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }],
    fragSpecsA: { 10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [100] }],
    fragSpecsB: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [50, 0, 0] } }, // disjoint AABB
  });
  const { linear, tlas } = await runBothBroadPhases(viewer, {
    source: { model: modelA, dbIds: [1] },
    // Federated: a same-model entry naming the source's own dbId (self-excluded, zero candidates)
    // PLUS a cross-model entry with a genuinely disjoint AABB (zero candidates on its own merits).
    target: { targets: [{ model: modelA, dbIds: [1] }, { model: modelB, dbIds: [1] }] },
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  assert.deepEqual(linear.result.pairs, [], 'clean negative -- no real clash anywhere in the federated target set');
  assert.deepEqual(linear.result.statistics.diagnostics, [], 'a clean negative carries no diagnostics');
  assert.deepEqual(tlas.result.statistics.diagnostics, []);
});

test('SYNTHETIC (Task 17): diagnosed incomplete result -- a target fragment whose geometry is unavailable is diagnosed with the CORRECT per-operand modelId, even though it belongs to a DIFFERENT model than the source', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }],
    fragSpecsA: { 10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [100] }],
    // No `geometry` field -- the shared viewer's getRenderProxy has nothing to serve for fragment 100
    // and returns null, exactly like test/CollisionWorld.findClashes.test.mjs's own established
    // "transient render-proxy miss" fixture (here left permanently missing -- this fixture is about
    // the diagnostic's own operand attribution, not about a retry). `bounds` is set explicitly so the
    // pair genuinely reaches the narrow phase (AABB overlaps the source) before failing there.
    fragSpecsB: { 100: { geometryIndex: 0, bounds: boundsOf(box(2, 2, 2), [0, 0, 0]) } },
  });
  const { linear, tlas } = await runBothBroadPhases(viewer, {
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB, dbIds: [1] }] },
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  const expectedDiagnostic = {
    scope: 'fragment', reason: 'geometry-not-yet-available', role: 'target',
    fragment: { modelId: modelB.id, dbId: 1, fragId: 100 },
  };
  assert.equal(linear.result.pairs.length, 0, 'no geometry was available, so no verdict may be reported');
  assert.deepEqual(linear.result.statistics.diagnostics, [expectedDiagnostic],
    'linear: the diagnostic must name modelB (the operand the fragment actually belongs to), never modelA');
  assert.deepEqual(tlas.result.statistics.diagnostics, [expectedDiagnostic],
    'tlas: the SAME diagnostic, with the SAME correct operand attribution');
});

test('SYNTHETIC (Task 17): model eviction mid-query, cross-model call -- the whole call throws ModelEvictedError rather than returning a partial source-only result, for BOTH broad-phase implementations', async () => {
  // Companion to test/CollisionWorld.findClashes.crossModel.test.mjs's own "eviction of a captured
  // NON-current-operand model aborts the whole call" (which already exercises this exact shape, but
  // only IMPLICITLY through 'tlas' -- the targets-array shape's own default effectiveBroadPhase when
  // no explicit `broadPhase` field is given). This fixture makes the property explicit for BOTH
  // broad-phase implementations in one place, using the exact same injected-eviction-via-
  // `_testBroadPhasePair` pattern (the SAME exact-retest call site the TLAS path itself also uses --
  // collision/CollisionWorld.js's TLAS candidate loop calls `this._testBroadPhasePair(...)` too).
  // Not routed through `runBothBroadPhases`: this fixture is about a THROWN error, not a `pairs` set.
  const { ModelEvictedError } = await import('../collision/errors.js');
  for (const broadPhase of ['linear', 'tlas']) {
    const { modelA, modelB, viewer } = makeTwoModelFixture({
      rootNodesA: [{ dbId: 0, children: [{ dbId: 9000, fragments: [9000] }, { dbId: 9001, fragments: [9001] }] }],
      fragSpecsA: {
        9000: { geometryIndex: 0, geometry: box(0.01, 0.01, 0.01), at: [0, 0, 0] },
        9001: { geometryIndex: 0, geometry: box(0.01, 0.01, 0.01), at: [100, 0, 0] },
      },
      rootNodesB: [{ dbId: 1, fragments: [9100] }],
      fragSpecsB: { 9100: { geometryIndex: 0, geometry: box(0.01, 0.01, 0.01), at: [0, 0, 0] } },
    });
    const world = await freshWorld(viewer, { now: frozenClock() });
    let firstPairSeen = false;
    const originalTestPair = world._testBroadPhasePair.bind(world);
    world._testBroadPhasePair = (...args) => {
      if (!firstPairSeen) { firstPairSeen = true; world.evictModel(modelB); }
      return originalTestPair(...args);
    };
    await assert.rejects(world.findClashes({
      source: { model: modelA, dbIds: [9000, 9001] },
      target: { targets: [{ model: modelB, dbIds: [1] }] },
      mode: 'surface-intersection', groupBy: 'dbId', broadPhase,
    }), ModelEvictedError, `broadPhase:'${broadPhase}': must reject ModelEvictedError`);
    assert.equal(firstPairSeen, true, `broadPhase:'${broadPhase}': the eviction really did land mid-scan`);
  }
});

// === Task 17 Step 2: self-exclusion granularity -- spec §4.4 open item, CLOSED ===================
//
// Spec §4.4's adopted rule (already implemented in production code -- consulted by both the linear
// and TLAS broad-phase paths via `isSourceOwnFragment`): exclusion is defined over the source's
// ENTIRE EXTRACTED FRAGMENT SET, not just the requested dbId(s) or a per-pair ownerDbId comparison --
// a candidate target instance is excluded iff its (loadEpoch, fragmentId) appears ANYWHERE in the
// source operand's own extracted-fragment map for this call, independent of which specific source
// instance it happens to be tested against in any one (source, target) pair.
//
// A first attempt at this fixture (a single source instance, a single matching target dbId) turned
// out NOT to discriminate the adopted rule from a plausible alternative: comparing the CANDIDATE'S
// OWN extracted ownerDbId against the source's extracted ownerDbId for that SAME fragment also
// happens to give the right answer when only one source instance is in play (codex-advisor review
// caught this -- the original construction's comment overclaimed a divergence it didn't actually
// produce). The real divergence needs a source with (at least) TWO instances under DIFFERENT owner
// dbIds, re-paired CROSS-wise against the WRONG source instance -- exactly what a per-pair "do this
// pair's two ownerDbIds match" rule would miss:
//
//   source instance A: fragment 100, ownerDbId 10
//   source instance B: fragment 101, ownerDbId 11
//   target (re-extracted, SAME model, dbIds [10, 11]): fragment 100 (ownerDbId 10), fragment 101 (ownerDbId 11)
//
// Both source fragments spatially coincide, so every (source instance, target instance) combination
// passes the broad phase. A naive rule that excludes a candidate only when THIS PAIR'S two ownerDbIds
// match would correctly exclude (A, target-100) and (B, target-101) -- but would LEAK (A, target-101)
// and (B, target-100): a false-positive self-clash between fragments 100 and 101, even though BOTH
// target fragments are, in fact, part of the source's own extraction (fragmentId membership) -- just
// reached via the OTHER source instance than the one in this particular pair. The adopted rule checks
// fragmentId membership against the source's WHOLE extracted set (never per-pair ownerDbId equality)
// and excludes every one of these four combinations correctly.
//
// OUTCOME: CONFIRMED. Both broadPhase:'linear' and broadPhase:'tlas' report pairs: [] AND
// broadPhasePairs: 0 (self-exclusion runs before the count, so a non-zero count here would itself
// prove a leak) against the IMPLEMENTED production code below -- it matches the adopted
// fragment-set-membership semantics, not a per-pair ownerDbId-equality rule (which this fixture WOULD
// have exposed as a 2-pair leak). This closes spec §4.4's own open item; no discrepancy found, no
// production code change required.
test('SYNTHETIC (Task 17, spec §4.4 open item CLOSED): source fragments owned by TWO different child dbIds are excluded from a target scope re-naming both children, even when cross-paired against the OTHER source instance', async () => {
  const { modelA, viewer } = makeTwoModelFixture({
    rootNodesA: [
      {
        dbId: 0, // the assembly root -- not itself load-bearing for the divergence, kept for realism
        children: [
          { dbId: 10, fragments: [100] }, // source instance A -- ownerDbId 10
          { dbId: 11, fragments: [101] }, // source instance B -- ownerDbId 11, a DIFFERENT owner
        ],
      },
    ],
    fragSpecsA: {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      101: { geometryIndex: 1, geometry: box(2, 2, 2), at: [0, 0, 0] }, // coincident with 100 -- guarantees every cross-pair passes broad phase
    },
  });
  const { linear, tlas } = await runBothBroadPhases(viewer, {
    source: { model: modelA, dbIds: [0] }, // discovers BOTH instances (A under 10, B under 11)
    // Re-names BOTH child dbIds as an independent target scope -- re-extracting the SAME two
    // fragments (100, 101) the source itself already owns. A per-pair ownerDbId-equality rule would
    // leak the CROSS pairs (A vs target-101, B vs target-100); the adopted fragment-set-membership
    // rule excludes all four (source instance x target instance) combinations.
    target: { targets: [{ model: modelA, dbIds: [10, 11] }] },
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  assert.deepEqual(linear.result.pairs, [], 'linear: every source-owned fragment is excluded, including the CROSS-paired combinations a per-pair ownerDbId rule would leak');
  assert.deepEqual(tlas.result.pairs, [], 'tlas: same outcome -- the adopted fragment-set-membership rule, not a per-pair ownerDbId rule, is what\'s implemented');
  assert.equal(linear.result.statistics.broadPhasePairs, 0, 'linear: self-exclusion runs BEFORE the count -- a leak would show up here as a non-zero count');
  assert.equal(tlas.result.statistics.broadPhasePairs, 0, 'tlas: same -- zero candidates ever counted, not merely zero survivors');
});

// === Task 19: candidate-budget/statistics fixtures -- inequality-chain assertions ================

test('exactly maxTlasCandidatePairs candidates succeeds; maxTlasCandidatePairs + 1 throws', async () => {
  // Unit-level test of _runTlasBroadPhase directly, mirroring this file's own established
  // stub-bvh pattern (see "_runTlasBroadPhase resolves a TLAS hit..." and "a whole-model scope
  // excludes a historically-admitted fragment..." above) rather than constructing 200,000 real
  // overlapping primitives (too slow/heavy for a unit test) or adding a per-call override for
  // maxTlasCandidatePairs to CollisionWorld's constructor/fromViewer options (codex-advisor review:
  // the cross-task interface table treats this as a single global constant, not a per-call
  // parameter, and CollisionWorld.fromViewer's documented contract is that unknown options are
  // ignored -- expanding that surface for a one-test-only seam is unwarranted scope creep, and a
  // permissive numeric override would also need its own defensive validation against null/NaN/
  // negative/Infinity to avoid silently disabling a real safety ceiling). Instead, the fake BVH's
  // own queryBox calls onLeafRange directly with a caller-controlled count -- this exercises the
  // REAL production comparison (`candidateBudgetUsed > maxTlasCandidatePairs`) and the REAL,
  // actually-imported maxTlasCandidatePairs constant (200,000), with zero production-code changes.
  async function runWithLeafCount(count) {
    const world = await freshWorld();
    const bvh = {
      recordAt: () => ({ fragmentId: 1 }),
      queryBox: (min, max, { onLeafRange }) => {
        const signal = onLeafRange(0, count);
        return { truncated: signal === 'stop' };
      },
    };
    world._modelByEpoch.set(1, {});
    world._liveEpochs.add(1);
    world._tlasCache.getEntry = async () => ({ bvh, outcome: 'hit', builtAtRevision: 0 });
    world._tlasCache.getBuiltAtRevision = () => 0;

    const sourceOperand = { model: {}, epoch: 99, fragmentIds: new Map() };
    const sourceInstances = [{ instance: { fragmentId: 42 }, worldMatrix: new THREE.Matrix4().toArray(), worldBounds: { min: [0, 0, 0], max: [1, 1, 1] }, ownerDbId: 7 }];
    // A non-empty target group -- an empty one (whole-batch review finding #1) is skipped entirely
    // before this method's own TLAS fetch ever runs, which would defeat this test's own point.
    const targetGroups = [{ targetOperand: { model: {}, epoch: 1 }, instances: [{ instance: { fragmentId: 100 } }] }];
    const statistics = { tlasLeafRangeEmissions: 0, tlasPrimitiveCandidatePairs: 0, tlasBuilds: 0, tlasCacheHits: 0, tlasSharedBuildWaits: 0, tlasBuildMs: 0, tlasQueryMs: 0, broadPhasePairs: 0 };
    const candidates = await world._runTlasBroadPhase(sourceOperand, sourceInstances, targetGroups, new Map(), statistics, () => undefined);
    return { candidates, statistics };
  }

  const { statistics: succeedStats } = await runWithLeafCount(maxTlasCandidatePairs);
  assert.equal(succeedStats.tlasPrimitiveCandidatePairs, maxTlasCandidatePairs,
    'exactly the limit was counted -- the call completed without throwing');

  let caught = null;
  try {
    await runWithLeafCount(maxTlasCandidatePairs + 1);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof CapacityExceededError, `expected CapacityExceededError, got ${caught?.constructor?.name}`);
  assert.equal(caught.kind, 'tlas-candidate-budget');
  assert.equal(caught.limit, maxTlasCandidatePairs);
  assert.equal(caught.completed, maxTlasCandidatePairs);
  assert.equal(caught.attempted, maxTlasCandidatePairs + 1);
});

test('the inequality chain holds across a fixture with real filtering (some candidates excluded by target scope)', async () => {
  // Reuses this file's own established "a narrow explicit-dbIds target scope excludes a
  // spatially-overlapping fragment the TLAS itself still covers" fixture (above, Task 13 section):
  // prime an epoch via a whole-model broadPhase:'linear' call admitting TWO co-located target
  // fragments (dbIds 1 and 2, both genuinely overlapping the source), then run a SECOND
  // broadPhase:'tlas' call requesting only dbId 1. The epoch-wide placement table (and its TLAS)
  // still contains BOTH fragments -- narrowing this call's own target scope does not remove
  // dbId 2's fragment from the epoch -- so the raw TLAS leaf reports count=2, but only fragment
  // 100 (dbId 1) survives the target-scope Set filter into broadPhasePairs, giving
  // tlasPrimitiveCandidatePairs(2) STRICTLY > broadPhasePairs(1) -- confirming the two are not
  // conflated, per this task's own title. codex-advisor review independently verified this
  // predicted numeric chain (2 > 1 >= 1 == 1 == 1) before implementation.
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }],
    fragSpecsA: { 10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [100] }, { dbId: 2, fragments: [200] }],
    fragSpecsB: {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] }, // real Hard Clash with the source
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [0, 0, 0] }, // also overlaps the source -- the raw candidate the scope filter must exclude
    },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  // Prime the epoch's placement table / TLAS with BOTH dbIds first (whole-model scope), so the
  // cached TLAS genuinely contains dbId 2's fragment before the narrow-scope call below runs.
  await world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB }] },
    mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'linear',
  });
  const result = await world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB, dbIds: [1] }] }, // narrow -- dbId 2 excluded from SCOPE, not from the TLAS
    mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'tlas',
  });
  const { statistics } = result;
  assert.equal(statistics.tlasPrimitiveCandidatePairs, 2,
    'both fragments (100 and 200) are still raw TLAS candidates -- the epoch-wide placement table was never narrowed by this call\'s own target scope');
  assert.equal(statistics.broadPhasePairs, 1, 'only fragment 100 (dbId 1) survives the target-scope filter into broadPhasePairs');
  assert.ok(statistics.tlasPrimitiveCandidatePairs > statistics.broadPhasePairs,
    'STRICT inequality -- tlasPrimitiveCandidatePairs and broadPhasePairs are NOT conflated');
  // The remaining relations in spec §7.5.2's own inequality chain, each asserted explicitly.
  assert.ok(statistics.broadPhasePairs >= statistics.tlasExactRetestSurvivors);
  assert.equal(statistics.tlasExactRetestSurvivors, statistics.tlasNarrowPhaseInputPairs);
  assert.equal(statistics.tlasNarrowPhaseInputPairs, statistics.narrowPhasePairs);
  assert.equal(result.pairs.length, 1, 'a genuine clash was found, not merely a narrow-phase attempt');
  assert.equal(result.pairs[0].target.dbId, 1);
});
