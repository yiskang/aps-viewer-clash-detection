// clashtest/viewer/unloadWiring.js
// Spec 4.3 / 16.6: `unregister` is "wired to BEFORE_MODEL_UNLOAD_EVENT, beside world.evictModel", and any such
// hook "never throws and never awaits" (an uncaught throw aborts the Viewer's teardown of every remaining model).
// The event NAME is the host's (this layer references no Viewer global). Registration stays a host call on
// engine.registry.register(...) (interface-reconciliation S-P1-1); modelKey/modelVersion derivation is OQ-1 (host).
import { assertRegistryBelongsToWorld } from '../identity/ModelRegistry.js';

const isFn = (v) => typeof v === 'function';

export function wireModelUnload({ world, registry, eventTarget, eventName, report = () => {} } = {}) {
  if (!isFn(world?.evictModel)) throw new TypeError('wireModelUnload: world.evictModel is required');
  if (!isFn(registry?.unregister)) throw new TypeError('wireModelUnload: registry.unregister is required');
  if (!isFn(eventTarget?.addEventListener) || !isFn(eventTarget?.removeEventListener)) {
    throw new TypeError('wireModelUnload: eventTarget must implement addEventListener/removeEventListener');
  }
  if (typeof eventName !== 'string' || eventName === '') throw new TypeError('wireModelUnload: eventName is required');
  assertRegistryBelongsToWorld(registry, world); // Codex I4: never split lifecycle state across two worlds (throws ModelBindingError 'registry-mismatch')

  const safeReport = (stage, error) => { try { report(stage, error); } catch { /* a host callback must never break teardown */ } };
  const handler = (event) => {
    let model;
    try { model = event?.model; } catch (e) { safeReport('event', e); return; }
    if (model === undefined || model === null) { safeReport('event', new Error('unload event carried no model')); return; }
    try { registry.unregister(model); } catch (e) { safeReport('unregister', e); }
    try { world.evictModel(model); } catch (e) { safeReport('evict', e); }
  };
  eventTarget.addEventListener(eventName, handler);
  let disposed = false;
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      try { eventTarget.removeEventListener(eventName, handler); } catch (e) { safeReport('dispose', e); }
    },
  });
}
