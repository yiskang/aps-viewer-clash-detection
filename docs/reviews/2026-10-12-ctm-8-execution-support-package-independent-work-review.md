# CTM-8 Execution / Support-Code Package Independent Work Review

Date: 2026-10-12  
Scope: completed CTM-8 execution/support-code package only  
Verdict: **OWNER DECISION REQUIRED**  
Findings: **0 Critical / 0 High / 3 Medium / 2 Low**

## 1. Repository and review boundary

- Repository: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`.
- Branch: `main`.
- HEAD and `origin/main`: `ac5bcb42b00e668442ce3add9764cba96d883309`; ahead/behind `0/0`.
- Working tree: modified `docs/handoffs/latest.md`; untracked CTM-8 prompts, protocol/research/review/evidence artifacts, and `test/calibration/ctm8/`. No commit or push occurred.
- CTM-7 remains closed and the Addendum B checkpoint remains the shared HEAD. No later production package or unrelated CTM-8 package is present.
- Governing protocol: [`CTM8-P0-v4`](../research/2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md), SHA-256 `a6f7a61f1cae8b2aac7868277b67c26422537f88af3c27d908cbd054fc2634c3`.
- Upstream execution report, preserved read-only: [`2026-10-12-ctm-8-rebuild-cost-calibration-final-report.md`](../research/2026-10-12-ctm-8-rebuild-cost-calibration-final-report.md).
- Evidence root: [`docs/research/evidence/2026-10-12-ctm-8-rebuild-cost-calibration/`](../research/evidence/2026-10-12-ctm-8-rebuild-cost-calibration/).
- Support-code additions are exactly 18 new files under `test/calibration/ctm8/`. No tracked production module, existing test, shared test support, package file, Core/collision/Viewer Adapter/host path, Viewer theming/selection path, limit, or budget changed. Protected-path diff is empty; `git diff --check` passes.

The handoff was used only to locate artifacts. Repository, evidence and source were independently checked. Structural source claims were verified through the codebase knowledge graph and direct reads; coverage checks reported no recorded issue and matching metadata for every relied-on support/production source.

## 2. Support-code and protocol conformance

The non-production support package is within the authorized boundary and implements the accepted protocol:

- Enumeration produces 36 Family M plus 48 mandatory UNIFORM-only Family R cells per launch. SKEWED and `-PULL` are absent from the mandatory campaign.
- Family M records use deterministic names and exact model-reference patterns. The external subscriber is attached only after build, readiness predicates and untimed settling. M-BASE is a synchronous `t0 → catalog.fire() → getViewModel/predicate → t1` window with no `await`; M-REC includes the intended forwarded editor work; M-HIT is the fixed cached-read batch. Upper 5,000/10,000 cells were built and executed. Teardown attempts unsubscribe, manager disposal and controller disposal in order while retaining failures.
- Family R implements `NAME(modelKey, dbId)`, installs the non-production mC tree-name behavior on the same model object used by the harness/catalog/binding, and proves object/name/count/reference mappings before timing. Required three-model cells are genuine runs. R-GROUP-WARM keeps selected membership stable and verifies that no new `presentGroup()` call occurs in the timed comparator. R-COLD uses fresh harness generations and retains the exact index-commit sub-phase as unavailable.
- The cell runner separates the 120-second setup bound from the 30-second sample bound, implements the three-consecutive-failure cell abort, distinguishes shared/global failures, prevents timed-out work from silently becoming a valid result, and retains teardown/reset errors.

No timing-boundary correctness defect was found in M-BASE, M-REC, M-HIT, R-BASE, R-WARM, R-GROUP-WARM or R-COLD.

## 3. Mandatory campaign and evidence integrity

Independent reconciliation of the retained raw records matches the protocol exactly:

- 3 launches × 84 cells = **252 cell executions**; 84 distinct mandatory cells per launch and 252 distinct launch/cell pairs.
- **7,020 measured** plus **1,080 warm-up** operations = **8,100 total**; 2,700 per launch.
- 108 Family M and 144 Family R cell executions; all 252 cells are `COMPLETED`.
- All 8,100 operation records are `OK`; zero timeout, invalid, invalid-setup, setup-timeout, aborted, unavailable or global-failure records. No mandatory cell is silently absent.
- Launch/cell IDs, seeds, family/scenario/scale/model fields and per-launch statistics reconcile with the summaries. Per-launch medians remain authoritative and the median-of-launch-medians is calculated as specified.
- Root checksum manifest: **131/131 verified**. Headed checksum manifest: **106/106 verified**. The corrected n2-high headed count is transparently documented and remains reproducible from its retained transition evidence.

Verification results:

- Focused calibration suite: **118/118 pass**.
- `npm run test:offline`: **5,813 total / 5,812 pass / 0 fail / 1 pre-existing todo**.
- `git diff --check`: pass.
- `npm run test:clashpanel:dom` was not run. This is **not a finding**: the package adds Node calibration support and runtime-injected evidence instrumentation only, changes no renderer/DOM/production path, and the actual headed package supplies the relevant real DOM/Viewer corroboration.

The initial sandboxed offline invocation could not create mutation-test temporary files or loopback listeners; the same canonical command was then run with the required local permissions and passed with the totals above. This was an execution-environment restriction, not a repository failure.

## 4. Headed corroboration

### Family R

The headed evidence is valid within its recorded envelope: real Viewer 7.124.2, headed Chromium 155, three Audubon SVF2/OTG models, 1600×1000 viewport, and one coherent Viewer session. It retains nine real points, 216 operation samples (54 warm-up + 162 measured), all `OK`.

Produced and retained counts are equal and untruncated. The high points are evidence-backed at **4,770 / 2,277 / 3,488** for one/two/three-model sets. Requested 5,000 and 10,000 points are correctly labelled `NOT REACHABLE HEADED`; no synthetic population is presented as real Viewer evidence.

HV-1, HV-3 and HV-4 pass at all nine points. Screenshots and serialized state independently show group presentation, isolation and Back-to-all behavior. The HM-REC and HV-2 qualifications are findings below.

### HM-REC

All six points are honestly retained as `UNAVAILABLE`, with no fabricated timings or substitute predicate. The exact §9.3 oracle needs `manager.tests[k]`, `manager.count`, the active test identity and the manager list item while the editor is open. The existing extension surface exposes only the editor facade; the manager list is emptied in editor view, so its quiet/list predicate would be vacuous. Completing this exact oracle would require a protocol amendment plus bounded instrumentation access or a reviewed DOM-equivalent predicate.

Headless M-REC remains valid and answers the core rebuild-cost question at all planned record/model points, including forwarded editor work. The missing headed check is corroboration, not a defect in those headless measurements. Whether that is sufficient to close CTM-8 is an owner evidence-sufficiency decision (M1).

### HV-2 visual/state adjudication

The protocol requires Focus to produce a finite camera different from its pre-state. Retained state reports **0 PASS / 9 FAIL / 0 INCONCLUSIVE** under that literal predicate. Independent screenshot/state inspection shows the visible camera is already fitted by the preceding HV-1 group-selection step, and every HV-2 before/after camera pair is identical and finite.

For product adjudication the evidence is therefore **0 PASS / 0 product FAIL / 9 INCONCLUSIVE**: the check cannot distinguish a working idempotent Focus action from an action that did nothing. Aggregate group presentation otherwise remains correct and this evidence does not contradict Addendum B. Focus correctness remains unevidenced, not disproved (M2).

## 5. Performance interpretation

The evidence supports descriptive observations only:

- Family M M-BASE and M-REC rise materially with record count; M-HIT remains a near-zero cached-read control. A stable independent model-count effect is not established.
- Family R warm and cold timings, cold/warm deltas and selected-group deltas are retained per launch/cell. Selected-group overhead is generally small relative to ordinary spread, with isolated retained outliers.
- Launch 0 is at least 20% faster than both later launches in 13 of 36 Family M cells. Representative median shifts include M-BASE/1000/1 at about 13.05/23.20/22.41 ms and M-REC/10000/2 at about 731/1,208/1,175 ms. The separation often exceeds within-launch spread, but direction is not universal and the cause is not established.

Fixed independent launches and per-launch summaries keep the campaign interpretable as descriptive evidence. The shift prevents deriving a stable absolute budget, supported maximum or scalability guarantee from this package; none is claimed. A controlled refinement is needed only if the owner wants a performance limit, regression budget or causal attribution (M3).

## 6. Findings

### Critical: 0

### High: 0

### Medium: 3

#### M1 — HM-REC headed corroboration is unavailable; evidence sufficiency requires owner disposition

- **Affected artifact/scenario:** protocol §9.3 HM-REC; headed `results.json` and `blockers.md`; all six `5/25/100 × 1/3` points.
- **Failure mode:** the accepted semantic/list oracle cannot be reached through the allowed editor-only extension surface, and the list DOM is empty while the editor is open.
- **Evidence:** no records were created or timed; every point is explicitly `UNAVAILABLE`. Headless M-REC completed at all mandatory scales/models.
- **Impact:** core headless calibration remains valid, but the owner-selected real-browser manager-edit corroboration is absent. Checkpoint closeout cannot silently treat it as executed.
- **Minimum correction/options:** (A, recommended) explicitly accept HM-REC as non-blocking unavailable and close the calibration package on the complete headless M-REC evidence; or (B) authorize a separate bounded protocol/instrumentation refinement using the already identified manager-header/count DOM-equivalent or a narrowly reviewed test-only access route, followed by new headed evidence and review. Option B needs no production/public API change unless the owner separately chooses one.
- **Blocker status:** owner-decision blocker to checkpoint commit/push; not a technical remediation blocker.
- **Responsible upstream package:** CTM-8 execution/protocol owner gate.

#### M2 — HV-2 is non-discriminating because HV-1 already establishes the same camera

- **Affected artifact/scenario:** protocol §9.4 HV-2 and all nine headed point records/screenshots.
- **Failure mode:** HV-2 compares Focus against a pre-state already fitted by HV-1, so camera equality cannot establish either success or a product defect.
- **Evidence:** nine finite, byte-equivalent rounded before/after camera pairs; visual pairs show the already-focused view. HV-1/HV-3/HV-4 and aggregate presentation otherwise pass.
- **Impact:** Focus correctness is inconclusive at all nine points; Addendum B is not contradicted and no production fix is justified from this evidence.
- **Minimum correction/options:** (A, recommended for this calibration checkpoint) accept HV-2 as a documented non-blocking inconclusive residual; or (B) authorize a targeted correctness-only protocol/instrumentation correction that deliberately moves to a different finite camera after HV-1, then invokes Focus once and verifies the intended fit. Do not rerun performance cells.
- **Blocker status:** non-blocking if explicitly accepted at the owner checkpoint; otherwise a targeted evidence refinement is required.
- **Responsible upstream package:** CTM-8 headed verification procedure/support package.

#### M3 — Family M launch-level shift prevents stable absolute budget conclusions

- **Affected artifact/scenario:** Family M per-launch evidence and `anomalies.md`.
- **Failure mode:** many cells form distinct launch-level bands beyond their within-launch spread, while direction and magnitude vary and environment covariates are incomplete.
- **Evidence:** 13/36 cells meet the documented ≥20% launch-0 separation; representative shifts are retained above. There were no invalid samples or timeouts.
- **Impact:** the fixed three-launch campaign remains valid descriptive calibration, but not a basis for an absolute performance budget, supported maximum, regression threshold or cause claim.
- **Minimum correction/options:** (A, recommended) checkpoint the descriptive evidence and keep budgets/limits unauthorized; or (B) if a threshold/optimization decision is desired, authorize a separate controlled refinement with complete power/thermal/background-work metadata and additional independent launches.
- **Blocker status:** non-blocking for evidence checkpoint if no limit/budget is claimed; blocks any limit/budget/scalability claim.
- **Responsible upstream package:** future CTM-8 refinement, only if owner-authorized.

### Low: 2

#### L1 — HV-1 used an internal Viewer overlay registry read

- **Affected artifact/scenario:** HV-1 overlay absence evidence in headed point JSON/README.
- **Failure mode:** evidence used read-only `viewer.impl.overlayScenes`, while §9.1 describes public Viewer getters as the instrumentation boundary.
- **Evidence:** the deviation is disclosed and every retained overlay list is empty; no Viewer mutation or production edit occurred.
- **Impact:** the result is credible within the pinned Viewer runtime but methodologically narrower and more brittle than the stated public-getter boundary.
- **Minimum correction:** in any future headed refinement, either mark the overlay sub-check unavailable or explicitly review/amend the bounded evidence method; do not add a production seam solely for this.
- **Blocker status:** non-blocking.
- **Responsible upstream package:** future CTM-8 headed evidence refinement, if opened.

#### L2 — Headless environment metadata cannot explain the launch shift

- **Affected artifact/scenario:** `environment.json` and Family M launch-shift analysis.
- **Failure mode:** headless `powerSource` and `otherHeavyProcesses` are null; thermal state was not retained.
- **Evidence:** headed environment metadata is detailed, while the headless record lacks those covariates and `anomalies.md` notes incidental launch-0 overlap.
- **Impact:** no effect on raw timing validity, but causal attribution and controlled cross-launch comparison are limited.
- **Minimum correction:** capture these covariates before each launch in any authorized refinement.
- **Blocker status:** non-blocking.
- **Responsible upstream package:** future CTM-8 controlled refinement, if opened.

## 7. Owner decisions and checkpoint readiness

The support code, mandatory campaign, retained evidence and test results are technically acceptable. The package is **not yet ready to commit/push** because the evidence-sufficiency gate still belongs to the owner:

1. **HM-REC:** accept the complete headless M-REC result with headed HM-REC retained as unavailable (recommended), or authorize a separate bounded refinement.
2. **HV-2:** accept nine inconclusive product checks as a non-blocking protocol-sequencing residual (recommended), or authorize one targeted correctness-only refinement.
3. **Launch shift:** accept the package as descriptive evidence with no limits/budgets (recommended), or authorize controlled refinement before asking for such conclusions.
4. **Checkpoint:** only after those dispositions, authorize or decline a single checkpoint commit/push containing the reviewed support/evidence/docs package.

No production, Core, collision, Viewer Adapter, host, public API, Viewer theming/selection, persistence/history or limit change is required by any finding.

## 8. Exact next authorized action and protected work

- **Exact next gate:** owner disposition of HM-REC evidence sufficiency, HV-2 inconclusive evidence, and launch-shift interpretation; then a separate owner checkpoint commit/push decision.
- **Currently authorized:** this review and handoff update only.
- **Must not begin without explicit authorization:** support/evidence remediation, another calibration or headed run, refinement/instrumentation work, optimization, limits/budgets, production/test/protocol/spec/plan/upstream-report edits, CTM-7/Addendum B deferred work, another package, commit or push.

**Final verdict: OWNER DECISION REQUIRED.**
