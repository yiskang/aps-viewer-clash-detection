// test/clashpanel/core/residency.test.mjs — Task 9 (spec §7.6, AC-P14, PV-3)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResidency, HELD_IN_MEMORY_NOTICE } from '../../../clashpanel/core/residency.js';
import { createFakeEngine } from '../support/fakeEngine.mjs';
import { createClashTestEngine } from '../../../clashtest/index.js';
import { createEngineWorld } from '../../clashtest/support/engineWorld.mjs';
import { createScriptedExecutor } from '../../clashtest/support/scriptedExecutor.mjs';
import { createFakeClock } from '../../clashtest/support/fakeClock.mjs';

const P = {
  saved: { state: 'saved', timedOut: false, attempt: 1 },
  pending: { state: 'pending', timedOut: true, attempt: 1 },
  failed: { state: 'failed', timedOut: false, attempt: 1, error: { name: 'Error', message: 'disk full' } },
  noStore: { state: 'skipped', timedOut: false, attempt: 0, reason: 'no-store' },
  persistFalse: { state: 'skipped', timedOut: false, attempt: 0, reason: 'persist-false' },
};
/** A resident sealed set in the T3 fake engine + the RunSummary Core would resolve `done` with. */
const seal = (engine, runId, persistence) => {
  engine.makeResident(runId, persistence);
  return Object.freeze({ runId, status: 'completed', resultSet: Object.freeze({ runId, results: [] }), persistence });
};
/** What `persisted` settles with once a pending write finishes; the engine's by-id state moves with it. */
const settle = (engine, runId, state) => {
  engine.setPersistenceState(runId, { state, timedOut: false, attempt: 1 });
  return state === 'saved' ? { state } : state === 'failed' ? { state, error: new Error('write failed') } : { state, reason: 'no-store' };
};
const releases = (engine) => engine.calls.releaseResultSet.map(({ runId, opts }) => [runId, opts ?? {}]);
const clean = (engine) => { assert.equal(engine.liveLeaseCount(), 0, 'no leaked lease'); assert.deepEqual(engine.residentRunIds(), [], 'no leaked slot'); };

test('T3 fake extension: failNextLeaseRelease throws once and leaves the lease live', () => {
  const engine = createFakeEngine();
  engine.makeResident('a', P.saved);
  const lease = engine.retainResultSet('a');
  engine.failNextLeaseRelease(new Error('boom'));
  assert.throws(() => lease.release(), /boom/);
  assert.equal(engine.liveLeaseCount(), 1);
  lease.release();
  assert.equal(engine.liveLeaseCount(), 0);
});

test('saved at done ⇒ one lease; release = lease.release() then releaseResultSet (no acknowledgement)', () => {
  const engine = createFakeEngine();
  const r = createResidency({ engine });
  assert.deepEqual(r.adopt(seal(engine, 'a', P.saved)), { kind: 'leased', notice: null, errors: [] });
  assert.deepEqual(r.current(), { runId: 'a', kind: 'leased' });
  assert.equal(engine.liveLeaseCount(), 1);
  assert.equal(r.release({ acknowledgeUnsaved: false }).released, true);
  assert.deepEqual(engine.order.filter((n) => n !== 'getPersistenceState'), ['retainResultSet', 'releaseResultSet']);
  assert.deepEqual(releases(engine), [['a', {}]]);
  assert.equal(r.current(), null);
  clean(engine);
});

test('failed / skipped(no-store, persist-false) ⇒ engine-held with the quiet notice; release needs acknowledgement', () => {
  for (const p of [P.failed, P.noStore, P.persistFalse]) {
    const engine = createFakeEngine();
    const r = createResidency({ engine });
    assert.deepEqual(r.adopt(seal(engine, 'u', p)), { kind: 'held-unsaved', notice: HELD_IN_MEMORY_NOTICE, errors: [] });
    assert.deepEqual(engine.calls.retainResultSet, [], 'never retains an unsaved set');
    assert.deepEqual(r.release({ acknowledgeUnsaved: false }), { released: false, needsAcknowledgement: true, errors: [], stuckCount: 0 });
    assert.deepEqual(r.current(), { runId: 'u', kind: 'held-unsaved' }, 'still displayed until acknowledged');
    assert.deepEqual(engine.residentRunIds(), ['u']);
    const second = r.release({ acknowledgeUnsaved: true });
    assert.equal(second.released, true);
    assert.equal(second.droppedUnsaved, true);
    assert.deepEqual(releases(engine).at(-1), ['u', { acknowledgeUnsaved: true }]);
    clean(engine);
  }
});

