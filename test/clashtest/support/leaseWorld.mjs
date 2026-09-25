// test/clashtest/support/leaseWorld.mjs
//
// Minimal lease-only fake of the CollisionWorld public lifecycle surface the ModelRegistry uses.
// Semantics mirror the real world (asserted by leaseWorld.contract.test.mjs against BOTH). It has no
// findClashes; richer fakes belong to P0's support kit.

function named(name) {
  const e = new Error(name);
  e.name = name;
  return e;
}

export function makeLeaseWorld() {
  let nextEpoch = 1;
  let disposed = false;
  const lifecycle = new WeakMap(); // model -> { state: 'live', epoch } | { state: 'evicted' }
  const calls = { admitModel: 0, isLeaseValid: 0, evictModel: 0, invalidateModelPlacement: 0 };
  const hooks = { beforeAdmitModel: null, beforeIsLeaseValid: null };

  return {
    calls,
    hooks,
    admitModel(model) {
      calls.admitModel += 1;
      hooks.beforeAdmitModel?.(model);
      if (disposed) throw named('WorldDisposedError');
      const existing = lifecycle.get(model);
      if (existing?.state === 'evicted') throw named('ModelEvictedError');
      if (existing?.state === 'live') return Object.freeze({ model, epoch: existing.epoch });
      const epoch = nextEpoch;
      nextEpoch += 1;
      lifecycle.set(model, { state: 'live', epoch });
      return Object.freeze({ model, epoch });
    },
    isLeaseValid(lease) {
      calls.isLeaseValid += 1;
      hooks.beforeIsLeaseValid?.(lease);
      if (disposed) return false;
      const entry = lifecycle.get(lease.model);
      return entry?.state === 'live' && entry.epoch === lease.epoch;
    },
    evictModel(model) {
      calls.evictModel += 1;
      if (disposed) return;
      if (lifecycle.get(model)?.state === 'evicted') return;
      lifecycle.set(model, { state: 'evicted' });
    },
    invalidateModelPlacement(model) {
      calls.invalidateModelPlacement += 1;
      if (disposed) throw named('WorldDisposedError');
      const entry = lifecycle.get(model);
      if (entry?.state === 'evicted') throw named('ModelEvictedError');
    },
    dispose() {
      if (disposed) throw named('WorldDisposedError'); // the real world's dispose() is not idempotent either
      disposed = true;
    },
  };
}
