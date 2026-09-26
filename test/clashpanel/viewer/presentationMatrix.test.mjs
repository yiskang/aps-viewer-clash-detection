// test/clashpanel/viewer/presentationMatrix.test.mjs — AC-P16 failure-injection × interleaving matrix
// (Tier B: against the T3 fake Viewer + its T22 onCall hook only; live behaviour is gate G2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViewerBridge } from '../../../clashpanel/viewer/ViewerBridge.js';
import { targetFor, isolationPrerequisite } from '../../../clashpanel/viewer/isolation.js';
import { createBridgeHarness, NAMES, sameIsolation } from '../support/viewerFaults.mjs';
import { createFakeModel } from '../support/fakeViewer.mjs';
import { createFakeThree } from '../support/fakeThree.mjs';

const BOX = (x) => [x, 0, 0, x + 1, 1, 1];
const OPTS = { focus: true, isolate: true, marker: true };
const MESHES_PER_PRESENT = 3;                       // hard sphere + two outlines

function world({ priorNonEmpty, hidden = [] }) {
  const m1 = createFakeModel({ id: 1, boxes: { 1: BOX(0), 3: BOX(5) } });
  const m2 = createFakeModel({ id: 2, boxes: { 2: BOX(2), 4: BOX(7) } });
  const m3 = createFakeModel({ id: 3 });
  const prior = priorNonEmpty ? [{ model: m3, ids: [42] }] : [];
  const h = createBridgeHarness({ models: [m1, m2, m3], isolation: prior, hiddenNodes: hidden });
  const { THREE } = createFakeThree();
  const bridge = createViewerBridge({ viewerApi: h.api, THREE, names: NAMES });
  const foreignMesh = h.addForeignMesh(NAMES.overlayMarkers);
  const A = { sides: [{ model: m1, dbId: 1 }, { model: m2, dbId: 2 }], point: [0.5, 0.5, 0.5], options: OPTS };
  const B = { sides: [{ model: m1, dbId: 3 }, { model: m2, dbId: 4 }], point: [5.5, 0.5, 0.5], options: OPTS };
  const F = [{ model: m1, ids: [99] }];
  return { h, bridge, prior, A, B, F, foreignMesh, aMeshes: [] };
}

const STEPS = {
  'marker-first': ['addMesh', 1],
  'marker-last': ['addMesh', MESHES_PER_PRESENT],
  isolation: ['setAggregateIsolation', 1],
  fit: ['fitToView', 1],                           // first fit call (aggregate form for two models)
};
const MODES = ['before', 'after'];

// Each interleaving drives the bridge and returns the expected final state:
//   meshes: 'B' (exactly B's markers) | 'none';  isolation: 'B' | 'prior' | 'foreign'.
const INTERLEAVINGS = {
  async 'present/present'({ h, bridge, A, B }, [method, nth], mode, step) {
    h.failAt(method, mode, nth);
    const [oa, ob] = await Promise.all([bridge.present(A), bridge.present(B)]);
    assert.equal(oa.superseded, true);
    const ok = step === 'fit';
    return { meshes: ok ? 'B' : 'none', isolation: ok ? 'B' : 'prior', outcome: ob };
  },
  async 'present-then-present'(w, [method, nth], mode, step) {
    const { h, bridge, A, B } = w;
    const oa = await bridge.present(A);
    assert.equal(oa.marked, true);
    w.aMeshes = h.panelMeshes();
    h.failAt(method, mode, nth);
    const ob = await bridge.present(B);
    const ok = step === 'fit';
    return { meshes: ok ? 'B' : 'none', isolation: ok ? 'B' : 'prior', outcome: ob };
  },
  async 'present/clear'({ h, bridge, A }, [method, nth], mode) {
    h.failAt(method, mode, nth);
    await bridge.present(A);
    await bridge.clear();
    return { meshes: 'none', isolation: 'prior' };
  },
  async 'present/dispose'({ h, bridge, A }, [method, nth], mode) {
    h.failAt(method, mode, nth);
    await bridge.present(A);
    await bridge.dispose();
    return { meshes: 'none', isolation: 'prior', disposed: true };
  },
  async 'clear during present'({ h, bridge, A }, [method, nth], mode) {
    let cleared;
    h.failAt(method, mode, nth);
    h.viewer.onCall(method, () => { cleared = bridge.clear(); }, { nth });
    const aOutcome = await bridge.present(A);
    await cleared;
    return { meshes: 'none', isolation: 'prior', aOutcome, fitCallCount: 1 };
  },
  async 'dispose during present'({ h, bridge, A }, [method, nth], mode) {
    let disposing;
    h.failAt(method, mode, nth);
    h.viewer.onCall(method, () => { disposing = bridge.dispose(); }, { nth });
    const aOutcome = await bridge.present(A);
    await disposing;
    return { meshes: 'none', isolation: 'prior', disposed: true, aOutcome, fitCallCount: 1 };
  },
  async 'newer present during present'({ h, bridge, A, B }, [method, nth], mode) {
    let pb;
    h.failAt(method, mode, nth);
    h.viewer.onCall(method, () => { pb = bridge.present(B); }, { nth });
    const aOutcome = await bridge.present(A);
    const ob = await pb;
    assert.equal(ob.superseded, false);
    // A's fault was consumed by A; B then applies cleanly (after releasing whatever A still held).
    return { meshes: 'B', isolation: 'B', aOutcome, fitCallCount: 2 };   // A's invalidated call + B's own
  },
  async 'foreign isolation change mid-flight'({ h, bridge, A, F }, [method, nth], mode) {
    h.failAt(method, mode, nth);
    h.viewer.onCall(method, () => h.viewer.setIsolationState(F), { nth });
    await bridge.present(A);
    const c = await bridge.clear();
    assert.ok(['none', 'skipped-external'].includes(c.isolation), `foreign state is never restored over (got ${c.isolation})`);
    return { meshes: 'none', isolation: 'foreign' };
  },
};

