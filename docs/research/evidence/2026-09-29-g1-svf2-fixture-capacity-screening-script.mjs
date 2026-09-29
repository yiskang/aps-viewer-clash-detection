// g1-svf2-fixture-capacity-screen.mjs -- SCREENING ONLY, NOT G1 EVIDENCE, NOT AN F1-F8 RUN.
//
// Owner-authorized bounded task (2026-09-29): screen EXISTING, already-translated bucket models
// for suitability as a future G1 SVF2 fixture. Read-only with respect to APS: no upload, no
// translation, no derivative creation, no deletion. Uses only the running app server's existing
// GET /api/auth/token (viewer token) plus the pinned Viewer 7.124.2 script.
//
// Reuse, not duplication: every in-page observation function is IMPORTED from the accepted
// harness (test/acceptance/g1-svf2-f1-f8-verification.mjs) and executed through the harness's
// own bootstrap registry (buildBootstrapScriptSource/buildRealPageDeps) on the harness's own
// BARE_PAGE_HTML (Initializer env 'AutodeskProduction2', api 'streamingV2', Viewer 7.124.2).
// Importing the harness never runs its main() (isDirectInvocation guard); this script never
// sets G1_F1_F8_LIVE_AUTHORIZED and never passes --execute-live-f1-f8.
//
// Per candidate (one attempt each, fresh browser): Phase-0-equivalent page bootstrap + module
// install -> Document.load -> loadDocumentNode(getDefaultGeometry(true)) -> isOTG/isSVF2 capture
// + harness readFormat classifier. Only if CONFIRMED_SVF2: wait (bounded) for model.isLoadDone(),
// Phase-2.5 setupSharedSessionResources, observeF1 (roots/population/per-dbId), observeF2
// (tree accounting, maxChildrenPerNode), observeF4 (getRenderProxy -> adaptViewerGeometry ->
// real compactAndWeld), then Node-side scoreF5 (the harness's existing five limitChecks).
// A screening-only in-page read of the F4-retained per-geometry snapshots identifies the
// geometry/dbId responsible for the max active-triangle count. NOT run: F3, F6, F7, F8, any
// control, runHarness, computeOverall.
//
// Usage: node g1-svf2-fixture-capacity-screen.mjs <out.json> <name=urn> [<name=urn> ...]

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import * as H from '/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/test/acceptance/g1-svf2-f1-f8-verification.mjs';

const {
  BARE_PAGE_HTML, BASE_URL, VIEWER_VERSION, VIEWER_SCRIPT_URL, EXPECTED_VIEWER_SHA256, REPO_ROOT,
  SERVED_MODULE_ENTRY_POINTS, handleClashtestRoute, buildBootstrapScriptSource, buildRealPageDeps,
  installG1Modules, startLoad, documentLoadStarter, loadDocumentNodeStarter, LOAD_API, TOKEN_STATE,
  captureModelFormatSignals, buildFormatSignalShim, readFormat, CLASSIFIER,
  setupSharedSessionResources, observeF1, observeF2, observeF4, scoreF5, describeError,
} = H;
// Resolve the repo's own pinned Playwright (this script may live outside the repo tree).
const { chromium } = createRequire(path.join(REPO_ROOT, 'package.json'))('playwright');

const LOAD_TIMEOUT_MS = 120_000;
const LOAD_DONE_TIMEOUT_MS = 180_000;
const MAX_SYNC_TRIANGLE_COUNT_LIMIT = 12_000; // reported for comparison only; scoreF5 uses collision/constants.js

const [outPath, ...pairs] = process.argv.slice(2);
const candidates = pairs.map((p) => { const i = p.indexOf('='); return { name: p.slice(0, i), urn: p.slice(i + 1) }; });

const playwrightVersion = JSON.parse(await readFile(path.join(REPO_ROOT, 'node_modules/playwright/package.json'), 'utf8')).version;

