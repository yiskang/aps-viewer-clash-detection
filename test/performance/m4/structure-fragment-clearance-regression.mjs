// test/performance/m4/structure-fragment-clearance-regression.mjs
//
// three-mesh-bvh correctness patch plan -- Task 2 (RED): a LIVE regression script against the real
// federated Audubon package that demonstrates one specific real-world manifestation of Defect 1
// (the stale module-global `obb2` in three-mesh-bvh@0.9.14's `closestPointToGeometry*`, see
// `docs/research/m4-three-mesh-bvh-correctness-blocker-adjudication.md` Step 1.1/2.1) on the
// CURRENTLY UNPATCHED dependency.
//
// This is NOT a `node --test` file (see Global Constraint 10 -- plain `npm test` must never require
// a live dev server / live APS credentials). Run it directly:
//
//   node test/performance/m4/structure-fragment-clearance-regression.mjs
//
// with the dev server already running on PORT (default 8080; `npm start`, per Global Constraint 11).
//
// The exact numbers below are re-derived from, and must match:
//   - docs/research/m4-three-mesh-bvh-correctness-blocker-adjudication.md §2.1 and Step 4 mandatory
//     test 3 (both already carry the same `structure:2761 -> structure:3980`,
//     0.026129089841138233/0.03193299065509384, and fragment-pair-358<->461 numbers this script
//     asserts -- that is this repo's one committed, always-available source of truth for them).
//   - The original live reproduction that first surfaced these numbers was a now-superseded,
//     gitignored working investigation (Milestone 4's own S2 clearance-divergence session); its
//     substantive findings were independently re-established from scratch by the adjudication doc
//     above (its own §1 explains why), so this script does not depend on that working file existing.
//
// One dbId pair, `structure:2761 -> structure:3980` (`mode: 'clearance', clearance: 0.05`), is served
// by four fragment pairs. Fragment 461 (target) is a 2-triangle sheet -- its MeshBVH is a single node
// (`rootIsLeaf: true`), which is exactly the condition Defect 1 requires: three-mesh-bvh's own
// `shapecastTraverse` never calls `intersectsBounds` on a root-is-leaf node, so the module-global
// `obb2` singleton `closestPointToGeometry*` reads during the NESTED traversal is left over from
// whichever `closestPointToGeometry` call ran immediately before -- not initialised from this call's
// own anchor bounds. Depending on evaluation order (which the broad-phase choice happens to control,
// though the defect is not "a TLAS bug" -- see the investigation doc's "Consequences" section), the
// fragment pair `358 <-> 461` either resolves correctly (`hit`, distance 0.026129089841138233) or is
// wrongly pruned to `beyond-threshold`/`null`, which promotes fragment pair `358 <-> 383`'s worse
// distance (0.03193299065509384) to the dbId pair's reported minimum.
//
// On the unpatched dependency this reproduced on the `tlas` broadPhase arm: `358 <-> 461` came back
// `beyond-threshold` and the dbId pair reported 0.03193299065509384 instead of the correct
// 0.026129089841138233. This script asserts the CORRECT numbers on BOTH arms; the dependency patch
// has since landed (docs/research/m4-three-mesh-bvh-patch-provenance.md) and this script is now a
// GREEN regression test -- a failure here means a real regression, not an expected pre-patch state.
// This script must not, and does not, patch anything: it only observes.

import { chromium } from 'playwright';
import assert from 'node:assert/strict';

// URNs copied verbatim from test/performance/run-gate-m4.mjs:42-44 -- the same real 3-discipline
// federated Revit host+links Audubon package every M1-M4 gate uses.
const ARCH_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fQXJjaGl0ZWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const STRUCTURE_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fU3RydWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const MECHANICAL_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fTWVjaGFuaWNhbF9jbGFzaF90ZXN0LnJ2dA';
const PORT = process.env.PORT || 8080;

