# Federated Clash Test core — P8 independent implementation review

**Review boundary:** P7 closeout `9747e03` through P8 implementation checkpoint `395d56e` (13 implementation commits). The repository was independently inspected at `72497d10a4a10d410e9c640931c50b479e300981`; `72497d1` contains only the P8 internal-review/convergence record and handoff.

**Governing artifacts:** frozen design `docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`; implementation plan `docs/superpowers/plans/federated-clash-test-core/p8-derivations.md`; prior internal claim `docs/reviews/2026-09-26-federated-clash-test-core-p8-internal-review-and-convergence.md`.

## Verdict

**P8 is not ready for acceptance.** Findings: **0 Critical / 1 High / 2 Medium / 0 Low**.

The High finding is a reproduced false-clean comparison path. It was already mentioned as a deferred minor by the internal review, but its observable result contradicts the frozen design's central `resolved` / `added` safety rule and therefore cannot be deferred as non-blocking. The two Medium findings are public-boundary validation and ownership gaps; they need correction or an explicit disposition before the stable-checkpoint rule in `CLAUDE.md` is satisfied.

## Findings

### High H1 — an overlapping ordered unit can still manufacture a false `resolved` / `added`

**Location:** `clashtest/derive/compare.js:63-74`, especially the ordered `cleanProof` return at line 73. Governing contract: frozen design §15.4 (“covered cleanly” means the pair's roots were actually paired in an evaluated unit) and AC-14; P8 plan Global Constraints, “Fail-closed comparison.”

For ordered semantics, `cleanProof` verifies that the selected covering unit has the pair's first root on its source side, but does not verify that the pair's second root is on that unit's target side. P5's orientation-independent status lookup can select the converse orientation. If a same-model ledger unit overlaps roles — for example source roots `[100, 200]`, target roots `[100]` — the lookup can cover `(100, 200)` via source `200` → target `100`; the P8 guard then also sees `100` in the overlapping source set and accepts the absence as clean even though target root `200` was never evaluated.

The direct probe produced:

```text
resolved: 1
removedUnverifiedNext: 0
```

for a base containment result `(100, 200)` and a next set with that overlapping unit and no result. The mirror path can similarly produce false `added`. This is not only a malformed-object typing issue: the internal review records that the planner guarantees role disjointness but `validateResultSet` does not enforce it, while standalone derivations deliberately do not run full validation. A caller-visible positive absence therefore rests on an unchecked assumption.

**Classification:** implementation correctness blocker.

**Minimum correction:** keep the correction P8-local. For ordered clean proof, require both (1) the first root is in the covering unit's source scope and (2) the second root is in the covering unit's target scope, respecting target model and whole-model/root scope. Add mirror regressions for `resolved` and `added` using an overlapping unit. This does not require changing P5, reopening the frozen design, or changing the public API.

### Medium M1 — derivation option objects are not actually closed at the JavaScript boundary

**Location:** `clashtest/derive/validate.js:4-8` and callers in `clashtest/derive/context.js:34-56`, `clashtest/derive/facets.js:43-54`, and `clashtest/derive/filter.js:30-45`. Governing contract: P8 plan Global Constraints, “Closed options”; frozen design AC-13 method-options requirement.

`assertClosed` uses unguarded `Object.getPrototypeOf` and `Object.keys`. Consequently:

- a symbol-keyed unknown option is accepted;
- a non-enumerable unknown string key is accepted;
- a throwing `getPrototypeOf` proxy escapes as the caller's raw error;
- accessor properties are later invoked by ordinary property reads instead of being refused as non-data properties.

All four differ from the established engine boundary, which uses guarded descriptor reads and `Reflect.ownKeys` (`clashtest/engine.js:211-237`, `1225-1251`). The direct probes confirmed both unknown-key acceptance cases and the raw proxy error.

**Classification:** implementation-compatibility issue.

**Minimum correction:** replace the derivation helper with the same guarded, descriptor-based closed-bag pattern used by the engine: accept only plain objects, inspect all own keys with `Reflect.ownKeys`, reject symbols/unknown keys and accessors as `InvalidOptionsError`, and read each allowed data property once. Add context, method-option, facet-spec, and filter-clause regressions. No design change is needed.

### Medium M2 — filter operands remain caller-owned and cycle-unsafe after validation

**Location:** `clashtest/derive/validate.js:19-24` and `clashtest/derive/filter.js:30-45,64-66`. Governing contract: frozen design D12/§14.4 (pure deterministic derivations) and P8 plan P8.5 (“Clause validation (all `InvalidOptionsError`)”).

`isJsonValue` recursively walks caller objects without cycle detection or a bounded owned capture, and `parseClause` retains `c.value` by reference. Two direct probes demonstrate the consequences:

- a cyclic `eq` value rejects with a raw `RangeError`, not `InvalidOptionsError`;
- mutating `{modelKey:'M', dbId:100}` to `dbId:999` immediately after calling `filter` changes a one-match result to zero matches, because the asynchronous runner observes the later caller mutation.

The clause-count cap does not bound the size, depth, getter behavior, or traversal cost of each operand. This does not corrupt a Result Set, but it weakens determinism and the promised typed validation boundary.

**Classification:** implementation-compatibility issue plus verification gap.

**Minimum correction:** during synchronous preparation, capture each `eq`/`in` operand into owned JSON-safe data (or an owned canonical comparison key), refuse cycles/accessors/unreadable objects as `InvalidOptionsError`, and test post-call mutation isolation. If a new public operand-size ceiling is required rather than an internal bounded capture rule, record that narrow owner decision instead of silently inventing one.

## Verification

- Focused P8 plus touched engine suites: **135 / 135 passed**.
- Full repository suite with local ephemeral-port permission: **2,715 total / 2,714 passed / 0 failed / 1 pre-existing todo**.
- A first sandboxed full run had only the three known local-port `EPERM` failures; rerunning with the required local-port permission removed all three.
- Direct H1 reproduction: false `resolved` observed as described above.
- Direct boundary probes: symbol and non-enumerable unknown keys accepted; hostile prototype proxy escaped its original error; cyclic filter operand produced `RangeError`; post-call operand mutation changed the filter result.

Passing suites do not clear H1 because the existing ordered comparison tests cover converse orientation with disjoint planner-shaped units, not an overlapping source/target scope.

## Confirmed sound areas

- The public surface is correctly limited to `createDerivationContext` and `engine.derivations`; no free-standing derivation or annotation surface leaked.
- Per-context concurrency, slot-before-Result-Set-capture, cancellation, disposal, scheduler binding, and host callback error identity behave as planned.
- Built-in facet semantics, group/filter truth rules, deterministic group identities, incremental membership counting, summaries, PairId merge, pair-semantics gate, tolerances, identity conflicts, and O(n+m+ledger) operation-count evidence are covered and passed.
- P8 did not consume `provenance.models[].elementCount`, start Viewer/OQ-4 integration, implement annotations, add remote persistence, freeze calibration defaults, or reopen M4 Phase 4.

## Preserved gates and non-blocking carry-forwards

- P5's standalone ordered `getPairStatus` / `getElementStatus` orientation issue remains an owner decision; H1's minimum correction is deliberately P8-local.
- `groupBy` finalization/sort remains the explicit plan Gate item 1 under AC-12/G-CAL; no new wall-clock claim is made here.
- Attribute snapshot support remains excluded, so mixed-type attribute ordering stays latent until the annotation follow-up.
- Both-null definitions and other semantically forged raw sets remain within the frozen spec's declared non-validating-derivation trust boundary; this review does not reopen that boundary generally.

## Required next step

Perform a targeted P8 remediation for H1 and M1/M2, add the cited regressions, rerun the focused and full suites, then request a focused independent re-review of only those corrections and their directly affected invariants. P8 remains unaccepted, and no phase beyond P8 is authorized.
