// clashpanel/core/residency.js
//
// Spec §7.6 (verified against clashtest/results/residency.js + engine.js): the Panel holds AT MOST
// ONE displayed set. `retainResultSet(runId)` is a ONE-SHOT lease and throws UnsavedResultSetError
// unless persistence is `saved`; `releaseResultSet(runId, {acknowledgeUnsaved})` throws
// ResultSetRetainedError while a lease is live and UnsavedResultSetError for an unsaved set without
// the acknowledgement; releasing a non-resident id is a no-op. Errors are discriminated by
// `error.name` (spec §13 rule 4). Every engine call sits in its OWN try so no failure strands the
// next step, and nothing here ever throws to the controller (AC-P14).

export const HELD_IN_MEMORY_NOTICE = 'Results are held in memory only.';

const nameOf = (e) => (e && typeof e.name === 'string' ? e.name : 'Error');

export function createResidency({ engine }) {
  if (!engine || typeof engine.retainResultSet !== 'function' || typeof engine.releaseResultSet !== 'function'
      || typeof engine.getPersistenceState !== 'function') {
    throw new TypeError('createResidency: engine must expose retainResultSet, releaseResultSet and getPersistenceState');
  }
  /** @type {null | { runId: string, kind: 'leased'|'held-unsaved', lease: {release(): void}|null }} */
  let held = null;

  const readState = (runId) => {
    try { return engine.getPersistenceState(runId)?.state ?? null; } catch { return null; }
  };

  /** Try to turn a saved set into a lease; any refusal leaves it engine-held (never throws). */
  function tryLease(runId, errors) {
    try {
      return { kind: 'leased', lease: engine.retainResultSet(runId) };
    } catch (e) {
      errors.push(e);
      if (nameOf(e) === 'ResultNotResidentError') return { kind: 'none', lease: null };
      return { kind: 'held-unsaved', lease: null };               // UnsavedResultSetError or anything else
    }
  }

  function adopt(summary) {
    if (held !== null) throw new Error('residency.adopt: release the previously displayed set first');
    const errors = [];
    const runId = summary?.runId ?? summary?.resultSet?.runId ?? null;
    if (summary?.resultSet === null || summary?.resultSet === undefined || runId === null) {
      return { kind: 'none', notice: null, errors };             // fallback seal failed: nothing resident
    }
    const state = summary.persistence?.state;
    if (state === 'saved') {
      const r = tryLease(runId, errors);
      if (r.kind !== 'none') held = { runId, kind: r.kind, lease: r.lease };
      return { kind: r.kind, notice: r.kind === 'held-unsaved' ? HELD_IN_MEMORY_NOTICE : null, errors };
    }
    held = { runId, kind: 'held-unsaved', lease: null };
    // `pending` (persistTimeoutMs elapsed): v1 shows nothing extra unless it later fails (spec §7.6).
    return { kind: 'held-unsaved', notice: state === 'pending' ? null : HELD_IN_MEMORY_NOTICE, errors };
  }

  /** `handle.persisted` settled. The authoritative state is re-read BY ID for the CURRENT set, so a
   *  superseded run's late outcome can never upgrade or annotate the wrong set. */
  function onPersisted(/* outcome — informational only */) {
    if (held === null || held.kind !== 'held-unsaved') return { kind: held?.kind ?? 'none', notice: null, errors: [] };
    const errors = [];
    const state = readState(held.runId);
    if (state === 'saved') {
      const r = tryLease(held.runId, errors);
      if (r.kind === 'none') { held = null; return { kind: 'none', notice: null, errors }; }
      held = { runId: held.runId, kind: r.kind, lease: r.lease };
      return { kind: r.kind, notice: null, errors };
    }
    if (state === 'failed' || state === 'skipped') return { kind: 'held-unsaved', notice: HELD_IN_MEMORY_NOTICE, errors };
    return { kind: 'held-unsaved', notice: null, errors };
  }

  function current() {
    return held === null ? null : { runId: held.runId, kind: held.kind };
  }

  /** Sets whose release had a failed step: {runId, lease|null, unsaved}. Never forgotten until the engine
   *  confirms the slot is gone (releaseResultSet succeeded — a non-resident id is a no-op success). */
  const stuck = [];

  /** One attempt at both steps for an entry; returns true when the slot is confirmed released. */
  function attemptRelease(entry, errors) {
    if (entry.lease !== null) {
      try { entry.lease.release(); entry.lease = null; } catch (e) { errors.push(e); }
    }
    try {
      engine.releaseResultSet(entry.runId, entry.unsaved ? { acknowledgeUnsaved: true } : {});
      return true;
    } catch (e) {
      errors.push(e);
      return nameOf(e) === 'ResultNotResidentError';         // defensive: gone is gone
    }
  }

  /** Retry every previously stuck release first (each in its own try). */
  function retryStuck(errors) {
    for (const entry of [...stuck]) {
      const attemptErrors = [];
      if (attemptRelease(entry, attemptErrors)) stuck.splice(stuck.indexOf(entry), 1);   // recovered: errors of a success are moot
      else errors.push(...attemptErrors);
    }
  }

  const result = (errors, extra = {}) => ({
    released: errors.length === 0 && stuck.length === 0, needsAcknowledgement: false, errors, stuckCount: stuck.length, ...extra,
  });

  /** Release path (replace / Clear results / dispose). Step (1) lease.release(), step (2)
   *  releaseResultSet(runId, {acknowledgeUnsaved}) — each in its own try (spec §7.6 (3)). A release with a
   *  failed step is kept in `stuck` and retried by every later release()/disposeAll(). */
  function release({ acknowledgeUnsaved = false } = {}) {
    const errors = [];
    retryStuck(errors);
    if (held === null) return result(errors);
    const { runId, kind, lease } = held;
    let unsaved = false;
    if (kind === 'held-unsaved') {
      unsaved = readState(runId) !== 'saved';                    // pending→saved may have landed unobserved
      if (unsaved && acknowledgeUnsaved !== true) {
        return { released: false, needsAcknowledgement: true, errors, stuckCount: stuck.length };   // keep holding; ask once
      }
    }
    held = null;                                                  // the Panel stops displaying it regardless
    const entry = { runId, lease, unsaved };
    const own = [];
    if (!attemptRelease(entry, own)) stuck.push(entry);
    errors.push(...own);
    return result(errors, { droppedUnsaved: unsaved });
  }

  /** A superseded run's late `done`: release its own set without displaying it. The user action
   *  that superseded it (Run / New test / Clear / dispose) is the acknowledgement. */
  function releaseSuperseded(summary) {
    const errors = [];
    const runId = summary?.runId ?? summary?.resultSet?.runId ?? null;
    const out = () => ({ errors, stuckCount: stuck.length });
    if (summary?.resultSet === null || summary?.resultSet === undefined || runId === null) return out();
    if (held !== null && held.runId === runId) return out();       // never touch the displayed set here
    const unsaved = (readState(runId) ?? summary.persistence?.state) !== 'saved';
    const entry = { runId, lease: null, unsaved };
    if (!attemptRelease(entry, errors)) stuck.push(entry);          // retried by the next release()/disposeAll()
    return out();
  }

  /** Dispose: no user to ask, so an unsaved set is acknowledged and the drop is REPORTED (spec §7.6). */
  function disposeAll() {
    const r = release({ acknowledgeUnsaved: true });
    return { droppedUnsaved: r.droppedUnsaved === true, errors: r.errors, stuckCount: r.stuckCount };
  }

  /** Read-only: the runIds of the Panel's own sets whose release is still stuck (spec §7.6: a capacity error
   *  caused by one of them must still offer "Release previous results and retry"). */
  function stuckRunIds() {
    return Object.freeze(stuck.map((entry) => entry.runId));
  }

  return Object.freeze({ adopt, onPersisted, current, release, releaseSuperseded, disposeAll, stuckRunIds });
}
