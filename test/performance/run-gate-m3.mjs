// test/performance/run-gate-m3.mjs
//
// Task 18 (M3 milestone -- Soft Clash / Clearance): the M3 performance gate. Sibling to
// test/performance/run-gate.mjs (M1's gate) and test/performance/run-gate-m2.mjs (M2's gate) --
// BOTH of which are UNTOUCHED by this file (protected invariant). This script mirrors
// run-gate-m2.mjs's shape almost exactly (Playwright driver, proxy resolution, the same real
// 3-URN federated Audubon fixture loaded additively via #keep-current-models, CheckpointRecorder
// span capture injected through browser-probes.mjs, a sacrificial unmeasured warm-up, a cold+warm
// protocol on a shared TLAS world plus a genuinely fresh linear world, summarizeSpans/
// summarizeDiagnostics output discipline, and an explicit COMPUTED disposition with honest
// NOT-EXERCISED recording) for a NEW, additive M3 gate whose job is measuring
//   (a) clearance-mode TLAS-vs-linear broad-phase candidate cost, and
//   (b) the duration of a SINGLE `clearanceQuery` call,
// against the real live federated fixture -- no mocks, no synthetic data.
//
// Run: node test/performance/run-gate-m3.mjs   (npm run test:performance:gate:m3)
//
// --- SVF2 non-uniform fragment clearance extension (design 2026-10-07 §8 T7) -----------------------
//
// docs/superpowers/specs/2026-10-07-svf2-nonuniform-fragment-clearance-design.md. The protocol below
// now runs once per format -- the app default SVF2 (OTG) and forced legacy SVF (a page.route override
// of /viewerOptions.js flipping `svf2: true` to `false`, test-side only; the shipped default is not
// touched) -- each in its own browser, writing its own `m3-gate-<format>-<ts>.json`. Each run also
// records the clearance-private derived-geometry cache of every measured world (resolution/key
// accounting via a wrapper around `_clearanceDerivedCache.get`, plus
// `getEpochClearanceDerivedGeometryDiagnostics` and the canonical `getEpochGeometryDiagnostics` byte
// sums). With both formats measured, `m3-gate-svf2-criteria-<ts>.json` records the four pass/fail
// criteria: (a) builds <= distinct (geometryIndex, S) keys touched and builds + hits + sharedWaits ==
// derived resolutions; (b) peak retained derived bytes <= the same scene's SVF canonical retained
// bytes x 1.25; (c) SVF2 Soft wall time <= 2 x the same queries on legacy SVF (provisional); (d) the
// legacy-SVF run stays inside this gate's existing thresholds (MEASURED + criterion-6 GO). Select
// formats with M3_GATE_FORMATS=svf2,svf (default both); criteria need both.
//
// --- What this script reports, and what it deliberately does NOT do --------------------------------
//
// This script REPORTS; it does not gate CI on the result, and it does not retune any shipped
// constant. Per the M3 spec, a genuine NO-GO on the single-call-span criterion does not by itself
// block M3 -- a tighter DEFAULT_CLEARANCE, or scoping Soft Clash to smaller selections, may be
// sufficient mitigation -- but it must be an explicit, reported finding. Likewise a 'NOT EXERCISED'
// result is explicit and is NEVER silently treated as a pass: `Math.max(...[])` is `-Infinity`,
// which would compare as "comfortably within frameBudgetMs" and report a false GO, so the empty-set
// guard below is load-bearing, not defensive decoration.
//
// --- The fixture: the SAME real 3-discipline federated Revit host+links setup run-gate-m2.mjs uses --
//
// Three genuinely separate, independently-translated discipline models sharing one real coordinate
// system -- a real coordinated Architecture+Structure+Mechanical Revit host+links package, not an
// artificial same-URN-twice substitution (URNs copied verbatim from run-gate-m2.mjs):
//   - Architecture: ~5,435 fragments, loaded first (normally).
//   - Structure: ~543 fragments, loaded second (as-additional, #keep-current-models).
//   - Mechanical: ~1,496 fragments, loaded third (as-additional, same checkbox).
// This script independently RE-confirms all of that live (model count, per-model fragment totals,
// and that the chosen source dbId owns real geometry) before trusting any of it, exactly as
// run-gate-m2.mjs does -- nothing here is taken on faith from that file's own header.
//
// --- Why source dbId 3076 and clearance 0.05 --------------------------------------------------------
//
// Source: Structure (model index 1) dbId 3076 -- "Floor [401326]", a single-fragment floor slab.
// This is the SAME source run-gate-m2.mjs uses, and the choice was re-derived for clearance mode
// rather than assumed to transfer from Hard Clash:
//   - The candidate-reduction machinery this gate's criteria 1-3 are about only means anything at a
//     large candidate volume. 3076 produced 1,913 broadPhasePairs / 1,197 result pairs under
//     mode:'volume-overlap' on this same fixture (m2-gate-1788758319999.json), the largest real
//     candidate volume this fixture offers from a single source instance.
//   - Clearance candidates are a strict SUPERSET of that mode's candidates for the same source and
//     scope: `_runClearanceBroadPhaseScan`/`_runClearanceTlasBroadPhase` admit every pair with
//     `aabbMinDistance(...) <= clearance`, which includes every AABB-OVERLAPPING pair (distance 0)
//     Hard Clash admits, plus the near-miss shell. So 3076 cannot under-exercise clearance relative
//     to Hard Clash, and it additionally guarantees a large population of BOTH precheck outcomes
//     (genuine overlaps -> 'excluded'; near-misses -> a real `clearanceQuery` distance call), which
//     is exactly what criterion 3's precheck-vs-distance-query split needs to be meaningful.
//   - The fixture's OTHER known clearance source, Structure dbId 3965 (the acceptance suite's own
//     discovered near-miss, 2 pairs at clearance 0.05), is deliberately NOT used here: 2 result
//     pairs cannot exercise broad-phase candidate reduction at all.
// Clearance: 0.05 -- the real production default (`DEFAULT_CLEARANCE`,
// wwwroot/extensions/ClashFinderExtension.js:60), in this model's own units (feet), so the numbers
// below describe what a real "Find Soft Clashes" click actually costs rather than an invented value.
// It is NOT tuned here in either direction: the Global Constraints for this milestone make
// DEFAULT_CLEARANCE / maxClearanceNarrowPhasePairs / the two 1e-4 tolerances explicitly provisional
// values that THIS measurement is evidence for, and this task implements the measurement, not a
// revision of them.
const ARCH_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fQXJjaGl0ZWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const STRUCTURE_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fU3RydWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const MECHANICAL_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fTWVjaGFuaWNhbF9jbGFzaF90ZXN0LnJ2dA';
// Legacy-SVF dbId of the source -- see header comment. dbIds are NOT stable across formats (SVF2
// renumbers), so each format pass resolves the live dbId from the Revit ElementId below (design
// 2026-10-07 §8 T7) and reassigns SOURCE_DB_ID before using it.
let SOURCE_DB_ID = 3076;  // Structure model (index 1), "Floor [401326]" under legacy SVF.
const SOURCE_ELEMENT_ID = '401326';
const CLEARANCE = 0.05;     // DEFAULT_CLEARANCE (ClashFinderExtension.js:60), model units.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import {
  frameBudgetMs, maxClearanceNarrowPhasePairs, maxTlasCandidatePairs, maxCollisionInstancesPerEpoch,
} from '../../collision/constants.js';

const PORT = process.env.PORT || 8080;

// The production label CollisionWorld.js:2321 emits around every single `clearanceQuery` call
// (`reportSpan('clearance-distance-query', distanceQueryMs)`), which criterion 6's disposition
// consumes. Named once here so a future rename of the production label produces an obviously-empty
// span set (-> 'NOT EXERCISED') rather than a silently wrong verdict.
const CLEARANCE_SPAN_LABEL = 'clearance-distance-query';

// Maximum absolute disagreement tolerated between the distance the TLAS path and the linear path
// report for the SAME result key before this gate calls the run invalid. Both broad phases hand the
// identical operand pair to the identical `clearanceQuery`, so they should agree bit-for-bit -- two
// independent live runs measured a max delta of exactly 0 over all 30 shared keys. This is a
// float-noise allowance around that observed zero, ~5 orders of magnitude tighter than the smallest
// real distance this fixture reports (~0.0417), so it stays a meaningful check rather than a rubber
// stamp.
const MAX_CROSS_PATH_DISTANCE_DELTA = 1e-9;

