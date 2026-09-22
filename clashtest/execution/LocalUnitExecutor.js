// clashtest/execution/LocalUnitExecutor.js
//
// The reference `LocalUnitExecutor` (spec §7.2, §7.4, §7.5): resolves bindings, checks per-unit
// leases, brackets the unit with P3's scope-digest protocol, issues EXACTLY ONE `world.findClashes`
// call, maps every library signal (resolved or thrown) onto the §7.5 taxonomy, and projects
// everything to structured-clone-safe plain data before it crosses the port. P4 owns the per-unit
// call only; the world coordinator, the retry loop and the ledger that consumes these outcomes are
// P6.
//
// Duplicate-ownership D1 (RESOLVED): the pre/post scope-digest comparison is P3's
// `checkScopeBracket` (clashtest/planning/scopeDigest.js). This file implements no digest
// comparison of its own and builds no expectation -- both would be a second copy of the comparison
// that spec §16.3.4's invariant I-scope cannot survive. `checkScopeBracket` is imported from
// `planning/`, never from `run/` (P4 may not depend on P6).
import {
  validateExecutionRequest, internalErrorOutcome, LIBRARY_CAPACITY_KINDS, EVIDENCE_KEYS_BY_MODE,
  MAX_NESTED_STRING_CODE_UNITS, MAX_FAILURE_MESSAGE_CODE_UNITS, CAPACITY_DETAILS_KEYS,
} from './UnitExecutor.js';
import { createUnitBindingTable, projectDiagnostics, projectStatistics } from './diagnostics.js';
import { checkScopeBracket } from '../planning/scopeDigest.js';
import { createSlicer } from '../util/slicer.js';

// ================================================================================================
// buildFindClashesQuery -- §7.2 verbatim.
// ================================================================================================

/**
 * ALWAYS the `targets` shape, so the broad phase defaults to 'tlas', cross-model is legal, and
 * `maxBroadPhaseInstancePairs` does not apply (F1, README M2). A whole-model target OMITS `dbIds`
 * entirely -- the library rejects `dbIds: null` and treats only `undefined` as the sentinel, so the
 * key must not be present at all.
 * @param {object} request  a validated ExecutionRequest
 * @param {{byKey: Map<string, object>, sourceBinding: object}} resolved
 * @returns {object} the exact §7.2 query object
 */
export function buildFindClashesQuery(request, resolved) {
  return {
    source: { model: resolved.sourceBinding.model, dbIds: [...request.materialized.sourceDbIds] },
    target: {
      targets: request.materialized.targets.map((t) => {
        const model = resolved.byKey.get(t.modelKey).model;
        return t.scope === 'whole' ? { model } : { model, dbIds: [...t.dbIds] };
      }),
    },
    mode: request.mode,
    groupBy: 'dbId',
    ...(request.mode === 'clearance' ? { clearance: request.clearance } : {}),
    broadPhase: request.broadPhase,
  };
}

// ================================================================================================
// projectPairs -- library orientation, projected (§11.1/§11.2).
// ================================================================================================

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isSafeNonNegInt = (v) => Number.isSafeInteger(v) && v >= 0;
const isPoint3 = (p) => Array.isArray(p) && p.length === 3 && p.every(isFiniteNumber);
const normalizeZero = (n) => (n === 0 ? 0 : n);

/**
 * A whitelisted deep copy of one library evidence value (§7.2's `cloneEvidence`): `null`, a finite
 * number, or `{kind, point:[x,y,z]}` / `{sourcePoint:[…], targetPoint:[…]}` with every coordinate a
 * finite number; anything else becomes the sentinel `{__invalid: true}` so `validateUnitOutcome`
 * rejects it rather than the executor throwing. `-0` normalizes to `0`.
 */
function cloneEvidence(value) {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return normalizeZero(value);
  if (value && typeof value === 'object') {
    if (typeof value.kind === 'string' && isPoint3(value.point)) {
      return { kind: value.kind, point: value.point.map(normalizeZero) };
    }
    if (isPoint3(value.sourcePoint) && isPoint3(value.targetPoint)) {
      return { sourcePoint: value.sourcePoint.map(normalizeZero), targetPoint: value.targetPoint.map(normalizeZero) };
    }
  }
  return { __invalid: true };
}

