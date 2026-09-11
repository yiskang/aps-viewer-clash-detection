// Phase C's deterministic regression matrix for
// docs/superpowers/specs/2026-09-11-proper-crossing-query-deterministic-budget-fix-design.md
// -- §13 items A (committed synthetic backstop), B, C, D1-D3 and H1-H4, plus (Task C3) the
// kernel/wrapper-level same-call repeat-stability proxy for §13 F.
//
// Why this file exists at all, in one paragraph. §13's opening names the gap that let this defect
// survive 1000+ green tests: every clearance unit suite that exercises the precheck builds its
// world with a FROZEN clock, which is precisely the configuration in which a wall-clock semantic
// abort cannot manifest, and the two that do not freeze it use geometry too small to reach 8 ms.
// So the rule for everything below is: key off COUNTERS, never off the clock -- except section C,
// whose entire purpose is to prove the clock is inert.
//
// DECLARED COVERAGE GAPS, stated here rather than left to be discovered:
//
//  * §13 A's LIVE half (the real failing pair `structure:3547/frag363 -> architecture:3551/frag30`
//    on the federated Audubon fixture, both arms) needs a dev server, APS credentials and remote
//    model availability, so it is not a `node --test` file and is not in this repo's `npm test`
//    path. §13 A itself calls that out and requires exactly what this file's section A provides:
//    a committed deterministic backstop asserting the same semantic invariants on synthetic
//    operands, so the contract is guarded in CI even when the live test is skipped.
//  * §13 B's ARM-ORDER half (`tlas>linear` vs `linear>tlas`, both broad phases) is not reachable
//    from a unit test: the broad-phase choice lives in `CollisionWorld`, and a direct
//    `volumeOverlapQuery` call has no arm at all. Section B covers only the predecessor/warm-up
//    axis, on FIXED source/target operands. It does NOT swap the public source/target arguments,
//    because the default comparator always makes `source` canonical-first and containment always
//    evaluates source-in-target first, so a swap can legitimately change canonical traversal and
//    `containmentSamplesUsed` -- an equality assertion over swapped arguments would be asserting
//    something the library never promised. The arm-order half stays live-gate-only and is NOT
//    claimed complete by this file.
//  * §13 E and F, as literally written (TLAS-only vs. linear-only), are live-gate items by
//    construction (`test/performance/run-gate-m4.mjs`) -- `broadPhase` is exclusively a
//    `CollisionWorld.findClashes` option, so no unit call to `properCrossingQuery`/
//    `volumeOverlapQuery` has an "arm" to hold fixed in the first place. Task C3 (this file's
//    section immediately after A) covers the layer-appropriate PROXY of F's intent at the
//    kernel/wrapper level: the same call repeated N >= 10 times with no varying options and no
//    injected clock must be byte-identical. The arm-specific half of F stays live-gate-only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { properCrossingQuery } from '../../collision/query/ProperCrossingQuery.js';
import { anyComponentInside } from '../../collision/query/ContainmentQuery.js';
import { volumeOverlapQuery } from '../../collision/query/VolumeOverlapQuery.js';
import { classifyHardClashPrecheck } from '../../collision/query/ClearanceHardClashPrecheck.js';
import { box, at, comb, mergeGeometries, testInstance, THREE } from '../fixtures/geometry.mjs';

const REPEATS = 10; // §13's "N >= 10" for every stability assertion below

function relativeMatrix(a, b) {
  return a.matrix.clone().invert().multiply(b.matrix);
}

function crossOf(a, b, options) {
  return properCrossingQuery(a.bvh, b.bvh, relativeMatrix(a, b), a.localDiagonal, b.localDiagonal, options);
}

