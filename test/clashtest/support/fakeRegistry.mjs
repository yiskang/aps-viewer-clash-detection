// test/clashtest/support/fakeRegistry.mjs
//
// PLACEHOLDER for the ModelRegistry port (spec 4.3). P1 owns the real `ModelRegistry`
// (identity/ModelRegistry.js); P0 only needs "look up a binding by modelKey" for the enumerator and
// executor doubles. The binding shape below is ASSUMED and must be reconciled with P1:
//   { modelKey, modelVersion, model, bindingGeneration }
// Tests that exercise identity semantics (version conflicts, generations, leases) must use the
// real registry once P1 lands, not this fake.
import { ModelKeyVersionConflictError } from '../../../clashtest/errors.js';

export function createFakeRegistry({ registrySessionId = 'fake-session-1', models = [] } = {}) {
  const bindings = new Map();
  const registry = {
    registrySessionId,
    register({ modelKey, modelVersion, model = null }) {
      const existing = bindings.get(modelKey);
      if (existing && existing.modelVersion !== modelVersion) {
        throw new ModelKeyVersionConflictError({ modelKey, existingVersion: existing.modelVersion, offeredVersion: modelVersion });
      }
      const binding = Object.freeze({ modelKey, modelVersion, model, bindingGeneration: existing ? existing.bindingGeneration + 1 : 1 });
      bindings.set(modelKey, binding);
      return binding;
    },
    getBinding(modelKey) { return bindings.get(modelKey) ?? null; },
    /** Frozen array of current bindings, ascending by modelKey (code-unit order). */
    snapshotBindings() { return Object.freeze([...bindings.values()].sort((a, b) => (a.modelKey < b.modelKey ? -1 : a.modelKey > b.modelKey ? 1 : 0))); },
  };
  for (const m of models) registry.register(m);
  return registry;
}
