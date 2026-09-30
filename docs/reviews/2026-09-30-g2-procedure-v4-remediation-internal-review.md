# G2 procedure v4 — targeted remediation internal review (Codex advisor, `high`)

- **Date:** 2026-09-30
- **Artifact:** `docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md` (Procedure-Version v4, 546 lines; design only — no harness code, no live run). Line numbers below refer to this file as reviewed (uncommitted working tree).
- **Authorization:** `docs/prompts/for-claude-g2-procedure-remediation-v4-bounded.md` (H1, H2a, H2b, M1, L1; documentation only).
- **Governing input:** `docs/reviews/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure-v3-bounded-independent-rereview.md` (0C/3H/1M/1L).
- **Method:** one Codex advisor consult, request `20260930-152213-94561-6286`, effort `high`, read-only, scoped to five areas (H1 first-creation durability; H2a acyclic closeout; H2b ambiguous `COMPLETED`; M1 Table T2 vs C4/T15; L1 N6 boundary coverage) plus stale-reference/contradiction grep. The reviewer of record read the whole artifact; I had read it in full before the consult. **Every Codex claim was re-verified against the document text by me; severities were adjudicated independently** (one downgrade, one merge, one extension, and one Codex non-finding I had also examined and confirmed clean). No repetition/C20/C7/C18/C4-relation/C17/cleanup/C2/D3/D5/D6 re-review. This pass did not edit the procedure and nothing was committed.
- **Result:** **0 Critical / 2 High / 3 Medium / 6 Low.** v4 fixes H1 and H2a as specified and closes the ambiguous-`COMPLETED` path (H2b) except for the K-ambiguity residual, but two High defects remain in the newly added L1 boundary tests and in reader totality. Not ready for independent-gate acceptance until F1 and F2 are corrected.

## Findings

### F1 — High — L1: the N6 mutated box `b'` can leave the C4 domain, so the required boundary cases have an unattainable/vacuous expected outcome
- **Location:** §7 N6 row (line 371: guarantee, "Domain and float64 soundness", boundary cases (1)–(4), "Never-silent-success rule"); §6 C4 outcome clauses (line 237); T21 row (line 177: "N6 `NOT_DETECTED` if the oracle does not return FAIL"); §4.2 boundary list (line 125).
- **Failure mode (verified by construction):** the N6 domain is `|v| ≤ 2^900` for the *original* `b`, `r`, but the whole-interval translation `Δ = (rMax_x − D) − bMax_x` moves `bMin'_x` by up to `|bMin_x|+|bMax_x|+|rMax_x|+D` (the proof itself states this bound). Example: `M = 2^900`, `b = [−M, M]`, `r = [−M, −M]` (a valid `contained` pair) gives `bMax'_x = −M−D`, `bMin'_x = −3M−D`; even the explicitly required zero-width extreme case `b = r = [−M, −M]` becomes `[−M−D, −M−D]`. Both exceed `2^900`. The mutated box is then itself in the C4 `FAIL(out-of-range)` set, while the text requires the oracle to return `FAIL(not-contained)` for it (guarantee paragraph) and lists exactly these extreme coordinates as "in-domain, testable". C4's clauses are stated as independent "iff" conditions with only `FAIL(non-finite)` explicitly ordered first (line 237); the relative precedence of `out-of-range` vs `not-contained` is undefined, and `d`/`S_a` arithmetic for float64-max-scale inputs may overflow before either label is chosen. Consequences: either the oracle returns `FAIL(out-of-range)` and the mandatory sub-case (ii) is unattainable (test fails), or T21's wording ("does not return FAIL") lets an out-of-range mutated box count as N6 `DETECTED` — exactly the "invalid input yields N6 evidence" outcome L1 forbade. Live runs are unaffected (float32 bounds `≤ 2^128`), so this is an offline/defect-trap correctness defect. Secondary: "any of the 8 coordinates" (N6 case (1) and (3)) does not match two 6-value boxes (12 slots) or the 4 x-values N6 uses.
- **Minimum fix:** (a) state the C4 clause precedence: non-finite/inverted → out-of-range → containment (and require the range check before any `d`/`S_a` arithmetic); (b) require T21/N6 sub-case (ii) to accept only the exact label `FAIL(not-contained)`, and require the mutation builder to validate that every coordinate of `b'` is finite and `|v| ≤ 2^900`, returning `REJECTED_OUT_OF_RANGE`/no mutated box otherwise; (c) either narrow the N6 *input* domain so `b'` provably stays in range (e.g. `|v| ≤ 2^897`, since `|bMin'| ≤ 3·2^k + D`) or add an explicit expected outcome (`REJECTED_OUT_OF_RANGE`, never `DETECTED`) for cutoff-adjacent inputs whose `b'` leaves range; keep the `±2^900` cases as *C4-oracle-only* tests where they no longer route through N6; (d) replace "8 coordinates" by the exact coordinate set (all 12 box coordinates for rejection cases; the 4 x-values for the mutation cases).
- **Classification:** design/spec correctness blocker (documentation-only fix).

