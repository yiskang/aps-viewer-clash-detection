# G2 future live diagnostic: preparation spec, Part 1 (questions, instrumentation, capture points, pre-motion, pending-clear gap)

> **Status and limits. Read these first.**
> - **Design only.** This file prepares a *future, separately authorized* live diagnostic. It authorizes nothing. No Viewer, browser, live harness, Playwright, G2 retry, authorization record, attempt reset, commit or push is part of it.
> - It is **not** an acceptance-procedure amendment (procedure SHA-256 `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75` unchanged), **not** a settle rule, and makes **no** T4, C6/N2 or C8 runtime change. Historical G2 stays `FAIL (row 3)`, C6 stays `NOT_EVIDENCED`, **historical C8 stays unresolved**, real T4 is unchanged.
> - Version-bound Viewer 7.124.2 internals named here (VB-1, VB-3) are **diagnostic/research-only**. Using one in production or acceptance would need procedure re-acceptance.
> - **Synthetic separation is never a live answer.** Every D2 count quoted here (40,788 relevant schedules, 2,048 configurations, 5,063 residual, …) is a closed-world synthetic result. A live answer exists only when a future live trace passes whole-trace integrity and the sound correlator emits a definite label for it.
> - **Scope split.** This is Part 1 and covers prompt §4 (recap), §5–§10. Part 2 (a separate file written in parallel) covers controls, the META/data/END envelope, evidence/provenance, the verdict model, stop conditions, the runbook and authorization binding (prompt §11–§17, §22). This part fixes the record kinds and data-record fields. Part 2 fixes `META`, `END`, caps and verdicts.

- **Authority:** `docs/prompts/for-claude-g2-future-live-diagnostic-design-preparation-package.md` (owner prompt, untracked at baseline), §4–§10.
- **Baseline:** `main` @ `f3bab74f460eacd6b6f69bc8fb90110455ceeb68`. Harness `test/acceptance/clashpanel-viewerbridge.acceptance.mjs` SHA-256 `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b` (re-hashed for this file).
- **Governing committed package:** spec [`../2026-10-05-g2-diagnostic-instrumentation-spec.md`](../2026-10-05-g2-diagnostic-instrumentation-spec.md) ("DS §n"), research [`../2026-10-05-g2-diagnostic-instrumentation-research.md`](../2026-10-05-g2-diagnostic-instrumentation-research.md) ("DR §n"), prototype [`../2026-10-05-g2-diagnostic-instrumentation/`](../2026-10-05-g2-diagnostic-instrumentation/) and its `results/diag-summary.json` (schemaVersion 3, `outputDigestSha256` `fe42e53e0e12c19fd9c321b7b038998c1fbe09b42ab1f5c556de71d247a52c35`).
- **Labels:** as in DR §1. **[SRC]** = pinned Viewer 7.124.2 `viewer3D.js`, decoded SHA-256 `12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e`, cited `V:<line>`. The bundle is **not** in the repo. For this file the copy that A2 fetched into an earlier session scratchpad was re-hashed (digest matches exactly), searched by symbol and read in excerpts only. It was never executed and never copied into the repo. **[HAR]** = committed harness at `cc8868cd…` (`H:<line>`). **[INF]** = inference by this file. **[SYN]** = D2/diagnostic synthetic result.

---

## 4. Governing committed findings (read-only recap; nothing re-decided)

| Committed conclusion | Value | Source |
|---|---|---|
| diagnostic summary / witnesses schema | `schemaVersion` 3 / 2 | DS §7.4; `results/diag-summary.json` |
| bounded ablation carrier | accepted | DS §7.4 |
| `NV` record cap | **406 B** (short-key encoding, §6.4(b)) | DS §6.4(b); README |
| unique two-window minimum | base (`H-CALL`, `H-T4`) + `ID-ON` + `P-FRM` + `P-TC` + `V-PEND` + `V-EDGE` | DS §8.6; `ablation.canonical` |
| `P-XS` | redundant for the two-window objective | DS §8.6 |
| `P-TICK`, `P-CC`, `P-CC0`, `V-ACT` | change no verdict in any configuration | DS §8.6 |
| question coverage | `OPEN` answers **2/13**; assumption mode answers **3/13**; only **3/13** have a sound procedure | DS §6.3 C1, §8.6; `ablation.questionCoverage` |
| soundness | all **2,048** configurations: wrong-label count **0** | DS §8.6 |
| public-only | **0** sound definite owner / subject / attribution labels (128 subsets × 2 windows) | DS §8.6 |
| residual | **5,063** `ACTIVE_WITHOUT_VISIBLE_STEP` / ground-truth `ACTIVE0` pre-motion schedules (assumption-mode residual; 454 / 213 / 2,310 / 2,086 by cell) | README; `correlator["T-VB/ON"]` |
| pending-clear → active-edge gap | fail-closed (`slotWindow = OPEN` default) | DS §6.2 R3 |
| historical C8 | unresolved | all |
| post-capture VB-3 control | not historical proof; representativeness not established | DS §6.1.3 |

Re-derived from the committed summary for this file (read-only, no regeneration): under `T-VB/ON@OPEN`, `Q-OWNER` 2,608 definite (all `RESTORE`), `Q-SUBJ` 17,935 definite (all `PENDING`), `Q-ATTR` 0. Under `T-VB/ON` (assumption) 35,725 / 35,725 / 40,788, with residual reason `ACTIVE_WITHOUT_VISIBLE_STEP` ×5,063 for `Q-OWNER` and `Q-SUBJ`.

---

## 5. Package objective (Part 1 share)

Part 1 answers four of the prompt §5 questions:
1. Which exact questions a future live diagnostic should try to answer (§6).
2. Which of them the accepted minimum can answer, and which stay structurally unanswerable (§6).
3. What must be captured at request issuance, pending-slot ownership, transition activation, T4 sampling, completion, restore, event delivery and C8/frustum observation (§7, §8).
4. How the 5,063 pre-motion class and the pending-clear gap fail closed (§9, §10).

It does **not** assume a live run should happen. Whether one is worthwhile is Part 2's §22 decision. Part 1's input to that decision is stated in §6.4.

---

## 6. Live diagnostic question set

### 6.1 Classification vocabulary

| Code | Meaning (prompt §6) |
|---|---|
| `ANSWERABLE_MINIMUM` | A sound procedure exists, and with the minimum set it can emit at least one definite label under `slotWindow = OPEN` (no unverifiable assumption) |
| `ANSWERABLE_UNDER_ASSUMPTION` | A sound procedure exists, but definite labels need `ASSUME_NO_UNOBSERVED_WRITER`. Adopting that mode live is an owner decision (DS §10 item 1a) |
| `NOT_ANSWERABLE` | No sound procedure exists (DS §6.3 C1 `NO_SOUND_PROCEDURE`), and the limit is structural under `OPEN` with the version-bound minimum. More atoms would not fix it |
| `REQUIRES_ADDITIONAL_OBSERVABLE` | Would need an observable outside the minimum **and** a new procedure. This design **does not add** it (no demonstrated value for the target decision) |
| `NOT_WORTH_PURSUING` | Answering it cannot change a later owner decision |

"Answers" means "the sound correlator can emit ≥ 1 definite label". It never means every run gets a definite label. The counts are fixed by the committed package: `OPEN` answers {`Q-OWNER`, `Q-SUBJ`} = **2/13**, assumption mode answers {`Q-OWNER`, `Q-SUBJ`, `Q-ATTR`} = **3/13**, and only these **3/13** have a sound procedure. Nothing below adds a procedure, so none of these counts changes.

### 6.2 Summary table

| Id | Label (DS §8.2) | Classification | `OPEN` labels possible | Assumption-only labels | Never definite |
|---|---|---|---|---|---|
| `Q-STALE` | `owner ≠ OWN` | `NOT_ANSWERABLE` | — | — | all (no procedure) |
| `Q-OWNER` | owner at `t_d` | `ANSWERABLE_MINIMUM` | `RESTORE`; `INIT` (needs capture-start `FS`) | `OWN`, `PRIOR_TERMINAL`, `IN_FLIGHT` | `FOREIGN` (never asserted) |
| `Q-SUBJ` | subject state at `t_d` | `ANSWERABLE_MINIMUM` | `PENDING` | `ACTIVE_PLUS`, `COMPLETE` | `ACTIVE0` |
| `Q-ACTIVE` | transition-active at `t_d` | `REQUIRES_ADDITIONAL_OBSERVABLE` (not adopted) | — | — | all (no procedure) |
| `Q-RESTORE` | restore axis | `NOT_ANSWERABLE` | — | — | all (no procedure) |
| `Q-DH1` | `subj ∈ {PENDING, ACTIVE0}` | `NOT_ANSWERABLE` | — | — | all (no procedure; §9) |
| `Q-DH2` | `PRIOR_TERMINAL ∧ PENDING ∧ ¬active` | `NOT_ANSWERABLE` | — | — | all (no procedure) |
| `Q-DH3A` | `RESTORE ∧ OK_WHILE_OUTSTANDING` | `NOT_ANSWERABLE` | — | — | all (no procedure) |
| `Q-DH3B` | restore overridden | `NOT_ANSWERABLE` | — | — | all (no procedure) |
| `Q-DH4` | `owner = IN_FLIGHT` (quiet tail) | `REQUIRES_ADDITIONAL_OBSERVABLE` (not adopted) | — | — | all (no procedure) |
| `Q-DH7A` | no tick between deciding samples | `NOT_WORTH_PURSUING` | — | — | all (no procedure) |
| `Q-ATTR` | completion-token list | `ANSWERABLE_UNDER_ASSUMPTION` | (see note) | any non-empty list | any non-empty list under `OPEN` |
| `Q-TUPLE` | full tuple | `NOT_ANSWERABLE` | — | — | all (no procedure) |

Distribution: 2 `ANSWERABLE_MINIMUM`, 1 `ANSWERABLE_UNDER_ASSUMPTION`, 7 `NOT_ANSWERABLE`, 2 `REQUIRES_ADDITIONAL_OBSERVABLE`, 1 `NOT_WORTH_PURSUING` (total 13).

**Note on `Q-ATTR` under `OPEN`.** The correlator emits definite `"-"` (empty list) when no `TC` is observed in the target window (`correlate.mjs` final branch). In D2 every relevant schedule has ≥ 1 completion, so `OPEN` `Q-ATTR` is 0 definite in every configuration. A live trace with no completion could therefore yield a definite `"-"`. That label carries no attribution and no owner/subject information, so it is **not** counted as an `OPEN` answer and does not change 2/13. Part 2's verdict model must not treat it as positive evidence.

### 6.3 Per-question definitions

Common notation. `t_d` is the subject's deciding T4 sample: the `T4` `t4Phase = "sample"` record (`settleRole = "S"`) named by the `sampleSeq` of the unique `t4Phase = "decision"` record with `deciding = 1` (§8.1 I4). A subject settle that times out with zero samples has **no** `t_d`; every owner/subject question is then `UNDIAGNOSABLE(NO_DECIDING_SAMPLE)`. `S` is the subject token: `reqToken` of the subject settle's `t4Phase = "start"` record. "Minimum" means base + `ID-ON` + `P-FRM` + `P-TC` + `V-PEND` + `V-EDGE`, with the VB guard passing (Part 2 envelope). "Inconclusive" means the correlator returns `AMBIGUOUS`/`UNAVAILABLE`/`UNDIAGNOSABLE` for the question. Part 2 maps that to the run-level `INCONCLUSIVE`/`INVALID`/`BLOCKED` verdicts.

**Historical-interpretation limit (applies to every question).** R1 (`docs/research/evidence/g2-live-20261004-75a3ccb9/`) retained no slot read, no edge, no per-sample value, no restore post-call camera and no settle timing (DR §7). A future live answer is **new evidence about the new run only** (O-29). It can show that a mechanism *occurs* on the pinned build under the diagnostic procedure. It can never show that the mechanism *occurred in R1*. C6 stays `NOT_EVIDENCED` and C8 stays unresolved whatever a future run shows.

#### Q-OWNER (`ANSWERABLE_MINIMUM`, partial)

- **Required observable set:** the full minimum. `V-EDGE` provides positive evidence that no transition is active once a fit has been issued. Without it the answer is `AMBIGUOUS(ACTIVE_STATE_UNOBSERVED)`. `P-FRM` provides the restore's own post-call read and the capture-start baseline. `P-TC` is needed or the terminal write is hidden (`OBSERVABLE_ABSENT:P-TC`). `V-PEND` + `ID-ON` separate `OWN` from `PRIOR_TERMINAL` (assumption only).
- **Positive evidence (`OPEN`):**
  - Precondition for both labels: the transition-active state is **positively established as low** at the target-window start (§8.4, `edgeInit = "LOW"`). Under `edgeInit = "UNKNOWN"` no edge-dependent label is definite.
  - `RESTORE`: an `RS` `phase = "post"` with `restoreResult = "OK"` that carries its own `camClass` (CP11). No `TE` rise is open (risen and not fallen) at `t_d`. No `TC` and no unbracketed `camClass` change between that `RS` and `t_d`. No GAP annotation (§10) is open at `t_d`.
  - `INIT`: the first data record is the capture-start `FS` at `frame = 0`, `tRel = 0`. No writer is bracketed before `t_d`. No `TE` rise is open at `t_d`.
- **Negative evidence:** each item rules out the corresponding `OPEN` label.
  - A `TE` rise open at `t_d` rules out `RESTORE` and `INIT` (it yields `ACTIVE_WITHOUT_VISIBLE_STEP` or `UNOBSERVED_SLOT_WINDOW`).
  - A `TC` after the restore makes a terminal write the last writer (owner token-dependent, so `AMBIGUOUS` under `OPEN`).
  - A `camClass` change with no bracketing writer is `FOREIGN_CANDIDATE` (`AMBIGUOUS`).
- **Inconclusive:** any of `ACTIVE_STATE_UNOBSERVED`, `OBSERVABLE_ABSENT:P-TC`, `UNOBSERVED_SLOT_WINDOW`, `IDENTITY_AMBIGUOUS`, `ACTIVE_WITHOUT_VISIBLE_STEP`, `NO_CAPTURE_BASELINE`, `UNREAD_WRITER`, `WRITER_RACE`, `FOREIGN_CANDIDATE`, `UNBRACKETED_CHANGE`, `VB_UNAVAILABLE:<VB-n>`. Under `OPEN`, `OWN`, `PRIOR_TERMINAL` and `IN_FLIGHT` are **always** inconclusive.
- **Historical limit:** R1's owner at each `t_d` is DH-6b, unidentifiable for every sample. No live result changes that.

#### Q-SUBJ (`ANSWERABLE_MINIMUM`, partial)

