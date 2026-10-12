# CTM-8 headed corroboration — evidence (CTM8-P0-v4 §9, §10, §13)

Headed results **corroborate** the headless campaign; they do not replace it (§9). This directory holds observations only. It sets no limit, budget or pass/fail threshold, and it claims no equivalence with the headless numbers.

## What was run

- **Environment:** headed Chromium via Playwright MCP at 1600×1000, APS Viewer 7.124.2, and the three real SVF2/OTG Audubon models (Architecture, Structure, Mechanical) loaded together in one session (`environment-headed.json`). App: `node server.js` on :8080, started by the parent.
- **Instrumentation:** `test/calibration/ctm8/headed/instrument.js`, runtime-injected and read-only.
  - **Start (t0):** a capture-phase `change`/`input` listener timestamp.
  - **Completion (tD):** the semantic ∧ DOM predicate first holding, confirmed by a 250 ms quiet window on `section[data-region="results"]`. The quiet window is not added to the duration. 10 s timeout.
  - **Also recorded:** a `longtask` observer, and a subscriber log `(t, busy, filtered, state)` taken through `_host.panel.controller` using only `getViewModel()`/`subscribe()`.
  - **Tests:** the pure completion rule is tested in `instrument.test.mjs` (7/7 pass).
- **Family R:** 9 real points, 3 slots × n_models 1/2/3. Every result set came from a real engine run started with the panel's Run button (`reachability.md`).
  - **Per point:** HB-BASE, HB-WARM and HB-GROUP (2 untimed warm-ups + 5 measured each), and HB-COLD (3 fresh generations, each a real re-run of the same definition).
  - **Viewer checks:** HV-1…HV-4 correctness checks, with all Viewer work outside timing (§9.4).
  - **Summary:** 36 timed cells executed, 216 timed samples in total (162 measured + 54 warm-ups), every one `OK`. No TIMEOUT, no INVALID and no reset failure.
- **Sentinels (P-WARM-H):** each point's T1/T2 are alphabetic name-only tokens taken from the element name of G† (the largest first-page group under `group-count` whose name gave two tokens).
  - **Checks:** they are not substrings of any model display name, and they contain no digits, so they cannot match a dbId.
  - **Counts:** C(T) was recorded in an untimed preparatory pass. The provisional (pre-commit) cold count was 0 at every point, which differs from C(T1).
- **Family M (HM-REC):** **UNAVAILABLE** at all 6 points; see `blockers.md` B-1. Nothing was timed.
- **Not reached:** 5,000 and 10,000 are **NOT REACHABLE HEADED** (`reachability.md`).

## Headed timings (ms; median [min–max], measured samples only; n = 5 warm, 3 cold)

| Point | R.N_results | HB-BASE | HB-WARM | HB-GROUP | HB-COLD | HV-1 | HV-2 | HV-3 | HV-4 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| n1-low | 242 | 7.4 [4.8–8.4] | 171.2 [156.4–173.8] | 159.7 [156.0–174.8] | 175.4 [175.3–176.8] | pass | not met* | pass | pass |
| n1-mid | 369 | 8.0 [5.7–8.5] | 165.1 [154.4–166.5] | 167.4 [166.6–169.0] | 174.2 [174.0–174.3] | pass | not met* | pass | pass |
| n1-high | 4,770 | 3.6 [3.5–12.0] | 175.8 [174.1–179.8] | 180.5 [170.6–184.8] | 186.2 [186.0–187.4] | pass | not met* | pass | pass |
| n2-low | 121 | 8.3 [5.2–9.0] | 169.7 [163.8–171.0] | 167.7 [155.6–169.2] | 170.7 [169.3–172.9] | pass | not met* | pass | pass |
| n2-mid | 1,211 | 2.6 [2.5–2.9] | 167.1 [159.9–175.0] | 159.6 [156.0–170.6] | 178.5 [178.1–179.6] | pass | not met* | pass | pass |
| n2-high | 2,277 | 9.5 [6.2–10.2] | 175.6 [161.4–177.9] | 177.1 [175.7–179.8] | 183.7 [181.1–184.9] | pass | not met* | pass | pass |
| n3-low | 114 | 2.3 [2.2–2.4] | 163.5 [154.7–167.6] | 166.0 [162.8–167.0] | 159.5 [157.1–172.8] | pass | not met* | pass | pass |
| n3-mid | 1,702 | 9.4 [6.1–10.1] | 173.0 [164.3–176.4] | 172.7 [169.8–176.7] | 177.8 [163.1–180.2] | pass | not met* | pass | pass |
| n3-high | 3,488 | 11.0 [9.6–11.7] | 179.1 [177.0–182.3] | 173.4 [158.3–183.8] | 174.6 [161.2–184.5] | pass | not met* | pass | pass |

\* See "HV-2 observation" below.

- **What the text-filter durations include:** HB-WARM, HB-GROUP and HB-COLD durations include the real 150 ms debounce (§9.3 / §10).
- **Time after debounce, measured separately** (`results.json`: `afterFirstBusyMs`, from the first `busy=true` notification to tD):
  - warm: 1.5–18.3 ms;
  - cold: 2.6–22.8 ms.
  - The nominal `duration − 150` is also recorded. It is approximate, because the timer actually fires at ≈155–165 ms.
