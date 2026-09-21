// test/clashtest/definition/validate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureAndValidate, validateTest, ISSUE_CODES, toDefinitionError } from '../../../clashtest/definition/validate.js';
import { CAPTURE_CODES } from '../../../clashtest/util/capture.js';
import { CLASH_MODES, pairSemanticsOf } from '../../../clashtest/identity/ids.js';
import { makeDefinition } from '../support/definitions.mjs';

const codes = (r) => r.issues.map((i) => `${i.path}:${i.code}`);

test('a valid definition yields no issues and a detached capture', () => {
  const def = makeDefinition();
  const r = captureAndValidate(def);
  assert.deepEqual(r.issues, []);
  assert.equal(r.issuesTruncated, false);
  assert.notEqual(r.captured, def);
  assert.notEqual(r.captured.selectionA.entries[0].dbIds, def.selectionA.entries[0].dbIds);
  assert.deepEqual(r.captured.selectionA.entries[0].dbIds, [2, 1]); // capture does NOT normalize
});

test('V-matrix: every rule has an accept and a reject case', () => {
  const rows = [
    ['V2 wrong version',   { schemaVersion: 0 },                       ['/schemaVersion:invalid-schema-version']],
    ['V2 string version',  { schemaVersion: '1' },                     ['/schemaVersion:invalid-schema-version']],
    ['V2 newer version',   { schemaVersion: 2 },                       ['/schemaVersion:unsupported-schema-version']],
    ['V3 fractional rev',  { revision: 1.5 },                          ['/revision:not-an-integer']],
    ['V3 null name',       { name: null },                             ['/name:not-a-string']],
    ['V3 long description',{ description: 'x'.repeat(4097) },          ['/description:string-too-long']],
    ['V4 empty entries',   { selectionA: { entries: [] } },            ['/selectionA/entries:out-of-range']],
    ['V4 bad kind',        { selectionA: { entries: [{ kind: 'nope', modelKey: 'm' }] } },
                           ['/selectionA/entries/0/kind:invalid-enum']],
    ['V4 model+dbIds',     { selectionA: { entries: [{ kind: 'model', modelKey: 'm', dbIds: [1] }] } },
                           ['/selectionA/entries/0/dbIds:unknown-property']],
    ['V5 negative dbId',   { selectionA: { entries: [{ kind: 'elements', modelKey: 'm', dbIds: [-1] }] } },
                           ['/selectionA/entries/0/dbIds/0:out-of-range']],
    ['V6 bad mode',        { mode: 'nope' },                           ['/mode:invalid-enum']],
    ['V6 clearance missing', { mode: 'clearance' },                    ['/clearance:clearance-required']],
    ['V6 clearance extra', { clearance: 1 },                           ['/clearance:clearance-forbidden']],
    ['V6 clearance zero',  { mode: 'clearance', clearance: 0 },        ['/clearance:not-positive']],
    ['V6 clearance string', { mode: 'clearance', clearance: '1' },     ['/clearance:not-a-finite-number']],
    // a non-finite number never survives structural capture: P0 reports it as `not-plain` -> `not-plain-object`
    ['V6 clearance NaN',   { mode: 'clearance', clearance: NaN },      ['/clearance:not-plain-object']],
    ['V1 unknown nested',  { selectionA: { entries: [{ kind: 'model', modelKey: 'm' }], extra: 1 } },
                           ['/selectionA/extra:unknown-property']],
    ['V1 pairSemantics',   { pairSemantics: 'unordered' },             ['/pairSemantics:unknown-property']],
  ];
  for (const [label, override, expected] of rows) {
    assert.deepEqual(codes(captureAndValidate(makeDefinition(override))), expected, label);
    assert.equal(captureAndValidate(makeDefinition(override)).captured, null, `${label} captured`);
  }
  // accept case for the clearance mode
  assert.deepEqual(codes(captureAndValidate(makeDefinition({ mode: 'clearance', clearance: 0.05 }))), []);
});

test('the mode list is P1\'s CLASH_MODES: every mode is accepted and has derived pair semantics (4.5)', () => {
  for (const mode of CLASH_MODES) {
    const o = mode === 'clearance' ? { mode, clearance: 0.05 } : { mode };
    assert.deepEqual(codes(captureAndValidate(makeDefinition(o))), [], mode);
    assert.ok(['ordered', 'unordered'].includes(pairSemanticsOf(mode)), mode);
  }
});

