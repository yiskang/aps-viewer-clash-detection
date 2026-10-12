# CTM-8 HV-2 Focus Adjudication — Independent Work Review

**Date:** 2026-10-12  
**Verdict:** **CONDITIONAL PASS — READY FOR OWNER CHECKPOINT DECISION WITH NON-BLOCKING RESIDUALS**  
**Classification:** **CHECK/EVIDENCE DEFECT**  
**Findings:** 0 Critical / 0 High / 0 Medium / 2 Low  
**Blockers:** None

## 1. Repository and review boundary

- Repository: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- Branch: `main`
- HEAD: `ac5bcb42b00e668442ce3add9764cba96d883309`
- Origin: `origin/main` at the same commit; ahead/behind `0/0`
- Tree: the existing CTM-8 documentation, evidence, prompts, reviews, non-production calibration support, and handoff edit remain uncommitted/unpushed. No production or existing-test tracked file is modified.
- `git diff --check`: clean.

This review is limited to the HV-2 Focus adjudication authorized by [`docs/prompts/ctm8-hv2-headed-evidence-only-adjudication-prompt.md`](../prompts/ctm8-hv2-headed-evidence-only-adjudication-prompt.md). The upstream [`HV-2 final report`](../research/2026-10-12-ctm-8-hv2-focus-adjudication-final-report.md) and retained evidence were treated as read-only inputs. HM-REC and the Family-M launch-shift owner dispositions remain closed and were not reopened.

## 2. Governing contract and implementation path

The accepted product contract is stable:

- Viewer Clash Panel design §9.2 says the explicit Focus action always re-fits the current clash/group.
- Design §27 defines aggregate group Focus as framing the union of live participant bounds through the existing fit behavior.
- Neither contract requires the camera to change when it is already at the same fitted pose.

The production path was independently traced:

1. The group Focus control dispatches `ACTION_FOCUS`.
2. `controller.onActionFocus` calls `presentGroup(..., {fit:true})` for a selected group.
3. `ViewerBridge.presentGroup` executes the normal presentation transaction.
4. The focus step reaches `fitSides`, which calls `fitToView` for one model or the aggregate fit path for multiple models.

No camera-equality early return or same-pose short circuit exists. The same aggregate-fit path is reached for both an already-fitted camera and a displaced camera.

The historical CTM8-P0-v4 HV-2 sequence selected the group first while Focus-on-select was enabled, then required the explicit Focus click to produce a different rounded camera. That predicate is not discriminating: the selection had already fitted the same group, so a correct repeated fit is idempotent. This is a **check/evidence defect**, not a product defect.

## 3. Evidence integrity and independent recomputation

Reviewed evidence root: [`docs/research/evidence/2026-10-12-ctm-8-hv2-focus-adjudication/`](../research/evidence/2026-10-12-ctm-8-hv2-focus-adjudication/).

- The checksum manifest contains **38 entries**, and all 38 verify against the retained files.
- `results.json` contains seven counted scenarios: three idempotent A cases, three moved-away B cases, and one Focus-on-select-off C case.
- Independently recomputed totals: **7 PASS / 0 FAIL / 0 INCONCLUSIVE**.
- The historical HV-2 result is preserved unchanged; no earlier evidence was rewritten.
- Environment evidence records Viewer 7.124.2, headed Chromium 155, 1600×1000, and the Audubon Architecture/Structure/Mechanical SVF2/OTG models.
- Console evidence contains no errors and one disclosed deprecation warning from the evidence probe.
- The runtime helper is non-production support code. Product Focus actions use the real UI; the only setup mutation is a disclosed public `viewer.navigation.setView` camera displacement.

### Scenario adjudication

| Scenario family | Independent result | Basis |
| --- | --- | --- |
| P1/P2/P3 A — already fitted, then Focus | PASS ×3 | One aggregate-fit request and one completed camera transition per click; finite settled camera remains at the same fitted pose; 8/8 aggregate-box corners remain in the viewport. This proves the action executes and is idempotent. |
| P1/P2/P3 B — move away, then Focus | PASS ×3 | The displaced pose has 0/8 aggregate-box corners in view; the real Focus action returns exactly to the prior fitted pose, with one fit request and transition and 8/8 corners in view. |
| P3 C — Focus-on-select off | PASS ×1 | Selecting the group does not fit; the first explicit Focus produces one fit request/transition and returns the camera to the fitted pose. |

