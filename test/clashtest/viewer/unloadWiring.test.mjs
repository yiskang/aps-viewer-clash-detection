// test/clashtest/viewer/unloadWiring.test.mjs  (T1/T2: BEFORE_MODEL_UNLOAD wiring against a FAKE event target)
//
// Scope: these offline tests cannot show that the real Viewer dispatches BEFORE_MODEL_UNLOAD_EVENT to the
// production wiring -- that is Task 13 step (h); until then the wiring is LIVE_UNLOAD_INTEGRATION_UNVERIFIED.
// A real `ModelRegistry` (the world coordinator's own) and a real `CollisionWorld` are used throughout
// (`makeRealWorldFixture`); spies are OWN-PROPERTY wrappers on those instances that call through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wireModelUnload } from '../../../clashtest/viewer/unloadWiring.js';
import { makeRealWorldFixture } from '../support/realWorld.mjs';

const EVENT = 'test.BEFORE_MODEL_UNLOAD';

/** A fake event target recording every add/remove pair; `fire` dispatches to the currently added listeners. */
function fakeTarget() {
  const listeners = new Map();
  const adds = [];
  const removes = [];
  return {
    adds, removes,
    addEventListener(name, fn) { adds.push({ name, fn }); (listeners.get(name) ?? listeners.set(name, new Set()).get(name)).add(fn); },
    removeEventListener(name, fn) { removes.push({ name, fn }); listeners.get(name)?.delete(fn); },
    fire(name, event) { for (const fn of [...(listeners.get(name) ?? [])]) fn(event); },
    count(name) { return listeners.get(name)?.size ?? 0; },
  };
}

const fixture = () => makeRealWorldFixture({ models: { a: { 1: [[0, 0, 0]] } } });

/** Own-property spy on `obj[method]` that records into `log` and then runs `impl` (default: the real method). */
function spy(obj, method, log, impl) {
  const real = obj[method].bind(obj);
  obj[method] = (...args) => { log.push([method, ...args]); return (impl ?? real)(...args); };
}

/** Wires over a fixture; `bindingFor` first so the model is admitted (lazy lease) and live. */
async function wired({ report } = {}) {
  const fx = await fixture();
  const model = fx.modelFor('a');
  assert.ok(fx.registry.bindingFor('a'), 'precondition: live binding');
  assert.equal(fx.world.isModelLive(model), true, 'precondition: model admitted and live');
  const target = fakeTarget();
  const reports = [];
  const wiring = wireModelUnload({
    world: fx.world, registry: fx.registry, eventTarget: target, eventName: EVENT,
    report: report ?? ((stage, error) => reports.push([stage, error])),
  });
  return { fx, model, target, reports, wiring };
}

test('(1) argument shape: missing parts => synchronous TypeError; nothing subscribed', async () => {
  const fx = await fixture();
  const target = fakeTarget();
  const good = { world: fx.world, registry: fx.registry, eventTarget: target, eventName: EVENT };
  const cases = [
    { ...good, world: {} },
    { ...good, world: undefined },
    { ...good, registry: {} },
    { ...good, registry: null },
    { ...good, eventTarget: {} },
    { ...good, eventTarget: { addEventListener() {} } },
    { ...good, eventName: undefined },
    { ...good, eventName: '' },
    { ...good, eventName: 42 },
  ];
  for (const args of cases) assert.throws(() => wireModelUnload(args), TypeError);
  assert.throws(() => wireModelUnload(), TypeError);
  assert.equal(target.adds.length, 0);
});

test('(1, Review Focus 11) a real registry of world A wired with world B => registry-mismatch, no listener added', async () => {
  const fxA = await fixture();
  const fxB = await fixture();
  const target = fakeTarget();
  assert.throws(
    () => wireModelUnload({ world: fxB.world, registry: fxA.registry, eventTarget: target, eventName: EVENT }),
    (e) => e.name === 'ModelBindingError' && e.reason === 'registry-mismatch',
  );
  // a partial duck-typed fake that merely has `unregister` is also rejected
  assert.throws(
    () => wireModelUnload({ world: fxA.world, registry: { unregister() {} }, eventTarget: target, eventName: EVENT }),
    (e) => e.name === 'ModelBindingError' && e.reason === 'registry-mismatch',
  );
  assert.equal(target.adds.length, 0);
  assert.equal(target.count(EVENT), 0);
});

test('(2) firing {model} unregisters THEN evicts (each once); binding null, model no longer live', async () => {
  const { fx, model, target, reports } = await wired();
  assert.equal(target.adds.length, 1);
  assert.equal(target.adds[0].name, EVENT);
  const log = [];
  spy(fx.registry, 'unregister', log);
  spy(fx.world, 'evictModel', log);
  target.fire(EVENT, { model });
  assert.deepEqual(log, [['unregister', model], ['evictModel', model]]);
  assert.equal(fx.registry.bindingFor('a'), null);
  assert.equal(fx.world.isModelLive(model), false);
  assert.deepEqual(reports, []);
});

