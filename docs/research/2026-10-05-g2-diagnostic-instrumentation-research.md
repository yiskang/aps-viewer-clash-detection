# G2 Diagnostic Instrumentation: Research (hypotheses, observables, discriminating power)

- **Status:** research artifact for the package authorized by `docs/prompts/for-claude-g2-diagnostic-instrumentation-research-to-ready-package.md` (§5, with §9/§10 skeletons). It is **not** a procedure amendment, acceptance-contract change, settle rule, T4/C6/C8 change, production or acceptance dependency, or live-diagnostic authorization. No Viewer, browser, network-to-Viewer, live G2, retry, new authorization record, attempt reset, or commit is part of this artifact.
- **Baseline:** repo `aps-viewer-clash-detection`, branch `main`, HEAD `06980ee1e17b1268d4028ed9951c5f8462016cd2`. Harness `test/acceptance/clashpanel-viewerbridge.acceptance.mjs` SHA-256 `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b` (re-hashed for this artifact). D2 tree (`docs/research/2026-10-04-g2-d2-synthetic-transition/`) clean against HEAD.
- **Fixed constraints (restated, not re-decided):** historical G2 = `FAIL (row 3)`; C6 = `NOT_EVIDENCED`; **historical C8 remains unresolved**; real T4 unchanged; D2 support for H2/H5 is **synthetic only**; C6/N2 control is synthetic outcome `E` with no accepted margin; D=30 supports no inference.
- **Companion spec:** [`2026-10-05-g2-diagnostic-instrumentation-spec.md`](2026-10-05-g2-diagnostic-instrumentation-spec.md) (event schema, correlation, fail-closed rules, bounds, sufficiency-experiment design).
- **Working inputs:** research notes [`notes-A1-hypotheses.md`](2026-10-05-g2-diagnostic-instrumentation/notes-A1-hypotheses.md) (A1) and [`notes-A2-observables.md`](2026-10-05-g2-diagnostic-instrumentation/notes-A2-observables.md) (A2). This artifact condenses them; where it is terser, the notes hold the line-level citations.

## 1. Labels and sources

| Label | Meaning |
|---|---|
| **[SRC]** | Pinned Viewer `7.124.2` `viewer3D.js`, decoded SHA-256 `12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e` (`V:<line>`; symbol names are the primary anchor). Re-fetched and re-hashed by A2 into the session scratchpad; never executed; not copied into the repo. |
| **[DOC]** | Official APS Viewer Reference Guide, as reported by D0 (not re-fetched here). |
| **[EVD]** | Retained live evidence `docs/research/evidence/g2-live-20261004-75a3ccb9/` (R1), read-only, cited by JSON path or spy-ledger `seq`. |
| **[HAR]** | Committed harness at `cc8868cd…` (`H:<line>`) or product code. |
| **[SYN]** | D2 synthetic-model result (`d2-summary.json`, output digest `e1d1b815ed351e6feba3e34822ba9895e54035158e685bfbe7f628f6d10bbb06`). Mechanical possibility only; never history. |
| **[INF]** | Inference by this artifact, A1/A2, or D0/D1. |
| **[UNKNOWN]** | Not retained or not determinable. |

Prior artifacts cited as: D0/D1 = `docs/research/2026-10-04-g2-d0-viewer-api-evidence-d1-r1-replay.md`; D2-spec = `docs/research/2026-10-04-g2-d2-synthetic-transition-spec.md`; Plan = `docs/research/2026-10-04-g2-c3-c8-c6-remediation-plan.md`.

## 2. Package question, restated

Which observations would discriminate the hypotheses that D0/D1/D2 left open about the historical C8 (and C6/N2) samples, which of those are public, which are version-bound to 7.124.2, which can be evaluated offline, and what is the smallest safe diagnostic data model? §3–§7 answer the **analytic** part. §8–§10 report the offline prototype's synthetic results.

---

## 3. Remaining hypotheses (prompt §5.1)

Predicates are over **ground-truth** state at `t_d`, the T4 decision instant of subject request `N` (the same sample the frustum oracle evaluates; H:8423-8429, H:8465, H:8489, H:8512 [HAR]). Vocabulary from A1 §0: `subjState(t) ∈ {NONE, PENDING, ACTIVE0, ACTIVE+, COMPLETE, DISCARDED}`; `owner(t) ∈ {N*, T(j)* (j≠N), T(j) (non-terminal), RESTORE, INIT, FOREIGN}`; `pending(t)` = `__destinationView ≠ null`; `active(t)` = `transitionActive`.

| ID | Name | Predicate (at `t_d`) | Source status | Synthetic status | Historical status |
|---|---|---|---|---|---|
| **DH-1** | Pre-motion observation | `subjState ∈ {PENDING, ACTIVE0}` | Gap is source-proven (consumption only inside a tick, step 0 zero-motion) [SRC]; occurrence needs timing [INF] | M-PRE in all 4 cells (CL-primary 1,071 … OP-tail 12,859) [SYN] | Consistent with C6 (home-like sample) [INF]; unproved |
| **DH-2** | Completion → next-consumption gap (one-request lag) | `subjState=PENDING ∧ ¬active ∧ owner=T(N−1)*` (subset of DH-1) | Mechanism source-supported (single slot, held while active, consumed on a later tick) [SRC] | M-GAP in all 4 cells (CL-primary 537) [SYN] | Consistent with N2 and C8 (moderate/partial, D1 §8); ownership unproved [INF] |
| **DH-3a** | Restore, decision on restored pose | restore returned `true` at `t_r < t_d` while `pending ∨ active`, and `owner=RESTORE` | `restoreState(…, true)` does not clear the slot or cancel the transition [SRC] | M-RST (CL-primary 60) [SYN] | Does **not** match N2 (sample not home-like) [INF] |
| **DH-3b** | Restore overridden by a later transition write | restore OK while outstanding, then a `T(j)` write before `t_d` (`owner ∈ {T(j)*, T(j), N*}`) | Final step snaps to destination regardless of restore (S9) [SRC]; intermediate interplay [INF] | Inside F2 `STALE_PRIOR_TERMINAL` (CL-primary F2: 777) [SYN] | Compatible with N2 (reset1) and C8 (reset2) [INF]; restore timing [UNKNOWN] |
| **DH-4** | Quiet / sub-epsilon transition tail | `owner=T(j)` non-terminal, active, deciding samples within 1e-9 | **Not established** by source [SRC][INF] | M-TAIL only in tail cells, only under synthetic τ=1e-10 [SYN] | No retained datum bears on it [UNKNOWN] |
| **DH-5** | Event/request correlation ambiguity (epistemic flag) | >1 assignment {completion → request} is consistent with observations | `CAMERA_TRANSITION_COMPLETED` carries `{type}` only (V:26683-26686) [SRC][DOC] | Assumed away by the D2 oracle [SYN] | **Holds for R1** (4 fits, 3 removal events, `unattributed` registrant, confounded post-P6 removals) [EVD][INF] |
| **DH-6a** | Foreign camera writer | `owner=FOREIGN` | Only autocam steps and `restoreState` are known writers on this path; others not audited [SRC][UNKNOWN] | Not representable in D2 (no foreign writer by construction) [SYN] | No evidence either way [UNKNOWN] |
| **DH-6b** | Camera ownership unidentifiable (epistemic flag) | `owner(t_d)` not identifiable from observations | No Viewer field records the writer [SRC] | n/a | **Holds for every R1 sample** (spy covers `fitToView`/listeners only) [EVD] |
| **DH-7a** | No tick between deciding samples | `ticks(prev, deciding)=0` while subject outstanding | Ticks scheduled independently of rAF and may skip [SRC][INF] | Enabling condition inside M-PRE/M-GAP (dims `S`, `ORD`) [SYN] | [UNKNOWN] |
| **DH-7b** | Settle-start latency | first sample after a latency long vs the outstanding window | [INF] | Dim `G` [SYN] | [UNKNOWN] |
| **DH-7c** | Decision instant not locatable (epistemic flag) | `sampleCount`, timestamps not retained | `sampleCount` computed then dropped (H:8429) [HAR] | n/a | **Holds** [EVD][HAR] |
| **DH-8H / 8P / 8∅** | Harness artifact vs product/fixture vs no own terminal | on `N*`: frames target ∧ `owner≠N*` / `N*` misses target / no `N*` | Product calls documented forms; `present` does not await the transition [HAR] | D2 cannot decide (D2-spec §8.3) [SYN] | **Undecided for C8** (`N*` for A:104 never sampled) [EVD][UNKNOWN] |
| **DH-9** | No-op / ineffective own fit | no request created, or destination within tolerance of call-time pose, or no motion/completion | Those paths exist (`fitBounds` early return, gotoview disabled) [SRC] | Excluded from model (A3) [SYN] | Not excluded for C6/N2/C8; weakened conditionally for C6 by E1 timing [INF] |
| **DH-10** | Pending-slot overwrite (coalescing) | `subjState=DISCARDED` | Single slot, last writer wins [SRC] | Modelled (V4) but subject never discarded in D2 [SYN] | "Not supported" for C6→N2→C8 (D0 T4-8); **open for C8→p2** [INF] |

