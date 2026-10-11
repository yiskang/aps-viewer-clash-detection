# Clash Tests Manager — CTM-7 headed SVF2 validation Independent Work Review

**Date:** 2026-10-11  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD:** `main` / `85aee231289dab39b7d98a63c9f2067b57db01b6`  
**Origin relation:** `HEAD == origin/main`  
**Working tree at review start:** tracked change only in `docs/handoffs/latest.md`; untracked CTM-7 prompt, upstream final report and evidence directory; no production, test, spec or plan diff  
**Governing contract:** Viewer Clash Panel design §26.5–§26.6, AC-M4 and AC-M10; Clash Tests Manager implementation-plan CTM-7 gate  
**Read-only upstream input:** `docs/research/2026-10-11-clash-tests-manager-ctm-7-headed-svf2-validation-final-report.md` (preserved unchanged)  
**Verdict:** **CTM-7 is not accepted for product closeout. Scenario H fails because the Manager and editor expose contradictory readiness for a hidden-but-runnable model.**  
**Findings:** **0 Critical / 1 High / 1 Medium / 1 Low**

## Scope and method

This review independently read `CLAUDE.md`, the handoff, the governing spec and plan, the accepted Manager implementation and UI-layout reviews, the upstream final report, the complete scenario log, runtime identity, console log, state A–I JSON, manifest and every retained screenshot. The handoff and upstream report were treated as navigation and claims, not proof. The upstream report remained read-only.

The 53-entry manifest verifies with zero hash failures. All 41 PNGs were opened and visually inspected. Structural source tracing used the codebase-memory graph and was verified against direct reads of `clashpanel/core/testsManager.js`, `clashpanel/core/setupValidation.js`, `clashpanel/core/controller.js`, `clashpanel/viewer/ViewerBridge.js` and `wwwroot/extensions/clashPanelHost.js`; coverage checking reported no recorded index gap for the relied-on paths. No live run or production/test mutation was performed by Work.

## Independent A–J adjudication

| ID | Verdict | Independent evidence assessment |
|---|---|---|
| A | **PASS** | CT-01…05 and state A establish create/configure, Hard/Soft copy, model labels and row readiness. Soft remains explicitly user-supplied and unverified; no verified-basis claim is made. |
| B | **PASS** | CT-06, CT-07, CT-14 and state B establish active ownership, inactive summary-only behavior and no visible cross-test result leakage. |
| C | **PASS** | CT-08…12 and CT-15 establish completed Hard and Soft runs, counts/status, held-result presentation and selection. Soft PASS is only for execution under the user-supplied unverified `ft` basis. |
| D | **INCONCLUSIVE** | CT-13, CT-16, CT-17 and state D establish teardown and absence of a spurious confirmation for saved results. They do not exercise the required held-unsaved confirm/cancel branch. |
| E | **PASS** | CT-18…20 and state E establish distinct duplicate identity, copied setup, reset run state and independent run/presentation. |
| F | **PASS** | CT-21…23 and state F establish active and inactive Reset behavior, retained setup and no visible result resurrection. |
| G | **PASS** | CT-35…40 and state G establish confirmation/cancel, inactive delete, active successor selection and fresh-record creation after deleting the last test. |
| H | **FAIL** | Hide/show and unload/reload observations are real, but CT-28/30/31 and state H prove a user-visible contract contradiction: the Manager says the active test is missing/changed while the editor says Ready and successfully runs the same 2,277-clash full-coverage test. A scenario whose purpose is row readiness after hide/unload/reload cannot PASS with contradictory readiness. |
| I | **PASS** | CT-41 and state I establish stable manager/editor round trips for identity, setup, summary and ownership. |
| J | **INCONCLUSIVE** | No headed fault/recovery path was exercised. Named automated suites are not headed CTM-7 evidence and were not rerun in this package. |

**Independent totals:** **7 PASS / 1 FAIL / 2 INCONCLUSIVE / 0 N/A.** The upstream total `8 PASS / 0 FAIL / 2 INCONCLUSIVE` is not accepted because H must be FAIL, not PASS-with-a-separate-finding.

## Findings

### High H1 — hidden-model readiness is contradictory, so CTM-7 H and product closeout fail

**Affected contract and code:** spec §26.6 and AC-M10; plan CTM-7; `clashpanel/core/testsManager.js:167–190,671–696`; `clashpanel/core/setupValidation.js:50–72`; `clashpanel/viewer/ViewerBridge.js:292–305`; `wwwroot/extensions/clashPanelHost.js:158–180`.

`viewer.hideModel(Structure)` fires `MODEL_REMOVED_EVENT`. `ViewerBridge` relays this as `{reason:'removed'}`, but the Manager ignores `reason`, records the still-catalogued key in `departed`, filters the key from its derived catalog and substitutes a null binding. It therefore renders “not loaded” and “Models changed since this run.” The editor's sole Run gate independently calls `catalog.list()` and `registry.bindingFor(key)` without the Manager's `departed` overlay. The hidden model remains catalogued and registered, so the editor stays Ready and the collision run completes with 2,277 clashes and full coverage.

