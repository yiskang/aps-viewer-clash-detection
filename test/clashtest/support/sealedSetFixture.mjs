// test/clashtest/support/sealedSetFixture.mjs
//
// P6.7's minimal double for a SEALED P5 Result Set's provenance (spec 13.2) — just enough for
// `getFreshness`/`sealedScopeExpect` (clashtest/run/freshness.js) to read: `provenance.models[]`
// with `modelKey`, `modelVersion`, `bindingGeneration`, `placementGeneration` and `scopeDigests`
// (`{population, roots}`), plus `provenance.scopeProof.method: 'bracketed-digest'` (§16.3, checked
// directly by one of freshness.test.mjs's own tests).
//
// `scopeDigests` uses the REAL P5 `ProvenanceModel` shape verbatim (compare `provenanceModel()` in
// resultSetFixtures.mjs) and carries NO extra top-level fields: a fixture this thin still has to
// stay schema-clean, because a caller may run it through `validateResultSet`'s closed-object check
// later. `test/clashtest/run/freshness.test.mjs` builds its OWN live enumerator world by projecting
// `set.provenance.models` (deriving an enumerator model config's `roots`/`population` FROM each
// model's `scopeDigests`) rather than this fixture smuggling extra fields onto the sealed record.
//
// This is NOT a full P5 ResultSet: no `outcome`, `ledger`, `digests` or `results`. P5's claim
// helpers (`assessNoClashClaim`/`canClaimNoClashes`, clashtest/results/claim.js) default every one
// of those with `?? {}`/`?? []`, so a fixture this thin never throws when P6.7's freshness tests
// feed it straight into P5's helpers.
export function createSealedSetFixture({ models = [], registrySessionId = 'sess-1' } = {}) {
  const provenanceModels = models.map((m) => Object.freeze({
    modelKey: m.modelKey,
    modelVersion: m.modelVersion,
    bindingGeneration: m.bindingGeneration,
    placementGeneration: m.placementGeneration,
    scopeDigests: Object.freeze({
      population: m.population ? Object.freeze({ ...m.population }) : null,
      roots: Object.freeze((m.roots ?? []).map((r) => Object.freeze({ ...r }))),
    }),
  }));

  return Object.freeze({
    provenance: Object.freeze({
      registrySessionId,
      models: Object.freeze(provenanceModels),
      scopeProof: Object.freeze({ method: 'bracketed-digest' }),
    }),
  });
}
