// test/performance/m4/run-difference-value-diff.test.mjs
//
// Unit tests for `describeRunDifference`'s per-pair VALUE half (`distanceDiff` / `witnessDiff` /
// `valueDiffPartitions`), added after a live §6.4 abort at S2[k=100:typical:clearance] produced a
// record that named ZERO pairs: pairSet, statistics and diagnostics all matched, `distances` and
// `witnesses` were both `false`, and the diff carried nothing an investigator could act on.
//
// These tests pin the two properties that make the new half trustworthy:
//   1. It reports exactly the pairs `correctness-comparator.mjs` rejected -- same join key, same
//      per-model-pair witness tolerance (`1e-9 x max(sourceDiagonal, targetDiagonal)`), same
//      "distance only for clearance / witness only for clearance+volume-overlap" contract guards.
//   2. It is purely descriptive: it never decides anything, and a run pair the comparator accepts
//      produces empty lists.
//
// Importing run-gate-m4.mjs does NOT start a gate run: that file guards `main()` behind an
// `isMainModule` check that also rejects `NODE_TEST_CONTEXT`, which `node --test` sets.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRunDifference } from '../run-gate-m4.mjs';
import { compareRuns } from './correctness-comparator.mjs';

const DIAGONALS = { structure: 314, arch: 500 };

function clearancePair(overrides = {}) {
  return {
    sourceModelTag: 'structure', sourceDbId: 3076,
    targetModelTag: 'structure', targetDbId: 4200,
    type: 'clearance',
    distance: 0.01,
    witness: { sourcePoint: [1, 2, 3], targetPoint: [1, 2, 3.01] },
    ...overrides,
  };
}

const emptyStats = () => ({ clearanceHits: 0, diagnostics: [] });
const run = (pairs) => ({ pairs, statistics: emptyStats() });

test('identical runs report no distance or witness differences', () => {
  const a = run([clearancePair()]);
  const b = run([clearancePair()]);
  const diff = describeRunDifference(a, b, { diagonalByTag: DIAGONALS });
  assert.deepEqual(diff.distanceDiff, []);
  assert.deepEqual(diff.witnessDiff, []);
  assert.equal(diff.distanceDiffCount, 0);
  assert.equal(diff.witnessDiffCount, 0);
  assert.equal(diff.valueDiffScaleResolved, true);
  assert.equal(diff.valueDiffPartitions[0].comparedPairs, 1);
});

test('a differing clearance distance is named with both values and the magnitude', () => {
  const a = run([clearancePair({ distance: 0.0100000 })]);
  const b = run([clearancePair({ distance: 0.0325000 })]);
  const diff = describeRunDifference(a, b, { diagonalByTag: DIAGONALS });
  assert.equal(diff.distanceDiffCount, 1);
  const [entry] = diff.distanceDiff;
  assert.equal(entry.pair, 'structure:3076:structure:4200:clearance');
  assert.equal(entry.partition, 'structure|structure');
  assert.equal(entry.sourceDbId, 3076);
  assert.equal(entry.targetDbId, 4200);
  assert.equal(entry.a, 0.01);
  assert.equal(entry.b, 0.0325);
  assert.ok(Math.abs(entry.delta - 0.0225) < 1e-12);
  // The same pair the canonical comparator rejects, and only that pair.
  assert.equal(compareRuns(a, b, { worldDiagonalScale: 314 }).fields.distances, false);
});

test('a differing witness is named with both points and the per-partition tolerance', () => {
  const a = run([clearancePair({ witness: { sourcePoint: [1, 2, 3], targetPoint: [1, 2, 3.01] } })]);
  const b = run([clearancePair({ witness: { sourcePoint: [1, 2.5, 3], targetPoint: [1, 2.5, 3.01] } })]);
  const diff = describeRunDifference(a, b, { diagonalByTag: DIAGONALS });
  assert.equal(diff.witnessDiffCount, 1);
  const [entry] = diff.witnessDiff;
  assert.equal(entry.reason, 'clearance-witness-differs');
  assert.deepEqual(entry.a.sourcePoint, [1, 2, 3]);
  assert.deepEqual(entry.b.sourcePoint, [1, 2.5, 3]);
  assert.ok(Math.abs(entry.maxComponentDelta - 0.5) < 1e-12);
  assert.equal(entry.witnessScale, 314);
  assert.ok(Math.abs(entry.witnessTolerance - 314e-9) < 1e-15);
});

test('a witness difference INSIDE §6.4\'s tolerance is not reported (matching the comparator)', () => {
  const eps = 1e-10 * 314; // an order of magnitude under 1e-9 x 314
  const a = run([clearancePair()]);
  const b = run([clearancePair({ witness: { sourcePoint: [1 + eps, 2, 3], targetPoint: [1, 2, 3.01] } })]);
  const diff = describeRunDifference(a, b, { diagonalByTag: DIAGONALS });
  assert.deepEqual(diff.witnessDiff, []);
  assert.equal(compareRuns(a, b, { worldDiagonalScale: 314 }).fields.witnesses, true);
});

