// test/clashtest/results/resultSet.seal.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResultSet, sealResultSet, ledgerDigestInput, projectUnitPairs }
  from '../../../clashtest/results/resultSet.js';
import { digestCanonical } from '../../../clashtest/util/canonical.js';
import { isDeepFrozen } from '../../../clashtest/util/capture.js';
import { fakeSlicer, runParts } from '../support/resultSetFixtures.mjs';

test('a sealed set is frozen all the way down and JSON round-trips with semantic equality', async () => {
  const set = await sealResultSet(buildResultSet(runParts()), { slicer: fakeSlicer() });
  assert.equal(set.sealed, true);
  assert.equal(Object.isFrozen(set), true);
  assert.equal(Object.isFrozen(set.ledger.units[0]), true);
  assert.equal(Object.isFrozen(set.results), true);
  assert.throws(() => { 'use strict'; set.outcome.coverage = 'full'; }, TypeError);
  assert.deepEqual(JSON.parse(JSON.stringify(set)), structuredClone(set));
});

test('pre-resolution seal has null definition, null digest fields and a planning gap only', async () => {
  const set = await sealResultSet(buildResultSet(runParts('cancelled-pre-resolution')), { slicer: fakeSlicer() });
  assert.equal(set.definition, null);
  assert.deepEqual(set.testRef, { testId: 'T1', revision: null, semanticDigest: null });
  assert.deepEqual(set.ledger.units, []);
  assert.equal(set.ledger.pairSpaceTotal, 0);
  assert.equal(set.outcome.coverage, 'partial');
  assert.ok(set.outcome.reasons.includes('planning:cancelled'));
});

test('ledgerDigest excludes timings, attempts, secondaryCauses and the admission baseline', () => {
  const parts = runParts();
  const a = ledgerDigestInput(parts.ledger, parts.runOptions);
  parts.ledger.units[0].attempts = 7;
  parts.ledger.units[0].durationMs = 999;
  // §16.7: "secondary causes are diagnostic and EXCLUDED from ledgerDigest" — which of them a
  // real timing race exposes varies, while the primary cause is a function of the recorded facts.
  parts.ledger.units[0].secondaryCauses = ['model-evicted', 'scope-unverifiable'];
  assert.deepEqual(ledgerDigestInput(parts.ledger, parts.runOptions), a);
  assert.equal(JSON.stringify(a).includes('secondaryCauses'), false);
});

test('two settlements differing ONLY in observed secondary causes seal to the same ledgerDigest', async () => {
  // AC-21: the same facts in different callback orders must not change the digest.
  const PERMUTATIONS = [[], ['model-evicted'], ['model-evicted', 'scope-unverifiable'],
    ['scope-unverifiable', 'model-evicted'], ['cancel-requested', 'model-evicted', 'stale-placement']];
  const digests = new Set();
  for (const secondaryCauses of PERMUTATIONS) {
    const parts = runParts();
    parts.ledger.units[0] = { ...parts.ledger.units[0], cause: 'capacity-exceeded', secondaryCauses };
    const sealed = await sealResultSet(buildResultSet(parts), { slicer: fakeSlicer() });
    digests.add(sealed.digests.ledgerDigest);
    assert.deepEqual(sealed.ledger.units[0].secondaryCauses, secondaryCauses);   // still RECORDED, just not digested
  }
  assert.equal(digests.size, 1);
});

test('the per-root cls marker IS digested (R2: it is schema, not decoration)', async () => {
  const parts = runParts();
  const a = await sealResultSet(buildResultSet(parts), { slicer: fakeSlicer() });
  const moved = runParts();
  moved.ledger.rootOwners[0].owners[0].cls = 'C';                 // was 'A'
  const b = await sealResultSet(buildResultSet(moved), { slicer: fakeSlicer() });
  assert.notEqual(a.digests.ledgerDigest, b.digests.ledgerDigest);
  assert.equal(a.digests.pairSetDigest, b.digests.pairSetDigest);   // spec A9: pairSetDigest is (resultId, flags) only — `cls` must not reach it
  assert.equal(JSON.stringify(ledgerDigestInput(moved.ledger, moved.runOptions)).includes('"cls"'), true);
});

