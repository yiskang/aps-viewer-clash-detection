// clashpanel/core/testsManager.js
// Spec §26: the session-scoped Clash Tests manager (headless; same layering as the controller, AC-P10). It owns the
// test RECORDS, the active-test id, the session counter and its own view state, and drives exactly ONE editor — the
// existing Panel controller — through its public surface and the four additive seams: TEST_LOAD, vm.test,
// CONFIRM_CANCEL (§26.2 (a)–(c)) and TEST_LABEL_SCOPE (seam (e), owner decision G-A2). It never calls the engine's
// run/residency/derivation methods (it reads only registry.bindingFor), never calls the ViewerBridge's present/clear
// (it only subscribes to onModelLeft), holds no Model (a model-left event's Model is reduced to its catalog key at
// once), persists nothing.
import { INTENT, MANAGER_INTENT } from './intents.js';
import { narrowEnginePort, assertCatalogPort } from './ports.js';
import { createDraft } from './draft.js';
import { duplicateDraft, duplicateName } from './testDrafts.js';
import { readinessOf, modelsChangedOf } from './testReadiness.js';
import { disambiguatedNames, fallbackModelName } from './labels.js';
import { buildManagerViewModel, actionGate, lockedEditorVm, MANAGER_TEXT } from './managerViewModel.js';

const MANAGER_TYPES = new Set(Object.values(MANAGER_INTENT));

// Work plan review M2 — the terminal-fault intent policy (spec §26.2a, §26.9, AC-M16; plan decision P-3). EVERY editor
// INTENT value is classified; dispatch forwards only 'allow' (an unclassified type is dropped — fail closed — and fails
// the classification test).
//   allow: cannot edit the setup, start a run or present/mutate the Viewer from the divergent editor — non-mutating
//          list navigation/filter/group/sort/page and view preferences, Stop, Clear results (+ confirmation / cancel),
//          hide (the existing bridge.clear() cleanup path) / show (freshness re-check), diagnostics.
//   block: setup edits, run/admission, every result action that presents or clears Viewer state (select/Prev/Next
//          present the clash; Focus/Isolate/Markers present; Back to All clears), and the manager-only seams.
const ALLOW = 'allow';
const BLOCK = 'block';
export const FAULT_POLICY = Object.freeze({
  [INTENT.SETUP_NAME]: BLOCK, [INTENT.SETUP_MODE]: BLOCK, [INTENT.SETUP_CLEARANCE]: BLOCK, [INTENT.SETUP_BASIS]: BLOCK,
  [INTENT.SETUP_TOGGLE_MODEL]: BLOCK, [INTENT.SETUP_USE_SELECTION]: BLOCK, [INTENT.SETUP_SELF_CLASH]: BLOCK,
  [INTENT.SETUP_NEW_TEST]: BLOCK, [INTENT.SETUP_TOGGLE_COLLAPSED]: ALLOW,
  [INTENT.RUN_START]: BLOCK, [INTENT.RUN_STOP]: ALLOW, [INTENT.RESULTS_CLEAR]: ALLOW, [INTENT.RESULTS_CLEAR_CONFIRMED]: ALLOW,
  [INTENT.RUN_RELEASE_AND_RETRY]: BLOCK,
  [INTENT.FILTER_TEXT]: ALLOW, [INTENT.FILTER_MODEL]: ALLOW, [INTENT.FILTER_MAX_GAP]: ALLOW, [INTENT.FILTER_UNVERIFIED]: ALLOW,
  [INTENT.FILTER_HAS_LOCATION]: ALLOW, [INTENT.FILTER_ELEMENT]: ALLOW, [INTENT.FILTER_CLEAR]: ALLOW,
  [INTENT.GROUP_MODE]: ALLOW, [INTENT.GROUP_TOGGLE]: ALLOW, [INTENT.SORT_SET]: ALLOW,
  [INTENT.NAV_SELECT]: BLOCK, [INTENT.NAV_PREV]: BLOCK, [INTENT.NAV_NEXT]: BLOCK, [INTENT.NAV_PAGE]: ALLOW,
  [INTENT.ACTION_FOCUS]: BLOCK, [INTENT.ACTION_ISOLATE]: BLOCK, [INTENT.ACTION_MARKERS]: BLOCK,
  [INTENT.ACTION_FOCUS_ON_SELECT]: ALLOW, [INTENT.ACTION_BACK_TO_ALL]: BLOCK,
  [INTENT.PANEL_HIDDEN]: ALLOW, [INTENT.PANEL_SHOWN]: ALLOW, [INTENT.DIAGNOSTICS_COPY]: ALLOW,
  [INTENT.TEST_LOAD]: BLOCK, [INTENT.CONFIRM_CANCEL]: ALLOW, [INTENT.TEST_LABEL_SCOPE]: BLOCK,
});

