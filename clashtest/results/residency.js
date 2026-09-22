// clashtest/results/residency.js
//
// Task P5.8: resident bound, LRU-by-touch eviction, one-shot lease tokens and the persistence
// attempt state machine (spec S13.5.2, S4.2, AC-16). `createResidencyManager` owns every mutable
// fact about a run's slot and, once sealed, its resident ResultSet: whether the slot is a bare
// `active` reservation (a run still in flight, not yet sealed) or a `resident` entry (a sealed
// set, admitted by `admitSealedSet`), the entry's persistence attempt state, its outstanding lease
// count and its true-LRU touch order. `createReadCoordinator` is the separate, simpler read-slot
// counter (S13.5, `maxConcurrentStoreReads`/`maxQueuedStoreReads`).
//
// See docs/superpowers/plans/federated-clash-test-core/p5-result-set.md Task P5.8 and its Phase
// interface summary (`ResidencyManager` surface) for the governing prose; every invariant below is
// named there and is load-bearing for P6 (`run/Run.js`) and P7 (`engine.dispose()`).
//
// `limits.maxQueuedRuns` is accepted (signature parity with the full `ENGINE_LIMIT_DEFAULTS`
// shape every phase consumes) but not read here: it governs how many runs may wait BEFORE a slot
// is even attempted (a P6/engine-facade admission-queue concern), never residency's own slot
// accounting -- residency's own rule is "refuse rather than queue" (`ResultCapacityError`,
// synchronous, never a wait), which needs no queue depth of its own.

import {
  ResultCapacityError, ResultSetRetainedError, UnsavedResultSetError, ResultNotResidentError,
  ReadCapacityError, RunNotTerminalError, PersistenceOutcomeUnknownError, InvalidOptionsError,
} from '../errors.js';

const classOf = (entry) => (entry.leases > 0 ? 'retained'
  : entry.persistence.state === 'saved' ? 'evictable' : 'held');

// Normalizes an arbitrary `put` rejection reason into a plain {name, message} pair without ever
// throwing itself (codex-review finding, 2026-09-22, Medium: a promise may reject with `null`, a
// string, or an object whose `name`/`message` are throwing accessors -- reading `err.name` directly
// would then throw a SECOND time inside the attempt's own catch block, escaping `attempt()` as an
// unhandled rejection and breaking `beginPersist`/`retryPersist`'s never-unexpectedly-reject
// contract, and leaving the entry stuck at a stale `pending` state that can never be retried).
function describeError(err) {
  let name = 'Error';
  try { if (err && typeof err.name === 'string') name = err.name; } catch { /* a throwing accessor */ }
  let message = '';
  try { message = (err && typeof err.message === 'string') ? err.message : String(err); }
  catch { message = 'unknown error'; }
  return { name, message };
}

/**
 * `createResidencyManager({limits, resultStore, now, onPersistence}) -> ResidencyManager`.
 * `resultStore` may be omitted/`null` (a no-store engine): `beginPersist` then always settles
 * `skipped` with `reason: 'no-store'` and nothing is ever written or deleted.
 */
