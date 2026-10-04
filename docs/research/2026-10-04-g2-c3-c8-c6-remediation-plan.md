# G2 C3 / C8 / C6 Bounded Remediation & Investigation Plan

**Status:** PLANNING ONLY. Authorizes nothing. Awaiting independent Work review, then owner decision.
**Authority for this task:** `docs/prompts/for-claude-g2-c3-c8-c6-bounded-remediation-planning-only.md`.
**Baseline (verified 2026-10-04):** `main == origin/main == 6f716bc0d0d2c1b1e61d26fe50b4dbe56266f7e4`; tracked tree clean; harness SHA `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4` and procedure SHA `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75` both re-hashed and unchanged; evidence snapshot `docs/research/evidence/g2-live-20261004-75a3ccb9/` present. Exactly-one live G2 attempt remains closed at **FAIL (row 3)**. No retry, no new authorization record, no attempt reset.

`H` below = `test/acceptance/clashpanel-viewerbridge.acceptance.mjs` (14,176 lines).

**Evidence labels used throughout:** **[CONFIRMED]** = verified from source/evidence by direct citation. **[INFERRED]** = derived by reconstruction from retained numbers; not proven. **[UNVERIFIED]** = not checked. The preserved evidence and the recorded FAIL / NOT_EVIDENCED / BLOCKED dispositions are not reinterpreted by this plan.

---

## 0. Summary

| Check | Disposition (unchanged) | Planning finding |
| --- | --- | --- |
| C3 | FAIL (`repetitions`) | **[CONFIRMED]** harness-oracle defect: compares dispatched intent *values* to *names*. |
| C2 | PASS | **[CONFIRMED]** same defect present but latent (bad branch not exercised). |
| C8 | FAIL (excess ≈ 5.858358 vs ε 1e-4) | Root cause **unproven**. Evidence best fits a stale-camera sample (H2/H5) **[INFERRED]**; H3 contradicted, H1 unsupported, H4 open. |
| C6 | NOT_EVIDENCED (`n2-not-discriminating`) | Fail-closed worked as designed. Likely contaminated by the same one-step camera lag as C8 **[INFERRED]**. Control also lacks self-validation. |
| C20 | BLOCKED (derivative of C8) | No standalone workstream. Shares C8's settle defect for its K0 sample. |

---

## 1. Confirmed findings

### 1.1 C3 — name/value mismatch **[CONFIRMED]**

- `evaluateC3`, H:9151-9157. Faulty lines: H:9155 `showDispatches[0] === 'PANEL_SHOWN'`, H:9156 `hideDispatches[0] === 'PANEL_HIDDEN'`.
- Product constants: `clashpanel/core/intents.js:34` defines the **values** `'panel/shown'` / `'panel/hidden'`; `clashpanel/ui/ClashDockingPanel.js:60` dispatches `{type: INTENT.PANEL_*}`. Harness fake controller records `intent.type` (H:11676), i.e. values.
- R1 C3 record: FAIL, reason `repetitions`; `dispose` and `residue` clauses passed; closeButton record shows `dispatches: ["panel/hidden"]` (value form). R1 does not retain raw per-repetition arrays, so the per-repetition claim is inferred from the closeButton record.
- Intended assertion (procedure line 247, T12): each show/hide repetition emits exactly one visibility intent of the correct kind, no duplicates.
- Why offline tests missed it: `oracles.test.mjs:290,295` build fixtures with the names; `op-refusal.test.mjs:445` and `runner.test.mjs:226` stub `c3` with the names. No test feeds real product values to `evaluateC3`.

### 1.2 C2 sibling — latent identical defect **[CONFIRMED]**

- H:11732 filters `constructionDispatches` with `t !== 'PANEL_SHOWN' && t !== 'PANEL_HIDDEN'`; clause viii (H:9133) requires the result be 0.
- C2 passed live only because construction dispatched nothing (clause vii passed). A benign `panel/shown` during construction would be miscounted as a domain write → false FAIL(viii).

### 1.3 Static audit result for this bug class **[CONFIRMED, partial]**

