// Task D7 -- design doc §11 regression H, "Composition with the deterministic budget"
// (docs/superpowers/specs/2026-09-11-canonical-ordering-operand-symmetry-fix-design.md:906-912).
//
// Task C6 (test/query/ProperCrossingQuery.deterministic.test.mjs §13 C) already proved, at the
// KERNEL level, that properCrossingQuery's deterministic-budget composition -- normal completion,
// deterministic budget exhaustion, and wall-clock telemetry threshold crossing -- is wall-clock-
// independent. That file's own header explicitly declares it does NOT cover the WRAPPER
// (volumeOverlapQuery) boundary: whether canonical orientation (orientForCrossing) makes both
// public-role orders (forward `volumeOverlapQuery(duct, beam)` vs. backward
// `volumeOverlapQuery(beam, duct)`) resolve to the identical underlying kernel call, and therefore
// bit-identical results, across the same three regimes. This file closes that gap.
//
// `crossing` and `aborted` are fields on the RAW properCrossingQuery return (the "kernel record")
// -- VolumeOverlapQuery.js never re-exposes them on its own public result (it forwards only
// `crossing.stats` as `result.stats.crossing`, and consumes `crossing.crossing`/`crossing.aborted`
// internally to decide control flow). So H(i)-H(iii)'s claim about those two fields is asserted the
// same way Task A4.2's live-replay script asserts it: call `orientForCrossing` directly to
// determine canonical order, then call `properCrossingQuery` directly (bypassing the wrapper) on
// the canonically-oriented operands from BOTH starting public-role orders. Since orientForCrossing
// is itself swap-invariant (test/query/orientForCrossing.test.mjs), both starting orders resolve to
// the identical (first, second) pair and therefore the identical kernel call -- proving the
// wrapper's swap-invariance is not an accident of this one fixture but a structural consequence of
// canonical ordering.
//
// Field-path ground truth (verified directly against collision/query/VolumeOverlapQuery.js and
// collision/query/ProperCrossingQuery.js before writing this file, per Task D7's brief -- Task
// A4.2's own field-path claim is corroborating precedent, not something this file imports):
//   - `exhaustedBudget`, `timeBudgetExceeded`, `elapsedMs`, `candidatePairsExamined`,
//     `crossingPairsExamined`, `pointClassifications` all live at `result.stats.crossing.*` on the
//     wrapper's public return (VolumeOverlapQuery.js:218/274/323/402, `stats: { crossing:
//     crossing.stats, ... }`).
//   - `overlap` and `conclusive` are top-level wrapper fields.
//   - `crossing.crossing` / `crossing.aborted` (the raw properCrossingQuery record) are NOT on the
//     wrapper's public return at all -- confirmed by reading every `return` in
//     VolumeOverlapQuery.js's crossing branch.
//   - properCrossingQuery's real budget-option names are `maxCandidatePairsExamined`,
//     `maxCrossingPairsExamined`, `maxCrossingPointClassifications`, and its injected-clock option
//     is literally `options.now` (ProperCrossingQuery.js:66-68, 70-83) -- all as the brief's own
//     skeleton assumed; no correction needed. `frameBudgetMs` (collision/constants.js:42) is 8.
//   - The wrapper forwards `options.crossing` to properCrossingQuery verbatim
//     (VolumeOverlapQuery.js:146-149), so `{ crossing: { now, maxCandidatePairsExamined, ... } }` is
//     the correct call shape at the wrapper boundary.

import test from 'node:test';
import assert from 'node:assert/strict';
import { volumeOverlapQuery } from '../../collision/query/VolumeOverlapQuery.js';
import { properCrossingQuery } from '../../collision/query/ProperCrossingQuery.js';
import { orientForCrossing } from '../../collision/query/orientForCrossing.js';
import { box, testInstance } from '../fixtures/geometry.mjs';

// Same relative-transform/direct-kernel-call shape as
// test/query/ProperCrossingQuery.deterministic.test.mjs's own `relativeMatrix`/`crossOf` helpers
// (not imported -- that file does not export them -- but structurally identical, since this is the
// same "call properCrossingQuery directly on two already-oriented operands" operation).
function relativeMatrix(a, b) {
  return a.matrix.clone().invert().multiply(b.matrix);
}
function crossOf(a, b, options) {
  return properCrossingQuery(a.bvh, b.bvh, relativeMatrix(a, b), a.localDiagonal, b.localDiagonal, options);
}

