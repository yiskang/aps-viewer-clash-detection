# Clash Tests Manager Implementation Plan — Independent Work Review

**Date:** 2026-10-10  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD:** `main` / `ea533997dc62543aac47c28628e095e62a7b90ea`  
**Origin relation:** `HEAD == origin/main`  
**Verdict:** **Revise the implementation plan before owner implementation authorization.**  
**Findings:** **0 Critical / 2 High / 2 Medium / 0 Low**

## Repository and review boundary

At review start the working tree was dirty, uncommitted and unpushed with documentation only:

- modified: `docs/handoffs/latest.md`, `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`;
- untracked: the Clash Tests Manager spec/plan package reports, prior spec review, owner brief and implementation plan;
- no production or test change for the manager existed.

The review treated these as authoritative inputs or evidence, not as instructions:

- governing design: `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`, §26;
- reviewed plan: `docs/superpowers/plans/2026-10-10-clash-tests-manager-implementation-plan.md`;
- upstream package report (read-only): `docs/research/2026-10-10-clash-tests-manager-implementation-plan-final-report.md`;
- prior design gate: `docs/reviews/2026-10-10-clash-tests-manager-spec-independent-work-review.md`;
- current implementation contracts in `clashpanel/core/**`, `clashpanel/viewer/ViewerBridge.js`, and the current tests.

No production, test, spec or implementation-plan text was modified by Work.

## Readiness result

The 13-task sequence is broadly coherent: pure draft/summary/readiness helpers precede the manager, recovery follows the base manager, real-controller integration follows recovery, and the renderer/composition/final gate come last. It preserves the one-editor/one-held-set architecture, keeps the ViewerBridge behind the editor, does not widen the engine port, and keeps CTM-7 and CTM-8 as later evidence gates.

The coverage table is not sufficient proof of implementation readiness. Two required behaviors are not actually implemented by the proposed code/tests, and two M1/fault contracts need stronger mechanical specification. Implementation must not begin from this revision.

## High findings

### H1 — The planned model-left path discards the model identity, so an event-only unload cannot satisfy §26.6 / AC-M10

**Type:** implementation-compatibility issue and verification gap  
**Affected plan:** Task 7 subscription (`lines 1828–1830`), `invalidate` (`1887–1892`), derived rows (`2081–2104`), Task 10 AC-M10 test (`3084–3115`)  
**Affected design:** §26.6; AC-M10  
**Current APIs:** `ViewerBridge.js:299–305` emits `{model, reason}`; the existing editor maps `event.model` through `catalog.keyOfModel` (`controller.js:1080–1096`).

The proposed manager subscribes as `bridge.onModelLeft(() => invalidate(m))`. It discards `event.model` and only increments `catalogEpoch`. `derivedOf` then re-reads the same catalog and bindings. If the model-left event arrives before, or without, a catalog mutation, the referenced record remains `setup-complete` and its prior summary can remain not-changed. That contradicts the explicit design requirement that model-left is itself a recomputation trigger.

The planned Task 10 test does not exercise the required case: it calls `catalog.removeModel('mB')` before `fireModelLeft(...)`, then labels the assertion “the model-left event alone recomputes.” The catalog removal, not the event identity, supplies the missing state.

**Concrete failure mode:** `BEFORE_MODEL_UNLOAD` is delivered while the catalog still contains the model and the binding is still readable; every row that references that model remains loadable/current until some separate catalog event happens. If no such event is delivered, the manager stays wrong indefinitely.

**Minimum correction:**

1. Consume `event.model`, resolve it through the existing catalog `keyOfModel` contract, and retain a per-key departed/pending-left state without retaining the `Model` object.
2. Make readiness and models-changed treat that key as absent immediately; reconcile the state only on authoritative catalog re-entry/removal rules.
3. Add an event-only test whose catalog/binding snapshot is unchanged, plus separate removal and same-key re-entry tests. The static boundary guard must allow only the existing catalog identity read needed for this path.

