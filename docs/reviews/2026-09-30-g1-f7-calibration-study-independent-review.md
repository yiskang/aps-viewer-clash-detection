# Independent review — G1 F7 CAL-B calibration study

**Date:** 2026-09-30  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Reviewed branch / HEAD:** `main` @ `596dab3e029b60d5417bc984b03b1a4311295da1` (`origin/main` equal)  
**Primary artifact:** [`docs/research/2026-09-29-g1-f7-calibration-study.md`](../research/2026-09-29-g1-f7-calibration-study.md)  
**Verdict:** **CAL-B is accepted.** The retained evidence does not support a defensible general calibration rule. G1 may close as verified `PARTIAL`; a read-only mechanism probe is technically justified but optional and not yet specified strongly enough for direct execution authorization.

## Findings

| Severity | Count | Summary |
| --- | ---: | --- |
| Critical | 0 | None |
| High | 0 | None |
| Medium | 2 | Existing F7 denominator is incorrectly left as an owner decision; proposed probe lacks a deterministic control/evidence contract needed for execution. |
| Low | 1 | “≈13%” extent-relative wording is numerically imprecise: 13% clears only 9/26; approximately 15% is required to clear all 26. |

These findings do not invalidate CAL-B, the derived evidence, or the verified Mechanical G1 `PARTIAL` result.

## 1. Repository and evidence basis

The repository is `main` @ `596dab3e029b60d5417bc984b03b1a4311295da1`, equal to `origin/main`. The Mechanical live run, report, and independent verification are committed in that baseline. The calibration authorization prompt, study, four derived JSON files, two analysis scripts, internal review, and handoff edit are uncommitted/untracked or modified; no harness or production implementation file differs from `596dab3`.

The committed Mechanical JSON remains byte-identical to the previously independently reviewed record: SHA-256 `627c3585dbcd94b23e590ed930426914c3eb60ae1ae10b9a5a29e2980ec6a573`. The study and derived files read that record without modifying it.

## 2. CAL-B disposition

CAL-B is the correct disposition from the current evidence:

- There is one retained SVF2 fixture/runtime envelope, not an independent multi-model calibration population.
- The 26 cases show a real difference between the Viewer node box and the harness's computed corner envelope, but the repository does not retain enough per-fragment evidence to identify the mechanism.
- The Viewer 7.124.2 implementation behind `getNodeBox` is opaque to this repository; no retained evidence establishes whether it uses live geometry, per-fragment boxes, precomputed node boxes, or different aggregation inputs.
- Representation-derived candidates do not admit the cases. The only candidate that can admit all 26 is a post-hoc extent allowance with no independently derived correctness rationale.
- The study evaluates candidates descriptively but adopts none, so it does not tune the accepted thresholds against the 26 cases.

Rejecting the extent-relative rule is technically justified rather than merely conservative. A threshold large enough to admit all 26 would allow roughly 15% box excess and could hide the materially oversized bounds the envelope-side check is meant to detect. No Viewer contract, numeric-path derivation, or independent fixture establishes that allowance as valid.

## 3. Independent numeric verification of the 26 cases

Independent calculation from the committed Mechanical JSON confirms:

| Claim | Independently verified value |
| --- | --- |
| Population | 1,257 roots = 873 `agrees` + 26 `exceeds-envelope` + 358 `no-reference-geometry` |
| Violating components | 55; all are `eMin`/`eMax` envelope-side components; no containment component exceeds `T_pass` |
| Absolute violating residual range | `0.0007773046381771564` to `0.2733602429216262` ft |
| Per-component `residual/T_pass` | `9.21427693877209` to `5600.2197929783715` |
| Per-dbId maximum `residual/T_pass` | `10.18416416668899` to `5600.2197929783715` |
| Minimum violating residual in float32 ULPs | `252.0918960571289` ULP; therefore the study's `>=252` claim is correct |
| Worst containment residual among the 26 | `0.0548319003042099 × T_pass`; containment holds in all 26 |
| Worst all-component residual among 873 agreements | `0.07958640690016848 × T_pass` |

The “10×–5600×” summary is valid when read as the per-dbId maximum range; the study correctly gives the more exact per-component floor as `9.2×`. Agreements and exceedances are cleanly separated in this run: the worst agreement is below `0.08× T_pass`, while the smallest per-dbId exceedance maximum is above `10.18× T_pass`.

This separation proves the oracle is distinguishing two observed populations. It does not identify why the Viewer's boxes exceed the computed envelope or establish a general rule for other fixtures.

## 4. Candidate-rule verification

| Candidate | Independent result | Disposition |
| --- | --- | --- |
| `passFactor = 1024` | 1/26 passes (`dbId 379`); 25 remain outside | Not a solution |
| `max(T_pass, k·ulp32(|node coordinate|))`, `k=1…16` | 0/26 pass at `k=16`; therefore all smaller tested multipliers also fail | Not a solution |
| `max(T_pass, k·ulp32(S_a))`, `k=1…16` | 0/26 pass | Not a solution |
| Extent-relative | Maximum observed excess/node-extent ratio is `0.1438446676`; 13% passes only 9/26, while 15% passes 26/26 | Would fit this run, but is post-hoc and unjustified |