Only two sites carry the defect: H:9155-9156 and H:11732. Audited clean: C10, C12, C13, N4 (isolation outcome values match `isolation.js:155-174`); C16/C17/C18a (event-name lookups consistent); `SHELL_PUBLIC_KEYS` matches `ClashDockingPanel.js` returned keys. C15's note literal matches `fit.js:10` but is hand-copied (drift risk, not a defect). Harness has no static import of clashpanel constants.
**[UNVERIFIED]:** `sceneOwnershipOracle` internals and deep C4/C6/C8 logic were grepped, not read in full by the C3/C2 audit (C6/C8 were read by their own investigators).

### 1.4 C8 frozen oracle was applied faithfully **[CONFIRMED]**

- Settle: `waitForCameraSettle` H:8411-8432, one sample per rAF, stop when two consecutive samples agree within 1e-9 on all 32 entries (16 view + 16 projection) (H:8386-8390; T4 H:6556). Not tied to the navigation call: never compares against the pre-call camera, ignores transition state and events; an idle camera passes on frame 2 even with a transition pending.
- Frustum: clip = P·V·p, column-major, 8 box corners, excess in NDC with ε=1e-4 relative to clip.w (H:8316-8383; T16 H:6572). Viewport not used.
- Bounds: `getNodeBox`, `clashpanel/viewer/viewerApi.js:61-74`.
- Product fit is fire-and-forget animated `fitToView` (`clashpanel/viewer/fit.js:17-32`; `ViewerBridge.js:206-216`); `present` does not await the camera transition.
- One implementation each of `frustumPredicate` (H:8364), `waitForCameraSettle` (H:8411), `projectToClip` (H:8342). The settle closure is copied verbatim at H:10540 and H:10595; two equivalent rAF helpers at H:11549/H:11569. Nothing diverges.
- Failing geometry from R1: all C8 corners have w=1 (orthographic). Worst corner (-24.503, 46.414, -0.333), clip y = -6.858 (bottom plane); right plane also fails (x ≈ 5.88-5.99); z fine.

### 1.5 C6 fail-closed mechanism worked **[CONFIRMED]**

- `evaluateN2` H:8460-8468: `pred.pass ? 'NOT_DISCRIMINATING' : 'DETECTED_RESTORED'` (H:8467). `evaluateC6` H:8477-8495 returns NOT_EVIDENCED on NOT_DISCRIMINATING (H:8492), BLOCKED on any other non-DETECTED_RESTORED N2 state (H:8493). P6 runner H:10535-10564. N2 NOT_DISCRIMINATING marked partial at H:1557. Offline coverage: oracles test lines 209-228.
- There is **no explicit margin / minimum-separation constant**; only ε.
- C6 positive worst excess −0.5407; N2 worst excess −0.1000 (both pass the union check).
- C6 can cap overall G2 at PARTIAL independently of C3/C8: procedure row 7 (line 460), example X6 (line 488); harness row 7 H:4502-4505.

### 1.6 C20 gating **[CONFIRMED]**

C20 runs only if C8 is PASS (H:7691, 7701-7705; N8 excluded H:9884-9890). C20 takes K0 with the same settle (H:10619-10624), then compares K1-K3 exactly; a stale K0 yields NOT_EVIDENCED/not-evaluable, never FAIL. Retained-table target is A:119 (0.125×0.5×0.5).

### 1.7 Harness SHA binding **[CONFIRMED]**

Any harness edit changes the harness SHA, which is bound in the authorization record `Harness-SHA256` (H:518; check H:695-696), digests/binding (H:707, H:831), journal/commit `harness.sha256` (H:1613), Phase-0 recheck (H:13190-13192) and `pageAgentSha256`. Existing record and attempt evidence bind the old SHA → any future attempt needs a **new record and new attempt id**; preserved evidence stays valid as history. Procedure SHA (`ACCEPTED_PROCEDURE_SHA256`, H:80) is separate.

---

## 2. Hypotheses (unresolved)

### 2.1 C8 hypothesis matrix

Camera reconstruction below is **[INFERRED]**: cameras are orthographic (w=1), so P·V is exactly solvable from the 8 recorded corner/clip pairs (residual ≤ ~1e-15). Assumes a Viewer fit centres on bounds-centre with 0.9 padding **[UNVERIFIED for 7.124.2]**.

