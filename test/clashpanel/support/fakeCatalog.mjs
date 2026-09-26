// test/clashpanel/support/fakeCatalog.mjs
// Host ModelCatalog double (spec 5.2). Mutators change state only; call `fire()` to notify (so a test controls the order
// of a Viewer event, a catalog change and a readiness change). Display names and model->key mappings OUTLIVE removal,
// exactly like the real host contract (rows for unloaded models still show a name).
export function createFakeCatalog({ models = [], basis = { state: 'verified', basisKey: 'fake-basis' }, omitMeasurementBasis = false } = {}) {
  const entries = [];
  const names = new Map();
  const keyByModel = new WeakMap();
  const listeners = new Set();
  const calls = { list: 0, displayNameFor: [], keyOfModel: 0, measurementBasis: [] };
  let basisSource = basis;

  const normalize = (e) => {
    const modelKey = e.modelKey ?? null;
    const displayName = e.displayName ?? (modelKey ?? 'Unnamed model');
    return { modelKey, displayName, model: e.model ?? { fakeModel: modelKey ?? displayName }, loaded: e.loaded ?? true };
  };
  const catalog = {
    calls,
    list() { calls.list += 1; return entries.map((e) => ({ ...e })); },
    displayNameFor(key) { calls.displayNameFor.push(key); return names.get(key) ?? null; },
    keyOfModel(model) { calls.keyOfModel += 1; return keyByModel.get(model) ?? null; },
    onChange(cb) {
      if (typeof cb !== 'function') throw new TypeError('catalog.onChange: callback must be a function');
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    listenerCount: () => listeners.size,
    /** Add (or replace, same modelKey = a reload with a new Model object) a model; returns its Model object. */
    addModel(entry) {
      const e = normalize(entry);
      const at = e.modelKey === null ? -1 : entries.findIndex((x) => x.modelKey === e.modelKey);
      if (at >= 0) entries[at] = e; else entries.push(e);
      if (e.modelKey !== null) { names.set(e.modelKey, e.displayName); keyByModel.set(e.model, e.modelKey); }
      return e.model;
    },
    removeModel(key) {
      const at = entries.findIndex((x) => x.modelKey === key);
      if (at >= 0) entries.splice(at, 1);
    },
    setLoaded(key, loaded) {
      const e = entries.find((x) => x.modelKey === key);
      if (!e) throw new Error(`fake catalog: no model ${key}`);
      e.loaded = Boolean(loaded);
    },
    modelOf: (key) => entries.find((x) => x.modelKey === key)?.model ?? null,
    setBasis(verdictOrFn) { basisSource = verdictOrFn; },
    fire() { for (const cb of [...listeners]) cb(); },
  };
  if (!omitMeasurementBasis) {
    catalog.measurementBasis = (keys) => {
      calls.measurementBasis.push([...keys]);
      return typeof basisSource === 'function' ? basisSource([...keys]) : basisSource;
    };
  }
  for (const m of models) catalog.addModel(m);
  return catalog;
}
