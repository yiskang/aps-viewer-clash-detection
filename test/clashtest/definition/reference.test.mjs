// test/clashtest/definition/reference.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStartRunArgument, validateReference } from '../../../clashtest/definition/validate.js';

const codes = (r) => r.issues.map((i) => `${i.path}:${i.code}`);

test('own key set exactly {testId} or {testId, revision} is a reference', () => {
  assert.equal(classifyStartRunArgument({ testId: 'T' }).kind, 'reference');
  assert.equal(classifyStartRunArgument({ testId: 'T', revision: 3 }).kind, 'reference');
  assert.equal(classifyStartRunArgument({ revision: 3, testId: 'T' }).kind, 'reference'); // key order irrelevant
});

test('mixed-shape objects are definitions, never guessed references (R21-I3)', () => {
  // the exact failure scenario of round-21 finding I3
  assert.equal(classifyStartRunArgument({ testId: 'T', revision: 1, mode: 'clearance' }).kind, 'definition');
  assert.equal(classifyStartRunArgument({ testId: 'T', name: 'x' }).kind, 'definition');
  assert.equal(classifyStartRunArgument({}).kind, 'definition');
  assert.equal(classifyStartRunArgument({ revision: 1 }).kind, 'definition');
});

test('a non-enumerable extra key still makes it a definition', () => {
  const o = { testId: 'T' };
  Object.defineProperty(o, 'mode', { value: 'clearance', enumerable: false });
  assert.equal(classifyStartRunArgument(o).kind, 'definition');
});

test('non-objects and arrays are invalid, not guessed', () => {
  for (const bad of [null, undefined, 'T', 7, true, () => {}, ['T']]) {
    const r = classifyStartRunArgument(bad);
    assert.equal(r.kind, 'invalid');
    assert.deepEqual(codes(r), ['/:not-an-object']);
  }
});

test('anything captureData cannot capture as plain data is invalid, and the issue says why', () => {
  assert.deepEqual(codes(classifyStartRunArgument({ testId: 'T', [Symbol('x')]: 1 })), ['/x:symbol-key']);
  const withGetter = Object.defineProperty({ testId: 'T' }, 'revision', { get() { throw new Error('never invoked'); }, enumerable: true });
  const g = classifyStartRunArgument(withGetter);
  assert.equal(g.kind, 'invalid');
  assert.deepEqual(codes(g), ['/revision:accessor-property']);
  const cyclic = { testId: 'T' }; cyclic.self = cyclic;
  assert.deepEqual(codes(classifyStartRunArgument(cyclic)), ['/self:cyclic']);
});

test('a proxy whose ownKeys trap throws is invalid, and the throw never escapes', () => {
  const p = new Proxy({}, { ownKeys() { throw new Error('boom'); } });
  const r = classifyStartRunArgument(p);
  assert.equal(r.kind, 'invalid');
  assert.deepEqual(codes(r), ['/:unreadable']);
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  assert.deepEqual(codes(classifyStartRunArgument(proxy)), ['/:unreadable']);
});

test('ClashTestReference is a closed schema (R1-R3)', () => {
  assert.deepEqual(validateReference({ testId: 'T' }).captured, { testId: 'T', revision: null });
  assert.deepEqual(validateReference({ testId: 'T', revision: 4 }).captured, { testId: 'T', revision: 4 });
  assert.deepEqual(codes(validateReference({ testId: '' })), ['/testId:string-too-short']);
  assert.deepEqual(codes(validateReference({ testId: 'x'.repeat(257) })), ['/testId:string-too-long']);
  assert.deepEqual(codes(validateReference({ testId: 7 })), ['/testId:not-a-string']);
  assert.deepEqual(codes(validateReference({ revision: 1 })), ['/testId:missing-required']);
  assert.deepEqual(codes(validateReference({ testId: 'T', mode: 'clearance' })), ['/mode:unknown-property']);
  assert.deepEqual(codes(validateReference({ testId: 'T', revision: 0 })), ['/revision:out-of-range']);
  assert.deepEqual(codes(validateReference({ testId: 'T', revision: 1.5 })), ['/revision:not-an-integer']);
  assert.deepEqual(codes(validateReference({ testId: 'T', revision: 2 ** 53 })), ['/revision:out-of-range']);
  assert.equal(validateReference({ testId: 'T', revision: 1 }).issues.length, 0);
  assert.deepEqual(codes(validateReference(null)), ['/:not-an-object']);
});

test('an accessor on a reference field is rejected and the getter is never invoked', () => {
  let called = 0;
  const ref = Object.defineProperty({}, 'testId', { get() { called += 1; return 'T'; }, enumerable: true });
  assert.deepEqual(codes(validateReference(ref)), ['/testId:accessor-property']);
  assert.equal(called, 0);
});

test('a non-plain prototype is rejected at the reference level', () => {
  class R { constructor() { this.testId = 'T'; } }
  assert.deepEqual(codes(validateReference(new R())), ['/:not-plain-object']);
});