**Exclusivity (A1 §3).** Exclusive axes: **A** `owner(t_d)` (OWN / PRIOR* / INFLIGHT / RESTORE / INIT / FOREIGN), **B** `subjState(t_d)`, **C** restore history (`none` / OK-while-outstanding / OK-while-idle / NOOP / THROW), **D** terminal outcome (`N*-frames` / `N*-misses` / `no-N*`). DH-2 ⊂ DH-1; DH-3b is compatible with DH-2 (the historical-like N2/C8 shape, if the chain reading holds, is **DH-2 ∧ DH-3b** [INF]); DH-7a/7b are enabling conditions, not alternatives; DH-5/6b/7c are orthogonal epistemic flags, **all set for R1** [EVD]. A diagnostic may claim discrimination only on exclusive axes, and any axis whose flag remains set must be reported `AMBIGUOUS`, not narrated.

**Tensions carried from A1 §4 (unchanged):**
- **T1.** DH-10 scope extends beyond D0 T4-8: for C8→p2 both the "held" reading (E3−E2 = 686.2 ms) and the "C8 overwritten by p2" reading (E3 − p2 call = 552.3 ms, needing a >133.9 ms consumption stall) are time-consistent; neither is regular. Whether C8's own transition ever ran is **open** [EVD][INF].
- **T2.** "Listener removal = fire" is empirically confounded within R1 (post-P6 removals at seq 498/557/573 coincide with non-transition activity), so R1 has no clean issue→completion latency baseline [EVD][INF].
- **T3.** Plan §2.1/§2.2 wording ("H2 Supported", "Fixture: Contradicted", "the Viewer registered its listener") is stronger than D1 §10 (moderate/partial; fixture innocence not established; registrant `unattributed`). **D1 governs** [INF].
- **T4.** D2 M-RST is not the historical N2 shape; the historical-like shape is F2 `STALE_PRIOR_TERMINAL` with an intervening restore. D2 oracle "CURES = 100%" is an idealization, not evidence that any public signal cures anything [SYN][SRC].

---

## 4. Observable matrix (prompt §5.2)

Tier: **PUB** public (documented existence/coarse meaning; fine semantics may be version-bound, marked PUB†) · **VB** version-bound-7.124.2 (undocumented; diagnostic/research-only) · **HAR** harness-tagged (call-site instrumentation; not a Viewer signal) · **SYN** synthetic-only · **NA** unavailable. Safety: **Off** offline research · **Diag** a separately authorized live diagnostic (none authorized) · **P/A** production/acceptance. "guarded" = only behind the VB-0 version guard with fail-closed handling (§6). Full timing caveats and `V:` locators: A2 §3.

| ID | Observable | Source / location | Meaning | Key timing/ownership limits | Req. identity | Tier | Off | Diag | P/A |
|---|---|---|---|---|---|---|---|---|---|
| O-1 | Spy-ledger `fitToView` record | H:6766-6779, H:6886-6900, H:10190-10197 | A call was made, by whom, args, harness time | Records the call, not request creation; `atMs` is harness time; `restoreState`/`getState` not spied | **Yes (harness `callIndex`)** | HAR | Yes | Yes (diagnostic harness variant) | frozen; change owner-only |
| O-2 | `FIT_TO_VIEW_EVENT` / `AGGREGATE_FIT_TO_VIEW_EVENT` | V:36590-36603 | Fit "processed" | Synchronous inside the call; **fires even when no request is created** (gotoview disabled) | content only | PUB† | Yes | Yes | not a request witness |
| O-3 | `fitToView` return | V:29941-29960 | none (`undefined`) | — | none | NA | — | — | — |
| O-4 | Pivot write at issuance via `getState` | V:95825-95826, V:26669 | Non-immediate fit writes pivot at call time | Transient; overwritten by next autocam step; not in T4 sample | none | VB (semantics) | Yes | guarded, weak | No |
| O-5 | `navigation.getRequestTransition()` | V:96747-96750; set V:96698/96727; consumed V:105006-105010 | Pending request present + frozen destination | Poll-only; single slot; writer not recorded; consumption inside a tick | **Slot-write identity by object ref**; request identity only if bound to O-1 by synchronous post-call read | VB | Yes | guarded | No |
| O-6 | `getRequestFitToView` / `getRequestHomeView` | V:104996-105004 | Competing pending whole-model/home request | Can start a transition that holds the slot | none | VB | Yes | guarded | No |
| O-7 | `navigation.getTransitionActive()` | V:96772-96775 | Transition/interaction in progress | **Shared flag** (fit, view-cube, interaction); false while only pending; poll-only | none | VB | Yes | guarded | No |
| O-8 | `TRANSITION_ACTIVE_FLAG_CHANGED` edges | V:95232-95234, V:96760-96764, V:107121-107122, V:107116-107117 | True edge = consumption/step 0 (same tick); false edge = final step, immediately before completion | Exact-instant witness, but shared with view-cube/interaction | none | VB | Yes | guarded | No |
| O-9 | `EventUtils.waitUntilTransitionEnded` | V:14236-14258 | Resolves when `!pending ∧ !active` or on next completion | Not request-correlated; may resolve on prior completion; may hang | none | VB | source fact | not recommended | No |
| O-10 | Autocam progress fields | V:106574-106633, V:107126, V:107155 | Exact animation progress | Highest drift risk; destination only in rAF closure | none | VB | Yes | redundant, not demonstrated | No |
| O-11 | Camera-write instant (wrappers) | V:26657-26673, V:33469-33476 | A real camera write happened | **Invasive** (monkeypatch) | none | VB (invasive) | source fact | only if separately justified | No |
| O-12 | Camera-write owner | — | Ground-truth ownership | No Viewer field; only inferable by bracketing | — | NA (Viewer) / SYN (D2 `cameraOwner`) | D2 | inferable only | No |
| O-13 | `restoreState(home, undefined, true)` return + `VIEWER_STATE_RESTORED_EVENT` | V:27994-28000, V:38243-38300, V:38655-38677; H:11547-11560 | Restore applied pose synchronously | **Not a cancellation/completion witness**; immediate path never touches slot/flag/rAF; not spied | harness call site only | PUB† + HAR | Yes | Yes | return frozen (N2 `RESTORE_FAILED`) |
| O-14 | Restore × in-flight state (composite) | O-5 + O-7 around the restore call, then O-22 samples | Whether restore landed while outstanding and was overwritten | Snap at final step [SRC]; intermediate interplay [INF] (D2 `SYNC`) | harness call site only | VB (state) + PUB (samples) | D2 | guarded | No |
| O-15 | `CAMERA_CHANGE_EVENT` | V:31839, V:32495-32507, V:32370-32372, V:150494 | Camera-updated flag observed this tick | Flag-coalesced, ≤1 per tick, also on resize; live camera ref; zero-motion fire at consumption **likely but unverified** [INF] | none | PUB† | Yes | Yes | No |
| O-16 | `CAMERA_TRANSITION_COMPLETED` | V:13923, V:26683-26686, single call site V:107117 | A `goToView` transition snapped to destination | `{type}` only; not fired for immediate, early-return, view-cube, or (per Autodesk comment V:14249-14250) same-pose; one fire satisfies all listeners | **none** | PUB | Yes | Yes | No (uncorrelated) |
| O-17 | Once-listener removal proxy | H:6777-6778; V:13318-13341 | Indirect proxy for O-16 | Confounded in R1 (T2) | none | HAR | R1 replay | superseded by O-16 listener | No |
| O-18 | `VIEWER_RENDER_TICK` | V:14138, V:17625-17631 | A tick ran (any consumption in it has happened) | Skipped ticks emit nothing | none | PUB | Yes | Yes | No |
| O-19 | `RENDER_PRESENTED_EVENT` / `FINAL_FRAME_RENDERED_CHANGED_EVENT` | V:13883, V:150649, V:13856 | Frame presented / renderer idle edge | No transition meaning | none | PUB | Yes | optional | No |
| O-20 | `MainLoop.frameCounter` / `lastTickFrames` | V:17560, V:17608-17625 | rAF frame index; skipped-tick detection | No public handle established [UNKNOWN] | none | VB [UNKNOWN reachability] | Yes | unconfirmed | No |
| O-21 | Harness rAF sampler | H:11556, H:8411-8432 | Harness frame clock | Order vs autocam rAF in same frame not guaranteed | settle-local | HAR | Yes | diagnostic harness | frozen |
| O-22 | `getCamera()` 32-entry sample | V:27956-27959; H:11550-11555, H:8333-8338 | Rendered pose + projection | Live getter; omits target/pivot/worldUp/pending/active | none | PUB | Yes | Yes | frozen T4 input |
| O-23 | `getState({viewport:true})` | V:27974, V:38040-38077 | Pose incl. target, pivot | Heavier; pivot semantics VB (O-4) | none | PUB | Yes | Yes | not a T4 input |
| O-24 | T4 settle result + per-sample decisions | H:8411-8432, H:8386-8390, H:6556 | Settle decision and settled sample | Per-sample values/timestamps not retained; `sampleCount` not retained in R1 | per settle | HAR | replay | diagnostic harness only | frozen |
| O-25 | Formal completion state | composite O-5/O-7/O-8 (VB), settle (HAR), D2 tagged oracle (SYN) | "Request N's transition is finished" | Composite valid only without foreign slot writer/transition | composite | VB / HAR / SYN | Yes | guarded | No |
| O-26 | Frustum measurement timing | H:8364-8384, H:8512, H:8518, H:8465, H:8489 | C6/N2/C8 verdict input | Measured on the T4-settled sample itself; no re-sample | settle | HAR | Yes | Yes | frozen |
| O-27 | D2 ground-truth tags | D2-spec §5.1-§5.6, §6.2 | Ideal tagged oracle | Never a live observable | — | SYN | Yes | — | — |
| O-28 | Viewer request id / tagged completion / active destination token / write owner / pixels | §2 of A2; V:107155 | — | Invasive patching or not at all | — | NA | — | — | — |
| O-29 | Historical values beyond R1 retention | D0 §11 | — | Cannot be reconstructed | — | NA (historical) | — | — | — |

