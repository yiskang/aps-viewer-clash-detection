// clashpanel/ui/ClashDockingPanel.js — the ONE small adapter that owns the DockingPanel (spec §14.2 PD-19).
//
// Thin by construction (AC-P21): it creates the panel, renders controller.getViewModel() into the panel body on
// every controller notification, and turns DOM events / visibility changes into intents. It holds NO workflow or
// domain state (no draft, run, results, filters, grouping, selection, page, residency, restore state) and has no
// reference to the 3D host: the parent container is passed in by the composition root.
//
// Verified DockingPanel constraints (plan catalog §1; live lifecycle = gate G3/PG-1):
//   * subclass ONLY through initialize(); the base constructor calls initialize() BEFORE a subclass's own fields
//     exist, so this class declares NO fields and finds its body through the container, not through `this`;
//   * the base constructor calls setVisible(false) after initialize(), BEFORE our listener is added;
//   * addVisibilityListener has no remove counterpart: exactly ONE listener, gated by `disposed`;
//   * never setVisible after uninitialize() (the container is null then).
import { INTENT } from '../core/intents.js';
import { renderPanel } from './render/panel.js';
import { renderManagedPanel } from './render/manager.js';

const BODY_CLASS = 'clash-panel-body';
// Native Viewer scroll surface (7.124.2): 6px themed scrollbar + solid light surface. Added alongside BODY_CLASS.
const NATIVE_BODY_CLASSES = 'docking-panel-scroll docking-panel-container-solid-color-a';

export function createClashDockingPanelClass(Autodesk) {
  const Base = Autodesk?.Viewing?.UI?.DockingPanel;
  if (typeof Base !== 'function') {
    throw new TypeError('createClashDockingPanelClass: Autodesk.Viewing.UI.DockingPanel is required');
  }
  return class ClashDockingPanel extends Base {
    initialize() {
      const doc = this.container.ownerDocument;
      this.title = this.createTitleBar(this.titleLabel || this.container.id);
      this.container.appendChild(this.title);
      this.closer = this.createCloseButton();
      this.container.appendChild(this.closer);
      this.initializeMoveHandlers(this.title);
      const body = doc.createElement('div');
      body.className = `${BODY_CLASS} ${NATIVE_BODY_CLASSES}`;
      // Geometry: the base DockingPanel leaves a panel unpositioned (it would land below the viewer), so anchor it
      // top-left with a bounded height and let the body scroll.
      const box = this.container.style;
      box.position = 'absolute';
      box.top = '10px';
      box.left = '10px';
      box.width = 'min(460px, 90vw)';   // 460px on desktop; never wider than the viewport on a narrow canvas
      box.height = 'calc(100% - 80px)';
      box.minWidth = 'min(340px, 90vw)';
      box.maxWidth = '90vw';
      box.resize = 'none';
      const bodyBox = body.style;
      bodyBox.position = 'absolute';
      bodyBox.top = '50px';   // native .docking-panel-title is 50px tall (49px + 1px border)
      bodyBox.left = '0';
      bodyBox.right = '0';
      bodyBox.bottom = '0';
      bodyBox.overflowY = 'auto';
      bodyBox.overflowX = 'hidden';
      bodyBox.height = 'auto';   // native .docking-panel-scroll sets height:100%, which would defeat top/bottom
      bodyBox.boxSizing = 'border-box';
      bodyBox.background = '#fff';   // opaque: the 3D canvas must not show through the text (padding/colours live in main.css)
      this.container.appendChild(body);
    }
  };
}

function assertController(controller) {
  for (const name of ['getViewModel', 'subscribe', 'dispatch']) {
    if (typeof controller?.[name] !== 'function') throw new TypeError(`createPanelShell: controller.${name} is required`);
  }
}

export function createPanelShell({ Autodesk, parentContainer, controller, id, title, doc, managed = false } = {}) {
  assertController(controller);
  if (typeof parentContainer?.appendChild !== 'function') throw new TypeError('createPanelShell: parentContainer must be a DOM element');
  if (typeof id !== 'string' || id === '') throw new TypeError('createPanelShell: id is required');
  const PanelClass = createClashDockingPanelClass(Autodesk);
  const document_ = doc ?? parentContainer.ownerDocument;

  let disposed = false;
  let panel = null;
  let body = null;
  let unsubscribe = null;
  const dispatch = (intent) => (disposed ? Promise.resolve() : controller.dispatch(intent));
  // §26.8: a manager-hosted Panel renders {manager, editor}; the standalone editor renders its own ViewModel.
  const renderBody = managed === true ? renderManagedPanel : renderPanel;
  const render = (vm) => { if (!disposed && body !== null) renderBody(body, vm, dispatch, document_); };
  const onVisibility = (shown) => {
    if (disposed) return;
    controller.dispatch({ type: shown ? INTENT.PANEL_SHOWN : INTENT.PANEL_HIDDEN });
  };

  // Transactional construction: the base constructor appends its container BEFORE initialize() runs, so a throw
  // from initialize()/initializeMoveHandlers() (no instance returned), the body lookup, addVisibilityListener,
  // subscribe or the first render must leave NOTHING behind — no container, no subscription, no live listener.
  const childrenBefore = new Set(parentContainer.children);
  try {
    panel = new PanelClass(parentContainer, id, title ?? 'Clash Detection', {});
    body = panel.container.querySelector(`:scope > .${BODY_CLASS}`);
    if (body === null) throw new Error('createPanelShell: panel body was not created');
    panel.addVisibilityListener(onVisibility);
    unsubscribe = controller.subscribe(render);
    render(controller.getViewModel());
  } catch (error) {
    disposed = true;   // a listener that did get registered is inert from here on
    try { if (unsubscribe) unsubscribe(); } catch { /* rollback continues */ }
    unsubscribe = null;
    try { if (panel !== null) panel.uninitialize(); } catch { /* rollback continues */ }
    for (const child of [...parentContainer.children]) {
      if (!childrenBefore.has(child)) {
        try { parentContainer.removeChild(child); } catch { /* rollback continues */ }
      }
    }
    throw error;
  }

  return Object.freeze({
    show() { if (!disposed) panel.setVisible(true); },
    hide() { if (!disposed) panel.setVisible(false); },
    toggle() { if (!disposed) panel.setVisible(!panel.isVisible()); },
    isVisible() { return !disposed && panel.isVisible(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        if (unsubscribe) unsubscribe();
      } finally {
        unsubscribe = null;
        panel.uninitialize();
      }
    },
  });
}
