// test/performance/run-gate.mjs
//
// Task 24: the Milestone-1 performance gate (docs/superpowers/specs/2026-08-06-collision-library-
// milestone1-design.md:4864-5018, closing statement at 5016-5018 -- see
// docs/superpowers/specs/milestone-1-performance-gate-disposition.md for the full write-up). A
// Playwright driver that loads
// test/performance/browser-probes.mjs (Task 23) into a live Viewer page against a real,
// confirmed-adequately-scaled model, runs the cold+warm `volume-overlap` protocol against one
// shared CollisionWorld, and collects all 12 criteria's numbers.
//
// Run: node test/performance/run-gate.mjs
// Override the model: MEP_URN=<urn> node test/performance/run-gate.mjs
//
// Model note (full detail in the disposition doc): no purpose-built MEP (Mechanical/Electrical/
// Plumbing) sample model exists anywhere in this repo or its connected APS bucket at usable scale
// (the two models literally named mep-test-v3/v4.ifc are too small -- v4 loads with a median of 68
// triangles/fragment, squarely "dozens"; v3 produces no usable instance tree). `A250-E-MB-CND-
// STR-03.ifc`, already translated in the connected bucket, is a reinforced-concrete/rebar
// structural IFC model -- NOT an MEP-discipline model -- but genuinely satisfies the spec's own
// literal scale bar ("fragment geometries in the thousands of triangles, not the dozens": sampled
// 302 of 5,425 fragments, median 744, mean 1,545, high 9,078 triangles/fragment) and is accepted
// under Task 0's own stated alternative ("an equivalently fragment-dense public sample", per
// test/README.md's Known-risk section) -- a codex-advisor consult confirmed this reading before
// this script was written (see disposition doc's "Model used" section for the full citation and
// reasoning, including why this does not reproduce the B7/risk-#12 hazard the brief warns against).
const DEFAULT_MEP_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0EyNTAtRS1NQi1DTkQtU1RSLTAzLmlmYw';

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import {
  maxChildrenPerNode, maxFragmentsPerDbId, maxCollisionInstancesPerEpoch,
} from '../../collision/constants.js';

const PORT = process.env.PORT || 8080;
const MEP_URN = process.env.MEP_URN || DEFAULT_MEP_URN;

// Same launch args test/acceptance/room-locator.acceptance.mjs needed in this repo's own dev
// sandbox (macOS Mach-port-rendezvous denial under the outer process sandbox) -- see that file's
// header comment for the full rationale. Harmless elsewhere.
function resolveProxyFromEnv() {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const proxy = { server: `${url.protocol}//${url.host}` };
    if (url.username) proxy.username = decodeURIComponent(url.username);
    if (url.password) proxy.password = decodeURIComponent(url.password);
    const bypass = process.env.NO_PROXY || process.env.no_proxy;
    if (bypass) proxy.bypass = bypass;
    return proxy;
  } catch {
    return undefined;
  }
}

const RESULTS_DIR = 'test/performance/results';

/** Per-label span aggregates (count/max/mean), plus the N highest-ms individual spans overall --
 *  NOT the raw per-span array. At MEP scale a single label (e.g. `broad-phase-scan`) can carry
 *  tens of thousands of near-zero entries (one per broad-phase iteration); keeping every one of
 *  them (in the console log AND the written JSON) produced an unusable 15MB/769K-line dump on the
 *  first real run of this script. `longestSpan()`/`spansByLabel()` already answer criterion 1's
 *  actual evidence need (the single worst span, and any span above the 24.8ms line) without this;
 *  this summary is for readability/forensics only. */
function summarizeSpans(spans, topN = 20) {
  const byLabel = {};
  for (const s of spans) {
    const entry = (byLabel[s.label] ||= { count: 0, maxMs: 0, sumMs: 0, source: s.source });
    entry.count++;
    entry.maxMs = Math.max(entry.maxMs, s.ms);
    entry.sumMs += s.ms;
  }
  for (const label of Object.keys(byLabel)) byLabel[label].meanMs = byLabel[label].sumMs / byLabel[label].count;
  const top = [...spans].sort((a, b) => b.ms - a.ms).slice(0, topN);
  return { byLabel, top };
}

