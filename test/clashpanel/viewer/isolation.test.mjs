// test/clashpanel/viewer/isolation.test.mjs — T24 (Tier B; fakes only — live isolation semantics are gate G2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeIsolation, isolationEquals, targetFor, isolationPrerequisite, createIsolationSession, ISOLATION_REASON, ISOLATION_NOTE,
} from '../../../clashpanel/viewer/isolation.js';
import { createBridgeHarness } from '../support/viewerFaults.mjs';
import { createFakeModel } from '../support/fakeViewer.mjs';

const sets = (h) => h.callsOf('setAggregateIsolation').map((e) => e.args[0]);

test('normalizeIsolation: identity keys, sorted de-duplicated ids, empty ids ≠ absence, order irrelevant', () => {
  const a = createFakeModel({ id: 'a' }); const b = createFakeModel({ id: 'b' });
  const n = normalizeIsolation([{ model: b, ids: [3, 1, 3] }, { model: a, ids: [] }]);
  assert.deepEqual(n, [{ model: b, ids: [1, 3] }, { model: a, ids: [] }]);
  assert.ok(Object.isFrozen(n) && Object.isFrozen(n[0].ids));
  assert.ok(isolationEquals(n, normalizeIsolation([{ model: a, ids: [] }, { model: b, ids: [1, 3] }])), 'order irrelevant');
  assert.equal(isolationEquals(n, normalizeIsolation([{ model: b, ids: [1, 3] }])), false, 'show-all entry ≠ absent entry');
  assert.equal(isolationEquals(normalizeIsolation([{ model: a, ids: [1] }]), normalizeIsolation([{ model: createFakeModel({ id: 'a' }), ids: [1] }])), false, 'identity, not label');
  assert.deepEqual(normalizeIsolation([]), []);
});

test('normalizeIsolation: anything not of the documented shape is NOT normalizable (null)', () => {
  const a = createFakeModel({ id: 'a' });
  for (const bad of [undefined, null, {}, 'x', [null], [{ ids: [1] }], [{ model: a }], [{ model: a, ids: [-1] }],
    [{ model: a, ids: [1.5] }], [{ model: a, ids: ['1'] }], [{ model: a, ids: [1] }, { model: a, ids: [2] }], [{ model: 7, ids: [1] }]]) {
    assert.equal(normalizeIsolation(bad), null, JSON.stringify(bad));
  }
  assert.equal(isolationEquals(null, []), false);
});

test('targetFor: one reconcile entry per model, never {model, ids: []}; malformed sides throw', () => {
  const a = createFakeModel({ id: 'a' }); const b = createFakeModel({ id: 'b' });
  assert.deepEqual(targetFor([{ model: a, dbId: 5 }, { model: a, dbId: 2 }]), [{ model: a, ids: [2, 5] }]);
  assert.deepEqual(targetFor([{ model: a, dbId: 5 }, { model: b, dbId: 5 }]), [{ model: a, ids: [5] }, { model: b, ids: [5] }]);
  assert.throws(() => targetFor([]), TypeError);
  assert.throws(() => targetFor([{ model: a, dbId: -1 }]), TypeError);
  assert.throws(() => targetFor([{ model: null, dbId: 1 }]), TypeError);
});

test('isolationPrerequisite (§9.5): readable + normalizable AND no hidden nodes on any scene model; read-only', () => {
  const h = createBridgeHarness();
  const [m1] = h.models;
  assert.deepEqual(isolationPrerequisite(h.api), { available: true, reason: null });
  h.viewer.setHiddenNodes([{ model: createFakeModel({ id: 'not-in-scene' }), ids: [4] }, { model: m1, ids: [] }]);
  assert.equal(isolationPrerequisite(h.api).available, true, 'hidden nodes of a model outside the scene are ignored');
  h.viewer.setHiddenNodes([{ model: m1, ids: [4] }]);
  assert.deepEqual(isolationPrerequisite(h.api), { available: false, reason: ISOLATION_REASON.HIDDEN });
  assert.equal(ISOLATION_REASON.HIDDEN, 'Some elements are hidden — show all to enable isolation');
  h.viewer.setHiddenNodes('garbage');
  assert.deepEqual(isolationPrerequisite(h.api), { available: false, reason: ISOLATION_REASON.HIDDEN_UNREADABLE });
  h.viewer.setHiddenNodes([]);
  h.failAt('getAggregateIsolation', 'before');
  assert.deepEqual(isolationPrerequisite(h.api), { available: false, reason: ISOLATION_REASON.UNREADABLE });
  assert.deepEqual(isolationPrerequisite({ getAllModels: () => [] }), { available: false, reason: ISOLATION_REASON.UNREADABLE });
  assert.deepEqual(isolationPrerequisite({ getAggregateIsolation: () => [], getAllModels: () => [] }), { available: false, reason: ISOLATION_REASON.HIDDEN_UNREADABLE });
  assert.deepEqual(sets(h), [], 'never mutates');
});

