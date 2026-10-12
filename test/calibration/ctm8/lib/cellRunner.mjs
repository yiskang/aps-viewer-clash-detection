// CTM8-P0-v4 §7.5/§7.6: per-cell repetition, timeout and failure policy.
// Scenario modules supply createCell(cellSpec); this runner owns the policy only.

import { PROTOCOL, REPS } from './enumeration.mjs';

export const TIMED_TIMEOUT_MS = 30000;
export const SETUP_TIMEOUT_MS = 120000;
export const CONSECUTIVE_ABORT = 3;

// A global harness failure must stop the campaign; never a cell result.
export class GlobalFailure extends Error {
  constructor(message) {
    super(message);
    this.name = 'GlobalFailure';
    this.code = 'GLOBAL_FAILURE';
  }
}

function makeRecord(spec, launchIndex, phase, iteration, r) {
  const rec = {
    protocol: PROTOCOL,
    launchIndex,
    cellId: spec.cellId,
    family: spec.family,
    scenario: spec.scenario,
  };
  // Exactly one labelled count field; no generic unlabeled count.
  if (spec.family === 'M') rec['M.N_tests'] = spec.scale;
  else rec['R.N_results'] = spec.scale;
  Object.assign(rec, {
    nModels: spec.nModels,
    kind: spec.kind,
    profile: spec.profile,
    phase,
    iteration,
    status: r.status,
    durationMs: r.durationMs ?? null,
    notificationCount: r.notificationCount ?? null,
    yieldDelta: r.yieldDelta ?? null,
    catalogListDelta: r.catalogListDelta ?? null,
    extra: r.extra ?? {},
  });
  return rec;
}

export async function runCell({ cellSpec, createCell, launchIndex, sink, now = performance.now }) {
  const cell = createCell(cellSpec);
  let result;
  let primaryError = null;
  try {
    result = await executeCell({ cellSpec, cell, launchIndex, sink });
  } catch (err) {
    primaryError = err;
  }
  // Teardown failures are never swallowed: leaked harness state could corrupt later cells.
  let teardownError = null;
  try {
    await cell.teardown();
  } catch (err) {
    teardownError = err;
  }
  if (primaryError) {
    if (teardownError) primaryError.teardownError = teardownError;
    throw primaryError;
  }
  if (teardownError) {
    if (teardownError instanceof GlobalFailure) throw teardownError;
    result.cleanupFailed = true;
    if (result.status === 'COMPLETED') {
      result.status = 'CLEANUP_FAILED';
      result.reason = String(teardownError?.message ?? teardownError);
    } else {
      result.teardownError = teardownError; // primary outcome stays authoritative
    }
  }
  return result;
}

async function executeCell({ cellSpec, cell, launchIndex, sink }) {
  const result = {
    cellSpec, status: 'COMPLETED', n_valid: 0, n_timeout: 0, n_invalid: 0, manifest: null, reason: null,
  };
  {
    let setup;
    try {
      setup = await cell.setup({ setupTimeoutMs: SETUP_TIMEOUT_MS });
    } catch (err) {
      if (err instanceof GlobalFailure) throw err;
      setup = { status: 'INVALID_SETUP', reason: `setup threw: ${err?.message ?? err}`, manifest: null };
    }
    result.manifest = setup.manifest ?? null;
    if (setup.status !== 'OK') {
      result.reason = setup.reason ?? null;
      result.status = {
        SETUP_TIMEOUT: 'NOT EXECUTED — setup timeout',
        INVALID_SETUP: 'INVALID_SETUP',
        UNAVAILABLE: 'UNAVAILABLE',
      }[setup.status] ?? 'INVALID_SETUP';
      return result;
    }

    const warm = cellSpec.kind === 'warm';
    const plan = [];
    if (warm) for (let i = 0; i < REPS.warmup; i++) plan.push(['warmup', i]);
    const measured = warm ? REPS.warmMeasured : REPS.coldMeasured;
    for (let i = 0; i < measured; i++) plan.push(['measured', i]);

    let consecutive = 0;
    for (const [phase, iteration] of plan) {
      let r;
      try {
        const prep = await cell.prepareSample();
        if (!prep?.ok) {
          r = { status: 'INVALID_SETUP', extra: { reason: prep?.reason ?? 'prepareSample failed' } };
        } else {
          try {
            r = await cell.runSample({ timeoutMs: TIMED_TIMEOUT_MS });
            if (r.status === 'OK' && r.durationMs >= TIMED_TIMEOUT_MS) r = { ...r, status: 'TIMEOUT' };
          } catch (err) {
            if (err instanceof GlobalFailure) throw err;
            r = { status: 'INVALID', extra: { error: String(err?.message ?? err) } };
          }
          const reset = await cell.resetSample();
          // Keep the timed evidence. A TIMEOUT stays TIMEOUT (protocol-significant);
          // anything else with a failed reset is untrustworthy and becomes INVALID_SETUP.
          if (!reset?.ok) {
            const extra = { ...r.extra, resetFailure: reset?.reason ?? 'resetSample failed', measuredStatus: r.status };
            r = { ...r, status: r.status === 'TIMEOUT' ? 'TIMEOUT' : 'INVALID_SETUP', extra };
          }
        }
      } catch (err) {
        if (err instanceof GlobalFailure) throw err;
        r = { status: 'INVALID_SETUP', extra: { reason: `harness threw: ${err?.message ?? err}` } };
      }
      sink?.append(makeRecord(cellSpec, launchIndex, phase, iteration, r));
      if (phase === 'measured') {
        if (r.status === 'OK') result.n_valid++;
        else if (r.status === 'TIMEOUT') result.n_timeout++;
        else result.n_invalid++;
      }
      consecutive = r.status === 'TIMEOUT' || r.status === 'INVALID_SETUP' ? consecutive + 1 : 0;
      if (consecutive >= CONSECUTIVE_ABORT) {
        result.status = 'ABORTED — consecutive failures';
        result.reason = `${CONSECUTIVE_ABORT} consecutive TIMEOUT/INVALID_SETUP at ${phase} #${iteration}`;
        return result;
      }
    }
    if (result.n_valid === 0) result.status = 'INCONCLUSIVE';
    return result;
  }
}
