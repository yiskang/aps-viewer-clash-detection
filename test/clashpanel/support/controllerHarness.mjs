// test/clashpanel/support/controllerHarness.mjs
// Controller-test doubles owned by Tasks 16–21 (created in Task 16; later tasks only ADD exports). They pin the
// EXACT engine-port behaviour the controller tests need — manual RunHandles, a residency ledger mirroring
// clashtest/results/residency.js (one-shot lease; retain only when `saved`; release refuses while leased and for
// unsaved sets without `acknowledgeUnsaved`), controllable async reads/derivations with AbortSignal support and
// the engine's 2-in-flight DerivationBusyError rule — so the controller tests do not depend on unspecified
// details of Task 3's generic fakeEngine. Real Core error classes come from the public barrel (by name, spec §13
// rule 4). No timers, no wall clock: everything settles through the fake scheduler + setImmediate (settle.mjs).
import {
  UnsavedResultSetError, ResultSetRetainedError, ResultNotResidentError, DerivationBusyError,
  DerivationAbortedError, ReadAbortedError, ResultCapacityError,
} from '../../../clashtest/index.js';
import { createFakeScheduler } from './fakeScheduler.mjs';
import { createFakeCatalog } from './fakeCatalog.mjs';
import { settle } from './settle.mjs';
import { createPanelController } from '../../../clashpanel/core/controller.js';
import { INTENT } from '../../../clashpanel/core/intents.js';

const deepFreeze = (value) => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
};

// ---- synthetic sealed sets ------------------------------------------------------------------------------------

const CAVEATED = new WeakMap();                        // set -> Set<resultId> the double's `caveated` facet answers

/**
 * A hand-built, deep-frozen ResultSet with the real top-level/outcome/provenance/ledger/diagnostics shape
 * (field names copied from a real sealed set). Result specs: `{ a:[modelKey,dbId], b:[modelKey,dbId],
 * point?:[x,y,z]|null, distance?, flags?, caveated? }`. Result ids are `r<i>` unless `id` is given.
 */
