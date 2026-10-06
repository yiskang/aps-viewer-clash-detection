// wwwroot/extensions/ClashPanelExtension.js
//
// Host shell for the Viewer Clash Panel: a toolbar button (#clash-panel-toolbar-button, tooltip "Clash Panel")
// that toggles the panel. The panel host (world + engine + wiring + catalog + panel) is created lazily on the
// first toggle and torn down in unload(). Composition lives in clashPanelHost.js.
// clashPanelHost.js (and with it clashtest/ + clashpanel/) is imported lazily on first toggle, so a load failure
// there can never stop the default sample (Room Locator / Clash Finder) from starting.

export const EXTENSION_ID = 'Autodesk.Sandbox.ClashPanel';
export const TOOLBAR_BUTTON_ID = 'clash-panel-toolbar-button';
export const TOOLBAR_GROUP_ID = 'clash-panel-toolbar-group';
export const TOOLBAR_BUTTON_TITLE = 'Clash Panel';

// Same headless-Node guard as the sibling extensions (see ClashFinderExtension.js).
const ViewingNS = typeof Autodesk !== 'undefined' ? Autodesk.Viewing : undefined;
const ExtensionBase = ViewingNS?.Extension ?? class {
  constructor(viewer, options) {
    this.viewer = viewer;
    this.options = options;
  }
};

export class ClashPanelExtension extends ExtensionBase {
  constructor(viewer, options = {}) {
    super(viewer, options);
    this._viewer = viewer;
    this._group = null;
    this._button = null;
    this._hostPromise = null;
    this._unloaded = true;
    this._onToolbarCreatedBound = () => this._createToolbarUI();
  }

  load() {
    this._unloaded = false;
    if (this._viewer.toolbar) {
      this._createToolbarUI();
    } else {
      this._viewer.addEventListener(this._toolbarCreatedEvent(), this._onToolbarCreatedBound);
    }
    return true;
  }

  _toolbarCreatedEvent() {
    return globalThis.Autodesk?.Viewing?.TOOLBAR_CREATED_EVENT ?? 'toolbarCreated';
  }

  _createToolbarUI() {
    this._viewer.removeEventListener(this._toolbarCreatedEvent(), this._onToolbarCreatedBound);
    const toolbar = this._viewer.toolbar;
    if (this._unloaded || this._button || !toolbar) return;
    const UI = globalThis.Autodesk.Viewing.UI;
    const button = new UI.Button(TOOLBAR_BUTTON_ID);
    if (button.container) button.container.id = TOOLBAR_BUTTON_ID;
    button.setToolTip(TOOLBAR_BUTTON_TITLE);
    button.onClick = () => { this.toggle(); };
    const group = new UI.ControlGroup(TOOLBAR_GROUP_ID);
    group.addControl(button);
    toolbar.addControl(group);
    this._button = button;
    this._group = group;
  }

  /** Lazily creates the host on first use; concurrent callers share one creation. Failed creation can be retried. */
  _ensureHost() {
    if (!this._hostPromise) {
      const p = Promise.resolve().then(async () => {
        const create = this.options.createHost ?? (await import('./clashPanelHost.js')).createClashPanelHost;
        return create({
          viewer: this._viewer,
          Autodesk: globalThis.Autodesk,
          THREE: globalThis.THREE,
          report: (stage, e) => console.warn('ClashPanelExtension:', stage, e),
        });
      });
      this._hostPromise = p;
      p.catch(() => { if (this._hostPromise === p) this._hostPromise = null; });
    }
    return this._hostPromise;
  }

  async toggle() {
    if (this._unloaded) return false;
    let host;
    try {
      host = await this._ensureHost();
    } catch (err) {
      console.error('ClashPanelExtension: could not create the Clash Panel', err);
      if (typeof alert === 'function') alert(`Could not open the Clash Panel: ${err?.message ?? err}`);
      return false;
    }
    if (this._unloaded) return false; // unload() raced creation; it disposes the host itself
    host.toggle();
    return true;
  }

  async unload() {
    this._unloaded = true;
    // Synchronous part first: nothing of ours stays in the toolbar even if disposal is slow or fails.
    try { this._viewer.removeEventListener(this._toolbarCreatedEvent(), this._onToolbarCreatedBound); } catch (e) { console.warn(e); }
    try {
      if (this._group && this._button) this._group.removeControl(this._button);
      if (this._group && this._viewer.toolbar) this._viewer.toolbar.removeControl(this._group);
    } catch (e) {
      console.warn('ClashPanelExtension: toolbar cleanup failed', e);
    }
    this._button = null;
    this._group = null;
    const hostPromise = this._hostPromise;
    this._hostPromise = null;
    if (hostPromise) {
      try {
        const host = await hostPromise;
        await host.dispose();
      } catch (err) {
        console.warn('ClashPanelExtension: teardown reported errors', err);
      }
    }
    return true;
  }
}
