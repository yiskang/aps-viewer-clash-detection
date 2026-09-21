// Instrumentation regressions for
// docs/superpowers/specs/2026-09-11-proper-crossing-query-deterministic-budget-fix-design.md
// (§4.2, §5.2, §5.2a, §9.1a, §13 G, §14.4 item 5).
//
// Originally written for Phase A (behavior-neutral instrumentation), when both wall-clock semantic
// branches were still live and this file deliberately asserted nothing about them. Phase C has
// since deleted both branches, so the clock in `properCrossingQuery` is now read exactly twice --
// once at entry, once after `bvhcast` returns -- and can reach nothing but `stats.elapsedMs` /
// `stats.timeBudgetExceeded`. Comments below that described the many-read, still-semantic behavior
// have been corrected rather than left to mislead, and Phase A's own transient test (the one whose
// comment said it expected to be deleted by Phase C) is replaced by the post-Phase-C invariant it
// was a placeholder for. The wall-clock SEMANTIC contracts live in
// test/query/ProperCrossingQuery.test.mjs; the deterministic regression matrix (§13 B/C/D/H and
// item A's synthetic backstop) lives in test/query/ProperCrossingQuery.deterministic.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { properCrossingQuery, createCrossingStats } from '../../collision/query/ProperCrossingQuery.js';
import { classifyPoint } from '../../collision/query/ContainmentQuery.js';
import { volumeOverlapQuery } from '../../collision/query/VolumeOverlapQuery.js';
import { setDiagnosticEventRecorder, clearDiagnosticEventRecorder } from '../../collision/scheduler.js';
import {
  maxCrossingPointClassifications,
  maxCrossingPairsExamined,
} from '../../collision/constants.js';
import { box, at, comb, testInstance, THREE } from '../fixtures/geometry.mjs';

function relativeMatrix(a, b) {
  return a.matrix.clone().invert().multiply(b.matrix);
}

function crossOf(a, b, options) {
  return properCrossingQuery(a.bvh, b.bvh, relativeMatrix(a, b), a.localDiagonal, b.localDiagonal, options);
}

// A pair with a genuine deep overlap, so the probe ladder is actually entered.
const deepOverlap = () => [testInstance(box(3, 3, 3)), testInstance(box(3, 3, 3), at(0.1, 0.1, 0.1))];
// A pair that genuinely crosses (neither has a vertex inside the other).
const crossingPair = () => [testInstance(box(20, 0.4, 0.4)), testInstance(box(0.4, 0.4, 20))];
// Many confirmed non-coplanar intersecting pairs whose every probe fails to prove a crossing
// (an overlap far below the declared minPenetrationDepth): the ladder is entered repeatedly and
// nothing short-circuits it, which is what makes the pair/classification budgets observable.
const ladderHeavyPair = () => [testInstance(box(1, 1, 1)), testInstance(box(1, 1, 1), at(1 - 1e-8, 0, 0))];
// A pair whose root AABBs do not touch: bvhcast never invokes the callback.
const separatedPair = () => [testInstance(box(2, 2, 2)), testInstance(box(2, 2, 2), at(10, 0, 0))];

// ---------------------------------------------------------------------------
// §14.4 item 5 -- the constant, derived not invented
// ---------------------------------------------------------------------------

test('maxCrossingPointClassifications is exactly the structural maximum maxCrossingPairsExamined x 24', () => {
  assert.equal(maxCrossingPointClassifications, maxCrossingPairsExamined * 24);
  assert.equal(maxCrossingPointClassifications, 1536,
    'the design fixes the value at 1536 (64 x 24); a different number means one of the two inputs drifted');
});

// ---------------------------------------------------------------------------
// §5.2 / §5.2a -- one normalized stats shape on every path
// ---------------------------------------------------------------------------

const STATS_KEYS = [
  'candidatePairsExamined',
  'crossingPairsExamined',
  'pointClassifications',
  'exhaustedBudget',
  'elapsedMs',
  'timeBudgetExceeded',
];

test('createCrossingStats defaults are exactly §5.2a\'s skip-path row (elapsedMs null, never a fabricated 0)', () => {
  const s = createCrossingStats();
  assert.deepEqual(Object.keys(s).sort(), [...STATS_KEYS].sort());
  assert.equal(s.candidatePairsExamined, 0);
  assert.equal(s.crossingPairsExamined, 0);
  assert.equal(s.pointClassifications, 0);
  assert.equal(s.exhaustedBudget, null);
  assert.equal(s.elapsedMs, null, 'elapsedMs must be null, NOT 0 -- a fabricated zero-duration reading would pollute span distributions (§5.2a)');
  assert.equal(s.timeBudgetExceeded, false);
});

