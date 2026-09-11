import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { volumeOverlapQuery, toFiniteWorldArray } from '../../collision/query/VolumeOverlapQuery.js';
import { properCrossingQuery } from '../../collision/query/ProperCrossingQuery.js';
import { orientForCrossing } from '../../collision/query/orientForCrossing.js';
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

test('volumeOverlapQuery rejects if compareCanonical is supplied (async function -- throw surfaces as rejection, not a sync throw)', async () => {
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  await assert.rejects(
    () => volumeOverlapQuery(duct, beam, { compareCanonical: () => -1 }),
    /compareCanonical/
  );
});

test('volumeOverlapQuery orients the larger-world-diagonal operand as canonical first, regardless of public source/target role', async () => {
  const duct = testInstance(box(20, 0.4, 0.4));   // larger
  const beam = testInstance(box(0.4, 0.4, 2));    // smaller
  const forward = await volumeOverlapQuery(duct, beam);
  const backward = await volumeOverlapQuery(beam, duct);
  // Both calls make the same kernel call internally; wrapper-level crossing-term fields must be
  // bit-identical regardless of which operand the caller labeled "source". NOTE: `inconclusiveCauses`
  // exists only on the negative-result shape (VolumeOverlapQuery.js:372) -- these fixtures may take
  // either the positive or negative path depending on whether they actually cross, so default to an
  // empty array rather than assuming the field is present.
  assert.equal(forward.overlap, backward.overlap);
  assert.equal(forward.conclusive, backward.conclusive);
  assert.deepEqual(
    [...(forward.inconclusiveCauses ?? [])].sort(),
    [...(backward.inconclusiveCauses ?? [])].sort()
  );
});

// --- M1 aspect-ratio disposition guard threading (task-11 addition; see
// docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md's
// Tolerances section, "Single-geometry aspect ratio", and progress.md's "Ruling:
// maxLocalAspectRatio/aspectRatioExceeded gating (Tasks 9 & 12 only)" entry).
// VolumeOverlapQuery does not gate anything itself -- it only threads each anyComponentInside call's own
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

// --- Batch-2 reconciliation: crossing-term aspect-ratio gate. ProperCrossingQuery's
// classifyPoint calls treat BOTH of its operands as parity-tested targets -- the
// identical role anyComponentInside's containerRole plays -- so it needs the identical
// M1 aspect-ratio gate. Unlike the containment terms above, ProperCrossingQuery itself
// carries no aspect-ratio parameter (matching SurfaceCrossingWitness's precedent); the
// gate lives entirely in this file, ahead of the properCrossingQuery call. See
// ContainmentQuery.js's updated gate-site comment (three known sites as of this pass:
// Task 9 internal, Task 12 external via ContainmentModeQuery, and this one). ---

test('crossing-term aspect-ratio gate: source.aspectRatioExceeded skips properCrossingQuery entirely', async () => {
  // Perpendicular thin boxes crossing mid-span (ProperCrossingQuery's own "duct
  // through beam" regression fixture): a genuine crossing, and neither solid contains
  // the other, so no containment term can rescue it once the crossing term is gated.
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  duct.aspectRatioExceeded = true;
  // If properCrossingQuery were entered at all, its first clock read would throw --
  // proves the gate short-circuits BEFORE calling it, not merely discards its result.
  const throwingCrossingOptions = { now: () => { throw new Error('properCrossingQuery should not have been called'); } };
  const r = await volumeOverlapQuery(duct, beam, { crossing: throwingCrossingOptions });
  assert.equal(r.overlap, false,
    'gated: crossing term skipped, and neither containment term resolves this genuinely-crossing (not contained) geometry');
  assert.equal(r.stats.crossing.candidatePairsExamined, 0, 'gated: properCrossingQuery never actually ran');
  assert.equal(
    r.diagnostics.some((d) => d.reason === 'geometry-aspect-ratio-exceeds-tolerance-model' && d.role === 'source'),
    true,
    'gated: diagnostic carries the source role'
  );
});

