import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHardClashPrecheck } from '../../collision/query/ClearanceHardClashPrecheck.js';
import { box, at, comb, testInstance, THREE } from '../fixtures/geometry.mjs';

function worldBoundsOf(instance) {
  instance.geometry.computeBoundingBox();
  const box3 = instance.geometry.boundingBox.clone().applyMatrix4(instance.matrix);
  return { min: [box3.min.x, box3.min.y, box3.min.z], max: [box3.max.x, box3.max.y, box3.max.z] };
}

const noOptions = {}; // classifyHardClashPrecheck must default scheduler itself when the caller omits
                        // it, exactly as volumeOverlapQuery's own default does, so a standalone unit
                        // test need not construct a real CollisionWorld checkpoint. (compareCanonical
                        // no longer exists on this path -- removed from volumeOverlapQuery in Task
                        // A2.1 and from this call site in Task A2.2.)

test('AABBs genuinely disjoint -> skip-precheck (volumeOverlapQuery never called)', async () => {
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(20, 0, 0));
  const result = await classifyHardClashPrecheck(source, target, worldBoundsOf(source), worldBoundsOf(target), noOptions);
  assert.equal(result.status, 'skip-precheck');
});

// Fixture 5: positive-volume overlap -> proven overlap -> excluded.
//
// HISTORICAL NOTE, kept because it records why this file used to look different. An earlier
// codex-advisor review found that with the shared `noOptions` this fixture's crossing term was
// subject to the REAL 8 ms wall-clock `frameBudgetMs` default: under full-suite CPU contention a
// scheduling pause could abort the crossing traversal before it found the (here genuine and
// easy-to-find) positive witness, intermittently flipping the result. The workaround was to freeze
// ProperCrossingQuery's own `crossing.now` seam.
//
// THAT EXPOSURE NO LONGER EXISTS, and the workaround is removed with it. Phase C of
// docs/superpowers/specs/2026-09-11-proper-crossing-query-deterministic-budget-fix-design.md
// deleted both of ProperCrossingQuery's wall-clock semantic branches: elapsed time can no longer
// set `aborted`, so no scheduling pause of any length can turn this proven overlap into a
// non-overlap. The test runs on the shared `noOptions` again, and its staying green is itself part
// of the fix's evidence (§13 G's "removing it and staying green is itself a regression signal").
test('fixture 5: overlapping boxes -> excluded', async () => {
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(1, 0, 0));
  const result = await classifyHardClashPrecheck(source, target, worldBoundsOf(source), worldBoundsOf(target), noOptions);
  assert.equal(result.status, 'excluded');
});

// Fixture 6: containment -> proven overlap -> excluded, even though surfaces are far apart.
test('fixture 6: containment -> excluded', async () => {
  const source = testInstance(box(10, 10, 10), at(0, 0, 0));
  const target = testInstance(box(1, 1, 1), at(3, 3, 3));
  const result = await classifyHardClashPrecheck(source, target, worldBoundsOf(source), worldBoundsOf(target), noOptions);
  assert.equal(result.status, 'excluded');
});