// Every SEMANTIC field of a crossing result plus all three deterministic counters and the
// exhaustion attribution -- i.e. everything §2.2 classifies as semantic. Deliberately EXCLUDES
// `elapsedMs` and `timeBudgetExceeded`: those are the only two fields §2.1 permits a clock to
// move, and section C asserts separately that they really do move.
function semanticFingerprint(r) {
  return JSON.stringify({
    crossing: r.crossing,
    aborted: r.aborted,
    inconclusive: r.inconclusive,
    diagnostics: r.diagnostics,
    witnessPoint: r.witnessPoint ? [r.witnessPoint.x, r.witnessPoint.y, r.witnessPoint.z] : null,
    candidatePairsExamined: r.stats.candidatePairsExamined,
    crossingPairsExamined: r.stats.crossingPairsExamined,
    pointClassifications: r.stats.pointClassifications,
    exhaustedBudget: r.stats.exhaustedBudget,
  });
}

// Wrapper-level (`volumeOverlapQuery`) full-output fingerprint. Section A's own N-run loop
// below fingerprints only the underlying `crossOf` (kernel) call -- it checks `overlap.conclusive`
// and `overlap.inconclusiveCauses` against fixed constants each iteration, but never collects the
// WRAPPER's own full output into a per-run fingerprint set the way the kernel-level tests do. That
// is a real, narrow gap in Task C3's own scope (properCrossingQuery/volumeOverlapQuery, both), not
// just of the kernel: `overlap`, `via`, `witness`, `containmentSamplesUsed`, and the nested
// containment-term stats (`aInB`/`bInA`) were never asserted stable across N >= 10 identical calls.
// Excludes `elapsedMs`/`timeBudgetExceeded` for the same §13 C reason `semanticFingerprint` does --
// those are the only two fields a clock is permitted to move.
function volumeOverlapFingerprint(r) {
  const term = (t) => (t ? { samplesUsed: t.samplesUsed, unresolvedComponentCount: t.unresolvedComponentCount, budgetExhausted: t.budgetExhausted } : null);
  return JSON.stringify({
    overlap: r.overlap,
    conclusive: r.conclusive,
    via: r.via ?? null,
    diagnostics: r.diagnostics,
    inconclusiveCauses: r.inconclusiveCauses ?? [],
    containmentSamplesUsed: r.containmentSamplesUsed,
    witness: r.witness ?? null,
    candidatePairsExamined: r.stats.crossing.candidatePairsExamined,
    crossingPairsExamined: r.stats.crossing.crossingPairsExamined,
    pointClassifications: r.stats.crossing.pointClassifications,
    exhaustedBudget: r.stats.crossing.exhaustedBudget,
    aInB: term(r.stats.aInB),
    bInA: term(r.stats.bInA),
  });
}

function containmentFingerprint(r) {
  return JSON.stringify({
    inside: r.inside,
    samplesUsed: r.samplesUsed,
    unresolvedComponentCount: r.unresolvedComponentCount,
    budgetExhausted: r.budgetExhausted,
    diagnostics: r.diagnostics,
  });
}

function worldBoundsOf(instance) {
  instance.geometry.computeBoundingBox();
  const b = instance.geometry.boundingBox.clone().applyMatrix4(instance.matrix);
  return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
}

const denseBox = (size, segments) => new THREE.BoxGeometry(size, size, size, segments, segments, segments);

// A sphere welds to exactly `widthSegments * heightSegments * 2 - 2 * widthSegments` triangles;
// 80 x 76 gives 12,000 -- the shipped `maxSyncTriangleCount` geometry ceiling enforced at
// collision/geometry/createGeometryRegistry.js (§11.5, and the fixture §13 H4 names).
const CEILING_SPHERE = () => new THREE.SphereGeometry(1.5, 80, 76);

// ---------------------------------------------------------------------------
// §13 A -- the committed synthetic backstop for the live failing-pair test
// ---------------------------------------------------------------------------

