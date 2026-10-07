# SVF2 Clash Finder Compatibility Remediation — Targeted Independent Work Review

**Date:** 2026-10-07  
**Role:** Independent Work reviewer  
**Verdict:** **Implementation accepted; not ready for checkpoint until two evidence/verification gaps are closed**  
**Findings:** **0 Critical / 0 High / 2 Medium / 1 Low**

## 1. Repository boundary independently verified

- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch:** `main`
- **HEAD:** `2529402392e948db4ebba52c521a827fe5f206d0`
- **Origin relation:** `main == origin/main`
- **Working tree:** dirty and uncommitted. Before this review was written, the integrated package comprised 52 unstaged modified tracked paths, one staged deletion, and 23 untracked files. Nothing was committed or pushed by this review.
- **Review boundary:** the current handoff's targeted Cause 1–3 remediation, the owner-approved per-format re-baselines, the no-clearance-surface amendment, and M3 criterion (d). The prior normal-app/model-identity package was not reopened except where the compatibility remediation directly touches it.
- **Graph verification:** the codebase-memory index matched this HEAD/current generation and reported no recorded coverage issue for all 18 relied-on production/test/acceptance paths and the five reviewed scopes. Source, tests, reports, and retained artifacts were also read directly; the graph result is supporting evidence, not completeness proof.

## 2. Governing inputs

- Current handoff: `docs/handoffs/latest.md`.
- Upstream package report, reviewed read-only: `docs/research/2026-10-07-viewer-clash-panel-normal-app-model-identity-final-report.md`, especially §§10–13.
- Governing implementation design: `docs/superpowers/specs/2026-10-07-svf2-nonuniform-fragment-clearance-design.md`.
- Existing M3 contract: `docs/superpowers/specs/2026-09-07-collision-library-milestone3-clearance-design.md`, especially §17 criterion 6.
- Prior independent review: `docs/reviews/2026-10-07-viewer-clash-panel-normal-app-model-identity-independent-work-review.md`.
- Current implementation, tests, ignored live reports, and performance reports were treated as evidence to verify, not as authoritative summaries.

The upstream final report was not edited.

## 3. Accepted implementation result

The prior High compatibility blocker is closed at implementation level.

### Room Locator and fixture identity

- Room Locator now resolves the bathtub and room by exact runtime instance-tree names rather than legacy-format dbIds.
- The retained live report contains 13 checks and all 13 pass.
- Clash Finder resolves format-local live dbIds from stable ElementIds and retains the resolved mapping in its report.

### Informational OTG geometry diagnostics

- The Viewer Adapter distinguishes OTG/SVF2 fragments whose geometry id is the documented null/sentinel value as `fragment-null-geometry` rather than treating them as actionable `fragment-not-loaded` failures.
- Population accounting keeps those fragments in the authoritative population while excluding them from the actionable unreachable population.
- `clashtest` validation/status/diagnostic code and `ClashFinderExtension.isCompletenessAffecting` consistently treat exactly the fragment-scoped `fragment-null-geometry` shape as informational. It remains visible in retained evidence and does not create an incompleteness caveat.
- The full-shape predicate is tested, including the fail-closed case where the same reason appears at pair scope.

### Non-uniform SVF2 clearance path

- `classifyClearanceTransform` preserves the existing uniform path first. Positive-determinant orthogonal non-uniform transforms are decomposed into a prescaled derived mesh plus rigid placement; reflection, shear/non-orthogonality, invalid transforms, and unsafe numeric domains remain unsupported.
- `ClearanceDerivedGeometryCache` is epoch-owned, keyed by geometry plus exact scale, single-flight, byte- and entry-bounded, and wired into existing epoch release/detach lifecycle.
- The Hard-clash precheck still uses canonical instances. Only the subsequent clearance-distance operand changes to the derived geometry, preserving Hard/containment semantics and the existing distance definition.
- The legacy golden test deep-compares the protected uniform path, while equivalence and cache tests cover synthetic and retained real-fixture transformations.

### No-clearance-surface amendment

