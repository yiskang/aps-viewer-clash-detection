// test/clashpanel/layering.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLEAN, importSpecifiers, importsClashpanel, placementProblem, resolveSpecifier, stripComments, subtreeOf, violations,
} from './support/layering.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SKIP = new Set(['node_modules', 'vendor', '.git']);
const walk = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((n) => {
  if (SKIP.has(n)) return [];
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
}) : []);
const rel = (f) => relative(ROOT, f).split(sep).join('/');

const CORE = 'clashpanel/core/draft.js';
const VIEWER = 'clashpanel/viewer/ViewerBridge.js';
const UI = 'clashpanel/ui/ClashDockingPanel.js';
const RENDER = 'clashpanel/ui/render/setup.js';
const INDEX = 'clashpanel/index.js';
const imp = (spec) => `import a from '${spec}';`;

test('checker: finds static, multi-line, re-export, star, side-effect and dynamic specifiers', () => {
  const src = [
    "import a from './a.js';",
    "export { b } from './b.js';",
    "export * from './c.js';",
    "import './d.js';",
    "import {\n  e,\n  f,\n} from './e.js';",
    "import{g}from'./g.js';",
    "const m = await import('./h.js');",
  ].join('\n');
  assert.deepEqual(importSpecifiers(src).sort(), ['./a.js', './b.js', './c.js', './d.js', './e.js', './g.js', './h.js']);
});

test('checker: ignores specifiers and identifiers that occur only in comments', () => {
  const src = "// import x from '../viewer/x.js'\n/* window Autodesk setThemingColor elementCount */ export const a = 1;";
  assert.deepEqual(violations(CORE, src), CLEAN);
});

test('checker: resolveSpecifier maps relative specifiers to repo-relative paths and leaves others null', () => {
  assert.equal(resolveSpecifier(CORE, '../../clashtest/index.js'), 'clashtest/index.js');
  assert.equal(resolveSpecifier(RENDER, '../dom.js'), 'clashpanel/ui/dom.js');
  assert.equal(resolveSpecifier(RENDER, '../../core/intents.js'), 'clashpanel/core/intents.js');
  assert.equal(resolveSpecifier(CORE, './x.js'), 'clashpanel/core/x.js');
  assert.equal(resolveSpecifier(CORE, 'node:fs'), null);
  assert.equal(resolveSpecifier(CORE, '/clashpanel/core/x.js'), null);
});

test('checker: subtreeOf and placementProblem classify every path', () => {
  assert.equal(subtreeOf('clashpanel/core/draft.js'), 'core');
  assert.equal(subtreeOf('clashpanel/viewer/isolation.js'), 'viewer');
  assert.equal(subtreeOf('clashpanel/ui/dom.js'), 'ui');
  assert.equal(subtreeOf('clashpanel/ui/render/setup.js'), 'ui');
  assert.equal(subtreeOf('clashpanel/index.js'), 'index');
  for (const bad of ['clashpanel/foo.js', 'clashpanel/core/sub/x.js', 'clashpanel/viewer/render/x.js', 'clashpanel/ui/render/deep/x.js', 'clashpanel/other/x.js']) {
    assert.equal(subtreeOf(bad), null, bad);
    assert.match(placementProblem(bad), /not in a known clashpanel subtree/, bad);
  }
  assert.equal(placementProblem('clashpanel/README.md'), null);
  for (const bad of ['clashpanel/core/x.mjs', 'clashpanel/core/x.ts', 'clashpanel/notes.md', 'clashpanel/ui/x.css', 'clashpanel/core/x.cjs']) {
    assert.match(placementProblem(bad), /only \.js modules and the root README\.md/, bad);
  }
});

test('core rule: allows siblings and the clashtest barrel only (negative controls for everything else)', () => {
  for (const ok of ['./draft.js', './constants.js', '../../clashtest/index.js']) {
    assert.deepEqual(violations(CORE, imp(ok)), CLEAN, ok);
  }
  const bad = [
    '../../clashtest/engine.js', '../../clashtest/viewer/index.js', '../../clashtest/viewer/ViewerElementEnumerator.js',
    '../../collision/index.js', '../viewer/ViewerBridge.js', '../ui/dom.js', '../index.js', 'node:fs', 'three',
    './sub/x.js', '../../clashtest/index.mjs', '../clashtest/index.js', '/clashtest/index.js', 'https://cdn.example/x.js',
  ];
  for (const spec of bad) assert.deepEqual(violations(CORE, imp(spec)).imports, [spec], spec);
});