/**
 * Library orientation, projected. `model` and `modelId` are dropped: `model` is the live Model whose
 * circular `window` reference makes a raw ClashPair[] non-cloneable (F4), and `modelId` is
 * diagnostic-only and not unique (F12). Order is NOT canonicalized -- the library's insertion order
 * differs between TLAS and linear (F3) and §11.3's canonical sort is the engine's job at merge time.
 * @param {unknown} rawPairs
 * @param {{mode: string, limits: {maxPairsPerOutcome: number}, table: object}} opts
 * @returns {{ok: boolean, pairs?: object[], pairsOverflowLength?: number, issue?: object}}
 */
export function projectPairs(rawPairs, { mode, limits, table }) {
  if (!Array.isArray(rawPairs)) return { ok: false, issue: { code: 'pairs-not-array', path: 'pairs', detail: typeof rawPairs } };
  if (rawPairs.length > limits.maxPairsPerOutcome) {
    return { ok: true, pairs: [], pairsOverflowLength: rawPairs.length };
  }
  const pairs = [];
  for (const raw of rawPairs) {
    const source = table.resolve(raw?.source?.modelId);
    const target = table.resolve(raw?.target?.modelId);
    // FIX (internal holistic review, 2026-09-22 — codex-review `code` high on this file, reproduced):
    // `dbId` and `type` were copied out of the untrusted library payload VERBATIM, while only
    // `witness`/`distance`/`clearance` went through `cloneEvidence`'s whitelist. A library pair whose
    // `dbId` is a function (or any other non-cloneable value) therefore travelled straight into the
    // returned `UnitOutcome`, and `structuredClone(outcome)` threw `DataCloneError` — verified: a
    // `dbId: () => 1` pair produced `evaluated` with `typeof pairs[0].source.dbId === 'function'` and
    // an un-cloneable outcome. That breaks this file's own stated contract ("projects everything to
    // structured-clone-safe plain data BEFORE it crosses the port", F4) exactly where it matters: a
    // worker-hosted executor clones on `postMessage`, which happens BEFORE `validateUnitOutcome` can
    // reject anything, so the port promise rejects instead of yielding the documented outcome.
    // Normalized to `null` rather than dropped, following `cloneEvidence`'s own `{__invalid: true}`
    // philosophy: the value stays clone-safe AND stays illegal, so `validateUnitOutcome` still
    // rejects the outcome (`elementref-invalid-dbid` / `pair-invalid-type`) and P6 substitutes
    // `internalErrorOutcome` — reject, never crash, and never silently coerce to a 0/-1 sentinel.
    const pair = {
      source: { modelKey: source.modelKey, dbId: isSafeNonNegInt(raw?.source?.dbId) ? raw.source.dbId : null },
      target: { modelKey: target.modelKey, dbId: isSafeNonNegInt(raw?.target?.dbId) ? raw.target.dbId : null },
      type: typeof raw?.type === 'string' ? raw.type.slice(0, MAX_NESTED_STRING_CODE_UNITS) : null,
    };
    for (const key of EVIDENCE_KEYS_BY_MODE[mode]) if (raw !== null && typeof raw === 'object' && key in raw) pair[key] = cloneEvidence(raw[key]);
    pairs.push(pair);
  }
  return { ok: true, pairs };
}

// ================================================================================================
// classifyLibraryError -- the §7.5 error taxonomy, matched on error.name (never instanceof).
// ================================================================================================

/**
 * The pinned linear-ceiling message matcher (§7.2), guarded by a T2 compatibility test: the linear
 * broad-phase oracle's ceiling is a PLAIN Error recognized only by this prefix.
 */
export const LINEAR_CEILING_MESSAGE_PREFIX =
  'findClashes: broad-phase candidate count exceeds maxBroadPhaseInstancePairs';

const trunc = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);

/**
 * A property read off an UNTRUSTED thrown value that cannot itself throw (independent review, M2,
 * owner-authorized remediation 2026-09-22). A thrown value's `.name`/`.message`/capacity-detail
 * fields were read directly (`error.name`, `error.message`, `error[key]`, `error.kind`); a hostile
 * getter on any of them rejected the executor's own promise instead of producing the documented
 * `failed:internal-error` outcome -- verified for each field independently. Mirrors `UnitExecutor.js`'s
 * `safeDetail`/`safeThrownMessage`, applied here to the PRODUCER side of the same untrusted boundary.
 */
function safeGet(obj, key) {
  try { return obj == null ? undefined : obj[key]; } catch { return undefined; }
}

