// test/clashtest/results/status.test.mjs
//
// Task P5.6: the §12.5 taint rule (`getPairStatus`/`getElementStatus`) and the sealed-ledger reader
// (`createStatusReader`/`buildStatusReaderSteps`/`readLedger`).
//
// NOTE on fixture values: the task brief's own illustrative test code uses placeholder model keys
// ('MA'/'MB') and dbIds (1/7/101/102/950/2/9/777) that do not correspond to this repo's REAL,
// already-landed `resultSetFixtures.mjs` (Task P5.5's `positives`/`completed-with-gaps`/
// `unreachable-positive` use the real MODEL_A/MODEL_B URN keys and specific dbIds already consumed
// by other passing tests -- e.g. `validateResultSet.invariants.test.mjs`). Per a codex-advisor
// consult (2026-09-22) on exactly this reconciliation question: reuse the REAL fixtures/dbIds
// as-is (never rewrite an existing shared fixture's IDs), add NEW shared helpers additively
// (`pairOf`, `widePlan`, `sharedRootPlan`, the `hierarchy-internal` kind, and exporting
// `MODEL_A`/`MODEL_B`), and use the existing `resealed(...)` helper (never a fixture edit) for the
// one scenario (`completed-with-gaps`) that needs an extra root-owner row.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPairStatus, getElementStatus, createStatusReader, buildStatusReaderSteps, readLedger }
  from '../../../clashtest/results/status.js';
import { validateResultSet } from '../../../clashtest/results/validateResultSet.js';
import { ENGINE_LIMIT_DEFAULTS } from '../../../clashtest/options.js';
import { sealedSet, resealed, pairOf, widePlan, sharedRootPlan, MODEL_A, MODEL_B }
  from '../support/resultSetFixtures.mjs';

const limits = ENGINE_LIMIT_DEFAULTS;

test('a clean covered pair is covered-clean', async () => {
  const set = await sealedSet('positives');
  const s = getPairStatus(set, pairOf(MODEL_A, 100, MODEL_B, 200));
  assert.equal(s.verdict, 'covered-clean');
  assert.equal(s.required, true);
  assert.equal(s.coveringUnitId, 'u1');
  assert.equal(s.unitOutcome, 'evaluated');
  assert.deepEqual(s.caveats, []);
});

// The task brief's own TAINTS table has six clauses and omits rule 4 (`duplicateEvidenceConflict`)
// -- a codex-advisor finding on this reconciliation added the seventh explicitly.
const TAINTS = [
  ['element', (s) => { s.ledger.units[0].taints.push(
    { kind: 'element', modelKey: MODEL_A, dbId: 100, reason: 'clearance-invalid-transform', occurrences: 1 }); }],
  ['target-model', (s) => { s.ledger.units[0].taints.push(
    { kind: 'target-model', modelKey: MODEL_B, dbId: null, reason: 'fragment-not-loaded', occurrences: 2 }); }],
  ['unit', (s) => { s.ledger.units[0].taints.push(
    { kind: 'unit', modelKey: null, dbId: null, reason: 'taint-overflow', occurrences: 1 }); }],
  ['mixed-owner', (s) => { s.ledger.unreachablePopulation.push(
    { modelKey: MODEL_A, ownerDbIds: [], mixedOwnerDbIds: [100], unattributable: { notLoaded: 0, ownerUnresolvable: 0 } }); }],
  ['unattributable', (s) => { s.ledger.unreachablePopulation.push(
    { modelKey: MODEL_B, ownerDbIds: [], mixedOwnerDbIds: [], unattributable: { notLoaded: 1, ownerUnresolvable: 0 } }); }],
  ['stale-seal', (s) => { s.outcome.freshness = 'stale'; }],
  ['duplicate-evidence-conflict', (s) => { s.results[0].flags = { ...s.results[0].flags, duplicateEvidenceConflict: true }; }],
];

test('every taint-rule clause alone makes the pair covered-caveated', async () => {
  for (const [label, taint] of TAINTS) {
    const set = structuredClone(await sealedSet('positives'));
    taint(set);
    const s = getPairStatus(set, pairOf(MODEL_A, 100, MODEL_B, 200));
    assert.equal(s.verdict, 'covered-caveated', label);
    assert.ok(s.caveats.length > 0, label);
    assert.ok(s.caveats.every((c) => ['element', 'target-model', 'unit'].includes(c.attribution)), label);
  }
});

