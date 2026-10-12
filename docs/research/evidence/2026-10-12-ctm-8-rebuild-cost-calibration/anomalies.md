# CTM-8 anomalies and deviations (observations only; nothing here is a limit, budget or verdict)

## Headless
1. **Launch-to-launch level shift (unexplained).** For many Family M cells launch 0 medians sit well below launches 1 and 2 (e.g. M-BASE/1000/1: 13.05 / 23.20 / 22.41 ms; M-BASE/5000/1: 317 / 330 / 549 ms; M-REC/10000/2: 731 / 1208 / 1175 ms), while within a launch spreads are small. Some cells show the opposite grouping (M-BASE/5000/2: 315 / 553 / 543). Cause not determined. The machine was not otherwise controlled: power source, other heavy processes and thermal state were not recorded (`environment.json` nulls). During launch 0 light unrelated work (a support-tool agent running a small test file) overlapped; launches 1 and 2 had no deliberate concurrent work. Per-launch medians are therefore reported separately and headline cells carry the spread of launch medians. No explanation is asserted.
2. **Isolated per-launch median jumps in R-GROUP-WARM** (R-GROUP-WARM/1000/2 launch 1: 1.44 ms vs ~0.4 ms; /1000/3 launch 2: 1.61 ms; /10000/3 max 20 ms). Retained, not excluded; paired deltas for those cells are labelled indistinguishable.
3. **R-COLD transition log.** In the headless runs the provisional cold pass (`filtered === 0`, `'empty-filtered'`) was generally not observed as a separate notification (coalesced); recorded, not an error (§7.4). The index-commit sub-phase stays UNAVAILABLE.
4. **Family M "no subscriber during build" nuance.** `createTestsManager` itself subscribes to the editor controller during Step 0 (editor-sync); no calibration/external subscriber exists during Steps 0–3 and the manager has zero subscribers until Step 3b. Tests assert exactly this.
5. **Manager ViewModel has no public `version` field**, so the §7.2 `getViewModel().version` covariate is not recorded for Family M (notification count and yieldDelta are).
6. **`notif_after_window` for M-BASE** includes the reset's own `fire()`; `notif_during_drain` and `drain_rounds` are recorded separately.
7. **R-GROUP-WARM `memberIndexes`** is not public; identical membership is proven via `selected.clashCount === 10`, `participants === 11` and an unchanged `presentGroup` call count before/after every sample.
8. **Tree state at measurement:** `repoTreeState: dirty` (protocol/handoff docs, prompts, reviews and the new `test/calibration/` support code were uncommitted; no production file differed from `ac5bcb4`).
9. No TIMEOUT, INVALID, INVALID_SETUP, SETUP_TIMEOUT, ABORTED, UNAVAILABLE or GLOBAL_FAILURE occurred in any of the 252 cell executions; the largest Family M setup (N = 10,000) completed inside the 120 s bound.

## Process / support code
10. Three Codex reviews (Family M, Family R, cell runner; medium effort) found real defects before any evidence run (timed-out operations kept running; partial-setup leaks; timeout not bounding the triggering call; swallowed teardown/dispose failures; reset failure erasing timeout evidence; unvalidated `kind`). All were fixed and re-tested before the campaign; the campaign was run on the fixed code.
11. A port conflict (8099 held by an unrelated service) and the project hook limiting the browser to `http://localhost:8080/` delayed headed execution; resolved by serving the app on 8080.

## Headed
12. **HM-REC UNAVAILABLE (all 6 Family M points).** §9.3's predicate needs the manager ViewModel (`manager.tests[k]`, `manager.count`) and the manager-list DOM; in editor view the instrumentation route (`_host.panel.controller`) exposes only the editor facade and the manager list is cleared. Executing it would require a private-state read or a seam; an agent-built substitute predicate was deliberately **not** adopted. Owner ruling required (see `headed/blockers.md`).
13. **HV-2 (Focus) not met as written at all 9 points:** the camera after Focus equals the camera before it because HV-1's group selection had already fitted the camera. Correctness-only check; recorded as observed.
14. **Sentinel pairs reused across result sets** (not within one) and C(T1) == C(T2) at two points; warm predicate still distinguishes by filter text.
15. **One internal read-only Viewer property (`viewer.impl.overlayScenes`)** used for HV-1's overlay-scene check (same as the CTM-7 helper).
16. **Addendum B L1 flash** observed in all 27 cold samples (≈1.3–10 ms of provisional "No clashes match"); observation only.
17. **Configured `maxResultsPerRun`** is source-derived (100,000 default), not observable via the public ViewModel.
18. 5,000 / 10,000 headed targets NOT REACHABLE HEADED (largest naturally produced sets: 4,770 / 2,277 / 3,488 for 1 / 2 / 3 models). Headed n2-high cold count was corrected once from its own logged notifications (documented in `headed/README.md`).
