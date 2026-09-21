// test/performance/m4/proper-crossing-budget-calibration.mjs
//
// PHASE B of docs/superpowers/specs/2026-09-11-proper-crossing-query-deterministic-budget-fix-design.md
// (§14.1-§14.4): the budget-CALIBRATION measurement pass. Measurement only -- this script changes
// no constant, no semantics, and no library code. It exists to answer ONE question the design
// leaves open: what is the real worst-case synchronous span of a `properCrossingQuery` traversal
// that is no longer cut short at 8 ms?
//
// NOT a `node --test` file (same convention as run-gate-m4.mjs and
// structure-fragment-clearance-regression.mjs -- plain `npm test` must never require a live dev
// server or live APS credentials). Run it directly, with the dev server already up on PORT:
//
//   node test/performance/m4/proper-crossing-budget-calibration.mjs
//   node test/performance/m4/proper-crossing-budget-calibration.mjs --inputs=I1,I3 --repetitions=5
//   node test/performance/m4/proper-crossing-budget-calibration.mjs --tiers=multiProcess
//
// §14.1's three input classes:
//   I1  shipped fixtures -- every operand pair reaching properCrossingQuery from the existing
//       node --test suites named in §14.1, re-derived here as an EXPLICIT enumerated catalogue with
//       per-entry provenance (file:line). Enumeration, not interception: the pairs are constructed
//       inside test bodies and are not exported, and ESM gives no non-invasive interception seam.
//       Every entry below names the test it came from so the set can be audited against the source.
//   I2  the real failing pair + its cohort + the full S2[k=100:typical:clearance] candidate list,
//       both broad-phase arms, on the live federated Audubon fixture.
//   I3  H1-H4 pathological synthetic geometry from §13.
//
// §14.1's wall-clock neutralization, "for the measurement only":
//   - I1/I3 call properCrossingQuery directly and pass `frameBudgetMs: Infinity` -- the existing
//     seam, already used this way at test/query/SurfaceIntersectionQuery.test.mjs:47. No code change.
//   - I2 goes through CollisionWorld, which hardcodes `crossing: { now: this._now }`
//     (CollisionWorld.js:2433) and plumbs NO frameBudgetMs seam, so `frameBudgetMs: Infinity` is
//     unreachable there without a library change Phase B forbids. Instead the world is constructed
//     with a FROZEN clock -- `CollisionWorld.fromViewer(viewer, { now: () => 0 })` -- which makes
//     `now() - traversalStart` identically 0 and therefore makes both wall-clock semantic branches
//     unreachable, the same neutralization by a different seam. This is exactly the frozen-clock
//     intervention the blocker investigation itself used (report §3.3) to establish the
//     deterministic ground truth. The SPAN is still measured honestly: VolumeOverlapQuery's
//     stage:'crossing' diagnostic event computes its `ms` from real `performance.now()`
//     (VolumeOverlapQuery.js:101,127), never from the injected `_now`.
//
// §14.2's pre-registered runtime tiers are taken verbatim from fixture-lifecycle.mjs's
// RUNTIME_CONFIGS: `multiProcess` (authoritative, §6.1.5b) and `historical` (--single-process, the
// configuration the failing artifact was produced under). 5 counterbalanced repetitions each, cold
// first -- repetition 0 in a freshly launched browser is the cold sample.
//
// Output: a raw JSON record set under test/performance/results/, which
// docs/research/proper-crossing-query-deterministic-budget-calibration.md is written from.
//
// PHASE B' UPDATE (design doc §9.4 "Call seam -- CORRECTED", §14 finding #7): the I1/I3 synthetic
// measurement loop now routes through `orientForCrossing` before `properCrossingQuery`, exactly as
// the production seam (VolumeOverlapQuery.js) does post-Phase-A, instead of calling the kernel
// directly with a hardcoded operand order. Records from THIS harness are NOT byte-comparable with
// the pre-existing Phase B results documented in
// docs/research/proper-crossing-query-deterministic-budget-calibration.md -- the operand fed to the
// kernel as `first`/`second` (and therefore the relative matrix) can now differ from the old
// hardcoded a/b order, so a spanMs recorded here is not measuring the same call shape a pre-Phase-B'
// spanMs measured. Old-shaped fields (spanMs, etc.) are kept for continuity of the existing
// consumers/console output; new fields (kernelSpanMs, wrapperSpanMs, orientationRank,
// canonicalFirstIsA) are additive, for Task B'.3's cross-comparison. NOTE: this measures the KERNEL
// call path only (orientForCrossing + properCrossingQuery) -- it does not replicate the full
// volumeOverlapQuery wrapper lifecycle (e.g. the aspectRatioExceeded skip-gate, or production's own
// options.crossing), by design, since this is a direct kernel-timing calibration.

import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { RUNTIME_CONFIGS, resolveProxyFromEnv } from './fixture-lifecycle.mjs';
import { caseOrderForRepetition, armOrderForRepetition } from './counterbalancing-schedule.mjs';
import { rankByDensity, selectCohort, labelDensityUnstratified } from './cohort-selection.mjs';

// URNs copied verbatim from test/performance/run-gate-m4.mjs:42-44.
const ARCH_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fQXJjaGl0ZWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const STRUCTURE_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fU3RydWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const MECHANICAL_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fTWVjaGFuaWNhbF9jbGFzaF90ZXN0LnJ2dA';
const PORT = process.env.PORT || 8080;
const RESULTS_DIR = 'test/performance/results';
const CLEARANCE = 0.05;             // DEFAULT_CLEARANCE, same as run-gate-m4.mjs:47
const S2_K = 100;                   // §14.1's I2: S2[k=100:typical:clearance]
const FAILING_SOURCE_DB_ID = 3547;  // structure:3547/frag363 -- the real failing pair's source
const COHORT_SOURCE_DB_ID = 3076;   // forced into the HIGH cohort by run-gate-m4's buildCohorts

