# P8 (Derivations) — internal review and convergence record

- **Status:** internal review loop CONVERGED; **ready for independent ChatGPT Work review**. P8 is **NOT accepted** — acceptance is the owner's after the independent gate and adjudication.
- **Authorization:** owner message of this session ("Authorize P8 … do not mark P8 accepted yourself"). Plan: [`p8-derivations.md`](../superpowers/plans/federated-clash-test-core/p8-derivations.md).
- **Boundary:** `9747e03..395d56e` (13 commits, branch `feature/federated-clash-test-core-engine`, nothing pushed).
- **Nature of this document:** an internal review record (a review claim, not ground truth). Working artifacts (ledger, briefs, per-task reports, pre-flight scan) live in the git-ignored `.superpowers/sdd/p8-derivations/`.

## Commits

| Commit | Content |
| --- | --- |
| `812109c` | P8.1 fixtures + P5 status-reader consumer test |
| `a3b6031` | P8.2 `DerivationContext`, limits, slots, capture-first, closed options |
| `9c1c827` | P8.3 facets + attribute seam |
| `c875f6e` | P8.4 `groupBy` |
| `183cedf` / `0debd3a` | P8.5 `filter` / P8.6 `summarize` |
| `1bcdcaa` / `82d86de` | P8.7 `compareResultSets` / fix: `sameEnumeration` false when scope digests differ under a version mismatch |
| `8c8bf70` | P8.8 public export + `engine.derivations` binding; flips P7 absence pins |
| `7486d8a` | fix wave: ordered-mode compare guard (C1) |
| `435bbda` | fix wave: placement `unverifiable` on differing model keys; host scheduler/clock errors propagate unchanged |
| `5d18bd0` | fix wave: AC-13 R15-4 operation-count assertion; identical-set + `pointTolerance` boundary tests |
| `395d56e` | fix wave: own-property facet lookup; README value-order note |

## Verification (controller-run at `395d56e`)

- `node scripts/run-tests.mjs`: **2,715 total / 2,714 pass / 0 fail / 1 pre-existing todo** (P7 baseline 2,619 → +96 new tests).
- `node --test test/clashtest/derive/*.test.mjs test/clashtest/engine/*.test.mjs`: 356/356 (reported by the re-reviewer; not re-run by the controller separately).
- Pre-flight scan (opus, read-only): the plan's P8.1–P8.7 code run verbatim against the shipped P0–P7 modules, 81/81.

## Review process and outcome

1. **Pre-flight scan** — 1 High / 5 Medium / 5 Low, all resolved by controller rulings before dispatch (see below).
2. **Task reviews** (P8.1+2, P8.3+4, P8.5+6, P8.7, P8.8) — every dispatch Approved with 0 Critical / 0 Important, except **P8.7: 1 Important** (`sameEnumeration` could be `true` while scope digests differ under a `modelVersion` mismatch) → fixed in `82d86de`, scoped re-review ADDRESSED.
3. **Whole-branch reviews** (opus final reviewer; `codex-review code medium`, request `20260925-155933-2677-445`):
   - **C1 — CRITICAL false-clean, found by the opus reviewer and independently reproduced by the controller:** `compareResultSets` reported false `resolved`/`added` for converse *ordered* (containment) pairs, because P5's `findCoveringUnit` (`clashtest/results/status.js` ~L179) matches coverage in both orientations. Fixed **P8-locally** in `compare.js` (`7486d8a`) — see ruling 4.
   - Codex #1 (host scheduler/clock `TypeError` remapped to `CorruptResultSetError`) — accepted, fixed (`435bbda`).
   - Codex #2 (`placement: 'same-generation'` although model-key sets differ) — accepted, fixed (`435bbda`).
   - Codex #3 (`groupBy` finalization unsliced/unabortable near the 1M-membership ceiling) — **rejected as a new finding**: already recorded as plan Gates item 1 and owned by the AC-12/G-CAL gate; deferred.
   - AC-13 R15-4 operation-count assertion was unasserted (title overpromised) — fixed with a real, mutation-tested assertion (`5d18bd0`).
