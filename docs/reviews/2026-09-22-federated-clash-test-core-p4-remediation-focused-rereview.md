# Federated Clash Test core P4 remediation — focused independent re-review

**Date:** 2026-09-22  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch:** `feature/federated-clash-test-core-engine`  
**Reviewed commit:** `2762906bb5bd8f90eecb72bbb8d334bd5fc20178`  
**Remediation base:** `b47d5402b553ca5a2d98598795e0e51ba58d5270`

## Verdict

**PASS — the P4 remediation resolves H1.4, M1, and M2 within the authorized boundary.**

Finding counts: **0 Critical / 0 High / 0 Medium / 0 Low**.

The owner dispositions for the original H1, H2, and H3 are recorded as downstream carry-forwards rather than falsely represented as P4 implementation. This focused review found no contradiction in those records and no new blocker in the changed code or directly affected invariants.

This document is an independent-review claim under `CLAUDE.md`. A targeted adjudication of this review is still required before the P4 gate can be treated as procedurally closed and before any phase advance is considered. P5 also requires a separate explicit owner go-ahead.

## Review boundary

Per `CLAUDE.md`, this pass reviewed only commit `2762906`'s remediation areas and their directly affected invariants:

- H1.4: a participant lease dying during the asynchronous post-check bracket.
- M1: the closed schema of pair-scoped diagnostic operands.
- M2: hostile getters on untrusted thrown values and malformed projection values.
- The recorded, non-code owner dispositions for original H1, H2, and H3.

The frozen design, the full P4 implementation, earlier accepted phases, and unrelated collision-library behavior were not reopened.

## Finding verification

### H1.4 — resolved

`LocalUnitExecutor` now snapshots held bindings before the post-check bracket, revalidates them synchronously after the awaited bracket returns, and downgrades an otherwise `equal` proof to `unverifiable` when a participant became unheld during that interval. The result therefore cannot settle `evaluated/equal` or merge pairs from a model known dead at the bracket boundary.

The correction preserves already-established `drift` and `unverifiable` results, which is consistent with the existing settlement priority. There is no asynchronous boundary between the final revalidation and settlement, so ordinary event-loop mutation cannot reopen the same race after the new check.

The regression test directly triggers eviction during the post-check digest and asserts `unverifiable`, no evaluated outcome, and no pair merge. It passes.

### M1 — resolved

`UnitExecutor` now validates singular fragments with `FRAGMENT_KEYS` and pair operands with a distinct `PAIR_FRAGMENT_KEYS` that omits `role`. The existing validator therefore rejects a pair-scoped operand carrying the fragment-only field instead of admitting an out-of-schema value into downstream diagnostic detail.

The new rejection test passes, while the existing legal pair and singular-fragment cases remain covered by the execution suite.

### M2 — resolved

`LocalUnitExecutor` now reads untrusted `.name`, `.message`, `.kind`, and capacity-detail properties through `safeGet`, including the malformed-result projection catch. Throwing getters can no longer escape the executor's promise as raw rejections; they settle through the documented internal-error path, while a genuine `EnumerationCancelledError` remains recognizable when its name is readable.

The five new hostile-getter regression cases pass: error name, error message, capacity detail, capacity kind, and a getter reached through projection failure.

## Owner dispositions and carry-forwards

- **Original H1:** no P4 schema change. P6 must recover participant death through its own live-binding boundary scan in `factsFromOutcome`. This is explicitly recorded as not yet implemented.
- **H2:** all four unsliced cap-shaped spans remain a bounded AC-12/G-CAL carry-forward; no current interface change is claimed.
- **H3:** the diagnostic `dedupMap` working-set bound remains an explicit R11-7/G-CAL item that must close before a P6/P7 memory-bound claim; no current bound is claimed.

These are owner decisions about phase ownership and gates, not evidence that the underlying downstream obligations are complete. Their wording in the adjudication and handoff preserves that distinction.

## Verification evidence

- `node --test test/clashtest/execution/*.test.mjs` — **147/147 passed**.
- `node --test test/clashtest/**/*.test.mjs` — **786/786 passed**.
- `node scripts/run-tests.mjs` final unrestricted rerun — **1,912 total / 1,911 passed / 0 failed / 1 todo**. The todo is the pre-existing `ContainmentQuery.classifyPoint` known gap.
- One preceding unrestricted full-suite run produced a single failure in `CollisionWorld.placementInvalidation.test.mjs`; that file then passed **18/18** in isolation and the complete suite passed on the immediate rerun. The failing file is outside the P4 remediation boundary, and no P4 execution test failed.
- Final pre-review repository status was clean at committed checkpoint `2762906`; the only intended post-review changes are this review and the handoff update.

## Gate assessment

The focused remediation is technically ready to clear P4: no Critical, High, Medium, or Low finding remains in H1.4, M1, or M2. Original H1, H2, and H3 remain accurately governed by their explicit owner dispositions and downstream gates.

**Independent review verdict: P4 remediation PASS.**

**Next authorized action:** targeted adjudication of this review's boundary, verification evidence, and pass verdict. Do not start P5 until that adjudication agrees and the owner separately authorizes P5.
