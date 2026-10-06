// wwwroot/clashPanelDemo.js
//
// ?clashPanelDemo=1 helper: loads the two evidenced SVF2 Audubon fixtures (Structure, then Mechanical as a
// federated additional model) and tells the Clash Panel catalog their friendly names. Deliberately never
// touches the location hash (the hash identifies the PRIMARY model for share/reload; see main.js).
import { declareModelDisplayName } from './extensions/clashPanelNames.js';

// URNs copied by value from test/acceptance/clashpanel-viewerbridge.acceptance.mjs (MODEL_B / MODEL_A).
export const DEMO_MODELS = Object.freeze([
  Object.freeze({ name: 'Structure', urn: 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fU3RydWN0dXJlX2NsYXNoX3Rlc3QucnZ0' }),
  Object.freeze({ name: 'Mechanical', urn: 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fTWVjaGFuaWNhbF9jbGFzaF90ZXN0LnJ2dA' }),
]);

/** Resolves once `model` is load-complete AND its object tree exists (the catalog's `loaded` meaning). */
export function waitForModelReady(viewer, model, { geometryLoadedEvent = 'geometryLoaded', timeoutMs = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    let timer = null;
    let listening = false;
    const onGeometry = (ev) => { if (!ev?.model || ev.model === model) proceed(); };
    const cleanup = () => {
      if (timer !== null) clearTimeout(timer);
      if (listening) viewer.removeEventListener(geometryLoadedEvent, onGeometry);
    };
    const fail = (e) => { cleanup(); reject(e instanceof Error ? e : new Error(String(e))); };
    const treeThenDone = () => {
      model.getObjectTree((tree) => { if (tree) { cleanup(); resolve(model); } else fail('object tree unavailable'); }, () => fail('object tree failed to load'));
    };
    let started = false;
    function proceed() {
      if (started || !model.isLoadDone()) return;
      started = true;
      treeThenDone();
    }
    timer = setTimeout(() => fail(new Error('timed out waiting for model load / object tree')), timeoutMs);
    if (model.isLoadDone()) {
      proceed();
    } else {
      viewer.addEventListener(geometryLoadedEvent, onGeometry);
      listening = true;
    }
  });
}

/**
 * Loads DEMO_MODELS sequentially: the first with keepCurrentModels:false, every later one with true (federated).
 * Each is awaited including its object tree. Friendly names are declared before loading.
 */
export async function loadDemoModels(viewer, { loadModel, models = DEMO_MODELS, declareName = declareModelDisplayName, wait = waitForModelReady } = {}) {
  const loaded = [];
  for (let i = 0; i < models.length; i++) {
    const { name, urn } = models[i];
    declareName(urn, name);
    const model = await loadModel(viewer, urn, { keepCurrentModels: i > 0 });
    await wait(viewer, model);
    loaded.push({ name, urn, model });
  }
  return loaded;
}
