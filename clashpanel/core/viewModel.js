// clashpanel/core/viewModel.js
// PURE builder: (view input assembled by the controller) -> deep-frozen ViewModel of the exact catalog shape.
// The UI renders ONLY this object (AC-P21). No Viewer/DOM access; all Viewer-derived strings arrive in the input
// already resolved (labels, rows) and stay raw text (the UI inserts them with textContent, AC-P13).
//
// ViewInput (built by controller.js `viewInput`; documented here because this builder is its only consumer):
//   { version,
//     setup:     { draft, validation, soft:{available,pending,verdict,explanation}, models:[{modelKey|null,displayName,loaded,registered}],
//                  modelName(key), setupChangedSinceRun, collapsed, runActive },
//     run:       { machine (runMachine RunState), snapshot|null, elapsedMs|null, canRun, canStop, admission|null, confirm|null,
//                  releaseErrors[], releaseStuck?, residencyNotice|null, setupChanged, isolationNotice|null },
//     displayed: null | { runId, status, resultSet|null, persistence, freshness|null, freshnessPending, claim|null, claimPending, summary|null,
//                  runRecord?: null | { basisVerdict, basis:{state,unit} } },
//     list:      null | { total, filtered|null, busy, maskUnavailable?, spec, textDraft, maxGapText, maxGapError, groupBy, groupingState,
//                  groupingReason, sort, isSoft, clearance, modelOptions, elementOnly, view, page, rows, nav, hiddenByFilters },
//     selected:  null | { resultId, ordinal, side1, side2, gap, hasLocation, liveness, notes, hiddenByFilters, anyLive, isolation, toggles } }
//     test:      { testId, draft, runActive, heldUnsaved, pendingConfirm, lastRun|null }  (spec §26.2 (b); manager seam)
import { PAGE_SIZE, GAP_UNIT_LABEL, BASIS_UNITS, BASIS_RAW, SOFT_BASIS_HEADLINE, SOFT_BASIS_NOT_VERIFIED_TEXT } from './constants.js';
import { resolveBasis, BASIS_STATE, basisProvenanceText } from './measurementBasis.js';
import { participatingModelKeys } from './setupValidation.js';
import { selectionEntriesOf } from './draft.js';
import { runHeadline, STATEMENTS, describeAxes, bannersFor, emptyStatement } from './runReport.js';
import { isFilterActive, FILTER_MASK_UNAVAILABLE_TEXT } from './filters.js';
import { GROUPING_UNAVAILABLE_TEXT } from './grouping.js';
import { groupModeOf } from './groupModes.js';
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
export const NOT_READY_TEXT = 'Not ready to run';
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

