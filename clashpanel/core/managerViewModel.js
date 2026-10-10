// clashpanel/core/managerViewModel.js
// PURE builder of the Clash Tests manager ViewModel (spec §26.9) and THE action-gate rule (§26.2a, §26.3, §26.7) used
// by both this builder and the manager's intent handlers, so an enabled button and an accepted intent can never
// disagree. All strings are built here; names stay raw text for textContent (AC-P13). Copy never claims persistence
// or readiness (§26.6, §26.10) and a count is always "reported" (PD-12).
import { describeScope, DISCARD_TEXT } from './viewModel.js';
import { buildDefinition, definitionKey } from './draft.js';
import { summaryStatusText } from './testSummary.js';
import { BASIS_RAW } from './constants.js';

const REASON_TEXT = Object.freeze({
  'run-active': 'stop the running test first.',
  'unsaved-results': 'its unsaved results were not confirmed for discarding.',
  'invalid-test-id': 'the test could not be loaded.',
  'invalid-draft': 'the test could not be loaded.',
  'unknown-test': 'that test no longer exists.',
  disposed: 'the panel is closing.',
});

export const MANAGER_TEXT = Object.freeze({
  STOP_FIRST: 'Stop the running test first.',
  PENDING: 'Confirm or cancel the pending action first.',
  BUSY: 'Another test action is in progress.',
  ANSWER_CONFIRM: 'Answer the pending confirmation in the test editor first.',
  RECOVERING: 'The test list is re-syncing with the test editor — wait a moment, then confirm.',
  UNKNOWN: 'This test no longer exists.',
  NOTHING_TO_RESET: 'This test has no results to reset.',
  NOT_RUN: 'Not run',
  RESULTS_NOT_HELD: 'Results not held — open and re-run to view',
  MODELS_CHANGED: 'Models changed since this run',
  FAULT: 'The tests list lost track of the test editor. Results can still be cleared; close the panel to start over (tests are kept for this session only).',
  RECHECKED: 'The test changed while you were confirming — please confirm again.',
  REFUSED_CHANGED: 'The test changed while you were confirming, so nothing was done.',
  NO_ID: 'A new test id could not be created; nothing was changed.',
  confirmSwitch: (name) => `The results of “${name}” are held in memory only. Opening another test discards them — discard and open?`,
  confirmDelete: (name, unsaved) => `Delete “${name}”? Its setup and results are discarded for this session and can't be recovered.${unsaved ? ' Its unsaved results are discarded too.' : ''}`,
  confirmReset: (name) => `The results of “${name}” are held in memory only. Resetting discards them — discard?`,
  opened: (name) => `Opened “${name}”.`,
  created: (name) => `Created “${name}”.`,
  duplicated: (source, name) => `Duplicated “${source}” as “${name}”.`,
  deleted: (name) => `Deleted “${name}” for this session.`,
  reset: (name) => `Reset the results of “${name}”.`,
  restored: (name) => `The test editor was restored to “${name}”.`,
  failed: (verb, name, reason) => `Could not ${verb} “${name}”: ${REASON_TEXT[reason] ?? 'the test could not be loaded.'}`,
});

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

const ALLOW = Object.freeze({ enabled: true, reason: null });
const deny = (reason) => Object.freeze({ enabled: false, reason });

/** True only for the active test while the editor displays THAT summary's run with a sealed set. */
export function resultsHeldFor(editorVm, summary) {
  return editorVm?.run?.state === 'done' && summary !== null && summary !== undefined && summary.resultCount !== null
    && editorVm?.test?.lastRun?.runId === summary.runId;
}

export function actionGate(s, action, testId = null) {
  if (s.fault !== null && s.fault !== undefined) return deny(s.fault.text);
  if (s.busy === true) return deny(s.pending?.state === 'awaiting' ? MANAGER_TEXT.PENDING : MANAGER_TEXT.BUSY);
  const t = s.editorVm?.test ?? null;
  if (t?.pendingConfirm === true) return deny(MANAGER_TEXT.ANSWER_CONFIRM);
  const runActive = t?.runActive === true;
  if (action === 'create') return runActive ? deny(MANAGER_TEXT.STOP_FIRST) : ALLOW;
  const record = s.records.find((r) => r.testId === testId);
  if (record === undefined) return deny(MANAGER_TEXT.UNKNOWN);
  const active = testId === s.activeTestId;
  switch (action) {
    case 'duplicate': return ALLOW;
    case 'open': return runActive && !active ? deny(MANAGER_TEXT.STOP_FIRST) : ALLOW;
    case 'delete': return runActive && active ? deny(MANAGER_TEXT.STOP_FIRST) : ALLOW;
    case 'reset': {
      if (runActive && active) return deny(MANAGER_TEXT.STOP_FIRST);
      const held = active && resultsHeldFor(s.editorVm, record.summary);
      return record.summary !== null || held ? ALLOW : deny(MANAGER_TEXT.NOTHING_TO_RESET);
    }
    default: return deny(MANAGER_TEXT.UNKNOWN);
  }
}