// Identical to run-gate.mjs/run-gate-m2.mjs's own helper -- see run-gate.mjs's inline comment for
// the full rationale.
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

// Identical to run-gate.mjs/run-gate-m2.mjs's own summarizeSpans -- per-label aggregates plus a
// bounded top-N, never the raw per-span array (a clearance run emits one span per distance query,
// which is thousands of entries on this fixture).
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

// Same discipline run-gate-m2.mjs applies, for the same documented reason (M1's own disposition doc
// recorded an unusable 15MB/769K-line raw dump): count + per-reason breakdown + a bounded sample,
// never the raw diagnostics array.
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

// Distribution summary for a plain array of millisecond durations. Criterion 6's disposition is
// about the WORST single call, but a worst value with no distribution around it is impossible to
// interpret (one 30ms outlier among 3,000 sub-millisecond calls is a very different finding from a
// uniformly 30ms population), so the percentiles and the over-budget count are reported alongside
// it -- as context for the verdict, never as a substitute for it.
function summarizeDurations(msValues) {
  if (msValues.length === 0) {
    return { count: 0, maxMs: null, meanMs: null, sumMs: 0, p50Ms: null, p95Ms: null, p99Ms: null, overFrameBudgetCount: 0, overFrameBudgetFraction: null };
  }
  const sorted = [...msValues].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const sumMs = sorted.reduce((a, b) => a + b, 0);
  const overFrameBudgetCount = sorted.filter((ms) => ms > frameBudgetMs).length;
  return {
    count: sorted.length,
    maxMs: sorted[sorted.length - 1],
    meanMs: sumMs / sorted.length,
    sumMs,
    p50Ms: at(0.5),
    p95Ms: at(0.95),
    p99Ms: at(0.99),
    overFrameBudgetCount,
    overFrameBudgetFraction: overFrameBudgetCount / sorted.length,
  };
}

function clearanceSpanMs(run) {
  return run.spans.filter((s) => s.label === CLEARANCE_SPAN_LABEL).map((s) => s.ms);
}

// Design 2026-10-07 §8 T7: page-side instrumentation of a world's derived-geometry cache. Counts
// every derived resolution (one per `get`) and the distinct (geometryIndex, S) keys touched; a world
// with no derived cache (legacy builds) records nothing.
function installDerivedInstrumentation(page, worldHandle) {
  return page.evaluate(({ worldHandle }) => {
    const world = window[worldHandle];
    const cache = world && world._clearanceDerivedCache;
    const record = { resolutions: 0, keys: new Set(), peakRetainedBytes: 0 };
    window.__derivedInstrumentation = window.__derivedInstrumentation ?? {};
    window.__derivedInstrumentation[worldHandle] = record;
    if (!cache) return { instrumented: false };
    const realGet = cache.get.bind(cache);
    cache.get = (args) => {
      record.resolutions++;
      record.keys.add(`${args.loadEpoch}|${args.geometryIndex}|${args.scale.join(',')}`);
      return realGet(args);
    };
    return { instrumented: true };
  }, { worldHandle });
}

function sampleDerivedState(page, worldHandle, epochs) {
  return page.evaluate(({ worldHandle, epochs }) => {
    const world = window[worldHandle];
    const record = window.__derivedInstrumentation?.[worldHandle];
    const perEpoch = {};
    let derivedRetainedBytes = 0;
    let canonicalRetainedBytes = 0;
    const totals = { builds: 0, hits: 0, sharedWaits: 0, evictions: 0, readyEntries: 0, unsupportedEntries: 0, buildingEntries: 0 };
    for (const [name, epoch] of Object.entries(epochs)) {
      const derived = typeof world.getEpochClearanceDerivedGeometryDiagnostics === 'function'
        ? world.getEpochClearanceDerivedGeometryDiagnostics(epoch) : null;
      const canonical = world.getEpochGeometryDiagnostics(epoch);
      const canonicalBytes = canonical.reduce((sum, e) => sum + (e.weldedPositionBytes ?? 0) + (e.weldedIndexBytes ?? 0)
        + (e.bvhRootBytes ?? 0) + (e.bvhIndirectBytes ?? 0), 0);
      canonicalRetainedBytes += canonicalBytes;
      if (derived) {
        derivedRetainedBytes += derived.retainedPositionBytes + derived.retainedIndexBytes + derived.retainedBvhBytes;
        for (const k of Object.keys(totals)) totals[k] += derived[k];
      }
      perEpoch[name] = { epoch, derived, canonicalEntries: canonical.length, canonicalRetainedBytes: canonicalBytes };
    }
    if (record) record.peakRetainedBytes = Math.max(record.peakRetainedBytes, derivedRetainedBytes);
    return {
      perEpoch, totals, derivedRetainedBytes, canonicalRetainedBytes,
      resolutions: record ? record.resolutions : null,
      distinctKeysTouched: record ? record.keys.size : null,
      peakDerivedRetainedBytes: record ? record.peakRetainedBytes : null,
    };
  }, { worldHandle, epochs });
}

