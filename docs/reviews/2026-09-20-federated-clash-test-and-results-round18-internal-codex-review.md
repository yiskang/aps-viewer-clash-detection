# Federated Clash Test & Results round 18 internal Codex review (raw output)

- **Reviewed draft:** [`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`](../superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md)
- **Draft SHA-256 at review time:** `aaecc3eb2a0746b9d9c050689a5e89416dba02fa4641172f75f00a07d30037e1` (uncommitted round 18 remediation on HEAD `62aa070`)
- **Reviewer:** internal `codex-review spec` (medium effort), request `20260920-212147-79302-5443` — the *internal* reviewer of the CLAUDE.md review loop, **not** the independent acceptance gate
- **Prior:** [`2026-09-20-federated-clash-test-and-results-round17-internal-codex-review.md`](2026-09-20-federated-clash-test-and-results-round17-internal-codex-review.md)
- **Review date:** 2026-09-20
- **Status:** raw reviewer output, preserved verbatim below. Dispositions are in spec §25 "Round 19".

---

# Executive Summary

Revise the three high-risk contract gaps below before implementation planning.

The core planning model is unusually rigorous and aligns with the current collision library. I verified that `collision/` has not changed since the spec’s stated baseline commit, so its architectural assumptions remain applicable.

No new exact-cover or false-clean defect was found in the three-cell planner itself. The remaining risks are concentrated at API boundaries, claim evaluation, and persistence disposal.

# Critical Issues

None identified.

# Important Improvements

## 1. External Result Sets do not have an exhaustive capture-and-validation boundary

- **Severity:** High
- **Location or section:** [§13.6 Capture first](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:956), [§16.4 Freshness](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1124), [§18 engine contract](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1333)
- **Problem:** The capture-first rule explicitly covers store reads and caller-supplied sets passed to `rerun`, but the public contract also accepts raw Result Sets in `getFreshness`, `canClaimNoClashes`, and `assessNoClashClaim`. Their capture, validation, size-limit, and error-timing behavior is not normatively defined.
- **Why it matters:** These methods perform asynchronous, sliced work. Without an atomic detached copy, caller mutation can create the same TOCTOU problem the spec already fixed for definitions and reruns.
- **Concrete failure scenario:** A caller invokes `engine.assessNoClashClaim(set)`, then changes `ledger.hierarchyInternal`, `results`, or `provenance.scopeDigests` while freshness is yielding. Validation can observe one version while the final claim uses another, potentially approving a false negative.
- **Recommended specification change:** State that every raw Result Set passed to any engine-bound API is synchronously captured, migrated, validated, and frozen once before asynchronous work. Define applicable schema/configured-size limits, whether read slots are consumed, and synchronous versus Promise rejection timing. Add mutation-during-yield tests for all three methods.

## 2. `assessNoClashClaim.allowed` can be implemented without checking that results are empty

- **Severity:** High
- **Location or section:** [§8.3 claim rule](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:571), AC-15 and AC-20
- **Problem:** The formal claim predicate omits `results.length === 0`. Later prose says `canClaimNoClashes` “additionally requires” empty results, but then defines `assessNoClashClaim.allowed` as exactly the earlier predicate.
- **Why it matters:** Two conforming implementations can disagree about whether `allowed` is a general coverage assessment or authorization to state “no clashes found.”
- **Concrete failure scenario:** A completed, full, clean, current run containing five clashes satisfies the written predicate. An implementation following “allowed is exactly the claim rule above” returns `allowed: true`, and a Panel displays a qualified “no clashes found” statement.
- **Recommended specification change:** Add `results.length === 0` directly to the single normative predicate used by both helpers. Specify:
  - `allowed = all claim conditions ∧ results.length === 0`
  - `unqualified = allowed ∧ hierarchyInternal.length === 0`
  
  Add acceptance cases where every other condition passes but results are non-empty; both helpers must deny the claim.

## 3. Ambiguous persistence settlement after `engine.dispose()` is undefined

