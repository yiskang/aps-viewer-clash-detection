Revise P5 before implementation; three safety contracts and four implementation details remain underspecified or contradictory.

# Executive Summary

The plan has improved substantially, but it is not implementation-ready.

The most serious problems are:

- Unknown-field limits are enforced only after potentially enormous attacker-controlled data has been copied.
- A claimable Result Set with an unknown digest version can still pass the normative no-clash predicate.
- The untrusted-data validator lacks a complete executable structural schema.

No files were modified.

# Critical Issues

## 1. Unknown-field budget is enforced too late to provide the memory guarantee

- **Severity:** Critical
- **Location or section:** [P5.4 unknown-field accounting](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:919), [P5.5 validation rule](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:1184)
- **Problem:** The design specification requires the 64 KiB unknown-field budget to be charged during capture, before corresponding copies are allocated. P5 instead captures the entire graph and calculates the budget afterward.
- **Why it matters:** The node ceiling does not provide a comparable byte bound. Millions of individually legal strings can consume gigabytes before validation rejects the set, defeating the untrusted-read memory boundary.
- **Concrete failure scenario:** An open `ledger.futureData` contains 100,000 strings of 4 KiB each. It remains far below the node ceiling, so capture allocates roughly 400 MB before `unknown-field-bytes` rejects it.
- **Recommended specification change:** Extend P0 `captureData` with a path-aware cumulative byte-budget hook, or define a P5 capture traversal capable of recognizing open-type unknown fields and rejecting before allocation. Add an allocation-sensitive test using many individually legal values whose cumulative size exceeds 64 KiB.

## 2. Unknown digest versions remain eligible for a no-clash claim

- **Severity:** Critical
- **Location or section:** [Claim predicate](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:658), [unknown-digest test](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:1265)
- **Problem:** The plan says an unknown `digestVersion` is never current-claimable, but `assessNoClashClaim` has no digest-version conjunct. The test uses the `positives` fixture, whose non-empty results already block the claim, so it does not exercise this requirement.
- **Why it matters:** An unknown digest algorithm means the engine cannot verify the pair set or ledger under its understood semantics. Allowing a no-clash claim is a false-clean risk.
- **Concrete failure scenario:** Take an otherwise claimable completed-clean set, change `digestVersion` to `99`, replace both digest strings, and pass `'current'`. Validation accepts it and the shown predicate returns `allowed: true`.
- **Recommended specification change:** Choose one explicit owner for the rule:
  - add `digests.digestVersion === DIGEST_VERSION` to the claim predicate, or
  - require P6 freshness to return `unverifiable` for an unknown digest version.

  Test an empty-results, otherwise-claimable set—not the positive-results fixture—through both standalone and engine-bound claim paths.

## 3. Structural validation is not specified completely enough for untrusted input

- **Severity:** Critical
- **Location or section:** [Validation rule table](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:1181), [validator pseudocode](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:1336)
- **Problem:** The executable plan delegates `checkShapeAndUnknownFields` to an unwritten helper. The table mainly covers unknown fields and semantic relationships; it does not enumerate required fields, primitive types, enums, numeric ranges, per-field string caps, duplicate identifiers, digest syntax, `sealed === true`, or most nested-array constraints.
- **Why it matters:** Different implementers will accept different stored formats. Malformed values can reach digest, status, and claim code that assumes valid arrays and objects, causing exceptions or incorrect decisions.
- **Concrete failure scenario:** A captured set supplies `sealed:false`, `outcome.status:42`, a negative `dbId`, duplicate `provenance.models` entries, or `ledger.units:null`. None has a defined validation rule or issue code in this plan; downstream code may accept it or throw while traversing it.
- **Recommended specification change:** Add a closed structural-schema table covering every durable type and field: presence, nullability, type, enum, bounds, uniqueness, field-specific string cap, and issue code. Add table-driven negative tests for every schema row before running cross-field checks.

# Important Improvements

## 1. Invalid schema version `0` is admitted when a migration is registered

