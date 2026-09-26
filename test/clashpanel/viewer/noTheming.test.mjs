// test/clashpanel/viewer/noTheming.test.mjs — AC-P19 runtime negative controls (Tier B; the static ban is T1).
// The fake ViewerApi records AND throws on any member whose name contains "theming"; foreign theming
// state seeded in the fake must be unchanged after every present/clear/dispose path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createViewerBridge } from '../../../clashpanel/viewer/ViewerBridge.js';
import { createBridgeHarness, NAMES } from '../support/viewerFaults.mjs';
import { createFakeThree } from '../support/fakeThree.mjs';

const ON = { focus: true, isolate: true, marker: true };
const VIEWER_DIR = new URL('../../../clashpanel/viewer/', import.meta.url);

function setup(factory = createViewerBridge) {
  const h = createBridgeHarness();
  const [m1, m2] = h.models;
  const bridge = factory({ viewerApi: h.api, THREE: createFakeThree().THREE, names: NAMES });
  const req = (dbId) => ({ sides: [{ model: m1, dbId }, { model: m2, dbId: dbId + 1 }], point: [0, 0, 0], options: ON });
  return { h, bridge, req, m1 };
}

// Loads a COPY of ViewerBridge.js with one extra line injected after `anchor` (imports re-pointed at
// the real sibling modules); the copy lives in the OS temp dir, never in the repo.
async function mutantBridge(anchor, injected) {
  const src = await readFile(new URL('ViewerBridge.js', VIEWER_DIR), 'utf8');
  assert.ok(src.includes(anchor), `anchor present: ${anchor}`);
  const rewritten = src
    .replace(/from '\.\/([A-Za-z]+\.js)'/g, (_m, f) => `from '${new URL(f, VIEWER_DIR).href}'`)
    .replace(anchor, `${anchor}\n${injected}`);
  const dir = await mkdtemp(join(tmpdir(), 'clashpanel-mutant-'));
  const file = join(dir, 'ViewerBridge.mutant.mjs');
  await writeFile(file, rewritten);
  const mod = await import(pathToFileURL(file).href);
  return { mod, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('no theming member is touched on any present/clear/dispose path or interleaving; foreign theming unchanged', async () => {
  const { h, bridge, req, m1 } = setup();
  await bridge.present(req(1));                          h.assertNoTheming();
  await bridge.present(req(3));                          h.assertNoTheming();   // change selection
  await bridge.clear();                                  h.assertNoTheming();   // back to all / new run / hide
  const racing = [bridge.present(req(1)), bridge.present(req(3)), bridge.clear(), bridge.present(req(5))];
  await Promise.all(racing);                             h.assertNoTheming();
  h.failAt('setAggregateIsolation', 'after');
  await bridge.present(req(7));                          h.assertNoTheming();   // ambiguous rollback
  h.viewer.dispatch(h.api.eventNames.MODEL_REMOVED, { model: m1 });
  await bridge.clear();                                  h.assertNoTheming();   // model left
  await bridge.present(req(9));
  await bridge.dispose();                                h.assertNoTheming();   // dispose
  await bridge.present(req(1));                          h.assertNoTheming();   // after dispose
  assert.deepEqual(h.viewer.themingCalls, []);
  assert.deepEqual(h.viewer.forbiddenCalls, [], 'no selection / visibility / impl call either');
});

test('negative control: a bridge that calls setThemingColor in present IS caught by the harness', async () => {
  const { mod, cleanup } = await mutantBridge('async function runPresent(t, req) {', '    viewerApi.setThemingColor(req.sides[0].dbId, null, req.sides[0].model);');
  try {
    const { h, bridge, req } = setup(mod.createViewerBridge);
    const o = await bridge.present(req(1));
    assert.equal(o.marked, false, 'the forbidden call aborted the presentation');
    assert.deepEqual(h.viewer.themingCalls.map((c) => c.name), ['setThemingColor']);
    assert.throws(() => h.assertNoTheming(), /theming member called: setThemingColor/);
  } finally {
    await cleanup();
  }
});

test('negative control: a bridge that calls clearThemingColors in clear IS caught by the harness', async () => {
  const { mod, cleanup } = await mutantBridge('  function releaseHeld() {', '    try { viewerApi.clearThemingColors(); } catch { /* swallowed on purpose: the record must still catch it */ }');
  try {
    const { h, bridge, req } = setup(mod.createViewerBridge);
    await bridge.present(req(1));
    assert.deepEqual(h.viewer.themingCalls, []);
    await bridge.clear();
    assert.deepEqual(h.viewer.themingCalls.map((c) => c.name), ['clearThemingColors']);
    assert.throws(() => h.assertNoTheming(), /clearThemingColors/);
  } finally {
    await cleanup();
  }
});

test('the harness routes every theming member of the ViewerApi to the T3 recording throw (incl. unknown *Theming* names)', () => {
  const { h } = setup();
  assert.throws(() => h.api.getThemingColor(1), /theming forbidden/);
  assert.throws(() => h.api.setThemingColorsForAll(), /theming forbidden/);
  assert.deepEqual(h.viewer.themingCalls.map((c) => c.name), ['getThemingColor', 'setThemingColorsForAll']);
  assert.throws(() => h.assertNoTheming(), /theming member called/);
});
