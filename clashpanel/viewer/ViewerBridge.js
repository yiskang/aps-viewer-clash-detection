// clashpanel/viewer/ViewerBridge.js
// The ONLY Viewer mutator of the Panel (spec §9.2). Tier B: sequencing, ledger and rollback are proven
// against injected fakes only; live Viewer behaviour is gated (G2 / PG-1 / F7 / F8).
//
// Presentation transaction (normative, §9.2): present/clear/dispose share one single-flight queue;
// each present gets token ++n; clear/dispose/a later present invalidate every earlier token AT CALL
// TIME (before the queue reaches them); the token is re-checked immediately before every Viewer
// mutation. All Panel-owned Viewer resources hang off exactly ONE write-ahead ledger (`held`):
// {token, markerMeshes[], isolation: session record}. An in-flight present adopts the previous ledger
// (releasing it first), so a failure or supersession cleans everything recorded — the newest surviving
// token's resources or none. Mutation order: compute → release previous → markers → isolation → fit.
// Fit is outside the guarantee (best-effort, never rolled back). The bridge never calls any theming
// member and never touches selection or camera restore.
//
// presentGroup (spec §27.3/§27.4/§27.7) is a SIBLING of present(), never a widening of or fallback through it:
// independently validated {participants:[{model,dbId}], options:{focus,isolate}} of arbitrary positive
// cardinality, de-duplicated by identical {model,dbId}, run through the SAME queue/token/ledger transaction with
// NO marker step (Option A: no witness, closest-point or outline resource). Isolation is one aggregate
// reconcile of every unique live participant; fit frames their union.
import { createMarkerSet, computeMarkerRadius, MIN_MARKER_RADIUS } from './markers.js';
import { createIsolationSession, isolationPrerequisite, isolationEquals, readIsolation } from './isolation.js';
import { fitSides } from './fit.js';

export const BRIDGE_NOTE = Object.freeze({
  NO_LOCATION: 'no location',
  NO_BOUNDS: 'Element bounds unavailable; outline omitted',
  NOT_IN_SCENE: "An element's model is no longer in the scene",
  FAILED: 'The Viewer rejected the presentation; nothing is shown',
  REMOVE_FAILED: 'A marker could not be removed',
});

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

class Superseded extends Error {}

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

// presentGroup request: validated independently of present(); returns a call-time snapshot of the unique
// participants (identical {model, dbId} collapse; equal dbIds in different models stay distinct).
function validateGroupRequest(req) {
  if (!req || !Array.isArray(req.participants) || req.participants.length < 1) throw new TypeError('presentGroup: participants must be a non-empty array');
  const byModel = new Map();
  const unique = [];
  for (const p of req.participants) {
    if (!isModel(p?.model) || !isDbId(p?.dbId)) throw new TypeError('presentGroup: each participant needs {model, dbId}');
    if (!byModel.has(p.model)) byModel.set(p.model, new Set());
    const ids = byModel.get(p.model);
    if (!ids.has(p.dbId)) { ids.add(p.dbId); unique.push(Object.freeze({ model: p.model, dbId: p.dbId })); }
  }
  const o = req.options;
  if (!o || typeof o.focus !== 'boolean' || typeof o.isolate !== 'boolean') throw new TypeError('presentGroup: options {focus, isolate} must be booleans');
  if ('marker' in o) throw new TypeError('presentGroup: a clash group has no marker option');
  return { participants: unique, focus: o.focus, isolate: o.isolate };
}