export function makeSet({
  runId = 'run-x', results = [], mode = 'volume-overlap', clearance = null, status = 'completed',
  coverage = 'full', integrity = 'clean', freshness = 'current', reasons = [], models,
  ledger = {}, testId = 'T-1', diagnosticsTruncated = false,
} = {}) {
  const provenanceModels = models ?? [
    { modelKey: 'mA', modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 0 },
    { modelKey: 'mB', modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 0 },
  ];
  const caveated = new Set();
  const records = results.map((spec, i) => {
    const resultId = spec.id ?? `r${i}`;
    if (spec.caveated === true) caveated.add(resultId);
    const first = { modelKey: spec.a[0], dbId: spec.a[1] };
    const second = { modelKey: spec.b[0], dbId: spec.b[1] };
    let evidence;
    const flags = { ...(spec.flags ?? {}) };
    if (mode === 'clearance') {
      const d = spec.distance ?? 0.01;
      evidence = { distance: d, clearance, closestPoints: { first: [0, 0, 0], second: [d, 0, 0] } };
    } else {
      const point = spec.point === undefined ? [i, 0, 0] : spec.point;
      evidence = { witness: point === null ? null : { kind: 'surface-crossing', point } };
      if (point === null) flags.witnessUnavailable = true;
    }
    return { resultId, pair: { first, second }, mode, evaluatedAs: { source: first, target: second }, evidence, flags, unitId: '1.0' };
  });
  const set = {
    schemaVersion: 1,
    runId,
    testRef: { testId, revision: 1, semanticDigest: 'sha256:0' },
    definition: {
      schemaVersion: 1, testId, revision: 1, name: 'Clash test 1',
      selectionA: { entries: [{ kind: 'model', modelKey: provenanceModels[0]?.modelKey ?? 'mA' }] },
      selectionB: { entries: [{ kind: 'model', modelKey: provenanceModels[1]?.modelKey ?? provenanceModels[0]?.modelKey ?? 'mB' }] },
      mode, ...(mode === 'clearance' ? { clearance } : {}),
    },
    derivedFromRunId: null,
    outcome: { status, coverage, integrity, freshness, environmentSensitive: false, environmentSensitiveCauses: [], reasons },
    provenance: {
      registrySessionId: 'regsess-test', libraryVersion: null, broadPhase: 'tlas',
      scopeProof: { method: 'bracketed-digest', digestVersion: 1 }, hierarchyInternalAcceptance: null,
      libraryExclusions: [], placementVerified: false, startedAt: '2026-09-26T00:00:00.000Z', finishedAt: '2026-09-26T00:00:01.000Z',
      determinismClass: 'deterministic', runOptions: { maxResultsPerRun: 100000, persist: true },
      models: provenanceModels.map((m) => ({ ...m, scopeKinds: ['model'], elementCount: 999999, scopeDigests: {} })),
      admissionBaseline: [],
    },
    ledger: {
      planExists: true, pairSpaceTotal: Math.max(1, records.length), emptyOperand: false, units: [], rootOwners: [],
      unresolvedSelections: [], unreachablePopulation: [], hierarchyInternal: [], planningGaps: [], exclusions: [],
      warnings: [], budgetExhausted: false, firstRefusalUnitId: null, ...ledger,
    },
    results: records,
    diagnostics: { diagnostics: [], truncated: diagnosticsTruncated, total: 0, completenessAffectingCount: 0, unclassifiedOccurrences: 0, completenessAffectingUpperBound: 0, countsByReason: [], omittedReasonOccurrences: 0, geometryReadinessOccurrences: 0 },
    statistics: { libraryMsTotal: 0, maxUnitMs: 0 },
    digests: { digestVersion: 1, pairSetDigest: 'sha256:0', ledgerDigest: 'sha256:0' },
    sealed: true,
  };
  deepFreeze(set);
  CAVEATED.set(set, caveated);
  return set;
}

/** `n` Hard results mA:(1000+i) ↔ mB:(2000+(i % 97)); every 10th has no witness, every 7th is caveated. */
export function hardResults(n) {
  return Array.from({ length: n }, (_, i) => ({
    a: ['mA', 1000 + i], b: ['mB', 2000 + (i % 97)], point: i % 10 === 9 ? null : [i, 0, 0], caveated: i % 7 === 3,
  }));
}

// ---- engine double ---------------------------------------------------------------------------------------------

function controllable(compute, makeAbortError, state) {
  const ctl = { calls: 0, successes: 0, manual: false, pending: [], failNext: [], args: [] };
  const fn = (...args) => {
    ctl.calls += 1;
    ctl.args.push(args);
    const last = args[args.length - 1];
    const signal = last !== null && typeof last === 'object' && !Array.isArray(last) && !('results' in last) ? last.signal : undefined;
    if (state && state.inFlight >= 2) return Promise.reject(new DerivationBusyError({ limit: 2 }));
    if (state) state.inFlight += 1;
    return new Promise((resolve, reject) => {
      const entry = { args, signal, settled: false };
      const finish = () => { entry.settled = true; if (state) state.inFlight -= 1; };
      entry.resolve = (value) => {
        if (entry.settled) return;
        let v;
        try { v = value === undefined ? compute(...args) : value; } catch (e) { finish(); reject(e); return; }
        finish(); ctl.successes += 1; resolve(v);
      };
      entry.reject = (error) => { if (entry.settled) return; finish(); reject(error); };
      if (signal) {
        if (signal.aborted) { entry.reject(makeAbortError()); return; }
        signal.addEventListener('abort', () => entry.reject(makeAbortError()), { once: true });
      }
      if (ctl.failNext.length > 0) { entry.reject(ctl.failNext.shift()); return; }
      if (ctl.manual) ctl.pending.push(entry);
      else queueMicrotask(() => entry.resolve());
    });
  };
  ctl.resolveNext = (value) => { const e = ctl.pending.shift(); e.resolve(value); };
  ctl.rejectNext = (error) => { const e = ctl.pending.shift(); e.reject(error); };
  ctl.resolveAll = (value) => { while (ctl.pending.length > 0) ctl.resolveNext(value); };
  return { fn, ctl };
}

