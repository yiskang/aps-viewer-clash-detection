# G2 harness implementation — focused internal review

- **Date:** 2026-10-01
- **Reviewer:** internal implementation reviewer (Claude), review only; no production, harness or test file was edited by this review.
- **Authorization in scope:** `docs/prompts/for-claude-g2-harness-implementation-only.md` §11 ("one focused internal implementation review").
- **Governing contract:** `docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md` (v5 + final-gate correction + §8/§9.1 pre-link reconciliation; 571 lines).
- **Baseline:** `main` @ `82dab8244d8d83f3cb824b05199d7a2ce5b0f2e0`; nothing staged; no tracked diff.
- **Verdict of this review:** 0 Critical / 2 High / 3 Medium / 5 Low implementation findings, plus 4 procedure contradictions that need an owner decision **before any live-execution authorization** (one of them makes a live C15 FAIL certain; another very likely caps G2 at PARTIAL). **Not ready for live authorization.** The harness is internally consistent enough for independent Work review once the two High findings have been fixed. Both fixes are small and stay within harness scope.

## 1. Scope

The review covered:

- `test/acceptance/clashpanel-viewerbridge.acceptance.mjs` (9,200 lines, untracked).
- Its 24 sibling `test/acceptance/clashpanel-viewerbridge.acceptance.*.test.mjs` files.
- The five implementer reports (Tasks 1–5) and their flagged contradictions.

The review was prioritised as the dispatch asked:

1. D2 reservation/journal durability ordering and fail-closed behaviour (§4.1).
2. The final gate → `fs.linkSync(Kc, K)` block (§9.1 step 8, §8), and whether the static guard can really detect the listed regressions.
3. The R1/R2/R3 acyclic chain, the reader truth table and harness/reader agreement.
4. Whether `LIVE_PATH_WIRED=false` makes live execution impossible, and whether the CLI test is sound.
5. Table T values; N6 domain and boundaries; C20/N8 rules.
6. Repository hygiene.
7. Verification of each contradiction the implementers flagged.

Out of scope: any live run, any Viewer/API evidence investigation, and G1.

## 2. Method

- I read the procedure in full (§0–§14) and the authorization prompt, then the harness sections most relevant to the priorities above: §1–§8, §11–§16, §17, §21, §28, §30, §33 (C15), §35 (deferred units), §38 and `main`/`runCli`.
- I compared each against the procedure text clause by clause.
- For the two High findings I built a small offline probe (scratchpad scripts, not in the repo, importing the harness exports with `NODE_TEST_CONTEXT=1` so `main()` does not run) to confirm the behaviour empirically rather than by reading alone.
- I checked the production ViewerBridge source (`clashpanel/viewer/ViewerBridge.js`) only to adjudicate the C15(e) contradiction.
- No codex consultation was used. No live flags were passed to anything.

## 3. Commands and exact results

| Command | Result |
|---|---|
| `node --test test/acceptance/clashpanel-viewerbridge.acceptance.*.test.mjs` | **tests 358, pass 358, fail 0**, cancelled 0, skipped 0, todo 0 (exit 0) |
| `node scripts/run-tests.mjs` | **tests 4604, pass 4603, fail 0, todo 1** (exit 0); the one TODO is the pre-existing `KNOWN GAP … extreme single-geometry aspect ratio` case (unrelated to G2) |
| `git rev-parse HEAD` / `git branch --show-current` | `82dab8244d8d83f3cb824b05199d7a2ce5b0f2e0` / `main` |
| `git diff --stat`, `git diff --cached --name-only` | empty / 0 files (nothing staged, no tracked change) |
| `git status --porcelain` | only untracked: the authorization prompt, the harness, and 24 `*.test.mjs` |
| `ls test/acceptance/results/` filtered for g2/viewerbridge/attempts | none (no G2 result/journal files); the directory is git-ignored (`.gitignore:486`) |
| Probe 1 (T9, see H1) | `{"attemptDeadlineExpired":false,"hasExpired":false,"deadlinesForGate":[]}` after a cap overrun whose timer had not dispatched |
| Probe 2 (N8, see H2) | `{"realVerdict":"NOT_EVIDENCED(evidence-too-large)","reached":true,"n8":"NOT_DETECTED",…}` |

