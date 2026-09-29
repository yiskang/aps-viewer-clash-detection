# G1 SVF2 Mechanical fixture — bounded independent verification

**Repository reviewed:** `main` @ `54d1c24869ebe4ac425050f12c66085834bf2c9c` (`origin/main` at the same commit).  
**Review boundary:** committed fixture-discovery/capacity-screening evidence only. No live F1–F8 execution, screening rerun, or production-code change was performed.

## Verdict

**0 Critical / 0 High / 1 Medium / 0 Low.** `Audubon_Mechanical_clash_test.rvt` is independently accepted as the next exactly-one G1 F1–F8 fixture under the current format and existing-capacity contract. `Audubon_Structure_clash_test.rvt` should remain the fallback. No additional fixture-specific blocker is established by the repository evidence.

The Medium finding is documentation-only: the committed handoff's latest section still described the screening as “uncommitted,” cited the pre-screening `030dc60` HEAD, and treated committing the evidence as a pending owner action. This did not affect the screening evidence or fixture decision. The handoff was corrected as part of this review.

Acceptance here means **suitable for the next authorized G1 execution**, not proven to pass F1–F8. F3, F6, F7, F8 and mandatory controls were intentionally not run during screening; their results remain part of the future exactly-one live gate.

## Mechanical evidence verification

The committed result record for `Audubon_Mechanical_clash_test.rvt` establishes:

- Both load stages completed, `model.isLoadDone()` was reached, `isOTG() === true`, `isSVF2() === true`, and the accepted classifier returned `CONFIRMED_SVF2` with no capture error.
- Runtime envelope: Viewer `7.124.2`; Viewer script status `200` and SHA-256 equal to the harness's pinned digest; Chromium `151.0.7922.34`; Playwright `1.62.1`; Node `v22.23.1`; initializer `AutodeskProduction2` / `streamingV2`.
- F1/F2 screening observations: population `1,496`, roots `1,257`, tree-reachable/class-L `1,496`, class-N `0`, class-U `0`, loaded-but-unreachable `0`, and balanced accounting.
- F4 screening observation: `438` distinct geometries, all `438` consumer calls successful, zero render-proxy/adapter/weld failures, zero oversized geometries, and maximum active triangles `4,228`.
- Responsible-geometry evidence is retained: geometry id `2`, representative fragment id `1`, representative dbId `4593`, node `Round Duct [921809]`, one instance owned by dbId `4593`.

The `4,228` value uses the accepted harness semantics rather than a separate approximation. The screening script imports and executes the harness's actual `observeF4`; that function obtains `activeTriangleCount` from `adaptViewerGeometry`, passes the adapted view through the real browser-realm `compactAndWeld`, and retains the same per-geometry snapshot used by G1/F5. The screening-only argmax helper reads those retained snapshots; it does not recompute triangle counts.

## Existing-limit suitability

The script imports the harness's actual `scoreF5`, which reads the existing constants and applies the accepted strict-`>` breach rule (`observed <= limit` passes). Mechanical's committed five checks are:

| Check | Observed | Existing limit | Result |
| --- | ---: | ---: | --- |
| Collision instances/population | 1,496 | 20,000 | within |
| Fragments per dbId | 2 | 5,000 | within |
| Fragments per root | 2 | 5,000 | within |
| Children per node | 262 | 10,000 | within |
| Active triangles per geometry | **4,228** | **12,000** | **within** |

`scoreF5` returned PASS with `withinLimits:true`, `fullyEnumerated:true`, and `oversizedGeometryCount:0`. The screening commit changes only documentation/evidence files; it changes no constant, harness behavior, Core/Adapter/Panel code, initializer, model, or production path.

## Scope verification

- The screening script directly calls only the bounded load/classifier/shared-session/F1/F2/F4/F5-screening path. It does not call `runHarness` or `computeOverall`, does not set the live authorization environment variable, and does not pass the live execution flag.
- F3, F6, F7, F8 and every mandatory control are absent from the executed screening path. Therefore no full F1–F8 run occurred and the screening is not G1 verdict evidence.
- The manifest-listing script calls the existing object-list and manifest-GET functions. It never imports or calls upload, translation, retranslation, derivative-create, or delete functions. Its object listing returned 100 existing objects; the conditional bucket-create branch in `ensureBucketExists` is only reachable on a missing bucket and is inconsistent with this populated listing.
- Commit `54d1c24` contains only the handoff, screening report, result JSON, and the two retained scripts. It introduces no G2/G3, host H1/H2, OQ-1, host integration, Viewer Adapter/Core/M4/Panel, harness, limit, upload, translation, or model change.

## Candidate comparison

- **Mechanical — accepted primary:** 1,496 fragments / 1,257 roots; 4,228 maximum active triangles; all five checks within limits. It is the largest measured, non-trivial candidate and has the greatest triangle-limit headroom among the two preferred Audubon candidates.
- **Structure — accepted fallback:** confirmed SVF2/OTG; 543 fragments / 468 roots; 7,140 maximum active triangles; all five checks within limits. It is technically suitable but smaller and closer to the triangle ceiling than Mechanical.
- **Linked/main — technically suitable but not preferred:** both confirmed SVF2/OTG and within all measured limits, but their 8- and 9-fragment populations are too small to be the strongest first choice for calibration/control coverage.
- **RAC — unsuitable for an overall-PASS attempt under the current contract:** the retained accepted evidence remains `21,845 > 12,000`. Screening did not change or reinterpret that result.
- **Architecture — separate residual:** it is confirmed SVF2, but accepted F1 enumeration raised `EnumerationInconsistencyError` for `tree-reachable-fragment-unattributable` at fragment `4601` (class N), so capacity remained unmeasured and F5 BLOCKED. That model-specific residual does not invalidate Mechanical's independent balanced census or block selecting Mechanical.

## Evidence state and authorization

- Screening evidence is committed and the repository was clean at review start: `main`/`origin/main` @ `54d1c24`.
- The committed raw JSON is internally consistent with the report and passes direct assertions for the runtime envelope, Mechanical counts, responsible geometry/dbId, all five limits, Structure fallback, and RAC reference.
- The harness still points at the RAC URN. Selecting Mechanical does not itself authorize changing `MODEL_URN` or executing G1.
- **Current authorization:** none beyond this completed review. A harness fixture switch and a fresh exactly-one live F1–F8 execution each require explicit owner authorization. G2/G3, host H1/H2, OQ-1, host integration, limit changes, upload/retranslation, and production/Core/Adapter/M4/Panel work remain unauthorized.
