// test/clashpanel/core/scheduler.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertScheduler, createDefaultScheduler } from '../../../clashpanel/core/scheduler.js';

test('default scheduler: frozen, exposes exactly now/setTimeout/clearTimeout/yield', () => {
  const s = createDefaultScheduler();
  assert.ok(Object.isFrozen(s));
  assert.deepEqual(Object.keys(s).sort(), ['clearTimeout', 'now', 'setTimeout', 'yield']);
  assert.equal(assertScheduler(s), s);
});

test('default scheduler: now() is a finite, non-decreasing number (no duration is asserted)', () => {
  const s = createDefaultScheduler();
  const a = s.now();
  const b = s.now();
  assert.ok(Number.isFinite(a) && b >= a);
});

test('default scheduler: setTimeout fires once and clearTimeout cancels', async () => {
  const s = createDefaultScheduler();
  let fired = 0;
  await new Promise((resolve) => { s.setTimeout(() => { fired += 1; resolve(); }, 0); });
  assert.equal(fired, 1);
  let cancelled = 0;
  const h = s.setTimeout(() => { cancelled += 1; }, 0);
  s.clearTimeout(h);
  await s.yield();
  await s.yield();
  assert.equal(cancelled, 0);
});

test('default scheduler: yield() returns a promise that resolves after a macrotask turn', async () => {
  const s = createDefaultScheduler();
  const order = [];
  const p = s.yield().then(() => order.push('yield'));
  queueMicrotask(() => order.push('microtask'));
  await p;
  assert.deepEqual(order, ['microtask', 'yield']);
});

test('assertScheduler: names the first missing member and rejects non-objects', () => {
  for (const name of ['now', 'setTimeout', 'clearTimeout', 'yield']) {
    const s = { now() {}, setTimeout() {}, clearTimeout() {}, yield() {} };
    delete s[name];
    assert.throws(() => assertScheduler(s), new RegExp(`scheduler\\.${name}`));
  }
  assert.throws(() => assertScheduler(null), TypeError);
  assert.throws(() => assertScheduler(undefined), TypeError);
});
