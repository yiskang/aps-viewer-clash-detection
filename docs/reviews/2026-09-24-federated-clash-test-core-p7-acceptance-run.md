# P7 core acceptance run (Task P7.11, Steps 1–4): evidence record

- **Date:** 2026-09-24
- **Branch / HEAD:** `feature/federated-clash-test-core-engine` @ `82245b4baa570598269a2c2b6f357a9ebfa77493`
- **Governing plan:** `docs/superpowers/plans/federated-clash-test-core/p7-engine-integration.md`, Task P7.11 (Steps 1–4 only; Steps 5–7, meaning the handoff, the ready-for-gate mark and any commit, belong to the controller).
- **Scope:** evidence only. No production code, test, plan, spec or handoff was edited, and nothing was committed. This file is the only write.
- **Environment:** Node `v22.23.1`, darwin. `npm test` is `node scripts/run-tests.mjs` (package.json line 12), so the two are the same command and it was run once per pass.

## Summary and verdict

- **Step 1.** Three consecutive full-suite runs gave the same result: **2505 tests, 2499 pass, 0 fail, 0 cancelled, 0 skipped, 6 todo**, in about 13.7 s each. The only `not ok` lines are the 6 expected `# TODO` entries. The implementer's earlier one-off failure, which was never identified, **did not recur**.
- **Step 2.** The property suite passed 7/7, the differential suite 25/25, and the real-world T2 pair 18 pass / 0 fail / 4 todo.
- **Step 3, pass (a).** All 57 distinct cited paths exist. Zero missing.
- **Step 3, pass (b).** All 94 citations have the correct owner (0 mismatches) once the walk includes P3's and P5's per-task `- Test:` declarations. The brief's literal command does not include them (see plan defect PD-4).
- **Step 3, pass (c).** 29 of 37 `::` title citations check out, some with a tolerance that is recorded below. **8 do not match verbatim**, which amounts to **3 title plan defects (PD-1..PD-3)**. Adding the pass-(b) procedure defect **gives 4 plan defects in total.** Every lower-phase verification-row id that the table cites exists, and each cited file ran inside Step 1 with 0 failures.
- **AC-16.** The `migration-failed` deferral is **accepted** by this walk. It is not a defect.
- **Not all green.** Seven AC rows (AC-7, AC-11, AC-12, AC-17, AC-18, AC-21 and, indirectly, AC-10) depend on real-world arms or invariants that are now **standing `test.todo` reproducers** of open defects D-A, D-B, D-C, D-D and D-8, or that carry owner note D-9. For those conjuncts the table must not be read as satisfied.

**Verdict:** P7 implementation complete pending owner decisions; NOT accepted. DoD item 1 is only partly verifiable: phase acceptance comes from owner records, and the P2/P5/P6 plan checklists are unticked while P4/P7 have no checkboxes. Item 2 is green. Item 3 is not met as written: there are 4 plan defects, and several conjuncts are todo-dependent. Item 4 is green (25/25). Item 5 is green (7/7). Item 6 was not verified here (Task P7.10; the files exist).

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

Standing `test.todo` inventory. There are 6, as expected:

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
| `node --test test/clashtest/integration/realWorldProvenance.test.mjs test/clashtest/integration/realWorldEnvironment.test.mjs` | T2 evidence for AC-7, AC-17 b/f, AC-18 d, AC-19 a/b′/d′/e, AC-21. **Not part of DoD 4** | 22 | 18 | 0 | 4 | 554 |

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
| **PD-2** | AC-21 | The cited `::world disposal mid-run seals failed, and still failed with a cancel already pending (AC-21)` (also Step 17 text, plan l.1705) does not exist. The shipped test was split. Arm (i) passes as `world disposal mid-run seals failed, and the engine makes no further library call (AC-21 (i))`. Arm (ii), a cancel pending, is the **D-C `test.todo`**. The row therefore **over-claims** (ii). | `realWorldEnvironment.test.mjs:442`, `:480` |
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

### AC rows whose cited evidence is (partly) a standing todo

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
| 2. `npm test` green, clean checkout, no credentials/network | **Green, with caveats** | 3× 2505/2499/0 fail/6 todo. The working tree is not clean (handoff modified, docs-only). Network was not isolated. |
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

Sources: `.superpowers/sdd/p7-engine-integration/progress.md` and `docs/reviews/2026-09-24-federated-clash-test-core-p7-d8-node-factor-evidence.md`. Line numbers were re-checked at `82245b4` where noted.

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
