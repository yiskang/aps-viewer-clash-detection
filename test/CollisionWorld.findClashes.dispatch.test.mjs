// test/CollisionWorld.findClashes.dispatch.test.mjs
//
// Task 20: `findClashes`'s two remaining query modes -- `containment` and `volume-overlap` --
// dispatched through the SAME `_runNarrowPhasePair` Task 19 wrote for `surface-intersection`.
//
// Fixture INTENT is ported from the task brief's Step 1; the plumbing is NOT. The brief's inline
// mock targets a stale Viewer API (`getInstanceTree()` + a `.geomids` Proxy) and monkeypatches a
// `world.checkpoint` method that does not exist. This file reuses
// test/fixtures/mockInstanceTree.mjs's `buildMockModel` plus the same local fake-viewer wrapper
// Task 19's own test file established (`makeFixture` below is that pattern, kept byte-compatible
// with it so a future extraction into a shared helper is mechanical).
//
// Importing mockInstanceTree.mjs also sets globalThis.THREE as a side effect, which is what
// extractFragments's own `THREE = globalThis.THREE` default resolves to in this headless process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../collision/CollisionWorld.js';
import { buildMockModel } from './fixtures/mockInstanceTree.mjs';

// --- fixture plumbing (same shape as test/CollisionWorld.findClashes.test.mjs) ------------------

function boundsOf(geometry, [x, y, z]) {
  const g = geometry.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  g.computeBoundingBox();
  return { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}

const translationMatrix = ([x, y, z]) => new THREE.Matrix4().makeTranslation(x, y, z).toArray();

function makeFixture(rootNodes, fragSpecs = {}) {
  const fragmentGeometry = new Map();
  const rawGeometryByFragId = new Map();
  for (const [fragIdKey, spec] of Object.entries(fragSpecs)) {
    const fragId = Number(fragIdKey);
    const at = spec.at || [0, 0, 0];
    fragmentGeometry.set(fragId, {
      geometryIndex: spec.geometryIndex,
      matrix: translationMatrix(at),
      bounds: spec.bounds || (spec.geometry ? boundsOf(spec.geometry, at) : { min: at, max: at }),
    });
    if (spec.geometry) rawGeometryByFragId.set(fragId, spec.geometry);
  }
  const { model: baseModel, stats } = buildMockModel(rootNodes, fragmentGeometry);
  const model = { ...baseModel, id: 1, getUnitScale: () => 1 };
  const viewer = {
    impl: {
      getRenderProxy(queriedModel, fragId) {
        assert.equal(queriedModel, model, 'getRenderProxy must be called with the leased Model object');
        const geometry = rawGeometryByFragId.get(fragId);
        return geometry ? { geometry } : null;
      },
    },
  };
  return { model, viewer, stats };
}

const OPTIONS = { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' };

// A frozen clock keeps every checkpoint OBSERVABLE without any of them ever being DUE: the port is
// still invoked (and still validates liveness synchronously) on every call, but the frame-budget
// accumulator never fires, so the call counts below measure call sites, not wall-clock luck.
function frozenClock() { return () => 0; }

async function freshWorld(viewer = null, extra = {}) {
  return CollisionWorld.fromViewer(viewer, { ...OPTIONS, ...extra });
}

function query(model, sourceDbIds, targetDbIds, mode) {
  return {
    source: { model, dbIds: sourceDbIds },
    target: { model, dbIds: targetDbIds },
    mode,
    groupBy: 'dbId',
  };
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// A box with one face's two triangles removed from the index: still ONE edge-connected component,
// but not a closed manifold -- GeometryConnectivity reports closedManifold: [false] for it (probed
// directly against collision/geometry/GeometryConnectivity.js, not assumed). This is the geometry
// that makes `unverified-parity-operand` / `unverified-open-component` reachable end-to-end.
function openBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.setIndex(Array.from(g.index.array).slice(6));
  return g;
}

const reasonsOf = (result) => result.statistics.diagnostics.map((d) => d.reason);

// The four completeness/truncation diagnostics that must NEVER ride along on a positive result
// (docs/...:3776-3793).
const completenessReasons = [
  'incomplete-component-coverage',
  'inconclusive-containment',
  'inconclusive-crossing',
  'crossing-budget-exhausted',
];

// === containment mode dispatch (the room-locator call shape) ===================================

test('containment dispatch: an element fully inside a room reports exactly one containment pair', async () => {
  // The room-locator's exact call shape:
  //   { source: {model, dbIds:[elementDbId]}, target: {model, dbIds: roomDbIds},
  //     mode: 'containment', groupBy: 'dbId' }
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 420270, fragments: [1000] }, { dbId: 857194, fragments: [2000] }] }],
    {
      1000: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      2000: { geometryIndex: 1, geometry: box(6, 6, 6), at: [0, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes(query(model, [420270], [857194], 'containment'));

  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].type, 'containment');
  assert.equal(result.pairs[0].source.dbId, 420270);
  assert.equal(result.pairs[0].target.dbId, 857194);
  assert.equal(result.statistics.narrowPhasePairs, 1);

  // Completeness diagnostics must never attach to a positive result.
  for (const reason of completenessReasons) {
    assert.ok(!reasonsOf(result).includes(reason), `positive result must not carry ${reason}`);
  }
});

