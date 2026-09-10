// test/performance/m4/request-tracker.test.mjs
//
// Drives the canonical protocol implementation (spike/m4/s3-s4-worker-lifecycle/request-tracker.mjs
// — the SAME module the live S4' browser driver uses) through its real attachWorker()-installed
// onmessage/onerror handlers, using a fake-but-real-shaped worker object instead of a real
// dedicated Worker. Nothing here re-implements or simplifies the protocol; every assertion goes
// through handleMessage/faultAndDiscard exactly as a real Worker's events would invoke them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRequestTracker,
  WorldDisposedError,
  ModelEvictedError,
  ModelPlacementChangedError,
  MalformedResponseError,
  WorkerFaultError,
  ProtocolFaultError,
} from '../../../spike/m4/s3-s4-worker-lifecycle/request-tracker.mjs';

function makeFakeWorker() {
  const sent = [];
  return {
    sent, // every message actually handed to postMessage() -- lets tests inspect the real wire shape
    postMessage(msg) { sent.push(msg); },
    onmessage: null,
    onerror: null,
    terminate() {},
  };
}

// Builds a spec-shaped echo response from the tracker's OWN captured RequestState (via the
// __capturedStateForTest introspection hook), never from what the test originally passed to
// dispatch() -- this is what actually proves dispatch-time snapshotting, not a copy of the input.
function validEchoFor(tracker, dispatched, resultOverrides = {}) {
  const captured = tracker.__capturedStateForTest(dispatched.requestId);
  return {
    requestId: dispatched.requestId,
    workerGeneration: captured.workerGeneration,
    worldGeneration: captured.worldGeneration,
    epochs: captured.epochs,
    result: { epoch: captured.epochs[0].epoch, fragmentIds: [], ...resultOverrides },
  };
}

test('(a) dispose() mid-flight — rejects with WorldDisposedError, empty pending set, before terminate()', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  const req = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });

  const rejectedCount = tracker.disposeWorld('world disposed');
  worker.terminate(); // per §10.2, this must find nothing left to (re-)reject

  assert.equal(rejectedCount, 1);
  await assert.rejects(req.promise, WorldDisposedError);
  assert.equal(tracker.pendingCount(), 0);
  assert.equal(tracker.isPending(req.requestId), false);
});

test('(b) evictModel mid-flight — rejects with ModelEvictedError, unrelated epoch untouched and later resolves for real', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1, 2]);
  const evicted = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  const untouched = tracker.dispatch({ epochs: [{ epoch: 2, placementRevision: 0, revisionArmed: false }] });

  const rejectedCount = tracker.evictEpoch(1); // AT PUBLICATION -- no response ever needs to arrive

  assert.equal(rejectedCount, 1);
  await assert.rejects(evicted.promise, ModelEvictedError);
  assert.equal(tracker.isPending(untouched.requestId), true);
  worker.onmessage({ data: validEchoFor(tracker, untouched) });
  assert.deepEqual(await untouched.promise, { epoch: 2, fragmentIds: [] });
  assert.equal(tracker.pendingCount(), 0);
});

test('(c) model reload producing a NEW epoch — old-epoch request rejected, new-epoch request resolves for real', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  const oldReq = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });

  const rejectedCount = tracker.evictEpoch(1); // reload: old epoch evicted
  tracker.setLiveEpochs([2]); // ...new epoch becomes live
  const newReq = tracker.dispatch({ epochs: [{ epoch: 2, placementRevision: 0, revisionArmed: false }] });

  assert.equal(rejectedCount, 1);
  await assert.rejects(oldReq.promise, ModelEvictedError);
  assert.equal(tracker.isPending(newReq.requestId), true);
  worker.onmessage({ data: validEchoFor(tracker, newReq) });
  assert.deepEqual(await newReq.promise, { epoch: 2, fragmentIds: [] });
});

test('(d) invalidateModelPlacement mid-flight — ARMED (TLAS) rejects, UNARMED (linear) does NOT and still resolves for real', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  tracker.setPlacementRevision(1, 0);
  const armedReq = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: true }] });
  const unarmedReq = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });

  const rejectedCount = tracker.invalidatePlacement(1); // bumps the live revision AND sweeps armed requests

  assert.equal(rejectedCount, 1);
  await assert.rejects(armedReq.promise, ModelPlacementChangedError);
  assert.equal(tracker.isPending(unarmedReq.requestId), true, 'the unarmed (linear) request must NOT be rejected');
  worker.onmessage({ data: validEchoFor(tracker, unarmedReq) }); // proves it is not permanently stuck
  assert.deepEqual(await unarmedReq.promise, { epoch: 1, fragmentIds: [] });
});

