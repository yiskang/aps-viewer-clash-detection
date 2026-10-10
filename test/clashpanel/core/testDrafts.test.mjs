// test/clashpanel/core/testDrafts.test.mjs — spec §26.2 (a) load invariant (Work review M1) and §26.4 Duplicate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDraft, draftReduce, prepareRun } from '../../../clashpanel/core/draft.js';
import { isLoadableDraft, duplicateDraft, duplicateName } from '../../../clashpanel/core/testDrafts.js';
import { INTENT, MANAGER_INTENT } from '../../../clashpanel/core/intents.js';

const reduce = (d, ...actions) => actions.reduce(draftReduce, d);
const softAB = () => reduce(createDraft({ testId: 'T-1', testNumber: 4 }),
  { type: 'name', value: 'Walls vs ducts' }, { type: 'mode', value: 'soft' }, { type: 'clearance', value: '0.05' },
  { type: 'toggleModel', side: 'A', modelKey: 'mA' }, { type: 'setElements', side: 'B', elements: { mB: [3, 1] } },
  { type: 'basisUnit', value: 'mm' });

test('isLoadableDraft accepts exactly a frozen draft.js draft for the supplied testId (M1 invariant)', () => {
  const d = softAB();
  assert.equal(isLoadableDraft(d, 'T-1'), true);
  assert.equal(isLoadableDraft(prepareRun(d, { verifiedBasis: false }).draft, 'T-1'), true, 'a run draft (lastRun set)');
  assert.equal(isLoadableDraft(d, 'T-2'), false, 'draft.testId !== testId');
  assert.equal(isLoadableDraft(d, ''), false);
  assert.equal(isLoadableDraft(d, undefined), false);
  assert.equal(isLoadableDraft(null, 'T-1'), false);
  assert.equal(isLoadableDraft({ ...d }, 'T-1'), false, 'not frozen');
  assert.equal(isLoadableDraft(Object.freeze({ ...d, revision: 0 }), 'T-1'), false);
  assert.equal(isLoadableDraft(Object.freeze({ ...d, mode: 'clearance' }), 'T-1'), false);
  assert.equal(isLoadableDraft(Object.freeze({ ...d, basisUnit: 'furlong' }), 'T-1'), false);
  assert.equal(isLoadableDraft(Object.freeze({ ...d, setA: { modelKeys: ['mA'], elements: {} } }), 'T-1'), false, 'unfrozen side');
  assert.equal(isLoadableDraft(Object.freeze({ ...d, lastRun: Object.freeze({ definitionKey: 7, revision: 1 }) }), 'T-1'), false);
  assert.equal(isLoadableDraft(Object.freeze({ ...d, lastRun: { definitionKey: 'k', revision: 1 } }), 'T-1'), false, 'unfrozen lastRun');
});

test('isLoadableDraft requires the DEEP-frozen canonical draft.js form (Codex plan review C3)', () => {
  const d = softAB();
  const side = (modelKeys, elements) => Object.freeze({ modelKeys: Object.freeze(modelKeys), elements: Object.freeze(elements) });
  const withB = (b) => Object.freeze({ ...d, setB: b });
  assert.equal(isLoadableDraft(withB(side([], { mB: Object.freeze([1, 3]) })), 'T-1'), true, 'the canonical shape itself');
  assert.equal(isLoadableDraft(withB(side([], { mB: [1, 3] })), 'T-1'), false, 'mutable id array: a later push would bypass the editor');
  assert.equal(isLoadableDraft(withB(side([], { mB: Object.freeze([3, 1]) })), 'T-1'), false, 'unsorted ids');
  assert.equal(isLoadableDraft(withB(side([], { mB: Object.freeze([1, 1]) })), 'T-1'), false, 'duplicate ids');
  assert.equal(isLoadableDraft(withB(side([], { mB: Object.freeze([]) })), 'T-1'), false, 'empty id list (draft.js drops it)');
  assert.equal(isLoadableDraft(withB(side(['mB', 'mA'], {})), 'T-1'), false, 'unsorted model keys');
  assert.equal(isLoadableDraft(withB(side(['mA', 'mA'], {})), 'T-1'), false, 'duplicate model keys');
  assert.equal(isLoadableDraft(withB(side([], { mB: Object.freeze([-1]) })), 'T-1'), false, 'negative id');
});

