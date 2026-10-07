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
    testId: 'T-1', revision: 1, name: 'Clash test 1', mode: 'hard', clearance: '', basisUnit: '', selfClash: false,
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
    const { definition, problems } = buildDefinition(soft(text), { verifiedBasis: true });
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
    const { definition, problems } = buildDefinition(soft(text), { verifiedBasis: true });
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
  const all = buildDefinition(reduce(fresh(), { type: 'name', value: '' }, { type: 'mode', value: 'soft' }), { verifiedBasis: true });
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
    const { definition, problems } = buildDefinition(d, { verifiedBasis: true });
    assert.deepEqual(problems, []);
    assert.deepEqual(issuesOf(definition), [], JSON.stringify(definition));
    assert.ok(Object.keys(definition).every((k) => DEFINITION_KEYS.includes(k)));
    assert.equal(definition.mode === 'clearance', 'clearance' in definition);
  }
  assert.deepEqual(issuesOf(prepareRun(drafts[0], { verifiedBasis: true }).definition), []);
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
  const soft = prepareRun(reduce(r1.draft, { type: 'mode', value: 'soft' }, { type: 'clearance', value: '0.1' }), { verifiedBasis: true });
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

// ---- measurement basis attestation (owner decision 2026-10-07) -------------------------------------------------------
import { participantKeysOf } from '../../../clashpanel/core/draft.js';

const softReady = (clearance = '0.05') => reduce(ready(), { type: 'mode', value: 'soft' }, { type: 'clearance', value: clearance });
const UNVERIFIED = { verifiedBasis: false };

test('basisUnit action: accepts "", the five units and raw; invalid or no-op values return the SAME draft', () => {
  const d = fresh();
  for (const value of ['mm', 'cm', 'm', 'in', 'ft', 'raw']) assert.equal(draftReduce(d, { type: 'basisUnit', value }).basisUnit, value);
  assert.equal(draftReduce(draftReduce(d, { type: 'basisUnit', value: 'mm' }), { type: 'basisUnit', value: '' }).basisUnit, '');
  for (const bad of ['km', 'MM', 'verified', null, undefined, 5, {}]) assert.equal(draftReduce(d, { type: 'basisUnit', value: bad }), d);
  assert.equal(draftReduce(d, { type: 'basisUnit', value: '' }), d);              // no-op
  const mm = draftReduce(d, { type: 'basisUnit', value: 'mm' });
  assert.equal(draftReduce(mm, { type: 'basisUnit', value: 'mm' }), mm);
  assert.ok(Object.isFrozen(mm));
});

test('participantKeysOf: Set A plus Set B (unless self-clash), de-duplicated and sorted', () => {
  assert.deepEqual(participantKeysOf(fresh()), []);
  assert.deepEqual(participantKeysOf(withSets(fresh(), ['mB'], ['mA'])), ['mA', 'mB']);
  assert.deepEqual(participantKeysOf(withSets(fresh(), ['mA'], ['mA'])), ['mA']);
  assert.deepEqual(participantKeysOf(reduce(withSets(fresh(), ['mA'], ['mB']), { type: 'selfClash', value: true })), ['mA']);
  assert.deepEqual(participantKeysOf(reduce(fresh(), { type: 'setElements', side: 'B', elements: { mZ: [1] } })), ['mZ']);
});

test('Soft + unverified basis + no attestation => basis-required problem and NO definition; an attestation (unit or raw) clears it', () => {
  const built = buildDefinition(softReady(), UNVERIFIED);
  assert.equal(built.definition, null);
  assert.deepEqual(built.problems, [{ control: 'basis', code: 'basis-required', text: 'Choose the units/basis for this Soft test.' }]);
  for (const value of ['mm', 'cm', 'm', 'in', 'ft', 'raw']) {
    const ok = buildDefinition(reduce(softReady(), { type: 'basisUnit', value }), UNVERIFIED);
    assert.deepEqual(ok.problems, [], value);
    assert.equal(ok.definition.mode, 'clearance');
  }
});

