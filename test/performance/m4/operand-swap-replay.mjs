// test/performance/m4/operand-swap-replay.mjs
//
// Task A4.2 (canonical-ordering/operand-symmetry fix implementation plan, design doc §11 regression
// B): "Operand-swap invariance — at the wrapper, over the [real] pair replay set."
// docs/superpowers/specs/2026-09-11-canonical-ordering-operand-symmetry-fix-design.md:859-870.
//
// IMPORTANT — this is NOT "the 106-pair set." The original 106-pair capture
// (docs/research/m4-effect-b-precheck-diagnostic-nondeterminism-investigation.md §6.5a) came from
// two throwaway Playwright harnesses that were, per that document's own §3.3, "written to the
// session scratchpad and never added to the repo" — there is no static fixture anywhere in this
// repo to load (confirmed by exhaustive search; see task-A4.2-report.md). This script instead
// REBUILDS the research doc's §6.5a METHOD (single page load; one production `findClashes` run;
// select same-model pairs that carried a crossing diagnostic BEFORE any forward/backward replay
// exists, to avoid selection bias; reconstruct both real operands via
// `world._registry.getOrBuildGeometry` + `world._placementByEpoch`; drive each pair through
// `volumeOverlapQuery` in both public-role orders) against the CURRENT live fixture, on the CURRENT
// (post-fix) build. The real pair count this produces is a property of the CURRENT build and
// fixture, not a fixed historical number — it was **40** on the run that produced this script (see
// task-A4.2-report.md for full provenance/environment facts) and is read dynamically here, never
// hardcoded as an expected count.
//
// One pair from the research doc IS identified explicitly and probed directly, for documentation:
// the "class-B pair" (structure fragment 537 -> fragment 427, §6.5a). It is confirmed below (via its
// real, byte-identical `localDiagonal`s: 290.969.../3.918..., matching §6.5a's table) to be the same
// real fragment pair — but on the current (post-fix) build it no longer carries a crossing
// diagnostic at all, because a direct kernel replay resolves it fully conclusively
// (`crossing: false, aborted: false, inconclusive: false`), not merely "no longer flipping." That is
// stronger evidence the fix works than mere invariance would be, so it is recorded here even though
// it means this specific historical pair cannot be part of the invariance-replay population below.
//
// This is NOT a `node --test` file: it drives a live dev server + a real Autodesk Viewer session via
// Playwright, so `npm test` must never pick it up. Precedent for this exact convention (a standalone,
// non-`.test.mjs`-suffixed live-Viewer script under test/performance/m4/, invoked directly rather
// than through scripts/run-tests.mjs's `*.test.mjs` glob) is
// test/performance/m4/structure-fragment-clearance-regression.mjs — this script mirrors its shape
// (fixture load, per-arm/per-pair evaluate, assert-and-collect-failures, final summary + exit code).
// Run directly, with the dev server already running (`npm start` / `node server.js`, default PORT
// 8080):
//
//   node test/performance/m4/operand-swap-replay.mjs
//
// Retains one per-session JSON report under test/performance/results/ (closing research doc
// Limitation 9's "raw per-session JSON is not retained in the repository" gap for this regression).
//
// Corrected assertion set — verified directly against design doc §3.2's predicate table
// (docs/superpowers/specs/2026-09-11-canonical-ordering-operand-symmetry-fix-design.md:134-141),
// NOT taken as-is from the task brief's original Step 2 snippet (which asserted `via` equality and
// full `witness` deepEqual — both explicitly listed there as "Legitimately directional", i.e. NOT
// part of the wrapper's invariance contract):
//   MUST be invariant, and asserted below: `overlap`, `conclusive`, `inconclusiveCauses` (sorted
//   set), the diagnostic REASON multiset with `role` stripped (role legitimately differs between
//   forward/backward since the public source/target labels swap — only the reason population is
//   promised invariant, "up to role relabelling"), and the three crossing counters +
//   `exhaustedBudget`/`timeBudgetExceeded` bit-identically (the same kernel call is made either way).
//   Deliberately NOT asserted: `via`, `witness` (kind/point), `containmentSamplesUsed`,
//   `stats.aInB`/`stats.bInA`, raw `role` labels, or `elapsedMs` (real wall-clock — expected to vary
//   run to run, asserting it would make this test flaky by construction).
// A second, kernel-adjacent check is kept from the original brief (judged sound, unaffected by the
// over-assertion above): `orientForCrossing` must select the SAME physical operand as `.first` (and
// the same `.rank`) regardless of which one the caller calls `source`/`target` — the mechanism the
// wrapper-level invariance above is built on.

