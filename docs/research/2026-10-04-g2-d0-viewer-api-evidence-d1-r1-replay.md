# G2 D0 Viewer API Evidence + D1 R1 Replay (research only)

- **Date:** 2026-10-04
- **Baseline:** `main == origin/main == ef436d4a5632692fadbddc09fb9aa6410fadc258`; tracked tree clean; harness SHA `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`; procedure SHA `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75` (unchanged); evidence snapshot `docs/research/evidence/g2-live-20261004-75a3ccb9/` — all 10 files re-hashed against `MANIFEST.md`, all match.
- **Authority:** owner prompt `docs/prompts/for-claude-g2-d0-viewer-api-evidence-d1-r1-replay-only.md`. Research only. Historical live verdict remains `FAIL (row 3)`; C8 unresolved; C6 `NOT_EVIDENCED`; T4 unchanged; no retry, no new record, no attempt reset.
- **Status:** corrected per the independent Work review ([independent review](../reviews/2026-10-04-g2-d0-viewer-api-evidence-d1-r1-replay-independent-review.md), 0 Critical / 0 High / 2 Medium / 2 Low) under owner prompt `docs/prompts/for-claude-g2-d0-d1-research-correction-only.md`; see the [first internal review](../reviews/2026-10-04-g2-d0-viewer-api-evidence-d1-r1-replay-internal-review.md) and the [correction internal review](../reviews/2026-10-04-g2-d0-d1-research-correction-internal-review.md). Final-wording correction candidate (per [targeted re-review](../reviews/2026-10-04-g2-d0-d1-corrected-targeted-independent-rereview.md), 0C/0H/1M/2L; see [final-wording internal review](../reviews/2026-10-04-g2-d0-d1-final-wording-correction-internal-review.md)); pending targeted independent Work re-review. Not an implementation plan. Not committed.
- **Headline framing (read first):** exact/bitwise statements in this document apply **only** to the frustum arithmetic on retained finite values. Camera/request alignment is a **moderate/partial one-request-lag pattern; historical causality is unproved**.

Labels used throughout: **[SRC]** read in pinned Viewer 7.124.2 bundle · **[DOC]** official Reference Guide · **[KIT]** Agent Kit formal knowledge · **[HAR]** repo harness/product code · **[EVD]** preserved R1 evidence · **[RECOMPUTED]** arithmetic from preserved values only · **[INF]** inference · **[UNKNOWN]** not retained.

---

## 1. Source and method

- No Viewer source is checked into the repo. The pinned bundle (`wwwroot/index.html:46`, version `7.124.2`, single entry point, resolution `exact`) is **not** checked in; it was fetched once with the `aps-viewer-api-evidence-investigation` skill's `scripts/safe-fetch.mjs` into a non-repo scratch directory (inert bytes, never executed; see §16 for the command and unavailability handling): URL `https://developer.api.autodesk.com/modelderivative/v2/viewers/7.124.2/viewer3D.js`, decoded-bytes SHA-256 `12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e`, retrieved 2026-10-04; digest identical to the Agent Kit's 2026-08-26 provenance (no drift). `V:<line>` refs below are secondary locators into that file; symbol names are the primary anchor.
- Official docs checked 2026-10-04 (rendered via a fetch proxy, cited by original URL): `https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/`, `.../Viewing/Navigation/`, `.../Viewing/` (events). The Reference Guide documents the *current* v7 release; pinned-build behavior is stated only from the 7.124.2 bundle.
- One second opinion (Codex advisor, medium) was taken on the D0 T4 reasoning; its three corrections are already applied in §3.2/§4.
- D1 replay scripts and their output are present in the working tree (uncommitted, untracked) under `docs/research/2026-10-04-g2-d1-replay-scripts/` and read the immutable R1 evidence read-only. Files added/changed by D0/D1 and its correction: this artifact, the replay scripts/output, the internal/independent reviews, and `docs/handoffs/latest.md`; no harness, test, product, procedure, or evidence file is touched.

---

# Part A — D0: Viewer API / source evidence

## 2. Navigation call path used by C6 / N2 / C8

**Product path (C6, C8) [HAR]:** harness P6 (`H:10543-10588`, `H` = `test/acceptance/clashpanel-viewerbridge.acceptance.mjs`) → `ViewerBridge.present` → `fitSides` (`clashpanel/viewer/fit.js:17-44`) → `viewerApi.js:26/32-33` → `viewer.fitToView(ids, model, undefined)` (single model) or `viewer.fitToView([{model,selection}], undefined, undefined)` (aggregate). `present` resolves after `fitSides` returns and **does not await any camera transition**. `immediate` is never passed.

**Harness-direct path (N2) [HAR]:** `resetHome()` = `viewer.restoreState(home, undefined, true)` (`H:11557-11560`) → `viewer.fitToView([pair.b], B())` (`H:10564`, return ignored) → `resetHome()` again.

**Viewer internals reached [SRC]:**

