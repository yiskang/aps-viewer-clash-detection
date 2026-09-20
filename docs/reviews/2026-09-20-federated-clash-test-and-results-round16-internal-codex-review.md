# Federated Clash Test & Results round 16 internal Codex review (raw output)

- **Reviewed draft:** [`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`](../superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md)
- **Draft SHA-256 at review time:** `a4f2db94abec4efd3b295d27f3aa11bca23891f47ef17571d5eb2b7b8745d2d2` (uncommitted round 16 remediation on HEAD `62aa070`)
- **Reviewer:** internal `codex-review spec` (medium effort), request `20260920-211118-69383-30495` — the *internal* reviewer of the CLAUDE.md review loop, **not** the independent acceptance gate
- **Prior:** [`2026-09-20-federated-clash-test-and-results-round15-internal-codex-review.md`](2026-09-20-federated-clash-test-and-results-round15-internal-codex-review.md)
- **Review date:** 2026-09-20
- **Status:** raw reviewer output, preserved verbatim below. Dispositions are in spec §25 "Round 17".

---

# Executive Summary

Revise §16.4’s freshness protocol before implementation planning; it can return `current` after a model changes during the second digest pass.

The specification is unusually comprehensive and closely grounded in the current collision library. However, one correctness defect can authorize a stale “no clashes” claim. Four additional contract gaps would likely cause divergent implementations, inconsistent persistence state, or unbounded main-thread work.

No files were modified.

# Critical Issues

## 1. Read-time freshness is not actually bracketed around the whole operation

- **Severity:** Critical
- **Location or section:** [§16.4 Freshness, line 1118](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1118>), AC-8
- **Problem:** The protocol is `snapshot₁ → digest pass₁ → snapshot₂ → digest pass₂ → return`. There is no registry snapshot after pass₂. Consequently, binding, version, or placement changes occurring during the second pass can escape detection. Placement is particularly vulnerable because scope digests intentionally exclude transforms.
- **Why it matters:** `engine.canClaimNoClashes` inherits this result. A false `current` result can satisfy the final condition permitting an unqualified “no clashes found” claim.
- **Concrete failure scenario:** Models X and Y pass the first digest pass. `snapshot₂` records both as current. During pass₂, X is digested first. The host then calls `notifyPlacementChanged(X)` while Y is being digested. Both scope digests still equal the sealed values because placement is not included. The operation returns `current`, despite X having moved before the result was returned.
- **Recommended specification change:** Require a final atomic `snapshotBindings` after pass₂ and compare every touched binding with both earlier snapshots. The protocol should be `snapshot₁ → digest₁ → snapshot₂ → digest₂ → snapshot₃`. Add AC-8 cases for unload, reload, version conflict, and placement change after a model’s second-pass digest but before the operation returns.

# Important Improvements

## 2. Ambiguous-write reconciliation contradicts one-shot persistence semantics

- **Severity:** High
- **Location or section:** [§13.5 ambiguous outcomes, line 877](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:877>), [§13.5.1, line 888](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:888>), AC-11
- **Problem:** A rejected `put` is defined as final `failed`, but an unknown-outcome rejection triggers reconciliation that may “flip” it to `saved`. Meanwhile, `done` and `persisted` settle once and all three observables are required to agree.
- **Why it matters:** Implementers must choose whether the attempt settles at the `put` rejection or after reconciliation. Either interpretation violates part of the current text.
- **Concrete failure scenario:** The backend commits, then rejects with `PersistenceOutcomeUnknownError`. `done` and `persisted` resolve `failed`. The automatic `get` then finds identical content and changes `getPersistenceState` to `saved`. The three promised-consistent observables now disagree permanently.
- **Recommended specification change:** Define reconciliation as part of the same persistence attempt. Keep the attempt `pending` until the one reconciliation read completes; only then settle it as `saved` or `failed`. Specify timeout behavior during reconciliation and update AC-11 to assert that `done`, `persisted`, state, and events never expose an intermediate final `failed`.

## 3. External Result Set capture permits a massive uninterruptible main-thread stall