/**
 * §7.5, matched on `error.name` rather than `instanceof`: §7.3 anticipates duplicate bundles/module
 * copies in one page, under which `instanceof` would silently fail for a genuine library error and
 * turn a splittable capacity signal into `failed:internal-error`, which fails the whole run.
 * @param {unknown} error
 * @param {{participants: string[], deadModelKeys: string[], placementGenerationChanged: boolean}} ctx
 * @returns {{outcome: 'failed'|'discarded', failure: object}}
 */
export function classifyLibraryError(error, { participants, deadModelKeys, placementGenerationChanged }) {
  const rawName = safeGet(error, 'name');
  const name = typeof rawName === 'string' ? rawName : 'Error';
  const message = trunc(safeGet(error, 'message'), MAX_FAILURE_MESSAGE_CODE_UNITS);
  // FIX (codex-review finding, accepted): `message` is OMITTED entirely, never assigned an explicit
  // `undefined`, when the thrown value carries no string `.message` (a non-Error throw, or an Error
  // whose `.message` isn't a string). `UnitExecutor.js`'s `checkFailure` gates on `Object.hasOwn`, so
  // an own `message: undefined` property reads as "present but the wrong type" and rejects the WHOLE
  // outcome as malformed -- verified by running `classifyLibraryError('a string', ctx)` through
  // `validateUnitOutcome`, which reported `failure-invalid-message`. `errorName` never has this
  // problem: `name` always resolves to a real string above, so `trunc` never returns `undefined` for it.
  const base = { errorName: trunc(name, MAX_NESTED_STRING_CODE_UNITS), ...(typeof message === 'string' ? { message } : {}) };
  switch (name) {
    case 'WorldDisposedError':
      return { outcome: 'failed', failure: { code: 'world-disposed', ...base, retryable: false } };
    case 'ModelEvictedError':
      // F12: the error's modelId is NOT unique. WHICH binding died is established by re-checking
      // leases (§7.4); the error is used only for its class.
      return { outcome: 'failed', failure: { code: 'model-evicted', ...base, modelKeys: [...deadModelKeys].sort(), retryable: false } };
    case 'ModelPlacementChangedError':
      return placementGenerationChanged
        ? { outcome: 'discarded', failure: { code: 'input-changed', ...base, retryable: false } }
        : { outcome: 'failed', failure: { code: 'stale-placement', ...base, retryable: true } };
    case 'CapacityExceededError': {
      const capacityDetails = {};
      // The single shared list imported from `UnitExecutor.js` (this file PRODUCES the field that
      // file's `checkFailure` validates; a second local copy could drift apart from it).
      for (const key of CAPACITY_DETAILS_KEYS) {
        const v = safeGet(error, key);
        if (typeof v === 'number' && Number.isFinite(v)) capacityDetails[key] = v;
      }
      // FIX (codex-review finding, accepted): same class of bug as `base.message` above --
      // `capacityKind: undefined` as an explicit own property is "present but invalid" to
      // `checkFailure`'s `Object.hasOwn` gate and rejects the whole outcome (verified against
      // `validateUnitOutcome` for the linear-ceiling default branch below). Omitted entirely when the
      // library's `kind` isn't one of the closed `LIBRARY_CAPACITY_KINDS`.
      const rawKind = safeGet(error, 'kind');
      const capacityKind = LIBRARY_CAPACITY_KINDS.includes(rawKind) ? rawKind : undefined;
      return { outcome: 'failed', failure: {
        code: 'capacity-exceeded', ...base,
        ...(capacityKind !== undefined ? { capacityKind } : {}),
        capacityDetails, retryable: false,
      } };
    }
    case 'ExtractionLimitExceededError':
      return { outcome: 'failed', failure: { code: 'extraction-limit', ...base, retryable: false } };
    case 'ObjectTreeUnavailableError':
      return { outcome: 'failed', failure: { code: 'object-tree-unavailable', ...base, retryable: false } };
    default:
      // The linear oracle's ceiling is a PLAIN Error, recognized by a pinned message matcher
      // (§7.2). It is a capacity failure, never an internal error -- an internal error fails the
      // whole run, and an oversized 'linear' verification call must not do that.
      if (typeof message === 'string' && message.startsWith(LINEAR_CEILING_MESSAGE_PREFIX)) {
        return { outcome: 'failed', failure: { code: 'capacity-exceeded', ...base, capacityDetails: {}, retryable: false } };
      }
      return { outcome: 'failed', failure: { code: 'internal-error', ...base, retryable: false } };
  }
}

// ================================================================================================
// §16.7 Table A part A -- settlement precedence (NORMATIVE).
// ================================================================================================