test('A (backstop): a synthetic operand pair reaching a real pointClassifications count is precheck-EXCLUDED, conclusively, with no inconclusive cause', async () => {
  // The live §13 A test asserts, for the real pair the defect was discovered on: precheck
  // `conclusive === true`, disposition `excluded`, `inconclusiveCauses === []`, stable over
  // N >= 10 runs. It needs a dev server and APS credentials, so it will be skipped exactly when
  // it would have caught a regression. This is its committed stand-in: the same four invariants,
  // on synthetic operands, in the ordinary `node --test` suite, with no clock injected anywhere.
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(1, 0, 0));
  const sourceBounds = worldBoundsOf(source);
  const targetBounds = worldBoundsOf(target);

  // The traversal must do REAL probe work, or the backstop would pass on a pair that never
  // reaches the code path under test.
  const probe = crossOf(source, target);
  assert.equal(probe.crossing, true, 'sanity: the operands genuinely cross');
  assert.equal(probe.stats.pointClassifications, 26,
    'the chosen pointClassifications count -- pinned, because the whole point is that it is reproducible');
  assert.equal(probe.stats.exhaustedBudget, null, 'and it concludes without exhausting any budget');

  const fingerprints = new Set();
  for (let i = 0; i < REPEATS; i++) {
    const precheck = await classifyHardClashPrecheck(source, target, sourceBounds, targetBounds, {});
    const overlap = await volumeOverlapQuery(source, target);
    assert.equal(precheck.status, 'excluded', `run ${i}: disposition must be excluded`);
    assert.equal(overlap.conclusive, true, `run ${i}: conclusive`);
    // `inconclusiveCauses` is present only on a NEGATIVE volumeOverlapQuery result -- a positive
    // omits the field entirely rather than carrying an empty array. `?? []` normalizes that; the
    // assertion is still §13 A's "no inconclusive cause".
    assert.deepEqual(overlap.inconclusiveCauses ?? [], [], `run ${i}: no inconclusive cause`);
    fingerprints.add(semanticFingerprint(crossOf(source, target)));
  }
  assert.equal(fingerprints.size, 1,
    `stability across ${REPEATS} runs is the PRIMARY contract; the literal values are secondary (§13 A, §10)`);
});

// ---------------------------------------------------------------------------
// Task C3 -- wrapper-level (volumeOverlapQuery) same-call repeat stability.
//
// "Arm" (TLAS vs. linear broad phase) is exclusively a `CollisionWorld.findClashes` concept
// (`collision/CollisionWorld.js`'s `query.broadPhase` option) -- neither `properCrossingQuery` nor
// `volumeOverlapQuery` accepts an arm parameter at all, confirmed by inspection of both files. §13
// F's literal "N >= 10 under TLAS-only, N >= 10 under linear-only" therefore cannot be expressed at
// this layer, exactly as this file's own header already says of §13 E/F: they are live-gate items
// by construction. The valid proxy at the kernel/wrapper level is what the tests above and below
// already do -- repeat the SAME call N >= 10 times with no varying options and no injected clock,
// and assert the full output projection (minus the two clock-permitted telemetry fields) is
// identical every time. Section A above already establishes this for the KERNEL (`crossOf` /
// `properCrossingQuery`). This section closes the matching gap for the WRAPPER
// (`volumeOverlapQuery`) itself, which section A's loop never fingerprinted in full.
// ---------------------------------------------------------------------------

const VOQ_CASES = [
  {
    id: 'VOQ-positive',
    what: 'a genuine crossing overlap resolves via the crossing term',
    operands: () => [testInstance(box(2, 2, 2), at(0, 0, 0)), testInstance(box(2, 2, 2), at(1, 0, 0))],
    expectOverlap: true,
  },
  {
    id: 'VOQ-negative',
    what: 'two disjoint boxes resolve to a negative result with stable causes',
    operands: () => [testInstance(box(1, 1, 1)), testInstance(box(1, 1, 1), at(10, 10, 10))],
    expectOverlap: false,
  },
];

