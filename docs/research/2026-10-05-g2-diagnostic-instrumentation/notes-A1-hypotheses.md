# G2 diagnostic instrumentation — research notes A1: remaining hypotheses and mapping of historical evidence

- **Role:** working notes from research subagent A1. They feed the package research artifact required by `docs/prompts/for-claude-g2-diagnostic-instrumentation-research-to-ready-package.md` §5.1, §5.5 and part of §4. This is **not** a spec, a review or an acceptance artifact.
- **Baseline read:** `main` at `06980ee`. Harness `test/acceptance/clashpanel-viewerbridge.acceptance.mjs` was re-hashed and gives `cc8868cd…ef09b`, which matches. R1 was re-hashed and gives `4204e2d3…42148`, which matches `MANIFEST.md`. Every evidence file was opened read-only. Nothing was run in a browser or Viewer. No network access was used.
- **Inputs:** D0/D1 (`docs/research/2026-10-04-g2-d0-viewer-api-evidence-d1-r1-replay.md`, cited as "D0 §n" / "D1 §n"); the D2 spec (`docs/research/2026-10-04-g2-d2-synthetic-transition-spec.md`, cited as "D2-spec §n"); D2 results (`docs/research/2026-10-04-g2-d2-synthetic-transition/results/d2-summary.json`, cited as "d2-summary.`key`"); the remediation plan (`docs/research/2026-10-04-g2-c3-c8-c6-remediation-plan.md`, cited as "Plan §n"); evidence `docs/research/evidence/g2-live-20261004-75a3ccb9/` (R1/R2/R3/MANIFEST); harness lines `H:<line>` at the current SHA.
- **Labels** follow D0, extended only as noted. **[SRC]** a pinned Viewer 7.124.2 source fact *as recorded by D0/D2-spec*. These notes did **not** re-fetch the bundle, so every [SRC] claim here is carried over from those artifacts. · **[DOC]** official Reference Guide (via D0) · **[EVD]** a retained R1 field, cited by JSON path · **[HAR]** harness or product code at the current SHA · **[SYN]** a D2 synthetic-model result: mechanical support only, never history · **[INF]** inference by this note or carried from D0/D1 · **[UNKNOWN]** not retained or not determinable.
- **Fixed constraints (restated, not re-decided):** historical G2 = `FAIL (row 3)`; C6 = `NOT_EVIDENCED`; **C8 remains unresolved**; T4 is unchanged. Nothing below claims historical causality or proof.

---

## 0. Ground-truth vocabulary (for predicates)

The hypotheses are predicates over the *true* Viewer and harness state. That state is mostly unobserved. The vocabulary is taken from D2-spec §5.1/§7.4, so later labels can be compared with D2:

