// test/performance/m4/arm-order-independence.mjs
//
// Task C3b (canonical-ordering/operand-symmetry fix implementation plan, Phase C):
// docs/superpowers/specs/2026-09-11-proper-crossing-query-deterministic-budget-fix-design.md
// §13 B ("Pair-order independence") -- the ARM-ORDER half.
//
// §13 B's full text (design doc :948-955): "Same exact operands, varying only predecessor/candidate
// order: both arm orders (tlas>linear, linear>tlas), both broad phases, and a direct
// volumeOverlapQuery unit call with the operands preceded by different warm-up work. Assert
// identical: precheck disposition, conclusive, inconclusiveCauses, containmentSamplesUsed, all three
// crossing counters, and exhaustedBudget."
//
// That sentence packs two DIFFERENT axes under one heading:
//  (1) the predecessor/warm-up axis, on FIXED source/target operands and a FIXED (implicit) broad
//      phase -- already landed at test/query/ProperCrossingQuery.deterministic.test.mjs:131-188 as
//      a `node --test` unit suite (direct `volumeOverlapQuery`/`properCrossingQuery` calls have no
//      "arm" at all -- confirmed by inspection of both files, see that file's own header :20-28).
//  (2) the ARM-ORDER axis -- which of the two `CollisionWorld.findClashes` broad phases runs FIRST
//      in a live session, `tlas>linear` vs `linear>tlas` -- which that same file's header explicitly
//      declares OUT OF SCOPE and live-gate-only, because `broadPhase` is exclusively a
//      `CollisionWorld.findClashes` option; a direct `properCrossingQuery`/`volumeOverlapQuery` call
//      has no arm to hold fixed or vary in the first place.
//
// This script closes axis (2) only -- the one piece of §13 B with no test anywhere else in this
// plan. It does NOT re-cover axis (1) (already unit-tested) and deliberately does not swap the
// public source/target roles (ProperCrossingQuery.deterministic.test.mjs's header already explains,
// and this script agrees, why a source/target swap is a different, NOT-promised-invariant axis).
//
// Method. One CollisionWorld, admitting the same 3 real federated models, drives the SAME exact real
// operand pair (the §13 A failing pair: structure:3547/frag363 -> architecture:3551/frag30 -- reused
// here directly rather than inventing a new fixture, per this task's own instruction to check for an
// existing arm-comparison idiom first; this exact pair/URN set is already this repo's established
// arm-comparison fixture, e.g. test/performance/m4/hard-clash-precheck-blocker-reload.mjs, which
// already runs BOTH broad phases -- always in the same tlas-then-linear position -- per page load)
// through BOTH broad phases, in one of two orders, within the SAME live session (no reload between
// the two `findClashes` calls of one order -- an established, tested pattern:
// test/CollisionWorld.findClashes.clearance.test.mjs:309-310 already calls `world.findClashes`
// twice, `linear` then `tlas`, on the very same world instance).
//
// Fix round 1 (codex-advisor review, request 20260911-230627-99280-14872, on the first draft):
//  - The first draft additionally drove a DIRECT `volumeOverlapQuery` replay after each arm, on the
//    theory that CollisionWorld's own diagnostic surface never carries the three crossing counters
//    or `exhaustedBudget` (a search of CollisionWorld.js alone found no such field names). Codex
//    found this premise wrong: VolumeOverlapQuery.js's own `stage: 'crossing'` hard-clash-precheck
//    event (VolumeOverlapQuery.js:151-185) DOES carry `candidatePairsExamined`,
//    `crossingPairsExamined`, `pointClassifications`, and `exhaustedBudget` directly -- and
//    `CollisionWorld._runClearanceNarrowPhasePair` DOES pass `diagnosticPairContext` into that exact
//    call whenever a recorder is installed (CollisionWorld.js:2403-2414), which this script's
//    `setDiagnosticEventRecorder` call already guarantees. This script's own event recorder was
//    already capturing this event (it records every `hard-clash-precheck` event regardless of
//    `stage`) -- the first draft simply never read the `stage: 'crossing'` entries it was already
//    collecting. The direct replay is removed entirely: every field §13 B requires is now read from
//    the SAME production `findClashes` call's own diagnostic events, closing codex's concern that a
//    separate direct call "is not an arm result" and could mask or manufacture session-history
//    behavior of its own.
//  - The first draft also silently discarded its own `deriveDisposition` return value (disposition
//    was computed but never asserted) and only compared each arm against ITSELF across the two
//    orders (tlas-vs-tlas, linear-vs-linear) -- never checking that `tlas` and `linear` agree with
//    EACH OTHER on the very same pair. Both fixed below: `deriveDisposition` reuses
//    hard-clash-precheck-blocker-reload.mjs's own exhaustive, fail-loud three-way classification
//    (excluded / proceed / inconclusive, never a silent default), and `assertCellMatches` runs three
//    labeled pairwise comparisons that together pin all four (order, arm) cells to one identical
//    projection: order-invariance for `tlas` between the two orders, order-invariance for `linear`
//    between the two orders, and arm-parity between `tlas` and `linear` within one order (the third
//    comparison is transitively sufficient to prove all four cells agree, and keeping the three
//    comparisons separate rather than one opaque fingerprint-set check gives a precise, immediately
//    diagnosable failure message naming exactly which axis diverged).
//
// The two orders run in SEPARATE page loads (fresh `page.reload()` + `loadFixtureAndReconfirm`,
// mirroring hard-clash-precheck-blocker-reload.mjs's own established reload idiom) rather than one
// continuous page -- deliberately, so each order-run is a fair, isolated trial and a divergence can
// be attributed to arm ORDER alone, not to extra accumulated cross-order session history (confirmed
// sound by codex-advisor review: "Each order should start from equivalent clean state, while the two
// arms within that order must share one world. That isolates the independent variable: which arm ran
// first."). Per order, this script asserts nothing about repeat-count stability (already covered
// elsewhere in this plan -- C2 covers reload/repeat stability at a FIXED arm order, C3 covers
// same-call repeat stability at the kernel/wrapper level) -- its unique job is proving the ORDER (and,
// as strengthened above, ARM-CHOICE) axis alone doesn't matter for this exact pair, so one clean
// two-order comparison is the right scope, not an N>=10 repeat loop.
//
// File placement: a new, small, self-contained sibling script under test/performance/m4/, NOT an
// edit to test/performance/run-gate-m4.mjs (which the task brief's own "Files" section names as the
// default target). Two earlier tasks in this same plan (C2, A4.2) already made and had approved this
// exact judgment call for the same reason: run-gate-m4.mjs's own scoped subset still inherits its
// full multi-hour matrix/cohort-profiling/heap-CDP-instrumentation/two-runtime/worker-spike
// machinery, unrelated overhead for pinning one exact pair's arm-order behavior. Everything this
// script actually needs from run-gate-m4.mjs -- the URNs, `loadFixtureAndReconfirm`'s 3-model load
// discipline, the `broadPhase` option itself, the `setDiagnosticEventRecorder` seam -- is already
// duplicated into this directory's other siblings (verbatim in hard-clash-precheck-blocker-reload.mjs,
// which this script's fixture/precheck-observability code is adapted from directly), so following the
// same precedent keeps this change small and scoped without losing any of that reuse.
//
// Not a `node --test` file (same convention as every sibling in this directory). Run directly, with
// the dev server already running on PORT (default 8080; `npm start`):
//
//   node test/performance/m4/arm-order-independence.mjs

