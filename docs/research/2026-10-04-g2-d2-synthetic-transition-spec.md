# G2 D2 — Synthetic-Transition Model: Specification / Research (spec only, remediated v2)

- **Status:** specification/research artifact. **Not** an implementation authorization, procedure amendment, acceptance-contract change, or live-diagnostic authorization. No simulator, harness, test, product, or procedure change exists.
- **Authority:** owner prompts `docs/prompts/for-claude-g2-d2-synthetic-transition-spec-research-only.md` (v1) and `docs/prompts/for-claude-g2-d2-spec-remediation-only.md` (v2 remediation of [independent review](../reviews/2026-10-04-g2-d2-synthetic-transition-spec-independent-review.md)).
- **Baseline (verified):** repo `aps-viewer-clash-detection`, branch `main`, HEAD = `origin/main` = `dee0850b1fbcf23ff8762cf614b4cb4ca88b2836`; harness SHA `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b` and procedure SHA `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75` unchanged; immutable evidence `docs/research/evidence/g2-live-20261004-75a3ccb9/` unchanged; historical live G2 = `FAIL (row 3)`; C6 `NOT_EVIDENCED`; C8 unresolved; T4 unchanged; no retry / new record / attempt reset.
- **Labels:** **[SRC]** pinned Viewer 7.124.2 `viewer3D.js` (decoded SHA-256 `12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e`; `V:<line>`) · **[HAR]** committed harness (`H:<line>`) · **[EVD]** retained evidence · **[D1]** accepted D0/D1 research pattern · **[INF]** inference · **[SYN]** synthetic (defined here, never historical) · **[ASM]** modelling assumption · **[SYN-SENS]** synthetic sensitivity branch (not source-proven).

---

## 1. Goal

Specify a bounded, deterministic, offline model that answers:

> Can the **current** harness observation strategy (frozen T4) mechanically produce a stale or previous-request camera observation under Viewer-like transition scheduling?

D2 targets **mechanical possibility and falsifiability** under stated assumptions. It never reconstructs the historical run.

## 2. Non-goals

D2 does not: prove the historical C8 failure was caused by stale sampling; treat unretained geometry as retained; change T4, C6/N2, or the harness; run the Viewer, a browser, or live G2; choose a final C6 margin; adopt any threshold; authorize any diagnostic or retry. **Even a reproduced one-request-lag pattern proves only mechanical possibility under the modelled assumptions.** Historical causality requires request-correlated live instrumentation or another independently accepted evidence source.

## 3. Historical vs synthetic boundary

### 3.1 Retained inputs actually usable [EVD]
(`R1-clashpanel-viewerbridge-g2-result.json`)

| Item | Retained content |
|---|---|
| U (union of A:135 + B:111) | 8 corners; x ∈ [-135.1979217529297, 126.83025360107422], y ∈ [6.334116458892822, 44.23081588745117], z ∈ [0.25, 17.309173583984375]; C6 `cameraK` 32-entry matrix; ortho (entry 31 = 1) |
| A:104 | box `[-25.502992630004883, 46.41398620605469, -0.3333333432674408, -24.502992630004883, 47.41398620605469, 0.3333333432674408]`; C8 FAIL, worstExcess +5.858358023546797 |
| A:105 | box in `c4Table` (its `s2` camera is **not** retained) |
| C6 / N2 / C8 scalars | C6 worstExcess −0.540675686826625; N2 −0.09999997577575592; C8 +5.858358023546797 |
| pair | `fitPair {a:135, b:111, distance:263.8571494974672}` |

### 3.2 Not retained (never presented as retained)
B:111 box, A:135 box, home camera (`getState` result), post-reset cameras, N2 and C8 camera matrices, `s2` camera, `sampleCount`, per-frame samples, timestamps.

### 3.3 Synthetic inputs
Every synthetic element carries the `SYN-` prefix in fixtures and outputs. **Synthetic:** the missing B:111 and A:135 geometry, the home/target camera, all transition timing and ordering branches, tick-skip delays, the pose numerics (§5.4), the tail-stall sensitivity branch (§5.5), the ease curve, and the geometry fixtures (§9). D1 values are used **only as pattern targets** (§10). No synthetic input is described as reconstructed history.

---

## 4. Source-derived model assumptions

| # | Fact | Anchor |
|---|---|---|
| S1 | `fitToView` → `navigation.fitBounds` computes the destination from the **current** camera at call time and stores it with `setRequestTransitionWithUp`. The destination is frozen at call time. The call itself does not move the camera. | V:29941, 36544, 36974, 95801, 95823 |
| S2 | Exactly **one** pending slot (`__destinationView`); a later request **overwrites** it (last-writer-wins). No queue, no request id. | V:96723-96738 |
| S3 | Pending is consumed inside a **tick** (not inside an rAF) by `ViewingUtilities#update` only if `!getTransitionActive()`. While a transition is active the pending request is **held**. | V:105006-105010 |
| S4 | `goToView` runs step 0 **synchronously in the consuming tick**: elapsed = 0, pose numerically unchanged, `transitionActive := true`, next step scheduled via rAF. | V:106801, 107122, 107155 |
| S5 | Each subsequent step runs in an **autocam rAF**, blends from the autocam's own camera toward the frozen destination (so motion compounds), and writes the real camera **synchronously** (`autocamChange` → `setView` + `syncCamera`). Real duration ≈ 500 ms of accumulated delta from a *separate* rAF chain. | V:107125-107155, 26657-26673, 106679-106687 |
| S6 | Final step order within one rAF callback: snap autocam to destination → write real camera → `setTransitionActive(false)` → `CAMERA_TRANSITION_COMPLETED` (no payload, no request id). A held request is consumed on the **next tick**; between them `active=false ∧ pending≠null` and the camera is static at the previous destination. | V:107098-107117, 26684, 96763 |
| S7 | `getCamera()` returns the live camera; matrices are recomputed synchronously inside each step and inside `restoreState`'s immediate path. | V:27956, 104232-104243, 196009-196012 |
| S8 | `restoreState(home, undefined, true)` returns `false` if state missing / no model; otherwise applies the pose **synchronously** (including `syncCamera(true)`, which only marks the camera updated) and returns `true`. It never touches `__destinationView`, `__transitionActive`, the autocam rAF chain, or the completion event. Exceptions may propagate. The `autocam` key is absent for `getState({viewport:true})`, so the autocam branch of `restoreState` is skipped. | V:38244-38300, 38665-38677, 39000-39003, 33475 |
| S9 | While a transition is active the rAF chain continues, and the final step unconditionally writes the destination to the real camera. **Final pose after completion is the transition destination, not the restored pose.** | V:107098-107110 |
| S10 | The autocam resynchronizes to the real camera through the `cameraChanged` listener (`autocam.sync(realCamera)`), whose event is dispatched from the **render path** when the camera-updated flag is observed — not unconditionally at tick start. Whether that dispatch occurs in the same tick as the write or a tick later is **not established** by D0 and is enumerated, not asserted (§5.2, `SYNC`). Autocam's own writes make the sync an idempotent no-op. | V:26699-26703, 107000-107022, 32507, 150494 **[INF for timing]** |
| S11 | Ticks may be skipped (fence / task budget) and rAF may be throttled. No guarantee that consumption happens on the tick immediately after completion. | V:32822, 17625 **[INF for throttle]** |
| S12 | Not supported by source (must **not** be modelled): a request queue; request ids / payloads on completion; cancellation or supersession of an in-flight transition by `fitToView` / `setRequestTransition` / `restoreState`; retargeting of a held request; a public duration parameter; a same-pose short-circuit. | D0, this task |

