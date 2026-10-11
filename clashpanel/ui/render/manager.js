// clashpanel/ui/render/manager.js — spec §26.8–§26.10 and §26.14: the Clash Tests manager views around the UNCHANGED editor.
// Root children, fixed order: [0] header (active test, view switch, notice / fault / confirmation banners, one
// persistent live node), [1] Tests list (a semantic list, one item per test — §26.14), [2] editor host rendered by renderPanel. Manager parts are
// <div role="region">, never <section>, so the editor keeps exactly its five regions. Text only via textContent (AC-P13);
// state is never conveyed by colour alone (§26.10). Thin: renders the ViewModel, dispatches intents, holds no state.
import { el, setText, rebuild, instanceNs } from '../dom.js';
import { INTENT, MANAGER_INTENT } from '../../core/intents.js';
import { renderPanel } from './panel.js';

export const MANAGER_STYLE_ID = 'clash-manager-style';
// Action glyphs (§26.14, owner-approved mechanism): CSS mask data-URIs painted with currentColor — the precedent of the
// toolbar icon (wwwroot/main.css `#clash-panel-toolbar-button .adsk-button-icon`). Alpha-only, so no colours are baked in.
const glyph = (paths) => `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${paths}</svg>")`;
const GLYPHS = Object.freeze({
  open: glyph("<path d='M4 20h4L19 9l-4-4L4 16z'/><path d='M13 7l4 4'/>"),
  duplicate: glyph("<rect x='9' y='9' width='11' height='11' rx='1'/><path d='M15 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h4'/>"),
  reset: glyph("<path d='M4 12a8 8 0 1 0 2.4-5.7'/><path d='M4 4v5h5'/>"),
  delete: glyph("<path d='M4 7h16'/><path d='M9 7V4h6v3'/><path d='M6 7l1 13h10l1-13'/><path d='M10 11v6M14 11v6'/>"),
});
const L = '.clash-manager-list';
// Text-label fallback where mask-image is unavailable. The SAME declarations are selected by the production `@supports not`
// rule and by the deterministic test seam class `.clash-manager-no-mask` on the list root (CSS.supports stubbing cannot drive @supports).
const FALLBACK = Object.freeze([
  ['.clash-manager-icon', 'display:none'],
  ['.clash-manager-act-text', 'display:inline'],
  ['.clash-manager-act', 'width:auto;height:auto;min-height:28px;padding:0 8px'],
  ['.clash-manager-actions', 'flex-wrap:wrap'],
]);
const LINE_CLAMP = 'display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;line-height:16px';
const MANAGER_CSS = [
  // --- Tests list (§26.14). Everything is scoped to the list; it overrides the panel-wide `.clash-panel-root *` reset
  // (min-width:0; overflow-wrap:anywhere; word-break:break-word) by specificity so names cannot collapse to one character per line.
  `${L}{container-type:inline-size}`,
  `${L} .clash-manager-caption{margin:6px 0}`,
  `${L} .clash-manager-items{list-style:none;margin:0;padding:0}`,
  `${L} .clash-manager-item{margin:6px 0;padding:6px 8px;border:1px solid var(--nv-border,#d5dbe1);border-left:3px solid var(--nv-border,#d5dbe1);border-radius:4px}`,
  `${L} .clash-manager-item[aria-current="true"]{border-left-color:var(--nv-accent,#00bfff);background:var(--nv-band,rgba(242,247,250,.7))}`,
  `${L} .clash-manager-item *{overflow-wrap:break-word;word-break:normal}`,
  `${L} .clash-manager-head{display:flex;flex-wrap:wrap;align-items:flex-start;gap:4px 8px}`,
  `${L} .clash-manager-title{display:flex;align-items:flex-start;gap:6px;flex:1 1 calc(10ch + 64px);min-width:calc(10ch + 64px)}`,
  `${L} .clash-manager-name{flex:1 1 10ch;min-width:10ch;font-weight:600;${LINE_CLAMP}}`,
  `${L} .clash-manager-badge{flex:none;padding:0 6px;border:1px solid var(--nv-accent,#00bfff);border-radius:8px;font-size:11px;line-height:14px}`,
  `${L} .clash-manager-actions{display:flex;flex:none;gap:4px}`,
  `${L} .clash-manager-act{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:28px;height:28px;min-width:28px;margin:0;padding:0}`,
  `${L} .clash-manager-icon{display:block;width:16px;height:16px;background-color:currentColor;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;-webkit-mask-size:contain;mask-size:contain}`,
  ...Object.entries(GLYPHS).map(([id, g]) => `${L} .clash-manager-act-${id} .clash-manager-icon{-webkit-mask-image:${g};mask-image:${g}}`),
  `${L} .clash-manager-act-text{display:none}`,
  `${L} .clash-manager-meta{margin:4px 0 2px}`,
  `${L} .clash-manager-sep{margin:0 4px}`,
  `${L} .clash-manager-set{display:flex;gap:6px;margin:2px 0}`,
  `${L} .clash-manager-set-label{flex:none;min-width:3.4em;color:var(--nv-text-2,#4a555b)}`,
  `${L} .clash-manager-set-value{flex:1 1 12ch;min-width:12ch;${LINE_CLAMP}}`,
  `${L} .clash-manager-readiness{margin:4px 0 0;color:var(--nv-text-2,#4a555b)}`,
  `${L} .clash-manager-reasons{margin-top:4px;font-size:smaller}`,
  `${L} .clash-manager-reason-row{margin:2px 0}`,
  `${L} .clash-manager-reason-row .clash-manager-reason{display:inline}`,
  '@container (max-width:279px){',
  `${L} .clash-manager-actions{flex-basis:100%}`,
  `${L} .clash-manager-set{flex-direction:column;gap:0}`,
  `${L} .clash-manager-set-value{flex:0 0 auto}`,
  '}',
  `@supports not ((mask-image:none) or (-webkit-mask-image:none)){${FALLBACK.map(([s, d]) => `${L} ${s}{${d}}`).join('')}}`,
  ...FALLBACK.map(([s, d]) => `${L}.clash-manager-no-mask ${s}{${d}}`),
  // --- shared
  '.clash-manager-reason{display:block;font-size:smaller}',
  // A fault-locked result row (lockRow below): the host's native disabled-control look (wwwroot/main.css
  // `.clash-panel-root button:disabled` = opacity .4, cursor default), no hover highlight (main.css
  // `.clash-panel-root .clash-row:hover` is (0,3,0); these selectors are (0,4,0)/(0,5,0)) and no focus ring.
  '.clash-manager-editor .clash-row[data-fault-locked="true"]{opacity:.4;cursor:default}',
  '.clash-manager-editor .clash-row[data-fault-locked="true"]:not(.clash-row-selected):hover{background:transparent}',
  '.clash-manager-editor .clash-row[data-fault-locked="true"]:focus-visible{outline:none}',
].join('\n');

