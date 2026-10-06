// Exhaustive sound-correlator ablation (spec §8.6, remediation M1): extraction function, co-minimal handling,
// non-monotonicity, the hard soundness gate, and a deterministic real-data subsample over ALL 2,048 configurations.
// [SYN] research tests only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPinned } from './pins.mjs';
import { observeSchedule, labelsOf, QUESTION_IDS } from './observer.mjs';
import {
  ELEMENTS, N_CONFIG_MASKS, N_CONFIGURATIONS, newAccumulator, ablateSchedule, mergeAccumulators, analyzeAblation,
  extractMinimum, compareConfigMasks, maskOfElements, elementsOfMask, decodeSatisfying,
} from './ablation.mjs';
import { assertNoNumericPose } from './bounds.mjs';

const { fixtures: fx, mods } = await loadPinned();
const d2 = { ...mods.contract, ...mods.machine };
const within = mods.contract.cameraSamplesWithin;
const schedules = mods.schedules.enumerateSchedules(fx.domains);
const exit2 = (e) => e.exitCode === 2;
const bit = (e) => 1 << ELEMENTS.indexOf(e);

test('extractMinimum: two co-minimal sets are both reported, uniqueness is never claimed, tie-break is deterministic', () => {
  // satisfying: every superset of {P-FRM,P-XS} or of {P-TICK,P-CC}; plus the irreducible 3-set {P-TC,V-ACT,ID-ON}
  const A = bit('P-FRM') | bit('P-XS'); const B = bit('P-TICK') | bit('P-CC'); const C = bit('P-TC') | bit('V-ACT') | bit('ID-ON');
  const suff = Array.from({ length: N_CONFIG_MASKS }, (_, m) => (m & A) === A || (m & B) === B || (m & C) === C);
  const r = extractMinimum(suff);
  assert.equal(r.subsetsEvaluated, 1024);
  assert.equal(r.minimumCardinality, 2);
  assert.deepEqual(r.minimum, [A, B]);
  assert.equal(r.unique, false, 'two minima => never unique');
  assert.equal(r.canonical, A, 'lexicographically smallest index array wins among equal size/V-count');
  assert.deepEqual(r.coMinimal, [B]);
  assert.deepEqual(r.irreducibleNotMinimum, [C]);
  assert.equal(r.monotonicityViolations, 0);
  // fewer V-* atoms wins before index order
  const V = bit('P-FRM') | bit('V-PEND'); const P = bit('P-TICK') | bit('P-TC');
  const r2 = extractMinimum(Array.from({ length: N_CONFIG_MASKS }, (_, m) => (m & V) === V || (m & P) === P));
  assert.equal(r2.canonical, P); assert.deepEqual(r2.coMinimal, [V]);
  assert.ok(compareConfigMasks(P, V) < 0);
  // P-CC0 (unverified) is never the canonical recommendation
  const I = bit('P-CC0');
  const r3 = extractMinimum(Array.from({ length: N_CONFIG_MASKS }, (_, m) => (m & I) === I || (m & A) === A));
  assert.equal(r3.minimumCardinality, 1); assert.equal(r3.canonical, null); assert.equal(r3.canonicalIncludingInf, I);
  assert.deepEqual(r3.irreducibleNotMinimum, [A]);
  // single minimum => unique
  assert.equal(extractMinimum(Array.from({ length: N_CONFIG_MASKS }, (_, m) => (m & A) === A)).unique, true);
  assert.equal(extractMinimum(Array(N_CONFIG_MASKS).fill(false)).status, 'NO_SATISFYING_SET');
});

test('extractMinimum: non-monotone table is handled from the full table (no pruning)', () => {
  const A = bit('P-FRM'); const AB = bit('P-FRM') | bit('P-TC'); const TE = bit('P-TC') | bit('V-EDGE');
  const suff = Array.from({ length: N_CONFIG_MASKS }, (_, m) => (m & A) === A || (m & TE) === TE);
  suff[AB] = false; // a superset of a satisfying set that does not satisfy (exactly one violating pair: A < AB)
  const r = extractMinimum(suff);
  assert.deepEqual(r.minimal, [A, bit('P-TC') | bit('V-EDGE')]);
  assert.equal(r.monotonicityViolations, 1);
  // single-removal irreducibility is computed directly too (AB|V-EDGE: removing P-FRM leaves {P-TC,V-EDGE})
  assert.ok(!r.singleRemovalIrreducible.includes(AB | bit('V-EDGE')));
  assert.ok(r.singleRemovalIrreducible.includes(A));
});

test('hard soundness gate: any wrong definite label in any configuration fails closed (exit 2)', () => {
  const acc = newAccumulator(); acc.schedules = 1;
  acc.counts[4] = 1; // window OPEN, cm 0, Q-OWNER, field wrong
  acc.wrongWitness[0] = 0; acc.wrongWitness[1] = 0;
  assert.throws(() => analyzeAblation(acc, 1), (e) => exit2(e) && e.code === 'CORRELATOR-SOUNDNESS');
  assert.throws(() => analyzeAblation(newAccumulator(), 1), (e) => exit2(e) && e.code === 'ABLATION', 'schedule count must match');
});

