// test/acceptance/g1-svf2-initializer-diagnostic.mjs
//
// ============================================================================================
//  DIAGNOSTIC ONLY -- NOT AN ACCEPTANCE SCRIPT, NOT PART OF `npm test`, NOT A G1 F1-F8 RUN.
//
//  Authorization: docs/prompts/g1-svf2-nonproduction-diagnostic-harness-authorization.md
//  Purpose: answer exactly one question -- with an EXISTING model already available to this
//  repo/account, does a Viewer initialized with `env: 'AutodeskProduction2', api: 'streamingV2'`
//  (instead of the production app's `env: 'AutodeskProduction'`) load it as true SVF2/OTG
//  (`model.isOTG() === true`)? Nothing else. It does NOT run F1-F8, does NOT touch
//  wwwroot/viewer.js or any production file, does NOT upload or translate a model, and is not
//  wired into server.js, npm test, or any user-facing route.
//
//  This script serves its OWN bare diagnostic page via Playwright `page.route`, entirely
//  independent of wwwroot/index.html and wwwroot/viewer.js (which remain untouched and are never
//  loaded by this script). It reuses the running server ONLY for two already-existing, unchanged
//  read-only endpoints it needs as a client: GET /api/auth/token (mint a viewer token, same as
//  production) and the pinned Viewer script URL already used by production
//  (https://developer.api.autodesk.com/modelderivative/v2/viewers/7.124.2/viewer3D.js) -- the
//  SAME Viewer version, per the authorization's "use the existing pinned Viewer version" clause;
//  only the Initializer's `env`/`api` OPTIONS differ from production.
//
//  Running it (ONLY after the separate owner authorization this file cites):
//    npm start &                          # server on PORT (default 8080), owner's APS creds in .env
//    node test/acceptance/g1-svf2-initializer-diagnostic.mjs
//
//  Report: test/acceptance/results/g1-svf2-initializer-diagnostic-result.json (git-ignored dir,
//  same convention as the sibling acceptance scripts).
// ============================================================================================

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PORT = process.env.PORT || 8080;
const BASE_URL = `http://localhost:${PORT}`;
const VIEWER_VERSION = '7.124.2'; // identical to wwwroot/index.html's pinned version -- unchanged
const VIEWER_SCRIPT_URL = `https://developer.api.autodesk.com/modelderivative/v2/viewers/${VIEWER_VERSION}/viewer3D.js`;
const VIEWER_STYLE_URL = `https://developer.api.autodesk.com/modelderivative/v2/viewers/${VIEWER_VERSION}/style.css`;

// Existing model only -- no upload, no new translation. Selected from the prior G1 candidate set
// (docs/research/2026-09-27-viewer-clash-panel-g1-svf2-prerequisite-check.md §4): the Room Locator
// model, whose manifest advertises a single 3D derivative with outputType "svf2" (no separate
// legacy "svf" derivative alongside it), and which previously loaded successfully (isOTG: false)
// through the PRODUCTION initializer -- i.e. a real, already-translated, already-working fixture,
// picked specifically because its format status under the corrected initializer is exactly the
// open question this diagnostic answers.
const MODEL_LABEL = 'racbasicsampleproject.rvt (Room Locator model)';
const MODEL_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL3JhY2Jhc2ljc2FtcGxlcHJvamVjdC5ydnQ';
const PRIOR_LEGACY_RESULT = { isOTG: false, is3d: true }; // from the prior G1 preflight, production initializer

const RESULTS_DIR = path.join(process.cwd(), 'test/acceptance/results');
const REPORT_FILE = 'g1-svf2-initializer-diagnostic-result.json';