- **Required observable set:** `V-PEND` + `V-EDGE` + `ID-ON`, plus `P-TC` (a hidden terminal makes the answer `AMBIGUOUS`), plus `P-FRM` for the visible-step test.
- **Positive evidence (`OPEN`):** `PENDING` iff the slot read bound to `t_d` (the `PS` with `hostSeq` = the deciding `T4` sample's `seq`) has `slotPresent = 1` and `slotBinding = S`, **and no prior identity ambiguity remains**. The committed correlator governs precedence (`correlate.mjs` Q-SUBJ branch order): a `"U"` read anywhere before `t_d` sets the persistent `foreign` flag, and that is checked **before** the slot token, so it yields `IDENTITY_AMBIGUOUS` even when the subject object is visible at `t_d`. The `PENDING` evidence itself is an object-identity read at the decision instant, not an order inference. The committed correlator is not amended.
- **Negative evidence:** the `t_d` slot read shows `slotPresent = 0`, or `slotBinding ≠ S`. That rules out `PENDING`. Because every write creates a fresh object (V:96698, V:96727) and the only assignments to `__destinationView` are V:95294, V:96698, V:96709, V:96727 and V:96738, a bound object that has left the slot never returns.
- **Inconclusive:**
  - `ACTIVE0` is never definite (§9).
  - Under `OPEN`, `ACTIVE_PLUS` and `COMPLETE` are always `AMBIGUOUS(UNOBSERVED_SLOT_WINDOW)`.
  - Any `"U"` binding before `t_d` gives `IDENTITY_AMBIGUOUS`.
  - `OBSERVABLE_ABSENT:P-TC`, or `VB_UNAVAILABLE:VB-1`/`VB-3`.
- **Historical limit:** whether C6/N2/C8 were pending at their `t_d` (DH-1/DH-2) cannot be reconstructed for R1.

#### Q-ATTR (`ANSWERABLE_UNDER_ASSUMPTION`)

- **Required observable set:** `P-TC` (otherwise `UNAVAILABLE`). A non-empty list also needs `V-EDGE`, `V-PEND`, `ID-ON` and the R3 assumption.
- **Positive evidence (assumption mode only):** every `TC` immediately follows (`seq + 1`) a `TE` fall with no intervening rise (R4, V:107116 → V:107117). The rise that opened each transition is preceded by a visible slot read bound to a token. Every harness call between that read and the rise has its own post-call read, and none of those reads shows `"U"`. Every label carries `assumption: NO_UNOBSERVED_WRITER`.
- **Negative evidence:** a `TC` not adjacent to a fall. A rise after an empty visible slot (`EDGE_AFTER_EMPTY`). A `"U"` read.
- **Inconclusive:** under `OPEN`, any non-empty list is `AMBIGUOUS(UNOBSERVED_SLOT_WINDOW)`. Also any `"?"` completion (`IDENTITY_AMBIGUOUS`).
- **Historical limit:** R1 had 4 fits and 3 removal events, with an `unattributed` registrant and confounded removals (DH-5, T2). No live attribution transfers to R1.

#### The ten procedure-less questions

All ten report `UNDIAGNOSABLE(NO_SOUND_PROCEDURE)` in any future live run (DS §6.3 C1). Their D2 separability (40,788/40,788) is a closed-world fingerprint result and is **not** a live answer.

| Id | Class | Why (structural) | What would be needed | Positive / negative / inconclusive (live) | Historical limit |
|---|---|---|---|---|---|
| `Q-STALE` | `NOT_ANSWERABLE` | `OWN` is never definite under `OPEN`, so "not stale" can never be shown | A new procedure deriving `T` from definite `RESTORE`/`INIT` owners would need an offline soundness proof and a spec amendment. Not adopted, and not counted | none / none / always | The C8 core question. Historical C8 stays unresolved |
| `Q-RESTORE` | `NOT_ANSWERABLE` | "Outstanding immediately before the restore" needs a slot read plus edge state bracketing the restore. The immediate restore path touches neither slot nor flag (V:38665-38677), but no procedure is specified and the unobserved window applies to the pre-restore state | Candidate route: `RS` post slot read + edge state. Unproven, not adopted | none / none / always | Both R1 restores returned `true`, which is not an effectiveness witness (O-13) |
| `Q-DH1` | `NOT_ANSWERABLE` | The `T` side needs `ACTIVE0`, which is never definite (§9). The `F` side needs `ACTIVE_PLUS`/`COMPLETE`, which are assumption-only | Nothing within the non-invasive VB set (§9.3) | none / none / always | C6 "home-like" sample is consistent with DH-1 but unproved |
| `Q-DH2` | `NOT_ANSWERABLE` | Needs `owner = PRIOR_TERMINAL`, never definite under `OPEN` | Only the R3 assumption (owner decision) | none / none / always | N2/C8 consistency is moderate/partial (D1 §8) |
| `Q-DH3A` | `NOT_ANSWERABLE` | Needs the `Q-RESTORE` "outstanding" label (no procedure) | As `Q-RESTORE` | none / none / always | DH-3a does not match N2 [INF] |
| `Q-DH3B` | `NOT_ANSWERABLE` | Needs a token-dependent owner (window-dependent) and the outstanding label | R3 assumption + `Q-RESTORE` route | none / none / always | Restore timing [UNKNOWN] for R1 |
| `Q-DH4` | `REQUIRES_ADDITIONAL_OBSERVABLE` | Needs sub-1e-9 motion evidence: `P-XS` (bitwise class) or retained numeric `NV` Δ, plus active state. The source does not establish DH-4 | `P-XS` and a procedure. `P-XS` is redundant for the minimum objective, so it is **not** added | none / none / always | No historical datum bears on it |
| `Q-ACTIVE` | `REQUIRES_ADDITIONAL_OBSERVABLE` | The label is the raw flag value at `t_d`. That needs `V-ACT` (VB-2) or an edge-state procedure. The flag is shared with view-cube and interaction (V:107165, V:107728, V:108019), so it is not subject-specific | `V-ACT` and a procedure. `V-ACT` changes no verdict in any of 2,048 configurations, so it is **not** added | none / none / always | — |
| `Q-DH7A` | `NOT_WORTH_PURSUING` | DH-7a is an *enabling condition*, not an exclusive hypothesis axis (DR §3). Answering it changes no owner/subject/attribution decision. A skipped tick emits nothing (V:17625-17631), so its absence is only negative evidence | `P-TICK`, which changes no verdict. Not added | none / none / always | [UNKNOWN] for R1 |
| `Q-TUPLE` | `NOT_ANSWERABLE` | The tuple contains `subj`, whose `ACTIVE0` member is never definite, plus procedure-less axes | — | none / none / always | — |

### 6.4 Part 1 input to the "is a live run worthwhile" gate (for Part 2 §22; not a verdict)

- Under the only assumption-free mode (`OPEN`), the minimum can yield **only** `Q-OWNER ∈ {RESTORE, INIT}` and `Q-SUBJ = PENDING`.
- None of these decides `Q-STALE` for an owned-vs-stale C8-type sample. `OWN` is never definite under `OPEN`.
- A live run can therefore demonstrate *that* a decision was taken on a still-pending request (`PENDING`) or on a restored or initial pose. It cannot demonstrate that a decision was taken on the request's own terminal pose.
- Everything about consumption identity rests on the R3 assumption, which a live 7.124.2 run cannot verify (§10).

---

## 7. Instrumentation architecture (minimum set only)

### 7.1 The five elements

The base atoms `H-CALL`/`H-T4` are the harness's own call and settle records (`RQ`, `RS`, `T4`). They are always present and need no Viewer internal.

| Element | Exact meaning | Capture source | Timing | Ownership semantics | Version dependency | Failure mode | Tier |
|---|---|---|---|---|---|---|---|
| **ID-ON** (harness-tagged request ID, `reqToken`) | 1-based call order of `viewer.fitToView` calls within the run, assigned at wrapper entry | A diagnostic variant of the harness's existing `viewer.fitToView` spy (`SPY_TARGETS` label `viewer.fitToView`, H:6773). Restore calls get no token | Synchronously at wrapper entry, before the original call | Identifies a **call**, not a request. `FIT_TO_VIEW_EVENT` fires even when no request is created (V:36590-36604, O-2). `fitBounds` returns early with no slot write when gotoview is disabled (V:95805-95807). It becomes request identity only through the CP02 binding with `V-PEND` (R2) | None (`viewer.fitToView` is public, V:29941) | A call that bypasses the wrapper gets no token. Its slot object later reads `"U"` (`IDENTITY_AMBIGUOUS`) | harness-local |
| **P-FRM** (per-frame + post-call camera read; `frame` is the harness frame index) | The 32-entry `[matrixWorldInverse, projectionMatrix]` sample, classed (`camClass`) and digested (`camDigest`). Read at: each diagnostic rAF callback (`FS`), synchronously after each fit and restore call (`RQ`/`RS` post), and on each T4 sample | Public `viewer.getCamera()` returns the live `impl.camera` object (V:27956-27959). Read with the **same** sampling function as T4 (H:11550-11554: `updateMatrixWorld(true)`, then copy both matrices) so `camClass` is comparable across sites | `FS`: once per diagnostic rAF callback, with `frame` incremented by 1 (frame 0 = capture start). Post-call: in the same synchronous segment as the call | None. Values only. Ownership is only ever *inferred* by bracketing (R5) | Public value. Fine semantics are 7.124.2-bound (PUB†/VB-9). Each autocam step updates the camera matrices synchronously (`autocamChange` V:26657-26674 → `syncCamera` V:33469-33476 `updateCameraMatrices`), so a read after a step reflects it. A step whose write leaves all 32 entries within 1e-9 is invisible (R5) | Non-finite or unreadable values: the record fails schema, giving `MALFORMED` for the whole trace. A missing capture-start `FS` gives `NO_CAPTURE_BASELINE` for `INIT` | public (value) + harness-local (frame clock, classing) |
| **P-TC** (formal completion) | One `CAMERA_TRANSITION_COMPLETED` dispatch | `viewer.addEventListener('cameraTransitionCompleted', …)` (constant V:13923). Registered before capture start (Part 2 Phase 1) and not removed during capture; the recorder removes it, by its retained reference, only on entering `FINALIZING` (§8.6, Part 2 P4.02) | Synchronously inside the final autocam step, immediately after the `TE` fall: `setTransitionActive(false)` V:107116, then `transitionCompletedCallback()` V:107117, then `onTransitionCompleted` V:26684-26686 | None. The payload is `{type}` only (V:26685). Attribution is only via R4 adjacency plus R3 | Public existence. The adjacency to the fall is a 7.124.2 source fact. Not fired for immediate, early-return, view-cube or same-pose transitions (O-16), so the **absence of a TC is never evidence of no transition** | Listener missing: `Q-ATTR` `UNAVAILABLE`. After any fall, owner/subject are `AMBIGUOUS(OBSERVABLE_ABSENT:P-TC)` (hidden terminal) | public |
| **V-PEND** (pending-slot identity) | Presence (`slotPresent`) and object identity of `navigation.__destinationView`. `slotBinding` = the `reqToken` bound at CP02, or `"U"`. `slotDelta` = change versus the previous visible read | VB-1: `navigation.getRequestTransition()` (V:96747-96749). Identity is compared by reference (`===`) inside the live recorder. The object→token map MUST be a `WeakMap`, so it holds no strong reference and does not change Viewer object lifetime | Synchronous poll at the read sites: `RQ` pre/post, `RS` post, and `PS` after each `FS` and T4 sample. Never on a timer | Slot-**write** identity by object reference: each write creates a fresh object (V:96698, V:96727). It becomes request identity only via the RQ-post binding. Clears happen at V:96708-96709 / V:96737-96738, including the consumer clear at V:105009. The initial value is `null` (V:95294). **A clear emits no event.** | VB-1 (7.124.2 only, behind VB-0) | Absent, type-mismatched or guard failed: `V-PEND` is disabled, so `Q-SUBJ` is `AMBIGUOUS(VB_UNAVAILABLE:VB-1)` and every R2/R3 output is unavailable. It is **never** inferred from edges | Viewer 7.124.2 version-bound internal |
| **V-EDGE** (transition-active edges) | A `TRANSITION_ACTIVE_FLAG_CHANGED` dispatch. `edgeValue` 1 = rise, 0 = fall. The payload's `transitionActive` is recorded verbatim as `payloadActive` | VB-3: `viewer.navigation.addEventListener(Navigation.Events.TRANSITION_ACTIVE_FLAG_CHANGED, …)`. Constant at V:95234, exposed at V:97047, `EventDispatcher` mixin at V:97046 | Synchronously inside `setTransitionActive`. It fires **only on change** (V:96758-96764). A goToView rise happens on the first step, in the same call stack as the consumption (V:107122). The fall happens on the final step (V:107116) | **None.** The flag is shared: view-cube/spherical transitions (V:107165 rise, V:107212 fall), interaction (V:107728 rise, V:108019 `endInteraction` fall). A rise proves "the flag rose", not "a slot request was consumed", and never *which* request (§10) | VB-3. Structural presence is checked in `META`. The behavioural control runs post-capture (`END.pc`). That control is not historical proof, and its representativeness is a live gate (Part 2) | Listener absent or control failed: `V-EDGE` is disabled, and every definite label drops to 0 (DS §8.6 necessity) | Viewer 7.124.2 version-bound internal |

### 7.2 Terms the prompt names, resolved against the committed definitions

| Prompt §7 term | Resolved meaning here |
|---|---|
| harness-tagged request ID | `reqToken` (ID-ON). A call token. Request identity only via the CP02 binding |
| public frame index | **Not public.** `frame` is the harness rAF counter (HAR). The Viewer's own `MainLoop.frameCounter`/`lastTickFrames` (V:17609-17626) is VB-8, with no established public reference, and is not used |
| public step/transition count | **No public step counter exists.** Autocam progress is VB-6 and excluded (drift risk; its destination lives only in the rAF closure, V:107155). `P-TC` counts formal completions only, and some transitions emit none (O-16) |
| pending-slot identity | `slotPresent` + `slotBinding` + `slotDelta` (V-PEND) |
| transition-active edge events | `TE` records (V-EDGE) |

### 7.3 Excluded (no redundant observable added)

`P-XS`, `P-TICK`, `P-CC`, `P-CC0`, `V-ACT`, VB-4 competing flags, VB-5 pivot, VB-6 progress, VB-7 write wrappers (invasive), VB-8 frame counter and `getState` viewport are all excluded. The basis is DS §6.1.4 and §8.6: each changes no verdict, is invasive, or has unproven value. Two candidate read sites were considered and rejected:
- **A slot read inside the `TE` listener.** At a consumption rise the slot is always already `null` (V:105009 precedes V:107122 in one stack), so the read carries no identity. At a non-consumption rise (interaction or view-cube) a still-present bound object only shows "not that object's consumption". Separate `PS` reads already show this, and D2 cannot evaluate it.
- **A value match of the retained bound slot object's `position`/`coi` against the terminal pose.** The final step snaps to the destination (V:107096-107100). This is a value match (c), not identity: a foreign request with an equal destination, or a later write, is indistinguishable.

---

## 8. Capture points CP01–CP15

### 8.1 Data-record kinds and common fields

Record-kind codes (shared with Part 2 and the prototype): `RQ` request issuance (`phase` `pre`/`post`), `PS` pending-slot read, `TE` transition-active edge, `FS` frame step (per-frame camera read), `T4` settle start/sample/decision, `RS` restore (`phase` `pre`/`post`), `CE` public camera-change event, `TC` formal transition completion, `C8` frustum measurement, `CT` control result, `TZ` terminalization.

The envelope kinds **`META`** (first record) and **`END`** (last record) exist and are specified by Part 2. The committed numeric companion **`NV`** (406 B, DS §6.1.2/§6.4(b)) remains available. It immediately follows the `T4` sample it encodes. Part 2 owns its cap and retention policy.

Common fields on every data record (logical camelCase names; the wire keys are in §8.3 and the Appendix `wireKeys`, which is the single source for every data-record wire key; Part 2 adds no data-record key):

| Field | Type | Meaning |
|---|---|---|
| `kind` | enum above | record kind |
| `seq` | int ≥ 1 | recorder-stamped sequence (committed `q`). The caller never sets it |
| `frame` | int ≥ 0 | harness rAF frame counter at append (committed `f`). Non-decreasing in `seq` order, and every non-`FS` record carries the frame of the latest preceding `FS` (the frame counter advances only at an `FS`). A violation is Part 2 integrity code `FRAME-ORDER` |
| `tRel` | int ≥ 0 | `performance.now()` delta from the `META` origin, in tenths of a millisecond (committed `tm`). Non-decreasing in `seq` order; a decrease is Part 2 integrity code `TIME-ORDER` |
| `runId` | string 1..32, optional | echo of `META` run id (committed `rn`). Not allowed on `NV` |

**Global ordering guarantee [SRC/INF].** The page is single-threaded. Every record is appended synchronously at the instant its read returns or its listener runs. `seq` order therefore equals JavaScript execution order of the observations. This guarantees **observation order**. It is **not** an ownership or causation guarantee. Viewer ticks run in a `setTimeout`-driven main loop gated by its own rAF frame counter (V:17604-17626), and the diagnostic samples in its own rAF callback. Within one display frame, the order of a tick versus an `FS`/T4 sample is therefore not fixed, and `seq` is the only order of record.

**Pairing invariants.** These are mechanically checkable. A violation of I3–I6 means the read-site contract was broken. That is whole-trace `MALFORMED`, because a dropped read can remove the very evidence that keeps a label ambiguous (DS §6.3 R-L2).
- **I1.** Every `RQ` pre with token `k` has exactly one `RQ` post with token `k`, at a later `seq`. If the pair is not adjacent (`post.seq ≠ pre.seq + 1`), call `k` is **interleaved**. Its binding is refused (`NO_REQUEST_OR_UNRESOLVED`), and any object it would have bound later reads as `"U"`. Interleaving is a legitimate open-world outcome: a nested `fitToView` from a synchronous listener produces a nested `RQ` pair, and a synchronous edge or completion produces `TE`/`TC`. Two cases are whole-trace `MALFORMED`, because they mean the instrumentation is broken:
  - an unmatched `RQ`;
  - an `FS`, `T4`, `PS`, `RS` or `C8` record between the pair. These cannot be emitted inside a synchronous call.
- **I2.** An `RQ` post with `callOutcome = "threw"` carries no slot or camera field. Its token is `NO_REQUEST_OR_UNRESOLVED`.
- **I3.** Every `FS` and every `T4` `sample` is followed by exactly one `PS` whose `hostSeq` is the host's `seq`. Its `seq` is `hostSeq + 1`, or `hostSeq + 2` when an `NV` sits between them. The host read and the slot read run in one synchronous segment with no `await` between them.
- **I4 (T4 decisions; amended after Codex review C-3/C-4; made exact in the prototype-finding remediation, §12).** Every rule below is mechanical. A violation is `I4-T4-DECISION` unless another code is named.
  - **Settle association (`SETTLE-ROLES`).** A `T4 start` carries `reqToken = k` of a fit whose `RQ pre` was issued **and** whose `RQ post` has a smaller `seq` than the `start`. This is a procedure association only (CP08), never proof that the camera belongs to `k`. Settles are strictly sequential: a `start` may follow only after the previous settle's terminal decision. `T4` records are allowed only in the target window (`CONTROL-WINDOW-KIND` otherwise).
  - **Role consistency.** Every `sample` and `decision` carries the `settleRole` of the settle opened by the latest `start`. A `sample` or `decision` with no open settle, after the open settle's terminal decision, or with a different role is a violation.
  - **Samples.** `sampleIndex` runs 1, 2, 3, … consecutively within a settle.
  - **Comparison decisions** (`decision ∈ {none, settled}`): `sampleSeq` is the `seq` of the settle's **most recent** sample, `sampleIndex` equals that sample's `sampleIndex`, and the decision's `seq` is that sample's `PS` `seq + 1` (the `PS` itself follows the sample, or its `NV`, by I3). So a comparison decision follows its sample's `NV`/`PS` with no intervening record. At most one comparison decision exists per sample. `settled` with `sampleIndex = 1` is rejected for **every** role (committed C3 `SETTLED_ON_FIRST_SAMPLE`; P samples are not projected, so the rule is enforced on the raw trace).
  - **Timeout decisions** come from the deadline, not from a comparison. They carry `sampleIndex` = the number of samples the settle has taken so far and `sampleSeq` = the `seq` of its last sample, or omit `sampleSeq` when `sampleIndex = 0` (the **zero-sample-timeout transition**: `start` → `decision{timeout, sampleIndex 0}`). A timeout may appear at any `seq` after the settle's last sample (or after its `start` if no sample was taken) and before the next settle's `start`.
  - **Terminal marker.** `terminal = 1` (wire `te`) is present **iff** `decision ∈ {settled, timeout}`; a `none` decision never carries it. Every settle has exactly one terminal decision, and nothing of that settle follows it.
  - **Deciding marker.** `deciding = 1` (wire `fr`) appears **at most once per trace**, only on a terminal decision of the subject settle (`settleRole = "S"`) with `sampleIndex ≥ 1`. Conversely, the subject settle's terminal decision with `sampleIndex ≥ 1` **must** carry `deciding = 1`. Under a zero-sample timeout no `t_d` exists, `deciding` is absent, and owner/subject questions are `UNDIAGNOSABLE(NO_DECIDING_SAMPLE)`.
  - **Settle roles and counts (resolution of Part 2 CI-1).** A target trace has exactly one `S` settle, at most one `P` settle and at most two `G` settles (`maxSettles = 4`). `G` means "a non-subject settle that is never deciding and never `C8`-bound": the gate settle of N−1, or an earlier settle of the plan such as the historical N2 and C6 settles. Settles are strictly sequential: a settle's `start` follows the previous settle's terminal decision. The committed correlator re-initializes a role's settle state on every `SST` (`correlate.mjs` C3 loop and main loop), so a second sequential `G` settle is consumed unchanged. The full historical P6 shape (N2, C6, C8, p2) therefore maps to `G`, `G`, `S`, `P` without a new enum value.
- **I5 (C8 binding).** A `C8` record binds to the **terminal sample of a settled settle**, never by position:
  - `sampleSeq` names a `T4` sample whose settle's terminal decision is `decision = "settled"` with `sampleSeq` equal to it.
  - The `C8` `camDigest` equals that sample's `camDigest`.
  - `measureRole` matches the settle: `subject` ⇔ `settleRole = "S"` (whose terminal decision then also has `deciding = 1`); `superseded` ⇔ `settleRole = "P"`.
  - No `C8` exists for a timed-out settle. The harness returns `BLOCKED` before the frustum is evaluated (subject H:8510, superseded H:8516).
- **I7 (`slotDelta` on every visible slot read).**
  - Every visible slot read carries `slotDelta`, computed by object identity against the **immediately previous visible slot read** at any site. Visible slot reads are `RQ` pre, `RQ` post (`returned`), `RS` post (non-`THROW`) and `PS`.
  - The baseline for the first read is the final quiescence read (§8.4). That read is `null` by precondition, so the first non-null read is `appear`.
  - `slotNew` on `RQ` post is a separate field: post object `!==` pre object of the same call. For an adjacent pair, `slotNew = 1` ⇔ `slotDelta ∈ {appear, replace}`. A mismatch is `MALFORMED`. For an interleaved pair the two fields legitimately differ.
- **I6.** There is exactly one `TZ` with `tzPhase = "targetEnd"` and exactly one with `tzPhase = "final"`. `final` is the last data record. Records between the two are **control-window** records (`RQ`/`TE`/`TC`/`FS`/`PS`/`CT` of the post-capture control) and are excluded from target correlation. `CT` appears only in the control window. **Resolution of Part 2 CI-2:** the `PC-3` fit goes through the same tag wrapper as every other fit, so it emits an `RQ` pre/post pair; I1 and I7 apply to it as in the target window, and its `reqToken` continues the run's call order. No `T4`, `RS` or `C8` record may appear in the control window.

### 8.2 Capture-point table

| CP | Prompt §8 item | Record | Required fields (beyond common) | Ordering guarantee | Race / gap | Token availability | Fail-closed if missing |
|---|---|---|---|---|---|---|---|
| **CP01** | before request issuance | `RQ` `phase="pre"` | `reqToken`, `slotPresent`, `slotDelta` (I7); `slotBinding` iff `slotPresent=1` | Immediately before the original `fitToView` call, in the same synchronous segment (I1) | None inside the segment. Any writer between the previous visible read and CP01 is visible here as `slotDelta`/`"U"` only if its object is still present | `reqToken` assigned here | Pair missing: whole-trace `MALFORMED` (I1). Pre-read absent while `V-PEND` is configured: `MALFORMED` |
| **CP02** | immediately after request issuance | `RQ` `phase="post"` | `reqToken`, `callOutcome` (`returned`/`threw`). If `returned`: `slotPresent`, `slotDelta` (I7), `slotNew` (post object `!==` pre object), `camClass`, `camDigest`; `slotBinding` iff `slotPresent=1`. If `threw`: none of these (I2) | Immediately after the call returns, same segment. Adjacent to CP01 unless nested (I1) | **Nested writer:** `FIT_TO_VIEW_EVENT`/`AGGREGATE_FIT_TO_VIEW_EVENT` are dispatched synchronously inside the call (V:36590-36604). A listener that writes the slot in that dispatch would be bound to `k`. A nested *spied* fit is caught by I1. A nested non-fit slot writer (for example a non-immediate `restoreState` → V:38663) is **not detectable** and is an open-world residual | `reqToken` known. Binding by R2: `slotNew=1` ⇒ bound to `k`; `slotNew=0` ⇒ `NO_REQUEST_OR_UNRESOLVED`, never rebound; `slotPresent=0` ⇒ `NO_REQUEST` | Missing: `MALFORMED`. `slotNew` absent on a returned call: `MALFORMED` |
| **CP03** | pending-slot write/change | `PS` with `slotDelta ∈ {appear, replace}`; for the harness's own writes also `RQ` post `slotNew=1` | `hostSeq`, `readSite` (`frame`/`t4Sample`), `slotPresent=1`, `slotBinding`, `slotDelta` | **Not observable as an instant.** A write emits no event, so CP03 is the first visible read that *detects* the write. The write lies somewhere in `(previous visible read, this read)` | A write followed by a consumption before the next read is never seen (§10). Detection is bracket-only | `slotBinding` is a token if the object was bound at CP02, otherwise `"U"` (a foreign or unspied writer, DH-6a) | A host without its `PS`: `MALFORMED` (I3). `"U"` ⇒ `IDENTITY_AMBIGUOUS` from then on |
| **CP04** | pending-slot clear | `PS` with `slotDelta = "clear"` (`slotPresent=0`, no `slotBinding`) | as CP03 | **Not observable as an instant.** The consumer clear (V:105009) emits nothing. CP04 is the first visible read showing `null` | Clear-by-consumption and the rise happen in one synchronous stack (§10.1). A clear with no rise is possible (gotoview disabled, V:106802; or any `setRequestTransition(false)`) | Token of the cleared object = the binding of the previous visible read. **Who** cleared it is unknown | As CP03. A clear without a rise gives a `CLEAR_WITHOUT_EDGE` GAP (§10) |
| **CP05** | transition-active rising edge | `TE` `edgeValue=1` | `edgeValue`, `payloadActive` (must equal `edgeValue`, else C3 contradiction) | Synchronous at dispatch (V:96763). A consumption rise runs in the tick's stack (V:105009 → V:105010 → V:104763 → V:106817 → V:107122) | Shared flag: non-consumption rises exist (V:107165, V:107728). Only changes fire, so no rise is emitted when the flag is already high | **None** under `OPEN` (token `WINDOW`). Under the assumption: the last visible binding, with the R3 preconditions | Listener absent or control failed: `V-EDGE` disabled (`VB_UNAVAILABLE:VB-3`). Two consecutive rises: C3 `EDGE_REPEAT` (whole trace) |
| **CP06** | transition-active falling edge | `TE` `edgeValue=0` | `edgeValue`, `payloadActive` | Final step: the fall (V:107116) is immediately followed by `TC` (V:107117). View-cube/interaction falls have **no** `TC` | A fall without a preceding rise: C3 `FALSE_EDGE_WITHOUT_TRUE` | The active token: `WINDOW` (unknown) under `OPEN` | As CP05. A fall not followed by an adjacent `TC` leaves the terminal write unattributed (`"?"`) |
| **CP07** | frame/step increment | `FS` (followed by `PS` `readSite="frame"`) | `camClass`, `camDigest` | Once per diagnostic rAF callback. The first data record is the capture-start `FS` at `frame=0`, `tRel=0` | **Steps are not observable** non-invasively. Only their camera effect (`camClass` change) and the edges at start and end are. FS vs tick order within a frame is not fixed | None | Missing capture-start `FS`: `INIT` is never definite (`NO_CAPTURE_BASELINE`). A missing per-frame `FS` cannot be detected by itself (frames are harness-counted), so every `frame` value 0..last MUST carry exactly one `FS` in the target window. A gap is `MALFORMED` |
| **CP08** | T4 sample acquisition | `T4` `t4Phase="start"` (once per settle) then `t4Phase="sample"` (followed by optional `NV`, then `PS` `readSite="t4Sample"`) | start: `settleRole` (`G` non-subject, never-deciding, never-measured settle, ≤ 2 per trace, e.g. the gate settle of N−1; `S` subject, exactly 1; `P` supersession/probe settle measured by the superseded C8, ≤ 1; counts per I4), `reqToken` (the fit this settle follows). sample: `settleRole`, `sampleIndex` (1..`maxSamplesPerSettle`, §8.4a; **not** the committed offline 64), `camClass`, `camDigest` | The sample is taken in the T4 loop after `waitFrame` (H:8411-8432). Camera read, then slot read, with no `await` between them (I3) | The `await sampleCamera()` microtask gap cannot admit a camera-moving callback [INF from task model]. Two task sources can move the camera: Viewer ticks are `setTimeout` tasks (V:17604), and autocam steps after step 0 are rAF callbacks (V:107155). Neither is a microtask, and the microtask checkpoint that resolves the `await` runs to completion right after the current task or rAF callback, before the event loop takes the next task or the next rAF callback FS and T4 sampling order within a frame is unspecified | `reqToken` on start is a **procedure association** (settle follows fit `k`), not proof that the camera belongs to `k` | Missing start: `SMP_WITHOUT_SST`-equivalent C3, whole trace. Sample without `PS`: `MALFORMED` |
| **CP09** | T4 equal/non-equal settle decision | `T4` `t4Phase="decision"` | `settleRole`, `sampleIndex` (0 only for a zero-sample timeout), `decision` (`none`/`settled`/`timeout`); `sampleSeq` except on a zero-sample timeout; `terminal=1` on the settle's single `settled`/`timeout` decision; `deciding=1` per I4 | Comparison decisions: synchronously after the sample's comparison (H:8420-8423), immediately after its `PS` (I4). Timeout decisions: at the deadline, anywhere after the settle's last record (I4) | `timeout` is the deadline firing (frozen 5,000 ms), not a sample comparison. A zero-sample timeout (e.g. no rAF delivered) is a legal transition with no `t_d` | Settle's `reqToken` (via start) | `settled` on `sampleIndex=1`: C3 `SETTLED_ON_FIRST_SAMPLE`. A sample after its settle's terminal decision: C3 `SMP_AFTER_DECISION`. Subject settle without a terminal decision: `TRUNCATED`. Subject zero-sample timeout: owner/subject `UNDIAGNOSABLE(NO_DECIDING_SAMPLE)`. Sample-count cap reached: overflow (§8.4a), never an early decision |
| **CP10** | restore invocation | `RS` `phase="pre"` | (common only) | Immediately before `viewer.restoreState(home, undefined, true)` (H:11557-11560), same segment as CP11 | — | None (a restore is not a request) | Missing pre while a post exists, or a pre not immediately followed by its post: `MALFORMED` (integrity code `RS-PAIR`) |
| **CP11** | restore camera write (if observable) | `RS` `phase="post"` | `restoreResult`, strict mapping: the call throws ⇒ `THROW`; returns a value `=== true` ⇒ `OK`; any other return (`false`, `undefined`, non-boolean) ⇒ `NOOP`. `NOOP` is a normal record, not an instrumentation or run error (the harness's own `resetHome` uses the same `=== true` test, H:11559). If not `THROW`: `camClass`, `camDigest`, `slotPresent`, `slotDelta`; `slotBinding` iff present | `seq = pre.seq + 1` (`RS-PAIR` otherwise). The immediate path writes the camera **synchronously** inside the call (V:38665-38677 → `syncCamera` V:38677) and does not touch slot or flag. The write is therefore observable **only** as this post-call read | An in-flight transition's next step overwrites the restore pose (DH-3b). `slotDelta ≠ none` here is a foreign slot write between reads (`"U"`) | None | `THROW` carries no read (committed rule). `OK` without `camClass`: `RESTORE` is never definite under `OPEN` (`UNREAD_WRITER`) |
| **CP12** | public camera-change event | `CE` | (common only) | — | Flag-coalesced, ≤ 1 per tick, also on resize (O-15) | None | **Not captured in the minimum** (`P-CC` changes no verdict). The kind is reserved. A `CE` record in a trace whose capability set lacks `P-CC` is `MALFORMED`. Enabling it is an owner decision and it is never proof (R3) |
| **CP13** | formal transition completion | `TC` | (common only) | Synchronous inside the final step, at `seq = fall.seq + 1` when attributable (R4) | Not fired for immediate, early-return, view-cube or same-pose transitions | None. Attributable to the fall's active token only if adjacent, and under `OPEN` that token is `WINDOW` | Listener absent: `Q-ATTR` `UNAVAILABLE`, owner/subject `OBSERVABLE_ABSENT:P-TC`. `TC` with no active transition while `V-EDGE` is captured: C3 `TC_WITHOUT_ACTIVE` |
| **CP14** | C8/frustum measurement | `C8` | `sampleSeq` (the terminal sample of a settled `S` or `P` settle, I5), `camDigest`, `measureRole` (`subject`/`superseded`), `targetKey` (procedure-named target id, ≤ 32 chars), `evaluable` (0/1), `inside` (0/1) | After the settle resolves. The harness evaluates `frustumPredicate` on the returned `settle.camera` values (subject C8 path H:8512, superseded H:8518; also H:8465, H:8489), **not** on a re-read. Other records may intervene. Binding is by `sampleSeq` + `camDigest` + `measureRole`↔`settleRole` (I5), never by position | None. Same values as that settle's terminal sample (O-26) | Settle token via `sampleSeq` | `camDigest` mismatch, role mismatch, or the referenced settle not `settled`: the C8 observation is `UNDIAGNOSABLE` for that question. Offline re-evaluation needs the referenced terminal sample's `NV`; if it was not retained (C7), numeric reproduction is `AMBIGUOUS(NUMERIC_NOT_RETAINED)`. A post-quiescence re-measure (DH-8) is a distinct observation and is **not** part of this record |
| **CP15** | diagnostic terminalization | `TZ` | `tzPhase` (`targetEnd`/`final`), `tzCause` (`normal`/`stop`/`error`) | `targetEnd` closes the target window. `final` is the last data record before `END` (I6) | Nothing after `final` except `END` | — | Missing `TZ`: `TRUNCATED` (C4, whole trace). `tzCause ≠ normal`: Part 2 maps it (never positive evidence) |

`CT` (control result) is not a prompt §8 capture point. It is defined by Part 2's control matrix. Part 1 fixes only its placement (control window, I6) and minimal fields: `controlId`, `controlOutcome` (`PASSED`/`FAILED`/`NOT_RUN`), `framesUsed`, `frameBudget`.

### 8.3 Normative wire schema (data records)

**Serialization.**
- Canonical JSON under D2 conventions: UTF-8, keys sorted, no insignificant whitespace (`canonical.mjs`).
- Each record is one object. Absent fields are **omitted**, never `null`. Lookups are own-property only (DS §6.1.2).
- Enum values are written as the exact strings listed here.
- The data-record schema defined here is a **new** live schema. The committed `META.sv = 1` denotes the committed DiagEvent schema, so Part 2's `META` MUST carry a distinct schema version for traces of these kinds. That version value is Part 2's choice.
- **Shared keys with the envelope (precise rule; remediated, §12).** Exactly three data wire keys also occur as `META`/`END` keys: the common keys `k`, `f` and `tm`. They carry the same meaning in every record (record kind; frame counter; tenths of a millisecond since the origin, which `META` fixes at `f = 0`, `tm = 0` and `END` records at close). Every other data wire key below is distinct from every committed and schema-2 `META`/`END` key. A data record that carries a `META`/`END` key that is **not** a data wire key (an envelope-only key) is `META-FIELD-IN-DATA` (DS §6.1.3). Part 2 Appendix (i) `wireKeyCollisionRule` lists the allowed shared set, and the prototype asserts that the computed intersection equals it.
- **Byte caps:** every non-`NV` record MUST stay ≤ 256 B at its worst-case field values (DS §6.4(b)). Part 2 owns the caps and re-verifies the worst case for exactly these keys (Part 2 §12.4: largest non-`NV` record 204 B). The `NV` cap stays 406 B because `NV` keeps its committed keys (schema-2 worst case 403 B, Part 2 §12.4).

**Wire keys** (logical → wire):

| Logical | Wire | Logical | Wire | Logical | Wire |
|---|---|---|---|---|---|
| `kind` | `k` | `slotDelta` | `sx` | `sampleSeq` | `ss` |
| `seq` | `q` | `hostSeq` | `hq` | `terminal` | `te` |
| `frame` | `f` | `readSite` | `rd` | `deciding` | `fr` |
| `tRel` | `tm` | `camClass` | `cl` | `restoreResult` | `rs` |
| `runId` | `rn` | `camDigest` | `dg` | `measureRole` | `mr` |
| `reqToken` | `r` | `edgeValue` | `ev` | `targetKey` | `tk` |
| `phase` | `pp` | `payloadActive` | `pa` | `evaluable` | `el` |
| `callOutcome` | `co` | `t4Phase` | `tp` | `inside` | `in` |
| `slotPresent` | `sp` | `settleRole` | `s` | `tzPhase` | `zp` |
| `slotBinding` | `sb` | `sampleIndex` | `n` | `tzCause` | `zc` |
| `slotNew` | `nw` | `decision` | `d` | `controlId` / `controlOutcome` / `framesUsed` / `frameBudget` | `ci` / `cr` / `fu` / `fb` |

**Per-variant fields.** Every data record has the common fields `k`, `q`, `f`, `tm` and MAY carry `rn` (never on `NV`). In the table, **R** = required, **C** = conditional (condition given), and **—** = forbidden. Any key not listed for a variant is forbidden. A record that violates its variant is rejected by the recorder before any state change (counted as `iv`, DS §6.1.3).

| Variant | R | C | Notes |
|---|---|---|---|
| `RQ` pre | `pp="pre"`, `r`, `sp`, `sx` | `sb` iff `sp=1` | — `co`, `nw`, `cl`, `dg` |
| `RQ` post returned | `pp="post"`, `r`, `co="returned"`, `sp`, `sx`, `nw`, `cl`, `dg` | `sb` iff `sp=1` | |
| `RQ` post threw | `pp="post"`, `r`, `co="threw"` | — | — every slot/camera key |
| `PS` | `hq`, `rd`, `sp`, `sx` | `sb` iff `sp=1` | `sx="clear"` ⇒ `sp=0` |
| `TE` | `ev`, `pa` | — | `pa ≠ ev` ⇒ C3 contradiction |
| `FS` | `cl`, `dg` | — | |
| `T4` start | `tp="start"`, `s`, `r` | — | |
| `T4` sample | `tp="sample"`, `s`, `n` (≥ 1), `cl`, `dg` | — | |
| `T4` decision | `tp="decision"`, `s`, `n`, `d` | `ss` iff `n ≥ 1`; `te=1` iff `d ∈ {settled, timeout}`; `fr=1` per I4 | `n=0` ⇒ `d="timeout"`, `te=1`, no `ss`, no `fr` |
| `RS` pre | `pp="pre"` | — | |
| `RS` post | `pp="post"`, `rs` | if `rs≠"THROW"`: `cl`, `dg`, `sp`, `sx` (R) and `sb` iff `sp=1` | `rs="THROW"` ⇒ no read keys |
| `CE` | — | — | only if `P-CC` is in the capability set (never in the minimum) |
| `TC` | — | — | |
| `C8` | `ss`, `dg`, `mr`, `tk`, `el`, `in` | — | `el=0` ⇒ `in=0` |
| `TZ` | `zp`, `zc` | — | |
| `CT` | `ci`, `cr`, `fu`, `fb` | — | control window only (I6) |
| `NV` | committed (`k`, `q`, `f`, `tm`, `nv`) | — | immediately after its `T4` sample |

**Projection to the committed DiagEvent kinds (normative pseudocode).** The committed correlator (`correlate.mjs`) is consumed **unchanged**. The projection is deterministic and runs only on a trace that has passed whole-trace integrity (Part 2) and the I1–I7 checks. Only the target window is projected (records before `TZ targetEnd`).

**Committed-schema representability (added in reconciliation with Part 2).** The committed live event schema (`schema.mjs`) accepts `n ∈ 1..64` on `SMP`, `q ∈ 1..8,192`, and requires `pd`/`cl` on every `FIT` read when `V-PEND`/`P-FRM` are configured. A schema-2 trace can legally exceed all three. The projection therefore:
- **compacts long settles** (state-preserving): for a `G`/`S` settle with more than 64 samples, samples 1..63 project as `SMP` `n = 1..63`, samples 64..last−1 project as `CAM`, and the settle's last sample projects as `SMP` `n = 64` carrying the terminal `d`/`fr`. This preserves every question output, because the committed correlator processes `SMP` and `CAM` reads through the same `onRead` + `refreshSlot` path and uses `SMP` only for the per-role index check, `SETTLED_ON_FIRST_SAMPLE` (the projected terminal index is 64, never 1) and the `fr` snapshot (`correlate.mjs` main loop, `case 'SMP': case 'CAM'`). The projected `n` is not the raw sample index; the raw index stays in the trace;
- **stamps** `q` = 1-based projected position and keeps `f`, `tm` (live mode requires `q` and `tm`);
- **refuses unrepresentable input** before calling the correlator: a target-window `RQ` post with `callOutcome = "threw"` (a committed `FIT` cannot omit its reads), or more than 8,192 projected events. Each makes every sound question `UNDIAGNOSABLE(PROJECTION_UNREPRESENTABLE:FIT_THREW|CAPACITY)` for that trace. The trace stays intact; Part 2 maps this to target-level `INCONCLUSIVE`, never to positive evidence. Part 2 §12.4a sizes the target-window frame budget so that `CAPACITY` cannot occur within the bound budgets.

```
project(records, edgeInit):
  if any target-window RQ post has co == "threw": return UNREPRESENTABLE("FIT_THREW")
  total = {}                  # settle start seq -> sample count of that settle (precomputed from the raw trace)
  out = []; pendingFit = {}   # reqToken -> RQ pre
  pendingRst = null
  hostOf = {}                 # host seq -> index in out (for PS -> pd)
  slotFields(r) = (r.sp == 1) ? { p: 1, b: r.sb } : { p: 0 }        # ID-ON encoding
  for r in records (target window, seq order):
    switch r.k:
      RQ pre:   pendingFit[r.r] = r
      RQ post:  pre = pendingFit.pop(r.r)
                if r.co == "threw":
                  out.push({k:"FIT", f:r.f, tm:r.tm, r:r.r})       # no read; token NO_REQUEST_OR_UNRESOLVED
                else if r.q != pre.q + 1:                          # interleaved (I1): refuse binding
                  out.push({k:"FIT", f:r.f, tm:r.tm, r:r.r, cl:r.cl, dg:r.dg,
                            pq:slotFields(pre), pd:{...slotFields(r), nw:0}})
                else:
                  out.push({k:"FIT", f:r.f, tm:r.tm, r:r.r, cl:r.cl, dg:r.dg,
                            pq:slotFields(pre), pd:{...slotFields(r), nw:r.nw}})
      RS pre:   pendingRst = r
      RS post:  e = {k:"RST", f:r.f, tm:r.tm, rs:r.rs}
                if r.rs != "THROW": e.cl = r.cl; e.dg = r.dg; e.pd = slotFields(r)
                out.push(e); pendingRst = null
      FS:       hostOf[r.q] = out.push({k:"CAM", f:r.f, tm:r.tm, cl:r.cl, dg:r.dg}) - 1
      T4 start: if r.s in {"G","S"}: out.push({k:"SST", f:r.f, tm:r.tm, s:r.s, r:r.r})
                # "P" settles have no committed SST; their samples project as CAM reads
      T4 sample:N = total[current settle of r]
                if r.s == "P" or (N > 64 and 64 <= r.n < N):              # P samples; long-settle middle (compaction)
                  hostOf[r.q] = out.push({k:"CAM", f:r.f, tm:r.tm, cl:r.cl, dg:r.dg}) - 1
                else:
                  pn = (N > 64 and r.n == N) ? 64 : r.n                    # terminal sample of a long settle -> 64
                  hostOf[r.q] = out.push({k:"SMP", f:r.f, tm:r.tm, s:r.s, n:pn, d:"none", cl:r.cl, dg:r.dg}) - 1
      T4 decision (s in {"G","S"}):
                if r.n >= 1 and out[hostOf[r.ss]].k == "SMP":           # decisions on compacted CAM samples are "none"
                  smp = out[hostOf[r.ss]]; smp.d = r.d; if r.fr == 1: smp.fr = 1
                # n == 0 (zero-sample timeout): nothing projected; if s == "S" the correlator sees no fr
                #   and returns UNDIAGNOSABLE(TRUNCATED), reported by Part 2 as NO_DECIDING_SAMPLE
      PS:       out[hostOf[r.hq]].pd = slotFields(r)
      TE:       out.push({k:"AE", f:r.f, tm:r.tm, ev:r.ev})
      TC:       out.push({k:"TC", f:r.f, tm:r.tm})
      CE:       out.push({k:"CC", f:r.f, tm:r.tm})                # only when P-CC is configured
      NV, C8, CT, TZ: not projected (C8 is evaluated by Part 2 against I5; NV feeds numeric re-checks)
  if edgeInit != "LOW": remove every AE and drop V-EDGE from the configured atoms (§8.4; C6 composition)
  if len(out) > 8192: return UNREPRESENTABLE("CAPACITY")
  for i, e in enumerate(out): e.q = i + 1                           # committed live schema requires q (1..8192)
  return out   # then the committed C6 guard / projection and correlate(out, {mode:"live", slotWindow, …})
```

Notes:
- `q` is stamped as the 1-based projected position (DS §6.1.2 position convention; the committed live schema requires it and bounds it at 8,192).
- On an interleaved `RQ` post (I1), the recorder does not bind the new object. Its `sb` is therefore `"U"`, which drives the committed correlator to `IDENTITY_AMBIGUOUS`.
- The `T4` timeout decision that follows non-adjacent records still projects onto its own sample (`ss`). The committed C3 checks therefore see `d="timeout"` on the settle's last sample, exactly as the committed schema encodes a timeout.
- `slotDelta` and `slotNew` mismatches are checked by I7 before projection. The committed correlator expresses a foreign object through `"U"`, which `sb` carries directly.

**Golden fixtures (required of the prototype).** For each variant row above, and for the I1 interleaved case, the zero-sample timeout, a `P`-settle superseded `C8`, a > 64-sample settle (compaction), a threw `RQ` (unrepresentable), a two-`G` P6-shaped plan, a control-window `RQ` pair, and each §8.4 edge-initialization fixture, the prototype MUST commit:
- a raw record list;
- its canonical bytes and per-record byte counts;
- the projected committed-kind list;
- the SHA-256 of each.

Two independent runs must reproduce them byte-for-byte.

### 8.4 Target-window boundary: transition-active and slot initialization (remediation of Codex C-1)

`V-EDGE` reports changes only (V:96759-96763). A trace therefore needs one **exact boundary state**.

- **Boundary read.** The final read of the committed quiescence check (DS §6.1.3 step 2) is two strict reads: `navigation.getTransitionActive() === false` (VB-2) and `navigation.getRequestTransition() === null` (VB-1).
  - It runs in the **same synchronous segment** as writing `META` and the capture-start `FS`. Nothing else can run in between.
  - It is a **preflight read**, not a capture atom. `V-ACT` stays excluded. VB-2 presence is already a `META.vb` row.
- **`edgeInit = "LOW"`** iff all of the following hold:
  - the `TE` listener was registered (recorder state `CREATED`, §8.6) **before** the quiescence window began;
  - no `TE` was dispatched during that window;
  - the boundary read returned exactly `false` / `null`.
- **Otherwise `edgeInit = "UNKNOWN"`.** The committed rule already says the run does not start without quiescence. If a future procedure nevertheless starts under `UNKNOWN`, the projection removes all `AE` events and drops `V-EDGE` (§8.3). Every definite owner/subject/attribution label then drops to 0 (DS §8.6 necessity). This needs no correlator change.
- The slot baseline for I7 is the same boundary read (`null`).
- Part 2 MUST bind `edgeInit` and the boundary-read result into the immutable `META`.
- **Fixtures (named in the Appendix):**
  - `edge-init-rise-before-target-start`: a rise during the quiescence window means quiescence fails, so no trace. If forced: `UNKNOWN`, then `V-EDGE` is disabled.
  - `edge-init-fall-after-target-start`: a fall in the target window with no rise in it. Under `LOW` this is C3 `FALSE_EDGE_WITHOUT_TRUE` (whole trace). Under `UNKNOWN`, `V-EDGE` is disabled.
  - `edge-init-already-high-at-listener-registration`: the boundary read returns `true`, so the run does not start. If forced: `UNKNOWN`.

### 8.4a Sample-count bound (remediation of Codex C-2)

- The committed `n ∈ 1..64` (`schema.mjs`; DS §6.4(b) "settle samples per settle 64") mirrors D2's synthetic stand-in. It is **not** inherited for live records.
- Live: `maxSamplesPerSettle = floor(deadlineMs × maxRefreshHz / 1000) + 1`, with `deadlineMs = 5,000` (the frozen T4 deadline) and `maxRefreshHz` a declared design constant. The proposed value is 360, which gives 1,801.
- The run's measured rAF rate must not exceed `maxRefreshHz` (Part 2 `SC-A17`, checked at the live preflight P0.13, before the attempt is consumed).
- Real T4 is unchanged. The recorder never stops, shortens or decides a settle.
- If any cap (sample index, data-event count or bytes) would be exceeded, the append is rejected and `END.overflow = 1`. The whole trace is then `UNDIAGNOSABLE(OVERFLOW)`, mapped to run-level `INCONCLUSIVE`/`INVALID` by Part 2. It is never an early settle or timeout.
- Required fixture: more than 64 unequal samples followed by a valid `settled` decision. It must be accepted, with `n` reaching ≥ 65, and its projection must be compacted (§8.3) and correlated without `MALFORMED`.
- The data-event cap, the byte cap and the target-window frame budget are derived in Part 2 §12.4a (resolution of contradiction 8 below).

### 8.5 Live `camClass` construction and transitivity gate (remediation of Codex I-2)

- **Algorithm.** The committed algorithm (DS §8.5) is carried over unchanged and applied online, in `seq` order, over **all** camera-bearing records of the trace (`RQ` post, `RS` post, `FS`, `T4` sample, including `P` settles). A value receives the index of the first existing class whose **first member** satisfies `cameraSamplesWithin(·,·,1e-9)` (H:8386-8390). Otherwise it opens a new class.
- **Same sampling function.** Every site uses the harness `sample()` function (H:11550-11555), so values are comparable.
- **Online transitivity gate.** The committed offline gate is carried over. The recorder keeps every distinct observed value in memory, never in the trace; the memory is bounded by the data-event cap. On each new value `v` it checks:
  - the classes containing **any** member within 1e-9 of `v` number at most one;
  - if that class exists, `v` is within 1e-9 of **every** member of it.

  If either check fails, the relation is not an equivalence over the observed values. The recorder sets a terminal gate failure, which Part 2 binds into `END`. The whole trace is then `UNDIAGNOSABLE` (reason `CLASS_NONTRANSITIVE`), because class-dependent results (`PRE_MOTION`, unbracketed changes, R5) are order-dependent in that case.
- **Offline verifiability.** The `NV` of every class's first member and of every settle's terminal sample is **retention-priority** (Part 2 retention policy). Offline analysis can therefore re-derive class membership against the representatives and re-run the frustum predicate. If a priority `NV` was not retained (C7), class re-derivation for the affected records is `AMBIGUOUS(NUMERIC_NOT_RETAINED)`.

### 8.6 Recorder lifecycle and listener ownership (remediation of Codex I-5)

`CREATED → CAPTURING → CONTROL → FINALIZING → CLOSED`. State changes are one-way.

| State | Entered when | Allowed | Listeners |
|---|---|---|---|
| `CREATED` | recorder constructed | quiescence window and boundary read (§8.4). No data records; observed `TE` dispatches only mark quiescence failure | `TE` (V-EDGE) and `TC` (P-TC) listeners registered here, owned by the recorder, with the exact function references retained |
| `CAPTURING` | `META` + capture-start `FS` written (same segment as the boundary read) | target-window data records | unchanged ("never removed" during capture) |
| `CONTROL` | `TZ targetEnd` appended | control-window records and `CT` (I6) | unchanged |
| `FINALIZING` | `TZ final` appended | no data appends | removed with the retained references. Teardown is idempotent: a guard flag makes a second call a no-op |
| `CLOSED` | `END` written | nothing | none |

- In `FINALIZING` and `CLOSED`, any callback returns immediately, **before** validation. It changes no counter (`rj`/`iv`), no sequence number and no trace byte.
- **One recorder per page load.** Constructing a second recorder in a page that already had one is refused (Part 2 `SC-B01`; the runbook uses a fresh page per trace, including one per Phase-2 control). `META.rc` records the ordinal, which must be 1. Stale listeners from an earlier diagnostic therefore cannot double-record.
- Required fixtures:
  - a late `TE`/`TC` after `TZ final`: trace bytes and counters are unchanged;
  - a repeated teardown: no-op;
  - a second-recorder attempt: refused.

---

## 9. Pre-motion ambiguity (the 5,063 `ACTIVE0` class)

### 9.1 What the class is [SRC]

`goToView` sets `elapsedTime = 0` (V:106816) and calls `animateTransition` synchronously (V:106817). That first step raises the flag (V:107122) and computes `unitTime = _easeClamp(elapsedTime/duration, 0, tMax)` with `elapsedTime = 0` (V:107125) **before** incrementing `elapsedTime` (V:107127). Step 0 therefore interpolates with `unitTime = ease(0)` and moves the camera nowhere: zero motion, up to floating-point recomputation by `lookAt` [INF]. Later steps run on rAF (V:107155). `ACTIVE0` is "consumed, step 0 done, no visible later step at `t_d`". In D2 it is the entire assumption-mode residual (5,063). Under `OPEN` those same schedules are already non-definite for `Q-SUBJ` with reason `UNOBSERVED_SLOT_WINDOW`, which takes precedence, so `OPEN` gains nothing from resolving them.

### 9.2 Recognition rule (mechanical; target window only)

Let `D` be the subject's deciding `T4` sample. Let `E` be the last `TE` with `edgeValue = 1` and `E.seq < D.seq`, such that no `TE` with `edgeValue = 0` has `seq ∈ (E.seq, D.seq)`. Let `B` be the last camera-bearing record (`FS`, T4 `sample`, `RQ` post with `camClass`, `RS` post with `camClass`) with `seq < E.seq`. Let `C` be the camera-bearing records with `seq ∈ (E.seq, D.seq]`.

```
PRE_MOTION(trace) :=  E exists
                  ∧ B exists
                  ∧ ∀ c ∈ C : c.camClass = B.camClass
                  ∧ ¬∃ RS(post, restoreResult="OK") with seq ∈ (E.seq, D.seq]
```

`camClass` is the projection-local 1e-9 class (DS §8.5). The rule needs no token. It holds whoever owns `E`.

### 9.3 Distinguishability from the five alternatives (minimum set)

| Alternative | Distinguishable from `PRE_MOTION`? | Discriminator |
|---|---|---|
| request not consumed | **Yes**, if the `t_d` slot read exists | `PS(hostSeq = D.seq)` with `slotBinding = S` gives definite `PENDING`. That is an object-identity read, not order. Without that read: not distinguishable |
| consumed, zero-motion first step | **Not an alternative.** This *is* `ACTIVE0` (V:106816, V:107125). What is indistinguishable is `ACTIVE0` versus `ACTIVE_PLUS` with steps whose 32-entry change is ≤ 1e-9 or exactly zero (a same-pose destination, a sub-epsilon tail) | None in the minimum. `P-XS` sees only non-zero sub-1e-9 changes. No read sees a step that writes identical values (R5) |
| pending-slot hold | **Yes** | A held subject object is still visible at `t_d` (`PENDING`). `PRE_MOTION` needs a rise after which the subject is not visible |
| transition not yet active | **Yes**, with a residual | No rise since binding gives `PENDING`, or a `CLEAR_WITHOUT_EDGE` GAP (§10), which is itself `IDENTITY_AMBIGUOUS` |
| stale observation | **Yes**, for staleness relative to the rise | `E.seq < D.seq` means the sample was read after the rise in execution order. Steps update the matrices synchronously (V:26673 → V:33470), so a read after a step reflects it. A sample ordered before the rise is a pre-consumption read and is not in this class. This is timing evidence, not ownership evidence |

### 9.4 Would an extra observable soundly resolve it, and is it justified? **No.**

- **VB-6 autocam progress** (`elapsedTime`, `currentlyAnimating`, V:107080-107155) would count executed steps. It would separate `ACTIVE0` from `ACTIVE_PLUS` with invisible steps, but only for "the current autocam transition", whose request identity is still the §10 gap. Every label it could add is `ACTIVE_PLUS`/`IN_FLIGHT`, and those are assumption-only. Under `OPEN` it changes nothing. It is also excluded for drift risk (DS §6.1.4).
- **VB-7 write wrappers** are invasive (excluded). **VB-8** (frame counter) has no public reference. **`P-XS`** is blind to identical-value steps.
- Conclusion: no candidate changes an `OPEN` outcome, and the assumption mode is itself an owner decision. Adding an observable is **not justified**.

### 9.5 Fail-closed rule (mechanical)

```
if PRE_MOTION(trace):
    annotation preMotionUnresolved := true
    out["Q-OWNER"] is necessarily AMBIGUOUS   # committed correlator: a rise is open at D (activeTok != NONE) and
                                              # changedSinceEdge = false; reason by committed precedence
                                              # (e.g. UNOBSERVED_SLOT_WINDOW, else ACTIVE_WITHOUT_VISIBLE_STEP)
    out["Q-SUBJ"]  is the committed correlator output, unchanged:
                   DEFINITE "PENDING" iff PS(hostSeq = D.seq).slotPresent = 1 ∧ PS(hostSeq = D.seq).slotBinding = S;
                   never "ACTIVE0"; under OPEN every other outcome is AMBIGUOUS
run-level (Part 2): preMotionUnresolved = true  ⇒  INCONCLUSIVE for every owner-at-t_d hypothesis, and for every
                    subject-state hypothesis unless out["Q-SUBJ"] is DEFINITE; never SUPPORTED or REJECTED from it
```

The `Q-OWNER` consequence is not a new rule. The committed correlator already returns `AMBIGUOUS` whenever `PRE_MOTION` holds. The only new element is the trace-level flag, which lets Part 2's verdict model fail closed at run level. No speculative attribution is made.

---

## 10. Pending-clear → active-edge gap

### 10.1 Source facts [SRC]

In one tick, `update()` reads the slot into the local `request` (V:105006), checks the flag is low (V:105007), clears the slot (V:105009), then calls `transitionView` (V:105010). `transitionView` calls `autocam.goToView` (V:104763). If gotoview is enabled (V:106802), `goToView` runs `animateTransition` (V:106817), which raises the flag (V:107122) and dispatches the edge (V:96763).

- **Clear and rise are in one synchronous call stack.** No other script can run between them. The "gap" is therefore not a time interval an observer could sample inside.
- **The unobservable interval runs from the last visible slot read to the rise.** A writer acting in that interval can replace the slot object, and that object is then consumed without any read seeing it.
- **No non-invasive read can be placed inside that interval.** No public event fires before the tick: `VIEWER_RENDER_TICK` fires *after* `_animLoop` (V:17626-17631).
- **The consumed object is unrecoverable.** It survives only in the local `request` and in the rAF closure (V:107155). Completion carries `{type}` only (V:26685).
- **A clear can have no rise at all**, if gotoview is disabled (V:106802) or another `setRequestTransition(false)` runs.

### 10.2 How the trace records it

The gap is **not** a raw record. It is a derived **`GAP` annotation** that the offline analysis computes from raw records. Visible slot reads are `RQ` pre, `RQ` post (`returned`), `RS` post (non-`THROW`) and `PS`.

```
for each TE e with edgeValue = 1 (target window):
    v := last visible slot read with v.seq < e.seq
    GAP { openSeq: v.seq, closeSeq: e.seq,
          boundBefore: (v.slotPresent = 1 ? v.slotBinding : null),
          gapClass: v.slotPresent = 0                       -> "EDGE_AFTER_EMPTY"
                    v.slotBinding is a token                -> "CONSUME_EDGE_BOUND"
                    v.slotBinding = "U"                     -> "CONSUME_EDGE_UNBOUND",
          inferredToken: null,                              # always, under OPEN
          assumedToken: (ASSUME ∧ R3 preconditions hold ? v.slotBinding : absent) }
for each consecutive pair of visible slot reads (v1, v2) with v1.slotPresent = 1, v2.slotPresent = 0
    and no TE rise with seq ∈ (v1.seq, v2.seq):
    GAP { openSeq: v1.seq, closeSeq: v2.seq, boundBefore: v1.slotBinding, gapClass: "CLEAR_WITHOUT_EDGE", inferredToken: null }
```

### 10.3 What may and may not be inferred

- **May infer:**
  - "The flag rose at `closeSeq`".
  - For `CONSUME_*` classes, "consistent with a slot consumption". It is not certain: the flag is shared.
  - "The slot was cleared in `(openSeq, closeSeq)`" for `CLEAR_WITHOUT_EDGE`.
  - Negative evidence: if a bound object `X` is **visible at a read after** `closeSeq`, then the rise at `closeSeq` was not `X`'s consumption. Writes create fresh objects, and no code path reassigns an old object (the only assignments are V:95294, V:96698, V:96709, V:96727, V:96738). This is object-identity evidence, not order.
- **May not infer:**
  - which object was consumed;
  - that the rise belongs to the subject, or to any harness request;
  - that the next fall or `TC` belongs to `boundBefore`;
  - that no foreign writer acted;
  - any attribution from event order alone (`ORDER_ONLY` counts as `AMBIGUOUS`).

### 10.4 When correlation stops

- From the first `GAP` with `[openSeq, closeSeq] ∩ [subject RQ post.seq, D.seq] ≠ ∅`, every **token-dependent** subject output is `AMBIGUOUS(UNOBSERVED_SLOT_WINDOW)` under `OPEN`. That covers `OWN`/`PRIOR_TERMINAL`/`IN_FLIGHT`, `ACTIVE_PLUS`/`COMPLETE`, and non-empty `Q-ATTR`. Under the assumption mode these outputs carry `assumption: NO_UNOBSERVED_WRITER`.
- `EDGE_AFTER_EMPTY` gives `IDENTITY_AMBIGUOUS` under `OPEN` (DH-6a evidence), and C3 `TRUE_EDGE_EMPTY_SLOT` (whole trace) under the assumption.
- `CLEAR_WITHOUT_EDGE` gives `IDENTITY_AMBIGUOUS` for the cleared token in both modes. The committed correlator is consumed unchanged and does not always report it (it may still return a definite `PENDING` when the read at `D` shows the token again, which §10.4a shows is source-impossible), so Part 2 enforces it as target rule **T1c** on the annotation: `Q-SUBJ` when the subject token was cleared; `Q-OWNER` with a token label (`OWN`/`PRIOR_TERMINAL`/`IN_FLIGHT`) when any token was cleared; `Q-ATTR` when a listed token was cleared → `INCONCLUSIVE(IDENTITY_AMBIGUOUS:CLEAR_WITHOUT_EDGE)`. The annotation still never overrides a correlator output upward; it can only withdraw a definite label.
- Token-free outputs continue, subject to the committed precedence: `PENDING` read at `D` (only if no prior identity ambiguity, i.e. no earlier `"U"`, §6.3 Q-SUBJ), and `RESTORE`/`INIT` decided by edges (only if `edgeInit = "LOW"`, §8.4).

### 10.4a Token reappearance is a source-fact contradiction (mechanical)

A token binds exactly one slot object, at CP02. Writes create fresh objects, and no code path reassigns an old object (V:95294, V:96698, V:96709, V:96727, V:96738; §10.3). Therefore:

```
for the visible slot reads v1 < v2 < v3 of the target window:
    v1.slotBinding = k (a token)  ∧  v2 does not show k (slotPresent = 0, or another binding)  ∧  v3.slotBinding = k
    ⇒  TOKEN_REAPPEARED(k)    # offline-detectable; contradicts a pinned source fact
```

`TOKEN_REAPPEARED` means some code outside the pinned source premise re-assigned a retained slot object (an extension, a Viewer path outside `viewer3D.js`, or broken instrumentation). It is not an integrity code, because the trace is intact; it is a Part 2 `SC-C04` contradiction: every target is `INCONCLUSIVE` (Part 2 rule T0c), the verdict is withheld, and the finding goes to the owner. It never yields a definite `PENDING`.

### 10.5 Can later observation resolve the gap? **No.**

Later observations cannot recover the consumed object (§10.1). A terminal-pose value match against a retained destination is a value match only (§7.3). A later absence of `"U"` cannot exclude a writer whose object was consumed unseen. The only later evidence with any force is the negative object-identity evidence in §10.3, which excludes one object but never identifies the consumed one. The gap stays fail-closed for the life of the trace.

---

## 11. Contradictions found

No contradiction with a committed conclusion was found. (The prototype findings remediated in §12.1 were internal spec defects of this package, not contradictions with committed conclusions.) Schema v3, NV 406 B, 2,048 configurations with 0 wrong labels, 0 public-only labels, 5,063, gap fail-closed, C8 unresolved and "VB-3 control is not historical proof" are all unchanged. Several clarifications follow. None changes a result:

1. **Prompt §7 terminology versus committed atoms.** The prompt glosses `P-FRM` as "public frame index" and `P-TC` as "public step/transition count". The committed atoms are wider and differ: `P-FRM` is a camera-value observable whose frame index is harness-local, and no public step counter exists (§7.2). The committed definitions are kept.
2. **"Gap" is epistemic, not temporal.** The clear (V:105009) and the rise (V:107122) are in one synchronous stack. The unobservable interval is last-visible-read → rise. A clear with no rise is possible (V:106802). This refines DS §6.2 R3 consistently.
3. **5,063 is an assumption-mode residual.** Under `OPEN` the same schedules are already non-definite, mostly as `UNOBSERVED_SLOT_WINDOW`. Resolving pre-motion would not raise `OPEN` coverage (§9.1).
4. **`Q-ATTR` "0 definite under `OPEN`" is a D2 property.** It holds because every D2 schedule has a completion. A live trace with no `TC` gives a definite but uninformative `"-"`, which is not counted (§6.2 note).
5. **Name collisions.** Record kind `C8` (frustum measurement) is unrelated to DS §6.3 case `C8` (malformed trace) and to the historical C8 request. Record kind `T4` records the frozen T4 settle rule's observations and does not alter it.
6. **Locator precision.** DR §6 gives the VB-3 dispatch as V:96760-96764. The exact `fireEvent` line is V:96763, inside that range. The research doc's VB-2 getter V:96772-96775 and VB-1 getter V:96747-96750 match the bundle.
7. **Committed live sample bound versus the frozen T4 deadline (genuine design conflict, remediated here).** DS §6.4(b) and `schema.mjs` (`n ∈ 1..64`) bound live settle samples at 64. The unchanged harness samples once per animation frame until the 5,000 ms deadline (H:8411-8432), so a long settle exceeds 64 samples after about 1.07 s at 60 Hz. Part 1 does not inherit 64 for live records (§8.4a). No committed *conclusion* depends on it: it is an offline/D2 stand-in.
8. **Committed live data-event cap may be small for worst-case settles (resolved in Part 2 §12.4a).** At 60 Hz each settle frame costs about 5 records (`FS`, `PS`, `T4` sample, `PS`, `T4` decision). Several 5 s timeouts plus per-frame `FS` can approach or exceed the committed 8,192 data-event cap (DS §6.4(b)). Overflow is fail-closed (`UNDIAGNOSABLE`), so this is safe, but it could make a run uninformative. Part 2 now derives schema-2 caps from the worst-case record count (24,576 data events; the committed schema-1 caps and code are unchanged).
9. **Committed-schema representability of the projection (found in reconciliation).** The committed live event schema bounds `SMP.n` at 64 and `q` at 8,192 and requires reads on every `FIT`. The earlier projection passed raw `n`, set no `q` and projected throwing fits, so a long settle or a throwing fit would have made the correlator report `MALFORMED` (run `INVALID`). §8.3 now compacts long settles (state-preserving), stamps `q`, and refuses unrepresentable traces as `PROJECTION_UNREPRESENTABLE` (target `INCONCLUSIVE`). The committed correlator and schema are unchanged.

---

## 12. Internal review log (Part 1)

The Part 1 draft was reviewed by Codex (`codex-review spec`, medium, request `20261006-093801-3907-17991`). The verdict was "requires major revision": 5 Critical and 5 Important findings. All were remediated in this file. None was dismissed, and the committed correlator was not amended.

| Finding | Disposition | Section |
|---|---|---|
| C-1: transition-active state unknown at the target boundary | Fixed. An exact same-segment boundary read (quiescence read) gives `edgeInit`. Under `UNKNOWN`, `V-EDGE` is disabled. Three fixtures named | §8.4, §6.3 Q-OWNER |
| C-2: the 64-sample cap conflicts with the 5 s T4 loop | Fixed. The live bound is derived from deadline × max refresh rate. Exhaustion is overflow, never an early settle. Recorded as contradiction 7 | §8.4a, §11 |
| C-3: zero-sample timeout | Fixed. An explicit transition with no `t_d` and no `C8`, giving `NO_DECIDING_SAMPLE` | I4, CP09 |
| C-4: superseded C8 cannot satisfy I5 | Fixed. Settle role `P`, a per-settle `terminal` marker, and C8 bound to a terminal sample. `deciding` stays unique | I4, I5, CP08, CP14 |
| C-5: incomplete wire contract | Fixed. Complete key map, per-variant required/conditional/forbidden fields, projection pseudocode and golden-fixture requirement | §8.3 |
| I-1: `PENDING` precedence | Committed precedence adopted (an earlier `"U"` ⇒ `IDENTITY_AMBIGUOUS`). Prose qualified | §6.3 Q-SUBJ, §10.4 |
| I-2: `camClass` algorithm / transitivity | Committed algorithm and gate carried over online. `CLASS_NONTRANSITIVE` fails closed. `NV` retention priority | §8.5 |
| I-3: `slotDelta` inconsistency | `slotDelta` on every visible slot read, with baseline and `slotNew` relation defined | I7, CP01, CP02 |
| I-4: `restoreResult` mapping | Strict mapping: `=== true` ⇒ `OK`, throw ⇒ `THROW`, other ⇒ `NOOP` | CP11 |
| I-5: listener/recorder teardown | Lifecycle `CREATED→CAPTURING→CONTROL→FINALIZING→CLOSED`, idempotent teardown, one recorder per page | §8.6 |

### 12.1 Remediation of prototype spec findings (contract version 4)

Building the offline prototype from the two appendices exposed spec defects. The prototype builders reported them without editing the specs (`prototype/NOTES.md`, "Spec findings"). They are fixed here and in Part 2 (Part 2 "Contradictions, tensions and coordination items", item 11). No committed conclusion changed: `OPEN` 2/13, assumption mode 3/13, 3/13 with a sound procedure, `NV` 406 B, 5,063, the fail-closed gap, C8 unresolved, the committed correlator and the committed C6 guard are all unchanged.

| Finding (NOTES.md) | Disposition in Part 1 | Section |
|---|---|---|
| 1: the wire-key collision rule was false for `k`, `f`, `tm` | Restated precisely: those three common keys are shared with `META`/`END` with the same meaning; every other data key is distinct; `META-FIELD-IN-DATA` covers envelope-only keys | §8.3 serialization notes; Part 2 §12.4, Appendix (i) |
| 6: I4 under-specified (`te`, settle token, timeout position) | I4 rewritten as exact mechanical rules matching the prototype: `te` iff `settled`/`timeout`; start token must have an earlier `RQ post`; comparison decision position and uniqueness; timeout position; `settled` on sample 1 rejected for every role; mandatory `fr` on the subject's terminal decision with samples; role consistency | I4, `wireVariants`, `fieldTypes.terminal`, Appendix `t4DecisionRules` |
| 7: no code for frame/time ordering | `FRAME-ORDER` and `TIME-ORDER` (Part 2 codes) named on the common fields | §8.1 common fields |
| 9: no code for `RS` pairing | `RS-PAIR` added as a Part 1 integrity code | CP10, CP11; Part 2 §12.6, Appendix (i) |
| ancillary (b): capture points lacked a machine-readable fail-closed entry | Every Appendix `capturePoints` entry now has `failClosed` (`effect`, `integrityCodes`, `reasons`, `stopConditions`); the prototype's capability validator checks each reference against the contract | Appendix `capturePoints` |

### 12.2 Remediation of the internal review (contract version 5)

The internal review `docs/reviews/2026-10-06-g2-live-diagnostic-preparation-internal-review.md` reported, for this part: M-3 (the `CLEAR_WITHOUT_EDGE` rule was not enforced, and a source-impossible token reappearance gave a definite `PENDING`), L-2 (P-TC "never removed" wording) and L-4 (incomplete CP08 rationale). Fixed in §10.4 (T1c), the new §10.4a (`TOKEN_REAPPEARED` → Part 2 `SC-C04`, T0c), §7.1 P-TC and CP08, and in the Appendix `derivedAnnotations`. No committed conclusion changed, and the committed correlator is consumed unchanged.

## Appendix: Machine-readable contract

```json
{
  "contractId": "g2-live-diag-prep-part1",
  "contractVersion": 5,
  "remediatedBy": "codex-review spec medium 20261006-093801-3907-17991 (5 Critical / 5 Important, all remediated); prototype spec findings 1, 6, 7, 9 and ancillary (b) remediated in contract version 4 (section 12.1); internal-review M-3, L-2, L-4 remediated in contract version 5 (section 12.2)",
  "reconciledWith": "g2-live-diag-prep-part2 contractVersion 4 (CI-1, CI-2, projection representability, schema-2 caps, prototype-finding remediation, internal-review remediation)",
  "baselineCommit": "f3bab74f460eacd6b6f69bc8fb90110455ceeb68",
  "viewerPin": {
    "version": "7.124.2",
    "bundleSha256": "12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e"
  },
  "consumesCommittedCorrelatorUnchanged": true,
  "minimumObservableSet": [
    "ID-ON",
    "P-FRM",
    "P-TC",
    "V-PEND",
    "V-EDGE"
  ],
  "baseAtoms": [
    "H-CALL",
    "H-T4"
  ],
  "excludedObservables": [
    "P-XS",
    "P-TICK",
    "P-CC",
    "P-CC0",
    "V-ACT",
    "VB-4",
    "VB-5",
    "VB-6",
    "VB-7",
    "VB-8"
  ],
  "observableTier": {
    "ID-ON": "harness-local",
    "P-FRM": "public+harness-local",
    "P-TC": "public",
    "V-PEND": "viewer-7.124.2-version-bound",
    "V-EDGE": "viewer-7.124.2-version-bound"
  },
  "observableVbDependency": {
    "ID-ON": null,
    "P-FRM": null,
    "P-TC": null,
    "V-PEND": "VB-1",
    "V-EDGE": "VB-3"
  },
  "slotWindowDefault": "OPEN",
  "questionCounts": {
    "total": 13,
    "soundProcedure": 3,
    "answeredOpen": 2,
    "answeredAssume": 3
  },
  "questions": [
    {
      "id": "Q-STALE",
      "classification": "NOT_ANSWERABLE",
      "soundProcedure": false,
      "answersOpen": false,
      "answersAssume": false,
      "openLabels": [],
      "assumeOnlyLabels": []
    },
    {
      "id": "Q-OWNER",
      "classification": "ANSWERABLE_MINIMUM",
      "soundProcedure": true,
      "answersOpen": true,
      "answersAssume": true,
      "openLabels": [
        "RESTORE",
        "INIT"
      ],
      "assumeOnlyLabels": [
        "OWN",
        "PRIOR_TERMINAL",
        "IN_FLIGHT"
      ]
    },
    {
      "id": "Q-SUBJ",
      "classification": "ANSWERABLE_MINIMUM",
      "soundProcedure": true,
      "answersOpen": true,
      "answersAssume": true,
      "openLabels": [
        "PENDING"
      ],
      "assumeOnlyLabels": [
        "ACTIVE_PLUS",
        "COMPLETE"
      ],
      "neverDefinite": [
        "ACTIVE0"
      ]
    },
    {
      "id": "Q-ACTIVE",
      "classification": "REQUIRES_ADDITIONAL_OBSERVABLE",
      "soundProcedure": false,
      "answersOpen": false,
      "answersAssume": false,
      "openLabels": [],
      "assumeOnlyLabels": [],
      "candidateObservable": "V-ACT",
      "adopted": false
    },
    {
      "id": "Q-RESTORE",
      "classification": "NOT_ANSWERABLE",
      "soundProcedure": false,
      "answersOpen": false,
      "answersAssume": false,
      "openLabels": [],
      "assumeOnlyLabels": []
    },
    {
      "id": "Q-DH1",
      "classification": "NOT_ANSWERABLE",
      "soundProcedure": false,
      "answersOpen": false,
      "answersAssume": false,
      "openLabels": [],
      "assumeOnlyLabels": []
    },
    {
      "id": "Q-DH2",
      "classification": "NOT_ANSWERABLE",
      "soundProcedure": false,
      "answersOpen": false,
      "answersAssume": false,
      "openLabels": [],
      "assumeOnlyLabels": []
    },
    {
      "id": "Q-DH3A",
      "classification": "NOT_ANSWERABLE",
      "soundProcedure": false,
      "answersOpen": false,
      "answersAssume": false,
      "openLabels": [],
      "assumeOnlyLabels": []
    },
    {
      "id": "Q-DH3B",
      "classification": "NOT_ANSWERABLE",
      "soundProcedure": false,
      "answersOpen": false,
      "answersAssume": false,
      "openLabels": [],
      "assumeOnlyLabels": []
    },
    {
      "id": "Q-DH4",
      "classification": "REQUIRES_ADDITIONAL_OBSERVABLE",
      "soundProcedure": false,
      "answersOpen": false,
      "answersAssume": false,
      "openLabels": [],
      "assumeOnlyLabels": [],
      "candidateObservable": "P-XS",
      "adopted": false
    },
    {
      "id": "Q-DH7A",
      "classification": "NOT_WORTH_PURSUING",
      "soundProcedure": false,
      "answersOpen": false,
      "answersAssume": false,
      "openLabels": [],
      "assumeOnlyLabels": []
    },
    {
      "id": "Q-ATTR",
      "classification": "ANSWERABLE_UNDER_ASSUMPTION",
      "soundProcedure": true,
      "answersOpen": false,
      "answersAssume": true,
      "openLabels": [],
      "assumeOnlyLabels": [
        "<non-empty token list>"
      ],
      "uncountedOpenLabel": "-"
    },
    {
      "id": "Q-TUPLE",
      "classification": "NOT_ANSWERABLE",
      "soundProcedure": false,
      "answersOpen": false,
      "answersAssume": false,
      "openLabels": [],
      "assumeOnlyLabels": []
    }
  ],
  "envelopeKinds": {
    "META": "specified-by-part-2",
    "END": "specified-by-part-2"
  },
  "companionKinds": {
    "NV": {
      "placement": "immediately after its T4 sample",
      "capBytes": 406,
      "specifiedBy": "DS-6.1.2/6.4(b); part-2"
    }
  },
  "commonFields": {
    "required": [
      "kind",
      "seq",
      "frame",
      "tRel"
    ],
    "optional": [
      "runId"
    ],
    "wire": {
      "required": [
        "k",
        "q",
        "f",
        "tm"
      ],
      "optional": [
        "rn"
      ]
    }
  },
  "fieldTypes": {
    "kind": "enum:RQ|PS|TE|FS|T4|RS|CE|TC|C8|CT|TZ",
    "seq": "int>=1",
    "frame": "int>=0",
    "tRel": "int>=0 (0.1 ms)",
    "runId": "string[1..32]",
    "phase": "enum:pre|post",
    "reqToken": "int>=1",
    "callOutcome": "enum:returned|threw",
    "slotPresent": "int:0|1",
    "slotBinding": "int>=1|\"U\"",
    "slotNew": "int:0|1",
    "slotDelta": "enum:none|appear|replace|clear",
    "hostSeq": "int>=1",
    "readSite": "enum:frame|t4Sample",
    "camClass": "int>=0",
    "camDigest": "hex16",
    "edgeValue": "int:0|1",
    "payloadActive": "int:0|1",
    "t4Phase": "enum:start|sample|decision",
    "settleRole": "enum:G|S|P (per trace: S exactly 1, G at most 2, P at most 1; settles strictly sequential)",
    "sampleIndex": "int:0..maxSamplesPerSettle (0 only on zero-sample timeout decision)",
    "decision": "enum:none|settled|timeout",
    "deciding": "int:1 (at most once per trace; subject S terminal decision with sampleIndex>=1)",
    "restoreResult": "enum:OK|NOOP|THROW (throw=>THROW; return===true=>OK; any other return=>NOOP)",
    "sampleSeq": "int>=1",
    "measureRole": "enum:subject|superseded",
    "targetKey": "string[1..32]",
    "evaluable": "int:0|1",
    "inside": "int:0|1",
    "tzPhase": "enum:targetEnd|final",
    "tzCause": "enum:normal|stop|error",
    "controlId": "enum:PC-1|PC-2|PC-3|PC-4|PC-5 (domain: part 2 control matrix; PC-3 only in a target trace control window)",
    "controlOutcome": "enum:PASSED|FAILED|NOT_RUN",
    "framesUsed": "int>=0",
    "frameBudget": "int>=0",
    "terminal": "int:1 (present iff decision in {settled, timeout}; exactly one per settle)"
  },
  "capturePoints": [
    {
      "id": "CP01",
      "name": "beforeRequestIssuance",
      "recordKind": "RQ",
      "selector": {
        "phase": "pre"
      },
      "requiredFields": [
        "reqToken",
        "slotPresent",
        "slotDelta"
      ],
      "conditionalFields": {
        "slotBinding": "slotPresent==1"
      },
      "failClosed": {
        "effect": "pair missing or pre-read absent while V-PEND is configured: whole-trace MALFORMED; tagging unavailable at preflight: stop before consumption",
        "integrityCodes": [
          "I1-RQ-PAIR",
          "WIRE-VARIANT",
          "DATA-INVALID"
        ],
        "reasons": [],
        "stopConditions": [
          "SC-A12",
          "SC-B06"
        ]
      }
    },
    {
      "id": "CP02",
      "name": "afterRequestIssuance",
      "recordKind": "RQ",
      "selector": {
        "phase": "post"
      },
      "requiredFields": [
        "reqToken",
        "callOutcome"
      ],
      "conditionalFields": {
        "slotPresent": "callOutcome==returned",
        "slotDelta": "callOutcome==returned",
        "slotNew": "callOutcome==returned",
        "camClass": "callOutcome==returned",
        "camDigest": "callOutcome==returned",
        "slotBinding": "slotPresent==1"
      },
      "failClosed": {
        "effect": "post missing, unmatched or malformed: whole-trace MALFORMED; interleaved pair: binding refused (U); threw in the target window: projection unrepresentable",
        "integrityCodes": [
          "I1-RQ-PAIR",
          "I2-RQ-THREW-READS",
          "I7-SLOT-DELTA",
          "DATA-INVALID"
        ],
        "reasons": [
          "IDENTITY_AMBIGUOUS",
          "PROJECTION_UNREPRESENTABLE:FIT_THREW"
        ],
        "stopConditions": [
          "SC-A12",
          "SC-B06",
          "SC-C07"
        ]
      }
    },
    {
      "id": "CP03",
      "name": "pendingSlotWriteChange",
      "recordKind": "PS",
      "selector": {
        "slotDelta": [
          "appear",
          "replace"
        ]
      },
      "requiredFields": [
        "hostSeq",
        "readSite",
        "slotPresent",
        "slotBinding",
        "slotDelta"
      ],
      "alsoDetectedBy": {
        "recordKind": "RQ",
        "selector": {
          "phase": "post",
          "slotNew": 1
        }
      },
      "failClosed": {
        "effect": "host without its PS or inconsistent slotDelta: whole-trace MALFORMED; a U binding: IDENTITY_AMBIGUOUS from then on; VB-1 unavailable: V-PEND disabled",
        "integrityCodes": [
          "I3-HOST-PS",
          "I7-SLOT-DELTA"
        ],
        "reasons": [
          "IDENTITY_AMBIGUOUS",
          "VB_UNAVAILABLE:VB-1"
        ],
        "stopConditions": [
          "SC-A11",
          "SC-B06"
        ]
      }
    },
    {
      "id": "CP04",
      "name": "pendingSlotClear",
      "recordKind": "PS",
      "selector": {
        "slotDelta": [
          "clear"
        ]
      },
      "requiredFields": [
        "hostSeq",
        "readSite",
        "slotPresent",
        "slotDelta"
      ],
      "forbiddenFields": [
        "slotBinding"
      ],
      "failClosed": {
        "effect": "host without its PS: whole-trace MALFORMED; the clear-to-edge interval is never attributed under OPEN",
        "integrityCodes": [
          "I3-HOST-PS",
          "I7-SLOT-DELTA"
        ],
        "reasons": [
          "UNOBSERVED_SLOT_WINDOW"
        ],
        "stopConditions": [
          "SC-B06"
        ]
      }
    },
    {
      "id": "CP05",
      "name": "transitionActiveRise",
      "recordKind": "TE",
      "selector": {
        "edgeValue": 1
      },
      "requiredFields": [
        "edgeValue",
        "payloadActive"
      ],
      "failClosed": {
        "effect": "listener absent or PC-3 not passed: V-EDGE disabled; boundary unknown: V-EDGE dropped; repeated rise or payload mismatch: C3 contradiction, run INVALID",
        "integrityCodes": [
          "WIRE-VARIANT"
        ],
        "reasons": [
          "VB_UNAVAILABLE:VB-3",
          "EDGE_INIT_UNKNOWN",
          "VB3_NOT_REPRESENTATIVE",
          "CONTRADICTION:EDGE_REPEAT",
          "CONTRADICTION:PAYLOAD_MISMATCH"
        ],
        "stopConditions": [
          "SC-A11",
          "SC-C01",
          "SC-C05"
        ]
      }
    },
    {
      "id": "CP06",
      "name": "transitionActiveFall",
      "recordKind": "TE",
      "selector": {
        "edgeValue": 0
      },
      "requiredFields": [
        "edgeValue",
        "payloadActive"
      ],
      "failClosed": {
        "effect": "as CP05; a fall without a preceding rise is a C3 contradiction",
        "integrityCodes": [
          "WIRE-VARIANT"
        ],
        "reasons": [
          "VB_UNAVAILABLE:VB-3",
          "CONTRADICTION:FALSE_EDGE_WITHOUT_TRUE"
        ],
        "stopConditions": [
          "SC-C01"
        ]
      }
    },
    {
      "id": "CP07",
      "name": "frameIncrement",
      "recordKind": "FS",
      "selector": {},
      "requiredFields": [
        "camClass",
        "camDigest"
      ],
      "followedBy": {
        "recordKind": "PS",
        "readSite": "frame"
      },
      "failClosed": {
        "effect": "missing capture-start FS, frame gap, frame/time order violation or frame budget exceeded: whole trace unusable; non-transitive class relation: every target INCONCLUSIVE",
        "integrityCodes": [
          "CAPTURE-START-MISSING",
          "FS-FRAME-GAP",
          "FRAME-ORDER",
          "TIME-ORDER",
          "FRAME-BOUND",
          "I3-HOST-PS"
        ],
        "reasons": [
          "NO_CAPTURE_BASELINE",
          "CLASS_NONTRANSITIVE"
        ],
        "stopConditions": [
          "SC-B04",
          "SC-B06",
          "SC-C06"
        ]
      }
    },
    {
      "id": "CP08",
      "name": "t4SampleAcquisition",
      "recordKind": "T4",
      "selector": {
        "t4Phase": [
          "start",
          "sample"
        ]
      },
      "requiredFieldsByPhase": {
        "start": [
          "t4Phase",
          "settleRole",
          "reqToken"
        ],
        "sample": [
          "t4Phase",
          "settleRole",
          "sampleIndex",
          "camClass",
          "camDigest"
        ]
      },
      "followedBy": {
        "recordKind": "PS",
        "readSite": "t4Sample",
        "appliesTo": "sample"
      },
      "failClosed": {
        "effect": "sample without start, without PS, out of order or above the sample bound: whole trace unusable (bound exceeded: OVERFLOW, never an early decision)",
        "integrityCodes": [
          "SETTLE-ROLES",
          "I3-HOST-PS",
          "I4-T4-DECISION",
          "SAMPLE-BOUND",
          "OVERFLOW"
        ],
        "reasons": [],
        "stopConditions": [
          "SC-B04",
          "SC-B06"
        ]
      }
    },
    {
      "id": "CP09",
      "name": "t4SettleDecision",
      "recordKind": "T4",
      "selector": {
        "t4Phase": [
          "decision"
        ]
      },
      "requiredFields": [
        "t4Phase",
        "settleRole",
        "sampleIndex",
        "decision"
      ],
      "conditionalFields": {
        "sampleSeq": "sampleIndex>=1",
        "terminal": "settle's single settled|timeout decision",
        "deciding": "I4: unique; subject S terminal decision with sampleIndex>=1"
      },
      "zeroSampleTimeout": {
        "sequence": [
          "T4.start",
          "T4.decision{decision:timeout,sampleIndex:0,terminal:1}"
        ],
        "tdExists": false,
        "c8Allowed": false,
        "ownerSubject": "UNDIAGNOSABLE(NO_DECIDING_SAMPLE)"
      },
      "failClosed": {
        "effect": "decision not per I4: whole trace unusable; settled on sample 1: C3 contradiction; subject zero-sample timeout: owner/subject UNDIAGNOSABLE",
        "integrityCodes": [
          "I4-T4-DECISION",
          "WIRE-VARIANT"
        ],
        "reasons": [
          "NO_DECIDING_SAMPLE",
          "CONTRADICTION:SETTLED_ON_FIRST_SAMPLE"
        ],
        "stopConditions": [
          "SC-B06"
        ]
      }
    },
    {
      "id": "CP10",
      "name": "restoreInvocation",
      "recordKind": "RS",
      "selector": {
        "phase": "pre"
      },
      "requiredFields": [],
      "failClosed": {
        "effect": "pre without its adjacent post: whole-trace MALFORMED",
        "integrityCodes": [
          "RS-PAIR"
        ],
        "reasons": [],
        "stopConditions": [
          "SC-B06"
        ]
      }
    },
    {
      "id": "CP11",
      "name": "restoreCameraWrite",
      "recordKind": "RS",
      "selector": {
        "phase": "post"
      },
      "requiredFields": [
        "restoreResult"
      ],
      "conditionalFields": {
        "camClass": "restoreResult!=THROW",
        "camDigest": "restoreResult!=THROW",
        "slotPresent": "restoreResult!=THROW",
        "slotDelta": "restoreResult!=THROW",
        "slotBinding": "slotPresent==1"
      },
      "failClosed": {
        "effect": "post without its adjacent pre or malformed read: whole-trace MALFORMED; OK without camera read: RESTORE never definite",
        "integrityCodes": [
          "RS-PAIR",
          "I7-SLOT-DELTA",
          "WIRE-VARIANT"
        ],
        "reasons": [
          "UNREAD_WRITER",
          "IDENTITY_AMBIGUOUS"
        ],
        "stopConditions": [
          "SC-B06"
        ]
      }
    },
    {
      "id": "CP12",
      "name": "publicCameraChange",
      "recordKind": "CE",
      "selector": {},
      "requiredFields": [],
      "capturedInMinimum": false,
      "failClosed": {
        "effect": "a CE record while P-CC is not configured: whole-trace MALFORMED",
        "integrityCodes": [
          "CE-NOT-CONFIGURED"
        ],
        "reasons": [],
        "stopConditions": [
          "SC-B06"
        ]
      }
    },
    {
      "id": "CP13",
      "name": "formalTransitionCompletion",
      "recordKind": "TC",
      "selector": {},
      "requiredFields": [],
      "failClosed": {
        "effect": "listener absent: Q-ATTR UNAVAILABLE and owner/subject OBSERVABLE_ABSENT:P-TC; TC with no active transition: C3 contradiction",
        "integrityCodes": [],
        "reasons": [
          "OBSERVABLE_ABSENT:P-TC",
          "CONTRADICTION:TC_WITHOUT_ACTIVE"
        ],
        "stopConditions": [
          "SC-B01"
        ]
      }
    },
    {
      "id": "CP14",
      "name": "c8FrustumMeasurement",
      "recordKind": "C8",
      "selector": {},
      "requiredFields": [
        "sampleSeq",
        "camDigest",
        "measureRole",
        "targetKey",
        "evaluable",
        "inside"
      ],
      "binding": {
        "subject": {
          "settleRole": "S",
          "decision": "settled",
          "deciding": 1
        },
        "superseded": {
          "settleRole": "P",
          "decision": "settled",
          "terminal": 1
        },
        "camDigestMustMatch": true
      },
      "failClosed": {
        "effect": "C8 not bound to the terminal sample of a settled settle of its role, or outside the target window: whole trace unusable; bound NV not retained: numeric reproduction AMBIGUOUS",
        "integrityCodes": [
          "I5-C8-BINDING",
          "CONTROL-WINDOW-KIND"
        ],
        "reasons": [
          "NUMERIC_NOT_RETAINED"
        ],
        "stopConditions": [
          "SC-B06"
        ]
      }
    },
    {
      "id": "CP15",
      "name": "diagnosticTerminalization",
      "recordKind": "TZ",
      "selector": {},
      "requiredFields": [
        "tzPhase",
        "tzCause"
      ],
      "failClosed": {
        "effect": "missing TZ or END, misplaced TZ, or END.ds/zt inconsistent with the TZ records: whole trace unusable (TRUNCATED when END is missing)",
        "integrityCodes": [
          "I6-TZ-WINDOW",
          "END-MISSING",
          "TZ-STATUS-MISMATCH",
          "LIFECYCLE-MISMATCH"
        ],
        "reasons": [],
        "stopConditions": [
          "SC-B04",
          "SC-B06"
        ]
      }
    }
  ],
  "nonCapturePointKinds": {
    "CT": {
      "requiredFields": [
        "controlId",
        "controlOutcome",
        "framesUsed",
        "frameBudget"
      ],
      "window": "control",
      "specifiedBy": "part-2"
    }
  },
  "pairingInvariants": [
    "I1-rq-pair-interleave-refuses-binding",
    "I2-rq-threw-no-reads",
    "I3-host-then-ps",
    "I4-t4-decisions-terminal-deciding-zero-sample-timeout",
    "I5-c8-binds-terminal-sample-of-settled-settle",
    "I6-tz-target-and-final-control-window-admits-RQ",
    "I7-slotDelta-on-every-visible-slot-read",
    "RS-PAIR-rs-pre-post-adjacent"
  ],
  "derivedAnnotations": {
    "GAP": {
      "raw": false,
      "fields": [
        "openSeq",
        "closeSeq",
        "boundBefore",
        "gapClass",
        "inferredToken",
        "assumedToken"
      ],
      "gapClass": [
        "CONSUME_EDGE_BOUND",
        "CONSUME_EDGE_UNBOUND",
        "EDGE_AFTER_EMPTY",
        "CLEAR_WITHOUT_EDGE"
      ],
      "inferredTokenUnderOpen": null,
      "laterResolution": false,
      "clearWithoutEdgeRule": "IDENTITY_AMBIGUOUS for the cleared token in both modes; enforced as Part 2 target rule T1c (reason IDENTITY_AMBIGUOUS:CLEAR_WITHOUT_EDGE)"
    },
    "TOKEN_REAPPEARED": {
      "raw": false,
      "predicate": "visible slot reads v1 < v2 < v3 in the target window with v1.slotBinding = k (token), v2 not showing k, v3.slotBinding = k",
      "classification": "source-fact contradiction (section 10.4a), not an integrity code",
      "runLevelEffect": "Part 2 SC-C04: every target INCONCLUSIVE (T0c), verdict withheld, owner decision",
      "correlatorOverride": "withdraws only; never upgrades"
    },
    "PRE_MOTION": {
      "raw": false,
      "predicate": "exists TE rise E before deciding sample D with no fall in (E,D); last camera-bearing record B before E exists; all camera-bearing records in (E,D] have camClass == B.camClass; no RS post OK in (E,D]",
      "flag": "preMotionUnresolved",
      "runLevelEffect": "INCONCLUSIVE for owner-at-t_d hypotheses; INCONCLUSIVE for subject-state hypotheses unless Q-SUBJ is DEFINITE",
      "correlatorOverride": false,
      "additionalObservableJustified": false
    }
  },
  "wireKeys": {
    "kind": "k",
    "seq": "q",
    "frame": "f",
    "tRel": "tm",
    "runId": "rn",
    "reqToken": "r",
    "phase": "pp",
    "callOutcome": "co",
    "slotPresent": "sp",
    "slotBinding": "sb",
    "slotNew": "nw",
    "slotDelta": "sx",
    "hostSeq": "hq",
    "readSite": "rd",
    "camClass": "cl",
    "camDigest": "dg",
    "edgeValue": "ev",
    "payloadActive": "pa",
    "t4Phase": "tp",
    "settleRole": "s",
    "sampleIndex": "n",
    "decision": "d",
    "sampleSeq": "ss",
    "terminal": "te",
    "deciding": "fr",
    "restoreResult": "rs",
    "measureRole": "mr",
    "targetKey": "tk",
    "evaluable": "el",
    "inside": "in",
    "tzPhase": "zp",
    "tzCause": "zc",
    "controlId": "ci",
    "controlOutcome": "cr",
    "framesUsed": "fu",
    "frameBudget": "fb",
    "numeric": "nv"
  },
  "wireVariants": {
    "RQ.pre": {
      "required": [
        "pp",
        "r",
        "sp",
        "sx"
      ],
      "conditional": {
        "sb": "sp==1"
      },
      "forbidden": [
        "co",
        "nw",
        "cl",
        "dg"
      ]
    },
    "RQ.post.returned": {
      "required": [
        "pp",
        "r",
        "co",
        "sp",
        "sx",
        "nw",
        "cl",
        "dg"
      ],
      "conditional": {
        "sb": "sp==1"
      }
    },
    "RQ.post.threw": {
      "required": [
        "pp",
        "r",
        "co"
      ],
      "forbidden": [
        "sp",
        "sx",
        "nw",
        "sb",
        "cl",
        "dg"
      ]
    },
    "PS": {
      "required": [
        "hq",
        "rd",
        "sp",
        "sx"
      ],
      "conditional": {
        "sb": "sp==1"
      }
    },
    "TE": {
      "required": [
        "ev",
        "pa"
      ]
    },
    "FS": {
      "required": [
        "cl",
        "dg"
      ]
    },
    "T4.start": {
      "required": [
        "tp",
        "s",
        "r"
      ]
    },
    "T4.sample": {
      "required": [
        "tp",
        "s",
        "n",
        "cl",
        "dg"
      ]
    },
    "T4.decision": {
      "required": [
        "tp",
        "s",
        "n",
        "d"
      ],
      "conditional": {
        "ss": "n>=1",
        "te": "d in {settled, timeout}",
        "fr": "I4"
      }
    },
    "RS.pre": {
      "required": [
        "pp"
      ]
    },
    "RS.post": {
      "required": [
        "pp",
        "rs"
      ],
      "conditional": {
        "cl": "rs!=THROW",
        "dg": "rs!=THROW",
        "sp": "rs!=THROW",
        "sx": "rs!=THROW",
        "sb": "sp==1"
      }
    },
    "CE": {
      "required": [],
      "onlyIfCapability": "P-CC"
    },
    "TC": {
      "required": []
    },
    "C8": {
      "required": [
        "ss",
        "dg",
        "mr",
        "tk",
        "el",
        "in"
      ]
    },
    "TZ": {
      "required": [
        "zp",
        "zc"
      ]
    },
    "CT": {
      "required": [
        "ci",
        "cr",
        "fu",
        "fb"
      ],
      "window": "control"
    },
    "NV": {
      "required": [
        "nv"
      ],
      "committed": true
    }
  },
  "projection": {
    "target": "committed DiagEvent kinds (FIT, RST, SST, SMP, CAM, AE, TC, CC)",
    "map": {
      "RQ.pre+RQ.post": "FIT",
      "RS.pre+RS.post": "RST",
      "FS": "CAM",
      "T4.start(G|S)": "SST",
      "T4.sample(G|S)": "SMP",
      "T4.sample(P)": "CAM",
      "T4.decision": "sets d/fr on its SMP via ss",
      "PS": "pd on host via hq",
      "TE": "AE",
      "TC": "TC",
      "CE": "CC"
    },
    "notProjected": [
      "T4.start(P)",
      "T4.decision(P)",
      "T4.decision(n=0)",
      "NV",
      "C8",
      "CT",
      "TZ"
    ],
    "edgeInitNotLow": "remove all AE and drop V-EDGE before correlation",
    "longSettleCompaction": "settle (G|S) with N>64 samples: samples 1..63 -> SMP n=1..63; samples 64..N-1 -> CAM; sample N -> SMP n=64 with terminal d/fr",
    "qStamp": "q = 1-based projected position",
    "unrepresentable": {
      "FIT_THREW": "any target-window RQ post with callOutcome=threw",
      "CAPACITY": "more than 8192 projected events",
      "effect": "every sound question UNDIAGNOSABLE(PROJECTION_UNREPRESENTABLE:<cause>); never positive evidence"
    },
    "committedSchemaBounds": {
      "smpSampleIndexMax": 64,
      "projectedSeqMax": 8192
    }
  },
  "settleRoles": {
    "G": {
      "meaning": "non-subject settle, never deciding, never C8-bound (e.g. gate settle of N-1, historical N2/C6 settles)",
      "maxPerTrace": 2,
      "projectedAs": "SST/SMP"
    },
    "S": {
      "meaning": "subject settle; its terminal decision carries deciding=1 iff sampleIndex>=1",
      "exactlyPerTrace": 1,
      "projectedAs": "SST/SMP"
    },
    "P": {
      "meaning": "supersession/probe settle measured by the superseded C8",
      "maxPerTrace": 1,
      "projectedAs": "CAM (samples only)"
    },
    "maxSettles": 4,
    "sequential": true,
    "historicalP6Mapping": {
      "N2": "G",
      "C6": "G",
      "C8": "S",
      "p2": "P"
    },
    "resolves": "part-2 CI-1"
  },
  "controlWindow": {
    "kinds": [
      "RQ",
      "TE",
      "TC",
      "FS",
      "PS",
      "CT"
    ],
    "forbiddenKinds": [
      "T4",
      "RS",
      "C8",
      "NV",
      "CE"
    ],
    "pc3FitWrapped": true,
    "resolves": "part-2 CI-2"
  },
  "boundaryInit": {
    "read": "getTransitionActive()===false && getRequestTransition()===null, same synchronous segment as META and capture-start FS",
    "edgeInitValues": [
      "LOW",
      "UNKNOWN"
    ],
    "edgeInitLowRequires": [
      "TE listener registered in CREATED before quiescence window",
      "no TE during quiescence window",
      "boundary read exact false/null"
    ],
    "unknownEffect": "V-EDGE disabled by projection (all definite labels drop to 0)",
    "boundIntoMetaBy": "part-2 META fields ei, ba, bp, lb, qe (section 12.3)",
    "fixtures": [
      "edge-init-rise-before-target-start",
      "edge-init-fall-after-target-start",
      "edge-init-already-high-at-listener-registration"
    ]
  },
  "sampleBound": {
    "inheritCommitted64": false,
    "formula": "floor(deadlineMs*maxRefreshHz/1000)+1",
    "deadlineMs": 5000,
    "maxRefreshHzProposed": 360,
    "maxSamplesPerSettle": 1801,
    "onExceed": "append rejected -> END.overflow=1 -> whole trace UNDIAGNOSABLE(OVERFLOW); never early settle",
    "dataEventCapOwner": "part-2 section 12.4a (schema-2 caps)",
    "fixtures": [
      "t4-more-than-64-samples-then-settled"
    ]
  },
  "camClass": {
    "algorithm": "committed DS-8.5 first-member representative, online in seq order over all camera-bearing records",
    "tolerance": 1e-09,
    "transitivityGate": "online; any value within 1e-9 of members of >1 class, or not within 1e-9 of every member of its class => CLASS_NONTRANSITIVE, whole trace UNDIAGNOSABLE",
    "nvRetentionPriority": [
      "first member of every class",
      "terminal sample of every settle"
    ]
  },
  "recorderLifecycle": {
    "states": [
      "CREATED",
      "CAPTURING",
      "CONTROL",
      "FINALIZING",
      "CLOSED"
    ],
    "listenersRegisteredIn": "CREATED",
    "listenersRemovedIn": "FINALIZING",
    "teardownIdempotent": true,
    "callbacksAfterTzFinal": "no-op before validation; no counter, sequence or byte change",
    "oneRecorderPerPage": true,
    "fixtures": [
      "late-te-tc-after-tz-final",
      "repeated-teardown",
      "second-recorder-refused"
    ]
  },
  "goldenFixturesRequired": [
    "every wireVariants entry",
    "rq-interleaved",
    "t4-zero-sample-timeout",
    "c8-superseded-p-settle",
    "t4-more-than-64-samples-then-settled",
    "rq-threw-unrepresentable",
    "plan-p6-two-g-settles",
    "control-window-rq-pair"
  ],
  "qSubjPendingPrecedence": "committed correlator: prior 'U' (foreign flag) checked before slot token => IDENTITY_AMBIGUOUS",
  "failClosedReasonVocabulary": {
    "IDENTITY_AMBIGUOUS": "committed correlator",
    "UNOBSERVED_SLOT_WINDOW": "committed correlator",
    "VB_UNAVAILABLE:VB-1": "committed C6 guard",
    "VB_UNAVAILABLE:VB-3": "committed C6 guard",
    "OBSERVABLE_ABSENT:P-TC": "committed correlator",
    "NO_CAPTURE_BASELINE": "committed correlator",
    "UNREAD_WRITER": "committed correlator",
    "NUMERIC_NOT_RETAINED": "committed C7",
    "CONTRADICTION:EDGE_REPEAT": "committed C3",
    "CONTRADICTION:FALSE_EDGE_WITHOUT_TRUE": "committed C3",
    "CONTRADICTION:SETTLED_ON_FIRST_SAMPLE": "committed C3",
    "CONTRADICTION:TC_WITHOUT_ACTIVE": "committed C3",
    "CONTRADICTION:PAYLOAD_MISMATCH": "part-1 TE row (raised before projection)",
    "EDGE_INIT_UNKNOWN": "part-2 T3a",
    "VB3_NOT_REPRESENTATIVE": "part-2 T3",
    "CLASS_NONTRANSITIVE": "part-2 T0b",
    "NO_DECIDING_SAMPLE": "part-2 T1 rename",
    "PROJECTION_UNREPRESENTABLE:FIT_THREW": "part-1 8.3"
  },
  "t4DecisionRules": {
    "settleAssociation": "T4 start.reqToken names an issued token whose RQ post has a smaller seq (SETTLE-ROLES)",
    "sequential": "a start only after the previous settle's terminal decision (SETTLE-ROLES)",
    "window": "T4 records only in the target window (CONTROL-WINDOW-KIND)",
    "roleConsistency": "sample/decision settleRole equals the open settle's role; none after its terminal decision",
    "sampleIndex": "consecutive 1,2,3,... within a settle",
    "comparisonDecision": "decision in {none, settled}: ss = seq of the settle's most recent sample, n = that sample's n, seq = that sample's PS seq + 1; at most one per sample",
    "settledOnFirstSample": "rejected for every role (G, S, P)",
    "timeoutDecision": "n = samples taken so far; ss = last sample seq iff n >= 1; any seq after the last sample (or start) and before the next start",
    "terminal": "te = 1 iff decision in {settled, timeout}; exactly one per settle; nothing of that settle after it",
    "deciding": "fr = 1 at most once per trace; only on the S terminal decision with n >= 1; the S terminal decision with n >= 1 must carry it",
    "violationCode": "I4-T4-DECISION unless SETTLE-ROLES or CONTROL-WINDOW-KIND is named"
  },
  "commonFieldOrdering": {
    "frame": "non-decreasing; every non-FS record carries the frame of the latest preceding FS (FRAME-ORDER)",
    "tRel": "non-decreasing (TIME-ORDER)"
  }
}
```