export function createTestsManager({ editor, engine, catalog, bridge, scheduler, mintId = () => globalThis.crypto.randomUUID() } = {}) {
  for (const name of ['getViewModel', 'subscribe', 'dispatch']) {
    if (typeof editor?.[name] !== 'function') throw new TypeError(`createTestsManager: editor.${name} is required`);
  }
  const port = narrowEnginePort(engine);
  assertCatalogPort(catalog);
  if (typeof bridge?.onModelLeft !== 'function') throw new TypeError('createTestsManager: bridge.onModelLeft is required');
  if (typeof scheduler?.now !== 'function') throw new TypeError('createTestsManager: scheduler.now is required');
  const first = editor.getViewModel();
  if (typeof first?.test?.testId !== 'string' || first.test.draft?.testId !== first.test.testId) {
    throw new TypeError('createTestsManager: the editor ViewModel has no valid `test` snapshot (spec §26.2 (b))');
  }
  const m = {
    editor, catalog, scheduler, mintId,
    bindingFor: (modelKey) => port.registry.bindingFor(modelKey),
    records: new Map(), seq: 0, counter: first.test.draft.testCounter,
    activeTestId: first.test.testId, view: 'editor',
    pending: null, activation: null, recovery: null, fault: null, notice: null, live: '', liveSeq: 0,
    opSeq: 0, recoverySeq: 0,
    catalogEpoch: 0, recordsVersion: 0, derived: null,              // derived-row cache (Codex plan review Q1; CTM-8)
    departed: new Set(),                                            // H1: modelKeys (strings only) left but still listed
    labelScopeSig: '', labelScopeVersion: -1,                       // seam (e): last scope pushed ('' = the editor's initial [])
    editorVm: first, version: 0, vmCache: null, subscribers: new Set(), disposers: [], disposed: false,
  };
  addRecord(m, first.test.draft);                                   // the initial "Clash test 1" minted by the editor (§6.1)
  reduceSummary(m.records.get(m.activeTestId), first.test.lastRun);
  try {                                                            // transactional: a failure unwinds every acquired listener
    register(m, 'editor.subscribe', () => editor.subscribe((vm) => onEditorNotification(m, vm)));
    register(m, 'catalog.onChange', () => catalog.onChange(() => onCatalogChange(m)));
    register(m, 'bridge.onModelLeft', () => bridge.onModelLeft((event) => onModelLeft(m, event)));
    pushLabelScope(m);
  } catch (err) {
    m.disposed = true;                                              // a late callback of the abandoned manager is inert
    runDisposers(m);
    throw err;
  }
  return Object.freeze({
    getViewModel: () => viewModelOf(m),
    subscribe(cb) {
      if (typeof cb !== 'function') throw new TypeError('subscribe: callback must be a function');
      if (m.disposed) return () => {};
      m.subscribers.add(cb);
      return () => { m.subscribers.delete(cb); };
    },
    dispatch: (intent) => dispatch(m, intent),
    dispose: () => dispose(m),
  });
}

/** Acquire one registration; its disposer must be a function (else TypeError — the caller unwinds what is held). */
function register(m, what, acquire) {
  const off = acquire();
  if (typeof off !== 'function') throw new TypeError(`createTestsManager: ${what} must return an unsubscribe function`);
  m.disposers.push(off);
}

/** Run every acquired disposer once, in REVERSE acquisition order; one failing disposer never skips the rest. */
function runDisposers(m) {
  for (const off of m.disposers.splice(0).reverse()) {
    try { off(); } catch { /* keep going */ }
  }
}

// ── state container ─────────────────────────────────────────────────────────────────────────────────────────────

/** Any change of record membership, a record's draft or its summary invalidates the derived-row cache. */
const recordsChanged = (m) => { m.recordsVersion += 1; };

function addRecord(m, draft) {
  m.seq += 1;
  const record = { testId: draft.testId, draft, summary: null, lastReducedRunId: null, createdAt: m.scheduler.now(), seq: m.seq };
  m.records.set(record.testId, record);
  recordsChanged(m);
  return record;
}

function removeRecord(m, testId) {
  if (m.records.delete(testId)) recordsChanged(m);
}

/** Codex plan review I3: an injected id must be a non-empty string no record uses; otherwise the action is refused. */
function mintFresh(m) {
  let id = null;
  try { id = m.mintId(); } catch { id = null; }
  return typeof id === 'string' && id.length > 0 && !m.records.has(id) ? id : null;
}

function refuseNoId(m) {
  m.notice = MANAGER_TEXT.NO_ID;
  changed(m);
  return undefined;
}

const nameOf = (m, testId) => m.records.get(testId)?.draft.name ?? '';
const isBusy = (m) => m.pending !== null || m.activation !== null || m.recovery !== null;

