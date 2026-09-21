# Federated Clash Test & Results round 12 internal Codex review (raw output)

- **Reviewed draft:** [`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`](../superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md)
- **Draft SHA-256 at review time:** `a769a7e621e4bd057daf436b1fc3e08c8d5204204a7aaef9b7ba903db896d9ff` (uncommitted round 12 remediation on HEAD `62aa070`)
- **Reviewer:** internal `codex-review spec` (medium effort), request `20260920-204249-45015-26623` — the *internal* reviewer of the CLAUDE.md review loop, **not** the independent acceptance gate
- **Prior:** [`2026-09-20-federated-clash-test-and-results-round11-internal-codex-review.md`](2026-09-20-federated-clash-test-and-results-round11-internal-codex-review.md)
- **Review date:** 2026-09-20
- **Status:** raw reviewer output, preserved verbatim below. Dispositions are in spec §25 "Round 13".

---

# Executive Summary

Revise the specification before implementation planning begins.

The design is strong on identity, partial-result semantics, deterministic planning, diagnostics, and bounded retention. However, one correctness issue can still permit a false clean result, and several lifecycle/API contracts are internally inconsistent.

I found:

- 1 Critical correctness issue
- 4 High implementation risks
- 3 Medium specification gaps
- No repository files were modified

# Critical Issues

## 1. Bracketed digests cannot support an unqualified “no clashes” claim

- **Severity:** Critical
- **Location or section:** [§5.2, §8.3, §16.3.2–5, AC-8](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:228>)
- **Problem:** The specification acknowledges that an A→B→A population change during `findClashes` is undetectable, but still records `scopeProof: 'equal'` and permits `canClaimNoClashes` to return true. “Equal” therefore means equal only at the two observation points, not equal to what the collision call actually evaluated.
- **Why it matters:** This can produce a clean, current, full result with an empty pair set even though the collision call operated on a transiently different scope. The result model exposes no caveat for this condition.
- **Concrete failure scenario:** Pre-digest observes population A. During the library’s yielded extraction, streaming changes it to B and a required fragment is omitted or replaced. Before the post-digest, the population returns to A. Both digests match, no diagnostic is required, and the run can claim “no clashes found.”
- **Recommended specification change:** Either require a per-call population identity/generation from collision core before permitting an unqualified negative claim, or classify bracket-only equality as an explicit caveat that makes `canClaimNoClashes` false. Rename `scopeProof: 'equal'` to `bracket-equal` so implementations and consumers cannot interpret it as continuous equality.

# Important Improvements

## 1. `dispose()` contradicts the terminal-event and `done` contract

- **Severity:** High
- **Location or section:** [§9.2.4, §10.2, §13.5.1–2](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:585>)
- **Problem:** The terminal state event and `done` occur only after persistence settles or `persistTimeoutMs` expires. Meanwhile, `dispose()` resolves after runs seal, explicitly does not wait for persistence, and releases listeners and resident sets.
- **Why it matters:** With a pending write, the engine can be disposed before the mandatory terminal event. Implementations must choose between retaining listeners after disposal, suppressing a required event, or delaying disposal contrary to the current contract.
- **Concrete failure scenario:** A run seals while `ResultStore.put` hangs. `dispose()` releases listeners immediately. Five seconds later `done` reaches its timeout point, but no subscribed listener remains to receive the exactly-once terminal event.
- **Recommended specification change:** Make `dispose()` wait for each run’s `done` window—bounded by `persistTimeoutMs`, not by the write itself—before releasing listeners and resident state. Alternatively, define disposal as forced finalization with an immediate `{state:'pending', timedOut:true}` snapshot and explicitly settle `done` and emit the terminal event during disposal.

## 2. Grouping is specified as both synchronous and cooperatively sliced