for (const c of VOQ_CASES) {
  test(`Task C3 (${c.id}): ${c.what} -- volumeOverlapQuery's own full output is byte-stable over ${REPEATS} identical calls, no clock injected`, async () => {
    const [source, target] = c.operands();

    const probe = await volumeOverlapQuery(source, target);
    assert.equal(probe.overlap, c.expectOverlap, `${c.id}: sanity -- the fixture resolves the way this case names`);

    const fingerprints = new Set();
    for (let i = 0; i < REPEATS; i++) {
      const r = await volumeOverlapQuery(source, target);
      fingerprints.add(volumeOverlapFingerprint(r));
    }
    assert.equal(fingerprints.size, 1,
      `${c.id}: all ${REPEATS} volumeOverlapQuery calls on identical operands must be byte-identical in overlap/conclusive/via/witness/diagnostics/containmentSamplesUsed and all deterministic counters (Task C3)`);
  });
}

// ---------------------------------------------------------------------------
// §13 B -- predecessor / warm-up independence (see the header for the declared gap)
// ---------------------------------------------------------------------------

test('B: the verdict and all three counters are independent of what the process did immediately before', () => {
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(1, 0, 0));

  // Four materially different predecessors, chosen to leave the module-level scratch objects,
  // the JIT and the BVH caches in four different states: nothing at all; a completed positive; a
  // 14,184-candidate scan with zero confirmed pairs; and a traversal that ABORTED on a
  // deterministic budget (the state most likely to leak, since it exits through the abort
  // protocol rather than the normal-completion path).
  const warmUps = {
    none: () => {},
    positive: () => { crossOf(testInstance(box(20, 0.4, 0.4)), testInstance(box(0.4, 0.4, 20))); },
    heavyScan: () => { crossOf(testInstance(comb(0)), testInstance(comb(0.05))); },
    aborted: () => {
      const r = crossOf(testInstance(comb(0)), testInstance(comb(0.05)), { maxCandidatePairsExamined: 500 });
      assert.equal(r.stats.exhaustedBudget, 'candidate-pairs', 'sanity: the warm-up really did abort');
    },
  };

  const seen = new Map();
  for (const [label, warmUp] of Object.entries(warmUps)) {
    warmUp();
    seen.set(label, semanticFingerprint(crossOf(source, target)));
  }
  assert.equal(new Set(seen.values()).size, 1,
    `identical operands must give an identical semantic result regardless of predecessor; got ${JSON.stringify([...seen])}`);
});

test('B: the composed volumeOverlapQuery predicate is likewise predecessor-independent, counters included', async () => {
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(1, 0, 0));
  const project = (r) => JSON.stringify({
    overlap: r.overlap,
    conclusive: r.conclusive,
    via: r.via,
    diagnostics: r.diagnostics,
    inconclusiveCauses: r.inconclusiveCauses ?? [],
    containmentSamplesUsed: r.containmentSamplesUsed,
    candidatePairsExamined: r.stats.crossing.candidatePairsExamined,
    crossingPairsExamined: r.stats.crossing.crossingPairsExamined,
    pointClassifications: r.stats.crossing.pointClassifications,
    exhaustedBudget: r.stats.crossing.exhaustedBudget,
  });

  const cold = project(await volumeOverlapQuery(source, target));
  // Interpose unrelated work of every shape the library can produce, then re-ask.
  crossOf(testInstance(comb(0)), testInstance(comb(0.05)), { maxCandidatePairsExamined: 500 });
  await volumeOverlapQuery(testInstance(box(1, 1, 1)), testInstance(box(8, 8, 8)));
  crossOf(testInstance(box(2, 2, 2)), testInstance(box(2, 2, 2), at(0, 2, 0)));
  const warm = project(await volumeOverlapQuery(source, target));

  assert.equal(warm, cold, 'disposition, conclusive, causes, containmentSamplesUsed and all three crossing counters must all match');
});

// ---------------------------------------------------------------------------
// §13 C -- wall-clock independence, the headline regression
// ---------------------------------------------------------------------------

// §13 C's four named clocks, each a factory so every call gets a fresh one.
const CLOCKS = {
  frozen: () => () => 0,
  real: () => () => performance.now(),
  firstReadHuge: () => { let n = 0; return () => { n++; return n === 1 ? 1e9 : 0; }; },
  advancingTenSeconds: () => { let t = 0; return () => { t += 10_000; return t; }; },
};

