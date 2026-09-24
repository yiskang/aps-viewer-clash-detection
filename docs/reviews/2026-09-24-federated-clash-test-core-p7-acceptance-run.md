# P7 core acceptance run (Task P7.11, Steps 1–4): evidence record

- **Date:** 2026-09-24 (original run), rerun the same day after the targeted fixes, and rerun #2 the same day after owner rulings #4.
- **Branch / HEAD:** `feature/federated-clash-test-core-engine`. Original run at `82245b4baa570598269a2c2b6f357a9ebfa77493` (recorded in `ba46e66`). Rerun #1 at `e0be33aee358719028a0f60d357cecfb4e0c2060`. **Rerun #2 at `56d591a4f34402dd0286e4603c85baff82898d84`.**
- **Governing plan:** `docs/superpowers/plans/federated-clash-test-core/p7-engine-integration.md`, Task P7.11 (Steps 1–4 only; Steps 5–7, meaning the handoff, the ready-for-gate mark and any commit, belong to the controller).
- **Scope:** evidence only. No production code, test, plan, spec or handoff was edited, and nothing was committed. This file is the only write (updated in place by the rerun).
- **Environment:** Node `v22.23.1`, darwin. `npm test` is `node scripts/run-tests.mjs` (package.json line 12), so the two are the same command and it was run once per pass.
- **How to read this file.** The *Rerun #2* section directly below is the current evidence. The rerun #1 section after it (at `e0be33a`) and the original run (at `82245b4`) are kept as evidence. Facts in rerun #1 that rerun #2 changes are marked **[SUPERSEDED — see rerun #2]**; facts in the original run that rerun #1 changed are marked **[SUPERSEDED — see rerun]**.

## Rerun #2 after owner rulings #4 (D-8b/D-8c, D-9, PD-1..PD-4)

Scope as before: evidence only. This file is the only write; no production code, test, plan, spec or handoff was edited, and nothing was committed. Only the checks materially affected by the changes below were re-run.

### What changed since rerun #1 (`e0be33a` → `56d591a`)

| Item | Commits | State after rerun #2 |
|---|---|---|
| **D-8c** (diagnostic node term) fixed as spec erratum **A13**: the term is now `(24 + maxUnitIdsPerDiagnostic) × maxRetainedDiagnostics` (`clashtest/options.js:43, 75–77, 226`). `SCHEMA_MAX_NODES` = 282,354,376; defaults' worst case = 15,885,536 ≤ 16,000,000; the `maxResultsPerRun` ceiling 956,824 is unchanged. | `a8e684c` (options.js), `1b986d2` (tests), `cc12e58` (spec/plans/evidence §11), `37f0997` (review minors) | **FIXED; task review Approved, with one item needing owner ratification:** A13's form is a closed expression of an existing option, not a fixed constant. The flat alternative (88) would put the defaults at 16,445,536 > 16M, which is a default change. |
| **D-8b** (ledger term) bounded evidence done: verdict **UNSOUND IN FORM**, not applied (stop rule). A fix needs a form change: charge per expanded id, persist ranges (a schema change), or a new cap option. | `1b986d2`; evidence `docs/reviews/2026-09-24-federated-clash-test-core-p7-d8-node-factor-evidence.md` §10–11 | **OPEN (owner).** Standing `test.todo` in `test/clashtest/integration/nodeFactor.ledgerDiagnostic.test.mjs:246`. At the provisional **defaults**, a 10,000-unit plan admits about 100.2M ledger nodes (evidence §11, l.392–393), so the defaults themselves can produce sets the engine cannot read. |
| **D-9** clarification erratum **A12** applied to spec AC-18 (d); P7 plan wording updated. Engine behaviour unchanged. | `fdbaf3a` (spec), `bc432b6` (plan) | **FIXED** (clarified). |
| **PD-1..PD-4** plan reconciliation: AC-6/AC-19 (c) cite the shipped determinism titles; AC-21 and Step 17 cite the two shipped disposal titles; `′` → `'` in the AC-19 b′/d′ titles; P7.11 Step 3(b) command also reads `- Test:` declarations. | `bc432b6` | **FIXED** (re-verified by the walk below). |
| **D-10** (new, **High**; P3 producer / P5 schema): `provenance.models[].scopeDigests.roots` and `ledger.rootOwners[].owners` are capped at 10,000 by the schema, with no producer guard. Reachable at defaults (whole-model scope over a model with 10,001 roots). | `fd93121`; evidence `docs/reviews/2026-09-24-federated-clash-test-core-p7-d10-root-cap-evidence.md` | **OPEN (owner).** Standing `test.todo` plus passing pins in `test/clashtest/integration/rootCap.producerReader.test.mjs` (todo at l.123). |
| **D-11** (production, collision library, pre-P7): `CollisionWorld.js:2231` does not pass the injected `now` to `surfaceIntersectionQuery`, so its 8 ms real-clock abort fires under load → load-dependent `caveated` and a dropped pair (flake A). **D-12**: `ContainmentModeQuery` real-clock default scheduler (`duct through beam`, flake B). | `56d591a`; evidence `docs/reviews/2026-09-24-federated-clash-test-core-p7-suite-flake-investigation.md` | **OPEN (owner; collision library, outside the P0–P7 core).** Not fixed. Idle: 0/12 full-suite failures. Under heavy parallel load: differential 4/48, `ContainmentModeQuery` 38/48. This identifies the "unidentified transient suite failure" that rerun #1 kept as an open observation. |
| **Owner ruling on phase checklists:** P0/P4/P5/P6 acceptance checklists are **not** reopened because later targeted fixes postdate them. | owner rulings #4 | Recorded in Step 4 below; it replaces rerun #1's "checklists predate fixes and were not re-signed" caveat. |

### Rerun #2 Step 1: full suite, three runs, at `56d591a`

Command: `node scripts/run-tests.mjs` (= `npm test`), three times back to back, on a clean working tree.

| Run | exit | tests | pass | fail | cancelled | skipped | todo | duration_ms | wall |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 0 | 2530 | 2527 | 0 | 0 | 0 | 3 | 24621.19 | 24 s |
| 2 | 0 | 2530 | 2527 | 0 | 0 | 0 | 3 | 25322.11 | 26 s |
| 3 | 0 | 2530 | 2527 | 0 | 0 | 0 | 3 | 25817.16 | 26 s |

- The TAP plan line is `1..2488`. Each run has exactly three `not ok` lines, all `# TODO`. **There were no failures in any run, so no failing test name to report.** D-11/D-12 did not manifest in these three idle runs; that is consistent with the flake record (0/12 at idle) and is **not** evidence that they are gone.
- **The three `test.todo`s, as expected:**
  1. `D-8b R21-2: every ledger-heavy option set resolveRunOptions accepts yields a set the same engine reads back` (`test/clashtest/integration/nodeFactor.ledgerDiagnostic.test.mjs:246`)
  2. `D-10 R21-2: every set the engine seals over a >10,000-root model scope is read back by the same engine` (`test/clashtest/integration/rootCap.producerReader.test.mjs:123`)
  3. The pre-existing ContainmentQuery known gap (`test/query/ContainmentQuery.classifyPoint.test.mjs:138`, `{ todo: true }`).
- **§21.3 caveats.** This time the checkout **was clean** (`git status --short` empty before and during the runs). No credentials were used and no server was started. Network isolation was still not independently enforced.

### Rerun #2 Step 2: named suites, run individually (sequentially, machine otherwise idle)

| Command | Role | tests | pass | fail | todo | duration_ms |
|---|---|---|---|---|---|---|
| `node --test test/clashtest/integration/nodeFactor.test.mjs` | D-8 (A11) + A13 regression | 9 | 9 | 0 | 0 | 8570.94 |
| `node --test test/clashtest/integration/nodeFactor.ledgerDiagnostic.test.mjs` | D-8b evidence + D-8c (A13) | 10 | 9 | 0 | 1 (D-8b) | 1989.01 |
| `node --test test/clashtest/integration/rootCap.producerReader.test.mjs` | D-10 pins + reproducer | 6 | 5 | 0 | 1 (D-10) | 2912.87 |
| `node --test test/clashtest/integration/maximumShape.test.mjs` | AC-11/AC-12 R21-2 | 8 | 8 | 0 | 0 | 20882.44 |
| `CLASHTEST_AC12_TIERS=all node --test test/clashtest/integration/maximumShape.test.mjs` | AC-12 opt-in tiers | 10 | 10 | 0 | 0 | 61634.90 |
| `node --test test/clashtest/integration/differential.test.mjs` | master DoD 4 | 25 | 25 | 0 | 0 | 379.47 |
| `node --test test/clashtest/integration/realWorldProvenance.test.mjs test/clashtest/integration/realWorldEnvironment.test.mjs` | T2 evidence (AC-7, 17 b/f, 18 d, 19, 21). **Not DoD 4** | 22 | 22 | 0 | 0 | 556.72 |
| `node --test test/clashtest/planning/planner.property.test.mjs` | master DoD 5 | 7 | 7 | 0 | 0 | 716.43 |
| `node --test test/clashtest/options.test.mjs test/clashtest/options.defaults.test.mjs` | §17.1/§17.1.1, §13.6 invariant at defaults | 32 | 32 | 0 | 0 | 45.12 |

