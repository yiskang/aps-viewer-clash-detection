import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as constants from '../../../clashpanel/core/constants.js';

const SOURCE = readFileSync(new URL('../../../clashpanel/core/constants.js', import.meta.url), 'utf8');

test('constants: exports exactly the catalog names, nothing else', () => {
  assert.deepEqual(Object.keys(constants).sort(), [
    'BASIS_VERDICT_TIMEOUT_MS', 'DERIVATION_BUSY_MAX_RETRIES', 'DERIVATION_BUSY_RETRY_MS', 'FILTER_DEBOUNCE_MS',
    'GAP_DECIMALS', 'GAP_UNIT_LABEL', 'LABEL_CACHE_MAX', 'LIST_CHUNK_SIZE', 'PAGE_SIZE', 'READINESS_POLL_MS',
    'SOFT_UNAVAILABLE_TEXT',
  ]);
});

test('constants: values are the provisional presentation defaults of spec 12.4', () => {
  assert.equal(constants.PAGE_SIZE, 50);
  assert.equal(constants.FILTER_DEBOUNCE_MS, 150);
  assert.equal(constants.LIST_CHUNK_SIZE, 2000);
  assert.equal(constants.LABEL_CACHE_MAX, 5000);
  assert.equal(constants.READINESS_POLL_MS, 1000);
  assert.equal(constants.DERIVATION_BUSY_RETRY_MS, 50);
  assert.equal(constants.DERIVATION_BUSY_MAX_RETRIES, 5);
  assert.equal(constants.BASIS_VERDICT_TIMEOUT_MS, 2000);
  assert.equal(constants.GAP_UNIT_LABEL, 'scene units');
  assert.equal(constants.GAP_DECIMALS, 3);
});

test('constants: every numeric constant is a positive safe integer (no fractional or unbounded values)', () => {
  for (const [name, value] of Object.entries(constants)) {
    if (typeof value === 'number') assert.ok(Number.isSafeInteger(value) && value > 0, name);
    else assert.equal(typeof value, 'string', name);
  }
});

test('AC-P11: no exported name presents a presentation constant as an engine limit or a capacity', () => {
  for (const name of Object.keys(constants)) assert.ok(!/LIMIT|CALIBRAT|CAPACITY|CEILING|QUOTA/.test(name), name);
});

test('AC-P11: the source declares the values uncalibrated and never calls them calibrated or approved', () => {
  assert.match(SOURCE, /uncalibrated/);
  assert.doesNotMatch(SOURCE, /\b(calibrated|product-approved|hard limit|public limit|engine limit)\b/i);
});

test('PD-17: the fixed Soft-unavailable text is the spec wording and never implies an approximate result', () => {
  assert.equal(constants.SOFT_UNAVAILABLE_TEXT,
    "Soft (clearance) isn't available for these models: they don't share a verified common measurement basis.");
  assert.doesNotMatch(constants.SOFT_UNAVAILABLE_TEXT, /approx|caveat|estimate/i);
});
