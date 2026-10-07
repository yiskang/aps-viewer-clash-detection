// wwwroot/extensions/clashPanelHost.js
//
// Host composition for the Viewer Clash Panel (gate H1): builds the collision world, the clash-test engine
// with the Viewer element enumerator, the model-unload wiring and the read-only ModelCatalog, then the Panel
// itself, and owns the teardown. See clashpanel/README.md ("Ports the host must supply").
//
// INTERIM IDENTITY POLICY, used by the normal app and the demo alike (OQ-1 is NOT closed; this does not satisfy G-VA-OQ1): modelKey = `${urn}#${loadSeq}`
// with a per-page counter that is never reused, plus a URN-derived modelVersion witness. Results are therefore
// non-resumable across a reload, by design (panel spec 11.1 / OD-8). No measurementBasis is supplied
// (omitted == unverified: Soft needs a user-supplied basis for multi-model tests, spec §23; Hard is unaffected).
import { CollisionWorld } from '../../collision/index.js';
import { createClashTestEngine } from '../../clashtest/index.js';
import { createViewerElementEnumerator, wireModelUnload } from '../../clashtest/viewer/index.js';
import { createClashPanel } from '../../clashpanel/index.js';

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

/**
 * L6: crypto.randomUUID exists only in secure contexts (https/localhost); plain-HTTP LAN origins lack it. The engine and
 * panel controller call globalThis.crypto.randomUUID() directly, so install a fallback only when it is missing.
 */
export function makeFallbackUuid(c = globalThis.crypto) {
  let counter = 0;
  const hex = (n) => n.toString(16).padStart(2, '0');
  return () => {
    const b = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
    else { let t = Date.now() + (++counter); for (let i = 0; i < 16; i++) { b[i] = (Math.random() * 256) ^ (t & 255); t = Math.floor(t / 7) + counter; } }
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, hex).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
}

export function ensureRandomUUID(g = globalThis) {
  try {
    if (!g.crypto) { g.crypto = {}; }
    if (typeof g.crypto.randomUUID !== 'function') g.crypto.randomUUID = makeFallbackUuid(g.crypto);
  } catch { /* read-only crypto: nothing more we can do */ }
}

/** 'urn:abc' and 'abc' name the same model: loadModel() prepends 'urn:', model.getData().urn carries it. */
export function normalizeUrnKey(urn) {
  if (typeof urn !== 'string') return '';
  const t = urn.trim();
  return t.startsWith('urn:') ? t.slice(4) : t;
}

