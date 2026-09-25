// test/clashtest/results/validateResultSet.slicing.test.mjs
//
// P5-REM5 item 5 (owner ruling 2026-09-23: "Treat frozen spec §17.3 as governing. Long validation
// loops in the sliced validateResultSet path must checkpoint at the required bounded granularity
// rather than only once per phase. Keep this limited to P5 validator slicing"). §17.3: a slice
// "checks the injected `now` at least every 64 items". P0's slicer counts one item per `tick()` and
// checks the clock every 64 ticks, and `readResultSet` ticks once per generator step -- so the
// generator must yield once per item of every size-dependent validation loop. Before this fix it
// yielded exactly 5 times in total (once per phase), whatever the input size.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateResultSetSteps, validateResultSet, readResultSet, digestCanonicalSteps } from '../../../clashtest/results/validateResultSet.js';
import { digestCanonical } from '../../../clashtest/util/canonical.js';
import { createSlicer } from '../../../clashtest/util/slicer.js';
import { ENGINE_LIMIT_DEFAULTS } from '../../../clashtest/options.js';
import { widePlan } from '../support/resultSetFixtures.mjs';

const limits = ENGINE_LIMIT_DEFAULTS;
const UNITS = 1000;                        // widePlan: 1,000 leaf units, 50 results, all valid

function drain(set) {
  const labels = [];
  const it = validateResultSetSteps(set, { limits });
  let step = it.next();
  while (!step.done) { labels.push(step.value); step = it.next(); }
  return { labels, result: step.value };
}

test('the sliced validator yields many times WITHIN every phase once the input is large enough', async () => {
  const set = await widePlan(UNITS);
  const { labels, result } = drain(set);
  assert.deepEqual(result, { ok: true, issues: [] });
  assert.deepEqual(result, validateResultSet(set, { limits }), 'the sync drain agrees with the sliced form');
  const perPhase = new Map();
  for (const l of labels) {
    assert.equal(typeof l, 'string', 'every step carries a label');
    const phase = l.split(':')[1];
    perPhase.set(phase, (perPhase.get(phase) ?? 0) + 1);
  }
  // Every phase iterates the 1,000 units and/or 50 results item by item, so each yields far more
  // than once -- not the single per-phase yield this replaced.
  assert.ok(perPhase.get('shape') > UNITS, `shape: ${perPhase.get('shape')}`);
  assert.ok(perPhase.get('cross-field') > UNITS, `cross-field: ${perPhase.get('cross-field')}`);
  assert.ok(perPhase.get('linkage') > UNITS, `linkage: ${perPhase.get('linkage')}`);
  assert.ok(perPhase.get('order') >= 49, `order: ${perPhase.get('order')}`);
  assert.ok(perPhase.get('digest') > UNITS, `digest: ${perPhase.get('digest')}`);
  assert.ok(labels.length > 5 * UNITS, `total steps ${labels.length}`);
});

test('readResultSet actually yields to the scheduler mid-validation through the real P0 slicer', async () => {
  const set = JSON.parse(JSON.stringify(await widePlan(UNITS)));
  let clock = 0;
  const validateYields = [];
  const slicer = createSlicer({
    now: () => (clock += 1),                               // 1 "ms" per clock read: a check every 64 items is always due
    yieldToScheduler: () => undefined,
    limits,
    spanRecorder: (label) => { if (label.startsWith('validate')) validateYields.push(label); },
  });
  const read = await readResultSet(set, { limits, slicer });
  assert.equal(read.ledger.units.length, UNITS);
  // Pre-fix there were only 5 `validate` ticks in total, so a 64-tick clock check could never even
  // run during validation; now every ~64 items is a checkpoint and each one here is due.
  assert.ok(validateYields.length > 50, `validation yielded ${validateYields.length} times`);
  assert.ok(new Set(validateYields).size >= 4, `yields spread across phases: ${[...new Set(validateYields)]}`);
});

test('the streamed digest is byte-identical to P0 digestCanonical, including key order and number/string edge cases', () => {
  const tricky = {
    b: [1, -0, 1e21, 0.1, 'x y', '\ud800', { z: null, 10: true, 2: false, 'é': 'ü', A: [] }],
    a: { '': 'empty', long: 'q'.repeat(20000) },
    arr: Array.from({ length: 3000 }, (_, i) => [i, `r${i}`, { flags: i % 2 === 0 ? ['witnessUnavailable'] : [] }]),
  };
  const drainDigest = (steps) => { let r = steps.next(); while (!r.done) r = steps.next(); return r.value; };
  assert.equal(drainDigest(digestCanonicalSteps(tricky)), digestCanonical(tricky));
  // `expand`: a sentinel array serialised as `source.map(project)` without materialising it.
  const sentinel = [];
  const source = [{ v: 1 }, { v: 2 }, { v: 3 }];
  const project = (o) => ({ w: o.v * 2 });
  assert.equal(drainDigest(digestCanonicalSteps({ list: sentinel, k: 1 }, new Map([[sentinel, { source, project }]]))),
    digestCanonical({ list: source.map(project), k: 1 }));
});

// codex-review (P5-REM5, resultSetSchema.js): a WIDE open-type unknown field (legal within the 64 KiB
// budget) used to be enumerated child-by-child in ONE step; now each child is a step when enqueued
// and again when visited.
test('a wide open-type unknown field is walked one child per step', async () => {
  const base = await widePlan(10);
  const wide = structuredClone(base);
  wide.ledger.futureField = Array.from({ length: 1000 }, (_, i) => i);
  const shapeSteps = (set) => drain(set).labels.filter((l) => l === 'validate:shape').length;
  assert.ok(shapeSteps(wide) - shapeSteps(base) >= 2000, `${shapeSteps(wide) - shapeSteps(base)} extra steps`);
});

test('issue order and content are unchanged by slicing (sync drain == sliced read)', async () => {
  const set = await widePlan(50);
  const broken = structuredClone(set);
  broken.results.reverse();
  broken.ledger.units[3].sourceRootDbIds = [];
  const { result } = drain(broken);
  assert.deepEqual(result, validateResultSet(broken, { limits }));
  assert.equal(result.ok, false);
});
