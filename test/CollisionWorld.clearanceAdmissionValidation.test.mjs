// test/CollisionWorld.clearanceAdmissionValidation.test.mjs
//
// M3 Task 8 wrote these three tests as `{ todo: true }` scaffolds (before clearance dispatch
// existed to actually run them end-to-end); M3 Task 9 wires that dispatch. This file fills in the
// brief's own `null` stub-model placeholders with real fixtures (same buildMockModel-based idiom
// test/CollisionWorld.findClashes.test.mjs's own `makeFixture` and
// test/CollisionWorld.findClashes.crossModel.test.mjs's own `makeTwoModelFixture` already
// established), un-skips all three, and gets them passing.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../collision/CollisionWorld.js';
import { buildMockModel } from './fixtures/mockInstanceTree.mjs';

// --- fixture plumbing (mirrors makeTwoModelFixture in test/CollisionWorld.findClashes.crossModel.test.mjs,
// extended with a per-fragment `matrix` override so a corrupted worldMatrix can be injected directly
// -- the `at`-only translation helper the other clearance test files use cannot express a
// non-finite/singular transform) --------------------------------------------------------------------

function boundsOf(geometry, [x, y, z]) {
  const g = geometry.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  g.computeBoundingBox();
  return { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}

const translationMatrix = ([x, y, z]) => new THREE.Matrix4().makeTranslation(x, y, z).toArray();

function makeModelPart(id, rootNodes, fragSpecs = {}, modelOptions = {}) {
  const fragmentGeometry = new Map();
  const rawGeometryByFragId = new Map();
  for (const [fragIdKey, spec] of Object.entries(fragSpecs)) {
    const fragId = Number(fragIdKey);
    const at = spec.at || [0, 0, 0];
    // `spec.matrix`, when present, is used VERBATIM (a raw 16-element array) instead of the
    // `at`-derived translation -- this is how a corrupted (non-finite/singular) worldMatrix reaches
    // extraction, exactly the shape readWorldMatrix's own contract hands back.
    const matrix = spec.matrix || translationMatrix(at);
    fragmentGeometry.set(fragId, {
      geometryIndex: spec.geometryIndex,
      matrix,
      bounds: spec.bounds || (spec.geometry ? boundsOf(spec.geometry, at) : { min: at, max: at }),
    });
    if (spec.geometry) rawGeometryByFragId.set(fragId, spec.geometry);
  }
  const { model: baseModel, stats } = buildMockModel(rootNodes, fragmentGeometry, modelOptions);
  const model = { ...baseModel, id, getUnitScale: () => 1 };
  return { model, rawGeometryByFragId, stats };
}

function makeTwoModelFixture(opts = {}) {
  const {
    rootNodesA = [{ dbId: 1, fragments: [] }], fragSpecsA = {}, modelOptionsA = {},
    rootNodesB = [{ dbId: 1, fragments: [] }], fragSpecsB = {}, modelOptionsB = {},
  } = opts;
  const a = makeModelPart(1, rootNodesA, fragSpecsA, modelOptionsA);
  const b = makeModelPart(2, rootNodesB, fragSpecsB, modelOptionsB);
  const viewer = {
    impl: {
      getRenderProxy(queriedModel, fragId) {
        let part;
        if (queriedModel === a.model) part = a;
        else if (queriedModel === b.model) part = b;
        else assert.fail('getRenderProxy called with a Model object neither fixture model produced');
        const geometry = part.rawGeometryByFragId.get(fragId);
        return geometry ? { geometry } : null;
      },
    },
  };
  return { modelA: a.model, modelB: b.model, viewer };
}

const OPTIONS = { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' };
function frozenClock() { return () => 0; }
async function freshWorld(viewer = null, extra = {}) {
  return CollisionWorld.fromViewer(viewer, { ...OPTIONS, ...extra });
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// A non-finite worldMatrix: identity with one element replaced by NaN.
const NAN_MATRIX = (() => {
  const m = new THREE.Matrix4().toArray();
  m[5] = NaN;
  return m;
})();

// A singular (zero-determinant) worldMatrix: an entire row zeroed out.
const SINGULAR_MATRIX = [
  0, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

// A well-formed, FINITE, INVERTIBLE worldMatrix (translate(2.5,0,0) * scale(1,2,1)) that still
// admits cleanly (isValidClearanceTransform, Task 8, checks only finiteness/invertibility) but is
// NOT uniform scale -- validateUniformScale's own finer-grained gate (ClearanceTransform.js) rejects
// it. World bounds are computed by hand to match this transform exactly (the box's own local -1..1
// extent on y is doubled by the scale(1,2,1) before translation), since this fixture's raw `matrix`
// override bypasses the `at`-only translation the shared bounds helper assumes.
const ANISOTROPIC_MATRIX = new THREE.Matrix4()
  .compose(new THREE.Vector3(2.5, 0, 0), new THREE.Quaternion(), new THREE.Vector3(1, 2, 1))
  .toArray();
const ANISOTROPIC_BOUNDS = { min: [1.5, -2, -1], max: [3.5, 2, 1] };

// Fixture 17: non-finite/invalid transform -> clearance-invalid-transform diagnostic, pair excluded,
// never silently dropped with zero diagnostics.
test('fixture 17: non-finite worldMatrix on a target instance -> clearance-invalid-transform diagnostic, no crash', async () => {
  const { modelA: sourceModel, modelB: targetModel, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [100] }],
    fragSpecsA: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [200] }],
    fragSpecsB: { 200: { geometryIndex: 0, geometry: box(2, 2, 2), at: [2.5, 0, 0], matrix: NAN_MATRIX } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(sourceModel);
  await world.admitModel(targetModel);

  const { pairs, statistics } = await world.findClashes({
    source: { model: sourceModel, dbIds: [1] },
    target: { targets: [{ model: targetModel }] },
    mode: 'clearance', clearance: 5, groupBy: 'dbId',
  });

  assert.equal(pairs.length, 0);
  const diag = statistics.diagnostics.find((d) => d.reason === 'clearance-invalid-transform');
  assert.ok(diag, 'expected a clearance-invalid-transform diagnostic');
  assert.equal(diag.scope, 'fragment');
  assert.equal(diag.role, 'target');
});

test('singular (non-invertible) worldMatrix -> clearance-invalid-transform diagnostic', async () => {
  const { modelA: sourceModel, modelB: targetModel, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [100] }],
    fragSpecsA: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [200] }],
    fragSpecsB: { 200: { geometryIndex: 0, geometry: box(2, 2, 2), at: [2.5, 0, 0], matrix: SINGULAR_MATRIX } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(sourceModel);
  await world.admitModel(targetModel);
  const { statistics } = await world.findClashes({
    source: { model: sourceModel, dbIds: [1] },
    target: { targets: [{ model: targetModel }] },
    mode: 'clearance', clearance: 5, groupBy: 'dbId',
  });
  assert.ok(statistics.diagnostics.some((d) => d.reason === 'clearance-invalid-transform'));
});

