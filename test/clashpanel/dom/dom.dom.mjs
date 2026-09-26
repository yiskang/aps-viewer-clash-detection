// test/clashpanel/dom/dom.dom.mjs — the ui/dom.js helpers (Task 28).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPage } from './support/harness.mjs';

test('el(): text goes through textContent, attribute values are inert, on* attributes are refused', () => withPage(async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { el } = await import('/clashpanel/ui/dom.js');
    const hostile = '<img src=x onerror=window.__pwned=1>';
    const node = el(document, 'p', { class: 'c', attrs: { title: hostile, 'data-x': '"><b>' }, text: hostile }, [el(document, 'span', { text: 'kid' }), null, false]);
    document.body.appendChild(node);
    let refused = null;
    try { el(document, 'div', { attrs: { onclick: 'alert(1)' } }); } catch (e) { refused = e.name; }
    let refusedUpper = null;
    try { el(document, 'div', { attrs: { OnMouseOver: 'x' } }); } catch (e) { refusedUpper = e.name; }
    return {
      text: node.firstChild.data, title: node.getAttribute('title'), kids: node.children.length,
      imgs: document.querySelectorAll('img').length, bolds: document.querySelectorAll('b').length, refused, refusedUpper,
    };
  });
  assert.deepEqual(r, { text: '<img src=x onerror=window.__pwned=1>', title: '<img src=x onerror=window.__pwned=1>', kids: 1, imgs: 0, bolds: 0, refused: 'TypeError', refusedUpper: 'TypeError' });
}));

test('el(): false/null attributes are omitted, true becomes a boolean attribute; props are assigned', () => withPage(async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { el } = await import('/clashpanel/ui/dom.js');
    const input = el(document, 'input', { attrs: { disabled: false, hidden: null, required: true, type: 'checkbox' }, props: { checked: true } });
    return { disabled: input.hasAttribute('disabled'), hidden: input.hasAttribute('hidden'), required: input.getAttribute('required'), checked: input.checked };
  });
  assert.deepEqual(r, { disabled: false, hidden: false, required: '', checked: true });
}));

test('findByKey(): matches data-key literally (no selector parsing of untrusted keys)', () => withPage(async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { el, findByKey } = await import('/clashpanel/ui/dom.js');
    const weird = 'g|"]*,<x>';
    const root = el(document, 'div', {}, [el(document, 'button', { attrs: { 'data-key': 'a' } }), el(document, 'button', { attrs: { 'data-key': weird }, text: 'w' })]);
    return { hit: findByKey(root, weird)?.textContent ?? null, miss: findByKey(root, 'nope') };
  });
  assert.deepEqual(r, { hit: 'w', miss: null });
}));

test('rebuild(): replaces children, restores focus + caret by data-key, leaves focus alone when outside root', () => withPage(async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { el, rebuild } = await import('/clashpanel/ui/dom.js');
    const root = el(document, 'div');
    const outside = el(document, 'input', { attrs: { 'data-key': 'outside' } });
    document.body.append(root, outside);
    const build = (v) => () => root.appendChild(el(document, 'input', { attrs: { 'data-key': 'k' }, props: { value: v } }));
    rebuild(root, document, build('hello'));
    const first = root.firstChild;
    first.focus();
    first.setSelectionRange(2, 4);
    rebuild(root, document, build('hello world'));
    const a = { replaced: root.firstChild !== first, count: root.children.length, key: document.activeElement.getAttribute('data-key'), s: document.activeElement.selectionStart, e: document.activeElement.selectionEnd };
    outside.focus();
    rebuild(root, document, build('x'));
    return { ...a, stillOutside: document.activeElement === outside };
  });
  assert.deepEqual(r, { replaced: true, count: 1, key: 'k', s: 2, e: 4, stillOutside: true });
}));

test('clear() and setText() are total (null/undefined become empty text)', () => withPage(async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { el, clear, setText } = await import('/clashpanel/ui/dom.js');
    const n = el(document, 'div', {}, [el(document, 'span'), el(document, 'span')]);
    clear(n);
    const kids = n.childNodes.length;
    setText(n, null);
    const a = n.textContent;
    setText(n, 42);
    return { kids, a, b: n.textContent };
  });
  assert.deepEqual(r, { kids: 0, a: '', b: '42' });
}));