The retained P2/P3 fitted poses also agree with the earlier headed HV-1 camera evidence to the recorded precision.

## 4. Independent visual adjudication

All retained screenshots were inventoried; the key before/after and idempotent states for P1, P2, and P3 were inspected directly.

- Visual totals: **7 PASS / 0 FAIL / 0 INCONCLUSIVE** for the seven counted checks.
- The A screenshots support unchanged, correctly framed final poses.
- The B moved-away screenshots show the group outside the visible frame; their paired Focus screenshots restore the framed group.
- The C pre-Focus screenshot and camera/event evidence support no selection-triggered fit with Focus-on-select off; the post-Focus screenshot shows the framed group.
- Selected group labels and result/participant counts agree with the scenario records.

The box-corner test is an adequate aggregate-bounds framing proxy for this correctness claim because all participants have bounds, all eight corners are projected, the center is retained, and screenshots corroborate the final states. It is not pixel-visibility or occlusion proof and must not be used for that broader claim.

## 5. Completion signal and boundaries

The Viewer emits the aggregate-fit request event synchronously and later emits `CAMERA_TRANSITION_COMPLETED`, but the transition event has no request identifier. In this package there is no overlapping fit action: the event pair, stable-camera sampling, unchanged selected group, and final Viewer state form sufficient correctness evidence. This does not establish a request-correlated public completion API or any latency/performance claim.

The package does not alter production, Core, collision, Viewer Adapter, host integration, existing tests, limits, budgets, or the accepted protocol. No headless campaign was rerun. No product-remediation package is required for Focus.

## 6. Findings

### Low L1 — checksum count in the upstream report is off by one

- **Artifact:** upstream final report §6 and the handoff's pre-review summary.
- **Failure mode:** they say the evidence has 37 checksummed files; `checksums.sha256` actually contains 38 entries.
- **Evidence:** all 38 entries verify. The set is five root evidence files, four scenario JSON files, and 29 screenshots.
- **Checkpoint impact:** none. This is report metadata, not an integrity failure.
- **Minimum correction:** the responsible HV-2 evidence/reporting package should use 38 in any later authorized documentation correction. The upstream report remains read-only in this review.
- **Blocking:** no.

### Low L2 — P3-C raw containment was sampled after Focus

- **Artifact:** the P3-C scenario JSON field `steps.C.select.containment` and the disclosed upstream limitation.
- **Failure mode:** that field cannot independently prove the pre-Focus out-of-frame state because the driver computed it after the Focus action.
- **Evidence:** it is explicitly excluded from the final result. The pre-Focus camera equals the independently measured P3-B displaced pose with 0/8 corners in view; the C screenshot is visually unframed; and selection records zero fit, transition, and camera-change events before the explicit Focus.
- **Checkpoint impact:** none. Independent evidence still supports the C result.
- **Minimum correction:** future evidence tooling should snapshot containment before the Focus click. A rerun is not required for this checkpoint.
- **Blocking:** no.

## 7. Checkpoint disposition

The targeted evidence closes the HV-2 product-readiness question:

- **HV-2 classification:** CHECK/EVIDENCE DEFECT.
- **Product behavior:** accepted for the reviewed Focus contract at the three representative real-model points.
- **Technical/evidence blockers:** none.
- **Product remediation:** not required.
- **Protocol correction:** record only; not authorized here. A future check must create a discriminating pre-state by moving the camera away or disabling Focus-on-select before selection.

The CTM-8 package is therefore ready for the **owner checkpoint decision on commit/push**. This review does not authorize that checkpoint operation.

## 8. Protected next boundary

The exact next gate is the owner's decision whether to commit/push the complete CTM-8 checkpoint. Until explicitly authorized, do not commit, push, rerun/refine CTM-8, edit the accepted protocol or upstream reports, derive limits/budgets/scalability claims, remediate deferred items, or begin another package or milestone.