| Camera | Reconstructed | Reading |
| --- | --- | --- |
| C6 | centred on world origin, 338×190 ft visible; does not centre the union | looks like home / pre-fit view (home camera not retained) |
| N2 | centred exactly on union centre, exact ±0.9 margin | looks like the end state of C6's aggregate fit, not a B:111 fit |
| C8 | 13.45×7.57 ft visible, x≈−135 / y≈44 end of the union | matches a 0.9-margin fit of a ~0.5×0.5×16.2 ft box at the union's (xmin, ymax, zmax) corner — plausibly B:111 (N2's request), not A:104 |

Each observation looks like the **previous request's** end state (one-step lag). Predicted offset for a stale camera framing an element ~110 ft away: (79.8, −50.9) ft vs observed (79.8, −51.2). Timeline: C6's settle returned ≥186 ms before the first transition-completed event after C6's fit; one event removed both C6 and N2 listeners; for C8 the Viewer registered its listener 164 ms after `fitToView([104])` (~10 idle frames).

| H | Statement | Status | Evidence for / against | Discriminating observation | Minimum new data |
| --- | --- | --- | --- | --- | --- |
| H1 | Product/navigation defect | **Not supported** | Call was per-model form, correct model and dbId 104, did not throw. Cannot be excluded until quiescent direct-vs-product comparison exists. | After full quiescence, product `present` misses A:104 while a harness direct `fitToView` from the same state frames it. | quiescent product-vs-direct camera pair |
| H2 | Settle sampled stale/transient camera | **Supported [INFERRED]** | Cameras track previous request; settle ends on 2 equal idle frames before motion starts; fake runner applies fits synchronously so offline never exercised it. | Camera after the Viewer's own transition-complete differs from the settle-returned camera and frames A:104. | per-frame samples + timestamps, pre-call camera, transition events |
| H3 | Frustum/oracle math defect | **Contradicted** | Fits exact; N2 reproduces the Viewer's exact ±0.9 framing in one frame; aspect 1.778 in all three; excess ≈ 58,584×ε. | Replay R1 matrices through `frustumPredicate` reproduces stored clip values (offline). | none beyond R1 |
| H4 | Fixture cannot satisfy oracle | **Open** | A:104/105/106 identical placeholder-like 1×1×0.667 boxes; a no-op fit looks like a stale sample. | A:104 box + a direct fit of A:104 from quiet home frames it under the same oracle. | A:104 bounds, direct-fit camera |
| H5 | Other async Viewer state (restoreState not effective; fit queued behind active transition) | **Plausible mechanism for H2 [INFERRED]** | harness itself marks restoreState isolation UNVERIFIED-LIVE (H:11533); N2 runs inside C6 with no quiet wait. | Camera read back immediately after `restoreState(…, true)`; fit issued during active transition. | post-reset cameras; transition-active observation |

**Dimensional sanity:** 5.858 is NDC excess on a 2-unit-wide NDC range (≈ 3× the half-extent), consistent with the target lying ~3 half-views away, which a stale ~110 ft-away camera would produce; it is not a tolerance-scale discrepancy.

### 2.2 C6 cause matrix

| Cause | Status | Reason |
| --- | --- | --- |
| Fixture/target selection | Contradicted | Under the C8 camera the union's far corner would have excess ≈ +16, so a correctly observed N2 would discriminate widely |
| Camera/settle state shared with C8 | Supported **[INFERRED]** | same helper, timing fits |
| Expected outcomes too close | Contradicted | expected ≈ −0.1 (C6) vs ≈ +16 (N2) |
| Control design | **Contributing [CONFIRMED]** | N2 never checks its camera actually frames b*; C6 never checks the camera moved or is union-centred (a zoomed-out home view passes) |
| Geometry/scale | Contradicted | not relevant |

One firm consequence (given retained numbers): N2's camera cannot be a correct B:111 fit, because the pair's centres are 263.86 apart while the union half-diagonal is ~132.6.

These conclusions go beyond the independent review's "retained evidence insufficient" statement. They are **claims for Work/owner adjudication**, not settled fact.

---