test('every P0 CAPTURE_CODE maps to a code in ISSUE_CODES (reconciliation N4)', () => {
  const ones = (n) => Array.from({ length: n }, () => 1);
  const deep = (n) => { let v = 1; for (let i = 0; i < n; i += 1) v = { c: v }; return v; };
  const cyc = makeDefinition(); cyc.selectionA.entries[0].self = cyc;
  const extra = makeDefinition(); extra.selectionA.entries.note = 'x';
  const rows = {
    accessor: [Object.defineProperty(makeDefinition(), 'mode', { get: () => 'volume-overlap', enumerable: true }), 'accessor-property'],
    'symbol-key': [{ ...makeDefinition(), [Symbol('s')]: 1 }, 'symbol-key'],
    'sparse-array': [makeDefinition({ selectionA: { entries: [{ kind: 'elements', modelKey: 'm', dbIds: [1, , 3] }] } }), 'sparse-array'], // eslint-disable-line no-sparse-arrays
    'array-extra-key': [extra, 'array-extra-key'],
    'not-plain': [makeDefinition({ name: undefined }), 'not-plain-object'],
    cyclic: [cyc, 'cyclic'],
    unreadable: [makeDefinition({ selectionA: new Proxy({}, { ownKeys() { throw new Error('boom'); } }) }), 'unreadable'],
    depth: [makeDefinition({ name: deep(70) }), 'too-deep'],
    'too-many-nodes': [makeDefinition({ name: [ones(9000), ones(9000), ones(9000), ones(9000)] }), 'too-many-nodes'],
    'string-too-long': [makeDefinition({ name: 'x'.repeat(5000) }), 'string-too-long'],
    'array-too-long': [makeDefinition({ name: ones(10001) }), 'array-too-long'],
    gated: [makeDefinition({ schemaVersion: 3 }), 'unsupported-schema-version'],
  };
  // 'unknown-field-bytes' was added to P0 after this plan was written. It fires only when `openFieldBudget` is passed,
  // which P2 never does (P5 only), so no definition input can reach it: it is covered by the static table check below.
  const P5_ONLY = ['unknown-field-bytes'];
  assert.deepEqual(Object.keys(rows).sort(), CAPTURE_CODES.filter((c) => !P5_ONLY.includes(c)).sort(), 'a row for every reachable P0 capture code');
  for (const [captureCode, [input, expected]] of Object.entries(rows)) {
    const r = captureAndValidate(input);
    assert.ok(r.issues.some((i) => i.code === expected), `${captureCode} -> ${expected} (got ${codes(r)})`);
    for (const i of r.issues) assert.ok(ISSUE_CODES.includes(i.code), `${captureCode}: ${i.code} is not in ISSUE_CODES`);
  }
});

test('a missing required key is reported once, in DEFINITION_KEYS order', () => {
  const def = makeDefinition();
  delete def.name;
  delete def.selectionB;
  assert.deepEqual(codes(captureAndValidate(def)), ['/name:missing-required', '/selectionB:missing-required']);
});

test('V1 rejects sparse arrays, extra array own keys and non-plain nesting (structural, via captureData)', () => {
  const sparse = makeDefinition();
  sparse.selectionA.entries[0].dbIds = [1, , 3]; // eslint-disable-line no-sparse-arrays
  assert.deepEqual(codes(captureAndValidate(sparse)), ['/selectionA/entries/0/dbIds/1:sparse-array']);

  const extra = makeDefinition();
  extra.selectionA.entries.note = 'x';
  assert.deepEqual(codes(captureAndValidate(extra)), ['/selectionA/entries:array-extra-key']);

  const proto = makeDefinition({ selectionA: Object.create({ entries: [] }) });
  assert.deepEqual(codes(captureAndValidate(proto)), ['/selectionA:not-plain-object']);
});

test('all schema issues are collected in one pass, not just the first', () => {
  const r = captureAndValidate(makeDefinition({ revision: 0, name: '', mode: 'nope' }));
  assert.deepEqual(codes(r), ['/revision:out-of-range', '/name:string-too-short', '/mode:invalid-enum']);
});

test('structural issues are reported first and the schema is not run on a structurally unsound value', () => {
  const r = captureAndValidate(makeDefinition({ mode: 'nope', name: undefined }));
  assert.deepEqual(codes(r), ['/name:not-plain-object']);   // the schema issue for /mode is NOT reported yet
});

test('the issue list is capped and reports issuesTruncated', () => {
  const entries = Array.from({ length: 40 }, () => ({ kind: 'bad', modelKey: 'm' }));
  const r = captureAndValidate(makeDefinition({ selectionA: { entries } }), { limits: { maxValidationIssues: 10 } });
  assert.equal(r.issues.length, 10);
  assert.equal(r.issuesTruncated, true);
  assert.equal(r.captured, null);
});

