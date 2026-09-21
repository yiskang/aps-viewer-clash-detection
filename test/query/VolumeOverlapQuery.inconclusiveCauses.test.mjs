import { test } from 'node:test';
import assert from 'node:assert/strict';
import { volumeOverlapQuery } from '../../collision/query/VolumeOverlapQuery.js';
import { box, at, comb, mergeGeometries, openBottomedBox, testInstance } from '../fixtures/geometry.mjs';

test('crossing-budget-exhausted is surfaced as its own named cause', async () => {
  // Reused verbatim from VolumeOverlapQuery.conclusive.test.mjs's own fixture.
  const a = testInstance(comb(0));
  const b = testInstance(comb(0.05));
  const result = await volumeOverlapQuery(a, b, { crossing: { maxCandidatePairsExamined: 500 } });
  assert.equal(result.overlap, false);
  assert.equal(result.conclusive, false);
  assert.deepEqual(result.inconclusiveCauses, ['crossing-budget-exhausted']);
  assert.equal(typeof result.containmentSamplesUsed, 'number');
});

test('crossing-tolerance-ambiguous (boundary-probe grazed, NOT budget-aborted) is a DISTINCT cause from crossing-budget-exhausted', async () => {
  // Reused verbatim from VolumeOverlapQuery.conclusive.test.mjs's own flush-touching fixture,
  // including the removal of that fixture's obsolete `crossing: { frameBudgetMs: 5000 }` cold-start
  // workaround -- after Phase C the wall clock cannot set `aborted`, so nothing can divert this
  // fixture from the inconclusive branch it exists to cover.
  const a = testInstance(box(2, 2, 2));
  const b = testInstance(box(2, 2, 2), at(0, 2, 0));
  const result = await volumeOverlapQuery(a, b);
  assert.equal(result.overlap, false);
  assert.equal(result.conclusive, false);
  assert.deepEqual(result.inconclusiveCauses, ['crossing-tolerance-ambiguous']);
});

test('aspect-ratio-exceeded, forced on the source, is surfaced independent of the crossing term\'s own real budget state', async () => {
  const source = testInstance(box(2, 2, 2));
  source.aspectRatioExceeded = true; // forces the crossing-skip synthetic branch
  const target = testInstance(box(2, 2, 2), at(10, 0, 0));
  const result = await volumeOverlapQuery(source, target);
  assert.equal(result.overlap, false);
  assert.equal(result.conclusive, false);
  assert.deepEqual(result.inconclusiveCauses, ['aspect-ratio-exceeded']);
});

test('unresolved-containment fires when a component budget forces unresolvedComponentCount > 0', async () => {
  // Reused verbatim from VolumeOverlapQuery.conclusive.test.mjs's own 20-disjoint-components fixture.
  const parts = [];
  for (let i = 0; i < 20; i++) parts.push(box(2, 2, 2).translate(i * 3, 20, 0));
  const source = testInstance(mergeGeometries(parts));
  const target = testInstance(box(4, 4, 4));
  const result = await volumeOverlapQuery(source, target, { containment: { maxContainmentSamples: 10 } });
  assert.equal(result.overlap, false);
  assert.equal(result.conclusive, false);
  assert.ok(result.inconclusiveCauses.includes('unresolved-containment'));
});

test('non-manifold-component covers BOTH the literal non-manifold-component diagnostic and unverified-parity-operand', async () => {
  // Reused verbatim from VolumeOverlapQuery.conclusive.test.mjs's own two fixtures.
  const partA = box(1, 1, 1);
  const partB = box(1, 1, 1).translate(1, 0, 0);
  const src = testInstance(mergeGeometries([partA, partB]));
  const target = testInstance(box(0.2, 0.2, 0.2), at(10, 10, 10));
  const result1 = await volumeOverlapQuery(src, target);
  assert.deepEqual(result1.inconclusiveCauses, ['non-manifold-component']);

  const source2 = testInstance(box(1, 1, 1), at(50, 0, 0));
  const target2 = testInstance(openBottomedBox(4));
  const result2 = await volumeOverlapQuery(source2, target2);
  assert.deepEqual(result2.inconclusiveCauses, ['non-manifold-component']);
});