import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';

// URNs copied verbatim from test/performance/run-gate-m2.mjs / run-gate-m4.mjs — the same real
// 3-discipline federated Revit host+links Audubon package every M1-M4 gate uses.
const ARCH_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fQXJjaGl0ZWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const STRUCTURE_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fU3RydWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const MECHANICAL_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fTWVjaGFuaWNhbF9jbGFzaF90ZXN0LnJ2dA';
const PORT = process.env.PORT || 8080;
const SOURCE_DB_ID = 3076; // Structure model — same source dbId run-gate-m2.mjs and the original §6.5a harness used.
const RESULTS_DIR = 'test/performance/results';

// Historical reference only (research doc §6.5a) — NOT assumed present in the current population;
// probed separately below and reported honestly whichever way it comes out.
const CLASS_B_SOURCE_FRAG = 537;
const CLASS_B_TARGET_FRAG = 427;

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

  // Resolve models by URN, never by load-order/array-index alone (structure-fragment-clearance-
  // regression.mjs's own established discipline).
  const identity = await page.evaluate(({ sourceDbId, archUrn, structureUrn, mechanicalUrn }) => {
    const models = window.viewer.getAllModels();
    const modelArch = models.find((m) => m.getData()?.urn === archUrn);
    const modelStructure = models.find((m) => m.getData()?.urn === structureUrn);
    const modelMechanical = models.find((m) => m.getData()?.urn === mechanicalUrn);
    window.__gate = { modelArch, modelStructure, modelMechanical };
    const fragments = [];
    if (modelStructure) {
      modelStructure.getInstanceTree().enumNodeFragments(sourceDbId, (fragId) => { fragments.push(fragId); }, false);
    }
    return {
      modelCount: models.length,
      hasArch: !!modelArch, hasStructure: !!modelStructure, hasMechanical: !!modelMechanical,
      archFragmentTotal: modelArch?.getFragmentList().getCount() ?? null,
      structureFragmentTotal: modelStructure?.getFragmentList().getCount() ?? null,
      mechanicalFragmentTotal: modelMechanical?.getFragmentList().getCount() ?? null,
      sourceFragmentCount: fragments.length,
    };
  }, { sourceDbId: SOURCE_DB_ID, archUrn: ARCH_URN, structureUrn: STRUCTURE_URN, mechanicalUrn: MECHANICAL_URN });

  if (identity.modelCount !== 3) throw new Error(`Expected exactly 3 loaded models, got ${identity.modelCount}`);
  if (!identity.hasArch || !identity.hasStructure || !identity.hasMechanical) {
    throw new Error(`Fixture identity mismatch: could not resolve all three discipline models by URN (hasArch=${identity.hasArch}, hasStructure=${identity.hasStructure}, hasMechanical=${identity.hasMechanical})`);
  }
  if (!identity.sourceFragmentCount) {
    throw new Error(`Fixture identity mismatch: source dbId ${SOURCE_DB_ID} in the Structure model owns zero fragments -- cannot exercise the query`);
  }
  return identity;
}

