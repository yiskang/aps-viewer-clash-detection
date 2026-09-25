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
