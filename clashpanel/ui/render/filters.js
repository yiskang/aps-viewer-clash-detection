// clashpanel/ui/render/filters.js — Region 3 FILTERS / GROUPING (spec §10, §14.4).
// Every change is dispatched IMMEDIATELY; debouncing (FILTER_DEBOUNCE_MS) and all filter/group/sort
// computation are the controller's job (AC-P4). Max gap is shown only when vm.filters.maxGap.visible (Soft).
import { el, rebuild, instanceNs } from '../dom.js';
import { INTENT } from '../../core/intents.js';

function checkbox(doc, key, label, checked, onChange) {
  return el(doc, 'label', { class: `clash-${key}` }, [
    el(doc, 'input', {
      attrs: { type: 'checkbox', 'data-key': key },
      props: { checked: Boolean(checked) },
      on: { change: (e) => onChange(e.target.checked) },
    }),
    el(doc, 'span', { text: label }),
  ]);
}

export function renderFilters(root, filters, dispatch, doc) {
  const ns = instanceNs(root);
  rebuild(root, doc, () => {
    // Single-select UI over a list-valued filter: several selected models (possible through the controller) are
    // shown honestly as one disabled, selected "Multiple models (n)" option; picking any real option replaces them.
    const multiple = filters.models.length > 1;
    const multipleOption = multiple
      ? el(doc, 'option', { attrs: { disabled: true, 'data-multiple': 'true' }, text: `Multiple models (${filters.models.length})` })
      : null;
    const modelSelect = el(doc, 'select', {
      attrs: { 'data-key': 'filter-model', 'aria-label': 'Model filter' },
      on: {
        change: (e) => {
          const option = e.target.selectedOptions[0];
          if (!option || option.hasAttribute('data-multiple')) return;
          dispatch({ type: INTENT.FILTER_MODEL, value: option.value === '' ? [] : [option.value] });
        },
      },
    }, [
      multipleOption,
      el(doc, 'option', { attrs: { value: '' }, text: 'All models' }),
      ...filters.modelOptions.map((o) => el(doc, 'option', { attrs: { value: o.modelKey }, text: o.label })),
    ]);
    if (multiple) modelSelect.selectedIndex = 0;
    else modelSelect.value = filters.models.length === 1 ? filters.models[0] : '';

    const sortSelect = el(doc, 'select', {
      attrs: { 'data-key': 'sort', 'aria-label': 'Sort' },
      on: { change: (e) => dispatch({ type: INTENT.SORT_SET, value: e.target.value }) },
    }, filters.sortOptions.map((o) => el(doc, 'option', { attrs: { value: o.value }, text: o.label })));
    sortSelect.value = filters.sort;

    const groupRadio = (value, label) => el(doc, 'label', { class: `clash-group-${value}` }, [
      el(doc, 'input', {
        attrs: { type: 'radio', name: `${ns}-group-mode`, value, 'data-key': `group-${value}` },
        props: { checked: filters.groupBy === value },
        on: { change: () => dispatch({ type: INTENT.GROUP_MODE, value }) },
      }),
      el(doc, 'span', { text: label }),
    ]);

    const g = filters.maxGap;
    root.appendChild(el(doc, 'div', { class: 'clash-filters', attrs: { 'aria-busy': filters.busy ? 'true' : null } }, [
      el(doc, 'label', { class: 'clash-filter-text' }, [
        el(doc, 'span', { text: 'Filter ' }),
        el(doc, 'input', {
          attrs: { type: 'search', 'data-key': 'filter-text' },
          props: { value: filters.text },
          on: { input: (e) => dispatch({ type: INTENT.FILTER_TEXT, value: e.target.value }) },
        }),
      ]),
      el(doc, 'label', { class: 'clash-filter-model' }, [el(doc, 'span', { text: 'Model ' }), modelSelect]),
      g.visible ? el(doc, 'div', { class: 'clash-filter-max-gap' }, [
        el(doc, 'label', {}, [
          el(doc, 'span', { text: g.max === null ? 'Max gap ' : `Max gap (≤ ${g.max}) ` }),
          el(doc, 'input', {
            attrs: { type: 'text', inputmode: 'decimal', 'data-key': 'filter-max-gap', 'aria-invalid': g.error ? 'true' : null },
            props: { value: g.value },
            on: { input: (e) => dispatch({ type: INTENT.FILTER_MAX_GAP, value: e.target.value }) },
          }),
        ]),
        g.error ? el(doc, 'p', { class: 'clash-field-error', text: g.error }) : null,
      ]) : null,
      checkbox(doc, 'filter-unverified', 'Unverified only', filters.unverified,
        (value) => dispatch({ type: INTENT.FILTER_UNVERIFIED, value })),
      checkbox(doc, 'filter-has-location', 'Has location', filters.hasLocation,
        (value) => dispatch({ type: INTENT.FILTER_HAS_LOCATION, value })),
      filters.elementOnly ? el(doc, 'p', { class: 'clash-filter-element' }, [
        el(doc, 'span', { text: `Only clashes involving ${filters.elementOnly.label} ` }),
        el(doc, 'button', {
          attrs: { type: 'button', 'data-key': 'filter-element-clear' },
          text: 'Show all elements',
          on: { click: () => dispatch({ type: INTENT.FILTER_ELEMENT, ref: null }) },
        }),
      ]) : null,
      el(doc, 'fieldset', { class: 'clash-group', attrs: { role: 'radiogroup' } }, [
        el(doc, 'legend', { text: 'Group' }),
        groupRadio('none', 'None'),
        groupRadio('element', 'Element'),
      ]),
      filters.groupingNote ? el(doc, 'p', { class: 'clash-grouping-note', text: filters.groupingNote }) : null,
      el(doc, 'label', { class: 'clash-sort' }, [el(doc, 'span', { text: 'Sort ' }), sortSelect]),
      el(doc, 'button', {
        attrs: { type: 'button', 'data-key': 'filter-clear', disabled: !filters.active },
        text: 'Clear filters',
        on: { click: () => dispatch({ type: INTENT.FILTER_CLEAR }) },
      }),
      filters.busy ? el(doc, 'p', { class: 'clash-filters-busy', text: 'Updating results…' }) : null,
    ]));
  });
}