test('a real traversal returns the full normalized stats shape, no undefined fields', () => {
  const [a, b] = crossingPair();
  const r = crossOf(a, b);
  assert.deepEqual(Object.keys(r.stats).sort(), [...STATS_KEYS].sort());
  for (const k of STATS_KEYS) {
    assert.notEqual(r.stats[k], undefined, `stats.${k} must never be undefined`);
  }
  assert.equal(typeof r.stats.pointClassifications, 'number');
  assert.equal(r.stats.exhaustedBudget, null, 'a completed traversal exhausted no budget');
  assert.equal(typeof r.stats.timeBudgetExceeded, 'boolean');
});

test('the aspect-ratio SKIP path emits the identical normalized shape via the same shared normalizer (§5.2a)', async () => {
  const src = testInstance(box(2, 2, 2));
  src.aspectRatioExceeded = true;
  const tgt = testInstance(box(2, 2, 2), at(0.5, 0, 0));
  const r = await volumeOverlapQuery(src, tgt);
  const s = r.stats.crossing;
  assert.deepEqual(Object.keys(s).sort(), [...STATS_KEYS].sort(),
    'the skip path must not emit a narrower object than the real path -- four undefined fields read downstream as NaN/missing-record');
  assert.equal(s.candidatePairsExamined, 0);
  assert.equal(s.crossingPairsExamined, 0);
  assert.equal(s.pointClassifications, 0);
  assert.equal(s.exhaustedBudget, null);
  assert.equal(s.elapsedMs, null, 'the traversal did not take zero time, it did not happen (§5.2a)');
  assert.equal(s.timeBudgetExceeded, false);
});

// ---------------------------------------------------------------------------
// §4.2 -- the pointClassifications counter and its non-binding 1536 terminator
// ---------------------------------------------------------------------------

test('pointClassifications counts every classifyPoint invocation the probe ladder makes', () => {
  const [a, b] = deepOverlap();
  let observed = 0;
  const r = crossOf(a, b, {
    __classifyPoint: (...args) => { observed++; return classifyPoint(...args); },
  });
  assert.ok(observed > 0, 'sanity: the fixture actually reaches the probe ladder');
  assert.equal(r.stats.pointClassifications, observed,
    'the reported counter must equal the number of classifier invocations actually made');
});

test('pointClassifications is zero when no candidate pair ever reaches the probe ladder', () => {
  const [a, b] = separatedPair();
  const r = crossOf(a, b);
  assert.equal(r.stats.candidatePairsExamined, 0);
  assert.equal(r.stats.crossingPairsExamined, 0);
  assert.equal(r.stats.pointClassifications, 0);
  assert.equal(r.stats.exhaustedBudget, null);
});

test('the point-classification budget terminates the traversal and attributes itself (D3 seam)', () => {
  const [a, b] = deepOverlap();
  const r = crossOf(a, b, { maxCrossingPointClassifications: 5, frameBudgetMs: Infinity });
  assert.equal(r.aborted, true);
  assert.equal(r.crossing, false);
  assert.equal(r.inconclusive, false, 'aborted masks inconclusive, as today');
  assert.equal(r.stats.exhaustedBudget, 'point-classifications');
  assert.equal(r.stats.pointClassifications, 5,
    'checked BEFORE the call, so the cap is reached exactly and never exceeded (§4.2 "Max value: cap")');
  assert.equal(r.diagnostics.some((d) => d.reason === 'crossing-budget-exhausted'), true);
});

test('the point-classification cap is deterministic across repeated runs, with no clock injected', () => {
  const [a, b] = deepOverlap();
  const runs = [];
  for (let i = 0; i < 10; i++) {
    const r = crossOf(a, b, { maxCrossingPointClassifications: 7, frameBudgetMs: Infinity });
    runs.push(JSON.stringify({
      crossing: r.crossing, aborted: r.aborted, inconclusive: r.inconclusive,
      diagnostics: r.diagnostics, exhaustedBudget: r.stats.exhaustedBudget,
      pointClassifications: r.stats.pointClassifications,
      crossingPairsExamined: r.stats.crossingPairsExamined,
      candidatePairsExamined: r.stats.candidatePairsExamined,
    }));
  }
  assert.equal(new Set(runs).size, 1, `all 10 runs must be byte-identical; got ${new Set(runs).size} distinct results`);
});