**Five facts that drive everything below** (A2 §5):
1. The Viewer has **no request identity** anywhere on the navigation path [SRC]. The only per-call identity is **harness-tagged** (O-1).
2. The only exact-instant consumption/start witness is **version-bound** O-8, and it is shared with view-cube and interaction transitions [SRC].
3. Pending-slot ownership requires **version-bound** O-5 bound to O-1 by a synchronous post-call read [SRC][INF].
4. Public signals give tick boundaries (O-18), an uncorrelated end (O-16), and a probable but unverified zero-motion `cameraChanged` at consumption (O-15 [INF]). None carries identity.
5. Frustum timing is fixed by T4: the frustum is evaluated on the deciding sample (O-26 = O-24).

---

## 5. Hypothesis × observable discriminating power (prompt §5.3) — **ANALYTIC (pre-experiment)**

> **This matrix is analytic.** It states what each observation *can* do under the source-derived semantics, before any experiment. It is **not** a measured result. §8 reports the prototype's synthetic results and supersedes this matrix wherever they differ, inside D2's model only; the open-world caveats in §5.3 still apply. In particular, every "RI" that rests on V-EDGE bracketing of a **bound** request (DH-2, DH-3b, DH-5 rows) is subject to the unobservable slot window of spec §6.2 R3: it is identity-bearing only under the assumption that no unobserved writer replaced the slot between the last visible read and the consumption edge.

Codes: **RI** = a stated outcome rules the hypothesis in (for that sample, under the stated condition; never proof of historical causality). **RO** = rules out. **RI/RO** = both, depending on the value. **ND** = cannot distinguish. **(c)** = a candidate-only reading (value match, not identity). **[INF]**-qualified cells depend on unverified fine semantics.

### 5.1 Column key (observation bundles, grouped by tier)

| Col | Bundle | Tier |
|---|---|---|
| **H-call** | O-1 fit/restore call records with harness token and relative time | HAR |
| **H-T4** | O-24 per-sample T4 record (index, decision, relative time) | HAR |
| **P-FRM** | O-21/O-22 per-frame camera sample plus a snapshot synchronously after each harness call ("pre/post-call camera") | PUB + HAR |
| **P-XS** | Exact (bitwise or digest) sample identity, not just 1e-9 tolerance | PUB + HAR |
| **P-TICK** | O-18 `VIEWER_RENDER_TICK` | PUB |
| **P-CC** | O-15 `cameraChanged` | PUB† |
| **P-TC** | O-16 untagged `CAMERA_TRANSITION_COMPLETED` (direct, never-removed listener) | PUB |
| **P-RST** | O-13 restore return + `VIEWER_STATE_RESTORED_EVENT` | PUB† + HAR |
| **V-PEND** | O-5 pending slot (present, ref changed; bound to H-call token if read synchronously after the call) | VB |
| **V-ACT** | O-7 transition-active poll | VB |
| **V-EDGE** | O-8 active-flag edges | VB |
| **V-WRAP** | O-11 write wrappers | VB (invasive) |
| **X-OWN / X-TAG** | O-12/O-27 owner tag, request-tagged completion | SYN only |

### 5.2 Matrix

| Hyp. | H-call + H-T4 | P-FRM (+P-XS) | P-TICK | P-CC | P-TC | P-RST | V-PEND | V-ACT | V-EDGE | V-WRAP | X-OWN/X-TAG |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **DH-1** pre-motion | ND alone; locates `t_d` (resolves DH-7c) | deciding sample = post-call snapshot of N ⇒ RI(c) (cannot separate DH-9); ≠ ⇒ ND (DH-2/3/4/OWNED all differ) | no tick between N's call and `t_d` ⇒ RI (consumption only inside a tick) [SRC; tick-event semantics INF] | ND (zero-motion fire at consumption [INF] could RO) | completion after `t_d` with one request outstanding ⇒ RI(c); >1 outstanding ⇒ ND (DH-5) | ND | slot bound to N present at `t_d` ⇒ RI (PENDING); absent ⇒ RO for PENDING only | ND alone; with V-PEND separates PENDING vs ACTIVE | N's true edge after `t_d` ⇒ RI; N's true+false edges before `t_d` ⇒ RO | ND | RI/RO |
| **DH-2** gap | ND | sample unchanged since the first completion after N's call ⇒ RI(c); ND vs DH-4 without P-XS | ≥1 tick between that completion and `t_d` with N still unconsumed needs V-PEND | ND | completion before `t_d` **and** another after ⇒ RI(c) (order-only attribution) | ND | N pending at `t_d` ⇒ part RI; else RO | `¬active` at `t_d` ⇒ part RI; active ⇒ RO | N−1 false edge before `t_d` ∧ no N true edge before `t_d` ⇒ **RI**; otherwise RO | partial (who wrote last) | RI/RO |
| **DH-3a** restore pose | ND | deciding sample = post-restore snapshot ⇒ RI(c); ≠ ⇒ RO | ND | ND | ND | restore OK required (NOOP/THROW ⇒ RO) | at restore: pending/active ⇒ "while outstanding" | same | no write-bearing edge between restore and `t_d` ⇒ supports | RI/RO (writer) | RI/RO |
| **DH-3b** restore overridden | ND | post-restore snapshot then a change with no harness call while active ⇒ **RI** (writer unattributed) | ND | change after restore ⇒ supports [INF: SYNC timing] | final completion after restore ⇒ RI(c) | restore OK required | outstanding at restore ⇒ precondition | same | edge bracketing attributes the overwrite to request j ⇒ RI | RI | RI/RO |
| **DH-4** tail | ND | P-XS: deciding samples differ by `0 < Δ ≤ 1e-9` ⇒ RI(c); bit-identical ⇒ RO for tail motion | ND | per-tick fires during quiet steps ⇒ supports [INF] | completion after `t_d` with no new request issued ⇒ RI(c) (single-request case) | ND | ND | active at `t_d` ⇒ part RI; inactive ⇒ RO | no false edge before `t_d` for the in-flight request ⇒ RI | RI | RI/RO |
| **DH-5** attribution | — | ND | ND | ND | ND by construction (`{type}` only) | ND | slot binding needed | ND | false edge immediately preceding a completion attributes it to the consumed (bound) request ⇒ resolves | ND | resolves |
| **DH-6a** foreign | ND | change with no known writer bracket ⇒ RI(c) | ND | fire with no known writer ⇒ RI(c) | ND | ND | foreign slot write (ref change with no harness call) ⇒ RI for slot | foreign transition (active with no consumed bound request) ⇒ RI | edges with no bound slot ⇒ RI | **RI/RO** (observed writer) | not representable in D2 |
| **DH-6b** owner unidentifiable | — | inferable only with brackets | — | — | — | — | needed | needed | needed for bracketing | removes | removes |
| **DH-7a** no tick | sample relative times | ND | tick count between deciding samples = 0 ⇒ **RI** | ND | ND | ND | ND | ND | ND | ND | — |
| **DH-7b** latency | call→first-sample latency ⇒ **RI/RO** | — | — | — | — | — | — | — | — | — | — |
| **DH-7c** not locatable | retained `sampleCount` + relative times ⇒ **removes** | — | — | — | — | — | — | — | — | — | — |
| **DH-8H/8P** | needs post-quiescence re-measure + frustum on it | sample after N's own completion and idle frames | ND | ND | quiescence (no outstanding completion) only (c) | ND | slot empty ⇒ quiescence part | inactive ⇒ quiescence part | N's false edge observed ⇒ establishes "after N*" | — | not decidable in D2 (D2-spec §8.3) |
| **DH-9** no-op | ND | ND vs DH-1 (both sample-equal to pre-call) | ND | ND | absence suggestive only (same-pose may not fire) | ND | null immediately after N's call ⇒ **RI** (no request); non-null ⇒ RO for "no request" | ND | no true edge ever for N ⇒ supports | ND | excluded from D2 (A3) |
| **DH-10** overwrite | ND | ND | ND | ND | fewer completions than calls ⇒ suggestive only | ND | N's bound slot ref replaced before any true edge ⇒ **RI** | ND | ND alone | ND | subject never discarded in D2 |

