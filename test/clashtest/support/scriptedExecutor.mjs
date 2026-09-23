// test/clashtest/support/scriptedExecutor.mjs
//
// P6's scripted `UnitExecutor` (A9/N26: the executor IS a function `(request) => Promise<UnitOutcome>`,
// never an object with `.execute`). The script maps `unitId -> [attemptDescriptor, ...]`; attempt `n`
// of a unit consumes descriptor `n - 1` (the last one repeats if the script runs out).
//
// Task P6.4 built the MINIMAL vocabulary its own lifecycle tests needed:
//   { facts: [] }            -> an `evaluated` §11.2 outcome with `scopeProof: 'equal'`, no pairs,
//                               no diagnostics, `{}` statistics
//   { ..., hold: true }      -> the outcome is withheld until `executor.release(unitId)`;
//                               `executor.inFlight(unitId)` resolves once the call has started
//   { outcome, failure, ...} -> a descriptor already in P4's own outcome shape is passed through
//                               (identity, generations and the absent array/number fields filled in)
// Every outcome's `generations` default to `{start, end}` reads that AGREE with the request's own
// snapshot, so an outcome is never "moved" unless a test moves the registry.
//
// Task P6.5 EXTENDS this file (same extension rules as support/index.mjs: never change an existing
// export's signature or default behaviour, only add descriptor keys / options):
//   pairs           a non-negative INTEGER -> that many synthetic, mutually-distinct §11.2
//                   `volume-overlap` pairs on the unit's own source model (an ARRAY is passed through
//                   verbatim for a test that wants to hand-build its own pairs).
//   diagnostics     `{reason, dbId?, modelKey?, fragId?, role?}[]` expanded into P4's real PROJECTED
//                   diagnostic shape (`completenessAffecting`/`attribution` derived exactly the way
//                   `diagnostics.js` derives them, never guessed) -- an entry that already carries
//                   `scope`/`fragments` is P4-shaped and passed through verbatim.
//   statistics      passed straight through (already a plain `LIBRARY_STATISTICS_KEYS` object).
//   capacityKind    attached to a `facts`-expanded failure's `failure.capacityKind`.
//   malformed       the outcome carries one extra, unknown key -- `validateUnitOutcome` rejects it
//                   (`outcome-unknown-key`), which is exactly what "a malformed outcome" tests need:
//                   a violation `internalErrorOutcome`'s own construction could never produce itself.
//   non-empty facts a single KNOWN §16.7 table-A fact is expanded into exactly the `failed` shape P4
//                   would have produced for it (`failure.code` = the fact, `retryable` per P4's table
//                   -- true ONLY for `stale-placement`). There is no fact spelling this fake cannot
//                   produce, and in particular none called `placement-contention` (P6 never emits it;
//                   P5 derives it at seal from a sealed `failed:stale-placement` record).
//   generations     unchanged (still defaults to an agreeing `{start, end}` read); an outcome-shape
//                   descriptor may still override it directly to script a moved placement generation.
// `executor.requests` (every request handed to the executor, in call order), `executor.attemptsFor
// (unitId)` (the attempt numbers issued to one unit, in order) and `executor.maxConcurrent` (the
// largest number of calls ever in flight at once) are recorded unconditionally.
// `createScriptedExecutor.capacityAlways(opts)` answers EVERY unit, on every attempt, with the same
// `facts: ['capacity-exceeded']` outcome (`opts.capacityKind`, default `'tlas-candidate-budget'`) --
// the nested-split boundary tests drive a run that keeps splitting until admission itself refuses.

import { isCompletenessAffecting, attributionOf } from '../../../clashtest/execution/diagnostics.js';

const KNOWN_DESCRIPTOR_KEYS = new Set(['facts', 'hold', 'outcome', 'failure', 'scopeProof', 'pairs',
  'diagnostics', 'statistics', 'durationMs', 'generations', 'capacityKind', 'malformed']);

// §16.7 table A's failure codes this fake can expand a bare fact into, with P4's own retry
// eligibility (`classifyLibraryError`): `stale-placement` is the ONLY code ever `retryable: true`.
const FACT_RETRYABLE = Object.freeze({
  'world-disposed': false, 'internal-error': false, 'result-cap': false, 'model-evicted': false,
  'capacity-exceeded': false, 'extraction-limit': false, 'object-tree-unavailable': false,
  'stale-placement': true, 'unit-cap': false, 'target-too-large': false,
});