## 4. What was verified as conforming (no finding)

**§4.1 authorization (W0/W1)**
- The W0 interlock is exact.
- W1 is read-only. It walks path components with lstat (no symlink anywhere), reads strict UTF-8, enforces whole-line markers exactly once, applies the candidate-set, duplicate-ID and supersession rules, and checks all five digests (`:355-436`).

**§4.1 attempts directory and journal (W2a/W2b)**
- Startup rule: this ID's reservation, journal or orphan temp refuses. Any unparseable reservation or journal refuses (never skipped). A matching record SHA refuses (`:659-703`).
- W2a runs for D1 and then D2: lstat, then mkdir if absent (EEXIST accepted only if the result is a real directory), then fsync(Di), then an **unconditional** parent fsync (`:822-845`).
- W2b holds D2Fd, then creates the reservation with `wx`, writes, fsyncs the fd, closes and fsyncs D2Fd. It then writes the AUTH_BOUND journal via temp+rename, fsyncs D2Fd and verifies by SHA read-back (`:852-925`). EEXIST refuses with nothing further written.
- The in-memory journal advances only after a verified write. There is no retry anywhere.
- The state graph equals the §4.1 table and has no COMPLETED state (`:455-462`).
- `classifyJournal` follows the §4.1 precedence (an unreadable journal ranks above reservation-only).

**§9.1 closeout, steps 1–7**
- Primary verdict and `fatalCount0`, then T9 disarmed, then CLOSEOUT_STARTED verified, then O2 (non-verdict-bearing, time-bounded).
- S\* is plain-JSON and deep-frozen, with `snapshotSha256` computed.
- R1 and R2 are written with temp+rename and `fsync(D1Fd)`, then verified (SHA, parse, schema, snapshotEqual; headings and primary line).
- R3 is written only after both verify. snapshotEqual is re-checked before R3 and before Kc.
- Kc is written with `wx` and verified, including the on-disk journal SHA against `Kc.journalSha256`.
- Quiescence (`:2256-2386`) matches §9.1.

**§9.1 step 8, the critical section**
- The critical section is the exact §9.1(c) form (`:1993-2009`).
- It runs as the body of a dedicated `setImmediate` macrotask scheduled from the last drain turn's callback. The commit latch is set synchronously in the same macrotask (`:2018-2030`).
- `linkSync` is node:fs's own function, identity-vetted in step 7 before Kc exists (`:1947-1960`, `:2343`).

**§9.1 steps 9–10**
- Post-commit steps are individually caught. The exit code derives from `outcome.finalOverall`, and K is never touched (`:2040-2074`, `:2401-2423`).

**§8 verdict model**
- There are exactly two phases, and anything else throws.
- Row predicates are independent. Row 8 is a positive predicate; the offline matrix proves it is the complement of rows 1–7.
- Missing or out-of-enum inputs fail closed. `closeoutComplete` is never read (`:1374-1463`).

**R1/R2/R3/K/F**
- The builders are pure.
- The R1 whitelist equals the §10 top-level keys. The forbidden closeout keys are checked shallow and deep. R1 `attempt.journalStates` ends at CLOSEOUT_STARTED. R3 and K have fixed schemas (`:1494-1829`).
- The dependency graph is acyclic: no artifact carries its own digest or a later fact.

**Reader**
- The W-0…W-6 witnesses are implemented. The namespace rule ignores candidates, temps and `.invalid-` files.
- F dominates. K without a journal, non-regular files and unparseable files all give W-0.
- W-5 performs the full cross-validation. Only the complete file set can reach W-6 (`:2456-2587`).
- The terminal-commit matrix rows 1–11 are exercised offline against the surviving files of real closeout runs.

**Dormancy**
- `LIVE_PATH_WIRED=false`: `main()` refuses right after W0, before W1 (`:8796-8798`).
- There is no top-level playwright import. The only Node-side `import('playwright')` is the post-B3 closure (`:8820`); `:7184` is the page-side module installer inside the page-agent bundle.
- Failure injection (`:6065`) and the live runner (`:6191`) are independently gated.
- The CLI test spawns the real file from an empty tmp cwd with a resolve-deny hook and an fs observer (including negative controls that prove both observers fire). It shows exit 1 with no fs access beyond the entry guard's `realpathSync`, for every interlock combination.