test('crossing-term aspect-ratio gate: target.aspectRatioExceeded skips properCrossingQuery entirely', async () => {
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  beam.aspectRatioExceeded = true;
  const throwingCrossingOptions = { now: () => { throw new Error('properCrossingQuery should not have been called'); } };
  const r = await volumeOverlapQuery(duct, beam, { crossing: throwingCrossingOptions });
  assert.equal(r.overlap, false,
    'gated: crossing term skipped, and neither containment term resolves this genuinely-crossing (not contained) geometry');
  assert.equal(r.stats.crossing.candidatePairsExamined, 0, 'gated: properCrossingQuery never actually ran');
  assert.equal(
    r.diagnostics.some((d) => d.reason === 'geometry-aspect-ratio-exceeds-tolerance-model' && d.role === 'target'),
    true,
    'gated: diagnostic carries the target role'
  );
});

test('crossing-term aspect-ratio gate: both flagged carries exactly two role-tagged diagnostics', async () => {
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  duct.aspectRatioExceeded = true;
  beam.aspectRatioExceeded = true;
  const throwingCrossingOptions = { now: () => { throw new Error('properCrossingQuery should not have been called'); } };
  const r = await volumeOverlapQuery(duct, beam, { crossing: throwingCrossingOptions });
  assert.equal(r.overlap, false, 'gated: crossing term skipped, no containment term rescues it');
  const aspectDiagnostics = r.diagnostics.filter((d) => d.reason === 'geometry-aspect-ratio-exceeds-tolerance-model');
  assert.equal(aspectDiagnostics.length, 2, 'exactly two aspect-ratio diagnostics, one per flagged role');
  assert.equal(aspectDiagnostics.some((d) => d.role === 'source'), true, 'source role present');
  assert.equal(aspectDiagnostics.some((d) => d.role === 'target'), true, 'target role present');
});

test('crossing-term aspect-ratio gate: deferred merge does not taint a sound positive decided by the OTHER, unflagged operand', async () => {
  // source is fully inside target. anyComponentInside's A-in-B call parity-tests
  // TARGET (containerRole) and merely samples SOURCE (sampledRole) -- flagging
  // SOURCE's aspectRatioExceeded therefore does NOT gate this containment term (only
  // the crossing term, and the B-in-A term where source plays containerRole -- moot
  // here since A-in-B already resolves positive). This is the critical
  // deferred-merge-timing regression: the crossing term's skip diagnostic must not
  // leak into a genuinely sound positive resolved entirely by the unflagged operand's
  // valid parity test.
  const small = testInstance(box(1, 1, 1));
  const large = testInstance(box(6, 6, 6));
  small.aspectRatioExceeded = true;
  const r = await volumeOverlapQuery(small, large);
  assert.equal(r.overlap, true, 'sound positive via containment(A in B), decided by the unflagged target operand');
  assert.equal(r.via, 'containment(A in B)');
  assert.equal(
    r.diagnostics.some((d) => d.reason === 'geometry-aspect-ratio-exceeds-tolerance-model'),
    false,
    'deferred crossing-term skip diagnostic must not taint this sound positive'
  );
});

test('crossing-term aspect-ratio gate: mirrored positive -- target flagged, but containment(B in A) succeeds via the unflagged source as parity target', async () => {
  // codex-review finding on this reconciliation pass: the crossing-term gate's own
  // deferred-merge fix wasn't enough on its own -- aInB.diagnostics was ALSO merged
  // eagerly (pre-existing bug, same class), so a target-flagged run could still leak
  // the aspect-ratio diagnostic into a bInA positive via THAT path even after the
  // crossing-term fix. This fixture exercises both at once: source is the large
  // container (unflagged), target is the small solid fully inside it, and TARGET
  // itself is flagged.
  //   - crossing: gated (target.aspectRatioExceeded) -- diagnostics carry role:'target'.
  //   - aInB (source in target, containerRole='target'): ALSO gated by the same flag
  //     (target plays containerRole here) -- diagnostics carry role:'target' again.
  //   - bInA (target in source, containerRole='source', unflagged): ungated, resolves
  //     true legitimately -- source (large box) validly parity-tests target's probe.
  // Neither of the two failed/skipped attempts' target-flagged diagnostics may leak
  // into the sound bInA positive.
  const source = testInstance(box(6, 6, 6));
  const target = testInstance(box(1, 1, 1));
  target.aspectRatioExceeded = true;
  const r = await volumeOverlapQuery(source, target);
  assert.equal(r.overlap, true, 'sound positive via containment(B in A), decided by the unflagged source operand');
  assert.equal(r.via, 'containment(B in A)');
  assert.equal(
    r.diagnostics.some((d) => d.reason === 'geometry-aspect-ratio-exceeds-tolerance-model'),
    false,
    'neither the gated crossing term nor the gated aInB term may taint this sound positive'
  );
});

