import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INSTANCE_BYTES, RECORD_BYTES, PLACEMENT_BYTES,
  INSTANCE_FIELD_SPEC, RECORD_FIELD_SPEC, bytesForFieldSpec,
} from './metric-m-calculator.mjs';

test('INSTANCE_BYTES (88) and RECORD_BYTES (104) match §15.1\'s literal constants', () => {
  assert.equal(INSTANCE_BYTES, 88);
  assert.equal(RECORD_BYTES, 104);
});

test('PLACEMENT_BYTES (192) matches §15.1\'s literal 16×8 + 6×8 + 16', () => {
  assert.equal(PLACEMENT_BYTES, 192);
});

test('a shape change (one more numeric field) invalidates the derived constant, not just the literal', () => {
  const grownSpec = [...INSTANCE_FIELD_SPEC, { name: 'extraNumericField', kind: 'numeric' }];
  assert.equal(bytesForFieldSpec(grownSpec), INSTANCE_BYTES + 8);
  assert.notEqual(bytesForFieldSpec(grownSpec), bytesForFieldSpec(INSTANCE_FIELD_SPEC));
});