/** Frontier-collapse rule (codex-advisor recommendation, in place of the brief's hardcoded
 *  depth===1 assumption, which assumed a flat Revit-style top-level-assembly tree that this
 *  model's real, deep IFC spatial hierarchy (Project->Site->Building->Storey->...) does not have):
 *  starting at the root, collapse every zero-direct-fragment node that has exactly one
 *  fragment-bearing child; the first node with >=2 fragment-bearing immediate children exposes
 *  those children as the candidate frontier. Ranked by aggregate unique-fragment-count descending,
 *  ties broken by dbId ascending -- this IS the reproducible instruction this run recorded, in
 *  place of "largest available top-level assemblies" read as a fixed tree depth. */
async function findFrontier(page, rootId) {
  return page.evaluate((rootId) => {
    const tree = window.viewer.model.getInstanceTree();
    function fragCount(dbId) {
      let n = 0;
      tree.enumNodeFragments(dbId, () => { n++; }, false);
      return n;
    }
    function aggregateCount(dbId) {
      // Sums direct fragment counts across the whole subtree -- equivalent to counting unique
      // fragment IDs since InstanceTree is a real tree (each fragment has exactly one owning dbId
      // path), so no separate de-duplication pass is needed. Re-walks are cheap here (model is a
      // few thousand fragments).
      let n = 0;
      (function walk(id) {
        n += fragCount(id);
        tree.enumNodeChildren(id, walk, false);
      })(dbId);
      return n;
    }
    let current = rootId;
    const path = [current];
    for (;;) {
      const children = [];
      // NOT `(c) => children.push(c)` -- Array.prototype.push returns the new (positive, truthy)
      // length, and this Viewer version (7.124.2) treats a truthy enumeration-callback return as
      // an abort signal (docs/...:4958-4963's own documented truthy-interrupt semantics) -- an
      // implicit-return arrow here silently truncates enumeration to exactly one child. Confirmed
      // the hard way (a codex-advisor consult after a long, fully-reproducible debugging session)
      // -- see the disposition doc's "Instrumentation-methodology finding" section.
      tree.enumNodeChildren(current, (c) => { children.push(c); }, false);
      // Defensive cross-check (codex-advisor's own recommendation): confirm the enumeration was not
      // silently truncated, independent of the callback-return hazard above -- cheap, and a real
      // safety net against any future regression of the same kind.
      if (typeof tree.getChildCount === 'function' && children.length !== tree.getChildCount(current)) {
        throw new Error(
          `Incomplete child enumeration for dbId ${current}: ${children.length} enumerated, ` +
          `${tree.getChildCount(current)} reported by getChildCount`,
        );
      }
      const bearing = children.filter((c) => aggregateCount(c) > 0);
      if (bearing.length >= 2) {
        const ranked = bearing
          .map((dbId) => ({ dbId, name: tree.getNodeName(dbId), aggregateFragmentCount: aggregateCount(dbId) }))
          .sort((a, b) => b.aggregateFragmentCount - a.aggregateFragmentCount || a.dbId - b.dbId);
        return { frontierParentPath: path, frontier: ranked };
      }
      if (bearing.length === 1) {
        current = bearing[0];
        path.push(current);
        continue;
      }
      // Dead end (no fragment-bearing children at all) -- fall back to whatever children exist.
      const ranked = children
        .map((dbId) => ({ dbId, name: tree.getNodeName(dbId), aggregateFragmentCount: aggregateCount(dbId) }))
        .sort((a, b) => b.aggregateFragmentCount - a.aggregateFragmentCount || a.dbId - b.dbId);
      return { frontierParentPath: path, frontier: ranked, deadEnd: true };
    }
  }, rootId);
}

/** Preflight one candidate (sourceDbId, targetDbId) pair against a THROWAWAY CollisionWorld (its
 *  own registry/BlasCache, so it cannot contaminate the real gate world's cold-start state): checks
 *  the broad-phase ceiling and confirms a nonzero narrow-phase candidate count (a real AABB-overlap
 *  hit), not merely "both sides are non-empty" -- codex-advisor's point that triangle density alone
 *  does not prove the selected pair exercises anything. */
