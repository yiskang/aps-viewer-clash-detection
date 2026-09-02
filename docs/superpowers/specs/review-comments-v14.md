# Round 14 Codex review

Type: spec
Effort: high
Input: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`
Request ID: 20260902-135730-12494-14417

Do not begin implementation until the two lifecycle blockers are resolved.

# Executive Summary

The geometric design is unusually rigorous, and the existing spike passes 55/55 fixtures. However, the current specification can still:

- Reuse collision data from an unloaded model after `model.id` reuse.
- Leave a room-search promise hanging because disposal behavior is contradictory.
- Return a diagnosed false result for a valid `containment` input.
- Produce incompatible implementations around transforms, pair enumeration, diagnostics, extension lifecycle, and performance acceptance.

The spec itself acknowledges ten deferred High findings. Repository inspection confirms they remain implementation-affecting. No files were modified.

# Critical Issues

## Model-ID reuse can alias stale geometry and BLAS state

**Severity:** Critical

**Location or section:** GeometryRegistry identity (line 708), model admission (line 1735), occupancy tracking (line 1827)

**Problem:** Lifecycle state is keyed by exact `Model` object, but `CollisionInstance`, `GeometryRecord`, BLAS, and connectivity caches remain keyed by numeric `modelId`. When a different model object is admitted under an occupied/reused ID, the spec says to record it in `liveModelByModelId` but does not retire the former occupant or clear/version its cached state.

The later occupancy guard only prevents stale eviction from deleting the new model's state. It does not prevent the new model from finding the old model's state during admission or lookup.

**Why it matters:** The lifecycle token can remain valid while the actual geometry retrieved from an ID-keyed cache belongs to a different model load. This defeats both collision correctness and the stated ABA protection.

**Concrete failure scenario:** An old model's unload event is delayed. A new `Model` object reuses the same `model.id` and geometry index `42`. Its first query finds the old `(modelId, 42)` `GeometryRecord` and BLAS. The query returns clashes computed against the old model. A subsequent delayed `evictModel(oldModel)` skips cleanup because the new object occupies the ID, leaving ownership unresolved.

**Recommended specification change:** Either (1) key all model-scoped caches by exact `Model` object or immutable per-load epoch, or (2) make admission atomic: if the ID is occupied by another object, tombstone the old object, purge its ID-scoped state, and only then admit the new object. Specify that two distinct live lifecycle entries may never own the same ID-keyed cache namespace. Add tests for new-model admission before delayed old-model eviction, including the new model's first geometry lookup and an old suspended query resuming afterward.

## Disposal semantics for leases directly contradict each other

**Severity:** Critical

**Location or section:** `isLeaseValid` (line 1747), `dispose` (line 1795), disposal edge case (line 2130)

**Problem:** `isLeaseValid` explicitly says it returns `false` after disposal and does not throw. The immediately following `dispose` contract says every public method—including `isLeaseValid`—must throw `WorldDisposedError`. The room-search callbacks rely on this predicate without a specified `try/catch`.

**Why it matters:** These alternatives produce observably different error types and control flow. Throwing from an asynchronous Viewer callback can bypass the outer promise's `reject`, leaving `locateElementByRoom` pending forever.

**Concrete failure scenario:** A room search is pending when the extension unloads and disposes the world. The success callback later calls `isLeaseValid`. One implementation returns `false` and rejects the lookup; another throws `WorldDisposedError` out of the callback, producing an uncaught exception while the original lookup remains unsettled.

**Recommended specification change:** Define one normative behavior. Prefer making lease validation a total, non-throwing operation returning a discriminated state such as `valid | evicted | disposed`, then require the room-search callback to reject with the mapped documented error. Reconcile all public API, disposal, and test text with that choice.

# Important Improvements (deferred — same 10 High findings as round 13, unchanged)

- Public `containment` definition conflicts with the algorithm (High).
- Containment misses a supported surface configuration (High) — new framing this round: a source face whose interior is inside the target but whose vertices are all boundary-classified (point-only contact, no crossing segment) is currently diagnosed false rather than true.
- Broad-phase boundary semantics are undefined (High).
- Instance caching lacks transform and readiness rules (High).
- Singular and non-finite transforms are unhandled (High).
- Post-weld degenerate triangles have no policy (High).
- Canonical operand ordering is not deterministic (High).
- Pair enumeration, duplicate inputs, and self-collision are undefined (High).
- Invalid dbIds cannot be distinguished from valid empty nodes (High).
- `RoomLocatorExtension` lacks a valid Viewer lifecycle and model-selection contract (High).
- Budget boundaries and diagnostic mappings contradict each other (High).
- The performance gate is not reproducible or objectively passable (High).
- Statistics and visible extension behavior are underspecified (Medium).
- The required test suite has no executable harness contract (Medium) — new this round.

# Questions / Clarifications

1. Are tolerances and budgets immutable Milestone-1 constants, public options, or internal values tests may override?
2. Must `findClashes` verify that the supplied model remains present in `viewer.getAllModels()`, or is explicit admission sufficient?
3. When multiple rooms contain the source, should the extension return and highlight all matches or report ambiguity?
4. What stable error codes/classes should callers use for invalid dbIds, unsupported models, model-not-ready, eviction, disposal, and unsupported options?
5. Is `BEFORE_MODEL_UNLOAD_EVENT` guaranteed for every removal path supported by this milestone? If not, what secondary liveness check closes that dependency?

# Positive Observations

- The three query modes have meaningfully distinct intended semantics.
- Geometry layout normalization, active ranges, welding, parity, and manifold limitations are researched in substantial depth.
- Budget aborts are designed not to become fabricated clash results.
- Exact dependency pins and self-hosted ESM isolation protect Viewer's legacy `window.THREE`.
- The existing spike's 55 passing fixtures provide a strong starting set for production geometry tests.

# Overall Readiness

**Requires major revision**

The two lifecycle contradictions can produce stale-geometry results or permanently unsettled promises. The deferred High findings also affect public semantics, correctness, lifecycle behavior, and acceptance—not merely documentation quality.

# Disposition (applied to the spec after this review)

Both Criticals were accepted and fixed at the root cause, per explicit instruction not to add another admission-time purge workaround:

- **Model-ID reuse aliasing**: `GeometryRegistry`/`BlasCache`/`GeometryConnectivity` now key every record by `(loadEpoch, geometryIndex)` — the admitted object's own globally-unique, never-reused epoch — instead of bare `(modelId, geometryIndex)`. Two `Model` objects sharing a reused `modelId` are now structurally guaranteed disjoint cache namespaces regardless of eviction timing; round 13's `evictModel` occupancy guard on `liveModelByModelId` was demoted from a correctness requirement to bookkeeping hygiene for `dispose()`'s enumeration sweep.
- **Disposal/lease contradiction**: `isLeaseValid` is now the one documented, deliberate exception to "every public method throws `WorldDisposedError` once disposed" — it stays strictly non-throwing and boolean always; `dispose()`'s method list was corrected to say so explicitly instead of listing `isLeaseValid` alongside the throwing methods. A caller needing the specific reason (evicted vs. disposed) calls `isModelLive` (unchanged, still throws) separately.

The 10 High findings and 5 clarification questions were intentionally deferred — out of scope for this pass per explicit instruction — and remain open for a future round.