**Table T**
- Values match procedure §4.7 exactly (T1–T24, `:3311-3340`).
- T8 `closeTimeoutMs = 10_000` equals G1 `CLOSE_TIMEOUT_MS` (`g1-svf2-f1-f8-verification.mjs:9235`).

**C4 and N6**
- C4 checks clauses in the required order: all twelve coordinates first (non-finite or inverted, then `|v| > 2^900`), then no-bounds, then no-reference, then containment. Comparisons use strict `>` (`:4637-4667`).
- The N6 builder checks non-finite, then `> 2^900` (OUT_OF_RANGE), then `> 2^897` (OUT_OF_N6_DOMAIN), all before any arithmetic. `±2^897` is in the domain, and `±2^900` is OUT_OF_N6_DOMAIN, as §7 requires.
- A rejected input can never be DETECTED; sub-case (ii) is never NOT_APPLICABLE (`:4754-4842`).

**C20**
- The oracle has no FAIL path (`:5253-5296`). `evaluateC20` never emits FAIL (`:5355-5388`). PASS requires N8 DETECTED.

**Hygiene**
- Production code and G1 are untouched. Nothing is staged or committed. No `results/` files exist.

## 5. Findings

### Critical

None.

### High

**H1 — An overdue-but-undispatched T9 expiry is dropped from the step-8 gate, so an over-cap run can still commit PASS.**
- *Where:* `test/acceptance/clashpanel-viewerbridge.acceptance.mjs:8753-8754` (the quiescence hooks in `runPostReservation`), with `:4037` (`disarm()` clears an armed-but-undispatched timer) and `:1973-1976` (the gate).
- *Procedure:*
  - §9.1 step 7(i) (l.484): "record, for every deadline the harness armed (T8 per-step, **T9**, poll deadlines), its absolute monotonic expiry `deadlineAbs` … clearing a timer can hide an overdue-but-undispatched expiry, which is why the gate re-checks `deadlineAbs` itself".
  - §9.1 step 8(a) (l.485): the gate must check every recorded deadline.
  - §8 row 5: `ATTEMPT_DEADLINE`.
- *What the code does:* `deadlines()` returns the T9 entry **only if** `t9DisarmedAt < t9.deadlineAbs()`. When the 20-minute cap elapses during a synchronous or microtask stretch before closeout step 1, `disarm()` clears the timer before its callback runs. `attemptDeadlineExpired` stays `false`, and T9 is not handed to the gate at all. Task 5's flagged reading 13 ("an expired T9 is already in the ledger") holds only when the timer callback actually dispatched.
- *Failure scenario:* an attempt that exceeded T9 by a few milliseconds reaches row 8 at pre-closeout and pre-link, and commits K = PASS. The procedure requires FAIL (row 5, `ATTEMPT_DEADLINE`, or `late-verdict-change(deadline-overdue)`).
- *Evidence:* Probe 1 armed a 1 s cap with a non-dispatching timer, advanced the clock to 1.5 s and disarmed. Result: `attemptDeadlineExpired:false`, `hasExpired:false`, and the gate deadline list `[]`. Likelihood live is low (a millisecond-scale window), but this is exactly the race the procedure's `deadlineAbs` rule exists to close.
- *Suggested fix (harness-only):* always return the T9 entry once it has been armed: `{name:'T9:attempt', deadlineAbs, completedMs: t9DisarmedAt}`. The existing gate predicate then flags `completedMs ≥ deadlineAbs` as `late-verdict-change(deadline-overdue)`. Additionally or alternatively, at step 1 treat `clock.monotonicMs() > deadlineAbs` at disarm as `recordAttemptDeadline()` before computing `primaryOverall`, so that primary itself is row 5. Add a mainflow test with fake timers that never dispatch.
  - This touches D2 closeout semantics (the quiescence input to the gate, not the critical section). Per authorization §11 it must be noted for independent Work review.

