// clashpanel/core/viewModel.js
// PURE builder: (view input assembled by the controller) -> deep-frozen ViewModel of the exact catalog shape.
// The UI renders ONLY this object (AC-P21). No Viewer/DOM access; all Viewer-derived strings arrive in the input
// already resolved (labels, rows) and stay raw text (the UI inserts them with textContent, AC-P13).
// Task 16 fills `setup` and `run`; `filters`/`results`/`selected` are shape-complete defaults that Tasks 17–19
// replace region by region.
import { PAGE_SIZE } from './constants.js';
import { runHeadline, STATEMENTS, describeAxes, bannersFor, emptyStatement } from './runReport.js';
import { isFilterActive, FILTER_MASK_UNAVAILABLE_TEXT } from './filters.js';
import { GROUPING_UNAVAILABLE_TEXT, MULTI_VALUED_NOTE } from './grouping.js';
import { INTENT } from './intents.js';

// ── shared helpers ──────────────────────────────────────────────────────────────────────────────────────────────

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const NON_TERMINAL = new Set(['preparing', 'planning', 'running', 'stopping', 'finalizing']);

export const READY_TEXT = 'Ready to run';
export const PHASE_TEXT = Object.freeze({
  preparing: 'Preparing…', planning: 'Planning…', running: 'Running…',
  stopping: 'Stopping… (finishing the current step)', finalizing: 'Finalizing…',
});
export const WAITING_TEXT = 'Waiting for another run…';
export const BEFORE_RUN_TEXT = 'Run a test to see clashes.';
export const RUNNING_RESULTS_TEXT = 'Results appear when the run finishes.';
export const DISCARD_TEXT = Object.freeze({
  run: 'The current results are held in memory only. Running again discards them — discard and run?',
  clear: 'These results are held in memory only. Clearing discards them — discard?',
  newTest: 'The current results are held in memory only. Starting a new test discards them — discard?',
});
export const RELEASE_ERROR_TEXT = 'The previous results could not be released cleanly.';
export const SOFT_CHECKING_TEXT = 'Checking whether Soft is available for these models…';
export const ISOLATION_NOTICE = Object.freeze({
  'skipped-external': { kind: 'info', text: 'Isolation was changed elsewhere, so the Panel left it as is.' },
  failed: { kind: 'warning', text: 'Isolation could not be restored.' },
});
const DIAGNOSTICS_PREVIEW_MAX = 10;   // presentation-only: preview lines shown beside "Copy diagnostics" (not a limit)

/** mapAdmissionError().action → the banner button the UI renders (label + the exact intent it dispatches). */
const ADMISSION_ACTIONS = Object.freeze({
  'release-and-retry': { label: 'Release previous results and retry', intent: { type: INTENT.RUN_RELEASE_AND_RETRY } },
  'clear-results': { label: 'Clear results', intent: { type: INTENT.RESULTS_CLEAR } },
});
const CONFIRM_ACTION = Object.freeze({ label: 'Discard unsaved results', intent: { type: INTENT.RESULTS_CLEAR_CONFIRMED } });

// ── setup region ────────────────────────────────────────────────────────────────────────────────────────────────

function describeScope(side, modelName) {
  const parts = side.modelKeys.map((key) => modelName(key));
  for (const [key, dbIds] of Object.entries(side.elements)) {
    if (side.modelKeys.includes(key)) continue;                   // a model entry wins over elements (§6.1)
    parts.push(`${plural(dbIds.length, 'element', 'elements')} in ${modelName(key)}`);
  }
  return parts.length > 0 ? parts.join('; ') : 'Nothing selected';
}

function modelNote(m) {
  if (m.modelKey === null || !m.registered) return `Model ${m.displayName} is not registered`;
  if (!m.loaded) return `Model ${m.displayName} is still loading`;
  return null;
}

function inSide(side, modelKey) {
  return modelKey !== null && (side.modelKeys.includes(modelKey) || Object.prototype.hasOwnProperty.call(side.elements, modelKey));
}

