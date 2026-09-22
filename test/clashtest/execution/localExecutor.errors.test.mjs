// test/clashtest/execution/localExecutor.errors.test.mjs
//
// Task P4.7: every row of the §7.5 error taxonomy, matched on `error.name` rather than `instanceof`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLibraryError, LINEAR_CEILING_MESSAGE_PREFIX } from '../../../clashtest/execution/LocalUnitExecutor.js';

import { UNIT_CAUSES } from '../../../clashtest/execution/UnitExecutor.js';

const named = (name, extra = {}) => Object.assign(new Error(`${name} happened`), { name }, extra);
const ctx = { participants: ['mk-a', 'mk-b'], deadModelKeys: [], placementGenerationChanged: false };

const capacity = (kind, extra = {}) =>
  [named('CapacityExceededError', { kind, ...extra }), ctx, { outcome: 'failed', code: 'capacity-exceeded', capacityKind: kind }];

const ROWS = [
  ['WorldDisposedError ⇒ failed:world-disposed', named('WorldDisposedError'), ctx, { outcome: 'failed', code: 'world-disposed' }],
  ['ModelEvictedError ⇒ failed:model-evicted, models from the LEASE recheck not the error',
    named('ModelEvictedError', { modelId: 99 }), { ...ctx, deadModelKeys: ['mk-b'] },
    { outcome: 'failed', code: 'model-evicted', modelKeys: ['mk-b'] }],
  ['placement changed, generation UNCHANGED ⇒ retryable failed:stale-placement',
    named('ModelPlacementChangedError'), ctx, { outcome: 'failed', code: 'stale-placement', retryable: true }],
  ['placement changed, generation CHANGED ⇒ discarded:input-changed, never retried',
    named('ModelPlacementChangedError'), { ...ctx, placementGenerationChanged: true },
    { outcome: 'discarded', code: 'input-changed', retryable: false }],
  ['capacity tlas-candidate-budget (splittable)', ...capacity('tlas-candidate-budget', { requested: 9, limit: 8 })],
  ['capacity clearance-narrow-phase-budget (splittable)', ...capacity('clearance-narrow-phase-budget')],
  ['capacity bucket-capacity (environment-sensitive)', ...capacity('bucket-capacity', { currentSize: 19_000, missing: 2_000, limit: 20_000 })],
  ['capacity call-wide-unique-fragment-precheck', ...capacity('call-wide-unique-fragment-precheck')],
  ['capacity whole-model-enumeration', ...capacity('whole-model-enumeration')],
  ['ExtractionLimitExceededError ⇒ failed:extraction-limit', named('ExtractionLimitExceededError'), ctx, { outcome: 'failed', code: 'extraction-limit' }],
  ['ObjectTreeUnavailableError ⇒ failed:object-tree-unavailable', named('ObjectTreeUnavailableError'), ctx, { outcome: 'failed', code: 'object-tree-unavailable' }],
  ['plain Error matching the linear ceiling ⇒ capacity-exceeded, NOT internal-error',
    Object.assign(new Error(`${LINEAR_CEILING_MESSAGE_PREFIX} (2 x 3 > 1)`), { name: 'Error' }), ctx,
    { outcome: 'failed', code: 'capacity-exceeded', capacityKind: null }],
  ['any other plain Error ⇒ failed:internal-error (fail-fast: the engine built an illegal call)',
    named('Error'), ctx, { outcome: 'failed', code: 'internal-error' }],
  ['a TypeError ⇒ failed:internal-error', named('TypeError'), ctx, { outcome: 'failed', code: 'internal-error' }],
  ['a non-Error throw ⇒ failed:internal-error, never a crash', 'a string', ctx, { outcome: 'failed', code: 'internal-error' }],
];

for (const [label, error, context, expected] of ROWS) {
  test(label, () => {
    const got = classifyLibraryError(error, context);
    assert.equal(got.outcome, expected.outcome);
    assert.equal(got.failure.code, expected.code);
    assert.ok(UNIT_CAUSES.includes(got.failure.code));
    if (expected.capacityKind !== undefined) assert.equal(got.failure.capacityKind ?? null, expected.capacityKind);
    if (expected.modelKeys) assert.deepEqual(got.failure.modelKeys, expected.modelKeys);
    if (expected.retryable !== undefined) assert.equal(got.failure.retryable, expected.retryable);
    assert.ok((got.failure.message ?? '').length <= 512);
    assert.ok((got.failure.errorName ?? '').length <= 128);
    assert.doesNotThrow(() => structuredClone(got.failure), 'failure data must be plain');
  });
}

test('a capacity error\'s details are copied as finite numbers only', () => {
  const got = classifyLibraryError(
    named('CapacityExceededError', { kind: 'bucket-capacity', currentSize: 1, missing: NaN, extra: {} }), ctx);
  assert.deepEqual(got.failure.capacityDetails, { currentSize: 1 });
});

test('an over-length library message is TRUNCATED, not rejected — a library message is not executor data', () => {
  const got = classifyLibraryError(named('ObjectTreeUnavailableError', { message: 'x'.repeat(5_000) }), ctx);
  assert.equal(got.failure.message.length, 512);
});
