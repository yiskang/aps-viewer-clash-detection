// test/clashpanel/support/faultControls.mjs — Work plan re-review M1: THE single explicit mapping from every editor
// INTENT to the user-facing control(s) that dispatch it, used to pin "fault overlay = FAULT_POLICY" mechanically:
//   gate(editorVm) → the ViewModel value the fault overlay must set to {enabled:false, reason} when the intent is
//                    blocked, and must leave unchanged when it is allowed;
//   dom            → selectors of the rendered node(s) the managed renderer must disable and describe when blocked.
//   variant        → an ALTERNATIVE dispatch site of the same intent that cannot render together with `dom` (a
//                    mutually exclusive state), checked against faultVariantEditorVm() (Codex targeted review Medium).
// An intent with no control in the editor Panel is declared in NON_USER_FACING with its reason. A new INTENT, or an
// intent moved between allow and block in FAULT_POLICY, fails Task 9 / Task 11 until this table and the overlay agree.
// Plain data + pure functions; Node-side only (the DOM test passes `dom` selectors into the page as strings).
import { INTENT } from '../../../clashpanel/core/intents.js';
import { panelVm, setupVm, runVm, filtersVm, resultsVm, selectedVm, resultRow, groupRow } from '../dom/support/vmFixtures.mjs';

const bannerAction = (type) => (vm) => vm.run.banners.find((b) => b.action?.intent?.type === type)?.action;
const lockedBy = (enabled, part) => ({ enabled, reason: part?.reason ?? null });
const key = (k) => `[data-key="${k}"]`;

export const NON_USER_FACING = Object.freeze({
  [INTENT.TEST_LOAD]: 'manager-only seam (a): dispatched by the manager; dropped from UI/facade dispatch',
  [INTENT.TEST_LABEL_SCOPE]: 'manager-only seam (e): dispatched by the manager; dropped from UI/facade dispatch',
  [INTENT.PANEL_HIDDEN]: 'shell visibility lifecycle (ClashDockingPanel.js), not a control in the Panel body',
  [INTENT.PANEL_SHOWN]: 'shell visibility lifecycle (ClashDockingPanel.js), not a control in the Panel body',
});

