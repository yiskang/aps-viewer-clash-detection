# Clash Tests Manager — CTM-7 Scenario H headed revalidation Independent Work Review

**Date:** 2026-10-11  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD:** `main` / `85aee231289dab39b7d98a63c9f2067b57db01b6`  
**Origin relation:** `HEAD == origin/main`  
**Working tree:** uncommitted/unpushed Option B implementation/test/spec/plan package plus CTM-7 documentation and evidence; this review adds only this report and the handoff update  
**Governing decision:** F-1 Option B — hide is visibility-only while the same model key remains available; unload/binding loss remains unavailable; new-key reload does not rebind old tests  
**Governing artifacts:** spec §26.6 / AC-M10; implementation plan CTM-7 row; [accepted Option B remediation review](2026-10-11-clash-tests-manager-ctm-7-f1-option-b-remediation-independent-work-review.md)  
**Read-only upstream input:** [Scenario H headed revalidation final report](../research/2026-10-11-clash-tests-manager-ctm-7-scenario-h-headed-revalidation-final-report.md)  
**Evidence:** [`docs/research/evidence/2026-10-11-ctm-7-scenario-h-revalidation/`](../research/evidence/2026-10-11-ctm-7-scenario-h-revalidation/SCENARIO-LOG.md)  
**Verdict:** **INCONCLUSIVE — the retained post-fix evidence technically supports Option B, but the package continued after an owner-defined fail-closed stop. CTM-7 cannot close without an explicit owner disposition.**  
**Findings:** **0 Critical / 1 High / 0 Medium / 2 Low**

## Scope and method

This review independently read `CLAUDE.md`, the handoff, the owner authorization brief, spec §26.6/AC-M10, the CTM-7 plan row, the accepted Option B remediation and its review, the upstream Scenario H report, all retained structured evidence, the helper/schema/protocol/preflight sources, the manifest, console output and all nine PNGs. The upstream report and handoff were treated as navigation and claims, not proof.

The source path from ViewerBridge model-left events into `testsManager.onModelLeft` was checked through the codebase-memory graph and direct source. Coverage reported current metadata for the material production/preflight paths except a stale/nonexistent candidate label path, which was resolved by direct reads of `setupValidation.js`, `controller.js` and `viewModel.js`. No headed run, product/test/spec/plan change, upstream-report edit, CTM-8 work or L1–L8 remediation was performed.

## Repository and protected-scope verification

- `main` and `origin/main` both resolve to `85aee231289dab39b7d98a63c9f2067b57db01b6`; origin is `https://github.com/yiskang/aps-viewer-clash-detection.git`.
- Tracked changes remain limited to `clashpanel/core/testsManager.js`, `test/clashpanel/core/testsManager.core.test.mjs`, the governing spec, implementation plan and handoff. The Scenario H package itself added documentation/evidence only.
- `git diff --check` is clean.
- No Core, Viewer Adapter, collision, ViewerBridge, host, server, package or public-API production change was introduced by the revalidation package.
- The accepted implementation remains exactly the Option B mechanism: `removed` does not enter the departed set, normal invalidation runs immediately, and one microtask invalidation rereads the post-`hideModel` catalog state. Real unload remains fail-closed.

## Scenario H adjudication

| Step | Independent result | Basis |
| --- | --- | --- |
| H0 baseline | **PASS** | Manager list has two configured tests; Manager/editor/catalog/Viewer keys agree; both tests have completed summaries and setup-complete readiness. |
| H1 hide required Structure | **PASS** | Structure leaves `visibleModels` but remains in `models`, catalog and bindings. Both rows keep setup-complete readiness; neither status contains “Models changed”; the active editor remains ready and runnable. |
| H2 run while hidden | **PASS** | Test 1 completes with 2,277 results, full coverage, current freshness and the expected Architecture/Structure run models; Manager and editor counts/status agree and no Panel overlay remains. |
| H3 show same Structure | **PASS** | The same key returns visible with no retained unavailable/departed state; the captured Manager/editor state remains coherent. |
| H4 actual Mechanical unload | **PASS** | Mechanical disappears from Viewer/catalog; Test 2 becomes changed/not-loaded, editor validation blocks and Run is disabled; unrelated Test 1 remains runnable/completed. |
| H5 reload Mechanical as new key | **PASS** | New Viewer/catalog key `#4` is registered; Test 2 remains bound to old unavailable `#3`; Manager disambiguates the old key and no automatic rebind occurs. The editor copy limitation is Low L1 below, not a change to the availability/no-rebind semantic oracle. |
| H6 same-key re-entry after unload | **INCONCLUSIVE** | The current host reload path mints a new key. No real same-key-after-unload product path was available and none was invented. |