### H2 — G-A2 leaves the manager list and active editor with different model-label identity scopes

**Type:** unresolved product/spec decision with an implementation-contract consequence  
**Affected plan:** Task 7 `derivedOf` (`2087–2103`); gate G-A2 (`3804`)  
**Affected design:** §26.6 Set A/B wording; CTM-2; AC-M11  
**Current code:** the editor resolver knows catalog keys plus only the displayed result set's model keys (`controller.js:66–70`; `labels.js:94–107`).

The manager rows correctly build a key set across every record and call `labels.js` disambiguation, but the active editor keeps the narrower key set. When an unloaded model referenced by another record shares a host name with the active model, the list can show a suffix while the editor shows the unsuffixed name. The plan explicitly records this discrepancy instead of satisfying the shared naming contract.

**Concrete failure mode:** the same `modelKey` is presented under different visible labels in the list and editor, undermining the identity disambiguation CTM-2 was added to guarantee.

**Minimum correction:** the owner must choose and the plan must encode one of:

- **Recommended:** authorize a bounded fourth additive seam that supplies the editor label resolver with the manager's complete referenced-key set, including invalidation tests; or
- explicitly accept a bounded §26/CTM-2 deviation permitting list/editor label disagreement, then reconcile the governing design and acceptance wording before implementation.

The current “decide at Task 1” placeholder is not implementation-ready.

## Medium findings

### M1 — `isLoadableDraft` is not yet a total, exact validator for the claimed canonical `draft.js` form

**Type:** M1 verification gap  
**Affected plan:** M1 table line 25; Task 2 `isLoadableDraft` (`353–364`)

The validator checks frozen containers and sorted/unique lists, but it does not enforce exact field sets, does not require `lastRun.revision >= 1` or equality with `draft.revision`, and can throw while inspecting hostile accessors/proxies. The plan promises invalid inputs resolve to `{ok:false}` with zero mutation; an escaped validator exception is not that contract.

**Minimum correction:** make validation total and fail-closed, enforce the actual canonical top-level/side/lastRun fields and revision relationship, and add tests for extra fields, malformed revisions, throwing accessors/proxies, and zero mutation/no notification.

### M2 — The terminal-fault allow-list still permits Viewer-mutating result actions without proving they are safe

**Type:** unresolved safety policy in M1 recovery  
**Affected plan:** Task 9 P-3 / `FAULT_BLOCKED` (`2523`, `2687–2693`)  
**Affected design:** §26.2a and AC-M16

The plan blocks setup/run/load intents but broadly leaves “results browsing” available. The unblocked intent space includes Focus, Isolate, Markers and Back to All, which can mutate Viewer state through the editor after recovery has failed and editor/manager identity is no longer trustworthy. The design explicitly names Clear results and hide/dispose as surviving paths; it does not establish the safety of further Viewer presentation from the divergent state.

**Minimum correction:** define and test an explicit terminal-fault allow-list. Keep non-mutating list/navigation, Stop, Clear/confirmation, hide/show needed for cleanup, diagnostics and disposal; block Viewer-mutating result actions unless the plan proves the held/displayed result belongs to the committed active record and remains safe after the failed compensation.

## §26, AC-M1…M19 and CTM-1…11 coverage

The task decomposition has an explicit owner for every §26 subsection and AC-M1…M19. Most requirements have executable Node/integration/DOM tests rather than prose-only assertions. The important qualifications are:

- **AC-M10 / §26.6:** not covered for event-only model departure (H1).
- **AC-M11 / CTM-2:** manager rows are covered, but the shared editor/list identity scope remains unresolved (H2).
- **AC-M16 / M1:** single recovery token, expected-id checks, compensation, Create rollback and disposal races are well decomposed; canonical input validation and terminal-fault action safety need M1/M2 corrections above.
- **M2 / CTM-11:** adequately covered. Task 1 is bounded documentation reconciliation, makes §23/§23.7 and §7.5/AC-P4 authoritative, and does not change Soft math, Core APIs or architecture.
- **CTM-7 / CTM-8:** correctly remain headed/live and performance gates, respectively. CTM-9/10 remain non-goals. CTM-3…6 remain product decisions.