test('C: four wildly different injected clocks produce a bit-identical geometric result and identical counters', () => {
  // The pair must genuinely reach the probe ladder, or the test proves only that a clock cannot
  // change a traversal that does no work.
  const a = testInstance(box(3, 3, 3));
  const b = testInstance(box(3, 3, 3), at(0.1, 0.1, 0.1));
  assert.ok(crossOf(a, b).stats.pointClassifications > 0, 'sanity: this pair reaches the probe ladder');

  const results = {};
  for (const [label, makeClock] of Object.entries(CLOCKS)) {
    results[label] = crossOf(a, b, { now: makeClock() });
  }

  const fingerprints = new Map(Object.entries(results).map(([k, r]) => [k, semanticFingerprint(r)]));
  assert.equal(new Set(fingerprints.values()).size, 1,
    `crossing/aborted/inconclusive/diagnostics/witnessPoint and all three counters must be identical under all four clocks; got ${JSON.stringify([...fingerprints])}`);
  // Pin the positive explicitly: a fix that made every clock return a uniformly WRONG answer
  // would also satisfy an equality-only assertion.
  assert.equal(results.frozen.crossing, true, 'and the identical answer is the geometrically correct one');
  assert.equal(results.frozen.aborted, false);
});

test('C: only elapsedMs/timeBudgetExceeded may differ between clocks -- and they must actually differ, proving the telemetry is live and not dead', () => {
  const a = testInstance(box(3, 3, 3));
  const b = testInstance(box(3, 3, 3), at(0.1, 0.1, 0.1));

  const frozen = crossOf(a, b, { now: CLOCKS.frozen() });
  const advancing = crossOf(a, b, { now: CLOCKS.advancingTenSeconds() });
  const huge = crossOf(a, b, { now: CLOCKS.firstReadHuge() });
  const real = crossOf(a, b, { now: CLOCKS.real() });

  assert.equal(frozen.stats.elapsedMs, 0, 'a frozen clock measures a zero span -- a real measurement, not a missing one');
  assert.equal(frozen.stats.timeBudgetExceeded, false);

  assert.equal(advancing.stats.elapsedMs, 10_000, 'entry read 10s, exit read 20s (exactly two reads remain)');
  assert.equal(advancing.stats.timeBudgetExceeded, true);

  assert.notEqual(frozen.stats.elapsedMs, advancing.stats.elapsedMs,
    'the telemetry MUST move with the clock -- otherwise this whole section would also pass against a field that was simply never written');
  assert.notEqual(frozen.stats.timeBudgetExceeded, advancing.stats.timeBudgetExceeded);

  // A clock that jumps 1e9 on its first read and then returns 0 moves BACKWARD across the
  // traversal. §9.1a item 2: that is not a measurement, so it degrades visibly to null.
  assert.equal(huge.stats.elapsedMs, null, 'a backward span is not a measurement (§9.1a)');
  assert.equal(huge.stats.timeBudgetExceeded, false, 'never true on the strength of an unvalidated value');

  assert.equal(typeof real.stats.elapsedMs, 'number');
  assert.ok(real.stats.elapsedMs >= 0);
});

