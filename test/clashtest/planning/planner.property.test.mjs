// test/clashtest/planning/planner.property.test.mjs
//
// The phase's headline test (master Definition of Done item 5): 200 seeded cases x 2 modes prove the plan covers the
// required pair space EXACTLY ONCE against a brute-force reference that shares no code with the decomposition; the
// ledger closes to `pairSpaceTotal` over leaf unit records; the same-model F2 self-exclusion holds; the plan is
// byte-identical under input reordering; nested roots fail `hierarchy-overlap` and never mis-cover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlan, materializeUnit } from '../../../clashtest/planning/planner.js';
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';
import { makeSyntheticEnumerator, defOf, snapshotOf, shuffleDefinition } from '../support/syntheticModels.mjs';
import { requiredPairSpace, expandUnitPairs, expandRecordPairs } from '../support/bruteForcePairs.mjs';

function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

// `maxFrag` > 1 gives roots 1..maxFrag fragments each (the tight-sizing variant needs weights to cut on).
function randomCase(rnd, { maxFrag = 1 } = {}) {
  const modelCount = 1 + Math.floor(rnd() * 4);
  const models = [], entriesA = [], entriesB = [];
  let fragId = 0;
  for (let i = 0; i < modelCount; i++) {
    const modelKey = `m${i}`;
    const rootCount = 1 + Math.floor(rnd() * 5);
    const roots = Array.from({ length: rootCount }, (_, k) => {
      const n = 1 + Math.floor(rnd() * maxFrag);
      const dbId = (k + 1) * 10;
      return { dbId, owners: [dbId], fragments: Array.from({ length: n }, () => ({ fragId: fragId++, ownerDbId: dbId, geometryId: 1 })) };
    });
    models.push({ modelKey, roots });
    const pick = () => { const n = 1 + Math.floor(rnd() * rootCount);
      return roots.slice(0, n).map((r) => r.dbId).sort((a, b) => a - b); };
    if (rnd() < 0.4) entriesA.push({ kind: 'model', modelKey });
    else if (rnd() < 0.85) entriesA.push({ kind: 'elements', modelKey, dbIds: pick() });
    if (rnd() < 0.4) entriesB.push({ kind: 'model', modelKey });
    else if (rnd() < 0.85) entriesB.push({ kind: 'elements', modelKey, dbIds: pick() });
  }
  if (!entriesA.length) entriesA.push({ kind: 'model', modelKey: 'm0' });
  if (!entriesB.length) entriesB.push({ kind: 'model', modelKey: 'm0' });
  return { models, A: entriesA, B: entriesB };
}

/** The model keys a case's definition names, ascending: the snapshot is positional over exactly these (P1 R7). */
const namedKeys = (c) => [...new Set([...c.A, ...c.B].map((e) => e.modelKey))].sort();

function shuffled(list, rnd) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
const shuffleModels = (models, rnd) => shuffled(models, rnd).map((m) => ({ ...m, roots: shuffled(m.roots, rnd) }));

/** Everything observable about a planning result, as one JSON string (Maps expanded, ledger projected, units materialized). */
function projectPlan(res) {
  const p = res.plan;
  return JSON.stringify({
    status: res.status,
    planningGaps: res.planningGaps,
    preTerminalGapWeight: res.preTerminalGapWeight,
    ledger: res.ledger.toLedgerRecord(),
    plan: p === null ? null : {
      tables: p.tables,
      ownersByModel: [...p.ownersByModel],
      ownerRootByModel: [...p.ownerRootByModel].map(([k, m]) => [k, [...m]]),
      models: [...p.models],
      selectionKindByRole: p.selectionKindByRole,
      units: p.units,
      gaps: p.gaps,
      unitIds: [...p.unitsById.keys()],
      pairSpaceTotal: p.pairSpaceTotal,
      planRecords: p.planRecords,
      sizing: p.sizing,
      materialized: [...p.units, ...p.gaps].map((u) => materializeUnit(p, u)),
    },
  });
}

const TIGHT = { maxSourceFragmentsPerUnit: 3, maxSourceDbIdsPerUnit: 2, maxTargetModelsPerUnit: 1, maxTargetFragmentsPerUnit: 2 };

