import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { anyComponentInside } from '../../collision/query/ContainmentQuery.js';
import { WorldDisposedError, ModelEvictedError } from '../../collision/errors.js';
import { box, at, mergeGeometries, openBottomedBox, testInstance } from '../fixtures/geometry.mjs';

function sourceToTarget(source, target) {
  return target.matrix.clone().invert().multiply(source.matrix);
}

function insideOf(source, target, options) {
  return anyComponentInside(
    source.geometry, source.bvh, source.localDiagonal, source.connectivity,
    target.bvh, target.localDiagonal, target.closedManifold,
    sourceToTarget(source, target), options
  );
}

test('two-component geometry, only smaller inside (capped-sampling regression)', async () => {
  const farBox = box(1, 1, 1).translate(50, 0, 0);
  const smallBox = box(0.5, 0.5, 0.5);
  const src = testInstance(mergeGeometries([farBox, smallBox]));
  const target = testInstance(box(4, 4, 4));
  const r = await insideOf(src, target, { mode: 'volume-overlap' });
  assert.equal(r.inside, true, 'only the smaller of two components inside: contained');
});

test('shared single VERTEX join (round 3 regression)', async () => {
  const partA = box(1, 1, 1);                    // corners +/-0.5
  const partB = box(1, 1, 1).translate(1, 1, 1);  // shares corner (0.5,0.5,0.5) with partA
  const src = testInstance(mergeGeometries([partA, partB]));
  const target = testInstance(box(1.4, 1.4, 1.4), at(1, 1, 1)); // surrounds partB, not partA
  const r = await insideOf(src, target, { mode: 'volume-overlap' });
  // ROUND 3 REGRESSION: vertex-based connectivity would wrongly merge these into one component.
  assert.equal(r.inside, true, 'vertex-joined solids, one inside one outside: contained');
});

test('shared-FACE join produces a non-manifold-flagged component', async () => {
  // Two closed boxes glued face-to-face (a shared face is 4 shared edges, each then
  // used by 4 triangles post-weld -- a stronger, simpler-to-construct instance of the
  // same "edge-connectivity still merges" hole a single shared edge demonstrates).
  const partA = box(1, 1, 1);                    // corners +/-0.5
  const partB = box(1, 1, 1).translate(1, 0, 0);  // touches partA exactly at x=0.5
  const src = testInstance(mergeGeometries([partA, partB]));
  const target = testInstance(box(0.2, 0.2, 0.2), at(10, 10, 10)); // disjoint from the merged solid
  const r = await insideOf(src, target, { mode: 'volume-overlap' });
  assert.equal(r.inside, false, 'shared-face-joined solids: negative');
  assert.equal(r.diagnostics.some((d) => d.reason === 'non-manifold-component'), true,
    'edge-connectivity does not separate a shared-edge/-face join; the merged component is flagged');
});

test('deep containment sharing a coplanar face (round 4 regression)', async () => {
  // A solid deep inside target while sharing one coplanar face with it: the shared
  // face's vertices are placed FIRST in index order so a naive "first N" pick would
  // land entirely on that shared (boundary-reading) face forever.
  const target = testInstance(box(4, 4, 4));
  const sharedFaceGeom = box(2, 2, 2).translate(0, 1, 0); // top face coincides with target's top face (y=2)
  const src = testInstance(sharedFaceGeom);
  const r = await insideOf(src, target, { mode: 'volume-overlap' });
  // ROUND 4 REGRESSION: a fixed 4-sample cap missed this when the first picks all land on the shared face.
  assert.equal(r.inside, true, 'deep containment sharing a coplanar face: contained');
});

test('witness stage (component entirely on target surface)', async () => {
  // Two exactly coincident closed boxes: every source-surface vertex sits on target's
  // boundary. volume-overlap mode must fall through to the constructed-interior
  // witness (stage 3) and find the shared volume.
  const target = testInstance(box(2, 2, 2));
  const src = testInstance(box(2, 2, 2));
  const r = await insideOf(src, target, { mode: 'volume-overlap' });
  assert.equal(r.inside, true, 'coincident closed boxes, volume-overlap: witness stage resolves contained');
});

