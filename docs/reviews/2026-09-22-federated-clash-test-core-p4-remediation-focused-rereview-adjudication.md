# Federated Clash Test core — P4 remediation focused re-review: targeted adjudication

- **Date:** 2026-09-22
- **Adjudicated artifact:** [`2026-09-22-federated-clash-test-core-p4-remediation-focused-rereview.md`](2026-09-22-federated-clash-test-core-p4-remediation-focused-rereview.md) (0 Critical, 0 High, 0 Medium, 0 Low; verdict "P4 remediation PASS").
- **Repository state adjudicated:** branch `feature/federated-clash-test-core-engine`, remediation checkpoint and HEAD `2762906bb5bd8f90eecb72bbb8d334bd5fc20178`, remediation base `b47d5402b553ca5a2d98598795e0e51ba58d5270`. Working tree at review time carried only the review artifact and the handoff.
- **Method:** `CLAUDE.md` "Independent review adjudication". Scope limited to the review's three resolution claims (H1.4, M1, M2), its recording of the H1/H2/H3 owner dispositions as non-code carry-forwards, the commit boundary, test evidence, and gate verdict — not a new unrestricted P4 review. Done directly, without subagents, given the review's small size (0 findings, three narrowly-scoped resolution claims). **Read-only: no production code, test, plan, or spec was modified.**

## Result

**Agree with the gate verdict.** All three resolution claims (H1.4, M1, M2) are confirmed resolved at `2762906`. The review's characterization of the H1/H2/H3 owner dispositions as carry-forwards (not represented as P4-complete work) matches the actual adjudication and handoff records exactly. No disagreement to persist; no owner-decision escalation required.

## Verification of the three resolution claims

| Finding | Review claim | Adjudication |
| --- | --- | --- |
| H1.4 | `LocalUnitExecutor` snapshots held bindings before the post-check bracket, revalidates synchronously after the await, and downgrades an `equal` proof to `unverifiable` if a participant became unheld during the bracket; drift/unverifiable answers already found stand untouched | **CONFIRMED.** `LocalUnitExecutor.js:494-497` (`diedDuringPostBracket` computed by diffing a fresh `bindingsStillHeld(...)` read against the pre-bracket snapshot; `post` is only overwritten when `post.proof === 'equal'`). Re-ran the regression test directly: `localExecutor.scope.test.mjs` test 3, `'a lease that dies DURING the post-check bracket settles unverifiable, never equal, and merges nothing (H1.4)'` — passes. This test was already proven to fail against the pre-fix code (temporary revert, re-run, restore) during the original remediation pass; not re-derived here, per the focused-review scope. |
| M1 | Singular fragments validate against `FRAGMENT_KEYS`; pair operands validate against a distinct `PAIR_FRAGMENT_KEYS` that omits `role`, so a pair-scoped operand carrying `role` is now rejected | **CONFIRMED.** `UnitExecutor.js:108` defines `PAIR_FRAGMENT_KEYS = ['modelKey', 'dbId', 'fragId']`; `:479` passes it into `checkFragment` for pair operands. Re-ran `unitOutcome.validate.test.mjs` test 39, `'rejected: pair-scoped operand carrying role...'` — passes. |
| M2 | `classifyLibraryError` and the projection catch read `.name`/`.message`/`.kind`/capacity-detail properties through a guarded `safeGet`, so a hostile getter can no longer escape the executor's promise as a raw rejection; `EnumerationCancelledError` remains recognizable | **CONFIRMED.** `LocalUnitExecutor.js:145` defines `safeGet`; used at every cited read site. Re-ran all five regression tests directly: four hostile-getter cases in `localExecutor.errors.test.mjs` (name/message/capacity-detail/kind) and one in `localExecutor.call.test.mjs` (a hostile getter reached through the projection catch) — all five pass. |

## Verification of the owner-disposition recording (H1, H2, H3)

**CONFIRMED accurate, no misrepresentation.** Cross-checked the review's §"Owner dispositions and carry-forwards" against the actual [independent-review adjudication record](2026-09-22-federated-clash-test-core-p4-independent-review-adjudication.md)'s own "Remediation (owner-authorized 2026-09-22)" section and `docs/handoffs/latest.md`: all three (P6-side fact recovery for H1 with no P4 schema change; H2's four spans folded into the extended CF3 carry-forward; H3's `dedupMap` bound folded into the R11-7/G-CAL gate) are worded identically in substance across all three documents, each explicitly stated as a recorded owner decision and downstream obligation rather than completed P4 work. No drift, no overstatement.

## Boundary and test evidence

- **Boundary — CONFIRMED.** `git show --stat --format= 2762906` → 9 files changed, +361/−21 — matches the remediation commit exactly (`LocalUnitExecutor.js`, `UnitExecutor.js`, the handoff, the two new `docs/reviews/` files, and four `test/clashtest/execution/*.test.mjs` files). No file outside the H1.4/M1/M2 remediation scope; no `collision/`, `wwwroot/`, `package*.json`, spec, or P0–P3 file touched.
- **Tests — CONFIRMED.** `node --test test/clashtest/execution/*.test.mjs` → **147/147**. `node --test $(find test/clashtest -name '*.test.mjs')` → **786/786**. Both exactly match the review's claimed counts.
- **Full runner — CONFIRMED, reconciled.** `node scripts/run-tests.mjs` → **1,912 total / 1,911 pass / 0 fail / 1 todo**, matching the review's own final unrestricted rerun figure exactly. The review's noted transient `CollisionWorld.placementInvalidation` failure on one preceding run (self-reported as passing 18/18 in isolation, outside the P4 boundary) is consistent with the same class of environment flakiness already reconciled at every prior phase gate in this project (M4 spike-server `EPERM`, `ContainmentModeQuery` real-time-budget); not reproduced in this adjudication's own run, and not a P4 or Clash Test failure in either case.

## Gate verdict

`P4 remediation checkpoint (2762906) ACCEPTED. All three remediated findings (H1.4, M1, M2) are confirmed resolved; the owner dispositions for H1, H2, and H3 are accurately recorded as carry-forwards, not as completed P4 work.` The Work review and this adjudication **agree**; no disagreement to persist, no owner-decision escalation.

**P4 is accepted, in full**, including its remediation. No further owner decision is required to close the P4 gate itself.

P5 does **not** begin from this adjudication. `CLAUDE.md` transition rules and the handoff still require the milestone owner's separate, explicit go-ahead.

## Not adjudicated / unchanged

The original H1/H2/H3/M1/M2 findings and their initial resolution reasoning are not re-derived here (already adjudicated with direct evidence in [`2026-09-22-federated-clash-test-core-p4-independent-review-adjudication.md`](2026-09-22-federated-clash-test-core-p4-independent-review-adjudication.md)); this pass verified the focused review's *resolution claims* against the committed code and the *accuracy* of its carry-forward recording, per the focused-review scope. All carry-forwards listed in the handoff (P6's `factsFromOutcome` boundary-scan obligation; CF4/CF5; H2's extended CF3; H3's R11-7/G-CAL item; the `checkpoint(label)` argument; roots-observation row shape; P3's L-R1 disposition; P5's `taints[]` ceiling reconciliation) are unchanged. No spec, plan, or acceptance mapping was altered.
