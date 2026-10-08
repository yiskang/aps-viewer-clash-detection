// test/clashpanel/dom/support/vmFixtures.mjs
//
// Plain-JSON ViewModel parts (shape frozen in plan catalog §4, core/viewModel.js) for the DOM renderer tests.
// Renderers are pure functions of the ViewModel, so these literals are sufficient; no controller is involved.
// Each builder takes a shallow `over` object merged at the top level of that part. No imports; no Node APIs.
export const HOSTILE = '<img src=x onerror=window.__pwned=1>';
export const HOSTILE2 = '"><script>window.__pwned=2</script>';

export function setupVm(over = {}) {
  return {
    collapsed: false,
    summary: 'Clash test 1 · Hard · A: Architecture · B: Structure',
    name: 'Clash test 1',
    mode: 'hard',
    softChecking: false,
    basis: {
      required: false, state: null, headline: null, message: null, detail: null, status: null, value: '',
      options: [{ value: '', label: 'Choose units…' }, { value: 'mm', label: 'mm' }, { value: 'cm', label: 'cm' }, { value: 'm', label: 'm' },
        { value: 'in', label: 'in' }, { value: 'ft', label: 'ft' }, { value: 'raw', label: 'Model units (raw, unverified)' }],
      unitLabel: '', error: null,
    },
    clearance: { value: '', visible: false, unitLabel: '', error: null },
    newTest: { enabled: true },
    models: [
      { modelKey: 'mA', displayName: 'Architecture', ready: true, registered: true, inA: true, inB: false, note: null },
      { modelKey: 'mB', displayName: 'Structure', ready: true, registered: true, inA: false, inB: true, note: null },
      { modelKey: 'mC', displayName: 'Mechanical', ready: false, registered: true, inA: false, inB: false, note: 'Model Mechanical is still loading' },
    ],
    selfClash: false,
    overlap: [],
    overlapText: null,
    useSelectionEnabled: true,
    scope: { A: '1 model', B: '1 model' },
    validation: { state: 'ready', messages: [], issuesTruncated: false },
    setupChangedSinceRun: false,
    ...over,
  };
}

export function runVm(over = {}) {
  return {
    state: 'idle', doneKind: null, canRun: true, canStop: false,
    progress: null, headline: 'Ready to run',
    counts: { total: null, filtered: null },
    badges: null, banners: [], diagnostics: null, details: null, statusLive: 'Ready to run', waitingForOtherRun: false,
    ...over,
  };
}

export function filtersVm(over = {}) {
  return {
    text: '', models: [],
    modelOptions: [{ modelKey: 'mA', label: 'Architecture' }, { modelKey: 'mB', label: 'Structure' }],
    maxGap: { visible: false, value: '', max: null, error: null },
    unverified: false, hasLocation: false, elementOnly: null,
    groupBy: 'none', groupingNote: null,
    sort: 'default',
    sortOptions: [{ value: 'default', label: 'Default' }, { value: 'gap-asc', label: 'Gap (smallest first)' }],
    active: false, busy: false,
    ...over,
  };
}

export function side(modelKey, modelName, label, dbId) {
  return { modelKey, modelName, label, dbId };
}

export function resultRow(i, over = {}) {
  const resultId = `r${i}`;
  return {
    kind: 'result', key: `-|${resultId}`, resultId, groupId: null, ordinal: i + 1,
    side1: side('mA', 'Architecture', `Wall-${i}`, 100 + i),
    side2: side('mB', 'Structure', `Beam-${i}`, 200 + i),
    gap: null, badges: [], liveness: 'live', selected: false,
    ...over,
  };
}

export function groupRow(groupId, over = {}) {
  return { kind: 'group', key: `g|${groupId}`, groupId, label: `Group ${groupId}`, count: 3, filteredCount: 3, expanded: false, ...over };
}

export function resultsVm(over = {}) {
  return {
    state: 'list', message: null, lines: [], view: 'flat',
    page: { index: 0, count: 1, size: 50 },
    rows: [resultRow(0), resultRow(1), resultRow(2)],
    multiValuedNote: null, hiddenByFiltersNote: false,
    nav: { canPrev: false, canNext: true, label: 'No clash selected', scoped: false },
    ...over,
  };
}

export function selectedVm(over = {}) {
  return {
    resultId: 'r1', ordinal: 2,
    side1: side('mA', 'Architecture', 'Wall-1', 101),
    side2: side('mB', 'Structure', 'Beam-1', 201),
    gap: null, hasLocation: true, liveness: 'live', notes: [], hiddenByFilters: false,
    actions: {
      focus: { enabled: true, reason: null },
      isolate: { enabled: true, checked: false, reason: null },
      markers: { enabled: true, checked: true, reason: null },
      focusOnSelect: { checked: true },
      backToAll: { enabled: true },
    },
    ...over,
  };
}

export function panelVm(over = {}) {
  return {
    version: 1,
    setup: setupVm(), run: runVm(), filters: filtersVm(), results: resultsVm(), selected: selectedVm(),
    ...over,
  };
}