test('containment dispatch is NOT surface-intersection: the same fixture answers differently per mode', async () => {
  // The sharpest available proof that `containment` really dispatches its own composed query rather
  // than reusing Task 19's path: a box strictly inside a larger box has no surface intersection at
  // all, and Task 19's own suite already pins that negative.
  const fixtureFor = () => makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(6, 6, 6), at: [0, 0, 0] },
    },
  );

  const surface = await (async () => {
    const { model, viewer } = fixtureFor();
    const world = await freshWorld(viewer, { now: frozenClock() });
    return world.findClashes(query(model, [10], [20], 'surface-intersection'));
  })();
  const containment = await (async () => {
    const { model, viewer } = fixtureFor();
    const world = await freshWorld(viewer, { now: frozenClock() });
    return world.findClashes(query(model, [10], [20], 'containment'));
  })();

  assert.equal(surface.statistics.narrowPhasePairs, 1, 'both modes must reach the narrow phase');
  assert.equal(containment.statistics.narrowPhasePairs, 1);
  assert.equal(surface.pairs.length, 0, 'strictly-inside is not a surface intersection');
  assert.equal(containment.pairs.length, 1, 'strictly-inside IS containment');
});

// === volume-overlap mode dispatch ==============================================================

test('volume-overlap dispatch: genuine interpenetration reports one volume-overlap pair', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [1, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes(query(model, [10], [20], 'volume-overlap'));

  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].type, 'volume-overlap');
  assert.equal(result.pairs[0].source.dbId, 10);
  assert.equal(result.pairs[0].target.dbId, 20);
});

test('volume-overlap dispatch: a strictly-contained source still overlaps (containment term)', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(6, 6, 6), at: [0, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes(query(model, [10], [20], 'volume-overlap'));
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].type, 'volume-overlap');
});

