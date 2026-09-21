// test/query/VolumeOverlapQuery.knownUnstablePairs.test.mjs
//
// Design basis: design doc §11 regression C (lines 872-877) — the class-B pair
// (structure frag 537 -> structure frag 427, research doc finding F6) pinned at
// single-page-load (in-process) scope. Task A4.3. Test-only: no production code
// changes in this task.
//
// HONEST SCOPE NOTE (codex-advisor finding, required correction): this test drives a
// SYNTHETIC CLASS-B DIAGONAL-RATIO PROXY -- two axis-aligned boxes tuned to reproduce
// the research doc's ~74.26:1 `localDiagonal` ratio (F6/§6.5a: `L_canonical = 290.969`
// / `L_canonical = 3.918`) -- not a reconstruction of the real fragments' actual
// triangle meshes. The real frag 537 -> 427 pair has different geometry, a different
// (negative) disposition (Task A4.2's live reconstruction: kernel-level `crossing:
// false, aborted: false, inconclusive: false`), and its failure mode was specifically
// a page-load-order artifact (the pre-fix `comparePlacedCanonically` geometryIndex
// term) that this single-process synthetic fixture cannot reproduce at all. The
// genuine "exact real pair, across independent page loads" protection is Task D3's
// job (Step 3b, per the brief), not this task's.
//
// Distinct from Task A4.1's regression A ('A.1' in
// VolumeOverlapQuery.reloadStability.test.mjs), which already runs a same-ratio
// fixture (box(290.969,1,1) vs box(3.918,1,1), i.e. raw box WIDTHS matching the
// research doc's figures, not their localDiagonal) through both operand orders --
// but only asserts forward === backward (a relative, tautology-shaped check: it would
// still pass if the shared value flipped to some other disposition, as long as both
// directions kept agreeing with each other).
//
// Regression C's ask (design doc §11) is stronger and different in kind: pin the
// ACTUAL, concrete disposition this diagonal-ratio class resolves to -- not just "the
// two directions agree," but "the two directions agree on THIS value." Pre-fix, the
// real pair took BOTH `inconclusive` values across 14 real sessions (research doc F6)
// purely from which physical operand `orientForCrossing`'s pre-fix predecessor
// happened to orient first -- a load-order artifact, not a geometric one. A concrete
// pin is the only shape of test that would fail if a future change reintroduced that
// KIND of instability by resurrecting a DIFFERENT-but-still-self-consistent
// disposition (e.g. both orders silently agreeing on `overlap: false` instead of
// today's `overlap: true`) -- something a bare forward===backward check cannot detect.

import test from 'node:test';
import assert from 'node:assert/strict';
import { volumeOverlapQuery } from '../../collision/query/VolumeOverlapQuery.js';
import { testInstance, box } from '../fixtures/geometry.mjs';

// Synthetic class-B diagonal-ratio proxy. Research doc F6/§6.5a records
// `L_canonical = 290.969` (frag 537) / `L_canonical = 3.918` (frag 427) as each
// fragment's WORLD-SPACE `localDiagonal` (not a box width) -- Task A4.2 independently
// confirmed these are the real fragments' exact `localDiagonal`s. To reproduce that
// same ~74.26:1 DIAGONAL ratio (not merely the same numeral used as a box width, which
// is what A4.1's A.1 does, and which actually yields a slightly different ~69.85:1
// diagonal ratio once the fixed y=z=1 box extents are folded into the 3D diagonal),
// this fixture solves each box's WIDTH backward from the target diagonal:
// width = sqrt(diagonal^2 - 1^2 - 1^2).
function widthForDiagonal(targetDiagonal) {
  return Math.sqrt(targetDiagonal * targetDiagonal - 2);
}

function classB2PairFixture() {
  const source = testInstance(box(widthForDiagonal(290.969), 1, 1));
  const target = testInstance(box(widthForDiagonal(3.918), 1, 1));
  return { source, target };
}