test('codex-review regression: aInB\'s own incomplete-component-coverage diagnostic must not taint a bInA positive', async () => {
  // Same class of bug as the aspect-ratio leak above, but via a genuinely different
  // diagnostic (incomplete-component-coverage) and with no aspect-ratio flags
  // involved at all -- proves the deferred-merge fix is general, not aspect-ratio-
  // specific. source has 21 components: 20 small filler boxes far from everything
  // (never inside the small target, and numerous enough that a tight sample budget
  // truncates coverage of them), plus one large box at the origin that genuinely
  // encloses target. target is a small box fully inside that large component.
  //   - aInB (source's components sampled against target as container): none of
  //     source's 21 components is smaller than or fits inside the small target, so
  //     this resolves false regardless of budget -- but the tight budget leaves most
  //     components unsampled, so aInB's OWN diagnostics carry
  //     incomplete-component-coverage.
  //   - bInA (target sampled against source's whole BVH as container): target sits
  //     entirely inside source's large origin component, so this resolves true via a
  //     completely valid classifyPoint parity test -- unrelated to aInB's truncation.
  const parts = [];
  for (let i = 0; i < 20; i++) parts.push(box(2, 2, 2).translate(i * 3, 20, 0)); // 20 disjoint filler components, far from target
  parts.push(box(6, 6, 6)); // 21st component: genuinely encloses target at the origin
  const source = testInstance(mergeGeometries(parts));
  const target = testInstance(box(1, 1, 1));
  assert.equal(source.connectivity.componentCount, 21, 'sanity: 21 genuinely separate components');
  const r = await volumeOverlapQuery(source, target, { containment: { maxContainmentSamples: 10 } });
  assert.equal(r.stats.aInB.inside, false, 'sanity: aInB alone does not resolve this (no source component fits inside the small target)');
  assert.equal(r.stats.aInB.budgetExhausted, true, 'sanity: aInB genuinely truncated coverage under this budget');
  assert.equal(r.stats.aInB.diagnostics.some((d) => d.reason === 'incomplete-component-coverage'), true,
    'sanity: aInB\'s own result actually carries the truncated-coverage diagnostic');
  assert.equal(r.overlap, true, 'bInA independently resolves this positive (target genuinely inside source\'s origin component)');
  assert.equal(r.via, 'containment(B in A)');
  assert.equal(r.diagnostics.some((d) => d.reason === 'incomplete-component-coverage'), false,
    'aInB\'s truncated-coverage diagnostic must not taint the bInA positive that actually decided this');
});

test('crossing-term aspect-ratio gate: sanity -- no flags set, crossing term runs normally and decides overlap as before', async () => {
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  const r = await volumeOverlapQuery(duct, beam);
  assert.equal(r.overlap, true, 'unflagged: crossing term runs normally and detects the perpendicular crossing');
  assert.equal(r.via, 'crossing');
  assert.equal(r.stats.crossing.candidatePairsExamined > 0, true, 'crossing term actually ran (not skipped)');
  assert.equal(
    r.diagnostics.some((d) => d.reason === 'geometry-aspect-ratio-exceeds-tolerance-model'),
    false,
    'unflagged: no aspect-ratio diagnostic appears'
  );
});

// --- M2.1 Task 3: world-space witness propagation. `properCrossingQuery` and
// `anyComponentInside` (Tasks 1/2) return a LOCAL-frame `witnessPoint`;
// `volumeOverlapQuery` is the only layer with both a leaf witness and both operands'
// world matrices in scope, so it must transform each leaf witness into world space,
// validate finiteness, and additively return `witness: {kind, point} | null`. ---

