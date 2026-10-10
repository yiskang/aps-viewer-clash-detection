# Clash Tests Manager Implementation-Plan Remediation — Independent Work Review

**Date:** 2026-10-10  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD:** `main` / `ea533997dc62543aac47c28628e095e62a7b90ea`  
**Origin relation:** `HEAD == origin/main`  
**Verdict:** **Revise the implementation plan once more before owner implementation authorization.**  
**Findings:** **0 Critical / 0 High / 1 Medium / 0 Low**

## Review boundary and repository state

This was the requested bounded re-review of the prior H1, H2, M1 and M2 findings and their directly resulting owner-gate changes. It did not reopen unrelated plan sections.

At review start, the working tree was dirty, uncommitted and unpushed with documentation only:

- modified: `docs/handoffs/latest.md`, `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`;
- untracked: the Clash Tests Manager plan, package reports, prior Work reviews and owner brief;
- no manager production or test implementation existed.

Reviewed artifacts:

- governing design: `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`, §26;
- remediated plan: `docs/superpowers/plans/2026-10-10-clash-tests-manager-implementation-plan.md`;
- upstream package report (read-only): `docs/research/2026-10-10-clash-tests-manager-implementation-plan-final-report.md`;
- prior independent review: `docs/reviews/2026-10-10-clash-tests-manager-implementation-plan-independent-work-review.md`;
- current implementation contracts in `clashpanel/core/**`, `clashpanel/ui/render/**`, `clashpanel/viewer/ViewerBridge.js`, and `wwwroot/extensions/clashPanelHost.js`.

No production, test, spec or implementation-plan text was modified by Work. The plan's proposed test code was not executed, as requested. Structural source checks used the repository's indexed code graph and direct source inspection; all relied-on current source paths had matching index metadata with no recorded coverage issue.

## Bounded finding adjudication

### H1 — closed: event-only model-left and same-key re-entry

The remediated design consumes `event.model`, resolves it once through the existing `catalog.keyOfModel` contract, and retains only the resulting string key in `m.departed` (`plan:1643`, `2145–2170`). `derivedOf` filters that key from the catalog view and makes `bindingFor(key)` return `null` (`2390–2410`). Therefore the model-left event itself changes readiness, model summaries and models-changed state even while both the catalog row and registry binding remain unchanged.

The departure state is not cleared by a notification that still lists the key. It is cleared only after an authoritative catalog notification observes the key absent; a later same-key catalog entry is then normal re-entry. The planned tests exercise:

- event-only departure with unchanged catalog and binding;
- catalog removal with and without a model-left event;
- same-key re-entry after observed removal in both event-before-removal and event-after-removal orders.

That ordering matches the actual host catalog: model keys survive for the same `Model` object, `list()` reflects `viewer.getAllModels()`, and MODEL_REMOVED/MODEL_ADDED notifications supply the absent-then-present sequence. A new loaded `Model` object receives a new key and correctly does not repair a record that references the old key. H1 and AC-M10 are closed at plan level; CTM-7 remains the later live timing/evidence gate, not a missing implementation prerequisite.

### H2 / G-A2 — closed, conditional on Task 1 landing first

The fourth additive seam is mechanically specified:

- `INTENT.TEST_LABEL_SCOPE {modelKeys}` updates controller-owned `c.labelScope`;
- the editor label resolver includes that scope in `knownModelKeys`;
- the manager computes the complete referenced-key union from draft model keys, element-map keys and summary model rows;
- manager rows and the editor therefore disambiguate over the same key set;
- invalidation and integration tests cover unloaded same-host-name models and record deletion/draft edits.

This resolves the original cross-view label identity contradiction. It does conflict with the current governing §26.2(d) text, which still says “Nothing else” after seams (a)–(c). The plan handles that conflict as the first task: one bounded §26.2(d) reconciliation plus a guard test, before implementation tasks consume seam (e). That is sufficient; a separate design/spec gate is not required because the owner selected the exact bounded seam, the edit records rather than redesigns the decision, and Task 1 already stops the sequence if the authority cannot be reconciled. G-A2 is fully decided and implementation-ready only after Task 1 passes.

### M1 — closed: total, exact, fail-closed draft validation

The planned `isLoadableDraft` is total and fail-closed: all inspection is inside `try/catch`, so throwing accessors or proxy traps return `false`. It requires the canonical draft's exact own-key sets, plain prototypes, frozen records/arrays, enumerable data properties, sorted-unique model keys and ids, non-empty id arrays, safe non-negative integers excluding `-0`, and canonical `elements` own-key ordering. `lastRun`, when present, has the exact canonical shape and the same revision as the draft (`plan:405–470`).

The tests explicitly cover missing/extra fields, malformed revisions, non-canonical ordering, `-0`, accessors, hostile proxies, zero mutation and zero notification on refusal. This closes the prior M1 verification gap.

### M2 — dispatch safety closed; ViewModel/UI contract remains incomplete

