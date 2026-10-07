// test/CollisionWorld.clearanceLegacyGolden.test.mjs
//
// SVF2 non-uniform fragment clearance design §8 T0: the legacy (rigid x positive uniform scale)
// clearance path must stay BIT-IDENTICAL. `test/fixtures/clearance-legacy-golden.json` was captured
// by `test/fixtures/generate-clearance-legacy-golden.mjs` before any source change of that design;
// this test re-runs the identical scenarios and compares every number with `Object.is` (exact float
// bits, -0 distinguished), every string/boolean strictly, and every array/object shape exhaustively.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GOLDEN_PATH, FIND_CLASHES_SCENARIOS, DIRECT_QUERY_SCENARIOS,
  runFindClashesScenario, runDirectQueryScenario, encodeExact, decodeExact,
} from './fixtures/generate-clearance-legacy-golden.mjs';

const golden = decodeExact(JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')));

// Same exact encoding the generator used, so `undefined`-valued keys drop identically.
const roundTrip = (value) => decodeExact(JSON.parse(JSON.stringify(encodeExact(value))));

function assertExact(actual, expected, path) {
  if (typeof expected === 'number') {
    assert.ok(Object.is(actual, expected), `${path}: expected ${Object.is(expected, -0) ? '-0' : expected}, got ${actual}`);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path}: expected an array`);
    assert.equal(actual.length, expected.length, `${path}: array length`);
    expected.forEach((v, i) => assertExact(actual[i], v, `${path}[${i}]`));
    return;
  }
  if (expected && typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object' && !Array.isArray(actual), `${path}: expected an object`);
    // JSON drops `undefined`-valued keys, so compare only keys whose value is defined.
    const definedKeys = (o) => Object.keys(o).filter((k) => o[k] !== undefined).sort();
    assert.deepEqual(definedKeys(actual), definedKeys(expected), `${path}: key set`);
    for (const k of definedKeys(expected)) assertExact(actual[k], expected[k], `${path}.${k}`);
    return;
  }
  assert.equal(actual, expected, path);
}

test('golden file covers exactly the defined scenarios', () => {
  assert.deepEqual(Object.keys(golden.findClashes).sort(), FIND_CLASHES_SCENARIOS.map((s) => s.name).sort());
  assert.deepEqual(Object.keys(golden.directQuery).sort(), DIRECT_QUERY_SCENARIOS.map((s) => s.name).sort());
});

for (const scenario of FIND_CLASHES_SCENARIOS) {
  test(`legacy golden (findClashes): ${scenario.name}`, async () => {
    assertExact(roundTrip(await runFindClashesScenario(scenario)), golden.findClashes[scenario.name], scenario.name);
  });
}

for (const scenario of DIRECT_QUERY_SCENARIOS) {
  test(`legacy golden (clearanceQuery): ${scenario.name}`, () => {
    assertExact(roundTrip(runDirectQueryScenario(scenario)), golden.directQuery[scenario.name], scenario.name);
  });
}