test('the shipped 1536 cap is NON-BINDING: it never fires on a traversal today\'s code completes (§4.3)', () => {
  // The structural maximum is maxCrossingPairsExamined x 24. Prove the ladder can
  // never issue more than 24 classifications for one admitted pair, so the shipped
  // cap is unreachable. That is what made Phase A behavior-neutral, and it is also why
  // Phase C's removal of the wall clock strictly WIDENS completeness: the deterministic
  // terminator that replaces the clock cannot fire on anything the clock used to let
  // through. Uses the ladder-heavy fixture, where every one of many confirmed pairs
  // runs its full ladder without a crossing short-circuiting it.
  const [a, b] = ladderHeavyPair();
  let observed = 0;
  const r = crossOf(a, b, { frameBudgetMs: Infinity, __classifyPoint: (...args) => { observed++; return classifyPoint(...args); } });
  assert.ok(r.stats.crossingPairsExamined > 1, 'sanity: many confirmed pairs entered the ladder');
  assert.ok(r.stats.crossingPairsExamined <= maxCrossingPairsExamined + 1,
    'crossingPairsExamined is capped at budget+1 (increment-then-strict-> protocol)');
  const admittedPairs = Math.min(r.stats.crossingPairsExamined, maxCrossingPairsExamined);
  assert.ok(observed <= admittedPairs * 24,
    `${observed} classifications over ${admittedPairs} admitted pairs exceeds the 24/pair structural bound`);
  assert.ok(observed < maxCrossingPointClassifications, 'this fixture stays strictly under the shipped cap');
  assert.notEqual(r.stats.exhaustedBudget, 'point-classifications', 'the shipped cap must not have fired');
});

test('the probe cap stays NON-BINDING when maxCrossingPairsExamined is RAISED above its shipped 64 (codex-review Issue 1)', () => {
  // An independent codex-review of the Phase C diff found a real compatibility defect here. The
  // probe cap originally defaulted to the fixed 1536 constant unconditionally, so a caller who
  // raised `options.maxCrossingPairsExamined` -- an option seam that predates this whole design --
  // got a traversal that aborted on 'point-classifications' after 105 admitted pairs instead of
  // running the 200 the override asked for. That is a REDUCTION in geometric search completeness
  // introduced by a change whose own governing principle (§4.3) forbids exactly that, and it
  // falsifies the "non-binding by construction" claim for every caller not on the shipped budget.
  //
  // The cap is now derived from the EFFECTIVE pair budget, so it scales with the override. This
  // test is the regression: with the pair budget raised and NO classification override supplied,
  // the traversal must still terminate on the pair budget it was actually given.
  // A DENSER ladder-heavy pair than `ladderHeavyPair()`: the plain-box version confirms only ~40
  // intersecting pairs, too few to reach a 200-pair budget at all, so it could not distinguish the
  // two behaviors. Subdividing the boxes yields several hundred.
  const dense = () => new THREE.BoxGeometry(1, 1, 1, 8, 8, 8);
  const a = testInstance(dense());
  const b = testInstance(dense(), at(1 - 1e-8, 0, 0));
  const raised = crossOf(a, b, { maxCrossingPairsExamined: 200 });
  assert.equal(raised.stats.exhaustedBudget, 'crossing-pairs',
    'the RAISED pair budget must be what terminates it -- not a probe cap frozen at the shipped 64 x 24');
  assert.equal(raised.stats.crossingPairsExamined, 201, 'increment-then-strict-> at the raised budget');
  assert.ok(raised.stats.pointClassifications > maxCrossingPointClassifications,
    `the traversal legitimately ran past the SHIPPED 1536 cap (${raised.stats.pointClassifications}), which is only correct because the cap tracks the effective budget`);

  // ...and supplying the equivalent explicit override changes nothing, which is what "derived"
  // means: the implicit default and the explicit arithmetic agree.
  const explicit = crossOf(a, b, { maxCrossingPairsExamined: 200, maxCrossingPointClassifications: 200 * 24 });
  assert.equal(explicit.stats.exhaustedBudget, raised.stats.exhaustedBudget);
  assert.equal(explicit.stats.crossingPairsExamined, raised.stats.crossingPairsExamined);
  assert.equal(explicit.stats.pointClassifications, raised.stats.pointClassifications);
});