import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// URNs copied verbatim from test/performance/run-gate-m4.mjs / hard-clash-precheck-blocker-reload.mjs
// -- the same real 3-discipline federated Revit host+links Audubon package every M1-M4 gate uses.
const ARCH_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fQXJjaGl0ZWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const STRUCTURE_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fU3RydWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const MECHANICAL_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fTWVjaGFuaWNhbF9jbGFzaF90ZXN0LnJ2dA';
const PORT = process.env.PORT || 8080;
const RESULTS_DIR = 'test/performance/results';

// Same real failing pair as §13 A / hard-clash-precheck-blocker-reload.mjs.
const SOURCE_DB_ID = 3547;        // Structure model
const TARGET_DB_ID = 3551;        // Architecture model
const SOURCE_FRAGMENT_ID = 363;
const TARGET_FRAGMENT_ID = 30;
const CLEARANCE = 0.05;           // DEFAULT_CLEARANCE, same as run-gate-m4.mjs

const ORDERS = [
  ['tlas', 'linear'],
  ['linear', 'tlas'],
];

// §6.1 steps 1-2, copied verbatim from hard-clash-precheck-blocker-reload.mjs's own
// loadFixtureAndReconfirm (itself adapted from run-gate-m4.mjs) -- identical 3-step load plus live
// identity re-confirmation by URN AND exact fragment ownership (never by load-order/array-index
// alone, and never assumed stable across reloads without re-checking).
async function loadFixtureAndReconfirm(page) {
  await page.goto(`http://localhost:${PORT}/#${ARCH_URN}`);
  await page.waitForFunction(() => window.viewer && window.viewer.model && window.viewer.model.isLoadDone(), null, { timeout: 180_000 });

  await page.fill('#urn', STRUCTURE_URN);
  await page.check('#keep-current-models');
  await page.click('#load');
  await page.waitForFunction(() => window.viewer.getAllModels().length === 2 && window.viewer.getAllModels().every((m) => m.isLoadDone()), null, { timeout: 180_000 });
  await page.waitForFunction(() => window.viewer.getAllModels().every((m) => m.getData() && m.getData().instanceTree), null, { timeout: 180_000 });

  await page.fill('#urn', MECHANICAL_URN);
  await page.check('#keep-current-models');
  await page.click('#load');
  await page.waitForFunction(() => window.viewer.getAllModels().length === 3 && window.viewer.getAllModels().every((m) => m.isLoadDone()), null, { timeout: 180_000 });
  await page.waitForFunction(() => window.viewer.getAllModels().every((m) => m.getData() && m.getData().instanceTree), null, { timeout: 180_000 });

  const identity = await page.evaluate(({ sourceDbId, targetDbId, archUrn, structureUrn, mechanicalUrn }) => {
    const models = window.viewer.getAllModels();
    const modelArch = models.find((m) => m.getData()?.urn === archUrn);
    const modelStructure = models.find((m) => m.getData()?.urn === structureUrn);
    const modelMechanical = models.find((m) => m.getData()?.urn === mechanicalUrn);
    window.__gate = { modelArch, modelStructure, modelMechanical };

    const sourceFragmentIds = [];
    if (modelStructure) {
      modelStructure.getInstanceTree().enumNodeFragments(sourceDbId, (fragId) => { sourceFragmentIds.push(fragId); }, false);
    }
    const targetFragmentIds = [];
    if (modelArch) {
      modelArch.getInstanceTree().enumNodeFragments(targetDbId, (fragId) => { targetFragmentIds.push(fragId); }, false);
    }
    return {
      modelCount: models.length,
      hasArch: !!modelArch, hasStructure: !!modelStructure, hasMechanical: !!modelMechanical,
      sourceFragmentIds, targetFragmentIds,
    };
  }, { sourceDbId: SOURCE_DB_ID, targetDbId: TARGET_DB_ID, archUrn: ARCH_URN, structureUrn: STRUCTURE_URN, mechanicalUrn: MECHANICAL_URN });

  if (identity.modelCount !== 3) throw new Error(`Expected exactly 3 loaded models, got ${identity.modelCount}`);
  if (!identity.hasArch || !identity.hasStructure || !identity.hasMechanical) {
    throw new Error(`Fixture identity mismatch: could not resolve all three discipline models by URN (hasArch=${identity.hasArch}, hasStructure=${identity.hasStructure}, hasMechanical=${identity.hasMechanical})`);
  }
  if (!identity.sourceFragmentIds.includes(SOURCE_FRAGMENT_ID)) {
    throw new Error(`Fixture identity mismatch: Structure dbId ${SOURCE_DB_ID} does not own fragment ${SOURCE_FRAGMENT_ID} (owns: [${identity.sourceFragmentIds.join(',')}])`);
  }
  if (!identity.targetFragmentIds.includes(TARGET_FRAGMENT_ID)) {
    throw new Error(`Fixture identity mismatch: Architecture dbId ${TARGET_DB_ID} does not own fragment ${TARGET_FRAGMENT_ID} (owns: [${identity.targetFragmentIds.join(',')}])`);
  }
  return identity;
}

