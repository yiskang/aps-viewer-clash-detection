// test/clashpanel/support/fakeViewer.mjs
// Viewer3D-shaped double (catalog 1, "Viewer"): public overlay API with MESH FIRST / SCENE NAME SECOND (throws on a
// non-string scene name, like the repo's fake), full-replace aggregate isolation with the verified semantics, both
// fitToView forms, event listeners, and injectable failures (`failNext`, optionally AFTER the state change, for the
// ambiguous-throw matrix of AC-P16). Every theming method, `impl`, selection mutators and per-model visibility
// methods THROW and are recorded: the Panel must never call them (AC-P19; theming message is exactly 'theming forbidden').
export const FAKE_EVENTS = Object.freeze({
  BEFORE_MODEL_UNLOAD: 'fake:before-model-unload', MODEL_REMOVED: 'fake:model-removed', MODEL_ADDED: 'fake:model-added',
});
export const THEMING_METHODS = Object.freeze(['setThemingColor', 'clearThemingColors', 'getThemingColor', 'updateThemingColors']);
export const FORBIDDEN_VIEWER_METHODS = Object.freeze([
  'select', 'setSelection', 'setAggregateSelection', 'clearSelection', 'isolate', 'hide', 'show', 'showAll', 'hideModel', 'setAllVisibility',
]);

export function createFakeModel({ id = 1, name = `Model ${id}`, names = {}, boxes = {}, hasObjectTree = true } = {}) {
  const model = { id, displayName: name, nodeNameCalls: [], deprecatedInstanceTreeCalls: 0, boundsCalls: [], boundsMode: 'ok' };
  const tree = {
    getNodeName(dbId) { model.nodeNameCalls.push(dbId); return Object.hasOwn(names, dbId) ? names[dbId] : null; },
    getNodeBox(dbId, out) { const b = boxes[dbId]; if (b) for (let i = 0; i < 6; i += 1) out[i] = b[i]; },
  };
  model.getObjectTree = () => (hasObjectTree ? tree : null);
  model.getInstanceTree = () => { model.deprecatedInstanceTreeCalls += 1; return hasObjectTree ? tree : null; };
  /** World-space bounds as the (evidence-gated) ViewerApi would return them: a fresh [minx,miny,minz,maxx,maxy,maxz] or null. */
  model.worldBounds = (dbId) => {
    model.boundsCalls.push(dbId);
    if (model.boundsMode === 'throw') throw new Error('bounds unavailable');
    if (model.boundsMode === 'null' || !boxes[dbId]) return null;
    return [...boxes[dbId]];
  };
  model.setBoundsMode = (m) => { model.boundsMode = m; };
  return model;
}

