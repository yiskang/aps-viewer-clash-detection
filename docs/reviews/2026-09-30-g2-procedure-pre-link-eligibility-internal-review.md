# G2 procedure — pre-link eligibility correction: bounded internal review

- **Date:** 2026-09-30
- **Artifact:** `docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md` (untracked; line numbers are current-file lines and will move on edit)
- **Type:** one bounded, documentation-only internal review. No procedure edit, no git write.
- **Method:** own read/grep of the listed sections, plus one `codex-advisor` consult at effort `high`, request id `20260930-222625-85981-8765` (response: `.codex-worker/responses/20260930-222625-85981-8765/response.md`). Every Codex claim was checked against the document; none was a false positive. One additional finding (M1) is the reviewer's own and was not raised by Codex. The native `advisor` tool was not used. The backgrounded codex task and monitors were stopped.

## Scope

Only the correction: §8 has two operational phases before K exists (`pre-closeout`, `pre-link`), no `'final'` evaluation, `finalOverall` assigned by the commit, and `closeoutComplete` as a postcondition. Reviewed: §8 intro, rows 5 and 8, the offline-matrix paragraph, X5 and X9–X19, §9.1 steps 1, 7, 8, 10, 11, the scenario matrix, "Reader/harness agreement", §4.1 B7/B8, and the K/§10 mentions of `finalOverall`. The closed areas were not reopened.

## Findings

No Critical or High findings. The two-phase model resolves the circularity.

### Medium

**M1 — Row 5's journal predicate is phase-ambiguous for the pre-link pass (line 401, with 393, 404).**
- Row 5 defines its journal contradiction as "the last durable state is not `ATTEMPT_CONSUMED`" and tags it "(pre-closeout)". Line 393 says `pre-link` runs "the same ordered pass over the current state" plus closeout predicates, and row 8 requires "journal consistent" at both phases.
- At the gate the last durable state is `CLOSEOUT_STARTED`, and the history is `AUTH_BOUND → ATTEMPT_CONSUMED → CLOSEOUT_STARTED` (W-5, line 415).
- Failure mode: a literal implementation that re-runs row 5 unchanged in `pre-link` returns FAIL on every run, including all-PASS, so no run could ever commit PASS. This is a residual form of the same unsatisfiability the correction set out to remove. A different literal reading (skip the journal check at pre-link) leaves the journal-consistency check unspecified at the gate.
- Minimum fix: in row 5 and row 8, state that the journal predicate is phase-parameterised. Pre-closeout requires last durable state `ATTEMPT_CONSUMED`. Pre-link requires history exactly `AUTH_BOUND → ATTEMPT_CONSUMED → CLOSEOUT_STARTED` for one `attemptId`, with journal bytes equal to those hashed at step 7. Add an X5 assertion that the pre-link pass on an all-PASS state with last state `CLOSEOUT_STARTED` returns PASS-eligible.

**M2 — Offline assertion (d) does not enforce what it claims (line 444). (Codex, verified.)**
- (d) claims "no evaluation reads a K-dependent predicate before K exists", but the stated source-order test checks only that `computeOverall` has no `'final'` phase and that the gate passes `'pre-link'`.
- Failure mode: `computeOverall(state,'pre-link')` could still read `state.closeoutComplete`, K or a journal `COMPLETED` while passing both stated checks. That would silently reintroduce the circularity.
- Minimum fix: require an AST/static assertion that the pre-link path and the gate contain no read of K, `closeoutComplete`, journal `COMPLETED` or any post-link field. Add a behavioural X5 test with K absent and `closeoutComplete` as a throwing getter.

### Low

**L1 — Step 8 `try` boundary is textually inconsistent (line 485). (Codex, verified.)** Item (b) reads `try { fs.linkSync(Kc, K) }`, while (c) says the whole block, gate included, is inside one `try`. A literal reading puts the gate outside the `try`, so a gate throw skips the controlled step-10 path. Minimum fix: present one block: `try { gate; fs.linkSync(Kc,K); committed = true; finalOverall = primaryOverall } catch { committed = false; → step 10 }`. This does not change the non-yielding model.

**L2 — X9/X10 say "pre-link gate row 5" for failures the gate never reaches (lines 432–433, 435, 393, 401).** R1/R2/R3 or Kc write/verification failures branch to step 10 (steps 5–7) with no gate evaluation, so row 5's closeout-failure disjuncts and the `closeoutFailures` empty predicate are reachable only by `r1-mutated` and `late-verdict-change` at the gate. The verdict is still correct (FAIL). Minimum fix: reword to "pre-link classification (row 5) — gate not reached" or say row 5 is the offline model of an earlier branch to step 10.