The successful run proves that the current Core/Adapter computation remains executable for this hidden, registered model. It does **not** make the two simultaneous UI claims coherent and does not by itself decide whether product policy should permit the run. The defect is not merely wording: one surface says the required model is unavailable while another enables and completes the operation.

The upstream report is also internally inconsistent about causality: §6 says the cause was verified against source; §10 says “F-1 cause unconfirmed.” Direct source inspection confirms the mechanism above.

**Owner decision required:**

- **Option A — hidden/departed means unavailable.** Share the same scene-departure state with the editor Run gate, disable Run until same-key re-entry, preserve unload/new-key behavior, and reconcile spec/tests for active and inactive records.
- **Option B — hidden remains computationally runnable.** Do not make a `MODEL_REMOVED_EVENT`-only hide look missing to Manager readiness; continue treating actual unload/unregister and new-key reload as unavailable. Preserve the editor's current Run gate and existing presentation liveness/clear behavior.

**Recommendation:** **Option B** is the minimum-scope correction. It matches the observed successful computation, preserves the existing editor/Core/Adapter path, and can use the already-relayed event reason to distinguish the preceding unload signal from a removed-only hide. Option A requires widening the editor's readiness state to consume Manager-style departure information and disables a computation proven to work. This is a recommendation, not an owner decision.

**Minimum correction after owner authorization:** bounded §26.6/AC-M10 reconciliation; Manager/editor readiness implementation and tests for hide, show, actual unload and new-key reload; exact user copy; then headed H revalidation. CTM-8 must not begin before this decision and correction are closed.

### Medium M1 — exact Viewer-state claims are not independently reproducible from the retained evidence package

The JSON files retain overlay child counts, isolated/hidden-node counts, manager DOM fields and editor ViewModel fields, and their hashes are valid. However, the in-page `window.__cap`/`window.__snap` helper, schema and settle protocol were not retained. Screenshots independently corroborate visible isolation/presentation and clean post-switch/delete views, but they cannot mechanically establish exact overlay child counts or the meaning/timing of every JSON field.

This does not create evidence of a product defect, but it prevents unqualified acceptance of claims whose only exact proof is the capture helper's output. Before CTM-7 closeout, the next authorized headed evidence capture must retain and hash the capture source, field schema, settle conditions and command sequence. A bounded H revalidation may carry that correction; no full A–J rerun is authorized by this review.

### Low L1 — the upstream final report and handoff overstate H and use inconsistent F-1 status wording

The upstream report correctly exposes the raw contradiction but labels H PASS, calls F-1 “Low/Medium,” and records both verified and unconfirmed cause statements. The current handoff repeats the upstream totals. Per repository ownership rules, Work preserved the upstream report and records the corrected adjudication here and in the handoff. The responsible upstream package should reconcile its report only if the owner authorizes an upstream correction.

## Evidence and product observations

- Runtime evidence supports Viewer 7.124.2, headed Chrome 155, three SVF2/OTG Audubon models and the recorded model identities; the final identity record correctly reflects Mechanical reloaded as a new model/key.
- `console.log` contains zero errors and one expected `Model#getInstanceTree` deprecation warning.
- Public-console `hideModel`/`showModel`/`unloadModel` use is acceptable for this bounded lifecycle check because the normal Viewer UI exposes no per-model equivalent; it does not prove an end-user UI workflow.
- Scenario C does not establish a verified common measurement basis. It establishes only the accepted user-supplied, explicitly unverified Soft path.
- D's held-unsaved confirmation and J's terminal-fault/recovery behavior remain unevidenced headed. They are not silently converted to PASS.
- The 358-style G1/F7 calibration issue, CTM-8 performance calibration and deferred L1–L8 are outside this package and were not reopened.

## Protected boundaries and verification

- `main` and `origin/main` both resolve to `85aee231289dab39b7d98a63c9f2067b57db01b6`.
- Review-start tree changes are docs/evidence only; no production, test, spec or plan diff exists.
- Manifest: **53/53 OK**; screenshots visually reviewed: **41/41**.
- Scenario totals: **7 PASS / 1 FAIL / 2 INCONCLUSIVE / 0 N/A**.
- No live run, CTM-8, L1–L8 remediation, persistence/history/background-run work, Core/Adapter/collision work, G2/C6/C8/G3/R20-1 work, commit or push was performed.

## Gate and authorization state

**Readiness:** CTM-7 is **blocked**. The Manager/editor hidden-model invariant requires an explicit owner decision, a bounded correction and headed H revalidation. Exact capture-dependent claims also require a retained capture helper/schema/settle protocol in that future authorized evidence package.

**Exact next gate:** **owner decision on F-1: Option A (hidden/departed unavailable) or Option B (hidden remains runnable; recommended).** If the owner authorizes the resulting bounded remediation, it must be independently re-reviewed before one bounded H headed revalidation is authorized.

**Must not begin without explicit owner authorization:** F-1 spec/implementation/test remediation; H revalidation or any live/headed rerun; CTM-8; L1–L8; production/test/spec/plan changes; upstream-final-report correction; commit/push; persistence/history/background runs; Core/Viewer Adapter/collision; G2/C6/C8/G3/R20-1; or another package/milestone.