- **Severity:** High
- **Location or section:** §10.2, [§13.5 ambiguous outcomes](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:867), [§13.5.2 disposal](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:908)
- **Problem:** Disposal allows a pending write to continue detached and releases resident state. An eventual `PersistenceOutcomeUnknownError` requires a reconciliation read through engine read slots, but after disposal every engine method is dead and the resident Result Set has been released. The required internal state ownership is unspecified.
- **Why it matters:** `RunHandle.persisted` has a one-shot settlement guarantee. Implementations may skip reconciliation, retain disposed-engine state indefinitely, or leave the promise pending after the write has already rejected.
- **Concrete failure scenario:** `put` is pending when `dispose()` completes. It later rejects as outcome-unknown. One implementation cannot initiate `get(runId)` because its read coordinator is disposed; another performs the read but no longer has canonical content for comparison.
- **Recommended specification change:** Define a detached `PersistenceAttempt` lifecycle that retains the immutable comparison witness, reconciliation timer, and internal read capability until settlement. Alternatively, specify that disposal settles a later ambiguous rejection as `failed` without reconciliation. Add an acceptance test combining disposal with an after-commit ambiguous write.

## 4. The contract sketch omits accepted method options

- **Severity:** Medium
- **Location or section:** [§14.5 annotation contract](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:999), [§15.4 comparison](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1054), [§18 contract sketch](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1305)
- **Problem:** §14.5 specifies `annotate(runId, names, {signal?})`, but §18 exposes only `annotate(runId, names)`. Likewise, §15.4 permits `distanceTolerance` and `pointTolerance`, while `DerivationContext.compareResultSets` lists only `{signal?}`.
- **Why it matters:** §18 is explicitly the implementation boundary. Implementers may reject supported options or omit cancellation and configurable comparison tolerances.
- **Concrete failure scenario:** The engine implementation follows §18 and cannot actively cancel an annotation job, despite R18-1 and §14.5 requiring it.
- **Recommended specification change:** Make §18 signatures exhaustive:
  - `annotate(runId, names, {signal?} = {})`
  - `compareResultSets(base, next, {signal?, distanceTolerance?, pointTolerance?} = {})`
  
  Add unknown-option and supported-option cases to AC-13/AC-14.

## 5. The default persistence policy is not stated

- **Severity:** Medium
- **Location or section:** §5.5, §13.5.1, [§17.1 defaults](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1188), [§18 RunOptions](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1366)
- **Problem:** `persist` is optional, and §18 says every RunOption has a default in §17.1, but §17.1 gives no default for it. `persist !== false` suggests a default of `true`, but that is only an inference.
- **Why it matters:** The choice changes store calls, tombstone checks, persistence observables, resident-set classification, and when capacity becomes exhausted.
- **Concrete failure scenario:** One implementation defaults to persistence when a store exists; another defaults to `persist: false`. Identical callers then receive `saved` versus `skipped`, and deleted-test admission behaves differently.
- **Recommended specification change:** Define the effective default explicitly, including behavior when no `ResultStore` exists. Add acceptance cases for omitted `persist` with and without a configured store.

# Questions / Clarifications

1. **Implementation scope:** Is authorization intended for the core engine only, or core plus Viewer adapter? OQ-4 explicitly blocks Viewer-adapter planning until live owner-mapping evidence exists.

2. **Memory gate:** What product-approved peak-memory and synchronous-stall budgets will freeze the provisional schema ceilings? A 16-million-node atomic capture and 256 MiB stored result allowance should not become implementation defaults before AC-12 calibration.

3. **Claim presentation:** Must OQ-19 be resolved before any unqualified claim UI ships? The current interim deliberately permits an unqualified negative based on bracketed—not continuous—scope equality.

# Positive Observations

- The three-cell decomposition addresses the library’s subtree-recursive extraction and same-model self-exclusion rather than assuming dbId-set disjointness.
- Coverage, integrity, freshness, and environmental sensitivity are kept separate, preventing most empty-result false negatives.
- Durable identity, tombstones, linearizable store operations, and version-conflict handling are specified unusually well.
- Failure precedence, capacity bounds, diagnostics overflow, and acceptance coverage are concrete and highly testable.
- Repository verification found no `collision/` changes since the spec’s recorded baseline, so its cited library behavior remains current.

# Overall Readiness

**Requires major revision**

The planning architecture is credible, but the external Result Set boundary and no-clash predicate can produce correctness or security-sensitive divergence between implementations. The Viewer adapter and production memory ceilings also remain explicitly gated.