function changed(m) {
  m.version += 1;
  m.vmCache = null;
  if (m.subscribers.size > 0) {
    const vm = viewModelOf(m);
    for (const cb of [...m.subscribers]) {
      try { cb(vm); } catch { /* a subscriber failure never breaks the manager */ }
    }
  }
  pushLabelScope(m);                                                // last: the editor's notification re-enters changed()
}

/** §26.6 triggers: catalog.onChange and bridge.onModelLeft — the only events that refresh readiness / models changed / names. */
function invalidate(m) {
  if (m.disposed) return;
  m.catalogEpoch += 1;
  changed(m);
}

/** The modelKeys the catalog lists right now (strings only; a throwing catalog lists nothing). */
function listedKeys(m) {
  let entries = [];
  try { entries = m.catalog.list() ?? []; } catch { entries = []; }
  return new Set((Array.isArray(entries) ? entries : []).map((e) => e?.modelKey).filter((k) => typeof k === 'string'));
}

/**
 * §26.6 / AC-M10, Work plan review H1: the model-left event is itself a recomputation trigger. Its Model is resolved
 * through the existing catalog identity read (the editor's contract, controller.js onModelLeft) and dropped at once;
 * only the KEY is kept. A key the catalog still lists (BEFORE_MODEL_UNLOAD precedes the catalog change) is "departed":
 * absent for readiness / models changed / "(not loaded)" until the catalog confirms the removal. A model without a key
 * attributes nothing (no row can be named) and only recomputes.
 */
function onModelLeft(m, event) {
  if (m.disposed) return;
  let key = null;
  try { key = m.catalog.keyOfModel(event?.model); } catch { key = null; }
  if (typeof key === 'string' && key.length > 0 && listedKeys(m).has(key)) m.departed.add(key);
  invalidate(m);
}

/**
 * The ONLY reconciliation of a departed key: an authoritative catalog notification that no longer lists it (removal
 * observed). From then on a same-key entry is ordinary re-entry. A notification that still lists it reconciles nothing.
 */
function onCatalogChange(m) {
  if (m.disposed) return;
  if (m.departed.size > 0) {
    const listed = listedKeys(m);
    for (const key of [...m.departed]) if (!listed.has(key)) m.departed.delete(key);
  }
  invalidate(m);
}

/** CTM-2 / seam (e): every modelKey any record references — Set A/B model keys and element keys, summary models. Sorted. */
function labelScopeOf(m) {
  const keys = new Set();
  for (const r of m.records.values()) {
    for (const side of [r.draft.setA, r.draft.setB]) {
      for (const k of side.modelKeys) keys.add(k);
      for (const k of Object.keys(side.elements)) keys.add(k);
    }
    for (const row of r.summary?.models ?? []) if (typeof row?.modelKey === 'string') keys.add(row.modelKey);
  }
  return [...keys].sort();
}

/**
 * Seam (e), owner decision G-A2 (Work plan review H2): hand the editor's label resolver the SAME referenced-key scope the
 * rows use, so a modelKey has one label in the list and the editor. Checked once per recordsVersion; dispatched only when
 * the scope changed. The editor's synchronous notification re-enters changed(), which finds the version already handled.
 */
function pushLabelScope(m) {
  if (m.disposed || m.labelScopeVersion === m.recordsVersion) return;
  m.labelScopeVersion = m.recordsVersion;
  const modelKeys = labelScopeOf(m);
  const sig = modelKeys.join('\u0000');
  if (sig === m.labelScopeSig) return;
  m.labelScopeSig = sig;
  // A scope the editor did not take (sync throw / rejection) is not remembered as pushed: the next records change
  // pushes again. Committed synchronously (not on resolve) so the re-entrant notification never pushes twice.
  const forget = () => { if (m.labelScopeSig === sig) m.labelScopeSig = null; };
  try {
    void Promise.resolve(m.editor.dispatch({ type: INTENT.TEST_LABEL_SCOPE, modelKeys })).catch(forget);
  } catch { forget(); /* an editor failure never breaks the manager */ }
}

/** Every manager announcement goes through here: the monotonic liveSeq lets the renderer re-announce identical text (M2). */
function setLive(m, text) {
  m.live = text;
  m.liveSeq += 1;
}

/** The pure gate/VM input. `recovering` (m.recovery !== null) lets the VM's pending `confirm.enabled` agree with onConfirm, which refuses while recovering. */
function gateState(m) {
  return { fault: m.fault, busy: isBusy(m), recovering: m.recovery !== null, pending: m.pending, editorVm: m.editorVm, activeTestId: m.activeTestId, records: [...m.records.values()] };
}

// ── editor synchronization (spec §26.2a) ────────────────────────────────────────────────────────────────────────