test('C (containment pin, §8): anyComponentInside is identical under the same four clocks, and the advancing clock really did drive its checkpoints', async () => {
  // §8 verified in source that containment never derives a verdict from a clock: it touches the
  // scheduler ONLY through `await scheduler.checkpointIfDue()`. That audit is a one-time reading;
  // this test is what defends it against drift, which is exactly why §8 says "pin it anyway".
  //
  // The clocks are injected through the scheduler rather than by monkey-patching global
  // `performance.now`, because the scheduler IS containment's only clock seam -- there is no
  // `options.now` to override, and patching the global would test the harness, not the library.
  // The source is deliberately TWO components: a 192-triangle dense box parked far outside the
  // target, then a plain box at the origin, well inside it. `anyComponentInside` checkpoints
  // before EVERY individual classifyPoint (ContainmentQuery.js's round-11 fix), and it stops at
  // the first vertex that classifies `inside` -- so a single wholly-contained source would
  // checkpoint exactly once and the yield assertions at the bottom would be vacuous. This fixture
  // walks the whole outside component first, producing ~100 checkpoints, and still resolves to a
  // genuine positive on the second.
  const source = testInstance(mergeGeometries([
    denseBox(1, 4).translate(20, 0, 0),
    new THREE.BoxGeometry(1, 1, 1),
  ]));
  const target = testInstance(box(8, 8, 8));
  const sourceToTarget = target.matrix.clone().invert().multiply(source.matrix);
  assert.ok(source.connectivity.componentCount >= 2, 'sanity: the source really is multi-component');

  const observations = {};
  for (const [label, makeClock] of Object.entries(CLOCKS)) {
    const clock = makeClock();
    let clockReads = 0;
    let yields = 0;
    let lastYieldAt = null;
    // A faithful miniature of createComposedStageScheduler: measure since the last real yield,
    // yield when the frame budget has elapsed, reset the baseline on yielding.
    const scheduler = {
      elapsedMs: () => { clockReads++; const t = clock(); return lastYieldAt === null ? 0 : t - lastYieldAt; },
      checkpointIfDue: async () => {
        clockReads++;
        const t = clock();
        if (lastYieldAt === null) { lastYieldAt = t; return; }
        if (t - lastYieldAt >= 8) { yields++; lastYieldAt = t; await Promise.resolve(); }
      },
    };
    const r = await anyComponentInside(
      source.geometry, source.bvh, source.localDiagonal, source.connectivity,
      target.bvh, target.localDiagonal, target.closedManifold,
      sourceToTarget,
      { mode: 'volume-overlap', containerRole: 'target', sampledRole: 'source', scheduler },
    );
    observations[label] = { fingerprint: containmentFingerprint(r), clockReads, yields };
  }

  const fingerprints = new Map(Object.entries(observations).map(([k, o]) => [k, o.fingerprint]));
  assert.equal(new Set(fingerprints.values()).size, 1,
    `inside/samplesUsed/unresolvedComponentCount/budgetExhausted/diagnostics must be identical under all four clocks; got ${JSON.stringify([...fingerprints])}`);
  assert.equal(JSON.parse(observations.frozen.fingerprint).inside, true, 'and the identical answer is the correct one');

  // Prove the clocks were not simply ignored: every scheduler was consulted, and the
  // 10-s-per-read clock forced real yields that the frozen clock never triggered. Without this,
  // the equality above could pass on a scheduler nobody ever called.
  for (const [label, o] of Object.entries(observations)) {
    assert.ok(o.clockReads > 0, `${label}: the scheduler must actually have been consulted`);
  }
  assert.equal(observations.frozen.yields, 0, 'a frozen clock never makes a checkpoint due');
  assert.ok(observations.advancingTenSeconds.yields > 0,
    'a 10s-per-read clock makes every checkpoint due -- so real yields happened, and still changed nothing semantic');
});

// ---------------------------------------------------------------------------
// §13 D -- deterministic budget exhaustion, one sub-case per cap, NO clock injected
// ---------------------------------------------------------------------------