### 5.3 Analytic conclusions (to be tested, not asserted)

- **Public bundles alone never give request identity** (fact 1). Every public "RI" above is either a **value match** (c) or an **order-only attribution**, and both are sound only in a closed universe with no foreign writers, no no-op fits, no same-pose requests and few concurrent requests [INF].
- **V-EDGE + V-PEND (bound to H-call) is the analytic minimum for DH-2 and DH-5 as an identity-bearing statement** [INF], and even then only under the "no unobserved writer" assumption: in 7.124.2 the slot is cleared (V:105009) before the active flag rises (V:107122), and no read observes which object was consumed (spec §6.2 R3). V-ACT is analytically subsumed by V-EDGE when edges are captured without loss [INF].
- **P-TICK + P-FRM are the strongest public candidates** for DH-1 and DH-7a; **P-XS** is the only public route to DH-4 [INF].
- **V-WRAP** (invasive) is the only *observed* (not inferred) owner signal; analytically its added value over bracketing is DH-6a only, which D2 cannot represent [INF].
- **DH-8, DH-9, DH-6a and subject-DH-10 are outside D2.** Any experiment on D2 is therefore **optimistic** for public-only discrimination: it removes exactly the confounders (foreign writers, no-op fits, same-pose requests, coalescing of the subject) that make public observations ambiguous in a live Viewer [INF].
- Whether these analytic expectations hold inside the model, and which subset is minimal, is the job of §8.

---

## 6. Version-bound internals (prompt §5.4)

All rows are **pinned to Viewer 7.124.2** (bundle SHA-256 `12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e`), **diagnostic/research-only**, and **not** proposed as production or acceptance dependencies; any such use would require procedure re-acceptance (prompt §5.4; D2-spec §13.1 policy). This artifact recommends none of them yet; §10 decides only after §8 demonstrates added discriminating value.

| Dep | Exact internal (7.124.2) | Locator [SRC] | Feeds | Presence check | If absent / changed |
|---|---|---|---|---|---|
| **VB-0** | global `LMV_VIEWER_VERSION === "7.124.2"` | V:69861 (`@global`), build flag V:40458 | guard for all VB rows | exact string equality | **every** VB observable disabled for the run; run degrades to PUB+HAR; hypotheses needing VB ⇒ `AMBIGUOUS` (reason `VB_UNAVAILABLE`) |
| **VB-1** | `Navigation.prototype.getRequestTransition` → `__destinationView` (fresh object per `setRequestTransition*` write) | getter V:96747-96750; writes V:96698, V:96727; clears V:96709, V:96738; init V:95294 | V-PEND (O-5, O-14, O-25) | function present; returns `null` or object with `position`/`coi` | pending-slot ownership `UNAVAILABLE`; never inferred from V-ACT (inactive ⇏ not pending) |
| **VB-2** | `Navigation.prototype.getTransitionActive` → `__transitionActive` | V:96772-96775; setter V:96758-96765 | V-ACT (O-7, O-14, O-25) | function present, returns boolean | transition-active `UNAVAILABLE` ⇒ `AMBIGUOUS` |
| **VB-3** | `Navigation.Events.TRANSITION_ACTIVE_FLAG_CHANGED = 'transitionActiveFlagChanged'` on `viewer.navigation` (EventDispatcher) | V:95232-95234, V:97046-97047; fired V:96760-96764 | V-EDGE (O-8, O-25) | **structural** (in `META.vb`): constant equals expected string; `addEventListener` present. **Behavioural** (in `END.pc`): a positive-control fit run **after** the data capture, so it cannot change the starting pose or fit history being diagnosed (or in a disposable Viewer instance); the C6 guard is applied post hoc (spec §6.1.3, revised by re-review R-M4). A failed control counts as absent | consumption/start instant `UNAVAILABLE`; **never** substituted by O-15 or event order. Even when present, VB-3 does not reveal **which** slot object was consumed (spec §6.2 R3) |
| **VB-4** | `getRequestFitToView` / `getRequestHomeView` | V:104996-105004 | O-6 (foreign-transition exclusion) | functions present | foreign-transition exclusion `UNAVAILABLE` ⇒ ownership `AMBIGUOUS` |
| **VB-5** | pivot write at issuance (`fitBounds` `setPivotPoint`) seen via public `getState` | V:95825-95826, V:26669 | O-4 | behavioural only | absent signal, never evidence of non-issuance |
| **VB-6** | `viewer.autocam.{currentlyAnimating, elapsedTime, afAnimateTransition, _shotParams, _deltaTime}` | V:106574-106633, V:107097-107155 | O-10 | fields with expected types; `_shotParams.duration === 1.0` | progress `UNAVAILABLE`; no fallback |
| **VB-7** | wrappers on `autocam.cameraChangedCallback` / `navigation.setView` / `impl.syncCamera` | V:26657-26673, V:33469-33476 | O-11 (invasive) | original function identity captured before wrapping | abort the diagnostic; never partially wrap |
| **VB-8** | `MainLoop.frameCounter` / `lastTickFrames` | V:17560, V:17608-17625 | O-20 | no established public reference [UNKNOWN] | unavailable; use O-18 + harness rAF index |
| **VB-9** | fine **semantics** of public accessors: `cameraChanged` flag-coalescing and zero-motion fire at consumption (O-15); single completion call site (O-16); `FIT_TO_VIEW` firing on no-request fits (O-2); immediate `restoreState` not touching slot/flag/rAF (O-13) | as in §4 | P-CC, P-TC, O-2, P-RST interpretations | not structurally checkable; covered by VB-0 only | use only documented coarse meaning; ordering-based conclusions ⇒ `AMBIGUOUS` |

**Common rule:** a missing or failed VB observable lowers the diagnosability of that question; it is never silently replaced by event order or by an uncorrelated public signal. Partial presence is reported per question, never aggregated into a pass.

---

## 7. Historical evidence mapping (prompt §5.5)

Retained P6 timeline (R1 `spyLedger.records`, `truncated:false`, `droppedRecords:0`) [EVD]: C6 `fitToView` seq 292 @12597.1 (first fit of the run) → L1 add 293 → N2 `fitToView([111],B)` seq 295 @12932.3 → L2 add 296 → two removals 297/298 @13114.4 ("E1") → C8 fit A:104 seq 299 @13282.2 → L3 add 300 @13446.0 (+163.8 ms) → removal 301 @13635.2 ("E2") → p2 A:105 seq 302 @13769.1 → L4 303 → removal 304 @14321.4 ("E3") → `getAggregateIsolation` 306 @14549.7. **Not spied:** `restoreState` (both resets), `getState`, `getCamera`, settle start/end, frustum instant [EVD][HAR]. Settle-return windows from harness ordering (H:10558-10584): C6 in (12597.1, 12932.3) with reset1; N2 in (12932.3, 13282.2) with reset2; C8 in (13282.2, 13769.1); supersession in (13769.1, 14549.7). A narrower M-GAP window holds **only conditionally** on the unproven D0 §5 chain reading [INF].

