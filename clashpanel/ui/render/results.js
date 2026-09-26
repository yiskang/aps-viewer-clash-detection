// clashpanel/ui/render/results.js — Region 4 RESULTS (spec §8, §9.3, §12, §14.4 state coverage).
// Renders EXACTLY vm.results.rows (the controller already sliced one page, PAGE_SIZE); never more. Rows are
// focusable (tabindex 0) and Enter/Space select; the selected occurrence carries aria-selected="true".
import { el, rebuild } from '../dom.js';
import { INTENT } from '../../core/intents.js';

const LIST_STATES = new Set(['list', 'grouping-unavailable']);

function sideNodes(doc, side, cls) {
  const plainId = `#${side.dbId}`;
  return el(doc, 'span', { class: `clash-side ${cls}` }, [
    el(doc, 'span', { class: 'clash-chip', text: side.modelName }),
    el(doc, 'span', { class: 'clash-sep', text: ' · ' }),
    el(doc, 'span', { class: 'clash-label', text: side.label }),
    side.label === plainId ? null : el(doc, 'span', { class: 'clash-dbid', text: ` · ${plainId}` }),
  ]);
}

function resultRow(doc, row, dispatch) {
  const select = () => dispatch({ type: INTENT.NAV_SELECT, resultId: row.resultId, groupId: row.groupId ?? null });
  return el(doc, 'li', {
    class: row.selected ? 'clash-row clash-row-selected' : 'clash-row',
    attrs: { role: 'option', tabindex: '0', 'data-key': row.key, 'aria-selected': row.selected ? 'true' : 'false' },
    on: {
      click: select,
      keydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); }
      },
    },
  }, [
    el(doc, 'span', { class: 'clash-ordinal', text: `#${row.ordinal} ` }),
    sideNodes(doc, row.side1, 'clash-side-1'),
    el(doc, 'span', { class: 'clash-arrow', attrs: { 'aria-label': 'clashes with' }, text: ' ↔ ' }),
    sideNodes(doc, row.side2, 'clash-side-2'),
    row.gap !== null && row.gap !== undefined ? el(doc, 'span', { class: 'clash-gap', text: ` ${row.gap}` }) : null,
    ...row.badges.map((b) => el(doc, 'span', { class: 'clash-badge', text: ` ${b}` })),
    row.liveness !== 'live' ? el(doc, 'span', { class: 'clash-liveness', text: ` (${row.liveness})` }) : null,
  ]);
}

function groupRow(doc, row, dispatch) {
  const countText = row.filteredCount !== row.count ? `${row.filteredCount} of ${row.count}` : `${row.count}`;
  return el(doc, 'li', { class: 'clash-group-row', attrs: { role: 'presentation' } }, [
    el(doc, 'button', {
      attrs: { type: 'button', 'data-key': row.key, 'aria-expanded': row.expanded ? 'true' : 'false' },
      on: { click: () => dispatch({ type: INTENT.GROUP_TOGGLE, groupId: row.groupId }) },
    }, [
      el(doc, 'span', { class: 'clash-group-twisty', text: row.expanded ? '▾ ' : '▸ ' }),
      el(doc, 'span', { class: 'clash-group-label', text: row.label }),
      el(doc, 'span', { class: 'clash-group-count', text: ` (${countText})` }),
    ]),
  ]);
}

function navBlock(doc, results, dispatch) {
  const { nav, page } = results;
  const pageCount = Math.max(1, page.count);
  return el(doc, 'div', { class: 'clash-nav' }, [
    el(doc, 'button', {
      attrs: { type: 'button', 'data-key': 'nav-prev', disabled: !nav.canPrev },
      text: '◀ Prev',
      on: { click: () => dispatch({ type: INTENT.NAV_PREV }) },
    }),
    el(doc, 'button', {
      attrs: { type: 'button', 'data-key': 'nav-next', disabled: !nav.canNext },
      text: 'Next ▶',
      on: { click: () => dispatch({ type: INTENT.NAV_NEXT }) },
    }),
    nav.label ? el(doc, 'span', { class: 'clash-nav-label', text: ` ${nav.label} ` }) : null,
    el(doc, 'span', { class: 'clash-page' }, [
      el(doc, 'button', {
        attrs: { type: 'button', 'data-key': 'page-prev', 'aria-label': 'Previous page', disabled: page.index <= 0 },
        text: '‹',
        on: { click: () => dispatch({ type: INTENT.NAV_PAGE, page: page.index - 1 }) },
      }),
      el(doc, 'span', { class: 'clash-page-label', text: ` ${page.index + 1} / ${pageCount} ` }),
      el(doc, 'button', {
        attrs: { type: 'button', 'data-key': 'page-next', 'aria-label': 'Next page', disabled: page.index >= pageCount - 1 },
        text: '›',
        on: { click: () => dispatch({ type: INTENT.NAV_PAGE, page: page.index + 1 }) },
      }),
    ]),
  ]);
}

export function renderResults(root, results, dispatch, doc) {
  rebuild(root, doc, () => {
    const box = el(doc, 'div', { class: 'clash-results', attrs: { 'data-state': results.state, 'data-view': results.view } });
    root.appendChild(box);
    if (results.message) box.appendChild(el(doc, 'p', { class: 'clash-results-message', text: results.message }));
    if (results.lines.length > 0) {
      box.appendChild(el(doc, 'ul', { class: 'clash-results-lines' }, results.lines.map((l) => el(doc, 'li', { text: l }))));
    }
    if (results.state === 'empty-filtered') {
      box.appendChild(el(doc, 'button', {
        attrs: { type: 'button', 'data-key': 'results-clear-filters' },
        text: 'Clear filters',
        on: { click: () => dispatch({ type: INTENT.FILTER_CLEAR }) },
      }));
    }
    if (results.multiValuedNote) box.appendChild(el(doc, 'p', { class: 'clash-multivalued-note', text: results.multiValuedNote }));
    if (results.hiddenByFiltersNote) {
      box.appendChild(el(doc, 'p', { class: 'clash-hidden-note', text: 'The selected clash is hidden by the current filters.' }));
    }
    if (!LIST_STATES.has(results.state)) return;
    box.appendChild(el(doc, 'ul', {
      class: 'clash-rows',
      attrs: { role: 'listbox', 'aria-label': 'Clash results' },
    }, results.rows.map((row) => (row.kind === 'group' ? groupRow(doc, row, dispatch) : resultRow(doc, row, dispatch)))));
    box.appendChild(navBlock(doc, results, dispatch));
  });
}
