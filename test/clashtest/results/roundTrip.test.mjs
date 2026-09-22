// test/clashtest/results/roundTrip.test.mjs
//
// Task P5.9: the phase's own acceptance harness -- the FINAL P5 task, proving that everything
// P5.1-P5.8 built actually works together end to end. `sealFakeRun(kind)` (extended into
// `resultSetFixtures.mjs` by this task) drives the real pipeline -- `createResultAccumulator` over
// fake `UnitOutcome`s (P5.1) -> `deriveRunOutcome` (P5.2) -> `buildResultSet`/`sealResultSet`
// (P5.3) -- for all five terminal shapes. This file then proves produce -> persist -> evict -> read
// -> validate preserves the exact same no-clash claim outcome (P5.2's `claim.js`, via P5.7's store
// and P5.8's residency manager, then P5.4/P5.5's `readResultSet`/`validateResultSet`).
//
// Test code per the task brief (.superpowers/sdd/p5-result-set/task-P5.9-brief.md, Task P5.9
// Step 1), with ONE deviation: the brief's own literal
// `assert.equal(JSON.stringify(read.results), JSON.stringify(sealed.results), kind)` is replaced
// below with `assert.deepStrictEqual(read.results, sealed.results, kind)`. Verified (codex-advisor,
// 2026-09-22) that the literal form fails unconditionally for any non-empty `results[]`: the store
// persists `canonicalJson(resultSet)` (`util/canonical.js`), whose object keys are sorted by
// UTF-16 code-unit order, and `readResultSet`/`captureData` (`util/capture.js`) deliberately
// PRESERVE whatever key order the input already has rather than restoring the producer's own
// insertion order (`resultId, pair, mode, evaluatedAs, evidence, flags, unitId`, per
// `projectUnitPairs`) -- so `JSON.stringify` on the read-back copy and on the freshly-sealed
// original differ in key order alone. This is the store's documented canonical-JSON persistence
// mechanism (spec erratum A6; `p5-result-set.md`'s own "Listings are untrusted data too" framing),
// not a defect this task's fixtures introduced -- `deepStrictEqual` asserts the same
// content-preservation property the brief intended, without being sensitive to that reordering.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { createResidencyManager } from '../../../clashtest/results/residency.js';
import { readResultSet, validateResultSet } from '../../../clashtest/results/validateResultSet.js';
import { assessNoClashClaim, canClaimNoClashes } from '../../../clashtest/results/claim.js';
import { ENGINE_LIMIT_DEFAULTS } from '../../../clashtest/options.js';
import { sealFakeRun, fakeSlicer } from '../support/resultSetFixtures.mjs';

const KINDS = ['completed-clean', 'completed-with-gaps', 'cancelled-pre-resolution', 'failed', 'invalidated'];
const limits = ENGINE_LIMIT_DEFAULTS;

test('put → evict → read → validate preserves the claim outcome for every terminal shape', async () => {
  for (const kind of KINDS) {
    const store = createInMemoryResultStore();
    const m = createResidencyManager({ limits: { ...limits, maxResidentResultSets: 1 }, resultStore: store,
      now: () => 1, onPersistence: () => {} });
    const sealed = await sealFakeRun(kind);
    m.reserveRunSlot(sealed.runId);
    m.admitSealedSet(sealed.runId, sealed);
    assert.equal((await m.beginPersist(sealed.runId, { persist: true })).state, 'saved', kind);
    const before = assessNoClashClaim(sealed, 'current');

    m.releaseResultSet(sealed.runId, {});                              // evict the saved copy
    assert.equal(m.getResident(sealed.runId), null, kind);

    const raw = await store.get(sealed.runId, { maxBytes: limits.maxStoredResultBytes });
    const read = await readResultSet(raw, { limits, slicer: fakeSlicer() });
    assert.deepEqual(validateResultSet(read, { limits }), { ok: true, issues: [] }, kind);
    assert.deepEqual(assessNoClashClaim(read, 'current'), before, kind);
    assert.equal(canClaimNoClashes(read, 'current'), canClaimNoClashes(sealed, 'current'), kind);
    assert.deepEqual(read.digests, sealed.digests, kind);
    assert.equal(Object.isFrozen(read), true, kind);
    assert.deepStrictEqual(read.results, sealed.results, kind);
  }
});

test('only the clean completed shape can ever claim', async () => {
  for (const kind of KINDS) {
    const sealed = await sealFakeRun(kind);
    assert.equal(canClaimNoClashes(sealed, 'current'), kind === 'completed-clean', kind);
  }
});

test('a deep scan of every sealed shape finds no forbidden value', async () => {
  for (const kind of KINDS) {
    const stack = [await sealFakeRun(kind)];
    while (stack.length) {
      const v = stack.pop();
      if (v === null) continue;
      if (typeof v === 'number') { assert.ok(Number.isFinite(v), kind); continue; }
      if (typeof v === 'function' || v instanceof Map || v instanceof Set) assert.fail(`${kind}: forbidden value`);
      if (typeof v !== 'object') continue;
      for (const k of Object.keys(v)) { assert.notEqual(v[k], undefined, `${kind}.${k}`); stack.push(v[k]); }
    }
  }
});

test('a forged set with recomputed digests is still rejected on its semantics', async () => {
  const sealed = await sealFakeRun('completed-clean');
  const forged = structuredClone(sealed);
  forged.ledger.units[0].outcome = 'failed';                            // coverage still says full
  await assert.rejects(readResultSet(forged, { limits, slicer: fakeSlicer() }),
    (e) => e.name === 'CorruptResultSetError' && e.issues.some((i) => i.code === 'coverage-not-full'));
});
