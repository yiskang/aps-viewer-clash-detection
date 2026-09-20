# Federated Clash Test & Results round 13 internal Codex review (raw output)

- **Reviewed draft:** [`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`](../superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md)
- **Draft SHA-256 at review time:** `2be1c382c77f46dff38b08b13eed47e541404a3e172cad141de252dc6505bc98` (uncommitted round 13 remediation on HEAD `62aa070`)
- **Reviewer:** internal `codex-review spec` (medium effort), request `20260920-204924-51205-10583` — the *internal* reviewer of the CLAUDE.md review loop, **not** the independent acceptance gate
- **Prior:** [`2026-09-20-federated-clash-test-and-results-round12-internal-codex-review.md`](2026-09-20-federated-clash-test-and-results-round12-internal-codex-review.md)
- **Review date:** 2026-09-20
- **Status:** raw reviewer output, preserved verbatim below. Dispositions are in spec §25 "Round 14".

---

# Executive Summary

Revise the specification before implementation planning begins.

The design is unusually thorough, but the current draft contains one persistence-breaking contradiction and two unresolved implementation gates.

Findings:

- 1 Critical
- 2 High
- 2 Medium
- No files modified

Repository checks confirmed the documented subtree extraction, whole-model target extraction, owner-level aggregation, fragment self-exclusion, and cumulative epoch-cache behavior. Code has not changed materially since the spec’s stated baseline.

# Critical Issues

## 1. Valid unreachable-owner results become corrupt after persistence

- **Severity:** Critical
- **Location or section:** [§6.2 owner classes](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:326>), [§7.1 outcome validation](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:452>), [§13.6 stored-result validation](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:938>), AC-11 and AC-17
- **Problem:** §6.2 requires a clash against an `unreachable-only` whole-model target owner to be retained with `flags.unreachableOwner` and classified `not-required`. §7.1 expressly permits that owner when it appears in `unreachablePopulation.ownerDbIds`. However, §13.6 requires every stored result to be required and every owner to appear in `rootOwners`. AC-11 repeats that rejection rule, while AC-17 requires exactly such a result to survive.
- **Why it matters:** A Result Set produced legitimately by the engine can pass initial execution and persistence, become auto-evictable, and then fail read-back with `CorruptResultSetError`. This makes durable recovery dependent on whether tree-unreachable geometry happened to produce a positive result.
- **Concrete failure scenario:** Owner `950` exists only in the whole-model target population and clashes with source owner `200`. The engine retains `200↔950` with `unreachableOwner: true`, saves it, and later evicts the resident copy. `getResultSet(runId)` validates the durable copy; owner `950` is absent from `rootOwners` and the pair is outside required space `P`, so the current §13.6 rule rejects the engine’s own output as corrupt.
- **Recommended specification change:** Choose and state one invariant:
  - Preferred: allow a flagged `unreachableOwner` result when the owner appears in `unreachablePopulation.ownerDbIds`, require `getPairStatus = not-required`, and exclude it from required-space coverage claims.
  - Alternative: discard such positives during reconciliation.
  
  Update §13.6, AC-11, and AC-17 together. Add a save → evict → read-through acceptance case for an unreachable-only positive.

# Important Improvements

## 1. Nonresident reads bypass the engine’s memory backpressure

- **Severity:** High
- **Location or section:** [§13.5.2 read-through behavior](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:899>), [§13.6 untrusted reads](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:938>), AC-11 and AC-16
- **Problem:** `maxResidentResultSets` bounds active and resident sets, but `getResultSet` may concurrently read, copy, validate, digest, migrate, and freeze any number of nonresident sets without consuming a slot. It must even read through sets larger than the engine’s configured generation limits.
- **Why it matters:** The claimed hard memory bound covers steady-state retention but not engine-owned transient work. The schema ceilings allow very large sets, and the API provides no read concurrency, byte, or cancellation limit.
- **Concrete failure scenario:** A store contains ten valid Result Sets near the schema ceiling. Ten concurrent `getResultSet` calls each return a cloned set and begin sliced validation. The engine simultaneously retains all ten object graphs plus traversal/digest state despite `maxResidentResultSets: 4`, potentially exhausting the browser tab.
- **Recommended specification change:** Introduce bounded read-operation slots shared by `getResultSet`, `rerun`, and `getFreshness`, with defined queue/rejection behavior and cancellation. Alternatively, impose a reader byte/record ceiling and require a paged or streaming store API for larger sets. Add a concurrent maximum-size read test to AC-16.

## 2. Required Viewer-adapter feasibility evidence is still missing

