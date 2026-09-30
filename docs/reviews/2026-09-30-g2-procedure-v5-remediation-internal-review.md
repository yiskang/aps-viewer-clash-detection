# G2 procedure v5 — targeted remediation internal review (Codex advisor, `high`)

- **Date:** 2026-09-30
- **Artifact:** `docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md` (Procedure-Version v5, 567 lines; design only — no harness code, no live run). Line numbers refer to this file as reviewed (uncommitted working tree).
- **Authorization:** `docs/prompts/for-claude-g2-procedure-remediation-v5-bounded.md`.
- **Governing input:** `docs/reviews/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure-v4-bounded-independent-rereview.md` (0C/1H/1M/3L).
- **Method:** one Codex advisor consult, request `20260930-170432-93628-5345`, effort `high`, read-only, scoped to the five areas (terminal-commit protocol/reader agreement; N6 `2^897` + T24; R1 payload cutoff; B1–B8 boundary terms; stale naming). I read the whole artifact and the governing inputs first, ran the stale-name greps myself, and **re-verified every Codex claim against the document text**; severities were adjudicated independently (one downgrade, two independently found extensions). Only the five areas were reviewed. The procedure was not edited; nothing was committed. The response file was present; the consult and its poller had already exited, so no task needed stopping.
- **Result:** **0 Critical / 2 High / 3 Medium / 4 Low** (after adjudication; Codex proposed 3 High). v5's single-record K design is structurally sound (no COMPLETED state, acyclic graph, K only by `link(Kc,K)`, ambiguity before `link()` derives FAIL). But the post-`link()` and pre-`link()` edges still allow harness/reader disagreement, so the required invariant is not yet fully met. N6/T24 is closed.

## Findings

### F1 — High — leftover/duplicate commit-file and `.invalid`-rename rules contradict "K wins after `link()`"
- **Location:** W-0 (line 410, "malformed, duplicated or conflicting commit record"); truth-table row 7 (line 498, "second commit file") vs rows 9 and 11 (lines 500, 502) and W-3 (line 413); step 9 (line 484); Partial-artifact handling (line 506, "a final-named file that fails verification is renamed best-effort to `.invalid-<uuid>`").
- **Failure mode (verified):** `link(Kc,K)` leaves K and Kc as two names for one inode until step 9's `unlink(Kc)`. A process crash in that window (row 9), or an `unlink` fault (row 11), leaves K plus a `*.commit.candidate-*` file. Rows 9/11 say the reader returns `K.finalOverall`; W-0/row 7 can be read as "second commit file / duplicated commit record ⇒ `FAIL(reader-invalid)`". Two readings give opposite verdicts on the same durable set while the harness (row 11) reports PASS. Separately, the generic rule at line 506 read literally applies to K: a post-commit read-back fault (step 9, "informational") could rename K to `.invalid-<uuid>`, after which the reader returns FAIL(commit-missing) although the harness reported PASS. The reader's input namespace (which file names count as "commit records", whether `*.invalid-*`/candidates/temps are ignored) is never defined.
- **Minimum fix:** define the reader's input namespace exactly: the only commit record is the exact name `<Authorization-ID>.commit.json`; `*.commit.candidate-*`, `*.tmp-*`, `*.invalid-*` are ignored once a valid K exists (and never authoritative otherwise); replace "second commit file" accordingly; exempt K (and post-commit steps) from the `.invalid` rename rule; add "crash between `link()` and `unlink(Kc)`" (K + Kc both present ⇒ `K.finalOverall`) to the §4.2 closeout matrix.
- **Also (same location group):** line 418 says exit 1 for "any throw"; step 9 says post-commit faults never change the exit code. Require every post-commit operation to be individually caught and the exit code to derive solely from the committed `K.finalOverall`.
- **Classification:** design/spec correctness blocker (documentation-only fix). Codex: High (agreed).

### F2 — High — `primaryOverall` is computed once (step 1); verdict-bearing events between step 1 and `link()` are not required to invalidate it
- **Location:** §8 line 393 (`primaryOverall` evaluated after cleanup); §9.1 steps 1–8 (lines 476–483); row 5 (line 401, final phase lists only closeout write/verification failures); T9 (line 178, whole-attempt cap 20 min after `ATTEMPT_CONSUMED`); error ledger (line 448); W-5 (line 415).
- **Failure mode (verified):** nothing states that the T9 deadline timer, the Node `unhandledRejection`/error-ledger handlers or late stale-continuation completions are disarmed or frozen at step 1. A T9 expiry or an unhandled rejection during steps 2–7 is a harness-detected fatal fact, but neither row 5 (final) nor any step turns it into a closeout failure; R1 (frozen at step 4) may or may not contain it, K commits the step-1 `primaryOverall` (possibly PASS), and W-5 only compares recorded values, it never recomputes the verdict. This is exactly "a later harness-detected ambiguity that requires FAIL" after which a PASS record can still be created.
- **Minimum fix:** at step 1 quiesce verdict-bearing asynchronous sources (disarm T9 or state it does not cover closeout; latch the error ledger; stale continuations already quarantined); add a pre-`link()` gate at step 7/8: if any latched fatal/deadline fact exists that is absent from `primaryOverall`, it is a closeout failure (`late-fatal`) and no `link()` is attempted. Post-commit events are informational only. Add to the closeout matrix.
- **Classification:** design/spec correctness blocker. Codex: High (agreed; I had independently found it).

