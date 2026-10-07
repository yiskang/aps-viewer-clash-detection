// clashtest/execution/diagnostics.js
//
// Phase P4's diagnostics layer (spec §12): the single `isCompletenessAffecting` predicate, the
// structural `attributionOf` classifier, the per-unit binding table and single-diagnostic
// projection, the whole-array projection with its two distinct bounding mechanisms (rejection of
// illegal data vs. overflow-with-exact-totals for legal high-cardinality data), the exact per-unit
// taint table, and the cross-unit aggregation into `NormalizedDiagnostic` with exact totals.
//
// This module is the single home of all diagnostic aggregation (duplicate-ownership D3): P5
// consumes a finished `DiagnosticsSummary` from `snapshot()` and aggregates nothing; P6 drives the
// aggregator (one per run) and injects the `admit(n)` ledger-budget oracle of `deriveUnitTaints`.

// DEVIATION FROM PLAN SKETCH (codex-review finding, accepted): the plan's own tables were built as
// `Object.freeze(new Set(...))`. `Object.freeze` only locks the Set OBJECT's own properties; it does
// NOT stop `.add`/`.delete`/`.clear` on the Set's internal entries (those are internal slots, not
// properties). Any importer could still mutate `NON_COMPLETENESS_AFFECTING_REASONS` at runtime and
// silently change what `isCompletenessAffecting` — the ONE predicate this file exists to own — does.
// Wrapped in a Proxy that blocks the three mutating methods while passing every other member
// (`has`, iteration, spreading) through untouched, so the P4.1 tests' `.has(...)` and
// `[...KNOWN_DIAGNOSTIC_REASONS]` usage are unaffected.
// FIX (internal holistic review, 2026-09-22 — codex-review `code` high on this file, reproduced):
// the guard above leaked the real Set through `Set.prototype.forEach`, whose THIRD callback argument
// is the set being iterated. Bound to `real`, it handed every importer an unguarded reference:
// `NON_COMPLETENESS_AFFECTING_REASONS.forEach((_v, _s, leaked) => leaked.add('inconclusive-crossing'))`
// flipped `isCompletenessAffecting('inconclusive-crossing')` from `true` to `false` process-wide —
// verified — which is precisely the "silently change what the ONE predicate does" failure this
// wrapper exists to prevent. `forEach` now re-injects the proxy as the third argument, and the
// property-mutation traps are completed (`defineProperty`, `deleteProperty`, `setPrototypeOf`), so
// there is no longer a path from the exported value back to the underlying Set.
function immutableSet(values) {
  const real = new Set(values);
  const blockedMethods = new Set(['add', 'delete', 'clear']);
  const denied = () => { throw new TypeError('this reason set is immutable'); };
  const proxy = new Proxy(real, {
    get(target, prop) {
      if (blockedMethods.has(prop)) {
        return () => { throw new TypeError(`${String(prop)}() is disabled: this reason set is immutable`); };
      }
      if (prop === 'forEach') {
        return (callback, thisArg) => target.forEach((v, k) => Reflect.apply(callback, thisArg, [v, k, proxy]));
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set: denied,
    defineProperty: denied,
    deleteProperty: denied,
    setPrototypeOf: denied,
  });
  return proxy;
}

/**
 * The ONE completeness predicate (spec §12.3). Two documented library carve-outs, both INFORMATIONAL
 * (carried in every diagnostics table/ledger, never counted as completeness-affecting):
 *   - `witness-unavailable` (README M2.1: the volume-overlap verdict is settled before witness capture);
 *   - `fragment-null-geometry` (owner-authorized, 2026-10-07: an OTG fragment the Viewer deliberately
 *     never loads because its geometry id is INVALID_GEOM_ID — there is no geometry a query could test;
 *     docs/superpowers/specs/m2-extractAllFragments-viewer-evidence.md, "OTG / SVF2" section).
 * EVERYTHING else — including every clearance reason, `fragment-not-loaded`, and every reason this
 * table does not know — counts, because a future library diagnostic must default to "may be incomplete".
 */
export const NON_COMPLETENESS_AFFECTING_REASONS = immutableSet(['witness-unavailable', 'fragment-null-geometry']);

/**
 * Informative, NOT normative (§12.3). Verified as `reason:` literals in `collision/` at the time of
 * writing; the drift test below fails when `collision/` gains one this table lacks, so a new reason
 * is CONSCIOUSLY classified rather than silently defaulted.
 */
export const KNOWN_DIAGNOSTIC_REASONS = immutableSet([
  'fragment-not-loaded', 'fragment-null-geometry', 'fragment-owner-unresolvable', 'geometry-not-yet-available',
  'unsupported-geometry-layout', 'rejected-primitive-range', 'geometry-too-large-for-sync-build',
  'geometry-aspect-ratio-exceeds-tolerance-model', 'index-references-invalid-vertex',
  'crossing-budget-exhausted', 'inconclusive-crossing', 'inconclusive-containment',
  'incomplete-component-coverage', 'non-manifold-component', 'unverified-open-component',
  'unverified-parity-operand', 'clearance-invalid-transform',
  'clearance-anisotropic-scale-unsupported', 'clearance-hard-clash-precheck-inconclusive',
  'clearance-distance-unavailable', 'witness-unavailable',
]);

export function isCompletenessAffecting(reason) {
  return !NON_COMPLETENESS_AFFECTING_REASONS.has(reason);
}

const AMBIGUOUS = Symbol('ambiguous-modelId');

/**
 * §7.1's cap on every nested string in a `UnitOutcome`. Owned HERE and re-exported by
 * `UnitExecutor.js` under the same public spelling.
 *
 * FIX (internal holistic review, 2026-09-22): this was a private `128` in this file AND an exported
 * `128` in `UnitExecutor.js` — the producer of a diagnostic `reason` and the validator of that same
 * field, each with its own copy and no link between them. That is exactly the duplicate-then-drift
 * pattern that already had to be repaired for `LIBRARY_STATISTICS_KEYS`, resolved the same way and in
 * the same direction: `diagnostics.js` owns it (it is the module that actually truncates/enforces it
 * on a projected diagnostic) and `UnitExecutor.js`, which already imports from here, re-exports it so
 * no consumer spelling changes and no import cycle is introduced.
 */
export const MAX_NESTED_STRING_CODE_UNITS = 128;

/**
 * F12: the library's diagnostic `modelId` is NOT unique. Within one unit every participating model
 * is simultaneously live and should be distinct; if two nevertheless claim the same modelId we
 * refuse to guess (§11.2). `modelId` may also be the live Model OBJECT itself
 * (`modelIdOf(model) = model.id ?? model`), so the map is keyed by value/identity, not by string.
 */
export function createUnitBindingTable(entries) {
  const byModelId = new Map();
  for (const { modelKey, modelId } of entries) {
    byModelId.set(modelId, byModelId.has(modelId) && byModelId.get(modelId) !== modelKey
      ? AMBIGUOUS : modelKey);
  }
  const participants = Object.freeze([...new Set(entries.map((e) => e.modelKey))].sort());
  return Object.freeze({
    participants,
    resolve(modelId) {
      const hit = byModelId.get(modelId);
      if (hit === undefined) return { modelKey: null, ambiguous: false }; // not a participant
      if (hit === AMBIGUOUS) return { modelKey: null, ambiguous: true };
      return { modelKey: hit, ambiguous: false };
    },
  });
}

const issue = (code, path, detail) => ({ ok: false, issue: { code, path, detail: String(detail).slice(0, 512) } });
const isPlainObject = (v) => v !== null && typeof v === 'object'
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

function projectOperand(raw, table, path) {
  if (!isPlainObject(raw)) return issue('diagnostic-operand-not-plain', path, 'not a plain object');
  if (!Number.isSafeInteger(raw.fragId) || raw.fragId < 0) return issue('diagnostic-fragid-invalid', `${path}.fragId`, raw.fragId);
  const { modelKey, ambiguous } = table.resolve(raw.modelId);
  // `dbId` is EITHER a non-negative safe integer OR null. Anything else is the attribution table's
  // "anything else" row: legal to receive, impossible to pin down, so it normalizes to null and the
  // diagnostic degrades to `unit` — never coerced, never a 0/-1 sentinel (§12.2.1).
  const dbIdIsLegalInteger = Number.isSafeInteger(raw.dbId) && raw.dbId >= 0;
  const dbId = dbIdIsLegalInteger ? raw.dbId : null;
  // A `role: 'target'` + `dbId: null` pair is the library's genuine "whole-model target" signal
  // (§12.2.1's target-model class) ONLY when the library actually sent `dbId: null`. Some other
  // illegal, non-integer `dbId` normalizes to the same `null` above but carries no such signal —
  // forwarding `role` for it would let attribution mistake unpinnable garbage for a real
  // whole-model-target diagnostic (DEVIATION from the plan sketch's `projectOperand`, which did not
  // track this distinction and so — combined with the plan's own `attributionOf` and the plan's own
  // "non-numeric, non-null dbId … degrades to unit" test — is provably self-contradictory: that
  // exact test fails against the plan's own literal code, verified by running it). `roleSignalLegal`
  // lets `projectDiagnostic` drop `role` in that one illegal-shape case.
  const roleSignalLegal = dbIdIsLegalInteger || raw.dbId === null;
  return { ok: true, operand: { modelKey, dbId, fragId: raw.fragId }, ambiguous, roleSignalLegal };
}

/**
 * Element order (§4.4), with an unresolved modelKey sorting last so it can never alias a real key.
 *
 * FIX (internal holistic review, 2026-09-22 — codex-review `code` high on this file, reproduced): the
 * "sorts last" sentinel was the literal code unit `'￿'`, which is itself a LEGAL `modelKey`
 * (§4.2 constrains nothing about it). A resolved operand whose modelKey really is `'￿'` therefore
 * tied with an unresolved (`null`) operand at the same fragId, and the canonicalization documented two
 * functions below — "`fragments.first/second` are ALREADY canonical", which §12.4's cross-unit dedup
 * key depends on — stopped holding: projecting the same pair with source and target swapped produced
 * `first.modelKey === '￿'` one way and `first.modelKey === null` the other (verified). Replaced by
 * the explicit nullness flag `operandSortParts` already uses correctly, so no string value can alias
 * the sentinel.
 */
function operandOrder(a, b) {
  const na = a.modelKey === null ? 1 : 0;
  const nb = b.modelKey === null ? 1 : 0;
  if (na !== nb) return na - nb;
  const ka = a.modelKey ?? '';
  const kb = b.modelKey ?? '';
  return ka !== kb ? (ka < kb ? -1 : 1) : a.fragId - b.fragId;
}

/**
 * Whether a pair-scoped diagnostic's two operands are already in this module's canonical order.
 *
 * Exported for `UnitExecutor.js`'s boundary validator (added by the internal holistic review,
 * 2026-09-22, on a `codex-advisor` finding). `projectDiagnostic` canonicalizes every pair it builds,
 * and `dedupKey` below — §12.4's cross-unit de-duplication key — ASSUMES that ordering; but the
 * validator, which polices outcomes from executors this module did not build, never checked it, so a
 * reversed pair was accepted and the same physical pair could survive twice as two retained
 * diagnostics. The comparator stays private and single-owner (D3); only this predicate is exposed.
 */
export function pairOperandsAreCanonical(first, second) {
  return operandOrder(first, second) <= 0;
}

export function attributionOf(projected) {
  const operands = projected.scope === 'pair'
    ? [projected.fragments.first, projected.fragments.second]
    : [projected.fragment];
  if (operands.every((o) => typeof o.dbId === 'number' && o.modelKey !== null)) return 'element';
  if (projected.scope === 'fragment' && projected.fragment.role === 'target'
      && projected.fragment.dbId === null && projected.fragment.modelKey !== null) {
    return 'target-model';
  }
  return 'unit';
}

export function projectDiagnostic(raw, table) {
  if (!isPlainObject(raw)) return issue('diagnostic-not-plain', '', 'not a plain object');
  if (typeof raw.reason !== 'string') return issue('diagnostic-reason-not-string', 'reason', typeof raw.reason);
  if (raw.reason.length > MAX_NESTED_STRING_CODE_UNITS) return issue('diagnostic-reason-too-long', 'reason', raw.reason.length);
  const base = { scope: raw.scope, reason: raw.reason, completenessAffecting: isCompletenessAffecting(raw.reason) };
  let projected;
  let ambiguous = false;
  if (raw.scope === 'fragment') {
    const r = projectOperand(raw.fragment, table, 'fragment');
    if (r.ok === false) return r;
    ambiguous = r.ambiguous;
    const role = (raw.role === 'source' || raw.role === 'target') && r.roleSignalLegal ? { role: raw.role } : {};
    projected = { ...base, fragment: { ...r.operand, ...role } };
  } else if (raw.scope === 'pair') {
    const s = projectOperand(raw.sourceFragment, table, 'sourceFragment');
    if (s.ok === false) return s;
    const t = projectOperand(raw.targetFragment, table, 'targetFragment');
    if (t.ok === false) return t;
    ambiguous = s.ambiguous || t.ambiguous;
    // Canonicalized so §12.4's cross-unit dedup key ("canonical pair of (modelKey, fragId)") does not
    // depend on which side the library called source. The library's top-level pair `role` is
    // DROPPED: ProjectedDiagnostic is closed, and first/second already identify both operands.
    const [first, second] = [s.operand, t.operand].sort(operandOrder);
    projected = { ...base, fragments: { first, second } };
  } else {
    return issue('diagnostic-scope-unknown', 'scope', raw.scope);
  }
  projected.attribution = attributionOf(projected);
  if (ambiguous) projected.ambiguousModelId = true;
  return { ok: true, diagnostic: projected };
}

export const LIBRARY_STATISTICS_KEYS = Object.freeze([
  'broadPhasePairs', 'narrowPhasePairs', 'blasBuilt', 'blasCacheHits', 'broadPhaseMs',
  'narrowPhaseMs', 'totalMs', 'tlasLeafRangeEmissions', 'tlasPrimitiveCandidatePairs',
  'tlasExactRetestSurvivors', 'tlasNarrowPhaseInputPairs', 'tlasBuilds', 'tlasCacheHits',
  'tlasSharedBuildWaits', 'tlasBuildMs', 'tlasQueryMs', 'clearanceExpandedCandidatePairs',
  'clearanceExactAabbSurvivors', 'clearanceOverlapPrechecksRun', 'clearanceHardClashExclusions',
  'clearanceDistanceQueriesRun', 'clearanceHits', 'clearanceQueryMs',
]);
const STATISTICS_KEY_SET = new Set(LIBRARY_STATISTICS_KEYS);

export function projectStatistics(raw) {
  if (!isPlainObject(raw)) return issue('statistics-not-plain', 'statistics', 'not a plain object');
  const statistics = {};
  for (const key of Object.keys(raw)) {
    if (!STATISTICS_KEY_SET.has(key)) return issue('statistics-unknown-key', `statistics.${key}`, key);
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return issue('statistics-non-finite', `statistics.${key}`, value);
    statistics[key] = value === 0 ? 0 : value; // normalizes -0
  }
  return { ok: true, statistics };
}

/**
 * §7.1 R11-6. The cap is checked with the O(1) `length` read BEFORE any element is touched, so an
 * over-cap array costs the executor nothing: no iteration, no projected object, no message payload.
 * The engine still re-checks `length` on arrival (an executor is untrusted).
 */
export async function projectDiagnostics(raw, { table, limits, slicer }) {
  if (!Array.isArray(raw)) return issue('diagnostics-not-array', 'diagnostics', typeof raw);
  if (raw.length > limits.maxDiagnosticsPerOutcome) {
    return { ok: true, diagnostics: [], diagnosticOverflowLength: raw.length };
  }
  const diagnostics = [];
  // One slicer per sliced operation (P0): the caller hands in a slicer built for THIS unit, so there
  // is nothing to reset — P0's slicer exposes no `reset()`.
  for (let i = 0; i < raw.length; i++) {
    const pending = slicer.tick('project-diagnostics');
    if (pending) await pending;
    const r = projectDiagnostic(raw[i], table);
    if (r.ok === false) return { ok: false, issue: { ...r.issue, path: `diagnostics[${i}].${r.issue.path}` } };
    diagnostics.push(r.diagnostic);
  }
  return { ok: true, diagnostics };
}

export const TAINT_OVERFLOW_REASON = 'taint-overflow';

// DEVIATION FROM PLAN SKETCH (codex-review finding, accepted): the plan's own `taintKey` joined raw
// fields with `\u0000`/`￿` sentinels without escaping — `modelKey`/`reason` are caller-supplied
// strings validated only for type and length (§7.1), not for excluding those exact code units, so a
// diagnostic carrying one could collide with an unrelated entry and silently merge two taints'
// occurrence counts. `JSON.stringify` on a tuple of the raw (untransformed) fields is collision-free
// by construction and keeps `null` (both `modelKey` and `dbId`) distinguishable from any string/number.
const taintKey = (t) => JSON.stringify([t.kind, t.modelKey, t.dbId, t.reason]);

/**
 * §12.2.1. Exact and independent of the global de-duplicated diagnostic list. Element entries are
 * at OWNER granularity (a pair-scoped element diagnostic implicates BOTH owners) so the record stays
 * small and conservative. Two independent exhaustion triggers — the per-unit element cap and the
 * run-wide ledger budget — collapse to ONE unit-wide `taint-overflow` entry that is a SUPERSET of
 * everything it replaces (every pair of the unit becomes caveated, §12.5 rule 3).
 */
export function deriveUnitTaints(diagnostics, { maxElementTaintsPerUnit, admit = () => true }) {
  const byKey = new Map();
  let elementCount = 0;
  const collapse = () => ({
    taints: [{ kind: 'unit', modelKey: null, reason: TAINT_OVERFLOW_REASON, occurrences: diagnostics.length }],
    overflowed: true,
  });
  const bump = (entry) => {
    const key = taintKey(entry);
    const existing = byKey.get(key);
    if (existing) { existing.occurrences += 1; return; }
    byKey.set(key, { ...entry, occurrences: 1 });
    if (entry.kind === 'element') elementCount += 1;
  };
  for (const d of diagnostics) {
    // FIX (internal holistic review, 2026-09-22 — codex-review `code` high on this file, reproduced):
    // the per-unit element cap was computed by materializing the WHOLE table and filtering it, so a
    // legal high-cardinality outcome allocated every entry only to throw them all away for one
    // `taint-overflow` row. `elementCount` is now maintained incrementally and the collapse happens
    // the moment the cap is passed. The returned value is identical either way — `collapse()` reads
    // only `diagnostics.length`, never the table — so this is a pure early exit, not a semantic
    // change. Same defect and same remedy as P3's `sizeUnits({limit})` finding.
    if (elementCount > maxElementTaintsPerUnit) return collapse();
    if (d.attribution === 'element') {
      // FIX (same review, reproduced): both pair operands were bumped unconditionally, so ONE
      // diagnostic whose two fragments belong to the SAME owner (same `modelKey` + `dbId`, different
      // `fragId` — a self-test, or two fragments of one element) charged that owner's taint
      // `occurrences: 2`. §12.2.1 promises an EXACT count and the entry is explicitly at OWNER
      // granularity, so one diagnostic must implicate one owner exactly once. De-duplicated per
      // diagnostic; a pair spanning two distinct owners still implicates both, as before.
      const operands = d.scope === 'pair' ? [d.fragments.first, d.fragments.second] : [d.fragment];
      const seenOwners = new Set();
      for (const o of operands) {
        const owner = JSON.stringify([o.modelKey, o.dbId]);
        if (seenOwners.has(owner)) continue;
        seenOwners.add(owner);
        bump({ kind: 'element', modelKey: o.modelKey, dbId: o.dbId, reason: d.reason });
      }
    } else if (d.attribution === 'target-model') {
      bump({ kind: 'target-model', modelKey: d.fragment.modelKey, reason: d.reason });
    } else {
      const modelKey = d.scope === 'fragment' ? d.fragment.modelKey : null;
      bump({ kind: 'unit', modelKey, reason: d.reason });
    }
  }
  if (elementCount > maxElementTaintsPerUnit) return collapse();
  // One all-or-nothing charge: the ledger either takes this unit's whole table or the unit collapses
  // into its reserved slot. Charging entry-by-entry would leave a partially recorded table, which
  // §6.5.1's "no partial record" rule forbids.
  if (!admit(byKey.size)) return collapse();
  const taints = [...byKey.values()].sort((a, b) => (taintKey(a) < taintKey(b) ? -1 : 1));
  return { taints, overflowed: false };
}

/**
 * De-duplication key (§12.4): fragment scope by (reason, modelKey, fragId); pair scope by (reason,
 * canonical pair of (modelKey, fragId)) — `fragments.first/second` are ALREADY canonical (P4.2). A
 * diagnostic with a null modelKey is never merged with one from another unit, so its key carries the
 * producing unitId.
 */
// DEVIATION FROM PLAN SKETCH (codex-review finding, accepted): same collision defect as `taintKey`
// above — the plan's own `dedupKey` joined raw `modelKey`/`fragId` fields with a `\u0001` delimiter
// and the whole tuple with `\u0000`, both unescaped, over caller-supplied strings that are never
// validated to exclude those exact code units. `JSON.stringify` closes the same hole here.
function dedupKey(d, unitId) {
  const nullish = d.scope === 'fragment'
    ? d.fragment.modelKey === null
    : d.fragments.first.modelKey === null || d.fragments.second.modelKey === null;
  const operands = d.scope === 'fragment'
    ? [[d.fragment.modelKey, d.fragment.fragId]]
    : [[d.fragments.first.modelKey, d.fragments.first.fragId],
       [d.fragments.second.modelKey, d.fragments.second.fragId]];
  return JSON.stringify([d.scope, d.reason, operands, nullish ? unitId : null]);
}

/** Admission/retention key for `countsByReason` (§12.4): (scope, reason) only — no operand. */
const reasonKeyOf = (d) => `${d.scope}\u0000${d.reason}`;

/** Canonical sort for a retained diagnostic: (scope, reason, modelKey…, fragId…); null modelKey last. */
function operandSortParts(o) {
  return [o.modelKey === null ? 1 : 0, o.modelKey ?? '', o.fragId];
}
function diagnosticSortKey(d) {
  const operands = d.scope === 'pair' ? [d.fragments.first, d.fragments.second] : [d.fragment];
  return [d.scope, d.reason, ...operands.flatMap(operandSortParts)];
}
function compareDiagnosticOrder(a, b) {
  const ka = diagnosticSortKey(a);
  const kb = diagnosticSortKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

/**
 * §11.2/§12.4. The single cross-unit de-duplication and exact-accounting home (duplicate-ownership
 * D3): P6 drives one aggregator per run (`await addUnit` per settled unit, `snapshot()` once at
 * seal); P5 only reads the finished `snapshot()` result and aggregates nothing itself.
 */
export function createDiagnosticAggregator({ maxRetainedDiagnostics, maxDistinctReasons, maxUnitIdsPerDiagnostic, slicer }) {
  const dedupMap = new Map();
  const countsByReason = new Map(); // reasonKey -> {scope, reason, count}
  let total = 0;
  let completenessAffectingCount = 0;
  let unclassifiedOccurrences = 0;
  let omittedReasonOccurrences = 0;
  let geometryReadinessOccurrences = 0;

  async function addUnit(unitId, outcome) {
    if (outcome.diagnosticOverflowLength !== undefined) {
      // The array was never examined (§7.1 H7.2): totals move, but completenessAffectingCount and
      // countsByReason — both keyed on EXAMINED diagnostics — are untouched.
      const n = outcome.diagnosticOverflowLength;
      total += n;
      unclassifiedOccurrences += n;
      return { unitTaints: [{ kind: 'unit', modelKey: null, reason: 'diagnostic-overflow', occurrences: n }] };
    }
    const diagnostics = outcome.diagnostics;

    // Admission order (§12.4): unit order across addUnit calls, then code-unit order of the keys NEW
    // to THIS unit — collected and sorted before any is admitted, so which keys land inside one
    // unit's admission is independent of that unit's own diagnostic array order.
    const seenThisUnit = new Set();
    const newKeysThisUnit = [];
    for (const d of diagnostics) {
      const rk = reasonKeyOf(d);
      if (seenThisUnit.has(rk) || countsByReason.has(rk)) continue;
      seenThisUnit.add(rk);
      newKeysThisUnit.push({ rk, scope: d.scope, reason: d.reason });
    }
    newKeysThisUnit.sort((a, b) => (a.rk < b.rk ? -1 : a.rk > b.rk ? 1 : 0));
    const remaining = Math.max(0, maxDistinctReasons - countsByReason.size);
    for (const { rk, scope, reason } of newKeysThisUnit.slice(0, remaining)) {
      countsByReason.set(rk, { scope, reason, count: 0 });
    }

    let omittedThisUnit = 0;
    let sawOmittedAffecting = false;
    for (const d of diagnostics) {
      const pending = slicer.tick('aggregate-diagnostics');
      if (pending) await pending;
      total++;
      if (d.completenessAffecting) completenessAffectingCount++;
      if (d.reason === 'geometry-not-yet-available') geometryReadinessOccurrences++;
      const bucket = countsByReason.get(reasonKeyOf(d));
      if (bucket) {
        bucket.count++;
      } else {
        omittedReasonOccurrences++;
        omittedThisUnit++;
        if (d.completenessAffecting) sawOmittedAffecting = true;
      }
      const key = dedupKey(d, unitId);
      const existing = dedupMap.get(key);
      if (existing) {
        existing.occurrences++;
        // DEVIATION FROM PLAN SKETCH (codex-review finding, accepted): the plan's prose ("push
        // `unitId` while `unitIds.length < maxUnitIdsPerDiagnostic`") pushes on every repeat hit,
        // including a second occurrence of the SAME diagnostic within the SAME `addUnit` call (whose
        // `unitId` is constant for that whole call) — producing a duplicate entry. `unitIds` records
        // which units contributed, so it must stay a set of distinct ids; `occurrences` above already
        // carries the raw repeat count.
        if (existing.unitIds.length < maxUnitIdsPerDiagnostic && !existing.unitIds.includes(unitId)) {
          existing.unitIds.push(unitId);
        }
      } else {
        dedupMap.set(key, { ...d, occurrences: 1, unitIds: maxUnitIdsPerDiagnostic > 0 ? [unitId] : [] });
      }
    }
    // Fail-safe, benign-only (§12.3): an omission taints the run only if at least one of THIS unit's
    // omitted diagnostics was completeness-affecting.
    const unitTaints = sawOmittedAffecting
      ? [{ kind: 'unit', modelKey: null, reason: 'diagnostic-reason-overflow', occurrences: omittedThisUnit }]
      : [];
    return { unitTaints };
  }

  function snapshot() {
    const sorted = [...dedupMap.values()].sort(compareDiagnosticOrder);
    const truncated = sorted.length > maxRetainedDiagnostics;
    const diagnostics = truncated ? sorted.slice(0, maxRetainedDiagnostics) : sorted;
    const countsByReasonArr = [...countsByReason.values()];
    const sum = countsByReasonArr.reduce((n, c) => n + c.count, 0);
    if (sum + omittedReasonOccurrences + unclassifiedOccurrences !== total) {
      // An engine defect, not data the run can recover from: surfaced loudly rather than silently
      // returned as a wrong number (§12.4's Σ invariant).
      throw new Error(
        `diagnostics aggregator: Sigma invariant violated (${sum} + ${omittedReasonOccurrences} + ${unclassifiedOccurrences} !== ${total})`,
      );
    }
    return {
      diagnostics,
      truncated,
      total,
      completenessAffectingCount,
      unclassifiedOccurrences,
      completenessAffectingUpperBound: completenessAffectingCount + unclassifiedOccurrences,
      countsByReason: countsByReasonArr,
      omittedReasonOccurrences,
      geometryReadinessOccurrences,
    };
  }

  return Object.freeze({ addUnit, snapshot });
}

/**
 * §12.6 library statistics passthrough: per-key sums plus `libraryMsTotal` (Σ of the library's own
 * in-call `totalMs`) and `maxUnitMs` (max of the caller-supplied unit `durationMs`). Deliberately
 * carries no `blasBuilt`/`blasCacheHits` CLAIM beyond summing whatever the library reports for them
 * (it reports both as a constant `0` today).
 */
export function createStatisticsAccumulator() {
  const sums = {};
  let libraryMsTotal = 0;
  let maxUnitMs = 0;
  return Object.freeze({
    add(statistics, durationMs) {
      for (const key of LIBRARY_STATISTICS_KEYS) {
        if (key in statistics) sums[key] = (sums[key] ?? 0) + statistics[key];
      }
      if (typeof statistics.totalMs === 'number') libraryMsTotal += statistics.totalMs;
      if (typeof durationMs === 'number' && durationMs > maxUnitMs) maxUnitMs = durationMs;
    },
    snapshot() {
      return { ...sums, libraryMsTotal, maxUnitMs };
    },
  });
}
