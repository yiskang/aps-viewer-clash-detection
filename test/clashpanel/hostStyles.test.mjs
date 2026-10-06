// test/clashpanel/hostStyles.test.mjs — static guard: the host stylesheet keeps the Clash Panel list polish, and the
// renderer still emits the class names that polish targets (so selected-row styling cannot silently disappear).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');
const css = read('wwwroot/main.css');
const rule = (selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[},\\s])${esc}(?:[^{}]*)\\{([^}]*)\\}`, 'm').exec(css);
  return m === null ? null : m[1];
};

test('main.css: .clash-row-selected has a visible highlight rule', () => {
  assert.match(css, /\.clash-row-selected\b/);
  const body = rule('.clash-panel-root .clash-row-selected:hover') ?? rule('.clash-panel-root .clash-row-selected');
  assert.ok(body !== null && /background\s*:/.test(body), '.clash-row-selected must set a background');
});

test('main.css: .clash-rows has a bounded max-height and scrolls', () => {
  const body = rule('.clash-panel-root .clash-rows');
  assert.ok(body !== null, '.clash-rows rule missing');
  assert.match(body, /max-height\s*:\s*\d+(\.\d+)?(px|vh|rem|em)\s*;/);
  assert.match(body, /overflow-y\s*:\s*auto/);
});

test('results renderer still emits clash-rows / clash-row-selected', () => {
  const src = read('clashpanel/ui/render/results.js');
  assert.match(src, /clash-row-selected/);
  assert.match(src, /['"]clash-rows['"]/);
});

test('main.css: selected / hover / disabled / focus-visible rules exist with native values', () => {
  assert.match(rule('.clash-panel-root .clash-row:hover') ?? '', /background\s*:\s*var\(--nv-row-hover\)/);
  assert.match(css, /--nv-row-hover:\s*rgba\(0,\s*191,\s*255,\s*0\.2\)/);
  assert.match(css, /--nv-row-selected:\s*#e7e7e7/);
  assert.match(rule('.clash-panel-root .clash-row-selected:hover') ?? '', /border-left:\s*3px solid #999/);
  assert.match(rule('.clash-panel-root button:disabled') ?? '', /opacity\s*:\s*0?\.4/);
  assert.match(css, /\.clash-panel-root button:focus-visible/);
});

test('main.css: legacy non-native colours are gone', () => {
  for (const legacy of ['#eef3f8', '#cfe8fb', '#c8ccd0', '#0696d7', '4px solid']) {
    const idx = css.indexOf('Clash Panel: native Viewer');
    assert.ok(idx >= 0);
    assert.equal(css.slice(idx).includes(legacy), false, `legacy value ${legacy} must not remain in the Clash Panel rules`);
  }
});

test('main.css: panel scrollbar uses the native 6px thumb', () => {
  assert.match(rule('.clash-panel-root .clash-rows::-webkit-scrollbar') ?? '', /width\s*:\s*6px/);
  assert.match(rule('.clash-panel-root .clash-rows::-webkit-scrollbar-thumb') ?? '', /rgb\(190,\s*200,\s*210\)/);
});

test('shell adapter assigns the native Viewer scroll-surface classes to the body and clears the 50px title', () => {
  const src = read('clashpanel/ui/ClashDockingPanel.js');
  assert.match(src, /docking-panel-scroll docking-panel-container-solid-color-a/);
  assert.match(src, /bodyBox\.top = '50px'/);
});

test('main.css: input focus never drops the ring for keyboard focus; disabled label opacity applies once', () => {
  assert.doesNotMatch(rule('.clash-panel-root input[type="text"]:focus') ?? '', /outline\s*:/);
  assert.match(css, /input\[type="text"\]:focus:not\(:focus-visible\)/);
  assert.match(css, /\.clash-panel-root input:focus-visible/);
  assert.match(rule('.clash-panel-root label:has(> input:disabled) > input:disabled') ?? '', /opacity\s*:\s*1/);
  assert.match(css, /fieldset\.clash-set/);
});
