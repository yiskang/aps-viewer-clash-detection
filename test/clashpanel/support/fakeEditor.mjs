// test/clashpanel/support/fakeEditor.mjs
// Scriptable double of the editor surface the Clash Tests manager consumes (spec §26.11): getViewModel / subscribe /
// dispatch, with INTENT.TEST_LOAD answered by a per-call script (default: the real controller's contract). Notifications
// are SYNCHRONOUS, like the controller's touch(). The ViewModel carries only what the manager reads: {version, test, run}.
import { INTENT } from '../../../clashpanel/core/intents.js';
import { createDraft } from '../../../clashpanel/core/draft.js';
import { createTestsManager } from '../../../clashpanel/core/testsManager.js';
import { createFakeScheduler } from './fakeScheduler.mjs';
import { createFakeCatalog } from './fakeCatalog.mjs';
import { createScriptedEngine, createRecordingBridge, makeFakeModel } from './controllerHarness.mjs';
import { settle } from './settle.mjs';

/** The real controller's TEST_LOAD contract (controller.js onTestLoad), for scripts that want the normal path. */
export function defaultLoad(intent, editor) {
  const t = editor.test;
  const refuse = (reason) => ({ ok: false, testId: t.testId, version: editor.getViewModel().version, releaseStuck: false, reason });
  if (t.runActive) return refuse('run-active');
  if (t.heldUnsaved && intent.acknowledgeUnsaved !== true) return refuse('unsaved-results');
  editor.set({ testId: intent.testId, draft: intent.draft, lastRun: null, heldUnsaved: false, pendingConfirm: false }, { runPatch: { state: 'idle', progress: null } });
  return { ok: true, testId: intent.testId, version: editor.getViewModel().version, releaseStuck: false };
}

export const lastRunOf = (runId, resultCount, over = {}) => Object.freeze({
  runId, status: 'completed', resultCount, coverage: 'full', integrity: 'clean', freshnessAtSeal: 'current', caveatCount: 0,
  models: Object.freeze([]), definitionKey: null, startedAt: 0, sealedAt: 1, ...over,
});

export function createFakeEditor({ testId = 'test-1' } = {}) {
  const subscribers = new Set();
  const dispatched = [];
  const labelScopes = [];                        // seam (e) payloads, kept apart from `dispatched`
  const loadScript = [];
  let version = 0;
  let test = { testId, draft: createDraft({ testId, testNumber: 1 }), runActive: false, heldUnsaved: false, pendingConfirm: false, lastRun: null };
  let run = { state: 'idle', progress: null };
  const build = () => Object.freeze({ version, test: Object.freeze({ ...test }), run: Object.freeze({ ...run }) });
  let vm = build();
  const editor = {
    dispatched,
    labelScopes,
    get test() { return vm.test; },
    subscriberCount: () => subscribers.size,
    /** Change the snapshot; `notify:false` models a change the manager has not observed yet. */
    set(patch = {}, { runPatch = null, notify = true } = {}) {
      test = { ...test, ...patch };
      if (runPatch) run = { ...run, ...runPatch };
      version += 1;
      vm = build();
      if (notify) for (const cb of [...subscribers]) cb(vm);
    },
    /** Queue the behaviour of the NEXT TEST_LOAD: (intent, editor) => LoadResult | Promise<LoadResult>. */
    scriptLoad(fn) { loadScript.push(fn); },
    getViewModel: () => vm,
    subscribe(cb) { subscribers.add(cb); return () => { subscribers.delete(cb); }; },
    dispatch(intent) {
      if (intent.type === INTENT.TEST_LABEL_SCOPE) { labelScopes.push([...intent.modelKeys]); return Promise.resolve(undefined); }
      dispatched.push(intent);
      switch (intent.type) {
        case INTENT.TEST_LOAD: return Promise.resolve((loadScript.shift() ?? defaultLoad)(intent, editor));
        case INTENT.CONFIRM_CANCEL: if (test.pendingConfirm) editor.set({ pendingConfirm: false }); return Promise.resolve(undefined);
        case INTENT.RESULTS_CLEAR:
          if (test.heldUnsaved) editor.set({ pendingConfirm: true }); else editor.set({}, { runPatch: { state: 'idle' } });
          return Promise.resolve(undefined);
        case INTENT.RESULTS_CLEAR_CONFIRMED:
          editor.set({ pendingConfirm: false, heldUnsaved: false }, { runPatch: { state: 'idle' } });
          return Promise.resolve(undefined);
        default: return Promise.resolve(undefined);
      }
    },
  };
  return editor;
}

export function makeManagerHarness({ editor = createFakeEditor(), mintId = null } = {}) {
  const scheduler = createFakeScheduler();
  const modelA = makeFakeModel('A');
  const modelB = makeFakeModel('B');
  const catalog = createFakeCatalog({ models: [
    { modelKey: 'mA', displayName: 'Architecture', model: modelA, loaded: true },
    { modelKey: 'mB', displayName: 'Structure', model: modelB, loaded: true },
  ] });
  const engine = createScriptedEngine({ bindings: {
    mA: { modelKey: 'mA', model: modelA, modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 0 },
    mB: { modelKey: 'mB', model: modelB, modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 0 },
  } });
  const bridge = createRecordingBridge();
  let ids = 0;
  const ports = { editor, engine, catalog, bridge, scheduler, mintId: mintId ?? (() => { ids += 1; return `new-${ids}`; }) };
  const manager = createTestsManager(ports);
  return {
    scheduler, catalog, engine, bridge, editor, manager, modelA, modelB, ports,
    vm: () => manager.getViewModel().manager,
    row: (testId) => manager.getViewModel().manager.tests.find((t) => t.testId === testId),
    dispatch: (intent) => manager.dispatch(intent),
    settle: (rounds) => settle(scheduler, rounds),
  };
}
