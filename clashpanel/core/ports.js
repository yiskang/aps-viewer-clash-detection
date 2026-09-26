// clashpanel/core/ports.js
// The three host-facing ports of the Panel core (spec 5.2). Nothing here calls Viewer or DOM code; the engine and the
// catalog are injected. Registration is host composition (PD-18): the narrowed engine has NO register/unregister/
// keyOf/invalidateModelPlacement/dispose, so the controller cannot call them (AC-P20).
import { BASIS_VERDICT_TIMEOUT_MS } from './constants.js';
import { assertScheduler } from './scheduler.js';

const ENGINE_METHODS = Object.freeze([
  'validateTest', 'startRun', 'retainResultSet', 'releaseResultSet', 'getPersistenceState', 'getFreshness', 'assessNoClashClaim',
]);
const DERIVATION_METHODS = Object.freeze(['summarize', 'groupBy', 'filter']);

/** Fixed, host-independent reasons for every fail-closed basis outcome (never contain host or error text). */
export const BASIS_FAILURE_REASONS = Object.freeze({
  missing: 'The host did not provide a measurement-basis check.',
  threw: 'The measurement-basis check failed.',
  rejected: 'The measurement-basis check was rejected.',
  timeout: 'The measurement-basis check did not answer in time.',
  malformed: 'The measurement-basis check returned an unrecognized answer.',
});

function need(owner, ownerName, name) {
  if (typeof owner?.[name] !== 'function') throw new TypeError(`narrowEnginePort: ${ownerName}.${name} is required`);
}
const forward = (owner, name) => (...args) => owner[name](...args);

/**
 * EnginePort = { validateTest, startRun, retainResultSet, releaseResultSet, getPersistenceState, getFreshness,
 *                assessNoClashClaim, derivations: { summarize, groupBy, filter }, registry: { bindingFor } }.
 * NOTHING else. Members are looked up lazily on the engine at call time (so a host may swap an implementation), but
 * only the names above are ever read.
 */
export function narrowEnginePort(engine) {
  if (engine === null || (typeof engine !== 'object' && typeof engine !== 'function')) {
    throw new TypeError('narrowEnginePort: engine is required');
  }
  for (const name of ENGINE_METHODS) need(engine, 'engine', name);
  const { derivations, registry } = engine;
  for (const name of DERIVATION_METHODS) need(derivations, 'engine.derivations', name);
  need(registry, 'engine.registry', 'bindingFor');
  return Object.freeze({
    ...Object.fromEntries(ENGINE_METHODS.map((name) => [name, forward(engine, name)])),
    derivations: Object.freeze(Object.fromEntries(DERIVATION_METHODS.map((name) => [name, forward(derivations, name)]))),
    registry: Object.freeze({ bindingFor: forward(registry, 'bindingFor') }),
  });
}

const unverified = (reason) => Object.freeze({ state: 'unverified', reason });

function settleWithTimeout(raw, scheduler, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    let handle;
    const finish = (result) => {
      if (done) return;
      done = true;
      if (handle !== undefined) scheduler.clearTimeout(handle);
      resolve(result);
    };
    handle = scheduler.setTimeout(() => finish({ kind: 'timeout' }), timeoutMs);
    Promise.resolve(raw).then((value) => finish({ kind: 'value', value }), () => finish({ kind: 'rejected' }));
  });
}

/** A recognised verdict as a fresh frozen object with ONLY its own fields, or null when the shape is not recognised. */
function normalizeVerdict(v) {
  if (v === null || typeof v !== 'object') return null;
  let state;
  let basisKey;
  let reason;
  try { ({ state, basisKey, reason } = v); } catch { return null; }
  if (state === 'verified') {
    return typeof basisKey === 'string' && basisKey.length > 0 ? Object.freeze({ state, basisKey }) : null;
  }
  if (state === 'unverified' || state === 'incompatible') {
    return typeof reason === 'string' && reason.length > 0 ? Object.freeze({ state, reason }) : null;
  }
  return null;
}

/**
 * BasisVerdict = {state:'verified', basisKey} | {state:'unverified'|'incompatible', reason}. FAIL CLOSED: a missing
 * method, a throw, a rejection, a timeout or any other shape becomes {state:'unverified', reason: <fixed text>}. Never
 * rejects for host behavior. The host's `reason` is returned as a plain string and is never interpreted.
 */
export async function readBasisVerdict(catalog, modelKeys, { scheduler, timeoutMs = BASIS_VERDICT_TIMEOUT_MS } = {}) {
  if (!Array.isArray(modelKeys)) throw new TypeError('readBasisVerdict: modelKeys must be an array');
  assertScheduler(scheduler);
  const wait = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : BASIS_VERDICT_TIMEOUT_MS;
  try {
    if (typeof catalog?.measurementBasis !== 'function') return unverified(BASIS_FAILURE_REASONS.missing);
    let raw;
    try { raw = catalog.measurementBasis([...modelKeys]); } catch { return unverified(BASIS_FAILURE_REASONS.threw); }
    const settled = await settleWithTimeout(raw, scheduler, wait);
    if (settled.kind === 'timeout') return unverified(BASIS_FAILURE_REASONS.timeout);
    if (settled.kind === 'rejected') return unverified(BASIS_FAILURE_REASONS.rejected);
    return normalizeVerdict(settled.value) ?? unverified(BASIS_FAILURE_REASONS.malformed);
  } catch {
    return unverified(BASIS_FAILURE_REASONS.threw);
  }
}

function assertMembers(target, owner, names, label) {
  for (const name of names) {
    if (typeof target?.[name] !== 'function') throw new TypeError(`${label}: ${owner}.${name} is required`);
  }
  return target;
}

/** Structural check of the host ModelCatalog. `measurementBasis` is optional here: its absence is fail-closed data. */
export function assertCatalogPort(catalog) {
  return assertMembers(catalog, 'catalog', ['list', 'displayNameFor', 'keyOfModel', 'onChange'], 'assertCatalogPort');
}

export function assertBridgePort(bridge) {
  return assertMembers(bridge, 'bridge',
    ['present', 'clear', 'dispose', 'checkIsolationPrerequisite', 'readAggregateSelection', 'onModelLeft'], 'assertBridgePort');
}