test('(e) two concurrent requests, responses OUT OF ORDER — each settles its own caller, neither cancels the other', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  const first = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  const second = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });

  worker.onmessage({ data: validEchoFor(tracker, second, { tag: 'second-arrived-first' }) });
  worker.onmessage({ data: validEchoFor(tracker, first, { tag: 'first-arrived-second' }) });

  assert.equal((await first.promise).tag, 'first-arrived-second');
  assert.equal((await second.promise).tag, 'second-arrived-first');
  assert.equal(tracker.pendingCount(), 0);
});

test('(f) a DUPLICATE response for an already-settled requestId — discarded silently, nothing disturbed', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  const req = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  const echo = validEchoFor(tracker, req);

  const first = worker.onmessage({ data: { ...echo, result: { ...echo.result, v: 1 } } });
  const duplicate = worker.onmessage({ data: { ...echo, result: { ...echo.result, v: 2 } } });

  assert.equal(first.outcome, 'resolved');
  assert.equal(duplicate.outcome, 'discarded-silent');
  assert.deepEqual(await req.promise, { epoch: 1, fragmentIds: [], v: 1 });
  assert.equal(tracker.pendingCount(), 0);
});

test('(g) a malformed response naming an UNKNOWN EPOCH — request-local TypeError-class rejection, other pending request untouched', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  const bad = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  const good = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });

  const outcome = worker.onmessage({ data: validEchoFor(tracker, bad, { epoch: 999 }) }); // never captured

  assert.equal(outcome.outcome, 'rejected');
  await assert.rejects(bad.promise, MalformedResponseError);
  await assert.rejects(bad.promise, TypeError);
  assert.equal(tracker.isPending(good.requestId), true);
  worker.onmessage({ data: validEchoFor(tracker, good) });
  await assert.doesNotReject(good.promise);
});

test('(g″) a malformed response naming an UNKNOWN FRAGMENT ID — distinct schema failure from unknown-epoch', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  const req = tracker.dispatch({
    epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }],
    knownFragmentIds: [10, 11],
  });

  const outcome = worker.onmessage({ data: validEchoFor(tracker, req, { fragmentIds: [10, 999] }) });

  assert.equal(outcome.outcome, 'rejected');
  assert.equal(outcome.reason, 'schema-invalid');
  await assert.rejects(req.promise, MalformedResponseError);
});

test('(g‴) unattributable message (no usable requestId) — PROTOCOL-FATAL: rejects every entry, clears the map, discards the worker', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  const a = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  const b = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });

  for (const badMessage of [{ garbage: true }, { requestId: 'not-a-number' }, { requestId: 1.5 }, { requestId: -1 }, { requestId: NaN }]) {
    const freshTracker = createRequestTracker();
    const freshWorker = makeFakeWorker();
    freshTracker.attachWorker(freshWorker);
    freshTracker.setLiveEpochs([1]);
    const req = freshTracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
    const outcome = freshWorker.onmessage({ data: badMessage });
    assert.equal(outcome.outcome, 'protocol-fatal', `expected protocol-fatal for ${JSON.stringify(badMessage)}`);
    await assert.rejects(req.promise, ProtocolFaultError);
  }

  const outcome = worker.onmessage({ data: { garbage: true } });
  assert.equal(outcome.outcome, 'protocol-fatal');
  assert.equal(outcome.errorName, 'ProtocolFaultError');
  await assert.rejects(a.promise, ProtocolFaultError);
  await assert.rejects(b.promise, ProtocolFaultError);
  assert.equal(tracker.pendingCount(), 0);
  assert.equal(worker.onmessage, null, 'the discarded worker must be fully detached');
  assert.throws(() => tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] }), /no worker attached/);
  assert.throws(() => tracker.attachWorker(worker), /cannot reattach a discarded worker instance/);
});