function parseArgs(argv) {
  // I4 = Task B'.3's case (e) aggregate orientation+digest pass (MEASURE_AGGREGATE_ORIENTATION).
  const out = { inputs: ['I1', 'I2', 'I3', 'I4'], tiers: ['multiProcess', 'historical'], repetitions: 5 };
  for (const a of argv.slice(2)) {
    const [k, v] = a.replace(/^--/, '').split('=');
    if (k === 'inputs') out.inputs = v.split(',');
    else if (k === 'tiers') out.tiers = v.split(',');
    else if (k === 'repetitions') out.repetitions = Number(v);
    else if (k === 'i2Repetitions') out.i2Repetitions = Number(v);
    else throw new Error(`unknown flag --${k}`);
  }
  out.i2Repetitions ??= out.repetitions;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Page-side plumbing
// ---------------------------------------------------------------------------------------------

// test/fixtures/geometry.mjs is not served (server.js only mounts wwwroot and /collision), so it is
// injected as a BLOB module: a blob: URL created in the page inherits the document's base URL, so
// its `/collision/...` specifiers resolve against http://localhost:PORT and its bare `three` /
// `three/addons/...` specifiers resolve through wwwroot/index.html's own import map. A data: URL
// would NOT work -- it has no base URL, so the absolute-path specifiers could not resolve.
async function installFixtureModule(page) {
  const raw = await readFile('test/fixtures/geometry.mjs', 'utf8');
  // Fully qualified, not root-relative: a blob: URL is NOT a hierarchical base, so `/collision/...`
  // cannot be resolved against it ("Invalid relative url or base scheme isn't hierarchical").
  const rewritten = raw.replaceAll('../../collision/', `http://localhost:${PORT}/collision/`);
  await page.evaluate(async (src) => {
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    window.__fx = await import(url);
    window.__pcq = await import('/collision/query/ProperCrossingQuery.js');
    window.__orient = await import('/collision/query/orientForCrossing.js');
    window.__consts = await import('/collision/constants.js');
  }, rewritten);
}

// The I1 + I3 catalogue and the direct-call measurement loop, evaluated in the page. Every operand
// pair is rebuilt fresh per repetition so BVH construction cost is never shared across samples, and
// every traversal is timed end to end with the real `performance.now`.
const MEASURE_SYNTHETIC = /* js */ `
async ({ repetition, state, classes }) => {
  const { box, at, comb, mergeGeometries, openBottomedBox, testInstance, THREE } = window.__fx;
  const { properCrossingQuery } = window.__pcq;
  const { orientForCrossing } = window.__orient;

  const rot = (r) => new THREE.Matrix4().makeRotationY(r);
  const scale = (x, y, z) => new THREE.Matrix4().makeScale(x, y, z);
  const lShape = () => {
    const legA = box(4, 1, 1).translate(0, 0, 0);
    const legB = box(1, 4, 1).translate(-1.5, 2.5, 0);
    return mergeGeometries([legA, legB]);
  };
  const manyParts = (n, step) => {
    const parts = [];
    for (let i = 0; i < n; i++) parts.push(box(0.1, 0.1, 0.1).translate(i * step, 0, 0));
    return mergeGeometries(parts);
  };
  // A densely tessellated box: 12 * s^2 triangles. s=31 -> 11,532, just under the shipped
  // maxSyncTriangleCount = 12,000 geometry ceiling that bounds per-classifyPoint cost.
  const denseBox = (size, s) => new THREE.BoxGeometry(size, size, size, s, s, s);

  // --- I1: shipped fixtures, each tagged with the test it was re-derived from -------------------
  const I1 = [
    ['PCQ-coplanar-touching',          'ProperCrossingQuery.test.mjs:16',  () => [box(2,2,2), null, box(2,2,2), at(0,2,0)]],
    ['PCQ-edge-vertex-contact',        'ProperCrossingQuery.test.mjs:33',  () => [box(2,2,2), null, box(2,2,2), at(2,2,0)]],
    ['PCQ-duct-through-beam',          'ProperCrossingQuery.test.mjs:41',  () => [box(20,0.4,0.4), null, box(0.4,0.4,20), null]],
    ['PCQ-thin-overlap-5e-4',          'ProperCrossingQuery.test.mjs:50',  () => [box(1,1,1), null, box(1,1,1), at(1-5e-4,0,0)]],
    ['PCQ-below-min-penetration-1e-8', 'ProperCrossingQuery.test.mjs:63',  () => [box(1,1,1), null, box(1,1,1), at(1-1e-8,0,0)]],
    ['PCQ-inverted-winding',           'ProperCrossingQuery.test.mjs:73',  () => [box(20,0.4,0.4), null, box(0.4,0.4,20), scale(-1,1,1)]],
    ['PCQ-combs-warmup-box-pair',      'ProperCrossingQuery.test.mjs:93',  () => [box(1,1,1), null, box(1,1,1), at(0.5,0,0)]],
    ['PCQ-interleaved-combs',          'ProperCrossingQuery.test.mjs:85',  () => [comb(0), null, comb(0.05), null]],
    ['PCQ-anisotropic-forward',        'ProperCrossingQuery.test.mjs:101', () => [box(20,0.4,0.4), null, box(0.4,0.4,20), scale(1,3,1)]],
    ['PCQ-anisotropic-backward',       'ProperCrossingQuery.test.mjs:101', () => [box(0.4,0.4,20), scale(1,3,1), box(20,0.4,0.4), null]],
    ['PCQ-deep-box-overlap',           'ProperCrossingQuery.test.mjs:127', () => [box(3,3,3), null, box(3,3,3), at(0.1,0.1,0.1)]],
    ['PCQ-coincident-box5',            'ProperCrossingQuery.test.mjs:234', () => [box(5,5,5), null, box(5,5,5), null]],

    ['VOQ-small-in-large',             'VolumeOverlapQuery.test.mjs:8',    () => [box(1,1,1), null, box(6,6,6), null]],
    ['VOQ-clearly-separated',          'VolumeOverlapQuery.test.mjs:15',   () => [box(2,2,2), null, box(2,2,2), at(10,0,0)]],
    ['VOQ-l-shape-notch',              'VolumeOverlapQuery.test.mjs:32',   () => [box(0.5,0.5,0.5), at(1,2,0), lShape(), null]],
    ['VOQ-torus-bead-in-hole',         'VolumeOverlapQuery.test.mjs:45',   () => [box(0.5,0.5,0.5), null, new THREE.TorusGeometry(3,0.6,12,32), null]],
    ['VOQ-offcenter-embedded',         'VolumeOverlapQuery.test.mjs:53',   () => [box(1,1,1), at(3,3,3), box(10,10,10), null]],
    ['VOQ-door-straddling-roomA',      'VolumeOverlapQuery.test.mjs:61',   () => [box(1,2,0.2), at(2,0,0), box(4,3,4), null]],
    ['VOQ-door-straddling-roomB',      'VolumeOverlapQuery.test.mjs:61',   () => [box(1,2,0.2), at(2,0,0), box(4,3,4), at(4,0,0)]],
    ['VOQ-20-part-source-in-box',      'VolumeOverlapQuery.test.mjs:71',   () => [manyParts(20,0.3), null, box(4,4,4), null]],
    ['VOQ-multipart-vs-small-box',     'VolumeOverlapQuery.test.mjs:307',  () => [manyParts(20,0.3), null, box(1,1,1), null]],
    ['VOQ-witness-shifted-duct-beam',  'VolumeOverlapQuery.test.mjs:360',  () => [box(20,0.4,0.4), at(7,-3,11), box(0.4,0.4,20), at(7,-3,11)]],

    ['VOQC-open-box-in-closed-box',    'VolumeOverlapQuery.conclusive.test.mjs:29',  () => [openBottomedBox(0.4), null, box(4,4,4), null]],
    ['VOQC-nonmanifold-src-vs-remote', 'VolumeOverlapQuery.conclusive.test.mjs:121', () => [mergeGeometries([box(1,1,1), box(1,1,1).translate(1,0,0)]), null, box(0.2,0.2,0.2), at(10,10,10)]],
    ['VOQC-unverified-parity-open',    'VolumeOverlapQuery.conclusive.test.mjs:151', () => [box(1,1,1), at(50,0,0), openBottomedBox(4), null]],

    ['VOQI-half-overlap-boxes',        'VolumeOverlapQuery.inconclusiveCauses.test.mjs:94',  () => [box(2,2,2), null, box(2,2,2), at(1,0,0)]],
    ['VOQI-unit-in-ten',               'VolumeOverlapQuery.inconclusiveCauses.test.mjs:104', () => [box(1,1,1), null, box(10,10,10), null]],
    ['VOQI-ten-vs-unit',               'VolumeOverlapQuery.inconclusiveCauses.test.mjs:113', () => [box(10,10,10), null, box(1,1,1), null]],

    ['CHCP-overlapping-boxes',         'ClearanceHardClashPrecheck.test.mjs:35',  () => [box(2,2,2), null, box(2,2,2), at(1,0,0)]],
    ['CHCP-containment',               'ClearanceHardClashPrecheck.test.mjs:46',  () => [box(10,10,10), null, box(1,1,1), at(3,3,3)]],
    ['CHCP-rotated-loose-aabb',        'ClearanceHardClashPrecheck.test.mjs:76',  () => [box(2,2,2), rot(Math.PI/4), box(1,1,1), at(1.6,0,1.6)]],
    ['CHCP-combs-inconclusive',        'ClearanceHardClashPrecheck.test.mjs:102', () => [comb(0), null, comb(0.05), null]],
    ['CHCP-adjacent-boxes',            'ClearanceHardClashPrecheck.test.mjs:113', () => [box(2,2,2), null, box(2,2,2), at(2,0,0)]],

    // The three clearance CollisionWorld suites reach properCrossingQuery only through
    // CollisionWorld, and build their worlds from these box geometries at assorted separations
    // (all three files use nothing but box(1,1,1) / box(2,2,2) / box(2,6,2)).
    ['CW-clearance-box2-adjacent',     'CollisionWorld.findClashes.clearance.test.mjs',    () => [box(2,2,2), null, box(2,2,2), at(2.01,0,0)]],
    ['CW-clearance-box2-overlapping',  'CollisionWorld.findClashes.clearance.test.mjs',    () => [box(2,2,2), null, box(2,2,2), at(1.5,0,0)]],
    ['CW-clearance-box1-vs-box2',      'CollisionWorld.clearanceStatistics.test.mjs',      () => [box(1,1,1), null, box(2,2,2), at(1.2,0,0)]],
    ['CW-clearance-tall-vs-box2',      'CollisionWorld.clearanceStatistics.test.mjs',      () => [box(2,6,2), null, box(2,2,2), at(1.5,0,0)]],
    ['CW-clearance-admission-box2',    'CollisionWorld.clearanceAdmissionValidation.test.mjs', () => [box(2,2,2), null, box(2,2,2), at(1,0,0)]],
  ];

  // --- I3: H1-H4 pathological synthetic geometry (design §13 H) ---------------------------------
  const I3 = [
    // H1 -- interleaved combs at increasing tooth counts: maximizes CANDIDATE pairs (tier-B scan
    // breadth) with zero real crossings. The largest is sized to saturate the shipped 50,000
    // maxCandidatePairsExamined cap, which is §14.3 item 6's own measurement.
    ['H1-combs-60',    'design §13 H1', () => [comb(0, 60), null, comb(0.05, 60), null]],
    ['H1-combs-200',   'design §13 H1', () => [comb(0, 200), null, comb(0.05, 200), null]],
    ['H1-combs-600',   'design §13 H1', () => [comb(0, 600), null, comb(0.05, 600), null]],
    ['H1-combs-1500',  'design §13 H1', () => [comb(0, 1500), null, comb(0.05, 1500), null]],
    // H2 -- two coincident dense meshes at a sub-minPenetrationDepth offset: maximizes CONFIRMED
    // pairs whose every probe fails, i.e. the full 24-classification ladder runs and proves nothing.
    ['H2-dense-coincident-1e-8',  'design §13 H2', () => [denseBox(1, 20), null, denseBox(1, 20), at(1 - 1e-8, 0, 0)]],
    // H3 -- two dense boxes in deep overlap: maximizes probe work per confirmed pair.
    ['H3-dense-deep-overlap',     'design §13 H3', () => [denseBox(3, 20), null, denseBox(3, 20), at(0.1, 0.1, 0.1)]],
    // H4 -- both operands AT the maxSyncTriangleCount = 12,000 ceiling (12 * 31^2 = 11,532) in deep
    // overlap: the shipped worst case, and the fixture §14.3 item 4's headline must include.
    ['H4-ceiling-deep-overlap',   'design §13 H4', () => [denseBox(3, 31), null, denseBox(3, 31), at(0.1, 0.1, 0.1)]],
    ['H4-ceiling-coincident',     'design §13 H4', () => [denseBox(1, 31), null, denseBox(1, 31), at(1 - 1e-8, 0, 0)]],
    // CO-OCCURRENCE probe, added for §11.1's own stated worry -- "the possibility that high scan
    // cost and high probe cost CO-OCCUR in one traversal, which no per-fixture measurement of
    // either alone can reveal." H1 saturates the scan with zero confirmed pairs; H2/H3/H4 load the
    // ladder but scan little. These interleave combs whose teeth are flush at a
    // sub-minPenetrationDepth offset, so the tier-B scan runs wide AND the confirmed pairs that
    // fall out of it each run a full failing ladder.
    ['HX-combs-flush-600',  'design §11.1 co-occurrence', () => [comb(0, 600), null, comb(0.02 - 1e-8, 600), null]],
    ['HX-combs-flush-1500', 'design §11.1 co-occurrence', () => [comb(0, 1500), null, comb(0.02 - 1e-8, 1500), null]],
  ];

  const catalogue = [];
  if (classes.includes('I1')) for (const e of I1) catalogue.push(['I1', ...e]);
  if (classes.includes('I3')) for (const e of I3) catalogue.push(['I3', ...e]);

  const records = [];
  for (const [inputClass, fixtureId, provenance, build] of catalogue) {
    let a, b, buildMs;
    try {
      const bt0 = performance.now();
      const [ga, ma, gb, mb] = build();
      a = testInstance(ga, ma ?? undefined);
      b = testInstance(gb, mb ?? undefined);
      buildMs = performance.now() - bt0;
    } catch (err) {
      records.push({ inputClass, fixtureId, provenance, repetition, state, error: String(err && err.message || err) });
      continue;
    }
    // §14.1: the wall clock is neutralized for the measurement only, via the EXISTING
    // options.frameBudgetMs seam. No code change, and no semantics observed here that Phase C
    // would not also produce.
    //
    // Phase B' (design §9.4 "Call seam -- CORRECTED"): route through orientForCrossing first,
    // exactly as the production seam (VolumeOverlapQuery.js) does post-Phase-A, instead of calling
    // the kernel directly with a hardcoded a/b order. The relative-matrix computation below --
    // canonicalFirst.matrix.clone().invert().multiply(canonicalSecond.matrix) -- is copied
    // VERBATIM from VolumeOverlapQuery.js's own canonicalSecondToFirst (its production call,
    // Task A2.1), not re-derived, so this harness genuinely exercises the production orientation
    // policy rather than a parallel reimplementation of it.
    const wrapperT0 = performance.now();
    const { first: canonicalFirst, second: canonicalSecond, rank: orientationRank } = orientForCrossing(a, b);
    const canonicalFirstIsA = canonicalFirst === a;
    const canonicalSecondToFirst = canonicalFirst.matrix.clone().invert().multiply(canonicalSecond.matrix);
    const kernelT0 = performance.now();
    const r = properCrossingQuery(
      canonicalFirst.bvh, canonicalSecond.bvh, canonicalSecondToFirst,
      canonicalFirst.localDiagonal, canonicalSecond.localDiagonal,
      { frameBudgetMs: Infinity }
    );
    const kernelSpanMs = performance.now() - kernelT0;
    const wrapperSpanMs = performance.now() - wrapperT0;
    // spanMs is kept, old-shaped, as the direct analog of the pre-Phase-B' measurement (which timed
    // only the kernel call) -- it is now an alias for kernelSpanMs, NOT byte-comparable with old
    // spanMs values since the operand order/relative matrix fed to the kernel can now differ (see
    // this file's header note).
    const spanMs = kernelSpanMs;
    records.push({
      inputClass, fixtureId, provenance, repetition, state, buildMs, spanMs,
      kernelSpanMs, wrapperSpanMs, orientationRank, canonicalFirstIsA,
      crossing: r.crossing, aborted: r.aborted, inconclusive: r.inconclusive,
      candidatePairsExamined: r.stats.candidatePairsExamined,
      crossingPairsExamined: r.stats.crossingPairsExamined,
      pointClassifications: r.stats.pointClassifications,
      exhaustedBudget: r.stats.exhaustedBudget,
      statsElapsedMs: r.stats.elapsedMs,
      timeBudgetExceeded: r.stats.timeBudgetExceeded,
      sourceTriangles: a.geometry.index.count / 3,
      targetTriangles: b.geometry.index.count / 3,
      sourceComponents: a.connectivity ? a.connectivity.componentCount : null,
      targetComponents: b.connectivity ? b.connectivity.componentCount : null,
    });
  }
  return records;
}
`;

// ---------------------------------------------------------------------------------------------
// I4 -- Task B'.3, case (e): an aggregate pass over ONE MILLION top-level orientForCrossing
// decisions, measuring per-pair orientation AND digest cost end to end (design doc §9.4's scope
// row, finding #7: "measure per-pair orientation cost in aggregate rather than declaring it
// negligible from operation counts"). Families (a)-(d) are already covered by the existing I1/I2/I3
// catalogue above; only (e) had no prior implementation (Step 0 of this task's own investigation).
//
// Two phases, reported separately, per an independent codex-advisor review of this design:
//   1. `buildMs` -- construct a small, deliberately RANK-STRATIFIED pool of `testInstance()`
//      Instances. Each `testInstance()` call is exactly one `ThreeMeshBvhBackend.build()` call,
//      which computes `geometryDigest` unconditionally and exactly once (ThreeMeshBvhBackend.js:106,
//      no internal cache) -- so `poolSize` here IS the digest-computation count for this pass, a
//      fact read directly off the source, not instrumented separately.
//   2. `orientationMs` -- N = 1,000,000 top-level `orientForCrossing(a, b)` calls (the same
//      production preamble VolumeOverlapQuery.js's canonicalSecondToFirst performs, copied
//      verbatim from MEASURE_SYNTHETIC above), CYCLING a precomputed pair schedule built from that
//      same small pool -- i.e. reusing the already-computed digests across all N pair decisions,
//      exactly as GeometryRegistry's single-flight build cache does across many real candidate
//      pairs in production.
// `amortizedEndToEndNs = (buildMs + orientationMs) * 1e6 / N` is therefore a genuine end-to-end
// per-pair cost INCLUSIVE of the (amortized) digest-construction cost, not orientation cost alone.
//
// The pool deliberately forces pairs at every orientForCrossing rank (1, 2, 4, 5, 6) using the same
// constructions `test/query/orientForCrossing.test.mjs` already validates at the unit level (rank 4's
// matrix-element-12 translation trick, rank 6's byte-identical-geometry digest tie). Rank 3 (triangle
// count tie, vertex count differs) has no natural low-effort construction from this repo's existing
// fixture helpers and was NOT deliberately forced -- its observed count below may be 0; this is a
// disclosed limitation, not an oversight.
const MEASURE_AGGREGATE_ORIENTATION = /* js */ `
async () => {
  const { box, at, subdividedBox, testInstance, THREE } = window.__fx;
  const { orientForCrossing } = window.__orient;

  const rot = (r) => new THREE.Matrix4().makeRotationY(r);
  // Reverses the raw index array's TRIANGLE order (not per-triangle winding) before weld().
  // weld()'s mergeVertices dedups by scanning the POSITION attribute directly (order-independent
  // of the index), so the deduped position array is byte-identical either way -- but the remapped
  // INDEX byte array preserves whatever traversal order it was given, so this changes
  // geometryDigest (which hashes position+index bytes) while leaving triangle count, vertex count
  // and the bounding-box diagonal all unchanged. Exists solely to construct a genuine rank-5 pair
  // (geometryDigest tie-break) below -- same triangle SET, different byte layout.
  const reindexedBox = (w, h, d) => {
    const g = box(w, h, d);
    const idx = g.index.array;
    const triCount = idx.length / 3;
    const out = new idx.constructor(idx.length);
    for (let t = 0; t < triCount; t++) {
      const src = (triCount - 1 - t) * 3;
      out[t * 3] = idx[src]; out[t * 3 + 1] = idx[src + 1]; out[t * 3 + 2] = idx[src + 2];
    }
    g.setIndex(new THREE.BufferAttribute(out, 1));
    return g;
  };

  const buildT0 = performance.now();
  const pool = []; // { name, inst }
  const tag = (name, inst) => { pool.push({ name, inst }); };

  // Rank 1 stratum: ten distinct world diagonals (varying box size, identity matrix).
  for (const size of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]) {
    tag('rank1-size-' + size, testInstance(box(size, size, size)));
  }
  // Rank 2 stratum: subdividedBox's OWN documented purpose (test/fixtures/geometry.mjs:20-22,
  // "used by tests that need a NATURAL... e.g. rank 2 (triangle count)") -- same bounding box
  // (size=4, so identical world diagonal), five different tessellations (different triangle AND
  // vertex counts), identity matrix.
  for (const segments of [1, 2, 4, 6, 9]) {
    tag('rank2-subdividedBox4-seg' + segments, testInstance(subdividedBox(4, 4, 4, segments)));
  }
  // Rank 4 stratum: the SAME geometry object, built into five SEPARATE Instances at different
  // rigid transforms. stretch(matrix) (geometryScale.js) reads only the 3x3 linear part, so pure
  // translation and pure rotation both leave worldDiagonal unchanged; triangle/vertex counts and
  // geometryDigest are identical (same geometry); only raw matrix elements differ -- every pair
  // drawn from this stratum resolves at rank 4, never reaching digest comparison.
  const rank4Geometry = box(6, 6, 6);
  tag('rank4-identity', testInstance(rank4Geometry));
  tag('rank4-translated', testInstance(rank4Geometry, at(37, -11, 4)));
  tag('rank4-rotated', testInstance(rank4Geometry, rot(Math.PI / 3)));
  tag('rank4-rotated-translated', testInstance(rank4Geometry, rot(1.7).multiply(at(5, 5, 5))));
  tag('rank4-translated-2', testInstance(rank4Geometry, at(-9, 200, 0.5)));
  // Rank 5 stratum: identical bounding-box diagonal, triangle count, vertex count and (identity)
  // matrix, but DIFFERENT geometryDigest (reindexedBox's index-order permutation above).
  tag('rank5-box7-a', testInstance(box(7, 7, 7)));
  tag('rank5-box7-b-reindexed', testInstance(reindexedBox(7, 7, 7)));
  // Rank 6 stratum: two SEPARATELY-BUILT Instances from byte-identical geometry construction
  // (box() is a pure, deterministic function of its arguments) at the identical (identity) matrix
  // -- every rank ties, including digest, so orientForCrossing must fall through to its declared
  // rank-6 residual (caller's public source role).
  tag('rank6-box9-a', testInstance(box(9, 9, 9)));
  tag('rank6-box9-b', testInstance(box(9, 9, 9)));

  const buildMs = performance.now() - buildT0;
  const poolSize = pool.length;

  // Precomputed pair schedule, built OUTSIDE the timed region (independent codex-advisor review:
  // no Math.random() inside the timed loop) -- every ordered (i, j), i !== j, from the pool above.
  const schedule = [];
  for (let i = 0; i < poolSize; i++) {
    for (let j = 0; j < poolSize; j++) {
      if (i !== j) schedule.push([i, j]);
    }
  }

  const N = 1_000_000; // "one million top-level orientation decisions" (design §9.4's own framing)
  const rankCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  let checksum = 0; // defeats dead-code elimination of the loop below; not itself meaningful
  const orientT0 = performance.now();
  for (let k = 0; k < N; k++) {
    const [i, j] = schedule[k % schedule.length];
    const a = pool[i].inst, b = pool[j].inst;
    // Copied verbatim from this file's own MEASURE_SYNTHETIC call above (itself copied verbatim
    // from VolumeOverlapQuery.js's production canonicalSecondToFirst, Task A2.1): the FULL
    // per-pair preamble production pays before ever calling properCrossingQuery, not
    // orientForCrossing alone.
    const { first, second, rank } = orientForCrossing(a, b);
    const relative = first.matrix.clone().invert().multiply(second.matrix);
    rankCounts[rank]++;
    checksum += rank + relative.elements[0];
  }
  const orientationMs = performance.now() - orientT0;

  return {
    poolSize, poolTags: pool.map((p) => p.name), buildMs,
    orientationN: N, orientationMs, rankCounts,
    amortizedEndToEndNs: (buildMs + orientationMs) * 1e6 / N,
    orientationOnlyNsPerCall: orientationMs * 1e6 / N,
    checksum,
  };
}
`;

// ---------------------------------------------------------------------------------------------
// I2 -- live federated Audubon fixture
// ---------------------------------------------------------------------------------------------

// §6.1 steps 1-2, copied from structure-fragment-clearance-regression.mjs:70-113 (which itself
// copies run-gate-m4.mjs's loadFixtureAndReconfirm): identical 3-step load and live
// identity re-confirmation BY URN, never by load-order/array-index.
async function loadFixtureAndReconfirm(page) {
  await page.goto(`http://localhost:${PORT}/#${ARCH_URN}`);
  await page.waitForFunction(() => window.viewer && window.viewer.model && window.viewer.model.isLoadDone(), null, { timeout: 300_000 });

  for (const urn of [STRUCTURE_URN, MECHANICAL_URN]) {
    await page.fill('#urn', urn);
    await page.check('#keep-current-models');
    await page.click('#load');
    await page.waitForFunction((n) => window.viewer.getAllModels().length === n && window.viewer.getAllModels().every((m) => m.isLoadDone()),
      urn === STRUCTURE_URN ? 2 : 3, { timeout: 300_000 });
    await page.waitForFunction(() => window.viewer.getAllModels().every((m) => m.getData() && m.getData().instanceTree), null, { timeout: 300_000 });
  }

  const identity = await page.evaluate(({ archUrn, structureUrn, mechanicalUrn }) => {
    const models = window.viewer.getAllModels();
    const modelArch = models.find((m) => m.getData()?.urn === archUrn);
    const modelStructure = models.find((m) => m.getData()?.urn === structureUrn);
    const modelMechanical = models.find((m) => m.getData()?.urn === mechanicalUrn);
    window.__gate = { modelArch, modelStructure, modelMechanical };
    return { modelCount: models.length, hasArch: !!modelArch, hasStructure: !!modelStructure, hasMechanical: !!modelMechanical };
  }, { archUrn: ARCH_URN, structureUrn: STRUCTURE_URN, mechanicalUrn: MECHANICAL_URN });

  if (identity.modelCount !== 3 || !identity.hasArch || !identity.hasStructure || !identity.hasMechanical) {
    throw new Error(`Fixture identity mismatch: ${JSON.stringify(identity)}`);
  }
  return identity;
}

// §5.4's profiling pass, unmeasured, once per runtime -- the same probe + the same pure selectors
// run-gate-m4.mjs:1316-1338 uses, so the k=100 "typical" cohort this script measures IS the gate's
// own S2[k=100:typical] cohort rather than a lookalike.
async function runCohortProfiling(page) {
  const rawProfiles = await page.evaluate(() => {
    const { modelArch, modelStructure, modelMechanical } = window.__gate;
    return window.__m4Probes.profileStructureCohortDensity([modelArch, modelStructure, modelMechanical]);
  });
  // Playwright does not preserve Set across page.evaluate -- reconstruct before anything reads it.
  const profiles = rawProfiles.map((p) => ({ ...p, fragmentIds: new Set(p.fragmentIds) }));
  const ranked = rankByDensity(profiles);
  const low = selectCohort(ranked, 0.25, S2_K);
  const typical = selectCohort(ranked, 0.5, S2_K);
  const high = selectCohort(ranked, 0.9, S2_K, { forceDbId: COHORT_SOURCE_DB_ID });
  return { profiles, typical, densityUnstratified: labelDensityUnstratified({ low, typical, high }) };
}

// One measured clearance run. The world is built with a FROZEN clock so neither wall-clock semantic
// branch in properCrossingQuery can fire (see this file's header); the recorder retains only the
// stage:'crossing' hard-clash-precheck events, whose `ms` is a real performance.now span.
async function runClearanceArm(page, { dbIds, broadPhase }) {
  return page.evaluate(async ({ dbIds, broadPhase, clearance }) => {
    const { CollisionWorld } = await import('/collision/index.js');
    const sched = await import('/collision/scheduler.js');
    const { modelArch, modelStructure, modelMechanical } = window.__gate;

    const crossingEvents = [];
    let projectionErrors = 0;
    let world = null;
    // Task B'.3 addition: count 'bvh-construction' spans -- the EXISTING, production
    // `setSpanRecorder` hook (scheduler.js, Task 23's diagnostic seam, "an external harness
    // cannot otherwise observe internal synchronous spans"). GeometryRegistry._chainAcceleration
    // reports exactly this label once per `_buildAcceleration` call
    // (collision/geometry/GeometryRegistry.js:229-231), and `_buildAcceleration` is what calls
    // ThreeMeshBvhBackend.build(), which computes `geometryDigest` unconditionally and
    // exactly once per call (ThreeMeshBvhBackend.js:106). So this count IS the digest-computation
    // count for this run, read off an existing production instrumentation point -- no library
    // change, no private-field reach-in.
    let bvhConstructionSpanCount = 0;
    const t0 = performance.now();
    try {
      // Non-throwing projection callback: it runs INSIDE library code via reportDiagnosticEvent,
      // which has no guard of its own, so a throw here would corrupt the very run being measured
      // (design §12.1 item 2).
      sched.setDiagnosticEventRecorder((kind, payload) => {
        try {
          if (kind === 'hard-clash-precheck' && payload.stage === 'crossing') {
            crossingEvents.push({
              sourceEpoch: payload.sourceEpoch, sourceFragmentId: payload.sourceFragmentId,
              targetEpoch: payload.targetEpoch, targetFragmentId: payload.targetFragmentId,
              ms: payload.ms,
              pointClassifications: payload.pointClassifications,
              // Phase C additions. Phase B ran with only `pointClassifications` observable on this
              // live path and declared that as deviation #2 (§14.2 asks for ALL THREE counters per
              // traversal); the library change that closes it landed in Phase C. Projecting them
              // here is what actually closes the loop -- an independent codex-review of the Phase C
              // diff pointed out that emitting the fields while the consumer drops them leaves the
              // evidence gap exactly where it was. Any FUTURE re-run of this calibration therefore
              // records cap usage and cap exhaustion for all three budgets, not just one.
              candidatePairsExamined: payload.candidatePairsExamined,
              crossingPairsExamined: payload.crossingPairsExamined,
              exhaustedBudget: payload.exhaustedBudget,
              crossingElapsedMs: payload.crossingElapsedMs,
              timeBudgetExceeded: payload.timeBudgetExceeded,
              sourceTriangles: payload.sourceTriangles, targetTriangles: payload.targetTriangles,
              sourceComponents: payload.sourceComponents, targetComponents: payload.targetComponents,
              // Task B'.3 additions: Task A2.4's own C-4 orientation-provenance telemetry already
              // rides this exact event (VolumeOverlapQuery.js:178-182) -- it was simply never
              // projected here before. This is the real-model orientation-rank distribution for
              // family (b), not a synthetic proxy for it.
              orientedFirstRole: payload.orientedFirstRole, orientationRank: payload.orientationRank,
              sourceWorldDiagonal: payload.sourceWorldDiagonal, targetWorldDiagonal: payload.targetWorldDiagonal,
            });
          }
        } catch { projectionErrors++; }
      });
      sched.setSpanRecorder((label) => { if (label === 'bvh-construction') bvhConstructionSpanCount++; });

      // §14.1's wall-clock neutralization for the live path: a frozen `_now` makes
      // `now() - traversalStart` identically 0, so neither semantic branch can fire.
      world = await CollisionWorld.fromViewer(window.viewer, { now: () => 0 });
      // Task B'.3: capture the per-model lease -- each admitModel call mints its OWN loadEpoch
      // (CollisionWorld.js:716), so this run has three epochs, not one. Leases are the only route
      // to those epoch ids (admitModel returns them; nothing else exposes the mapping) and are
      // exactly what the stable, PUBLIC `world.getEpochGeometryDiagnostics(epoch)` accessor
      // (Task 1.6) needs below -- no reach into `world._registry` at all.
      const leaseArch = world.admitModel(modelArch);
      const leaseStructure = world.admitModel(modelStructure);
      const leaseMechanical = world.admitModel(modelMechanical);

      const targets = window.viewer.getAllModels().map((m) => ({ model: m }));
      const result = await world.findClashes({
        mode: 'clearance', clearance,
        source: { model: modelStructure, dbIds },
        target: { targets },
        groupBy: 'dbId',
        broadPhase,
      });

      // Task B'.3: geometry-lifecycle cross-check, read BEFORE dispose() (which releases every
      // entry). One summary array per admitted model's epoch, via the stable public accessor.
      const geometryEntries = [leaseArch, leaseStructure, leaseMechanical]
        .flatMap((lease) => world.getEpochGeometryDiagnostics(lease.epoch));
      const readyGeometryCount = geometryEntries.filter((e) => e.buildState === 'ready').length;
      const oversizedGeometryCount = geometryEntries.filter((e) => e.buildState === 'oversized').length;
      const buildingGeometryCount = geometryEntries.filter((e) => e.buildState === 'building').length;

      return {
        wallMs: performance.now() - t0,
        pairCount: result.pairs.length,
        statistics: {
          clearanceHardClashExclusions: result.statistics.clearanceHardClashExclusions,
          clearanceOverlapPrechecksRun: result.statistics.clearanceOverlapPrechecksRun,
          clearanceNarrowPhasePairs: result.statistics.clearanceNarrowPhasePairs,
          diagnosticCount: result.statistics.diagnostics.length,
          inconclusiveDiagnostics: result.statistics.diagnostics.filter((d) => d.reason === 'clearance-hard-clash-precheck-inconclusive').length,
        },
        crossingEvents, projectionErrors,
        bvhConstructionSpanCount, readyGeometryCount, oversizedGeometryCount, buildingGeometryCount,
      };
    } finally {
      // §12.1 item 1: unconditional cleanup, so no failure can leave the module-global recorder
      // installed and silently contaminate every later run in this page.
      sched.clearDiagnosticEventRecorder();
      sched.clearSpanRecorder();
      if (world) world.dispose();
    }
  }, { dbIds, broadPhase, clearance: CLEARANCE });
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
  // §14.3 requires "the Phase-A commit SHA it was measured against". Phase A is NOT committed in
  // this working tree (the task forbade committing), so the measured implementation is identified
  // instead by the base HEAD SHA plus a content hash of every file Phase A touched. That is a
  // DECLARED DEVIATION, recorded here and in the output document rather than papered over.
  const phaseAFiles = [
    'collision/constants.js',
    'collision/query/ProperCrossingQuery.js',
    'collision/query/VolumeOverlapQuery.js',
    'collision/README.md',
    'test/query/ProperCrossingQuery.instrumentation.test.mjs',
  ];
  const phaseAFileHashes = {};
  for (const f of phaseAFiles) {
    phaseAFileHashes[f] = createHash('sha256').update(await readFile(f)).digest('hex');
  }

  const ping = await fetch(`http://localhost:${PORT}/`).catch((err) => {
    throw new Error(`LIVE INFRASTRUCTURE FAILURE: dev server at localhost:${PORT} unreachable: ${err.message}`);
  });
  if (ping.status !== 200) throw new Error(`LIVE INFRASTRUCTURE FAILURE: dev server returned HTTP ${ping.status}`);

  const report = {
    startedAt: new Date().toISOString(),
    baseCommitSha: commitSha,
    phaseAFileHashes,
    workingTreeDirty: dirty.length > 0,
    workingTreeDirtyFiles: dirty ? dirty.split('\n') : [],
    inputs: args.inputs, tiers: args.tiers, repetitions: args.repetitions, i2Repetitions: args.i2Repetitions,
    tierReports: {},
  };

  for (const tierKey of args.tiers) {
    const runtime = RUNTIME_CONFIGS[tierKey];
    if (!runtime) throw new Error(`unknown tier ${tierKey}`);
    console.log(`\n=== TIER ${runtime.label} (${runtime.args.join(' ')}) ===`);
    const tierReport = { label: runtime.label, args: runtime.args, authoritative: runtime.authoritative, records: [], i2: [], notes: [] };
    report.tierReports[tierKey] = tierReport;

    const browser = await chromium.launch({ args: runtime.args, proxy: resolveProxyFromEnv() });
    try {
      tierReport.chromiumVersion = browser.version();
      const page = await browser.newPage();
      const consoleWarnings = [];
      page.on('console', (m) => { if (/error/i.test(m.type())) consoleWarnings.push(m.text().slice(0, 200)); });
      tierReport.consoleErrors = consoleWarnings;

      const wantsLive = args.inputs.includes('I2');
      if (wantsLive) {
        tierReport.identity = await loadFixtureAndReconfirm(page);
        console.log('Fixture identity re-confirmed:', JSON.stringify(tierReport.identity));
        await page.addScriptTag({ path: 'test/performance/browser-probes-m4.mjs' });
      } else {
        await page.goto(`http://localhost:${PORT}/`);
        await page.waitForFunction(() => !!window.THREE || true);
      }
      await installFixtureModule(page);
      tierReport.maxCrossingPointClassifications = await page.evaluate(() => window.__consts.maxCrossingPointClassifications);

      // --- I1 / I3: cold first, then warm repetitions ------------------------------------------
      const syntheticClasses = args.inputs.filter((c) => c === 'I1' || c === 'I3');
      if (syntheticClasses.length) {
        for (let rep = 0; rep < args.repetitions; rep++) {
          const state = rep === 0 ? 'cold' : 'warm';
          // §5.6's counterbalancing rule applied to the input-class dimension.
          const classes = caseOrderForRepetition(syntheticClasses, rep);
          const recs = await page.evaluate(`(${MEASURE_SYNTHETIC})(${JSON.stringify({ repetition: rep, state, classes })})`);
          tierReport.records.push(...recs);
          const worst = recs.reduce((m, r) => Math.max(m, r.spanMs ?? 0), 0);
          console.log(`  [${runtime.label}] synthetic rep ${rep} (${state}): ${recs.length} traversals, worst span ${worst.toFixed(3)} ms`);
        }
      }

      // --- I4: case (e), the aggregate million-pair orientation+digest pass --------------------
      // Run once per tier (a fixed synthetic measurement, not part of the counterbalanced
      // cold/warm repetition schedule -- there is nothing to warm up across repetitions here).
      if (args.inputs.includes('I4')) {
        const agg = await page.evaluate(`(${MEASURE_AGGREGATE_ORIENTATION})()`);
        tierReport.aggregateOrientation = agg;
        console.log(`  [${runtime.label}] I4 aggregate: pool ${agg.poolSize} (buildMs ${agg.buildMs.toFixed(3)}), `
          + `${agg.orientationN.toLocaleString()} orientForCrossing calls in ${agg.orientationMs.toFixed(1)} ms `
          + `(${agg.orientationOnlyNsPerCall.toFixed(1)} ns/call), ranks ${JSON.stringify(agg.rankCounts)}`);
      }

      // --- I2: the live Audubon inputs ----------------------------------------------------------
      if (wantsLive) {
        const { profiles, typical, densityUnstratified } = await runCohortProfiling(page);
        tierReport.cohort = {
          profiledDbIdCount: profiles.length,
          status: typical.status, achievedInstances: typical.achievedInstances,
          requestedDbIdCount: typical.requestedDbIds?.length ?? 0,
          requestedDbIds: typical.requestedDbIds, weightedDensity: typical.weightedDensity,
          densityUnstratified,
        };
        console.log('  cohort profiling:', JSON.stringify({ profiled: profiles.length, status: typical.status, achieved: typical.achievedInstances }));
        if (typical.status !== 'OK') {
          tierReport.notes.push(`S2 k=${S2_K} typical cohort NOT EXERCISED (status=${typical.status}, achieved=${typical.achievedInstances})`);
        }

        const i2Variants = [
          { key: 'failing-pair-source', dbIds: [FAILING_SOURCE_DB_ID] },
          ...(typical.status === 'OK' ? [{ key: `S2[k=${S2_K}:typical:clearance]`, dbIds: typical.requestedDbIds }] : []),
          // Task B'.3 fix (codex-advisor review caught this: the harness computed a HIGH cohort
          // forcing dbId COHORT_SOURCE_DB_ID (3076, the Effect-B-investigated class-B pair's
          // source, structure frag 537 -> frag 427) into it, but never actually QUERIED that
          // dbId -- only `typical` was ever measured. A forced-into-a-cohort dbId is not the same
          // as a measured one. This variant queries it directly, alone, exactly mirroring
          // `failing-pair-source`'s own pattern and the Effect-B investigation's own query shape
          // (docs/research/m4-effect-b-precheck-diagnostic-nondeterminism-investigation.md:164,
          // "source: Structure dbId 3076") -- so family (b)'s "pinned Effect B pairs" claim is
          // backed by an actual measured traversal, not merely a "reachable via the same cohort
          // machinery" claim.
          { key: 'effect-b-pinned-source', dbIds: [COHORT_SOURCE_DB_ID] },
        ];
        for (let rep = 0; rep < args.i2Repetitions; rep++) {
          const state = rep === 0 ? 'cold' : 'warm';
          for (const broadPhase of armOrderForRepetition(rep)) {
            for (const variant of i2Variants) {
              const t0 = Date.now();
              const r = await runClearanceArm(page, { dbIds: variant.dbIds, broadPhase });
              tierReport.i2.push({ variant: variant.key, broadPhase, repetition: rep, state, ...r });
              const worst = r.crossingEvents.reduce((m, e) => Math.max(m, e.ms ?? 0), 0);
              console.log(`  [${runtime.label}] I2 ${variant.key} ${broadPhase} rep ${rep} (${state}): `
                + `${r.crossingEvents.length} crossing traversals, worst ${worst.toFixed(3)} ms, `
                + `exclusions ${r.statistics.clearanceHardClashExclusions}, ${(Date.now() - t0) / 1000 | 0}s`);
            }
          }
        }
      }
    } catch (err) {
      tierReport.fatalError = String(err && err.stack || err);
      console.error(`TIER ${runtime.label} FAILED:`, err);
    } finally {
      await browser.close();
    }
  }

  report.finishedAt = new Date().toISOString();
  await mkdir(RESULTS_DIR, { recursive: true });
  const out = `${RESULTS_DIR}/proper-crossing-budget-calibration-${Date.now()}.json`;
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(`\nWrote ${out}`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