test('crossingPairsExamined admits exactly maxCrossingPairsExamined pairs into the ladder, not one more', () => {
  const [a, b] = ladderHeavyPair();
  const r = crossOf(a, b, { maxCrossingPairsExamined: 2, frameBudgetMs: Infinity });
  assert.equal(r.aborted, true);
  assert.equal(r.stats.exhaustedBudget, 'crossing-pairs');
  assert.equal(r.stats.crossingPairsExamined, 3,
    'increment-then-strict-> means the counter reads budget+1 when it trips, i.e. exactly 2 pairs were admitted');
});

// ---------------------------------------------------------------------------
// §5.2 -- exhaustedBudget attribution
// ---------------------------------------------------------------------------

test('exhaustedBudget names the candidate-pair cap when that is what fired', () => {
  const a = testInstance(comb(0));
  const b = testInstance(comb(0.05));
  const r = crossOf(a, b, { maxCandidatePairsExamined: 500, frameBudgetMs: Infinity });
  assert.equal(r.aborted, true);
  assert.equal(r.stats.exhaustedBudget, 'candidate-pairs');
});

test('POST-PHASE-C INVARIANT: aborted is true if and only if exhaustedBudget names a cap', () => {
  // Replaces this file's Phase-A transient, whose own comment said it was expected to
  // be deleted by Phase C: while the wall-clock semantic branches were live, a
  // clock-driven abort was the one case where `aborted === true && exhaustedBudget ===
  // null`, and §5.2's enum deliberately had no value for it. Both branches are now
  // gone, so that combination is unreachable and the biconditional below holds over
  // every terminating path -- a completed traversal, and each of the three caps.
  const cases = [
    ['completed, no cap', deepOverlap(), {}],
    ['candidate-pairs', [testInstance(comb(0)), testInstance(comb(0.05))], { maxCandidatePairsExamined: 500 }],
    ['crossing-pairs', ladderHeavyPair(), { maxCrossingPairsExamined: 2 }],
    ['point-classifications', deepOverlap(), { maxCrossingPointClassifications: 5 }],
  ];
  // A clock hostile enough to have aborted every one of these before Phase C.
  const hostileNow = (() => { let n = 0; return () => { n++; return n === 1 ? 0 : 1e9; }; });
  for (const [label, [a, b], options] of cases) {
    const r = crossOf(a, b, { ...options, now: hostileNow() });
    assert.equal(r.aborted, r.stats.exhaustedBudget !== null,
      `${label}: aborted must be exactly equivalent to a named exhausted budget`);
    assert.equal(r.stats.timeBudgetExceeded, true,
      `${label}: sanity -- the clock DID breach the budget, and it changed nothing semantic`);
  }
});

// ---------------------------------------------------------------------------
// §9.1a -- fault-isolated telemetry; a clock failure never withholds a result
// ---------------------------------------------------------------------------

test('elapsedMs/timeBudgetExceeded are live telemetry under a normal clock', () => {
  const [a, b] = crossingPair();
  const r = crossOf(a, b);
  assert.equal(typeof r.stats.elapsedMs, 'number');
  assert.ok(r.stats.elapsedMs >= 0);
  assert.equal(r.stats.timeBudgetExceeded, r.stats.elapsedMs > 8);
});

test('timeBudgetExceeded is true when the measured span exceeds the budget, and the geometric result is untouched', () => {
  const [a, b] = crossingPair();
  const reference = crossOf(a, b);
  assert.equal(reference.crossing, true, 'sanity: this pair genuinely crosses');
  // Post-Phase-C there are exactly two reads, entry and exit, so the jump could be
  // hardcoded to read 2 -- but the count is still LEARNED from a harmless clock first,
  // so this test keeps working (and keeps meaning the same thing) if the read count
  // ever changes again. The equality assertion below pins the current count at 2.
  let reads = 0;
  crossOf(a, b, { now: () => { reads++; return 0; } });
  const total = reads;
  assert.equal(total, 2, 'exactly one entry read and one exit read remain; the in-loop reads are gone (§9.2)');
  let n = 0;
  const jumpOnExit = () => { n++; return n === total ? 1000 : 0; };
  const r = crossOf(a, b, { now: jumpOnExit });
  assert.equal(r.crossing, true, 'telemetry never changes the geometric verdict');
  assert.equal(r.aborted, false);
  assert.equal(r.stats.elapsedMs, 1000);
  assert.equal(r.stats.timeBudgetExceeded, true, 'derived === (elapsedMs > timeBudgetMs), default 8ms');
});

