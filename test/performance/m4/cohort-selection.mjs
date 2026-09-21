// test/performance/m4/cohort-selection.mjs
//
// M4 Task 3.3: §5.4's cohort construction algorithm, implemented EXACTLY as specified. PURE --
// operates over the live profiling pass's own output (per-dbId proximity count and
// first-discovery-wins fragment-id set); the profiling walk itself (instances(dbId)/
// proximity(dbId) over real Viewer APIs) lives in browser-probes-m4.mjs, this task's live half.

function sharedInstanceCount(records) {
  const union = new Set();
  for (const r of records) for (const f of r.fragmentIds) union.add(f);
  return union.size;
}

// §5.4's closing rule: weighted density is Sigma(proximity)/Sigma(instances) over the cohort's ONE
// shared, first-discovery-wins fragment set -- never the mean of per-dbId density values.
function weightedDensity(records) {
  const sumProximity = records.reduce((acc, r) => acc + r.proximity, 0);
  const instances = sharedInstanceCount(records);
  return instances === 0 ? 0 : sumProximity / instances;
}

// Step 1: rank by ascending density, ties broken by ascending dbId.
export function rankByDensity(profiles) {
  return profiles
    .map((p) => ({ ...p, instances: p.fragmentIds.size, density: p.fragmentIds.size === 0 ? Infinity : p.proximity / p.fragmentIds.size }))
    .sort((a, b) => (a.density - b.density) || (a.dbId - b.dbId));
}

function nearestRankIndex(q, n) {
  return Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1));
}

// Step 3: the band -- width w = max(3k,25), centred on i_q, clipped/extended per the spec's rule.
function selectBand(ranked, quantile, k) {
  const n = ranked.length;
  const w = Math.max(3 * k, 25);
  if (n <= w) return { band: ranked, bandWasAllOfL: true };
  const iq = nearestRankIndex(quantile, n);
  let lo = iq - Math.floor(w / 2);
  let hi = lo + w;
  if (lo < 0) { hi += -lo; lo = 0; }
  if (hi > n) { lo -= (hi - n); hi = n; }
  return { band: ranked.slice(Math.max(0, lo), hi), bandWasAllOfL: false };
}

// Step 4: walk the band in ascending dbId order, accumulating into ONE shared fragment set.
//
// `mustIncludeDbId` (real bug found running this task's own test): when a dbId has been forced
// into the band (Step 5), achieving k is NOT enough to declare the cohort built -- the forced
// dbId must actually have been walked INTO the accumulated selection, not merely be sitting
// somewhere later in the band's ascending-dbId order. Without this, a small k can be satisfied by
// low-numbered dbIds well before the walk ever reaches the forced entry's turn (forced dbIds are
// real Viewer dbIds, typically large, so they usually sort near the END of ascending-dbId order),
// silently dropping the forced dbId from the very cohort it was forced into -- defeating step 5's
// entire purpose (§5.4 forces the query's actual SOURCE_DB_ID into the HIGH cohort so R6/S2/etc.
// exercise the real source alongside its densest neighbors). Confirmed empirically: profiles
// [dbId 1 (density 1), dbId 2 (density 1), dbId 3076 (density 2, forced)], quantile 0.9, k=1 --
// the unpatched walk returned `requestedDbIds: [1]` (stopped the instant dbId 1 alone reached
// k=1), never including 3076 at all.
function walkBandForCohort(band, k, mustIncludeDbId) {
  const byDbId = [...band].sort((a, b) => a.dbId - b.dbId);
  const accumulated = [];
  let mustIncludeSeen = mustIncludeDbId === undefined;
  for (const entry of byDbId) {
    accumulated.push(entry);
    if (entry.dbId === mustIncludeDbId) mustIncludeSeen = true;
    const achieved = sharedInstanceCount(accumulated);
    if (achieved >= k && mustIncludeSeen) return { requestedDbIds: accumulated.map((e) => e.dbId), achievedInstances: achieved, records: accumulated, reachedK: true };
  }
  return { requestedDbIds: accumulated.map((e) => e.dbId), achievedInstances: sharedInstanceCount(accumulated), records: accumulated, reachedK: false };
}

