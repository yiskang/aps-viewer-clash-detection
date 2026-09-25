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
// Task P6.6 EXTENDS this file (same extension rules):
//   scope facts     `facts: ['scope-drift']` / `facts: ['scope-unverifiable']` expand into exactly the
//                   `discarded` shape P4's LocalUnitExecutor produces for a post-check drift /
//                   unverifiable answer (`scopeProof` 'drift' / 'unverifiable' unless the descriptor
//                   says otherwise, `failure.code` = the fact, `retryable: false`). `pairs` /
//                   `diagnostics` on such a descriptor are carried on the outcome, so a test can prove
//                   a discarded unit merges NOTHING even though its outcome held evidence.
//   modelKeys       attached as `failure.modelKeys` on a `facts`-expanded failure (must be the unit's
//                   own participants: P4's validator rejects any other key).
//   forceScopeProof an otherwise-clean `evaluated` outcome carrying this `scopeProof` instead of
//                   'equal' -- the I-scope violation P4's `validateUnitOutcome` must reject.
// Task P6.8 EXTENDS this file (same extension rules):
//   input-changed   a single `facts: ['input-changed']` expands into the shape P4 produces for it: a
//                   `discarded` outcome with `failure.code: 'input-changed'` (`retryable: false`), AND a
//                   LIVE placement change of the unit's source model while the call is in flight (the
//                   run fixture's wrapper calls `registry.notifyPlacementChanged`), because P4 only ever
//                   reports it after observing a placement-generation move.
//   several facts   a MULTI-fact list is delivered through every channel a real P4 outcome has, since
//                   one §11.2 outcome carries only ONE `failure.code`:
//                     - a scope fact (`scope-drift` / `scope-unverifiable`, at most one) -> `scopeProof`;
//                     - `model-evicted` -> a LIVE participant death: the run fixture's executor wrapper
//                       unregisters the unit's source model (P6 observes it through its own unit-scoped
//                       registry scan, exactly as it observes a real death, P4 H1);
//                     - every other fact (at most one) -> `failure.code`.
//                   `executor.liveFactsFor(request)` reports the live half to the fixture wrapper.
//   shuffleFacts    the descriptor's `facts` ORDER is the DELIVERY order. Every live fact lands while the
//                   call is IN FLIGHT (a death before the call would be caught by P4's pre-call binding
//                   gate, which issues no call at all, so it could not coexist with a thrown fact): one
//                   listed BEFORE the `failure.code` fact lands `early` (right after the call is issued),
//                   one listed after it lands `late` (as the call returns). The same SET in every
//                   permutation must seal identically (§16.7, AC-21); without the flag a live fact
//                   always lands `late`.
//   pairsOverflowLength  (fix round 2) an `evaluated` outcome in the REAL default executor's over-cap
//                   MARKER form: `pairs: []` plus `pairsOverflowLength: n` — exactly what P4's
//                   `LocalUnitExecutor.projectPairs` returns once the raw pairs exceed
//                   `maxPairsPerOutcome` (it never returns an oversized array).
// `executor.requests` (every request handed to the executor, in call order), `executor.attemptsFor
// (unitId)` (the attempt numbers issued to one unit, in order) and `executor.maxConcurrent` (the
// largest number of calls ever in flight at once) are recorded unconditionally.
// `createScriptedExecutor.capacityAlways(opts)` answers EVERY unit, on every attempt, with the same
// `facts: ['capacity-exceeded']` outcome (`opts.capacityKind`, default `'tlas-candidate-budget'`) --
// the nested-split boundary tests drive a run that keeps splitting until admission itself refuses.

import { isCompletenessAffecting, attributionOf } from '../../../clashtest/execution/diagnostics.js';

const KNOWN_DESCRIPTOR_KEYS = new Set(['facts', 'hold', 'outcome', 'failure', 'scopeProof', 'pairs',
  'diagnostics', 'statistics', 'durationMs', 'generations', 'capacityKind', 'malformed',
  'modelKeys', 'forceScopeProof',                          // Task P6.6
  'shuffleFacts', 'pairsOverflowLength']);                  // Task P6.8

// Task P6.6: the post-check bracket answers P4 settles as `discarded`, with the proof they carry.
const SCOPE_FACT_PROOF = Object.freeze({ 'scope-drift': 'drift', 'scope-unverifiable': 'unverifiable' });

// §16.7 table A's failure codes this fake can expand a bare fact into, with P4's own retry
// eligibility (`classifyLibraryError`): `stale-placement` is the ONLY code ever `retryable: true`.
const FACT_RETRYABLE = Object.freeze({
  'world-disposed': false, 'internal-error': false, 'result-cap': false, 'model-evicted': false,
  'capacity-exceeded': false, 'extraction-limit': false, 'object-tree-unavailable': false,
  'stale-placement': true, 'unit-cap': false, 'target-too-large': false,
  'input-changed': false,                                   // Task P6.8 (matrix C)
});

