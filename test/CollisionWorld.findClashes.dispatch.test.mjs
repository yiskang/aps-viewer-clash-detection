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
import { CollisionWorld, normalizeNarrowPhaseHit, toInstance } from '../collision/CollisionWorld.js';
import { buildMockModel } from './fixtures/mockInstanceTree.mjs';
import { mergeGeometries } from './fixtures/geometry.mjs';

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

// The clock the injected one above CANNOT reach. ProperCrossingQuery, SurfaceIntersectionQuery and
// SurfaceCrossingWitness each deliberately own a private, traversal-local wall clock
// (docs/...:1932-1957 -- a bvhcast cannot pause mid-traversal, so it can only measure and abort),
// read straight off the real `performance.now()`, and `findClashes` exposes no seam to override it.
// Under concurrent `node --test` load a scheduling stall longer than frameBudgetMs (8ms) inside one
// of those traversals aborts it, and an aborted traversal never reports a positive -- so any fixture
// whose expected answer is a traversal-decided POSITIVE is wall-clock flaky by construction.
//
// Freezing `performance.now` for the duration of one test removes that hazard outright. Top-level
// node:test tests run sequentially, so nothing else in this file observes the patch, and the
// `finally` restores it even if the body throws. Done by hand rather than via `t.mock.method` so the
// fixture carries no dependency on that API's availability.
async function withFrozenPerformanceClock(body) {
  const realNow = performance.now;
  performance.now = () => 0;
  try {
    return await body();
  } finally {
    performance.now = realNow;
  }
}

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