// Everything below runs INSIDE the page: the reconstructed Instances carry a real MeshBVH + a real
// THREE.BufferGeometry, neither of which survives Playwright's structured-clone boundary back to
// Node with their prototype/methods intact. Only plain, JSON-serializable summaries cross back out.
async function runProductionQueryAndReplay(page) {
  return page.evaluate(async ({ sourceDbId, classBSourceFrag, classBTargetFrag }) => {
    const { CollisionWorld, toInstance } = await import('/collision/CollisionWorld.js');
    const { properCrossingQuery } = await import('/collision/query/ProperCrossingQuery.js');
    const { orientForCrossing } = await import('/collision/query/orientForCrossing.js');
    const { volumeOverlapQuery } = await import('/collision/query/VolumeOverlapQuery.js');
    const { Matrix4 } = await import('three');

    const { modelArch, modelStructure, modelMechanical } = window.__gate;
    const models = [modelArch, modelStructure, modelMechanical];

    const world = await CollisionWorld.fromViewer(window.viewer);
    const epochArch = world.admitModel(modelArch).epoch;
    const epochStructure = world.admitModel(modelStructure).epoch;
    const epochMechanical = world.admitModel(modelMechanical).epoch;
    const epochByModelId = new Map([
      [modelArch.id, epochArch], [modelStructure.id, epochStructure], [modelMechanical.id, epochMechanical],
    ]);

    // ---- Step 1: ONE production run; select the same-model crossing-diagnostic population BEFORE
    // any forward/backward wrapper call exists anywhere below (avoids selection bias by construction,
    // per §6.5a's own protocol: "run the production query once, and record which same-model pairs
    // carried a crossing diagnostic"). ----
    const result = await world.findClashes({
      mode: 'volume-overlap',
      source: { model: modelStructure, dbIds: [sourceDbId] },
      target: { targets: models.map((m) => ({ model: m })) },
      groupBy: 'dbId',
    });
    const diagnostics = result?.statistics?.diagnostics ?? [];
    const crossingReasons = new Set(['inconclusive-crossing', 'crossing-budget-exhausted']);
    const selected = diagnostics.filter((d) => d.scope === 'pair'
      && crossingReasons.has(d.reason)
      && d.sourceFragment && d.targetFragment
      && d.sourceFragment.modelId === d.targetFragment.modelId);

    // ---- Step 2: reconstruct both real operands for a fragment ref, exactly as
    // resolveGeometryRecord (CollisionWorld.js) does: geometryIndex from the epoch's instance cache,
    // worldMatrix from the epoch's placement table, geometry/bvh/localDiagonal/digest from the
    // registry. `toInstance` (also exported from CollisionWorld.js) assembles the real
    // volumeOverlapQuery-shaped Instance from those two pieces. ----
    async function reconstruct(fragRef, epoch, role) {
      const inst = world._instanceCache.get(epoch)?.get(fragRef.fragId);
      const place = world._placementByEpoch.get(epoch)?.get(fragRef.fragId);
      if (!inst || !place) return { ok: false, reason: 'missing instance/placement record' };
      const record = await world._registry.getOrBuildGeometry({
        loadEpoch: epoch,
        geometryIndex: inst.geometryIdentity.geometryIndex,
        ownerModelIdHint: place.modelId,
        needsConnectivity: true, // matches production's own volume-overlap call (needsConnectivity = mode !== 'surface-intersection')
        role,
      });
      if (record.oversized) return { ok: false, reason: 'oversized geometry record' };
      return { ok: true, instance: toInstance(record, place.worldMatrix) };
    }

    const pairs = [];
    const skipped = [];
    for (const d of selected) {
      const sEpoch = epochByModelId.get(d.sourceFragment.modelId);
      const tEpoch = epochByModelId.get(d.targetFragment.modelId);
      const sRec = await reconstruct(d.sourceFragment, sEpoch, 'source');
      const tRec = await reconstruct(d.targetFragment, tEpoch, 'target');
      if (!sRec.ok || !tRec.ok) {
        skipped.push({ sourceFragId: d.sourceFragment.fragId, targetFragId: d.targetFragment.fragId, sourceIssue: sRec.ok ? null : sRec.reason, targetIssue: tRec.ok ? null : tRec.reason });
        continue;
      }
      const sourceInstance = sRec.instance;
      const targetInstance = tRec.instance;

      // ---- Step 3: the actual regression -- the SAME two operands driven through the PUBLIC
      // wrapper in both public-role orders. ----
      const forward = await volumeOverlapQuery(sourceInstance, targetInstance);
      const backward = await volumeOverlapQuery(targetInstance, sourceInstance);

      const fc = forward.stats.crossing;
      const bc = backward.stats.crossing;
      const forwardReasons = [...forward.diagnostics.map((x) => x.reason)].sort();
      const backwardReasons = [...backward.diagnostics.map((x) => x.reason)].sort();
      const forwardCauses = [...(forward.inconclusiveCauses ?? [])].sort();
      const backwardCauses = [...(backward.inconclusiveCauses ?? [])].sort();

      // orientForCrossing must pick the SAME physical operand as `.first` regardless of caller
      // order (the mechanism the wrapper invariance above is built on).
      const fwdOrient = orientForCrossing(sourceInstance, targetInstance);
      const bwdOrient = orientForCrossing(targetInstance, sourceInstance);

      pairs.push({
        sourceFragId: d.sourceFragment.fragId,
        targetFragId: d.targetFragment.fragId,
        productionReason: d.reason,
        forward: { overlap: forward.overlap, conclusive: forward.conclusive },
        backward: { overlap: backward.overlap, conclusive: backward.conclusive },
        checks: {
          overlapMatch: forward.overlap === backward.overlap,
          conclusiveMatch: forward.conclusive === backward.conclusive,
          inconclusiveCausesMatch: JSON.stringify(forwardCauses) === JSON.stringify(backwardCauses),
          reasonMultisetMatch: JSON.stringify(forwardReasons) === JSON.stringify(backwardReasons),
          candidatePairsExaminedMatch: fc.candidatePairsExamined === bc.candidatePairsExamined,
          crossingPairsExaminedMatch: fc.crossingPairsExamined === bc.crossingPairsExamined,
          pointClassificationsMatch: fc.pointClassifications === bc.pointClassifications,
          exhaustedBudgetMatch: fc.exhaustedBudget === bc.exhaustedBudget,
          timeBudgetExceededMatch: fc.timeBudgetExceeded === bc.timeBudgetExceeded,
          orientSameFirst: fwdOrient.first === bwdOrient.first,
          orientRankMatch: fwdOrient.rank === bwdOrient.rank,
        },
        forwardReasons, backwardReasons, forwardCauses, backwardCauses,
        forwardCrossingStats: { candidatePairsExamined: fc.candidatePairsExamined, crossingPairsExamined: fc.crossingPairsExamined, pointClassifications: fc.pointClassifications, exhaustedBudget: fc.exhaustedBudget, timeBudgetExceeded: fc.timeBudgetExceeded },
        backwardCrossingStats: { candidatePairsExamined: bc.candidatePairsExamined, crossingPairsExamined: bc.crossingPairsExamined, pointClassifications: bc.pointClassifications, exhaustedBudget: bc.exhaustedBudget, timeBudgetExceeded: bc.timeBudgetExceeded },
        orientRank: fwdOrient.rank,
      });
    }

    // ---- Documentation-only: the historical class-B pair (§6.5a), probed directly at the KERNEL
    // level regardless of whether it's in `selected` above (it is expected NOT to be, post-fix). ----
    let classBProbe = null;
    try {
      const sInst = world._instanceCache.get(epochStructure)?.get(classBSourceFrag);
      const tInst = world._instanceCache.get(epochStructure)?.get(classBTargetFrag);
      const sPlace = world._placementByEpoch.get(epochStructure)?.get(classBSourceFrag);
      const tPlace = world._placementByEpoch.get(epochStructure)?.get(classBTargetFrag);
      if (!sInst || !tInst || !sPlace || !tPlace) {
        classBProbe = { extracted: false };
      } else {
        const sRecord = await world._registry.getOrBuildGeometry({ loadEpoch: epochStructure, geometryIndex: sInst.geometryIdentity.geometryIndex, ownerModelIdHint: sPlace.modelId, needsConnectivity: false, role: 'source' });
        const tRecord = await world._registry.getOrBuildGeometry({ loadEpoch: epochStructure, geometryIndex: tInst.geometryIdentity.geometryIndex, ownerModelIdHint: tPlace.modelId, needsConnectivity: false, role: 'target' });
        const sMat = new Matrix4().fromArray(sPlace.worldMatrix);
        const tMat = new Matrix4().fromArray(tPlace.worldMatrix);
        const matrixBtoA = sMat.clone().invert().multiply(tMat);
        const kr = properCrossingQuery(sRecord.bvh, tRecord.bvh, matrixBtoA, sRecord.localDiagonal, tRecord.localDiagonal, {});
        classBProbe = {
          extracted: true,
          sourceLocalDiagonal: sRecord.localDiagonal, targetLocalDiagonal: tRecord.localDiagonal,
          crossing: kr.crossing, aborted: kr.aborted, inconclusive: kr.inconclusive,
          inSelectedPopulation: selected.some((d) => (d.sourceFragment.fragId === classBSourceFrag && d.targetFragment.fragId === classBTargetFrag) || (d.sourceFragment.fragId === classBTargetFrag && d.targetFragment.fragId === classBSourceFrag)),
        };
      }
    } catch (e) {
      classBProbe = { extracted: 'error', message: e.message };
    }

    const fragTotal = (m) => m.getFragmentList().getCount();
    const fragmentTotals = { arch: fragTotal(modelArch), structure: fragTotal(modelStructure), mechanical: fragTotal(modelMechanical) };
    world.dispose();

    return {
      totalDiagnostics: diagnostics.length,
      pairCount: result?.pairs?.length ?? null,
      selectedCount: selected.length,
      reconstructedCount: pairs.length,
      skipped,
      pairs,
      classBProbe,
      fragmentTotals,
    };
  }, { sourceDbId: SOURCE_DB_ID, classBSourceFrag: CLASS_B_SOURCE_FRAG, classBTargetFrag: CLASS_B_TARGET_FRAG });
}