test('an over-cap dbIds array is rejected without scanning its elements', () => {
  const dbIds = new Proxy([], {
    get(t, k) { if (k === 'length') return 20000; throw new Error('element read'); },
    getOwnPropertyDescriptor(t, k) {
      if (k === 'length') return { value: 20000, writable: true, enumerable: false, configurable: false };
      throw new Error('element read');
    },
    ownKeys() { return ['length']; },
  });
  const r = captureAndValidate(makeDefinition({
    selectionA: { entries: [{ kind: 'elements', modelKey: 'm', dbIds }] },
  }), { limits: { maxExplicitElementsPerSelection: 10000 } });
  assert.deepEqual(codes(r), ['/selectionA/entries/0/dbIds:too-many-elements']);
});

test('the running explicit-element total per selection is enforced across entries', () => {
  const limits = { maxExplicitElementsPerSelection: 4 };
  const two = (m) => ({ kind: 'elements', modelKey: m, dbIds: [1, 2, 3] });
  const r = captureAndValidate(makeDefinition({ selectionA: { entries: [two('a'), two('b')] } }), { limits });
  assert.deepEqual(codes(r), ['/selectionA/entries/1/dbIds:too-many-elements']);
});

test('a cyclic structure is a structural issue, never a stack overflow', () => {
  const def = makeDefinition();
  def.selectionA.entries[0].self = def;
  assert.deepEqual(codes(captureAndValidate(def)), ['/selectionA/entries/0/self:cyclic']);
});

test('a newer schemaVersion stops at the gate: one issue, and nothing else is read', () => {
  let calls = 0;
  const def = makeDefinition({ schemaVersion: 9, mode: 'nope' });
  Object.defineProperty(def, 'trap', { get() { calls += 1; return 1; }, enumerable: true });
  const r = captureAndValidate(def);
  assert.deepEqual(codes(r), ['/schemaVersion:unsupported-schema-version']);
  assert.deepEqual(r.gate, { key: 'schemaVersion', value: 9 });
  assert.equal(calls, 0);
});

test('-0 is normalized to 0 in the capture (5.4 needs it before digesting)', () => {
  const r = captureAndValidate(makeDefinition({ selectionA: { entries: [{ kind: 'elements', modelKey: 'm', dbIds: [-0, 1] }] } }));
  assert.equal(Object.is(r.captured.selectionA.entries[0].dbIds[0], 0), true);
});

test('validateTest returns the same issues and no capture', () => {
  const def = makeDefinition({ mode: 'nope' });
  const v = validateTest(def);
  assert.deepEqual(v, { issues: captureAndValidate(def).issues, issuesTruncated: false });
  assert.equal('captured' in v, false);
});


// Behaviour test replacing the old table-shape test: CAPTURE_TO_ISSUE is module-private, so what is pinned here is
// what a caller can observe -- every P0 capture code that P2 can trigger surfaces as a public ISSUE_CODES member.
const deep = (n) => { let o = { leaf: 1 }; for (let i = 0; i < n; i += 1) o = { o }; return o; };
const withGetter = () => { const d = makeDefinition(); Object.defineProperty(d, 'mode', { get: () => 'volume-overlap', enumerable: true }); return d; };
const withSymbol = () => { const d = makeDefinition(); d[Symbol('k')] = 1; return d; };
const withSparse = () => makeDefinition({ selectionA: { entries: [{ kind: 'elements', modelKey: 'm', dbIds: [1, , 3] }] } }); // eslint-disable-line no-sparse-arrays
const withArrayKey = () => { const ids = [1, 2]; ids.extra = 1; return makeDefinition({ selectionA: { entries: [{ kind: 'elements', modelKey: 'm', dbIds: ids }] } }); };
const withCycle = () => { const d = makeDefinition(); d.selectionA.self = d.selectionA; return d; };
const withRevoked = () => { const r = Proxy.revocable({}, {}); r.revoke(); return makeDefinition({ selectionA: r.proxy }); };
const TIGHT = { maxEntriesPerSelection: 1, maxExplicitElementsPerSelection: 1 };   // node ceiling 30, arrays capped at 1
const CAPTURE_CODE_INPUTS = {
  accessor: { input: withGetter, expect: 'accessor-property' },
  'symbol-key': { input: withSymbol, expect: 'symbol-key' },
  'sparse-array': { input: withSparse, expect: 'sparse-array' },
  'array-extra-key': { input: withArrayKey, expect: 'array-extra-key' },
  'not-plain': { input: () => makeDefinition({ selectionA: new Date(0) }), expect: 'not-plain-object' },
  cyclic: { input: withCycle, expect: 'cyclic' },
  unreadable: { input: withRevoked, expect: 'unreadable' },
  depth: { input: () => makeDefinition({ extra: deep(500) }), expect: 'too-deep' },
  'too-many-nodes': { input: () => makeDefinition({ extra: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, i])) }), limits: TIGHT, expect: 'too-many-nodes' },
  'string-too-long': { input: () => makeDefinition({ description: 'x'.repeat(5000) }), expect: 'string-too-long' },
  'array-too-long': { input: () => makeDefinition({ extra: [1, 2, 3] }), limits: TIGHT, expect: 'array-too-long' },
  gated: { input: () => makeDefinition({ schemaVersion: 9 }), expect: 'unsupported-schema-version' },
};
// Only reachable with P0's `openFieldBudget`, which no P2 caller passes; validate.js maps it to 'unreadable' (fail closed).
const UNREACHABLE_CAPTURE_CODES = ['unknown-field-bytes'];