async function preflightPair(page, sourceDbId, targetDbId) {
  return page.evaluate(async ({ sourceDbId, targetDbId }) => {
    const { CollisionWorld } = await import('/collision/index.js');
    const { maxBroadPhaseInstancePairs, maxFragmentsPerDbId } = await import('/collision/constants.js');
    const model = window.viewer.model;
    const tree = model.getInstanceTree();
    function aggregateCount(dbId) {
      let n = 0;
      (function walk(id) {
        tree.enumNodeFragments(id, () => { n++; }, false);
        tree.enumNodeChildren(id, walk, false);
      })(dbId);
      return n;
    }
    const sourceCount = aggregateCount(sourceDbId);
    const targetCount = aggregateCount(targetDbId);
    if (sourceCount > maxFragmentsPerDbId || targetCount > maxFragmentsPerDbId) {
      return { ok: false, reason: `sourceCount=${sourceCount} or targetCount=${targetCount} exceeds maxFragmentsPerDbId=${maxFragmentsPerDbId}`, sourceCount, targetCount };
    }
    if (sourceCount === 0 || targetCount === 0) {
      return { ok: false, reason: 'one side has zero fragments', sourceCount, targetCount };
    }
    if (sourceCount > maxBroadPhaseInstancePairs / targetCount) {
      return { ok: false, reason: `sourceCount x targetCount exceeds maxBroadPhaseInstancePairs=${maxBroadPhaseInstancePairs}`, sourceCount, targetCount };
    }
    const world = await CollisionWorld.fromViewer(window.viewer);
    world.admitModel(model);
    let result;
    try {
      result = await world.findClashes({
        mode: 'volume-overlap',
        source: { model, dbIds: [sourceDbId] },
        target: { model, dbIds: [targetDbId] },
        groupBy: 'dbId',
      });
    } catch (e) {
      return { ok: false, reason: `findClashes threw: ${e.message}`, sourceCount, targetCount };
    }
    world.dispose();
    return {
      ok: result.statistics.narrowPhasePairs > 0,
      reason: result.statistics.narrowPhasePairs > 0 ? undefined : 'zero AABB-overlapping candidate pairs (broadPhasePairs=' + result.statistics.broadPhasePairs + ')',
      sourceCount, targetCount,
      broadPhasePairs: result.statistics.broadPhasePairs,
      narrowPhasePairs: result.statistics.narrowPhasePairs,
    };
  }, { sourceDbId, targetDbId });
}

