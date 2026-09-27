# Viewer Clash Panel T1–T33 — M1/M2 remediation bounded independent re-review

**Date:** 2026-09-27  
**Branch:** `feature/viewer-clash-panel-t1-t33`  
**Reviewed HEAD:** `d381e582188bb16e05e0f59c8c84d2ec38ac0a3b` plus the uncommitted bounded remediation  
**Baseline:** `main` = `origin/main` = `e302b39720244b1085863220d75ac41e99075bac`

## Verdict

**0 Critical / 0 High / 0 Medium / 0 Low findings in the bounded scope.**

- **M1 is closed.** The grouped-results accessibility hierarchy is valid and the five new DOM tests meaningfully exercise both the corrected structure and preserved behavior.
- **M2 is closed.** The single retained, no-retry canonical `npm test` run is a clean acceptance run. No baseline comparison or additional retry is required.
- **Viewer Clash Panel T1–T33 is accepted.** No further implementation fix is required before closeout.
- The branch is ready for an owner-authorized documentation/code commit and implementation closeout/merge. This review does not itself authorize committing, pushing, merging, G1–G3, H1–H2, or the next milestone.

## 1. M1 — grouped-results ARIA remediation

### Structure

`clashpanel/ui/render/results.js` now separates the two widget types:

- `groupRow()` returns a plain `div.clash-group-row` containing the native toggle button.
- `optionList()` returns a `ul role="listbox"` whose direct children are result rows with `role="option"`.
- `groupedRows()` emits each group header before its corresponding listbox and labels that listbox with the group's `row.label`.
- A page beginning mid-group gets a leading listbox labelled `Clash results`; a collapsed group emits no empty listbox.
- Flat view remains one `Clash results` listbox containing only options.

Interactive group-toggle buttons therefore no longer participate as children or descendants of a listbox option hierarchy. Each emitted listbox owns only option rows. The outer `role="group"` is a non-conflicting wrapper for the collection.

### Behavior and regression coverage

The five new tests in `test/clashpanel/dom/results.dom.mjs` are mechanically relevant rather than markup snapshots:

1. They assert every listbox's direct owned roles are `option`, no button occurs inside a listbox, no option is orphaned, and each non-empty group listbox has its group label.
2. They exercise real Tab order, native-button Enter/Space toggling, and option Space selection, checking the dispatched intents.
3. They focus both a group header and an in-group selected option, rerender, and verify keyed focus restoration.
4. They cover a page that starts mid-group and a collapsed group, including the no-empty-listbox invariant.
5. They pin unchanged flat-view semantics: one `Clash results` listbox containing only options.

The pre-existing tests still cover pointer selection/toggling, `aria-selected`, option Enter behavior, Prev/Next, pagination, non-list states, and ordinary row focus retention. The retained canonical DOM run passed all 82 tests, including the five additions. M1 is fully closed.

## 2. M2 — canonical aggregate gate and timing residual

The retained full log is `docs/reviews/2026-09-27-viewer-clash-panel-t1-t33-m1-m2-remediation-canonical-npm-test.log.txt`:

- 22,983 lines;
- SHA-256 `59b3762d04249a3203c9b973d78a6c1c7d5a58e01a4fca3c4f9913a51f405306`, matching the evidence record;
- one complete `pretest` → `test:offline` → `test:clashpanel:dom` sequence;
- final recorded `exit=0`.

The contemporaneous evidence record identifies Node `v22.23.1`, macOS, the reviewed HEAD plus the M1 working-tree change, and explicitly records that the canonical command was run once without retry. The raw npm output does not itself print the Node version; the current review shell reports `v26.10.0`, so `v22.23.1` is verified as retained run metadata rather than as a value recoverable from the raw log. That does not contradict or invalidate the recorded run.

Verified retained results:

- offline: 3,587 total / 3,586 pass / 0 fail / 1 existing todo;
- DOM: 82/82 pass;
- `test/query/ContainmentModeQuery.test.mjs:64–80`: pass, recorded as test 3184 at 16.648041 ms, within its 1,000 ms bound.

The test, threshold, and collision/Core implementation remain unchanged from `e302b39`. The earlier independent red run demonstrated timing sensitivity but did not establish a Panel regression. The requested acceptance condition is a clean canonical no-retry run, and that condition is now met. A baseline comparison would add information only after another failure; it is not required to accept this successful gate and should not be run merely for confidence. M2 is closed.

## 3. Scope boundary

The remediation working-tree code/test diff is limited to:

- `clashpanel/ui/render/results.js`;
- `test/clashpanel/dom/results.dom.mjs`.

The remaining changes are the handoff and review/evidence records. There is no diff in `collision/`, `clashtest/`, `wwwroot/`, `server.js`, `scripts/run-tests.mjs`, the lockfile, accepted specs, or reviewed plans. No G1–G3, H1–H2, SVF2 verification, OQ-1, host integration, Viewer Adapter, Core, or M4 work was introduced.

The previously recorded non-blocking items—focus loss when a focused control becomes disabled, long duplicate-name disambiguation in the closed select, and optional claim-gate hardening based on unpublished Core values—remain unchanged and outside this remediation.

## 4. Evidence durability and closeout

The retained evidence set is sufficient for T1–T33 closeout:

- the remediation evidence review records authorization, environment, command, RED/GREEN scope, results, timing-test disposition and boundaries;
- the full `.log.txt` preserves the entire canonical run, exact summaries and exit status under a stable hash;
- the implementation status/internal review record has a bounded post-review-remediation section while preserving historical counts;
- the handoff distinguishes the remediation, independent gate result, current working tree and still-unauthorized future work.

No additional raw per-task evidence, baseline comparison, test retry, implementation fix, Core/collision change, or threshold change is required.

## Gate disposition

**T1–T33 implementation accepted and ready for owner-authorized closeout/merge.** Commit, push, merge, G1–G3, H1–H2, SVF2 verification, OQ-1, host integration and any next milestone remain separate explicit owner decisions.
