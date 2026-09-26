// clashpanel/viewer/viewerApi.js
// The ONLY module under clashpanel/ that names Viewer3D methods: a narrow facade over a Viewer3D-shaped
// object (injected by the host). Tier B: every mapping below is source-observed against the pinned
// 7.124.2 bundle only (evidence doc 2026-09-26-viewer-clash-panel-viewer-api-evidence.md) and proven
// here against a shape-mimicking fake — NOTHING is SVF2- or runtime-verified (gates G1/G2, PG-1).
// No theming member is ever read or called (PD-16).

const isFn = (v) => typeof v === 'function';

export function createViewerApi(viewer, { events } = {}) {
  if (!viewer || !viewer.overlays) throw new TypeError('createViewerApi: a Viewer3D-shaped object with overlays is required');
  if (typeof events?.BEFORE_MODEL_UNLOAD !== 'string' || typeof events?.MODEL_REMOVED !== 'string') {
    throw new TypeError('createViewerApi: events {BEFORE_MODEL_UNLOAD, MODEL_REMOVED} names are required');
  }
  const overlays = viewer.overlays;

  return Object.freeze({
    eventNames: Object.freeze({ BEFORE_MODEL_UNLOAD: events.BEFORE_MODEL_UNLOAD, MODEL_REMOVED: events.MODEL_REMOVED }),

    getAllModels: () => viewer.getAllModels(),
    getAggregateIsolation: () => viewer.getAggregateIsolation(),
    getAggregateHiddenNodes: () => viewer.getAggregateHiddenNodes(),
    setAggregateIsolation: (list) => { viewer.setAggregateIsolation(list); },

    // Public per-model form: fitToView(ids, model, immediate).
    fitToView: (ids, model, immediate) => { viewer.fitToView(ids, model, immediate); },
    // Unpublished aggregate form, source-observed: fitToView([{model, selection}], model, immediate) is
    // treated as an aggregate selection when the first entry has a `model`; the key MUST be `selection`
    // (an `ids` key throws). The second argument is the model slot, so it is passed as undefined.
    // Whether it frames the true world-space union is UNVERIFIED (G2 / PG-1).
    hasAggregateFit: () => isFn(viewer.fitToView) && isFn(viewer.getAggregateSelection),
    fitToViewAggregate: (list, immediate) => {
      viewer.fitToView(list.map((e) => ({ model: e.model, selection: [...e.selection] })), undefined, immediate);
    },

    // Bundle and typings return {model, selection}; the reference pages name the key `selectionSet`.
    // Both are accepted and normalised to `selection`; malformed entries are dropped.
    getAggregateSelection: () => {
      const raw = viewer.getAggregateSelection();
      if (!Array.isArray(raw)) return [];
      const out = [];
      for (const e of raw) {
        const ids = Array.isArray(e?.selection) ? e.selection : Array.isArray(e?.selectionSet) ? e.selectionSet : null;
        if (e && e.model && ids) out.push({ model: e.model, selection: [...ids] });
      }
      return out;
    },

    overlays: Object.freeze({
      hasScene: (name) => overlays.hasScene(name),
      addScene: (name) => overlays.addScene(name),
      addMesh: (mesh, name) => overlays.addMesh(mesh, name),          // mesh FIRST, scene name second
      removeMesh: (mesh, name) => overlays.removeMesh(mesh, name),
      removeScene: (name) => overlays.removeScene(name),
    }),

    // Element bounds for the outline overlay. getNodeBox fills a FLAT Float32Array(6)
    // [minx,miny,minz,maxx,maxy,maxz]. WORLD-SPACE CORRECTNESS IS UNVERIFIED (PG-1 / F7, gate G2): the
    // outline is evidence-gated and silently omitted whenever this returns null. The buffer is pre-filled
    // with NaN so an unknown dbId (left unfilled) reads as "unavailable", never as a zero box at the origin.
    getElementWorldBounds: (model, dbId) => {
      try {
        let tree = isFn(model?.getObjectTree) ? model.getObjectTree() : null;
        if (!tree || !isFn(tree.getNodeBox)) tree = isFn(model?.getInstanceTree) ? model.getInstanceTree() : null;
        if (!tree || !isFn(tree.getNodeBox)) return null;
        const box = new Float32Array(6).fill(Number.NaN);
        tree.getNodeBox(dbId, box);
        const out = Array.from(box);
        if (!out.every(Number.isFinite) || out[0] > out[3] || out[1] > out[4] || out[2] > out[5]) return null;
        return out;
      } catch {
        return null;
      }
    },

    addEventListener: (name, fn) => { viewer.addEventListener(name, fn); },
    removeEventListener: (name, fn) => { viewer.removeEventListener(name, fn); },
  });
}