test('crossing overlap additively returns a world-space surface-crossing witness', async () => {
  // Both operands share a single known non-identity world matrix -- a minimal but
  // real proof that the returned point is genuinely in WORLD space, not still in
  // either operand's local frame: if the implementation forgot to transform at all
  // (returned a local-frame point verbatim), inverse-transforming it by either
  // operand's matrix would land far outside both solids' local bounding boxes.
  const shift = at(5, 10, -3);
  const duct = testInstance(box(20, 0.4, 0.4), shift);
  const beam = testInstance(box(0.4, 0.4, 20), shift);
  const r = await volumeOverlapQuery(duct, beam, {});
  assert.equal(r.overlap, true);
  assert.equal(r.via, 'crossing');
  assert.ok(r.witness, 'witness must be present on a positive crossing overlap');
  assert.equal(r.witness.kind, 'surface-crossing');
  assert.equal(r.witness.point.length, 3);
  assert.ok(r.witness.point.every(Number.isFinite), 'witness.point must be 3 finite numbers');
  assert.ok(!(r.witness.point instanceof THREE.Vector3), 'witness.point must be a plain array, never a THREE.Vector3');

  // Oracle: transform the point back and confirm it still classifies inside both
  // operands' own local BVHs via the operands' own matrices.
  const worldPoint = new THREE.Vector3(...r.witness.point);
  const inDuctLocal = worldPoint.clone().applyMatrix4(duct.matrix.clone().invert());
  const inBeamLocal = worldPoint.clone().applyMatrix4(beam.matrix.clone().invert());
  const { classifyPoint } = await import('../../collision/query/ContainmentQuery.js');
  assert.equal(classifyPoint(inDuctLocal, duct.bvh, duct.localDiagonal), 'inside');
  assert.equal(classifyPoint(inBeamLocal, beam.bvh, beam.localDiagonal), 'inside');
});

// The two tests below pin down the crossing branch's matrix-selection logic
// (`canonicalFirst === source ? source.matrix : target.matrix`) with DISTINCT
// matrices for the two operands, so a swapped-matrix bug is numerically detectable
// (not merely geometrically plausible by coincidence). `beam`'s matrix is the
// `duct`-fixture's own shift composed with a 180 degree rotation about X: since a
// 180 degree rotation about a principal axis through the origin maps ANY
// origin-centered axis-aligned box back onto itself, this preserves the exact same
// real-world crossing geometry as the simpler shared-matrix fixture above (verified
// empirically: candidatePairsExamined/crossing outcome unaffected), while making
// `duct.matrix` and `beam.matrix` genuinely different 4x4 matrices -- using the
// wrong one shifts the resulting world point by a clearly-measurable ~0.37 units,
// easily outside the assertion tolerance below.
test('crossing witness uses canonicalFirst\'s real matrix, not the other operand\'s (default order: source is canonicalFirst)', async () => {
  const ductMatrix = at(5, 10, -3);
  const beamMatrix = at(5, 10, -3).clone().multiply(new THREE.Matrix4().makeRotationX(Math.PI));
  const duct = testInstance(box(20, 0.4, 0.4), ductMatrix); // source, default canonicalFirst
  const beam = testInstance(box(0.4, 0.4, 20), beamMatrix); // target
  const r = await volumeOverlapQuery(duct, beam, {});
  assert.equal(r.overlap, true);
  assert.equal(r.via, 'crossing');
  assert.ok(r.witness);

  // Independently reproduce the local-frame witness the same way volumeOverlapQuery
  // does internally (source is canonicalFirst here), then transform it by source's
  // (duct's) matrix -- the ONLY correct choice for this ordering.
  const canonicalSecondToFirst = duct.matrix.clone().invert().multiply(beam.matrix);
  const expected = properCrossingQuery(duct.bvh, beam.bvh, canonicalSecondToFirst, duct.localDiagonal, beam.localDiagonal, {});
  assert.equal(expected.crossing, true, 'sanity: direct call reproduces the same crossing verdict');
  const expectedWorld = expected.witnessPoint.clone().applyMatrix4(duct.matrix);

  assert.ok(Math.abs(r.witness.point[0] - expectedWorld.x) < 1e-9);
  assert.ok(Math.abs(r.witness.point[1] - expectedWorld.y) < 1e-9);
  assert.ok(Math.abs(r.witness.point[2] - expectedWorld.z) < 1e-9);
});

