// test/clashpanel/core/draft.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDefinition, createDraft, definitionKey, draftReduce, prepareRun, selectionEntriesOf,
} from '../../../clashpanel/core/draft.js';
import { validateTest } from '../../../clashtest/index.js';

const reduce = (draft, ...actions) => actions.reduce(draftReduce, draft);
const fresh = () => createDraft({ testId: 'T-1' });
const withSets = (d, a = ['mA'], b = ['mB']) => reduce(d,
  ...a.map((modelKey) => ({ type: 'toggleModel', side: 'A', modelKey })), ...b.map((modelKey) => ({ type: 'toggleModel', side: 'B', modelKey })));
const ready = () => withSets(fresh());
const issuesOf = (definition) => validateTest(definition).issues;
const DEFINITION_KEYS = ['schemaVersion', 'testId', 'revision', 'name', 'selectionA', 'selectionB', 'mode', 'clearance'];

// ---- createDraft / reducer ------------------------------------------------------------------------------------------
test('createDraft: defaults per catalog (name "Clash test N", Hard, NO default clearance, empty sets, revision 1) and deep-frozen', () => {
  const d = fresh();
  assert.deepEqual(d, {
    testId: 'T-1', revision: 1, name: 'Clash test 1', mode: 'hard', clearance: '', selfClash: false,
    setA: { modelKeys: [], elements: {} }, setB: { modelKeys: [], elements: {} }, lastRun: null, testCounter: 1,
  });
  assert.ok(Object.isFrozen(d) && Object.isFrozen(d.setA) && Object.isFrozen(d.setA.modelKeys) && Object.isFrozen(d.setB.elements));
  assert.equal(createDraft({ testId: 'T-9', testNumber: 4 }).name, 'Clash test 4');
  assert.equal(createDraft({ testId: 'T-9', testNumber: 4 }).testCounter, 4);
  assert.throws(() => createDraft({ testId: '' }), TypeError);
  assert.throws(() => createDraft({}), TypeError);
});

test('reducer: name/mode/clearance/selfClash set the field; invalid or no-op actions return the SAME draft object', () => {
  const d = fresh();
  assert.equal(draftReduce(d, { type: 'name', value: 'Walls vs ducts' }).name, 'Walls vs ducts');
  assert.equal(draftReduce(d, { type: 'mode', value: 'soft' }).mode, 'soft');
  assert.equal(draftReduce(d, { type: 'clearance', value: '0.05' }).clearance, '0.05');
  assert.equal(draftReduce(d, { type: 'selfClash', value: true }).selfClash, true);
  for (const bad of [
    { type: 'name', value: 5 }, { type: 'mode', value: 'containment' }, { type: 'mode', value: 'clearance' }, { type: 'clearance', value: 0.5 },
    { type: 'selfClash', value: 'yes' }, { type: 'toggleModel', side: 'C', modelKey: 'x' }, { type: 'toggleModel', side: 'A', modelKey: '' },
    { type: 'setElements', side: 'A', elements: null }, { type: 'newTest' }, { type: 'unknown' }, null, undefined, 'name',
  ]) assert.equal(draftReduce(d, bad), d, JSON.stringify(bad));
  assert.equal(draftReduce(d, { type: 'name', value: d.name }), d);
  assert.equal(draftReduce(d, { type: 'mode', value: 'hard' }), d);
});

test('reducer: toggleModel adds sorted, toggles off, is per side, and never mutates the input', () => {
  const d = fresh();
  const a = reduce(d, { type: 'toggleModel', side: 'A', modelKey: 'mB' }, { type: 'toggleModel', side: 'A', modelKey: 'mA' });
  assert.deepEqual(a.setA.modelKeys, ['mA', 'mB']);
  assert.deepEqual(a.setB.modelKeys, []);
  assert.deepEqual(d.setA.modelKeys, []);
  const off = draftReduce(a, { type: 'toggleModel', side: 'A', modelKey: 'mA' });
  assert.deepEqual(off.setA.modelKeys, ['mB']);
  assert.notEqual(off, a);
  assert.ok(Object.isFrozen(off) && Object.isFrozen(off.setA.modelKeys));
});

