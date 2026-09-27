// test/clashpanel/support/fakeEngine.mjs
// EnginePort double with the REAL RunHandle semantics (spec 7.1, catalog 1): sync startRun, frozen-shape members,
// state/unit/persistence events only, persistence may arrive after terminal, `done`/`persisted` never reject,
// `resultSet` may be null. Reading ANY forbidden member (register/unregister/keyOf/notifyPlacementChanged/
// invalidateModelPlacement/dispose/...) throws AND is recorded in `forbiddenAccess` (AC-P20).
import {
  DerivationAbortedError, ReadAbortedError, ResultNotResidentError, ResultSetRetainedError, UnsavedResultSetError,
} from '../../../clashtest/index.js';

export const FORBIDDEN_ENGINE_MEMBERS = Object.freeze([
  'invalidateModelPlacement', 'dispose', 'retryPersist', 'rerun', 'getResultSet', 'discardRun', 'saveTest',
  'getPairStatus', 'getElementStatus',
]);
export const FORBIDDEN_REGISTRY_MEMBERS = Object.freeze(['register', 'unregister', 'keyOf', 'notifyPlacementChanged']);

export function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
/** A shared, ordered call journal: pass the same array to createFakeEngine and createFakeBridge to assert ordering. */
export const createJournal = () => [];

const persistedFrom = (p) => {
  if (p.state === 'saved') return { state: 'saved' };
  if (p.state === 'failed') return { state: 'failed', error: p.error ?? new Error('persist failed') };
  if (p.state === 'skipped') return { state: 'skipped', reason: p.reason ?? 'no-store' };
  return null; // 'pending': settled later by finishPersisted
};

