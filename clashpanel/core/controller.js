// clashpanel/core/controller.js
// The headless Panel controller (spec §5, §6, §7; catalog §4 "Controller behaviors"). A THIN orchestrator: all
// domain logic lives in the sibling modules; this file owns only the state container, generation guards, the
// wiring between ports and modules, and the intent dispatch table. It holds no Viewer/DOM reference (AC-P10).
//
// Invariants kept here:
//  * Run = validate → engine.startRun → ONLY AFTER a handle returns: generation++, bridge.clear(), release of the
//    previous set. An admission failure changes nothing but the error banner (§7.2/§7.6, AC-P14).
//  * Every async completion captures a generation (results) or setup generation (Soft availability) and commits
//    only if it is still current; a superseded run's late `done` releases its own set only (§5.2, AC-P15).
//  * The engine is narrowed to the EnginePort at construction (AC-P20): register/unregister/
//    invalidateModelPlacement/dispose are unreachable from here.
//  * getViewModel() returns the SAME frozen object until the state changes (version counter).
import { INTENT } from './intents.js';
import { createDefaultScheduler } from './scheduler.js';
import { createGeneration } from './generation.js';
import { narrowEnginePort, assertCatalogPort, assertBridgePort } from './ports.js';
import { createDraft, draftReduce, prepareRun } from './draft.js';
import { validateSetup, participatingModelKeys } from './setupValidation.js';
import { evaluateSoftAvailability } from './softAvailability.js';
import { resolveBasis } from './measurementBasis.js';
import { createDerivationQueue } from './derivationQueue.js';
import { RUN_PHASE, initialRunState, reduceRun, canRun, canStop } from './runMachine.js';
import { createResidency } from './residency.js';
import { mapAdmissionError, diagnosticsExport } from './runReport.js';
import { createLabelResolver } from './labels.js';
import { resolveSide, resolveResult } from './resolve.js';
import { buildViewModel } from './viewModel.js';
import { sealSummary } from './testSummary.js';
import { isLoadableDraft } from './testDrafts.js';
import { buildResultIndex } from './resultIndex.js';
import { EMPTY_FILTER_SPEC, isFilterActive, parseMaxGap, runFilterPass } from './filters.js';
import { filterGroups, sortGroups, matchIdsFrom } from './grouping.js';
import { groupModeOf, GROUP_MODE_IDS } from './groupModes.js';
import { createElementPropertySource } from './elementProperties.js';
import { buildOrderedIndex, pageSlice, clampPage, pageOfPosition } from './orderedList.js';
import { buildRow, buildGroupHeaderRow, livenessOf, locationOf, sideView, gapOf } from './rows.js';
import { BASIS_VERDICT_TIMEOUT_MS, READINESS_POLL_MS, PAGE_SIZE, FILTER_DEBOUNCE_MS } from './constants.js';

// ── construction ────────────────────────────────────────────────────────────────────────────────────────────────

export function createPanelController({ engine, catalog, bridge, scheduler = createDefaultScheduler(), mintId = () => globalThis.crypto.randomUUID() }) {
  const port = narrowEnginePort(engine);
  assertCatalogPort(catalog);
  assertBridgePort(bridge);
  const gen = createGeneration();
  const c = {
    engine: port, catalog, bridge, scheduler, mintId,
    gen,                                   // results generation: Run, Clear results, New test, dispose
    setupGen: createGeneration(),          // Soft-availability evaluations (independent of runs)
    queue: createDerivationQueue({ scheduler, generation: gen }),
    residency: createResidency({ engine: port }),
    labels: null,
    disposed: false, disposing: null, disposers: [], subscribers: new Set(),
    version: 0, vmCache: null,
    draft: createDraft({ testId: mintId(), testNumber: 1 }),
    validation: null,
    soft: { available: false, pending: false, verdict: null, explanation: null }, softKey: null,
    setupChanged: false, hasRun: false, setupCollapsed: false,
    run: initialRunState(), handle: null, handleUnsub: null, snapshot: null, pollTimer: null, startLatch: false,
    admission: null, confirm: null, releaseErrors: [], releaseStuck: false, residencyNotice: null,
    isolationNotice: null, viewerSeq: 0,   // last bridge.clear()/present() outcome worth telling the user about
    displayed: null,                       // {runId, status, resultSet|null, persistence}
    lastSealed: null,                      // §26.4 summary of the last sealed run of THIS draft (vm.test.lastRun)
    runRecord: null,                       // Panel-local facts captured when the run was ADMITTED (not in the sealed set)
    labelScope: Object.freeze([]),          // seam (e), G-A2: manager's referenced-model-key scope ([] standalone)
    readAbort: new AbortController(),
  };
  Object.assign(c, resultsState(), selectionState());
  c.labels = createLabelResolver({
    catalog, scheduler,
    resolveLiveModel: (modelKey) => liveModelFor(c, modelKey),
    // Models known only from the displayed run (e.g. unloaded since) still count for name disambiguation (RF-2), plus
    // — seam (e), G-A2 — every key the Clash Tests manager's records reference, so list and editor labels agree.
    knownModelKeys: () => [...(c.displayed?.resultSet?.provenance?.models ?? []).map((m) => m.modelKey), ...c.labelScope],
  });
  revalidate(c);
  c.disposers.push(catalog.onChange(() => onCatalogChange(c)));
  c.disposers.push(bridge.onModelLeft((event) => onModelLeft(c, event)));

  return Object.freeze({
    getViewModel: () => viewModelOf(c),
    subscribe(cb) {
      if (typeof cb !== 'function') throw new TypeError('subscribe: callback must be a function');
      if (c.disposed) return () => {};
      c.subscribers.add(cb);
      return () => { c.subscribers.delete(cb); };
    },
    dispatch: (intent) => dispatch(c, intent),
    /** Resolves {released, errors} after the run drained, sets were released and the bridge disposed (see dispose()). */
    dispose: () => dispose(c),
  });
}

// ── state container ─────────────────────────────────────────────────────────────────────────────────────────────

function viewModelOf(c) {
  if (c.vmCache === null) c.vmCache = buildViewModel(viewInput(c));
  return c.vmCache;
}

/** Every state change ends here: new version, drop the cached ViewModel, notify subscribers (errors swallowed). */
function touch(c) {
  c.version += 1;
  c.vmCache = null;
  if (c.subscribers.size === 0) return;
  const vm = viewModelOf(c);
  for (const cb of [...c.subscribers]) {
    try { cb(vm); } catch { /* a subscriber failure never breaks the controller */ }
  }
}

function bumpGeneration(c) {
  c.gen.bump();
  c.readAbort.abort();
  c.readAbort = new AbortController();
  if (c.filterTimer !== null) { c.scheduler.clearTimeout(c.filterTimer); c.filterTimer = null; }
  c.filterEpoch += 1;
  c.labels.reset();
}

/**
 * bridge.clear() for a restore-table trigger. The outcome is surfaced only if no later clear/present superseded
 * it: 'skipped-external' ⇒ info notice (foreign isolation left untouched, §9.4), 'failed' ⇒ warning.
 */
function clearViewer(c) {
  c.viewerSeq += 1;
  const seq = c.viewerSeq;
  let pending;
  try { pending = c.bridge.clear(); } catch (error) { pending = Promise.reject(error); }
  return Promise.resolve(pending).then((outcome) => outcome, () => ({ isolation: 'failed' })).then((outcome) => {
    if (c.disposed || seq !== c.viewerSeq || outcome?.disposed === true) return;
    const next = outcome?.isolation === 'skipped-external' || outcome?.isolation === 'failed' ? outcome.isolation : null;
    if (next !== c.isolationNotice) { c.isolationNotice = next; touch(c); }
  });
}

function readBinding(c, modelKey) {
  try { return c.engine.registry.bindingFor(modelKey) ?? null; } catch { return null; }
}

/** The live Model for `modelKey` under the DISPLAYED run's provenance (spec §9.1), else null. */
function liveModelFor(c, modelKey) {
  const set = c.displayed?.resultSet ?? null;
  if (set === null) return null;
  const side = resolveSide({ ref: { modelKey, dbId: 0 }, provenance: set.provenance, engine: c.engine, catalog: c.catalog });
  return side.state === 'live' ? side.model : null;
}

const isActive = (c) => canStop(c.run);   // every non-terminal Panel state

function canRunNow(c) {
  return !c.disposed && canRun(c.run) && c.validation?.state === 'ready';
}

/**
 * True when the displayed set is engine-held and not (yet) saved: discarding it needs an explicit acknowledgement.
 * An unreadable state counts as unsaved (fail safe: residency.release() would also refuse without the ack).
 */
function heldUnsaved(c) {
  const current = c.residency.current();
  if (current === null || current.kind !== 'held-unsaved') return false;
  let state = null;
  try { state = c.engine.getPersistenceState(current.runId)?.state ?? null; } catch { state = null; }
  return state !== 'saved';
}

// ── setup (spec §6) ─────────────────────────────────────────────────────────────────────────────────────────────

function safeValidate(c) {
  try {
    return validateSetup({
      draft: c.draft, engine: c.engine, catalog: c.catalog,
      // A pending Soft evaluation counts as unavailable (fail closed, PD-17).
      softAvailability: { available: c.soft.available === true && c.soft.pending !== true, pending: c.soft.pending === true, verdict: c.soft.verdict, explanation: c.soft.explanation },
    });
  } catch (error) {
    return { state: 'blocked', findings: [{ control: 'general', code: 'validation-error', text: `The setup could not be validated: ${String(error?.message ?? error)}` }], issuesTruncated: false, definition: null };
  }
}