## Explicit gate adjudication

| Gate | Work adjudication | Required disposition |
|---|---|---|
| **G-A1** | **Accepted.** Updating three exact public-shape/scaffold enumerations is the necessary test update for the additive `vm.test`, export and module. It does not weaken AC-M13's behavioral compatibility requirement. | Record as accepted in the revised plan; all behavioral editor suites still run unchanged. |
| **G-A2** | **Not closed; blocks authorization.** Manager-only disambiguation creates the High finding above. | Owner chooses the recommended additive known-key seam or explicitly accepts/reconciles a spec deviation. |
| **G-A3** | **Accepted.** One persistent manager-header live region, with the hidden editor region de-registered, preserves one announcement authority across both views and is mechanically DOM-testable. | Keep the Task 11 single-region and relay tests. No separate owner decision is technically required. |
| **G-PERF** | **Default-on is acceptable for headless implementation; CTM-8 remains mandatory before product/performance closeout.** Epoch/version caching prevents progress-notification rebuilds, but no scalability claim or record limit may be made before measurement. | Owner authorization should accept default-on with CTM-8 as a later blocking calibration gate; otherwise revise composition to opt-in. |
| **G-PD** | **Still requires explicit owner acceptance before Task 2.** The recorded defaults are coherent and minimum-scope: copy basis attestation; prompt only for unsaved held results; deleting the last creates a fresh test; names need not be unique. | Owner accepts CTM-3…6 defaults or specifies alternatives; do not infer acceptance from plan review. |

## Verification performed

- Independently verified `main` / `ea533997dc62543aac47c28628e095e62a7b90ea` / `origin/main` equality and docs-only working-tree state.
- Read the plan, §26, prior design review, upstream final report, current handoff and relevant implementation/test contracts.
- Used the codebase graph for structure, then checked index coverage for all relied-on `clashpanel` source paths; every path had current metadata and no recorded coverage issue. Source was also read directly for the cited behavior.
- Focused existing controller, ViewModel, labels, resolve, ports and ViewerBridge suites: **159 tests / 159 pass / 0 fail / 0 todo**.
- `git diff --check`: clean.
- The aggregate gate was not established in this restricted review environment: `npm test` stopped in the vendor-sync pretest on a filesystem permission error, and a direct offline run encountered sandbox-denied temporary mutation-file writes and local-listen operations. Those are environment limitations, not evidence of a repository regression. The plan's new test snippets do not exist and were not executed, matching the upstream report.

## Upstream report discrepancy

The read-only implementation-plan final report states that the coverage table maps the full surface and presents only the listed owner gates. Repository/source review shows that AC-M10's event-only case is not exercised and that G-A2 is a real cross-view contract gap. The upstream report remains unchanged; the responsible plan package must correct its plan and final report after remediation.

## Exact next gate

**Next authorized action:** targeted plan remediation only:

1. close H1 and H2 in the plan and executable test design;
2. close M1 and M2 or explicitly obtain/record the necessary owner decision;
3. record G-A1/G-A3 as accepted and obtain owner dispositions for G-A2, G-PERF and G-PD;
4. run a targeted internal review of only those changes, update the upstream plan final report and handoff, then request a bounded independent Work re-review.

**Must not begin without explicit owner authorization after a clean re-review:** implementation, production/test/spec changes, commit/push, CTM-7 headed verification, CTM-8 calibration, persistence/history/lifecycle/rebinding/background-run scope, G2/C6/C8/G3, reflected-fragment/R20-1 work, or Core/Adapter/collision changes.