test('witness stage at markedly different local scales (round 5 regression)', async () => {
  // Source authored at a tiny local scale, then scaled up 1000x by its own transform
  // to world-coincide with a normal-scale target. witnessLadder must use L_SOURCE
  // (tiny), not any canonical/target-borrowed scale (which would overshoot the
  // source's own tiny geometry and never find an interior point).
  const target = testInstance(box(2, 2, 2)); // L_target ~ 3.46, "sorts first" canonically
  const tinyGeom = box(0.002, 0.002, 0.002); // L_source ~ 0.00346, "sorts second"
  const src = testInstance(tinyGeom, new THREE.Matrix4().makeScale(1000, 1000, 1000));
  const r = await insideOf(src, target, { mode: 'volume-overlap' });
  // ROUND 5 REGRESSION: witnessLadder must scale by L_source, never a borrowed canonical/target scale.
  assert.equal(r.inside, true, 'witness at markedly different local scales: still resolves');
});

test('witness stage must not be polluted by an unrelated sibling component', async () => {
  // Regression for a Codex spec-review finding on an earlier draft: validating a
  // component's constructed witness against the FULL multi-component sourceBvh (not
  // just that component's own triangles) lets an unrelated sibling component change
  // the parity verdict. Construction: component A is a small box exactly coincident
  // with target (every vertex boundary, forcing stage 3); component B is a large,
  // completely separate box that happens to fully ENCLOSE A's location without
  // touching it (a disjoint, unrelated part of the same source geometry). A's own
  // stage-3 probe sits deep inside B's volume too. Classified against the FULL source
  // (A+B), any escaping ray from that probe crosses BOTH A's and B's boundaries once
  // each -- two crossings, even parity, `outside` -- for every rung, on every attempt,
  // since B's enclosure is enormous relative to the tiny witnessLadder step. Classified
  // against a BVH scoped to A's own triangles only, the same probe correctly reads
  // `inside`.
  const componentA = box(1, 1, 1);           // corners +/-0.5
  const enclosingSiblingB = box(10, 10, 10);  // corners +/-5, fully encloses A, never touches it
  const src = testInstance(mergeGeometries([componentA, enclosingSiblingB]));
  const target = testInstance(box(1, 1, 1));  // exactly coincident with component A only
  const r = await insideOf(src, target, { mode: 'volume-overlap' });
  assert.equal(r.inside, true,
    'small component fully enclosed by an unrelated large sibling: still resolves contained -- ' +
    'a witness validated against the FULL source (including the enclosing sibling) would read outside ' +
    'via nested-shell-style parity cancellation for every rung, on every attempt');
});

test('open triangle inside closed box (round 5/7 mode-split pin)', async () => {
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute(
    [-0.5, 0, 0, 0.5, 0, 0, 0, 0.5, 0], 3));
  tri.setIndex([0, 1, 2]);
  const src = testInstance(tri);
  const target = testInstance(box(4, 4, 4));

  const volOverlap = await insideOf(src, target, { mode: 'volume-overlap' });
  assert.equal(volOverlap.inside, true, 'open triangle inside closed box, volume-overlap: positive');
  assert.equal(volOverlap.diagnostics.some((d) => d.reason === 'unverified-open-component'), true,
    '...carries unverified-open-component');

  const containment = await insideOf(src, target, { mode: 'containment' });
  assert.equal(containment.inside, true, 'open triangle inside closed box, containment: positive');
  // ROUND 5/7: containment never diagnoses open SOURCE components.
  assert.equal(containment.diagnostics.some((d) => d.reason === 'unverified-open-component'), false,
    '...does NOT carry unverified-open-component (mode split)');
});

