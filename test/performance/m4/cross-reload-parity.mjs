// test/performance/m4/cross-reload-parity.mjs
//
// Task D3 (canonical-ordering/operand-symmetry fix implementation plan, Phase D):
// docs/superpowers/specs/2026-09-11-canonical-ordering-operand-symmetry-fix-design.md
// §11 regression E, regression C's cross-load half, the two pending §9.2 measurements, and
// regression F part (b). See that design doc and
// docs/research/m4-effect-b-precheck-diagnostic-nondeterminism-investigation.md (§6.4-6.8) for the
// full background this task closes.
//
// Design (validated by codex-advisor, request 20260912-044359-20626-30617, before any code was
// written):
//  - Imports (never re-implements) run-gate-m4.mjs's own fixture-load idiom, in-page query runner,
//    and the UNMODIFIED §6.4 comparator (`compareRunsAtPairScale`) -- a standalone duplicate would
//    either use a weaker witness tolerance or risk comparator drift, both forbidden by this plan's
//    standing directive against touching/relaxing §6.4.
//  - Dispatched from run-gate-m4.mjs's own CLI via `--d3-cross-reload` (see that file's bottom),
//    never invoked directly with `node cross-reload-parity.mjs`, since it needs those imports.
//  - Runs ONE sequence of LOAD_COUNT genuinely independent fixture loads (a baseline
//    `loadFixtureAndReconfirm` plus (LOAD_COUNT-1) genuine `page.reload()` + `loadFixtureAndReconfirm`
//    transitions -- the EXACT idiom run-gate-m4.mjs's own `attributionPoisoned` recovery path uses,
//    current lines ~3236-3251 at the time this task was written) that serves all four
//    sub-requirements at once, to minimize live-browser time:
//      (a) regression E: every load's whole-query `run` compared against the baseline load's own via
//          the unmodified §6.4 comparator -- this both IS the "two independent loads" case (load 0
//          vs load 1) and, since every later load is produced via a genuine `page.reload()`, also
//          covers the "mid-run reload" case generalized to N-1 reload transitions instead of 1.
//      (b) regression C's cross-load half: the exact real class-B pair (structure frag 537 -> 427)
//          plus 5 real target fragments freshly discovered, at load 0, from the CURRENT (post-fix)
//          build's own `inconclusive-crossing` diagnostic population (never `crossing-budget-
//          exhausted`, a different diagnostic reason -- codex-review finding, request
//          20260912-052619-75504-18065). Honest limitation, carried over from Task A4.2's own
//          exhaustive search: the ORIGINAL research doc's literal 36-fragment list was never
//          persisted anywhere in this repo ("two throwaway Playwright harnesses ... never added to
//          the repo" -- research doc §3.3), so this sample cannot be proven to be drawn from that
//          exact historical set. It is the best available, honestly-labeled proxy: real fragments
//          the CURRENT build itself still finds ambiguous via the identical mechanism (Effect B)
//          the historical 36 were selected by, fingerprinted at every load.
//      (c) §9.2: the Structure model's fragId -> (worldMatrixHash, ownerDbId) map, captured at
//          every load and required identical; the world-matrix-sharing count is reported once, from
//          the baseline load, purely informational.
//      (d) regression F(b): a controlled (non-geometric, per codex-advisor's explicit
//          recommendation against manufacturing an exact geometric tie) aggregation-determinism
//          probe using a fixed real fragment against a WIDE pool of other real fragments (never one
//          hand-picked pair -- empirically necessary, see reversalStatusByCandidate below), each
//          with REAL, load-varying `geometryIndex`, run at every load.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  loadFixtureAndReconfirm, installGateHelpers, runQueryInPage, compareRunsAtPairScale,
  PORT, RESULTS_DIR, SOURCE_DB_ID, CLEARANCE,
} from '../run-gate-m4.mjs';

const LOAD_COUNT = 8; // 1 baseline + at least 7 genuine page.reload() transitions -- comfortably
                       // >= the design doc's "N >= 5 independent page loads" floor for regression C.
                       // The suite keeps loading PAST this floor (see MAX_LOADS) until a genuine
                       // geometryIndex relative-order reversal is observed for the F(b) probe pair
                       // (codex-advisor finding #3 / codex-review finding #1: a changed id is not
                       // sufficient, an ACTUAL reversal is required for the test to have teeth).
const MAX_LOADS = 24;  // Hard cap so a pathological fixture (one that never reverses this specific
                       // pair) cannot loop forever; hitting this cap is reported as a Regression
                       // F(b) failure, never silently downgraded to a pass.
const SAMPLE_SIZE = 5; // design doc §11 C's "a sample of >= 5" unstable inconclusive-crossing target
                        // fragments.