// Task reviewer fix (Important #2, fix round): coverage for _runClearanceNarrowPhasePair's own
// 'anisotropic-scale' outcome -- a well-formed, finite, invertible transform that survives Task 8's
// admission-time isValidClearanceTransform gate (which checks only finiteness/invertibility) but
// still fails validateUniformScale's own, finer-grained gate right before the composed Hard-Clash
// precheck/distance query. Distinct from fixture 17/the singular-matrix test above: this is a
// FRAGMENT-scoped diagnostic (found during narrow-phase evaluation, but describing the one offending
// OPERAND, not the pair), not the admission-time clearance-invalid-transform diagnostic -- but the
// two share the identical `scope: 'fragment'`/`role`/`fragment` shape, since both describe a property
// of one operand's own worldMatrix (Batch-2 review fix, Important #1, corrected shape -- see
// `diagnoseAnisotropicScaleOnce` in CollisionWorld.js. An earlier draft of this fix used
// `scope: 'pair'` with `sourceFragment`/`targetFragment` fields deduped per-fragment underneath --
// codex-review caught that this hybrid silently dropped diagnostics for later pairs sharing an
// already-diagnosed offending fragment, with attribution depending on candidate traversal order).
test('a well-formed but non-uniformly-scaled worldMatrix -> clearance-anisotropic-scale-unsupported diagnostic', async () => {
  const { modelA: sourceModel, modelB: targetModel, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [100] }],
    fragSpecsA: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [200] }],
    fragSpecsB: {
      200: {
        geometryIndex: 0, geometry: box(2, 2, 2), at: [2.5, 0, 0],
        matrix: ANISOTROPIC_MATRIX, bounds: ANISOTROPIC_BOUNDS,
      },
    },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(sourceModel);
  await world.admitModel(targetModel);

  const { pairs, statistics } = await world.findClashes({
    source: { model: sourceModel, dbIds: [1] },
    target: { targets: [{ model: targetModel }] },
    mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear',
  });

  assert.equal(pairs.length, 0);
  const diag = statistics.diagnostics.find((d) => d.reason === 'clearance-anisotropic-scale-unsupported');
  assert.ok(diag, 'expected a clearance-anisotropic-scale-unsupported diagnostic');
  assert.equal(diag.scope, 'fragment');
  assert.equal(diag.role, 'target');
  assert.equal(diag.fragment.fragId, 200);
});

