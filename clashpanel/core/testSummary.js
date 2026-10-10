// clashpanel/core/testSummary.js
// Spec §26.4: the per-test summary of the LAST sealed run, captured once at seal by the editor, and its row wording.
// Pure. Nothing of the set is retained beyond counts/axes and the provenance identity triples (no results[], no
// ledger). A count is always "reported" — a summary never makes a no-clash claim (PD-12; the claim needs a held set).
import { runHeadline } from './runReport.js';

const num = (v) => (Number.isFinite(v) ? v : null);

export function sealSummary({ summary, runState, draft, sealedAt }) {
  const set = summary?.resultSet ?? null;
  const rows = set === null || !Array.isArray(set.provenance?.models) ? [] : set.provenance.models;
  const models = rows
    .filter((m) => m !== null && typeof m === 'object' && typeof m.modelKey === 'string')
    .map((m) => Object.freeze({ modelKey: m.modelKey, bindingGeneration: m.bindingGeneration, modelVersion: m.modelVersion }));
  return Object.freeze({
    runId: typeof summary?.runId === 'string' ? summary.runId : null,
    status: typeof summary?.status === 'string' ? summary.status : null,
    resultCount: set === null ? null : (Array.isArray(set.results) ? set.results.length : null),
    coverage: set === null ? null : (set.outcome?.coverage ?? null),
    integrity: set === null ? null : (set.outcome?.integrity ?? null),
    freshnessAtSeal: set === null ? null : (set.outcome?.freshness ?? null),
    caveatCount: set === null ? null : num(runState?.progress?.caveatCount),
    models: Object.freeze(models),
    definitionKey: typeof draft?.lastRun?.definitionKey === 'string' ? draft.lastRun.definitionKey : null,
    startedAt: num(runState?.startedAtMs),
    sealedAt: num(sealedAt),
  });
}

const RUN_LABEL = Object.freeze({ completed: 'Completed', cancelled: 'Stopped', failed: 'Failed', invalidated: 'Model changed during the run' });

export function summaryStatusText(summary) {
  const status = summary?.status;
  if (summary?.resultCount === null || summary?.resultCount === undefined) {
    return status === 'cancelled' || status === 'failed' || status === 'invalidated'
      ? runHeadline({ status, total: 0, coverage: null, resultSet: null })
      : 'The run ended without a result set.';
  }
  const n = summary.resultCount;
  return `${RUN_LABEL[status] ?? 'Ended'} — ${n === 1 ? '1 clash' : `${n} clashes`} reported${summary.coverage === 'partial' ? ' (partial coverage)' : ''}`;
}