function elementGroups(set) {
  const groups = new Map();
  const add = (ref, resultId) => {
    const groupId = JSON.stringify(['element', {}, { dbId: ref.dbId, modelKey: ref.modelKey }]);
    let g = groups.get(groupId);
    if (g === undefined) { g = { groupId, path: [groupId], facetId: 'element', params: {}, value: { modelKey: ref.modelKey, dbId: ref.dbId }, count: 0, members: [] }; groups.set(groupId, g); }
    if (g.members[g.members.length - 1] !== resultId) { g.members.push(resultId); g.count += 1; }
  };
  for (const r of set.results) { add(r.pair.first, r.resultId); add(r.pair.second, r.resultId); }
  const list = [...groups.values()].sort((x, y) => (x.value.modelKey < y.value.modelKey ? -1 : x.value.modelKey > y.value.modelKey ? 1 : x.value.dbId - y.value.dbId));
  return { facets: [{ facetId: 'element', params: {}, multiValued: true }], unavailable: [], total: set.results.length, memberships: list.reduce((n, g) => n + g.count, 0), groups: list };
}

/** Mirrors Core's single-valued `pairModels` facet: value [first.modelKey, second.modelKey] (Core's PairId already
 *  orders first/second for the Panel's unordered modes), groupId = canonical JSON of ['pairModels', {}, value],
 *  groups in compareFacetValues order (modelKey strings, lexicographic), members in canonical result order. */
function pairModelGroups(set) {
  const groups = new Map();
  for (const r of set.results) {
    const value = [r.pair.first.modelKey, r.pair.second.modelKey];
    const groupId = JSON.stringify(['pairModels', {}, value]);
    let g = groups.get(groupId);
    if (g === undefined) { g = { groupId, path: [groupId], facetId: 'pairModels', params: {}, value, count: 0, members: [] }; groups.set(groupId, g); }
    g.members.push(r.resultId); g.count += 1;
  }
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  const list = [...groups.values()].sort((x, y) => cmp(x.value[0], y.value[0]) || cmp(x.value[1], y.value[1]));
  return { facets: [{ facetId: 'pairModels', params: {}, multiValued: false }], unavailable: [], total: set.results.length, memberships: set.results.length, groups: list };
}

class ScriptedHandle {
  constructor(engine, runId) {
    this.engine = engine;
    this.runId = runId;
    this.listeners = new Set();
    this.cancelReasons = [];
    this.snapshot = { runId, status: 'queued', phase: 'queued', seq: 0, unitsTotal: 0, unitsEvaluated: 0, unitsFailedOrSkipped: 0, pairSpaceTotal: 0, pairSpaceEvaluated: 0, pairSpaceProcessed: 0, fractionEvaluated: null, fractionProcessed: null, resultsFound: 0, caveatCount: 0, caveatUnclassified: 0, currentUnitId: null, elapsedMs: 0 };
    this.done = new Promise((resolve) => { this.resolveDone = resolve; });
    this.persisted = new Promise((resolve) => { this.resolvePersistedPromise = resolve; });
    this.terminal = false;
    const self = this;
    // The frozen public face the controller receives (the RunHandle shape of clashtest/run/Run.js).
    this.face = Object.freeze({
      runId,
      getSnapshot: () => ({ ...self.snapshot }),
      subscribe(fn) {
        if (typeof fn !== 'function') throw new TypeError('listener must be a function');
        self.listeners.add(fn);
        return () => { self.listeners.delete(fn); };
      },
      cancel(reason) {
        self.cancelReasons.push(reason);
        if (!self.terminal && self.snapshot.status === 'running') self.emitState({ status: 'cancelling', phase: 'executing' });
        return self.done;
      },
      done: this.done,
      persisted: this.persisted,
    });
  }