// One CollisionWorld for the whole `order` -- both `findClashes` arm calls share it (the established,
// tested pattern: test/CollisionWorld.findClashes.clearance.test.mjs:309-310). Reads the FULL field
// set §13 B requires directly off the two production `hard-clash-precheck` diagnostic events each
// arm's call already emits -- `stage: 'volume-overlap-query'` (ClearanceHardClashPrecheck.js:32-37,
// carries `conclusive`/`inconclusiveCauses`/`containmentSamplesUsed`) and `stage: 'crossing'`
// (VolumeOverlapQuery.js:151-185, carries the three crossing counters + `exhaustedBudget`) -- plus
// `clearance-distance-query` events and `result.statistics.diagnostics`, exactly the three-signal
// disposition-derivation surface hard-clash-precheck-blocker-reload.mjs already established. No
// direct `volumeOverlapQuery` replay anywhere here (removed per codex-advisor review, see file
// header) -- everything below is the real production `findClashes` call's own telemetry.
async function runOrderPass(page, order) {
  return page.evaluate(async ({ order, sourceDbId, targetDbId, sourceFragId, targetFragId, clearance }) => {
    const { CollisionWorld } = await import('/collision/index.js');
    const sched = await import('/collision/scheduler.js');
    const { modelArch, modelStructure, modelMechanical } = window.__gate;

    const hardClashEvents = [];
    const distanceEvents = [];
    sched.setDiagnosticEventRecorder((kind, payload) => {
      if (kind === 'hard-clash-precheck') hardClashEvents.push(payload);
      else if (kind === 'clearance-distance-query') distanceEvents.push(payload);
    });

    const perArm = {};
    let world = null;
    try {
      world = await CollisionWorld.fromViewer(window.viewer);
      const archLease = world.admitModel(modelArch);
      const structureLease = world.admitModel(modelStructure);
      world.admitModel(modelMechanical);

      const matchesEventPair = (e) => (
        e.sourceEpoch === structureLease.epoch && e.sourceFragmentId === sourceFragId
        && e.targetEpoch === archLease.epoch && e.targetFragmentId === targetFragId
      );

      for (const broadPhase of order) {
        const beforeHardClash = hardClashEvents.length;
        const beforeDistance = distanceEvents.length;
        const result = await world.findClashes({
          mode: 'clearance',
          clearance,
          source: { model: modelStructure, dbIds: [sourceDbId] },
          target: { targets: [{ model: modelArch }, { model: modelStructure }, { model: modelMechanical }] },
          groupBy: 'dbId',
          broadPhase,
        });
        // Scope to events raised by THIS arm's findClashes call only (never the whole session's
        // accumulated log) -- otherwise a later arm's events would double-count against an earlier
        // arm's already-recorded ones.
        const newHardClashEvents = hardClashEvents.slice(beforeHardClash);
        const newDistanceEvents = distanceEvents.slice(beforeDistance);

        const volumeOverlapEvents = newHardClashEvents.filter((e) => e.stage === 'volume-overlap-query' && matchesEventPair(e));
        const crossingEvents = newHardClashEvents.filter((e) => e.stage === 'crossing' && matchesEventPair(e));
        const notRunEvents = newHardClashEvents.filter((e) => e.stage === 'not-run' && matchesEventPair(e));
        const distanceMatches = newDistanceEvents.filter(matchesEventPair);
        const inconclusiveDiagnostics = (result.statistics.diagnostics || []).filter((d) => (
          d.reason === 'clearance-hard-clash-precheck-inconclusive'
          && d.sourceFragment?.modelId === modelStructure.id && d.sourceFragment?.dbId === sourceDbId && d.sourceFragment?.fragId === sourceFragId
          && d.targetFragment?.modelId === modelArch.id && d.targetFragment?.dbId === targetDbId && d.targetFragment?.fragId === targetFragId
        ));

        perArm[broadPhase] = {
          pairFoundInResult: result.pairs.some((p) => p.source.dbId === sourceDbId && p.target.dbId === targetDbId),
          volumeOverlapEventCount: volumeOverlapEvents.length,
          crossingEventCount: crossingEvents.length,
          notRunEventCount: notRunEvents.length,
          notRunReasons: notRunEvents.map((e) => e.precheckNotRunReason),
          distanceEventCount: distanceMatches.length,
          inconclusiveDiagnosticCount: inconclusiveDiagnostics.length,
          conclusive: volumeOverlapEvents[0]?.conclusive ?? null,
          inconclusiveCauses: volumeOverlapEvents[0] ? [...(volumeOverlapEvents[0].inconclusiveCauses ?? [])].sort() : null,
          containmentSamplesUsed: volumeOverlapEvents[0]?.containmentSamplesUsed ?? null,
          candidatePairsExamined: crossingEvents[0]?.candidatePairsExamined ?? null,
          crossingPairsExamined: crossingEvents[0]?.crossingPairsExamined ?? null,
          pointClassifications: crossingEvents[0]?.pointClassifications ?? null,
          exhaustedBudget: crossingEvents[0]?.exhaustedBudget ?? null,
        };
      }
    } finally {
      sched.clearDiagnosticEventRecorder();
      if (world) world.dispose();
    }
    return perArm;
  }, { order, sourceDbId: SOURCE_DB_ID, targetDbId: TARGET_DB_ID, sourceFragId: SOURCE_FRAGMENT_ID, targetFragId: TARGET_FRAGMENT_ID, clearance: CLEARANCE });
}