const ACTIONS = Object.freeze([
  Object.freeze({ id: 'open', label: 'Open', intent: MANAGER_INTENT.OPEN }),
  Object.freeze({ id: 'duplicate', label: 'Duplicate', intent: MANAGER_INTENT.DUPLICATE }),
  Object.freeze({ id: 'reset', label: 'Reset results', intent: MANAGER_INTENT.RESET }),
  Object.freeze({ id: 'delete', label: 'Delete test', intent: MANAGER_INTENT.DELETE }),
]);

function ensureStyle(doc) {
  if (doc.getElementById(MANAGER_STYLE_ID)) return;
  (doc.head ?? doc.documentElement).appendChild(el(doc, 'style', { attrs: { id: MANAGER_STYLE_ID }, text: MANAGER_CSS }));
}

function ensurePart(root, doc, cls, index, attrs) {
  let part = null;
  for (const child of root.children) if (child.classList.contains(cls)) { part = child; break; }
  if (!part) part = el(doc, 'div', { class: cls, attrs });
  if (root.children[index] !== part) root.insertBefore(part, root.children[index] ?? null);
  return part;
}

/**
 * ONE live region for the whole managed Panel (§23.6/§26.10; Codex plan review I2; plan decision P-12). The header
 * node is never hidden (the editor host is, in list view), so it relays whichever announcement changed last: a
 * manager announcement (vm.manager.live) or the editor's status (vm.editor.run.statusLive).
 */
