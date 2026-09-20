# Federated Clash Test & Results round 20 internal Codex review (raw output)

- **Reviewed draft:** [`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`](../superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md)
- **Draft SHA-256 at review time:** `681736930900e41ab78e69794384b9866472765fc0b54422be07ea3c1feee457` (uncommitted round 20 remediation on HEAD `62aa070`)
- **Reviewer:** internal `codex-review spec` (medium effort), request `20260920-213243-89190-2834` — the *internal* reviewer of the CLAUDE.md review loop, **not** the independent acceptance gate
- **Prior:** [`2026-09-20-federated-clash-test-and-results-round19-internal-codex-review.md`](2026-09-20-federated-clash-test-and-results-round19-internal-codex-review.md)
- **Review date:** 2026-09-20
- **Status:** raw reviewer output, preserved verbatim below. Dispositions are in spec §25 "Round 21".

---

Revise the API and memory contracts before implementation planning; the geometric planner itself appears sound, but several boundary contracts cannot currently be implemented consistently.

# Executive Summary

The three-cell decomposition, subtree handling, scope-drift protection, and fail-safe completeness model align well with the current collision implementation. I found no new false-clean path in the core planner.

The specification is not implementation-ready because:

- `rerun(ResultSet)` simultaneously returns a synchronous `RunHandle` and reports validation failures through a rejected Promise.
- Permitted writer ceilings can produce Result Sets that the specified reader must refuse.
- The claimed memory bound omits potentially dominant derivation allocations.
- Stored-result validation does not prove that each result came from its claimed evaluated Work Unit.
- Disposal contradicts the guarantee that held unsaved sets are never destroyed by the engine.

No files were modified.

# Critical Issues

None identified in the collision-pair coverage algorithm.

# Important Improvements

## 1. `rerun(ResultSet)` has an impossible error-delivery contract

- **Severity:** High
- **Location or section:** §13.5.2 admission, §13.6 “Capture first,” §18 contract sketch — [specification:960](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:960), [specification:1340](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1340)
- **Problem:** §13.6 says capture, migration, validation, size, and read-capacity failures for a caller-supplied Result Set are delivered as rejected Promises. The public contract declares `rerun(...) → RunHandle`, not `Promise<RunHandle>`. Admission is also described as synchronous but occurs only after sliced validation succeeds.
- **Why it matters:** An implementation must invent an undocumented behavior: throw synchronously, return a failed handle, or return a Promise contrary to the signature.
- **Concrete failure scenario:** A caller invokes `engine.rerun(corruptResultSet)`. Capture detects an accessor or the read slot is unavailable. There is no returned Promise to reject and no defined `RunHandle` terminal representation for this boundary error.
- **Recommended specification change:** Choose one contract:
  - Prefer `rerun(...) → Promise<RunHandle>` for raw and by-id inputs, with read-slot reservation before capture and run-slot admission after validation; or
  - Keep `RunHandle` synchronous and explicitly map all later validation failures to a terminal failed run.
  
  Specify slot release on rejection and add acceptance cases for corrupt input, `ReadCapacityError`, capacity refusal, and caller mutation immediately after invocation.

## 2. Valid writer limits can create unreadable Result Sets

- **Severity:** High
- **Location or section:** §13.6 capture ceilings, §17.1 defaults, §17.1.1 hard ceilings — [specification:960](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:960), [specification:1228](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1228), [specification:1250](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1250)
- **Problem:** A run may legally use up to 20,000,000 ledger records, but external capture allows only 16,000,000 total nodes. Separately, a writer can produce content exceeding the default 256 MiB store-read limit. The node ceiling is called an overridable default but is absent from both the RunOption and engine-limit schemas.
- **Why it matters:** The engine can successfully produce and persist a conforming Result Set that it later cannot read, rerun, or check for freshness.
- **Concrete failure scenario:** A legal run retains over 16 million object-valued ledger records under `maxLedgerRecords: 20_000_000`. Persistence succeeds. After eviction, `getResultSet` rejects during node capture—or earlier at the 256 MiB store guard—even when the same engine configuration reads it.
- **Recommended specification change:** Establish and test a producer/reader invariant: every Result Set legal to produce under schema v1 must be legal to capture and read under schema-v1 ceilings. Define the node ceiling as either:
  - A fixed format ceiling, with all producer hard maxima derived below it; or
  - An operational engine limit producing `ResultSetTooLargeError`, with a separate fixed schema ceiling.
  
  Add maximum-shape produce → persist → evict → read → rerun tests, including ledger-heavy and result-heavy shapes.

## 3. The hard memory estimate omits derivation inputs, indexes, and outputs