test('crossing witness uses canonicalFirst\'s real matrix, not the other operand\'s (forced order: target is canonicalFirst)', async () => {
  const ductMatrix = at(5, 10, -3);
  const beamMatrix = at(5, 10, -3).clone().multiply(new THREE.Matrix4().makeRotationX(Math.PI));
  const duct = testInstance(box(20, 0.4, 0.4), ductMatrix); // source
  const beam = testInstance(box(0.4, 0.4, 20), beamMatrix); // target
  const forceTargetFirst = () => 1; // always says target < source
  const r = await volumeOverlapQuery(duct, beam, { compareCanonical: forceTargetFirst });
  assert.equal(r.overlap, true);
  assert.equal(r.via, 'crossing');
  assert.ok(r.witness);

  // Here target (beam) is canonicalFirst -- the local witness is in BEAM's frame,
  // and beam.matrix (not source/duct.matrix) is the ONLY correct choice.
  const canonicalSecondToFirst = beam.matrix.clone().invert().multiply(duct.matrix);
  const expected = properCrossingQuery(beam.bvh, duct.bvh, canonicalSecondToFirst, beam.localDiagonal, duct.localDiagonal, {});
  assert.equal(expected.crossing, true, 'sanity: direct call reproduces the same crossing verdict');
  const expectedWorld = expected.witnessPoint.clone().applyMatrix4(beam.matrix);

  assert.ok(Math.abs(r.witness.point[0] - expectedWorld.x) < 1e-9);
  assert.ok(Math.abs(r.witness.point[1] - expectedWorld.y) < 1e-9);
  assert.ok(Math.abs(r.witness.point[2] - expectedWorld.z) < 1e-9);
});

test('"A in B" containment overlap returns a witness transformed by the container\'s (target\'s) matrix', async () => {
  // codex-review finding on this task's own draft: the "still classifies inside big"
  // oracle alone does not discriminate a source/target matrix swap here, because
  // `smallMatrix` is `bigMatrix` plus only a small (0.5,0.5,0.5) offset -- using the
  // WRONG (small's) matrix would shift the witness by just that offset, which still
  // lands inside big's large 6-unit box. Fixed by asserting the EXACT expected
  // coordinate, computed from the raw local witness (exposed on `r.stats.aInB.witnessPoint`,
  // Task 2's contract) transformed by the correct (target/big's) matrix -- using
  // small's matrix instead provably gives a different point ([2.5,3.5,4.5] vs the
  // correct [2,3,4]), so this now actually discriminates the swap.
  const bigMatrix = at(1, 2, 3);
  const smallMatrix = at(1, 2, 3).clone().multiply(new THREE.Matrix4().makeTranslation(0.5, 0.5, 0.5));
  const small = testInstance(box(1, 1, 1), smallMatrix);
  const big = testInstance(box(6, 6, 6), bigMatrix);
  const r = await volumeOverlapQuery(small, big, {});
  assert.equal(r.overlap, true);
  assert.equal(r.via, 'containment(A in B)');
  assert.equal(r.witness.kind, 'containment');
  assert.equal(r.witness.point.length, 3);
  assert.ok(r.witness.point.every(Number.isFinite));

  const expectedWorld = r.stats.aInB.witnessPoint.clone().applyMatrix4(big.matrix); // target is the container
  assert.ok(Math.abs(r.witness.point[0] - expectedWorld.x) < 1e-9);
  assert.ok(Math.abs(r.witness.point[1] - expectedWorld.y) < 1e-9);
  assert.ok(Math.abs(r.witness.point[2] - expectedWorld.z) < 1e-9);
});

