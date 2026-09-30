# G2 procedure final gate -> K commit correction: targeted internal review (Codex advisor, `high`)

- **Date:** 2026-09-30
- **Artifact:** `docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md` (571 lines, uncommitted working tree; design only). Line numbers refer to this file as reviewed.
- **Governing inputs:** `docs/prompts/for-claude-g2-procedure-final-gate-k-commit-fix.md`; `docs/reviews/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure-v5-bounded-independent-rereview.md`.
- **Scope (only):** §9.1 steps 1, 7-10 and "Reader/harness agreement"; the 11-row terminal-commit truth table; O1 wording; stale-reference grep; the §4.2/§9.1/§8 test specification (X15-X19). H1 durability, R1 cutoff, N6 `2^897`/`2^900`, C20 and D-decisions were not reopened.
- **Method:** I read the artifact sections and governing inputs, ran the stale-reference greps myself, then ran one Codex advisor consult (request `20260930-210618-11447-32575`, effort `high`, read-only; response received, task exited so nothing to stop). I re-verified every Codex claim against the document text. Adjudication: Codex's High #2 downgraded to Medium; Codex's tests finding split (implementation-plan vs verification gate); two of my own findings added (F5, F6); Codex's "rows not distinct" softened (rows are scenarios, see F3). No file edited, no git writes.
- **Result: 0 Critical / 1 High / 3 Medium / 3 Low.** The synchronous `fs.linkSync` block is sound as a JavaScript race argument: nothing on the main thread can run between the gate and the syscall result. The remaining gap is the **quiescence barrier before the gate** (F1), i.e. whether the gate can see everything that "already happened".

## Findings

### F1 - High - quiescence barrier does not guarantee the gate sees pre-commit fatal/expiry facts
- **Location:** step 7 (L484: clear timers, detach listeners, `await` two `setImmediate` + microtask flush, read ledger); step 8(a) (L485); X18/X19 (L441-442); §4.2 scheduler-simulation clause (L138).
- **Failure mode (verified by reasoning; Codex reproduced on repo Node v22.23.1):**
  1. Node emits `unhandledRejection` only after the microtask queue drains (`processTicksAndRejections`). A promise rejected during the final `setImmediate` turn can therefore let the `await` continuation (a microtask) run the gate and `linkSync` **before** the `unhandledRejection` event is emitted (observed order: gate, after-sync, unhandled). The ledger read at the end of step 7 and the gate's `fatalCount == fatalCount0` both miss it; K is committed as PASS with a fatal fact that predates the commit. The specification says such an event is "seen by the gate" (L485), which is not true for this ordering.
  2. Step 7(i) *clears* T8/T9 timers. A deadline whose time has passed but whose callback has not yet dispatched is erased without recording expiry, so "any expiry ... no `link()`" (L484) cannot be observed; the gate has no absolute-time check.
  3. Step 7(ii) detaches Playwright listeners; an already-queued native event can be suppressed rather than recorded (minor; the browser is already closed by cleanup, step 1).