**Behavioral evidence total:** **6 PASS / 0 FAIL / 1 INCONCLUSIVE / 0 N/A.** The evidence supports the narrow product conclusion that Option B removes the stable hide-only Manager/editor contradiction while preserving unload and new-key unavailability. It does not make the package owner-authorized after the mandatory preflight stop; therefore the authoritative package verdict remains **INCONCLUSIVE**, not PASS.

## High finding

### H1 — the package continued after the authorization's mandatory fail-closed stop

The owner authorization is explicit: if any required preflight item fails, stop the run, persist failure evidence, do not continue into mutation, mark the package INCONCLUSIVE and return to owner decision. The first preflight invocation crashed while establishing required runtime identity because `Autodesk.Viewing.getVersion` does not exist in Viewer 7.124.2. That is a failure to complete a required preflight item, irrespective of whether its cause was the validation script rather than product code.

The agent then edited `preflight.js` and executed it three more times (one passed in-page but was lost, one passed and was inspected, and one retained pass), then performed H mutations. The capture helper was unchanged and no product mutation occurred before the retained pass, so the later evidence is technically useful. But the authorization did not grant an evidence-script repair-and-retry exception; it required a stop and owner decision. The continuation was therefore an **authorization/workflow defect and evidence-authority defect**, not a product defect.

**Concrete consequence:** Work cannot convert the later technically sound evidence into an authorized CTM-7 closeout on its own. The first crash consumed the package's fail-closed decision point even though it did not exercise the product mutation sequence.

**Minimum correction:** the owner must explicitly choose one of two dispositions before H/CTM-7 can be accepted:

1. ratify the retained post-fix preflight and H evidence despite the disclosed process deviation; or
2. reject it for gate purposes and authorize one fresh bounded Scenario H execution using the retained final preflight unchanged.

No rerun, script edit or product change is self-authorized by this review.

## Low findings

### L1 — H5 editor validation copy is ambiguous after same-name new-key reload

After Mechanical reloads as key `#4`, the Manager correctly identifies old key `#3` as not loaded, while editor validation says only `Model Audubon_Mechanical_clash_test is not registered.` The same visible name is now registered under `#4`, so the sentence is ambiguous even though the editor correctly blocks the old-key test.

Direct source shows why: `setupValidation.js` formats this finding through `catalog.displayNameFor(key)` rather than the editor's shared `labels.js` disambiguated name. The finding does not change identity, readiness, no-rebind behavior or H5's semantic result, and AC-M11's explicit requirement governs Manager Set A/B summaries. It is therefore a non-blocking product-copy debt, not a CTM-7 correctness blocker and not one of the previously catalogued L1–L8 items.

**Minimum future correction:** if the owner later authorizes copy/accessibility debt work, route unavailable-model validation through the same disambiguated label for the referenced key or append the short key suffix. Do not remediate it inside this gate.

### L2 — the retained protocol is historically stale and is not the actual run log

The hashed `PROTOCOL.md` still states that the package did not run, describes a future execution, uses different H numbering/order, and asks for a Soft Test 2. The actual run used Hard Test 2 and is truthfully recorded in `SCENARIO-LOG.md` and the final report. The helper/schema/protocol hashes match the evidence-support copies, so provenance is intact; the problem is role clarity, not hidden evidence mutation.

The manifest and final report make the actual sequence reconstructable, so this does not invalidate the captures. The responsible package should, in a future authorized documentation correction, label this file explicitly as the pre-run planned protocol and identify `SCENARIO-LOG.md` as the executed protocol/deviation record. Work preserved the upstream artifacts unchanged.

## Preflight quality and prior Medium M1

The retained final preflight is sufficiently fail-closed for the Scenario H claims, apart from the authorization defect above:

