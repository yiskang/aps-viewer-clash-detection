// clashtest/planning/scopeDigest.js
//
// Scope digests (spec 6.2.1) and the bracketing comparator (spec 16.3.2): the PURE functions a
// conforming ElementEnumerator and the per-unit / read-time bracket loops share, so both sides
// compute the same bytes. The loop that runs them around a findClashes call is P4/P6/P7; the single
// re-digest-and-compare half, `checkScopeBracket`, lives here (reconciliation D1) so P4 can use it
// without importing run/.
//
// This is the ONLY planning module that imports P0's canonical/digest utilities (design choice D8:
// the enumerator computes the digests it returns; P3 only folds them).
import { digestCanonical, digestCanonicalSliced, DIGEST_VERSION } from '../util/canonical.js';
import { ENUMERATION_SCOPE_WHOLE } from './ElementEnumerator.js';

// digestCanonical is SYNCHRONOUS ("small values only"); digestCanonicalSliced is its byte-identical
// Promise-returning form for a caller that holds large data (the Viewer enumerator adapter over a real
// whole-model population). Both digest functions therefore return a Promise on either path.
const digestOne = (value, slicer, label) =>
  (slicer ? digestCanonicalSliced(value, slicer, { label }) : Promise.resolve(digestCanonical(value)));

const isObject = (v) => v !== null && typeof v === 'object';
const isDbId = (n) => Number.isSafeInteger(n) && n >= 0;

/** The three population record classes of spec 6.2.1: loaded, not loaded, owner-unresolvable. */
export const POPULATION_CLASS = Object.freeze({ LOADED: 'L', NOT_LOADED: 'N', OWNER_UNRESOLVABLE: 'U' });

/**
 * Canonical, ascending-by-fragId record list for a population digest: `[fragId,'N']`, `[fragId,'U']`
 * or `[fragId,'L',ownerDbId,geometryId]`. Sorts a copy; a malformed record is a TypeError (a
 * digest over a guessed record would be evidence about nothing).
 * @param {Array<{fragId:number, cls:'L'|'N'|'U', ownerDbId?:number, geometryId?:number}>} records
 * @returns {Array<Array<number|string>>}
 */
export function encodePopulationRecords(records) {
  const sorted = [...records].sort((a, b) => a.fragId - b.fragId);
  return sorted.map((r) => {
    if (!isDbId(r.fragId)) throw new TypeError('population record: fragId must be a non-negative safe integer');
    if (r.cls === POPULATION_CLASS.NOT_LOADED) return [r.fragId, 'N'];
    if (r.cls === POPULATION_CLASS.OWNER_UNRESOLVABLE) return [r.fragId, 'U'];
    if (r.cls !== POPULATION_CLASS.LOADED) throw new TypeError(`population record ${r.fragId}: unknown class ${String(r.cls)}`);
    if (!isDbId(r.ownerDbId) || !Number.isSafeInteger(r.geometryId))
      throw new TypeError(`population record ${r.fragId}: a loaded fragment needs ownerDbId and geometryId`);
    return [r.fragId, 'L', r.ownerDbId, r.geometryId];
  });
}

/**
 * Population digest for a whole-model scope; covers `count` and the record list (spec 6.2.1), so a
 * status flip, an owner change, a count-preserving geometry replacement, growth and shrink all move it.
 * @param {{count:number, records:object[]}} population
 * @param {{slicer?: {tick:(label?:string)=>(void|Promise<void>)}}} [opts]  a P0 slicer for large data
 * @returns {Promise<{kind:'population', count:number, digest:string, digestVersion:number}>}
 */
export async function digestPopulation({ count, records }, { slicer } = {}) {
  const digest = await digestOne(
    { k: 'population', count, r: encodePopulationRecords(records) }, slicer, 'digest-population');
  return { kind: 'population', count, digest, digestVersion: DIGEST_VERSION };
}

/**
 * Subtree digest for one root (an explicit target root or a source root): the sorted
 * `[fragId, ownerDbId, geometryId]` rows of the fragments extractFragments would take from it.
 * @param {Array<{fragId:number, ownerDbId:number, geometryId:number}>} records
 * @param {{slicer?: {tick:(label?:string)=>(void|Promise<void>)}}} [opts]
 * @returns {Promise<{digest:string, digestVersion:number}>}
 */
export async function digestSubtree(records, { slicer } = {}) {
  const rows = [...records]
    .sort((a, b) => a.fragId - b.fragId)
    .map((r) => [r.fragId, r.ownerDbId, r.geometryId]);
  const digest = await digestOne({ k: 'subtree', r: rows }, slicer, 'digest-subtree');
  return { digest, digestVersion: DIGEST_VERSION };
}

const isDigestRow = (r) => isObject(r) && isDbId(r.dbId);
const expectationOk = (e) => isObject(e) && (
  (e.scope === 'whole' && isObject(e.population))
  || (e.scope === 'roots' && Array.isArray(e.roots) && e.roots.every(isObject)));