- **Long tasks:** zero `longtask` entries overlapped any timed window (observer verified active; it recorded 131 long tasks elsewhere in the session, up to 2.46 s, during runs and Viewer work).

## Limits (read before using any number)

1. **Different boundary from headless.** Headed timings use a different boundary from headless (§10):
   - start: the in-page DOM event timestamp;
   - stop: the semantic ∧ DOM predicate, confirmed by the results-region quiet window;
   - included: the real debounce, real task slicing/yielding and the UI list render.
   - **Excluded:** Viewer work (presentGroup, Focus, Isolate, Back to all, fit).

   They must not be compared with headless timings as if the boundaries were the same (§15).
2. **tD resolution:** tD is observed through MutationObserver callbacks and a 10 ms poll. Timer resolution is 0.1 ms (`crossOriginIsolated=false`).
3. **Small, informal sample:** 5 warm or 3 cold samples per cell, median/min/max only, no p95 (§9.2), one browser session, one machine.
4. **Points are not a controlled scale axis:**
   - They are whatever the real product produced. Low/middle are mostly NEAREST-REACHABLE.
   - They mix Hard and Soft definitions.
   - C(T) differs per point and per token pair: HB-WARM/COLD filtered counts range from 8 to 1,602.
   - No scaling or knee inference is made here.
5. **HB-COLD reports the total only.** The label-index commit sub-phase is UNAVAILABLE (§7.4, §18.1).
6. **Soft points** use a user-supplied, unverified `ft` basis.

## Observations (recorded, not remediated)

- **Addendum B L1 flash (observation only, §16):** every one of the 27 HB-COLD samples showed the provisional cold pass as a `busy=false`, `filtered=0`, `results.state='empty-filtered'` notification ("No clashes match") before the committed pass. Its span, from the empty-filtered notification to the next notification, was ≈1.3–10 ms (`emptyFilteredSpanMs`). The predicate never accepted it.
- **HV-2 observation:**
  - HV-2 expects the rounded camera after Focus to differ from the pre-state.
  - At all 9 points the camera after Focus was finite and **identical** to the camera before Focus.
  - Cause, from the recorded camera data: the HV-1 group click had already fitted the camera to G† (camera changed during HV-1, e.g. n2-high position 239.4,−239.4,239.4 → 93.85,−32.19,43.49), so Focus on the same group re-fitted to the same view.
  - Recorded as "not met as written". Whether HV-2's pre-state should start from an un-fitted camera is a protocol question; nothing was changed.
- **HV-1 internal read:** the "no overlay scene" part of HV-1 used the Viewer-internal `viewer.impl.overlayScenes` (read-only, the same read as the CTM-7 capture helper). All other HV reads use public getters.
- **HB-GROUP:** after every sample the Viewer getters (aggregate isolation, isolated nodes, rounded camera) equalled the settled pre-state, and `selected.groupId` and `clashCount` were unchanged. No Viewer mutation was observed in any window.
- **Equal sentinel counts:** at two points C(T1) = C(T2) (n3-low 8/8, n1-high 362/362, both "multipurpose"/"space"). The HB-WARM predicate still tells T1 from T2 apart through `filters.text`.
- **Token reuse:** token pairs were reused across different real sets: concrete/rectangular ×3, round/duct ×3, multipurpose/space ×2. Within one set a pair was never reused. The names in these models are too uniform to give a fresh pair for every set.
- **Console:** 0 errors and 16 warnings for the whole session: the known `Model#getInstanceTree` deprecation, and `three-mesh-bvh` "Triangles are coplanar" warnings during engine runs (`console.log`).

## Execution notes

- **n2-high cold count (fixed rule):**
  - n2-high ran with an earlier rule that read the first `busy=false` notification after the T1 fill as the cold count. That notification was the pre-debounce draft notification (2277).
  - The rule was corrected to "first non-busy notification **after busy=true**". The n2-high record's `coldCountObservedT1` was set to 0 from its own logged notifications: 2277 → empty-filtered 0 → 769.
  - All later points used the corrected rule. This did not affect sentinel validity.
- **Run sequence:** all 9 points used one test record ("Clash test 1"), re-configured through the real setup UI before each run.
- **G† location:** G† was reached on its results page under T1 by untimed real `page-next` clicks: n1-high ×4, n1-low ×3, n2-high ×13, n2-mid ×7, n3-high ×13, n3-mid ×7, other points 0. These are recorded in each point's action log. The HB-GROUP predicate does not depend on the visible page.

## Files

- `results.json` — every timed sample (status, duration, after-debounce, notifications, mutations, long tasks), HB-COLD transition logs, HV details, counts and statuses. Generated by `node test/calibration/ctm8/headed/summarize-headed.mjs <this dir>` from `points/` + `point-meta.json`.
- `points/<point>.json` — the raw in-page record per point:
  - exact action log;
  - VM/Viewer snapshots (pre-states);
  - sentinel preparatory logs;
  - per-sample mutation timestamps and full transition logs;
  - reference lists.
- `screenshots/<point>-NN-*.png` — 10 per point (pre-state, post HB-BASE/WARM/GROUP/COLD, HV-1…HV-4).
- `console.log` — full browser console for the session.
- `environment-headed.json`, `reachability.md`, `blockers.md`, `checksums.sha256`.