  emitState({ status, phase, terminal, persistence }) {
    this.snapshot.seq += 1;
    this.snapshot.status = status;
    this.snapshot.phase = phase;
    const event = { type: 'state', seq: this.snapshot.seq, status, phase, ...(terminal ? { terminal: true, persistence } : {}) };
    for (const fn of [...this.listeners]) { try { fn(event); } catch { /* Core swallows listener errors */ } }
  }

  emitUnit(partial = {}) {
    this.snapshot = { ...this.snapshot, ...partial, status: 'running', phase: 'executing', seq: this.snapshot.seq + 1 };
    const event = { type: 'unit', seq: this.snapshot.seq, status: 'running', phase: 'executing' };
    for (const fn of [...this.listeners]) { try { fn(event); } catch { /* swallowed */ } }
  }

  /** Seals the run: resultSet becomes resident with `persistence.state`, then done resolves. */
  finish({ status = 'completed', resultSet = null, persistence = { state: 'saved', timedOut: false, attempt: 1 } } = {}) {
    this.terminal = true;
    if (resultSet !== null) this.engine.resident.set(this.runId, { set: resultSet, state: persistence.state, leases: 0 });
    this.emitState({ status, phase: 'finalizing' });
    this.emitState({ status, phase: 'terminal', terminal: true, persistence });
    this.resolveDone({ runId: this.runId, status, resultSet, persistence });
    if (persistence.state !== 'pending') this.resolvePersisted(persistence.state === 'failed' ? { state: 'failed', error: new Error('store failed') } : { state: persistence.state, ...(persistence.reason ? { reason: persistence.reason } : {}) });
  }

  /** pending → saved|failed after `done` (persistTimeoutMs elapsed first). */
  resolvePersisted(outcome) {
    const entry = this.engine.resident.get(this.runId);
    if (entry !== undefined) entry.state = outcome.state;
    this.resolvePersistedPromise(outcome);
  }
}

const FORBIDDEN = ['register', 'unregister', 'invalidateModelPlacement', 'dispose', 'getPairStatus', 'getElementStatus', 'wireModelUnload', 'saveTest', 'rerun', 'retryPersist', 'discardRun'];

/**
 * @param {{bindings?: Record<string, object|null>, capacity?: number}} [options] modelKey -> binding
 *   (`{modelKey, model, modelVersion, bindingGeneration}` — `model` must be the SAME object the catalog lists);
 *   `capacity` mirrors Core's `maxResidentResultSets` admission: non-terminal runs + non-evictable resident sets
 *   (leased, or not saved) must leave a slot, else startRun throws ResultCapacityError{cap,active,retained,held};
 *   saved, unleased sets are evicted to make room (as Core does).
 */