function startSoftEvaluation(c, participants, key) {
  const g = c.setupGen.bump();
  c.softKey = key;
  c.soft = { available: false, pending: true, verdict: null, explanation: null };
  let pending;
  try {
    pending = evaluateSoftAvailability({ participants, catalog: c.catalog, scheduler: c.scheduler, timeoutMs: BASIS_VERDICT_TIMEOUT_MS });
  } catch (error) {
    pending = Promise.reject(error);
  }
  Promise.resolve(pending).then((r) => r, () => null).then((r) => {
    if (c.disposed || !c.setupGen.isCurrent(g)) return;          // superseded by a newer participant set
    c.soft = { available: r?.available === true, pending: false, verdict: r?.verdict ?? null, explanation: r?.explanation ?? null };
    c.validation = safeValidate(c);
    touch(c);
  });
}

/** validateSetup re-runs on every setup/catalog change; Soft availability re-evaluates when the participants change. */
function revalidate(c, { reEvaluateSoft = false } = {}) {
  const participants = participatingModelKeys(c.draft);
  const key = participants.join('\u0000');
  if (reEvaluateSoft || key !== c.softKey) startSoftEvaluation(c, participants, key);
  c.validation = safeValidate(c);
}

function applySetup(c, action) {
  c.draft = draftReduce(c.draft, action);
  if (c.hasRun) c.setupChanged = true;                            // spec §6.3
  c.admission = null;
  revalidate(c);
  touch(c);
}

function onSetupName(c, intent) { applySetup(c, { type: 'name', value: String(intent.value ?? '') }); }
function onSetupMode(c, intent) { if (intent.value === 'hard' || intent.value === 'soft') applySetup(c, { type: 'mode', value: intent.value }); }
function onSetupClearance(c, intent) { applySetup(c, { type: 'clearance', value: String(intent.value ?? '') }); }
function onSetupBasis(c, intent) { if (typeof intent.value === 'string') applySetup(c, { type: 'basisUnit', value: intent.value }); }
function onSetupSelfClash(c, intent) { applySetup(c, { type: 'selfClash', value: intent.value === true }); }

function onSetupToggleModel(c, intent) {
  if ((intent.side !== 'A' && intent.side !== 'B') || typeof intent.modelKey !== 'string') return;
  applySetup(c, { type: 'toggleModel', side: intent.side, modelKey: intent.modelKey });
}

/** "Use current selection": read-only Viewer read through the bridge; models the host never identified are skipped. */
function onSetupUseSelection(c, intent) {
  if (intent.side !== 'A' && intent.side !== 'B') return;
  let selection = [];
  try { selection = c.bridge.readAggregateSelection() ?? []; } catch { selection = []; }
  const elements = {};
  for (const entry of Array.isArray(selection) ? selection : []) {
    let key = null;
    try { key = c.catalog.keyOfModel(entry?.model); } catch { key = null; }
    const dbIds = Array.isArray(entry?.dbIds) ? entry.dbIds.filter((d) => Number.isInteger(d) && d >= 0) : [];
    if (typeof key !== 'string' || dbIds.length === 0) continue;
    elements[key] = [...new Set([...(elements[key] ?? []), ...dbIds])].sort((a, b) => a - b);
  }
  applySetup(c, { type: 'setElements', side: intent.side, elements });
}

function onSetupNewTest(c) {
  if (isActive(c)) return;                                        // setup identity never changes under a live run
  if (heldUnsaved(c)) { c.confirm = { for: 'newTest' }; touch(c); return; }
  newTest(c, false);
}

function newTest(c, acknowledgeUnsaved) {
  c.confirm = null;
  retireDisplayed(c, { acknowledgeUnsaved });
  c.draft = draftReduce(c.draft, { type: 'newTest', testId: c.mintId() });
  c.lastSealed = null;                                            // §26.2 (b): the new draft has no run yet
  c.hasRun = false;
  c.setupChanged = false;
  c.setupCollapsed = false;
  c.admission = null;
  revalidate(c);
  touch(c);
}

function onSetupToggleCollapsed(c) {
  c.setupCollapsed = !c.setupCollapsed;
  touch(c);
}

// ── Clash Tests manager seam (spec §26.2 (a)/(c); additive, unused by the standalone editor) ───────────────────

const LOAD_REASON = Object.freeze({
  INVALID_ID: 'invalid-test-id', INVALID_DRAFT: 'invalid-draft', RUN_ACTIVE: 'run-active', UNSAVED: 'unsaved-results', DISPOSED: 'disposed',
});

/** A refused load: nothing changed; `testId` is the test the editor STILL holds. */
function loadRefusal(c, reason) {
  return Object.freeze({ ok: false, testId: c.draft.testId, version: c.version, releaseStuck: c.releaseStuck, reason });
}

/**
 * Atomic load (Work review M1): every precondition is checked BEFORE any mutation; a refusal mutates nothing and
 * notifies nobody. On success it runs exactly the `newTest` path with the SUPPLIED draft (retireDisplayed → adopt →
 * reset run bookkeeping → forced Soft re-evaluation) and notifies once, with that draft's testId.
 */
function onTestLoad(c, intent) {
  if (c.disposed) return loadRefusal(c, LOAD_REASON.DISPOSED);
  const { testId, draft } = intent;
  if (typeof testId !== 'string' || testId.length === 0) return loadRefusal(c, LOAD_REASON.INVALID_ID);
  if (!isLoadableDraft(draft, testId)) return loadRefusal(c, LOAD_REASON.INVALID_DRAFT);
  if (isActive(c)) return loadRefusal(c, LOAD_REASON.RUN_ACTIVE);
  const acknowledgeUnsaved = intent.acknowledgeUnsaved === true;
  if (!acknowledgeUnsaved && heldUnsaved(c)) return loadRefusal(c, LOAD_REASON.UNSAVED);
  c.confirm = null;
  retireDisplayed(c, { acknowledgeUnsaved });
  c.draft = draft;
  c.lastSealed = null;
  c.hasRun = false;
  c.setupChanged = false;
  c.setupCollapsed = false;
  c.admission = null;
  revalidate(c, { reEvaluateSoft: true });
  touch(c);
  return Object.freeze({ ok: true, testId: c.draft.testId, version: c.version, releaseStuck: c.releaseStuck });
}

function onConfirmCancel(c) {
  if (c.confirm === null) return;
  c.confirm = null;
  touch(c);
}

/**
 * Seam (e), owner decision G-A2 (Work plan review H2): the manager's referenced-model-key scope joins the label
 * resolver's known keys, so `labels.modelName` disambiguates over the same key set as the manager rows. A changed scope
 * invalidates the cached names and notifies once; an identical scope or a non-array payload changes nothing.
 */
function onTestLabelScope(c, intent) {
  if (!Array.isArray(intent.modelKeys)) return;
  const next = [...new Set(intent.modelKeys.filter((k) => typeof k === 'string' && k.length > 0))].sort();
  if (next.join('\u0000') === c.labelScope.join('\u0000')) return;
  c.labelScope = Object.freeze(next);
  c.labels.invalidateNames();
  touch(c);
}

function onCatalogChange(c) {
  if (c.disposed) return;
  c.labels.invalidateNames();                                     // names/known models may have changed (RF-2)
  retryModelNotLoaded(c);                                         // a model may be back (hide/show): recompute 'model-not-loaded'
  revalidate(c, { reEvaluateSoft: true });                        // readiness/registration/basis may have changed
  recheckFreshness(c);                                            // §7.3: re-check on model add/unload
  touch(c);
}

// ── run lifecycle (spec §7) ─────────────────────────────────────────────────────────────────────────────────────

function onRunStart(c) {
  // RF-1: a double-click delivers two RUN_STARTs in one tick; only the first is acted on, even when its admission
  // failed (no second startRun, no second error banner). A non-terminal own run disables Run anyway (canRunNow).
  if (c.startLatch || !canRunNow(c)) return;
  c.startLatch = true;
  queueMicrotask(() => { c.startLatch = false; });
  if (heldUnsaved(c)) { c.confirm = { for: 'run' }; touch(c); return; }   // "discard unsaved results?" (§7.6)
  startRun(c, { acknowledgeUnsaved: false });
}

/**
 * Admission order (§7.2/§7.6): ordinarily the new run is admitted FIRST and only then is the previous set
 * released, so an admission failure preserves the previous results and Viewer state. EXCEPTION — the user has
 * explicitly confirmed discarding the (unsaved) previous set (RESULTS_CLEAR_CONFIRMED for a pending Run, or
 * RUN_RELEASE_AND_RETRY): that consent covers releasing it BEFORE startRun, which Core needs when the unsaved,
 * non-evictable set holds the last resident slot (otherwise startRun throws ResultCapacityError forever).
 */
function startRun(c, { acknowledgeUnsaved }) {
  c.confirm = null;
  const verifiedBasis = c.soft.available === true && c.soft.pending !== true;
  const prepared = prepareRun(c.draft, { verifiedBasis });
  if (prepared.definition === null) { c.validation = safeValidate(c); touch(c); return; }
  const confirmedDiscard = acknowledgeUnsaved === true;
  if (confirmedDiscard) retireDisplayed(c, { acknowledgeUnsaved: true });   // consented: free the slot first
  let handle;
  try {
    handle = c.engine.startRun(prepared.definition);
  } catch (error) {
    // Admission failure: previous results, residency and Viewer state stay exactly as they were (AC-P14) —
    // unless the user already confirmed discarding them (then they were released above, by consent).
    c.admission = mapAdmissionError(error, { heldRunId: c.residency.current()?.runId ?? null, ownRunIds: stuckRunIdsOf(c) });
    c.run = reduceRun(c.run, { type: 'admission-failed', error });
    c.setupCollapsed = false;                                     // §14.3: Setup re-expands when a run cannot start
    touch(c);
    return;
  }
  c.draft = prepared.draft;                                       // revision rule applied only for an admitted run
  c.admission = null;
  if (!confirmedDiscard) retireDisplayed(c, { acknowledgeUnsaved: false });   // ONLY now: generation++, bridge.clear(), release
  // §6.2 step 4 + owner decision 2026-10-07: the basis this run was admitted under. A user-supplied or raw basis is
  // recorded as exactly that and can never read `verified`: only a host `verified` verdict (or a single model) does.
  c.runRecord = { basisVerdict: c.soft.verdict, basis: resolveBasis({ basisUnit: c.draft.basisUnit, verifiedBasis }) };
  c.hasRun = true;
  c.setupChanged = false;
  c.setupCollapsed = true;                                        // spec §14.3: collapses when a run starts
  adoptHandle(c, handle);
  touch(c);
}