test('verifiedBasis defaults to FALSE (fail closed): omitted flag on a Soft draft needs an attestation; verified never asks; Hard never asks', () => {
  const omitted = buildDefinition(softReady());
  assert.equal(softReady().basisUnit, '');
  assert.equal(omitted.definition, null);
  assert.deepEqual(omitted.problems.map((p) => p.code), ['basis-required']);
  const attested = buildDefinition(reduce(softReady('0.05'), { type: 'basisUnit', value: 'mm' }));
  assert.deepEqual(attested.problems, []);
  assert.equal(attested.definition.mode, 'clearance');
  assert.equal(attested.definition.clearance, 0.05);
  assert.equal(buildDefinition(softReady(), { verifiedBasis: true }).problems.length, 0);
  assert.equal(buildDefinition(softReady(), { verifiedBasis: true }).definition.mode, 'clearance');
  assert.equal(buildDefinition(ready()).definition.mode, 'volume-overlap');
  assert.deepEqual(buildDefinition(ready()).problems, []);
  assert.equal(buildDefinition(ready(), UNVERIFIED).definition.mode, 'volume-overlap');
  assert.deepEqual(buildDefinition(ready(), UNVERIFIED).problems, []);
  assert.equal('clearance' in buildDefinition(ready(), UNVERIFIED).definition, false);
});

test('the clearance number is NEVER converted: definition.clearance is the typed number for every unit and for raw', () => {
  for (const value of ['mm', 'cm', 'm', 'in', 'ft', 'raw']) {
    const { definition } = buildDefinition(reduce(softReady('12.5'), { type: 'basisUnit', value }), UNVERIFIED);
    assert.equal(definition.clearance, 12.5, value);
    assert.equal(Object.keys(definition).some((k) => /unit|basis/i.test(k)), false, `${value}: no basis/unit leaks into the Core definition`);
  }
  assert.equal(buildDefinition(reduce(softReady('0.05'), { type: 'basisUnit', value: 'mm' }), UNVERIFIED).definition.clearance, 0.05);
});

test('the basis attestation does not change the definition key / revision: same definition with or without it', () => {
  const a = prepareRun(softReady(), UNVERIFIED.verifiedBasis === false ? { verifiedBasis: true } : undefined);
  const mm = prepareRun(reduce(softReady(), { type: 'basisUnit', value: 'mm' }), UNVERIFIED);
  const raw = prepareRun(reduce(softReady(), { type: 'basisUnit', value: 'raw' }), UNVERIFIED);
  assert.equal(definitionKey(a.definition), definitionKey(mm.definition));
  assert.equal(definitionKey(mm.definition), definitionKey(raw.definition));
});

test('invalid, zero and negative clearance are still rejected with a basis attested (basis never papers over the number)', () => {
  for (const value of ['mm', 'raw']) {
    const withBasis = (c) => buildDefinition(reduce(softReady(c), { type: 'basisUnit', value }), UNVERIFIED);
    for (const bad of ['', 'abc', '0', '-1', '-0.05', '1e999', 'NaN']) {
      const r = withBasis(bad);
      assert.equal(r.definition, null, `${value}/${bad}`);
      assert.ok(r.problems.some((p) => p.control === 'clearance'), `${value}/${bad}`);
      assert.equal(r.problems.some((p) => p.code === 'basis-required'), false, `${value}/${bad}`);
    }
  }
  // Both problems together when neither is satisfied: the number AND the basis are asked for.
  const both = buildDefinition(softReady('abc'), UNVERIFIED);
  assert.deepEqual(both.problems.map((p) => p.control), ['clearance', 'basis']);
});

test('any change of the participant set drops the attestation (toggleModel, setElements, selfClash); non-participant edits keep it', () => {
  const attested = reduce(softReady(), { type: 'basisUnit', value: 'mm' });
  assert.equal(attested.basisUnit, 'mm');
  assert.equal(reduce(attested, { type: 'toggleModel', side: 'B', modelKey: 'mB' }).basisUnit, '');                       // B removed
  assert.equal(reduce(attested, { type: 'toggleModel', side: 'B', modelKey: 'mC' }).basisUnit, '');                       // C added
  assert.equal(reduce(attested, { type: 'setElements', side: 'B', elements: { mC: [1] } }).basisUnit, '');
  assert.equal(reduce(attested, { type: 'selfClash', value: true }).basisUnit, '');                                       // {A,B} -> {A}
  // Edits that leave the participant set identical keep the attestation.
  for (const action of [{ type: 'name', value: 'Renamed' }, { type: 'clearance', value: '0.1' }, { type: 'mode', value: 'hard' },
    { type: 'toggleModel', side: 'A', modelKey: 'mB' }]) {
    assert.equal(reduce(attested, action).basisUnit, 'mm', JSON.stringify(action));
  }
  const raw = reduce(softReady(), { type: 'basisUnit', value: 'raw' });
  assert.equal(reduce(raw, { type: 'toggleModel', side: 'B', modelKey: 'mC' }).basisUnit, '');
});