// Screening-only in-page read of F4's retained artifacts: argmax geometry, its representative
// fragment/dbId, how many fragments instance it, and every geometry over the limit (bounded).
function screenTriangleDetail({ sessionId, limit }) {
  const g = window.__g1;
  const s = g && g.sessions && g.sessions[sessionId];
  if (!s || !s.artifacts || !s.artifacts.f4Geometry) return { ok: false, reason: 'f4-artifacts-missing' };
  const recs = s.artifacts.f1PopulationRecords;
  const fragGeom = s.artifacts.f4FragmentGeometryId;
  const instancesByGeom = new Map();
  for (const [fragId, gid] of fragGeom) {
    const owner = recs && recs.get(fragId) ? recs.get(fragId).ownerDbId : null;
    const e = instancesByGeom.get(gid) || { fragCount: 0, dbIds: new Set() };
    e.fragCount += 1; if (owner != null) e.dbIds.add(owner);
    instancesByGeom.set(gid, e);
  }
  const rows = [];
  for (const [gid, snap] of s.artifacts.f4Geometry) {
    const rep = snap.representativeFragId;
    const inst = instancesByGeom.get(gid) || { fragCount: 0, dbIds: new Set() };
    rows.push({
      geometryId: gid, activeTriangleCount: snap.activeTriangleCount, representativeFragId: rep,
      representativeDbId: recs && recs.get(rep) ? recs.get(rep).ownerDbId : null,
      instanceFragmentCount: inst.fragCount, instanceDbIds: [...inst.dbIds].sort((a, b) => a - b).slice(0, 10),
    });
  }
  rows.sort((a, b) => (b.activeTriangleCount - a.activeTriangleCount) || (a.geometryId - b.geometryId));
  let nodeName = null;
  try {
    const top = rows[0];
    if (top && top.representativeDbId != null) {
      const it = s.model.getInstanceTree && s.model.getInstanceTree();
      nodeName = it ? it.getNodeName(top.representativeDbId) : null;
    }
  } catch { nodeName = null; }
  const over = rows.filter((r) => r.activeTriangleCount > limit);
  const totalActiveTriangles = rows.reduce((a, r) => a + r.activeTriangleCount, 0);
  return {
    ok: true,
    snapshotGeometryCount: rows.length,
    top: rows[0] || null,
    topNodeName: nodeName,
    top5: rows.slice(0, 5),
    overLimitGeometryCount: over.length,
    overLimitFirst20: over.slice(0, 20),
    totalActiveTrianglesUniqueGeometry: totalActiveTriangles,
    fragListCount: s.model.getFragmentList().getCount(),
  };
}

function modelLoadState({ tokenId }) {
  const m = window.__g1 && window.__g1.models && window.__g1.models[tokenId];
  if (!m) return { present: false };
  let isLoadDone = null; let fragCount = null;
  try { isLoadDone = m.isLoadDone(); } catch { /* keep null */ }
  try { fragCount = m.getFragmentList().getCount(); } catch { /* keep null */ }
  return { present: true, isLoadDone, fragCount };
}

const REGISTRY = { ...H.IN_PAGE_FUNCTION_REGISTRY, screenTriangleDetail, modelLoadState };

const sanitize = (v) => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'string'
  ? x.replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]').replace(/access_token["=:]+\s*"?[A-Za-z0-9\-._~+/]+/gi, 'access_token=[REDACTED]')
  : x)));

