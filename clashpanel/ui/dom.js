// clashpanel/ui/dom.js
//
// The ONLY DOM construction helpers of the Panel view. Spec §8.2 / AC-P13: every model name, element label,
// error message and diagnostic text is untrusted external text, so text reaches the DOM ONLY through
// `textContent` (and attribute VALUES through setAttribute, which never parses markup). This module — and all of
// clashpanel/ui — never parses HTML (static ban in the layering guard, Task 1).

/** Creates an element. opts: { class, attrs: {name: value}, text, on: {event: handler}, props: {name: value} } */
export function el(doc, tag, opts = {}, children = []) {
  const node = doc.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.attrs) {
    for (const [name, value] of Object.entries(opts.attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (/^on/i.test(name)) throw new TypeError(`el(): event-handler attribute "${name}" is not allowed; use opts.on`);
      node.setAttribute(name, value === true ? '' : String(value));
    }
  }
  if (opts.props) {
    for (const [name, value] of Object.entries(opts.props)) node[name] = value;
  }
  if (opts.text !== undefined && opts.text !== null) node.textContent = String(opts.text);
  if (opts.on) {
    for (const [event, handler] of Object.entries(opts.on)) node.addEventListener(event, handler);
  }
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) node.appendChild(child);
  }
  return node;
}

export function setText(node, str) {
  node.textContent = str === null || str === undefined ? '' : String(str);
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Returns the descendant of `root` whose data-key equals `key` (no selector parsing of untrusted keys). */
export function findByKey(root, key) {
  for (const node of root.querySelectorAll('[data-key]')) {
    if (node.getAttribute('data-key') === key) return node;
  }
  return null;
}

/**
 * Rebuilds `root` with `build()` while preserving focus and caret of the active element when that element
 * lives inside `root` and carries a data-key (spec §14.4: re-render must not steal the user's input).
 */
export function rebuild(root, doc, build) {
  const active = doc.activeElement;
  let saved = null;
  if (active && active !== doc.body && root.contains(active) && active.hasAttribute('data-key')) {
    saved = { key: active.getAttribute('data-key'), start: null, end: null };
    try {
      saved.start = active.selectionStart;
      saved.end = active.selectionEnd;
    } catch { /* inputs without a text selection (checkbox, radio) */ }
  }
  const scrollTop = root.scrollTop;
  clear(root);
  build();
  root.scrollTop = scrollTop;
  if (saved) {
    const next = findByKey(root, saved.key);
    if (next && typeof next.focus === 'function') {
      next.focus();
      if (saved.start !== null && typeof next.setSelectionRange === 'function') {
        try { next.setSelectionRange(saved.start, saved.end); } catch { /* not a text control */ }
      }
    }
  }
}

// Per-mounted-panel namespace for document-global names (radio groups): two panels in one document must never
// share a radio group. renderPanel() stamps its root; a region rendered on its own gets its own namespace.
let nsCounter = 0;
export const NS_ATTR = 'data-clash-ns';
export function instanceNs(root) {
  const owner = root.closest(`[${NS_ATTR}]`);
  if (owner) return owner.getAttribute(NS_ATTR);
  nsCounter += 1;
  const ns = `clash-${nsCounter}`;
  root.setAttribute(NS_ATTR, ns);
  return ns;
}
