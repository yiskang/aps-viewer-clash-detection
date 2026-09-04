import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { volumeOverlapQuery } from '../../collision/query/VolumeOverlapQuery.js';
import { box, at, mergeGeometries, testInstance } from '../fixtures/geometry.mjs';

test('baseline: small solid fully inside large solid overlaps', async () => {
  const small = testInstance(box(1, 1, 1));
  const large = testInstance(box(6, 6, 6));
  const contained = await volumeOverlapQuery(small, large);
  assert.equal(contained.overlap, true, 'small solid fully inside large: overlap');
});

test('baseline: clearly separated solids do not overlap', async () => {
  const a = testInstance(box(2, 2, 2));
  const sep = testInstance(box(2, 2, 2), at(10, 0, 0));
  const separated = await volumeOverlapQuery(a, sep);
  assert.equal(separated.overlap, false, 'clearly separated: no overlap');
});

test('flush touching (round 3 headline): no overlap', async () => {
  const a = testInstance(box(2, 2, 2));
  const b = testInstance(box(2, 2, 2), at(0, 2, 0));
  const r = await volumeOverlapQuery(a, b);
  // ROUND 3 REGRESSION: headline behavior change vs. the ThreeBSP.intersect()
  // implementation this milestone replaces (docs/...:2498) -- flush face-to-face
  // touching must NOT be reported as overlapping.
  assert.equal(r.overlap, false, 'flush face-to-face touching: NO overlap');
});

test('L-shaped (non-convex) room: element in concave notch does not overlap', async () => {
  // Two ADJACENT (touching, not interpenetrating) boxes forming an L. Interpenetrating
  // legs would break the even-odd solid model (their overlap region would read as a
  // hollow "XOR", not a union) -- adjacency keeps the combined surface a faithful L.
  const legA = box(4, 1, 1);                          // x:[-2,2] y:[-0.5,0.5] z:[-0.5,0.5]
  const legB = box(1, 3, 1).translate(-1.5, 2, 0);     // x:[-2,-1] y:[0.5,3.5] z:[-0.5,0.5]
  const lShape = testInstance(mergeGeometries([legA, legB]));
  const inNotch = testInstance(box(0.5, 0.5, 0.5), at(1, 2, 0)); // inside the L's bbox, outside the L itself
  const r = await volumeOverlapQuery(inNotch, lShape);
  assert.equal(r.overlap, false,
    'element in concave notch: no overlap -- proves narrow-phase does not shortcut through the bounding box on non-convex solids');
});

test('torus, element centered in hole (round 1 regression): no overlap', async () => {
  const torus = testInstance(new THREE.TorusGeometry(3, 0.6, 12, 32));
  const bead = testInstance(box(0.5, 0.5, 0.5));
  const r = await volumeOverlapQuery(bead, torus);
  // ROUND 1 REGRESSION: a bbox-centre approach reported a false positive here.
  assert.equal(r.overlap, false, 'small solid in torus hole: no overlap');
});

test('off-center embedded element (round 1 regression): overlap', async () => {
  const room = testInstance(box(10, 10, 10));
  const element = testInstance(box(1, 1, 1), at(3, 3, 3));
  const r = await volumeOverlapQuery(element, room);
  // ROUND 1 REGRESSION: a bbox-centre approach false-negatived off-center containment.
  assert.equal(r.overlap, true, 'off-center embedded element: overlap');
});

test('door straddling two rooms overlaps both independently', async () => {
  const roomA = testInstance(box(4, 3, 4));               // x:[-2,2]
  const roomB = testInstance(box(4, 3, 4), at(4, 0, 0));   // x:[2,6]
  const door = testInstance(box(1, 2, 0.2), at(2, 0, 0));  // straddles x=2
  const rA = await volumeOverlapQuery(door, roomA);
  const rB = await volumeOverlapQuery(door, roomB);
  assert.equal(rA.overlap, true, 'door overlaps room A');
  assert.equal(rB.overlap, true, 'door overlaps room B');
});

