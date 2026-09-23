// clashtest/run/settlement.js
//
// Spec §16.7 — normative settlement precedence. Pure: no clock, no I/O, no state.
// Table A decides ONE attempt's primary cause; order B decides the run's status; matrix C's
// merge/discard column is `merges` (only U9 merges).

/** @typedef {'world-disposed'|'internal-error'|'result-cap'|'input-changed'|'scope-drift'
 *           |'model-evicted'|'scope-unverifiable'|'capacity-exceeded'|'extraction-limit'
 *           |'object-tree-unavailable'|'stale-placement'|'unit-cap'|'target-too-large'} Fact */

const F = (rank, fact, code, kindByPhase) => Object.freeze({ rank, fact, code, kindByPhase });

// `kindByPhase` maps WHERE the fact was observed to the §8.3 unit-outcome kind:
//   'pre'  = before the call was issued      'call' = thrown/returned by the attempt
//   'post' = after the call settled
export const UNIT_PRECEDENCE = Object.freeze([
  F(1, 'world-disposed',         'world-disposed',         { pre: 'failed',  call: 'failed',    post: 'failed' }),
  F(2, 'internal-error',         'internal-error',         { pre: 'failed',  call: 'failed',    post: 'failed' }),
  F(3, 'result-cap',             'result-cap',             { pre: 'failed',  call: 'failed',    post: 'failed' }),
  F(4, 'input-changed',          'input-changed',          { pre: 'skipped', call: 'discarded', post: 'discarded' }),
  F(5, 'scope-drift',            'scope-drift',            { pre: 'skipped', call: 'discarded', post: 'discarded' }),
  F(6, 'model-evicted',          'model-evicted',          { pre: 'skipped', call: 'failed',    post: 'failed' }),
  F(7, 'scope-unverifiable',     'scope-unverifiable',     { pre: 'skipped', call: 'discarded', post: 'discarded' }),
  F(8, 'capacity-exceeded',      'capacity-exceeded',      { pre: 'failed',  call: 'failed',    post: 'failed' }),
  F(8, 'extraction-limit',       'extraction-limit',       { pre: 'failed',  call: 'failed',    post: 'failed' }),
  F(8, 'object-tree-unavailable','object-tree-unavailable',{ pre: 'failed',  call: 'failed',    post: 'failed' }),
  F(8, 'stale-placement',        'stale-placement',        { pre: 'failed',  call: 'failed',    post: 'failed' }),
  F(8, 'unit-cap',               'unit-cap',               { pre: 'failed',  call: 'failed',    post: 'failed' }),
  F(8, 'target-too-large',       'target-too-large',       { pre: 'not-run', call: 'not-run',   post: 'not-run' }),
  F(9, null,                     null,                     { pre: 'evaluated', call: 'evaluated', post: 'evaluated' }),
]);                                                       // already in precedence order; a re-sort would
                                                          // be UNSTABLE-safe but pointless, and would hide
                                                          // a mis-ordered row from the dense-rank test.

const ROW_BY_FACT = new Map(UNIT_PRECEDENCE.map((r) => [r.fact, r]));
const MAX_SECONDARY = 8;                                  // §16.7 table A closing paragraph

/** Facts that make the RUN fail (F) / invalidate it (I). §16.7 order B. */
const FAILING_UNIT_CAUSES = Object.freeze(['world-disposed', 'internal-error', 'result-cap']);
const INVALIDATING_UNIT_CAUSES = Object.freeze(['input-changed', 'scope-drift']);

/**
 * Table A + matrix C for ONE attempt. `facts` is the set collected from committed state; the
 * result is a pure function of the SET, never of the arrival order (§16.7 opening paragraph).
 *
 * WITHIN a rank — six facts share rank 8 — the tie-break is the **ascending cause code**
 * (controller ruling R4): the lowest code is the primary cause and every other observed fact goes
 * to `secondaryCauses`, also ascending. Without it, `['capacity-exceeded','stale-placement']` and
 * its reverse would pick different primaries, and two runs over identical facts would seal
 * different ledgers and different `ledgerDigest`s — exactly what AC-21 forbids.
 */