test('a wall-clock overrun measured only at exit sets telemetry without aborting (row 5/6 of the §2.2 truth table)', () => {
  // Separated operands: bvhcast never enters the callback at all, so this stays a
  // two-read traversal for the most basic possible reason, independent of Phase C's
  // removal of the in-callback reads.
  const [a, b] = separatedPair();
  let calls = 0;
  const r = crossOf(a, b, { now: () => { calls++; return calls === 1 ? 0 : 1000; } });
  assert.equal(calls, 2);
  assert.equal(r.aborted, false, 'a telemetry-only breach never sets aborted');
  assert.equal(r.crossing, false);
  assert.equal(r.stats.exhaustedBudget, null);
  assert.equal(r.stats.elapsedMs, 1000);
  assert.equal(r.stats.timeBudgetExceeded, true);
});

test('a THROWING clock on the ENTRY read degrades cleanly and still returns the geometric result (§9.1a item 1, both reads)', () => {
  // Phase C's own new coverage. Until Phase C the entry read could NOT be fault-isolated:
  // it was the semantic baseline both abort branches measured against, so a null baseline
  // would have made `now() - null` NaN and silently changed every abort decision -- which
  // is why Phase A isolated only the exit read and this case had no test. Now that the
  // entry read is telemetry too, §9.1a item 1's "BOTH telemetry clock reads are
  // individually fault-isolated" is finally satisfiable, and this is the half that proves it.
  const [a, b] = crossingPair();
  const reference = crossOf(a, b);
  assert.equal(reference.crossing, true, 'sanity: this pair genuinely crosses');
  let calls = 0;
  const throwingOnEntry = () => {
    calls++;
    if (calls === 1) throw new Error('injected entry-clock failure');
    return 0;
  };
  const r = crossOf(a, b, { now: throwingOnEntry });
  assert.equal(r.crossing, reference.crossing, 'a failed baseline read must not cost us the geometric verdict');
  assert.equal(r.aborted, reference.aborted);
  assert.equal(r.inconclusive, reference.inconclusive);
  assert.deepEqual(r.diagnostics, reference.diagnostics);
  assert.equal(r.stats.candidatePairsExamined, reference.stats.candidatePairsExamined);
  assert.equal(r.stats.crossingPairsExamined, reference.stats.crossingPairsExamined);
  assert.equal(r.stats.pointClassifications, reference.stats.pointClassifications);
  assert.equal(r.stats.exhaustedBudget, null);
  assert.equal(r.stats.elapsedMs, null, 'no baseline was taken, so there is no span -- visible as null, never as 0');
  assert.equal(r.stats.timeBudgetExceeded, false);
  assert.equal(calls, 2,
    'the exit read is still ATTEMPTED and isolated on its own -- the two reads are independently fault-isolated, not short-circuited');
});

test('a clock that throws on BOTH reads still returns the geometric result', () => {
  const [a, b] = crossingPair();
  const reference = crossOf(a, b);
  let calls = 0;
  const alwaysThrows = () => { calls++; throw new Error('injected total clock failure'); };
  const r = crossOf(a, b, { now: alwaysThrows });
  assert.equal(calls, 2, 'both reads were attempted, and both were caught at their own site');
  assert.equal(r.crossing, reference.crossing);
  assert.equal(r.stats.pointClassifications, reference.stats.pointClassifications);
  assert.equal(r.stats.elapsedMs, null);
  assert.equal(r.stats.timeBudgetExceeded, false);
});