- **Severity:** High
- **Location or section:** [§24 OQ-4](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1464>), [AC-15](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1423>)
- **Problem:** OQ-4 explicitly prohibits implementation planning of the Viewer adapter until live evidence confirms that instance-tree ownership and `fragList.getDbIds` ownership agree. That evidence is not present, yet the document concludes that no open question blocks the specification.
- **Why it matters:** The Viewer adapter is required for the intended product. If ownership differs on representative content, normal tests fail before executing any collision unit with `owner-mapping-mismatch`.
- **Concrete failure scenario:** Implementation proceeds against mocks. Live Audubon content maps one fragment to different owners through the two Viewer access paths. Every federated test touching that model fails during planning, forcing redesign or a significantly narrower supported-content envelope.
- **Recommended specification change:** Split readiness explicitly:
  1. Core engine implementation planning may begin after the specification defects are resolved.
  2. Viewer-adapter implementation planning is blocked until the OQ-4 research artifact exists.
  
  Define who approves the narrowed supported-content envelope if the live check fails.

## 3. `UnitOutcome` does not define bounds for every executor-controlled field

- **Severity:** Medium
- **Location or section:** [§7.1 boundary validation](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:452>), [§11.2 `UnitOutcome`](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:657>), AC-3
- **Problem:** The spec promises limits on “every executor-controlled field” but only gives explicit limits for pairs, diagnostics, diagnostic reasons, and `failure.message`. It does not bound or fully validate `failure.modelKeys`, generation arrays, `errorName`, `capacityKind`, pair `type`, or other nested strings.
- **Why it matters:** The engine treats custom executors as structurally untrusted. An oversized but otherwise plain result can defeat projection and ledger memory bounds or cause a long validation span.
- **Concrete failure scenario:** A custom executor returns a failed outcome containing one million duplicate `failure.modelKeys` entries. It is below neither the pair nor diagnostic caps, and the specification does not say whether it is rejected, collapsed, or persisted inline.
- **Recommended specification change:** Define a closed schema for all `UnitOutcome` fields:
  - Generation arrays must match the unit’s distinct participants exactly.
  - `failure.modelKeys` must be a distinct subset of participants.
  - Error names, codes, capacity kinds, pair types, and all nested strings need enums or length limits.
  
  Add these malformed cases to AC-3.

## 4. “Not awaiting” does not cancel asynchronous grouping

- **Severity:** Medium
- **Location or section:** [§14.4](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:969>), AC-13
- **Problem:** The specification says `summarize`, `groupBy`, and `filter` are “cancellable only by not awaiting.” Dropping a Promise does not stop its scheduled slices.
- **Why it matters:** A superseded grouping continues consuming CPU and allocating membership records. Repeated UI requests can create concurrent obsolete computations despite the membership cap applying only per operation.
- **Concrete failure scenario:** A user changes grouping facets ten times quickly. The Panel ignores the first nine Promises, but all ten operations continue processing up to `maxGroupMemberships`, causing avoidable frame pressure and memory use.
- **Recommended specification change:** Either state that derivations are non-cancellable, or add an `AbortSignal` checked at slice boundaries with a typed abort outcome. If concurrency remains allowed, add a bound on simultaneous derivations. Update AC-13 to verify cancellation or the explicitly non-cancellable contract.

# Questions / Clarifications

1. Who must resolve the live Viewer ownership gate in OQ-4, and is the research artifact required before the overall implementation plan or only before the adapter work package?
2. Has a product owner accepted the bracketed scope proof for an unqualified negative claim in [OQ-19](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1479>)?
3. Which host component will supply immutable `modelKey`/`modelVersion` values and own every placement invalidation, as required by OQ-1 and OQ-17?
4. What product-confirmed browser memory budget will freeze the provisional count ceilings? Until one exists, the default configuration cannot be considered deployable.

# Positive Observations

- Coverage, integrity, freshness, and environmental sensitivity are separated correctly; an empty pair array is not treated as a clean negative.
- The three-cell decomposition is well aligned with the repository’s recursive subtree extraction and fragment-membership self-exclusion.
- Terminal-state precedence, cancellation retention, persistence settlement, and tombstone races are specified substantially better than typical pre-implementation designs.
- Identity avoids unstable runtime values such as `Model`, `modelId`, epoch, and fragment identity.
- Acceptance criteria cover deterministic planning, diagnostics overflow, store atomicity, lifecycle races, and live Viewer behavior in considerable depth.

# Overall Readiness

**Requires major revision**

The unreachable-owner persistence contradiction must be resolved before implementation. After that, core planning can proceed only with explicit transient-read backpressure; Viewer-adapter planning remains blocked by OQ-4.
