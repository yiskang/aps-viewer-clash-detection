# Round 16 Codex review

Type: spec
Effort: high
Input: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`
Request ID: 20260902-145450-11667-28856

Revise the three Critical issues below before implementation.

# Executive Summary

The geometry direction is credible, and the existing spike still passes 55/55 fixtures. However, those fixtures cover the earlier geometry prototype—not the production adapters, lifecycle, caching, scheduling, diagnostics, or round 15 changes.

Three blockers remain:

- `volume-overlap` both requires and forbids connectivity construction.
- `maxFragmentsPerDbId` is checked only after the unbounded operation it claims to limit.
- `maxSyncTriangleCount` may count active triangles while `mergeVertices` processes the entire underlying index.

No files were modified.

# Critical Issues

## `volume-overlap` has contradictory connectivity requirements

**Severity:** Critical

**Location or section:** `ThreeMeshBvhBackend`/`BlasCache`, `VolumeOverlapQuery`, performance gate.

**Problem:** The preprocessing section says only `containment` consumes connectivity and explicitly says a `volume-overlap`-only session never builds it. The algorithm later defines `volume-overlap` using two `ContainmentQuery(anyComponentInside(...))` passes. Its closure and manifold diagnostics also depend on connectivity. The test plan reinforces the wrong branch by requiring no connectivity checkpoint for `volume-overlap`.

**Why it matters:** There is no conforming implementation. Skipping connectivity prevents component sampling and manifold certification; building it violates the preprocessing and test contracts.

**Concrete failure scenario:** A small closed box lies wholly inside a larger box. `ProperCrossingQuery` returns false because the surfaces do not cross. The required containment term cannot enumerate components or certify the source as closed without `GeometryConnectivity`, so the implementation either misses the overlap or silently invents a fallback.

**Recommended specification change:** Add a normative dependency matrix: `surface-intersection`: weld + BVH; `containment`: weld + connectivity + BVH; `volume-overlap`: weld + connectivity + BVH. Reverse the round-15 test that currently expects `volume-overlap` not to build connectivity. Test both cold construction and reuse of cached connectivity.

## The fragment ceiling does not bound recursive extraction

**Severity:** Critical

**Location or section:** atomic-operation table, Data Flow step 3, `InstanceTree` typing.

**Problem:** `maxFragmentsPerDbId` is checked after `enumNodeFragments(dbId, callback, true)` returns. That API exposes a `void` callback and no documented cancellation mechanism. A subtree containing 100,000 fragments must therefore enumerate all 100,000 before the code learns that it exceeded 5,000.

**Why it matters:** The new ceiling does not constrain the synchronous main-thread burst it was introduced to constrain. The spec's claimed worst-case scheduling bound remains false.

**Concrete failure scenario:** A large assembly contains 100,000 fragments. The callback collects them all during one recursive native call, blocking the Viewer. The eventual rejection at fragment 100,000 is correct functionally but arrives after the freeze.

**Recommended specification change:** Replace recursive enumeration with a specified bounded mechanism—for example, an explicit non-recursive node traversal that can yield and stop once the ceiling is crossed, or a verified constant-time subtree fragment-count preflight. Also checkpoint the subsequent matrix/bounds extraction loop. Do not rely on throwing from the callback unless that behavior is verified and made normative.

## Active-range counting may not bound welding work

**Severity:** Critical

**Location or section:** range normalization, collision geometry construction, `maxSyncTriangleCount`.

**Problem:** The specification does not say whether the triangle ceiling counts the complete index buffer or only normalized active ranges. It proposes retaining the underlying geometry and expressing active ranges through groups/draw range. Upstream `mergeVertices`, however, traverses the complete index and ignores groups/draw range.

**Why it matters:** A geometry can pass the 12,000-active-triangle check while welding hundreds of thousands of inactive triangles synchronously.

**Concrete failure scenario:** A geometry has one million indexed triangles but a draw range exposing only 100. It passes an active-triangle ceiling, then `mergeVertices` walks the million-triangle index and freezes the Viewer.

**Recommended specification change:** Before welding, materialize a compact position/index geometry containing only validated active triangles. Apply `maxSyncTriangleCount` to the exact triangle set passed to `mergeVertices`. Specify whether the compaction loop is bounded or cooperatively scheduled.

# Important Improvements (deferred — same 10 High findings as round 15, unchanged)

- Public containment behavior is contradictory and incomplete (High).
- Broad-phase and pair enumeration semantics are missing (High).
- Viewer readiness, transform consistency, and invalid matrices lack a contract (High).
- Build-phase checkpoint rules contradict the tests (High) — new framing this round: whether build phases always yield unconditionally or merely inspect the deadline is itself ambiguous.
- Lifecycle and extension error behavior still conflict (High).
- Invalid dbIds cannot be distinguished by the stated extraction path (High).
- Geometry validation after range normalization and welding is undefined (High).
- In-flight build publication is not sufficiently specified (High) — new framing: `accelerationPromise` dedup exists, but there's no equivalent contract for connectivity, and no spec for what "publish only once complete" means concurrently.
- Budget boundaries and diagnostics conflict (High).
- Acceptance and test contracts are not executable or reproducible (High).
- Viewer typings are not reproducibly pinned (Medium).

# Questions / Clarifications

1. Are tolerances and budgets immutable constants, supported public options, or test-only injectable values?
2. Must diagnosed positive pairs be consumed normally, or presented as indeterminate?
3. When multiple rooms match, should all be returned/highlighted or should the extension report ambiguity?
4. What fallback invalidates models if `BEFORE_MODEL_UNLOAD_EVENT` is missed?
5. Which stable error classes/codes are part of the public compatibility contract?

# Positive Observations

- The distinction among surface contact, directed surface containment, and positive-volume overlap is well motivated.
- Geometry layout handling, tolerance frames, welding, parity, and manifold limitations have unusually strong analysis.
- Epoch-scoped geometry identity and permanent object-identity tombstones address model-ID reuse cleanly.
- Abort control flow is explicitly prevented from becoming a fabricated clash.
- `node spike/fixtures.mjs` currently passes all 55 existing geometry fixtures.

# Overall Readiness

**Requires major revision**

# Disposition (applied to the spec after this review)

All three Criticals were accepted and fixed, reviewing the extraction/build pipeline as one invariant per explicit instruction: Viewer geometry → active-range compaction → size gate → weld → connectivity when required → BVH.

- **Connectivity dependency**: corrected — `volume-overlap` builds connectivity (via `anyComponentInside`) exactly as `containment` does; only `surface-intersection` doesn't. The wrong round-15 fixture was replaced with one testing the correct boundary.
- **Fragment ceiling**: the single recursive `enumNodeFragments` call was replaced with a self-driven walk using `InstanceTree`'s non-recursive primitives (`enumNodeChildren`/`getChildCount`/non-recursive `enumNodeFragments`), which aborts as soon as the running tally crosses `maxFragmentsPerDbId` rather than after full enumeration.
- **Active-range compaction**: inserted as a phase before the size gate and before welding — the active triangle count is computed cheaply from already-normalized range metadata and checked first; only once confirmed under the ceiling is a compacted, collision-owned buffer materialized, which welding, connectivity, and BVH construction all then operate on exclusively. This also retired the previous `groups`/`drawRange`-on-BVH-input workaround as unnecessary.

The 10 High findings and 5 clarification questions were intentionally deferred — out of scope for this pass per explicit instruction — and remain open for a future round.