export function describeScope(side, modelName) {
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

/** Models present (whole-model or element entries) in BOTH sets — by modelKey only, never by display name. Empty under selfClash. */
function overlapOf(draft, models, modelName) {
  if (draft.selfClash) return [];
  const inB = new Set(selectionEntriesOf(draft.setB).map((e) => e.modelKey));
  return selectionEntriesOf(draft.setA).map((e) => e.modelKey).filter((k) => inB.has(k)).sort().map((modelKey) => {
    const m = models.find((x) => x.modelKey === modelKey);
    return Object.freeze({ modelKey, displayName: m ? m.displayName : modelName(modelKey) });
  });
}

function overlapTextOf(overlap) {
  if (overlap.length === 0) return null;
  return overlap.length === 1 ? `Self-clash: ${overlap[0].displayName} is in both sets.` : `Self-clash: ${overlap.length} models are in both sets.`;
}

const BASIS_UNIT_OPTIONS = Object.freeze([
  { value: '', label: 'Choose units…' },
  ...BASIS_UNITS.map((u) => ({ value: u, label: u })),
  { value: BASIS_RAW, label: 'Model units (raw, unverified)' },
].map((o) => Object.freeze(o)));

/**
 * Soft measurement basis (owner decision 2026-10-07). While the host verdict is pending nothing about the basis is
 * shown (fail closed, never "not verified" yet). Not verified (and models chosen): the user may attest a unit or pick
 * raw model units — never labelled `verified`. Hard is unaffected and says so.
 */
function buildBasisView({ draft, soft, checking, participants }) {
  const softMode = draft.mode === 'soft';
  const verified = soft.available === true && !checking;
  const required = softMode && !checking && !verified && participants > 0;
  const basis = resolveBasis({ basisUnit: draft.basisUnit, verifiedBasis: verified && participants > 0 });
  const reason = typeof soft.verdict?.reason === 'string' && soft.verdict.reason.length > 0 ? soft.verdict.reason : null;
  let status = null;
  if (required && basis.state === BASIS_STATE.USER_SUPPLIED) status = `User-supplied: all selected models are in ${basis.unit}. Not verified.`;
  else if (required && basis.state === BASIS_STATE.RAW) status = 'Raw model units. Not verified — no physical unit is implied.';
  return {
    required,
    state: softMode && !checking && participants > 0 ? basis.state : null,
    headline: required ? SOFT_BASIS_HEADLINE : null,
    message: required ? SOFT_BASIS_NOT_VERIFIED_TEXT : null,
    detail: required && reason !== null ? reason : null,
    status,
    value: draft.basisUnit,
    options: BASIS_UNIT_OPTIONS,
    unitLabel: basis.state === BASIS_STATE.VERIFIED ? GAP_UNIT_LABEL : basis.state === BASIS_STATE.USER_SUPPLIED ? basis.unit : basis.state === BASIS_STATE.RAW ? 'model units (raw)' : '',
  };
}

function buildSetupRegion(input) {
  const s = input.setup;
  const { draft, validation, soft } = s;
  const checking = soft.pending === true;
  const participants = participatingModelKeys(draft).length;
  const softMode = draft.mode === 'soft';
  const basis = buildBasisView({ draft, soft, checking, participants });
  // While the basis verdict is pending, Soft stays blocked (Run disabled, fail closed) and reads as a check in
  // progress; clearance/basis requests are not shown until it settles. Basis requests also wait for chosen models.
  const messages = (validation?.findings ?? [])
    .filter((f) => !((checking || !softMode) && (f.control === 'clearance' || f.control === 'basis')))
    .filter((f) => !(f.control === 'basis' && participants === 0))
    .map((f) => ({
      control: f.control,
      text: checking && (f.code === 'soft-checking' || f.code === 'soft-unavailable') ? SOFT_CHECKING_TEXT : f.text,
    }));
  const overlap = Object.freeze(overlapOf(draft, s.models, s.modelName));
  const scopeA = describeScope(draft.setA, s.modelName);
  const scopeB = draft.selfClash ? 'Same as Set A' : describeScope(draft.setB, s.modelName);
  const unitSuffix = basis.state === BASIS_STATE.USER_SUPPLIED ? ` ${basis.unitLabel} (user-supplied)` : basis.state === BASIS_STATE.RAW ? ' model units (raw, unverified)' : '';
  const modeText = softMode ? `Soft (clearance ${draft.clearance === '' ? 'not set' : `${draft.clearance}${unitSuffix}`})` : 'Hard';
  return {
    collapsed: s.collapsed === true,
    summary: `${draft.name} · ${modeText} · A: ${scopeA} · B: ${scopeB}`,
    name: draft.name,
    mode: draft.mode,
    softChecking: checking,
    basis: { ...basis, error: messages.find((m) => m.control === 'basis')?.text ?? null },
    clearance: {
      value: draft.clearance,
      visible: softMode && !checking,
      unitLabel: basis.unitLabel,
      error: messages.find((m) => m.control === 'clearance')?.text ?? null,
    },
    newTest: { enabled: s.runActive !== true },
    models: s.models.map((m) => ({
      modelKey: m.modelKey, displayName: m.displayName, ready: m.loaded, registered: m.registered,
      inA: inSide(draft.setA, m.modelKey),
      inB: draft.selfClash ? inSide(draft.setA, m.modelKey) : inSide(draft.setB, m.modelKey),
      note: modelNote(m),
    })),
    selfClash: draft.selfClash,
    overlap,
    overlapText: overlapTextOf(overlap),
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

/**
 * Option E (owner-authorized 2026-10-07): the shown progress fraction is the share of WORK UNITS settled —
 * (unitsEvaluated + unitsFailedOrSkipped) / unitsTotal, both RunProgress fields — not `fractionProcessed`. The
 * engine's pair-space fraction is exact for its own definition but front-loaded for a same-model run (the
 * Architecture self-clash showed 66.7% at unit 80 of 4,294), so it misled as a completion signal. `null` ⇒
 * indeterminate (no plan yet). A runtime split adds units, so this fraction can step back slightly; it is not
 * smoothed.
 */
function unitsFraction(snap, num) {
  const total = num(snap.unitsTotal);
  if (total <= 0) return null;
  return Math.min(1, (num(snap.unitsEvaluated) + num(snap.unitsFailedOrSkipped)) / total);
}

function progressOf(run) {
  const snap = run.snapshot ?? {};
  const num = (v) => (Number.isFinite(v) ? v : 0);
  return {
    fraction: unitsFraction(snap, num),                                                   // null ⇒ indeterminate
    unitsEvaluated: num(snap.unitsEvaluated),
    unitsFailedOrSkipped: num(snap.unitsFailedOrSkipped),                               // Option E: shown when > 0
    unitsTotal: num(snap.unitsTotal),
    resultsFound: num(snap.resultsFound),
    caveatCount: num(snap.caveatCount),
    elapsedText: formatElapsed(run.elapsedMs),                                            // the Panel's clock; no ETA
  };
}

function headlineOf(input) {
  const m = input.run.machine;
  if (m.phase === 'idle') return input.run.canRun === true ? READY_TEXT : NOT_READY_TEXT;
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

/** Run details (§8.4) for the displayed sealed set; null before any set is displayed. */
function detailsOf(input) {
  const d = input.displayed;
  if (d === null || d.resultSet === null) return null;
  return { lines: buildRunDetails({ resultSet: d.resultSet, runRecord: d.runRecord ?? null, modelName: input.setup.modelName }) };
}

/**
 * aria-live="polite" text for the status region (§14.5): the headline, the filtered-of-total count when a filter
 * narrows the list, a pending freshness check, and the first error banner that the headline does not already say.
 * Progress counters are deliberately left out (they change per work unit and would flood a screen reader).
 */
export function describeStatusLive(run) {
  const parts = [run.headline];
  const { total, filtered } = run.counts;
  if (total !== null && filtered !== null && filtered !== total) parts.push(`${filtered} of ${total} clashes match the filters`);
  if (run.badges?.freshness?.pending === true) parts.push('Checking freshness');
  const error = run.banners.find((b) => b.kind === 'error' && b.text !== run.headline);
  if (error) parts.push(error.text);
  return `${parts.map((p) => String(p).replace(/[\s.…]+$/u, '')).filter((p) => p !== '').join('. ')}.`;
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
    details: detailsOf(input),
    statusLive: '',
    waitingForOtherRun: m.waitingForOtherRun === true,
  };
  run.statusLive = describeStatusLive(run);
  return run;
}

// ── run details (spec §8.4) ──────────────────────────────────────────────────────────────────────────────────────

const text = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function basisText(verdict, basis) {
  if (basis !== null && basis !== undefined) return basisProvenanceText(basis, verdict);
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
  if (definition?.mode === 'clearance') add('Measurement basis (at run start)', basisText(runRecord?.basisVerdict, runRecord?.basis));
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

/** The active grouped mode's 'unavailable' text, or null (None, pending, ok). */
function groupingUnavailableText(l) {
  const mode = groupModeOf(l.groupBy);
  if (mode === null || mode.grouped !== true || l.groupingState !== 'unavailable') return null;
  const own = typeof mode.unavailableText === 'function' ? mode.unavailableText(l.groupingReason) : null;
  return typeof own === 'string' ? own : (GROUPING_UNAVAILABLE_TEXT[l.groupingReason] ?? GROUPING_UNAVAILABLE_TEXT.error);
}

/** Grouping notes describe a LIST: none over an empty (filtered or unfiltered) list or a list-less error state. */
const listShown = (l) => l.total > 0 && l.filtered !== 0 && l.maskUnavailable !== true;

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
    groupingNote: listShown(l) ? groupingUnavailableText(l) : null,
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
    nav: { canPrev: false, canNext: false, label: NO_SELECTION_TEXT, scoped: false },
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
    multiValuedNote: l.view === 'grouped' && listShown(l) ? (groupModeOf(l.groupBy)?.note ?? null) : null,
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
  const unavailable = groupingUnavailableText(l);
  if (unavailable !== null) return { ...listed, state: 'grouping-unavailable', message: unavailable };
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

// ── test snapshot (spec §26.2 (b)) ──────────────────────────────────────────────────────────────────────────────

function buildTestSnapshot(input) {
  const t = input.test;
  if (t === undefined || t === null) return null;
  return {
    testId: t.testId, draft: t.draft, runActive: t.runActive === true, heldUnsaved: t.heldUnsaved === true,
    pendingConfirm: t.pendingConfirm === true, lastRun: t.lastRun ?? null,
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
    test: buildTestSnapshot(input),
  });
}