test('isLoadableDraft enforces the EXACT canonical field sets and the lastRun/revision relationship (Work plan review M1)', () => {
  const d = softAB();
  const run = prepareRun(d, { verifiedBasis: false }).draft;
  assert.equal(run.lastRun.revision, run.revision, 'draft.js writes both together');
  const side = (extra = {}) => Object.freeze({ modelKeys: Object.freeze(['mA']), elements: Object.freeze({}), ...extra });
  assert.equal(isLoadableDraft(Object.freeze({ ...d, extra: 1 }), 'T-1'), false, 'extra top-level field');
  const { testCounter, ...noCounter } = d;
  void testCounter;
  assert.equal(isLoadableDraft(Object.freeze(noCounter), 'T-1'), false, 'missing top-level field');
  assert.equal(isLoadableDraft(Object.freeze({ ...d, setA: side({ note: 'x' }) }), 'T-1'), false, 'extra side field');
  assert.equal(isLoadableDraft(Object.freeze({ ...run, lastRun: Object.freeze({ ...run.lastRun, at: 1 }) }), 'T-1'), false, 'extra lastRun field');
  assert.equal(isLoadableDraft(Object.freeze({ ...run, lastRun: Object.freeze({ revision: run.revision }) }), 'T-1'), false, 'missing definitionKey');
  for (const revision of [0, -1, 1.5, '1', NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(isLoadableDraft(Object.freeze({ ...run, revision, lastRun: Object.freeze({ ...run.lastRun, revision }) }), 'T-1'), false, `revision ${String(revision)}`);
  }
  assert.equal(isLoadableDraft(Object.freeze({ ...run, lastRun: Object.freeze({ ...run.lastRun, revision: run.revision + 1 }) }), 'T-1'), false, 'lastRun.revision !== draft.revision');
  assert.equal(isLoadableDraft(Object.freeze({ ...run, revision: run.revision + 1 }), 'T-1'), false, 'draft.revision bumped without its lastRun');
  assert.equal(isLoadableDraft(Object.freeze(Object.assign(Object.create(null), d)), 'T-1'), false, 'non-plain prototype');
  assert.equal(isLoadableDraft(Object.freeze({ ...d, [Symbol('x')]: 1 }), 'T-1'), false, 'symbol key');
  const withElements = (elements) => Object.freeze({ ...d, setB: Object.freeze({ modelKeys: Object.freeze([]), elements: Object.freeze(elements) }) });
  assert.equal(isLoadableDraft(withElements({ mB: Object.freeze([1]), mC: Object.freeze([2]) }), 'T-1'), true, 'canonical key order');
  assert.equal(isLoadableDraft(withElements({ mC: Object.freeze([2]), mB: Object.freeze([1]) }), 'T-1'), false, 'element keys out of normalizeElements order');
  assert.equal(isLoadableDraft(withElements({ mB: Object.freeze([-0]) }), 'T-1'), false, '-0 id (draft.js normalizes it to 0)');
});

test('isLoadableDraft is TOTAL: hostile accessors and proxies resolve to false, never an exception, and nothing is mutated', () => {
  const d = softAB();
  const boom = () => { throw new Error('hostile'); };
  const accessor = Object.freeze(Object.defineProperty({ ...d }, 'name', { get: boom, enumerable: true }));
  const stable = Object.freeze(Object.defineProperty({ ...d }, 'name', { get: () => 'Walls vs ducts', enumerable: true }));
  const sideAccessor = Object.freeze({ ...d, setA: Object.freeze(Object.defineProperty({ elements: Object.freeze({}) }, 'modelKeys', { get: boom, enumerable: true })) });
  const traps = ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor', 'get', 'isExtensible'];   // every trap the validator exercises
  const hostile = [accessor, stable, sideAccessor, ...traps.map((trap) => new Proxy(d, { [trap]: boom }))];
  for (const draft of hostile) {
    assert.doesNotThrow(() => isLoadableDraft(draft, 'T-1'));
    assert.equal(isLoadableDraft(draft, 'T-1'), false);
  }
  const before = JSON.stringify(d);
  isLoadableDraft(d, 'T-1');
  isLoadableDraft(Object.freeze({ ...d, extra: 1 }), 'T-1');
  assert.equal(JSON.stringify(d), before, 'the validator never mutates');
});

test('duplicateDraft copies the whole setup incl. the basis attestation; new testId, revision 1, no lastRun (§26.4, AC-M7)', () => {
  const first = prepareRun(softAB(), { verifiedBasis: false }).draft;
  const src = prepareRun(reduce(first, { type: 'name', value: 'Walls v2' }), { verifiedBasis: false }).draft;
  assert.equal(src.revision, 2);
  const copy = duplicateDraft(src, { testId: 'T-9', name: 'Walls v2 copy' });
  assert.equal(copy.testId, 'T-9');
  assert.equal(copy.revision, 1);
  assert.equal(copy.lastRun, null);
  assert.equal(copy.name, 'Walls v2 copy');
  for (const k of ['mode', 'clearance', 'selfClash', 'basisUnit']) assert.equal(copy[k], src[k], k);
  assert.equal(copy.basisUnit, 'mm', 'attestation copied (CTM-3 default), still never `verified`');
  assert.deepEqual(copy.setA, src.setA);
  assert.deepEqual(copy.setB, src.setB);
  assert.equal(isLoadableDraft(copy, 'T-9'), true);
  assert.equal(src.testId, 'T-1', 'source untouched');
});

test('duplicateDraft keeps self-clash and a hidden Set B', () => {
  const src = reduce(createDraft({ testId: 'T-1' }), { type: 'toggleModel', side: 'A', modelKey: 'mA' },
    { type: 'toggleModel', side: 'B', modelKey: 'mB' }, { type: 'selfClash', value: true });
  const copy = duplicateDraft(src, { testId: 'T-2', name: 'x' });
  assert.equal(copy.selfClash, true);
  assert.deepEqual(copy.setB.modelKeys, ['mB']);
});

test('duplicateName: "<name> copy", then "copy 2", "copy 3"; truncated to the 256-character Core bound', () => {
  assert.equal(duplicateName('A', ['A']), 'A copy');
  assert.equal(duplicateName('A', ['A', 'A copy']), 'A copy 2');
  assert.equal(duplicateName('A', ['A', 'A copy', 'A copy 2']), 'A copy 3');
  const long = 'x'.repeat(256);
  const n1 = duplicateName(long, [long]);
  assert.equal(n1.length, 256);
  assert.ok(n1.endsWith(' copy'));
  const n2 = duplicateName(long, [long, n1]);
  assert.equal(n2.length, 256);
  assert.ok(n2.endsWith(' copy 2'));
});

test('MANAGER_INTENT is a separate frozen vocabulary that never collides with the editor INTENT values', () => {
  assert.ok(Object.isFrozen(MANAGER_INTENT));
  assert.deepEqual(Object.keys(MANAGER_INTENT).sort(),
    ['CANCEL', 'CONFIRM', 'CREATE', 'DELETE', 'DUPLICATE', 'OPEN', 'RESET', 'VIEW_EDITOR', 'VIEW_LIST']);
  const editor = new Set(Object.values(INTENT));
  for (const v of Object.values(MANAGER_INTENT)) assert.equal(editor.has(v), false, v);
});