// A source element in TWO edge-disconnected parts: a 1x1x1 box at (-2,0,0) and another at (6,0,0).
// Against a 6x6x6 box at the origin the first is wholly inside it and the second wholly outside, so
// `anyComponentInside` decides the pair the same way regardless of which component it visits first
// and which vertex of that component it samples first.
function twoPartBox() {
  return mergeGeometries([
    new THREE.BoxGeometry(1, 1, 1).translate(-2, 0, 0),
    new THREE.BoxGeometry(1, 1, 1).translate(6, 0, 0),
  ]);
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

test('volume-overlap dispatch: a source only partly inside the target reports one volume-overlap pair', async () => {
  // A two-part source element (one 1x1x1 box buried at (-2,0,0), well inside the 6x6x6 target; one
  // 1x1x1 box out at (6,0,0), well outside it) against that target. The element genuinely overlaps
  // the target in part and misses it in part, and the verdict is decided by
  // `anyComponentInside(source in target)`.
  //
  // Two properties make that verdict deterministic, and both were needed:
  //  - ContainmentQuery's sampling walk has NO clock, only a sample budget (512, vs the ~16 vertices
  //    here), so it is immune to the wall-clock hazard `withFrozenPerformanceClock` describes.
  //  - Every vertex of the buried component is strictly inside the target and every vertex of the
  //    outer one is strictly outside, so neither component-visit order nor vertex-sample order can
  //    change the answer: the outer component (if visited first) simply resolves 'outside' and the
  //    loop moves on to the buried one, which resolves 'inside'.
  //
  // Why not the obvious "two 2x2x2 boxes at (0,0,0) and (1,0,0)" this fixture used to hold: that
  // pair is decided ONLY by the crossing term, and ProperCrossingQuery measures frameBudgetMs
  // against a REAL performance.now() of its own (deliberately -- docs/...:1932-1957, it cannot pause
  // mid-bvhcast), entirely unrelated to the frozen clock this world injects. Under concurrent
  // `node --test` load its traversal could abort, and because every vertex of each coincident-face
  // box sits exactly ON the other's boundary planes, neither containment term could rescue the
  // verdict -- so the pair count intermittently came back 0 (measured: 2 failures in 48 runs at
  // 8-way concurrency).
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: twoPartBox(), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(6, 6, 6), at: [0, 0, 0] },
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

// === canonical operand ordering (fix round 1, Finding 1) =======================================
//
// Historically, VolumeOverlapQuery exposed a `compareCanonical` option that decided which operand's
// localDiagonal became L_canonical for ProperCrossingQuery's offset ladder
// (`{1e-3,1e-4,1e-5} x L_canonical`); that option has since been REMOVED in favor of
// orientForCrossing's total geometric order (see the fail-loud removal guard in
// VolumeOverlapQuery.js). Before removal, the library's own default treated the PUBLIC source as
// canonical-first, which made that scale depend on which side the caller happened to label source --
// a public VERDICT difference, not a tolerance nuance, whenever the two operands' local diagonals
// differed sharply.
//
// The geometry below is that case, measured rather than assumed: a 3000 x 1 x 1 duct
// (localDiagonal ~3000) crossing a 1 x 1 x 4 beam (localDiagonal ~4.24) at the origin -- a ~707:1
// ratio, a genuine crossing with NO vertex of either solid inside the other (so neither containment
// term can rescue it), and both aspect ratios (3000 and 4) comfortably under maxLocalAspectRatio.
// Probed directly against volumeOverlapQuery: with the duct canonical-first it returns
// overlap: true via 'crossing'; with the beam canonical-first the ladder's largest step
// (1e-3 x 4.24) lands inside the duct's own classifyPoint boundary band, every probe reports
// 'boundary', and it returns a clean overlap: false.
//
// orientForCrossing orients the duct (world diagonal ~3000) first regardless of caller-supplied
// operand order or which fragment/geometryIndex the Viewer happened to assign it on this load --
// world-space diagonal is rank 1 of a total geometric order (design doc
// docs/superpowers/specs/2026-09-11-canonical-ordering-operand-symmetry-fix-design.md §4.3 C-1), so
// both call directions agree without reading any identity field. This regression is the repository's
// strongest evidence for the dead-rung theorem (§4.0): pre-fix, the small-operand orientation made
// every probe rung classify `boundary` and silently lost this crossing.

const ductThroughBeamFixture = () => makeFixture(
  [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
  {
    100: { geometryIndex: 0, geometry: box(3000, 1, 1), at: [0, 0, 0] },  // L ~ 3000
    200: { geometryIndex: 1, geometry: box(1, 1, 4), at: [0, 0, 0] },     // L ~ 4.24
  },
);

test('volume-overlap is source/target-swap invariant: a ~707:1 local-diagonal pair gets ONE verdict', async () => {
  const { model, viewer } = ductThroughBeamFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });

  const [forward, backward] = await withFrozenPerformanceClock(async () => [
    await world.findClashes(query(model, [10], [20], 'volume-overlap')),
    await world.findClashes(query(model, [20], [10], 'volume-overlap')),
  ]);

  assert.ok(
    !reasonsOf(forward).concat(reasonsOf(backward)).includes('crossing-budget-exhausted'),
    'with the crossing clock frozen, neither traversal may abort -- an abort would make this fixture ' +
    'say nothing about canonical ordering',
  );
  assert.equal(forward.statistics.narrowPhasePairs, 1, 'the pair must reach the narrow phase both ways');
  assert.equal(backward.statistics.narrowPhasePairs, 1);
  assert.equal(
    forward.pairs.length, backward.pairs.length,
    `the SAME physical pair must get the same verdict regardless of which side is labelled source ` +
    `(forward ${forward.pairs.length}, backward ${backward.pairs.length})`,
  );
  // Non-vacuity: the shared verdict must be the POSITIVE one the duct-canonical order produces,
  // which is what pins the ordering to identity rather than to the public source role. A pair of
  // zeroes would satisfy the equality above while proving nothing.
  assert.equal(forward.pairs.length, 1, 'the crossing is real and must be reported');
  assert.equal(forward.pairs[0].source.dbId, 10);
  assert.equal(backward.pairs[0].source.dbId, 20, 'public role naming still follows the caller, not canonical order');
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
  // The only fixture in this file whose expected answer is a bvhcast-decided POSITIVE under a mode
  // with no containment term to fall back on, so it is the one exposed to SurfaceIntersectionQuery's
  // own real wall clock. It never flaked across ~240 runs at 8- to 16-way concurrency, but the
  // identically-shaped coincident-face fixtures in test/CollisionWorld.findClashes.test.mjs do flake
  // under two concurrent full-suite runs, so the hazard is real rather than theoretical -- and unlike
  // the volume-overlap case it cannot be designed away with different geometry, because the abort is
  // unconditional on time. Freeze the clock instead.
  const result = await withFrozenPerformanceClock(
    () => world.findClashes(query(model, [10], [20], 'surface-intersection')),
  );
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

// === aspectRatioExceeded forwarding (fix round 1, Finding 3) ===================================

test('an extreme-aspect-ratio target under containment emits geometry-aspect-ratio-exceeds-tolerance-model', async () => {
  // `toInstance` forwards `record.aspectRatioExceeded` from the GeometryRegistry record into the
  // `Instance` both composed queries consume. That field gates a real safety check: the tolerance
  // model (mergeDistanceFactor / surfaceEpsilonFactor, both scaled off a single global
  // localDiagonal) cannot make correct decisions for a container at extreme aspect ratio, so
  // ContainmentModeQuery suppresses classification and reports a diagnostic instead of trusting it.
  //
  // 1000 x 0.001 x 0.001 is an aspect ratio of ~1e6, ~100x over maxLocalAspectRatio (10,000), and
  // its thin extent is still 10x the 1e-4 weld epsilon so welding cannot collapse it. It is the
  // TARGET, because both gate sites (ContainmentModeQuery's own witness gate and the
  // targetAspectRatioExceeded pass-through into anyComponentInside) read the CONTAINER's signal.
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(1000, 0.001, 0.001), at: [0, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes(query(model, [10], [20], 'containment'));

  assert.equal(result.statistics.narrowPhasePairs, 1, 'the pair must actually reach the narrow phase');
  // The gate SUPPRESSES classification -- it does not merely annotate it. Without this assertion a
  // regression could emit the diagnostic and still report an untrustworthy positive.
  assert.equal(result.pairs.length, 0, 'a gated pair must not be classified at all');
  const gated = result.statistics.diagnostics.find(
    (d) => d.reason === 'geometry-aspect-ratio-exceeds-tolerance-model',
  );
  assert.ok(
    gated,
    `expected geometry-aspect-ratio-exceeds-tolerance-model, got ${JSON.stringify(reasonsOf(result))}`,
  );
  assert.equal(gated.scope, 'pair');
  assert.equal(gated.role, 'target', 'the CONTAINER is the operand whose aspect ratio is indicted');
  assert.equal(gated.sourceFragment.fragId, 100);
  assert.equal(gated.targetFragment.fragId, 200);
  assert.equal(gated.targetFragment.dbId, 20);
  assert.equal(gated.targetFragment.modelId, 1);
});

// === geometryDigest forwarding (Task A1.2) =====================================================
//
// `toInstance` is exported (like `normalizeNarrowPhaseHit` above) solely so this pure
// record -> Instance mapping can be unit-tested directly, following this file's existing pattern.
// `geometryDigest` is not consumed by any production code path yet -- Task A2.1 wires it into
// `orientForCrossing` -- so there is no observable findClashes-level behavior to assert on the way
// `aspectRatioExceeded`'s forwarding test above does; this is a direct shape check instead.

test('toInstance forwards record.geometryDigest onto the Instance it builds', () => {
  const record = {
    geometry: { index: { count: 36 }, attributes: { position: { count: 8 } } },
    bvh: {},
    localDiagonal: 1.7320508075688772,
    geometryDigest: '082d39a862364291983594df7749a69d', // a real digest, from A1.1's browser-load verification
    connectivity: null,
    aspectRatioExceeded: false,
  };
  const instance = toInstance(record, new THREE.Matrix4().identity().toArray());
  assert.equal(typeof instance.geometryDigest, 'string');
  assert.equal(instance.geometryDigest.length, 32);
  assert.match(instance.geometryDigest, /^[0-9a-f]{32}$/, 'must be exactly 32 lowercase hex chars');
  assert.equal(instance.geometryDigest, record.geometryDigest, 'forwarded verbatim, not recomputed');
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

// === M2.1 Task 4: _runNarrowPhasePair result-shape integration + aggregation gate =============
//
// volumeOverlapQuery (Task 3) now additively returns `witness` on its own result object.
// `_runNarrowPhasePair` forwards that as a structured `{ hit, witness }` shape for volume-overlap
// only; containment/surface-intersection keep their bare-boolean shape. The aggregation loop's gate
// (`if (!hit) continue;`) must therefore read a real boolean regardless of mode -- a structured
// NEGATIVE result (`{ hit: false, witness: null }`) is a truthy JS object and must never slip past a
// naive `!hit` check into a spurious ClashPair.

const strictlyContainedFixture = () => makeFixture(
  [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
  {
    100: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
    200: { geometryIndex: 1, geometry: box(6, 6, 6), at: [0, 0, 0] },
  },
);

test('a negative volume-overlap structured result {hit:false, witness:null} does not become a truthy hit', async () => {
  // Without this stub the fixture below is a genuine positive (see "a strictly-contained source
  // still overlaps" above) -- forcing a structured-but-negative shape here proves the AGGREGATION
  // LOOP's gate reads `.hit`, not object truthiness, rather than merely proving the fixture is
  // negative to begin with.
  const { model, viewer } = strictlyContainedFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  const originalRun = world._runNarrowPhasePair.bind(world);
  world._runNarrowPhasePair = async (...args) => {
    await originalRun(...args);
    return { hit: false, witness: null };
  };
  const result = await world.findClashes(query(model, [10], [20], 'volume-overlap'));
  assert.equal(result.pairs.length, 0, 'a stubbed {hit:false,...} must never produce a ClashPair');
});

test('_runNarrowPhasePair returns {hit, witness} for volume-overlap and a bare boolean for containment/surface-intersection', async () => {
  // codex-review (medium, request 20260907-160842-40675-17410): the original version of this test
  // pinned volume-overlap and containment only. A regression that accidentally made
  // surface-intersection return `{ hit: false, ... }` would slip past `normalizeNarrowPhaseHit`
  // unnoticed -- its non-volume-overlap branch does `Boolean(result)`, which is `true` for ANY
  // object, so that regression would silently start emitting spurious surface-intersection
  // ClashPairs with no test catching it. Pinning surface-intersection's bare-boolean shape here
  // closes that gap.
  const captured = {};

  {
    const { model, viewer } = strictlyContainedFixture();
    const world = await freshWorld(viewer, { now: frozenClock() });
    const original = world._runNarrowPhasePair.bind(world);
    world._runNarrowPhasePair = async (...args) => { captured.volumeOverlap = await original(...args); return captured.volumeOverlap; };
    await world.findClashes(query(model, [10], [20], 'volume-overlap'));
  }
  {
    const { model, viewer } = strictlyContainedFixture();
    const world = await freshWorld(viewer, { now: frozenClock() });
    const original = world._runNarrowPhasePair.bind(world);
    world._runNarrowPhasePair = async (...args) => { captured.containment = await original(...args); return captured.containment; };
    await world.findClashes(query(model, [10], [20], 'containment'));
  }
  {
    // A coincident-face fixture that genuinely reaches surface-intersection's real bvhcast path
    // (same shape as the "surface-intersection mode NEVER requests connectivity" fixture above);
    // its traversal owns a private real-clock budget, so the performance clock is frozen for the
    // duration of this call per that same test's rationale.
    const { model, viewer } = makeFixture(
      [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
      {
        100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
        200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [1, 0, 0] },
      },
    );
    const world = await freshWorld(viewer, { now: frozenClock() });
    const original = world._runNarrowPhasePair.bind(world);
    world._runNarrowPhasePair = async (...args) => { captured.surfaceIntersection = await original(...args); return captured.surfaceIntersection; };
    await withFrozenPerformanceClock(() => world.findClashes(query(model, [10], [20], 'surface-intersection')));
  }

  const volumeOverlapResult = captured.volumeOverlap;
  assert.equal(typeof volumeOverlapResult, 'object');
  assert.notEqual(volumeOverlapResult, null);
  assert.equal(typeof volumeOverlapResult.hit, 'boolean');
  assert.ok(
    volumeOverlapResult.witness === null || typeof volumeOverlapResult.witness === 'object',
    'witness must be null or a {kind,point} object',
  );

  const containmentResult = captured.containment;
  assert.equal(typeof containmentResult, 'boolean', 'containment mode must keep its existing bare-boolean shape');

  const surfaceIntersectionResult = captured.surfaceIntersection;
  assert.equal(typeof surfaceIntersectionResult, 'boolean', 'surface-intersection mode must keep its existing bare-boolean shape');
});

// === Task review fix: witness must be strictly null, never `false`, for the volume-overlap +
// buildOne-failure combination =================================================================
//
// `_runNarrowPhasePair`'s two `buildOne`-failure early-outs (unchanged shared prep code) return the
// bare boolean `false` even under `mode === 'volume-overlap'`. `normalizeNarrowPhaseHit` must still
// produce `witness: null` (never `witness: false`) in that case, or Task 5's `witness === null`
// checks would silently misbehave.

test('normalizeNarrowPhaseHit(volume-overlap, false): witness is strictly null, never false', () => {
  // The exact shape `_runNarrowPhasePair` returns from its buildOne-failure early-outs.
  const { isHit, witness } = normalizeNarrowPhaseHit('volume-overlap', false);
  assert.equal(isHit, false);
  assert.strictEqual(witness, null, 'witness must be strictly null, not false');
});

test('normalizeNarrowPhaseHit(volume-overlap, ...): full contract table', () => {
  // A structured negative: witness passes through as null.
  assert.deepEqual(normalizeNarrowPhaseHit('volume-overlap', { hit: false, witness: null }), {
    isHit: false, witness: null,
  });
  // A structured positive with a real witness: passes through unchanged.
  const point = [1, 2, 3];
  assert.deepEqual(normalizeNarrowPhaseHit('volume-overlap', { hit: true, witness: { kind: 'crossing', point } }), {
    isHit: true, witness: { kind: 'crossing', point },
  });
  // A structured positive whose witness is itself null (fault-tolerance contract, per the M2.1
  // spec's own "witness:null is a fault-tolerance contract, not a normal outcome" clarification):
  // still a real hit, witness stays null.
  assert.deepEqual(normalizeNarrowPhaseHit('volume-overlap', { hit: true, witness: null }), {
    isHit: true, witness: null,
  });
  // Every non-object/falsy `result` -- what the buildOne-failure early-outs and an absent value both
  // produce -- must normalize to isHit:false, witness:null, never to isHit:true or witness:false.
  for (const falsyResult of [false, undefined, null]) {
    assert.deepEqual(normalizeNarrowPhaseHit('volume-overlap', falsyResult), { isHit: false, witness: null });
  }
});

test('normalizeNarrowPhaseHit(containment/surface-intersection, ...): bare-boolean modes are untouched by the witness fix', () => {
  for (const mode of ['containment', 'surface-intersection']) {
    assert.deepEqual(normalizeNarrowPhaseHit(mode, true), { isHit: true, witness: undefined });
    assert.deepEqual(normalizeNarrowPhaseHit(mode, false), { isHit: false, witness: undefined });
  }
});

test('a real volume-overlap buildOne failure (missing render proxy) reaches _runNarrowPhasePair as bare false, and normalizeNarrowPhaseHit turns it into isHit:false/witness:null end-to-end', async () => {
  // Same "permanently missing proxy" shape as the batch-4 fix-wave tests in
  // test/CollisionWorld.findClashes.test.mjs, but never recovers (unlike that file's transient-miss
  // fixtures) -- this is what actually drives buildOne's RenderProxyUnavailableError catch, and
  // therefore _runNarrowPhasePair's `if (!targetRecord) return false;` early-out, under
  // mode:'volume-overlap'.
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(6, 6, 6), at: [0, 0, 0] },
    },
  );
  const realGetRenderProxy = viewer.impl.getRenderProxy;
  viewer.impl.getRenderProxy = (queriedModel, fragId) => (fragId === 200 ? null : realGetRenderProxy(queriedModel, fragId));

  const world = await freshWorld(viewer, { now: frozenClock() });
  let rawResult;
  const original = world._runNarrowPhasePair.bind(world);
  world._runNarrowPhasePair = async (...args) => { rawResult = await original(...args); return rawResult; };

  const result = await world.findClashes(query(model, [10], [20], 'volume-overlap'));

  assert.equal(result.statistics.narrowPhasePairs, 1, 'the pair must actually reach the narrow phase');
  assert.strictEqual(rawResult, false, '_runNarrowPhasePair must take the buildOne-failure early-out and return bare false');
  assert.equal(result.pairs.length, 0, 'a pair whose geometry never resolved must not be reported');

  const normalized = normalizeNarrowPhaseHit('volume-overlap', rawResult);
  assert.equal(normalized.isHit, false);
  assert.strictEqual(normalized.witness, null, 'witness must be strictly null for this exact end-to-end path, never false');
});
