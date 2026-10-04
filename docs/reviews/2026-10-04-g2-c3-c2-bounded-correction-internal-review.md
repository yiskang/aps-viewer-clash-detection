# G2 C3/C2 Bounded Correction — Focused Internal Review

**Scope:** C3 correction, C2 correction, regression tests, bounded sibling audit, procedure neutrality, scope creep. Reviewer: Codex advisor (`medium`, request `20261004-141742-37558-16687`), one pass; findings adjudicated independently.
**Baseline:** `main == origin/main == 6f716bc0d0d2c1b1e61d26fe50b4dbe56266f7e4`. Nothing committed.

## Change (all uncommitted)
- `test/acceptance/clashpanel-viewerbridge.acceptance.mjs` (Section 32, inside the page-agent region): added harness-local `PANEL_SHOWN_INTENT_VALUE='panel/shown'`, `PANEL_HIDDEN_INTENT_VALUE='panel/hidden'` and page-portable helper `countC2DomainWrites`; `evaluateC3` now compares against the values; `g2CreateShellProbe.c2` computes `domainWrites` via the helper; three new exports. Harness imports no product module (oracle independence; page bundle unchanged in kind).
- Tests: `oracles.test.mjs` (fixtures → values; wrong-kind FAIL case; C3 regression using real `INTENT` values PASS / old names FAIL; C2 clause-(viii) helper regression incl. page-portability; drift guard vs product `INTENT`; bounded static guard for quoted `INTENT` key names; probe-wiring guard; page-agent inclusion test); `op-refusal.test.mjs:445` and `runner.test.mjs:226` stubs switched to values.
- Not touched: procedure, production/Core/Adapter/Panel, C8/C6/T4, verdict rows, control states, evidence directory.

## Verification (offline only; no live run)
- Oracle suite: 30/30 pass before the final guard added; full G2 acceptance glob + binding: **917 pass / 0 fail / 0 todo** (final).
- Offline aggregate `npm run test:offline`: 5154 tests, **5153 pass, 0 fail, 0 skipped, 1 todo** at the time of the run (pre-existing KNOWN GAP in core, unrelated: extreme aspect ratio). *Correction (independent review L2):* the final tree, which adds the later probe-wiring guard test, yields **5155 total / 5154 pass / 0 fail / 1 todo** under Node v22.23.1.
- `git diff --check`: clean.
- Mutation check: temporarily reverting the harness to the old name comparisons failed 5 new/updated tests (16, 17, 18, 20, 21); harness restored byte-identical (verified by SHA).
- **New uncommitted harness SHA:** `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b` (was `471fae40…7ac4`). **Procedure SHA unchanged:** `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`. No authorization record issued; the new SHA is for review/checkpoint only. The prior record/attempt bind the old SHA and remain historical.

## Bounded sibling audit (name-vs-value only)
Whole-harness search for quoted product `INTENT` key names and captured-`intent.type` comparisons across C1–C20: no remaining same-class site. Independently confirmed by Codex. Static guard test retained.

## Findings: 0 Critical / 0 High / 1 Medium / 1 Low
| Sev | Finding | Disposition |
|---|---|---|
| Medium | C2 probe integration (`domainWrites` expression in the page probe) not directly exercised; helper-only tests would not catch the probe being changed to an incorrect expression | **Accepted, fixed** — added a narrow source-linkage guard (probe must derive `domainWrites` via `countC2DomainWrites(constructionDispatches)`). Residual: a page-realm probe execution test is stronger but is not offline-available; the guard is intentionally brittle and acknowledged as such. |
| Low | Static name-literal guard is coarse (can false-positive on comments/strings; misses templates/aliases) | **Accepted as-is** — it exactly catches the prior defect and is bounded to this bug class; no broader audit authorized. |

Verified correct by review: value correction vs `intents.js:34`/`ClashDockingPanel.js:60`; page-agent transport (no allowlist change needed; `G2_IN_PAGE_FUNCTION_NAMES` is for Node-callable entry points only); procedure neutrality; no scope expansion. Reviewer's sandbox hit EPERM for two test files, so its own execution was partial; full execution was done by me (above).

## Residual / not claimed
- No live/browser verification; C2/C3 correction is proven offline only. This does not imply retry readiness: C8/C6 remain unresolved and unimplemented, T4 unchanged.