test('same fixture, roles reversed (round 9 regression)', async () => {
  // Closed box (public SOURCE) containing an open triangle (public TARGET) -- decided
  // via the "B inside A" containment term, so role must read 'target', not 'source'.
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute(
    [-0.5, 0, 0, 0.5, 0, 0, 0, 0.5, 0], 3));
  tri.setIndex([0, 1, 2]);
  const openTargetInst = testInstance(tri);
  const closedSourceInst = testInstance(box(4, 4, 4));
  // Here anyComponentInside samples the OPEN TRIANGLE (playing the public "target"
  // role in this call) for containment inside the closed box (playing "source") --
  // i.e. this call is VolumeOverlapQuery's own "B inside A" term.
  const r = await anyComponentInside(
    openTargetInst.geometry, openTargetInst.bvh, openTargetInst.localDiagonal, openTargetInst.connectivity,
    closedSourceInst.bvh, closedSourceInst.localDiagonal, closedSourceInst.closedManifold,
    sourceToTarget(openTargetInst, closedSourceInst),
    { mode: 'volume-overlap', containerRole: 'source', sampledRole: 'target' }
  );
  assert.equal(r.inside, true, 'reversed roles: positive');
  // ROUND 9 REGRESSION: role must follow which PUBLIC operand supplied the deciding component.
  assert.equal(r.diagnostics.find((d) => d.reason === 'unverified-open-component')?.role, 'target',
    'reversed roles: role reads target, not source');
});

test('nearly-closed open source (bathtub-in-miniature)', async () => {
  const nearlyClosed = openBottomedBox(1);
  const src = testInstance(nearlyClosed);
  const target = testInstance(box(4, 4, 4));

  const volOverlap = await insideOf(src, target, { mode: 'volume-overlap' });
  assert.equal(volOverlap.inside, true, 'nearly-closed open source, volume-overlap: positive');
  assert.equal(volOverlap.diagnostics.some((d) => d.reason === 'unverified-open-component'), true,
    'mirrors the acceptance-model bathtub; proves the rule is mode-scoped, not degeneracy-scoped');

  const containment = await insideOf(src, target, { mode: 'containment' });
  assert.equal(containment.diagnostics.some((d) => d.reason === 'unverified-open-component'), false,
    'nearly-closed open source, containment: no unverified-open-component');
});

test('closed source vs OPEN target (round 6/7 blind spot)', async () => {
  const openTarget = testInstance(openBottomedBox(4));
  const insideBox = testInstance(box(1, 1, 1));
  const outsideBox = testInstance(box(1, 1, 1), at(50, 0, 0));

  const positive = await insideOf(insideBox, openTarget, { mode: 'containment' });
  assert.equal(positive.inside, true, 'closed source vs open target, positive arrangement: contained');
  assert.equal(positive.diagnostics.find((d) => d.reason === 'unverified-parity-operand')?.role, 'target',
    '...carries unverified-parity-operand role target');

  const negative = await insideOf(outsideBox, openTarget, { mode: 'containment' });
  assert.equal(negative.inside, false, 'closed source vs open target, negative arrangement: not contained');
  assert.equal(negative.diagnostics.find((d) => d.reason === 'unverified-parity-operand')?.role, 'target',
    'a rule firing only on negatives repeats the same asymmetry the other direction');
});

test('containment-decided positive with open source', async () => {
  // The proper-crossing role-accuracy half of this fixture (an open source PRODUCING
  // a crossing) is ProperCrossingQuery/VolumeOverlapQuery's job, not this module's --
  // this covers only the containment-decided half: no parity diagnostic (source is
  // sampled, never parity-tested), but unverified-open-component IS present.
  const openSrc = testInstance(openBottomedBox(0.4));
  const closedTarget = testInstance(box(4, 4, 4));
  const r = await insideOf(openSrc, closedTarget, { mode: 'volume-overlap' });
  assert.equal(r.diagnostics.some((d) => d.reason === 'unverified-parity-operand'), false,
    'containment-decided positive, open source: no parity diagnostic');
  assert.equal(r.diagnostics.some((d) => d.reason === 'unverified-open-component'), true,
    '...but unverified-open-component present');
});

test('more than 8 components, sample budgeting coherent', async () => {
  // 12 small disjoint components; only the LAST is inside target. An earlier draft's
  // contradictory "up to 64 total"/"at least 8 per range" wording could starve later
  // components -- this proves every component still gets its own sampling budget.
  const parts = [];
  for (let i = 0; i < 11; i++) parts.push(box(0.1, 0.1, 0.1).translate(i * 2, 50, 0));
  parts.push(box(0.5, 0.5, 0.5)); // the 12th, and only, part actually inside target
  const src = testInstance(mergeGeometries(parts));
  const target = testInstance(box(4, 4, 4));
  const r = await insideOf(src, target, { mode: 'volume-overlap' });
  assert.equal(r.inside, true, '>8 components, last one inside: still found');
});