All exit 0.

### Rerun #2 Step 3: AC traceability walk, using the corrected Step 3(b) command

| Pass | Rerun #1 (`e0be33a`) | Rerun #2 (`56d591a`) |
|---|---|---|
| (a) paths exist | 57 distinct / 94 citations, 0 missing | **57 distinct / 94 citations, 0 missing (no output). Pass.** |
| (b) owners | Literal command blind to P3/P5 `- Test:` lines (PD-4); extended script 94/94 | **The plan's corrected command (P7.11 Step 3(b), `bc432b6`), run verbatim with `OUT` in the scratchpad: first line `94`, then zero lines — 0 unowned or misattributed of 94. PD-4 gone. Pass.** |
| (c) titles | 37 `::` citations: 22 verbatim, 7 with tolerance, **8 failing (PD-1 ×2, PD-2 ×1, PD-3 ×5)** | **38 `::` citations** (AC-21 now cites two disposal titles), checked against the file text (with `\'` unescaped) and run 1's `ok` lines: **33 verbatim, 5 with a recorded tolerance, 0 not found.** The tolerances are the same kinds as before: AC-3 `library-call conformance` (substring of the passing title), AC-4 `partition and broad-phase independence (AC-4)` (prefix of two mode-suffixed passing titles), and AC-5, AC-6 and AC-19 (c) (template-literal titles, each exact in the passing output; all four determinism and all four `differential: whole-model target, …` titles are present in run 1). **PD-1, PD-2 and PD-3 are gone.** |

- The one remaining `′` inside the table is prose in the AC-19 row (the "(b′)/(d′)" conjunct labels), not a cited title.
- Lower-phase verification-row ids and the AC-16 named exception: unchanged since rerun #1 (the table's P0–P6 citations and the AC-16 cell were not edited), and every cited file ran in Step 1 with 0 failures. AC-16 stays **ACCEPTED**.

**AC rows: green vs still owner-dependent at `56d591a`.**

| AC row / conjunct | State | Evidence and honest limit |
|---|---|---|
| AC-6, AC-19 (c) | **Green** (citation fixed, PD-1) | The four `determinism: 10 runs on one world and 10 on fresh worlds agree (AC-6), <mode>` titles pass in all 3 runs. Load-dependence caveat: D-11 can make the surface-intersection arm flip under heavy parallel load (flake record: 4/48 differential runs). Not observed in this rerun. |
| AC-19 (b′), (d′) ×4 | **Green** (citation fixed, PD-3) | All five titles verbatim and passing. |
| AC-21 | **Green** (citation fixed, PD-2) | Arm (i) and arm (ii) (`D-C (P6): …`) both cited verbatim and passing. |
| AC-18 (d) | **Green** (D-9 closed by erratum A12) | Spec AC-18 (d) and plan Step 13 / AC-18 row now describe the two-arm control F3 ships; both cited tests pass. |
| AC-11 / AC-12 R21-2 producer/reader invariant | **Not green as a universal claim. Results-heavy term and diagnostic term now sound; ledger term (D-8b) open; D-10 open.** | Sound: the result term (A11, factor 35) and the diagnostic term (A13, `24 + maxUnitIdsPerDiagnostic`; pending owner ratification of its form). `maximumShape.test.mjs` 8/8 and 10/10 with all tiers; `nodeFactor.test.mjs` 9/9; `nodeFactor.ledgerDiagnostic.test.mjs` 9/9 + 1 todo. **Open:** D-8b — the ledger term is unsound in form, and at the provisional defaults a 10,000-unit plan admits ~100.2M ledger nodes, so **the defaults themselves can produce sets the engine cannot read (an R21-2 gap that remains)**. D-10 — **an engine run at defaults can seal a set its own reader rejects** (`array-too-long` → `CorruptResultSetError` on by-id read after release) for a model with more than 10,000 roots. |
| AC-7 tail, AC-17 b/f, AC-10 (indirect) | **Green on behaviour, unchanged since rerun #1** | Proposal **P-5 is still open**: the D-D, D-A, D-B and `R21-2 (D-8)` regressions (and `nodeFactor*.test.mjs`, `rootCap.producerReader.test.mjs`) are still not cited in the AC table (grep of the table: 0 hits for each). |

**Plan / doc wording proposals still open (not applied; the plan and spec are read-only here):**
- **P-5.** Cite the regression tests that now carry fixed conjuncts (AC-7: `D-D (P6): …`; AC-11/AC-12: `R21-2 (D-8): …`, `integration/nodeFactor.test.mjs` and `integration/nodeFactor.ledgerDiagnostic.test.mjs` with an owning phase named; AC-17: `D-A (P5): …`, `D-B (P6): …`), and record D-8b/D-10 in the AC-11/AC-12 *Gated* or *Deferred* cells once the owner disposes of them.
- **P-7.** `p5-result-set.md` l.85 and l.1444, and `p8-derivations.md` l.116, still list `UnreachablePopulation` without `count`.
- P-1..P-4 and P-6 are **applied** (`bc432b6`, `fdbaf3a`).

### Rerun #2 Step 4: DoD checklist