// Each sub-case lowers its cap through the existing `options` seam rather than constructing
// enormous geometry (§13 D's own instruction), and none injects a clock -- the absence of a clock
// is the property being demonstrated.
const D_CASES = [
  {
    id: 'D1',
    what: 'maxCandidatePairsExamined',
    operands: () => [testInstance(comb(0)), testInstance(comb(0.05))],
    options: { maxCandidatePairsExamined: 500 },
    expect: 'candidate-pairs',
    counter: (s) => s.candidatePairsExamined,
    expectedCounter: 501, // increment-then-strict-`>`: the counter reads budget + 1 when it trips
  },
  {
    id: 'D2',
    what: 'maxCrossingPairsExamined',
    // A deep, dense box overlap whose every probe fails (offset below minPenetrationDepth), so
    // many confirmed pairs enter the ladder and none short-circuits it.
    operands: () => [testInstance(denseBox(1, 8)), testInstance(denseBox(1, 8), at(1 - 1e-8, 0, 0))],
    options: { maxCrossingPairsExamined: 2 },
    expect: 'crossing-pairs',
    counter: (s) => s.crossingPairsExamined,
    expectedCounter: 3, // budget + 1, same protocol
  },
  {
    id: 'D3',
    what: 'maxCrossingPointClassifications',
    operands: () => [testInstance(box(3, 3, 3)), testInstance(box(3, 3, 3), at(0.1, 0.1, 0.1))],
    options: { maxCrossingPointClassifications: 5 },
    expect: 'point-classifications',
    counter: (s) => s.pointClassifications,
    expectedCounter: 5, // checked BEFORE the call, so this cap is REACHED, never exceeded
  },
];

for (const c of D_CASES) {
  test(`${c.id}: lowering ${c.what} aborts deterministically, attributes itself, and is byte-stable over ${REPEATS} runs (no clock injected)`, () => {
    const [a, b] = c.operands();
    const fingerprints = new Set();
    for (let i = 0; i < REPEATS; i++) {
      const r = crossOf(a, b, c.options);
      assert.equal(r.aborted, true, `${c.id} run ${i}: aborted`);
      assert.equal(r.crossing, false, `${c.id} run ${i}: an aborted traversal never reports a crossing`);
      assert.equal(r.inconclusive, false, `${c.id} run ${i}: aborted masks inconclusive`);
      assert.equal(r.stats.exhaustedBudget, c.expect, `${c.id} run ${i}: attribution`);
      assert.equal(c.counter(r.stats), c.expectedCounter, `${c.id} run ${i}: the counter stops at its documented maximum`);
      assert.deepEqual(r.diagnostics, [{ reason: 'crossing-budget-exhausted' }], `${c.id} run ${i}: diagnostics`);
      fingerprints.add(semanticFingerprint(r));
    }
    assert.equal(fingerprints.size, 1,
      `${c.id}: all ${REPEATS} runs must be byte-identical -- same counter value, same attribution, same diagnostics (§13 D)`);
  });
}

test('D: the three caps are attributed to exactly the one that fired first, never conflated', () => {
  // `exhaustedBudget` is a single scalar, not a set (§4.2). With ALL THREE caps lowered at once
  // on the same fixture, the traversal must still name exactly one -- the one the traversal
  // structurally reaches first, which for the comb fixture is the candidate scan, since it
  // confirms no intersecting pair at all.
  const a = testInstance(comb(0));
  const b = testInstance(comb(0.05));
  const r = crossOf(a, b, {
    maxCandidatePairsExamined: 500,
    maxCrossingPairsExamined: 1,
    maxCrossingPointClassifications: 1,
  });
  assert.equal(r.stats.exhaustedBudget, 'candidate-pairs');
  assert.equal(r.stats.crossingPairsExamined, 0, 'the later caps were never even approached');
  assert.equal(r.stats.pointClassifications, 0);
});

// ---------------------------------------------------------------------------
// §13 H -- pathological geometry: bounded completion and stable counters
// ---------------------------------------------------------------------------

