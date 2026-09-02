# Round 10 Codex review

Type: spec
Effort: high
Input: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`
Request ID: 20260902-115146-23922-1639

Do not begin implementation until the three critical issues below are specified.

# Executive Summary

The geometric design is substantially stronger after nine reviews, but three blockers remain:

- Per-stage synchronous work can still freeze the Viewer despite `frameBudgetMs`.
- Model eviction/disposal lacks a race-safe lifecycle contract.
- Mandatory welding depends on code absent from the specified browser vendor payload.

Six additional ambiguities can produce incompatible implementations or unverifiable acceptance results.

Repository verification confirmed this is an unbundled browser ESM application. `node spike/fixtures.mjs` passes 55/55, but those fixtures do not implement the round-9 behavior or the lifecycle, cache, aggregation, and browser-scheduling contracts added to the specification.

# Critical Issues

### Synchronous stages remain capable of exceeding the frame budget

**Severity:** Critical

**Location or section:** ProperCrossingQuery budgets (line 899), ContainmentQuery limits (line 1139), CollisionWorld scheduling (line 1320)

**Problem:** `frameBudgetMs` is checked only between pairs and composed subqueries. It cannot preempt a synchronous subquery. The measured budget covers raw candidate-pair tests, but not the expensive paths:

- Up to 64 intersecting pairs can each generate 12 probes.
- Each probe can perform point classification against two BVHs.
- Each classification performs `closestPointToPoint` plus up to three full raycasts.
- Containment can perform 512 classifications in one synchronous stage.

No measurement or elapsed-time limit establishes that either stage finishes near 16 ms.

**Why it matters:** The specification's central responsiveness guarantee is not enforced by the proposed architecture. Yielding after a 100 ms subquery does not prevent the 100 ms UI freeze.

**Concrete failure scenario:** Two meshes produce many confirmed non-coplanar intersections. `ProperCrossingQuery` performs hundreds of proximity searches and raycasts before returning. The next `frameBudgetMs` checkpoint occurs only after the long task has already blocked rendering and input.

**Recommended specification change:** Give every synchronous traversal and sampling loop a deadline based on `performance.now()`. Check it inside the `bvhcast` callback and between point classifications. Abort with a defined diagnostic when the deadline expires. Measure worst-case probe and containment costs — not only raw non-intersecting candidates — and add a fixture that forces the confirmed-intersection path to consume the deadline.

---

### Eviction and disposal lack a race-safe state machine

**Severity:** Critical

**Location or section:** Room cache lifecycle (line 1280), evictModel API (line 1372), disposal mid-query (line 1578), unverified unload event (line 1881)

**Problem:** The spec says eviction removes in-flight promises "which reject," but does not define:

- How a previously created promise is rejected.
- How a late completion is prevented from repopulating an evicted cache.
- How a query holding already-resolved BLAS references notices disposal after a scheduling yield.
- Which Viewer unload event and event payload are authoritative.
- How a pending `model.search` callback is invalidated.
- Whether a rejected room-search promise is removed or cached permanently.

The installed Viewer typings expose several plausible events — `BEFORE_MODEL_UNLOAD_EVENT`, `MODEL_REMOVED_EVENT`, and `MODEL_UNLOADED_EVENT` — without the spec selecting one (`node_modules/@types/forge-viewer/index.d.ts:324`).

**Why it matters:** Cache deletion alone does not cancel work. Queries can resume against unloaded models, return stale rooms, or resurrect geometry after eviction.

**Concrete failure scenario:** `findClashes` yields between stages. The model unloads and `evictModel` clears its records. The query resumes with local references and completes successfully, or a late room-search callback starts a new query against the unloaded model. A transient room-search failure can also remain cached for the lifetime of the model.

**Recommended specification change:** Define a world/model lifecycle state machine with generation tokens:

1. Select the exact Viewer event and required payload.
2. Increment the model generation on eviction.
3. Capture and validate the generation after every `await` and scheduling yield.
4. Prohibit cache insertion when the generation is stale.
5. Remove rejected room-search promises so retries are possible.
6. Define a stable disposal error type and add unload-during-search, unload-during-query, retry-after-failure, and late-completion tests.

---

### Mandatory welding is missing from the deployment dependency plan

**Severity:** Critical

**Location or section:** vendor layout (line 388), mandatory welding (line 742)

**Problem:** The vendor script is specified to copy only `three/build/**` and `three-mesh-bvh/src/**`. The mandatory normalization algorithm is described in terms of `mergeVertices`, but that utility lives in `three/examples/jsm/utils/BufferGeometryUtils.js`, outside the proposed vendor payload.

The spec neither vendors that module nor specifies a replacement welding implementation.

**Why it matters:** Welding is explicitly load-bearing for manifold classification. Implementers must either introduce an undocumented custom algorithm or import a browser module that was never copied.

**Concrete failure scenario:** `ViewerGeometryAdapter` imports `three/addons/utils/BufferGeometryUtils.js` or the equivalent `examples` path. The browser receives a 404, and the extension fails during module loading before any clash query runs.

**Recommended specification change:** Choose one implementation:

- Vendor the required `three/examples/jsm/utils/BufferGeometryUtils.js` tree and define its browser import path, or
- Specify a local welding algorithm, including hashing, precision, index remapping, and active-range preservation.

Add a clean-install test that runs `npm run build:vendor`, starts the app, imports every collision module, and verifies there are no unresolved module requests.

# Important Improvements (not addressed this round — deferred)

## Correctness and API contracts

### The public containment definition contradicts the normative algorithm
**Severity:** High. `containment`'s Public API comment says "any part of the source lies inside" while the normative section says "on the source surface." An implementer following the comment could re-enable the interior witness and fail the coincident-boxes fixture.

### Cached instances have no transform or geometry-readiness policy
**Severity:** High. No staleness policy for `CollisionInstance` matrices/bounds under explode/animation/placement changes, and no distinction between transient (progressive load) and permanent geometry unavailability.

### Canonical operand ordering is not deterministically defined
**Severity:** High. Sorting by `(modelId, geometryKey, instanceId)` depends on how `instanceId` is allocated/compared, which the spec doesn't define — an auto-incremented ID assigned in discovery order can break the stated symmetry guarantee.

### Budget-exhaustion diagnostics are contradictory
**Severity:** High. The algorithm/type-comment section and the edge-cases section disagree on whether `maxCrossingPairsExamined` exhaustion produces `crossing-budget-exhausted` or `inconclusive-crossing`.

### Invalid dbIds cannot be distinguished using the specified extraction behavior
**Severity:** High. "No fragments" (valid, empty) and "invalid dbId" (should reject) can both present as an empty `enumNodeFragments` result; the spec needs a separate node-existence check.

## Verification and delivery

### The MEP acceptance gate is not reproducible
**Severity:** High. No identified model, no pinned source/target dbIds, no browser/hardware profile, no numeric tolerance band, and the Long Tasks API's reporting threshold is unsuitable for detecting ~16ms tasks.

# Questions / Clarifications

1. Should overlapping source and target dbId sets produce self-pairs, or must identical fragment/dbId pairs be excluded?
2. In a multi-model Viewer session, how does `locateElementByRoom(dbId)` determine the model when the method accepts no model argument?
3. Are duplicate input dbIds deduplicated, and is `result.pairs` ordering deterministic?
4. What exact highlighting behavior completes the context-menu workflow — selection, isolation, theming color, or an overlay — and when is prior highlighting cleared?
5. What do `ClashStatistics` counters mean for skipped, aborted, deduplicated, and diagnosed pairs, and which fields carry the performance-gate measurements?

# Positive Observations

- The specification explicitly separates surface contact, directed surface containment, and positive-volume overlap.
- Geometry layouts, active ranges, welding, manifold caveats, and tolerance frames receive unusually careful treatment.
- Diagnostic roles distinguish source, target, fragment, and pair failures instead of silently converting incomplete work into clean negatives.
- The spike validates substantial portions of the geometry design against pinned dependencies and the real acceptance model.
- Cross-model queries and oversized synchronous builds are bounded rather than implemented with undefined coordinate or blocking behavior.

# Overall Readiness

**Requires major revision** at time of this review. The core geometric direction is credible, but implementation should wait for the synchronous-stage deadline, race-safe lifecycle, and browser welding dependency to be specified.

# Disposition (applied to the spec after this review)

All three Critical findings were accepted and fixed:

1. **Synchronous-stage deadline** — added a time-triggered abort inside `ProperCrossingQuery`'s `bvhcast` callback (checked every invocation, same `aborted`-flag protocol as the existing count budgets) and a genuine yield-and-resume checkpoint every `deadlineCheckInterval = 256` samples inside `ContainmentQuery`'s plain-JS sampling loops, both keyed off the same `frameBudgetMs` clock as the existing pair/stage boundary checkpoint.
2. **Race-safe eviction lifecycle** — chose `Autodesk.Viewing.BEFORE_MODEL_UNLOAD_EVENT` as the authoritative hook (verified present in `index.d.ts:324`; payload shape not typed, flagged for a one-time confirmation at implementation time), added a per-model generation counter bumped synchronously by `evictModel` before any cache release, required every yield point (coarse and intra-stage) to re-validate it and reject the whole call with a new `ModelEvictedError` on staleness, and closed the room-search late-completion/permanent-rejection-caching gaps with an identity check against the extension's own cache map.
3. **Welding vendor gap** — vendors `three/examples/jsm/utils/BufferGeometryUtils.js` verbatim (self-contained, only imports bare `three`) rather than hand-porting `mergeVertices`, added it to the vendor tree, `sync-vendor.mjs`, and the import map under the upstream `three/addons/utils/BufferGeometryUtils.js` specifier, and added a clean-install/no-unresolved-module acceptance check.

The six High findings and five clarification questions were intentionally deferred — out of scope for this pass per explicit instruction — and remain open for a future round.