export function createResidencyManager({ limits, resultStore, now, onPersistence }) {
  const active = new Map();      // runId -> true (a reservation: a run in flight, not yet sealed)
  const resident = new Map();    // runId -> entry (see admitSealedSet for the entry shape)
  const slots = () => active.size + resident.size;

  const snapshot = (e) => ({
    state: e.persistence.state, timedOut: false, attempt: e.persistence.attempt,
    ...(e.persistence.error ? { error: e.persistence.error } : {}),
    ...(e.persistence.reason ? { reason: e.persistence.reason } : {}),
  });

  // True LRU: least-recently-TOUCHED, not least-recently-sealed. `touchSeq` is a manager-wide
  // monotonic counter, so a fake clock that never advances still gives a total, deterministic
  // order -- and so `touch(runId)` has a defined effect, which the spec's "evictable LRU" requires.
  let touchSeq = 0;
  function touch(runId) {
    const e = resident.get(runId);
    if (e === undefined) return false;
    e.lastTouchedAt = now();
    e.touchSeq = ++touchSeq;
    return true;
  }
  const lessRecent = (a, b) => (a.lastTouchedAt !== b.lastTouchedAt
    ? a.lastTouchedAt < b.lastTouchedAt : a.touchSeq < b.touchSeq);

  // Every observer call goes through here, ALWAYS after the state transition it reports is
  // already complete (P6 re-verification finding 8). A throwing observer can therefore never turn
  // a completed operation -- admission or a persistence attempt -- into an apparent failure.
  const notify = (event) => { try { onPersistence(event); } catch { /* isolated, by contract */ } };

  /** Evicts the LRU `evictable` (saved, unleased) resident set if the engine is full, or throws
   *  `ResultCapacityError` naming the blockers. A no-op when there is already room. Called ONLY
   *  from `reserveRunSlot` -- `admitSealedSet` converts a run's own slot 1:1 and never needs it. */
  function makeRoom() {
    if (slots() < limits.maxResidentResultSets) return;
    let lru = null;
    for (const [runId, e] of resident) {
      if (classOf(e) !== 'evictable') continue;
      if (lru === null || lessRecent(e, resident.get(lru))) lru = runId;
    }
    if (lru === null) {
      throw new ResultCapacityError({
        cap: limits.maxResidentResultSets,
        active: [...active.keys()],
        retained: [...resident].filter(([, e]) => classOf(e) === 'retained').map(([id]) => id),
        held: [...resident].filter(([, e]) => classOf(e) === 'held')
          .map(([id, e]) => ({ runId: id, persistence: e.persistence.state })),
      });
    }
    resident.delete(lru);
  }

  /** One persistence attempt (first or retry): runs `resultStore.put`, settles `persistence`,
   *  notifies (isolated) and returns the same {state, timedOut, attempt, error?} shape
   *  `getPersistenceState` reports. Never touches -- callers touch once the attempt has settled. */
  async function attempt(runId, entry) {
    entry.persistence = { state: 'pending', attempt: entry.persistence.attempt + 1, error: null };
    entry.writeInFlight = true;
    try {
      await resultStore.put(entry.resultSet, { signal: entry.abort.signal });
      entry.persistence = { ...entry.persistence, state: 'saved', error: null };
    } catch (err) {
      // G-REMOTE narrowing (master S1.2, deliberately NOT a gap -- confirmed against
      // p5-result-set.md's own "Narrowing recorded" text and cross-checked with codex-advisor,
      // 2026-09-22, against a reviewer finding that recommended implementing reconciliation here):
      // an UNKNOWN outcome settles `failed` with cause `ambiguous` immediately, with NO
      // reconciliation read in this build -- that read, `reconcileTimeoutMs` and detached-remote
      // disposal (`error.disposed`) are an explicitly excluded, separately-gated follow-up package
      // (master S1.2/G-REMOTE), not part of this phase's contract. `put` is create-only and
      // idempotent (P5.7), so `retryPersist` is safe whichever the truth actually was.
      // `instanceof` itself is wrapped: an exotic rejection value (e.g. a Proxy with a throwing
      // `Symbol.hasInstance` trap) must not escape as a second, unhandled exception here either
      // (codex-advisor, 2026-09-22, optional hardening for a literally-arbitrary rejection reason).
      let ambiguous = false;
      try { ambiguous = err instanceof PersistenceOutcomeUnknownError; } catch { ambiguous = false; }
      entry.persistence = {
        ...entry.persistence, state: 'failed',
        error: { ...describeError(err), ...(ambiguous ? { ambiguous: true } : {}) },
      };
    } finally {
      entry.writeInFlight = false;
    }
    const outcome = snapshot(entry);
    notify({ runId, ...outcome });
    // codex-review finding, 2026-09-22, High: `releaseResultSet(..., {acknowledgeUnsaved: true})`
    // called WHILE this very attempt was still in flight cannot free the slot synchronously (spec
    // S13.5.2: "a set whose put is still in flight keeps its slot until that write settles") -- it
    // marks `removeOnSettle` instead, and this is the one place that settlement happens. The
    // identity check (`resident.get(runId) === entry`) guards a re-entrancy hazard a codex-advisor
    // follow-up check found in the first version of this fix: `notify()` above can run ARBITRARY
    // observer code synchronously, including code that evicts THIS now-`saved`-and-evictable entry
    // and admits a brand-new one for the SAME `runId` before `notify()` returns. Without the
    // identity check, this line would then delete that brand-new entry by `runId` alone, even
    // though it is a completely different object this attempt never touched.
    //
    // Round-2 finding (task review, 2026-09-22, Critical): the identity check alone is NOT enough
    // -- it guards "the entry under this runId was swapped for a DIFFERENT one" but not "this SAME
    // entry now has a NEW write in flight". `notify()` runs after `writeInFlight` is reset to
    // `false` in the `finally` above, so an observer that synchronously calls `retryPersist(runId)`
    // from inside this very callback passes ITS `state === 'failed'` guard, starts attempt N+1, and
    // sets `entry.writeInFlight = true` again -- all before control returns here. Without the
    // `!entry.writeInFlight` conjunct, this line would then delete an entry whose SECOND write is
    // still live, exceeding the hard bound and letting a subsequent `discardRun` resurrect it --
    // reopening both original findings via a different trigger.
    if (entry.removeOnSettle && !entry.writeInFlight && resident.get(runId) === entry) {
      resident.delete(runId);
    }
    return outcome;
  }

  // --- reservations --------------------------------------------------------------------------
  const reservationHeld = (runId) => active.has(runId);      // never throws, incl. for unknown ids

  function reserveRunSlot(runId) {
    // codex-review finding, 2026-09-22, Important: a runId that already holds ANY slot -- an
    // active reservation or a resident (sealed) entry -- needs no new slot. Without this guard,
    // `makeRoom()` ran unconditionally: a duplicate reserve on an already-active id could evict an
    // unrelated saved set for nothing (or throw a spurious `ResultCapacityError` if nothing else
    // were evictable), and a duplicate reserve on an already-resident id double-counted the slot,
    // permanently wedging `admitSealedSet` (which refuses a `resident.has(runId)` id) behind a
    // phantom reservation only `releaseRunSlot` could clear. Idempotent no-op, matching this
    // module's own convention elsewhere (`releaseResultSet` on a nonresident id, a spent lease
    // token) rather than a throw, since no `runId` collision error is named for this case.
    if (active.has(runId) || resident.has(runId)) return;
    makeRoom();                     // evicts an evictable resident set if full, else throws synchronously
    active.set(runId, true);
  }

  function releaseRunSlot(runId) {
    active.delete(runId);
  }

  /** ATOMIC AND EXCEPTION-SAFE (P6 re-verification finding 8 / its question 1). Everything that
   *  can fail runs BEFORE the first mutation; after it, only infallible map writes remain. So the
   *  caller's rule is simple and needs no guessing: `admitSealedSet` either fully converted the
   *  reservation, or it threw and `reservationHeld(runId)` is still true. */
  function admitSealedSet(runId, resultSet) {
    // ---- validation phase: no state has been touched yet ----
    if (!active.has(runId)) throw new ResultNotResidentError({ runId });
    if (resident.has(runId)) throw new ResultNotResidentError({ runId });   // double admission
    if (resultSet === null || typeof resultSet !== 'object' || resultSet.sealed !== true) {
      const err = new TypeError('admitSealedSet: only a sealed Result Set may become resident');
      err.code = 'ERR_RESULT_SET_NOT_SEALED';
      throw err;
    }
    const entry = {                                 // built fully before anything is published
      resultSet, sealedAt: now(), lastTouchedAt: now(), touchSeq: ++touchSeq, leases: 0,
      persistence: { state: 'pending', attempt: 0, error: null },
      writeInFlight: false, inFlight: null, abort: new AbortController(), removeOnSettle: false,
    };
    // ---- mutation phase: infallible from here ----
    active.delete(runId);                           // sealing converts the run's OWN slot, so this
    resident.set(runId, entry);                     // pair never needs `makeRoom` (S13.5.2)
    // No observer call here (codex-advisor, 2026-09-22, confirmed against spec S13.5.1): `done`,
    // `persisted`, `getPersistenceState` and the `'persistence'` event observe ONLY a settled
    // persistence ATTEMPT, and admission is not an attempt (there is no attempt 0). The isolated
    // `notify` below is exercised on the persistence path only, in `attempt()`.
  }

  // --- persistence attempts --------------------------------------------------------------------
  async function beginPersist(runId, { persist }) {
    const entry = resident.get(runId);
    if (entry === undefined) throw new ResultNotResidentError({ runId });
    // codex-review finding, 2026-09-22, High: nothing previously stopped a second, OVERLAPPING
    // `beginPersist` call on the same run -- both attempts shared `persistence`/`writeInFlight`/
    // `inFlight`/the abort controller, so whichever settled FIRST cleared `writeInFlight` while the
    // other was still running. `discardRun`, seeing `writeInFlight: false`, then deleted the
    // durable copy without waiting for or aborting the second write -- which later resurrected it.
    // `beginPersist` is legal only from the fresh post-admission state (exactly once, ever); a
    // retry goes through `retryPersist`, which is naturally guarded the same way (see below).
    if (entry.persistence.state !== 'pending' || entry.persistence.attempt !== 0) {
      throw new InvalidOptionsError({ issues: [{ path: 'runId', code: 'already-started' }] });
    }
    if (!resultStore || persist === false) {
      entry.persistence = {
        state: 'skipped', attempt: entry.persistence.attempt, error: null,
        reason: persist === false ? 'persist-false' : 'no-store',
      };
      touch(runId);
      const outcome = snapshot(entry);
      notify({ runId, ...outcome });
      return outcome;
    }
    const inFlight = attempt(runId, entry);
    entry.inFlight = inFlight;
    const outcome = await inFlight;
    touch(runId);
    return outcome;
  }

  function getPersistenceState(runId) {
    const entry = resident.get(runId);
    return entry === undefined ? null : snapshot(entry);
  }

  async function retryPersist(runId) {
    const entry = resident.get(runId);
    if (entry === undefined) throw new ResultNotResidentError({ runId });
    // Naturally guarded against a concurrent second call the same way `beginPersist` is now
    // guarded explicitly above: `attempt()` flips `persistence.state` to `pending` SYNCHRONOUSLY,
    // before its first `await` -- so two `retryPersist('a')` calls issued back-to-back (even via
    // `Promise.all`) can never both observe `state === 'failed'` here; the second always sees the
    // first's already-in-flight `pending` state and is refused below.
    if (entry.persistence.state !== 'failed') {
      throw new InvalidOptionsError({ issues: [{ path: 'runId', code: 'not-failed' }] });
    }
    const inFlight = attempt(runId, entry);
    entry.inFlight = inFlight;
    const outcome = await inFlight;
    touch(runId);
    return outcome;
  }

  // --- retain leases are ONE-SHOT (review Important 4) -----------------------------------------
  // Each call mints a FRESH token that decrements exactly once. A second `release()` on the same
  // token is a no-op -- never a second decrement -- so a double release can never under-count live
  // leases and make a still-retained set evictable. The token closes over `entry` (not `runId`),
  // so a release after the entry was evicted/released/discarded decrements the (now unreferenced,
  // orphaned) entry and touches nothing live -- it can never corrupt a NEW entry that later reuses
  // the same runId.
  function retainResultSet(runId) {
    const entry = resident.get(runId);
    if (entry === undefined) throw new ResultNotResidentError({ runId });
    if (entry.persistence.state !== 'saved') throw new UnsavedResultSetError({ runId });
    entry.leases += 1;
    touch(runId);
    let spent = false;
    return {
      release() {
        if (spent) return;                              // idempotent: later calls do nothing
        spent = true;
        entry.leases -= 1;
        touch(runId);                                    // no-op once the entry is no longer resident
      },
    };
  }

  function releaseResultSet(runId, { acknowledgeUnsaved = false } = {}) {
    const entry = resident.get(runId);
    if (entry === undefined) return;                      // idempotent no-op: nonresident/unknown ids
    if (entry.leases > 0) throw new ResultSetRetainedError({ runId });
    if (entry.persistence.state !== 'saved' && !acknowledgeUnsaved) {
      throw new UnsavedResultSetError({ runId });
    }
    // codex-review finding, 2026-09-22, High: an acknowledged release while a `put` is still in
    // flight (`entry.persistence.state` is `pending`, not `saved`, precisely while `writeInFlight`
    // is true) must NOT free the slot synchronously here -- spec S13.5.2 is explicit that "a set
    // whose put is still in flight keeps its slot until that write settles". Deleting immediately
    // would let the hard `maxResidentResultSets` bound be exceeded by repeatedly starting a write,
    // acknowledging and releasing it, and admitting again, while the original write (and its
    // Result Set, held alive by `attempt()`'s own closure) is still outstanding. `attempt()`'s own
    // completion is the one place settlement is observed, so it performs the actual removal.
    if (entry.writeInFlight) { entry.removeOnSettle = true; return; }
    resident.delete(runId);
  }

  /** `discardRun` is valid only for a terminal run: an `active` (reservation-only, not yet sealed)
   *  id rejects `RunNotTerminalError`. A resident set's in-flight write is awaited (never abandoned
   *  -- "a set whose put is still in flight keeps its slot until that write settles") and its
   *  abort signal is raised so a cooperating store may settle sooner; the durable copy is then
   *  deleted whether or not the id was ever resident here (a nonresident/unknown id still issues
   *  the store delete, per S13.5.2's nonresident-id rules), and with no store configured this is
   *  simply the resident-copy release (nothing to delete). */
  async function discardRun(runId) {
    if (active.has(runId)) throw new RunNotTerminalError({ runId });
    const entry = resident.get(runId);
    if (entry === undefined) {
      if (resultStore) await resultStore.delete(runId);
      return;
    }
    if (entry.writeInFlight) {
      entry.abort.abort();
      await entry.inFlight.catch(() => {});               // the write's own outcome is moot here
    }
    resident.delete(runId);
    if (resultStore) await resultStore.delete(runId);
  }

  function getResident(runId) {
    const entry = resident.get(runId);
    if (entry === undefined) return null;
    touch(runId);
    return entry.resultSet;
  }

  /** Never touches (reporting must not change eviction order -- a Panel that polls this would
   *  otherwise pin whatever it looked at last). */
  function retentionReport() {
    return {
      slotsInUse: slots(),
      cap: limits.maxResidentResultSets,
      active: [...active.keys()],
      sets: [...resident].map(([runId, e]) => ({
        runId, class: classOf(e), leases: e.leases, persistence: e.persistence.state,
      })),
    };
  }

  /** `dispose()`'s residency-side drain (P7). Never waits for an in-flight write: an entry whose
   *  write is in flight is named in `persistenceInFlight` and left exactly as-is (the write
   *  continues detached; a later settle changes nothing observable through a disposed engine).
   *  Every other resident set that is not `saved` is unsaved data the engine would otherwise lose
   *  silently, so it is handed back whole in `droppedUnsaved` (ownership transferred -- ie. the
   *  engine retains none of it). Never touches. */
  function drainForDispose() {
    const droppedUnsaved = [];
    const persistenceInFlight = [];
    for (const [runId, entry] of resident) {
      if (entry.writeInFlight) {
        persistenceInFlight.push(runId);
        // codex-review finding, 2026-09-22, Medium: raise the abort signal for every in-flight
        // write before clearing residency -- a cooperating backend may then settle promptly and
        // release its own resources, exactly as `discardRun` already does. This does NOT await the
        // write (dispose never waits for one, S13.5.2/S13.5.1 item 3: "persistence continues after
        // done") and never touches `entry.persistence`/`writeInFlight` -- a backend that ignores
        // the signal simply keeps running detached, observable only through `persisted`/
        // `getPersistenceState`/the `'persistence'` event on this now-disposed manager's own
        // orphaned entry object, exactly as documented.
        entry.abort.abort();
        continue;
      }
      if (entry.persistence.state !== 'saved') droppedUnsaved.push({ runId, resultSet: entry.resultSet });
    }
    resident.clear();
    active.clear();
    return { droppedUnsaved, persistenceInFlight };
  }

  return {
    reserveRunSlot, releaseRunSlot, reservationHeld, admitSealedSet,
    beginPersist, getPersistenceState, retryPersist,
    retainResultSet, releaseResultSet, discardRun,
    getResident, touch, retentionReport, drainForDispose,
  };
}

