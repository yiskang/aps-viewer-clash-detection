// clashpanel/ui/render/panel.js — the five regions in FIXED order (spec §14.3):
// 1 TEST SETUP → 2 RUN / STATUS → 3 FILTERS / GROUPING → 4 RESULTS → 5 SELECTED CLASH. No tabs, no saved views.
// Section elements are created once and reused, so the aria-live status node inside Region 2 survives re-renders.
// Tab order is DOM order (no positive tabindex anywhere); every action is a native button/input/select.
import { el, instanceNs } from '../dom.js';
import { renderSetup } from './setup.js';
import { renderRun } from './run.js';
import { renderFilters } from './filters.js';
import { renderResults } from './results.js';
import { renderSelected } from './selected.js';

export const REGIONS = Object.freeze([
  Object.freeze({ id: 'setup', heading: '1 TEST SETUP', part: 'setup', render: renderSetup }),
  Object.freeze({ id: 'run', heading: '2 RUN / STATUS', part: 'run', render: renderRun }),
  Object.freeze({ id: 'filters', heading: '3 FILTERS / GROUPING', part: 'filters', render: renderFilters }),
  Object.freeze({ id: 'results', heading: '4 RESULTS', part: 'results', render: renderResults }),
  Object.freeze({ id: 'selected', heading: '5 SELECTED CLASH', part: 'selected', render: renderSelected }),
]);

function ensureSection(root, doc, region, index) {
  let section = null;
  for (const child of root.children) {
    if (child.getAttribute('data-region') === region.id) { section = child; break; }
  }
  if (!section) {
    section = el(doc, 'section', { class: `clash-region clash-region-${region.id}`, attrs: { 'data-region': region.id, 'aria-label': region.heading } }, [
      el(doc, 'h2', { class: 'clash-region-heading', text: region.heading }),
      el(doc, 'div', { class: 'clash-region-body' }),
    ]);
  }
  if (root.children[index] !== section) root.insertBefore(section, root.children[index] ?? null);
  return section.querySelector(':scope > .clash-region-body');
}

// Minimal layout rules so untrusted text can never widen the panel (RF-5): long unbroken names wrap anywhere and
// no flex/grid/fieldset child keeps an intrinsic min-content width. Inserted once per document as plain text of a
// <style> element (textContent — no markup parsing); the host loads no extra file.
export const PANEL_STYLE_ID = 'clash-panel-style';
export const PANEL_CSS = [
  '.clash-panel-root{box-sizing:border-box;max-width:100%;min-width:0;overflow-x:hidden}',
  '.clash-panel-root *{box-sizing:border-box;min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word}',
  '.clash-panel-root fieldset{min-inline-size:0;margin:0}',
  '.clash-panel-root select,.clash-panel-root input[type=text],.clash-panel-root input[type=search]{width:100%}',
  '.clash-panel-root ul,.clash-panel-root dl{padding-left:1em;margin:0}',
  '.clash-panel-root .clash-row{display:block}',
].join('\n');

function ensureStyle(doc) {
  if (doc.getElementById(PANEL_STYLE_ID)) return;
  const style = el(doc, 'style', { attrs: { id: PANEL_STYLE_ID }, text: PANEL_CSS });
  (doc.head ?? doc.documentElement).appendChild(style);
}

export function renderPanel(root, vm, dispatch, doc) {
  ensureStyle(doc);
  if (!root.classList.contains('clash-panel-root')) root.classList.add('clash-panel-root');
  instanceNs(root);   // one radio-name namespace for all five regions of this panel
  REGIONS.forEach((region, index) => {
    const body = ensureSection(root, doc, region, index);
    region.render(body, vm[region.part], dispatch, doc);
  });
}