async function runProtocol(format) {
  await mkdir(RESULTS_DIR, { recursive: true });
  const browser = await chromium.launch({
    // Same forced launch args this repo's own sandbox needs -- see run-gate.mjs's header comment.
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote'],
    proxy: resolveProxyFromEnv(),
  });
  const browserVersion = await browser.version();
  const page = await browser.newPage();
  if (format === 'svf') {
    // Test-side forced legacy SVF (design 2026-10-07 §8 T7): the shipped default stays SVF2.
    await page.route('**/viewerOptions.js', async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace('return { svf2: true,', 'return { svf2: false,');
      if (!body.includes('return { svf2: false,')) throw new Error('forced-legacy route override did not apply -- viewerOptions.js shape changed');
      await route.fulfill({ response, body });
    });
  }
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

    // Design 2026-10-07 §8 T7: confirm the loaded format is the one this pass is meant to measure.
    const loadedFormats = await page.evaluate(() => window.viewer.getAllModels().map((m) => (m.isOTG && m.isOTG() ? 'svf2' : 'svf')));
    console.log(`\n=== Format pass: ${format} (loaded: ${loadedFormats.join(', ')}) ===`);
    if (!loadedFormats.every((f) => f === format)) {
      throw new Error(`Format pass '${format}' loaded ${JSON.stringify(loadedFormats)} -- refusing to report mislabeled measurements`);
    }

    // Design 2026-10-07 §8 T7: resolve the source dbId for THIS format from its Revit ElementId.
    SOURCE_DB_ID = await page.evaluate(({ elementId }) => {
      const it = window.viewer.getAllModels()[1].getInstanceTree();
      let found = null;
      const walk = (id) => {
        const name = it.getNodeName(id);
        if (found === null && typeof name === 'string' && name.endsWith(`[${elementId}]`)) found = id;
        it.enumNodeChildren(id, walk);
      };
      walk(it.getRootId());
      return found;
    }, { elementId: SOURCE_ELEMENT_ID });
    console.log(`\n=== Source "[${SOURCE_ELEMENT_ID}]" resolves to Structure dbId ${SOURCE_DB_ID} under ${format} ===`);

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

    // ---- Step 3: sacrificial, UNMEASURED warm-up ---------------------------------------------------
    // Identical rationale to run-gate-m2.mjs's own Step 3, applied to the clearance path: "cold"
    // means no TLAS/BLAS cached for the MEASURED world, not a cold JavaScript engine. Every measured
    // CollisionWorld below still gets a genuinely fresh GeometryRegistry/BlasCache/TlasCache, so
    // running one throwaway clearance TLAS query and one throwaway clearance linear query here first
    // -- in their OWN disposable worlds, disposed immediately -- warms V8 JIT/module-initialization
    // cost for the shared code path (extraction, weld, connectivity, BVH construction, the Hard-Clash
    // precheck's volumeOverlapQuery, and ClearanceQuery's own closestPointToGeometry) without
    // touching either measured world's cold-start state. No span recorder is installed here, so not
    // one warm-up `clearance-distance-query` span can leak into the measured disposition below.
    console.log('\n=== Sacrificial warm-up (unmeasured; disposed immediately, does not touch measured worlds\' caches) ===');
    await page.evaluate(async ({ sourceDbId, clearance }) => {
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
            mode: 'clearance',
            clearance,
            source: { model: modelStructure, dbIds: [sourceDbId] },
            target: { targets: allModels.map((m) => ({ model: m })) },
            groupBy: 'dbId',
            broadPhase,
          });
        } catch { /* warm-up only -- any error here is irrelevant to the measured runs below */ }
        warmupWorld.dispose();
      }
    }, { sourceDbId: SOURCE_DB_ID, clearance: CLEARANCE });

    // ---- Step 4: the real cold/warm/linear protocol -------------------------------------------------
    // Runs ONE federated clearance query -- source dbId 3076 in the Structure model, targets = ALL
    // currently loaded models (Arch+Structure+Mechanical) -- with broadPhase:'tlas' (cold, then warm
    // on the SAME world/query) and again with broadPhase:'linear' on a SEPARATE, genuinely fresh
    // CollisionWorld, so the linear baseline's own BLAS-cold cost is not silently subsidized by the
    // TLAS run's already-warmed geometry cache.
    //
    // `setSpanRecorder(rec.asSpanRecorder())` is installed around each measured call and cleared
    // immediately after (the exact wiring run-gate-m2.mjs already uses for its own
    // 'capacity-admission-commit' spans) -- this is what makes the production
    // `reportSpan('clearance-distance-query', ...)` call at CollisionWorld.js:2321 observable here.
    //
    // Also captures a full per-pair signature (source/target model tag + dbId + clash type) plus the
    // per-pair reported distance, not just a pair COUNT -- equal counts alone cannot rule out a real
    // omission/false-positive divergence between the two broad-phase paths (run-gate-m2.mjs's own
    // codex-review finding, applied here for the same reason).
    async function runClearanceQuery(worldHandle, label, broadPhase) {
      return page.evaluate(async ({ worldHandle, label, broadPhase, sourceDbId, clearance }) => {
        const rec = new window.__CheckpointRecorder();
        const { setSpanRecorder, clearSpanRecorder } = await import('/collision/scheduler.js');
        setSpanRecorder(rec.asSpanRecorder());
        // codex-review finding #4 (resource hygiene): `clearSpanRecorder()` must run even if
        // something between here and the end of this block throws OUTSIDE the findClashes try/catch
        // below (e.g. the pair-mapping code) -- otherwise the module-global span recorder stays
        // installed for the rest of the page's life, silently contaminating every later run's span
        // set. `rec.dispose()` likewise disconnects the CheckpointRecorder's own longtask
        // PerformanceObserver, which was previously leaked once per measured run.
        try {
          const world = window[worldHandle];
          const modelArch = window.__gate.modelArch;
          const modelStructure = window.__gate.modelStructure;
          const modelMechanical = window.__gate.modelMechanical;
          const allModels = window.viewer.getAllModels();
          const modelTag = (m) => (m === modelArch ? 'arch' : m === modelStructure ? 'structure' : m === modelMechanical ? 'mechanical' : 'unknown');
          const h = rec.start(`clearance-total-wallclock-${label}`);
          let result = null;
          let error = null;
          try {
            result = await world.findClashes({
              mode: 'clearance',
              clearance,
              source: { model: modelStructure, dbIds: [sourceDbId] },
              target: { targets: allModels.map((m) => ({ model: m })) },
              groupBy: 'dbId',
              broadPhase,
            });
          } catch (e) {
            error = { message: e.message, name: e.name, kind: e.kind, details: e.details };
          }
          const wallMs = h.end();
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
            // Keyed distances, so the two broad-phase paths can be compared on the VALUE they report
            // for each shared key, not merely on which keys they found. Never dumped raw into the
            // report -- reduced to a single max-absolute-delta below.
            pairDistances: pairs
              ? pairs.map((p) => [`${modelTag(p.source.model)}:${p.source.dbId}:${modelTag(p.target.model)}:${p.target.dbId}`, p.distance])
              : null,
            // Witness-shape confirmation: a clearance pair's witness is {sourcePoint, targetPoint},
            // structurally different from a volume-overlap witness ({kind, point}). Counted, not dumped.
            witnessShapeOk: pairs
              ? pairs.every((p) => p.witness && Array.isArray(p.witness.sourcePoint) && Array.isArray(p.witness.targetPoint))
              : null,
            spans: rec.spans,
            longestSpan: rec.longestSpan(),
          };
        } finally {
          clearSpanRecorder();
          rec.dispose();
        }
      }, { worldHandle, label, broadPhase, sourceDbId: SOURCE_DB_ID, clearance: CLEARANCE });
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
    await installDerivedInstrumentation(page, '__tlasWorld');

    console.log('\n=== Clearance TLAS cold (no TLAS/BLAS cached in THIS world; V8/JIT pre-warmed by Step 3) ===');
    const tlasCold = await runClearanceQuery('__tlasWorld', 'tlas-cold', 'tlas');
    const tlasColdSpanSummary = summarizeSpans(tlasCold.spans);
    const derivedTlasAfterCold = await sampleDerivedState(page, '__tlasWorld', tlasLeases);
    console.log(JSON.stringify({ wallMs: tlasCold.wallMs, error: tlasCold.error, pairCount: tlasCold.pairCount, clearanceSpanCount: clearanceSpanMs(tlasCold).length, statistics: tlasCold.statistics && { ...tlasCold.statistics, diagnostics: summarizeDiagnostics(tlasCold.statistics.diagnostics) } }, null, 2));

    console.log('\n=== Clearance TLAS warm (TLAS+BLAS already built, immediately after) ===');
    const tlasWarm = await runClearanceQuery('__tlasWorld', 'tlas-warm', 'tlas');
    const tlasWarmSpanSummary = summarizeSpans(tlasWarm.spans);
    const derivedTlasAfterWarm = await sampleDerivedState(page, '__tlasWorld', tlasLeases);
    console.log(JSON.stringify({ wallMs: tlasWarm.wallMs, error: tlasWarm.error, pairCount: tlasWarm.pairCount, clearanceSpanCount: clearanceSpanMs(tlasWarm).length, statistics: tlasWarm.statistics && { ...tlasWarm.statistics, diagnostics: summarizeDiagnostics(tlasWarm.statistics.diagnostics) } }, null, 2));

    // codex-review finding #4 (resource hygiene): dispose the TLAS world and drop its handle BEFORE
    // the linear world is built, so the linear measurements do not run under the extra heap pressure
    // / GC exposure of a fully-populated TLAS+BLAS cache that nothing reads any more. Every value
    // this gate reports from the TLAS runs (statistics, spans, pair sets) was already returned to
    // Node above, so nothing below reads `window.__tlasWorld` -- this is a pure release. Deliberate,
    // documented divergence from run-gate-m2.mjs, which retains its TLAS world because its own
    // criterion 5 reads TLAS-entry internals after the linear runs; this gate has no such criterion.
    await page.evaluate(() => {
      window.__tlasWorld?.dispose();
      delete window.__tlasWorld;
    });

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
    await installDerivedInstrumentation(page, '__linearWorld');

    console.log('\n=== Clearance linear cold (fresh world, no BLAS cached) ===');
    const linearCold = await runClearanceQuery('__linearWorld', 'linear-cold', 'linear');
    const linearColdSpanSummary = summarizeSpans(linearCold.spans);
    const derivedLinearAfterCold = await sampleDerivedState(page, '__linearWorld', linearLeases);
    console.log(JSON.stringify({ wallMs: linearCold.wallMs, error: linearCold.error, pairCount: linearCold.pairCount, clearanceSpanCount: clearanceSpanMs(linearCold).length, statistics: linearCold.statistics && { ...linearCold.statistics, diagnostics: summarizeDiagnostics(linearCold.statistics.diagnostics) } }, null, 2));

    console.log('\n=== Clearance linear warm (same world, BLAS cached, immediately after) ===');
    const linearWarm = await runClearanceQuery('__linearWorld', 'linear-warm', 'linear');
    const linearWarmSpanSummary = summarizeSpans(linearWarm.spans);
    const derivedLinearAfterWarm = await sampleDerivedState(page, '__linearWorld', linearLeases);
    console.log(JSON.stringify({ wallMs: linearWarm.wallMs, error: linearWarm.error, pairCount: linearWarm.pairCount, clearanceSpanCount: clearanceSpanMs(linearWarm).length, statistics: linearWarm.statistics && { ...linearWarm.statistics, diagnostics: summarizeDiagnostics(linearWarm.statistics.diagnostics) } }, null, 2));

    // ---- Validation: a run that ERRORED must never be silently folded into a 'MEASURED'
    // disposition (run-gate-m2.mjs's own codex-review finding #1, same discipline here). ----
    const runs = { tlasCold, tlasWarm, linearCold, linearWarm };
    const erroredRuns = Object.entries(runs).filter(([, r]) => r.error).map(([name, r]) => ({ name, error: r.error }));

    // ---- Criterion 6's raw material: the real production spans -----------------------------------
    // One entry per `clearanceQuery` call, emitted by CollisionWorld.js:2321's
    // `reportSpan('clearance-distance-query', distanceQueryMs)`. Collected per run AND unioned
    // across all four measured runs -- the union is what the disposition verdict is computed from,
    // since criterion 6 asks about the worst SINGLE call anywhere in the measured protocol, not the
    // worst call in one arbitrarily-chosen run.
    const clearanceSpansByRun = {
      tlasCold: clearanceSpanMs(tlasCold),
      tlasWarm: clearanceSpanMs(tlasWarm),
      linearCold: clearanceSpanMs(linearCold),
      linearWarm: clearanceSpanMs(linearWarm),
    };
    const clearanceQuerySpans = [
      ...clearanceSpansByRun.tlasCold, ...clearanceSpansByRun.tlasWarm,
      ...clearanceSpansByRun.linearCold, ...clearanceSpansByRun.linearWarm,
    ];

    // ---- Step 5 (brief Step 3): the explicit go/no-go disposition for criterion 6, WITH the
    // empty-set guard. `Math.max(...[])` is `-Infinity`, which would compare as "comfortably within
    // frameBudgetMs" and silently report a false GO from a span set that was never populated at all
    // -- so a nonempty set is REQUIRED before any verdict is computed. ----
    let disposition;
    if (clearanceQuerySpans.length === 0) {
      disposition = {
        verdict: 'NOT EXERCISED — no clearance-distance-query spans were recorded',
        worstSpanMs: null,
        frameBudgetMs,
      };
    } else {
      const worstSpanMs = Math.max(...clearanceQuerySpans);
      disposition = worstSpanMs > frameBudgetMs
        ? {
          // "substantial, consistent margin" -- this gate's own reasoned reading of the spec's
          // qualitative phrase: >2x frameBudgetMs is NO-GO, anything over budget but under 2x is
          // CAUTION.
          verdict: worstSpanMs > frameBudgetMs * 2
            ? 'NO-GO — worst single-call span substantially exceeds frameBudgetMs'
            : 'CAUTION — worst single-call span exceeds frameBudgetMs but not by a substantial margin',
          worstSpanMs,
          frameBudgetMs,
        }
        : { verdict: 'GO — worst single-call span within frameBudgetMs', worstSpanMs, frameBudgetMs };
    }
    // Provenance + distribution context, attached AFTER the three load-bearing fields above so the
    // verdict itself is computed from nothing but the real span set and frameBudgetMs.
    disposition.spanLabel = CLEARANCE_SPAN_LABEL;
    disposition.spanSource = 'collision/CollisionWorld.js:2321 -- reportSpan(\'clearance-distance-query\', distanceQueryMs), the real production instrumentation wrapped around every clearanceQuery() call, captured here via setSpanRecorder(CheckpointRecorder.asSpanRecorder()) from collision/scheduler.js. NOT a re-timing performed by this script.';
    disposition.spanScope = 'Union of all four measured runs (tlas-cold, tlas-warm, linear-cold, linear-warm). The unmeasured Step 3 warm-up installs no span recorder, so none of its calls can contribute.';
    disposition.distribution = summarizeDurations(clearanceQuerySpans);
    disposition.perRunDistribution = {
      tlasCold: summarizeDurations(clearanceSpansByRun.tlasCold),
      tlasWarm: summarizeDurations(clearanceSpansByRun.tlasWarm),
      linearCold: summarizeDurations(clearanceSpansByRun.linearCold),
      linearWarm: summarizeDurations(clearanceSpansByRun.linearWarm),
    };
    if (erroredRuns.length > 0) {
      disposition.erroredRunCaveat = `${erroredRuns.length} of the 4 measured runs errored (see report.erroredRuns) -- the spans below cover only the work those runs completed before failing, so this verdict is drawn from a partial population.`;
    }
    disposition.dispositionCaveat = 'This is a REPORTED finding, not a CI gate: this script never fails a build on the verdict, and never retunes a shipped constant on its own initiative. Per the M3 spec a genuine NO-GO does not by itself block M3 -- a tighter DEFAULT_CLEARANCE, or scoping Soft Clash to smaller selections, may be sufficient mitigation.';

    // ---- Metrics 1-3: candidate counts, reduction ratio, precheck-vs-distance-query split ---------
    //
    // Field semantics, confirmed by direct read of CollisionWorld.js (NOT assumed):
    //   - `broadPhasePairs` is mode-agnostic and is incremented at the same point on BOTH clearance
    //     broad phases (linear: the source x target product after self-exclusion, CollisionWorld.js
    //     :1966; TLAS: per surviving TLAS candidate after scope/self-exclusion filtering, :2057), so
    //     it is the directly comparable "candidate search cost" number between the two paths --
    //     exactly as it is for Hard Clash in run-gate-m2.mjs.
    //   - `clearanceExpandedCandidatePairs` is incremented ONLY on the TLAS path (:2058); it reads 0
    //     on a linear run BY CONSTRUCTION, which is not a measurement failure and is reported as
    //     such below rather than as a suspicious zero.
    //   - `clearanceExactAabbSurvivors` is incremented on BOTH paths at the identical predicate
    //     (`aabbMinDistance(...) <= clearance`, :1967/:2059), so the two paths MUST agree on it --
    //     asserted below as a real cross-path invariant, not merely printed.
    const candidateReductionRatio = ratio(linearCold.statistics?.broadPhasePairs, tlasCold.statistics?.broadPhasePairs);
    const candidateReductionVerdict = candidateReductionRatio === null
      ? 'NOT_EXERCISED'
      : candidateReductionRatio > 1.05
        ? 'CANDIDATE_REDUCTION_OBSERVED'
        : candidateReductionRatio < 0.95
          ? 'CANDIDATE_INCREASE_OBSERVED'
          : 'NO_MEANINGFUL_DIFFERENCE';
    const rawExpansionReductionRatio = ratio(linearCold.statistics?.broadPhasePairs, tlasCold.statistics?.tlasPrimitiveCandidatePairs);

    function prechecksVsDistanceQueries(run) {
      const s = run.statistics;
      if (!s) return null;
      return {
        clearanceOverlapPrechecksRun: s.clearanceOverlapPrechecksRun,
        clearanceDistanceQueriesRun: s.clearanceDistanceQueriesRun,
        narrowPhasePairs: s.narrowPhasePairs,
        clearanceHardClashExclusions: s.clearanceHardClashExclusions,
        // Every candidate either skipped the precheck (AABB min distance > 0 -- disjoint boxes, so no
        // Hard-Clash overlap is possible) or ran it. The complement is therefore the count of
        // candidates whose AABBs actually touched.
        prechecksSkipped: s.narrowPhasePairs - s.clearanceOverlapPrechecksRun,
        prechecksRunFraction: ratio(s.clearanceOverlapPrechecksRun, s.narrowPhasePairs),
        distanceQueriesRunFraction: ratio(s.clearanceDistanceQueriesRun, s.narrowPhasePairs),
        // A candidate reaching narrow phase runs a distance query UNLESS it was Hard-Clash-excluded,
        // ruled inconclusive, or failed geometry resolution / uniform-scale validation first.
        candidatesWithNoDistanceQuery: s.narrowPhasePairs - s.clearanceDistanceQueriesRun,
      };
    }

    // ---- Metric 4: clearanceQueryMs / totalMs -------------------------------------------------------
    function clearanceQueryShare(run) {
      const s = run.statistics;
      if (!s) return null;
      return {
        clearanceQueryMs: s.clearanceQueryMs,
        totalMs: s.totalMs,
        narrowPhaseMs: s.narrowPhaseMs,
        broadPhaseMs: s.broadPhaseMs,
        wallMs: run.wallMs,
        clearanceQueryMsOverTotalMs: ratio(s.clearanceQueryMs, s.totalMs),
        clearanceQueryMsOverNarrowPhaseMs: ratio(s.clearanceQueryMs, s.narrowPhaseMs),
      };
    }

    // ---- Metric 7: all 7 clearance statistics fields, reported plainly -------------------------------
    // The full set, in the order collision/CollisionWorld.js's own emptyStatistics() declares them
    // (:516-522) plus the mode-agnostic `narrowPhasePairs` clearance also populates (:1724).
    function clearanceStatisticsFields(run) {
      const s = run.statistics;
      if (!s) return null;
      return {
        clearanceExpandedCandidatePairs: s.clearanceExpandedCandidatePairs,
        clearanceExactAabbSurvivors: s.clearanceExactAabbSurvivors,
        clearanceOverlapPrechecksRun: s.clearanceOverlapPrechecksRun,
        clearanceHardClashExclusions: s.clearanceHardClashExclusions,
        clearanceDistanceQueriesRun: s.clearanceDistanceQueriesRun,
        clearanceHits: s.clearanceHits,
        narrowPhasePairs: s.narrowPhasePairs,
      };
    }

    // ---- Correctness cross-check across the two broad-phase paths ------------------------------------
    const sigEqual = (a, b) => Array.isArray(a) && Array.isArray(b) && JSON.stringify(a) === JSON.stringify(b);
    function maxDistanceDelta(a, b) {
      if (!Array.isArray(a) || !Array.isArray(b)) return null;
      const mapB = new Map(b);
      let worst = 0;
      let compared = 0;
      for (const [key, distA] of a) {
        if (!mapB.has(key)) continue;
        compared++;
        worst = Math.max(worst, Math.abs(distA - mapB.get(key)));
      }
      return { comparedKeys: compared, maxAbsoluteDelta: worst };
    }
    const correctnessCrossCheck = {
      tlasColdPairCount: tlasCold.pairCount,
      linearColdPairCount: linearCold.pairCount,
      tlasWarmPairCount: tlasWarm.pairCount,
      linearWarmPairCount: linearWarm.pairCount,
      tlasColdVsLinearColdPairSignaturesEqual: sigEqual(tlasCold.pairSignatures, linearCold.pairSignatures),
      tlasWarmVsLinearWarmPairSignaturesEqual: sigEqual(tlasWarm.pairSignatures, linearWarm.pairSignatures),
      tlasColdVsTlasWarmPairSignaturesEqual: sigEqual(tlasCold.pairSignatures, tlasWarm.pairSignatures),
      linearColdVsLinearWarmPairSignaturesEqual: sigEqual(linearCold.pairSignatures, linearWarm.pairSignatures),
      tlasColdVsLinearColdDistances: maxDistanceDelta(tlasCold.pairDistances, linearCold.pairDistances),
      // Both broad phases apply the IDENTICAL exact predicate to their surviving candidates, so this
      // count must agree between them regardless of how many candidates each one expanded.
      exactAabbSurvivorsAgree: tlasCold.statistics?.clearanceExactAabbSurvivors === linearCold.statistics?.clearanceExactAabbSurvivors,
      tlasColdExactAabbSurvivors: tlasCold.statistics?.clearanceExactAabbSurvivors,
      linearColdExactAabbSurvivors: linearCold.statistics?.clearanceExactAabbSurvivors,
      witnessShapeOk: {
        tlasCold: tlasCold.witnessShapeOk, tlasWarm: tlasWarm.witnessShapeOk,
        linearCold: linearCold.witnessShapeOk, linearWarm: linearWarm.witnessShapeOk,
      },
      note: 'Signature-set equality is checked over the full {sourceModelTag, sourceDbId, targetModelTag, targetDbId, clashType} tuple for every returned pair, not merely pairs.length; the reported per-pair distance is compared separately as a max absolute delta over the shared keys. As in run-gate-m2.mjs: this proves the two paths agree on the final dbId-AGGREGATED clearance result, NOT that they retested an identical underlying per-fragment candidate set (this script does not capture per-fragment candidate identity).',
    };
    const allSignatureSetsAgree = correctnessCrossCheck.tlasColdVsLinearColdPairSignaturesEqual
      && correctnessCrossCheck.tlasWarmVsLinearWarmPairSignaturesEqual
      && correctnessCrossCheck.tlasColdVsTlasWarmPairSignaturesEqual
      && correctnessCrossCheck.linearColdVsLinearWarmPairSignaturesEqual;

    // ---- Statistics inequality chain, asserted rather than merely printed ---------------------------
    // Clearance's own analogue of run-gate-m2.mjs's §7.5.2 chain, derived from the increment sites
    // read directly out of CollisionWorld.js (see the metric 1-3 comment above):
    //   TLAS:  tlasPrimitiveCandidatePairs >= broadPhasePairs == clearanceExpandedCandidatePairs
    //            >= clearanceExactAabbSurvivors == tlasExactRetestSurvivors
    //            == tlasNarrowPhaseInputPairs == narrowPhasePairs
    //   both:  narrowPhasePairs >= clearanceOverlapPrechecksRun
    //          narrowPhasePairs >= clearanceDistanceQueriesRun >= clearanceHits
    // Non-fatal (recorded, not thrown) -- a violation would itself be a real, reportable finding.
    function checkTlasChain(run) {
      const s = run.statistics;
      if (!s) return null;
      return {
        tlasPrimitiveCandidatePairs_gte_broadPhasePairs: s.tlasPrimitiveCandidatePairs >= s.broadPhasePairs,
        broadPhasePairs_eq_clearanceExpandedCandidatePairs: s.broadPhasePairs === s.clearanceExpandedCandidatePairs,
        clearanceExpandedCandidatePairs_gte_clearanceExactAabbSurvivors: s.clearanceExpandedCandidatePairs >= s.clearanceExactAabbSurvivors,
        clearanceExactAabbSurvivors_eq_tlasExactRetestSurvivors: s.clearanceExactAabbSurvivors === s.tlasExactRetestSurvivors,
        tlasExactRetestSurvivors_eq_tlasNarrowPhaseInputPairs: s.tlasExactRetestSurvivors === s.tlasNarrowPhaseInputPairs,
        tlasNarrowPhaseInputPairs_eq_narrowPhasePairs: s.tlasNarrowPhaseInputPairs === s.narrowPhasePairs,
      };
    }
    function checkSharedChain(run) {
      const s = run.statistics;
      if (!s) return null;
      return {
        broadPhasePairs_gte_clearanceExactAabbSurvivors: s.broadPhasePairs >= s.clearanceExactAabbSurvivors,
        clearanceExactAabbSurvivors_eq_narrowPhasePairs: s.clearanceExactAabbSurvivors === s.narrowPhasePairs,
        narrowPhasePairs_gte_clearanceOverlapPrechecksRun: s.narrowPhasePairs >= s.clearanceOverlapPrechecksRun,
        narrowPhasePairs_gte_clearanceDistanceQueriesRun: s.narrowPhasePairs >= s.clearanceDistanceQueriesRun,
        clearanceDistanceQueriesRun_gte_clearanceHits: s.clearanceDistanceQueriesRun >= s.clearanceHits,
        // The gate's own end-to-end instrumentation check: every distance query the library counted
        // must have emitted exactly one production span this recorder captured. A mismatch would
        // mean the span capture is lossy and criterion 6's population is not what it claims to be.
        distanceQueriesRun_eq_capturedSpanCount: s.clearanceDistanceQueriesRun === clearanceSpanMs(run).length,
        clearanceDistanceQueriesRun: s.clearanceDistanceQueriesRun,
        capturedSpanCount: clearanceSpanMs(run).length,
      };
    }
    const statisticsInequalityChain = {
      tlasCold: { tlasSpecific: checkTlasChain(tlasCold), shared: checkSharedChain(tlasCold) },
      tlasWarm: { tlasSpecific: checkTlasChain(tlasWarm), shared: checkSharedChain(tlasWarm) },
      linearCold: {
        tlasSpecific: null,
        shared: checkSharedChain(linearCold),
        linearPathNote: 'clearanceExpandedCandidatePairs and every tlas* field read 0 on a linear run BY CONSTRUCTION (only _runClearanceTlasBroadPhase increments them, CollisionWorld.js:2029-2078) -- not a measurement failure, and deliberately not checked here.',
      },
      linearWarm: { tlasSpecific: null, shared: checkSharedChain(linearWarm) },
    };

    // ---- codex-review finding #1 (High): correctness-check failures must INVALIDATE the run -------
    //
    // Every boolean gathered here was already computed above, but until this block existed not one of
    // them could change `report.disposition` or the process exit code -- ONLY a thrown query error
    // could. That left a real false-pass path: a TLAS regression that omits a clash while the linear
    // path stays correct sets `tlasColdVsLinearColdPairSignaturesEqual: false`, yet the report still
    // read 'MEASURED', wrote a normal result file, and exited 0. For a script whose entire purpose is
    // this TLAS-vs-linear correctness comparison, that directly contradicts this milestone's own
    // constraint that no task silently converts a failure into a passing result. Now wired into the
    // disposition exactly the way `erroredRuns` already was.
    //
    // DELIBERATELY EXCLUDED: the criterion-6 GO/CAUTION/NO-GO verdict. That is a PERFORMANCE finding
    // the spec explicitly says this script reports rather than gates on -- a genuine NO-GO must never
    // fail the process or turn the disposition non-MEASURED. Only correctness invariants do that.
    const validationFailures = [];
    const requireTrue = (name, value) => {
      if (value !== true) validationFailures.push({ check: name, observed: value });
    };
    requireTrue('correctness.allSignatureSetsAgree', allSignatureSetsAgree);
    requireTrue('correctness.exactAabbSurvivorsAgree', correctnessCrossCheck.exactAabbSurvivorsAgree);
    for (const [runName, ok] of Object.entries(correctnessCrossCheck.witnessShapeOk)) {
      requireTrue(`correctness.witnessShapeOk.${runName}`, ok);
    }
    // Cross-path distance agreement, checked on BOTH halves: full key coverage (every pair the run
    // returned was actually compared, so a shrunken key set cannot pass by comparing nothing) and
    // value agreement within tolerance. Both observed runs produced 30/30 keys at delta exactly 0.
    const distanceCheck = correctnessCrossCheck.tlasColdVsLinearColdDistances;
    requireTrue('correctness.distanceKeyCoverage',
      distanceCheck !== null && distanceCheck.comparedKeys === tlasCold.pairCount);
    requireTrue('correctness.distanceValuesAgree',
      distanceCheck !== null && distanceCheck.maxAbsoluteDelta <= MAX_CROSS_PATH_DISTANCE_DELTA);
    // Every boolean in the statistics inequality chain -- both groups, all four run states. The
    // `typeof value !== 'boolean'` guard skips the numeric context fields those objects also carry
    // (clearanceDistanceQueriesRun/capturedSpanCount), and the object guard skips `tlasSpecific: null`
    // on the linear runs and the `linearPathNote` string. This is what makes the load-bearing
    // `distanceQueriesRun_eq_capturedSpanCount` check (proving span capture is not lossy) actually
    // enforce something rather than merely being printed.
    for (const [runName, groups] of Object.entries(statisticsInequalityChain)) {
      for (const [groupName, group] of Object.entries(groups)) {
        if (!group || typeof group !== 'object') continue;
        for (const [checkName, value] of Object.entries(group)) {
          if (typeof value !== 'boolean') continue;
          requireTrue(`statisticsInequalityChain.${runName}.${groupName}.${checkName}`, value);
        }
      }
    }
    if (validationFailures.length > 0) {
      disposition.validationFailureCaveat = `${validationFailures.length} correctness invariant(s) were violated on this run (see report.validationFailures) -- the span population this verdict is drawn from may not describe a correct execution, so treat the verdict as provisional regardless of which way it landed.`;
    }

    // ---- Capacity headroom: real evidence for the provisional maxClearanceNarrowPhasePairs ---------
    // Reported as evidence ONLY. This task measures; it does not revise the constant.
    const narrowPhaseBudgetHeadroom = {
      maxClearanceNarrowPhasePairs,
      observedNarrowPhasePairsTlasCold: tlasCold.statistics?.narrowPhasePairs,
      observedNarrowPhasePairsLinearCold: linearCold.statistics?.narrowPhasePairs,
      fractionOfBudgetUsed: ratio(tlasCold.statistics?.narrowPhasePairs, maxClearanceNarrowPhasePairs),
      note: 'Evidence for the provisional constant, not a proposed revision -- this gate reports, it does not retune shipped defaults. Measured from ONE source instance (sourceFragmentCount=1); a multi-instance Soft Clash selection scales this count roughly with source-instance count, so the headroom shown here is not the headroom a large selection would see.',
    };

    // ---- The computed gate answer ------------------------------------------------------------------
    const broadPhaseShareOfWallClockCold = {
      tlas: ratio(tlasCold.statistics?.broadPhaseMs, tlasCold.wallMs),
      linear: ratio(linearCold.statistics?.broadPhaseMs, linearCold.wallMs),
    };
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
      question: 'M3 spec §17: on a realistic federated case, what does clearance mode actually cost -- (a) TLAS vs linear clearance broad-phase candidate volume, and (b) the duration of a single clearanceQuery call against frameBudgetMs?',
      singleCallSpanDispositionSummary: disposition.verdict,
      dimensions: {
        clearanceCandidateReduction: {
          description: 'broadPhasePairs on each path -- the mode-agnostic field both clearance broad phases increment at the same point (linear: CollisionWorld.js:1966; TLAS: :2057), and therefore the directly comparable clearance candidate-search cost between them.',
          tlasBroadPhasePairs: tlasCold.statistics?.broadPhasePairs,
          linearBroadPhasePairs: linearCold.statistics?.broadPhasePairs,
          reductionRatio: candidateReductionRatio,
          verdict: candidateReductionVerdict,
          lowerBoundNote: 'Measured with exactly ONE source instance (sourceFragmentCount=1). Linear cost scales as sourceCount x targetCount; TLAS traversal cost does not scale the same way (each source instance queries the SAME already-built target TLAS). This ratio is therefore a LOWER BOUND on the reduction a multi-instance Soft Clash selection would see -- stated as a bound, never extrapolated to a specific larger number.',
        },
        rawTlasPrimitiveExpansion: {
          description: 'Upstream of the target-scope/self-exclusion filters -- the raw per-primitive expansion the TLAS traversal itself incurs before filtering. Reported separately so the filtered ratio above is not misread as total search-cost reduction: TLAS pays real cost at this earlier, unfiltered stage too.',
          tlasLeafRangeEmissions: tlasCold.statistics?.tlasLeafRangeEmissions,
          tlasPrimitiveCandidatePairs: tlasCold.statistics?.tlasPrimitiveCandidatePairs,
          linearBroadPhasePairsForComparison: linearCold.statistics?.broadPhasePairs,
          rawExpansionReductionRatio,
        },
        broadPhaseElapsedBenefitWarm: {
          description: 'Warm-vs-warm broadPhaseMs -- the fairest amortized comparison, since TLAS build cost is a one-time cost a single cold query never amortizes.',
          tlasWarmBroadPhaseMs: tlasWarm.statistics?.broadPhaseMs,
          linearWarmBroadPhaseMs: linearWarm.statistics?.broadPhaseMs,
          verdict: broadPhaseWarmBenefit,
        },
        endToEndElapsedBenefit: {
          description: 'Read broadPhaseShareOfWallClockCold before interpreting these: broad phase is the only part the two paths differ in, and on this fixture clearance narrow phase (Hard-Clash precheck + closestPointToGeometry) dominates total time -- so an end-to-end NOT_OBSERVED here mostly reflects narrow-phase noise, not a broad-phase regression.',
          cold: { tlasColdWallMs: tlasCold.wallMs, linearColdWallMs: linearCold.wallMs, verdict: endToEndColdBenefit },
          warm: { tlasWarmWallMs: tlasWarm.wallMs, linearWarmWallMs: linearWarm.wallMs, verdict: endToEndWarmBenefit },
          broadPhaseShareOfWallClockCold,
        },
      },
      timingConfidenceCaveat: 'Wall-clock figures are descriptive, single-session measurements from one Playwright page, one sample per state. A sacrificial warm-up (Step 3: one unmeasured clearance TLAS query + one unmeasured clearance linear query, in throwaway worlds disposed before any measured world existed) removes the largest, cheapest-to-fix confound -- first-ever-call V8 JIT/module-initialization bias -- but residual order/GC/OS-scheduling noise from a single sample each cannot be ruled out. Candidate-count comparisons are structural and order-independent and are the more reliable evidence; the per-call span distribution is a population of thousands of samples, so its percentiles are far better supported than any single wall-clock number here.',
    };

    // ---- Assemble the full report ----
    const anyErrors = erroredRuns.length > 0;
    const anyValidationFailures = validationFailures.length > 0;
    const report = {
      // Three distinct, explicit states -- a correctness violation is reported as its own failure
      // mode rather than being folded into the errored-run one, since the two need different
      // follow-up (a thrown query vs. a genuine result/statistics divergence). Neither ever reads
      // 'MEASURED'.
      disposition: anyErrors ? 'FAILED' : anyValidationFailures ? 'FAILED_VALIDATION' : 'MEASURED',
      format,
      erroredRuns: anyErrors ? erroredRuns : undefined,
      validationFailures: anyValidationFailures ? validationFailures : undefined,
      environment: {
        browserVersion,
        os: `${os.platform()} ${os.release()} (${os.arch()})`,
        urns: { arch: ARCH_URN, structure: STRUCTURE_URN, mechanical: MECHANICAL_URN },
        sourceModel: 'structure',
        sourceDbId: SOURCE_DB_ID,
        clearance: CLEARANCE,
        clearanceNote: 'CLEARANCE is the real production default (DEFAULT_CLEARANCE = 0.05, wwwroot/extensions/ClashFinderExtension.js:60), in this model\'s own units -- not a value chosen to make any verdict come out a particular way.',
        fixtureNote: 'The same real 3-discipline federated Revit host+links package run-gate-m2.mjs uses (Architecture/Structure/Mechanical, each independently translated, sharing one real coordinate system) -- NOT a same-URN-twice substitution. Architecture loaded first (normally), Structure and Mechanical loaded as-additional via #keep-current-models. Federated target scope: viewer.getAllModels().map(m => ({model: m})) -- ALL three currently loaded models.',
        identity,
        consoleWarnings,
      },
      modelProfile: {
        archFragmentTotal: identity.archFragmentTotal,
        structureFragmentTotal: identity.structureFragmentTotal,
        mechanicalFragmentTotal: identity.mechanicalFragmentTotal,
        totalFragments,
      },
      blasInstrumentationNote: 'blasBuilt and blasCacheHits are hardcoded to 0 in every Statistics object this library produces (a pre-existing M1-era limitation, unrelated to clearance) -- they do NOT mean no BLAS work happened. The cold runs\' large narrowPhaseMs values include real, uninstrumented BLAS-build cost for every geometry touched on first access.',
      tlasCold: { wallMs: tlasCold.wallMs, error: tlasCold.error, pairCount: tlasCold.pairCount, sameModelPairCount: tlasCold.sameModelPairCount, crossModelPairCount: tlasCold.crossModelPairCount, statistics: tlasCold.statistics && { ...tlasCold.statistics, diagnostics: summarizeDiagnostics(tlasCold.statistics.diagnostics) }, longestSpan: tlasCold.longestSpan, spansByLabel: tlasColdSpanSummary.byLabel, topSpans: tlasColdSpanSummary.top },
      tlasWarm: { wallMs: tlasWarm.wallMs, error: tlasWarm.error, pairCount: tlasWarm.pairCount, sameModelPairCount: tlasWarm.sameModelPairCount, crossModelPairCount: tlasWarm.crossModelPairCount, statistics: tlasWarm.statistics && { ...tlasWarm.statistics, diagnostics: summarizeDiagnostics(tlasWarm.statistics.diagnostics) }, longestSpan: tlasWarm.longestSpan, spansByLabel: tlasWarmSpanSummary.byLabel, topSpans: tlasWarmSpanSummary.top },
      linearCold: { wallMs: linearCold.wallMs, error: linearCold.error, pairCount: linearCold.pairCount, sameModelPairCount: linearCold.sameModelPairCount, crossModelPairCount: linearCold.crossModelPairCount, statistics: linearCold.statistics && { ...linearCold.statistics, diagnostics: summarizeDiagnostics(linearCold.statistics.diagnostics) }, longestSpan: linearCold.longestSpan, spansByLabel: linearColdSpanSummary.byLabel, topSpans: linearColdSpanSummary.top },
      linearWarm: { wallMs: linearWarm.wallMs, error: linearWarm.error, pairCount: linearWarm.pairCount, sameModelPairCount: linearWarm.sameModelPairCount, crossModelPairCount: linearWarm.crossModelPairCount, statistics: linearWarm.statistics && { ...linearWarm.statistics, diagnostics: summarizeDiagnostics(linearWarm.statistics.diagnostics) }, longestSpan: linearWarm.longestSpan, spansByLabel: linearWarmSpanSummary.byLabel, topSpans: linearWarmSpanSummary.top },
      metrics: {
        // 1 + 2
        m1_m2_candidateCountsAndReduction: {
          tlas: {
            broadPhasePairs: tlasCold.statistics?.broadPhasePairs,
            clearanceExpandedCandidatePairs: tlasCold.statistics?.clearanceExpandedCandidatePairs,
            clearanceExactAabbSurvivors: tlasCold.statistics?.clearanceExactAabbSurvivors,
            tlasLeafRangeEmissions: tlasCold.statistics?.tlasLeafRangeEmissions,
            tlasPrimitiveCandidatePairs: tlasCold.statistics?.tlasPrimitiveCandidatePairs,
            tlasExactRetestSurvivors: tlasCold.statistics?.tlasExactRetestSurvivors,
            tlasNarrowPhaseInputPairs: tlasCold.statistics?.tlasNarrowPhaseInputPairs,
          },
          linear: {
            broadPhasePairs: linearCold.statistics?.broadPhasePairs,
            clearanceExpandedCandidatePairs: linearCold.statistics?.clearanceExpandedCandidatePairs,
            clearanceExactAabbSurvivors: linearCold.statistics?.clearanceExactAabbSurvivors,
            narrowPhasePairs: linearCold.statistics?.narrowPhasePairs,
          },
          candidateReductionRatio,
          candidateReductionRatioPlainly: candidateReductionRatio === null
            ? 'NOT MEASURABLE -- one or both broadPhasePairs values missing'
            : `TLAS examined ${tlasCold.statistics?.broadPhasePairs} clearance candidates where linear examined ${linearCold.statistics?.broadPhasePairs} -- a ${candidateReductionRatio.toFixed(2)}x reduction (TLAS looked at ${(100 / candidateReductionRatio).toFixed(1)}% as many candidates as linear).`,
          rawExpansionReductionRatio,
          verdict: candidateReductionVerdict,
        },
        // 3
        m3_precheckVsDistanceQuerySplit: {
          tlasCold: prechecksVsDistanceQueries(tlasCold),
          tlasWarm: prechecksVsDistanceQueries(tlasWarm),
          linearCold: prechecksVsDistanceQueries(linearCold),
          linearWarm: prechecksVsDistanceQueries(linearWarm),
          note: 'clearanceOverlapPrechecksRun counts candidates whose AABBs touched (aabbMinDistance == 0), for which the Hard-Clash exclusion precheck actually ran volumeOverlapQuery; a candidate with disjoint-but-near AABBs returns \'skip-precheck\' and is never counted. clearanceDistanceQueriesRun counts the actual clearanceQuery() calls -- one per captured production span.',
        },
        // 4
        m4_clearanceQueryMsOverTotalMs: {
          tlasCold: clearanceQueryShare(tlasCold),
          tlasWarm: clearanceQueryShare(tlasWarm),
          linearCold: clearanceQueryShare(linearCold),
          linearWarm: clearanceQueryShare(linearWarm),
        },
        // 5
        m5_coldWarmWallClockBothBroadPhases: {
          tlasColdWallMs: tlasCold.wallMs,
          tlasWarmWallMs: tlasWarm.wallMs,
          linearColdWallMs: linearCold.wallMs,
          linearWarmWallMs: linearWarm.wallMs,
          tlasColdTotalMs: tlasCold.statistics?.totalMs,
          tlasWarmTotalMs: tlasWarm.statistics?.totalMs,
          linearColdTotalMs: linearCold.statistics?.totalMs,
          linearWarmTotalMs: linearWarm.statistics?.totalMs,
          broadPhaseMs: {
            tlasCold: tlasCold.statistics?.broadPhaseMs, tlasWarm: tlasWarm.statistics?.broadPhaseMs,
            linearCold: linearCold.statistics?.broadPhaseMs, linearWarm: linearWarm.statistics?.broadPhaseMs,
          },
          narrowPhaseMs: {
            tlasCold: tlasCold.statistics?.narrowPhaseMs, tlasWarm: tlasWarm.statistics?.narrowPhaseMs,
            linearCold: linearCold.statistics?.narrowPhaseMs, linearWarm: linearWarm.statistics?.narrowPhaseMs,
          },
          tlasBuildMs: { cold: tlasCold.statistics?.tlasBuildMs, warm: tlasWarm.statistics?.tlasBuildMs },
          tlasQueryMs: { cold: tlasCold.statistics?.tlasQueryMs, warm: tlasWarm.statistics?.tlasQueryMs },
        },
        // 6
        m6_worstSingleClearanceQuerySpan: {
          spanLabel: CLEARANCE_SPAN_LABEL,
          totalSpansCaptured: clearanceQuerySpans.length,
          perRunSpanCounts: {
            tlasCold: clearanceSpansByRun.tlasCold.length, tlasWarm: clearanceSpansByRun.tlasWarm.length,
            linearCold: clearanceSpansByRun.linearCold.length, linearWarm: clearanceSpansByRun.linearWarm.length,
          },
          unionDistribution: disposition.distribution,
          perRunDistribution: disposition.perRunDistribution,
        },
        // 7
        m7_allSevenClearanceStatisticsFields: {
          tlasCold: clearanceStatisticsFields(tlasCold),
          tlasWarm: clearanceStatisticsFields(tlasWarm),
          linearCold: clearanceStatisticsFields(linearCold),
          linearWarm: clearanceStatisticsFields(linearWarm),
          note: 'clearanceExpandedCandidatePairs is a TLAS-path-only counter (CollisionWorld.js:2058) and reads 0 on a linear run by construction -- reported here as measured, not silently omitted.',
        },
      },
      singleCallSpanDisposition: disposition,
      correctnessCrossCheck: { ...correctnessCrossCheck, allSignatureSetsAgree },
      statisticsInequalityChain,
      narrowPhaseBudgetHeadroom,
      constants: { frameBudgetMs, maxClearanceNarrowPhasePairs, maxTlasCandidatePairs, maxCollisionInstancesPerEpoch },
      gateAnswer,
      // Design 2026-10-07 §8 T7: the clearance-private derived-geometry cache of each measured world,
      // sampled after every measured run (cumulative counters; peak = max retained over the samples).
      derivedGeometry: {
        tlasWorld: { afterCold: derivedTlasAfterCold, afterWarm: derivedTlasAfterWarm },
        linearWorld: { afterCold: derivedLinearAfterCold, afterWarm: derivedLinearAfterWarm },
      },
    };

    await writeFile(`${RESULTS_DIR}/m3-gate-${format}-${Date.now()}.json`, JSON.stringify(report, null, 2));
    console.log('\n=== Full M3 gate report (summarized spans/diagnostics) ===\n', JSON.stringify(report, null, 2));
    console.log(`\n=== Criterion 6 disposition: ${disposition.verdict} ===`);

    if (anyErrors) {
      console.error('\n=== GATE FAILED: one or more runs errored -- see erroredRuns above ===');
    }
    if (anyValidationFailures) {
      console.error(`\n=== GATE FAILED: ${validationFailures.length} correctness invariant(s) violated ===\n`,
        JSON.stringify(validationFailures, null, 2));
    }
    if (anyErrors || anyValidationFailures) {
      process.exitCode = 1;
    }
    return report;
  } finally {
    await browser.close();
  }
}