test('viewer rule: siblings and core/constants.js only', () => {
  for (const ok of ['./isolation.js', '../core/constants.js']) assert.deepEqual(violations(VIEWER, imp(ok)), CLEAN, ok);
  for (const spec of ['../core/draft.js', '../core/index.js', '../../clashtest/index.js', '../ui/dom.js', '../index.js', '../../collision/index.js', '../../clashtest/viewer/index.js']) {
    assert.deepEqual(violations(VIEWER, imp(spec)).imports, [spec], spec);
  }
});

test('ui rule: ./*.js, ./render/*.js, core/constants.js and core/intents.js only; resolved, not spelled', () => {
  assert.deepEqual(violations(UI, imp('./render/panel.js')), CLEAN);
  assert.deepEqual(violations(UI, imp('./dom.js')), CLEAN);
  assert.deepEqual(violations(UI, imp('../core/intents.js')), CLEAN);
  for (const ok of ['../dom.js', './results.js', '../../core/constants.js', '../../core/intents.js']) {
    assert.deepEqual(violations(RENDER, imp(ok)), CLEAN, ok);
  }
  for (const spec of ['../../core/controller.js', '../../core/viewModel.js', '../../viewer/isolation.js', '../../../clashtest/index.js', '../core/constants.js', '../../index.js']) {
    assert.deepEqual(violations(RENDER, imp(spec)).imports, [spec], spec);
  }
  for (const spec of ['../core/controller.js', '../viewer/ViewerBridge.js', '../../clashtest/index.js', '../core/index.js']) {
    assert.deepEqual(violations(UI, imp(spec)).imports, [spec], spec);
  }
});

test('index rule: core barrel, viewer/*, ui/* only', () => {
  for (const ok of ['./core/index.js', './viewer/ViewerBridge.js', './viewer/viewerApi.js', './ui/ClashDockingPanel.js']) {
    assert.deepEqual(violations(INDEX, imp(ok)), CLEAN, ok);
  }
  for (const spec of ['./core/draft.js', './core/controller.js', './ui/render/panel.js', '../clashtest/index.js', '../clashtest/viewer/index.js', '../collision/index.js']) {
    assert.deepEqual(violations(INDEX, imp(spec)).imports, [spec], spec);
  }
});

test('global bans (AC-P10): core and viewer forbid Viewer/DOM globals; ui and index may use them', () => {
  for (const file of [CORE, VIEWER]) {
    const v = violations(file, [
      'const a = window.innerWidth;', 'const b = document.body;', 'const c = Autodesk.Viewing;',
      'const d = Viewing.X;', 'const e = globalThis.THREE;', "const f = globalThis['x'];",
    ].join('\n'));
    for (const name of ['window', 'document', 'Autodesk', 'Viewing', 'globalThis.THREE', 'globalThis[]']) {
      assert.ok(v.globals.includes(name), `${file}: ${name}`);
    }
  }
  assert.deepEqual(violations(CORE, 'const t = globalThis.setTimeout; const n = globalThis.performance.now();'), CLEAN);
  assert.deepEqual(violations(VIEWER, 'export function f(THREE) { return new THREE.Vector3(); }'), CLEAN);
  for (const file of [UI, RENDER, INDEX]) {
    assert.deepEqual(violations(file, 'const d = document.createElement("div"); const w = window; const A = Autodesk.Viewing;'), CLEAN, file);
  }
});

test('identifier bans (AC-P19/AC-P12): theming, Private., viewer.impl and elementCount are banned in every subtree', () => {
  const cases = {
    theming: 'v.setThemingColor(1, c, m);', 'theming-clear': 'v.clearThemingColors(m);', 'theming-get': 'v.getThemingColor(1);',
    'Private.': 'const x = Autodesk.Viewing.Private.Foo;',
    'viewer.impl': 'const o = viewer.impl.overlays;', 'viewer.impl-bracket': "const o = viewer['impl'];",
    elementCount: 'const n = model.elementCount;',
  };
  for (const file of [CORE, VIEWER, UI, RENDER, INDEX]) {
    for (const [name, src] of Object.entries(cases)) {
      const want = name.split('-')[0];
      assert.ok(violations(file, src).banned.includes(want), `${file}: ${name}`);
    }
  }
});

test('viewer-only ban: Vector3.setScalar does not exist in the injected r71 THREE', () => {
  assert.ok(violations(VIEWER, 'mesh.scale.setScalar(2);').banned.includes('setScalar'));
  assert.deepEqual(violations(CORE, 'const setScalar = 1;').banned, []);
  assert.deepEqual(violations(VIEWER, 'mesh.scale.set(2, 2, 2);'), CLEAN);
});