/**
 * Table A part A orders the facts of ONE attempt:
 *   U1 `world-disposed` > U2 `internal-error` > U3 `result-cap` > U4 `input-changed` >
 *   U5 `scope-drift`    > U6 `model-evicted`  > U7 `scope-unverifiable` > U8 everything else.
 *
 * Lower number wins. Only the two facts P4 can hold at once are ever compared here: the classified
 * thrown cause (`causeRank`) and the post-check bracket answer (`scopeProofRank`). U3 `result-cap`
 * is listed for completeness -- this executor never produces it, P6 derives it from `pairs-over-cap`
 * -- so that the table reads as the spec's, not as a subset that has to be re-derived to audit.
 *
 * Anything not listed is the U8 bucket (`capacity-exceeded`, `extraction-limit`,
 * `object-tree-unavailable`, `stale-placement`, and any cause a later spec revision adds): the
 * default is deliberately the WEAKEST rank, so a new cause can never silently outrank an observed
 * scope fact without someone adding it to this table on purpose.
 */
const U8 = 8;
const TABLE_A_CAUSE_RANK = Object.freeze({
  'world-disposed': 1,
  'internal-error': 2,
  'result-cap': 3,
  'input-changed': 4,
  'scope-drift': 5,
  'model-evicted': 6,
  'scope-unverifiable': 7,
});
const causeRank = (code) => TABLE_A_CAUSE_RANK[code] ?? U8;

/** The same table, entered by the bracket's own answer. `equal` is not a fact, so it never wins. */
const scopeProofRank = (proof) => {
  if (proof === 'drift') return TABLE_A_CAUSE_RANK['scope-drift'];
  if (proof === 'unverifiable') return TABLE_A_CAUSE_RANK['scope-unverifiable'];
  return Infinity;
};

// ================================================================================================
// Binding resolution and generation reads (§7.4, §16.3.2).
// ================================================================================================

/** F12: `modelId` is `model.id` when present, else the Model object itself, mirroring `collision/CollisionWorld.js`. */
function modelIdOf(model) {
  return model && model.id !== undefined ? model.id : model;
}

/**
 * Resolves every participant named in the unit's own snapshot to its current registry binding.
 * `byKey` stores `null` for a participant with no live binding with a valid lease (row N10) -- the
 * lease gate below is what turns that into a `skipped:model-evicted` outcome; this function never
 * throws on a dead participant.
 * @returns {{byKey: Map<string, object|null>, table: object, sourceBinding: object|null,
 *   targetEntries: Array<{modelKey: string, binding: object|null, scope: string, dbIds?: number[]}>}}
 */
function resolveUnitBindings(request, registry) {
  const participantKeys = [...new Set(request.snapshot.map((s) => s.modelKey))];
  const byKey = new Map(participantKeys.map((modelKey) => [modelKey, registry.bindingFor(modelKey)]));
  const entries = participantKeys
    .filter((modelKey) => byKey.get(modelKey) !== null)
    .map((modelKey) => ({ modelKey, modelId: modelIdOf(byKey.get(modelKey).model) }));
  const table = createUnitBindingTable(entries);
  const sourceBinding = byKey.get(request.unit.sourceModelKey) ?? null;
  const targetEntries = request.materialized.targets.map((t) => ({
    modelKey: t.modelKey,
    binding: byKey.get(t.modelKey) ?? null,
    scope: t.scope,
    ...(t.dbIds !== undefined ? { dbIds: t.dbIds } : {}),
  }));
  return { byKey, table, sourceBinding, targetEntries };
}

/**
 * The binding map the POST-check brackets against.
 *
 * FIX (internal holistic review, 2026-09-22 — codex-review `code` high on this file, reproduced):
 * both brackets used `resolved.byKey`, the map captured BEFORE `world.findClashes`. A participant
 * evicted while the call was in flight was therefore still handed to `checkScopeBracket` as a live
 * binding — and a dead `Model` object stays perfectly readable in JS, so the enumerator happily
 * re-produced the planning-time digest, the post-check returned `equal`, and the unit settled
 * `evaluated` with its pairs merged from an input the run no longer holds. Worse, the death was
 * INVISIBLE downstream: `readGenerations` falls back to the same stale binding, so `generations.end`
 * equalled `generations.start` and P6 had nothing to detect it with. Verified: evicting `mk-b` from
 * inside the scripted `findClashes` yielded `evaluated / equal / 1 pair / generations.end ===
 * generations.start`.
 *
 * Spec §16.3 item 1 is explicit that this case is `discarded:scope-unverifiable` ("the post-check
 * cannot digest a dead binding"), and §16.7 Table A U6 names a binding that "died/re-registered
 * (`bindingGeneration`)" as its own settlement fact. The mechanism already exists and needed no new
 * code or outcome key: P3's `checkScopeBracket` treats a `null` binding as `unverifiable`, never
 * `equal` (row N10, quoted in P4.8's own Interfaces). So a participant that is no longer the SAME
 * live binding the unit started on — gone, re-registered, or lease-invalid — is mapped to `null`
 * here and the post-check fails closed on its own.
 */
