// test/clashtest/support.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFakeClock, createFakeWorld, createFakeModel, emptyClashResult, snapshotQuery,
  createFakeEnumerator, createFakeEnumerationContext, createFakeRegistry,
} from './support/index.mjs';
import { EnumerationCancelledError, ModelKeyVersionConflictError } from '../../clashtest/errors.js';
import { WorldDisposedError } from '../../collision/errors.js';

test('fake clock: now/advance/tick, detached closures, yield counting and onYield hook', async () => {
  const clock = createFakeClock({ start: 10, tickMs: 2, yieldAdvanceMs: 5 });
  const { now, yieldToScheduler } = clock;      // detached use must work
  assert.equal(now(), 10); assert.equal(now(), 12);
  clock.advance(100); assert.equal(clock.peek(), 114);
  const seen = [];
  const off = clock.onYield((n) => { seen.push(n); });
  await yieldToScheduler(); await yieldToScheduler();
  assert.deepEqual(seen, [1, 2]); assert.equal(clock.yieldCount, 2); assert.equal(clock.peek(), 124);
  off(); await yieldToScheduler(); assert.deepEqual(seen, [1, 2]);
});

test('fake world: records calls with a stable snapshot, returns the default, and can be scripted', async () => {
  const world = createFakeWorld();
  const a = createFakeModel(1); const b = createFakeModel(2);
  const dbIds = [3, 4];
  const query = { source: { model: a, dbIds }, target: { targets: [{ model: b }, { model: a, dbIds: [9] }] }, mode: 'clearance', groupBy: 'dbId', clearance: 0.5, broadPhase: 'tlas' };
  assert.deepEqual(await world.findClashes(query), emptyClashResult());
  dbIds.push(99);                                             // caller mutation after the call
  assert.deepEqual(world.calls[0].snapshot.source.dbIds, [3, 4]);
  assert.deepEqual(world.calls[0].snapshot, snapshotQuery({ ...query, source: { model: a, dbIds: [3, 4] } }));
  assert.equal(world.calls[0].snapshot.target.targets[0].dbIds, undefined);

  const boom = new Error('boom');
  world.script({ pairs: [1], statistics: {} }, boom, (q, call) => ({ pairs: [call.index], statistics: {} }));
  assert.deepEqual((await world.findClashes(query)).pairs, [1]);
  await assert.rejects(() => world.findClashes(query), boom);
  assert.deepEqual((await world.findClashes(query)).pairs, [3]);
  assert.deepEqual(await world.findClashes(query), emptyClashResult()); // script exhausted -> default again
  assert.equal(world.calls.length, 5);
});

test('fake world: hold() parks the next call, tracks concurrency, and dispose() makes calls reject', async () => {
  const world = createFakeWorld();
  const q = { source: { model: createFakeModel(1), dbIds: [1] }, target: { targets: [] }, mode: 'volume-overlap', groupBy: 'dbId', broadPhase: 'tlas' };
  const held = world.hold();
  const p = world.findClashes(q);
  const call = await held.started;
  assert.equal(call.index, 0); assert.equal(world.inFlight, 1);
  held.release({ pairs: [], statistics: { diagnostics: ['x'] } });
  assert.deepEqual((await p).statistics.diagnostics, ['x']);
  assert.equal(world.inFlight, 0); assert.equal(world.maxInFlight, 1);
  const h2 = world.hold(); const p2 = world.findClashes(q); await h2.started;
  const e = new Error('held failure'); h2.fail(e);
  await assert.rejects(p2, e);
  world.dispose();
  await assert.rejects(() => world.findClashes(q), WorldDisposedError);
});

const ROOTS = [
  { dbId: 20, fragmentCount: 2, ownerDbIds: [21, 22], subtreeDigest: 'd20' },
  { dbId: 10, fragmentCount: 1, ownerDbIds: [10], subtreeDigest: 'd10' },
];

test('fake enumerator: whole and explicit scopes, digestScope, call log, set() and onCall()', async () => {
  const en = createFakeEnumerator({ models: { A: { roots: ROOTS, population: { count: 3, digest: 'pop' } } } });
  const binding = { modelKey: 'A' };
  const whole = await en.resolveRoots(binding, 'whole', null);
  assert.deepEqual(whole.roots.map((r) => r.dbId), [10, 20]);          // ascending by dbId
  assert.deepEqual(whole.population, { count: 3, digest: 'pop' });
  assert.deepEqual(await en.digestScope(binding, 'whole', null), { kind: 'population', count: 3, digest: 'pop' });
  const some = await en.resolveRoots(binding, { dbIds: [20, 99] }, null);
  assert.deepEqual(some.roots.map((r) => r.dbId), [20]);
  assert.deepEqual(some.unresolved, [{ dbId: 99, reason: 'not-found' }]);
  assert.equal(some.population, null);
  assert.deepEqual((await en.digestScope(binding, { dbIds: [10] }, null)).roots, [{ dbId: 10, fragmentCount: 1, subtreeDigest: 'd10' }]);
  assert.deepEqual(en.calls.map((c) => c.kind), ['resolveRoots', 'digestScope', 'resolveRoots', 'digestScope']);
  en.set('A', { population: { count: 4, digest: 'pop2' } });
  assert.equal((await en.digestScope(binding, 'whole', null)).digest, 'pop2');
  let hooked = 0; en.onCall(() => { hooked++; });
  await en.resolveRoots(binding, 'whole', null); assert.equal(hooked, 1);
  await assert.rejects(() => en.resolveRoots({ modelKey: 'nope' }, 'whole', null), /unknown model/);
});

test('fake enumerator: a cooperating call awaits ctx.checkpoint and propagates EnumerationCancelledError; a non-cooperating one ignores it', async () => {
  const coop = createFakeEnumerator({ models: { A: { roots: ROOTS } }, checkpointsPerCall: 3 });
  const ctx = createFakeEnumerationContext();
  await coop.resolveRoots({ modelKey: 'A' }, 'whole', ctx);
  assert.equal(ctx.checkpoints, 3);
  ctx.cancel('lease-dead');
  await assert.rejects(() => coop.resolveRoots({ modelKey: 'A' }, 'whole', ctx), (e) => e instanceof EnumerationCancelledError && e.reason === 'lease-dead');
  const rude = createFakeEnumerator({ models: { A: { roots: ROOTS } }, cooperative: false });
  await rude.resolveRoots({ modelKey: 'A' }, 'whole', ctx);           // cancelled ctx is ignored
});

test('fake registry placeholder: bindings, generation bump, version conflict, sorted snapshot', () => {
  const reg = createFakeRegistry({ models: [{ modelKey: 'b', modelVersion: 'v1' }, { modelKey: 'a', modelVersion: 'v1' }] });
  assert.equal(reg.registrySessionId, 'fake-session-1');
  assert.deepEqual(reg.snapshotBindings().map((b) => b.modelKey), ['a', 'b']);
  assert.equal(reg.register({ modelKey: 'a', modelVersion: 'v1' }).bindingGeneration, 2);
  assert.throws(() => reg.register({ modelKey: 'a', modelVersion: 'v2' }), ModelKeyVersionConflictError);
  assert.equal(reg.getBinding('zzz'), null);
});
