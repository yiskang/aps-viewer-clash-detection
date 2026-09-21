// spike/m4/s3-s4-worker-lifecycle/request-tracker.mjs
//
// M4 Task 3.10: the ONE protocol implementation of §10.1 ("request state is per-call, never
// global") and §10.2 (the receipt-time acceptance predicate and its exact settlement matrix).
// Both test/performance/m4/request-tracker.test.mjs (fake-but-real-shaped worker object) and the
// live S4' driver in run-gate-m4.mjs (a real dedicated Worker via page.html) import this file
// unmodified and drive it through the SAME attachWorker()-installed onmessage/onerror handlers --
// there is no second, simplified state machine anywhere in this task.

export class WorldDisposedError extends Error {
  constructor(message) { super(message); this.name = 'WorldDisposedError'; }
}
export class ModelEvictedError extends Error {
  constructor(message) { super(message); this.name = 'ModelEvictedError'; }
}
export class ModelPlacementChangedError extends Error {
  constructor(message) { super(message); this.name = 'ModelPlacementChangedError'; }
}
// TypeError-class, per §10.2 step 3: "a TypeError-class error naming the request".
export class MalformedResponseError extends TypeError {
  constructor(message) { super(message); this.name = 'MalformedResponseError'; }
}
export class WorkerFaultError extends Error {
  constructor(message) { super(message); this.name = 'WorkerFaultError'; }
}
export class ProtocolFaultError extends Error {
  constructor(message) { super(message); this.name = 'ProtocolFaultError'; }
}

// A usable requestId is a POSITIVE integer -- requestId is a monotonically increasing counter
// starting at 1 (§10.1, see `nextRequestId` below), never a string/object/NaN/fractional/negative
// value, and never 0. Anything else is unattributable.
//
// (The brief's own comment here said "non-negative integer", which would admit 0; the code it
// annotates has always required `>= 1`, and 0 is verified protocol-fatal. Corrected rather than
// left to mislead a reader of the ONE canonical protocol implementation -- comment change only,
// no behavior change.)
function hasUsableRequestId(raw) {
  return raw != null && typeof raw === 'object'
    && typeof raw.requestId === 'number'
    && Number.isInteger(raw.requestId)
    && raw.requestId >= 1;
}

