// clashtest/derive/context.js
import { DerivationBusyError, DerivationAbortedError, CorruptResultSetError } from '../errors.js';
import { resolveEngineLimits } from '../options.js';
import { captureResultSet } from '../results/validateResultSet.js';   // P5's (N29), not a P0 util
import { createSlicer } from '../util/slicer.js';
import { assertClosed, invalid, isAbortSignal } from './validate.js';
import { DEFAULT_RUNNERS } from './runners.js';

export const DERIVATION_LIMIT_KEYS = Object.freeze(['maxConcurrentDerivations', 'maxFacetsPerGroupBy', 'maxFilterClauses',
  'maxGroupMemberships', 'maxComparisonEntries', 'sliceBudgetMs', 'aggregationSliceMaxItems']);

export function assertDerivable(set) {
  const bad = (path) => { throw new CorruptResultSetError({ runId: typeof set?.runId === 'string' ? set.runId : null, issues: [{ path, code: 'not-derivable' }] }); };
  if (set === null || typeof set !== 'object') bad('');
  for (const k of ['results', 'ledger', 'provenance', 'outcome']) if (set[k] === null || typeof set[k] !== 'object') bad(k);
  if (!Array.isArray(set.results)) bad('results');
  if (!Array.isArray(set.ledger.units)) bad('ledger');   // top-level container only; every other ledger field is P5's reader's business (a malformed one surfaces as CorruptResultSetError via invoke's TypeError/RangeError mapping)
}

/** Carries a failure of a HOST-supplied callback (`now` / `yieldToScheduler`) through the runner, so `invoke` can rethrow the
 *  original error object unchanged instead of mistaking a host TypeError/RangeError for a malformed ledger. Not an Error
 *  subclass, so it can never match the TypeError/RangeError mapping; it never escapes `invoke`. */
class HostCallbackFailure { constructor(error) { this.error = error; } }
const wrapNow = (f) => (f === undefined ? undefined : () => { try { return f(); } catch (e) { throw new HostCallbackFailure(e); } });
const wrapYield = (f) => (f === undefined ? undefined : async () => { try { return await f(); } catch (e) { throw new HostCallbackFailure(e); } });

function createGate(slicer, signal) {
  const check = () => { if (signal && signal.aborted) throw new DerivationAbortedError({}); };
  return { check, tick() { check(); const p = slicer.tick(); return p === undefined ? undefined : p.then(check); } };
}

export function createDerivationContext(options = {}) { return createContextInternal(options, {}); }

export function createContextInternal(options = {}, hooks = {}) {
  assertClosed(options, ['limits', 'yieldToScheduler', 'now'], 'options');
  const rawLimits = options.limits ?? {};
  assertClosed(rawLimits, DERIVATION_LIMIT_KEYS, 'options.limits');
  const all = resolveEngineLimits(rawLimits); // §17.1.1 defaults + validation live in P0, not here
  const limits = Object.freeze(Object.fromEntries(DERIVATION_LIMIT_KEYS.map((k) => [k, all[k]])));
  const { now, yieldToScheduler } = options;                       // possibly undefined: createSlicer defaults them (P0 exports no defaults)
  if (now !== undefined && typeof now !== 'function') throw invalid('not-a-function', 'options.now');
  if (yieldToScheduler !== undefined && typeof yieldToScheduler !== 'function') throw invalid('not-a-function', 'options.yieldToScheduler');
  const hostNow = wrapNow(now); const hostYield = wrapYield(yieldToScheduler);   // wrapped once, at construction
  const capture = hooks.capture ?? ((raw) => captureResultSet(raw, { limits: all }));   // P5: {limits} = the resolved engine limits
  const runners = hooks.runners ?? DEFAULT_RUNNERS;
  let active = 0; // per context; never module-global

  async function invoke(name, rawSets, callOptions, args) {
    // Everything up to the first `await` runs synchronously: validation, slot, capture (R19-1, R21-3).
    hooks.assertOpen?.();
    const runner = runners[name];
    const opts = callOptions ?? {};
    assertClosed(opts, runner.optionKeys, `${name}.options`);
    const { signal } = opts;
    if (signal !== undefined && !isAbortSignal(signal)) throw invalid('bad-signal', `${name}.options.signal`);
    const plan = runner.prepare(args, opts, limits);                // sync closed-schema/bounds validation
    if (signal?.aborted) throw new DerivationAbortedError({});
    if (active >= limits.maxConcurrentDerivations) throw new DerivationBusyError({ limit: limits.maxConcurrentDerivations });
    active += 1;                                                    // slot BEFORE capture
    try {
      const sets = rawSets.map((raw) => { const s = capture(raw); assertDerivable(s); return s; });
      const slicer = createSlicer({ now: hostNow, yieldToScheduler: hostYield, sliceBudgetMs: limits.sliceBudgetMs, maxItemsPerSlice: limits.aggregationSliceMaxItems });
      const env = { limits, gate: createGate(slicer, signal), annotations: opts.annotations };
      try { return await runner.run(plan, sets, env); }
      catch (e) { // a captured-but-unvalidated set with a malformed ledger surfaces as TypeError/RangeError: refuse, do not guess
        if (e instanceof HostCallbackFailure) throw e;   // a host callback failed: not a ledger problem (unwrapped below)
        if (e instanceof TypeError || e instanceof RangeError) throw new CorruptResultSetError({ runId: sets[0]?.runId ?? null, issues: [{ path: 'ledger', code: 'malformed' }] });
        throw e;
      }
    } catch (e) { throw e instanceof HostCallbackFailure ? e.error : e; }   // the host's ORIGINAL error object, unchanged (incl. `now` at slicer construction)
    finally { active -= 1; }
  }

  return Object.freeze({
    summarize: (resultSet, o) => invoke('summarize', [resultSet], o, {}),
    groupBy: (resultSet, facets, o) => invoke('groupBy', [resultSet], o, { facets }),
    filter: (resultSet, clauses, o) => invoke('filter', [resultSet], o, { clauses }),
    compareResultSets: (base, next, o = {}) => invoke('compare', [base, next], o, {}),
  });
}
