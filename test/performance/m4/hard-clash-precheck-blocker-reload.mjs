// test/performance/m4/hard-clash-precheck-blocker-reload.mjs
//
// Task C2 (canonical-ordering/operand-symmetry fix implementation plan, Phase C):
// docs/superpowers/specs/2026-09-11-proper-crossing-query-deterministic-budget-fix-design.md
// §13 regression A -- "Exact real failing pair" -- extended to genuine CROSS-RELOAD scope.
//
// The pair `structure:3547/frag363 -> architecture:3551/frag30` (federated Audubon fixture) is the
// original real pair that motivated the deterministic-budget fix (commit db64324, already landed).
// Design doc §13 A itself only requires "stable across N >= 10 repeated executions" and names
// test/performance/m4/structure-fragment-clearance-regression.mjs as this regression's template
// ("same URNs, same setDiagnosticEventRecorder seam, same 'not a node --test file' convention") --
// but does not itself distinguish in-process repeats from genuine page reloads.
//
// Before the canonical-ordering/operand-symmetry fix plan's own Phase A landed, this pair's
// disposition was unstable ACROSS RELOADS specifically (not within one page load) because of Effect
// B: `comparePlacedCanonically`'s pre-fix `geometryIndex` term is a load-order artifact, not a
// geometric one -- see docs/research/m4-effect-b-precheck-diagnostic-nondeterminism-investigation.md.
// A single-page-load N>=10 repeat loop would not exercise that axis at all: this script's whole
// reason to exist is running the identical query across N >= 10 GENUINE `page.reload()` transitions
// (one baseline load + 10 reloads = 11 independent observations), now that Phase A has landed and
// closed Effect B, so a failure here (a flip across reloads) would be a genuine, unexpected
// regression, not an expected pre-fix state.
//
// Not a `node --test` file (same convention as every sibling in this directory -- structure-
// fragment-clearance-regression.mjs, operand-swap-replay.mjs, proper-crossing-budget-calibration.mjs
// -- plain `npm test` must never require a live dev server / live APS credentials). Run directly,
// with the dev server already running on PORT (default 8080; `npm start`):
//
//   node test/performance/m4/hard-clash-precheck-blocker-reload.mjs
//
// Deliberately does NOT touch test/performance/run-gate-m4.mjs or invoke its `main()`: that file's
// own scoped subset (`--cases=`) still inherits the full M4 gate's cohort-profiling/heap-CDP-
// instrumentation/two-runtime/worker-spike machinery, which is unrelated overhead for pinning one
// exact pair's disposition. This script only REUSES that file's documented reload idiom (the
// `page.reload()` + `loadFixtureAndReconfirm(page)` pair at run-gate-m4.mjs:3143-3144) inside a new,
// narrowly-scoped, self-contained script -- exactly the same relationship every other sibling script
// in this directory already has to run-gate-m4.mjs (each copies/adapts its own local
// `loadFixtureAndReconfirm`, since that function is not exported).
//
// codex-advisor review (request 20260911-222558-46518-5054) on this script's design:
//  - Confirmed scoping the query source directly to `dbIds: [3547]` (rather than the M4 gate's own
//    generic cohort-seed SOURCE_DB_ID=3076) is correct for this task: it isolates the exact real
//    pair without the generic cohort machinery, and does not invalidate the "real pair" claim --
//    the actual Viewer operands/transforms/models/broad-phases stay live; it only changes which
//    OTHER candidate pairs surround it in this run, which C2 does not require reproducing.
//  - Confirmed there is no direct "disposition" field on any public API; deriving it from the
//    `hard-clash-precheck` diagnostic event (stage `volume-overlap-query`) plus `clearance-distance-
//    query` events plus `statistics.diagnostics` is the intended (and only) observability seam --
//    but flagged the original draft's "anything else defaults to excluded" branch as too permissive:
//    missing instrumentation (e.g. a `stage:'not-run'` event, meaning the pair never reached the
//    precheck at all, or zero/multiple matching `volume-overlap-query` events) must FAIL loudly
//    rather than silently read as "excluded". `deriveDisposition` below implements that exhaustively.
//  - Recommended strengthening fixture-identity verification to check dbId 3547 really owns fragment
//    363 (Structure) and dbId 3551 really owns fragment 30 (Architecture) on every load, not just
//    that the three models resolve by URN -- implemented in `loadFixtureAndReconfirm` below.
//  - One recommendation (restructuring the reload helper so a reload does NOT re-run `page.goto()`)
//    was NOT adopted: the brief requires reusing run-gate-m4.mjs's own `page.reload()` +
//    `loadFixtureAndReconfirm(page)` idiom literally, not a new reload mechanism -- and that existing
//    idiom's own `loadFixtureAndReconfirm` deliberately re-navigates via `page.goto()` after the
//    `page.reload()`, which is what makes it a genuinely fresh multi-model fixture assembly each
//    time, not merely a page refresh. Kept as-is to match the established, approved pattern exactly.