| Step | Symbol (V line) | Effect |
|---|---|---|
| a | `Viewer3D#fitToView` (V:29941-29960) | normalizes selection; delegates to impl; returns `undefined` |
| b | `Viewer3DImpl#fitToView` (V:36544-36610) | `immediate=!!immediate` → `false`; `_fitToView3d`; synchronously dispatches `FIT_TO_VIEW_EVENT` (single-model scene only) and `AGGREGATE_FIT_TO_VIEW_EVENT` |
| c–d | `_fitToView3d` (V:36974-36984) → `Navigation#fitBounds` (V:95794-95823) | reads the **current** position/target, computes the fit, `immediate=false` → `setRequestTransitionWithUp(...)`. Camera untouched synchronously ([KIT] `viewer-camera-and-projection` §A confirms live) |
| e | `setRequestTransitionWithUp` (V:96723-96740) | stores one `__destinationView` — **single slot, last writer wins** |
| f–g | `ToolController#update` (V:101375-101392) → `ViewingUtilities#update` (V:104994-105012) | consumes the pending request **only if `!getTransitionActive()`**; otherwise it stays pending |
| h–i | `transitionView` (V:104744-104763) → `Autocam#goToView` (V:106801-106817) | if `gotoview` disabled: request consumed, **nothing happens, no completion event** |
| j | `Autocam#animateTransition` (V:107080-107156) | step 0 (`elapsedTime=0 ⇒ unitTime=0`) does **not** move the camera; sets `transitionActive=true`; later steps run in `requestAnimationFrame` callbacks over ≈500 ms (`duration=1.0`, `elapsedTime += dt/500`); each step syncs the real camera synchronously (`autocamChange` → `navigation.setView` + `impl.syncCamera`); final step snaps exactly to the destination, clears `transitionActive`, fires `CAMERA_TRANSITION_COMPLETED` (V:26684-26686) |
| k | `MainLoop` (V:17553-17671), `_animLoop` (V:32813-32829) | ticks ≤ once per rAF-counted frame via `setTimeout`/`MessageChannel`; a tick may be skipped (GPU fences / task budget) |

**Answers to the spec's questions:**

| Question | Answer | Basis |
|---|---|---|
| Sync or async in effect? | **Asynchronous** with `immediate` falsy. The call records a pending request; consumption is in a later tick; motion is in later rAF callbacks. | [SRC]+[KIT] |
| Returns before completion? | **Always**, and even before the transition *starts*. Returns `undefined`; no promise/callback. | [SRC]+[DOC] |
| Transition configurable? | `immediate=true` sets the view synchronously, creates no request, and fires **no** `CAMERA_TRANSITION_COMPLETED`. The product never passes it. Duration is internal (not a public parameter). | [SRC]+[HAR] |
| Coalesce / supersede / overlap? | Pending requests **coalesce** (one slot). A request issued during an active transition is **held**, not overlapped; its destination is computed from the intermediate camera at call time. Nothing on this path **cancels** an in-flight transition (`cancelAnimationFrame` only in `Autocam#dtor`, V:106730). | [SRC] |
| Queued to later frames? | Yes (tick, then rAF). | [SRC] |

**`restoreState(state, undefined, true)` (the N2 reset) [SRC]** (V:27994-28000 → V:38243-38300): On the valid-state path used here (a non-null viewer state and a loaded model) the call applies the pose immediately and returns synchronously; in the inspected 7.124.2 path it does **not** clear `__destinationView`, does **not** call `setTransitionActive(false)`, and does **not** cancel the autocam rAF chain. Its boolean is not a conditional-on-everything guarantee: the same function returns `false` when the state is missing or no viewer/model is loaded (V:38243-38253), and exceptions remain possible. For the valid-state path the return value reflects only that the restore code ran to its end; it is **not** a cancellation or completion witness. Whether the in-flight transition then overwrites the restored pose on its next step is a **source-derived inference** (the autocam is re-synced only through its camera-change callback; that interplay was not traced step by step) and was never observed. The harness `RESTORE_FAILED` path (`H:8463`) keys on that boolean, so on the valid-state path it cannot detect an overridden reset. These are implementation details of the pinned build, not public guarantees, and must not be generalized beyond 7.124.2; the Reference Guide does not describe `restoreState` behavior during a transition.

**Docs and silence.** Autodesk's public reference (per the correction review's Codex pass; not re-fetched in this correction) describes `fitToView` with `immediate=false` as producing a short animated transition and documents `CAMERA_TRANSITION_COMPLETED` as an end-of-transition event, so animation and the existence of a completion event are *publicly described*. **Docs are silent on:** whether `fitToView` returns before the request is consumed; request coalescing/holding; behavior of `fitToView` or `restoreState(…, true)` during an active transition; transition duration; whether `CAMERA_TRANSITION_COMPLETED` fires for every fit or for no-op fits.

## 3. Candidate settle / completion signals