function onEditorNotification(m, vm) {
  if (m.disposed) return;
  m.editorVm = vm;
  try {
    syncFrom(m, vm);
  } catch {                                                       // an unreadable snapshot is never synced (M1)
    beginRecovery(m, 'notification', { schedule: m.activation === null });
  }
  changed(m);
}

/**
 * Steps 1–2 of §26.2a. Expected ids: the committed activeTestId, plus the in-flight activation's target. Anything else
 * is a divergence (M1): sync is suspended and ONE recovery begins. While recovering or faulted nothing is ever synced.
 */
function syncFrom(m, vm) {
  if (m.fault !== null || m.recovery !== null) return;
  const t = vm?.test ?? null;
  const expected = t !== null && (t.testId === m.activeTestId || (m.activation !== null && t.testId === m.activation.targetTestId));
  const record = expected ? m.records.get(t.testId) : undefined;
  if (record === undefined) { beginRecovery(m, 'notification', { schedule: m.activation === null }); return; }
  let dirty = false;
  if (t.draft !== record.draft) { record.draft = t.draft; dirty = true; }   // step 1: draft sync by identity
  if (reduceSummary(record, t.lastRun)) dirty = true;                       // step 2: summary reduction
  if (dirty) recordsChanged(m);
}

/** A sealed run is reduced ONCE (by runId); a Reset keeps lastReducedRunId so that run is never re-reduced. */
function reduceSummary(record, lastRun) {
  if (record === undefined || lastRun === null || lastRun === undefined || typeof lastRun.runId !== 'string') return false;
  if (lastRun.runId === record.lastReducedRunId) return false;
  record.summary = lastRun;
  record.lastReducedRunId = lastRun.runId;
  return true;
}

/**
 * §26.2a second guard: re-read the editor synchronously and sync before the manager retires anything itself. Returns
 * true only when the editor was readable, holds an expected test and no recovery/fault is in effect. An editor that
 * throws on the read is in an unknown state: that is a divergence (M1) — ONE recovery begins (scheduled unless an
 * activation is in flight, which compensates itself) and the caller must stop.
 */
function snapshotOutgoing(m) {
  let vm;
  try {
    vm = m.editor.getViewModel();
    m.editorVm = vm;
    syncFrom(m, vm);
  } catch {
    beginRecovery(m, 'notification', { schedule: m.activation === null });
  }
  return m.recovery === null && m.fault === null;
}

/** A manager-driven editor step (Reset's Clear path): true when it resolved; a throw/rejection starts ONE recovery. */
async function editorStep(m, intent) {
  try {
    await m.editor.dispatch(intent);
    return true;
  } catch {
    beginRecovery(m, 'result', { schedule: m.activation === null });
    return false;
  }
}

/**
 * Dispatches TEST_LOAD and reduces the answer to plain fields. A synchronous throw, a REJECTED dispatch (e.g. a hostile
 * intent getter inside the editor) or an unreadable result object all become `null`; the caller never sees an
 * exception (carry-forward ruling (1)). activate() treats `null` as a divergence (the editor state is unknown).
 */
async function loadInto(m, record, acknowledgeUnsaved) {
  try {
    const r = await m.editor.dispatch({ type: INTENT.TEST_LOAD, testId: record.testId, draft: record.draft, acknowledgeUnsaved: acknowledgeUnsaved === true });
    if (r === null || typeof r !== 'object') return null;
    return { ok: r.ok === true, testId: r.testId, releaseStuck: r.releaseStuck === true, reason: typeof r.reason === 'string' ? r.reason : null };
  } catch {
    return null;
  }
}

/** M1: exactly one recovery token per divergence; repeated signals are coalesced into it. */
function beginRecovery(m, cause, { schedule }) {
  if (m.disposed || m.recovery !== null || m.fault !== null) return;
  m.recoverySeq += 1;
  const token = m.recoverySeq;
  m.recovery = { token, cause, state: 'scheduled' };
  if (schedule) void Promise.resolve().then(() => compensate(m, token)).catch(() => {});
}

/**
 * One compensating load of the COMMITTED activeTestId's snapshotted draft (acknowledgeUnsaved:false, plan decision
 * P-7); success resumes sync, failure is terminal. Never throws: an editor that throws or cannot be read is a failure.
 */
