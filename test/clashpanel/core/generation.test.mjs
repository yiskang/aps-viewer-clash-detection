// test/clashpanel/core/generation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeneration } from '../../../clashpanel/core/generation.js';

test('generation: starts at 0, bump returns the new value, current tracks it', () => {
  const g = createGeneration();
  assert.equal(g.current(), 0);
  assert.equal(g.bump(), 1);
  assert.equal(g.bump(), 2);
  assert.equal(g.current(), 2);
});

test('generation: isCurrent is true only for the live value (monotone, never reused)', () => {
  const g = createGeneration();
  const first = g.current();
  g.bump();
  assert.equal(g.isCurrent(first), false);
  assert.equal(g.isCurrent(g.current()), true);
  assert.equal(g.isCurrent('1'), false);
  assert.equal(g.isCurrent(undefined), false);
  assert.equal(g.isCurrent(NaN), false);
});

test('generation: independent instances do not share state; the object is frozen', () => {
  const a = createGeneration();
  const b = createGeneration();
  a.bump();
  assert.equal(b.current(), 0);
  assert.ok(Object.isFrozen(a));
});

test('generation.onBump: listeners run synchronously with the new value, in registration order', () => {
  const g = createGeneration();
  const seen = [];
  g.onBump((n) => seen.push(['a', n]));
  g.onBump((n) => seen.push(['b', n]));
  g.bump();
  assert.deepEqual(seen, [['a', 1], ['b', 1]]);
});

test('generation.onBump: unsubscribe works, a throwing listener never breaks bump or its neighbours, non-functions throw', () => {
  const g = createGeneration();
  const seen = [];
  const off = g.onBump(() => seen.push('gone'));
  g.onBump(() => { throw new Error('listener'); });
  g.onBump(() => seen.push('kept'));
  off();
  assert.equal(g.bump(), 1);
  assert.deepEqual(seen, ['kept']);
  assert.throws(() => g.onBump('nope'), TypeError);
});

test('generation.onBump: a listener that unsubscribes itself during a bump does not skip the others', () => {
  const g = createGeneration();
  const seen = [];
  const off = g.onBump(() => { seen.push('self'); off(); });
  g.onBump(() => seen.push('other'));
  g.bump();
  g.bump();
  assert.deepEqual(seen, ['self', 'other', 'other']);
});
