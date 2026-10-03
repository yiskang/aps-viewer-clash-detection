# G2 live execution plan — focused internal review

- **Date:** 2026-10-02 · **Baseline:** `main` @ `996305c3efc30021180e04099e6007cc1d9afa5f` · procedure SHA `d1ccfde2…5a75`
- **Subject:** [docs/research/2026-10-02-g2-live-execution-plan.md](../research/2026-10-02-g2-live-execution-plan.md)
- **Reviewer:** read-only subagent (Opus), against the accepted procedure, current harness, D2 authorization/attempt semantics, and fixture/runtime evidence. Supporting input only; **not** independent-gate authority (that is ChatGPT Work).
- **Result:** **0 Critical / 0 High / 2 Medium / 12 Low**. All Mediums and the actionable Lows were fixed in the plan (planning scope only). No production code, test, or procedure change.

## Verified correct (spot-checked by the reviewer)
Procedure/harness/package/evidence/URN hashes; HEAD == local origin/main; harness line refs (79, 82, 107, 109, 118, 260-270, 315, 444-447, 3463, 7453, 7484, 10922, 12026-27, 13337-13378, 13381-13394); W0→W3 order and the consumption boundary (B5 before first model RPC); 14 Phase-0 steps; exit codes; Table T; verdict rows 1-8; "no preflight-only mode"; G-5/G-7/G-8/G-12; runbook command not accidentally executable; planning-prompt sections 1-9 and 11 all covered.

## Findings and disposition

| # | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| M1 | Medium | Activation flip: `cli.test.mjs:92-96` spawns the real harness with a `docs/prompts/g2-live-authorization.md` record; post-flip it could run real W1/W2 and spend a record. | Fixed: plan §9 hazard + G-15 (tests must not pass W1 against real repo; forbid that filename; no `npm test` while a record exists). |
| M2 | Medium | G-8 is a procedure-vs-harness conflict; plan only said "accept vs fix". | Fixed: "procedure governs; divergence is an owner gate"; new G-14; G-8 resolution/adjudication is a §12 precondition. |
| L1 | Low | Pin inventory incomplete; some suites fail at load. | Fixed in §9 (whole-suite list). |
| L2 | Low | "before step 7" should be step 6. | Fixed. |
| L3 | Low | "spent" boundary should be surviving reservation, not B3. | Fixed (§6.5, §8). |
| L4 | Low | `Baseline-HEAD` must be final run-time HEAD, not activation commit. | Fixed (§4, §9). |
| L5 | Low | `PORT` missing from command. | Fixed (placeholder added). |
| L6 | Low | cwd/log-location unstated (in-repo log spends record). | Fixed. |
| L7 | Low | No exact reader command. | Fixed (read-only command, flagged not executed; reviewer to dry-validate). |
| L8 | Low | Post-run set omits record + reservation. | Fixed. |
| L9 | Low | Citation drift (H:404/428/440, JSON line). | Fixed. |
| L10 | Low | Working-tree statement / pre-check 4a stricter than harness. | Fixed. |
| L11 | Low | Wall-clock too low (~30 min worst case); never kill. | Fixed. |
| L12 | Low | Execution prompt must not carry `G2-LIVE-EXECUTION:` lines. | Fixed (G-16). |

## Not verified
Test pass counts re-derived statically only (counts come from the verification run, not this review); `origin/main` checked via local ref plus a fetch earlier in the session; Chromium revision from `browsers.json`/cache listing only.

## Residual (owner gates, unchanged)
G-1 (no preflight-only mode), G-8/G-14 (indeterminate-ownership PARTIAL vs procedure), G-15 (activation test hazard), plus Lows G-3/4/5/6/7/9/10/11/12/13. Review boundary respected: targeted review only; no unrestricted re-discovery loop.
