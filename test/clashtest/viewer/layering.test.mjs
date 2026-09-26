// test/clashtest/viewer/layering.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importSpecifiers, stripComments, violations } from './support/layering.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const walk = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
}) : []);

test('checker: finds static, re-export, side-effect and dynamic specifiers', () => {
  const src = [
    "import a from './a.js';",
    "export { b } from '../planning/scopeDigest.js';",
    "import '../x.js';",
    "const m = await import('../../collision/index.js');",
  ].join('\n');
  assert.deepEqual(importSpecifiers(src).sort(),
    ['../../collision/index.js', '../planning/scopeDigest.js', '../x.js', './a.js']);
});

test('checker: ignores specifiers and globals inside comments and strings-in-comments', () => {
  const src = "// import x from '../identity/ModelRegistry.js'\n/* window Autodesk */ export const a = 1;";
  assert.deepEqual(violations(src), { imports: [], globals: [] });
});

test('checker: flags a forbidden import and every forbidden global (negative controls)', () => {
  const v = violations("import r from '../identity/Other.js';\nconst v = window.Autodesk.Viewing;");
  assert.deepEqual(v.imports, ['../identity/Other.js']);
  assert.ok(v.globals.includes('window') && v.globals.includes('Autodesk'));
  assert.deepEqual(violations("import q from '../../collision/CollisionWorld.js';").imports,
    ['../../collision/CollisionWorld.js']);
});

test('checker: allows exactly the permitted specifiers', () => {
  const ok = [
    "import a from './readiness.js';", "import b from '../planning/ElementEnumerator.js';",
    "import c from '../planning/scopeDigest.js';", "import d from '../util/slicer.js';",
    "import e from '../../collision/errors.js';", "import f from '../../collision/constants.js';",
    "import g from '../identity/ModelRegistry.js';",
  ].join('\n');
  assert.deepEqual(violations(ok), { imports: [], globals: [] });
});

test('real tree: every clashtest/viewer/*.js obeys the layering rules', () => {
  const files = walk(join(ROOT, 'clashtest', 'viewer')).filter((f) => f.endsWith('.js'));
  // With no production files yet this loop is vacuously true; presence of production modules is asserted by the
  // per-task scaffold test introduced in Task 3 (scaffold.test.mjs), not here.
  for (const f of files) {
    const v = violations(readFileSync(f, 'utf8'));
    assert.deepEqual(v, { imports: [], globals: [] }, relative(ROOT, f));
  }
});

test('real tree: nothing outside clashtest/viewer imports it; core never names the viewer layer', () => {
  const core = walk(join(ROOT, 'clashtest')).filter((f) => f.endsWith('.js')
    && !f.includes(`${sep}viewer${sep}`));
  for (const f of core) {
    const specs = importSpecifiers(stripComments(readFileSync(f, 'utf8')));
    assert.deepEqual(specs.filter((s) => /(^|\/)viewer(\/|$)/.test(s)), [], relative(ROOT, f));
  }
});

test('G-EC: no clashtest/viewer code reads provenance.models[].elementCount', () => {
  for (const f of walk(join(ROOT, 'clashtest', 'viewer')).filter((x) => x.endsWith('.js'))) {
    assert.ok(!/elementCount/.test(stripComments(readFileSync(f, 'utf8'))), relative(ROOT, f));
  }
});
