# G2 procedure v3 — targeted remediation internal review (Codex advisor, `medium`)

- **Date:** 2026-09-30
- **Artifact:** `docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md` (Procedure-Version v3; design only — no harness code, no live run)
- **Authorization:** `docs/prompts/for-claude-g2-procedure-remediation-h1-h3-m1-l1.md` (H1–H3, M1, L1; documentation only).
- **Governing input:** `docs/reviews/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure-v2-bounded-independent-rereview.md` (0C/3H/1M/1L).
- **Reviewer:** Codex advisor, request `20260930-125655-59972-28572`, `medium`, **one** targeted pass scoped to H1–H3, M1, L1 and directly affected verdict/journal/evidence sections. Read-only. Findings adjudicated by me against the procedure text and `markers.js` before acceptance. The fixes below were applied after this pass and were **not** re-reviewed by Codex.

## Design decisions made in v3 (and why)

- **H1 journal/crash-reuse:** durable binding (`AUTH_BOUND`) is now the **exclusive** `open(reservation,'wx')` create, the very first durable act after side-effect-free record validation (W1); all other fallible preflight steps follow it. Consumption boundary = durable `ATTEMPT_CONSUMED` before the first `loadDocumentNode`. Explicit crash matrix (before/after the `wx` create, after `AUTH_BOUND`, after consumption), second-run rejection on any reservation/journal/orphan-temp, durability claims limited to local POSIX (no power-loss claim).
- **H2 evidence-write gate:** required artifacts R1 (result JSON), R2 (summary), R3 (journal terminal state); optional O1/O2; two-phase verdict (`primaryOverall` pre-closeout, `finalOverall` final); `COMPLETED` only when every required step verified and never followed by anything; `FAILED` only before `COMPLETED`; worse-of reader rule; row 5 makes any required closeout failure a FAIL that outranks BLOCKED/PARTIAL.
- **H3 PG-1 overlay rendering:** traced to spec §16 (line 643), the PG-1 row (line 676) and the plan G2 list — **G2 owns it**. New verdict-bearing check **C20** (analytic footprint + exact pixel-difference oracle, negative control N8). C20 **cannot FAIL** (no contract-derived render-completion signal exists); anything short of PASS is `NOT_EVIDENCED`, so a run can only end `PARTIAL` until C20 passes; former AP diagnostic thresholds (`N_min`, hue, saturation, value) deleted.
- **M1 N6:** replaced by a whole-interval translation construction with a closed-form margin `D = 2·g·Ms/(1−g)`, proof, float64 domain `|v| ≤ 2^900`, and a boundary property test list (zero-width, float32 extremes, subnormals, opposite signs).
- **L1:** exact repetition/retake table (kind, count, why, gate vs characterization, aggregation rule, non-justified conclusions).

## Findings from this pass — all accepted, all fixed in v3

| # | Sev. | Area | Finding | Fix |
|---|---|---|---|---|
| R1 | High | H1 | reservation not concurrency-safe: two processes could both pass W1 and both `rename` onto the journal; a crash after directory creation but before any file existed contradicted the crash matrix | exclusive `wx` reservation file (permanent, never rewritten) is the reservation boundary; journal written only by the reservation owner; crash matrix split into before/after the `wx` create; startup rule + W2 both refuse on any existing reservation |
| R2 | High | H2 | pre-closeout PASS was circular (row 8 required `closeoutComplete`); a `FAILED` transition after a written `COMPLETED` was illegal; a crash between could let a reader accept PASS with a missing summary; §10 said `COMPLETED` held `finalOverall` while step 5 held only `primaryOverall` | row 8 is "PASS-eligible" pre-closeout and adds `closeoutComplete` only in the final phase; `COMPLETED` written only when R1 and R2 both verified and never followed by anything; `FAILED` only before `COMPLETED`; `COMPLETED` carries `finalOverall = primaryOverall` and both hashes; worse-of reader rule; corner rule for an ambiguous `COMPLETED` write |
| R3 | High | H2/H3 | required R1 did not contain enough C20 evidence to recompute R3/R4/N8 (only counts, a bbox and 64 coordinates) and optional-status ordering was unspecified | R1 must hold the lossless run-length encoding of `X` and of the `F_clear`-vs-`F_off1` difference (≤ 1 MiB each, else `NOT_EVIDENCED(evidence-too-large)`), N8 parameters, camera matrices, footprints; O2 attempted before R1 serialization, O1 is operator-side |
| R4 | High | H3 | CA values had FAIL power (evaluability floor, 2-rAF wait as observation time, `1e-9` camera tolerance) contradicting Table T's own rule | C20 has **no FAIL outcome**; camera comparisons after settle are exact equality (T19); T4 is settle-detection only; Table T rule (a) restated precisely; `no-change-observed` and `post-clear-mismatch` are `NOT_EVIDENCED`; N8(i) now expects `NOT_EVIDENCED(no-change-observed)`; upgrade path recorded (a contract-derived render-completion signal, to be established by a separate evidence investigation) |
| R5 | Medium | M1 | N6 proof was real-arithmetic only; `Number.MAX_VALUE` inputs overflow `Ms` | domain bound `|v| ≤ 2^900` (all Viewer bounds are float32, `≤ 2^128`) with the float64 margin argument; C4 treats out-of-range/non-finite inputs as `FAIL(non-finite)`, so N6 is total over every reachable `contained` dbId; boundary property test list |
| R6 | Low | L1/consistency | "five mandatory examples" vs X1–X14; §4.7 named only T17/T18/T20; D7 said "two" constants while naming three; repetition table omitted double-dispose and the C15(e) second `clear()` | wording corrected; two table rows added |

Reviewer-confirmed as verified: the C20 geometry model matches `markers.js` (unit `SphereGeometry` with uniform scale and position; default-transform `THREE.Line` through exactly 16 box-edge-path vertices, 15 segments); C20 being required for G2 PASS agrees with PG-1; L1's vague-wording defect closed.

## Residual uncertainties and limits

- The corrections above are procedure text; none was executed. Actual Viewer 7.124.2 screenshot dimensions, frame-settlement behaviour, event ordering and whether C20 discriminates are live facts.
- C20 can end only `NOT_EVIDENCED` on absence of change; whether a documented final-frame-rendered signal exists in 7.124.2 is **not verified** and is not assumed.
- The future execution filesystem is unverified; durability claims apply to a local POSIX filesystem only.
- Internal review is a convergence aid, not an independent gate. The reviewer recommended a further bounded look at §4.1, §8/§9.1, C20/N8 and N6 — left to the bounded independent Work re-review.

## Confirmations

No harness or production code written; no live run; no Viewer/Playwright/Chromium session; no G3/H1/H2/OQ-1/host work; no Core/Adapter/M4/Panel/`server.js` change; no G1-F7 probe or calibration; nothing committed or pushed.