test('reducer: setElements replaces the side map and normalizes ids (integers >= 0, unique, sorted, -0 -> 0, empty lists dropped)', () => {
  const d = draftReduce(fresh(), {
    type: 'setElements', side: 'B',
    elements: { m2: [5, 3, 3, -1, 2.5, NaN, '7', null, -0, 9007199254740993], m1: [], m3: 'nope', m4: [0] },
  });
  assert.deepEqual(d.setB.elements, { m2: [0, 3, 5], m4: [0] });
  assert.ok(Object.is(d.setB.elements.m2[0], 0));
  assert.deepEqual(Object.keys(d.setB.elements), ['m2', 'm4']);
  const replaced = draftReduce(d, { type: 'setElements', side: 'B', elements: { m9: [1] } });
  assert.deepEqual(replaced.setB.elements, { m9: [1] });
  assert.equal(draftReduce(replaced, { type: 'setElements', side: 'B', elements: { m9: [1, 1] } }), replaced);
  assert.deepEqual(d.setA.elements, {});
});

test('reducer: a hostile model key such as "__proto__" is stored as data and never corrupts the prototype', () => {
  const d = draftReduce(fresh(), { type: 'setElements', side: 'A', elements: JSON.parse('{"__proto__": [4, 2]}') });
  assert.deepEqual(Object.keys(d.setA.elements), ['__proto__']);
  assert.equal(Object.getPrototypeOf(d.setA.elements), Object.prototype);
  assert.deepEqual(selectionEntriesOf(d.setA), [{ kind: 'elements', modelKey: '__proto__', dbIds: [2, 4] }]);
  assert.equal({}.polluted, undefined);
});

test('reducer: an edit to one field reuses the already-frozen sides (a name edit never recopies a large element selection)', () => {
  const big = Array.from({ length: 5000 }, (_, i) => i);
  const d = reduce(fresh(), { type: 'setElements', side: 'A', elements: { mA: big } }, { type: 'toggleModel', side: 'B', modelKey: 'mB' });
  const n = draftReduce(d, { type: 'name', value: 'renamed' });
  assert.equal(n.setA, d.setA);
  assert.equal(n.setB, d.setB);
  assert.equal(draftReduce(d, { type: 'toggleModel', side: 'B', modelKey: 'mC' }).setA, d.setA);
});

// ---- buildDefinition ------------------------------------------------------------------------------------------------
test('buildDefinition: Hard maps to volume-overlap with EXACTLY the closed Core keys in order (no clearance, no description, no options)', () => {
  const { definition, problems } = buildDefinition(reduce(ready(), { type: 'name', value: '  Walls vs ducts  ' }));
  assert.deepEqual(problems, []);
  assert.deepEqual(Object.keys(definition), ['schemaVersion', 'testId', 'revision', 'name', 'selectionA', 'selectionB', 'mode']);
  assert.deepEqual(definition, {
    schemaVersion: 1, testId: 'T-1', revision: 1, name: 'Walls vs ducts',
    selectionA: { entries: [{ kind: 'model', modelKey: 'mA' }] }, selectionB: { entries: [{ kind: 'model', modelKey: 'mB' }] }, mode: 'volume-overlap',
  });
  assert.ok(Object.isFrozen(definition) && Object.isFrozen(definition.selectionA.entries[0]));
});

test('buildDefinition: Hard ignores whatever is in the clearance field (even invalid text) and never emits a clearance key', () => {
  for (const text of ['', 'abc', '-3', '0.5']) {
    const { definition, problems } = buildDefinition(reduce(ready(), { type: 'clearance', value: text }));
    assert.deepEqual(problems, [], text);
    assert.equal('clearance' in definition, false, text);
  }
});

