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

test('duplicate keys plus a mutation from inside the read: each captured binding is admitted once and every duplicate carries the same lease', () => {
  const { registry, world } = setup();
  const m1 = model(1);
  registry.register('k', m1, v('v1'));
  let fired = false;
  world.hooks.beforeIsLeaseValid = () => {           // fires during the FIRST position's lease resolution
    if (fired) return;
    fired = true;
    registry.unregister(m1);
    registry.register('k', model(2), v('v1'));       // the live entry now holds a different Model
  };
  const snap = registry.snapshotBindings(['k', 'k']);
  assert.equal(fired, true);
  assert.equal(world.calls.admitModel, 1, 'the captured Model is admitted once, not once per duplicate position');
  assert.equal(snap.bindings[0].model, m1);
  assert.equal(snap.bindings[1].model, m1);
  assert.equal(snap.bindings[0].lease, snap.bindings[1].lease);
  assert.equal(snap.bindings[0].bindingGeneration, snap.bindings[1].bindingGeneration);
});
