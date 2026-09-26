// clashpanel/viewer/ViewerBridge.js
// The ONLY Viewer mutator of the Panel (spec §9.2). Tier B. T22 skeleton: sequencing only — single-flight
// queue, tokens, invalidation, disposed no-ops, symmetric listener bookkeeping. NO Viewer mutation yet
// (markers/isolation/fit arrive in T25/T26).
//
// Invalidation (normative, §9.2): each present gets token ++n; clear(), dispose() and any later present
// invalidate every earlier token AT CALL TIME, before the queue reaches them; a stale token re-checked
// at its next check point returns {superseded:true} and performs no further work. clear()/dispose()
// resolve only after the queue has drained up to them — the completion point for AC-P6/AC-P16.

// Serial single-flight queue: tasks run one at a time in call order; a rejected task never wedges it.
export function createSerialQueue() {
  let tail = Promise.resolve();
  let pending = 0;
  return Object.freeze({
    run(task) {
      pending += 1;
      const result = tail.then(() => task());
      tail = result.then(() => { pending -= 1; }, () => { pending -= 1; });
      return result;
    },
    size: () => pending,
    idle: () => tail,
  });
}

// Symmetric listener bookkeeping: every add is recorded; removeAll() removes exactly those.
export function createListenerRegistry(viewerApi) {
  const added = [];
  return Object.freeze({
    add(name, fn) { viewerApi.addEventListener(name, fn); added.push([name, fn]); },
    removeAll() {
      const errors = [];
      while (added.length > 0) {
        const [name, fn] = added.pop();
        try { viewerApi.removeEventListener(name, fn); } catch (e) { errors.push(e); }
      }
      return errors;
    },
    count: () => added.length,
  });
}

export const BRIDGE_NOTE = Object.freeze({
  FAILED: 'The Viewer rejected the presentation; nothing is shown',
});

const isModel = (v) => v !== null && typeof v === 'object';
const isDbId = (v) => Number.isInteger(v) && v >= 0;

function validateRequest(req) {
  if (!req || !Array.isArray(req.sides) || req.sides.length < 1 || req.sides.length > 2) throw new TypeError('present: sides must hold 1–2 entries');
  for (const s of req.sides) if (!isModel(s?.model) || !isDbId(s?.dbId)) throw new TypeError('present: each side needs {model, dbId}');
  const o = req.options;
  if (!o || typeof o.focus !== 'boolean' || typeof o.isolate !== 'boolean' || typeof o.marker !== 'boolean') {
    throw new TypeError('present: options {focus, isolate, marker} must be booleans');
  }
}

const outcome = (fields) => Object.freeze({ superseded: false, fitted: false, isolated: false, marked: false, ...fields, notes: Object.freeze([...(fields.notes ?? [])]) });
const DISPOSED_PRESENT = outcome({ superseded: true, disposed: true });
const DISPOSED_CLEAR = Object.freeze({ isolation: 'none', markersRemoved: 0, notes: Object.freeze([]), disposed: true });

// Overlay scene names are INSTANCE-scoped by default so two Panels/bridges on one Viewer never share (and so
// never clear or remove) each other's scenes. Injectable for tests/hosts.
let bridgeInstances = 0;
function defaultNames() {
  bridgeInstances += 1;
  return Object.freeze({ overlayMarkers: `clash-panel-markers:${bridgeInstances}`, overlayOutlines: `clash-panel-outlines:${bridgeInstances}` });
}

export function createViewerBridge({ viewerApi, THREE, names = defaultNames() } = {}) {
  if (!viewerApi || !viewerApi.overlays) throw new TypeError('createViewerBridge: viewerApi with overlays is required');
  if (!THREE) throw new TypeError('createViewerBridge: THREE is required');
  if (typeof names?.overlayMarkers !== 'string' || typeof names?.overlayOutlines !== 'string') {
    throw new TypeError('createViewerBridge: names {overlayMarkers, overlayOutlines} are required');
  }
  const queue = createSerialQueue();
  const listeners = createListenerRegistry(viewerApi);
  let seq = 0;
  let live = 0;
  let disposed = false;
  let disposePromise = null;

  const isLive = (t) => !disposed && t === live;

  function sceneModels() {
    try { const m = viewerApi.getAllModels(); return Array.isArray(m) ? m : []; } catch { return []; }
  }

  async function runPresent(t, req) {
    if (!isLive(t)) return outcome({ superseded: true });
    // (1) resolve / compute — reads only. T25 adds the mutating steps, each preceded by a token check.
    const inScene = sceneModels();
    const notes = req.sides.every((s) => inScene.includes(s.model)) ? [] : ["An element's model is no longer in the scene"];
    if (!isLive(t)) return outcome({ superseded: true });   // invalidated during the reads
    return outcome({ notes });
  }

  function present(req) {
    if (disposed) return Promise.resolve(DISPOSED_PRESENT);
    try { validateRequest(req); } catch (e) { return Promise.reject(e); }
    const t = ++seq;
    live = t;                                  // invalidates every earlier token immediately
    return queue.run(async () => {
      try {
        return await runPresent(t, req);
      } catch {                                // unexpected failure: never reject
        return outcome({ superseded: !isLive(t), notes: [BRIDGE_NOTE.FAILED] });
      }
    });
  }

  function clear() {
    if (disposed) return Promise.resolve(DISPOSED_CLEAR);
    seq += 1;
    live = 0;
    return queue.run(async () => Object.freeze({ isolation: 'none', markersRemoved: 0, notes: Object.freeze([]) }));
  }

  function dispose() {
    if (disposePromise !== null) return disposePromise;
    disposed = true;
    seq += 1;
    live = 0;
    disposePromise = queue.run(async () => {
      listeners.removeAll();
    }).then(() => undefined, () => undefined);
    return disposePromise;
  }

  return Object.freeze({ present, clear, dispose });
}
