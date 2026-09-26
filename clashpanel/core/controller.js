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
import { createDerivationQueue } from './derivationQueue.js';
import { RUN_PHASE, initialRunState, reduceRun, canRun, canStop } from './runMachine.js';
import { createResidency } from './residency.js';
import { mapAdmissionError, diagnosticsExport } from './runReport.js';
import { createLabelResolver } from './labels.js';
import { resolveSide } from './resolve.js';
import { buildViewModel } from './viewModel.js';
import { BASIS_VERDICT_TIMEOUT_MS, READINESS_POLL_MS } from './constants.js';

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
    runRecord: null,                       // Panel-local facts captured when the run was ADMITTED (not in the sealed set)
    readAbort: new AbortController(),
  };
  c.labels = createLabelResolver({
    catalog, scheduler,
    resolveLiveModel: (modelKey) => liveModelFor(c, modelKey),
    // Models known only from the displayed run (e.g. unloaded since) still count for name disambiguation (RF-2).
    knownModelKeys: () => (c.displayed?.resultSet?.provenance?.models ?? []).map((m) => m.modelKey),
  });
  revalidate(c);
  c.disposers.push(catalog.onChange(() => onCatalogChange(c)));

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

function onCatalogChange(c) {
  if (c.disposed) return;
  c.labels.invalidateNames();                                     // names/known models may have changed (RF-2)
  revalidate(c, { reEvaluateSoft: true });                        // readiness/registration/basis may have changed
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
  const prepared = prepareRun(c.draft);
  if (prepared.definition === null) { c.validation = safeValidate(c); touch(c); return; }
  const confirmedDiscard = acknowledgeUnsaved === true;
  if (confirmedDiscard) retireDisplayed(c, { acknowledgeUnsaved: true });   // consented: free the slot first
  let handle;
  try {
    handle = c.engine.startRun(prepared.definition);
  } catch (error) {
    // Admission failure: previous results, residency and Viewer state stay exactly as they were (AC-P14) —
    // unless the user already confirmed discarding them (then they were released above, by consent).
    c.admission = mapAdmissionError(error, { heldRunId: c.residency.current()?.runId ?? null });
    c.run = reduceRun(c.run, { type: 'admission-failed', error });
    c.setupCollapsed = false;                                     // §14.3: Setup re-expands when a run cannot start
    touch(c);
    return;
  }
  c.draft = prepared.draft;                                       // revision rule applied only for an admitted run
  c.admission = null;
  if (!confirmedDiscard) retireDisplayed(c, { acknowledgeUnsaved: false });   // ONLY now: generation++, bridge.clear(), release
  c.runRecord = { basisVerdict: c.soft.verdict };                 // §6.2 step 4: the basis verdict this run was admitted under
  c.hasRun = true;
  c.setupChanged = false;
  c.setupCollapsed = true;                                        // spec §14.3: collapses when a run starts
  adoptHandle(c, handle);
  touch(c);
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
  c.labels.invalidateNames();                                     // the displayed run's models join the known set
  if (summary.status === 'failed' || !summary.resultSet) c.setupCollapsed = false;   // §14.3: re-expands on failure
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

// ── view input (pure data handed to viewModel.js) ─────────────────────────────────────────────────────────────

function viewInput(c) {
  return {
    version: c.version,
    setup: setupInput(c),
    run: runInput(c),
    displayed: displayedInput(c),
    list: listInput(c),
    selected: selectedInput(c),
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
  return { ...c.displayed, freshness: null, freshnessPending: false, claim: null, claimPending: false };
}

/** Task 16 has no browsable list yet (Task 17 builds the results pipeline). */
function listInput() { return null; }

/** Task 16 has no selection yet (Task 18 adds selection and navigation). */
function selectedInput() { return null; }

// ── dispatch ────────────────────────────────────────────────────────────────────────────────────────────────────

const DISPATCH = {
  [INTENT.SETUP_NAME]: onSetupName,
  [INTENT.SETUP_MODE]: onSetupMode,
  [INTENT.SETUP_CLEARANCE]: onSetupClearance,
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
};

/** Unknown intents throw synchronously (a programming error in the UI); known intents resolve after their effect
 *  (with `undefined`, except DIAGNOSTICS_COPY which resolves with the diagnostics string). */
function dispatch(c, intent) {
  if (intent === null || typeof intent !== 'object' || typeof intent.type !== 'string') {
    throw new TypeError('unknown intent: an intent must be an object with a string `type`');
  }
  const handler = Object.prototype.hasOwnProperty.call(DISPATCH, intent.type) ? DISPATCH[intent.type] : undefined;
  if (handler === undefined) throw new TypeError(`unknown intent: ${intent.type}`);
  if (c.disposed) return Promise.resolve(undefined);
  try {
    return Promise.resolve(handler(c, intent));
  } catch (error) {
    return Promise.reject(error);
  }
}
