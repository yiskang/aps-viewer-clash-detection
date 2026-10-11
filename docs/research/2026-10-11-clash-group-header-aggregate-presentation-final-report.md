# Clash group header aggregate presentation (pre-CTM-8 Addendum B) — package final report

**Date:** 2026-10-11
**Role:** upstream package completion report written by the implementation package. It is **not** an independent review. The Independent Work implementation review is still to be written.
**Status:** **implemented, uncommitted; awaiting independent Work implementation review**

## 1. Repository state

| Item | Value |
| --- | --- |
| Repository | `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection` |
| Branch | `main` |
| HEAD | `9e49f4036137bafd098ceb8631bcd16fff6c4da6` (`feat(clashpanel): checkpoint CTM-7 manager validation`) |
| Origin relation | `main...origin/main`, not ahead or behind (HEAD == `origin/main` as of the last fetch) |
| Working tree | Uncommitted. 11 production files and 13 test/support files modified, 2 new test files (§4). Also pre-existing docs changes from the earlier docs-only addendum package (spec §27, plan Addendum B, handoff, prompt, two reviews), plus this package's headed evidence directory, this report and the handoff update. |
| Commit/push | **None.** Nothing committed or pushed. No branch or worktree was created. |

## 2. Authority and scope

- **Authorization:** owner implementation prompt [`docs/prompts/claude-codex-pre-ctm8-clash-group-header-aggregate-presentation-implementation-prompt.md`](../prompts/claude-codex-pre-ctm8-clash-group-header-aggregate-presentation-implementation-prompt.md). It covers the bounded Addendum B correction only. CTM-8 stays unauthorized. No commit or push.
- **Governing design:** [Viewer Clash Panel design §27](../superpowers/specs/2026-09-26-viewer-clash-panel-design.md) (§27.1–§27.9, AC-GP1…AC-GP12). Owner marker decision **Option A**: no group markers or outlines, and Markers disabled with the exact reason "Markers are unavailable for a clash group.".
- **Governing plan:** [Clash Tests Manager implementation plan, Addendum B](../superpowers/plans/2026-10-10-clash-tests-manager-implementation-plan.md) (tasks B1–B7).
- **Prior reviews:** [aggregate-presentation Independent Work Review](../reviews/2026-10-11-clash-group-header-aggregate-presentation-independent-work-review.md) (design authority) and [Addendum Independent Work Review](../reviews/2026-10-11-clash-group-header-aggregate-presentation-addendum-independent-work-review.md) (PASS, 0/0/0/0).
- **Milestone context:** CTM-7 stays closed at its owner-ratified checkpoint (`9e49f40`). **CTM-8 has not started.**
- **Document discrepancies, recorded but not edited:**
  - The Addendum B heading in the plan still says "PLANNED ONLY; IMPLEMENTATION NOT AUTHORIZED". The later owner prompt supersedes it.
  - Plan B7 says an Independent Work implementation review is required *before* headed verification. The owner prompt instead asked for the headed matrix right after implementation, so it was run before the independent review.

## 3. Behavior implemented

- **Intent and selection (§27.1):**
  - New intent `GROUP_PRESENT` (`'group/present'`).
  - Controller state `selectedGroupId`, mutually exclusive with clash selection. Selecting a child clears the group and selecting a group clears the clash.
  - A group header row has two sibling native buttons:
    - `.clash-group-toggle` sends only `GROUP_TOGGLE`, with `aria-expanded` and the accessible name "Expand/Collapse group <label>".
    - `.clash-group-body` sends only `GROUP_PRESENT`, with `aria-current="true"` when selected and the row class `clash-group-row-selected`.
  - Click, Enter and Space never cross-trigger between the two buttons. `GROUP_PRESENT` is ignored in the flat view and for unknown groups.
- **Membership (§27.2):**
  - One path serves every grouping mode (Element, Model Pair, Category, Level). It uses the current filtered `groupsById` `memberIndexes` and visits both sides of every pair.
  - Participants are de-duplicated on compound `{modelKey, dbId}`, so an equal dbId in different models stays distinct, and keep first-seen order.
  - Live Models are resolved at action time and none is retained.
  - Unavailable participants are counted once per unique participant.
