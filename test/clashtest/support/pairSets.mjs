// test/clashtest/support/pairSets.mjs
//
// P7 (Task P7.8): the differential ORACLE, shared by differential.test.mjs (Steps 1-10) and the
// real-world provenance/environment files of Steps 11-19. A support module: no `test(...)` calls, so
// importing it registers nothing (support-barrel rule 3). Not appended to support/index.mjs.
//
// Oracle strength is a property of the ARM, not of the mode (review finding M2):
//   'exact'                  -- clean fixture; deepEqual against the brute-force reference
//   'correlated'             -- deliberately caveated fixture; every differing pair is NOT covered-clean
//                               and carries a caveat drawn from the arm's declared `caveatReasons`
//   'characterization-only'  -- the difference is recorded via `record`, nothing is asserted about it
// A CLEAN run is always held to 'exact', whichever branch the arm asked for.
import assert from 'node:assert/strict';
// `createStatusReader` is not on the §18 public surface (index.js re-exports only the one-shot
// `getPairStatus`/`getElementStatus`), so this imports P5's module directly -- still P5's reader,
// never a P7-local one (duplicate-ownership D4).
import { createStatusReader } from '../../../clashtest/results/status.js';

// The differential oracle. Review finding M2: EXACT by default, and a difference is admissible only on
// an arm that declares why (see the brief's oracle-strength table).
export function assertPairSets(actual, reference, { mode, resultSet, expect, caveatReasons = [], record }) {
  const { outcome, diagnostics } = resultSet;
  // A CLEAN run: nothing the engine recorded can license a difference. §15.1 scopes its
  // no-repeatability licence to caveated runs, never to a mode.
  const clean = outcome.environmentSensitive === false
    && diagnostics.completenessAffectingUpperBound === 0
    && diagnostics.unclassifiedOccurrences === 0;
  if (expect === 'exact' || clean) {
    assert.deepEqual(actual, reference, `${mode}: a clean run must equal the brute-force reference `
      + `(environmentSensitive=${outcome.environmentSensitive}, `
      + `completenessAffectingUpperBound=${diagnostics.completenessAffectingUpperBound}, `
      + `unclassifiedOccurrences=${diagnostics.unclassifiedOccurrences})`);
    return;
  }
  const symmetricDifference = [
    ...actual.filter((p) => !reference.includes(p)),
    ...reference.filter((p) => !actual.includes(p)),
  ];
  if (symmetricDifference.length === 0) return;          // equality is always acceptable
  if (expect === 'correlated') {
    // A deliberately caveated fixture: EACH differing pair must be inside the run's own caveated
    // scope, read from the sealed set through P5's status reader.
    const reader = createStatusReader(resultSet);
    for (const key of symmetricDifference) {
      const status = reader.pairStatus(JSON.parse(key));  // pairIdKey is canonicalJson(pairId)
      assert.notEqual(status.verdict, 'covered-clean',
        `${mode}: ${key} differs from the reference yet the sealed set calls it covered-clean`);
      assert.ok(status.caveats.some((c) => caveatReasons.includes(c.reason)),
        `${mode}: ${key} differs with no caveat drawn from ${JSON.stringify(caveatReasons)} `
        + `(caveats: ${JSON.stringify(status.caveats)})`);
    }
    return;
  }
  // A MEASUREMENT, not a proof: only an arm that says so in its own name may use it.
  assert.equal(expect, 'characterization-only');
  record(`${mode}: CHARACTERIZATION ONLY -- ${symmetricDifference.length} pair(s) differ under `
    + `${JSON.stringify(outcome.environmentSensitiveCauses)}; this arm does NOT prove decomposition `
    + `equivalence: ${JSON.stringify(symmetricDifference)}`);
}