/** The Panel's own sets whose release is stuck (A-1): they count as "own" blockers for release-and-retry. */
function stuckRunIdsOf(c) {
  try { return typeof c.residency.stuckRunIds === 'function' ? [...c.residency.stuckRunIds()] : []; } catch { return []; }
}

/** Replace/clear path shared by Run, Clear results and New test (restore-table rows "Start a new run"/"Back to All"). */
function retireDisplayed(c, { acknowledgeUnsaved }) {
  bumpGeneration(c);
  clearPoll(c);
  unsubscribeHandle(c);
  void clearViewer(c);
  const released = c.residency.release({ acknowledgeUnsaved: acknowledgeUnsaved === true });
  c.releaseErrors = Array.isArray(released?.errors) ? released.errors : [];
  // T9 retries 'stuck' entries: `released:false` with stuckCount > 0 is reported like a release error.
  c.releaseStuck = released?.released === false && Number(released?.stuckCount) > 0;
  c.residencyNotice = null;
  c.displayed = null;
  c.labels.invalidateNames();
  c.runRecord = null;
  c.handle = null;
  c.run = initialRunState();
  resetResultsView(c);
}

function safeSnapshot(handle) {
  try { return handle.getSnapshot(); } catch { return null; }
}

function adoptHandle(c, handle) {
  const g = c.gen.current();
  c.handle = handle;
  c.snapshot = safeSnapshot(handle);
  c.run = reduceRun(initialRunState(), { type: 'admitted', snapshot: c.snapshot, runId: handle.runId, atMs: c.scheduler.now() });
  try {
    c.handleUnsub = handle.subscribe((event) => onCoreEvent(c, g, handle, event));
  } catch {
    c.handleUnsub = null;
  }
  schedulePoll(c, g, handle);
  handle.done
    .then((summary) => onRunDone(c, g, handle, summary))
    .then(() => handle.persisted)
    .then((outcome) => onPersisted(c, g, handle, outcome))
    .catch(() => { /* done/persisted never reject; a throwing module must not surface as unhandled */ });
}

function onCoreEvent(c, g, handle, event) {
  if (c.disposed || !c.gen.isCurrent(g) || c.handle !== handle) return;
  c.snapshot = safeSnapshot(handle);
  c.run = reduceRun(c.run, { type: 'core-event', event, snapshot: c.snapshot });
  touch(c);
}

/** While `preparing`, re-read the snapshot at the Panel's low-frequency poll cadence ("Waiting for another run"). */
function schedulePoll(c, g, handle) {
  clearPoll(c);
  if (c.run.phase !== RUN_PHASE.PREPARING) return;
  c.pollTimer = c.scheduler.setTimeout(() => {
    c.pollTimer = null;
    if (c.disposed || !c.gen.isCurrent(g) || c.handle !== handle || c.run.phase !== RUN_PHASE.PREPARING) return;
    c.snapshot = safeSnapshot(handle);
    c.run = reduceRun(c.run, { type: 'poll', snapshot: c.snapshot });
    touch(c);
    schedulePoll(c, g, handle);
  }, READINESS_POLL_MS);
}

function clearPoll(c) {
  if (c.pollTimer !== null) { c.scheduler.clearTimeout(c.pollTimer); c.pollTimer = null; }
}

function unsubscribeHandle(c) {
  const off = c.handleUnsub;
  c.handleUnsub = null;
  if (typeof off === 'function') { try { off(); } catch { /* ignore */ } }
}

function onRunDone(c, g, handle, summary) {
  if (c.disposed || !c.gen.isCurrent(g) || c.handle !== handle) {
    // Superseded (dispose, New test or Clear during the run): release its own set, never display it (§7.6).
    try { c.residency.releaseSuperseded(summary); } catch { /* reported nowhere: nothing is displayed */ }
    return;
  }
  clearPoll(c);
  unsubscribeHandle(c);
  c.snapshot = safeSnapshot(handle);
  c.run = reduceRun(c.run, { type: 'done', summary });
  let adopted = { notice: null };
  try { adopted = c.residency.adopt(summary) ?? adopted; } catch (error) { c.releaseErrors = [error]; }
  c.residencyNotice = adopted.notice ?? null;
  c.displayed = { runId: summary.runId, status: summary.status, resultSet: summary.resultSet ?? null, persistence: summary.persistence ?? null };
  c.lastSealed = sealSummary({ summary, runState: c.run, draft: c.draft, sealedAt: c.scheduler.now() });   // §26.2 (b)
  c.labels.invalidateNames();                                     // the displayed run's models join the known set
  if (summary.status === 'failed' || !summary.resultSet) c.setupCollapsed = false;   // §14.3: re-expands on failure
  if (summary.resultSet) startPipeline(c, g, summary.resultSet);
  touch(c);
}

function onPersisted(c, g, handle, outcome) {
  if (c.disposed || !c.gen.isCurrent(g) || c.handle !== handle || c.displayed === null) return;
  let upgraded = null;
  try { upgraded = c.residency.onPersisted(outcome); } catch { upgraded = null; }
  const state = typeof outcome?.state === 'string' ? outcome.state : c.displayed.persistence?.state;
  c.displayed = { ...c.displayed, persistence: { ...(c.displayed.persistence ?? {}), state, timedOut: false } };
  c.residencyNotice = upgraded?.notice ?? (state === 'saved' ? null : c.residencyNotice);
  touch(c);
}

function onRunStop(c) {
  if (c.handle === null || !canStop(c.run)) return;              // Stop: enabled in every non-terminal state
  c.run = reduceRun(c.run, { type: 'stop-requested' });
  try { void c.handle.cancel('user'); } catch { /* Core absorbs a late cancel */ }
  touch(c);
}

function onResultsClear(c) {
  if (isActive(c) || (c.displayed === null && c.run.phase !== RUN_PHASE.DONE)) return;
  if (heldUnsaved(c)) { c.confirm = { for: 'clear' }; touch(c); return; }
  clearResults(c, false);
}

function clearResults(c, acknowledgeUnsaved) {
  c.confirm = null;
  c.admission = null;
  retireDisplayed(c, { acknowledgeUnsaved });
  touch(c);
}

/** The one-time "discard unsaved results?" confirmation for whichever action asked for it. */
function onResultsClearConfirmed(c) {
  const pending = c.confirm;
  if (pending === null) return;
  c.confirm = null;
  if (pending.for === 'clear') clearResults(c, true);
  else if (pending.for === 'newTest') newTest(c, true);
  else if (pending.for === 'run' && canRunNow(c)) startRun(c, { acknowledgeUnsaved: true });
  else touch(c);
}

/** "Release previous results and retry" after a ResultCapacityError caused by the Panel's own set (§7.6). */
function onReleaseAndRetry(c) {
  if (c.admission?.action !== 'release-and-retry' || isActive(c)) return;
  c.admission = null;
  // The explicit user action is the acknowledgement; startRun releases the previous set BEFORE admission.
  if (canRunNow(c)) { startRun(c, { acknowledgeUnsaved: true }); return; }
  retireDisplayed(c, { acknowledgeUnsaved: true });
  touch(c);
}

/** Resolves with the plain-JSON diagnostics of the displayed set (spec §8.4), or null when none is displayed. */
function onDiagnosticsCopy(c) {
  const set = c.displayed?.resultSet ?? null;
  return set === null ? null : diagnosticsExport(set);
}

// ── dispose (restore-table row "Extension unload / dispose") ────────────────────────────────────────────────────

/**
 * Disposal contract → Promise<{released:boolean, errors:Error[]}> (never rejects; the same promise on repeat).
 * Cancels an active run with 'panel-disposed' and resolves ONLY AFTER (a) that run's `handle.done` has settled,
 * (b) its sealed set was released (releaseSuperseded) and THEN the final `disposeAll()` ran — which also retries
 * any `stuck` release (a transient late-set failure) once — and (c) the bridge is disposed. `released:false` only
 * when a release still fails after that retry (terminal policy: report, never hang). Waiting is bounded by every
 * wait the engine owns; it is unbounded only by a unit executor that never returns (Core open item O9):
 * `engine.dispose()` signals the run and waits for its drain as well, so the Panel has no escape hatch — a host
 * whose executor can hang must accept that or not await panel.dispose().
 */