// Design 2026-10-07 §8 T7: the four SVF2 pass/fail criteria, computed from one SVF2 and one legacy-SVF
// protocol report of the same scene and queries.
function computeSvf2Criteria(svf2, svf) {
  const runNames = ['tlasCold', 'tlasWarm', 'linearCold', 'linearWarm'];
  const worlds = { tlasWorld: svf2.derivedGeometry.tlasWorld.afterWarm, linearWorld: svf2.derivedGeometry.linearWorld.afterWarm };
  const accounting = {};
  let aPass = true;
  for (const [name, sample] of Object.entries(worlds)) {
    const { builds, hits, sharedWaits } = sample.totals;
    const buildsWithinKeys = builds <= sample.distinctKeysTouched;
    const identityHolds = builds + hits + sharedWaits === sample.resolutions;
    const exercised = sample.resolutions > 0;
    accounting[name] = { builds, hits, sharedWaits, resolutions: sample.resolutions, distinctKeysTouched: sample.distinctKeysTouched, buildsWithinKeys, identityHolds, exercised };
    aPass = aPass && buildsWithinKeys && identityHolds && exercised;
  }
  const peakDerived = Math.max(
    svf2.derivedGeometry.tlasWorld.afterWarm.peakDerivedRetainedBytes ?? 0,
    svf2.derivedGeometry.linearWorld.afterWarm.peakDerivedRetainedBytes ?? 0,
  );
  const svfCanonical = Math.max(
    svf.derivedGeometry.tlasWorld.afterWarm.canonicalRetainedBytes,
    svf.derivedGeometry.linearWorld.afterWarm.canonicalRetainedBytes,
  );
  const bLimit = svfCanonical * 1.25;
  const wallRatios = {};
  let cPass = true;
  for (const run of runNames) {
    const r = ratio(svf2[run].wallMs, svf[run].wallMs);
    wallRatios[run] = { svf2WallMs: svf2[run].wallMs, svfWallMs: svf[run].wallMs, ratio: r };
    cPass = cPass && r !== null && r <= 2;
  }
  const dPass = svf.disposition === 'MEASURED' && typeof svf.singleCallSpanDisposition?.verdict === 'string'
    && svf.singleCallSpanDisposition.verdict.startsWith('GO');
  const criteria = {
    a_derivedBuildAccounting: { pass: aPass, perWorld: accounting },
    b_peakDerivedBytesVsSvfCanonical: { pass: peakDerived <= bLimit, peakDerivedRetainedBytes: peakDerived, svfCanonicalRetainedBytes: svfCanonical, limitBytes: bLimit, ratio: ratio(peakDerived, svfCanonical) },
    c_svf2WallTimeVsSvf: { pass: cPass, limitRatio: 2, provisional: true, perRun: wallRatios },
    d_legacySvfWithinExistingThresholds: { pass: dPass, svfDisposition: svf.disposition, svfCriterion6Verdict: svf.singleCallSpanDisposition?.verdict, svfWorstSpanMs: svf.singleCallSpanDisposition?.worstSpanMs },
  };
  const results = {
    svf2Pairs: { tlasCold: svf2.tlasCold.pairCount, linearCold: svf2.linearCold.pairCount },
    svfPairs: { tlasCold: svf.tlasCold.pairCount, linearCold: svf.linearCold.pairCount },
    svf2Diagnostics: svf2.tlasCold.statistics?.diagnostics?.byReason,
    svfDiagnostics: svf.tlasCold.statistics?.diagnostics?.byReason,
  };
  return { criteria, allPass: Object.values(criteria).every((c) => c.pass), results };
}

