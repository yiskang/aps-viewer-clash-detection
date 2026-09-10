import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sigEqual, distancesEqual, witnessesEqual, statisticsEqual, diagnosticsMultisetEqual, compareRuns } from './correctness-comparator.mjs';

const pair = (sourceDbId, targetDbId, type, extra = {}) => ({ sourceModelTag: 'structure', sourceDbId, targetModelTag: 'arch', targetDbId, type, distance: 0, witness: { kind: 'aabb-overlap', point: [0, 0, 0] }, ...extra });

test('sigEqual: full tuple equality, order-insensitive, counts alone insufficient', () => {
  assert.equal(sigEqual([pair(1, 2, 'volume-overlap')], [pair(1, 2, 'volume-overlap')]), true);
  assert.equal(sigEqual([pair(1, 2, 'volume-overlap')], [pair(1, 3, 'volume-overlap')]), false); // same count, different tuple
});

test('distancesEqual: bit-identical by default (tolerance 0), relaxed only when a worker tolerance is passed', () => {
  assert.equal(distancesEqual(0.04171234, 0.04171234), true);
  assert.equal(distancesEqual(0.04171234, 0.04171235), false);
  assert.equal(distancesEqual(0.04171234, 0.041712341, { tolerance: 1e-9 }), true, 'must pass with an explicit worker tolerance');
});

test('witnessesEqual: clearance shape {sourcePoint,targetPoint} within scale-relative tolerance', () => {
  const a = { sourcePoint: [1, 2, 3], targetPoint: [4, 5, 6] };
  const b = { sourcePoint: [1, 2, 3 + 1e-10], targetPoint: [4, 5, 6] };
  assert.equal(witnessesEqual(a, b, { worldDiagonalScale: 100 }), true);
});

test('witnessesEqual: volume-overlap shape {kind,point} rejects a shape mismatch', () => {
  const a = { sourcePoint: [1, 2, 3], targetPoint: [4, 5, 6] };
  const b = { kind: 'aabb-overlap', point: [1, 2, 3] };
  assert.equal(witnessesEqual(a, b, { worldDiagonalScale: 100 }), false);
});

test('statisticsEqual: the 6 named fields, timing fields excluded', () => {
  const s1 = { clearanceExactAabbSurvivors: 5, narrowPhasePairs: 5, clearanceOverlapPrechecksRun: 3, clearanceHardClashExclusions: 1, clearanceDistanceQueriesRun: 2, clearanceHits: 1, narrowPhaseMs: 999 };
  const s2 = { ...s1, narrowPhaseMs: 1 }; // timing field differs -- must not affect equality
  assert.equal(statisticsEqual(s1, s2), true);
});

test('diagnosticsMultisetEqual: role distinguishes source-side from target-side, singular fragment key required', () => {
  const a = [{ reason: 'clearance-anisotropic-scale-unsupported', scope: 'fragment', role: 'source', fragment: { modelTag: 'structure', dbId: 1, fragId: 10 } }];
  const b = [{ reason: 'clearance-anisotropic-scale-unsupported', scope: 'fragment', role: 'target', fragment: { modelTag: 'structure', dbId: 1, fragId: 10 } }];
  assert.equal(diagnosticsMultisetEqual(a, b), false, 'a source-side and target-side entry must NOT be treated as identical');
});

test('compareRuns: aggregates every field into one valid/invalid disposition', () => {
  const run = { pairs: [pair(1, 2, 'volume-overlap')], statistics: { clearanceExactAabbSurvivors: 1, narrowPhasePairs: 1, clearanceOverlapPrechecksRun: 1, clearanceHardClashExclusions: 0, clearanceDistanceQueriesRun: 0, clearanceHits: 0, diagnostics: [] } };
  const result = compareRuns(run, structuredClone(run), { worldDiagonalScale: 100 });
  assert.equal(result.valid, true);
});
