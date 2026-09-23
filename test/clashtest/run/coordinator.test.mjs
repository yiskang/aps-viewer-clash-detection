// test/clashtest/run/coordinator.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COORDINATOR_PROTOCOL_VERSION, COORDINATOR_SLOT, getWorldCoordinator,
} from '../../../clashtest/run/coordinator.js';

const fakeWorld = () => ({ tag: 'world' });
// A5: the factory's argument is `{ world }` and `world` is REQUIRED — the double asserts it.
const createRegistry = ({ world }) => {
  assert.ok(world !== undefined, 'createRegistry must receive the world');
  return { world, registrySessionId: `s${Math.random()}` };
};

test('two engines over one world get the SAME coordinator and the SAME registry', () => {
  const world = fakeWorld();
  const a = getWorldCoordinator(world, { createRegistry });
  const b = getWorldCoordinator(world, { createRegistry });
  assert.equal(a, b);
  assert.equal(a.registry, b.registry);
  assert.equal(a.registry.world, world, 'the registry was built FOR this world (A5)');
  assert.notEqual(getWorldCoordinator(fakeWorld(), { createRegistry }), a);
});

test('the coordinator map lives on globalThis under the documented symbol', () => {
  const world = fakeWorld();
  getWorldCoordinator(world, { createRegistry });
  assert.equal(COORDINATOR_SLOT, Symbol.for('clashtest.coordinators'));
  assert.ok(globalThis[COORDINATOR_SLOT] instanceof WeakMap);
  assert.ok(globalThis[COORDINATOR_SLOT].has(world));
});

test('an incompatible protocol version throws instead of running beside it', () => {
  const world = fakeWorld();
  getWorldCoordinator(world, { createRegistry });
  assert.throws(
    () => getWorldCoordinator(world, { createRegistry, protocolVersion: COORDINATOR_PROTOCOL_VERSION + 1 }),
    // A3/N1: ONE object argument, and the field is `.reason` — `.code` reads undefined.
    (e) => e.name === 'ModelBindingError' && e.reason === 'coordinator-version-mismatch',
  );
});

test('two engines over one world SERIALIZE: exactly one job is in flight, FIFO', async () => {
  const world = fakeWorld();
  const engineA = getWorldCoordinator(world, { createRegistry });
  const engineB = getWorldCoordinator(world, { createRegistry });
  const log = [];
  let concurrent = 0;
  let peak = 0;
  const job = (id, release) => async () => {
    concurrent += 1; peak = Math.max(peak, concurrent);
    log.push(`start:${id}`);
    await release;
    log.push(`end:${id}`);
    concurrent -= 1;
  };
  let releaseA; const gateA = new Promise((r) => { releaseA = r; });
  let releaseB; const gateB = new Promise((r) => { releaseB = r; });

  const t1 = engineA.enqueue({ runId: 'r1', engineId: 'A', run: job('r1', gateA) });
  const t2 = engineB.enqueue({ runId: 'r2', engineId: 'B', run: job('r2', gateB) });

  await t1.started;
  assert.equal(engineA.inFlightRunId(), 'r1');
  assert.deepEqual(log, ['start:r1']);
  releaseA();
  await t2.started;
  assert.deepEqual(log, ['start:r1', 'end:r1', 'start:r2']);
  releaseB();
  await t2.finished;
  assert.equal(peak, 1, 'never two jobs in flight over one world');
  assert.equal(engineA.inFlightRunId(), null);
});

test('a queued job can withdraw before it starts, and never after', async () => {
  const world = fakeWorld();
  const c = getWorldCoordinator(world, { createRegistry });
  let release; const gate = new Promise((r) => { release = r; });
  const t1 = c.enqueue({ runId: 'r1', engineId: 'A', run: async () => { await gate; } });
  const t2 = c.enqueue({ runId: 'r2', engineId: 'A', run: async () => {} });
  await t1.started;
  assert.equal(t2.withdraw(), true);
  assert.equal(c.queueDepth('A'), 0);
  assert.equal(t2.withdraw(), false, 'withdrawing twice wins once — the R5 single-winner hinge');
  assert.equal(t1.withdraw(), false, 'a started job cannot withdraw');
  await t2.finished;                                      // a withdrawn ticket settles, never hangs
  release();
  await t1.finished;
});

test('cancelQueued reports whether IT withdrew the job (R5 hinge)', async () => {
  const world = fakeWorld();
  const c = getWorldCoordinator(world, { createRegistry });
  let release; const gate = new Promise((r) => { release = r; });
  const head = c.enqueue({ runId: 'h', engineId: 'A', run: async () => { await gate; } });
  const waiting = c.enqueue({ runId: 'w', engineId: 'A', run: async () => 'ran' });
  await head.started;
  assert.equal(c.cancelQueued('w'), true, 'a still-queued job is withdrawn');
  assert.equal(c.cancelQueued('w'), false, 'it is gone now');
  assert.equal(c.cancelQueued('h'), false, 'the in-flight job is never withdrawn');
  assert.equal(c.cancelQueued('nope'), false, 'an unknown id is false, never a throw');
  release();
  await head.finished;
  assert.equal(c.queueDepth('A'), 0);
});

test('the coordinator enforces NO queue limit of its own (R6)', async () => {
  // maxQueuedRuns is a per-ENGINE option checked in P7's synchronous admission prefix, before
  // enqueue is ever reached. The coordinator must not second-guess it, or two engines sharing one
  // world would apply one engine's limit to the other's runs.
  const world = fakeWorld();
  const c = getWorldCoordinator(world, { createRegistry });
  let release; const gate = new Promise((r) => { release = r; });
  c.enqueue({ runId: 'h', engineId: 'A', run: async () => { await gate; } });
  for (let i = 0; i < 50; i += 1) {
    assert.doesNotThrow(() => c.enqueue({ runId: `q${i}`, engineId: 'A', run: async () => {} }));
  }
  assert.equal(c.queueDepth('A'), 50, 'depth counts runs WAITING, not the in-flight one');
  assert.equal(typeof c.enqueue, 'function');
  assert.equal('maxQueuedRuns' in c, false, 'the coordinator holds no per-engine limit');
  release();
});

test('queueDepth is per engine; stopAdmitting refuses only that engine', async () => {
  const world = fakeWorld();
  const c = getWorldCoordinator(world, { createRegistry });
  let release; const gate = new Promise((r) => { release = r; });
  const head = c.enqueue({ runId: 'h', engineId: 'A', run: async () => { await gate; } });
  await head.started;
  c.enqueue({ runId: 'a1', engineId: 'A', run: async () => {} });
  c.enqueue({ runId: 'b1', engineId: 'B', run: async () => {} });
  assert.equal(c.queueDepth('A'), 1);
  assert.equal(c.queueDepth('B'), 1);
  c.stopAdmitting('A');
  assert.throws(() => c.enqueue({ runId: 'a2', engineId: 'A', run: async () => {} }),
    (e) => e.name === 'EngineDisposedError');
  assert.doesNotThrow(() => c.enqueue({ runId: 'b2', engineId: 'B', run: async () => {} }));
  release();
});

test('a job that throws does not wedge the queue', async () => {
  const world = fakeWorld();
  const c = getWorldCoordinator(world, { createRegistry });
  const t1 = c.enqueue({ runId: 'boom', engineId: 'A', run: async () => { throw new Error('boom'); } });
  const t2 = c.enqueue({ runId: 'ok', engineId: 'A', run: async () => 'fine' });
  await assert.rejects(t1.finished, /boom/);
  await t2.started;
  assert.equal(await t2.finished, 'fine');
});