- **Bridge (§27.3/§27.4/§27.7):**
  - New sibling `ViewerBridge.presentGroup({participants:[{model,dbId}], options:{focus, isolate}})`.
  - It is validated independently from `present()` and rejects a `marker` option.
  - It shares a `transact()` helper extracted from `present()`, so it uses the same queue, token, ledger, write-ahead, guarded-restore, rollback and supersession machinery.
  - It does one aggregate isolate across any number of models, plus aggregate fit. It makes no marker, overlay or bounds call.
  - `present()` behavior is unchanged and still rejects 0 or more than 2 sides.
- **Lifecycle (§27.6):**
  - Back to all clears the selection and Viewer and keeps filter, grouping, expansion and page.
  - New run, Clear, and test switch or delete reset the selection.
  - Panel hide clears the Viewer and keeps the selection. Panel show makes no Viewer call.
  - On model departure the controller clears once, keeps a truthful context, and re-resolves participants at action time.
  - When a filter or regroup change makes the group disappear, the selection ends.
  - A grouping-mode change ends the selection.
  - Expand, collapse, page and sort are no-ops.
  - When filtered membership changes, the aggregate is re-presented.
  - Stale outcomes are dropped by the `viewerSeq` guard.
- **Selected region (§27.5):**
  - `vm.selected` gets a group variant `{kind:'group', …}`: group label, clash count, participant, shown and unavailable counts, Focus, guarded Isolate, Focus on select, disabled Markers with the exact Option A reason (title, visible text and `aria-describedby`), and Back to all.
  - It has no ordinal, sides, gap, location or witness.
  - The child (single-clash) shape is unchanged and has no `kind` key.
  - Disabled Focus and Isolate state the reason "Viewer actions are unavailable: no participant model is loaded."
- **Terminal fault (AC-GP11):**
  - `FAULT_POLICY[GROUP_PRESENT] = BLOCK`, while `GROUP_TOGGLE` stays ALLOW.
  - `lockedEditorVm` exposes `results.groupPresent`, and the manager `FAULT_LOCKS` locks `.clash-group-body` only, never the disclosure.
  - Focus, Isolate, Markers and Back to all in the group-selected variant are locked by the existing `[data-key]` locks.

## 4. Exact changed files (this package)

Derived from `git status --short` and `git diff --numstat` at HEAD `9e49f40`.

**Production (11 modified):**

| File | +/− |
| --- | --- |
| `clashpanel/core/controller.js` | +169/−3 |
| `clashpanel/core/intents.js` | +3/−1 |
| `clashpanel/core/managerViewModel.js` | +4/−2 |
| `clashpanel/core/ports.js` | +2/−1 *(outside the expected surface, see §6)* |
| `clashpanel/core/rows.js` | +2/−1 |
| `clashpanel/core/testsManager.js` | +1/−1 |
| `clashpanel/core/viewModel.js` | +27/−1 |
| `clashpanel/ui/render/manager.js` | +1/−0 *(outside the expected surface, see §6)* |
| `clashpanel/ui/render/results.js` | +17/−2 |
| `clashpanel/ui/render/selected.js` | +42/−6 |
| `clashpanel/viewer/ViewerBridge.js` | +86/−21 |
| `wwwroot/main.css` | +23/−1 |

**Tests and test support (13 modified, 2 new):**

| File | +/− |
| --- | --- |
| `test/clashpanel/core/controller.groupPresent.test.mjs` | **new** (800 lines, 50 tests) |
| `test/clashpanel/viewer/ViewerBridge.group.test.mjs` | **new** (500 lines, 24 tests) |
| `test/clashpanel/core/ports.test.mjs` | +2/−2 |
| `test/clashpanel/core/rows.test.mjs` | +2/−2 |
| `test/clashpanel/core/testsManager.recovery.test.mjs` | +23/−1 |
| `test/clashpanel/core/viewModel.test.mjs` | +17/−0 |
| `test/clashpanel/dom/manager.dom.mjs` | +35/−0 |
| `test/clashpanel/dom/results.dom.mjs` | +90/−13 |
| `test/clashpanel/dom/selected.dom.mjs` | +85/−1 |
| `test/clashpanel/dom/support/vmFixtures.mjs` | +15/−0 |
| `test/clashpanel/support/controllerHarness.mjs` | +15/−4 |
| `test/clashpanel/support/fakeBridge.mjs` | +11/−2 |
| `test/clashpanel/support/faultControls.mjs` | +38/−7 |
| `test/clashpanel/support/support.test.mjs` | +21/−0 |

