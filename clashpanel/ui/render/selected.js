// clashpanel/ui/render/selected.js — Region 5 SELECTED CLASH (spec §9.2–§9.6, §14.4).
// A disabled action shows its reason BOTH as the control's title and as visible text (Isolate is disabled with a
// reason whenever the §9.5 prerequisite does not hold). No theming, no scene-selection change: the view only dispatches.
import { el, rebuild } from '../dom.js';
import { INTENT } from '../../core/intents.js';

function sideBlock(doc, n, side, dispatch) {
  const plainId = `#${side.dbId}`;
  const text = side.label === plainId ? `${side.modelName} · ${plainId}` : `${side.modelName} · ${side.label} · ${plainId}`;
  return el(doc, 'div', { class: `clash-detail-side clash-detail-side-${n}` }, [
    el(doc, 'span', { class: 'clash-detail-term', text: `Element ${n}: ` }),
    el(doc, 'span', { class: 'clash-detail-value', text }),
    el(doc, 'button', {
      attrs: { type: 'button', 'data-key': `selected-only-${n}` },
      text: 'Show only this element',
      on: { click: () => dispatch({ type: INTENT.FILTER_ELEMENT, ref: { modelKey: side.modelKey, dbId: side.dbId } }) },
    }),
  ]);
}

function reasonText(doc, reason) {
  return reason ? el(doc, 'span', { class: 'clash-reason', text: ` ${reason}` }) : null;
}

function toggle(doc, key, label, action, onChange) {
  const disabled = !action.enabled;
  return el(doc, 'label', { class: `clash-${key}`, attrs: { title: disabled && action.reason ? action.reason : null } }, [
    el(doc, 'input', {
      attrs: { type: 'checkbox', 'data-key': key, disabled, title: disabled && action.reason ? action.reason : null },
      props: { checked: Boolean(action.checked) },
      on: { change: (e) => onChange(e.target.checked) },
    }),
    el(doc, 'span', { text: label }),
    disabled ? reasonText(doc, action.reason) : null,
  ]);
}

export function renderSelected(root, selected, dispatch, doc) {
  rebuild(root, doc, () => {
    if (!selected) {
      root.appendChild(el(doc, 'p', { class: 'clash-selected-empty', text: 'No clash selected. Select a result to see its details.' }));
      return;
    }
    const a = selected.actions;
    root.appendChild(el(doc, 'div', { class: 'clash-selected', attrs: { 'data-result-id': selected.resultId } }, [
      el(doc, 'p', { class: 'clash-selected-title', text: `Clash #${selected.ordinal}` }),
      sideBlock(doc, 1, selected.side1, dispatch),
      sideBlock(doc, 2, selected.side2, dispatch),
      selected.gap !== null && selected.gap !== undefined ? el(doc, 'p', { class: 'clash-selected-gap', text: `Gap ${selected.gap}` }) : null,
      el(doc, 'p', { class: 'clash-selected-location', text: selected.hasLocation ? '● Location available' : 'No location recorded for this clash' }),
      selected.liveness !== 'live' ? el(doc, 'p', { class: 'clash-selected-liveness', text: `Model state: ${selected.liveness}` }) : null,
      selected.notes.length > 0 ? el(doc, 'ul', { class: 'clash-selected-notes' }, selected.notes.map((n) => el(doc, 'li', { text: n }))) : null,
      selected.hiddenByFilters ? el(doc, 'p', { class: 'clash-hidden-note', text: 'This clash is hidden by the current filters.' }) : null,
      el(doc, 'div', { class: 'clash-actions' }, [
        el(doc, 'button', {
          attrs: { type: 'button', 'data-key': 'action-focus', disabled: !a.focus.enabled, title: !a.focus.enabled && a.focus.reason ? a.focus.reason : null },
          text: 'Focus',
          on: { click: () => dispatch({ type: INTENT.ACTION_FOCUS }) },
        }),
        !a.focus.enabled ? reasonText(doc, a.focus.reason) : null,
        toggle(doc, 'action-isolate', 'Isolate', a.isolate, (value) => dispatch({ type: INTENT.ACTION_ISOLATE, value })),
        toggle(doc, 'action-markers', 'Markers', a.markers, (value) => dispatch({ type: INTENT.ACTION_MARKERS, value })),
        toggle(doc, 'action-focus-on-select', 'Focus on select', { enabled: true, checked: a.focusOnSelect.checked, reason: null },
          (value) => dispatch({ type: INTENT.ACTION_FOCUS_ON_SELECT, value })),
        el(doc, 'button', {
          attrs: { type: 'button', 'data-key': 'action-back-to-all', disabled: !a.backToAll.enabled },
          text: 'Back to all',
          on: { click: () => dispatch({ type: INTENT.ACTION_BACK_TO_ALL }) },
        }),
      ]),
    ]));
  });
}
