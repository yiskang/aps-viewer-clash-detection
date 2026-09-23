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
//
// Task P6.7 adds three things, all additive (support/index.mjs extension rule 1):
//  - `reload(modelKey)` / `setVersion(modelKey, version)`, the two remaining direct mutators
//    `getFreshness`'s own tests need (`notifyPlacementChanged` and `unregisterKey` already existed).
//  - `onSnapshot(n, fn)`, an INSTANCE METHOD that fires `fn` right before the Nth call to
//    `snapshotBindings` (1-based). This is a different thing from the constructor's `onSnapshot`
//    option above (a callback fired after every snapshot, used by runFixture.mjs for milestones);
//    the two coexist under different names in this closure (the option is bound to `onSnapshotAfter`
//    internally) so neither shadows the other.
//  - A SECOND calling convention: `createPlacementRegistry(sealedSet, { registrySessionId? })`,
//    where `sealedSet` is a `createSealedSetFixture(...)` result. This seeds the registry directly
//    from `sealedSet.provenance.models[]` (`modelKey`, `modelVersion`, `bindingGeneration`,
//    `placementGeneration` — the exact values a freshness test wants "sealed", not the `register()`
//    default of bindingGeneration 1 / placementGeneration 0) and defaults `registrySessionId` to
//    `sealedSet.provenance.registrySessionId` (overridable via the second argument, for the
//    cross-session tests). The ORIGINAL single-options-object call
//    (`createPlacementRegistry({ labelSnapshot, onSnapshot, ... })`, still used by runFixture.mjs)
//    is untouched: a first argument is only ever treated as a sealed set when it carries a
//    `.provenance` property, which a plain options object never does.
export function createPlacementRegistry(first = {}, second = {}) {
  const sealedSet = first !== null && typeof first === 'object' && first.provenance !== undefined
    ? first : null;
  const options = sealedSet ? second : first;
  const {
    registrySessionId = sealedSet ? sealedSet.provenance.registrySessionId : 'registry-session-1',
    models = sealedSet
      ? sealedSet.provenance.models.map((m) => ({
          modelKey: m.modelKey, modelVersion: m.modelVersion,
          bindingGeneration: m.bindingGeneration, placementGeneration: m.placementGeneration,
        }))
      : [],
    labelSnapshot = () => null,
    onSnapshot: onSnapshotAfter = () => {},
  } = options ?? {};
  const entries = new Map();                               // modelKey -> mutable entry
  const snapshotCalls = [];
  const admittedKeys = [];
  const snapshotHooks = new Map();                         // 1-based call number -> fn[]
  let registryRevision = 0;
  let leaseSeq = 0;
  let mutationAttempts = 0;
  let deadFlagReads = 0;                                   // Task P6.6
  let lastSnapshot = null;
  let snapshotCallCount = 0;

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

    /** `bindingGeneration`/`placementGeneration` are optional EXACT overrides (Task P6.7): a sealed
     *  fixture seeds a binding's generations directly, rather than through the default increment-
     *  from-existing / start-at-1-and-0 rule a live `register()` call uses. */
    register(modelKey, model = {}, { modelVersion = 'v1', bindingGeneration, placementGeneration } = {}) {
      const existing = entries.get(modelKey);
      entries.set(modelKey, {
        modelKey, model, modelVersion, lease: null, alive: true,
        bindingGeneration: bindingGeneration ?? (existing === undefined ? 1 : existing.bindingGeneration + 1),
        placementGeneration: placementGeneration ?? (existing?.placementGeneration ?? 0),
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

    /** Task P6.7: a reload — same content, `bindingGeneration` bumped (a fresh binding instance).
     *  The lease is cleared too (codex-review finding, P6.7 self-review): a reload is a genuinely
     *  new admission, so the next read re-admits lazily rather than handing back the pre-reload
     *  lease under a bumped generation. */
    reload(modelKey) {
      const entry = entries.get(modelKey);
      if (entry === undefined || !entry.alive) return;
      entry.bindingGeneration += 1;
      entry.lease = null;
      registryRevision += 1;
    },

    /** Task P6.7: a raw identity-contract violation, independent of `register`'s own conflict check
     *  (this simulates the host handing back a DIFFERENT version under the same key, which a real
     *  registry would normally refuse — freshness only needs to observe the resulting mismatch). */
    setVersion(modelKey, modelVersion) {
      const entry = entries.get(modelKey);
      if (entry === undefined) return;
      entry.modelVersion = modelVersion;
      registryRevision += 1;
    },

    /** Task P6.7: fire `fn` right before the Nth (1-based) call to `snapshotBindings`. */
    onSnapshot(n, fn) {
      const list = snapshotHooks.get(n) ?? [];
      list.push(fn);
      snapshotHooks.set(n, list);
    },

    bindingFor(modelKey) { return bindingOf(entries.get(modelKey)); },

    /** Whether `modelKey` has a live binding — WITHOUT taking a lease (a fixture's own setup read). */
    has(modelKey) { return entries.get(modelKey)?.alive === true; },

    snapshotBindings(modelKeys) {
      snapshotCallCount += 1;
      for (const fn of snapshotHooks.get(snapshotCallCount) ?? []) fn();     // Task P6.7, "right before"
      const keys = [...modelKeys];
      const snapshot = Object.freeze({
        registryRevision,
        bindings: Object.freeze(keys.map((k) => bindingOf(entries.get(k)))),
      });
      snapshotCalls.push(Object.freeze({ at: labelSnapshot(), keys }));
      lastSnapshot = snapshot;
      onSnapshotAfter(snapshot);
      return snapshot;
    },
  };
  for (const m of models) {
    registry.register(m.modelKey, m.model ?? {}, {
      modelVersion: m.modelVersion ?? 'v1',
      bindingGeneration: m.bindingGeneration,
      placementGeneration: m.placementGeneration,
    });
  }
  return registry;
}