test('(h) worker onerror mid-request — rejects EVERY in-flight request with WorkerFaultError, terminates and detaches the worker, forbids reattachment', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  let terminateCalled = false;
  worker.terminate = () => { terminateCalled = true; };
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  const a = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  const b = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: true }] });

  worker.onerror({ message: 'scripted crash' }); // real ErrorEvent-shaped payload

  await assert.rejects(a.promise, WorkerFaultError);
  await assert.rejects(b.promise, WorkerFaultError);
  assert.equal(tracker.pendingCount(), 0);
  assert.equal(terminateCalled, true, 'the tracker must terminate the faulted worker itself, not rely on the caller remembering to');
  assert.equal(worker.onmessage, null);
  assert.equal(worker.onerror, null);
  assert.throws(() => tracker.attachWorker(worker), /cannot reattach a discarded worker instance/);
});

test('(h′) explicit discardWorker() (terminate() not caused by dispose or onerror) — identical all-reject-terminate-detach contract', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  let terminateCalled = false;
  worker.terminate = () => { terminateCalled = true; };
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  const req = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });

  const rejectedCount = tracker.discardWorker('explicit terminate()');

  assert.equal(rejectedCount, 1);
  await assert.rejects(req.promise, WorkerFaultError);
  assert.equal(tracker.pendingCount(), 0);
  assert.equal(terminateCalled, true);
});

test('post-fault recovery: same tracker, unchanged world generation, a genuinely FRESH worker instance, next dispatch succeeds', async () => {
  const tracker = createRequestTracker();
  const worker1 = makeFakeWorker();
  tracker.attachWorker(worker1);
  tracker.setLiveEpochs([1]);
  const doomed = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  worker1.onerror({ message: 'crash' });
  await assert.rejects(doomed.promise, WorkerFaultError);

  const worker2 = makeFakeWorker(); // a genuinely different object -- not worker1
  assert.notEqual(worker2, worker1);
  tracker.attachWorker(worker2); // must succeed: worker2 was never discarded
  tracker.setLiveEpochs([1]); // cache/live-state repopulation is the caller's job, exercised here directly

  const recovered = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  worker2.onmessage({ data: validEchoFor(tracker, recovered) });
  assert.deepEqual(await recovered.promise, { epoch: 1, fragmentIds: [] });
  assert.equal(tracker.pendingCount(), 0);
});

test('dispatch-time failure: postMessage() throwing synchronously still settles the promise (rejects), never left pending', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  worker.postMessage = () => { throw new Error('DataCloneError-ish'); };
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);

  const req = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });

  await assert.rejects(req.promise, WorkerFaultError);
  assert.equal(tracker.pendingCount(), 0);
});

test('dispatch envelope: `extra` cannot spoof requestId/workerGeneration/worldGeneration/epochs on the wire', () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);

  const req = tracker.dispatch({
    epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }],
    extra: { requestId: 'evil', workerGeneration: 999, worldGeneration: 999, epochs: 'evil', kind: 'echo' },
  });

  const wireMessage = worker.sent[0];
  assert.equal(wireMessage.requestId, req.requestId);
  assert.equal(wireMessage.workerGeneration, 1);
  assert.equal(wireMessage.worldGeneration, 1);
  assert.deepEqual(wireMessage.epochs, [{ epoch: 1, placementRevision: 0, revisionArmed: false }]);
  assert.equal(wireMessage.kind, 'echo', '`extra` fields that do NOT collide with protocol fields still pass through');
});

test('captured epoch snapshot is immutable — mutating the caller\'s array after dispatch does not affect RequestState', () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  const epochs = [{ epoch: 1, placementRevision: 0, revisionArmed: false }];

  const req = tracker.dispatch({ epochs });
  epochs[0].placementRevision = 999; // mutate the caller's own array after dispatch
  epochs.push({ epoch: 2, placementRevision: 0, revisionArmed: false });

  const captured = tracker.__capturedStateForTest(req.requestId);
  assert.equal(captured.epochs.length, 1);
  assert.equal(captured.epochs[0].placementRevision, 0, 'the snapshot taken AT DISPATCH must be untouched by later mutation of the caller\'s array');
});

