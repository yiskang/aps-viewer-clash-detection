// test/clashtest/support/placementRegistry.mjs
//
// P6's registry double (master plan A18 / File structure: P0's `createFakeRegistry` is a placeholder
// with no `placementGeneration` and no mutation hooks, so P6 ADDS this file — P0's fake is untouched).
// It speaks P1's A4 surface: `snapshotBindings(keys) -> Readonly<{registryRevision, bindings:
// ReadonlyArray<Binding|null>}>`, with `Binding = {modelKey, model, modelVersion, lease,
// bindingGeneration, placementGeneration}` and NO `dead` flag (N10: dead, unregistered and
// lease-invalid all read as `null`).
//
// Like P1's real registry, it takes a model's lease LAZILY on the first snapshot that touches it and
// caches it — but through its own lease counter, never through `world.admitModel`, so a test can
// prove that P6 itself runs no second admission loop (`world.calls.admitModel === 0`, R7).
//
// Every binding it hands out is FROZEN, and wrapped in a Proxy whose `set`/`defineProperty`/
// `deleteProperty` traps count the attempt (`mutationAttempts`) and refuse it — so a frozen binding
// still throws `TypeError` in strict code, and a test can also assert no write was even attempted.
//
// Task P6.4 builds what its lifecycle tests need (`register`, `unregisterKey`, `snapshotCalls`,
// `lastSnapshot`, `admittedKeys`, `mutationAttempts`, `notifyPlacementChanged`). Later P6 tasks
// extend it (`reload`, `setVersion`, `onSnapshot(n, fn)`, `deadFlagReads`, ...) under the extension
// rules in support/index.mjs.
//
// Task P6.6 adds `deadFlagReads`: the binding Proxy's `get` trap counts every read of a `dead`
// property (N10 — `Binding` has none, so a reader testing `binding.dead` is fail-OPEN). Every other
// read is forwarded unchanged.

export function createPlacementRegistry({
  registrySessionId = 'registry-session-1', models = [], labelSnapshot = () => null, onSnapshot = () => {},
} = {}) {
  const entries = new Map();                               // modelKey -> mutable entry
  const snapshotCalls = [];
  const admittedKeys = [];
  let registryRevision = 0;
  let leaseSeq = 0;
  let mutationAttempts = 0;
  let deadFlagReads = 0;                                   // Task P6.6
  let lastSnapshot = null;

  const guard = (binding) => new Proxy(binding, {
    get(target, prop, receiver) {
      if (prop === 'dead') deadFlagReads += 1;
      return Reflect.get(target, prop, receiver);
    },
    set() { mutationAttempts += 1; return false; },        // strict mode => TypeError, like a frozen object
    defineProperty() { mutationAttempts += 1; return false; },
    deleteProperty() { mutationAttempts += 1; return false; },
  });

  const bindingOf = (entry) => {
    if (entry === undefined || !entry.alive) return null;
    if (entry.lease === null) {                            // lazy admission, cached (P1 decision 2)
      leaseSeq += 1;
      entry.lease = Object.freeze({ leaseId: `lease-${leaseSeq}`, modelKey: entry.modelKey });
      admittedKeys.push(entry.modelKey);
    }
    return guard(Object.freeze({
      modelKey: entry.modelKey,
      model: entry.model,
      modelVersion: entry.modelVersion,
      lease: entry.lease,
      bindingGeneration: entry.bindingGeneration,
      placementGeneration: entry.placementGeneration,
    }));
  };

  const registry = {
    registrySessionId,
    get registryRevision() { return registryRevision; },
    get snapshotCalls() { return snapshotCalls; },
    get admittedKeys() { return admittedKeys; },
    get mutationAttempts() { return mutationAttempts; },
    get deadFlagReads() { return deadFlagReads; },
    get lastSnapshot() { return lastSnapshot; },

    register(modelKey, model = {}, { modelVersion = 'v1' } = {}) {
      const existing = entries.get(modelKey);
      entries.set(modelKey, {
        modelKey, model, modelVersion, lease: null, alive: true,
        bindingGeneration: existing === undefined ? 1 : existing.bindingGeneration + 1,
        placementGeneration: existing?.placementGeneration ?? 0,
      });
      registryRevision += 1;
    },

    /** Dead, unregistered and lease-invalid are all the same thing to a reader: `null`. */
    unregisterKey(modelKey) {
      const entry = entries.get(modelKey);
      if (entry === undefined || !entry.alive) return false;
      entry.alive = false;
      entry.lease = null;
      registryRevision += 1;
      return true;
    },

    notifyPlacementChanged(modelKey) {
      const entry = entries.get(modelKey);
      if (entry === undefined) return;
      entry.placementGeneration += 1;
      registryRevision += 1;
    },

    bindingFor(modelKey) { return bindingOf(entries.get(modelKey)); },

    /** Whether `modelKey` has a live binding — WITHOUT taking a lease (a fixture's own setup read). */
    has(modelKey) { return entries.get(modelKey)?.alive === true; },

    snapshotBindings(modelKeys) {
      const keys = [...modelKeys];
      const snapshot = Object.freeze({
        registryRevision,
        bindings: Object.freeze(keys.map((k) => bindingOf(entries.get(k)))),
      });
      snapshotCalls.push(Object.freeze({ at: labelSnapshot(), keys }));
      lastSnapshot = snapshot;
      onSnapshot(snapshot);
      return snapshot;
    },
  };
  for (const m of models) registry.register(m.modelKey, m.model ?? {}, { modelVersion: m.modelVersion ?? 'v1' });
  return registry;
}
