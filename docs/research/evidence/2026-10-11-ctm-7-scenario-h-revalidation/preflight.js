/* CTM-7 Scenario H fail-closed PREFLIGHT (evidence layer; read-only; no mutation). Paste AFTER capture-helper.js.
 * window.__ctmPreflight(expect) -> Promise<{pass, checks:[{id,ok,detail}], capture}>.
 * expect = { modelCount, testNames:[...], expectedNameByModelId:{1:'..',...}, viewerVersion }.
 * Every check is required; a missing/null/zero carrier FAILS (never accepted vacuously). Fields the oracle does not use
 * are listed in UNUSED_EXCLUDED and are explicitly not asserted. */
(() => {
  'use strict';
  const UNUSED_EXCLUDED = ['viewer.overlays (all non-panel scenes)', 'viewer.selection', 'editor.groupBy', 'editor.firstRowTestId',
    'editor.counts.filtered', 'manager.liveManager/liveEditor text (recorded, not asserted)', 'manager.activeElementBanner'];
  window.__ctmPreflight = async (expect) => {
    const checks = []; const add = (id, ok, detail) => checks.push({ id, ok: !!ok, detail: detail === undefined ? null : detail });
    const V = window.NOP_VIEWER;
    const cap = await window.__ctmCapture('PREFLIGHT-H0', { minWaitMs: 1500 });
    const m = cap.manager, e = cap.editor, v = cap.viewer, cat = cap.catalog;
    const vjs = [...document.scripts].map((x) => x.src).find((x) => /\/viewers\/[^/]+\/viewer3D\.js/.test(x)) || ''; const ver = (vjs.match(/\/viewers\/([^/]+)\/viewer3D\.js/) || [])[1] || null;
    add('3.runtime-identity', !!V && ver === expect.viewerVersion && /Chrome\/155\./.test(navigator.userAgent), { viewer: ver, viewerScript: vjs, ua: navigator.userAgent });
    add('4a.carrier.viewer', !!V && v && Array.isArray(v.models) && v.models.length === expect.modelCount, v && v.models);
    const host = (() => { try { return V.getExtension('Autodesk.Sandbox.ClashPanel')._host; } catch { return null; } })();
    add('4b.carrier.host-panel-controller', !!host && !!host.panel && !!host.panel.controller && typeof host.panel.controller.getViewModel === 'function');
    add('4c.carrier.manager', m && m.count === expect.testNames.length && m.items.length === expect.testNames.length && m.view === 'list', m && { view: m.view, count: m.count });
    add('4d.carrier.editor-vm', e && typeof e.testId === 'string' && e.testId.length > 0);
    add('4e.carrier.catalog', Array.isArray(cat) && cat.length === expect.modelCount && cat.every((c) => typeof c.modelKey === 'string' && c.modelKey && c.loaded === true), cat && cat.length);
    add('4f.counts.models-tests', cap.viewer.models.length === expect.modelCount && cap.viewer.visibleModels.length === expect.modelCount && m.count === expect.testNames.length);
    const names = m ? m.items.map((i) => i.name) : [];
    add('4g.test-names', JSON.stringify(names.slice().sort()) === JSON.stringify(expect.testNames.slice().sort()), names);
    add('4h.readiness-fields-nonnull', m && m.items.every((i) => typeof i.readiness === 'string' && i.readiness.length > 0 && typeof i.status === 'string' && i.status.length > 0 && typeof i.setA === 'string' && typeof i.setB === 'string')
      && typeof e.headline === 'string' && typeof e.canRun === 'boolean' && typeof e.validation === 'string' && typeof e.runState === 'string', m && m.items.map((i) => [i.name, i.readiness, i.status]));
    add('4i.setupModels-nonempty', e && e.setupModels.length === expect.modelCount && e.setupModels.every((s) => s.ready === true && s.registered === true));
    const catKeys = cat ? cat.map((c) => c.modelKey).sort() : [];
    const setupKeys = e ? e.setupModels.map((s) => s.modelKey).sort() : [];
    const viewerKeys = v ? v.modelKeysBySelf.map((s) => `${s.urn}#${s.id}`).sort() : [];
    add('4j.keys-match-catalog-editor-viewer', JSON.stringify(catKeys) === JSON.stringify(setupKeys) && JSON.stringify(catKeys) === JSON.stringify(viewerKeys), { catKeys, setupKeys, viewerKeys });
    add('4k.names-by-id', cat && v && v.models.every((id) => { const k = v.modelKeysBySelf.find((s) => s.id === id); const c = cat.find((x) => x.modelKey === `${k.urn}#${id}`); return c && c.displayName === expect.expectedNameByModelId[id]; }));
    // 5: every selector/private field the oracle uses is live-validated (non-null) ----------------------------------
    const root = document.querySelector('.clash-panel-root');
    const sel = ['.clash-manager-header', '.clash-manager-list', '.clash-manager-editor', 'li.clash-manager-item[data-test-id]', '.clash-manager-name', '.clash-manager-mode', '.clash-manager-status', '.clash-manager-set-value', '.clash-manager-readiness'];
    const found = {}; for (const s of sel) found[s] = !!root.querySelector(s);
    add('5a.selectors-live', Object.values(found).every(Boolean), found);
    add('5b.private-overlayScenes', !!V.impl && !!V.impl.overlayScenes && typeof V.impl.overlayScenes === 'object');
    add('5c.reason-rows-selector-optional-note', true, 'li .clash-manager-reason-row present only when a reason is shown; asserted by the oracle at hide/unload, not at H0');
    add('6.unused-fields-excluded', true, UNUSED_EXCLUDED);
    // 7: argument forms, verified WITHOUT calling them ----------------------------------------------------------------
    const P = Autodesk.Viewing.Viewer3D.prototype;
    const hs = String(P.hideModel), ss = String(P.showModel), us = String(P.unloadModel);
    add('7a.hideModel-form', typeof P.hideModel === 'function' && P.hideModel.length === 1 && /typeof model === 'number'/.test(hs) && /findModel/.test(hs), { length: P.hideModel.length });
    add('7b.showModel-form', typeof P.showModel === 'function' && P.showModel.length >= 1 && /typeof model === 'number'/.test(ss), { length: P.showModel.length });
    add('7c.unloadModel-form', typeof P.unloadModel === 'function' && P.unloadModel.length >= 1, { length: P.unloadModel.length, src: us.slice(0, 160) });
    add('7d.target-models-are-Model-objects', V.getAllModels().every((mm) => mm && typeof mm.id === 'number' && typeof mm.getData === 'function'));
    // 8: every accepted capture
    add('8.capture-quality', Array.isArray(cap.problems) && cap.problems.length === 0 && cap.settle && cap.settle.stable === true && cap.settle.timedOut === false, { problems: cap.problems, settle: cap.settle });
    return { pass: checks.every((c) => c.ok), checks, capture: cap };
  };
  /* Per-capture acceptance rule used for EVERY retained capture (item 8). */
  window.__ctmAccept = (cap) => Array.isArray(cap.problems) && cap.problems.length === 0 && cap.settle && cap.settle.stable === true && cap.settle.timedOut === false
    && cap.manager && cap.editor && cap.catalog && cap.viewer && (cap.manager.view !== 'list' || cap.manager.items.length > 0);
})();