/**
 * `createReadCoordinator({limits}) -> {reserveSync, acquire, inUse}`. Read slots for the two
 * read paths S13.5 distinguishes: `reserveSync()` is the synchronous reserve-or-reject a raw-set
 * read uses (never queues); `acquire()` is the FIFO-queued form a by-id read uses, queuing up to
 * `maxQueuedStoreReads` deep before it too rejects.
 */
export function createReadCoordinator({ limits }) {
  let count = 0;
  const queue = [];          // FIFO of {resolve}

  function makeSlot() {
    let released = false;
    return {
      release() {
        if (released) return;                              // one-shot, same discipline as a lease
        released = true;
        if (queue.length > 0) {
          const { resolve } = queue.shift();                 // hand the slot straight to the next waiter
          resolve(makeSlot());
        } else {
          count -= 1;
        }
      },
    };
  }

  return {
    reserveSync() {
      if (count >= limits.maxConcurrentStoreReads) {
        throw new ReadCapacityError({ limit: limits.maxConcurrentStoreReads });
      }
      count += 1;
      return makeSlot();
    },
    acquire() {
      if (count < limits.maxConcurrentStoreReads) {
        count += 1;
        return Promise.resolve(makeSlot());
      }
      if (queue.length >= limits.maxQueuedStoreReads) {
        return Promise.reject(new ReadCapacityError({ limit: limits.maxQueuedStoreReads }));
      }
      return new Promise((resolve) => { queue.push({ resolve }); });
    },
    inUse() { return count; },
  };
}