// Exhaustive, fail-loud three-way classification -- same discipline as
// hard-clash-precheck-blocker-reload.mjs's own `deriveDisposition` (an instrumentation gap must fail
// loudly, never silently default to a disposition). Strengthened here to also require exactly one
// `crossing`-stage event (this script's own extra dependency for the three counters/exhaustedBudget).
function deriveDisposition(obs, label) {
  const problems = [];
  if (!obs.pairFoundInResult && obs.volumeOverlapEventCount === 0 && obs.notRunEventCount === 0) {
    problems.push('the pair was not observed at all (not in result.pairs, no hard-clash-precheck event of any stage) -- broad-phase never generated this candidate');
  }
  if (obs.notRunEventCount > 0) {
    problems.push(`precheck reported ${obs.notRunEventCount} 'not-run' event(s) (reasons: ${obs.notRunReasons.join(', ')}) -- the pair never reached classifyHardClashPrecheck's volumeOverlapQuery call`);
  }
  if (obs.volumeOverlapEventCount !== 1) {
    problems.push(`expected exactly 1 'volume-overlap-query' hard-clash-precheck event, got ${obs.volumeOverlapEventCount}`);
  }
  if (obs.crossingEventCount !== 1) {
    problems.push(`expected exactly 1 'crossing' hard-clash-precheck event, got ${obs.crossingEventCount}`);
  }
  if (problems.length) {
    throw new Error(`[${label}] instrumentation/observability problem: ${problems.join('; ')}`);
  }

  const isInconclusive = obs.inconclusiveDiagnosticCount > 0;
  const isProceed = obs.distanceEventCount > 0;
  if (isInconclusive && isProceed) {
    throw new Error(`[${label}] conflicting signals: both an inconclusive diagnostic (${obs.inconclusiveDiagnosticCount}) and a clearance-distance-query event (${obs.distanceEventCount}) matched this exact pair`);
  }
  if (isInconclusive) return 'inconclusive';
  if (isProceed) return 'proceed';
  return 'excluded'; // neither -- exactly CollisionWorld.js:2436-2437's own branch
}

