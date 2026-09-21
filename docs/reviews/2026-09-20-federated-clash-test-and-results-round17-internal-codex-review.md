# Federated Clash Test & Results round 17 internal Codex review (raw output)

- **Reviewed draft:** [`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`](../superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md)
- **Draft SHA-256 at review time:** `33797467e04f25275a71b60798afcd4c01a041add4c8d678cf7ec5b290509bd4` (uncommitted round 17 remediation on HEAD `62aa070`)
- **Reviewer:** internal `codex-review spec` (medium effort), request `20260920-211547-73518-24910` — the *internal* reviewer of the CLAUDE.md review loop, **not** the independent acceptance gate
- **Prior:** [`2026-09-20-federated-clash-test-and-results-round16-internal-codex-review.md`](2026-09-20-federated-clash-test-and-results-round16-internal-codex-review.md)
- **Review date:** 2026-09-20
- **Status:** raw reviewer output, preserved verbatim below. Dispositions are in spec §25 "Round 18".

---

Do not authorize full implementation yet; resolve the annotation lifecycle, persistence timeout, and memory-ceiling gaps first.

# Executive Summary

The specification is exceptionally thorough and generally matches the current collision library’s extraction, lifecycle, diagnostics, and capacity behavior. No false-clean or pair-coverage defect was found in the primary three-cell execution design.

However, three unresolved contracts can produce unbounded resource retention, permanently occupied capacity, or browser-tab failure. A fourth contradiction will cause non-equivalent persisted results across engine configurations. The Viewer adapter also remains intentionally blocked on live feasibility evidence.

No files were modified.

# Critical Issues

None identified.

# Important Improvements

## 1. Annotation work is not cancellation- or concurrency-bounded

- **Severity:** High
- **Location or section:** [§14.5, annotation lifecycle](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1002), especially line 1009; §13.5.2 memory bound
- **Problem:** `annotate` uses a last-request-wins publication token, but superseded calls continue executing. It has no `AbortSignal`, no annotation-job concurrency cap, and `ElementAttributeSource.getAttributes` has no cancellation contract. The immediate synchronous `Map` capture is also outside the slicing exceptions defined in §17.3.
- **Why it matters:** Publication safety does not provide execution or memory safety. Old property requests can retain bindings and large maps after eviction or disposal. Repeated calls can exceed the claimed resident-memory bound.
- **Concrete failure scenario:** A Panel issues ten annotation requests while the user changes grouping rapidly. Each source fetch allocates data approaching the 8 MiB annotation cap. Nine calls are superseded but continue fetching and copying, temporarily retaining roughly 80 MiB plus Viewer/property data. `dispose()` cannot stop them, and a large resolved map can block the main thread during its synchronous capture.
- **Recommended specification change:** Add an annotation-job contract:
  - `getAttributes(..., {signal})` and `annotate(..., {signal})`;
  - abort the previous per-run job when superseded;
  - abort on release, discard, eviction, and disposal;
  - cap concurrent and queued annotation jobs;
  - include in-flight annotation memory in the hard bound;
  - either slice capture from exclusively owned plain data or define and calibrate it as another synchronous exception.

## 2. Ambiguous-write reconciliation refers to an undefined timeout

- **Severity:** High
- **Location or section:** [§13.5, “Ambiguous remote outcomes”](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:879); §13.5.1
- **Problem:** Reconciliation says “the attempt’s own timeout” turns an ambiguous result into `failed`, but no attempt or reconciliation timeout exists. `persistTimeoutMs` is explicitly only a waiting window for `done` and must not settle persistence.
- **Why it matters:** Implementations will disagree about whether to reuse `persistTimeoutMs`, invent another timeout, or remain pending forever. Reusing it would contradict the one-shot persistence contract; waiting forever can permanently occupy a resident slot.
- **Concrete failure scenario:** `put` returns `PersistenceOutcomeUnknownError`, then `get(runId)` never settles. One implementation marks the attempt failed after five seconds, while another leaves it pending indefinitely. `persisted`, `discardRun`, and slot availability then behave differently.
- **Recommended specification change:** Choose one explicit behavior:
  - introduce a separately validated `reconcileTimeoutMs`, define its abort and settlement rules, and test it; or
  - state that reconciliation may remain pending forever, remove the timeout branch, and explicitly accept permanent slot occupation until disposal.

## 3. Result-set capture ceilings are not safe or frozen enough for implementation