test('the witness tolerance is per model-pair partition, not federation-wide', () => {
  // 4e-7 exceeds structure|structure's 3.14e-7 tolerance but is inside structure|arch's 5e-7 one.
  const delta = 4e-7;
  const ss = (o) => clearancePair(o);
  const sa = (o) => clearancePair({ targetModelTag: 'arch', targetDbId: 9001, ...o });
  const a = run([ss(), sa()]);
  const b = run([
    ss({ witness: { sourcePoint: [1 + delta, 2, 3], targetPoint: [1, 2, 3.01] } }),
    sa({ witness: { sourcePoint: [1 + delta, 2, 3], targetPoint: [1, 2, 3.01] } }),
  ]);
  const diff = describeRunDifference(a, b, { diagonalByTag: DIAGONALS });
  assert.equal(diff.witnessDiffCount, 1);
  assert.equal(diff.witnessDiff[0].partition, 'structure|structure');
  const byKey = Object.fromEntries(diff.valueDiffPartitions.map((p) => [p.key, p]));
  assert.equal(byKey['structure|structure'].witnessDiffCount, 1);
  assert.equal(byKey['structure|arch'].witnessDiffCount, 0);
});

test('distance is not compared for non-clearance pair types', () => {
  const vo = (o) => clearancePair({ type: 'volume-overlap', witness: { kind: 'triangle-contact', point: [0, 0, 0] }, ...o });
  const a = run([vo({ distance: null })]);
  const b = run([vo({ distance: 42 })]);
  const diff = describeRunDifference(a, b, { diagonalByTag: DIAGONALS });
  assert.deepEqual(diff.distanceDiff, []);
});

test('a volume-overlap witness kind change is reported as its own reason', () => {
  const vo = (o) => clearancePair({ type: 'volume-overlap', distance: null, witness: { kind: 'triangle-contact', point: [0, 0, 0] }, ...o });
  const a = run([vo()]);
  const b = run([vo({ witness: { kind: 'aabb-contact', point: [0, 0, 0] } })]);
  const diff = describeRunDifference(a, b, { diagonalByTag: DIAGONALS });
  assert.equal(diff.witnessDiffCount, 1);
  assert.equal(diff.witnessDiff[0].reason, 'overlap-witness-kind-differs');
});

test('two null witnesses are equal; one null is a presence mismatch', () => {
  const vo = (o) => clearancePair({ type: 'volume-overlap', distance: null, witness: null, ...o });
  assert.equal(describeRunDifference(run([vo()]), run([vo()]), { diagonalByTag: DIAGONALS }).witnessDiffCount, 0);
  const oneNull = describeRunDifference(
    run([vo()]),
    run([vo({ witness: { kind: 'triangle-contact', point: [0, 0, 0] } })]),
    { diagonalByTag: DIAGONALS },
  );
  assert.equal(oneNull.witnessDiffCount, 1);
  assert.equal(oneNull.witnessDiff[0].reason, 'witness-presence-mismatch');
});

test('a pair present in only one arm is counted, not compared (pairSetDiff already owns it)', () => {
  const a = run([clearancePair(), clearancePair({ targetDbId: 4201 })]);
  const b = run([clearancePair()]);
  const diff = describeRunDifference(a, b, { diagonalByTag: DIAGONALS });
  assert.equal(diff.valueDiffUnmatchedPairs, 1);
  assert.equal(diff.distanceDiffCount, 0);
  assert.equal(diff.pairSetDiff.length, 1);
});

test('an unresolvable world diagonal is reported, never silently replaced by a default', () => {
  const a = run([clearancePair()]);
  const b = run([clearancePair({ witness: { sourcePoint: [9, 9, 9], targetPoint: [9, 9, 9] } })]);
  const diff = describeRunDifference(a, b, { diagonalByTag: { structure: 0 } });
  assert.equal(diff.valueDiffScaleResolved, false);
  assert.equal(diff.witnessDiff[0].reason, 'witness-scale-unresolved');
  assert.equal(diff.witnessDiff[0].witnessTolerance, null);
});

test('omitting diagonalByTag degrades only the witness half, never the identity half', () => {
  const a = run([clearancePair({ distance: 1 })]);
  const b = run([clearancePair({ distance: 2 })]);
  const diff = describeRunDifference(a, b);
  assert.equal(diff.valueDiffScaleResolved, false);
  assert.equal(diff.distanceDiffCount, 1); // distance needs no scale
  assert.deepEqual(diff.pairSetDiff, []);
  assert.deepEqual(diff.diagnosticsDiff, []);
});

test('the sample list is capped but the counts are not', () => {
  const many = (arm) => run(Array.from({ length: 40 }, (_, i) => clearancePair({ targetDbId: 5000 + i, distance: arm })));
  const diff = describeRunDifference(many(0.01), many(0.02), { diagonalByTag: DIAGONALS });
  assert.equal(diff.distanceDiff.length, diff.valueDiffSampleCap);
  assert.equal(diff.distanceDiffCount, 40);
  assert.equal(diff.valueDiffPartitions[0].comparedPairs, 40);
  assert.ok(Math.abs(diff.valueDiffPartitions[0].maxDistanceDelta - 0.01) < 1e-12);
});
