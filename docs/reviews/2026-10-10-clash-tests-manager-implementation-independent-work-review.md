# Clash Tests Manager implementation — Independent Work Review

**Date:** 2026-10-10  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD:** `main` / `ea533997dc62543aac47c28628e095e62a7b90ea`  
**Origin relation:** `HEAD == origin/main`  
**Working tree:** dirty, uncommitted and unpushed; the Clash Tests Manager package plus this review/handoff update are present  
**Verdict:** **bounded remediation required before the implementation checkpoint is accepted**  
**Findings:** 0 Critical / 0 High / 2 Medium / 8 Low

## Scope and reviewed authorities

This review independently inspected the current repository state, the implementation, the complete new and affected test surface, and these governing/read-only artifacts:

- `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`, especially §26, AC-M1…M19 and CTM-1…11;
- `docs/superpowers/plans/2026-10-10-clash-tests-manager-implementation-plan.md` (accepted 13-task plan);
- the applicable Independent Work plan reviews under `docs/reviews/`;
- `docs/research/2026-10-10-clash-tests-manager-final-report.md`, preserved unchanged as the upstream package final report;
- the current `docs/handoffs/latest.md`.

The codebase-memory graph available to this Work task indexes the ChatGPT project mirror rather than this external repository. Coverage checks therefore reported the relied-on Clash Detection files as `outside_project`; all implementation conclusions below use direct source/test reads and executable repository verification instead of graph claims.

## Readiness verdict

The headless manager architecture and almost all §26 behavior are implemented coherently. The implementation preserves one editor, one active test, and at most one held Result Set; provides atomic `TEST_LOAD`, read-only `vm.test`, `CONFIRM_CANCEL`, and `TEST_LABEL_SCOPE`; implements Create/Open/Duplicate/Delete/Reset and unsaved-result confirmation; handles event-only model departure and same-key re-entry; shares the manager/editor label scope; validates loadable drafts exactly and fail-closed; performs single-token divergence recovery; exposes a fail-closed terminal fault policy whose UI/action state is mechanically equivalent; and cleans up registered manager listeners transactionally.

The implementation is not yet checkpoint-ready because two executable accessibility contracts in §26.10 are not met. Both corrections are bounded to the manager/editor presentation contract and tests; neither requires reopening §26 architecture, Core, Viewer Adapter, collision, persistence, history, background execution, CTM-7, or CTM-8.

## Findings

### Medium M1 — two disabled actions do not expose why they are disabled

**Governing contract:** spec §26.10: “Every disabled action exposes its reason (visible text or `aria-describedby`).”  
**Affected implementation:**

- `clashpanel/core/managerViewModel.js:144–153` sets a pending confirmation's `enabled` flag false during recovery or an editor confirmation, but carries no disabled reason;
- `clashpanel/ui/render/manager.js:70–84` renders that disabled Confirm button without visible reason text or `aria-describedby`;
- `clashpanel/core/viewModel.js:173` disables the editor's New test action while a run is active;
- `clashpanel/ui/render/setup.js:109–117` renders the disabled New test button without a linked or adjacent reason.

**Concrete failure:** a keyboard or assistive-technology user encounters a disabled destructive Confirm during recovery, or a disabled manager-composed New test during a live run, without an exposed explanation for the disabled state. The pending banner's destructive-action copy does not explain the recovery lock, and the New test tooltip describes the action rather than its disabled cause.

**Minimum correction:** carry a specific disabled reason for `manager.confirm` and expose it in the banner; expose the live-run reason for the manager-composed editor New test action using visible text or `aria-describedby`. Add DOM tests that resolve each disabled control's reason text, plus enabled-state companion assertions. Preserve the standalone editor's existing contract if the correction is manager-only.

### Medium M2 — identical consecutive manager actions are not reliably announced

**Governing contract:** spec §26.10 requires activation, creation, duplication, deletion, and reset to be announced in the single live region. Duplicate names are explicitly allowed by the accepted product decision.  
**Affected implementation:** `clashpanel/core/testsManager.js:444–505, 531–542` stores only the announcement string; `clashpanel/ui/render/manager.js:50–58` deliberately leaves the live node unchanged when the new manager string equals the previous manager string.

**Concrete failure:** two valid consecutive actions can produce identical text—for example, deleting two different tests that share the same permitted name. The second action updates manager state but the live-region text does not change, so assistive technology is not given a new announcement. The current DOM test checks relay and persistence, not consecutive identical events.