### F2 — High — H2b: the authoritative reader function is not total, and accepts an unvalidated history
- **Location:** §8 reader table W-1…W-6 (lines 392–401); §4.1 state table (lines 84–91) and CRASHED row (line 91); W-5 (line 400).
- **Failure mode (verified):** (1) `PREFLIGHT_FAILED` is a valid harness-written terminal state (line 86) but no reader rule maps it: W-2 is `FAILED` only; W-4 lists `ATTEMPT_CONSUMED` and `CRASHED(...)` classes, and `CRASHED(PREFLIGHT_FAILED-unterminated)` is defined for last state `AUTH_BOUND`, not for a written `PREFLIGHT_FAILED`. With no matching witness, "return the worst valid outcome" is a fold over an empty set; an implementation whose neutral element is the best outcome returns PASS for a preflight-failed record. (2) W-5 checks only "exactly one `ATTEMPT_CONSUMED` and one `CLOSEOUT_STARTED` precede `COMPLETED`"; it does not require the whole history to be a legal path of the §4.1 state machine, so an illegal history such as `AUTH_BOUND → PREFLIGHT_FAILED → ATTEMPT_CONSUMED → CLOSEOUT_STARTED → COMPLETED` with valid hashes and a matching K reaches W-6. (Not producible by a crash or by a correct harness; it is a totality/defense-in-depth gap in the pure reader, which is specified to be the authority.)
- **Minimum fix:** add a highest-precedence reader rule "unknown state, illegal transition order, schema/binding invalid, empty history, or any input not mapped by a rule ⇒ `FAIL(reader-invalid:<reason>)`"; add explicit rows for journal last state `PREFLIGHT_FAILED` ⇒ `FAIL(preflight-failed)` (attempt not consumed, record spent) and for last state `AUTH_BOUND` ⇒ `FAIL(crashed:AUTH_BOUND)`; require full state-machine path validation as a precondition of W-6; add these to the §4.2 reader-precedence matrix.
- **Classification:** design/spec correctness blocker.