test('a set is sealed exactly once — resealing is a programmer error, not a spec error', async () => {
  const sealed = await sealResultSet(buildResultSet(runParts()), { slicer: fakeSlicer() });
  await assert.rejects(sealResultSet(sealed, { slicer: fakeSlicer() }),
    (e) => e instanceof TypeError && e.code === 'ERR_RESULT_SET_NOT_DRAFT');
  // a draft that already carries digests is equally refused (a half-sealed object is never completed)
  const halfSealed = { ...buildResultSet(runParts()), digests: { digestVersion: 1, pairSetDigest: 'sha256:x', ledgerDigest: 'sha256:y' } };
  await assert.rejects(sealResultSet(halfSealed, { slicer: fakeSlicer() }),
    (e) => e instanceof TypeError && e.code === 'ERR_RESULT_SET_NOT_DRAFT');
  for (const bad of [null, undefined, 'set', { sealed: true, digests: null }]) {
    await assert.rejects(sealResultSet(bad, { slicer: fakeSlicer() }),
      (e) => e instanceof TypeError && e.code === 'ERR_RESULT_SET_NOT_DRAFT', String(bad));
  }
  assert.equal(Object.isFrozen(sealed), true);                    // the original is untouched
});

test('digests change with discrete content and are stable under key order', async () => {
  const a = await sealResultSet(buildResultSet(runParts()), { slicer: fakeSlicer() });
  const reordered = runParts();
  reordered.ledger = { units: reordered.ledger.units, ...reordered.ledger };
  const b = await sealResultSet(buildResultSet(reordered), { slicer: fakeSlicer() });
  assert.equal(a.digests.ledgerDigest, b.digests.ledgerDigest);
  assert.equal(a.digests.pairSetDigest, b.digests.pairSetDigest);
  const changed = runParts();
  changed.results[0].flags = { witnessUnavailable: true };
  const c = await sealResultSet(buildResultSet(changed), { slicer: fakeSlicer() });
  assert.notEqual(a.digests.pairSetDigest, c.digests.pairSetDigest);
  assert.equal(a.digests.digestVersion, 1);
});

test('the freeze is sliced, not recursive: a 40-deep, 50k-node set seals without stack overflow', async () => {
  const slicer = fakeSlicer();
  const set = await sealResultSet(buildResultSet(runParts('wide')), { slicer });
  assert.equal(Object.isFrozen(set), true);
  assert.ok(slicer.ticks > 1, 'freeze ticked more than once');
  assert.ok(slicer.yields >= 1, 'and yielded at least once');
});

// ---- codex-advisor remediation (2026-09-22): field shape alone cannot tell a fresh draft from a
// reused one, and a race between digesting and a sliced (yielding) freeze could desynchronize the
// recorded digest from the sealed content. The tests above only ever reseal the OUTPUT of a prior
// seal or a hand-built half-sealed object -- never the identical, still `sealed:false` draft. These
// close that gap.

test('resealing the identical draft object a second time is rejected by identity, not just field shape', async () => {
  const draft = buildResultSet(runParts());
  const first = await sealResultSet(draft, { slicer: fakeSlicer() });
  assert.equal(first.sealed, true);
  // `draft` itself is untouched (sealResultSet never mutates it): still {sealed:false, digests:null}.
  assert.equal(draft.sealed, false);
  assert.equal(draft.digests, null);
  await assert.rejects(sealResultSet(draft, { slicer: fakeSlicer() }),
    (e) => e instanceof TypeError && e.code === 'ERR_RESULT_SET_NOT_DRAFT');
});