## 3. Investigation steps (diagnostics)

Nothing here is authorized. Ordered cheapest/safest first.

**D0 — Viewer API evidence (no live run).** Run `aps-viewer-api-evidence-investigation` on Viewer 7.124.2: is `cameraTransitionCompleted` public; does it fire for every `fitToView`, once per request or coalesced; is camera final when it fires; does `restoreState(…, immediate=true)` cancel a pending transition; behaviour of `fitToView` during an active transition; refresh of `matrixWorldInverse`. Gates the choice among settle options in §4.2.

**D1 — Offline replay of R1.** Feed C6's retained matrix through `frustumPredicate`; assert it reproduces stored clip values; lock the C8/N2 reconstructions as regression fixtures. Add a real-matrix fixture beside the identity-rotation `ortho()` fixtures. Settles H3 offline.

**D2 — Synthetic transition camera.** Fake viewer whose camera holds for *d* idle frames, interpolates over *n* frames, fires the completion event, and optionally queues/no-ops a fit. Must reproduce the observed lag against the **current** settle (red test). Replace the synchronous runner fake for settle tests. Score candidate settle rules on a (d, n) grid.

**D3 — Instrumentation-only design (recording, no verdict change).** Retain: per-frame samples with timestamps; pre-call camera; home camera; post-reset cameras; settled camera and full descriptor (position/target/up/projection/FOV or ortho scale/near/far) in every record; boxes for A:104, A:135, B:111; canvas size and DPR; supersession camera s2 even when p1 fails; settle sample count and start/end times (already computed at H:8429, currently dropped); passive harness-owned listeners for transition-complete/camera-change. Must check effect on C19, N1 and spy-ledger accounting before adoption.

**D4 — Separately authorized diagnostic live run (future, not requested here).** (a) C8 alone from a quiet home view; (b) full P6 sequence with tracing; (c) harness direct fit of A:104 and of a control element; (d) camera read-back after `restoreState`; (e) fit issued during active transition. This is an *instrumentation* run, distinct from the closed exactly-one attempt, and would itself need owner authorization and its own record.

**Harness fix vs product investigation:**
- Harness fix justified if the settle returned the pre-call/previous-op camera **and** the camera after the Viewer's transition-complete frames A:104.
- Product investigation justified only if, after full quiescence, the product's fit misses A:104 while a direct fit from the same state frames it.
- Fixture work justified only if a direct fit of A:104 from quiet state does not frame it under the frozen oracle.

---

## 4. Candidate corrections (none authorized)

### 4.1 C3 / C2 (deterministic, minimal)

- **File/section:** H:9151-9157 (C3), H:11732 (C2). Add two harness-local constants `PANEL_SHOWN_VALUE = 'panel/shown'`, `PANEL_HIDDEN_VALUE = 'panel/hidden'` used by both sites.
- **Representation choice:** literal canonical values in the harness (oracle stays independent of the code under test; page-agent bundle cannot import product constants). Drift protection: a **test** (not the harness) imports `INTENT` and asserts equality with the harness constants.
- **Tests:**
  - Switch rep fixtures at `oracles.test.mjs:277-300` to values; add wrong-kind FAIL case; add "old names now rejected" case.
  - Update stubs at `op-refusal.test.mjs:445` and `runner.test.mjs:226`, which encode the bug.
  - **Regression test failing on the old code:** feed `[INTENT.PANEL_SHOWN]` / `[INTENT.PANEL_HIDDEN]` from the real product module into `evaluateC3`, assert PASS.
  - Stronger variant: run real `createPanelShell` with fake controller + fake `DockingPanel`, collect `intent.type` as `g2CreateShellProbe` does, feed `evaluateC3`. **[UNVERIFIED]** whether the probe runs offline.
  - C2: extract the filter into a small pure helper; test with `'panel/shown'` input (must not count as a domain write).
- **Static sibling audit scope (bounded):** all C1–C20 oracle/probe code, only for intent/constant NAME-vs-VALUE (and `Object.keys` vs `Object.values`) confusion. No refactor. Complete the unread `sceneOwnershipOracle`, C4, C6, C8 internals for this class only.
- **Procedure/plan text:** procedure line 247 uses `PANEL_SHOWN`/`PANEL_HIDDEN` as symbolic intent names; line 245 (C2) names no dispatch values; the 2026-10-02 live plan names no C3 literals. **No text change needed; editing the procedure would change its SHA and force further harness edits — avoid.**
- **Consequence:** harness SHA changes → new SHA binding (§1.7).

