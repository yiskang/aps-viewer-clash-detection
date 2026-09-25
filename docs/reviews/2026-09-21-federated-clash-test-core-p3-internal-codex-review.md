# Federated Clash Test core — P3 internal Codex review (targeted) and implementation record

- **Date:** 2026-09-21 · **Branch:** `feature/federated-clash-test-core-engine` · **Scope:** P3 planner only (`clashtest/planning/*.js`, `test/clashtest/planning/*.test.mjs`, `test/clashtest/support/{syntheticModels,bruteForcePairs}.mjs`), per project `CLAUDE.md` internal-review boundary. P0/P1/P2 were not re-reviewed. No spec change was proposed or made.
- **Tool:** `codex-advisor`, effort `medium`, one whole-phase pass over the finished P3 (request `20260921-220951-58809-21187`; raw response in the gitignored `.codex-worker/responses/`). Earlier per-task consults during implementation (P3.3/3.4, P3.5/3.6, P3.7/3.8, P3.9) are listed under "Per-task consults".
- **Status:** internal review only — **not** the independent Work review/adjudication gate that the owner requires before P4.

## Findings and dispositions

Each finding was reproduced/checked against the frozen spec, P5's pinned shapes and the code before acceptance.

| # | File | Severity (Codex) | Finding | Disposition |
| --- | --- | --- | --- | --- |
| C1 | `ElementEnumerator.js` `validateResolveRootsResult`, `rootResolution.js` | High | An explicit-scope answer whose roots (or `unresolved` ids) were never requested was accepted: A asks `1`, the enumerator answers root `2`, union `[2,3]` → `planned`, source `[2]` materialized, the selected root omitted (false-clean). The conformance helper had the subset check; production planning did not. | **Accepted, fixed.** The validator (which already receives the scope) now rejects `root-not-requested`, `unresolved-not-requested` and `resolved-and-unresolved`; `resolveSelectionRoots` surfaces it as `enumeration-failed / invalid-answer`. Tests: validator unit test + a production-path test through `resolveSelectionRoots`. |
| C2 | `ElementEnumerator.js` | High | A whole answer `{unreachable:{count:0, ownerDbIds:[99], …}}` passed validation and `rootResolution` (which keys on `count`) then recorded no `unreachablePopulation` row, suppressing the claim-blocking exclusion. Digests were accepted with any `sha256:` prefix. | **Accepted, fixed.** `ownerDbIds.length > count` → `owners-exceed-count`; `ownerMismatch.first20` may not exceed `count`; digests must match `/^sha256:[0-9a-f]{64}$/` (same pattern P1 `ids.js` and P5 use). Tests: validator + production-path test; the earlier short-digest fixtures were replaced by real-format digests. |
| C3 | `ledger.js`, `planTables.js`, `rootResolution.js`, `planner.js` | Medium | Multi-class planning admission was not atomic: `buildRootTables` admitted `root-table` then refused `root-owner`, leaving `planRecords` at the partially admitted count with no retained records (ghost accounting; the existing test pinned it). | **Accepted, fixed.** New `budget.admitPlanBlock([[cls, n], …])` preflights the whole block cumulatively and commits once; the first refusing class names `planOverflowClass`. All three multi-class call sites use it. Tests: two `admitPlanBlock` tests; the `planTables` test now asserts `planRecords === 0` after a refusal. |
| C4 | `rootResolution.js` | Medium | `libraryExclusions` never contained `hierarchy-internal`, although spec §6.6 item 3 says it is declared **iff** the hierarchy-internal table is non-empty (A=B=whole with a multi-owner root produced a non-empty table and `libraryExclusions: []`). | **Accepted, fixed.** `libraryExclusions` = `['hierarchy-internal']` iff the table is non-empty, plus `'tree-unreachable-population'` when applicable, in code-unit order. Tests: hierarchyInternal test asserts it; the unreachable-population test's expectation updated. |
| C5 | tests | Medium | Weak oracles: the sizing "target order independence" test used a fixture that sorts targets, so it could not fail; `ElementEnumerator` tests pinned short digests; nothing asserted `libraryExclusions` for hierarchy-internal; no production-path explicit-root-outside-scope test. | **Accepted, fixed.** The sizing test now asserts the true contract (sizing follows the cell's order; canonical ordering is `decompose.js`'s, and whole-plan order independence is pinned by the sensitivity-checked property suite). Digest fixtures, exclusions and production-path tests added as above. |

Mutation checks of the fixes (backup with `cp`, restored, diff-verified): removing the root-not-requested check (3 tests fail), the `owners-exceed-count` rule (2), the digest pattern (1), the `hierarchy-internal` exclusion (2) and the block-atomic commit (3) are each caught.

Codex reported **no concrete defect** in: three-cell exact cover, ordered mode, sentinel eligibility, hard target caps, root-boundary splitting, child `pairSpaceWeight` partitioning, R8 live split admission, reserved taint-overflow slots, `materializeUnit.scopeExpect`, or the P5-pinned `Ledger`/`UnitRecord` key shapes.

The loop was stopped after this single round (convergence rule); the fixes were verified mechanically (targeted suites, mutation checks, the full suite), not by a further Codex round.

## Per-task consults during implementation (all dispositioned by the implementing agent)