- **Severity:** High
- **Location or section:** [schema-version classification](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:923), [migration test](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:974), [root gate](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:1125)
- **Problem:** The classification table says every version below `1` is invalid, but the gate admits any value for which `migrations.has(v)` is true. The prescribed test explicitly registers and accepts version `0`.
- **Why it matters:** Migration registration unexpectedly widens the set of valid source schemas and contradicts the persisted-version contract.
- **Concrete failure scenario:** A configuration mistake registers migration key `0`; malformed version-zero data is treated as a historical supported schema.
- **Recommended specification change:** Gate migrations with `Number.isInteger(v) && v >= 1 && v < SCHEMA_VERSION && migrations.has(v)`. When `SCHEMA_VERSION === 1`, test `applyMigration` directly with a synthetic historical version, or temporarily inject a higher current version into a pure dispatcher test.

## 2. The status reader remains quadratic at realistic limits

- **Severity:** High
- **Location or section:** [status indexes](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:1585), [pair unit lookup](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:1672), [element lookup](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:1731)
- **Problem:** `createStatusReader` claims to build indexes once, but every `pairStatus` and `elementStatus` call scans every leaf unit. `sideOf` additionally scans target arrays.
- **Why it matters:** P8 can query status for approximately 100,000 results. With a large unit plan this becomes `O(results × units)`, despite the stated purpose of the reader abstraction.
- **Concrete failure scenario:** 100,000 pairs over 10,000 leaf units require up to one billion unit checks before taint processing.
- **Recommended specification change:** Require the reader build to index source-root/target-root coverage to its unique leaf unit and index units by participating model/root. Add an operation-count acceptance test demonstrating approximately `O(units + results)` construction and `O(1)` or bounded lookup.

## 3. The in-memory store’s listing summary violates copy-on-write

- **Severity:** High
- **Location or section:** [store copy guarantee](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:1781), [summary construction](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:1918)
- **Problem:** The canonical stored set is detached, but the summary retains the caller’s `testRef` and `digests` objects by reference.
- **Why it matters:** A mutable input can change future listing results after `put`, while `get` continues returning the original canonical content. The two store views then disagree.
- **Concrete failure scenario:** After `put(set)`, the caller changes `set.testRef.testId` or `set.digests.ledgerDigest`. `list()` reports the mutation, while `get()` returns the originally stored values.
- **Recommended specification change:** Build the summary from the parsed canonical copy or explicitly deep-copy every nested summary field before publication. Extend the copy test to mutate `testRef`, `digests`, model rows, and timestamps, then verify both `get` and `list`.

## 4. Residency lease safety is left inside unspecified “thin wrappers”

- **Severity:** High
- **Location or section:** [residency implementation placeholder](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:2204), [retain/release test](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:2086)
- **Problem:** The plan does not state whether a lease’s `release()` is one-shot/idempotent, even though eviction safety depends on an exact outstanding-lease count.
- **Why it matters:** A double release can under-count live leases and make a still-retained Result Set evictable.
- **Concrete failure scenario:** Two clients retain the same saved set. Client A invokes its release function twice. A naive counter reaches zero while client B still holds a live lease; the next admission evicts the set.
- **Recommended specification change:** Specify that each lease token decrements exactly once and subsequent calls are no-ops. Add tests for double release, two independent leases, eviction between releases, and release after the resident entry has been explicitly removed.

# Questions / Clarifications

1. Is `validateResultSet` itself intended to be safe on raw untrusted objects, or is only `captureResultSet`/`readResultSet` an untrusted-input boundary? Its current “pure untrusted-read contract” wording conflicts with direct property traversal.

2. Should digest-version unverifiability be represented by read-time freshness, the claim predicate, or both? One component must own it normatively.

3. Must the store conformance suite test real concurrent `put`/`tombstoneTest` races? The current P5 tests are sequential despite the port requiring linearizability across concurrent calls.

# Positive Observations

- Capture-before-migration and explicit avoidance of native `structuredClone` correctly address getter invocation and TOCTOU risks.
- Whole-unit result-cap rejection avoids partially represented unit coverage.
- The persisted root-class marker closes the bounded-`hierarchyInternal.examples` correctness gap.
- Persistence outcome is correctly kept outside the immutable Result Set.
- The writer/reader round-trip harness covers all five terminal shapes and is a strong integration boundary.

# Overall Readiness

**Requires major revision**

The design direction is sound, but the unknown-field memory boundary, digest-version claim rule, and structural validator must be resolved before implementation can safely begin.