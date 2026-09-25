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

test('assertRegistryBelongsToWorld requires the FULL consumed registry surface, and a throwing probe is a mismatch (P1 review Medium)', () => {
  const world = makeLeaseWorld();
  const real = new ModelRegistry({ world });
  const full = {
    world, registrySessionId: 'regsess-x', registryRevision: 0,
    register() {}, unregister() {}, keyOf() {}, bindingFor() {}, snapshotBindings() {}, isBindingCurrent() {},
    notifyPlacementChanged() {}, invalidateModelPlacement() {},
  };
  assert.equal(assertRegistryBelongsToWorld(full, world), full, 'a duck-typed (duplicate-module) registry with the whole surface is accepted');
  // the original review reproduction: only the five previously checked members
  const five = { world, registrySessionId: 'x', register() {}, unregister() {}, bindingFor() {}, snapshotBindings() {}, notifyPlacementChanged() {} };
  assert.throws(() => assertRegistryBelongsToWorld(five, world), mismatch);
  for (const missing of ['register', 'unregister', 'keyOf', 'bindingFor', 'snapshotBindings', 'isBindingCurrent',
    'notifyPlacementChanged', 'invalidateModelPlacement']) {
    const partial = { ...full }; delete partial[missing];
    assert.throws(() => assertRegistryBelongsToWorld(partial, world), mismatch, `missing ${missing}`);
    assert.throws(() => assertRegistryBelongsToWorld({ ...full, [missing]: 'not-a-function' }, world), mismatch, `non-function ${missing}`);
  }
  for (const patch of [{ registrySessionId: '' }, { registrySessionId: 7 }, { registrySessionId: undefined },
    { registryRevision: undefined }, { registryRevision: -1 }, { registryRevision: 1.5 }, { registryRevision: '0' }, { world: makeLeaseWorld() }]) {
    assert.throws(() => assertRegistryBelongsToWorld({ ...full, ...patch }, world), mismatch, JSON.stringify(Object.keys(patch)));
  }
  const hostile = new Proxy(full, { get() { throw new Error('probe'); } });
  assert.throws(() => assertRegistryBelongsToWorld(hostile, world), mismatch);
  assert.equal(assertRegistryBelongsToWorld(real, real.world), real, 'a real registry still passes');
});