test('"B in A" containment overlap returns a witness transformed by the container\'s (source\'s) matrix', async () => {
  // Same codex-review-driven fix as the A-in-B test above, mirrored: exact
  // coordinate check against `r.stats.bInA.witnessPoint` transformed by the
  // correct (source/big's) matrix, which a source/target swap would fail.
  const bigMatrix = at(1, 2, 3);
  const smallMatrix = at(1, 2, 3).clone().multiply(new THREE.Matrix4().makeTranslation(0.5, 0.5, 0.5));
  const big = testInstance(box(6, 6, 6), bigMatrix);
  const small = testInstance(box(1, 1, 1), smallMatrix);
  const r = await volumeOverlapQuery(big, small, {}); // source=big, target=small -> forces B-in-A branch
  assert.equal(r.overlap, true);
  assert.equal(r.via, 'containment(B in A)');
  assert.equal(r.witness.kind, 'containment');
  assert.equal(r.witness.point.length, 3);
  assert.ok(r.witness.point.every(Number.isFinite));

  const expectedWorld = r.stats.bInA.witnessPoint.clone().applyMatrix4(big.matrix); // source is the container
  assert.ok(Math.abs(r.witness.point[0] - expectedWorld.x) < 1e-9);
  assert.ok(Math.abs(r.witness.point[1] - expectedWorld.y) < 1e-9);
  assert.ok(Math.abs(r.witness.point[2] - expectedWorld.z) < 1e-9);
});

test('negative overlap result shape is unchanged by witness support', async () => {
  const a = testInstance(box(2, 2, 2));
  const sep = testInstance(box(2, 2, 2), at(10, 0, 0));
  const r = await volumeOverlapQuery(a, sep, {});
  assert.equal(r.overlap, false);
  assert.equal(r.via, undefined);
  // witness is not read on the negative path by any consumer -- assert it's not a
  // truthy object that a careless caller could mistake for a positive witness, but
  // don't over-specify.
  assert.ok(!r.witness, 'a negative overlap result must not carry a truthy witness');
});

