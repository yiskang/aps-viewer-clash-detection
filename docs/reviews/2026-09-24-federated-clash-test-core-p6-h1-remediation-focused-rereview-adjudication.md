# Federated Clash Test core P6 H1 remediation focused re-review — targeted adjudication

**Date:** 2026-09-24
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
**Branch:** `feature/federated-clash-test-core-engine`
**Adjudicated review:** [`docs/reviews/2026-09-24-federated-clash-test-core-p6-h1-remediation-focused-rereview.md`](2026-09-24-federated-clash-test-core-p6-h1-remediation-focused-rereview.md)
**Reviewed checkpoint:** `771dc27e36aefb33870e8b653e1ef6bcfaf4da34` (parent `01e5341`)

Performed per project `CLAUDE.md` "Independent review adjudication": targeted verification of the review's cited findings, commit boundary, claimed test results, and gate verdict only. No new unrestricted review; no production code, plan, or spec modified. Verification was split across two read-only subagents (test/boundary re-run; source-level claim check) plus a `codex-advisor` (medium) second opinion. Subagent and Codex conclusions were cross-checked against each other and, for the todo-test identity, against the repository directly.

## Verdict

**AGREE.** H1 is closed at `771dc27`; the Medium (M1) is confirmed as non-blocking plan drift; the PASS verdict (0 Critical / 0 High / 1 Medium / 0 Low) is upheld. No new finding of any severity was raised by either the source-level check or Codex.

## H1 closure — CONFIRMED (from source)

- `clashtest/run/Run.js:1303-1309`: `emptyLedgerRecord` records `planExists: false, pairSpaceTotal: 0, emptyOperand: false, units: [], rootOwners: []`, plus one `{ phase: run.phase, cause: 'internal-error' }` planning gap. Its only caller is `terminalInternalError` (`Run.js:1217`).
- `validateResultSet.js:819-820`: `reconcileEvaluatedCoverageSteps` returns immediately unless `ledger.planExists === true` — the check that produced `coverage-model-mismatch`. Every other `planExists` use in the validator (`:325`, `:558`, `:606`) is compatible with this shape; `pair-space-inconsistent` holds (0 = 0 over empty leaves); no validator check ties `planExists: false` to a null definition.
- Coverage derives `partial` (`resultSet.js:175-181` requires `planExists`, zero gaps, and ≥1 leaf for `full`); status is passed as `failed`; the validator's `derivedFull` re-derivation agrees (`validateResultSet.js:594-613`).
- `assessNoClashClaim` / `canClaimNoClashes` (`clashtest/results/claim.js`) reject the set on at least three independent conjuncts (status ≠ completed, coverage ≠ full, pair space = 0). Codex additionally checked `status.js` pair/element queries: empty ownership yields `undetermined` / `none`, so no vacuous-clean path exists.
- Sealing/digest path unchanged: `buildResultSet` → `sealResultSet` → `residency.admitSealedSet`; `ledgerDigestInput` digests `planExists`, re-derived by the validator (`validateResultSet.js:1554-1557`), so the value is self-consistent.
- Tests (`test/clashtest/run/lifecycle.test.mjs`): the broken-plan reproducer now asserts `planExists === false` and `issuesOf(...) === []` (replacing the two documented `coverage-model-mismatch` issues); the new healthy-plan regression asserts `failed`, non-empty provenance, zero validation issues, and both real claim predicates rejecting. Codex ran both targeted regressions and they pass.

## M1 (Medium, non-blocking) — CONFIRMED

`docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:3531` still reads `planExists: run.plan !== undefined, …` inside `const emptyLedgerRecord` (line 3530). (Codex cited 3530; the offending expression is on 3531 — same block.) No other occurrence of the old expression exists in `clashtest/` or `test/`; remaining mentions are the new explanatory comment in `Run.js:1296` and historical review records. Documentation drift only; runtime is correct. **Not fixed here** — the review requires owner authorization for the bounded plan edit, and adjudication must not modify artifacts beyond its own record.

## Prior non-blocking items — unchanged

`provenance.models[].elementCount` still lacks a §13.2 one-line definition; the literal P6 acceptance grep still matches a compliant comment in `clashtest/execution/LocalUnitExecutor.js`. Neither is affected by this checkpoint; disposition belongs to the owner's P6 acceptance decision.

## Commit / repository boundary — CONFIRMED

`git diff --check 01e5341..771dc27` is clean. The range changes exactly four tracked files: `clashtest/run/Run.js` (only production file), `test/clashtest/run/lifecycle.test.mjs`, `docs/handoffs/latest.md`, and the prior adjudication record. HEAD is `771dc27e…`. Untracked: the four review artifacts under `docs/reviews/` (three older ones plus the P6 H1 re-review), untouched by this adjudication apart from this new record.

## Test results — reproduced independently

| Check | Review claim | Observed |
| --- | --- | --- |
| `test/clashtest/run/lifecycle.test.mjs` | 49/49 | **49/49** |
| `test/clashtest/run/*.test.mjs` | 119/119 | **119/119** |
| `test/clashtest/**/*.test.mjs` | 1,085/1,085 | **1,085/1,085** |
| `node scripts/run-tests.mjs` | 2,211 / 2,210 pass / 0 fail / 1 todo | **2,211 / 2,210 / 0 / 1 todo** (no flakes, no sandbox retry) |

The single todo is the pre-existing "extreme single-geometry aspect ratio" known-gap in `test/query/ContainmentQuery.classifyPoint.test.mjs` (verified by grep), matching the review's description.

## Second-opinion note

`codex-advisor` (medium; request `20260924-114209-5054-14488`) agreed with all four claims and raised no new defect; it recommended keeping the H1 implementation and correcting the plan excerpt as a separate documentation-only change. (An earlier lookup during this session briefly picked up a stale, unrelated Codex response from the prior adjudication cycle — the Run.js performance findings already recorded as handoff item 5 — and it was discarded, not used.)

## Gate conclusion

**Adjudication agrees with Work: the P6 H1 remediation gate is PASS at `771dc27`.** H1 is closed. Remaining before P6 acceptance are owner dispositions only: (1) authorize or defer the one-line `p6-run-lifecycle.md:3531` plan correction; (2) disposition the `elementCount` and acceptance-grep non-blocking items; (3) the owner's P6 acceptance decision itself.

**Recommended next action (not authorized):** owner reviews this record, authorizes the bounded plan edit, and decides P6 acceptance. **Authorized next action:** none — awaiting owner authorization. **Must not begin:** P7 or later phases, Viewer/OQ-4 integration, remote persistence, annotation/derivation follow-up, calibration-dependent claims, M4 Phase 4, or reopening the frozen core design.