**Minimum correction:** give manager announcements a monotonic event identity/version and make the persistent live region produce an observable update for each event without creating a second live region. Add a deterministic DOM test with two distinct actions that intentionally generate the same text and prove both update events are announced.

### Low L1 — focus can fall to `document.body` after a view-switch rebuild

This is a real keyboard UX debt, but §26 mandates focus transfer only for the confirmation banner. It does not invalidate state ownership or dispatch safety. Add an intentional post-switch focus target before headed/product closeout; no architecture change is required.

### Low L2 — terminal-fault locking replaces an existing `aria-describedby`

`lockEditor` replaces rather than appends a control's earlier description. The terminal-fault reason—the current disabling cause—remains exposed, so this is not the M1 failure above. Appending and deduplicating IDs would preserve secondary validation context and is appropriate accessibility hardening.

### Low L3 — two manager messages are misleading at edge states

A rejected Create that compensates successfully can surface only the “editor was restored” notice, and an active row with an older summary can say “open and re-run” while that same test is already open and running. Neither changes state or result ownership, but both should be corrected during the bounded UI/copy remediation.

### Low L4 — two lifecycle APIs have avoidable defensive gaps

`snapshotOutgoing` has no internal disposed guard, although public dispatch and event callbacks already stop after disposal. The managed `panel.controller.dispose()` facade disposes manager/editor but not the shell; the authoritative `panel.dispose()` path is correct and fully tested. Document or narrow the facade disposal expectation, and add the cheap defensive guard; these are not current false-PASS or leak paths under the public panel lifecycle.

### Low L5 — index-based row action keys can move focus between records

Manager action `data-key` values use the row index. After deletion/reordering, keyed focus restoration can associate a formerly focused control with another record. Use a stable test identity in the key (safely encoded without selector interpolation) or explicitly reset focus after structural list changes.

### Low L6 — a non-settling editor dispatch has no manager timeout

The real in-process editor operations used here settle, and disposal invalidates later commits, so no tested repository path violates ownership. A hostile or broken editor could leave the manager busy indefinitely. This is robustness hardening, not a current checkpoint correctness failure.

### Low L7 — three interaction paths lack direct DOM coverage

The retained suite does not directly pin the view-switch blur/body-focus behavior, an enabled Reset button click, or the Back-to-test button's resulting DOM transition. Core behavior is covered and the renderer uses the shared dispatch path, so these are coverage gaps rather than established defects.

### Low L8 — documentation/evidence fidelity debt remains

The final report's label-scope/`caveatCount` notes and README omission of CTM-8 do not change runtime behavior. They should be reconciled before product/performance closeout. The upstream final report remains read-only and was not edited by Work.

## Adjudication of the implementation agent's five rulings

1. **G-A1 / four surface lists — accepted.** The fourth update, `SHAPE.top` in `viewModel.test.mjs`, is the exact-shape counterpart required by §26.2(b)'s additive `vm.test`. It adds the required key without deleting or loosening any behavioral assertion. The barrel and scaffold lists likewise enumerate authorized additions. This is G-A1-equivalent public-shape maintenance, not an unauthorized weakening.
2. **Task 8 → Task 9 amendment — accepted as a necessary faithful correction.** A literal Task 9 replacement would have removed Task 7's activation lifetime fix. Retaining it, reducing hostile load results to plain fields, guarding editor reads, and compensating on thrown/rejected/malformed outcomes implement AC-M16's commit-on-exact-match/fail-closed recovery rule. The stricter carry-forward expectation is a mechanical plan correction, not a new product behavior.
3. **Keyboard focus after view switch — deferred Low.** Falling to the page body is undesirable UX, but the governing text does not mandate a particular post-switch target. It does not block this checkpoint by itself; it should be fixed and headed-verified before product closeout.
4. **Final internal-review fix wave — behaviorally accepted, with the Medium gaps above still open.** Confirm is now disabled during recovery; the §26.8 hide/show regression is covered; fault policy/UI equivalence and result-row inertness are non-vacuously tested. The disabled Confirm lacks its required reason (M1), and repeated identical announcements remain uncovered (M2). The other disclosed minors are dispositioned above rather than inherited from the upstream report.
5. **Task 13 constructor listener leak — closed.** Construction registers listeners transactionally, unwinds in reverse order, continues after a disposer throws, and preserves the original constructor error. Tests cover normal disposal, catalog failure, bridge failure, non-function disposers at all three acquisition positions, and a throwing unwind disposer. Those tests would fail under the pre-fix sequential-registration leak. No separate durable red-run log was retained, so the historical “failing-test-first” sequence is not independently reconstructable; that is an evidence-process gap, not a surviving implementation defect.