| Symbol | Meaning | Basis |
|---|---|---|
| `N` | the subject request whose settle is being evaluated (C6, N2, C8, or the C8 supersession p2) | [HAR] H:10543-10585 |
| `t_d` | the T4 decision instant: when the deciding (second-equal) sample is taken. The frustum oracle evaluates **this same sample** (`settle.camera`) | [HAR] H:8423, H:8465, H:8489, H:8512 |
| `pending(t)`, `active(t)` | `__destinationView ≠ null`; `transitionActive` | [SRC] D0 §2 e-g |
| `subjState(t)` | ∈ {`NONE` (no request created), `PENDING`, `ACTIVE0` (consumed, step 0, no motion), `ACTIVE+`, `COMPLETE`, `DISCARDED` (slot overwritten before consumption)} | D2-spec §7.4 plus `NONE`/`DISCARDED` added here [INF] |
| `owner(t)` | the writer of the last camera write before `t` ∈ {`N*` (N's terminal), `T(j)*` with j≠N (prior terminal), `T(j)` (non-terminal step of some j), `RESTORE`, `INIT` (pose at sequence start), `FOREIGN` (any writer outside {fit-request transitions, harness restore})} | D2-spec §5.6 plus `FOREIGN` added here [INF] |
| `ticks(a,b)` | number of Viewer MainLoop ticks between harness samples a and b | [SRC] D0 §2 k |

---

## 1. Hypothesis set

"Status" has three separate parts: **source** (is the mechanism shown by D0?), **synthetic** (did D2 find schedules for it?), and **historical** (what R1 shows). None of the historical statuses is "proved".

| ID | Name | Predicate over ground truth (at `t_d` of subject `N` unless stated) | Derives from | Source status | Synthetic status | Historical status |
|---|---|---|---|---|---|---|
| **DH-1** | Pre-motion observation | `subjState(t_d) ∈ {PENDING, ACTIVE0}`, so N has not yet moved the camera | D0 T4-1/T4-2 (§4); D2 M-PRE (D2-spec §7.4/§7.7) | Gap is source-proven; occurrence needs a timing condition [SRC][INF] (D0 T4-2) | M-PRE in all 4 cells (d2-summary.`mechanismCounts`: CL-primary 1071 … OP-tail 12859) [SYN] | **Consistent with C6** (home-like sample, D1 §8) [INF]. Unproved. |
| **DH-2** | Completion → next-consumption gap (one-request lag) | `subjState(t_d)=PENDING ∧ ¬active(t_d) ∧ owner(t_d)=T(N−1)*` | D0 §5 chain (3); D2 M-GAP | Mechanism source-supported; needs N issued while N−1 is active (held) [SRC] | M-GAP in all 4 cells (CL-primary 537) [SYN] | **Consistent with N2 and C8** (N2 ≈ fit(U) at ~1e-8, C8 ≈ a corner element; D1 §8). Moderate/partial; ownership unproved [INF] |
| **DH-3** | Restore followed by a held/pending/active request | A `restoreState(…,true)` returned `true` at `t_r` while `pending(t_r) ∨ active(t_r)`, with `t_r < t_d`. **DH-3a:** `owner(t_d)=RESTORE` (decision on the restored pose). **DH-3b:** some `T(j)` write after `t_r` overrides the restored pose before `t_d` (the reset is ineffective) | D0 §2 `restoreState` paragraph; D0 §12 last row; D2 M-RST; Plan H5 | Restore does not clear the slot or cancel the transition [SRC]. Override of the restored pose is a **source-derived inference, never observed** [INF] | 3a = M-RST (CL-primary 60, `STALE_RESTORE`). 3b appears in F2 `STALE_PRIOR_TERMINAL` (CL-primary F2: 777) [SYN] | N2's sample is **not** home-like, so 3a does not match N2 [INF]. 3b is **compatible** with N2 (reset1) and C8 (reset2) [INF]. Restore timing [UNKNOWN] |
| **DH-4** | Quiet / sub-epsilon transition tail | `subjState(t_d)` or some j's state = `ACTIVE+`, `owner(t_d)=T(j)` (non-terminal), and the deciding adjacent samples differ by ≤1e-9 on all 32 entries | D0 T4-4; D2-spec §5.5 (`L≥1`) | **Not established** by source; "plausible, not categorical" [SRC][INF] | M-TAIL only in tail cells (CL-tail 3103) and only under the synthetic τ=1e-10 branch. D=30 is model-invalid and supports no inference (d2-summary.`characterization`) [SYN] | No retained datum bears on it (no per-frame samples) [UNKNOWN] |
| **DH-5** | Event/request correlation ambiguity *(epistemic)* | More than one assignment {completion fire → request token} is consistent with the retained observations, so a completion cannot be attributed to N | D0 §3 (no request-correlated public signal); D0 §5 event table | No payload or request id on `CAMERA_TRANSITION_COMPLETED` [SRC][DOC] | The idealized oracle is assumed away (D2-spec §6.2). D2 does not test this [SYN] | **Holds for R1**: listener removal is only a proxy, the registrant is `unattributed`, there are 4 fits and 3 removals, and post-P6 removals are confounded (§2.5) [EVD][INF] |
| **DH-6** | Camera-ownership ambiguity | **DH-6a (causal):** `owner(t_d)=FOREIGN`. **DH-6b (epistemic):** `owner(t_d)` cannot be identified from the retained observations | D0 §5 ("no stale-closure path"); Plan §5 (hidden shared state) | Only autocam steps and `restoreState` are known writers on this path [SRC]. Other writers were not audited [UNKNOWN] | D2 has no FOREIGN writer by construction (D2-spec §5.2 "who may overwrite") [SYN] | 6b **holds** for every R1 sample: the spy wraps `fitToView` and listeners, not `restoreState`, `setView` or navigation writers (§2.6) [EVD]. 6a: no evidence either way [UNKNOWN] |
| **DH-7** | Harness observation-timing gaps | **DH-7a:** `ticks(prev, deciding) = 0` while the subject is outstanding (rAF samples with no Viewer tick between them, so consumption could not happen). **DH-7b:** settle sampling starts after a latency (bridge `present` resolution, `G≥1`) that is long relative to the outstanding window. **DH-7c (measurement retention):** the decision instant, sample count and timestamps are not retained, so `t_d` is not locatable | D0 T4-2 ("tick skips widen the window"), §2 k; D2 dims `S`, `G`, `ORD`; Plan §3 D3 | Ticks are scheduled independently of rAF and may be skipped [SRC][INF for throttle] | The `S` and `G` dimensions enumerate 7a/7b. They are enabling conditions inside M-PRE/M-GAP and are not separate classes [SYN] | 7c **holds** (`sampleCount` and timestamps dropped, H:8429; not in R1, D1 §11.1) [HAR][EVD]. 7a/7b [UNKNOWN] |
| **DH-8** | Product navigation behaviour vs harness observation artifact | Defined on N's own terminal pose `N*` (if it exists). **DH-8H (harness artifact):** `N*` frames N's target under the frozen oracle **and** `owner(t_d) ≠ N*`. **DH-8P (product/navigation/fixture):** `N*` exists and does **not** frame the target (Plan H1 product defect or H4 fixture unframeable). **DH-8∅:** no `N*` exists (see DH-9/DH-10) | Plan H1/H2/H4; D1 §8 (no-op not separable); D2-spec §8.3 | Product calls the documented forms; `present` does not await the transition [HAR] (`fit.js:17-44`) | D2 cannot decide 8H vs 8P (D2-spec §8.3) [SYN] | **Undecided for C8**: `N*` for A:104 was never sampled [EVD][UNKNOWN] |
| **DH-9** | No-op / ineffective own fit | For N: no pending request is created (`fitBounds` early return, `gotoview` disabled), **or** `dest(N)` is within tolerance of the call-time pose, **or** consumption causes no motion and no completion | D0 §2 h-i, §3 row 1; D1 §8, §9 ("no-op not separable"); Plan H4 | Those no-completion paths exist [SRC] | Excluded from the model (D2-spec A3) [SYN] | Not excluded for C6, N2 or C8 (D1 §8). For C6 it is **weakened, conditionally**, by E1 timing (§2.1) [INF] |
| **DH-10** | Pending-slot overwrite (coalescing) | `subjState=DISCARDED`: N's pending request was overwritten by a later fit before consumption | D0 §2 e; D0 T4-8 | Single slot, last writer wins [SRC] | Modelled (V4); not a primary class [SYN] | D0 T4-8: "not supported as the observed mechanism" for C6→N2→C8 [INF]. **Open for the C8→p2 link** (§2.4, §4 T1) |

DH-1…DH-8 are the eight required items. DH-9/DH-10 are residual alternatives that D0/D1 kept open; they are kept here so a later experiment's labelling stays exhaustive.

---

## 2. Historical evidence mapping (§5.5)

### 2.0 Retained P6 timeline (R1 `spyLedger.records`, `truncated:false`, `droppedRecords:0`) [EVD]

| seq | atMs | event (`method`, `origin`) | note |
|---|---|---|---|
| 292 | 12597.1 | `viewer.fitToView` (bridge, aggregate form `[array,undefined,undefined]`) | C6 request. It is the **first `fitToView` of the run**: no earlier fit record exists [EVD] |
| 293 | 12597.6 | `addEventListener('cameraTransitionCompleted', fn, object)` (`unattributed`) | L1 |
| 295 | 12932.3 | `viewer.fitToView` (harness, `[array,object]`) | N2 request `fitToView([111],B)` (H:10564) |
| 296 | 12932.5 | addEventListener (`unattributed`) | L2 |
| 297/298 | 13114.4 | two `removeEventListener` | "E1": one inferred fire removes L1 and L2 |
| 299 | 13282.2 | `viewer.fitToView` (bridge, per-model) | C8 request A:104 |
| 300 | 13446.0 | addEventListener (`unattributed`) | L3, registered 163.8 ms after the call |
| 301 | 13635.2 | removeEventListener | "E2" |
| 302 | 13769.1 | `viewer.fitToView` (bridge, per-model) | p2 → A:105 (the bridge skipped p1, D0 §5) |
| 303 | 13771.3 | addEventListener | L4 |
| 304 | 14321.4 | removeEventListener | "E3" |
| 306 | 14549.7 | `getAggregateIsolation` (harness) | after `b.clear()` (H:10586) |

**Not spied, so not in R1:** `restoreState` (both `resetHome()` calls), `getState`, `getCamera`/samples, settle start/end, the frustum evaluation instant [EVD: method set of `spyLedger.records` has no such entries][HAR] (H:11544-11561).

**Settle-return windows**, taken only from harness ordering (H:10558-10584) plus retained call times [HAR][EVD]:

- C6 `s` returned in (12597.1, 12932.3), with reset1 also inside that window.
- N2 `s2` returned in (12932.3, 13282.2), with reset2 also inside it.
- C8 `s` returned in (13282.2, 13769.1).
- Supersession `s2` returned in (13769.1, 14549.7).

**Conditional narrowing** [INF]: suppose E1 is C6's completion, N2's transition runs E1→E2, and A2 holds (no settle mid-motion). Then N2's `s2` falls in (13114.4, 13282.2), a window of about 168 ms, and C8's `s` falls in (13635.2, 13769.1). These are the M-GAP windows. The condition is the D0 §5 reading, which is not proven.

### 2.1 DH-1 (pre-motion)

- **Known:**
  - The C6 sample (`checks.C6.evidence.cameraK`; `fields.worstExcess` −0.5407) is origin-centred, home-like and loose, so it does not show a successful tight fit for N (D1 §8) [EVD][INF].
  - C6's settle returned before 12932.3. That is at most 335.2 ms after the call and before E1 (13114.4) [EVD][HAR].
  - If E1 is C6's completion, C6 was still outstanding when it settled. Under A2, a settle at that point is pre-motion (DH-1) or tail (DH-4) [INF].
  - Supporting point for C6 consumption (conditional): E1 − N2 call = 182.1 ms. That is far shorter than the ≈500 ms source duration (D0 §2 j), so E1 is unlikely to be N2's own full transition. E1 − C6 call = 517.3 ms. If the removal really was a fire, this favours "C6 was consumed and animated" over a no-op C6 (DH-9) [INF]. It does not change D1's "ownership unresolved".
- **Missing:** the pre-call (home) camera, which `captureHome()` took but never retained (H:11547-11549); per-sample timestamps; `pending`/`active` at `t_d`.
- **Cannot be reconstructed:** the home camera (D1 §11.6), and when C6 was consumed relative to the two deciding samples [UNKNOWN].
- **One observation that would have changed it:** the **pre-call camera sample** at C6's `fitToView` call, compared with C6's deciding sample within 1e-9. Equal means DH-1 is ruled in for C6 (still not ownership-proof). Different rules out DH-1.

### 2.2 DH-2 (completion → next-consumption gap)

- **Known:**
  - The N2 sample matches a 0.9-margin framing of U to about 1e-8 (`controls.N2.evidence.corners`, e.g. extreme clips 0.8999999274 / −0.9000000242). The N2 call named only B:111 (D1 §8) [EVD][INF].
  - The C8 sample (`checks.C8.evidence.corners`, worstExcess +5.858) is consistent with a tight fit of a square-footprint element at U's corner (D1 §8) [EVD][INF].
  - The E1→E2 spacing of 520.8 ms ≈ C6's 517.3 ms hints at serialized transitions (D1 §9) [EVD][INF].
- **Missing:** a fire time paired with the deciding-sample time; `pending`/`active` at `t_d`; B:111's box.
- **Cannot be reconstructed:** the B:111 and A:135 historical geometry (D1 §8, §11.8; D2-spec §3.2), `t_d` for N2 and C8, and whether the deciding samples fell in the M-GAP windows of §2.0.
- **One observation that would have changed it:** a **harness-owned completion listener with dispatch timestamps** together with **per-sample timestamps**. If N2's or C8's `t_d` fell after a fire and before any later camera change, with the sample equal to the previous destination, DH-2 would be strongly supported. If `t_d` preceded every fire, DH-2 would be excluded for that sample.

### 2.3 DH-3 (restore + held/pending)

- **Known:**
  - `controls.N2.fields.restored: true` means both `resetHome()` calls returned `true` (H:10562-10567) [EVD][HAR]. By D0 §2, that return is not a cancellation or effectiveness witness [SRC].
  - In the inferred chain, reset1 (before 12932.3) happens while C6 is active and reset2 (before 13282.2) while N2 is held or active [INF].
  - N2's sample equals fit(U), not home, which fits 3b and not 3a [INF].
- **Missing:** the camera read back after each restore; restore timestamps (not spied); the autocam resync timing (the D2 `SYNC` unknown, D2-spec S10).
- **Cannot be reconstructed:** whether either restore ever showed on screen or in a sample [UNKNOWN].
- **One observation that would have changed it:** a **camera sample immediately after `restoreState` and on the next frames**. If the restored pose persists to `t_d`, that is 3a. If a transition step overwrites it, that is 3b. If the pose is not restored at all, the reset is ineffective outright.

### 2.4 DH-4 (sub-epsilon tail)

- **Known:** nothing historical. D2's M-TAIL rests only on a synthetic τ branch, and D=30 is model-invalid (d2-summary.`characterization.modelValid:false`) [SYN].
- **Missing:** per-frame sample deltas; `transitionActive` at `t_d`.
- **Cannot be reconstructed:** all intermediate camera poses [UNKNOWN].
- **One observation that would have changed it:** **per-sample max |Δ| across the 32 entries, with `transitionActive` at `t_d`**. A decision with `active=true` and Δ≤1e-9 rules DH-4 in. `active=false` or `pending`-only at `t_d` rules it out for that sample.

### 2.5 DH-5 (event/request correlation)

- **Known:**
  - In P6 there are 4 fits and 3 removal events. One removal pair (seq 297/298) clears two listeners at the same instant [EVD]. The registrant is `unattributed`, and its only in-bundle candidate is `EventUtils.waitUntilTransitionEnded` (D0 §5) [EVD][SRC].
  - **New here:** post-P6 removals coincide with non-transition activity:
    - seq 498 at 15934.5 is 0.4 ms after the C16 `modelRemoved` listener entry at 15934.1 (`eventLog` seq 494).
    - seq 557 at 16802.2 is 12.7 ms after the C17 `fitToView` and 11 ms after harness listener removals (seq 554/555).
    - seq 573 at 17275.9 falls in P11 cleanup.
  - So "removal = fire" is visibly confounded inside the same run, and R1 has **no clean quiescent-issue fit→completion latency baseline** [EVD][INF].
- **Missing:** the actual dispatch time of each `CAMERA_TRANSITION_COMPLETED`; the identity of the registrant; the reason each listener was removed.
- **Cannot be reconstructed:** fire counts and times. Removal is the only retained proxy [UNKNOWN].
- **One observation that would have changed it:** **one harness-owned, never-removed completion listener that logs dispatch timestamps**. This turns inferred fires into observed fires. Request attribution would still need pending/active edges (D0 §3).

### 2.6 DH-6 (camera ownership)

- **Known:** the ledger's method set covers `fitToView`, add/remove listener, isolation, overlays, panel and model calls. It does not cover `restoreState`, `setView`, `navigation.*` or `getCamera` [EVD]. The product calls only `fitToView` on this path (`fit.js:17-44`) [HAR]. There is no fit before C6 [EVD].
- **Missing:** attribution of every camera write. In particular, any camera transition left from model load (P1) or from an unspied writer before C6 was not observed [UNKNOWN].
- **Cannot be reconstructed:** `owner(t_d)` for any of the four samples.
- **One observation that would have changed it:** **a write-attributed camera-change log**: spies on `restoreState` and `navigation.setRequestTransition*`/`setView`, or the public `CAMERA_CHANGE_EVENT` with sample deltas, correlated to known writers. Any change at `t_d−1…t_d` without a known writer is DH-6a evidence. Full attribution removes 6b.

### 2.7 DH-7 (harness observation timing)

- **Known:**
  - `waitForCameraSettle` computes `sampleCount` but P6 drops it. Only `settle: "settled"` survives (`checks.C6.fields.settle`, `controls.N2.fields.settle`) [HAR] (H:8423-8429) [EVD].
  - L3 was registered 163.8 ms after the C8 call (about 10 frames at 60 Hz). That shows an unexplained latency somewhere on the Viewer/registrant side (Plan §2.1 read it as "~10 idle frames") [EVD][INF].
  - Frustum timing equals `t_d`, because the same sample is used. The target boxes were read **before** the fit (H:10556, H:10574) [HAR].
- **Missing:** sample count and per-sample timestamps; settle start time; any Viewer tick counter (e.g. `VIEWER_RENDER_TICK`, D0 §3).
- **Cannot be reconstructed:** how many frames each settle took, and whether any tick ran between the deciding samples.
- **One observation that would have changed it:** **retained `sampleCount` and per-sample `performance.now()`, with a tick counter**. A settle with `sampleCount=2` and 0 ticks between samples identifies 7a. Large settle-start latency identifies 7b.

### 2.8 DH-8 (product vs harness artifact)

- **Known:**
  - The C8 call used the documented per-model form, the right model and dbId 104, and did not throw (`checks.C8`, `spyLedger` seq 299 outcome) [EVD].
  - The C8 corners equal `c4Table[A:104]` exactly, so the oracle used the right box (D1 §7) [EVD].
  - The math reproduces bitwise (D1 §7). This rules out an oracle-math cause, not a product cause.
- **Missing:** any sample taken after N's own completion; a quiescent direct-vs-product fit of A:104 (Plan E1/E2).
- **Cannot be reconstructed:** whether A:104's own terminal pose would frame A:104. If DH-10 applied to C8 (see T1), no C8 terminal ever existed (DH-8∅) [UNKNOWN].
- **One observation that would have changed it:** **a post-quiescence re-measure**: after N's own completion and idle frames, re-sample and re-run the frozen frustum predicate. A pass at that point together with the observed T4 FAIL is DH-8H. A fail at that point with ownership established is DH-8P.

### 2.9 DH-9 / DH-10 (residual)

- **Known:**
  - DH-9 is not excludable from R1 (D1 §8). The C6 case is weakened conditionally by the E1 timing (§2.1) [INF].
  - DH-10: D0 T4-8 scopes "not supported" to C6→N2→C8.
  - For C8→p2, the retained times allow **both** readings [EVD arithmetic][INF]:
    - "held" reading: E3 − E2 = 686.2 ms, a long transition or consumption delay.
    - "C8 overwritten by p2" reading: E3 − p2 call = 552.3 ms, which needs C8 to stay unconsumed for >133.9 ms after E2.
- **Missing:** a snapshot of the pending slot before and after each call.
- **Cannot be reconstructed:** whether C8's request was ever consumed [UNKNOWN].
- **One observation that would have changed it:** **`pending ≠ null` (and its destination) immediately after each fit call and immediately before the next one**. "No pending after the call" means DH-9 (no request). "Pending replaced before any `active` edge" means DH-10.

---

## 3. Exclusivity structure (for a distinguishability labelling)

**Recommended labelling:** for each subject sample, an exclusive tuple plus independent epistemic flags.

- **Axis A, `owner(t_d)`**, exclusive and exhaustive: `OWN` | `PRIOR*` | `INFLIGHT` | `RESTORE` | `INIT` | `FOREIGN` | `UNIDENTIFIED`.
- **Axis B, `subjState(t_d)`**, exclusive: `NONE` | `PENDING` | `ACTIVE0` | `ACTIVE+` | `COMPLETE` | `DISCARDED`.
- **Axis C, restore history in [issue(N−1), t_d]**, exclusive: `none` | `OK-while-outstanding` | `OK-while-idle` | `NOOP` | `THROW`.
- **Axis D, N's terminal outcome (post hoc)**, exclusive: `N*-frames` | `N*-misses` | `no-N*`.
- **Flags (non-exclusive, epistemic):** `E5` (event attribution ambiguous), `E6b` (owner unidentifiable), `E7c` (decision instant not locatable).

| Hypothesis | Tuple predicate | Relation to others |
|---|---|---|
| DH-1 | B ∈ {PENDING, ACTIVE0} | Parent of DH-2. Exclusive with DH-4 on B for the subject; exclusive with DH-9 (B=NONE) and DH-10 (B=DISCARDED) |
| DH-2 | B=PENDING ∧ A=PRIOR* ∧ ¬active | **Subset of DH-1** (in D2, M-GAP ⇒ M-PRE, so `mechanismCounts` are not additive) [SYN]. Exclusive with DH-3a (A differs). **Compatible with DH-3b** |
| DH-3a | A=RESTORE ∧ C=OK-while-outstanding | Exclusive with DH-2 and DH-4 (A differs). Compatible with DH-1 (B may be PENDING/ACTIVE0) |
| DH-3b | C=OK-while-outstanding ∧ A ∈ {PRIOR*, INFLIGHT, OWN} | Compatible with DH-2, DH-4 and DH-8H. The historical N2/C8 shape (if the chain reading holds) is **DH-2 ∧ DH-3b** [INF] |
| DH-4 | B=ACTIVE+ (for some j) ∧ A=INFLIGHT | Exclusive with DH-1/DH-2/DH-3a for the same sample |
| DH-6a | A=FOREIGN | Exclusive with DH-2, DH-3a and DH-4 (A differs) |
| DH-7a/b | enabling conditions (`ticks=0`, start latency) | **Non-exclusive.** They co-occur with DH-1/DH-2 and are not alternatives to them |
| DH-8H vs DH-8P vs DH-8∅ | D=`N*-frames` ∧ A≠OWN / D=`N*-misses` / D=`no-N*` | **Mutually exclusive** (axis D). DH-8∅ ⇔ DH-9 (no request) ∨ DH-10 |
| DH-9 | B=NONE, or (A=OWN ∧ zero motion) | Exclusive with DH-1/2/4/10 on B. "A=OWN no-op" is a *correct* observation, not stale |
| DH-10 | B=DISCARDED | Exclusive with DH-1/2/4/9 on B |
| DH-5, DH-6b, DH-7c | flags | Orthogonal: they hold or fail independently of every causal label. **For R1, all three flags are set** [EVD] |

**Consequence for experiment design** [INF]: an experiment can claim to discriminate only the **exclusive** axes (A, B, C, D). Each subject outcome should be labelled with the full tuple. A run where any of E5/E6b/E7c is still set must yield `AMBIGUOUS` for that axis rather than a narrative choice (Plan §4.5 D4 note; D0 §13 "ambiguous must be an accepted diagnostic outcome").

---

## 4. Contradictions and tensions found

- **T1. The DH-10 scope extends beyond D0 T4-8.** This is not a contradiction. D0 T4-8 covers C6→N2→C8 only. D0 §5's reading "C8 held until E2, ending near E3" is one of two time-consistent readings. The coalescing reading (E3 = p2 + 552.3 ms) is equally consistent. Neither is fully regular: the held reading needs a 686.2 ms gap, and the coalescing reading needs a >133.9 ms consumption stall [EVD][INF]. Whether C8's own transition ever ran is therefore **open**.
- **T2. "Listener removal = fire" is empirically confounded in R1** (§2.5). This strengthens D0's caveat and means R1 offers no within-run latency baseline [EVD][INF].
- **T3. The Plan and D1 differ in confidence.** Plan §2.2 marks C6 "Fixture/target selection: Contradicted" and Plan §2.1 marks H2 "Supported [INFERRED]". D1 §10 states "fixture innocence is not established" and classifies the pattern as only "moderate/partial". **D1 is later and independently accepted, so it governs.** The Plan's wording should not be carried forward. Separately, Plan §2.1's "the Viewer registered its listener" is an attribution that D0 leaves `unattributed` [INF] (a comparison of the repo artifacts; no Viewer docs involved).
- **T4. Interpretation caution on D2 labels.** D2's M-RST (decision on the restored pose) is **not** the historical N2 shape. The historical-like shape is F2 `STALE_PRIOR_TERMINAL` with an intervening restore (DH-2 ∧ DH-3b). The oracle's "CURES" counts (d2-summary.`oracle`, 100% in every cell) are an idealization, not evidence that a public signal would cure anything (D0 §3) [SYN][SRC].

No contradiction with the fixed constraints was found: C8 stays unresolved, C6 stays `NOT_EVIDENCED`, and T4 is unchanged.