test('negative with truncated coverage is diagnosed, not clean', async () => {
  // Exercises "never report an unresolved/truncated negative as clean"
  // (docs/...:2462-2463, 2526-2534) via the sample-budget lever, which is
  // deterministic to construct by hand -- unlike a stage-3-exhausts-naturally case,
  // which depends on classifyPoint's exact per-triangle ray-parity behavior on a
  // constructed probe and isn't hand-verifiable without executing it. Task 9's own
  // suite already covers a genuinely stage-3-unresolved single component directly;
  // this test proves VolumeOverlapQuery's OWN diagnostic-merging wiring surfaces
  // whichever sub-call diagnostic fires.
  //
  // DEVIATION FROM BRIEF: the brief's own fixture placed these 20 components flush
  // against target's own boundary (translate(0, 1, i*0.01), i.e. y in [0,2] against a
  // target spanning y in [-2,2]) intending them to be merely "boundary-heavy" and
  // otherwise negative/disjoint. Verified empirically against the real (already-
  // implemented, unmodified) ProperCrossingQuery/anyComponentInside, then confirmed
  // with a codex-advisor consult: that geometry actually has substantial genuine
  // interior volume shared with target (source's y<2 interior IS target's own
  // interior too, since source sits essentially contained in target, flush against
  // one boundary face), so ProperCrossingQuery correctly detects real crossing via a
  // grazing side-wall/top-face candidate pair whose offset probe legitimately lands
  // inside both solids -- overlap:true via crossing, not the intended truncated
  // negative. This is genuine shared positive volume, not a bug in ProperCrossingQuery
  // or ContainmentQuery -- the brief's fixture simply doesn't produce the disjoint/
  // negative scenario it claims to. Replaced with 20 components spread along x, well
  // clear of target and of each other (translate(i*3, 20, 0)): still 20 separate
  // closed connectivity components, but now genuinely non-overlapping with each other
  // AND with target (zero BVH candidate pairs), so the truncated-budget containment
  // path is what actually decides this negative, preserving the scenario's semantic
  // intent without the confound of overlapping source shells.
  const parts = [];
  for (let i = 0; i < 20; i++) parts.push(box(2, 2, 2).translate(i * 3, 20, 0)); // 20 disjoint, non-overlapping components, far from target
  const source = testInstance(mergeGeometries(parts));
  const target = testInstance(box(4, 4, 4));
  assert.equal(source.connectivity.componentCount, 20, 'sanity: 20 genuinely separate components');
  const r = await volumeOverlapQuery(source, target, { containment: { maxContainmentSamples: 10 } });
  assert.equal(r.overlap, false, 'genuinely disjoint geometry: negative result');
  assert.equal(r.stats.crossing.candidatePairsExamined, 0, 'sanity: no crossing candidates at all -- decided purely by containment');
  assert.equal(r.stats.aInB.budgetExhausted, true, 'sample budget was actually exhausted');
  assert.equal(r.stats.aInB.unresolvedComponentCount, 10, 'half the components were left unresolved by the truncated budget');
  assert.equal(r.diagnostics.some((d) => d.reason === 'incomplete-component-coverage'), true,
    'truncated coverage diagnostic is merged into the final result');
  assert.equal(r.diagnostics.some((d) => d.reason === 'inconclusive-containment'), true,
    'VolumeOverlapQuery\'s own negative-branch diagnostic fires for the unresolved components');
});

test('checkpointIfDue is called between composed terms', async () => {
  // Regression for a Codex spec-review finding: an earlier draft had no way for
  // CollisionWorld to checkpoint BETWEEN this function's own composed terms
  // (crossing, then A-in-B, then B-in-A), so three individually-under-budget terms
  // could still sum past frameBudgetMs with no yield point. A negative-result pair
  // (so all three terms run to completion) with a call-counting mock scheduler proves
  // checkpointIfDue() is actually invoked between terms, not just inside
  // anyComponentInside's own sampling loop.
  const a = testInstance(box(2, 2, 2));
  const sep = testInstance(box(2, 2, 2), at(10, 0, 0)); // negative result: forces crossing, A-in-B, AND B-in-A to all run
  let checkpointCalls = 0;
  const spySched = { elapsedMs: () => 0, checkpointIfDue: async () => { checkpointCalls++; } };
  await volumeOverlapQuery(a, sep, { scheduler: spySched });
  assert.equal(checkpointCalls >= 2, true,
    `checkpointIfDue called between composed terms (called ${checkpointCalls} times, expect >= 2: once before A-in-B, once before B-in-A)`);
});

