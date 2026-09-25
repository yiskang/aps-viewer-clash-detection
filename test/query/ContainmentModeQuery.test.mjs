import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { containmentModeQuery } from '../../collision/query/ContainmentModeQuery.js';
import { volumeOverlapQuery } from '../../collision/query/VolumeOverlapQuery.js';
import { box, at, comb, testInstance } from '../fixtures/geometry.mjs';

test('duct through beam, no vertex inside either (round 7 regression)', async () => {
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  const r = await containmentModeQuery(duct, beam, { now: () => 0 }); // frozen clock: no host-timing dependence (D-12)
  // ROUND 7 REGRESSION: bare anyComponentInside gave a clean false here -- forces
  // SurfaceCrossingWitness to run.
  assert.equal(r.contained, true, 'duct through beam: contained');
  assert.equal(r.via, 'surface-crossing', 'decided via surface-crossing, not vertex');
});

test('lone large triangle through room, all 3 corners outside (round 7 regression)', async () => {
  const bigTriangle = new THREE.BufferGeometry();
  bigTriangle.setAttribute('position', new THREE.Float32BufferAttribute(
    [-10, 0, 0, 10, 0, 0, 0, 10, 0], 3));
  bigTriangle.setIndex([0, 1, 2]);
  const source = testInstance(bigTriangle);
  const target = testInstance(box(4, 4, 4));
  const r = await containmentModeQuery(source, target, { now: () => 0 }); // frozen clock (D-12)
  // unfixable by raising sample count alone -- no vertex is ever inside.
  assert.equal(r.contained, true, 'lone large triangle through room: contained');
});

test('directionality vs. VolumeOverlapQuery symmetry', async () => {
  const element = testInstance(box(1, 1, 1));
  const room = testInstance(box(8, 8, 8));
  const elementInRoom = await containmentModeQuery(element, room);
  const roomInElement = await containmentModeQuery(room, element);
  assert.equal(elementInRoom.contained, true, 'containment(element, room): true');
  assert.equal(roomInElement.contained, false,
    'containment(room, element): false (directed) -- the rooms surface does not pass through the element');

  const overlapForward = await volumeOverlapQuery(element, room);
  const overlapBackward = await volumeOverlapQuery(room, element);
  assert.equal(overlapForward.overlap, overlapBackward.overlap,
    'volume-overlap(element, room) === volume-overlap(room, element) -- pins containment as directed, volume-overlap as symmetric (docs/...:2544-2546)');
});

test('flush touching -> false (verifies coplanar rejection)', async () => {
  const a = testInstance(box(2, 2, 2));
  const b = testInstance(box(2, 2, 2), at(0, 2, 0));
  const r = await containmentModeQuery(a, b);
  assert.equal(r.contained, false,
    'flush touching: not contained -- verifies SurfaceCrossingWitness rejects coplanar candidate pairs, matching volume-overlap');
});

test('budget exhaustion in the witness sub-call', async () => {
  const source = testInstance(comb(0));
  const target = testInstance(comb(0.05));
  const t0 = performance.now();
  const r = await containmentModeQuery(source, target, { witness: { maxCandidatePairsExamined: 500 } });
  const elapsed = performance.now() - t0;
  assert.equal(r.diagnostics.some((d) => d.reason === 'crossing-budget-exhausted'), true,
    'witness budget exhausted: not a clean negative');
  assert.equal(elapsed < 1000, true, `completes within a wall-clock bound (${elapsed.toFixed(1)}ms)`);
});

test('default scheduler makes frameBudgetMs live for the witness term (final whole-branch review Finding 3)', async () => {
  // SurfaceCrossingWitness has no private clock of its own by design -- it reads only
  // scheduler.elapsedMs(). The OLD default scheduler here always reported elapsedMs:
  // 0, so frameBudgetMs could never trip for a standalone call with no injected
  // scheduler, and the witness term was bounded only by its own count ceilings.
  // Isolates the time trigger from both count ceilings by setting
  // maxCandidatePairsExamined/maxCrossingPairsExamined to Infinity, so the ONLY way
  // this traversal can ever abort is the DEFAULT scheduler's own real elapsedMs() --
  // exactly the mechanism Finding 3 fixes. No scheduler option is passed at all.
  const source = testInstance(comb(0));
  const target = testInstance(comb(0.05));
  const t0 = performance.now();
  const r = await containmentModeQuery(source, target, {
    witness: { maxCandidatePairsExamined: Infinity, maxCrossingPairsExamined: Infinity },
  });
  const elapsed = performance.now() - t0;
  assert.equal(r.stats.witnessTerm.aborted, true,
    'default scheduler time budget is live: witness term aborts on real elapsed time, not left to run unbounded to completion');
  assert.equal(r.stats.witnessTerm.diagnostics.some((d) => d.reason === 'crossing-budget-exhausted'), true,
    'witness term carries crossing-budget-exhausted');
  assert.equal(r.contained, false, 'aborted traversal on this input: not contained');
  assert.ok(elapsed < 1000, `completes within a wall-clock bound well under 1s (${elapsed.toFixed(1)}ms)`);
});

test('two exactly coincident closed boxes (round 9 counterexample)', async () => {
  const a = testInstance(box(2, 2, 2));
  const b = testInstance(box(2, 2, 2)); // identical geometry, identical transform
  const r = await containmentModeQuery(a, b);
  assert.equal(r.contained, false,
    'coincident closed boxes: NOT contained -- every vertex boundary, every tri-tri contact coplanar -- the witness never gets a target line');
  assert.equal(r.diagnostics.some((d) => d.reason === 'inconclusive-containment'), true,
    'carries inconclusive-containment');
});