Modified assertions in existing tests are contract additions, not weakened checks:
- `rows.test` covers the header row's new `selected:false`.
- `ports.test` covers the bridge port's new `presentGroup` member.

**Docs written by this package:**
- this report;
- `docs/handoffs/latest.md` (new LATEST entry);
- the evidence directory `docs/research/evidence/2026-10-11-pre-ctm8-clash-group-header-aggregate-headed/`. Its `console.log` and `GPF1R-console.log` are git-ignored by `.gitignore` `*.log`; they exist locally and are covered by `MANIFEST.sha256`.

**Pre-existing docs changes, from the earlier docs-only package and not changed here:**
- `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md` (§27);
- `docs/superpowers/plans/2026-10-10-clash-tests-manager-implementation-plan.md` (Addendum B);
- the implementation prompt;
- both `docs/reviews/2026-10-11-clash-group-header-aggregate-presentation-*independent-work-review.md`.

## 5. Per-task summary (B1–B7) and internal review

Every task was TDD'd (tests failed first) and then reviewed read-only for spec and quality.

| Task | Delivered | Internal review | Fix rounds |
| --- | --- | --- | --- |
| B1 — intent, state, row contract | `GROUP_PRESENT`, `selectedGroupId`, sibling toggle/body buttons, selected row class and ARIA, `buildGroupHeaderRow` `selected` | Clean | Mechanical carry-overs fixed later: `FAULT_POLICY` entry and test placeholder (B6); `GROUP_TOGGLE` fault selector narrowed to `.clash-group-toggle` (B6); `onGroupMode` clear (B4) |
| B2 — membership path | `resolveGroupMembership` (compound de-dup, both pair sides, action-time resolution, unavailable count); `presentGroup` call with seq guard; no-live path | Spec ✅. One **Important** test-strength item: the supersession test did not prove the seq guard | **1 round (test only):** the stale group outcome now resolves last. Mutation check: removing `seq !== c.viewerSeq` makes the test fail. Header comment fixed; flat-view no-bridge-call assertion added |
| B3 — `ViewerBridge.presentGroup` | `transact()` extracted from `present()`; independent `validateGroupRequest`; `runPresentGroup` with `draw:null` | Spec ✅ / quality approved. 0 Critical / 0 Important. Minors M1–M4 | M1 (`live` shadowing) fixed in B7. M2–M4 deferred (§9) |
| B4 — refresh and lifecycle | Back to all, reset paths, panel hide/show, model departure, disappearance/mode change, filter re-present, stale-outcome guard; `assertBridgePort` + `fakeBridge.presentGroup` | Spec ✅ / quality approved. Rulings recorded in §6 | Missing tests listed by the reviewer were added in B7 |
| B5 — selected region and Markers | `vm.selected` group variant, exact Markers reason, group-aware actions, atomic group↔child swap, XSS-safe label | Spec ✅ / approved. Minor: forged `ACTION_MARKERS` on a group flips the toggle | Fixed in B7. Per-VM-build cost deferred (§9) |
| B6 — terminal-fault equivalence | `FAULT_POLICY` BLOCK, `FAULT_CONTROLS` entry, `lockedEditorVm.results.groupPresent`, `FAULT_LOCKS` line, narrowed `GROUP_TOGGLE` selector | Spec ✅ (AC-GP11) / approved. Recovery 42/42, DOM 147/147 | — (minor fixture non-vacuity note deferred) |
| B7 — closeout and minor fixes | `onActionMarkers` group guard; `live` renamed to `liveParticipants`; +4 tests: forged Markers, model-unavailable Category regroup ends the selection, filter re-present while in flight, selection ended while in flight | — | No real bug found. The forged-Markers test was confirmed red before the fix |
| GP-F1 fix (after headed) | `pipe.labelsPending` token and `textPassProvisional(c)`. `reconcileSelectedGroup` stays dormant during a cold-label-index text pass and reconciles once labels settle (commit or rejection) | TDD: 2 tests, both red before the fix (unexpected `['clear']`) | controller.js only |

## 6. Deviations and rulings

