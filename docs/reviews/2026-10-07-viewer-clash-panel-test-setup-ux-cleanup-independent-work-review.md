# Viewer Clash Panel Test Setup / Interaction UX Cleanup — Independent Work Review

**Date:** 2026-10-07  
**Role:** Independent Work visual/product reviewer  
**Verdict:** **Accepted for checkpoint with non-blocking Low findings**  
**Findings:** **0 Critical / 0 High / 0 Medium / 4 Low**

## 1. Repository state independently verified

- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch:** `main`
- **HEAD:** `060b7385d9ee9f8e73a857111fe8861a7daa83df`
- **Origin relation:** `main == origin/main`
- **Working tree before this review artifact/handoff update:** dirty and uncommitted: **25 modified tracked paths and 10 untracked paths**. The package implementation, tests, evidence, upstream report, internal review, workflow/governance edits, and prompts are present. Nothing was committed or pushed by this review.
- **Scope check:** the production diff is confined to Viewer Clash Panel core/rendering/CSS. No `collision/`, Viewer Adapter, M4, G2 procedure, authorization-record, C6/C8 research, or G3 implementation file is changed.
- **Graph verification:** the current index matched HEAD and recorded no coverage issue for the 16 relied-on production/test paths or the `clashpanel/core`, `clashpanel/ui`, and `test/clashpanel` scopes. Source and tests were also read directly; the graph signal is supporting evidence, not completeness proof.

## 2. Governing and review inputs

- **Governing design:** `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`, especially the owner-decision addendum §23 and amended AC-P18.
- **Implementation plan:** `docs/superpowers/plans/2026-09-26-viewer-clash-panel-implementation-plan.md` (unchanged by this package).
- **Upstream package final report reviewed, read-only:** `docs/research/2026-10-07-viewer-clash-panel-test-setup-ux-cleanup-final-report.md`.
- **Visual evidence:** `docs/research/2026-10-07-viewer-clash-panel-test-setup-ux-cleanup/evidence-report.md` and all 24 PNG files in its `after/` directory.
- **Internal review:** `docs/reviews/2026-10-07-viewer-clash-panel-test-setup-ux-cleanup-internal-review.md`.
- **Handoff:** `docs/handoffs/latest.md`.

The handoff, upstream report, evidence classifications, and internal review were treated as inputs rather than proof. The upstream final report was not modified.

## 3. Verdict and readiness

The package is **ready for an owner-authorized checkpoint commit/push**. No Critical, High, or Medium issue remains. The implemented behavior is internally consistent with the accepted §23 owner decision and preserves the frozen architecture:

- `New test` is a neutral top-row action to the left of the setup disclosure in both expanded and collapsed states. It is disabled during an active run, and the controller independently refuses the action while active.
- Reset creates a new blank Hard test, drops basis attestation, clears sets/self-clash/clearance, retires panel-owned results, releases panel-owned Viewer state, clears filters/selection, and re-expands setup. The existing held-unsaved confirmation remains the only destructive-state exception.
- Soft stays selectable but Run fails closed until a current basis choice and positive finite clearance exist. Pending basis verification blocks. Participant-set changes and New test invalidate user attestation.
- `verified` remains restricted to a host-verified basis or the defined single-participant case. `user-supplied` and `raw-model-units` remain visibly unverified. No conversion is performed: the numeric clearance reaches Core unchanged, and the UI says so.
- Hard remains available and can be run without a Soft basis. Set A/B, Use selection, self-clash, readiness, run state, focus order, collapse behavior, and reset are covered by focused/core/DOM tests and current headed behavior.
- The five-region Viewer-native panel architecture remains intact. No collision, Viewer Adapter, Core/M4, host/OQ-1, G2/C6/C8, or G3 scope was introduced.

## 4. Findings

### Critical

None.

### High

None.

### Medium

None.

### Low

#### L1 — Clearance error text is visible but not programmatically associated with the input

- **Affected:** `clashpanel/ui/render/setup.js:75-89`; Soft invalid-clearance accessibility behavior.
- **Failure mode:** the clearance input sets `aria-invalid="true"`, but unlike the new Units selector it has no `aria-describedby` pointing to its visible error. A screen-reader user can discover that the field is invalid without a reliable programmatic relationship to the reason.
- **Evidence:** direct source inspection; headed accessibility state exposes the input and separate error text; DOM coverage asserts invalid state but not an error-description relationship.
- **Minimum correction:** give the clearance error a stable id, add conditional `aria-describedby` to the input, and add one DOM assertion. This is non-blocking because the label, visible error, keyboard access, and fail-closed Run state already work.

#### L2 — Stopped state still exposes raw internal status/reason wording

- **Affected:** `clashpanel/core/viewModel.js:248` and the Run Status presentation.
- **Failure mode:** the primary outcome correctly says `Stopped`, but the supporting diagnostic line still reads `Status: cancelled` and `Reason: cancel-requested`. This is technically accurate yet inconsistent with the product-facing wording cleanup and adds implementation vocabulary to the normal UI.
- **Evidence:** independently reproduced in the current headed demo after a Soft cancellation; retained screenshot 14 shows the same behavior.
- **Minimum correction:** map the secondary status/reason to product wording or move raw values behind copied/expanded diagnostics. Non-blocking.

#### L3 — `Max gap` label wraps awkwardly at narrow panel height/width combinations

- **Affected:** filter-row CSS in `wwwroot/main.css` and narrow stopped/completed layouts.
- **Failure mode:** `Max gap (≤ N)` can wrap, reducing scanability even though the control remains usable and the panel itself does not overflow.
- **Evidence:** retained screenshots 14 and 16, independently inspected at original resolution.
- **Minimum correction:** reserve label width or prevent wrapping while allowing the field to shrink. Non-blocking visual polish.

