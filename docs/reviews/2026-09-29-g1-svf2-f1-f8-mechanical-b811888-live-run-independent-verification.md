# Independent verification — Mechanical G1 F1–F8 live run at `b811888`

**Date:** 2026-09-29  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Reviewed branch / HEAD:** `main` @ `b811888ebc7be76163b99d730ce9ed66fe63a2cf`  
**Fixture:** `Audubon_Mechanical_clash_test.rvt`  
**Independent verdict:** retained live evidence is valid; recorded overall `PARTIAL` and exit code `3` are mechanically correct. G1 is not an overall PASS because F7 remains `NOT_EVIDENCED` at the accepted calibration gate.

## Finding summary

| Severity | Count | Disposition |
| --- | ---: | --- |
| Critical | 0 | None |
| High | 0 | None |
| Medium | 0 | None |
| Low | 0 | None |

No harness defect, production defect, cleanup defect, or evidence-integrity defect was established by this review. The F7 calibration gate is an explicit unresolved decision/evidence prerequisite, not a review finding against this run.

## Sources and method

This review used the repository and retained artifacts directly:

- [`docs/research/2026-09-29-g1-svf2-f1-f8-mechanical-b811888-live-run-report.md`](../research/2026-09-29-g1-svf2-f1-f8-mechanical-b811888-live-run-report.md)
- [`docs/research/evidence/2026-09-29-g1-svf2-f1-f8-mechanical-b811888-live-run-result.json`](../research/evidence/2026-09-29-g1-svf2-f1-f8-mechanical-b811888-live-run-result.json)
- [`docs/research/evidence/2026-09-29-g1-svf2-f1-f8-mechanical-b811888-live-run.log.txt`](../research/evidence/2026-09-29-g1-svf2-f1-f8-mechanical-b811888-live-run.log.txt)
- [`test/acceptance/g1-svf2-f1-f8-verification.mjs`](../../test/acceptance/g1-svf2-f1-f8-verification.mjs), including `computeOverall`, `scoreF7`, `validateResultSchema`, cleanup guards, and exit-code mapping
- [`docs/research/2026-09-27-g1-svf2-f1-f8-harness-build-plan.md`](../research/2026-09-27-g1-svf2-f1-f8-harness-build-plan.md), especially the accepted F7 bracket/calibration contract

The JSON parses and passes the harness's current `validateResultSchema` with zero errors. Re-projecting the recorded check verdicts and controls through the committed `computeOverall` returns `PARTIAL`; projecting that verdict through `exitCodeForVerdict` returns `3`. The authoritative JSON SHA-256 at review time is `627c3585dbcd94b23e590ed930426914c3eb60ae1ae10b9a5a29e2980ec6a573`.

## 1. Execution envelope and attempt accounting

The retained JSON establishes this runtime envelope:

| Item | Verified value |
| --- | --- |
| Viewer | `7.124.2`; Viewer script capture status `200`; decoded bytes `10,948,159`; expected and captured SHA-256 both `12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e`; integrity `VERIFIED` |
| Browser/runtime | Chromium `151.0.7922.34`; Playwright `1.62.1`; Node `v22.23.1` |
| Fixture | Mechanical URN `dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fTWVjaGFuaWNhbF9jbGFzaF90ZXN0LnJ2dA` |
| Initializer | `env: AutodeskProduction2`; `api: streamingV2` |
| Format signals | `isOTG() === true`; `isSVF2() === true`; classifier `CONFIRMED_SVF2` |
| Code identity | `main` @ `b811888ebc7be76163b99d730ce9ed66fe63a2cf`; harness SHA-256 `08afa7e236c5787362252db52f30dc03d0df55bbc9ed0fff311227ef6c1de87f` |

The retained timestamps cover one completed harness record (`2026-09-29T14:28:37.765Z` through `2026-09-29T14:28:45.791Z`). The repository contains one Mechanical-`b811888` result/report/log set, and the report records one invocation with no retry. No second result or retry evidence exists on disk. Repository evidence therefore supports exactly one consumed live authorization. As with any disk-only audit, it cannot prove the absence of an execution whose artifacts were never retained, but there is no repository evidence of one.

## 2. Overall verdict recomputation

Recorded outcomes are F1–F6 `PASS`, F7 `NOT_EVIDENCED`, and F8 `PASS`. All nine mandatory controls are `DETECTED_RESTORED`; Viewer identity is `VERIFIED`; the fatal ledger is empty; `sessionTainted` is false; `cleanupFailures` is empty; and `cleanupUnresolvedOwnership` is false.

