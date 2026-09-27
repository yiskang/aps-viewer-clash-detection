// test/clashpanel/dom/support/stubAutodesk.mjs
//
// A browser-side stand-in for the parts of `Autodesk.Viewing.UI.DockingPanel` the Panel shell uses, replicating
// the source-observed Viewer 7.124.2 semantics recorded in the plan catalog §1 (undocumented members; the live
// lifecycle is gate G3/PG-1, NOT proven by this stub):
//   * constructor(parentContainer, id, title, options): creates + appends `container`, calls the overridable
//     `initialize()` (a subclass's own fields are NOT yet assigned at that point), then calls `setVisible(false)`;
//   * setVisible(show) toggles container.style.display and calls every visibility callback with the boolean;
//     after uninitialize() the container is null, so setVisible throws exactly like the real one would;
//   * addVisibilityListener(cb) is append-only — there is NO remove-listener;
//   * the default close button calls setVisible(false);
//   * uninitialize() removes the container from its parent and nulls it.
// `installAutodeskStub` is self-contained (it is serialized by page.addInitScript) and records every call in
// `window.Autodesk.__stubCalls` (instances in `__stubInstances`).
export function installAutodeskStub() {
  const calls = [];
  const instances = [];
  class DockingPanel {
    constructor(parentContainer, id, title, options = {}) {
      calls.push({ op: 'construct', id, title });
      instances.push(this);
      this.visibilityCallbacks = [];
      this.titleLabel = title;
      this.options = options;
      this.parentContainer = parentContainer;
      this.container = document.createElement('div');
      this.container.id = id;
      this.container.className = 'docking-panel';
      parentContainer.appendChild(this.container);
      this.initialize();
      this.setVisible(false);
    }
    initialize() {
      calls.push({ op: 'initialize:base' });
      this.title = this.createTitleBar(this.titleLabel || this.container.id);
      this.container.appendChild(this.title);
      this.closer = this.createCloseButton();
      this.container.appendChild(this.closer);
    }
    createTitleBar(text) {
      calls.push({ op: 'createTitleBar' });
      const bar = document.createElement('div');
      bar.className = 'docking-panel-title';
      bar.textContent = text;
      return bar;
    }
    createCloseButton() {
      calls.push({ op: 'createCloseButton' });
      const closer = document.createElement('div');
      closer.className = 'docking-panel-close';
      closer.addEventListener('click', () => this.setVisible(false));
      return closer;
    }
    initializeMoveHandlers() { calls.push({ op: 'initializeMoveHandlers' }); }
    setVisible(show) {
      calls.push({ op: 'setVisible', show: Boolean(show), afterUninitialize: this.container === null });
      this.container.style.display = show ? 'block' : 'none'; // throws TypeError after uninitialize (real behavior)
      for (const cb of this.visibilityCallbacks) cb(Boolean(show));
    }
    isVisible() { return this.container !== null && this.container.style.display === 'block'; }
    addVisibilityListener(cb) {
      calls.push({ op: 'addVisibilityListener' });
      this.visibilityCallbacks.push(cb);
    }
    uninitialize() {
      calls.push({ op: 'uninitialize' });
      if (this.container && this.container.parentNode) this.container.parentNode.removeChild(this.container);
      this.container = null;
      this.title = null;
      this.closer = null;
      this.parentContainer = null;
    }
  }
  window.Autodesk = {
    __stubCalls: calls,
    __stubInstances: instances,
    Viewing: {
      UI: { DockingPanel },
      BEFORE_MODEL_UNLOAD_EVENT: 'beforeModelUnload',
      MODEL_REMOVED_EVENT: 'modelRemoved',
    },
  };
}
