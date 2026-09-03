// test/scheduler/checkpointPort.contract.mjs
//
// Contract test suite for any CheckpointPort implementation (collision/scheduler.js).
// `runCheckpointPortContractTests(makePort)` is imported and called by:
//   - this task's own test files, against FakeCheckpointPort and the real
//     createCheckpointPort;
//   - Task 17's CollisionWorld tests, against a `makePort()` that wraps the real
//     world's own checkpoint mechanism behind the same { port, controls } shape.
//
// `makePort()` must return `{ port, controls }` where:
//   - port.checkpoint({ loadEpoch, modelIdHint }) -> (undefined | Promise<void>)
//     (undefined synchronously on the "not due" fast path; a real Promise only when
//     a yield is actually due -- see this task's write-up on why an always-async
//     checkpoint is a real performance defect, not a style nit, at the broad-phase
//     scan's scale)
//   - controls.setDisposed(boolean)
//   - controls.setEpochLive(loadEpoch, boolean)
//   - controls.forceYieldDue()             -- next checkpoint() call takes the "due" branch
//   - controls.forceYieldNotDue()          -- next checkpoint() call takes the "not due" branch
//   - controls.getYieldInvocationCount()   -- how many times the port's real yield
//     primitive has actually been invoked so far -- an observable hook, not just an
//     inference from timing, so a test can prove a real yield happened rather than
//     merely that revalidation-ordering holds if one did (a fake/real implementation
//     could otherwise pass every ordering test while never actually invoking its
//     yield primitive at all, or invoking it more than once per due call).
//
// Deliberately does NOT assert anything about real wall-clock timing (fake and real
// implementations may use entirely different clocks) -- only the ordering/error/
// synchronicity contract, which is what makes a fake-vs-real swap safe.

import test from 'node:test';
import assert from 'node:assert/strict';

