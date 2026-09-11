import test from 'node:test';
import assert from 'node:assert/strict';
import { computeContentDigest } from '../../collision/geometry/contentDigest.js';

test('computeContentDigest returns 32 lowercase hex chars', () => {
  const digest = computeContentDigest([new Uint8Array([1, 2, 3])]);
  assert.match(digest, /^[0-9a-f]{32}$/);
});

test('computeContentDigest is deterministic and byte-sensitive', () => {
  const a = computeContentDigest([new Uint8Array([1, 2, 3])]);
  const b = computeContentDigest([new Uint8Array([1, 2, 3])]);
  const c = computeContentDigest([new Uint8Array([1, 2, 4])]);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('computeContentDigest treats multiple views as one concatenated stream', () => {
  const split = computeContentDigest([new Uint8Array([1, 2]), new Uint8Array([3])]);
  const whole = computeContentDigest([new Uint8Array([1, 2, 3])]);
  assert.equal(split, whole);
});