// Batch-2 review fix (Important #1, reviewer-reproduced bug, corrected shape after a codex-review
// finding on this fix's own first draft): a single anisotropically-scaled fragment paired against N
// targets used to emit N identical `clearance-anisotropic-scale-unsupported` diagnostics --
// anisotropy is a property of ONE operand's own worldMatrix, not of the pair, so it must be diagnosed
// (fragment-scoped, like `diagnoseClearanceInvalidTransform`'s own sibling diagnostic) and deduped per
// (epoch, fragmentId) of the offending fragment, exactly like `diagnoseFragmentOnce`'s own existing
// dedup discipline (see `diagnoseAnisotropicScaleOnce` in CollisionWorld.js). This fixture puts the
// anisotropic transform on the SOURCE side (the sibling test above puts it on the target side) and
// pairs it against TWO distinct, well-formed target fragments, both within clearance range -- proving
// exactly one diagnostic survives, not two.
test('one anisotropically-scaled source fragment paired against 2 targets -> exactly one deduped diagnostic', async () => {
  const { modelA: sourceModel, modelB: targetModel, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [100] }],
    fragSpecsA: {
      // occupies x in [1.5, 3.5], y in [-2, 2], z in [-1, 1] (same ANISOTROPIC_MATRIX/BOUNDS pair the
      // sibling test above uses, just on the source operand this time).
      100: {
        geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0],
        matrix: ANISOTROPIC_MATRIX, bounds: ANISOTROPIC_BOUNDS,
      },
    },
    rootNodesB: [
      { dbId: 2, fragments: [200] },
      { dbId: 3, fragments: [300] },
    ],
    fragSpecsB: {
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [6, 0, 0] }, // gap 1.5 from source's face at x=3.5
      300: { geometryIndex: 2, geometry: box(2, 2, 2), at: [-2, 0, 0] }, // gap 2.5 from source's face at x=1.5
    },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(sourceModel);
  await world.admitModel(targetModel);

  const { pairs, statistics } = await world.findClashes({
    source: { model: sourceModel, dbIds: [1] },
    target: { targets: [{ model: targetModel }] },
    mode: 'clearance', clearance: 3, groupBy: 'dbId', broadPhase: 'linear',
  });

  assert.equal(pairs.length, 0, 'an anisotropic operand can never produce a hit');
  // Both candidate pairs genuinely reached narrow-phase evaluation (not skipped by broad phase) --
  // this is what proves the dedup below is collapsing TWO real diagnosed events into one, not just
  // reflecting that only one pair was ever evaluated.
  assert.equal(statistics.narrowPhasePairs, 2);
  const anisotropicDiagnostics = statistics.diagnostics.filter((d) => d.reason === 'clearance-anisotropic-scale-unsupported');
  assert.equal(anisotropicDiagnostics.length, 1, `expected exactly one deduped diagnostic, got ${anisotropicDiagnostics.length}`);
  assert.equal(anisotropicDiagnostics[0].scope, 'fragment');
  assert.equal(anisotropicDiagnostics[0].role, 'source');
  assert.equal(anisotropicDiagnostics[0].fragment.fragId, 100);
});