async function main() {
  const formats = (process.env.M3_GATE_FORMATS || 'svf2,svf').split(',').map((f) => f.trim()).filter(Boolean);
  for (const f of formats) {
    if (f !== 'svf2' && f !== 'svf') throw new Error(`M3_GATE_FORMATS: unknown format '${f}' (expected svf2 and/or svf)`);
  }
  const reports = {};
  for (const format of formats) reports[format] = await runProtocol(format);
  if (reports.svf2 && reports.svf) {
    const svf2Criteria = computeSvf2Criteria(reports.svf2, reports.svf);
    await writeFile(`${RESULTS_DIR}/m3-gate-svf2-criteria-${Date.now()}.json`, JSON.stringify(svf2Criteria, null, 2));
    console.log('\n=== SVF2 derived-geometry criteria (design 2026-10-07 §8 T7) ===\n', JSON.stringify(svf2Criteria, null, 2));
    console.log(`\n=== SVF2 criteria: ${svf2Criteria.allPass ? 'ALL PASS' : 'FAIL'} ===`);
    if (!svf2Criteria.allPass) process.exitCode = 1;
  } else {
    console.log('\n=== SVF2 criteria NOT COMPUTED -- needs both formats (M3_GATE_FORMATS=svf2,svf) ===');
  }
}

// Same guard as run-gate.mjs/run-gate-m2.mjs, for the same reason (Node's `node --test` default
// discovery sweeps in every .js/.mjs file under a directory literally named `test`).
const isMainModule = !process.env.NODE_TEST_CONTEXT
  && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