test('a THROWING clock on the exit read degrades to {elapsedMs: null, timeBudgetExceeded: false} and still returns the geometric result', () => {
  const [a, b] = crossingPair();
  // Learn this fixture's exact clock-read count under a harmless clock (the traversal
  // is deterministic, so the count is too), then re-run throwing on the LAST read --
  // which is the post-bvhcast telemetry read.
  let reads = 0;
  const counting = () => { reads++; return 0; };
  const reference = crossOf(a, b, { now: counting });
  const total = reads;
  assert.ok(total >= 2, 'sanity: at least an entry and an exit read happened');

  let n = 0;
  const throwingOnExit = () => {
    n++;
    if (n === total) throw new Error('injected telemetry clock failure');
    return 0;
  };
  const r = crossOf(a, b, { now: throwingOnExit });
  assert.equal(r.crossing, reference.crossing, 'the already-computed geometric verdict survives the telemetry failure');
  assert.equal(r.aborted, reference.aborted);
  assert.equal(r.inconclusive, reference.inconclusive);
  assert.deepEqual(r.diagnostics, reference.diagnostics);
  assert.equal(r.stats.candidatePairsExamined, reference.stats.candidatePairsExamined);
  assert.equal(r.stats.crossingPairsExamined, reference.stats.crossingPairsExamined);
  assert.equal(r.stats.pointClassifications, reference.stats.pointClassifications);
  assert.equal(r.stats.elapsedMs, null, 'the failure stays VISIBLE as null rather than being papered over');
  assert.equal(r.stats.timeBudgetExceeded, false, 'never true on the strength of an unvalidated value');
});

test('a THROWING clock on the exit read of a callback-free traversal also degrades cleanly', () => {
  // Separated operands: bvhcast never enters the callback, so there are exactly two
  // reads -- entry and exit -- and read 2 is unambiguously the telemetry read.
  const [a, b] = separatedPair();
  let calls = 0;
  const throwingNow = () => { calls++; if (calls === 2) throw new Error('injected telemetry clock failure'); return 0; };
  const r = crossOf(a, b, { now: throwingNow });
  assert.equal(calls, 2, 'sanity: exactly one entry read and one exit read');
  assert.equal(r.crossing, false);
  assert.equal(r.aborted, false);
  assert.equal(r.stats.elapsedMs, null);
  assert.equal(r.stats.timeBudgetExceeded, false);
});

test('a NON-FINITE clock degrades to {elapsedMs: null, timeBudgetExceeded: false} without changing the verdict', () => {
  const [a, b] = crossingPair();
  const reference = crossOf(a, b, { frameBudgetMs: Infinity });
  const r = crossOf(a, b, { now: () => NaN });
  assert.equal(r.crossing, reference.crossing);
  assert.equal(r.aborted, false);
  assert.equal(r.stats.pointClassifications, reference.stats.pointClassifications);
  assert.equal(r.stats.elapsedMs, null);
  assert.equal(r.stats.timeBudgetExceeded, false);
});

test('a BACKWARD-moving clock degrades to {elapsedMs: null, timeBudgetExceeded: false} without changing the verdict', () => {
  const [a, b] = crossingPair();
  const reference = crossOf(a, b, { frameBudgetMs: Infinity });
  let t = 1_000_000;
  const r = crossOf(a, b, { now: () => t-- });
  assert.equal(r.crossing, reference.crossing);
  assert.equal(r.aborted, false, 'a negative elapsed can never exceed the budget, so nothing aborts');
  assert.equal(r.stats.pointClassifications, reference.stats.pointClassifications);
  assert.equal(r.stats.elapsedMs, null, 'a negative span is not a measurement');
  assert.equal(r.stats.timeBudgetExceeded, false);
});

// ---------------------------------------------------------------------------
// §13 G -- the test-only injectable point-classifier seam
// ---------------------------------------------------------------------------

test('__classifyPoint defaults to the real classifyPoint (production behavior is untouched)', () => {
  const [a, b] = crossingPair();
  const withDefault = crossOf(a, b, { frameBudgetMs: Infinity });
  const withExplicit = crossOf(a, b, { frameBudgetMs: Infinity, __classifyPoint: classifyPoint });
  assert.equal(withDefault.crossing, withExplicit.crossing);
  assert.equal(withDefault.stats.pointClassifications, withExplicit.stats.pointClassifications);
  assert.equal(withDefault.stats.crossingPairsExamined, withExplicit.stats.crossingPairsExamined);
});

test('__classifyPoint throwing a TRUTHY value propagates out of properCrossingQuery, from INSIDE intersectsTriangles', () => {
  const [a, b] = deepOverlap();
  let invoked = 0;
  const thrower = () => { invoked++; throw new Error('injected classifier failure'); };
  assert.throws(() => crossOf(a, b, { frameBudgetMs: Infinity, __classifyPoint: thrower }),
    /injected classifier failure/);
  assert.ok(invoked > 0,
    'the throw must originate inside the callback -- the classifier is called at the probe ladder, squarely within intersectsTriangles');

  // The callback-containment protocol must have let bvhcast reach its
  // normal-completion path and clear its module-global `_active`.
  const after = crossOf(a, b, { frameBudgetMs: Infinity });
  assert.equal(typeof after.crossing, 'boolean',
    'subsequent traversal is not poisoned by the prior in-callback exception');
});