test('the A+B attestation cannot carry over to A+C: after the switch buildDefinition asks for a basis again', () => {
  const attested = reduce(softReady(), { type: 'basisUnit', value: 'cm' });
  assert.equal(buildDefinition(attested, UNVERIFIED).problems.length, 0);
  const switched = reduce(attested, { type: 'toggleModel', side: 'B', modelKey: 'mB' }, { type: 'toggleModel', side: 'B', modelKey: 'mC' });
  assert.deepEqual(participantKeysOf(switched), ['mA', 'mC']);
  assert.equal(switched.basisUnit, '');
  assert.deepEqual(buildDefinition(switched, UNVERIFIED).problems.map((p) => p.code), ['basis-required']);
});

test('newTest resets basisUnit along with every other field of the draft', () => {
  const dirty = reduce(softReady('3'), { type: 'basisUnit', value: 'ft' }, { type: 'name', value: 'Custom' });
  const n = draftReduce(dirty, { type: 'newTest', testId: 'T-2' });
  assert.equal(n.basisUnit, '');
  assert.deepEqual(n, createDraft({ testId: 'T-2', testNumber: dirty.testCounter + 1 }));
});

test('prepareRun threads basisOptions: an unattested Soft draft is refused, an attested one admitted with the clearance unchanged', () => {
  assert.equal(prepareRun(softReady(), UNVERIFIED).definition, null);
  assert.deepEqual(prepareRun(softReady(), UNVERIFIED).problems.map((p) => p.code), ['basis-required']);
  const ok = prepareRun(reduce(softReady('7'), { type: 'basisUnit', value: 'in' }), UNVERIFIED);
  assert.equal(ok.definition.clearance, 7);
  assert.equal(ok.draft.basisUnit, 'in');                                           // the attestation survives admission
});

test('same modelKey in Set A and Set B (self-clash by hand): definition carries it in both selections; participants are de-duplicated', () => {
  const d = withSets(fresh(), ['S'], ['S']);
  const { definition, problems } = buildDefinition(d);
  assert.deepEqual(problems, []);
  assert.deepEqual(definition.selectionA.entries, [{ kind: 'model', modelKey: 'S' }]);
  assert.deepEqual(definition.selectionB.entries, [{ kind: 'model', modelKey: 'S' }]);
  assert.deepEqual(participantKeysOf(d), ['S']);
  assert.deepEqual(issuesOf(definition), []);
});

test('two modelKeys that share a display name stay two distinct models; the same URN loaded twice (u#1, u#2) is two models', () => {
  for (const [a, b] of [['k1', 'k2'], ['urn:x#1', 'urn:x#2']]) {
    const d = withSets(fresh(), [a], [b]);
    const { definition } = buildDefinition(d);
    assert.deepEqual(definition.selectionA.entries.map((e) => e.modelKey), [a]);
    assert.deepEqual(definition.selectionB.entries.map((e) => e.modelKey), [b]);
    assert.deepEqual(participantKeysOf(d), [a, b]);
    const toggledOff = reduce(d, { type: 'toggleModel', side: 'B', modelKey: b });
    assert.deepEqual(selectionEntriesOf(toggledOff.setA).map((e) => e.modelKey), [a]);   // A untouched
    assert.deepEqual(selectionEntriesOf(toggledOff.setB), []);
  }
});

test('mixed sets A=[S,Arch], B=[S,Mech]: shared model appears in both selections, participants are the union', () => {
  const d = withSets(fresh(), ['S', 'Arch'], ['S', 'Mech']);
  const { definition } = buildDefinition(d);
  assert.deepEqual(definition.selectionA.entries.map((e) => e.modelKey), ['Arch', 'S']);
  assert.deepEqual(definition.selectionB.entries.map((e) => e.modelKey), ['Mech', 'S']);
  assert.deepEqual(participantKeysOf(d), ['Arch', 'Mech', 'S']);
});
