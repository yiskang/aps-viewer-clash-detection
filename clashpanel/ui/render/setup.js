// clashpanel/ui/render/setup.js — Region 1 TEST SETUP (spec §6.1, §6.2, §14.3, §14.4).
// Pure function of vm.setup: renders it and translates DOM events into INTENT values. Holds no state.
import { el, rebuild, instanceNs } from '../dom.js';
import { INTENT } from '../../core/intents.js';

const SIDES = Object.freeze(['A', 'B']);

function modelChecklist(doc, setup, side, dispatch) {
  const items = setup.models.map((m, i) => {
    const key = m.modelKey === null ? `setup-${side}-#${i}` : `setup-${side}-${m.modelKey}`;
    const checked = side === 'A' ? m.inA : m.inB;
    const box = el(doc, 'input', {
      attrs: { type: 'checkbox', 'data-key': key, disabled: m.modelKey === null },
      props: { checked: Boolean(checked) },
      on: { change: () => dispatch({ type: INTENT.SETUP_TOGGLE_MODEL, side, modelKey: m.modelKey }) },
    });
    const state = [];
    if (!m.registered) state.push('not registered');
    else if (!m.ready) state.push('loading');
    return el(doc, 'li', { class: 'clash-model' }, [
      el(doc, 'label', {}, [box, el(doc, 'span', { class: 'clash-model-name', text: m.displayName })]),
      state.length > 0 ? el(doc, 'span', { class: 'clash-model-state', text: ` (${state.join(', ')})` }) : null,
      m.note ? el(doc, 'span', { class: 'clash-model-note', text: ` ${m.note}` }) : null,
    ]);
  });
  return el(doc, 'fieldset', { class: `clash-set clash-set-${side}`, attrs: { 'data-side': side } }, [
    el(doc, 'legend', { text: `Set ${side}` }),
    el(doc, 'ul', { class: 'clash-model-list' }, items),
    el(doc, 'button', {
      attrs: { type: 'button', 'data-key': `setup-use-selection-${side}`, disabled: !setup.useSelectionEnabled },
      text: 'Use selection',
      on: { click: () => dispatch({ type: INTENT.SETUP_USE_SELECTION, side }) },
    }),
    el(doc, 'span', { class: 'clash-set-scope', text: setup.scope[side] }),
  ]);
}

function modeSelector(doc, setup, dispatch, ns) {
  const radio = (value, label) => el(doc, 'label', { class: `clash-mode-${value}` }, [
    el(doc, 'input', {
      attrs: { type: 'radio', name: `${ns}-setup-mode`, value, 'data-key': `setup-mode-${value}` },
      props: { checked: setup.mode === value },
      on: { change: () => dispatch({ type: INTENT.SETUP_MODE, value }) },
    }),
    el(doc, 'span', { text: label }),
  ]);
  return el(doc, 'fieldset', { class: 'clash-mode', attrs: { role: 'radiogroup' } }, [
    el(doc, 'legend', { text: 'Mode' }),
    radio('hard', 'Hard'),
    radio('soft', 'Soft'),
    setup.softChecking ? el(doc, 'p', { class: 'clash-soft-pending', text: 'Checking whether Soft is available…' }) : null,
  ]);
}

// Soft measurement basis (owner decision 2026-10-07): an unverified basis never disables Soft; the user supplies it.
function basisBlock(doc, setup, dispatch) {
  const b = setup.basis;
  if (!b.required) return null;
  return el(doc, 'div', { class: 'clash-basis', attrs: { 'data-basis-state': b.state ?? 'unavailable' } }, [
    el(doc, 'p', { class: 'clash-basis-headline', text: b.headline }),
    el(doc, 'p', { class: 'clash-basis-message', text: b.message }),
    el(doc, 'label', { class: 'clash-basis-units' }, [
      el(doc, 'span', { text: 'Units ' }),
      el(doc, 'select', {
        attrs: { 'data-key': 'setup-basis', 'aria-invalid': b.error ? 'true' : null, 'aria-describedby': b.error ? 'clash-basis-error' : null },
        on: { change: (e) => dispatch({ type: INTENT.SETUP_BASIS, value: e.target.value }) },
      }, b.options.map((o) => el(doc, 'option', { attrs: { value: o.value, selected: o.value === b.value }, text: o.label }))),
    ]),
    b.status ? el(doc, 'p', { class: 'clash-basis-status', text: b.status }) : null,
    b.error ? el(doc, 'p', { class: 'clash-field-error', attrs: { id: 'clash-basis-error' }, text: b.error }) : null,
    b.detail ? el(doc, 'p', { class: 'clash-basis-detail', text: `Details: ${b.detail}` }) : null,
  ]);
}

