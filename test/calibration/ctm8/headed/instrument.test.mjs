// Node tests for the pure part of the headed instrumentation (CTM8-P0-v4 §9.3 completion rule, §9.2 stats).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('./instrument.js', import.meta.url), 'utf8');
const ctx = {};
ctx.globalThis = ctx;
vm.runInNewContext(src, ctx);
const P = ctx.__ctm8Pure;

test('loads without a DOM and exposes only the pure part', () => {
  assert.equal(P.VERSION, 'ctm8-headed-instrument/1');
  assert.equal(ctx.__ctm8, undefined);
});

test('tD = first hold; quiet window not added', () => {
  const tr = P.createCompletionTracker({ t0: 100 });
  assert.equal(tr.observe(150, false).done, false);
  assert.equal(tr.observe(180, true, { mutation: true }).done, false);
  assert.equal(tr.poll(429).done, false);
  const out = tr.poll(430);
  assert.deepEqual({ ...out }, { done: true, status: 'OK', tD: 180, durationMs: 80 });
});

test('mutation inside the quiet window moves tD to the next hold', () => {
  const tr = P.createCompletionTracker({ t0: 0 });
  tr.observe(50, true, { mutation: true });
  tr.observe(200, false, { mutation: true });   // provisional state: predicate no longer holds
  tr.observe(210, false);
  tr.observe(300, true, { mutation: true });
  assert.equal(tr.poll(549).done, false);
  assert.equal(tr.poll(550).tD, 300);
});

test('mutation that keeps the predicate true still restarts the window at the mutation', () => {
  const tr = P.createCompletionTracker({ t0: 0 });
  tr.observe(10, true);
  tr.observe(100, true, { mutation: true });
  assert.equal(tr.poll(300).done, false);
  assert.equal(tr.poll(350).tD, 100);
});

test('non-mutation hold observations do not move an existing candidate', () => {
  const tr = P.createCompletionTracker({ t0: 0 });
  tr.observe(10, true);
  tr.observe(20, true);
  assert.equal(tr.poll(260).tD, 10);
});

test('10 s timeout', () => {
  const tr = P.createCompletionTracker({ t0: 0 });
  tr.observe(5, false);
  const out = tr.poll(10000);
  assert.equal(out.status, 'TIMEOUT');
  assert.equal(out.elapsedMs, 10000);
});

test('summarize: median/min/max only', () => {
  assert.deepEqual({ ...P.summarize([5, 1, 3, 2, 4]) }, { n: 5, median: 3, min: 1, max: 5 });
  assert.deepEqual({ ...P.summarize([4, 1, 3, 2]) }, { n: 4, median: 2.5, min: 1, max: 4 });
  assert.equal(P.summarize([]).median, null);
});
