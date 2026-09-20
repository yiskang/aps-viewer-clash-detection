# Identity: `ModelRegistry`, `ElementRef`, `PairId`, `ResultId` — Phase P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Read the master first, then only this file.

**Goal:** Build the two identity modules the rest of the core stands on: (1) `clashtest/identity/ids.js`, the *pure* durable-identity functions — `ElementRef`, element order, `PairId` canonicalization (symmetric vs ordered, derived from `mode`), and `ResultId` = `(testId, semanticDigest, PairId)` with its canonical string form; and (2) `clashtest/identity/ModelRegistry.js`, the world-scoped runtime binding table `modelKey → live Model` (+ lease, `bindingGeneration`, `placementGeneration`), the atomic `snapshotBindings` read, the registry-side `modelKey → modelVersion` first-seen guard, `registrySessionId`, and the `invalidateModelPlacement` / `notifyPlacementChanged` pair. Nothing durable ever contains a `Model`, `loadEpoch`, `modelId`, `fragmentId` or `geometryIndex`; the runtime identities exist only inside a `Binding`.

Master: ../2026-09-20-federated-clash-test-core-engine-implementation.md

## Global Constraints

This phase inherits the master's Global Constraints, plus these phase-specific ones copied from the spec:

- **Identity contract (spec §4.2, binding):** "a `modelKey` names one immutable model version — one source document *and* one specific translation/content state — for all time." `modelKey`: non-empty string, host-supplied, opaque, compared by exact code-unit equality, total order by code-unit comparison; the engine never derives, parses or normalizes it. `modelVersion` (**mandatory**): non-empty opaque string; recorded and compared for exact equality only.
- **`ModelRegistry.register` enforcement (spec §4.2 item 1):** keeps a `firstSeenVersion` per `modelKey` for the registry's lifetime (surviving `unregister`); a different `modelVersion` throws `ModelKeyVersionConflictError{modelKey, existingVersion, offeredVersion}`; a missing/empty `modelVersion` throws `ModelBindingError`.
- **`snapshotBindings` (spec §4.3, R13-6):** "ONE synchronous, all-or-nothing read of every listed key (no await inside, no callback that can mutate the registry)"; `registryRevision` is a counter bumped by every register/unregister/notifyPlacementChanged.
- **`unregister` handler safety (spec §4.3, §16.6):** "must never throw" and never `await` (it runs inside `BEFORE_MODEL_UNLOAD_EVENT`); it marks a binding dead **only if** the binding's current `Model` is the exact object being unregistered (object identity, never `modelKey` alone).
- **One live Model ↔ one modelKey (spec §4.3):** violations reject at `register` with a typed error.
- **`ElementRef` is closed (spec §4.4, §13.6):** exactly `{modelKey, dbId}`; `dbId` a non-negative safe integer. Element order: `modelKey` by code-unit order, then `dbId` numerically.
- **`PairId` (spec §4.4):** unordered modes (`volume-overlap`, `surface-intersection`, `clearance`): `first` is the lesser ref in element order, `second` the greater, `first ≠ second`; ordered mode (`containment`): `first` = contained (library *source*), `second` = container (library *target*), never reordered. `pairSemantics` is derived from `mode`, never a definition field (spec §4.5).
- **`ResultId` (spec §4.4):** canonical string form `JSON.stringify([testId, semanticDigest, first.modelKey, first.dbId, second.modelKey, second.dbId])`.
- **Public-surface-only:** the registry uses exactly `world.admitModel`, `world.isLeaseValid` and `world.invalidateModelPlacement` (spec F5, §16.2) and nothing `_`-prefixed.

## Phase interface summary

Everything other phases may rely on. Paths repo-relative. Types are JSDoc-level; all returned identity values are frozen plain data (`ElementRef`, `PairId`) or frozen runtime snapshots (`Binding`).

```js
/** @typedef {{ modelKey: string, dbId: number }} ElementRef      closed; frozen; JSON/structured-clone safe */
/** @typedef {{ first: ElementRef, second: ElementRef }} PairId   closed; frozen */
/** @typedef {{ modelKey: string, model: object, modelVersion: string, lease: {model: object, epoch: number},
 *              bindingGeneration: number, placementGeneration: number }} Binding   runtime only, frozen, NEVER persisted.
 *   There is NO `dead` field (reconciliation N10): dead, unregistered, evicted and lease-invalid all read as `null`. */
```

**Binding guarantees (conformance pass; P6 and P4 rely on each line).**
1. **Every non-`null` `Binding` returned by `bindingFor` / `snapshotBindings` was lease-valid at the moment of that read** (`world.isLeaseValid(binding.lease) === true`) and carries the registry's **cached** lease — the *same* lease object on every later read while the binding lives. `world.admitModel` is called **at most once per live binding**, lazily on its first read. **A consumer must not call `world.admitModel` again to "obtain" a lease** (P6's run-start sweep reads `binding.lease` off the snapshot; a second admission would duplicate what §4.3's atomic read already provides, and a `Binding` is frozen — it cannot be assigned a replacement lease).
2. **`bindingFor` / `snapshotBindings` never return a dead binding**: dead, unregistered, world-evicted and lease-invalid all read as `null` (design decision 1).
3. **There is no `dead` flag and no `alive` flag on a `Binding` (reconciliation N10).** Absence *is* the signal: a dead, unregistered, world-evicted or lease-invalid binding is represented **only** by `null` in `bindingFor` / the positional `snapshotBindings(...).bindings` array, which is fail-closed by construction (a consumer that forgets to test cannot mistake `null` for a live binding). A holder of an old `Binding` asks `registry.isBindingCurrent(binding)` (or compares with `bindingsEquivalent` against a fresh read). A test pins `'dead' in binding === false`.

