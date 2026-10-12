# CTM-8 HV-2 Headed Evidence-Only Adjudication — Final Report

Date: 2026-10-12. Owner prompt: `docs/prompts/ctm8-hv2-headed-evidence-only-adjudication-prompt.md`. Scope: correctness/evidence adjudication of the CTM-8 HV-2 (Focus) check only. **No performance claims**; Focus latency was not measured or reported; the historical HV-2 9/9 result is preserved unchanged as prior evidence.

## 1. Repository state
Repo `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`, branch `main`, HEAD `ac5bcb42b00e668442ce3add9764cba96d883309` == `origin/main` (0/0). No commit/push since the execution review. Tree uncommitted: `docs/handoffs/latest.md` (modified); untracked docs, `test/calibration/`, and evidence directories. No production, existing-test or shared-support file changed (`git diff --stat` outside `docs/handoffs` is empty; `git diff --check` clean). CTM-8 execution package remains complete and uncommitted; no refinement package started; headless campaign not rerun.

## 2. Closed owner dispositions (not reopened)
HM-REC 6/6 UNAVAILABLE accepted as non-blocking; Family M launch-0 vs launch-1/2 shift accepted as non-blocking documented anomaly (no cause assigned, nothing derived). HV-2 not accepted as demonstrated PASS before this package.

## 3. Governing HV-2 contract (verbatim sources)
- Protocol `CTM8-P0-v4` §9.4: HV-2 action = "click `button[data-key="action-focus"]`"; expected post-state (correctness only) = "after settled: rounded camera differs from the pre-state and is finite". "Viewer settled" = public getters (`getAggregateIsolation()`, `getIsolatedNodes()`, rounded camera) and `vm.selected` unchanged across consecutive 250 ms samples for ≥ 500 ms, 10 s max (else INCONCLUSIVE). HV-1…HV-4 run in sequence per point; HV-1 = click `button.clash-group-body[data-key="group:<G†id>|present"]` and asserts nothing about the camera. No camera reset is defined between HV-1 and HV-2.
- Historical evidence: at all 9 points the camera before and after Focus was finite and identical to 3 decimals (e.g. n2-high 93.85,−32.19,43.49 → same), because HV-1 had already fitted G† (n2-high HV-1: 239.4,−239.4,239.4 → 93.85,−32.19,43.49). The Independent Work Review recorded 0 PASS / 9 FAIL under the literal predicate and 0 PASS / 0 product FAIL / 9 INCONCLUSIVE for product adjudication (finding M2).

## 4. Addendum B Focus contract (sources: spec §9.2/§9.3/§27, accepted group-header review L107)
Group selection with "Focus on select" on (default) frames the union of live participant bounds via the existing aggregate fit; the **Focus button always re-requests the aggregate fit**; Markers disabled for a group. Nothing in spec/plan/review requires Focus to change a camera that is already fitted; the contract is "always requests/re-fits". No public observable is named as proof; the accepted Addendum B headed run used rounded `navigation.getPosition()/getTarget()` and moved the camera away first.

## 5. Implementation-path analysis (read-only)
Group click → `GROUP_PRESENT` → `controller.onGroupPresent` → `presentGroup(c,{fit: focusOnSelect})` → `ViewerBridge.presentGroup` → `transact` (isolation, then fit last) → `fit.js` (`fitToView` single model; `fitToViewAggregate` multi-model) → Viewer `fitBounds` (animated ~500 ms, ends with `CAMERA_TRANSITION_COMPLETED`, no request id; fit-request events fire synchronously). Focus button → `ACTION_FOCUS` → `presentGroup(c,{fit:true})` — same path; no same-pose short-circuit exists; the destination is computed from the current camera with `reorient` unset. **No divergence from the accepted contract was found.** Known documented limitation (not new): cross-model aggregate fit is an unpublished Viewer form (PG-1). Consequence: with HV-1 having fitted the same group, a correct Focus is idempotent, so the predicate "camera differs from pre-state" is logically unsatisfiable by a correct implementation.

## 6. Targeted headed evidence
Evidence: `docs/research/evidence/2026-10-12-ctm-8-hv2-focus-adjudication/` (README, `results.json`, `environment.json`, `console.log`, `driver-playwright.txt`, `scenarios/*.json`, 29 screenshots, `checksums.sha256` 37 files all verified OK). Tooling (new, runtime-injected, non-production): `test/calibration/ctm8/headed/hv2-adjudication.js`. Environment: headed Chromium 1600×1000, Viewer 7.124.2, three Audubon SVF2/OTG models, app on `:8080`, real engine runs through the real Run button, every product step through the real UI. The only non-UI action: moving the camera with the public `viewer.navigation.setView(position, target)` (evidence tooling, recorded).