async function main() {
  await mkdir(RESULTS_DIR, { recursive: true });
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote'],
    proxy: resolveProxyFromEnv(),
  });
  const browserVersion = await browser.version();
  const page = await browser.newPage();
  const consoleWarnings = [];
  page.on('console', (msg) => {
    if (/error|warn/i.test(msg.text())) consoleWarnings.push(msg.text().slice(0, 300));
  });

  try {
    await page.goto(`http://localhost:${PORT}/#${MEP_URN}`);
    await page.waitForFunction(() => window.viewer && window.viewer.model, null, { timeout: 180_000 });
    await page.waitForFunction(() => window.viewer.model.isLoadDone(), null, { timeout: 180_000 });
    await page.addScriptTag({ path: 'test/performance/browser-probes.mjs' });

    // ---- Step 1 (re-confirmed here, not just cited): sampled fragment/triangle-count profile ----
    const modelProfile = await page.evaluate(async () => {
      const { adaptViewerGeometry } = await import('/collision/viewer/ViewerGeometryAdapter.js');
      const model = window.viewer.model;
      const total = model.getFragmentList().getCount();
      const step = Math.max(1, Math.floor(total / 300));
      const counts = [];
      for (let i = 0; i < total; i += step) {
        try {
          const proxy = window.viewer.impl.getRenderProxy(model, i);
          const geom = proxy && proxy.geometry;
          if (!geom) continue;
          const view = adaptViewerGeometry(geom);
          if (view.unsupported) continue;
          counts.push(view.activeTriangleCount);
        } catch { /* skip */ }
      }
      counts.sort((a, b) => a - b);
      const n = counts.length;
      return {
        totalFragments: total,
        sampledFragments: n,
        low: n ? counts[0] : null,
        median: n ? counts[Math.floor(n / 2)] : null,
        high: n ? counts[n - 1] : null,
        mean: n ? Math.round(counts.reduce((a, b) => a + b, 0) / n) : null,
      };
    });
    console.log('=== Model profile ===\n', JSON.stringify(modelProfile, null, 2));

    // ---- Step 2: deterministic dbId selection via the fragment-bearing frontier ----
    const rootId = await page.evaluate(() => window.viewer.model.getInstanceTree().getRootId());
    const { frontierParentPath, frontier, deadEnd } = await findFrontier(page, rootId);
    console.log(`\n=== Frontier (parent path ${JSON.stringify(frontierParentPath)}, deadEnd=${!!deadEnd}) ===`);
    console.log(JSON.stringify(frontier.slice(0, 10), null, 2));

    // Rank candidate pairs by combined size descending; try each until one clears the ceilings AND
    // produces a real nonzero narrow-phase candidate count (codex-advisor: density alone doesn't
    // prove the pair exercises anything -- an ephemeral throwaway world checks this for real).
    const pairs = [];
    for (let i = 0; i < frontier.length; i++) {
      for (let j = i + 1; j < frontier.length; j++) {
        pairs.push([frontier[i], frontier[j]]);
      }
    }
    pairs.sort((a, b) => (b[0].aggregateFragmentCount + b[1].aggregateFragmentCount) - (a[0].aggregateFragmentCount + a[1].aggregateFragmentCount));

    let chosen = null;
    let preflightLog = [];
    for (const [a, b] of pairs.slice(0, 20)) {
      const check = await preflightPair(page, a.dbId, b.dbId);
      preflightLog.push({ sourceDbId: a.dbId, targetDbId: b.dbId, ...check });
      if (check.ok) { chosen = { sourceDbId: a.dbId, targetDbId: b.dbId, sourceName: a.name, targetName: b.name }; break; }
    }
    if (!chosen) {
      throw new Error(
        'No frontier pair (of the 20 largest-combined-size candidates) satisfies the ceilings and ' +
        'produces a nonzero narrow-phase candidate count. Preflight log: ' + JSON.stringify(preflightLog, null, 2),
      );
    }
    console.log('\n=== Chosen dbId pair ===\n', JSON.stringify(chosen, null, 2));
    const sourceDbIds = [chosen.sourceDbId];
    const targetDbIds = [chosen.targetDbId];

    // ---- Step 2 (continued): the real cold/warm protocol against ONE shared CollisionWorld ----
    async function runVolumeOverlapOnce(label) {
      return page.evaluate(async ({ label, sourceDbIds, targetDbIds }) => {
        const rec = new window.__CheckpointRecorder();
        const { setSpanRecorder, clearSpanRecorder } = await import('/collision/scheduler.js');
        setSpanRecorder(rec.asSpanRecorder());
        const h = rec.start(`volume-overlap-total-wallclock-${label}`);
        const result = await window.__gateWorld.findClashes({
          mode: 'volume-overlap',
          source: { model: window.viewer.model, dbIds: sourceDbIds },
          target: { model: window.viewer.model, dbIds: targetDbIds },
          groupBy: 'dbId',
        });
        h.end();
        clearSpanRecorder();
        return { statistics: result.statistics, pairs: result.pairs, spans: rec.spans, longestSpan: rec.longestSpan() };
      }, { label, sourceDbIds, targetDbIds });
    }

    await page.evaluate(async () => {
      const { CollisionWorld } = await import('/collision/index.js');
      window.__gateWorld = await CollisionWorld.fromViewer(window.viewer); // ONE world, shared by both runs
      window.__gateLease = window.__gateWorld.admitModel(window.viewer.model);
    });

    console.log('\n=== Cold run (no BLAS cached) ===');
    const cold = await runVolumeOverlapOnce('cold');
    const coldSpanSummary = summarizeSpans(cold.spans);
    console.log(JSON.stringify({ statistics: cold.statistics, longestSpan: cold.longestSpan, spansByLabel: coldSpanSummary.byLabel }, null, 2));

    console.log('\n=== Warm run (every BLAS already built, immediately after) ===');
    const warm = await runVolumeOverlapOnce('warm');
    const warmSpanSummary = summarizeSpans(warm.spans);
    console.log(JSON.stringify({ statistics: warm.statistics, longestSpan: warm.longestSpan, spansByLabel: warmSpanSummary.byLabel }, null, 2));

    // ---- Criterion 12: drive additional findClashes calls across more of the model's fragment
    // population (self-pairs on other frontier siblings, each kept under the broad-phase ceiling),
    // THEN read back the identity-cache's retained size. This is deliberately separate from the
    // cold/warm pair above (which must stay exactly two calls, on exactly the chosen pair, so
    // criterion 1's cold/warm semantics are not muddied by extra traffic in between). ----
    const coverage = await page.evaluate(async ({ frontier, chosenA, chosenB }) => {
      const { maxBroadPhaseInstancePairs } = await import('/collision/constants.js');
      let covered = 0; let attempted = 0; let calls = 0;
      const errors = [];
      for (const node of frontier) {
        if (node.dbId === chosenA || node.dbId === chosenB) continue; // already covered by cold/warm
        if (node.aggregateFragmentCount === 0) continue;
        if (node.aggregateFragmentCount * node.aggregateFragmentCount > maxBroadPhaseInstancePairs) continue; // self-pair ceiling
        attempted++;
        try {
          await window.__gateWorld.findClashes({
            mode: 'volume-overlap',
            source: { model: window.viewer.model, dbIds: [node.dbId] },
            target: { model: window.viewer.model, dbIds: [node.dbId] },
            groupBy: 'dbId',
          });
          covered += node.aggregateFragmentCount;
          calls++;
        } catch (e) {
          errors.push({ dbId: node.dbId, message: e.message });
        }
      }
      return { attempted, calls, coveredFragmentsApprox: covered, errors };
    }, { frontier, chosenA: chosen.sourceDbId, chosenB: chosen.targetDbId });
    console.log('\n=== Criterion-12 coverage-drive ===\n', JSON.stringify(coverage, null, 2));

    const c12Real = await page.evaluate(() => {
      return window.__perfProbes.identityCacheRetainedSize(window.__gateWorld, window.__gateLease.epoch);
    });

    // ---- Remaining live-model probes (criteria 4, 6, 7, 8-commit-spans, 9, 10-evict, 11) ----
    const sampleDbId = chosen.sourceDbId;
    const c4 = await page.evaluate(async (sampleDbId) => {
      const [
        { extractFragments }, { adaptViewerGeometry }, { compactAndWeld }, { computeGeometryConnectivity },
        { build }, { classifyPoint }, { properCrossingQuery }, { surfaceCrossingWitness }, { weldEpsilonMeters },
        THREE,
      ] = await Promise.all([
        import('/collision/viewer/ViewerModelAdapter.js'),
        import('/collision/viewer/ViewerGeometryAdapter.js'),
        import('/collision/geometry/activeRangeCompaction.js'),
        import('/collision/geometry/GeometryConnectivity.js'),
        import('/collision/blas/ThreeMeshBvhBackend.js'),
        import('/collision/query/ContainmentQuery.js'),
        import('/collision/query/ProperCrossingQuery.js'),
        import('/collision/query/SurfaceCrossingWitness.js'),
        import('/collision/constants.js'),
        import('three'),
      ]);
      return window.__perfProbes.probeCosts(window.viewer.model, sampleDbId, {
        extractFragments, adaptViewerGeometry, compactAndWeld, computeGeometryConnectivity, build,
        classifyPoint, properCrossingQuery, surfaceCrossingWitness, weldEpsilonMeters, THREE,
      });
    }, sampleDbId);

    const c6 = await page.evaluate(async () => {
      const THREE = await import('three');
      return window.__perfProbes.extractionCostAndAabbOverhead(window.viewer.model, THREE);
    });

    const c7 = await page.evaluate((ceiling) => window.__perfProbes.widestNodeFanout(window.viewer.model, ceiling), maxChildrenPerNode);
    const c9 = await page.evaluate((ceiling) => window.__perfProbes.widestFragmentOwner(window.viewer.model, ceiling), maxFragmentsPerDbId);

    const c11 = await page.evaluate(async () => {
      const { adaptViewerGeometry } = await import('/collision/viewer/ViewerGeometryAdapter.js');
      return window.__perfProbes.mostFragmentedGeometryNormalization(window.viewer.model, { adaptViewerGeometry });
    });

    // Criterion 10 (evictModel half): on the real, already-warmed gate world/model -- terminal for
    // this world, so it runs LAST among the shared-world probes.
    const c10evict = await page.evaluate(() => window.__perfProbes.epochSweepCost(window.__gateWorld, window.viewer.model, { viaDispose: false }));

    // Criterion 8 (precheck-reject half): this model's total fragment population (see modelProfile.
    // totalFragments) is far below maxCollisionInstancesPerEpoch -- record why a real over-capacity
    // query can't be constructed from this model's own data rather than fabricating one.
    const c8Precheck = modelProfile.totalFragments > maxCollisionInstancesPerEpoch
      ? 'model large enough -- see dedicated precheck run below'
      : `NOT EXERCISED -- model's total fragment population (${modelProfile.totalFragments}) is far below ` +
        `maxCollisionInstancesPerEpoch (${maxCollisionInstancesPerEpoch}); a genuine over-capacity ` +
        `precheck-reject condition cannot be constructed from this model's own real data without ` +
        `fabricating a synthetic query, which the gate's own protocol forbids substituting for a real one`;

    const report = {
      disposition: 'MEASURED',
      environment: {
        browserVersion,
        os: `${os.platform()} ${os.release()} (${os.arch()})`,
        urn: MEP_URN,
        dbIdSelectionRule: 'fragment-bearing frontier (codex-advisor-recommended generalization of "largest top-level assemblies" for a deep IFC spatial hierarchy): starting at root, collapse zero-direct-fragment nodes with exactly one fragment-bearing child; the first node with >=2 fragment-bearing immediate children exposes those as the frontier; ranked by aggregate unique-fragment-count descending, ties by dbId ascending; the chosen pair is the first (by combined size) that clears maxFragmentsPerDbId/maxBroadPhaseInstancePairs AND produces a real nonzero narrow-phase candidate count in a throwaway preflight world',
        frontierParentPath, frontier: frontier.slice(0, 10), deadEnd: !!deadEnd,
        chosen, preflightLog,
        consoleWarnings,
      },
      modelProfile,
      cold: { statistics: cold.statistics, longestSpan: cold.longestSpan, spansByLabel: coldSpanSummary.byLabel, topSpans: coldSpanSummary.top },
      warm: { statistics: warm.statistics, longestSpan: warm.longestSpan, spansByLabel: warmSpanSummary.byLabel, topSpans: warmSpanSummary.top },
      coverage,
      criteria: {
        c4, c6, c7, c9, c11,
        c10_evictModel: c10evict,
        c12_identityCacheRetainedSize: c12Real,
        c8_capacityAdmissionCommitSpans: [...cold.spans, ...warm.spans].filter((s) => s.label === 'capacity-admission-commit'),
        c8_precheckReject: c8Precheck,
      },
    };
    await writeFile(`${RESULTS_DIR}/mep-gate-${Date.now()}.json`, JSON.stringify(report, null, 2));
    console.log('\n=== Full report (summarized spans) ===\n', JSON.stringify(report, null, 2));

    // ---- Criterion 10 (dispose() half), varied across simultaneously-live epoch counts. This
    // sandbox's forced Chromium launch args (--single-process --no-zygote, required for Chromium
    // to launch at all here -- see the launch() call above) do not support a second page/context:
    // `browser.newPage()` a second time throws. A brand-new CollisionWorld instance on the SAME
    // page is sufficient isolation from the terminal __gateWorld above (each world owns its own
    // registry/BlasCache) -- fabricated extra "model" objects purely inflate the live-epoch count;
    // admitModel only needs a stable object identity, never real geometry. ----
    const c10disposeMultiEpoch = await page.evaluate(async ({ sourceDbIds, targetDbIds }) => {
      const { CollisionWorld } = await import('/collision/index.js');
      const results = [];
      for (const liveEpochCount of [1, 5, 20]) {
        const world = await CollisionWorld.fromViewer(window.viewer);
        world.admitModel(window.viewer.model);
        // Fake models can't carry real geometry, so only the real model's epoch gets populated --
        // but that's still a real GeometryRegistry/instance-cache population (not an empty bucket)
        // for dispose()'s sweep to actually walk, unlike a bare admitModel-then-dispose which would
        // measure a no-op sweep over empty state regardless of liveEpochCount.
        await world.findClashes({
          mode: 'volume-overlap',
          source: { model: window.viewer.model, dbIds: sourceDbIds },
          target: { model: window.viewer.model, dbIds: targetDbIds },
          groupBy: 'dbId',
        });
        for (let i = 1; i < liveEpochCount; i++) world.admitModel({ id: `fake-model-${i}` });
        const t0 = performance.now();
        world.dispose();
        const ms = performance.now() - t0;
        results.push({ liveEpochCount, ms });
      }
      return results;
    }, { sourceDbIds, targetDbIds });
    console.log('\n=== Criterion-10 dispose() multi-epoch ===\n', JSON.stringify(c10disposeMultiEpoch, null, 2));
    report.criteria.c10_dispose_multiEpoch = c10disposeMultiEpoch;

    await writeFile(`${RESULTS_DIR}/mep-gate-${Date.now()}-final.json`, JSON.stringify(report, null, 2));
    console.log('\n=== FINAL report (with c10 dispose multi-epoch) written ===');
  } finally {
    await browser.close();
  }
}

// Guard against Node's `node --test` default discovery, which sweeps in every .js/.mjs file under
// any directory literally named `test` (confirmed by Task 23 -- see browser-probes.mjs's own guard
// and test/performance/README.md's note) -- run main() only when this file is the actual entry
// point (`node test/performance/run-gate.mjs`), never merely when `npm test`'s bare `node --test`
// imports it as a sweep target. Without this, every `npm test` run would try to launch a real
// browser and hit a possibly-absent localhost:8080 server, which is exactly the kind of stray
// side effect this repo's own conventions warn against.
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