test('a target-model taint only caveats a WHOLE-MODEL target scope', async () => {
  const set = structuredClone(await sealedSet('positives'));
  // Root 20 (not owner 200): a `scope: 'roots'` target names a ROOT dbId, never an owner dbId.
  set.ledger.units[0].targets = [{ modelKey: MODEL_B, scope: 'roots', rootDbIds: [20] }];
  set.ledger.units[0].taints.push({ kind: 'target-model', modelKey: MODEL_B, dbId: null, reason: 'fragment-not-loaded', occurrences: 1 });
  assert.equal(getPairStatus(set, pairOf(MODEL_A, 100, MODEL_B, 200)).verdict, 'covered-clean');
});

test('a benign witness-unavailable taint is REPORTED but does not downgrade the verdict', async () => {
  // Register S-P4-4 / Gates item 6: §12.2.1 records the table unfiltered; the filter lives here.
  const set = structuredClone(await sealedSet('positives'));
  set.ledger.units[0].taints.push({ kind: 'element', modelKey: MODEL_A, dbId: 100, reason: 'witness-unavailable', occurrences: 4 });
  const s = getPairStatus(set, pairOf(MODEL_A, 100, MODEL_B, 200));
  assert.equal(s.verdict, 'covered-clean');                                  // benign => still clean
  assert.deepEqual(s.caveats, [{ reason: 'witness-unavailable', count: 4, attribution: 'element' }]);

  // one benign + one completeness-affecting => caveated, and BOTH are listed
  const mixed = structuredClone(set);
  mixed.ledger.units[0].taints.push({ kind: 'element', modelKey: MODEL_B, dbId: 200, reason: 'geometry-not-yet-available', occurrences: 1 });
  const m = getPairStatus(mixed, pairOf(MODEL_A, 100, MODEL_B, 200));
  assert.equal(m.verdict, 'covered-caveated');
  assert.deepEqual(m.caveats.map((c) => c.reason), ['witness-unavailable', 'geometry-not-yet-available']);
});

test('not-required, gap and undetermined verdicts -- and `required` is null only for undetermined', async () => {
  const hier = await sealedSet('hierarchy-internal');
  const h = getPairStatus(hier, pairOf(MODEL_A, 101, MODEL_A, 102));
  assert.equal(h.verdict, 'not-required');
  assert.equal(h.required, false);
  assert.equal(h.reason, 'hierarchy-internal');
  assert.ok(h.caveats.some((c) => c.reason === 'hierarchy-internal'));

  const unreachable = await sealedSet('unreachable-positive');
  const u = getPairStatus(unreachable, pairOf(MODEL_A, 100, MODEL_B, 999));
  assert.equal(u.verdict, 'not-required');
  assert.equal(u.required, false);

  // `completed-with-gaps`'s base fixture never gives its failed unit (u2, source root 11) a
  // resolvable owner -- `resealed` adds one WITHOUT touching the shared base fixture other tests
  // already depend on (codex-advisor recommendation, 2026-09-22).
  const gapped = await resealed((s) => {
    s.ledger.rootOwners[0].owners.push({ rootDbId: 11, ownerDbIds: [102], cls: 'A' });
  }, 'completed-with-gaps');
  const g = getPairStatus(gapped, pairOf(MODEL_A, 102, MODEL_B, 200));
  assert.equal(g.verdict, 'gap');
  assert.equal(g.required, true);

  // §12.5 declares `required: boolean` but defines NO value for `undetermined`: P5 pins `null`
  // ("we cannot say"), never `false` (which would assert the pair is not required).
  const foreign = getPairStatus(await sealedSet('positives'), pairOf(MODEL_A, 777, MODEL_B, 200));
  assert.equal(foreign.verdict, 'undetermined');
  assert.equal(foreign.required, null);
  assert.deepEqual(foreign.roots, { first: null, second: 20 });
});

test('a mixed owner is REQUIRED and caveated, never not-required (§12.5, taint rule 6)', async () => {
  const set = structuredClone(await sealedSet('positives'));
  set.ledger.unreachablePopulation.push({ modelKey: MODEL_A, ownerDbIds: [], mixedOwnerDbIds: [100],
    unattributable: { notLoaded: 0, ownerUnresolvable: 0 } });
  const s = getPairStatus(set, pairOf(MODEL_A, 100, MODEL_B, 200));
  assert.equal(s.required, true);
  assert.equal(s.verdict, 'covered-caveated');
});

