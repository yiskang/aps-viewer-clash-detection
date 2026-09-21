// test/clashtest/support/fakeWorld.mjs
//
// A fake CollisionWorld that records every `findClashes` call and can be scripted to return or
// throw. It fakes ONLY the call the executor makes (spec 7.2). P4/P6 extend it with new files
// (see support/README rule in index.mjs) - they never edit this one.
import { WorldDisposedError } from '../../../collision/errors.js';

/** A stand-in for a Viewer `Model`: a plain object the fake world never inspects. */
export function createFakeModel(id) { return { id, fakeModel: true }; }

export const emptyClashResult = () => ({ pairs: [], statistics: { diagnostics: [] } });

/** Copy of the query with fresh arrays (models kept by reference) so later mutation cannot change an assertion. */
export function snapshotQuery(query) {
  return {
    source: { model: query.source?.model, dbIds: [...(query.source?.dbIds ?? [])] },
    target: {
      targets: (query.target?.targets ?? []).map((t) => ({ model: t.model, ...(t.dbIds ? { dbIds: [...t.dbIds] } : {}) })),
    },
    mode: query.mode,
    groupBy: query.groupBy,
    ...(query.clearance !== undefined ? { clearance: query.clearance } : {}),
    broadPhase: query.broadPhase,
  };
}

export function createFakeWorld({ defaultResult = emptyClashResult } = {}) {
  const calls = [];
  const queue = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let disposed = false;

  const world = {
    calls,
    get inFlight() { return inFlight; },
    get maxInFlight() { return maxInFlight; },
    get disposed() { return disposed; },

    async findClashes(query) {
      if (disposed) throw new WorldDisposedError();
      const call = { index: calls.length, query, snapshot: snapshotQuery(query) };
      calls.push(call);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (queue.length === 0) return defaultResult(call);
        const step = queue.shift();
        if (typeof step === 'function') return await step(query, call);
        if (step instanceof Error) throw step;
        return step;
      } finally {
        inFlight -= 1;
      }
    },

    /** Queue steps consumed by successive calls: a result object, an Error (thrown), or `(query, call) => result | Promise`. */
    script(...steps) { queue.push(...steps); return world; },

    /**
     * Queue a step that parks the next call until released. `started` resolves (with the call record)
     * once the call is in flight; `release(result)` / `fail(error)` settle it.
     */
    hold() {
      let resolveStarted;
      const started = new Promise((res) => { resolveStarted = res; });
      let settle;
      const gate = new Promise((res, rej) => { settle = { res, rej }; });
      queue.push((_q, call) => { resolveStarted(call); return gate; });
      return { started, release: (v = emptyClashResult()) => settle.res(v), fail: (e) => settle.rej(e) };
    },

    dispose() { disposed = true; },
  };
  return world;
}