test('two concurrent seals of the identical draft: exactly one succeeds, the other is rejected', async () => {
  const draft = buildResultSet(runParts());
  const outcomes = await Promise.allSettled([
    sealResultSet(draft, { slicer: fakeSlicer() }),
    sealResultSet(draft, { slicer: fakeSlicer() }),
  ]);
  const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
  const rejected = outcomes.filter((o) => o.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one concurrent seal of the same draft wins');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'ERR_RESULT_SET_NOT_DRAFT');
});

test('a slicer that rejects mid-freeze leaves the draft permanently unusable, not silently reusable', async () => {
  const draft = buildResultSet(runParts('wide'));
  const boom = new Error('slicer failure');
  let ticks = 0;
  const failingSlicer = { tick() { ticks += 1; return ticks === 5 ? Promise.reject(boom) : undefined; } };
  await assert.rejects(sealResultSet(draft, { slicer: failingSlicer }), (e) => e === boom);
  // The draft was claimed before the failure; a working slicer on a second attempt still refuses it,
  // because a draft that started sealing and did not finish may be partially frozen.
  await assert.rejects(sealResultSet(draft, { slicer: fakeSlicer() }),
    (e) => e instanceof TypeError && e.code === 'ERR_RESULT_SET_NOT_DRAFT');
});

test('a mutation racing the sliced freeze cannot desynchronize the sealed digest from the sealed content', async () => {
  // `runParts('wide')`'s 2,000 results dominate the freeze's stack order, so `ledger` (and its small
  // `exclusions` array) is not reached -- and so not yet frozen -- for many ticks; the race below
  // lands on it deterministically at the first yield, well before `ledger` is visited.
  const draft = buildResultSet(runParts('wide'));
  const inner = fakeSlicer();
  let raced = false;
  const slicer = {
    tick(label) {
      const pending = inner.tick(label);
      if (pending && !raced) {
        raced = true;
        draft.ledger.exclusions.push('raced-in'); // still unfrozen this early in the 'wide' traversal
      }
      return pending;
    },
    get ticks() { return inner.ticks; },
    get yields() { return inner.yields; },
  };
  const sealed = await sealResultSet(draft, { slicer });
  assert.ok(slicer.yields >= 1, 'the race actually had a yield to land in');
  assert.ok(sealed.ledger.exclusions.includes('raced-in'), 'sanity: the race landed before that node froze');
  const recomputed = digestCanonical(ledgerDigestInput(sealed.ledger, sealed.provenance.runOptions));
  assert.equal(sealed.digests.ledgerDigest, recomputed,
    'the recorded digest must match sealed.ledger exactly, whatever the raced mutation did');
});

test('a pre-frozen ElementRef leaf (P1\'s own frozen output) does not defeat the deep freeze', async () => {
  // P0's deepFreezeSliced skips descending into an ALREADY-frozen node (codex-advisor finding,
  // 2026-09-22): safe only when that node's own children are themselves already frozen (or, as
  // here, primitives) -- which is exactly what P1's makeElementRef/makePairId guarantee. This is
  // the one place a pre-frozen object currently, genuinely reaches buildResultSet's input.
  const unitOutcome = { unitId: 'u1', pairs: [{
    source: { modelKey: 'urn:model-a', dbId: 10 }, target: { modelKey: 'urn:model-b', dbId: 20 },
    type: 'volume-overlap', witness: { kind: 'vertex', point: [0, 0, 0] },
  }] };
  const ctx = { mode: 'volume-overlap', testId: 'T1', semanticDigest: `sha256:${'a'.repeat(64)}`,
    unreachableOwners: new Map(), mixedOwners: new Map(), unitPlanRank: new Map([['u1', 0]]) };
  const [result] = projectUnitPairs(unitOutcome, ctx);
  assert.ok(Object.isFrozen(result.pair.first), "sanity: P1's ElementRef is already frozen before it reaches P5");
  const parts = runParts();
  parts.results = [result];
  const sealed = await sealResultSet(buildResultSet(parts), { slicer: fakeSlicer() });
  assert.ok(isDeepFrozen(sealed), 'a pre-frozen leaf object must not stop the walk from freezing its siblings');
});