// codex-review finding (2026-09-22, High, confirmed against this very `positives` fixture: root 10
// is never listed in its own `ownerDbIds` ([100, 101]) -- an explicit-scope root can be a
// non-owning ancestor, spec §6.2: "an owner such as a non-listed descendant 105 of explicit root
// 100"). A root's bare dbId must NOT be treated as an implicit, coverable owner element merely
// because it names a root; only `ownerDbIds` membership makes a dbId a valid owner.
test('a root that does not own itself is undetermined as an element; its real owners are unaffected', async () => {
  const set = await sealedSet('positives');
  const asRoot = getPairStatus(set, pairOf(MODEL_A, 10, MODEL_B, 200));
  assert.equal(asRoot.verdict, 'undetermined');
  assert.equal(asRoot.required, null);
  assert.deepEqual(asRoot.roots, { first: null, second: 20 });
  assert.equal(getElementStatus(set, { modelKey: MODEL_A, dbId: 10 }).inRequiredPairSpace, false);

  // its REAL owners (100, 101 -- listed in root 10's own `ownerDbIds`) still resolve normally.
  assert.equal(getPairStatus(set, pairOf(MODEL_A, 100, MODEL_B, 200)).verdict, 'covered-clean');
  assert.equal(getElementStatus(set, { modelKey: MODEL_A, dbId: 100 }).inRequiredPairSpace, true);
});

// ---- the three reader exports moved here from P8 (D4) ----------------------------------------
test('createStatusReader answers the same as the one-shot helpers, building the index once', async () => {
  const set = await sealedSet('positives');
  const reader = createStatusReader(set);
  assert.deepEqual(reader.pairStatus(pairOf(MODEL_A, 100, MODEL_B, 200)),
                    getPairStatus(set, pairOf(MODEL_A, 100, MODEL_B, 200)));
  assert.deepEqual(reader.elementStatus({ modelKey: MODEL_A, dbId: 100 }),
                    getElementStatus(set, { modelKey: MODEL_A, dbId: 100 }));
});

test('buildStatusReaderSteps yields while it builds and returns the same reader', async () => {
  const set = await sealedSet('positives');
  const it = buildStatusReaderSteps(set);
  let yields = 0;
  let step = it.next();
  while (!step.done) { yields += 1; step = it.next(); }
  assert.ok(yields > 0, 'a derivation can slice the build');
  assert.deepEqual(step.value.pairStatus(pairOf(MODEL_A, 100, MODEL_B, 200)).verdict, 'covered-clean');
});

test('a frozen set reuses its index; a mutable set is never answered from a stale one', async () => {
  const frozen = await sealedSet('positives');
  assert.equal(Object.isFrozen(frozen), true);
  assert.deepEqual(getPairStatus(frozen, pairOf(MODEL_A, 100, MODEL_B, 200)),
                   getPairStatus(frozen, pairOf(MODEL_A, 100, MODEL_B, 200)), 'repeated answers agree');

  // Index reuse is a performance property and is invisible for a frozen set -- which is exactly why
  // it is only ever applied to frozen sets. A MUTABLE set must be re-read on every call:
  const mutable = structuredClone(frozen);
  assert.equal(getPairStatus(mutable, pairOf(MODEL_A, 100, MODEL_B, 200)).verdict, 'covered-clean');
  mutable.ledger.units[0].outcome = 'failed';
  mutable.ledger.units[0].cause = 'capacity-exceeded';
  assert.equal(getPairStatus(mutable, pairOf(MODEL_A, 100, MODEL_B, 200)).verdict, 'gap', 'no stale cached index');
});

// --- review Important 2: the reader's complexity is an acceptance criterion, not a claim -------
// A counting instrument, not a proxy: `Map.prototype.get` / `Set.prototype.has` are patched for the
// duration and restored. Same technique as the `JSON.parse` and `structuredClone` spies elsewhere.
const ops = { count: 0 };
function withOpCounting(fn) {
  const mapGet = Map.prototype.get, setHas = Set.prototype.has, incl = Array.prototype.includes;
  Map.prototype.get = function (k) { ops.count += 1; return mapGet.call(this, k); };
  Set.prototype.has = function (k) { ops.count += 1; return setHas.call(this, k); };
  Array.prototype.includes = function (v) { ops.count += 1; return incl.call(this, v); };
  try { return fn(); } finally {
    Map.prototype.get = mapGet; Set.prototype.has = setHas; Array.prototype.includes = incl;
  }
}

