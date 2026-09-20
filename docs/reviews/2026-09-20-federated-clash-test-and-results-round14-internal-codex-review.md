# Federated Clash Test & Results round 14 internal Codex review (raw output)

- **Reviewed draft:** [`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`](../superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md)
- **Draft SHA-256 at review time:** `a403b078c4a8614c339f59106d7064f20a8657441cdec1ef3f26d522e67129ea` (uncommitted round 14 remediation on HEAD `62aa070`)
- **Reviewer:** internal `codex-review spec` (medium effort), request `20260920-205504-56220-8570` — the *internal* reviewer of the CLAUDE.md review loop, **not** the independent acceptance gate
- **Prior:** [`2026-09-20-federated-clash-test-and-results-round13-internal-codex-review.md`](2026-09-20-federated-clash-test-and-results-round13-internal-codex-review.md)
- **Review date:** 2026-09-20
- **Status:** raw reviewer output, preserved verbatim below. Dispositions are in spec §25 "Round 15".

---

# Executive Summary

Revise the persisted-data boundary and read-time freshness protocol before implementation planning.

The execution model is unusually thorough and aligns well with the current collision library. However, two correctness gaps can still produce trusted output from unstable input:

- Stored Result Sets can change while sliced validation is yielding.
- `getFreshness()` can observe different models/scopes at different times yet return `current`, enabling a false “no clashes found” claim.

Three additional contract gaps affect performance, API consistency, and store interoperability. These are specification issues, not merely implementation details.

# Critical Issues

## 1. Sliced Result Set validation has a mutation/TOCTOU hole

**Severity:** Critical

**Location or section:** [§13.3–13.6](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:847), especially [the untrusted-read contract](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:940)

**Problem:** Definitions receive an explicit detached capture before asynchronous work, but Result Sets do not. `validateResultSet` operates in slices over an object declared untrusted, and deep-freezing happens only afterward. The store’s “copy on read” requirement does not explicitly transfer exclusive ownership or prohibit mutation after resolution. Caller-supplied Result Sets passed to `rerun` have the same problem. Lower-version objects may also reach a migration before a bounded, stable snapshot is established.

**Why it matters:** Validation, digest recomputation, migration, and freezing may inspect different versions of the object. Passing validation therefore does not prove that the frozen object is the object that was validated.

**Concrete failure scenario:** A store resolves `get(runId)` with an object, then mutates `ledger`, `outcome.coverage`, or `results` during a scheduler yield. The engine validates the original field, validates the digest later, then freezes a third state. Depending on timing, the result can be incorrectly accepted, crash during traversal, or become claimable despite inconsistent coverage.

**Recommended specification change:** Define one stable boundary before migration or sliced validation:

1. Require exclusive ownership transfer of a detached Result Set snapshot, with no retained writable references; or
2. Capture from a bounded serialized representation before the first `await`; or
3. Perform an atomic structured clone before validation and explicitly exempt that clone from the slice target.

Apply a cheap structural/size/depth preflight before invoking migrations. Add tests that mutate store-returned and caller-supplied Result Sets at every validation yield.

## 2. Read-time freshness is not a coherent snapshot

**Severity:** Critical

**Location or section:** [§16.4 Freshness](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1100), [claim helper contract](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1324)

**Problem:** `getFreshness` sequentially re-digests multiple scopes and then checks registry state. It does not atomically snapshot bindings at both ends or bracket the complete multi-scope operation. Streaming fragment changes do not increment `registryRevision`.

**Why it matters:** `engine.canClaimNoClashes()` relies on this result. It can return `true` even though an already-checked model changed before freshness finished.

**Concrete failure scenario:** The method digests model X successfully, then begins model Y. While Y is being checked, X gains a fragment without a host notification. X is not checked again, all generations remain equal, and freshness returns `current`. An empty sealed Result Set is then presented as “no clashes found” although its live scope no longer matches.

**Recommended specification change:** Define freshness as a bracketed operation:

1. Call `snapshotBindings(modelKeys)` before reading any scope.
2. Digest all recorded scopes.
3. Snapshot bindings again and reject any registry revision or binding/generation change.
4. Re-digest all scopes, or otherwise require an authoritative model-content revision witness.
5. Return `current` only when both brackets agree.

Document the same A→B→A residual already accepted for execution. Add mutation tests between models, between roots, and between the final digest and registry check.

# Important Improvements

## 1. Result comparison is unbounded and contradicts the main-thread discipline

**Severity:** High

**Location or section:** [§15.4 Comparison](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1030), [§17.3](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1241), [contract sketch](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1323)

**Problem:** §15.4 specifies synchronous `compareResultSets(...) → Comparison`, while Result Sets may contain up to one million results. The comparison materializes several output arrays and may repeatedly derive pair status. The contract sketch is ambiguous about whether comparison is Promise-returning.

**Why it matters:** This can create a long main-thread task and allocate output proportional to both input sets, bypassing the controls recently added to grouping and filtering.

**Concrete failure scenario:** Comparing two one-million-result sets produces close to two million classification records. The browser freezes during the merge or exhausts memory while building the output arrays.

**Recommended specification change:** Make comparison explicitly asynchronous, sliced, abortable, and concurrency-bounded. Add either:

- `maxComparisonEntries` with an all-or-nothing error;
- paginated output; or
- an async iterator/streaming result.

Require an O(n+m) merge over canonical order and prohibit per-pair linear ledger scans.

## 2. Configuration ownership is contradictory and incomplete

**Severity:** High

**Location or section:** [§17.1.1](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1200), [engine constructor](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1276), [RunOptions](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1329)