test('buildDefinition: Soft maps to clearance mode and parses the clearance as a positive finite decimal (no default)', () => {
  const soft = (text) => reduce(ready(), { type: 'mode', value: 'soft' }, { type: 'clearance', value: text });
  for (const [text, value] of [['0.05', 0.05], [' 0.25 ', 0.25], ['1e-3', 0.001], ['.5', 0.5], ['5.', 5], ['+2', 2], ['12', 12], ['1E2', 100]]) {
    const { definition, problems } = buildDefinition(soft(text));
    assert.deepEqual(problems, [], text);
    assert.equal(definition.mode, 'clearance');
    assert.equal(definition.clearance, value, text);
    assert.deepEqual(Object.keys(definition), DEFINITION_KEYS);
  }
  const expected = {
    '': 'clearance-required', ' ': 'clearance-required', '0': 'clearance-not-positive', '-1': 'clearance-not-positive',
    '-0': 'clearance-not-positive', '0.0': 'clearance-not-positive', abc: 'clearance-invalid', Infinity: 'clearance-invalid',
    '-Infinity': 'clearance-invalid', NaN: 'clearance-invalid', '1e999': 'clearance-invalid', '0x10': 'clearance-invalid',
    '0b1': 'clearance-invalid', '1,5': 'clearance-invalid', '1_0': 'clearance-invalid', '1 2': 'clearance-invalid', '.': 'clearance-invalid',
  };
  for (const [text, code] of Object.entries(expected)) {
    const { definition, problems } = buildDefinition(soft(text));
    assert.equal(definition, null, JSON.stringify(text));
    assert.deepEqual(problems.map((p) => [p.control, p.code]), [['clearance', code]], JSON.stringify(text));
    assert.ok(problems[0].text.length > 0);
  }
});

test('buildDefinition: a model entry wins over element entries for the same model; entries are merged and sorted by modelKey', () => {
  const d = reduce(fresh(),
    { type: 'toggleModel', side: 'A', modelKey: 'mB' },
    { type: 'setElements', side: 'A', elements: { mB: [4, 3], mA: [9, 1, 9], mC: [2] } },
    { type: 'toggleModel', side: 'B', modelKey: 'mD' });
  assert.deepEqual(buildDefinition(d).definition.selectionA.entries, [
    { kind: 'elements', modelKey: 'mA', dbIds: [1, 9] }, { kind: 'model', modelKey: 'mB' }, { kind: 'elements', modelKey: 'mC', dbIds: [2] },
  ]);
  const untoggled = draftReduce(d, { type: 'toggleModel', side: 'A', modelKey: 'mB' });
  assert.deepEqual(selectionEntriesOf(untoggled.setA).find((e) => e.modelKey === 'mB'), { kind: 'elements', modelKey: 'mB', dbIds: [3, 4] });
});

test('buildDefinition: self-clash makes selectionB deep-equal to selectionA (separate object), ignores Set B entirely, and validates only Set A', () => {
  const d = reduce(withSets(fresh(), ['mA', 'mB'], ['mZ']), { type: 'selfClash', value: true });
  const { definition } = buildDefinition(d);
  assert.deepEqual(definition.selectionB, definition.selectionA);
  assert.notEqual(definition.selectionB, definition.selectionA);
  assert.deepEqual(definition.selectionB.entries.map((e) => e.modelKey), ['mA', 'mB']);
  const emptyA = reduce(fresh(), { type: 'toggleModel', side: 'B', modelKey: 'mB' }, { type: 'selfClash', value: true });
  assert.deepEqual(buildDefinition(emptyA).problems.map((p) => p.control), ['setA']);
  const off = draftReduce(d, { type: 'selfClash', value: false });
  assert.deepEqual(buildDefinition(off).definition.selectionB.entries, [{ kind: 'model', modelKey: 'mZ' }]);
});

test('buildDefinition: name is trimmed and 1-256 code units; problems come in control order name, clearance, setA, setB and block the definition', () => {
  const named = (name) => buildDefinition(reduce(ready(), { type: 'name', value: name }));
  assert.equal(named('x'.repeat(256)).definition.name.length, 256);
  assert.deepEqual(named('x'.repeat(257)).problems.map((p) => [p.control, p.code]), [['name', 'name-too-long']]);
  assert.deepEqual(named('   ').problems.map((p) => [p.control, p.code]), [['name', 'name-required']]);
  assert.equal(named('  ' + 'y'.repeat(256) + '  ').definition.name.length, 256);
  const all = buildDefinition(reduce(fresh(), { type: 'name', value: '' }, { type: 'mode', value: 'soft' }));
  assert.equal(all.definition, null);
  assert.deepEqual(all.problems.map((p) => [p.control, p.code]), [
    ['name', 'name-required'], ['clearance', 'clearance-required'], ['setA', 'selection-empty'], ['setB', 'selection-empty'],
  ]);
  for (const p of all.problems) assert.equal(typeof p.text, 'string');
});