**L3 — Stale or imprecise wording (nits, Codex items verified).**
- Line 393 "worsen … (to `FAIL` via row 5)": a new fatal event at the gate yields row 1. Suggested: "worsen to `FAIL` (closeout failures via row 5, a late fatal via row 1)".
- Line 444 "journal finalization failure" is a stale term. Use "`CLOSEOUT_STARTED` write/verification failure".
- Line 420 "each is an offline `computeOverall` test" is inaccurate for X15–X19, which exercise closeout and reader behaviour.
- Line 487 step 10 "(before B8)" excludes a `linkSync` throw inside the B8 block. Use "before a successful B8 commit". Line 518 uses the same "before B8" framing.
- Line 138 says "each ⇒ final FAIL", meaning the assigned `finalOverall`. It is harmless but could read as a phase.

## Per-area closure

| Area | Result |
|---|---|
| (1) Every pre-link predicate knowable before K | Closed with a caveat. The listed predicates (`CLOSEOUT_STARTED` durable, R1/R2/R3, Kc verified at step 7 before step 8, `snapshotEqual`, quiescence, fatal count, `deadlineAbs`, `closeoutFailures`) are all pre-K. No K, `closeoutComplete` or `COMPLETED` dependence was found. The caveat is M1 (journal predicate) and M2 (enforcement of no K reads). |
| (1) All-PASS run satisfies the gate and commits PASS | Closed in principle (X5, row 8, line 404). Practically blocked only if M1's literal reading is applied. |
| (1) Non-PASS primary commits unchanged, never improved | Closed. The gate requires `preLinkOverall == primaryOverall` with the same row, then assigns `finalOverall = primaryOverall`. Rows 6/7 are unchanged pre-link, and any closeout failure goes to row 5 or step 10. K's `finalOverall (= primaryOverall)` is fixed in Kc before the gate (line 468). |
| (2) `finalOverall` assigned, not computed; link error ⇒ FAIL; no evaluation after `linkSync` | Closed: lines 393, 485(c), 487. |
| (2) Consistency with W-5/W-6, scenario matrix rows 1–11, exit codes (418), interaction table | Closed. W-5 rejects `K.finalOverall ≠ K.primaryOverall`. Rows 4/5 map to FAIL with no K. Rows 6, 9 and 11 read `K.finalOverall`. |
| (2) "Worsen only" claim and assertions (a)–(c) | Closed, except for the L3 nit on line 393 and L2. |
| (2) Assertion (d) | Open: M2. |
| (3) Stale-wording sweep | No statement implies an operational `'final'` evaluation before K exists. The only `'final'` hits are negations (lines 393, 444, 485). `closeoutComplete` appears only as a postcondition (lines 393, 404, 428, 456, 475 as a non-input, 485). Residual stale phrases are the L3 items. |
| (4) Step 8 coherence | Closed, except L1. Gate (a), `linkSync` (b) and assignment (c) have no new `await`, evaluation or timer between them. |

## Remaining concerns classified

- **Implementation-plan requirement:** M1 phase-parameterised journal predicate. M2 AST/behavioural test for no K reads.
- **Verification/calibration gate:** the M2 X5 test with a throwing `closeoutComplete` getter, and the M1 X5 pre-link journal assertion.
- **Design/spec correctness blocker:** none.
- **Deferred/non-goal:** L1–L3 are wording nits. They can be fixed in the same bounded pass as M1/M2, or M1/M2 can be recorded as implementation-plan requirements. None reopens a closed area.

## Verdict

The correction achieves its aim: the circularity is removed and the reader/harness agreement is intact. Two Mediums (a phase-ambiguous journal predicate, a weak enforcement test) and three Low wording issues remain. None is an architectural blocker, and none needs a design change. They are wording and test-specification fixes.

## Post-review disposition (lead, same day)

No Critical/High. Applied after this review (bounded; no further internal round):

| Finding | Disposition |
|---|---|
| M1 Medium | Fixed: row 5's journal predicate is phase-parameterised — pre-closeout requires last state `ATTEMPT_CONSUMED`; pre-link requires history exactly `AUTH_BOUND → ATTEMPT_CONSUMED → CLOSEOUT_STARTED` for one `attemptId` and journal bytes equal to those hashed for Kc. |
| M2 Medium | Fixed as spec: AST assertion that the `'pre-link'` path reads no K/`closeoutComplete`/`COMPLETED`/post-link field, plus an X5 test with K absent and a throwing `closeoutComplete` getter and a journal-predicate assertion. |
| L1 Low | Step 8 (c) states one block `try { gate; linkSync; committed = true; finalOverall = primaryOverall } catch { committed = false; → step 10 }`. |
| L2/L3 Low | X9/X10/X12 wording (step-10 path, gate not reached); "worsen via row 5 or row 1"; stale "journal finalization failure" replaced. |