**H2 — N8 can become NOT_DETECTED (§8 row 4 ⇒ overall FAIL) when C20 is only `NOT_EVIDENCED(evidence-too-large)`.**
- *Where:* `:5288-5291` (the `evidence-too-large` check runs before R2), `:5310-5311` and `:5323` (N8(i) requires the exact label `NOT_EVIDENCED(no-change-observed)`).
- *Procedure:*
  - §C20 (l.350): a list above 1 MiB ⇒ `NOT_EVIDENCED(evidence-too-large)`.
  - Rule (a) (l.163): "no C20/N8 branch that ends in FAIL …".
  - §4.7 consistency row N8 (l.206): "`NOT_DETECTED` (⇒ §8 row 4) arises **only if the oracle wrongly returns PASS** on a null-change/displaced input".
  - Authorization §7: "missing/ambiguous C20 evidence ⇒ NOT_EVIDENCED".
- *What the code does:* when the `F_clear`-vs-`F_off1` run-length list exceeds 1 MiB, the real evaluation returns `evidence-too-large` with `reachedPixelComparison:true`, so N8 is evaluated. N8(i) substitutes `F_on := F_off1` but keeps the same `F_clear`. The oracle therefore returns `evidence-too-large` again, not `no-change-observed`. That makes `iOk=false`, so N8 = NOT_DETECTED.
- *Failure scenario:* a noisy or progressively refined post-clear frame produces a scattered difference: about 90k runs is enough to pass 1 MiB on a roughly 1280×720 canvas. Instead of C20 NOT_EVIDENCED (⇒ PARTIAL), the run records a mandatory-control failure and commits FAIL (row 4). The single attempt is consumed with a false defect claim.
- *Evidence:* Probe 2 (700×400 synthetic frames with an alternating post-clear difference) gave `realVerdict: NOT_EVIDENCED(evidence-too-large)` and `n8: NOT_DETECTED`.
- *Suggested fix:* evaluate R2 (and preferably R3–R6) before the list-size cap, so that the cap only blocks a PASS that would otherwise be granted. Alternatively, judge N8(i) as "non-PASS with `R.R2 === false`" rather than by exact label. Add an offline test for this case. (If the owner prefers the other reading, record N8 NOT_APPLICABLE for `evidence-too-large`; that needs a one-line procedure clarification.)

### Medium

**M1 — The §8 "AST assertion" for the pre-link path is a token deny-scan whose transitive closure has gaps.**
- *Where:* `:3126-3140`, `:3035-3045`, `:2977-3003`. *Procedure:* §8 (l.444), "an **AST assertion** that the `'pre-link'` path contains no read of K, `closeoutComplete`, a journal `COMPLETED` or any post-link field".
- The closure follows only direct `name(` calls to `function`-declared harness functions. It does not follow:
  - arrow or `const` helpers;
  - method calls;
  - function references passed as values (for example `.map(fn)`);
  - computed member access (`s['closeoutComplete']`, `cs['K']`, `Reflect.get`) or concatenated names.
- *Failure scenario:* a regression adds `const peek = (s) => s['closeout'+'Complete']` and calls it from `evaluateOverallRows`. The guard stays green. The runtime throwing-getter test catches only a top-level `state.closeoutComplete` read, and only on the paths it drives.
- *Mitigation already present:* the critical section itself has an exact-AST whitelist; the X5 run with K absent; the matrix states carry a throwing getter.
- *Suggested fix:* include `const`/arrow declarations in `harnessNames`. Treat any bare-identifier reference to a harness function (not only calls) as an edge. Reject computed member access (`[` after an identifier) inside pre-link-path functions unless the index is a literal from an allow-list.
- Task 2 already disclosed this deviation (CONTRADICTION 4). It is recorded here because it is a stated procedure requirement.