import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// URNs copied verbatim from test/performance/run-gate-m4.mjs:42-44 -- the same real 3-discipline
// federated Revit host+links Audubon package every M1-M4 gate uses.
const ARCH_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fQXJjaGl0ZWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const STRUCTURE_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fU3RydWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const MECHANICAL_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fTWVjaGFuaWNhbF9jbGFzaF90ZXN0LnJ2dA';
const PORT = process.env.PORT || 8080;
const RESULTS_DIR = 'test/performance/results';

const SOURCE_DB_ID = 3547;        // Structure model -- the real failing pair's source
const TARGET_DB_ID = 3551;        // Architecture model -- the real failing pair's target
const SOURCE_FRAGMENT_ID = 363;
const TARGET_FRAGMENT_ID = 30;
const CLEARANCE = 0.05;           // DEFAULT_CLEARANCE, same as run-gate-m4.mjs:47
const RELOADS = 10;               // design doc §13 A's "N >= 10" -- 10 GENUINE page.reload()
                                   // transitions PLUS the initial baseline load = 11 total
                                   // independent observations, unambiguously satisfying "N >= 10".
const BROAD_PHASES = ['tlas', 'linear']; // design doc §13 A's "both arms"

// §6.1 steps 1-2, copied/adapted from run-gate-m4.mjs:191-241 (loadFixtureAndReconfirm) -- identical
// 3-step load (Architecture normal load, Structure/Mechanical as-additional via #keep-current-models,
// isLoadDone() AND getData().instanceTree waited on every model) plus live identity re-confirmation
// by URN, never by load-order/array-index alone. Extended (codex-advisor recommendation) to also
// confirm the EXACT fragment ownership this script depends on: dbId 3547 must own fragment 363 in
// Structure, and dbId 3551 must own fragment 30 in Architecture, on every single load -- a silent
// fixture drift here must fail loudly, not be misread later as "the pair never reached the
// precheck" defaulting to some disposition.
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

