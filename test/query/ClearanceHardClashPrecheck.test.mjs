import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHardClashPrecheck } from '../../collision/query/ClearanceHardClashPrecheck.js';
import { box, at, comb, testInstance, THREE } from '../fixtures/geometry.mjs';

function worldBoundsOf(instance) {
  instance.geometry.computeBoundingBox();
  const box3 = instance.geometry.boundingBox.clone().applyMatrix4(instance.matrix);
  return { min: [box3.min.x, box3.min.y, box3.min.z], max: [box3.max.x, box3.max.y, box3.max.z] };
}

const noOptions = {}; // classifyHardClashPrecheck must default scheduler/compareCanonical itself when
                        // the caller omits them, exactly as volumeOverlapQuery's own defaults do, so a
                        // standalone unit test need not construct a real CollisionWorld checkpoint.

test('AABBs genuinely disjoint -> skip-precheck (volumeOverlapQuery never called)', async () => {
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(20, 0, 0));
  const result = await classifyHardClashPrecheck(source, target, worldBoundsOf(source), worldBoundsOf(target), noOptions);
  assert.equal(result.status, 'skip-precheck');
});

// Fixture 5: positive-volume overlap -> proven overlap -> excluded.
//
// codex-advisor (medium, pre-commit review) finding: with the shared `noOptions`, this fixture's
// crossing term is subject to the REAL 8ms wall-clock frameBudgetMs default -- under full-suite CPU
// contention, a scheduling pause can abort the crossing traversal before it finds the (here, genuine
// and easy-to-find) positive witness, intermittently flipping this test's result. This is systemic,
// pre-existing volumeOverlapQuery/ProperCrossingQuery wall-clock-flakiness (the same class as the
// already-documented "duct through beam" flake and test/CollisionWorld.findClashes.dispatch.test.mjs's
// own documented wall-clock caveat), not a bug in classifyHardClashPrecheck itself -- but there is no
// reason for THIS unit test to depend on real wall-clock timing when it is not testing timing at all.
// Freezing ProperCrossingQuery's own clock seam (`crossing.now`) removes the wall-clock dependency
// while leaving the (generous, non-limiting) default candidate-count budget in force.
test('fixture 5: overlapping boxes -> excluded', async () => {
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(1, 0, 0));
  const result = await classifyHardClashPrecheck(
    source, target, worldBoundsOf(source), worldBoundsOf(target),
    { crossing: { now: () => 0 } },
  );
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
// Same wall-clock-determinism fix as fixture 5 above (codex-advisor finding): freeze
// ProperCrossingQuery's clock seam so this negative resolves on its own geometric merits, not on
// whether the crossing traversal happened to get scheduled before the real 8ms budget elapsed.
test('AABBs overlap (loose rotated-box AABB), volumeOverlapQuery proves conclusive no-overlap -> proceed', async () => {
  const source = testInstance(box(2, 2, 2), new THREE.Matrix4().makeRotationY(Math.PI / 4));
  const target = testInstance(box(1, 1, 1), at(1.6, 0, 1.6));
  const result = await classifyHardClashPrecheck(
    source, target, worldBoundsOf(source), worldBoundsOf(target),
    { crossing: { now: () => 0 } },
  );
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

test('threads a caller-supplied scheduler/compareCanonical into volumeOverlapQuery', async () => {
  let sawScheduler = false;
  let sawCompareCanonical = false;
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(2, 0, 0));
  const scheduler = { elapsedMs: () => 0, checkpointIfDue: async () => { sawScheduler = true; } };
  // codex-advisor (medium, pre-commit review) finding: `compareCanonical: () => -1` alone is
  // indistinguishable from volumeOverlapQuery's own default comparator (also "source always
  // canonical-first") -- this test would still pass even if classifyHardClashPrecheck silently
  // dropped the caller's compareCanonical and let volumeOverlapQuery fall back to its default.
  // Flip a flag from inside the comparator itself so a dropped callback is actually observable.
  const compareCanonical = (a, b) => { sawCompareCanonical = true; return -1; };
  await classifyHardClashPrecheck(source, target, worldBoundsOf(source), worldBoundsOf(target), {
    scheduler, compareCanonical,
  });
  // At least one between-term checkpoint must have run through the supplied scheduler, proving it was
  // actually passed to volumeOverlapQuery rather than a fresh default being constructed internally.
  assert.equal(sawScheduler, true);
  // compareCanonical is called unconditionally near the top of volumeOverlapQuery (before the crossing
  // term even runs) -- proving THIS caller-supplied function, not a fresh default, was invoked.
  assert.equal(sawCompareCanonical, true);
});