function dispose(c) {
  if (c.disposing !== null) return c.disposing;
  c.disposed = true;
  const active = c.handle !== null && canStop(c.run) ? c.handle : null;
  const errors = [];
  c.disposing = (async () => {
    const step = (fn) => { try { return fn(); } catch (error) { errors.push(error); return undefined; } };
    step(() => bumpGeneration(c));
    step(() => clearPoll(c));
    if (active !== null) step(() => { void active.cancel('panel-disposed'); });
    step(() => unsubscribeHandle(c));
    step(() => c.queue.dispose());
    for (const off of c.disposers.splice(0)) step(() => off());
    if (active !== null) {
      let summary = null;
      try { summary = await active.done; } catch (error) { errors.push(error); }   // done never rejects; guarded anyway
      // The late-done handler already tried releaseSuperseded; repeating it here makes the release part of THIS
      // promise regardless of callback order (a non-resident set is a no-op; a failure is kept as `stuck`).
      if (summary !== null) {
        const r = step(() => c.residency.releaseSuperseded(summary));
        if (Array.isArray(r?.errors)) errors.push(...r.errors);
      }
    }
    // Final release of the displayed set + one retry of every stuck release, AFTER the late set was handled.
    const report = step(() => c.residency.disposeAll()) ?? { stuckCount: 1, errors: [] };
    c.disposeReport = report;
    if (Array.isArray(report.errors)) errors.push(...report.errors);
    try { await c.bridge.dispose(); } catch (error) { errors.push(error); }
    c.subscribers.clear();
    return { released: (Number(report.stuckCount) || 0) === 0, errors: [...errors] };
  })().then((outcome) => outcome, (error) => ({ released: false, errors: [...errors, error] }));
  return c.disposing;
}

// ── results pipeline (spec §7.3, §7.5, §8, §10, §12; Task 17) ─────────────────────────────────────────────────

const CAVEATED_CLAUSE = Object.freeze({ facet: 'caveated', op: 'eq', value: true });
const SORT_VALUES = new Set(['default', 'gap-asc', 'group-count', 'group-label']);
const GROUP_SORT = Object.freeze({ 'group-count': 'count-desc', 'group-label': 'label' });
const NO_CLAIM = Object.freeze({ allowed: false, unqualified: false, qualifiers: [], exclusions: [] });   // fail closed

function defaultView() {
  return {
    filter: EMPTY_FILTER_SPEC, textDraft: '', maxGapText: '', maxGapError: null,
    groupBy: 'none', sort: 'default', page: 0, expanded: new Set(),
  };
}

function resultsState() {
  return { pipe: null, view: defaultView(), filterTimer: null, filterEpoch: 0, freshAbort: null, freshDetach: null, freshQueued: false };
}

/** New run / Clear / New test: drop the displayed list; Group-by mode is a view preference and survives. */
function resetResultsView(c) {
  c.pipe = null;
  c.view = { ...defaultView(), groupBy: c.view.groupBy };
  c.selection = null;                                              // restore table: a new run drops the selection
  c.selectedGroupId = null;                                        // …and the group-presentation selection (spec §27.6)
  c.groupContext = null;
  c.groupMembers = null;
  c.presented = null;
  c.presentNotes = [];
}

/** A pipeline completion commits only for the displayed generation. */
function current(c, g) {
  return !c.disposed && c.gen.isCurrent(g) && c.pipe !== null && c.pipe.gen === g;
}

function startPipeline(c, g, resultSet) {
  let index = null;
  try { index = buildResultIndex(resultSet); } catch { index = null; }
  c.pipe = {
    gen: g, set: resultSet, index,
    summary: null, caveatedIds: null, maskState: 'pending',   // caveated mask: 'pending' | 'ready' | 'unavailable'
    maskMissing: false,
    freshness: null, freshnessPending: false, claim: null, claimPending: false,
    grouping: new Map(),                                     // mode id -> {state:'pending'|'ok'|'unavailable', reason, table}
    groupsById: null,
    properties: null,                                        // element-property source of the metadata modes (this generation)
    matching: null, filterBusy: false, ordered: null, textIndexed: false,
    labelsPending: null,                                     // token of the label-index build still in flight (GP-F1)
  };
  if (index === null) return;
  // One cached element-property source per result generation (Category / Level grouping): the live Model of a side is
  // resolved exactly as for element names (liveModelFor), reads are dropped once this generation is no longer current.
  c.pipe.properties = createElementPropertySource({
    resultSet, resolveModel: (modelKey) => liveModelFor(c, modelKey), scheduler: c.scheduler, isCurrent: () => current(c, g),
  });
  const p = c.pipe;
  // One summarize and one caveated mask per (generation, spec), single-flight, summarize first (§5.2, AC-P4).
  c.queue.submit({ key: 'summarize', priority: 0, job: (signal) => c.engine.derivations.summarize(resultSet, { signal }) })
    .then((r) => {
      if (!current(c, g) || r.status !== 'ok') return;
      p.summary = r.value;
      touch(c);
    }, () => {}).catch(() => { /* a throwing commit must not surface as unhandled */ });
  c.queue.submit({ key: 'caveated-mask', priority: 1, job: (signal) => c.engine.derivations.filter(resultSet, [CAVEATED_CLAUSE], { signal }) })
    .then((r) => {
      if (!current(c, g) || r.status === 'superseded') return;
      p.caveatedIds = r.status === 'ok' ? new Set(r.value.matches) : null;
      p.maskState = r.status === 'ok' ? 'ready' : 'unavailable';     // failed after the queue's bounded retries
      if (c.view.filter.unverified) refreshList(c);
      touch(c);
    }, () => {}).catch(() => { /* a throwing commit must not surface as unhandled */ });
  recheckFreshness(c);
  refreshList(c);
  ensureGrouping(c);
}

/**
 * Async freshness (and, for an EMPTY set, the no-clash claim). Re-checked on done, catalog change, model left and
 * Panel show. Triggers in the same tick are coalesced into ONE check; a newer check aborts the previous pair
 * through its own AbortController (also aborted by a generation change); an aborted read is swallowed — never
 * shown as 'unverifiable' — and the generation guard remains the final commit check.
 *
 * CLAIM GATE (review H1). For an EMPTY set the two reads are ONE snapshot: `land()` commits `freshness` and `claim`
 * together, only after BOTH reads of the SAME check completed, so the badge, the claim and the wording can never
 * describe different reads; and a re-check withdraws the held claim immediately (it never outlives the event that
 * invalidated it). Non-empty sets need no claim, so their freshness commits on its own. Each check registers ONE listener
 * on the generation signal and removes it when its reads settle or a newer check supersedes it (no per-recheck growth).
 */
function recheckFreshness(c) {
  const p = c.pipe;
  if (p === null || p.index === null) return;
  // Supersede the previous check NOW (not in the microtask below): its already-queued commit must not re-land the
  // pre-event pair after the invalidating event (review fix round 1). Its generation listener is removed here too.
  if (c.freshAbort !== null) c.freshAbort.abort();
  if (c.freshDetach !== null) c.freshDetach();
  c.freshAbort = null;
  c.freshDetach = null;
  p.freshnessPending = true;
  if (p.index.count === 0) { p.claim = null; p.claimPending = true; }   // withdraw the previous claim now (fail closed)
  if (c.freshQueued) return;                                        // coalesce a burst of triggers
  c.freshQueued = true;
  queueMicrotask(() => { c.freshQueued = false; startFreshnessCheck(c); });
}

const UNVERIFIABLE_FRESHNESS = Object.freeze({ state: 'unverifiable', reasons: [] });

function startFreshnessCheck(c) {
  const p = c.pipe;
  if (c.disposed || p === null || p.index === null) return;
  const g = p.gen;
  const runId = p.set.runId;
  if (c.freshAbort !== null) c.freshAbort.abort();                  // the previous freshness/claim pair is obsolete…
  if (c.freshDetach !== null) c.freshDetach();                      // …and stops listening to the generation signal
  const controller = new AbortController();
  c.freshAbort = controller;
  const { signal } = controller;
  const generationSignal = c.readAbort.signal;
  const onGenerationAbort = () => controller.abort();
  generationSignal.addEventListener('abort', onGenerationAbort, { once: true });
  const detach = () => generationSignal.removeEventListener('abort', onGenerationAbort);   // no listener outlives its check
  c.freshDetach = detach;
  const wantsClaim = p.index.count === 0;                           // the claim only words an EMPTY set (§7.5)
  let outstanding = wantsClaim ? 2 : 1;                             // reads of THIS check still to settle
  const release = () => { outstanding -= 1; if (outstanding === 0) detach(); };
  const reads = { freshness: null, claim: null };                   // the reads of THIS check only
  const land = () => {
    if (reads.freshness === null || (wantsClaim && reads.claim === null)) return;   // the pair is incomplete
    p.freshness = reads.freshness;
    p.freshnessPending = false;
    if (wantsClaim) { p.claim = reads.claim; p.claimPending = false; }
  };
  const commit = (apply) => (r) => {
    try {
      if (signal.aborted || r.error?.name === 'ReadAbortedError' || !current(c, g)) return;   // swallowed
      apply(r);
      land();
      touch(c);
    } finally {
      release();
    }
  };
  const settle = (promiseFn) => Promise.resolve().then(promiseFn).then((value) => ({ value }), (error) => ({ error }));
  settle(() => c.engine.getFreshness(runId, { signal })).then(commit((r) => {
    reads.freshness = r.error === undefined && r.value ? r.value : UNVERIFIABLE_FRESHNESS;   // a failed read is never 'current'
  })).catch(() => { /* a throwing commit must not surface as unhandled */ });
  if (!wantsClaim) return;
  settle(() => c.engine.assessNoClashClaim(runId, { signal })).then(commit((r) => {
    reads.claim = r.error === undefined && r.value ? r.value : NO_CLAIM;    // fail closed
  })).catch(() => { /* a throwing commit must not surface as unhandled */ });
}

/**
 * One sliced, supersedable Panel-side filter pass (filterEpoch inside the generation, §10.1). The 'unverified'
 * filter needs the caveated mask: while it is pending the previously committed list stays (busy); if it is
 * unavailable the list is an explicit error state — an empty match set is never committed for a missing mask.
 */
