// test/clashpanel/managerLayout.static.test.mjs — plan Addendum A / spec §26.14 AC-UI9, AC-UI12: source-shape guards for
// the Tests-list presentation. Offline (no browser). The production diff boundary itself (manager.js only) is verified
// with `git diff --stat` and recorded in the package final report; these assertions pin what must stay true of the files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const manager = read('clashpanel', 'ui', 'render', 'manager.js');

// The glyph CSS (and only it) legitimately contains `<svg …>` inside CSS data-URIs.
const withoutCss = manager.replace(/\/\/ Action glyphs[\s\S]*?\]\.join\('\\n'\);/, '/* glyph + css */');

test('AC-UI12: the manager renderer builds no HTML/SVG/emoji — icons exist only as CSS data-URI masks', () => {
  assert.notEqual(withoutCss, manager, 'MANAGER_CSS block located');
  for (const banned of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'createElementNS', 'DOMParser', '<svg', 'new Image', 'document.write']) {
    assert.equal(withoutCss.includes(banned), false, `${banned} must not appear outside MANAGER_CSS`);
  }
  assert.equal(/\p{Extended_Pictographic}/u.test(manager), false, 'no emoji code points');
  assert.match(manager, /url\("data:image\/svg\+xml;utf8,<svg xmlns='http:\/\/www\.w3\.org\/2000\/svg'/);
  assert.match(manager, /-webkit-mask-image:\$\{g\};mask-image:\$\{g\}/, 'both the prefixed and the standard mask property');
});

test('AC-UI8/9: the manager renderer never writes or observes panel geometry; the shell geometry strings are intact; the host stylesheet has no manager rules', () => {
  for (const banned of ['.style.width', '.style.minWidth', '.style.maxWidth', 'style.cssText', 'setSize', 'ResizeObserver', 'resizeToContent', 'getContainerBoundingRect', 'addFooter', 'createFooter']) {
    assert.equal(manager.includes(banned), false, `${banned} must not appear in manager.js`);
  }
  const shell = read('clashpanel', 'ui', 'ClashDockingPanel.js');
  for (const s of ["box.width = 'min(460px, 90vw)'", "box.minWidth = 'min(340px, 90vw)'", "box.maxWidth = '90vw'", "box.resize = 'none'"]) assert.ok(shell.includes(s), s);
  assert.equal(/clash-manager/.test(read('wwwroot', 'main.css')), false, 'icon masks and list rules live in MANAGER_CSS, not main.css');
});

test('AC-UI1/10: the data-key scheme, aria-label shape and gate wiring of the action buttons are unchanged; no table elements are built', () => {
  assert.match(manager, /'data-key': `manager-\$\{a\.id\}-\$\{i\}`/);
  assert.match(manager, /'aria-label': `\$\{a\.label\} “\$\{t\.name\}”`/);
  assert.match(manager, /disabled: !gate\.enabled/);
  for (const tag of ["'table'", "'thead'", "'tbody'", "'tr'", "'th'", "'td'", "'caption'"]) assert.equal(manager.includes(`el(doc, ${tag}`), false, `no ${tag}`);
});

test('responsive CSS is driven by the list width (flex-wrap/container query), never viewport media queries', () => {
  assert.equal(/@media/.test(manager), false);
  assert.match(manager, /@container/);
  assert.match(manager, /flex-wrap:wrap/);
});
