// clashtest/identity/ModelRegistry.js
//
// World-scoped runtime binding table: modelKey -> live Model (+ lease, generations). Spec §4.2, §4.3, §16.2.
// Runtime only: a Binding is never persisted (spec §4.1). Imports only ../errors.js; touches the world
// through admitModel / isLeaseValid / invalidateModelPlacement and nothing `_`-prefixed (spec F5).
import { ModelBindingError, ModelKeyVersionConflictError } from '../errors.js';

export const BINDING_REASONS = Object.freeze({
  INVALID_WORLD: 'invalid-world',
  INVALID_MODEL_KEY: 'invalid-model-key',
  INVALID_MODEL: 'invalid-model',
  MISSING_MODEL_VERSION: 'missing-model-version',
  MODEL_BOUND_TO_OTHER_KEY: 'model-bound-to-other-key',
  KEY_BOUND_TO_OTHER_MODEL: 'key-bound-to-other-model',
  MODEL_NOT_BOUND: 'model-not-bound',
  REGISTRY_MISMATCH: 'registry-mismatch',
});

const WORLD_METHODS = ['admitModel', 'isLeaseValid', 'invalidateModelPlacement'];

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;
const isModelObject = (v) => (typeof v === 'object' && v !== null) || typeof v === 'function';

function defaultMakeSessionId() {
  const crypto = globalThis.crypto;
  if (typeof crypto?.getRandomValues !== 'function') {
    throw new TypeError('crypto.getRandomValues is unavailable; inject makeSessionId');
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `regsess-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export class ModelRegistry {
  #world;
  #sessionId;
  #revision = 0;
  /** @type {Map<string, {modelKey: string, model: object|null, modelVersion: string, lease: object|null,
   *   bindingGeneration: number, placementGeneration: number, alive: boolean}>} */
  #entries = new Map();
  /** live Model -> modelKey (entry removed the moment the binding dies) */
  #keyByModel = new WeakMap();
  /** modelKey -> first modelVersion ever registered; survives unregister for the registry's lifetime (§4.2) */
  #firstSeenVersion = new Map();

  constructor({ world, makeSessionId = defaultMakeSessionId } = {}) {
    for (const method of WORLD_METHODS) {
      if (typeof world?.[method] !== 'function') {
        throw new ModelBindingError({ reason: BINDING_REASONS.INVALID_WORLD, message: `world lacks ${method}()` });
      }
    }
    const sessionId = makeSessionId();
    if (!isNonEmptyString(sessionId)) throw new TypeError('makeSessionId must return a non-empty string');
    this.#world = world;
    this.#sessionId = sessionId;
  }

  get world() { return this.#world; }
  get registrySessionId() { return this.#sessionId; }
  get registryRevision() { return this.#revision; }

  /**
   * Spec §4.2/§4.3. Order of checks (fixed, so the error a caller sees is deterministic):
   * argument shape -> version conflict -> model bound to another key -> key bound to another live model.
   * Every check happens before any mutation, so a rejected call changes nothing.
   */
  register(modelKey, model, options) {
    if (!isNonEmptyString(modelKey)) throw new ModelBindingError({ reason: BINDING_REASONS.INVALID_MODEL_KEY });
    if (!isModelObject(model)) throw new ModelBindingError({ reason: BINDING_REASONS.INVALID_MODEL, modelKey });
    const modelVersion = options?.modelVersion;
    if (!isNonEmptyString(modelVersion)) {
      throw new ModelBindingError({ reason: BINDING_REASONS.MISSING_MODEL_VERSION, modelKey });
    }

    const seen = this.#firstSeenVersion.get(modelKey);
    if (seen !== undefined && seen !== modelVersion) {
      throw new ModelKeyVersionConflictError({ modelKey, existingVersion: seen, offeredVersion: modelVersion });
    }
    const boundKey = this.#keyByModel.get(model);
    if (boundKey !== undefined && boundKey !== modelKey) {
      throw new ModelBindingError({
        reason: BINDING_REASONS.MODEL_BOUND_TO_OTHER_KEY, modelKey, message: `model is already bound to ${boundKey}`,
      });
    }
    const entry = this.#entries.get(modelKey);
    if (entry?.alive) {
      if (entry.model === model) return; // idempotent: same (key, model, version)
      throw new ModelBindingError({ reason: BINDING_REASONS.KEY_BOUND_TO_OTHER_MODEL, modelKey });
    }

    // ---- commit (nothing below can throw) ----
    if (entry === undefined) {
      this.#entries.set(modelKey, {
        modelKey, model, modelVersion, lease: null, bindingGeneration: 1, placementGeneration: 0, alive: true,
      });
    } else {
      entry.model = model;
      entry.modelVersion = modelVersion;
      entry.lease = null;
      entry.bindingGeneration += 1; // any revival of a known key is a new binding generation
      entry.alive = true;
    }
    if (seen === undefined) this.#firstSeenVersion.set(modelKey, modelVersion);
    this.#keyByModel.set(model, modelKey);
    this.#revision += 1;
  }

  /**
   * Runs inside BEFORE_MODEL_UNLOAD_EVENT: never throws, never awaits (spec §16.6). Marks the binding dead
   * only if its current Model is this exact object.
   * @returns {boolean} true iff a live binding for exactly this object was marked dead
   */
  unregister(model) {
    try {
      const key = this.#keyByModel.get(model);
      if (key === undefined) return false;
      const entry = this.#entries.get(key);
      if (entry === undefined || !entry.alive || entry.model !== model) return false;
      entry.alive = false;
      entry.model = null; // do not retain a dead Model
      entry.lease = null;
      this.#keyByModel.delete(model);
      this.#revision += 1;
      return true;
    } catch {
      return false;
    }
  }

  /** Key of the live binding for exactly this object, else null. Total. */
  keyOf(model) {
    try {
      const key = this.#keyByModel.get(model);
      if (key === undefined) return null;
      const entry = this.#entries.get(key);
      return entry?.alive && entry.model === model ? key : null;
    } catch {
      return null;
    }
  }

  /** @returns {object|null} null = no live binding with a currently valid lease (design decisions 1, 2). */
  bindingFor(modelKey) {
    return this.#read([modelKey]).bindings[0];
  }

  /**
   * ONE synchronous, all-or-nothing read of every listed key (spec §4.3, R13-6). The key list is copied
   * FIRST (the only place caller code can run); after that no caller code runs, so nothing can mutate the
   * registry between reads. The result is exactly the registry state at `registryRevision`; a world
   * callback firing during lease resolution can at worst downgrade a binding to null (fail closed).
   * @param {Iterable<string>} modelKeys
   */
  snapshotBindings(modelKeys) {
    return this.#read(Array.from(modelKeys));
  }

  /** True iff the registry's current live binding for `binding.modelKey` is equivalent to `binding`. */
  isBindingCurrent(binding) {
    try {
      if (typeof binding !== 'object' || binding === null) return false;
      const current = this.bindingFor(binding.modelKey);
      return current !== null && bindingsEquivalent(binding, current);
    } catch {
      return false;
    }
  }
  /**
   * Host-facing half of spec §16.2 for a host that called world.invalidateModelPlacement directly.
   * Unlike unregister this is an ordinary call and may throw for an unbound key.
   * @returns {number} the new placementGeneration
   */
  notifyPlacementChanged(modelKey) {
    const entry = this.#entries.get(modelKey);
    if (entry === undefined || !entry.alive) throw new ModelBindingError({ reason: BINDING_REASONS.MODEL_NOT_BOUND, modelKey });
    entry.placementGeneration += 1;
    this.#revision += 1;
    return entry.placementGeneration;
  }

  /**
   * The recommended single call (spec §16.2): both halves cannot be forgotten independently. The generation
   * is bumped FIRST, so even if the world call throws (evicted model, disposed world) the run-visible change
   * is recorded — over-invalidation is the fail-closed direction.
   * @returns {number} the new placementGeneration
   */
  invalidateModelPlacement(modelKey) {
    const generation = this.notifyPlacementChanged(modelKey);
    this.#world.invalidateModelPlacement(this.#entries.get(modelKey).model);
    return generation;
  }

  /**
   * The single atomic reader behind bindingFor / snapshotBindings. `keys` is an already-copied array.
   * Phase 1 reads registry state only (synchronous, no world call, no user code); phase 2 resolves leases.
   */
  #read(keys) {
    const registryRevision = this.#revision;
    const byKey = new Map(); // phase 1 is synchronous, so every duplicate of a key captures the very same values
    const captured = keys.map((key) => {
      const entry = typeof key === 'string' ? this.#entries.get(key) : undefined;
      if (entry === undefined || !entry.alive) return null;
      if (byKey.has(key)) return byKey.get(key);
      const capture = {
        entry,
        modelKey: entry.modelKey,
        model: entry.model,
        modelVersion: entry.modelVersion,
        lease: entry.lease,
        bindingGeneration: entry.bindingGeneration,
        placementGeneration: entry.placementGeneration,
      };
      byKey.set(key, capture);
      return capture;
    });
    // Resolve each captured binding ONCE and scatter the result to its duplicate positions: a world callback that
    // mutates the registry mid-read must not make a duplicate re-admit the captured Model or carry another lease.
    const resolved = new Map();
    const bindings = captured.map((c) => {
      if (c === null) return null;
      if (!resolved.has(c)) resolved.set(c, this.#resolveLease(c));
      return resolved.get(c);
    });
    return Object.freeze({ registryRevision, bindings: Object.freeze(bindings) });
  }

  #resolveLease(c) {
    let lease = c.lease;
    // an earlier duplicate of this key in the SAME read may already have admitted (and cached) the lease
    if (lease === null && c.entry.alive && c.entry.model === c.model) lease = c.entry.lease;
    try {
      if (lease === null) {
        lease = this.#world.admitModel(c.model); // lazy (spec §4.3); throws for an evicted model / disposed world
        if (c.entry.alive && c.entry.model === c.model && c.entry.lease === null) c.entry.lease = lease;
      }
      if (!this.#world.isLeaseValid(lease)) return null;
    } catch {
      return null; // fail closed: an unleasable model is an unbound model
    }
    return Object.freeze({
      modelKey: c.modelKey,
      model: c.model,
      modelVersion: c.modelVersion,
      lease,
      bindingGeneration: c.bindingGeneration,
      placementGeneration: c.placementGeneration,
    });
  }
}

/**
 * The §18 public factory (reconciliation N11): what `clashtest/index.js` re-exports and what P6's coordinator
 * calls as its `createRegistry` default. `world` is REQUIRED (an absent/invalid one throws
 * ModelBindingError{reason:'invalid-world'} from the constructor); there is no `now` option.
 */
export function createModelRegistry(options) {
  return new ModelRegistry(options);
}

const isBindingShaped = (b) => typeof b === 'object' && b !== null
  && typeof b.modelKey === 'string' && b.modelKey !== ''
  && typeof b.model === 'object' && b.model !== null
  && typeof b.modelVersion === 'string' && b.modelVersion !== ''
  && Number.isSafeInteger(b.bindingGeneration) && b.bindingGeneration >= 0
  && Number.isSafeInteger(b.placementGeneration) && b.placementGeneration >= 0;

/**
 * Equality used by freshness brackets (spec §16.4): both `null`, or two well-formed Bindings with the same key, the
 * same Model OBJECT, the same version and both generations. The lease is deliberately not compared.
 * FAIL CLOSED: anything that is not `null` or a well-formed Binding (undefined from an out-of-range snapshot index,
 * `{}`, a throwing Proxy, a foreign registry's malformed value) is never "equivalent" — not even to itself.
 */
export function bindingsEquivalent(a, b) {
  try {
    if (a === null && b === null) return true;
    if (!isBindingShaped(a) || !isBindingShaped(b)) return false;
    return a.modelKey === b.modelKey
      && a.model === b.model
      && a.modelVersion === b.modelVersion
      && a.bindingGeneration === b.bindingGeneration
      && a.placementGeneration === b.placementGeneration;
  } catch {
    return false;
  }
}

// The registry surface later phases consume from an asserted registry (P6 coordinator, P7 engine).
const REGISTRY_METHODS = [
  'register', 'unregister', 'keyOf', 'bindingFor', 'snapshotBindings', 'isBindingCurrent',
  'notifyPlacementChanged', 'invalidateModelPlacement',
];

/**
 * True iff `registry` is a registry built for exactly `world`. Duck-typed on purpose: a duplicate module copy
 * on the same page (spec §7.3) produces registries that fail `instanceof` but must still be recognized. The whole
 * consumed surface is checked (methods, a non-empty string `registrySessionId`, a non-negative integer
 * `registryRevision`, and the identical `world`); read-only-ness cannot be proven by duck typing and stays an
 * interface obligation. A structural probe that throws (e.g. a hostile Proxy) is a mismatch, never an escape.
 * P6's coordinator owns the world -> registry map and the final `registry !== coordinator.registry` check.
 * @throws {ModelBindingError} reason 'registry-mismatch'
 */
export function assertRegistryBelongsToWorld(registry, world) {
  let ok = false;
  try {
    ok = typeof registry === 'object' && registry !== null
      && REGISTRY_METHODS.every((m) => typeof registry[m] === 'function')
      && typeof registry.registrySessionId === 'string' && registry.registrySessionId !== ''
      && Number.isSafeInteger(registry.registryRevision) && registry.registryRevision >= 0
      && registry.world === world;
  } catch {
    ok = false;
  }
  if (!ok) throw new ModelBindingError({ reason: BINDING_REASONS.REGISTRY_MISMATCH });
  return registry;
}