function refreshList(c) {
  const p = c.pipe;
  if (p === null || p.index === null) return;
  const g = p.gen;
  c.filterEpoch += 1;
  const epoch = c.filterEpoch;
  p.maskMissing = false;
  if (c.view.filter.unverified) {
    if (p.maskState === 'pending') return;                          // re-run when the mask lands (startPipeline)
    if (p.maskState === 'unavailable') { p.maskMissing = true; p.filterBusy = false; return; }
  }
  const isCurrent = () => current(c, g) && epoch === c.filterEpoch;
  p.filterBusy = true;
  Promise.resolve()
    .then(() => runFilterPass({
      index: p.index, spec: c.view.filter, caveatedIds: p.caveatedIds,
      labelText: (ref) => c.labels.searchText(ref), scheduler: c.scheduler, isCurrent,
    }))
    .then((matching) => {
      if (matching === 'superseded' || !isCurrent()) return;
      if (matching === 'mask-missing') { p.maskMissing = true; p.filterBusy = false; touch(c); return; }
      p.matching = matching;
      p.filterBusy = false;
      rebuildOrdered(c, { follow: true });
      touch(c);
    }, () => {
      if (!isCurrent()) return;
      p.filterBusy = false;
      touch(c);
    }).catch(() => { /* a throwing commit must not surface as unhandled */ });
}

function labelOfRef(c, ref) {
  return `${c.labels.modelName(ref.modelKey)} · ${c.labels.elementLabel(ref)}`;
}

const IDLE_GROUPING = Object.freeze({ state: 'idle', reason: null, table: null });

/** The cached grouping outcome of the ACTIVE mode for the displayed set ('idle' for None / not requested yet). */
function activeGrouping(c) {
  const p = c.pipe;
  const mode = groupModeOf(c.view.groupBy);
  if (p === null || mode === null || mode.grouped !== true) return IDLE_GROUPING;
  return p.grouping.get(mode.id) ?? IDLE_GROUPING;
}

/** Rebuilds the typed-array ordered index from the cached pass + group table (no Core call, AC-P4). */
function rebuildOrdered(c, { follow = false } = {}) {
  const p = c.pipe;
  if (p === null || p.matching === null) return;
  const v = c.view;
  const mode = groupModeOf(v.groupBy);
  const entry = activeGrouping(c);
  const grouped = entry.state === 'ok';
  let groups = [];
  if (grouped) {
    const matchIds = isFilterActive(v.filter) ? matchIdsFrom(p.matching, p.index) : null;
    groups = sortGroups(filterGroups(entry.table, { matchIds, index: p.index }), GROUP_SORT[v.sort] ?? 'core', (ref) => mode.labelOf(ref, c.labels));
  }
  p.groupsById = grouped ? new Map(groups.map((gr) => [gr.groupId, gr])) : null;
  p.ordered = buildOrderedIndex({
    view: grouped ? 'grouped' : 'flat', matching: p.matching, index: p.index,
    sortKey: v.sort === 'gap-asc' && p.index.isSoft ? 'gap-asc' : 'default', groups, expanded: v.expanded,
  });
  // Group-scoped navigation needs its group IN the current grouping: a filter that emptied it, or another grouping
  // mode (whose group ids never coincide), ends the scope for good — clearing filters does not resurrect it. The flat
  // (None / pending / unavailable) view leaves a scope dormant: it has no groups to contradict it (§12.3).
  if (grouped && c.selection !== null && c.selection.navScope !== null && !p.groupsById.has(c.selection.navScope)) {
    c.selection = { ...c.selection, navScope: null };
  }
  if (follow) {
    // AC-P17: the page follows the selected OCCURRENCE; a selection hidden by filters leaves the page where it is;
    // with no selection a new ordering starts at its first page.
    const pos = c.selection === null ? -1 : p.ordered.positionOf(c.selection.occurrence);
    if (pos >= 0) v.page = pageOfPosition(pos, PAGE_SIZE);
    else if (c.selection === null) v.page = 0;
  }
  v.page = clampPage(v.page, p.ordered.length, PAGE_SIZE);
  reconcileSelectedGroup(c);
}

/** Unavailable reasons of a metadata mode that a later read may cure (the property source does not cache them either). */
const TRANSIENT_GROUPING_REASONS = new Set(['properties-error', 'model-not-loaded']);

/** Drops the stored transient-unavailable outcome of `mode` so the next ensureGrouping reads again (never while pending). */
function dropTransientGrouping(c, modeId) {
  const entry = c.pipe?.grouping.get(modeId);
  if (entry !== undefined && entry.state === 'unavailable' && entry.transient === true) c.pipe.grouping.delete(modeId);
}

/** Requests the ACTIVE mode's grouping once per (generation, mode); the outcome is cached in the pipe. */
function ensureGrouping(c) {
  const p = c.pipe;
  const mode = groupModeOf(c.view.groupBy);
  if (p === null || p.index === null || mode === null || mode.grouped !== true || p.grouping.has(mode.id)) return;
  const g = p.gen;
  const entry = { state: 'pending', reason: null, table: null };
  p.grouping.set(mode.id, entry);
  const isCurrent = () => current(c, g) && p.grouping.get(mode.id) === entry;
  Promise.resolve()
    .then(() => mode.compute({ queue: c.queue, engine: c.engine, resultSet: p.set, properties: p.properties, scheduler: c.scheduler, isCurrent }))
    .then((r) => r, () => ({ status: 'unavailable', reason: 'error' }))
    .then((r) => {
      if (!current(c, g) || p.grouping.get(mode.id) !== entry) return;
      if (r?.status === 'superseded') { p.grouping.delete(mode.id); return; }
      if (r?.status === 'ok') { entry.state = 'ok'; entry.table = r.table; }
      else {
        entry.state = 'unavailable'; entry.reason = typeof r?.reason === 'string' ? r.reason : 'error';
        entry.transient = mode.usesProperties === true && TRANSIENT_GROUPING_REASONS.has(entry.reason);   // retried on the next selection
      }
      if (c.view.groupBy !== mode.id) return;                       // landed for a mode the user already left
      rebuildOrdered(c, { follow: true });
      touch(c);
    }).catch(() => { /* a throwing commit must not surface as unhandled */ });
}

/** Lazily builds the text-filter label index once per displayed set (sliced), then re-filters. */
function ensureLabelIndex(c) {
  const p = c.pipe;
  if (p === null || p.index === null || p.textIndexed || c.view.filter.text.trim() === '') return;
  p.textIndexed = true;
  const g = p.gen;
  const pass = {};
  p.labelsPending = pass;
  // A failed build settles too (the cold result is then the final one), so a selected group is never left dormant.
  const settled = (committed) => {
    if (!committed || !current(c, g) || p.labelsPending !== pass) return;
    p.labelsPending = null;
    if (c.view.filter.text.trim() !== '') refreshList(c);
  };
  c.labels.warm(p.index, { isCurrent: () => current(c, g) })
    .then(settled, () => settled(true))
    .catch(() => { /* a throwing commit must not surface as unhandled */ });
}

/** A text-filter pass run before the label index committed matched model names / dbIds only: provisional (GP-F1). */
function textPassProvisional(c) {
  return c.pipe !== null && c.pipe.labelsPending !== null && c.view.filter.text.trim() !== '';
}

function setFilter(c, patch) {
  c.view.filter = { ...c.view.filter, ...patch };
  refreshList(c);
  touch(c);
}

function onFilterText(c, intent) {
  c.view.textDraft = String(intent.value ?? '');
  if (c.filterTimer !== null) c.scheduler.clearTimeout(c.filterTimer);
  const g = c.gen.current();
  c.filterTimer = c.scheduler.setTimeout(() => {                    // debounced (FILTER_DEBOUNCE_MS)
    c.filterTimer = null;
    if (c.disposed || !c.gen.isCurrent(g)) return;
    setFilter(c, { text: c.view.textDraft });
    ensureLabelIndex(c);
  }, FILTER_DEBOUNCE_MS);
  touch(c);
}

function onFilterModel(c, intent) {
  const raw = Array.isArray(intent.value) ? intent.value : [];
  setFilter(c, { models: [...new Set(raw.filter((k) => typeof k === 'string'))] });
}

function onFilterMaxGap(c, intent) {
  const text = String(intent.value ?? '');
  const parsed = parseMaxGap(text, c.pipe?.index?.clearance ?? null);
  c.view.maxGapText = text;
  c.view.maxGapError = parsed.error;
  if (parsed.error !== null || c.pipe?.index?.isSoft !== true) { touch(c); return; }   // invalid: keep the last good filter
  setFilter(c, { maxGap: parsed.value });
}

function onFilterUnverified(c, intent) { setFilter(c, { unverified: intent.value === true }); }
function onFilterHasLocation(c, intent) { setFilter(c, { hasLocation: intent.value === true }); }

function onFilterElement(c, intent) {
  const ref = intent.ref;
  const valid = ref !== null && typeof ref === 'object' && typeof ref.modelKey === 'string' && Number.isInteger(ref.dbId);
  setFilter(c, { elementOnly: valid ? { modelKey: ref.modelKey, dbId: ref.dbId } : null });
}

function onFilterClear(c) {
  if (c.filterTimer !== null) { c.scheduler.clearTimeout(c.filterTimer); c.filterTimer = null; }
  c.view.textDraft = '';
  c.view.maxGapText = '';
  c.view.maxGapError = null;
  c.view.filter = EMPTY_FILTER_SPEC;
  refreshList(c);
  touch(c);
}

function onGroupMode(c, intent) {
  const mode = groupModeOf(intent.value);
  if (mode === null) return;                                         // unknown / not-yet-supported modes are ignored
  if (mode.id !== c.view.groupBy) endGroupSelection(c);              // §27.6: group ids never carry across modes
  c.view.groupBy = mode.id;
  dropTransientGrouping(c, mode.id);                                 // selecting a mode whose read failed transiently retries it
  ensureGrouping(c);
  rebuildOrdered(c, { follow: true });
  touch(c);
}