test('reader build is linear in units and lookup cost does not grow with the unit count', async () => {
  // `widePlan(unitCount)` produces a valid sealed set with `unitCount` leaf units over the same two
  // models, and 50 results spread across them -- so the PROBES are identical at both sizes.
  const measure = async (unitCount) => {
    const set = await widePlan(unitCount);
    const probes = set.results.slice(0, 50).map((r) => r.pair);
    let reader;
    const build = withOpCounting(() => { const b = ops.count; reader = createStatusReader(set); return ops.count - b; });
    const lookup = withOpCounting(() => { const b = ops.count; for (const p of probes) reader.pairStatus(p); return ops.count - b; });
    return { build, lookup };
  };
  const small = await measure(200);
  const large = await measure(2_000);                       // 10x the units, identical probes

  // Build is O(units + rows + results): 10x the units costs ~10x, never ~100x.
  assert.ok(large.build < small.build * 20,
    `build scaled super-linearly: ${small.build} -> ${large.build}`);
  // Lookup is O(1)/bounded: 10x the units must NOT make 50 lookups measurably more expensive.
  // The old `leaves.find(...)` reader would have gone up by ~10x here.
  assert.ok(large.lookup < small.lookup * 1.5,
    `lookup scaled with the unit count: ${small.lookup} -> ${large.lookup}`);
  assert.ok(large.lookup < large.build, 'a lookup must cost far less than the build it reuses');
});

test('elementStatus visits only the units that touch the element', async () => {
  const set = await widePlan(2_000);
  const reader = createStatusReader(set);
  // The fixture puts each SOURCE root in exactly one unit, so the element's coverage comes from one unit.
  const e = reader.elementStatus({ modelKey: set.ledger.rootOwners[0].modelKey,
    dbId: set.ledger.rootOwners[0].owners[0].rootDbId });
  assert.equal(e.coverage, 'full');
  assert.equal(e.gapCauses.length, 0);
  const lookup = withOpCounting(() => {
    const b = ops.count; reader.elementStatus({ modelKey: MODEL_A, dbId: 999_999 }); return ops.count - b;
  });
  assert.ok(lookup < 50, `a miss must not scan 2,000 units: ${lookup} ops`);
});

// --- codex-advisor finding (2026-09-22): `widePlan`'s exact-cover design (one leaf per root pair)
// cannot exercise `findCoveringUnit`'s own worst case -- real split fan-out can retain the SAME
// source root across many leaf children while partitioning only the target side. This isolates
// that shape and tells apart "the index is not scoped by root" (a real regression) from "cost
// grows with a single root's own fan-out" (the documented, bounded-by-split property this task's
// own complexity contract already names -- not a defect of this implementation).
test('a shared source root: unrelated growth costs nothing; the shared root\'s own fan-out does', async () => {
  const probeAt = (fanOut) => pairOf(MODEL_A, 5000, MODEL_B, 6000 + fanOut - 1); // the LAST fanned-out unit

  // `getPairStatus` builds (and caches, since these sets are frozen) the reader on its FIRST call
  // for a given set -- so every set is warmed with one throwaway call before the op-counted probe,
  // or the very first measurement would silently be timing the BUILD, not the lookup.
  const baseline = await sharedRootPlan({ fanOut: 50, unrelatedUnits: 0 });
  const grownUnrelated = await sharedRootPlan({ fanOut: 50, unrelatedUnits: 2000 });
  getPairStatus(baseline, probeAt(50));
  getPairStatus(grownUnrelated, probeAt(50));
  const baselineOps = withOpCounting(() => {
    const b = ops.count; getPairStatus(baseline, probeAt(50)); return ops.count - b;
  });
  const grownOps = withOpCounting(() => {
    const b = ops.count; getPairStatus(grownUnrelated, probeAt(50)); return ops.count - b;
  });
  assert.ok(grownOps < baselineOps * 1.5,
    `growing UNRELATED units must not cost this probe: ${baselineOps} -> ${grownOps}`);

  const smallFanOut = await sharedRootPlan({ fanOut: 20 });
  const largeFanOut = await sharedRootPlan({ fanOut: 400 });
  assert.equal(getPairStatus(smallFanOut, probeAt(20)).verdict, 'covered-clean');   // also warms
  assert.equal(getPairStatus(largeFanOut, probeAt(400)).verdict, 'covered-clean');  // also warms
  const smallOps = withOpCounting(() => {
    const b = ops.count; getPairStatus(smallFanOut, probeAt(20)); return ops.count - b;
  });
  const largeOps = withOpCounting(() => {
    const b = ops.count; getPairStatus(largeFanOut, probeAt(400)); return ops.count - b;
  });
  assert.ok(largeOps > smallOps, 'fan-out-bound cost is real: a 20x larger shared root costs strictly more');
});