| Hyp. | Already known | Missing | Cannot be reconstructed | One observation that would have changed it |
|---|---|---|---|---|
| DH-1 | C6 sample home-like/loose (`worstExcess` −0.5407); C6 settled ≤335.2 ms after call, before E1 [EVD][HAR]; E1−C6 call = 517.3 ms weakly favours "C6 consumed" over no-op, conditionally [INF] | pre-call camera; per-sample times; pending/active at `t_d` | home camera (taken by `captureHome`, not retained); C6 consumption instant | **Pre-call camera snapshot** at C6's call compared with C6's deciding sample within 1e-9 (P-FRM) |
| DH-2 | N2 sample ≈ fit(U) to ~1e-8; C8 sample consistent with tight fit of a corner element; E1→E2 520.8 ms ≈ 517.3 ms [EVD][INF] | completion dispatch times paired with sample times; pending/active at `t_d`; B:111 box | B:111/A:135 geometry; `t_d` for N2/C8 | **Never-removed harness completion listener with dispatch times + per-sample times** (P-TC + H-T4); identity-bearing only with V-EDGE + bound V-PEND, and then only under the no-unobserved-writer assumption (spec §6.2 R3) |
| DH-3 | Both `resetHome()` returned `true` (`controls.N2.fields.restored`) — not an effectiveness witness [EVD][SRC]; N2 sample = fit(U), not home ⇒ 3b-compatible, not 3a [INF] | camera after each restore; restore times; autocam resync timing | whether either restore ever showed in a sample | **Camera snapshot immediately after `restoreState` and on following frames** (P-FRM after P-RST) |
| DH-4 | nothing historical; D2 M-TAIL synthetic only; D=30 model-invalid [SYN] | per-sample Δ; active at `t_d` | all intermediate poses | **Per-sample max \|Δ\| with transition-active at `t_d`** (P-XS + V-ACT) |
| DH-5 | 4 fits, 3 removal events; one instant clears two listeners; registrant `unattributed`; post-P6 removals confounded (T2) [EVD] | actual dispatch times; registrant identity; removal reasons | fire counts/times | **One never-removed harness completion listener logging dispatch** (P-TC); attribution still needs V-EDGE + V-PEND and the no-unobserved-writer assumption |
| DH-6 | ledger covers `fitToView`, listeners, isolation, overlays, panel, model calls — not `restoreState`, `setView`, `navigation.*`, `getCamera`; product calls only `fitToView` on this path; no fit before C6 [EVD][HAR] | attribution of every camera write | `owner(t_d)` for all four samples | **Write-attributed camera-change log** (V-WRAP, or P-CC + P-FRM bracketed by calls/edges) |
| DH-7 | `sampleCount` computed then dropped (H:8423-8429); L3 registered 163.8 ms after C8 call [EVD][INF]; frustum evaluated on the deciding sample; target boxes read before the fit [HAR] | sample count, per-sample times, settle start, tick counter | frames per settle; ticks between deciding samples | **Retained `sampleCount` + per-sample relative time + tick count** (H-T4 + P-TICK) |
| DH-8 | C8 used documented per-model form, right model/dbId, no throw; C8 corners equal `c4Table[A:104]`; oracle math reproduces bitwise (rules out oracle math, not product) [EVD] | any sample after N's own completion; quiescent direct-vs-product fit of A:104 | whether A:104's own terminal pose frames A:104 | **Post-quiescence re-measure**: after N's own false edge/completion and idle frames, re-sample and re-run the frozen frustum predicate |
| DH-9/10 | DH-9 not excludable (D1 §8); C6 weakened conditionally; DH-10 open for C8→p2 (T1) [EVD][INF] | pending slot before/after each call | whether C8's request was ever consumed | **`pending ≠ null` (bound) immediately after each fit call and immediately before the next** (V-PEND bound to H-call) |

Every "one observation" above produces **new** evidence in some future, separately authorized run; none can be applied retroactively to R1 (O-29). Historical C8 stays unresolved.

---

## 8. Synthetic sufficiency experiment (results)

> **Every result in this section is synthetic.** It holds only inside D2's closed universe: two requests, no foreign writer, no no-op fit, the subject never discarded, and finite deterministic domains. It is **not historical evidence**. It does not change the procedure, T4, C6/N2 or C8. Historical C8 stays **unresolved**, C6 stays `NOT_EVIDENCED`, and D2's H2/H5 support stays synthetic only.
>
> **Two different kinds of result are reported, and only the second bears on instrumentation.** §8.2–§8.4 measure *information-theoretic separability inside D2* (is the label a function of the projected trace?). That is a closed-world timing-fingerprint result. Its separability fractions are an **closed-world D2 separability (no live bound implied)**, and its minimal sets are a closed-world result that implies **no live instrumentation bound**; neither is a recommendation. §8.5–§8.6 measure what a *sound, rule-based correlator* can actually attribute. Only that second result is used for the minimum diagnostic set (§9).

**Run.** Prototype: [`2026-10-05-g2-diagnostic-instrumentation/`](2026-10-05-g2-diagnostic-instrumentation/), which contains the README and exact commands.

| Output | File SHA-256 | Digest field |
|---|---|---|
| `results/diag-summary.json` | `410c637d79e4d78801dcbb98fa75b3f4ce0c56e9cdc12ce1b684b1c8ccb21d47` | `outputDigestSha256` = `fe42e53e0e12c19fd9c321b7b038998c1fbe09b42ab1f5c556de71d247a52c35` |
| `results/diag-witnesses.json` | `83548e8b37e49ea980e8d1444c970b86b636677480770b76ab0606ddbeaff0d3` | `companionDigestSha256` = `83548e8b37e49ea980e8d1444c970b86b636677480770b76ab0606ddbeaff0d3` |

- Output schema: `diag-summary.json` is `schemaVersion: 3` (adds the bounded `ablation` carrier, spec §7.4); `diag-witnesses.json` stays `schemaVersion: 2`. The digest and summary hash changed from the pre-correction package only because the spec hash is recorded in `inputHashes.thisSpec`; no count or conclusion changed.
- Two runs from fresh empty directories were byte-identical and equal to `results/`. D2 inputs were pinned, and the D2 output digest `e1d1b815…bb06` was verified.
- The conformance gate passed on all 52,308 schedules (852,312 D2 trace rows matched). The transitivity, label-conformance and cap gates all passed. The largest ground-truth trace is 114 events and 5,691 B.
- D=30 was not simulated.

### 8.1 Relevant schedules

| Cell | Total | Relevant (`OWNED` + `STALE_*`) | Excluded (`HARNESS_ABORT`) |
|---|---|---|---|
| CL-primary | 4,104 | 3,240 | 864 |
| CL-tail | 4,788 | 3,780 | 1,008 |
| OP-primary | 18,144 | 14,112 | 4,032 |
| OP-tail | 25,272 | 19,656 | 5,616 |

### 8.2 Information-theoretic distinguishability (spec §8.1, §8.3) — closed-world fingerprint result

**Result.** For **every** named configuration (`T-PUB/OFF`, `T-PUB/ON`, `T-PUB+CC0/*`, `T-VB/*`, `T-VB+OWN/ON`, `T-VB+TAG/ON`, `T-ORACLE/ON`), every cell and all 13 questions:
- distinguishable = relevant (**40,788 / 40,788**), with ambiguous = 0 and `ambiguousBlocks` = 0;
- `blocks` = relevant in every cell, so every relevant schedule's projected trace is unique, even under the public + harness-tagged tier `T-PUB/OFF`.

Two consequences follow:
- `witnessIndex` is **empty** (0 of at most 468) and `diag-witnesses.json` retains 0 traces. No collision witness exists at any named configuration.
- No question is `UNRESOLVED_AT_ORACLE`.