// Placeholder resolution note: the brief's own literal skeleton used two axis-aligned, flush
// face-touching box(2,2,2)s (at(0,0,0) / at(2,0,0)) for this case. Verified empirically (and
// consistent with Task 6's OWN "flush touching (round 3 headline)" conclusive:false fixture in
// test/query/VolumeOverlapQuery.conclusive.test.mjs, which is geometrically the exact same
// flush-face-touching situation just along a different axis): a flush face-to-face touch is
// PRECISELY the grazing-probe case ProperCrossingQuery can never resolve conclusively (every
// boundary probe on the shared coplanar face grazes a triangle edge), so that fixture
// deterministically comes back conclusive:false (inconclusive-crossing / crossing-budget-exhausted),
// not conclusive:true -- it cannot exercise this test's own claim.
//
// Replacement fixture, same AABB precondition (aabbMinDistance <= 0, so the precheck does not
// skip) but a genuinely non-grazing negative: source is a box(2,2,2) rotated 45 degrees about Y,
// whose world AABB (a square, x/z in [-1.4142, 1.4142]) is strictly LOOSER than its actual rotated
// diamond cross-section (|x|+|z| <= 1.4142). target is an axis-aligned box(1,1,1) at (1.6, 0, 1.6),
// sitting entirely in one of the AABB's corner "pockets" that the diamond does not occupy (target's
// AABB is x/z in [1.1, 2.1], whose minimum |x|+|z| is 2.2, well past the diamond's 1.4142 boundary --
// verified empirically: overlap:false, conclusive:true, diagnostics:[] with default options, and
// stable across repeated runs). AABBs overlap (source's max 1.4142 > target's min 1.1 on both x and
// z), so the precheck still proceeds to volumeOverlapQuery, but the actual solids stay ~0.56 world
// units apart -- a clean, fully-resolved negative, not a boundary-grazing one.
// This fixture used to carry the same frozen-clock workaround as fixture 5 above, for the same
// reason, and it is removed for the same reason: after Phase C the crossing term's verdict cannot
// depend on whether the traversal got scheduled before the real 8 ms budget elapsed, so the
// negative resolves purely on its own geometric merits with the shared `noOptions`.
test('AABBs overlap (loose rotated-box AABB), volumeOverlapQuery proves conclusive no-overlap -> proceed', async () => {
  const source = testInstance(box(2, 2, 2), new THREE.Matrix4().makeRotationY(Math.PI / 4));
  const target = testInstance(box(1, 1, 1), at(1.6, 0, 1.6));
  const result = await classifyHardClashPrecheck(source, target, worldBoundsOf(source), worldBoundsOf(target), noOptions);
  assert.equal(result.status, 'proceed');
});

// Fixture 14: inconclusive precheck must never be treated as proven-no-overlap.
//
// Placeholder resolution (task-7-brief.md's test skeleton left this fixture as a TODO):
// Task 6's OWN conclusive:false tests offer two named candidates
// (test/query/VolumeOverlapQuery.conclusive.test.mjs) -- "crossing-budget-exhausted" (comb(0) vs
// comb(0.05), forced via a tight maxCandidatePairsExamined) and "inconclusive-containment" (20
// disjoint boxes at y=20 vs a box(4,4,4) at the origin). The containment fixture's own AABB does
// NOT overlap the target's AABB (source y in [19,21], target y in [-2,2]), so
// classifyHardClashPrecheck would return `skip-precheck` before volumeOverlapQuery is ever called --
// it cannot exercise the inconclusive branch this test needs. The crossing-budget-exhausted fixture's
// AABBs DO overlap (comb(0) spans x:[0, 5.92], comb(0.05) spans x:[0.05, 5.97], both y:[-2,2],
// z:[-0.01,0.01]), so it reaches volumeOverlapQuery. Reused verbatim (same geometry construction),
// with the same budget override Task 6 used to force the abort deterministically -- passed straight
// through as this call's volumeOverlapOptions (which classifyHardClashPrecheck forwards unchanged),
// rather than the shared `noOptions` used by the other cases here, since only that override makes
// this fixture's conclusive:false outcome deterministic rather than dependent on default-budget timing.
test('fixture 14: conclusive:false volumeOverlapQuery result -> inconclusive, never proceed', async () => {
  const source = testInstance(comb(0));
  const target = testInstance(comb(0.05));
  const result = await classifyHardClashPrecheck(
    source, target, worldBoundsOf(source), worldBoundsOf(target),
    { crossing: { maxCandidatePairsExamined: 500 } },
  );
  assert.equal(result.status, 'inconclusive');
  assert.equal(result.diagnostic.reason, 'clearance-hard-clash-precheck-inconclusive');
});

test('threads a caller-supplied scheduler into volumeOverlapQuery', async () => {
  // Re-expression of a deleted `compareCanonical`-injection assertion (Task A3.2; the option
  // itself was removed from volumeOverlapQuery's public API in Task A2.1, and Task A2.2 removed
  // it from this call site). The `scheduler`-threading half of the original test is untouched --
  // `scheduler` was never part of this plan's fix -- only the compareCanonical half (and its
  // `sawCompareCanonical` tracking variable) is dropped, since there is nothing left to thread.
  let sawScheduler = false;
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(2, 0, 0));
  const scheduler = { elapsedMs: () => 0, checkpointIfDue: async () => { sawScheduler = true; } };
  await classifyHardClashPrecheck(source, target, worldBoundsOf(source), worldBoundsOf(target), {
    scheduler,
  });
  // At least one between-term checkpoint must have run through the supplied scheduler, proving it was
  // actually passed to volumeOverlapQuery rather than a fresh default being constructed internally.
  assert.equal(sawScheduler, true);
});