**Problem:** The validation table lists options such as `maxConcurrentStoreReads`, `maxConcurrentDerivations`, `maxGroupMemberships`, and `maxFilterClauses`, but the constructor’s `limits` shape omits them and `RunOptions` does not own them. The prose also says all engine-level limits are recorded in provenance, although several do not affect a run’s semantics.

**Why it matters:** An implementation cannot determine where documented options are supplied, whether they are accepted or rejected as unknown, or which values belong in `ledgerDigest`.

**Concrete failure scenario:** A host supplies `limits.maxConcurrentDerivations`, following §17.1.1. An implementation following §18 rejects it as an unknown key; another accepts it, creating incompatible public APIs.

**Recommended specification change:** Add one exhaustive ownership table with columns:

- option name;
- constructor limit or RunOption;
- default;
- validation ceiling;
- recorded in provenance;
- included in `ledgerDigest`;
- mutable per run or fixed per engine.

Make the constructor and `RunOptions` schemas match it exactly.

## 3. Store listing data lacks a complete untrusted-read contract

**Severity:** High

**Location or section:** [ResultStore listing contract](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:857), [definition-store summaries](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:269)

**Problem:** `ResultSetSummary` is described only informally, and `ClashTestStore.list` summaries have only a partial shape. Neither listing path is covered by the detached capture, validation, copying, freezing, string limits, or corrupt-data behavior defined for full records.

**Why it matters:** List output is normally the first persisted data rendered by a Panel. An untrusted backend can return malformed counts, oversized strings, accessors, duplicate keys, or inconsistent model versions without a specified engine response.

**Concrete failure scenario:** A remote store returns a summary with a megabyte-scale `modelKey` or an accessor-backed `outcome`. The Panel consumes it even though loading the corresponding full Result Set would be rejected as corrupt.

**Recommended specification change:** Define closed schemas for both summary types, including all length/count bounds. Require detached validation on every page and specify whether one corrupt entry rejects the page or is returned as a typed per-entry error. Complete the engine API as `listTests(options) → Promise<Page<TestSummary>>` and an equivalent results-list method.

## 4. Spatial facet arithmetic can produce non-finite or aliased GroupIds

**Severity:** Medium

**Location or section:** [§14.2–14.3](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:950)

**Problem:** `locationCell(size)` and `distanceBucket(width)` validate that the divisor is finite and positive, but finite operands can still produce `Infinity` or integers outside the safe range. Canonical durable data otherwise forbids non-finite numbers.

**Why it matters:** `JSON.stringify` serializes `Infinity` as `null`, which can alias a genuine `null` facet value and break stable group identity.

**Concrete failure scenario:** A finite coordinate near `Number.MAX_VALUE` divided by a very small positive cell size produces `Infinity`. Its `GroupId` encodes the value as `null`, colliding with the “no location” group.

**Recommended specification change:** Require every derived bucket index to be a safe integer. Define overflow behavior explicitly—prefer a typed `FacetRangeError` or a dedicated closed overflow value—and add extreme finite-number acceptance tests.

## 5. Persistence abort-versus-commit semantics are unspecified

**Severity:** Medium

**Location or section:** [ResultStore.put](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:859), [discard and dispose behavior](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:899)

**Problem:** `put` accepts an `AbortSignal`, but the contract does not define what happens when abort races the transaction’s linearization point.

**Why it matters:** Persistence state must agree with durable state. A backend could commit, observe abort, and reject; the engine would report `failed` and retain the set as unsaved even though a durable copy exists.

**Concrete failure scenario:** `discardRun` aborts a pending write. The backend commits immediately before observing the abort and rejects afterward. The engine records failure and then behaves differently depending on whether its subsequent delete races the committed record.

**Recommended specification change:** State that:

- rejection guarantees no insert or identity/tombstone mutation occurred; and
- once insertion linearizes, `put` must resolve successfully even if abort is observed later.

Add tests for abort before transaction start, during work, immediately before commit, and after commit.

# Questions / Clarifications

1. **Viewer adapter gate:** OQ-4 explicitly blocks adapter implementation planning. Who owns producing and approving the required live evidence artifact, and must core-engine planning wait for it?

2. **Bracketed claim approval:** OQ-19 remains a product decision, while the interim permits a qualified claim. Should `canClaimNoClashes` return `true` before product approval, or should it remain fail-closed as the hierarchy-internal case does?

3. **Missing-store behavior:** What must `saveTest`, `getTest`, `listTests`, `archiveTest`, and `deleteTest` do when `testStore` is absent, or when `deleteTest` has only one of `testStore` and `resultStore` configured?

# Positive Observations

- The subtree-root planning model correctly reflects the current adapter’s recursive extraction behavior in [ViewerModelAdapter.js](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/collision/viewer/ViewerModelAdapter.js:62).
- The spec accurately preserves the current whole-model target behavior and its not-loaded/owner-unresolvable diagnostics, implemented in [ViewerModelAdapter.js](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/collision/viewer/ViewerModelAdapter.js:192).
- Coverage, integrity, freshness, and pair-level taint are separated rigorously; this substantially reduces false-clean outcomes.
- The persistence-state, result-cap, ledger-cap, and terminal-precedence sections have strong, testable failure semantics.
- Acceptance criteria cover the difficult exact-cover, lifecycle, identity, and diagnostic-overflow paths rather than relying only on happy-path examples.

# Overall Readiness

**Requires major revision**

The core execution design is close, but implementation should not start until the untrusted Result Set boundary and coherent read-time freshness protocol are specified. Those two gaps directly affect whether persisted data and “no clashes found” claims can be trusted.