test('pending → saved (onPersisted) upgrades to a lease; pending shows no notice', () => {
  const engine = createFakeEngine();
  const r = createResidency({ engine });
  assert.deepEqual(r.adopt(seal(engine, 'p', P.pending)), { kind: 'held-unsaved', notice: null, errors: [] });
  assert.deepEqual(r.onPersisted(settle(engine, 'p', 'saved')), { kind: 'leased', notice: null, errors: [] });
  assert.equal(engine.liveLeaseCount(), 1);
  assert.equal(r.release({ acknowledgeUnsaved: false }).released, true, 'a saved set needs no acknowledgement');
  clean(engine);
});

test('pending → failed (onPersisted) shows the notice and still requires acknowledgement', () => {
  const engine = createFakeEngine();
  const r = createResidency({ engine });
  r.adopt(seal(engine, 'p', P.pending));
  assert.deepEqual(r.onPersisted(settle(engine, 'p', 'failed')), { kind: 'held-unsaved', notice: HELD_IN_MEMORY_NOTICE, errors: [] });
  assert.equal(r.release({}).needsAcknowledgement, true);
  assert.equal(r.release({ acknowledgeUnsaved: true }).released, true);
  clean(engine);
});

test('pending that became saved without onPersisted is released WITHOUT acknowledgeUnsaved', () => {
  const engine = createFakeEngine();
  const r = createResidency({ engine });
  r.adopt(seal(engine, 'p', P.pending));
  settle(engine, 'p', 'saved');                       // the persisted promise has not been observed yet
  assert.equal(r.release({ acknowledgeUnsaved: false }).released, true);
  assert.deepEqual(releases(engine).at(-1), ['p', {}]);
  clean(engine);
});

test('resultSet null (seal-failed) ⇒ nothing held, release is a no-op success', () => {
  const engine = createFakeEngine();
  const r = createResidency({ engine });
  const out = r.adopt({ runId: 'x', status: 'failed', resultSet: null, persistence: { state: 'skipped', timedOut: false, attempt: 0, reason: 'seal-failed' } });
  assert.deepEqual(out, { kind: 'none', notice: null, errors: [] });
  assert.equal(r.current(), null);
  assert.deepEqual(r.release({ acknowledgeUnsaved: false }), { released: true, needsAcknowledgement: false, errors: [], stuckCount: 0 });
  assert.deepEqual(engine.order, []);
});

test('each release step in its own try: a throwing lease.release does not strand releaseResultSet, and vice versa', () => {
  const e1 = createFakeEngine();
  const r1 = createResidency({ engine: e1 });
  r1.adopt(seal(e1, 'a', P.saved));
  e1.failNextLeaseRelease(new Error('boom'));
  const out1 = r1.release({});
  assert.equal(out1.released, false);
  assert.deepEqual(releases(e1), [['a', {}]], 'releaseResultSet still attempted');
  assert.deepEqual(out1.errors.map((e) => e.name), ['Error', 'ResultSetRetainedError'], 'both failures reported, none thrown');
  assert.equal(r1.current(), null, 'the Panel no longer displays it');
  assert.equal(out1.stuckCount, 1, 'the failed release is remembered, not forgotten');
  assert.equal(e1.liveLeaseCount(), 1);
  const retry = r1.release({});                        // next Clear / Run: the stuck entry is retried first
  assert.deepEqual(retry, { released: true, needsAcknowledgement: false, errors: [], stuckCount: 0 });
  assert.equal(e1.liveLeaseCount(), 0);
  assert.deepEqual(e1.residentRunIds(), [], 'slot recovered');

  const e2 = createFakeEngine();
  const r2 = createResidency({ engine: e2 });
  r2.adopt(seal(e2, 'b', P.saved));
  e2.failNextRelease(Object.assign(new Error('engine refused'), { name: 'EngineDisposedError' }));
  const out2 = r2.release({});
  assert.equal(e2.liveLeaseCount(), 0, 'the lease was released before the throwing step');
  assert.deepEqual(out2.errors.map((e) => e.name), ['EngineDisposedError']);
});