**Why (corrected by remediation M-3).** D2 is deterministic, jitter-free, has two requests and no foreign writer. In that universe a per-frame public stream (the `CAM` camera classes or the `TCK` ticks) reconstitutes the timeline, and event order then determines every label. The harness frame index `f` adds trace **uniqueness** only, not label **separability**. A prototype test (`pipeline.diag-test.mjs`, `f`-ablation; CL-primary, `T-PUB/OFF`, `Q-TUPLE`) measures it: with `f`, 3,240 blocks and 0 mixed; without `f`, 1,968 blocks and still 0 mixed; without `f` and without the camera classes `cl`/`xc`, 1,898 blocks and still 0 mixed. The internal review measured the same pattern in all four cells. Some separability is also **definitional**: `Q-DH7A` is defined as "the T phase was a D2 skip", and `TCK` is emitted iff the T phase was not a skip; `Q-ACTIVE` equals `ac` on the deciding `SMP`. None of this transfers to a live Viewer, where frame timing jitters and foreign, no-op and coalesced activity exists (§5.3, §11).

**Base atoms alone are not enough.** The empty atom set (base `H-CALL` + `H-T4` only) is minimal-sufficient only where a label is constant or trivially determined:
- `Q-DH4` in the primary cells (always `F`);
- `Q-DH3A` in CL-tail.