test('name length is counted in UTF-16 code units exactly like Core (a surrogate pair is 2), and the real validateTest agrees at the boundary', () => {
  const named = (name) => buildDefinition(reduce(ready(), { type: 'name', value: name }));
  const ok = named('\u{1F600}'.repeat(128));
  assert.equal(ok.definition.name.length, 256);
  assert.deepEqual(issuesOf(ok.definition), []);
  assert.deepEqual(named('\u{1F600}'.repeat(129)).problems.map((p) => p.code), ['name-too-long']);
  assert.ok(issuesOf({ ...ok.definition, name: '\u{1F600}'.repeat(129) }).some((i) => i.path === '/name' && i.code === 'string-too-long'));
});

test('AC-P1: every definition the mapping produces is accepted by the REAL validateTest with no issues and no extra keys', () => {
  const drafts = [];
  for (const mode of ['hard', 'soft']) {
    for (const selfClash of [false, true]) {
      for (const shape of ['models', 'elements', 'mixed']) {
        let d = reduce(fresh(), { type: 'mode', value: mode }, { type: 'clearance', value: '0.05' }, { type: 'selfClash', value: selfClash });
        if (shape === 'models') d = withSets(d, ['mA', 'mB'], ['mC']);
        if (shape === 'elements') d = reduce(d, { type: 'setElements', side: 'A', elements: { mA: [3, 1] } }, { type: 'setElements', side: 'B', elements: { mB: [7] } });
        if (shape === 'mixed') d = reduce(d, { type: 'toggleModel', side: 'A', modelKey: 'mA' }, { type: 'setElements', side: 'A', elements: { mA: [1], mZ: [0, 8] } }, { type: 'toggleModel', side: 'B', modelKey: 'mB' });
        drafts.push(d);
      }
    }
  }
  assert.equal(drafts.length, 12);
  for (const d of drafts) {
    const { definition, problems } = buildDefinition(d);
    assert.deepEqual(problems, []);
    assert.deepEqual(issuesOf(definition), [], JSON.stringify(definition));
    assert.ok(Object.keys(definition).every((k) => DEFINITION_KEYS.includes(k)));
    assert.equal(definition.mode === 'clearance', 'clearance' in definition);
  }
  assert.deepEqual(issuesOf(prepareRun(drafts[0]).definition), []);
});

// ---- definitionKey / identity lifecycle -------------------------------------------------------------------------------
test('definitionKey: canonical over all fields including name, EXCLUDING revision; insensitive to entry and dbId order', () => {
  const base = buildDefinition(ready()).definition;
  const key = definitionKey(base);
  assert.equal(definitionKey({ ...base, revision: 99 }), key);
  assert.notEqual(definitionKey({ ...base, name: 'other' }), key);
  assert.notEqual(definitionKey({ ...base, testId: 'T-2' }), key);
  assert.notEqual(definitionKey({ ...base, mode: 'clearance', clearance: 0.1 }), key);
  const soft = { ...base, mode: 'clearance', clearance: 0.1 };
  assert.notEqual(definitionKey({ ...soft, clearance: 0.2 }), definitionKey(soft));
  const a = { ...base, selectionA: { entries: [{ kind: 'elements', modelKey: 'mB', dbIds: [3, 1] }, { kind: 'model', modelKey: 'mA' }] } };
  const b = { ...base, selectionA: { entries: [{ kind: 'model', modelKey: 'mA' }, { kind: 'elements', modelKey: 'mB', dbIds: [1, 3] }] } };
  assert.equal(definitionKey(a), definitionKey(b));
  assert.equal(definitionKey({ ...b, description: 'd' }) === definitionKey(b), false);
  assert.equal(typeof key, 'string');
});