export const FAULT_CONTROLS = Object.freeze({
  // Setup region (setup.js) — one shared setup lock; New test and Use selection also have their own existing gates.
  [INTENT.SETUP_NAME]: { gate: (vm) => vm.setup.locked, dom: [key('setup-name')] },
  [INTENT.SETUP_MODE]: { gate: (vm) => vm.setup.locked, dom: ['[data-key^="setup-mode-"]'] },
  [INTENT.SETUP_CLEARANCE]: { gate: (vm) => vm.setup.locked, dom: [key('setup-clearance')] },
  [INTENT.SETUP_BASIS]: { gate: (vm) => vm.setup.locked, dom: [key('setup-basis')] },
  [INTENT.SETUP_TOGGLE_MODEL]: { gate: (vm) => vm.setup.locked, dom: ['section[data-region="setup"] .clash-model-list input'] },
  [INTENT.SETUP_USE_SELECTION]: { gate: (vm) => lockedBy(vm.setup.useSelectionEnabled, vm.setup.locked), dom: ['[data-key^="setup-use-selection-"]'] },
  [INTENT.SETUP_SELF_CLASH]: { gate: (vm) => vm.setup.locked, dom: [key('setup-self-clash')] },
  [INTENT.SETUP_NEW_TEST]: { gate: (vm) => vm.setup.newTest, dom: [key('setup-new-test')] },
  [INTENT.SETUP_TOGGLE_COLLAPSED]: { gate: (vm) => vm.setup.collapsed, dom: [key('setup-toggle-collapsed')] },
  // Run region (run.js) — banner actions carry their intent as data.
  [INTENT.RUN_START]: { gate: (vm) => lockedBy(vm.run.canRun, vm.run.locked), dom: [key('run-start')] },
  [INTENT.RUN_STOP]: { gate: (vm) => vm.run.canStop, dom: [key('run-stop')] },
  [INTENT.RESULTS_CLEAR]: { gate: (vm) => vm.run.state, dom: [key('results-clear')],
    variant: { gate: bannerAction(INTENT.RESULTS_CLEAR), dom: [key('banner-admission-error-action')] } },   // admission 'clear-results'
  [INTENT.RESULTS_CLEAR_CONFIRMED]: { gate: bannerAction(INTENT.RESULTS_CLEAR_CONFIRMED), dom: [key('banner-confirm-discard-unsaved-action')] },
  [INTENT.RUN_RELEASE_AND_RETRY]: { gate: bannerAction(INTENT.RUN_RELEASE_AND_RETRY), dom: [key('banner-admission-error-action')] },
  [INTENT.DIAGNOSTICS_COPY]: { gate: (vm) => vm.run.diagnostics, dom: [key('diagnostics-copy')] },
  // Manager header (manager.js) — shown while the editor asks for a confirmation.
  [INTENT.CONFIRM_CANCEL]: { gate: (vm) => vm.test.pendingConfirm, dom: [key('editor-confirm-cancel')] },
  // Filters region (filters.js) and the selected clash's "Show only this element" (selected.js).
  [INTENT.FILTER_TEXT]: { gate: (vm) => vm.filters, dom: [key('filter-text')] },
  [INTENT.FILTER_MODEL]: { gate: (vm) => vm.filters, dom: [key('filter-model')] },
  [INTENT.FILTER_MAX_GAP]: { gate: (vm) => vm.filters, dom: [key('filter-max-gap')] },
  [INTENT.FILTER_UNVERIFIED]: { gate: (vm) => vm.filters, dom: [key('filter-unverified')] },
  [INTENT.FILTER_HAS_LOCATION]: { gate: (vm) => vm.filters, dom: [key('filter-has-location')] },
  [INTENT.FILTER_ELEMENT]: { gate: (vm) => [vm.filters.elementOnly, vm.selected.side1, vm.selected.side2], dom: [key('filter-element-clear'), key('selected-only-1'), key('selected-only-2')] },
  [INTENT.FILTER_CLEAR]: { gate: (vm) => vm.filters.active, dom: [key('filter-clear')],
    variant: { gate: (vm) => vm.results.state, dom: [key('results-clear-filters')] } },                  // empty-filtered results
  [INTENT.GROUP_MODE]: { gate: (vm) => vm.filters.groupBy, dom: ['[data-key^="group-"]'] },
  [INTENT.SORT_SET]: { gate: (vm) => vm.filters.sort, dom: [key('sort')] },
  // Results region (results.js).
  [INTENT.GROUP_TOGGLE]: { gate: (vm) => vm.results.rows.filter((r) => r.kind === 'group'), dom: ['.clash-group-row button'] },
  [INTENT.NAV_SELECT]: { gate: (vm) => vm.results.select, dom: ['section[data-region="results"] .clash-row'] },
  [INTENT.NAV_PREV]: { gate: (vm) => lockedBy(vm.results.nav.canPrev, vm.results.nav.locked), dom: [key('nav-prev')] },
  [INTENT.NAV_NEXT]: { gate: (vm) => lockedBy(vm.results.nav.canNext, vm.results.nav.locked), dom: [key('nav-next')] },
  [INTENT.NAV_PAGE]: { gate: (vm) => vm.results.page, dom: [key('page-prev'), key('page-next')] },
  // Selected clash region (selected.js).
  [INTENT.ACTION_FOCUS]: { gate: (vm) => vm.selected.actions.focus, dom: [key('action-focus')] },
  [INTENT.ACTION_ISOLATE]: { gate: (vm) => vm.selected.actions.isolate, dom: [key('action-isolate')] },
  [INTENT.ACTION_MARKERS]: { gate: (vm) => vm.selected.actions.markers, dom: [key('action-markers')] },
  [INTENT.ACTION_FOCUS_ON_SELECT]: { gate: (vm) => vm.selected.actions.focusOnSelect, dom: [key('action-focus-on-select')] },
  [INTENT.ACTION_BACK_TO_ALL]: { gate: (vm) => vm.selected.actions.backToAll, dom: [key('action-back-to-all')] },
});