- **Effect:** the "gate may only fail before / event ignored after" claim (L485, L138) is not mechanically true; X18/X19 would pass an offline scheduler model that does not reproduce Node's rejection ordering.
- **Minimum fix (documentation):** (i) make an absolute monotonic-clock deadline check (T8/T9 expiry time vs `now`) part of the synchronous gate, so clearing a timer cannot hide an expiry; (ii) require every outstanding promise from deadline-wrapped work to be settled or quarantined with an attached rejection handler before the barrier; (iii) run step 8 as the first statement of a **separately scheduled macrotask** started after the final barrier turn (not directly in the drain's `await` continuation), so Node's pending-rejection processing for the drain turn completes first; (iv) state the alternative openly if preferred: an explicit fatal-event cutoff instant after cleanup, with later events informational by definition.
- **Classification:** design/spec correctness blocker (documentation-only; commit model unchanged).

### F2 - Medium (Codex: High) - `computeOverall(...,'final')` (§8) vs step 8 `finalOverall = primaryOverall`
- **Location:** L393 ("evaluated twice ... `phase='final'` ... yields `finalOverall`", "can only worsen"); row 5 final-only clause (L401); row 8 `closeoutComplete` (L404); step 8(c) (L485); post-commit invariant (L418).
- **Failure mode:** two wordings of how `finalOverall` arises. A literal implementation could run the final-phase evaluation after `linkSync` (or throw inside it), diverging from `K.finalOverall`. No actual contradiction exists (the final phase is the specification of the outcome mapping; on success it equals `primaryOverall`), so severity is Medium.
- **Minimum fix:** state once that the final phase is a specification-only mapping, that the only operational evaluations are step 1 and the step 8(a) gate, and that no evaluation occurs after `linkSync`.
- **Classification:** design/spec wording (fix with F1).

### F3 - Medium - truth-table row 8 is wrong about a kill during `linkSync`; rows are scenarios, not reader states
- **Location:** row 8 (L501, "crash (process) or external kill before `linkSync` returned | K = - | FAIL (W-3/W-4)"); step 8 text "external kill is a crash (rows 8-10)" (L485).
- **Failure mode (verified):** a kill after the kernel created the link but before control returns to JavaScript leaves a valid K; the reader then returns `K.finalOverall`, not FAIL. Row 8 also collides with row 9 in that window.
- **Row audit:** rows 1-11 are each a real, distinct **failure scenario**; no placeholder/merged row remains, count = 11. They are not distinct *reader states* (rows 6/9/11 read the same durable set; rows 1-4 share W-3). That is acceptable if the table is labelled a scenario matrix. Cross-references verified: row 7's "6 / 9 / 11" (L500) are the three K-valid rows (correct); "rows 8-10" (L485) are the three crash rows (correct); "row 10" (L508) is the OS-crash row (correct). Verdict semantics unchanged.
- **Minimum fix:** row 8 -> "process crash/kill before the `linkSync` syscall began: K absent -> FAIL; kill during the syscall: K absent -> FAIL, K created -> `K.finalOverall`; the killed harness reports no verdict"; add a one-line "scenario matrix" label above the table.
- **Classification:** design/spec wording.

### F4 - Low - K durability wording spread across §4.1 and §9.1
- **Location:** L126 ("K via a `wx` candidate plus one non-overwriting `link()` commit" listed in the same durable sequence; "survives ... a normal OS crash"), L456 (evidence durability mandatory) vs step 9/row 10/L508 (K directory entry not durable until the informational fsync).
- **Failure mode:** an implementer/reviewer reading only L126 could believe K is crash-durable at the B8 instant. Disclosed correctly in L486, row 10 and L508 (fail-safe direction, `ATTEMPT_CONSUMED` durable at B5), so no verdict impact.
- **Minimum fix:** one clause at L126: "R1-R3 and Kc are crash-durable before commit; K is atomically visible at B8 and durable only after the step 9 directory fsync."
- **Classification:** design/spec wording.

### F5 - Medium - test specification: static token scan is weaker than the invariant; real-Node scheduling is not covered
- **Location:** L138 (source-order/static test, negative control, scheduler-simulation), X15-X19.
- **Failure mode:** a token scan for `await`/`.then`/timer words can miss helper aliases, getters, or an injected function that merely looks synchronous; the scheduler simulation assumes fatal events arrive only at modeled scheduling points and would not detect F1. The three items are otherwise non-contradictory and `fs.linkSync` is the only allowed primitive; the negative control (`fs.promises.link`, `Promise.race`, late-settling fake fs) and prohibition of callback-`fs` are consistent between L138, step 8 and X16.
- **Minimum fix:** require an AST check that step 8 contains only a direct built-in `fs.linkSync(Kc, K)` call and plain lexical assignments; add real-Node integration tests for (a) rejection created in the final drain turn, (b) overdue-but-undispatched T8 timer, (c) event queued around listener detachment.
- **Classification:** implementation-plan requirement (AST test); verification/calibration gate (real-Node scheduling tests).

### F6 - Low - stale/unspecified details (my own findings)
- **Gate/step-8 error path:** step 8(a) can throw (e.g. `computeOverall` fault) but only `linkSync` is inside `try`; the text "go to step 10" is stated for step 7 and for a link throw, not for a throw in the gate (L485). Fix: "a throw in (a) is a closeout failure -> step 10".
- **`link()` naming:** where `linkSync` is now required, `link()` still appears at L89, L90, L104 (B8), L126, L418 (three times), L433, L495, L508, L517, L521, L526. Not contradictory (step 8 defines the primitive) but a residual "async `link`" reading is possible. Fix: define once "K `link()` means synchronous `fs.linkSync`" or replace.
- **O1 verb at L526:** "O1 (raw log, written outside the tree until copied)" does not say who writes it; L475 says the operator's redirect. Fix: "captured externally".
- **Classification:** design/spec wording (all).

## Stale-reference grep (item 4)
- `COMPLETED`: only L89 and W-0 (L410) mentioning that the state no longer exists. Clean.
- `receipt`: no occurrences. Clean.
- `step-7 gate` / `step 7 gate`: none; gate is consistently "step 8(a)".
- `X1-X17`: none; L138 says X1-X19 (X15-X19 terminal-commit cases), and the table has X1-X19. Consistent.
- Steps 1-11: numbered 1-11 (L478-488); references "step 8" (L89, L104, L126, L401), "step 10" (steps 2, 5, 6, 7), "steps 2-6" (step 7) all resolve correctly; step 9 (post-commit) and step 11 (print) are not referenced elsewhere. Consistent.
- `link()` where `linkSync` required: see F6.

## O1 audit (item 3)
Mentions at L3, L473, L475, L520, L526 (all `O1` occurrences). L473 ("O1 is external ... never recorded in R1"), L475 (captured by the operator's redirect; harness neither writes, owns nor records it; only O2 in `closeout.optional[]`; §8 W-0...W-6 read only harness-owned files) and L520 agree. Only nit: L526 verb (F6). No contradictory statement remains; O1 is not part of verdict reconstruction.

## Per-area closure

| Area | Status | Note |
|---|---|---|
| (a) gate -> `linkSync` race on the JS thread | Closed | single-threaded block; only an OS kill can intervene |
| (b) quiescence before the gate | **Open (F1)** | pending-rejection ordering, cleared-but-overdue timers |
| (c) timeout/cancellation | Closed (with F1 fix) | no timeout wraps `linkSync`; hung link = crash; inverse case (expiry hidden by cleared timer) is F1 |
| (d) post-K invariant | Closed (wording F2) | assign-in-block, catch-all, handlers ignore once `committed` |
| (e) crash semantics | Closed (F3, F4 wording) | row 8 window; K durability clause |
| (f) reader/harness agreement | Closed | conditional on stated filesystem assumption (accepted with D2) and F1/F2 |
| (g) test spec / primitive | Closed except F5 | `linkSync` is the only allowed primitive; no residual async alternative |
| Truth table | Closed except F3 | 11 real scenario rows, cross-refs correct |
| O1 wording | Closed | L526 verb nit |
| Stale references | Closed except F6 | |

## Remaining concerns by class
- **Design/spec correctness blocker:** F1.
- **Design/spec wording (fix with F1):** F2, F3, F4, F6.
- **Implementation-plan requirement:** F5 (AST whitelist test).
- **Verification/calibration gate:** F5 real-Node scheduling tests; the accepted filesystem assumption "an erroring `link` has no effect" (D2 owner acceptance, unchanged).
- **Product/integration decision:** none new (D1/D2/D4/D7 unchanged; D2 remains pending independent confirmation).
- **Deferred/non-goal:** complete enumeration of harness async sources until a harness exists.

## Stop
Documentation only. The procedure was not edited; no harness code, live run or commit occurred.

## Post-review disposition (lead, same day)

Applied to the procedure after this review (bounded; no further internal round — the fixes go to the independent re-review):

| Finding | Disposition |
|---|---|
| F1 High | Fixed. Step 7 records absolute `deadlineAbs` per deadline before clearing timers; every promise is tracked and awaited/handled before the barrier; step 8 is entered as a dedicated `setImmediate` macrotask (not an `await` continuation) so process-level `unhandledRejection` from the drain tick has reached the ledger; gate re-checks `deadlineAbs` and `fatalCount`. |
| F2 Medium | Fixed: `computeOverall(state,'final')` is evaluated inside the gate; never re-evaluated after `linkSync`. |
| F3 Medium | Fixed: row 8 now "before `linkSync` was invoked"; kill-during-syscall is row 8 or 9 by durable state; table relabelled scenario matrix. |
| F4 Low | Fixed: §4.1 durability claim excepts K (durable only after the step-9 directory fsync). |
| F5 Medium | Fixed as spec: AST whitelist of exactly one direct `fs.linkSync(Kc,K)` call; real-Node integration tests (drain-turn rejection, overdue timer, event around listener detachment). |
| F6 Low | Fixed: gate inside the `try` (throw ⇒ step 10); `link()` → `linkSync`; O1 "written" → operator-captured. |