| DoD item | Status at `56d591a` | Evidence / honest limit |
|---|---|---|
| 1. P0–P7 phase acceptance checklists pass (signed) | **P0–P6: by owner record; P7: not accepted** | **Owner ruling (rulings #4):** the P0/P4/P5/P6 acceptance checklists are **not reopened** because later targeted fixes postdate them. For this P7 closeout, the later regression and review evidence **supersedes those historical checklist snapshots where applicable**: the fix commits (P0 options: `e016796` D-8/A11, `a8e684c` D-8c/A13; P4: `c1ff642` D-4; P5: `7514d54` D-A; P6: `b1da763` D-1, `842c637` D-B, `ba48c7e` D-D, `b2c33b4`/`4d9d307` D-C), their task reviews (all Approved), and the regression tests that pass in Step 1 and Step 2 above. This replaces rerun #1's "checklists predate these fixes and were not re-signed" caveat. The plan checkboxes themselves were not edited. P7 itself has no owner acceptance. |
| 2. `npm test` green, clean checkout, no credentials/network | **Green** | 3× 2530 / 2527 pass / 0 fail / 3 todo, from a clean tree. Network was not independently isolated. Load-dependent flakes D-11/D-12 exist in the collision library (not observed here). |
| 3. Every in-scope §22 AC mapped to a passing named test; excluded ACs listed with owner | **Mechanically met; substantively caveated** | Passes (a), (b) and (c) are all clean (PD-1..PD-4 gone). But the AC-11/AC-12 R21-2 conjunct is not proven universally (D-8b, D-10), and P-5 leaves the fixing regressions uncited. The excluded-AC list and owners are unchanged from the original Step 4. |
| 4. Differential = brute force, 4 modes × 4 selections | **Green** | 25/25 (subject to the D-11 load caveat). |
| 5. Exact-cover property test | **Green** | 7/7. |
| 6. Handoff, CHANGELOG, README pointer | **Not verified by this run** | Task P7.10 / controller. |

### Rerun #2: open items

| ID | Status | Detail |
|---|---|---|
| D-1, D-4 | **FIXED** (earlier) | `b1da763`, `c1ff642`. |
| D-8 | **FIXED** as erratum A11 | Unchanged since rerun #1. |
| D-8c | **FIXED** as erratum A13 (`a8e684c`, `1b986d2`, `cc12e58`, `37f0997`); task review Approved | **A13 form ratification pending (owner).** |
| D-A, D-B, D-C, D-D | **FIXED** | Unchanged since rerun #1. |
| D-9 | **FIXED** as clarification erratum A12 (`fdbaf3a`, `bc432b6`) | Engine unchanged. |
| PD-1..PD-4 | **FIXED** (`bc432b6`) | Re-verified in Step 3. |
| D-8b (ledger term) | **OPEN (owner): form change needed** | Unsound in form; the defaults can produce unreadable sets. Standing todo `nodeFactor.ledgerDiagnostic.test.mjs:246`. |
| D-10 (High; P3 producer / P5 schema) | **OPEN (owner)** | Per-model 10,000 root cap in the schema, no producer guard; reachable at defaults. Standing todo `rootCap.producerReader.test.mjs:123`. |
| D-11 (collision library) | **OPEN (owner)** | `CollisionWorld.js:2231` injected-`now` omission → load-dependent `caveated` + dropped pair. Pre-P7, outside the core. |
| D-12 (collision library) | **OPEN (owner)** | `ContainmentModeQuery` real-clock default scheduler flake. Pre-P7, outside the core. |
| A13-form ratification | **OPEN (owner)** | Closed expression of `maxUnitIdsPerDiagnostic` vs a flat constant. |
| D-2, D-3, D-5, D-6, D-7 | **OPEN, unchanged** | As in the rerun #1 table. |
| Plan/doc errata | **OPEN** | `p5-result-set.md` l.85/l.1444 and `p8-derivations.md` l.116 omit `count`; stale "1,000,000 results" comments at `clashtest/results/resultSetSchema.js:324` and `clashtest/results/validateResultSet.js:1482`; `task-P7.8-brief` l.258 scratch. P-5 above. |
| Review minors | **Deferred** | As in rerun #1. |
| P6 carry-overs | Unchanged | §7.1/H7.2/AC-3 diagnostics-overflow spec gate; `Run.js` perf items. |

**Open gates, unchanged:** G-CAL, G-EC, G-OQ4, G-OQ16, G-REMOTE. The AC-16 (iii)/(iv) `migration-failed` deferral stays owner-accepted and non-blocking.

### Rerun #2: git state

- **Branch:** `feature/federated-clash-test-core-engine`. **HEAD:** `56d591a4f34402dd0286e4603c85baff82898d84`.
- **`git status --short` at rerun #2 start:** empty (clean).
- **After rerun #2:** the only change is ` M docs/reviews/2026-09-24-federated-clash-test-core-p7-acceptance-run.md` (this file). Nothing was committed.

### Verdict (rerun #2 at `56d591a`)

P7 implementation complete; owner-ordered fixes applied and reviewed; NOT accepted — open owner decisions: D-8b (ledger form), D-10, D-11/D-12, A13 ratification, deferred notes — and the independent Work review + targeted adjudication is required before P8.

Honest limits of this verdict: D-8b means the provisional **defaults themselves** can produce result sets the engine cannot read (an R21-2 gap that remains), and D-10 means an engine run **at defaults** can seal a set its own reader rejects.

---

## Rerun after targeted fixes (D-8/D-A/D-B/D-C/D-D) — rerun #1, kept as evidence

### What changed since the original record

The owner authorized these fixes (owner rulings #3, 2026-09-24). Each was landed and got a task review with verdict **Approved**: 0 Critical, 0 Important (`.superpowers/sdd/p7-engine-integration/progress.md` l.131–133, `review-X.md`, `review-Y.md`, `review-Z.md`).

| Item | Owner phase | Commits | Review |
|---|---|---|---|
| D-A: persisted `UnreachablePopulation` accepts and validates `count` | P5 | `7514d54` | Task Y, Approved |
| D-B: `unreachableOwner` reserved for unreachable-only owners, not mixed owners | P6 | `842c637` | Task Y, Approved |
| D-8: spec erratum A11, ClashResult node factor 24 → 35, `maxResultsPerRun` ceiling 1,000,000 → 956,824 | P0 / spec §13.6, §17.1.1 | `e016796` (code and tests), `ab01fcd`, `03fdf52`, `e0be33a` (spec, plan and record) | Task X, Approved |
| D-D: a cancel first seen after `planRun` resolved seals the valid no-unit-ledger cancelled shape | P6 | `ba48c7e` | Task Z, Approved |
| D-C: world disposal with a cancel pending inside a planning slice seals `failed:world-disposed` (AC-21 (ii)) | P6 | `b2c33b4`, `4d9d307` | Task Z, Approved |

- **Standing todos flipped to passing tests.** These are D-8 (`maximumShape.test.mjs`), D-A and D-B (`realWorldProvenance.test.mjs`), and D-D and D-C (`realWorldEnvironment.test.mjs`). The D-C title was renamed from `D-C (owner): …` to `D-C (P6): …`.
- **File renamed.** `integration/nodeFactor.evidence.test.mjs` is now `integration/nodeFactor.test.mjs`, a permanent regression.
- **D-9.** A targeted adjudication exists: `docs/reviews/2026-09-24-federated-clash-test-core-p7-d9-ac18d-adjudication.md`, verdict **A**. The "single call" is a test mechanism, and F3 satisfies the invariant's intent. Its proposed wording edits were **not applied**, and the owner decision is pending.
- **Tables and declarations unchanged.** `git diff ba46e66..HEAD` shows that the P7 plan's AC traceability table (l.2000–2033) and every phase's `Create`/`- Test:` declarations are unchanged. The P7 plan changed only at l.1783 and l.2130 (A11 arithmetic).

### Rerun Step 1: full suite, three runs, at `e0be33a` **[SUPERSEDED — see rerun #2]** (now 2530 / 2527 / 0 fail / 3 todo)

Command: `npm test`, three times back to back.

| Run | exit | tests | pass | fail | cancelled | skipped | todo | duration_ms |
|---|---|---|---|---|---|---|---|---|
| 1 | 0 | 2514 | 2513 | 0 | 0 | 0 | 1 | 23761.95 |
| 2 | 0 | 2514 | 2513 | 0 | 0 | 0 | 1 | 24459.10 |
| 3 | 0 | 2514 | 2513 | 0 | 0 | 0 | 1 | 23982.54 |

- The TAP plan line is `1..2472`. Each run has exactly one `not ok`, and it is the `# TODO` below. **There are no failing test names to report.**
- **Remaining `test.todo`s: 1, as expected.** **[SUPERSEDED — see rerun #2]** (3 at `56d591a`: D-8b, D-10 and this one) It is the pre-existing ContainmentQuery known gap, `test/query/ContainmentQuery.classifyPoint.test.mjs:138` (`KNOWN GAP (tracked separately, not fixed by Task 6): extreme single-geometry aspect ratio (max/min local extent = 2,000,000:1) breaks both mergeDistance and surfaceEpsilon`). The five P7 standing todos (D-8, D-A, D-B, D-C, D-D) are gone, and a grep of `test/` confirms that no other `test.todo` or `todo: true` exists.
- **Duration** rose from about 13.7 s to about 24 s. Most of the increase comes from the promoted `R21-2 (D-8): …` test in `maximumShape.test.mjs`, which took **12.3 s** in run 1. It has no wall-clock assertion (G-CAL). The renamed `nodeFactor.test.mjs` took 8.6 s when run on its own here.
- **Opt-in tiers.** `CLASHTEST_AC12_TIERS=all node --test test/clashtest/integration/maximumShape.test.mjs` gave exit 0, **10 tests, 10 pass, 0 fail, 0 todo, 61,558.55 ms**. It covered the `scaled`, `ledger` and `results` tiers, plus the R21-2 worst-case test.
- **§21.3 caveats, unchanged.** The run was not from a clean checkout: `docs/handoffs/latest.md` is modified and `docs/reviews/…-p7-d9-ac18d-adjudication.md` is untracked. Both are docs-only and no test reads them. No credentials were used and no server was started. Network isolation was not independently enforced.
- **The earlier unidentified transient failure did not recur.** The rerun made 3 full-suite runs and 13 extra runs of the real-world pair (below), and none failed. One Step 2 attempt exited 1 because of a harness artifact, not a test failure. A zsh loop passed the two file paths as a single unsplit argument, so `node --test` reported `Could not find '<a> <b>'`. The artifact was reproduced deliberately, and the correctly split command passed 12 times out of 12. This observation item stays **open and unidentified**. **[SUPERSEDED — see rerun #2]** (identified as D-11/D-12 in the flake record `56d591a`)

### Rerun Step 2: named suites, run individually

| Command | Role | tests | pass | fail | todo | duration_ms |
|---|---|---|---|---|---|---|
| `node --test test/clashtest/planning/planner.property.test.mjs` | master DoD 5 | 7 | 7 | 0 | 0 | 699.64 |
| `node --test test/clashtest/integration/differential.test.mjs` | master DoD 4 | 25 | 25 | 0 | 0 | 364.88 |
| `node --test test/clashtest/integration/realWorldProvenance.test.mjs test/clashtest/integration/realWorldEnvironment.test.mjs` | T2 evidence for AC-7, AC-17 b/f, AC-18 d, AC-19, AC-21. **Not DoD 4** | 22 | **22** | 0 | **0** | 547.21 |
| `node --test test/clashtest/integration/nodeFactor.test.mjs` | D-8 regression (erratum A11), including the two `OPEN GATE D-8b/D-8c` single-record findings | 9 | 9 | 0 | 0 | 8588.22 |

The real-world pair went from 18 pass / 4 todo to **22 pass / 0 todo**. The D-A, D-B, D-C and D-D arms now pass.

### Rerun Step 3: AC traceability walk, repeated mechanically

- **(a) Paths exist.** The brief's exact command printed nothing. All **57** distinct paths (from **94** citations) resolve. **Pass.**
- **(b) Owners.** The brief's literal command still sees only the phase `Create` rows that name a file (62 matching lines). It still misses P3's and P5's glob-plus-`- Test:` declarations, so **PD-4 is still open.** **[SUPERSEDED — see rerun #2]** The extended walk was re-run by script: for each citation, it took the nearest `\bP[0-7]\b` on the row, then searched that phase file's `Create` and `- Test:` lines. Result: **94/94 attributed correctly, 0 mismatches.**
- **(c) Titles.** All 37 `::` citations were re-checked by script against the file text and against run 1's `ok` lines.
  - 22 match verbatim.
  - 7 pass with the same recorded tolerances as before: substring or prefix matches, a template-literal title, and `\'` escapes.
  - **8 still fail the verbatim rule: PD-1 (×2), PD-2 (×1) and PD-3 (×5).** **[SUPERSEDED — see rerun #2]** (0 at `56d591a`)
  - Every lower-phase verification-row id still exists, and every cited file ran in Step 1 with 0 failures.
- **AC-16.** The named exception is still **ACCEPTED**. Its reachable arms and the reserved-member assertion are in `startRun.test.mjs`, which passes. The walk found no `definitionMigrations` option or sentinel, and no "needs owner confirmation" / "STILL OPEN" wording.
- **AC-19.** The *Deferred* cell still claims only the `compareResultSets` sub-conjuncts. **Confirmed** (modulo PD-3).

**Plan defects re-verified. All four are still open; the plan is unedited.** **[SUPERSEDED — see rerun #2]** (all four fixed in `bc432b6`)

| ID | Still open? | Current evidence |
|---|---|---|
| PD-1 | **Yes** | `::determinism, 10 runs, same world / fresh worlds` (AC-6, AC-19 (c)) is still a description. The shipped titles are `determinism: 10 runs on one world and 10 on fresh worlds agree (AC-6), <mode>` ×4 (`differential.test.mjs:256`), and all pass. |
| PD-2 | **Yes, but the over-claim is resolved** | The cited `::world disposal mid-run seals failed, and still failed with a cancel already pending (AC-21)` is **still absent**. Arm (i) passes as `world disposal mid-run seals failed, and the engine makes no further library call (AC-21 (i))` (`realWorldEnvironment.test.mjs:441`). Arm (ii) is no longer a todo: it passes as `D-C (P6): world disposal with a cancel pending inside a planning slice seals failed, not cancelled (AC-21 (ii))` (`:471`). The row no longer claims untested behaviour, but its citation still fails convention 3. |
| PD-3 | **Yes** | The plan uses U+2032 `′` and the shipped titles use ASCII `'` (`realWorldEnvironment.test.mjs:531, 702, 751, 772, 791`). All five pass. |
| PD-4 | **Yes** | The Step 3(b) command still cannot see P3/P5 `- Test:` declarations (P3 plan l.105, P5 plan l.144). |

**Rows now green that were todo-dependent.** Each row below cites a test name that passed in all 3 Step 1 runs.

| AC row / conjunct | Previously | Now | Passing evidence |
|---|---|---|---|
| AC-7 tail (cancel in the final planning slice; sealed set valid and read back) | todo D-D | **Green** | `realWorldEnvironment.test.mjs:144` `D-D (P6): a cancel landing in the final planning slice seals a valid set with no unit ledger (AC-7, R21-2)`, plus the P6 T1 regression in `run/lifecycle.test.mjs` (`ba48c7e`). **This test is not cited in the AC table** (proposal P-5). |
| AC-11 R21-2 producer/reader invariant | todo D-8 | **Green for the results-dominated form** | `maximumShape.test.mjs:408` `R21-2 (D-8): options this engine accepts yield sets it can read back, at the worst-case 35-node ClashResult`; `nodeFactor.test.mjs` 9/9; `options.defaults.test.mjs`. **Caveat:** the D-8b/D-8c gates below. |
| AC-12 maximum-shape round trip at configurable ceilings | todo D-8 | **Green at the defaults and at the configured tiers** (`CLASHTEST_AC12_TIERS=all` 10/10) | The same files. The conjunct "at each hard ceiling that option validation accepts" is **not proven** for ledger- or diagnostic-heavy option sets (D-8b/D-8c; evidence record §10). |
| AC-17 b/f durable read-back | todo D-A, D-B | **Green** | `realWorldProvenance.test.mjs:317` `D-A (P5): an engine-sealed set with a non-empty unreachablePopulation validates and reads back (spec §6.2, §13.6)`; `:335` `D-B (P6): a mixed owner's result carries mixedOwnerProvenance but NOT unreachableOwner (spec §11.1, §6.2)`; `validateResultSet.invariants.test.mjs` (the D-A `count` rows). The cited AC-17 b/f tests also pass. **The D-A/D-B tests are not cited in the AC table** (P-5). |
| AC-21 (ii) disposal with a cancel pending | todo D-C | **Green on behaviour; the citation is still PD-2** | `realWorldEnvironment.test.mjs:471` `D-C (P6): …(AC-21 (ii))`, plus the T1 regression in `run/lifecycle.test.mjs` (`b2c33b4`, `4d9d307`). |
| AC-10 (indirect: sets carrying unreachable-owner provenance can be read back and evaluated) | D-A/D-B | **Green** | The D-A and D-B tests above. |

**Rows still not green, or owner-dependent.**

| AC row | Why | Disposition |
|---|---|---|
| AC-18 (d) **[SUPERSEDED — see rerun #2]** | **D-9.** The adjudication verdict is A, but the proposed wording edits (plan l.1673/l.2030; spec AC-18(d) l.1495) are not applied, and the owner has not chosen a reading. Both cited tests pass. | **Owner decision pending.** |
| AC-11 / AC-12 universal ceiling conjunct **[SUPERSEDED — see rerun #2]** (D-8c fixed by A13; D-8b and D-10 open) | **D-8b / D-8c** bounded-evidence gates. The ledger term is unsound in form, and the diagnostic factor is 12 against a measured 20–88. | **Owner decision** (see the assessment below). |
| AC-6, AC-19 (c), AC-19 (b′)/(d′), AC-21 **[SUPERSEDED — see rerun #2]** | PD-1, PD-3 and PD-2 citation defects. The behaviour passes, but the verbatim rule fails. | Plan wording edits proposed (P-1..P-3); **plan not edited**. |

**Plan wording edits needed (proposals only; not applied):** **[SUPERSEDED — see rerun #2]** (P-1..P-4 and P-6 applied; P-5 and P-7 still open)

- **P-1 (PD-1).** In AC-6 and AC-19 (c), cite ``::determinism: 10 runs on one world and 10 on fresh worlds agree (AC-6), <mode>`` (×4, template title) in place of the description.
- **P-2 (PD-2).** In AC-21 (and P7.8 Step 17 text, plan l.1705), replace the cited title with the two shipped titles: arm (i) `world disposal mid-run seals failed, and the engine makes no further library call (AC-21 (i))` and arm (ii) `D-C (P6): world disposal with a cancel pending inside a planning slice seals failed, not cancelled (AC-21 (ii))`.
- **P-3 (PD-3).** Normalize `′` ↔ `'` in the five AC-19 citations and Step 17a/17b text (plan l.1741–1748). The alternative is renaming the tests.
- **P-4 (PD-4).** Extend the P7.11 Step 3(b) command so it also reads `- Test:` declarations.
- **P-5.** Add the regression tests that now carry the fixed conjuncts to the rows they close:
  - AC-7: `D-D (P6): …`
  - AC-11/AC-12: `R21-2 (D-8): …` and `integration/nodeFactor.test.mjs`, a file that no phase `Create` row declares, so its owner phase must be named.
  - AC-17: `D-A (P5): …` and `D-B (P6): …`
- **P-6 (D-9).** The adjudication's proposed AC-18(d) wording clarification, if the owner accepts verdict A.
- **P-7 (plan erratum from Task Y).** `p5-result-set.md` l.85 and l.1444, and `p8-derivations.md` l.116, list `UnreachablePopulation` without `count` (re-verified at `e0be33a`).

### Rerun Step 4: DoD checklist

| DoD item | Status at `e0be33a` | Evidence / honest limit |
|---|---|---|
| 1. P0–P7 phase acceptance checklists pass (signed) | **Partly verifiable; not signed by this run** **[SUPERSEDED — see rerun #2]** (caveat replaced by the owner ruling on superseding evidence) | Unchanged from the original run. In addition, **code changed after phase acceptance**: P0 options (D-8, `e016796`), P4 (D-4, `c1ff642`), P5 (D-A, `7514d54`) and P6 (D-1 `b1da763`, D-B `842c637`, D-D `ba48c7e`, D-C `b2c33b4`/`4d9d307`). So the P0/P4/P5/P6 acceptance checklists **predate these fixes**. Each fix was task-reviewed and Approved, but no phase checklist was re-signed. |
| 2. `npm test` green, clean checkout, no credentials/network | **Green, with the same caveats** **[SUPERSEDED — see rerun #2]** | 3× 2514 tests / 2513 pass / 0 fail / 1 todo. The working tree is not clean (docs-only), and network was not isolated. |
| 3. Every in-scope §22 AC mapped to a passing named test; excluded ACs listed with owner | **Not met as written** **[SUPERSEDED — see rerun #2]** | Passes (a) and (b, extended) are green. Pass (c) still has PD-1..PD-3, and PD-4 is still open. The formerly todo-dependent conjuncts now pass, but the D-D/D-A/D-B/R21-2 regressions are not cited in the table (P-5). AC-18 (d) awaits the owner (D-9). The AC-11/12 universal ceiling conjunct is caveated by D-8b/D-8c. The excluded-AC list and owners are unchanged from the original Step 4. |
| 4. Differential = brute force, 4 modes × 4 selections | **Green** | 25/25. |
| 5. Exact-cover property test | **Green** | 7/7. |
| 6. Handoff, CHANGELOG, README pointer | **Not verified by this run** | Task P7.10 / controller. |

### Rerun: open defects and owner decisions

| ID | Status | Detail |
|---|---|---|
| D-A (P5) | **FIXED** `7514d54`, Task Y review Approved | Its regression test passes. |
| D-B (P6) | **FIXED** `842c637`, Task Y review Approved | Its regression test passes. |
| D-C (P6) | **FIXED** `b2c33b4`, `4d9d307`, Task Z review Approved | AC-21 (ii) is preserved; no spec amendment. |
| D-D (P6) | **FIXED** `ba48c7e`, Task Z review Approved | Its regression test passes. |
| D-8 (P0 / spec §13.6) | **FIXED** as spec erratum A11: `e016796`, `ab01fcd`, `03fdf52`, `e0be33a`. Task X review Approved. | The 956,824 ceiling was independently re-derived. |
| D-8b (ledger term) | **OPEN: bounded-evidence gate** | See the evidence record §10 and the assessment below. |
| D-8c (diagnostic factor) | **OPEN: bounded-evidence gate** **[SUPERSEDED — see rerun #2]** (FIXED as A13; form ratification pending) | Same as D-8b. A fixed factor of 88 would put the defaults at 16,445,536 > 16M. |
| D-9 (AC-18 d reading) | **OPEN: adjudicated A, wording edits proposed, awaiting owner** **[SUPERSEDED — see rerun #2]** (FIXED as A12) | Record `…-p7-d9-ac18d-adjudication.md` (untracked at `e0be33a`). |
| D-2 | Open, unchanged | `libraryExclusions: []` provenance deviation (R-P7-1). |
| D-3 | Open, unchanged | The `recordRef` cap is 256 in P5 and 512 in the spec. |
| D-5 | Open, unchanged (low) | `discardRun` from a synchronous `finalizing` listener reports `done.persistence {skipped, attempt:0}`. |
| D-6 | Open, unchanged | Predicate (ii) is applied for by-id `rerun` only, not `getFreshness`. |
| D-7 | Open, unchanged (low) | Reads accept no `signal`. |
| Plan erratum (Task Y) | Open | P-7 above: `p5-result-set.md` l.85/l.1444 and `p8-derivations.md` l.116 omit `count`. |
| Stale production comments (Task X M2) | Open, deferred | `clashtest/results/resultSetSchema.js:324` and `clashtest/results/validateResultSet.js:1482` still say "1,000,000 results" (re-verified). |
| Review minors | Deferred | The "Minors"/"minor (deferred)" entries across `progress.md` (Tasks P7.2–P7.10, P7.8a/b, FIX-D1D4, X, Y, Z). |
| Unidentified transient suite failure | Open observation **[SUPERSEDED — see rerun #2]** (identified: D-11/D-12) | 0 recurrences in this rerun. |
| P6 carry-overs | Unchanged | §7.1/H7.2/AC-3 diagnostics-overflow spec gate; `Run.js` perf items. |

**Assessment of whether D-8b/D-8c block the acceptance run. This is the owner's call.** **[SUPERSEDED — see rerun #2]** (D-8c fixed; D-8b and the new D-10 remain, and the D-8b evidence now shows the defaults themselves can produce unreadable sets)
- On executable evidence, they do **not** block it. No test fails because of them. The full suite, the opt-in tiers (10/10) and the R21-2 worst-case round trip all read back. The only D-8b/D-8c assertions are the two single-record `OPEN GATE` findings in `nodeFactor.test.mjs`, and those pass by pinning the unsound behaviour.
- What they leave unproven is the **universal** R21-2 claim and the AC-11/AC-12 conjunct "at each hard ceiling that option validation accepts" for ledger- and diagnostic-heavy option sets. No whole-set contradiction test exists yet in either direction (evidence record §10).
- This record therefore reads AC-11/AC-12 as satisfied for the results-dominated form and at the defaults and tiers, **with a scoped D-8b/D-8c caveat**. Whether that caveat blocks P7 acceptance is **the owner's decision**, not this run's.

### Rerun: open gates (unchanged)

G-CAL, G-EC, G-OQ4, G-OQ16 and G-REMOTE are all still open, and their status for P7 is as in the original *Open gates* table below. The AC-16 (iii)/(iv) `migration-failed` deferral is still owner-accepted and non-blocking.

### Rerun: git state

- **Branch:** `feature/federated-clash-test-core-engine`. **HEAD:** `e0be33aee358719028a0f60d357cecfb4e0c2060`.
- **`git status --short` at rerun start:** ` M docs/handoffs/latest.md` and `?? docs/reviews/2026-09-24-federated-clash-test-core-p7-d9-ac18d-adjudication.md`. Both are the controller's, and this rerun did not touch them.
- **After this rerun:** the only additional change is ` M docs/reviews/2026-09-24-federated-clash-test-core-p7-acceptance-run.md` (this file). Nothing was committed.

---

## Original run at `82245b4` (2026-09-24): kept as evidence

## Summary and verdict

- **Step 1.** **[SUPERSEDED — see rerun]** Three consecutive full-suite runs gave the same result: **2505 tests, 2499 pass, 0 fail, 0 cancelled, 0 skipped, 6 todo**, in about 13.7 s each. The only `not ok` lines are the 6 expected `# TODO` entries. The implementer's earlier one-off failure, which was never identified, **did not recur**.
- **Step 2.** The property suite passed 7/7, the differential suite 25/25, and the real-world T2 pair 18 pass / 0 fail / 4 todo. **[SUPERSEDED — see rerun]** (real-world pair now 22/0/0 todo).
- **Step 3, pass (a).** All 57 distinct cited paths exist. Zero missing.
- **Step 3, pass (b).** All 94 citations have the correct owner (0 mismatches) once the walk includes P3's and P5's per-task `- Test:` declarations. The brief's literal command does not include them (see plan defect PD-4).
- **Step 3, pass (c).** 29 of 37 `::` title citations check out, some with a tolerance that is recorded below. **8 do not match verbatim**, which amounts to **3 title plan defects (PD-1..PD-3)**. Adding the pass-(b) procedure defect **gives 4 plan defects in total.** Every lower-phase verification-row id that the table cites exists, and each cited file ran inside Step 1 with 0 failures.
- **AC-16.** The `migration-failed` deferral is **accepted** by this walk. It is not a defect.
- **Not all green.** **[SUPERSEDED — see rerun]** (D-A/D-B/D-C/D-D/D-8 are fixed; see the rerun's green/not-green tables.) Seven AC rows (AC-7, AC-11, AC-12, AC-17, AC-18, AC-21 and, indirectly, AC-10) depend on real-world arms or invariants that are now **standing `test.todo` reproducers** of open defects D-A, D-B, D-C, D-D and D-8, or that carry owner note D-9. For those conjuncts the table must not be read as satisfied.

**Verdict (original run)** **[SUPERSEDED — see rerun]**: P7 implementation complete pending owner decisions; NOT accepted. DoD item 1 is only partly verifiable: phase acceptance comes from owner records, and the P2/P5/P6 plan checklists are unticked while P4/P7 have no checkboxes. Item 2 is green. Item 3 is not met as written: there are 4 plan defects, and several conjuncts are todo-dependent. Item 4 is green (25/25). Item 5 is green (7/7). Item 6 was not verified here (Task P7.10; the files exist).

## Step 1: full suite, three runs

Command: `npm test`, three times back to back on the working tree at `82245b4`.

| Run | exit | tests | pass | fail | cancelled | skipped | todo | duration_ms |
|---|---|---|---|---|---|---|---|---|
| 1 | 0 | 2505 | 2499 | 0 | 0 | 0 | 6 | 13702.04 |
| 2 | 0 | 2505 | 2499 | 0 | 0 | 0 | 6 | 13713.21 |
| 3 | 0 | 2505 | 2499 | 0 | 0 | 0 | 6 | 13700.26 |

- The TAP plan line reads `1..2463` (top-level tests). `# tests 2505` includes subtests.
- In each run, `not ok` occurs exactly 6 times, all six are `# TODO`, and there are **no failing test names to report**.
- **Caveats on the §21.3 conditions.** The run was not from a clean checkout: `docs/handoffs/latest.md` is modified and uncommitted, but it is docs-only and not read by any test. No APS credentials were supplied and no server was started. Network isolation was **not independently enforced**; the suite is offline by design, but this run did not block the network.

Standing `test.todo` inventory. There are 6, as expected. **[SUPERSEDED — see rerun]** Only #6 remains at `e0be33a`; #1–#5 are now passing tests (#5 renamed `D-C (P6): …`).

| # | Owner item | File:line | Title |
|---|---|---|---|
| 1 | R21-2 / D-8 | `test/clashtest/integration/maximumShape.test.mjs:407` | `R21-2 gap: options this engine accepts must yield sets it can read back (ClashResult > 24 nodes)` |
| 2 | D-A (P5) | `test/clashtest/integration/realWorldProvenance.test.mjs:321` | `D-A (P5): an engine-sealed set with a non-empty unreachablePopulation validates and reads back (spec §6.2, §13.6)` |
| 3 | D-B (P6) | `test/clashtest/integration/realWorldProvenance.test.mjs:339` | `D-B (P6): a mixed owner's result carries mixedOwnerProvenance but NOT unreachableOwner (spec §11.1, §6.2)` |
| 4 | D-D (P6) | `test/clashtest/integration/realWorldEnvironment.test.mjs:145` | `D-D (P6): a cancel landing in the final planning slice seals a valid set with no unit ledger (AC-7, R21-2)` |
| 5 | D-C (owner) | `test/clashtest/integration/realWorldEnvironment.test.mjs:480` | `D-C (owner): world disposal with a cancel pending inside a planning slice seals failed, not cancelled (AC-21 (ii))` |
| 6 | pre-existing ContainmentQuery known gap | `test/query/ContainmentQuery.classifyPoint.test.mjs:138` (`{ todo: true }`) | `KNOWN GAP (tracked separately, not fixed by Task 6): extreme single-geometry aspect ratio (max/min local extent = 2,000,000:1) breaks both mergeDistance and surfaceEpsilon` |

## Step 2: named suites, run individually

All four files exist on disk, including `test/clashtest/planning/planner.property.test.mjs` (11,868 B).

| Command | Role | tests | pass | fail | todo | duration_ms |
|---|---|---|---|---|---|---|
| `node --test test/clashtest/planning/planner.property.test.mjs` | master DoD 5 (exact cover) | 7 | 7 | 0 | 0 | 724 |
| `node --test test/clashtest/integration/differential.test.mjs` | master DoD 4 (differential oracle) | 25 | 25 | 0 | 0 | 375 |
| `node --test test/clashtest/integration/realWorldProvenance.test.mjs test/clashtest/integration/realWorldEnvironment.test.mjs` | T2 evidence for AC-7, AC-17 b/f, AC-18 d, AC-19 a/b′/d′/e, AC-21. **Not part of DoD 4** | 22 | 18 | 0 | 4 | 554 | **[SUPERSEDED — see rerun]** |

- **Property suite.** It covers exact cover over 200 seeded cases, unordered and containment; tight sizing caps including `target-too-large` gaps, both modes; byte-identical planning under reordering; projection sensitivity; and nested roots giving `hierarchy-overlap`.
- **Differential suite.** All 16 cells pass (4 modes × same-model / cross-model explicit / whole-model target / whole-model source). So do the F2 negative control, the AC-4 partition/broad-phase arms for volume-overlap and clearance, the AC-6 determinism arms for all four modes, library-call conformance, and the `recordFindClashes` restore.
- **Real-world pair.** The 4 todos are D-D, D-C, D-A and D-B. Every other named family arm passes.

## Step 3: AC traceability walk

The table is at `p7-engine-integration.md` lines 2000–2033: 21 AC rows, 94 path citations and 57 distinct paths.

### (a) Every cited path exists

The brief's exact command printed nothing. **Pass: all 57 distinct paths resolve under `test/clashtest/`.**

### (b) Every cited path is owned by its preceding phase marker

- **The brief's literal command** (`grep -n 'Create' … | grep -o 'p[0-8][^:]*:.*\.test\.mjs'`) finds only phase *File structure* rows that literally name the file. P3 declares its tests as a glob row (`test/clashtest/planning/*.test.mjs | Create (per task)`), and so does P5 (`test/clashtest/results/*.test.mjs | Create`). The concrete file names appear in each task's `- Test:` line. Taken literally, the command therefore leaves **33 of the 94 citations** (every P3 `planning/…` and P5 `results/…` citation) with no owner.
- **The extended walk** looked for the nearest `\bP[0-7]\b` to the left of each path on the same row and checked that phase's `Create` rows plus its task `- Test:` lines. Result: **94/94 citations are attributed to the phase that declares them. 0 owner mismatches.**
- This is recorded as **PD-4**.

### (c) Every cited assertion exists and passed

**`::` title citations.** There are 37 of them, each checked against the file text and against Step 1 run 1's `ok` lines.

| Result | Count | Citations |
|---|---|---|
| Verbatim in file and passing | 22 | AC-1 deleteTest tombstone; AC-4 negative control; AC-7 ×2; AC-8 ×2; AC-11 ×3; AC-16 ×7 (all but "hung write"); AC-17 b; AC-19 a, e; AC-20; AC-21 settlement `secondaryCauses` and model eviction. |
| Passing, with a recorded tolerance (not a defect) | 7 | AC-3 `library-call conformance`, a verbatim substring of `library-call conformance: no findClashes call after a cancel`. AC-4 `partition and broad-phase independence (AC-4)`, a verbatim prefix of two passing mode-suffixed titles. AC-5 `differential: whole-model target, volume-overlap`, produced by a template literal and exact in the passing output. AC-16 `dispose forces a hung write's terminal event…`, AC-17 f and AC-18 d ×2 are exact in the output; the source differs only by the `\'` JS escape. |
| **Do not check out: plan defect** | 8 | PD-1 (AC-6, AC-19 (c)); PD-2 (AC-21); PD-3 (AC-19 b′ ×1, d′ ×4). |

**Lower-phase verification-row ids.**
- P6 `V1–V17, V19–V22, V25–V27, V30, V33` are all present in P6's verification table.
- The P2 checks cited (1–7) and the P4 checks cited (1–17) all exist.
- Every P3 and P5 file cited has its own `node --test` bullet in that phase's *Verification / acceptance*.
- Every cited file lives under `test/clashtest/` with a `.test.mjs` name, so `scripts/run-tests.mjs` includes it. Step 1 ran all of them with **0 failures**.

**AC-16, the named exception, is ACCEPTED.**
- The reachable arms are present in `test/clashtest/engine/startRun.test.mjs:366–369`: `schema-unsupported` (schemaVersion 99), `definition-invalid`, and the `schemaVersion: 0` → `definition-invalid` boundary. Their host test passes.
- The reserved-member assertion `assert.ok(PLANNING_CAUSES.includes('migration-failed'))` is at `:413` and passes.
- No `definitionMigrations` option or sentinel exists: grepping `clashtest/` finds 0 hits.
- "needs owner confirmation"/"STILL OPEN" occurs 0 times in the table.
- Clauses (iii)/(iv) are **not** treated as uncovered conjuncts and do not block this walk.

**AC-19.** The row cites Step 17a's and Step 17b's five tests. All five pass, modulo PD-3. Its *Deferred* cell claims only the `compareResultSets` sub-conjuncts of (b), (d′) and (e) → P8. **Confirmed.**

### Plan defects found (recorded, not fixed)

| ID | Rows | Finding | Evidence |
|---|---|---|---|
| **PD-1** | AC-6, AC-19 (c) | The citation `::determinism, 10 runs, same world / fresh worlds` is a description, not a title. By convention 3 it is a plan defect. The shipped tests are `determinism: 10 runs on one world and 10 on fresh worlds agree (AC-6), <mode>` ×4, and all pass. P7.8 Step 7 (plan l.1637) names no title. | `test/clashtest/integration/differential.test.mjs:256` |
| **PD-2** | AC-21 | The cited `::world disposal mid-run seals failed, and still failed with a cancel already pending (AC-21)` (also Step 17 text, plan l.1705) does not exist. The shipped test was split. Arm (i) passes as `world disposal mid-run seals failed, and the engine makes no further library call (AC-21 (i))`. Arm (ii), a cancel pending, is the **D-C `test.todo`**. The row therefore **over-claims** (ii). **[SUPERSEDED — see rerun]** (arm (ii) now passes; citation still absent) | `realWorldEnvironment.test.mjs:442`, `:480` |
| **PD-3** | AC-19 (b′), (d′) ×4 | The plan titles use U+2032 `′`, and so does Step 17a/17b's own text (plan l.1741–1748). The shipped titles use an ASCII `'`. The titles are otherwise identical and all five pass. This is typographic plan/implementation drift, but it fails the verbatim rule. | `realWorldEnvironment.test.mjs:536, 707, 756, 777, 796` |
| **PD-4** | Step 3(b) procedure | The pass-(b) command in P7.11 does not see P3's and P5's glob-plus-`- Test:` declarations, so it cannot perform the check it describes for 33/94 citations. The table itself is correct once those declarations are read. | P3 plan l.105, P5 plan l.144 |

Under Step 3's rule, PD-1..PD-3 are recorded against the owning phase, which is P7 for all three. The controller or owner decides whether this reopens anything. None of the four was reclassified as a deferral.

### Accepted deferrals (not defects)

- AC-16 `migration-failed`, clauses (iii)/(iv) (owner, 2026-09-21).
- AC-10, AC-14, AC-17 (d), AC-19: `compareResultSets` sub-conjuncts → P8.
- AC-13 → P8 and the annotation follow-up.
- AC-6 T3, AC-15 → Viewer-adapter (G-OQ4).
- AC-11 ambiguous-commit → remote persistence (G-REMOTE).
- AC-12 T3 and the calibrated wall-clock budget → G-CAL.
- AC-18 (e) → performance harness.

### AC rows whose cited evidence is (partly) a standing todo **[SUPERSEDED — see rerun]**

| AC row | Conjunct | Standing todo / note | Effect on the row |
|---|---|---|---|
| AC-7 | cancel in the **final planning slice** (the tail of the cancellation arm; the sealed set must be valid and read back) | **D-D** (`realWorldEnvironment.test.mjs:145`) | The cited mid-plan cancel test passes. The final-slice variant seals a set that fails read-back (`CorruptResultSetError`). **Not satisfied** for that variant. |
| AC-11 | R21-2 producer/reader invariant (`integration/maximumShape.test.mjs`) | **D-8** (`maximumShape.test.mjs:407`) | The round trip passes at provisional defaults only because the slack absorbs the shortfall. The invariant itself is **not satisfied** (factor 24 < 35). |
| AC-12 | maximum-shape round trip at configurable ceilings | **D-8** (same todo; D-8b/D-8c factors also unsound) | Passes at the configured shapes. Not proven at any ceiling the options validator accepts. |
| AC-17 b / f | real-world mixed-owner sets are valid and read back | **D-A** (`realWorldProvenance.test.mjs:321`), **D-B** (`:339`) | The cited b/f tests pass on in-memory sealed sets. A set with non-empty `unreachablePopulation` fails read-back (D-A), and a mixed owner's result carries `unreachableOwner`, which the validator rejects (D-B). **Not satisfied** for durable read-back. |
| AC-18 d | the un-sliced negative control | owner note **D-9** | Passes, but its control deviates from AC-18 (d)'s literal control per §6.4 item 3. Owner reading needed. |
| AC-21 (ii) | world disposal with a cancel already pending | **D-C** (`realWorldEnvironment.test.mjs:480`) | Only arm (i) passes. The shipped build seals `cancelled` where the AC expects `failed`. **Not satisfied** (see also PD-2). |
| AC-10 (indirect) | integrity/claim over sets carrying unreachable-owner provenance | D-A / D-B | The T1 citations pass. Real-world sets hitting D-A/D-B cannot be read back to evaluate. |

## Step 4: master Definition of Done (§5)

| DoD item | Status | Evidence / honest limit |
|---|---|---|
| 1. P0–P7 phase acceptance checklists pass (signed) | **Partly verifiable; not signed by this run** | See the per-phase table below. P0–P6 acceptance is an owner record, not something this run re-signed. P7 has no owner acceptance. |
| 2. `npm test` green, clean checkout, no credentials/network | **Green, with caveats** | 3× 2505/2499/0 fail/6 todo. **[SUPERSEDED — see rerun]** The working tree is not clean (handoff modified, docs-only). Network was not isolated. |
| 3. Every in-scope §22 AC mapped to a passing named test; excluded ACs listed with owner | **Not met as written** | Pass (a) is green and pass (b) is green under the extended walk. Pass (c) has PD-1..PD-3, and PD-4 is a procedure defect. The rows listed above are todo-dependent: AC-7 tail, AC-11/12 R21-2, AC-17 read-back, AC-21 (ii). **Excluded ACs with owner:** AC-13 → P8 and the annotation follow-up; AC-14 → P8; AC-15 → Viewer-adapter live evidence (G-OQ4/G-OQ1/G-OQ16); AC-6 T3 → Viewer-adapter (G-OQ4); `compareResultSets` sub-conjuncts of AC-10/17(d)/19(b, d′, e) → P8; AC-11 ambiguous-commit → remote-persistence follow-up (G-REMOTE); AC-12 T3 and the calibrated wall-clock budget → G-CAL/performance harness; AC-18 (e) → performance harness; AC-16 (iii)/(iv) `migration-failed` → deferred until a definition migration path exists (owner-accepted). |
| 4. Differential suite equals brute force, 4 modes × 4 selections | **Green** | Step 2: 25/25, including all 16 cells. |
| 5. Coverage exact-cover property test passes | **Green** | Step 2: 7/7. |
| 6. Handoff, CHANGELOG, README pointer updated | **Not verified by this run** | This belongs to Task P7.10. I confirmed only that the files exist: the `CHANGELOG.md` entry at l.3, the `README.md` pointer at l.22 and `clashtest/README.md`. The handoff is the controller's (Steps 5–6). |

**Per-phase final checklists (DoD item 1)**

| Phase | Final checklist | State in plan file | What I could verify |
|---|---|---|---|
| P0 | `p0-foundations.md` l.2842 | 10 `[x]`, 0 `[ ]` | Its files pass inside Step 1. Owner acceptance is recorded in the handoff. P0.8 remains blocked by G-CAL. |
| P1 | `p1-identity.md` l.1924 | 9 `[x]` | Its files pass in Step 1. Accepted per the handoff. |
| P2 | `p2-definitions.md` l.2028 | **14 `[ ]`, none ticked** | Its commands pass in Step 1. Acceptance is recorded (reviews and adjudication, 2026-09-21), but the checklist is **unsigned in the plan**. |
| P3 | `p3-planner.md` l.2078 | 12 `[x]` | Its files pass, including the property suite. Accepted. |
| P4 | `p4-executor-diagnostics.md` l.1756 | table only, no checkboxes | Its files pass. Accepted 2026-09-22. **Post-acceptance code change:** D-4 (`c1ff642`, `targetWeight` in `UNIT_KEYS`), owner-authorized. |
| P5 | `p5-result-set.md` l.3626 | **13 `[ ]`** | Its files pass. The handoff records P5 as closed through the REM11 adjudication. The checklist is unsigned in the plan. D-A (P5 schema) is an open defect against it. |
| P6 | `p6-run-lifecycle.md` l.3735 | **8 `[ ]`** | Its files pass. Accepted by the owner 2026-09-24. **Post-acceptance code change:** D-1 (`b1da763`, `Run.js` lease epoch), owner-authorized. D-B, D-C and D-D are open against P6. |
| P7 | `p7-engine-integration.md` l.2037 | table only | Rows 1–12 pass, because every command is inside Step 1 or Step 2. Row 13 is this walk, which found 4 plan defects. Row 14 was not verified. **Not accepted.** |

I signed nothing that I did not verify. The plan checkboxes were left as they are (read-only).

## Open defects and owner decisions

**[SUPERSEDED — see rerun]** for D-A, D-B, D-C, D-D and D-8, which are now FIXED. **[SUPERSEDED — see rerun #2]** for D-8c (FIXED as A13) and D-9 (FIXED as A12). The other rows still stand. Sources: `.superpowers/sdd/p7-engine-integration/progress.md` and `docs/reviews/2026-09-24-federated-clash-test-core-p7-d8-node-factor-evidence.md`. Line numbers were re-checked at `82245b4` where noted.

| ID | Owner phase | Location | One line |
|---|---|---|---|
| D-A | P5 | `clashtest/results/resultSetSchema.js:206` (closed `UnreachablePopulation` lacks the `count` that P3 writes) | Any set with a non-empty `unreachablePopulation` fails read-back (`CorruptResultSetError`). Todo `realWorldProvenance.test.mjs:321`. |
| D-B | P6 | `clashtest/run/Run.js:355` (`unreachableOwners` from the full `ownerDbIds`, including mixed owners); rejected at `clashtest/results/validateResultSet.js:1398` | A mixed owner's result is flagged `unreachableOwner` → `unreachable-flag-invalid`. This feeds `pairSetDigest`. Todo `:339`. |
| D-C | owner question (P6 vs spec AC-21 / §16.7 B) | `clashtest/run/Run.js:1541–1549` (`worldDisposed: false` stand-in) | Disposing the world with a cancel pending inside a planning slice seals `cancelled`, while the AC expects `failed`. Todo `realWorldEnvironment.test.mjs:480`. |
| D-D | P6 | `clashtest/run/Run.js:334` (and the `enumerationCheckpoint` at `:1053–1059`) | A cancel landing in the final planning slice seals a set with null unit outcomes and no provenance models, which fails read-back. Todo `realWorldEnvironment.test.mjs:145`. |
| D-8 | P0 / spec §13.6 l.976 | `clashtest/options.js:39` (`SCHEMA_NODE_FACTORS.result: 24`) | The measured per-result charge is 20–35, so R21-2 is broken. Recommended erratum: 35. It is **not applied** and awaits the owner. Todo `maximumShape.test.mjs:407`. |
| D-8b | P3 / spec §13.6 | `clashtest/planning/sizing.js:104–113` (`unitRecordFields` expands ranges) vs the `ledger: 12` factor | The ledger factor is unsound in form, not only in value. Owner design decision. |
| D-8c | P4/P5 / spec §13.6 | `clashtest/results/resultSetSchema.js:251–263` (`NormalizedDiagnostic`) vs the `diagnostic: 12` factor | One diagnostic costs 20–88 nodes. Owner decision. |
| D-2 | P6 (R-P7-1) | `clashtest/engine.js:573` (`libraryExclusions: []`) | Provenance under-reports, because spec §13.2 says "iff ledger…". Owner may authorize P6 to copy `ledger.exclusions`. |
| D-3 | P5 vs spec | `clashtest/results/resultSetSchema.js:59` (`STRING_CAPS.id: 256`) and `:149` (`Acceptance.recordRef`) | The P5 schema caps `recordRef` at 256 while the spec (and the engine, R-P7-12) allows 512. A ref of 257–512 would seal a set that fails read-back. |
| D-5 | P5/P6 (low) | `clashtest/run/Run.js` `openFinalizeWindow` (`:1325`) and `clashtest/results/residency.js:320–333` | `discardRun` called from a synchronous `finalizing` listener yields `done.persistence {skipped, attempt:0}` with a store configured. No data loss. |
| D-6 | spec ambiguity (engine) | `clashtest/engine.js:~1083` (§13.6 predicate (ii) for by-id `rerun`) | Implemented for by-id `rerun` only, with the rerun's own options as the "effective limits". It is not applied to `getFreshness`. Owner may rule otherwise. |
| D-7 | P7 cross-task (low) | `clashtest/engine.js` read paths (`getResultSet`, claim/freshness reads) | Reads accept no `signal` (§13.5.2 l.946). |
| D-9 | owner note (spec reading) | `test/clashtest/integration/realWorldProvenance.test.mjs:442–447` (F3 un-sliced negative control) | The control follows §6.4 item 3 (a whole-model target alone in a slice) rather than AC-18 (d)'s literal control. Owner reading needed. |

The P6 carry-overs are unchanged: the §7.1/H7.2/AC-3 diagnostics-overflow spec contradiction (a spec gate), and the `Run.js` perf items (`queue.shift` O(n²), rank renumber), which are deferred. The earlier unidentified transient full-suite failure remains an open observation item. It did not reproduce here (0/3).

## Open gates

| Gate | Blocks | Status for P7 |
|---|---|---|
| **G-CAL** | freezing §17.1 defaults and ceilings, the calibrated span ≤ frame-budget assertion, and Step 17a's cost guard | Open. P7.9 asserts no wall-clock value, and its spans are recorded only. |
| **G-EC** | any consumer of `provenance.models[].elementCount` semantics | Open. P7 treats the field as opaque; the differential fingerprint excludes it (`differential.test.mjs:239`). |
| **G-OQ4** | AC-6 T3 and all of AC-15 | Open, deferred with owner. |
| **G-OQ16** | *enabling* a qualified hierarchy-internal claim in a Host build | Open. Both branches are tested in core (AC-20). |
| **G-REMOTE** | AC-11 ambiguous-commit conjuncts | Open. Only the local transactional store is wired. |
| **AC-16 (iii)/(iv)** | `migration-failed` coverage | **Accepted deferral** (owner, 2026-09-21), non-blocking. |

## Git state

- **Branch:** `feature/federated-clash-test-core-engine`
- **HEAD:** `82245b4baa570598269a2c2b6f357a9ebfa77493`
- **`git status --short` when the run started:** ` M docs/handoffs/latest.md`, the controller's uncommitted edit, which this run did not touch.
- **After this record:** the only addition is the untracked `docs/reviews/2026-09-24-federated-clash-test-core-p7-acceptance-run.md`. Nothing was committed.

## Final verdict (rerun at `e0be33a`) **[SUPERSEDED — see rerun #2]**

P7 implementation complete; targeted fixes applied and reviewed; NOT accepted — owner decisions pending (D-8b/D-8c gates, D-9, deferred notes) and the independent Work review + targeted adjudication is required before P8.