export function createFakeViewer({ models = [], isolation = [], hiddenNodes = [], selection = [] } = {}) {
  const state = { models: [...models], isolation: [], hiddenNodes: [...hiddenNodes], selection: [...selection], scenes: new Map(), foreignTheming: [] };
  const calls = { getAllModels: 0, getAggregateIsolation: 0, getAggregateHiddenNodes: 0, getAggregateSelection: 0, setAggregateIsolation: [], fitToView: [], overlay: [] };
  const listeners = new Map();
  const listenerLog = [];
  const injections = new Map();
  const forbiddenCalls = [];
  const themingCalls = [];
  const copyIso = (list) => list.map((e) => ({ model: e.model, ids: [...e.ids] }));
  const guarded = (name, effect) => {
    const injection = injections.get(name)?.shift();
    if (injection && !injection.afterEffect) throw injection.error;
    const result = effect();
    if (injection && injection.afterEffect) throw injection.error;
    return result;
  };
  const sceneName = (op, name) => {
    if (typeof name !== 'string') throw new TypeError(`overlays.${op}: scene name must be a string (mesh FIRST, scene name SECOND)`);
    return name;
  };
  const isMesh = (op, mesh) => {
    if (mesh === null || typeof mesh !== 'object') throw new TypeError(`overlays.${op}: mesh must be an object`);
    return mesh;
  };

  const overlays = {
    hasScene(name) { calls.overlay.push({ op: 'hasScene', args: [name] }); return state.scenes.has(sceneName('hasScene', name)); },
    addScene(name) {
      calls.overlay.push({ op: 'addScene', args: [name] });
      sceneName('addScene', name);
      return guarded('addScene', () => { if (state.scenes.has(name)) return false; state.scenes.set(name, new Set()); return true; });
    },
    addMesh(mesh, name) {
      calls.overlay.push({ op: 'addMesh', args: [mesh, name] });
      isMesh('addMesh', mesh); sceneName('addMesh', name);
      return guarded('addMesh', () => { const s = state.scenes.get(name); if (!s) return false; s.add(mesh); return true; });
    },
    removeMesh(mesh, name) {
      calls.overlay.push({ op: 'removeMesh', args: [mesh, name] });
      isMesh('removeMesh', mesh); sceneName('removeMesh', name);
      return guarded('removeMesh', () => { const s = state.scenes.get(name); return s ? s.delete(mesh) : false; });
    },
    removeScene(name) {
      calls.overlay.push({ op: 'removeScene', args: [name] });
      sceneName('removeScene', name);
      return guarded('removeScene', () => state.scenes.delete(name));
    },
  };

  const viewer = {
    calls, forbiddenCalls, themingCalls, listenerLog, aggregateFit: true, overlays,
    getAllModels() { calls.getAllModels += 1; return [...state.models]; },
    getAggregateIsolation() { calls.getAggregateIsolation += 1; return guarded('getAggregateIsolation', () => copyIso(state.isolation)); },
    getAggregateHiddenNodes() { calls.getAggregateHiddenNodes += 1; return guarded('getAggregateHiddenNodes', () => [...state.hiddenNodes]); },
    setAggregateIsolation(list) {
      if (!Array.isArray(list) || !list.every((e) => e && typeof e === 'object' && e.model && Array.isArray(e.ids))) {
        throw new TypeError('setAggregateIsolation: expected [{ model, ids: number[] }]');
      }
      calls.setAggregateIsolation.push(copyIso(list));
      return guarded('setAggregateIsolation', () => {
        if (list.length === 0) { state.isolation = []; state.hiddenNodes = []; return; }      // show-all-of-everything, also clears hidden state
        const loaded = new Set(state.models);
        state.isolation = copyIso(list.filter((e) => loaded.has(e.model) && e.ids.length > 0)); // unloaded ignored; {model, ids:[]} = show the whole model
      });
    },
    fitToView(first, second, third) {
      const aggregate = Array.isArray(first) && first.length > 0 && first[0] !== null && typeof first[0] === 'object' && 'model' in first[0];
      calls.fitToView.push({ form: aggregate ? 'aggregate' : 'ids', args: [first, second, third] });
      if (aggregate) {
        if (viewer.aggregateFit === false) throw new TypeError('fitToView: aggregate form is not supported by this viewer');
        if (!first.every((e) => Array.isArray(e.selection))) throw new TypeError('fitToView: aggregate entries need a `selection` array');
      } else if (!Array.isArray(first)) throw new TypeError('fitToView: expected an array of dbIds');
      guarded('fitToView', () => undefined);
    },
    getAggregateSelection() { calls.getAggregateSelection += 1; return guarded('getAggregateSelection', () => state.selection.map((e) => ({ model: e.model, selection: [...e.selection] }))); },
    addEventListener(name, fn) {
      listenerLog.push({ op: 'add', name });
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) { listenerLog.push({ op: 'remove', name }); listeners.get(name)?.delete(fn); },
    // ---- test controls ----
    listenerCount: (name) => (name === undefined ? [...listeners.values()].reduce((n, s) => n + s.size, 0) : (listeners.get(name)?.size ?? 0)),
    dispatch(name, payload = {}) { for (const fn of [...(listeners.get(name) ?? [])]) fn({ type: name, ...payload }); },
    addModel(model) { state.models.push(model); },
    removeModel(model) { state.models = state.models.filter((m) => m !== model); state.isolation = state.isolation.filter((e) => e.model !== model); },
    setIsolationState(list) { state.isolation = copyIso(list); },
    setHiddenNodes(list) { state.hiddenNodes = [...list]; },
    setSelectionState(list) { state.selection = list.map((e) => ({ model: e.model, selection: [...e.selection] })); },
    overlayScenes: () => [...state.scenes.keys()],
    overlayMeshes: (name) => [...(state.scenes.get(name) ?? [])],
    seedForeignTheming(entries) { state.foreignTheming = entries.map((e) => ({ ...e })); },
    themingState: () => state.foreignTheming.map((e) => ({ ...e })),
    /** Queue an injected failure: `afterEffect:true` throws AFTER the Viewer state already changed (an ambiguous throw). */
    failNext(name, { error = new Error(`injected ${name} failure`), afterEffect = false, times = 1 } = {}) {
      if (!injections.has(name)) injections.set(name, []);
      for (let i = 0; i < times; i += 1) injections.get(name).push({ error, afterEffect });
    },
    injectionsRemaining: () => [...injections.values()].reduce((n, q) => n + q.length, 0),
  };
  for (const name of THEMING_METHODS) {
    viewer[name] = (...args) => { themingCalls.push({ name, args }); forbiddenCalls.push(name); throw new Error('theming forbidden'); };
  }
  for (const name of FORBIDDEN_VIEWER_METHODS) {
    viewer[name] = (...args) => { forbiddenCalls.push(name); throw new Error(`forbidden viewer call: ${name}(${args.length} args)`); };
  }
  Object.defineProperty(viewer, 'impl', { enumerable: true, get() { forbiddenCalls.push('impl'); throw new Error('forbidden: viewer.impl'); } });
  state.isolation = copyIso(isolation);
  return viewer;
}

/** A hand-written double of the ViewerApi facade (catalog 5) over a fake viewer, so bridge tasks do not depend on viewerApi.js. */
export function createFakeViewerApi(viewer = createFakeViewer()) {
  return {
    viewer,
    getAllModels: () => viewer.getAllModels(),
    getAggregateIsolation: () => viewer.getAggregateIsolation(),
    getAggregateHiddenNodes: () => viewer.getAggregateHiddenNodes(),
    setAggregateIsolation: (list) => viewer.setAggregateIsolation(list),
    fitToView: (ids, model, immediate) => viewer.fitToView(ids, model, immediate),
    // Controller ruling C-4: aggregate fit passes the list in the FIRST slot, then `undefined`, then `immediate`.
    fitToViewAggregate: (list, immediate) => viewer.fitToView(list, undefined, immediate),
    hasAggregateFit: () => viewer.aggregateFit !== false,
    getAggregateSelection: () => viewer.getAggregateSelection(),
    overlays: {
      hasScene: (name) => viewer.overlays.hasScene(name),
      addScene: (name) => viewer.overlays.addScene(name),
      addMesh: (mesh, name) => viewer.overlays.addMesh(mesh, name),
      removeMesh: (mesh, name) => viewer.overlays.removeMesh(mesh, name),
      removeScene: (name) => viewer.overlays.removeScene(name),
    },
    getElementWorldBounds: (model, dbId) => (typeof model?.worldBounds === 'function' ? model.worldBounds(dbId) : null),
    addEventListener: (name, fn) => viewer.addEventListener(name, fn),
    removeEventListener: (name, fn) => viewer.removeEventListener(name, fn),
  };
}