| Signal | Status | Guarantees | Does NOT guarantee | Request-correlated? | Discriminates N from N-1? |
|---|---|---|---|---|---|
| `CAMERA_TRANSITION_COMPLETED` (V:13923, fired V:26684) | **Public** [DOC] | Camera getter is final for *that* transition at fire time | No payload; one fire satisfies all listeners; not fired for `immediate=true`, `fitBounds` early return, gotoview-disabled, and (per Autodesk's own comment V:14249-14250) not reliably for same-pose transitions; not tied to render presentation; a held request may start on the next tick | **No** | Only indirectly, with proven pre-call quiescence |
| `CAMERA_CHANGE_EVENT` (V:13805, V:150494) | **Public** | Fires per render tick when the camera changed | Not fired by the request itself; not per autocam step; no end-of-motion meaning | No | No |
| `Navigation#getTransitionActive` / `setTransitionActive` (V:96758-96775) | **Undocumented** (not in Reference Guide; not under `Private`) | True from first step to final step | **False while a request is pending but not yet consumed**; false for `immediate` fits | No | Only combined with `getRequestTransition` + pre-call quiescence |
| `Navigation#getRequestTransition` (V:96747-96750) | **Undocumented** | Non-null exactly while a request is pending | Does not say *which* request (slot overwritten) | No | `pending ∨ active` brackets "transition outstanding" only |
| `Navigation.Events.TRANSITION_ACTIVE_FLAG_CHANGED` (V:95232) | **Undocumented** | Edge on `transitionActive` | No edge for the pending-only phase | No | No |
| `EventUtils.waitUntilTransitionEnded` (V:14236-14258) | **Undocumented** | Resolves if idle, else waits for the *next* completion event | Not request-correlated; no timeout; may wait for a *previous* transition's completion; may hang if the pending request is never consumed | No | No |
| `FIT_TO_VIEW_EVENT` / `AGGREGATE_FIT_TO_VIEW_EVENT` (V:36590-36603) | **Public** [DOC] | Fit request was issued; carries the selection | Fired *before* any camera change; `FIT_TO_VIEW_EVENT` only for single-model scenes | Identifies the request, but is a *start* signal | Identifies N's issue only |
| `RENDER_PRESENTED_EVENT` (V:150649), `FINAL_FRAME_RENDERED_CHANGED_EVENT`, `VIEWER_RENDER_TICK` (V:17631) | **Public** | Frame presented / renderer idle edge / a tick ran | No camera-transition meaning (`VIEWER_RENDER_TICK` is the correct clock for "request consumed yet?") | No | No |
| `fitToView` return / promise | none | — | `fitToView` returns `undefined`; impl boolean is discarded | — | — |
| Autocam internals (`currentlyAnimating`, `afAnimateTransition`, `elapsedTime`, `_shotParams`) | internal/undocumented | exact animation state | highest drift risk | No | No |

**D0 answer to the spec's central question.** In 7.124.2 there is **no public, request-correlated completion signal**. The closest public one is uncorrelated and not guaranteed. Undocumented pending/active observables exist but also carry no request identity and carry version-drift risk. Any future rule would need (a) a quiescence precondition before issuing N, (b) a post-call witness that N's transition started, and (c) a completion witness. **No settle rule is chosen here**; undocumented-API use would need pinned-build contract evidence.

## 4. Current T4 settle rule vs source facts

**Predicate [HAR]** (`waitForCameraSettle` `H:8411-8432`; `TABLE_T.T4` `H:6556`): one `getCamera()` sample per `requestAnimationFrame` after `updateMatrixWorld(true)`; stop when two consecutive samples agree within `1e-9` absolute on 32 entries (16 `matrixWorldInverse` + 16 `projectionMatrix`); 5 s deadline → `timed-out` → BLOCKED. T4 observes **rendered camera pose and projection only**: position, orientation, FOV/ortho scale and aspect affect the two matrices; the **navigation target/pivot distance along the view ray, worldUp metadata, any pending request, and transition ownership are unobserved state** (identical matrices can coexist with different navigation target/pivot). **No** transition state, **no** pre-call camera, **no** request correlation; `sampleCount`/timestamps are computed but not retained in R1.

| # | Concern | Classification |
|---|---|---|
| T4-1 | A zero-motion window exists after every non-immediate fit (request pending; first autocam step moves nothing) | **Source-proven gap** |
| T4-2 | Two consecutive rAF samples can fall in that window, so T4 can settle on the **pre-request** camera | **Plausible inference, strongly source-supported; runtime-unproven.** Needs a timing condition: e.g. the consuming tick runs after the harness's first sampling microtask (existence proof, not a universal claim). Tick skips widen the window. |
| T4-3 | T4 cannot distinguish "at rest because done" from "not started" or "held behind another transition" | **Source-proven gap** |
| T4-4 | T4 false-settling mid-transition | **Plausible, not categorical.** Each non-final step moves when `pos≠dest`, but source does not bound per-step change above `1e-9`; late steps or near-no-op moves could pass. Materially-wrong false settles are most plausibly the pre-consumption window and the instant after a *previous* transition's snap. |
| T4-5 | Stale `matrixWorldInverse` in the sample | **Not supported.** `updateMatrixWorld(true)` recomputes it in 7.124.2 (V:196009-196012); the getter can run ahead of the presented frame by ≤1 tick, not behind. |
| T4-6 | `1e-9` epsilon too loose/tight | **Not supported** (C8 excess ≈5.86 NDC dwarfs any epsilon effect). |
| T4-7 | No request correlation: a camera left at a *previous* transition's end state satisfies T4 for N | **Source-proven gap** |
| T4-8 | Pending-request coalescing explains the observed lag | **Source-proven that it exists; not supported as the observed mechanism** (bridge `isCurrent()` skipped p1 before any fit; for C6→N2→C8 each request was issued after the previous was consumed or held). |

## 5. Static previous-camera / coalescing hypothesis

**Source chain [SRC]:** (1) a request issued while a transition is active is **held**; (2) T4 started after `present` resolves sees a moving camera and cannot settle mid-motion; (3) when the previous transition snaps to its end pose, the held request is consumed only on a later tick and its step 0 is zero-motion, so T4 can read two equal samples of the **previous** request's end state — conditional on the previous autocam callback preceding T4's rAF in that frame (registration-order premise, not guaranteed); (4) if instead no transition is active when N is issued, T4-2 yields the pre-request camera, which equals N-1's end state if N-1 had completed; (5) in the inspected path, `restoreState(home, …, true)` neither clears the pending slot nor cancels the active transition, so it is not shown to break the chain (its effect on a live in-flight transition was not observed). No stale-closure path makes the getter return an old camera; the delay is in request *consumption* and motion *start*, not in the getter.

**Verdict:**
- The mechanism (held request, zero-motion window, no correlation, non-cancelling `restoreState`) is **directly supported by source**.
- "Request N sampled N-1 in the live run" is **plausible but unproven**: source shows a mechanism that *could* produce it, and D1 (below) shows a *consistent but non-causal* pattern. Neither establishes the historical cause.
- Nothing in source **contradicts** it. Source contradicts the stale-`matrixWorldInverse` alternative and makes a materially-wrong mid-transition false settle unlikely but not impossible.

**Event-timing corroboration [EVD]** (R1 spy ledger, phase P6; each `removeEventListener` of a `{once}` `cameraTransitionCompleted` listener marks a fire — V:13318-13341):

| atMs | event |
|---|---|
| 12597.1 | C6 aggregate `fitToView` (listener L1 at 12597.6) |
| 12932.3 | N2 `fitToView([111],B)` (listener L2 at 12932.5) |
| 13114.4 | **one** completion removes L1 and L2 (C6 call + 517.3 ms; N2 call + 182.1 ms) |
| 13282.2 | C8 `fitToView([104],A)` (listener L3 at 13446.0) |
| 13635.2 | completion (E1 + 520.8 ms) |
| 13769.1 | supersession p2 `fitToView([105],A)` (p1 skipped by bridge; L4 at 13771.3) |
| 14321.4 | completion (E2 + 686.2 ms) |

Four fit calls, three **inferred** completion timestamps (a removal of a `{once}` listener is an indirect proxy for a fire: it assumes nothing else — cleanup, timeout, another caller — removed the listener, which cannot be checked because no dispatch or payload was retained); events carry no request identity; the registrant of these once-listeners is `unattributed` (the only in-bundle registrant of that shape is `EventUtils.waitUntilTransitionEnded` V:14254, whose caller is not in this bundle) — **unresolved**. Reading consistent with source [INF], not proven: E1 = C6's transition (≈517 ms ≈ the ≈500 ms source duration); N2 held until E1, ending at E2; C8 held until E2, ending near E3.

---

# Part B — D1: read-only R1 replay

## 6. Reconstructed request sequence

Order from the harness (`H:10535-10590`): C6 `present` (aggregate fit) → settle → N2 `resetHome()` → `fitToView([b*],B)` → settle → `resetHome()` → evaluate N2/C6 → C8 `present` `fitToView([a1],A)` → settle (s) → evaluate p1; p1/p2 issued back to back → settle (s2). Fixture: a\*=A:135, b\*=B:111, a1=A:104, second candidate A:105; pair centre distance 263.857. `atMs` is call time, not sample time.

| # | Check | Target | Op (origin) | seq / atMs | Camera the oracle used | Observed | Previous request | Result |
|---|---|---|---|---|---|---|---|---|
| 1 | C6 positive | A:135 + B:111 (union U) | aggregate `fitToView` (bridge) | 292 / 12597.1 | `cameraK` (32 entries, full) | worstExcess −0.5407, max abs NDC 0.4593, origin-centred, ortho 676×380 | none; prior camera = initial/home, **not retained** | `NOT_EVIDENCED(n2-not-discriminating)` |
| 3 | N2 control | B:111 | `fitToView([111],B)` after `resetHome()` (harness) | 295 / 12932.3 | no matrix; 8 corner clips only | worstExcess −0.1000, max NDC 0.9000, centred on U | #1 | NOT_DISCRIMINATING |
| 6 | C8 positive | A:104 | `fitToView([104],A)` (bridge) | 299 / 13282.2 | no matrix; 8 corner clips of box(104) | worstExcess **+5.8584**, all 8 outside; ortho 26.9×15.1 | #3 | `FAIL(element-outside-frustum)` |
| 8 | C8 supersession | A:105 | `fitToView([105],A)` (bridge) | 302 / 13769.1 | s2 sample **not retained** | **[UNKNOWN]** | #6 | not evaluated |

Other `fitToView` calls (C15, N7, C17) have no usable camera sample. Four fit calls → three inferred completion timestamps (§5).

## 7. Math / oracle recomputation

All from preserved values; no inputs invented.

- **C6:** clip = P·V·p recomputed from preserved `cameraK` and world corners: max |recomputed − preserved| = **0** (bitwise); worstExcess −0.540675686826625 reproduced exactly.
- **C8:** camera not preserved; excess recomputed from the preserved clips: **5.858358023546797**, bitwise equal to the stored value; all 8 `inside` flags false; verdict reproduced. The 8 corners equal `c4Table[A:104].candidateBox == referenceBox` exactly (`[-25.50299, 46.41399, -0.33333, -24.50299, 47.41399, 0.33333]`), so the oracle used the right box.
- **N2:** worstExcess −0.09999997577575592 reproduced bitwise from preserved clips.
- **Camera well-formedness:** `cameraK` rotation orthonormal to ~4e-8; `P[3,7,11,15]=0,0,0,1` (orthographic); aspect 1.77778. All three samples are orthographic (w=1), so each full composite P·V is exactly solvable from the 8 corners (residual ≤1e-15).
- Signed plane distances (NDC, negative = outside): C6 min 0.5407; N2 min 0.1000; C8 right −4.986, bottom −5.858.

**Verdict — math/oracle correctness: exact; no defect** (consistent with the remediation plan's H3 "contradicted"). **Camera-sample correctness is a separate question**, addressed next: the math cannot say whether the sampled camera was the one the request should have produced.

## 8. Previous-request alignment test

Metric (continuous values, **no threshold applied**): the NDC centre and half-extent `h` of a known target box's projection under the sample camera; plus world-space view-centre offset. The 0.9 fill margin is *read from the data* (N2's projection of U has centre (1.6e-8, −4.8e-8), h = 0.9000000), not retrofitted. **Caveat:** this makes the test partly self-referential — the same sample defines the expected fill and is then compared with the framing C6's aggregate request would be expected to produce. The 0.9 value is therefore used only as an observed similarity metric, not as independent proof of request identity; the pinned-source aggregate-fit padding (`computeFit`) was not independently derived here, and doing so is a D2 input. The C6 rejection stands on separate grounds (its max NDC 0.459 is far from any tight fit and its centre is the world origin).

| Sample | vs its own request N | vs N-1 | Classification |
|---|---|---|---|
| **C6** | centre (+0.044,+0.101), h=0.358 (max abs NDC 0.459): not centred, loose fill → **not consistent with the expected successful tight framing for N** (independent of the 0.9 value) | origin-centred, eye distance = visible height (looks like a default/home view); no home camera retained | **Not consistent with a successful tight fit for N; consistent with the pre-request state [INF]; request ownership unresolved (a no-op/ineffective own fit remains possible); N-1 identity = insufficient evidence** |
| **N2** | N's box (B:111): **historical geometry unavailable** (not retained in R1; not reconstructible from memory or current model state). The sample frames the whole 262-unit union U, including **A:135, which N2's call never named** (the N2 call named only B:111, whose historical geometry is unavailable; no field size for a B:111 fit is asserted here) | geometrically matches a 0.9-margin fit of U: centre error ~1e-8, margin error ~3e-8 | **Geometrically consistent with the previous aggregate request's framing (a strong similarity, medium-high confidence).** This is similarity, not request-identity proof. Causal attribution assumes: (a) B:111's bounds are small relative to U (not retained); (b) aggregate `fitToView` frames the union with a 0.9 margin (the facade records this as unpublished/unverified, `viewerApi.js:27-30`; here 0.9 is only an *observed* similarity metric read from this very sample, not an independently derived expectation); (c) a no-op/non-framing outcome of N2 is excluded (it is not — see below). |
| **C8** | camera is 94.8 units from A:104's centre (half-width 13.45); a 0.9 fill of A:104 would be ~100× N2's zoom, observed ≈10× → **not consistent with the expected successful tight framing for N** | U's corner (xmin,ymax,zmax) projects to NDC (5.3e-7, 0.9000001): two independent coincidences ⇒ a 0.9-margin tight fit of a square-footprint box at that corner, a square-footprint element at that corner, B:111 being one candidate whose historical box is **unavailable** | **Not consistent with a successful tight fit for N; consistent with N-1 if the corner element is B:111 [INF]; ownership unresolved (no-op own fit not excluded)**; the element could in principle be A:135 ⇒ strict identity = insufficient evidence. s2 (request 105): no sample = insufficient evidence |

Alternatives checked: **mid-transition capture** (the C8 zoom lies at log-position 0.500 between the N2-sample zoom and the *reconstructed/predicted* fit(104) zoom): that one reconstructed interpolation hypothesis is not supported, because the view centre is 94.8 units off its path. The actual pre-transition start camera was not retained, so mid-transition capture **in general is not excluded**; the 0.5 position is treated as a possible fixture-size coincidence. **A no-op/non-framing fit of A:104** (plan H4) would also leave N2's end state, so a no-op and a lag are **not separable** from R1.

## 9. Lag-pattern classification

Four categories are kept apart:

- **Observed replay fact:** the retained camera samples of C6 and C8 do not align with their own requested framing; the N2 sample frames the whole union U, which N2's call did not name; all arithmetic reproduces exactly.
- **Pattern:** some samples are consistent with prior-request (or pre-request) state: N2 ≈ framing of C6's union (similarity ~1e-8 centre error); C6 looks home-like; C8 is consistent with a tight fit of an unretained element at a U corner.
- **Inference:** a one-request lag is plausible.
- **Unresolved causality:** queueing/serialization, start delay, held request behind an active transition, a no-op/non-framing fit, rAF-vs-tick ordering, fixture/state effects, an ineffective reset, or another mechanism all remain possible.

Classification: **moderate/partial one-request-lag pattern; historical causality unproved.** One link (N2) is a strong geometric similarity; the C6 and C8 links are inference-dependent and are not independent confirmations (each depends on the previous one). Limits: n=3, one run, and the samples are not independent (each lag depends on the prior); only the N2 link is a tight geometric match (still assumption-bearing, see §8); the C6 link needs a non-retained home camera; the C8 link needs the corner element's identity; a pure one-step lag, a serialized transition queue (E1→E2 spacing 520.8 ms vs C6's 517.3 ms hints at one), a start delay longer than the settle window, and a no-op fit are **indistinguishable** in R1.

