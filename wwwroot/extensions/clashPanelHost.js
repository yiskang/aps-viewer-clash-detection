// wwwroot/extensions/clashPanelHost.js
//
// Host composition for the Viewer Clash Panel (gate H1): builds the collision world, the clash-test engine
// with the Viewer element enumerator, the model-unload wiring and the read-only ModelCatalog, then the Panel
// itself, and owns the teardown. See clashpanel/README.md ("Ports the host must supply").
//
// DEMO-INTERIM POLICY (OQ-1 is NOT closed; this does not satisfy G-VA-OQ1): modelKey = `${urn}#${loadSeq}`
// with a per-page counter that is never reused, plus a URN-derived modelVersion witness. Results are therefore
// non-resumable across a reload, by design (panel spec 11.1 / OD-8). No measurementBasis is supplied
// (omitted == unverified: Soft is unavailable for multi-model tests, Hard is unaffected).
import { CollisionWorld } from '../../collision/index.js';
import { createClashTestEngine } from '../../clashtest/index.js';
import { createViewerElementEnumerator, wireModelUnload } from '../../clashtest/viewer/index.js';
import { createClashPanel } from '../../clashpanel/index.js';
import { declaredDisplayNameFor } from './clashPanelNames.js';

const DEFAULT_DEPS = Object.freeze({ CollisionWorld, createClashTestEngine, createViewerElementEnumerator, wireModelUnload, createClashPanel });

/** Event names, from the live Autodesk.Viewing constants where present (string literals verified in forge-viewer typings). */
export function viewerEventNames(Autodesk) {
  const V = Autodesk?.Viewing ?? {};
  return Object.freeze({
    BEFORE_MODEL_UNLOAD: V.BEFORE_MODEL_UNLOAD_EVENT ?? 'beforeModelUnload',
    MODEL_ADDED: V.MODEL_ADDED_EVENT ?? 'modelAdded',
    MODEL_REMOVED: V.MODEL_REMOVED_EVENT ?? 'modelRemoved',
    GEOMETRY_LOADED: V.GEOMETRY_LOADED_EVENT ?? 'geometryLoaded',
    OBJECT_TREE_CREATED: V.OBJECT_TREE_CREATED_EVENT ?? 'objectTreeCreated',
  });
}

function safe(fn, fallback = null) {
  try { return fn(); } catch { return fallback; }
}

function readUrn(model) {
  const urn = safe(() => model.getData()?.urn);
  return typeof urn === 'string' && urn !== '' ? urn : null;
}

/**
 * Read-only ModelCatalog (clashpanel/README.md). Registers each model it sees with the engine registry
 * (interim OQ-1 policy above). `loaded` == load complete AND object tree available.
 */
export function createHostCatalog({ viewer, registry, events, nameForUrn = declaredDisplayNameFor, report = () => {} }) {
  const keyByModel = new WeakMap();      // survives unload/unregister (README: keyOfModel)
  const urnByKey = new Map();            // strings only; survives unload (README: displayNameFor)
  const fallbackNameByKey = new Map();
  const subscribers = new Set();
  let loadSeq = 0;
  let disposed = false;

  const safeReport = (stage, e) => { try { report(stage, e); } catch { /* host callback must not break the catalog */ } };

  function deriveFallbackName(model, seq) {
    const bubble = safe(() => model.getData()?.loadOptions?.bubbleNode?.name?.());
    return typeof bubble === 'string' && bubble !== '' ? bubble : `Model ${seq}`;
  }

  function sync() {
    if (disposed) return;
    const models = safe(() => viewer.getAllModels(), []) ?? [];
    for (const model of models) {
      if (keyByModel.has(model)) continue;
      const urn = readUrn(model);
      if (urn === null) continue; // not identifiable yet; a later event/list() retries
      const seq = ++loadSeq;
      const modelKey = `${urn}#${seq}`;
      const guid = safe(() => model.getData()?.loadOptions?.bubbleNode?.guid?.());
      const modelVersion = typeof guid === 'string' && guid !== '' ? `urn:${urn}|guid:${guid}` : `urn:${urn}`;
      try {
        registry.register(modelKey, model, { modelVersion });
      } catch (e) {
        safeReport('register', e);
        continue;
      }
      keyByModel.set(model, modelKey);
      urnByKey.set(modelKey, urn);
      fallbackNameByKey.set(modelKey, deriveFallbackName(model, seq));
    }
  }

  function displayNameFor(modelKey) {
    if (!urnByKey.has(modelKey)) return null;
    return nameForUrn(urnByKey.get(modelKey)) ?? fallbackNameByKey.get(modelKey) ?? null;
  }

  function list() {
    sync();
    const models = safe(() => viewer.getAllModels(), []) ?? [];
    return models.map((model) => {
      const modelKey = keyByModel.get(model) ?? null;
      const urn = readUrn(model);
      const displayName = (modelKey !== null ? displayNameFor(modelKey) : null)
        ?? (urn !== null ? nameForUrn(urn) : null) ?? deriveFallbackName(model, '?');
      const loaded = safe(() => model.isLoadDone() === true, false) && !!safe(() => model.getInstanceTree());
      return { modelKey, displayName, model, loaded };
    });
  }

  function notify() {
    for (const cb of [...subscribers]) {
      try { cb(); } catch (e) { safeReport('onChange', e); }
    }
  }

  const handler = () => {
    if (disposed) return;
    try { sync(); } catch (e) { safeReport('sync', e); }
    notify();
  };
  const watched = [events.MODEL_ADDED, events.MODEL_REMOVED, events.GEOMETRY_LOADED, events.OBJECT_TREE_CREATED];
  for (const name of watched) viewer.addEventListener(name, handler);
  sync();

  return {
    list,
    displayNameFor,
    keyOfModel: (model) => (model !== null && typeof model === 'object' ? (keyByModel.get(model) ?? null) : null),
    onChange(cb) {
      if (typeof cb !== 'function') throw new TypeError('catalog.onChange: callback is required');
      subscribers.add(cb);
      return () => { subscribers.delete(cb); };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      subscribers.clear();
      for (const name of watched) safe(() => viewer.removeEventListener(name, handler));
    },
  };
}