### F3 — Medium — H2b: the declared K-ambiguity double-fault residual is not honestly bounded as written
- **Location:** §9.1 step 8–9 and residual (lines 465–466, 479, 482); §8 (line 392: stdout/exit code "never consulted"; line 403).
- **Verified facts:** the `COMPLETED`-ambiguity path itself is closed: `COMPLETED` alone never yields PASS (K absent ⇒ W-5), and F precedes the `FAILED` supersession. The remaining hole is one level up: if K possibly landed (write/verify ambiguous) and both F and the `FAILED` supersession fail to write, the surviving J+K chain derives `finalOverall` (W-6) although the harness printed FAIL. Any local multi-file commit protocol has such a last-write ambiguity; it cannot be eliminated, only bounded. The bounding text is defective: (i) "three independent storage faults" is overstated — an `ENOSPC`, `EIO` or read-only-remount fault is persistent and correlates K verification, F and the journal replacement; (ii) the mitigation ("a run whose harness output or operator log (O1) records a non-PASS ... is treated as FAIL") depends on stdout/O1, which §8 says are never authoritative and §9.1 says are optional (O1 is operator-side and not written by the harness).
- **Minimum fix:** keep the residual, but (a) drop "independent" and describe the fault class as persistent/correlated storage failure; (b) state that the reviewer/operator rule is an out-of-band compensating control that is *not* part of `deriveVerdictFromArtifacts` and depends on the operator retaining stdout (make retention of the harness's stdout an operator precondition, not the optional O1); (c) record the residual explicitly for owner acceptance under D2 (the alternative — declare a fully valid J+K chain authoritative success even after an ambiguous writer return — is a semantic decision for the owner); optionally pre-write and fsync the `FAILED` replacement journal *before* attempting K so the supersession needs only a `rename` (no allocation), which removes the `ENOSPC` correlation.
- **Note on severity:** Codex rated this High as "ambiguity can become PASS". I downgraded to Medium: the residual is declared, requires a K-landing ambiguity plus two further write failures, and cannot be removed by protocol design; the defect is the dishonest bounding language, not an undeclared path.
- **Classification:** product/integration decision (D2 acceptance of the residual) with a spec wording correction.

### F4 — Medium — H1: `CRASHED` class overlap between `reservation-only` and `unreadable-journal`
- **Location:** §4.1 CRASHED row (line 91); crash matrix (lines 102–105); startup rule (line 111); W-4 (line 399).
- **Failure mode (verified):** `CRASHED(reservation-only)` is defined to include a reservation with a journal that is "absent, an orphan temp, or unparseable" and is described as "a preflight crash: not consumed", while `CRASHED(unreadable-journal)` is "treated as consumed-unknown". A reservation plus an unparseable *final* journal satisfies both. The journal is only ever installed by atomic rename after `fsync`, so an unparseable final journal is storage damage, not a normal preflight crash, and calling it "not consumed / no G2 run exists" (W-4) could misstate a consumed attempt. Both classes refuse reuse and derive FAIL, so there is **no silent-reuse path**; only the consumed-status claim and reviewer classification are indeterminate.
- **Minimum fix:** define precedence: a *final* `<Authorization-ID>.journal.json` that exists but is unparseable ⇒ always `CRASHED(unreadable-journal)` (consumed-unknown); `CRASHED(reservation-only)` applies only when no final journal exists (absent, or only an orphan temp). Align the startup refusal reasons and the crash-matrix rows.
- **Classification:** design/spec correctness (non-blocking on its own; fix with F1/F2).

### F5 — Medium — M1: the `2^900` cutoff drives `FAIL(out-of-range)` but has no class or table row; E3/T10 mapping is inconsistent
- **Location:** §6 C4 (line 237); §4.7 rules (b)/(c) (lines 151–152); consistency table C4 row (line 187) and N6 row (line 188: "not a separate table row"); T10 row (line 166: "E1/E3").
- **Failure mode (verified):** M1's requirement was that every allowance/threshold carries a class. `FAIL(out-of-range)` compares an input to `2^900`, yet no row states its class, while the C4 consistency row asserts the other C4 FAIL labels "use no CA value" without classifying `2^900`. The cutoff is a proof-soundness bound (mathematical, not runtime- or calibration-derived) but it is also a FAIL trigger on live data, so it should be classified. Separately, rule (c) E3 names "T10, T12" as the sample/count observation set for a FAIL and T10 says "E1/E3", but the C4 consistency row lists only E1, so the table cannot mechanically say whether T10 is an accepted CA-selected FAIL observation set.
- **Verified clean:** rules (a)–(d) are scoped correctly; every named exception E1–E5 matches the check text (C4 `FAIL(not-contained)` vs `T_a`; C6/C8 `ε`/T4/T11; C3/C7 rep counts; T6 absent-event FAIL in C16/C17 V1/V2; T9/T1/T8 hard-deadline FAILs, with T2–T5/T7 ⇒ `BLOCKED` all confirmed against their rows); T15/C4 semantics are unchanged; every T1–T23 row carries a class, mixed rows (T15, T19, T21) list per-part classes; N8 `NOT_DETECTED` ⇒ FAIL is consistent with rule (a) (N8(i) fails on `|X| ≥ 1`, a CD count; N8(ii) is applicable only when no pixel of `X` is in the displaced dilated footprints, so the oracle cannot return PASS except through a harness defect).
- **Minimum fix:** add a row (e.g. T24) `out-of-range cutoff = 2^900`, class CD (mathematical proof-soundness bound; consumers C4, N6), stating it is never reachable by float32 Viewer bounds (`≤ 2^128`); add E3 to the C4 consistency row (or remove T10 from E3).
- **Classification:** verification/calibration gate (table completeness), documentation-only.

### F6 — Low — stale/ambiguous version and naming references
- **Location:** line 150 ("no `FAIL` outcome in v3"), line 328 ("not part of v3"), **line 527 (D7 recommendation: "Freeze Table T2 on acceptance of v3")**; line 419 (X11 "`closeoutFailures[]` both retained" — the durable record is `F.causes[]`/`FAILED.causes[]`); §4.7 title/lines 146, 202, 527 (the *table version* "T2" collides with *row* T2 = `loadDocumentNode` budget in "T2 is unchanged in every value" and the consistency table).
- **Minimum fix:** line 527 ⇒ "on acceptance of v4"; keep "since v3" only as provenance and change "not part of v3" ⇒ "not part of this procedure"; X11 ⇒ `causes[]`; rename the table version "Table T (rev 2)" or the row references "row T2".
- No `requiredArtifacts`, closeout "addendum", `R1 and R2` or `X1–X14` reference remains (grep verified; X-examples run X1–X17).

### F7 — Low — R1 and journal fields that could carry future facts, and reader cross-checks
- **Location:** §10 top-level keys (line 503: `attempt.journalStates[]`, `finishedAt`); §4.1 `COMPLETED` row (line 89: `finalOverall`) and K schema (line 450); W-5 (line 400).
- **Issue:** R1 is acyclic only if `attempt.journalStates[]` ends at `CLOSEOUT_STARTED` and `finishedAt` means the pre-closeout payload cutoff (the text does not say so; an implementer could record `COMPLETED` or the process end time). `COMPLETED.finalOverall` is written before K is verified, so it is a claim about a not-yet-established final state (the reader gates it behind K, so it is not a PASS path). W-5 checks the hash chain but not that `R1.attempt.attemptId`, `R3.attemptId` and `K.attemptId` all equal the journal's.
- **Minimum fix:** define both R1 fields as pre-closeout facts; rename `COMPLETED.finalOverall` ⇒ `claimedFinalOverall` (or keep and note "provisional until K"); add the three `attemptId` equalities to W-5.

### F8 — Low — R1–R3 use fixed, non-per-authorization names
- **Location:** §9.1 artifact table (lines 446–448), §10 (line 501).
- **Issue:** `clashpanel-viewerbridge-g2-{result,summary,closeout}` are written by temp+rename with no `Authorization-ID` in the name, so a later authorized attempt overwrites an earlier attempt's git-ignored R1–R3, and a reader run on the working tree for the earlier authorization then sees hash mismatches (`FAIL(completed-unverified)` — fail-safe direction). Committed evidence copies (§10) mitigate this; there is no PASS risk.
- **Minimum fix:** key R1–R3 by `Authorization-ID` (or refuse to start when any exists).

### F9 — Low — §4.5 "Two timeouts are FAIL" vs E5
- **Location:** §4.5 (line 137) vs rule (c) E5 (line 152) and T1/T8 rows (lines 157, 164).
- **Issue:** §4.5 says exactly two timeouts are FAIL (spec-event absence, whole-attempt cap), while E5 and T1 (Phase-0 step ⇒ Phase-0 `FAIL`) and T8 (cleanup deadline ⇒ FAIL via unresolved ownership, row 2) also end in FAIL. §4.5 is scoped to in-check operation timeouts, but does not say so.
- **Minimum fix:** ⇒ "Two *check-time* timeouts are FAIL … Phase-0 (T1) and cleanup (T8, via row 2) failures are governed by their own rows and E5."

### F10 — Low — H1 wording/test-list precision
- **Location:** line 85 vs line 93 (AUTH_BOUND "established the instant the reservation is durable" vs "the reservation boundary is the completed durable write of `AUTH_BOUND`"); §4.2 fake-filesystem order test (line 125).
- **Issue:** two different definitions of the reservation boundary; the required order test names only the `D2` chain (`mkdir(D2) → fsync(D2) → fsync(D1)`), not the `D1` chain (`mkdir(D1) → fsync(D1) → fsync(D0)`), although W2a and the crash-test sentence cover both.
- **Minimum fix:** define "reservation boundary = reservation durable (its `fsync` pair complete)" and "`AUTH_BOUND` = journal durable"; extend the order test to both directories.

## Per-area closure table

| # | Area | Result | Basis / remaining |
|---|---|---|---|
| 1 | H1 first-creation attempts-dir durability | **Closed technically** (F4, F10 wording only) | W2a: for `D1` then `D2` — `mkdir` if absent, `fsync(Di)`, then **unconditional** `fsync(parent)` (covers a directory created by an earlier dying process); W2b only after W2a fully succeeded; `wx` reservation, `fsync(fd)`, `fsync(D2Fd)`, journal via temp+rename+`fsync`. Every W2a/W2b failure ⇒ exit 1, no external effect. Crash matrix rows are complete and consistent with the durable-before-effect invariant: the only lossy OS-crash window is one in which nothing external and nothing consumed had happened; every state after any external effect is durable together with the directory entries leading to it. No silent-reuse window found. F4 overlap and F10 wording remain. |
| 2 | H2a acyclic R1/R2/R3 | **Closed** (F7, F8 Low) | Graph `state→R1`, `state→R2`, `{R1,R2}→R3`, `{R1,R2,R3}→J`, `J→K`; `CLOSEOUT_STARTED` and `F` depend on state only. No artifact holds its own digest; every hash recomputable from file bytes; R3 written only after both verifications so it has no failure field; §10 R1 is payload-only (`closeout:{phase:'payload',…}`), no leftover `requiredArtifacts`/R1-embedded `closeoutFailures` (row 8 and step 11 use `closeoutFailures` only as harness in-memory state). Field-definition wording (F7) and fixed filenames (F8) remain. |
| 3 | H2b ambiguous `COMPLETED` | **Not closed — F2 (High), F3 (Medium)** | Ambiguous `COMPLETED`: closed — `CLOSEOUT_STARTED` is the durable fail-safe witness, `COMPLETED` alone never PASS, K only after verified `COMPLETED`, F then `FAILED` supersession, `K.journalSha256` makes a superseded journal self-invalidating; X9–X17 and the closeout crash matrix agree with W-1…W-6 and with §4.1/§10. Open: reader totality and history validation (F2); honest bounding of the K-ambiguity double-fault residual (F3). |
| 4 | M1 Table T2 vs C4/T15 | **Closed except F5 (Medium)** | Rule (a) scoped to C20/N8; rule (b) precedence; E1–E5 verified against check text; T15/C4 unchanged; class column complete for T1–T23; consistency table accurate except for the unclassified `2^900` cutoff and the E3/T10 mapping. F6/F9 wording. |
| 5 | L1 N6 boundary coverage | **Not closed — F1 (High)** | The case list and rejection labels are present (`REJECTED_OUT_OF_RANGE` vs `REJECTED_NON_FINITE`, `FAIL(out-of-range)` vs `FAIL(non-finite)`, no mutated box for rejected inputs, never-silent-success rule), and ±Infinity/NaN/inverted-box/just-out-of-range are correctly specified. The cutoff-adjacent *in-range* cases are internally contradictory (translated `b'` leaves the domain; oracle clause precedence undefined). |

## Disposition of remaining concerns

| # | Concern | Class |
|---|---|---|
| F1 | N6 `b'` domain escape / clause precedence | design/spec correctness blocker |
| F2 | reader totality, illegal-history acceptance | design/spec correctness blocker |
| F3 | K-ambiguity residual wording; whether to accept it | product/integration decision (D2) + wording |
| F4 | `CRASHED` class overlap | design/spec correctness (fix with F1/F2) |
| F5 | `2^900` classification; E3/T10 | verification/calibration gate (table completeness) |
| F6, F9, F10 | stale/naming/wording | deferred/non-goal (fix in the same documentation revision) |
| F7 | R1/journal field definitions; W-5 attemptId cross-checks | implementation-plan requirement |
| F8 | fixed R1–R3 filenames | implementation-plan requirement |

## Confirmations

No procedure edit, harness or production code, live run, Playwright/Chromium/Viewer session, G3/H1/H2/OQ-1/host work, Core/Adapter/M4/Panel/`server.js` change, or G1-F7 probe/calibration occurred in this review. Nothing was committed or pushed. The Codex consult answered (`response.md` present); both backgrounded tasks (the consult and its response poller) had already exited, so no task remained to stop. Internal review is a convergence aid, not an independent gate; recommend one further bounded look at only F1, F2, F3 after remediation.

## Post-review disposition (lead, same day)

Applied to the procedure after this review (bounded; no new full review run):

| Finding | Disposition |
|---|---|
| F1 High | Fixed. C4 clause precedence stated (non-finite → out-of-range → no-bounds → containment; range checks on all twelve coordinates before arithmetic). N6 construction domain narrowed to `\|v\| ≤ 2^897` (T24) so `b'` stays inside C4's `2^900` range; builder now returns `MUTATED` / `REJECTED_NON_FINITE` / `REJECTED_OUT_OF_RANGE` / `REJECTED_OUT_OF_N6_DOMAIN`; oracle must return exactly `FAIL(not-contained)` on `b'`; boundary set, §4.2 list and T21 updated. |
| F2 High | Fixed. Reader rule W-0 totality (unknown/illegal/unmapped ⇒ `FAIL(reader-invalid)`); W-4 now names `AUTH_BOUND`/`PREFLIGHT_FAILED`; W-5 requires the exact four-transition history and attemptId cross-checks. |
| F3 Medium | Residual reworded (correlated faults; not eliminable), reviewer rule scoped as procedural, added to D2 as an owner acceptance item. |
| F4 Medium | Fixed: unreadable final journal ⇒ `CRASHED(unreadable-journal)`; `reservation-only` only when no final journal exists. |
| F5 Medium | Fixed: T24 row (CD) added; C4 consistency row cites T24 and E3. |
| F6, F9, F10 Low | Fixed (v4 references, X11 wording, §4.5 timeout list, D1+D2 order test). |
| F7, F8 Low | Deferred to harness-implementation plan (R1 pre-closeout field list; per-authorization result filenames). |

Not re-reviewed: the remediation of F1/F2/F3 is recommended for the bounded independent Work re-review rather than another internal round (CLAUDE.md review boundary).