**M2 — The static post-commit and timeout-wrapping guard stops at `closeoutProtocol`; the real live consumers (`runPostReservation`, `runCli`) are unguarded.**
- *Where:* `:3159-3218` (call-site and post-commit rules), with `:8744-8768` and `:8829-8837`.
- *Procedure and authorization:* §9.1 step 8 ("any timeout able to select FAIL while a link may still create K"; "the exit code is derived from the already-assigned `finalOverall`"), §8 l.418, and authorization §6 ("post-K verdict mutation", "timeout-wrapped commit").
- *Failure scenarios:*
  - A regression wraps `closeoutProtocol(...)` in `Promise.race` with a timer inside `runPostReservation`, or rewrites `finalOverall`/`exitCode` after `closeout` returns (for example conditioned on `state.sessionTainted`). Neither is detected statically.
  - The mainflow tests check agreement only on the paths they drive.
- *Suggested fix:*
  - Extend the call-site rule: `closeoutProtocol` is awaited exactly once, unwrapped, in `runPostReservation`, and no race, timer or abort token appears in that statement.
  - Require the committed return to be exactly `finalOverall: closeout.finalOverall, exitCode: closeout.exitCode`.
  - Require `runCli`'s exit code to be exactly `exitCodeForVerdict(r.finalOverall)`.

**M3 — Error-ledger sources are broader than the procedure wording, with a high chance of a live row-1 FAIL (implementation choice mirrors G1; needs an owner reading).**
- *Where:* `:8296-8297`. *Procedure:* §8 row 1 (l.397) and §9 (l.450): "required-resource failure", "non-allow-listed `console.error`", "empty allow-list by design".
- Every `requestfailed` is recorded as `required-resource-failure`, and every `console.error` is fatal. The console part is the procedure literally. The request part is broader: the procedure says *required*-resource failure, and every aborted request counts.
- G2, unlike G1, calls `viewer.hideModel(B)` (C16) and `viewer.unloadModel(B)` (C17) mid-session. The Viewer typically cancels in-flight fetches then, which Playwright reports as `requestfailed` (net::ERR_ABORTED).
- *Failure scenario:* a correct bridge run ends FAIL at row 1 because of an aborted tile request after C17.
- *Suggested disposition:* the owner or procedure defines "required resource" (for example the Viewer script, style, served `/clashpanel/**` modules, the bare page and the token endpoint) or allow-lists `ERR_ABORTED` after a harness-initiated unload/hide. Until then the implementation is fail-closed and G1-consistent. Listed again under §6-D.

### Low

**L1 — `runPostReservation` is exported and has no `LIVE_PATH_WIRED` check of its own** (`:8492`, export at `:9195`).
- The CLI path is gated in `main()`, but a programmatic caller could reach Phase 0 directly given a hand-built attempt handle.
- *Fix:* add a defence-in-depth `if (!LIVE_PATH_WIRED) throw` at its top. The mainflow tests use a mutated copy with the flag true, so they are unaffected.

**L2 — Cleanup, integrity capture and the Phase-run merge are outside a try block after consumption** (`:8724-8739`).
- A throw there rejects `runPostReservation`. `runCli` then exits 1, and the journal stays ATTEMPT_CONSUMED (reader `FAIL(crashed:ATTEMPT_CONSUMED)`), so harness and reader agree on FAIL.
- However, §4.1's best-effort `FAILED` "harness aborted on an unrecoverable internal error" is not written. The result is diagnostic only.
- *Fix:* wrap these in the same catch that appends `FAILED` best-effort.

**L3 — The reader never checks that the journal/reservation `authorization.id` equals the `authorizationId` it was asked about** (`:2456-2567`).
- A consistent pair of renamed files would be read as another ID's run.
- Not a PASS-from-garbage path (K/journal/R1–R3 must still cross-validate), but a cheap W-0 check.

**L4 — The critical-section whitelist cannot see shadowing of the free identifiers it relies on** (`performance`, `Object`, `Error`, `VERDICT_FAIL`, `computeOverall`, `preLinkGateFailure`).
- For example, a module-scope `const performance = { now: () => 0 }` would neutralise the deadline check with the AST still equal (`:1993-2009`, `:3102-3124`).
- *Fix:* assert that no top-level declaration of those names exists other than the expected ones.

