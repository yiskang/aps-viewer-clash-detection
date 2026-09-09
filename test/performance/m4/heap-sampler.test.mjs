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