test('volume-overlap dispatch: an AABB-overlapping but geometrically disjoint pair reports nothing', async () => {
  // A 45-degree-rotated unit box (a diamond in XY, |x| + |y| <= ~0.707) against a small axis-aligned
  // box whose nearest corner sits at (0.4, 0.4) -- sum 0.8, strictly outside the diamond, so the two
  // solids are disjoint even though their world AABBs overlap on x/y in [0.4, 0.707]. Two
  // axis-aligned boxes cannot express this case at all (their AABB overlap IS their solid overlap),
  // and without it every positive above could be produced by a narrow phase that just returns true.
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(1, 1, 1).rotateZ(Math.PI / 4), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(0.4, 0.4, 1), at: [0.6, 0.6, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes(query(model, [10], [20], 'volume-overlap'));
  assert.equal(result.statistics.broadPhasePairs, 1);
  assert.equal(result.statistics.narrowPhasePairs, 1, 'the pair must actually reach the narrow phase');
  assert.equal(result.pairs.length, 0);
});

// === lazy connectivity: requested per mode, never under surface-intersection ====================

function instrumentConnectivity(world) {
  const seen = [];
  const original = world._registry.getOrBuildGeometry.bind(world._registry);
  world._registry.getOrBuildGeometry = async (args) => {
    seen.push(args.needsConnectivity);
    return original(args);
  };
  return seen;
}

for (const mode of ['containment', 'volume-overlap']) {
  test(`${mode} mode requests connectivity from GeometryRegistry for every build`, async () => {
    const { model, viewer } = makeFixture(
      [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
      {
        100: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
        200: { geometryIndex: 1, geometry: box(6, 6, 6), at: [0, 0, 0] },
      },
    );
    const world = await freshWorld(viewer, { now: frozenClock() });
    const seen = instrumentConnectivity(world);
    await world.findClashes(query(model, [10], [20], mode));
    assert.ok(seen.length > 0, 'the narrow phase must have requested at least one geometry build');
    assert.deepEqual(seen, seen.map(() => true), 'every build must be requested WITH connectivity');
  });
}

test('surface-intersection mode NEVER requests connectivity', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [1, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const seen = instrumentConnectivity(world);
  const result = await world.findClashes(query(model, [10], [20], 'surface-intersection'));
  assert.equal(result.pairs.length, 1, 'the fixture must still reach and pass the narrow phase');
  assert.ok(seen.length > 0);
  assert.equal(seen.filter(Boolean).length, 0, 'surface-intersection must never ask for connectivity');
});

// === composed-stage checkpoint (round 9 core counterexample) ====================================
//
// The single most important fixture in this task: the checkpoint must fire BETWEEN a single pair's
// own composed sub-query stages, not only between candidate pairs. `phase` flips to 'narrow' once
// BOTH of this pair's geometry builds have resolved, so every checkpoint recorded after that point
// can only have come from inside the composed query itself.

function instrumentCheckpointPhases(world) {
  let builds = 0;
  let phase = 'pre';
  const originalBuild = world._registry.getOrBuildGeometry.bind(world._registry);
  world._registry.getOrBuildGeometry = async (args) => {
    const record = await originalBuild(args);
    if (++builds === 2) phase = 'narrow';
    return record;
  };
  const phases = [];
  const originalFactory = world.createCheckpointPort.bind(world);
  world.createCheckpointPort = (lease) => {
    const port = originalFactory(lease);
    return (ctx) => {
      phases.push(phase);
      return port(ctx);
    };
  };
  return phases;
}

const containedPairFixture = () => makeFixture(
  [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
  {
    100: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
    200: { geometryIndex: 1, geometry: box(6, 6, 6), at: [0, 0, 0] },
  },
);

test('composed-stage checkpoint: one volume-overlap pair fires the SAME call-scoped checkpoint between its own stages', async () => {
  const { model, viewer } = containedPairFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  const phases = instrumentCheckpointPhases(world);
  const result = await world.findClashes(query(model, [10], [20], 'volume-overlap'));

  assert.equal(result.statistics.broadPhasePairs, 1, 'exactly one candidate pair');
  assert.equal(result.statistics.narrowPhasePairs, 1);
  const intraPair = phases.filter((p) => p === 'narrow').length;
  // >= 2: volumeOverlapQuery's own between-term checkpoint plus anyComponentInside's per-sample
  // checkpoints. A pair-boundary-only implementation records exactly 0 here.
  assert.ok(intraPair >= 2, `expected >= 2 intra-pair checkpoint calls, got ${intraPair}`);
});

test('composed-stage checkpoint: one containment pair fires it between its own stages too', async () => {
  const { model, viewer } = containedPairFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  const phases = instrumentCheckpointPhases(world);
  await world.findClashes(query(model, [10], [20], 'containment'));
  const intraPair = phases.filter((p) => p === 'narrow').length;
  assert.ok(intraPair >= 1, `expected >= 1 intra-pair checkpoint call, got ${intraPair}`);
});

test('composed-stage checkpoint: surface-intersection fires NONE inside the pair (the control)', async () => {
  // Without this control, the two fixtures above could be satisfied by any unconditional extra
  // checkpoint anywhere in the narrow phase rather than by real composed-stage plumbing.
  const { model, viewer } = containedPairFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  const phases = instrumentCheckpointPhases(world);
  await world.findClashes(query(model, [10], [20], 'surface-intersection'));
  assert.equal(phases.filter((p) => p === 'narrow').length, 0);
  assert.ok(phases.length > 0, 'the pair-boundary/broad-phase checkpoints must still have fired');
});

// === diagnostic role-attribution end-to-end ====================================================

test('diagnostic role-attribution: an open target under containment carries unverified-parity-operand role=target on a real FragmentRef', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: openBox(6, 6, 6), at: [0, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes(query(model, [10], [20], 'containment'));

  const parity = result.statistics.diagnostics.find((d) => d.reason === 'unverified-parity-operand');
  assert.ok(parity, `expected unverified-parity-operand, got ${JSON.stringify(reasonsOf(result))}`);
  assert.equal(parity.role, 'target');
  // Pair-scoped, per the spec's ClashDiagnostic union: BOTH sides are always known here, so it
  // carries sourceFragment + targetFragment, never a single `fragment` field.
  assert.equal(parity.scope, 'pair');
  assert.equal(typeof parity.targetFragment.fragId, 'number');
  assert.equal(parity.targetFragment.fragId, 200);
  assert.equal(parity.targetFragment.dbId, 20, 'dbId comes from the placed instance ownerDbId');
  assert.equal(parity.targetFragment.modelId, 1);
  assert.equal(parity.sourceFragment.fragId, 100);
  assert.equal(parity.sourceFragment.dbId, 10);
  assert.equal(parity.fragment, undefined, 'a pair-scoped diagnostic must not use the fragment field');
});

test('containment mode NEVER emits unverified-open-component / non-manifold-component; volume-overlap does', async () => {
  // Same geometry both times: an OPEN source strictly inside a closed target. Under volume-overlap
  // this is a containment-decided positive on an open component -- exactly what
  // `unverified-open-component` exists to report. Under `containment` mode the spec forbids it
  // (docs/...:3866-3873, 3874-3882), and ContainmentQuery gates both reasons on
  // `mode === 'volume-overlap'` internally.
  const fixtureFor = () => makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: openBox(1, 1, 1), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(6, 6, 6), at: [0, 0, 0] },
    },
  );

  const containment = await (async () => {
    const { model, viewer } = fixtureFor();
    const world = await freshWorld(viewer, { now: frozenClock() });
    return world.findClashes(query(model, [10], [20], 'containment'));
  })();
  const overlap = await (async () => {
    const { model, viewer } = fixtureFor();
    const world = await freshWorld(viewer, { now: frozenClock() });
    return world.findClashes(query(model, [10], [20], 'volume-overlap'));
  })();

  assert.equal(containment.pairs.length, 1);
  assert.equal(overlap.pairs.length, 1);
  for (const reason of ['unverified-open-component', 'non-manifold-component']) {
    assert.ok(
      !reasonsOf(containment).includes(reason),
      `containment mode must never emit ${reason}; saw ${JSON.stringify(reasonsOf(containment))}`,
    );
  }
  const open = overlap.statistics.diagnostics.find((d) => d.reason === 'unverified-open-component');
  assert.ok(open, `expected unverified-open-component under volume-overlap, got ${JSON.stringify(reasonsOf(overlap))}`);
  assert.equal(open.role, 'source');
  assert.equal(open.scope, 'pair');
  assert.equal(open.sourceFragment.fragId, 100);
  // Still a positive result -- completeness diagnostics must not have ridden along with it.
  for (const reason of completenessReasons) {
    assert.ok(!reasonsOf(overlap).includes(reason), `positive result must not carry ${reason}`);
  }
});

// === the Task 19 placeholder is gone ===========================================================

test('findClashes no longer rejects containment / volume-overlap with the Task 20 placeholder', async () => {
  const { model, viewer } = makeFixture([{ dbId: 1, children: [{ dbId: 10, fragments: [] }] }]);
  const world = await freshWorld(viewer, { now: frozenClock() });
  for (const mode of ['containment', 'volume-overlap']) {
    const result = await world.findClashes(query(model, [10], [10], mode));
    assert.deepEqual(result.pairs, []);
  }
  await assert.rejects(world.findClashes(query(model, [10], [10], 'nonsense')), /unsupported mode/);
});