test('session: prior captured at the first apply; restore restores a non-empty prior (ownership passes)', () => {
  const [m1, m2, m3] = [createFakeModel({ id: 'm1' }), createFakeModel({ id: 'm2' }), createFakeModel({ id: 'm3' })];
  const prior = [{ model: m3, ids: [42] }];
  const h = createBridgeHarness({ models: [m1, m2, m3], isolation: prior });
  const s = createIsolationSession(h.api);
  assert.deepEqual(s.apply([{ model: m1, dbId: 1 }, { model: m2, dbId: 2 }]), { applied: true, reason: null });
  assert.deepEqual(sets(h), [[{ model: m1, ids: [1] }, { model: m2, ids: [2] }]], 'ONE reconcile call');
  assert.deepEqual(s.record().preImage, prior);
  assert.equal(s.record().confirmed, true);
  assert.deepEqual(s.restore(), { isolation: 'restored', notes: [] });
  assert.deepEqual(h.isolation(), prior);
  assert.equal(s.owns(), false);
  assert.deepEqual(s.restore(), { isolation: 'none', notes: [] });
});

test('session: empty prior ⇒ setAggregateIsolation([]) only AFTER the ownership compare passes', () => {
  const h = createBridgeHarness();
  const [m1] = h.models;
  const s = createIsolationSession(h.api);
  s.apply([{ model: m1, dbId: 1 }]);
  h.log.length = 0;
  assert.equal(s.restore().isolation, 'restored');
  const order = h.log.map((e) => e.method);
  assert.ok(order.indexOf('getAggregateIsolation') < order.indexOf('setAggregateIsolation'), 'read-and-compare first');
  assert.deepEqual(sets(h), [[]]);
});

test('session: a foreign change between apply and restore is never clobbered (skipped-external, no set)', () => {
  const h = createBridgeHarness();
  const [m1, m2] = h.models;
  const s = createIsolationSession(h.api);
  s.apply([{ model: m1, dbId: 1 }]);
  h.viewer.setIsolationState([{ model: m2, ids: [8] }]);
  h.log.length = 0;
  assert.deepEqual(s.restore(), { isolation: 'skipped-external', notes: [] });
  assert.deepEqual(sets(h), []);
  assert.deepEqual(h.isolation(), [{ model: m2, ids: [8] }]);
});

test('session: a second owned apply keeps the ORIGINAL prior; after a foreign change a new session captures it', () => {
  const [m1, m2, m3] = [createFakeModel({ id: 'm1' }), createFakeModel({ id: 'm2' }), createFakeModel({ id: 'm3' })];
  const h = createBridgeHarness({ models: [m1, m2, m3], isolation: [{ model: m3, ids: [1] }] });
  const s = createIsolationSession(h.api);
  s.apply([{ model: m1, dbId: 1 }]);
  s.apply([{ model: m2, dbId: 2 }]);
  assert.deepEqual(s.record().preImage, [{ model: m3, ids: [1] }], 'prior kept across the replacement');
  h.viewer.setIsolationState([{ model: m3, ids: [7] }]);
  s.apply([{ model: m1, dbId: 3 }]);
  assert.deepEqual(s.record().preImage, [{ model: m3, ids: [7] }], 'foreign state became the new prior');
  s.restore();
  assert.deepEqual(h.isolation(), [{ model: m3, ids: [7] }]);
});

test('session: prerequisite unmet / unreadable / model not in scene ⇒ applied:false and NO setAggregateIsolation at all', () => {
  const h = createBridgeHarness();
  const [m1] = h.models;
  const s = createIsolationSession(h.api);
  h.viewer.setHiddenNodes([{ model: m1, ids: [3] }]);
  assert.deepEqual(s.apply([{ model: m1, dbId: 1 }]), { applied: false, reason: ISOLATION_REASON.HIDDEN });
  h.viewer.setHiddenNodes([]);
  h.failAt('getAggregateIsolation', 'before');
  assert.deepEqual(s.apply([{ model: m1, dbId: 1 }]), { applied: false, reason: ISOLATION_REASON.UNREADABLE });
  assert.deepEqual(s.apply([{ model: createFakeModel({ id: 'gone' }), dbId: 1 }]), { applied: false, reason: ISOLATION_REASON.NOT_IN_SCENE });
  assert.deepEqual(s.restore(), { isolation: 'none', notes: [] });
  assert.deepEqual(sets(h), [], 'never a clear-all fallback');
});

test('session: an apply that throws AFTER changing state leaves a pending write-ahead record that restore undoes', () => {
  const [m1, m3] = [createFakeModel({ id: 'm1' }), createFakeModel({ id: 'm3' })];
  const h = createBridgeHarness({ models: [m1, m3], isolation: [{ model: m3, ids: [4] }] });
  const s = createIsolationSession(h.api);
  h.failAt('setAggregateIsolation', 'after');
  assert.throws(() => s.apply([{ model: m1, dbId: 1 }]), /injected/);
  assert.deepEqual({ ...s.record(), preImage: [...s.record().preImage] }, {
    preImage: [{ model: m3, ids: [4] }], target: [{ model: m1, ids: [1] }], prevTarget: null, confirmed: false,
  });
  assert.equal(s.restore().isolation, 'restored');
  assert.deepEqual(h.isolation(), [{ model: m3, ids: [4] }]);
});