- **Severity:** High
- **Location or section:** [§13.6, “Capture first”](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:954); §17.1 memory-calibration gate
- **Problem:** External Result Sets may be synchronously and atomically copied up to a provisional 64,000,000-node ceiling, potentially requiring roughly twice the source graph’s memory. The product memory budget and final ceilings are deferred to implementation-plan measurement.
- **Why it matters:** “Check before allocating each node” still permits tens of millions of prior allocations. The browser may stall or terminate the tab before the engine can return `ResultSetTooLargeError`. The data-format ceiling also cannot remain provisional once persisted schema version 1 is emitted.
- **Concrete failure scenario:** A conforming store returns a near-ceiling Result Set. The main thread traverses tens of millions of nodes without yielding while holding both source and copy. Memory pressure kills the tab, so validation and the typed failure never complete.
- **Recommended specification change:** Before implementation:
  - establish a product-approved peak-memory and maximum synchronous-stall budget;
  - run the AC-12 calibration;
  - freeze materially lower schema-v1 ceilings;
  - specify the exact `ResultSetTooLargeError` predicate;
  - consider a serialized byte ceiling at the store boundary so oversized values can be rejected before object-graph expansion.

## 4. An engine limit does alter persisted Result Set content

- **Severity:** Medium
- **Location or section:** [§12.2 diagnostic `unitIds`](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:724), [§12.4 deduplication](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:756), [§17.1.1 option ownership](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1224)
- **Problem:** `maxUnitIdsPerDiagnostic` controls the persisted `NormalizedDiagnostic.unitIds` array, but §17.1.1 classifies it as an engine limit that “does not shape a stored set’s content” and is not recorded.
- **Why it matters:** Engines with different limits produce different Result Sets from the same run inputs without provenance explaining the difference. This also makes the option-ownership rule non-exhaustive as written.
- **Concrete failure scenario:** One engine uses `8`, another `64`. An identical diagnostic occurring in twenty units produces different durable diagnostic records, although neither Result Set records the effective limit.
- **Recommended specification change:** Move `maxUnitIdsPerDiagnostic` into `RunOptions` and record it in provenance, or make the retained unit-id cap a fixed schema-v1 constant rather than configurable.

## 5. Viewer-adapter implementation remains explicitly blocked

- **Severity:** High
- **Location or section:** [OQ-4](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1496), [named prerequisites](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1517); current extraction implementations at [ViewerModelAdapter.js](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/collision/viewer/ViewerModelAdapter.js:62) and [ViewerModelAdapter.js](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/collision/viewer/ViewerModelAdapter.js:192)
- **Problem:** The design depends on a new source-side enumeration and owner reconciliation that has not been verified in a live Viewer. The document correctly labels this as blocking adapter implementation planning, but full implementation readiness therefore has not been reached.
- **Why it matters:** Failure of tree-owner and `fragList.getDbIds` agreement changes the supported-content envelope or requires a collision-core exact-owner API—an architectural fork, not a local implementation adjustment.
- **Concrete failure scenario:** The live fixture reports owner mismatches. The planned adapter then fails closed for common models, making federated tests unusable unless product accepts narrowed support or authorizes a core API change.
- **Recommended specification change:** Keep the current fail-closed design, but require the OQ-4 research artifact and product disposition before approving the integrated implementation plan. If core work may proceed separately, explicitly divide readiness into “core engine ready” and “Viewer adapter blocked.”

# Questions / Clarifications

1. Should ambiguous reconciliation have a dedicated timeout, or is indefinite `pending` intentional?
2. Must superseded annotation calls be actively cancelled, or may external property work continue after the result becomes unpublishable?
3. What product-approved peak-memory and synchronous-stall budgets will freeze the schema-v1 ceilings?
4. Is implementation authorization intended for the core only, or for the complete core-plus-Viewer-adapter milestone?

# Positive Observations

- The three-cell decomposition correctly accounts for subtree-recursive extraction and same-model self-exclusion.
- Completeness handling is conservatively designed: gaps, unattributable diagnostics, mixed owners, and hierarchy exclusions cannot become clean negatives.
- Terminal precedence and pair-level comparison semantics are unusually explicit and testable.
- Store identity claims, tombstones, immutable embedded definitions, and structured-clone-safe results substantially reduce persistence and backward-compatibility risk.
- Acceptance criteria cover most difficult behaviors with differential tests against the real `CollisionWorld`.

# Overall Readiness

**Requires major revision**

The core coverage design is strong, but the undefined persistence timeout and unbounded annotation lifecycle require specification changes. Full implementation also remains blocked by the acknowledged Viewer-adapter evidence gate and unfrozen memory ceilings.