test('every P0 CAPTURE_CODE P2 can trigger surfaces as a public ISSUE_CODES member; a NEW P0 code fails this test', () => {
  const covered = [...Object.keys(CAPTURE_CODE_INPUTS), ...UNREACHABLE_CAPTURE_CODES].sort();
  assert.deepEqual([...CAPTURE_CODES].sort(), covered, 'P0 CAPTURE_CODES changed: add an input row (or document it as unreachable)');
  for (const [captureCode, { input, limits, expect }] of Object.entries(CAPTURE_CODE_INPUTS)) {
    const r = captureAndValidate(input(), limits ? { limits } : undefined);
    const got = r.issues.map((i) => i.code);
    assert.ok(got.includes(expect), `${captureCode}: expected ${expect}, saw ${JSON.stringify(got)}`);
    for (const code of got) assert.ok(ISSUE_CODES.includes(code), `${captureCode}: ${code} is not in ISSUE_CODES`);
  }
});

test('the array-too-long capture code is refined by path into too-many-entries / too-many-elements', () => {
  const tight = { limits: TIGHT };
  const entries = [{ kind: 'model', modelKey: 'a' }, { kind: 'model', modelKey: 'b' }];
  assert.ok(captureAndValidate(makeDefinition({ selectionA: { entries } }), tight).issues.some((i) => i.code === 'too-many-entries'));
  const dbIds = [1, 2];
  assert.ok(captureAndValidate(makeDefinition({ selectionA: { entries: [{ kind: 'elements', modelKey: 'm', dbIds }] } }), tight)
    .issues.some((i) => i.code === 'too-many-elements'));
});

test('toDefinitionError picks UnsupportedSchemaVersionError only when that is the ONLY issue', () => {
  const only = toDefinitionError(captureAndValidate(makeDefinition({ schemaVersion: 9 })));
  assert.equal(only.name, 'UnsupportedSchemaVersionError');
  assert.equal(only.type, 'ClashTestDefinition');
  assert.equal(only.schemaVersion, 9);
  assert.equal(only.supported, 1);

  const mixed = toDefinitionError({
    issues: [
      { path: '/schemaVersion', code: 'unsupported-schema-version', message: 'x' },
      { path: '/mode', code: 'invalid-enum', message: 'x' },
    ],
    issuesTruncated: false,
  });
  assert.equal(mixed.name, 'InvalidTestDefinitionError');
  assert.equal(mixed.issues.length, 2);
  assert.equal(mixed.issuesTruncated, false);
});

test('toDefinitionError carries issuesTruncated through', () => {
  const entries = Array.from({ length: 40 }, () => ({ kind: 'bad', modelKey: 'm' }));
  const r = captureAndValidate(makeDefinition({ selectionA: { entries } }), { limits: { maxValidationIssues: 5 } });
  const err = toDefinitionError(r);
  assert.equal(err.issuesTruncated, true);
  assert.equal(err.issues.length, 5);
});

test('validateTest never throws for a data error, whatever the input', () => {
  const hostile = [
    null, undefined, 7, 'x', [], () => {},
    new Proxy({}, { ownKeys() { throw new Error('boom'); } }),
    new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('boom'); } }),
    (() => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy; })(),
    Object.defineProperty(makeDefinition(), 'mode', { get() { throw new Error('boom'); }, configurable: true }),
  ];
  for (const [index, input] of hostile.entries()) {
    const r = validateTest(input);
    assert.ok(Array.isArray(r.issues) && r.issues.length > 0, `issues for hostile input #${index}`);
    assert.equal(typeof r.issuesTruncated, 'boolean');
  }
});

test('issue messages never embed a caller value', () => {
  const secret = 'S'.repeat(300);
  const r = captureAndValidate(makeDefinition({ name: secret }));
  assert.deepEqual(codes(r), ['/name:string-too-long']);
  assert.equal(r.issues[0].message.includes('S'.repeat(10)), false);
});
