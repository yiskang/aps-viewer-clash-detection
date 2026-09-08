# Collision Library Milestone-3 (Soft Clash / Clearance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the already-accepted M2.1 collision library with a second, independent query mode —
`mode:'clearance'` — that reports, per dbId pair, the exact minimum surface-to-surface world-space
distance between a source element and every other loaded element, when that distance is greater than
a tiny world-unit tolerance floor and no greater than a caller-supplied `clearance` threshold, with a
public closest-point witness (`sourcePoint`/`targetPoint`), unless that pair is already a Hard Clash —
plus a second, independent Viewer action, **Find Soft Clashes**, that visualizes the result as two
endpoint markers and a connecting line. Broad-phase candidate discovery reuses the existing TLAS
(`CollisionInstanceBVH`/`TlasCache`) verbatim via an inflated query box; a new permanent linear
oracle is the differential-correctness reference for it, mirroring the M1/M2 relationship between
`broadPhase:'linear'` and `broadPhase:'tlas'` exactly.

**Architecture:** A new pure narrow-phase module, `collision/query/ClearanceQuery.js`, wraps the
already-vendored, pinned `MeshBVH.prototype.closestPointToGeometry` to compute an exact world-space
minimum distance and two closest points, for **rigid transforms and uniform per-instance scale only**.
Every candidate pair whose exact, unpadded world-space AABBs overlap or touch is first run through the
existing `volumeOverlapQuery` (extended with a new, additive `conclusive` flag) as a **tri-state**
precheck so a Soft Clash can never be reported for a pair that is secretly a Hard Clash, and an
inconclusive precheck drops the pair (with a diagnostic) rather than risk a false negative.
`ThreeMeshBvhBackend.build()` gains a currently-missing invariant — `geometry.boundsTree = bvh` — a
hard prerequisite for `closestPointToGeometry`'s target-side acceleration. TLAS broad phase reuses
`CollisionInstanceBVH.queryBox` completely unmodified — clearance-specific behavior lives in the query
box (inflated by `clearance`) and a post-candidate exact-AABB retest. `findClashes` gains a fourth
`mode`, `'clearance'`, and a required `clearance` parameter; per-dbId-pair aggregation picks the
minimum-distance surviving fragment pair with a deterministic tie-break, reusing the real, confirmed
`comparePlacedCanonically` total order (mirroring `compareWitnessCandidates`'s own structure exactly).
`ClashFinderExtension` gains a second, independent context-menu action, **Find Soft Clashes**, with its
own `DEFAULT_CLEARANCE = 0.05`, its own action token, and its own overlay-scene namespace, while
reusing M2.1's clear-on-success/zero/failure, model-unload, extension-unload discipline unchanged.

**Tech Stack:** Node.js (`"type": "module"`), `node:test` + `node:assert/strict`, `three@0.185.1`,
vendored `three-mesh-bvh@0.9.14` (`node_modules/three-mesh-bvh`, mirrored via
`scripts/sync-vendor.mjs`), Playwright for acceptance/performance-gate automation, APS Viewer
(`@types/forge-viewer`, `env: 'AutodeskProduction'`, pinned `7.124.2`, `window.THREE` r71 global).

**Spec:** `docs/superpowers/specs/2026-09-07-collision-library-milestone3-clearance-design.md`
(reviewed and accepted per commit `918cd0e`) — the sole design source of truth.

**Revision note (v2 — post codex-review).** This is a revised version of the plan. An independent
`codex-review spec high` pass on the first draft found 5 Critical and 5 Important defects, all
independently confirmed against the real `collision/CollisionWorld.js`,
`collision/query/VolumeOverlapQuery.js`, `collision/query/ProperCrossingQuery.js`, and
`collision/query/ContainmentQuery.js` source during this revision (not taken on the review's word
alone). The defects and their fixes, carried through every task below:

1. **Critical — wrong geometry-resolution path.** The first draft's clearance narrow-phase code called
   `toInstance(sourcePlaced.instance, ...)` directly. The real `sourcePlaced.instance`
   (`CollisionWorld.js:46-53`'s `makePlaced`) is the canonical epoch-cached `CollisionInstance` —
   identity + `geometryIdentity` only, no `geometry`/`bvh`/`localDiagonal`. The ONLY valid way to get
   those is `await this._registry.getOrBuildGeometry(...)`, exactly as `_runNarrowPhasePair`'s private
   `buildOne` closure (`CollisionWorld.js:1649-1701`) already does. **Fix:** extract that closure into
   a shared top-level `resolveGeometryRecord` helper (Task 9), reused by both the existing composed
   modes (refactored, behavior-proven-identical via the full regression suite) and clearance.
2. **Critical — `ClearanceQuery.js`'s scale/point-frame/threshold math was wrong** for non-1:1
   source/target scale ratios (confirmed via `closestPointToGeometry_indirect.generated.js`): the
   `target1`/`target2` distance cross-check compared two different unit systems, `target2.point` had a
   spurious extra transform applied, and a single source-derived `maxThreshold` could wrongly prune a
   real within-clearance hit on the target side. **Fix:** Task 5 rewritten — cross-check
   `target1.distance * sourceScale` against `target2.distance * targetScale`; convert `target1.point`
   via `source.matrix` and `target2.point` via `target.matrix` directly (no relative-transform math on
   either point); use `clearance / Math.min(sourceScale, targetScale)` as a conservative threshold
   valid in both local frames; always apply an explicit final `worldDistance <= clearance` post-filter.
3. **Critical — the Hard-Clash precheck omitted `volumeOverlapQuery`'s required `{scheduler,
   compareCanonical}` options** and inferred "inconclusive" from an incomplete 3-string diagnostic
   allowlist. **Fix:** a new Task 6 adds an explicit, additive `conclusive: boolean` field to
   `volumeOverlapQuery`'s own return contract (derived from `crossing.aborted`/`crossing.inconclusive`,
   `aInB`/`bInA`'s `unresolvedComponentCount`, and the `non-manifold-component`/
   `unverified-parity-operand` diagnostics — the full, source-confirmed list, not a guess); the
   revised Task 7 precheck reads this one authoritative field and accepts the same
   `{scheduler, compareCanonical}` wiring the real composed-mode call site uses.
4. **Critical — admission/transform validation ran too late** (inside the broad-phase loops, where a
   NaN-bounds instance might never surface as a candidate at all, so validation would silently never
   run) **and used the wrong dbId-aggregation key** (`modelId`-qualified, violating this plan's own
   stated invariant that `modelId` stays diagnostic-only). **Fix:** the revised Task 8 validates and
   strips invalid extraction records from `sourceExtracted`/`targetRecordsByEpoch` immediately after
   extraction, before `_recordPlacement`/admission — which also means the broad-phase loops (Tasks 9,
   10) need no redundant per-candidate validity re-check at all. The revised Task 9 uses the real,
   confirmed key format: `` `${sourceOperand.epoch}:${sourcePlaced.ownerDbId}:${targetOperand.epoch}:${targetPlaced.ownerDbId}` ``.
5. **Critical — the TLAS budget check measured the wrong quantity**: it compared
   `clearanceExpandedCandidatePairs` (which only increments post-exact-filter, in `onCandidate`)
   against raw leaf-expansion `count`. The real `_runTlasBroadPhase` (`CollisionWorld.js:2133-2214`)
   uses a separate local `candidateBudgetUsed` accumulator, incremented by raw `count` inside
   `onLeafRange`, with a `pendingCapacityError`/`'stop'`/deferred-throw-after-traversal discipline.
   **Fix:** the revised Task 10 copies this exact real pattern verbatim.

Five Important fixes are also folded in throughout: the statistics increment-point table now has one
definitive, cross-checked source (`clearanceOverlapPrechecksRun` increments for `excluded` too, not
just `proceed`/`inconclusive`); `validateUniformScale` (Task 4) now rejects shear/projective matrices
structurally (orthogonal-basis check, not just equal-length scale) and documents its error bound;
Task 11's budget is redefined as a single upfront `candidates.length` check (materially simpler and
directly testable, since — a consequence of fix #4 above — the full candidate array is already known
before narrow-phase work starts, unlike TLAS's progressive leaf expansion); `ClashFinderExtension`'s
`load()` (Task 14) now validates `defaultClearance` as the very first thing it does, before any
registration, and Hard/Soft Clash use separate action tokens; Task 17's acceptance assertion no longer
relies on absence alone to prove Hard-Clash exclusion; Task 18's performance gate gets real
`reportSpan` production instrumentation and a "not exercised" (never a false GO) empty-span guard.

## Global Constraints

- Every M1/M2/M2.1 identity/lifecycle/error-contract invariant not explicitly changed by the M3 spec
  is preserved exactly. `supportedModes`'s existing three entries, their validation order, and their
  return shapes are unchanged; `groupBy:'dbId'`-only stays enforced; `loadEpoch` stays the sole
  cross-model identity axis; `modelId` stays diagnostic-only — **the clearance dbId-aggregation key is
  epoch-qualified, never modelId-qualified** (fix #4 above).
- `broadPhase:'linear'` is a first-class, permanent mode for clearance too — every clearance
  differential fixture (Task 13, fixture 11) depends on it staying byte-for-byte correct against
  `broadPhase:'tlas'`.
- No task silently truncates a result or converts a budget/capacity/precheck failure into a passing
  result. `CapacityExceededError` always throws, never truncates. An inconclusive Hard-Clash precheck
  always drops the fragment pair with a diagnostic, never guesses. Non-finite/singular transforms
  always diagnose and exclude, never silently produce a wrong distance.
- `mode:'clearance'` never weakens `volume-overlap`/`containment`/`surface-intersection`: those three
  modes' code paths, statistics, and diagnostics are byte-for-byte unchanged except where a shared
  helper (`ThreeMeshBvhBackend.build`, Task 2; `resolveGeometryRecord`, Task 9; `volumeOverlapQuery`'s
  additive `conclusive` field, Task 6) is explicitly, additively extended and proven not to alter
  existing observable behavior via the full regression suite.
- The tri-state Hard-Clash exclusion precheck (Task 7) never collapses to a boolean. `inconclusive` is
  a distinct, first-class outcome from both `excluded` and `proceed` everywhere it is consumed.
- Anisotropic per-instance scale is diagnosed unsupported (`clearance-anisotropic-scale-unsupported`),
  never approximated. Reflected/negative scale is likewise unsupported (Task 4).
- Test runner is `node:test` / `node:assert/strict`, ESM, files named `*.test.mjs`, discovered by
  `scripts/run-tests.mjs`'s own recursive walk, mirroring `collision/`'s own tree under `test/`.
- Every new public surface (statistics fields, `CapacityExceededError` kind, `mode` value) is additive
  and always present with a safe default (`0`) on every `findClashes` call.
- `DEFAULT_CLEARANCE = 0.05`, `maxClearanceNarrowPhasePairs` (provisional `20_000`), and the two
  `1e-4` tolerances (uniform-scale relative tolerance, distance cross-check relative tolerance) are
  explicitly provisional numeric defaults — Task 18 (performance gate) is the evidence-gathering step
  before any of them are revised; this plan implements the *semantics* now and defers the *numbers*.
- **`clearance-invalid-transform` is fragment-scoped, not pair-scoped** — it fires per invalid
  instance before any pair exists, deduped per `${epoch}:${fragmentId}`, exactly mirroring
  `diagnoseFragmentOnce`'s existing pattern for `geometry-not-yet-available`/oversized-geometry.
- **Hard Clash and Soft Clash use separate, independent action tokens** in `ClashFinderExtension` —
  firing one never silently cancels an in-flight run of the other (Task 14).

## Future downstream compatibility / non-goals

M3 does not implement Federated Clash Test & Results, Viewer Clash Panel, persistent result sets,
Group By/filtering UI, full-model-vs-full-model orchestration, or batch clash-management workflows.

However, M3's public contracts and internal orchestration must not block a future downstream path:

Federated Clash Test & Results → Viewer Clash Panel

Compatibility constraints (binding on every remaining task in this plan, Batches 2-4):

- preserve stable source / target identity across returned pairs
- do not hard-code the current single-source Viewer UX assumption into collision-core contracts
- keep result semantics sufficient for downstream grouping/filtering
- preserve a path toward batch / many-object execution
- preserve cancellation / abort compatibility
- preserve progress / yielding compatibility
- keep grouping, filtering, presentation, and result-set lifecycle responsibilities outside collision core
- avoid introducing APIs that would require a breaking redesign for future model-vs-model,
  model-vs-many, or many-vs-many execution

These are architecture constraints only. They do not add M3 implementation tasks or expand M3 scope.

Formal design for:
- Selection A / Selection B
- full-model enumeration
- model-vs-model / model-vs-many
- result-set lifecycle
- aggregation
- Group By
- filtering
- progress
- cancellation

is deferred to a separate post-M4 Federated Clash Test & Results specification.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `collision/constants.js` | modify | add `maxClearanceNarrowPhasePairs`, `clearanceUniformScaleRelativeTolerance`, `clearanceDistanceCrossCheckRelativeTolerance` |
| `collision/errors.js` | modify | add `'clearance-narrow-phase-budget'` to `CapacityExceededError`'s kind vocabulary |
| `collision/blas/ThreeMeshBvhBackend.js` | modify | assign `geometry.boundsTree = bvh` at the one canonical BLAS construction point |
| `collision/geometry/AabbDistance.js` | **new** | `aabbMinDistance(boundsA, boundsB)` |
| `collision/query/ClearanceTransform.js` | **new** | `validateUniformScale(matrix)`, `computeToleranceFloor(sourceInfo, targetInfo, surfaceEpsilonFactor)` |
| `collision/query/ClearanceQuery.js` | **new** | narrow-phase closest-point/distance module |
| `collision/query/VolumeOverlapQuery.js` | modify (additive) | add `conclusive: boolean` to every returned shape |
| `collision/query/ClearanceHardClashPrecheck.js` | **new** | tri-state exclusion classifier, reads `conclusive` |
| `collision/CollisionWorld.js` | modify (heavily) | `supportedModes` gains `'clearance'`; `clearance` param validation; extraction-time transform/bounds filtering; shared `resolveGeometryRecord`/`diagnoseFragmentOnce` helpers (refactored out of `_runNarrowPhasePair`); `_runClearanceBroadPhaseScan`; `_runClearanceTlasBroadPhase`; `_runClearanceNarrowPhasePair`; `compareClearanceCandidates`; 7 new statistics fields |
| `wwwroot/extensions/ClashFinderExtension.js` | modify | `Find Soft Clashes` action; `DEFAULT_CLEARANCE`/`defaultClearance`; separate action token; endpoint-marker + line visualization; own overlay scene + lifecycle |
| `test/geometry/AabbDistance.test.mjs` | **new** | analytically-known-box unit tests |
| `test/query/ClearanceTransform.test.mjs` | **new** | uniform-scale validation + tolerance-floor unit tests |
| `test/query/ClearanceQuery.test.mjs` | **new** | fixtures 1-4, 7, 13, 15, 16 (incl. unequal-scale regression) |
| `test/query/VolumeOverlapQuery.conclusive.test.mjs` | **new** | `conclusive` field unit tests |
| `test/query/ClearanceHardClashPrecheck.test.mjs` | **new** | proven-overlap / proven-no-overlap / inconclusive unit tests |
| `test/blas/ThreeMeshBvhBackend.boundsTree.test.mjs` | **new** | `geometry.boundsTree` contract/regression tests |
| `test/fixtures/geometry.mjs` | modify | `testInstance()` preserves the backend-returned `geometry` |
| `test/CollisionWorld.findClashes.clearance.test.mjs` | **new** | end-to-end `mode:'clearance'` API validation, linear+TLAS wiring, fixtures 5, 6, 8-12, 14, 17 |
| `test/CollisionWorld.clearanceStatistics.test.mjs` | **new** | 7-field statistics presence/consistency tests |
| `test/CollisionWorld.clearanceBudget.test.mjs` | **new** | `maxClearanceNarrowPhasePairs` capacity tests |
| `test/ClashFinderExtension.softClash.test.mjs` | **new** | Find Soft Clashes action + visualization + lifecycle tests |
| `test/acceptance/clash-finder.acceptance.mjs` | modify | bounded near-miss discovery + Soft Clash acceptance assertions |
| `test/performance/run-gate-m3.mjs` | **new** | M3 performance gate |
| `collision/README.md` | modify | new `'clearance'` mode row, statistics/diagnostics rows, "M3" section |
| `CHANGELOG.md` | modify | new `v0.3.0 — Soft Clash / Clearance` entry |
| `package.json` | modify | add `test:performance:gate:m3` script |

---

## Task 1: M3 constants, error kind, statistics scaffolding

**Files:**
- Modify: `collision/constants.js`, `collision/errors.js`, `collision/CollisionWorld.js` (`emptyStatistics`)
- Test: `test/CollisionWorld.emptyStatistics.m3.test.mjs` (new)

**Interfaces:**
- Produces: `maxClearanceNarrowPhasePairs` (`20_000`), `clearanceUniformScaleRelativeTolerance` (`1e-4`),
  `clearanceDistanceCrossCheckRelativeTolerance` (`1e-4`); `'clearance-narrow-phase-budget'` error kind;
  7 new always-`0` statistics fields.
- Consumes: nothing.

This task lands first because every later task's tests reference these constants/fields by name.

- [ ] **Step 1: Add the three new constants**

In `collision/constants.js`, in the existing "Budgets" section:

```js
// M3 — Soft Clash / Clearance. Provisional: revise against the M3 performance gate's real numbers
// (test/performance/run-gate-m3.mjs).
export const maxClearanceNarrowPhasePairs = 20_000;

// M3 — the design spec leaves both qualitative ("a small relative tolerance"); picked here to match
// the existing weld-epsilon order of magnitude. Provisional, same tuning discipline as above.
export const clearanceUniformScaleRelativeTolerance = 1e-4;
export const clearanceDistanceCrossCheckRelativeTolerance = 1e-4;
```

- [ ] **Step 2: Add the new `CapacityExceededError` kind message**

In `collision/errors.js`, extend `CAPACITY_EXCEEDED_MESSAGES`:

```js
'clearance-narrow-phase-budget': (k) =>
  `Clearance narrow-phase pair budget exceeded (${k}) — too many candidate pairs for this findClashes call`,
```

- [ ] **Step 3: Write the failing statistics test**

Create `test/CollisionWorld.emptyStatistics.m3.test.mjs`, modeled on `test/CollisionWorld.emptyStatistics.m2.test.mjs` (read that file first to match its exact stub-model/assertion pattern):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../collision/CollisionWorld.js';

test('M3 clearance statistics fields are always present and default to 0', async () => {
  const world = new CollisionWorld();
  // Reuse the exact model-stubbing helper test/CollisionWorld.emptyStatistics.m2.test.mjs already
  // uses for a trivial single-fragment model — do not invent a new stub shape.
  const model = /* mirror m2 test's own stub construction */ null;
  await world.admitModel(model);
  const { statistics } = await world.findClashes({
    source: { model, dbIds: [1] }, target: { model, dbIds: [1] }, mode: 'volume-overlap', groupBy: 'dbId',
  });
  for (const field of [
    'clearanceExpandedCandidatePairs', 'clearanceExactAabbSurvivors', 'clearanceOverlapPrechecksRun',
    'clearanceHardClashExclusions', 'clearanceDistanceQueriesRun', 'clearanceHits', 'clearanceQueryMs',
  ]) {
    assert.equal(statistics[field], 0, `${field} must default to 0 on a non-clearance call`);
  }
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test test/CollisionWorld.emptyStatistics.m3.test.mjs` — FAIL, fields are `undefined`.

- [ ] **Step 5: Add the 7 fields to `emptyStatistics()`**

```js
function emptyStatistics() {
  return {
    // ...existing 16 fields unchanged...
    clearanceExpandedCandidatePairs: 0,
    clearanceExactAabbSurvivors: 0,
    clearanceOverlapPrechecksRun: 0,
    clearanceHardClashExclusions: 0,
    clearanceDistanceQueriesRun: 0,
    clearanceHits: 0,
    clearanceQueryMs: 0,
  };
}
```

- [ ] **Step 6: Run test to verify it passes** — `node --test test/CollisionWorld.emptyStatistics.m3.test.mjs`

- [ ] **Step 7: Commit**

```bash
git add collision/constants.js collision/errors.js collision/CollisionWorld.js test/CollisionWorld.emptyStatistics.m3.test.mjs
git commit -m "feat(collision): add M3 clearance constants, error kind, statistics scaffolding"
```

**Completion criteria:** the 3 constants exist and are exported; `emptyStatistics()` returns all 7 new fields defaulting to `0` on every call.

**Protected invariants:** the existing 16 statistics fields and their values are byte-for-byte unchanged.

**Evidence required before coding:** none — pure additive scaffolding.

---

## Task 2: `boundsTree` production invariant + fixture parity

**Files:**
- Modify: `collision/blas/ThreeMeshBvhBackend.js`, `test/fixtures/geometry.mjs`
- Test: `test/blas/ThreeMeshBvhBackend.boundsTree.test.mjs` (new)

**Interfaces:**
- Produces: `build(weldedGeometry)`'s returned `geometry` now has `geometry.boundsTree === bvh`.
  `test/fixtures/geometry.mjs`'s `testInstance()` now returns the backend's own `geometry`. Every later
  task (5, 9, 10) calling `source.bvh.closestPointToGeometry(target.geometry, ...)` depends on
  `target.geometry.boundsTree` for the accelerated path to engage.

This is the correctness-critical prerequisite: without it, every clearance query would still be
*correct* but silently take three-mesh-bvh's unaccelerated linear-scan fallback on the target side.

- [ ] **Step 1: Write the failing contract test**

Create `test/blas/ThreeMeshBvhBackend.boundsTree.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../collision/blas/ThreeMeshBvhBackend.js';
import { box, weld, testInstance } from '../fixtures/geometry.mjs';

function weldedFromBox(w, h, d) {
  const welded = weld(box(w, h, d));
  return { position: welded.attributes.position.array, index: welded.index.array, triangleCount: welded.index.count / 3 };
}

test('build() assigns geometry.boundsTree to the same MeshBVH instance it returns', () => {
  const { bvh, geometry } = build(weldedFromBox(2, 2, 2));
  assert.strictEqual(geometry.boundsTree, bvh);
});

test('testInstance() fixtures share the same boundsTree invariant as production', () => {
  const instance = testInstance(box(2, 2, 2));
  assert.equal(instance.geometry.boundsTree, instance.bvh,
    'fixture geometry and production geometry must share the same invariant');
});
```

- [ ] **Step 2: Run test to verify it fails** — `geometry.boundsTree` is `undefined`.

- [ ] **Step 3: Implement the assignment**

In `collision/blas/ThreeMeshBvhBackend.js`, immediately after BVH construction:

```js
const bvh = new MeshBVH(geometry, { indirect: true });
geometry.boundsTree = bvh; // M3: required for closestPointToGeometry's target-side acceleration —
                            // the one canonical BLAS construction point; never attach a second tree.
```

- [ ] **Step 4: Run first test to verify it passes, second still fails**

- [ ] **Step 5: Fix `testInstance()` to preserve the backend's geometry**

In `test/fixtures/geometry.mjs`, `testInstance()` currently discards the backend-returned `geometry`
in favor of a separately-welded object. Change to use `buildBvh`'s own returned `geometry`:

```js
export function testInstance(geometry, matrix = new THREE.Matrix4()) {
  const welded = weld(geometry);
  const raw = weldedFromRaw(welded);
  const { bvh, geometry: builtGeometry, localDiagonal, aspectRatio, aspectRatioExceeded } = buildBvh(raw);
  const connectivity = computeGeometryConnectivity(raw);
  return {
    geometry: builtGeometry, bvh, localDiagonal, connectivity,
    closedManifold: connectivity.closedManifold.every(Boolean) && connectivity.componentCount > 0,
    matrix, aspectRatio, aspectRatioExceeded,
  };
}
```

- [ ] **Step 6: Run both tests to verify they pass; run the FULL existing suite for regressions**

`node --test test/blas/ThreeMeshBvhBackend.boundsTree.test.mjs` then `npm test` (full suite) — every
pre-existing test that calls `testInstance()` must still pass, since `geometry` is still a real,
equivalent welded `THREE.BufferGeometry` — only its identity and `boundsTree` differ.

- [ ] **Step 7: Commit**

```bash
git add collision/blas/ThreeMeshBvhBackend.js test/fixtures/geometry.mjs test/blas/ThreeMeshBvhBackend.boundsTree.test.mjs
git commit -m "fix(collision): assign geometry.boundsTree at the canonical BLAS construction point"
```

**Completion criteria:** `build()`'s returned `geometry.boundsTree === bvh` always; `testInstance()` fixtures share the identical invariant; full existing suite still green.

**Protected invariants:** `indirect: true` build option unchanged; no second BVH is ever constructed.

**Evidence required before coding:** none.

---

## Task 3: Exact AABB-to-AABB minimum-distance helper

**Files:**
- Create: `collision/geometry/AabbDistance.js`
- Test: `test/geometry/AabbDistance.test.mjs`

**Interfaces:**
- Produces: `aabbMinDistance(boundsA, boundsB) -> number`, over `{min:[x,y,z], max:[x,y,z]}` bounds
  (the same shape `_testBroadPhasePair` reads). Consumed by Tasks 7, 9, 10.

- [ ] **Step 1: Write the failing tests with analytically known boxes**

Create `test/geometry/AabbDistance.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { aabbMinDistance } from '../../collision/geometry/AabbDistance.js';

test('separated on one axis: exact gap', () => {
  assert.equal(aabbMinDistance({ min: [0,0,0], max: [1,1,1] }, { min: [4,0,0], max: [5,1,1] }), 3);
});
test('separated on two axes: exact diagonal-in-plane gap', () => {
  assert.equal(aabbMinDistance({ min: [0,0,0], max: [1,1,1] }, { min: [4,5,0], max: [5,6,1] }), 5);
});
test('separated on three axes: exact 3D gap', () => {
  assert.equal(aabbMinDistance({ min: [0,0,0], max: [1,1,1] }, { min: [4,5,13], max: [5,6,14] }), 13);
});
test('overlapping: exact 0', () => {
  assert.equal(aabbMinDistance({ min: [0,0,0], max: [2,2,2] }, { min: [1,1,1], max: [3,3,3] }), 0);
});
test('touching (shared face): exact 0', () => {
  assert.equal(aabbMinDistance({ min: [0,0,0], max: [1,1,1] }, { min: [1,0,0], max: [2,1,1] }), 0);
});
test('containment: exact 0', () => {
  assert.equal(aabbMinDistance({ min: [0,0,0], max: [10,10,10] }, { min: [3,3,3], max: [4,4,4] }), 0);
});
test('is symmetric', () => {
  const a = { min: [0,0,0], max: [1,1,1] }, b = { min: [4,5,13], max: [5,6,14] };
  assert.equal(aabbMinDistance(a, b), aabbMinDistance(b, a));
});
```

- [ ] **Step 2: Run tests to verify they fail** — module does not exist.

- [ ] **Step 3: Implement `aabbMinDistance`**

Create `collision/geometry/AabbDistance.js`:

```js
/**
 * Exact, unpadded AABB-to-AABB minimum-distance lower bound, in world units. Every collision surface
 * is entirely contained within its own AABB, so this is a valid, conservative necessary condition for
 * "true surface-to-surface distance <= threshold" — no true positive is ever missed. Reused verbatim
 * by the clearance linear oracle, the TLAS post-candidate exact retest, and the Hard-Clash-precheck
 * branch decision — by design the *same* predicate at all three call sites.
 */
export function aabbMinDistance(boundsA, boundsB) {
  let dx = 0, dy = 0, dz = 0;
  if (boundsA.max[0] < boundsB.min[0]) dx = boundsB.min[0] - boundsA.max[0];
  else if (boundsB.max[0] < boundsA.min[0]) dx = boundsA.min[0] - boundsB.max[0];
  if (boundsA.max[1] < boundsB.min[1]) dy = boundsB.min[1] - boundsA.max[1];
  else if (boundsB.max[1] < boundsA.min[1]) dy = boundsA.min[1] - boundsB.max[1];
  if (boundsA.max[2] < boundsB.min[2]) dz = boundsB.min[2] - boundsA.max[2];
  else if (boundsB.max[2] < boundsA.min[2]) dz = boundsA.min[2] - boundsB.max[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add collision/geometry/AabbDistance.js test/geometry/AabbDistance.test.mjs
git commit -m "feat(collision): add exact AABB-to-AABB minimum-distance helper for M3 clearance"
```

**Completion criteria:** `aabbMinDistance` returns exact, symmetric results for separated/touching/overlapping/containing box pairs on 1, 2, and 3 axes.

**Protected invariants:** none touched yet.

**Evidence required before coding:** none.

---

## Task 4: Uniform-scale validator + world-unit tolerance floor helper

**Files:**
- Create: `collision/query/ClearanceTransform.js`
- Test: `test/query/ClearanceTransform.test.mjs`

**Interfaces:**
- Consumes: `clearanceUniformScaleRelativeTolerance` (Task 1).
- Produces: `validateUniformScale(matrix)`, `computeToleranceFloor(sourceInfo, targetInfo, surfaceEpsilonFactor)`.
  Consumed by Task 5 (`ClearanceQuery`), Task 9 (linear wiring).

**Fix (Important #2, post-review):** the first draft only compared the three decomposed scale
magnitudes for equality, which does not reject a sheared/projective matrix (equal-length,
non-orthogonal basis columns pass a magnitude-only check but have no valid single-scalar
local-to-world distance conversion). The revised validator additionally requires the three decomposed
basis columns to be mutually orthogonal within the same relative tolerance, and rejects
reflected/negative scale outright (M3 does not support it). The absolute `Number.EPSILON` determinant
cutoff from the first draft is also replaced with a scale-relative check (a valid, tiny uniform scale
must never be rejected merely for having a small determinant).

- [ ] **Step 1: Write the failing tests**

Create `test/query/ClearanceTransform.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { validateUniformScale, computeToleranceFloor } from '../../collision/query/ClearanceTransform.js';

test('rigid transform (no scale): valid, scaleFactor 1', () => {
  const m = new THREE.Matrix4().makeRotationY(Math.PI / 4).setPosition(1, 2, 3);
  const result = validateUniformScale(m);
  assert.equal(result.valid, true);
  assert.ok(Math.abs(result.scaleFactor - 1) < 1e-9);
});

test('uniform scale: valid, scaleFactor matches', () => {
  const m = new THREE.Matrix4().makeScale(2, 2, 2).setPosition(5, 0, 0);
  const result = validateUniformScale(m);
  assert.equal(result.valid, true);
  assert.ok(Math.abs(result.scaleFactor - 2) < 1e-9);
});

test('anisotropic scale: invalid', () => {
  assert.equal(validateUniformScale(new THREE.Matrix4().makeScale(2, 1, 1)).valid, false);
});

test('scale uniform within relative tolerance: valid', () => {
  const m = new THREE.Matrix4().makeScale(2, 2 * (1 + 1e-5), 2); // well inside 1e-4 tolerance
  assert.equal(validateUniformScale(m).valid, true);
});

test('scale drift beyond relative tolerance: invalid', () => {
  const m = new THREE.Matrix4().makeScale(2, 2 * (1 + 1e-2), 2); // 1% drift, well beyond 1e-4
  assert.equal(validateUniformScale(m).valid, false);
});

test('sheared matrix (equal-length, non-orthogonal basis columns): invalid', () => {
  // A shear along X proportional to Y: basis columns [1,0,0], [1,1,0] have equal magnitudes on some
  // constructions but are not orthogonal — a magnitude-only check would wrongly accept this.
  const m = new THREE.Matrix4().set(
    1, 1, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  );
  assert.equal(validateUniformScale(m).valid, false);
});

test('reflected (negative) scale: invalid', () => {
  assert.equal(validateUniformScale(new THREE.Matrix4().makeScale(-2, 2, 2)).valid, false);
});

test('tiny but legitimate uniform scale is not rejected by an absolute determinant cutoff', () => {
  const m = new THREE.Matrix4().makeScale(1e-6, 1e-6, 1e-6).setPosition(1, 1, 1);
  const result = validateUniformScale(m);
  assert.equal(result.valid, true);
  assert.ok(Math.abs(result.scaleFactor - 1e-6) < 1e-12);
});

test('non-finite matrix: invalid, not a thrown exception', () => {
  const m = new THREE.Matrix4();
  m.elements[0] = NaN;
  assert.equal(validateUniformScale(m).valid, false);
});

test('toleranceFloor: rigid transforms, world units equal local units', () => {
  const floor = computeToleranceFloor({ localDiagonal: 10, scaleFactor: 1 }, { localDiagonal: 6, scaleFactor: 1 }, 1e-6);
  assert.ok(Math.abs(floor - 1e-6 * 10) < 1e-12); // max(10*1, 6*1) = 10
});

test('toleranceFloor: uniform scale converts local diagonal to world units before max()', () => {
  const floor = computeToleranceFloor({ localDiagonal: 10, scaleFactor: 0.5 }, { localDiagonal: 6, scaleFactor: 2 }, 1e-6);
  assert.ok(Math.abs(floor - 1e-6 * 12) < 1e-12); // max(5, 12) = 12, not max(10, 6) = 10
});
```

- [ ] **Step 2: Run tests to verify they fail** — module does not exist.

- [ ] **Step 3: Implement `ClearanceTransform.js`**

Create `collision/query/ClearanceTransform.js`:

```js
import * as THREE from 'three';
import { clearanceUniformScaleRelativeTolerance } from '../constants.js';

const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchColA = new THREE.Vector3();
const scratchColB = new THREE.Vector3();
const scratchColC = new THREE.Vector3();

/**
 * Validates that a world matrix decomposes to rigid + POSITIVE uniform scale only (M3's supported
 * transform class). Structural checks, not just scale-magnitude comparison: rejects shear/projective
 * matrices (non-orthogonal basis columns) and reflected/negative scale. Anisotropic scale is diagnosed
 * unsupported by the caller, never approximated here.
 *
 * Error bound: when accepted, the reported scaleFactor may differ from any single axis's true scale
 * by up to `clearanceUniformScaleRelativeTolerance` (1e-4) relative — i.e. a world distance computed
 * from it carries a bounded relative error of the same order. This is a real, documented
 * approximation, not silently exact.
 *
 * @param {THREE.Matrix4} matrix
 * @returns {{valid: true, scaleFactor: number} | {valid: false}}
 */
export function validateUniformScale(matrix) {
  const elements = matrix.elements;
  for (let i = 0; i < 16; i++) {
    if (!Number.isFinite(elements[i])) return { valid: false };
  }
  // Affine bottom row required (no projective component).
  if (elements[3] !== 0 || elements[7] !== 0 || elements[11] !== 0 || elements[15] !== 1) {
    return { valid: false };
  }

  matrix.decompose(scratchPosition, scratchQuaternion, scratchScale);
  const { x: sx, y: sy, z: sz } = scratchScale;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(sz)) return { valid: false };
  if (sx <= 0 || sy <= 0 || sz <= 0) return { valid: false }; // reflections/negative scale unsupported

  const scaleFactor = (sx + sy + sz) / 3;
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) return { valid: false };
  const tol = clearanceUniformScaleRelativeTolerance;
  const withinTolerance = (v) => Math.abs(v - scaleFactor) <= tol * scaleFactor;
  if (!withinTolerance(sx) || !withinTolerance(sy) || !withinTolerance(sz)) return { valid: false };

  // Orthogonality check: reject shear/projective-like matrices that pass a magnitude-only check.
  // matrix.decompose() already extracted scale via column length, so re-derive the (still possibly
  // non-orthogonal) raw basis columns from `matrix.elements` directly and check pairwise dot products
  // are ~0 relative to the columns' own magnitudes.
  scratchColA.set(elements[0], elements[1], elements[2]);
  scratchColB.set(elements[4], elements[5], elements[6]);
  scratchColC.set(elements[8], elements[9], elements[10]);
  const mag = scaleFactor; // all three columns are within `tol` of this by the check above
  const orthTol = tol * mag * mag;
  if (Math.abs(scratchColA.dot(scratchColB)) > orthTol) return { valid: false };
  if (Math.abs(scratchColA.dot(scratchColC)) > orthTol) return { valid: false };
  if (Math.abs(scratchColB.dot(scratchColC)) > orthTol) return { valid: false };

  return { valid: true, scaleFactor };
}

/**
 * World-unit clearance tolerance floor:
 *   toleranceFloor = surfaceEpsilonFactor * max(source.localDiagonal * source.scaleFactor,
 *                                                target.localDiagonal * target.scaleFactor)
 * Both operands' local-frame diagonals are converted to world units via their own validated uniform
 * scale factor BEFORE the max() — comparing local- and world-frame quantities directly is invalid.
 */
export function computeToleranceFloor(sourceInfo, targetInfo, surfaceEpsilonFactor) {
  const sourceWorldDiagonal = sourceInfo.localDiagonal * sourceInfo.scaleFactor;
  const targetWorldDiagonal = targetInfo.localDiagonal * targetInfo.scaleFactor;
  return surfaceEpsilonFactor * Math.max(sourceWorldDiagonal, targetWorldDiagonal);
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add collision/query/ClearanceTransform.js test/query/ClearanceTransform.test.mjs
git commit -m "feat(collision): add clearance uniform-scale validator and world-unit tolerance floor"
```

**Completion criteria:** `validateUniformScale` rejects anisotropic, sheared, reflected, and non-finite
transforms; accepts rigid and positive-uniform-scale transforms including very small scales;
`computeToleranceFloor` converts local diagonals to world units before taking the max.

**Protected invariants:** none touched yet.

**Evidence required before coding:** none — pure new math per spec §5/§9's formulas, tightened per review.

---

## Task 5: `ClearanceQuery.js` narrow-phase module

**Files:**
- Create: `collision/query/ClearanceQuery.js`
- Test: `test/query/ClearanceQuery.test.mjs`

**Interfaces:**
- Consumes: `validateUniformScale` (Task 4); `Instance` shape `{geometry, bvh, matrix, localDiagonal}`;
  the pinned `MeshBVH.prototype.closestPointToGeometry(otherGeometry, geometryToBvh, target1, target2,
  minThreshold, maxThreshold)`; `target.geometry.boundsTree` (Task 2); `toFiniteWorldArray` (exported
  test-only from `collision/query/VolumeOverlapQuery.js:34-39`, confirmed signature:
  `toFiniteWorldArray(localPoint: THREE.Vector3, worldMatrix: THREE.Matrix4) -> number[]|null`).
- Produces: `clearanceQuery(source, target, options)`. Consumed by Task 9 (linear/TLAS wiring).

**Fix (Critical #2, post-review).** Codex's review, backed by reading
`node_modules/three-mesh-bvh/src/core/cast/closestPointToGeometry_indirect.generated.js` directly,
found four real defects in the first draft:

1. `target1.distance` is in SOURCE-local units; `target2.distance` is recomputed after both points are
   converted into TARGET-local space — they are NOT directly comparable when source/target scales
   differ. **Fix:** cross-check `target1.distance * sourceScaleFactor` against
   `target2.distance * targetScaleFactor` (both in world units).
2. `target2.point` is ALREADY in target-local space (not source-local). The first draft re-applied
   `targetToSourceMatrix.clone().invert()` to it, a spurious extra transform. **Fix:** convert
   `target1.point` to world via `source.matrix` directly; convert `target2.point` to world via
   `target.matrix` directly — no relative-transform math on either point.
3. `maxThreshold = clearance / sourceScaleFactor` is applied to BOTH the outer source-local traversal
   and (internally, inside the pinned API's own nested target-side shapecast) a target-local
   traversal operating in a DIFFERENT local scale when source/target scales differ — a single
   source-derived threshold can wrongly prune a real within-clearance hit on the target side (Codex's
   own repro: source scale 2, target scale 1, world gap 2, clearance 3 → `maxThreshold=1.5` returns
   `null` even though the true world gap is within clearance). **Fix:** use
   `clearance / Math.min(sourceScaleFactor, targetScaleFactor)` — a conservative threshold valid in
   BOTH local frames — and always apply an explicit final `worldDistance <= clearance` post-filter on
   the actual computed world distance (never trust threshold-pruning alone for the public contract).
4. The tolerance-floor call site (Task 9) must pass the REAL validated scale factors, never hardcode
   them to `1`.

- [ ] **Step 0: Verify `toFiniteWorldArray`'s exact export and signature**

Read `collision/query/VolumeOverlapQuery.js` lines 30-40 directly before writing the import — the
signature above is already confirmed (`toFiniteWorldArray(localPoint, worldMatrix)`, returns a
plain 3-number array or `null`), but re-confirm no shape drift before use.

- [ ] **Step 1: Write the failing tests for exact known-gap fixtures**

Create `test/query/ClearanceQuery.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clearanceQuery } from '../../collision/query/ClearanceQuery.js';
import { box, at, testInstance } from '../fixtures/geometry.mjs';

// Fixture 1: farther than clearance. Two 2x2x2 boxes, centers 10 apart on X -> exact face gap 8.
test('fixture 1: farther than clearance -> withinClearance:false, distance:null', () => {
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(10, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 2, toleranceFloor: 1e-9 });
  assert.equal(result.withinClearance, false);
  assert.equal(result.distance, null);
});

// Fixture 3: slightly within threshold. Boxes at (0,0,0) and (2.5,0,0), clearance=1 -> gap 0.5.
test('fixture 3: slightly within threshold -> withinClearance:true, distance ~ 0.5', () => {
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(2.5, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 1, toleranceFloor: 1e-9 });
  assert.equal(result.withinClearance, true);
  assert.ok(Math.abs(result.distance - 0.5) < 1e-4);
  assert.ok(Array.isArray(result.witness.sourcePoint) && result.witness.sourcePoint.length === 3);
  assert.ok(Array.isArray(result.witness.targetPoint) && result.witness.targetPoint.length === 3);
  // Endpoints must actually be near the two facing faces (x~1 and x~1.5), not swapped/garbled.
  assert.ok(Math.abs(result.witness.sourcePoint[0] - 1) < 1e-3);
  assert.ok(Math.abs(result.witness.targetPoint[0] - 1.5) < 1e-3);
});

// Fixture 2: exactly at threshold (inclusive per spec's (floor, clearance] interval).
test('fixture 2: exactly at threshold -> withinClearance:true', () => {
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(3, 0, 0)); // face gap exactly 1
  const result = clearanceQuery(source, target, { clearance: 1, toleranceFloor: 1e-9 });
  assert.equal(result.withinClearance, true);
  assert.ok(Math.abs(result.distance - 1) < 1e-4);
});

// Fixture 4 / 13: surface touching / dead-band -> withinClearance:false.
test('fixture 4: touching surfaces (gap 0) -> withinClearance:false', () => {
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(2, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 1, toleranceFloor: 1e-6 });
  assert.equal(result.withinClearance, false);
  assert.ok(Math.abs(result.distance) < 1e-4);
});

test('fixture 13: dead-band gap below toleranceFloor -> withinClearance:false', () => {
  const gap = 1e-7;
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(2 + gap, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 1, toleranceFloor: 1e-6 });
  assert.equal(result.withinClearance, false);
});

// Fixture 7: rotated geometry, analytically known corner-to-face distance.
test('fixture 7: rotated source, analytically known minimum distance', () => {
  const rotated = new THREE.Matrix4().makeRotationY(Math.PI / 4);
  const source = testInstance(box(2, 2, 2), rotated);
  const target = testInstance(box(2, 2, 2), at(3 + Math.SQRT2, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 1, toleranceFloor: 1e-6 });
  assert.equal(result.withinClearance, true);
  assert.ok(Math.abs(result.distance - 1) < 1e-3);
});

// Fixture 16: uniform scale correctness, EQUAL scale — reported distance must be world-space.
test('fixture 16a: equal uniform scale, distance converted to world units', () => {
  const scaled = new THREE.Matrix4().makeScale(2, 2, 2).setPosition(0, 0, 0);
  const source = testInstance(box(1, 1, 1), scaled); // local half-size 0.5, world half-size 1
  const target = testInstance(box(2, 2, 2), at(4, 0, 0)); // target half-size 1, face at x=3
  const result = clearanceQuery(source, target, { clearance: 3, toleranceFloor: 1e-6 });
  assert.equal(result.withinClearance, true);
  assert.ok(Math.abs(result.distance - 2) < 1e-3, `expected world-space gap ~2, got ${result.distance}`);
});

// Fixture 16b (Critical #2 regression, Codex's own repro): UNEQUAL source/target scale. Source
// scale 2, target scale 1, true world gap 2, clearance 3 -- a naive single-source-derived
// maxThreshold (1.5) would wrongly return null here; the fix must find the real within-clearance hit.
test('fixture 16b: unequal source/target scale, distance still correct and within clearance', () => {
  const sourceScaled = new THREE.Matrix4().makeScale(2, 2, 2).setPosition(0, 0, 0);
  const source = testInstance(box(1, 1, 1), sourceScaled); // world half-size 1, face at x=1
  const target = testInstance(box(2, 2, 2), at(4, 0, 0)); // scale 1, face at x=3 -- world gap 2
  const result = clearanceQuery(source, target, { clearance: 3, toleranceFloor: 1e-6 });
  assert.equal(result.withinClearance, true);
  assert.ok(Math.abs(result.distance - 2) < 1e-3, `expected world-space gap ~2, got ${result.distance}`);
});

// Fixture 15: anisotropic scale rejection.
test('fixture 15: anisotropic source scale -> aborted with clearance-anisotropic-scale-unsupported', () => {
  const aniso = new THREE.Matrix4().makeScale(2, 1, 1);
  const source = testInstance(box(1, 1, 1), aniso);
  const target = testInstance(box(2, 2, 2), at(4, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 5, toleranceFloor: 1e-6 });
  assert.equal(result.aborted, true);
  assert.ok(result.diagnostics.some((d) => d.reason === 'clearance-anisotropic-scale-unsupported'));
});

test('non-finite source matrix -> aborted', () => {
  const bad = new THREE.Matrix4();
  bad.elements[0] = NaN;
  const source = testInstance(box(1, 1, 1), bad);
  const target = testInstance(box(2, 2, 2), at(4, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 5, toleranceFloor: 1e-6 });
  assert.equal(result.aborted, true);
});
```

- [ ] **Step 2: Run tests to verify they fail** — module does not exist.

- [ ] **Step 3: Implement `ClearanceQuery.js`**

Create `collision/query/ClearanceQuery.js`:

```js
import * as THREE from 'three';
import { validateUniformScale } from './ClearanceTransform.js';
import { toFiniteWorldArray } from './VolumeOverlapQuery.js'; // confirmed export, see Step 0
import { clearanceDistanceCrossCheckRelativeTolerance } from '../constants.js';

const scratchRelative = new THREE.Matrix4();
const scratchInverseSource = new THREE.Matrix4();
const scratchPoint1 = new THREE.Vector3();
const scratchPoint2 = new THREE.Vector3();

/**
 * Exact minimum surface-to-surface distance between two Instances, for rigid + uniform-scale
 * transforms only. Same Instance shape as volumeOverlapQuery: {geometry, bvh, matrix, localDiagonal}.
 *
 * @param {{geometry, bvh, matrix: THREE.Matrix4, localDiagonal: number}} source
 * @param {{geometry, bvh, matrix: THREE.Matrix4, localDiagonal: number}} target
 * @param {{clearance: number, toleranceFloor: number}} options
 * @returns {
 *   {withinClearance: true, distance: number, witness: {sourcePoint:number[], targetPoint:number[]}} |
 *   {withinClearance: false, distance: number|null} |
 *   {aborted: true, diagnostics: object[]}
 * }
 */
export function clearanceQuery(source, target, options) {
  const { clearance, toleranceFloor } = options;

  const sourceScale = validateUniformScale(source.matrix);
  const targetScale = validateUniformScale(target.matrix);
  if (!sourceScale.valid || !targetScale.valid) {
    return { aborted: true, diagnostics: [{ reason: 'clearance-anisotropic-scale-unsupported' }] };
  }

  scratchInverseSource.copy(source.matrix).invert();
  if (!Number.isFinite(scratchInverseSource.elements[0])) {
    return { aborted: true, diagnostics: [{ reason: 'clearance-anisotropic-scale-unsupported' }] };
  }
  const targetToSourceMatrix = scratchRelative.multiplyMatrices(scratchInverseSource, target.matrix);

  // Conservative threshold valid in BOTH operands' local frames (Critical #2 fix #3): the pinned
  // API's own nested target-side traversal operates in target-local units, so a threshold derived
  // only from sourceScale can wrongly prune a real hit when targetScale < sourceScale.
  const maxThresholdLocal = clearance / Math.min(sourceScale.scaleFactor, targetScale.scaleFactor);
  const target1 = {};
  const target2 = {};
  const raw = source.bvh.closestPointToGeometry(
    target.geometry, targetToSourceMatrix, target1, target2, 0, maxThresholdLocal,
  );

  if (raw === null || raw === undefined) {
    return { withinClearance: false, distance: null };
  }

  const localDistance1 = target1.distance;
  const localDistance2 = target2.distance;
  if (!Number.isFinite(localDistance1) || !Number.isFinite(localDistance2)) {
    return { aborted: true, diagnostics: [{ reason: 'clearance-distance-unavailable' }] };
  }

  // Cross-check in WORLD units (Critical #2 fix #1) -- target1.distance is source-local,
  // target2.distance is target-local; comparing them raw compares two different unit systems.
  const worldDistanceFromSource = localDistance1 * sourceScale.scaleFactor;
  const worldDistanceFromTarget = localDistance2 * targetScale.scaleFactor;
  const tol = clearanceDistanceCrossCheckRelativeTolerance;
  const larger = Math.max(Math.abs(worldDistanceFromSource), Math.abs(worldDistanceFromTarget), Number.EPSILON);
  if (Math.abs(worldDistanceFromSource - worldDistanceFromTarget) > tol * larger) {
    return { aborted: true, diagnostics: [{ reason: 'clearance-distance-unavailable' }] };
  }
  const worldDistance = worldDistanceFromSource;

  if (Number.isInteger(target1.faceIndex)) target1.faceIndex = source.bvh.resolveTriangleIndex(target1.faceIndex);
  if (Number.isInteger(target2.faceIndex)) target2.faceIndex = target.bvh.resolveTriangleIndex(target2.faceIndex);

  // Critical #2 fix #2: target1.point converts via source.matrix directly (it is already
  // source-local); target2.point converts via target.matrix directly (it is already target-local) --
  // NO relative-transform math on either point.
  scratchPoint1.set(target1.point.x, target1.point.y, target1.point.z);
  scratchPoint2.set(target2.point.x, target2.point.y, target2.point.z);
  const sourcePointWorld = toFiniteWorldArray(scratchPoint1, source.matrix);
  const targetPointWorld = toFiniteWorldArray(scratchPoint2, target.matrix);

  if (!sourcePointWorld || !targetPointWorld) {
    return { aborted: true, diagnostics: [{ reason: 'clearance-distance-unavailable' }] };
  }

  if (worldDistance <= toleranceFloor) {
    return { withinClearance: false, distance: worldDistance };
  }
  // Critical #2 fix #3: explicit final post-filter on the real world distance -- never trust
  // threshold-pruning alone to enforce the public (toleranceFloor, clearance] contract, since
  // maxThresholdLocal above is deliberately conservative (may admit a hit slightly beyond clearance
  // in world units when scales differ).
  if (worldDistance > clearance) {
    return { withinClearance: false, distance: worldDistance };
  }
  return {
    withinClearance: true,
    distance: worldDistance,
    witness: { sourcePoint: sourcePointWorld, targetPoint: targetPointWorld },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add collision/query/ClearanceQuery.js test/query/ClearanceQuery.test.mjs
git commit -m "feat(collision): add ClearanceQuery narrow-phase module"
```

**Completion criteria:** `clearanceQuery` correctly classifies fixtures 1-4, 7, 13, 15, 16a, 16b
(unequal-scale regression) against hand-computed expected distances; `minThreshold` is always `0`;
`maxThreshold` uses `min(sourceScale, targetScale)`; a final world-space `<= clearance` post-filter
is always applied regardless of what the pinned API's own pruning admitted.

**Protected invariants:** `volumeOverlapQuery`/`toFiniteWorldArray` are reused, not reimplemented.

**Evidence required before coding:** Step 0's confirmation of `toFiniteWorldArray`'s real export.

---

## Task 6: Extend `volumeOverlapQuery`'s return contract with an authoritative `conclusive` flag

**Files:**
- Modify: `collision/query/VolumeOverlapQuery.js` (additive only)
- Test: `test/query/VolumeOverlapQuery.conclusive.test.mjs` (new)

**Interfaces:**
- Produces: every shape `volumeOverlapQuery` returns gains a `conclusive: boolean` field. Consumed by
  Task 7 (Hard-Clash precheck), replacing a diagnostic-string allowlist with one authoritative signal.

**Why (Critical #3, post-review).** The first draft's precheck inferred "inconclusive" from a 3-string
diagnostic allowlist (`inconclusive-crossing`, `inconclusive-containment`, `crossing-budget-exhausted`)
that omitted real incompleteness/taint signals the real `VolumeOverlapQuery.js`/`ProperCrossingQuery.js`/
`ContainmentQuery.js` already produce: `non-manifold-component` (a negative result touching a flagged
non-manifold source component, even when sampling itself fully resolved) and `unverified-parity-operand`
(a container not certified closed manifold — the parity classification's own correctness precondition).
A negative result carrying either of those, while `overlap === false`, is not a *proven* no-overlap —
exactly the class of bug the tri-state precheck exists to prevent.

Read directly from source during this planning revision (`VolumeOverlapQuery.js`, `ProperCrossingQuery.js`,
`ContainmentQuery.js`, in full):

- The crossing term already carries its own authoritative incompleteness signals: `crossing.aborted`
  (budget-exhausted, `ProperCrossingQuery.js:170`) and `crossing.inconclusive` (`:167,171`) — both
  `false` only when a fully-resolved, non-aborted crossing search really found nothing. The
  aspect-ratio-skip branch (`VolumeOverlapQuery.js:97-104`) synthesizes `inconclusive: true` for the
  same reason, so checking these two booleans covers both real and synthetic crossing-skip cases.
- Each containment term (`aInB`/`bInA`, from `anyComponentInside`) returns `unresolvedComponentCount`
  (`ContainmentQuery.js`), which is `> 0` whenever ANY component's sampling was incomplete — including
  the aspect-ratio-exceeded gate, which sets it to the FULL component count (`:216`). This single
  field is confirmed to already be a complete, authoritative "this term did not fully resolve every
  component" signal — `budgetExhausted` always implies `unresolvedComponentCount > 0` too (confirmed
  by tracing the component loop: every component not yet visited when the sample budget is exhausted
  falls through to `unresolvedComponentCount++`).
- `non-manifold-component` (`:346`) and `unverified-parity-operand` (`:191`) are diagnostic-only taint
  signals NOT captured by `unresolvedComponentCount` — a component can be fully, successfully sampled
  and STILL be flagged non-manifold, or a container can be fully classified against and still not be
  certified closed. Both must be checked separately against the final merged `diagnostics` array.
- `unverified-open-component` (`:339`) is pushed ONLY on a POSITIVE containment result — it can never
  appear on a negative `volumeOverlapQuery` result (a positive containment term causes an immediate
  early return before the negative-path diagnostic merge ever runs), so it needs no special handling:
  every `overlap: true` result is `conclusive: true` unconditionally — a proven hit is proven
  regardless of which term found it or what caveats apply to its *degree*.

**`conclusive`'s exact definition:**

```
overlap === true  ->  conclusive = true                              (always; a proven hit is proven)
overlap === false ->  conclusive = !(crossing.aborted || crossing.inconclusive)
                                 && aInB.unresolvedComponentCount === 0
                                 && bInA.unresolvedComponentCount === 0
                                 && !diagnostics.some(d => d.reason === 'non-manifold-component')
                                 && !diagnostics.some(d => d.reason === 'unverified-parity-operand')
```

- [ ] **Step 1: Write the failing tests**

Create `test/query/VolumeOverlapQuery.conclusive.test.mjs`. Reuse `VolumeOverlapQuery.test.mjs`'s own
existing fixture-construction helpers for each case (do not invent new geometry where an existing
fixture already exercises the same code path — read that file first and import/mirror its exact
helpers):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { volumeOverlapQuery } from '../../collision/query/VolumeOverlapQuery.js';
// Import the SAME fixture-construction helpers VolumeOverlapQuery.test.mjs already uses for its own
// crossing/containment/inconclusive/non-manifold cases -- read that file first.

test('a proven crossing overlap is conclusive:true', async () => {
  // Reuse VolumeOverlapQuery.test.mjs's own overlapping-boxes fixture.
  const result = await volumeOverlapQuery(/* overlapping source, target */);
  assert.equal(result.overlap, true);
  assert.equal(result.conclusive, true);
});

test('a proven containment overlap is conclusive:true, even from an open/non-manifold deciding component', async () => {
  // Reuse (or construct, mirroring) a fixture whose positive result carries unverified-open-component.
  const result = await volumeOverlapQuery(/* ... */);
  assert.equal(result.overlap, true);
  assert.equal(result.conclusive, true);
});

test('a fully-resolved genuine negative is conclusive:true', async () => {
  const result = await volumeOverlapQuery(/* two well-separated, closed-manifold boxes */);
  assert.equal(result.overlap, false);
  assert.equal(result.conclusive, true);
});

test('a negative reached via crossing-budget-exhausted is conclusive:false', async () => {
  // Reuse VolumeOverlapQuery.test.mjs's / ProperCrossingQuery.test.mjs's own budget-exhaustion fixture.
  const result = await volumeOverlapQuery(/* ... */);
  assert.equal(result.overlap, false);
  assert.equal(result.conclusive, false);
});

test('a negative reached via inconclusive-containment (unresolvedComponentCount > 0) is conclusive:false', async () => {
  const result = await volumeOverlapQuery(/* ... */);
  assert.equal(result.overlap, false);
  assert.equal(result.conclusive, false);
});

test('a negative on a non-manifold component (fully sampled, but flagged) is conclusive:false', async () => {
  // Reuse VolumeOverlapQuery.test.mjs's own non-manifold-component fixture -- confirms this taint
  // signal alone (with unresolvedComponentCount === 0) still correctly drives conclusive:false.
  const result = await volumeOverlapQuery(/* ... */);
  assert.equal(result.overlap, false);
  assert.equal(result.conclusive, false);
});

test('a negative against an unverified-parity-operand (non-closed container) is conclusive:false', async () => {
  const result = await volumeOverlapQuery(/* ... */);
  assert.equal(result.overlap, false);
  assert.equal(result.conclusive, false);
});
```

- [ ] **Step 2: Run tests to verify they fail** — `conclusive` is `undefined` on every result.

- [ ] **Step 3: Implement the additive field**

In `collision/query/VolumeOverlapQuery.js`, add `conclusive: true` to all three `overlap: true` return
statements (crossing, `containment(A in B)`, `containment(B in A)`), and compute it explicitly for the
final negative return:

```js
// Immediately before the final `return { overlap: false, ... }`:
const crossingConclusive = !(crossing.aborted || crossing.inconclusive);
const containmentConclusive = aInB.unresolvedComponentCount === 0 && bInA.unresolvedComponentCount === 0;
const taintedByNonManifoldOrUnverified = diagnostics.some(
  (d) => d.reason === 'non-manifold-component' || d.reason === 'unverified-parity-operand',
);
const conclusive = crossingConclusive && containmentConclusive && !taintedByNonManifoldOrUnverified;

return {
  overlap: false,
  conclusive,
  diagnostics,
  stats: { crossing: crossing.stats, aInB, bInA },
};
```

- [ ] **Step 4: Run tests to verify they pass; run the FULL existing `VolumeOverlapQuery` suite**

`node --test test/query/VolumeOverlapQuery.conclusive.test.mjs` then
`node --test test/query/VolumeOverlapQuery.test.mjs` — the existing suite must pass unmodified (a new
additive field on the return object cannot break any existing assertion that doesn't read it), then
`npm test` (full suite) for any other consumer.

- [ ] **Step 5: Commit**

```bash
git add collision/query/VolumeOverlapQuery.js test/query/VolumeOverlapQuery.conclusive.test.mjs
git commit -m "feat(collision): add authoritative conclusive flag to volumeOverlapQuery's return contract"
```

**Completion criteria:** every `volumeOverlapQuery` result carries a `conclusive` boolean matching the
exact definition above; the full pre-existing `VolumeOverlapQuery` test suite is unmodified and green.

**Protected invariants:** `volumeOverlapQuery`'s existing return fields, control flow, and every
existing caller's observable behavior are completely unchanged — this is a pure additive field.

**Evidence required before coding:** the exhaustive diagnostic-reason list and the
`unresolvedComponentCount`/`budgetExhausted` relationship above were confirmed by reading
`VolumeOverlapQuery.js`, `ProperCrossingQuery.js`, and `ContainmentQuery.js` in full during this
revision — re-confirm against `main` at implementation time in case of drift since this plan was written.

---

## Task 7: Tri-state Hard-Clash exclusion precheck

**Files:**
- Create: `collision/query/ClearanceHardClashPrecheck.js`
- Test: `test/query/ClearanceHardClashPrecheck.test.mjs`

**Interfaces:**
- Consumes: `aabbMinDistance` (Task 3); `volumeOverlapQuery` (unchanged inputs, now returning
  `conclusive`, Task 6).
- Produces: `classifyHardClashPrecheck(sourceInstance, targetInstance, sourceWorldBounds,
  targetWorldBounds, volumeOverlapOptions)` returning `{status: 'skip-precheck'} |
  {status: 'excluded'} | {status: 'proceed'} | {status: 'inconclusive', diagnostic}`. Consumed by
  Task 9's `_runClearanceNarrowPhasePair`.

**Fix (Critical #3, post-review).** Two defects in the first draft: (a) it called
`volumeOverlapQuery(source, target)` with no options, omitting the required `scheduler`/
`compareCanonical` the real composed-mode call site always supplies (`CollisionWorld.js:1779-1783`) —
without `compareCanonical`, `ProperCrossingQuery`'s offset-ladder scale (`L_canonical`) depends on
which side the caller happened to label `source`, a genuine public-verdict bug for asymmetric pairs;
(b) it inferred "inconclusive" from an incomplete 3-string diagnostic allowlist. **Fix:** accept a
`volumeOverlapOptions` parameter (`{scheduler, compareCanonical}`), threaded through from the caller
exactly as `CollisionWorld._runNarrowPhasePair` already does for the existing composed modes; read
`overlapResult.conclusive` (Task 6) as the single authoritative signal instead of maintaining a
allowlist.

- [ ] **Step 1: Write the failing tests**

Create `test/query/ClearanceHardClashPrecheck.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHardClashPrecheck } from '../../collision/query/ClearanceHardClashPrecheck.js';
import { box, at, testInstance } from '../fixtures/geometry.mjs';

function worldBoundsOf(instance) {
  instance.geometry.computeBoundingBox();
  const box3 = instance.geometry.boundingBox.clone().applyMatrix4(instance.matrix);
  return { min: [box3.min.x, box3.min.y, box3.min.z], max: [box3.max.x, box3.max.y, box3.max.z] };
}

const noOptions = {}; // classifyHardClashPrecheck must default scheduler/compareCanonical itself when
                        // the caller omits them, exactly as volumeOverlapQuery's own defaults do, so a
                        // standalone unit test need not construct a real CollisionWorld checkpoint.

test('AABBs genuinely disjoint -> skip-precheck (volumeOverlapQuery never called)', async () => {
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(20, 0, 0));
  const result = await classifyHardClashPrecheck(source, target, worldBoundsOf(source), worldBoundsOf(target), noOptions);
  assert.equal(result.status, 'skip-precheck');
});

// Fixture 5: positive-volume overlap -> proven overlap -> excluded.
test('fixture 5: overlapping boxes -> excluded', async () => {
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(1, 0, 0));
  const result = await classifyHardClashPrecheck(source, target, worldBoundsOf(source), worldBoundsOf(target), noOptions);
  assert.equal(result.status, 'excluded');
});

// Fixture 6: containment -> proven overlap -> excluded, even though surfaces are far apart.
test('fixture 6: containment -> excluded', async () => {
  const source = testInstance(box(10, 10, 10), at(0, 0, 0));
  const target = testInstance(box(1, 1, 1), at(3, 3, 3));
  const result = await classifyHardClashPrecheck(source, target, worldBoundsOf(source), worldBoundsOf(target), noOptions);
  assert.equal(result.status, 'excluded');
});

test('AABBs touch, volumeOverlapQuery proves conclusive no-overlap -> proceed', async () => {
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(2, 0, 0));
  const result = await classifyHardClashPrecheck(source, target, worldBoundsOf(source), worldBoundsOf(target), noOptions);
  assert.equal(result.status, 'proceed');
});

// Fixture 14: inconclusive precheck must never be treated as proven-no-overlap.
test('fixture 14: conclusive:false volumeOverlapQuery result -> inconclusive, never proceed', async () => {
  // Reuse the SAME fixture Task 6's own "conclusive:false" tests already established (crossing-budget
  // exhaustion or inconclusive-containment) -- import/mirror it rather than inventing a new one.
  const { source, target } = /* reuse Task 6's fixture-14-equivalent construction */ ({});
  const result = await classifyHardClashPrecheck(source, target, worldBoundsOf(source), worldBoundsOf(target), noOptions);
  assert.equal(result.status, 'inconclusive');
  assert.equal(result.diagnostic.reason, 'clearance-hard-clash-precheck-inconclusive');
});

test('threads a caller-supplied scheduler/compareCanonical into volumeOverlapQuery', async () => {
  let sawScheduler = false;
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(2, 0, 0));
  const scheduler = { elapsedMs: () => 0, checkpointIfDue: async () => { sawScheduler = true; } };
  await classifyHardClashPrecheck(source, target, worldBoundsOf(source), worldBoundsOf(target), {
    scheduler, compareCanonical: () => -1,
  });
  // At least one between-term checkpoint must have run through the supplied scheduler, proving it was
  // actually passed to volumeOverlapQuery rather than a fresh default being constructed internally.
  assert.equal(sawScheduler, true);
});
```

- [ ] **Step 2: Run tests to verify they fail** — module does not exist.

- [ ] **Step 3: Implement `ClearanceHardClashPrecheck.js`**

Create `collision/query/ClearanceHardClashPrecheck.js`:

```js
import { aabbMinDistance } from '../geometry/AabbDistance.js';
import { volumeOverlapQuery } from './VolumeOverlapQuery.js';