/**
 * Compare ONE planning-time scope expectation with ONE observation of the live scope. Exact string
 * equality (spec 16.3.2): no thresholds, no counts-only heuristics. `mismatch` (a demonstrated
 * change) and `unverifiable` (we could not tell) are distinct because 16.3.3 treats them differently
 * and this function never collapses them; anything that cannot be read as an observation of the
 * expected kind fails closed as `unverifiable`.
 *
 * `role` is an OPAQUE label: it is copied to the result and never branched on, so any string
 * ('source', 'target', or P6's read-time 'recorded') runs through identical code.
 * @param {{modelKey:string, role:string, scope:'whole'|'roots', population?:{count:number,digest:string}, roots?:Array<{dbId:number, subtreeDigest:string}>}} expect
 * @param {unknown} observed  a digestScope answer, or null/undefined when none could be obtained
 * @returns {{status:'equal'|'mismatch'|'unverifiable', modelKey:string, role:string, detail:string|null}}
 */
export function compareScopeExpectation(expect, observed) {
  const base = { modelKey: expect?.modelKey, role: expect?.role };
  if (!expectationOk(expect)) return { ...base, status: 'unverifiable', detail: 'malformed-expectation' };
  if (!isObject(observed)) return { ...base, status: 'unverifiable', detail: 'no-observation' };
  if (expect.scope === 'whole') {
    if (observed.kind !== 'population') return { ...base, status: 'unverifiable', detail: 'kind-mismatch' };
    return observed.count === expect.population.count && observed.digest === expect.population.digest
      ? { ...base, status: 'equal', detail: null }
      : { ...base, status: 'mismatch', detail: 'population' };
  }
  if (observed.kind !== 'roots') return { ...base, status: 'unverifiable', detail: 'kind-mismatch' };
  if (!Array.isArray(observed.roots) || !observed.roots.every(isDigestRow))
    return { ...base, status: 'unverifiable', detail: 'malformed-observation' };
  if (observed.roots.length !== expect.roots.length) return { ...base, status: 'mismatch', detail: 'root-count' };
  const seen = new Map(observed.roots.map((r) => [r.dbId, r.subtreeDigest]));
  for (const r of expect.roots) {
    if (seen.get(r.dbId) !== r.subtreeDigest) return { ...base, status: 'mismatch', detail: `root:${r.dbId}` };
  }
  return { ...base, status: 'equal', detail: null };
}

/** The scope to re-digest for one expectation entry, or null when the entry is not a usable expectation. */
const scopeOfExpectation = (entry) => {
  if (!expectationOk(entry)) return null;
  return entry.scope === 'whole' ? ENUMERATION_SCOPE_WHOLE : { dbIds: entry.roots.map((r) => r.dbId) };
};

/**
 * One side of a bracket: re-`digestScope` every scope the expectation lists and fold
 * `compareScopeExpectation` over the answers. Folding rules, both fail-closed:
 *   - `unverifiable` absorbs `equal` (a scope we could not read is never proof of no change);
 *   - `drift` dominates both (a demonstrated change is never downgraded to "could not tell").
 * `modelKeys` names the models that produced the WINNING status, ascending, de-duplicated.
 *
 * `bindings` is a `Map<modelKey, Binding|null>` built by the CALLER from P1's positional
 * `snapshotBindings` array (R7). Per reconciliation N10 a Binding has no `dead` flag: dead,
 * unregistered and lease-invalid all read as `null`, and an absent key reads as `null` too. A `null`
 * binding is `unverifiable`, never `equal`. The expectation is never rebuilt here (it arrives from
 * `materializeUnit(...).scopeExpect`), and each side compares against that PLANNING-TIME expectation
 * rather than against the other side, which is what catches a grow-and-revert between the pre- and
 * post-check. `EnumerationCancelledError` propagates unwrapped: cancellation is never a proof.
 * @param {object[]} scopeExpect
 * @param {{enumerator: {digestScope: Function}, bindings: Map<string, object|null>, ctx: object}} deps
 * @returns {Promise<{proof:'equal'|'drift'|'unverifiable', modelKeys:string[]}>}
 */
export async function checkScopeBracket(scopeExpect, { enumerator, bindings, ctx }) {
  const drifted = new Set();
  const unverifiable = new Set();
  for (const entry of scopeExpect) {
    const scope = scopeOfExpectation(entry);
    const binding = bindings.get(entry?.modelKey) ?? null;
    if (binding === null || scope === null) { unverifiable.add(entry?.modelKey); continue; }
    let observed = null;
    try {
      observed = await enumerator.digestScope(binding, scope, ctx);
    } catch (e) {
      if (e && e.name === 'EnumerationCancelledError') throw e; // cancellation is never a proof
      unverifiable.add(entry.modelKey); continue;
    }
    const cmp = compareScopeExpectation(entry, observed);
    if (cmp.status === 'mismatch') drifted.add(entry.modelKey);
    else if (cmp.status === 'unverifiable') unverifiable.add(entry.modelKey);
  }
  const asc = (s) => [...s].sort(); // default sort = UTF-16 code-unit order = compareModelKeys
  if (drifted.size) return { proof: 'drift', modelKeys: asc(drifted) };
  if (unverifiable.size) return { proof: 'unverifiable', modelKeys: asc(unverifiable) };
  return { proof: 'equal', modelKeys: [] };
}