- **Severity:** High
- **Location or section:** [§14, §17.3, §18](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:937>)
- **Problem:** `groupBy`, `filter`, and `summarize` appear as synchronous standalone functions, while §17.3 requires aggregation and sorting to yield in deadline-aware slices. Nested multi-valued grouping also has no facet-count or output-size bound.
- **Why it matters:** A synchronous implementation cannot yield. Additionally, nested `element`/`attrEither` facets can multiply membership paths exponentially even though the input Result Set is bounded.
- **Concrete failure scenario:** Grouping 100,000 results through several multi-valued facets creates millions of membership records and blocks the main thread well beyond the stated slice target.
- **Recommended specification change:** Define these functions as `Promise`-returning or iterator/streaming APIs. Add maximum facet and filter-clause counts, reject duplicate/redundant facets where appropriate, and impose a derived-membership/output bound with a typed overflow result. Add a cap-sized acceptance test.

## 3. Nested schema migration cannot be implemented from the documented shapes

- **Severity:** High
- **Location or section:** [§13.1 and §13.6](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:789>)
- **Problem:** §13.6 says every persisted type has a `schemaVersion` and migrations are registered per `(type, fromVersion)`, but the documented `Ledger`, `Provenance`, `RunOutcome`, diagnostics, and `ClashResult` shapes have no individual version field.
- **Why it matters:** A reader cannot determine which nested migration to run. Different implementations may version the entire Result Set atomically or invent nested versions, producing incompatible stored data.
- **Concrete failure scenario:** Ledger v2 introduces a required interpretation change while ResultSet remains v1. An old reader sees only the top-level version and treats the new ledger field as an optional open field, silently applying v1 semantics.
- **Recommended specification change:** Choose one model explicitly: either one aggregate `ResultSet.schemaVersion` governing every nested structure, or mandatory `schemaVersion` fields on each independently migrated nested type. Align migration registration, validation, digest rules, and acceptance tests with that choice.

## 4. `ClashTestStore.get` does not expose the archive state required by run admission

- **Severity:** High
- **Location or section:** [§5.5 and §18](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:255>)
- **Problem:** Stored-reference runs must atomically observe both the selected definition revision and its archived flag, but `get(testId, revision?)` is described as returning only a `ClashTestDefinition|null`. Archive state is not part of that schema.
- **Why it matters:** Conforming stores have no defined way to communicate that an otherwise valid definition is archived.
- **Concrete failure scenario:** One store returns the definition and hides archive metadata internally; another adds `archived` to the definition and then fails closed-schema validation; a third treats archived records as missing. Each produces a different planning cause.
- **Recommended specification change:** Define a store envelope such as `{definition, archived, latestRevision}` returned from one linearizable read, or add a dedicated `resolveForRun` operation with explicit `live | archived | deleted | missing` outcomes.

## 5. Valid persisted results can become “corrupt” under a smaller engine configuration

- **Severity:** Medium
- **Location or section:** [§13.6 untrusted-read contract](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:921>)
- **Problem:** `validateResultSet` compares stored array and record sizes with the reading engine’s configured ceilings rather than stable schema safety ceilings.
- **Why it matters:** Operational run limits are not data-validity rules. Calibration changes, host configurations, or different engines sharing a store can make a previously conforming Result Set unreadable and incorrectly label it corrupt.
- **Concrete failure scenario:** Engine A stores 80,000 results under `maxResultsPerRun: 100000`. Engine B uses `maxResultsPerRun: 10000`; reading the valid set throws `CorruptResultSetError`.
- **Recommended specification change:** Separate immutable schema/read-safety ceilings from per-engine run-generation limits. Report a distinct `ResultSetTooLargeError` when a valid set exceeds a reader’s operational capacity, or support bounded/streamed reads.

## 6. The “atomic” multi-model binding snapshot lacks an API contract

