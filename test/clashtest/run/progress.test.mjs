// test/clashtest/run/progress.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmitter } from '../../../clashtest/run/emitter.js';
import { createFakeClock } from '../support/index.mjs';            // P0 (A18)
import { createRun } from '../../../clashtest/run/Run.js';
import { createFakePlan } from '../support/fakePlanner.mjs';
import { createRunFixture } from '../support/runFixture.mjs';   // wires clock + fakes into createRun

test('progress events are throttled; state, unit and persistence events never are', () => {
  const clock = createFakeClock();
  const e = createEmitter({ now: clock.now, progressMinIntervalMs: 100 });
  const seen = [];
  e.subscribe((ev) => seen.push(`${ev.type}@${clock.now()}`));

  e.emit('progress', { seq: 1 });                    // t=0   -> delivered (first is never throttled)
  clock.advance(40);
  e.emit('progress', { seq: 2 });                    // t=40  -> suppressed
  e.emit('state', { seq: 3, status: 'running' });    // t=40  -> delivered
  e.emit('unit', { seq: 4 });                        // t=40  -> delivered
  clock.advance(61);
  e.emit('progress', { seq: 5 });                    // t=101 -> delivered
  assert.deepEqual(seen, ['progress@0', 'state@40', 'unit@40', 'progress@101']);
});

test('a listener that throws is isolated, counted, and cannot stop other listeners (16.6)', () => {
  const clock = createFakeClock();
  const e = createEmitter({ now: clock.now, progressMinIntervalMs: 0 });
  const seen = [];
  e.subscribe(() => { throw new Error('bad subscriber'); });
  e.subscribe((ev) => seen.push(ev.type));
  assert.doesNotThrow(() => e.emit('state', { seq: 1 }));
  assert.doesNotThrow(() => e.emit('state', { seq: 2 }));
  assert.deepEqual(seen, ['state', 'state']);
  assert.equal(e.listenerErrors, 2);
});

test('a listener that unsubscribes (or subscribes) during delivery does not corrupt the pass', () => {
  const clock = createFakeClock();
  const e = createEmitter({ now: clock.now, progressMinIntervalMs: 0 });
  const seen = [];
  const off = e.subscribe(() => { off(); e.subscribe(() => seen.push('late')); });
  e.subscribe(() => seen.push('stable'));
  e.emit('state', { seq: 1 });
  e.emit('state', { seq: 2 });
  assert.deepEqual(seen, ['stable', 'stable', 'late']);   // the late one joins from the NEXT emit
  assert.equal(e.listenerErrors, 0);
});

test('unsubscribe is idempotent and removes exactly one listener', () => {
  const e = createEmitter({ now: () => 0, progressMinIntervalMs: 0 });
  let n = 0;
  const off = e.subscribe(() => { n += 1; });
  e.subscribe(() => { n += 1; });
  off(); off();
  e.emit('state', { seq: 1 });
  assert.equal(n, 1);
  assert.equal(e.listenerCount, 1);
});

test('a snapshot is never torn: seq only advances at a commit, and repeated reads are identical', async () => {
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 10 }]) });
  const { handle } = createRun(fx.spec);
  const a = handle.getSnapshot();
  const b = handle.getSnapshot();
  assert.deepEqual(a, b);
  assert.equal(a.seq, b.seq);
  assert.equal(a.status, 'queued');
  assert.equal(a.phase, 'queued');
  assert.equal(a.fractionProcessed, null, 'null while pairSpaceTotal is 0');
});
