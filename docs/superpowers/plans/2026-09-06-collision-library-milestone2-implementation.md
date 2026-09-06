# Collision Library Milestone-2 (Federated Clash Finder) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the already-accepted M1 collision library so a user can select one element in the
APS Viewer, right-click **Find Clashes**, and get every Hard Clash (`volume-overlap`) between that
element and any other element across all currently loaded Viewer models — same-model and federated
alike — with a new TLAS broad-phase layer accelerating candidate discovery above M1's unchanged BLAS
and narrow phase, and with explicit, caller-controlled support for model-alignment placement changes.

**Architecture:** A per-`loadEpoch` `CollisionInstanceBVH` (a subclass of the already-vendored,
generic `three-mesh-bvh@0.9.14` `BVH` base class) is built from a new epoch-scoped placement index
(`_placementByEpoch`) and cached/lifecycle-managed by a new `TlasCache` that mirrors
`GeometryRegistry`'s already-accepted lazy-build/single-flight/eviction pattern. Cross-model identity
rides entirely on the existing global, monotonic `loadEpoch` — no change to `GeometryIdentity`,
`GeometryRegistry`, or the BLAS layer. `findClashes` gains a `targets` array operand (with an
explicit whole-model scope), a `broadPhase` option defaulting per-shape to preserve exact M1 behavior
for every existing caller, and an additive `model` reference per result operand. The existing linear
M1 broad phase is generalized to run across multiple `(sourceEpoch, targetEpoch)` pairs and remains
the permanent correctness oracle every differential fixture checks the TLAS path against.

**Tech Stack:** Node.js (`"type": "module"`), `node:test` + `node:assert/strict`, `three@0.185.1`,
vendored `three-mesh-bvh@0.9.14` (`node_modules/three-mesh-bvh`, mirrored via
`scripts/sync-vendor.mjs`), Playwright for acceptance/performance-gate automation, APS Viewer
(`@types/forge-viewer`, `env: 'AutodeskProduction'`).

**Spec:**
`docs/superpowers/specs/2026-09-05-collision-library-milestone2-design.md` (primary source of
truth), reconciled against
`docs/superpowers/specs/collision-library-m2-targeted-design-resolution-disposition.md` (the
model-placement-invalidation / TLAS-candidate-budget / `Statistics`-field resolutions layered on top
of the design spec — both documents together are "the spec" everywhere below). Executors read both.

Every file:line citation below was independently re-verified against the actual `main` branch during
this planning pass (not copied from the spec without reconciliation) — the spec's own citations were
found to match `main` exactly, with two exceptions called out explicitly where they occur: (1) the
app currently has **no UI path at all** for loading two models simultaneously (not just a missing
`keepCurrentModels` flag — Task 16 sizes this correctly), and (2) `three-mesh-bvh@0.9.14`'s
`Constants.js:75` (not `:74` as the spec states) is where `strategy: CENTER` is set — a one-line,
non-substantive drift, noted here and not repeated per-task.