export function createScriptedEngine({ bindings = {}, capacity = Infinity } = {}) {
  const forbidden = [];
  const derivationState = { inFlight: 0 };
  const resident = new Map();                 // runId -> {set, state, leases}
  const handles = [];
  const admissionErrors = [];
  const releaseErrors = [];
  const leaseReleaseErrors = [];
  let releaseFailure = null;
  const table = { ...bindings };
  const setOf = (runIdOrSet) => (typeof runIdOrSet === 'string' ? resident.get(runIdOrSet)?.set : runIdOrSet);

  const summarize = controllable((set) => ({
    runId: set.runId, status: set.outcome.status, environmentSensitive: false,
    axes: { coverage: set.outcome.coverage, integrity: set.outcome.integrity, freshness: set.outcome.freshness, freshnessAtSeal: true },
    totalResults: set.results.length, resultsByMode: [], resultsByPairModels: [], resultsByCrossModel: { crossModel: 0, sameModel: 0 },
    resultsCaveated: (CAVEATED.get(set) ?? new Set()).size, unitOutcomes: [], planningGaps: [], gapWeight: 0,
    caveats: { total: 0, completenessAffectingUpperBound: 0, omittedReasonOccurrences: 0, unclassifiedOccurrences: 0, countsByReason: [] },
  }), () => new DerivationAbortedError(), derivationState);
  const filter = controllable((set, clauses) => {
    const c = clauses[0];
    if (!(c && c.facet === 'caveated' && c.op === 'eq' && c.value === true)) throw new Error('scripted engine: only the caveated=true clause is supported');
    const ids = CAVEATED.get(set) ?? new Set();
    const matches = set.results.filter((r) => ids.has(r.resultId)).map((r) => r.resultId);
    return { matches, count: matches.length, total: set.results.length, unavailable: [] };
  }, () => new DerivationAbortedError(), derivationState);
  const groupBy = controllable((set, facets) => {
    if (facets.length === 1 && facets[0] === 'element') return elementGroups(set);
    if (facets.length === 1 && facets[0] === 'pairModels') return pairModelGroups(set);
    throw new Error('scripted engine: only groupBy(["element"]) / groupBy(["pairModels"]) are supported');
  }, () => new DerivationAbortedError(), derivationState);
  const freshness = controllable((runIdOrSet) => {
    const set = setOf(runIdOrSet);
    if (set === undefined) throw new ResultNotResidentError({ runId: runIdOrSet });
    return { state: set.outcome.freshness, reasons: [] };
  }, () => new ReadAbortedError());
  const claim = controllable((runIdOrSet) => {
    const set = setOf(runIdOrSet);
    if (set === undefined) throw new ResultNotResidentError({ runId: runIdOrSet });
    const o = set.outcome;
    const allowed = set.results.length === 0 && o.status === 'completed' && o.coverage === 'full' && o.integrity === 'clean' && o.freshness === 'current';
    return { allowed, unqualified: allowed, qualifiers: [], exclusions: [], proofMethod: 'bracketed-digest' };
  }, () => new ReadAbortedError());

  const engine = {
    forbidden,
    handles,
    resident,
    control: { summarize: summarize.ctl, filter: filter.ctl, groupBy: groupBy.ctl, getFreshness: freshness.ctl, assessNoClashClaim: claim.ctl },
    validation: () => ({ issues: [], issuesTruncated: false }),
    startCalls: [],
    get lastHandle() { return handles[handles.length - 1]; },
    /** The next startRun throws `error` synchronously (admission failure). */
    failNextStart(error) { admissionErrors.push(error); },
    /** The next releaseResultSet (on a resident set) throws `error`; the set stays resident. */
    failNextRelease(error) { releaseErrors.push(error); },
    /** The next lease.release() throws `error`; the lease stays live (so releaseResultSet then refuses). */
    failNextLeaseRelease(error) { leaseReleaseErrors.push(error); },
    /** Every releaseResultSet throws `error` until called with null (a permanent failure). */
    setReleaseFailure(error) { releaseFailure = error; },
    setBinding(modelKey, binding) { table[modelKey] = binding; },
    validateTest(definition) { return engine.validation(definition); },
    startRun(definition, runOptions) {
      engine.startCalls.push({ definition, runOptions });
      if (admissionErrors.length > 0) throw admissionErrors.shift();
      if (capacity !== Infinity) {
        const active = handles.filter((h) => !h.terminal).map((h) => h.runId);
        const pinned = [...resident].filter(([, e]) => e.leases > 0 || e.state !== 'saved');
        if (active.length + pinned.length >= capacity) {
          throw new ResultCapacityError({
            cap: capacity, active,
            retained: pinned.filter(([, e]) => e.leases > 0).map(([id]) => id),
            held: pinned.filter(([, e]) => e.leases === 0).map(([id, e]) => ({ runId: id, persistence: e.state })),
          });
        }
        for (const [id, e] of [...resident]) {
          if (active.length + resident.size < capacity) break;
          if (e.leases === 0 && e.state === 'saved') resident.delete(id);      // evictable
        }
      }
      const handle = new ScriptedHandle(engine, `run-${handles.length + 1}`);
      handles.push(handle);
      return handle.face;
    },
    retainResultSet(runId) {
      const entry = resident.get(runId);
      if (entry === undefined) throw new ResultNotResidentError({ runId });
      if (entry.state !== 'saved') throw new UnsavedResultSetError({ runId });
      entry.leases += 1;
      let released = false;
      return {
        release() {
          if (released) return;
          if (leaseReleaseErrors.length > 0) throw leaseReleaseErrors.shift();   // lease stays live
          released = true;
          entry.leases -= 1;
        },
      };
    },
    releaseResultSet(runId, { acknowledgeUnsaved = false } = {}) {
      const entry = resident.get(runId);
      if (entry === undefined) return;
      if (releaseFailure !== null) throw releaseFailure;              // permanent failure injection
      if (releaseErrors.length > 0) throw releaseErrors.shift();      // one-shot failure injection
      if (entry.leases > 0) throw new ResultSetRetainedError({ runId });
      if (entry.state !== 'saved' && acknowledgeUnsaved !== true) throw new UnsavedResultSetError({ runId });
      resident.delete(runId);
    },
    getPersistenceState(runId) {
      const entry = resident.get(runId);
      return entry === undefined ? null : { state: entry.state, timedOut: false, attempt: 1 };
    },
    getFreshness: freshness.fn,
    assessNoClashClaim: claim.fn,
    derivations: { summarize: summarize.fn, groupBy: groupBy.fn, filter: filter.fn },
    registry: {
      bindingFor(modelKey) { return table[modelKey] ?? null; },
      register() { forbidden.push('registry.register'); throw new Error('forbidden: registry.register'); },
      unregister() { forbidden.push('registry.unregister'); throw new Error('forbidden: registry.unregister'); },
      keyOf() { forbidden.push('registry.keyOf'); throw new Error('forbidden: registry.keyOf'); },
      notifyPlacementChanged() { forbidden.push('registry.notifyPlacementChanged'); throw new Error('forbidden: registry.notifyPlacementChanged'); },
    },
  };
  for (const name of FORBIDDEN) {
    engine[name] = () => { forbidden.push(name); throw new Error(`forbidden: ${name}`); };
  }
  return engine;
}