function buildSetupRegion(input) {
  const s = input.setup;
  const { draft, validation, soft } = s;
  const checking = soft.pending === true;
  // While the basis verdict is pending, Soft stays unavailable (Run disabled, fail closed) but is never described
  // as "not a verified basis": the Soft finding reads as a check in progress and no explanation is shown.
  const messages = (validation?.findings ?? []).map((f) => ({
    control: f.control,
    text: checking && (f.code === 'soft-checking' || f.code === 'soft-unavailable') ? SOFT_CHECKING_TEXT : f.text,
  }));
  const scopeA = describeScope(draft.setA, s.modelName);
  const scopeB = draft.selfClash ? 'Same as Set A' : describeScope(draft.setB, s.modelName);
  const modeText = draft.mode === 'soft' ? `Soft (clearance ${draft.clearance === '' ? 'not set' : draft.clearance})` : 'Hard';
  return {
    collapsed: s.collapsed === true,
    summary: `${draft.name} · ${modeText} · A: ${scopeA} · B: ${scopeB}`,
    name: draft.name,
    mode: draft.mode,
    softAvailability: { available: soft.available === true && !checking, pending: checking, explanation: checking ? null : (soft.explanation ?? null) },
    clearance: {
      value: draft.clearance,
      visible: draft.mode === 'soft' && soft.available === true && !checking,   // §6.1: only while Soft is available
      error: messages.find((m) => m.control === 'clearance')?.text ?? null,
    },
    models: s.models.map((m) => ({
      modelKey: m.modelKey, displayName: m.displayName, ready: m.loaded, registered: m.registered,
      inA: inSide(draft.setA, m.modelKey),
      inB: draft.selfClash ? inSide(draft.setA, m.modelKey) : inSide(draft.setB, m.modelKey),
      note: modelNote(m),
    })),
    selfClash: draft.selfClash,
    useSelectionEnabled: s.runActive !== true,
    scope: { A: scopeA, B: scopeB },
    validation: { state: validation?.state === 'ready' ? 'ready' : 'blocked', messages, issuesTruncated: validation?.issuesTruncated === true },
    setupChangedSinceRun: s.setupChangedSinceRun === true,
  };
}

// ── run region ──────────────────────────────────────────────────────────────────────────────────────────────────

export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function progressOf(run) {
  const snap = run.snapshot ?? {};
  const num = (v) => (Number.isFinite(v) ? v : 0);
  return {
    fraction: Number.isFinite(snap.fractionProcessed) ? snap.fractionProcessed : null,   // null ⇒ indeterminate
    unitsEvaluated: num(snap.unitsEvaluated),
    unitsTotal: num(snap.unitsTotal),
    resultsFound: num(snap.resultsFound),
    caveatCount: num(snap.caveatCount),
    elapsedText: formatElapsed(run.elapsedMs),                                            // the Panel's clock; no ETA
  };
}

function headlineOf(input) {
  const m = input.run.machine;
  if (m.phase === 'idle') return READY_TEXT;
  if (m.phase === 'preparing' && m.waitingForOtherRun === true) return WAITING_TEXT;
  if (PHASE_TEXT[m.phase] !== undefined) return PHASE_TEXT[m.phase];
  const d = input.displayed;
  if (d === null || d.resultSet === null) return STATEMENTS.NO_RESULT_SET;
  const set = d.resultSet;
  return runHeadline({ status: set.outcome.status, total: set.results.length, coverage: set.outcome.coverage, resultSet: set });
}

function countsOf(input) {
  const l = input.list;
  return { total: l === null ? null : l.total, filtered: l === null ? null : l.filtered };
}

/** Coverage / Integrity / Freshness, always together (§7.3); freshness shows the at-seal value while pending. */
function badgesOf(input) {
  const d = input.displayed;
  if (d === null || d.resultSet === null) return null;
  return describeAxes(d.resultSet.outcome, d.freshnessPending ? null : d.freshness);
}