**Harness facts [HAR]** (`cc8868cd…`): T4 compares a 32-entry sample `[...matrixWorldInverse, ...projectionMatrix]` (H:8336-8340, 11551-11555); tolerance absolute `1e-9` per entry via `cameraSamplesWithin` (H:8386-8390); settles on the **first sample within tolerance of the previous** (`consecutiveSamples:2` is declared at H:6556 but the loop hard-codes one adjacent pair, H:8411-8432); each iteration is `await waitFrame()` then sample (H:8411-8432, 11556); budget 5000 ms (`cameraSettleDeadlineMs`), timeout → BLOCKED (H:7226-7263); **no** transition-state input, **no** completion event, **no** pre-call camera, **no** request id. `present` does not await the transition; N2's `fitToView` is called synchronously with its return ignored (H:10564). Runner is closed-loop: `present` → `await settle()` → continuation → next step (H:10543-10585). A reset returning `false` is recorded (N2 `RESTORE_FAILED`) and does not by itself stop the run before the next fit (**[ASM] A7**).

**Modelling assumptions [ASM]:**
- **A1:** Poses are *numeric* 4-vectors mapped to a 32-entry sample by the normative map Φ (§5.4); all equality and tolerance decisions for T4 use `cameraSamplesWithin` on those samples. Symbolic labels are used only as names for numeric constants and as ownership tags (§5.6); they never replace numeric comparison.
- **A2 (primary branch only):** every non-final active step after step 0 changes the sample by more than `1e-9` on at least one entry. This is an *invariant checked by the simulator* (§5.7, V5) for `L=0` schedules, and is **relaxed** in the tail-stall sensitivity branch (§5.5). A2 alone never supports an unconditional "no stale observation" claim.
- **A3 (sample level):** Φ(H), Φ(D(1)), Φ(D(2)) are pairwise farther apart than `1e-9` on at least one entry (checked, V5). A no-op fit (destination within tolerance of the pose at call time) is outside the model.
- **A4:** Time is in integer **synthetic frames**. A frame has no relation to wall-clock milliseconds. `D` is a scaled step count (§5.2). A `D=30` characterization witness (§7.5) compares scaled durations with a longer source-like duration without feeding any outcome.
- **A5:** Per-frame phase order `ORD` is fixed within a schedule and drawn from all 6 permutations.
- **A6:** The synthetic ease curve is smoothstep (pure arithmetic, cross-engine deterministic). The real curve is sinusoidal (V:107051); the curve shape is immaterial to ownership/ordering and is not claimed to match.
- **A7:** After a `restore` returning `false` (NOOP) the harness continues (as N2 does until it evaluates `RESTORE_FAILED`). After a thrown `restore` (THROW) the harness aborts the run.
- **A8:** Camera-dependent destination differences (S1) are abstracted: `D(k)` is independent of the from-pose (D2 tests ownership/ordering only); a later model may use `D(k, callPose)`.

---

## 5. State machine

### 5.1 Variables (all domains finite; see §5.3 for counters)

| Variable | Domain | Meaning |
|---|---|---|
| `pendingRequest` | `null` \| `{token, dest}` | the single slot; overwritten by `fit` |
| `activeRequest` | `null` \| `{token, dest}` | request being animated |
| `transitionActive` | bool | mirrors Viewer flag |
| `progress` | 0..D | A-steps taken since consumption (§5.2) |
| `cameraPose` / `autocamPose` | R⁴ vectors | real camera; autocam's own camera (blend source) |
| `cameraOwner` | `INIT` \| `T(k)` \| `T(k)*` \| `RESTORE` | **ownership tag** of the last write to `cameraPose` (§5.6) |
| `cameraUpdatedFlag` | 0..2 | camera-updated signal awaiting camera-change dispatch (§5.2) |
| `completionEventLog` | list of frame numbers | **untagged** public `CAMERA_TRANSITION_COMPLETED` emissions |
| `oracleEvents` | list of `(token, frame)` | model-internal token-carrying completion events (§6.2) |
| `consumeDelayLeft` | −1..S | slot-level skipped-tick counter |
| `settleRecords` | list of `{id, startFrame, prev, nSamples, status}` | one record **per settle invocation**; `prev` is a 32-entry sample or `null`, initialised `null` at activation, discarded at termination; there is **no** global previous-sample variable (a fresh `prev = null` per call, H:8411) |
| `subjectToken` | `T(1)` (F0) \| `T(2)` (F1/F2) | request whose settle is evaluated |

Request tokens: request N−1 ≡ `T(1)`, request N ≡ `T(2)`. `T(k)*` is the *terminal* tag of the final write of request k.

### 5.2 Events and normative step semantics

**Frame micro-order** (frame `f`, in this order):
1. *External events* scheduled for `f` (`fit`, `restore`, settle-loop activation), in schedule-tuple order (`restore` before `fit` when both are in one slot).
2. Phases `H`, `A`, `T` in the schedule's `ORD`. **After phase `H`** (and before the next phase) the *post-H continuation slot* `H+` runs: it contains exactly the harness actions enabled by a settle that **returned in this `H`** (microtask continuation of the `await`; HTML microtask checkpoint after each rAF callback).
3. *Oracle deliveries* due at `f`, after all phases.

**Phase `H` (harness sample).** Every active settle loop, in start order, takes its sample: `sample := Φ(cameraPose)`; `ownerAtSample := cameraOwner`; T4 compares with that settle record's own `prev` (§5.1, §6.1). A loop that settles or times out at this `H` triggers its continuation in `H+` (CL mode only).

**Phase `A` (autocam rAF step).** If `transitionActive`: `progress += 1`; let `k = activeRequest.token`.
- If `progress == D` (**final step**): `cameraPose := autocamPose := dest(k)`; `cameraOwner := T(k)*`; `transitionActive := false`; emit untagged event (append `f` to `completionEventLog`) and `oracleEvents ∋ (k, f)` (token copied from `activeRequest`); `activeRequest := null`; `cameraUpdatedFlag := 1`.
- Else (`1 ≤ progress ≤ D−1`): compute the blend from **`autocamPose`** (§5.4; tail steps per §5.5); `cameraPose := autocamPose := blend`; `cameraOwner := T(k)`; `cameraUpdatedFlag := 1`.

`D` = the number of A-steps after step 0 **including the final destination-snap step**; step 0 is the zero-motion step performed at consumption and is **not** counted in `D`. Completion occurs on the `D`-th `A` phase after consumption. Examples: `D=1`: consume (step 0) → `A`: `progress=1==D` → write `D(k)`, complete (no intermediate pose). `D=2`: consume → `A`: blend `M(k,1)` → `A`: write `D(k)`, complete.

