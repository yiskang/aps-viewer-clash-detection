// test/performance/m4/cohort-selection.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankByDensity, selectCohort, labelDensityUnstratified } from './cohort-selection.mjs';

function profile(dbId, proximity, fragmentIds) {
  return { dbId, proximity, fragmentIds: new Set(fragmentIds) };
}

test('rankByDensity: ascending density, ties broken by ascending dbId', () => {
  const profiles = [profile(3, 10, [1, 2]), profile(1, 10, [3, 4]), profile(2, 4, [5, 6, 7, 8])];
  const ranked = rankByDensity(profiles);
  assert.deepEqual(ranked.map((r) => r.dbId), [2, 1, 3]); // density(2)=1, density(1)=density(3)=5, tie->ascending dbId
});

test('selectCohort: walks the band in ascending dbId order, cumulative SHARED fragment count (no double-count)', () => {
  // dbId 10 and 11 share fragment 100 -- naive summation would overcount.
  const profiles = [
    profile(10, 2, [100, 101]),
    profile(11, 2, [100, 102]),
    profile(12, 2, [103, 104]),
  ];
  const ranked = rankByDensity(profiles);
  const result = selectCohort(ranked, 0.5, 4); // k=4, need >=4 shared fragments
  assert.equal(result.status, 'OK');
  // 10+11 alone give {100,101,102} = 3 (not 4, since 100 is shared) -> must walk in 12 too.
  assert.equal(result.achievedInstances, 5);
});

test('selectCohort: forced dbId 3076 replaces the band member with closest density', () => {
  const profiles = [profile(1, 1, [1]), profile(2, 1, [2]), profile(3076, 100, Array.from({ length: 50 }, (_, i) => 1000 + i))];
  const ranked = rankByDensity(profiles);
  const result = selectCohort(ranked, 0.9, 1, { forceDbId: 3076 });
  assert.equal(result.status, 'OK');
  assert(result.requestedDbIds.includes(3076));
  assert(result.replacement === null || result.replacement.forcedDbId === 3076);
});

test('selectCohort: NOT EXERCISED when even the full population cannot reach k', () => {
  const profiles = [profile(1, 1, [1]), profile(2, 1, [2])];
  const ranked = rankByDensity(profiles);
  const result = selectCohort(ranked, 0.5, 1000);
  assert.equal(result.status, 'NOT_EXERCISED');
  assert.equal(result.achievedInstances, 2);
});

test('labelDensityUnstratified: true when all three cohorts select the identical dbId set', () => {
  const ranked = rankByDensity([profile(1, 1, [1, 2]), profile(2, 1, [3, 4])]);
  const cohort = selectCohort(ranked, 0.5, 4);
  assert.equal(labelDensityUnstratified({ low: cohort, typical: cohort, high: cohort }), true);
});

test('labelDensityUnstratified: false when low < typical < high weighted density holds and sets differ', () => {
  const low = { status: 'OK', requestedDbIds: [1], weightedDensity: 0.1 };
  const typical = { status: 'OK', requestedDbIds: [2], weightedDensity: 0.5 };
  const high = { status: 'OK', requestedDbIds: [3], weightedDensity: 0.9 };
  assert.equal(labelDensityUnstratified({ low, typical, high }), false);
});

// Regression tests added after this task's own codex-review pass surfaced (and this task
// independently reproduced) a real provenance-tracking defect: when the narrow band cannot reach
// k and selectCohort widens to the full ranked population (§5.4 step 6), the returned result must
// report THAT provenance faithfully -- not the original selectBand() verdict, and not a now-stale
// `replacement` record from a narrow-band swap the widened walk no longer applies.

test('selectCohort: successful widen to the full population is reported as bandWasAllOfL', () => {
  // dbId 1 is the lowest-density entry (rank 0) and owns the ONLY unique fragment; every other
  // dbId (2..100) shares ONE common fragment, so no band excluding dbId 1 can ever reach k=2.
  // quantile 0.5 / k=2 gives a band (w=25) that does NOT include rank 0 -- reaching k requires
  // widening to the full 100-entry population.
  const profiles = [profile(1, 1, [5000])];
  for (let i = 2; i <= 100; i++) profiles.push(profile(i, i, [9999]));
  const ranked = rankByDensity(profiles);
  const result = selectCohort(ranked, 0.5, 2);
  assert.equal(result.status, 'OK');
  assert.deepEqual(result.requestedDbIds, [1, 2]);
  assert.equal(result.bandWasAllOfL, true, 'the achieved selection came from the widened full population, not the original narrow band');
});

test('selectCohort: a forced replacement made stale by widening is not carried forward', () => {
  // dbIds 1-34 sit outside the natural high-quantile band, each with a unique fragment. dbIds
  // 35-59 form the natural band and ALL share one fragment (so the band, even with 999999 forced
  // in, can never exceed 2 shared instances). Widening to the full population is required to
  // reach k=5, and that widened walk necessarily re-includes dbId 35 (the very member
  // forceIntoBand had "replaced" out of the narrow band) on its way to the forced entry.
  const profiles = [];
  for (let i = 1; i <= 34; i++) profiles.push(profile(i, i, [5000 + i]));
  for (let i = 35; i <= 59; i++) profiles.push(profile(i, i, [7000]));
  profiles.push(profile(999999, 10.5, [8888])); // forced: natural rank ~10, outside the band
  const ranked = rankByDensity(profiles);
  const result = selectCohort(ranked, 0.9, 5, { forceDbId: 999999 });
  assert.equal(result.status, 'OK');
  assert.equal(result.bandWasAllOfL, true);
  assert(result.requestedDbIds.includes(35), 'the previously-"replaced" dbId legitimately reappears once the walk widens to the full population');
  assert.equal(result.replacement, null, 'a replacement record describing a narrow-band swap the widened walk no longer applies must not be carried forward as if it still described the returned cohort');
});