async function screenOne(c) {
  const rec = { candidate: c.name, urn: c.urn, startedAt: new Date().toISOString(), finishedAt: null, stage: 'launch',
    chromium: null, viewerScript: { status: null, sha256: null, matchesExpected: null },
    load: null, formatSignals: null, classifier: null, loadDone: null, phase25: null,
    f1: null, f2: null, f4: null, f5: null, triangleDetail: null, pageErrors: [], error: null };
  let browser = null;
  try {
    browser = await chromium.launch();
    rec.chromium = browser.version();
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', (e) => { if (rec.pageErrors.length < 20) rec.pageErrors.push(String(e && e.message || e).slice(0, 500)); });
    page.on('response', async (resp) => {
      if (resp.url() !== VIEWER_SCRIPT_URL) return;
      rec.viewerScript.status = resp.status();
      try { const body = await resp.body(); rec.viewerScript.sha256 = createHash('sha256').update(body).digest('hex'); rec.viewerScript.matchesExpected = rec.viewerScript.sha256 === EXPECTED_VIEWER_SHA256; } catch { /* body unavailable */ }
    });
    // Same routes as the harness's Phase 0 (clashtest via handleClashtestRoute; clashpanel mirrored inline).
    await context.route('**/clashtest/**', (route) => handleClashtestRoute(route, { baseUrl: BASE_URL }));
    const clashpanelDir = path.join(REPO_ROOT, 'clashpanel');
    await context.route('**/clashpanel/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(BASE_URL).origin) return route.continue();
      const abs = path.resolve(clashpanelDir, decodeURIComponent(url.pathname).replace(/^\/clashpanel\//, ''));
      if (!abs.startsWith(clashpanelDir + path.sep) || !abs.endsWith('.js')) return route.fulfill({ status: 404, body: 'nope' });
      return route.fulfill({ path: abs, contentType: 'text/javascript' });
    });
    await page.route(`${BASE_URL}/__g1-screen__`, (route) => route.fulfill({ contentType: 'text/html', body: BARE_PAGE_HTML }));
    await page.addInitScript({ content: buildBootstrapScriptSource(REGISTRY) });
    const { pageEvaluate } = buildRealPageDeps(page, REGISTRY);

    rec.stage = 'bootstrap';
    await page.goto(`${BASE_URL}/__g1-screen__`, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForFunction(() => window.__g1Bootstrap && window.__g1Bootstrap.ready === true, null, { timeout: 60_000 });
    const mi = await pageEvaluate(installG1Modules, SERVED_MODULE_ENTRY_POINTS);
    const failed = Object.entries(mi || {}).filter(([, r]) => !r || r.ok !== true).map(([s]) => s);
    if (failed.length) throw new Error(`module install failed: ${failed.join(', ')}`);

    rec.stage = 'load';
    const docLoad = await startLoad({ pageEvaluate, starter: documentLoadStarter, api: LOAD_API.DOCUMENT_LOAD, urn: c.urn, loadTimeoutMs: LOAD_TIMEOUT_MS });
    rec.load = { documentLoad: { state: docLoad.token.state, status: docLoad.snapshot && docLoad.snapshot.status, error: docLoad.snapshot && docLoad.snapshot.error || null } };
    if (docLoad.token.state !== TOKEN_STATE.COMPLETED) { rec.stage = 'load-failed'; return rec; }
    const ldn = await startLoad({ pageEvaluate, starter: loadDocumentNodeStarter, api: LOAD_API.LOAD_DOCUMENT_NODE, docTokenId: docLoad.token.id, loadTimeoutMs: LOAD_TIMEOUT_MS });
    rec.load.loadDocumentNode = { state: ldn.token.state, status: ldn.snapshot && ldn.snapshot.status, error: ldn.snapshot && ldn.snapshot.error || null };
    if (ldn.token.state !== TOKEN_STATE.COMPLETED) { rec.stage = 'load-failed'; return rec; }

    rec.stage = 'classifier';
    const sig = await pageEvaluate(captureModelFormatSignals, { tokenId: ldn.token.id, gen: ldn.gen });
    rec.formatSignals = sig;
    if (!sig || sig.ok !== true || sig.isOTG === null || sig.isSVF2 === null) { rec.stage = 'classifier-capture-failed'; return rec; }
    rec.classifier = readFormat(buildFormatSignalShim(sig));
    if (rec.classifier.classifier !== CLASSIFIER.CONFIRMED_SVF2) { rec.stage = 'classifier-stop'; return rec; }

    rec.stage = 'wait-load-done';
    const t0 = Date.now();
    try {
      await page.waitForFunction((tid) => { const m = window.__g1.models[tid]; try { return m && m.isLoadDone() === true; } catch { return false; } }, ldn.token.id, { timeout: LOAD_DONE_TIMEOUT_MS, polling: 500 });
      rec.loadDone = { reached: true, waitedMs: Date.now() - t0, ...(await pageEvaluate(modelLoadState, { tokenId: ldn.token.id })) };
    } catch (e) {
      rec.loadDone = { reached: false, waitedMs: Date.now() - t0, error: describeError(e), ...(await pageEvaluate(modelLoadState, { tokenId: ldn.token.id })) };
    }

    rec.stage = 'phase2.5';
    rec.phase25 = await pageEvaluate(setupSharedSessionResources, ldn.token.id);
    if (!rec.phase25 || rec.phase25.ok !== true) { rec.stage = 'phase2.5-failed'; return rec; }
    const sessionId = rec.phase25.sessionId;

    rec.stage = 'F1';
    const f1 = await pageEvaluate(observeF1, sessionId);
    rec.f1 = f1 && f1.ok ? { ok: true, fields: f1.fields, populationDigestState: f1.populationDigestEvidence && f1.populationDigestEvidence.state, first3Mismatches: (f1.first20Mismatches || []).slice(0, 3) } : f1;
    rec.stage = 'F2';
    const f2 = f1 && f1.ok ? await pageEvaluate(observeF2, sessionId) : null;
    rec.f2 = f2;
    rec.stage = 'F4';
    const f4 = f1 && f1.ok ? await pageEvaluate(observeF4, sessionId) : null;
    rec.f4 = f4 && f4.ok ? { ok: true, fields: f4.fields, failureBreakdown: f4.failureBreakdown, oversizedGeometryIds: f4.oversizedGeometryIds,
      first5WeldConsumerFailures: (f4.first20WeldConsumerFailures || []).slice(0, 5), first5GeometryAdapterFailures: (f4.first20GeometryAdapterFailures || []).slice(0, 5),
      first5RenderProxyFailures: (f4.first20RenderProxyFailures || []).slice(0, 5) } : f4;
    rec.stage = 'F5-score';
    rec.f5 = scoreF5({ f1Result: f1, f2Fields: f2 && f2.ok ? f2.fields : null, f4Fields: f4 && f4.ok ? f4.fields : null });
    rec.stage = 'triangle-detail';
    if (f4 && f4.ok) rec.triangleDetail = await pageEvaluate(screenTriangleDetail, { sessionId, limit: MAX_SYNC_TRIANGLE_COUNT_LIMIT });
    rec.stage = 'done';
    return rec;
  } catch (e) {
    rec.error = describeError(e);
    return rec;
  } finally {
    rec.finishedAt = new Date().toISOString();
    if (browser) { try { await browser.close(); } catch { /* best effort */ } }
  }
}

const result = {
  kind: 'g1-svf2-fixture-capacity-screening', note: 'SCREENING ONLY -- not G1 evidence; no F1-F8 run; no upload/translation.',
  runtimeEnvelope: { node: process.version, playwright: playwrightVersion, chromium: null, viewerVersion: VIEWER_VERSION,
    initializer: { env: 'AutodeskProduction2', api: 'streamingV2' }, loadCall: 'Document.load -> viewer.loadDocumentNode(doc, doc.getRoot().getDefaultGeometry(true), {})',
    expectedViewerSha256: EXPECTED_VIEWER_SHA256 },
  startedAt: new Date().toISOString(), finishedAt: null, candidates: [],
};
for (const c of candidates) {
  console.log(`[screen] ${c.name} ...`);
  const r = await screenOne(c);
  result.runtimeEnvelope.chromium = result.runtimeEnvelope.chromium || r.chromium;
  result.candidates.push(sanitize(r));
  const t = r.triangleDetail && r.triangleDetail.top;
  console.log(`[screen] ${c.name}: stage=${r.stage} cls=${r.classifier && r.classifier.classifier} f5=${r.f5 && r.f5.verdict}/${r.f5 && r.f5.reason} maxTri=${r.f4 && r.f4.fields && r.f4.fields.maxActiveTriangleCount} topGeom=${t && t.geometryId} topDbId=${t && t.representativeDbId} err=${r.error && r.error.message}`);
  result.finishedAt = new Date().toISOString();
  await writeFile(outPath, JSON.stringify(result, null, 2));
}
console.log('[screen] done');