**Phase `T` (tick) = sub-step `C` (consume) then sub-step `R` (camera-change dispatch).**
- `C`: if `pendingRequest ≠ null ∧ ¬transitionActive`: if `consumeDelayLeft == −1` arm it (`:= S`); if `consumeDelayLeft > 0` decrement and **skip**; else consume: `activeRequest := pendingRequest; pendingRequest := null; transitionActive := true; progress := 0; consumeDelayLeft := −1` and perform **step 0** (zero-motion: `cameraPose` and `cameraOwner` unchanged). A `fit` overwriting the slot does **not** reset `consumeDelayLeft` (slot-level; re-armed on the next eligible tick after a consumption). `S=0` consumes on the first eligible tick; that tick can share the frame of the completing `A` only if `A` precedes `T`.
- `R` (camera-change dispatch, `SYNC ∈ {SAME, NEXT}` — an enumerated source unknown, S10): with `SAME`: if `cameraUpdatedFlag ≥ 1` then `autocamPose := cameraPose; cameraUpdatedFlag := 0`. With `NEXT`: if `cameraUpdatedFlag == 2` then `autocamPose := cameraPose; cameraUpdatedFlag := 0`; else if `== 1` then `cameraUpdatedFlag := 2`. (`SYNC` has an effect only after a `restore`; for autocam's own writes the sync is idempotent.) What an autocam sync does to autocam's *other* internal state (e.g. elapsed time) is **outside the model** and not claimed.

**Normative abort example (`THROW` during an active transition).** F2-CL, `D=4`, `S=0`, `ORD=HAT`, `G=0`, `δ=0`: `T(1)` consumed at frame 0 (`T`), active; settle(N−1) returns at `H` of frame 2 and its continuation `H+` runs `restore(THROW)`; the harness aborts (`HARNESS_ABORT`; no `fit(2)`, no settle(N)); shadow execution continues, `T(1)` completes at its final `A` (frame 4), V3 holds, and the schedule's class is `HARNESS_ABORT` (a valid, non-stale terminal).

**Event `fit(k)`:** `pendingRequest := {T(k), dest(k)}` (overwrites). Does not touch the camera (S1).

**Event `restore(result)`** (the home pose `H`, §5.4):
- `OK`: `cameraPose := H`; `cameraOwner := RESTORE`; `cameraUpdatedFlag := 1`; returns `true`. **Does not** change `pendingRequest`, `activeRequest`, `transitionActive`, `progress`, `autocamPose`, or any completion/oracle event list (S8).
- `NOOP`: returns `false`; nothing changes.
- `THROW`: the **harness** aborts (`harnessTerminalStatus := HARNESS_ABORT`). The abort cancels every later harness action of the schedule — the remainder of the same slot (a same-slot `fit`), all later external events, and any not-yet-activated or running settle loop. It does **not** stop the Viewer: **shadow execution continues** (phases `A`/`T`/oracle deliveries keep running to the shadow cap) solely so invariants V1–V4 can be checked on tokens in flight. `simulationTerminalStatus` is the V-check result; V3 therefore applies to tokens active at the abort.

**Who may overwrite the camera next:** only an `A` step of the active request (writing `T(k)` or `T(k)*`), or a later `restore OK`. `fit`, consume/step 0, and the camera-change sync never write `cameraPose`. After `restore OK` during an active transition the next `A` step blends from `autocamPose` (the pre-restore autocam pose) under `SYNC`-delayed dispatch, or from the restored pose if the dispatch ran first; in **both** branches the camera ends at `dest(k)` at completion (S9). The model makes no claim about intermediate poses beyond this enumeration.

**Settle activation (normative, every family and mode).** A settle loop is activated **synchronously immediately after the `fit` it settles returns**, in the same slot and after any `restore` in that slot (matching H:10543-10585, where `settle()` is invoked right after `present`/`fitToView`). It is an explicit schedule event `activate(settle, for=fit k)` at the fit's (frame, slot); it is **not** activated if an earlier harness operation aborted. F0: settle(N−1) after `fit(1)` at the frame-0 external step. F1/F2: the subject settle(N) after `fit(2)`; in CL mode settle(N−1) is activated after `fit(1)`. OP mode simulates only the subject settle.

**Settle loops.** Each settle invocation has independent state `{startFrame, prev, nSamples, status}` (§5.1); only the **subject** settle is simulated, plus, in CL mode, the preceding settle(N−1) that gates N. A settle whose activation occurs in an **external-event step** of frame `f` takes its first sample in phase `H` of frame `f + G`; one activated in a **post-H continuation** of frame `f` takes its first sample in phase `H` of frame `f + 1 + G` (a `rAF` registered during a rAF callback runs next frame). `G ∈ {0,1}` is extra harness latency in frames before the first `waitFrame` registration. Thereafter one sample per frame's `H`.

**Causality rule (normative).** In CL mode no event `issue(N)` (or its `restore`) may execute at a (frame, slot) that precedes the (frame, `H`) at which settle(N−1) returned: `δ=0` places the issue in the post-H continuation `H+` of that same frame (before the remaining phases of that frame); `δ=1` places it in the external-event step of the next frame. No schedule contains a time-travel edge; the simulator asserts this as invariant V0 (§5.7).

**Shadow simulation.** `t4DecisionFrame` (frame at which T4 settles or times out) is distinct from `simulationEndFrame`. After the T4 decision the simulation continues (no further harness actions) until the subject's `oracleEvents` entry is processed with latency `e`, or frame **127** (shadow cap).

### 5.3 Counters and shadow/debug variables (complete list)

| Name | Domain | Init | Update | Reset | Observable | In classification |
|---|---|---|---|---|---|---|
| `frameIndex` | 0..127 | 0 | +1 per frame | per schedule | trace only | no |
| `t4SampleFrameCount` | 0..64 | 0 | +1 per subject-settle sample | per schedule | trace/summary | timeout only: after processing sample 64, if no adjacent pair has settled, the status is `TIMED_OUT` (a 65th sample is never taken) |
| `tickIndex` | 0..127 | 0 | +1 per `T` phase | per schedule | trace only | no |
| `progress` | 0..D (≤30) | 0 | +1 per `A` while active; =0 on consume | on consume | trace | no (state only) |
| `consumeDelayLeft` | −1..2 | −1 | §5.2 `C` | on consume | trace | no |
| `cameraUpdatedFlag` | 0..2 | 0 | §5.2 | on dispatch | trace | no |
| `completionEventCount` | 0..2 | 0 | +1 per terminal step | per schedule | summary | V3 only |
| `oracleDeliveryQueueLen` | 0..2 | 0 | +1 per `oracleEvents`, −1 on delivery | per schedule | trace | no |
| `tailRemaining` | 0..2 | `L` | −1 per tail step written | per consume | trace | no |
| `witnessBudget[cell]` | 0..2 | 2 | −1 per retained witness | per run | summary | no (retention only) |

No unbounded counter exists. Internal-only counters never enter the T4 decision or the class decision (T4 sees only Φ samples; classification uses §7.4 inputs).

### 5.4 Numeric pose model (T4 fidelity)

Poses are 4-vectors `p ∈ R⁴`. The normative sample map is, for `j = 0..31`:

`Φ(p)[j] = p[j mod 4] · (1 + j/32) + j`

evaluated in IEEE-754 double precision in exactly that order (multiplication, then addition). Entries 0..15 stand for `matrixWorldInverse`, 16..31 for `projectionMatrix`; **all 32 entries participate** in T4 as in the harness (no field is excluded or added).

Constants [SYN]: home `H = (0,0,0,0)` (also the initial camera and the restore target, so a successful restore of the captured home is *sample-equal* to the initial pose); destinations `dest(k) = (10k, 5k, 2.5k, 1.25k)` for `k ∈ {1,2}`.

Blend [SRC form, SYN ease]: for step `i` (`1 ≤ i ≤ D−1`), `s = i/D`, `u_i = s·s·(3 − 2·s)`, and `blend = (1 − u_i)·autocamPose + u_i·dest(k)` componentwise (compounding from the current `autocamPose`, as in S5).

T4 equality is `cameraSamplesWithin(a, b) := ∀j |a[j] − b[j]| ≤ 1e-9`.

### 5.5 Bounded tail-stall sensitivity branch [SYN-SENS]

Source does not establish that every non-final step moves by more than `1e-9`. A bounded sensitivity dimension `L ∈ {0,1,2}` (tail length) is part of the exhaustive enumeration:
- `L = 0`: **primary branch** (A2 holds).
- `L ≥ 1`: the last `L` non-final steps (`i = D−L .. D−1`, requiring `D − L ≥ 2` so at least one real moving step precedes them) are **sub-epsilon**: `blend_i = pose_{D−L−1} + (i − (D−L−1))·τ·(1,0,0,0)` with `τ = 1e-10`, so adjacent samples differ by `< 2.0·10⁻¹⁰ ≤ 1e-9` but are not bit-identical. The transition is **not** complete during the tail (`transitionActive` stays true; `cameraOwner = T(k)` non-terminal); the final step still snaps to `dest(k)`.
- The branch is **synthetic**; no claim that the real Viewer produces such a tail. Results are reported in separate cells (§12).

### 5.6 Ownership tags

`cameraOwner` is written at the same site as every camera write (§5.2) — it is *carried by the state machine*, not recomputed from the sample. `INIT` initially; `T(k)` for a non-final A write of request k; `T(k)*` for k's final write; `RESTORE` for `restore OK`. The harness/T4 never reads it; only the classifier/oracle do.

### 5.7 Simulator invariants and expectations

**Invariants** (a failure is a model defect ⇒ cell outcome `C1-INVALID`, §12; process exit code 2):

- **V0:** causality — in CL mode `issue(N)` slot ≻ the `H` at which settle(N−1) returned.
- **V1:** each token has at most one terminal write.
- **V2:** each terminal write produces exactly one `oracleEvents` entry and one untagged event, and the entry's token equals the active token at that step.
- **V3:** every token that was consumed completes within the shadow cap exactly once (enumerated domain guarantees completion < frame 127).
- **V4:** token flow monotone: slot → active → terminal; no token consumed twice; a slot overwrite discards the old token without completion.
- **V5:** numeric sanity: A3 holds; for `L=0` every non-final step has a sample change `> 1e-9`; for `L≥1` tail steps change `≤ 1e-9` and `> 0`.
- **V7:** settle activation — every activated settle's activation slot equals its `fit`'s slot (immediately after the fit/restore of that slot); no settle is activated after an abort.

**Expectation E6** (not an invariant): `TIMED_OUT` and `PRECONDITION_BLOCKED` do not occur in an enumerated schedule (settle is guaranteed by sample < 64). An occurrence is a **valid but inconclusive** terminal (cell `C2-INCONCLUSIVE`, exit code 0), never a model defect; in the D=30 characterization witnesses they are merely reported.

### 5.8 `restore` variants (not a guaranteed reset)

Produced by `restoreVariant ∈ {OK-SAME, OK-NEXT, NOOP, THROW}` and the restore frame/slot (§7): idle/no pending; idle with pending; during an active transition; in the completion→consumption gap; no-op; throwing. None is asserted historical. Reported per schedule.

---

## 6. Observation strategies modelled

### 6.1 Current T4 (frozen, modelled with numeric fidelity)
32-entry sample `Φ(cameraPose)` per §5.4 (all entries; same included/excluded fields as the harness); element-wise absolute tolerance `1e-9`; **settles on the first sample within tolerance of the previous** (one adjacent pair; first sample cannot settle); one sample per modelled frame at phase `H`, after the `waitFrame` latency (`G`); zero-motion acceptance: two sample-equal frames settle regardless of motion or ownership; no transition-state, completion, pre-call-camera, or request input. Budget: **64 samples** (after processing sample 64 with no settled adjacent pair the settle returns `TIMED_OUT`; no 65th sample) — a *synthetic* stand-in for the 5000 ms deadline (A4); synthetic frames are not milliseconds. A timeout branch is **bounded** (`TIMED_OUT` terminal, expectation E6) and **excluded from acceptance-like conclusions**; D2-OFFLINE never infers behaviour at the real 5000 ms deadline. D2 proposes **no** new T4 algorithm.

### 6.2 Request-tagged completion (idealized oracle, comparison only)
A completion is **request-tagged for the subject** iff the harness could determine that the completion corresponds to the specific fit request whose result is evaluated — distinct from a generic camera change, the untagged `CAMERA_TRANSITION_COMPLETED`, or generic render completion. D0: no public request-correlated signal exists; the oracle is an idealization, not a claim about the Viewer.

**Independent token flow.** The oracle's tag is generated and carried **by the state machine** (token issued at `fit`, moved slot → active → terminal, copied into `oracleEvents` at the terminal step; §5.2). The classifier's ownership comes from `cameraOwner` written at the camera-write site. Neither is looked up from the other and neither is derived from comparing the observed sample with the expected destination.

**Oracle receiver.** An event `(token, frame c)` is delivered at the end of frame `c + e`, `e ∈ {0,1}` (analysis parameter, not an enumeration dimension). At delivery the receiver takes a snapshot `(cameraOwner, Φ(cameraPose))`. `OraclePass(subject, e)` ≡ `token == subject ∧ snapshot.cameraOwner == subject*`. Oracle verdicts per stale schedule: `CURES` (pass), `NOT_CURED_OWNER_CHANGED` (event delivered but a later write changed the owner), `NO_EVENT` (not delivered by cap). These are **results**, not defects; a defect is any V0–V5/V7 failure.

---

## 7. Finite schedule space

Request N−1 (`T(1)`) is issued at frame 0 (external step) from idle (camera `H`, owner `INIT`); request N (`T(2)`) later. Subject: N−1 for F0, N for F1/F2.

### 7.1 Dimensions and exact domains

| Dim | Domain | Meaning |
|---|---|---|
| `D` | {1,2,3,4,6,10} | A-steps after step 0 incl. final snap (§5.2) |
| `L` | {0,1,2}, with `D − L ≥ 2` when `L ≥ 1` | tail length (§5.5); `L=0` ⇒ primary branch |
| `S` | {0,1,2} | skipped eligible ticks per consumption |
| `ORD` | 6 permutations of (H,A,T) | in-frame phase order |
| `G` | {0,1} | extra harness latency (§5.2) |
| Family | F0, F1, F2 | see below |
| Mode | CL (closed loop), OP (open loop) | see below |
| `restoreVariant` | {OK-SAME, OK-NEXT, NOOP, THROW} | F2 only |

Valid `(D,L)` pairs: `L=0`: 6 pairs, ΣD = 26; `L=1` (D ≥ 3): D∈{3,4,6,10}, 4 pairs, ΣD = 23; `L=2` (D ≥ 4): D∈{4,6,10}, 3 pairs, ΣD = 20. Primary pairs `P₀ = 6`; tail pairs `P₁ = 7` (ΣD = 43); all pairs `13` (ΣD = 69).

- **F0** (single request N−1; settle it; harness-faithful, assigned to scope CL): tuple `(D,L,S,ORD,G)`.
- **F1** (back-to-back fits): fit N−1 at frame 0, fit N later.
  - **CL:** issued at `δ ∈ {0,1}` (§5.2 causality rule).
  - **OP:** `tN ∈ [0, D+S+3]` in the external step (non-faithful superset).
- **F2** (restore + fit; N2 shape): fit N−1 at frame 0; then `restore(restoreVariant)`; then fit N.
  - **CL:** restore at the `δ ∈ {0,1}` slot; fit N at `ρ ∈ {0,1}` after it (`ρ=0`: same slot, restore first; `ρ=1`: external step of the next frame).
  - **OP:** restore at external step `r ∈ [0, D+S+3]`; fit N at `r+ρ`, `ρ ∈ {0,1}`.
- In CL mode, if settle(N−1) times out or throws, the schedule ends `PRECONDITION_BLOCKED` (valid, not stale; expectation E6).

### 7.2 Cardinality (arithmetic shown)

Per `(D,L)` pair the free multiplicity is `S(3) × ORD(6) × G(2) = 36`; `Σ_S(D+S+4) = 3D+15`. Over primary pairs `Σ(3D+15) = 3·26 + 15·6 = 168`; over tail pairs `3·43 + 15·7 = 234`; total `402`.

| Family / mode | Formula | Primary (`L=0`) | Tail (`L≥1`) | Total |
|---|---|---|---|---|
| F0 | pairs × 36 | 6·36 = 216 | 7·36 = 252 | **468** |
| F1-OP | Σ(3D+15) × ORD·G(12) | 168·12 = 2,016 | 234·12 = 2,808 | **4,824** |
| F2-OP | Σ(3D+15) × 12 × variants(4) × ρ(2) | 168·96 = 16,128 | 234·96 = 22,464 | **38,592** |
| F1-CL | pairs × 36 × δ(2) | 6·72 = 432 | 7·72 = 504 | **936** |
| F2-CL | pairs × 36 × δ(2) × ρ(2) × variants(4) | 6·576 = 3,456 | 7·576 = 4,032 | **7,488** |
| **Total** | | **22,248** | **30,060** | **52,308** |

Outcome cells (§12): `(CL,primary) = 216+432+3,456 = 4,104`; `(CL,tail) = 252+504+4,032 = 4,788`; `(OP,primary) = 2,016+16,128 = 18,144`; `(OP,tail) = 2,808+22,464 = 25,272`; sum = 52,308.

**A conforming implementation MUST print `52308` (and the four cell counts); a mismatch is a conformance failure (`C1-INVALID`, exit code 2), not a result.**

### 7.3 Enumeration order and identifiers
Lexicographic over `(family, mode, D, L, S, ORD_index, G, restoreVariant_index, δ|tN, r, ρ)` where `family` orders F0<F1<F2; `mode` orders CL<OP (F0 uses CL); `ORD_index` orders `HAT, HTA, AHT, ATH, THA, TAH`; `restoreVariant_index` orders `OK-SAME, OK-NEXT, NOOP, THROW`; every non-applicable field is the sentinel `−1` (sorting first). Schedule id `S-<5-digit zero-padded 0-based rank>` (0..52307). Characterization-witness id `CW-<family>-<ORD>-<G>`. No randomness.

### 7.4 Classifier (per schedule, evaluated at the T4 decision)

**Inputs:** T4 status; `ownerAtSample` (the `cameraOwner` recorded with the deciding sample); the subject's state at the decision (`PENDING`, `ACTIVE0` = consumed with `progress=0`, `ACTIVE+` = `progress≥1`, `COMPLETE`); `transitionActive`; sample-level check `within(sample, Φ(dest(subject)))`.

**Primary class — decision list, first match wins (mutually exclusive, exhaustive):**

1. `PRECONDITION_BLOCKED` — CL only: settle(N−1) did not return `settled` (valid terminal; E6).
2. `HARNESS_ABORT` — restore `THROW`.
3. `TIMED_OUT` — no settle within 64 samples.
4. `INVALID_AMBIGUOUS` — inconsistent evidence: `ownerAtSample == subject*` but `¬within(sample, Φ(dest(subject)))`, **or** `within(sample, Φ(dest(subject)))` but `ownerAtSample ≠ subject*`.
5. `OWNED` — `ownerAtSample == subject*`.
6. `STALE_PRIOR_TERMINAL` — `ownerAtSample == T(j)*`, `j ≠ subject`.
7. `STALE_RESTORE` — `ownerAtSample == RESTORE`.
8. `STALE_INIT` — `ownerAtSample == INIT`.
9. `STALE_IN_FLIGHT` — `ownerAtSample == T(j)` (non-terminal), any `j` (reachable only when a tail-stall settles a transition not yet complete, or on a sample-equal consecutive pair while a transition is mid-flight).

Every terminal simulation result maps to exactly one primary class; classes 1–4 are non-stale and non-owned terminals: 1–3 are **valid terminals** (no stale evidence; under E6, 1 and 3 make the cell `C2-INCONCLUSIVE`), 4 is a model defect (`C1-INVALID`).

**Mechanism labels** (non-exclusive; defined from state, not sample): `M-PRE` ⇔ subject state ∈ {PENDING, ACTIVE0} at the decision; `M-GAP` ⇔ `STALE_PRIOR_TERMINAL ∧ subject PENDING ∧ ¬transitionActive`; `M-RST` ⇔ `STALE_RESTORE`; `M-TAIL` ⇔ `STALE_IN_FLIGHT ∧ L ≥ 1`. `classCounts` counts primary classes; `mechanismCounts` counts labels.

**Stale** ≡ primary class ∈ {`STALE_PRIOR_TERMINAL`, `STALE_RESTORE`, `STALE_INIT`, `STALE_IN_FLIGHT`}. The sample-level T4 verdict is always `settled` for stale classes (T4 cannot tell them from OWNED); the oracle verdict (§6.2) is recorded alongside.

### 7.5 Characterization witnesses (D=30; non-exhaustive)

**Characterization only; not part of the 52,308; never feeds an outcome cell or any exhaustive claim.** Purpose: compare scaled short transitions with a longer source-like duration. Domain: `D=30, L=0, S=1`, CL, families F0, F1 (`δ=0`), F2 (`restoreVariant=OK-SAME, δ=0, ρ=0`), all 6 `ORD`, `G ∈ {0,1}` ⇒ **3 × 6 × 2 = 36** schedules. `TIMED_OUT` is permitted here (E6 does not apply) and is only reported.

### 7.6 Exhaustiveness statement
Within the domains above the search is **exhaustive**. It is **not** exhaustive over: `D` outside {1,2,3,4,6,10}, `S>2`, `L>2` or other tail shapes/magnitudes, fractional frames, per-frame order changes, more than two requests, other autocam internal state affected by sync, multi-listener event ordering, or the real ease curve. Any "no stale observation" result is scoped to the corresponding cell and its branch assumptions.

### 7.7 Expected mechanisms (hypotheses, not conclusions)
- **M-PRE:** after `fit`, the request is held until a consuming tick; step 0 is zero-motion; the camera is sample-equal for ≥ 2 harness frames → T4 settles on the pre-request pose (possible even for a single request).
- **M-GAP:** after N−1's final step, `active=false ∧ pending=N` for ≥ 1 tick; camera static at `dest(N−1)` → T4 settles on N−1's result (one-request-lag shape).
- **M-RST:** restore changes the camera; a held/active request later replaces it; T4 may settle on the restored (home) pose before N owns the camera.
- **M-TAIL:** a sub-epsilon tail lets T4 settle during an incomplete transition.
Whether each is reachable under CL (the real runner's sequencing) is the research question.

---

## 8. Falsifiability rules

### 8.1 H2 — stale / early camera observation
Within an outcome cell (§12): **supported** (mechanical possibility under the cell's assumptions) iff ≥ 1 schedule in the cell has a stale primary class; **rejected within that cell** iff all schedules of the cell are enumerated, zero are stale, and the cell has no model-invalid result. A reported rejection is scoped to that cell's mode and branch (§7.6) and is **not** an unconditional impossibility claim.

### 8.2 H5 — other async state
Supported iff ≥ 1 valid stale schedule's mechanism-label set does **not** contain `M-GAP` (a stale observation without the specific one-request-lag mechanism). The labels then say which modelled mechanism applies (`M-PRE`, `M-RST`, `M-TAIL`). Model defects (V0–V5/V7 failures, `INVALID_AMBIGUOUS`, count mismatch) **never** support H5; they force the cell to `C1-INVALID`. H5 is a statement about the model, not about the real Viewer.

### 8.2a Per-cell hypothesis verdicts (required output)
For each outcome cell the summary records `H2 ∈ {SUPPORTED, REJECTED, INVALID, INCONCLUSIVE}` and `H5 ∈ {SUPPORTED, REJECTED, INVALID, INCONCLUSIVE}`: `SUPPORTED` per §8.1/§8.2; `REJECTED` iff the cell is fully enumerated, valid, free of inconclusive terminals, and the predicate has no witness; `INVALID` iff the cell is `C1-INVALID`; `INCONCLUSIVE` iff the cell is `C2-INCONCLUSIVE` and the predicate has no witness.

### 8.3 Product / navigation defect
D2 can neither prove nor reject a product/navigation defect historically. It isolates only whether **harness-side** stale observation is mechanically possible.

### 8.4 Oracle comparison
For stale schedules, tabulate `CURES / NOT_CURED_OWNER_CHANGED / NO_EVENT` per `e`. `CURES` means a request-tagged completion would have given the correct ownership *in the model*; it informs a later T4-REMEDIATION gate but selects no algorithm.

---

## 9. Synthetic fixtures

### 9.1 Geometry fixtures (normative; [SYN] unless stated)
Orthographic, axis-aligned view of the xy plane; z assumed inside near/far (only xy enters the excess; `w=1`). Aspect `α = 676/380` (**retained-derived** from C6 ortho extents, D1).
- **Boxes:** `SYN-A` = [−0.5,0.5]×[−0.5,0.5]; `SYN-B` = [d−0.5,d+0.5]×[dy−0.5,dy+0.5] (z-size 0.667 inert). `d ∈ {5, 20, 50, 100, 263.8571494974672, 500}` where `263.8571494974672` is **loaded from R1 `targets.fitPair.distance`** (the fixture constant must equal it bit-for-bit or the run fails closed), `dy ∈ {0, 38}` (U's retained y-span ≈ 38). `SYN-U` = AABB union. Not B:111/A:135.
- **Synthetic calibration anchor `κ`:** the value `0.9` is a **synthetic calibration anchor**, *not* a fit margin, *not* an acceptance threshold, *not* the C6 margin. It is read from the retained N2-like sample (extremes y = 0.8999999274 / −0.9000000242; D1) and is **not** independently derived from the pinned `computeFit`. It exists only to scale synthetic fit geometry. It is varied (`κ ∈ {0.85, 0.90, 0.95}`, exploratory) and RET-U consistency (§9.2) is not independent validation of any Viewer fit algorithm.
- **Fit:** for boxes with projected AABB centre `(cx,cy)` and half-extents `(hx,hy)`: view half-width `w = max(hx, α·hy)/κ`. NDC of `(X,Y)`: `x=(X−cx)/w`, `y=α(Y−cy)/w`. `τ_U(camera) = ` max over U's 4 xy corners of `max(|x|,|y|)`. **O1 = τ_U − 1** (matches harness `worstExcess` for `w=1`, z inside). **O2 = τ_U.** **O3 = signed x of U's AABB centre in NDC.**
- **Classes:** `P_C6 = fit(U)`, `P_N2 = fit(B)`, `L_N2stale = fit(U)` (same camera as `P_C6`; differ only in role and not compared as opposing classes), `L_prev = fit(A)`, `L_home(k) = fit(U)` with `w` multiplied by `k ∈ {1.5, 2, 3, 5}` (centre unchanged).
- **Variation set V (75 elements, exploratory):** `κ ∈ {0.85,0.90,0.95}` × centre offsets `(ox,oy) ∈ {−0.02,−0.01,0,0.01,0.02}²` (Cartesian product). Exact perturbed equations: with `w` from the fit, the camera centre becomes `cx' = cx + ox·w`, `cy' = cy + oy·w/α`, and the NDC of `(X,Y)` is `x = (X−cx')/w`, `y = α(Y−cy')/w`. A positive `ox` therefore moves U's projected position by `−ox` in NDC; O3 is evaluated with these equations (sign included).

### 9.2 Retained-anchored fixture
`RET-U` (the 8 retained U corners) is a *consistency anchor only*: `fit(RET-U)` with `κ=0.9` must reproduce the retained N2-like worstExcess ≈ −0.1 on RET-U. It does not infer unretained values and does not validate a Viewer algorithm.

### 9.3 Pose fixtures (state machine)
Numeric poses and Φ per §5.4. Distinctness (A3) is checked at the sample level (V5).

---

## 10. D1 pattern comparison (targets, not ground truth)

| Target | D1 value | Used for |
|---|---|---|
| C6-like | worstExcess(U) −0.5407, max \|NDC\| 0.459 (home-like / pre-request) | class `L_home` fingerprint |
| N2-like | worstExcess(U) −0.1000, NDC extent 0.900 (≡ aggregate fit of U at the anchor) | class `L_N2stale` fingerprint |
| C8-like | worstExcess(A:104) +5.858; U corner projects to ≈(0, 0.9) | class `L_prev` fingerprint (corner element) |
| overall | moderate/partial, n=3 non-independent, no-op fit indistinguishable from lag | confidence limits |

**Similarity metrics (defined before implementation):** m1 = |worstExcess_syn − worstExcess_target|; m2 = |maxNDC_syn − maxNDC_target|; m3 = framing-centre distance in NDC (Euclidean); m4 = direction cosine of (camera→target) (only if both poses exist; **not applicable** to unretained cameras); m5 = normalized projected-bounds difference |extent_syn − extent_target|/extent_target. No threshold is asserted. **Exploratory** reporting criterion: m1 ≤ 0.05 and m2 ≤ 0.05, not used for any conclusion. A "match" shows the model *can generate a sample of that shape*, not that the historical sample was so generated.

---

## 11. C6 / N2 synthetic control research design

### 11.1 Question
Can the **current** N2 control (restore → single-model fit B → settle → test containment of U; `DETECTED_RESTORED` iff U falls outside the frustum) discriminate aggregate framing, single-model framing, stale-camera observation, and prior-request camera reuse?

### 11.2 Observables (dimensionless; defined in §9.1)
**O1** (current harness observable, containment), **O2** (tightness), **O3** (signed centre offset). Note: C6 PASS under O1 is *vacuous* for a loose home-like camera (−0.54 passes), so C6-vs-home discrimination needs O2 or O3, not O1.

### 11.3 Expected analytic structure (to be confirmed by D2-OFFLINE, not asserted)
- Under correct operation `P_N2 = fit(B)`: O1 > 0 for U much larger than B → `DETECTED_RESTORED`. As `d → 0`, `fit(B) → fit(U)` and O1 → `κ−1`, so the control becomes **non-discriminating by geometry alone** (before any staleness).
- `L_N2stale = fit(U)` yields O1 = `κ − 1` regardless of `d` → N2 reads `NOT_DISCRIMINATING`. So **N2 `NOT_DISCRIMINATING` is consistent with a stale/aggregate observation *or* too-small `d`**; the current control cannot tell these apart without a separate geometry-sufficiency check.
- `P_N2` and `L_prev` are symmetric under `dy=0` for O1; they separate (if at all) on O3 (signed x).

### 11.4 Unified separation notation (single definition; used by §11.5, §12, §14, §15)
For a cell `(d,dy)`, a class `c`, and an observable `o ∈ {O1,O2,O3}`, let the **class interval** be `I_c(o) = [lo_c, hi_c]` = min/max of `o` over `V` (and over `k` for `L_home`); its **within-class range** is `w_c = hi_c − lo_c`. For an unordered class pair `{c1,c2}` the **separation** is

`sep_o(c1,c2) = max(lo_c1 − hi_c2,  lo_c2 − hi_c1)`  (orientation-independent; `> 0` ⇔ disjoint; `≤ 0` ⇔ overlapping or touching ⇒ **not separated**).

Exploratory **stability rule** (`f_x = 3`, exploratory only): the pair is *stably separated on `o` in the cell* iff `sep_o > 0 ∧ sep_o ≥ f_x · max(w_c1, w_c2)`. If `max(w) = 0`, the rule reduces to `sep_o > 0`. A pair *passes in the cell* iff it is stably separated on **at least one** of O1, O2, O3 (report which). The reported **candidate separator** per passing cell/observable is the gap midpoint `(hi_lower + lo_upper)/2`; it is an *observation*, never adopted as a margin or threshold.

**The four ordered discrimination pairs (normative):** `{P_C6, L_home}`, `{P_C6, L_prev}`, `{P_N2, L_N2stale}`, `{P_N2, L_prev}`.

**`d_min` (observed quantity):** the smallest grid value `d_min ∈ {5,20,50,100,263.8571494974672,500}` such that every one of the four pairs passes in **every** cell with `d' ≥ d_min` (both `dy`); `none` if no such value. `d_min` is an observation about the synthetic grid, **not a threshold**.

### 11.5 Margin-derivation method (no margin chosen here)
For each cell: compute class intervals and `w_c` (within-class variability), `sep_o` (between-class separation), apply the exploratory stability rule, and report `d_min`. If no stable separation exists for a pair (e.g. `{P_N2, L_N2stale}` for small `d`, or `{P_C6, L_home}` under O1), the current control design is declared unsuitable **for that pair** (control outcome E). `f_x = 3`, `d_min`, `V`, and the candidate separators remain **exploratory**; D2-OFFLINE results must be collected and reviewed **before** any owner decision on adopting any threshold. No threshold, `S3`, or `N2 − C6 ≥ ~1` option is adopted by D2, and no production or acceptance margin is selected.

---

## 12. Outcome matrix

### 12.1 Scheduling axis — one outcome per cell
Cells: `(CL, primary)` 4,104; `(CL, tail)` 4,788; `(OP, primary)` 18,144; `(OP, tail)` 25,272 schedules (§7.2). Characterization witnesses (§7.5) never enter a cell.

| Cell outcome | Condition (precedence: C1, then A, then C2, then B) | Exit |
|---|---|---|
| **C1-INVALID** | any of: cell count ≠ §7.2; invariant failure V0–V5/V7; any `INVALID_AMBIGUOUS`; input-hash mismatch (§15) — model/conformance defect; no inference; a bounded diagnostic witness is retained (§14) | 2 |
| **A** | not C1, and ≥ 1 schedule in the cell has a stale primary class; records mechanism-label counts and the oracle verdict table (§8.4) | 0 |
| **C2-INCONCLUSIVE** | not C1, no stale schedule, but ≥ 1 `TIMED_OUT` or `PRECONDITION_BLOCKED` (E6) — a valid result that leaves the cell undecided | 0 |
| **B** | not C1, all cell schedules enumerated with only `OWNED` / `HARNESS_ABORT` terminals; valid **only for that cell's mode and branch**; no claim beyond §7.6 | 0 |

The process exit code is 2 if any cell is `C1-INVALID`, else 0. `C` below means the umbrella "no inference possible" (C1 or C2).

`HARNESS_ABORT` schedules (restore `THROW`) are valid, non-stale, non-owned terminals counted in `classCounts` and do not by themselves cause C1, C2 or A (they are allowed in B). A **combined** statement is made only as the quadruple of the four cell outcomes; an unconditional "T4 cannot produce stale observations in the model" requires all four cells = B **and** owner acceptance of the branch assumptions (§5.5), and is never inferred from the primary cells alone.

### 12.2 Control axis — D / E
| Outcome | Condition |
|---|---|
| **D** | `d_min` (§11.4) exists and `d_min ≤ 263.8571494974672` (retained pair distance in the grid) — C6/N2 control can be made discriminating *synthetically* on the stated subset; candidate separators reported, not adopted |
| **E** | otherwise (some required pair has no stable separation at and above 263.8571494974672) — control unsuitable for that pair even synthetically; report which pairs |

The scheduling axis (four cell outcomes) and control axis (D or E) are independent. None is a historical-causality verdict. The D/E label is descriptive of the exploratory grid.

---

## 13. Future gate mapping (no gate authorizes itself)

| Gate | Scope | State |
|---|---|---|
| **D2-SPEC** | this specification/research only | current task |
| **D2-OFFLINE** | implement offline simulator + tests per §14–15 | future; separate owner authorization |
| **DIAGNOSTIC-INSTRUMENTATION** | add request-correlated camera/transition evidence capture | future; separate authorization |
| **DIAGNOSTIC-LIVE** | separately authorized diagnostic live run, only if still needed | future; separate authorization |
| **T4-REMEDIATION** | only if evidence supports a T4 change; requires procedure re-acceptance | future |
| **ACCEPTANCE-RETRY** | separate from diagnostic live; new checkpoint, new authorization record, explicit exactly-one owner authorization | future |

### 13.1 Recorded owner recommendations (adopted by the remediation authorization; none authorizes implementation)
- **Durations:** exhaustive `D ∈ {1,2,3,4,6,10}` plus the `D=30` characterization witness (§7.5); all labelled scaled synthetic frames, not milliseconds.
- **`3×` and `d_min`:** exploratory only; no gate/threshold; D2-OFFLINE results are collected before any threshold decision.
- **Recommended future simulator location:** `docs/research/2026-10-04-g2-d2-synthetic-transition/` (pure-ESM simulator, colocated offline tests/fixtures, temporary outputs by default; checkpointing outputs under `docs/research/evidence/` only under a later explicit evidence authorization). **Nothing is created there now.**
- **Undocumented Viewer observables policy:** (1) allowed as **version/hash-bound offline source-model inputs**; (2) allowed in a **separately authorized diagnostic run** only if explicitly approved (drift / fail-closed handling); (3) **not allowed as production or acceptance dependencies** without procedure re-acceptance. Nothing is wired now.

---

## 14. Evidence / size bounds (deterministic caps)

| Item | Cap |
|---|---|
| schedules | exactly **52,308** enumerated (four cells 4,104 / 4,788 / 18,144 / 25,272) + **36** characterization witnesses reported separately; abort if enumerated count ≠ 52,308 (conformance failure) or > 60,000 |
| frames per schedule | T4 decision ≤ 64 samples; simulation ≤ 128 frames (shadow cap 127) |
| camera samples per schedule | ≤ 64 |
| retained failure witnesses | ≤ 2 per (family × mode × branch × stale class) = ≤ 3·2·2·4·2 = **96**, lowest schedule ids; plus one OWNED exemplar per (family × mode × branch) = **12**; plus the **36** characterization traces; plus ≤ **10** diagnostic witnesses (first failure of each of V0–V5, V7, `INVALID_AMBIGUOUS`, first unexpected `TIMED_OUT`, first `PRECONDITION_BLOCKED`; count-mismatch failures carry no trace) ⇒ ≤ **154** traces |
| trace row (minimum schema) | `{f, ph, ev, pend, act, prog, own, ta, smp, out}`: frame; phase/slot id; external event (or `-`); pending token; active token; progress; `cameraOwner`; `transitionActive`; sample decision (settle id + `none/prev/settled/timeout`); emitted/delivered events — ≤ 128 B canonical JSON, ≤ 128 rows ⇒ ≤ 16 KiB per trace |
| raw witness traces (`d2-witnesses.json`) | 154 × 16 KiB = 2,464 KiB ≤ **2.5 MiB** (2,560 KiB) |
| summary JSON | ≤ 512 KiB (counts only; no per-schedule rows) |
| geometry study | 6 `d` × 2 `dy` × 8 class instances (`P_C6`,`P_N2`,`L_N2stale`,`L_prev`,4×`L_home`) × 75 `V` = **7,200** evaluations per observable; table ≤ 256 KiB |
| total output directory | ≤ **3.5 MiB**; abort (non-zero exit) rather than truncate silently |

Neither the `D=30` witnesses (fixed 36 schedules, one trace each) nor the tail-stall branch (counted in 52,308; summary-only except bounded witnesses) can enlarge outputs beyond these caps.

## 15. Reproducibility requirements

- **Runtime:** Node.js satisfying the repo contract (`package.json` `engines` `>=20`; observed baseline `v22.23.1`); results must be byte-identical on both; pure ESM; **no third-party dependencies**; no network, Viewer, or browser; no `Math.random`; no wall-clock reads in results; arithmetic only with `+ − × ÷` (no `Math.cos/sin`) to avoid cross-engine drift.
- **Randomness:** none. Any later proposal requires a fixed documented seed and owner approval.
- **Input files (read-only, mandatory):** (1) this spec file; (2) `test/acceptance/clashpanel-viewerbridge.acceptance.mjs` (the harness); (3) the retained R1 JSON (§3.1 values only); (4) a `fixtures.json` defining §5.4 constants and §9 fixtures. The simulator **hashes the bytes of all four at runtime** and records `{expected, observed}` per input. **Fail closed (exit 2, `C1-INVALID`)** on any mismatch with an expected digest: expected values are the harness SHA `cc8868cd…ef09b`, the R1 digest recorded in the evidence `MANIFEST.md`, and the `fixtures.json` digest pinned by the D2-OFFLINE authorization; the spec's own digest has no self-referential expected value and is recorded as `observed` (the authorization pins it). Nothing is copied as a constant into the output.
- **Output schema (`d2-summary.json`):** `{ schemaVersion, inputHashes{spec,harness,r1,fixtures:{expected,observed}}, enumerationCount, cellCounts{CL-primary,CL-tail,OP-primary,OP-tail}, domains, classCounts{cell,family,class}, mechanismCounts{cell,label}, invariantResults{V0..V5,V7}, expectationE6{count}, oracle{cell,e,CURES,NOT_CURED_OWNER_CHANGED,NO_EVENT}, outcomeSchedule{cell→A|B|C1-INVALID|C2-INCONCLUSIVE}, hypotheses{cell→{H2,H5}}, diagnosticWitnesses[], characterization{count:36, classCounts}, geometry{cells[], classIntervals, sep, stablePairs, candidateSeparators, d_min}, outcomeControl{D|E, failingPairs[]}, witnesses[{witnessId, scheduleId, tuple, traceRef, classification}], caps{observed, limit}, companionDigestSha256, outputDigestSha256 }`.
- **Canonicalization:** UTF-8, LF, sorted keys, no insignificant whitespace; `outputDigestSha256` is computed over the canonical serialization of the summary object **with that field omitted**; the companion file `d2-witnesses.json` (witness traces) has its own digest recorded in the summary. Every synthetic fixture, witness, and geometry-cell **object** carries `synthetic: true` (primitives inherit it).
- **Identifiers:** schedule ids `S-nnnnn` (§7.3); witness ids `W-<scheduleId>`; characterization ids `CW-…`; fixed deterministic enumeration order (§7.3).
- **Determinism check:** two consecutive runs produce byte-identical outputs (equal `outputDigestSha256`).
- **Future command shape (NOT created or run now):** `node <d2-dir>/simulate.mjs --out <dir>`; `node --test <d2-dir>/*.test.mjs`; `node <d2-dir>/simulate.mjs --out <dir2> && diff -r <dir> <dir2>`, where `<d2-dir>` is the recommended location in §13.1.
- Implementation file names and test list are decided at D2-OFFLINE authorization time.

---

## 16. Unresolved owner decisions

1. Authorize D2-OFFLINE (simulator + tests), or stop at the spec?
2. Accept the tail-stall sensitivity parameters (`L ∈ {0,1,2}`, `τ = 1e-10`) or require other shapes/magnitudes?
3. Accept the exploratory grid/variation choices (`V`, `f_x = 3`, `d` and `dy` sets) — all exploratory, none a gate.
4. Whether simulator outputs are ever checkpointed as evidence (default: temporary).
5. Whether a later gate may use undocumented Viewer observables for a request-tagged signal (policy in §13.1; each use needs its own authorization).

D2 decides none of these.

---

## Appendix A — Remediation log (v1 → v2)

| Independent finding | Disposition | Section |
|---|---|---|
| C1 closed-loop `δ=0` issues N before the authorizing `H` | Fixed: post-H continuation slot `H+`, causality rule, invariant V0, `G` redefined, schedule space recounted | §5.2, §7 |
| H1 restore/autocam sync assigned to tick start; no THROW | Fixed: camera-change dispatch is its own sub-step `R` with enumerated `SYNC`; restore effects/ownership explicit; `THROW` branch | §5.2, §5.8, S10 |
| H2 self-referential oracle | Fixed: tokens and ownership tags carried by state machine; receiver snapshot rule; invariants V1–V4; results vs defects separated | §5.6, §6.2, §5.7 |
| H3 classifier/outcome inconsistency; CL/OP; H5 conflation | Fixed: one enum, decision list, per-cell outcomes, defects only force C | §7.4, §8, §12 |
| H4 symbolic T4 equality | Fixed: numeric Φ samples + `cameraSamplesWithin` tolerance; home/restore sample-equal | §5.4, §6.1, A1/A3 |
| H5 conflicting gap formulas | Fixed: one orientation-independent `sep`; `d_min` observed | §11.4 |
| M1 no tail stall | Fixed: bounded sensitivity dimension `L` in the enumeration | §5.5, §7 |
| M2 missing `D=1` | Fixed: `D ∈ {1,2,3,4,6,10}`; `D` defined | §5.2, §7 |
| M3 scaled timeout | Fixed: synthetic frames; 64-sample bounded branch; excluded from acceptance-like conclusions | §6.1, A4 |
| M4 counter domains | Fixed: complete counter table | §5.3 |
| M5 `0.9` as margin | Fixed: relabelled **synthetic calibration anchor `κ`** | §9.1, §9.2, §10, §11 |
| Owner adoptions (durations, `3×`/`d_min`, location, observables) | Recorded | §13.1 |
| Internal review round (v2): `THROW` vs V3 | Fixed: harness vs simulation status; shadow continues; abort example | §5.2 |
| Internal review: settle activation unspecified | Fixed: normative activation event + V7 | §5.2, §5.7 |
| Internal review: valid terminals vs outcome C | Fixed: `C1-INVALID` / `C2-INCONCLUSIVE`, exit codes, E6 | §5.7, §12 |
| Internal review: 64-sample off-by-one; global `t4Prev` | Fixed | §5.1, §5.3, §6.1 |
| Internal review: hash inputs; geometry exactness; diagnostic witnesses; H2/H5 verdicts | Fixed | §15, §9.1, §14, §8.2a |