function bindingsStillHeld(resolved, registry, world) {
  const out = new Map();
  for (const [modelKey, started] of resolved.byKey) {
    const live = registry.bindingFor(modelKey);
    const held = started !== null && live !== null
      && live.model === started.model
      && live.bindingGeneration === started.bindingGeneration
      && world.isLeaseValid(live.lease);
    out.set(modelKey, held ? started : null);
  }
  return out;
}

/**
 * Every participant the unit no longer HOLDS: no live binding, an invalid lease, or — the addition
 * below — a live binding that is not the one the RUN bound.
 *
 * FIX (internal holistic review, 2026-09-22 — `codex-advisor high`, reproduced): the gate resolved
 * `registry.bindingFor(modelKey)` fresh and asked only "is this alive?", never "is this still the
 * binding the run snapshotted?". After a host reload (unregister + register, which P1 answers by
 * handing out the new `Model` with a fresh valid lease and `bindingGeneration += 1`) the gate passed,
 * the bracket digested the NEW model, and `world.findClashes` ran against a `Model` the run never
 * planned against — reproduced: `evaluated`, one library call, unit-start generation `2` against the
 * request's `1`. Spec §16.1 is categorical that "the engine never re-binds mid-run", and §16.3 item 1
 * relies on exactly that ("nothing in the run mixes it with a different one"), routing a reload to
 * `skipped`/`failed:model-evicted` — which §16.7 Table A **U6** confirms by naming a binding that
 * "died/**re-registered** (`bindingGeneration`)" as that settlement fact.
 *
 * Letting P6 reject the outcome afterwards is NOT an equivalent remedy: it cannot un-issue a
 * `findClashes` call already made against the wrong `Model`. The comparison needs nothing new — the
 * run-start generations are already on `request.snapshot` — and it runs BEFORE any digest or call.
 */
function unheldModelKeysOf(request, registry, world) {
  const runBoundGeneration = new Map(request.snapshot.map((s) => [s.modelKey, s.bindingGeneration]));
  return [...runBoundGeneration.keys()].sort().filter((modelKey) => {
    const binding = registry.bindingFor(modelKey);
    if (binding === null || !world.isLeaseValid(binding.lease)) return true;
    return binding.bindingGeneration !== runBoundGeneration.get(modelKey);
  });
}

/**
 * §16.2 generation reads: freshly re-reads the LIVE registry for every participant (never the
 * cached `resolved` snapshot), so a placement bump or eviction that happens during the library call
 * is visible in `generations.end`. Falls back to the last known binding (from the earlier
 * `resolveUnitBindings` read), then to the request's own run-start snapshot, for a participant whose
 * live binding has since gone `null` -- there is nowhere else to read a generation number from.
 */
function readGenerations(request, registry, resolved) {
  return request.snapshot.map((s) => {
    const live = registry.bindingFor(s.modelKey);
    const fallback = resolved.byKey.get(s.modelKey);
    const source = live ?? fallback ?? s;
    return { modelKey: s.modelKey, bindingGeneration: source.bindingGeneration, placementGeneration: source.placementGeneration };
  });
}

// ================================================================================================
// createLocalUnitExecutor -- the port: (ExecutionRequest) => Promise<UnitOutcome>.
// ================================================================================================

/**
 * @param {{world: object, registry: object, enumerator: object, now: () => number,
 *   yieldToScheduler: () => (void | Promise<void>), sliceBudgetMs: number}} deps
 * @returns {(request: object) => Promise<object>} the UnitExecutor port function
 */