## 10. C6 / N2 replay

- **Geometric similarity:** the saved N2 camera is geometrically similar to a 0.9-margin framing of the union U (centre error ~1e-8), which is the framing C6's aggregate request would be expected to produce under an expectation that was not independently derived. **Pattern consistency:** this is consistent with, and compatible with, the moderate/partial lag hypothesis, and with N2's non-discrimination (its predicate passes on a camera that already frames U). The saved C6 camera is a loose, home-like view, so positive and control samples are not the same camera. **Not established:** that N2 examined the result of C6's request (historical ownership unproved); that C6 and N2 belong to one stale request sequence (sequence causality unproved); or that the `resetHome()` call before N2 succeeded — only that `restoreState(…, true)` was called and returned `true`, whose effectiveness is unknown (§2, §11).
- C6's own predicate passing (−0.5407) is **vacuous**: a zoomed-out home view also frames the union. It says nothing about whether the aggregate fit worked (the harness never checks that the camera moved).
- Other explanations compatible with the same appearance — an ineffective `resetHome()` (§2 `restoreState` finding; harness marks it UNVERIFIED-LIVE, `H:11533`) or a queued fit — is a *mechanism* that could produce the same appearance, not a different explanation of the data. "Home happens to equal fit(U)" is **untestable** from R1 (no home camera retained); it is unlikely a priori but pair selection and the home view are not independent merely because home was captured first. Fixture and margin causes are **not excluded and not supported** (fixture innocence is not established; see §11).
- **C6's authoritative `NOT_EVIDENCED(n2-not-discriminating)` is unchanged.**

