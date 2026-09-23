// test/clashtest/support/scriptedExecutor.mjs
//
// P6's scripted `UnitExecutor` (A9/N26: the executor IS a function `(request) => Promise<UnitOutcome>`,
// never an object with `.execute`). The script maps `unitId -> [attemptDescriptor, ...]`; attempt `n`
// of a unit consumes descriptor `n - 1` (the last one repeats if the script runs out).
//
// Task P6.4 builds the MINIMAL vocabulary its own lifecycle tests need:
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
// export's signature or default behaviour, only add descriptor keys / options): `pairs`,
// `diagnostics`, `statistics`, `capacityKind`, `scopeProof`, non-empty `facts` expanded into P4's
// shape, `malformed`, `generations`, `shuffleFacts`, `attemptsFor`, `maxConcurrent`, `requests`,
// `createScriptedExecutor.capacityAlways(opts)`. A descriptor key this minimal version does not
// understand FAILS LOUDLY (it throws from the executor, which P6 turns into `internal-error`) rather
// than being silently ignored.

const KNOWN_DESCRIPTOR_KEYS = new Set(['facts', 'hold', 'outcome', 'failure', 'scopeProof', 'pairs',
  'diagnostics', 'statistics', 'durationMs', 'generations']);

const generationsOf = (request) => {
  const side = () => request.snapshot.map(({ modelKey, bindingGeneration, placementGeneration }) => (
    { modelKey, bindingGeneration, placementGeneration }));
  return { start: side(), end: side() };
};

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
    pairs: descriptor.pairs ?? [],
    diagnostics: descriptor.diagnostics ?? [],
    statistics: descriptor.statistics ?? {},
    durationMs: descriptor.durationMs ?? 0,
  };
  if (descriptor.outcome !== undefined) {                 // P4's own shape: passthrough
    return {
      ...base,
      outcome: descriptor.outcome,
      scopeProof: descriptor.scopeProof ?? (descriptor.outcome === 'evaluated' ? 'equal' : 'not-checked'),
      failure: descriptor.failure ?? null,
    };
  }
  const facts = descriptor.facts ?? [];
  if (facts.length > 0) {
    throw new Error(`scriptedExecutor: non-empty facts ${JSON.stringify(facts)} are not supported yet (Task P6.5 adds them)`);
  }
  return { ...base, outcome: 'evaluated', scopeProof: descriptor.scopeProof ?? 'equal', failure: null };
}

/**
 * @param {Record<string, object[]>} script  unitId -> attempt descriptors
 * @param {{unscripted?: object}} [options]  `unscripted`: the descriptor for a unit the script does
 *   not name (the run fixture's default executor uses `{facts: []}`: every unit evaluates clean).
 *   Omitted, an unscripted unit is a loud executor error.
 */
export function createScriptedExecutor(script = {}, { unscripted = null } = {}) {
  const startedUnits = [];
  const attempts = new Map();                              // unitId -> attempts issued so far
  const holds = new Map();                                 // unitId -> {release, started, resolveStarted}

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
    const { unitId } = request.unit;
    const n = (attempts.get(unitId) ?? 0) + 1;
    attempts.set(unitId, n);
    if (n === 1) startedUnits.push(unitId);
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
  }

  executor.startedUnits = startedUnits;
  /** Resolves once `unitId`'s held attempt is in flight. */
  executor.inFlight = (unitId) => holdFor(unitId).started;
  /** Lets `unitId`'s held attempt return its outcome. */
  executor.release = (unitId) => { holdFor(unitId).release(); };
  return executor;
}
