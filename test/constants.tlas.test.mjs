import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maxTlasCandidatePairs } from '../collision/constants.js';

test('maxTlasCandidatePairs is a positive integer', () => {
  assert.equal(Number.isInteger(maxTlasCandidatePairs), true);
  assert.ok(maxTlasCandidatePairs > 0);
});