1. **`clashpanel/ui/render/manager.js` FAULT_LOCKS, one line** (outside the listed production surface). This is mechanically necessary: the lock loop is selector-driven, and no other mechanism disables the new native `.clash-group-body` button under a terminal fault. The line targets the body only and never the disclosure. The B6 review accepted it as minimal.
2. **`clashpanel/core/ports.js` `assertBridgePort` now requires `presentGroup`** (outside the listed surface). This is a structural port check of the Panel-internal bridge. Any bridge without `presentGroup` now fails assertion. The fake bridge and harness were updated to match.
3. **A filter re-present uses the user's Focus-on-select toggle as `fit`** (B4 ruling). §27.2 says only "re-present", so this follows select-time presentation. It is not a forced fit.
4. **A Category or Level group is dropped when regrouping lands "unavailable" after a model departure, and this ends the selection** (B4 ruling). This is group disappearance under §27.6. Cost: the selection is not re-established if a later regroup succeeds, which matches the existing `navScope` policy. A test was added in B7. Headed item 7 and O-4 confirm it.
5. **The `vm.selected` group variant is tagged `kind:'group'`.** The child shape has no `kind` key and is unchanged.
6. **New controller internals `pipe.labelsPending` and `textPassProvisional(c)`** were added by the GP-F1 fix. A cold-index text pass is treated as provisional, the same idea as the existing regroup-`pending` dormancy. Side effect: with an active text filter, group reconcile after a model departure also waits for the label re-warm.
7. **`presentGroup` rejects a `marker` key in its options**, which is stricter than §27.3. This is consistent with Option A. The controller never sends `marker`.

No governing contract (spec §27 or Addendum B) needed changing. No STOP condition was hit.

## 7. Verification (re-run for this report, 2026-10-11, on the final working tree)

| Command | Result |
| --- | --- |
| `npm run test:offline` | **5695 tests / 5694 pass / 0 fail / 1 todo**, exit 0. The todo is the pre-existing `KNOWN GAP` #5328, an extreme aspect-ratio tolerance case that this package did not touch. |
| `npm run test:clashpanel:dom` | **147 / 147 pass**, 0 fail, exit 0 |
| `node --test controller.groupPresent.test.mjs ViewerBridge.group.test.mjs` | **74 / 74 pass** (50 + 24) |
| `git diff --check` | clean (exit 0) |
| Protected-path inspection | `git diff --name-only` and the untracked list contain **no** Core/collision/Viewer Adapter/host/server path, no `clashpanel/viewer/markers.js`, `fit.js` or `isolation.js`, nothing CTM-8 and nothing L1–L8. All changes are in §4. |

`npm test` is `test:offline && test:clashpanel:dom`, so the canonical suite is green. During the work, B-stage totals grew from 5626 at B1, to 5640 at B2, to 5693 at B7, and reached 5695 after GP-F1. DOM went from 140 at B1 to 147 at B6.

## 8. Headed evidence

Directory: [`docs/research/evidence/2026-10-11-pre-ctm8-clash-group-header-aggregate-headed/`](evidence/2026-10-11-pre-ctm8-clash-group-header-aggregate-headed/). **This is pre-CTM-8 evidence only, not CTM-8 evidence.**

- **Main matrix:** [`results.md`](evidence/2026-10-11-pre-ctm8-clash-group-header-aggregate-headed/results.md) and `results.json`, with `state-captures.json` (57 captures), 24 PNGs and `MANIFEST.sha256`.
  - Setup: real app, Playwright headed Chromium, Viewer 7.124.2, three Audubon SVF2 models. No code was edited during the run.
  - **Result: 10 PASS / 0 FAIL / 0 NOT-RUN.**

| # | Item | Result |
| --- | --- | --- |
| 1 | One-model group | PASS |
| 2 | Two-model group | PASS |
| 3 | More-than-two-model group | PASS |
| 4 | Aggregate Focus | PASS |
| 5 | Isolate / restore | PASS (O-1) |
| 6 | Back to all | PASS |
| 7 | Unavailable participant (unload path) | PASS (O-2 for `hideModel`) |
| 8 | Selected visuals | PASS |
| 9 | Markers disabled | PASS |
| 10 | Disclosure vs body | PASS |

  - Extra checks passed: warm-index filter re-present, panel hide/show, New test clears. Console: 0 errors (1 known `getInstanceTree` deprecation warning).
