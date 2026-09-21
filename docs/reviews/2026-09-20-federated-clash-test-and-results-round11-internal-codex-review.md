# Federated Clash Test & Results round 11 internal Codex review (raw output)

- **Reviewed draft:** [`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`](../superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md)
- **Draft SHA-256 at review time:** `b975f22a23b24b3439e9c10ccf28d649d729af2ad62d00647a4a8a08cbe8232a` (uncommitted round 11 remediation on HEAD `62aa070`)
- **Reviewer:** internal `codex-review spec` (medium effort), request `20260920-203425-37567-21881` — the *internal* reviewer of the CLAUDE.md review loop, **not** the independent acceptance gate
- **Prior:** [`2026-09-20-federated-clash-test-and-results-round10-internal-codex-review.md`](2026-09-20-federated-clash-test-and-results-round10-internal-codex-review.md)
- **Review date:** 2026-09-20
- **Status:** raw reviewer output, preserved verbatim below. Dispositions are in spec §25 "Round 12".

---

# Executive Summary

Revise the specification before implementation planning.

The design is unusually thorough, but one completeness hole can still produce a false “no clashes found” result. Four additional issues leave implementers without a feasible or deterministic contract for validation, persisted-data handling, annotation lifecycle, and pagination.

Repository inspection confirmed the most serious issue: explicit-source extraction walks only the instance tree and emits none of the whole-target diagnostics for omitted fragments.

No files were modified.

# Critical Issues

## 1. Whole-model and explicit source scopes can still yield false clean negatives

- **Severity:** Critical
- **Location or section:** §1.1 F15/F17; §6.2; §6.2.1; §8.3; AC-17–AC-19. [Specification §6.2](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:290), [ViewerModelAdapter.js](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/collision/viewer/ViewerModelAdapter.js:62)
- **Problem:** `unreachablePopulation` covers only fragments that are loaded, owner-resolvable, and absent from the tree. It does not cover:
  - Tree-unreachable fragments classified as `fragment-not-loaded` or `fragment-owner-unresolvable`.
  - Partially under-enumerated explicit subtrees that still return at least one fragment.

  Scope digests only prove that the same incomplete enumeration was seen before and after a call. They do not prove completeness.
- **Why it matters:** The claim rule checks `unreachablePopulation`, diagnostics, and unit coverage. A stable but incomplete source enumeration can satisfy every check and allow `canClaimNoClashes` to return `true`.
- **Concrete failure scenario:** Model A is selected as a whole-model source. Its instance tree returns ordinary root `100`, but silently omits fragment `42`; the fragment-list population reports `42` as not loaded or owner-unresolvable. Model B is the target. Source extraction only walks root `100` and emits no diagnostic. Because fragment `42` is not loaded and owner-resolvable, it is absent from `unreachablePopulation`. All planned units evaluate cleanly, producing `completed/full/clean/current`, and “no clashes found” becomes claimable despite incomplete Model A coverage.
- **Recommended specification change:** Add a claim-blocking population reconciliation for every whole-model operand, independent of execution orientation. Record all population entries that cannot be assigned to exactly one source root, including `N` and `U` digest classes. For explicit scopes, require a reliable tree-readiness witness or classify the scope as unverifiable/claim-blocking. Add acceptance cases where these omissions occur on:
  - The source side.
  - Both orientations.
  - A partially enumerated explicit subtree.
  - A same-model self-test.

# Important Improvements

## 2. The validation and capture contract is not implementable as written

- **Severity:** High
- **Location or section:** §5.3 V1 and “Capture at the boundary”; §17.3. [Specification §5.3](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:230)
- **Problem:** JavaScript cannot reliably detect and reject every `Proxy`; a proxy can emulate a plain prototype and data-property descriptors. The simultaneous requirements to detect proxies, read every property exactly once, reject accessors, and create a detached copy therefore lack an implementable algorithm. Additionally, entry and element caps do not bound the number of unknown own properties, although V1 requires scanning them at every nesting level.
- **Why it matters:** Different implementations will make incompatible choices about property access, side effects, mutation races, and error classification. The claimed synchronous memory/time bound is also false for an object containing millions of unknown properties.
- **Concrete failure scenario:** A proxy reports `Object.prototype` and synthesized data descriptors. One implementation accepts its captured values; another attempts proxy detection and rejects it. Separately, an otherwise small definition carries a million unknown enumerable keys. Validation must enumerate them to enforce V1, causing a long synchronous stall despite both documented size ceilings being satisfied.
- **Recommended specification change:** Define one concrete capture algorithm and its trust boundary. Either:
  1. Accept values according to a specified reflection/copy algorithm and remove the promise to detect proxies, or
  2. Require inputs to have passed a structured-clone boundary and document accessor behavior.

  Also bound or explicitly disclaim own-property cardinality, add tests for sparse arrays, extra array properties, throwing traps/accessors, and extremely high unknown-key counts, and revise the O(entries + elements) claim accordingly.

