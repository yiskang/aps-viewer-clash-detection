// test/performance/run-gate-m4.mjs
//
// M4 Task 3.1: the runtime/fixture lifecycle skeleton for the M4 (Worker-vs-main-thread decision)
// performance gate. Sibling to test/performance/run-gate.mjs (M1), run-gate-m2.mjs (M2), and
// run-gate-m3.mjs (M3) -- ALL THREE of which are UNTOUCHED by this file (protected invariant).
//
// This file proves §6.1 steps 1-4 (launch -> load -> live re-confirm -> sacrificial warm-up ->
// fresh-world construct/dispose) end to end, over BOTH RUNTIME_CONFIGS entries (`historical` and
// `multiProcess` -- see test/performance/m4/fixture-lifecycle.mjs), with exactly ONE throwaway
// query per runtime. It deliberately does NOT wire the real R1-R6/S1-S4/S2T case matrix (task 3.7)
// or the observation envelope (task 3.2) -- those are later tasks. No span recorder is installed
// anywhere in this file; nothing here is "measured" in the M4 sense yet.
//
// Run: node test/performance/run-gate-m4.mjs   (npm run test:performance:gate:m4)

// The fixture: the SAME real 3-discipline federated Revit host+links Audubon package M1-M3's gates
// use (URNs copied verbatim from run-gate-m3.mjs:66-68). See run-gate-m3.mjs's own header for the
// full provenance/fragment-count rationale -- not re-derived here since Task 3.1 makes no new claim
// about the fixture's content, only about the lifecycle around it.
const ARCH_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fQXJjaGl0ZWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const STRUCTURE_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fU3RydWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const MECHANICAL_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fTWVjaGFuaWNhbF9jbGFzaF90ZXN0LnJ2dA';
const SOURCE_DB_ID = 3076; // Structure model (index 1) -- see run-gate-m3.mjs's header comment.
const CLEARANCE = 0.05;    // DEFAULT_CLEARANCE (ClashFinderExtension.js:60), model units.
const PORT = process.env.PORT || 8080;
const RESULTS_DIR = 'test/performance/results';

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { RUNTIME_CONFIGS, resolveProxyFromEnv, freshWorldTupleKey, measuredStatesFor } from './m4/fixture-lifecycle.mjs';

// §6.1 steps 1-2: identical 3-step load + identity re-confirmation to run-gate-m3.mjs:194-242,
// unchanged in shape (Architecture normal load, Structure/Mechanical as-additional via
// #keep-current-models, isLoadDone() AND getData().instanceTree waited on every model, live
// re-confirmation of model count and source dbId ownership -- "nothing taken on faith").
async function loadFixtureAndReconfirm(page) {
  await page.goto(`http://localhost:${PORT}/#${ARCH_URN}`);
  await page.waitForFunction(() => window.viewer && window.viewer.model && window.viewer.model.isLoadDone(), null, { timeout: 180_000 });

  await page.fill('#urn', STRUCTURE_URN);
  await page.check('#keep-current-models');
  await page.click('#load');
  await page.waitForFunction(() => window.viewer.getAllModels().length === 2 && window.viewer.getAllModels().every((m) => m.isLoadDone()), null, { timeout: 180_000 });
  await page.waitForFunction(() => window.viewer.getAllModels().every((m) => m.getData() && m.getData().instanceTree), null, { timeout: 180_000 });

  await page.fill('#urn', MECHANICAL_URN);
  await page.check('#keep-current-models'); // idempotent -- already checked, re-asserted defensively
  await page.click('#load');
  await page.waitForFunction(() => window.viewer.getAllModels().length === 3 && window.viewer.getAllModels().every((m) => m.isLoadDone()), null, { timeout: 180_000 });
  await page.waitForFunction(() => window.viewer.getAllModels().every((m) => m.getData() && m.getData().instanceTree), null, { timeout: 180_000 });

  const identity = await page.evaluate(({ sourceDbId }) => {
    const models = window.viewer.getAllModels();
    window.__gate = { modelArch: models[0], modelStructure: models[1], modelMechanical: models[2] };
    const it = models[1].getInstanceTree(); // Structure
    const fragments = [];
    it.enumNodeFragments(sourceDbId, (fragId) => { fragments.push(fragId); }, false);
    return { modelCount: models.length, sourceFragmentCount: fragments.length };
  }, { sourceDbId: SOURCE_DB_ID });
  if (identity.modelCount !== 3) {
    throw new Error(`Expected exactly 3 loaded models, got ${identity.modelCount}`);
  }
  if (!identity.sourceFragmentCount) {
    throw new Error(`Fixture identity mismatch: source dbId ${SOURCE_DB_ID} in the Structure model owns zero fragments -- cannot exercise the query`);
  }
  return identity;
}