export function runCheckpointPortContractTests(makePort, { suiteName = 'CheckpointPort contract' } = {}) {
  test(suiteName, async (t) => {
    await t.test('not due -> returns undefined SYNCHRONOUSLY (no Promise, no yield invoked)', () => {
      const { port, controls } = makePort();
      controls.setEpochLive(1, true);
      controls.setDisposed(false);
      controls.forceYieldNotDue();
      const result = port.checkpoint({ loadEpoch: 1 });
      assert.equal(result, undefined, 'the not-due fast path must be synchronous -- no Promise allocated');
      assert.equal(controls.getYieldInvocationCount(), 0);
    });

    await t.test('throws WorldDisposedError SYNCHRONOUSLY when disposed, epoch live', () => {
      const { port, controls } = makePort();
      controls.setEpochLive(1, true);
      controls.setDisposed(true);
      assert.throws(() => port.checkpoint({ loadEpoch: 1 }), { name: 'WorldDisposedError' });
      assert.equal(controls.getYieldInvocationCount(), 0, 'an invalid entry must reject before any yield is attempted');
    });

    await t.test('throws ModelEvictedError SYNCHRONOUSLY when epoch not live, world not disposed', () => {
      const { port, controls } = makePort();
      controls.setDisposed(false);
      controls.setEpochLive(1, false);
      assert.throws(() => port.checkpoint({ loadEpoch: 1 }), { name: 'ModelEvictedError' });
    });

    await t.test('disposed-first: both disposed AND evicted -> WorldDisposedError, not ModelEvictedError', () => {
      const { port, controls } = makePort();
      controls.setDisposed(true);
      controls.setEpochLive(1, false);
      assert.throws(() => port.checkpoint({ loadEpoch: 1 }), { name: 'WorldDisposedError' });
    });

    await t.test('ModelEvictedError carries a modelId (modelIdHint if supplied, else loadEpoch)', () => {
      const { port, controls } = makePort();
      controls.setDisposed(false);
      controls.setEpochLive(1, false);
      assert.throws(() => port.checkpoint({ loadEpoch: 1, modelIdHint: 'room-model' }), (err) => {
        assert.equal(err.name, 'ModelEvictedError');
        assert.equal(err.modelId, 'room-model');
        return true;
      });
    });

    await t.test('due -> returns a real Promise and invokes the yield primitive exactly once', async () => {
      const { port, controls } = makePort();
      controls.setEpochLive(1, true);
      controls.setDisposed(false);
      controls.forceYieldDue();
      const pending = port.checkpoint({ loadEpoch: 1 });
      assert.ok(pending instanceof Promise, 'a due checkpoint must return a real Promise, not undefined');
      assert.equal(controls.getYieldInvocationCount(), 1, 'yield invoked synchronously');
      if (controls.resolveNextYield) controls.resolveNextYield();
      await pending;
      assert.equal(controls.getYieldInvocationCount(), 1, 'exactly one real yield per due checkpoint call');
    });

    await t.test('due -> revalidates AFTER the yield: disposed flips during the yield rejects', async () => {
      const { port, controls } = makePort();
      controls.setEpochLive(1, true);
      controls.setDisposed(false);
      controls.forceYieldDue();
      const pending = port.checkpoint({ loadEpoch: 1 });
      // Synchronous: runs before any microtask/macrotask the checkpoint's own yield is
      // waiting on, simulating disposal happening WHILE the checkpoint is suspended --
      // exactly the race the revalidate-after-yield rule exists for. Sound because an
      // async function's continuation past its first real `await` cannot run until the
      // current synchronous stack finishes (confirmed via codex-advisor before relying
      // on this technique here).
      controls.setDisposed(true);
      if (controls.resolveNextYield) controls.resolveNextYield();
      await assert.rejects(pending, { name: 'WorldDisposedError' });
    });

    await t.test('due -> revalidates AFTER the yield: epoch evicted during the yield rejects', async () => {
      const { port, controls } = makePort();
      controls.setEpochLive(1, true);
      controls.setDisposed(false);
      controls.forceYieldDue();
      const pending = port.checkpoint({ loadEpoch: 1 });
      controls.setEpochLive(1, false);
      if (controls.resolveNextYield) controls.resolveNextYield();
      await assert.rejects(pending, { name: 'ModelEvictedError' });
    });

    await t.test('due -> revalidation re-checks disposed BEFORE epoch (ordering holds post-yield too)', async () => {
      const { port, controls } = makePort();
      controls.setEpochLive(1, true);
      controls.setDisposed(false);
      controls.forceYieldDue();
      const pending = port.checkpoint({ loadEpoch: 1 });
      controls.setDisposed(true);
      controls.setEpochLive(1, false);
      if (controls.resolveNextYield) controls.resolveNextYield();
      await assert.rejects(pending, { name: 'WorldDisposedError' });
    });

    await t.test('throws WorldDisposedError SYNCHRONOUSLY even when yield is due (pre-yield validation)', () => {
      const { port, controls } = makePort();
      controls.setEpochLive(1, true);
      controls.setDisposed(true);
      controls.forceYieldDue();
      assert.throws(() => port.checkpoint({ loadEpoch: 1 }), { name: 'WorldDisposedError' });
      assert.equal(controls.getYieldInvocationCount(), 0, 'validation throws before yield is invoked');
    });

    await t.test('throws ModelEvictedError SYNCHRONOUSLY even when yield is due (pre-yield validation)', () => {
      const { port, controls } = makePort();
      controls.setDisposed(false);
      controls.setEpochLive(1, false);
      controls.forceYieldDue();
      assert.throws(() => port.checkpoint({ loadEpoch: 1 }), { name: 'ModelEvictedError' });
      assert.equal(controls.getYieldInvocationCount(), 0, 'validation throws before yield is invoked');
    });

    await t.test('due -> yield primitive is invoked SYNCHRONOUSLY (before return, observable via count)', async () => {
      const { port, controls } = makePort();
      controls.setEpochLive(1, true);
      controls.setDisposed(false);
      controls.forceYieldDue();
      const pending = port.checkpoint({ loadEpoch: 1 });
      assert.ok(pending instanceof Promise);
      assert.equal(controls.getYieldInvocationCount(), 1, 'yield invoked synchronously before returning');
      // Resolve the yield to clean up
      if (controls.resolveNextYield) controls.resolveNextYield();
      await pending;
    });

    await t.test('due -> revalidation is gated on yield resolution, disposed-first ordering', async () => {
      const { port, controls } = makePort();
      controls.setEpochLive(1, true);
      controls.setDisposed(false);
      controls.forceYieldDue();
      const pending = port.checkpoint({ loadEpoch: 1 });
      assert.equal(controls.getYieldInvocationCount(), 1);
      // Mutate state before resolving the yield
      controls.setDisposed(true);
      // Resolve the yield and let the async function run
      if (controls.resolveNextYield) controls.resolveNextYield();
      // Revalidation should now run and reject with WorldDisposedError
      await assert.rejects(pending, { name: 'WorldDisposedError' });
    });

    await t.test('due -> revalidation is gated on yield resolution, evicted epoch', async () => {
      const { port, controls } = makePort();
      controls.setEpochLive(1, true);
      controls.setDisposed(false);
      controls.forceYieldDue();
      const pending = port.checkpoint({ loadEpoch: 1 });
      assert.equal(controls.getYieldInvocationCount(), 1);
      // Mutate state before resolving the yield
      controls.setEpochLive(1, false);
      // Resolve the yield and let the async function run
      if (controls.resolveNextYield) controls.resolveNextYield();
      // Revalidation should now run and reject with ModelEvictedError
      await assert.rejects(pending, { name: 'ModelEvictedError' });
    });
  });
}