// Resolves canonical order from a given PUBLIC-role starting order, then calls properCrossingQuery
// directly on the canonically-oriented pair -- the Task A4.2-equivalent pattern this file's header
// describes, used to assert the `crossing`/`aborted` kernel-record fields the wrapper never exposes.
function orientedKernelCall(publicFirst, publicSecond, options) {
  const { first, second } = orientForCrossing(publicFirst, publicSecond);
  return crossOf(first, second, options);
}

// The one fixture pair used throughout this file (also the brief's own H(ii)/H(iii) fixture):
// a duct crossing a beam at right angles through the origin. Verified empirically (see this task's
// report) to: (a) reach a genuine positive crossing under DEFAULT budgets with no exhaustion --
// candidatePairsExamined:3, crossingPairsExamined:1, pointClassifications:14 -- so H(i) genuinely
// exercises normal completion, not a silently-exhausted budget under a different name; (b) still
// have exactly ONE crossing pair and 3 candidate pairs total, so a cap of 1 on
// maxCandidatePairsExamined and a cap of 0 on maxCrossingPairsExamined are the minimal caps that
// deterministically force those two exhaustion attributions on this fixture (not arbitrary small
// numbers).
function fixture() {
  return {
    duct: testInstance(box(20, 0.4, 0.4)),
    beam: testInstance(box(0.4, 0.4, 20)),
  };
}

test('H(i) — normal completion is bit-identical under both public-role orders', async () => {
  const { duct, beam } = fixture();
  const forward = await volumeOverlapQuery(duct, beam);
  const backward = await volumeOverlapQuery(beam, duct);

  // Sanity: this fixture must genuinely complete WITHOUT exhausting any budget, or this test would
  // only prove H(ii)'s claim under H(i)'s name.
  assert.equal(forward.stats.crossing.exhaustedBudget, null, 'sanity: normal completion, no budget exhausted');
  assert.equal(backward.stats.crossing.exhaustedBudget, null, 'sanity: normal completion, no budget exhausted');

  assert.equal(forward.overlap, backward.overlap);
  assert.equal(forward.conclusive, backward.conclusive);
  assert.equal(forward.stats.crossing.candidatePairsExamined, backward.stats.crossing.candidatePairsExamined);
  assert.equal(forward.stats.crossing.crossingPairsExamined, backward.stats.crossing.crossingPairsExamined);
  assert.equal(forward.stats.crossing.pointClassifications, backward.stats.crossing.pointClassifications);

  // Kernel-record fields (`crossing`/`aborted`) are not on the wrapper's public return -- assert
  // them via the direct orientForCrossing + properCrossingQuery pattern instead.
  const fwdKernel = orientedKernelCall(duct, beam, undefined);
  const bwdKernel = orientedKernelCall(beam, duct, undefined);
  assert.equal(fwdKernel.crossing, bwdKernel.crossing);
  assert.equal(fwdKernel.aborted, bwdKernel.aborted);
});

// H(ii) -- one sub-case per deterministic cap, each deliberately binding on this fixture (verified
// empirically, not guessed): `maxCrossingPointClassifications: 4` is the brief's own literal
// example; `maxCandidatePairsExamined: 1` and `maxCrossingPairsExamined: 0` are this fixture's
// minimal binding caps for the other two counters (see the fixture() comment above).
const H2_CASES = [
  { what: 'maxCrossingPointClassifications (brief\'s own example)', options: { maxCrossingPointClassifications: 4 }, expectedExhaustedBudget: 'point-classifications' },
  { what: 'maxCandidatePairsExamined', options: { maxCandidatePairsExamined: 1 }, expectedExhaustedBudget: 'candidate-pairs' },
  { what: 'maxCrossingPairsExamined', options: { maxCrossingPairsExamined: 0 }, expectedExhaustedBudget: 'crossing-pairs' },
];