async function checkCase({ seed, ordered, options, maxFrag }) {
  const c = randomCase(seeded(seed), { maxFrag });
  const { enumerator, binding } = makeSyntheticEnumerator(c.models);
  const definition = defOf({ A: c.A, B: c.B, mode: ordered ? 'containment' : 'volume-overlap' });
  const res = await createPlan({ definition, snapshot: snapshotOf(binding, namedKeys(c)), enumerator, options, checkpoint: () => {} });
  // This generator produces only flat, healthy models: every case must plan. (A failure would hide an uncovered case.)
  assert.equal(res.status, 'planned', `seed ${seed}: ${JSON.stringify(res.planningGaps)}`);
  const required = await requiredPairSpace({ definition, models: c.models, ordered });
  const { plan } = res;

  const fromUnits = plan.units.flatMap((u) => expandUnitPairs(plan, u, ordered));
  const fromGaps = plan.gaps.flatMap((g) => expandUnitPairs(plan, g, ordered));
  const covered = [...fromUnits, ...fromGaps];
  // (a) EXACTLY once: no pair twice (issuable units and pre-planned gaps together partition P) ...
  assert.equal(covered.length, new Set(covered).size, `seed ${seed}: a pair is covered twice`);
  // ... and nothing missing, nothing extra.
  assert.deepEqual(new Set(covered), required, `seed ${seed}: cover != required P`);

  // Ledger accounting closes over LEAF unit records (a pre-planned gap IS a leaf record, not a separate array).
  const rec = res.ledger.toLedgerRecord();
  const leaves = rec.units.filter((u) => u.kind === 'leaf');
  assert.equal(leaves.reduce((n, u) => n + u.pairSpaceWeight, 0), rec.pairSpaceTotal, `seed ${seed}: ledger does not account for P`);
  assert.equal(plan.units.reduce((n, u) => n + u.pairSpaceWeight, 0) + res.preTerminalGapWeight, rec.pairSpaceTotal,
    `seed ${seed}: preTerminalGapWeight does not close the accounting`);
  assert.equal(rec.pairSpaceTotal, required.size, `seed ${seed}: pairSpaceTotal != |P|`);
  assert.equal(plan.pairSpaceTotal, rec.pairSpaceTotal);
  assert.equal(rec.units.length, plan.units.length + plan.gaps.length);
  assert.equal(res.preTerminalGapWeight, plan.gaps.reduce((n, g) => n + g.pairSpaceWeight, 0));
  for (const r of rec.units.filter((u) => u.outcome === 'not-run')) assert.equal(r.cause, 'target-too-large');
  assert.equal(rec.units.filter((u) => u.outcome === 'not-run').length, plan.gaps.length);

  // The persisted record alone reproduces each unit's pairs (a sealed ledger is read without a plan).
  const byId = new Map([...plan.units, ...plan.gaps].map((u) => [u.unitId, u]));
  for (const r of leaves) {
    const u = byId.get(r.unitId);
    assert.deepEqual(expandRecordPairs(plan, r, ordered).sort(), expandUnitPairs(plan, u, ordered).sort(), `seed ${seed}: ${r.unitId}`);
  }

  // (c) F2: a same-model unit never lists a source root among its own target roots, so self-exclusion cannot suppress a pair.
  for (const u of [...plan.units, ...plan.gaps]) {
    const m = materializeUnit(plan, u);
    for (const t of m.targets) {
      if (t.modelKey !== u.sourceModelKey) continue;
      assert.notEqual(t.scope, 'whole', `seed ${seed}: a whole-model target of the source's own model`);
      for (const y of t.dbIds) assert.equal(m.sourceDbIds.includes(y), false, `seed ${seed}: F2 self-exclusion`);
    }
  }
  // Per-unit caps under tight sizing: target side is a HARD bound, and source side is packed.
  if (options !== RUN_OPTION_DEFAULTS) {
    for (const u of plan.units) {
      assert.ok(u.targetWeight <= options.maxTargetFragmentsPerUnit, `seed ${seed}: ${u.unitId} target weight ${u.targetWeight}`);
      assert.ok(u.targets.length <= options.maxTargetModelsPerUnit);
    }
  }
  return { res, required };
}