test('__classifyPoint throwing a FALSY value (null) still propagates, from INSIDE intersectsTriangles', () => {
  const [a, b] = deepOverlap();
  let invoked = 0;
  const thrower = () => { invoked++; throw null; }; // eslint-disable-line no-throw-literal -- deliberately falsy
  assert.throws(() => crossOf(a, b, { frameBudgetMs: Infinity, __classifyPoint: thrower }), (err) => err === null);
  assert.ok(invoked > 0, 'the throw originated inside the callback, not after bvhcast returned');
  const after = crossOf(a, b, { frameBudgetMs: Infinity });
  assert.equal(typeof after.crossing, 'boolean', '`_active` was cleared despite the falsy throw');
});

// ---------------------------------------------------------------------------
// §5.4 -- the four fields ride the existing stage:'crossing' diagnostic event only
// ---------------------------------------------------------------------------

test('the stage:\'crossing\' diagnostic event carries the four new fields, and result.diagnostics does NOT', async () => {
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push({ kind, payload }));
  let result;
  try {
    result = await volumeOverlapQuery(duct, beam, {
      diagnosticPairContext: { sourceEpoch: 1, sourceFragmentId: 1, targetEpoch: 1, targetFragmentId: 2 },
    });
  } finally {
    clearDiagnosticEventRecorder();
  }
  const crossingEvent = events.find((e) => e.payload.stage === 'crossing');
  assert.ok(crossingEvent, 'the crossing event still fires exactly as before');
  assert.equal(typeof crossingEvent.payload.timeBudgetExceeded, 'boolean');
  assert.equal(typeof crossingEvent.payload.pointClassifications, 'number');
  assert.ok(crossingEvent.payload.crossingElapsedMs === null || typeof crossingEvent.payload.crossingElapsedMs === 'number');
  assert.equal(crossingEvent.payload.exhaustedBudget, null);
  // Phase C closed Phase B's declared schema deviation #2: the event used to carry only ONE of the
  // three deterministic counters, so an `exhaustedBudget` attribution could be seen but never
  // sized -- cap USAGE and cap EXHAUSTION were indistinguishable from the outside. All three now
  // ride the same event. An independent codex-review flagged that this test did not assert the two
  // additions, which would have let them be dropped again unnoticed.
  assert.equal(typeof crossingEvent.payload.candidatePairsExamined, 'number');
  assert.equal(typeof crossingEvent.payload.crossingPairsExamined, 'number');
  assert.ok(crossingEvent.payload.candidatePairsExamined > 0, 'and they carry the real measured values, not placeholders');
  assert.ok(crossingEvent.payload.crossingPairsExamined > 0);
  assert.ok(Number.isFinite(crossingEvent.payload.ms), 'the pre-existing ms field is unchanged');
  // §5.4: timing-derived values must never reach result.diagnostics, which is the
  // §6.4-compared public field.
  for (const d of result.diagnostics ?? []) {
    assert.equal('timeBudgetExceeded' in d, false);
    assert.equal('elapsedMs' in d, false);
  }
});

test('the crossing event fires with the normalized skip-path telemetry when the query never ran', async () => {
  const src = testInstance(box(2, 2, 2));
  src.aspectRatioExceeded = true;
  const tgt = testInstance(box(2, 2, 2), at(0.5, 0, 0));
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push({ kind, payload }));
  try {
    await volumeOverlapQuery(src, tgt, {
      diagnosticPairContext: { sourceEpoch: 1, sourceFragmentId: 1, targetEpoch: 1, targetFragmentId: 2 },
    });
  } finally {
    clearDiagnosticEventRecorder();
  }
  const crossingEvent = events.find((e) => e.payload.stage === 'crossing');
  assert.ok(crossingEvent);
  assert.equal(crossingEvent.payload.crossingElapsedMs, null, 'null, not 0 -- the traversal did not happen');
  assert.equal(crossingEvent.payload.timeBudgetExceeded, false);
  assert.equal(crossingEvent.payload.pointClassifications, 0);
  assert.equal(crossingEvent.payload.candidatePairsExamined, 0);
  assert.equal(crossingEvent.payload.crossingPairsExamined, 0);
  assert.equal(crossingEvent.payload.exhaustedBudget, null);
});