function modeTextOf(draft) {
  if (draft.mode !== 'soft') return 'Hard';
  const clearance = draft.clearance.trim() === '' ? 'not set' : draft.clearance.trim();
  if (draft.basisUnit === BASIS_RAW) return `Soft (clearance ${clearance}, raw model units, not verified)`;
  if (draft.basisUnit !== '') return `Soft (clearance ${clearance} ${draft.basisUnit}, user-supplied, not verified)`;
  return `Soft (clearance ${clearance})`;
}

// Drafts are deep-frozen and immutable, so a definition key per draft object can be memoized safely (Q1 cost).
const KEY_OF_DRAFT = new WeakMap();

function currentKey(draft) {
  if (KEY_OF_DRAFT.has(draft)) return KEY_OF_DRAFT.get(draft);
  const { definition } = buildDefinition(draft, { verifiedBasis: true });
  const key = definition === null ? null : definitionKey(definition);
  KEY_OF_DRAFT.set(draft, key);
  return key;
}

function statusOf(s, record, active) {
  const t = s.editorVm?.test ?? null;
  if (active && t?.runActive === true) {
    return s.editorVm?.run?.state === 'stopping'
      ? { kind: 'stopping', text: 'Stopping…' }
      : { kind: 'running', text: `Running — ${s.editorVm?.run?.progress?.resultsFound ?? 0} found` };
  }
  if (record.summary === null) return { kind: 'not-run', text: MANAGER_TEXT.NOT_RUN };
  return { kind: record.summary.status, text: summaryStatusText(record.summary) };
}

function buildRow(s, record) {
  const active = record.testId === s.activeTestId;
  const summary = record.summary;
  const held = active && resultsHeldFor(s.editorVm, summary);
  const modelsChanged = s.modelsChanged.get(record.testId) === true;
  return {
    testId: record.testId,
    name: record.draft.name,
    active,
    modeText: modeTextOf(record.draft),
    setA: describeScope(record.draft.setA, s.scopeName),
    setB: record.draft.selfClash ? 'Same as Set A' : describeScope(record.draft.setB, s.scopeName),
    status: statusOf(s, record, active),
    resultCount: summary?.resultCount ?? null,
    resultsText: summary !== null && summary.resultCount !== null && !held ? MANAGER_TEXT.RESULTS_NOT_HELD : null,
    setupChangedSinceRun: summary !== null && currentKey(record.draft) !== summary.definitionKey,
    readiness: s.readiness.get(record.testId) ?? null,
    modelsChanged,
    modelsChangedText: modelsChanged ? MANAGER_TEXT.MODELS_CHANGED : null,
    actions: {
      open: actionGate(s, 'open', record.testId),
      duplicate: actionGate(s, 'duplicate', record.testId),
      reset: actionGate(s, 'reset', record.testId),
      delete: actionGate(s, 'delete', record.testId),
    },
  };
}

function confirmOf(s, nameOf) {
  const p = s.pending;
  if (p === null || p === undefined || p.state !== 'awaiting') return null;
  const enabled = s.fault === null && s.recovering !== true && s.editorVm?.test?.pendingConfirm !== true;   // onConfirm refuses while recovering (M1)
  // §26.10: a disabled Confirm exposes its specific cause (priority fault -> recovering -> editor confirmation).
  const disabledReason = enabled ? null
    : (s.fault !== null && s.fault !== undefined ? (s.fault.text ?? MANAGER_TEXT.FAULT)
      : (s.recovering === true ? MANAGER_TEXT.RECOVERING : MANAGER_TEXT.ANSWER_CONFIRM));
  const base = { operationId: p.operationId, cancelLabel: 'Cancel', enabled, disabledReason };
  switch (p.kind) {
    case 'switch': return { ...base, text: MANAGER_TEXT.confirmSwitch(nameOf(p.sourceTestId)), confirmLabel: 'Discard and open' };
    case 'create': return { ...base, text: DISCARD_TEXT.newTest, confirmLabel: 'Discard unsaved results' };
    case 'delete': return { ...base, text: MANAGER_TEXT.confirmDelete(nameOf(p.sourceTestId), p.discardsUnsaved === true), confirmLabel: 'Delete test' };
    case 'reset': return { ...base, text: MANAGER_TEXT.confirmReset(nameOf(p.sourceTestId)), confirmLabel: 'Discard and reset' };
    default: return null;
  }
}