test('(3, Review Focus 5) a late unload of the OLD model does not kill a NEW binding under the same key', async () => {
  const { fx, model: oldModel, target, reports } = await wired();
  fx.registry.unregister(oldModel); // the host re-binds the key to a NEW Model object before the old unload lands
  const newModel = { id: 'a-new' };
  fx.registry.register('a', newModel, { modelVersion: 'v1' });
  assert.equal(fx.registry.bindingFor('a').model, newModel);
  target.fire(EVENT, { model: oldModel });
  const binding = fx.registry.bindingFor('a');
  assert.notEqual(binding, null);
  assert.equal(binding.model, newModel);
  assert.equal(fx.world.isModelLive(newModel), true);
  assert.equal(fx.world.isModelLive(oldModel), false);
  assert.deepEqual(reports, []);
});

test('(4) never throws: unregister throws => evict still runs, reported as unregister', async () => {
  const { fx, model, target, reports } = await wired();
  const boom = new Error('unregister boom');
  const log = [];
  spy(fx.registry, 'unregister', log, () => { throw boom; });
  spy(fx.world, 'evictModel', log);
  assert.doesNotThrow(() => target.fire(EVENT, { model }));
  assert.deepEqual(log, [['unregister', model], ['evictModel', model]]);
  assert.equal(fx.world.isModelLive(model), false);
  assert.deepEqual(reports, [['unregister', boom]]);
});

test('(4) never throws: evictModel throws => reported as evict (after unregister ran)', async () => {
  const { fx, model, target, reports } = await wired();
  const boom = new Error('evict boom');
  spy(fx.world, 'evictModel', [], () => { throw boom; });
  assert.doesNotThrow(() => target.fire(EVENT, { model }));
  assert.equal(fx.registry.bindingFor('a'), null);
  assert.deepEqual(reports, [['evict', boom]]);
});

test('(4) never throws: a throwing report is swallowed (both stages throwing)', async () => {
  const calls = [];
  const { fx, model, target } = await wired({ report: (stage) => { calls.push(stage); throw new Error('report boom'); } });
  spy(fx.registry, 'unregister', [], () => { throw new Error('u'); });
  spy(fx.world, 'evictModel', [], () => { throw new Error('e'); });
  assert.doesNotThrow(() => target.fire(EVENT, { model }));
  assert.deepEqual(calls, ['unregister', 'evict']);
  assert.doesNotThrow(() => target.fire(EVENT, undefined));
  assert.deepEqual(calls, ['unregister', 'evict', 'event']);
});

test('(4) never throws: a disposed world', async () => {
  const { fx, model, target, reports } = await wired();
  fx.world.dispose();
  assert.doesNotThrow(() => target.fire(EVENT, { model }));
  assert.deepEqual(reports, []);
});

test('(5) an event with no model (undefined, {}, null) is a reported no-op, never a throw', async () => {
  const { fx, model, target, reports } = await wired();
  const log = [];
  spy(fx.registry, 'unregister', log);
  spy(fx.world, 'evictModel', log);
  for (const event of [undefined, {}, null, { model: null }]) {
    reports.length = 0;
    assert.doesNotThrow(() => target.fire(EVENT, event));
    assert.equal(reports.length, 1);
    assert.equal(reports[0][0], 'event');
    assert.ok(reports[0][1] instanceof Error);
  }
  // a hostile payload whose `model` getter throws is reported too
  reports.length = 0;
  const bad = new Error('getter boom');
  assert.doesNotThrow(() => target.fire(EVENT, { get model() { throw bad; } }));
  assert.deepEqual(reports, [['event', bad]]);
  assert.deepEqual(log, []);
  assert.ok(fx.registry.bindingFor('a'));
  assert.equal(fx.world.isModelLive(model), true);
});

test('(6) dispose removes the exact listener; second dispose is a no-op; firing afterwards does nothing', async () => {
  const { fx, model, target, reports, wiring } = await wired();
  assert.ok(Object.isFrozen(wiring));
  wiring.dispose();
  assert.equal(target.removes.length, 1);
  assert.equal(target.removes[0].name, EVENT);
  assert.equal(target.removes[0].fn, target.adds[0].fn);
  wiring.dispose();
  assert.equal(target.removes.length, 1);
  target.fire(EVENT, { model });
  assert.ok(fx.registry.bindingFor('a'));
  assert.equal(fx.world.isModelLive(model), true);
  assert.deepEqual(reports, []);
});

test('(7) a double unload of the same model is harmless', async () => {
  const { fx, model, target, reports } = await wired();
  target.fire(EVENT, { model });
  assert.doesNotThrow(() => target.fire(EVENT, { model }));
  assert.equal(fx.registry.bindingFor('a'), null);
  assert.equal(fx.world.isModelLive(model), false);
  assert.deepEqual(reports, []);
});

test('(8) the handler returns undefined synchronously (never a Promise)', async () => {
  const { fx, model, target } = await wired();
  const handler = target.adds[0].fn;
  assert.equal(handler({ model }), undefined);
  assert.equal(handler(undefined), undefined);
  assert.equal(fx.world.isModelLive(model), false); // effect already applied, synchronously
});
