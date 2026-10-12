# CTM-8 HV-2 (Focus) headed adjudication — evidence

This directory holds evidence only. It answers why HV-2 did not show Focus correctness at the 9 earlier headed points, using 3 targeted real points. The earlier 9/9 HV-2 "not met as written" result is kept unchanged in `../2026-10-12-ctm-8-rebuild-cost-calibration/headed/`. Nothing here redefines it.

It makes no performance claim. Event timestamps in the raw files only put events in order; no Focus latency is reported.

## What was run

**Environment** (`environment.json`):
- Headed Chromium (Playwright MCP) at 1600×1000.
- APS Viewer 7.124.2.
- The three real SVF2/OTG Audubon models (Architecture #1, Structure #2, Mechanical #3), loaded together.
- App already running on :8080.

**Production code:** none changed. Every product action used the real UI: Run, Group by element, page-next, group row body, Focus, Isolate, Focus on select, and Back to all.

**Tooling:** `test/calibration/ctm8/headed/hv2-adjudication.js`, injected at runtime. It:
- reads the camera through public Navigation getters;
- listens to the public `AGGREGATE_FIT_TO_VIEW_EVENT`, `FIT_TO_VIEW_EVENT`, `CAMERA_TRANSITION_COMPLETED` and `CAMERA_CHANGE_EVENT` (counted only);
- applies the §9.4 settled rule (unchanged across 250 ms samples for ≥ 500 ms, 10 s max);
- computes a containment proxy: participant boxes from public `InstanceTree.getNodeBox`, with the union-box corners projected by `worldToClient`.

**The one evidence-tooling mutation:** `viewer.navigation.setView(position, target)`.
- It translates the fitted camera sideways by 4× the eye distance, along camera-right plus half that along camera-up.
- The view direction, up and fov stay the same, so a correct re-fit has to land back on F.
- Every call is recorded (`results.json` → `evidenceToolingMove`). This is not part of the product path.

**Driver:** the exact Playwright procedure is in `driver-playwright.txt`. Each point's parameters are in `scenarios/<point>.json` → `cfg`.

### Points (each a real engine run from the Run button)

| Point | Definition | Run | G† (group by element) | Clashes / participants | Fit path |
| --- | --- | --- | --- | --- | --- |
| P1-n1-low | Mechanical self, Hard | 242 | Mechanical · Round Duct [839290] | 4 / 5 (model 3) | single-model `fitToView(ids, model)` |
| P2-n2-mid | Architecture × Mechanical, Hard | 1211 | Mechanical · Round Duct [918256] | 56 / 57 (models 1, 3) | aggregate |
| P3-n3-mid | Mechanical × (Architecture + Structure), Hard | 1702 | Mechanical · Round Duct [918256] | 57 / 58 (models 1, 2, 3) | aggregate |

### Sequence at each point

1. **Pre-state capture.**
2. **HV-1:** click the group row with Focus on select at its default (on). The camera is fitted; this pose is **F**.
3. **Isolate:** checked through the real UI so the framed participants are visible. Isolate re-presents with `fit:false`; the camera stayed at F and no fit event fired at all 3 points.
4. **Scenarios:**
   - **A — the original HV-2:** click Focus with no camera change.
   - **B:** move the camera to **M** with the tooling, then click Focus.
   - **C (P3 only):**
     1. Uncheck Focus on select through the real toggle.
     2. Click Back to all.
     3. Move the camera to M2.
     4. Click the row; this does not fit.
     5. Click Focus; this is the first fit.
5. **Back to all.** After it, aggregate isolation and selection were empty and nothing was selected.

## Results (tolerance 1e-3 on position, target, up and fov)

| Scenario | Camera after vs before | After ≈ F | Fit event after click | Transition completed | Box corners in view (proxy) | Verdict | Evidence supports |
| --- | --- | --- | --- | --- | --- | --- | --- |
| HV2-ADJ-P1-A | identical to F (Δ 0) | yes | AGGREGATE_FIT ×1 | yes | 8/8 | PASS | CHECK/EVIDENCE DEFECT |
| HV2-ADJ-P1-B | M → F (Δ 37.03) | yes (Δ 0) | AGGREGATE_FIT ×1 | yes | M 0/8 → 8/8 | PASS | CHECK/EVIDENCE DEFECT |
| HV2-ADJ-P2-A | identical to F | yes | AGGREGATE_FIT ×1 | yes | 8/8 | PASS | CHECK/EVIDENCE DEFECT |
| HV2-ADJ-P2-B | M → F (Δ 260.34) | yes (Δ 0) | AGGREGATE_FIT ×1 | yes | M 0/8 → 8/8 | PASS | CHECK/EVIDENCE DEFECT |
| HV2-ADJ-P3-A | identical to F | yes | AGGREGATE_FIT ×1 | yes | 8/8 | PASS | CHECK/EVIDENCE DEFECT |
| HV2-ADJ-P3-B | M → F (Δ 337.34) | yes (Δ 0) | AGGREGATE_FIT ×1 | yes | M 0/8 → 8/8 | PASS | CHECK/EVIDENCE DEFECT |
| HV2-ADJ-P3-C | row click left camera at M2 with 0 fit events; Focus M2 → F | yes (Δ 0) | AGGREGATE_FIT ×1 | yes | 8/8 | PASS | CHECK/EVIDENCE DEFECT |

**Totals:** 7 PASS / 0 FAIL / 0 INCONCLUSIVE. The final classification is the owner's.

- **In A:** the historical HV-2 predicate ("rounded camera after ≠ before") is **not met at all 3 points**. This reproduces the earlier observation.
- **Why it cannot be met:** Focus does issue a real fit request (`AGGREGATE_FIT_TO_VIEW_EVENT`) and a camera transition. But the pre-state is already the fitted pose F, so a correct, idempotent re-fit cannot change the camera.

### Key camera numbers (position / target; up [-0.408, 0.408, 0.816] and fov 53.13 unchanged throughout)

| Point | F (after HV-1) | M (moved away) | After Focus from M |
| --- | --- | --- | --- |
| P1 | (-108.574, 27.746, 8.531) / (-114.439, 33.611, 2.667) | (-88.137, 64.771, 25.119) / (-94.002, 70.636, 19.255) | = F |
| P2 | (69.263, -7.811, 42.265) / (28.026, 33.426, 1.028) | (212.964, 252.527, 158.901) / (171.727, 293.764, 117.664) | = F |
| P3 | (100.444, -20.008, 54.462) / (47.010, 33.426, 1.028) | (286.650, 317.332, 205.597) / (233.216, 370.766, 152.163) | = F (B and C) |

F at P2 and P3 equals the HV-1 camera recorded at n2-mid and n3-mid in the earlier headed run.

### Fit-complete signal

- **Fit request:** `AGGREGATE_FIT_TO_VIEW_EVENT` fired synchronously, once per Focus or fitting row click.
  - It fired on the single-model path (P1) too.
  - `FIT_TO_VIEW_EVENT` fired 0 times in the session.
- **Transition:** `CAMERA_TRANSITION_COMPLETED` followed every fit, including the no-op re-fit in A.
- **No reliable request-correlated public "fit complete" signal exists.**
  - The transition event carries no request id.
  - Completion was judged as "transition-completed seen after the click" plus the §9.4 settled rule. Every scenario settled.

## Observations (recorded, not remediated)

- **O-1:** HV-1 already performs the same fit (Focus on select defaults to on). HV-2's pre-state is therefore always F.
- **O-2 (docked panel):**
  - The fit frames the participant union in the full Viewer canvas (1600×952). The union-box centre projected to the canvas centre (799.5, 475.5).
  - The docked Clash panel covers about the left 470 px of the canvas. Part of a framed group can lie under it: the box-corner x minimum was 154–189 px, and in P2/P3 the long Architecture wall runs under the panel.
  - This is recorded only; it is not a Focus-contract judgement.
- **O-3 (Isolate off):** with Isolate off, unrelated building geometry hid the framed participants (a uniform grey frame). This was P1 attempt 1.
  - Kept as `scenarios/P1-n1-low-attempt1-isolate-off.json` plus `screenshots/P1-n1-low-att1-isooff-*`.
  - Its camera numbers equal the final P1 run.
  - It is not counted in the totals.
- **O-4 (camera mode):** the camera is orthographic in this session.
- **O-5 (P1 HV-1):** the final P1 pass started with the camera already at F (left there by attempt 1), so its HV-1 caused no visible camera change.
- **Driver defect (disclosed):** `scenarios/P3-n3-mid.json` → `steps.C.select.containment` was evaluated after the Focus click and must be ignored.
  - At that moment the camera was M2, which is identical to M of P3-B, where the proxy was 0/8.
  - The screenshot `P3-n3-mid-05-…-selected-FoS-off-M2.png` shows the group not framed.
- **Proxy limits:**
  - Box corners are a conservative bound, not pixel coverage.
  - The visual check confirms the group is framed in the canvas. It cannot confirm all 57/58 participants one by one.
- **Console:**
  - 0 errors and 1 warning (`Model#getInstanceTree` deprecation). That warning comes from this package's containment proxy, which uses the public InstanceTree API.
  - The Playwright capture covers the current page only (`console.log`).

## Blockers

None.

## Files

- **`results.json`:** per scenario: before/after camera, events, assertions, verdict, supported category, screenshots, and the fit-signal statement.
- **`scenarios/*.json`:** raw in-page records: action log, states, events, containment and comparisons.
- **`screenshots/`:** `<point>-00-pre`, `01-HV1-fitted-F`, `01b-isolate-on-at-F`, `02-…-A-after-focus`, `03-…-B-moved-away-M`, `04-…-B-after-focus`, (P3) `05-…-C-selected-FoS-off-M2`, `06-…-C-after-focus`, and `09-back-to-all`.
- **Other files:** `console.log`, `environment.json`, `driver-playwright.txt`, `checksums.sha256` (SHA-256 of every other file here).