// Task P6.8: P4 reports these codes as a `discarded` outcome (the attempt's evidence is void).
const DISCARDED_CODES = new Set(['input-changed']);

// Task P6.8: facts a multi-fact descriptor delivers through LIVE registry state, not the outcome.
const LIVE_FACTS = new Set(['model-evicted']);

/** Task P6.8: splits a multi-fact list over the outcome's channels (see the header). Returns
 *  `{outcomeFacts, live: {beforeCall, duringCall}}`; a single-fact list is untouched. */
function splitFacts(descriptor) {
  const facts = descriptor.facts ?? [];
  if (facts.length === 1 && DISCARDED_CODES.has(facts[0])) {
    return { outcomeFacts: facts, live: { early: [], late: [...facts] } };   // the observed move
  }
  if (facts.length <= 1) return { outcomeFacts: facts, live: { early: [], late: [] } };
  const scope = facts.filter((f) => f in SCOPE_FACT_PROOF);
  const live = facts.filter((f) => LIVE_FACTS.has(f));
  const codes = facts.filter((f) => !(f in SCOPE_FACT_PROOF) && !LIVE_FACTS.has(f));
  if (scope.length > 1 || codes.length > 1 || new Set(facts).size !== facts.length) {
    throw new Error(`scriptedExecutor: facts ${JSON.stringify(facts)} cannot all be carried by one outcome`);
  }
  const anchor = codes[0] ?? scope[0] ?? null;
  const at = anchor === null ? facts.length : facts.indexOf(anchor);
  const early = descriptor.shuffleFacts === true ? live.filter((f) => facts.indexOf(f) < at) : [];
  const late = live.filter((f) => !early.includes(f));
  return { outcomeFacts: [...codes, ...scope], live: { early, late } };
}

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
function failureFromFact(descriptor, facts = descriptor.facts) {
  // Task P6.8: a failure code PLUS a scope fact -- the code is the failure, the scope fact the proof.
  if (facts.length === 2 && facts[1] in SCOPE_FACT_PROOF && !(facts[0] in SCOPE_FACT_PROOF)) {
    return failureFromFact({ ...descriptor, scopeProof: SCOPE_FACT_PROOF[facts[1]] }, [facts[0]]);
  }
  const code = facts[0];
  const modelKeys = descriptor.modelKeys !== undefined ? { modelKeys: [...descriptor.modelKeys] } : {};
  if (facts.length === 1 && code in SCOPE_FACT_PROOF) {   // Task P6.6
    return {
      outcome: 'discarded',
      scopeProof: descriptor.scopeProof ?? SCOPE_FACT_PROOF[code],
      failure: { code, ...modelKeys, retryable: false },
    };
  }
  if (facts.length !== 1 || !(code in FACT_RETRYABLE)) {
    throw new Error(`scriptedExecutor: facts ${JSON.stringify(facts)} are not supported yet (a single known §16.7 fact only)`);
  }
  return {
    outcome: DISCARDED_CODES.has(code) ? 'discarded' : 'failed',   // Task P6.8
    scopeProof: descriptor.scopeProof ?? 'not-checked',
    failure: {
      code, retryable: FACT_RETRYABLE[code],
      ...(descriptor.capacityKind !== undefined ? { capacityKind: descriptor.capacityKind } : {}),
      ...modelKeys,
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
  const { outcomeFacts: facts } = splitFacts(descriptor);   // Task P6.8: multi-fact channels
  if (facts.length > 0) {
    return {
      ...base, ...failureFromFact(descriptor, facts),
      // Task P6.6: evidence on a non-merging outcome is carried (default still none).
      pairs: expandPairs(descriptor.pairs, request),
      diagnostics: expandDiagnostics(descriptor.diagnostics, request),
      statistics: descriptor.statistics ?? {},
    };
  }
  if (descriptor.pairsOverflowLength !== undefined) {       // Task P6.8 fix round 2: the marker form
    return {
      ...base, outcome: 'evaluated', scopeProof: descriptor.scopeProof ?? 'equal', failure: null,
      pairs: [], pairsOverflowLength: descriptor.pairsOverflowLength,
      diagnostics: expandDiagnostics(descriptor.diagnostics, request),
      statistics: descriptor.statistics ?? {},
    };
  }
  return {
    ...base, outcome: 'evaluated',
    scopeProof: descriptor.forceScopeProof ?? descriptor.scopeProof ?? 'equal',
    failure: null,
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

  /** Task P6.8: the LIVE half of the attempt's facts (see the header), for the run fixture's wrapper. */
  executor.liveFactsFor = (request) => {
    const list = script[request.unit.unitId] ?? (unscripted === null ? null : [unscripted]);
    if (!Array.isArray(list) || list.length === 0) return { early: [], late: [] };
    return splitFacts(list[Math.min(request.attempt, list.length) - 1]).live;
  };
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