const outcome = (fields) => Object.freeze({ superseded: false, fitted: false, isolated: false, marked: false, ...fields, notes: Object.freeze([...(fields.notes ?? [])]) });
const DISPOSED_PRESENT = outcome({ superseded: true, disposed: true });
// GroupOutcome: no `marked` and no witness field; `participants` = unique live participants presented.
const groupOutcome = ({ marked: _marked, ...fields }) => Object.freeze({ superseded: false, fitted: false, isolated: false, participants: 0, ...fields, notes: Object.freeze([...(fields.notes ?? [])]) });
const DISPOSED_GROUP = groupOutcome({ superseded: true, disposed: true });
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
  const markers = createMarkerSet({ THREE, overlays: viewerApi.overlays, names });
  const isolation = createIsolationSession(viewerApi);
  let seq = 0;
  let live = 0;
  let disposed = false;
  let disposePromise = null;
  let held = null;                          // the single ledger holding every Panel-owned resource
  const leftCallbacks = new Set();
  const disposeErrors = [];                 // listener removals that failed at dispose (surfaced, never discarded)
  const disposeNotes = [];                  // cleanup notes of the dispose-time release (surfaced, never discarded)

  const isLive = (t) => !disposed && t === live;
  const guard = (t) => { if (!isLive(t)) throw new Superseded(); };

  function removeExact(mesh, notes) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { markers.remove(mesh); return true; } catch { /* retry once: removal of an absent mesh is a no-op */ }
    }
    notes.push(BRIDGE_NOTE.REMOVE_FAILED);
    return false;
  }

  // Cleanup of EVERYTHING the held ledger records (confirmed or not). Never token-gated. A mesh whose exact
  // removal failed stays in the ledger and an isolation restore that failed keeps its session record, so the
  // next clear/present/dispose retries them.
  function releaseHeld() {
    const notes = [];
    let markersRemoved = 0;
    const L = held;
    let iso = { isolation: 'none', notes: [] };
    try {
      if (L !== null) {
        const remaining = L.markerMeshes.filter((mesh) => { const ok = removeExact(mesh, notes); if (ok) markersRemoved += 1; return !ok; });
        L.markerMeshes.length = 0;
        L.markerMeshes.push(...remaining);
        held = remaining.length > 0 ? L : null;   // keep the ledger until every mesh is gone: later clear/present/dispose retry
      }
    } finally {
      iso = isolation.restore();
    }
    return { isolation: iso.isolation, markersRemoved, notes: [...notes, ...iso.notes] };
  }

  function sceneModels() {
    try { const m = viewerApi.getAllModels(); return Array.isArray(m) ? m : []; } catch { return []; }
  }

  function readBounds(side) {
    try { return viewerApi.getElementWorldBounds(side.model, side.dbId); } catch { return null; }
  }

  async function runPresent(t, req) {
    if (!isLive(t)) return outcome({ superseded: true });
    const notes = [];
    const { focus, isolate, marker } = req.options;

    // (1) resolve / compute — reads only, no mutation.
    const inScene = sceneModels();
    const liveSides = req.sides.filter((s) => inScene.includes(s.model));
    if (liveSides.length < req.sides.length) notes.push(BRIDGE_NOTE.NOT_IN_SCENE);
    const boxes = marker ? liveSides.map(readBounds) : [];
    const radius = marker ? computeMarkerRadius(boxes) : MIN_MARKER_RADIUS;

    // (2) markers — the single-clash witness step (location + outlines); bounds already read in step 1.
    const draw = !marker ? null : (hooks) => {
      const loc = markers.addLocation({ point: req.point, closestPoints: req.closestPoints, radius }, hooks);
      if (loc.length === 0) notes.push(BRIDGE_NOTE.NO_LOCATION);
      const boundsOf = (model, dbId) => boxes[liveSides.findIndex((s) => s.model === model && s.dbId === dbId)] ?? null;
      const outl = markers.addOutlines(liveSides, boundsOf, hooks);
      if (outl.omitted > 0) notes.push(BRIDGE_NOTE.NO_BOUNDS);
      return loc.length + outl.meshes.length > 0;
    };
    return transact(t, { targets: liveSides, focus, isolate, notes, draw, make: outcome });
  }

  // Aggregate presentation: the same transaction with NO draw step — no marker, closest-point marker or outline.
  async function runPresentGroup(t, { participants, focus, isolate }) {
    if (!isLive(t)) return groupOutcome({ superseded: true });
    const notes = [];
    const inScene = sceneModels();                                    // (1) reads only
    const liveParticipants = participants.filter((p) => inScene.includes(p.model));
    if (liveParticipants.length < participants.length) notes.push(BRIDGE_NOTE.NOT_IN_SCENE);
    return transact(t, { targets: liveParticipants, focus, isolate, notes, draw: null, make: groupOutcome, shown: { participants: liveParticipants.length } });
  }

  // The ONE presentation transaction shared by present() and presentGroup(): adopt the ledger → release the
  // previous presentation → optional draw → isolation → fit. `targets` are the live {model, dbId} entries; `shown`
  // is merged into a successful outcome only.
  async function transact(t, { targets, focus, isolate, notes, draw, make, shown = {} }) {
    // Adopt the previous ledger: from here on this token's ledger holds every Panel resource.
    const L = { token: t, markerMeshes: held === null ? [] : held.markerMeshes, get isolation() { return isolation.record(); } };
    held = L;
    const hooks = {
      beforeAdd: (mesh) => { L.markerMeshes.push(mesh); guard(t); },   // write-ahead, then token check
      beforeScene: () => guard(t),
    };
    let marked = false;
    let isolated = false;
    try {
      // Release the previous presentation first (exact meshes; isolation only if this one won't isolate).
      for (const mesh of [...L.markerMeshes]) {
        guard(t);
        if (removeExact(mesh, notes)) L.markerMeshes.splice(L.markerMeshes.indexOf(mesh), 1);
      }
      if (!(isolate && targets.length > 0) && isolation.owns()) {
        notes.push(...isolation.restore({ beforeMutation: () => guard(t) }).notes);   // 'failed' is surfaced, never dropped
      }
      guard(t);

      // (2) markers (present() only)
      if (draw !== null) marked = draw(hooks);
      guard(t);

      // (3) isolation — only if requested and the §9.5 prerequisite holds (checked inside apply). One aggregate
      // reconcile of every live target (one or many models).
      if (isolate && targets.length > 0) {
        const r = isolation.apply(targets, { beforeMutation: () => guard(t) });
        isolated = r.applied;
        if (!r.applied) {
          notes.push(r.reason);
          // Fix (T25 review): the release step skipped the restore because this present meant to isolate; a
          // replacement that did not apply must not leave the PREVIOUS target on screen under the new markers.
          // Ownership-guarded and token-guarded restore; never a clear-all fallback.
          if (isolation.owns()) notes.push(...isolation.restore({ beforeMutation: () => guard(t) }).notes);
        }
      }
      guard(t);
    } catch (error) {
      const cleanup = releaseHeld();
      if (error instanceof Superseded) return make({ superseded: true });
      return make({ notes: [...notes, BRIDGE_NOTE.FAILED, ...cleanup.notes] });
    }

    // (4) fit — best-effort, last, outside the transaction guarantee. Many models ⇒ one aggregate fit of the union.
    let fitted = false;
    if (focus && targets.length > 0) {
      const f = fitSides(viewerApi, targets, () => isLive(t));   // token re-checked before every camera call
      fitted = f.fitted;
      notes.push(...f.notes);
    }
    // Invalidated during fit: this presentation is stale. No camera rollback (OD-6); its markers/isolation stay
    // in the held ledger for the invalidator (clear/dispose/newer present) to release.
    if (!isLive(t)) return make({ superseded: true });
    return make({ fitted, isolated, marked, notes, ...shown });
  }

  function present(req) {
    if (disposed) return Promise.resolve(DISPOSED_PRESENT);
    try { validateRequest(req); } catch (e) { return Promise.reject(e); }
    const t = ++seq;
    live = t;                                  // invalidates every earlier token immediately
    return queue.run(async () => {
      try {
        return await runPresent(t, req);
      } catch {                                // unexpected (non-Viewer) failure: clean, never reject
        const cleanup = releaseHeld();
        return outcome({ superseded: !isLive(t), notes: [BRIDGE_NOTE.FAILED, ...cleanup.notes] });
      }
    });
  }

  // Aggregate sibling of present() (spec §27.3): same queue, token supersession and fail-closed outcome; never
  // routed through present().
  function presentGroup(req) {
    if (disposed) return Promise.resolve(DISPOSED_GROUP);
    let group;
    try { group = validateGroupRequest(req); } catch (e) { return Promise.reject(e); }
    const t = ++seq;
    live = t;                                  // invalidates every earlier token immediately
    return queue.run(async () => {
      try {
        return await runPresentGroup(t, group);
      } catch {                                // unexpected (non-Viewer) failure: clean, never reject
        const cleanup = releaseHeld();
        return groupOutcome({ superseded: !isLive(t), notes: [BRIDGE_NOTE.FAILED, ...cleanup.notes] });
      }
    });
  }

  function clear() {
    if (disposed) return Promise.resolve(DISPOSED_CLEAR);
    seq += 1;
    live = 0;
    return queue.run(async () => Object.freeze(releaseHeld()));
  }

  function dispose() {
    if (disposePromise !== null) return disposePromise;
    disposed = true;
    seq += 1;
    live = 0;
    disposePromise = queue.run(async () => {
      try {
        try {
          disposeNotes.push(...releaseHeld().notes);   // e.g. a failed isolation restore: surfaced, not dropped
        } finally {
          markers.removeAll();                 // anything a failed removal left behind
        }
      } finally {
        try { markers.disposeShared(); } finally {
          // Surface (never discard) listener-removal failures; the callbacks are dropped regardless, so a
          // listener the Viewer refused to remove relays to nobody.
          try { disposeErrors.push(...listeners.removeAll()); } finally { leftCallbacks.clear(); }
        }
      }
    }).then(() => undefined, () => undefined);
    return disposePromise;
  }

  // §9.5 prerequisite for the Isolate toggle: sync, read-only. Stays available while the Panel owns the
  // current isolation (its own isolation is not "foreign hidden state"); otherwise the plain §9.5 check.
  function checkIsolationPrerequisite() {
    if (disposed) return Object.freeze({ available: false, reason: 'The panel is closed' });
    const record = isolation.record();
    if (record !== null && record.confirmed) {
      const cur = readIsolation(viewerApi);
      if (cur !== null && isolationEquals(cur, record.target)) return Object.freeze({ available: true, reason: null });
    }
    return isolationPrerequisite(viewerApi);
  }

  // "Use current selection" read: scene models only, ids sorted/de-duplicated, never throws, never mutates
  // (the Panel never changes the Viewer selection).
  function readAggregateSelection() {
    let raw;
    try { raw = viewerApi.getAggregateSelection(); } catch { return Object.freeze([]); }
    if (!Array.isArray(raw)) return Object.freeze([]);
    const inScene = sceneModels();
    const out = [];
    for (const e of raw) {
      if (!isModel(e?.model) || !inScene.includes(e.model) || !Array.isArray(e.selection)) continue;
      const dbIds = [...new Set(e.selection.filter(isDbId))].sort((a, b) => a - b);
      if (dbIds.length > 0) out.push(Object.freeze({ model: e.model, dbIds: Object.freeze(dbIds) }));
    }
    return Object.freeze(out);
  }

  // Model-left events (spec §11.2): ONE Viewer listener per event name, added lazily on the first
  // subscription and removed symmetrically at dispose. Live dispatch order/payloads are gate G2 / F8.
  let subscribed = false;
  function subscribeOnce() {
    if (subscribed) return;
    subscribed = true;
    const eventNames = viewerApi.eventNames ?? {};
    const relay = (reason) => (event) => {
      const model = event?.model;
      if (!isModel(model)) return;                 // payload guard: {model} required
      for (const cb of [...leftCallbacks]) { try { cb({ model, reason }); } catch { /* never throw into dispatch */ } }
    };
    if (typeof eventNames.BEFORE_MODEL_UNLOAD === 'string') listeners.add(eventNames.BEFORE_MODEL_UNLOAD, relay('unload'));
    if (typeof eventNames.MODEL_REMOVED === 'string') listeners.add(eventNames.MODEL_REMOVED, relay('removed'));
  }

  function onModelLeft(cb) {
    if (typeof cb !== 'function') throw new TypeError('onModelLeft: callback must be a function');
    if (disposed) return () => {};
    subscribeOnce();
    leftCallbacks.add(cb);
    return () => { leftCallbacks.delete(cb); };
  }

  // Diagnostic read of the write-ahead ledger (tests; never used by the controller).
  function inspectLedger() {
    if (held === null) return null;
    return Object.freeze({ token: held.token, markerMeshes: Object.freeze([...held.markerMeshes]), isolation: isolation.record() });
  }

  // Diagnostic read of dispose-time failures (tests/host diagnostics; never used by the controller).
  function inspectDisposal() {
    return Object.freeze({ disposed, releaseNotes: Object.freeze([...disposeNotes]), listenerErrors: Object.freeze([...disposeErrors]) });
  }

  return Object.freeze({ present, presentGroup, clear, dispose, checkIsolationPrerequisite, readAggregateSelection, onModelLeft, inspectLedger, inspectDisposal });
}
