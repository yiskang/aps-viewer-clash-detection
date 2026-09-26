// test/clashpanel/dom/support/mount.mjs
//
// BROWSER-SIDE helper (imported in-page from https://panel.test/test/clashpanel/dom/support/mount.mjs). Mounts one
// renderer into <div id="clash-root"> with a dispatch that records JSON copies of every intent in
// window.__clash.intents. No Node imports.
export async function mount(modulePath, exportName, vmPart) {
  const mod = await import(modulePath);
  const render = mod[exportName];
  if (typeof render !== 'function') throw new TypeError(`${modulePath} has no export ${exportName}`);
  document.getElementById('clash-root')?.remove();
  const root = document.createElement('div');
  root.id = 'clash-root';
  document.body.appendChild(root);
  const intents = [];
  // dispatch resolves undefined, or window.__clash.reply(intent) when a test installs one (DIAGNOSTICS_COPY
  // resolves the diagnostics string in the real controller).
  const dispatch = (intent) => {
    intents.push(JSON.parse(JSON.stringify(intent)));
    const reply = window.__clash.reply;
    return Promise.resolve(typeof reply === 'function' ? reply(intent) : undefined);
  };
  window.__clash = { root, intents, dispatch, reply: null, render: (vm) => render(root, vm, dispatch, document) };
  window.__clash.render(vmPart);
}

/** Order-preserving structural snapshot: enough to compare two renders of the same view-model. */
export function snapshotDom(root) {
  const out = [];
  const walk = (node, depth) => {
    for (const child of node.children) {
      const aria = {};
      for (const attr of child.attributes) {
        if (attr.name.startsWith('aria-') || attr.name === 'role' || attr.name === 'data-key' || attr.name === 'title' || attr.name === 'tabindex') aria[attr.name] = attr.value;
      }
      out.push({
        depth,
        tag: child.tagName.toLowerCase(),
        cls: child.className,
        own: [...child.childNodes].filter((n) => n.nodeType === 3).map((n) => n.data).join(''),
        value: 'value' in child && child.tagName !== 'LI' && child.tagName !== 'BUTTON' ? String(child.value) : null,
        checked: 'checked' in child ? child.checked : null,
        disabled: 'disabled' in child ? child.disabled : null,
        hidden: child.hidden,
        attrs: aria,
      });
      walk(child, depth + 1);
    }
  };
  if (root) walk(root, 0);
  return out;
}