for (const { what, options, expectedExhaustedBudget } of H2_CASES) {
  test(`H(ii) — deterministic budget exhaustion (${what}) is bit-identical under both public-role orders`, async () => {
    const { duct, beam } = fixture();
    const forward = await volumeOverlapQuery(duct, beam, { crossing: options });
    const backward = await volumeOverlapQuery(beam, duct, { crossing: options });

    // Sanity: the cap must actually bind on this fixture, and attribute to the cap under test --
    // otherwise this sub-case would silently degenerate into H(i) under a different name.
    assert.equal(forward.stats.crossing.exhaustedBudget, expectedExhaustedBudget, `sanity: ${what} must actually bind`);
    assert.equal(backward.stats.crossing.exhaustedBudget, expectedExhaustedBudget, `sanity: ${what} must actually bind`);

    assert.equal(forward.stats.crossing.exhaustedBudget, backward.stats.crossing.exhaustedBudget);
    assert.equal(forward.overlap, backward.overlap);
    assert.equal(forward.conclusive, backward.conclusive);
    assert.equal(forward.stats.crossing.candidatePairsExamined, backward.stats.crossing.candidatePairsExamined);
    assert.equal(forward.stats.crossing.crossingPairsExamined, backward.stats.crossing.crossingPairsExamined);
    assert.equal(forward.stats.crossing.pointClassifications, backward.stats.crossing.pointClassifications);

    // Kernel-record fields, via the same direct pattern as H(i).
    const fwdKernel = orientedKernelCall(duct, beam, options);
    const bwdKernel = orientedKernelCall(beam, duct, options);
    assert.equal(fwdKernel.crossing, bwdKernel.crossing);
    assert.equal(fwdKernel.aborted, bwdKernel.aborted);
  });
}

test('H(iii) — wall-clock telemetry threshold crossing changes no semantic field', async () => {
  const { duct, beam } = fixture();
  // This fixture resolves via a single properCrossingQuery call (an early-exit positive crossing;
  // no aspect-ratio skip, no second kernel call), so `now()` is read exactly twice per
  // volumeOverlapQuery call (entry, exit) -- confirmed by inspection of ProperCrossingQuery.js's own
  // "exactly two reads remain" comment. A fresh counter closure per call keeps the two calls
  // (forward/backward, or slow/fast) from sharing state.
  //
  // slowNow: entry reads 0, exit reads 20 -- a 20ms span, past frameBudgetMs (8, constants.js:42).
  // fastNow: the real clock -- this fixture's traversal completes in a fraction of a millisecond
  // (verified empirically: ~0.15ms), comfortably under the 8ms threshold.
  const makeSlowNow = () => { let n = 0; return () => (n++ === 0 ? 0 : 20); };
  const fastNow = () => performance.now();

  const slow = await volumeOverlapQuery(duct, beam, { crossing: { now: makeSlowNow() } });
  const fast = await volumeOverlapQuery(duct, beam, { crossing: { now: fastNow } });

  assert.notEqual(
    slow.stats.crossing.timeBudgetExceeded,
    fast.stats.crossing.timeBudgetExceeded,
  ); // the ONE field allowed to differ
  assert.equal(slow.stats.crossing.timeBudgetExceeded, true, 'sanity: the slow clock must actually cross the threshold');
  assert.equal(fast.stats.crossing.timeBudgetExceeded, false, 'sanity: the fast clock must not');

  assert.equal(slow.stats.crossing.exhaustedBudget, fast.stats.crossing.exhaustedBudget);
  assert.equal(slow.stats.crossing.candidatePairsExamined, fast.stats.crossing.candidatePairsExamined);
  assert.equal(slow.stats.crossing.crossingPairsExamined, fast.stats.crossing.crossingPairsExamined);
  assert.equal(slow.stats.crossing.pointClassifications, fast.stats.crossing.pointClassifications);
  assert.equal(slow.overlap, fast.overlap);
  assert.equal(slow.conclusive, fast.conclusive);

  // Kernel-record fields, via the same direct pattern -- both starting from the SAME public-role
  // order here (duct, beam), since H(iii)'s claim is about the clock, not about operand order (that
  // is H(i)/H(ii)'s claim, already covered above).
  const orientation = orientForCrossing(duct, beam);
  const slowKernel = crossOf(orientation.first, orientation.second, { now: makeSlowNow() });
  const fastKernel = crossOf(orientation.first, orientation.second, { now: fastNow });
  assert.equal(slowKernel.crossing, fastKernel.crossing);
  assert.equal(slowKernel.aborted, fastKernel.aborted);
});