const SOURCE_DB_ID = 2761;       // Structure model
const TARGET_DB_ID = 3980;       // Structure model -- the dbId pair whose fragment 358<->461 exposes Defect 1
const CLEARANCE = 0.05;
const SOURCE_FRAGMENT_ID = 358;  // owner of dbId 2761, the non-anchor (1472-triangle) operand
const TARGET_FRAGMENT_ID = 461;  // owner of dbId 3980, the anchor -- a 2-triangle sheet, rootIsLeaf: true
const EXPECTED_DISTANCE = 0.026129089841138233;
// Recorded for the report only -- never asserted as a pass condition. This is what the TLAS arm
// currently (wrongly) reports on the unpatched dependency, per the investigation doc.
const KNOWN_UNPATCHED_TLAS_WRONG_DISTANCE = 0.03193299065509384;

// §6.1 steps 1-2, copied/adapted from run-gate-m4.mjs:191-241 (loadFixtureAndReconfirm) -- identical
// 3-step load (Architecture normal load, Structure/Mechanical as-additional via #keep-current-models,
// isLoadDone() AND getData().instanceTree waited on every model) plus live identity re-confirmation
// by URN, never by load-order/array-index alone. Stashes the three resolved models on
// `window.__gate` for the arm runner below.
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
      hasArch: !!modelArch,
      hasStructure: !!modelStructure,
      hasMechanical: !!modelMechanical,
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

// One fresh CollisionWorld per arm (mirroring the M4 gate's per-tuple fresh-world discipline --
// run-gate-m4.mjs's own `runArmTuple`), scoped to exactly the query the brief calls for: a single
// source dbId against every loaded model, grouped by dbId. `setDiagnosticEventRecorder` captures
// every `clearance-distance-query` event so the fragment-pair-level outcome for 358<->461 can be
// inspected directly, the same mechanism run-gate-m4.mjs and
// test/CollisionWorld.diagnosticEvents.test.mjs already use.
async function runClearanceArm(page, broadPhase) {
  return page.evaluate(async ({ broadPhase, sourceDbId, clearance }) => {
    const { CollisionWorld } = await import('/collision/index.js');
    const sched = await import('/collision/scheduler.js');
    const { modelArch, modelStructure, modelMechanical } = window.__gate;
    const modelTag = (m) => (m === modelArch ? 'arch' : m === modelStructure ? 'structure' : m === modelMechanical ? 'mechanical' : 'unknown');

    const diagnosticEvents = [];
    sched.setDiagnosticEventRecorder((kind, payload) => {
      if (kind === 'clearance-distance-query') diagnosticEvents.push(payload);
    });

    let world = null;
    try {
      world = await CollisionWorld.fromViewer(window.viewer);
      world.admitModel(modelArch);
      // codex-review (medium, request 20260910-214048-2506-3993, Important #1): a fragmentId is
      // model-local, not globally unique across this federation -- Architecture or Mechanical could
      // in principle also own a fragment numbered 358/461. The lease's own `.epoch` is captured here
      // so the caller can require BOTH fragmentId AND epoch to match the Structure model specifically
      // when picking the `358<->461` diagnostic event out of the recorded array below, rather than
      // relying on fragmentId alone.
      const structureEpoch = world.admitModel(modelStructure).epoch;
      world.admitModel(modelMechanical);

      const targets = window.viewer.getAllModels().map((m) => ({ model: m }));
      const result = await world.findClashes({
        mode: 'clearance',
        clearance,
        source: { model: modelStructure, dbIds: [sourceDbId] },
        target: { targets },
        groupBy: 'dbId',
        broadPhase,
      });

      return {
        pairs: result.pairs.map((p) => ({
          sourceModelTag: modelTag(p.source.model), sourceDbId: p.source.dbId,
          targetModelTag: modelTag(p.target.model), targetDbId: p.target.dbId,
          type: p.type,
          distance: p.distance ?? null,
        })),
        diagnosticEvents,
        structureEpoch,
      };
    } finally {
      sched.clearDiagnosticEventRecorder();
      if (world) world.dispose();
    }
  }, { broadPhase, sourceDbId: SOURCE_DB_ID, clearance: CLEARANCE });
}