### F3 — Medium (Codex: High) — B8 is atomic-visible, not durable; harness may exit 0 while durability is unconfirmed
- **Location:** B8 (line 104); step 8 (line 483); step 9 (line 484, `COMMIT_DURABILITY_UNCONFIRMED`); row 10 (line 501); "no residual PASS path" (line 504); §8 line 418 (exit 0 for PASS); `link` assumption (line 126).
- **Failure mode (verified):** the PASS commit point is "`link()` returned success"; the directory fsync that makes K survive an OS crash is informational (step 9). If it errors, the harness still exits 0/PASS; an OS crash then loses K and the reader returns FAIL. The document discloses this (row 10, line 504) and it is the fail-safe direction (reader FAIL, never reader PASS over harness FAIL), and there is no possibility of harness-FAIL/reader-PASS from it. But the v5 prompt's wording "durably committed" and line 504's "no residual PASS path" overclaim relative to the honest guarantee (atomic visibility + process-crash safety + normal OS crash only if fsync completed). Second, line 126's "a call that returns an error has not taken effect" is a filesystem assumption stated as fact; POSIX does not guarantee it (e.g. `EIO`/`EINTR` after the entry was created). If a `link()` error left K created, step 10 would write F (W-1 dominates ⇒ FAIL, agreement) unless F also fails — a correlated-fault residual on a non-guaranteed assumption.
- **Minimum fix (no new mechanism):** (i) reword B8/line 504 to "atomic-visible commit; durable only once step 9's directory fsync succeeds"; (ii) make a failed step-9 fsync print `PASS-UNCONFIRMED` with a distinct non-zero informational exit code or mandate the reader run before any acceptance (the reader remains the sole authority); (iii) state the `link()`-error assumption as an explicit assumption with D2 owner acceptance (optionally: on `link()` error, `lstat(K)` and, if K exists and is byte-equal to Kc, treat as committed). Redesign around a transactional primitive is **not** recommended (out of proportion for a local single-run acceptance harness).
- **Classification:** product/integration decision (D2 acceptance of the honest claim) + wording. Codex rated High; downgraded because the failure direction is fail-safe, disclosed, and never yields reader-PASS over harness-FAIL.

### F4 — Medium — R1 cutoff enforcement is not mechanically sound as written
- **Location:** §9.1 line 461 (S\* "deep-frozen"), line 471 ("`Object.freeze` applied recursively"; re-serializes S\* vs `R1bytes`); line 473 and O1 in `closeout.optional[]` (R1, line 462).
- **Failure mode (verified against JS semantics):** `Object.freeze` throws `TypeError` on a non-empty typed array (C20 retains `K0..K3` Float64 data and frame hashes) and does not prevent mutation of `Map`/`Set`/`Date`. The `snapshotEqual` check compares "S\*" with `R1bytes` although `R1bytes` is the serialization of `buildResultPayload(S*)`; S\* itself is not a payload. O1 is captured by the operator's redirect, so the harness cannot know its status at the step-4 cutoff, yet `optional[]` in R1 must record it. Cutoff event, allowed and forbidden facts, whitelist/deny-list are otherwise well defined; the ordering (`CLOSEOUT_STARTED` timestamp at step 2, O2 at step 3, freeze at step 4, `finishedAt` = freeze instant) is acyclic — no fact that cannot exist at the cutoff was found.
- **Minimum fix:** define S\* as canonical JSON-safe plain data (materialized and validated at the cutoff; typed arrays converted to plain arrays, no Map/Set/Date); compare `canonicalSerialize(buildResultPayload(S*))` to `R1bytes`; record O1 in R1 as `external/unknown` (its status appears only in reviewer evidence).
- **Classification:** implementation-plan requirement. Codex: Medium (agreed).

### F5 — Medium — reader input for "no run", and unspecified `NOT_STARTED`/empty file set
- **Location:** W-0 (line 410, "any input the function cannot classify"); §4.1 `NOT_STARTED` (line 84); reader signature line 406.
- **Failure mode:** an empty file set (`NOT_STARTED`), or a K present with no journal/reservation, is only implicitly covered by W-0's catch-all, labelled `FAIL(reader-invalid)`, which conflates "no run exists" with "reader invalid". Fail-safe (never PASS) but the truth table (lines 488–502) does not include it.
- **Minimum fix:** add one row and one W-0 example: no artifacts ⇒ `FAIL(no-run)`; K without reservation/journal ⇒ `FAIL(reader-invalid)`.
- **Classification:** design/spec wording (fix with F1). (My own finding; not raised by Codex.)