function announce(header, live, vm) {
  const managerLive = vm.manager.live ?? '';
  const editorLive = vm.editor?.run?.statusLive ?? '';
  const seq = String(Number.isInteger(vm.manager.liveSeq) ? vm.manager.liveSeq : 0);
  const seqChanged = seq !== (header.getAttribute('data-live-seq') ?? '0');
  let text = live.textContent;
  let reannounce = false;
  if (managerLive !== '' && (managerLive !== (header.getAttribute('data-live-manager') ?? '') || seqChanged)) {
    text = managerLive;
    reannounce = true;      // a new manager EVENT (M2): announced even when its text equals the previous announcement
  } else if (editorLive !== (header.getAttribute('data-live-editor') ?? '')) text = editorLive;
  header.setAttribute('data-live-manager', managerLive);
  header.setAttribute('data-live-editor', editorLive);
  header.setAttribute('data-live-seq', seq);
  if (reannounce) live.setAttribute('data-live-seq', seq);
  if (live.textContent !== text) setText(live, text);
  else if (reannounce) {    // identical text: clear then re-insert a fresh text node so assistive technology sees a new update
    live.replaceChildren();
    live.appendChild(live.ownerDocument.createTextNode(text));
  }
}

/** The editor's own status node (run.js) stays for layout but is no longer a live region: the header relays it. */
function silenceEditorLive(host) {
  for (const node of host.querySelectorAll('.clash-status')) {
    node.removeAttribute('aria-live');
    node.removeAttribute('role');
    node.setAttribute('aria-hidden', 'true');
  }
}

function confirmBanner(doc, confirm, dispatch, ns) {
  const reasonId = `${ns}-manager-confirm-reason`;
  const disabled = confirm.enabled === false;
  return el(doc, 'div', {
    class: 'clash-banner clash-banner-warning',
    attrs: { 'data-banner-id': 'manager-confirm', role: 'alertdialog', 'aria-label': 'Confirm test action', tabindex: '-1' },
  }, [
    el(doc, 'p', { class: 'clash-banner-text', text: confirm.text }),
    el(doc, 'button', {
      attrs: { type: 'button', 'data-key': 'manager-confirm', disabled, 'aria-describedby': disabled ? reasonId : null }, text: confirm.confirmLabel,
      on: { click: () => dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: confirm.operationId }) },
    }),
    disabled ? el(doc, 'span', { class: 'clash-manager-reason', attrs: { id: reasonId }, text: confirm.disabledReason ?? '' }) : null,
    el(doc, 'button', {
      attrs: { type: 'button', 'data-key': 'manager-cancel' }, text: confirm.cancelLabel,
      on: { click: () => dispatch({ type: MANAGER_INTENT.CANCEL, operationId: confirm.operationId }) },
    }),
  ]);
}

function renderHeader(header, vm, dispatch, doc, ns) {
  const m = vm.manager;
  let body = header.querySelector(':scope > .clash-manager-header-body');
  let live = header.querySelector(':scope > .clash-status');
  if (!body) { body = el(doc, 'div', { class: 'clash-manager-header-body' }); header.appendChild(body); }
  if (!live) { live = el(doc, 'div', { class: 'clash-status', attrs: { role: 'status', 'aria-live': 'polite' } }); header.appendChild(live); }
  announce(header, live, vm);
  rebuild(body, doc, () => {
    body.appendChild(el(doc, 'p', { class: 'clash-manager-active', text: `Test: ${m.activeName}` }));
    body.appendChild(m.view === 'list'
      ? el(doc, 'button', { attrs: { type: 'button', 'data-key': 'manager-view-editor' }, text: 'Back to test', on: { click: () => dispatch({ type: MANAGER_INTENT.VIEW_EDITOR }) } })
      : el(doc, 'button', { attrs: { type: 'button', 'data-key': 'manager-view-list' }, text: `All tests (${m.count})`, on: { click: () => dispatch({ type: MANAGER_INTENT.VIEW_LIST }) } }));
    if (m.fault) {
      body.appendChild(el(doc, 'div', { class: 'clash-banner clash-banner-error', attrs: { id: `${ns}-manager-fault`, role: 'alert', 'data-banner-id': 'manager-fault' } },
        [el(doc, 'p', { class: 'clash-banner-text', text: m.fault.text })]));
    }
    if (m.notice) body.appendChild(el(doc, 'p', { class: 'clash-manager-notice', text: m.notice }));
    if (vm.editor?.test?.pendingConfirm === true) {
      body.appendChild(el(doc, 'p', { class: 'clash-manager-editor-confirm' }, [
        el(doc, 'span', { text: 'A confirmation is waiting in the test editor. ' }),
        el(doc, 'button', { attrs: { type: 'button', 'data-key': 'editor-confirm-cancel' }, text: 'Cancel it', on: { click: () => dispatch({ type: INTENT.CONFIRM_CANCEL }) } }),
      ]));
    }
    if (m.confirm) body.appendChild(confirmBanner(doc, m.confirm, dispatch, ns));
  });
  // Focus moves to a NEW confirmation (§26.10); re-rendering the same one never steals focus again.
  const op = m.confirm?.operationId ?? '';
  const banner = body.querySelector('[data-banner-id="manager-confirm"]');
  if (banner && header.getAttribute('data-confirm-op') !== op) banner.focus();
  header.setAttribute('data-confirm-op', op);
}