| Name | Module | Signature | Meaning |
|---|---|---|---|
| `CLASH_MODES` | `clashtest/identity/ids.js` | `readonly ['volume-overlap','surface-intersection','containment','clearance']` | The four modes; sole code home of the mode list (P2's validator imports it). |
| `pairSemanticsOf` | ids.js | `(mode) → 'ordered'\|'unordered'` | Spec §4.5: `containment → ordered`, all others `unordered`; unknown mode throws `TypeError`. |
| `sameSemanticsClass` | ids.js | `(modeA, modeB) → boolean` | True iff both modes share a pair-semantics class (the §4.4 / §15.4 join-key precondition). |
| `isValidModelKey` / `isValidDbId` | ids.js | `(v) → boolean` | Non-empty string / non-negative safe integer. |
| `makeElementRef` | ids.js | `(modelKey, dbId) → ElementRef` | Validating constructor; `-0` normalized to `0`; throws `TypeError`. |
| `elementRefFrom` | ids.js | `(obj) → ElementRef` | Copies **exactly** `modelKey`/`dbId` from any object; drops every other property (no runtime identity leaks). |
| `elementRefKey` | ids.js | `(ref) → string` (throws `TypeError` for an invalid ref) | **Added by reconciliation (row N12); implemented and tested in P1.1.** Injective string key for a `Map`/`Set` of `ElementRef`s, and **order-preserving**: for valid refs `a`, `b`, `elementRefKey(a) < elementRefKey(b)` (JS string `<`) ⇔ `compareElementRefs(a, b) < 0`, so a consumer may sort by key. Encoding: `modelKey` with every U+0000 doubled to `U+0000 U+0001`, then the terminator `U+0000 U+0000`, then `dbId` as exactly 16 zero-padded decimal digits. The escape makes the terminator unambiguous for **any** `modelKey`, including one containing `:`, `,`, quotes, brackets or NUL. The master §2 map assigns "ElementRef key" to this module; P5 (`results/status.js`) consumes it and P8 needs no other key encoding. |
| `compareModelKeys` | ids.js | `(a, b) → -1\|0\|1` | UTF-16 code-unit order (never `localeCompare`, never code-point order). |
| `compareElementRefs` | ids.js | `(a, b) → -1\|0\|1` | Element order: `modelKey` then `dbId` numeric. Non-validating hot-path comparator. |
| `makePairId` | ids.js | `(mode, x, y) → PairId` | Unordered modes sort `(x,y)`; `containment` keeps `x` = contained/source, `y` = container/target. Equal refs throw `RangeError`. |
| `comparePairIds` | ids.js | `(p, q) → -1\|0\|1` | Spec §11.3 canonical result order: `first` then `second` by element order. |
| `isSemanticDigest` / `SEMANTIC_DIGEST_PATTERN` | ids.js | `(v) → boolean` / `/^sha256:[0-9a-f]{64}$/` | The §5.4 digest string format (the digest itself is computed by P0 `util/canonical.js` + P2 `normalize.js`). |
| `makeResultId` | ids.js | `(testId, semanticDigest, pairId) → string` | Canonical `ResultId` string (arity 3: no revision, run, epoch or model input can enter). |
| `parseResultId` | ids.js | `(text) → {testId, semanticDigest, pairId} \| null` | Inverse; `null` for anything not byte-identical to a canonical `makeResultId` output. |
| `BINDING_REASONS` | `clashtest/identity/ModelRegistry.js` | frozen `{INVALID_WORLD, INVALID_MODEL_KEY, INVALID_MODEL, MISSING_MODEL_VERSION, MODEL_BOUND_TO_OTHER_KEY, KEY_BOUND_TO_OTHER_MODEL, MODEL_NOT_BOUND, REGISTRY_MISMATCH}` → kebab-case strings | The `reason` carried by every `ModelBindingError` this phase throws (`'registry-mismatch'` is spec-literal; `'coordinator-version-mismatch'` is P6's). |
| `ModelRegistry` | ModelRegistry.js | `new ModelRegistry({ world, makeSessionId? })` | World-scoped binding table. Exactly one per world (created by P6's coordinator, §4.3). |
| `createModelRegistry` | ModelRegistry.js | `({ world, makeSessionId? }) → ModelRegistry` | **Added by reconciliation (row N11); implemented and tested in P1.5.** One-line factory over the class (`new ModelRegistry(options)`; a missing/invalid `world` throws `ModelBindingError{reason:'invalid-world'}`). It is the §18 *public* name that `clashtest/index.js` re-exports (P7) and that P6's coordinator calls as its `createRegistry` default. `world` is **required** — the registry cannot exist without one; P6's assumption A5 (`createModelRegistry({now?})`) was wrong and is corrected there. |
| `registry.world` | ModelRegistry.js | `readonly CollisionWorld` | The world this registry was built for. |
| `registry.registrySessionId` | ModelRegistry.js | `readonly string` | Nonce fixed for the registry's lifetime (spec §16.4). |
| `registry.registryRevision` | ModelRegistry.js | `readonly number` (starts `0`) | Bumped by every *effective* register / unregister / placement notification. |
| `registry.register` | ModelRegistry.js | `(modelKey, model, { modelVersion }) → void` | §4.2/§4.3; idempotent for the same `(key, model, version)`; typed errors otherwise. Atomic: a rejected call changes nothing. |
| `registry.unregister` | ModelRegistry.js | `(model) → boolean` | **Never throws, never awaits.** `true` iff a live binding for exactly this object was marked dead. |
| `registry.keyOf` | ModelRegistry.js | `(model) → modelKey \| null` | Key of the live binding for exactly this object; total (never throws). |
| `registry.bindingFor` | ModelRegistry.js | `(modelKey) → Binding \| null` | `null` = **no live binding with a valid lease** (never registered, unregistered, or world says evicted/disposed). A non-`null` result satisfies *Binding guarantees* 1–3 above. |
| `registry.snapshotBindings` | ModelRegistry.js | `(modelKeys: Iterable<string>) → Readonly<{ registryRevision: number, bindings: ReadonlyArray<Binding\|null> }>` | The atomic multi-key read (§5.2 snapshot boundary, §16.4 brackets). Positions match input; duplicates allowed. **Every non-`null` entry is a frozen `Binding` whose cached `lease` is valid as of this read** (*Binding guarantees* 1) — the consumer neither admits nor re-leases. The result is an **array aligned to the input**, not a `Map` keyed by `modelKey`. |
| `registry.isBindingCurrent` | ModelRegistry.js | `(binding) → boolean` | True iff the registry's current live binding for `binding.modelKey` is `bindingsEquivalent` to `binding`. |
| `bindingsEquivalent` | ModelRegistry.js | `(a: Binding\|null, b: Binding\|null) → boolean` | Equal iff both `null`, or same `modelKey`, same `model` **object**, same `modelVersion`, `bindingGeneration`, `placementGeneration`. Lease not compared. The comparison P6's three-snapshot freshness loop uses. |
| `registry.notifyPlacementChanged` | ModelRegistry.js | `(modelKey) → number` | Host-facing half of §16.2: `placementGeneration += 1`, returns the new value; unbound key throws `ModelBindingError{reason:'model-not-bound', modelKey}`. |
| `registry.invalidateModelPlacement` | ModelRegistry.js | `(modelKey) → number` | The §16.2 "single call": bumps the generation **first**, then `world.invalidateModelPlacement(model)`. `engine.invalidateModelPlacement` (P7) is a one-line delegate. |
| `assertRegistryBelongsToWorld` | ModelRegistry.js | `(registry, world) → registry` | Throws `ModelBindingError{reason:'registry-mismatch'}` unless `registry` is a registry built for exactly `world`. P6's coordinator calls it; P6 owns the world → registry map. |

**Errors consumed (P0, `clashtest/errors.js`)** — see task interfaces for the assumed shapes: `ModelBindingError`, `ModelKeyVersionConflictError`.

**Not owned here (deliberately):** the world-scoped coordinator and its `WeakMap` on `globalThis` (P6, spec §7.3); the durable `modelKey → modelVersion` index (P5 `ResultStore.put`, atomic claim, spec §4.2 item 2); `semanticDigest` computation (P2, over P0 `util/canonical.js`); `compareResultSets` / `getFreshness` use of these functions (P6, P8).

## File structure

| File | Action | Responsibility |
|---|---|---|
| `clashtest/identity/ids.js` | Create | Pure identity functions. **No imports at all.** |
| `clashtest/identity/ModelRegistry.js` | Create | Registry class, `createModelRegistry` (N11), `bindingsEquivalent`, `assertRegistryBelongsToWorld`, `BINDING_REASONS`. Imports only `../errors.js`. |
| `test/clashtest/support/leaseWorld.mjs` | Create | Minimal lease-only fake world (`admitModel`, `isLeaseValid`, `evictModel`, `invalidateModelPlacement`, `dispose`) with call counters and two re-entrancy hooks. Added to the shared support dir (P0's dir, additive). |
| `test/clashtest/support/leaseWorld.contract.test.mjs` | Create | One contract table run against BOTH the fake and the real `CollisionWorld`, so the fake cannot drift. |
| `test/clashtest/identity/ids.elementRef.test.mjs` | Create | ElementRef + element order. |
| `test/clashtest/identity/ids.pairId.test.mjs` | Create | Semantics derivation, PairId canonicalization, shuffle property tests. |
| `test/clashtest/identity/ids.resultId.test.mjs` | Create | ResultId form, stability, delimiter safety, digest sensitivity (P0 canonical util). |
| `test/clashtest/identity/ModelRegistry.register.test.mjs` | Create | Bindings, conflicts, generations, session id, revision, handler safety. |
| `test/clashtest/identity/ModelRegistry.snapshot.test.mjs` | Create | `snapshotBindings` atomicity/immutability, leases, `bindingsEquivalent`, `isBindingCurrent`. |
| `test/clashtest/identity/ModelRegistry.placement.test.mjs` | Create | Placement generation, `invalidateModelPlacement`, snapshot-bracket visibility. |
| `test/clashtest/identity/identity.guards.test.mjs` | Create | World scoping, public-surface-only, layering, no-runtime-identity-leak guards. |

**Import convention** used by every test below: from `test/clashtest/identity/*.test.mjs` the repo root is `../../../`; from `test/clashtest/support/*` it is also `../../../`.

**Design decisions recorded here (spec is silent or over-specified; the simplest mechanism that preserves the observable invariants):**

1. **Dead vs. unbound bindings are both `null`.** The spec says "marks the binding dead" but its `bindingFor → Binding | null` has no dead representation, and every consumer (§16.1: "binding dead ⇒ `model-not-bound`", freshness "binding died") treats dead and never-registered identically. The registry keeps dead *entries* internally (needed for generation continuity and the `firstSeenVersion` ledger) but never returns them. A holder of an old `Binding` asks `registry.isBindingCurrent(binding)`.
2. **`bindingFor`/`snapshotBindings` return `null` unless the lease is currently valid.** They call `world.admitModel` lazily (first read; spec §4.3) and cache the lease; every read re-checks `world.isLeaseValid(lease)` (a total, non-throwing world method). A model the world has evicted or a disposed world therefore reads as unbound even if the host forgot `registry.unregister` — fail-closed. P4's per-unit lease pre-check (§7.4) still applies (a lease can die *after* the read).
3. **`snapshotBindings` is two-phase.** Phase 1 (pure registry state, no world call, no user code after the key list is copied) captures revision + every entry's values; phase 2 resolves leases (world calls). A world callback that mutates the registry during phase 2 cannot produce a mixed snapshot: the result is exactly the state at `registryRevision`, possibly with some bindings downgraded to `null` (fail-closed).
4. **`bindingGeneration` increments whenever a live binding is (re)established for a key that already had a binding** (different Model with the same version — the spec's reload case — *and* the same object re-registered after `unregister`, fail-closed). First registration is generation `1`; `placementGeneration` starts at `0` and is never reset (monotonic per key across reloads).
5. **`registryRevision` moves only on an effective state change** (a genuine new binding, an effective unregister, a placement bump). An idempotent or rejected `register` does not bump it, so equal revisions still mean an unchanged registry.
6. **`register` does not call `world.admitModel`.** Registering an already-evicted Model succeeds and reads as `null` (decision 2). One fewer throwing path in the host's load handler.
7. **Registry construction/ownership.** P1 ships the class and `assertRegistryBelongsToWorld`; it does **not** own a `getRegistryForWorld` WeakMap — that is P6's world-scoped coordinator (spec §7.3), which is also where the `registry-mismatch` throw at `createClashTestEngine` lives.

---

### Task P1.1: `ElementRef` and element order

**Files**
- Create: `clashtest/identity/ids.js`
- Test: `test/clashtest/identity/ids.elementRef.test.mjs`

**Interfaces**
- Consumes: nothing (no imports).
- Produces: `isValidModelKey`, `isValidDbId`, `makeElementRef`, `elementRefFrom`, `compareModelKeys`, `compareElementRefs`, `elementRefKey` (reconciliation N12; see the interface summary).

- [ ] **Step 1: Write the failing test**

```js
// test/clashtest/identity/ids.elementRef.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidModelKey, isValidDbId, makeElementRef, elementRefFrom, compareModelKeys, compareElementRefs, elementRefKey,
} from '../../../clashtest/identity/ids.js';

test('makeElementRef returns a frozen, closed {modelKey, dbId}', () => {
  const ref = makeElementRef('m1', 7);
  assert.deepEqual(Object.keys(ref), ['modelKey', 'dbId']);
  assert.equal(JSON.stringify(ref), '{"modelKey":"m1","dbId":7}');
  assert.equal(Object.isFrozen(ref), true);
  assert.deepEqual(structuredClone(ref), ref);
});

test('makeElementRef normalizes -0 and rejects anything that is not an identity', () => {
  assert.ok(Object.is(makeElementRef('m', -0).dbId, 0));
  for (const bad of [-1, 1.5, NaN, Infinity, 2 ** 53, '3', null, undefined, 1n]) {
    assert.throws(() => makeElementRef('m', bad), TypeError, `dbId ${String(bad)}`);
  }
  for (const bad of ['', 5, null, undefined, {}]) {
    assert.throws(() => makeElementRef(bad, 1), TypeError, `modelKey ${String(bad)}`);
  }
  assert.equal(isValidDbId(0), true);
  assert.equal(isValidDbId(Number.MAX_SAFE_INTEGER), true);
  assert.equal(isValidModelKey('x'), true);
  assert.equal(isValidModelKey(''), false);
});

test('elementRefFrom copies exactly two fields and never carries runtime identity', () => {
  const live = {
    modelKey: 'm', dbId: 3, model: { id: 1 }, loadEpoch: 4, modelId: 9, fragmentId: 12, geometryIndex: 2,
  };
  const ref = elementRefFrom(live);
  assert.deepEqual(Object.keys(ref), ['modelKey', 'dbId']);
  assert.notEqual(ref, live);
  assert.equal(JSON.stringify(ref), '{"modelKey":"m","dbId":3}');
  assert.throws(() => elementRefFrom(null), TypeError);
  assert.throws(() => elementRefFrom('m'), TypeError);
  assert.throws(() => elementRefFrom({ modelKey: 'm' }), TypeError);
});

test('compareModelKeys is UTF-16 code-unit order, not locale order and not code-point order', () => {
  assert.equal(compareModelKeys('a', 'a'), 0);
  assert.equal(compareModelKeys('B', 'a'), -1);      // 0x42 < 0x61 (localeCompare would say the opposite)
  assert.equal(compareModelKeys('a', 'ab'), -1);     // shorter prefix first
  // U+1F600 is the surrogate pair D83D DE00; U+FF5E is one unit. By code unit D83D < FF5E;
  // by code point 0x1F600 > 0xFF5E. The spec fixes code-unit order.
  assert.equal(compareModelKeys('😀', '～'), -1);
  assert.equal(compareModelKeys('～', '😀'), 1);
});

test('element order is modelKey by code unit, then dbId numerically', () => {
  const refs = [['b', 1], ['a', 10], ['a', 2], ['B', 5], ['～', 0], ['😀', 0]]
    .map(([k, d]) => makeElementRef(k, d));
  const sorted = [...refs].sort(compareElementRefs).map((r) => `${r.modelKey}:${r.dbId}`);
  assert.deepEqual(sorted, ['B:5', 'a:2', 'a:10', 'b:1', '😀:0', '～:0']);
  assert.equal(compareElementRefs(makeElementRef('a', 99), makeElementRef('b', 1)), -1); // key dominates dbId
  assert.equal(compareElementRefs(makeElementRef('a', 2), makeElementRef('a', 2)), 0);
});

test('elementRefKey is injective: no delimiter-shaped modelKey can alias another ref (N12)', () => {
  const vectors = [
    ['a:1', 2], ['a', 1], ['a', 12], ['a1', 2], ['a\u0000', 1], ['a', 0], ['a\u0000\u0000', 1], ['a\u0000\u0001', 1],
    ['"a"', 1], ['a,1', 2], ['[a', 1], ['a]', 1], ['a\\', 1], ['a/1', 2], ['😀', 1], ['～', 1], ['\ud800', 1],
    ['a', Number.MAX_SAFE_INTEGER], ['a', Number.MAX_SAFE_INTEGER - 1],
  ];
  const keys = vectors.map(([k, d]) => elementRefKey(makeElementRef(k, d)));
  assert.equal(new Set(keys).size, vectors.length);
  assert.equal(typeof keys[0], 'string');
  assert.equal(elementRefKey(makeElementRef('m', 5)), elementRefKey({ modelKey: 'm', dbId: 5, model: {} })); // extra fields ignored
  assert.equal(elementRefKey(makeElementRef('m', -0)), elementRefKey(makeElementRef('m', 0)));
  for (const bad of [null, undefined, 'm', {}, { modelKey: '', dbId: 1 }, { modelKey: 'm', dbId: -1 }, { modelKey: 'm', dbId: 1.5 }]) {
    assert.throws(() => elementRefKey(bad), TypeError);
  }
});

test('elementRefKey is order-preserving: string order of keys == compareElementRefs, over a randomized population', () => {
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const alphabet = ['a', 'b', 'B', '\u0000', '\u0001', ':', '"', '😀', '～', '\ud800'];
  const refs = [];
  for (let i = 0; i < 400; i += 1) {
    const len = 1 + Math.floor(rnd() * 4);
    let modelKey = '';
    for (let j = 0; j < len; j += 1) modelKey += alphabet[Math.floor(rnd() * alphabet.length)];
    refs.push(makeElementRef(modelKey, [0, 1, 2, 9, 10, 99, 100, 2 ** 40, Number.MAX_SAFE_INTEGER][Math.floor(rnd() * 9)]));
  }
  for (const a of refs) {
    for (const b of refs.slice(0, 40)) {
      const byKey = elementRefKey(a) < elementRefKey(b) ? -1 : elementRefKey(a) > elementRefKey(b) ? 1 : 0;
      assert.equal(byKey, compareElementRefs(a, b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    }
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/clashtest/identity/ids.elementRef.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `clashtest/identity/ids.js` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

```js
// clashtest/identity/ids.js
//
// Pure durable-identity functions (spec §4.4, §4.5). This module imports NOTHING: it has no way to
// reach a Model, a loadEpoch or a modelId, and it never invents a stronger identity than
// (modelKey, dbId).

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

/** @param {unknown} v */
export const isValidModelKey = isNonEmptyString;

/** dbId is model-local: a non-negative safe integer (spec §4.4). @param {unknown} v */
export function isValidDbId(v) {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

/** UTF-16 code-unit order — the spec's "code-unit comparison". `<`/`>` on strings is exactly that. */
export function compareModelKeys(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * @param {string} modelKey
 * @param {number} dbId
 * @returns {Readonly<{modelKey: string, dbId: number}>}
 */
export function makeElementRef(modelKey, dbId) {
  if (!isValidModelKey(modelKey)) throw new TypeError('ElementRef.modelKey must be a non-empty string');
  if (!isValidDbId(dbId)) throw new TypeError('ElementRef.dbId must be a non-negative safe integer');
  return Object.freeze({ modelKey, dbId: dbId + 0 }); // + 0 turns -0 into 0
}

/** Copies exactly the two identity fields; every other property of `value` is dropped. */
export function elementRefFrom(value) {
  if (typeof value !== 'object' || value === null) throw new TypeError('ElementRef source must be an object');
  return makeElementRef(value.modelKey, value.dbId);
}

/** Element order (spec §4.4). Hot-path comparator: callers pass already-valid refs. */
export function compareElementRefs(a, b) {
  return compareModelKeys(a.modelKey, b.modelKey) || (a.dbId < b.dbId ? -1 : a.dbId > b.dbId ? 1 : 0);
}

/**
 * Collision-free, ORDER-PRESERVING Map/Set key for an ElementRef (reconciliation N12): for valid refs,
 * elementRefKey(a) < elementRefKey(b)  <=>  compareElementRefs(a, b) < 0, and keys are equal iff refs are.
 * Encoding: the modelKey with every U+0000 doubled to U+0000 U+0001, then the terminator U+0000 U+0000, then the
 * dbId as exactly 16 zero-padded digits (Number.MAX_SAFE_INTEGER has 16). Any code unit of a modelKey other
 * than U+0000 sorts above the terminator's second unit, and the doubled escape sorts above the terminator, so a
 * modelKey that is a prefix of another sorts first exactly as in compareModelKeys. Validating (unlike
 * compareElementRefs): it is called once per element, never in a comparator hot loop.
 */
export function elementRefKey(ref) {
  if (typeof ref !== 'object' || ref === null || !isValidModelKey(ref.modelKey) || !isValidDbId(ref.dbId)) {
    throw new TypeError('elementRefKey needs a valid ElementRef {modelKey, dbId}');
  }
  return `${ref.modelKey.replace(/\u0000/g, '\u0000\u0001')}\u0000\u0000${String(ref.dbId).padStart(16, '0')}`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/clashtest/identity/ids.elementRef.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits)** — `git add clashtest/identity/ids.js test/clashtest/identity/ids.elementRef.test.mjs && git commit -m "feat(clashtest): ElementRef and element order (P1.1)"`.

---

### Task P1.2: Pair semantics and `PairId` canonicalization

**Files**
- Modify: `clashtest/identity/ids.js`
- Test: `test/clashtest/identity/ids.pairId.test.mjs`

**Interfaces**
- Consumes: `makeElementRef`, `elementRefFrom`, `compareElementRefs` from P1.1.
- Produces: `CLASH_MODES`, `pairSemanticsOf`, `sameSemanticsClass`, `makePairId`, `comparePairIds`.

- [ ] **Step 1: Write the failing test**

```js
// test/clashtest/identity/ids.pairId.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLASH_MODES, pairSemanticsOf, sameSemanticsClass, makeElementRef, compareElementRefs, makePairId, comparePairIds,
} from '../../../clashtest/identity/ids.js';

const UNORDERED = ['volume-overlap', 'surface-intersection', 'clearance'];
const ref = (k, d) => makeElementRef(k, d);

// seeded RNG (mulberry32) + Fisher-Yates so the shuffle tests are reproducible
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(items, rnd) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// 4 models (incl. a surrogate-pair key and a BMP key that sort differently by code point) x 4 dbIds = 16 elements
const ELEMENTS = ['mA', 'mB', '😀', '～'].flatMap((k) => [0, 1, 2, 10].map((d) => ref(k, d)));

function canonicalPairSet(mode, seed) {
  const rnd = mulberry32(seed);
  const tuples = [];
  for (const x of ELEMENTS) for (const y of ELEMENTS) if (compareElementRefs(x, y) !== 0) tuples.push([x, y]);
  const byJson = new Map();
  for (const [x, y] of shuffle(tuples, rnd)) {
    const p = makePairId(mode, x, y);
    byJson.set(JSON.stringify(p), p);
  }
  return [...byJson.values()].sort(comparePairIds);
}

test('CLASH_MODES is the frozen spec §5.1 list and semantics are derived from mode alone (§4.5)', () => {
  assert.deepEqual([...CLASH_MODES], ['volume-overlap', 'surface-intersection', 'containment', 'clearance']);
  assert.equal(Object.isFrozen(CLASH_MODES), true);
  for (const m of UNORDERED) assert.equal(pairSemanticsOf(m), 'unordered');
  assert.equal(pairSemanticsOf('containment'), 'ordered');
  for (const bad of ['hard', '', undefined, null, 5, Symbol('m')]) {
    assert.throws(() => pairSemanticsOf(bad), TypeError);
  }
  assert.equal(sameSemanticsClass('volume-overlap', 'clearance'), true);
  assert.equal(sameSemanticsClass('clearance', 'containment'), false);
});

test('unordered modes: (x,y) and (y,x) are ONE PairId, first is the lesser element', () => {
  for (const mode of UNORDERED) {
    const x = ref('m2', 1);
    const y = ref('m1', 5);
    assert.deepEqual(makePairId(mode, x, y), makePairId(mode, y, x));
    assert.deepEqual(makePairId(mode, x, y), { first: ref('m1', 5), second: ref('m2', 1) });
    // same model: dbId compared numerically, not lexically
    assert.deepEqual(makePairId(mode, ref('m', 10), ref('m', 2)), { first: ref('m', 2), second: ref('m', 10) });
  }
});

test('containment is ordered: first = contained (source), second = container (target); no reordering', () => {
  const inner = ref('m2', 1);
  const outer = ref('m1', 5); // lesser in element order, yet must stay `second`
  assert.deepEqual(makePairId('containment', inner, outer), { first: inner, second: outer });
  assert.deepEqual(makePairId('containment', outer, inner), { first: outer, second: inner });
  assert.notDeepEqual(makePairId('containment', inner, outer), makePairId('containment', outer, inner));
});

test('a PairId always names two distinct elements', () => {
  for (const mode of CLASH_MODES) {
    assert.throws(() => makePairId(mode, ref('m', 1), ref('m', 1)), RangeError);
  }
  assert.throws(() => makePairId('containment', ref('m', 1), null), TypeError);
});

test('a PairId is closed, frozen, and carries no runtime identity even if the inputs do', () => {
  const live = (k, d) => ({ modelKey: k, dbId: d, model: { id: 1 }, loadEpoch: 3, modelId: 8, fragmentId: 2 });
  const pair = makePairId('volume-overlap', live('m1', 1), live('m2', 2));
  assert.deepEqual(Object.keys(pair), ['first', 'second']);
  assert.deepEqual(Object.keys(pair.first), ['modelKey', 'dbId']);
  assert.deepEqual(Object.keys(pair.second), ['modelKey', 'dbId']);
  assert.equal(Object.isFrozen(pair) && Object.isFrozen(pair.first) && Object.isFrozen(pair.second), true);
  assert.doesNotMatch(JSON.stringify(pair), /"model"|loadEpoch|modelId|fragmentId/);
  assert.deepEqual(structuredClone(pair), pair);
});

test('property: unordered canonicalization is independent of enumeration order and orientation', () => {
  for (const mode of UNORDERED) {
    const baseline = canonicalPairSet(mode, 1);
    assert.equal(baseline.length, (ELEMENTS.length * (ELEMENTS.length - 1)) / 2); // 120 unordered pairs
    assert.ok(baseline.every((p) => compareElementRefs(p.first, p.second) < 0));
    for (let seed = 2; seed <= 21; seed += 1) {
      assert.deepEqual(canonicalPairSet(mode, seed), baseline, `${mode} seed ${seed}`);
    }
  }
});

test('property: containment keeps BOTH orientations as distinct pairs, independent of enumeration order', () => {
  const baseline = canonicalPairSet('containment', 1);
  assert.equal(baseline.length, ELEMENTS.length * (ELEMENTS.length - 1)); // 240 ordered pairs
  for (let seed = 2; seed <= 21; seed += 1) {
    assert.deepEqual(canonicalPairSet('containment', seed), baseline, `containment seed ${seed}`);
  }
});

test('property: every unordered mode yields the SAME PairId for the same two elements (join key across modes, AC-14 iv)', () => {
  const rnd = mulberry32(7);
  for (let i = 0; i < 200; i += 1) {
    const [x, y] = shuffle(ELEMENTS, rnd).slice(0, 2);
    const ids = UNORDERED.map((m) => JSON.stringify(makePairId(m, x, y)));
    assert.equal(new Set(ids).size, 1);
  }
});

test('comparePairIds is the spec §11.3 order (first.modelKey, first.dbId, second.modelKey, second.dbId)', () => {
  const reference = (p, q) => {
    const a = [p.first.modelKey, p.first.dbId, p.second.modelKey, p.second.dbId];
    const b = [q.first.modelKey, q.first.dbId, q.second.modelKey, q.second.dbId];
    for (let i = 0; i < 4; i += 1) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  };
  const all = canonicalPairSet('containment', 3);
  const shuffled = shuffle(all, mulberry32(99));
  assert.deepEqual([...shuffled].sort(comparePairIds), [...shuffled].sort(reference));
  assert.equal(comparePairIds(all[0], all[0]), 0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/clashtest/identity/ids.pairId.test.mjs`
Expected: FAIL — `SyntaxError: The requested module '../../../clashtest/identity/ids.js' does not provide an export named 'CLASH_MODES'`.

- [ ] **Step 3: Add the implementation** (append to `clashtest/identity/ids.js`)

```js
// ---- pair semantics (spec §4.5) -------------------------------------------------------------------

/** The four modes of spec §5.1, and the ONLY code home of the list (P2's validator imports it). */
export const CLASH_MODES = Object.freeze(['volume-overlap', 'surface-intersection', 'containment', 'clearance']);

const SEMANTICS_BY_MODE = new Map([
  ['volume-overlap', 'unordered'],
  ['surface-intersection', 'unordered'],
  ['clearance', 'unordered'],
  ['containment', 'ordered'],
]);

/** Symmetry class is derived, never chosen (spec §4.5). */
export function pairSemanticsOf(mode) {
  const semantics = SEMANTICS_BY_MODE.get(mode);
  if (semantics === undefined) throw new TypeError(`Unknown clash mode: ${String(mode)}`);
  return semantics;
}

/** A PairId is comparable only within one pair-semantics class (spec §4.4, §15.4). */
export function sameSemanticsClass(modeA, modeB) {
  return pairSemanticsOf(modeA) === pairSemanticsOf(modeB);
}

// ---- PairId (spec §4.4) ---------------------------------------------------------------------------

/**
 * @param {string} mode
 * @param {{modelKey: string, dbId: number}} x  for `containment`: the CONTAINED element (library source)
 * @param {{modelKey: string, dbId: number}} y  for `containment`: the CONTAINER (library target)
 * @returns {Readonly<{first: object, second: object}>}
 */
export function makePairId(mode, x, y) {
  const semantics = pairSemanticsOf(mode);
  const a = elementRefFrom(x);
  const b = elementRefFrom(y);
  const order = compareElementRefs(a, b);
  if (order === 0) throw new RangeError('A PairId needs two distinct elements');
  const inOrder = semantics === 'ordered' || order < 0;
  return Object.freeze({ first: inOrder ? a : b, second: inOrder ? b : a });
}

/** Canonical result order of spec §11.3. */
export function comparePairIds(p, q) {
  return compareElementRefs(p.first, q.first) || compareElementRefs(p.second, q.second);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/clashtest/identity/ids.pairId.test.mjs test/clashtest/identity/ids.elementRef.test.mjs`
Expected: PASS (elementRef 7 + pairId 9).

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits)** — `git commit -am "feat(clashtest): pair semantics and PairId canonicalization (P1.2)"`.

---

### Task P1.3: `ResultId` and digest sensitivity

**Files**
- Modify: `clashtest/identity/ids.js`
- Test: `test/clashtest/identity/ids.resultId.test.mjs`

**Interfaces**
- Consumes: P1.1/P1.2 functions; from **P0** `clashtest/util/canonical.js`.
  - **RECONCILED (reconciliation row N3):** P0 exports `digestCanonical(value) → 'sha256:…'` (**synchronous**, small values) and `digestCanonicalSliced(value, slicer, {label?}) → Promise<'sha256:…'>`; there is no `digestOf`. This task uses `digestCanonical`, returning `"sha256:" + 64 lowercase hex` of the canonical-JSON encoding (spec §5.4: sorted keys, well-formed `JSON.stringify` strings, shortest round-trip numbers, `-0 → 0`). **Read `digestOf` as `digestCanonical` and drop the `await` in every sketch below** — the helper becomes synchronous. `semanticDigest` proper is P2's (`definition/normalize.js`); this task uses a **test-local stand-in** to prove the `ResultId ⇄ digest` coupling.
- Produces: `SEMANTIC_DIGEST_PATTERN`, `isSemanticDigest`, `makeResultId`, `parseResultId`.

- [ ] **Step 1: Write the failing test**

```js
// test/clashtest/identity/ids.resultId.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeElementRef, makePairId, makeResultId, parseResultId, isSemanticDigest,
} from '../../../clashtest/identity/ids.js';
import { digestCanonical } from '../../../clashtest/util/canonical.js'; // P0: synchronous, value-taking (reconciliation N3)

const D = `sha256:${'a'.repeat(64)}`;
const pairOf = (mode, k1, d1, k2, d2) => makePairId(mode, makeElementRef(k1, d1), makeElementRef(k2, d2));

test('canonical string form is JSON.stringify of the six-element array (spec §4.4)', () => {
  const pair = pairOf('volume-overlap', 'm2', 9, 'm1', 2);
  assert.equal(makeResultId('t-1', D, pair), `["t-1","${D}","m1",2,"m2",9]`);
});

test('makeResultId takes exactly (testId, semanticDigest, pairId): no revision/run/epoch/model can enter', () => {
  assert.equal(makeResultId.length, 3);
});

test('ResultId is stable across calls and across evaluation orientation for unordered modes', () => {
  const a = makeResultId('t', D, pairOf('clearance', 'mA', 1, 'mB', 2));
  const b = makeResultId('t', D, pairOf('clearance', 'mB', 2, 'mA', 1));
  assert.equal(a, b);
  assert.equal(a, makeResultId('t', D, pairOf('clearance', 'mA', 1, 'mB', 2)));
});

test('containment ResultIds distinguish the two orientations (a reversal is the converse question)', () => {
  const x = makeResultId('t', D, pairOf('containment', 'mA', 1, 'mB', 2));
  const y = makeResultId('t', D, pairOf('containment', 'mB', 2, 'mA', 1));
  assert.notEqual(x, y);
});

test('distinct modelKeys over identical dbIds give distinct ResultIds (AC-16)', () => {
  const ids = new Set(['m1', 'm2', 'm3'].map((k) => makeResultId('t', D, pairOf('volume-overlap', k, 5, k, 6))));
  assert.equal(ids.size, 3);
});

test('the encoding is delimiter-safe and round-trips for hostile modelKeys and testIds', () => {
  const keys = ['a","b', 'a,b', 'a|b', 'a\u0000b', 'a\\b', '\uD800', '😀', ' ', ' a', 'a '];
  const seen = new Map();
  for (const k1 of keys) {
    for (const k2 of keys) {
      const pair = pairOf('containment', k1, 1, k2, 2);
      const id = makeResultId('t"e,s|t', D, pair);
      assert.equal(seen.has(id), false, `collision on ${id}`);
      seen.set(id, pair);
      assert.deepEqual(parseResultId(id), { testId: 't"e,s|t', semanticDigest: D, pairId: pair });
    }
  }
});

test('parseResultId accepts only byte-identical canonical output', () => {
  const pair = pairOf('volume-overlap', 'm1', 1, 'm2', 2);
  const canonical = makeResultId('t', D, pair);
  assert.deepEqual(parseResultId(canonical), { testId: 't', semanticDigest: D, pairId: pair });
  const spaced = JSON.stringify(JSON.parse(canonical), null, 1);
  for (const bad of [spaced, canonical.slice(0, -1), `${canonical} `, '[]', '{}', 'null', '', 5, null, undefined,
    JSON.stringify(['t', 'sha256:xyz', 'm1', 1, 'm2', 2]),
    JSON.stringify(['t', D, 'm1', -1, 'm2', 2]),
    JSON.stringify(['t', D, 'm1', 1, 'm1', 1]),
    JSON.stringify(['', D, 'm1', 1, 'm2', 2])]) {
    assert.equal(parseResultId(bad), null, String(bad));
  }
});

test('makeResultId validates every input loudly', () => {
  const pair = pairOf('volume-overlap', 'm1', 1, 'm2', 2);
  assert.throws(() => makeResultId('', D, pair), TypeError);
  assert.throws(() => makeResultId('t', 'sha256:ABC', pair), TypeError);
  assert.throws(() => makeResultId('t', 'md5:abc', pair), TypeError);
  assert.throws(() => makeResultId('t', D, null), TypeError);
  assert.throws(() => makeResultId('t', D, { first: pair.first }), TypeError);
  assert.throws(() => makeResultId('t', D, { first: pair.first, second: pair.first }), RangeError);
  assert.equal(isSemanticDigest(D), true);
  assert.equal(isSemanticDigest(`sha256:${'A'.repeat(64)}`), false);
});

// ---- digest sensitivity (uses P0's canonical util; the production semanticDigest is P2's, AC-1) ------

// Test-local stand-in with the spec §5.4 shape: {mode, clearance?, selectionA, selectionB}, name/description/revision excluded.
function standInSemanticDigest({ mode, clearance, selectionA, selectionB }) {
  const body = { mode, selectionA, selectionB };
  if (clearance !== undefined) body.clearance = clearance;
  return digestCanonical(body);
}

const baseDef = {
  mode: 'clearance',
  clearance: 0.5,
  selectionA: { entries: [{ kind: 'model', modelKey: 'mA' }] },
  selectionB: { entries: [{ kind: 'elements', modelKey: 'mB', dbIds: [1, 2] }] },
};

test('the digest is sensitive to mode, clearance, each selection, and the A/B swap; insensitive to key order', () => {
  const d0 = standInSemanticDigest(baseDef);
  assert.match(d0, /^sha256:[0-9a-f]{64}$/);
  const reordered = { selectionB: baseDef.selectionB, clearance: 0.5, selectionA: baseDef.selectionA, mode: 'clearance' };
  assert.equal(standInSemanticDigest(reordered), d0);

  const variants = [
    { ...baseDef, mode: 'volume-overlap', clearance: undefined },
    { ...baseDef, mode: 'containment', clearance: undefined },
    { ...baseDef, clearance: 1 },
    { ...baseDef, selectionB: { entries: [{ kind: 'elements', modelKey: 'mB', dbIds: [1, 3] }] } },
    { ...baseDef, selectionA: { entries: [{ kind: 'model', modelKey: 'mC' }] } },
    { ...baseDef, selectionA: baseDef.selectionB, selectionB: baseDef.selectionA }, // swap = different question (§5.4, R21 Q3)
  ];
  const digests = [d0, ...variants.map(standInSemanticDigest)];
  assert.equal(new Set(digests).size, digests.length);
});

test('the same element pair gets a different ResultId under each different question, the same one under the same question', () => {
  const pair = pairOf('volume-overlap', 'mA', 1, 'mB', 2);
  const dA = standInSemanticDigest(baseDef);
  const dB = standInSemanticDigest({ ...baseDef, clearance: 1 });
  assert.notEqual(makeResultId('t', dA, pair), makeResultId('t', dB, pair));
  // a name-only revision is modelled by recomputing the digest from the same semantic fields
  assert.equal(makeResultId('t', dA, pair), makeResultId('t', standInSemanticDigest({ ...baseDef }), pair));
  // and testId is part of the identity
  assert.notEqual(makeResultId('t1', dA, pair), makeResultId('t2', dA, pair));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/clashtest/identity/ids.resultId.test.mjs`
Expected: FAIL — `SyntaxError ... does not provide an export named 'makeResultId'` (or `ERR_MODULE_NOT_FOUND` for `clashtest/util/canonical.js` if P0 has not landed — P0 is a prerequisite of this task).

- [ ] **Step 3: Add the implementation** (append to `clashtest/identity/ids.js`)

```js
// ---- ResultId (spec §4.4) -------------------------------------------------------------------------

/** Format of every durable digest (spec §5.4): "sha256:" + 64 lowercase hex. */
export const SEMANTIC_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

export function isSemanticDigest(value) {
  return typeof value === 'string' && SEMANTIC_DIGEST_PATTERN.test(value);
}

/**
 * ResultId = (testId, semanticDigest, PairId), canonical string form
 * JSON.stringify([testId, semanticDigest, first.modelKey, first.dbId, second.modelKey, second.dbId]).
 * Arity is deliberately 3: revision, runId, epoch, unit, broad-phase and Model cannot enter the identity.
 * `pairId` is expected to come from makePairId (the mode-dependent ordering is not re-derivable here).
 */
export function makeResultId(testId, semanticDigest, pairId) {
  if (!isNonEmptyString(testId)) throw new TypeError('testId must be a non-empty string');
  if (!isSemanticDigest(semanticDigest)) throw new TypeError('semanticDigest must be "sha256:" + 64 lowercase hex');
  if (typeof pairId !== 'object' || pairId === null) throw new TypeError('pairId must be an object');
  const first = elementRefFrom(pairId.first);
  const second = elementRefFrom(pairId.second);
  if (compareElementRefs(first, second) === 0) throw new RangeError('A PairId needs two distinct elements');
  return JSON.stringify([testId, semanticDigest, first.modelKey, first.dbId, second.modelKey, second.dbId]);
}

/** Inverse of makeResultId; null for anything that is not byte-identical canonical output. */
export function parseResultId(text) {
  if (typeof text !== 'string') return null;
  let parts;
  try { parts = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(parts) || parts.length !== 6) return null;
  const [testId, semanticDigest, k1, d1, k2, d2] = parts;
  try {
    const pairId = Object.freeze({ first: makeElementRef(k1, d1), second: makeElementRef(k2, d2) });
    return makeResultId(testId, semanticDigest, pairId) === text ? { testId, semanticDigest, pairId } : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/clashtest/identity/ids.resultId.test.mjs test/clashtest/identity/ids.pairId.test.mjs test/clashtest/identity/ids.elementRef.test.mjs`
Expected: PASS (all three files).

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits)** — `git commit -am "feat(clashtest): ResultId canonical form and parse (P1.3)"`.

---

### Task P1.4: Lease-world test support with a real-`CollisionWorld` contract

**Files**
- Create: `test/clashtest/support/leaseWorld.mjs`
- Test: `test/clashtest/support/leaseWorld.contract.test.mjs`

**Interfaces**
- Consumes: the real `CollisionWorld` (public surface only: `admitModel`, `isLeaseValid`, `evictModel`, `invalidateModelPlacement`, `dispose`), imported from `collision/index.js` **in tests only**. Verified facts about the real world (read from `collision/CollisionWorld.js`, exercised in a scratch run): `admitModel` is idempotent for a live model (same epoch), throws `ModelEvictedError` for an evicted model and `WorldDisposedError` once disposed; `isLeaseValid` is total and returns `false` after eviction or disposal; `evictModel` is an idempotent no-op that never throws (also when disposed); `invalidateModelPlacement` no-ops for a never-admitted model, throws `ModelEvictedError` for an evicted one and `WorldDisposedError` once disposed; `dispose()` is **not** idempotent (a second call throws `WorldDisposedError`).
- Produces: `makeLeaseWorld() → { admitModel, isLeaseValid, evictModel, invalidateModelPlacement, dispose, calls, hooks }` where `calls` counts each method and `hooks.beforeAdmitModel(model)` / `hooks.beforeIsLeaseValid(lease)` are optional re-entrancy callbacks fired at the top of the respective method (used by the atomic-snapshot tests).
- **Assumed:** P0's shared fake world may already expose some of these; this file is additive and self-contained so P1 does not depend on it. The controller may fold it into P0's fake later.

- [ ] **Step 1: Write the failing contract test**

```js
// test/clashtest/support/leaseWorld.contract.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../../../collision/index.js';
import { makeLeaseWorld } from './leaseWorld.mjs';

const IMPLS = [
  ['leaseWorld fake', () => makeLeaseWorld()],
  ['real CollisionWorld', () => new CollisionWorld()],
];
const throwsNamed = (name) => (e) => e?.name === name;

for (const [label, make] of IMPLS) {
  test(`${label}: admitModel is idempotent for a live model`, () => {
    const world = make();
    const m = { id: 1 };
    const l1 = world.admitModel(m);
    const l2 = world.admitModel(m);
    assert.equal(l1.model, m);
    assert.equal(l1.epoch, l2.epoch);
    assert.equal(world.isLeaseValid(l1), true);
    assert.notEqual(world.admitModel({ id: 2 }).epoch, l1.epoch);
  });

  test(`${label}: an evicted model can never be re-admitted and its lease dies`, () => {
    const world = make();
    const m = { id: 1 };
    const lease = world.admitModel(m);
    world.evictModel(m);
    world.evictModel(m); // idempotent, never throws
    assert.equal(world.isLeaseValid(lease), false);
    assert.throws(() => world.admitModel(m), throwsNamed('ModelEvictedError'));
  });

  test(`${label}: invalidateModelPlacement no-ops for a never-admitted model and throws for an evicted one`, () => {
    const world = make();
    assert.doesNotThrow(() => world.invalidateModelPlacement({ id: 9 }));
    const m = { id: 1 };
    world.admitModel(m);
    assert.doesNotThrow(() => world.invalidateModelPlacement(m));
    world.evictModel(m);
    assert.throws(() => world.invalidateModelPlacement(m), throwsNamed('ModelEvictedError'));
  });

  test(`${label}: once disposed, isLeaseValid is false, evictModel is a no-op, the others throw WorldDisposedError`, () => {
    const world = make();
    const m = { id: 1 };
    const lease = world.admitModel(m);
    world.dispose();
    assert.equal(world.isLeaseValid(lease), false);
    assert.doesNotThrow(() => world.evictModel(m));
    assert.throws(() => world.admitModel({ id: 2 }), throwsNamed('WorldDisposedError'));
    assert.throws(() => world.invalidateModelPlacement(m), throwsNamed('WorldDisposedError'));
  });
}

test('leaseWorld fake: call counters and re-entrancy hooks exist', () => {
  const world = makeLeaseWorld();
  const seen = [];
  world.hooks.beforeAdmitModel = (m) => seen.push(['admit', m.id]);
  world.hooks.beforeIsLeaseValid = (l) => seen.push(['valid', l.model.id]);
  const lease = world.admitModel({ id: 1 });
  world.isLeaseValid(lease);
  assert.deepEqual(seen, [['admit', 1], ['valid', 1]]);
  assert.deepEqual(world.calls, { admitModel: 1, isLeaseValid: 1, evictModel: 0, invalidateModelPlacement: 0 });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/clashtest/support/leaseWorld.contract.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `./leaseWorld.mjs`.

- [ ] **Step 3: Write the fake**

```js
// test/clashtest/support/leaseWorld.mjs
//
// Minimal lease-only fake of the CollisionWorld public lifecycle surface the ModelRegistry uses.
// Semantics mirror the real world (asserted by leaseWorld.contract.test.mjs against BOTH). It has no
// findClashes; richer fakes belong to P0's support kit.

function named(name) {
  const e = new Error(name);
  e.name = name;
  return e;
}

export function makeLeaseWorld() {
  let nextEpoch = 1;
  let disposed = false;
  const lifecycle = new WeakMap(); // model -> { state: 'live', epoch } | { state: 'evicted' }
  const calls = { admitModel: 0, isLeaseValid: 0, evictModel: 0, invalidateModelPlacement: 0 };
  const hooks = { beforeAdmitModel: null, beforeIsLeaseValid: null };

  return {
    calls,
    hooks,
    admitModel(model) {
      calls.admitModel += 1;
      hooks.beforeAdmitModel?.(model);
      if (disposed) throw named('WorldDisposedError');
      const existing = lifecycle.get(model);
      if (existing?.state === 'evicted') throw named('ModelEvictedError');
      if (existing?.state === 'live') return Object.freeze({ model, epoch: existing.epoch });
      const epoch = nextEpoch;
      nextEpoch += 1;
      lifecycle.set(model, { state: 'live', epoch });
      return Object.freeze({ model, epoch });
    },
    isLeaseValid(lease) {
      calls.isLeaseValid += 1;
      hooks.beforeIsLeaseValid?.(lease);
      if (disposed) return false;
      const entry = lifecycle.get(lease.model);
      return entry?.state === 'live' && entry.epoch === lease.epoch;
    },
    evictModel(model) {
      calls.evictModel += 1;
      if (disposed) return;
      if (lifecycle.get(model)?.state === 'evicted') return;
      lifecycle.set(model, { state: 'evicted' });
    },
    invalidateModelPlacement(model) {
      calls.invalidateModelPlacement += 1;
      if (disposed) throw named('WorldDisposedError');
      const entry = lifecycle.get(model);
      if (entry?.state === 'evicted') throw named('ModelEvictedError');
    },
    dispose() {
      if (disposed) throw named('WorldDisposedError'); // the real world's dispose() is not idempotent either
      disposed = true;
    },
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/clashtest/support/leaseWorld.contract.test.mjs`
Expected: PASS, 9 tests (4 x 2 implementations + 1). If a *real* `CollisionWorld` assertion fails, the fake's premise (and this task's "Verified facts") is wrong — stop and report; do not weaken the contract.

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits)** — `git add test/clashtest/support/leaseWorld.mjs test/clashtest/support/leaseWorld.contract.test.mjs && git commit -m "test(clashtest): lease-world fake with real-world contract (P1.4)"`.

---

### Task P1.5: `ModelRegistry` — bindings, version guard, generations, session id, handler safety

**Files**
- Create: `clashtest/identity/ModelRegistry.js`
- Test: `test/clashtest/identity/ModelRegistry.register.test.mjs`

**Interfaces**
- Consumes (**P0**, `clashtest/errors.js`) — **RECONCILED** to P0's *Phase interface summary* (producer wins; reconciliation rows N1/N2):
  - `new ModelBindingError({ reason, modelKey, message?, cause? })`: `name === 'ModelBindingError'`, own property `.reason` (**never `.code`**), own property `.modelKey` (`null` when the failure has no key). P0's convention is a **single object argument** for every error class.
  - `new ModelKeyVersionConflictError({ modelKey, existingVersion, offeredVersion })`: `name === 'ModelKeyVersionConflictError'`, own properties `modelKey`, `existingVersion`, `offeredVersion` (spec §4.2 item 1). **Not `seen`/`offered`.**
  - **Every throw site and every test assertion below is written in the real object form** (conformance pass: the earlier "shorthand notation" paragraph is gone, because a copy-pasted positional `new ModelBindingError(REASON, {…})` would build an error whose `.reason` is `undefined`). Fields beyond `{reason, modelKey}` are not part of P0's `ModelBindingError` and are dropped, so extra detail goes in `message`.
- Consumes (world, public surface): `admitModel(model) → lease`, `isLeaseValid(lease) → boolean`, `invalidateModelPlacement(model) → void` (`invalidateModelPlacement` is used in P1.7).
- Produces: `ModelRegistry` (constructor, `world`, `registrySessionId`, `registryRevision`, `register`, `unregister`, `keyOf`, `bindingFor`), `createModelRegistry` (reconciliation N11), `BINDING_REASONS`. `snapshotBindings`, `isBindingCurrent`, `bindingsEquivalent` are added in P1.6; placement methods in P1.7; `assertRegistryBelongsToWorld` in P1.8. A private atomic reader `#read(keys)` is written here so that `bindingFor` is already on the final code path.

- [ ] **Step 1: Write the failing test**

```js
// test/clashtest/identity/ModelRegistry.register.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelRegistry, createModelRegistry, BINDING_REASONS } from '../../../clashtest/identity/ModelRegistry.js';
import { ModelBindingError, ModelKeyVersionConflictError } from '../../../clashtest/errors.js';
import { makeLeaseWorld } from '../support/leaseWorld.mjs';

const model = (id) => ({ id });
const v = (modelVersion) => ({ modelVersion });
const bindingError = (reason) => (e) => e instanceof ModelBindingError && e.name === 'ModelBindingError'
  && e.reason === reason && e.code === undefined;

function setup() {
  const world = makeLeaseWorld();
  return { world, registry: new ModelRegistry({ world }) };
}

test('createModelRegistry is the §18 public factory: world required, no now option, same class', () => {
  const world = makeLeaseWorld();
  const registry = createModelRegistry({ world });
  assert.ok(registry instanceof ModelRegistry);
  assert.equal(registry.world, world);
  assert.equal(createModelRegistry({ world, makeSessionId: () => 'fixed' }).registrySessionId, 'fixed');
  for (const bad of [undefined, {}, { now: () => 0 }, { world: {} }]) {
    assert.throws(() => createModelRegistry(bad), bindingError(BINDING_REASONS.INVALID_WORLD));
  }
});

test('typed errors carry their fields as own data (reason / modelKey), never a positional code', () => {
  const { registry } = setup();
  let caught;
  try { registry.register('k', model(1), {}); } catch (e) { caught = e; }
  assert.ok(caught instanceof ModelBindingError);
  assert.equal(caught.reason, BINDING_REASONS.MISSING_MODEL_VERSION);
  assert.equal(caught.modelKey, 'k');
  assert.equal(Object.hasOwn(caught, 'code'), false);
  try { registry.register('', model(1), v('v1')); } catch (e) { caught = e; }
  assert.equal(caught.reason, BINDING_REASONS.INVALID_MODEL_KEY);
  assert.equal(caught.modelKey, null);
});

test('constructor requires a world exposing the lease surface', () => {
  assert.throws(() => new ModelRegistry({}), bindingError(BINDING_REASONS.INVALID_WORLD));
  assert.throws(() => new ModelRegistry(), bindingError(BINDING_REASONS.INVALID_WORLD));
  assert.throws(() => new ModelRegistry({ world: { admitModel() {} } }), bindingError(BINDING_REASONS.INVALID_WORLD));
  assert.equal(setup().registry.registryRevision, 0);
});

test('register without a usable modelVersion throws ModelBindingError and changes nothing (AC-16)', () => {
  const { registry } = setup();
  for (const opts of [undefined, {}, { modelVersion: '' }, { modelVersion: 3 }, { modelVersion: null }, 'v1']) {
    assert.throws(() => registry.register('k', model(1), opts), bindingError(BINDING_REASONS.MISSING_MODEL_VERSION));
  }
  assert.equal(registry.registryRevision, 0);
  assert.equal(registry.bindingFor('k'), null);
});

test('register rejects an unusable modelKey or model', () => {
  const { registry } = setup();
  for (const key of ['', 5, null, undefined]) {
    assert.throws(() => registry.register(key, model(1), v('v1')), bindingError(BINDING_REASONS.INVALID_MODEL_KEY));
  }
  for (const m of [null, undefined, 3, 'm', Symbol('m')]) {
    assert.throws(() => registry.register('k', m, v('v1')), bindingError(BINDING_REASONS.INVALID_MODEL));
  }
});

test('register is idempotent for the same (key, model, version) and reports generation 1 / placement 0', () => {
  const { registry } = setup();
  const m = model(1);
  registry.register('k', m, v('v1'));
  const rev = registry.registryRevision;
  registry.register('k', m, v('v1'));
  assert.equal(registry.registryRevision, rev);
  const b = registry.bindingFor('k');
  assert.deepEqual(
    [b.modelKey, b.model, b.modelVersion, b.bindingGeneration, b.placementGeneration],
    ['k', m, 'v1', 1, 0],
  );
});

test('a known key offered a different modelVersion throws ModelKeyVersionConflictError, live or after unregister (AC-16)', () => {
  const { registry } = setup();
  const m1 = model(1);
  registry.register('k', m1, v('v1'));
  const conflict = (e) => e instanceof ModelKeyVersionConflictError
    && e.name === 'ModelKeyVersionConflictError' && e.modelKey === 'k'
    && e.existingVersion === 'v1' && e.offeredVersion === 'v2' && e.seen === undefined && e.offered === undefined;
  assert.throws(() => registry.register('k', m1, v('v2')), conflict);
  // version conflict outranks the "key already bound to another live model" rejection
  assert.throws(() => registry.register('k', model(2), v('v2')), conflict);
  registry.unregister(m1);
  assert.throws(() => registry.register('k', model(3), v('v2')), conflict);
  assert.equal(registry.bindingFor('k'), null);
});

test('one live Model maps to at most one modelKey; one modelKey to at most one live Model', () => {
  const { registry } = setup();
  const m1 = model(1);
  registry.register('k1', m1, v('v1'));
  assert.throws(() => registry.register('k2', m1, v('v9')), bindingError(BINDING_REASONS.MODEL_BOUND_TO_OTHER_KEY));
  assert.throws(() => registry.register('k1', model(2), v('v1')), bindingError(BINDING_REASONS.KEY_BOUND_TO_OTHER_MODEL));
  assert.equal(registry.bindingFor('k1').model, m1);
});

test('a rejected register is atomic: no revision bump and no firstSeenVersion claim', () => {
  const { registry } = setup();
  const m1 = model(1);
  registry.register('k1', m1, v('v1'));
  const rev = registry.registryRevision;
  assert.throws(() => registry.register('k2', m1, v('v9')), bindingError(BINDING_REASONS.MODEL_BOUND_TO_OTHER_KEY));
  assert.equal(registry.registryRevision, rev);
  // k2 was never claimed at v9, so a different version is accepted rather than ModelKeyVersionConflictError
  registry.register('k2', model(2), v('v10'));
  assert.equal(registry.bindingFor('k2').modelVersion, 'v10');
});

test('reload of unchanged content bumps bindingGeneration; a late unload of the OLD model cannot kill the new binding', () => {
  const { registry } = setup();
  const m1 = model(1);
  const m2 = model(2);
  registry.register('k', m1, v('v1'));
  assert.equal(registry.unregister(m1), true);
  assert.equal(registry.bindingFor('k'), null);
  registry.register('k', m2, v('v1'));
  assert.equal(registry.bindingFor('k').bindingGeneration, 2);
  assert.equal(registry.bindingFor('k').model, m2);

  const rev = registry.registryRevision;
  assert.equal(registry.unregister(m1), false); // late event for the old model: object identity, never modelKey alone
  assert.equal(registry.registryRevision, rev);
  assert.equal(registry.bindingFor('k').model, m2);
  assert.equal(registry.keyOf(m1), null);
  assert.equal(registry.keyOf(m2), 'k');
});

test('re-registering the SAME object after unregister also bumps bindingGeneration (fail-closed revival)', () => {
  const { registry } = setup();
  const m = model(1);
  registry.register('k', m, v('v1'));
  registry.unregister(m);
  registry.register('k', m, v('v1'));
  assert.equal(registry.bindingFor('k').bindingGeneration, 2);
});

test('changed content must use a new modelKey; the old key stays pinned to its first version', () => {
  const { registry } = setup();
  registry.register('k-old', model(1), v('rev-1'));
  registry.register('k-new', model(2), v('rev-2')); // new key, new version: fine
  assert.throws(() => registry.register('k-old', model(3), v('rev-2')), ModelKeyVersionConflictError);
});

test('unregister never throws and never awaits (handler safety, spec §4.3/§16.6)', () => {
  const { registry, world } = setup();
  registry.register('k', model(1), v('v1'));
  const boom = () => { throw new Error('touched'); };
  const hostile = new Proxy({}, { get: boom, has: boom, ownKeys: boom, getPrototypeOf: boom });
  for (const junk of [undefined, null, 0, 'k', Symbol('s'), {}, hostile, () => {}]) {
    let result;
    assert.doesNotThrow(() => { result = registry.unregister(junk); });
    assert.equal(result, false);
    assert.doesNotThrow(() => registry.keyOf(junk));
  }
  assert.notEqual(registry.unregister.constructor.name, 'AsyncFunction');
  assert.equal(typeof registry.unregister(model(2))?.then, 'undefined');
  assert.equal(world.calls.evictModel, 0); // the registry never evicts; the host wires evictModel beside it
  assert.notEqual(registry.bindingFor('k'), null);
});

test('registrySessionId is a stable read-only nonce, distinct per registry', () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i += 1) ids.add(new ModelRegistry({ world: makeLeaseWorld() }).registrySessionId);
  assert.equal(ids.size, 1000);

  const { registry } = setup();
  const id = registry.registrySessionId;
  assert.equal(typeof id, 'string');
  assert.ok(id.length >= 16);
  registry.register('k', model(1), v('v1'));
  assert.equal(registry.registrySessionId, id);
  assert.throws(() => { registry.registrySessionId = 'x'; }, TypeError);
  assert.throws(() => { registry.registryRevision = 0; }, TypeError);
  assert.throws(() => { registry.world = null; }, TypeError);
});

test('makeSessionId is an injectable seam and must return a non-empty string', () => {
  const world = makeLeaseWorld();
  assert.equal(new ModelRegistry({ world, makeSessionId: () => 'fixed-session' }).registrySessionId, 'fixed-session');
  assert.throws(() => new ModelRegistry({ world, makeSessionId: () => '' }), TypeError);
  assert.throws(() => new ModelRegistry({ world, makeSessionId: () => 5 }), TypeError);
});

test('registryRevision bumps on every effective register/unregister and on nothing else', () => {
  const { registry } = setup();
  const m = model(1);
  assert.equal(registry.registryRevision, 0);
  registry.register('k', m, v('v1'));
  assert.equal(registry.registryRevision, 1);
  registry.register('k', m, v('v1'));                                   // idempotent
  assert.throws(() => registry.register('k', m, v('v2')));              // rejected
  registry.bindingFor('k');                                             // read
  assert.equal(registry.registryRevision, 1);
  registry.unregister(m);
  assert.equal(registry.registryRevision, 2);
  registry.unregister(m);                                               // no-op
  assert.equal(registry.registryRevision, 2);
});

test('the lease is obtained lazily on first read, then cached', () => {
  const { registry, world } = setup();
  const m = model(1);
  registry.register('k', m, v('v1'));
  assert.equal(world.calls.admitModel, 0);
  const b = registry.bindingFor('k');
  assert.equal(world.calls.admitModel, 1);
  assert.equal(b.lease.model, m);
  assert.equal(world.isLeaseValid(b.lease), true);
  registry.bindingFor('k');
  assert.equal(world.calls.admitModel, 1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/clashtest/identity/ModelRegistry.register.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `clashtest/identity/ModelRegistry.js`.

- [ ] **Step 3: Write the implementation** (P1.6–P1.8 anchor comments included; leave them)

```js
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

  // (P1.6 adds: snapshotBindings, isBindingCurrent)
  // (P1.7 adds: notifyPlacementChanged, invalidateModelPlacement)

  /**
   * The single atomic reader behind bindingFor / snapshotBindings. `keys` is an already-copied array.
   * Phase 1 reads registry state only (synchronous, no world call, no user code); phase 2 resolves leases.
   */
  #read(keys) {
    const registryRevision = this.#revision;
    const captured = keys.map((key) => {
      const entry = typeof key === 'string' ? this.#entries.get(key) : undefined;
      if (entry === undefined || !entry.alive) return null;
      return {
        entry,
        modelKey: entry.modelKey,
        model: entry.model,
        modelVersion: entry.modelVersion,
        lease: entry.lease,
        bindingGeneration: entry.bindingGeneration,
        placementGeneration: entry.placementGeneration,
      };
    });
    const bindings = captured.map((c) => (c === null ? null : this.#resolveLease(c)));
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

// (P1.6 adds: bindingsEquivalent)
// (P1.8 adds: assertRegistryBelongsToWorld)
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/clashtest/identity/ModelRegistry.register.test.mjs`
Expected: PASS, 17 tests. (This step also requires P0's `clashtest/errors.js` to export the two error classes.)

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits)** — `git add clashtest/identity/ModelRegistry.js test/clashtest/identity/ModelRegistry.register.test.mjs && git commit -m "feat(clashtest): ModelRegistry bindings, version guard, generations (P1.5)"`.

---

### Task P1.6: `snapshotBindings`, immutability, leases, `bindingsEquivalent`, `isBindingCurrent`

**Files**
- Modify: `clashtest/identity/ModelRegistry.js`
- Test: `test/clashtest/identity/ModelRegistry.snapshot.test.mjs`

**Interfaces**
- Consumes: P1.5's `ModelRegistry`; the fake world (P1.4); the real `CollisionWorld` (one cross-check test).
- Produces: `registry.snapshotBindings`, `registry.isBindingCurrent`, `bindingsEquivalent`. P6 uses `snapshotBindings` at the `queued → planning` boundary (spec §5.2) and for the three freshness brackets (§16.4); P3/P4 read `binding.model`/`binding.lease`.

- [ ] **Step 1: Write the failing test**

```js
// test/clashtest/identity/ModelRegistry.snapshot.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../../../collision/index.js';
import { ModelRegistry, bindingsEquivalent } from '../../../clashtest/identity/ModelRegistry.js';
import { makeLeaseWorld } from '../support/leaseWorld.mjs';

const model = (id) => ({ id });
const v = (modelVersion) => ({ modelVersion });

function setup() {
  const world = makeLeaseWorld();
  return { world, registry: new ModelRegistry({ world }) };
}

test('snapshotBindings returns a frozen {registryRevision, bindings} aligned with the input, duplicates allowed', () => {
  const { registry } = setup();
  const m1 = model(1);
  registry.register('k1', m1, v('v1'));
  const snap = registry.snapshotBindings(['k1', 'nope', 'k1', 42]);
  assert.equal(snap.registryRevision, registry.registryRevision);
  assert.equal(snap.bindings.length, 4);
  assert.equal(snap.bindings[0].model, m1);
  assert.equal(snap.bindings[1], null);
  assert.equal(snap.bindings[2].model, m1);
  assert.equal(snap.bindings[3], null); // a non-string key cannot be bound
  assert.equal(Object.isFrozen(snap) && Object.isFrozen(snap.bindings), true);
  assert.deepEqual(registry.snapshotBindings([]), { registryRevision: registry.registryRevision, bindings: [] });
  assert.throws(() => registry.snapshotBindings(undefined), TypeError);
});

test('a Binding has exactly the spec shape, is frozen, and later mutation never changes an old snapshot', () => {
  const { registry } = setup();
  const m1 = model(1);
  registry.register('k1', m1, v('v1'));
  const snap = registry.snapshotBindings(['k1']);
  const b = snap.bindings[0];
  assert.deepEqual(Object.keys(b), ['modelKey', 'model', 'modelVersion', 'lease', 'bindingGeneration', 'placementGeneration']);
  assert.equal(Object.isFrozen(b), true);
  assert.throws(() => { b.placementGeneration = 9; }, TypeError);

  registry.unregister(m1);
  registry.register('k1', model(2), v('v1'));
  assert.equal(snap.bindings[0].model, m1);
  assert.equal(snap.bindings[0].bindingGeneration, 1);
  assert.equal(registry.snapshotBindings(['k1']).bindings[0].bindingGeneration, 2);
});

test('snapshotBindings is synchronous', () => {
  const { registry } = setup();
  assert.notEqual(registry.snapshotBindings.constructor.name, 'AsyncFunction');
  assert.equal(typeof registry.snapshotBindings([])?.then, 'undefined');
});

test('a mutation triggered from inside the read cannot yield a mixed-generation snapshot (R13-6, AC-8)', () => {
  const { registry, world } = setup();
  const m1 = model(1);
  const m2 = model(2);
  registry.register('k1', m1, v('v1'));
  registry.register('k2', m2, v('v1'));
  const revisionBefore = registry.registryRevision;
  let fired = false;
  world.hooks.beforeIsLeaseValid = () => {          // runs INSIDE the snapshot, during lease resolution
    if (fired) return;
    fired = true;
    registry.unregister(m1);
    registry.register('k3', model(3), v('v1'));
  };
  const snap = registry.snapshotBindings(['k1', 'k2']);
  assert.equal(fired, true);
  assert.equal(snap.registryRevision, revisionBefore);   // the snapshot is "as of" this revision...
  assert.equal(snap.bindings[0].model, m1);               // ...not a blend with the mutation
  assert.equal(snap.bindings[1].model, m2);
  const after = registry.snapshotBindings(['k1', 'k2']);
  assert.ok(after.registryRevision > revisionBefore);
  assert.equal(after.bindings[0], null);
});

test('a key list whose iteration mutates the registry is fully applied before anything is read', () => {
  const { registry } = setup();
  registry.register('k1', model(1), v('v1'));
  function* keys() {
    yield 'k1';
    registry.register('k3', model(3), v('v1'));
    yield 'k3';
  }
  const snap = registry.snapshotBindings(keys());
  assert.equal(snap.registryRevision, registry.registryRevision);
  assert.notEqual(snap.bindings[1], null);
});

test('leases: valid at read time; a world that evicted the model reads as unbound even without unregister (fail closed)', () => {
  const { registry, world } = setup();
  const m1 = model(1);
  registry.register('k1', m1, v('v1'));
  const b = registry.bindingFor('k1');
  assert.equal(world.isLeaseValid(b.lease), true);
  assert.equal(b.lease.model, m1);

  world.evictModel(m1);
  assert.equal(registry.bindingFor('k1'), null);       // cached lease no longer valid
  assert.equal(registry.keyOf(m1), 'k1');              // the registry itself still lists the binding until unregister

  const m2 = model(2);
  registry.register('k2', m2, v('v1'));
  world.evictModel(m2);                                // evicted BEFORE its first (lazy) admit
  assert.equal(registry.bindingFor('k2'), null);
});

test('a disposed world makes every binding read as unbound', () => {
  const { registry, world } = setup();
  registry.register('k1', model(1), v('v1'));
  assert.notEqual(registry.bindingFor('k1'), null);
  world.dispose();
  assert.equal(registry.bindingFor('k1'), null);
  assert.deepEqual(registry.snapshotBindings(['k1']).bindings, [null]);
});

test('against the real CollisionWorld: lease is valid, then null after evictModel', () => {
  const world = new CollisionWorld();
  const registry = new ModelRegistry({ world });
  const m = model(1);
  registry.register('k', m, v('v1'));
  const b = registry.bindingFor('k');
  assert.equal(world.isLeaseValid(b.lease), true);
  world.evictModel(m);
  assert.equal(registry.bindingFor('k'), null);
});

test('bindingsEquivalent compares key, model OBJECT, version and both generations; ignores lease and revision', () => {
  const { registry } = setup();
  const m1 = model(1);
  registry.register('k1', m1, v('v1'));
  const a = registry.bindingFor('k1');
  const b = registry.bindingFor('k1');
  assert.notEqual(a, b);                                // distinct snapshot objects...
  assert.equal(bindingsEquivalent(a, b), true);         // ...same state
  assert.equal(bindingsEquivalent(null, null), true);
  assert.equal(bindingsEquivalent(undefined, null), true);
  assert.equal(bindingsEquivalent(a, null), false);
  assert.equal(bindingsEquivalent(null, a), false);
  for (const patch of [{ modelKey: 'x' }, { model: model(1) }, { modelVersion: 'v2' },
    { bindingGeneration: 2 }, { placementGeneration: 1 }]) {
    assert.equal(bindingsEquivalent(a, { ...a, ...patch }), false, JSON.stringify(Object.keys(patch)));
  }
  assert.equal(bindingsEquivalent(a, { ...a, lease: { model: m1, epoch: 999 } }), true);
});

test('every snapshot binding carries a valid CACHED lease: one admission per live binding, the same lease object on every read (P6 admits nothing itself)', () => {
  const { registry, world } = setup();
  const m1 = model(1);
  const m2 = model(2);
  registry.register('k1', m1, v('v1'));
  registry.register('k2', m2, v('v1'));
  assert.equal(world.calls.admitModel, 0);
  const s1 = registry.snapshotBindings(['k1', 'k2', 'k1']);
  const s2 = registry.snapshotBindings(['k2', 'k1']);
  assert.equal(world.calls.admitModel, 2);                                   // once per live binding, however many reads
  for (const b of [...s1.bindings, ...s2.bindings]) {
    assert.notEqual(b.lease, null);
    assert.equal(world.isLeaseValid(b.lease), true);                          // valid at read time
    assert.equal(Object.isFrozen(b), true);
  }
  assert.equal(s1.bindings[0].lease, s2.bindings[1].lease);                   // the SAME cached lease object
  assert.equal(s1.bindings[0].lease.model, m1);
  assert.throws(() => { s1.bindings[0].lease = null; }, TypeError);          // a frozen Binding cannot take a replacement lease
  // a lease that died is never returned: the binding downgrades to null instead
  world.evictModel(m1);
  assert.deepEqual(registry.snapshotBindings(['k1', 'k2']).bindings.map((b) => b?.modelKey ?? null), [null, 'k2']);
});

test('a dead / unregistered / evicted / disposed binding reads as null in snapshotBindings, and no returned Binding has a `dead` property (N10)', () => {
  const { registry, world } = setup();
  const m1 = model(1); const m2 = model(2); const m3 = model(3);
  registry.register('live', m1, v('v1'));
  registry.register('gone', m2, v('v1'));
  registry.register('evicted', m3, v('v1'));
  registry.unregister(m2);
  registry.snapshotBindings(['evicted']);                                     // lease cached, then the world drops it
  world.evictModel(m3);
  const snap = registry.snapshotBindings(['live', 'gone', 'evicted', 'never']);
  assert.deepEqual(snap.bindings.map((b) => b?.modelKey ?? null), ['live', null, null, null]);
  for (const b of snap.bindings.filter((x) => x !== null)) {
    assert.equal('dead' in b, false);
    assert.equal('alive' in b, false);
    assert.equal(b.dead, undefined);
    assert.deepEqual(Object.keys(b), ['modelKey', 'model', 'modelVersion', 'lease', 'bindingGeneration', 'placementGeneration']);
  }
  assert.equal('dead' in registry.bindingFor('live'), false);
  // a held binding that later dies is detected through isBindingCurrent, never through a flag
  const held = snap.bindings[0];
  assert.equal(registry.isBindingCurrent(held), true);
  registry.unregister(m1);
  assert.equal(registry.isBindingCurrent(held), false);
  assert.equal(registry.bindingFor('live'), null);
  world.dispose();
  assert.deepEqual(registry.snapshotBindings(['live', 'gone']).bindings, [null, null]);
});

test('an unrelated registry mutation does not disturb an equal touched binding (§16.4)', () => {
  const { registry } = setup();
  registry.register('k1', model(1), v('v1'));
  const s1 = registry.snapshotBindings(['k1']);
  registry.register('k9', model(9), v('v1'));
  const s2 = registry.snapshotBindings(['k1']);
  assert.notEqual(s1.registryRevision, s2.registryRevision);
  assert.equal(bindingsEquivalent(s1.bindings[0], s2.bindings[0]), true);
});

test('isBindingCurrent is true only while the registry still holds exactly that binding', () => {
  const { registry } = setup();
  const m1 = model(1);
  registry.register('k1', m1, v('v1'));
  const b = registry.bindingFor('k1');
  assert.equal(registry.isBindingCurrent(b), true);
  registry.unregister(m1);
  assert.equal(registry.isBindingCurrent(b), false);                // dead
  registry.register('k1', model(2), v('v1'));
  assert.equal(registry.isBindingCurrent(b), false);                // replaced (new Model, generation 2)
  for (const junk of [null, undefined, {}, 'k1', 5]) assert.equal(registry.isBindingCurrent(junk), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/clashtest/identity/ModelRegistry.snapshot.test.mjs`
Expected: FAIL — `SyntaxError ... does not provide an export named 'bindingsEquivalent'`.

- [ ] **Step 3: Add the implementation** — in `ModelRegistry.js` replace the `// (P1.6 adds: snapshotBindings, isBindingCurrent)` comment inside the class, and the `// (P1.6 adds: bindingsEquivalent)` comment after it.

Inside the class:

```js
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

```

After the class:

```js
/**
 * Equality used by freshness brackets (spec §16.4): both null, or the same key, the same Model OBJECT,
 * the same version and both generations. The lease is deliberately not compared.
 */
export function bindingsEquivalent(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  return a.modelKey === b.modelKey
    && a.model === b.model
    && a.modelVersion === b.modelVersion
    && a.bindingGeneration === b.bindingGeneration
    && a.placementGeneration === b.placementGeneration;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/clashtest/identity/ModelRegistry.snapshot.test.mjs test/clashtest/identity/ModelRegistry.register.test.mjs`
Expected: PASS (snapshot 13 + register 17).

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits)** — `git commit -am "feat(clashtest): atomic snapshotBindings and binding equivalence (P1.6)"`.

---

### Task P1.7: Placement generation — `notifyPlacementChanged` and `invalidateModelPlacement`

**Files**
- Modify: `clashtest/identity/ModelRegistry.js`
- Test: `test/clashtest/identity/ModelRegistry.placement.test.mjs`

**Interfaces**
- Consumes: P1.5/P1.6; world `invalidateModelPlacement(model)` (spec F13; may throw `ModelEvictedError` / `WorldDisposedError`).
- Produces: `registry.notifyPlacementChanged(modelKey) → number`, `registry.invalidateModelPlacement(modelKey) → number`. P7's `engine.invalidateModelPlacement(modelKey)` delegates to the latter; P6 compares `placementGeneration` at unit boundaries (spec §16.3).

- [ ] **Step 1: Write the failing test**

```js
// test/clashtest/identity/ModelRegistry.placement.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelRegistry, BINDING_REASONS, bindingsEquivalent } from '../../../clashtest/identity/ModelRegistry.js';
import { ModelBindingError } from '../../../clashtest/errors.js';
import { makeLeaseWorld } from '../support/leaseWorld.mjs';

const model = (id) => ({ id });
const v = (modelVersion) => ({ modelVersion });
const notBound = (e) => e instanceof ModelBindingError && e.reason === BINDING_REASONS.MODEL_NOT_BOUND;

function setup() {
  const world = makeLeaseWorld();
  const registry = new ModelRegistry({ world });
  const m = model(1);
  registry.register('k', m, v('v1'));
  return { world, registry, m };
}

test('notifyPlacementChanged bumps placementGeneration and the revision, and returns the new generation', () => {
  const { registry } = setup();
  const rev = registry.registryRevision;
  assert.equal(registry.notifyPlacementChanged('k'), 1);
  assert.equal(registry.notifyPlacementChanged('k'), 2);
  assert.equal(registry.registryRevision, rev + 2);
  const b = registry.bindingFor('k');
  assert.equal(b.placementGeneration, 2);
  assert.equal(b.bindingGeneration, 1);   // placement is not a binding change
});

test('notifyPlacementChanged on an unbound or dead key throws ModelBindingError with reason model-not-bound and changes nothing', () => {
  const { registry, m } = setup();
  const rev = registry.registryRevision;
  assert.throws(() => registry.notifyPlacementChanged('nope'), notBound);
  registry.unregister(m);
  const rev2 = registry.registryRevision;
  assert.throws(() => registry.notifyPlacementChanged('k'), notBound);
  assert.equal(registry.registryRevision, rev2);
  assert.ok(rev2 > rev);
});

test('invalidateModelPlacement calls the world once with the live Model AND bumps the generation (§16.2 single call)', () => {
  const { registry, world, m } = setup();
  const seen = [];
  const original = world.invalidateModelPlacement;
  world.invalidateModelPlacement = (model_) => { seen.push(model_); return original(model_); };
  assert.equal(registry.invalidateModelPlacement('k'), 1);
  assert.deepEqual(seen, [m]);
  assert.equal(world.calls.invalidateModelPlacement, 1);
  assert.equal(registry.bindingFor('k').placementGeneration, 1);
});

test('invalidateModelPlacement bumps first: a throwing world (evicted model) still leaves the generation moved', () => {
  const { registry, world, m } = setup();
  world.evictModel(m);
  assert.throws(() => registry.invalidateModelPlacement('k'), (e) => e.name === 'ModelEvictedError');
  assert.equal(registry.snapshotBindings(['k']).bindings[0], null);           // evicted => unbound now
  // the generation moved anyway (over-invalidation is fail-closed): observable after a re-register
  registry.unregister(m);
  registry.register('k', model(2), v('v1'));
  assert.equal(registry.bindingFor('k').placementGeneration, 1);
});

test('invalidateModelPlacement on an unbound key throws before touching the world', () => {
  const { registry, world } = setup();
  assert.throws(() => registry.invalidateModelPlacement('nope'), notBound);
  assert.equal(world.calls.invalidateModelPlacement, 0);
});

test('placementGeneration is monotonic across reloads; bindingGeneration is separate', () => {
  const { registry, m } = setup();
  registry.notifyPlacementChanged('k');
  registry.notifyPlacementChanged('k');
  registry.unregister(m);
  registry.register('k', model(2), v('v1'));
  const b = registry.bindingFor('k');
  assert.equal(b.placementGeneration, 2);
  assert.equal(b.bindingGeneration, 2);
});

test('a placement change between snapshots is visible through bindingsEquivalent; an unrelated one is not (AC-8 bracket)', () => {
  const { registry } = setup();
  registry.register('other', model(5), v('v1'));
  const s1 = registry.snapshotBindings(['k']);
  registry.notifyPlacementChanged('other');
  const s2 = registry.snapshotBindings(['k']);
  assert.equal(bindingsEquivalent(s1.bindings[0], s2.bindings[0]), true);
  registry.notifyPlacementChanged('k');
  const s3 = registry.snapshotBindings(['k']);
  assert.equal(bindingsEquivalent(s2.bindings[0], s3.bindings[0]), false);
  assert.equal(registry.isBindingCurrent(s2.bindings[0]), false);
  assert.equal(registry.isBindingCurrent(s3.bindings[0]), true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/clashtest/identity/ModelRegistry.placement.test.mjs`
Expected: FAIL — `TypeError: registry.notifyPlacementChanged is not a function` (first test).

- [ ] **Step 3: Add the implementation** — replace the `// (P1.7 adds: ...)` comment inside the class:

```js
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/clashtest/identity/ModelRegistry.placement.test.mjs test/clashtest/identity/ModelRegistry.snapshot.test.mjs test/clashtest/identity/ModelRegistry.register.test.mjs`
Expected: PASS (see the per-file counts in each task's Step 4).

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits)** — `git commit -am "feat(clashtest): placement generation and invalidateModelPlacement (P1.7)"`.

---

### Task P1.8: World scoping, public-surface-only and layering guards

**Files**
- Modify: `clashtest/identity/ModelRegistry.js`
- Test: `test/clashtest/identity/identity.guards.test.mjs`

**Interfaces**
- Consumes: everything above.
- Produces: `assertRegistryBelongsToWorld(registry, world) → registry`. **P6 owns the coordinator**: the `WeakMap<CollisionWorld, Coordinator>` stored on `globalThis` under `Symbol.for('clashtest.coordinators')`, `protocolVersion` / `ModelBindingError{reason:'coordinator-version-mismatch'}`, and the creation of the one registry per world. P6 calls `assertRegistryBelongsToWorld(options.registry, world)` first, then compares `options.registry !== coordinator.registry` and throws `ModelBindingError{reason:'registry-mismatch'}` itself (spec §4.3, AC-8). P1 deliberately ships **no** `getRegistryForWorld` (design decision 7); the check is duck-typed so a registry from a duplicate module copy on the same page is still recognized (spec §7.3 cross-bundle rationale).

- [ ] **Step 1: Write the failing test**

```js
// test/clashtest/identity/identity.guards.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModelRegistry, BINDING_REASONS, assertRegistryBelongsToWorld } from '../../../clashtest/identity/ModelRegistry.js';
import { ModelBindingError } from '../../../clashtest/errors.js';
import { makeElementRef, makePairId, makeResultId } from '../../../clashtest/identity/ids.js';
import { makeLeaseWorld } from '../support/leaseWorld.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const clashtestDir = path.resolve(here, '../../../clashtest');
const mismatch = (e) => e instanceof ModelBindingError && e.reason === BINDING_REASONS.REGISTRY_MISMATCH && e.reason === 'registry-mismatch';

test('registry.world is the world it was built for; assertRegistryBelongsToWorld accepts exactly that pairing', () => {
  const world = makeLeaseWorld();
  const registry = new ModelRegistry({ world });
  assert.equal(registry.world, world);
  assert.equal(assertRegistryBelongsToWorld(registry, world), registry);
});

test('a registry for another world, or a non-registry, is ModelBindingError with reason registry-mismatch (AC-8)', () => {
  const registry = new ModelRegistry({ world: makeLeaseWorld() });
  assert.throws(() => assertRegistryBelongsToWorld(registry, makeLeaseWorld()), mismatch);
  for (const junk of [null, undefined, {}, 'registry', { world: registry.world }]) {
    assert.throws(() => assertRegistryBelongsToWorld(junk, registry.world), mismatch);
  }
});

test('the registry reaches the world only through admitModel / isLeaseValid / invalidateModelPlacement', () => {
  const inner = makeLeaseWorld();
  const touched = new Set();
  const world = new Proxy(inner, { get(target, prop) { touched.add(String(prop)); return Reflect.get(target, prop); } });
  const registry = new ModelRegistry({ world });
  const m1 = { id: 1 };
  const m2 = { id: 2 };
  registry.register('k1', m1, { modelVersion: 'v1' });
  registry.register('k2', m2, { modelVersion: 'v1' });
  registry.snapshotBindings(['k1', 'k2']);
  registry.bindingFor('k1');
  registry.notifyPlacementChanged('k1');
  registry.invalidateModelPlacement('k2');
  registry.isBindingCurrent(registry.bindingFor('k1'));
  registry.unregister(m1);
  registry.keyOf(m2);
  const allowed = new Set(['admitModel', 'isLeaseValid', 'invalidateModelPlacement']);
  for (const name of touched) assert.ok(allowed.has(name), `registry touched world.${name}`);
  assert.equal(inner.calls.evictModel, 0);
});

test('layering: identity modules import only from within clashtest/ and never from collision/, wwwroot/, three or the Viewer', () => {
  const importRe = /^\s*(?:import|export)\s[^;]*?\sfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;
  for (const file of ['identity/ids.js', 'identity/ModelRegistry.js']) {
    const abs = path.join(clashtestDir, file);
    const source = readFileSync(abs, 'utf8');
    for (const match of source.matchAll(importRe)) {
      const spec = match[1] ?? match[2];
      assert.ok(spec.startsWith('.'), `${file} imports non-relative "${spec}"`);
      const resolved = path.resolve(path.dirname(abs), spec);
      assert.ok(resolved.startsWith(`${clashtestDir}${path.sep}`), `${file} imports outside clashtest/: ${spec}`);
    }
    assert.doesNotMatch(source, /globalThis\.THREE|\bAutodesk\b|wwwroot|collision\//);
  }
  // ids.js is import-free: it cannot reach a Model even by accident
  assert.doesNotMatch(readFileSync(path.join(clashtestDir, 'identity/ids.js'), 'utf8'), /^\s*import\s/m);
});

test('no Model / loadEpoch / modelId can enter a durable identity, even from a live Binding', () => {
  const world = makeLeaseWorld();
  const registry = new ModelRegistry({ world });
  const m = { id: 77 };
  registry.register('k', m, { modelVersion: 'v1' });
  const binding = registry.bindingFor('k');
  // A careless caller hands the whole binding (Model, lease/epoch, generations) where an element is expected:
  const ref = makeElementRef(binding.modelKey, 5);
  const other = { ...binding, dbId: 6 };
  const pair = makePairId('volume-overlap', ref, other);
  const id = makeResultId('t', `sha256:${'b'.repeat(64)}`, pair);
  for (const text of [JSON.stringify(pair), id]) {
    assert.doesNotMatch(text, /"model"|epoch|loadEpoch|modelId|"id":77|Generation/);
  }
  assert.deepEqual(Object.keys(pair.first), ['modelKey', 'dbId']);
  assert.deepEqual(Object.keys(pair.second), ['modelKey', 'dbId']);
});
```

Note: `{ ...binding, dbId: 6 }` has `modelKey: 'k'` and `dbId: 6`, so it is valid and distinct from `ref` (`'k'`, 5); the point of the test is that `elementRefFrom` drops the Model/lease/generation fields.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/clashtest/identity/identity.guards.test.mjs`
Expected: FAIL — `SyntaxError ... does not provide an export named 'assertRegistryBelongsToWorld'`.

- [ ] **Step 3: Add the implementation** — replace the trailing `// (P1.8 adds: assertRegistryBelongsToWorld)` comment:

```js
const REGISTRY_METHODS = ['register', 'unregister', 'bindingFor', 'snapshotBindings', 'notifyPlacementChanged'];

/**
 * True iff `registry` is a registry built for exactly `world`. Duck-typed on purpose: a duplicate module copy
 * on the same page (spec §7.3) produces registries that fail `instanceof` but must still be recognized.
 * P6's coordinator owns the world -> registry map and the final `registry !== coordinator.registry` check.
 * @throws {ModelBindingError} reason 'registry-mismatch'
 */
export function assertRegistryBelongsToWorld(registry, world) {
  const looksLikeRegistry = typeof registry === 'object' && registry !== null
    && REGISTRY_METHODS.every((m) => typeof registry[m] === 'function')
    && typeof registry.registrySessionId === 'string';
  if (!looksLikeRegistry || registry.world !== world) {
    throw new ModelBindingError({ reason: BINDING_REASONS.REGISTRY_MISMATCH });
  }
  return registry;
}
```

- [ ] **Step 4: Run the whole phase**

Run:
```
node --test test/clashtest/identity/ids.elementRef.test.mjs test/clashtest/identity/ids.pairId.test.mjs test/clashtest/identity/ids.resultId.test.mjs test/clashtest/identity/ModelRegistry.register.test.mjs test/clashtest/identity/ModelRegistry.snapshot.test.mjs test/clashtest/identity/ModelRegistry.placement.test.mjs test/clashtest/identity/identity.guards.test.mjs test/clashtest/support/leaseWorld.contract.test.mjs
```
Expected: PASS, all files, 0 failures.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS with no live server / APS credentials; the pre-existing suites are untouched (this phase edits nothing outside `clashtest/identity/` and `test/clashtest/`).

- [ ] **Step 6: Checkpoint commit (only if the user has authorized commits)** — `git commit -am "feat(clashtest): registry world scoping and identity guards (P1.8)"`.

---

## Verification / acceptance for P1

Run individually with `node --test <file>`; the phase passes when every command below exits 0 and `npm test` is green.

- [ ] `node --test test/clashtest/identity/ids.elementRef.test.mjs` — ElementRef closed/frozen/`-0`; code-unit (not code-point, not locale) element order; **`elementRefKey`** injective on delimiter-shaped `modelKey`s and order-preserving against `compareElementRefs` (7 tests).
- [ ] `node --test test/clashtest/identity/ids.pairId.test.mjs` — semantics derived from mode (§4.5); unordered collapses `(x,y)/(y,x)`; containment keeps orientation; 20-seed shuffle property tests (120 unordered / 240 ordered pairs); same `PairId` across all three unordered modes (**AC-14 (iv)**, identity part; the rerun/compare side is P8/P7); §11.3 canonical order; no Model/epoch/modelId in a `PairId`.
- [ ] `node --test test/clashtest/identity/ids.resultId.test.mjs` — canonical string form (§4.4), arity 3, stability, delimiter-safety incl. lone surrogates, strict `parseResultId`, digest sensitivity to mode/clearance/selections/swap through P0's canonical util, distinct `modelKey`s over identical dbIds give distinct `ResultId`s (**AC-16 "Identity" last clause**).
- [ ] `node --test test/clashtest/identity/ModelRegistry.register.test.mjs` — **AC-16 "Identity"**: `register` without `modelVersion` throws `ModelBindingError`; re-register with a different version (also after `unregister`) throws `ModelKeyVersionConflictError`; a reload of unchanged content bumps `bindingGeneration`; one live Model ↔ one key; atomic rejection; late-unload identity rule; `unregister` never throws/awaits (spec §16.6); `registrySessionId` nonce; **`createModelRegistry`** factory (world required, no `now`); typed errors carry `.reason` / `.existingVersion` / `.offeredVersion` (never `.code` / `.seen`) (17 tests).
- [ ] `node --test test/clashtest/identity/ModelRegistry.snapshot.test.mjs` — **AC-8 (R13-6)**: mutation from inside the read or from the key iterator cannot yield a mixed-generation snapshot; synchronous, frozen; lease semantics against fake and real `CollisionWorld`; **every snapshot binding carries a valid cached lease, admitted at most once per live binding (P6 admits nothing)**; **a dead / unregistered / evicted / disposed binding reads as `null` and no returned `Binding` has a `dead` (or `alive`) property (N10)**; `bindingsEquivalent` / `isBindingCurrent` as used by the §16.4 brackets (13 tests).
- [ ] `node --test test/clashtest/identity/ModelRegistry.placement.test.mjs` — §16.2 placement generation, single-call `invalidateModelPlacement` (bump-first), monotonicity across reloads, bracket visibility; supports the registry half of **AC-8** placement/`notifyPlacementChanged` scenarios (the run-level `invalidated` outcome is P6).
- [ ] `node --test test/clashtest/identity/identity.guards.test.mjs` — `registry-mismatch` check (**AC-8** last clause; the construction-time throw itself is P6), public-surface-only, layering, no runtime identity in durable ids (**spec D3/D11, §13.4**).
- [ ] `node --test test/clashtest/support/leaseWorld.contract.test.mjs` — fake ≡ real world on the lease surface.
- [ ] `npm test` — full suite green.

AC items only partly covered here (the remainder has a named owner): **AC-1** digest goldens and `semanticDigest` invariance → P0/P2 (P1 contributes the ResultId coupling); **AC-11** durable `modelKey → modelVersion` index and `IdentityConflictError` atomicity → P5; **AC-11** "unknown field inside a `PairId` is rejected" → P5's `validateResultSet` (P1 supplies the closed shape and `isValidModelKey`/`isValidDbId`); **AC-14** compare classification → P8; **AC-15** "same `PairId` whichever role the planner assigned" end-to-end → P3/P7 (P1 supplies the invariance property, tested here).

## Spec coverage

| Spec § | Covered by |
|---|---|
| §3 vocabulary (`ElementRef`, Binding, `PairId`/`ResultId`) | Interface summary types; P1.1–P1.3, P1.5 |
| §4.1 runtime identity never durable | P1.1, P1.2, P1.8 (no-leak + layering guards) |
| §4.2 `modelKey`/`modelVersion`, enforcement point 1 (registry) | P1.5 (register guard); points 2–3 → P5 / P6 / P8 (out of P1) |
| §4.3 `ModelRegistry` (register, unregister, bindingFor, snapshotBindings, keyOf, registrySessionId, notifyPlacementChanged, generations, one-Model-one-key, world-scoped) | P1.5, P1.6, P1.7, P1.8 (world scoping; coordinator ownership → P6) |
| §4.4 `ElementRef`, element order, `PairId`, `ResultId`, comparability | P1.1, P1.2, P1.3 |
| §4.5 symmetry class derived from mode | P1.2 |
| §5.2 snapshot boundary (single `snapshotBindings` call) — the registry side | P1.6 |
| §5.4 `ResultId` ⇄ `semanticDigest` coupling (digest format check, sensitivity) | P1.3 (real `semanticDigest` → P2) |
| §11.3 canonical result order (`comparePairIds`) | P1.2 |
| §16.2 placement generation, `invalidateModelPlacement` | P1.7 |
| §16.4 registry side of freshness brackets (`snapshotBindings`, `registrySessionId`) | P1.5, P1.6, P1.7 (loop → P6) |
| §16.6 handler safety of `unregister` | P1.5 |
| §18 `ModelBindingError{reason:'registry-mismatch'}` | P1.8 (`assertRegistryBelongsToWorld`; construction throw → P6) |

## Gates and open items

**Master gates.** None blocks any task of this phase. **G-OQ1** (durable `modelKey`/`modelVersion` witness derivation) blocks only the Viewer adapter/Panel; P1 treats both as host-supplied opaque strings and its tests use fixtures. **G-OQ17** (placement-invalidation owner) blocks only Host integration; P1 supplies `notifyPlacementChanged` / `invalidateModelPlacement` and documents the host obligation. **G-PLAN** applies to starting implementation. P1 depends on **P0** landing `clashtest/errors.js` (two classes) and `clashtest/util/canonical.js` (P1.3's digest tests only).

**Consumed from P0 — RECONCILED against P0's *Phase interface summary* (producer wins; see [`interface-reconciliation.md`](interface-reconciliation.md) rows N1, N2, N3):**
1. `new ModelBindingError({ reason, modelKey, message?, cause? })` — **object argument, not positional**; the field is `.reason` (never `.code`), and `modelKey` may be `null`. `new ModelKeyVersionConflictError({ modelKey, existingVersion, offeredVersion })` — **`existingVersion`/`offeredVersion`, not `seen`/`offered`** (P1.5+). Every P1 throw site and every P1 test assertion uses these exact names.
2. `digestCanonical(value) → 'sha256:…'` (synchronous) and `digestCanonicalSliced(value, slicer, {label?}) → Promise<'sha256:…'>` in `clashtest/util/canonical.js`. There is no `digestOf`. P1.3's digest tests use the **synchronous** `digestCanonical` (the values are small), so the `await` originally planned there is removed.
3. P0's shared fake world may already provide the lease surface; P1.4 ships an independent, contract-checked `leaseWorld.mjs` so P1 does not depend on it.

**Left to implementers, with reasons:**
- `makeSessionId` default format (`regsess-` + 32 hex from `crypto.getRandomValues`): any collision-resistant nonce satisfies spec §16.4; `randomUUID` was avoided because it is unavailable in non-secure browser contexts.
- Whether `ModelRegistry.js` should later split `bindingsEquivalent`/`assertRegistryBelongsToWorld` into separate modules: pure organization; keep the exported names.
- Unbounded growth of the `firstSeenVersion` ledger: required by spec (§4.2, "for the registry's lifetime"); it is one short string per distinct `modelKey`.
- Registration-time validation of `modelVersion` length: the spec sets no bound; Definition-level string bounds are P2's V-rules.

**Cross-phase items for the controller (do not resolve inside P1):**
- **P2** must import `CLASH_MODES` / `pairSemanticsOf` from `identity/ids.js` rather than redefine them, and must reject a caller-supplied `pairSemantics` field (§4.5). **RESOLVED** — P2's *Gates and open items* item 7 ("P2 imports nothing from P1") is corrected: this is a real module edge and the master §3 table now records it.
- **P5** must import `comparePairIds`, `isSemanticDigest`, `makeResultId`, `parseResultId`, `isValidModelKey`, `isValidDbId`, `elementRefKey`, `makePairId(mode, x, y)` and `pairSemanticsOf(mode)` — **not** a `makePairId(source, target, pairSemantics)` / `pairSemanticsForMode(mode)` spelling (reconciliation rows N13/N14) — and must not copy a `Binding` (or `lease.epoch`) into provenance; `registrySessionId` is the only registry value that becomes durable.
- **P3** (`planning/planner.js` Assumed block, `snapshotBindings(modelKeys) => {registryRevision, bindings: Map<modelKey, {binding, …}>}`) is **wrong about the shape**: P1 returns `{registryRevision, bindings: ReadonlyArray<Binding|null>}`, an array **aligned to the requested key list** (P6 A4 already reads `snapshot.bindings[i]`). P3 must adapt its `snapshot` parameter (and its `snapshotOf` test helper) to that shape; P1 deliberately adds no `Map` view (one shape, one reader).
- **P6** must treat a `null` entry of `snapshotBindings(...).bindings` as "no live binding" (**there is no `Binding.dead`**, reconciliation N10; comparison via `bindingsEquivalent`), and must **not** call `world.admitModel` again on snapshot bindings (Binding guarantees 1): its planning-stage sketch that replaces each binding with `lease: null` and then assigns `binding.lease = world.admitModel(...)` writes to a frozen object and duplicates the admission P1 already performed. Its `b.dead === true` tests (six sites at audit time) read `undefined` and must be deleted in favour of the `null` test.
- **P6** owns the coordinator and the `registry-mismatch` throw at engine construction; it decides whether a *first* engine over a world may supply its own registry (this plan recommends: adopt it iff no coordinator exists yet and `assertRegistryBelongsToWorld` passes; otherwise create one). P6 uses `bindingsEquivalent` for the three-snapshot comparison; a `null` binding means "no live binding", reason `model-evicted` if it was present in the run snapshot, `model-not-bound` if it was absent at planning. **RECONCILED (duplicate-ownership D2):** the **per-unit** `world.isLeaseValid(binding.lease)` pre-check of §7.4 belongs to **P4's `LocalUnitExecutor`** (Task P4.8), not to P6 — P4 is the only component holding the live bindings at call time. P6 owns the run-start `admitModel` sweep and the `model-evicted` settlement fact.
- **P7** implements `engine.invalidateModelPlacement` as a delegate to `registry.invalidateModelPlacement`.

**Spec items that look contradictory or unclear (reported, not redesigned):**
1. **Engine-level registry methods.** §4.3 says "`engine.invalidateModelPlacement` / `register` / `unregister` / `notifyPlacementChanged` all act on [the registry]", but the §18 `ClashTestEngine` sketch lists only `registry` and `invalidateModelPlacement`. P1 assumes hosts call `engine.registry.register(...)` etc. directly; P7 should decide whether to add thin engine delegates.
2. **"Dead" binding representation.** §4.3 says `unregister` "marks the binding dead" and §16.1 reads "binding dead ⇒ `model-not-bound`", while `bindingFor → Binding | null` has no dead form. P1 resolves by returning `null` for dead (design decision 1); flagged in case P6 expects an `alive` flag.
3. **"`registryRevision` bumped by every register".** Ambiguous for an idempotent or rejected `register`. P1 bumps only on effective change (design decision 5); freshness comparisons never depend on the raw revision (§16.4 says unrelated mutations must not matter), so either reading is safe.
4. **Whether `register` admits the model.** §4.3 says the lease is "obtained lazily via `world.admitModel`", but does not say what `bindingFor` returns for a model the world already evicted. P1 returns `null` (design decision 2), consistent with §16.1's "lease invalid at bind".

## Conformance check

Producer-side conformance pass against every consumer's *Phase interface summary* / *Assumed* / *Consumes* block (P2…P8) and `interface-reconciliation.md` (rows N1, N2, N3, N7, N10–N14, N34, D2). Executed in a scratch directory (`/private/tmp/claude-501/-Users-kangea-Workspace-Codes-aps-viewer-clash-detection/c5075efa-45e0-4c72-8cc2-b290429c87e9/scratchpad/p0p1/`) by extracting every fenced `// clashtest/…` / `// test/clashtest/…` block of this file and the P0 file verbatim (appended and replaced fragments applied in task order), Node v22.23.1, with the real `collision/` copied in for the one real-`CollisionWorld` contract. Nothing exists yet under the repo's `clashtest/` or `test/`, so `npm test` is not run here.

**Commands and results (final state of this file)**

| Command | Result |
|---|---|
| `node --test test/clashtest/identity/ids.elementRef.test.mjs` | 7 pass, 0 fail |
| `node --test test/clashtest/identity/ids.pairId.test.mjs` | 9 pass, 0 fail |
| `node --test test/clashtest/identity/ids.resultId.test.mjs` | 10 pass, 0 fail |
| `node --test test/clashtest/identity/ModelRegistry.register.test.mjs` | 17 pass, 0 fail |
| `node --test test/clashtest/identity/ModelRegistry.snapshot.test.mjs` | 13 pass, 0 fail |
| `node --test test/clashtest/identity/ModelRegistry.placement.test.mjs` | 7 pass, 0 fail |
| `node --test test/clashtest/identity/identity.guards.test.mjs` | 5 pass, 0 fail |
| `node --test test/clashtest/support/leaseWorld.contract.test.mjs` | 9 pass, 0 fail |
| all eight files together | **77 pass, 0 fail** |
| Mutation checks on the additions | (a) the duplicate-key lease re-read removed ⇒ the cached-lease test fails (`admitModel` called 3× for 2 keys); (b) a `dead: false` property added to the returned Binding ⇒ the no-`dead` test and the exact-shape test fail; (c) a naive `modelKey:dbId` key ⇒ the order-preservation test fails |

**Defects found in this file by running its own blocks, and fixed**

1. **P1.3's test still imported `digestOf`** from P0 (`SyntaxError: … does not provide an export named 'digestOf'`) although the Interfaces block said N3 was applied; it now imports the synchronous `digestCanonical` and the `await`s are gone.
2. **Every `ModelBindingError` throw site in P1.5/P1.7/P1.8 was the positional shorthand** the earlier "notation" paragraph excused; copy-pasted, it builds an error whose `.reason` is `undefined` and whose `.code` is also `undefined` — the exact N1 hazard. All throw sites and assertions are now the real object form, and `register`'s conflict throws `{modelKey, existingVersion, offeredVersion}` (the test used `seen`/`offered`).
3. **`elementRefKey` and `createModelRegistry` were listed in the summary (N12, N11) but had no implementation or test anywhere in the file.** Both are now implemented in P1.1 / P1.5 with tests.
4. **`snapshotBindings` admitted a model once per *duplicate* key in one call** (phase 1 captured `lease: null` for both positions), so "one lease per live binding" was false and the two positions could carry different lease objects. `#resolveLease` now re-reads the cached lease.

**Added by this pass:** the *Binding guarantees* block (valid cached leases; no second admission; **no `dead` flag — `null` is the only dead representation**, pinned by a test), `elementRefKey` (injective and order-preserving), `createModelRegistry`. (An earlier draft of this pass added a `Binding.dead` getter; the controller reverted it — reconciliation N10 stands.)

**Consumer expectations audit (P1 names)**

| Consumer expectation | Verdict |
|---|---|
| P2 `CLASH_MODES`, `pairSemanticsOf` (validator imports both; caller `pairSemantics` field rejected) | present (N7) |
| P3 `snapshotBindings(modelKeys) => {registryRevision, bindings: Map<modelKey, {binding, …}>}` | **rejected** — `bindings` is a `ReadonlyArray<Binding\|null>` aligned to the requested keys; P3 adapts its `snapshot` parameter and `snapshotOf` helper |
| P4 `registry.bindingFor(modelKey) → Binding\|null`, `Binding = {modelKey, model, modelVersion, lease, bindingGeneration, placementGeneration}`, `createModelRegistry({world})` | present |
| P5 `comparePairIds`, `compareElementRefs`, `makeResultId(testId, digest, pairId)`, `parseResultId`, `isSemanticDigest`, `isValidModelKey`, `isValidDbId`, `elementRefKey`, `pairSemanticsOf(mode)`, `makePairId(mode, x, y)` | present, exact signatures |
| P5 `pairSemanticsForMode(mode)` and `makePairId(source, target, pairSemantics)` (an earlier P5.1 sketch) | **rejected** — N13/N14; P5 never passes a semantics value |
| P6 `snapshotBindings`, `registrySessionId`, `bindingFor`, `notifyPlacementChanged`, `invalidateModelPlacement`, `isBindingCurrent`, `bindingsEquivalent`, `assertRegistryBelongsToWorld` | present (N34) |
| P6 `Binding.dead` (`b === null \|\| b.dead === true`, six sites at audit time) | **rejected** — no such field (N10): dead / evicted / lease-invalid read as `null`; `b.dead === true` would read `undefined`; test `b === null` and compare with `bindingsEquivalent` |
| P6 planning stage: re-wrapping each snapshot binding with `lease: null`, then `binding.lease = world.admitModel(...)` | **rejected** — snapshot bindings are frozen and already carry a valid cached lease; assigning throws (ESM strict), and a second admission duplicates P1's |
| P6 `new ModelBindingError('registry-factory-required', '…')` (positional), `.code` | **rejected** — `new ModelBindingError({reason, modelKey?, message?})`, read `.reason` (N1) |
| P6 / P7 `createModelRegistry({world, makeSessionId?})` | present (N11), in `identity/ModelRegistry.js` |
| P7 `makePairId(mode, x, y)`, `registry.invalidateModelPlacement(modelKey) → number`, `assertRegistryBelongsToWorld(registry, world)` | present |
| P7 `createModelRegistry({ world: createFakeWorld() })` (foreign-registry test) | **rejected** — P0's `createFakeWorld` has no lease surface, so the constructor throws `ModelBindingError{reason:'invalid-world'}`; use `makeLeaseWorld()` from `test/clashtest/support/leaseWorld.mjs` (P1.4) |
| P8 `compareElementRefs`, `comparePairIds`, `pairSemanticsOf`; `elementRefKey` | present (P8 no longer needs `elementRefKey`; the delimiter-collision vectors are covered in P1.1) |

**Deliberately not added (consumer wrong):** a `Map` view on snapshots (P3); `pairSemanticsForMode` (P5); a `now` option on the registry (P6 A5, already corrected); any `dead` / `alive` flag on `Binding` (N10).

