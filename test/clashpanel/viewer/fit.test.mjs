// test/clashpanel/viewer/fit.test.mjs — T26 (Tier B; fakes only — aggregate union framing is gate G2).
// Runs over the T3 ViewerApi double, whose fitToViewAggregate calls viewer.fitToView(list, undefined, immediate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitSides, FIT_NOTE } from '../../../clashpanel/viewer/fit.js';
import { createBridgeHarness } from '../support/viewerFaults.mjs';

const fits = (h) => h.viewer.calls.fitToView.map((c) => [c.form, ...c.args]);

test('one live side ⇒ public per-model fitToView([dbId], model)', () => {
  const h = createBridgeHarness();
  const [m1] = h.models;
  assert.deepEqual(fitSides(h.api, [{ model: m1, dbId: 7 }]), { fitted: true, notes: [] });
  assert.deepEqual(fits(h), [['ids', [7], m1, undefined]]);
});

test('two sides in ONE model ⇒ one per-model call with both ids (no aggregate form needed)', () => {
  const h = createBridgeHarness();
  const [m1] = h.models;
  assert.deepEqual(fitSides(h.api, [{ model: m1, dbId: 9 }, { model: m1, dbId: 2 }]), { fitted: true, notes: [] });
  assert.deepEqual(fits(h), [['ids', [2, 9], m1, undefined]]);
});

test('two models ⇒ ONE aggregate fit keyed `selection` (never `ids`), list in the first slot, model slot unused', () => {
  const h = createBridgeHarness();
  const [m1, m2] = h.models;
  assert.deepEqual(fitSides(h.api, [{ model: m1, dbId: 1 }, { model: m2, dbId: 2 }]), { fitted: true, notes: [] });
  const [[form, list, modelSlot]] = fits(h);
  assert.equal(form, 'aggregate');
  assert.deepEqual(list, [{ model: m1, selection: [1] }, { model: m2, selection: [2] }]);
  assert.equal(modelSlot, undefined);
  assert.ok(list.every((e) => !('ids' in e)));
});

test('the fake is faithful: an aggregate entry keyed `ids` throws TypeError', () => {
  const h = createBridgeHarness();
  assert.throws(() => h.api.fitToViewAggregate([{ model: h.models[0], ids: [1] }]), TypeError);
});

test('no aggregate support ⇒ fit the first live side + "Framing first element only"', () => {
  const h = createBridgeHarness();
  h.viewer.aggregateFit = false;
  const [m1, m2] = h.models;
  assert.deepEqual(fitSides(h.api, [{ model: m1, dbId: 1 }, { model: m2, dbId: 2 }]), { fitted: true, notes: [FIT_NOTE.FIRST_ONLY] });
  assert.equal(FIT_NOTE.FIRST_ONLY, 'Framing first element only');
  assert.deepEqual(fits(h), [['ids', [1], m1, undefined]]);
});

test('aggregate fit throws ⇒ caught, fallback to the first side with the note', () => {
  const h = createBridgeHarness();
  const [m1, m2] = h.models;
  h.viewer.failNext('fitToView');                       // the first fit call is the aggregate one
  assert.deepEqual(fitSides(h.api, [{ model: m1, dbId: 1 }, { model: m2, dbId: 2 }]), { fitted: true, notes: [FIT_NOTE.FIRST_ONLY] });
  assert.deepEqual(fits(h).map((c) => c[0]), ['aggregate', 'ids']);
});

test('every fit failure only adds a note — fitSides never throws', () => {
  const h = createBridgeHarness();
  const [m1, m2] = h.models;
  h.viewer.failNext('fitToView', { afterEffect: true });
  h.viewer.failNext('fitToView');
  assert.deepEqual(fitSides(h.api, [{ model: m1, dbId: 1 }, { model: m2, dbId: 2 }]), { fitted: false, notes: [FIT_NOTE.FIRST_ONLY, FIT_NOTE.FAILED] });
  h.viewer.failNext('fitToView', { afterEffect: true });
  assert.deepEqual(fitSides(h.api, [{ model: m1, dbId: 1 }]), { fitted: false, notes: [FIT_NOTE.FAILED] });
  assert.deepEqual(fitSides(h.api, []), { fitted: false, notes: [] });
  const broken = { ...h.api, hasAggregateFit: () => { throw new Error('probe'); } };
  assert.deepEqual(fitSides(broken, [{ model: m1, dbId: 1 }, { model: m2, dbId: 2 }]).notes, [FIT_NOTE.FIRST_ONLY]);
});

test('isCurrent is re-checked immediately before EVERY camera call: stale ⇒ no call (not even the fallback), superseded', () => {
  const h = createBridgeHarness();
  const [m1, m2] = h.models;
  let live = true;
  h.viewer.failNext('fitToView');                                    // the aggregate call throws …
  h.viewer.onCall('fitToView', () => { live = false; });            // … after the token was invalidated inside it
  assert.deepEqual(fitSides(h.api, [{ model: m1, dbId: 1 }, { model: m2, dbId: 2 }], () => live),
    { fitted: false, notes: [FIT_NOTE.FIRST_ONLY], superseded: true });
  assert.deepEqual(fits(h).map((c) => c[0]), ['aggregate'], 'zero fallback camera calls');
  assert.deepEqual(fitSides(h.api, [{ model: m1, dbId: 1 }], () => false), { fitted: false, notes: [], superseded: true });
  assert.deepEqual(fitSides(h.api, [{ model: m1, dbId: 1 }, { model: m2, dbId: 2 }], () => false), { fitted: false, notes: [], superseded: true });
  assert.equal(fits(h).length, 1, 'a stale token never moves the camera');
});