async function compensate(m, token) {
  if (m.disposed || m.recovery === null || m.recovery.token !== token || m.recovery.state !== 'scheduled') return;
  m.recovery = { ...m.recovery, state: 'loading' };
  changed(m);
  const record = m.records.get(m.activeTestId);
  const result = record === undefined ? null : await loadInto(m, record, false);
  if (m.disposed) return;
  let now = null;
  try { now = m.editor.getViewModel(); } catch { now = null; }
  if (now !== null) m.editorVm = now;
  m.recovery = null;
  let restored = false;
  try {
    restored = result?.ok === true && result.testId === m.activeTestId && now?.test?.testId === m.activeTestId;
  } catch { restored = false; }
  if (restored) {
    m.notice = MANAGER_TEXT.restored(record.draft.name);
    try { syncFrom(m, now); } catch { /* the restored load is verified by id; a draft read failure syncs nothing */ }
  } else {
    m.fault = { text: MANAGER_TEXT.FAULT };
    m.pending = null;
    // M2: drop any editor confirmation raised BEFORE the fault (it may be for Run), so RESULTS_CLEAR_CONFIRMED — allowed
    // while faulted — can only confirm a Clear results requested afterwards (RUN_START / SETUP_NEW_TEST are blocked).
    try { void Promise.resolve(m.editor.dispatch({ type: INTENT.CONFIRM_CANCEL })).catch(() => {}); } catch { /* the fault stands */ }
  }
  changed(m);
}

/**
 * §26.2a activation (M1). Commit ONLY when no divergence was seen, the load is {ok} for exactly targetTestId and the
 * editor reports that id. An explicit refusal naming the committed source, while the editor still reports it, is a
 * plain failure. Anything else — including a notification-first divergence detected while the load ran, or an
 * editor that cannot be re-read after the load (it may really have loaded the target) — is compensated ONCE here, after
 * the load settled. `m.activation` stays set until the result is evaluated, so a late same-target notification is never
 * a divergence; it is cleared in `finally` on every path (carry-forward ruling (1)). Never throws.
 */
async function activate(m, targetTestId, acknowledgeUnsaved) {
  if (!snapshotOutgoing(m)) return { outcome: 'diverged' };
  const record = m.records.get(targetTestId);
  if (record === undefined || record.draft?.testId !== record.testId) return { outcome: 'failed', reason: 'unknown-test' };   // manager-side existence check (M1)
  m.activation = { targetTestId };
  let result = null;
  let now = null;
  let readable = true;
  try {
    result = await loadInto(m, record, acknowledgeUnsaved);
    now = m.disposed ? null : m.editor.getViewModel();
  } catch {
    readable = false;                                             // an unreadable editor never commits
  } finally {
    m.activation = null;                                          // never left set, whatever the editor did
  }
  if (m.disposed) return { outcome: 'failed', reason: 'disposed' };
  if (readable) {
    m.editorVm = now;
    let editorId;
    try { editorId = now?.test?.testId; } catch { readable = false; }
    const clean = m.recovery === null && m.fault === null;
    if (readable && clean && result?.ok === true && result.testId === targetTestId && editorId === targetTestId) {
      m.activeTestId = targetTestId;
      try { syncFrom(m, now); } catch { beginRecovery(m, 'result', { schedule: true }); }
      return { outcome: 'committed', releaseStuck: result.releaseStuck === true };
    }
    // Only an EXPLICIT refusal naming the still-held source is a plain failure (the controller's refusal is atomic). A
    // throw/rejection/malformed answer (`null`) is NOT: the editor may have mutated before failing (controller.js
    // onTestLoad clears its confirmation and retires the displayed set before adopting the draft) — compensate.
    if (readable && clean && result?.ok === false && result.testId === m.activeTestId && editorId === m.activeTestId) {
      return { outcome: 'failed', reason: typeof result.reason === 'string' ? result.reason : 'refused' };
    }
  }
  beginRecovery(m, 'result', { schedule: false });                 // no-op when a notification already began it
  await compensate(m, m.recovery?.token);
  return { outcome: 'diverged' };
}

// ── operations (spec §26.2a pending operation) ──────────────────────────────────────────────────────────────────

/** Creates THE single pending operation; executes at once when no confirmation is needed. */
function request(m, kind, { sourceTestId, targetTestId = null, createsSuccessor = false, alwaysPrompt = false }) {
  if (!snapshotOutgoing(m)) { changed(m); return undefined; }   // divergent or unreadable editor: recovery, no operation
  const t = m.editorVm.test;
  const discardsUnsaved = sourceTestId === m.activeTestId && t.heldUnsaved === true;
  m.opSeq += 1;
  m.pending = {
    operationId: `op-${m.opSeq}`, kind, sourceTestId, targetTestId, createsSuccessor, discardsUnsaved,
    expectedEditorVersion: m.editorVm.version,
    observed: { runActive: t.runActive === true, heldUnsaved: t.heldUnsaved === true, testId: t.testId },
    state: alwaysPrompt || discardsUnsaved ? 'awaiting' : 'executing',
  };
  changed(m);
  return m.pending.state === 'executing' ? execute(m, m.pending.operationId) : undefined;
}

async function execute(m, operationId) {
  const p = m.pending;
  if (p === null || p.operationId !== operationId) return;
  p.state = 'executing';
  m.notice = null;
  changed(m);
  try {
    await RUN[p.kind](m, p);
  } finally {
    if (m.pending === p) m.pending = null;
    if (!m.disposed) changed(m);
  }
}