// Mirror image of the test above (codex-review coverage gap #1): one anisotropically-scaled TARGET
// fragment paired against TWO distinct SOURCE fragments -- proves the dedup/diagnosis logic is
// genuinely symmetric between source and target, not an artifact of always checking source first.
test('one anisotropically-scaled target fragment paired against 2 sources -> exactly one deduped diagnostic', async () => {
  const { modelA: sourceModel, modelB: targetModel, viewer } = makeTwoModelFixture({
    rootNodesA: [
      { dbId: 10, fragments: [100] },
      { dbId: 20, fragments: [101] },
    ],
    fragSpecsA: {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [6, 0, 0] }, // gap 1.5 from target's face at x=3.5
      101: { geometryIndex: 1, geometry: box(2, 2, 2), at: [-2, 0, 0] }, // gap 2.5 from target's face at x=1.5
    },
    rootNodesB: [{ dbId: 1, fragments: [200] }],
    fragSpecsB: {
      // occupies x in [1.5, 3.5], y in [-2, 2], z in [-1, 1] -- same ANISOTROPIC_MATRIX/BOUNDS pair,
      // on the target operand this time.
      200: {
        geometryIndex: 2, geometry: box(2, 2, 2), at: [0, 0, 0],
        matrix: ANISOTROPIC_MATRIX, bounds: ANISOTROPIC_BOUNDS,
      },
    },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(sourceModel);
  await world.admitModel(targetModel);

  const { pairs, statistics } = await world.findClashes({
    source: { model: sourceModel, dbIds: [10, 20] },
    target: { targets: [{ model: targetModel }] },
    mode: 'clearance', clearance: 3, groupBy: 'dbId', broadPhase: 'linear',
  });

  assert.equal(pairs.length, 0, 'an anisotropic operand can never produce a hit');
  assert.equal(statistics.narrowPhasePairs, 2);
  const anisotropicDiagnostics = statistics.diagnostics.filter((d) => d.reason === 'clearance-anisotropic-scale-unsupported');
  assert.equal(anisotropicDiagnostics.length, 1, `expected exactly one deduped diagnostic, got ${anisotropicDiagnostics.length}`);
  assert.equal(anisotropicDiagnostics[0].scope, 'fragment');
  assert.equal(anisotropicDiagnostics[0].role, 'target');
  assert.equal(anisotropicDiagnostics[0].fragment.fragId, 200);
});

// codex-review coverage gap #2: BOTH operands anisotropic in the same pair must produce TWO
// diagnostics (one per offending fragment), never one -- each side is diagnosed independently, so
// neither side's dedup check can suppress the other's.
test('both source and target anisotropically-scaled in the same pair -> two distinct diagnostics', async () => {
  const { modelA: sourceModel, modelB: targetModel, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [100] }],
    fragSpecsA: {
      100: {
        geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0],
        matrix: ANISOTROPIC_MATRIX, bounds: ANISOTROPIC_BOUNDS, // occupies x in [1.5, 3.5]
      },
    },
    rootNodesB: [{ dbId: 1, fragments: [200] }],
    fragSpecsB: {
      // A second, independently-anisotropic transform (translate(6,0,0) * scale(1,2,1)) so this
      // target is ALSO non-uniformly-scaled, not merely near the source.
      200: {
        geometryIndex: 1, geometry: box(2, 2, 2),
        matrix: new THREE.Matrix4()
          .compose(new THREE.Vector3(6, 0, 0), new THREE.Quaternion(), new THREE.Vector3(1, 2, 1))
          .toArray(),
        bounds: { min: [5, -2, -1], max: [7, 2, 1] }, // gap 1.5 from source's face at x=3.5
      },
    },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(sourceModel);
  await world.admitModel(targetModel);

  const { pairs, statistics } = await world.findClashes({
    source: { model: sourceModel, dbIds: [1] },
    target: { targets: [{ model: targetModel }] },
    mode: 'clearance', clearance: 3, groupBy: 'dbId', broadPhase: 'linear',
  });

  assert.equal(pairs.length, 0);
  assert.equal(statistics.narrowPhasePairs, 1);
  const anisotropicDiagnostics = statistics.diagnostics.filter((d) => d.reason === 'clearance-anisotropic-scale-unsupported');
  assert.equal(anisotropicDiagnostics.length, 2, `expected one diagnostic per offending fragment, got ${anisotropicDiagnostics.length}`);
  const roles = anisotropicDiagnostics.map((d) => d.role).sort();
  assert.deepEqual(roles, ['source', 'target']);
  assert.ok(anisotropicDiagnostics.some((d) => d.role === 'source' && d.fragment.fragId === 100));
  assert.ok(anisotropicDiagnostics.some((d) => d.role === 'target' && d.fragment.fragId === 200));
});