test('checkpoint between vertex and witness terms', async () => {
  // Regression for the same composition-level gap Task 11 closes: the vertex term
  // and SurfaceCrossingWitness can each individually sit under frameBudgetMs while
  // their sum does not. A negative-result pair (so both terms run) with a
  // call-counting mock scheduler proves checkpointIfDue() is invoked between them.
  const a = testInstance(box(2, 2, 2));
  const sep = testInstance(box(2, 2, 2), at(10, 0, 0));
  let checkpointCalls = 0;
  const spySched = { elapsedMs: () => 0, checkpointIfDue: async () => { checkpointCalls++; } };
  await containmentModeQuery(a, sep, { scheduler: spySched });
  assert.equal(checkpointCalls >= 1, true, `checkpointIfDue called between the vertex and witness terms (called ${checkpointCalls} times)`);
});

// --- Aspect-ratio gating (this session's own ruling; second of the two spec-required
// gate sites, ContainmentModeQuery's target role -- docs/superpowers/specs/2026-08-06-
// collision-library-milestone1-design.md's Tolerances section, "Single-geometry aspect
// ratio", and progress.md's "Ruling: maxLocalAspectRatio/aspectRatioExceeded gating"
// entry). ---

test('aspect-ratio gate: witness term skipped when target.aspectRatioExceeded, overall false', async () => {
  // Duct-through-beam would otherwise resolve contained:true via via:'surface-crossing'
  // (see the first test above) -- exactly the fixture this gate needs to prove the
  // witness term is skipped rather than run.
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  beam.aspectRatioExceeded = true;
  const r = await containmentModeQuery(duct, beam);
  // The vertex term itself self-gates too (Task 9's own anyComponentInside
  // short-circuits on options.targetAspectRatioExceeded before any sampling --
  // progress.md's ruling explicitly calls this "self-gates via point 1") -- confirm
  // it never ran any sampling, not merely that it happened to read false.
  assert.equal(r.stats.vertexTerm.inside, false, 'vertex term self-gated to inside:false');
  assert.equal(r.stats.vertexTerm.samplesUsed, 0, 'vertex term took zero samples (short-circuited before sampling)');
  assert.equal(r.stats.witnessTerm.skipped, true, 'witness term is skipped');
  assert.equal(r.stats.witnessTerm.reason, 'geometry-aspect-ratio-exceeds-tolerance-model',
    'skip reason recorded on stats.witnessTerm');
  assert.equal(
    r.diagnostics.some((d) => d.reason === 'geometry-aspect-ratio-exceeds-tolerance-model' && d.role === 'target'),
    true,
    'diagnostic present with role:target'
  );
  // The vertex term alone doesn't find it (that's the whole point of this fixture) --
  // with the witness term gated off, the overall result must now be false.
  assert.equal(r.contained, false, 'overall result is now false, since the witness fallback never ran');
});

test('aspect-ratio gate: SOURCE flagged does not suppress a genuine vertex-term positive', async () => {
  // codex-advisor correction (this session): the dispatch's original test (b) asked
  // for a fixture where the vertex term alone finds inside:true even with
  // TARGET.aspectRatioExceeded = true -- but anyComponentInside self-gates on that
  // SAME flag (see the test above), so that specific scenario is unreachable by
  // construction, not merely untested. The real, reachable claim this gate must
  // satisfy is scope: an aspect-ratio-exceeded geometry remains usable as the SAMPLED
  // SOURCE (never parity-tested, never classified against) -- it is rejected only
  // when serving as the parity-tested TARGET. Element-in-room with the SOURCE flagged
  // proves exactly that, and also proves the witness term never even runs (the vertex
  // term already resolved it, so ContainmentModeQuery returns before computing
  // witnessTerm at all).
  const element = testInstance(box(1, 1, 1));
  const room = testInstance(box(8, 8, 8));
  element.aspectRatioExceeded = true; // SOURCE flagged, not target -- must NOT gate anything here
  const r = await containmentModeQuery(element, room);
  assert.equal(r.contained, true, 'still contained: true');
  assert.equal(r.via, 'vertex', 'still decided via the vertex term');
  assert.equal(r.stats.vertexTerm.inside, true, 'vertex term genuinely found inside:true, not gated');
  assert.equal('witnessTerm' in r.stats, false, 'witness term never ran -- vertex term already resolved it');
});

// D-12 (clock propagation): the default scheduler's clock is injectable via `options.now`, so a
// caller (or test) that injects a clock never has host wall-clock time reach the witness's
// frameBudgetMs abort. The default (no `now`) is unchanged: real performance.now().
test('injected `now` reaches the witness: frozen clock survives a leaping host clock (D-12)', async () => {
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  const realNow = performance.now;
  let r;
  try {
    let t = 0;
    performance.now = () => (t += 1_000_000);
    r = await containmentModeQuery(duct, beam, { now: () => 0 });
  } finally {
    performance.now = realNow;
  }
  assert.equal(r.contained, true, 'not aborted by host time');
  assert.equal(r.via, 'surface-crossing');
});

test('injected `now` reaches the witness: a leaping injected clock aborts it (D-12)', async () => {
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  let t = 0;
  const r = await containmentModeQuery(duct, beam, { now: () => (t += 1_000_000) });
  assert.equal(r.contained, false, 'budget-exhausted witness is never read as a hit');
  assert.equal(r.diagnostics.some((d) => d.reason === 'crossing-budget-exhausted'), true);
});