// Step 5: force 3076 into the HIGH cohort's band, replacing the closest-density member.
function forceIntoBand(band, ranked, forceDbId) {
  if (band.some((e) => e.dbId === forceDbId)) return { band, replacement: null };
  const forced = ranked.find((e) => e.dbId === forceDbId);
  if (!forced) throw new Error(`forced dbId ${forceDbId} is not present in the ranked population`);
  let closest = null;
  for (const e of band) {
    const delta = Math.abs(e.density - forced.density);
    if (!closest || delta < closest.delta || (delta === closest.delta && e.dbId < closest.entry.dbId)) closest = { entry: e, delta };
  }
  return {
    band: band.filter((e) => e.dbId !== closest.entry.dbId).concat(forced),
    replacement: { removedDbId: closest.entry.dbId, forcedDbId: forceDbId, forcedDensity: forced.density, forcedRank: ranked.indexOf(forced) },
  };
}

/** @param ranked  output of rankByDensity
 *  @param quantile 0.25 (low) | 0.5 (typical) | 0.9 (high)
 *  @param k required cohort size, in extracted instances
 *  @param options.forceDbId  pass 3076 only when quantile===0.9 (§5.4 step 5's own scope) */
export function selectCohort(ranked, quantile, k, { forceDbId } = {}) {
  const { band, bandWasAllOfL } = selectBand(ranked, quantile, k);
  let effectiveBand = band;
  let replacement = null;
  // Only set once forceIntoBand has confirmed forceDbId is actually present in `ranked` (it
  // throws otherwise) -- so passing it on to every walkBandForCohort call below is always safe.
  let mustIncludeDbId;
  if (forceDbId !== undefined && quantile === 0.9) {
    const forced = forceIntoBand(band, ranked, forceDbId);
    effectiveBand = forced.band;
    replacement = forced.replacement;
    mustIncludeDbId = forceDbId;
  }
  let walked = walkBandForCohort(effectiveBand, k, mustIncludeDbId);
  let finalBandWasAllOfL = bandWasAllOfL;
  if (!walked.reachedK && !bandWasAllOfL) {
    // Step 6: widen to all of L before declaring NOT EXERCISED.
    //
    // Real bug found via codex-review, independently reproduced: once this widened walk actually
    // runs and succeeds, the achieved cohort came from the FULL population, not the original
    // (possibly forced) narrow band -- §5.4 step 3's own "If n < w the band is all of L, and this
    // is recorded" implies this provenance must be reported faithfully, never left at the
    // ORIGINAL selectBand() verdict. Confirmed with a direct repro: a 60-entry population where
    // the narrow band (even with a forced member swapped in) can only ever reach 2 shared
    // instances, forcing a widen that succeeds using the full 60-entry population -- the
    // unpatched code returned `bandWasAllOfL: false` for a result that had in fact just walked
    // every single ranked entry.
    //
    // The pre-widen `replacement` record is also now stale: it describes a member "removed" from
    // the NARROW band, but the widened full-L walk applies no such removal -- that dbId can
    // legitimately reappear in the final `requestedDbIds` (reproduced directly: `replacement.
    // removedDbId` present in the widened result's own `requestedDbIds`), making the reported
    // replacement misdescribe the cohort actually returned. Cleared here rather than carried
    // forward, since a stale-but-present value is worse than an honest absence for a field whose
    // whole purpose is faithful provenance.
    walked = walkBandForCohort(ranked, k, mustIncludeDbId);
    finalBandWasAllOfL = true;
    replacement = null;
  }
  if (!walked.reachedK) {
    return { status: 'NOT_EXERCISED', achievedInstances: walked.achievedInstances, requestedDbIds: walked.requestedDbIds, bandWasAllOfL: true, replacement };
  }
  return {
    status: 'OK',
    requestedDbIds: walked.requestedDbIds,
    achievedInstances: walked.achievedInstances,
    bandWasAllOfL: finalBandWasAllOfL,
    replacement,
    weightedDensity: weightedDensity(walked.records),
  };
}

// Achieved-separation labelling, decided on ACHIEVED results, never on band overlap alone.
export function labelDensityUnstratified({ low, typical, high }) {
  const allOk = [low, typical, high].every((c) => c.status === 'OK');
  const sameSet = (a, b) => a.status === 'OK' && b.status === 'OK'
    && JSON.stringify([...a.requestedDbIds].sort((x, y) => x - y)) === JSON.stringify([...b.requestedDbIds].sort((x, y) => x - y));
  const identicalSets = sameSet(low, typical) || sameSet(typical, high) || sameSet(low, high);
  const equalDensity = allOk && low.weightedDensity === typical.weightedDensity && typical.weightedDensity === high.weightedDensity;
  const orderingLost = allOk && !(low.weightedDensity < typical.weightedDensity && typical.weightedDensity < high.weightedDensity);
  return identicalSets || equalDensity || orderingLost;
}
