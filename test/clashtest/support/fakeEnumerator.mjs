// test/clashtest/support/fakeEnumerator.mjs
//
// A data-driven fake of the ElementEnumerator port (spec 6.2). P3 owns the real port contract and
// its conformance helper; this fake exists so P0-P2 tests and later phases share one double.
// It has NO instance-tree model: an explicit `{dbIds}` scope resolves to the configured roots
// whose dbId is listed (everything else is `unresolved: not-found`). P3 adds hierarchy-aware
// behaviour in a NEW file, not here.
import { EnumerationCancelledError } from '../../../clashtest/errors.js';

const byDbId = (a, b) => a.dbId - b.dbId;
const clone = (v) => (v === undefined ? v : structuredClone(v));

/**
 * @param {object} cfg
 * @param {Record<string, { roots: Array<{dbId:number, fragmentCount:number, ownerDbIds:number[], subtreeDigest:string}>,
 *   population?: {count:number, digest:string} | null, ownerMismatch?: object | null, unreachable?: object | null }>} cfg.models
 * @param {number} [cfg.checkpointsPerCall=1]  how many times a cooperating call awaits ctx.checkpoint()
 * @param {boolean} [cfg.cooperative=true]     false = ignores ctx entirely (the non-cooperating enumerator of AC-7)
 */
export function createFakeEnumerator({ models = {}, checkpointsPerCall = 1, cooperative = true } = {}) {
  const state = new Map(Object.entries(models).map(([k, v]) => [k, clone({ population: null, ownerMismatch: null, unreachable: null, ...v })]));
  const calls = [];
  let onCall = null;

  async function run(kind, binding, scope, ctx) {
    const call = { index: calls.length, kind, modelKey: binding.modelKey, scope: clone(scope) };
    calls.push(call);
    if (cooperative && ctx) for (let i = 0; i < checkpointsPerCall; i++) await ctx.checkpoint();
    if (onCall) await onCall(call);
    const m = state.get(binding.modelKey);
    if (!m) throw new Error(`fake enumerator: unknown model ${binding.modelKey}`);
    const roots = [...m.roots].sort(byDbId);
    if (scope === 'whole') {
      return kind === 'resolveRoots'
        ? { roots: clone(roots), population: clone(m.population), ownerMismatch: clone(m.ownerMismatch), unreachable: clone(m.unreachable), unresolved: [] }
        : { kind: 'population', count: m.population?.count ?? 0, digest: m.population?.digest ?? '' };
    }
    const wanted = new Set(scope.dbIds);
    const picked = roots.filter((r) => wanted.has(r.dbId));
    if (kind === 'digestScope') {
      return { kind: 'roots', roots: picked.map(({ dbId, fragmentCount, subtreeDigest }) => ({ dbId, fragmentCount, subtreeDigest })) };
    }
    const known = new Set(roots.map((r) => r.dbId));
    return {
      roots: clone(picked), population: null, ownerMismatch: null, unreachable: null,
      unresolved: [...wanted].filter((id) => !known.has(id)).sort((a, b) => a - b).map((dbId) => ({ dbId, reason: 'not-found' })),
    };
  }

  return {
    calls,
    resolveRoots: (binding, scope, ctx) => run('resolveRoots', binding, scope, ctx),
    digestScope: (binding, scope, ctx) => run('digestScope', binding, scope, ctx),
    /** Mutate a model's configured content, simulating a change between planning and execution. */
    set(modelKey, patch) { Object.assign(state.get(modelKey), clone(patch)); },
    /** Hook run inside every call after the checkpoints and before the answer (may mutate state via set()). */
    onCall(fn) { onCall = fn; },
  };
}

/** An EnumerationContext whose checkpoint throws EnumerationCancelledError once `cancel(reason)` was called. */
export function createFakeEnumerationContext({ yieldToScheduler = async () => {} } = {}) {
  let cancelReason = null;
  let checkpoints = 0;
  return {
    checkpoint: async () => {
      checkpoints += 1;
      await yieldToScheduler();
      if (cancelReason) throw new EnumerationCancelledError({ reason: cancelReason });
    },
    cancel(reason = 'cancelled') { cancelReason = reason; },
    get checkpoints() { return checkpoints; },
  };
}