- 19 checks assert live values: Viewer/runtime, host/panel/controller, two Manager records, active editor, three catalog/setup models, exact test names, non-null status/readiness/Run fields, cross-carrier keys/names, nine DOM selectors, overlay storage, public method signatures/model objects and capture stability.
- Checks 5c and 6 are declarative rather than executable; the report correctly discloses that. The reason-row selector was never present live, but this does not make the F-1 result vacuous: H1/H2 assert the same prohibited state through Manager `status`, `readiness`, editor validation and catalog/binding state, while H4/H5 provide positive unavailable controls through those fields.
- The weak `showModel`/`unloadModel` signature checks were followed by successful real calls with retained postconditions. No missing command surface silently became PASS.
- All 16 captures have `problems:[]`, `settle.stable:true`, `settle.timedOut:false`; the smoke and four repeated preflight captures are distinguishable from the 11 scenario captures.

Accordingly, the prior remediation review's **technical** M1 (vacuous helper assumptions) is closed by the retained final preflight and positive controls. It does not cure High H1's violated stop rule.

## Transient-state adjudication

The Mechanical hide/show experiment retained a DOM intermediate for about 2.1 ms, with the changed/not-loaded flag present in one MutationObserver sample and absent in all 208 animation-frame samples. This matches the accepted implementation's known sequence: immediate invalidation observes Viewer removal; the microtask invalidation observes the same key silently re-listed.

The evidence proves only that this Mechanical/Test 2 intermediate was not sampled on a paint frame. It does **not** prove universal invisibility, does not measure the original H1 Structure/active-test transition, and does not establish screen-reader behavior because the live-region text was excluded. The governing Option B reconciliation permits this internal transient and requires the stable post-call state not to remain wrong; every settled capture satisfies that rule. No product blocker is established. Any stronger no-intermediate-DOM or assistive-technology requirement would be a new product/accessibility gate requiring owner authorization.

## Evidence and visual integrity

- `MANIFEST.sha256` contains 18 covered artifacts and verifies **18/18 OK**; the manifest itself is intentionally excluded. The helper/schema/protocol are byte-identical to the retained evidence-support copies.
- The manifest was created after an earlier report draft had claimed it existed. The final manifest predates the final report timestamp, all hashes verify, and the upstream report explicitly discloses the chronology. This was a corrected workflow defect, not a remaining trust blocker.
- All nine PNGs were independently inspected. They agree with the structured captures: baseline; hide with stable readiness; runnable hidden-model editor; 2,277/full hidden-model run; coherent Manager; restored visibility; unload-only unavailability; disabled editor Run; and old-key/new-key separation.
- `state-H.json` retains the 16 captures, 16/16 acceptance table, H3 observed strings and rAF experiment. The cited captures are settled and problem-free.
- Console evidence records zero errors and one known `Model#getInstanceTree` deprecation warning. Runtime identity records Viewer 7.124.2, Chrome 155 and the model/key transition. The JSON is the authority for hidden state; screenshots are not used alone for it.
- The exact actual command/deviation chronology is retained in `SCENARIO-LOG.md`. The empty gap is the unpersisted result from the second preflight execution, which is disclosed and does not support any cited product claim.

## Readiness and authorization

**CTM-7 cannot close from this review.** Technical product evidence is adequate for H0–H5 and H6 is truthfully inconclusive, but the package is not gate-valid until the owner explicitly dispositions High H1.

**Exact next authorized action:** none beyond this review/handoff update. The **next owner gate** is an explicit decision to either accept/ratify the retained post-fix H evidence or reject it and authorize one fresh bounded H run. If the owner ratifies it, Scenario H needs no technical rerun for confidence and CTM-7 may proceed to its owner closeout/checkpoint decision with D and J still recorded as prior INCONCLUSIVE coverage. If the owner does not ratify it, a new run requires a separate exact authorization.

**Must not begin without explicit authorization:** another headed H run or preflight; evidence/helper correction; H5 copy remediation; CTM-7 closeout/commit/push; CTM-8; L1–L8; product/test/spec/plan changes; persistence/history/background work; resize/separate-panel work; Core/Viewer Adapter/collision changes; G2/C6/C8/G3/R20-1; or another package/milestone.