test('a non-finite transformed witness degrades to witness:null without affecting the overlap verdict', async () => {
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 10));
  // Reviewer finding (post-commit review of this task's fix-round): this fixture's
  // correctness depends on `duct` (source) winning orientForCrossing's rank-1
  // world-diagonal comparison and becoming `canonicalFirst` -- the witness-transform
  // step below only reads the WINNING operand's matrix (`canonicalFirstIsSource ?
  // source.matrix : target.matrix`). The two boxes are therefore deliberately sized so
  // duct's diagonal (~20.008) is unambiguously, comfortably larger than beam's
  // (~10.016) -- NOT the original `box(0.4, 0.4, 20)` (mathematically the same
  // diagonal as duct's, just dimension-permuted), whose rank-1 outcome depended on a
  // razor-thin ~3.55e-15 floating-point rounding artifact of argument order rather
  // than a deliberate distinguishing difference. That margin is asserted explicitly
  // immediately below, rather than left as an implicit, undocumented precondition.
  const orientation = orientForCrossing(duct, beam);
  assert.equal(orientation.first, duct,
    'precondition: duct must win orientForCrossing and become canonicalFirst -- otherwise the witness-transform step below reads beam.matrix instead, and this fixture proves nothing');
  assert.equal(orientation.rank, 1,
    'precondition: decided by an unambiguous world-diagonal margin (rank 1), not a floating-point tie-break falling through to a later rank');
  // Inject a degenerate matrix on one operand AFTER the verdict-relevant BVH/
  // localDiagonal are built, so the crossing verdict itself is computed from valid
  // local geometry but the world-space transform step receives a matrix that
  // produces non-finite output.
  //
  // DEVIATION FROM BRIEF: the brief's own snippet reassigns `duct.matrix` to a NaN
  // matrix as a plain field BEFORE calling volumeOverlapQuery at all. Verified
  // empirically (against the real, unmodified crossing-detection code this task does
  // not touch) that this does NOT produce the scenario the brief describes: `duct` is
  // `source`, which is `canonicalFirst` by default, and `canonicalFirst.matrix` is
  // read to build `canonicalSecondToFirst` -- the SAME relative transform
  // properCrossingQuery's own bvhcast candidate-pair detection depends on. A NaN
  // entry there poisons the transformed AABB comparisons throughout bvhcast, so
  // candidatePairsExamined comes back 0 and the crossing verdict itself flips to
  // false -- contradicting the brief's own `assert.equal(r.overlap, true, ...)`. This
  // is not a hypothetical: running exactly the brief's literal fixture against this
  // repo's real ProperCrossingQuery/ThreeMeshBvhBackend confirms overlap:false.
  // The reason is structural, not a fixture-tuning problem: `worldMatrix` in the
  // crossing branch (collision/query/VolumeOverlapQuery.js, "canonicalFirstIsSource
  // ? source.matrix : target.matrix") is LITERALLY the same field the crossing kernel
  // already read to compute the crossing verdict -- there is no way to make one read
  // valid and the other non-finite via a plain field, since both reads resolve the
  // exact same value. A getter lets the two reads diverge in time instead: valid on
  // every read up to and including the crossing kernel's own relative-transform read
  // (verdict), non-finite on the LATER, separate world-transform read (this module's
  // witness-transform step) -- exactly the "verdict from valid local geometry,
  // non-finite transform" scenario the brief's comment describes.
  //
  // Task A2.1 fix-round (controller ruling): the ORIGINAL version of this fixture
  // hardcoded "read #1 is valid, everything else is poisoned" -- true only because the
  // pre-A2.1 default `compareCanonical` never read `.matrix` at all, so the crossing
  // kernel's own read WAS read #1. Once volumeOverlapQuery started deciding orientation
  // via `orientForCrossing` (which itself must read `.matrix` at least once, to compare
  // world diagonals, before the crossing kernel ever runs), that hardcoded "1" became
  // wrong for a subtler reason than a simple off-by-one: orientForCrossing's own read
  // count for a given pair is an internal ranking-algorithm detail (it can tie down
  // through multiple ranks, each potentially reading `.matrix` again), not something
  // this test should hardcode either. Instead of a second magic number, this fixture
  // DERIVES the valid-read count empirically: it runs the real `orientForCrossing`
  // against a throwaway probe object (same geometry, a plain non-getter matrix) to
  // count how many times ranking alone reads `.matrix` for this exact pair, then adds
  // exactly one more for the crossing kernel's own relative-transform read. Every read
  // up to that derived boundary returns the valid matrix; every read after it returns
  // the non-finite one. This keeps the fixture correct regardless of how many times
  // orientation ranking happens to read `.matrix` for this specific fixture, so it is
  // no longer tied to an undocumented, hand-counted call count.
  const probeMatrix = new THREE.Matrix4();
  let probeReads = 0;
  const probeDuct = {
    ...duct,
    get matrix() { probeReads += 1; return probeMatrix; },
  };
  orientForCrossing(probeDuct, beam);
  const validReadsBeforeKernelTransform = probeReads + 1; // +1: the crossing kernel's own relative-transform read

  let matrixReads = 0;
  const validMatrix = new THREE.Matrix4();
  const nonFiniteMatrix = new THREE.Matrix4().set(
    NaN, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  );
  Object.defineProperty(duct, 'matrix', {
    configurable: true,
    get() {
      matrixReads += 1;
      return matrixReads <= validReadsBeforeKernelTransform ? validMatrix : nonFiniteMatrix;
    },
  });
  const r = await volumeOverlapQuery(duct, beam, {});
  assert.equal(r.overlap, true, 'the clash verdict must still be reported');
  assert.equal(r.witness, null, 'a non-finite transform must degrade to witness:null, not throw');
});

test('toFiniteWorldArray degrades to null (not a throw) when localPoint is missing', () => {
  // Whole-batch review finding: if a leaf query's witnessPoint is ever absent on a
  // positive verdict (currently unreachable given Tasks 1/2's own guarantees, but that
  // guarantee lives in TWO OTHER files, not here), this function's own local
  // fault-tolerance contract must still hold -- degrade to null, the same as the
  // non-finite-number case, rather than let `_worldPoint.copy(undefined)` throw a
  // TypeError out of volumeOverlapQuery and lose the whole findClashes query.
  const identity = new THREE.Matrix4();
  assert.equal(toFiniteWorldArray(undefined, identity), null,
    'a missing localPoint must degrade to null, not throw');
  assert.equal(toFiniteWorldArray(null, identity), null,
    'a null localPoint must also degrade to null, not throw');
});