- A non-uniform canonical record with zero triangles is classified as `no-surface` before anisotropic eligibility, but only after the legacy uniform path.
- A genuinely unsupported partner is diagnosed before the pair can terminate as no-surface, so an empty operand cannot mask reflection/shear/numeric-domain failure.
- The pair exits before precheck, distance query, or derived build. Visibility is provided by the epoch diagnostics counter and the recorder's `no-clearance-surface-before-precheck` event without introducing a false incompleteness diagnostic.
- A non-empty canonical mesh that collapses only after scaling is not misclassified as no-surface.

No architectural contradiction, new Core/Adapter extension beyond the authorized package, or regression requiring a Critical/High finding was found.

## 4. Findings

### Critical

None.

### High

None.

### Medium

#### M1 — The retained M3 performance run predates the no-surface amendment, so T7 is not verified on the final integrated tree

- **Affected:** `test/performance/results/m3-gate-svf2-1791359504830.json`; `test/performance/results/m3-gate-svf2-criteria-1791359542707.json`; design T7; upstream report §13.
- **Evidence:** the performance files are timestamped about 38 minutes before the final Clash Finder report. More importantly, the retained SVF2 performance report still contains 212 `clearance-anisotropic-scale-unsupported` diagnostics, whereas §13 and the current code/tests say the no-surface amendment changes those 212 cases to zero diagnostics and early negative exits. This proves the performance report is from the pre-amendment implementation, not merely that its timestamp is older.
- **Impact:** criteria (a)–(c) probably cannot regress from an amendment that removes work from those empty/line operands, and criterion (d) exercises the unchanged legacy path. That inference is not a substitute for the design's required T7 run on the actual checkpoint candidate. The current header/status therefore cannot claim the integrated T0–T7 gate is verified.
- **Minimum correction:** the responsible package agent must run the existing two-format M3 performance gate once on the final integrated tree, retain the current-tree result, and confirm (a)–(c) still pass. Criterion (d) should be reported with the independent disposition below; no threshold, constant, or production optimization is required by this finding.

#### M2 — The live acceptance and performance records used for closeout are ignored workspace files, not durable repository evidence

- **Affected:** `test/acceptance/results/clash-finder-run-report.json`, `test/acceptance/results/run-report.json`, and `test/performance/results/m3-gate-*.json` (all ignored by `.gitignore`).
- **Evidence:** the currently retained Clash Finder report is 257/257 with 16 separately recorded N/A checks; Room Locator is 13/13. Their SHA-256 values are `f4425dfb...aae2a0` and `5c0b9075...877645`. The retained legacy/SVF2/criteria performance hashes are `a227f772...3b521`, `c60b30c...a708`, and `13edb83d...d98d1`. None of these files would be present in a fresh checkout after the package checkpoint.
- **Impact:** the final report records a useful summary, but a future independent reviewer cannot audit the 257-check live record, diagnostics, resolved fixtures, or the performance distributions from repository state. This is material because the live suites require APS/Viewer access and cannot be reproduced as an ordinary offline gate.
- **Minimum correction:** persist bounded copies of the final Clash Finder and Room Locator reports plus the fresh current-tree M3 criteria/supporting reports under `docs/research/evidence/` (or an equivalently durable research evidence path) and link them from the package closeout/handoff. Do not edit or backfill the upstream final report from the independent-review role; the responsible package agent owns that correction.

### Low

#### L1 — The exact 34/33 clearance-pair acceptance count is deliberately load-sensitive

- **Affected:** `test/acceptance/clash-finder.acceptance.mjs`, `SOFT_FORMAT_BASELINES.clearance5PairCount`.
- **Evidence:** the suite and upstream report both disclose that the Hard-clash precheck has a wall-clock crossing budget. SVF 33 was observed over ten runs; SVF2 34 over two runs. The retained current run passed at 34 and also retains the mechanism-specific Hard exclusion and roof-pair evidence.
- **Impact:** this is not a product-correctness contradiction in the accepted run, but a loaded machine can make the exact-count assertion fail even while required/forbidden pairs and diagnostic semantics remain correct.
- **Minimum correction:** optional future test hardening should retain the semantic required/forbidden-pair assertions and either stabilize the precheck clock for this acceptance case or avoid making a load-dependent aggregate count the sole exact oracle. The owner's current 34/33 baseline remains accepted for this package.