export function classifyUnitSettlement(facts, phase) {
  const seen = new Set();
  for (const f of facts) {
    if (f === null || !ROW_BY_FACT.has(f)) throw new TypeError(`unknown settlement fact: ${String(f)}`);
    seen.add(f);
  }
  let primary = ROW_BY_FACT.get(null);                    // U9
  for (const f of seen) {
    const row = ROW_BY_FACT.get(f);
    if (row.rank < primary.rank) { primary = row; continue; }
    // R4: same rank ⇒ lowest cause code wins. `primary.code === null` only for U9, whose rank is 9
    // and therefore never equal to a real row's rank, so no null comparison can be reached here.
    if (row.rank === primary.rank && row.code < primary.code) primary = row;
  }
  // CANONICAL order first, truncation second — so `secondaryCauses` is the FIRST 8 DISTINCT causes
  // in canonical order, never an arrival-order sample (spec erratum A7 / register S-P6-C3).
  // `observedCauses` is the same list UNCAPPED and WITH the primary: it is what feeds
  // `RunOutcome.reasons`, which erratum A7 and §22 AC-21 require to stay the COMPLETE record even
  // when the unit-level list truncates. It is empty for U9 (`seen` is empty), so I5 still holds
  // structurally and no `'evaluated'` placeholder is ever invented.
  const observedCauses = [...seen].map((f) => ROW_BY_FACT.get(f).code).sort();
  const secondaryCauses = observedCauses
    .filter((c) => c !== primary.code)
    .slice(0, MAX_SECONDARY);
  return Object.freeze({
    outcome: primary.kindByPhase[phase],
    cause: primary.code,
    primaryFact: primary.fact,
    secondaryCauses: Object.freeze(secondaryCauses),
    observedCauses: Object.freeze(observedCauses),        // UNCAPPED; reasons-completeness (A7)
    merges: primary.rank === 9,                           // matrix C: only U9 merges
  });
}

/** Order B. Returns null when the run continues. */
export function resolveRunStatus(state) {
  const failing = state.unitCauses.some((c) => FAILING_UNIT_CAUSES.includes(c))
    || (state.planningCause !== null && state.planningCause !== 'cancelled');
  if (failing) return 'failed';
  const invalidating = state.unitCauses.some((c) => INVALIDATING_UNIT_CAUSES.includes(c))
    || state.placementChangedVsSnapshot;
  if (invalidating) return 'invalidated';
  if (state.cancelRequested !== null || state.disposeRequested) return 'cancelled';
  if (state.planningCause === 'cancelled') return 'cancelled';
  if (state.allLeafUnitsTerminal) return 'completed';
  return null;
}

/**
 * Every observed fact, ascending — a `failed` run still records that a cancel was requested.
 *
 * Two rules the re-verification pinned:
 *  - **I5:** `unitCauses` only ever holds a REAL cause. U9 (`evaluated`) has `cause: null` and the
 *    writer (`applyUnitResult`) pushes `settlement.observedCauses`, which is EMPTY for U9, so a
 *    clean run seals `reasons: []` rather than `['unit:evaluated']`. Nothing is defended here,
 *    because nothing null can arrive here.
 *  - **A7:** the writer pushes the whole **uncapped** `observedCauses` set, not just the primary
 *    cause, so a unit whose `secondaryCauses` truncated at 8 still contributes every observed fact
 *    to `RunOutcome.reasons` — the completeness §16.7 and §22 AC-21 require.
 *  - **Q2:** every §6.6.2 planning gap contributes, not only the one order B resolved the status
 *    from. `planningCause` decides the STATUS; `planningGapCauses` decides the REASONS. The `Set`
 *    makes a repeated cause idempotent and the sort makes the list order-independent, so a run that
 *    reported the same gap twice still seals one digest-stable entry.
 */
export function collectReasons(state) {
  const out = new Set();
  for (const c of state.unitCauses) out.add(`unit:${c}`);
  if (state.planningCause !== null) out.add(`planning:${state.planningCause}`);
  for (const c of state.planningGapCauses) out.add(`planning:${c}`);
  if (state.placementChangedVsSnapshot) out.add('placement-changed');
  if (state.cancelRequested !== null) out.add('cancel-requested');
  if (state.disposeRequested) out.add('engine-disposed');
  return Object.freeze([...out].sort());
}
