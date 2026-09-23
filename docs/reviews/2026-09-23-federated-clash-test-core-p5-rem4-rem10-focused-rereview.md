# Federated Clash Test core P5 REM4–REM10 focused re-review

**Date:** 2026-09-23
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
**Branch:** `feature/federated-clash-test-core-engine`
**Reviewed checkpoint:** `116a811d79598e1ebf84c82ae95eb77e23d9f5e3`
**Implementation comparison base:** `eb48d5cbb20df3da23b97a36e17ca9908510794a`
**Scope:** P5-REM4 through P5-REM10 and their directly affected invariants only. This is the targeted re-review required after remediation; it does not reopen unrelated P5, the frozen core design, or deferred P6 work.

## Verdict

**PASS — 0 Critical / 0 High / 0 Medium / 0 Low findings in the reviewed remediation scope.**

The checkpoint closes the owner-authorized P5 remediation items it claims to close. The read boundary now rejects the identified false-clean shapes, the pair-level verifier proves coverage of the required pair set for legal persisted layouts, its failure path is closed, and its revised memory use remains deterministic and bounded by the already-recorded G-CAL calibration gate.

This review is an independent review claim under `CLAUDE.md`. P5 phase acceptance still requires the prescribed targeted adjudication of this review before any phase transition. P6 remains unauthorized and unstarted.

## Repository boundary

- `HEAD` is `116a811d79598e1ebf84c82ae95eb77e23d9f5e3` (`fix(clashtest): P5-REM4 through REM10 — pair-level exact cover, memory calibration, fixture fixes`).
- The reviewed production/test/spec delta is the committed `eb48d5c..116a811` range.
- Before this review was persisted, the worktree had no production, test, spec, plan, or handoff modification. One pre-existing untracked review file remained: `docs/reviews/2026-09-22-federated-clash-test-core-p4-remediation-focused-rereview.md`.
- No production code, test, plan, or design-spec file was modified by this review.

## Remediation verification

### REM4–REM6: persisted-unit and diagnostic invariants

Verified from live code and regression coverage:

- Unit ranges fail closed when sources or targets are empty, when a roots target omits its root list, or when a whole-model target carries one (`unit-range-invalid`).
- Persisted diagnostic counters are reconciled against reason totals, unclassified occurrences, and retained completeness-affecting occurrences (`diagnostics-counts-inconsistent`).
- Results may link only to evaluated, scope-equal leaf units (`result-unit-not-leaf`), including the zero-result unit-level guard (`evaluated-unit-not-leaf`).
- Explicit unit roots must exist in the same model's `rootOwners` table (`unit-root-not-owned`).
- `kind:'split'` and `outcome:'split'` are reconciled bidirectionally, and split parent/child ids, cardinality, parent links, and weight partition are checked (`unit-kind-outcome-mismatch`, `split-topology-invalid`).

These checks run independently of whether a result row happens to expose the malformed unit. The structural schema still owns duplicate ids and closed-shape errors, so the added cross-field maps do not create a fail-open path.

### REM5–REM7: capture bounds, slicing, and coverage reconciliation

Verified:

- Capture-time array limits are derived from the schema declaration graph. The parity test walks every reachable schema-declared array path and separately pins the delegated definition arrays to the hard format ceilings.
- Long structural, cross-field, linkage, order, and digest loops are generators with per-item steps. The real `readResultSet` path reaches the P0 slicer during validation rather than yielding only between phases.
- Embedded definitions are checked with fixed hard schema ceilings, not reader-specific run limits, so identical persisted bytes have one validity result.
- Definition model membership, persisted root classes, unit roles, and root/partner-class coverage are reconciled before the pair proof. Malformed or out-of-role roots cannot contribute to a full claim.

### REM9: pair-level exact cover and A10

Verified against the implementation, the frozen-spec clarification, legal planner/splitter output, and the independent test oracle:

- Canonical rank is fixed and writer-derived: models in code-unit order; within each model, `A`, `C`, then `B`, each by ascending `rootDbId`.
- An evaluated source list must be one contiguous run of one source class; an explicit target list must be one contiguous target-role run. Arbitrary-subset block layouts are rejected with `coverage-layout-noncontiguous`.
- Legal leaves are projected to source × target rectangles. The sweep computes union area, not summed weights, so duplicates and overlaps cannot hide a missing pair.
- Ordered and unordered required-pair counts match §6.1, with same-root diagonal cells excluded exactly once. Missing coverage is rejected with `coverage-pair-uncovered`.
- The proof runs only for a recorded and independently derived `coverage:'full'` claim. Partial Result Sets are not rejected for honest gaps.
- Allocation or proof failure is caught and converted to `coverage-pair-uncovered`; it cannot be swallowed by the outer defensive phase guard as a clean validation.
- The 240-case seeded brute-force oracle independently enumerates required pairs for legal layouts in both pair-semantics modes and agrees with the verifier, including cases that pass the earlier root/class check but miss an individual pair.
- Spec erratum A10 matches the implemented fixed-order rule and does not change the planning, sizing, splitting, schema version, or persisted shape.

### REM10: memory reduction and fixture corrections

Verified:

- Per-list JavaScript sets were replaced by a rank-stamp buffer; phase buffers are reused; the segment tree uses the exact `2w-1` node layout.
- Non-power-of-two segment counts, duplicate ids, overlap, and one-pair omissions have dedicated regressions. The allocation-accounting test pins the claimed typed-array inventory.
- `widePlan` and `sharedRootPlan` now construct genuine full pair covers rather than diagonal-only or disconnected pair subsets. Existing status-reader complexity intent remains intact.
- The residual absolute-ceiling estimate (~569 MiB unordered / ~512 MiB ordered) is still real. The owner has explicitly placed it under §17.1 R11-7/G-CAL and prohibited further P5 verifier redesign. Allocation failure remains fail-closed, so this is a calibration/readiness gate rather than a P5 correctness finding.

## Verification results

- `node --test test/clashtest/results/*.test.mjs` — **176/176 pass**.
- `node --test 'test/clashtest/**/*.test.mjs'` — **962/962 pass**.
- `node scripts/run-tests.mjs` with local ephemeral-port access — **2,088 total / 2,087 pass / 0 fail / 1 todo**.
- The sole todo is the pre-existing extreme-aspect-ratio containment case in `test/query/ContainmentQuery.classifyPoint.test.mjs`; it is unrelated to P5.
- A sandboxed full-suite attempt first produced three `EPERM` local-port failures. Re-running with local ephemeral-port permission removed all three, confirming they were environment restrictions rather than repository failures.

## Residual scope and gate

No reviewed remediation item remains open. These items remain outside this checkpoint and do not change the PASS verdict:

- G-CAL must calibrate the absolute capture ceilings and memory/readiness claim, including the exact-cover verifier and the earlier P4 `dedupMap` bound.
- Informational items J/K and the separately recorded pre-existing frozen-spec concerns require their own owner-authorized targeted treatment if pursued; they are not P5 remediation findings.
- The deferred duplicate `deriveRunOutcome` logic is a P6 integration requirement, not authorization to start P6.
- P6, P8, Viewer/OQ-4 integration, remote persistence, annotation/derivation follow-up, and M4 Phase 4 remain outside this review and are not authorized by it.

## Gate conclusion

The P5-REM4–REM10 checkpoint is suitable for targeted adjudication. If that adjudication agrees with this review, P5 may be recorded accepted; it does not itself authorize P6.