/**
 * Tri-state Hard-Clash exclusion precheck for a clearance candidate pair. Never collapses to boolean:
 * an inconclusive volumeOverlapQuery result must never be treated as "proven no overlap".
 *
 * @param {object} volumeOverlapOptions - {scheduler, compareCanonical}, threaded through to
 *   volumeOverlapQuery unchanged. Omit/pass {} to use volumeOverlapQuery's own defaults (standalone
 *   unit-test convenience only -- CollisionWorld always supplies the real call-scoped values).
 * @returns {
 *   {status: 'skip-precheck'} | {status: 'excluded'} | {status: 'proceed'} |
 *   {status: 'inconclusive', diagnostic: object}
 * }
 */
export async function classifyHardClashPrecheck(
  sourceInstance, targetInstance, sourceWorldBounds, targetWorldBounds, volumeOverlapOptions = {},
) {
  if (aabbMinDistance(sourceWorldBounds, targetWorldBounds) > 0) {
    return { status: 'skip-precheck' };
  }

  const overlapResult = await volumeOverlapQuery(sourceInstance, targetInstance, volumeOverlapOptions);

  if (overlapResult.overlap === true) {
    return { status: 'excluded' };
  }
  // overlapResult.overlap === false here. `conclusive` (Task 6) is the single authoritative signal --
  // never re-derive it from a diagnostic-reason allowlist.
  if (!overlapResult.conclusive) {
    return { status: 'inconclusive', diagnostic: { reason: 'clearance-hard-clash-precheck-inconclusive' } };
  }
  return { status: 'proceed' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add collision/query/ClearanceHardClashPrecheck.js test/query/ClearanceHardClashPrecheck.test.mjs
git commit -m "feat(collision): add tri-state Hard-Clash exclusion precheck for M3 clearance"
```

**Completion criteria:** genuinely disjoint AABBs skip the precheck; proven overlap excludes; conclusive
no-overlap proceeds; any `conclusive:false` evaluation is classified `inconclusive`, never `proceed`;
a caller-supplied `{scheduler, compareCanonical}` is actually threaded through to `volumeOverlapQuery`.

**Protected invariants:** `volumeOverlapQuery`'s own inputs/options contract (Task 6) is called
correctly, never modified by this task.

**Evidence required before coding:** none beyond Task 6's already-confirmed `conclusive` contract.

---

## Task 8: Extraction-time transform/bounds admission validation

**Files:**
- Modify: `collision/CollisionWorld.js`
- Test: `test/CollisionWorld.clearanceAdmissionValidation.test.mjs` (new)

**Interfaces:**
- Produces: a clearance-only preprocessing pass, applied to `sourceExtracted` and every
  `targetRecordsByEpoch` bucket immediately after extraction and BEFORE `_recordRepresentativeFragments`/
  `_recordPlacement`/`admitCollisionInstances` run — strips invalid entries out of those Maps in place
  and emits one fragment-scoped `'clearance-invalid-transform'` diagnostic per offending instance.
  Consumed implicitly by Task 9/10: because invalid instances are removed before `makePlaced` ever
  builds `sourceInstances`/`targetGroups`, neither broad-phase method needs any redundant
  per-candidate validity re-check.

**Fix (Critical #4, post-review).** The first draft validated inside the broad-phase loops (per
candidate, or inside a TLAS `onCandidate` callback) — too late: a NaN-bounds target might never
surface as a TLAS candidate at all (its own corrupted bounds could simply fail to intersect anything,
or produce nonsensical query results), so validation would silently never run — exactly the
silent-incompleteness failure the spec's own validation-timing requirement exists to prevent. It also
used a pair-scoped diagnostic shape (`{scope:'pair', source, target}`), which is wrong: an invalid
transform is a property of ONE instance, discovered before any pair exists, so the correct shape is
fragment-scoped, mirroring `diagnoseFragmentOnce`'s existing pattern for `geometry-not-yet-available`
exactly (dedup key `` `${epoch}:${fragmentId}` ``, not per bare fragmentId).

**Why filtering the extraction Maps is sufficient (no separate "historical TLAS epoch" handling
needed):** `_runTlasBroadPhase` (and the clearance TLAS equivalent, Task 10) already builds a
`currentByFragmentId` map fresh, every call, from ONLY that call's own current `targetInstances`
bucket, and discards any TLAS candidate whose `fragmentId` is not in that map (the pre-existing M2
"stale historical fragment" guard). Removing an invalid record from `targetRecordsByEpoch`'s bucket
BEFORE `makePlaced` ever builds `targetInstances` from it means that record can never enter
`currentByFragmentId` either — so it can never survive as a clearance candidate, regardless of what
(possibly still-corrupted) historical data sits in the epoch-wide TLAS/`_placementByEpoch` from an
earlier, unrelated call. No new state, no epoch-wide cleanup, no separate TLAS-specific handling.

- [ ] **Step 1: Write the failing tests**

Create `test/CollisionWorld.clearanceAdmissionValidation.test.mjs` (this file's assertions depend on
Task 9's dispatch wiring too — mark them `{ todo: true }` and un-skip once Task 9 lands):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../collision/CollisionWorld.js';

// Fixture 17: non-finite/invalid transform -> clearance-invalid-transform diagnostic, pair excluded,
// never silently dropped with zero diagnostics.
test('fixture 17: non-finite worldMatrix on a target instance -> clearance-invalid-transform diagnostic, no crash', { todo: true }, async () => {
  const world = new CollisionWorld();
  const sourceModel = /* well-formed single-fragment stub model */ null;
  const targetModel = /* single fragment with a NaN in its placement matrix -- construct via the same
    stub-model helper other CollisionWorld tests use, injecting a corrupted worldMatrix */ null;
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

test('singular (non-invertible) worldMatrix -> clearance-invalid-transform diagnostic', { todo: true }, async () => {
  const world = new CollisionWorld();
  const sourceModel = /* ... */ null;
  const targetModel = /* single fragment with a zero-determinant placement matrix */ null;
  await world.admitModel(sourceModel);
  await world.admitModel(targetModel);
  const { statistics } = await world.findClashes({
    source: { model: sourceModel, dbIds: [1] },
    target: { targets: [{ model: targetModel }] },
    mode: 'clearance', clearance: 5, groupBy: 'dbId',
  });
  assert.ok(statistics.diagnostics.some((d) => d.reason === 'clearance-invalid-transform'));
});

test('an invalid instance is never admitted into shared placement state for a clearance call', { todo: true }, async () => {
  // Regression guard for the fix's own rationale: a subsequent, unrelated call against the same
  // models must not observe any lingering effect from the earlier invalid record (e.g. a corrupted
  // TLAS entry) -- run a second, valid clearance query against the same models afterward and assert
  // it behaves exactly as if the invalid fragment had never existed.
});
```

- [ ] **Step 2: Run tests to verify they fail (or are correctly `todo`)**

- [ ] **Step 3: Implement the validation + filtering pass**

In `collision/CollisionWorld.js`, near `makePlaced`:

```js
// M3 clearance-only admission validation: a finite, invertible worldMatrix and finite,
// correctly-ordered worldBounds. Operates on the RAW extraction-record shape (worldMatrix is a plain
// 16-number array, per extraction's own contract -- makePlaced reads the identical fields), never on
// a PlacedInstance -- this runs BEFORE admission, so no PlacedInstance exists yet. Scoped to the
// clearance path only (Global Constraints) -- never called from the other three modes' extraction path.
function isValidClearanceTransform(extractedRecord) {
  const m = extractedRecord.worldMatrix;
  if (!Array.isArray(m) || m.length !== 16 || m.some((v) => !Number.isFinite(v))) return false;
  const det = new THREE.Matrix4().fromArray(m).determinant();
  if (!Number.isFinite(det) || det === 0) return false;
  const b = extractedRecord.worldBounds;
  if (!b) return false;
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(b.min[i]) || !Number.isFinite(b.max[i]) || b.min[i] > b.max[i]) return false;
  }
  return true;
}

// Fragment-scoped, deduped per (epoch, fragmentId) -- mirrors diagnoseFragmentOnce's existing pattern
// exactly (a separate Set here, `clearanceInvalidTransformDiagnosed`, scoped per findClashes call,
// never shared with `oversizedDiagnosedFragments` -- these are two independent dedup namespaces for
// two independent diagnostic reasons, and conflating them would let one reason's dedup entry
// incorrectly suppress the other for the same fragment).
function diagnoseClearanceInvalidTransform(statistics, diagnosedSet, model, epoch, extractedRecord, role) {
  const key = `${epoch}:${extractedRecord.fragmentId}`;
  if (diagnosedSet.has(key)) return;
  diagnosedSet.add(key);
  statistics.diagnostics.push({
    scope: 'fragment',
    reason: 'clearance-invalid-transform',
    role,
    fragment: { modelId: modelIdOf(model), dbId: extractedRecord.ownerDbId, fragId: extractedRecord.fragmentId },
  });
}
```

In `findClashes`'s body, immediately after `sourceExtracted`/`targetRecordsByEpoch` are fully built by
extraction and BEFORE the capacity preflight / `_recordRepresentativeFragments` / `_recordPlacement` /
`admitCollisionInstances` sequence runs:

```js
if (query.mode === 'clearance') {
  const clearanceInvalidTransformDiagnosed = new Set();
  for (const [fragmentId, extractedRecord] of sourceExtracted) {
    if (!isValidClearanceTransform(extractedRecord)) {
      sourceExtracted.delete(fragmentId);
      diagnoseClearanceInvalidTransform(
        statistics, clearanceInvalidTransformDiagnosed, sourceLease.model, sourceEpoch, extractedRecord, 'source',
      );
    }
  }
  for (const [epoch, bucket] of targetRecordsByEpoch) {
    for (const [fragmentId, extractedRecord] of bucket) {
      if (!isValidClearanceTransform(extractedRecord)) {
        bucket.delete(fragmentId);
        diagnoseClearanceInvalidTransform(
          statistics, clearanceInvalidTransformDiagnosed, leaseByEpoch.get(epoch).model, epoch, extractedRecord, 'target',
        );
      }
    }
  }
}
```

> **Verification note:** confirm the exact local variable names (`sourceExtracted`,
> `targetRecordsByEpoch`, `sourceEpoch`, `sourceLease`, `leaseByEpoch`) against `findClashes`'s real
> body at the exact point immediately before the capacity-preflight/`_recordPlacement` sequence
> (`CollisionWorld.js`, the block ending around line 1400) before inserting this branch — this plan's
> research pass confirmed the sequence and the Maps' general shape but did not re-quote every local
> variable's exact name at that specific point; adjust names to match exactly, the logic above is
> otherwise complete and correct.

- [ ] **Step 4: Un-skip and run the Task-8 tests once Task 9's dispatch wiring lands**

- [ ] **Step 5: Commit**

```bash
git add collision/CollisionWorld.js test/CollisionWorld.clearanceAdmissionValidation.test.mjs
git commit -m "feat(collision): validate and filter invalid clearance instance transforms at extraction time"
```

**Completion criteria:** a non-finite/singular worldMatrix or non-finite/misordered worldBounds, on any
instance offered to a `mode:'clearance'` call, produces a fragment-scoped `'clearance-invalid-transform'`
diagnostic and is removed from candidate consideration BEFORE admission/placement recording — never a
silent zero-candidate result with no diagnostic, and never a corrupted record entering shared state.

**Protected invariants:** `surface-intersection`/`containment`/`volume-overlap` extraction/admission
behavior is completely untouched — this filtering branch runs only when `query.mode === 'clearance'`.

**Evidence required before coding:** exact local variable names at the real insertion point must be
confirmed against `CollisionWorld.js` immediately before implementation (flagged above, not guessed).

---

## Task 9: Clearance linear broad phase + end-to-end wiring

**Files:**
- Modify: `collision/CollisionWorld.js` — extract `resolveGeometryRecord`/`diagnoseFragmentOnce` as
  shared top-level helpers (refactor `_runNarrowPhasePair` to call them, behavior-proven-identical);
  `supportedModes`; `clearance` param validation; `_runClearanceBroadPhaseScan`;
  `_runClearanceNarrowPhasePair`; `compareClearanceCandidates`; clearance dispatch/aggregation in
  `findClashes`'s body.
- Test: `test/CollisionWorld.findClashes.clearance.test.mjs` (new)

**Interfaces:**
- Consumes: `aabbMinDistance` (3), `computeToleranceFloor`/`validateUniformScale` (4), `clearanceQuery`
  (5), `classifyHardClashPrecheck` (7), Task 8's extraction-time filtering.
- Produces: a fully working `mode:'clearance', broadPhase:'linear'` end-to-end path.

**Fix (Critical #1, post-review).** The first draft's clearance narrow-phase called
`toInstance(sourcePlaced.instance, ...)` directly — `sourcePlaced.instance` (`makePlaced`,
`CollisionWorld.js:46-53`) is the canonical epoch-cached `CollisionInstance`: identity +
`geometryIdentity` only, no `geometry`/`bvh`/`localDiagonal`. The ONLY valid way to resolve those is
`await this._registry.getOrBuildGeometry(...)`, exactly as `_runNarrowPhasePair`'s private `buildOne`
closure (`CollisionWorld.js:1649-1701`) already does. **Fix:** extract `buildOne` and its
`diagnoseFragmentOnce` helper into shared top-level functions, reused by both the refactored
`_runNarrowPhasePair` (proven behavior-identical via the full regression suite) and clearance's own
narrow-phase resolution.

**Fix (also folds in the real, confirmed `compareWitnessCandidates`/key-format facts).** Read directly
from `CollisionWorld.js` during this revision:
- `compareWitnessCandidates(a, b)` (`:151-160`) is a real total order: null-witness-vs-real, then
  witness `kind`, then `comparePlacedCanonically(a.sourcePlaced, b.sourcePlaced) ||
  comparePlacedCanonically(a.targetPlaced, b.targetPlaced)`. Clearance's `compareClearanceCandidates`
  mirrors its EXACT structure, minus the witness-kind rank (clearance has one witness kind): rank by
  distance first, then the same `comparePlacedCanonically` tie-break.
- The real dbId-aggregation key (`:1483`) is
  `` `${sourceOperand.epoch}:${sourcePlaced.ownerDbId}:${targetOperand.epoch}:${targetPlaced.ownerDbId}` ``
  — epoch-qualified, never modelId-qualified (the first draft used modelId, violating this plan's own
  stated Global Constraint).

- [ ] **Step 1: Extract `resolveGeometryRecord`/`diagnoseFragmentOnce` as shared top-level helpers**

In `collision/CollisionWorld.js`, near `toInstance` (before `_runNarrowPhasePair`):

```js
// Extracted from _runNarrowPhasePair's own private buildOne/diagnoseFragmentOnce closures (M3 Task 9)
// so clearance's narrow phase can resolve geometry through the IDENTICAL path the three existing
// modes already use, rather than a second, divergent one. Pure refactor: _runNarrowPhasePair below is
// rewritten to call these same functions, with the full existing regression suite proving zero
// observable behavior change for surface-intersection/containment/volume-overlap.
function diagnoseFragmentOnce(statistics, oversizedDiagnosedFragments, placed, role, reason, operand) {
  const key = `${operand.epoch}:${placed.instance.fragmentId}`;
  if (oversizedDiagnosedFragments.has(key)) return;
  oversizedDiagnosedFragments.add(key);
  statistics.diagnostics.push({ scope: 'fragment', reason, role, fragment: fragmentRef(operand.model, placed) });
}

async function resolveGeometryRecord(registry, placed, role, operand, needsConnectivity, statistics, oversizedDiagnosedFragments) {
  const identity = placed.instance.geometryIdentity;
  let record;
  try {
    record = await registry.getOrBuildGeometry({
      loadEpoch: identity.loadEpoch,
      geometryIndex: identity.geometryIndex,
      ownerModelIdHint: modelIdOf(operand.model),
      needsConnectivity,
    });
  } catch (err) {
    if (!(err instanceof RenderProxyUnavailableError)) throw err;
    diagnoseFragmentOnce(statistics, oversizedDiagnosedFragments, placed, role, 'geometry-not-yet-available', operand);
    return null;
  }
  if (record.oversized) {
    diagnoseFragmentOnce(statistics, oversizedDiagnosedFragments, placed, role, record.reason, operand);
    return null;
  }
  return record;
}
```

Then rewrite `_runNarrowPhasePair`'s own `buildOne`/`diagnoseFragmentOnce` closures to delegate:

```js
// Inside _runNarrowPhasePair, replacing its private closures:
const buildOne = (placed, role, operand) =>
  resolveGeometryRecord(this._registry, placed, role, operand, needsConnectivity, statistics, oversizedDiagnosedFragments);
```

Remove the old inline `diagnoseFragmentOnce` closure entirely (now the shared top-level one).

- [ ] **Step 2: Run the FULL existing suite to prove the refactor is behavior-identical**

`npm test` — every existing test touching `_runNarrowPhasePair`'s geometry-resolution/diagnostic
behavior (`geometry-not-yet-available`, oversized-geometry dedup, etc.) must be unchanged and green
before proceeding. This is a required checkpoint, not optional — Step 1 is a pure refactor and must be
proven so before any new clearance code is layered on top of it.

- [ ] **Step 3: Commit the refactor separately**

```bash
git add collision/CollisionWorld.js
git commit -m "refactor(collision): extract shared resolveGeometryRecord/diagnoseFragmentOnce helpers"
```

- [ ] **Step 4: Write the failing API-validation tests**

Create `test/CollisionWorld.findClashes.clearance.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../collision/CollisionWorld.js';

test('mode:"clearance" without a clearance param is rejected', async () => {
  const world = new CollisionWorld();
  const model = /* trivial single-fragment stub model */ null;
  await world.admitModel(model);
  await assert.rejects(
    () => world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [1] }, mode: 'clearance', groupBy: 'dbId' }),
    /clearance/i,
  );
});

for (const bad of [0, -1, NaN, Infinity, 'not-a-number', null]) {
  test(`mode:"clearance" with clearance=${bad} is rejected`, async () => {
    const world = new CollisionWorld();
    const model = /* ... */ null;
    await world.admitModel(model);
    await assert.rejects(() => world.findClashes({
      source: { model, dbIds: [1] }, target: { model, dbIds: [1] }, mode: 'clearance', clearance: bad, groupBy: 'dbId',
    }));
  });
}

test('clearance param on a non-clearance mode is rejected', async () => {
  const world = new CollisionWorld();
  const model = /* ... */ null;
  await world.admitModel(model);
  await assert.rejects(() => world.findClashes({
    source: { model, dbIds: [1] }, target: { model, dbIds: [1] }, mode: 'volume-overlap', clearance: 1, groupBy: 'dbId',
  }));
});

test('existing three modes are unaffected by the new mode/clearance validation', async () => {
  const world = new CollisionWorld();
  const model = /* ... */ null;
  await world.admitModel(model);
  await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [1] }, mode: 'volume-overlap', groupBy: 'dbId' });
});
```

- [ ] **Step 5: Run tests, then extend `supportedModes` and add `clearance` validation**

In `collision/CollisionWorld.js:23`: `const supportedModes = [..., 'clearance'];`

In the validation block, immediately after the existing mode-membership check:

```js
if (query.mode === 'clearance') {
  if (typeof query.clearance !== 'number' || !Number.isFinite(query.clearance) || query.clearance <= 0) {
    throw new Error("findClashes: mode 'clearance' requires a finite, positive 'clearance' number");
  }
} else if ('clearance' in query && query.clearance !== undefined) {
  throw new Error(`findClashes: 'clearance' is only valid when mode is 'clearance', got mode '${query.mode}'`);
}
```

- [ ] **Step 6: Write the failing end-to-end linear-path tests**

Append to `test/CollisionWorld.findClashes.clearance.test.mjs` (mirror
`test/CollisionWorld.findClashes.test.mjs`'s own stub-model construction pattern):

```js
// Fixture 9: self-exclusion.
test('source instance never appears as its own clearance target', async () => {
  const world = new CollisionWorld();
  const model = /* single fragment */ null;
  await world.admitModel(model);
  const { pairs } = await world.findClashes({
    source: { model, dbIds: [1] }, target: { targets: [{ model }] },
    mode: 'clearance', clearance: 100, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(pairs.length, 0);
});

// Fixture 3 (integration level): a real near-miss pair is reported with correct distance/witness.
test('a real near-miss same-model pair is reported under broadPhase:linear', async () => {
  const world = new CollisionWorld();
  const model = /* two fragments, boxes at (0,0,0) and (2.5,0,0), 2x2x2 each, dbIds 1 and 2 */ null;
  await world.admitModel(model);
  const { pairs, statistics } = await world.findClashes({
    source: { model, dbIds: [1] }, target: { model, dbIds: [2] },
    mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].type, 'clearance');
  assert.ok(Math.abs(pairs[0].distance - 0.5) < 1e-3);
  assert.equal(pairs[0].clearance, 1);
  assert.ok(pairs[0].witness.sourcePoint && pairs[0].witness.targetPoint);
  assert.equal(statistics.clearanceHits, pairs.length);
  assert.equal(statistics.clearanceExpandedCandidatePairs, 0); // linear path never populates this
});

// Fixture 10: multi-fragment dbId, minimum wins, order-independent.
test('fixture 10: multiple fragment pairs for one dbId -> minimum-distance fragment pair wins', async () => {
  const world = new CollisionWorld();
  const model = /* source dbId 1 has fragments A,B; target dbId 2's fragment gap: A~0.8, B~0.3 */ null;
  await world.admitModel(model);
  const { pairs } = await world.findClashes({
    source: { model, dbIds: [1] }, target: { model, dbIds: [2] },
    mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(pairs.length, 1);
  assert.ok(Math.abs(pairs[0].distance - 0.3) < 1e-3, 'must pick the closer fragment pair (B), not A');
});

// Fixture 5/6 (integration level): Hard Clash exclusion.
test('fixture 5/6: a dbId pair with a Hard-Clash fragment pair is excluded from clearance results', async () => {
  const world = new CollisionWorld();
  const model = /* source dbId 1 overlaps target dbId 2 */ null;
  await world.admitModel(model);
  const { pairs, statistics } = await world.findClashes({
    source: { model, dbIds: [1] }, target: { model, dbIds: [2] },
    mode: 'clearance', clearance: 5, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(pairs.length, 0);
  assert.ok(statistics.clearanceHardClashExclusions >= 1);
});

// Fixture 8: cross-model federated clearance.
test('fixture 8: cross-model near-miss pair reported with correct provenance', async () => {
  const world = new CollisionWorld();
  const sourceModel = /* dbId 1, box at (0,0,0) */ null;
  const targetModel = /* dbId 1, box at (2.5,0,0) */ null;
  await world.admitModel(sourceModel);
  await world.admitModel(targetModel);
  const { pairs } = await world.findClashes({
    source: { model: sourceModel, dbIds: [1] }, target: { targets: [{ model: targetModel }] },
    mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].source.model, sourceModel);
  assert.equal(pairs[0].target.model, targetModel);
});
```

- [ ] **Step 7: Implement `_runClearanceBroadPhaseScan`**

Near `_runBroadPhaseScan`. Structurally identical, minus any redundant validity check (Task 8 already
filtered invalid instances out of `sourceInstances`/`targetGroups` before either method ever runs):

```js
async _runClearanceBroadPhaseScan(sourceOperand, sourceInstances, targetGroups, clearance, statistics, checkpoint) {
  const candidates = [];
  for (const group of targetGroups) {
    const { targetOperand, instances: targetInstances } = group;
    for (let i = 0; i < sourceInstances.length; i++) {
      for (let j = 0; j < targetInstances.length; j++) {
        const pending = checkpoint({ label: 'clearance-broad-phase-scan' });
        if (pending) await pending;
        const targetPlaced = targetInstances[j];
        if (isSourceOwnFragment(sourceOperand, targetOperand.epoch, targetPlaced.instance.fragmentId)) continue;
        const sourcePlaced = sourceInstances[i];
        if (aabbMinDistance(sourcePlaced.worldBounds, targetPlaced.worldBounds) <= clearance) {
          statistics.clearanceExactAabbSurvivors++;
          candidates.push([sourcePlaced, targetPlaced, targetOperand]);
        }
      }
    }
  }
  return candidates;
}
```

- [ ] **Step 8: Implement `_runClearanceNarrowPhasePair` and `compareClearanceCandidates`**

```js
async _runClearanceNarrowPhasePair(
  sourcePlaced, targetPlaced, sourceOperand, targetOperand, clearance, statistics, oversizedDiagnosedFragments, checkpoint,
) {
  const sourceRecord = await resolveGeometryRecord(this._registry, sourcePlaced, 'source', sourceOperand, true, statistics, oversizedDiagnosedFragments);
  if (!sourceRecord) return { outcome: 'geometry-unavailable' };
  const targetRecord = await resolveGeometryRecord(this._registry, targetPlaced, 'target', targetOperand, true, statistics, oversizedDiagnosedFragments);
  if (!targetRecord) return { outcome: 'geometry-unavailable' };

  const sourceInstance = toInstance(sourceRecord, sourcePlaced.worldMatrix);
  const targetInstance = toInstance(targetRecord, targetPlaced.worldMatrix);

  const sourceScale = validateUniformScale(sourceInstance.matrix);
  const targetScale = validateUniformScale(targetInstance.matrix);
  if (!sourceScale.valid || !targetScale.valid) {
    // Task 8 already excluded non-finite/singular transforms upstream; this is validateUniformScale's
    // OWN, finer-grained gate (anisotropic scale) -- a well-formed-but-unsupported transform, caught
    // here right before the composed query, not at admission time.
    return { outcome: 'anisotropic-scale', diagnostic: 'clearance-anisotropic-scale-unsupported' };
  }

  const scheduler = createComposedStageScheduler(checkpoint, this._now);
  const canonicalOrder = comparePlacedCanonically(sourcePlaced, targetPlaced);
  const volumeOverlapOptions = {
    scheduler,
    compareCanonical: (a, b) => (a === b ? 0 : a === sourceInstance ? canonicalOrder : -canonicalOrder),
  };

  const precheck = await classifyHardClashPrecheck(
    sourceInstance, targetInstance, sourcePlaced.worldBounds, targetPlaced.worldBounds, volumeOverlapOptions,
  );
  // Important #1 fix: clearanceOverlapPrechecksRun increments for EVERY status volumeOverlapQuery
  // actually ran under (excluded, proceed, inconclusive) -- never for skip-precheck, which by
  // definition never called it. The increment happens BEFORE the excluded early-return below.
  if (precheck.status !== 'skip-precheck') statistics.clearanceOverlapPrechecksRun++;
  if (precheck.status === 'excluded') {
    return { outcome: 'hard-clash-excluded' };
  }
  if (precheck.status === 'inconclusive') {
    statistics.diagnostics.push({
      scope: 'pair', reason: precheck.diagnostic.reason,
      sourceFragment: fragmentRef(sourceOperand.model, sourcePlaced),
      targetFragment: fragmentRef(targetOperand.model, targetPlaced),
    });
    return { outcome: 'inconclusive' };
  }
  // precheck.status is 'proceed' or 'skip-precheck' -- continue to the distance query.

  const toleranceFloor = computeToleranceFloor(
    { localDiagonal: sourceInstance.localDiagonal, scaleFactor: sourceScale.scaleFactor },
    { localDiagonal: targetInstance.localDiagonal, scaleFactor: targetScale.scaleFactor },
    surfaceEpsilonFactor,
  );
  const distanceQueryStart = this._now();
  const result = clearanceQuery(sourceInstance, targetInstance, { clearance, toleranceFloor });
  statistics.clearanceDistanceQueriesRun++;
  const distanceQueryMs = this._now() - distanceQueryStart;
  statistics.clearanceQueryMs += distanceQueryMs;
  reportSpan('clearance-distance-query', distanceQueryMs); // production instrumentation, consumed by Task 18's gate

  if (result.aborted) {
    statistics.diagnostics.push({
      scope: 'pair', reason: result.diagnostics[0].reason,
      sourceFragment: fragmentRef(sourceOperand.model, sourcePlaced),
      targetFragment: fragmentRef(targetOperand.model, targetPlaced),
    });
    return { outcome: 'aborted' };
  }
  if (!result.withinClearance) return { outcome: 'beyond-threshold' };
  return { outcome: 'hit', distance: result.distance, witness: result.witness, sourcePlaced, targetPlaced };
}

// Mirrors compareWitnessCandidates's exact structure (CollisionWorld.js:151-160), minus the
// witness-kind rank (clearance has one witness kind): distance first, then the same
// comparePlacedCanonically tie-break, applied source-then-target.
function compareClearanceCandidates(a, b) {
  if (a.distance !== b.distance) return a.distance < b.distance ? -1 : 1;
  return comparePlacedCanonically(a.sourcePlaced, b.sourcePlaced) || comparePlacedCanonically(a.targetPlaced, b.targetPlaced);
}
```

- [ ] **Step 9: Wire dispatch, aggregation, and Hard-Clash exclusion into `findClashes`'s body**

When `query.mode === 'clearance'`, after Task 8's filtering and the normal admission/`makePlaced`
sequence has produced `sourceInstances`/`targetGroups` (identical to the existing modes' own setup —
clearance shares this, it is not re-derived), branch the broad-phase call
(`_runClearanceBroadPhaseScan`, TLAS variant added in Task 10) and run a clearance-specific
aggregation loop, structurally parallel to the existing `pairsByKey`/`witnessCandidateByKey` loop but
tracking a Hard-Clash-exclusion Set (since exclusion proof can arrive on a LATER fragment pair than an
already-recorded distance candidate for the same dbId key — order independence, fixtures 10/14):

```js
if (query.mode === 'clearance') {
  const clearanceCandidateByKey = new Map(); // key -> {distance, witness, sourcePlaced, targetPlaced}
  const hardClashExcludedKeys = new Set();
  const oversizedDiagnosedFragments = new Set(); // reused across this call's own resolveGeometryRecord calls

  for (const [sourcePlaced, targetPlaced, targetOperand] of candidates) {
    const pending = checkpoint({ label: 'clearance-narrow-phase-pair' });
    if (pending) await pending;
    const outcome = await this._runClearanceNarrowPhasePair(
      sourcePlaced, targetPlaced, sourceOperand, targetOperand, query.clearance, statistics,
      oversizedDiagnosedFragments, checkpoint,
    );
    const key = `${sourceOperand.epoch}:${sourcePlaced.ownerDbId}:${targetOperand.epoch}:${targetPlaced.ownerDbId}`;
    if (outcome.outcome === 'hard-clash-excluded') {
      hardClashExcludedKeys.add(key);
      continue;
    }
    if (outcome.outcome !== 'hit') continue;
    const existing = clearanceCandidateByKey.get(key);
    if (!existing || compareClearanceCandidates(outcome, existing) < 0) {
      clearanceCandidateByKey.set(key, outcome);
    }
  }

  const pairs = [];
  for (const [key, winner] of clearanceCandidateByKey) {
    if (hardClashExcludedKeys.has(key)) {
      statistics.clearanceHardClashExclusions++;
      continue; // a later-processed fragment pair proved Hard Clash for this same dbId pair
    }
    pairs.push({
      source: { modelId: modelIdOf(sourceOperand.model), dbId: winner.sourcePlaced.ownerDbId, model: sourceOperand.model },
      target: { modelId: modelIdOf(winner.targetPlaced ? targetOperandOf(winner) : null), dbId: winner.targetPlaced.ownerDbId, model: /* the winning candidate's own targetOperand.model */ null },
      type: 'clearance',
      distance: winner.distance,
      clearance: query.clearance,
      witness: winner.witness,
    });
  }
  statistics.clearanceHits = pairs.length;
  checkpoint.assertCurrent();
  return { pairs, statistics };
}
```

> **Verification/reconciliation note:** the `target` operand's `model`/`modelId` must come from the
> SAME `targetOperand` that produced the winning candidate, not a placeholder — thread `targetOperand`
> through into the stored candidate object (`clearanceCandidateByKey`'s value) alongside `distance`/
> `witness`/`sourcePlaced`/`targetPlaced` so it is available when the final `pairs` array is built,
> exactly as the existing `pairsByKey`/`witnessCandidateByKey` loop already threads `targetOperand`
> through its own tuple. Fix the pseudocode's placeholder `targetOperandOf(winner)`/`null` above to
> store and read `winner.targetOperand` directly (a one-line addition to `_runClearanceNarrowPhasePair`'s
> `'hit'` return value: `{ outcome: 'hit', distance, witness, sourcePlaced, targetPlaced, targetOperand }`).

- [ ] **Step 10: Run all tests to verify they pass**

`node --test test/CollisionWorld.findClashes.clearance.test.mjs`, then un-skip and run Task 8's
`todo`-marked tests, then `npm test` (full suite) to confirm zero regressions to the existing three modes.

- [ ] **Step 11: Commit**

```bash
git add collision/CollisionWorld.js test/CollisionWorld.findClashes.clearance.test.mjs test/CollisionWorld.clearanceAdmissionValidation.test.mjs
git commit -m "feat(collision): wire mode:'clearance' end-to-end under broadPhase:'linear'"
```

**Completion criteria:** `mode:'clearance', broadPhase:'linear'` is fully functional: geometry
resolution via the shared `resolveGeometryRecord` path, validation, tri-state precheck (with real
`{scheduler, compareCanonical}` wiring), distance query, deterministic epoch-qualified aggregation, and
Hard-Clash exclusion applied order-independently — all against fixtures 3, 5, 6, 8, 9, 10.

**Protected invariants:** `supportedModes`'s original three entries and their exact validation/dispatch
order are unchanged; the full regression suite proves Step 1's refactor is behavior-identical.

**Evidence required before coding:** Step 1's refactor must be proven behavior-identical (Step 2) before
any clearance code is layered on top of it; the target-operand-threading note in Step 9 must be
resolved before this task is complete.

---

## Task 10: Clearance TLAS broad phase

**Files:**
- Modify: `collision/CollisionWorld.js` — `_runClearanceTlasBroadPhase`, `broadPhase` default
  selection for `mode:'clearance'`
- Test: extend `test/CollisionWorld.findClashes.clearance.test.mjs`

**Interfaces:**
- Consumes: `CollisionInstanceBVH.queryBox(min, max, {onLeafRange, onCandidate})`,
  `TlasCache`/`_getTlasEntryForEpoch` (unchanged, reused verbatim); `aabbMinDistance` (3); Task 9's
  `_runClearanceNarrowPhasePair`/`compareClearanceCandidates`.

**Fix (Critical #5, post-review).** The first draft conflated `clearanceExpandedCandidatePairs` (which
per spec only increments post-exact-filter, in `onCandidate`) with the raw leaf-expansion `count` used
for the budget check — a query could perform far more than `maxTlasCandidatePairs` raw primitive
expansions without ever throwing. The real `_runTlasBroadPhase` (`CollisionWorld.js:2133-2214`, quoted
below) uses a SEPARATE local `candidateBudgetUsed` accumulator, incremented by raw `count` inside
`onLeafRange`, entirely independent of any `statistics.*` field, with a `pendingCapacityError`/`'stop'`/
deferred-throw-after-traversal discipline. **Fix:** copy this exact real pattern verbatim. This task
also adds `targetScopeFilter` threading, which the first draft omitted entirely — clearance's `target`
operand supports the same per-entry explicit-`dbIds` scoping the other modes do, and must respect it.

**Simplification (a direct consequence of Task 8's fix):** because invalid instances are already
filtered out of `sourceInstances`/`targetGroups` before broad phase ever runs, and because
`currentByFragmentId`'s membership check already scopes every TLAS candidate to this call's own
validated current target bucket, `onCandidate` needs NO redundant per-candidate transform-validity
check — removed entirely versus the first draft, matching Hard Clash's own `_runTlasBroadPhase`'s
equal simplicity.

Real reference, confirmed by direct read (`CollisionWorld.js:2133-2214`):

```js
async _runTlasBroadPhase(sourceOperand, sourceInstances, targetGroups, targetScopeFilter, statistics, checkpoint) {
    const candidates = [];
    let candidateBudgetUsed = 0;
    let pendingCapacityError = null;
    outer: for (const group of targetGroups) {
      const { targetOperand, instances: targetInstances } = group;
      if (targetInstances.length === 0) continue;
      const modelFilter = targetScopeFilter.get(targetOperand.model);
      const scopeFragmentSet = modelFilter instanceof Set ? modelFilter : null;
      const currentByFragmentId = new Map();
      for (const placed of targetInstances) currentByFragmentId.set(placed.instance.fragmentId, placed);
      const { bvh } = await this._getTlasEntryForEpoch(targetOperand.epoch, checkpoint, statistics);
      for (const sourcePlaced of sourceInstances) {
        const pending = checkpoint({ label: 'tlas-broad-phase-query', loadEpoch: sourceOperand.epoch });
        if (pending) await pending;
        const queryStartedAt = this._now();
        const [minX, minY, minZ] = sourcePlaced.worldBounds.min;
        const [maxX, maxY, maxZ] = sourcePlaced.worldBounds.max;
        const { truncated } = bvh.queryBox([minX, minY, minZ], [maxX, maxY, maxZ], {
          onLeafRange: (offset, count) => {
            statistics.tlasLeafRangeEmissions++;
            if (pendingCapacityError) return 'stop';
            candidateBudgetUsed += count;
            statistics.tlasPrimitiveCandidatePairs += count;
            if (candidateBudgetUsed > maxTlasCandidatePairs) {
              pendingCapacityError = new CapacityExceededError('tlas-candidate-budget', {
                limit: maxTlasCandidatePairs, completed: maxTlasCandidatePairs, attempted: maxTlasCandidatePairs + 1,
                sourceEpoch: sourceOperand.epoch, targetEpoch: targetOperand.epoch,
              });
              return 'stop';
            }
            return undefined;
          },
          onCandidate: (builderPositionIndex) => {
            const record = bvh.recordAt(builderPositionIndex);
            if (scopeFragmentSet && !scopeFragmentSet.has(record.fragmentId)) return undefined;
            if (isSourceOwnFragment(sourceOperand, targetOperand.epoch, record.fragmentId)) return undefined;
            const targetPlaced = currentByFragmentId.get(record.fragmentId);
            if (!targetPlaced) return undefined;
            statistics.broadPhasePairs++;
            if (this._testBroadPhasePair(sourcePlaced, targetPlaced)) {
              candidates.push([sourcePlaced, targetPlaced, targetOperand]);
            }
            return undefined;
          },
        });
        statistics.tlasQueryMs += this._now() - queryStartedAt;
        if (truncated && pendingCapacityError) break outer;
      }
    }
    if (pendingCapacityError) throw pendingCapacityError;
    statistics.tlasExactRetestSurvivors = candidates.length;
    statistics.tlasNarrowPhaseInputPairs = candidates.length;
    return candidates;
  }
```

- [ ] **Step 1: Write the failing linear-vs-TLAS parity test (fixture 11)**

Append to `test/CollisionWorld.findClashes.clearance.test.mjs`:

```js
test('fixture 11: linear and TLAS produce identical clearance pairs on the same federated scene', async () => {
  const world = new CollisionWorld();
  const sourceModel = /* several fragments at varied offsets */ null;
  const targetModel = /* several fragments: some near, some far, some overlapping */ null;
  await world.admitModel(sourceModel);
  await world.admitModel(targetModel);

  const base = {
    source: { model: sourceModel, dbIds: [1] },
    target: { targets: [{ model: targetModel }] },
    mode: 'clearance', clearance: 3, groupBy: 'dbId',
  };
  const linearResult = await world.findClashes({ ...base, broadPhase: 'linear' });
  const tlasResult = await world.findClashes({ ...base, broadPhase: 'tlas' });

  const normalize = (pairs) => pairs.map((p) => `${p.source.dbId}:${p.target.dbId}:${p.distance.toFixed(6)}`).sort();
  assert.deepEqual(normalize(tlasResult.pairs), normalize(linearResult.pairs));
});

// Fixture 12: placement invalidation changes the clearance verdict on the next call.
test('fixture 12: invalidateModelPlacement changes clearance verdict correctly', async () => {
  const world = new CollisionWorld();
  const sourceModel = /* dbId 1 at (0,0,0) */ null;
  const targetModel = /* dbId 1 at (2.5,0,0), gap 0.5 */ null;
  await world.admitModel(sourceModel);
  await world.admitModel(targetModel);

  const before = await world.findClashes({
    source: { model: sourceModel, dbIds: [1] }, target: { targets: [{ model: targetModel }] },
    mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'tlas',
  });
  assert.equal(before.pairs.length, 1);

  /* move targetModel far away via the same placement-mutation mechanism other placement-invalidation
     tests in this repo already use, then: */
  world.invalidateModelPlacement(targetModel);

  const after = await world.findClashes({
    source: { model: sourceModel, dbIds: [1] }, target: { targets: [{ model: targetModel }] },
    mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'tlas',
  });
  assert.equal(after.pairs.length, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement `_runClearanceTlasBroadPhase`**

Near `_runTlasBroadPhase`:

```js
async _runClearanceTlasBroadPhase(sourceOperand, sourceInstances, targetGroups, targetScopeFilter, clearance, statistics, checkpoint) {
  const candidates = [];
  let candidateBudgetUsed = 0;
  let pendingCapacityError = null;
  outer: for (const group of targetGroups) {
    const { targetOperand, instances: targetInstances } = group;
    if (targetInstances.length === 0) continue;
    const modelFilter = targetScopeFilter.get(targetOperand.model);
    const scopeFragmentSet = modelFilter instanceof Set ? modelFilter : null;
    const currentByFragmentId = new Map();
    for (const placed of targetInstances) currentByFragmentId.set(placed.instance.fragmentId, placed);
    const { bvh } = await this._getTlasEntryForEpoch(targetOperand.epoch, checkpoint, statistics);

    for (const sourcePlaced of sourceInstances) {
      const pending = checkpoint({ label: 'clearance-tlas-broad-phase-query', loadEpoch: sourceOperand.epoch });
      if (pending) await pending;

      const queryStartedAt = this._now();
      const b = sourcePlaced.worldBounds;
      const inflatedMin = [b.min[0] - clearance, b.min[1] - clearance, b.min[2] - clearance];
      const inflatedMax = [b.max[0] + clearance, b.max[1] + clearance, b.max[2] + clearance];
      const { truncated } = bvh.queryBox(inflatedMin, inflatedMax, {
        onLeafRange: (offset, count) => {
          statistics.tlasLeafRangeEmissions++;
          if (pendingCapacityError) return 'stop';
          candidateBudgetUsed += count;
          statistics.tlasPrimitiveCandidatePairs += count;
          if (candidateBudgetUsed > maxTlasCandidatePairs) {
            pendingCapacityError = new CapacityExceededError('tlas-candidate-budget', {
              limit: maxTlasCandidatePairs, completed: maxTlasCandidatePairs, attempted: maxTlasCandidatePairs + 1,
              sourceEpoch: sourceOperand.epoch, targetEpoch: targetOperand.epoch,
            });
            return 'stop';
          }
          return undefined;
        },
        onCandidate: (builderPositionIndex) => {
          const record = bvh.recordAt(builderPositionIndex);
          if (scopeFragmentSet && !scopeFragmentSet.has(record.fragmentId)) return undefined;
          if (isSourceOwnFragment(sourceOperand, targetOperand.epoch, record.fragmentId)) return undefined;
          const targetPlaced = currentByFragmentId.get(record.fragmentId);
          if (!targetPlaced) return undefined;
          // No redundant validity re-check here -- Task 8 already filtered invalid instances out of
          // targetInstances (hence out of currentByFragmentId) before this method ever ran.
          statistics.clearanceExpandedCandidatePairs++;
          if (aabbMinDistance(sourcePlaced.worldBounds, targetPlaced.worldBounds) <= clearance) {
            statistics.clearanceExactAabbSurvivors++;
            candidates.push([sourcePlaced, targetPlaced, targetOperand]);
          }
          return undefined;
        },
      });
      statistics.tlasQueryMs += this._now() - queryStartedAt;
      if (truncated && pendingCapacityError) break outer;
    }
  }
  if (pendingCapacityError) throw pendingCapacityError;
  return candidates;
}
```

> Note: this does NOT set `statistics.tlasExactRetestSurvivors`/`tlasNarrowPhaseInputPairs` (those are
> Hard Clash's own M2 fields, semantically tied to `_runTlasBroadPhase`'s own exact-overlap retest, not
> clearance's exact-distance retest) — clearance's analogous counts live entirely in its own 7 fields
> (`clearanceExpandedCandidatePairs`/`clearanceExactAabbSurvivors`), confirmed against spec §11.

- [ ] **Step 4: Wire `broadPhase:'tlas'` (and default selection) into clearance dispatch**

Extend Task 9 Step 9's dispatch: compute `effectiveBroadPhase` the same way the existing code does
(`query.broadPhase ?? (Array.isArray(query.target.targets) ? 'tlas' : 'linear')`), then call
`_runClearanceTlasBroadPhase` or `_runClearanceBroadPhaseScan` accordingly — both feed the identical
per-candidate `_runClearanceNarrowPhasePair`/aggregation loop from Task 9.

- [ ] **Step 5: Run tests to verify they pass**

`node --test test/CollisionWorld.findClashes.clearance.test.mjs` (fixtures 11, 12), then `npm test`
(full suite).

- [ ] **Step 6: Commit**

```bash
git add collision/CollisionWorld.js test/CollisionWorld.findClashes.clearance.test.mjs
git commit -m "feat(collision): add clearance TLAS broad phase, reusing CollisionInstanceBVH.queryBox"
```

**Completion criteria:** `broadPhase:'tlas'` and `broadPhase:'linear'` produce identical `pairs` for
the same clearance query (fixture 11); `invalidateModelPlacement` correctly changes the verdict on the
next call (fixture 12); the budget check uses a real, separate `candidateBudgetUsed` accumulator,
copied verbatim from the real Hard Clash pattern, never a statistics field.

**Protected invariants:** no second TLAS is built; `CollisionInstanceBVH`/`TlasCache`'s public
interfaces are called, never modified; Hard Clash's own `_runTlasBroadPhase` is untouched (read for
pattern reuse only).

**Evidence required before coding:** none beyond what this task already quotes verbatim from confirmed
real source.

---

## Task 11: `maxClearanceNarrowPhasePairs` budget

**Files:**
- Modify: `collision/CollisionWorld.js`
- Test: `test/CollisionWorld.clearanceBudget.test.mjs` (new)

**Interfaces:**
- Consumes: `maxClearanceNarrowPhasePairs`, `'clearance-narrow-phase-budget'` (Task 1).
- Produces: a single upfront capacity check against the fully-materialized `candidates` array, before
  any narrow-phase work starts.

**Fix (Important #3, post-review).** The first draft assumed a `new CollisionWorld({
maxClearanceNarrowPhasePairs: 2 })` constructor override — nothing in the real codebase supports this.
Confirmed by reading the real test seam directly: `test/CollisionWorld.tlasTraversal.test.mjs`'s own
`maxTlasCandidatePairs` capacity test (`"exactly maxTlasCandidatePairs candidates succeeds..."`) was
explicitly designed, per its own comment, to AVOID adding a per-call/constructor override
(`codex-advisor review: ... expanding that surface for a one-test-only seam is unwarranted scope
creep`) — instead it calls `_runTlasBroadPhase` directly with a stub `bvh` object whose `queryBox`
invokes `onLeafRange` with a caller-controlled count, exercising the REAL, actually-imported constant
with zero production-code changes. This plan's clearance budget test mirrors that same discipline.

**Design simplification, a direct consequence of Task 8/9's own fix:** unlike the TLAS leaf-range
budget (which must stop MID-TRAVERSAL, since the traversal progressively discovers candidates and the
full set is not known in advance), clearance's narrow-phase `candidates` array is ALREADY fully
materialized by broad phase before narrow-phase work starts — its `.length` is known upfront. A single
preflight check (`candidates.length > maxClearanceNarrowPhasePairs`, thrown before the narrow-phase
loop even begins) is therefore exactly equivalent in outcome to an incremental per-iteration counter
(nothing conditionally changes `candidates.length` mid-loop) and is materially simpler to implement AND
to test: the test constructs an oversized array of cheap placeholder tuples (no real geometry
resolution is ever attempted, since the throw happens before the loop starts) and asserts the
immediate throw. This mirrors `_exceedsBroadPhaseCeiling`'s own existing "preflight, not incremental"
style for the analogous M1 broad-phase ceiling.

- [ ] **Step 1: Write the failing test**

Create `test/CollisionWorld.clearanceBudget.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld, CapacityExceededError } from '../collision/CollisionWorld.js';
import { maxClearanceNarrowPhasePairs } from '../collision/constants.js';

test('candidates.length exactly at the limit does not throw', async () => {
  const world = new CollisionWorld();
  // Cheap placeholder tuples -- the preflight check runs BEFORE any narrow-phase geometry resolution
  // is attempted, so these never need to resolve to real instances.
  const candidates = Array.from({ length: maxClearanceNarrowPhasePairs }, () => [
    { instance: { fragmentId: 1, geometryIdentity: { loadEpoch: 1, geometryIndex: 0 } }, worldMatrix: [], worldBounds: {}, ownerDbId: 1 },
    { instance: { fragmentId: 2, geometryIdentity: { loadEpoch: 1, geometryIndex: 0 } }, worldMatrix: [], worldBounds: {}, ownerDbId: 2 },
    { model: {}, epoch: 1 },
  ]);
  // Unit-level: call the private preflight check function directly rather than driving a full
  // findClashes call through maxClearanceNarrowPhasePairs real candidates end-to-end.
  assert.doesNotThrow(() => world._checkClearanceNarrowPhaseBudget(candidates));
});

test('candidates.length one over the limit throws CapacityExceededError, never truncates', async () => {
  const world = new CollisionWorld();
  const candidates = Array.from({ length: maxClearanceNarrowPhasePairs + 1 }, () => [{}, {}, {}]);
  assert.throws(() => world._checkClearanceNarrowPhaseBudget(candidates), (err) => {
    assert.ok(err instanceof CapacityExceededError);
    assert.equal(err.kind, 'clearance-narrow-phase-budget');
    assert.equal(err.limit, maxClearanceNarrowPhasePairs);
    assert.equal(err.attempted, candidates.length);
    return true;
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `_checkClearanceNarrowPhaseBudget` does not exist.

- [ ] **Step 3: Implement the preflight check**

In `collision/CollisionWorld.js`, as its own small method (directly unit-testable, per the real
codebase's own established seam style):

```js
// Preflight, not incremental (Important #3): the full candidates array is already materialized by
// broad phase before narrow-phase work starts, so a single upfront length check is exactly equivalent
// in outcome to a per-iteration counter and is both simpler and more directly testable.
_checkClearanceNarrowPhaseBudget(candidates) {
  if (candidates.length > maxClearanceNarrowPhasePairs) {
    throw new CapacityExceededError('clearance-narrow-phase-budget', {
      limit: maxClearanceNarrowPhasePairs, attempted: candidates.length,
    });
  }
}
```

Call it in `findClashes`'s clearance branch (Task 9 Step 9), immediately after broad phase returns
`candidates` and before the narrow-phase-and-aggregation loop begins:

```js
this._checkClearanceNarrowPhaseBudget(candidates);
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add collision/CollisionWorld.js test/CollisionWorld.clearanceBudget.test.mjs
git commit -m "feat(collision): enforce maxClearanceNarrowPhasePairs as an upfront candidate-count budget"
```

**Completion criteria:** a `findClashes` call whose clearance candidate set exceeds
`maxClearanceNarrowPhasePairs` throws `CapacityExceededError('clearance-narrow-phase-budget', {limit,
attempted})` before any narrow-phase work starts, never silently truncating.

**Protected invariants:** `maxTlasCandidatePairs`'s own budget/throw discipline (Task 10, broad-phase
side) is untouched — this is a separate, narrow-phase-only budget layered on top.

**Evidence required before coding:** the real test-seam precedent (`test/CollisionWorld.tlasTraversal.test.mjs`)
was confirmed by direct read during this revision — mirror its "call the private method directly,
never add a one-test-only public override" discipline exactly.

---

## Task 12: Statistics consistency audit

**Files:**
- Test: `test/CollisionWorld.clearanceStatistics.test.mjs` (new)

**Interfaces:** no new production code — this task is a dedicated consistency/inequality test pass.

**Definitive increment-point table (Important #1, post-review — replaces every scattered per-task
claim with one source of truth):**

| Field | Increments when | Fixed in |
|---|---|---|
| `clearanceExpandedCandidatePairs` | TLAS `onCandidate`, after scope/self-exclusion/`currentByFragmentId` filters, before the exact retest. Always `0` under `broadPhase:'linear'`. | Task 10 |
| `clearanceExactAabbSurvivors` | Once per candidate (linear or TLAS) whose exact, unpadded AABB distance is `<= clearance` | Tasks 9, 10 |
| `clearanceOverlapPrechecksRun` | Once per candidate whose precheck status is `excluded`, `proceed`, OR `inconclusive` — i.e. whenever `volumeOverlapQuery` actually ran. **Never** for `skip-precheck` (fix: the first draft omitted `excluded`) | Task 9 |
| `clearanceHardClashExclusions` | Once per **dbId-level** pair omitted because of a proven Hard Clash on any contributing fragment pair (never per fragment pair) | Task 9 |
| `clearanceDistanceQueriesRun` | Once per actual `clearanceQuery` call (both the `proceed` and `skip-precheck` branches reach it) | Task 9 |
| `clearanceHits` | `pairs.length` at the end of the call | Task 9 |
| `clearanceQueryMs` | Wall-clock inside `clearanceQuery` calls only, same bracketing convention as `tlasQueryMs` | Task 9 |

- [ ] **Step 1: Write the consistency tests**

Create `test/CollisionWorld.clearanceStatistics.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../collision/CollisionWorld.js';

test('clearanceHits === pairs.length for a clearance call', async () => {
  const world = new CollisionWorld();
  const model = /* one near-miss pair among several fragments */ null;
  await world.admitModel(model);
  const { pairs, statistics } = await world.findClashes({
    source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'clearance', clearance: 1, groupBy: 'dbId',
  });
  assert.equal(statistics.clearanceHits, pairs.length);
});

test('clearanceExpandedCandidatePairs stays 0 under broadPhase:linear', async () => {
  const world = new CollisionWorld();
  const model = /* ... */ null;
  await world.admitModel(model);
  const { statistics } = await world.findClashes({
    source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(statistics.clearanceExpandedCandidatePairs, 0);
});

test('clearanceOverlapPrechecksRun counts excluded candidates too, not just proceed/inconclusive', async () => {
  const world = new CollisionWorld();
  const model = /* source dbId 1 overlaps target dbId 2 (excluded) AND has a genuine near-miss to
    target dbId 3 (proceed) */ null;
  await world.admitModel(model);
  const { statistics } = await world.findClashes({
    source: { model, dbIds: [1] }, target: { model, dbIds: [2, 3] }, mode: 'clearance', clearance: 5, groupBy: 'dbId',
  });
  assert.ok(statistics.clearanceOverlapPrechecksRun >= 2, 'both the excluded and the proceed candidate must count');
});

test('clearanceExactAabbSurvivors >= clearanceOverlapPrechecksRun', async () => {
  const world = new CollisionWorld();
  const model = /* mixed set: some touching, some clearly separated */ null;
  await world.admitModel(model);
  const { statistics } = await world.findClashes({
    source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'clearance', clearance: 5, groupBy: 'dbId',
  });
  assert.ok(statistics.clearanceOverlapPrechecksRun <= statistics.clearanceExactAabbSurvivors);
});

test('clearanceDistanceQueriesRun excludes hard-clash-excluded and inconclusive candidates', async () => {
  const world = new CollisionWorld();
  const model = /* one overlapping (excluded) pair, one near-miss pair */ null;
  await world.admitModel(model);
  const { statistics } = await world.findClashes({
    source: { model, dbIds: [1] }, target: { model, dbIds: [2, 3] }, mode: 'clearance', clearance: 5, groupBy: 'dbId',
  });
  assert.ok(statistics.clearanceDistanceQueriesRun < statistics.clearanceExactAabbSurvivors);
});
```

- [ ] **Step 2: Run tests**

`node --test test/CollisionWorld.clearanceStatistics.test.mjs` — PASS if Tasks 9-11 wired the
increment points per the table above; any failure means an increment point needs a fix — go back and
correct the specific task's implementation.

- [ ] **Step 3: Commit**

```bash
git add test/CollisionWorld.clearanceStatistics.test.mjs
git commit -m "test(collision): add M3 clearance statistics consistency audit"
```

**Completion criteria:** all consistency assertions pass against the real wiring from Tasks 9-11,
including the `excluded`-counts-toward-`clearanceOverlapPrechecksRun` fix.

**Protected invariants:** none new — this task verifies, does not change, behavior.

**Evidence required before coding:** none.

---

## Task 13: Full 17-fixture correctness matrix audit

**Files:**
- Test: review/extend as needed across `test/query/ClearanceQuery.test.mjs`,
  `test/query/VolumeOverlapQuery.conclusive.test.mjs`, `test/query/ClearanceHardClashPrecheck.test.mjs`,
  `test/CollisionWorld.findClashes.clearance.test.mjs`

**Interfaces:** none new — coverage audit and gap-filling, the batch-2/3 boundary review.

- [ ] **Step 1: Build the coverage table**

| # | Fixture | Covered in |
|---|---|---|
| 1 | Farther than clearance | Task 5 |
| 2 | Exactly at threshold | Task 5 |
| 3 | Slightly within threshold | Task 5, Task 9 (integration) |
| 4 | Surface touching | Task 5 |
| 5 | Positive-volume overlap excluded | Task 7, Task 9 (integration) |
| 6 | Containment excluded | Task 7, Task 9 (integration) |
| 7 | Rotated/transformed known distance | Task 5 |
| 8 | Cross-model federated clearance | Task 9 (integration) |
| 9 | Self-exclusion | Task 9 |
| 10 | Multi-fragment minimum-distance aggregation | Task 9 |
| 11 | Linear vs TLAS parity | Task 10 |
| 12 | Placement invalidation | Task 10 |
| 13 | Dead-band | Task 5 |
| 14 | Inconclusive Hard-Clash precheck | Task 6, Task 7 |
| 15 | Anisotropic scale rejection | Task 4, Task 5 |
| 16 | Uniform scale correctness (equal AND unequal source/target scale) | Task 4, Task 5 |
| 17 | Invalid/non-finite transform | Task 8 |

- [ ] **Step 2: Verify every row's test actually exists and passes**

`npm test` (full suite). Cross-check each row against the real test file — if any fixture's coverage
turned out assertion-thin (e.g. a placeholder test data construction never filled in), fix it now.

- [ ] **Step 3: Fill any gap found, in its owning task's test file (not a new file)**

- [ ] **Step 4: Commit (only if gaps were found and fixed)**

```bash
git add -A
git commit -m "test(collision): close M3 correctness-fixture coverage gaps"
```

**Completion criteria:** all 17 fixtures have a real, passing test; the coverage table above is accurate.

---

## Task 14: `Find Soft Clashes` context-menu action

**Files:**
- Modify: `wwwroot/extensions/ClashFinderExtension.js`
- Test: `test/ClashFinderExtension.softClash.test.mjs` (new)

**Interfaces:**
- Consumes: `findClashes({mode:'clearance', clearance, ...})` (Tasks 9/10); existing
  `viewer.getAggregateSelection()`/`getAllModels()`/`registerContextMenuCallback`.
- Produces: a second `EXTENSION_ID`-scoped context-menu entry; `DEFAULT_CLEARANCE = 0.05`; a
  **separate** action token from Hard Clash's own.

**Fix (Important #4, post-review).** The first draft validated `defaultClearance` "after existing
setup" (world creation, listener registration) — a thrown validation error would leave a world and
callbacks attached despite `load()` failing, and a retry could then double-register. **Fix:** resolve
and validate `defaultClearance` as the VERY FIRST thing `load()` does, before
`CollisionWorld.fromViewer(...)` and before any listener/context-menu registration. Also settles open
review question #3: Hard Clash and Soft Clash use **separate, independent** monotonic action tokens
(`_latestActionToken` stays Hard Clash's own, unchanged; a new `_latestSoftClashActionToken` is added)
so firing one action never silently cancels an in-flight run of the other — matching the spec's
explicit "independent Viewer action" framing.

- [ ] **Step 1: Write the failing tests**

Create `test/ClashFinderExtension.softClash.test.mjs`. Read `test/ClashFinderExtension.test.mjs` first
and reuse its exact mock-viewer/mock-world scaffolding rather than inventing a parallel one:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ClashFinderExtension } from '../wwwroot/extensions/ClashFinderExtension.js';

test('load() with no options resolves _clearance to DEFAULT_CLEARANCE (0.05)', async () => {
  const ext = /* mock viewer, no options, per existing test file's own construction pattern */ null;
  await ext.load();
  assert.equal(ext._clearance, 0.05);
});

test('load() with a valid defaultClearance option uses the override', async () => {
  const ext = /* options: { defaultClearance: 0.2 } */ null;
  await ext.load();
  assert.equal(ext._clearance, 0.2);
});

for (const bad of [0, -1, NaN, Infinity, 'nope']) {
  test(`load() with an invalid defaultClearance=${bad} fails load() itself, before any registration`, async () => {
    const registerCalls = [];
    const ext = /* mock viewer whose registerContextMenuCallback/CollisionWorld.fromViewer both push to
      registerCalls, options: { defaultClearance: bad } */ null;
    await assert.rejects(() => ext.load());
    assert.equal(registerCalls.length, 0, 'a failed defaultClearance validation must leave nothing registered');
  });
}

test('context-menu gains a "Find Soft Clashes" entry alongside "Find Clashes"', () => {
  const ext = /* loaded extension */ null;
  const menu = [];
  ext.onContextMenu(menu, {});
  const titles = menu.map((m) => m.title);
  assert.ok(titles.includes('Find Clashes'));
  assert.ok(titles.includes('Find Soft Clashes'));
});

test('"Find Soft Clashes" invokes findClashes with mode:clearance and the resolved clearance value', async () => {
  const findClashesCalls = [];
  const ext = /* loaded extension whose this._world.findClashes is a spy */ null;
  const menu = [];
  ext.onContextMenu(menu, {});
  const softClashEntry = menu.find((m) => m.title === 'Find Soft Clashes');
  await softClashEntry.target();
  assert.equal(findClashesCalls.length, 1);
  assert.equal(findClashesCalls[0].mode, 'clearance');
  assert.equal(findClashesCalls[0].clearance, ext._clearance);
  assert.ok(Array.isArray(findClashesCalls[0].target.targets));
});

test('Find Soft Clashes and Find Clashes use SEPARATE action tokens -- firing one does not cancel an in-flight run of the other', async () => {
  // Fire "Find Clashes" (slow, unresolved findClashes promise), then fire "Find Soft Clashes" (fast,
  // resolves first). Assert the Hard Clash run, once its own promise resolves, still applies its
  // result normally -- it must NOT observe itself as "stale" just because a Soft Clash action ran
  // in between. Mirrors, but does not share state with, the existing Hard Clash stale-token test.
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement the action**

Near the existing constants:

```js
const DEFAULT_CLEARANCE = 0.05; // provisional world-unit default; see Task 18's performance gate.
```

`load()`, rewritten so validation is the very first statement, before any existing setup:

```js
async load() {
  this._clearance = this.options.defaultClearance ?? DEFAULT_CLEARANCE;
  if (typeof this._clearance !== 'number' || !Number.isFinite(this._clearance) || this._clearance <= 0) {
    throw new Error(`ClashFinderExtension: options.defaultClearance must be a finite, positive number, got ${this.options.defaultClearance}`);
  }
  this._latestSoftClashActionToken = 0;
  // ...existing load() body (CollisionWorld.fromViewer, listener/context-menu registration) follows,
  // completely unchanged, AFTER this validation.
}
```

In `onContextMenu`, after the existing "Find Clashes" `menu.push(...)`, add a second, independent
entry, using its OWN token and the same aggregate-selection gate / "all loaded models" flow:

```js
menu.push({
  title: 'Find Soft Clashes',
  target: async () => {
    const token = ++this._latestSoftClashActionToken; // SEPARATE from Hard Clash's _latestActionToken
    let result;
    try {
      result = await this._world.findClashes({
        source: { model: sourceModel, dbIds: [sourceDbId] },
        target: { targets: this._viewer.getAllModels().map((model) => ({ model })) },
        mode: 'clearance',
        clearance: this._clearance,
        groupBy: 'dbId',
      });
    } catch (err) {
      if (token !== this._latestSoftClashActionToken) return;
      console.error(err);
      this._clearIsolation();
      this._clearSoftClashVisualization(); // Task 15
      this._notifyUser(`Find Soft Clashes failed for element ${sourceDbId}: ${err.message}`);
      return;
    }
    if (token !== this._latestSoftClashActionToken) return;
    // ...isolate/fitToView/visualize/notify, mirroring the existing "Find Clashes" success path
    // exactly (Task 15 implements _addSoftClashVisualization; this step wires the call site).
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

(`_clearSoftClashVisualization`/`_addSoftClashVisualization` are added in this step as trivial real
methods tracking an empty array — never a literal placeholder — given real geometry in Task 15.)

- [ ] **Step 5: Commit**

```bash
git add wwwroot/extensions/ClashFinderExtension.js test/ClashFinderExtension.softClash.test.mjs
git commit -m "feat(extensions): add Find Soft Clashes context-menu action with its own action token"
```

**Completion criteria:** "Find Soft Clashes" is a second, independent context-menu entry;
`defaultClearance` is validated before ANY registration happens; Hard Clash and Soft Clash never
cancel each other via a shared token; existing "Find Clashes" flow completely unchanged.

**Protected invariants:** the existing "Find Clashes" action's own `EXTENSION_ID`, gating,
`_latestActionToken` discipline, and `findClashes` call are byte-for-byte unchanged.

**Evidence required before coding:** confirm `test/ClashFinderExtension.test.mjs`'s exact mock scaffolding before writing this task's test file.

---

## Task 15: Clearance visualization — endpoint markers + line

**Files:**
- Modify: `wwwroot/extensions/ClashFinderExtension.js`
- Test: extend `test/ClashFinderExtension.softClash.test.mjs`

**Interfaces:**
- Consumes: `pairs[].witness.sourcePoint`/`.targetPoint` (Task 9's `ClashPair` shape); existing
  `viewer.overlays.addScene`/`addMesh`/`removeMesh`/`removeScene`.
- Produces: `_addSoftClashVisualization(pairs, dbIdsByModel)`, `_clearSoftClashVisualization()`.

**Design decision (unchanged from the first draft — not affected by the review):** Soft Clash
markers/line use a **separate overlay scene** (`SOFT_CLASH_OVERLAY_NAME = 'clash-finder-soft-markers'`)
and a **distinct color** (`SOFT_CLASH_COLOR = 0x2b8fff`, blue, vs. Hard Clash's `MARKER_COLOR =
0xff6a00` orange) so both result types can be visualized in the same session without confusion. The
M2.1 inventory confirmed existing Hard Clash markers render exactly ONE sphere per pair at a single
`witness.point` — this is new visual code (two markers + a line), not a drop-in reuse of that method,
though it reuses the surrounding shared-geometry/material/`depthTest:false`/r71-only-THREE pattern.

- [ ] **Step 1: Write the failing tests**

```js
test('a successful Find Soft Clashes result renders two markers + one line per pair', async () => {
  // Mock findClashes to resolve with 2 clearance pairs, distinct witness points each. Assert
  // viewer.overlays.addMesh fired 6 times (2 markers + 1 line, per pair), scene name always
  // SOFT_CLASH_OVERLAY_NAME, never MARKER_OVERLAY_NAME.
});
test('markers/line use SOFT_CLASH_COLOR, distinct from Hard Clash MARKER_COLOR', async () => { /* ... */ });
test('zero-result Find Soft Clashes clears any prior soft-clash visualization, adds nothing new', async () => { /* ... */ });
test('a subsequent Find Clashes call does not clear Soft Clash markers, and vice versa (independent overlays)', async () => { /* ... */ });
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement the visualization**

```js
const SOFT_CLASH_OVERLAY_NAME = 'clash-finder-soft-markers';
const SOFT_CLASH_COLOR = 0x2b8fff;
const SOFT_CLASH_MARKER_RADIUS_FRACTION = 0.002; // same fraction as Hard Clash's tuned value (726b903)
const SOFT_CLASH_MIN_MARKER_RADIUS = 0.05;
const SOFT_CLASH_MAX_MARKER_RADIUS = 2.0;

_ensureSoftClashOverlay() {
  const THREE = window.THREE; // Viewer's own r71 global -- never import 'three' in this file.
  if (this._softClashGeometry) return;
  this._softClashGeometry = new THREE.SphereGeometry(1, 12, 8);
  this._softClashMaterial = new THREE.MeshBasicMaterial({
    color: SOFT_CLASH_COLOR, transparent: true, opacity: 0.65, depthTest: false, depthWrite: false,
  });
  this._softClashLineMaterial = new THREE.LineBasicMaterial({
    color: SOFT_CLASH_COLOR, transparent: true, opacity: 0.65, depthTest: false,
  });
  if (!this._viewer.overlays.hasScene(SOFT_CLASH_OVERLAY_NAME)) {
    this._viewer.overlays.addScene(SOFT_CLASH_OVERLAY_NAME);
  }
  this._activeSoftClashObjects = this._activeSoftClashObjects ?? [];
}

_addSoftClashVisualization(pairs, dbIdsByModel) {
  const THREE = window.THREE;
  this._ensureSoftClashOverlay();
  const radius = this._computeMarkerRadius(dbIdsByModel, SOFT_CLASH_MIN_MARKER_RADIUS, SOFT_CLASH_MAX_MARKER_RADIUS);
  for (const pair of pairs) {
    if (!pair.witness) continue; // per spec, a clearance pair is only ever emitted with a real witness
    const sourceMesh = new THREE.Mesh(this._softClashGeometry, this._softClashMaterial);
    sourceMesh.scale.set(radius, radius, radius);
    sourceMesh.position.set(...pair.witness.sourcePoint);
    this._viewer.overlays.addMesh(sourceMesh, SOFT_CLASH_OVERLAY_NAME);
    this._activeSoftClashObjects.push(sourceMesh);

    const targetMesh = new THREE.Mesh(this._softClashGeometry, this._softClashMaterial);
    targetMesh.scale.set(radius, radius, radius);
    targetMesh.position.set(...pair.witness.targetPoint);
    this._viewer.overlays.addMesh(targetMesh, SOFT_CLASH_OVERLAY_NAME);
    this._activeSoftClashObjects.push(targetMesh);

    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...pair.witness.sourcePoint), new THREE.Vector3(...pair.witness.targetPoint),
    ]);
    const line = new THREE.Line(lineGeometry, this._softClashLineMaterial);
    this._viewer.overlays.addMesh(line, SOFT_CLASH_OVERLAY_NAME);
    this._activeSoftClashObjects.push(line);
  }
}

_clearSoftClashVisualization() {
  for (const obj of this._activeSoftClashObjects ?? []) {
    this._viewer.overlays.removeMesh(obj, SOFT_CLASH_OVERLAY_NAME);
    if (obj.geometry && obj.geometry !== this._softClashGeometry) obj.geometry.dispose(); // per-pair line geometry
  }
  this._activeSoftClashObjects = [];
}
```

> **Verification note:** `_computeMarkerRadius`'s existing signature must be confirmed against the
> real `ClashFinderExtension.js` — if it does not already accept `(dbIdsByModel, min, max)` parameters
> (the M2.1 inventory found it reads Hard Clash's own module-level `MIN_MARKER_RADIUS`/
> `MAX_MARKER_RADIUS` constants directly rather than taking them as arguments), refactor it to accept
> them as parameters (shared helper) rather than duplicating its body for Soft Clash — a small,
> behavior-preserving refactor, proven so by re-running `test/ClashFinderExtension.test.mjs` unmodified.
> Also confirm `viewer.overlays.hasScene`/`THREE.Line`/`THREE.LineBasicMaterial` construction against
> the real pinned r71 bundle before trusting the snippet above, the same way the M2.1 inventory
> confirmed `LmvVector3` lacked `setScalar`.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add wwwroot/extensions/ClashFinderExtension.js test/ClashFinderExtension.softClash.test.mjs
git commit -m "feat(extensions): render Soft Clash source/target markers and connecting line"
```

**Completion criteria:** a successful "Find Soft Clashes" call renders two endpoint markers plus one
connecting line per pair, in a distinct overlay scene and color from Hard Clash markers.

**Protected invariants:** Hard Clash's own marker overlay/scene/material/lifecycle code is completely
untouched except for the `_computeMarkerRadius` parameterization refactor (proven behavior-identical).

**Evidence required before coding:** `_computeMarkerRadius`'s real signature and `viewer.overlays.hasScene`/`THREE.Line` availability on the real r71 bundle.

---

## Task 16: Visualization lifecycle tests

**Files:**
- Modify: `wwwroot/extensions/ClashFinderExtension.js` — wire `_clearSoftClashVisualization` into
  `unload()` and `_onBeforeModelUnload()`
- Test: extend `test/ClashFinderExtension.softClash.test.mjs`

**Fix (Important #4, post-review).** The first draft's cleanup wiring was pseudocode-level. **Fix:**
spell out the exact nested try/finally structure, mirroring the REAL existing `unload()`'s shape
(confirmed by the M2.1 inventory: `_world.dispose()` in its own try/finally, then an outer finally
running `_clearIsolation()`/`_clearMarkers()` each in their OWN try/finally) — soft-clash cleanup
added as additional, independent try/finally rungs in the SAME chain, never nested inside the
hard-clash ones, so a throw in either never prevents the other's cleanup from running.

- [ ] **Step 1: Write the failing lifecycle tests**

```js
test('model unload clears BOTH Hard Clash and Soft Clash visualization (no partial preservation)', async () => { /* ... */ });
test('extension unload disposes the soft-clash shared geometry/material and removes its overlay scene', async () => { /* ... */ });
test('a throwing _clearSoftClashVisualization does not prevent Hard Clash cleanup from running, and vice versa', async () => {
  // Stub _clearSoftClashVisualization to throw; call unload(); assert _clearMarkers/removeScene(MARKER_OVERLAY_NAME)
  // and the Hard Clash geometry/material disposal all still ran despite the soft-clash throw. Then the
  // reverse: stub _clearMarkers to throw, assert soft-clash cleanup still ran.
});
test('r71/r185 isolation: soft-clash visualization code never imports the npm "three" package', () => { /* static grep check, mirrors existing test */ });
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Wire the lifecycle hooks with explicit, independent try/finally rungs**

```js
// Inside unload(), in the SAME outer-finally chain that already protects _clearMarkers()'s cleanup --
// added as an ADDITIONAL, independent try/finally, never nested inside the existing Hard Clash ones:
try {
  this._clearSoftClashVisualization();
} finally {
  try {
    if (this._viewer.overlays.hasScene(SOFT_CLASH_OVERLAY_NAME)) this._viewer.overlays.removeScene(SOFT_CLASH_OVERLAY_NAME);
  } finally {
    this._softClashGeometry?.dispose();
    this._softClashMaterial?.dispose();
    this._softClashLineMaterial?.dispose();
    this._softClashGeometry = null; this._softClashMaterial = null; this._softClashLineMaterial = null;
  }
}
```

In `_onBeforeModelUnload()`, add `this._clearSoftClashVisualization();` as its own statement,
immediately alongside (not nested inside) the existing unconditional `this._clearMarkers();` call —
same "not filtered to participating models" policy, same independence guarantee.

> **Verification note:** confirm the EXACT real nesting of `unload()`'s existing try/finally chain
> before inserting — the snippet above is this task's best-specified intent (independent rungs, never
> nested inside Hard Clash's own), not a verbatim quote of the real file; adjust indentation/ordering
> to match the real structure while preserving the independence property.

- [ ] **Step 4: Run tests to verify they pass; run the full `ClashFinderExtension` suite**

`node --test test/ClashFinderExtension.softClash.test.mjs`, then `npm test` — confirm zero regressions
to `test/ClashFinderExtension.test.mjs` (Hard Clash), unmodified.

- [ ] **Step 5: Commit**

```bash
git add wwwroot/extensions/ClashFinderExtension.js test/ClashFinderExtension.softClash.test.mjs
git commit -m "feat(extensions): wire Soft Clash visualization into existing lifecycle hooks, independently"
```

**Completion criteria:** model unload, extension unload, and exception-safety behavior for the
soft-clash overlay exactly mirror the landed Hard Clash discipline, with proven mutual independence
under a throw on either side.

**Protected invariants:** the existing Hard Clash lifecycle code paths are unchanged — verified by
re-running `test/ClashFinderExtension.test.mjs` with zero modifications needed.

**Evidence required before coding:** the real `unload()` nesting must be confirmed before Step 3.

---

## Task 17: Bounded live discovery + federated live acceptance

**Files:**
- Modify: `test/acceptance/clash-finder.acceptance.mjs`

**Interfaces:**
- Consumes: the real 3-discipline Audubon federated fixture (~7,474 fragments); existing
  `NEGATIVE_CASE` (dbId `3965`), `MIXED_CASE`/Hard Clash ground truth (dbId `2734`); the real
  production "Find Soft Clashes" action (Tasks 14-16).

**Fix (Important #5, post-review).** The first draft's Hard-Clash-exclusion assertion relied on
absence of the known crossing target alone — but a crossing pair's true surface distance is exactly 0,
which the tolerance floor rejects anyway for an unrelated reason (touching, not clearance), so absence
alone does not prove the tri-state precheck itself is what excluded it; a completely disabled precheck
would produce the identical absence. **Fix:** additionally assert `statistics.clearanceHardClashExclusions
>= 1` for that specific query, which can only be nonzero if the precheck actually ran and proved
overlap — a real, mechanism-specific proof, not an absence-only inference.

- [ ] **Step 1: Bounded near-miss discovery spike**

Scan a fixed clearance-candidate range (e.g. `0.01`–`2.0` world units, capped iteration count), issuing
real `findClashes({mode:'clearance', clearance, ...})` calls against the existing loaded scene
(starting from `NEGATIVE_CASE`'s dbId `3965` and its neighbors), per the M2.1 Task-10 bounded-spike
precedent. Record the result (found pair + distance, or "none found").

- [ ] **Step 2: Implement the fallback-aware acceptance assertions**

```js
// Always run: known-negative no-false-positive.
await runSoftClashCheck({
  label: 'known-negative-no-false-positive',
  sourceDbId: NEGATIVE_CASE.dbId,
  clearance: /* provably smaller than 3965's true minimum distance to anything, from the discovery spike's own measurements */ 0.001,
  expectPairs: 0,
});

// Always run: proven Hard Clash exclusion -- absence AND the mechanism-specific statistic (Important #5 fix).
await runSoftClashCheck({
  label: 'hard-clash-never-in-clearance-results',
  sourceDbId: MIXED_CASE.dbId,
  clearance: 5,
  expectHardClashTargetAbsent: MIXED_CASE.hardClashTargetDbId,
  expectStatistic: { field: 'clearanceHardClashExclusions', atLeast: 1 },
});

if (discoveredNearMissPair) {
  // Preferred, only if the bounded spike found a real one: full positive-case acceptance -- Soft
  // Clash action, measured distance, world-space closest-point visualization, model provenance,
  // negative beyond threshold, alignment update via viewer.impl.setPlacementTransform, zero console errors.
  await runSoftClashCheck({ label: 'discovered-near-miss-positive', ...discoveredNearMissPair });
}
```

- [ ] **Step 3: Run the acceptance script against the real fixture**

`npm run test:acceptance:clash-finder` (extended) — requires a running Viewer/Playwright environment;
not part of the default `npm test` run.

- [ ] **Step 4: Record the result honestly**

Whichever branch actually exercised, record it plainly in the run report
(`test/acceptance/results/clash-finder-run-report.json`) — never claim a positive near-miss case ran if
the bounded spike found none.

- [ ] **Step 5: Commit**

```bash
git add test/acceptance/clash-finder.acceptance.mjs
git commit -m "test(acceptance): extend clash-finder acceptance with bounded Soft Clash discovery + assertions"
```

**Completion criteria:** the known-negative and Hard-Clash-exclusion assertions (now including the
mechanism-specific `clearanceHardClashExclusions` check) always run and pass; a positive near-miss case
runs and passes if and only if genuinely discovered; the run report honestly reflects which branch ran.

**Protected invariants:** the existing Hard Clash acceptance assertions (106/106 today) are unmodified
and still pass.

**Evidence required before coding:** none beyond the existing fixture facts already confirmed.

---

## Task 18: M3 performance gate

**Files:**
- Create: `test/performance/run-gate-m3.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: the same real 3-discipline Audubon fixture and `CheckpointRecorder`/`browser-probes`
  instrumentation `run-gate-m2.mjs` uses; the 7 clearance statistics fields; `frameBudgetMs` (`8`);
  Task 9's `reportSpan('clearance-distance-query', ...)` production instrumentation.

**Fix (Important #5, post-review).** The first draft's gate script had no way to obtain real per-call
`closestPointToGeometry` spans, since no production code ever called `reportSpan` around them — Task 9
now adds that call (`collision/CollisionWorld.js:11` already imports `reportSpan` from
`./scheduler.js`, confirmed by direct read). The first draft's own disposition logic also computed
`Math.max(...clearanceQuerySpans)` unconditionally, which is `-Infinity` on an empty array — silently
comparing as "within `frameBudgetMs`" and reporting a false GO. **Fix:** require a nonempty span set
before computing any verdict; report `'NOT EXERCISED'` otherwise.

- [ ] **Step 1: Scaffold the script, mirroring `run-gate-m2.mjs`'s shape**

Read `run-gate-m2.mjs` in full immediately before writing this script. Independently re-confirm
fixture identity live, run a sacrificial unmeasured warm-up, then the real protocol —
`mode:'clearance', broadPhase:'tlas'` cold+warm on one shared world, `broadPhase:'linear'` cold+warm on
a separate fresh world.

- [ ] **Step 2: Implement the metrics per spec §17**

1. TLAS vs linear clearance candidate counts. 2. Candidate reduction ratio, reported plainly. 3.
`clearanceOverlapPrechecksRun` vs `clearanceDistanceQueriesRun` split. 4. `clearanceQueryMs / totalMs`
fraction. 5. Cold/warm wall-clock, both `broadPhase` values. 6. Worst individual `clearanceQuery` span,
collected from the real `reportSpan('clearance-distance-query', ...)` calls Task 9 added.

- [ ] **Step 3: Implement the go/no-go disposition for criterion 6, with the empty-set fix**

```js
const clearanceQuerySpans = /* collected from reportSpan('clearance-distance-query', ...) via the same
  CheckpointRecorder/browser-probes mechanism the M1 gate already uses to capture per-primitive spans */ [];

let disposition;
if (clearanceQuerySpans.length === 0) {
  disposition = { verdict: 'NOT EXERCISED — no clearance-distance-query spans were recorded', worstSpanMs: null, frameBudgetMs };
} else {
  const worstSpanMs = Math.max(...clearanceQuerySpans);
  disposition = worstSpanMs > frameBudgetMs
    ? {
        verdict: worstSpanMs > frameBudgetMs * 2 // "substantial, consistent margin" -- this task's own reasoned
          ? 'NO-GO — worst single-call span substantially exceeds frameBudgetMs'  // reading of the spec's
          : 'CAUTION — worst single-call span exceeds frameBudgetMs but not by a substantial margin', // qualitative phrase
        worstSpanMs, frameBudgetMs,
      }
    : { verdict: 'GO — worst single-call span within frameBudgetMs', worstSpanMs, frameBudgetMs };
}
report.singleCallSpanDisposition = disposition;
```

Per the spec: a genuine NO-GO does not necessarily block M3 (a tighter `DEFAULT_CLEARANCE`, or scoping
to smaller selections, may be sufficient mitigation), but it must be an explicit, reported finding —
this script reports; it does not gate CI on the result. A `'NOT EXERCISED'` result is likewise
explicit, never silently treated as GO.

- [ ] **Step 4: Output** — `test/performance/results/m3-gate-<timestamp>.json`, summarized-not-raw.

- [ ] **Step 5: Add the npm script**

```json
"test:performance:gate:m3": "node test/performance/run-gate-m3.mjs"
```

- [ ] **Step 6: Run the gate against the real fixture**

`npm run test:performance:gate:m3` — record the actual measured numbers for Task 19's closeout doc.

- [ ] **Step 7: Commit**

```bash
git add test/performance/run-gate-m3.mjs package.json
git commit -m "feat(performance): add M3 clearance performance gate with single-call-span disposition"
```

**Completion criteria:** the gate measures and reports all 7 metrics with no assumed pass/fail
threshold except the explicit go/no-go/caution/not-exercised disposition for worst single-call span,
sourced from real production `reportSpan` calls, never a false GO from an empty span set.

**Protected invariants:** `run-gate.mjs`/`run-gate-m2.mjs` are untouched.

**Evidence required before coding:** `run-gate-m2.mjs`'s exact statistics-field-reading and
disposition-verdict code — re-read in full immediately before writing this script.

---

## Task 19: README/CHANGELOG closeout

**Files:**
- Modify: `collision/README.md`, `CHANGELOG.md`

- [ ] **Step 1: Update `collision/README.md`**

- Add `'clearance'` as a fourth row to the query-modes table.
- Document `findClashes({mode:'clearance', clearance, ...})`'s full request/response shape.
- Add the 7 clearance statistics fields to the Statistics table, using Task 12's definitive
  increment-point table verbatim.
- Add the 4 clearance diagnostics, explicitly noting `clearance-distance-unavailable` and
  `clearance-hard-clash-precheck-inconclusive` DO count toward "result may be incomplete" — the
  opposite partitioning from M2.1's `witness-unavailable` carve-out.
- Add a new "M3: Soft Clash / Clearance" section: the tolerance-floor formula, the
  uniform-scale-only contract (including the documented error bound from Task 4), the real
  `resolveGeometryRecord` shared-path note, `maxClearanceNarrowPhasePairs`, `DEFAULT_CLEARANCE`,
  explicitly marked provisional with a pointer to Task 18's results.
- Add "Reference sample: Find Soft Clashes" alongside "Reference sample: Clash Finder".
- Add "Known M3 limitations": the anisotropic/sheared/reflected-scale restriction, the dead-band, the
  pair-count-budget-but-not-single-call-duration gap, and Task 17's live-acceptance fallback outcome.

- [ ] **Step 2: Add the `CHANGELOG.md` entry**

Following the exact established template, populated with the REAL numbers from Task 17 (acceptance)
and Task 18 (performance gate) — never invented placeholder numbers.

- [ ] **Step 3: Commit**

```bash
git add collision/README.md CHANGELOG.md
git commit -m "docs(collision): document M3 Soft Clash / Clearance"
```

**Completion criteria:** `collision/README.md` and `CHANGELOG.md` accurately document the shipped M3
surface using real measured numbers.

**Protected invariants:** every existing M1/M2/M2.1 documented section is unchanged except additive rows.

**Evidence required before coding:** Task 17's and Task 18's actual run output must exist first — this
task is correctly last for exactly that reason.

---

## Cross-task interface reconciliation

| Interface | Introduced in | Consumed in |
|---|---|---|
| `aabbMinDistance(boundsA, boundsB)` | Task 3 | Tasks 7, 9, 10 |
| `validateUniformScale(matrix)` | Task 4 | Tasks 5, 9 |
| `computeToleranceFloor(sourceInfo, targetInfo, surfaceEpsilonFactor)` | Task 4 | Task 9 |
| `clearanceQuery(source, target, {clearance, toleranceFloor})` | Task 5 | Task 9 |
| `volumeOverlapQuery`'s additive `conclusive: boolean` field | Task 6 | Task 7 |
| `classifyHardClashPrecheck(source, target, sourceBounds, targetBounds, volumeOverlapOptions)` | Task 7 | Task 9 |
| `isValidClearanceTransform`/`diagnoseClearanceInvalidTransform` (extraction-time filtering) | Task 8 | implicit in Tasks 9, 10 (no redundant re-check needed) |
| `resolveGeometryRecord`/`diagnoseFragmentOnce` (shared, refactored out of `_runNarrowPhasePair`) | Task 9 | Tasks 9, 10 (existing 3 modes too, behavior-proven-identical) |
| `_runClearanceBroadPhaseScan` | Task 9 | dispatch (Task 9, extended Task 10) |
| `_runClearanceTlasBroadPhase` | Task 10 | dispatch (Task 10) |
| `_runClearanceNarrowPhasePair` | Task 9 | Tasks 9, 10 |
| `compareClearanceCandidates` (mirrors real, confirmed `compareWitnessCandidates`) | Task 9 | dbId aggregation (Task 9) |
| `_checkClearanceNarrowPhaseBudget` (upfront preflight, not incremental) | Task 11 | dispatch (Task 9's loop, called via Task 11's addition) |
| 7 clearance statistics fields, definitive increment-point table | Task 1 (scaffold), Task 12 (table) | Tasks 9, 10 |
| Epoch-qualified dbId aggregation key `` `${sourceEpoch}:${sourceDbId}:${targetEpoch}:${targetDbId}` `` | Task 9 | Tasks 9, 10, 12 |
| 4 clearance diagnostic reason strings (`clearance-distance-unavailable` fragment-scoped via Task 5's aborts, pair-scoped precheck-inconclusive via Task 9, fragment-scoped `clearance-invalid-transform` via Task 8, `clearance-anisotropic-scale-unsupported` via Tasks 5/9) | Tasks 5, 7, 8, 9 | Task 19 |
| `SOFT_CLASH_OVERLAY_NAME`, `SOFT_CLASH_COLOR`, separate `_latestSoftClashActionToken` | Task 14/15 | Task 16 |
| `_addSoftClashVisualization`/`_clearSoftClashVisualization` | Tasks 14 (stub)/15 (real) | Task 16 |

Remaining explicit in-task verification flags (each is part of its owning task's own completion
criteria, not deferred silently): Task 5's confirmation of `toFiniteWorldArray`'s exact export; Task
8's exact local-variable-name reconciliation at the `findClashes` extraction insertion point; Task 9's
target-operand-threading fix in its aggregation loop; Task 15's `_computeMarkerRadius` real signature
and `viewer.overlays.hasScene`/`THREE.Line` availability on the real r71 bundle; Task 16's real
`unload()` try/finally nesting.

## Proposed execution batches

**Batch 1 — Distance foundation** (Tasks 1-8): pure/standalone modules plus the extraction-time
validation function. Fully unit-testable without `CollisionWorld` narrow-phase wiring except Task 8's
`todo`-marked integration tests. Batch review point: confirm every Batch-1 module's signature matches
what Batch 2's wiring expects (cross-check against the table above) before starting Task 9.

**Batch 2 — Query integration** (Tasks 9-13): Task 9 first (the `resolveGeometryRecord` refactor +
linear-only end-to-end vertical slice — the highest-risk task in this plan, given it must both prove a
refactor of existing composed-mode code is behavior-identical AND wire an entirely new mode on top of
it), Task 10 second (TLAS, depends on Task 9's orchestration), Task 11 third (budget, depends on the
candidates array existing), Task 12 fourth (statistics audit), Task 13 fifth (17-fixture coverage
audit, closing the batch). Batch review point: `npm test` full-suite green, all 17 fixtures genuinely
covered, before starting Batch 3.

**Batch 3 — Viewer UX** (Tasks 14-16): Task 14 (action) → Task 15 (visualization) → Task 16
(lifecycle). Batch review point: `test/ClashFinderExtension.softClash.test.mjs` fully green, existing
`test/ClashFinderExtension.test.mjs` (Hard Clash) unchanged and still green, before Batch 4.

**Batch 4 — Acceptance/performance/closeout** (Tasks 17-19): Task 17 and Task 18 can run in either
order or in parallel against the real fixture; Task 19 (docs) is strictly last.

## Acceptance strategy

- **Unit/regression tier (Batches 1-2):** all 17 correctness fixtures, `npm test` full suite green,
  zero regressions to the existing 3 modes' behavior or statistics — including Task 9's own refactor
  regression proof (Step 2).
- **Viewer-integration tier (Batch 3):** `test/ClashFinderExtension.softClash.test.mjs` green against
  mocked Viewer/world scaffolding.
- **Live acceptance tier (Task 17):** the known-negative and (now mechanism-proven) Hard-Clash-exclusion
  assertions must always pass; a positive near-miss case is preferred but not required.

## Performance-gate strategy

Task 18's `run-gate-m3.mjs` measures and reports 7 dimensions with no presumed numeric pass/fail
threshold except an explicit go/no-go/caution/not-exercised disposition for worst single-call
`clearanceQuery` span, sourced from real production `reportSpan` instrumentation Task 9 adds. A
caution, no-go, or not-exercised result does not block this plan's completion — it is a required,
honest finding that feeds `maxClearanceNarrowPhasePairs`/`DEFAULT_CLEARANCE`'s eventual real tuning.

## Final M3 completion criteria

- All 19 tasks' individual completion criteria met.
- `npm test` (full suite) green with zero regressions to `surface-intersection`/`containment`/
  `volume-overlap` — including proof that Task 9's `resolveGeometryRecord` extraction and Task 6's
  additive `conclusive` field changed no existing observable behavior.
- All 17 required correctness fixtures genuinely covered (Task 13's audit table accurate).
- `mode:'clearance'` fully functional under both `broadPhase:'linear'` and `broadPhase:'tlas'`, with
  proven parity (fixture 11), correct placement-invalidation behavior (fixture 12), and correct
  behavior under unequal source/target scale (fixture 16b, the Critical #2 regression).
- The tri-state Hard-Clash precheck never collapses to boolean anywhere in the shipped code, and reads
  `volumeOverlapQuery`'s authoritative `conclusive` field rather than a diagnostic-string allowlist.
- The clearance dbId-aggregation key is epoch-qualified, never modelId-qualified, everywhere it appears.
- `Find Soft Clashes` is a real, independently invocable Viewer action with its own validated default
  clearance (validated before any registration), its own action token, its own visualization, and the
  full existing M2.1 lifecycle discipline applied to it with proven mutual independence from Hard Clash.
- `test/acceptance/clash-finder.acceptance.mjs`'s extended Soft Clash assertions pass against the real
  federated fixture, including the mechanism-specific `clearanceHardClashExclusions` proof.
- `test/performance/run-gate-m3.mjs` has been run once against the real federated fixture, using real
  production span instrumentation, and produced a real, reported single-call-span disposition — never
  a false GO from an empty span set.
- `collision/README.md` and `CHANGELOG.md` accurately document the shipped M3 surface using real
  measured numbers.

**Ready for execution**