Under the committed verdict precedence:

1. No fatal, identity, or unresolved-cleanup condition forces `FAIL`.
2. The classifier is confirmed SVF2, so the run is not `BLOCKED`.
3. No Fi is `FAIL`, and no mandatory control is un-restored or invalid.
4. Overall `PASS` is unavailable because F7 is not `PASS`.
5. The default incomplete-evidence branch therefore returns `PARTIAL`; its CLI mapping is exit code `3`.

The recorded `PARTIAL` is mechanically correct and is caused solely by F7's calibration-gated result.

## 3. F1–F6 and F8 verification

| Check | Independent disposition | Evidence |
| --- | --- | --- |
| F1 | `PASS` supported | 1,496 population rows; 1,257 roots compared; adapter and recomputed population digests both `sha256:f1d1a9c868c9a93bb7e0153eec4f72de255d220fa22b2d2440afbc6ae80f6484`; zero ownership, size, subtree, or oracle errors; digest rows retain `fragId`, `ownerDbId`, and `geometryId`. |
| F2 | `PASS` supported | 1,496 tree-reachable/Class-L fragments; Class-N/Class-U/loaded-but-unreachable all zero; 1,496 frag-list count; balanced accounting; maximum children per node 262. |
| F3 | `PASS` supported | Model-added observed before settlement; object tree, instance tree, and load-done were false at invocation and true at settlement; `resolveRoots` resolved. |
| F4 | `PASS` supported | Real modules for `adaptViewerGeometry` and `compactAndWeld` are present as functions. The retained real chain covers 438 distinct geometries with 438 consumer successes and zero render-proxy, adaptation, consumer, exception, or non-finite failures. Maximum active triangles: 4,228. |
| F5 | `PASS` supported | All five existing-limit comparisons pass: 1,496/20,000 instances; 2/5,000 fragments per dbId; 2/5,000 fragments per root; 262/10,000 children; 4,228/12,000 sync triangles. Enumeration is complete; no limit changed. |
| F6 | `PASS` supported | Initial unload fired; binding cleared; re-registration succeeded; late old-model unload did not disturb the replacement binding; replacement remained live; reload reconfirmed SVF2 and readiness; unregister-before-evict ordering is retained. |
| F8 | `PASS` supported | 1,257 roots and 1,496 fragments/tree relationships censused; zero ownership or tree divergences; all population equations close. |

No independent evidence-quality defect was found in F1–F6 or F8. Their conclusions remain limited to the retained Mechanical/Viewer/runtime envelope and do not establish G2, G3, host integration, or universal Viewer behavior.

## 4. F7 adjudication

### Oracle behavior

The F7 oracle is functioning according to the accepted plan:

- Its deterministic census covers all 1,257 F1 roots, with mutually exclusive outcomes totaling 1,257: 873 `agrees`, 26 `exceeds-envelope`, and 358 `no-reference-geometry`.
- It retains full residual records for the 899 roots that have a computable reference, the per-root bounds classifications, scale/tolerance data, unit metadata (`ft`, `0.3048`), identity placement, and zero non-finite-axis/transformed-vertex errors.
- No `disagrees`, `viewerApiNull`, implausible unit/visibility result, placement-inversion failure, or non-finite scale condition occurred.
- Both F7 sensitivity controls (`invalid-bounds` and `bounds-beyond-tolerance`) are `DETECTED_RESTORED`, proving that the non-finite path and a finite supra-`T_gross` displacement are detectable.

### Why the result is `NOT_EVIDENCED`

The 26 `exceeds-envelope` rows are not a proven technical defect. They mean the Viewer box contains the active rendered geometry within the accepted containment allowance but extends beyond the harness's conservative computed envelope by more than provisional `T_pass`. The accepted plan deliberately treats this state as a calibration-policy/evidence gap because undocumented Viewer padding or opaque `getNodeBox` behavior may be legitimate. `scoreF7` therefore returns `NOT_EVIDENCED`, exactly as designed.

The 358 `no-reference-geometry` rows are explicit, counted exclusions rather than silent losses. The evidence records 594 skipped fragments, all with reason `no-active-triangles`; 358 roots consequently have no valid active reference geometry. The accepted F7 contract excludes such roots from the bounds comparison. This limits direct bounds-oracle coverage to 899 roots, but it is not a coverage failure under the reviewed gate and does not affect F1/F2/F8 population accounting.

### What remains before F7 can pass