function onGroupToggle(c, intent) {
  if (typeof intent.groupId !== 'string') return;
  if (c.view.expanded.has(intent.groupId)) {
    c.view.expanded.delete(intent.groupId);
    // Collapsing the group the user navigates in ends group-scoped navigation (whole-list Prev/Next).
    if (c.selection !== null && c.selection.navScope === intent.groupId) c.selection = { ...c.selection, navScope: null };
  } else c.view.expanded.add(intent.groupId);
  rebuildOrdered(c);                                                // expansion keeps the current page
  touch(c);
}

function onSortSet(c, intent) {
  if (!SORT_VALUES.has(intent.value)) return;
  c.view.sort = intent.value;
  rebuildOrdered(c, { follow: true });
  touch(c);
}

function onNavPage(c, intent) {
  const length = c.pipe?.ordered?.length ?? 0;
  c.view.page = clampPage(Number(intent.page), length, PAGE_SIZE);
  touch(c);
}

function onPanelShown(c) {
  recheckFreshness(c);                                              // §7.3: re-check on Panel show
  touch(c);
}

function resultRow(c, canonicalIndex, groupId) {
  const p = c.pipe;
  const record = p.index.at(canonicalIndex);
  const resolution = resolveResult({ record, provenance: p.set.provenance, engine: c.engine, catalog: c.catalog });   // lazy (§11.2)
  const selected = c.selection !== null && c.selection.occurrence.resultId === record.resultId;   // every occurrence
  return buildRow({ record, canonicalIndex, groupId, labels: c.labels, liveness: livenessOf(resolution), caveatedIds: p.caveatedIds, selected });
}

/** Only the current page is materialized (PAGE_SIZE entries at most, spec §12.1). */
function pageRows(c) {
  const p = c.pipe;
  const mode = groupModeOf(c.view.groupBy);
  return pageSlice(p.ordered, c.view.page, PAGE_SIZE).map((entry) => {
    if (entry.kind !== 'group') return resultRow(c, entry.canonicalIndex, entry.groupId);
    const group = p.groupsById.get(entry.groupId);
    return buildGroupHeaderRow({ group, label: mode.labelOf(group.ref, c.labels), expanded: c.view.expanded.has(entry.groupId), selected: c.selectedGroupId === entry.groupId });
  });
}

// ── selection, navigation and presentation (spec §9.1–§9.6, §12.2, §12.3; Task 18) ─────────────────────────────

const ISOLATION_UNAVAILABLE_TEXT = 'Isolation is unavailable in the current viewer state.';

function selectionState() {
  return {
    selection: null,                     // {occurrence:{groupId,resultId}, navScope:string|null}
    selectedGroupId: null,               // spec §27.1: group-presentation selection; mutually exclusive with `selection`
    groupContext: null,                  // {groupId, participants, unavailable}: durable counts of the last group resolution (§27.2); never a Model
    groupMembers: null,                  // memberIndexes (canonical ints) of the last group resolution: the §27.2 refresh compares against it
    toggles: { focusOnSelect: true, isolate: false, markers: true },
    presented: null,                     // {modelKeys:string[]} of the current visualization (never a Model object)
    presentNotes: [],
  };
}

/** Sync, read-only (§9.5). Any failure reads as "unavailable" — Isolate is then disabled, never faked. */
function isolationState(c) {
  try {
    const r = c.bridge.checkIsolationPrerequisite();
    if (r?.available === true) return { available: true, reason: null };
    return { available: false, reason: typeof r?.reason === 'string' && r.reason !== '' ? r.reason : ISOLATION_UNAVAILABLE_TEXT };
  } catch {
    return { available: false, reason: ISOLATION_UNAVAILABLE_TEXT };
  }
}

function containsSorted(sorted, value) {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] === value) return true;
    if (sorted[mid] < value) lo = mid + 1; else hi = mid - 1;
  }
  return false;
}

function selectedCanonical(c) {
  const p = c.pipe;
  if (c.selection === null || p === null || p.index === null) return -1;
  return p.index.indexOfResultId(c.selection.occurrence.resultId);
}

function selectionHidden(c) {
  const i = selectedCanonical(c);
  return i >= 0 && c.pipe.matching !== null && !containsSorted(c.pipe.matching, i);
}

/** Page follows the selected OCCURRENCE (never indexOf(resultId)); a hidden selection leaves the page alone. */
function pageToSelection(c) {
  const ordered = c.pipe?.ordered ?? null;
  if (ordered === null || c.selection === null) return;
  const pos = ordered.positionOf(c.selection.occurrence);
  if (pos >= 0) c.view.page = pageOfPosition(pos, PAGE_SIZE);
}

/**
 * Presents the selected result through the bridge (the only Viewer mutator). Only live sides are sent; with no
 * live side nothing is attempted (AC-P7). Hard ⇒ `point` (witness), Soft ⇒ `closestPoints`. Isolation is
 * requested only when the §9.5 prerequisite holds. Fit only when `fit` (row/Prev/Next: Focus-on-select; Focus: always).
 */
async function present(c, { fit }) {
  const p = c.pipe;
  const i = selectedCanonical(c);
  if (c.disposed || i < 0) return;
  const record = p.index.at(i);
  const resolution = resolveResult({ record, provenance: p.set.provenance, engine: c.engine, catalog: c.catalog });
  if (!resolution.anyLive) {                                        // no Viewer action for an unresolvable result…
    const shown = c.presented !== null;
    c.presented = null;
    c.presentNotes = [];
    if (shown) await clearViewer(c);                                // …but never leave the previous clash shown
    if (!c.disposed) touch(c);                                      // a clear-only outcome is still a state change
    return;
  }
  const live = resolution.sides.filter((side) => side.state === 'live');
  const location = locationOf(record);
  const request = {
    sides: live.map((side) => ({ model: side.model, dbId: side.dbId })),
    options: { focus: fit === true, isolate: c.toggles.isolate === true && isolationState(c).available, marker: c.toggles.markers === true },
  };
  if (location?.kind === 'witness') request.point = location.point;
  if (location?.kind === 'closest-points') request.closestPoints = location.closestPoints;
  c.presented = { modelKeys: [...new Set(live.map((side) => side.modelKey))] };
  c.viewerSeq += 1;
  const seq = c.viewerSeq;
  const g = c.gen.current();
  let outcome;
  try {
    outcome = await c.bridge.present(request);
  } catch (error) {
    outcome = { superseded: false, fitted: false, isolated: false, marked: false, notes: [`The clash could not be shown in the viewer: ${String(error?.message ?? error)}`] };
  }
  if (c.disposed || !c.gen.isCurrent(g) || seq !== c.viewerSeq || outcome?.superseded === true || outcome?.disposed === true) return;
  c.presentNotes = Array.isArray(outcome?.notes) ? outcome.notes.filter((n) => typeof n === 'string') : [];
  c.isolationNotice = null;                                         // a successful present supersedes old notices
  touch(c);
}

function select(c, occurrence, navScope) {
  c.selectedGroupId = null;                                         // §27.1: a child selection ends the group selection
  c.groupContext = null;
  c.groupMembers = null;
  c.selection = { occurrence: { groupId: occurrence.groupId ?? null, resultId: occurrence.resultId }, navScope };
  c.presentNotes = [];                                              // never show the previous clash's notes with this one
  pageToSelection(c);
  touch(c);
  return present(c, { fit: c.toggles.focusOnSelect });
}

function onNavSelect(c, intent) {
  const p = c.pipe;
  if (p === null || p.index === null || typeof intent.resultId !== 'string' || p.index.indexOfResultId(intent.resultId) < 0) return undefined;
  const groupId = typeof intent.groupId === 'string' ? intent.groupId : null;
  if (groupId !== null && !c.view.expanded.has(groupId)) {        // §10.2: selecting expands the group it came from
    c.view.expanded.add(groupId);
    rebuildOrdered(c);
  }
  return select(c, { groupId, resultId: intent.resultId }, groupId);   // navScope = the group the user reads
}

function onNavStep(c, dir) {
  const ordered = c.pipe?.ordered ?? null;
  if (ordered === null) return undefined;
  const scope = c.selection?.navScope ?? null;
  const next = ordered.navNeighbor(c.selection?.occurrence ?? null, dir, scope);
  if (next === null) return undefined;                             // ends: no wrap
  // navScope is always the selected occurrence's OWN group (T14 carry-forward: navNeighbor matches by resultId
  // only): a whole-list step that landed in another group ends group-scoped navigation.
  return select(c, next, scope !== null && next.groupId === scope ? scope : null);
}

function onNavPrev(c) { return onNavStep(c, -1); }
function onNavNext(c) { return onNavStep(c, 1); }

function onActionFocus(c) { return c.selectedGroupId !== null ? presentGroup(c, { fit: true }) : present(c, { fit: true }); }   // Focus always fits

function onActionIsolate(c, intent) {
  c.toggles = { ...c.toggles, isolate: intent.value === true && isolationState(c).available };
  touch(c);
  if (c.selectedGroupId !== null) return presentGroup(c, { fit: false });
  return c.selection === null ? undefined : present(c, { fit: false });
}

function onActionMarkers(c, intent) {
  if (c.selectedGroupId !== null) return undefined;                 // §27: Markers are unavailable for a group; a forged intent changes nothing
  c.toggles = { ...c.toggles, markers: intent.value === true };
  touch(c);
  return c.selection === null ? undefined : present(c, { fit: false });
}

function onActionFocusOnSelect(c, intent) {
  c.toggles = { ...c.toggles, focusOnSelect: intent.value === true };
  touch(c);
}

/**
 * The selected group's CURRENT FILTERED membership as durable participants (spec §27.2): both sides of every member
 * clash, de-duplicated by compound {modelKey, dbId} (equal dbIds in different models stay distinct), in first-seen
 * order. One path for every grouping mode. Liveness is resolved here, at action time, through the provenance-aware
 * resolver; no Viewer Model is retained. Unavailable participants are omitted and counted.
 */