- **Severity:** High
- **Location or section:** §13.6 raw capture, §14.4 derivation bounds, §17.1 memory calibration — [specification:960](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:960), [specification:999](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:999), [specification:1234](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1234)
- **Problem:** The memory formula covers resident sets, diagnostics, and annotations, but not detached raw-set copies, ledger indexes, group memberships, or comparison results. `compareResultSets` may capture two near-ceiling sets, and two such calls may run concurrently per context.
- **Why it matters:** Derivation memory can exceed resident memory by multiples while the implementation still claims to satisfy the hard bound.
- **Concrete failure scenario:** Two concurrent comparisons each capture two large Result Sets, build coverage indexes, and allocate up to two million comparison records. This creates four detached set copies plus indexes and outputs, none represented in the stated worst-case formula.
- **Recommended specification change:** Require derivation-slot acquisition before any raw-set capture, then extend the calibrated memory formula to include worst-case input clones, indexes, and output records per concurrent derivation. Calibrate and cross-constrain `maxConcurrentDerivations`, `maxComparisonEntries`, and `maxGroupMemberships`. Add a peak-memory test with two simultaneous maximum-shape comparisons.

## 4. Stored-result validation does not link results to their producing units

- **Severity:** High
- **Location or section:** §11.1 `ClashResult`, §13.6 `validateResultSet` — [specification:652](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:652), [specification:962](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:962)
- **Problem:** A result stores `unitId` and `evaluatedAs`, but read validation only establishes global owner membership, identity, ordering, and digest consistency. It does not require that:
  - `unitId` names an evaluated leaf with `scopeProof: equal`;
  - that unit covers the result’s root pair;
  - `evaluatedAs` matches the unit orientation; or
  - result mode/evidence agrees with the embedded definition.
- **Why it matters:** A structurally valid but internally contradictory set can pass validation and then produce incorrect pair status, caveat, grouping, or comparison results.
- **Concrete failure scenario:** A migration or faulty store changes a result’s `unitId` to a gap unit and recomputes the content hashes. The owners remain globally present, so validation accepts the set even though the claimed producing unit never evaluated that pair.
- **Recommended specification change:** Add these result-to-ledger invariants to `validateResultSet`. Include negative read-back tests for nonexistent, split-parent, gap, unrelated, and wrongly oriented units, plus mode/evidence mismatches.

## 5. Disposal contradicts the unsaved-state retention guarantee

- **Severity:** Medium
- **Location or section:** §13.5.2 resident classes and disposal — [specification:919](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:919), [specification:928](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:928), [specification:946](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:946)
- **Problem:** Held sets are described as “never” auto-evictable, and `discardRun` is called the only operation that intentionally destroys unsaved state. `engine.dispose()` nevertheless releases all held sets and merely lists them in `droppedUnsaved`.
- **Why it matters:** Implementers can reasonably make disposal preserve, reject because of, or destroy unsaved sets. Only one matches the acceptance text.
- **Concrete failure scenario:** A no-store engine contains the only copy of four completed Result Sets. Calling `dispose()` either loses all four or cannot finish, depending on which normative sentence the implementation follows.
- **Recommended specification change:** Declare disposal as an explicit destructive exception and revise the absolute “never” and “only operation” statements. Alternatively, require an acknowledgement option or return the dropped Result Sets themselves, not only their IDs. Add an acceptance case proving the chosen ownership transfer.

# Questions / Clarifications

1. Is implementation authorization currently core-only? OQ-4 explicitly blocks Viewer-adapter implementation planning until live owner-mapping evidence exists.
2. What product-approved browser memory budget should AC-12 enforce? The spec states that none currently exists, so its core defaults cannot yet be frozen.
3. For unordered modes, should swapping `selectionA` and `selectionB` preserve `semanticDigest`? The current definition treats every selection change as a new question; that may be intentional because the rank-6 residue depends on definition-derived orientation, but it should have an explicit golden-vector decision.

# Positive Observations

- The three-cell decomposition correctly accounts for subtree-recursive extraction and same-model fragment self-exclusion.
- Whole-model source and target population drift are now bracketed consistently.
- Coverage, integrity, freshness, and environmental sensitivity are separated cleanly and fail closed.
- Atomic identity claims, tombstones, and ambiguous-write reconciliation are unusually well specified.
- The acceptance matrix covers the major geometry, lifecycle, diagnostic, and concurrency risks.

# Overall Readiness

**Requires major revision**

The planner is strong, but the public `rerun` contract, writable/readable size relationship, and derivation memory accounting require normative fixes before a single conforming implementation can be planned.