// §26.14 disabled reasons: ONE visible reason element per DISTINCT reason in an item, first-disabled-action order; every
// disabled action it explains links to it by aria-describedby. The reason string is exactly the gate reason (never merged
// across different reasons).
function reasonGroups(t) {
  const groups = [];
  for (const a of ACTIONS) {
    const gate = t.actions[a.id];
    if (gate.enabled) continue;
    let g = groups.find((x) => x.reason === gate.reason);
    if (!g) { g = { reason: gate.reason, labels: [], actionIds: [] }; groups.push(g); }
    g.labels.push(a.label);
    g.actionIds.push(a.id);
  }
  return groups;
}

function actionGroup(doc, t, i, dispatch, groups, ns) {
  const reasonIdOf = (a) => `${ns}-manager-${i}-reason-${groups.findIndex((g) => g.actionIds.includes(a.id))}`;
  return el(doc, 'div', { class: 'clash-manager-actions', attrs: { role: 'group', 'aria-label': `Actions for “${t.name}”` } }, ACTIONS.map((a) => {
    const gate = t.actions[a.id];
    return el(doc, 'button', {
      class: `clash-manager-act clash-manager-act-${a.id}`,
      attrs: { type: 'button', 'data-key': `manager-${a.id}-${i}`, 'aria-label': `${a.label} “${t.name}”`, title: a.label, disabled: !gate.enabled, 'aria-describedby': gate.enabled ? null : reasonIdOf(a) },
      on: { click: () => dispatch({ type: a.intent, testId: t.testId }) },
    }, [
      el(doc, 'span', { class: 'clash-manager-icon', attrs: { 'aria-hidden': 'true' } }),
      el(doc, 'span', { class: 'clash-manager-act-text', text: a.label }),
    ]);
  }));
}

function setRow(doc, label, value) {
  return el(doc, 'div', { class: 'clash-manager-set' }, [
    el(doc, 'span', { class: 'clash-manager-set-label', text: label }),
    el(doc, 'span', { class: 'clash-manager-set-value', attrs: { title: value }, text: value }),
  ]);
}

// One list item per test (§26.14): head line (name · Active badge · actions), meta line (mode · existing status text),
// Set A, Set B, readiness, then the reasons container only when an action is disabled.
function item(doc, t, i, dispatch, ns) {
  const status = [t.status.text, t.resultsText, t.setupChangedSinceRun ? 'Setup changed since this run' : null, t.modelsChangedText]
    .filter((s) => typeof s === 'string' && s.length > 0).join(' · ');
  const groups = reasonGroups(t);
  return el(doc, 'li', { class: 'clash-manager-item', attrs: { 'data-test-id': t.testId, 'aria-current': t.active ? 'true' : null } }, [
    el(doc, 'div', { class: 'clash-manager-head' }, [
      el(doc, 'div', { class: 'clash-manager-title' }, [
        el(doc, 'span', { class: 'clash-manager-name', attrs: { title: t.name }, text: t.name }),
        t.active ? el(doc, 'span', { class: 'clash-manager-badge', text: 'Active' }) : null,
      ]),
      actionGroup(doc, t, i, dispatch, groups, ns),
    ]),
    el(doc, 'div', { class: 'clash-manager-meta' }, [
      el(doc, 'span', { class: 'clash-manager-mode', text: t.modeText }),
      status.length > 0 ? el(doc, 'span', { class: 'clash-manager-sep', attrs: { 'aria-hidden': 'true' }, text: '·' }) : null,
      status.length > 0 ? el(doc, 'span', { class: 'clash-manager-status', text: status }) : null,
    ]),
    setRow(doc, 'Set A', t.setA),
    setRow(doc, 'Set B', t.setB),
    el(doc, 'div', { class: 'clash-manager-readiness', text: t.readiness?.text ?? '' }),
    groups.length === 0 ? null : el(doc, 'div', { class: 'clash-manager-reasons' }, groups.map((g, k) => el(doc, 'p', { class: 'clash-manager-reason-row' }, [
      el(doc, 'span', { class: 'clash-manager-reason-for', text: `${g.labels.join(', ')}: ` }),
      el(doc, 'span', { class: 'clash-manager-reason', attrs: { id: `${ns}-manager-${i}-reason-${k}` }, text: g.reason }),
    ]))),
  ]);
}