`FAULT_POLICY` is now an explicit exact classification over all 39 editor intents. The tests compare its keys to the complete `INTENT` vocabulary, restrict values to `allow|block`, pin the independent allow set, and exercise every intent while faulted. Unclassified intents fail closed. Viewer-mutating row selection, Prev/Next, Focus, Isolate, Markers and Back to All are blocked after terminal recovery failure. Entering fault also cancels the editor's pending confirmation, preventing a stale confirmation from escaping the terminal state.

That closes the original safety failure in dispatch. It does not yet close the user-facing fault contract.

## Medium finding

### M1 — Faulted Viewer controls remain visibly enabled while dispatch silently drops them

**Type:** implementation-plan completeness and product/interaction correctness  
**Affected plan:** Task 6 `lockedEditorVm` (`1600–1608`), Task 9 fault contract/tests (`2831–2840`, `2918–2970`), Task 11 `lockEditor` (`3933–3941`), P-15  
**Affected design:** §26.9 and §26.10  
**Current source contract:** `clashpanel/core/viewModel.js:477–495`, `clashpanel/ui/render/selected.js:38–70`, `clashpanel/ui/render/results.js:19–29,85–105`

`lockedEditorVm` disables only Run, New test and Use current selection. Task 11's DOM lock disables setup controls and the Run button. The existing editor ViewModel still reports a live selected clash's Focus, Isolate, Markers and Back to All actions enabled, and its results rows and Prev/Next controls remain interactive. The manager then drops their intents through `FAULT_POLICY`.

**Concrete failure mode:** after terminal recovery failure, the user can activate a visibly enabled Focus/Isolate/Markers/Back to All control, a result row, or Prev/Next and receive no state change, explanation or disabled reason. This contradicts §26.9's requirement that every editor run/edit action report `enabled:false` with the fault reason and §26.10's rule that disabled actions expose that reason. It also makes the headless ViewModel disagree with the enforced dispatch policy.

**Adjudication:** silently dropping these actions is not an acceptable final UI contract. Dispatch must remain fail-closed, but the same blocked state must be represented in the ViewModel/UI. This is a Medium plan blocker, not a need to reopen the architecture.

**Minimum correction:** extend the fault overlay and Task 11 rendering/tests so every user-facing action blocked by `FAULT_POLICY` is non-interactive and exposes the terminal-fault reason. At minimum this includes result-row selection, Prev/Next, Focus, Isolate, Markers and Back to All; Focus on select and the filter/group/page actions may remain available because their intents are allow-listed. Pin equivalence between the blocked user-facing intents and their ViewModel/DOM states so a future policy change cannot recreate the mismatch.

## Owner-gate verification

| Gate | Repository record | Re-review disposition |
|---|---|---|
| G-A1 | Three exact public-surface/scaffold enumerations may grow; behavioral editor assertions stay unchanged. | **Confirmed accepted.** |
| G-A2 | Owner selected fourth additive label-scope seam (e); Task 1 reconciles §26.2(d). | **Closed**, conditional only on Task 1 landing before implementation code. No separate spec gate. |
| G-A3 | One persistent manager-header live region; editor live region de-registered in managed mode. | **Confirmed accepted.** |
| G-PERF | Manager default-on; CTM-8 is mandatory before product/performance closeout; no scalability claim or record limit yet. | **Confirmed accepted.** |
| G-PD | CTM-3…CTM-6 defaults accepted: copy basis attestation, prompt only for unsaved held results, fresh test after deleting last, non-unique names allowed. | **Confirmed accepted.** |

The plan, upstream final report and handoff consistently record these decisions. No owner gate remains open in this bounded scope; the remaining blocker is the technical ViewModel/UI correction above.

## Verification and protected boundaries

- Verified branch/HEAD/origin and the docs-only working tree from disk.
- Inspected the exact H1 state machine, its planned tests, and actual host catalog/model-key behavior.
- Inspected seam (e), label-scope construction/invalidation, the current label resolver contract, Task 1 reconciliation and guard.
- Inspected the exact `isLoadableDraft` implementation and planned adversarial/canonical-shape cases.
- Inspected all 39 `FAULT_POLICY` entries, exhaustive tests, current selected-action ViewModel, result-row/navigation rendering, and planned fault overlay/DOM lock.
- Did not execute any proposed plan test code. No implementation evidence is claimed.
- Did not edit the read-only upstream final report. Its statement that M2 “passed” is incomplete because it covers dispatch safety but not the contradictory enabled ViewModel/UI state; this review is authoritative for that discrepancy.
- No Core, Viewer Adapter, collision, M4, G2/C6/C8/G3, CTM-7 or CTM-8 work was started.

## Readiness and authorization

The plan is **not yet ready for owner implementation authorization**. H1, H2/G-A2 and M1 are closed, and M2 is safe at dispatch, but the one Medium fault-state UI/ViewModel blocker must be corrected and targetedly re-reviewed.

**Exact next authorized action:** bounded implementation-plan remediation of the fault overlay/UI acceptance tests described above, plus the responsible package agent's corresponding final-report and handoff correction; then a targeted independent Work re-review of that correction only.

**Must not begin without explicit owner authorization:** implementation, execution of the plan's new tests as implementation evidence, production/test/spec changes, commit/push, CTM-7, CTM-8, or any protected Core/Adapter/collision/downstream milestone work.