- **Finding GP-F1 (Medium), now fixed:**
  - What happened: the first text filter of a run, with a cold label index, ran a provisional pass that dropped the group, ended the selection permanently, and cleared isolation. Evidence: GP-21.
  - Fix: §5, GP-F1 row.
  - **Headed recheck PASS:** [`GPF1-recheck.md`](evidence/2026-10-11-pre-ctm8-clash-group-header-aggregate-headed/GPF1-recheck.md). On the first "Duct" filter the selection was kept and re-presented 213 of 242 clashes, isolation went straight from {3:365} to {3:328}, and Markers stayed disabled. A no-match filter ends the selection and clears the Viewer.
  - **Low:** one transient intermediate DOM state of about 4 ms showing "No clashes match the current filters." with no selection before the final state. Isolation never dropped. Not investigated.
  - **Not tested:** the no-match filter with a *cold* index (it was run second, with a warm index).

## 9. Unresolved, deferred and limitations

**Observations (unresolved, not fixed in this package):**
- **O-1:** after an aggregate or single-clash restore, models that were not isolated stay root-hidden. This is pre-existing `isolation.js` behavior in a protected file.
- **O-2:** `hideModel` during a presentation is not treated as departure. Context is unchanged and isolation residue remains; the single-clash path behaves the same. This depends on the owner's CTM-7 F-1 hide/departure decision.
- **O-3:** in a group with no live participants, the disabled Isolate checkbox still shows as checked (the shared toggle preference).
- **O-4:** Category and Level groupings become unavailable when any run model unloads. So the "truthful context after departure" path is reachable only in modes that survive an unload (Model Pair and Element). It was verified headed in Model Pair only.

**Pre-existing navScope transient (unresolved):** `rebuildOrdered` permanently ends a single-clash `navScope` when its group is missing from a cold-label-index text pass. This is the same class of bug as GP-F1. It was intentionally left unchanged. Candidate follow-up: apply the same `textPassProvisional` guard.

**GP-F1 residue (Low):** the ~4 ms transient "No clashes match" flash. The cold-index no-match case was not tested headed.

**Deferred Minors:**
- **Per-VM-build membership cost:** `groupSelectedInput` re-resolves membership, at O(members×2), on every VM build while a group is selected. An optional memo is a candidate if CTM-8 calibration shows latency.
- **B3 M2:** `presentGroup` marker-key rejection is stricter than §27.3, and the controller-harness fake does not mirror it.
- **B3 M3:** a failure-injection test title overclaims ("each mutating step"). The other steps are covered elsewhere.
- **B3 M4:** non-success outcomes report `participants: 0`. The controller must not read it from non-success outcomes, and it does not.
- **B6 fixture:** the `GROUP_PRESENT` VM gate in `faultControls` is `undefined` on an unfaulted VM. Non-vacuity is proven by the `manager.dom` B6 test instead.
- **B5:** the Isolate disabled-reason `aria-describedby` wiring is untested; Focus is tested.

**Carried, untouched:** CTM-7 Lows L1–L8 (deferred), CTM-8 (not started), and the plan header discrepancy in §2.

## 10. Protected boundaries confirmed unchanged

- Untouched:
  - Core, collision, Viewer Adapter, host integration and server;
  - `clashpanel/viewer/markers.js`, `fit.js` and `isolation.js` (reused privately from `ViewerBridge.js` only);
  - Viewer theming and selection architecture;
  - persistence and history;
  - public limits and package files.
- Not added: grouping modes, nested grouping, aggregate witnesses or outlines.
- `present()` contract not widened.
- Not begun or reopened: CTM-8, CTM-7, L1–L8, G2, C6, C8, G3, R20-1.

## 11. Readiness and next gate

- **Ready for independent Work implementation review**, which writes `docs/reviews/<date>-…-independent-work-review.md` (not authored here). The review inputs are:
  - this report;
  - the diff at `9e49f40` plus the working tree;
  - the headed evidence and the GP-F1 recheck;
  - spec §27 and plan Addendum B.
- **Exact next gate:** independent Work implementation review. Then the **owner decides** on a checkpoint commit and push.
- **Not authorized without explicit owner authorization:**
  - commit or push;
  - CTM-8;
  - the navScope follow-up and O-1 to O-4 remediation;
  - the deferred Minors;
  - L1–L8;
  - any work in the Core/Adapter/collision/host, markers/fit/isolation, persistence or theming boundaries;
  - another package or milestone.