### F6 — Low — B1–B8 terminology residue and stale version labels
- **Location:** line 85 (AUTH_BOUND is "the very first durable act after record validation", but B1–B2 reservation writes precede it); line 105 (B6 "first live action" though B3 already permits CDN/token/`Initializer`/browser effects — only B6 is the first *model-load*, and B5 is consumption); line 197 ("Allowance-source consistency (v4)") and line 216 ("procedure v4"); **line 548** (D7: "Freeze Table T rev-2 on acceptance of v4" — should be v5).
- **Failure mode:** a test-plan author could assert the wrong instant for "reservation boundary"/"first live action"; the D7 freeze text names a superseded version.
- **Minimum fix:** "first durable journal transition" for AUTH_BOUND; rename B6 "first model-load (consuming) action"; change line 548 to v5 (lines 197/216 may stay as provenance, or read "v4/v5").
- **Classification:** deferred/non-goal wording. No alternative reservation/consumption-boundary definition remains elsewhere (checked §4.1 crash matrix lines 110–122, line 128, line 132, line 134, §4.2, §9.1 line 454).

### F7 — Low — truth-table redundancy
- **Location:** rows 3 and 5 (lines 494, 496) describe the same condition (candidate read fault, never linked); row 2 vs row 1.
- **Minimum fix:** merge rows 3/5. **Classification:** deferred/non-goal.

### F8 — Low — fixed R1–R3 file names (carried from v4 F8)
- **Location:** §9.1 artifact table (lines 462–464), §10. An overwrite causes a hash mismatch ⇒ FAIL (fail-safe); no PASS risk. **Classification:** implementation-plan requirement (unchanged).

### F9 — Low — Table T "unchanged" statement vs T24
- **Location:** line 216 ("Table T rev-2 is unchanged in every value") while T24 (line 193) was added in v4. No value changed; only a row was added. **Fix:** "no existing value changed; T24 added in v4". **Classification:** deferred/non-goal wording.

## Per-area closure table

| # | Area | Result | Basis / remaining |
|---|---|---|---|
| 1 | Terminal-commit protocol; reader/harness agreement | **Not closed — F1, F2 (High), F3, F5 (Medium)** | Closed: no `COMPLETED` state; graph acyclic (`state→CLOSEOUT_STARTED→S*→R1,R2→R3→Kc→K`); K only by `link(Kc,K)`; every pre-`link()` fault (Kc write/verify, `link` error, EEXIST) derives FAIL without any optional/stdout information; K attemptId mismatch, F with K, wrong journal hash, non-PASS `finalOverall` (PARTIAL/BLOCKED returned verbatim, exit 3/2) all consistent (W-1/W-5/W-6); reader precedence W-0 first, then W-1…W-6, is total apart from F5. Open: leftover-Kc / `.invalid` / post-commit throw contradiction (F1); late fatal/T9 between step 1 and `link()` (F2); durability wording and `link`-error assumption (F3); empty-set label (F5). Truth table has all required rows (R1–R3 valid no commit = 1; candidate = 2; commit write failed = 4; verification ambiguous = 3/5; valid = 6; malformed/conflicting = 7 (ambiguous, F1); crash before = 8; crash after = 9). |
| 2 | N6 `2^897` + T24 | **Closed** | One domain: T24 (line 193), N6 consistency row (line 202), C4 row (line 201), §6 C4 clause (line 251, out-of-range iff `\|v\| > 2^900`), §7 N6 (line 385) and §4.2 list (line 138) agree; `2^900` remains only as C4's distinct range cutoff, as `±2^900`/`±nextDown(2^900)` ⇒ `REJECTED_OUT_OF_N6_DOMAIN` and `±nextUp(2^900)` ⇒ `REJECTED_OUT_OF_RANGE`. Re-derived: `bMin'_x = bMin+rMax−D−bMax`, `\|bMin'_x\| ≤ 3M + D ≈ 3.008·2^897 < 2^899`; `Ms+D ≈ 4.1·2^897`; margin `dMax'−T' ≥ g·Ms > 0`. Rejected inputs never produce `MUTATED`, so never N6 `DETECTED` (line 385 never-silent-success rule). Codex found no N6 defect (F9 wording only). |
| 3 | R1 payload cutoff | **Closed except F4 (Medium)** | Cutoff event (step 4), allowed keys, forbidden keys, whitelist/deny-list, `snapshotEqual` before R3 and before Kc, `r1-mutated` failure and offline late-mutation test are defined; no circularity or non-existent-at-cutoff fact (`CLOSEOUT_STARTED` at step 2, O2 step 3, `finishedAt`= freeze instant). F4 mechanical soundness (typed arrays, S\* vs payload, O1) remains. |
| 4 | B1–B8 boundary sequence | **Closed except F6 (Low)** | One canonical table (lines 93–104), all sections cross-reference; only two wording residues (line 85, B6 name). |
| 5 | Stale naming | **Closed except line 548, F6/F9 (Low)** | Grep results below. |