test('C — a synthetic class-B diagonal-ratio proxy (structure frag 537 -> structure frag 427, F6) resolves to a single, concrete, pinned disposition, both operand orders', async () => {
  const { source, target } = classB2PairFixture();

  // Fixture precondition, verified empirically (not assumed from the raw width
  // inputs): the fixture's actual computed `localDiagonal`s must land within a small
  // tolerance of the research doc's F6 figures, and their ratio must land in the same
  // extreme-ratio class (~74:1), or this fixture would silently drift from what it
  // claims to reproduce.
  assert.ok(Math.abs(source.localDiagonal - 290.969) < 0.01,
    `fixture precondition: source.localDiagonal (${source.localDiagonal}) must be within 0.01 of F6's 290.969`);
  assert.ok(Math.abs(target.localDiagonal - 3.918) < 0.01,
    `fixture precondition: target.localDiagonal (${target.localDiagonal}) must be within 0.01 of F6's 3.918`);
  const ratio = source.localDiagonal / target.localDiagonal;
  assert.ok(ratio > 70 && ratio < 78,
    `fixture precondition: diagonal ratio (${ratio}) must land in F6's extreme-ratio class (~74.26:1)`);

  const forward = await volumeOverlapQuery(source, target);
  const backward = await volumeOverlapQuery(target, source);

  // Pinned, concrete SEMANTIC outcome -- determined empirically (repeated runs,
  // byte-identical every time) rather than guessed. The nested boxes share y/z
  // extents ([-0.5, 0.5]); the smaller box's x-extent sits fully inside the larger
  // box's x-extent. Their broad top/bottom/front/back faces are coplanar and get
  // discarded as zero-volume coplanar contact (ProperCrossingQuery.js's coplanar
  // guard) -- but the SMALLER box's own end-cap faces (perpendicular planes,
  // x = const) are NOT coplanar with the larger box's side walls (y = const / z =
  // const planes): those perpendicular triangle pairs genuinely intersect along the
  // smaller box's boundary edges, and probes around those non-coplanar intersections
  // land inside both solids. That is what resolves this pair via a genuine crossing
  // term, not a containment rescue, both operand orders:
  assert.equal(forward.overlap, true);
  assert.equal(backward.overlap, true);
  assert.equal(forward.conclusive, true);
  assert.equal(backward.conclusive, true);
  assert.equal(forward.via, 'crossing');
  assert.equal(backward.via, 'crossing');
  assert.equal(forward.witness?.kind, 'surface-crossing');
  assert.equal(backward.witness?.kind, 'surface-crossing');

  // Witness point: assert it is real (finite), and that both operand orders land on
  // the SAME point (this fixture resolves through the canonically-oriented crossing
  // term either way) -- but do not pin the current literal coordinates, which are an
  // implementation-coupled traversal detail, not a semantic guarantee.
  assert.ok(Array.isArray(forward.witness?.point) && forward.witness.point.every(Number.isFinite),
    'forward witness point must be a finite [x,y,z]');
  assert.ok(Array.isArray(backward.witness?.point) && backward.witness.point.every(Number.isFinite),
    'backward witness point must be a finite [x,y,z]');
  assert.deepEqual(forward.witness.point, backward.witness.point);

  // Crossing kernel counters: assert they are IDENTICAL between operand orders (the
  // actual design requirement -- design doc §3.2's predicate table) and pass basic
  // sanity floors, rather than pinning today's exact literals (candidatePairsExamined
  // /crossingPairsExamined/pointClassifications are traversal-order-dependent details
  // that could legitimately shift under a BVH library version bump without indicating
  // any regression).
  assert.equal(forward.stats.crossing.exhaustedBudget, null);
  assert.equal(backward.stats.crossing.exhaustedBudget, null);
  assert.deepEqual(
    {
      candidatePairsExamined: forward.stats.crossing.candidatePairsExamined,
      crossingPairsExamined: forward.stats.crossing.crossingPairsExamined,
      pointClassifications: forward.stats.crossing.pointClassifications,
    },
    {
      candidatePairsExamined: backward.stats.crossing.candidatePairsExamined,
      crossingPairsExamined: backward.stats.crossing.crossingPairsExamined,
      pointClassifications: backward.stats.crossing.pointClassifications,
    },
  );
  assert.ok(forward.stats.crossing.crossingPairsExamined > 0);
  assert.ok(forward.stats.crossing.pointClassifications > 0);

  // Relation to Task A4.2 (already landed): A4.2's LIVE reconstruction of the actual
  // real frag 537 -> 427 pair found it now fully conclusive post-fix (`crossing:
  // false, aborted: false, inconclusive: false` at the kernel level, no longer even
  // in the ambiguous-pair population at the wrapper level). This synthetic proxy's
  // own concrete disposition differs in its boolean particulars (`overlap: true` via
  // a genuine perpendicular-face crossing here, vs. a fully-resolved negative for the
  // real geometry there) because a pair of axis-aligned boxes at the same diagonal
  // RATIO is not a byte-for-byte reconstruction of the real fragments' actual
  // triangle meshes -- but both share the property this regression exists to pin: a
  // single, deterministic, operand-order-independent verdict, not a flip. That
  // qualitative agreement (conclusive + order-independent on both the real pair and
  // this synthetic proxy) is what corroborates the fix here; this test does not
  // require the two to share the same concrete boolean disposition.
});