function cleanLabel(v) {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** Strips one trailing file extension ("a.b.rvt" -> "a.b"); a leading-dot-only name is left alone. */
function stripExtension(name) {
  const stripped = name.replace(/\.[A-Za-z0-9]{1,8}$/, '');
  return stripped !== '' ? stripped : name;
}

/**
 * Metadata-driven display name, shared by the demo and the normal app. Priority:
 *  (a) name of the nearest ancestor of loadOptions.bubbleNode whose data.role === 'viewable' (the source file,
 *      e.g. "Audubon_Structure_clash_test.rvt"), trailing extension stripped;
 *  (b) the bubbleNode's own name();
 *  (c) optional host-supplied fixture fallback label;
 *  (d) `Model <seq>`.
 * Display only: identity is NEVER inferred from this name (see modelKey in createHostCatalog).
 */
export function resolveModelDisplayName(model, seq, { fallbackLabel = null } = {}) {
  const bubble = safe(() => model.getData()?.loadOptions?.bubbleNode);
  if (bubble) {
    let node = safe(() => bubble.parent);
    for (let i = 0; node && i < 64; i++) {
      const role = safe(() => node.data?.role);
      if (role === 'viewable') {
        const n = cleanLabel(safe(() => node.name()));
        if (n !== null) return stripExtension(n);
        break;
      }
      node = safe(() => node.parent);
    }
    const own = cleanLabel(safe(() => bubble.name()));
    if (own !== null) return own;
  }
  return cleanLabel(fallbackLabel) ?? `Model ${seq}`;
}

function readUrn(model) {
  const urn = safe(() => model.getData()?.urn);
  return typeof urn === 'string' && urn !== '' ? urn : null;
}

/**
 * Read-only ModelCatalog (clashpanel/README.md). Registers each model it sees with the engine registry
 * (interim OQ-1 policy above). `loaded` == load complete AND object tree available.
 */
export function createHostCatalog({ viewer, registry, events, fallbackLabel = null, report = () => {} }) {
  const keyByModel = new WeakMap();      // survives unload/unregister (README: keyOfModel)
  const urnByKey = new Map();            // strings only; survives unload (README: displayNameFor)
  const nameByKey = new Map();           // display names resolved once at registration; survive unload
  const failedModels = new WeakSet();   // L3: a model whose registration threw is not retried (warn once)
  const subscribers = new Set();
  let loadSeq = 0;
  let disposed = false;

  const safeReport = (stage, e) => { try { report(stage, e); } catch { /* host callback must not break the catalog */ } };

  function deriveName(model, seq) {
    return resolveModelDisplayName(model, seq, { fallbackLabel });
  }

  function sync() {
    if (disposed) return;
    const models = safe(() => viewer.getAllModels(), []) ?? [];
    for (const model of models) {
      if (keyByModel.has(model) || failedModels.has(model)) continue;
      const urn = readUrn(model);
      if (urn === null) continue; // not identifiable yet; a later event/list() retries
      const seq = ++loadSeq;
      // Identity: one key per loaded Model OBJECT (WeakMap below), never reused. The same URN loaded twice
      // therefore gets two distinct keys; display names (which may collide) are never used as identity.
      const modelKey = `${urn}#${seq}`;
      const guid = safe(() => model.getData()?.loadOptions?.bubbleNode?.guid?.());
      const modelVersion = typeof guid === 'string' && guid !== '' ? `urn:${normalizeUrnKey(urn)}|guid:${guid}` : `urn:${normalizeUrnKey(urn)}`;
      try {
        registry.register(modelKey, model, { modelVersion });
      } catch (e) {
        failedModels.add(model);
        safeReport('register', e);
        continue;
      }
      keyByModel.set(model, modelKey);
      urnByKey.set(modelKey, urn);
      nameByKey.set(modelKey, deriveName(model, seq));
    }
  }

  function displayNameFor(modelKey) {
    if (!urnByKey.has(modelKey)) return null;
    return nameByKey.get(modelKey) ?? null;
  }

  function list() {
    sync();
    const models = safe(() => viewer.getAllModels(), []) ?? [];
    return models.map((model) => {
      const modelKey = keyByModel.get(model) ?? null;
      const displayName = (modelKey !== null ? displayNameFor(modelKey) : null) ?? deriveName(model, '?');
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
 * dispose(): catalog (listeners off first) -> panel (awaited) -> engine -> unload wiring -> world. Every step runs even when an earlier one
 * fails; a single AggregateError is thrown afterwards. Idempotent (same promise).
 */
export async function createClashPanelHost({ viewer, Autodesk = globalThis.Autodesk, THREE = globalThis.THREE, deps = {}, report = () => {} } = {}) {
  ensureRandomUUID();
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
      ['catalog', catalog && (() => catalog.dispose())],
      ['panel', panel && (() => panel.dispose())],
      ['engine', engine && (() => engine.dispose())],
      ['wiring', wiring && (() => wiring.dispose())],
      ['world', world && (() => world.dispose())],
    ].filter(([, fn]) => fn);
    teardown.push(...partial);
    try { await run(); } catch { /* the construction error below is the one that matters */ }
    throw e;
  }
  teardown.push(
    ['catalog', () => catalog.dispose()],   // L4: stop catalog events first, before engine disposal begins
    ['panel', () => panel.dispose()],       // MUST complete before engine.dispose() (clashpanel/README.md)
    ['engine', () => engine.dispose()],
    ['wiring', () => wiring.dispose()],
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