- P3.3/P3.4: phantom roots, `undefined` unit ids aliasing one reserved slot, non-sticky first refusal — fixed with regression tests.
- P3.5/P3.6: two answers to the same scope with different root sets were misreported as `hierarchy-overlap` — now `enumeration-failed / root-set-disagreement`. No defect in `decompose.js`.
- P3.7/P3.8: `recordPlanning` accepted rows repeated by `modelKey`/`rootDbId`; `durationMs`/`occurrences` were not checked as safe integers — fixed. No defect in split atomicity, taint collapse or sizing.
- P3.9: `sizeUnits` built the full cross product before the unit cap was checked (fixed with `sizeUnits({limit})`); an explicit-list source wrongly produced a population `scopeExpect` (fixed per §16.3.2/AC-8). No hole in cancellation/partial-ledger handling (one synchronous commit after the last checkpoint).

## Open items carried forward (not findings against P3)

1. **Cross-phase (P5), High if left:** P5's schema bounds the whole `taints[]` array by `RUN_OPTION_CEILINGS.maxElementTaintsPerUnit` (`p5-result-set.md` ~L1438), while spec §12.2.1 and the P3 ledger bound only the **element** entries by that option and keep target-model / unit / overflow entries exact on top. At the 100,000 ceiling a legitimate unit could fail P5's own validation. Fix belongs in P5 (ceiling ≥ `maxElementTaintsPerUnit` + slack); changing `addTaint` would change the spec's exactness promise. To be resolved when P5 is authorized.
2. `resolveSelectionRoots` builds its per-model structures before admitting them to the budget; they are bounded by the enumerator's own answer, so P3.5 was left alone (observation).
3. P3.5's tests were written after its code (all green first run); compensated with the mutation checks listed in the agent record. P3.6–P3.9 were RED-first.
4. `ledger.budget` (read-only getter) and `sizeUnits({limit})` are additive P3 surface added in P3.9 because P6 hands `planRun` only the ledger (A17).

## Deviations from the plan text (for the independent reviewer; the implementation is authoritative)

1. **Validators/conformance stricter than the sketch** (`ElementEnumerator.js`): digests must be `sha256:<64 hex>`; `ownerMismatch`/`unreachable` cross-field checks; roots-not-ascending reported once; every port call in `checkEnumeratorConformance` is wrapped (a throw is reported, never thrown); cancellation uses the real `EnumerationCancelledError` (sync throw and async rejection); the optional `checkpoint` hook argument (undefined in the plan) runs inside every counted checkpoint.
2. **`scopeDigest.js`**: `encodePopulationRecords` throws `TypeError` on an unknown class/bad `fragId`/incomplete `L` record; `compareScopeExpectation`/`checkScopeBracket` fail closed as `unverifiable` (new detail codes `malformed-expectation`, `malformed-observation`) instead of throwing; `checkScopeBracket` requires a `Map` of bindings (loud `TypeError` on a plain object).
3. **Budget** (`ledger.js`): bad limits/sizes throw `TypeError`; `consumeReservedSlot` throws `RangeError` when no slot is left (the sketch returned `true`); `admitRuntime`'s `unitId` is optional; `admitPlan*` also refuse past `maxLedgerRecords`. `recordUnit`/`recordGap`/`recordPlanning` allocate nothing — the **planner** charges (`admitPlanBlock` for unit-record/unit-range/planning-gap; `resolveSelectionRoots` and `buildRootTables` charge their own rows).
4. **`buildRootTables`**: also returns `rangeOfClass`; rejects structurally bad roots (duplicate/non-ascending roots or owners, `fragmentCount 0`, empty `ownerDbIds`) as `enumeration-failed`.
5. **`rootResolution.js`**: no `issues` field (failures are `{ok:false, cause, detail}`); extra agreement checks (`unreachable`, identical-scope root sets); enumerator throws propagate unwrapped; up to three `resolveRoots` calls per model.
6. **`sizing.js` / `splitting.js`**: no `plan.rowAt` (reads `tableById`); target ranges are ordered `[C, B']`, so flattened order is not globally ascending and slicing follows range order; ledger tests that called `addTaint`/`tryRecordSplit` on unrecorded units now record the unit first (no assertion weakened); a ledger-cap refusal correctly flips `budgetExhausted`/`firstRefusalUnitId`; `recordPlanningGap` charges nothing.
7. **`planner.js`**: the `materializeUnit` sketch used non-existent members (`subtreeDigestOf`, `srcModel.population`); the implementation reads plan tables/`scopeDigests`, and derives the source role from the unit's orientation (an explicit-list source has no population digest, §16.3.2/AC-8); `Plan` additionally exposes `gaps`, `rangeOfClass`, `modelsByKey`; `createPlan` takes the budget from `ledger.budget`; an empty operand emits `{code:'empty-operand'}` (code is an implementation choice) charged as one `planning-gap`; a failed `reserveUnitSlots` rejects with `internal-error`.
8. **Property suite**: `projectPlan`/`shuffleModels` (undefined in the plan) were written; ordered pair keys follow the call's (source, target); tight-sizing variant (200 seeds × 2 modes, ≥10 gap and ≥50 multi-unit cases) added.

## Verification (final, after all fixes)

- `node --test test/clashtest/planning/*.test.mjs` → **277 tests / 277 pass / 0 fail**.
- All `test/clashtest` → **594 / 594 pass** (P0 112 + P1 80 + P2 125 + P3 277).
- `node scripts/run-tests.mjs` → **1,720 total / 1,719 pass / 0 fail / 1 todo** (pre-existing KNOWN GAP todo).
- `git diff --check` clean; `git diff --stat -- collision wwwroot package.json package-lock.json` empty; no `collision`/Viewer import under `clashtest/`.