**L5 — The CLI dormancy test observes only public sync/async fs calls and module resolution; there is no observer for `child_process`, `net`, `http(s)` or `fetch`** (`cli.test.mjs:43-60`).
- The claim "no git / no network" rests on the source order and on the mainflow trap deps, not on this test.
- Acceptable, but the test banner should not be read as proving no-network.

## 6. Procedure contradictions / owner decisions

Each item was verified against the code and the procedure. The label says whether a procedure amendment (or explicit owner acceptance) is needed **before any live-execution authorization**.

**A. C15(e): `inspectLedger().isolation` retained after the failed `clear()`. Genuine contradiction with production code. BLOCKING: amend before live.**
- The procedure (l.288) requires `inspectLedger().isolation` retained (`confirmed:true`) after clear #1 fails its restore.
- The production bridge's `releaseHeld()` sets `held = null` once every mesh is removed (`clashpanel/viewer/ViewerBridge.js:128`). `inspectLedger()` returns `null` whenever `held === null` (`:317-320`). The isolation session record is still kept, since `isolation.restore()` failure keeps it (`:115-117`), but it is not observable through `inspectLedger()`.
- The harness evaluates the literal clause (`acceptance.mjs:5896-5906`, `:6810`). A live C15 is therefore a certain FAIL, and overall FAIL row 3, on a correct bridge.
- Production code may not change (authorization §7). The owner must amend §C15(e): for example, evidence retention via clear #2 returning `restored` (already captured as the observation-only `retentionEvidencedByClear2Restored`, `:6818`), or via a read that exposes the session record. Otherwise the single attempt is wasted.

**B. N8 displaced-footprint discrimination under `fitToView` framing: G2 PASS is very likely unreachable. Owner decision before live.**
- C20 A1 fits the camera to `a_r` (l.330), so the outline's horizontal edges span most of the canvas width. N8(ii) shifts both footprints by ⌊W/2⌋ with wrap (l.387). Whenever an outline edge spans more than W/2, the displaced dilated footprint intersects X, which makes the result NOT_DISCRIMINATING. C20 is then NOT_EVIDENCED and the run is at best PARTIAL.
- The harness implements this literally (`:5312-5324`). Task 4 reproduced it offline with tight framing.
- The owner either accepts a structural PARTIAL ceiling or amends N8/C20 (for example a displacement defined relative to the footprint extents, or a framing margin). Table T is frozen, so this needs a new procedure version.