/** activate() never throws by construction; this backstop keeps a record-adding operation from ever leaking one. */
async function activateSafely(m, targetTestId, acknowledgeUnsaved) {
  try {
    return await activate(m, targetTestId, acknowledgeUnsaved);
  } catch {
    return { outcome: 'failed', reason: 'refused' };
  }
}

async function runSwitch(m, p) {
  const r = await activateSafely(m, p.targetTestId, p.discardsUnsaved);
  if (r.outcome === 'committed') { m.view = 'editor'; setLive(m, MANAGER_TEXT.opened(nameOf(m, p.targetTestId))); }
  else if (r.outcome === 'failed') m.notice = MANAGER_TEXT.failed('open', nameOf(m, p.targetTestId), r.reason);
}

async function runCreate(m, p) {
  m.counter += 1;                                                 // never decremented, never reused (§26.4)
  const record = addRecord(m, createDraft({ testId: p.targetTestId, testNumber: m.counter }));
  const name = record.draft.name;
  const r = await activateSafely(m, record.testId, p.discardsUnsaved);
  if (r.outcome === 'committed') { m.view = 'editor'; setLive(m, MANAGER_TEXT.created(name)); return; }
  removeRecord(m, record.testId);                                  // AC-M16: a failed Create leaves no record
  if (r.outcome === 'failed') m.notice = MANAGER_TEXT.failed('create', name, r.reason);
}

async function runDelete(m, p) {
  const victim = m.records.get(p.sourceTestId);
  if (victim === undefined) return;
  const name = victim.draft.name;
  if (p.sourceTestId !== m.activeTestId) {                        // non-active: nothing held, nothing to retire
    removeRecord(m, p.sourceTestId);
    setLive(m, MANAGER_TEXT.deleted(name));
    return;
  }
  let created = null;
  if (p.createsSuccessor) {                                       // deleting the last test = Delete + Create (CTM-5)
    m.counter += 1;
    created = addRecord(m, createDraft({ testId: p.targetTestId, testNumber: m.counter }));
  }
  const r = await activateSafely(m, p.targetTestId, p.discardsUnsaved);
  if (r.outcome === 'committed') {
    removeRecord(m, victim.testId);
    m.view = 'list';
    setLive(m, MANAGER_TEXT.deleted(name));
    return;
  }
  if (created !== null) removeRecord(m, created.testId);
  if (r.outcome === 'failed') m.notice = MANAGER_TEXT.failed('delete', name, r.reason);
}

async function runReset(m, p) {
  const record = m.records.get(p.sourceTestId);
  if (record === undefined) return;
  if (p.sourceTestId === m.activeTestId) {
    // Every editor read/step is guarded: a divergent, throwing or unreadable editor starts ONE recovery (M1) and the
    // summary is kept — nothing is reset on an editor whose state is unknown.
    if (!snapshotOutgoing(m)) return;                             // the seal is reduced before anything is retired
    if (!(await editorStep(m, { type: INTENT.RESULTS_CLEAR }))) return;   // the existing clearResults path (§26.7)
    if (!snapshotOutgoing(m)) return;
    if (m.editorVm.test.pendingConfirm === true) {
      if (p.discardsUnsaved !== true) {                           // unsaved since the request: never discard without consent
        if (!(await editorStep(m, { type: INTENT.CONFIRM_CANCEL }))) return;
        m.notice = MANAGER_TEXT.RECHECKED;
        return;
      }
      if (!(await editorStep(m, { type: INTENT.RESULTS_CLEAR_CONFIRMED }))) return;
    }
  }
  record.summary = null;                                          // lastReducedRunId is kept: never re-reduced
  recordsChanged(m);
  setLive(m, MANAGER_TEXT.reset(record.draft.name));
}

const RUN = { switch: runSwitch, create: runCreate, delete: runDelete, reset: runReset };

// ── intents ─────────────────────────────────────────────────────────────────────────────────────────────────────

function setView(m, view) {
  if (m.view !== view) { m.view = view; changed(m); }
  return undefined;
}

function onOpen(m, intent) {
  const testId = intent.testId;
  if (!actionGate(gateState(m), 'open', testId).enabled) return undefined;
  if (testId === m.activeTestId) return setView(m, 'editor');     // §26.8: changes nothing else
  return request(m, 'switch', { sourceTestId: m.activeTestId, targetTestId: testId });
}

function onCreate(m) {
  if (!actionGate(gateState(m), 'create').enabled) return undefined;
  const targetTestId = mintFresh(m);
  if (targetTestId === null) return refuseNoId(m);
  return request(m, 'create', { sourceTestId: m.activeTestId, targetTestId });
}