test('maxContainmentSamples exhaustion -> incomplete-component-coverage', async () => {
  // A single component EXACTLY coincident with target on every face: every vertex is
  // a boundary read (stage 1/2 can never resolve it), and a maxContainmentSamples
  // override smaller than the component's own vertex count forces exhaustion
  // mid-component, deterministically, without depending on the real 512 constant --
  // and, because it's a genuine closed manifold, stage 3 never even gets a chance to
  // run once the tiny budget is spent.
  //
  // ADAPTED from the brief's literal fixture (20 box(2,2,2).translate(0,1,0)-then-
  // z-offset components, claimed "all boundary-reading"): verified empirically that
  // fixture is actually mostly INTERIOR to target(4,4,4) -- only its top face
  // coincides with target's own top face, while its bottom/side vertices sit strictly
  // inside target -- so it resolves `inside` after just 2 samples under a correct
  // implementation, never reaching exhaustion (r.inside=true, r.budgetExhausted=
  // false, confirmed by direct reproduction). A follow-up all-flat-quad-components
  // attempt also failed for a different, instructive reason: an open 2-triangle sheet
  // parity-classifies a probe just off itself as `inside` via a single (odd)
  // crossing, so stage 3 -- which runs for ANY component stage 1/2 leaves unresolved
  // in volume-overlap mode, not only closed ones -- spuriously "finds" a witness for
  // it almost immediately. Replaced with the fixture above, which sidesteps both
  // failure modes. Same assertions as the brief's own scenario, unchanged.
  const src = testInstance(box(4, 4, 4));
  const target = testInstance(box(4, 4, 4));
  const r = await insideOf(src, target, { mode: 'volume-overlap', maxContainmentSamples: 3 });
  assert.equal(r.diagnostics.some((d) => d.reason === 'incomplete-component-coverage'), true,
    'sample budget exhausted: not clean');
  assert.equal(r.budgetExhausted, true, 'budgetExhausted flag set');
  // codex-advisor (medium) review of this task's finished draft suggested pinning the
  // exact outcome, not just the two flags above, to make the "exhausts mid-component,
  // never reaches stage 3" claim self-verifying.
  assert.equal(r.inside, false, 'exhausted before any resolution: not contained');
  assert.equal(r.samplesUsed, 3, 'exactly the override budget was spent, no more');
  assert.equal(r.unresolvedComponentCount, 1, 'the sole component is reported unresolved');
});

test('mid-component time-budget yield-and-resume (mocked scheduler)', async () => {
  // A single component: a 6x6 subdivided plane exactly coincident with target's top
  // face (36 vertices, all read `boundary`) except ONE vertex nudged just inside
  // target -- forcing a long walk before resolving. The mocked scheduler's
  // elapsedMs() trips exactly once, early, then behaves normally (checkpointIfDue
  // resets it).
  const plane = new THREE.PlaneGeometry(4, 4, 5, 5);
  plane.rotateX(-Math.PI / 2); // lie flat
  plane.translate(0, 2, 0);    // coincide with target's top face (target extents +/-2)
  const nudgeIndex = 20;       // an interior vertex, not on the plane's own boundary
  plane.attributes.position.setY(nudgeIndex, 1.99); // just inside target
  const src = testInstance(plane);
  const target = testInstance(box(4, 4, 4));

  // The mock models the handle's own contract: checkpointIfDue() is called on EVERY
  // iteration (cheap when not due) and internally decides whether to actually yield.
  // On its 3rd invocation it performs one real "yield" (here: just increments a
  // separate counter, since there's nothing to actually await in a synchronous test).
  function makeMockScheduler(yieldOnCall, onYield) {
    let calls = 0;
    let yieldCount = 0;
    return {
      scheduler: {
        elapsedMs: () => 0, // unused by this mock's own logic; present for interface completeness
        async checkpointIfDue() {
          calls++;
          if (calls === yieldOnCall) {
            yieldCount++;
            if (onYield) await onYield();
          }
        },
      },
      getYieldCount: () => yieldCount,
    };
  }
  const { scheduler, getYieldCount } = makeMockScheduler(3);

  const r = await insideOf(src, target, { mode: 'volume-overlap', scheduler });
  assert.equal(getYieldCount() >= 1, true, 'mid-component checkpoint fires at least once');
  assert.equal(r.inside, true, 'resolves correctly after yielding');
  assert.equal(r.samplesUsed <= src.geometry.attributes.position.count, true,
    `resumes from next unsampled vertex, no restart-inflated sample count ` +
    `(samplesUsed=${r.samplesUsed}, vertexCount=${src.geometry.attributes.position.count})`);
});