- **Severity:** High
- **Location or section:** [§13.6 capture-first boundary, line 952](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:952>), [AC-12, line 1446](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1446>)
- **Problem:** A caller- or store-supplied Result Set may contain up to 64,000,000 nodes, all traversed and copied in one synchronous, uninterruptible operation. The later validation is sliced, but the potentially dominant work is not. AC-12 only explicitly calibrates synchronous definition capture, not schema-ceiling Result Set capture.
- **Why it matters:** A formally valid stored set can freeze the Viewer for seconds or exhaust memory while both the original and detached copy coexist. Read-slot limits restrict concurrency, not per-read latency or peak allocation.
- **Concrete failure scenario:** `getResultSet` receives a valid near-ceiling ledger. Before its first promise-visible yield, the engine walks and duplicates tens of millions of objects. Cancellation cannot be observed, frame deadlines are missed, and transient memory approaches twice the stored graph.
- **Recommended specification change:** Establish a separately calibrated hard byte/node ceiling for external capture and make it an acceptance gate. Prefer a boundary that transfers exclusive immutable ownership or accepts bounded serialized bytes, allowing validation/copying to be sliced. If atomic synchronous capture remains, explicitly cap and measure its worst-case duration and peak bytes in AC-12 before freezing the schema ceiling.

## 4. Standalone derivations cannot enforce engine-owned limits

- **Severity:** High
- **Location or section:** [§14.4, line 991](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:991>), [§17.1.1, line 1220](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1220>), [§18 contract, lines 1344–1347](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1344>)
- **Problem:** `maxConcurrentDerivations`, membership limits, slice limits, and comparison limits belong to an engine instance. Yet `summarize`, `groupBy`, `filter`, and `compareResultSets` are exported only as standalone pure functions whose signatures accept neither an engine nor a derivation context.
- **Why it matters:** The configured limits cannot affect the documented API. Implementations may use module-global semaphores, silently ignore constructor limits, or create independent limits per function.
- **Concrete failure scenario:** Two engines are created with derivation limits of 1 and 8. Both call the same standalone `groupBy`. Nothing in the API identifies which limit or scheduler applies, so the AC-13 “third derivation rejects” result is not well-defined.
- **Recommended specification change:** Choose one contract:
  1. expose engine-bound derivation methods using that engine’s scheduler and limits; or
  2. introduce `createDerivationContext({limits, scheduler})` and require standalone calls to receive it.

  Define whether concurrency is per engine/context or process-wide, and update AC-13 accordingly.

## 5. The qualified-claim method is required but absent from the engine contract

- **Severity:** Medium
- **Location or section:** [§8.3, line 567](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:567>), [§18 engine methods, line 1328](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1328>)
- **Problem:** §8.3 promises both `engine.canClaimNoClashes(runId)` and `engine.assessNoClashClaim(runId)`. The normative contract sketch exposes only the boolean engine method; `assessNoClashClaim` appears only as a standalone helper.
- **Why it matters:** The standalone helper requires already-verified freshness, while the engine-bound method is supposed to recompute it. The only safe path for presenting a qualified hierarchy-internal claim is therefore missing from the public API.
- **Concrete failure scenario:** A Panel needs the qualifier and calls the standalone helper with the sealed `outcome.freshness`, accidentally bypassing live freshness recomputation. Alternatively, implementers omit the engine method because the contract sketch is treated as authoritative.
- **Recommended specification change:** Add `engine.assessNoClashClaim(runIdOrResultSet) → Promise<ClaimAssessment>` beside `canClaimNoClashes`, with the same read-through, validation, and freshness semantics. Add an acceptance case showing it becomes disallowed after post-seal placement or scope drift.

# Questions / Clarifications

1. **Filter syntax:** [§14.4](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:985>) permits numeric ordering on “`locationCell` components,” but the clause schema has no component selector. Is the intended facet `locationCell.x/y/z`, or are array values ordered lexicographically?

2. **Attribute-source ownership:** [§14.5](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:998>) returns a mutable `Map`, while annotation processing can yield between slices. Must the source transfer exclusive ownership, or may it mutate the map after resolution? The specification should establish a stable snapshot boundary.

3. **Implementation-planning gate:** OQ-4 explicitly blocks Viewer-adapter planning, and OQ-1/OQ-17 block integration acceptance. The readiness verdict below assumes these named prerequisites remain enforced and are not treated as optional follow-up documentation.

# Positive Observations

- The specification correctly derives batch semantics from the repository’s actual subtree extraction and fragment-membership self-exclusion behavior.
- Coverage, integrity, and freshness are separated cleanly; gaps and diagnostic caveats cannot silently become negative results.
- Pair identity, model-version identity, tombstones, and atomic store constraints are substantially more precise than typical pre-implementation designs.
- Capacity splitting, ledger overflow, result caps, and resident-set backpressure are fail-closed and have concrete acceptance coverage.
- The explicit documentation of inherited limitations—tree under-enumeration, renderer readiness, cumulative epoch cache state, and bracketed scope proof—is strong.

# Overall Readiness

**Requires major revision**

The freshness race must be fixed before implementation because it affects the central safety claim. The persistence-settlement and derivation-context contracts should also be resolved before implementation tasks are decomposed; otherwise separate implementers can produce incompatible but textually defensible behavior.