// §13 H: "record the wall-clock span as reported output (not as a pass/fail assertion -- a timing
// assertion in a unit test would reintroduce exactly the machine-dependence being removed)".
// Every H case below therefore reports its span through t.diagnostic() and asserts nothing
// whatsoever about it.
const H_CASES = [
  {
    id: 'H1a',
    what: 'interleaved combs, 60 teeth -- heavy BVH-leaf overlap, zero real intersections',
    operands: () => [testInstance(comb(0, 60)), testInstance(comb(0.05, 60))],
    expect: null,
    expectCrossing: false,
  },
  {
    id: 'H1b',
    what: 'interleaved combs, 600 teeth -- SATURATES the shipped 50,000 candidate cap',
    // The fixture Phase B's calibration measured at 50,001 candidates / `candidate-pairs`
    // (docs/research/proper-crossing-query-deterministic-budget-calibration.md §"H1-combs-600"),
    // reused deliberately so this test and that evidence describe the same traversal.
    operands: () => [testInstance(comb(0, 600)), testInstance(comb(0.05, 600))],
    expect: 'candidate-pairs',
    expectCrossing: false,
  },
  {
    id: 'H2',
    what: 'two coincident dense meshes at a sub-minPenetrationDepth offset -- maximizes confirmed pairs whose every probe fails',
    operands: () => [testInstance(denseBox(1, 8)), testInstance(denseBox(1, 8), at(1 - 1e-8, 0, 0))],
    expect: 'crossing-pairs',
    expectCrossing: false,
  },
  {
    id: 'H3',
    what: 'two dense boxes in deep overlap -- maximizes probe work per confirmed pair',
    operands: () => [testInstance(denseBox(3, 16)), testInstance(denseBox(3, 16), at(0.1, 0.1, 0.1))],
    expect: null,
    expectCrossing: true,
  },
  {
    id: 'H4',
    what: 'two operands AT the maxSyncTriangleCount = 12,000 geometry ceiling, in deep overlap -- the shipped worst case',
    operands: () => [testInstance(CEILING_SPHERE()), testInstance(CEILING_SPHERE(), at(0.1, 0.1, 0.1))],
    expect: null,
    expectCrossing: true,
    assertCeiling: true,
  },
];

for (const c of H_CASES) {
  test(`${c.id}: ${c.what} -- completes boundedly with stable counters over ${REPEATS} runs, no clock injected`, (t) => {
    const [a, b] = c.operands();
    if (c.assertCeiling) {
      assert.equal(a.geometry.index.count / 3, 12_000,
        'the fixture must actually sit AT the shipped 12,000-triangle sync ceiling, not near it');
      assert.equal(b.geometry.index.count / 3, 12_000);
    }

    const fingerprints = new Set();
    const spans = [];
    for (let i = 0; i < REPEATS; i++) {
      const started = performance.now();
      const r = crossOf(a, b);
      spans.push(performance.now() - started);
      assert.equal(r.crossing, c.expectCrossing, `${c.id} run ${i}: verdict`);
      assert.equal(r.stats.exhaustedBudget, c.expect, `${c.id} run ${i}: exhaustion attribution`);
      assert.equal(r.aborted, c.expect !== null, `${c.id} run ${i}: aborted <=> a cap fired`);
      fingerprints.add(semanticFingerprint(r));
    }
    assert.equal(fingerprints.size, 1,
      `${c.id}: pathological input must not make the result wobble; all ${REPEATS} runs must be byte-identical`);

    // Reported output only. Never asserted -- see the comment above H_CASES.
    const sorted = [...spans].sort((x, y) => x - y);
    t.diagnostic(`${c.id} span ms: min ${sorted[0].toFixed(2)} / median ${sorted[Math.floor(sorted.length / 2)].toFixed(2)} / max ${sorted[sorted.length - 1].toFixed(2)} (reported, never asserted)`);
  });
}

test('H: even at the 12,000-triangle ceiling the three counters stay inside their shipped caps', () => {
  // The point of §3.1's termination proof, checked on the worst geometry the library accepts
  // synchronously: the traversal is finite because of the caps, not because of the clock.
  const a = testInstance(CEILING_SPHERE());
  const b = testInstance(CEILING_SPHERE(), at(0.1, 0.1, 0.1));
  const r = crossOf(a, b);
  assert.ok(r.stats.candidatePairsExamined <= 50_001, 'candidate scan stays within its cap (+1, per the trip protocol)');
  assert.ok(r.stats.crossingPairsExamined <= 65, 'confirmed pairs stay within their cap (+1)');
  assert.ok(r.stats.pointClassifications <= 1536, 'probe classifications stay within the structural maximum');
});