// codex-review coverage gap #3: diagnostic completeness must hold regardless of candidate traversal
// order -- under fragment-scoped dedup this is true by construction (each offending fragment is
// diagnosed independently of pair order), but this proves it empirically under BOTH broadPhase:'linear'
// and broadPhase:'tlas' for the same scene: exactly one diagnostic per offending fragment either way.
test('anisotropic-scale diagnostic completeness holds under both broadPhase:"linear" and broadPhase:"tlas"', async () => {
  const { modelA: sourceModel, modelB: targetModel, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [100] }],
    fragSpecsA: {
      100: {
        geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0],
        matrix: ANISOTROPIC_MATRIX, bounds: ANISOTROPIC_BOUNDS,
      },
    },
    rootNodesB: [
      { dbId: 2, fragments: [200] },
      { dbId: 3, fragments: [300] },
    ],
    fragSpecsB: {
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [6, 0, 0] },
      300: { geometryIndex: 2, geometry: box(2, 2, 2), at: [-2, 0, 0] },
    },
  });
  for (const broadPhase of ['linear', 'tlas']) {
    const world = await freshWorld(viewer, { now: frozenClock() });
    await world.admitModel(sourceModel);
    await world.admitModel(targetModel);
    const { pairs, statistics } = await world.findClashes({
      source: { model: sourceModel, dbIds: [1] },
      target: { targets: [{ model: targetModel }] },
      mode: 'clearance', clearance: 3, groupBy: 'dbId', broadPhase,
    });
    assert.equal(pairs.length, 0, `broadPhase:${broadPhase}`);
    const anisotropicDiagnostics = statistics.diagnostics.filter((d) => d.reason === 'clearance-anisotropic-scale-unsupported');
    assert.equal(anisotropicDiagnostics.length, 1, `broadPhase:${broadPhase} expected exactly one diagnostic, got ${anisotropicDiagnostics.length}`);
    assert.equal(anisotropicDiagnostics[0].fragment.fragId, 100, `broadPhase:${broadPhase}`);
  }
});

test('an invalid instance is never admitted into shared placement state for a clearance call', async () => {
  // Regression guard for the fix's own rationale: a subsequent, unrelated call against the same
  // models must not observe any lingering effect from the earlier invalid record (e.g. a corrupted
  // TLAS/placement entry) -- run a second, valid clearance query against the same models afterward
  // and assert it behaves exactly as if the invalid fragment had never existed.
  //
  // targetModel owns TWO dbIds: dbId 2 (a well-formed fragment, real near-miss gap 0.5 from source)
  // and dbId 3 (a corrupted, non-finite worldMatrix). The FIRST call sweeps the whole target model
  // (picking up both); the SECOND call re-queries ONLY the well-formed dbId 2, through the legacy
  // {model, dbIds} shape, and must reproduce the IDENTICAL clean result (same single pair, same
  // distance, and -- critically -- zero diagnostics of any kind), proving nothing the first call's
  // invalid fragment touched (representative-fragment map, placement table, instance cache) leaked
  // into this second, unrelated query.
  const { modelA: sourceModel, modelB: targetModel, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [100] }],
    fragSpecsA: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [
      { dbId: 2, fragments: [200] },
      { dbId: 3, fragments: [300] },
    ],
    fragSpecsB: {
      200: { geometryIndex: 0, geometry: box(2, 2, 2), at: [2.5, 0, 0] }, // valid, gap 0.5
      300: { geometryIndex: 1, geometry: box(2, 2, 2), at: [10, 0, 0], matrix: NAN_MATRIX }, // corrupted
    },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(sourceModel);
  await world.admitModel(targetModel);

  const first = await world.findClashes({
    source: { model: sourceModel, dbIds: [1] },
    target: { targets: [{ model: targetModel }] },
    mode: 'clearance', clearance: 1, groupBy: 'dbId',
  });
  assert.equal(first.pairs.length, 1, 'the well-formed dbId 2 pair still surfaces');
  assert.equal(first.pairs[0].target.dbId, 2);
  assert.ok(Math.abs(first.pairs[0].distance - 0.5) < 1e-3);
  assert.ok(first.statistics.diagnostics.some((d) => d.reason === 'clearance-invalid-transform' && d.fragment.dbId === 3));
  // Batch-2 review fix (Minor): this call's `target: { targets: [...] }` shape with no explicit
  // `broadPhase` selects TLAS by default (`effectiveBroadPhase` in CollisionWorld.js) -- but nothing
  // above actually DISCRIMINATES that; the assertions would pass identically under a silent fallback
  // to the linear scan. `clearanceExpandedCandidatePairs` is TLAS-only (stays 0 under
  // broadPhase:'linear', per Task 9/10's own statistics contract), so a positive value here proves
  // TLAS genuinely ran.
  assert.ok(first.statistics.clearanceExpandedCandidatePairs > 0, 'expected TLAS broad phase to have run by default for a {targets:[...]}-shaped call');

  const second = await world.findClashes({
    source: { model: sourceModel, dbIds: [1] },
    target: { model: targetModel, dbIds: [2] },
    mode: 'clearance', clearance: 1, groupBy: 'dbId',
  });
  assert.equal(second.pairs.length, 1);
  assert.equal(second.pairs[0].target.dbId, 2);
  assert.ok(Math.abs(second.pairs[0].distance - 0.5) < 1e-3);
  assert.deepEqual(second.statistics.diagnostics, [], 'no lingering effect from the earlier invalid fragment');
});
