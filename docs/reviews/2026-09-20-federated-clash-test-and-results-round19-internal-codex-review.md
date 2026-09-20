# Federated Clash Test & Results round 19 internal Codex review (raw output)

- **Reviewed draft:** [`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`](../superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md)
- **Draft SHA-256 at review time:** `84db416379491f9fabcdab8f8c99f6c33ab88692ab8af1969b35617d3d75107f` (uncommitted round 19 remediation on HEAD `62aa070`)
- **Reviewer:** internal `codex-review spec` (medium effort), request `20260920-212650-83795-16541` — the *internal* reviewer of the CLAUDE.md review loop, **not** the independent acceptance gate
- **Prior:** [`2026-09-20-federated-clash-test-and-results-round18-internal-codex-review.md`](2026-09-20-federated-clash-test-and-results-round18-internal-codex-review.md)
- **Review date:** 2026-09-20
- **Status:** raw reviewer output, preserved verbatim below. Dispositions are in spec §25 "Round 20".

---

Revise the spec before implementation; the current draft can still produce a false “no clashes” result and contains incompatible lifecycle contracts.

# Executive Summary

The core exact-cover planner is unusually thorough, and its assumptions generally match the current collision library. However, one unresolved scope-proof defect can omit newly appearing whole-model source fragments while still permitting an unqualified clean result.

Five additional contradictions would force implementers to choose incompatible behavior around input capture, persistence reads, validation, product gating, and defaults.

No files were modified.

# Critical Issues

## 1. Whole-model source population is not bracketed

- **Severity:** Critical
- **Location or section:** [§5.2](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:242), [§6.2.1](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:354), [§16.3](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1115)
- **Problem:** Whole-model source selections have both a population digest and root subtree digests, but execution brackets only the source roots. The whole population digest is bracketed only when the model is a whole-model target.
- **Why it matters:** A fragment outside the instance-tree roots can appear during a source-oriented run without changing any source subtree digest. The run can therefore record `scopeProof: equal`, empty `unreachablePopulation`, full coverage, and clean integrity even though the whole-model selection changed.
- **Concrete failure scenario:** Model M is a whole-model source against model X. After planning, M gains an owner-resolvable fragment outside all planned root subtrees. Source pre/post checks see unchanged root digests, so the fragment is never queried and the unit is `evaluated`. The fragment disappears before claim-time freshness checks. The recorded and current population digests again match, allowing `engine.canClaimNoClashes` to return `true`. This is not the documented “A→B→A wholly inside one call” residual because M’s population was never bracketed around that source call.
- **Repository evidence:** Whole-model extraction is a distinct target-only path in [ViewerModelAdapter.js](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/collision/viewer/ViewerModelAdapter.js:167), and `CollisionWorld` invokes it only for target entries without `dbIds` in [CollisionWorld.js](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/collision/CollisionWorld.js:1473).
- **Recommended specification change:** Require every unit involving a `kind:'model'` source to bracket both:
  - the materialized source-root subtree digests; and
  - that model’s whole-population digest.

  Any population mismatch must cause `scope-drift` even when the root digests remain unchanged. Extend AC-8 with source-only unreachable growth, shrink, and transient growth followed by reversion before claim-time freshness.

# Important Improvements

## 1. Raw Result Set capture conflicts with queued read-slot semantics

- **Severity:** High
- **Location or section:** [§13.5.2](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:928), [§13.6](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:958)
- **Problem:** Caller-supplied Result Sets must be captured synchronously before the first `await`, but they also use read slots and the FIFO read queue.
- **Why it matters:** When all read slots are occupied, no implementation can satisfy all stated guarantees:
  - Capture immediately, then queue: queued captures can consume `maxQueuedStoreReads × schema-ceiling size`, violating the stated transient-memory bound.
  - Queue the caller’s reference, then capture: caller mutation creates a TOCTOU defect.
  - Reject immediately: the FIFO contract is not honored.
- **Concrete failure scenario:** One maximum-size raw-set claim is active and eight more are queued. Immediate capture retains nine large graphs even though `maxConcurrentStoreReads` is 1.
- **Recommended specification change:** Reserve a slot synchronously before capturing raw inputs. If none is available, reject raw-set calls immediately with `ReadCapacityError`; retain FIFO queuing only for by-id store reads whose input is not a mutable caller graph. Add memory and mutation tests for simultaneous raw-set calls.

## 2. Valid completed partial runs may fail their own read-back validation