## 11. What preserved evidence cannot prove

1. No per-frame camera samples / timestamps / `sampleCount`. 2. No transition-active state; completion events are not request-tagged and the listener registrant is unattributed. 3. No presented-frame camera (samples are `getCamera()` getters; no screenshots, C20 never ran). 4. No Viewer-internal animation state (start delay, duration, queue). 5. No request-correlated camera identity. 6. No home/pre-call camera, so C6's N-1 claim is untestable and `resetHome()` effectiveness is unmeasured (it returned `true`, which §2 shows is not a cancellation witness). 7. No camera matrices for N2 and C8 (reconstructed from corners, assuming orthographic). 8. No boxes for B:111 and A:135. 9. No C8 s2 camera. 10. No direct A:104 fit from a quiescent state, so a no-op fit (H4) cannot be excluded.

---

# Synthesis

## 12. Fact / inference matrix

| Row | Source fact (D0) | Preserved-evidence fact (D1) | Inference | Confidence | Unresolved gap |
|---|---|---|---|---|---|
| Viewer API returns before final camera presentation | `fitToView` returns `undefined` before the request is even consumed; motion ≈500 ms later in rAF [SRC] | R1: inferred completion timestamps 517/521/686 ms apart (listener-removal proxy) | — | **High** | docs silent; exact start delay unobserved |
| Explicit request-correlated transition-complete signal exists | None. Public event is uncorrelated, non-guaranteed; pending/active APIs undocumented [SRC][DOC] | — | — | **High** | behavior for same-pose fits in 7.124.2 |
| Current T4 can settle on a transient/non-current state | Zero-motion window, no transition input, no correlation (T4-1/3/7) [SRC][HAR] | `sampleCount` not retained | Settling on the pre-request/previous pose is plausible (T4-2) | **Gaps: High. Actual occurrence: Medium** | live rAF-vs-tick ordering |
| *(inference, not a fact)* A one-request camera lag occurred | Mechanism *possible* per source (held request, zero-motion window) | **Fact:** C6/C8 samples do not align with their own requests; N2 sample geometrically matches fit(U) (~1e-8) | **Inference:** a lag chain C6→N2→C8 is plausible and compatible with the samples (ownership and sequence unproved) | **Moderate/partial pattern; causality unproved** (N2 link tight but similarity-only; C6, C8 links inferred; non-independent) | home camera, B:111 box (historical geometry unavailable), per-frame samples; lag vs queue vs start-delay vs no-op not separable |
| Frustum math / oracle is correct | — | C6, N2, C8 worstExcess reproduce bitwise from preserved values; C8 box matches `c4Table` | — | **High** | none for the math; camera-sample correctness is separate |
| Fixture expectation remains viable | — | C8 camera not at A:104; cannot tell if A:104 is unframeable | "fixture cannot be framed" (H4) not excluded, not supported | **Low (unresolved)** | direct fit from a quiescent state |
| C6/N2 share the C8 root cause | Same fit-timing mechanism applies to all three | N2 sample geometrically matches fit(U); C6 sample loose/home-like | *(inference)* a shared stale-camera mechanism is compatible with the samples; unproved | **Medium for N2 (similarity); C6's pass is vacuous** | home camera; reset effectiveness |
| Stale `matrixWorldInverse` is the cause | Not supported (T4-5) [SRC] | Camera data well-formed | — | **High (rejected)** | — |
| `restoreState(home,…,true)` resets a camera mid-transition | In the inspected 7.124.2 valid-state path it does not clear the pending slot or cancel the active transition [SRC]; it returns `false` on missing state/model | `resetHome()` returned `true` (not a cancellation witness) | *(inference)* N2's reset may have been overridden | **Medium** | override never observed; pinned-build only |