test('compareCanonical decouples canonical order from public roles', async () => {
  // Regression for a Codex spec-review finding: this function's public `source`
  // parameter must stay the diagnostic-role `source` even when compareCanonical says
  // TARGET should be canonically-first for properCrossingQuery's own L scaling.
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  // Force target (beam) to sort canonically-first regardless of argument position.
  const forceTargetFirst = () => 1; // always says target < source
  const r = await volumeOverlapQuery(duct, beam, { compareCanonical: forceTargetFirst });
  assert.equal(r.overlap, true,
    'overlap still detected with target forced canonically-first -- proves properCrossingQuery received correctly-ordered operands even though public source/target did not move');
});

// --- M1 aspect-ratio disposition guard threading (task-11 addition; see
// batch2-reconciliation-notes.md #6 and progress.md's "Ruling: maxLocalAspectRatio/
// aspectRatioExceeded gating (Tasks 9 & 12 only)" entry). VolumeOverlapQuery does not
// gate anything itself -- it only threads each anyComponentInside call's own
// containerRole operand's aspectRatioExceeded field through as
// options.targetAspectRatioExceeded. These tests prove the threading actually
// happens, not merely that anyComponentInside's own gate (already proven by Task 9's
// suite) exists. ---

test('aspect-ratio threading: target.aspectRatioExceeded suppresses the A-in-B containment term', async () => {
  // Same geometric arrangement as the baseline "small inside large" scenario above,
  // which resolves overlap:true via containment(A in B). Setting the TARGET's own
  // aspectRatioExceeded here must gate exactly that term (containerRole: 'target' for
  // the A-in-B call), short-circuiting it to inside:false/samplesUsed:0 per
  // anyComponentInside's own contract, and suppressing the otherwise-true overlap
  // (B-in-A legitimately also reads false here: the large box is not inside the small
  // one, so nothing else can rescue the positive).
  const small = testInstance(box(1, 1, 1));
  const large = testInstance(box(6, 6, 6));
  large.aspectRatioExceeded = true;
  const r = await volumeOverlapQuery(small, large);
  assert.equal(r.overlap, false, 'gated: containment(A in B) suppressed, no other term rescues it');
  assert.equal(r.stats.aInB.samplesUsed, 0, 'gated: A-in-B short-circuited before any sampling');
  assert.equal(
    r.diagnostics.some((d) => d.reason === 'geometry-aspect-ratio-exceeds-tolerance-model' && d.role === 'target'),
    true,
    'gated: diagnostic carries the target container role'
  );
});

test('aspect-ratio threading: source.aspectRatioExceeded suppresses the B-in-A containment term', async () => {
  // Mirror of the above with roles swapped so the B-in-A term is the one that would
  // otherwise decide the result: source is the large container, target is the small
  // solid fully inside it. A-in-B (large inside small) is legitimately false and
  // ungated (target.aspectRatioExceeded is unset). Setting SOURCE's own
  // aspectRatioExceeded gates the B-in-A call (containerRole: 'source' there),
  // suppressing the otherwise-true overlap.
  const container = testInstance(box(6, 6, 6));
  const inner = testInstance(box(1, 1, 1));
  container.aspectRatioExceeded = true;
  const r = await volumeOverlapQuery(container, inner);
  assert.equal(r.overlap, false, 'gated: containment(B in A) suppressed, no other term rescues it');
  assert.equal(r.stats.bInA.samplesUsed, 0, 'gated: B-in-A short-circuited before any sampling');
  assert.equal(
    r.diagnostics.some((d) => d.reason === 'geometry-aspect-ratio-exceeds-tolerance-model' && d.role === 'source'),
    true,
    'gated: diagnostic carries the source container role'
  );
});