async function main() {
  const pingRes = await fetch(`http://localhost:${PORT}/`).catch((err) => { throw new Error(`LIVE INFRASTRUCTURE FAILURE: dev server at localhost:${PORT} is not reachable: ${err.message}`); });
  if (pingRes.status !== 200) throw new Error(`LIVE INFRASTRUCTURE FAILURE: dev server at localhost:${PORT} returned HTTP ${pingRes.status}`);

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote'],
  });
  const browserVersion = await browser.version();
  let commitSha = null;
  try { commitSha = execSync('git rev-parse HEAD', { cwd: process.cwd() }).toString().trim(); } catch { /* best-effort provenance only */ }

  let outcome;
  try {
    const page = await browser.newPage();
    const identity = await loadFixtureAndReconfirm(page);
    outcome = await runProductionQueryAndReplay(page);
    outcome.fixtureIdentity = identity;
  } finally {
    await browser.close();
  }

  console.log('=== Regression B: operand-swap invariance at the wrapper, replayed over real pairs ===');
  console.log(`Real pair count this run: ${outcome.reconstructedCount} (selected ${outcome.selectedCount}, skipped ${outcome.skipped.length}) -- NOT "106", see file header.`);
  if (outcome.skipped.length) console.log('Skipped (could not reconstruct):', JSON.stringify(outcome.skipped, null, 2));
  console.log('Class-B pair (structure frag 537 -> 427) direct probe:', JSON.stringify(outcome.classBProbe, null, 2));

  const failures = [];
  for (const p of outcome.pairs) {
    const label = `frag ${p.sourceFragId} -> ${p.targetFragId} (production reason: ${p.productionReason})`;
    for (const [check, passed] of Object.entries(p.checks)) {
      try {
        assert.ok(passed, `[${label}] ${check} failed`);
      } catch (err) {
        failures.push(err.message);
        console.error(`FAIL ${err.message}`);
      }
    }
  }

  if (outcome.reconstructedCount === 0) {
    failures.push('No pairs were reconstructed at all -- the population is empty or every pair failed reconstruction. This test cannot assert invariance over zero pairs.');
    console.error(failures[failures.length - 1]);
  }

  await mkdir(RESULTS_DIR, { recursive: true });
  const reportPath = `${RESULTS_DIR}/operand-swap-replay-${Date.now()}.json`;
  await writeFile(reportPath, JSON.stringify({
    meta: {
      description: 'Task A4.2 (design doc §11 regression B): operand-swap invariance at the volumeOverlapQuery wrapper, replayed over REAL same-model crossing-diagnostic pairs from a rebuilt §6.5a-style harness against the current live fixture. This is NOT "the 106-pair set" -- see the script header and task-A4.2-report.md for why no such static fixture exists.',
      commitSha, browserVersion, port: PORT, sourceDbId: SOURCE_DB_ID,
      urns: { arch: ARCH_URN, structure: STRUCTURE_URN, mechanical: MECHANICAL_URN },
      recordedAt: new Date().toISOString(),
    },
    fixtureIdentity: outcome.fixtureIdentity,
    fragmentTotals: outcome.fragmentTotals,
    totalDiagnostics: outcome.totalDiagnostics,
    pairCount: outcome.pairCount,
    selectedCount: outcome.selectedCount,
    reconstructedCount: outcome.reconstructedCount,
    skipped: outcome.skipped,
    classBProbe: outcome.classBProbe,
    pairs: outcome.pairs,
    failureCount: failures.length,
  }, null, 2));
  console.log(`\nRetained per-session report: ${reportPath}`);

  if (failures.length) {
    console.error(`\n${failures.length} assertion(s) failed across ${outcome.reconstructedCount} replayed pairs.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nPASS: all ${outcome.reconstructedCount} replayed pairs are invariant under operand-order exchange at the wrapper (overlap/conclusive/inconclusiveCauses/diagnostic-reason-multiset/crossing-counters/orientForCrossing selection).`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