// One fresh CollisionWorld per (load, broadPhase) tuple, mirroring the M4 gate's own per-tuple
// fresh-world discipline. Drives the REAL production code path (CollisionWorld._runClearanceNarrow-
// PhasePair -> classifyHardClashPrecheck -> volumeOverlapQuery), scoped directly to the one real dbId
// pair this task cares about (`source: { dbIds: [SOURCE_DB_ID] }`), rather than the M4 gate's own
// generic cohort-seed dbId -- confirmed sound by codex-advisor review (see file header).
//
// classifyHardClashPrecheck exposes no disposition field on any public return value reachable from
// here -- CollisionWorld consumes its return internally and never republishes it. The ONLY
// observability seam (design doc §9.2, "opt-in telemetry on the internal hard-clash-precheck
// diagnostic event") is: the `hard-clash-precheck` diagnostic event (stage `volume-overlap-query`
// carries `conclusive` + `inconclusiveCauses` per fragment pair -- ClearanceHardClashPrecheck.js),
// the `clearance-distance-query` diagnostic event (fires ONLY on the `proceed` branch, once the
// precheck lets a pair through to the actual distance computation -- CollisionWorld.js:2481), and
// `result.statistics.diagnostics` (carries a `clearance-hard-clash-precheck-inconclusive` entry ONLY
// on the `inconclusive` branch -- CollisionWorld.js:2439-2445). `deriveDisposition` below combines
// these exhaustively.
async function runHardClashPrecheckArm(page, broadPhase) {
  return page.evaluate(async ({ broadPhase, sourceDbId, targetDbId, sourceFragId, targetFragId, clearance }) => {
    const { CollisionWorld } = await import('/collision/index.js');
    const sched = await import('/collision/scheduler.js');
    const { modelArch, modelStructure, modelMechanical } = window.__gate;

    const hardClashEvents = [];
    const distanceEvents = [];
    sched.setDiagnosticEventRecorder((kind, payload) => {
      if (kind === 'hard-clash-precheck') hardClashEvents.push(payload);
      else if (kind === 'clearance-distance-query') distanceEvents.push(payload);
    });

    let world = null;
    try {
      world = await CollisionWorld.fromViewer(window.viewer);
      const archLease = world.admitModel(modelArch);
      const structureLease = world.admitModel(modelStructure);
      world.admitModel(modelMechanical);

      const result = await world.findClashes({
        mode: 'clearance',
        clearance,
        source: { model: modelStructure, dbIds: [sourceDbId] },
        target: { targets: [{ model: modelArch }, { model: modelStructure }, { model: modelMechanical }] },
        groupBy: 'dbId',
        broadPhase,
      });

      // Diagnostic events carry epochs (run-local identities, only meaningful WITHIN this one
      // world/evaluate call); `result.statistics.diagnostics` entries carry no epoch at all, only
      // modelId/dbId/fragId (CollisionWorld.js's `fragmentRef`) -- matched accordingly below.
      const matchesEventPair = (e) => (
        e.sourceEpoch === structureLease.epoch && e.sourceFragmentId === sourceFragId
        && e.targetEpoch === archLease.epoch && e.targetFragmentId === targetFragId
      );

      const volumeOverlapEvents = hardClashEvents.filter((e) => e.stage === 'volume-overlap-query' && matchesEventPair(e));
      const notRunEvents = hardClashEvents.filter((e) => e.stage === 'not-run' && matchesEventPair(e));
      const distanceMatches = distanceEvents.filter(matchesEventPair);
      const inconclusiveDiagnostics = (result.statistics.diagnostics || []).filter((d) => (
        d.reason === 'clearance-hard-clash-precheck-inconclusive'
        && d.sourceFragment?.modelId === modelStructure.id && d.sourceFragment?.dbId === sourceDbId && d.sourceFragment?.fragId === sourceFragId
        && d.targetFragment?.modelId === modelArch.id && d.targetFragment?.dbId === targetDbId && d.targetFragment?.fragId === targetFragId
      ));

      return {
        pairFoundInResult: result.pairs.some((p) => p.source.dbId === sourceDbId && p.target.dbId === targetDbId),
        volumeOverlapEventCount: volumeOverlapEvents.length,
        notRunEventCount: notRunEvents.length,
        notRunReasons: notRunEvents.map((e) => e.precheckNotRunReason),
        conclusive: volumeOverlapEvents[0]?.conclusive ?? null,
        inconclusiveCauses: volumeOverlapEvents[0] ? [...(volumeOverlapEvents[0].inconclusiveCauses ?? [])].sort() : null,
        inconclusiveDiagnosticCount: inconclusiveDiagnostics.length,
        distanceEventCount: distanceMatches.length,
      };
    } finally {
      sched.clearDiagnosticEventRecorder();
      if (world) world.dispose();
    }
  }, {
    broadPhase, sourceDbId: SOURCE_DB_ID, targetDbId: TARGET_DB_ID,
    sourceFragId: SOURCE_FRAGMENT_ID, targetFragId: TARGET_FRAGMENT_ID, clearance: CLEARANCE,
  });
}

// Exhaustive, fail-loud classification (codex-advisor review, see file header) -- anything other
// than a clean, singular match for exactly one of the three branches CollisionWorld's own
// `_runClearanceNarrowPhasePair` can take is an instrumentation problem, never silently read as
// "excluded".
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