## 13. D2 recommendation

**D2 offline synthetic-transition research remains recommended** (and is recommended before any T4/C6 implementation decision); a live diagnostic is eventually required only after D2/offline work and under separate authorization. D2 is needed because the lag cause is unproven and a no-op fit is not excluded. The arithmetic is closed. Do not start D2 here.

- **Unresolved question D2 must answer:** can the frozen T4 predicate, under realistic Viewer scheduling, accept a pose that does not belong to the current request, and which discriminators (pre-call-camera difference, pending/active witness, completion witness) reject it without rejecting a correct fit — including **no-op** fits and fits issued **during an active transition**?
- **What to reproduce:** a deterministic model of the 7.124.2 path: single-slot pending request, consumption gated on `!transitionActive`, zero-motion step 0, ≈500 ms rAF-driven interpolation, final snap + one completion event **for a normal animated completion only** (event emission for immediate, early-return, gotoview-disabled, same-pose/no-op, overwritten-pending, timeout and destruction outcomes must be specified per outcome in the D2 spec, per the signal table in §3), non-cancelling immediate `restoreState` (its effect on the next autocam step was not traced, so the D2 spec must model the uncertain alternatives as separate branches reported separately), and a harness sampler on rAF with the 1e-9 two-sample rule; with the six-plane oracle unchanged.
- **D2 inputs — retained vs synthetic (mandatory wording):** D2 uses retained historical inputs **only where actually present in R1**: the union U's corner set and A:104's box (`c4Table`). **Target geometry that R1 did not retain — B:111's and A:135's boxes, the home/pre-call camera — is synthetic by construction**, chosen openly and never presented as historical. No D2 claim may depend on reconstructing unavailable B:111 geometry from memory or current model state. D2 independently derives the pinned-source aggregate-fit destination/padding rather than borrowing 0.9 from the N2 sample.
- **D2 tests mechanical possibility, not historical causality.** It must not be described as proving historical live causality, the historical B:111 camera/geometry state, acceptance success, or a product defect.
- **Discriminating outcomes:** (i) if scheduling orderings exist where T4 settles on N-1 and reproduce a pattern like R1's ⇒ the lag chain is mechanically *possible* (not shown to have occurred); (ii) if a no-op/non-framing fit of A:104 is also reproduced by the model or required to explain C8 ⇒ H4 stays open; (iii) a result of "no ordering reproduces the pattern" supports **no conclusion** unless the schedule space is source-derived, bounded and exhaustively enumerated; absent that, such an outcome must be reported only as "not found in the explored schedules".
- **Decision gates (what D2 can and cannot authorize):**
  - D2 **may** establish mechanical possibility (does a Viewer-faithful schedule exist that reproduces the R1 pattern?) and the behavior of candidate discriminators (pre-call-camera difference, pending/active witness, completion witness) on correct, no-op, and held fits.
  - D2 **alone may not** establish the live root cause: reproducing R1 under *some* ordering shows the model is sufficient, not that the live page used that ordering. A no-op fit or different browser scheduling would remain open.
  - **T4 design may begin after D2** only as a *candidate design* for owner review; it must not be adopted as a frozen change on D2 alone.
  - **Implementation and procedure re-acceptance require instrumented live evidence** (per-frame samples with timestamps, transition edges, pre-call camera, completion evidence) under separate authorization; "request-tagged completion" is an **instrumentation-derived hypothesis, not a Viewer signal** — its issue IDs, pre-call quiescence rule, pending/active observations, attribution rule, timeout behaviour and treatment of ambiguous events must be specified, and "ambiguous" must be an accepted diagnostic outcome, obtained after D2/offline work. Until then the root cause stays *plausible, not established*.
  - **D2 needs its own, separately authorized specification before any implementation.** It must define: an explicit state machine and transition ordering; scheduler choices bounded and derived from the pinned source (tick/rAF ordering, frame delays, skipped ticks); a complete case matrix (idle, pending, active, held, overwritten, no-op, gotoview-disabled, early-return, restore, timeout); mechanical pass/fail criteria with retained output; and whether exploration is exhaustive. "Realistic scheduling" in this document is a placeholder, not a specification.
  - D2 must also independently derive the pinned-source aggregate-fit destination (padding/bounds), which this research could not do.

