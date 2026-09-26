// test/clashtest/viewer/support/models.mjs
import { buildMockModel } from '../../../fixtures/mockInstanceTree.mjs';
import { EnumerationCancelledError } from '../../../../clashtest/errors.js';

/** Single-rooted mock model: `children` hang under a non-fragment-owning root, dbId 1. */
export function rootedModel(children, options = {}) {
  const { id = 'm1', ...rest } = options;
  const { model, stats } = buildMockModel([{ dbId: 1, children }], new Map(), rest);
  return { model: { ...model, id }, stats };
}

export const bindingOf = (modelKey, model, epoch = 1) => ({
  modelKey, model, modelVersion: 'v1', lease: { epoch }, bindingGeneration: 1, placementGeneration: 0,
});

export function liveCtx() {
  const calls = { n: 0 };
  return { ctx: Object.freeze({ checkpoint() { calls.n += 1; } }), calls };
}

export function cancellingCtx(afterN) {
  let n = 0;
  return Object.freeze({
    checkpoint() {
      n += 1;
      if (n > afterN) throw new EnumerationCancelledError({ reason: 'cancelled' });
    },
  });
}
