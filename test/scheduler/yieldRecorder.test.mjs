import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCheckpointPort, createFrameBudgetAccumulator, setYieldRecorder, clearYieldRecorder,
} from '../../collision/scheduler.js';

function makeHarness() {
  let mockNow = 0;
  let forcedDue = false;
  const accumulator = createFrameBudgetAccumulator({ now: () => mockNow, budgetMs: 8 });
  const wrappedAccumulator = {
    isDue: () => forcedDue || accumulator.isDue(),
    markCheckpointed: () => { forcedDue = false; accumulator.markCheckpointed(); },
  };
  let yieldResolvers = [];
  const realPerformanceNow = performance.now.bind(performance);
  let fakePerfNow = 0;
  performance.now = () => fakePerfNow;
  const port = createCheckpointPort({
    isDisposed: () => false,
    isEpochLive: () => true,
    accumulator: wrappedAccumulator,
    yieldToScheduler: () => new Promise((resolve) => { yieldResolvers.push(resolve); }),
  });
  return {
    port,
    advanceClock: (ms) => { mockNow += ms; fakePerfNow += ms; },
    forceDue: () => { forcedDue = true; },
    resolveNextYield: () => { yieldResolvers.shift()?.(); },
    restore: () => { performance.now = realPerformanceNow; },
  };
}

test('setYieldRecorder/clearYieldRecorder: unset is a true no-op', () => {
  const { port, restore } = makeHarness();
  try {
    assert.equal(port.checkpoint({ loadEpoch: 1 }), undefined);
  } finally {
    restore();
  }
});

test('a real yield reports resume latency and an incrementing running count', async () => {
  const { port, advanceClock, forceDue, resolveNextYield, restore } = makeHarness();
  const yields = [];
  setYieldRecorder((resumeLatencyMs, runningCount) => yields.push({ resumeLatencyMs, runningCount }));
  try {
    forceDue();
    const pending = port.checkpoint({ loadEpoch: 1 });
    assert.ok(pending, 'a due checkpoint must return a real Promise');
    advanceClock(12);
    resolveNextYield();
    await pending;
    assert.equal(yields.length, 1);
    assert.equal(yields[0].resumeLatencyMs, 12);
    assert.equal(yields[0].runningCount, 1);

    forceDue();
    const pending2 = port.checkpoint({ loadEpoch: 1 });
    advanceClock(3);
    resolveNextYield();
    await pending2;
    assert.equal(yields.length, 2);
    assert.equal(yields[1].resumeLatencyMs, 3);
    assert.equal(yields[1].runningCount, 2);
  } finally {
    clearYieldRecorder();
    restore();
  }
});

test('setYieldRecorder itself resets the running count, not only clearYieldRecorder', async () => {
  const { port, advanceClock, forceDue, resolveNextYield, restore } = makeHarness();
  const countsA = [];
  setYieldRecorder((ms, count) => countsA.push(count));
  try {
    forceDue();
    const pending = port.checkpoint({ loadEpoch: 1 });
    advanceClock(1);
    resolveNextYield();
    await pending;
    assert.deepEqual(countsA, [1]);

    // Direct replacement, NO clearYieldRecorder call in between.
    const countsB = [];
    setYieldRecorder((ms, count) => countsB.push(count));
    forceDue();
    const pending2 = port.checkpoint({ loadEpoch: 1 });
    advanceClock(1);
    resolveNextYield();
    await pending2;
    assert.deepEqual(countsA, [1], 'A never sees the second checkpoint (it was replaced first)');
    assert.deepEqual(countsB, [1], 'count restarts at 1 for B, not continuing from A\'s 1');
  } finally {
    clearYieldRecorder();
    restore();
  }
});

test('the fast (not-due) path never triggers the yield recorder', () => {
  const { port, restore } = makeHarness();
  const yields = [];
  setYieldRecorder((ms, count) => yields.push({ ms, count }));
  try {
    port.checkpoint({ loadEpoch: 1 });
    assert.equal(yields.length, 0);
  } finally {
    clearYieldRecorder();
    restore();
  }
});

test('recorder lifecycle: clearing then reinstalling WHILE a yield is in flight does not misattribute the old yield to the new recorder', async () => {
  const { port, advanceClock, forceDue, resolveNextYield, restore } = makeHarness();
  const yieldsA = [];
  setYieldRecorder((ms, count) => yieldsA.push({ ms, count }));
  try {
    forceDue();
    const pending = port.checkpoint({ loadEpoch: 1 }); // yield now in flight, recorder A active
    advanceClock(4);
    clearYieldRecorder();
    const yieldsB = [];
    setYieldRecorder((ms, count) => yieldsB.push({ ms, count })); // B installed WHILE A's yield is still pending
    advanceClock(1000);
    resolveNextYield();
    await pending;
    assert.equal(yieldsA.length, 0, 'A never resolved -- it was cleared before resume');
    assert.equal(yieldsB.length, 0, 'B must NOT receive a yield it did not start observing -- this yield began under A');

    // A genuinely NEW yield, started after B was installed, DOES report to B normally.
    forceDue();
    const pending2 = port.checkpoint({ loadEpoch: 1 });
    advanceClock(2);
    resolveNextYield();
    await pending2;
    assert.deepEqual(yieldsB, [{ ms: 2, count: 1 }]);
  } finally {
    clearYieldRecorder();
    restore();
  }
});

test('recorder lifecycle: recorder A replaced directly by recorder B mid-yield (no clear in between) does not misattribute', async () => {
  const { port, advanceClock, forceDue, resolveNextYield, restore } = makeHarness();
  const yieldsA = [];
  setYieldRecorder((ms, count) => yieldsA.push({ ms, count }));
  try {
    forceDue();
    const pending = port.checkpoint({ loadEpoch: 1 });
    advanceClock(4);
    const yieldsB = [];
    setYieldRecorder((ms, count) => yieldsB.push({ ms, count })); // direct replacement, no clear
    advanceClock(1000);
    resolveNextYield();
    await pending;
    assert.equal(yieldsA.length, 0);
    assert.equal(yieldsB.length, 0, 'the in-flight yield belonged to A\'s installation, not B\'s -- must not report to either');
  } finally {
    clearYieldRecorder();
    restore();
  }
});

test('a due checkpoint with no recorder installed resolves correctly (yieldAndRecordResume disabled path is a true no-op)', async () => {
  const { port, advanceClock, forceDue, resolveNextYield, restore } = makeHarness();
  try {
    // Ensure no recorder is set (either never set or cleared)
    clearYieldRecorder();
    forceDue();
    const pending = port.checkpoint({ loadEpoch: 1 });
    assert.ok(pending, 'a due checkpoint must return a real Promise, even with no recorder');
    advanceClock(5);
    resolveNextYield();
    await pending;
    // If we get here without error, the disabled path worked correctly
    assert.ok(true, 'checkpoint resolved successfully with no recorder');
  } finally {
    clearYieldRecorder();
    restore();
  }
});