const CLASS_B_SOURCE_FRAG = 537; // structure frag 537 -> structure frag 427 (design doc §11 C,
const CLASS_B_TARGET_FRAG = 427; // pinned live by Task A4.2/A4.3; both Structure fragments).
const FB_SYNTHETIC_TARGET_DBID = -999001; // never a real Viewer dbId (always positive) -- used ONLY
                                           // to force two real, distinct target fragments to share
                                           // one aggregation key for regression F(b)'s probe (see
                                           // runFbProbe below); never written back to the live world.
// Deliberately NOT derived from real geometry (codex-advisor's explicit recommendation): natural
// real-mesh clearance distances essentially never tie bit-for-bit, and manufacturing an exact
// geometric tie via placement math would introduce floating-point fragility into a regression whose
// actual subject is aggregation IDENTITY, not distance computation. `_runClearanceNarrowPhasePair`
// is monkeypatched to return these fixed, hand-picked values directly (see runFbProbe).
const FB_FIXED_DISTANCE = 0.012345;
const FB_WITNESS_A = { sourcePoint: [0, 0, 0], targetPoint: [1, 0, 0] };
const FB_WITNESS_B = { sourcePoint: [0, 0, 0], targetPoint: [2, 0, 0] };

async function pingServer() {
  const res = await fetch(`http://localhost:${PORT}/`).catch((err) => {
    throw new Error(`LIVE INFRASTRUCTURE FAILURE: dev server at localhost:${PORT} is not reachable: ${err.message}`);
  });
  if (res.status !== 200) throw new Error(`LIVE INFRASTRUCTURE FAILURE: dev server at localhost:${PORT} returned HTTP ${res.status}`);
}

async function buildWorldHandle(page) {
  return page.evaluateHandle(async () => {
    const { CollisionWorld } = await import('/collision/index.js');
    const w = await CollisionWorld.fromViewer(window.viewer);
    w.admitModel(window.__gate.modelArch);
    w.admitModel(window.__gate.modelStructure);
    w.admitModel(window.__gate.modelMechanical);
    return w;
  });
}

// The one query compared across loads for regression E -- identical descriptor every time, fed
// through the REAL gate's own `runQueryInPage` (imported, unmodified) so the `run` shape it produces
// is guaranteed compatible with `compareRunsAtPairScale` (also imported, unmodified).
async function runMainQuery(page) {
  const world = await buildWorldHandle(page);
  try {
    const result = await runQueryInPage(page, world, {
      mode: 'clearance',
      clearance: CLEARANCE,
      source: { modelKey: 'structure', dbIds: [SOURCE_DB_ID] },
      targets: 'all',
      broadPhase: 'tlas',
    });
    if (result.capacityError || result.otherError) {
      throw new Error(`LIVE INFRASTRUCTURE FAILURE: the regression-E query itself failed: ${JSON.stringify(result.capacityError ?? result.otherError)}`);
    }
    return result;
  } finally {
    await page.evaluate((w) => w.dispose(), world);
  }
}

