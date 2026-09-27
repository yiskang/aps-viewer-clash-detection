// clashpanel/core/runMachine.js
//
// Spec §7.1-§7.3: the Panel's run state as a PURE reducer over Core facts. Inputs are the real Core
// shapes (clashtest/run/Run.js): the first `state` event is {status:'planning', phase:'enumerating'}
// (no event at `queued`); `unit` events carry {status:'running', phase:'executing'}; `cancelling` is
// committed the moment a RUNNING run is cancelled; a sealed run publishes {status:<terminal>,
// phase:'finalizing'}, then {phase:'terminal', terminal:true, persistence}; a `persistence` event can
// arrive AFTER the terminal one and never changes the run state. `done` is the only way into `done`
// (spec §7.1: results are available only once `await handle.done` resolved). No ETA field exists
// anywhere in this state (PD-13); elapsed time is the controller's own clock minus `startedAtMs`.

export const RUN_PHASE = Object.freeze({
  IDLE: 'idle', PREPARING: 'preparing', PLANNING: 'planning', RUNNING: 'running',
  STOPPING: 'stopping', FINALIZING: 'finalizing', DONE: 'done',
});

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'failed', 'invalidated']);
const NON_TERMINAL_PHASES = new Set([
  RUN_PHASE.PREPARING, RUN_PHASE.PLANNING, RUN_PHASE.RUNNING, RUN_PHASE.STOPPING, RUN_PHASE.FINALIZING,
]);

/** RunState = { phase, runId, progress, startedAtMs, terminal, admissionError, waitingForOtherRun,
 *               stopRequested, lastSeq }  — frozen; `progress` has NO eta/rate/remaining field. */
export function initialRunState() {
  return Object.freeze({
    phase: RUN_PHASE.IDLE, runId: null, progress: null, startedAtMs: null, terminal: null,
    admissionError: null, waitingForOtherRun: false, stopRequested: false, lastSeq: -1,
  });
}

const num = (v) => (Number.isFinite(v) ? v : 0);

/** The only progress the Panel shows: RunProgress fractions/counts (spec §7.1 `running` row). */
function progressOf(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object') return null;
  return Object.freeze({
    fraction: Number.isFinite(snapshot.fractionProcessed) ? snapshot.fractionProcessed : null,
    unitsEvaluated: num(snapshot.unitsEvaluated),
    unitsTotal: num(snapshot.unitsTotal),
    unitsFailedOrSkipped: num(snapshot.unitsFailedOrSkipped),
    resultsFound: num(snapshot.resultsFound),
    caveatCount: num(snapshot.caveatCount),
  });
}

/** Maps one Core (status, phase) pair to a Panel phase, honouring a pending user Stop. */
function phaseFor(status, phase, stopRequested) {
  if (TERMINAL_STATUSES.has(status)) return RUN_PHASE.FINALIZING;   // sealed: `finalizing` or the terminal event
  if (status === 'cancelling') return RUN_PHASE.STOPPING;
  if (stopRequested) return RUN_PHASE.STOPPING;                    // a Stop is never visually undone
  if (status === 'running') return RUN_PHASE.RUNNING;
  if (status === 'planning') return RUN_PHASE.PLANNING;             // Core never publishes phase 'planning'
  if (status === 'queued') return RUN_PHASE.PREPARING;
  return null;                                                      // unknown status: no transition
}

const freeze = (s) => Object.freeze(s);

function describeError(error) {
  if (error === null || typeof error !== 'object') return freeze({ name: 'Error', message: String(error) });
  const out = { name: typeof error.name === 'string' ? error.name : 'Error', message: typeof error.message === 'string' ? error.message : '' };
  for (const k of ['issues', 'issuesTruncated', 'cap', 'active', 'retained', 'held', 'limit', 'queued', 'reason']) {
    if (error[k] !== undefined) out[k] = error[k];
  }
  return freeze(out);
}