function deepFrozen(v) {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) deepFrozen(v[k]); }
  return v;
}

/**
 * A full editor ViewModel (shape: core/viewModel.js; deep-frozen like buildViewModel's) in which EVERY control of
 * FAULT_CONTROLS is rendered and enabled: Soft setup with clearance + units, a done run that can still be stopped,
 * both banner actions, diagnostics, every filter (max gap, element-only, active), a grouped page with a selected row
 * and enabled Previous/Next/page buttons, a live selected clash, and an editor confirmation waiting.
 */
export function faultFixtureEditorVm() {
  return deepFrozen(panelVm({
    test: { testId: 'T-1', runActive: false, heldUnsaved: true, pendingConfirm: true, lastRun: null },
    setup: setupVm({
      mode: 'soft',
      basis: { ...setupVm().basis, required: true, state: 'unavailable', headline: 'Choose the units', message: 'Units are not verified.', value: 'mm' },
      clearance: { value: '5', visible: true, unitLabel: 'mm', error: null },
    }),
    run: runVm({
      state: 'done', doneKind: 'completed', canRun: true, canStop: true,
      diagnostics: { available: true, preview: ['line 1'] },
      banners: [
        { id: 'admission-error', kind: 'error', text: 'Previous results are still held.', action: { label: 'Release previous results and retry', intent: { type: INTENT.RUN_RELEASE_AND_RETRY } } },
        { id: 'confirm-discard-unsaved', kind: 'warning', text: 'Discard unsaved results?', action: { label: 'Discard unsaved results', intent: { type: INTENT.RESULTS_CLEAR_CONFIRMED } } },
      ],
    }),
    filters: filtersVm({ maxGap: { visible: true, value: '', max: 5, error: null }, elementOnly: { label: 'Wall-1' }, active: true, groupBy: 'element' }),
    results: resultsVm({
      view: 'grouped', page: { index: 1, count: 3, size: 50 },
      rows: [groupRow('g1', { expanded: true }), resultRow(0, { groupId: 'g1' }), resultRow(1, { groupId: 'g1', selected: true })],
      nav: { canPrev: true, canNext: true, label: 'Clash 2 of 3', scoped: false },
    }),
    selected: selectedVm(),
  }));
}

/** The mutually exclusive alternatives of faultFixtureEditorVm(): the admission banner offering Clear results (instead
 *  of Release and retry) and an empty-filtered results region (its own Clear filters button; no rows, no nav). */
export function faultVariantEditorVm() {
  const base = faultFixtureEditorVm();
  return deepFrozen({
    ...base,
    run: { ...base.run, banners: [{ id: 'admission-error', kind: 'error', text: 'Previous results are still held.', action: { label: 'Clear results', intent: { type: INTENT.RESULTS_CLEAR } } }] },
    results: { ...base.results, state: 'empty-filtered', message: 'No clashes match the current filters.', rows: [] },
  });
}

/** The cases the equivalence tests render: `main` checks every entry's {gate, dom}; `variant` checks every `variant`. */
export function faultCases() {
  const all = Object.entries(FAULT_CONTROLS);
  return [
    { name: 'main', vm: faultFixtureEditorVm(), controls: Object.fromEntries(all.map(([type, c]) => [type, { gate: c.gate, dom: c.dom }])) },
    { name: 'variant', vm: faultVariantEditorVm(), controls: Object.fromEntries(all.filter(([, c]) => c.variant).map(([type, c]) => [type, c.variant])) },
  ];
}
