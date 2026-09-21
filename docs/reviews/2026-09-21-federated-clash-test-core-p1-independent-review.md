# Federated Clash Test core — P1 independent implementation review

- **Date:** 2026-09-21
- **Reviewed checkpoint:** `fbe09cd` (`feat(clashtest): P1 identity (ids, ModelRegistry, lease-world test support)`)
- **Branch:** `feature/federated-clash-test-core-engine`
- **Scope:** P1 identity only: `clashtest/identity/{ids,ModelRegistry}.js`, P1 identity tests, lease-world support, the P1 plan/status record, and directly governing frozen-design contracts. P0 and future P2+ implementation were not reopened.

## Verdict

**No Critical or High finding. One Medium and one Low finding require targeted adjudication before P2 authorization.** P1's central identity, registry-generation, lease, placement, and deterministic-ID behavior is implemented and well covered. The findings are bounded helper-contract issues; neither requires reopening the frozen design.

## Findings

### Medium — the registry/world assertion accepts an incomplete object as a conforming registry

**Location:** `clashtest/identity/ModelRegistry.js`, `REGISTRY_METHODS` and `assertRegistryBelongsToWorld` (lines 272–287).
**Contract:** the P1 phase interface says the helper throws unless `registry` is a registry built for exactly `world`; the same phase exposes `keyOf`, `isBindingCurrent`, `invalidateModelPlacement`, `registryRevision`, and the rest of the `ModelRegistry` surface for P6/P7 consumers.

The structural check requires only five methods plus a string session id and matching `world`. It does not require `keyOf`, `isBindingCurrent`, `invalidateModelPlacement`, or a numeric `registryRevision`. A plain object containing only the checked members is accepted even though it cannot satisfy the P1 registry interface. Mechanical reproduction at the checkpoint:

```text
assertRegistryBelongsToWorld({
  world, registrySessionId: 'x',
  register(){}, unregister(){}, bindingFor(){}, snapshotBindings(){}, notifyPlacementChanged(){}
}, world) // accepted
```

**Concrete failure mode:** a later coordinator path that adopts or otherwise trusts an asserted registry can fail only when it reaches an unchecked P6/P7 operation, rather than rejecting the incompatible registry at the boundary with `ModelBindingError('registry-mismatch')`. This is especially relevant because the P1 plan deliberately avoids `instanceof` to support a duplicate module copy.

**Type:** implementation-compatibility issue.
**Minimum correction:** keep the structural/duplicate-module approach, but validate the complete registry surface consumed by later phases (including the missing methods and read-only fields), normalize a failed/throwing structural probe to `ModelBindingError('registry-mismatch')`, and add one incomplete-registry regression test. A stronger shared brand is optional, not required for this bounded correction.

### Low — `bindingsEquivalent` treats malformed nullish or empty values as valid equal bindings

**Location:** `clashtest/identity/ModelRegistry.js`, `bindingsEquivalent` (lines 264–271); the current snapshot test explicitly expects `bindingsEquivalent(undefined, null) === true`.
**Contract:** the P1 phase interface says bindings are equal iff both are `null`, or both carry equal key, Model object, version and generations.

Current behavior collapses `undefined` into `null`, and two empty objects compare equal because every compared field is `undefined`:

```text
bindingsEquivalent(undefined, null) === true
bindingsEquivalent({}, {}) === true
```

**Concrete failure mode:** an out-of-range snapshot access or malformed foreign registry result can be classified as an unchanged missing binding instead of failing closed. Valid `Binding|null` callers are unaffected, which limits severity.

**Type:** implementation-compatibility issue / verification gap.
**Minimum correction:** return true only for `null`/`null`; return false for one null or any malformed binding; compare fields only after both operands satisfy the Binding shape expected by P1. Replace the test that blesses `undefined`/`null` equality with malformed-input rejection/fail-closed cases.

## Confirmed sound areas

- `ElementRef`, `PairId`, and `ResultId` implement the frozen identity model: closed durable element identity, code-unit ordering, unordered/ordered pair semantics, delimiter-safe canonical ResultIds, and no runtime Model/lease/generation leakage.
- `elementRefKey` is injective and order-preserving; an additional exhaustive probe over 294 refs containing NUL, U+0001, ASCII, lone surrogates, and boundary dbIds found no ordering or collision failure.
- Registration enforces first-seen `modelVersion`, one live Model per key and one key per live Model, atomic rejected registration, late-unload object identity, and monotonic binding/placement generations.
- Binding reads are synchronous and coherent under the tested re-entrant mutation cases; leases are lazy, cached, checked, and fail closed. Placement invalidation bumps before the world call, as the accepted P1 plan specifies.
- The lease-world fake matches the real `CollisionWorld` on the exercised public lifecycle surface. P1 stays within its authorized module boundary and does not implement Viewer/OQ-4, host integration, persistence, P2, or another gated scope.

## Verification

- P1 suite: `node --test test/clashtest/identity/*.test.mjs test/clashtest/support/leaseWorld.contract.test.mjs` → **78 pass, 0 fail**.
- Repository runner: `node scripts/run-tests.mjs` → **1,316 total; 1,312 pass; 3 sandbox-only `EPERM` failures in the pre-existing M4 spike-server bind tests; 1 pre-existing todo; no P1 failure**. The committed handoff records the corresponding unrestricted run as 1,315 pass / 0 fail / 1 todo.
- `git diff 3b73d45..fbe09cd --check` → clean.
- Working tree was clean before this review artifact and handoff update.

## Gate result

`P1 checkpoint ready for targeted adjudication; P2 remains unauthorized until the Medium and Low findings and this gate verdict are adjudicated under CLAUDE.md.`

No production code, test, plan, or frozen specification was modified by this review.