#### L4 — Upstream final report undercounts the current tracked working-tree inventory

- **Affected:** `docs/research/2026-10-07-viewer-clash-panel-test-setup-ux-cleanup-final-report.md` §1 (read-only review input).
- **Failure mode:** the report says 24 modified tracked files and 12 modified test files. Disk currently has 25 modified tracked files, including 13 modified existing test files. The current tree also has the later untracked governance prompt `docs/prompts/for-claude-harden-independent-review-consumption-and-ownership.md`, which post-dates the package inventory. Implementation, test, visual, and verdict claims are unaffected.
- **Evidence:** `git status --porcelain=v1` and direct path count at the reviewed HEAD.
- **Minimum upstream correction:** the responsible upstream package/agent should reconcile §1 to 25 modified tracked paths / 13 modified existing test paths and identify the later governance prompt as post-package workflow state if exact current-tree inventory is intended. The independent reviewer must not edit that report. This does not block checkpoint acceptance.

## 5. Visual adjudication

All 24 retained PNGs were inspected independently at original resolution. Three are detail crops and are not separate scenarios. The 21 scenario images adjudicate as:

- **PASS: 19**
- **FAIL: 0**
- **INCONCLUSIVE: 2**

The two inconclusive cases are correctly bounded:

1. **08 Soft results:** the live Soft path completes with zero reportable clashes because the fixture produces the documented anisotropic-scale caveat. It cannot prove a non-empty Soft result-list presentation.
2. **19 New-test confirmation:** the demo host does not produce `held-unsaved`, so the confirmation path is not reachable headed; controller tests cover it.

The evidence supports the claimed placement, collapse summary, basis states, validation, readiness, Set A/B selection, self-clash, status states, 491-result Hard list, focus ring, and narrow panel behavior. No conflicting screenshot evidence was found. The page-level horizontal overflow near 700 px comes from the external host header, not the panel.

No owner screenshot escalation is required. Two product decisions remain owner-only but non-blocking: whether to surface the dominant Soft caveat in the panel, and whether to provide a uniform-scale fixture for a non-empty Soft demo.

## 6. Independent verification performed

### Repository and source

- Verified branch, HEAD, `origin/main`, dirty-tree inventory, diff scope, and `git diff --check`.
- Read the changed controller/draft/intents/validation/view-model/render/CSS paths and relevant tests.
- Traced `buildDefinition` → controller admission → `CollisionWorld.findClashes` plumbing. The accepted numeric clearance is passed unchanged; basis/provenance is admission metadata, not a conversion layer.
- Verified participant-key invalidation, pending-verdict handling, `verified` provenance constraints, active-run New-test refusal, and reset/release behavior.

### Automated tests

- Focused basis/controller/draft/validation/view-model/DOM set: **100/100 pass**.
- Panel DOM suite: **94/94 pass**.
- Full offline suite: **5,228 total / 5,227 pass / 0 fail / 1 existing todo**.
- `git diff --check`: clean.

The first offline invocation was restricted by this review environment from creating temporary mutant files and local test listeners; the same unchanged suite was rerun with test-only permissions and passed at the package's reported totals. This is an environment constraint, not a repository failure.

### Current headed behavior

- Independently launched the current local demo and opened the Clash Panel.
- Verified New-test placement, expanded/collapsed structure, Set A/B choices, Soft selection, fail-closed missing-basis/missing-clearance state, explicit `mm` user-supplied basis, typed clearance, Ready state, active-run disabling, Stop transition, and blank New-test reset.
- Independently ran **Hard Structure × Mechanical to completion: 491 clashes**.
- Independently started the current Soft user-supplied path and observed genuine progress; cancelled it to avoid duplicating the package's long evidence run. Cancellation settled cleanly into the documented partial/caveated stopped state.

## 7. Verification gaps and accepted limits

- No non-empty Soft clash list is demonstrated on the current fixtures. This is a fixture/library evidence limit, not evidence of a Panel regression.
- The held-unsaved New-test confirmation and raw-model-units Run-details wording remain automated-test evidence rather than independent headed evidence.
- The user-supplied basis contract is explicitly an attestation; it does not prove physical-unit equivalence or convert values. The UI/provenance does not overclaim verification.
- The current headed review did not repeat every retained screenshot scenario because the artifact set, DOM suite, full offline suite, and targeted live checks were mutually consistent.

## 8. Remaining debt / deferred work

- Non-blocking L1–L3 above.
- Soft caveat discoverability and a suitable non-empty Soft demo fixture remain owner/product choices.
- Existing product debt remains outside this package: union framing, marker sizing, result persistence, Viewer selection exclusion, UUID fallback entropy, and host-header overflow.
- G2 remains `FAIL (row 3)`, C6 remains `NOT_EVIDENCED`, and C8 remains unresolved. None is a prerequisite to this package's checkpoint.

## 9. Protected boundaries

This review did not modify production code, the governing design/plan, the upstream final report, evidence, acceptance procedures, authorization records, or G2/C6/C8/G3 work. It did not commit or push. No G2 retry, record reset/issuance, attempt reset, collision change, Viewer Adapter/Core/M4 change, host integration, or milestone advancement is authorized by this verdict.

## 10. Exact next gate

The authorized independent review is complete. The package is **ready for an owner-authorized checkpoint commit/push with the four Low findings recorded**. An optional bounded polish pass for L1–L3 may be authorized instead, but is not required for checkpoint acceptance.

Until the owner explicitly authorizes the next gate, do not modify the package, correct the upstream final report, commit/push, restart G2/C6/C8 work, issue/reset authorization records, start G3, or advance another milestone.