/** Controller-owned banners (admission error, discard confirmation, release errors, residency notice). */
function controllerBanners(input) {
  const r = input.run;
  const banners = [];
  if (r.admission) {
    const action = ADMISSION_ACTIONS[r.admission.action];
    banners.push({ id: 'admission-error', kind: 'error', text: r.admission.text, ...(action ? { action: { label: action.label, intent: { ...action.intent } } } : {}) });
  }
  if (r.confirm) {
    banners.push({ id: 'confirm-discard-unsaved', kind: 'warning', text: DISCARD_TEXT[r.confirm.for] ?? DISCARD_TEXT.clear, action: { label: CONFIRM_ACTION.label, intent: { ...CONFIRM_ACTION.intent } } });
  }
  if (r.releaseErrors.length > 0 || r.releaseStuck === true) banners.push({ id: 'release-error', kind: 'warning', text: RELEASE_ERROR_TEXT, details: r.releaseErrors.map((e) => String(e?.name ?? 'Error')) });
  if (r.residencyNotice) banners.push({ id: 'residency-notice', kind: 'info', text: r.residencyNotice });
  const iso = ISOLATION_NOTICE[r.isolationNotice];
  if (iso) banners.push({ id: 'isolation-notice', kind: iso.kind, text: iso.text });
  return banners;
}

function runBanners(input) {
  const banners = controllerBanners(input);
  const d = input.displayed;
  if (d === null) return banners;
  const report = bannersFor({
    terminal: input.run.machine.terminal, resultSet: d.resultSet,
    freshness: d.freshnessPending ? null : d.freshness, setupChanged: input.run.setupChanged, persistence: d.persistence,
  });
  const texts = new Set(report.map((b) => b.text));
  // The residency notice and the report's held-in-memory banner say the same thing: keep one.
  return [...report, ...banners.filter((b) => !(b.id === 'residency-notice' && texts.has(b.text)))];
}

/** Short plain-text preview for "Copy diagnostics" (≤ DIAGNOSTICS_PREVIEW_MAX lines); the full JSON comes from
 *  dispatch(DIAGNOSTICS_COPY). Every value is Core data rendered as text (no markup). */
function diagnosticsOf(input) {
  const set = input.displayed?.resultSet ?? null;
  if (set === null) return null;
  const lines = [`Status: ${set.outcome?.status ?? 'unknown'} · coverage ${set.outcome?.coverage ?? '?'} · integrity ${set.outcome?.integrity ?? '?'}`];
  for (const reason of set.outcome?.reasons ?? []) lines.push(`Reason: ${String(reason)}`);
  for (const gap of set.ledger?.planningGaps ?? []) lines.push(`Planning gap: ${String(gap?.phase ?? '?')} — ${String(gap?.cause ?? '?')}`);
  const total = set.diagnostics?.total;
  if (Number.isFinite(total)) lines.push(`Diagnostics: ${total}`);
  if (set.diagnostics?.truncated === true) lines.push(STATEMENTS.DIAGNOSTICS_TRUNCATED);
  return { available: true, preview: lines.slice(0, DIAGNOSTICS_PREVIEW_MAX) };
}

/** aria-live text for the status region. */
function describeStatusLive(run) {
  return run.headline;
}

function buildRunRegion(input) {
  const r = input.run;
  const m = r.machine;
  const state = m.phase;
  const run = {
    state,
    doneKind: state === 'done' ? (m.terminal?.status ?? null) : null,
    canRun: r.canRun === true,
    canStop: r.canStop === true,
    progress: NON_TERMINAL.has(state) ? progressOf(r) : null,
    headline: headlineOf(input),
    counts: countsOf(input),
    badges: badgesOf(input),
    banners: runBanners(input),
    diagnostics: diagnosticsOf(input),
    statusLive: '',
    waitingForOtherRun: m.waitingForOtherRun === true,
  };
  run.statusLive = describeStatusLive(run);
  return run;
}

// ── run details (spec §8.4) ──────────────────────────────────────────────────────────────────────────────────────

const text = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function basisText(verdict) {
  if (verdict === null || verdict === undefined) return 'single model (no cross-model comparison)';
  if (verdict.state === 'verified') return `verified (${text(verdict.basisKey)})`;
  return `${text(verdict.state)}: ${text(verdict.reason)}`;
}