// ---- bridge double ---------------------------------------------------------------------------------------------

export function createRecordingBridge() {
  const calls = [];                              // Viewer-MUTATING operations only: present / presentGroup / clear / dispose
  const reads = [];                              // read-only operations (isolation prerequisite, selection)
  const modelLeft = new Set();
  let prerequisite = { available: true, reason: null };
  let selection = [];
  let manual = false;
  let clearOutcome = { isolation: 'none', markersRemoved: 0, notes: [] };
  let clearImpl = null;
  const pending = [];
  const bridge = {
    calls,
    reads,
    get presents() { return calls.filter((c) => c.op === 'present'); },
    setIsolationPrerequisite(value) { prerequisite = value; },
    setSelection(list) { selection = list; },
    /** The ClearOutcome every later clear() resolves with. */
    setClearOutcome(outcome) { clearOutcome = outcome; },
    /** Custom clear() behaviour (a delayed or rejecting promise); null restores the default. */
    setClearImpl(fn) { clearImpl = fn; },
    /** When manual, present() stays pending until resolvePresent(). */
    setManual(value) { manual = value; },
    resolvePresent(outcome, index = 0) { pending.splice(index, 1)[0](outcome); },
    get groupPresents() { return calls.filter((c) => c.op === 'presentGroup'); },
    listenerCount: () => modelLeft.size,
    fireModelLeft(event) { for (const cb of [...modelLeft]) cb(event); },
    present(req) {
      calls.push({ op: 'present', req });
      const auto = { superseded: false, fitted: req.options.focus, isolated: req.options.isolate, marked: req.options.marker, notes: [] };
      if (manual) return new Promise((resolve) => pending.push((o) => resolve(o ?? auto)));
      return Promise.resolve(auto);
    },
    /** Addendum B2 seam: records the aggregate request; B3 implements the real ViewerBridge.presentGroup(). */
    presentGroup(req) {
      calls.push({ op: 'presentGroup', req });
      const auto = { superseded: false, fitted: req.options.focus, isolated: req.options.isolate, notes: [] };
      if (manual) return new Promise((resolve) => pending.push((o) => resolve(o ?? auto)));
      return Promise.resolve(auto);
    },
    clear() { calls.push({ op: 'clear' }); return clearImpl !== null ? clearImpl() : Promise.resolve(clearOutcome); },
    dispose() { calls.push({ op: 'dispose' }); return Promise.resolve(); },
    checkIsolationPrerequisite() { reads.push('checkIsolationPrerequisite'); return prerequisite; },
    readAggregateSelection() { reads.push('readAggregateSelection'); return selection; },
    onModelLeft(cb) { modelLeft.add(cb); return () => { modelLeft.delete(cb); }; },
  };
  return bridge;
}