## 14. T4 owner-decision input

- **For keeping T4 unchanged now:** the cause is unproven — only a moderate/partial pattern from one run (n=3, non-independent samples); T4's *epsilon* is not shown to be the weak point (§15); no request-correlated, per-frame data exists; any revision changes a frozen procedure element and cannot be validated offline against live Viewer scheduling yet.
- **For revising it:** source-proven gaps T4-1/3/7 are independent of the live run — T4 has no input that could reject a pre-request or previous-request pose.
- **Evidence needed before revision:** D2 reproduction; per-frame samples with timestamps and transition edges from an authorized instrumented run; pinned-build contract evidence for any undocumented witness (`getRequestTransition`/`getTransitionActive`); resolution of the unattributed completion-listener registrant.
- **Procedure re-acceptance:** T4 is a frozen, procedure-accepted parameter (`TABLE_T.T4`, procedure T4 row and C6 settle algorithm); changing the predicate or adding inputs **would require procedure re-acceptance** and a new harness SHA. Recommendation: **gather evidence first**; do not revise T4 yet.

## 15. C6 margin decision input

Descriptive bracket (worstExcess on U, not thresholds): correct fit(U) ≈ **−0.10**; home-like pre-request view ≈ **−0.54**; an inferred correct N2 (single-element fit) ≈ **+16.12** (derived from the C8 camera, so inferred). These are descriptive observations of one run, not a calibration population: the +16.12 relies on an inference, there is one fixture/build/run, and no request-correlated certified camera pair exists. **Current retained evidence cannot justify any numeric margin or minimum-separation constant, and none is selected here. Margin derivation must wait for synthetic/offline transition fixtures (D2) or other independently accepted evidence.**

## 16. Reproducibility appendix

All paths are repo-relative to the repo root unless stated. Nothing here requires network access except the optional Viewer-bundle re-fetch.

**Environment.** Replay: Python 3 standard library only (verified with 3.9.6; no third-party packages). Viewer-source re-fetch (optional): Node.js (verified with v22.23.1) and the `aps-viewer-api-evidence-investigation` skill's `scripts/safe-fetch.mjs` (an external, non-repo helper under the user's Claude skills directory).

