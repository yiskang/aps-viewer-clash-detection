// clashpanel/core/viewModel.js
// PURE builder: (view input assembled by the controller) -> deep-frozen ViewModel of the exact catalog shape.
// The UI renders ONLY this object (AC-P21). No Viewer/DOM access; all Viewer-derived strings arrive in the input
// already resolved (labels, rows) and stay raw text (the UI inserts them with textContent, AC-P13).
// Task 16 fills `setup` and `run`; `filters`/`results`/`selected` are shape-complete defaults that Tasks 17–19
// replace region by region.
import { PAGE_SIZE } from './constants.js';
import { runHeadline, STATEMENTS } from './runReport.js';
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

function countsOf() {
  return { total: null, filtered: null };
}

function badgesOf() {
  return null;
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
  return controllerBanners(input);
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

// ── filters / results / selected regions (Task 16 defaults) ────────────────────────────────────────────────────

export const DEFAULT_SORT_OPTIONS = Object.freeze([{ value: 'default', label: 'Default order' }]);

function defaultFilters() {
  return {
    text: '', models: [], modelOptions: [], maxGap: { visible: false, value: '', max: null, error: null },
    unverified: false, hasLocation: false, elementOnly: null, groupBy: 'none', groupingNote: null,
    sort: 'default', sortOptions: DEFAULT_SORT_OPTIONS.map((o) => ({ ...o })), active: false, busy: false,
  };
}

function buildFiltersRegion() {
  return defaultFilters();
}

export const NO_SELECTION_TEXT = 'No clash selected';

function resultsBase() {
  return {
    state: 'before-run', message: BEFORE_RUN_TEXT, lines: [], view: 'flat',
    page: { index: 0, count: 0, size: PAGE_SIZE }, rows: [], multiValuedNote: null, hiddenByFiltersNote: false,
    nav: { canPrev: false, canNext: false, label: NO_SELECTION_TEXT },
  };
}

function buildResultsRegion(input) {
  const base = resultsBase();
  if (NON_TERMINAL.has(input.run.machine.phase)) return { ...base, state: 'running', message: RUNNING_RESULTS_TEXT };
  const d = input.displayed;
  if (d === null) return base;
  if (d.resultSet === null) return { ...base, state: 'error', message: STATEMENTS.NO_RESULT_SET };
  return { ...base, state: 'list', message: null };                // rows arrive with Task 17's results pipeline
}

function buildSelectedRegion() {
  return null;
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
