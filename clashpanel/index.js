// clashpanel/index.js — composition root of the Viewer Clash Panel (spec §5.1). The ONLY module that sees all
// three layers: headless core (controller), the ViewerBridge (the only 3D-scene mutator) and the thin UI shell.
// It receives every port by injection; it registers no model, derives no key, wires no unload, invalidates no
// placement (host responsibilities, PD-18/OQ-1 — see clashpanel/README.md). Toolbar button / extension
// registration are HOST shell code (gate H1), not part of this package.
import { createPanelController } from './core/index.js';
import { createViewerBridge } from './viewer/ViewerBridge.js';
import { createViewerApi } from './viewer/viewerApi.js';
import { createPanelShell } from './ui/ClashDockingPanel.js';

// Overlay scene names are INSTANCE-scoped (derived from the panel id), so two panels on one viewer never share a
// scene: clearing or disposing one can never remove the other's meshes or scenes.
const overlayNamesFor = (id) => Object.freeze({ overlayMarkers: `clash-panel-markers:${id}`, overlayOutlines: `clash-panel-outlines:${id}` });
const DEFAULT_ID = 'clash-detection-panel';
const DEFAULT_TITLE = 'Clash Detection';

function assertEvents(events) {
  if (typeof events?.BEFORE_MODEL_UNLOAD !== 'string' || events.BEFORE_MODEL_UNLOAD === ''
    || typeof events?.MODEL_REMOVED !== 'string' || events.MODEL_REMOVED === '') {
    throw new TypeError('createClashPanel: events.BEFORE_MODEL_UNLOAD and events.MODEL_REMOVED (event names) are required');
  }
}

/**
 * createClashPanel({ Autodesk, viewer, THREE, engine, catalog, scheduler?, doc?, events, id?, title? })
 *   -> { show, hide, toggle, isVisible, dispose(): Promise<void>, controller }
 * dispose(): shell → controller → bridge, each step guaranteed to run even when an earlier one throws; resolves
 * once all three completed, or rejects with an AggregateError listing every failed step (after ALL ran) —
 * including the bridge's recorded teardown failures (listener removals, a failed isolation restore).
 * controller.dispose() cancels an active run ('panel-disposed') and resolves {released, errors} only after that
 * run's `done` has settled, its result set is released and the bridge is disposed; its `errors` (and
 * `released: false`) are folded into the AggregateError above. Await panel.dispose() BEFORE engine.dispose():
 * both are bounded by Core's drain of the in-flight work unit, and unbounded only by an executor that never
 * returns (Core open item O9). There is no Panel-side escape hatch.
 */
// bridge.dispose() never rejects (idempotent, resolves undefined); its failures — listener removals the Viewer
// refused and dispose-time cleanup notes (a failed isolation restore, a marker that could not be removed) — are
// recorded in inspectDisposal(). Surface them here so dispose() can report them. Never throws.
function bridgeTeardownErrors(bridge) {
  let report;
  try {
    if (typeof bridge?.inspectDisposal !== 'function') return [];
    report = bridge.inspectDisposal();
  } catch (error) {
    return [error];
  }
  const out = [];
  for (const e of Array.isArray(report?.listenerErrors) ? report.listenerErrors : []) {
    out.push(e instanceof Error ? e : new Error(`createClashPanel: viewer listener removal failed: ${String(e)}`));
  }
  for (const note of Array.isArray(report?.releaseNotes) ? report.releaseNotes : []) {
    out.push(new Error(`createClashPanel: viewer teardown: ${String(note)}`));
  }
  return out;
}

export function createClashPanel({ Autodesk, viewer, THREE, engine, catalog, scheduler, doc, events, id = DEFAULT_ID, title = DEFAULT_TITLE } = {}) {
  if (viewer === null || typeof viewer !== 'object') throw new TypeError('createClashPanel: viewer is required');
  assertEvents(events);
  const viewerApi = createViewerApi(viewer, { events: { BEFORE_MODEL_UNLOAD: events.BEFORE_MODEL_UNLOAD, MODEL_REMOVED: events.MODEL_REMOVED } });
  if (typeof id !== 'string' || id === '') throw new TypeError('createClashPanel: id must be a non-empty string');
  const bridge = createViewerBridge({ viewerApi, THREE, names: overlayNamesFor(id) });

  let controller;
  try {
    controller = createPanelController({ engine, catalog, bridge, scheduler });
  } catch (error) {
    void Promise.resolve().then(() => bridge.dispose()).catch(() => {});
    throw error;
  }

  let shell;
  try {
    shell = createPanelShell({ Autodesk, parentContainer: viewer.container, controller, id, title, doc });
  } catch (error) {
    void Promise.resolve()
      .then(() => controller.dispose())
      .catch(() => {})
      .then(() => bridge.dispose())
      .catch(() => {});
    throw error;
  }

  let disposing = null;
  async function disposeAll() {
    const errors = [];
    try {
      await shell.dispose();
    } catch (error) {
      errors.push(error);
    } finally {
      try {
        // controller.dispose() never rejects: it resolves {released, errors} (Part 3); fold both into this result.
        const outcome = await controller.dispose();
        if (Array.isArray(outcome?.errors)) errors.push(...outcome.errors);
        if (outcome?.released === false && !(Array.isArray(outcome?.errors) && outcome.errors.length > 0)) {
          errors.push(new Error('createClashPanel: the controller could not release every result set'));
        }
      } catch (error) {
        errors.push(error);
      } finally {
        try {
          await bridge.dispose();
        } catch (error) {
          errors.push(error);
        }
        errors.push(...bridgeTeardownErrors(bridge));
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'createClashPanel: dispose completed with errors');
  }

  return Object.freeze({
    show: () => shell.show(),
    hide: () => shell.hide(),
    toggle: () => shell.toggle(),
    isVisible: () => shell.isVisible(),
    dispose: () => {
      if (disposing === null) disposing = disposeAll();
      return disposing;
    },
    controller,
  });
}