export function buildManagerViewModel(s) {
  const nameOf = (testId) => s.records.find((r) => r.testId === testId)?.draft.name ?? '';
  const p = s.pending;
  return deepFreeze({
    view: s.view,
    activeTestId: s.activeTestId,
    activeName: nameOf(s.activeTestId),
    count: s.records.length,
    create: actionGate(s, 'create'),
    pending: p === null || p === undefined ? null : { operationId: p.operationId, kind: p.kind, sourceTestId: p.sourceTestId, targetTestId: p.targetTestId ?? null },
    confirm: confirmOf(s, nameOf),
    notice: s.notice ?? null,
    fault: s.fault === null || s.fault === undefined ? null : { text: s.fault.text },
    // §26.9: while faulted every policy-blocked editor control is disabled with the fault text (core-derived; Task 9
    // overlays the editor ViewModel with lockedEditorVm; the Task 11 renderer reads this lock to describe them).
    editorLock: s.fault === null || s.fault === undefined ? null : { enabled: false, reason: s.fault.text },
    live: s.live ?? '',
    // The editor's New test is disabled only by a live run (core/viewModel.js setup.newTest); the managed renderer
    // describes it with this text (§26.10) without importing core text.
    runActiveReason: MANAGER_TEXT.STOP_FIRST,
    liveSeq: Number.isInteger(s.liveSeq) ? s.liveSeq : 0,   // monotonic announcement identity (M2)
    tests: s.records.map((record) => buildRow(s, record)),
  });
}

/**
 * §26.9/§26.10 headless fault contract (Codex plan review I1; Work plan re-review M1): while the manager is faulted
 * the composite `editor` ViewModel reports EVERY user-facing control whose intent `policy` (Task 9's FAULT_POLICY)
 * blocks as `{enabled:false, reason}` — the editor's existing disabled-reason shape — so a headless consumer and the
 * DOM never show enabled a control whose intent dispatch drops. Setup edits/New test, Run, result-row selection,
 * Prev/Next, Focus/Isolate/Markers/Back to All are fixed controls locked unconditionally (= FAULT_POLICY's blocked
 * user-facing intents, pinned by the FAULT_CONTROLS equivalence tests, Tasks 9/11); only banner actions, which carry
 * their intent as data, consult `policy` and are locked unless it allows the intent (fail closed, like dispatch). Allow-listed controls (filters, group, sort, page,
 * Focus on select, Stop, Clear + confirmation, Copy diagnostics, collapse) are carried over unchanged. Returns a NEW
 * deep-frozen object; the input (the editor's own, deep-frozen ViewModel) is never written.
 */
export function lockedEditorVm(editorVm, reason, policy) {
  const gate = { enabled: false, reason };
  const blocked = (intent) => policy?.[intent?.type] !== 'allow';
  const run = editorVm.run;
  const out = {
    ...editorVm,
    run: {
      ...run, canRun: false, locked: gate,
      ...(Array.isArray(run.banners)
        ? { banners: run.banners.map((b) => (b?.action && blocked(b.action.intent) ? { ...b, action: { ...b.action, ...gate } } : b)) }
        : {}),
    },
  };
  if (editorVm.setup) out.setup = { ...editorVm.setup, newTest: gate, useSelectionEnabled: false, locked: gate };
  if (editorVm.results) {
    out.results = { ...editorVm.results, select: gate, nav: { ...editorVm.results.nav, canPrev: false, canNext: false, locked: gate } };
  }
  if (editorVm.selected) {
    const a = editorVm.selected.actions;
    out.selected = { ...editorVm.selected, actions: { ...a, focus: { ...a.focus, ...gate }, isolate: { ...a.isolate, ...gate },
      markers: { ...a.markers, ...gate }, backToAll: { ...a.backToAll, ...gate } } };
  }
  return deepFreeze(out);
}
