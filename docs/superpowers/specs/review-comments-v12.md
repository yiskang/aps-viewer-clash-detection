# Round 12 Codex review

Type: spec
Effort: high
Input: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`
Request ID: 20260902-131049-40288-27966

Revise the lifecycle contract before implementation; late async work can currently resurrect an evicted or disposed model.

# Executive Summary

The geometric design is unusually thorough, but the specification is not implementation-ready.

The most serious remaining defect is lifecycle-related: eviction prevents stale cache writes but does not invalidate the caller awaiting a late `model.search`. Because collision epochs are allocated lazily, that caller can register the already-unloaded `Model` as a new load and continue using stale geometry.

Nine issues are explicitly deferred in the revision notes, and they remain implementation-affecting. The most consequential concern transform freshness, broad-phase contact semantics, operand ordering, pair enumeration, extension lifecycle contracts, and the performance gate.

Repository verification found:

- The application loads Viewer 7.124.2 as an unbundled browser application.
- The current model-loading flow does not await `loadModel`, increasing the importance of an explicit readiness contract.
- Viewer typings provide model readiness checks and require `Extension.load(): boolean | Promise<boolean>` and `unload(): boolean`.
- The executable spike passes 55/55 tests, but it covers geometry behavior only through round 8 — not the current lifecycle, scheduling, aggregation, or public API design.
- No files were modified.

# Critical Issues

## Evicted and disposed models can be resurrected

**Severity:** Critical

**Location or section:** Room-search completion (line 1516), lazy load epochs (line 1645), extension unload (line 1676)

**Problem:** The identity check only prevents a late room-search callback from modifying the cache. It does not reject the promise already returned to `locateElementByRoom`. After eviction, that caller can continue into `findClashes`. Because an epoch is assigned when a model is first touched, the old `Model` object can receive a new epoch and be treated as live. Similarly, `dispose()` has no specified terminal state preventing later calls from rebuilding state.

**Why it matters:** The generation mechanism protects work suspended after an epoch was captured, but not stale work that enters `findClashes` after eviction or disposal. This defeats the lifecycle guarantee and risks accessing unloaded Viewer data.

**Concrete failure scenario:** A room search starts before the first collision query. `BEFORE_MODEL_UNLOAD_EVENT` fires and evicts the model. The search then succeeds; its cache write is discarded, but the awaiting locate call receives the room IDs and invokes `findClashes` with the unloaded model. The world assigns that object a fresh epoch and attempts geometry extraction.

**Recommended specification change:** Make lifecycle identity include the exact `Model` object, not only `model.id`. Register its epoch before room search begins; tombstone the exact object on eviction; validate the token immediately after every asynchronous room-search completion and before entering `findClashes`. Define `dispose()` as terminal and require every public method to reject after disposal. Add tests asserting that a late search rejects its original locate call and that calls made after eviction/disposal cannot recreate state.

# Important Improvements (deferred — same set as rounds 10–11, largely stable)

## Correctness and geometry state

- **Public containment contract remains contradictory** (High) — carried.
- **Broad-phase contact semantics are undefined** (High) — carried; inclusive/exclusive AABB boundary comparison unresolved.
- **Cached instances have no transform or readiness policy** (High) — carried, now also naming `isObjectTreeCreated`/`isLoadDone` as candidate readiness checks.
- **Singular and non-finite transforms are unhandled** (High) — carried.
- **Canonical operand ordering is not deterministic** (High) — carried.

## API, diagnostics, and verification

- **Pair enumeration and self-collision semantics are absent** (High) — carried.
- **Invalid dbIds cannot be distinguished by the stated algorithm** (High) — carried.
- **`RoomLocatorExtension` does not satisfy the Viewer lifecycle or model-selection contract** (High) — carried; `load()`/`unload()` boolean-return contract and multi-model `locateElementByRoom` argument still unspecified.
- **Budget diagnostics and threshold boundaries contradict each other** (High) — carried, now also flagging a `>=`/`>` boundary ambiguity on `maxSyncTriangleCount`.
- **The performance gate is not reproducible or objectively passable** (High) — carried, now also flagging an explicit `8ms` vs `~16ms` wording conflict on `frameBudgetMs`'s own tolerance band.
- **Statistics and observable UX behavior are under-specified** (Medium) — new this round; `ClashStatistics` counter semantics for skipped/duplicate/self/aborted/diagnosed pairs, and extension highlight/clear behavior, are unspecified.

# Questions / Clarifications

1. Are tolerances and budgets public configuration, fixed Milestone-1 constants, or internal defaults that tests may override?
2. Must `findClashes` reject 2D models, incomplete models, and models no longer present in `viewer.getAllModels()`?
3. Should overlapping source/target sets support intentional self-clash analysis, or is identical-fragment comparison always excluded?
4. Does a room lookup with multiple valid rooms return and highlight all of them, or identify one preferred room?
5. Should cross-model, invalid-dbId, not-ready, disposed-world, and unsupported-option failures use documented error classes/codes?

# Positive Observations

- Surface intersection, directed surface containment, and positive-volume overlap are now meaningfully distinct.
- Geometry normalization, active ranges, welding, parity, manifold limitations, and tolerance frames are investigated in exceptional detail.
- Budget aborts are designed not to turn control-flow signals into fabricated clashes.
- Model-generation ABA protection for already-running collision queries is substantially stronger than the earlier design.
- Self-hosted pinned collision dependencies and the clean-install module-resolution check reduce runtime drift.

# Overall Readiness

**Requires major revision** at time of this review. The lifecycle resurrection defect is a blocker. The explicitly deferred high-severity issues should also be resolved before implementation because they affect public behavior, correctness, cache validity, and acceptance — not merely documentation quality.

# Disposition (applied to the spec after this review)

The Critical finding was accepted and fixed by replacing `modelId`-keyed liveness with identity keyed by the exact `Model` object:

- `modelLifecycle: WeakMap<Model, {epoch, state}>` — permanent tombstone on eviction, never deleted.
- `findClashes` validates liveness at entry (new), in addition to the existing per-yield re-validation.
- The room-search promise chain now rejects its *original caller* (`ModelEvictedError`) on a late completion after eviction, not just skips a cache write.
- `world.evictModel` now takes the exact `Model` object; a new `world.isModelLive(model)` read-only accessor was added.
- `world.dispose()` is now terminal: every public method rejects/throws `WorldDisposedError` after disposal, checked ahead of any per-model state.

The 9 High findings (stable across rounds 10-12) and 5 clarification questions were intentionally deferred — out of scope for this pass per explicit instruction — and remain open for a future round.
