// clashpanel/ui/render/manager.js — spec §26.8–§26.10: the Clash Tests manager views around the UNCHANGED editor.
// Root children, fixed order: [0] header (active test, view switch, notice / fault / confirmation banners, one
// persistent live node), [1] Tests list (a semantic table), [2] editor host rendered by renderPanel. Manager parts are
// <div role="region">, never <section>, so the editor keeps exactly its five regions. Text only via textContent (AC-P13);
// state is never conveyed by colour alone (§26.10). Thin: renders the ViewModel, dispatches intents, holds no state.
import { el, setText, rebuild, instanceNs } from '../dom.js';
import { INTENT, MANAGER_INTENT } from '../../core/intents.js';
import { renderPanel } from './panel.js';

export const MANAGER_STYLE_ID = 'clash-manager-style';
const MANAGER_CSS = [
  '.clash-manager-table{width:100%;table-layout:fixed;border-collapse:collapse}',
  '.clash-manager-table th,.clash-manager-table td{text-align:left;vertical-align:top;padding:2px 4px;overflow-wrap:anywhere;word-break:break-word}',
  '.clash-manager-actions button{margin:0 4px 4px 0}',
  '.clash-manager-reason{display:block;font-size:smaller}',
  '.clash-manager-table tr[aria-current="true"] th{font-weight:bold}',
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

function actionCell(doc, t, i, dispatch, ns) {
  return el(doc, 'td', { class: 'clash-manager-actions' }, ACTIONS.flatMap((a) => {
    const gate = t.actions[a.id];
    const reasonId = `${ns}-manager-${i}-${a.id}-reason`;
    return [
      el(doc, 'button', {
        attrs: { type: 'button', 'data-key': `manager-${a.id}-${i}`, 'aria-label': `${a.label} “${t.name}”`, disabled: !gate.enabled, 'aria-describedby': gate.enabled ? null : reasonId },
        text: a.label, on: { click: () => dispatch({ type: a.intent, testId: t.testId }) },
      }),
      gate.enabled ? null : el(doc, 'span', { class: 'clash-manager-reason', attrs: { id: reasonId }, text: gate.reason }),
    ];
  }));
}

function row(doc, t, i, dispatch, ns) {
  const status = [t.status.text, t.resultsText, t.setupChangedSinceRun ? 'Setup changed since this run' : null, t.modelsChangedText]
    .filter((s) => typeof s === 'string' && s.length > 0).join(' · ');
  return el(doc, 'tr', { attrs: { 'data-test-id': t.testId, 'aria-current': t.active ? 'true' : null } }, [
    el(doc, 'th', { attrs: { scope: 'row' } }, [
      el(doc, 'span', { class: 'clash-manager-name', text: t.name }),
      t.active ? el(doc, 'span', { class: 'clash-manager-active-mark', text: ' (active)' }) : null,
    ]),
    el(doc, 'td', { text: t.modeText }),
    el(doc, 'td', { text: t.setA }),
    el(doc, 'td', { text: t.setB }),
    el(doc, 'td', { class: 'clash-manager-status', text: status }),
    el(doc, 'td', { class: 'clash-manager-readiness', text: t.readiness?.text ?? '' }),
    actionCell(doc, t, i, dispatch, ns),
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
    list.appendChild(el(doc, 'table', { class: 'clash-manager-table' }, [
      el(doc, 'caption', { text: 'Clash tests (this session only)' }),
      el(doc, 'thead', {}, [el(doc, 'tr', {}, ['Test', 'Mode', 'Set A', 'Set B', 'Status', 'Readiness', 'Actions'].map((h) => el(doc, 'th', { attrs: { scope: 'col' }, text: h })))]),
      el(doc, 'tbody', {}, m.tests.map((t, i) => row(doc, t, i, dispatch, ns))),
    ]));
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