// The bare diagnostic page. Deliberately minimal: no app UI, no wwwroot/*.js import, its own
// Initializer call with the SVF2/OTG options under test. `getAccessToken` fetches the existing,
// unmodified GET /api/auth/token endpoint (a read-only token mint, same one production uses).
const DIAGNOSTIC_HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="${VIEWER_STYLE_URL}">
<style>html,body,#preview{margin:0;height:100%;width:100%}</style>
</head><body>
<div id="preview"></div>
<script src="${VIEWER_SCRIPT_URL}"></script>
<script>
async function getAccessToken(callback) {
  const resp = await fetch('/api/auth/token');
  if (!resp.ok) throw new Error(await resp.text());
  const { access_token, expires_in } = await resp.json();
  callback(access_token, expires_in);
}
window.__diag = { ready: false, error: null };
Autodesk.Viewing.Initializer(
  { env: 'AutodeskProduction2', api: 'streamingV2', getAccessToken },
  function () {
    const viewer = new Autodesk.Viewing.GuiViewer3D(document.getElementById('preview'), {});
    viewer.start();
    window.__viewer = viewer;
    window.__diag.ready = true;
  }
);
window.__loadModel = function (urn) {
  return new Promise((resolve, reject) => {
    Autodesk.Viewing.Document.load(
      'urn:' + urn,
      (doc) => resolve(window.__viewer.loadDocumentNode(doc, doc.getRoot().getDefaultGeometry(true), {})),
      (code, message, errors) => reject({ code, message, errors }),
    );
  });
};
</script>
</body></html>`;

async function main() {
  await mkdir(RESULTS_DIR, { recursive: true });
  const result = {
    script: 'g1-svf2-initializer-diagnostic.mjs',
    authorization: 'docs/prompts/g1-svf2-nonproduction-diagnostic-harness-authorization.md',
    startedAt: new Date().toISOString(),
    viewerVersion: VIEWER_VERSION,
    viewerScriptUrl: VIEWER_SCRIPT_URL,
    initializer: { env: 'AutodeskProduction2', api: 'streamingV2' },
    productionInitializerUnchanged: { env: 'AutodeskProduction', api: null },
    model: { label: MODEL_LABEL, urn: MODEL_URN, priorLegacyResult: PRIOR_LEGACY_RESULT },
    consoleErrors: [],
    pageErrors: [],
    loadOutcome: null,
    runtime: null,
    disposition: null,
  };

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote'] });
  const page = await browser.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') result.consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => result.pageErrors.push(String(err)));

  // Serve ONLY this diagnostic page at a synthetic path -- never wwwroot/index.html, never any
  // production route. Every other request (the Viewer script/style, the token endpoint) passes
  // through to its real destination unmodified.
  await page.route('**/__g1-diagnostic__', (route) => route.fulfill({ contentType: 'text/html', body: DIAGNOSTIC_HTML }));

  try {
    await page.goto(`${BASE_URL}/__g1-diagnostic__`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.__diag && window.__diag.ready === true, { timeout: 30000 });

    try {
      await page.evaluate((urn) => window.__loadModel(urn), MODEL_URN);
      await page.waitForFunction((expectedUrn) => {
        const v = window.__viewer;
        if (!v) return false;
        const models = v.getAllModels();
        return models.length > 0 && models[0].getData().urn === expectedUrn && models[0].isLoadDone && models[0].isLoadDone();
      }, MODEL_URN, { timeout: 90000 });
      result.loadOutcome = 'success';
    } catch (loadErr) {
      result.loadOutcome = 'failed';
      result.loadError = String(loadErr && loadErr.message || loadErr);
    }

    if (result.loadOutcome === 'success') {
      result.runtime = await page.evaluate(() => {
        const m = window.__viewer.getAllModels()[0];
        return {
          urn: m.getData().urn,
          isOTG: typeof m.isOTG === 'function' ? m.isOTG() : 'not-a-function',
          isSVF2: typeof m.isSVF2 === 'function' ? m.isSVF2() : 'not-a-function',
          is3d: typeof m.is3d === 'function' ? m.is3d() : 'not-a-function',
          loadOptions: m.getData().loadOptions ? Object.keys(m.getData().loadOptions) : null,
        };
      });
    }
  } catch (err) {
    result.harnessError = String(err && err.message || err);
  } finally {
    await page.close();
    await browser.close();
  }

  // Disposition (H1-H5), per the authorization's own definitions.
  if (result.harnessError) {
    result.disposition = 'H3 (harness/page-level failure before or independent of model load)';
  } else if (result.loadOutcome === 'failed') {
    result.disposition = 'H3 (initializer accepted, but model/document loading failed)';
  } else if (result.runtime) {
    const otgTrue = result.runtime.isOTG === true;
    const svf2True = result.runtime.isSVF2 === true;
    const svf2Unavailable = result.runtime.isSVF2 === 'not-a-function';
    if (otgTrue || svf2True) {
      result.disposition = 'H1 (initializer confirmed as the blocker -- model now loads with SVF2/OTG runtime evidence)';
    } else if (svf2Unavailable && result.runtime.isOTG === false) {
      result.disposition = 'H4 (insufficient runtime API evidence: isSVF2() not exposed by this Viewer version; isOTG() reports false)';
    } else {
      result.disposition = 'H2 (correct initializer still does not produce SVF2/OTG runtime evidence for this model)';
    }
  } else {
    result.disposition = 'H4 (model loaded but no runtime evidence collected -- unexpected script state)';
  }

  result.finishedAt = new Date().toISOString();
  await writeFile(path.join(RESULTS_DIR, REPORT_FILE), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}` && !process.env.NODE_TEST_CONTEXT) {
  main().catch((err) => {
    console.error('g1-svf2-initializer-diagnostic.mjs: fatal error', err);
    process.exitCode = 1;
  });
}

export { main };