// Strict, type-checked structural equality between the epoch set CAPTURED at dispatch and the
// epoch set ECHOED in the response -- "same generation, same epochs, no omissions, no extras, no
// duplicates, and matching captured revisions and arming flags" (§10.2). A type-coerced value (a
// string "1" where a numeric 1 was captured, a truthy 1 where a boolean true was captured) is
// treated as a mismatch, not a match -- dispatch() itself guarantees the CAPTURED side never
// contains a duplicate epoch (see dispatch() below), so a plain sorted tuple comparison here
// correctly enforces "no duplicates" on the echoed side as well (an echo with a duplicate simply
// cannot align 1:1 with the (duplicate-free) captured set and fails the length/tuple check).
function normalizeEchoedEpoch(e) {
  if (e == null || typeof e !== 'object') return null;
  const { epoch, placementRevision, revisionArmed } = e;
  if (typeof epoch !== 'number' || typeof placementRevision !== 'number' || typeof revisionArmed !== 'boolean') return null;
  return { epoch, placementRevision, revisionArmed };
}
function epochTupleKey(e) { return JSON.stringify([e.epoch, e.placementRevision, e.revisionArmed]); }
function epochsExactlyMatch(captured, echoed) {
  if (!Array.isArray(echoed) || echoed.length !== captured.length) return false;
  const normalized = echoed.map(normalizeEchoedEpoch);
  if (normalized.some((e) => e === null)) return false;
  const a = captured.map(epochTupleKey).sort();
  const b = normalized.map(epochTupleKey).sort();
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Payload/schema validation (§10.2 step 3): result.epoch must be one of the epochs THIS request
// captured, and every fragmentId in the result must be one of the fragment ids the caller declared
// known for this request at dispatch time -- this spike has no real geometry/model to consult
// (§17 bounds S4' to "no real geometry"), so the caller supplies the known-fragment universe
// explicitly via dispatch()'s `knownFragmentIds`, standing in for what the real production caller
// would read from the model/BVH sync state at dispatch time.
function isValidResultPayload(raw, capturedEpochs, knownFragmentIds) {
  if (raw == null || typeof raw !== 'object') return false;
  const result = raw.result;
  if (result == null || typeof result !== 'object') return false;
  if (typeof result.epoch !== 'number') return false;
  if (!capturedEpochs.some((e) => e.epoch === result.epoch)) return false; // "unknown epoch"
  if (!Array.isArray(result.fragmentIds)) return false;
  if (!result.fragmentIds.every((id) => knownFragmentIds.has(id))) return false; // "unknown fragment id"
  return true;
}

export function createRequestTracker({ worldGeneration = 1 } = {}) {
  const pending = new Map(); // requestId -> RequestState. EVERY settlement path (individual or
                              // bulk) DELETES its entry immediately -- §10.2's "requestId not in
                              // the map -> discard silently" row applies equally to an
                              // already-settled id; there is no separate "settled but retained"
                              // state, and pending.size is always the true outstanding count.
  let nextRequestId = 1; // monotonic, NEVER reused for the lifetime of this world (§10.1)
  let currentWorkerGeneration = 0;
  let attachedWorker = null;
  let worldDisposed = false;
  let currentWorldGeneration = worldGeneration;
  const liveEpochs = new Set();
  const placementRevisionByEpoch = new Map();
  const discardedWorkerInstances = new WeakSet(); // a discarded worker object is NEVER reattached

  function finalize(state, kind, value) {
    if (!pending.has(state.requestId)) return false; // already settled and removed
    pending.delete(state.requestId);
    if (kind === 'resolve') state.settle(value); else state.reject(value);
    return true;
  }

  function detachWorker() {
    if (attachedWorker) {
      attachedWorker.onmessage = null;
      attachedWorker.onerror = null;
      discardedWorkerInstances.add(attachedWorker);
    }
    attachedWorker = null;
  }

  // Rejects every still-pending entry, clears the map, terminates and detaches the worker. Used
  // by BOTH the automatic onerror handler and the explicit discardWorker() method, so "a real
  // onerror event" and "an explicit terminate() the caller initiates" (§10.4 (h)'s two halves) get
  // IDENTICAL treatment -- neither can leave a request pending because the caller forgot a second
  // call, and neither can leave the real worker un-terminated.
  function faultAndDiscard(err) {
    let count = 0;
    for (const state of Array.from(pending.values())) {
      if (finalize(state, 'reject', err)) count++;
    }
    if (attachedWorker) {
      try { attachedWorker.terminate?.(); } catch { /* already dead -- fine */ }
    }
    detachWorker();
    return count;
  }

  function handleMessage(raw) {
    // Step 1 (§10.2): routing-envelope validation -- attribution only.
    if (!hasUsableRequestId(raw)) {
      const err = new ProtocolFaultError('unattributable message: no usable (integer) requestId');
      const count = faultAndDiscard(err);
      return { outcome: 'protocol-fatal', errorName: err.name, rejectedCount: count };
    }
    const requestId = raw.requestId;

    // codex-review fix (Important #1, empirically reproduced -- partial, see below): a
    // STRUCTURALLY INVALID workerGeneration (missing, non-integer, < 1) is a routing-envelope
    // defect, not a stale-but-legitimate generation. Silently discarding it -- what the guard below
    // did for every non-matching value alike -- left the named request pending FOREVER when the
    // CURRENT worker produced it (version skew, a worker-side bug that drops the field). There is no
    // timeout anywhere in this protocol, so "pending forever" is terminal, and it violates the one
    // invariant this module exists to guarantee. Probe output before the fix, for a current-worker
    // response omitting the field entirely:
    //   {"outcome":"discarded-silent","reason":"stale-worker-generation"} | promise: PENDING | pendingCount: 1
    // It is now a REQUEST-LOCAL MalformedResponseError (not protocol-fatal: exactly one request is
    // identified and only that request's contract is in question), so the promise always settles.
    //
    // Scoped deliberately to STRUCTURALLY invalid values. A well-formed but non-current generation
    // still falls through to the silent discard below, because the brief's "reuse safety (message
    // side)" test requires exactly that -- a forged late message from a replaced worker naming a
    // live requestId must be discarded WITHOUT disturbing that request, which then resolves
    // normally. codex-review would have rejected that case too; that half is a genuine conflict
    // with an explicit brief test and is flagged in this task's report for a controller ruling
    // rather than resolved here.
    if (!Number.isInteger(raw.workerGeneration) || raw.workerGeneration < 1) {
      const named = pending.get(requestId);
      if (named && named.workerGeneration === currentWorkerGeneration) {
        finalize(named, 'reject', new MalformedResponseError(`request ${requestId}: response carries a structurally invalid workerGeneration (${String(raw.workerGeneration)})`));
        return { outcome: 'rejected', errorName: 'MalformedResponseError', reason: 'malformed-worker-generation' };
      }
      return { outcome: 'discarded-silent', reason: 'malformed-worker-generation' };
    }

    // Attribution guard #1 (message side): a response whose workerGeneration is not the CURRENT
    // worker's is discarded silently -- closes the request-ID-reuse-across-replacement gap.
    if (raw.workerGeneration !== currentWorkerGeneration) {
      return { outcome: 'discarded-silent', reason: 'stale-worker-generation' };
    }

    const state = pending.get(requestId);
    if (!state) {
      return { outcome: 'discarded-silent', reason: 'unknown-or-already-settled-requestId' };
    }
    // Attribution guard #2 (request side): the request's OWN captured workerGeneration must ALSO
    // match current -- closes the same gap even if a request from a superseded generation is
    // somehow still in the map when a message carrying the CURRENT generation arrives (e.g.
    // attachWorker() replacing a worker while older requests remain pending).
    if (state.workerGeneration !== currentWorkerGeneration) {
      return { outcome: 'discarded-silent', reason: 'request-worker-generation-mismatch' };
    }

    // Step 2 (§10.2): lifecycle matrix, evaluated against the epoch set CAPTURED AT DISPATCH,
    // never against the response's own epoch list. Precedence: disposed -> generation -> evicted
    // -> armed-epoch placement revision. (disposeWorld() proactively rejects-and-clears
    // synchronously, so the lazy `worldDisposed` branch below is normally unreachable in-process
    // for a message that arrives after a real dispose -- it is retained as the defensive backstop
    // the table specifies; __setDisposedForTest() exists solely to exercise it directly.)
    if (worldDisposed) {
      finalize(state, 'reject', new WorldDisposedError('world disposed'));
      return { outcome: 'rejected', errorName: 'WorldDisposedError', reason: 'disposed' };
    }
    if (state.worldGeneration !== currentWorldGeneration) {
      finalize(state, 'reject', new WorldDisposedError('world generation mismatch'));
      return { outcome: 'rejected', errorName: 'WorldDisposedError', reason: 'generation-mismatch' };
    }
    for (const e of state.epochs) {
      if (!liveEpochs.has(e.epoch)) {
        finalize(state, 'reject', new ModelEvictedError(`epoch ${e.epoch} evicted`));
        return { outcome: 'rejected', errorName: 'ModelEvictedError' };
      }
    }
    for (const e of state.epochs) {
      if (e.revisionArmed && placementRevisionByEpoch.get(e.epoch) !== e.placementRevision) {
        finalize(state, 'reject', new ModelPlacementChangedError(`epoch ${e.epoch} placement changed`));
        return { outcome: 'rejected', errorName: 'ModelPlacementChangedError' };
      }
    }

    // Step 3 (§10.2): request-local payload validation -- echo integrity first (the captured set
    // must survive the round trip EXACTLY), then result-shape/schema validation.
    if (raw.worldGeneration !== state.worldGeneration || !epochsExactlyMatch(state.epochs, raw.epochs)) {
      finalize(state, 'reject', new MalformedResponseError(`request ${requestId}: echoed generation/epoch set does not match the set captured at dispatch`));
      return { outcome: 'rejected', errorName: 'MalformedResponseError', reason: 'echo-mismatch' };
    }
    if (!isValidResultPayload(raw, state.epochs, state.knownFragmentIds)) {
      finalize(state, 'reject', new MalformedResponseError(`request ${requestId}: malformed or schema-invalid response payload`));
      return { outcome: 'rejected', errorName: 'MalformedResponseError', reason: 'schema-invalid' };
    }

    finalize(state, 'resolve', raw.result);
    return { outcome: 'resolved' };
  }

  return {
    // -- worker lifecycle --
    attachWorker(worker) {
      if (discardedWorkerInstances.has(worker)) {
        throw new Error('createRequestTracker: cannot reattach a discarded worker instance -- construct a fresh Worker');
      }
      // codex-review fix (Important #2, empirically reproduced): replacing a STILL-ATTACHED worker
      // previously left the outgoing worker's own onmessage/onerror installed and still pointing at
      // this tracker. A late `onerror` from that already-replaced worker then ran faultAndDiscard(),
      // which terminates whatever is CURRENTLY attached -- i.e. it killed the REPLACEMENT worker and
      // rejected the replacement's own unrelated in-flight requests with WorkerFaultError, while
      // leaving the actually-crashed worker running. Probe output before the fix:
      //   w1.onerror still installed after replacement? true
      //     -> w2.terminated: true   (w1.terminated: false)
      //     -> fresh (worker2's own request): REJECTED:WorkerFaultError
      // The outgoing worker is therefore neutralized here: its handlers are cleared so it can never
      // drive this tracker again, and it is marked permanently non-reattachable (the same
      // "a worker this tracker has let go is never taken back" invariant detachWorker() enforces).
      //
      // What is deliberately NOT done here, because the brief specifies otherwise: the outgoing
      // worker's still-pending requests are NOT rejected (the brief's own "reuse safety
      // (request-state side)" test asserts they remain pending, which is what makes guard #2 below
      // testable), and the outgoing worker is NOT terminated (this tracker did not construct it, and
      // that scenario leaves it a valid object in the caller's own hands). See this task's report --
      // both are flagged for a controller ruling rather than changed unilaterally.
      if (attachedWorker && attachedWorker !== worker) {
        attachedWorker.onmessage = null;
        attachedWorker.onerror = null;
        discardedWorkerInstances.add(attachedWorker);
      }
      currentWorkerGeneration += 1; // every attach, including the first, is a new generation
      attachedWorker = worker;
      worker.onmessage = (ev) => handleMessage(ev.data);
      worker.onerror = (errEvent) => {
        faultAndDiscard(new WorkerFaultError(`worker onerror: ${errEvent?.message ?? String(errEvent)}`));
      };
      return currentWorkerGeneration;
    },
    // Explicit intentional discard -- e.g. a terminate() the caller initiates that isn't itself
    // caused by an onerror event (§10.4 (h)'s "terminate() mid-request" half). Rejects every
    // pending entry, terminates and detaches the worker, and marks it permanently
    // non-reattachable -- ONE call; the caller never needs a separate worker.terminate().
    discardWorker(reason) {
      return faultAndDiscard(new WorkerFaultError(reason ?? 'worker discarded'));
    },

    // -- world lifecycle --
    // Rejects synchronously, BEFORE the caller terminates the worker, so the termination path
    // that follows finds an empty pending map and cannot re-reject an already-settled promise.
    disposeWorld(reason) {
      worldDisposed = true;
      const err = new WorldDisposedError(reason ?? 'world disposed');
      let count = 0;
      for (const state of Array.from(pending.values())) {
        if (finalize(state, 'reject', err)) count++;
      }
      return count;
    },

    // -- model/epoch live state, no sweep (construction/setup only) --
    setLiveEpochs(epochs) { liveEpochs.clear(); for (const e of epochs) liveEpochs.add(e); },
    setPlacementRevision(epoch, revision) { placementRevisionByEpoch.set(epoch, revision); },

    // -- model/epoch live state + proactive "AT PUBLICATION" sweep (§10.4 (b)/(c)/(d)) --
    evictEpoch(epoch) {
      liveEpochs.delete(epoch);
      let count = 0;
      for (const state of Array.from(pending.values())) {
        if (state.epochs.some((e) => e.epoch === epoch)) {
          if (finalize(state, 'reject', new ModelEvictedError(`epoch ${epoch} evicted`))) count++;
        }
      }
      return count;
    },
    invalidatePlacement(epoch) {
      placementRevisionByEpoch.set(epoch, (placementRevisionByEpoch.get(epoch) ?? 0) + 1);
      let count = 0;
      for (const state of Array.from(pending.values())) {
        // dispatch() rejects a captured set containing a duplicate epoch (see below), so at most
        // one entry in state.epochs can name this epoch -- .find() cannot miss a second one.
        const e = state.epochs.find((e) => e.epoch === epoch);
        if (e && e.revisionArmed) {
          if (finalize(state, 'reject', new ModelPlacementChangedError(`epoch ${epoch} placement changed`))) count++;
        }
      }
      return count;
    },

    // -- dispatch --
    // `knownFragmentIds`: the fragment ids valid for this request's captured epochs, as known by
    // the caller at dispatch time -- §10.2 step 3 requires rejecting "an unknown fragment id" in
    // the response, and this spike has no real geometry/model to consult, so the caller supplies
    // the universe explicitly (defaults to empty -- callers that don't care must also echo an
    // empty `fragmentIds` array, or validation will correctly fail).
    dispatch({ epochs, knownFragmentIds = [], extra = {} }) {
      if (!attachedWorker) throw new Error('createRequestTracker: no worker attached -- call attachWorker() first');
      if (worldDisposed) throw new WorldDisposedError('cannot dispatch: world already disposed');
      const capturedEpochs = epochs.map((e) => ({
        epoch: e.epoch, placementRevision: e.placementRevision, revisionArmed: !!e.revisionArmed,
      }));
      if (new Set(capturedEpochs.map((e) => e.epoch)).size !== capturedEpochs.length) {
        throw new Error('createRequestTracker: dispatch() epochs must not contain a duplicate epoch');
      }
      const requestId = nextRequestId++;
      let settleFn, rejectFn;
      const promise = new Promise((res, rej) => { settleFn = res; rejectFn = rej; });
      const state = {
        requestId, settle: settleFn, reject: rejectFn, // field names mirror §10.1's RequestState literally
        epochs: capturedEpochs,
        knownFragmentIds: new Set(knownFragmentIds),
        worldGeneration: currentWorldGeneration,
        workerGeneration: currentWorkerGeneration,
        issuedAt: Date.now(),
      };
      pending.set(requestId, state);
      try {
        attachedWorker.postMessage({
          ...extra, // spread FIRST -- the named fields below always win, so a caller-supplied
                    // `extra` can never spoof requestId/generations/epochs on the wire
          requestId, workerGeneration: state.workerGeneration, worldGeneration: state.worldGeneration,
          epochs: capturedEpochs,
        });
      } catch (err) {
        // postMessage can throw synchronously (DataCloneError, an already-terminated worker) --
        // §10.2's "no unsettled promise" invariant applies at dispatch time too, not only to
        // receipt-time outcomes.
        finalize(state, 'reject', new WorkerFaultError(`dispatch failed: ${err.message}`));
      }
      return { requestId, promise };
    },

    // -- introspection --
    // The true outstanding count -- every settlement path deletes its entry, so this is always
    // exactly `pending.size`, never a filtered/derived count.
    pendingCount() { return pending.size; },
    isPending(requestId) { return pending.has(requestId); },

    // -- test-only hooks (used only by request-tracker.test.mjs; never by the live driver) --
    __capturedStateForTest(requestId) {
      const state = pending.get(requestId);
      if (!state) return null;
      return { epochs: state.epochs.map((e) => ({ ...e })), worldGeneration: state.worldGeneration, workerGeneration: state.workerGeneration };
    },
    // Bumps worldGeneration WITHOUT a proactive sweep -- there is no defined production caller for
    // this distinct from disposeWorld() in this task's scope, so it is deliberately NOT part of
    // the public "world lifecycle" surface above; it exists solely to construct the receipt-time
    // generation-mismatch race the precedence tests need.
    __bumpWorldGenerationForTest() { currentWorldGeneration += 1; return currentWorldGeneration; },
    // Sets the disposed flag WITHOUT the proactive reject-and-clear sweep, purely to exercise the
    // lazy `worldDisposed` receipt-time branch and prove its precedence -- a real caller must
    // always go through disposeWorld() instead.
    __setDisposedForTest() { worldDisposed = true; },
    // Feeds a hand-crafted raw message directly into the real receipt path, for boundary cases
    // (request-ID/workerGeneration reuse) that a legitimate worker could never itself produce.
    __handleRawMessageForTest(raw) { return handleMessage(raw); },
  };
}