export function createLocalUnitExecutor({ world, registry, enumerator, now, yieldToScheduler, sliceBudgetMs }) {
  // The EnumerationContext (spec §6.2) the bracket forwards to `checkScopeBracket` /
  // `enumerator.digestScope`. `checkpoint()` is the enumeration context's own method (row N6), not a
  // slicer method; the executor's only obligation is to give the enumerator a way to cooperate with
  // the scheduler.
  const ctx = { checkpoint: () => yieldToScheduler() };

  return async function execute(request) {
    const requestCheck = validateExecutionRequest(request);
    // The canonical failed:internal-error shell is the EXPORTED one (P4.5) -- the executor does not
    // hand-build a second one, exactly as P6 does not (row N8).
    if (!requestCheck.ok) return internalErrorOutcome(request, requestCheck.issues);

    const startedAt = now();
    const resolved = resolveUnitBindings(request, registry);
    const participantKeys = request.snapshot.map((s) => s.modelKey).sort();
    const generationsStart = readGenerations(request, registry, resolved);

    const finish = (outcome, scopeProof, failure, rest = {}) => ({
      unitId: request.unit.unitId,
      attempt: request.attempt,
      outcome,
      scopeProof,
      failure,
      generations: { start: generationsStart, end: rest.generationsEnd ?? generationsStart },
      pairs: rest.pairs ?? [],
      diagnostics: rest.diagnostics ?? [],
      ...(rest.pairsOverflowLength !== undefined ? { pairsOverflowLength: rest.pairsOverflowLength } : {}),
      ...(rest.diagnosticOverflowLength !== undefined ? { diagnosticOverflowLength: rest.diagnosticOverflowLength } : {}),
      statistics: rest.statistics ?? {},
      durationMs: now() - startedAt,
    });

    // §7.4. Every model the unit touches, checked BEFORE the call. isLeaseValid is total and
    // non-throwing (F5), so this never needs a try/catch and never costs an epoch. Row N10:
    // `registry.bindingFor(modelKey)` returns `null` for a model with no live binding with a valid
    // lease -- there is no `dead` flag -- so the gate iterates the unit's PARTICIPANTS, not
    // `byKey.values()`, which would both dereference `null` and lose the modelKey of the model that died.
    const unheld = unheldModelKeysOf(request, registry, world);

    // §16.3.2 step 1 -- pre-check. P3 owns BOTH halves of the comparison: the expectation
    // (`materializeUnit(...).scopeExpect`) and the re-digest-and-compare fold (`checkScopeBracket`).
    // P4 owns only WHEN to bracket and what the answer means for the outcome. Drift/unverifiable
    // means the unit is NOT ISSUED.
    const bracket = (bindings) => checkScopeBracket(request.materialized.scopeExpect, { enumerator, bindings, ctx });

    // FIX (C1 violation 3, owner-authorized remediation 2026-09-22, Option B): the lease/re-bind gate
    // used to RETURN here, before any digest ran, so `skipped:model-evicted` (§16.7 Table A **U6**)
    // masked a live co-participant's own observable `scope-drift` (**U5**) -- which Table A ranks
    // strictly ABOVE it. Reproduced: `mk-a`'s lease dead and `mk-b`'s scope changed settled
    // `skipped:model-evicted` / `scopeProof: 'not-checked'` with ZERO digest calls. The gate now only
    // decides WHICH BINDINGS THE BRACKET MAY READ; the settlement choice below is ordered by Table A.
    //
    // The bracket runs against a COPY of `resolved.byKey` with every unheld participant forced to
    // `null` (`checkScopeBracket` reads a `null` binding as `unverifiable`, never `equal` -- row N10).
    // The copy is mandatory and `resolved.byKey` is never mutated: for a truly dead/unregistered
    // participant `byKey` already holds `null` and the overwrite is a no-op, but for the RE-BOUND
    // sub-case (unregister + register, see `unheldModelKeysOf`) it holds a LIVE binding for the WRONG
    // model, and digesting that model is exactly the §16.1 "the engine never re-binds mid-run"
    // violation H5 exists to prevent.
    const preBindings = new Map(resolved.byKey);
    for (const modelKey of unheld) preBindings.set(modelKey, null);

    const pre = await bracket(preBindings);
    // Table A order, strictly: U5 `scope-drift` (5) > U6 `model-evicted` (6) > U7 `scope-unverifiable` (7).
    if (pre.proof === 'drift') return finish('skipped', 'drift', { code: 'scope-drift', modelKeys: pre.modelKeys, retryable: false });

    // FIX (codex-review finding, internal review 2026-09-22, accepted -- pre-existing, not introduced
    // by the C1 remediation above: the window was identical before it, since the lease read always sat
    // before the async bracket). `bracket(...)` is itself async and may yield (`ctx.checkpoint` ->
    // `yieldToScheduler`), so a participant could die or be re-bound WHILE it ran; `unheld` above is
    // stale by the time we get here. Re-validating immediately before the call -- synchronously,
    // nothing awaited in between -- closes that window the same way the original single check closed
    // the window before this fix existed. `unheldNow` also re-covers everything `unheld` covered
    // (nothing un-dies), so this replaces rather than supplements it.
    const unheldNow = unheldModelKeysOf(request, registry, world);
    if (unheldNow.length > 0) {
      return finish('skipped', 'not-checked', { code: 'model-evicted', modelKeys: unheldNow, retryable: false });
    }
    if (pre.proof === 'unverifiable') return finish('skipped', 'unverifiable', { code: 'scope-unverifiable', modelKeys: pre.modelKeys, retryable: false });
    // Past this point every participant has a live binding it still holds, so the query builder and
    // the generation reads may dereference `resolved.byKey.get(k).model` without a null check.

    let result = null;
    let thrown = null;
    try {
      result = await world.findClashes(buildFindClashesQuery(request, resolved));
    } catch (error) {
      thrown = error;
    }

    const generationsEnd = readGenerations(request, registry, resolved);

    // Post-check, run EVEN WHEN the call threw (§7.1: the bracket is executed per unit, both sides
    // compare against the planning-time expectation).
    // The post-check brackets against the bindings the unit STILL holds, not the ones it started
    // with: a participant evicted or re-registered during the call is `null` here and therefore
    // `unverifiable`, never `equal` (see `bindingsStillHeld`, §16.3 item 1).
    const preBracketStillHeld = bindingsStillHeld(resolved, registry, world);
    let post = await bracket(preBracketStillHeld);

    // FIX (H1.4, adjudicated + owner-authorized remediation 2026-09-22, no schema change): the map
    // above is a SYNCHRONOUS snapshot taken as `bracket(...)`'s argument, but `bracket(...)` is itself
    // async and yields internally (`ctx.checkpoint` per digest). A participant that dies WHILE the
    // bracket is still running was handed to `checkScopeBracket` as a live binding for that whole
    // call, so a coincidentally-unchanged digest still answers `equal` even though the model died
    // mid-check -- the identical TOCTOU shape the pre-check `unheldNow` re-check (above) closes,
    // never applied here. Reproduced: with no throw at all, evicting a participant mid-bracket
    // yielded `evaluated`/`equal` with pairs merged from the dead model.
    //
    // Re-validate immediately after the bracket resolves. If a participant died DURING the bracket
    // (present here, absent from the pre-bracket snapshot) and the bracket nonetheless answered
    // `equal`, the answer cannot stand: §16.3 item 1 is explicit the post-check "cannot digest a dead
    // binding", so the true answer is `unverifiable`, never `equal`. A `drift`/`unverifiable` answer
    // already found during the bracket is untouched -- it was proven by an actual value comparison
    // (or an already-known-dead participant), and Table A already ranks drift above model-evicted and
    // scope-unverifiable, so nothing downstream needs it upgraded.
    const postBracketStillHeld = bindingsStillHeld(resolved, registry, world);
    const diedDuringPostBracket = [...postBracketStillHeld.keys()]
      .filter((k) => postBracketStillHeld.get(k) === null && preBracketStillHeld.get(k) !== null);
    if (diedDuringPostBracket.length > 0 && post.proof === 'equal') {
      post = { proof: 'unverifiable', modelKeys: [...diedDuringPostBracket].sort() };
    }

    if (thrown === null) {
      // No thrown cause to weigh: the bracket answer IS the settlement. Unchanged behaviour.
      if (post.proof === 'drift') {
        return finish('discarded', 'drift', { code: 'scope-drift', modelKeys: post.modelKeys, retryable: false }, { generationsEnd });
      }
      if (post.proof === 'unverifiable') {
        return finish('discarded', 'unverifiable', { code: 'scope-unverifiable', modelKeys: post.modelKeys, retryable: false }, { generationsEnd });
      }
    } else {
      // FIX (C1 violations 1 and 2, owner-authorized remediation 2026-09-22, Option B): the two
      // post-check returns above used to run UNCONDITIONALLY, i.e. before `thrown` was ever
      // classified, so a non-equal bracket answer always won and the thrown cause was DESTROYED at
      // the P4 boundary. That masked U1 `world-disposed`, U2 `internal-error` and U4 `input-changed`
      // behind U5 `scope-drift` -- flipping the externally observable run status from `failed` to
      // `invalidated` -- and masked U6 `model-evicted` behind U7 `scope-unverifiable`, which §16.7
      // Table A ranks the other way round. The old rationale ("the fail-closed direction, §16.3
      // item 3") does not hold: §16.3 item 3 defines what a `scope-drift` OUTCOME does to run status
      // and says nothing about precedence against a thrown failure, and for U1-U3 masking is
      // fail-OPEN, since Table A part B resolves `failed` BEFORE `invalidated`.
      //
      // The repair is fact-preserving and needs no schema change, because the two facts already have
      // two independent channels on `UnitOutcome`, and P6's accepted `factsFromOutcome` resolver
      // (p6-run-lifecycle.md ~L2518) is already written to read BOTH off one outcome:
      //   * `failure.code` ALWAYS carries the classified thrown cause;
      //   * `scopeProof`   ALWAYS carries the true bracket answer.
      // Only the coarse outcome KIND is chosen here, by comparing §16.7 Table A part A ranks. P4
      // reports the facts; P6 ranks them.
      const classified = classifyLibraryError(thrown, {
        participants: resolved.table.participants,
        // F12: the error's own modelId is not trusted. WHICH binding died is re-established by a
        // fresh lease recheck -- deliberately NOT the pre-call `unheld` array, since a participant
        // may have died DURING the call (H2).
        deadModelKeys: unheldModelKeysOf(request, registry, world),
        placementGenerationChanged: participantKeys.some((modelKey) => {
          const s = generationsStart.find((g) => g.modelKey === modelKey);
          const e = generationsEnd.find((g) => g.modelKey === modelKey);
          return s?.placementGeneration !== e?.placementGeneration;
        }),
      });
      // When the post-check outranks the thrown cause the call WAS issued and its result is thrown
      // away, which is `discarded` -- the same kind drift/unverifiable already settle to everywhere
      // else in this file. Otherwise the thrown cause keeps its own kind, exactly as before.
      const outcomeKind = scopeProofRank(post.proof) < causeRank(classified.failure.code)
        ? 'discarded'
        : classified.outcome;
      return finish(outcomeKind, post.proof, classified.failure, { generationsEnd });
    }

    // Happy path: project the library's raw pairs/diagnostics/statistics to plain, structured-clone
    // safe data. Any !ok below means the executor built an illegal call or the library returned a
    // shape this build does not understand -- both are `failed:internal-error`.
    //
    // FIX (codex-review finding, accepted): only the `world.findClashes` call itself was guarded by a
    // try/catch. A RESOLVED-but-malformed result (e.g. `result` itself nullish, or a `pairs` array
    // containing a non-plain element) throws while destructuring/iterating it, which would reject the
    // executor's own returned Promise instead of producing the documented `failed:internal-error`
    // outcome -- confirmed by constructing a `{pairs: [null]}` result and observing the raw
    // `TypeError` escape. `result?.pairs` / `result?.statistics` handle a nullish `result` directly;
    // the try/catch is defense-in-depth for a malformed ELEMENT deeper inside the (still untrusted)
    // library payload. `EnumerationCancelledError` is never swallowed here (mirrors
    // `planning/scopeDigest.js`'s own rule): a run cancellation signaled through the injected
    // `yieldToScheduler` must propagate, not collapse into a spurious internal error.
    try {
      const slicer = createSlicer({ now, yieldToScheduler, sliceBudgetMs });
      const projectedPairs = projectPairs(result?.pairs, { mode: request.mode, limits: request.limits, table: resolved.table });
      const { diagnostics: rawDiagnostics, ...rawStatistics } = result?.statistics ?? {};
      const projectedDiagnostics = await projectDiagnostics(rawDiagnostics ?? [], { table: resolved.table, limits: request.limits, slicer });
      const statistics = projectStatistics(rawStatistics);

      if (!projectedPairs.ok) return internalErrorOutcome(request, [projectedPairs.issue]);
      if (!projectedDiagnostics.ok) return internalErrorOutcome(request, [projectedDiagnostics.issue]);
      if (!statistics.ok) return internalErrorOutcome(request, [statistics.issue]);

      return finish('evaluated', 'equal', null, {
        generationsEnd,
        pairs: projectedPairs.pairs,
        diagnostics: projectedDiagnostics.diagnostics,
        pairsOverflowLength: projectedPairs.pairsOverflowLength,
        diagnosticOverflowLength: projectedDiagnostics.diagnosticOverflowLength,
        statistics: statistics.statistics,
      });
    } catch (err) {
      if (safeGet(err, 'name') === 'EnumerationCancelledError') throw err;
      return internalErrorOutcome(request, [{ code: 'projection-threw', path: '', detail: safeGet(err, 'message') }]);
    }
  };
}
