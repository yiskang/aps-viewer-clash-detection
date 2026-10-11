/* CTM-7 H revalidation capture helper (evidence support). READ-ONLY, self-contained, no app import.
 * Paste into the browser console / playwright evaluate AFTER the viewer exists. Defines:
 *   window.__ctmCapture(label)        -> Promise<snapshot>  (settles first, then reads; see PROTOCOL.md section 2)
 *   window.__ctmCapture.sync(label)   -> snapshot            (no settling; for ad-hoc reads)
 *   window.__ctmSnaps                 -> array of every snapshot taken (append-only convenience log)
 * Reads only: DOM text/attributes, editor ViewModel via getViewModel(), public Viewer getters, and the
 * Viewer-internal viewer.impl.overlayScenes (read only; see CAPTURE-SCHEMA.md "Internal reads").
 * Never dispatches, clicks, focuses, writes, or calls any mutating Viewer API. Schema: CAPTURE-SCHEMA.md. */
(() => {
  'use strict';
  const SCHEMA = 'ctm7-h-capture/1';
  const PANEL_SCENE_RE = /^clash-panel-(markers|outlines):/;
  const txt = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null);
  const safe = (fn, dflt = null) => { try { const v = fn(); return v === undefined ? dflt : v; } catch (e) { return dflt; } };
  const getViewer = () => {
    const g = window.NOP_VIEWER || window.viewer || null;
    if (g) return g;
    return null;
  };
  const getHost = (viewer) => safe(() => viewer.getExtension('Autodesk.Sandbox.ClashPanel')._host, null);
  const modelIds = (list) => (list || []).map((m) => m.id);

  function readManager(root) {
    if (!root) return null;
    const header = root.querySelector('.clash-manager-header');
    const list = root.querySelector('.clash-manager-list');
    const editorHost = root.querySelector('.clash-manager-editor');
    const confirmEl = header && header.querySelector('[data-banner-id="manager-confirm"]');
    const items = [...root.querySelectorAll('li.clash-manager-item')].map((li) => ({
      id: li.getAttribute('data-test-id'),
      active: li.getAttribute('aria-current') === 'true',
      name: txt(li.querySelector('.clash-manager-name')),
      mode: txt(li.querySelector('.clash-manager-mode')),
      status: txt(li.querySelector('.clash-manager-status')) || '',
      setA: txt(li.querySelectorAll('.clash-manager-set-value')[0]),
      setB: txt(li.querySelectorAll('.clash-manager-set-value')[1]),
      readiness: txt(li.querySelector('.clash-manager-readiness')),
      reasons: [...li.querySelectorAll('.clash-manager-reason-row')].map(txt),
      disabledActions: [...li.querySelectorAll('.clash-manager-actions button[disabled]')].map((b) => b.getAttribute('data-key')),
    }));
    return {
      view: list ? (list.hidden ? 'editor' : 'list') : null,
      headerActive: txt(header && header.querySelector('.clash-manager-active')),
      count: items.length,
      items,
      confirm: confirmEl ? { text: txt(confirmEl), op: header.getAttribute('data-confirm-op') } : null,
      confirmOp: header ? (header.getAttribute('data-confirm-op') || '') : null,
      notice: txt(header && header.querySelector('.clash-manager-notice')),
      fault: txt(header && header.querySelector('[data-banner-id="manager-fault"]')),
      liveManager: txt(header && header.querySelector(':scope > .clash-status')),
      liveEditor: txt(editorHost && editorHost.querySelector('.clash-status')),
      activeElementBanner: (document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-banner-id')) || null,
    };
  }

  function readEditor(vm, root) {
    if (!vm) return null;
    const setup = vm.setup || {}; const run = vm.run || {}; const results = vm.results || {};
    const t = vm.test || null;
    const firstRow = root && root.querySelector('.clash-manager-editor .clash-row[data-key]');
    return {
      testId: t ? t.testId : null,
      name: setup.name ?? null,
      mode: setup.mode ?? null,
      revision: t && t.draft ? t.draft.revision ?? null : null,
      setA: setup.scope ? setup.scope.A : null,
      setB: setup.scope ? setup.scope.B : null,
      runState: run.state ?? null,
      doneKind: run.doneKind ?? null,
      headline: run.headline ?? null,
      counts: run.counts ?? null,
      canRun: run.canRun === true,
      runActive: t ? t.runActive === true : null,
      heldUnsaved: t ? t.heldUnsaved === true : null,
      pendingConfirm: t ? t.pendingConfirm === true : null,
      lastRun: t ? t.lastRun ?? null : null,
      resultsState: results.state ?? null,
      resultsMsg: results.message ?? null,
      rows: Array.isArray(results.rows) ? results.rows.length : null,
      selected: vm.selected ? vm.selected.ordinal ?? null : null,
      validation: setup.validation ? setup.validation.state : null,
      validationMessages: setup.validation && Array.isArray(setup.validation.messages) ? setup.validation.messages.map((m) => m.text) : [],
      groupBy: results.groupBy ?? null,
      firstRowTestId: firstRow ? firstRow.getAttribute('data-key') : null,
      // F-1 fields: editor per-model readiness (catalog loaded flag + registry binding), straight from vm.setup.models
      setupModels: Array.isArray(setup.models) ? setup.models.map((m) => ({
        modelKey: m.modelKey, displayName: m.displayName, ready: m.ready === true, registered: m.registered === true,
        inA: m.inA === true, inB: m.inB === true, note: m.note ?? null,
      })) : [],
      validationState: setup.validation ? setup.validation.state : null,
    };
  }

  function readViewer(viewer) {
    if (!viewer) return null;
    const all = safe(() => viewer.getAllModels(), []) || [];
    const visible = safe(() => viewer.getVisibleModels(), []) || [];
    const perModel = (fn) => {
      const o = {};
      for (const m of all) o[m.id] = safe(() => (fn(m) || []).length, null);
      return o;
    };
    const scenes = safe(() => viewer.impl.overlayScenes, null);   // INTERNAL read-only (see schema)
    const overlays = {};
    if (scenes) for (const name of Object.keys(scenes)) overlays[name] = safe(() => scenes[name].scene.children.length, null);
    const panelScenes = Object.keys(overlays).filter((n) => PANEL_SCENE_RE.test(n)).sort();
    const panelChildren = panelScenes.map((n) => overlays[n]);
    const isolatedNodeCounts = perModel((m) => viewer.getIsolatedNodes(m));
    return {
      models: modelIds(all),
      visibleModels: modelIds(visible),
      modelKeysBySelf: all.map((m) => ({
        id: m.id, urn: safe(() => m.getData().urn, null), isLoadDone: safe(() => m.isLoadDone(), null),
        isOTG: safe(() => m.isOTG(), null), hasInstanceTree: safe(() => !!m.getInstanceTree(), null),
      })),
      isolatedNodeCounts,
      hiddenNodeCounts: perModel((m) => viewer.getHiddenNodes(m)),
      isolatedAny: Object.values(isolatedNodeCounts).some((n) => n > 0),
      selection: safe(() => viewer.getSelection().length, null),
      overlays,
      panelOverlayScenes: panelScenes,
      panelOverlayChildren: panelChildren,
    };
  }

  function sync(label) {
    const viewer = getViewer();
    const host = viewer ? getHost(viewer) : null;
    const root = document.querySelector('.clash-panel-root');
    const ctl = safe(() => host.panel.controller, null);
    const vm = ctl ? safe(() => ctl.getViewModel(), null) : null;
    const catalog = host ? safe(() => host.catalog.list().map((e) => ({
      modelKey: e.modelKey, displayName: e.displayName, loaded: e.loaded === true,
    })), null) : null;
    const snap = {
      schema: SCHEMA,
      label: String(label),
      at: new Date().toISOString(),
      scenario: 'H',
      href: location.href.split('#')[0] + (location.hash ? '#<hash>' : ''),
      manager: readManager(root),
      editor: readEditor(vm, root),
      catalog,
      viewer: readViewer(viewer),
      problems: [!viewer && 'no-viewer', viewer && !host && 'no-host', !root && 'no-panel-root', host && !vm && 'no-editor-vm'].filter(Boolean),
    };
    (window.__ctmSnaps = window.__ctmSnaps || []).push(snap);
    return snap;
  }

  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* Settle: rAF x2, then poll until the editor reports no active run / no pending confirm and the manager+editor
   * fingerprint is unchanged across two consecutive 250 ms reads (cap 8 s; a timeout is recorded, never thrown). */
  async function capture(label, opts) {
    const o = Object.assign({ minWaitMs: 0, capMs: 8000, pollMs: 250 }, opts || {});
    await raf(); await raf();
    if (o.minWaitMs) await sleep(o.minWaitMs);
    const fp = () => {
      const s = sync('_probe'); window.__ctmSnaps.pop();
      return JSON.stringify([s.manager, s.editor, s.viewer && [s.viewer.models, s.viewer.visibleModels, s.viewer.panelOverlayChildren]]);
    };
    const t0 = performance.now(); let prev = fp(); let stable = false; let timedOut = false;
    for (;;) {
      await sleep(o.pollMs);
      const cur = fp();
      const probe = sync('_probe'); window.__ctmSnaps.pop();
      const busy = probe.editor && (probe.editor.runActive === true);
      if (cur === prev && !busy) { stable = true; break; }
      prev = cur;
      if (performance.now() - t0 > o.capMs) { timedOut = true; break; }
    }
    const snap = sync(label);
    snap.settle = { stable, timedOut, waitedMs: Math.round(performance.now() - t0), minWaitMs: o.minWaitMs };
    return snap;
  }
  capture.sync = sync;
  capture.SCHEMA = SCHEMA;
  window.__ctmCapture = capture;
})();
