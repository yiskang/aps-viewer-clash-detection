// clashtest/derive/summarize.js
import { buildStatusReaderSteps } from '../results/status.js';   // P5 (D4)
import { drive } from './steps.js';

const sortedRows = (map, mk) => [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, v]) => mk(v));
const bump = (map, key, seed) => { const e = map.get(key); if (e) e.count += 1; else map.set(key, { ...seed, count: 1 }); };

export const summarizeRunner = {
  optionKeys: ['signal'],
  prepare: () => ({}),
  async run(_plan, [set], { gate }) {
    const reader = await drive(buildStatusReaderSteps(set), gate);
    const byMode = new Map(); const byPair = new Map(); let cross = 0; let caveated = 0;
    for (const r of set.results) {
      bump(byMode, r.mode, { mode: r.mode });
      const pm = [r.pair.first.modelKey, r.pair.second.modelKey]; bump(byPair, JSON.stringify(pm), { pairModels: pm });
      if (pm[0] !== pm[1]) cross += 1;
      if (reader.pairStatus(r.pair).verdict === 'covered-caveated') caveated += 1;
      const p = gate.tick(); if (p !== undefined) await p;
    }
    const { leaves, planningGaps } = reader.ledger;                        // P5 LedgerModel: leaf units only (split parents are superseded), and the planning gaps
    const outcomes = new Map(); let gapWeight = 0;
    for (const u of leaves) {
      bump(outcomes, `${u.outcome}\u0000${u.cause ?? ''}`, { outcome: u.outcome, cause: u.cause ?? null });
      if (u.outcome !== 'evaluated') gapWeight += u.pairSpaceWeight ?? 0;
      const p = gate.tick(); if (p !== undefined) await p;
    }
    const gaps = new Map(); for (const g of planningGaps ?? []) bump(gaps, g.cause, { cause: g.cause });
    const d = set.diagnostics ?? {};
    return {
      runId: set.runId, status: set.outcome.status, environmentSensitive: !!set.outcome.environmentSensitive,
      axes: { coverage: set.outcome.coverage, integrity: set.outcome.integrity, freshness: set.outcome.freshness, freshnessAtSeal: true },
      totalResults: set.results.length,
      resultsByMode: sortedRows(byMode, (v) => v),
      resultsByPairModels: sortedRows(byPair, (v) => v),
      resultsByCrossModel: { crossModel: cross, sameModel: set.results.length - cross },
      resultsCaveated: caveated,
      unitOutcomes: sortedRows(outcomes, (v) => v), planningGaps: sortedRows(gaps, (v) => v), gapWeight,
      caveats: { total: d.total ?? 0, completenessAffectingUpperBound: d.completenessAffectingUpperBound ?? 0, omittedReasonOccurrences: d.omittedReasonOccurrences ?? 0,
        unclassifiedOccurrences: d.unclassifiedOccurrences ?? 0, countsByReason: structuredClone(d.countsByReason ?? []) },
    };
  },
};