| Point | Definition | Results | G† | Clashes/participants |
| --- | --- | --- | --- | --- |
| P1 (n1-low) | Mechanical self, Hard | 242 | Round Duct [839290] | 4 / 5 |
| P2 (n2-mid) | Architecture × Mechanical, Hard | 1,211 | Round Duct [918256] | 56 / 57 |
| P3 (n3-mid) | Mechanical × (Arch + Struct), Hard | 1,702 | Round Duct [918256] | 57 / 58 |

| Scenario | Sequence | Result |
| --- | --- | --- |
| HV2-ADJ-P1/P2/P3-A | original HV-2 sequence (HV-1 → Focus unchanged) | **PASS ×3** — Focus issued a fit request (`AGGREGATE_FIT_TO_VIEW_EVENT` ×1, `CAMERA_TRANSITION_COMPLETED` ×1), camera stayed exactly at fitted pose F (diff 0), 8/8 group-box corners in view. The literal historical predicate ("camera differs") is **not met** — and cannot be by an idempotent re-fit. |
| HV2-ADJ-P1/P2/P3-B | camera moved away to M (0/8 corners in view, empty frame), then real Focus | **PASS ×3** — camera returned exactly to F (moved 37.0 / 260.3 / 337.3 units), finite, 8/8 corners in view, screenshots show the group framed (e.g. `P2-n2-mid-03` empty vs `-04` framed). |
| HV2-ADJ-P3-C | Focus-on-select OFF, so Focus is the first fit | **PASS ×1** — selection left camera at M2 with 0 fit events; Focus moved M2 → F exactly, 8/8 corners in view. |

**Targeted totals: 7 PASS / 0 FAIL / 0 INCONCLUSIVE.** F at P2/P3 equals the HV-1 camera of the earlier headed run. Console: 0 errors, 1 warning (`Model#getInstanceTree` deprecation, caused by the in-view probe). An initial P1 pass with Isolate off (surrounding geometry hid the framed ducts) is retained as `scenarios/P1-n1-low-attempt1-isolate-off.json` and is **not counted**. A disclosed driver-ordering defect in P3-C (`steps.C.select.containment` computed after the Focus click) is excluded; the camera at that moment equals P3-B's M and the screenshot shows the group unframed.

**Fit-complete signal:** a fit request is observable (`AGGREGATE_FIT_TO_VIEW_EVENT`, fired even for the single-model path here; `FIT_TO_VIEW_EVENT` fired 0 times). `CAMERA_TRANSITION_COMPLETED` followed every fit but carries no request id, so **no reliable public "fit complete for request X" signal exists**; the transition event plus the settled-camera rule was a workable substitute.

## 7. Classification
**CHECK/EVIDENCE DEFECT.** Product Focus behaviour is correct at all targeted points: it re-frames the aggregate from a non-fitted pose and is idempotent from a fitted pose. The defect is the HV-2 predicate/sequence: it requires the post-Focus camera to differ from a pre-state that HV-1 (with default Focus-on-select) had already fitted, which a correct implementation cannot satisfy; it cannot distinguish a working idempotent Focus from a no-op. Precise predicate defect: "rounded camera differs from the pre-state" with no camera displacement between HV-1 and HV-2 (protocol §9.4). Not INSTRUMENTATION/PROTOCOL MISMATCH in the strict sense (the permitted public getters were sufficient once a discriminating pre-state was used), not a product defect, not inconclusive.

Limits stated plainly: the in-view check is a proxy (public `InstanceTree.getNodeBox` box corners + `worldToClient`, conservative bound, not pixel coverage; screenshots cannot confirm each of 57/58 participants individually). Observation only, not judged against the contract: the fit centres the group in the whole canvas including the area beneath the docked panel (~left 470 px), so part of the framed group can sit under the panel (box-corner x minimum ≈154–189 px). The moved-away mutation uses a public navigation call outside the product path (disclosed).

## 8. Consequences
- **Can the CTM-8 checkpoint proceed?** From the HV-2 standpoint yes: the HV-2 residual is resolved as a documented check/sequencing defect with positive targeted evidence; Addendum B Focus is not contradicted. This is a recommendation to the independent review/owner, not authorization to commit.
- **Separate product-remediation package required?** **No** for Focus. (The panel-overlap observation is recorded only; it is not a finding against the accepted contract and no remediation is proposed.)
- Protocol correction (record only, not applied): a future HV-2 should displace the camera to a known non-fitted pose before Focus (as the accepted Addendum B run did) or switch Focus-on-select off; the protocol file was not edited.

## 9. Boundaries confirmed
No production/Core/collision/Adapter/host change; no existing test or earlier evidence edited; no headless rerun; no Focus fix; no limits/budgets; no performance interpretation; no commit/push.

## 10. Exact next gate
**Independent Work review of this HV-2 evidence adjudication package**, then owner decision on checkpoint commit/push. Awaiting owner authorization for anything further.
