// test/clashpanel/core/resolve.test.mjs — spec §9.1, AC-P7/AC-P8
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSide, resolveResult } from '../../../clashpanel/core/resolve.js';

const modelA = { name: 'A' };
const modelB = { name: 'B' };
const provenance = Object.freeze({
  models: Object.freeze([
    Object.freeze({ modelKey: 'mA', modelVersion: 'v1', bindingGeneration: 3, placementGeneration: 0 }),
    Object.freeze({ modelKey: 'mB', modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 0 }),
  ]),
});

function world({ bindings, scene = [modelA, modelB], names = { mA: 'Architecture', mB: 'Structure' } } = {}) {
  const calls = { bindingFor: [] };
  const table = bindings ?? {
    mA: { modelKey: 'mA', model: modelA, modelVersion: 'v1', bindingGeneration: 3 },
    mB: { modelKey: 'mB', model: modelB, modelVersion: 'v1', bindingGeneration: 1 },
  };
  const engine = {
    registry: {
      bindingFor(key) { calls.bindingFor.push(key); return table[key] ?? null; },
      register() { throw new Error('register must never be called'); },
      unregister() { throw new Error('unregister must never be called'); },
    },
  };
  const catalog = {
    list: () => scene.map((model) => ({ modelKey: model === modelA ? 'mA' : 'mB', displayName: 'x', model, loaded: true })),
    displayNameFor: (key) => names[key] ?? null,
  };
  return { engine, catalog, calls, table };
}

const ref = (modelKey, dbId) => ({ modelKey, dbId });
const record = { resultId: 'r1', pair: { first: ref('mA', 1), second: ref('mB', 10) } };

test('live only when binding, generation, version and scene membership all agree', () => {
  const { engine, catalog } = world();
  const side = resolveSide({ ref: ref('mA', 7), provenance, engine, catalog });
  assert.equal(side.state, 'live');
  assert.equal(side.model, modelA);
  assert.equal(side.dbId, 7);
  assert.equal(side.modelKey, 'mA');
});

test('null binding => not-registered (unloaded and unregistered are indistinguishable)', () => {
  const { engine, catalog } = world({ bindings: { mB: { model: modelB, modelVersion: 'v1', bindingGeneration: 1 } } });
  assert.deepEqual({ ...resolveSide({ ref: ref('mA', 1), provenance, engine, catalog }) },
    { state: 'unavailable', reason: 'not-registered', modelKey: 'mA', dbId: 1 });
});

test('AC-P8: a reload (new generation) never resolves live, even with an equal version and the new model in scene', () => {
  const reloaded = { name: 'A-reloaded' };
  const { engine, catalog } = world({
    bindings: { mA: { model: reloaded, modelVersion: 'v1', bindingGeneration: 4 }, mB: { model: modelB, modelVersion: 'v1', bindingGeneration: 1 } },
    scene: [reloaded, modelB],
  });
  assert.equal(resolveSide({ ref: ref('mA', 1), provenance, engine, catalog }).reason, 'reloaded-since-run');
});

test('AC-P8: same generation but a different modelVersion => version-mismatch', () => {
  const { engine, catalog } = world({
    bindings: { mA: { model: modelA, modelVersion: 'v2', bindingGeneration: 3 }, mB: { model: modelB, modelVersion: 'v1', bindingGeneration: 1 } },
  });
  assert.equal(resolveSide({ ref: ref('mA', 1), provenance, engine, catalog }).reason, 'version-mismatch');
});

test('a registered, lease-valid model that left the scene (hideModel) => not-in-scene (identity compare)', () => {
  const { engine, catalog } = world({ scene: [modelB, { name: 'A' } /* equal shape, different object */] });
  assert.equal(resolveSide({ ref: ref('mA', 1), provenance, engine, catalog }).reason, 'not-in-scene');
});

test('empty provenance.models (planning-failed seal) => not-registered, registry not consulted', () => {
  const { engine, catalog, calls } = world();
  const side = resolveSide({ ref: ref('mA', 1), provenance: { models: [] }, engine, catalog });
  assert.equal(side.reason, 'not-registered');
  assert.deepEqual(calls.bindingFor, []);
});

test('throwing bindingFor / catalog.list never escape (fail closed)', () => {
  const engine = { registry: { bindingFor() { throw new Error('boom'); } } };
  const { catalog } = world();
  assert.equal(resolveSide({ ref: ref('mA', 1), provenance, engine, catalog }).reason, 'not-registered');
  const { engine: okEngine } = world();
  const badCatalog = { list() { throw new Error('boom'); }, displayNameFor: () => null };
  assert.equal(resolveSide({ ref: ref('mA', 1), provenance, engine: okEngine, catalog: badCatalog }).reason, 'not-in-scene');
});

test('resolveResult: both live / one live with the "<name> is not loaded" note / none live', () => {
  const both = world();
  const r1 = resolveResult({ record, provenance, engine: both.engine, catalog: both.catalog });
  assert.deepEqual([r1.anyLive, r1.allLive, r1.notes], [true, true, []]);

  const one = world({ scene: [modelA] });
  const r2 = resolveResult({ record, provenance, engine: one.engine, catalog: one.catalog });
  assert.deepEqual([r2.anyLive, r2.allLive], [true, false]);
  assert.deepEqual(r2.notes, ['Structure is not loaded']);
  assert.equal(r2.sides[0].state, 'live');
  assert.equal(r2.sides[1].reason, 'not-in-scene');

  const none = world({ scene: [] });
  const r3 = resolveResult({ record, provenance, engine: none.engine, catalog: none.catalog });
  assert.deepEqual([r3.anyLive, r3.allLive, r3.notes], [false, false, []]);
});

test('lazy: resolution reflects registry changes made after an earlier resolve (nothing cached)', () => {
  const w = world();
  assert.equal(resolveSide({ ref: ref('mA', 1), provenance, engine: w.engine, catalog: w.catalog }).state, 'live');
  delete w.table.mA;                         // host unregistered mA (wireModelUnload)
  assert.equal(resolveSide({ ref: ref('mA', 1), provenance, engine: w.engine, catalog: w.catalog }).reason, 'not-registered');
});

test('the unavailable note falls back to "Model <key>" when the host has no display name', () => {
  const w = world({ scene: [modelA], names: {} });
  assert.deepEqual(resolveResult({ record, provenance, engine: w.engine, catalog: w.catalog }).notes, ['Model mB is not loaded']);
});