async function main() {
  // Quick sanity re-check of the live infrastructure the controller already preflighted -- do NOT
  // start a second server, do NOT try to work around a failure here.
  const pingRes = await fetch(`http://localhost:${PORT}/`).catch((err) => { throw new Error(`LIVE INFRASTRUCTURE FAILURE: dev server at localhost:${PORT} is not reachable: ${err.message}`); });
  if (pingRes.status !== 200) throw new Error(`LIVE INFRASTRUCTURE FAILURE: dev server at localhost:${PORT} returned HTTP ${pingRes.status}`);

  const browser = await chromium.launch();
  const observations = []; // { load, tlas: {...}, linear: {...} }
  try {
    const page = await browser.newPage();
    for (let load = 0; load <= RELOADS; load++) {
      if (load === 0) {
        await loadFixtureAndReconfirm(page);
      } else {
        // The exact reload idiom run-gate-m4.mjs:3143-3144 uses for its own "rebuild the page"
        // recovery path -- reused literally here, not reinvented, per the brief.
        await page.reload();
        await loadFixtureAndReconfirm(page);
      }
      const perArm = {};
      for (const broadPhase of BROAD_PHASES) {
        perArm[broadPhase] = await runHardClashPrecheckArm(page, broadPhase);
      }
      observations.push({ load, ...perArm });
      console.log(`load ${load}: ${BROAD_PHASES.map((bp) => `${bp}=${JSON.stringify({ conclusive: perArm[bp].conclusive, inconclusiveCauses: perArm[bp].inconclusiveCauses })}`).join(' ')}`);
    }
  } finally {
    await browser.close();
  }

  await mkdir(RESULTS_DIR, { recursive: true });
  const resultsPath = `${RESULTS_DIR}/hard-clash-precheck-blocker-reload-${Date.now()}.json`;
  await writeFile(resultsPath, JSON.stringify({
    description: 'Task C2: hard-clash-precheck blocker pair structure:3547/frag363 -> architecture:3551/frag30, stability across N >= 10 genuine page reloads, both broadPhase arms.',
    pair: { sourceDbId: SOURCE_DB_ID, sourceFragmentId: SOURCE_FRAGMENT_ID, targetDbId: TARGET_DB_ID, targetFragmentId: TARGET_FRAGMENT_ID },
    reloads: RELOADS, totalObservations: observations.length,
    observations,
  }, null, 2));
  console.log(`\nFull results written to ${resultsPath}`);

  assert.equal(observations.length, RELOADS + 1, `expected ${RELOADS + 1} total observations (1 baseline + ${RELOADS} reloads)`);

  const failures = [];
  for (const broadPhase of BROAD_PHASES) {
    const fingerprints = new Set();
    const dispositions = [];
    for (const obs of observations) {
      try {
        const disposition = deriveDisposition(obs[broadPhase], `${broadPhase} load ${obs.load}`);
        dispositions.push({ load: obs.load, disposition });
        fingerprints.add(JSON.stringify({
          disposition,
          conclusive: obs[broadPhase].conclusive,
          inconclusiveCauses: obs[broadPhase].inconclusiveCauses,
        }));
      } catch (err) {
        failures.push(`[${broadPhase}] load ${obs.load}: ${err.message}`);
      }
    }
    if (failures.some((f) => f.startsWith(`[${broadPhase}]`))) continue; // already recorded above

    try {
      assert.equal(fingerprints.size, 1,
        `[${broadPhase}] disposition/conclusive/inconclusiveCauses must be IDENTICAL across all ${observations.length} loads -- the PRIMARY contract (design doc §13 A); got ${dispositions.length} distinct dispositions: ${JSON.stringify(dispositions)}`);
      const only = [...fingerprints][0];
      const parsed = JSON.parse(only);
      // Pinned literal value -- secondary per design doc §13 A ("the literal value is secondary"),
      // but still required: precheck conclusive === true, disposition excluded, inconclusiveCauses === [].
      assert.equal(parsed.disposition, 'excluded', `[${broadPhase}] expected disposition 'excluded', got '${parsed.disposition}'`);
      assert.equal(parsed.conclusive, true, `[${broadPhase}] expected conclusive === true, got ${parsed.conclusive}`);
      assert.deepEqual(parsed.inconclusiveCauses, [], `[${broadPhase}] expected inconclusiveCauses === [], got ${JSON.stringify(parsed.inconclusiveCauses)}`);
    } catch (err) {
      failures.push(err.message);
    }
  }

  if (failures.length) {
    console.error(`\n${failures.length} assertion(s) failed:\n${failures.map((f) => ` - ${f}`).join('\n')}`);
    console.error('\nThis is a GREEN regression once canonical-ordering Phase A has landed (it has, per db64324 + this plan\'s Phase A). A failure here means the pair\'s disposition genuinely flips across reloads -- a real regression, not an expected pre-fix state.');
    process.exitCode = 1;
    return;
  }

  console.log(`\nPASS: pair structure:${SOURCE_DB_ID}/frag${SOURCE_FRAGMENT_ID} -> architecture:${TARGET_DB_ID}/frag${TARGET_FRAGMENT_ID} resolved to a single, stable disposition ('excluded', conclusive, no inconclusive causes) across all ${observations.length} loads (1 baseline + ${RELOADS} genuine reloads), both broadPhase arms.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