function renderList(list, m, dispatch, doc, ns) {
  rebuild(list, doc, () => {
    const reasonId = `${ns}-manager-create-reason`;
    list.appendChild(el(doc, 'div', { class: 'clash-manager-create' }, [
      el(doc, 'button', {
        attrs: { type: 'button', 'data-key': 'manager-create', disabled: !m.create.enabled, 'aria-describedby': m.create.enabled ? null : reasonId },
        text: 'New test', on: { click: () => dispatch({ type: MANAGER_INTENT.CREATE }) },
      }),
      m.create.enabled ? null : el(doc, 'span', { class: 'clash-manager-reason', attrs: { id: reasonId }, text: m.create.reason }),
    ]));
    const captionId = `${ns}-manager-list-caption`;
    list.appendChild(el(doc, 'p', { class: 'clash-manager-caption', attrs: { id: captionId }, text: 'Clash tests (this session only)' }));
    list.appendChild(el(doc, 'ul', { class: 'clash-manager-items', attrs: { 'aria-labelledby': captionId } }, m.tests.map((t, i) => item(doc, t, i, dispatch, ns))));
  });
}

// Terminal manager fault (§26.2a, §26.9, §26.10; Work plan re-review M1). The DOM lock is a pure function of the core's
// fault overlay (lockedEditorVm, Task 6): a control is locked exactly when its vm.editor gate is {enabled:false} with
// the lock's reason, so the Panel never shows enabled a control whose intent FAULT_POLICY drops, and never locks an
// allow-listed one (the setup collapse toggle included). Locked = native `disabled` plus aria-describedby → the fault
// banner, whose text IS the reason; a node without native `disabled` (a result row, li role=option) is locked by
// lockRow and made inert by guardLockedRows (fault-state re-review M1).
const SETUP_LOCKED = 'section[data-region="setup"] :is(button, input, select, textarea):not([data-key="setup-toggle-collapsed"]):not([data-key="setup-new-test"])';
const FAULT_LOCKS = Object.freeze([
  Object.freeze({ gate: (e) => e?.setup?.locked, selector: SETUP_LOCKED }),
  Object.freeze({ gate: (e) => e?.setup?.newTest, selector: '[data-key="setup-new-test"]' }),
  Object.freeze({ gate: (e) => e?.run?.locked, selector: '[data-key="run-start"]' }),
  Object.freeze({ gate: (e) => e?.results?.select, selector: 'section[data-region="results"] .clash-row' }),
  Object.freeze({ gate: (e) => e?.results?.groupPresent, selector: 'section[data-region="results"] .clash-group-body' }),   // AC-GP11; never the disclosure
  Object.freeze({ gate: (e) => e?.results?.nav?.locked, selector: '[data-key="nav-prev"], [data-key="nav-next"]' }),
  Object.freeze({ gate: (e) => e?.selected?.actions?.focus, selector: '[data-key="action-focus"]' }),
  Object.freeze({ gate: (e) => e?.selected?.actions?.isolate, selector: '[data-key="action-isolate"]' }),
  Object.freeze({ gate: (e) => e?.selected?.actions?.markers, selector: '[data-key="action-markers"]' }),
  Object.freeze({ gate: (e) => e?.selected?.actions?.backToAll, selector: '[data-key="action-back-to-all"]' }),
]);

// A result row (results.js resultRow: li role=option, tabindex="0", its own click and Enter/Space keydown listeners
// dispatching NAV_SELECT) has no native `disabled`, so the manager makes it inert itself, without touching the editor
// renderer (AC-M13): FAULT_ROW_ATTR marker (CSS + guard key), aria-disabled, aria-describedby → the fault banner,
// tabindex removed (out of the tab order and not focusable; results.js uses a plain tabindex="0" on every row, no
// roving tabindex), and blurred if rebuild() just restored focus to it. Idempotent (plain attribute sets/removes).
// Reversal needs no code: results.js rebuilds every row from the ViewModel on each render (`rebuild`, results.js:128),
// so an un-faulted render yields fresh unlocked rows — pinned by the result-row DOM test.
const FAULT_ROW_ATTR = 'data-fault-locked';
const ROW_GUARD_EVENTS = Object.freeze(['click', 'keydown', 'keyup']);
const guardedHosts = new WeakSet();