// ---- models + one-call setup -----------------------------------------------------------------------------------

/** A Viewer-Model-shaped object whose object tree names dbIds from `names` (a map or a function). */
export function makeFakeModel(label, names = {}) {
  const nameOf = typeof names === 'function' ? names : (dbId) => names[dbId];
  return { label, getObjectTree: () => ({ getNodeName: (dbId) => nameOf(dbId) }) };
}

/**
 * Gives a fake model a Viewer-shaped bulk property read: `getBulkProperties2(ids, options, onSuccess, onError)`
 * (or the legacy `getBulkProperties` when `legacy`). `propsOf(dbId)` -> `{name?, properties:[{displayName,
 * attributeName, displayCategory, displayValue}]}` or undefined (no row for that id). Mirrors the pinned-build
 * behaviour the live probe observed (Viewer 7.124.2 SVF2): with a `propFilter` only matching properties are returned
 * (by displayName OR attributeName) and the row's top-level `name` is undefined; an unfiltered read carries `name`.
 * `model.properties` = {calls, fail(error|null), manual, pending, resolveAll()} for tests.
 */
export function withFakeProperties(model, propsOf, { legacy = false } = {}) {
  const ctl = { calls: [], failWith: null, manual: false, pending: [] };
  ctl.resolveAll = () => { while (ctl.pending.length > 0) ctl.pending.shift()(); };
  model[legacy ? 'getBulkProperties' : 'getBulkProperties2'] = (ids, options, onSuccess, onError) => {
    ctl.calls.push({ ids: [...ids], options });
    const run = () => {
      if (ctl.failWith !== null) { onError(ctl.failWith); return; }
      const filter = Array.isArray(options?.propFilter) ? options.propFilter : null;
      const rows = [];
      for (const dbId of ids) {
        const entry = propsOf(dbId);
        if (entry === undefined || entry === null) continue;
        const properties = (entry.properties ?? []).filter((p) => filter === null || filter.includes(p.displayName) || filter.includes(p.attributeName));
        rows.push({ dbId, name: filter === null ? entry.name : undefined, properties });
      }
      onSuccess(rows);
    };
    if (ctl.manual) ctl.pending.push(run); else queueMicrotask(run);
  };
  model.properties = ctl;
  return model;
}