// §6.1 step 3: sacrificial, UNMEASURED warm-up -- identical rationale/shape to
// run-gate-m3.mjs:246-278, extended to both Hard-Clash (volume-overlap) and Soft-Clash
// (clearance) modes, each in its own disposable world, no recorder installed, disposed
// immediately. Warms V8 JIT / module-initialization cost for the shared code path without
// touching any later measured world's cold-start state.
async function sacrificialWarmup(page) {
  await page.evaluate(async ({ sourceDbId, clearance }) => {
    const { CollisionWorld } = await import('/collision/index.js');
    const allModels = window.viewer.getAllModels();
    for (const mode of ['volume-overlap', 'clearance']) {
      for (const broadPhase of ['tlas', 'linear']) {
        const w = await CollisionWorld.fromViewer(window.viewer);
        w.admitModel(window.__gate.modelArch);
        w.admitModel(window.__gate.modelStructure);
        w.admitModel(window.__gate.modelMechanical);
        try {
          await w.findClashes({
            mode,
            ...(mode === 'clearance' ? { clearance } : {}),
            source: { model: window.__gate.modelStructure, dbIds: [sourceDbId] },
            target: { targets: allModels.map((m) => ({ model: m })) },
            groupBy: 'dbId',
            broadPhase,
          });
        } catch { /* warm-up only -- any error here is irrelevant to later measured runs */ }
        w.dispose();
      }
    }
  }, { sourceDbId: SOURCE_DB_ID, clearance: CLEARANCE });
}

async function main() {
  await mkdir(RESULTS_DIR, { recursive: true });
  for (const runtime of Object.values(RUNTIME_CONFIGS)) {
    console.log(`\n=== Runtime: ${runtime.label} ===`);
    const browser = await chromium.launch({ args: runtime.args, proxy: resolveProxyFromEnv() });
    const page = await browser.newPage();
    try {
      const identity = await loadFixtureAndReconfirm(page);
      console.log('Fixture identity (re-confirmed live):', JSON.stringify(identity));

      await sacrificialWarmup(page);
      console.log('Sacrificial warm-up complete (unmeasured, no recorder installed).');

      // Task 3.1 proof: exactly ONE fresh-world tuple, dispose demonstrated. Task 3.7 replaces
      // this block with the real R1-R6/S1-S4/S2T matrix loop.
      const tupleKey = freshWorldTupleKey({ runtime: runtime.label, caseName: 'R1', broadPhase: 'tlas', repetition: 0 });
      console.log(`Fresh-world lifecycle proof tuple: ${tupleKey}, states: ${measuredStatesFor('R1')}`);
      await page.evaluate(async ({ sourceDbId }) => {
        const { CollisionWorld } = await import('/collision/index.js');
        const w = await CollisionWorld.fromViewer(window.viewer);
        w.admitModel(window.__gate.modelArch);
        w.admitModel(window.__gate.modelStructure);
        w.admitModel(window.__gate.modelMechanical);
        await w.findClashes({
          mode: 'volume-overlap',
          source: { model: window.__gate.modelStructure, dbIds: [sourceDbId] },
          target: { targets: window.viewer.getAllModels().map((m) => ({ model: m })) },
          groupBy: 'dbId',
          broadPhase: 'tlas',
        });
        w.dispose(); // fresh-world disposed before the next tuple, per §6.1.4
      }, { sourceDbId: SOURCE_DB_ID });
      console.log('Fresh-world construct/dispose lifecycle OK.');
    } finally {
      await browser.close();
    }
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