**Revision note.** This version incorporates fixes from an independent `codex-review spec` pass
(medium effort) run against the first draft. Five Critical findings were accepted and fixed directly:
(1) `TlasCache` lacked real cancellation semantics and could resurrect a superseded or
evicted/disposed build — fixed with an explicit `released` flag and a `'superseded'` outcome that the
caller (never the cache itself) must retry with freshly-re-derived state (Task 10, consumed by Task
13's new `_getTlasEntryForEpoch`); (2) placement invalidation before an epoch's first-ever TLAS build
was silently ignored — fixed by treating "no cached entry yet" as revision `-1` in the refresh-trigger
condition (Task 13, tested in Task 11); (3) the multi-model admission preflight checked raw extraction
size instead of `admitCollisionInstances`'s real bucket-size-plus-missing-count rule and could not
actually guarantee its own stated atomicity — fixed with an explicit side-effect-free
`_preflightCollisionInstanceAdmission` helper (Task 6); (4) `ClashFinderExtension` was built but never
registered or loaded anywhere, so "Find Clashes" could never appear in a real session — fixed with
explicit registration steps in Task 16; (5) `extractAllFragments` had no defined diagnostics channel
for holes/unresolvable owners and would have needed a circular import for `CapacityExceededError` —
fixed by returning `{records, diagnostics}` and relocating `CapacityExceededError` to `errors.js`
(Tasks 5, 1). Five Important findings were also fixed: `broadPhasePairs`' counting position was
inconsistent between the linear and TLAS paths (Task 8, now matches Task 13's ordering, with an
explicit compatibility caveat rather than an overclaimed "zero behavior change"); the translation-retry
timer dropped `keepCurrentModels` on a still-translating model (Task 16); two of Task 3/4's own
prescribed tests could not pass as written against the real vendored package (`getBoundingBox`'s real
`THREE.Box3` requirement, `package.json`'s non-exported import path — both fixed); `queryBox`'s
callback naming invited a builder-position/original-index confusion, and leaf-range-emission
instrumentation was left unresolved in the highest-risk task — fixed with a renamed, split
`{onLeafRange, onCandidate}` contract (Task 3, consumed by Task 13); and the new query shape's input
validation was unspecified — fixed with an explicit table (Task 6). All three of the review's
clarifying questions are also resolved: the superseded-refresh internal-retry-vs-public-error
distinction (Task 11/13), context-menu action-result staleness under overlapping clicks (Task 15, a
monotonic action token), and the new acceptance suite's script/report-path wiring (Task 20).

## Global Constraints

- Every M1 identity/lifecycle/error-contract invariant not explicitly changed by the spec is
  preserved exactly — §16 of the design spec is the ledger; each task below restates the specific
  invariants it touches.
- `loadEpoch` stays global, monotonic, on `CollisionWorld._nextLoadEpoch`, never scoped to or reused
  for a `modelId` (`CollisionWorld.js:227`, `:319-336`) — the single axis every new cross-model
  mechanism keys off.
- `modelId` (`modelIdOf(model)`, `CollisionWorld.js:21-23`) remains diagnostic-only, never
  correctness-bearing, everywhere it appears, old or new.
- No test, fixture, or task in this plan invents Soft Clash/clearance, explode/animation/arbitrary
  per-fragment dynamic transforms, GPU/physics collision, a worker/off-main-thread rewrite, or
  Milestone-3 scope. Model-level placement changes (align/move/rotate) **are** in scope, via
  `invalidateModelPlacement` only — never inferred from a Viewer event.
- `broadPhase:'linear'` is a first-class, permanent mode, not a deprecated fallback — every
  differential fixture in Batch 6 depends on it staying byte-for-byte correct.
- No task silently truncates a result or converts a budget/capacity failure into a passing result —
  every capacity/budget ceiling throws, never truncates (`CollisionWorld.js:212-219`'s existing
  `CapacityExceededError` discipline, extended, never weakened).
- Test runner is `node:test` / `node:assert/strict`, ESM (`"type": "module"`), files named
  `*.test.mjs`, discovered by `scripts/run-tests.mjs`'s own recursive walk — every new test file in
  this plan follows that convention, no new test runner or file-naming scheme is introduced.
- Every new public surface (new error class, new `CollisionWorld` method, new `Statistics` field) is
  exported from `collision/index.js` — consumers, including `wwwroot/extensions/*`, import only from
  there, never from an implementation module directly (`collision/index.js`'s own header comment).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `collision/constants.js` | modify | add `maxTlasCandidatePairs` |
| `collision/errors.js` | modify | add `ModelPlacementChangedError` |
| `collision/index.js` | modify | export the new error, `CollisionInstanceBVH`/`TlasCache` stay internal (not part of the public surface — `CollisionWorld` is the only consumer) |
| `collision/CollisionWorld.js` | modify (heavily) | new fields (`_placementByEpoch`, `_placementRevisionByEpoch`, `_placementInvalidatedAtRevision`, `_tlasCache`); `findClashes` generalized to multi-operand; `invalidateModelPlacement`; composite multi-epoch checkpoint; TLAS traversal integration |
| `collision/viewer/ViewerModelAdapter.js` | modify | add `extractAllFragments` (new sibling primitive, `extractFragments` untouched) |
| `collision/tlas/CollisionInstanceBVH.js` | **new** | `BVH` subclass adapter: primitive buffer, root ranges, single-box stoppable query |
| `collision/tlas/TlasCache.js` | **new** | per-epoch lazy build / single-flight / revision-aware invalidation / release, mirroring `GeometryRegistry` |
| `wwwroot/extensions/ClashFinderExtension.js` | **new** | Find Clashes context-menu extension, UI glue only |
| `wwwroot/viewer.js` | modify | `loadModel` gains a `keepCurrentModels` option |
| `wwwroot/main.js` | modify | UI affordance to load a second model as-additional |
| `wwwroot/index.html` | modify | the new affordance's markup |
| `test/tlas/CollisionInstanceBVH.test.mjs` | **new** | adapter unit tests (query correctness, empty tree, reordering) |
| `test/tlas/CollisionInstanceBVH.contract.test.mjs` | **new** | vendored-`BVH`-shape pin (Task 4) |
| `test/tlas/TlasCache.test.mjs` | **new** | lazy build/single-flight/revision/release unit tests, stub builder (mirrors `test/geometry/GeometryRegistry.test.mjs`) |
| `test/viewer/ViewerModelAdapter.extractAllFragments.test.mjs` | **new** | whole-model enumeration unit tests |
| `test/CollisionWorld.findClashes.crossModel.test.mjs` | **new** | cross-model operand normalization, provenance, dedup, self-exclusion, linear oracle |
| `test/CollisionWorld.placementInvalidation.test.mjs` | **new** | `invalidateModelPlacement`, refresh, self-invalidation-avoidance |
| `test/CollisionWorld.tlasTraversal.test.mjs` | **new** | TLAS-path traversal, budget, retest, stats inequality chain |
| `test/CollisionWorld.findClashes.test.mjs` | modify | remove/replace the `'cross-model query rejects'` test (`:258-270`) |
| `test/acceptance/clash-finder.acceptance.mjs` | **new** | federated live acceptance, mirrors `test/acceptance/room-locator.acceptance.mjs` |
| `test/performance/run-gate-m2.mjs` | **new** | M2 performance gate, mirrors `test/performance/run-gate.mjs` |
| `collision/README.md` | modify | document `targets`/`broadPhase`, new `Statistics` fields, `invalidateModelPlacement` |
| `package.json` | modify | new `test:acceptance:clash-finder` script (Task 20) |

**Note on `collision/errors.js`:** `CapacityExceededError` moves here from `CollisionWorld.js` in
Task 1 (fixing a circular-import risk `codex-review` found — `ViewerModelAdapter.js`'s new Task 5
capacity check needs it, but `CollisionWorld.js` already imports `extractFragments` *from*
`ViewerModelAdapter.js`), re-exported unchanged from both `CollisionWorld.js` and
`collision/index.js`.

---

# Batch 1 — Foundation, Viewer evidence, TLAS adapter

## Task 1: M2 constants/errors/statistics extensions

**Files:**
- Modify: `collision/constants.js`
- Modify: `collision/errors.js`
- Modify: `collision/CollisionWorld.js:191-206` (`emptyStatistics`), `:212-219` (`CapacityExceededError`)
- Modify: `collision/index.js`
- Test: `test/constants.tlas.test.mjs`, `test/errors.modelPlacementChanged.test.mjs`,
  `test/CollisionWorld.emptyStatistics.m2.test.mjs`

**Interfaces:**
- Produces: `maxTlasCandidatePairs` (constant), `ModelPlacementChangedError` (class, exported from
  `collision/index.js`), `emptyStatistics()` returning the 9 new fields (always `0`),
  `CapacityExceededError` accepting `kind: 'tlas-candidate-budget'` with a generalized message.

- [ ] **Step 1: Add `maxTlasCandidatePairs` to `collision/constants.js`**

  Append after `maxCollisionInstancesPerEpoch` (`constants.js:58`):

  ```js
  // Bounds primitive-candidate expansion under broadPhase:'tlas' (design spec §9.3). Unlike
  // maxBroadPhaseInstancePairs, this cannot be precomputed as a Cartesian product -- traversal
  // cost is not known until it runs -- so it is checked incrementally, not as an upfront precheck.
  // Provisional: revise per the M2 performance gate (Task 21), same posture constants.js already
  // documents for maxCollisionInstancesPerEpoch above.
  export const maxTlasCandidatePairs = 200_000;
  ```

- [ ] **Step 2: Write the failing constant test**

  ```js
  // test/constants.tlas.test.mjs
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { maxTlasCandidatePairs } from '../collision/constants.js';

  test('maxTlasCandidatePairs is a positive integer', () => {
    assert.equal(Number.isInteger(maxTlasCandidatePairs), true);
    assert.ok(maxTlasCandidatePairs > 0);
  });
  ```

  Run: `node --test test/constants.tlas.test.mjs` — expect FAIL (`maxTlasCandidatePairs` undefined)
  before Step 1, PASS after.

- [ ] **Step 3: Add `ModelPlacementChangedError` to `collision/errors.js`**

  ```js
  /**
   * Thrown when a cross-model query's mid-query placement-revalidation (design spec §9.2 point 8)
   * detects that a captured model's placement revision changed for a reason the query did not
   * itself cause (§6.7.5). Distinct from ModelEvictedError: the model is still live, but the input
   * geometry may have moved out from under this in-flight query.
   */
  export class ModelPlacementChangedError extends Error {
    constructor({ modelId, loadEpoch, expectedRevision, actualRevision } = {}) {
      super(
        `Model ${modelId} (loadEpoch ${loadEpoch}) placement changed mid-query: ` +
        `expected revision ${expectedRevision}, observed ${actualRevision}`,
      );
      this.name = 'ModelPlacementChangedError';
      this.modelId = modelId;
      this.loadEpoch = loadEpoch;
      this.expectedRevision = expectedRevision;
      this.actualRevision = actualRevision;
    }
  }
  ```

- [ ] **Step 4: Export it from `collision/index.js`**

  ```js
  export {
    WorldDisposedError, ModelEvictedError, RenderProxyUnavailableError, ObjectTreeUnavailableError,
    ModelPlacementChangedError,
  } from './errors.js';
  ```

- [ ] **Step 5: Write the failing error test, then verify it passes**

  ```js
  // test/errors.modelPlacementChanged.test.mjs
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { ModelPlacementChangedError } from '../collision/index.js';

  test('ModelPlacementChangedError carries modelId/loadEpoch/expectedRevision/actualRevision', () => {
    const err = new ModelPlacementChangedError({
      modelId: 7, loadEpoch: 3, expectedRevision: 2, actualRevision: 4,
    });
    assert.equal(err.name, 'ModelPlacementChangedError');
    assert.equal(err.modelId, 7);
    assert.equal(err.loadEpoch, 3);
    assert.equal(err.expectedRevision, 2);
    assert.equal(err.actualRevision, 4);
    assert.ok(err instanceof Error);
  });
  ```

- [ ] **Step 6: Extend `emptyStatistics()` (`CollisionWorld.js:191-206`) with the 9 additive fields**

  ```js
  function emptyStatistics() {
    return {
      broadPhasePairs: 0,
      narrowPhasePairs: 0,
      blasBuilt: 0,
      blasCacheHits: 0,
      broadPhaseMs: 0,
      narrowPhaseMs: 0,
      totalMs: 0,
      diagnostics: [],
      // --- M2 additive fields (design spec §7.5.1), always present, default 0, never
      // conditionally omitted -- including for broadPhase:'linear' calls.
      tlasLeafRangeEmissions: 0,
      tlasPrimitiveCandidatePairs: 0,
      tlasExactRetestSurvivors: 0,
      tlasNarrowPhaseInputPairs: 0,
      tlasBuilds: 0,
      tlasCacheHits: 0,
      tlasSharedBuildWaits: 0,
      tlasBuildMs: 0,
      tlasQueryMs: 0,
    };
  }
  ```

- [ ] **Step 7: Relocate `CapacityExceededError` to `collision/errors.js` and generalize its message.**

  **Fixed after `codex-review` (Critical #5):** Task 5 (`extractAllFragments`) must throw
  `CapacityExceededError` for its own capacity check, but `ViewerModelAdapter.js` cannot import it
  from `CollisionWorld.js` without creating a circular import (`CollisionWorld.js:12` already imports
  `extractFragments` *from* `ViewerModelAdapter.js`). Move the class to `errors.js`, alongside the
  other lifecycle-adjacent errors, and re-export it from both `CollisionWorld.js` (so no existing
  `import { CapacityExceededError } from './CollisionWorld.js'` call site breaks, and `instanceof`
  checks anywhere in the M1 test suite keep working — re-exporting the exact same class object, never
  a redeclared duplicate) and `collision/index.js` (whose own import line is unaffected, since it
  already imports from `CollisionWorld.js`, which now merely re-exports).

  ```js
  // collision/errors.js — add alongside the existing four error classes.
  const CAPACITY_EXCEEDED_MESSAGES = {
    'call-wide-unique-fragment-precheck': (kind) => `CollisionInstance admission rejected (${kind})`,
    'bucket-capacity': (kind) => `CollisionInstance admission rejected (${kind})`,
    'tlas-candidate-budget': () => 'TLAS candidate-expansion budget exceeded for this findClashes call',
    'whole-model-enumeration': (kind) => `CollisionInstance admission rejected (${kind})`, // Task 5's own kind, added here
  };

  export class CapacityExceededError extends Error {
    constructor(kind, details) {
      const messageFn = CAPACITY_EXCEEDED_MESSAGES[kind]
        ?? ((k) => `CollisionInstance admission rejected (${k})`); // unknown kind: preserve old text
      super(messageFn(kind));
      this.name = 'CapacityExceededError';
      this.kind = kind;
      Object.assign(this, details);
    }
  }
  ```

  ```js
  // collision/CollisionWorld.js — replace the in-file class declaration (:212-219) with a re-export,
  // and update the existing `import ... from './errors.js'` line at the top of the file to include it:
  import {
    WorldDisposedError, ModelEvictedError, RenderProxyUnavailableError, ObjectTreeUnavailableError,
    CapacityExceededError,
  } from './errors.js';
  export { CapacityExceededError }; // re-exported, not redeclared -- every existing `instanceof
                                     // CapacityExceededError` check anywhere in the codebase still
                                     // passes, since it is the SAME class object.
  ```

  This is a relocation plus a message-text generalization — `{name, kind, ...details}` structural
  shape is unchanged, so no existing consumer depending on that shape is affected (spec §9.3.2's own
  framing). `collision/index.js`'s own `export { CollisionWorld, CapacityExceededError } from
  './CollisionWorld.js';` line needs no change at all — it now re-exports a re-export, transparently.

- [ ] **Step 8: Write/run tests for Steps 6-7, then commit**

  ```js
  // test/CollisionWorld.emptyStatistics.m2.test.mjs — exercise emptyStatistics() indirectly via a
  // real findClashes call (emptyStatistics is not exported; assert on the returned statistics shape).
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { CollisionWorld, CapacityExceededError } from '../collision/index.js';
  import { buildMockModel } from './fixtures/mockInstanceTree.mjs';

  test('findClashes result.statistics always carries the 9 new TLAS fields, defaulted 0', async () => {
    const { model } = buildMockModel([{ dbId: 1, fragments: [] }], new Map());
    const world = await CollisionWorld.fromViewer(null, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' });
    const { statistics } = await world.findClashes({
      source: { model, dbIds: [] }, target: { model, dbIds: [] }, mode: 'surface-intersection', groupBy: 'dbId',
    });
    for (const field of [
      'tlasLeafRangeEmissions', 'tlasPrimitiveCandidatePairs', 'tlasExactRetestSurvivors',
      'tlasNarrowPhaseInputPairs', 'tlasBuilds', 'tlasCacheHits', 'tlasSharedBuildWaits',
      'tlasBuildMs', 'tlasQueryMs',
    ]) {
      assert.equal(statistics[field], 0, `${field} must default to 0`);
    }
  });

  test("CapacityExceededError('tlas-candidate-budget') carries a non-admission-worded message", () => {
    const err = new CapacityExceededError('tlas-candidate-budget', { limit: 10, completed: 10, attempted: 11 });
    assert.equal(err.kind, 'tlas-candidate-budget');
    assert.doesNotMatch(err.message, /admission rejected/);
  });

  test('existing kinds keep their exact original message text (no regression)', () => {
    const err = new CapacityExceededError('bucket-capacity', { loadEpoch: 1 });
    assert.equal(err.message, 'CollisionInstance admission rejected (bucket-capacity)');
  });
  ```

  Run the full suite (`npm test`) — confirm zero regressions in the existing `CapacityExceededError`
  message-text assertions elsewhere in the M1 test suite before committing.

  ```bash
  git add collision/constants.js collision/errors.js collision/index.js collision/CollisionWorld.js \
    test/constants.tlas.test.mjs test/errors.modelPlacementChanged.test.mjs \
    test/CollisionWorld.emptyStatistics.m2.test.mjs
  git commit -m "M2: add maxTlasCandidatePairs, ModelPlacementChangedError, TLAS Statistics fields"
  ```

**Completion criteria:** `npm test` passes with zero regressions; `emptyStatistics()` always returns
all 9 new fields defaulted `0`; `CapacityExceededError('tlas-candidate-budget', ...)` throws with a
message that does not say "admission rejected"; every existing `CapacityExceededError` kind's message
text is unchanged.

**Protected invariants:** `CapacityExceededError`'s `{name, kind, ...details}` shape is unchanged;
existing kinds' message text is byte-for-byte unchanged; no existing `Statistics` field is renamed or
removed.

**Viewer/API evidence verification:** None — this task touches no Viewer API.

---

## Task 2: Viewer-API evidence verification for whole-model fragment enumeration (no code)

**Files:** None modified. Produces a short findings note consumed by Task 5.
- Write: `docs/superpowers/specs/m2-extractAllFragments-viewer-evidence.md`

**Interfaces:**
- Produces: the confirmed authoritative accessor for (a) enumerating every fragment a `Model` holds
  and (b) resolving a fragment's owning dbId with no starting dbId, for Task 5 to implement against.

- [ ] **Step 1: Invoke `aps-viewer-api-evidence-investigation`** to confirm, against a real Viewer
  session (or the pinned Viewer source/bundle if a live session is unavailable in this environment):
  - The authoritative fragment-count/enumeration accessor for a whole model. Candidate per the spec
    (§3.3): `model.getFragmentList()`'s own fragment count and per-index iteration (e.g.
    `fragList.getCount()` or equivalent, iterating `0..count-1`). Confirm the exact method name(s)
    and whether an index in that range can be a "hole" (no live fragment) that must be skipped with a
    diagnostic rather than treated as a malformed record.
  - The authoritative per-fragment owning-dbId reverse lookup with no starting requested dbId to walk
    from. Candidate per the spec: `instanceTree.findNodeForFragId(fragId)` or equivalent. Confirm the
    exact method name, its return shape (a dbId, or something requiring further resolution), and its
    behavior for a fragment with no resolvable owning node.
  - Whether a hidden/culled fragment appears in the enumeration at all, and if so, whether
    `getWorldMatrix`/`getWorldBounds` (the same primitives `ViewerModelAdapter.js:37-48` already use)
    behave normally for it or require special-casing.

- [ ] **Step 2: Record the findings** in `docs/superpowers/specs/m2-extractAllFragments-viewer-evidence.md`:
  exact method names/signatures, hole/culled/unresolvable-dbId behavior, and any discrepancy between
  the investigation's findings and the spec's own candidate accessors (§3.3). If a discrepancy is
  found, flag it explicitly — Task 5's implementation follows the verified evidence, not the spec's
  unconfirmed candidate names.

**Completion criteria:** The findings note exists, cites concrete evidence (source file/line, doc
URL, or a reproducible Viewer-console check) for both accessors, and explicitly states the
hole/culled/unresolvable-owner behavior Task 5 must handle.

**Protected invariants:** None (research-only task, no code changes).

**Viewer/API evidence verification required:** This task *is* the verification step Task 5 depends
on — do not begin Task 5 until this note exists and is reviewed.

---

## Task 3: `CollisionInstanceBVH` adapter over vendored `BVH`

**Files:**
- Create: `collision/tlas/CollisionInstanceBVH.js`
- Test: `test/tlas/CollisionInstanceBVH.test.mjs`

**Prerequisite tasks:** None (independent of Tasks 1-2; may run in parallel with them).

**Interfaces:**
- Consumes: `three-mesh-bvh`'s exported `BVH` (`node_modules/three-mesh-bvh/src/core/BVH.js`,
  confirmed exported from the public barrel, `src/index.js:1`).
- Produces:
  ```js
  class CollisionInstanceBVH extends BVH {
    constructor(records) // records: Array<{loadEpoch, fragmentId, ownerDbId, modelId, worldBounds}>
    queryBox(min, max, { onLeafRange, onCandidate }) // returns {truncated: boolean}; see Step 4
    recordAt(builderPositionIndex) // -> the original record; the ONLY valid way to resolve one
  }
  ```
  consumed by Task 13's traversal loop and Task 4's contract tests.

  **Fixed after `codex-review` (Important #4):** the first draft named the query callback
  `onCandidateOriginalIndex` and passed it the raw `shapecast` leaf-range index — which is a
  **builder-position** index (a position in the reordered `primitiveBuffer`), not yet the "original"
  index into `records`. The misleading name invited exactly the bug the review flagged: an
  implementer could reasonably treat the callback's own argument as already-resolved and either skip
  `recordAt` (misusing a builder-position index as if it indexed `records` directly) or double-map it
  through some second translation. The corrected contract makes this unambiguous: `queryBox`'s
  callbacks only ever receive a **builder-position index**, `recordAt(builderPositionIndex)` is
  documented as the single, only legitimate way to resolve one, and there is no other spelling of
  "original index" anywhere in this contract. The callback is also split into two, resolving the
  Important #4 finding's second half (undefined leaf-range-emission instrumentation): `onLeafRange`
  fires once per `intersectsRange` invocation, **before** any per-primitive expansion — this is
  exactly the point Task 13's `tlasLeafRangeEmissions` statistic increments (spec §7.5.1, stage 1);
  `onCandidate` fires once per expanded primitive within that range — exactly `tlasPrimitiveCandidatePairs`'
  stage 2. Splitting them here means Task 13 never has to reconstruct stage-1 counts from stage-2 data.

**Implementation steps:**

- [ ] **Step 1: Write the failing adapter test — construction over a small synthetic set**

  ```js
  // test/tlas/CollisionInstanceBVH.test.mjs
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { Box3 } from 'three';
  import { CollisionInstanceBVH } from '../../collision/tlas/CollisionInstanceBVH.js';

  const rec = (fragmentId, [minX, minY, minZ], [maxX, maxY, maxZ], ownerDbId = fragmentId) => ({
    loadEpoch: 1, fragmentId, ownerDbId, modelId: 'm', worldBounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
  });

  test('constructs over N records with no throw, and getBoundingBox covers all of them', () => {
    // Fixed after codex-review (Important #3): BVH.prototype.getBoundingBox requires a REAL
    // THREE.Box3 (it calls .makeEmpty()/.union() on the target internally) -- a plain
    // {min:[...],max:[...]} object throws `target.makeEmpty is not a function`.
    const records = [rec(1, [0, 0, 0], [1, 1, 1]), rec(2, [10, 10, 10], [11, 11, 11])];
    const bvh = new CollisionInstanceBVH(records);
    const box = new Box3();
    bvh.getBoundingBox(box);
    assert.ok(box.min.x <= 0 && box.max.x >= 11);
  });

  test('empty record set builds a well-defined, queryable-but-always-empty tree', () => {
    const bvh = new CollisionInstanceBVH([]);
    const seen = [];
    const { truncated } = bvh.queryBox([-1, -1, -1], [1, 1, 1], { onCandidate: (i) => seen.push(i) });
    assert.deepEqual(seen, []);
    assert.equal(truncated, false);
  });

  test('queryBox against a box overlapping only record 2 resolves back to record 2 via recordAt', () => {
    const records = [rec(1, [0, 0, 0], [1, 1, 1]), rec(2, [10, 10, 10], [11, 11, 11])];
    const bvh = new CollisionInstanceBVH(records);
    const seen = [];
    bvh.queryBox([9.5, 9.5, 9.5], [12, 12, 12], {
      onCandidate: (builderPositionIndex) => seen.push(bvh.recordAt(builderPositionIndex).fragmentId),
    });
    assert.deepEqual(seen, [2]);
  });

  test('a query box overlapping neither record calls onCandidate zero times', () => {
    const records = [rec(1, [0, 0, 0], [1, 1, 1])];
    const bvh = new CollisionInstanceBVH(records);
    const seen = [];
    bvh.queryBox([100, 100, 100], [101, 101, 101], { onCandidate: (i) => seen.push(i) });
    assert.deepEqual(seen, []);
  });

  test('a query box overlapping both records resolves both, exactly once each', () => {
    const records = [rec(1, [0, 0, 0], [2, 2, 2]), rec(2, [1, 1, 1], [3, 3, 3])];
    const bvh = new CollisionInstanceBVH(records);
    const seen = [];
    bvh.queryBox([0.5, 0.5, 0.5], [1.5, 1.5, 1.5], {
      onCandidate: (i) => seen.push(bvh.recordAt(i).fragmentId),
    });
    seen.sort();
    assert.deepEqual(seen, [1, 2]);
  });

  test('a forced-reordering fixture proves recordAt resolves the BUILDER-position index, never the insertion-order index', () => {
    // Construct enough spatially-separated records that the packed-tree builder's own partitioning
    // (sortUtils.js's `partition`) provably reorders primitiveBuffer away from insertion order (a
    // small, clustered 2-3 record set may happen to stay in order and would not catch a regression
    // where an implementer wires onCandidate's argument directly into `records[i]`, bypassing
    // recordAt entirely). Assert every resolved fragmentId, via recordAt, matches the record whose
    // OWN worldBounds actually overlaps the query box -- not the record at that same array index.
    const records = [
      rec(100, [50, 50, 50], [51, 51, 51]),       // far away
      rec(200, [0, 0, 0], [1, 1, 1]),              // query target
      rec(300, [-50, -50, -50], [-49, -49, -49]),  // far away, opposite direction
    ];
    const bvh = new CollisionInstanceBVH(records);
    const seen = [];
    bvh.queryBox([-0.5, -0.5, -0.5], [1.5, 1.5, 1.5], {
      onCandidate: (builderPositionIndex) => seen.push(bvh.recordAt(builderPositionIndex).fragmentId),
    });
    assert.deepEqual(seen, [200]); // must be 200 regardless of where the builder actually placed it
  });

  test('queryBox reports leaf-range emissions via onLeafRange, separately from per-primitive onCandidate', () => {
    // Multiple co-located records force a single leaf covering more than one primitive -- assert
    // onLeafRange fires fewer times than onCandidate for such a fixture (stage 1 <= stage 2, spec
    // §7.5.1's own tlasLeafRangeEmissions/tlasPrimitiveCandidatePairs distinction).
    const records = [rec(1, [0, 0, 0], [1, 1, 1]), rec(2, [0, 0, 0], [1, 1, 1]), rec(3, [0, 0, 0], [1, 1, 1])];
    const bvh = new CollisionInstanceBVH(records);
    let leafRanges = 0;
    let candidates = 0;
    bvh.queryBox([0, 0, 0], [1, 1, 1], {
      onLeafRange: () => { leafRanges++; },
      onCandidate: () => { candidates++; },
    });
    assert.equal(candidates, 3);
    assert.ok(leafRanges >= 1 && leafRanges <= candidates);
  });

  test('queryBox stops early and reports truncated when onCandidate returns "stop"', () => {
    const records = [rec(1, [0, 0, 0], [1, 1, 1]), rec(2, [0, 0, 0], [1, 1, 1]), rec(3, [0, 0, 0], [1, 1, 1])];
    const bvh = new CollisionInstanceBVH(records);
    let calls = 0;
    const { truncated } = bvh.queryBox([0, 0, 0], [1, 1, 1], {
      onCandidate: () => { calls++; return calls >= 2 ? 'stop' : undefined; },
    });
    assert.equal(truncated, true);
    assert.equal(calls, 2);
  });

  test('a callback exception during queryBox is contained: traversal cleans up, then rethrows after returning', () => {
    const records = [rec(1, [0, 0, 0], [1, 1, 1])];
    const bvh = new CollisionInstanceBVH(records);
    assert.throws(() => {
      bvh.queryBox([0, 0, 0], [1, 1, 1], { onCandidate: () => { throw new Error('boom'); } });
    }, /boom/);
    // A second, independent query on the SAME instance must still work -- proves module-global
    // traversal state (bvhcast's own `_active` hazard, spec §7.1) was not left corrupted.
    let ran = false;
    bvh.queryBox([0, 0, 0], [1, 1, 1], { onCandidate: () => { ran = true; } });
    assert.equal(ran, true);
  });
  ```

- [ ] **Step 2: Run the tests, confirm they FAIL** (module does not exist yet).

  Run: `node --test test/tlas/CollisionInstanceBVH.test.mjs` — expect `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement `CollisionInstanceBVH`'s constructor, `getRootRanges`, `writePrimitiveBounds`**

  Confirmed against `node_modules/three-mesh-bvh/src/core/BVH.js` and
  `src/core/build/buildTree.js:123-152`: the base `BVH` constructor sets `this._roots = null`,
  `this.primitiveBuffer = null`, `this.primitiveBufferStride = null`
  (`BVH.js` constructor). `init(options)` calls `buildPackedTree(this, options)`, which calls
  `this.getRootRanges(options.range)` first, then `this.computePrimitiveBounds(...)` (already
  implemented on the base class via `writePrimitiveBounds`, per-primitive), then partitions
  `this.primitiveBuffer`/`this.primitiveBufferStride` in place (`sortUtils.js`'s `partition`) as it
  builds the packed tree. A subclass overriding only `writePrimitiveBounds` and calling `super.init()`
  fails at construction if `getRootRanges` is not also overridden — the base class's own default
  throws `'BVH: getRootRanges() not implemented'`.

  ```js
  // collision/tlas/CollisionInstanceBVH.js
  import { BVH } from 'three-mesh-bvh';

  // One CollisionInstanceBVH per loadEpoch (design spec §5.3, §6.2). `records` is this epoch's
  // full admitted-instance placement list at build time -- immutable once passed in; a rebuild
  // constructs a brand-new instance rather than mutating an existing one (spec §6.4).
  export class CollisionInstanceBVH extends BVH {
    constructor(records) {
      super();
      this._records = records;
      // primitiveBuffer holds each primitive's ORIGINAL index into `records`, stride 1. The packed-
      // tree builder reorders this buffer in place during construction (sortUtils.js's `partition`
      // swaps stride-wide slices) -- after init() runs, primitiveBuffer[i] is the original index for
      // builder-position i. This is the "reordered-leaf-to-original-record mapping" spec §5.2
      // requires the adapter to retain.
      this.primitiveBuffer = new Uint32Array(records.length);
      for (let i = 0; i < records.length; i++) this.primitiveBuffer[i] = i;
      this.primitiveBufferStride = 1;
      // Explicit build-strategy configuration (spec §5.2: "must be passed explicitly rather than
      // relying on whatever the package's own default happens to be"), even though CENTER/10 today
      // matches the package default (Constants.js:75,77) -- pinning it here means a future
      // sync-vendor.mjs bump changing the *package's* default cannot silently change ours.
      const { CENTER } = BVH.Constants ?? {}; // see Task 4's contract test for the actual import path
      this.init({ strategy: 0 /* CENTER, pinned numerically -- see Task 4 for the named-constant import */, targetLeafSize: 10 });
    }

    getRootRanges() {
      // One root range covering every admitted primitive for this epoch -- no multi-root splitting
      // needed for one epoch's flat instance list (spec §5.2).
      return [{ offset: 0, count: this._records.length }];
    }

    writePrimitiveBounds(i, buffer, writeOffset) {
      const originalIndex = this.primitiveBuffer[i];
      const { min, max } = this._records[originalIndex].worldBounds;
      buffer[writeOffset + 0] = min[0]; buffer[writeOffset + 1] = min[1]; buffer[writeOffset + 2] = min[2];
      buffer[writeOffset + 3] = max[0]; buffer[writeOffset + 4] = max[1]; buffer[writeOffset + 5] = max[2];
    }

    // Resolves a builder-position primitive index (as reported by an intersectsRange leaf callback)
    // back to its original record.
    recordAt(builderPositionIndex) {
      return this._records[this.primitiveBuffer[builderPositionIndex]];
    }

    // See Step 4.
    queryBox(min, max, { onLeafRange, onCandidate }) { /* Step 4 */ }
  }
  ```

  Resolve the `BVH.Constants`/`CENTER` import placeholder concretely in Step 5 once Task 4's contract
  test confirms the exact export path (`Constants.js` exports `CENTER`/`AVERAGE`/`SAH` as named
  numeric exports, not a `BVH.Constants` namespace — verify and correct the import in this step
  rather than leaving the numeric literal `0` as the checked-in form).

- [ ] **Step 4: Implement `queryBox` — single-shape stoppable traversal with callback-exception containment**

  Confirmed against `node_modules/three-mesh-bvh/src/core/BVH.js:342-405` and
  `src/core/cast/shapecast.js`: `BVH.prototype.shapecast({intersectsBounds, intersectsRange})` is
  defined directly on the base class (not `MeshBVH`-only). `intersectsRange(offset, count, contained,
  depth, nodeIndex, box)` fires once per matched leaf/range; returning `true` from it stops the
  **entire** traversal early (confirmed by tracing `shapecastTraverse`'s `c1StopTraversal`/
  `c2StopTraversal` propagation, `shapecast.js`) — this is the exact "traversal API's own normal
  early-termination return-value convention" §9.3.3 requires the budget check to use instead of
  throwing from inside the callback. `intersectsBounds` never needs to return three-mesh-bvh's
  `CONTAINED` sentinel for this adapter — a plain boolean AABB-overlap test is sufficient (`CONTAINED`
  is a traversal-cost optimization neither correctness nor this contract depends on).

  ```js
    // { onLeafRange, onCandidate }: onLeafRange(offset, count) fires once per matched leaf, BEFORE
    // expansion (spec §7.5.1 stage-1 tlasLeafRangeEmissions); onCandidate(builderPositionIndex) fires
    // once per expanded primitive (stage-2 tlasPrimitiveCandidatePairs). Both callback ARGUMENTS to
    // onCandidate are builder-position indices -- recordAt(builderPositionIndex) is the only
    // legitimate way to resolve one to its original record (spec §5.2's "reordered-leaf-to-original-
    // record mapping" requirement; codex-review Important #4's naming fix).
    queryBox(min, max, { onLeafRange, onCandidate }) {
      let truncated = false;
      let pendingError = null;
      const boxIntersects = (bMin, bMax) =>
        bMin[0] <= max[0] && bMax[0] >= min[0]
        && bMin[1] <= max[1] && bMax[1] >= min[1]
        && bMin[2] <= max[2] && bMax[2] >= min[2];

      try {
        this.shapecast({
          intersectsBounds: (box) => boxIntersects([box.min.x, box.min.y, box.min.z], [box.max.x, box.max.y, box.max.z]),
          intersectsRange: (offset, count) => {
            onLeafRange?.(offset, count);
            for (let i = offset; i < offset + count; i++) {
              let signal;
              try {
                signal = onCandidate?.(i);
              } catch (err) {
                // Callback-exception containment (spec §5.2, §9.3.3): record, do not let it escape
                // into the vendored traversal's own non-try/finally-guarded call stack.
                pendingError = err;
                truncated = true;
                return true; // stop this range, and the whole traversal, immediately
              }
              if (signal === 'stop') { truncated = true; return true; }
            }
            return false; // keep traversing -- normal candidate collection wants every match
          },
        });
      } finally {
        // Traversal has now fully returned and cleaned up (shapecast.js's own boxPool release runs
        // regardless of how shapecastTraverse exited) -- only NOW is it safe to rethrow.
      }
      if (pendingError) throw pendingError;
      return { truncated };
    }
  ```

- [ ] **Step 5: Run the Step-1 tests, iterate until all pass**

  Run: `node --test test/tlas/CollisionInstanceBVH.test.mjs` — fix the `BVH.Constants`/`CENTER`
  import (confirm the real named export from `three-mesh-bvh`'s barrel, e.g.
  `import { BVH, CENTER } from 'three-mesh-bvh'`, adjusting the constructor's `init()` call
  accordingly) until every test passes.

- [ ] **Step 6: Commit**

  ```bash
  git add collision/tlas/CollisionInstanceBVH.js test/tlas/CollisionInstanceBVH.test.mjs
  git commit -m "M2: add CollisionInstanceBVH adapter over vendored three-mesh-bvh BVH base class"
  ```

**Completion criteria:** All Step-1 tests pass; `queryBox` never throws from inside a
`shapecast` callback (verified by the "callback exception is contained" test); an empty record set
constructs and queries without throwing; a second query after a thrown-callback query still works
(module-global traversal state was not corrupted).

**Protected invariants:** No custom BVH is implemented — `CollisionInstanceBVH` only overrides the
documented required surface (`getRootRanges`, `writePrimitiveBounds`) and calls the base class's own
`init`/`shapecast`/`getBoundingBox`. `queryBox` never throws `CapacityExceededError` (or any
budget-specific error) itself — Task 13 owns that; this adapter only reports `truncated`/re-throws a
genuine callback exception.

**Viewer/API evidence verification required:** None (pure library-internal adapter, no Viewer API
surface).

---

## Task 4: TLAS runtime-contract tests pinning vendored `three-mesh-bvh@0.9.14`'s shape

**Files:**
- Create: `test/tlas/CollisionInstanceBVH.contract.test.mjs`

**Prerequisite tasks:** Task 3 (needs `CollisionInstanceBVH` to exist so its own behavior can be
contrasted with the base class's raw defaults).

**Interfaces:** None new — this task adds no production code, only tests that fail loudly if a future
`scripts/sync-vendor.mjs` bump changes `three-mesh-bvh`'s internal-but-shipped `BVH` contract.

**Implementation steps:**

- [ ] **Step 1: Write and run the contract tests** (these should PASS immediately against the current
  vendored `0.9.14` — this task pins current behavior, it does not add new behavior):

  ```js
  // test/tlas/CollisionInstanceBVH.contract.test.mjs
  //
  // Pins the exact vendored three-mesh-bvh@0.9.14 contract CollisionInstanceBVH (Task 3) depends on
  // but that is NOT individually typed in the package's own .d.ts (design spec §5.2). If a future
  // `npm run build:vendor` bump changes any of these, this file fails loudly instead of silently.
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { readFileSync } from 'node:fs';
  import { fileURLToPath } from 'node:url';
  import { BVH } from 'three-mesh-bvh';

  test('vendored three-mesh-bvh is pinned at exactly 0.9.14', () => {
    // Fixed after codex-review (Important #3): `three-mesh-bvh`'s package.json is not listed in its
    // own "exports" map, so `import ... from 'three-mesh-bvh/package.json'` throws
    // ERR_PACKAGE_PATH_NOT_EXPORTED under Node's ESM resolver -- confirmed against this repo's
    // installed 0.9.14. Reading the file directly via `fs` bypasses the exports-map restriction
    // (that restriction applies only to module resolution, not raw filesystem access) and needs no
    // JSON-import assertion syntax.
    const pkgPath = fileURLToPath(new URL('../../node_modules/three-mesh-bvh/package.json', import.meta.url));
    const packageJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
    assert.equal(packageJson.version, '0.9.14');
  });

  test('BVH.prototype.getRootRanges throws before being overridden', () => {
    const bvh = new BVH();
    assert.throws(() => bvh.getRootRanges(), /getRootRanges\(\) not implemented/);
  });

  test('BVH.prototype.writePrimitiveBounds throws before being overridden', () => {
    const bvh = new BVH();
    assert.throws(() => bvh.writePrimitiveBounds(0, new Float32Array(6), 0), /writePrimitiveBounds\(\) not implemented/);
  });

  test('BVH constructor exposes primitiveBuffer/primitiveBufferStride as real, initially-null fields', () => {
    const bvh = new BVH();
    assert.equal('primitiveBuffer' in bvh, true);
    assert.equal('primitiveBufferStride' in bvh, true);
    assert.equal(bvh.primitiveBuffer, null);
  });

  test('BVH.prototype.shapecast exists directly on the base class (not only on MeshBVH)', () => {
    assert.equal(typeof BVH.prototype.shapecast, 'function');
  });

  test('BVH.prototype.init exists and calls getRootRanges internally, not lazily deferred', () => {
    class Empty extends BVH {
      getRootRanges() { throw new Error('marker-thrown-from-getRootRanges'); }
      writePrimitiveBounds() {}
    }
    assert.throws(() => new Empty().init({}), /marker-thrown-from-getRootRanges/);
  });
  ```

- [ ] **Step 2: If any assertion fails against the currently-vendored version**, stop — this means
  the earlier tasks' understanding of the contract is wrong against the actual installed package, not
  just against the spec's description of it. Re-verify against
  `node_modules/three-mesh-bvh/src/core/BVH.js` directly before proceeding to any later task.

- [ ] **Step 3: Commit**

  ```bash
  git add test/tlas/CollisionInstanceBVH.contract.test.mjs
  git commit -m "M2: pin vendored three-mesh-bvh@0.9.14 BVH contract with runtime tests"
  ```

**Completion criteria:** All contract tests pass against the currently-vendored `0.9.14`; the test
file is wired into `npm test`'s normal recursive discovery (no special runner config needed, per
`scripts/run-tests.mjs`'s own walk).

**Protected invariants:** This test file must run as part of the ordinary `npm test` suite — it is
the CI-visible tripwire the spec's §5.2 "mitigation, required as part of implementation" mandates, not
optional polish.

**Viewer/API evidence verification required:** None.

---

# Batch 2 — `extractAllFragments` and the cross-model linear vertical slice

## Task 5: Whole-model fragment enumeration (`extractAllFragments`)

**Files:**
- Modify: `collision/viewer/ViewerModelAdapter.js`
- Test: `test/viewer/ViewerModelAdapter.extractAllFragments.test.mjs`

**Prerequisite tasks:** Task 2 (Viewer-API evidence for the enumeration/reverse-lookup accessors).
Does **not** depend on Task 9 (placement index) — confirmed during planning: `ViewerModelAdapter`
returns plain extracted records and owns no `CollisionWorld` cache state; the spec places
`_placementByEpoch` writes at `CollisionWorld`'s own extraction call site (§6.1), not inside this
module.

**Interfaces:**
- Produces: `extractAllFragments(model, loadEpoch, { checkpoint, THREE }) ->
  Promise<{ records: Map<fragmentId, ExtractedFragmentRecord>, diagnostics: Array<ClashDiagnostic> }>`.
  **Fixed after `codex-review` (Critical #5):** the first draft of this task returned a bare `Map`,
  with no defined channel for the holes/unresolvable-owner diagnostics §3.3 requires — silently
  discarding them would make "10 unresolvable fragments" and "10 fragments genuinely have no clash"
  indistinguishable to the caller. `records` uses the exact same `ExtractedFragmentRecord` shape
  `extractFragments` already produces (`{fragmentId, geometryIdentity, worldMatrix, worldBounds,
  ownerDbId}`, `ViewerModelAdapter.js:113`) — every downstream consumer (`makePlaced`,
  `admitCollisionInstances`, Task 9's placement-index writer) reads `.records`, unchanged from the
  bare-Map shape in every respect except the one extra wrapping layer. `diagnostics` entries use the
  exact same `{scope: 'fragment', reason, role, fragment: {modelId, dbId, fragId}}` shape
  `_runNarrowPhasePair`'s existing `diagnoseFragmentOnce` already produces (`CollisionWorld.js:815-824`)
  — a hole gets `reason: 'fragment-index-hole'`, an unresolvable owner gets
  `reason: 'owner-dbid-unresolvable'` (or whatever exact reason strings Task 2's findings note settles
  on), `role: 'target'` (whole-model extraction is only ever used for target scope in M2). `findClashes`
  (Task 8's call site) concatenates these directly into the call's own `statistics.diagnostics` array,
  the same array every other diagnostic already accumulates into — no separate diagnostics channel or
  merge step beyond a plain array concat.
- Consumes: the exact accessor names Task 2's findings note confirms; `CapacityExceededError` from
  `collision/errors.js` (Task 1's relocation) for its own capacity check, `kind:
  'whole-model-enumeration'`.

**Implementation steps:**

- [ ] **Step 1: Write the failing tests**, using Task 2's confirmed accessor names (placeholder names
  below — replace with whatever Task 2 actually confirms before writing this test file for real):

  ```js
  // test/viewer/ViewerModelAdapter.extractAllFragments.test.mjs
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { extractAllFragments } from '../../collision/viewer/ViewerModelAdapter.js';
  import { buildMockModel } from '../fixtures/mockInstanceTree.mjs'; // extend per Step 2 below

  test('enumerates every fragment the model holds, independent of tree structure', async () => {
    const { model } = buildMockModel([
      { dbId: 1, fragments: [{ fragId: 10 }] },
      { dbId: 2, fragments: [{ fragId: 11 }] },
    ], new Map());
    const { records, diagnostics } = await extractAllFragments(model, /* loadEpoch */ 1, {});
    assert.deepEqual([...records.keys()].sort(), [10, 11]);
    assert.deepEqual(diagnostics, []);
  });

  test('a fragment-index hole is skipped with a fragment-scoped diagnostic, never thrown as a malformed record', async () => {
    // Construct a mock model whose fragment-list enumeration reports a hole per Task 2's findings.
    // Exact fixture shape depends on Task 2's confirmed accessor -- fill in against the real mock.
    // Assert: the hole's index is absent from `records`, and `diagnostics` contains exactly one
    // entry with `{scope: 'fragment', reason: 'fragment-index-hole', role: 'target', fragment: {...}}`.
  });

  test('an unresolvable owner dbId produces a diagnostic and is excluded from records, never guessed', async () => {
    // Assert `records` omits the fragment and `diagnostics` carries `reason: 'owner-dbid-unresolvable'`.
  });

  test('a resolvable owner dbId comes from the reverse lookup, never from enumeration order', async () => {
    // Assert records.get(fragId).ownerDbId matches the reverse-lookup accessor's answer, not array index.
  });

  test('maxCollisionInstancesPerEpoch is enforced DURING enumeration, before the full Map is built', async () => {
    // A model with more fragments than the ceiling must throw
    // CapacityExceededError('whole-model-enumeration', {...}) without ever materializing the full
    // intermediate Map (assert via a spy/counter on the enumeration accessor that it stops early,
    // mirroring admitCollisionInstances's own "precheck before side effect" discipline,
    // CollisionWorld.js:692-703).
    const { CapacityExceededError } = await import('../../collision/errors.js'); // Task 1's relocation
  });

  test('records use the exact same ExtractedFragmentRecord shape extractFragments produces', async () => {
    const { model } = buildMockModel([{ dbId: 1, fragments: [{ fragId: 10 }] }], new Map());
    const { records } = await extractAllFragments(model, 1, {});
    const rec = records.get(10);
    assert.deepEqual(Object.keys(rec).sort(), ['fragmentId', 'geometryIdentity', 'worldMatrix', 'worldBounds', 'ownerDbId'].sort());
  });
  ```

- [ ] **Step 2: Extend `test/fixtures/mockInstanceTree.mjs`** (if needed) to support whatever
  fragment-list enumeration/reverse-lookup accessor Task 2 confirmed, mirroring how it already fakes
  `getObjectTree()`/`enumNodeFragments`/`getGeometryId` for the existing `extractFragments` tests.
  Read the current file before extending it — do not duplicate an existing mock helper.

- [ ] **Step 3: Run the tests, confirm FAIL** (`extractAllFragments` does not exist).

- [ ] **Step 4: Implement `extractAllFragments`** in `collision/viewer/ViewerModelAdapter.js`, next to
  `extractFragments` (a new sibling export, `extractFragments` itself untouched):

  ```js
  // Sibling to extractFragments: a DIFFERENT walk shape for "every fragment in this model," not a
  // parameterization of the per-dbId subtree walk above (design spec §3.3). Guarded by
  // maxCollisionInstancesPerEpoch (constants.js:58) DURING enumeration, not after an unbounded
  // intermediate Map is built -- mirrors admitCollisionInstances's own precheck-before-side-effect
  // discipline (CollisionWorld.js:692-703). Returns {records, diagnostics} -- see this task's own
  // Interfaces section (fixed after codex-review Critical #5: a bare Map has no diagnostics channel).
  import { CapacityExceededError } from '../errors.js'; // Task 1's relocation, not from CollisionWorld.js
  import { maxCollisionInstancesPerEpoch } from '../constants.js';

  export async function extractAllFragments(model, loadEpoch, { checkpoint, THREE = globalThis.THREE } = {}) {
    // Concrete accessor names filled in from Task 2's findings note -- e.g.:
    // const fragList = model.getFragmentList();
    // const instanceTree = model.getObjectTree();
    // const count = fragList.getCount();
    // for (let fragId = 0; fragId < count; fragId++) { ... instanceTree.findNodeForFragId(fragId) ... }
    const records = new Map();
    const diagnostics = [];
    const modelId = model && model.id !== undefined ? model.id : model;

    // Each iteration:
    //  1. checkpoint yield (same conditionally-synchronous pattern as extractFragments's own
    //     'extraction-node-visit' label, ViewerModelAdapter.js:79-82).
    //  2. A hole (no live fragment at this index, per Task 2's confirmed behavior) pushes
    //     { scope: 'fragment', reason: 'fragment-index-hole', role: 'target', fragment: { modelId, dbId: undefined, fragId } }
    //     to `diagnostics` and continues -- never thrown, never silently dropped.
    //  3. Resolve ownerDbId via the reverse lookup; if unresolvable, push
    //     { scope: 'fragment', reason: 'owner-dbid-unresolvable', role: 'target', fragment: { modelId, dbId: undefined, fragId } }
    //     to `diagnostics` and continue.
    //  4. maxCollisionInstancesPerEpoch check BEFORE inserting into `records` -- throw
    //     CapacityExceededError('whole-model-enumeration', { loadEpoch, requested: records.size + 1,
    //     limit: maxCollisionInstancesPerEpoch }) the instant the next insertion would exceed the
    //     ceiling, never after building the whole Map.
    //  5. Build the same ExtractedFragmentRecord shape extractFragments produces, Object.freeze it,
    //     records.set(fragId, record).
    throw new Error('implement against Task 2 findings');
    // return { records, diagnostics };
  }
  ```

- [ ] **Step 5: Iterate until all Step-1 tests pass.**

- [ ] **Step 6: Commit**

  ```bash
  git add collision/viewer/ViewerModelAdapter.js test/viewer/ViewerModelAdapter.extractAllFragments.test.mjs \
    test/fixtures/mockInstanceTree.mjs
  git commit -m "M2: add extractAllFragments whole-model enumeration primitive"
  ```

**Completion criteria:** All Step-1 tests pass; `extractFragments`'s own existing test suite
(`test/CollisionWorld.findClashes.test.mjs`'s extraction-related tests) still passes unmodified,
confirming `extractAllFragments` is additive, not a refactor of the existing walk.

**Protected invariants:** `extractFragments`'s per-dbId-subtree walk is untouched — this is a new
sibling primitive, never a parameterization of the existing one (spec §16's compatibility table).
`ExtractedFragmentRecord`'s shape is identical between the two primitives.

**Viewer/API evidence verification required:** Task 2's findings note, consumed directly by Step 4 —
do not guess at accessor names if Task 2 left anything unconfirmed.

---

## Task 6: Cross-model operand normalization, multi-lease capture, composite liveness checkpoint

**Files:**
- Modify: `collision/CollisionWorld.js` (`_checkEntryLifecycle:498-510`, `findClashes:613-754`,
  `createCheckpointPort:583-599`)
- Modify: `test/CollisionWorld.findClashes.test.mjs` (remove the `'cross-model query rejects'` test,
  `:258-270`)
- Test: `test/CollisionWorld.findClashes.crossModel.test.mjs`

**Prerequisite tasks:** None from Batch 1 required for this task's own correctness (this is pure
lease/lifecycle logic on top of the existing linear broad phase) — but Tasks 1 (constants/errors) must
land first since this task's own tests reference `ModelPlacementChangedError`'s *absence* at this
stage (it is not yet thrown here — that is Task 14) and the generalized `CapacityExceededError`.

**Interfaces:**
- Consumes: `admitModel` (`:319-336`), `_modelLifecycle` WeakMap, `_liveEpochs` Set,
  `createCheckpointPort` (`:583-599`).
- Produces: `findClashes`'s new query shape acceptance —
  `target: {model, dbIds} | {targets: Array<{model, dbIds?}>}` — and a composite, multi-epoch-aware
  liveness checkpoint replacing the single-model `_checkEntryLifecycle` rejection. Later tasks (7, 8,
  12, 14) build directly on the lease/epoch set and composite checkpoint this task produces.

**Implementation steps:**

- [ ] **Step 1: Write the failing tests** for the new query-shape acceptance and multi-lease capture:

  ```js
  // test/CollisionWorld.findClashes.crossModel.test.mjs
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { CollisionWorld, ModelEvictedError, WorldDisposedError } from '../collision/index.js';
  import { buildMockModel } from './fixtures/mockInstanceTree.mjs';

  // A single shared viewer.impl.getRenderProxy dispatching by model identity -- CollisionWorld has
  // exactly one _viewer reference (set by fromViewer), so a cross-model fixture needs ONE viewer
  // object serving both models' fake render proxies, unlike the single-model makeFixture helper in
  // test/CollisionWorld.findClashes.test.mjs (which asserts getRenderProxy is called with exactly
  // ITS OWN model and would need extending, not reuse, for two models).
  function makeTwoModelFixture() { /* build two mock models sharing one viewer.impl */ }

  test('findClashes no longer rejects source.model !== target.model', async () => {
    const { modelA, modelB, viewer } = makeTwoModelFixture();
    const world = await CollisionWorld.fromViewer(viewer, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' });
    const result = await world.findClashes({
      source: { model: modelA, dbIds: [] },
      target: { targets: [{ model: modelB }] },
      mode: 'volume-overlap', groupBy: 'dbId', broadPhase: 'linear',
    });
    assert.deepEqual(result.pairs, []); // empty operands, but no rejection
  });

  test('two targets entries naming the same Model object collapse to one admitted lease', async () => {
    // Assert admitModel is effectively called once per distinct model object, not once per targets
    // entry -- e.g. by spying on world.admitModel or asserting getEpochCollisionInstanceCount
    // behavior is consistent with a single epoch for the duplicated model.
  });

  test('legacy target: {model, dbIds} shape still works unchanged (M1 byte-for-byte compatibility)', async () => {
    // Single-model call, no `targets` array -- must behave exactly as the pre-M2 test suite already
    // proves via test/CollisionWorld.findClashes.test.mjs; this test is a targeted spot-check, not a
    // duplicate of that whole suite.
  });

  test('eviction of a captured NON-current-operand model aborts the whole call', async () => {
    // Cross-model call touching models A and B; evict B (not the operand currently being processed)
    // mid-call via an injected checkpoint hook -- assert the whole call rejects ModelEvictedError,
    // not a partial A-only result. Mirrors M1's existing single-model eviction-race test pattern.
  });

  test('empty-extraction fast path still validates the FULL multi-model lease set, not zero checkpoints', async () => {
    // Both operands extract to zero fragments -- assert eviction of a captured (but never touched)
    // model still aborts, closing the CollisionWorld.js:688-691 empty-return gap for multi-model calls.
  });

  test('disposal immediately before a successful return is caught (return-site checkpoint, spec §9.2 point 7b)', async () => {
    // Use a test double / injected hook to dispose the world after the last checkpoint but before the
    // return statement executes -- assert WorldDisposedError, not a stale successful result.
  });
  ```

- [ ] **Step 2: Run the tests, confirm they FAIL.**

- [ ] **Step 3: Remove the M1 cross-model rejection.** Delete `_checkEntryLifecycle`'s
  `source.model !== target.model` branch (`CollisionWorld.js:498-510`) and the now-obsolete
  `'cross-model query rejects'` test (`test/CollisionWorld.findClashes.test.mjs:258-270`). Keep
  `_checkEntryLifecycle`'s disposed/evicted/lazy-admission logic for the **single-model legacy path**
  — Step 4 below adds the multi-model path alongside it, not as a wholesale replacement, so the
  legacy `target: {model, dbIds}` shape's existing behavior (including its own disposed-first /
  evicted-second entry order) is preserved verbatim.

- [ ] **Step 4: Implement operand normalization and multi-lease capture** in `findClashes`, before
  extraction begins:

  ```js
  // Normalize `query.target` into a uniform internal shape -- {model, dbIds}[] legacy target becomes
  // a one-entry targets array internally, so every later step (Tasks 7, 8, 10) operates on one shape.
  function normalizeTargets(target) {
    if (Array.isArray(target?.targets)) return target.targets;
    return [{ model: target.model, dbIds: target.dbIds }]; // legacy shape, dbIds always present here
  }

  // Snapshot and DEDUPLICATE every distinct Model object across source + every targets entry, at
  // query entry, before any extraction begins (spec §9.2 points 1-3). Two targets entries naming the
  // same Model object collapse to one lease.
  function collectDistinctModels(sourceModel, targetsEntries) {
    const models = new Set([sourceModel]);
    for (const entry of targetsEntries) models.add(entry.model);
    return [...models];
  }
  ```

  In `findClashes`, after argument validation and before the disposed/lazy-admission checks:

  ```js
  const targetsEntries = normalizeTargets(query.target);
  const distinctModels = collectDistinctModels(query.source.model, targetsEntries);
  if (this._disposed) throw new WorldDisposedError();
  const leases = distinctModels.map((m) => this.admitModel(m)); // throws ModelEvictedError per M1 admitModel contract
  const capturedEpochs = new Set(leases.map((l) => l.epoch));
  ```

  This runs **before** the existing single-model `_checkEntryLifecycle` call for the legacy path — a
  legacy single-model call has `distinctModels.length === 1`, so `admitModel` is called exactly once,
  identical in effect to today's lazy-admission-via-`_checkEntryLifecycle` path. Reconcile the two
  entry points carefully in this step so the legacy path's own tests
  (`test/CollisionWorld.findClashes.test.mjs`) still pass unmodified — do not duplicate the
  instance-tree-readiness wait (`_awaitObjectTreeReady`) per model without checking whether it is
  already safe to call once per distinct model (it is: the wait is keyed by `model`, not by call).

- [ ] **Step 5: Implement the composite multi-epoch liveness checkpoint**, replacing the single-lease
  `createCheckpointPort(lease)` call for the multi-model path:

  ```js
  // A composite wrapper around the existing per-call checkpoint port (createCheckpointPort,
  // unchanged) that, on every invocation, synchronously re-validates EVERY captured epoch before
  // deferring to the real port's own single-epoch-scoped validate/yield logic (spec §9.2 point 5).
  // Requires no change to collision/scheduler.js itself.
  createCompositeCheckpointPort(leases, capturedEpochs) {
    // Reuse ONE real port (arbitrary primary lease -- its own isEpochLive/isDisposed callbacks are
    // world-global, not lease-specific, per createCheckpointPort's existing implementation) so the
    // frame-budget accumulator is shared exactly once across the whole call, as today.
    const realCheckpoint = this.createCheckpointPort(leases[0]);
    return (ctx = {}) => {
      for (const epoch of capturedEpochs) {
        if (this._disposed) throw new WorldDisposedError();
        if (!this._isEpochLive(epoch)) {
          const evictedModel = leases.find((l) => l.epoch === epoch)?.model;
          throw new ModelEvictedError(modelIdOf(evictedModel));
        }
      }
      return realCheckpoint(ctx);
    };
  }
  ```

  Wire this in place of the single-lease `checkpoint` for any call with `distinctModels.length > 1`
  (the legacy single-model path may keep using `createCheckpointPort(lease)` directly, since a
  composite check over a one-element set is a no-op restatement of the existing check — but prefer
  using the composite unconditionally for code-path uniformity unless a measured reason argues
  otherwise; state whichever choice is made explicitly in the PR/commit message).

- [ ] **Step 6: Apply the composite check at every point spec §9.2 point 7 requires**, not only
  existing per-iteration checkpoint call sites:
  - (a) synchronously immediately after every `await` on a shared/cross-caller resource (e.g. the
    `GeometryRegistry.getOrBuildGeometry` await inside `_runNarrowPhasePair`'s `buildOne` — this
    await is NOT itself a checkpoint call site today);
  - (b) synchronously immediately before every `return` statement in `findClashes`, success or
    empty-result alike — including the existing empty-extraction fast return (`:688-691`).

  This is the fix for the two real gaps the design-review consult found (naive point-5 alone is
  insufficient): a captured epoch B evicted while the call is blocked awaiting a shared resource for
  epoch A, and a lease invalidated between the last checkpoint and a successful/empty return.

- [ ] **Step 7: Preserve M1's admission-precheck-before-commit discipline for the multi-model case,
  with a preflight that mirrors `admitCollisionInstances`'s REAL check, not extraction size.**

  **Fixed after `codex-review` (Critical #3):** the first draft of this step preflighted each model's
  raw extraction size against `maxCollisionInstancesPerEpoch`. That is insufficient —
  `admitCollisionInstances`'s actual rejection condition (`CollisionWorld.js:437`,
  `currentSize + missing.length > maxCollisionInstancesPerEpoch`) depends on the epoch's **existing**
  bucket size plus the count of **genuinely new** fragment ids, not the raw extraction size. A
  concrete failure the naive preflight misses: epoch B already holds 19,500 instances; a new
  extraction for B has 1,000 ids, of which only 600 are actually new — extraction-size alone (1,000)
  looks fine against the 20,000 ceiling, but the REAL check (`19,500 + 600 = 20,100 > 20,000`) fails —
  and if epoch A's admission was already committed by the time B's real check runs, A is left
  partially mutated, violating this step's own "zero instances committed to the first target" goal.

  Add a **side-effect-free** preflight helper next to `admitCollisionInstances`
  (`CollisionWorld.js:419-475`), replicating its exact bucket-size-plus-missing-count arithmetic
  without mutating anything:

  ```js
  // Read-only mirror of admitCollisionInstances's own check (CollisionWorld.js:428-450) -- computes
  // whether an admission WOULD succeed, without touching _instanceCache. `uniqueFragments` here is
  // already the union of every source/target extraction touching this one epoch in this call (a
  // duplicate targets entry for the same model, or the source and a target sharing a model, must be
  // unioned BEFORE preflighting, exactly as the real commit step unions them today via `merged`).
  _preflightCollisionInstanceAdmission(lease, uniqueFragments) {
    if (uniqueFragments.size > maxCollisionInstancesPerEpoch) {
      return { ok: false, reason: 'call-wide-unique-fragment-precheck' };
    }
    const existingBucket = this._instanceCache.get(lease.epoch) || null;
    let missingCount = 0;
    for (const fragmentId of uniqueFragments.keys()) {
      if (!existingBucket || !existingBucket.has(fragmentId)) missingCount++;
    }
    const currentSize = existingBucket ? existingBucket.size : 0;
    if (currentSize + missingCount > maxCollisionInstancesPerEpoch) {
      return { ok: false, reason: 'bucket-capacity' };
    }
    return { ok: true };
  }
  ```

  In `findClashes`, for a multi-model call: build each distinct epoch's own unioned
  `uniqueFragments` map (source + every target group touching that epoch, merged — the same merge
  `findClashes` already performs per-call today, `:706`, generalized across epochs), call
  `_preflightCollisionInstanceAdmission` for **every** epoch first, and only if **all** preflights
  return `{ok: true}` proceed to call the real, mutating `admitCollisionInstances` for each epoch, in
  one synchronous, await-free phase (the same "synchronous span" discipline the existing single-model
  call already observes, `:687-709`). If any preflight fails, throw the corresponding
  `CapacityExceededError` immediately, before any epoch's real admission runs.

  Add tests: (a) a multi-model call that would fail the ceiling on its *second* target model's epoch
  throws with **zero** instances committed to the *first* target model's epoch (assert via
  `getEpochCollisionInstanceCount`); (b) an epoch that is already partially populated from a prior
  call correctly fails preflight when new+existing exceeds the ceiling, even though the new
  extraction's own raw size is well under it; (c) two operands (source and a target) sharing the same
  model have their fragment ids unioned before preflighting, not double-counted or preflighted twice.

- [ ] **Step 8: Add explicit input validation for the new query shape.**

  **Fixed after `codex-review` (Important #5):** the first draft left an empty `targets` array,
  a missing `model`, a non-array/`null` `dbIds`, an entry supplying both a legacy `target.dbIds` and
  a `target.targets` array, and an unsupported `broadPhase` value all undefined — each would surface
  as an incidental `TypeError` deep inside extraction rather than a clear, early rejection, and error
  precedence relative to disposed/evicted would be inconsistent. Add explicit checks, in this
  precedence order (disposed first, exactly as every other check in this method already orders
  itself), immediately after the existing `groupBy`/`mode` checks (`:648-658`) and before any
  `admitModel` call:

  | Condition | Behavior |
  |---|---|
  | `target.targets` is an array of length 0 | Throw `Error('findClashes: targets must be non-empty when supplied')` |
  | `target` supplies both `target.dbIds` and `target.targets` | Throw `Error('findClashes: target must be either {model,dbIds} or {targets}, not both')` |
  | A `targets` entry has no `model` | Throw `Error('findClashes: every targets entry must supply a model')` |
  | A `targets` entry's `dbIds` is present but not an array | Throw `Error('findClashes: targets entry dbIds must be an array when supplied')` (an explicit `dbIds: undefined` remains the whole-model-scope sentinel, `dbIds: null` is rejected, not silently treated as omitted) |
  | `query.broadPhase` is supplied and is not `'tlas'`/`'linear'` | Throw `Error('findClashes: unsupported broadPhase '${query.broadPhase}'')` |

  Add a test per row of this table, plus one confirming `broadPhase: 'tlas'` is accepted with the
  **legacy** `{model, dbIds}` target shape (spec §3.5: either shape may override its own default),
  not just the new `targets` shape.

- [ ] **Step 9: Run all tests** (`npm test`) — the full existing suite plus this task's new file —
  confirm zero regressions, then commit.

  ```bash
  git add collision/CollisionWorld.js test/CollisionWorld.findClashes.test.mjs \
    test/CollisionWorld.findClashes.crossModel.test.mjs
  git commit -m "M2: cross-model operand normalization, multi-lease capture, composite liveness checkpoint"
  ```

**Completion criteria:** `npm test` passes with zero regressions to the existing single-model suite;
`findClashes` accepts both the legacy `{model, dbIds}` target shape and the new `{targets: [...]}`
shape; a cross-model call with an evicted non-current-operand model aborts the whole call; the
empty-extraction fast path and every successful return revalidate the full captured lease set; a
multi-model admission preflight leaves no partial commitment on a later-epoch capacity failure.

**Protected invariants:** The legacy single-model `target: {model, dbIds}` path's existing test suite
(`test/CollisionWorld.findClashes.test.mjs`, minus the one removed rejection test) passes byte-for-byte
unmodified. `_checkEntryLifecycle`'s disposed-then-evicted entry order is preserved for the legacy
path. No partial cross-model admission is ever left committed on a capacity failure.

**Viewer/API evidence verification required:** None (pure `CollisionWorld` internals).

---

## Task 7: Cross-model narrow-phase provenance — `ClashPair.model`, epoch-qualified dedup, self-exclusion

**Files:**
- Modify: `collision/CollisionWorld.js` (`fragmentRef:54-60`, `_runNarrowPhasePair:808-960`,
  `findClashes`'s pair-assembly loop `:731-749`)
- Test: `test/CollisionWorld.findClashes.crossModel.test.mjs` (extend from Task 6)

**Prerequisite tasks:** Task 6 (needs multi-lease capture and operand normalization to exist so a
cross-model candidate pair can even be constructed).

**Interfaces:**
- Produces: `ClashPair = {source: {modelId, dbId, model}, target: {modelId, dbId, model}, type}` (the
  `model` field is additive, `modelId` untouched); pair dedup key
  `` `${sourceEpoch}:${sourceDbId}:${targetEpoch}:${targetDbId}` ``; fragment-diagnostic dedup key
  `(loadEpoch, fragmentId)`.
- Consumes: Task 6's per-operand `{model, epoch}` lease pairs.

**Implementation steps:**

- [ ] **Step 1: Write the failing tests:**

  ```js
  test('ClashPair carries an additive model reference per operand, alongside modelId', async () => {
    // Cross-model clash fixture -> assert result.pairs[0].source.model === modelA (by ===, not
    // deep-equal) and result.pairs[0].target.model === modelB.
  });

  test('dedup key is epoch-qualified: same dbId in two different models is NOT collapsed', async () => {
    // modelA dbId 5 and modelB dbId 5 (same numeric dbId, different models/epochs) both clash with
    // the source -- assert BOTH appear as distinct pairs, not deduped into one.
  });

  test('fragment-diagnostic dedup is (loadEpoch, fragmentId)-keyed, not bare fragmentId', async () => {
    // Two different epochs each contain a fragmentId with the same numeric value, both oversized --
    // assert BOTH diagnostics are emitted, not just one (the exact latent-bug scenario spec §4.2
    // describes: unreachable in M1, reachable once two epochs are in play in one call).
  });

  test('source self-exclusion: a target whose (loadEpoch,fragmentId) is in sourceExtracted is excluded', async () => {
    // Assembly-rooted source selection whose extracted fragment set spans multiple ownerDbIds --
    // assert every one of those fragments is excluded from results even though only one dbId was
    // "requested" as source (spec §4.4's corrected assembly-rooted rule, not dbId-level equality).
  });

  test('operand-local model/epoch: a diagnostic for a cross-model pair names the CORRECT per-operand model', async () => {
    // A pair-scoped diagnostic (e.g. unverified-parity-operand) on a cross-model candidate must carry
    // sourceFragment.modelId/targetFragment.modelId reflecting each operand's OWN model, never one
    // shared call-level model (the exact bug _runNarrowPhasePair's current single model/epoch params
    // would produce if left unchanged).
  });
  ```

- [ ] **Step 2: Run the tests, confirm FAIL.**

- [ ] **Step 3: Make `fragmentRef` and `_runNarrowPhasePair` operand-local.** Change
  `_runNarrowPhasePair`'s signature from one shared `model, epoch` to per-operand pairs:

  ```js
  // Before: async _runNarrowPhasePair(sourcePlaced, targetPlaced, mode, model, epoch, statistics, oversizedDiagnosedFragments, checkpoint)
  // After:
  async _runNarrowPhasePair(
    sourcePlaced, targetPlaced, mode,
    sourceOperand, targetOperand, // each { model, epoch }
    statistics, oversizedDiagnosedFragments, checkpoint,
  ) {
    // fragmentRef(sourceOperand.model, sourcePlaced) / fragmentRef(targetOperand.model, targetPlaced)
    // replace every fragmentRef(model, placed) call inside this method -- one call site now uses
    // sourceOperand's model, the other targetOperand's, never a single shared `model`.
  }
  ```

  Update `fragmentRef`'s dedup-relevant caller: `oversizedDiagnosedFragments` (a `Set`, currently
  keyed by bare `fragmentId`, `:816-817`) becomes keyed by `` `${epoch}:${fragmentId}` `` — pass the
  relevant operand's own `epoch` into `diagnoseFragmentOnce`.

- [ ] **Step 4: Update the pair-assembly dedup key** in `findClashes` (`:741-748`):

  ```js
  // M1: const key = `${sourcePlaced.ownerDbId}:${targetPlaced.ownerDbId}`;
  const key = `${sourceOperand.epoch}:${sourcePlaced.ownerDbId}:${targetOperand.epoch}:${targetPlaced.ownerDbId}`;
  if (!pairsByKey.has(key)) {
    pairsByKey.set(key, {
      source: { modelId: modelIdOf(sourceOperand.model), dbId: sourcePlaced.ownerDbId, model: sourceOperand.model },
      target: { modelId: modelIdOf(targetOperand.model), dbId: targetPlaced.ownerDbId, model: targetOperand.model },
      type: query.mode,
    });
  }
  ```

- [ ] **Step 5: Implement source self-exclusion** via `sourceExtracted`'s own fragment-id membership
  (spec §4.4's corrected, assembly-aware rule) — before a candidate pair is even handed to the narrow
  phase (in the broad-phase-candidate-assembly step Task 8 builds):

  ```js
  // A candidate target instance is excluded iff its (loadEpoch, fragmentId) appears anywhere in the
  // SOURCE operand's own extracted fragment map for this call -- not dbId-level equality (spec §4.4).
  function isSourceOwnFragment(sourceExtractedByEpoch, targetEpoch, targetFragmentId) {
    return sourceExtractedByEpoch.get(targetEpoch)?.has(targetFragmentId) ?? false;
  }
  ```

  (`sourceExtractedByEpoch` here is keyed by epoch since the source's own operand is single-model in
  M2 — a `Map<epoch, Map<fragmentId,...>>` with exactly one entry is sufficient, but keep the shape
  generic so it composes cleanly with Task 8's multi-target-epoch iteration.)

- [ ] **Step 6: Run all tests, fix until green, then commit.**

  ```bash
  git add collision/CollisionWorld.js test/CollisionWorld.findClashes.crossModel.test.mjs
  git commit -m "M2: operand-local narrow-phase provenance, epoch-qualified dedup, source self-exclusion"
  ```

**Completion criteria:** All new tests pass; the full existing M1 single-model suite passes unmodified
(a single-model call has `sourceOperand.epoch === targetOperand.epoch`, so the new dedup key reduces
to the old one's information content plus a redundant-but-harmless epoch prefix — assert this
explicitly with a spot-check test comparing old-format vs new-format keys' *uniqueness partition* for
a single-model fixture).

**Protected invariants:** `comparePlacedCanonically` (`:98-107`) needs zero change — already
epoch-aware. `toInstance()` (`:132-142`) needs zero change — already identity-free. Every existing
pair-/fragment-scoped diagnostic's `{scope, reason, ...}` shape is unchanged; only the dedup key's
internal partitioning changes, never the diagnostic's public shape.

**Viewer/API evidence verification required:** None.

---

## Task 8: Cross-model linear-oracle broad phase

**Files:**
- Modify: `collision/CollisionWorld.js` (`_runBroadPhaseScan:765-782`, `findClashes`'s broad-phase
  call site `:727-729`)
- Test: `test/CollisionWorld.findClashes.crossModel.test.mjs` (extend)

**Prerequisite tasks:** Tasks 6, 7 (needs multi-lease capture, operand normalization, and operand-local
provenance/self-exclusion to exist).

**Interfaces:**
- Produces: `_runBroadPhaseScan` extended to run once per `(sourceEpoch, targetEpoch)` pair in the
  call's operand set, applying Task 7's self-exclusion filter per pair. This completes an end-to-end,
  independently shippable capability: **cross-model Hard Clash works correctly via
  `broadPhase:'linear'`**, before any TLAS code exists.

**Implementation steps:**

- [ ] **Step 1: Write the failing tests:**

  ```js
  test('cross-model federation, source has a same-model AND a cross-model Hard Clash: both aggregate', async () => {
    // source in model A; a same-model clash target also in A; a cross-model clash target in B --
    // assert BOTH appear in one pairs array (spec §12.2's exact fixture).
  });

  test('whole-model target scope (targets:[{model}], no dbIds) against a dense model finds every real clash', async () => {
    // Uses extractAllFragments (Task 5) as the target-side extraction for a whole-model targets entry.
  });

  test('broadPhase defaults to "linear" for the legacy target shape, "tlas" is rejected/ignored until Batch 4', async () => {
    // Confirms spec §3.5's shape-dependent default is already correctly wired for the legacy shape
    // (byte-for-byte M1 behavior) even before broadPhase:'tlas' has a real implementation -- an
    // explicit broadPhase:'tlas' request at this point in the plan should either no-op to linear or
    // throw a clear "not yet implemented" error, whichever this task's own implementation chooses;
    // assert whichever behavior is chosen, do not leave it undefined.
  });

  test('O(n*m)-per-pair shape is preserved: linear scan runs once per (sourceEpoch,targetEpoch) pair', async () => {
    // Instrument _runBroadPhaseScan's own broadPhasePairs counter across a 2-target-epoch call and
    // assert the count equals the SUM of each epoch's own sourceCount*targetCount, not a single
    // merged-Cartesian-product count that would double-count or cross-contaminate epochs.
  });
  ```

- [ ] **Step 2: Run the tests, confirm FAIL.**

- [ ] **Step 3: Extend `_runBroadPhaseScan`** to accept the multi-target-epoch shape, incrementing
  `broadPhasePairs` in the CORRECT position:

  **Fixed after `codex-review` (Important #1):** the first draft of this loop incremented
  `statistics.broadPhasePairs` *before* the self-exclusion check, so a self-excluded pair was still
  counted even though `_testBroadPhasePair` never ran on it — inconsistent with Task 13's own TLAS-path
  ordering (filters → count → retest) and with spec §7.5.2's canonical definition of `broadPhasePairs`
  as "candidates whose exact predicate was evaluated." Move the increment to immediately before the
  `_testBroadPhasePair` call, after self-exclusion:

  ```js
  // sourceInstances: Array<PlacedInstance> (one epoch, the source's own).
  // targetGroups: Array<{ epoch, model, instances: Array<PlacedInstance> }> -- one per distinct
  // target epoch in this call's operand set (Task 6's normalized targetsEntries, each extracted).
  async _runBroadPhaseScan(sourceOperand, sourceInstances, targetGroups, statistics, checkpoint) {
    const candidates = [];
    for (const group of targetGroups) {
      for (let i = 0; i < sourceInstances.length; i++) {
        for (let j = 0; j < group.instances.length; j++) {
          const pending = checkpoint({ label: 'broad-phase-scan' });
          if (pending) await pending;
          const targetPlaced = group.instances[j];
          if (isSourceOwnFragment(sourceOperand, group.epoch, targetPlaced.instance.fragmentId)) continue; // never counted, never retested
          statistics.broadPhasePairs++; // counted immediately before the exact predicate runs, matching Task 13's TLAS-path ordering
          if (this._testBroadPhasePair(sourceInstances[i], targetPlaced)) {
            candidates.push([sourceInstances[i], targetPlaced, { model: group.model, epoch: group.epoch }]);
          }
        }
      }
    }
    return candidates;
  }
  ```

  Note the candidate tuple now carries the target operand's `{model, epoch}` alongside the two
  `PlacedInstance`s, feeding directly into Task 7's operand-local `_runNarrowPhasePair` call.
  `_testBroadPhasePair` itself (`:786-792`) is unchanged — reused verbatim, per spec §7.4.

  **Compatibility note, stated explicitly rather than overclaimed:** M1 never had a self-exclusion
  concept — `_runBroadPhaseScan`'s original Cartesian loop counted and retested every pair
  unconditionally, including a pathological self-pair (a caller passing an overlapping dbId on both
  sides). This task applies self-exclusion uniformly, to the legacy single-model target shape too, not
  only to the new `targets` shape — which is a genuine, narrow, deliberate behavior change to
  `broadPhasePairs`'s numeric value for the rare legacy case where source/target dbIds overlap (the
  pair is no longer counted at all). Add a test asserting this exact case for the legacy shape and
  document the outcome in this task's commit message — do not claim unqualified "zero behavior change"
  for `broadPhase:'linear'` in this one specific scenario, even though every other legacy-shape
  behavior is unchanged.

- [ ] **Step 4: Wire `findClashes`'s broad-phase call site** to build `targetGroups` from Task 6's
  normalized `targetsEntries`, extracting each distinct target model (via `extractFragments` for an
  explicit-`dbIds` entry, `extractAllFragments` — Task 5 — for a `dbIds`-omitted entry) and merging
  duplicate-model entries per Task 6's lease-collapsing (union their requested dbIds, or apply
  whole-model scope if any duplicate entry omits `dbIds` — this is the target-scope union Task 12's
  filter formalizes for the TLAS path; for the **linear** path, a target's own extraction naturally
  already IS the effective scope, so no separate filter step is needed here — extraction itself is the
  filter). `extractAllFragments` returns `{records, diagnostics}` (Task 5) — use `.records` to build
  the group's `instances`, and concat `.diagnostics` directly into this call's own
  `statistics.diagnostics` array (the same array every other diagnostic in this call already
  accumulates into, no separate merge mechanism).

- [ ] **Step 5: Preserve `maxBroadPhaseInstancePairs`'s existing ceiling semantics per target epoch**
  — `_exceedsBroadPhaseCeiling` (`:760-763`) is checked once per `(sourceCount, targetGroup.instances.length)`
  pair, matching M1's existing single-pair scope generalized to "one check per pair in the call,"
  not a single call-wide product across all target epochs (which could reject a legitimate call
  touching many small target models even though no single pair is large). State this choice
  explicitly as a design note in the commit message — it is a genuine judgment call the spec's own
  text (§9.3.1, discussing the *TLAS* budget's whole-call scope) does not directly settle for the
  *linear* ceiling, since §9.3 is scoped to `broadPhase:'tlas'` only and the legacy
  `maxBroadPhaseInstancePairs` ceiling's cross-model generalization is this task's own decision to
  make, consistently with the ceiling's own existing single-pair-product mathematical shape.

- [ ] **Step 6: Run all tests, fix until green, then commit.**

  ```bash
  git add collision/CollisionWorld.js test/CollisionWorld.findClashes.crossModel.test.mjs
  git commit -m "M2: cross-model linear-oracle broad phase across multiple target epochs"
  ```

**Completion criteria:** All Batch 2 tests (Tasks 6-8) pass together; a full cross-model
`findClashes({..., broadPhase:'linear'})` call against two or more models returns correct, deduplicated,
correctly-provenanced results with the source excluded — **this is a genuine, shippable milestone
slice**, testable and demonstrable before any TLAS code exists. `npm test` passes with zero
regressions to the M1 single-model suite.

**Protected invariants:** `_testBroadPhasePair` (`:786-792`) is reused verbatim, never modified.
`maxBroadPhaseInstancePairs`'s per-pair mathematical form (`:760-763`) is unchanged; only its
call-site scope generalizes to "once per target epoch."

**Viewer/API evidence verification required:** None (this task's Viewer-facing pieces — whole-model
target extraction — were already verified in Task 2/built in Task 5).

---

# Batch 3 — Placement index / TLAS cache lifecycle

## Task 9: Epoch-scoped placement index (`_placementByEpoch`, `_placementRevisionByEpoch`)

**Files:**
- Modify: `collision/CollisionWorld.js` (constructor fields, `findClashes`'s extraction call sites,
  `_releaseEpochScopedState:477-494`, `dispose:390-413`)
- Test: `test/CollisionWorld.placementIndex.test.mjs`

**Prerequisite tasks:** Batch 2 complete (this index is populated at the same extraction call sites
Batch 2 already generalized to multi-model).

**Interfaces:**
- Produces: `_placementByEpoch: Map<loadEpoch, Map<fragmentId, {worldBounds, worldMatrix, ownerDbId,
  modelId}>>`, `_placementRevisionByEpoch: Map<loadEpoch, number>`, both released at
  `_releaseEpochScopedState`/`dispose` alongside the existing epoch-scoped tables. Consumed directly
  by Task 10 (`TlasCache`'s `buildPrimitives`) and Task 11 (`invalidateModelPlacement`).

**Implementation steps:**

- [ ] **Step 1: Write the failing tests:**

  ```js
  test('a genuinely new fragment is inserted into _placementByEpoch and bumps the revision', async () => {
    // After one findClashes call extracting fragment 10 for the first time, assert (via a test-only
    // accessor or by observing TlasCache behavior in Task 10) that the epoch's revision advanced by
    // exactly 1 for that one new fragment (or by the count of genuinely-new fragments in that call).
  });

  test('re-requesting an already-present fragmentId does NOT overwrite its placement or bump the revision', async () => {
    // Two overlapping findClashes calls both touching fragment 10 -- assert its worldMatrix/worldBounds
    // in _placementByEpoch are untouched by the second call's own (potentially different, if the
    // fixture allows it) extraction read, and the revision does not advance for that fragment again.
    // This is the "write-once per fragment, only invalidateModelPlacement's refresh may overwrite"
    // contract (spec §6.7.4/the disposition's "Correction to §6.1's phrasing").
  });

  test('_placementByEpoch and _placementRevisionByEpoch are released on evictModel', async () => {
  });

  test('_placementByEpoch and _placementRevisionByEpoch are cleared wholesale on dispose', async () => {
  });
  ```

- [ ] **Step 2: Run the tests, confirm FAIL.**

- [ ] **Step 3: Add the two new fields** to the `CollisionWorld` constructor (`:222-258`), alongside
  `_instanceCache`/`_modelByEpoch`:

  ```js
  this._placementByEpoch = new Map(); // Map<loadEpoch, Map<fragmentId, {worldBounds, worldMatrix, ownerDbId, modelId}>>
  this._placementRevisionByEpoch = new Map(); // Map<loadEpoch, number>
  ```

- [ ] **Step 4: Write the epoch-scoped, write-once-per-fragment writer**, called from every extraction
  call site in `findClashes` (both `extractFragments` and `extractAllFragments` results, for every
  operand — source and every target group):

  ```js
  // Write-once per fragment (spec's corrected §6.1/§6.7.4 contract): a fragment ALREADY present in
  // _placementByEpoch.get(epoch) is NEVER overwritten by ordinary extraction -- only
  // invalidateModelPlacement's staged refresh (Task 11) may overwrite an EXISTING entry. Only a
  // genuinely new fragmentId is inserted, which also bumps the revision as "growth."
  _recordPlacement(epoch, model, extractedRecords) {
    let placementByFragment = this._placementByEpoch.get(epoch);
    if (!placementByFragment) {
      placementByFragment = new Map();
      this._placementByEpoch.set(epoch, placementByFragment);
    }
    const modelId = modelIdOf(model);
    let grew = false;
    for (const record of extractedRecords.values()) {
      if (placementByFragment.has(record.fragmentId)) continue; // write-once: never overwrite
      placementByFragment.set(record.fragmentId, {
        worldBounds: record.worldBounds, worldMatrix: record.worldMatrix,
        ownerDbId: record.ownerDbId, modelId,
      });
      grew = true;
    }
    if (grew) {
      this._placementRevisionByEpoch.set(epoch, (this._placementRevisionByEpoch.get(epoch) ?? 0) + 1);
    }
  }
  ```

  Call this alongside the existing `_recordRepresentativeFragments` call sites in `findClashes`
  (`:704-705`) — same call-site pattern, one more sibling write, for both source and every target
  group.

- [ ] **Step 5: Release both tables** at `_releaseEpochScopedState` (`:477-494`) and `dispose`
  (`:406-412`):

  ```js
  // _releaseEpochScopedState(epoch):
  this._placementByEpoch.delete(epoch);
  this._placementRevisionByEpoch.delete(epoch);

  // dispose():
  this._placementByEpoch.clear();
  this._placementRevisionByEpoch.clear();
  ```

- [ ] **Step 6: Run all tests, fix until green, then commit.**

  ```bash
  git add collision/CollisionWorld.js test/CollisionWorld.placementIndex.test.mjs
  git commit -m "M2: epoch-scoped placement index with write-once-per-fragment semantics"
  ```

**Completion criteria:** All tests pass; `npm test` shows zero regressions; a single-model M1 call's
own extraction behavior is provably unaffected (this table is purely additive — nothing reads it yet
until Task 10).

**Protected invariants:** `_instanceCache`'s existing scope (`{fragmentId, geometryIdentity}` only,
`:461`) is untouched and not repurposed — this is a genuinely new, separate table, per spec §16's
explicit correction of the design's own first draft.

**Viewer/API evidence verification required:** None.

---

## Task 10: `TlasCache` — lazy build, revision-aware single-flight, release lifecycle

**Files:**
- Create: `collision/tlas/TlasCache.js`
- Modify: `collision/CollisionWorld.js` (constructor field `_tlasCache`, `_releaseEpochScopedState`,
  `dispose`)
- Test: `test/tlas/TlasCache.test.mjs`

**Prerequisite tasks:** Task 3 (`CollisionInstanceBVH`), Task 9 (`_placementByEpoch`/
`_placementRevisionByEpoch` as the cache's primitive source).

**Interfaces:**
- Produces:
  ```js
  class TlasCache {
    constructor({ buildPrimitives, checkpointPort }) // buildPrimitives(loadEpoch) -> Array<record>
    async getEntry(loadEpoch, expectedRevision) -> { bvh, builtAtRevision, outcome: 'built'|'shared-wait'|'hit' }
                                                    | { outcome: 'superseded' }
    releaseEntryForEpoch(loadEpoch)
    releaseAll()
  }
  ```
  Consumed by Task 13's traversal integration and Task 11's invalidation/refresh.

  **Fixed after `codex-review` (Critical #1):** the first draft's `getEntry` recursively retried a
  superseded build by re-calling `getEntry(loadEpoch, expectedRevision)` with the CALLER'S OWN, now
  stale, `expectedRevision` — this can regress a newer, already-published revision back to an older
  one (query A's slow build for revision 1 completes after query B has already published revision 2,
  and A's own retry-with-`expectedRevision:1` starts a THIRD build for the now-obsolete revision 1),
  and can resurrect a build for an epoch `releaseEntryForEpoch`/`releaseAll` already tore down (a
  build in flight when eviction happens sees its entry gone from the map and, under the old logic,
  would recursively start a brand-new build for a permanently-dead epoch). The corrected contract:
  `getEntry` NEVER retries internally with a value the caller already knows is stale. When a build is
  superseded or the epoch was released while it was in flight, `getEntry` returns `{outcome:
  'superseded'}` and it is the CALLER's (Task 13's) responsibility to re-derive the current expected
  revision fresh from `_placementRevisionByEpoch` (validating liveness first) and call `getEntry`
  again with that freshly-read value — bounding the retry to the number of times the revision has
  actually, genuinely changed, never an internally-manufactured loop on a fixed stale number.

**Implementation steps:**

- [ ] **Step 1: Write the failing tests**, mirroring `test/geometry/GeometryRegistry.test.mjs`'s own
  stub-builder test style:

  ```js
  // test/tlas/TlasCache.test.mjs
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { TlasCache } from '../../collision/tlas/TlasCache.js';

  function stubCheckpointPort() {
    return { checkpoint: () => undefined }; // always-fast-path stub, mirrors GeometryRegistry's own tests
  }

  test('first getEntry for an epoch builds, outcome "built"', async () => {
    const buildPrimitives = async () => [{ loadEpoch: 1, fragmentId: 1, ownerDbId: 1, modelId: 'm', worldBounds: { min: [0,0,0], max: [1,1,1] } }];
    const cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });
    const { outcome, builtAtRevision } = await cache.getEntry(1, /* expectedRevision */ 1);
    assert.equal(outcome, 'built');
    assert.equal(builtAtRevision, 1);
  });

  test('a second getEntry at the SAME revision hits the cache, outcome "hit", no rebuild', async () => {
    let buildCount = 0;
    const buildPrimitives = async () => { buildCount++; return []; };
    const cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });
    await cache.getEntry(1, 1);
    const second = await cache.getEntry(1, 1);
    assert.equal(second.outcome, 'hit');
    assert.equal(buildCount, 1);
  });

  test('a getEntry at a HIGHER revision than the cached entry rebuilds (growth staleness)', async () => {
    let buildCount = 0;
    const buildPrimitives = async () => { buildCount++; return []; };
    const cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });
    await cache.getEntry(1, 1);
    const second = await cache.getEntry(1, 2);
    assert.equal(second.outcome, 'built');
    assert.equal(buildCount, 2);
  });

  test('two concurrent getEntry calls for the same NEW epoch share one build (single-flight)', async () => {
    let buildCount = 0;
    let resolveBuild;
    const buildPrimitives = () => { buildCount++; return new Promise((resolve) => { resolveBuild = resolve; }); };
    const cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });
    const p1 = cache.getEntry(1, 1);
    const p2 = cache.getEntry(1, 1);
    resolveBuild([]);
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(buildCount, 1);
    // One of the two callers observes 'built', the other observes 'shared-wait'.
    assert.deepEqual([r1.outcome, r2.outcome].sort(), ['built', 'shared-wait']);
  });

  test('a build superseded by a NEWER revision arriving mid-build returns {outcome:"superseded"}, never published, and the caller\'s stale expectedRevision is never internally retried', async () => {
    // Start a build for revision 1 that resolves slowly; before it resolves, start (and let complete)
    // a SECOND getEntry(loadEpoch, 2) call, publishing revision 2. When the first call's build
    // resolves, assert its OWN getEntry(loadEpoch, 1) call returns {outcome: 'superseded'} -- never a
    // {bvh, ...} result, and never a THIRD build silently started for revision 1 by the cache itself.
    // A subsequent getEntry(loadEpoch, 2) (the caller re-deriving current state, simulating Task 13's
    // own retry contract) must return the published revision-2 entry directly ('hit'), proving no
    // regression occurred.
  });

  test('an epoch released (evicted/disposed) while its build is in flight never publishes; the resolved build is discarded, not replayed as a fresh build for the same epoch', async () => {
    // The second half of Critical #1: start a build, call releaseEntryForEpoch(loadEpoch) BEFORE it
    // resolves, then let it resolve -- assert getEntry for that SAME loadEpoch afterward does NOT
    // return the discarded build's bvh, and does not silently recreate an entry for a released epoch
    // via any internal retry path (loadEpoch is never reused per M1 invariant, so this cache must
    // never resurrect state for one).
  });

  test('releaseAll during an in-flight build has the same discard-not-publish effect as releaseEntryForEpoch', async () => {
  });

  test('releaseEntryForEpoch removes the cached entry; a later getEntry rebuilds fresh', async () => {
  });

  test('releaseAll clears every epoch\'s entry', async () => {
  });
  ```

- [ ] **Step 2: Run the tests, confirm FAIL.**

- [ ] **Step 3: Implement `TlasCache`**, mirroring `GeometryRegistry`'s insert-first-then-build /
  cancellation-race pattern (`GeometryRegistry.js:58-74,102-140,202-230`) with the one genuinely new
  mechanism the advisor consult flagged: **revision-aware staleness during an in-flight build**.

  ```js
  // collision/tlas/TlasCache.js
  import { CollisionInstanceBVH } from './CollisionInstanceBVH.js';

  export class TlasCache {
    constructor({ buildPrimitives, checkpointPort }) {
      if (typeof buildPrimitives !== 'function') {
        throw new TypeError('TlasCache requires buildPrimitives(loadEpoch)');
      }
      this._buildPrimitives = buildPrimitives;
      this._checkpointPort = checkpointPort;
      // Map<loadEpoch, Entry>. Entry = { state: 'building'|'ready', builtAtRevision, bvh,
      //   buildingForRevision, promise, released: boolean }. `released` is the fix for Critical #1's
      // second half: set by releaseEntryForEpoch/releaseAll on an entry that is still 'building' at
      // release time, so its eventual resolution can tell "I was torn down while in flight" apart
      // from "I am simply no longer the map's current entry because a newer build replaced me" --
      // both cases must discard, but only via the identity check (see _startBuild), so `released` is
      // read there defensively rather than being the SOLE guard (a released-then-immediately-deleted
      // entry is already caught by `current !== entry` since release also deletes the map slot).
      this._entries = new Map();
    }

    async getEntry(loadEpoch, expectedRevision) {
      const existing = this._entries.get(loadEpoch);
      if (existing?.state === 'ready' && existing.builtAtRevision === expectedRevision) {
        return { bvh: existing.bvh, builtAtRevision: existing.builtAtRevision, outcome: 'hit' };
      }
      if (existing?.state === 'building' && existing.buildingForRevision === expectedRevision) {
        // Single-flight: share the in-flight build for the SAME revision this caller expects.
        const result = await existing.promise;
        return result.outcome === 'superseded' ? result : { ...result, outcome: 'shared-wait' };
      }
      // Either never built, stale (existing.builtAtRevision !== expectedRevision, from growth or
      // invalidation), or an in-flight build is for a DIFFERENT (already-superseded) revision --
      // start a fresh build for the revision THIS caller actually wants.
      return this._startBuild(loadEpoch, expectedRevision);
    }

    async _startBuild(loadEpoch, expectedRevision) {
      const entry = {
        state: 'building', buildingForRevision: expectedRevision, bvh: null, builtAtRevision: null, released: false,
      };
      entry.promise = (async () => {
        const pending = this._checkpointPort.checkpoint({ loadEpoch });
        if (pending) await pending;
        const records = await this._buildPrimitives(loadEpoch);
        const bvh = new CollisionInstanceBVH(records);
        // Publish ONLY if this entry is STILL the one in the map (identity check -- a newer build
        // for a different revision, or a release, replaces/deletes the map slot without touching
        // this `entry` object) AND was never released while in flight. NEVER retry internally with
        // this build's own (now possibly-stale) `expectedRevision` -- return a `superseded` outcome
        // and let the CALLER (Task 13) re-derive the current expected revision fresh.
        const current = this._entries.get(loadEpoch);
        if (current === entry && !entry.released) {
          entry.state = 'ready';
          entry.bvh = bvh;
          entry.builtAtRevision = expectedRevision;
          return { bvh, builtAtRevision: expectedRevision, outcome: 'built' };
        }
        return { outcome: 'superseded' };
      })();
      this._entries.set(loadEpoch, entry); // insert-first-then-build, mirrors GeometryRegistry.js:70
      return entry.promise;
    }

    // Read-only accessor for Task 13's own refresh-trigger condition -- returns undefined for a
    // never-built or in-flight (not yet 'ready') epoch, which Task 13 treats as builtAtRevision = -1
    // (always stale relative to any real invalidation marker, closing codex-review's Critical #2).
    getBuiltAtRevision(loadEpoch) {
      const entry = this._entries.get(loadEpoch);
      return entry?.state === 'ready' ? entry.builtAtRevision : undefined;
    }

    releaseEntryForEpoch(loadEpoch) {
      const entry = this._entries.get(loadEpoch);
      if (entry && entry.state === 'building') entry.released = true; // in-flight build must discard on resolution
      this._entries.delete(loadEpoch);
    }

    releaseAll() {
      for (const entry of this._entries.values()) {
        if (entry.state === 'building') entry.released = true;
      }
      this._entries.clear();
    }
  }
  ```

  **Caller contract, restated for Task 13:** `getEntry` never loops internally. On `{outcome:
  'superseded'}`, Task 13's own traversal setup must re-validate liveness/disposal (via the composite
  checkpoint, which correctly throws if the epoch is genuinely gone), re-read
  `_placementRevisionByEpoch.get(epoch)` fresh, and call `getEntry` again with that current value —
  this converges in at most as many iterations as the revision has genuinely changed underneath the
  call, which Task 14's own placement-revalidation contract already bounds (a query racing real
  external change eventually aborts with `ModelPlacementChangedError` rather than retrying forever).

- [ ] **Step 4: Wire `_tlasCache` into `CollisionWorld`** — add the field in the constructor
  (`this._tlasCache = null;`, constructed in `fromViewer` once the `buildPrimitives` closure can
  reference `this._placementByEpoch`), and add its release calls to `_releaseEpochScopedState`/
  `dispose`:

  ```js
  // _releaseEpochScopedState(epoch):
  this._tlasCache?.releaseEntryForEpoch(epoch);
  // dispose():
  this._tlasCache?.releaseAll?.();
  ```

- [ ] **Step 5: Run all tests, fix until green, then commit.**

  ```bash
  git add collision/tlas/TlasCache.js collision/CollisionWorld.js test/tlas/TlasCache.test.mjs
  git commit -m "M2: add TlasCache with revision-aware lazy build, single-flight, release lifecycle"
  ```

**Completion criteria:** All tests pass, including the mid-build-supersession test; `releaseEntryForEpoch`/
`releaseAll` are wired into the exact same call sites `GeometryRegistry`'s own release calls already
use, held to the same non-throw contract `evictModel`/`dispose` already guarantee (wrap in the same
defensive `try/catch` pattern `_releaseEpochScopedState`'s existing `_registry.releaseEntriesForEpoch`
call uses, `:479-486`).

**Protected invariants:** `GeometryRegistry` itself is completely untouched — `TlasCache` is a
sibling, not a modification. A stale build is never published as the cache's current entry.

**Viewer/API evidence verification required:** None.

---

## Task 11: `invalidateModelPlacement(model)` and staged/atomic-publish refresh

**Files:**
- Modify: `collision/CollisionWorld.js` (new public method, new field
  `_placementInvalidatedAtRevision`)
- Modify: `collision/index.js` (no new export needed — `invalidateModelPlacement` is a
  `CollisionWorld` instance method, already reachable through the exported class)
- Test: `test/CollisionWorld.placementInvalidation.test.mjs`

**Prerequisite tasks:** Task 9 (placement index/revision), Task 10 (`TlasCache`, since a refresh's
"rebuild" step is exactly `TlasCache.getEntry` with a bumped expected revision).

**Interfaces:**
- Produces: `world.invalidateModelPlacement(model): void` — throws `WorldDisposedError`/
  `ModelEvictedError`, no-ops for a never-admitted model, otherwise bumps
  `_placementRevisionByEpoch`/`_placementInvalidatedAtRevision` and stages a refresh consumed by the
  next TLAS-backed query for that epoch (Task 13/14).

**Implementation steps:**

- [ ] **Step 1: Write the failing tests:**

  ```js
  test('invalidateModelPlacement throws WorldDisposedError on a disposed world', async () => {});
  test('invalidateModelPlacement throws ModelEvictedError for an evicted model', async () => {});
  test('invalidateModelPlacement no-ops for a never-admitted model', async () => {});

  test('invalidateModelPlacement bumps _placementRevisionByEpoch and records the invalidation marker', async () => {
    // Assert (via a test-only accessor or observable effect through TlasCache) that the revision
    // strictly increased and a subsequent TLAS-consuming query re-reads worldMatrix/worldBounds
    // fresh rather than serving the stale cached placement.
  });

  test('a staged refresh re-reads worldMatrix/worldBounds via the SAME primitives extractFragments uses', async () => {
    // Move a fragment's fake world position between the initial extraction and invalidateModelPlacement,
    // then assert the NEXT TLAS-consuming query observes the NEW position, not the original one.
  });

  test('refresh is atomic: a concurrent read during the refresh never observes a mixed pre/post state', async () => {
    // Simulate two overlapping invalidation/rebuild cycles (Task 10's mid-build supersession path)
    // and assert _placementByEpoch's published map is always fully-old or fully-new, never partial.
  });

  test('a failed compare-and-publish check discards the staged refresh; the next attempt retries and succeeds', async () => {
    // A second invalidation lands while the first refresh is still reading Viewer state -- assert the
    // first refresh's staged data is discarded (never published), and a subsequent query still ends
    // up correct against whichever invalidation is actually current.
  });

  test('invalidation BEFORE the epoch\'s first-ever TLAS build is still honored, not silently ignored', async () => {
    // The exact scenario codex-review's Critical #2 finding described: extraction records model B's
    // placement, invalidateModelPlacement(B) is called, and ONLY THEN does the first-ever TLAS query
    // for B's epoch run -- assert the query's own trigger condition (Task 13) treats "no cached entry
    // yet" as builtAtRevision === -1 (always stale relative to any real invalidation marker), so the
    // first build refreshes from current Viewer state rather than building directly from the
    // now-stale _placementByEpoch records extraction originally wrote.
  });
  ```

  **Interface contract clarification, added after `codex-review`'s Question #1:** `_refreshPlacementForEpoch`'s
  `{published: false}` return is an internal, single-attempt signal, distinct from the public
  `ModelPlacementChangedError` Task 14 throws. A `published: false` result means Task 13's own
  in-flight attempt must retry — re-read `_placementRevisionByEpoch`/`_placementInvalidatedAtRevision`
  fresh and re-enter the refresh-or-build path — never a caller-visible throw by itself. `Task 14`'s
  `ModelPlacementChangedError` is reserved for the composite checkpoint's cross-query detection of an
  externally-caused revision change relative to a query's own `expectedRevisionByEpoch` (§9.2 point 8)
  — a different, public-facing contract than this task's internal retry loop. Task 13 must bound this
  internal retry (e.g., abort via the composite checkpoint's own liveness/placement checks, which will
  correctly throw `ModelEvictedError`/`ModelPlacementChangedError` if the retry loop is racing a
  genuinely concurrent external change) rather than looping unboundedly against a well-behaved single
  invalidation, which resolves in at most one retry.

- [ ] **Step 2: Run the tests, confirm FAIL.**

- [ ] **Step 3: Add `_placementInvalidatedAtRevision: Map<loadEpoch, revision>`** to the constructor,
  alongside Task 9's two fields, and release it at the same two boundaries Task 9's fields already
  are (`codex-review` flagged this table's release was missing from Task 9's own Step 5 — Task 9 was
  written before this table existed; add it here instead of retroactively editing Task 9):

  ```js
  // _releaseEpochScopedState(epoch):
  this._placementInvalidatedAtRevision.delete(epoch);
  // dispose():
  this._placementInvalidatedAtRevision.clear();
  ```

  Add a test confirming `_placementInvalidatedAtRevision` does not leak a stale marker past
  `evictModel`/`dispose` (observable indirectly: a re-admitted... no, `loadEpoch` is never reused, so
  simply assert the marker is gone via whatever internal test accessor this task's other tests already
  use, or by confirming no future TLAS build for a *different* epoch is ever spuriously treated as
  invalidation-stale because of a leftover entry keyed by a numerically-coincidental epoch value —
  impossible by construction since `loadEpoch` is global/monotonic/never reused, but assert the
  `Map.delete`/`.clear()` calls directly via a test-only accessor for defense in depth).

- [ ] **Step 4: Implement `invalidateModelPlacement`:**

  ```js
  invalidateModelPlacement(model) {
    if (this._disposed) throw new WorldDisposedError();
    const entry = this._modelLifecycle.get(model);
    if (entry?.state === 'evicted') throw new ModelEvictedError(modelIdOf(model));
    if (!entry) return; // never admitted -- nothing to invalidate
    const epoch = entry.epoch;
    const revision = (this._placementRevisionByEpoch.get(epoch) ?? 0) + 1;
    this._placementRevisionByEpoch.set(epoch, revision);
    this._placementInvalidatedAtRevision.set(epoch, revision);
  }
  ```

- [ ] **Step 5: Implement the staged/atomic-publish refresh**, triggered from Task 13's TLAS-consuming
  query path when it observes `entry.builtAtRevision !== _placementRevisionByEpoch.get(epoch)` **and**
  `_placementInvalidatedAtRevision.get(epoch) >= entry.builtAtRevision` (an invalidation happened since
  the cached entry was built, not just ordinary growth):

  ```js
  // Called from the TLAS-consuming query path (Task 13) before rebuilding a stale-due-to-invalidation
  // TlasCache entry. Re-reads worldMatrix/worldBounds fresh for every fragmentId ALREADY present in
  // _placementByEpoch.get(epoch), via the exact same primitives extractFragments uses
  // (fragList.getWorldMatrix/getWorldBounds, ViewerModelAdapter.js:37-48) -- never touching the shared
  // map until the compare-and-publish step below succeeds.
  async _refreshPlacementForEpoch(epoch, expectedRevision, expectedInvalidationRevision) {
    const model = this._modelByEpoch.get(epoch);
    const current = this._placementByEpoch.get(epoch);
    const fragList = model.getFragmentList();
    const staged = new Map();
    const scratchMatrix = new (globalThis.THREE).Matrix4();
    const scratchBox = new (globalThis.THREE).Box3();
    for (const [fragmentId, oldRecord] of current) {
      fragList.getWorldMatrix(fragmentId, scratchMatrix);
      fragList.getWorldBounds(fragmentId, scratchBox);
      staged.set(fragmentId, {
        worldMatrix: Float64Array.from(scratchMatrix.elements),
        worldBounds: { min: [scratchBox.min.x, scratchBox.min.y, scratchBox.min.z], max: [scratchBox.max.x, scratchBox.max.y, scratchBox.max.z] },
        ownerDbId: oldRecord.ownerDbId, modelId: oldRecord.modelId, // carried over unchanged
      });
      // Yield periodically for a large epoch (same discipline extractFragments's own subtree walk
      // already uses) -- wire through this call's checkpoint port; omitted here for brevity, REQUIRED
      // in the real implementation.
    }
    // Compare-and-publish, synchronous, no further await in between:
    if (this._disposed) throw new WorldDisposedError();
    if (!this._isEpochLive(epoch)) throw new ModelEvictedError(modelIdOf(model));
    if (
      this._placementRevisionByEpoch.get(epoch) !== expectedRevision
      || this._placementInvalidatedAtRevision.get(epoch) !== expectedInvalidationRevision
    ) {
      // Superseded by a second invalidation/growth while this refresh was reading Viewer state --
      // discard the staged map entirely. Do NOT clear _placementInvalidatedAtRevision -- that would
      // erase the SECOND invalidation's own marker.
      return { published: false };
    }
    this._placementByEpoch.set(epoch, staged);
    this._placementInvalidatedAtRevision.delete(epoch); // this refresh's own captured revision is still current
    return { published: true };
  }
  ```

- [ ] **Step 6: Run all tests, fix until green, then commit.**

  ```bash
  git add collision/CollisionWorld.js test/CollisionWorld.placementInvalidation.test.mjs
  git commit -m "M2: invalidateModelPlacement with staged, atomically-published placement refresh"
  ```

**Completion criteria:** All tests pass, including the concurrent-invalidation discard/retry test;
`npm test` shows zero regressions.

**Protected invariants:** `_placementByEpoch`'s shared map is never mutated in place mid-refresh — only
swapped wholesale at the compare-and-publish step. `invalidateModelPlacement` never touches
`_instanceCache`, `_modelByEpoch`, `_modelLifecycle`, or `_liveEpochs` (spec §6.7.6).

**Viewer/API evidence verification required:** Confirm `fragList.getWorldMatrix`/`getWorldBounds`
behave identically when called a second time for an already-extracted fragment (i.e., re-reading is
safe and returns current, not cached-from-first-call, values) — this should already be implicit in
how the real Viewer's `FragmentList` works (extraction already assumes fresh reads on every call,
`ViewerModelAdapter.js`'s own header comment), but confirm explicitly rather than assume, since this
is the one place M2 re-reads a fragment's placement a second time within the same epoch's lifetime.

---

# Batch 4 — TLAS traversal integration

## Task 12: Target-scope membership filter and duplicate-`targets`-entry union

**Files:**
- Modify: `collision/CollisionWorld.js` (new helper, consumed by Task 13)
- Test: `test/CollisionWorld.tlasTraversal.test.mjs` (shared with Task 13 — see that task's own test
  list; this task's tests are the subset exercising the filter in isolation)

**Prerequisite tasks:** Task 6 (target normalization/lease collapsing already exists at the lease
level; this task extends the collapsing to the **filter** level, per spec §7.1a's own note that the
first draft's §9.2 point 1 only addressed leases, not filters).

**Interfaces:**
- Produces: a per-call, per-target-model membership filter:
  `buildTargetScopeFilter(targetsEntries) -> Map<Model, Set<fragmentId> | 'whole-model'>`, consumed
  by Task 13's per-candidate filtering step.

**Implementation steps:**

- [ ] **Step 1: Write the failing tests:**

  ```js
  test('an explicit-dbIds targets entry filters TLAS candidates to that entry\'s extracted fragment set', async () => {});

  test('an assembly-rooted targets entry does NOT false-negative-exclude its own descendant fragments', async () => {
    // The exact bug the targeted design-resolution pass found and fixed in already-accepted text
    // (spec §7.1a): a filter comparing ownerDbId directly against requested dbIds would wrongly
    // exclude every descendant fragment of an assembly-rooted target request.
  });

  test('two targets entries naming the same model union their extracted-fragment-membership sets', async () => {});

  test('if ANY duplicate targets entry for a model omits dbIds, whole-model scope wins for that epoch', async () => {});

  test('a targets entry with dbIds omitted applies no filter at all (every matched primitive is in scope)', async () => {});
  ```

- [ ] **Step 2: Run the tests, confirm FAIL.**

- [ ] **Step 3: Implement the filter builder:**

  ```js
  // Built ONCE per findClashes call (not per candidate) -- the cost of computing each entry's own
  // extracted-fragment-membership set is paid once, per spec §7.1a's own stated cost model.
  async function buildTargetScopeFilter(targetsEntries, extractFragmentsFn, checkpoint) {
    const filterByModel = new Map(); // Model -> Set<fragmentId> | 'whole-model'
    for (const entry of targetsEntries) {
      if (entry.dbIds === undefined) {
        filterByModel.set(entry.model, 'whole-model'); // whole-model always wins, even over a coexisting narrower entry
        continue;
      }
      if (filterByModel.get(entry.model) === 'whole-model') continue; // already whole-model, nothing narrower can override it
      const extracted = await extractFragmentsFn(entry.model, entry.dbIds, /* epoch */ undefined, { checkpoint });
      const existing = filterByModel.get(entry.model);
      const union = existing instanceof Set ? existing : new Set();
      for (const fragmentId of extracted.keys()) union.add(fragmentId);
      filterByModel.set(entry.model, union);
    }
    return filterByModel;
  }
  ```

  Reconcile this against Task 6/8's own extraction call sites during implementation — this filter
  should reuse the SAME extraction result Task 8 already computed for target-instance construction,
  not re-extract a second time; wire it as a byproduct of that existing extraction step rather than a
  separate pass, and adjust this helper's signature accordingly once the real call site is in hand.

- [ ] **Step 4: Run all tests, fix until green, then commit.**

  ```bash
  git add collision/CollisionWorld.js test/CollisionWorld.tlasTraversal.test.mjs
  git commit -m "M2: target-scope membership filter with assembly-rooted correctness and duplicate-entry union"
  ```

**Completion criteria:** All tests pass, including the assembly-rooted false-negative regression test
(this is the one place this plan explicitly re-tests a bug the spec's own review process already
found and fixed in the design document — verifying it in code, not just in the spec text, is the
point of this task).

**Protected invariants:** The filter is per-call, never baked into the cached `TlasEntry` itself
(spec §7.1a's own closing note) — the same cached tree must correctly serve both a narrow
explicit-`dbIds` query and a later whole-model query against the same epoch.

**Viewer/API evidence verification required:** None.

---

## Task 13: TLAS per-source-instance traversal, candidate budget, exact retest, statistics (one atomic integration task)

**Files:**
- Modify: `collision/CollisionWorld.js` (`findClashes`'s broad-phase dispatch, new
  `_runTlasBroadPhase` method)
- Test: `test/CollisionWorld.tlasTraversal.test.mjs`

**Prerequisite tasks:** Tasks 3 (`CollisionInstanceBVH`), 9 (placement index), 10 (`TlasCache`), 12
(target-scope filter). This is deliberately kept as **one** task per the architecture consult's own
recommendation: budget accounting, filtering, exact retesting, and statistics have a binding execution
order (`expand → budget count → scope/self filters → broadPhasePairs++ → exact retest → survivor`) —
splitting it across separate commits risks a window where a stage is miscounted or an unbounded
candidate array accumulates before the budget applies.

**Interfaces:**
- Produces: `broadPhase: 'tlas'` becomes a real, working option on `findClashes` for the new `targets`
  shape (its default per spec §3.5); every one of the 9 new `Statistics` fields is populated
  correctly, satisfying the inequality chain in §7.5.2.

**Implementation steps:**

- [ ] **Step 1: Write the failing tests — correctness first, statistics second:**

  ```js
  // test/CollisionWorld.tlasTraversal.test.mjs (extends Task 12's file)

  test('broadPhase:"tlas" and broadPhase:"linear" produce IDENTICAL pairs for the same cross-model fixture', async () => {
    // The core differential requirement (spec §7.3, §12.1) -- run the SAME query twice, assert
    // deepEqual on the pairs SET (order-independent comparison, per collision/README.md's own
    // "insertion-order, not canonicalized" disclaimer).
  });

  test('a TLAS-coarse false-positive candidate (AABBs overlap, exact volumes do not) is discarded by the retest', async () => {
    // Confirms _testBroadPhasePair (reused verbatim) still gates every TLAS-emitted candidate before
    // narrow phase, exactly as the linear path already does.
  });

  test('maxTlasCandidatePairs is enforced incrementally, exhaustion throws CapacityExceededError(tlas-candidate-budget)', async () => {
    // Assert exhaustion is detected DURING expansion (before target-scope filtering/self-exclusion),
    // per spec §9.3.1's explicit "upstream of both filters" requirement -- construct a fixture where
    // the budget would be exceeded by RAW candidate expansion even though most of those candidates
    // would later be filtered out, and assert the throw still happens.
  });

  test('budget exhaustion throws AFTER the traversal call returns, never from inside a shapecast callback', async () => {
    // Verify via CollisionInstanceBVH's own queryBox "truncated" signal (Task 3) -- the budget check
    // uses queryBox's normal early-termination convention, never throws synchronously mid-traversal.
  });

  test('budget scope is whole-call, not per-source-instance or per-(sourceEpoch,targetEpoch) pair', async () => {
    // A call touching MANY small target epochs, none individually near the limit, but whose SUM
    // exceeds maxTlasCandidatePairs, must still throw.
  });

  test('statistics inequality chain holds for a real TLAS-path call', async () => {
    const { statistics } = await world.findClashes({ /* ... */ broadPhase: 'tlas' });
    assert.ok(statistics.tlasPrimitiveCandidatePairs >= statistics.broadPhasePairs);
    assert.ok(statistics.broadPhasePairs >= statistics.tlasExactRetestSurvivors);
    assert.equal(statistics.tlasExactRetestSurvivors, statistics.tlasNarrowPhaseInputPairs);
    assert.equal(statistics.tlasNarrowPhaseInputPairs, statistics.narrowPhasePairs);
  });

  test('tlasBuilds/tlasCacheHits/tlasSharedBuildWaits correctly attribute a cold build vs. a warm reuse', async () => {
    // First call against a fresh epoch: tlasBuilds >= 1, tlasCacheHits === 0.
    // Second call against the SAME still-live, unchanged epoch: tlasCacheHits >= 1, tlasBuilds === 0
    // for that epoch's own lookup (a different epoch in the same call may still build).
  });

  test('tlasBuildMs is 0 for a call that only awaited another caller\'s shared build (attributed via tlasSharedBuildWaits instead)', async () => {
  });

  test('a TLAS build failure aborts the whole call as an error, never as "no candidates from this epoch"', async () => {
  });
  ```

- [ ] **Step 2: Run the tests, confirm FAIL.**

- [ ] **Step 3: Implement `_runTlasBroadPhase`**, the per-source-instance query loop:

  ```js
  // Resolves a TLAS-matched record back to a full PlacedInstance-equivalent -- CollisionInstanceBVH's
  // own records (Task 3) carry {loadEpoch, fragmentId, ownerDbId, modelId, worldBounds}, not a
  // worldMatrix or a reference to the epoch's CollisionInstance. Task 14 needs the identical
  // resolution, hence a shared named helper rather than inlining it here.
  _resolvePlacedFromTlasRecord(epoch, record) {
    const placement = this._placementByEpoch.get(epoch).get(record.fragmentId); // Task 9's table -- has worldMatrix
    const instance = this._instanceCache.get(epoch).get(record.fragmentId); // admitted CollisionInstance
    return Object.freeze({ instance, worldMatrix: placement.worldMatrix, worldBounds: record.worldBounds, ownerDbId: record.ownerDbId });
  }

  // Fetches this epoch's TLAS entry against the CURRENT expected revision, refreshing placement first
  // if an invalidation is pending, and retrying on TlasCache's own {outcome:'superseded'} signal by
  // re-deriving the current revision fresh each time -- NEVER retrying with a stale value (Task 10's
  // corrected caller contract, codex-review Critical #1).
  async _getTlasEntryForEpoch(epoch) {
    for (;;) {
      // Re-validate liveness on every iteration -- a retry loop racing a genuine eviction must abort,
      // not spin. (Full disposed/evicted/placement-revision precedence is enforced by the composite
      // checkpoint at its own call sites in findClashes; this is an additional, local guard specific
      // to this retry loop's own safety.)
      if (this._disposed) throw new WorldDisposedError();
      if (!this._isEpochLive(epoch)) throw new ModelEvictedError(modelIdOf(this._modelByEpoch.get(epoch)));

      let expectedRevision = this._placementRevisionByEpoch.get(epoch) ?? 0;
      const invalidatedAt = this._placementInvalidatedAtRevision.get(epoch);
      // Fixed after codex-review (Critical #2): the first draft only refreshed when a CACHED entry
      // already existed (`cachedEntry && invalidatedAt >= cachedEntry.builtAtRevision`), silently
      // skipping refresh for an epoch's FIRST-EVER TLAS build even when an invalidation happened
      // after extraction wrote the (now-stale) placement records. Treat "no cached entry yet" as
      // builtAtRevision === -1, which is always < any real invalidation revision, so a pending
      // invalidation is honored even on a cold first build.
      const cachedBuiltAtRevision = this._tlasCache.getBuiltAtRevision(epoch) ?? -1; // Task 10's own read-only accessor
      if (invalidatedAt !== undefined && invalidatedAt >= cachedBuiltAtRevision) {
        const { published } = await this._refreshPlacementForEpoch(epoch, expectedRevision, invalidatedAt);
        if (!published) continue; // superseded by a second invalidation/growth mid-refresh -- retry with fresh state
        expectedRevision = this._placementRevisionByEpoch.get(epoch); // re-read: the refresh may have changed it
      }

      const result = await this._tlasCache.getEntry(epoch, expectedRevision);
      if (result.outcome === 'superseded') continue; // Task 10's contract: never retry with the stale value that was just superseded
      return result;
    }
  }

  async _runTlasBroadPhase(sourceOperand, sourceInstances, targetGroups, targetScopeFilter, statistics, checkpoint) {
    const candidates = [];
    let candidateBudgetUsed = 0;
    let pendingCapacityError = null;

    outer: for (const group of targetGroups) {
      const buildStartedAt = this._now();
      const { bvh, outcome } = await this._getTlasEntryForEpoch(group.epoch);
      const buildElapsed = this._now() - buildStartedAt;
      if (outcome === 'built') { statistics.tlasBuilds++; statistics.tlasBuildMs += buildElapsed; }
      else if (outcome === 'shared-wait') { statistics.tlasSharedBuildWaits++; }
      else { statistics.tlasCacheHits++; }

      const modelFilter = targetScopeFilter.get(group.model);
      const scopeFragmentSet = modelFilter instanceof Set ? modelFilter : null; // null = whole-model, no filter

      for (const sourcePlaced of sourceInstances) {
        const pending = checkpoint({ label: 'tlas-broad-phase-query', loadEpoch: sourceOperand.epoch });
        if (pending) await pending;

        const queryStartedAt = this._now();
        const [minX, minY, minZ] = sourcePlaced.worldBounds.min;
        const [maxX, maxY, maxZ] = sourcePlaced.worldBounds.max;
        const { truncated } = bvh.queryBox([minX, minY, minZ], [maxX, maxY, maxZ], {
          onLeafRange: () => { statistics.tlasLeafRangeEmissions++; }, // stage 1, per Task 3's dual-callback fix
          onCandidate: (builderPositionIndex) => {
            candidateBudgetUsed++;
            statistics.tlasPrimitiveCandidatePairs++; // stage 2, upstream of filtering, per spec §9.3.1
            if (candidateBudgetUsed > maxTlasCandidatePairs) {
              pendingCapacityError = new CapacityExceededError('tlas-candidate-budget', {
                limit: maxTlasCandidatePairs, completed: maxTlasCandidatePairs, attempted: candidateBudgetUsed,
                sourceEpoch: sourceOperand.epoch, targetEpoch: group.epoch,
              });
              return 'stop';
            }
            const record = bvh.recordAt(builderPositionIndex); // the ONLY valid resolution path, per Task 3's fix
            if (scopeFragmentSet && !scopeFragmentSet.has(record.fragmentId)) return undefined; // filtered out, not a candidate
            if (isSourceOwnFragment(sourceOperand, group.epoch, record.fragmentId)) return undefined; // self-excluded
            const targetPlaced = this._resolvePlacedFromTlasRecord(group.epoch, record);
            statistics.broadPhasePairs++; // counted immediately before the exact predicate, matching Task 8's corrected ordering
            if (this._testBroadPhasePair(sourcePlaced, targetPlaced)) {
              candidates.push([sourcePlaced, targetPlaced, { model: group.model, epoch: group.epoch }]);
            }
            return undefined;
          },
        });
        statistics.tlasQueryMs += this._now() - queryStartedAt;
        if (truncated && pendingCapacityError) break outer; // stop ALL further traversal, throw below
      }
    }
    if (pendingCapacityError) throw pendingCapacityError; // thrown AFTER every traversal call returned (spec §9.3.3)
    statistics.tlasExactRetestSurvivors = candidates.length; // stage-3 count
    statistics.tlasNarrowPhaseInputPairs = candidates.length; // == retest survivors, spec §7.1b's no-dedup guarantee
    return candidates;
  }
  ```

`TlasCache.getBuiltAtRevision(loadEpoch)` is Task 10's own read-only accessor (added there, not an
  internal reach-in) — a completed prerequisite by the time this task starts.

- [ ] **Step 4: Wire `findClashes`'s broad-phase dispatch** on `query.broadPhase` (defaulting per
  spec §3.5's shape-dependent rule, already partially wired in Task 8):

  ```js
  const candidates = query.broadPhase === 'tlas'
    ? await this._runTlasBroadPhase(sourceOperand, sourceInstances, targetGroups, targetScopeFilter, statistics, checkpoint)
    : await this._runBroadPhaseScan(sourceOperand, sourceInstances, targetGroups, statistics, checkpoint);
  ```

- [ ] **Step 5: Run all tests, iterate until every correctness and statistics test passes.** This is
  the highest-risk task in the plan — do not proceed to Task 14 until the full differential test
  (`broadPhase:'tlas'` vs `'linear'` producing identical `pairs`) passes for every fixture this task's
  own test file constructs, not just a single trivial case.

- [ ] **Step 6: Commit.**

  ```bash
  git add collision/CollisionWorld.js test/CollisionWorld.tlasTraversal.test.mjs
  git commit -m "M2: TLAS per-source-instance traversal with candidate budget, exact retest, statistics"
  ```

**Completion criteria:** Every test in Step 1 passes; the `broadPhase:'tlas'` vs `'linear'` differential
holds for every fixture constructed so far in this plan (Tasks 6-8's cross-model fixtures, re-run
against both broad-phase modes); the statistics inequality chain holds; a budget-exhaustion throw
never originates from inside a `shapecast`/`queryBox` callback (verified via Task 3's own
callback-containment test still passing after this task's real usage is wired in).

**Protected invariants:** `_testBroadPhasePair` is reused verbatim, never re-implemented for the TLAS
path. The TLAS candidate set may be a superset of the linear oracle's candidate set (coarser node
bounds), but the **post-retest, post-narrow-phase result set must be exactly equal** between the two
paths — this is the one invariant this task must never compromise, even under time pressure to
"simplify" the traversal.

**Viewer/API evidence verification required:** None (pure library-internal integration, though it
consumes Task 2's evidence transitively through Task 5/12's target extraction).

---

## Task 14: Placement-revision revalidation on the composite checkpoint

**Files:**
- Modify: `collision/CollisionWorld.js` (`createCompositeCheckpointPort` from Task 6, extended)
- Test: `test/CollisionWorld.placementInvalidation.test.mjs` (extend from Task 11)

**Prerequisite tasks:** Task 6 (composite checkpoint), Task 11 (`invalidateModelPlacement`,
`_placementInvalidatedAtRevision`), Task 13 (TLAS path, since this revalidation is scoped to
`broadPhase:'tlas'` operands only).

**Interfaces:**
- Produces: the composite checkpoint (Task 6) additionally compares each captured epoch's current
  `_placementRevisionByEpoch` against the query's own tracked `expectedRevisionByEpoch` (not the
  entry-time snapshot — spec §6.7.5's query-self-invalidation-avoidance rule), throwing
  `ModelPlacementChangedError` on an externally-caused mismatch, scoped to epochs the call actually
  consults via `broadPhase:'tlas'`.

**Implementation steps:**

- [ ] **Step 1: Write the failing tests:**

  ```js
  test('an externally-caused placement-revision change on a captured TLAS-consulted epoch aborts the whole query', async () => {
    // Cross-model TLAS query captures epochs A and B; a DIFFERENT concurrent findClashes call admits
    // new fragments into B mid-query (or invalidateModelPlacement(B) is called from outside) -- assert
    // ModelPlacementChangedError, not a partial/stale result.
  });

  test('the query does NOT invalidate itself via its own ordinary extraction growth (spec §6.7.5)', async () => {
    // A cross-model query whose OWN extraction admits genuinely new fragments into one of its own
    // captured epochs must NOT abort itself -- assert success, not a false-positive ModelPlacementChangedError.
  });

  test('the pre-insertion compare-and-abort check catches a foreign revision bump BEFORE this query\'s own insertion', async () => {
    // The specific gap the disposition report's own self-caught fix addresses (§6.7.5): without the
    // pre-insertion check, a query could silently absorb a foreign bump into its own bookkeeping.
  });

  test('placement-revision revalidation is scoped to broadPhase:"tlas" epochs only', async () => {
    // A pure broadPhase:'linear' call, which never reads _placementByEpoch/a cached TLAS, must NOT
    // abort on unrelated concurrent growth in a captured model -- assert success.
  });

  test('ModelPlacementChangedError carries modelId, loadEpoch, expectedRevision, actualRevision', async () => {
  });

  test('validation precedence at every checkpoint: disposed -> evicted -> placement-revision mismatch', async () => {
    // Construct a scenario where BOTH a disposal and a placement-revision mismatch are simultaneously
    // true at a checkpoint -- assert WorldDisposedError wins, matching the existing convention.
  });
  ```

- [ ] **Step 2: Run the tests, confirm FAIL.**

- [ ] **Step 3: Extend the composite checkpoint** (Task 6's `createCompositeCheckpointPort`) with a
  per-query `expectedRevisionByEpoch: Map<epoch, revision>`, initialized at query entry for every
  captured epoch actually consulted via `broadPhase:'tlas'`:

  ```js
  createCompositeCheckpointPort(leases, capturedEpochs, tlasConsultedEpochs) {
    const realCheckpoint = this.createCheckpointPort(leases[0]);
    const expectedRevisionByEpoch = new Map(
      [...tlasConsultedEpochs].map((epoch) => [epoch, this._placementRevisionByEpoch.get(epoch) ?? 0]),
    );
    const port = (ctx = {}) => {
      if (this._disposed) throw new WorldDisposedError();
      for (const epoch of capturedEpochs) {
        if (!this._isEpochLive(epoch)) {
          const evictedModel = leases.find((l) => l.epoch === epoch)?.model;
          throw new ModelEvictedError(modelIdOf(evictedModel));
        }
      }
      for (const [epoch, expected] of expectedRevisionByEpoch) {
        const actual = this._placementRevisionByEpoch.get(epoch) ?? 0;
        if (actual !== expected) {
          const model = this._modelByEpoch.get(epoch);
          throw new ModelPlacementChangedError({ modelId: modelIdOf(model), loadEpoch: epoch, expectedRevision: expected, actualRevision: actual });
        }
      }
      return realCheckpoint(ctx);
    };
    // Exposed so this query's OWN growth-triggered insertions (Task 9's _recordPlacement) can update
    // this SAME map after their own pre-insertion compare-and-abort check passes (Step 4 below).
    port.expectedRevisionByEpoch = expectedRevisionByEpoch;
    return port;
  }
  ```

- [ ] **Step 4: Implement the pre-insertion compare-and-abort in `_recordPlacement`** (Task 9),
  threading the query's own `expectedRevisionByEpoch` map through:

  ```js
  // Extended signature: _recordPlacement(epoch, model, extractedRecords, expectedRevisionByEpoch)
  // Called ONLY for a captured epoch this query is tracking (expectedRevisionByEpoch has an entry).
  _recordPlacement(epoch, model, extractedRecords, expectedRevisionByEpoch) {
    if (expectedRevisionByEpoch?.has(epoch)) {
      const currentRevision = this._placementRevisionByEpoch.get(epoch) ?? 0;
      if (currentRevision !== expectedRevisionByEpoch.get(epoch)) {
        // A DIFFERENT write already happened that this query never accounted for -- abort BEFORE
        // attempting this query's own insertion (spec §6.7.5's pre-insertion check).
        const m = this._modelByEpoch.get(epoch);
        throw new ModelPlacementChangedError({
          modelId: modelIdOf(m), loadEpoch: epoch,
          expectedRevision: expectedRevisionByEpoch.get(epoch), actualRevision: currentRevision,
        });
      }
    }
    // ... existing write-once-per-fragment body from Task 9 ...
    if (grew) {
      const newRevision = (this._placementRevisionByEpoch.get(epoch) ?? 0) + 1;
      this._placementRevisionByEpoch.set(epoch, newRevision);
      if (expectedRevisionByEpoch?.has(epoch)) {
        // Synchronous, same step, before any further await: sync this query's OWN bookkeeping so its
        // own growth is never later mistaken for an external change.
        expectedRevisionByEpoch.set(epoch, newRevision);
      }
    }
  }
  ```

- [ ] **Step 5: Run all tests, fix until green, then commit.**

  ```bash
  git add collision/CollisionWorld.js test/CollisionWorld.placementInvalidation.test.mjs
  git commit -m "M2: placement-revision revalidation on the composite checkpoint, self-invalidation-avoidance"
  ```

**Completion criteria:** All tests pass, including the query-self-invalidation-avoidance and
pre-insertion-check tests, which are the two gaps the design-resolution pass's own self-caught
consistency check found and fixed in the spec text — this task must demonstrate both are actually
implemented, not just documented.

**Protected invariants:** Validation precedence is exactly disposed → evicted → placement-revision
mismatch, at every checkpoint. A `broadPhase:'linear'` call never consults or is aborted by
`_placementRevisionByEpoch`.

**Viewer/API evidence verification required:** None.

---

# Batch 5 — Viewer UI/federation

## Task 15: `ClashFinderExtension`

**Files:**
- Create: `wwwroot/extensions/ClashFinderExtension.js`
- Test: `test/ClashFinderExtension.test.mjs`

**Prerequisite tasks:** Batch 4 complete (needs a working `findClashes({targets, broadPhase:'tlas'})`
end-to-end).

**Interfaces:**
- Consumes: `CollisionWorld.fromViewer`, `findClashes`, `collision/index.js`'s public exports only
  (per `RoomLocatorExtension.js`'s own header-comment discipline: "Depends ONLY on CollisionWorld's
  public surface... never reaches into CollisionWorld internals").
- Consumes Viewer APIs: `viewer.getAggregateSelection()`, `viewer.getAllModels()`,
  `viewer.isolate(dbIds, model)`, `viewer.fitToView(dbIds, model)` — all four confirmed present in
  `node_modules/@types/forge-viewer/index.d.ts` at lines 1267, 1272, 1250, 1313 respectively during
  this planning pass.

**Implementation steps:**

- [ ] **Step 1: Write the failing tests**, mirroring `test/RoomLocatorExtension.test.mjs`'s own
  headless-Node fixture pattern (a `typeof Autodesk !== 'undefined'` guard, a minimal `ExtensionBase`
  stand-in):

  ```js
  test('context-menu entry appears only when aggregate selection is exactly one model, one dbId', () => {});
  test('context-menu entry does NOT appear for no selection', () => {});
  test('context-menu entry does NOT appear for multiple models or multiple dbIds selected', () => {});
  test('Find Clashes calls findClashes with targets built from viewer.getAllModels(), source excluded via extraction', async () => {});
  test('"<N> clashes found" / "No clashes found" reporting matches result.pairs.length', async () => {});
  test('same-model vs cross-model classification compares pair.target.model against source model by ===, never modelId', async () => {});
  test('isolate/fitToView are called per involved Model object, not a bare dbId array with no model arg', async () => {});
  test('clearing/restoring visualization calls viewer.isolate([], model) per involved model', async () => {});
  test('non-empty diagnostics surface a visible caveat, reusing describeDiagnostics-equivalent pattern, never silently "no clashes"', async () => {});

  test('a stale in-flight Find Clashes result never overwrites a NEWER selection\'s visualization', async () => {
    // Addresses codex-review's Question #2: overlapping context-menu actions (the user right-clicks
    // a second element before the first Find Clashes call resolves) must not let the SLOWER, older
    // call's isolate/fitToView run after the newer one already did. Use a monotonically increasing
    // per-invocation action token: each onContextMenu target() captures the current token at click
    // time, and only applies isolate/fitToView/notify if that token is still the extension's own
    // "latest" token when the async findClashes call resolves -- a superseded call's result is
    // discarded silently (no error surfaced for a merely-superseded, not failed, request).
  });
  ```

- [ ] **Step 2: Run the tests, confirm FAIL.**

- [ ] **Step 3: Implement `ClashFinderExtension`**, structured exactly like `RoomLocatorExtension.js`
  (`load`/`unload`, `_onBeforeModelUnload` evicting per-model state, `onContextMenu`,
  `_notifyUser`/`describeDiagnostics`-equivalent), but using `getAggregateSelection()`/
  `getAllModels()` per spec §11.2 rather than `getSelection()`, and passing `model` explicitly to
  every `isolate`/`fitToView` call. Do not couple this extension to any `CollisionWorld` internal —
  import only from `collision/index.js`.

  Include a `this._latestActionToken = 0` field, incremented at the top of every `onContextMenu`
  target callback; capture the token locally, and after `findClashes` resolves, apply
  isolate/fitToView/notify only if the captured token still equals `this._latestActionToken` —
  otherwise a newer action has already superseded this one, and the result is discarded silently
  (addresses codex-review's Question #2, this task's own concurrency test above).

- [ ] **Step 4: Run all tests, fix until green, then commit.**

  ```bash
  git add wwwroot/extensions/ClashFinderExtension.js test/ClashFinderExtension.test.mjs
  git commit -m "M2: add ClashFinderExtension (Find Clashes context-menu entry)"
  ```

**Completion criteria:** All tests pass; the extension imports only from `collision/index.js` and
Viewer globals, never an internal `collision/` module.

**Protected invariants:** `RoomLocatorExtension.js` is untouched — a separate extension, not a
modification (spec §11.1's own stated preference, confirmed still correct: different UX shape,
different default mode, avoids growing Room Locator's own already-reviewed surface).

**Viewer/API evidence verification required:** Re-verify `getAggregateSelection()`/`getAllModels()`/
`isolate`/`fitToView`'s exact signatures against `node_modules/@types/forge-viewer/index.d.ts` at
implementation time if the pinned `@types/forge-viewer` version (pinned to `"*"` in `package.json`,
per this planning pass's own finding) has moved since this plan was written.

---

## Task 16: App wiring — `keepCurrentModels` + minimal UI affordance for a second model

**Files:**
- Modify: `wwwroot/viewer.js` (`loadModel`, `:38-48`)
- Modify: `wwwroot/main.js` (`setupUrnInput`, `onModelSelected`)
- Modify: `wwwroot/index.html` (a small additive control)
- Test: manual/acceptance-level only (this is UI glue with no meaningful unit-test surface beyond
  what Task 20's acceptance test already exercises end-to-end)

**Prerequisite tasks:** Task 15 (the extension this wiring supports).

**Note on scope, from this planning pass's own finding:** the spec's own citation
(`wwwroot/viewer.js:38-48`) confirms `loadDocumentNode` is called with no `keepCurrentModels` option
today — but the app also has **no UI path at all** for loading a second model without navigating away
from the first (the single URN input, the hash-based flow, and the model picker all funnel into one
`request(urn) -> onModelSelected -> loadModel` path that always replaces). This task is therefore
sized as a small UI addition, not a one-line flag flip.

**Implementation steps:**

- [ ] **Step 0: Register and load `ClashFinderExtension`.**

  **Fixed after `codex-review` (Critical #4):** Task 15 creates the extension class but nothing in the
  original Task 15/16 pair ever imports, registers, or adds it to the Viewer's configured extension
  list — without this step, "Find Clashes" never appears in a real Viewer session regardless of how
  correct the engine is, and Task 20's acceptance test cannot pass. Mirror exactly how
  `RoomLocatorExtension`/`ROOM_LOCATOR_EXTENSION_ID` are wired in `wwwroot/viewer.js` today
  (`:4`, `:20-27`):

  ```js
  // wwwroot/viewer.js
  import { RoomLocatorExtension, EXTENSION_ID as ROOM_LOCATOR_EXTENSION_ID } from './extensions/RoomLocatorExtension.js';
  import { ClashFinderExtension, EXTENSION_ID as CLASH_FINDER_EXTENSION_ID } from './extensions/ClashFinderExtension.js';

  export function initViewer(container) {
      return new Promise(function (resolve, reject) {
          Autodesk.Viewing.Initializer({ env: 'AutodeskProduction', getAccessToken }, function () {
              Autodesk.Viewing.theExtensionManager.registerExtension(ROOM_LOCATOR_EXTENSION_ID, RoomLocatorExtension);
              Autodesk.Viewing.theExtensionManager.registerExtension(CLASH_FINDER_EXTENSION_ID, ClashFinderExtension);
              const extensions = [
                  'Autodesk.DocumentBrowser',
                  ROOM_LOCATOR_EXTENSION_ID,
                  CLASH_FINDER_EXTENSION_ID,
              ];
              // ... unchanged: config, GuiViewer3D construction, viewer.start(), setTheme, resolve(viewer) ...
          });
      });
  }
  ```

  Add a headless registration test (mirroring how `test/RoomLocatorExtension.test.mjs` proves the
  extension's own shape without a live Viewer) asserting `ClashFinderExtension.EXTENSION_ID` is a
  distinct string from `RoomLocatorExtension.EXTENSION_ID` (a duplicated literal would silently break
  both `registerExtension` matching and `unregisterContextMenuCallback`, per `RoomLocatorExtension.js`'s
  own header-comment discipline that Task 15 must follow identically). Add an explicit **acceptance
  precondition** to Task 20 (not a unit test — requires a live Viewer): after `initViewer` resolves,
  `viewer.getExtension(CLASH_FINDER_EXTENSION_ID)` returns a loaded `ClashFinderExtension` instance,
  checked before the acceptance test's own right-click/selection steps run.

- [ ] **Step 1: Extend `loadModel` to accept a `keepCurrentModels` option:**

  ```js
  // wwwroot/viewer.js
  export function loadModel(viewer, urn, { keepCurrentModels = false } = {}) {
      return new Promise(function (resolve, reject) {
          function onDocumentLoadSuccess(doc) {
              resolve(viewer.loadDocumentNode(doc, doc.getRoot().getDefaultGeometry(true), { keepCurrentModels }));
          }
          function onDocumentLoadFailure(code, message, errors) {
              reject({ code, message, errors });
          }
          Autodesk.Viewing.Document.load('urn:' + urn, onDocumentLoadSuccess, onDocumentLoadFailure);
      });
  }
  ```

  Confirm the third-argument options shape `loadDocumentNode` actually accepts against
  `node_modules/@types/forge-viewer/index.d.ts:261` at implementation time (the spec cites this
  exact line for `keepCurrentModels?: boolean` as a `loadDocumentNode` option).

- [ ] **Step 2: Add a minimal "load as additional model" checkbox** to `wwwroot/index.html`, next to
  the existing `#urn`/`#load`/`#browse` controls:

  ```html
  <label><input type="checkbox" id="keep-current-models"> Load as additional model</label>
  ```

- [ ] **Step 3: Wire the checkbox through `wwwroot/main.js`'s `request`/`onModelSelected`/`loadModel`
  chain:**

  ```js
  const keepCheckbox = document.getElementById('keep-current-models');
  const request = (urn) => {
      lastRequestedUrn = urn;
      onModelSelected(viewer, urn, { keepCurrentModels: keepCheckbox.checked });
  };
  // ...
  async function onModelSelected(viewer, urn, { keepCurrentModels = false } = {}) {
      if (window.onModelSelectedTimeout) {
          clearTimeout(window.onModelSelectedTimeout);
          delete window.onModelSelectedTimeout;
      }
      window.location.hash = urn;
      try {
          const resp = await fetch(`/api/models/${urn}/status`);
          if (!resp.ok) throw new Error(await resp.text());
          const status = await resp.json();
          switch (status.status) {
              case 'n/a':
                  showNotification(`Model has not been translated.`);
                  break;
              case 'inprogress':
                  showNotification(`Model is being translated (${status.progress})...`);
                  // Fixed after codex-review (Important #2): the pre-M2 retry passed only (viewer, urn),
                  // silently reverting to keepCurrentModels:false on retry regardless of what the user
                  // originally requested. Thread the SAME options object through every poll -- a model
                  // still translating when the user checked "load as additional" must still load as
                  // additional once translation finishes, not replace the first model out from under them.
                  window.onModelSelectedTimeout = setTimeout(onModelSelected, 5000, viewer, urn, { keepCurrentModels });
                  break;
              case 'failed':
                  showNotification(`Translation failed. <ul>${status.messages.map(msg => `<li>${JSON.stringify(msg)}</li>`).join('')}</ul>`);
                  break;
              default:
                  clearNotification();
                  loadModel(viewer, urn, { keepCurrentModels });
                  break;
          }
      } catch (err) {
          alert('Could not load model. See the console for more details.');
          console.error(err);
      }
  }
  ```

  Add a fake-timer test (Node's `node:timers` mocking, or a manually-substituted `setTimeout`) covering
  at least one `inprogress` response before success, asserting the eventual `loadModel` call still
  receives the ORIGINAL `keepCurrentModels` value, not the parameter-less default.

  Leave the hash-based auto-load path (`window.addEventListener('hashchange', ...)`) and the
  browse-button flow calling `request(urn)` exactly as today — both now respect whatever the checkbox
  currently holds, with no other behavior change. A user loading two models federated for the Find
  Clashes acceptance workflow: load the first model normally (checkbox unchecked), check the box,
  enter/browse the second URN, load again.

- [ ] **Step 4: Manually verify** (per this repo's `run` skill / dev-server convention) that loading a
  first model, checking the box, then loading a second model results in `viewer.getAllModels()`
  returning both — this is the concrete precondition Task 20's acceptance test needs and cannot verify
  in isolation from a running Viewer.

- [ ] **Step 5: Commit.**

  ```bash
  git add wwwroot/viewer.js wwwroot/main.js wwwroot/index.html
  git commit -m "M2: wire keepCurrentModels + minimal UI affordance for a second model"
  ```

**Completion criteria:** Manual verification (Step 4) confirms two models can be loaded
simultaneously through the UI with no regression to the existing single-model load flow (unchecked
checkbox behaves byte-for-byte as today).

**Protected invariants:** The default (unchecked) behavior is unchanged — every existing manual
workflow (hash-based load, browse-and-load) continues to replace the current model exactly as before.

**Viewer/API evidence verification required:** Confirm `loadDocumentNode`'s options-object shape
(third argument, not a second positional argument) against the actual Viewer bundle/typings in use at
implementation time — the spec's own citation is a `.d.ts` declaration, not yet exercised against a
live Viewer session by this planning pass.

---

# Batch 6 — Acceptance / performance

## Task 17: Synthetic TLAS-vs-linear differential fixtures

**Files:**
- Modify or create: `test/CollisionWorld.tlasTraversal.test.mjs` (extend with the full spec §12.2
  fixture list, several of which Task 13 already introduced a subset of)

**Prerequisite tasks:** Batch 4 complete.

**Implementation steps:**

- [ ] **Step 1: Implement every fixture in spec §12.2 not already covered by Tasks 6-14's own tests**,
  each run twice (`broadPhase:'tlas'` and `'linear'`) with a `pairs`-set equality assertion:
  - single-model, single geometry pair, known Hard Clash;
  - single-model, known non-clash (AABBs overlap, volumes don't);
  - two-model federation, known cross-model Hard Clash;
  - two-model federation, source has a same-model AND a cross-model Hard Clash (covered in Task 8 —
    re-run here against both broad-phase modes if Task 8 only exercised `'linear'`);
  - source self-exclusion (both broad-phase modes);
  - whole-model target scope, dense model (both broad-phase modes);
  - model eviction mid-query, cross-model call (assert `ModelEvictedError`, both broad-phase modes);
  - zero clashes, correct negative (`pairs: []`, no diagnostics);
  - diagnosed incomplete result (a target fragment triggering `geometry-not-yet-available` or an
    oversized marker — assert correct per-operand `modelId` even when the diagnosed fragment belongs
    to a different model than the source).

- [ ] **Step 2: Address the spec's remaining open item 3** (source self-exclusion granularity's
  real-fixture confirmation) — since a synthetic fixture is exactly the tool for this: construct a
  fixture where the simpler dbId-only self-exclusion rule and the spec's adopted
  fragment-set-membership rule would produce **different** results (an assembly-rooted source with
  descendant fragments under a different `ownerDbId` than the requested dbId), and confirm the
  implemented behavior matches the adopted rule. Record the outcome as a short note appended to this
  plan or a follow-up doc — this closes the one non-blocking human-confirmation item the spec left
  open that a synthetic fixture (not a real federated model) can actually settle.

- [ ] **Step 3: Run all tests, then commit.**

  ```bash
  git add test/CollisionWorld.tlasTraversal.test.mjs
  git commit -m "M2: complete synthetic TLAS-vs-linear differential fixture set"
  ```

**Completion criteria:** Every fixture in spec §12.2 has a corresponding passing test; the differential
requirement (§12.1) holds for all of them.

**Protected invariants:** None new — this task is pure verification of invariants Tasks 6-14 already
established.

**Viewer/API evidence verification required:** None (synthetic fixtures, no live Viewer).

---

## Task 18: Placement-invalidation / model-alignment acceptance fixture

**Files:**
- Modify: `test/CollisionWorld.placementInvalidation.test.mjs`

**Prerequisite tasks:** Task 14.

**Implementation steps:**

- [ ] **Step 1: Implement the exact spec §"Model-alignment acceptance" sequence as a synthetic test:**

  ```js
  test('align -> invalidateModelPlacement -> next TLAS query rebuilds -> TLAS and linear agree', async () => {
    // 1. Load two models (mock fixtures), find a real cross-model clash after moving model B into
    //    overlap with model A's known geometry.
    // 2. Query broadPhase:'tlas' BEFORE the move -- assert no clash (or a different clash set).
    // 3. Move model B's fragments (simulate an alignment tool updating the Viewer's own FragmentList
    //    world matrices/bounds -- i.e., change what the mock's getWorldMatrix/getWorldBounds return).
    // 4. Call world.invalidateModelPlacement(modelB).
    // 5. Query broadPhase:'tlas' again -- assert the NEW clash is now found.
    // 6. Query broadPhase:'linear' -- assert it agrees exactly with the post-alignment TLAS result.
  });
  ```

- [ ] **Step 2: Run, fix until green, commit.**

  ```bash
  git add test/CollisionWorld.placementInvalidation.test.mjs
  git commit -m "M2: model-alignment acceptance fixture (align, invalidate, rebuild, TLAS/linear agree)"
  ```

**Completion criteria:** The fixture passes and is the literal sequence the spec's own
"Model-alignment acceptance" section describes — not an approximation of it.

**Protected invariants:** Explode/animation remain untested and unsupported — this fixture performs
exactly one discrete alignment action, never continuous per-frame movement.

**Viewer/API evidence verification required:** None (synthetic).

---

## Task 19: Candidate-budget/statistics fixtures — inequality-chain assertions

**Files:**
- Modify: `test/CollisionWorld.tlasTraversal.test.mjs`

**Prerequisite tasks:** Task 13.

**Implementation steps:**

- [ ] **Step 1: Implement fixtures exercising the budget's edge conditions:**

  ```js
  test('exactly maxTlasCandidatePairs candidates succeeds; maxTlasCandidatePairs + 1 throws', async () => {
    // Construct a synthetic epoch with a controlled number of overlapping primitives so the exact
    // boundary is reachable in a unit test (may require a small maxTlasCandidatePairs override via
    // constructor injection or a test-only constant override -- do not hardcode the real 200_000
    // production value into a per-test fixture).
  });

  test('the inequality chain holds across a fixture with real filtering (some candidates excluded by target scope)', async () => {
    // tlasPrimitiveCandidatePairs > broadPhasePairs strictly, in a fixture engineered to filter out
    // at least one raw candidate -- confirms the two are NOT conflated (the earlier-draft bug the
    // targeted design-resolution pass caught and fixed in the spec text).
  });
  ```

- [ ] **Step 2: Run, fix until green, commit.**

  ```bash
  git add test/CollisionWorld.tlasTraversal.test.mjs
  git commit -m "M2: candidate-budget boundary and statistics inequality-chain fixtures"
  ```

**Completion criteria:** Both fixtures pass; the budget's exact-boundary behavior
(`limit` succeeds, `limit + 1` throws) is verified, not just its "eventually throws" behavior.

**Protected invariants:** None new.

**Viewer/API evidence verification required:** None.

---

## Task 20: Real federated Viewer acceptance test

**Files:**
- Create: `test/acceptance/clash-finder.acceptance.mjs`
- Modify: `package.json` (new `test:acceptance:clash-finder` script, mirroring the existing
  `test:acceptance` entry's naming convention rather than overloading it — the two acceptance suites
  are independent and neither should silently overwrite the other's report)

**Prerequisite tasks:** Task 16 (app wiring), Task 15 (`ClashFinderExtension`).

**Addresses `codex-review`'s Question #3:** write this suite's own report to
`test/acceptance/results/clash-finder-run-report.json` — a distinct filename from
`room-locator.acceptance.mjs`'s own `run-report.json`, so running both suites (or one after the other
in CI) never has one silently clobber the other's report.

**Implementation steps:**

- [ ] **Step 1: Source a real two-or-more-model federated fixture** (spec's own open item 4,
  logistics, not a design blocker) — following `milestone-1-performance-gate-disposition.md`'s own
  substitution-with-justification precedent if no purpose-built federated pair exists. Document the
  chosen models and why they are suitable (a known cross-model Hard Clash pair, a known negative
  element) in this test file's own header comment, mirroring
  `test/acceptance/room-locator.acceptance.mjs`'s own documentation convention.

- [ ] **Step 2: Implement the acceptance test**, mirroring `test/acceptance/room-locator.acceptance.mjs`'s
  exact structure (`chromium.launch` with the same `--no-sandbox --disable-dev-shm-usage
  --single-process --no-zygote` args and `resolveProxyFromEnv()` helper, the same `isMainModule` guard,
  the same `check(name, actual, expected)` / `run-report.json` convention):
  - load model A, then load model B as-additional (via Task 16's checkbox);
  - select the known source element, right-click, click "Find Clashes";
  - assert exact expected `{model, dbId}` result set, no more no fewer;
  - assert correct per-result model provenance (same-model and cross-model results both correctly
    labeled);
  - assert correct isolate/fit visualization;
  - assert no duplicate results;
  - assert source excluded from its own results;
  - separately: select the known negative element, verify "No clashes found."

- [ ] **Step 3: Run against a live dev server** (`npm start` + `npx playwright install chromium` +
  `.env` credentials, per `test/acceptance/README.md`'s existing prerequisites), iterate until green.

- [ ] **Step 4: Commit.**

  ```bash
  git add test/acceptance/clash-finder.acceptance.mjs
  git commit -m "M2: real federated Viewer acceptance test for Find Clashes"
  ```

**Completion criteria:** The acceptance test passes against a live Viewer session with two real,
simultaneously loaded models; `npm run test:acceptance:clash-finder` runs it directly, writing its
report to `test/acceptance/results/clash-finder-run-report.json` (distinct from
`room-locator.acceptance.mjs`'s own report file).

**Protected invariants:** `test/acceptance/room-locator.acceptance.mjs` itself is untouched and
continues to pass — this is a new, additive acceptance test, not a modification of the existing one.

**Viewer/API evidence verification required:** This task IS itself the final live-Viewer verification
of every API assumption made throughout this plan (`getAggregateSelection`, `getAllModels`,
`keepCurrentModels`, `isolate`/`fitToView` with a `model` argument) — treat any failure here as a
signal to re-open the relevant earlier task's evidence assumption, not merely a test bug.

---

## Task 21: M2 performance gate

**Files:**
- Create: `test/performance/run-gate-m2.mjs`

**Prerequisite tasks:** Task 20 (needs the same federated fixture sourcing).

**Implementation steps:**

- [ ] **Step 1: Implement the gate**, mirroring `test/performance/run-gate.mjs`'s exact shape
  (Playwright-driven, same launch-args/proxy helper, importing constants from `collision/constants.js`
  directly), measuring the spec §14.3 criteria:
  1. TLAS build cost per epoch (cold), via the `'tlas-build'` span label;
  2. TLAS query cost per source instance, cold vs. warm;
  3. Candidate counts: `tlasLeafRangeEmissions`, `tlasPrimitiveCandidatePairs`, `broadPhasePairs`,
     `tlasExactRetestSurvivors`, `tlasNarrowPhaseInputPairs` for the TLAS run, vs.
     `broadPhasePairs`/`narrowPhasePairs` for the linear run;
  4. wall-clock: TLAS (cold, then warm) vs. linear, for the identical query;
  5. memory/cache behavior: TLAS entry retained size and growth, `tlasBuilds`/`tlasCacheHits`/
     `tlasSharedBuildWaits` reported alongside cold/warm timing;
  6. fragment/instance counts for the federated model set actually used.

- [ ] **Step 2: Run it, and honestly record `NOT EXERCISED`** for any criterion the available
  federated fixture cannot trigger — per `milestone-1-performance-gate-disposition.md`'s own
  discipline, never silently converted to a pass.

- [ ] **Step 3: Evaluate the M2 prompt's own explicit gate** (spec §14.1): is there a **measurable**
  candidate-search benefit of TLAS over linear on this realistic federated/fragment-dense case? Record
  the answer plainly, whichever it is — this spec "does not presume the outcome."

- [ ] **Step 4: Commit.**

  ```bash
  git add test/performance/run-gate-m2.mjs
  git commit -m "M2: performance gate measuring TLAS vs. linear broad phase on a federated fixture"
  ```

**Completion criteria:** The gate runs to completion and produces a report with every criterion either
measured or explicitly marked `NOT EXERCISED` with a stated reason; the TLAS-vs-linear benefit
question is answered with evidence, not assumed.

**Protected invariants:** `test/performance/run-gate.mjs` (M1's own gate) is untouched.

**Viewer/API evidence verification required:** Same federated fixture as Task 20 — reuse it rather
than sourcing a second one.

---

## Task 22: Final M2 packaging/docs updates

**Files:**
- Modify: `collision/README.md`

**Prerequisite tasks:** All prior tasks complete.

**Implementation steps:**

- [ ] **Step 1: Update `collision/README.md`** to document: the `targets`/`broadPhase` `findClashes`
  additions, the 9 new `Statistics` fields and their inequality-chain relationships, the
  `invalidateModelPlacement` contract and its "not for animation/explode" scope note,
  `ModelPlacementChangedError`, and the federated `Find Clashes` UX (referencing
  `ClashFinderExtension`).
- [ ] **Step 2: Confirm no M1 packaging decision is reopened** — `collision/` stays in-repo, no
  separate npm package, no semver contract (per
  `collision-library-m1-release-packaging-disposition.md`), per spec §16's own explicit statement that
  M2 extends `collision/` in place with a new `collision/tlas/` subdirectory only.
- [ ] **Step 3: Commit.**

  ```bash
  git add collision/README.md
  git commit -m "M2: document targets/broadPhase, TLAS statistics, invalidateModelPlacement in README"
  ```

**Completion criteria:** `collision/README.md` accurately reflects the shipped M2 surface; a new
reader of the README (with no access to the design spec) can understand `targets`, `broadPhase`,
`invalidateModelPlacement`, and the new `Statistics` fields from the README alone.

**Protected invariants:** No packaging/versioning decision changes.

**Viewer/API evidence verification required:** None.

---

# Cross-task interface reconciliation

| Interface | Defined in | Consumed by | Notes |
|---|---|---|---|
| `maxTlasCandidatePairs` | Task 1 | Task 13 | constant, not a per-call parameter |
| `ModelPlacementChangedError{modelId, loadEpoch, expectedRevision, actualRevision}` | Task 1 | Tasks 11, 14 | thrown by the composite checkpoint and the pre-insertion check — NEVER by `TlasCache`'s or Task 13's own internal `'superseded'` retry loop (that is a private signal, not this public error) |
| `emptyStatistics()`'s 9 new fields | Task 1 | Tasks 13, 17, 19, 21 | always present, default 0 |
| `CapacityExceededError` | Task 1 | Tasks 5, 6, 13 | **relocated to `collision/errors.js`** (was `CollisionWorld.js`), re-exported unchanged from both `CollisionWorld.js` and `collision/index.js` — fixes a circular-import risk with Task 5; carries kinds `'call-wide-unique-fragment-precheck'`, `'bucket-capacity'`, `'tlas-candidate-budget'`, `'whole-model-enumeration'` |
| Task 2's confirmed enumeration/reverse-lookup accessor names | Task 2 | Task 5 | do not implement Task 5 against unconfirmed names |
| `extractAllFragments(model, loadEpoch, opts) -> {records: Map<fragmentId, ExtractedFragmentRecord>, diagnostics: Array}` | Task 5 | Tasks 8, 12 | **returns an object, not a bare Map** — `records` uses the same `ExtractedFragmentRecord` shape as `extractFragments`; `diagnostics` concats directly into `statistics.diagnostics` |
| `CollisionInstanceBVH(records)`, `.queryBox(min, max, {onLeafRange, onCandidate}) -> {truncated}`, `.recordAt(builderPositionIndex)`, `.getBoundingBox(box3)` | Task 3 | Tasks 10, 13 | `onCandidate` returns `'stop'` or `undefined`; a thrown error inside either callback is rethrown after the traversal call returns; `onCandidate`'s own argument is a **builder-position** index — `recordAt` is the only valid resolution |
| `TlasCache.getEntry(epoch, expectedRevision) -> {bvh, builtAtRevision, outcome} \| {outcome:'superseded'}` | Task 10 | Task 13 (via `_getTlasEntryForEpoch`) | `outcome` is `'built' \| 'shared-wait' \| 'hit' \| 'superseded'`; on `'superseded'`, the CALLER must re-derive the current expected revision fresh and retry — `getEntry` never retries internally with a stale value |
| `TlasCache.getBuiltAtRevision(epoch) -> number \| undefined` | Task 10 | Task 13 | read-only; `undefined` (never-built or still-building) is treated as revision `-1` by Task 13's refresh-trigger condition |
| `TlasCache.releaseEntryForEpoch(epoch)`, `.releaseAll()` | Task 10 | `CollisionWorld._releaseEpochScopedState`/`dispose` | now also marks any in-flight build `released`, preventing it from publishing on later resolution — same non-throw contract as `GeometryRegistry`'s own release calls |
| `_placementByEpoch`, `_placementRevisionByEpoch`, `_recordPlacement(epoch, model, records, expectedRevisionByEpoch?)` | Task 9 (extended by Task 14) | Tasks 10, 11, 13, 14 | write-once per fragment; Task 14 adds the optional 4th parameter and pre-insertion check |
| `_placementInvalidatedAtRevision` | Task 11 (release wiring also added in Task 11, not Task 9) | Task 13 (staleness-cause discrimination via `_getTlasEntryForEpoch`), Task 14 | generational marker, not a boolean; released at the same two boundaries as Task 9's own two fields |
| `invalidateModelPlacement(model)` | Task 11 | (public API, also exercised by Task 18) | throws `WorldDisposedError`/`ModelEvictedError`, no-ops for never-admitted |
| `_refreshPlacementForEpoch(epoch, expectedRevision, expectedInvalidationRevision) -> {published}` | Task 11 | Task 13 (via `_getTlasEntryForEpoch`) | staged/atomic-publish; `published: false` means Task 13's own retry loop re-derives fresh state and tries again — never a direct throw from this method itself |
| `_getTlasEntryForEpoch(epoch)`, `_resolvePlacedFromTlasRecord(epoch, record)` | Task 13 | Task 14 (the latter, for its own resolution needs) | `_getTlasEntryForEpoch` owns the refresh-trigger condition (fixed for the cold-first-build case) and the `TlasCache` `'superseded'`-retry loop, bounded by its own liveness re-check each iteration |
| `_preflightCollisionInstanceAdmission(lease, uniqueFragments) -> {ok, reason?}` | Task 6 | `findClashes`'s multi-model admission phase | side-effect-free; mirrors `admitCollisionInstances`'s real bucket-size-plus-missing-count check, not raw extraction size |
| `buildTargetScopeFilter(targetsEntries, ...) -> Map<Model, Set<fragmentId>|'whole-model'>` | Task 12 | Task 13 | per-call, never baked into the cached `TlasEntry` |
| `createCompositeCheckpointPort(leases, capturedEpochs, tlasConsultedEpochs)`, `.expectedRevisionByEpoch` | Task 6 (extended by Task 14) | `findClashes`'s own body | Task 14 adds the 3rd parameter and the exposed map |
| `ClashPair.{source,target}.model` (additive) | Task 7 | Task 15 | compare by `===`, never `modelId` |
| Cross-model pair dedup key `${sourceEpoch}:${sourceDbId}:${targetEpoch}:${targetDbId}` | Task 7 | — | internal only, not a public shape |
| `_runNarrowPhasePair`'s operand-local signature `(sourcePlaced, targetPlaced, mode, sourceOperand, targetOperand, ...)` | Task 7 | Tasks 8, 13 | replaces the old shared `model, epoch` params everywhere it is called |
| `_runBroadPhaseScan(sourceOperand, sourceInstances, targetGroups, statistics, checkpoint)` | Task 8 | `findClashes`'s dispatch (Task 13 adds the `'tlas'` sibling) | `targetGroups: Array<{epoch, model, instances}>`; `broadPhasePairs++` occurs immediately before `_testBroadPhasePair`, after self-exclusion — same position `_runTlasBroadPhase` uses |
| `isSourceOwnFragment(sourceOperand, targetEpoch, targetFragmentId)` | Task 7 | Tasks 8, 13 | single shared helper, not reimplemented per broad-phase mode |

**Naming consistency check performed during this planning pass (updated after `codex-review`):**
`_recordPlacement`, `_refreshPlacementForEpoch`, `_getTlasEntryForEpoch`,
`_resolvePlacedFromTlasRecord`, `_preflightCollisionInstanceAdmission`, `createCompositeCheckpointPort`,
`buildTargetScopeFilter`, `isSourceOwnFragment`, and `_runTlasBroadPhase` are used with the identical
name and parameter order everywhere they are referenced above. `TlasCache.getEntry`'s four-way
`outcome` value (including `'superseded'`) and `CollisionInstanceBVH.queryBox`'s
`{onLeafRange, onCandidate}` dual-callback contract are each defined exactly once (Tasks 10 and 3
respectively) and referenced, never redefined, in every later task. `extractAllFragments`'s
`{records, diagnostics}` return shape and `CapacityExceededError`'s relocation to `errors.js` are each
defined once (Tasks 5 and 1 respectively) and consumed consistently.

---

# Execution batching strategy

1. **Batch 1 (Tasks 1-4) — Foundation, Viewer evidence, TLAS adapter.** Fully parallelizable
   internally except Task 2 → Task 5 (Batch 2) and Task 3 → Task 4. No dependency on M1's live
   `CollisionWorld` query path at all — pure additive/adapter work. **Targeted review at the end of
   this batch**: confirm `CollisionInstanceBVH`'s contract tests (Task 4) pass before any later task
   builds on it.
2. **Batch 2 (Tasks 5-8) — extractAllFragments + cross-model linear vertical slice.** Sequential
   within the batch (5 → 6 → 7 → 8). **This batch is independently shippable**: at its end,
   `findClashes({targets, broadPhase:'linear'})` is a complete, correct, federated Hard Clash
   capability with no TLAS involved — a genuine milestone checkpoint, not just an internal waypoint.
   **Targeted review at the end of this batch**: re-run the full M1 single-model suite to confirm zero
   regressions before touching placement/TLAS state in Batch 3.
3. **Batch 3 (Tasks 9-11) — Placement / TLAS cache lifecycle.** Sequential (9 → 10 → 11). Batch 3 adds
   pure new state and a new cache with no consumer yet — nothing in `findClashes`'s own dispatch reads
   it until Batch 4. **Targeted review at the end of this batch**: confirm `TlasCache`'s
   mid-build-supersession behavior (Task 10) and the placement-refresh atomicity guarantee (Task 11)
   both hold under the concurrency tests before Task 13 builds the traversal loop on top of them —
   this is the batch boundary where a subtle lifecycle bug is cheapest to catch.
4. **Batch 4 (Tasks 12-14) — TLAS traversal integration.** Sequential (12 → 13 → 14); Task 13 is the
   single highest-risk task in this plan and must not be split (see Task 13's own rationale). **Do not
   proceed to Batch 5 until the full differential test suite (Task 13's own tests plus Batch 2's
   fixtures re-run against `broadPhase:'tlas'`) passes.**
5. **Batch 5 (Tasks 15-16) — Viewer UI/federation.** Can start once Batch 4 is stable; Task 16's
   manual-verification step should happen before Task 20 is attempted, not deferred to Batch 6.
6. **Batch 6 (Tasks 17-22) — Acceptance/performance.** Tasks 17-19 are synthetic and can run in
   parallel with each other once Batch 4 is done. Tasks 20-21 share the same real federated fixture
   and should be sourced once, together. Task 22 is last, strictly.

**Targeted reviews, not per-task stops**: review at the four batch boundaries above (end of Batch 1,
end of Batch 2, end of Batch 3, end of Batch 4) plus one final review after Batch 6 — six checkpoints
total for a 22-task plan, at the points where a real architectural dependency actually crosses, not
between every task.

---

# Final acceptance / completion criteria

## Live federated acceptance (Task 20)

Passes against a real Viewer session with two simultaneously loaded models: exact expected
`{model, dbId}` result set for a known cross-model and same-model Hard Clash source, correct
per-result model provenance, correct isolate/fit visualization, no duplicates, source excluded, and a
verified "No clashes found" negative case.

## Model-alignment acceptance (Task 18)

Passes as a synthetic fixture: align → `invalidateModelPlacement` → next TLAS query rebuilds using
current world placement → TLAS and linear oracle agree after alignment. Explode is not part of this
acceptance, by design.

## M2 performance gate (Task 21)

Every criterion in spec §14.3 is either measured with real numbers or explicitly marked
`NOT EXERCISED` with a stated reason; the TLAS-vs-linear candidate-search benefit question (spec
§14.1) is answered with evidence on a realistic federated/fragment-dense case, not assumed.

## Final implementation-readiness / completion criteria

- [ ] `npm test` passes with zero regressions to the full M1 test suite (the one intentional removal —
  the `'cross-model query rejects'` test — is accounted for in Task 6, replaced by the new
  cross-model-acceptance tests it enables).
- [ ] `broadPhase:'tlas'` and `broadPhase:'linear'` produce identical `pairs` sets for every fixture in
  Batch 6, with no exception.
- [ ] Every M1 invariant in spec §16's compatibility table is either "preserved unchanged" (confirmed
  by an unmodified passing test) or "changed" exactly as that table specifies (confirmed by a new
  test asserting the new behavior) — no invariant is silently dropped.
- [ ] The two non-blocking human/logistics items the spec left open (source self-exclusion granularity
  confirmed against a fixture, Task 17 Step 2; a real two-or-more-model federated fixture sourced,
  Tasks 20-21 Step 1) are both resolved with a recorded outcome, not left open past this plan's
  completion.
- [ ] `ClashFinderExtension` is reachable from a real Viewer session's right-click menu on a
  federated setup, end to end, per Task 20's own acceptance run.
- [ ] `collision/README.md` (Task 22) accurately documents the shipped M2 public surface.