- **Severity:** Medium
- **Location or section:** [§4.3, §5.2, §16.3](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:166>)
- **Problem:** The specification requires bindings and generations for every referenced model to be captured atomically, but `ModelRegistry` exposes only individual `bindingFor(modelKey)` calls.
- **Why it matters:** The implementation plan must infer whether “atomic” means one synchronous event-loop turn, a registry lock, or a versioned snapshot. A later refactor that adds an await between reads could create a mixed-generation run snapshot.
- **Concrete failure scenario:** Model A is captured, a reload callback mutates shared registry state, then model B is captured. The run’s nominal snapshot never existed as one registry state.
- **Recommended specification change:** Add `snapshotBindings(modelKeys)` with all-or-nothing synchronous semantics and a registry revision, or explicitly require that the complete read occurs without yielding and that registry mutations are serialized through the same coordinator.

## 7. Required Viewer feasibility evidence is still absent

- **Severity:** High
- **Location or section:** [§24 OQ-4](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1448>) and [ViewerModelAdapter.js](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/collision/viewer/ViewerModelAdapter.js:62>)
- **Problem:** The design depends on reconciling two genuinely different extraction mechanisms—instance-tree subtree traversal and `fragList.getDbIds` whole-population ownership—but the required live ownership/readiness evidence has not been collected. OQ-4 explicitly blocks adapter implementation planning while the section conclusion says none of the open questions blocks the specification.
- **Why it matters:** The core planner may be implementable, but the Viewer adapter could reject common production models with `owner-mapping-mismatch`, making the feature unusable.
- **Concrete failure scenario:** Real Viewer content assigns a fragment differently through tree discovery and `getDbIds`. Every test touching that model fails before executing a unit.
- **Recommended specification change:** Make the readiness distinction explicit: core implementation planning may proceed, but Viewer-adapter implementation is gated on the OQ-4 research artifact. Add a pass/fail supported-content criterion and identify who approves a narrowed content envelope.

## 8. Attribute-size enforcement is not deterministic

- **Severity:** Medium
- **Location or section:** [§14.5 and §17.1](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:968>)
- **Problem:** `maxAnnotationBytes` is defined using “estimated serialized size,” but the encoding, key overhead, Unicode measurement, and truncation accounting are unspecified.
- **Why it matters:** Two conforming implementations can accept different snapshots, undermining predictable memory bounds and conformance tests.
- **Concrete failure scenario:** One implementation counts UTF-16 code units while another counts UTF-8 JSON bytes. A Unicode-heavy snapshot stays below 8 MiB in the first and is rejected in the second.
- **Recommended specification change:** Define the exact accounting algorithm, such as UTF-8 byte length of canonical JSON including keys and punctuation, and require incremental accounting before allocation.

# Questions / Clarifications

1. Is the product willing to authorize an unqualified negative claim when only bracketed—not continuous—scope equality is known?
2. Is Result Set versioning intended to be aggregate-only or independently versioned per nested type?
3. Should `dispose()` preserve the ordinary terminal-event contract, or is disposal allowed to terminate subscriptions early?
4. Who owns the three pre-integration gates: durable `modelKey/modelVersion` derivation, all placement invalidations, and the OQ-4 live Viewer evidence?

# Positive Observations

- The specification consistently separates coverage, integrity, freshness, and environmental sensitivity instead of treating an empty pair list as a clean negative.
- The three-cell planning decomposition directly addresses the repository’s subtree extraction and fragment-membership self-exclusion behavior.
- Result identity avoids runtime `Model`, `modelId`, epoch, and fragment identity, and the atomic model-version reservation is well specified.
- Persistence failure is correctly separated from geometric run outcome, with explicit handling for hung writes and unsaved resident sets.
- The acceptance matrix is unusually comprehensive, especially around randomized lifecycle precedence, diagnostic overflow, exact-cover properties, and storage races.

# Overall Readiness

**Requires major revision**

The critical false-clean scope case and the disposal, grouping, schema-versioning, and store-envelope contradictions should be resolved before implementation. The Viewer adapter should remain gated until the live OQ-4 evidence exists.