// ---- deterministic real-data subsample: every 157th relevant schedule (all four cells), ALL 2,048 configurations
const rel = [];
schedules.forEach((s, i) => { const o = observeSchedule(s, fx, d2); if (o.gt) rel.push({ s, i, o, L: labelsOf(o.gt) }); });
const SUB = rel.filter((_, j) => j % 157 === 0);
const truthOf = (x) => Object.fromEntries(['Q-OWNER', 'Q-SUBJ', 'Q-ATTR'].map((q) => [q, x.L[QUESTION_IDS.indexOf(q)]]));
const runOn = (list) => { const acc = newAccumulator(); for (const x of list) ablateSchedule(x.o.events, truthOf(x), within, acc, x.i, x.s.id); return acc; };
const accAll = runOn(SUB);
const res = analyzeAblation(accAll, SUB.length, (o) => schedules[o].id, { failOnWrong: false });
const CANON = maskOfElements(['P-FRM', 'P-TC', 'V-PEND', 'V-EDGE', 'ID-ON']);
const OLD = maskOfElements(['P-FRM', 'P-XS', 'P-TC', 'V-PEND', 'V-EDGE', 'ID-ON']);
const def = (cm) => Object.fromEntries(['OPEN', 'ASSUME'].map((w) => [w, Object.fromEntries(['Q-OWNER', 'Q-SUBJ', 'Q-ATTR'].map((q) => [q, res.outcomes[res.outcomeIndex[w][cm]][q].definite]))]));

test('subsample: exhaustive count, merge is order-independent, any unsound configuration lacks P-TC', () => {
  assert.ok(SUB.length >= 200, `subsample size ${SUB.length}`);
  assert.equal(N_CONFIGURATIONS, 2048);
  assert.equal(res.configurationsEvaluated, 2048);
  assert.equal(res.correlatorEvaluations, 2048 * SUB.length);
  assert.equal(res.outcomeIndex.OPEN.length + res.outcomeIndex.ASSUME.length, 2048);
  const half = Math.floor(SUB.length / 2);
  const a = mergeAccumulators(runOn(SUB.slice(half)), runOn(SUB.slice(0, half)));
  for (const k of ['counts', 'reasons', 'nonDefBySubj', 'influence', 'influenceDefinite', 'witness', 'witnessDefinite', 'wrongWitness']) assert.deepEqual(a[k], accAll[k], k);
  // unsound configurations (if any) can never reach the target: without P-TC, Q-ATTR is UNAVAILABLE (0 definite)
  assert.equal(res.unsoundConfigurations.length, 0, 'hidden-terminal fix: no configuration emits a wrong definite label');
  for (const u of res.unsoundConfigurations) assert.ok(!u.elements.includes('P-TC'), `unsound ${u.window} [${u.elements}] contains P-TC`);
  for (let cm = 0; cm < N_CONFIG_MASKS; cm += 1) if (!(cm & bit('P-TC'))) assert.equal(def(cm).ASSUME['Q-ATTR'], 0);
});

test('subsample: P-XS removal from the old bundle leaves every verdict unchanged; with P-FRM present P-XS never changes a definite verdict', () => {
  assert.deepEqual(def(OLD), def(OLD & ~bit('P-XS')));
  assert.equal(res.oldBundle.singleRemoval.find((r) => r.element === 'P-XS').satisfies, true);
  const PXS = 1; const PFRM = bit('P-FRM');
  for (const [wi, w] of ['OPEN', 'ASSUME'].entries()) {
    const inf = res.influence['P-XS'][w];
    assert.equal(inf.anyVerdict.atCanonical, 0, `${w}: no schedule verdict differs between canonical and canonical+P-XS`);
    assert.equal(inf.anyVerdict.aboveCanonical.configPairs, 16);
    assert.equal(inf.anyVerdict.aboveCanonical.configPairsChanged, 0, `${w}: once the minimum is present P-XS changes no verdict`);
    // wherever P-FRM is present, P-XS changes no definite verdict on any schedule (it can only matter without P-FRM)
    for (let cm = 0; cm < N_CONFIG_MASKS; cm += 1) if ((cm & PFRM) && !(cm & (1 << PXS))) assert.equal(accAll.influenceDefinite[(wi * 10 + PXS) * N_CONFIG_MASKS + cm], 0, `${w} cm ${cm}`);
  }
});

test('subsample: canonical minimum {P-FRM,P-TC,V-PEND,V-EDGE,ID-ON} satisfies and every element is necessary', () => {
  assert.equal(res.canonical.mask, CANON);
  const sat = decodeSatisfying(res.satisfyingBitmapHex);
  assert.equal(sat.length, res.lattice.satisfyingCount);
  assert.deepEqual(sat, Array.from({ length: N_CONFIG_MASKS }, (_, m) => m).filter((m) => (m & CANON) === CANON), 'exactly the supersets of the minimum satisfy');
  assert.doesNotThrow(() => assertNoNumericPose(res), 'the ablation section passes the output numeric-sample guard');
  assert.equal(res.lattice.unique, res.lattice.minimum.length === 1);
  assert.deepEqual(def(CANON), def(N_CONFIG_MASKS - 1));
  for (const r of res.canonical.necessity) {
    assert.equal(r.satisfies, false, `removing ${r.element} must break the target`);
    assert.ok(Object.values(r.deltaVsTarget).some((x) => Object.values(x).some((d) => d < 0)), `${r.element}: some definite count drops`);
  }
  assert.deepEqual(res.canonical.necessity.map((r) => r.element), elementsOfMask(CANON));
});

test('subsample: ID-OFF and public-only subsets give 0 definite Q-SUBJ/Q-ATTR; public-only gives 0 definite everywhere', () => {
  for (const w of ['OPEN', 'ASSUME']) {
    assert.equal(res.idOff.maxDefinite[w]['Q-SUBJ'], 0); assert.equal(res.idOff.maxDefinite[w]['Q-ATTR'], 0);
    for (const q of ['Q-OWNER', 'Q-SUBJ', 'Q-ATTR']) assert.equal(res.publicOnly.maxDefinite[w][q], 0, `public-only ${w} ${q}`);
  }
  assert.equal(res.publicOnly.configMasksEvaluated, 128); assert.equal(res.idOff.configMasksEvaluated, 512);
});
