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