test('dispatch() rejects a captured epoch set containing a duplicate epoch', () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  assert.throws(() => tracker.dispatch({
    epochs: [
      { epoch: 1, placementRevision: 0, revisionArmed: false },
      { epoch: 1, placementRevision: 0, revisionArmed: true },
    ],
  }), /duplicate epoch/);
});

test('echo integrity: a coerced/type-mismatched echoed epoch (string, wrong type) does NOT match the captured numeric/boolean set', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  const req = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  const captured = tracker.__capturedStateForTest(req.requestId);

  const outcome = worker.onmessage({
    data: {
      requestId: req.requestId,
      workerGeneration: captured.workerGeneration,
      worldGeneration: captured.worldGeneration,
      epochs: [{ epoch: '1', placementRevision: '0', revisionArmed: 0 }], // coerced-equal, not type-equal
      result: { epoch: 1, fragmentIds: [] },
    },
  });

  assert.equal(outcome.outcome, 'rejected');
  assert.equal(outcome.errorName, 'MalformedResponseError');
  await assert.rejects(req.promise, MalformedResponseError);
});

test('precedence (1 of 3): disposed -> generation -> evicted -> armed-placement — GENERATION wins over evicted+placement', async () => {
  const tracker = createRequestTracker({ worldGeneration: 1 });
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  tracker.setPlacementRevision(1, 0);
  const req = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: true }] });
  const echo = validEchoFor(tracker, req);

  tracker.__bumpWorldGenerationForTest(); // lazy -- no proactive sweep, exactly what makes this race constructible
  tracker.setLiveEpochs([]); // now ALSO "evicted" if that check ran
  tracker.setPlacementRevision(1, 99); // now ALSO "placement changed" if that check ran

  const outcome = worker.onmessage({ data: echo });

  assert.equal(outcome.outcome, 'rejected');
  assert.equal(outcome.errorName, 'WorldDisposedError');
  assert.equal(outcome.reason, 'generation-mismatch');
  // Task 3.10 fix (real defect in this task's own brief, caught by running its Step 1 file for
  // real): the three precedence tests as written asserted ONLY the returned outcome object and
  // never touched `req.promise`, which handleMessage has by then REJECTED. Node's test runner
  // reports that as "generated asynchronous activity after the test ended ... triggered an
  // unhandledRejection event" and fails the whole FILE (exit 1) even though all 23 subtests pass
  // individually -- so the brief's own Step 4 "all tests pass" expectation was unreachable as
  // written. Awaiting the rejection here both silences that and strengthens the test: it now
  // proves the CALLER'S promise really settled with the named class, not merely that the outcome
  // object describing it says so.
  await assert.rejects(req.promise, WorldDisposedError);
});

test('precedence (2 of 3): EVICTED wins over armed-placement-changed', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  tracker.setPlacementRevision(1, 0);
  const req = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: true }] });
  const echo = validEchoFor(tracker, req);

  tracker.setLiveEpochs([]); // now evicted
  tracker.setPlacementRevision(1, 99); // now ALSO placement-changed if that check ran

  const outcome = worker.onmessage({ data: echo });

  assert.equal(outcome.outcome, 'rejected');
  assert.equal(outcome.errorName, 'ModelEvictedError');
  await assert.rejects(req.promise, ModelEvictedError); // see the (1 of 3) note above
});

test('precedence (3 of 3): DISPOSED wins over generation, evicted, and armed-placement', async () => {
  const tracker = createRequestTracker({ worldGeneration: 1 });
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  tracker.setPlacementRevision(1, 0);
  const req = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: true }] });
  const echo = validEchoFor(tracker, req);

  tracker.__setDisposedForTest(); // lazy flag only, no sweep -- see the module comment on why this
                                   // branch is normally unreachable through the real disposeWorld()
  tracker.__bumpWorldGenerationForTest();
  tracker.setLiveEpochs([]);
  tracker.setPlacementRevision(1, 99);

  const outcome = worker.onmessage({ data: echo });

  assert.equal(outcome.outcome, 'rejected');
  assert.equal(outcome.errorName, 'WorldDisposedError');
  assert.equal(outcome.reason, 'disposed');
  await assert.rejects(req.promise, WorldDisposedError); // see the (1 of 3) note above
});