export function reduceRun(state, event) {
  const type = event?.type;
  switch (type) {
    case 'admitted': {
      // `startRun` returned a handle; its snapshot is `queued` (binding/enumeration publish nothing, §19-1).
      const snapshot = event.snapshot ?? null;
      return freeze({
        phase: phaseFor(snapshot?.status, snapshot?.phase, false) ?? RUN_PHASE.PREPARING,
        runId: snapshot?.runId ?? event.runId ?? null,
        progress: progressOf(snapshot),
        startedAtMs: Number.isFinite(event.atMs) ? event.atMs : null,
        terminal: null, admissionError: null, waitingForOtherRun: false, stopRequested: false,
        lastSeq: Number.isFinite(snapshot?.seq) ? snapshot.seq : -1,
      });
    }
    case 'admission-failed': {
      // Spec §7.1/§7.6: an admission failure keeps the previous state (idle, or the previous `done`
      // with its results) and only records the error. Ignored while a run of ours is non-terminal.
      if (NON_TERMINAL_PHASES.has(state.phase)) return state;
      return freeze({ ...state, admissionError: describeError(event.error) });
    }
    case 'poll': {
      // The controller re-reads getSnapshot() while `preparing`. A snapshot that is STILL `queued`
      // after admission means preparing persists: Core cannot say whether it is binding/enumerating
      // or queued behind another consumer's run, so the flag is a hedge, never a certainty.
      if (!NON_TERMINAL_PHASES.has(state.phase)) return state;
      const snapshot = event.snapshot ?? null;
      if (Number.isFinite(snapshot?.seq) && snapshot.seq < state.lastSeq) return state;
      const next = { ...state, progress: progressOf(snapshot) ?? state.progress };
      if (state.phase === RUN_PHASE.PREPARING && snapshot?.status === 'queued') next.waitingForOtherRun = true;
      return freeze(next);
    }
    case 'core-event': {
      if (!NON_TERMINAL_PHASES.has(state.phase)) return state;       // idle/done: late events are ignored
      const ev = event.event ?? {};
      if (ev.type !== 'state' && ev.type !== 'unit') return state;   // `persistence` (maybe post-terminal), `progress`: no transition
      if (Number.isFinite(ev.seq) && ev.seq <= state.lastSeq) return state;   // stale/out-of-order delivery
      const mapped = phaseFor(ev.status, ev.phase, state.stopRequested);
      if (mapped === null) return state;
      // `finalizing` is absorbing until `done` (a sealed run never goes back to running/stopping).
      const phase = state.phase === RUN_PHASE.FINALIZING ? RUN_PHASE.FINALIZING : mapped;
      return freeze({
        ...state,
        phase,
        progress: progressOf(event.snapshot) ?? state.progress,
        waitingForOtherRun: phase === RUN_PHASE.PREPARING ? state.waitingForOtherRun : false,
        lastSeq: Number.isFinite(ev.seq) ? ev.seq : state.lastSeq,
      });
    }
    case 'stop-requested': {
      // Stop is enabled in EVERY non-terminal state (spec §14.4, AC-P3); Core absorbs a late cancel.
      if (!NON_TERMINAL_PHASES.has(state.phase)) return state;
      const phase = state.phase === RUN_PHASE.FINALIZING ? RUN_PHASE.FINALIZING : RUN_PHASE.STOPPING;
      return freeze({ ...state, phase, stopRequested: true, waitingForOtherRun: false });
    }
    case 'done': {
      if (state.phase === RUN_PHASE.IDLE || state.phase === RUN_PHASE.DONE) return state;
      const summary = event.summary ?? {};
      return freeze({
        ...state,
        phase: RUN_PHASE.DONE,
        waitingForOtherRun: false,
        // The ACTUAL sealed status (Core precedence failed > invalidated > cancelled > completed):
        // a Stop that sealed `failed` shows failed, never "Stopped" (spec §7.2).
        terminal: freeze({
          status: summary.status,
          persistence: summary.persistence ?? null,
          resultSetPresent: summary.resultSet !== null && summary.resultSet !== undefined,
        }),
      });
    }
    default:
      return state;
  }
}

export function canRun(state) {
  return state.phase === RUN_PHASE.IDLE || state.phase === RUN_PHASE.DONE;
}

export function canStop(state) {
  return NON_TERMINAL_PHASES.has(state.phase);
}

export function isRunActive(state) {
  return NON_TERMINAL_PHASES.has(state.phase);
}