function clearanceField(doc, setup, dispatch) {
  const c = setup.clearance;
  if (!c.visible) return null;
  return el(doc, 'div', { class: 'clash-clearance' }, [
    el(doc, 'label', {}, [
      el(doc, 'span', { text: 'Clearance ' }),
      el(doc, 'input', {
        attrs: { type: 'text', inputmode: 'decimal', 'data-key': 'setup-clearance', 'aria-invalid': c.error ? 'true' : null },
        props: { value: c.value },
        on: { input: (e) => dispatch({ type: INTENT.SETUP_CLEARANCE, value: e.target.value }) },
      }),
    ]),
    c.unitLabel ? el(doc, 'span', { class: 'clash-clearance-unit', text: ` ${c.unitLabel}` }) : null,
    c.error ? el(doc, 'p', { class: 'clash-field-error', text: c.error }) : null,
  ]);
}

// A reason already shown inline under its own control (Clearance, Units) is not repeated in the readiness list.
function validationBlock(doc, v, setup) {
  const ready = v.state === 'ready';
  const inline = (m) => (m.control === 'clearance' && m.text === setup.clearance.error) || (m.control === 'basis' && m.text === setup.basis.error);
  const messages = v.messages.filter((m) => !inline(m));
  return el(doc, 'div', { class: 'clash-validation', attrs: { 'data-state': v.state } }, [
    el(doc, 'p', { class: 'clash-validation-head', text: ready ? '✔ Ready' : '✖ Not ready' }),
    messages.length > 0
      ? el(doc, 'ul', { class: 'clash-validation-list' }, messages.map((m) => el(doc, 'li', { attrs: { 'data-control': m.control }, text: m.text })))
      : null,
    v.issuesTruncated ? el(doc, 'p', { class: 'clash-validation-truncated', text: 'More issues were found than are listed here.' }) : null,
  ]);
}

export function renderSetup(root, setup, dispatch, doc) {
  const ns = instanceNs(root);
  rebuild(root, doc, () => {
    const newTest = el(doc, 'button', {
      class: 'clash-setup-new-test',
      attrs: {
        type: 'button', 'data-key': 'setup-new-test', disabled: !setup.newTest.enabled,
        title: 'Start a blank test. Clears this setup and any results.',
      },
      text: 'New test',
      on: { click: () => dispatch({ type: INTENT.SETUP_NEW_TEST }) },
    });
    const toggle = el(doc, 'button', {
      class: 'clash-setup-toggle',
      attrs: { type: 'button', 'data-key': 'setup-toggle-collapsed', 'aria-expanded': setup.collapsed ? 'false' : 'true' },
      text: setup.collapsed ? '▸ Show setup' : '▾ Hide setup',
      on: { click: () => dispatch({ type: INTENT.SETUP_TOGGLE_COLLAPSED }) },
    });
    if (setup.collapsed) {
      root.appendChild(el(doc, 'div', { class: 'clash-setup clash-setup-collapsed', attrs: { 'data-state': 'collapsed' } }, [
        el(doc, 'div', { class: 'clash-setup-actions' }, [newTest, toggle]),
        el(doc, 'p', { class: 'clash-setup-summary', text: setup.summary }),
      ]));
      return;
    }
    root.appendChild(el(doc, 'div', { class: 'clash-setup', attrs: { 'data-state': 'expanded' } }, [
      el(doc, 'div', { class: 'clash-setup-actions' }, [newTest, toggle]),
      el(doc, 'label', { class: 'clash-name' }, [
        el(doc, 'span', { text: 'Test name ' }),
        el(doc, 'input', {
          attrs: { type: 'text', 'data-key': 'setup-name' },
          props: { value: setup.name },
          on: { input: (e) => dispatch({ type: INTENT.SETUP_NAME, value: e.target.value }) },
        }),
      ]),
      modeSelector(doc, setup, dispatch, ns),
      basisBlock(doc, setup, dispatch),
      clearanceField(doc, setup, dispatch),
      modelChecklist(doc, setup, SIDES[0], dispatch),
      setup.selfClash ? null : modelChecklist(doc, setup, SIDES[1], dispatch),
      el(doc, 'label', { class: 'clash-self-clash' }, [
        el(doc, 'input', {
          attrs: { type: 'checkbox', 'data-key': 'setup-self-clash' },
          props: { checked: setup.selfClash },
          on: { change: (e) => dispatch({ type: INTENT.SETUP_SELF_CLASH, value: e.target.checked }) },
        }),
        el(doc, 'span', { text: 'Self-clash (Set A against itself)' }),
      ]),
      validationBlock(doc, setup.validation, setup),
      setup.setupChangedSinceRun ? el(doc, 'p', { class: 'clash-setup-changed', text: 'The setup has changed since the last run.' }) : null,
    ]));
  });
}