test('request-ID/workerGeneration reuse safety (message side): a late response echoing a REPLACED worker’s generation is discarded silently', async () => {
  const tracker = createRequestTracker();
  const worker1 = makeFakeWorker();
  tracker.attachWorker(worker1); // workerGeneration -> 1
  tracker.setLiveEpochs([1]);
  const staleReq = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });

  worker1.onerror({ message: 'crash' }); // rejects staleReq, terminates+detaches+discards worker1
  await assert.rejects(staleReq.promise, WorkerFaultError);
  assert.equal(worker1.onmessage, null, 'the old worker’s own callback must be disconnected -- it cannot affect the new worker');

  const worker2 = makeFakeWorker();
  tracker.attachWorker(worker2); // workerGeneration -> 2
  const freshReq = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  assert.ok(freshReq.requestId > staleReq.requestId, 'requestId must remain monotonic across replacement, never reused');

  // The concrete failure scenario the review named: a hand-crafted late message from the REPLACED
  // (generation-1) worker that happens to name freshReq's own requestId. A correct tracker must
  // discard this on workerGeneration alone, before it ever reaches requestId-keyed settlement.
  const captured = tracker.__capturedStateForTest(freshReq.requestId);
  const staleFromReplacedWorker = {
    requestId: freshReq.requestId,
    workerGeneration: 1, // stale -- current is 2
    worldGeneration: captured.worldGeneration,
    epochs: captured.epochs,
    result: { epoch: 1, fragmentIds: [], tag: 'must-not-settle-freshReq' },
  };
  const outcome = tracker.__handleRawMessageForTest(staleFromReplacedWorker);

  assert.equal(outcome.outcome, 'discarded-silent');
  assert.equal(outcome.reason, 'stale-worker-generation');
  assert.equal(tracker.isPending(freshReq.requestId), true);

  worker2.onmessage({ data: validEchoFor(tracker, freshReq, { tag: 'genuine-worker2-response' }) });
  assert.deepEqual(await freshReq.promise, { epoch: 1, fragmentIds: [], tag: 'genuine-worker2-response' });
});

test('request-ID/workerGeneration reuse safety (request-state side): current-generation message for a request whose OWN captured generation is stale is also discarded', async () => {
  // Constructs the case where attachWorker() replaces the worker WHILE an older-generation
  // request is still (unusually) present in the map -- proving the guard does not depend on the
  // bulk-clear-on-fault path having already run for every entry.
  const tracker = createRequestTracker();
  const worker1 = makeFakeWorker();
  tracker.attachWorker(worker1); // generation 1
  tracker.setLiveEpochs([1]);
  const staleReq = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  const staleCaptured = tracker.__capturedStateForTest(staleReq.requestId);

  const worker2 = makeFakeWorker();
  tracker.attachWorker(worker2); // generation 2 -- staleReq is still in the map, NOT auto-rejected
  assert.equal(tracker.isPending(staleReq.requestId), true);

  // A message carrying the CURRENT generation (2) but naming staleReq's id, whose OWN RequestState
  // still records generation 1.
  const outcome = tracker.__handleRawMessageForTest({
    requestId: staleReq.requestId,
    workerGeneration: 2, // matches currentWorkerGeneration -- passes the first guard
    worldGeneration: staleCaptured.worldGeneration,
    epochs: staleCaptured.epochs,
    result: { epoch: 1, fragmentIds: [] },
  });

  assert.equal(outcome.outcome, 'discarded-silent');
  assert.equal(outcome.reason, 'request-worker-generation-mismatch');
  assert.equal(tracker.isPending(staleReq.requestId), true, 'still pending -- neither wrongly resolved nor rejected');
});

test('no unsettled promise: pendingCount() is 0 after every terminal event, across a mixed run', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1, 2]);
  const r1 = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  const r2 = tracker.dispatch({ epochs: [{ epoch: 2, placementRevision: 0, revisionArmed: false }] });
  const r3 = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });

  worker.onmessage({ data: validEchoFor(tracker, r1) }); // resolves
  tracker.evictEpoch(2); // rejects r2
  worker.onerror({ message: 'boom' }); // rejects r3, terminates+detaches+clears everything left

  await assert.doesNotReject(r1.promise);
  await assert.rejects(r2.promise, ModelEvictedError);
  await assert.rejects(r3.promise, WorkerFaultError);
  assert.equal(tracker.pendingCount(), 0);
});