4. **Scoped re-review of the fix wave** (opus): F1–F5 all ADDRESSED, 0 open, mutation-tested (guard / placement / host-callback wrapping / `finally` / op-count scan / `hasOwn` reverts each fail a test).

Convergence: no known Critical/High blocker remains at the P8 abstraction level. No unrestricted re-review was restarted after the fix wave (project `CLAUDE.md` review-boundary rule).

## Rulings recorded (also in the SDD ledger)

1. **R-1** — P8.8 additionally edits `test/clashtest/engine/construction.test.mjs` (key-set pin + excluded-names loop; 3 lines): the plan's OPEN-3 ruling flips `derivations` absence pins, and this is the same class the plan did not name. Test-only, revertable.
2. **R-2/R-3/R-8/R-9** — P8.8 applied by the plan's intent (the plan's quoted `exports.test.mjs` diff did not match the shipped file); engine key inserted in `createEngineCore` with the resolved scheduler `engineYield`; no duplicate `captureResultSet` import; stale comments updated; one stale line in `clashtest/README.md` replaced.
3. **R-4** — `diagnostics.countsByReason` uses the shipped array-of-rows shape (the plan showed an object).
4. **C1 ruling** — accepted P5 code is **not** edited. A P8-local guard makes `compareResultSets` fail closed for ordered semantics (a `covered-clean` verdict counts only if the covering unit's source side is the pair's first element; otherwise the pair lands in the unverified classes). The underlying P5 defect is an **owner-decision carry-forward** (below).
5. Misc: fail-closed `isAbortSignal` in `derive/validate.js`; non-function `now`/`yieldToScheduler` rejected at construction; P8.1 RED unobservable (P5 already shipped) — replaced by a sensitivity check.

## Carry-forwards / deferred (none block the independent gate)

- **OWNER DECISION — P5 `getPairStatus`/`getElementStatus` over-report coverage for *ordered* pairs** (`status.js` `findCoveringUnit` checks both orientations). Reproduced: after swapping selections, `getPairStatus(c2,(100,200))` is `covered-clean` though c2 only asked the converse containment question. `compareResultSets` is protected by the P8-local guard; **standalone public `getPairStatus`/`getElementStatus` (and P5 consumers such as `groupBy`'s `caveated` facet / `summarize` are believed unaffected because they only query pairs present in their own set) are not fixed.** Fixing it means reopening accepted P5 — not authorized. Spec AC-14(iii)'s "each verified through `getPairStatus`" wording no longer matches what compare reports for converse pairs (compare is stricter).
- Deferred minors: forged same-model unit with overlapping source/target roots could still produce a false `resolved`/`added` in ordered mode (the planner guarantees disjointness; `validateResultSet` does not enforce it; hardening = also require the target to cover `pair.second`); both-definitions-`null` set bypasses the guard/semantics gate (malformed input only; derivations do not validate per §13.6); `groupBy` finalization unsliced (**plan Gates item 1 / G-CAL**); `compareFacetValues` non-total for mixed types/NaN (latent — attribute facets unavailable); near/`nearPoint` accept non-numbers (can only yield a false `unchanged`); assorted test-title/coverage minors (ledger m1–m16, M-list).
- Gates honored: **G-EC** (no code in `clashtest/derive/` reads `provenance.models[].elementCount`), **G-CAL** (no wall-clock assertions; caps provisional/overridable), G-OQ4/G-OQ16/G-REMOTE untouched, AC-16 (iii)/(iv) deferral untouched, R-2 untouched (no coordinator change), annotation layer excluded (attribute facets always `unavailable`; no `engine.annotate`).
- P0–P7 code touched only by the ruled P8.8 edits: `clashtest/engine.js` (one import, one key, comment), `clashtest/index.js` (one export line, comment), `clashtest/README.md` (one line + value-order note), `test/clashtest/engine/exports.test.mjs`, `test/clashtest/engine/construction.test.mjs`.
