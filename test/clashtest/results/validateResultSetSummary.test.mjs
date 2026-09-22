// test/clashtest/results/validateResultSetSummary.test.mjs
//
// Direct tests for `validateResultSetSummary` (§13.5's closed `ResultSetSummary` listing-page row
// shape). Not part of Task P5.5's own prescribed acceptance test file (the brief's own text never
// authors this function's schema despite declaring it as one of the task's `Produces` -- see
// `resultSetSchema.js`'s own doc comment on `validateResultSetSummary` and the task report) --
// added per an independent codex-review finding ("Testing Gaps": "`validateResultSetSummary` has
// no direct tests for valid summaries, closed fields, duplicate models, caps, or issue truncation").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateResultSetSummary } from '../../../clashtest/results/validateResultSet.js';
import { ENGINE_LIMIT_CEILINGS } from '../../../clashtest/options.js';

const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;

function validSummary(over = {}) {
  return {
    runId: 'run-1',
    testRef: { testId: 'T1', revision: 1, semanticDigest: `sha256:${'a'.repeat(64)}` },
    status: 'completed',
    coverage: 'full',
    integrity: 'clean',
    environmentSensitive: false,
    counts: { results: 1, units: 1, pairSpaceTotal: 10 },
    serializedBytes: 512,
    digests: { digestVersion: 1, pairSetDigest: ZERO_DIGEST, ledgerDigest: ZERO_DIGEST },
    models: [{ modelKey: 'urn:model-a', modelVersion: 'v1' }],
    startedAt: '2026-09-22T00:00:00.000Z',
    finishedAt: '2026-09-22T00:00:01.000Z',
    ...over,
  };
}

test('a well-formed summary validates with no issues', () => {
  assert.deepEqual(validateResultSetSummary(validSummary(), {}), { ok: true, issues: [] });
});

test('a non-object root is container-invalid', () => {
  for (const bad of [null, undefined, 42, 'x', [], true]) {
    const { ok, issues } = validateResultSetSummary(bad, {});
    assert.equal(ok, false, String(bad));
    assert.ok(issues.some((i) => i.code === 'container-invalid'), String(bad));
  }
});

test('an unknown top-level key is unknown-field-closed-type (the shape is CLOSED)', () => {
  const { ok, issues } = validateResultSetSummary(validSummary({ vendorNote: 'x' }), {});
  assert.equal(ok, false);
  assert.ok(issues.some((i) => i.code === 'unknown-field-closed-type' && i.path === '/vendorNote'));
});

test('each required top-level field is missing-field when absent', () => {
  for (const key of ['runId', 'testRef', 'status', 'coverage', 'integrity',
    'environmentSensitive', 'counts', 'serializedBytes', 'digests', 'models', 'startedAt', 'finishedAt']) {
    const s = validSummary();
    delete s[key];
    const { ok, issues } = validateResultSetSummary(s, {});
    assert.equal(ok, false, key);
    assert.ok(issues.some((i) => i.code === 'missing-field' && i.path === `/${key}`), `${key}: ${JSON.stringify(issues)}`);
  }
});

test('status/coverage/integrity are the SAME closed enums RunOutcome declares', () => {
  const bad = validSummary({ status: 'in-progress' });
  assert.ok(validateResultSetSummary(bad, {}).issues.some((i) => i.code === 'enum-invalid' && i.path === '/status'));
});

test('counts is a closed {results, units, pairSpaceTotal} object of non-negative safe integers', () => {
  assert.ok(validateResultSetSummary(validSummary({ counts: [] }), {})
    .issues.some((i) => i.code === 'container-invalid' && i.path === '/counts'));
  assert.ok(validateResultSetSummary(validSummary({ counts: { results: 1, units: 1, pairSpaceTotal: 1, extra: 1 } }), {})
    .issues.some((i) => i.code === 'unknown-field-closed-type' && i.path === '/counts/extra'));
  assert.ok(validateResultSetSummary(validSummary({ counts: { results: -1, units: 1, pairSpaceTotal: 1 } }), {})
    .issues.some((i) => i.code === 'number-out-of-range' && i.path === '/counts/results'));
});

test('models is an array of closed {modelKey, modelVersion} rows, unique by modelKey', () => {
  const dup = validSummary({ models: [{ modelKey: 'M', modelVersion: 'v1' }, { modelKey: 'M', modelVersion: 'v2' }] });
  assert.ok(validateResultSetSummary(dup, {}).issues.some((i) => i.code === 'duplicate-model-key'));
  const unknownKey = validSummary({ models: [{ modelKey: 'M', modelVersion: 'v1', extra: 1 }] });
  assert.ok(validateResultSetSummary(unknownKey, {}).issues.some((i) => i.code === 'unknown-field-closed-type' && i.path === '/models/0/extra'));
  const notPlain = validSummary({ models: [null] });
  assert.ok(validateResultSetSummary(notPlain, {}).issues.some((i) => i.code === 'container-invalid' && i.path === '/models/0'));
});

// §13.5: "models <= 20,000 entries (= 2 x maxEntriesPerSelection)". Exercised at the real ceiling,
// never a smaller stand-in, so the test proves the actual normative bound.
test('models over the 2x maxEntriesPerSelection ceiling is array-too-long', () => {
  const max = 2 * ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection;
  const atCeiling = validSummary({ models: Array.from({ length: max }, (_, i) => ({ modelKey: `M${i}`, modelVersion: 'v1' })) });
  assert.equal(validateResultSetSummary(atCeiling, {}).ok, true);
  const overCeiling = validSummary({ models: Array.from({ length: max + 1 }, (_, i) => ({ modelKey: `M${i}`, modelVersion: 'v1' })) });
  assert.ok(validateResultSetSummary(overCeiling, {}).issues.some((i) => i.code === 'array-too-long'));
});

test('digests reuses the SAME closed Digests shape (digest syntax, digestVersion >= 1)', () => {
  const badDigest = validSummary({ digests: { digestVersion: 1, pairSetDigest: 'sha256:nope', ledgerDigest: ZERO_DIGEST } });
  assert.ok(validateResultSetSummary(badDigest, {}).issues.some((i) => i.code === 'digest-syntax-invalid'));
});

// The `{limits}` second argument is accepted (matching the one real call site already in this
// plan, InMemoryResultStore.list()'s `validateResultSetSummary(s, {})`) but consulted for nothing:
// every bound here is a fixed structural ceiling, never a caller-configured value.
test('an omitted or empty options argument behaves identically', () => {
  assert.deepEqual(validateResultSetSummary(validSummary()), { ok: true, issues: [] });
  assert.deepEqual(validateResultSetSummary(validSummary(), {}), { ok: true, issues: [] });
});
