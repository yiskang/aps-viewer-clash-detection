// test/clashtest/errors.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as errors from '../../clashtest/errors.js';

// Names transcribed from spec section 18 ("Errors the engine's own API throws" + the store errors it names).
const SPEC_18_NAMES = [
  'InvalidTestDefinitionError', 'ModelBindingError', 'RunQueueFullError', 'ResultCapacityError',
  'ResultSetRetainedError', 'UnsavedResultSetError', 'ModelKeyVersionConflictError', 'IdentityConflictError',
  'AnnotationTooLargeError', 'EnumerationCancelledError', 'AnnotationSupersededError', 'AnnotationBusyError',
  'AttributeSourceError', 'UnsupportedSchemaVersionError', 'EngineDisposedError', 'RevisionConflictError',
  'TestDeletedError', 'TestArchivedError', 'RunNotTerminalError', 'ResultNotResidentError',
  'CorruptResultSetError', 'ResultSetTooLargeError', 'ReadCapacityError', 'ReadAbortedError',
  'DerivationAbortedError', 'DerivationBusyError', 'GroupingTooLargeError', 'ComparisonTooLargeError',
  'FacetRangeError', 'CorruptListingError', 'PersistenceOutcomeUnknownError', 'StoreNotConfiguredError',
  'InvalidOptionsError', 'RunIdConflictError',
];

test('the catalogue is exactly the spec section 18 error list (and every class is exported)', () => {
  assert.deepEqual(errors.ERROR_CATALOGUE.map((e) => e.name).sort(), [...SPEC_18_NAMES].sort());
  for (const name of SPEC_18_NAMES) assert.equal(typeof errors[name], 'function', name);
});

test('every class: instanceof Error and ClashTestError, name === class name, default fields, message', () => {
  for (const { name, fields } of errors.ERROR_CATALOGUE) {
    const e = new errors[name]();
    assert.ok(e instanceof Error && e instanceof errors.ClashTestError, name);
    assert.equal(e.name, name);
    assert.equal(errors[name].name, name);
    assert.ok(typeof e.message === 'string' && e.message.length > 0, name);
    for (const f of fields) assert.ok(f in e, `${name}.${f}`);
  }
});

test('typed fields round-trip and an explicit message / cause override the defaults', () => {
  const cause = new Error('root');
  const e = new errors.RevisionConflictError({ testId: 't1', latest: 3, offered: 5, message: 'custom', cause });
  assert.equal(e.testId, 't1'); assert.equal(e.latest, 3); assert.equal(e.offered, 5);
  assert.equal(e.message, 'custom'); assert.equal(e.cause, cause);
  const cap = new errors.ResultCapacityError({ cap: 4, active: ['a'], retained: ['b'], held: [{ runId: 'c', persistence: 'pending' }] });
  assert.deepEqual([cap.cap, cap.active, cap.retained, cap.held], [4, ['a'], ['b'], [{ runId: 'c', persistence: 'pending' }]]);
});

test('array defaults are per-instance (never shared between errors)', () => {
  const a = new errors.ResultCapacityError(); const b = new errors.ResultCapacityError();
  assert.notEqual(a.active, b.active);
});

test('CorruptResultSetError and CorruptListingError keep at most 20 {path, code} pairs and never values or messages', () => {
  const issues = Array.from({ length: 30 }, (_, i) => ({ path: `/results/${i}`, code: 'not-plain', message: 'secret value 42', value: 42 }));
  for (const Ctor of [errors.CorruptResultSetError, errors.CorruptListingError]) {
    const e = new Ctor({ runId: 'r1', issues });
    assert.equal(e.issues.length, 20);
    assert.deepEqual(Object.keys(e.issues[0]).sort(), ['code', 'path']);
    assert.ok(Object.isFrozen(e.issues));
  }
});

test('InvalidTestDefinitionError / InvalidOptionsError keep {path, code, message} and issuesTruncated / reason', () => {
  const e = new errors.InvalidTestDefinitionError({ issues: [{ path: '/mode', code: 'bad-enum', message: 'x' }], issuesTruncated: true });
  assert.deepEqual(e.issues, [{ path: '/mode', code: 'bad-enum', message: 'x' }]);
  assert.equal(e.issuesTruncated, true);
  const o = new errors.InvalidOptionsError({ reason: 'result-unreadable', issues: [{ path: '/maxResultsPerRun', code: 'cross-field' }] });
  assert.equal(o.reason, 'result-unreadable');
  assert.equal(o.issues[0].message, '');
});

test('UnsupportedSchemaVersionError never retains an arbitrary caller object as schemaVersion', () => {
  assert.equal(new errors.UnsupportedSchemaVersionError({ type: 'ResultSet', schemaVersion: 7, supported: 1 }).schemaVersion, 7);
  assert.equal(new errors.UnsupportedSchemaVersionError({ schemaVersion: { evil: true } }).schemaVersion, null);
  assert.equal(new errors.UnsupportedSchemaVersionError({ schemaVersion: 'x'.repeat(500) }).schemaVersion.length, 64);
});