## 3. Persisted Result Sets lack a complete untrusted-read contract

- **Severity:** High
- **Location or section:** §13.3–§13.6; `ResultStore.get`; pure derivations in §18. [Specification §13.3](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:834), [Specification §13.6](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:912)
- **Problem:** The spec says persisted types are migrated and revalidated, but it does not define a `ResultSet` validator, invariant checks, digest verification, size checks, or failure behavior for corrupt store output. Open-schema fields must be preserved verbatim without any stated plain-data or size limit.
- **Why it matters:** Stored data is a durable trust boundary. `getFreshness`, comparison, grouping, and `canClaimNoClashes` rely on the ledger and outcome being internally consistent. Blind deep-freezing does not establish validity and can itself traverse an oversized or cyclic value.
- **Concrete failure scenario:** A backend returns an empty Result Set marked `completed/full/clean` with a forged or inconsistent ledger. Live freshness checks pass, and the claim helper approves it. Alternatively, a same-version optional field contains a huge graph or non-cloneable value; preserving and freezing it violates the serialization and memory contracts.
- **Recommended specification change:** Specify `validateResultSet` with:
  - Schema migration and structural limits.
  - Cross-field invariants.
  - Canonical-order checks.
  - Recomputed digest comparison.
  - Plain-data/cycle enforcement.
  - Defined typed failures for corrupt or unsupported stored data.

  Unknown optional fields should either be discarded by older readers or constrained by a bounded JSON-safe extension envelope.

## 4. Annotation work can race result eviction, release, discard, and disposal

- **Severity:** Medium
- **Location or section:** §13.5.2; §14.5; §18 `annotate`. [Specification §14.5](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:957)
- **Problem:** Last-request-wins is defined for concurrent annotation calls, but annotation’s relationship to resident-set lifecycle operations is not. No transient retain lease or cancellation rule protects the set while `getAttributes` is awaiting.
- **Why it matters:** Implementations may resurrect released state, attach a snapshot to a different residency epoch, leak memory, or return inconsistent success after disposal.
- **Concrete failure scenario:** `annotate(runId)` starts on a saved, evictable set. A new run evicts that set while property retrieval is pending. When retrieval resolves, one implementation reintroduces an annotation entry for a nonresident run; another rejects; a third returns a snapshot but stores nothing.
- **Recommended specification change:** Make annotation acquire an internal retain lease for its duration. Define outcomes when `releaseResultSet`, `discardRun`, eviction, model reload, or `dispose()` occurs. At completion, verify the original resident token and binding/model generations before atomically publishing the snapshot.

## 5. Store pagination is not deterministic under concurrent writes

- **Severity:** Medium
- **Location or section:** §5.5 `ClashTestStore.list`; §13.5 `ResultStore.list`. [ResultStore port](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:843)
- **Problem:** The port specifies `limit` and `cursor` but not ordering, cursor contents, bounds, or consistency when inserts/deletes occur between pages.
- **Why it matters:** Reference and production stores can produce different listings, and callers may skip or duplicate results.
- **Concrete failure scenario:** A result is inserted between page-one and page-two requests. An offset-based backend duplicates an entry, while a keyset backend does not. Both currently conform.
- **Recommended specification change:** Define a total order with a unique tie-breaker, bounded `limit`, opaque versioned cursors, and keyset/snapshot semantics under concurrent mutation. Apply the same rules to test listings and result listings.

# Questions / Clarifications

1. Is the `ResultStore` considered trusted after `put`, or must all values returned by an external backend be treated as untrusted? The current text implies the latter but does not finish that contract.
2. Does a hierarchy acceptance record authorize the literal claim “no clashes found” despite known omitted owner pairs, or only a qualified product-specific statement? An arbitrary opaque string currently enables the stronger claim.
3. OQ-4 explicitly blocks Viewer-adapter implementation planning pending live evidence. Should that evidence be completed and incorporated before approving the broader implementation plan?
4. What is the required behavior if `ElementAttributeSource` returns partial values, unknown dbIds, duplicate names, a non-`Map`, or rejects after processing some models?

# Positive Observations

- The three-cell decomposition directly addresses the repository’s subtree extraction and fragment-membership self-exclusion behavior.
- Terminal-state precedence is unusually explicit and testable, including cancellation, disposal, drift, and fatal failures.
- Persistence identity is carefully protected through atomic model-version claims, permanent test tombstones, and create-only run IDs.
- Resident result sets, diagnostic detail, planning records, and executor projections all have explicit fail-closed bounds instead of silent truncation.
- Pair-level comparison correctly distinguishes verified additions/resolutions from changes involving gaps or caveats.

# Overall Readiness

**Requires major revision**

The source-completeness hole must be closed before implementation because it can authorize an incorrect clean-negative claim. The validation and persisted-read contracts also need implementable algorithms before separate implementations can conform consistently.