/**
 * "Run details" lines, built ONLY from the sealed set plus the Panel-local run record (the Soft basis verdict the
 * run was admitted under — not part of the sealed set). All values are plain strings; model names and Core values
 * pass through as raw text (the UI uses textContent). `provenance.models[].elementCount` is never read (G-EC, AC-P12).
 */
export function buildRunDetails({ resultSet, runRecord = null, modelName = (key) => String(key) }) {
  const lines = [];
  const add = (label, value) => lines.push({ label, value: text(value) });
  const definition = resultSet.definition ?? null;
  if (definition === null) add('Definition', 'not recorded (the run ended before its definition was resolved)');
  else {
    add('Test', definition.name);
    add('Mode', definition.mode === 'clearance' ? 'Soft (clearance)' : 'Hard (volume overlap)');
    if (definition.mode === 'clearance') add('Clearance', definition.clearance);
  }
  const provenance = resultSet.provenance ?? {};
  add('Started', provenance.startedAt);
  add('Finished', provenance.finishedAt);
  add('Determinism', provenance.determinismClass);
  for (const m of Array.isArray(provenance.models) ? provenance.models : []) {
    add(`Model ${modelName(m.modelKey)}`, `key ${text(m.modelKey)} · version ${text(m.modelVersion)} · binding generation ${text(m.bindingGeneration)}`);
  }
  const exclusions = Array.isArray(provenance.libraryExclusions) ? provenance.libraryExclusions : [];
  add('Library exclusions', exclusions.length === 0 ? 'none' : exclusions.map(text).join('; '));
  if (definition?.mode === 'clearance') add('Measurement basis (at run start)', basisText(runRecord?.basisVerdict));
  return lines;
}

// ── filters / results / selected regions (Task 16 defaults) ────────────────────────────────────────────────────

export const DEFAULT_SORT_OPTIONS = Object.freeze([{ value: 'default', label: 'Default order' }]);

function defaultFilters() {
  return {
    text: '', models: [], modelOptions: [], maxGap: { visible: false, value: '', max: null, error: null },
    unverified: false, hasLocation: false, elementOnly: null, groupBy: 'none', groupingNote: null,
    sort: 'default', sortOptions: DEFAULT_SORT_OPTIONS.map((o) => ({ ...o })), active: false, busy: false,
  };
}

export const SORT_LABELS = Object.freeze({
  default: 'Default order', 'gap-asc': 'Gap (smallest first)', 'group-count': 'Group size (largest first)', 'group-label': 'Group name',
});

function buildFiltersRegion(input) {
  const l = input.list;
  if (l === null) return defaultFilters();
  const sortValues = ['default', ...(l.isSoft ? ['gap-asc'] : []), ...(l.view === 'grouped' ? ['group-count', 'group-label'] : [])];
  return {
    text: l.textDraft,
    models: [...l.spec.models],
    modelOptions: l.modelOptions,
    maxGap: { visible: l.isSoft === true, value: l.maxGapText, max: l.clearance, error: l.maxGapError },
    unverified: l.spec.unverified === true,
    hasLocation: l.spec.hasLocation === true,
    elementOnly: l.elementOnly,
    groupBy: l.groupBy,
    groupingNote: l.groupBy === 'element' && l.groupingState === 'unavailable'
      ? (GROUPING_UNAVAILABLE_TEXT[l.groupingReason] ?? GROUPING_UNAVAILABLE_TEXT.error) : null,
    sort: l.sort,
    sortOptions: sortValues.map((value) => ({ value, label: SORT_LABELS[value] })),
    active: isFilterActive(l.spec),
    busy: l.busy === true,
  };
}

export const NO_SELECTION_TEXT = 'No clash selected';

function resultsBase() {
  return {
    state: 'before-run', message: BEFORE_RUN_TEXT, lines: [], view: 'flat',
    page: { index: 0, count: 0, size: PAGE_SIZE }, rows: [], multiValuedNote: null, hiddenByFiltersNote: false,
    nav: { canPrev: false, canNext: false, label: NO_SELECTION_TEXT },
  };
}

export const EMPTY_FILTERED_TEXT = 'No clashes match the current filters.';

export const INDEX_FAILED_TEXT = 'The result set could not be read. Details are available to copy.';