for (const ordered of [false, true]) {
  test(`exact cover over 200 seeded cases (${ordered ? 'containment' : 'unordered'})`, async () => {
    for (let seed = 1; seed <= 200; seed++) await checkCase({ seed, ordered, options: RUN_OPTION_DEFAULTS, maxFrag: 1 });
  });

  test(`exact cover under tight sizing caps, incl. target-too-large gaps (${ordered ? 'containment' : 'unordered'})`, async () => {
    let gapCases = 0;
    let multiUnit = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { res } = await checkCase({ seed, ordered, options: { ...RUN_OPTION_DEFAULTS, ...TIGHT }, maxFrag: 3 });
      if (res.plan.gaps.length > 0) gapCases++;
      if (res.plan.units.length > 3) multiUnit++;
    }
    // the variant must actually exercise gaps and heavy chunking, or it proves nothing
    assert.ok(gapCases >= 10, `only ${gapCases} cases produced a target-too-large gap`);
    assert.ok(multiUnit >= 50, `only ${multiUnit} cases produced more than 3 units`);
  });
}

test('(b) the plan is byte-identical under input reordering (both modes, default and tight caps)', async () => {
  for (const ordered of [false, true]) {
    for (const [options, maxFrag] of [[RUN_OPTION_DEFAULTS, 1], [{ ...RUN_OPTION_DEFAULTS, ...TIGHT }, 3]]) {
      for (let seed = 1; seed <= 100; seed++) {
        const c = randomCase(seeded(seed), { maxFrag });
        const mode = ordered ? 'containment' : 'volume-overlap';
        const keys = namedKeys(c);
        const a = await createPlan({ definition: defOf({ A: c.A, B: c.B, mode }),
          snapshot: snapshotOf(makeSyntheticEnumerator(c.models).binding, keys),
          enumerator: makeSyntheticEnumerator(c.models).enumerator, options, checkpoint: () => {} });
        const shuffledModels = shuffleModels(c.models, seeded(seed + 2));
        const b = await createPlan({ definition: shuffleDefinition(defOf({ A: c.A, B: c.B, mode }), seeded(seed + 1)),
          snapshot: snapshotOf(makeSyntheticEnumerator(shuffledModels).binding, keys),
          enumerator: makeSyntheticEnumerator(shuffledModels).enumerator, options, checkpoint: () => {} });
        assert.equal(a.status, 'planned', `seed ${seed}`);
        assert.equal(projectPlan(a), projectPlan(b), `seed ${seed} ordered=${ordered}`);
      }
    }
  }
});

test('(b) the projection really is sensitive: identical inputs project identically, different sizing projects differently', async () => {
  let differed = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const c = randomCase(seeded(seed), { maxFrag: 3 });
    const run = async (options) => {
      const { enumerator, binding } = makeSyntheticEnumerator(c.models);
      return createPlan({ definition: defOf({ A: c.A, B: c.B }), snapshot: snapshotOf(binding, namedKeys(c)), enumerator, options, checkpoint: () => {} });
    };
    const loose = await run(RUN_OPTION_DEFAULTS);
    assert.equal(projectPlan(loose), projectPlan(await run(RUN_OPTION_DEFAULTS)));
    if (projectPlan(loose) !== projectPlan(await run({ ...RUN_OPTION_DEFAULTS, ...TIGHT }))) differed++;
  }
  assert.ok(differed >= 10, `projection insensitive to sizing (${differed} of 50)`);
});

test('(d) nested roots produce a hierarchy-overlap failure, never a mis-cover', async () => {
  const models = [{ modelKey: 'm',
    roots: [{ dbId: 100, owners: [100, 105], fragments: [{ fragId: 0, ownerDbId: 100, geometryId: 1 },
      { fragId: 1, ownerDbId: 105, geometryId: 1 }] }],
    ancestorOf: { 105: 100 } }];
  const { enumerator, binding } = makeSyntheticEnumerator(models);
  for (const mode of ['volume-overlap', 'containment']) {
    const res = await createPlan({
      definition: defOf({ A: [{ kind: 'elements', modelKey: 'm', dbIds: [100] }],
        B: [{ kind: 'elements', modelKey: 'm', dbIds: [105] }], mode }),
      snapshot: snapshotOf(binding, ['m']), enumerator, options: RUN_OPTION_DEFAULTS, checkpoint: () => {} });
    assert.equal(res.status, 'failed');
    assert.deepEqual(res.planningGaps.map((g) => g.cause), ['hierarchy-overlap']);
    assert.equal(res.plan, null);                     // no unit exists to mis-cover the gap
    assert.equal(res.ledger.toLedgerRecord().units.length, 0);
    assert.equal(res.preTerminalGapWeight, 0);
  }
});
