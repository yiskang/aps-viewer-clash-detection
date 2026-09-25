// clashtest/viewer/readiness.js
// Mirrors CollisionWorld._awaitObjectTreeReady (docs/superpowers/specs/instance-tree-readiness-decision.md):
// `isObjectTreeCreated() === true` fast path, else model.getObjectTree(onSuccess, onError). Adds only
// (a) a ctx.checkpoint() BEFORE any model read and (b) a cancellation poll while waiting.
import { ObjectTreeUnavailableError } from '../../collision/errors.js';
import { checkpointNow } from './checkpoint.js';

export const DEFAULT_READINESS_POLL_MS = 250; // provisional (G-CAL), overridable

const modelIdOf = (model) => (model && model.id !== undefined ? model.id : model);
const isTree = (t) => t !== null && typeof t === 'object'
  && typeof t.getRootId === 'function' && typeof t.enumNodeChildren === 'function'
  && typeof t.enumNodeFragments === 'function';

function waitForTree(model, ctx, { scheduleTimeout, clearScheduled, pollMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearScheduled(timer);
      fn(value);
    };
    const poll = () => {
      timer = null;
      if (settled) return;
      let pending;
      try { pending = ctx.checkpoint(); } catch (e) { finish(reject, e); return; }
      Promise.resolve(pending).then(
        () => { if (!settled) timer = scheduleTimeout(poll, pollMs); },
        (e) => finish(reject, e),
      );
    };
    timer = scheduleTimeout(poll, pollMs);
    try {
      model.getObjectTree(
        () => finish(resolve),
        (err) => finish(reject, new ObjectTreeUnavailableError(modelIdOf(model), err)),
      );
    } catch (e) {
      finish(reject, new ObjectTreeUnavailableError(modelIdOf(model), e));
    }
  });
}

/**
 * Resolves to the model's instance tree once the Viewer reports it built; rejects with
 * ObjectTreeUnavailableError (never a partial result) when it cannot be, and with the ctx's own
 * EnumerationCancelledError when the run is cancelled while waiting.
 */
export async function awaitObjectTree(model, ctx, {
  scheduleTimeout = (fn, ms) => setTimeout(fn, ms), clearScheduled = (t) => clearTimeout(t), pollMs = DEFAULT_READINESS_POLL_MS,
} = {}) {
  { const p = checkpointNow(ctx); if (p) await p; } // cancellation / engine checkpoint BEFORE the first model read, same tick when sync ("Item D")
  const ready = typeof model?.isObjectTreeCreated === 'function' && model.isObjectTreeCreated() === true;
  if (!ready) {
    if (typeof model?.getObjectTree !== 'function') {
      throw new ObjectTreeUnavailableError(modelIdOf(model), new Error('model exposes no object-tree accessor'));
    }
    await waitForTree(model, ctx, { scheduleTimeout, clearScheduled, pollMs });
    // The wait is an asynchronous boundary (an unload can land during it): run the cancellation / engine checkpoint again before the final read.
    { const p = checkpointNow(ctx); if (p) await p; }
  }
  const tree = model.getObjectTree();
  if (!isTree(tree)) {
    throw new ObjectTreeUnavailableError(modelIdOf(model), new Error('object tree absent or not an instance tree after readiness'));
  }
  const fragList = model.getFragmentList(); // SAME tick as the checkpoint above: no caller reads `model` after an await
  if (fragList === null || typeof fragList !== 'object' || typeof fragList.getCount !== 'function') {
    throw new ObjectTreeUnavailableError(modelIdOf(model), new Error('fragment list unavailable'));
  }
  return { tree, fragList };
}