**Low finding L1:** the study table's “relative-to-extent (≈13%) would pass all 26” wording is not numerically exact. The median is about 13.10%, but the maximum is about 14.38%; a rule of at least that value (practically 15%) is needed to pass all 26. This does not weaken the study's rejection of the candidate as overfit; it strengthens the concern because the necessary allowance is larger than the table implies.

## 5. Evidence limitations

The study accurately discloses the important limits:

- The final live JSON retains only per-fragment world-matrix **type** labels, not the 16 matrix values.
- It retains per-root `fragmentBoundsUnion` and `conservativeEnvelopeUnion`, not Viewer `fragList.getWorldBounds` boxes for each fragment.
- F4 observed 438 distinct geometry proxies. F7 maps those geometry snapshots across 1,496 fragment records, but no retained evidence proves proxy/buffer equivalence for every fragment sharing a geometry id.
- For the 26 exceedances, the retained F7 output has no exact per-root fragment-id membership. `fragmentCountLowerBound:1` is accurate; all 26 have no recorded skipped fragment and the evidence does not justify calling the count exact.
- `worldMatrixElementType === Float64Array` describes the harness's copied matrix, not the Viewer's internal storage type.

The study does not overstate the 438-proxy boundary after its internal-review remediation.

## 6. The 358 `no-reference-geometry` exclusions

The retained evidence and `observeF7` algorithm establish:

- all 358 have `fragmentBoundsUnion:null`, non-null Viewer node/envelope boxes, and exactly one recorded skip;
- every skip is `no-active-triangles`;
- all 594 skips across the full census have that same reason; the other 236 occur on scored agreeing roots that also have active reference geometry;
- 347/358 excluded Viewer boxes are degenerate on at least one axis, consistent with line/point/flat content;
- none of the 358 silently enters the 899-root residual/tolerance population.

Retaining these roots as explicit exclusions is justified under the accepted F7 contract: without active triangles there is no vertex-tight triangle reference for the current comparison.

**Medium finding M1:** the study and handoff say the future F7 PASS denominator remains an owner/design decision. The accepted harness plan already settles it: `no-reference-geometry` roots are recorded and excluded from the bounds comparison. For this evidence, the mechanically derived scored denominator is 899, with 358 explicit exclusions. No owner decision is required to preserve that contract. Owner authorization is required only to expand/change it—for example, by adding an envelope-only requirement for the 358 or demanding a claim over all 1,257 roots.

## 7. Proposed read-only probe

The proposed probe is technically useful for mechanism identification:

- `fragList.getWorldMatrix(fragId, Matrix4)` and `fragList.getWorldBounds(fragId, Box3)` are existing synchronous repository-used APIs;
- targeting the retained 26 dbIds plus agreeing controls keeps the observation population bounded;
- reading the node box, per-fragment boxes/matrices, proxy signatures, tight reference, and corner envelope in one stable model state can distinguish Viewer-box construction from an oracle-input mismatch;
- no collision run, F1–F8 rescore, mandatory control, tolerance change, or Viewer mutation is needed beyond loading the fixture;
- therefore it is research-only and is not a full G1 rerun.

**Medium finding M2:** the study's probe description is not yet execution-ready. Before any live authorization, a bounded probe plan/script and independent review must define:

1. the exact deterministic agreeing-control dbIds, count, and matching rule;
2. the exact proxy-signature/hash algorithm and canonical bytes;
3. runtime/fixture/Viewer/script/code identity fields, output schema/path, bounded errors, timeouts, cleanup, and fail-closed incomplete-record rules; and
4. the explicit activation/attempt boundary proving it cannot invoke the G1 harness, controls, G2/G3, or production mutations.

The conceptual decision table is sound, but this missing detail prevents direct execution authorization. The probe also cannot by itself establish a general calibration rule: even a mechanism match on this fixture would still require independent-model evidence or an explicit design decision before CAL-A.

## 8. Closeout and authorization disposition

The current G1 activity should close as verified `PARTIAL` now. The governing G1 exit criterion permits every F1–F8 item to be recorded as verified, failed, or not-evidenced; F7 is validly `NOT_EVIDENCED`. Keeping the completed run open does not create additional evidence.

The read-only probe is a justified optional next research step only if the owner wants to pursue the mechanism needed to unblock F7-dependent G2/G3 work. It is not required for truthful G1 closeout, is not guaranteed to produce a calibration rule, and needs two separate future gates: first the bounded probe definition/implementation and review, then explicit authorization for one live execution.

No probe, rerun, calibration-rule change, harness change, G2/G3, host H1/H2, OQ-1, host integration, production change, commit, or push is authorized by this review.

## Final disposition

- **CAL-B:** accepted.
- **Defensible calibration rule:** none from current evidence.
- **358 exclusions:** retain under the existing contract; scored denominator is technically 899, with 358 explicit exclusions. No owner decision is needed unless that contract is changed.
- **Probe:** technically justified for mechanism research, but not execution-ready and not sufficient alone for general calibration.
- **Recommended stop decision:** close G1 now as verified `PARTIAL`; treat any probe as a separate optional research activity.

**Exact next owner decision:** accept G1 closeout as verified `PARTIAL` (recommended), or authorize a bounded probe-definition/implementation task that resolves M2 and returns for independent review. A live probe remains a separate later authorization either way.