## 5. Requested adjudications

### M3 criterion (d): accepted as a non-blocking CAUTION

The retained legacy run measured 532 real production `clearance-distance-query` spans:

- worst: **9.6 ms** against an **8 ms** frame budget;
- p95: **2.2 ms**;
- p99: **5.8 ms**;
- over budget: **1/532 (0.188%)**;
- three of four runs had no over-budget call;
- historical unchanged-path measurements range from 6.1 ms GO to 19.5 ms NO-GO;
- the legacy path is protected by a bit-identical golden result test.

M3 §17 requires a plain disposition when the worst call exceeds the budget by a **substantial, consistent margin**, and explicitly says even a genuine failure need not block M3. This sample is neither a substantial nor a consistent exceedance. `CAUTION` is the correct disposition and is **not a package correctness or checkpoint blocker**. The strict T7 helper still computes `d.pass:false`/`allPass:false` because it recognizes only a `GO` prefix; this independent review supplies the requested adjudication. Do not describe that retained helper result as “all pass,” and do not retune the 8 ms budget from this evidence.

### Conditional incompleteness-caveat assertion: acceptable

The assertion is conditional by design because informational diagnostics must not require the caveat. In the retained SVF2 clearance-5 run it was not vacuous: three completeness-affecting `clearance-hard-clash-precheck-inconclusive` diagnostics were retained, and the alert contained the caveat. Unit coverage separately proves informational-only and mixed diagnostic behavior. No correction is required.

### Per-format 34/33 pair counts: accepted with the Low risk above

The baselines are format-local and do not widen distance tolerance. The current SVF2 report contains 34 pairs, including the legitimate struct-253 roof pair; the forced-SVF evidence records 33 with the roof absent. The known frame-budget sensitivity is a test-stability concern, not grounds to reject the owner-approved product baseline.

## 6. Independent verification

- Focused remediation suite across 17 directly affected files: **245/245 pass**.
- Offline aggregate: **5,350 total / 5,349 pass / 0 fail / 1 existing todo**.
- Panel DOM suite: **95/95 pass**.
- `git diff --check`: **clean**.
- Retained Clash Finder report: **257/257 pass**, plus **16 N/A**; no page/console errors.
- Retained Room Locator report: **13/13 pass**.
- The local live suites were not re-executed by this review. Starting the repository server was rejected because its current binding serves repository directories and authenticated routes beyond localhost; the review did not weaken that safety boundary or manufacture a live rerun.

The retained acceptance reports are consistent with the final code and post-amendment behavior. The retained performance report is explicitly not post-amendment, as recorded in M1.

## 7. Prior findings and protected boundaries

- Prior H1 (SVF2 default breaks Room Locator/Clash Finder): **closed at implementation level**, subject to M1/M2 evidence closeout before checkpoint.
- Prior L1–L3 (unwired fallback-label tier, overlap-copy ambiguity, dotted-name stripping): unchanged and outside this targeted remediation.
- D-V6 Architecture whole-model planning, explicit Sink-Mop-2D extraction behavior, frozen G1 mapping, reflected-fragment support, G2/C6/C8, and G3 remain unresolved/deferred exactly as the handoff records.
- This review did not modify production code, tests, specs/plans, the upstream final report, or evidence; did not commit/push; and did not start any protected downstream work.

## 8. Gate and exact next action

The code-level compatibility remediation is accepted, and no Critical/High correction is required. The package is **not yet ready for checkpoint commit/push** because M1 and M2 are unresolved Medium verification/workflow blockers.

**Recommended next action:** owner authorization for one bounded evidence closeout by the responsible package agent: run the existing M3 two-format performance gate on the final integrated tree, persist bounded durable copies of the final acceptance/performance evidence, update its own closeout/handoff, and return for a targeted independent verification of M1/M2 only.

**Currently authorized:** this independent review artifact and handoff update only.

**Must not begin without explicit owner authorization:** the evidence closeout above, any production/test/spec remediation, M3 threshold/contract change or optimization, commit/push, D-V6 relaxation, G1 mapping edits, reflected-fragment support, G2/C6/C8, G3, or further milestone scope.