F7 cannot be converted to PASS by interpreting or tuning thresholds against this same run. Before F7 can pass, the owner must authorize and accept an independent calibration disposition that:

1. establishes, from evidence independent of this run's threshold selection, whether the 26 envelope excesses are legitimate Viewer 7.124.2 conservatism/padding or indicate a bounds defect;
2. freezes the accepted envelope-excess/PASS policy for the tested SVF2/runtime scope without weakening the already-closed `T_gross` failure rule; and
3. determines whether the existing explicit `no-reference-geometry` exclusion remains sufficient (the current design says yes) or whether separate geometry-coverage research is desired.

No harness fix is currently required. A future harness or calibration-rule change would require separate authorization, review, and evidence; this review authorizes none.

## 5. Mandatory controls

All nine mandatory controls have `executed:true`, `detected:true`, and state `DETECTED_RESTORED`. The seven shared-state controls have `restorationRequired:true` and `restored:true`; the two isolated synthetic controls correctly use non-interference semantics (`restorationRequired:false`) while still recording `restored:true`.

The target-bearing controls are non-vacuous and auditable:

- `wrong-owner`: selected fragment 0 from the authoritative F1 population, real owner dbId 153, injected owner 2,147,483,647, deterministic numeric-minimum rule, population 1,496.
- `hidden-fragment`: selected/acted-on fragment 0, tree owner dbId 153, deterministic intersection of F2 ownership with F1 Class-L population, population 1,496.

The remaining controls exercise their reviewed defects: tree unavailable, late completion quarantine, invalid geometry consumer, synthetic capacity breach, invalid bounds, finite bounds beyond tolerance, and stale old-model event. No control is `NOT_EXECUTABLE`, timed out, missing target evidence, or left unrestored.

## 6. Cleanup and skipped steps

Cleanup is clean: `cleanupFailures: []`, `cleanupUnresolvedOwnership:false`, `sessionTainted:false`, no stale continuation, and the final Viewer model-set postcondition passed. Page, context, browser, HTTP-server ownership, and evidence writing all completed.

The recorded skips match cleanup guards rather than missing accounting:

- owned timers and abort controllers had nothing outstanding;
- F3/F6 listeners and F6 wiring had already been removed/disposed by their normal phase cleanup;
- no active control lease or unrestored patch remained;
- after F6, `session.model` and `session.f6.modelAfter` refer to the same reloaded model, so the first unload/evict action removes it and the alias's later guarded action legitimately skips;
- no engine is constructed by this G1 harness, so `disposeEngine` is intentionally unreachable.

Registry unregister steps, world disposal, final empty-model verification, and all Node-owned closes ran. The skips do not indicate unresolved ownership.

## 7. Evidence integrity and scope

The JSON is the authoritative complete machine-readable record and passes its committed schema. It contains required runtime versions, fixture/initializer/format signals, code and Viewer-script identity, complete check/control verdicts, target evidence, error ledger, cleanup ledger, and timestamps. The zero-byte raw log is acceptable: this successful harness path writes evidence to JSON and emits no required stdout/stderr payload. The Markdown report faithfully summarizes the JSON and links both raw artifacts.

The working tree contains only the authorization prompt, live report/evidence, handoff update, and this independent review. No harness or production implementation diff exists after `b811888`. No evidence of a retry, production fix, G2/G3, host H1/H2, OQ-1, host integration, Core, Viewer Adapter, M4, or Panel production work was found.

The live authorization is consumed. No remediation, calibration change, rerun, downstream gate, commit, or push is authorized by this review.

## Final disposition

- **Live evidence:** valid within the retained Mechanical / Viewer 7.124.2 / Chromium 151 / Playwright 1.62.1 / Node 22.23.1 envelope.
- **Overall:** independently verified `PARTIAL`; exit mapping `3`.
- **F1–F6 and F8:** accepted for this envelope; no separate evidence defect found.
- **F7:** correctly `NOT_EVIDENCED`; 26 calibration-gated envelope excesses require an independent owner-approved calibration disposition; 358 no-reference roots are explicit accepted exclusions.
- **Closeout readiness:** the report, JSON, empty log, this review, and handoff are ready to commit as documentation/evidence. No harness fix is required first.

**Exact next owner decision:** decide whether to authorize a bounded, independent F7 calibration study/disposition for the 26 `exceeds-envelope` cases (without tuning against or rerunning this same evidence), or close G1 with the retained `PARTIAL` result. Until that decision, no rerun or downstream gate is authorized.