function onDuplicate(m, intent) {
  const testId = intent.testId;
  if (!actionGate(gateState(m), 'duplicate', testId).enabled) return undefined;
  if (testId === m.activeTestId && !snapshotOutgoing(m)) { changed(m); return undefined; }   // §26.4: the active test's CURRENT draft (never a divergent one)
  const source = m.records.get(testId)?.draft;
  if (source === undefined) return undefined;
  const newId = mintFresh(m);
  if (newId === null) return refuseNoId(m);
  const name = duplicateName(source.name, [...m.records.values()].map((r) => r.draft.name));
  addRecord(m, duplicateDraft(source, { testId: newId, name }));
  setLive(m, MANAGER_TEXT.duplicated(source.name, name));
  changed(m);
  return undefined;
}

function onDelete(m, intent) {
  const testId = intent.testId;
  if (!actionGate(gateState(m), 'delete', testId).enabled) return undefined;
  if (testId !== m.activeTestId) return request(m, 'delete', { sourceTestId: testId, alwaysPrompt: true });
  const order = [...m.records.keys()];
  const i = order.indexOf(testId);
  const successor = order[i + 1] ?? order[i - 1] ?? null;          // next in list order, else the previous
  const targetTestId = successor ?? mintFresh(m);
  if (targetTestId === null) return refuseNoId(m);
  return request(m, 'delete', { sourceTestId: testId, targetTestId, createsSuccessor: successor === null, alwaysPrompt: true });
}

function onReset(m, intent) {
  const testId = intent.testId;
  if (!actionGate(gateState(m), 'reset', testId).enabled) return undefined;
  return request(m, 'reset', { sourceTestId: testId });
}

function onConfirm(m, intent) {
  const p = m.pending;
  if (p === null || p.operationId !== intent.operationId || p.state !== 'awaiting' || m.fault !== null) return undefined;   // stale
  if (m.recovery !== null) return undefined;                      // M1: never executed while recovering; the prompt stays
  let vm;
  try {
    vm = m.editor.getViewModel();
    m.editorVm = vm;
  } catch {                                                       // consent cannot be re-checked: drop it, recover (M1)
    m.pending = null;
    beginRecovery(m, 'confirm', { schedule: true });
    changed(m);
    return undefined;
  }
  const t = vm.test;
  if (t.pendingConfirm === true) { changed(m); return undefined; }  // disabled while the editor asks (§26.2a)
  const drifted = vm.version !== p.expectedEditorVersion
    && (t.runActive !== p.observed.runActive || t.heldUnsaved !== p.observed.heldUnsaved || t.testId !== p.observed.testId);
  if (drifted) return reevaluate(m, p);
  return execute(m, p.operationId);
}

function onCancel(m, intent) {
  const p = m.pending;
  if (p === null || p.operationId !== intent.operationId || p.state !== 'awaiting') return undefined;
  m.pending = null;
  changed(m);
  return undefined;
}

const ACTION_OF = Object.freeze({ switch: 'open', create: 'create', delete: 'delete', reset: 'reset' });
const REDO = {
  switch: (m, p) => onOpen(m, { testId: p.targetTestId }),
  create: (m) => onCreate(m),
  delete: (m, p) => onDelete(m, { testId: p.sourceTestId }),
  reset: (m, p) => onReset(m, { testId: p.sourceTestId }),
};

/** A confirm whose consent is outdated: refuse with the gate reason, or re-request (new operationId, maybe a new prompt). */
function reevaluate(m, p) {
  m.pending = null;
  if (m.editorVm.test.testId !== m.activeTestId) {
    m.notice = MANAGER_TEXT.REFUSED_CHANGED;
    beginRecovery(m, 'confirm', { schedule: true });
    changed(m);
    return undefined;
  }
  const g = actionGate(gateState(m), ACTION_OF[p.kind], p.kind === 'switch' ? p.targetTestId : p.sourceTestId);
  if (!g.enabled) { m.notice = g.reason; changed(m); return undefined; }
  const out = REDO[p.kind](m, p);
  m.notice = m.pending?.state === 'awaiting' ? MANAGER_TEXT.RECHECKED : null;
  changed(m);
  return out;
}

const HANDLERS = {
  [MANAGER_INTENT.VIEW_LIST]: (m) => setView(m, 'list'),
  [MANAGER_INTENT.VIEW_EDITOR]: (m) => setView(m, 'editor'),
  [MANAGER_INTENT.OPEN]: onOpen,
  [MANAGER_INTENT.CREATE]: onCreate,
  [MANAGER_INTENT.DUPLICATE]: onDuplicate,
  [MANAGER_INTENT.DELETE]: onDelete,
  [MANAGER_INTENT.RESET]: onReset,
  [MANAGER_INTENT.CONFIRM]: onConfirm,
  [MANAGER_INTENT.CANCEL]: onCancel,
};

