# Round 11 Codex review

Type: spec
Effort: high
Input: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`
Request ID: 20260902-125509-11435-5957

# Executive Summary

Revise the frame-budget contract before implementation: its current checkpoints still permit long main-thread stalls.

The specification is technically mature, but it is not implementation-ready. One critical responsiveness defect remains, along with several unresolved correctness, lifecycle, API, and acceptance-test ambiguities. Most important improvements were already acknowledged as deferred round-10 findings.

Repository verification found:

- The application is an unbundled browser ESM Viewer app.
- `three@0.185.1` and `three-mesh-bvh@0.9.14` are installed as specified.
- The current spike passes 55/55 tests, but it does not implement the round-10 scheduling, lifecycle, aggregation, or public API contracts.
- No files were modified.

# Critical Issues

## Frame deadlines still do not bound synchronous work

**Severity:** Critical

**Location or section:** `ProperCrossingQuery` deadline (line 981), `ContainmentQuery` checkpoint (line 1236), `CollisionWorld` scheduling (line 1463)

**Problem:** `ProperCrossingQuery` checks time only when entering `intersectsTriangles`, but one callback may execute 12 probes, each performing up to two proximity checks and six raycasts. `ContainmentQuery` checks only every 256 classifications. Neither interval bounds elapsed time, and one `classifyPoint` call is itself uninterruptible.

**Why it matters:** The specification claims synchronous work is bounded to roughly one frame, but the mechanism only detects overruns after potentially expensive work has already blocked rendering and input.

**Concrete failure scenario:** A callback begins at 7.9 ms elapsed, then evaluates 12 difficult probes against dense BVHs. It returns at 40 ms. The next clock check aborts further work, but the UI has already experienced a 40 ms task. Similarly, 256 containment classifications can run far beyond `frameBudgetMs` before yielding.

**Recommended specification change:** Require deadline checks before every expensive probe/classification, not merely once per callback or every 256 samples. Define and measure the maximum cost of one uninterruptible `classifyPoint` and BVH build at the permitted geometry size. If one primitive can exceed the limit, either introduce a deadline-aware traversal/Worker path, or replace the hard frame guarantee with an explicitly measured best-effort limit and a smaller geometry ceiling. Add acceptance fixtures that measure the longest uninterrupted interval inside one callback and one classification, not only total query or between-yield durations.

# Important Improvements (not addressed this round — deferred, except the generation-ABA item which was fixed)

## Correctness contracts

- **Public containment definition contradicts the normative algorithm** (High) — API comment still says "any part of the source" vs. the normative "on the source surface." Carried from round 10.
- **Broad-phase boundary semantics are undefined** (High) — AABB scan doesn't state whether boundary contact (flush faces) counts as overlap; a strict comparison could drop exactly the pairs `surface-intersection` needs to see. New this round.
- **Cached instances have no transform or geometry-readiness policy** (High) — carried from round 10, now also covering progressive-load readiness explicitly.
- **Canonical operand ordering is not deterministic** (High) — carried from round 10.
- **Singular and invalid transforms are not handled** (High) — no contract for zero-scale/singular/non-finite fragment transforms feeding matrix inversion. New this round.

## Diagnostics and lifecycle

- **Budget-exhaustion diagnostics contradict each other** (High) — carried from round 10 (`crossing-budget-exhausted` vs `inconclusive-crossing` for the same trip condition).
- **Invalid dbIds cannot be distinguished by the specified extraction path** (High) — carried from round 10.
- **Model-generation reuse safety lacks an allocation rule** (High) — **fixed this round despite its severity label**: the per-`modelId` generation counter round 10 introduced resets on reuse, creating an ABA race. Replaced with a global, monotonic, never-reset `nextLoadEpoch`. Also flagged a stale Risks-section line still calling the unload event name unverified after round 10 had already selected it — reconciled.

## Public API and verification

- **Pair enumeration and self-collision semantics are missing** (High) — no defined behavior for duplicate/overlapping source and target dbIds. New this round.
- **`RoomLocatorExtension`'s Viewer contract is incomplete** (High) — `load()`/`unload()` return-value contract and multi-model `locateElementByRoom` argument are unspecified. New this round.
- **The performance acceptance gate is not reproducible or objectively passable** (High) — carried from round 10, plus a new note that the Long Tasks API's reporting threshold is unsuitable for detecting ~16ms tasks.

# Questions / Clarifications

1. Are tolerances, budgets, and `frameBudgetMs` public options or fixed Milestone-1 constants?
2. Must `findClashes` reject 2D models and models whose object tree or geometry is not fully ready?
3. When multiple rooms match, should the extension highlight all rooms, select one, or report ambiguity?
4. What visible UX handles diagnostics and `ModelEvictedError`, and when is previous room highlighting cleared?
5. Should diagnostics and result pairs have a stable documented order for repeatable tests?

# Positive Observations

- Surface contact, directed surface containment, and positive-volume overlap now have meaningfully distinct contracts.
- Geometry layouts, active ranges, welding, tolerance frames, and manifold limitations are unusually well investigated.
- Diagnostics preserve incomplete and unsound results instead of silently converting them into verified negatives.
- The dependency pins match the installed packages, and the spike passes all 55 current fixtures.
- The room-search rejection and late-completion cache rules substantially improve lifecycle safety.

# Overall Readiness

**Requires major revision** at time of this review. The core geometry direction is credible, but implementation should not begin until the critical synchronous-work bound is corrected. The containment contract, transform freshness, generation identity, pair enumeration, and acceptance gate should be resolved in the same revision to avoid predictable rework.

# Disposition (applied to the spec after this review)

The Critical finding was accepted and fixed: per-primitive checkpoints now fire before each individual probe (`ProperCrossingQuery`) and each individual `classifyPoint` call (`ContainmentQuery`), and the "no synchronous step exceeds ~16ms" claim was reframed into two explicit tiers (a per-atomic-operation ceiling, dominated by the already-measured ~16ms `MeshBVH` build; and the cooperative-composition ceiling `frameBudgetMs` actually bounds), with the performance gate now required to measure a single `classifyPoint`/probe's own cost rather than assume it negligible.

The model-generation-reuse ABA bug was also accepted and fixed this round, ahead of the other High findings, since it directly undermines round 10's Critical #2 fix.

The remaining 8 High findings and 5 clarification questions were intentionally deferred — out of scope for this pass per explicit instruction — and remain open for a future round.