## Stale-naming grep results (run by me on the artifact)

| Pattern | Hits | Verdict |
|---|---|---|
| `v3` | lines 3, 7 (link text), 106, 452 | provenance/lineage only ("v3 remediated…", "H1 of the v3 re-review"); acceptable |
| `Table T2`, `'T2'`, `version T2` | none | clean (row T2 = load deadline, line 171, is legitimate) |
| `COMPLETED` | lines 89, 410 | deliberate ("no `COMPLETED` state"; W-0 example that the state no longer exists); clean |
| `receipt` | none | clean |
| `closeoutFailures` | 404 (row 8 in-memory state), 471 (forbidden R1 key), 524 (§10 "no `closeoutFailures`") | intentional; clean |
| `requiredArtifacts` | 471 only (forbidden R1 key) | intentional; clean |
| `possibleCompleted` | none | clean |
| `W-1…W-6` / `X1–X14` | none (current forms `W-0…W-6`, `X1–X17`) | clean |
| `2^900` | lines 138, 193, 202, 251, 385 | all C4 range cutoff or explicit boundary cases; no N6-domain use |
| "v4" as *current* version | lines 197, 216, **548** | line 548 stale (F6); 197/216 provenance |

## Disposition of remaining concerns

| # | Concern | Class |
|---|---|---|
| F1 | leftover Kc / second-commit-file / `.invalid` rename / post-commit throw vs "K wins" | design/spec correctness blocker |
| F2 | late fatal/T9/unhandled-rejection between step 1 and `link()` | design/spec correctness blocker |
| F3 | atomic-visible vs durable B8; `link`-error assumption; exit code when fsync unconfirmed | product/integration decision (D2) + wording |
| F4 | S\* freezing, S\* vs payload serialization, O1 | implementation-plan requirement |
| F5 | empty file set / K without journal label | design/spec wording (fix with F1) |
| F6, F7, F9 | boundary/version/table wording; row redundancy | deferred/non-goal |
| F8 | fixed R1–R3 names | implementation-plan requirement |

## Confirmations

No procedure edit, harness or production code, live run, Playwright/Chromium/Viewer session, G3/H1/H2/OQ-1/host work, Core/Adapter/M4/Panel/`server.js` change, or G1-F7 probe/calibration occurred. Nothing committed or pushed. Codex is an internal reviewer, not an independent gate. Recommendation: one bounded remediation of F1 and F2 (and F3 wording, F5), then one bounded targeted re-check of only those areas; D2 remains not owner-ready until then.

## Post-review disposition (lead, same day)

Applied to the procedure after this review (bounded; no further internal round — the fixes go to the independent re-review):

| Finding | Disposition |
|---|---|
| F1 High | Fixed. Reader file namespace defined in W-0 (only exact names; `*.commit.candidate-*`, `*.tmp-*`, `*.invalid-*` ignored, so a leftover Kc beside a valid K is not an anomaly); K exempt from the `.invalid` rename rule and never touched after B8; every post-B8 operation wrapped so the exit code derives from `K.finalOverall` only; truth-table row 7 corrected. |
| F2 High | Fixed. Step 1 disarms T9 and latches the error ledger; step 7 adds a pre-commit gate re-evaluating `computeOverall(pre-closeout)` — a late fatal event ⇒ closeout failure `late-verdict-change`, no `link()`. |
| F3 Medium | Reworded ("no PASS path before B8; B8 atomic-visible, not power-loss-durable"); `PASS-UNCONFIRMED` output when the post-commit directory fsync fails; filesystem assumptions (atomic `link`/`rename`, error-means-no-effect, fail-safe loss of K on OS crash) recorded as a D2 owner-acceptance item. |
| F4 Medium | Fixed: S* is canonical plain JSON (no typed arrays/Map/Date), `snapshotSha256` + byte-equal re-serialization; O1 declared external and never recorded in R1. |
| F5 Medium | Fixed: empty file set ⇒ `FAIL(no-run)`; K without a journal ⇒ W-0. |
| F6, F7, F9 Low | Fixed (AUTH_BOUND/B6 wording; row 5 merged into row 3; "unchanged in every value" now notes T24). |
| F8 Low | Deferred to the harness-implementation plan (fixed R1–R3 filenames fail safe). |