/**
 * createClashPanelHost({ viewer, Autodesk?, THREE?, deps?, report? }) -> Promise<{ panel, engine, world, catalog,
 *   show, hide, toggle, isVisible, dispose(): Promise<void> }>
 * dispose(): panel (awaited) -> engine -> unload wiring -> catalog -> world. Every step runs even when an earlier one
 * fails; a single AggregateError is thrown afterwards. Idempotent (same promise).
 */
export async function createClashPanelHost({ viewer, Autodesk = globalThis.Autodesk, THREE = globalThis.THREE, deps = {}, report = () => {} } = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  const events = viewerEventNames(Autodesk);
  let world; let engine; let wiring; let catalog; let panel;
  const teardown = [];
  const run = async () => {
    const errors = [];
    for (const [label, fn] of teardown) {
      try { await fn(); } catch (e) { errors.push(e); try { report(`dispose:${label}`, e); } catch { /* ignore */ } }
    }
    if (errors.length > 0) throw new AggregateError(errors, `Clash Panel host teardown: ${errors.length} step(s) failed`);
  };
  try {
    world = await d.CollisionWorld.fromViewer(viewer, {});
    engine = d.createClashTestEngine({ world, enumerator: d.createViewerElementEnumerator() });
    wiring = d.wireModelUnload({ world, registry: engine.registry, eventTarget: viewer, eventName: events.BEFORE_MODEL_UNLOAD, report });
    catalog = createHostCatalog({ viewer, registry: engine.registry, events, report });
    panel = d.createClashPanel({
      Autodesk, viewer, THREE, engine, catalog,
      events: { BEFORE_MODEL_UNLOAD: events.BEFORE_MODEL_UNLOAD, MODEL_REMOVED: events.MODEL_REMOVED },
    });
  } catch (e) {
    // Partial construction: unwind what exists, in the same order, then surface the original failure.
    const partial = [
      ['panel', panel && (() => panel.dispose())],
      ['engine', engine && (() => engine.dispose())],
      ['wiring', wiring && (() => wiring.dispose())],
      ['catalog', catalog && (() => catalog.dispose())],
      ['world', world && (() => world.dispose())],
    ].filter(([, fn]) => fn);
    teardown.push(...partial);
    try { await run(); } catch { /* the construction error below is the one that matters */ }
    throw e;
  }
  teardown.push(
    ['panel', () => panel.dispose()],       // MUST complete before engine.dispose() (clashpanel/README.md)
    ['engine', () => engine.dispose()],
    ['wiring', () => wiring.dispose()],
    ['catalog', () => catalog.dispose()],
    ['world', () => world.dispose()],
  );
  let disposePromise = null;
  return {
    panel, engine, world, catalog,
    show: () => panel.show(),
    hide: () => panel.hide(),
    toggle: () => panel.toggle(),
    isVisible: () => panel.isVisible(),
    dispose() {
      if (!disposePromise) disposePromise = run();
      return disposePromise;
    },
  };
}