// codex-review finding (2026-09-22, Medium, confirmed): `ownerDbIds`/`mixedOwnerDbIds` are bounded
// only by the run's own ledger-record ceilings, not by a small constant -- a lookup that scanned
// them with `Array.prototype.includes` on every call would violate this reader's own O(1)/bounded
// contract for a model with a large unreachable population. `readLedger` now precomputes `Set`s for
// both once at build time; every lookup reads them with `Set.has`.
//
// NOTE: this needs WALL-CLOCK timing, not the `withOpCounting` instrument above -- that instrument
// counts CALLS to `Array.prototype.includes`/`Set.prototype.has` (one op per call, always), so it
// cannot tell an O(1) `Set.has` apart from an O(n) `Array.includes` over the same call count. Only
// elapsed time actually distinguishes them (confirmed empirically: reverting the fix to
// `Array.prototype.includes` left this test's own op-counting variant green).
test('unreachable/mixed-owner lookups cost O(1), never O(population size)', async () => {
  const LARGE = 1_000_000;
  const farAway = Array.from({ length: LARGE }, (_, i) => 5_000_000 + i);   // never overlaps a real probe id
  const set = await resealed((s) => {
    s.ledger.unreachablePopulation.push({ modelKey: MODEL_B, ownerDbIds: farAway, mixedOwnerDbIds: farAway,
      unattributable: { notLoaded: 0, ownerUnresolvable: 0 } });
  }, 'positives');

  getPairStatus(set, pairOf(MODEL_A, 100, MODEL_B, 200));   // warm: build+cache the reader once
  assert.equal(getPairStatus(set, pairOf(MODEL_A, 100, MODEL_B, 200)).verdict, 'covered-clean');

  const REPEATS = 2000;
  const start = Date.now();
  for (let i = 0; i < REPEATS; i++) getPairStatus(set, pairOf(MODEL_A, 100, MODEL_B, 200));
  const elapsedMs = Date.now() - start;
  // Measured in this environment: O(1) `Set.has` completes 2,000 lookups against a 1,000,000-entry
  // population in ~3ms; reverting to `Array.prototype.includes` (up to 2,000 x 1,000,000 = 2e9
  // comparisons here) took ~740ms -- a ~250x gap, so 150ms leaves ample margin on both sides.
  assert.ok(elapsedMs < 150,
    `${REPEATS} lookups against a 1,000,000-entry population took ${elapsedMs}ms -- looks O(population size), not O(1)`);
});

test('readLedger exposes the per-root cls marker P8 needs (R2), not a bounded examples list', async () => {
  const set = await sealedSet('hierarchy-internal');
  const it = readLedger(set);
  let step = it.next();
  while (!step.done) step = it.next();
  const model = step.value.byModel.get(MODEL_A);
  assert.equal(model.rootCls.get(100), 'C');                     // the A ∩ B root
  assert.equal(model.ownerToRoot.get(101), 100);
  assert.equal(model.ownerToRoot.get(102), 100);
  assert.equal(step.value.leaves.every((u) => u.outcome !== 'split'), true);
});

test('element status reports hierarchy-internal from cls even beyond the 20 bounded examples', async () => {
  const set = structuredClone(await sealedSet('hierarchy-internal'));
  set.ledger.hierarchyInternal[0].examples = [];                 // the bounded list is EMPTY ...
  const e = getElementStatus(set, { modelKey: MODEL_A, dbId: 101 });
  assert.ok(e.caveats.some((c) => c.reason === 'hierarchy-internal'), '... and the caveat still appears');
});

test('element status reports unit-level taints and gap causes', async () => {
  const set = await resealed((s) => {
    s.ledger.rootOwners[0].owners.push({ rootDbId: 11, ownerDbIds: [102], cls: 'A' });
  }, 'completed-with-gaps');
  const e = getElementStatus(set, { modelKey: MODEL_A, dbId: 102 });
  assert.equal(e.inRequiredPairSpace, true);
  assert.equal(e.coverage, 'partial');
  assert.deepEqual(e.gapCauses, ['capacity-exceeded']);

  const mixed = structuredClone(await sealedSet('positives'));
  mixed.ledger.unreachablePopulation.push({ modelKey: MODEL_A, ownerDbIds: [], mixedOwnerDbIds: [100],
    unattributable: { notLoaded: 0, ownerUnresolvable: 0 } });
  assert.ok(getElementStatus(mixed, { modelKey: MODEL_A, dbId: 100 }).caveats.some((c) => c.reason === 'mixed-owner-provenance'));
});

// codex-advisor recommendation (2026-09-22): validate at least one newly-added fixture kind so a
// structural mistake in `hierarchyInternalParts` (a real bug in a hand-built fixture) is caught by
// the same validator every other P5.5/P5.6 fixture is checked against, not just by `status.js`
// happening to tolerate it.
test('the hierarchy-internal fixture is a genuinely schema-valid sealed set', async () => {
  const set = await sealedSet('hierarchy-internal');
  assert.deepEqual(validateResultSet(set, { limits }), { ok: true, issues: [] });
});