**C. X4 is unreachable: a prerequisite loss derives FAIL, not BLOCKED. Recommend amendment before live.**
- X4 (l.427) presumes "controls acceptable" while all dependents are BLOCKED. In reality, when B is unusable, N2–N5 and N7 cannot run. Their §7 states are NOT_EXECUTABLE, which is non-acceptable (l.389). N2 has **no** NOT_EXECUTABLE state at all, so it is out of enum and therefore non-acceptable. Row 4 matches before row 6.
- The same applies to any post-consumption infrastructure failure (Task 5: a phase-run failure gives row 4).
- `controlDisposition` (`:1279-1287`) is a faithful literal reading. The effect is fail-safe, but it contradicts §3 (l.53) and C1 (l.241), which intend BLOCKED for a fixture or prerequisite loss. It also mislabels an environment failure as a harness or bridge FAIL.
- Amendment: make NOT_EXECUTABLE (and N2's equivalent) a row-6 disposition when its enabling check is BLOCKED(prerequisite or dependency).

**D. Error-ledger breadth (M3): the empty `console.error` allow-list and "required-resource failure". Owner reading before live.**
- The empty allow-list is the procedure's own text. Known Viewer console noise, or aborted requests after C16/C17, would FAIL the run at row 1.
- The owner should either define the required-resource set and an `ERR_ABORTED` rule, or accept the risk explicitly.

**E. C20 reasons `n8-not-discriminating` / `n8-not-detected` (`:5077-5081`, `:5387`). Editorial; non-blocking.**
- The §C20 reason list (l.344) has no code for "R7 false". The verdict is unaffected: C20 is NOT_EVIDENCED either way, and N8 NOT_DETECTED already gives row 4.
- Accept the two extra codes, or add them to the list at the next version.

**F. C13 executed with P8 (`:6135-6146`). Editorial; non-blocking.**
- §5 places C13 in P7 (l.231), but C13's expected table needs the C15(b)/(c)/(e) outcomes from P8 (l.284). Deferral is the only executable reading.

**G. Unparseable-journal label. Editorial; non-blocking.**
- §4.1 (l.91) names it `CRASHED(unreadable-journal)`; §8 W-0 (l.410) names it `FAIL(reader-invalid)`. The reader uses the W-0 label and keeps the class in `detail.journalClass` (`:2436-2440`, `:2485`).
- Similarly, a reservation/journal binding mismatch is labelled W-0 rather than W-5. Both are FAIL in every case.

**H. T13 Soft count. Editorial; non-blocking.**
- The text "2 spheres + 1 line + 1 outline per live side" is ambiguous. The code (Soft two sides = 5) matches `markers.js` (one `addLocation` per present, one outline per live side), and T13 is CD from `markers.js`. No contradiction; clarify the wording.

**I. Not a contradiction, noted.**
- The §9.1 verification-read repeat ("may be repeated once") is deliberately not used. This is stricter and acceptable.
- The model-B URN is derived, not quoted (Task 1 item 8). The D1 operator cross-check stays mandatory before any record is issued.

Summary for the owner: **A must be amended** (otherwise a certain FAIL). **B, C and D need an explicit decision** (amend, or accept a PARTIAL ceiling, FAIL-for-BLOCKED and noise risk). **E–I are editorial.**

## 7. Remaining verification gaps (live-only)

These cannot be closed offline. The harness marks them pending live execution or UNVERIFIED-LIVE and fails closed.

1. The real `fs.linkSync` / `rename` atomicity and the "error ⇒ no effect" assumption on the operator's filesystem (the accepted D2 assumption). K durability exists only after the step-9 directory fsync; no power-loss claim is made.
2. Every page-side collector against the real Viewer 7.124.2: load starters (`keepCurrentModels:true`), readiness events, the C1 classifier signals, the tree walk and fragment-list `getWorldBounds`, camera matrices after `updateMatrixWorld(true)`, and the N2 home reset via `getState`/`restoreState(…, true)` (no repo precedent).
3. Real DockingPanel C2/C3 behaviour: prototype spies, title-bar discovery, close-button routing (observation only), and the residue inventory.
4. C20: the PNG decode path's byte stability (createImageBitmap → canvas → getImageData), 2-rAF frame stability, and whether N8 can discriminate at all under fit framing (§6-B).
5. C15 failure injection on the real Viewer (D4). It stays dormant until live authorization and must be exercised exactly as specified.
6. The error-ledger noise profile of a real session (console.error, requestfailed, WebGL context) (§6-D).
7. Whether the spy and injection wrappers compose with the Viewer's own internal callers (origin attribution of `viewer-internal` calls; C19 unattributed calls).
8. The Phase-0 clean-tree precondition. It requires the harness, tests and prompt to be **committed** (procedure §11 step 2b) and `LIVE_PATH_WIRED` flipped. That flip changes the harness SHA-256, so it must precede authorization-record issuance and be independently reviewed.

## 8. Recommendation

- Fix H1 and H2 inside the harness, with offline tests for each. H1 touches D2 closeout inputs, so it needs independent Work review.
- Optionally address M1 and M2 (guard hardening) and L1–L4.
- Then submit for independent ChatGPT Work review.
- Live authorization must not be considered until the owner has resolved §6-A, and has decided §6-B, §6-C and §6-D.
- No live G2 execution, no failure injection, no commit and no push occurred during this review.

## 9. Post-review fixes (H1, H2 only)

Scope: only H1 and H2 were fixed. M1–M3, L1–L5 and the §6 items are left for the controller/owner to disposition. The changes are harness-only (`test/acceptance/clashpanel-viewerbridge.acceptance.mjs` plus sibling tests). The `commitCriticalSection` gate→`linkSync` block and `preLinkGateFailure` are unchanged, and the critical-section static audit stays green. Nothing was committed or run live.

**H1: fixed.** Once T9 is armed, an overdue T9 can no longer commit PASS.
- `acceptance.mjs:8753-8756`: new `recordT9IfOverdue()` in `runPostReservation`. If T9 is armed, has not dispatched, and `clock.monotonicMs() >= deadlineAbs`, it calls `sink.recordAttemptDeadline()` directly (no page RPC, because cleanup already closed the page). It is called synchronously just before `closeoutProtocol(...)`, and there is no `await` before step 1. Step 1's `primaryOverall` is therefore row 5 `ATTEMPT_DEADLINE`.
- `acceptance.mjs:8768`: the `disarmAttemptTimer` hook calls it again if the disarm instant is at or past `deadlineAbs`. A cap that elapses between the pre-check and step 1 shows up in the pre-link `computeOverall`, and the gate reports `late-verdict-change(verdict-changed)`.
- `acceptance.mjs:8769`: `quiescence.deadlines()` now always returns `{name:'T9:attempt', deadlineAbs, completedMs: t9DisarmedAt}` once T9 is armed. The old condition `t9DisarmedAt < deadlineAbs` is removed. The step-8 gate's own `deadlineAbs` re-check (procedure §9.1 step 7(i)/8(a)) therefore always sees T9.
- Behaviour note: this follows the procedure literally ("every deadline the harness armed … T9"). The T9 entry is handed to the gate even when the T9 callback did dispatch, so the gate flags any T9 whose disarm came at or after `deadlineAbs` as `late-verdict-change(deadline-overdue)`. Such a run ends FAIL through the closeout-failure path (F, journal FAILED, reader FAIL), not through a committed K. With the live `performance.now()` clock this covers every row-5 run. The existing fired-timer test still commits FAIL row 5 through K only because its fake timer fires long before the real `deadlineAbs`. Either way the result is FAIL; it never becomes PASS.
- Tests (`mainflow.test.mjs:520-554`, both failed before the fix and pass now):
  - the T9 timer never dispatches and the clock jumps past the cap ⇒ `attemptDeadlineExpired`, `primaryRow` 5, FAIL, exit 1, reader FAIL;
  - T9's `deadlineAbs` is already in the `performance.now()` past ⇒ `committed:false`, cause `late-verdict-change(deadline-overdue)`, FAIL, reader FAIL.
- **Because H1 changes a D2/closeout input (the quiescence deadlines handed to the step-8 gate, and the row-5 ledger state before step 1), it requires independent ChatGPT Work review. This fix does not authorize live execution by itself.**

**H2: fixed.** Oversized C20 evidence no longer turns N8 into NOT_DETECTED.
- `acceptance.mjs:5290-5296` (`overlayRenderingOracle`): R2 (`no-change-observed`) is now evaluated **before** the 1 MiB run-length cap. The cap (`evidence-too-large`) then applies only to an evaluation that observed a change, and R3–R6 keep their order after it. When the lists are oversized, the no-change result also drops them (`changedRle`/`clearRle: null`), so R1 stays bounded. The doc comment at `:5247-5249` now gives the new order.
- Effect: N8(i)'s null-change input keeps the real `F_clear`, and now yields exactly `NOT_EVIDENCED(no-change-observed)`. When C20 is only `NOT_EVIDENCED(evidence-too-large)`, N8 no longer becomes NOT_DETECTED (§8 row 4), so C20 stays NOT_EVIDENCED and the run ends PARTIAL at best. Side effect: a real no-change run with an oversized post-clear list now reports `no-change-observed` instead of `evidence-too-large`. Both are NOT_EVIDENCED, and both reasons are in the §C20 list.
- Test (`c20.test.mjs:140`, failed before the fix and passes now): 1024×1024 frames with an alternating post-clear difference of about 524k runs ⇒ real `evidence-too-large`, N8 null-change `no-change-observed`, N8 ≠ NOT_DETECTED, and `evaluateC20` gives `NOT_EVIDENCED(evidence-too-large)`.

**Verification after fixes:** `node --test test/acceptance/clashpanel-viewerbridge.acceptance.*.test.mjs` ⇒ 361 tests, 361 pass, 0 fail. `node scripts/run-tests.mjs` ⇒ 4607 tests, 4606 pass, 0 fail, 1 todo.
