# Round 13 Codex review

Type: spec
Effort: high
Input: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`
Request ID: 20260902-132518-66648-24132

Do not begin implementation until the model-admission lifecycle contradiction is fixed.

# Executive Summary

The specification is technically mature, but one new Critical defect makes the primary room-locator workflow fail: the first room search checks `world.isModelLive(model)`, while that method explicitly returns `false` until `findClashes` admits the model—which occurs only after the search completes.

The document also intentionally retains several High-severity ambiguities from rounds 10–12. They affect geometric correctness, cache validity, deterministic behavior, Viewer lifecycle integration, and objective acceptance testing.

Repository verification found:

- The geometry spike passes 55/55 tests.
- The spike explicitly omits Viewer adapters, caches, diagnostics, and budgets.
- Current model loading is not awaited in `wwwroot/main.js:61`.
- Installed Viewer typings require `load(): boolean | Promise<boolean>` and `unload(): boolean`.
- No files were modified.

# Critical Issues

## First room lookup rejects a valid, never-before-seen model

**Severity:** Critical

**Location or section:** Room-search lifecycle (line 1522), `isModelLive` contract (line 1689), lazy admission (line 1743)

**Problem:** Room discovery happens before `findClashes`. Its success callback requires `world.isModelLive(model) === true`. However, `isModelLive` explicitly returns false for a model never previously admitted, and admission happens lazily when `findClashes` begins.

The disposal path has a related gap: `isModelLive` throws `WorldDisposedError` after disposal, but the search callback is not required to catch that exception and reject its original promise.

**Why it matters:** This defeats the extension's primary acceptance workflow and undermines the round-12 lifecycle fix.

**Concrete failure scenario:** On the first "Locate Room" action: `model.search` succeeds; no collision query has yet admitted the model; `isModelLive(model)` returns false; the callback rejects with `ModelEvictedError`, although the model remains loaded. If disposal occurs while search is pending, the callback can instead throw outside the promise chain, potentially leaving `locateElementByRoom` unsettled.

**Recommended specification change:** Add an explicit idempotent admission/lease operation before room search, such as `world.admitModel(model) → ModelLease`. The search must capture that lease and validate it in both success and error callbacks. Specify that: `evictModel` tombstones even a never-previously-admitted object; late completion after eviction rejects with `ModelEvictedError`; late completion after disposal rejects with `WorldDisposedError`; callback validation exceptions always reject the original promise; tests cover a successful first lookup, eviction-before-first-query, and disposal during search.

# Important Improvements (deferred — same set as rounds 10–12, largely stable; one new)

- Public containment definition contradicts the algorithm (High) — carried.
- Broad-phase boundary semantics are undefined (High) — carried.
- Instance freshness, model readiness, and transform validity lack one coherent contract (High) — carried, consolidating the transform/readiness/singular-matrix findings.
- Canonical operand ordering is not deterministic (High) — carried.
- Pair enumeration, duplicate inputs, and self-pairs are unspecified (High) — carried.
- Invalid dbIds cannot be distinguished by the specified extraction path (High) — carried.
- `RoomLocatorExtension`'s Viewer lifecycle and model-selection contract is incomplete (High) — carried.
- Budget boundaries and diagnostic mappings contradict each other (High) — carried.
- **Post-weld degenerate geometry is unhandled (High) — new this round.** Welding can collapse triangles; the spec doesn't say whether zero-area triangles are retained, removed, or rejected, with downstream effects on normals, manifold classification, and BVH behavior.
- Performance acceptance is not reproducible or objectively passable (High) — carried.
- Statistics and visible extension behavior are not testable (Medium) — carried.

# Questions / Clarifications

1. Are tolerances and budgets fixed internal constants, supported public options, or test-only injectable values?
2. Must `findClashes` reject 2D, incomplete, or no-longer-attached models with documented error classes?
3. Should intentional self-clash analysis ever be supported in Milestone 1, or are identical fragments always excluded?
4. When multiple rooms match, should all be returned and highlighted, or should the extension choose one?
5. Should `@types/forge-viewer` be pinned to a verified version instead of `"*"`, given that runtime Viewer is 7.124.2 while the lockfile currently contains typings 7.99.1?

# Positive Observations

- Runtime isolation between Viewer's r71 THREE and collision THREE r185 is explicit and appropriately tested.
- Geometry layouts, active ranges, welding, parity, manifold limitations, and tolerance frames are unusually well investigated.
- The three query modes have meaningfully distinct intended semantics.
- Diagnostics preserve incomplete or unsound results instead of silently converting them into verified negatives.
- The executable geometry spike passes 55/55 regression fixtures and clearly states which production concerns it does not cover.

# Overall Readiness

**Requires major revision**

# Disposition (applied to the spec after this review)

The Critical finding was accepted and fixed via an explicit, idempotent admission/lease mechanism:

- `world.admitModel(model) → ModelLease` — synchronous, idempotent — now called by the room-search cache-miss path *before* starting `model.search`, so a real lease always exists by the time the search's callbacks fire.
- `world.isLeaseValid(lease) → boolean` — the room-search success/error callbacks validate the captured lease instead of `isModelLive`, closing the "never seen → false" ambiguity that broke every first-ever room search.
- `world.isModelLive` is unchanged and still correct for general liveness queries; it is simply no longer the room-search guard.
- A second, related gap the fixture set hadn't exercised was also fixed: `evictModel`'s model.id-scoped cache/BLAS/geometry drop was unconditional, so a stale or duplicate eviction of a superseded old object could wipe a *different*, still-live object's state if both objects shared a reused `model.id`. Gated on `liveModelByModelId.get(model.id) === model` (later superseded by round 14's epoch-keying fix — see `review-comments-v14.md`).

The 9 stable High findings plus the 1 new High ("Post-weld degenerate geometry is unhandled") and 5 clarification questions were intentionally deferred — out of scope for this pass per explicit instruction — and remain open for a future round.