test('a stuck release (one-shot lease.release failure) is recovered by the next Run-replace, Clear or dispose', () => {
  for (const next of ['run-replace', 'clear', 'dispose']) {
    const engine = createFakeEngine();
    const r = createResidency({ engine });
    r.adopt(seal(engine, 'a', P.saved));
    engine.failNextLeaseRelease(new Error('boom'));
    const first = r.release({});
    assert.deepEqual([first.released, first.stuckCount], [false, 1], next);
    assert.deepEqual(engine.residentRunIds(), ['a'], 'still retained after the failed attempt');
    if (next === 'run-replace') {
      r.adopt(seal(engine, 'b', P.saved));             // a new run was displayed meanwhile
      const out = r.release({});
      assert.deepEqual([out.released, out.stuckCount, out.errors.length], [true, 0, 0], next);
    } else if (next === 'clear') {
      assert.equal(r.release({ acknowledgeUnsaved: false }).released, true, next);
    } else {
      assert.deepEqual(r.disposeAll(), { droppedUnsaved: false, errors: [], stuckCount: 0 }, next);
    }
    clean(engine);
  }
});

test('a stuck entry whose retry fails again stays stuck (released:false) until a later attempt succeeds', () => {
  const engine = createFakeEngine();
  const r = createResidency({ engine });
  r.adopt(seal(engine, 'a', P.saved));
  engine.failNextLeaseRelease(new Error('boom-1'));
  r.release({});
  engine.failNextLeaseRelease(new Error('boom-2'));
  const second = r.release({});
  assert.deepEqual([second.released, second.stuckCount], [false, 1]);
  assert.deepEqual(second.errors.map((e) => e.message), ['boom-2', 'result set a is retained']);
  assert.deepEqual(r.releaseSuperseded(seal(engine, 'other', P.saved)), { errors: [], stuckCount: 1 }, 'releaseSuperseded never touches the stuck/displayed entries');
  assert.equal(r.release({}).released, true);
  clean(engine);
});

test('adopt never throws on engine refusals: saved-but-not-resident ⇒ none; retain throws Unsaved ⇒ held-unsaved', () => {
  const engine = createFakeEngine();
  const r = createResidency({ engine });
  const out = r.adopt({ runId: 'gone', status: 'completed', resultSet: { runId: 'gone', results: [] }, persistence: P.saved });
  assert.equal(out.kind, 'none');
  assert.equal(out.errors[0].name, 'ResultNotResidentError');
  assert.equal(r.current(), null);
  const e2 = createFakeEngine();
  const r2 = createResidency({ engine: e2 });
  const s = seal(e2, 'z', P.saved);
  e2.setPersistenceState('z', { state: 'pending', timedOut: true, attempt: 2 });   // by-id state disagrees with the summary
  const out2 = r2.adopt(s);
  assert.equal(out2.kind, 'held-unsaved');
  assert.equal(out2.errors[0].name, 'UnsavedResultSetError');
});

test('superseded late done releases ITS OWN set (saved or unsaved) and never the displayed one', () => {
  const engine = createFakeEngine();
  const r = createResidency({ engine });
  r.adopt(seal(engine, 'shown', P.saved));
  assert.deepEqual(r.releaseSuperseded(seal(engine, 'old-saved', P.saved)), { errors: [], stuckCount: 0 });
  assert.deepEqual(r.releaseSuperseded(seal(engine, 'old-unsaved', P.noStore)), { errors: [], stuckCount: 0 });
  assert.deepEqual(releases(engine), [['old-saved', {}], ['old-unsaved', { acknowledgeUnsaved: true }]]);
  assert.deepEqual(r.current(), { runId: 'shown', kind: 'leased' });
  assert.deepEqual(engine.residentRunIds(), ['shown']);
  assert.deepEqual(r.releaseSuperseded({ runId: 'null-set', resultSet: null, persistence: P.noStore }), { errors: [], stuckCount: 0 });
});