const generationsOf = (request) => {
  const side = () => request.snapshot.map(({ modelKey, bindingGeneration, placementGeneration }) => (
    { modelKey, bindingGeneration, placementGeneration }));
  return { start: side(), end: side() };
};

// Module-scoped: uniqueness across every unit of every run this process executes is all that a
// synthetic pair's identity needs (no test reads a specific dbId value), so one running counter for
// the whole test process is simpler than threading fixture-scoped state through every call site.
let pairSeq = 0;

/** `pairs` is `undefined` (none), an ARRAY (passed through verbatim -- a test's own hand-built pairs),
 *  or a non-negative INTEGER (`n` freshly synthesized, mutually distinct, `volume-overlap` pairs on
 *  the unit's own source model; `witness: null` is a legal volume-overlap witness, §11.2). */
function expandPairs(pairs, request) {
  if (pairs === undefined) return [];
  if (Array.isArray(pairs)) return pairs;
  if (!Number.isInteger(pairs) || pairs < 0) {
    throw new Error(`scriptedExecutor: "pairs" must be a non-negative integer or an array, got ${String(pairs)}`);
  }
  if (pairs === 0) return [];
  if (request.mode !== 'volume-overlap') {
    throw new Error(`scriptedExecutor: a numeric "pairs" count only synthesizes volume-overlap pairs (Task P6.5 scope); got mode ${request.mode}`);
  }
  const modelKey = request.unit.sourceModelKey;
  const out = [];
  for (let i = 0; i < pairs; i += 1) {
    pairSeq += 1;
    out.push({
      source: { modelKey, dbId: pairSeq * 2 },
      target: { modelKey, dbId: pairSeq * 2 + 1 },
      type: 'volume-overlap',
      witness: null,
    });
  }
  return out;
}

/** Each entry is EITHER already P4-projected (`scope` present: passed through verbatim) or the
 *  fixture's own simplified shorthand `{reason, dbId?, modelKey?, fragId?, role?}`, expanded into
 *  the real projected shape with `completenessAffecting`/`attribution` DERIVED (never declared) --
 *  the same derivation `clashtest/execution/diagnostics.js` and its boundary validator use, so a
 *  fixture-built diagnostic can never desync from what the real library-facing code would accept. */
function expandDiagnostics(list, request) {
  if (list === undefined) return [];
  return list.map((d) => {
    if (d.scope !== undefined) return d;                    // already P4-shaped: verbatim
    const modelKey = d.modelKey ?? request.unit.sourceModelKey;
    const dbId = d.dbId ?? null;
    const fragId = d.fragId ?? (dbId ?? 0);
    const fragment = { modelKey, dbId, fragId, ...(d.role !== undefined ? { role: d.role } : {}) };
    const projected = { scope: 'fragment', reason: d.reason, completenessAffecting: isCompletenessAffecting(d.reason), fragment };
    projected.attribution = attributionOf(projected);
    return projected;
  });
}

/** A single known §16.7 fact -> P4's own `{outcome:'failed', failure:{code, retryable, capacityKind?}}`. */
function failureFromFact(descriptor) {
  const facts = descriptor.facts;
  const code = facts[0];
  if (facts.length !== 1 || !(code in FACT_RETRYABLE)) {
    throw new Error(`scriptedExecutor: facts ${JSON.stringify(facts)} are not supported yet (a single known §16.7 fact only)`);
  }
  return {
    outcome: 'failed',
    scopeProof: descriptor.scopeProof ?? 'not-checked',
    failure: {
      code, retryable: FACT_RETRYABLE[code],
      ...(descriptor.capacityKind !== undefined ? { capacityKind: descriptor.capacityKind } : {}),
    },
  };
}

