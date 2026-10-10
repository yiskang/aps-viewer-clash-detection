// test/clashpanel/core/testsManager.static.test.mjs — spec §26.2/§26.5/§26.6, AC-M10/AC-M12, Global Constraints 2/7.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from '../support/layering.mjs';

const read = (f) => stripComments(readFileSync(new URL(`../../../clashpanel/core/${f}`, import.meta.url), 'utf8'));
const MANAGER_FILES = ['testsManager.js', 'managerViewModel.js', 'testReadiness.js', 'testDrafts.js', 'testSummary.js'];
const BANNED = ['startRun', 'releaseResultSet', 'retainResultSet', 'getPersistenceState', 'getFreshness', 'assessNoClashClaim',
  'derivations', 'validateTest', 'getPairStatus', 'getElementStatus', 'localStorage', 'sessionStorage', 'indexedDB', 'fetch(', 'cookie'];

test('manager modules never call engine run/residency/derivation/status reads and never persist anything', () => {
  for (const f of MANAGER_FILES) for (const word of BANNED) assert.equal(read(f).includes(word), false, `${f} mentions ${word}`);
});

test('testsManager reads only port.registry and bridge.onModelLeft, and never touches the raw engine', () => {
  const src = read('testsManager.js');
  assert.deepEqual([...new Set([...src.matchAll(/\bport\s*\.\s*(\w+)/g)].map((x) => x[1]))], ['registry']);
  assert.deepEqual([...new Set([...src.matchAll(/\bbridge\s*\.\s*(\w+)/g)].map((x) => x[1]))], ['onModelLeft']);
  assert.equal(/\bengine\s*\.\s*\w+/.test(src), false);
});

test('Work plan review H1: the catalog is read only through list/onChange plus ONE keyOfModel identity read of the model-left event; no Model is kept', () => {
  const src = read('testsManager.js');
  assert.deepEqual([...new Set([...src.matchAll(/\bcatalog\s*\.\s*(\w+)/g)].map((x) => x[1]))].sort(), ['keyOfModel', 'list', 'onChange']);
  assert.equal(src.match(/\bkeyOfModel\b/g).length, 1, 'exactly one identity read');
  assert.match(src, /m\.catalog\.keyOfModel\(event\?\.model\)/, '…of the model-left event\'s model');
  assert.deepEqual(src.match(/\bevent\??\.model\b/g), ['event?.model'], 'the event\'s Model is used nowhere else (never stored)');
});

test('GC2 (transitive): the pure manager helpers make no port member read of their own; testsManager hands the catalog only to the shared resolve/label readers', () => {
  // Task 10 addition: testsManager passes the catalog object to labels.disambiguatedNames (→ catalog.displayNameFor) and
  // testReadiness.modelsChangedOf (→ resolve.resolveSide → catalog.list + registry.bindingFor) — reads GC2 allows.
  for (const f of ['managerViewModel.js', 'testReadiness.js', 'testDrafts.js', 'testSummary.js']) {
    const src = read(f);
    for (const re of [/\bcatalog\s*\??\.\s*\w+/, /\bbridge\s*\??\.\s*\w+/, /\bengine\s*\??\.\s*(?!registry\b)\w+/, /\bport\s*\??\.\s*\w+/]) {
      assert.equal(re.test(src), false, `${f} matches ${re}`);
    }
  }
  const src = read('testsManager.js');
  assert.deepEqual([...src.matchAll(/\b(\w+)\(\s*m\.catalog\b/g)].map((x) => x[1]).sort(), ['disambiguatedNames']);
  assert.deepEqual([...src.matchAll(/\bcatalog:\s*m\.catalog\b/g)].length, 1, 'modelsChangedOf is the only other holder');
});

test('G-A2: the manager\'s own editor dispatches are exactly the four-seam intents plus the existing Clear path (seams (a), (c), (e); §26.7)', () => {
  const src = read('testsManager.js');
  // Plan deviation (Task 10): Reset's Clear path goes through the guarded `editorStep(m, intent)` wrapper (Task 9), so
  // the manager's own dispatches are the literal `editor.dispatch({type: INTENT.X …})` sites PLUS the literal
  // `editorStep(m, {type: INTENT.X})` sites. The set is still pinned exactly, and every non-literal dispatch is pinned too.
  const direct = [...src.matchAll(/editor\.dispatch\(\{\s*type:\s*INTENT\.(\w+)/g)].map((x) => x[1]);
  const viaStep = [...src.matchAll(/\beditorStep\(\s*m\s*,\s*\{\s*type:\s*INTENT\.(\w+)/g)].map((x) => x[1]);
  assert.deepEqual([...new Set([...direct, ...viaStep])].sort(), ['CONFIRM_CANCEL', 'RESULTS_CLEAR', 'RESULTS_CLEAR_CONFIRMED', 'TEST_LABEL_SCOPE', 'TEST_LOAD']);
  // Every editorStep call site passes a literal INTENT (no computed intent reaches the editor through it)…
  assert.equal(src.match(/\beditorStep\(/g).length - 1, viaStep.length, 'every editorStep call (besides its definition) names a literal INTENT');
  // …and the only non-literal editor dispatches are editorStep's own body and the user-intent pass-through of dispatch(),
  // which the manager-only seams (TEST_LOAD / TEST_LABEL_SCOPE) and the fault policy gate first.
  const all = src.match(/\beditor\.dispatch\(/g).length;
  assert.equal(all - direct.length, 2, 'exactly two non-literal editor.dispatch(intent) sites');
  assert.equal(src.match(/\beditor\.dispatch\(intent\)/g).length, 2);
  assert.match(src, /async function editorStep\(m, intent\) \{\s*try \{\s*await m\.editor\.dispatch\(intent\);/);
  assert.match(src, /if \(intent\.type === INTENT\.TEST_LOAD \|\| intent\.type === INTENT\.TEST_LABEL_SCOPE\) return Promise\.resolve\(undefined\);[\s\S]*return m\.editor\.dispatch\(intent\);\n\}/);
});
