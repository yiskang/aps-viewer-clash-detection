// test/clashpanel/support/viewerFaults.mjs
// Bridge-specific helpers over the ONE Viewer fake (T3 `fakeViewer.mjs`, plus its T22 `onCall`/`callLog` addition).
// Holds no Viewer state of its own. Provides:
//   * `createBridgeHarness(opts)` -> the T3 viewer + a ViewerApi for the bridge = T3 `createFakeViewerApi(viewer)`
//     plus `eventNames` (T26 contract), wrapped so any member whose name contains "theming" resolves to the T3
//     viewer's recording/throwing theming method (AC-P19: a bridge that calls one is recorded in `themingCalls`);
//   * `failAt(method, mode, nth)`: an injected failure on the nth call — mode 'before' throws WITHOUT a state change,
//     'after' changes state THEN throws (T3 `failNext(..., {afterEffect})`, armed by a 'before' hook on the nth call);
//   * `panelMeshes()` / `foreignMeshes()` over the Panel's two overlay scenes, `isolation()` (raw state),
//     `fitCalls()`, `callsOf(method)`, `pendingFaults()`, `assertNoTheming()`.
// Support module: no test() calls.
import { createFakeViewer, createFakeViewerApi, createFakeModel, FAKE_EVENTS } from './fakeViewer.mjs';

export const NAMES = Object.freeze({ overlayMarkers: 'clash-panel-markers', overlayOutlines: 'clash-panel-outlines' });
export const EVENTS = Object.freeze({ BEFORE_MODEL_UNLOAD: FAKE_EVENTS.BEFORE_MODEL_UNLOAD, MODEL_REMOVED: FAKE_EVENTS.MODEL_REMOVED });
export const FOREIGN_THEMING = Object.freeze([{ dbId: 7, color: 'red' }]);

export function createBridgeHarness({ models, isolation = [], hiddenNodes = [], selection = [] } = {}) {
  const ms = models ?? [createFakeModel({ id: 1 }), createFakeModel({ id: 2 })];
  const viewer = createFakeViewer({ models: ms, isolation, hiddenNodes, selection });
  viewer.seedForeignTheming(FOREIGN_THEMING);
  const foreign = new Set();
  const base = { ...createFakeViewerApi(viewer), eventNames: EVENTS };
  const api = new Proxy(base, {
    get(t, prop, r) {
      if (typeof prop === 'string' && /theming/i.test(prop)) return viewer[prop] ?? (() => { viewer.themingCalls.push({ name: prop, args: [] }); throw new Error('theming forbidden'); });
      return Reflect.get(t, prop, r);
    },
  });
  const inPanelScenes = () => [...viewer.overlayMeshes(NAMES.overlayMarkers), ...viewer.overlayMeshes(NAMES.overlayOutlines)];
  return {
    viewer,
    api,
    models: ms,
    log: viewer.callLog,
    failAt(method, mode = 'before', nth = 1) {
      viewer.onCall(method, () => viewer.failNext(method, { afterEffect: mode === 'after' }), { nth, phase: 'before' });
    },
    callsOf: (method) => viewer.callLog.filter((e) => e.method === method),
    fitCalls: () => viewer.calls.fitToView.map((c) => c.form),
    pendingFaults: () => viewer.injectionsRemaining() + viewer.hooksRemaining(),
    isolation: () => viewer.isolationState(),
    addForeignMesh(scene) {
      if (!viewer.overlayScenes().includes(scene)) viewer.overlays.addScene(scene);
      const mesh = { foreign: true };
      viewer.overlays.addMesh(mesh, scene);
      foreign.add(mesh);
      viewer.callLog.length = 0;
      return mesh;
    },
    panelMeshes: () => inPanelScenes().filter((m) => !foreign.has(m)),
    foreignMeshes: () => inPanelScenes().filter((m) => foreign.has(m)),
    hasScene: (scene) => viewer.overlayScenes().includes(scene),
    assertNoTheming() {
      if (viewer.themingCalls.length > 0) throw new Error(`theming member called: ${viewer.themingCalls.map((c) => c.name).join(', ')}`);
      if (viewer.forbiddenCalls.length > 0) throw new Error(`forbidden viewer call: ${viewer.forbiddenCalls.join(', ')}`);
      if (JSON.stringify(viewer.themingState()) !== JSON.stringify(FOREIGN_THEMING)) throw new Error('foreign theming state changed');
    },
  };
}

// Normalized, order-independent comparison (model identity + sorted, de-duplicated ids).
export function sameIsolation(a, b) {
  if (a.length !== b.length) return false;
  const norm = (ids) => [...new Set(ids)].sort((x, y) => x - y);
  return a.every((e) => {
    const o = b.find((x) => x.model === e.model);
    if (!o) return false;
    const ea = norm(e.ids); const eb = norm(o.ids);
    return ea.length === eb.length && ea.every((v, i) => v === eb[i]);
  });
}

export async function flush(n = 10) { for (let i = 0; i < n; i++) await Promise.resolve(); }