function resolveGroupMembership(c, groupId) {
  const p = c.pipe;
  const group = p?.groupsById?.get(groupId);
  if (group === undefined || p.index === null) return null;
  const seen = new Set();
  const live = [];
  let unavailable = 0;
  for (const i of group.memberIndexes) {
    const record = p.index.at(i);
    for (const ref of [record.pair.first, record.pair.second]) {
      const key = JSON.stringify([ref.modelKey, ref.dbId]);
      if (seen.has(key)) continue;
      seen.add(key);
      const side = resolveSide({ ref, provenance: p.set.provenance, engine: c.engine, catalog: c.catalog });
      if (side.state === 'live') live.push({ modelKey: side.modelKey, model: side.model, dbId: side.dbId });
      else unavailable += 1;
    }
  }
  return { live, participants: seen.size, unavailable, members: group.memberIndexes };
}

/**
 * Presents the selected group through the bridge's aggregate operation (the sibling of present(); never a fallback
 * through it). With no live participant nothing is attempted and any previous presentation is cleared, keeping the
 * selected-group state truthful. Isolation only when the §9.5 prerequisite holds; no marker option exists.
 */
async function presentGroup(c, { fit }) {
  const groupId = c.selectedGroupId;
  if (c.disposed || groupId === null) return;
  const membership = resolveGroupMembership(c, groupId);
  if (membership === null) return;                                   // the group left the current filtered list
  c.groupContext = { groupId, participants: membership.participants, unavailable: membership.unavailable };
  c.groupMembers = membership.members;
  if (membership.live.length === 0) {
    const shown = c.presented !== null;
    c.presented = null;
    c.presentNotes = [];
    if (shown) await clearViewer(c);
    if (!c.disposed) touch(c);
    return;
  }
  const request = {
    participants: membership.live.map((x) => ({ model: x.model, dbId: x.dbId })),
    options: { focus: fit === true, isolate: c.toggles.isolate === true && isolationState(c).available },
  };
  c.presented = { modelKeys: [...new Set(membership.live.map((x) => x.modelKey))] };
  c.viewerSeq += 1;
  const seq = c.viewerSeq;
  const g = c.gen.current();
  let outcome;
  try {
    outcome = await c.bridge.presentGroup(request);
  } catch (error) {
    outcome = { superseded: false, fitted: false, isolated: false, notes: [`The clash group could not be shown in the viewer: ${String(error?.message ?? error)}`] };
  }
  if (c.disposed || !c.gen.isCurrent(g) || seq !== c.viewerSeq || outcome?.superseded === true || outcome?.disposed === true) return;
  c.presentNotes = Array.isArray(outcome?.notes) ? outcome.notes.filter((n) => typeof n === 'string') : [];
  c.isolationNotice = null;
  touch(c);
}

/**
 * GROUP_PRESENT (spec §27.1/§27.2): the group row body selects the group (clearing the clash selection and its
 * navScope, never altering expansion) and presents its current filtered membership. Unknown/filtered-out groups and
 * the flat view are ignored: `groupsById` holds only the groups of the current filtered list.
 */
function onGroupPresent(c, intent) {
  const groups = c.pipe?.groupsById ?? null;
  if (typeof intent.groupId !== 'string' || groups === null || !groups.has(intent.groupId)) return undefined;
  c.selectedGroupId = intent.groupId;
  c.selection = null;
  c.groupContext = null;
  c.groupMembers = null;
  c.presentNotes = [];
  touch(c);
  return presentGroup(c, { fit: c.toggles.focusOnSelect });
}

/**
 * Ends the group selection (spec §27.6: group disappearance, grouping-mode change). An aggregate still shown is cleared
 * through the guarded bridge path; when nothing is shown (panel hidden, no live participant) the Viewer is untouched.
 */
function endGroupSelection(c) {
  if (c.selectedGroupId === null) return;
  c.selectedGroupId = null;
  c.groupContext = null;
  c.groupMembers = null;
  c.presentNotes = [];
  if (c.presented === null) return;
  c.presented = null;
  clearViewer(c).catch(() => { /* a throwing commit must not surface as unhandled */ });
}

const sameMembers = (a, b) => a === b || (a !== null && b !== null && a.length === b.length && a.every((v, k) => v === b[k]));

/**
 * Spec §27.2 refresh, run after every list rebuild (filters, grouping landing, model-left regrouping). The selected group
 * is judged against the CURRENT filtered grouping: gone ⇒ selection and presentation end; a changed membership is
 * re-presented only while an aggregate is shown (a hidden panel or a cleared presentation is never silently re-shown —
 * the next row activation or Focus/Isolate re-resolves). Expansion, page and sort leave memberIndexes unchanged ⇒ no-op.
 * A regrouping still in flight, or a text pass run before the label index committed (GP-F1: the cold first pass is
 * re-run once names land), leaves the selection dormant until the real result lands.
 */
function reconcileSelectedGroup(c) {
  const groupId = c.selectedGroupId;
  if (groupId === null || activeGrouping(c).state === 'pending' || textPassProvisional(c)) return;
  const group = c.pipe?.groupsById?.get(groupId);
  if (group === undefined) { endGroupSelection(c); return; }
  if (c.presented === null || sameMembers(group.memberIndexes, c.groupMembers)) return;
  presentGroup(c, { fit: c.toggles.focusOnSelect }).catch(() => { /* a throwing commit must not surface as unhandled */ });
}

/** Back to All = bridge.clear() + clear selection + navScope; filters, grouping, page and results untouched. */
function onBackToAll(c) {
  c.selection = null;
  c.selectedGroupId = null;
  c.groupContext = null;
  c.groupMembers = null;
  c.presented = null;
  c.presentNotes = [];
  touch(c);
  return clearViewer(c);
}

/** Restore-table "Hide Panel": clear the visualization, KEEP the selection (reapply via Focus). */
function onPanelHidden(c) {
  c.presented = null;
  c.presentNotes = [];
  touch(c);
  return clearViewer(c);
}

/**
 * bridge.onModelLeft ('unload' or 'removed'; a real unload may deliver both for one model — idempotent):
 * clear the visualization iff it references that model (unknown key ⇒ conservatively clear), forget its
 * search labels, re-check freshness; results, counts, filters and grouping stay (rows re-resolve lazily).
 */
function onModelLeft(c, event) {
  if (c.disposed) return;
  let key = null;
  try { key = c.catalog.keyOfModel(event?.model); } catch { key = null; }
  // Forget the left model's search labels. reset() (not forgetModel alone) also supersedes an in-flight warm() that
  // already read that model's names (T15 carry-forward); the index is then rebuilt from the models still live.
  c.labels.reset();
  if (c.pipe !== null) { c.pipe.textIndexed = false; ensureLabelIndex(c); }
  forgetPropertyGroupings(c, key);
  const shown = c.presented;
  if (shown !== null && (typeof key !== 'string' || shown.modelKeys.includes(key))) {
    c.presented = null;
    c.presentNotes = [];
    clearViewer(c).catch(() => { /* a throwing commit must not surface as unhandled */ });
  }
  recheckFreshness(c);
  touch(c);
}

/**
 * A model of the displayed run left the scene (or an unknown model did — conservatively treated alike): its element
 * properties are no longer readable, so the property cache and every metadata-mode grouping outcome are dropped; the
 * active metadata mode recomputes at once (and reports 'model-not-loaded' instead of keeping stale groups).
 */
function retryModelNotLoaded(c) {
  const p = c.pipe;
  if (p === null || p.properties === null) return;
  let dropped = false;
  for (const id of GROUP_MODE_IDS) {
    const entry = p.grouping.get(id);
    if (entry !== undefined && entry.state === 'unavailable' && entry.reason === 'model-not-loaded' && p.grouping.delete(id)) dropped = true;
  }
  if (!dropped) return;
  ensureGrouping(c);                                                // active mode only; others recompute when selected
  rebuildOrdered(c, { follow: true });
}

function forgetPropertyGroupings(c, modelKey) {
  const p = c.pipe;
  if (p === null || p.properties === null) return;
  const participating = (p.set?.provenance?.models ?? []).some((m) => m?.modelKey === modelKey);
  if (typeof modelKey === 'string' && !participating) return;
  p.properties.invalidate();
  let dropped = false;
  for (const id of GROUP_MODE_IDS) {
    if (groupModeOf(id).usesProperties === true && p.grouping.delete(id)) dropped = true;
  }
  if (!dropped) return;
  ensureGrouping(c);
  rebuildOrdered(c, { follow: true });
}

function navOf(c) {
  const ordered = c.pipe?.ordered ?? null;
  const sel = c.selection;
  // The group-scope wording (nav.scoped; the DOM renders 'Previous/Next in group') only when Prev/Next actually step that group: grouped view with the scope group PRESENT in
  // the current grouping and expanded (orderedList.navNeighbor's own condition). After Group → None the flat list has
  // no group scope; a group filtered away (or from another mode) is no scope either.
  const scoped = sel !== null && sel.navScope !== null && ordered !== null && ordered.view === 'grouped'
    && c.pipe.groupsById !== null && c.pipe.groupsById.has(sel.navScope) && c.view.expanded.has(sel.navScope);
  const label = sel === null ? 'No clash selected' : `Clash #${selectedCanonical(c) + 1}`;
  if (ordered === null) return { canPrev: false, canNext: false, label, scoped };
  const occ = sel?.occurrence ?? null;
  const scope = sel?.navScope ?? null;
  return { canPrev: ordered.navNeighbor(occ, -1, scope) !== null, canNext: ordered.navNeighbor(occ, 1, scope) !== null, label, scoped };
}