// Compares the FULL §13 B field set between two cells, with a labeled failure message naming exactly
// which comparison and which field diverged (deliberately not one opaque fingerprint-equality check,
// so a real divergence is immediately diagnosable).
function assertCellMatches(cellA, cellB, comparisonLabel, failures) {
  const checks = [
    ['disposition', cellA.disposition, cellB.disposition],
    ['conclusive', cellA.obs.conclusive, cellB.obs.conclusive],
    ['inconclusiveCauses', JSON.stringify(cellA.obs.inconclusiveCauses), JSON.stringify(cellB.obs.inconclusiveCauses)],
    ['containmentSamplesUsed', cellA.obs.containmentSamplesUsed, cellB.obs.containmentSamplesUsed],
    ['candidatePairsExamined', cellA.obs.candidatePairsExamined, cellB.obs.candidatePairsExamined],
    ['crossingPairsExamined', cellA.obs.crossingPairsExamined, cellB.obs.crossingPairsExamined],
    ['pointClassifications', cellA.obs.pointClassifications, cellB.obs.pointClassifications],
    ['exhaustedBudget', cellA.obs.exhaustedBudget, cellB.obs.exhaustedBudget],
  ];
  for (const [what, va, vb] of checks) {
    try {
      assert.equal(va, vb, `[${comparisonLabel}] ${what} differs: ${cellA.label} => ${JSON.stringify(va)}, ${cellB.label} => ${JSON.stringify(vb)}`);
    } catch (err) {
      failures.push(err.message);
      console.error(`FAIL ${err.message}`);
    }
  }
}

