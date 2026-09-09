import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleHeap } from './heap-sampler.mjs';

test('sampleHeap reports UNAVAILABLE, not zero, when the target has no gc()/performance.memory', async () => {
  const fakePage = {
    evaluate: async (fn) => { throw new Error('gc is not defined'); },
  };
  const result = await sampleHeap('main', fakePage);
  assert.equal(result.available, false);
  assert.match(result.reason, /gc/i);
});

test('sampleHeap returns the median of three post-GC readings on a target that supports the protocol', async () => {
  const readings = [1000, 1200, 1100]; // unsorted on purpose -- median must be computed, not the first/last
  let call = 0;
  const fakePage = {
    evaluate: async (fn) => readings[call++],
  };
  const result = await sampleHeap('main', fakePage);
  assert.equal(result.available, true);
  assert.equal(result.bytes, 1100); // median of [1000,1100,1200], not readings[0]
});

test('sampleHeap on a worker target reports UNAVAILABLE for the rAF-settling turns a worker realm cannot provide, per spec §15.1', async () => {
  const fakeWorkerChannel = { evaluateInWorker: async () => { throw new Error('requestAnimationFrame is not defined in this realm'); } };
  const result = await sampleHeap('worker', fakeWorkerChannel);
  assert.equal(result.available, false);
  assert.match(result.reason, /requestAnimationFrame|rAF/i);
});

// --- Post-review hardening (codex-review `code`, medium, round 2) ---

test('sampleHeap propagates an unexpected page/channel failure instead of misclassifying it as feature-unavailable', async () => {
  const fakePage = {
    evaluate: async () => { throw new Error('Protocol error: Execution context was destroyed'); },
  };
  await assert.rejects(
    () => sampleHeap('main', fakePage),
    (err) => err instanceof Error && /Execution context was destroyed/.test(err.message)
  );
});

test('sampleHeap normalizes a non-Error rejection value (e.g. null) instead of throwing a confusing secondary TypeError', async () => {
  const fakePage = {
    evaluate: async () => { throw null; },
  };
  await assert.rejects(
    () => sampleHeap('main', fakePage),
    (err) => err instanceof Error && typeof err.message === 'string'
  );
});

test('sampleHeap rejects invalid heap readings (undefined/NaN/negative/Infinity) as protocol defects, never as a valid sample', async () => {
  for (const badValue of [undefined, NaN, -5, Infinity]) {
    const fakePage = { evaluate: async () => badValue };
    await assert.rejects(
      () => sampleHeap('main', fakePage),
      /invalid heap reading/i,
      `expected rejection for reading ${String(badValue)}`
    );
  }
});

test('sampleHeap throws for a target other than "main" or "worker" instead of silently treating it as a worker', async () => {
  const fakeChannel = { evaluateInWorker: async () => 123 };
  await assert.rejects(
    () => sampleHeap('typo', fakeChannel),
    /unknown target/i
  );
});