function lockRow(n, faultId) {
  n.setAttribute(FAULT_ROW_ATTR, 'true');
  n.setAttribute('aria-disabled', 'true');
  n.setAttribute('aria-describedby', faultId);
  n.removeAttribute('tabindex');
  if (n.ownerDocument.activeElement === n) n.blur();
}

/**
 * Capture-phase guard on the editor host, installed once per host. DOM dispatch invokes capture listeners on the
 * target's ancestors BEFORE any listener on the target itself or any bubbling listener; results.js registers the row's
 * click/keydown handlers as ordinary (non-capture) listeners on the row `li` (dom.js el() → addEventListener(event,
 * handler)), and the editor host is a strict ancestor of every row (renderPanel(editorHost, …)). Stopping propagation
 * here therefore means no row handler runs for any click/keydown/keyup whose target is in a locked row (keyup is not
 * used by results.js today; it is guarded fail-closed). Events outside locked rows pass untouched.
 */
function guardLockedRows(host) {
  if (guardedHosts.has(host)) return;
  guardedHosts.add(host);
  const block = (e) => {
    const t = e.target;
    if (typeof t?.closest !== 'function' || t.closest(`[${FAULT_ROW_ATTR}="true"]`) === null) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  for (const type of ROW_GUARD_EVENTS) host.addEventListener(type, block, { capture: true });
}

function lockEditor(host, vm, ns) {
  const reason = vm.manager.editorLock?.reason;
  if (typeof reason !== 'string') return;
  const faultId = `${ns}-manager-fault`;
  const byFault = (g) => g?.enabled === false && g.reason === reason;
  const lock = (n) => {
    if (!('disabled' in n)) { lockRow(n, faultId); return; }
    n.disabled = true;
    n.setAttribute('aria-describedby', faultId);
  };
  for (const { gate, selector } of FAULT_LOCKS) {
    if (byFault(gate(vm.editor))) for (const n of host.querySelectorAll(selector)) lock(n);
  }
  // Banner actions name their intent as data (run.js `banner-<id>-action`); the overlay already applied the policy.
  for (const b of vm.editor?.run?.banners ?? []) {
    if (!byFault(b?.action)) continue;
    const key = `banner-${b.id}-action`;
    for (const n of host.querySelectorAll('[data-key]')) if (n.getAttribute('data-key') === key) lock(n);
  }
}

// §26.10 (M1): the managed editor's New test is disabled while a run is active (core/viewModel.js setup.newTest), but
// the editor renderer (shared with the standalone Panel, unchanged) exposes no reason. Manager-only overlay: a visible
// reason + aria-describedby, applied after lockEditor and never over a fault lock (the fault banner is then the reason).
// The setup region is rebuilt on every render, so the span never accumulates; the id check keeps it idempotent anyway.
function describeNewTest(host, vm, ns) {
  const btn = host.querySelector('[data-key="setup-new-test"]');
  if (btn === null || btn.disabled !== true || btn.hasAttribute('aria-describedby')) return;
  const reason = vm.manager.runActiveReason;
  if (vm.editor?.setup?.newTest?.enabled !== false || typeof reason !== 'string') return;
  const id = `${ns}-manager-new-test-reason`;
  let span = host.querySelector(`[id="${id}"]`);
  if (span === null) {
    span = btn.ownerDocument.createElement('span');
    span.className = 'clash-manager-reason';
    span.id = id;
    btn.after(span);
  }
  span.textContent = reason;
  btn.setAttribute('aria-describedby', id);
}

export function renderManagedPanel(root, vm, dispatch, doc) {
  ensureStyle(doc);
  if (!root.classList.contains('clash-panel-root')) root.classList.add('clash-panel-root');
  const ns = instanceNs(root);
  const header = ensurePart(root, doc, 'clash-manager-header', 0, { role: 'region', 'aria-label': 'Clash test' });
  const list = ensurePart(root, doc, 'clash-manager-list', 1, { role: 'region', 'aria-label': 'All clash tests' });
  const editorHost = ensurePart(root, doc, 'clash-manager-editor', 2, {});
  guardLockedRows(editorHost);
  const m = vm.manager;
  renderHeader(header, vm, dispatch, doc, ns);
  list.hidden = m.view !== 'list';
  editorHost.hidden = m.view !== 'editor';
  if (m.view === 'list') renderList(list, m, dispatch, doc, ns);
  else rebuild(list, doc, () => {});
  renderPanel(editorHost, vm.editor, dispatch, doc);
  silenceEditorLive(editorHost);
  lockEditor(editorHost, vm, ns);
  describeNewTest(editorHost, vm, ns);
}
