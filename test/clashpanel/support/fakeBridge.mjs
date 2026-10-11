// test/clashpanel/support/fakeBridge.mjs
// ViewerBridge PORT double (catalog 3): what the controller may call. Records every call; `auto` (default) resolves each
// call with a sensible outcome, `holdAll()` switches to manual so a test resolves each call itself (interleavings).
import { createDeferred } from './fakeEngine.mjs';

const presentDefault = (req, prerequisite) => ({
  superseded: false, fitted: Boolean(req?.options?.focus), isolated: Boolean(req?.options?.isolate) && prerequisite.available,
  marked: Boolean(req?.options?.marker), notes: [],
});
/** Addendum B (spec §27.3): the aggregate GroupOutcome carries no `marked`/witness field. */
const groupDefault = (req, prerequisite) => ({
  superseded: false, fitted: Boolean(req?.options?.focus), isolated: Boolean(req?.options?.isolate) && prerequisite.available, notes: [],
});

export function createFakeBridge({ auto = true, journal = null, prerequisite = { available: true, reason: null }, selection = [] } = {}) {
  const calls = { present: [], presentGroup: [], clear: [], dispose: [], afterDispose: [], checkIsolationPrerequisite: 0, readAggregateSelection: 0 };
  const leftListeners = new Set();
  const failures = { present: [], presentGroup: [], clear: [], dispose: [] };
  const listenerErrors = [];
  let mode = auto ? 'auto' : 'manual';
  let disposed = false;
  let prereq = prerequisite;
  let sel = selection;
  let presentOutcome = null;
  let clearOutcome = { isolation: 'none', markersRemoved: 0, notes: [] };
  const note = (name) => { if (journal) journal.push(`bridge.${name}`); };

  function enqueue(kind, record, defaultOutcome) {
    const d = createDeferred();
    const call = { ...record, settled: false, promise: d.promise };
    call.resolve = (outcome = defaultOutcome) => { if (call.settled) return; call.settled = true; d.resolve(outcome); };
    call.reject = (error) => { if (call.settled) return; call.settled = true; d.reject(error); };
    calls[kind].push(call);
    if (failures[kind].length > 0) { const error = failures[kind].shift(); queueMicrotask(() => call.reject(error)); } else if (mode === 'auto') queueMicrotask(() => call.resolve());
    return d.promise;
  }

  const bridge = {
    calls, listenerErrors,
    present(req) {
      note('present');
      if (disposed) { calls.afterDispose.push({ kind: 'present', req }); return Promise.resolve({ disposed: true, superseded: false, fitted: false, isolated: false, marked: false, notes: [] }); }
      const dflt = typeof presentOutcome === 'function' ? presentOutcome(req) : (presentOutcome ?? presentDefault(req, prereq));
      return enqueue('present', { req }, dflt);
    },
    presentGroup(req) {
      note('presentGroup');
      if (disposed) { calls.afterDispose.push({ kind: 'presentGroup', req }); return Promise.resolve({ disposed: true, superseded: true, fitted: false, isolated: false, participants: 0, notes: [] }); }
      return enqueue('presentGroup', { req }, groupDefault(req, prereq));
    },
    clear() {
      note('clear');
      if (disposed) { calls.afterDispose.push({ kind: 'clear' }); return Promise.resolve({ disposed: true, isolation: 'none', markersRemoved: 0, notes: [] }); }
      return enqueue('clear', {}, clearOutcome);
    },
    dispose() {
      note('dispose');
      if (disposed) { calls.afterDispose.push({ kind: 'dispose' }); return Promise.resolve(); }
      disposed = true;
      leftListeners.clear();
      return enqueue('dispose', {}, undefined);
    },
    checkIsolationPrerequisite() { calls.checkIsolationPrerequisite += 1; return { ...prereq }; },
    readAggregateSelection() { calls.readAggregateSelection += 1; return sel.map((e) => ({ model: e.model, dbIds: [...e.dbIds] })); },
    onModelLeft(cb) {
      if (typeof cb !== 'function') throw new TypeError('bridge.onModelLeft: callback must be a function');
      leftListeners.add(cb);
      return () => { leftListeners.delete(cb); };
    },
    // ---- test controls ----
    get disposed() { return disposed; },
    holdAll() { mode = 'manual'; return bridge; },
    autoAll() { mode = 'auto'; return bridge; },
    pending: (kind) => calls[kind].filter((c) => !c.settled),
    setPrerequisite(v) { prereq = v; },
    setSelection(list) { sel = list; },
    setPresentOutcome(valueOrFn) { presentOutcome = valueOrFn; },
    setClearOutcome(v) { clearOutcome = v; },
    failNext(kind, error) { failures[kind].push(error); },
    modelLeftListenerCount: () => leftListeners.size,
    emitModelLeft(payload) {
      for (const cb of [...leftListeners]) { try { cb(payload); } catch (e) { listenerErrors.push(e); } }
    },
  };
  return bridge;
}