export function createFakeHandle({ runId, journal = null, autoFinishOnCancel = false, onFinish = null, onPersisted = null } = {}) {
  let snapshot = Object.freeze({
    runId, status: 'queued', phase: 'queued', seq: 0, unitsTotal: 0, unitsEvaluated: 0, unitsFailedOrSkipped: 0,
    pairSpaceTotal: 0, pairSpaceEvaluated: 0, pairSpaceProcessed: 0, fractionEvaluated: 0, fractionProcessed: null,
    resultsFound: 0, caveatCount: 0, caveatUnclassified: 0, currentUnitId: null, elapsedMs: 0,
  });
  let seq = 0;
  let terminal = false;
  const listeners = new Set();
  const done = createDeferred();
  const persisted = createDeferred();
  const cancelCalls = [];
  const deliver = (event) => { for (const l of [...listeners]) { try { l(event); } catch { /* the real handle swallows listener errors */ } } };
  const step = (fields) => {
    seq += 1;
    snapshot = Object.freeze({ ...snapshot, seq, status: fields.status ?? snapshot.status, phase: fields.phase ?? snapshot.phase });
    return seq;
  };
  const handle = {
    runId,
    getSnapshot: () => snapshot,
    subscribe(fn) {
      if (typeof fn !== 'function') throw new TypeError('subscribe: listener must be a function');
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    cancel(reason) {
      cancelCalls.push(reason);
      if (journal) journal.push('handle.cancel');
      if (!terminal && (snapshot.status === 'running' || snapshot.status === 'planning')) handle.emitState({ status: 'cancelling', phase: snapshot.phase });
      if (autoFinishOnCancel && !terminal) handle.finish({ status: 'cancelled' });
      return done.promise;
    },
    done: done.promise,
    persisted: persisted.promise,
    // ---- test controls (not part of the real handle) ----
    cancelCalls,
    listenerCount: () => listeners.size,
    setSnapshot(partial) { snapshot = Object.freeze({ ...snapshot, ...partial }); return snapshot; },
    emitState(fields = {}) {
      const s = step(fields);
      const event = {
        type: 'state', seq: s, status: snapshot.status, phase: snapshot.phase,
        ...(fields.terminal ? { terminal: true } : {}), ...(fields.persistence ? { persistence: fields.persistence } : {}),
        ...(fields.cause !== undefined ? { cause: fields.cause } : {}),
      };
      deliver(event);
      return event;
    },
    emitUnit(fields = {}) {
      const s = step(fields);
      const event = { type: 'unit', seq: s, status: snapshot.status, phase: snapshot.phase };
      deliver(event);
      return event;
    },
    emitPersistence(fields = {}) {
      seq += 1;
      const event = { type: 'persistence', state: 'saved', timedOut: false, attempt: 1, ...fields, seq };
      deliver(event);
      return event;
    },
    /** Terminal transition: terminal state event, then `done` resolves once. `resultSet` defaults to null (seal failed). */
    finish({ status = 'completed', resultSet = null, persistence = { state: 'saved', timedOut: false, attempt: 1 } } = {}) {
      if (terminal) return done.promise;
      terminal = true;
      handle.emitState({ status, phase: 'terminal', terminal: true, persistence });
      if (onFinish) onFinish(runId, { status, resultSet, persistence });
      done.resolve({ runId, status, resultSet, persistence });
      const p = persistedFrom(persistence);
      if (p !== null) persisted.resolve(p);
      return done.promise;
    },
    /** Settle `persisted` (independent of `done`): for a `pending` run that later saves or fails. */
    finishPersisted(outcome) {
      handle.emitPersistence({ state: outcome.state, ...(outcome.error ? { error: outcome.error } : {}), ...(outcome.reason ? { reason: outcome.reason } : {}) });
      if (onPersisted) onPersisted(runId, outcome);
      persisted.resolve(outcome);
    },
  };
  return handle;
}

function createAsyncSpy({ abortError, defaultResult, onStart, onSettle }) {
  const spy = { calls: [], mode: 'auto', result: defaultResult, scripted: [] };
  spy.fn = (...args) => {
    const last = args[args.length - 1];
    const signal = last !== null && typeof last === 'object' && !Array.isArray(last) ? (last.signal ?? null) : null;
    const d = createDeferred();
    const call = { args, signal, settled: false, promise: d.promise };
    const settle = (kind, value) => {
      if (call.settled) return;
      call.settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      if (onSettle) onSettle(call);
      if (kind === 'resolve') d.resolve(value); else d.reject(value);
    };
    const onAbort = () => settle('reject', abortError());
    call.resolve = (v) => settle('resolve', v);
    call.reject = (e) => settle('reject', e);
    spy.calls.push(call);
    if (onStart) onStart(call);
    if (signal) {
      if (signal.aborted) { settle('reject', abortError()); return d.promise; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    if (spy.scripted.length > 0) { const err = spy.scripted.shift(); queueMicrotask(() => settle('reject', err)); return d.promise; }
    if (spy.mode === 'auto') {
      queueMicrotask(() => {
        try { settle('resolve', typeof spy.result === 'function' ? spy.result(...args) : spy.result); } catch (e) { settle('reject', e); }
      });
    }
    return d.promise;
  };
  spy.hold = () => { spy.mode = 'manual'; return spy; };
  spy.auto = () => { spy.mode = 'auto'; return spy; };
  spy.setResult = (v) => { spy.result = v; return spy; };
  spy.rejectNext = (err, times = 1) => { for (let i = 0; i < times; i += 1) spy.scripted.push(err); return spy; };
  spy.pending = () => spy.calls.filter((c) => !c.settled);
  return spy;
}

const DEFAULT_SUMMARY = { totalResults: 0, resultsCaveated: 0, unitOutcomes: [], planningGaps: [], gapWeight: 0 };

/**
 * @param {{ bindings?: Array<{modelKey:string, model?:object, modelVersion?:string, bindingGeneration?:number, placementGeneration?:number}>,
 *           journal?: string[]|null, runIdPrefix?: string, strict?: boolean }} [options]
 *   strict (default true): releaseResultSet enforces the real residency contract (ResultSetRetainedError while leased,
 *   UnsavedResultSetError for a non-saved set unless {acknowledgeUnsaved:true}); non-resident ids are a no-op.
 */
export function createFakeEngine({ bindings = [], journal = null, runIdPrefix = 'run-', strict = true } = {}) {
  const bindingMap = new Map();
  const calls = { validateTest: [], startRun: [], retainResultSet: [], releaseResultSet: [], getPersistenceState: [], bindingFor: [] };
  const order = [];
  const handles = [];
  const leases = [];
  const resident = new Set();
  const persistenceStates = new Map();
  const forbiddenAccess = [];
  const startRunErrors = [];
  const retainErrors = [];
  const releaseErrors = [];
  const leaseReleaseErrors = [];   // Task 9: a throwing lease.release() (failure injection)
  const stats = { inFlight: 0, maxInFlight: 0, total: 0 };
  let validateSource = { issues: [], issuesTruncated: false };
  let startRunOverride = null;

  const note = (name) => { order.push(name); if (journal) journal.push(`engine.${name}`); };
  const bindingOf = (b) => {
    const model = b.model ?? { fakeModel: b.modelKey };
    return Object.freeze({
      modelKey: b.modelKey, model, modelVersion: b.modelVersion ?? 'v1', lease: Object.freeze({ model, epoch: 1 }),
      bindingGeneration: b.bindingGeneration ?? 1, placementGeneration: b.placementGeneration ?? 0,
    });
  };
  for (const b of bindings) bindingMap.set(b.modelKey, bindingOf(b));

  const trackDerivation = {
    onStart: (call) => { note(call.kind); stats.inFlight += 1; stats.total += 1; stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight); },
    onSettle: () => { stats.inFlight -= 1; },
  };
  const derivationSpy = (kind, defaultResult) => {
    const spy = createAsyncSpy({
      abortError: () => new DerivationAbortedError(), defaultResult,
      onStart: (call) => { call.kind = kind; trackDerivation.onStart(call); }, onSettle: trackDerivation.onSettle,
    });
    return spy;
  };
  const readSpy = (kind, defaultResult) => createAsyncSpy({
    abortError: () => new ReadAbortedError(), defaultResult, onStart: () => note(kind),
  });
  const spies = {
    getFreshness: readSpy('getFreshness', { state: 'current', reasons: [] }),
    assessNoClashClaim: readSpy('assessNoClashClaim', { allowed: false, unqualified: false, qualifiers: [], exclusions: [], proofMethod: 'fake' }),
    summarize: derivationSpy('summarize', DEFAULT_SUMMARY),
    groupBy: derivationSpy('groupBy', { facets: [], unavailable: [], total: 0, memberships: 0, groups: [] }),
    filter: derivationSpy('filter', { matches: [], count: 0, total: 0, unavailable: [] }),
  };

  const makeResident = (runId, persistence = { state: 'saved', timedOut: false, attempt: 1 }) => {
    resident.add(runId);
    persistenceStates.set(runId, persistence);
  };
  const registry = {
    bindingFor(key) { note('bindingFor'); calls.bindingFor.push(key); return bindingMap.get(key) ?? null; },
  };
  const engine = {
    // ---- the EnginePort surface ----
    validateTest(def) {
      note('validateTest');
      calls.validateTest.push(def);
      return typeof validateSource === 'function' ? validateSource(def) : validateSource;
    },
    startRun(def, opts) {
      note('startRun');
      calls.startRun.push({ def, opts });
      if (startRunErrors.length > 0) throw startRunErrors.shift();
      if (startRunOverride) return startRunOverride(def, opts);
      const handle = createFakeHandle({
        runId: `${runIdPrefix}${handles.length + 1}`, journal,
        onFinish: (runId, { resultSet, persistence }) => { if (resultSet !== null) makeResident(runId, persistence); },
        onPersisted: (runId, outcome) => {
          persistenceStates.set(runId, outcome.state === 'saved' ? { state: 'saved', timedOut: false, attempt: 1 } : { state: outcome.state, timedOut: false, attempt: 1, ...(outcome.error ? { error: outcome.error } : {}), ...(outcome.reason ? { reason: outcome.reason } : {}) });
        },
      });
      handle.definition = def;
      handles.push(handle);
      return handle;
    },
    retainResultSet(runId) {
      note('retainResultSet');
      calls.retainResultSet.push(runId);
      if (retainErrors.length > 0) throw retainErrors.shift();
      if (!resident.has(runId)) throw new ResultNotResidentError({ runId });
      const state = persistenceStates.get(runId);
      if (!state || state.state !== 'saved') throw new UnsavedResultSetError({ runId });
      const record = { runId, released: false, releaseCalls: 0 };
      leases.push(record);
      return Object.freeze({
        release() {
          record.releaseCalls += 1;
          if (journal) journal.push('lease.release');
          if (leaseReleaseErrors.length > 0) throw leaseReleaseErrors.shift();
          record.released = true;
        },
      });
    },
    releaseResultSet(runId, opts) {
      note('releaseResultSet');
      calls.releaseResultSet.push({ runId, opts });
      if (releaseErrors.length > 0) throw releaseErrors.shift();
      if (!resident.has(runId)) return undefined;
      if (strict) {
        if (leases.some((l) => l.runId === runId && !l.released)) throw new ResultSetRetainedError({ runId });
        const state = persistenceStates.get(runId);
        if ((!state || state.state !== 'saved') && opts?.acknowledgeUnsaved !== true) throw new UnsavedResultSetError({ runId });
      }
      resident.delete(runId);
      return undefined;
    },
    getPersistenceState(runId) { note('getPersistenceState'); calls.getPersistenceState.push(runId); return persistenceStates.get(runId) ?? null; },
    getFreshness: spies.getFreshness.fn,
    assessNoClashClaim: spies.assessNoClashClaim.fn,
    derivations: { summarize: spies.summarize.fn, groupBy: spies.groupBy.fn, filter: spies.filter.fn },
    registry,
    // ---- test controls ----
    calls, order, handles, leases, forbiddenAccess, spies,
    get lastHandle() { return handles[handles.length - 1] ?? null; },
    derivationStats: () => ({ ...stats }),
    residentRunIds: () => [...resident],
    makeResident,
    setBinding(b) { bindingMap.set(b.modelKey, bindingOf(b)); },
    removeBinding(key) { bindingMap.delete(key); },
    setValidate(resultOrFn) { validateSource = resultOrFn; },
    setStartRun(fn) { startRunOverride = fn; },
    failNextStartRun(err, times = 1) { for (let i = 0; i < times; i += 1) startRunErrors.push(err); },
    failNextRetain(err) { retainErrors.push(err); },
    failNextRelease(err) { releaseErrors.push(err); },
    failNextLeaseRelease(err) { leaseReleaseErrors.push(err); },
    liveLeaseCount: () => leases.filter((l) => !l.released).length,
    setPersistenceState(runId, state) { persistenceStates.set(runId, state); },
  };
  const forbid = (target, name, label) => Object.defineProperty(target, name, {
    enumerable: true,
    get() { forbiddenAccess.push(label); throw new Error(`AC-P20: ${label} must never be touched by the Panel`); },
  });
  for (const name of FORBIDDEN_ENGINE_MEMBERS) forbid(engine, name, `engine.${name}`);
  for (const name of FORBIDDEN_REGISTRY_MEMBERS) forbid(registry, name, `registry.${name}`);
  return engine;
}