test('ui-only ban (AC-P13 static): markup-injection sinks are banned in ui and index, not elsewhere', () => {
  const sinks = {
    innerHTML: 'el.innerHTML = t;', outerHTML: 'el.outerHTML = t;', insertAdjacentHTML: 'el.insertAdjacentHTML("beforeend", t);',
    'document.write': 'document.write(t);', createContextualFragment: 'r.createContextualFragment(t);', DOMParser: 'new DOMParser().parseFromString(t, "text/html");',
  };
  for (const file of [UI, RENDER, INDEX]) {
    for (const [name, src] of Object.entries(sinks)) assert.ok(violations(file, src).banned.includes(name), `${file}: ${name}`);
  }
  assert.deepEqual(violations(UI, 'node.textContent = t;'), CLEAN);
  assert.deepEqual(violations(CORE, 'el.innerHTML = t;').banned, []);
  assert.deepEqual(violations(VIEWER, 'el.innerHTML = t;').banned, []);
});

test('checker: non-literal dynamic import and require() are banned everywhere', () => {
  for (const file of [CORE, VIEWER, UI, INDEX]) {
    assert.ok(violations(file, 'const m = await import(spec);').banned.includes('non-literal import()'), file);
    assert.ok(violations(file, 'const m = await import(`./${x}.js`);').banned.includes('non-literal import()'), file);
    assert.ok(violations(file, "const fs = require('fs');").banned.includes('require()'), file);
  }
  assert.deepEqual(violations(CORE, "const m = await import('./draft.js');"), CLEAN);
});

test('reverse guard checker: importsClashpanel finds relative and absolute specifiers, not comments', () => {
  assert.deepEqual(importsClashpanel("import x from '../clashpanel/index.js';"), ['../clashpanel/index.js']);
  assert.deepEqual(importsClashpanel("const m = await import('/clashpanel/core/index.js');"), ['/clashpanel/core/index.js']);
  assert.deepEqual(importsClashpanel("// import x from '../clashpanel/index.js'\nimport y from './other.js';"), []);
});

test('real tree: every file under clashpanel/ is correctly placed and obeys its subtree rules (non-vacuous)', () => {
  const files = walk(join(ROOT, 'clashpanel'));
  assert.ok(files.length > 0, 'clashpanel/ must not be empty (constants.js is created by Task 1)');
  assert.ok(files.some((f) => rel(f) === 'clashpanel/core/constants.js'));
  for (const f of files) {
    const r = rel(f);
    assert.equal(placementProblem(r), null, r);
    if (r.endsWith('.js')) assert.deepEqual(violations(r, readFileSync(f, 'utf8')), CLEAN, r);
  }
});

// H1 (host composition): the sample host module is the ONE file outside clashpanel/ allowed to import the Panel
// (its composition root, ../../clashpanel/index.js). Everything else under the frozen layers stays guarded.
const HOST_COMPOSITION_ALLOWLIST = new Map([['wwwroot/extensions/clashPanelHost.js', ['../../clashpanel/index.js']]]);

test('real tree: nothing under clashtest/, collision/ or wwwroot/ imports clashpanel (except the H1 host composition module)', () => {
  const files = ['clashtest', 'collision', 'wwwroot'].flatMap((d) => walk(join(ROOT, d))).filter((f) => /\.(m?js)$/.test(f));
  assert.ok(files.length > 50, 'the reverse guard must actually scan the frozen layers');
  for (const f of files) {
    assert.deepEqual(importsClashpanel(readFileSync(f, 'utf8')), HOST_COMPOSITION_ALLOWLIST.get(rel(f)) ?? [], rel(f));
  }
  assert.ok(files.some((f) => HOST_COMPOSITION_ALLOWLIST.has(rel(f))), 'the allow-listed host module must exist');
});

test('real tree: nobody in clashpanel/ reaches clashtest/viewer, clashtest internals or collision (explicit AC-P10 pin)', () => {
  for (const f of walk(join(ROOT, 'clashpanel')).filter((x) => x.endsWith('.js'))) {
    const r = rel(f);
    for (const spec of importSpecifiers(stripComments(readFileSync(f, 'utf8')))) {
      const resolved = resolveSpecifier(r, spec);
      assert.ok(resolved === null || !/^(clashtest\/viewer(\/|$)|collision(\/|$)|wwwroot(\/|$))/.test(resolved), `${r} -> ${spec}`);
      if (resolved?.startsWith('clashtest/')) assert.equal(resolved, 'clashtest/index.js', `${r} -> ${spec}`);
    }
  }
});
