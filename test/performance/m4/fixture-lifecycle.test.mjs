// test/performance/m4/fixture-lifecycle.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUNTIME_CONFIGS, freshWorldTupleKey, measuredStatesFor } from './fixture-lifecycle.mjs';

test('RUNTIME_CONFIGS declares exactly the historical and multi-process launch arg sets', () => {
  assert.deepEqual(RUNTIME_CONFIGS.historical.args, ['--no-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote']);
  assert.deepEqual(RUNTIME_CONFIGS.multiProcess.args, ['--no-sandbox', '--disable-dev-shm-usage']);
  assert.equal(RUNTIME_CONFIGS.multiProcess.authoritative, true);
  assert.equal(RUNTIME_CONFIGS.historical.authoritative, false);
});

test('freshWorldTupleKey is stable per (runtime,case,broadPhase,repetition)', () => {
  const key = freshWorldTupleKey({ runtime: 'multiProcess', caseName: 'R3', broadPhase: 'tlas', repetition: 2 });
  assert.equal(key, 'multiProcess:R3:tlas:rep=2');
});

test('freshWorldTupleKey extends with level for S2T only', () => {
  const key = freshWorldTupleKey({ runtime: 'multiProcess', caseName: 'S2T', level: 10000, broadPhase: 'linear', repetition: 0 });
  assert.equal(key, 'multiProcess:S2T:level=10000:linear:rep=0');
});

test('measuredStatesFor: R6 has cold/warm/refresh, S4 is warm-only, everything else is cold/warm', () => {
  assert.deepEqual(measuredStatesFor('R6'), ['cold', 'warm', 'refresh']);
  assert.deepEqual(measuredStatesFor('S4'), ['warm']);
  assert.deepEqual(measuredStatesFor('R1'), ['cold', 'warm']);
  assert.deepEqual(measuredStatesFor('S2T'), ['cold', 'warm']);
});