test('mixed case: one containment term aspect-gated, the OTHER genuinely budget-exhausted -- both real causes present, no spurious double-count', async () => {
  // Same 20-disjoint-components fixture as the unresolved-containment test above, but with
  // source.aspectRatioExceeded forced too. This gates bInA (its containerRole is 'source', so it
  // reads source.aspectRatioExceeded) via anyComponentInside's own early short-circuit -- while aInB
  // (containerRole 'target', reads target.aspectRatioExceeded, which is NOT set) runs the real
  // sampling loop and genuinely exhausts its budget. Verifies the aspect-gated term's own synthetic
  // unresolvedComponentCount does not need to contribute for 'unresolved-containment' to correctly
  // appear here -- it is driven entirely by aInB's real, independent budget exhaustion.
  const parts = [];
  for (let i = 0; i < 20; i++) parts.push(box(2, 2, 2).translate(i * 3, 20, 0));
  const source = testInstance(mergeGeometries(parts));
  source.aspectRatioExceeded = true;
  const target = testInstance(box(4, 4, 4));
  const result = await volumeOverlapQuery(source, target, { containment: { maxContainmentSamples: 10 } });
  assert.equal(result.overlap, false);
  assert.equal(result.conclusive, false);
  assert.deepEqual(result.inconclusiveCauses, ['aspect-ratio-exceeded', 'containment-sample-budget-exhausted', 'unresolved-containment']);
});

test('a fully-resolved genuine negative has an EMPTY, sorted inconclusiveCauses array', async () => {
  const a = testInstance(box(2, 2, 2));
  const sep = testInstance(box(2, 2, 2), at(10, 0, 0));
  const result = await volumeOverlapQuery(a, sep);
  assert.equal(result.conclusive, true);
  assert.deepEqual(result.inconclusiveCauses, []);
});

// Task 1.5 fix round: containmentSamplesUsed must also be a REAL count on every positive-overlap
// return, not left undefined -- each site's correct value depends on which containment term(s), if
// any, actually ran before that return.
test('containmentSamplesUsed is 0 on a crossing-positive result (neither containment term ever runs)', async () => {
  const a = testInstance(box(2, 2, 2));
  const b = testInstance(box(2, 2, 2), at(1, 0, 0));
  const result = await volumeOverlapQuery(a, b);
  assert.equal(result.overlap, true);
  assert.equal(result.via, 'crossing');
  assert.equal(result.containmentSamplesUsed, 0);
});

test('containmentSamplesUsed is aInB\'s real samplesUsed on a containment(A in B)-positive result (bInA never runs)', async () => {
  const a = testInstance(box(1, 1, 1));
  const b = testInstance(box(10, 10, 10));
  const result = await volumeOverlapQuery(a, b);
  assert.equal(result.overlap, true);
  assert.equal(result.via, 'containment(A in B)');
  assert.equal(result.containmentSamplesUsed, result.stats.aInB.samplesUsed);
  assert.ok(result.containmentSamplesUsed > 0);
});

test('containmentSamplesUsed is aInB + bInA\'s combined real samplesUsed on a containment(B in A)-positive result (both terms ran)', async () => {
  const a = testInstance(box(10, 10, 10));
  const b = testInstance(box(1, 1, 1));
  const result = await volumeOverlapQuery(a, b);
  assert.equal(result.overlap, true);
  assert.equal(result.via, 'containment(B in A)');
  assert.equal(result.containmentSamplesUsed, result.stats.aInB.samplesUsed + result.stats.bInA.samplesUsed);
  assert.ok(result.containmentSamplesUsed > 0);
});
