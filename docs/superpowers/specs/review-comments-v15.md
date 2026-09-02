# Round 15 Codex review

Type: spec
Effort: high
Input: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`
Request ID: 20260902-142030-50168-18392

Revise the lifecycle, scheduling, and containment contracts before implementation.

# Executive Summary

Three blockers remain:

- Disposal cannot invalidate every admitted model when numeric model IDs are reused.
- Evicting a model that was never admitted cannot create the permanent tombstone the contract requires.
- The frame-time guarantee excludes welding, connectivity, extraction, and broad-phase work.

The existing spike passes 55/55 fixtures, but explicitly omits Viewer adapters, caches, diagnostics, budgets, aggregation, and lifecycle behavior. A local 19,800-triangle check also measured approximately 16.8 ms for welding and 6.9 ms for edge-map construction—before BVH construction—contradicting the specification's claim that BVH construction is the only full-frame atomic operation.

No files were modified.

# Critical Issues

## Disposal cannot enumerate all live model objects

**Severity:** Critical

**Location or section:** `world.dispose()` and lifecycle maps, especially `liveModelByModelId`, and the same-ID concurrency fixture.

**Problem:** `modelLifecycle` is a non-enumerable `WeakMap`, while `liveModelByModelId` retains only one "current" object per numeric ID. The specification explicitly supports admitting a new object under an ID while the old object remains live. Once the map entry is overwritten, disposal cannot find the old object to tombstone it.

**Why it matters:** The old lease can remain valid after disposal. A suspended old-model query revalidates only its lifecycle entry, passes, and can resume after collision state has been released.

**Concrete failure scenario:** `oldModel` and `newModel` share ID 7 and both remain live under distinct epochs. `liveModelByModelId[7]` points only to `newModel`. `dispose()` tombstones `newModel`; `oldModel` remains `{state:'live'}`. A suspended query against `oldModel` resumes and passes the epoch check.

**Recommended specification change:** Maintain an enumerable collection of every live object or lease, keyed by exact object or epoch. Disposal must tombstone all entries. Require `isLeaseValid` and every internal resume checkpoint to test the world's `disposed` flag independently of model state. Add a test with two simultaneously live objects sharing one model ID, followed by disposal.

## Eviction before admission has no representable tombstone

**Severity:** Critical

**Location or section:** `world.evictModel` and `modelLifecycle`.

**Problem:** The lifecycle map is defined as containing objects the world has admitted, with every entry requiring an epoch. However, `BEFORE_MODEL_UNLOAD_EVENT` can call `evictModel` for a model never used by `findClashes` or room search. The specification does not say whether eviction inserts a tombstone, consumes an epoch, or returns without recording anything.

**Why it matters:** Returning for an unknown model permits a retained reference to be admitted after it has already unloaded, directly contradicting the permanent-tombstone guarantee.

**Concrete failure scenario:** A model loads and unloads without any collision request. `evictModel(model)` finds no lifecycle entry and does nothing. A delayed callback later passes that object to `findClashes`; "no entry" is interpreted as legitimate first use, and geometry extraction begins against the unloaded model.

**Recommended specification change:** Define lifecycle entries as a discriminated union such as `{state:'live', epoch:number}` or `{state:'evicted', epoch?:number}`. Evicting an unseen object must insert an eviction tombstone without allocating a live epoch. Add `evict-before-admit`, `admit-after-evict`, and disposal-of-unadmitted-model tests.

## The synchronous-work bound excludes major operations

**Severity:** Critical

**Location or section:** `ViewerGeometryAdapter` and welding, `GeometryConnectivity`, atomic-operation claim, and `findClashes` data flow.

**Problem:** Scheduling checkpoints cover BVH construction and narrow-phase loops, but not typed-array conversion and `mergeVertices`, connectivity/edge-map construction, recursive fragment extraction, and the `sourceInstances × targetInstances` broad-phase scan. The API calls these "small-batch" queries but defines no input or instance limit. It is also unclear whether the 20,000-triangle rejection occurs before or after mandatory welding.

**Why it matters:** These operations run on the Viewer's main thread and can exceed the frame target before any checkpoint. Oversized geometry may incur the expensive normalization the ceiling was meant to avoid.

**Concrete failure scenario:** On this repository's dependencies, a local 19,800-triangle position-only sphere took about 16.8 ms to weld and another 6.9 ms to construct an edge map. Performing those operations plus BVH construction in one span exceeds the stated frame bound. A large assembly can also generate a quadratic broad phase before the first narrow-phase yield.

**Recommended specification change:** Count active raw triangles before allocating or welding and reject at the exact ceiling first. Treat welding and connectivity as separately measured atomic operations with yields between them. Add extraction and broad-phase checkpoints or enforce explicit maximum dbId/fragment counts. Include all these operations in the performance gate and revise the atomic-operation table.

# Important Improvements (deferred — same 10 High findings as round 14, unchanged)

- Public containment contract contradicts the algorithm (High).
- Valid surface containment can return false (High) — a source face whose interior lies inside the target but whose vertices are all boundary-classified (point-only contact, no crossing segment) is diagnosed false rather than true.
- Broad-phase boundary semantics are undefined (High).
- Model readiness, transform freshness, and transform validity lack one contract (High).
- Canonical ordering is not deterministic (High).
- Pair enumeration and duplicate/self-input behavior are missing (High).
- Invalid dbIds cannot be distinguished from valid empty nodes (High).
- Extension lifecycle, model selection, and result presentation are incomplete (High).
- Disposal error behavior contradicts the public extension contract (High) — closely related to, but distinct from, the Critical fixed this round.
- Budget thresholds and diagnostic mappings conflict (High).
- Post-weld degeneracy and malformed range handling are undefined (High).
- The performance gate is not reproducible or objectively passable (High).
- Statistics and the required test suite are not executable contracts (Medium).

# Questions / Clarifications

1. Are tolerances and budgets immutable constants, supported public options, or test-only injectable values?
2. Must every matching room be returned and highlighted, or should overlapping-room results be treated as ambiguity?
3. Is `BEFORE_MODEL_UNLOAD_EVENT` guaranteed for every supported removal path, and what fallback liveness check applies if it is missed?
4. Should diagnosed positive pairs be consumed normally by `RoomLocatorExtension`, or presented as indeterminate?
5. Should `@types/forge-viewer` be pinned? `package.json` uses `"*"`, while the lockfile currently resolves 7.99.1 and runtime Viewer is 7.124.2.

# Positive Observations

- The three query modes have meaningfully distinct intended semantics.
- Geometry layouts, active ranges, tolerance frames, welding, parity, and manifold limitations have unusually strong supporting analysis.
- Epoch-scoped geometry identity correctly prevents old and new model objects from sharing BLAS state.
- Budget-abort control flow is explicitly prevented from becoming a fabricated clash result.
- Exact collision-runtime pins and ESM isolation protect Viewer's legacy `window.THREE`.

# Overall Readiness

**Requires major revision**

# Disposition (applied to the spec after this review)

All three Criticals were accepted and fixed, addressing the user's explicit instruction to review the lifecycle and preprocessing-budget invariants as systems rather than patch the diff:

- **Disposal enumeration**: `disposed` is now checked directly and first at every liveness site (every per-yield checkpoint, `isLeaseValid`, `isModelLive`, `findClashes`'s entry), not inferred from a per-model tombstone a sweep may fail to reach. `dispose()` no longer needs to enumerate-and-tombstone every live model for correctness; it wholesale-clears the geometry/BLAS/connectivity caches instead, and `liveModelByModelId` is now purely diagnostic bookkeeping.
- **Evict-before-admit**: `modelLifecycle`'s value type is now a two-variant discriminated union — `{state:'live', epoch:number} | {state:'evicted'}` — so evicting a never-admitted object is representable without fabricating an epoch. `evictModel` unconditionally writes the evicted tombstone regardless of prior state, releasing epoch-scoped cache state only when a prior live entry actually had one.
- **Preprocessing budget coverage**: welding, connectivity construction, and BVH construction are now three separately-checkpointed atomic phases (connectivity remains independently lazy for modes that don't consume it); `maxSyncTriangleCount` is revised down to a reasoned, provisional `12_000` pending re-measurement of all three phases; two new reasoned ceilings, `maxFragmentsPerDbId` and `maxBroadPhaseInstancePairs`, bound extraction and the broad-phase scan, which previously had neither a checkpoint nor a size limit.

The 10 High findings and 5 clarification questions were intentionally deferred — out of scope for this pass per explicit instruction — and remain open for a future round.