- **Severity:** High
- **Location or section:** [§8.3](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:567), [§13.6](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:960)
- **Problem:** Completed runs may legitimately contain nonfatal `failed:*` unit outcomes and reasons, but `validateResultSet` requires `status: completed ⇒ no failed/invalidated reason`.
- **Why it matters:** The engine can persist a valid partial Result Set that it later rejects as corrupt.
- **Concrete failure scenario:** One unit ends `failed:capacity-exceeded`; remaining units finish, so the run seals `completed`, `coverage: partial`, with reason `unit:failed:capacity-exceeded`. A later `getResultSet` rejects it under the written invariant.
- **Recommended specification change:** Define the invariant in terms of fatal run-level causes:
  - `completed` forbids fatal U1–U3 and input-change U4–U5 causes;
  - nonfatal U6–U8 unit gaps are permitted;
  - `invalidated` is forbidden as the terminal status/reason, not as an arbitrary substring.

  Add save–evict–read tests for every nonfatal completed-gap outcome.

## 3. OQ-19 simultaneously permits and blocks unqualified claims

- **Severity:** High
- **Location or section:** [§8.3](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:573), [OQ-19](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1524), [prerequisites table](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1530)
- **Problem:** §8.3 and OQ-19 adopt an interim “yes” for unqualified claims using bracketed proof. The prerequisites table instead says claim presentation is gated on a recorded OQ-19 decision and that fail-closed behavior applies until then.
- **Why it matters:** The engine and Panel can implement opposite claim policies while each follows normative text.
- **Concrete failure scenario:** The engine returns `canClaimNoClashes: true` under §8.3, while the Panel suppresses it because no OQ-19 decision artifact exists—or the Panel displays it even though release governance expected the gate.
- **Recommended specification change:** Choose exactly one policy:
  - mark the round-2 interim as the recorded product decision and remove OQ-19 from the prerequisite gate; or
  - keep OQ-19 unresolved and require `unqualified: false` until an acceptance record is present.

  Add an acceptance case for the pre-decision state.

## 4. The store-side byte guard is both mandatory and optional

- **Severity:** High
- **Location or section:** [§13.5 ResultStore port](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:869), [§13.6 capture boundary](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:958)
- **Problem:** `ResultStore.get(runId, {maxBytes})` “MUST” reject without materializing an oversized value, but §13.6 permits stores that cannot honor this and falls back to capture ceilings.
- **Why it matters:** A backend can materialize hundreds of megabytes before the engine’s guard runs, defeating the stated memory boundary and potentially terminating the browser tab.
- **Concrete failure scenario:** A store materializes a 700 MiB object graph, then returns it for engine capture. The configured 256 MiB guard never had an opportunity to protect the process.
- **Recommended specification change:** Either make pre-materialization byte enforcement a required store capability and reject nonconforming stores at construction, or explicitly remove it from the hard memory guarantee and define a smaller transport-level limit. Add a conformance test proving no oversized object graph is constructed.

## 5. Two RunOption defaults remain unspecified

- **Severity:** Medium
- **Location or section:** [§17.1](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1194), [§18](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1369)
- **Problem:** §18 says every RunOption has a default in §17.1, but the table does not specify defaults for `broadPhase` or `interUnitYield`.
- **Why it matters:** These choices affect behavior, performance, provenance, and compatibility testing.
- **Concrete failure scenario:** One implementation defaults to `tlas` plus animation-frame yielding; another uses `linear` plus macrotasks. Large runs then either succeed or hit the linear candidate ceiling with identical caller input.
- **Recommended specification change:** Add explicit defaults, presumably `broadPhase: 'tlas'` and `interUnitYield: 'animation-frame'`, and cover omitted-option behavior in AC-1/AC-3.

# Questions / Clarifications

1. What should `retainResultSet(runId)` do for a `held` set? The contract only defines retention for `saved` sets: reject, return a no-op lease, or create a real lease.
2. Should `getRun(runId)` return a handle for a terminal but still-resident run? §13.5.2 describes active and resident run-scoped state, while §18 says “active/queued runs only.”
3. Is implementation authorization intended for the core engine only? The Viewer adapter remains explicitly blocked on OQ-4 evidence.

# Positive Observations

- The three-cell decomposition correctly accounts for subtree-recursive extraction and same-model fragment self-exclusion.
- Coverage, integrity, freshness, and environmental sensitivity are kept separate, preventing most empty-result false negatives.
- Identity enforcement, test tombstones, atomic store behavior, and persistence settlement are specified with strong concurrency semantics.
- The acceptance suite is extensive and directly targets exact cover, diagnostic overflow, lifecycle races, memory bounds, and model drift.

# Overall Readiness

**Requires major revision**

The whole-model source scope gap can permit a false clean claim. The raw-input capture/read-slot contradiction and invalid read-back invariant also prevent a single conforming implementation without redesign.