test('yield-then-evict / yield-then-dispose', async () => {
  const plane = new THREE.PlaneGeometry(4, 4, 5, 5);
  plane.rotateX(-Math.PI / 2);
  plane.translate(0, 2, 0);
  plane.attributes.position.setY(20, 1.99);
  const src = testInstance(plane);
  const target = testInstance(box(4, 4, 4));

  function tripOnceScheduler(onYield) {
    let calls = 0;
    return {
      elapsedMs: () => 0,
      async checkpointIfDue() { calls++; if (calls === 3) await onYield(); },
    };
  }

  await assert.rejects(
    () => insideOf(src, target, {
      mode: 'volume-overlap',
      scheduler: tripOnceScheduler(async () => { throw new ModelEvictedError('mock-model'); }),
    }),
    { name: 'ModelEvictedError' },
    'yield-then-evict: rejects ModelEvictedError'
  );

  await assert.rejects(
    () => insideOf(src, target, {
      mode: 'volume-overlap',
      scheduler: tripOnceScheduler(async () => { throw new WorldDisposedError('mock-world-disposed'); }),
    }),
    { name: 'WorldDisposedError' },
    'yield-then-dispose: rejects WorldDisposedError'
  );
});

// --- M1 aspect-ratio disposition guard (Tasks 9 & 12 gate site) ---

test('targetAspectRatioExceeded: short-circuits before any classifyPoint against target', async () => {
  // Otherwise-would-be-inside:true fixture -- proves the gate returns inside:false via
  // the dedicated diagnostic, not merely that some sampling attempt happened to fail.
  const src = testInstance(box(0.5, 0.5, 0.5));
  const target = testInstance(box(4, 4, 4));
  const r = await insideOf(src, target, { mode: 'volume-overlap', targetAspectRatioExceeded: true });
  assert.equal(r.inside, false, 'gated: inside is false regardless of the underlying geometry arrangement');
  assert.equal(r.decidingComponentClosed, null, 'gated: decidingComponentClosed is null');
  assert.equal(r.decidingComponentIndex, null, 'gated: decidingComponentIndex is null');
  assert.equal(r.samplesUsed, 0, 'gated: no samples were taken -- classifyPoint against target never ran');
  assert.equal(r.budgetExhausted, false, 'gated: budget was never touched');
  assert.equal(r.unresolvedComponentCount, src.connectivity.componentCount,
    'gated: every source component reported unresolved');
  assert.equal(
    r.diagnostics.some((d) => d.reason === 'geometry-aspect-ratio-exceeds-tolerance-model' && d.role === 'target'),
    true,
    'gated: carries geometry-aspect-ratio-exceeds-tolerance-model with the container role'
  );
});

test('targetAspectRatioExceeded: false (default) leaves existing behavior unaffected', async () => {
  const src = testInstance(box(0.5, 0.5, 0.5));
  const target = testInstance(box(4, 4, 4));
  const r = await insideOf(src, target, { mode: 'volume-overlap', targetAspectRatioExceeded: false });
  assert.equal(r.inside, true, 'ungated: normal sampling still resolves this fixture as contained');
  assert.equal(
    r.diagnostics.some((d) => d.reason === 'geometry-aspect-ratio-exceeds-tolerance-model'),
    false,
    'ungated: no aspect-ratio diagnostic'
  );

  // Also confirm plain omission (no field at all) behaves identically to explicit false.
  const rOmitted = await insideOf(src, target, { mode: 'volume-overlap' });
  assert.equal(rOmitted.inside, true, 'omitted option: normal sampling still resolves this fixture as contained');
  assert.equal(
    rOmitted.diagnostics.some((d) => d.reason === 'geometry-aspect-ratio-exceeds-tolerance-model'),
    false,
    'omitted option: no aspect-ratio diagnostic'
  );
});