const cases = [];
for (const priorNonEmpty of [false, true]) {
  for (const [step, spec] of Object.entries(STEPS)) {
    for (const mode of MODES) {
      for (const name of Object.keys(INTERLEAVINGS)) cases.push({ priorNonEmpty, step, spec, mode, name });
    }
  }
}

test(`matrix has ${cases.length} generated cases (4 steps × 2 failure modes × 8 interleavings × 2 priors)`, () => {
  assert.equal(cases.length, 4 * 2 * 8 * 2);
});

for (const c of cases) {
  test(`AC-P16 ${c.name} · ${c.step} throws ${c.mode} state change · prior ${c.priorNonEmpty ? 'non-empty' : 'empty'}`, async () => {
    const w = world({ priorNonEmpty: c.priorNonEmpty });
    const { h, bridge, prior, B, F, foreignMesh } = w;
    const expected = await INTERLEAVINGS[c.name](w, c.spec, c.mode, c.step);
    if (c.step === 'fit' && expected.aOutcome) {
      // F1: invalidated inside a (throwing) aggregate fit ⇒ A is superseded and NO fallback camera call happens.
      assert.equal(expected.aOutcome.superseded, true, 'invalidated during fit ⇒ superseded');
      assert.equal(expected.aOutcome.fitted, false);
      assert.equal(h.fitCalls().length, expected.fitCallCount, 'no further (fallback) camera call for a stale token');
    }
    const panel = h.panelMeshes();
    if (expected.meshes === 'B') {
      assert.equal(panel.length, MESHES_PER_PRESENT);
      assert.ok(panel.every((m) => !w.aMeshes.includes(m)), 'only the newest token\'s meshes remain');
    } else {
      assert.deepEqual(panel, [], 'no Panel-owned mesh remains');
    }
    const want = expected.isolation === 'B' ? targetFor(B.sides) : expected.isolation === 'foreign' ? F : prior;
    assert.ok(sameIsolation(h.isolation(), want), `isolation expected ${expected.isolation}`);
    assert.deepEqual(h.foreignMeshes(), [foreignMesh], 'foreign mesh untouched');
    if (c.priorNonEmpty) {
      assert.ok(h.callsOf('setAggregateIsolation').every((e) => e.args[0].length > 0), 'no clear-all when prior is non-empty');
    }
    h.assertNoTheming();
    // The queue is not wedged: a final clear resolves and leaves nothing Panel-owned.
    const final = await bridge.clear();
    if (expected.disposed) assert.equal(final.disposed, true);
    assert.deepEqual(h.panelMeshes(), []);
    const settled = expected.isolation === 'foreign' ? F : prior;
    assert.ok(sameIsolation(h.isolation(), settled), 'after the final clear: prior (or the foreign state) only');
    assert.equal(h.pendingFaults(), 0, 'the injected fault was exercised');
    h.assertNoTheming();
  });
}

for (const name of Object.keys(INTERLEAVINGS)) {
  test(`AC-P16 prerequisite unmet (hidden nodes) · ${name}: no setAggregateIsolation of any kind, Isolate unavailable`, async () => {
    const w = world({ priorNonEmpty: false, hidden: [] });
    w.h.viewer.setHiddenNodes([{ model: w.h.models[0], ids: [5] }]);
    assert.deepEqual(isolationPrerequisite(w.h.api), { available: false, reason: 'Some elements are hidden — show all to enable isolation' });
    await INTERLEAVINGS[name](w, STEPS.fit, 'before', 'fit');
    await w.bridge.clear();
    assert.deepEqual(w.h.callsOf('setAggregateIsolation'), []);
    assert.deepEqual(w.h.panelMeshes(), []);
    w.h.assertNoTheming();
  });
}