// One page.evaluate doing everything else this task needs for one load: (optionally) discovering
// the current same-model crossing-diagnostic population (load 0 only), pinning the class-B pair plus
// the frozen 5-fragment sample's exact disposition via DIRECT reconstruction + direct calls to the
// real `classifyHardClashPrecheck`/`volumeOverlapQuery` (never re-derived/re-implemented), capturing
// the Structure model's full fragId identity map (§9.2), and running the regression F(b) probe.
async function runDeepCapture(page, { discover, sampleTargetFrags, fbCandidateFrags }) {
  return page.evaluate(async ({ sourceDbId, classBSource, classBTarget, sampleTargetFrags, discover, fbSyntheticTargetDbId, fbDistance, fbWitnessA, fbWitnessB, fbCandidateFrags }) => {
    const { CollisionWorld, compareAggregationIdentity, toInstance } = await import('/collision/CollisionWorld.js');
    const { classifyHardClashPrecheck } = await import('/collision/query/ClearanceHardClashPrecheck.js');
    const { volumeOverlapQuery } = await import('/collision/query/VolumeOverlapQuery.js');
    const { computeContentDigest } = await import('/collision/geometry/contentDigest.js');

    const { modelStructure } = window.__gate;
    const world = await CollisionWorld.fromViewer(window.viewer);
    world.admitModel(window.__gate.modelArch);
    const structureLease = world.admitModel(modelStructure);
    world.admitModel(window.__gate.modelMechanical);
    const structureEpoch = structureLease.epoch;

    // IMPORTANT: `_instanceCache`/`_placementByEpoch` are populated LAZILY, by `_recordPlacement`
    // during a `findClashes` call's own extraction step -- `admitModel` alone never populates them.
    // `reconstruct()` below therefore needs SOME prior `findClashes` call on THIS world whose
    // extraction scope covers every Structure fragment this task touches (the class-B pair, the
    // frozen sample, and every fragment in the §9.2 map) -- this ONE volume-overlap run (source
    // dbId 3076, target = the whole Structure model, so target-scope extraction covers all 543
    // fragments) is run at EVERY load, not just load 0, for exactly that reason. Its diagnostics are
    // additionally used for discovery, but ONLY when `discover` is true (load 0) -- a bug caught by
    // running the live suite once (fixed before trusting any result): the very first live run's
    // load 0 class-B check came back `NOT_EXTRACTED` because this call was originally gated on
    // `discover` alone, so no load past the first ever populated the caches at all.
    const warmupResult = await world.findClashes({
      mode: 'volume-overlap',
      source: { model: modelStructure, dbIds: [sourceDbId] },
      target: { targets: [{ model: window.__gate.modelArch }, { model: modelStructure }, { model: window.__gate.modelMechanical }] },
      groupBy: 'dbId',
    });
    let discovered = null;
    if (discover) {
      // Same selection method Task A4.2 established and this task's own brief points back to:
      // select every same-model crossing-diagnostic entry from the ONE production volume-overlap
      // run above, BEFORE any further processing -- so the sample cannot be biased by anything
      // computed later.
      // codex-review (request 20260912-052619-75504-18065, finding #1): the design doc's own text
      // (§11 C) asks specifically for "inconclusive-crossing target fragments" -- `crossing-budget-
      // exhausted` is a DIFFERENT diagnostic reason (Phase C's deterministic-budget mechanism, not
      // the Effect-B coplanarity/ladder ambiguity this regression targets) and must not be admitted
      // into the sample, even though the CollisionWorld.js reconstruction site itself always treats
      // (and always did) both reasons as "the crossing-diagnostic population" for other purposes.
      const seen = new Set();
      discovered = [];
      for (const d of warmupResult.statistics.diagnostics ?? []) {
        if (d.scope !== 'pair') continue;
        if (d.reason !== 'inconclusive-crossing') continue;
        if (!d.sourceFragment || !d.targetFragment) continue;
        if (d.sourceFragment.modelId !== d.targetFragment.modelId) continue; // same-model only, per research doc §6.6
        const key = `${d.sourceFragment.fragId}->${d.targetFragment.fragId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        discovered.push({ sourceFragId: d.sourceFragment.fragId, targetFragId: d.targetFragment.fragId, reason: d.reason });
      }
    }

    async function reconstruct(fragmentId) {
      const instanceRecord = world._instanceCache.get(structureEpoch)?.get(fragmentId);
      const placement = world._placementByEpoch.get(structureEpoch)?.get(fragmentId);
      if (!instanceRecord || !placement) return null;
      const record = await world._registry.getOrBuildGeometry({
        loadEpoch: structureEpoch,
        geometryIndex: instanceRecord.geometryIdentity.geometryIndex,
        ownerModelIdHint: placement.modelId,
        needsConnectivity: true,
        role: 'source',
      });
      if (record.oversized) return { oversized: true };
      const instance = toInstance(record, placement.worldMatrix);
      const placed = {
        instance: instanceRecord, worldMatrix: placement.worldMatrix,
        worldBounds: placement.worldBounds, ownerDbId: placement.ownerDbId,
      };
      return { instance, placed };
    }

    async function checkDisposition(sourceFragId, targetFragId) {
      const src = await reconstruct(sourceFragId);
      const tgt = await reconstruct(targetFragId);
      if (!src || !tgt || src.oversized || tgt.oversized) {
        return { sourceFragId, targetFragId, extracted: false };
      }
      const precheck = await classifyHardClashPrecheck(src.instance, tgt.instance, src.placed.worldBounds, tgt.placed.worldBounds, {});
      const overlap = await volumeOverlapQuery(src.instance, tgt.instance, {});
      return {
        sourceFragId, targetFragId, extracted: true,
        disposition: precheck.status, // 'excluded' | 'inconclusive' | 'proceed' | 'skip-precheck'
        conclusive: overlap.conclusive,
        inconclusiveCauses: [...(overlap.inconclusiveCauses ?? [])].sort(),
        contributedToHardClashExclusions: precheck.status === 'excluded',
        distanceQueryRan: precheck.status === 'proceed' || precheck.status === 'skip-precheck',
      };
    }

    const classBResult = await checkDisposition(classBSource, classBTarget);
    const sampleResults = [];
    for (const { sourceFragId, targetFragId } of sampleTargetFrags) {
      sampleResults.push(await checkDisposition(sourceFragId, targetFragId));
    }

    // §9.2: fragId -> (worldMatrixHash, ownerDbId), plus geometryIndex kept alongside (needed by
    // regression F(b)'s offline reversal search, never itself part of the §9.2 assertion).
    const fragMap = {};
    for (const [fragId, instanceRecord] of world._instanceCache.get(structureEpoch) ?? []) {
      const placement = world._placementByEpoch.get(structureEpoch)?.get(fragId);
      if (!placement) continue;
      const bytes = new Uint8Array(new Float64Array(placement.worldMatrix).buffer);
      fragMap[fragId] = {
        worldMatrixHash: computeContentDigest([bytes]),
        ownerDbId: placement.ownerDbId,
        geometryIndex: instanceRecord.geometryIdentity.geometryIndex,
      };
    }

    // Regression F(b): fragA is fixed (class-B's own target fragment); fragB ranges over a WIDE
    // candidate pool (not one fixed pair) so the search for a genuine geometryIndex relative-order
    // reversal does not depend on luck with a single arbitrarily-chosen partner fragment -- a real
    // live run (before this fix) went 14 consecutive page.reload() transitions without a single
    // pair reversal for one fixed (fragA, fragB), which is far more consistent with "this ONE pair
    // rarely reverses" than with "geometryIndex never reassigns under reload" (the surrounding §9.2
    // map DOES show fragId identity is stable while geometryIndex itself is known, from prior
    // research, to be reload-unstable in aggregate). All candidates share the fixed source (537) and
    // a shared SYNTHETIC target ownerDbId, applied ONLY on local wrapper objects -- the live
    // world/registry state is never mutated.
    async function runFbProbe(fragA, fragB) {
      if (fragA === fragB) return { fragA, fragB, skipped: true, reason: 'fragA === fragB' };
      const srcOp = await reconstruct(classBSource);
      const aOp = await reconstruct(fragA);
      const bOp = await reconstruct(fragB);
      if (!srcOp || !aOp || !bOp || srcOp.oversized || aOp.oversized || bOp.oversized) {
        return { fragA, fragB, skipped: true, reason: 'one or more operands unavailable/oversized this load' };
      }
      const placedSource = srcOp.placed;
      const placedA = { ...aOp.placed, ownerDbId: fbSyntheticTargetDbId };
      const placedB = { ...bOp.placed, ownerDbId: fbSyntheticTargetDbId };
      const fbWorld = await CollisionWorld.fromViewer(window.viewer);
      const fbStructureLease = fbWorld.admitModel(modelStructure);
      let callIndex = 0;
      fbWorld._runClearanceBroadPhaseScan = async () => [
        [placedSource, placedA, fbStructureLease],
        [placedSource, placedB, fbStructureLease],
      ];
      fbWorld._runClearanceNarrowPhasePair = async (sourcePlaced, targetPlaced, sourceOperand, targetOperand) => {
        const witness = callIndex === 0 ? fbWitnessA : fbWitnessB;
        callIndex += 1;
        return { outcome: 'hit', distance: fbDistance, witness, sourcePlaced, targetPlaced, targetOperand };
      };
      const fbFindResult = await fbWorld.findClashes({
        mode: 'clearance', clearance: 999999, // never lets the synthetic geometric bounds matter -- the stub bypasses real distance filtering entirely
        source: { model: modelStructure, dbIds: [placedSource.ownerDbId] },
        target: { targets: [{ model: modelStructure }] },
        groupBy: 'dbId',
        broadPhase: 'linear',
      });
      fbWorld.dispose();
      const pair = fbFindResult.pairs.find((p) => p.target.dbId === fbSyntheticTargetDbId);
      const expectedWinnerFragId = Math.min(fragA, fragB);
      const cmp = compareAggregationIdentity(placedA, placedB); // < 0 means placedA (fragA) wins
      return {
        fragA, fragB, skipped: false,
        geometryIndexA: aOp.placed.instance.geometryIdentity.geometryIndex,
        geometryIndexB: bOp.placed.instance.geometryIdentity.geometryIndex,
        compareAggregationIdentitySign: Math.sign(cmp),
        expectedWinnerFragId,
        pairFound: !!pair,
        distance: pair?.distance ?? null,
        witness: pair?.witness ?? null,
      };
    }

    const fbResults = [];
    for (const fragB of fbCandidateFrags) {
      fbResults.push(await runFbProbe(classBTarget, fragB));
    }

    world.dispose();
    return { classBResult, sampleResults, fragMap, discovered, fbResults };
  }, {
    sourceDbId: SOURCE_DB_ID, classBSource: CLASS_B_SOURCE_FRAG, classBTarget: CLASS_B_TARGET_FRAG,
    sampleTargetFrags, discover, fbCandidateFrags: fbCandidateFrags ?? [],
    fbSyntheticTargetDbId: FB_SYNTHETIC_TARGET_DBID, fbDistance: FB_FIXED_DISTANCE,
    fbWitnessA: FB_WITNESS_A, fbWitnessB: FB_WITNESS_B,
  });
}

// `loadsFbResults` is an array (one entry per load) of arrays (one entry per F(b) candidate B
// fragment, in the SAME fixed order every load). Returns, per candidate `fragB`, whether ANY two
// loads show a genuinely reversed relative geometryIndex order for (fragA, fragB) -- widened from a
// single fixed pair (codex-review-adjacent finding, caught empirically: a live run went 14
// consecutive page.reload() transitions without a single reversal for one fixed pair, which a wider
// candidate pool guards against without needing an unbounded number of extra loads).
function reversalStatusByCandidate(loadsFbResults) {
  const byFragB = new Map(); // fragB -> array of {load, geometryIndexA, geometryIndexB}
  loadsFbResults.forEach((perLoad, loadIndex) => {
    for (const r of perLoad ?? []) {
      if (!r || r.skipped) continue;
      if (!byFragB.has(r.fragB)) byFragB.set(r.fragB, []);
      byFragB.get(r.fragB).push({ load: loadIndex, geometryIndexA: r.geometryIndexA, geometryIndexB: r.geometryIndexB });
    }
  });
  const result = new Map(); // fragB -> boolean (reversal observed)
  for (const [fragB, entries] of byFragB) {
    let reversed = false;
    for (let i = 0; i < entries.length && !reversed; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const orderI = Math.sign(entries[i].geometryIndexA - entries[i].geometryIndexB);
        const orderJ = Math.sign(entries[j].geometryIndexA - entries[j].geometryIndexB);
        if (orderI !== 0 && orderJ !== 0 && orderI !== orderJ) { reversed = true; break; }
      }
    }
    result.set(fragB, reversed);
  }
  return result;
}

function anyReversalObserved(loadsFbResults) {
  const statuses = reversalStatusByCandidate(loadsFbResults);
  return [...statuses.values()].some(Boolean);
}

function fingerprintDisposition(r) {
  if (!r.extracted) return 'NOT_EXTRACTED';
  return JSON.stringify({
    disposition: r.disposition, conclusive: r.conclusive, inconclusiveCauses: r.inconclusiveCauses,
    contributedToHardClashExclusions: r.contributedToHardClashExclusions, distanceQueryRan: r.distanceQueryRan,
  });
}

export async function runCrossReloadParitySuite() {
  await pingServer();
  const browser = await chromium.launch();
  const loads = []; // { load, run, diagonalByTag, deep }
  const failures = [];
  let sampleTargetFrags = null; // hoisted out of the try block -- referenced again in the report below
  let fbCandidateFrags = null;  // ditto
  try {
    const page = await browser.newPage();
    let load = 0;
    // codex-review finding #1 (High, request 20260912-045942-41630-9040): a changed geometryIndex
    // is not sufficient evidence for regression F(b) -- an ACTUAL relative-order reversal between
    // two loads is required, or the probe could vacuously pass even a REGRESSED (pre-fix-style)
    // comparator that never happened to see a reversal. So this loop keeps issuing genuine
    // page.reload() transitions past LOAD_COUNT, up to MAX_LOADS, until BOTH floors are met: at
    // least LOAD_COUNT independent loads (regression C's own >= 5 requirement, with margin) AND at
    // least one observed geometryIndex reversal for SOME F(b) candidate pair (widened pool, not one
    // fixed pair -- see reversalStatusByCandidate's own header comment for why).
    while (true) {
      if (load === 0) {
        await loadFixtureAndReconfirm(page);
      } else {
        // The EXACT idiom run-gate-m4.mjs's own attributionPoisoned recovery path uses.
        await page.reload();
        await loadFixtureAndReconfirm(page);
      }
      await installGateHelpers(page);
      const diagonalByTag = await page.evaluate(() => window.__m4Gate.worldDiagonalsByTag());
      const run = await runMainQuery(page);
      const deep = await runDeepCapture(page, { discover: load === 0, sampleTargetFrags: sampleTargetFrags ?? [], fbCandidateFrags: fbCandidateFrags ?? [] });

      if (load === 0) {
        if (!deep.discovered || deep.discovered.length < SAMPLE_SIZE) {
          throw new Error(`Regression C's cross-load half is infeasible on this fixture: only ${deep.discovered?.length ?? 0} same-model crossing-diagnostic pairs discovered at load 0, need >= ${SAMPLE_SIZE}. (NEEDS_CONTEXT per task brief.)`);
        }
        // codex-review finding #5 (Medium): dedupe by TARGET fragment identity, not by the full
        // (source,target) pair -- the design doc's own text asks for a sample of >= 5 DISTINCT
        // target fragments, and multiple diagnostic entries can share one target fragment paired
        // with different source fragments. CLASS_B_TARGET_FRAG is explicitly excluded from the
        // sample so it can never collide with the fixed F(b) probe partner chosen below.
        const seenTargets = new Set([CLASS_B_TARGET_FRAG]);
        const distinctTargetSample = [];
        for (const d of deep.discovered) {
          if (seenTargets.has(d.targetFragId)) continue;
          seenTargets.add(d.targetFragId);
          distinctTargetSample.push({ sourceFragId: d.sourceFragId, targetFragId: d.targetFragId });
          if (distinctTargetSample.length === SAMPLE_SIZE) break;
        }
        if (distinctTargetSample.length < SAMPLE_SIZE) {
          throw new Error(`Regression C's cross-load half is infeasible on this fixture: only ${distinctTargetSample.length} DISTINCT target fragments discovered at load 0 (excluding the class-B target itself), need >= ${SAMPLE_SIZE}. (NEEDS_CONTEXT per task brief.)`);
        }
        sampleTargetFrags = distinctTargetSample;
        console.log(`Load 0: discovered ${deep.discovered.length} same-model crossing-diagnostic pairs; froze sample of ${SAMPLE_SIZE} distinct target fragments: ${JSON.stringify(sampleTargetFrags)}`);

        // F(b) candidate pool: the 5 sample targets PLUS ~10 fragments spread evenly across the
        // WHOLE Structure fragId range (from load 0's own §9.2 fragMap), so the reversal search
        // does not depend on luck with one hand-picked pair. CLASS_B_TARGET_FRAG excluded (it is
        // fragA, fixed, in every probe).
        const allStructureFragIds = Object.keys(deep.fragMap).map(Number).filter((id) => id !== CLASS_B_TARGET_FRAG).sort((a, b) => a - b);
        const spreadCount = 10;
        const spread = [];
        for (let i = 0; i < spreadCount && allStructureFragIds.length > 0; i++) {
          const idx = Math.floor((i * allStructureFragIds.length) / spreadCount);
          spread.push(allStructureFragIds[idx]);
        }
        fbCandidateFrags = [...new Set([...sampleTargetFrags.map((s) => s.targetFragId), ...spread])];
        console.log(`Load 0: F(b) candidate pool (${fbCandidateFrags.length} fragments, fragA=${CLASS_B_TARGET_FRAG}): ${JSON.stringify(fbCandidateFrags)}`);

        // Re-run deep capture for load 0 WITH the frozen sample/candidates now known, so load 0's
        // own classBResult/sampleResults/fbResults are computed against the SAME frozen inputs every
        // other load uses (the first call above only had discovery available, not these yet).
        const deep0 = await runDeepCapture(page, { discover: false, sampleTargetFrags, fbCandidateFrags });
        loads.push({ load, run, diagonalByTag, deep: deep0 });
      } else {
        loads.push({ load, run, diagonalByTag, deep });
      }
      console.log(`load ${load}: pairs=${loads.at(-1).run.run?.pairs?.length ?? 'N/A'} classB=${fingerprintDisposition(loads.at(-1).deep.classBResult)}`);

      load += 1;
      const enoughLoads = load >= LOAD_COUNT;
      const reversalSoFar = anyReversalObserved(loads.map((l) => l.deep.fbResults));
      if (enoughLoads && reversalSoFar) break;
      if (load >= MAX_LOADS) {
        console.log(`Reached MAX_LOADS (${MAX_LOADS}) without observing a geometryIndex relative-order reversal for ANY F(b) candidate pair -- stopping; this is reported as a Regression F(b) failure below, not silently accepted.`);
        break;
      }
    }
  } finally {
    await browser.close();
  }

  await mkdir(RESULTS_DIR, { recursive: true });

  // ---- Regression E: full §6.4-field equality between every load and the baseline load ----------
  const baseline = loads[0];
  const regressionE = loads.slice(1).map((l) => {
    const cmp = compareRunsAtPairScale(baseline.run.run, l.run.run, l.diagonalByTag);
    return { load: l.load, valid: cmp.valid, fields: cmp.fields };
  });
  const regressionEPass = regressionE.every((r) => r.valid);
  if (!regressionEPass) failures.push(`Regression E: full §6.4-field parity failed for load(s): ${regressionE.filter((r) => !r.valid).map((r) => r.load).join(', ')}`);

  // ---- Regression C's cross-load half: single value across ALL loads, for class-B + 5 sample ----
  // codex-review finding #3 (Medium): `fingerprintDisposition` maps every failed reconstruction to
  // the SAME 'NOT_EXTRACTED' sentinel, so a pair that silently failed to extract at every load would
  // vacuously report `singleValue: true` without ever exercising a real precheck. `extracted` is
  // now required to be `true` at every load for every pair -- a reconstruction failure is always a
  // hard failure for that pair, never treated as "stable".
  const pairLabels = ['classB', ...loads[0].deep.sampleResults.map((_, i) => `sample${i}`)];
  const regressionC = pairLabels.map((label, i) => {
    const getResult = (l) => (i === 0 ? l.deep.classBResult : l.deep.sampleResults[i - 1]);
    const perLoad = loads.map((l) => ({ load: l.load, ...getResult(l) }));
    const allExtracted = perLoad.every((r) => r.extracted === true);
    const fingerprints = new Set(perLoad.map((r) => fingerprintDisposition(r)));
    const identity = i === 0
      ? { source: CLASS_B_SOURCE_FRAG, target: CLASS_B_TARGET_FRAG }
      : { source: loads[0].deep.sampleResults[i - 1].sourceFragId, target: loads[0].deep.sampleResults[i - 1].targetFragId };
    return {
      label,
      pair: identity,
      allExtracted,
      singleValue: allExtracted && fingerprints.size === 1,
      distinctFingerprints: [...fingerprints],
      perLoad,
    };
  });
  const regressionCPass = regressionC.every((r) => r.singleValue);
  if (!regressionCPass) {
    const bad = regressionC.filter((r) => !r.singleValue);
    failures.push(`Regression C cross-load half: NOT single-valued (or failed to extract at every load) for: ${bad.map((r) => `${r.label} (allExtracted=${r.allExtracted}, distinct=${r.distinctFingerprints.length})`).join(', ')}`);
  }

  // ---- §9.2: fragId -> (worldMatrixHash, ownerDbId) map identity across loads (ASSERTED) --------
  const baselineMap = baseline.deep.fragMap;
  const baselineFragIds = Object.keys(baselineMap).sort();
  let fragMapIdentical = true;
  const fragMapMismatches = [];
  for (const l of loads.slice(1)) {
    const m = l.deep.fragMap;
    const ids = Object.keys(m).sort();
    if (ids.length !== baselineFragIds.length || ids.some((id, idx) => id !== baselineFragIds[idx])) {
      fragMapIdentical = false;
      fragMapMismatches.push({ load: l.load, reason: 'fragId set differs', baselineCount: baselineFragIds.length, thisCount: ids.length });
      continue;
    }
    for (const fragId of baselineFragIds) {
      const a = baselineMap[fragId];
      const b = m[fragId];
      if (a.worldMatrixHash !== b.worldMatrixHash || a.ownerDbId !== b.ownerDbId) {
        fragMapIdentical = false;
        fragMapMismatches.push({ load: l.load, fragId, baseline: a, thisLoad: b });
      }
    }
  }
  if (!fragMapIdentical) failures.push(`§9.2: fragId -> (worldMatrixHash, ownerDbId) map NOT identical across loads (${fragMapMismatches.length} mismatch(es))`);

  // §9.2 informational report (NOT asserted): how many fragment pairs share a world matrix, from
  // the baseline load only. Sigma n(n-1)/2 over exact-matrix equivalence groups (codex-advisor
  // correction: not merely the count of duplicated hashes/groups).
  const groupsByHash = new Map();
  for (const fragId of baselineFragIds) {
    const hash = baselineMap[fragId].worldMatrixHash;
    if (!groupsByHash.has(hash)) groupsByHash.set(hash, []);
    groupsByHash.get(hash).push(fragId);
  }
  let sharedWorldMatrixPairCount = 0;
  let groupsWithSharing = 0;
  for (const group of groupsByHash.values()) {
    const n = group.length;
    if (n > 1) { groupsWithSharing++; sharedWorldMatrixPairCount += (n * (n - 1)) / 2; }
  }

  // ---- Regression F(b): winner + full witness payload identical at every load, for EVERY --------
  // ---- candidate pair, with a genuine geometryIndex reversal required for at least one ------------
  // codex-review finding #2 (High): a load/candidate whose probe was `skipped` (operand
  // unavailable/oversized, or fragA===fragB) must never be silently dropped from the comparison --
  // every candidate this run actually probed at every load must produce a usable result, or the
  // whole regression fails loudly rather than quietly shrinking its own sample.
  const reversalByCandidate = reversalStatusByCandidate(loads.map((l) => l.deep.fbResults));
  const fbMismatches = [];
  let fbPass = true;
  for (const fragB of fbCandidateFrags ?? []) {
    const perLoad = loads.map((l) => ({ load: l.load, ...(l.deep.fbResults ?? []).find((r) => r.fragB === fragB) }));
    const skipped = perLoad.filter((r) => r.skipped);
    const usable = perLoad.filter((r) => !r.skipped);
    if (skipped.length > 0 || usable.length !== loads.length) {
      fbPass = false;
      fbMismatches.push({ fragB, reason: `probe skipped at ${skipped.length} load(s)`, skippedLoads: skipped.map((r) => ({ load: r.load, reason: r.reason })) });
      continue;
    }
    const candidateBaseline = usable[0]; // deliberately NOT named `baseline` -- that identifier is already the outer load-0 baseline used above for regressions E and §9.2; shadowing it here (even though block-scoped and harmless) invites confusion
    for (const r of usable) {
      if (r.expectedWinnerFragId !== candidateBaseline.expectedWinnerFragId) {
        fbMismatches.push({ fragB, load: r.load, reason: 'expectedWinnerFragId differs from baseline (fragmentId identity should never change)', got: r.expectedWinnerFragId, expected: candidateBaseline.expectedWinnerFragId });
        fbPass = false;
        continue;
      }
      const expectedWitness = r.expectedWinnerFragId === r.fragA ? FB_WITNESS_A : FB_WITNESS_B;
      const witnessMatches = r.pairFound && r.distance === FB_FIXED_DISTANCE
        && JSON.stringify(r.witness) === JSON.stringify(expectedWitness);
      if (!witnessMatches) {
        fbMismatches.push({ fragB, load: r.load, reason: 'winner/witness payload does not match the fragmentId-decided expectation', got: { distance: r.distance, witness: r.witness }, expectedDistance: FB_FIXED_DISTANCE, expectedWitness });
        fbPass = false;
      }
    }
  }
  // codex-review finding #1 (High): an observed reversal is REQUIRED, not merely reported, for AT
  // LEAST ONE candidate -- without one, a regressed (pre-fix-style, geometryIndex-keyed) comparator
  // could pass this probe vacuously simply because this run never happened to see a reversal.
  const fbReversalObserved = [...reversalByCandidate.values()].some(Boolean);
  if (!fbReversalObserved) {
    fbPass = false;
    fbMismatches.push({ reason: `no genuine geometryIndex relative-order reversal was observed for ANY of the ${fbCandidateFrags?.length ?? 0} F(b) candidate pairs (fragA=${CLASS_B_TARGET_FRAG}) across all ${loads.length} loads -- the probe cannot be treated as having exercised the pre-fix hazard` });
  }
  const reversingCandidates = [...reversalByCandidate.entries()].filter(([, v]) => v).map(([k]) => k);
  if (!fbPass) failures.push(`Regression F(b): ${JSON.stringify(fbMismatches)}`);

  const report = {
    description: 'Task D3: cross-reload parity (regression E), regression C cross-load half, §9.2 measurements, regression F(b).',
    loadCount: loads.length, // actual loads performed -- may exceed LOAD_COUNT if extra reloads were needed to observe a genuine geometryIndex reversal (see MAX_LOADS)
    regressionE: { pass: regressionEPass, perLoad: regressionE },
    regressionC: { pass: regressionCPass, sampleSize: SAMPLE_SIZE, pairs: regressionC },
    section9_2: {
      fragMapIdentical, fragMapMismatches, fragmentCount: baselineFragIds.length,
      sharedWorldMatrixInfo: { groupsWithSharing, sharedWorldMatrixPairCount, note: 'informational only, per design doc -- not an assertion' },
    },
    regressionF_b: {
      pass: fbPass, reversalObserved: fbReversalObserved, candidateCount: fbCandidateFrags?.length ?? 0,
      reversingCandidates, mismatches: fbMismatches,
      perCandidate: loads.length ? (fbCandidateFrags ?? []).map((fragB) => ({
        fragB, reversed: reversalByCandidate.get(fragB) ?? false,
        history: loads.map((l) => (l.deep.fbResults ?? []).find((r) => r.fragB === fragB)),
      })) : [],
    },
  };
  const resultsPath = `${RESULTS_DIR}/cross-reload-parity-${Date.now()}.json`;
  await writeFile(resultsPath, JSON.stringify(report, null, 2));
  console.log(`\nFull results written to ${resultsPath}`);

  console.log(`\nRegression E (cross-reload §6.4 parity): ${regressionEPass ? 'PASS' : 'FAIL'}`);
  console.log(`Regression C (cross-load half, class-B + ${SAMPLE_SIZE} sampled fragments): ${regressionCPass ? 'PASS' : 'FAIL'}`);
  console.log(`§9.2 fragId identity map: ${fragMapIdentical ? 'PASS (identical across loads)' : 'FAIL'}; shared-world-matrix pairs (informational): ${sharedWorldMatrixPairCount} across ${groupsWithSharing} group(s) of ${baselineFragIds.length} fragments`);
  console.log(`Regression F(b) (aggregation determinism across reload): ${fbPass ? 'PASS' : 'FAIL'} (genuine geometryIndex order reversal observed for ${reversingCandidates.length}/${fbCandidateFrags?.length ?? 0} candidate pairs across ${loads.length} loads)`);

  if (failures.length) {
    console.error(`\n${failures.length} failure(s):\n${failures.map((f) => ` - ${f}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }
  console.log('\nPASS: all four Task D3 sub-requirements hold across all loads.');
}

const isMainModule = process.argv[1] && process.argv[1].endsWith('cross-reload-parity.mjs');
if (isMainModule) {
  console.error('This script must be run via: node test/performance/run-gate-m4.mjs --d3-cross-reload');
  process.exitCode = 1;
}
