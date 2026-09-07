// test/performance/run-gate-m2.mjs
//
// Task 21 (M2 milestone): the M2 performance gate (docs/superpowers/specs/2026-09-05-collision-
// library-milestone2-design.md §14, "Performance gate" -- protocol §14.2, criteria §14.3). Sibling to
// test/performance/run-gate.mjs (M1's own gate, UNTOUCHED by this file) -- mirrors its shape
// (Playwright driver, CheckpointRecorder span capture, summarizeSpans, cold/warm protocol, honest
// NOT-EXERCISED recording) for a NEW, additive M2 gate whose job is measuring TLAS-vs-linear
// candidate-search cost on a genuinely federated (multi-Model) scene, per the M2 prompt's own explicit
// gate question (spec §14.1): "is there a measurable candidate-search benefit of TLAS over linear on
// a realistic federated/fragment-dense case?" This spec does not presume the outcome, and neither does
// this script -- it measures and reports plainly, whichever way the numbers land.
//
// Run: node test/performance/run-gate-m2.mjs
//
// --- The fixture: a REAL 3-discipline federated Revit host+links setup ------------------------------
//
// Three genuinely separate, independently-translated discipline models sharing one real coordinate
// system (confirmed overlapping bounding boxes, ~+-138/+-75/+-15 in X/Y/Z) -- a real coordinated
// Architecture+Structure+Mechanical Revit host+links package, not an artificial same-URN-twice
// substitution (unlike this file's own earlier draft, which used clash_test_nested_link.zip loaded
// twice because its own manifest has only one {3D} viewable -- superseded here by this genuinely
//3-model fixture, handed to this task mid-flight together with the model-derivative confirmation
// below):
//   - Architecture: 5,435 fragments, loaded first (normally).
//   - Structure: 543 fragments, loaded second (as-additional, #keep-current-models).
//   - Mechanical: 1,496 fragments, loaded third (as-additional, same checkbox).
// Total ~7,474 fragments across the federated 3-model scope. Source: Structure (model index 1) dbId
// 3076 -- chosen over the fixture's own smaller dbId 2734 (which produces only 2 pairs) specifically
// because 3076 produces a much larger real candidate volume (order of ~1,000+ pairs against the full
// 3-model target scope, independently re-confirmed live below, not blindly trusted from the number
// this task was handed) -- a small-result query would not meaningfully exercise the TLAS candidate-
// reduction machinery §14.3 criterion 3 is about.
//
// This script independently RE-confirms live: model count, each model's own fragment total, and that
// the chosen source dbId owns real, non-empty geometry -- before trusting any of it for the timed
// protocol below.
const ARCH_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fQXJjaGl0ZWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const STRUCTURE_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fU3RydWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const MECHANICAL_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fTWVjaGFuaWNhbF9jbGFzaF90ZXN0LnJ2dA';
const SOURCE_DB_ID = 3076; // Structure model (index 1) -- see header comment.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { maxTlasCandidatePairs, maxCollisionInstancesPerEpoch } from '../../collision/constants.js';

const PORT = process.env.PORT || 8080;

// Identical to run-gate.mjs's own helper -- see that file's inline comment for the full rationale.
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

// Identical to run-gate.mjs's own summarizeSpans -- see that file's own comment for why per-label
// aggregates (not the raw per-span array) are what gets kept/logged.
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

// A heavy query (~1,000+ result pairs) can carry thousands of diagnostics -- M1's own disposition
// doc's own documented hazard (an unusable 15MB/769K-line dump on a real run) applies equally here.
// Keep a count + per-reason breakdown + a bounded sample, never the raw array, in the written/logged
// report -- same discipline summarizeSpans already applies to spans.
function summarizeDiagnostics(diagnostics, sampleN = 20) {
  const byReason = {};
  for (const d of diagnostics) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
  return { count: diagnostics.length, byReason, sample: diagnostics.slice(0, sampleN) };
}

function ratio(numerator, denominator) {
  return (typeof numerator === 'number' && typeof denominator === 'number' && denominator > 0)
    ? numerator / denominator
    : null;
}