// ── view input (pure data handed to viewModel.js) ─────────────────────────────────────────────────────────────

function viewInput(c) {
  return {
    version: c.version,
    setup: setupInput(c),
    run: runInput(c),
    displayed: displayedInput(c),
    list: listInput(c),
    selected: selectedInput(c),
    test: testInput(c),
  };
}

function setupInput(c) {
  let entries = [];
  try { entries = c.catalog.list() ?? []; } catch { entries = []; }
  const models = (Array.isArray(entries) ? entries : []).map((e) => {
    const modelKey = typeof e?.modelKey === 'string' ? e.modelKey : null;
    // Keyed models show the disambiguated name (RF-2); an unidentified model shows the host's raw name.
    const displayName = modelKey !== null ? c.labels.modelName(modelKey) : String(e?.displayName ?? '');
    return { modelKey, displayName, loaded: e?.loaded === true, registered: modelKey !== null && readBinding(c, modelKey) !== null };
  });
  return {
    draft: c.draft, validation: c.validation, soft: c.soft, models,
    modelName: (modelKey) => c.labels.modelName(modelKey),
    setupChangedSinceRun: c.setupChanged, collapsed: c.setupCollapsed, runActive: isActive(c),
  };
}

function runInput(c) {
  return {
    machine: c.run,
    snapshot: isActive(c) ? c.snapshot : null,
    elapsedMs: c.run.startedAtMs === null || !isActive(c) ? null : Math.max(0, c.scheduler.now() - c.run.startedAtMs),
    canRun: canRunNow(c),
    canStop: !c.disposed && c.handle !== null && canStop(c.run),
    admission: c.admission, confirm: c.confirm, releaseErrors: c.releaseErrors, releaseStuck: c.releaseStuck,
    residencyNotice: c.residencyNotice, setupChanged: c.setupChanged, isolationNotice: c.isolationNotice,
  };
}

function displayedInput(c) {
  if (c.displayed === null) return null;
  const p = c.pipe;
  return {
    ...c.displayed,
    freshness: p?.freshness ?? null, freshnessPending: p?.freshnessPending === true,
    claim: p?.claim ?? null, claimPending: p?.claimPending === true,
    summary: p?.summary ?? null,
    runRecord: c.runRecord,
  };
}

function listInput(c) {
  const p = c.pipe;
  if (p === null || p.index === null) return null;
  const v = c.view;
  const ordered = p.ordered;
  const elementOnly = v.filter.elementOnly;
  const grouping = activeGrouping(c);
  return {
    total: p.index.count,
    filtered: p.matching === null ? null : p.matching.length,
    busy: p.filterBusy || grouping.state === 'pending' || (v.filter.unverified && p.maskState === 'pending'),
    maskUnavailable: v.filter.unverified === true && p.maskMissing === true,
    spec: v.filter, textDraft: v.textDraft, maxGapText: v.maxGapText, maxGapError: v.maxGapError,
    groupBy: v.groupBy, groupingState: grouping.state, groupingReason: grouping.reason,
    sort: v.sort, isSoft: p.index.isSoft, clearance: p.index.clearance,
    modelOptions: p.index.models.map((m) => ({ modelKey: m.modelKey, label: c.labels.modelName(m.modelKey) })),
    elementOnly: elementOnly === null ? null : { ...elementOnly, label: labelOfRef(c, elementOnly) },
    view: ordered === null ? 'flat' : ordered.view,
    page: { index: v.page, count: ordered === null ? 0 : Math.max(1, Math.ceil(ordered.length / PAGE_SIZE)), size: PAGE_SIZE },
    rows: ordered === null ? [] : pageRows(c),
    nav: navOf(c),
    hiddenByFilters: selectionHidden(c),
  };
}

/** §26.2 (b): read-only snapshot for the Clash Tests manager. `draft` is the frozen draft itself (identity). */
function testInput(c) {
  return { testId: c.draft.testId, draft: c.draft, runActive: isActive(c), heldUnsaved: heldUnsaved(c), pendingConfirm: c.confirm !== null, lastRun: c.lastSealed };
}

/**
 * Group-selected variant input (spec §27.5). Built fresh at every ViewModel build from the CURRENT filtered membership and
 * the current catalog (like the child's liveness), so the counts stay truthful after model departure/re-entry; only
 * numbers and strings, never a Viewer Model. A group that is not in the current list (regrouping in flight) has no variant.
 */
function groupSelectedInput(c) {
  const group = c.pipe?.groupsById?.get(c.selectedGroupId);
  if (group === undefined || c.pipe.index === null) return null;
  const membership = resolveGroupMembership(c, c.selectedGroupId);
  return {
    kind: 'group', groupId: c.selectedGroupId, label: groupModeOf(c.view.groupBy).labelOf(group.ref, c.labels),
    clashCount: group.memberIndexes.length, participants: membership.participants, shown: membership.live.length,
    unavailable: membership.unavailable, notes: [...c.presentNotes], isolation: isolationState(c), toggles: { ...c.toggles },
  };
}

function selectedInput(c) {
  if (c.selectedGroupId !== null) return groupSelectedInput(c);
  const i = selectedCanonical(c);
  if (i < 0) return null;
  const p = c.pipe;
  const record = p.index.at(i);
  const resolution = resolveResult({ record, provenance: p.set.provenance, engine: c.engine, catalog: c.catalog });
  return {
    resultId: record.resultId, ordinal: i + 1,
    side1: sideView(record.pair.first, c.labels), side2: sideView(record.pair.second, c.labels),
    gap: gapOf(record), hasLocation: locationOf(record) !== null, liveness: livenessOf(resolution),
    notes: [...resolution.notes, ...c.presentNotes], hiddenByFilters: selectionHidden(c),
    anyLive: resolution.anyLive, isolation: isolationState(c), toggles: { ...c.toggles },
  };
}

// ── dispatch ────────────────────────────────────────────────────────────────────────────────────────────────────

const DISPATCH = {
  [INTENT.SETUP_NAME]: onSetupName,
  [INTENT.SETUP_MODE]: onSetupMode,
  [INTENT.SETUP_CLEARANCE]: onSetupClearance,
  [INTENT.SETUP_BASIS]: onSetupBasis,
  [INTENT.SETUP_TOGGLE_MODEL]: onSetupToggleModel,
  [INTENT.SETUP_USE_SELECTION]: onSetupUseSelection,
  [INTENT.SETUP_SELF_CLASH]: onSetupSelfClash,
  [INTENT.SETUP_NEW_TEST]: onSetupNewTest,
  [INTENT.SETUP_TOGGLE_COLLAPSED]: onSetupToggleCollapsed,
  [INTENT.RUN_START]: onRunStart,
  [INTENT.RUN_STOP]: onRunStop,
  [INTENT.RESULTS_CLEAR]: onResultsClear,
  [INTENT.RESULTS_CLEAR_CONFIRMED]: onResultsClearConfirmed,
  [INTENT.RUN_RELEASE_AND_RETRY]: onReleaseAndRetry,
  [INTENT.DIAGNOSTICS_COPY]: onDiagnosticsCopy,
  [INTENT.FILTER_TEXT]: onFilterText,
  [INTENT.FILTER_MODEL]: onFilterModel,
  [INTENT.FILTER_MAX_GAP]: onFilterMaxGap,
  [INTENT.FILTER_UNVERIFIED]: onFilterUnverified,
  [INTENT.FILTER_HAS_LOCATION]: onFilterHasLocation,
  [INTENT.FILTER_ELEMENT]: onFilterElement,
  [INTENT.FILTER_CLEAR]: onFilterClear,
  [INTENT.GROUP_MODE]: onGroupMode,
  [INTENT.GROUP_TOGGLE]: onGroupToggle,
  [INTENT.GROUP_PRESENT]: onGroupPresent,
  [INTENT.SORT_SET]: onSortSet,
  [INTENT.NAV_PAGE]: onNavPage,
  [INTENT.PANEL_SHOWN]: onPanelShown,
  [INTENT.NAV_SELECT]: onNavSelect,
  [INTENT.NAV_PREV]: onNavPrev,
  [INTENT.NAV_NEXT]: onNavNext,
  [INTENT.ACTION_FOCUS]: onActionFocus,
  [INTENT.ACTION_ISOLATE]: onActionIsolate,
  [INTENT.ACTION_MARKERS]: onActionMarkers,
  [INTENT.ACTION_FOCUS_ON_SELECT]: onActionFocusOnSelect,
  [INTENT.ACTION_BACK_TO_ALL]: onBackToAll,
  [INTENT.PANEL_HIDDEN]: onPanelHidden,
  [INTENT.TEST_LOAD]: onTestLoad,
  [INTENT.CONFIRM_CANCEL]: onConfirmCancel,
  [INTENT.TEST_LABEL_SCOPE]: onTestLabelScope,
};

/** Unknown intents throw synchronously (a programming error in the UI); known intents resolve after their effect
 *  (with undefined, except DIAGNOSTICS_COPY — the diagnostics string — and TEST_LOAD — its LoadResult). */
function dispatch(c, intent) {
  if (intent === null || typeof intent !== 'object' || typeof intent.type !== 'string') {
    throw new TypeError('unknown intent: an intent must be an object with a string `type`');
  }
  const handler = Object.prototype.hasOwnProperty.call(DISPATCH, intent.type) ? DISPATCH[intent.type] : undefined;
  if (handler === undefined) throw new TypeError(`unknown intent: ${intent.type}`);
  if (c.disposed) return Promise.resolve(intent.type === INTENT.TEST_LOAD ? loadRefusal(c, LOAD_REASON.DISPOSED) : undefined);
  try {
    return Promise.resolve(handler(c, intent));
  } catch (error) {
    return Promise.reject(error);
  }
}