async function main() {
  // Quick sanity re-check of the live infrastructure the controller already preflighted (Global
  // Constraint 11) -- do NOT start a second server, do NOT try to work around a failure here.
  const pingRes = await fetch(`http://localhost:${PORT}/`).catch((err) => { throw new Error(`LIVE INFRASTRUCTURE FAILURE: dev server at localhost:${PORT} is not reachable: ${err.message}`); });
  if (pingRes.status !== 200) throw new Error(`LIVE INFRASTRUCTURE FAILURE: dev server at localhost:${PORT} returned HTTP ${pingRes.status}`);

  const browser = await chromium.launch();
  const results = {};
  try {
    const page = await browser.newPage();
    await loadFixtureAndReconfirm(page);

    for (const broadPhase of ['tlas', 'linear']) {
      results[broadPhase] = await runClearanceArm(page, broadPhase);
    }
  } finally {
    await browser.close();
  }

  console.log('=== structure:2761 -> structure:3980 clearance regression (Defect 1 -- stale obb2) ===');
  console.log(JSON.stringify(results, null, 2));

  const failures = [];
  for (const broadPhase of ['tlas', 'linear']) {
    const r = results[broadPhase];
    const pair = r.pairs.find((p) => (
      p.sourceModelTag === 'structure' && p.sourceDbId === SOURCE_DB_ID
      && p.targetModelTag === 'structure' && p.targetDbId === TARGET_DB_ID
    ));
    try {
      assert.ok(pair, `[${broadPhase}] pair structure:${SOURCE_DB_ID} -> structure:${TARGET_DB_ID} not found in result.pairs`);
      assert.equal(pair.distance, EXPECTED_DISTANCE, `[${broadPhase}] structure:${SOURCE_DB_ID} -> structure:${TARGET_DB_ID} distance: expected ${EXPECTED_DISTANCE}, got ${pair.distance}`);
    } catch (err) {
      failures.push(err.message);
      console.error(`FAIL [${broadPhase}] ${err.message}`);
    }

    // codex-review (medium, request 20260910-214048-2506-3993, Important #1): a fragmentId is
    // model-local, not globally unique across the 3-model federation this query runs against --
    // matching on fragmentId alone could in principle pick up an unrelated model's own fragment
    // 358/461. Both fragments involved in this regression belong to the Structure model (dbId 2761
    // AND dbId 3980 are both Structure elements, per the investigation's fragment-level ground-truth
    // table), so requiring BOTH sourceEpoch and targetEpoch to equal this arm's own Structure
    // admission epoch pins the match to the Structure model specifically.
    const fragEvent = r.diagnosticEvents.find((e) => (
      e.sourceFragmentId === SOURCE_FRAGMENT_ID && e.targetFragmentId === TARGET_FRAGMENT_ID
      && e.sourceEpoch === r.structureEpoch && e.targetEpoch === r.structureEpoch
    ));
    try {
      assert.ok(fragEvent, `[${broadPhase}] no clearance-distance-query diagnostic event for Structure fragment pair ${SOURCE_FRAGMENT_ID}<->${TARGET_FRAGMENT_ID} (epoch ${r.structureEpoch})`);
      assert.equal(fragEvent.outcome, 'hit', `[${broadPhase}] fragment pair ${SOURCE_FRAGMENT_ID}<->${TARGET_FRAGMENT_ID}: expected outcome 'hit', got '${fragEvent.outcome}' (distance ${fragEvent.distance ?? 'null'})`);
      // codex-review (low, request 20260910-214048-2506-3993, Testing Gaps #1): outcome === 'hit'
      // alone doesn't prove the CORRECT geometric result -- assert the fragment-level distance
      // against the investigation doc's recorded ground truth too.
      assert.equal(fragEvent.distance, EXPECTED_DISTANCE, `[${broadPhase}] fragment pair ${SOURCE_FRAGMENT_ID}<->${TARGET_FRAGMENT_ID}: expected distance ${EXPECTED_DISTANCE}, got ${fragEvent.distance}`);
    } catch (err) {
      failures.push(err.message);
      console.error(`FAIL [${broadPhase}] ${err.message}`);
    }
  }

  if (failures.length) {
    console.error(`\n${failures.length} assertion(s) failed. This is a GREEN regression test against the patched three-mesh-bvh@0.9.14 dependency (docs/research/m4-three-mesh-bvh-patch-provenance.md) -- a failure here is a real regression, not an expected state. The pre-patch 'tlas' arm used to fail with known unpatched wrong distance: ${KNOWN_UNPATCHED_TLAS_WRONG_DISTANCE}.`);
    process.exitCode = 1;
    return;
  }

  console.log('\nPASS: both arms report the correct distance and a \'hit\' outcome for fragment pair 358<->461.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