test('session: throw BEFORE the state change / aborted beforeMutation ⇒ restore finds the pre-image and does nothing', () => {
  const h = createBridgeHarness();
  const [m1] = h.models;
  const s = createIsolationSession(h.api);
  h.failAt('setAggregateIsolation', 'before');
  assert.throws(() => s.apply([{ model: m1, dbId: 1 }]), /injected/);
  assert.deepEqual(s.restore(), { isolation: 'none', notes: [] });
  assert.throws(() => s.apply([{ model: m1, dbId: 1 }], { beforeMutation: () => { throw new Error('stale'); } }), /stale/);
  assert.equal(s.owns(), true, 'the write-ahead record survives the abort');
  h.log.length = 0;
  assert.deepEqual(s.restore(), { isolation: 'none', notes: [] });
  assert.deepEqual(sets(h), []);
});

test('session: a restore that throws is retried once; still failing ⇒ "failed" + note AND the record is KEPT for a later retry', () => {
  const [m1, m3] = [createFakeModel({ id: 1 }), createFakeModel({ id: 3 })];
  const prior = [{ model: m3, ids: [4] }];
  const h = createBridgeHarness({ models: [m1, m3], isolation: prior });
  const s = createIsolationSession(h.api);
  s.apply([{ model: m1, dbId: 1 }]);
  h.failAt('setAggregateIsolation', 'before');
  assert.equal(s.restore().isolation, 'restored', 'one retry suffices');
  assert.deepEqual(h.isolation(), prior);

  s.apply([{ model: m1, dbId: 1 }]);
  h.failAt('setAggregateIsolation', 'before');
  h.failAt('setAggregateIsolation', 'before');             // queued: fails the retry
  h.log.length = 0;
  assert.deepEqual(s.restore(), { isolation: 'failed', notes: [ISOLATION_NOTE.RESTORE_FAILED] });
  assert.equal(h.callsOf('setAggregateIsolation').length, 2, 'exactly one retry');
  assert.equal(s.owns(), true, 'pre-image + ownership kept');
  assert.deepEqual(s.record().preImage, prior);
  assert.deepEqual(s.restore(), { isolation: 'restored', notes: [] }, 'a later restore succeeds');
  assert.deepEqual(h.isolation(), prior);
  assert.equal(s.owns(), false, 'dropped only after the confirmed restore');
});

test('session: unreadable state at restore / after a throw ⇒ "failed", record kept; a confirmed foreign state drops it', () => {
  const [m1, m2] = [createFakeModel({ id: 1 }), createFakeModel({ id: 2 })];
  const h = createBridgeHarness({ models: [m1, m2] });
  const s = createIsolationSession(h.api);
  s.apply([{ model: m1, dbId: 1 }]);
  h.failAt('getAggregateIsolation', 'before');
  assert.deepEqual(s.restore(), { isolation: 'failed', notes: [ISOLATION_NOTE.UNREADABLE_AT_RESTORE] });
  assert.equal(s.owns(), true);
  h.failAt('setAggregateIsolation', 'before');
  h.failAt('getAggregateIsolation', 'before', 2);
  assert.deepEqual(s.restore(), { isolation: 'failed', notes: [ISOLATION_NOTE.RESTORE_FAILED] }, 'unreadable after the throw');
  assert.equal(s.owns(), true);
  h.failAt('setAggregateIsolation', 'before');
  h.viewer.onCall('setAggregateIsolation', () => h.viewer.setIsolationState([{ model: m2, ids: [8] }]));   // during the failing call
  assert.deepEqual(s.restore(), { isolation: 'skipped-external', notes: [] }, 'a foreign change during the failed restore is left alone');
  assert.deepEqual(h.isolation(), [{ model: m2, ids: [8] }]);
  assert.equal(s.owns(), false, 'confirmed foreign ⇒ dropped');
});

test('session: the pre-image is a FINAL read after the prerequisite — a foreign change during getAggregateHiddenNodes is never clobbered', () => {
  const [m1, m2] = [createFakeModel({ id: 1 }), createFakeModel({ id: 2 })];
  const h = createBridgeHarness({ models: [m1, m2] });
  const s = createIsolationSession(h.api);
  const F = [{ model: m2, ids: [8] }];
  h.viewer.onCall('getAggregateHiddenNodes', () => h.viewer.setIsolationState(F));
  assert.equal(s.apply([{ model: m1, dbId: 1 }]).applied, true);
  assert.deepEqual(s.record().preImage, F);
  assert.equal(s.restore().isolation, 'restored');
  assert.deepEqual(h.isolation(), F);
  const s2 = createIsolationSession(h.api);
  h.viewer.setIsolationState([]);
  h.failAt('getAggregateIsolation', 'before', 3);          // current, prerequisite, FINAL read → the final one fails
  h.log.length = 0;
  assert.deepEqual(s2.apply([{ model: m1, dbId: 1 }]), { applied: false, reason: ISOLATION_REASON.UNREADABLE });
  assert.deepEqual(h.callsOf('setAggregateIsolation'), [], 'fail closed: no mutation');
});