async function main() {
  await mkdir(RESULTS_DIR, { recursive: true });
  const browser = await chromium.launch({
    // Same forced launch args this repo's own sandbox needs -- see run-gate.mjs's header comment.
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
    // ---- Step 1: load the fixture -- 3 genuinely separate discipline models, sequentially ----
    console.log('=== Loading model 1 (Architecture) ===');
    await page.goto(`http://localhost:${PORT}/#${ARCH_URN}`);
    await page.waitForFunction(() => window.viewer && window.viewer.model && window.viewer.model.isLoadDone(), null, { timeout: 180_000 });

    console.log('=== Loading model 2 (Structure, as additional) ===');
    await page.fill('#urn', STRUCTURE_URN);
    await page.check('#keep-current-models');
    await page.click('#load');
    await page.waitForFunction(() => window.viewer.getAllModels().length === 2 && window.viewer.getAllModels().every((m) => m.isLoadDone()), null, { timeout: 180_000 });
    // clash-finder.acceptance.mjs's own confirmed hazard: isLoadDone() alone is not sufficient for a
    // freshly-loaded additional model -- instanceTree can still be momentarily absent right after.
    await page.waitForFunction(() => window.viewer.getAllModels().every((m) => m.getData() && m.getData().instanceTree), null, { timeout: 180_000 });

    console.log('=== Loading model 3 (Mechanical, as additional) ===');
    await page.fill('#urn', MECHANICAL_URN);
    await page.check('#keep-current-models'); // idempotent -- already checked, re-asserted defensively
    await page.click('#load');
    await page.waitForFunction(() => window.viewer.getAllModels().length === 3 && window.viewer.getAllModels().every((m) => m.isLoadDone()), null, { timeout: 180_000 });
    await page.waitForFunction(() => window.viewer.getAllModels().every((m) => m.getData() && m.getData().instanceTree), null, { timeout: 180_000 });

    await page.addScriptTag({ path: 'test/performance/browser-probes.mjs' });

    // ---- Step 2: independently re-confirm the fixture identity against THIS live run ----
    const identity = await page.evaluate(({ sourceDbId }) => {
      const models = window.viewer.getAllModels();
      window.__gate = window.__gate ?? {};
      window.__gate.modelArch = models[0];
      window.__gate.modelStructure = models[1];
      window.__gate.modelMechanical = models[2];
      const it = models[1].getInstanceTree(); // Structure
      const name = it.getNodeName ? it.getNodeName(sourceDbId) : undefined;
      const fragments = [];
      it.enumNodeFragments(sourceDbId, (fragId) => { fragments.push(fragId); }, false);
      return {
        modelCount: models.length,
        archFragmentTotal: models[0].getFragmentList().getCount(),
        structureFragmentTotal: models[1].getFragmentList().getCount(),
        mechanicalFragmentTotal: models[2].getFragmentList().getCount(),
        sourceName: name,
        sourceFragmentCount: fragments.length,
      };
    }, { sourceDbId: SOURCE_DB_ID });
    console.log('\n=== Fixture identity (re-confirmed live) ===\n', JSON.stringify(identity, null, 2));
    if (identity.modelCount !== 3) {
      throw new Error(`Expected exactly 3 loaded models, got ${identity.modelCount}`);
    }
    if (!identity.sourceFragmentCount || identity.sourceFragmentCount === 0) {
      throw new Error(`Fixture identity mismatch: source dbId ${SOURCE_DB_ID} in the Structure model owns zero fragments -- cannot exercise the query`);
    }

    const totalFragments = identity.archFragmentTotal + identity.structureFragmentTotal + identity.mechanicalFragmentTotal;

    // ---- Step 3: sacrificial, UNMEASURED warm-up (codex-advisor recommendation) -------------------
    // Spec §14.2's "cold" means no TLAS/BLAS cached for the MEASURED world -- not a cold JavaScript
    // engine. Every measured CollisionWorld below still gets its own genuinely fresh
    // GeometryRegistry/BlasCache/TlasCache (per-instance state, confirmed against CollisionWorld's own
    // constructor), so running one throwaway TLAS query and one throwaway linear query here first --
    // in their OWN disposable worlds, immediately disposed -- warms V8 JIT/module-initialization cost
    // for the shared narrow-phase code path (extraction, weld, connectivity, BVH construction, the
    // composed narrow-phase queries) without touching either measured world's own cold-start state.
    // This directly addresses a real, independently-confirmed anomaly this script's own earlier
    // (superseded) run surfaced: an order-confounded ~35x narrowPhaseMs gap between a TLAS-cold run
    // (first call in the page) and a linear-cold run (run later, same page) for processing the
    // identical candidate-pair count from comparably fresh BLAS state -- almost certainly first-call
    // JIT bias, not a genuine per-pair algorithmic cost difference. This warm-up does not eliminate
    // every possible residual order/GC/OS-scheduling effect (see the report's own timingConfidence
    // caveat below), but removes the single largest, cheapest-to-fix confound before the real
    // measurement begins.
    console.log('\n=== Sacrificial warm-up (unmeasured; disposed immediately, does not touch measured worlds\' caches) ===');
    await page.evaluate(async ({ sourceDbId }) => {
      const { CollisionWorld } = await import('/collision/index.js');
      const modelStructure = window.__gate.modelStructure;
      const allModels = window.viewer.getAllModels();
      for (const broadPhase of ['tlas', 'linear']) {
        const warmupWorld = await CollisionWorld.fromViewer(window.viewer);
        warmupWorld.admitModel(window.__gate.modelArch);
        warmupWorld.admitModel(window.__gate.modelStructure);
        warmupWorld.admitModel(window.__gate.modelMechanical);
        try {
          await warmupWorld.findClashes({
            mode: 'volume-overlap',
            source: { model: modelStructure, dbIds: [sourceDbId] },
            target: { targets: allModels.map((m) => ({ model: m })) },
            groupBy: 'dbId',
            broadPhase,
          });
        } catch { /* warm-up only -- any error here is irrelevant to the measured runs below */ }
        warmupWorld.dispose();
      }
    }, { sourceDbId: SOURCE_DB_ID });

    // ---- Step 4: the real cold/warm/linear protocol (spec §14.2) -----------------------------------
    // Runs ONE federated volume-overlap query -- source dbId 3076 in the Structure model, targets =
    // ALL currently loaded models (Arch+Structure+Mechanical) via
    // viewer.getAllModels().map(m => ({model: m})) -- with broadPhase: 'tlas' (cold, then warm on the
    // SAME world/query) and again with broadPhase: 'linear', run on a SEPARATE, genuinely fresh
    // CollisionWorld (its own independent GeometryRegistry/BlasCache) so the linear baseline's own
    // BLAS-cold cost is not silently subsidized by the TLAS run's already-warmed geometry cache. A
    // linear "warm" (second call, same world) is additionally captured for completeness/symmetry,
    // though the spec's own protocol only requires cold/warm distinction for the TLAS path.
    //
    // Also captures a full per-pair signature (source/target model tag + dbId + clash type), not just
    // a pair COUNT -- codex-review finding: equal counts alone cannot rule out a real omission/false-
    // positive divergence between the two broad-phase paths hiding behind coincidentally-equal totals.
    async function runFederatedQuery(worldHandle, label, broadPhase) {
      return page.evaluate(async ({ worldHandle, label, broadPhase, sourceDbId }) => {
        const rec = new window.__CheckpointRecorder();
        const { setSpanRecorder, clearSpanRecorder } = await import('/collision/scheduler.js');
        setSpanRecorder(rec.asSpanRecorder());
        const world = window[worldHandle];
        const modelArch = window.__gate.modelArch;
        const modelStructure = window.__gate.modelStructure;
        const modelMechanical = window.__gate.modelMechanical;
        const allModels = window.viewer.getAllModels();
        const modelTag = (m) => (m === modelArch ? 'arch' : m === modelStructure ? 'structure' : m === modelMechanical ? 'mechanical' : 'unknown');
        const h = rec.start(`volume-overlap-total-wallclock-${label}`);
        let result = null;
        let error = null;
        try {
          result = await world.findClashes({
            mode: 'volume-overlap',
            source: { model: modelStructure, dbIds: [sourceDbId] },
            target: { targets: allModels.map((m) => ({ model: m })) },
            groupBy: 'dbId',
            broadPhase,
          });
        } catch (e) {
          error = { message: e.message, name: e.name, kind: e.kind, details: e.details };
        }
        const wallMs = h.end();
        clearSpanRecorder();
        const pairs = result?.pairs ?? null;
        return {
          wallMs,
          error,
          statistics: result?.statistics ?? null,
          pairCount: pairs?.length ?? null,
          sameModelPairCount: pairs?.filter((p) => p.target.model === modelStructure).length ?? null,
          crossModelPairCount: pairs?.filter((p) => p.target.model !== modelStructure).length ?? null,
          pairSignatures: pairs
            ? pairs.map((p) => `${modelTag(p.source.model)}:${p.source.dbId}:${modelTag(p.target.model)}:${p.target.dbId}:${p.type}`).sort()
            : null,
          spans: rec.spans,
          longestSpan: rec.longestSpan(),
        };
      }, { worldHandle, label, broadPhase, sourceDbId: SOURCE_DB_ID });
    }

    // --- TLAS world: ONE shared CollisionWorld for both the cold and warm TLAS calls ---
    const tlasLeases = await page.evaluate(async () => {
      const { CollisionWorld } = await import('/collision/index.js');
      window.__tlasWorld = await CollisionWorld.fromViewer(window.viewer);
      const leaseArch = window.__tlasWorld.admitModel(window.__gate.modelArch);
      const leaseStructure = window.__tlasWorld.admitModel(window.__gate.modelStructure);
      const leaseMechanical = window.__tlasWorld.admitModel(window.__gate.modelMechanical);
      return { epochArch: leaseArch.epoch, epochStructure: leaseStructure.epoch, epochMechanical: leaseMechanical.epoch };
    });
    console.log('\n=== TLAS world leases ===\n', JSON.stringify(tlasLeases, null, 2));

    console.log('\n=== TLAS cold (no TLAS/BLAS cached in THIS world; V8/JIT pre-warmed by Step 3) ===');
    const tlasCold = await runFederatedQuery('__tlasWorld', 'tlas-cold', 'tlas');
    const tlasColdSpanSummary = summarizeSpans(tlasCold.spans);
    console.log(JSON.stringify({ wallMs: tlasCold.wallMs, error: tlasCold.error, pairCount: tlasCold.pairCount, statistics: tlasCold.statistics && { ...tlasCold.statistics, diagnostics: summarizeDiagnostics(tlasCold.statistics.diagnostics) } }, null, 2));

    console.log('\n=== TLAS warm (TLAS+BLAS already built, immediately after) ===');
    const tlasWarm = await runFederatedQuery('__tlasWorld', 'tlas-warm', 'tlas');
    const tlasWarmSpanSummary = summarizeSpans(tlasWarm.spans);
    console.log(JSON.stringify({ wallMs: tlasWarm.wallMs, error: tlasWarm.error, pairCount: tlasWarm.pairCount, statistics: tlasWarm.statistics && { ...tlasWarm.statistics, diagnostics: summarizeDiagnostics(tlasWarm.statistics.diagnostics) } }, null, 2));

    // --- Criterion 5 (memory/cache behavior): TLAS entry retained size + instance-cache retention,
    // read from the TLAS world immediately after the warm run above. No public accessor exists for
    // TLAS-entry retained size (unlike CollisionWorld.getEpochCollisionInstanceCount, added in M1
    // Task 24 specifically for the identity-cache criterion this extends) -- this reaches into
    // CollisionWorld's own internal state (`_tlasCache`, `_placementByEpoch`), which is
    // convention-private (underscore-prefixed) but not JS-hard-private (`#`), purely for read-only
    // diagnostic purposes. This mirrors exactly the situation M1's own criterion 12 was in before that
    // accessor existed (browser-probes.mjs's own header comment on identityCacheRetainedSize). Not a
    // collision/ modification -- read-only introspection from this test script alone. ---
    const c5 = await page.evaluate(({ epochArch, epochStructure, epochMechanical }) => {
      const world = window.__tlasWorld;
      function tlasEntryRecordCount(epoch) {
        const entry = world._tlasCache?._entries?.get(epoch);
        if (!entry || entry.state !== 'ready') return null;
        return entry.bvh?._records?.length ?? null;
      }
      function row(epoch) {
        return {
          placementRecordCount: world._placementByEpoch.get(epoch)?.size ?? 0,
          tlasEntryRecordCount: tlasEntryRecordCount(epoch),
          instanceCacheRetained: world.getEpochCollisionInstanceCount(epoch),
        };
      }
      return { arch: row(epochArch), structure: row(epochStructure), mechanical: row(epochMechanical) };
    }, tlasLeases);
    console.log('\n=== Criterion 5: TLAS entry / instance-cache retained size (TLAS world) ===\n', JSON.stringify(c5, null, 2));

    // --- Linear world: a genuinely FRESH CollisionWorld (own GeometryRegistry/BlasCache) ---
    const linearLeases = await page.evaluate(async () => {
      const { CollisionWorld } = await import('/collision/index.js');
      window.__linearWorld = await CollisionWorld.fromViewer(window.viewer);
      const leaseArch = window.__linearWorld.admitModel(window.__gate.modelArch);
      const leaseStructure = window.__linearWorld.admitModel(window.__gate.modelStructure);
      const leaseMechanical = window.__linearWorld.admitModel(window.__gate.modelMechanical);
      return { epochArch: leaseArch.epoch, epochStructure: leaseStructure.epoch, epochMechanical: leaseMechanical.epoch };
    });
    console.log('\n=== Linear world leases ===\n', JSON.stringify(linearLeases, null, 2));

    console.log('\n=== Linear cold (fresh world, no BLAS cached) ===');
    const linearCold = await runFederatedQuery('__linearWorld', 'linear-cold', 'linear');
    const linearColdSpanSummary = summarizeSpans(linearCold.spans);
    console.log(JSON.stringify({ wallMs: linearCold.wallMs, error: linearCold.error, pairCount: linearCold.pairCount, statistics: linearCold.statistics && { ...linearCold.statistics, diagnostics: summarizeDiagnostics(linearCold.statistics.diagnostics) } }, null, 2));

    console.log('\n=== Linear warm (same world, BLAS cached, immediately after) ===');
    const linearWarm = await runFederatedQuery('__linearWorld', 'linear-warm', 'linear');
    const linearWarmSpanSummary = summarizeSpans(linearWarm.spans);
    console.log(JSON.stringify({ wallMs: linearWarm.wallMs, error: linearWarm.error, pairCount: linearWarm.pairCount, statistics: linearWarm.statistics && { ...linearWarm.statistics, diagnostics: summarizeDiagnostics(linearWarm.statistics.diagnostics) } }, null, 2));

    const c6Linear = await page.evaluate(({ epochArch, epochStructure, epochMechanical }) => {
      const world = window.__linearWorld;
      return {
        arch: world.getEpochCollisionInstanceCount(epochArch),
        structure: world.getEpochCollisionInstanceCount(epochStructure),
        mechanical: world.getEpochCollisionInstanceCount(epochMechanical),
      };
    }, linearLeases);

    // ---- Validation (codex-review finding #1): a run that ERRORED must never be silently folded
    // into a 'MEASURED' disposition. Collected here, before the report is assembled, so disposition
    // reflects real outcome rather than being hardcoded regardless of what happened. ----
    const runs = { tlasCold, tlasWarm, linearCold, linearWarm };
    const erroredRuns = Object.entries(runs).filter(([, r]) => r.error).map(([name, r]) => ({ name, error: r.error }));

    // ---- Correctness cross-check (codex-review finding #2): compare FULL pair-signature sets, not
    // just counts -- a count match alone cannot rule out a real omission/false-positive divergence
    // between the two broad-phase paths. Compared both across paths (tlas vs linear, cold and warm)
    // and within each path (cold vs warm, which must always agree since nothing about the scene
    // changes between those two calls). NOTE (codex-advisor's own caveat): pair-signature-set equality
    // proves the two paths agree on the final, dbId-aggregated CLASH result -- it does NOT by itself
    // prove they retested the identical underlying per-fragment candidate set (dbId-level aggregation
    // could in principle mask a fragment-level divergence); this script does not capture per-fragment
    // candidate identity, so that narrower claim is explicitly NOT made here.
    const sigEqual = (a, b) => Array.isArray(a) && Array.isArray(b) && JSON.stringify(a) === JSON.stringify(b);
    const correctnessCrossCheck = {
      tlasColdPairCount: tlasCold.pairCount,
      linearColdPairCount: linearCold.pairCount,
      tlasWarmPairCount: tlasWarm.pairCount,
      linearWarmPairCount: linearWarm.pairCount,
      tlasColdVsLinearColdPairSignaturesEqual: sigEqual(tlasCold.pairSignatures, linearCold.pairSignatures),
      tlasWarmVsLinearWarmPairSignaturesEqual: sigEqual(tlasWarm.pairSignatures, linearWarm.pairSignatures),
      tlasColdVsTlasWarmPairSignaturesEqual: sigEqual(tlasCold.pairSignatures, tlasWarm.pairSignatures),
      linearColdVsLinearWarmPairSignaturesEqual: sigEqual(linearCold.pairSignatures, linearWarm.pairSignatures),
      note: 'Signature-set equality is checked over the full {sourceModelTag, sourceDbId, targetModelTag, targetDbId, clashType} tuple for every returned pair, not merely pairs.length -- see this script\'s own inline comment for what this does and does not prove.',
    };
    const allSignatureSetsAgree = correctnessCrossCheck.tlasColdVsLinearColdPairSignaturesEqual
      && correctnessCrossCheck.tlasWarmVsLinearWarmPairSignaturesEqual
      && correctnessCrossCheck.tlasColdVsTlasWarmPairSignaturesEqual
      && correctnessCrossCheck.linearColdVsLinearWarmPairSignaturesEqual;

    // ---- Criterion 1: 'tlas-build' span label ----
    // Spec §9.1 requires the TLAS build to be reported via reportSpan('tlas-build', ms), the same
    // pattern GeometryRegistry's own weld/connectivity/bvh-construction phases already use. Searched
    // for it directly in this run's own captured cold-run spans below; ALSO independently confirmed by
    // static grep across the whole collision/ tree before this script was written: no
    // `reportSpan('tlas-build', ...)` call exists anywhere in collision/CollisionWorld.js or
    // collision/tlas/TlasCache.js (nor is the label referenced in any test). This is a genuine
    // production-instrumentation gap against the spec's own explicit requirement -- flagged here as a
    // finding, NOT fixed by this gate script (constraint: do not modify anything under collision/).
    const tlasBuildSpansCold = tlasCold.spans.filter((s) => s.label === 'tlas-build');
    const c1 = tlasBuildSpansCold.length > 0
      ? { exercised: true, spans: tlasBuildSpansCold }
      : {
        exercised: false,
        reason: "NOT EXERCISABLE as specified -- no 'tlas-build' span is ever emitted: confirmed both by this run's own captured span log (zero 'tlas-build' entries in the cold run, which DID build the TLAS per statistics.tlasBuilds below) and by a static grep across the whole collision/ tree finding no reportSpan('tlas-build', ...) call anywhere in CollisionWorld.js or TlasCache.js, despite spec section 9.1's explicit requirement to report it that way. This is a real production-instrumentation gap, not a fixture limitation -- reported as a finding, not fixed here (out of scope: do not modify collision/).",
        substituteMeasurement: 'Statistics.tlasBuildMs from the cold run (the closest existing field; wall-clock this call itself spent performing a TLAS build/refresh)',
        tlasBuildMsCold: tlasCold.statistics?.tlasBuildMs,
        tlasBuildsCold: tlasCold.statistics?.tlasBuilds,
      };

    // ---- Step 5: explicit, computed gate verdict (spec §14.1 -- codex-review finding #3; dimension
    // breakdown per codex-advisor's own recommendation, NOT one blanket yes/no) ----
    const candidateReductionRatio = ratio(linearCold.statistics?.broadPhasePairs, tlasCold.statistics?.broadPhasePairs);
    const candidateReductionVerdict = candidateReductionRatio === null
      ? 'NOT_EXERCISED'
      : candidateReductionRatio > 1.05
        ? 'CANDIDATE_REDUCTION_OBSERVED'
        : candidateReductionRatio < 0.95
          ? 'CANDIDATE_INCREASE_OBSERVED'
          : 'NO_MEANINGFUL_DIFFERENCE';

    const broadPhaseWarmBenefit = (typeof tlasWarm.statistics?.broadPhaseMs === 'number' && typeof linearWarm.statistics?.broadPhaseMs === 'number')
      ? (tlasWarm.statistics.broadPhaseMs < linearWarm.statistics.broadPhaseMs ? 'OBSERVED' : 'NOT_OBSERVED')
      : 'NOT_EXERCISED';
    const endToEndWarmBenefit = (typeof tlasWarm.wallMs === 'number' && typeof linearWarm.wallMs === 'number')
      ? (tlasWarm.wallMs < linearWarm.wallMs ? 'OBSERVED' : 'NOT_OBSERVED')
      : 'NOT_EXERCISED';
    const endToEndColdBenefit = (typeof tlasCold.wallMs === 'number' && typeof linearCold.wallMs === 'number')
      ? (tlasCold.wallMs < linearCold.wallMs ? 'OBSERVED' : 'NOT_OBSERVED')
      : 'NOT_EXERCISED';

    const gateAnswer = {
      question: "Is there a measurable candidate-search benefit of TLAS over M1's linear broad phase, on a realistic federated/fragment-dense case? (spec §14.1 -- does not presume the outcome.)",
      dimensions: {
        exactRetestCandidateReduction: {
          description: 'broadPhasePairs: the canonical, cross-path field (spec §7.5.2) counting candidates that survived target-scope/self-exclusion filtering and were handed to the exact _testBroadPhasePair retest -- the most directly comparable "candidate search cost" number between the two paths.',
          tlasBroadPhasePairs: tlasCold.statistics?.broadPhasePairs,
          linearBroadPhasePairs: linearCold.statistics?.broadPhasePairs,
          reductionRatio: candidateReductionRatio,
          verdict: candidateReductionVerdict,
        },
        rawTlasPrimitiveExpansion: {
          description: 'Upstream of the target-scope/self-exclusion filters (spec §9.3.1) -- the raw per-primitive expansion cost the TLAS traversal itself incurs before filtering, distinct from broadPhasePairs above.',
          tlasLeafRangeEmissions: tlasCold.statistics?.tlasLeafRangeEmissions,
          tlasPrimitiveCandidatePairs: tlasCold.statistics?.tlasPrimitiveCandidatePairs,
        },
        broadPhaseElapsedBenefitWarm: {
          description: 'Warm-vs-warm broadPhaseMs -- the fairest amortized comparison, since TLAS build cost is a one-time cost a single cold query never amortizes.',
          tlasWarmBroadPhaseMs: tlasWarm.statistics?.broadPhaseMs,
          linearWarmBroadPhaseMs: linearWarm.statistics?.broadPhaseMs,
          verdict: broadPhaseWarmBenefit,
        },
        endToEndElapsedBenefit: {
          cold: { tlasColdWallMs: tlasCold.wallMs, linearColdWallMs: linearCold.wallMs, verdict: endToEndColdBenefit },
          warm: { tlasWarmWallMs: tlasWarm.wallMs, linearWarmWallMs: linearWarm.wallMs, verdict: endToEndWarmBenefit },
        },
      },
      timingConfidenceCaveat: 'Wall-clock figures are descriptive, single-session measurements from one Playwright page, one sample per state. A sacrificial warm-up (Step 3: one unmeasured TLAS query + one unmeasured linear query, in throwaway worlds, disposed before any measured world was created) was run specifically to remove the largest, cheapest-to-fix confound -- first-ever-call V8 JIT/module-initialization bias -- but residual order/GC/OS-scheduling noise from a single sample each cannot be fully ruled out. Candidate-count comparisons (broadPhasePairs, tlasPrimitiveCandidatePairs) are structural and order-independent, and are the more reliable evidence specifically for the "candidate-search benefit" question spec §14.1 asks; wall-clock is reported alongside as required by criterion 4 but weighted accordingly.',
      correctnessCaveat: 'Pair-signature-set equality (see correctnessCrossCheck above) proves the two broad-phase paths agree on the final dbId-aggregated clash result for this query. It does NOT independently verify that both paths retested the identical underlying per-fragment candidate set (dbId-level aggregation could in principle mask a fragment-level divergence) -- this script does not capture per-fragment candidate identity, so describe result-set agreement as "equal, dbId-aggregated result sets confirmed identical" rather than "identical low-level candidate sets confirmed."',
    };

    // ---- Assemble the full report ----
    const anyErrors = erroredRuns.length > 0;
    const report = {
      disposition: anyErrors ? 'FAILED' : 'MEASURED',
      erroredRuns: anyErrors ? erroredRuns : undefined,
      environment: {
        browserVersion,
        os: `${os.platform()} ${os.release()} (${os.arch()})`,
        urns: { arch: ARCH_URN, structure: STRUCTURE_URN, mechanical: MECHANICAL_URN },
        sourceModel: 'structure',
        sourceDbId: SOURCE_DB_ID,
        fixtureNote: 'A real 3-discipline federated Revit host+links package (Architecture/Structure/Mechanical, each independently translated, sharing one real coordinate system) -- NOT a same-URN-twice substitution. Architecture loaded first (normally), Structure and Mechanical loaded as-additional via #keep-current-models. Federated target scope: viewer.getAllModels().map(m => ({model: m})) -- ALL three currently loaded models, per spec §14.2.',
        identity,
        consoleWarnings,
      },
      modelProfile: {
        archFragmentTotal: identity.archFragmentTotal,
        structureFragmentTotal: identity.structureFragmentTotal,
        mechanicalFragmentTotal: identity.mechanicalFragmentTotal,
        totalFragments,
      },
      tlasCold: { wallMs: tlasCold.wallMs, error: tlasCold.error, pairCount: tlasCold.pairCount, sameModelPairCount: tlasCold.sameModelPairCount, crossModelPairCount: tlasCold.crossModelPairCount, statistics: tlasCold.statistics && { ...tlasCold.statistics, diagnostics: summarizeDiagnostics(tlasCold.statistics.diagnostics) }, longestSpan: tlasCold.longestSpan, spansByLabel: tlasColdSpanSummary.byLabel, topSpans: tlasColdSpanSummary.top },
      tlasWarm: { wallMs: tlasWarm.wallMs, error: tlasWarm.error, pairCount: tlasWarm.pairCount, sameModelPairCount: tlasWarm.sameModelPairCount, crossModelPairCount: tlasWarm.crossModelPairCount, statistics: tlasWarm.statistics && { ...tlasWarm.statistics, diagnostics: summarizeDiagnostics(tlasWarm.statistics.diagnostics) }, longestSpan: tlasWarm.longestSpan, spansByLabel: tlasWarmSpanSummary.byLabel, topSpans: tlasWarmSpanSummary.top },
      linearCold: { wallMs: linearCold.wallMs, error: linearCold.error, pairCount: linearCold.pairCount, sameModelPairCount: linearCold.sameModelPairCount, crossModelPairCount: linearCold.crossModelPairCount, statistics: linearCold.statistics && { ...linearCold.statistics, diagnostics: summarizeDiagnostics(linearCold.statistics.diagnostics) }, longestSpan: linearCold.longestSpan, spansByLabel: linearColdSpanSummary.byLabel, topSpans: linearColdSpanSummary.top },
      linearWarm: { wallMs: linearWarm.wallMs, error: linearWarm.error, pairCount: linearWarm.pairCount, sameModelPairCount: linearWarm.sameModelPairCount, crossModelPairCount: linearWarm.crossModelPairCount, statistics: linearWarm.statistics && { ...linearWarm.statistics, diagnostics: summarizeDiagnostics(linearWarm.statistics.diagnostics) }, longestSpan: linearWarm.longestSpan, spansByLabel: linearWarmSpanSummary.byLabel, topSpans: linearWarmSpanSummary.top },
      criteria: {
        c1_tlasBuildCostPerEpochCold: c1,
        c2_tlasQueryCostColdVsWarm: {
          tlasQueryMsCold: tlasCold.statistics?.tlasQueryMs,
          tlasQueryMsWarm: tlasWarm.statistics?.tlasQueryMs,
        },
        c3_candidateCounts: {
          tlas: {
            tlasLeafRangeEmissions: tlasCold.statistics?.tlasLeafRangeEmissions,
            tlasPrimitiveCandidatePairs: tlasCold.statistics?.tlasPrimitiveCandidatePairs,
            broadPhasePairs: tlasCold.statistics?.broadPhasePairs,
            tlasExactRetestSurvivors: tlasCold.statistics?.tlasExactRetestSurvivors,
            tlasNarrowPhaseInputPairs: tlasCold.statistics?.tlasNarrowPhaseInputPairs,
          },
          linear: {
            broadPhasePairs: linearCold.statistics?.broadPhasePairs,
            narrowPhasePairs: linearCold.statistics?.narrowPhasePairs,
          },
        },
        c4_wallClock: {
          tlasColdMs: tlasCold.wallMs,
          tlasWarmMs: tlasWarm.wallMs,
          linearColdMs: linearCold.wallMs,
          linearWarmMs: linearWarm.wallMs,
        },
        c5_memoryCacheBehavior: {
          tlasWorld: c5,
          tlasBuildsCold: tlasCold.statistics?.tlasBuilds,
          tlasCacheHitsCold: tlasCold.statistics?.tlasCacheHits,
          tlasSharedBuildWaitsCold: tlasCold.statistics?.tlasSharedBuildWaits,
          tlasBuildMsCold: tlasCold.statistics?.tlasBuildMs,
          tlasBuildsWarm: tlasWarm.statistics?.tlasBuilds,
          tlasCacheHitsWarm: tlasWarm.statistics?.tlasCacheHits,
          tlasSharedBuildWaitsWarm: tlasWarm.statistics?.tlasSharedBuildWaits,
          tlasBuildMsWarm: tlasWarm.statistics?.tlasBuildMs,
          note: "tlasSharedBuildWaits is NOT EXERCISED by this gate: this script drives every call from a single Playwright page with no genuine concurrent caller racing the same epoch's TLAS build -- the field is expected to read 0 throughout for that structural reason, not because the field itself is broken.",
          linearWorldInstanceCacheRetained: c6Linear,
        },
        c6_fragmentInstanceCounts: {
          archFragmentTotal: identity.archFragmentTotal,
          structureFragmentTotal: identity.structureFragmentTotal,
          mechanicalFragmentTotal: identity.mechanicalFragmentTotal,
          totalFragments,
          tlasWorldInstanceCacheRetained: c5,
          maxTlasCandidatePairs,
          maxCollisionInstancesPerEpoch,
        },
      },
      correctnessCrossCheck: { ...correctnessCrossCheck, allSignatureSetsAgree },
      gateAnswer,
    };

    await writeFile(`${RESULTS_DIR}/m2-gate-${Date.now()}.json`, JSON.stringify(report, null, 2));
    console.log('\n=== Full M2 gate report (summarized spans/diagnostics) ===\n', JSON.stringify(report, null, 2));

    if (anyErrors) {
      console.error('\n=== GATE FAILED: one or more runs errored -- see erroredRuns above ===');
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

// Same guard as run-gate.mjs, for the same reason (Node's `node --test` default discovery sweeps in
// every .js/.mjs file under a directory literally named `test`).
const isMainModule = !process.env.NODE_TEST_CONTEXT
  && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