test('lifecycle: first run keeps revision 1 and records lastRun; re-running an unchanged definition REUSES the revision', () => {
  const r1 = prepareRun(ready());
  assert.equal(r1.definition.revision, 1);
  assert.deepEqual(r1.draft.lastRun, { definitionKey: definitionKey(r1.definition), revision: 1 });
  assert.ok(Object.isFrozen(r1.draft));
  const r2 = prepareRun(r1.draft);
  assert.equal(r2.definition.revision, 1);
  assert.equal(r2.draft.revision, 1);
  assert.deepEqual(r2.definition, r1.definition);
});

test('lifecycle: any change to the normalized definition (including the NAME) bumps the revision once', () => {
  const r1 = prepareRun(ready());
  const renamed = prepareRun(draftReduce(r1.draft, { type: 'name', value: 'Another name' }));
  assert.equal(renamed.definition.revision, 2);
  const widened = prepareRun(draftReduce(r1.draft, { type: 'toggleModel', side: 'B', modelKey: 'mC' }));
  assert.equal(widened.definition.revision, 2);
  const soft = prepareRun(reduce(r1.draft, { type: 'mode', value: 'soft' }, { type: 'clearance', value: '0.1' }));
  assert.equal(soft.definition.revision, 2);
  assert.equal(prepareRun(renamed.draft).definition.revision, 2);
});

test('lifecycle: edit-and-revert BUMPS again (monotone, never reused) yet yields the same definitionKey as the first run', () => {
  const r1 = prepareRun(ready());
  const r2 = prepareRun(draftReduce(r1.draft, { type: 'name', value: 'Changed' }));
  const r3 = prepareRun(draftReduce(r2.draft, { type: 'name', value: 'Clash test 1' }));
  assert.deepEqual([r1.definition.revision, r2.definition.revision, r3.definition.revision], [1, 2, 3]);
  assert.equal(definitionKey(r3.definition), definitionKey(r1.definition));
  assert.equal(r3.draft.revision, 3);
});

test('lifecycle: editing and reverting BEFORE running does not bump (only the previous RUN is compared)', () => {
  const r1 = prepareRun(ready());
  const edited = reduce(r1.draft, { type: 'name', value: 'temp' }, { type: 'toggleModel', side: 'A', modelKey: 'mQ' }, { type: 'name', value: 'Clash test 1' }, { type: 'toggleModel', side: 'A', modelKey: 'mQ' });
  assert.equal(prepareRun(edited).definition.revision, 1);
});

test('lifecycle: prepareRun is pure; an invalid draft returns the same draft with problems; a not-adopted result recomputes the same revision', () => {
  const r1 = prepareRun(ready());
  const changed = draftReduce(r1.draft, { type: 'name', value: 'Changed' });
  const a = prepareRun(changed);
  const b = prepareRun(changed);
  assert.deepEqual(a, b);
  assert.equal(changed.revision, 1);
  assert.equal(changed.lastRun.revision, 1);
  const invalid = prepareRun(reduce(r1.draft, { type: 'name', value: '' }));
  assert.equal(invalid.definition, null);
  assert.deepEqual(invalid.problems.map((p) => p.code), ['name-required']);
  assert.deepEqual(invalid.draft.lastRun, r1.draft.lastRun);
  assert.equal(invalid.draft.revision, 1);
});

test('lifecycle: New test mints the new testId, increments the counter, resets to defaults with revision 1 and no lastRun', () => {
  const r2 = prepareRun(draftReduce(prepareRun(ready()).draft, { type: 'name', value: 'Changed' }));
  assert.equal(r2.draft.revision, 2);
  const n = draftReduce(r2.draft, { type: 'newTest', testId: 'T-2' });
  assert.equal(n.testId, 'T-2');
  assert.equal(n.testCounter, 2);
  assert.equal(n.name, 'Clash test 2');
  assert.deepEqual([n.revision, n.lastRun, n.mode, n.clearance, n.selfClash], [1, null, 'hard', '', false]);
  assert.deepEqual([n.setA, n.setB], [{ modelKeys: [], elements: {} }, { modelKeys: [], elements: {} }]);
  const again = draftReduce(n, { type: 'newTest', testId: 'T-3' });
  assert.deepEqual([again.testId, again.testCounter, again.name], ['T-3', 3, 'Clash test 3']);
  assert.notEqual(prepareRun(withSets(n)).definition.testId, r2.definition.testId);
  assert.equal(prepareRun(withSets(n)).definition.revision, 1);
});