test('a failed releaseSuperseded is recorded in the stuck ledger and recovered by disposeAll', () => {
  const engine = createFakeEngine();
  const r = createResidency({ engine });
  r.adopt(seal(engine, 'shown', P.saved));
  engine.failNextRelease(Object.assign(new Error('busy'), { name: 'EngineDisposedError' }));
  const out = r.releaseSuperseded(seal(engine, 'late', P.noStore));
  assert.deepEqual([out.errors.map((e) => e.name), out.stuckCount], [['EngineDisposedError'], 1]);
  assert.deepEqual(r.current(), { runId: 'shown', kind: 'leased' }, 'displayed set untouched');
  assert.deepEqual(engine.residentRunIds().sort(), ['late', 'shown']);
  assert.deepEqual(r.disposeAll(), { droppedUnsaved: false, errors: [], stuckCount: 0 });
  assert.deepEqual(releases(engine).slice(-2), [['late', { acknowledgeUnsaved: true }], ['shown', {}]], 'stuck entry retried first');
  clean(engine);
});

test('disposeAll acknowledges and REPORTS an unsaved drop; a saved set is released without acknowledgement', () => {
  const e1 = createFakeEngine();
  const r1 = createResidency({ engine: e1 });
  r1.adopt(seal(e1, 'u', P.failed));
  assert.deepEqual(r1.disposeAll(), { droppedUnsaved: true, errors: [], stuckCount: 0 });
  clean(e1);
  const e2 = createFakeEngine();
  const r2 = createResidency({ engine: e2 });
  r2.adopt(seal(e2, 's', P.saved));
  assert.deepEqual(r2.disposeAll(), { droppedUnsaved: false, errors: [], stuckCount: 0 });
  clean(e2);
  assert.deepEqual(createResidency({ engine: createFakeEngine() }).disposeAll(), { droppedUnsaved: false, errors: [], stuckCount: 0 });
});

test('AC-P14 matrix: every persistence state × replace / Clear / dispose / disposal-during-active-run — no throw, no leak', () => {
  const states = { saved: [P.saved], 'pending→saved': [P.pending, 'saved'], 'pending→failed': [P.pending, 'failed'], failed: [P.failed], skipped: [P.noStore] };
  for (const [label, [initial, later]] of Object.entries(states)) {
    for (const path of ['replace', 'clear', 'dispose', 'dispose-during-run']) {
      const engine = createFakeEngine();
      const r = createResidency({ engine });
      const summary = seal(engine, 'run', initial);
      assert.doesNotThrow(() => {
        if (path === 'dispose-during-run') {
          r.disposeAll();                                 // nothing displayed yet; the run is still active
          if (later) settle(engine, 'run', later);
          r.releaseSuperseded(summary);                    // its late done arrives after dispose
          return;
        }
        r.adopt(summary);
        if (later) r.onPersisted(settle(engine, 'run', later));
        if (path === 'dispose') { r.disposeAll(); return; }
        const first = r.release({ acknowledgeUnsaved: false });   // Run / Clear results clicked
        if (first.needsAcknowledgement) r.release({ acknowledgeUnsaved: true });   // user confirmed "discard unsaved?"
      }, `${label} / ${path}`);
      clean(engine);
    }
  }
});

test('REAL engine: saved ⇒ lease; release frees the slot; persist:false ⇒ skipped, acknowledged drop', async () => {
  const w = createEngineWorld();
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 26) });
  const engine = createClashTestEngine(w.config({
    unitExecutor: createScriptedExecutor({}, { unscripted: { facts: [] } }),
    now: clock.now, yieldToScheduler: clock.yieldToScheduler, scheduleTimeout: () => () => {},
  }));
  const r = createResidency({ engine });
  const s1 = await engine.startRun(w.definition()).done;
  assert.equal(s1.persistence.state, 'saved');
  assert.equal(r.adopt(s1).kind, 'leased');
  assert.throws(() => engine.releaseResultSet(s1.runId), { name: 'ResultSetRetainedError' }, 'the lease is real');
  assert.equal(r.release({}).released, true);
  assert.equal(engine.getPersistenceState(s1.runId), null, 'not resident any more');

  const s2 = await engine.startRun(w.definition({ testId: 'T2' }), { persist: false }).done;
  assert.equal(s2.persistence.state, 'skipped');
  assert.equal(r.adopt(s2).notice, HELD_IN_MEMORY_NOTICE);
  assert.equal(r.release({}).needsAcknowledgement, true);
  assert.equal(engine.getPersistenceState(s2.runId).state, 'skipped', 'still resident until acknowledged');
  assert.equal(r.release({ acknowledgeUnsaved: true }).released, true);
  assert.equal(engine.getPersistenceState(s2.runId), null);
});