**Required preserved inputs (checked in, read-only).** `docs/research/evidence/g2-live-20261004-75a3ccb9/R1-clashpanel-viewerbridge-g2-result.json` (the only file the scripts read; verify against `MANIFEST.md`). The harness `test/acceptance/clashpanel-viewerbridge.acceptance.mjs` (SHA `cc8868cd…ef09b`) is read manually for `H:` line citations. **Harness revisions:** R1 was produced by the attempt-time harness (`471fae40…`, commit `75a3ccb9`); `H:` references in this document are to the current harness (`cc8868cd…`, `ef436d4`). The attempt-time and current files differ only in the C2/C3 intent-value lines; `frustumPredicate`, `waitForCameraSettle`, `evaluateC6/C8/N2` and the P6 runner are identical (compared during D1 via `git show 75a3ccb:test/acceptance/clashpanel-viewerbridge.acceptance.mjs`). Treat current line numbers as navigation aids, not as the exact code that produced R1.

**Replay command (shown from the repository root).**

```
python3 docs/research/2026-10-04-g2-d1-replay-scripts/recompute.py [OUTPUT_FILE]
```

The command above uses a repo-root-relative script path, so it resolves only when launched from the repository root (or another directory containing that relative tree). The scripts themselves are working-directory independent: `load.py` resolves R1 relative to its own file (`../evidence/g2-live-20261004-75a3ccb9/...`) and `recompute.py` resolves its sibling import the same way, so from any other directory invoke them by absolute path, e.g. `python3 <REPO_ROOT>/docs/research/2026-10-04-g2-d1-replay-scripts/recompute.py /tmp/out.txt` (the caller must know `<REPO_ROOT>`). With no argument the output is written to `recompute_out.txt` beside the script; pass an explicit path to write elsewhere (use this when verifying so the committed file is not overwritten). Output is deterministic on the verified environment (macOS, Python 3.9.6; no sets, randomness or timestamps; fixed JSON order). The *output-file hash* is bound to that environment: another OS/runtime may differ in line endings or last-bit math-library results, so the authoritative acceptance is the **value-level** list below, with the file hash as a convenience check. "Bitwise" in this document means the Python float values compare `==` to the stored values (equal as decoded IEEE-754 doubles; signed zero not distinguished). Evidence integrity: `cd docs/research/evidence/g2-live-20261004-75a3ccb9 && shasum -a 256 <each file>` against `MANIFEST.md`.

**Expected output (value-level, authoritative).** Then the output-file SHA-256 `9d39b4d07b585cba63ed0b89e2a2c933460ad97a1b300bf876d86c8f6ffc21a9` (identical when run from a different working directory). Key expected values: C6 max |recomputed − preserved clip| = `0`, C6 worstExcess `-0.540675686826625`; C8 worstExcess `5.858358023546797`, all 8 corners outside; N2 worstExcess `-0.09999997577575592`; N2/C8 affine residual ≲ 1e-15. Script SHA-256: `load.py` `cc41a0c117e46b7c9559acfc45074fe13f8dfd19e4c474902154c2aa2f083b0d`, `recompute.py` `249ebed4fbe50c47c06197f2ac9c485322511e11242ce305ee77771977bfaef1` (changed from the first draft only in path/output handling; the numerical code is unchanged).

**Conventions.** Matrices are column-major as stored by three.js `elements` (JS order); clip = P·V·[p,1]; `excess = max(|x|,|y|,z,−z)/w − 1`; inside iff `w>0` and all components ≤ `w·(1+1e-4)` (`frustumPredicate` `H:8364`). N2/C8 orthographic composites are solved from the 8 corner/clip pairs, assuming `w=1`.

**Viewer source/API references — what is external vs checked in.** *Checked in:* none of the Viewer bundle. *External, fetched once:* `https://developer.api.autodesk.com/modelderivative/v2/viewers/7.124.2/viewer3D.js` (pinned by `wwwroot/index.html:46`). To reacquire:

```
node <skills-dir>/aps-viewer-api-evidence-investigation/scripts/safe-fetch.mjs \
  https://developer.api.autodesk.com/modelderivative/v2/viewers/7.124.2/viewer3D.js --out-dir <non-repo-scratch-dir>
```

Verify the decoded-bytes SHA-256 equals `12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e` before trusting any `V:<line>` reference; the helper refuses output directories under `knowledge`, `patterns`, or `.git`, so use a scratch directory outside the repo. **Locate behavior by symbol, not line:** `Viewer3D.prototype.fitToView`, `Viewer3D.prototype.restoreState`, `ViewerState.restoreState`, `Navigation#fitBounds`, `Navigation.prototype.setRequestTransitionWithUp`, `ViewingUtilities#update`, `Autocam#animateTransition`, `Navigation#setTransitionActive`, `Autocam#cameraChangedCallback`. **If the source is unavailable** (network/origin blocked, or the digest differs): treat every D0 `[SRC]` statement as *unverified for this checkout*, do not rely on `V:` lines, relocate by symbol if the digest differs, and otherwise limit conclusions to the repo-checked statements ([HAR], [EVD], [RECOMPUTED]); the Agent Kit's `knowledge/viewer-frame-loop.md` and `knowledge/viewer-camera-and-projection.md` ([KIT]) are secondary corroboration for the same pinned build. Pinned-source availability (the external helper plus network access) is a formal prerequisite for any D2 source-derived fit calculation. Official documentation was read via a rendering proxy for the SPA Reference Guide and cited by original URL; no network-fetch automation is added.

**Evidence immutability.** The scripts only read R1; the 10 evidence files were re-hashed against `MANIFEST.md` before and after this correction.

## 17. Non-goals

No C8/C6/N2/T4 change; no settle-rule choice; no synthetic-transition implementation; no diagnostic or acceptance live run; no new authorization record; no attempt reset; no harness/test/production/procedure edit; no G3/downstream work; no implementation plan; no commit or push.