function outcomeFrom(descriptor, request) {
  for (const key of Object.keys(descriptor)) {
    if (!KNOWN_DESCRIPTOR_KEYS.has(key)) {
      throw new Error(`scriptedExecutor: descriptor key "${key}" is not supported yet (Task P6.5 adds it)`);
    }
  }
  const base = {
    unitId: request.unit.unitId,
    attempt: request.attempt,
    generations: descriptor.generations ?? generationsOf(request),
    durationMs: descriptor.durationMs ?? 0,
  };
  if (descriptor.malformed === true) {
    // An UNKNOWN key is exactly what `validateUnitOutcome`'s closed-key-set check (§7.1) rejects --
    // a violation P4's own `internalErrorOutcome` could never itself produce (it emits only known
    // keys), so this is the one honest way a fixture can script "the executor sent garbage".
    return {
      ...base, outcome: 'evaluated', scopeProof: 'equal', failure: null,
      pairs: [], diagnostics: [], statistics: {},
      scriptedMalformedMarker: true,
    };
  }
  if (descriptor.outcome !== undefined) {                 // P4's own shape: passthrough
    return {
      ...base,
      outcome: descriptor.outcome,
      scopeProof: descriptor.scopeProof ?? (descriptor.outcome === 'evaluated' ? 'equal' : 'not-checked'),
      failure: descriptor.failure ?? null,
      pairs: expandPairs(descriptor.pairs, request),
      diagnostics: expandDiagnostics(descriptor.diagnostics, request),
      statistics: descriptor.statistics ?? {},
    };
  }
  const facts = descriptor.facts ?? [];
  if (facts.length > 0) {
    return { ...base, ...failureFromFact(descriptor), pairs: [], diagnostics: [], statistics: descriptor.statistics ?? {} };
  }
  return {
    ...base, outcome: 'evaluated', scopeProof: descriptor.scopeProof ?? 'equal', failure: null,
    pairs: expandPairs(descriptor.pairs, request),
    diagnostics: expandDiagnostics(descriptor.diagnostics, request),
    statistics: descriptor.statistics ?? {},
  };
}

/**
 * @param {Record<string, object[]>} script  unitId -> attempt descriptors
 * @param {{unscripted?: object}} [options]  `unscripted`: the descriptor for a unit the script does
 *   not name (the run fixture's default executor uses `{facts: []}`: every unit evaluates clean).
 *   Omitted, an unscripted unit is a loud executor error.
 */
export function createScriptedExecutor(script = {}, { unscripted = null } = {}) {
  const startedUnits = [];
  const requests = [];
  const attempts = new Map();                              // unitId -> attempts issued so far
  const attemptLog = new Map();                             // unitId -> [attempt, attempt, ...]
  const holds = new Map();                                 // unitId -> {release, started, resolveStarted}
  let inFlight = 0;
  let maxConcurrent = 0;

  const holdFor = (unitId) => {
    let entry = holds.get(unitId);
    if (entry === undefined) {
      let resolveStarted;
      let release;
      const started = new Promise((r) => { resolveStarted = r; });
      const released = new Promise((r) => { release = r; });
      entry = { started, resolveStarted, released, release };
      holds.set(unitId, entry);
    }
    return entry;
  };

  async function executor(request) {
    inFlight += 1;
    maxConcurrent = Math.max(maxConcurrent, inFlight);
    try {
      const { unitId } = request.unit;
      const n = (attempts.get(unitId) ?? 0) + 1;
      attempts.set(unitId, n);
      if (attemptLog.has(unitId)) attemptLog.get(unitId).push(n);
      else attemptLog.set(unitId, [n]);
      if (n === 1) startedUnits.push(unitId);
      requests.push(request);
      const list = script[unitId] ?? (unscripted === null ? null : [unscripted]);
      if (!Array.isArray(list) || list.length === 0) {
        throw new Error(`scriptedExecutor: no script for unit ${unitId}`);
      }
      const descriptor = list[Math.min(n, list.length) - 1];
      if (descriptor.hold === true) {
        const gate = holdFor(unitId);
        gate.resolveStarted();
        await gate.released;
      }
      return outcomeFrom(descriptor, request);
    } finally {
      inFlight -= 1;
    }
  }

  executor.startedUnits = startedUnits;
  executor.requests = requests;
  executor.attemptsFor = (unitId) => [...(attemptLog.get(unitId) ?? [])];
  Object.defineProperty(executor, 'maxConcurrent', { get: () => maxConcurrent });
  /** Resolves once `unitId`'s held attempt is in flight. */
  executor.inFlight = (unitId) => holdFor(unitId).started;
  /** Lets `unitId`'s held attempt return its outcome. */
  executor.release = (unitId) => { holdFor(unitId).release(); };
  return executor;
}

/** Every unit, every attempt, the same `facts: ['capacity-exceeded']` outcome (default capacityKind
 *  `'tlas-candidate-budget'`) -- drives a run that keeps splitting until admission itself refuses. */
createScriptedExecutor.capacityAlways = ({ capacityKind = 'tlas-candidate-budget' } = {}) => (
  createScriptedExecutor({}, { unscripted: { facts: ['capacity-exceeded'], capacityKind } })
);
