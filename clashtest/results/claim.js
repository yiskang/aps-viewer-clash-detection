// clashtest/results/claim.js
//
// The single normative no-clash claim predicate (spec §8.3) and the single freshness-shape
// adapter (row N19, resolving P6 contradiction C1 -- controller ruling R3). Pure: no I/O, no
// validation of its argument (§13.6 residual trust boundary), no recomputation of freshness.

import { DIGEST_VERSION } from '../util/canonical.js';    // P0 owns the number; P5 never restates it

export const FRESHNESS_STATES = Object.freeze(['current', 'stale', 'unverifiable']);

/** Row N19 / P6 contradiction C1: the ONE adapter between §8.3's bare enum and §16.4's
 *  `{state, reasons}` object. Fail-closed: anything unrecognized is `null`, and `null` is
 *  not `'current'`, so an absent or malformed freshness can never license a claim. */
export function freshnessStateOf(freshness) {
  if (typeof freshness === 'string') return FRESHNESS_STATES.includes(freshness) ? freshness : null;
  if (freshness === null || typeof freshness !== 'object' || Array.isArray(freshness)) return null;
  const { state, reasons } = freshness;
  if (!FRESHNESS_STATES.includes(state)) return null;
  // The Freshness shape is `{state, reasons: string[]}` (§16.4) -- `reasons` is a REQUIRED array,
  // not an optional one. Absent or non-array `reasons` is the same "wrong-shaped object" the row
  // N19 fail-closed rule already names (codex-advisor finding, 2026-09-22: the plan's own reference
  // sketch only rejected a non-array `reasons`, silently accepting a MISSING one -- `{state:
  // 'current'}` would have licensed a claim with no evidence it is really a well-formed Freshness).
  if (!Array.isArray(reasons)) return null;
  return state;
}

/** The `reasons[]` of a `Freshness` object, as claim qualifiers (§16.4 "stale WITH reasons").
 *  A bare string carries none. Non-string entries are skipped, never thrown over. */
function freshnessQualifiers(freshness, state) {
  if (state === null || freshness === null || typeof freshness !== 'object') return [];
  const reasons = Array.isArray(freshness.reasons) ? freshness.reasons : [];
  return reasons.filter((r) => typeof r === 'string').map((reason) => ({ kind: 'freshness', state, reason }));
}

/** The ONE normative claim predicate of spec §8.3. Pure: it does NOT validate its argument
 *  (§13.6 residual trust boundary) and does NOT recompute freshness.
 *  `currentFreshness` is EITHER a `Freshness` object or a bare state string (row N19). */
export function assessNoClashClaim(resultSet, currentFreshness) {
  const freshnessState = freshnessStateOf(currentFreshness);        // called exactly once per helper
  const outcome = resultSet?.outcome ?? {};
  const ledger = resultSet?.ledger ?? {};
  const provenance = resultSet?.provenance ?? {};
  const hierarchy = ledger.hierarchyInternal ?? [];
  const acceptance = provenance.hierarchyInternalAcceptance ?? null;
  // Review Critical 2: THIS predicate owns the digest-version rule. An unknown `digestVersion`
  // means the engine cannot verify the pair set or ledger under its own semantics (§13.6: "not
  // compared … never `current`-claimable"), so it cannot be the basis of a no-clash claim. Absent
  // or malformed `digests` fails the same way — fail-closed by construction, like freshness.
  const knownDigestVersion = resultSet?.digests?.digestVersion === DIGEST_VERSION;
  const conjuncts = {
    completed: outcome.status === 'completed',
    full: outcome.coverage === 'full',
    clean: outcome.integrity === 'clean',
    current: freshnessState === 'current',
    knownDigestVersion,
    nonEmptyPairSpace: Number.isSafeInteger(ledger.pairSpaceTotal) && ledger.pairSpaceTotal > 0,
    notEmptyOperand: ledger.emptyOperand !== true,
    noUnresolvedSelections: (ledger.unresolvedSelections ?? []).length === 0,
    noUnreachablePopulation: (ledger.unreachablePopulation ?? []).length === 0,
    hierarchyClearOrAccepted: hierarchy.length === 0 || acceptance !== null,
    noResults: (resultSet?.results ?? []).length === 0,
  };
  const allowed = Object.values(conjuncts).every(Boolean);
  const unqualified = allowed && hierarchy.length === 0;
  const qualifiers = [];
  if (allowed && hierarchy.length > 0) {
    qualifiers.push({
      kind: 'hierarchy-internal-accepted',
      recordRef: acceptance.recordRef,
      rootCount: hierarchy.reduce((n, e) => n + e.rootCount, 0),
      ownerCount: hierarchy.reduce((n, e) => n + e.ownerCount, 0),
    });
  }
  if (!knownDigestVersion) {
    qualifiers.push({ kind: 'digest-version', reason: 'unknown-digest-version',
                      digestVersion: resultSet?.digests?.digestVersion ?? null });
  }
  qualifiers.push(...freshnessQualifiers(currentFreshness, freshnessState));
  return {
    allowed, unqualified, qualifiers,
    exclusions: [...(provenance.libraryExclusions ?? [])],
    proofMethod: provenance.scopeProof?.method ?? null,
  };
}

export function canClaimNoClashes(resultSet, currentFreshness) {
  return assessNoClashClaim(resultSet, currentFreshness).unqualified;
}