### 4.2 C8 settle observation (frozen T4 would be revised)

Competing options, **none selected**; each needs the stated evidence:

| Option | Needs | Known weakness |
| --- | --- | --- |
| More consecutive equal frames | bound on idle gap (observed ~10 frames, no known bound) | still a time heuristic |
| Must differ from pre-call camera, then stabilise | each step waits for Viewer idle first | fails on no-op fits; fooled by a stale earlier transition |
| Wait for this call's own transition-complete event, then stabilise | D0 shows event is public, per-request, fires for every fit, camera final on fire | event may be private/coalesced |
| Query transition-active state | a verified public API | none verified |
| Fixed wait | — | time budget not signal; procedure already rejects this for C20 |

Any choice revises frozen T4 and therefore the accepted procedure's behavior; it requires an explicit owner decision and (if T4 text changes) a procedure re-acceptance, with a new procedure SHA. The recorded FAIL stays as recorded.

### 4.3 C6 / N2 control

- **S1** tie each observation to its own request (record pre-call camera; wait for that call's own completion signal then stable frames; require camera moved; wait for no pending move before the next request; missing completion signal / settle timeout → `BLOCKED` (the existing path for any non-`DETECTED_RESTORED` N2 state, H:8493); a valid no-op fit (§4.5) is not a failure; retain before/after cameras, event seq, sample count, timestamps). Shared with C8.
- **S2** N2 self-validation: its settled camera must frame b*'s own box and differ from C6's camera (predicates in §4.5), otherwise the control is invalid. **State mapping is an owner decision (not specified by this plan):** *Option M1* map to the existing `NOT_DISCRIMINATING` state with a new distinguishing reason string (no enum/schema/procedure change; C6 stays `NOT_EVIDENCED`, partial per H:1557); *Option M2* add a new `CONTROL_INVALID` state, which requires updating the accepted procedure control states (~line 419), `CONTROL_ALLOWED_STATES.N2` (H:1504), record schema, `controlDisposition`, `evaluateC6`, rows 4/7/8, worked examples, result validation and tests, and re-acceptance of the full control-state/result-schema/roll-up contract, not only T4/C6/N2/X6. Plan recommends M1 as the smaller change; M2 only if the owner wants the distinction at schema level.
- **S3** explicit margin: N2 excess − C6 excess ≥ ~1 against an expected gap ≈ 16 (constant needs owner approval).
- **S4** stronger C6 check: union centred and tightly framed (not merely contained).
- **S5** ordering/isolation: N2 first or after a confirmed-quiet reset; reduces but does not fix on its own.
- **Fixture changes:** none indicated by evidence.
- **Preferred:** S1 + S2 + S3 (rests on the inferred lag; caveat carried).
- **Offline proof:** check logic and settle gating provable with D2's fake viewer; R1's reconstructed cameras as regression fixture. Viewer behaviour (queueing, `restoreState` cancel, listener ownership) is not provable offline (D0 / D4).
- **Residual risk:** C6/N2/C8 share the P6 settle helper; fixing C8 alone very likely reproduces NOT_EVIDENCED for C6. Even after all fixes C6 may still cap G2 at PARTIAL if S1–S3 are not adopted.
- **Note:** S1–S4 change the meaning of C6/N2 and therefore touch the accepted procedure (T4, C6, N2, X6). This is **a procedure-changing proposal**, not a harness-only fix, and must be surfaced as such.

### 4.4 C20

Derivative. Becomes runnable only when C8 is a trustworthy PASS including the never-evaluated supersession part. Offline preconditions to verify before any retry: K0 sampling uses the corrected settle; target A:119 selection from retained table; sphere radius rule (`markers.js:30-44`); r_px ≥ 2 (needs canvas size, not retained); camera P6b inherits from p2's fit of A:105. Evidence to capture when allowed: K0..K3 cameras, canvas size/DPR, marker projection, screenshots. No separate C20 remediation workstream.

### 4.5 Requirements deferred to the implementation plan (classification: implementation-plan requirement / calibration gate)

These were raised in internal review; they must be fixed *numerically and mechanically* in an implementation plan before any code, not guessed here.

- **Predicates and tolerances** to be defined over named descriptor fields: camera equality/difference (position, target, up, projection type, FOV/ortho scale, near/far, with numeric tolerances); "moved"; "tightly framed" and "centred" for S4; S3 formula, operands, finite-value rules and the owner-approved constant (proposed ≈1 vs expected gap ≈16 is a starting point only). **A valid no-op is allowed:** if the pre-call camera already frames the target, request ownership must be proven by the call's own completion signal or an explicitly defined alternative, not by movement.
- **D3 instrumentation contract:** exact JSON schema; maximum samples per operation and overflow/truncation policy; listener ownership, attribution fields, installation point and teardown; samples are diagnostic and safely truncatable, never verdict-critical; must respect the accepted evidence limits (4 KiB per field; 2 MiB spy-ledger cap, procedure ~line 158) and must not leave listener residue visible to C19/N1; evidence-cap tests required.
- **Placement context:** retain model placement transform / global offset in D3, or justify omission (world-space bounds plus P·V make it unnecessary only if `getNodeBox` is confirmed world-space; currently **[UNVERIFIED]**).
- **Test seams:** the two C3/C2 harness constants (and any pure C2 filter helper) must be exported (or exposed through another explicit seam) so the drift test can import both `INTENT` and the harness; verify the export does not enter the page-agent bundle / `pageAgentSha256` unexpectedly.

**D4 experiment table (to be refined into the implementation plan):**

| Exp | Initial state | Sequence | Records | Discriminates |
| --- | --- | --- | --- | --- |
| E1 | home view, confirmed quiet (no transition-complete event within a bounded window, camera stable) | product `present` of A:104; listeners registered *before* the call; wait for this call's own completion event then stable frames | pre/post cameras, per-frame samples, event seq/timestamps, A:104 bounds, oracle result | H2/H5 vs H1/H4: if settled camera after the event frames A:104 but the current-rule sample did not → H2/H5 |
| E2 | same quiet home view, re-established after E1 | harness direct `fitToView([104], model)` | same | H1 vs H4: direct frames A:104 but product does not → H1; neither frames → H4 |
| E3 | quiet home view | full P6 sequence C6→N2→C8 with tracing, unmodified order | all cameras per step | confirms/refutes one-step lag |
| E4 | after `restoreState(…, true)` | read camera back immediately and after event window | cameras | H5 (reset ineffective) |
| E5 | active transition | issue second fit during first | cameras, events | H5 (queue/coalesce) |

Each experiment: stated repetition count, per-step timeout with BLOCKED on timeout, state re-quiesced before the next. Outcomes with E1 passing but E2/E3 inconsistent remain **ambiguous** and must not be resolved by narrative.

---

## 5. Cross-cutting audit findings

- Name/value class: only C3, C2 sites (§1.3).
- Settle helper reused by C6/N2/C8/C20 (K0): single defect surface; one implementation of frustum/projection helpers (no divergence).
- Hidden shared state: Viewer camera-move state spans C6→N2→C8→C20; `restoreState(…, true)` assumed to isolate but unverified (H:11533); N2 runs inside C6 with no quiet wait.
- Evidence omissions that blocked attribution: N2 and C8 camera matrices; home/pre-call/post-reset cameras; settle sample count & timestamps; individual A:135 / B:111 / A:104 boxes; transition events and listener ownership; canvas size & DPR; s2 camera.
- Not audited (out of scope): anything outside C2/C3/C6/C8/C20 code paths.

---

## 6. Proposed remediation order

| Phase | Content | Authorization |
| --- | --- | --- |
| A0 (read-only investigation, no repo edits) | D0 Viewer API evidence; D1 R1 replay using temporary scratchpad tooling only (outputs are non-retained, not evidence); written D1/D2 fixture/test designs; complete bounded sibling audit | owner OK to run A0 |
| A1 (offline implementation) | add D1 replay fixtures, D2 synthetic transition fake and tests in explicitly named files | separate owner authorization (this is code/test change) |
| B | D3 instrumentation design; choose settle option and C6 control strategy using D0/D2 results | design only |
| C | **Implementation authorization gate** after independent Work review of this plan | owner |
| D | Implement C3/C2 fix (independent, deterministic) + tests; implement C8/C6 changes only after B decisions; offline suites only | owner-authorized implementation |
| E | Independent Work review of remediation; decide whether a diagnostic live (D4) and/or a retry is technically justified | Work + owner |
| F | New HEAD checkpoint commit/push; new authorization record bound to new HEAD/harness SHA; explicit owner authorization for exactly one new attempt | owner |

**Refinement:** D1/D2 in §3 are A0 (design/temporary replay) unless A1 is authorized. C3/C2 can proceed independently of C8/C6 (no dependence on Viewer behaviour) and could be a separate, smaller authorization. C8/C6 changes should not be implemented before D0 resolves the settle-signal question.

---

## 7. Future gates

Two distinct gate sets (a diagnostic run must not be blocked by a gate that only the diagnostic can satisfy):

**7.0 Diagnostic-live gate (D4 only).** Requires: gates 1, 2, 7 (for the code in use), 9, 10 below, plus D0 complete, D3 instrumentation implemented and offline-tested, an explicit owner authorization naming D4, its own attempt/record ID, immutable output location, and an explicit statement that D4 does not reinterpret the closed FAIL. Gates 3, 5 (partially: offline proof only) and 11 do not apply. Open question 6: whether D4 uses the full G2 harness, a separate diagnostic harness, or a manual session with a new evidence schema.

**7.1 Remediation-retry gate (a subsequent complete G2 attempt).** All of the following must hold before anyone may request another live G2 attempt; gate 3 may be satisfied by D4 evidence.

1. C3/C2 name-value defect fixed with the regression test that fails on old code; sibling audit clean.
2. Drift test (INTENT vs harness constants) green.
3. C8 root cause fixed, **or** diagnostic ambiguity materially reduced by D4 evidence and the settle rule revised under an explicit owner decision.
4. C8 evidence now captures the settled camera descriptor, pre-call camera, sample timeline.
5. C6/N2 control proven discriminating offline against D2's lagged-camera fixture, with the invalid-control fail-closed path (per the chosen M1/M2 mapping) tested.
6. C20 preconditions (§4.4) validated offline.
7. All offline suites pass: at minimum the oracle, runner, op-refusal, controls, schema/verdict, binding/authorization/supersession, evidence-cap and full offline suites under `test/acceptance/`; exact commands to be fixed in the implementation plan.
8. Any procedure text change (T4/C6/N2) independently accepted with new procedure SHA.
9. Independent Work review accepts remediation.
10. Clean checkpoint commit/push; new authorization record that **explicitly supersedes** `g2-live-20261004-75a3ccb9` (validator requires exactly one non-superseded candidate; otherwise `candidate-set-ambiguous`), bound to new HEAD, harness SHA and procedure SHA, passing existing candidate-set/supersession tests before any reservation; new attempt id.
11. Explicit owner authorization for exactly one new live attempt.

**No retry is authorized by this document.**

---

## 8. Non-goals

No harness/test/production/Core/Viewer Adapter/Panel/procedure edits; no live run; no new authorization record; no attempt reset; no rewrite of the FAIL result or the immutable evidence; no G3/downstream work; no general harness refactor; no new C20 workstream; no commit/push.

## 9. Open questions for owner / Work

1. Is revising frozen T4 (settle rule) acceptable, given it changes accepted-procedure semantics?
2. Authorize C3/C2 fix as a separate, earlier implementation step?
3. Authorize D0 (API evidence) and D1/D2 offline designs now?
4. Is a diagnostic-only live run (D4) acceptable in principle, distinct from the closed exactly-one attempt (gate set 7.0)?
5. Approve margin constant for S3 (proposed ≥ ~1)? Choose control-invalid mapping M1 vs M2?
6. D4 vehicle: full G2 harness, separate diagnostic harness, or manual session with new evidence schema?