async function main() {
  const pingRes = await fetch(`http://localhost:${PORT}/`).catch((err) => { throw new Error(`LIVE INFRASTRUCTURE FAILURE: dev server at localhost:${PORT} is not reachable: ${err.message}`); });
  if (pingRes.status !== 200) throw new Error(`LIVE INFRASTRUCTURE FAILURE: dev server at localhost:${PORT} returned HTTP ${pingRes.status}`);

  const browser = await chromium.launch();
  const byOrder = {};
  try {
    const page = await browser.newPage();
    for (const order of ORDERS) {
      await loadFixtureAndReconfirm(page);
      const label = order.join('>');
      console.log(`Running order ${label}...`);
      byOrder[label] = await runOrderPass(page, order);
      console.log(`  ${label}:`, JSON.stringify(byOrder[label]));
      await page.reload();
    }
  } finally {
    await browser.close();
  }

  const [labelA, labelB] = ORDERS.map((o) => o.join('>'));
  const failures = [];

  // Fail-loud disposition derivation for every (order, arm) cell before comparing -- an
  // instrumentation gap must never be silently compared away.
  const cells = {};
  for (const orderLabel of [labelA, labelB]) {
    for (const broadPhase of ['tlas', 'linear']) {
      const obs = byOrder[orderLabel][broadPhase];
      const label = `${orderLabel}/${broadPhase}`;
      const disposition = deriveDisposition(obs, label);
      cells[label] = { obs, disposition, label };
    }
  }

  // Three labeled pairwise comparisons, together transitively pinning all four (order, arm) cells to
  // one identical projection (see file header for why three separate comparisons rather than one
  // opaque fingerprint-set check):
  assertCellMatches(cells[`${labelA}/tlas`], cells[`${labelB}/tlas`], `arm-order-independence (tlas): ${labelA} vs ${labelB}`, failures);
  assertCellMatches(cells[`${labelA}/linear`], cells[`${labelB}/linear`], `arm-order-independence (linear): ${labelA} vs ${labelB}`, failures);
  assertCellMatches(cells[`${labelA}/tlas`], cells[`${labelA}/linear`], `arm-choice-parity (within order ${labelA}): tlas vs linear`, failures);

  await mkdir(RESULTS_DIR, { recursive: true });
  const resultsPath = `${RESULTS_DIR}/arm-order-independence-${Date.now()}.json`;
  await writeFile(resultsPath, JSON.stringify({
    description: 'Task C3b (design doc §13 B, arm-order half): pair structure:3547/frag363 -> architecture:3551/frag30, both arm orders (tlas>linear, linear>tlas), asserting identical precheck disposition/conclusive/inconclusiveCauses/containmentSamplesUsed and all three crossing counters + exhaustedBudget, read from the production findClashes call\'s own diagnostic events (no direct volumeOverlapQuery replay).',
    pair: { sourceDbId: SOURCE_DB_ID, sourceFragmentId: SOURCE_FRAGMENT_ID, targetDbId: TARGET_DB_ID, targetFragmentId: TARGET_FRAGMENT_ID },
    orders: ORDERS.map((o) => o.join('>')),
    byOrder,
    dispositions: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, v.disposition])),
    failureCount: failures.length,
  }, null, 2));
  console.log(`\nFull results written to ${resultsPath}`);

  if (failures.length) {
    console.error(`\n${failures.length} assertion(s) failed:\n${failures.map((f) => ` - ${f}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nPASS: pair structure:${SOURCE_DB_ID}/frag${SOURCE_FRAGMENT_ID} -> architecture:${TARGET_DB_ID}/frag${TARGET_FRAGMENT_ID} resolved to an identical disposition ('${cells[`${labelA}/tlas`].disposition}') with identical conclusive/inconclusiveCauses/containmentSamplesUsed/crossing-counters/exhaustedBudget across BOTH arm orders (${labelA}, ${labelB}) and BOTH broad phases (tlas, linear).`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