/** Property-record builders for withFakeProperties (the shapes a Revit-derived SVF/SVF2 property db reports). */
export const prop = Object.freeze({
  category: (value) => ({ displayName: 'Category', attributeName: 'Category', displayCategory: '__category__', displayValue: value }),
  levelRef: (dbId) => ({ displayName: 'Level', attributeName: 'Level', displayCategory: '__internalref__', displayValue: dbId }),
  constraintsLevel: (value) => ({ displayName: 'Level', attributeName: 'Level', displayCategory: 'Constraints', displayValue: value }),
  named: (displayName, value, displayCategory = 'Constraints') => ({ displayName, attributeName: displayName, displayCategory, displayValue: value }),
});

/**
 * A controller over the doubles with two registered, loaded models mA ("Architecture") and mB ("Structure") —
 * names overridable through `displayNames` —
 * bindingGeneration 1 / modelVersion 'v1' (matching makeSet's default provenance). `props` = {mA?, mB?} property
 * functions for withFakeProperties (models without one have no bulk property read at all).
 */
export function makeHarness({ basis = { state: 'verified', basisKey: 'b1' }, names, displayNames = { mA: 'Architecture', mB: 'Structure' }, capacity = Infinity, props = {}, extraModels = [] } = {}) {
  const scheduler = createFakeScheduler();
  const modelA = makeFakeModel('A', names?.mA ?? ((dbId) => `A-${dbId}`));
  const modelB = makeFakeModel('B', names?.mB ?? ((dbId) => `B-${dbId}`));
  if (typeof props.mA === 'function') withFakeProperties(modelA, props.mA);
  if (typeof props.mB === 'function') withFakeProperties(modelB, props.mB);
  const extras = extraModels.map((m) => ({ ...m, model: makeFakeModel(m.modelKey, (dbId) => `${m.modelKey}-${dbId}`) }));
  const catalog = createFakeCatalog({
    models: [
      { modelKey: 'mA', displayName: displayNames.mA, model: modelA, loaded: true },
      { modelKey: 'mB', displayName: displayNames.mB, model: modelB, loaded: true },
      ...extras.map((m) => ({ modelKey: m.modelKey, displayName: m.displayName ?? m.modelKey, model: m.model, loaded: true })),
    ],
    basis,
  });
  const engine = createScriptedEngine({
    capacity,
    bindings: {
      mA: { modelKey: 'mA', model: modelA, modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 0 },
      mB: { modelKey: 'mB', model: modelB, modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 0 },
      ...Object.fromEntries(extras.map((m) => [m.modelKey, { modelKey: m.modelKey, model: m.model, modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 0 }])),
    },
  });
  const bridge = createRecordingBridge();
  let ids = 0;
  const controller = createPanelController({ engine, catalog, bridge, scheduler, mintId: () => { ids += 1; return `test-${ids}`; } });
  const h = {
    scheduler, catalog, engine, bridge, controller, modelA, modelB, extraModels: Object.fromEntries(extras.map((m) => [m.modelKey, m.model])),
    vm: () => controller.getViewModel(),
    settle: (rounds) => settle(scheduler, rounds),
    async dispatch(intent) { const out = await controller.dispatch(intent); await settle(scheduler); return out; },
    /** Select mA for Set A and mB for Set B (Hard, the default mode) and let validation settle. */
    async readyHard() {
      await h.dispatch({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'A', modelKey: 'mA' });
      await h.dispatch({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'B', modelKey: 'mB' });
    },
    /** Starts a run (RUN_START) and returns the scripted handle. */
    async start() {
      await h.dispatch({ type: INTENT.RUN_START });
      return engine.lastHandle;
    },
    /** Starts a run and seals it with `set` (persistence default `saved`). */
    async runToDone(set, { status = set?.outcome?.status ?? 'failed', persistence } = {}) {
      const handle = await h.start();
      handle.emitState({ status: 'planning', phase: 'enumerating' });
      handle.finish({ status, resultSet: set, ...(persistence ? { persistence } : {}) });
      await settle(scheduler);
      return handle;
    },
  };
  return h;
}