/**
 * A manager-handled intent always resolves `undefined`: a synchronous throw or a rejection from the manager's own
 * path (an editor failure the guards did not already turn into recovery) never reaches the UI caller.
 */
function settled(run) {
  try {
    return Promise.resolve(run()).then(() => undefined, () => undefined);
  } catch {
    return Promise.resolve(undefined);
  }
}

function dispatch(m, intent) {
  if (intent === null || typeof intent !== 'object' || typeof intent.type !== 'string') {
    throw new TypeError('unknown intent: an intent must be an object with a string `type`');
  }
  if (m.disposed) return Promise.resolve(undefined);
  if (MANAGER_TYPES.has(intent.type)) {
    const handler = HANDLERS[intent.type];
    return settled(() => (handler === undefined ? undefined : handler(m, intent)));
  }
  if (intent.type === INTENT.TEST_LOAD || intent.type === INTENT.TEST_LABEL_SCOPE) return Promise.resolve(undefined);   // manager-only seams
  if (m.fault !== null && FAULT_POLICY[intent.type] !== ALLOW) return Promise.resolve(undefined);   // §26.2a fault; M2 allow-list, fail closed
  if (intent.type === INTENT.SETUP_NEW_TEST) return settled(() => onCreate(m));   // §26.8
  return m.editor.dispatch(intent);
}

// ── ViewModel + dispose ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Names, readiness and "models changed" for every record. Recomputed only when a §26.6 trigger fired (catalog change /
 * model left → catalogEpoch) or a record changed (recordsVersion) — never per run-progress notification (Codex plan
 * review Q1). Cost with many records × models remains the CTM-8 calibration gate.
 */
function derivedOf(m) {
  const d = m.derived;
  if (d !== null && d.catalogEpoch === m.catalogEpoch && d.recordsVersion === m.recordsVersion) return d;
  let listed = [];
  try { listed = m.catalog.list() ?? []; } catch { listed = []; }
  if (!Array.isArray(listed)) listed = [];
  // H1: a departed key is absent at once — its entry is not "in the scene" and its binding reads as null.
  const entries = listed.filter((e) => !m.departed.has(e?.modelKey));
  const bindingFor = (k) => (m.departed.has(k) ? null : m.bindingFor(k));
  const inCatalog = new Set(entries.map((e) => e?.modelKey).filter((k) => typeof k === 'string'));
  const records = [...m.records.values()];
  // CTM-2 / seam (e): names are disambiguated over catalog.list() keys ∪ the referenced scope — exactly the key set the
  // editor's resolver uses once pushLabelScope delivered the same scope (displayed-run keys are a subset of it).
  const keys = new Set([...listed.map((e) => e?.modelKey).filter((k) => typeof k === 'string'), ...labelScopeOf(m)]);
  let names = new Map();
  try { names = disambiguatedNames(m.catalog, [...keys].sort()); } catch { names = new Map(); }
  // Carry-forward ruling (2): readinessOf's modelName is unguarded, so this lookup must never throw.
  const baseName = (k) => {
    try { return names.get(k) ?? fallbackModelName(k); } catch { return fallbackModelName(k); }
  };
  m.derived = {
    catalogEpoch: m.catalogEpoch, recordsVersion: m.recordsVersion,
    scopeName: (k) => (inCatalog.has(k) ? baseName(k) : `${baseName(k)} (not loaded)`),
    readiness: new Map(records.map((r) => [r.testId, readinessOf({ draft: r.draft, entries, bindingFor, modelName: baseName })])),
    modelsChanged: new Map(records.map((r) => [r.testId, modelsChangedOf({ summary: r.summary, bindingFor, catalog: m.catalog })])),
  };
  return m.derived;
}

function viewModelOf(m) {
  if (m.vmCache !== null) return m.vmCache;
  const { scopeName, readiness, modelsChanged } = derivedOf(m);
  const manager = buildManagerViewModel({ ...gateState(m), view: m.view, notice: m.notice, live: m.live, liveSeq: m.liveSeq, scopeName, readiness, modelsChanged });
  // §26.9: while faulted every user-facing control FAULT_POLICY blocks is {enabled:false, reason}; otherwise the
  // editor's own ViewModel object, unchanged (the overlay is a copy, never applied to the editor).
  const editorVm = m.fault === null ? m.editorVm : lockedEditorVm(m.editorVm, m.fault.text, FAULT_POLICY);
  m.vmCache = Object.freeze({ manager, editor: editorVm });
  return m.vmCache;
}

/** §26.8: drop records and the manager's OWN listeners; the editor's dispose() is the composition root's next step. */
function dispose(m) {
  if (m.disposed) return;
  m.disposed = true;
  runDisposers(m);
  m.records.clear();
  m.departed.clear();
  m.pending = null;
  m.activation = null;
  m.recovery = null;
  m.subscribers.clear();
  m.derived = null;
  m.vmCache = null;
}
