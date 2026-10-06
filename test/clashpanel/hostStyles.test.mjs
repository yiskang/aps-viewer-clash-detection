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
