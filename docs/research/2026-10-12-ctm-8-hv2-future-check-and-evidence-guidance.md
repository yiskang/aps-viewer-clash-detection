# CTM-8 — Future HV-2 (Focus) Check Definition and Pre-/Post-Focus Evidence Capture

**Status:** forward-looking guidance only. Owner package: post-checkpoint HV-2 documentation/evidence-tooling cleanup ([final report](2026-10-12-ctm-8-hv2-documentation-evidence-tooling-cleanup-final-report.md)).
**Does not edit** the accepted protocol `CTM8-P0-v4` (§9.4 HV-2 row, SHA-256 `a6f7a61f…2634c3`), the historical HV-2 evidence, or any Independent Work Review. Where this note and protocol §9.4 differ, **this note governs any future HV-2 execution**; the protocol text remains the historical record of what was run.

Basis: [HV-2 adjudication final report](2026-10-12-ctm-8-hv2-focus-adjudication-final-report.md) §7–§8 and [its Independent Work Review](../reviews/2026-10-12-ctm-8-hv2-focus-adjudication-independent-work-review.md) (HV-2 = CHECK/EVIDENCE DEFECT; product Focus correct).

## 1. Why the historical HV-2 predicate is invalid

Protocol §9.4 HV-2: "rounded camera differs from the pre-state and is finite." With default Focus-on-select, the preceding HV-1 group click has already fitted the camera to the group, so a correct, idempotent Focus re-fits to the same pose. The predicate therefore fails for correct behaviour and cannot distinguish a working idempotent Focus from a no-op. "Camera pose after explicit Focus must differ from the pre-Focus pose" is **not** a correctness requirement and must not be used.

## 2. Future HV-2 check definition

### 2.1 Discriminating pre-state (one of the two is mandatory)

- **(a) Displace-first (preferred):** after the group is selected and the camera is settled, move the camera to a pose that provably does not frame the group (public `viewer.navigation.setView(position, target)` lateral translation, as in `hv2-adjudication.js` `moveAway()`), wait for settled, and record that the pre-Focus containment is *not* satisfied (the displaced pose must show fewer than 8/8 union-box corners in view). Then click Focus.
- **(b) Focus-on-select off:** switch Focus-on-select off **before** selecting the group so selection issues no fit; confirm 0 aggregate fit events and a non-framing pre-Focus camera; then click Focus so Focus performs the first fit.

A run that clicks Focus directly after HV-1 under default Focus-on-select (an already-fitted pre-state) is not a valid discriminating HV-2 sample. It may be recorded only as an **idempotence observation** (§2.3), never as the HV-2 verdict.

### 2.2 Pass predicate (product contract)

After the Viewer is settled (existing §9.4 rule: unchanged across consecutive 250 ms samples for ≥ 500 ms, 10 s max), all of:

1. **Fit path dispatched:** the explicit Focus click is followed by an aggregate fit request (`AGGREGATE_FIT_TO_VIEW_EVENT` count ≥ 1 since the click mark; `CAMERA_TRANSITION_COMPLETED` follows). No reliable public "fit complete for request X" signal exists; transition event + settled-camera is the accepted substitute.
2. **Camera finite and correct:** rounded camera position/target/up/fov are all finite, and the camera equals the group's fitted pose F (the pose a fit of the same aggregate produces) within the 1e-3 rounding tolerance.
3. **Group participants framed:** post-Focus containment of the selected group's aggregate participant bounds shows the framing proxy satisfied (8/8 union-box corners in front of the camera and inside the viewport; participant boxes sourced as recorded).
4. **Movement is conditional, not universal:** a camera change relative to the pre-Focus pose is **required only if** the pre-Focus pose was not already F (i.e. §2.1 (a)/(b) pre-state). Under a discriminating pre-state, "camera moved and ended at F" is expected; at an already-fitted pose "camera unchanged" is valid.

### 2.3 Idempotent Focus is valid

Focus at an already-fitted pose must produce a fit request and leave the camera at F (diff within tolerance). This is correct behaviour and may be recorded as a separate, labelled `idempotence` observation alongside the discriminating sample; it never fails HV-2 by itself.

### 2.4 Verdict classes

`PASS` (1–3 satisfied from a discriminating pre-state, incl. 4), `FAIL` (fit not dispatched, camera non-finite or not at F, or group not framed from a discriminating pre-state), `INCONCLUSIVE` (pre-state not shown to be non-framing, viewer not settled, containment unavailable). An already-fitted pre-state is `INCONCLUSIVE` for HV-2, not `FAIL`.

## 3. Future evidence capture — pre-Focus and post-Focus containment

The historical P3-C step sampled one `containment()` field after the Focus click (driver ordering defect, disclosed in the HV-2 report, accepted non-blocking because camera, event and screenshot evidence were sufficient). For any future HV-2 / Focus evidence:

1. Capture **containment (framing) state before the explicit Focus click**, after settled, and store it under a label that names the moment: `containmentPreFocus`.
2. Capture **post-Focus containment separately**, after the post-click settled rule, under `containmentPostFocus`. Never reuse one sample for both.
3. Raw evidence must label each sample explicitly with the phase (`pre-focus` / `post-focus`), the settled flag, the participant-id source, the event-count mark and a timestamp, so before/after cannot be confused. Bare unlabeled `containment` keys are not acceptable in new raw evidence.
4. A pre-Focus sample must be recorded **before** the click is issued in driver order; a driver that computes it after the click invalidates that scenario (record as `INCONCLUSIVE`, rerun; do not backfill).
5. Do not manufacture a missing pre-Focus sample retroactively for historical evidence; P3-C remains as disclosed.

### 3.1 Tooling disposition

`test/calibration/ctm8/headed/hv2-adjudication.js` (runtime-injected, non-production, version `ctm8-hv2-adjudication/2`) exposes `containment()` as an unlabeled point-in-time snapshot; the phase ordering and labelling are the **Playwright driver's** responsibility, and no retained driver or test for it exists in the repository (the driver run survives only as `driver-playwright.txt` historical evidence). Because the tooling is a historical one-shot adjudication helper with no retained driver or unit test, it was **intentionally left unchanged** in this package; the §3 requirement is documented here instead. A future HV-2 package that retains or re-versions the tooling should add a labelled capture wrapper (e.g. `containmentAt('pre-focus' | 'post-focus')` that stamps the label and refuses a `post-focus` capture before a click mark) with a unit test, and bump `VERSION`.