## Implementation and contract assessment

### Confirmed sound

- **Ownership/lifecycle:** one editor, one committed active test, one held set; outgoing snapshots are captured before retirement; activation commits only on exact target agreement; late/superseded work is guarded.
- **Editor seams:** `TEST_LOAD` prevalidates before mutation and refuses atomically; `vm.test`, `CONFIRM_CANCEL`, and `TEST_LABEL_SCOPE` are additive and manager-only where required.
- **Manager operations:** Create/Open/Duplicate/Delete/Reset, monotonic numbering, successor selection, summary retention/reset, and single unsaved-result confirmation match §26 and AC-M1…M9/M14…M18.
- **Model/readiness/identity:** event-only departure immediately marks the key absent, catalog removal reconciles it, same-key re-entry works in either event order, non-active records do not trigger freshness/claim/derivation reads, and manager/editor labels use the same referenced-key scope (AC-M10/M11/CTM-2).
- **Fault safety:** `isLoadableDraft` is exact, total and fail-closed (including `-0`, canonical ordering and hostile objects); `FAULT_POLICY` exhaustively classifies all 39 editor intents and fails closed; one recovery token is used; terminal-fault UI/action equivalence blocks Viewer-mutating interactions; manager-only overlays preserve AC-M13.
- **Scope:** no persistence, run history, background execution, rebinding, Viewer Adapter, Core, collision, host/OQ-1, G2/C6/C8/G3, reflected-fragment or R20-1 implementation leaked into this package.

### AC/CTM coverage conclusion

The code and executable tests materially cover AC-M1…M19 and CTM-1…6/9…11. CTM-11's two pre-existing contradictions are boundedly reconciled in Task 1 without changing Soft math or status-reader architecture. CTM-7 and CTM-8 are intentionally later verification/calibration gates, not missing implementation tasks.

## Verification performed

- Independently ran canonical `npm test` once: exit 0.
  - offline: **5,605 total / 5,604 pass / 0 fail / 1 existing todo**;
  - DOM: **119/119 pass**.
- `git diff --check`: clean.
- Verified `main` and `origin/main` both resolve to `ea533997dc62543aac47c28628e095e62a7b90ea`.
- Verified changed/untracked implementation paths stay within the authorized Clash Tests Manager/spec/plan/report/review/test package; no changes under `clashtest/**`, `collision/**`, `clashpanel/viewer/**`, `clashpanel/core/ports.js`, `wwwroot/**`, server, package or scripts.
- No retained Clash Tests Manager screenshot package exists. The DOM suite is browser-executed against fakes and is not a substitute for CTM-7 headed SVF2 evidence. Work therefore made no visual PASS claim.
- The canonical test run executed the repository's pretest vendor synchronization; it produced no additional working-tree path beyond the already-disclosed package.

## CTM-7 / CTM-8 disposition

- **CTM-7:** absence does **not** block acceptance of the headless/DOM implementation checkpoint, but it blocks headed SVF2 teardown/readiness product closeout. It remains unauthorized and was not run.
- **CTM-8:** absence does **not** block the functional implementation checkpoint, but it blocks performance/product closeout, any scalability claim, and any decision to add or omit a record-count limit based on measurement. It remains unauthorized and was not run.

## Gate and authorization state

**Checkpoint status:** not accepted until M1 and M2 are corrected and independently re-reviewed.  
**Recommended next owner gate:** authorize one bounded Clash Tests Manager accessibility remediation covering disabled-action reasons and repeatable live announcements, plus focused tests and a targeted Independent Work re-review. The Low items may remain recorded debt unless the owner includes them.

**Currently authorized next action:** this review and handoff update only; completed by this report.  
**Must not begin without explicit owner authorization:** remediation; commit/push; CTM-7; CTM-8; persistence/history/background-run/lifecycle expansion; another package or milestone; G2/C6/C8/G3; reflected-fragment/R20-1 work; Core, Viewer Adapter or collision changes; edits to the governing spec/plan or the upstream final report.
