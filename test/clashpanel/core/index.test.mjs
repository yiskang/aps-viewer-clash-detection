// test/clashpanel/core/index.test.mjs — Task 19: the core barrel and the AC-P1 control → Core-field mapping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../../../clashpanel/core/index.js';
import * as constants from '../../../clashpanel/core/constants.js';
import { INTENT } from '../../../clashpanel/core/intents.js';
import { makeHarness } from '../support/controllerHarness.mjs';

test('the barrel exports exactly the core surface and no presentation constant (AC-P11)', () => {
  assert.deepEqual(Object.keys(core).sort(), ['INTENT', 'buildViewModel', 'createDefaultScheduler', 'createPanelController']);
  for (const name of Object.keys(constants)) assert.equal(name in core, false, `${name} must not be re-exported`);
  assert.ok(Object.isFrozen(core.INTENT));
});

const DEFINITION_KEYS = new Set(['schemaVersion', 'testId', 'revision', 'name', 'description', 'selectionA', 'selectionB', 'mode', 'clearance']);

/** AC-P1 table: each §6.1 control, the intent that sets it, and the Core definition field it must (only) reach. */
const CONTROL_MAP = [
  { control: 'Test name', intents: [{ type: INTENT.SETUP_NAME, value: 'Walls vs beams' }], check: (d) => assert.equal(d.name, 'Walls vs beams') },
  { control: 'Mode Hard (default)', intents: [], check: (d) => { assert.equal(d.mode, 'volume-overlap'); assert.equal('clearance' in d, false); } },
  { control: 'Mode Soft + Clearance', intents: [{ type: INTENT.SETUP_MODE, value: 'soft' }, { type: INTENT.SETUP_CLEARANCE, value: '0.25' }], check: (d) => { assert.equal(d.mode, 'clearance'); assert.equal(d.clearance, 0.25); } },
  { control: 'Set A / Set B models', intents: [], check: (d) => { assert.deepEqual(d.selectionA, { entries: [{ kind: 'model', modelKey: 'mA' }] }); assert.deepEqual(d.selectionB, { entries: [{ kind: 'model', modelKey: 'mB' }] }); } },
  { control: 'Use current selection', intents: [{ type: INTENT.SETUP_TOGGLE_MODEL, side: 'A', modelKey: 'mA' }, { type: INTENT.SETUP_USE_SELECTION, side: 'A' }], check: (d) => assert.deepEqual(d.selectionA, { entries: [{ kind: 'elements', modelKey: 'mA', dbIds: [4, 7] }] }) },
  { control: 'Self-clash', intents: [{ type: INTENT.SETUP_SELF_CLASH, value: true }], check: (d) => { assert.deepEqual(d.selectionB, d.selectionA); assert.notEqual(d.selectionB, d.selectionA); } },
  { control: 'Test identity', intents: [], check: (d) => { assert.equal(d.schemaVersion, 1); assert.equal(d.testId, 'test-1'); assert.equal(d.revision, 1); } },
  { control: 'Group by / sort / filters (post-run only)', intents: [{ type: INTENT.GROUP_MODE, value: 'element' }, { type: INTENT.SORT_SET, value: 'group-count' }], check: (d) => { assert.equal('groupBy' in d, false); assert.equal('sort' in d, false); } },
];

for (const row of CONTROL_MAP) {
  test(`AC-P1: "${row.control}" maps to a Core definition field only; no definition or run option is invented`, async () => {
    const h = makeHarness();
    h.bridge.setSelection([{ model: h.modelA, dbIds: [7, 4] }]);
    await h.readyHard();                                                     // mA → Set A, mB → Set B
    for (const intent of row.intents) await h.dispatch(intent);
    await h.dispatch({ type: INTENT.RUN_START });
    assert.equal(h.engine.startCalls.length, 1, 'the run was admitted');
    const { definition, runOptions } = h.engine.startCalls[0];
    assert.equal(runOptions, undefined);                                     // v1 exposes no run options
    for (const key of Object.keys(definition)) assert.ok(DEFINITION_KEYS.has(key), `invented definition key ${key}`);
    row.check(definition);
  });
}