For every other (cell, question), at least one searchable atom is needed. Concrete base-only collision for `Q-TUPLE` (CL-primary, the lowest-id pair; from the prototype's `pipeline` test, not from `witnessIndex`): `S-00000` (F0, D=1, ORD `HAT`, label `INIT|ACTIVE0|1|NONE`) and `S-00010` (F0, D=1, ORD `TAH`, label `OWN|COMPLETE|0|NONE`).
- Their base projections are byte-identical. They differ only in the intra-frame phase order: the DH-1 vs OWNED distinction.
- Any one of `P-TICK`, `P-FRM`, `P-TC`, `P-CC`, `V-PEND`, `V-ACT` or `V-EDGE` separates them.

### 8.3 Minimal separability sets (spec §8.6; all 512 subsets × both identity axes, no pruning) — closed-world D2 results that imply no live instrumentation bound

- `subsetsEvaluated` = 512 everywhere. `status` = `SUFFICIENT_SETS_FOUND` for all 4 cells × 13 questions × 2 axes.
- `monotonicityViolations` = **0** in every (axis, cell, question).
- **The `ID-OFF` and `ID-ON` minimal-set tables are identical.**

Selected rows (`ID-ON`; `recommended` excludes `P-CC0` by rule, and `recommendedIncludingInf` is identical in every row shown). These are **D2 model-separability sets**: the smallest atom sets whose projected trace fingerprints the label inside D2. They are not instrumentation recommendations (spec §8.6):

| Cell | `Q-TUPLE` separability set | Number of minimal sets | Smallest all-public minimal set | `Q-STALE` separability set |
|---|---|---|---|---|
| CL-primary | `{P-TICK}` | 7 | `{P-TICK}` | `{P-FRM}` |
| CL-tail | `{P-TICK}` | 12 | `{P-TICK}` | `{P-FRM}` |
| OP-primary | `{V-EDGE}` | 12 | `{P-FRM, P-TICK}` | `{P-FRM}` |
| OP-tail | `{P-TICK}` | 11 | `{P-TICK}` | `{P-FRM}` |

- Across the 52 (cell, question) keys, the `recommended` set is a single public atom (`P-TICK`, `P-FRM` or `P-TC`) everywhere except:
  - OP-primary `Q-TUPLE`, where the §8.6 tie-break (fewest atoms first) picks `{V-EDGE}` over the two-atom public set `{P-FRM, P-TICK}`;
  - the three constant/trivial keys above (`Q-DH4` in CL-primary and OP-primary, `Q-DH3A` in CL-tail), where it is `{}`.
- Distribution of `recommended` over the 52 `ID-ON` keys: `{P-TICK}` 24, `{P-FRM}` 22, `{}` 3, `{P-TC}` 2, `{V-EDGE}` 1.
- All 9 searchable atoms occur in at least one minimal set, and none occurs in all of them.

### 8.4 Necessity answers (prompt §8; spec §8.7) — two different questions

The information-theoretic column answers "is the atom needed to fingerprint the label inside D2?" (exhaustive search, 52/52 keys). The sound-correlator column answers "does the sound R1–R8 correlator need it to emit a definite label?" (spec §6.3 C1 table). Only the second is instrumentation guidance (remediation H-1).

| Question | Information-theoretic (52/52 keys; closed-world fingerprint) | Required by the sound correlator (only `Q-OWNER`/`Q-SUBJ`/`Q-ATTR`) |
|---|---|---|
| Is **request identity** (harness-tagged `r`/bound `b`, `ID-ON`) necessary? | `NOT_DEMONSTRATED_IN_D2`: some `ID-OFF` subset is sufficient, because call order implicitly reveals identity in a two-request universe. It is **not** "unnecessary", and it never licenses `ORDER_ONLY` attribution | **Required** for `Q-SUBJ`, for any non-empty `Q-ATTR` and for the `OWN`/`PRIOR_TERMINAL` split. `T-VB/OFF` yields 0 definite `Q-SUBJ`/`Q-ATTR` |
| Is **transition-active** state (`V-ACT` or `V-EDGE`) necessary? | `NOT_NECESSARY_IN_D2`: some minimal set contains neither | **`V-EDGE` required** for every definite `Q-OWNER` once a fit was issued, for `Q-SUBJ` and for attributed completions. `V-ACT` is never read |
| Is **pending-slot identity** (`V-PEND`) necessary? | `NOT_NECESSARY_IN_D2` | **Required** for `Q-SUBJ` and for any token-bearing attribution |
| Is **formal completion** (public `P-TC`) necessary? | `NOT_NECESSARY_IN_D2` | **Required** for `Q-ATTR` |
| Is **camera-write ownership** (`X-OWN`) necessary? | `NOT_NECESSARY_IN_D2` (`X-OWN` is evaluated only as a named bundle; no statement about the atom itself) | Not read (SYN only). But the R3 slot window (spec §6.2) is closed by **no** 7.124.2 observable; without the no-unobserved-writer assumption, terminal and in-flight ownership stay `AMBIGUOUS` (§8.5) |
| Is **request-tagged completion** (`X-TAG`) necessary? | `NOT_NECESSARY_IN_D2` | Not read (SYN only). Without the assumption, every non-empty attribution stays `AMBIGUOUS` (§8.5); only a consumption witness that identifies the consumed object would close it, and none exists in 7.124.2 |

**Fraction of relevant schedules distinguishable with public + harness-tagged observables (no VB):** **40,788 / 40,788** for every question in every cell, under both `T-PUB/OFF` and `T-PUB/ON`. Per cell: CL-primary 3,240 / 3,240, CL-tail 3,780 / 3,780, OP-primary 14,112 / 14,112, OP-tail 19,656 / 19,656. The `T-PUB` tier includes the base harness atoms (`H-CALL`, `H-T4`, the frame index `f`), so it is "public + harness-tagged", not public-only. This is a closed-universe **closed-world D2 separability (no live bound implied)**, produced by timeline reconstruction (§8.2). It is not a demonstration that a public + harness-tagged live diagnostic would attribute anything: the sound fraction for that tier is 0 (§8.5).

### 8.5 Sound attribution: the R1–R8 correlator (spec §6.2, §8.9)

The correlator makes only rule-based, fail-closed attributions; it never fingerprints schedules. The minimum bundle answers **2 of 13 questions under `OPEN` and 3 of 13 under the assumption mode**; only 3 of the 13 have a sound procedure (`Q-OWNER`, `Q-SUBJ`, `Q-ATTR`); no sound procedure is specified for the other 10 (spec §6.3 C1). It was run on every relevant schedule, in four runs (spec §8.9). It produced **0 wrong definite labels** in every run, cell and question (`wrong` = 0; a single wrong label exits 2). Its rules are more conservative than the §6.2 pseudo-code (README "Spec deviations" 1): R5 is applied uniformly, so without `V-EDGE` it never asserts an owner once a fit was issued (every G2 settle follows a fit).

**Exhaustive ablation (remediation M1; spec §8.6).** The same correlator was also run on every relevant schedule in all 2,048 configurations (9 searchable atoms × `ID-ON`/`ID-OFF` × both slot windows); the minimum sufficient diagnostic set in §9 comes from it. It surfaced a soundness defect **outside** the four named runs. In 64 assumption-mode configurations that contain `V-PEND`, `V-EDGE` and `ID-ON` but not `P-TC`, a false edge without an observed `TC` leaves the transition active. Its terminal camera write is then credited as in-flight motion (`S-00001`: `IN_FLIGHT` / `ACTIVE_PLUS` emitted, truth `OWN` / `COMPLETE`). Per spec §8.9 this needed a more conservative correlator rule, never a relaxed check, and it was applied: after a false edge without `P-TC`, `Q-OWNER`/`Q-SUBJ` are `AMBIGUOUS(OBSERVABLE_ABSENT:P-TC)`. It only turns definite labels into ambiguous ones, so the four named runs (all contain `P-TC`) and the §9 minimum are unchanged, and `wrong` = 0 in all 2,048 configurations.

**Slot-window modes (remediation H-2).** In 7.124.2 the slot is cleared (V:105009) before the active flag rises (V:107122), and no read shows which object was consumed. The runs keyed `T-PUB/ON`, `T-VB/OFF` and `T-VB/ON` use the assumption mode (`ASSUME_NO_UNOBSERVED_WRITER`): R3 attributes a consumption to the slot binding of the last visible read. That assumption is true in D2 by construction, and is **not** verifiable in a live Viewer. A Codex advisor pass on this remediation found three further cases that no read covers, now handled the same way: `INIT` needs a capture-start camera read at `f = 0` (`NO_CAPTURE_BASELINE` otherwise); a restore without its own post-call read is never definite under `OPEN`, whatever the later value (`UNREAD_WRITER`); and a true edge after an empty visible slot is DH-6a evidence under `OPEN` and a contradiction only under the assumption. `T-VB/ON@OPEN` uses the same atoms in the fail-closed default mode, which never infers the consumed token. A hand-built unit pair (`correlate.diag-test.mjs`) shows the gap: normal consumption and a foreign overwrite-then-consume give byte-identical `T-VB/ON` projections. The assumption mode labels both as request 1, which is wrong in the foreign world. `OPEN` mode reports both as `AMBIGUOUS(UNOBSERVED_SLOT_WINDOW)`.

Definite labels out of 40,788 relevant schedules (per-cell detail and per-reason counts are in `correlator` in the summary):

| Run | `Q-OWNER` definite / ambiguous / unavailable | `Q-SUBJ` definite / ambiguous / unavailable | `Q-ATTR` definite / ambiguous |
|---|---|---|---|
| `T-PUB/ON` (public + harness-tagged, with identity) | 0 / 40,788 / 0 | 0 / 0 / 40,788 | 0 / 40,788 |
| `T-VB/OFF` (version-bound, no harness identity) | 3,193 / 18,216 / 19,379, of which 585 (`INIT`) rely on the assumption | 0 / 0 / 40,788 | 0 / 40,788 |
| `T-VB/ON`, assumption mode (D2-true assumption) | **35,725** / 5,063 / 0, of which 33,117 rely on the assumption | **35,725** / 5,063 / 0, of which 17,790 rely on the assumption | **40,788** / 0, all relying on the assumption |
| **`T-VB/ON@OPEN`** (fail-closed; no writer assumption) | **2,608** / 38,180 / 0 | **17,935** / 22,853 / 0 | **0** / 40,788 |

- **Residual of the assumption-mode run (remediation M-1, M-2).** The 5,063 `T-VB/ON` `Q-OWNER` ambiguities (and the same 5,063 `Q-SUBJ` ambiguities) all have reason `ACTIVE_WITHOUT_VISIBLE_STEP`, and every one is ground-truth subject state `ACTIVE0`: the pre-motion hypothesis **DH-1** (the C6-type shape; R5 deliberately does not separate ACTIVE0 from an unobserved zero-change step). Ambiguous / relevant by cell: CL-primary **454** / 3,240; CL-tail **213** / 3,780; OP-primary **2,310** / 14,112; OP-tail **2,086** / 19,656 (sum 5,063, 12.4 % of relevant). The internal review recomputed their ground-truth owners: INIT 494, PRIOR_TERMINAL 3,019, RESTORE 1,550. The definite counts are CL-primary 2,786, CL-tail 3,567, OP-primary 11,802, OP-tail 17,570 (sum 35,725).
- **`OPEN` mode.** The 2,608 definite owners are all `RESTORE` (restore with its own post-call read, and no transition active, from edges). `INIT` is never asserted offline, because D2 projections begin with a harness call rather than a capture-start camera read (585 `NO_CAPTURE_BASELINE`; spec §6.2 R3). The 17,935 definite `Q-SUBJ` labels are all `PENDING` (the subject's bound slot object is visible at `t_d`). Every other owner, every `ACTIVE_PLUS`/`COMPLETE` subject state, and every completion attribution is `AMBIGUOUS` with reason `UNOBSERVED_SLOT_WINDOW` (35,551 owners, 22,853 subject states, 40,788 attributions); the remaining 2,044 owner ambiguities are `ACTIVE_WITHOUT_VISIBLE_STEP`. A camera write that leaves the 32-entry value unchanged stays invisible in either mode (R5).
- Under `T-PUB/ON`, ownership is never asserted (no positive evidence that no transition is active), the subject's pending/active/complete state is unavailable, and every completion is unattributed (DH-5 stays set).
- The **gap** between §8.2 (100 % separable with public + harness-tagged atoms) and this table (0 % sound attribution for that tier; 0 % sound completion attribution even with VB unless the slot-window assumption is accepted) is the experiment's main finding. It is a finding, not a defect (spec §8.9).

### 8.6 What the experiment does and does not show

- **Shows:** inside D2, information-theoretic separability does not need any version-bound atom, because D2's closed, deterministic timeline is reconstructible from public per-frame streams. A sound, non-fingerprinting procedure is a different matter:
  - with harness tokens (`ID-ON`) + `V-PEND` (VB-1) + `V-EDGE` (VB-3), it soundly reads `RESTORE` ownership (`INIT` too, given a capture-start camera read) and the subject's `PENDING` state without any writer assumption (`OPEN` run);
  - completion attribution (DH-5), terminal/in-flight ownership and the subject's `ACTIVE_PLUS`/`COMPLETE` state additionally need the "no unobserved writer" assumption, which is sound **within D2** only;
  - harness identity is required by the correlator's rules (`T-VB/OFF` yields 0 `Q-SUBJ`/`Q-ATTR`), and `V-ACT` (VB-2) is never read.
- **Does not show:** anything about historical R1 samples, C8 causality, a live Viewer's timing, foreign writers (DH-6a, including the slot-window case), no-op fits (DH-9), subject discard (DH-10), or DH-8. Those remain outside D2 (`interpretationLimits`). It also shows nothing sound about the 10 questions the correlator does not evaluate.

---

## 9. Minimal instrumentation set (from §8; synthetic, D2-only)

| Category | Content | Basis |
|---|---|---|
| **Minimum sufficient diagnostic set: proven minimum** (prompt §9: the smallest footprint that can *actually distinguish* the target hypotheses; spec §8.6 exhaustive ablation) | Base (`H-CALL`, `H-T4`) + harness identity (`ID-ON`) + `P-FRM`, `P-TC` + **`V-PEND` (VB-1)** + **`V-EDGE` (VB-3)**, guarded by VB-0 and the VB-3 post-capture positive control. **How it was found:** the sound correlator was run on all 40,788 relevant schedules for every one of the 2,048 configurations (9 searchable atoms × `ID-ON`/`ID-OFF` × both slot windows), with no pruning. The target is the full-configuration definite counts in **both** windows with 0 wrong labels. This set is the **unique** minimum and the only minimal set; exactly its 32 supersets satisfy, and there are 0 monotonicity violations. **Every element is necessary.** Without `P-FRM`, `OPEN` `Q-OWNER` drops 2,608 → 0. Without `P-TC`, assumption-mode `Q-ATTR` drops 40,788 → 0. Without `V-PEND` or `ID-ON`, `Q-SUBJ` drops to 0. Without `V-EDGE`, every definite label is lost. **`P-XS`, which the earlier candidate bundle included, is redundant:** removing it changes no count, and with the minimum present it changes no verdict on any schedule. It can stand in for `P-FRM` only under the assumption-mode-only objective, where it loses the 2,608 `OPEN` `RESTORE` owners. **Coverage (only 3 of 13 questions have a sound procedure):** **without a writer assumption (`OPEN`), 2 of 13 are answered:** `RESTORE` ownership (2,608 / 40,788 in D2; `INIT` also needs a capture-start camera read) and subject `PENDING` (17,935 / 40,788). `Q-ATTR` has 0 definite labels in every configuration. **With the unverifiable no-unobserved-writer assumption, 3 of 13 are answered:** 35,725 / 35,725 / 40,788 in D2, so only `Q-ATTR` fully. The residual 5,063 are all DH-1 `ACTIVE0` (`ACTIVE_WITHOUT_VISIBLE_STEP`). The other 10 questions have no sound procedure (spec §6.3 C1: `UNDIAGNOSABLE(NO_SOUND_PROCEDURE)`); they are procedure-limited, not atom-limited | §8.5, spec §6.3 C1, spec §8.6 (`ablation`) |
| D2 model separability (closed-world fingerprint; a closed-world D2 result that implies no live instrumentation bound, **not** a recommendation) | `Q-TUPLE`, `ID-ON`: CL-primary, CL-tail and OP-tail `{P-TICK}`; OP-primary `{V-EDGE}` by tie-break, or `{P-FRM, P-TICK}` all-public. Union over all 13 questions and 4 cells, public + harness-tagged: base + `{P-FRM, P-TICK}` | §8.3 |
| Nice-to-have | Outside the minimum: `P-TICK` (DH-7a tick count; the strongest single public atom for D2 separability), `P-CC` (supporting only), `V-ACT` (poll cross-check of `V-EDGE`; never read by the correlator). By the spec §8.6 separability definition, every one of the 9 searchable atoms is nice-to-have (each occurs in some but not all minimal sets) | §8.3, §8.5 |
| Redundant | **For the sound-correlator objective (spec §8.6 ablation):** every atom outside the minimum, namely `P-XS`, `P-TICK`, `P-CC`, `P-CC0` and `V-ACT`. Adding any of them to the minimum changes no definite count. `P-TICK`, `P-CC`, `P-CC0` and `V-ACT` change no verdict in any of the 2,048 configurations. **By the separability definition:** none, because every atom occurs in at least one CL-cell minimal set. The analytic expectation "`V-ACT` redundant given lossless `V-EDGE`" is **not** confirmed information-theoretically (`{V-ACT}` alone is minimal for several questions). It holds only in the sense that the sound correlator never reads `ac`. `P-CC0` stays [INF], unverified and never recommended | §8.3 |
| Unsafe / unnecessary | **Analytic (unchanged):** V-WRAP / O-11 (invasive mutation of Viewer objects; added value only for DH-6a, which D2 cannot represent); O-10 autocam private fields (highest drift; no demonstrated value); O-9 (may hang; composite); O-4 pivot (transient, weak); any VB observable as a production or acceptance dependency (requires procedure re-acceptance). The experiment found no question that needs any of these. Note: closing the R3 slot window would need a consumption witness that identifies the consumed object; 7.124.2 offers none without invasive patching, which stays excluded | analytic + §8 |

---

## 10. Public + harness-tagged vs public + version-bound (from §8; synthetic, D2-only)

### 10.1 Public + harness-tagged diagnostic (PUB + HAR, no VB)
- **Analytic capability only (§5; none of this was evaluated by a sound procedure):**
  - the decision instant and sample count (removes DH-7c);
  - the tick count between deciding samples (DH-7a);
  - call→first-sample latency (DH-7b);
  - value-match candidates for DH-1 and DH-3a/3b;
  - untagged completion count and timing.

  Inside D2 its projected trace even determines every label (§8.2), but that is closed-world timeline reconstruction, not diagnosis.
- **Measured with the sound correlator (`T-PUB/ON`):** 0 definite labels for all three evaluated questions:
  - request identity of any completion (DH-5; `Q-ATTR` 0 / 40,788 definite);
  - camera ownership at `t_d` (`Q-OWNER` 0 / 40,788 definite, because no public signal gives positive evidence that no transition is active);
  - the subject's pending/active/complete state (`Q-SUBJ` unavailable).
- **Analytic only (outside D2):** no-op vs pre-motion (DH-9 vs DH-1), coalescing (DH-10), foreign writer (DH-6a).
- **Separability fraction within D2:** **40,788 / 40,788** for all 13 questions. This is a closed-world D2 result, not a bound on live separability, produced by timeline reconstruction in a closed deterministic universe. It does not transfer to a live Viewer.

### 10.2 Public + version-bound diagnostic
- **Additional ambiguity removed (sound correlator).**
  - **Without any assumption (`T-VB/ON@OPEN`):** `Q-OWNER` rises from 0 to 2,608 / 40,788 (`RESTORE` only; `INIT` needs a capture-start camera read, which D2 projections lack) and `Q-SUBJ` from 0 to 17,935 / 40,788 (`PENDING` only). `Q-ATTR` stays 0: DH-5 is **not** resolved, because the consumed slot object is unobservable (spec §6.2 R3).
  - **Under the no-unobserved-writer assumption (`T-VB/ON`; sound within D2 only):** `Q-ATTR` rises to 40,788 / 40,788 and `Q-OWNER`/`Q-SUBJ` to 35,725 / 40,788 each. The remaining 5,063 are all ground-truth `ACTIVE0` (DH-1) kept `AMBIGUOUS` by R5.
  - Without harness identity (`T-VB/OFF`), only 3,193 `Q-OWNER` labels become definite, and `Q-SUBJ`/`Q-ATTR` stay unavailable or ambiguous.
  - Information-theoretically, VB adds **no** discrimination inside D2 (§8.2–§8.4).
- **Exact 7.124.2 internals that the minimum sufficient diagnostic set uses:**
  - **VB-1** `Navigation.prototype.getRequestTransition` (pending-slot object identity, read synchronously before and after each harness call);
  - **VB-3** `Navigation.Events.TRANSITION_ACTIVE_FLAG_CHANGED` edges on `viewer.navigation`, with a post-capture positive control recorded in `END.pc` and applied post hoc (§6);
  - both guarded by **VB-0** `LMV_VIEWER_VERSION === "7.124.2"`.
  - **VB-2** `getTransitionActive` is not needed by the correlator. VB-4…VB-8 are not used.
- **Failure behaviour if unavailable (fixed; spec §6.3 C6):**
  - The guard fails closed: a `V-*` atom is enabled only if `vg` is exactly 1, its row's structural presence is exactly 1 and, for VB-3, the post-capture positive control (`END.pc`) is exactly 1. Absent, partial or malformed metadata disables the atom.
  - Affected questions report `AMBIGUOUS` (`VB_UNAVAILABLE:<VB-n>`), and the run is reported as public + harness-tagged only. Event order is never substituted.
  - Covered by offline tests (VB-0, VB-1 and VB-3 failure cases, and missing/partial/malformed metadata).
- **Recommendation status.** By this artifact's own rule (a VB internal is recommended only if §8 shows a question ambiguous under every public + harness-tagged subset and resolved by a subset containing it), **no VB internal is recommended on information-theoretic grounds**, because no such question exists in D2. The demonstrated added value of VB-1 + VB-3 is in **sound attribution** (§8.5): without assumption, `RESTORE` (and, with a capture-start read, `INIT`) ownership and subject `PENDING`; with the unverifiable slot-window assumption, also completion attribution and terminal/in-flight ownership. Whether that justifies VB-1/VB-3 in any future, separately authorized live diagnostic, and whether the assumption mode may be used at all, are **owner decisions** (spec §10 items 1, 1a, 2). They remain diagnostic/research-only and are never a production or acceptance dependency.

---

## 11. Interpretation limits

- Nothing here or in §8 proves historical causality. D2 support is synthetic only; R1 cannot be re-observed.
- A "distinguishable" result inside D2 means the hypothesis label is a function of the projected synthetic trace **within D2's closed, two-request, no-foreign-writer, no-no-op universe**, where event order reconstitutes the timeline. Its separability fraction is a closed-world D2 result, not a bound on live separability, its minimal sets imply no live instrumentation bound, and it does not transfer to a live Viewer without a separately authorized diagnostic.
- "Sound" correlator results are sound **within D2**. Only the `OPEN` results are independent of the no-unobserved-writer assumption (an identical-value camera write stays invisible in both modes); the open-world soundness of the assumption mode is a verification gate before any live use.
- The minimum sufficient diagnostic set (§9) answers 2 of 13 questions under `OPEN` (`Q-ATTR` has 0 definite labels in every one of the 2,048 ablation configurations) and 3 of 13 under the assumption mode. The other 10 are procedure-limited. The minimum is a closed-world D2 result: a live diagnostic may need more.
- Version-bound observables remain diagnostic/research-only regardless of any §8 result.
- C8 remains unresolved; C6 remains `NOT_EVIDENCED`; T4 is unchanged; no settle rule is proposed.

## 12. Provenance

Written from A1/A2 notes, D0/D1, D2 spec/README/summary and the harness (read-only). Viewer facts are carried from A2's re-fetched, re-hashed pinned bundle (§1); this artifact did not re-fetch it. No Viewer/browser execution, no network access by this author, no evidence mutation, no commit.