/**
 * The ONE (claim, freshness) pair the empty-set wording may use (review H1) — this view-model builder owns the combined
 * decision, `emptyStatement` (T11) is its pure gate. The controller commits both halves together (T17); this function
 * additionally refuses to hand over a half-settled pair: unless BOTH are settled the statement sees `(null, null)`
 * and words "checking…", never a clearance.
 */
function claimGateOf(d) {
  const settled = d.claimPending !== true && d.freshnessPending !== true && d.claim !== null && d.freshness !== null;
  return settled ? { claim: d.claim, freshness: d.freshness } : { claim: null, freshness: null };
}

/** Results-region state machine (§14.4 "State coverage inside the Results region"): never a bare "No clashes". */
function buildResultsRegion(input) {
  const base = resultsBase();
  if (NON_TERMINAL.has(input.run.machine.phase)) return { ...base, state: 'running', message: RUNNING_RESULTS_TEXT };
  const d = input.displayed;
  if (d === null) return base;
  if (d.resultSet === null) return { ...base, state: 'error', message: STATEMENTS.NO_RESULT_SET };
  const l = input.list;
  if (l === null) return { ...base, state: 'error', message: INDEX_FAILED_TEXT };
  const listed = {
    ...base, view: l.view, page: { ...l.page }, rows: l.rows,
    multiValuedNote: l.view === 'grouped' ? MULTI_VALUED_NOTE : null,
    hiddenByFiltersNote: l.hiddenByFilters === true,
    nav: l.nav ? { ...l.nav } : base.nav,
  };
  if (l.total === 0) {
    const statement = emptyStatement({ resultSet: d.resultSet, ...claimGateOf(d), modelName: input.setup.modelName });
    const claimed = statement?.kind === 'claim' || statement?.kind === 'qualified-claim';
    return { ...listed, rows: [], state: claimed ? 'empty-claim' : 'empty-nonclaim', message: statement?.text ?? STATEMENTS.NON_CLAIM, lines: [...(statement?.lines ?? [])] };
  }
  if (l.maskUnavailable === true) return { ...listed, rows: [], state: 'error', message: FILTER_MASK_UNAVAILABLE_TEXT };
  if (l.filtered === 0) return { ...listed, rows: [], state: 'empty-filtered', message: EMPTY_FILTERED_TEXT };
  if (l.groupBy === 'element' && l.groupingState === 'unavailable') {
    return { ...listed, state: 'grouping-unavailable', message: GROUPING_UNAVAILABLE_TEXT[l.groupingReason] ?? GROUPING_UNAVAILABLE_TEXT.error };
  }
  return { ...listed, state: 'list', message: null };
}

/** Selected Clash region (§9.3, §14.4 region 5): detail survives filters/pages; actions carry enable reasons. */
function buildSelectedRegion(input) {
  const s = input.selected;
  if (s === null) return null;
  const blocked = s.anyLive !== true ? `Viewer actions are unavailable: ${s.liveness}.` : null;   // AC-P7
  return {
    resultId: s.resultId, ordinal: s.ordinal, side1: { ...s.side1 }, side2: { ...s.side2 }, gap: s.gap,
    hasLocation: s.hasLocation, liveness: s.liveness, notes: [...s.notes], hiddenByFilters: s.hiddenByFilters === true,
    actions: {
      focus: { enabled: blocked === null, reason: blocked },
      isolate: {
        enabled: blocked === null && s.isolation.available,
        checked: s.toggles.isolate === true && s.isolation.available,
        reason: blocked ?? (s.isolation.available ? null : s.isolation.reason),
      },
      markers: { enabled: blocked === null, checked: s.toggles.markers === true, reason: blocked },
      focusOnSelect: { checked: s.toggles.focusOnSelect === true },
      backToAll: { enabled: true },
    },
  };
}

// ── entry point ─────────────────────────────────────────────────────────────────────────────────────────────────

export function buildViewModel(input) {
  return deepFreeze({
    version: input.version,
    setup: buildSetupRegion(input),
    run: buildRunRegion(input),
    filters: buildFiltersRegion(input),
    results: buildResultsRegion(input),
    selected: buildSelectedRegion(input),
  });
}
