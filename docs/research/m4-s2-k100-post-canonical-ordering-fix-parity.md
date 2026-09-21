# M4 `S2[k=100:typical:clearance]` TLAS/Linear Parity — Post-Canonical-Ordering-Fix Re-Run (Task D1)

**Design basis:** `docs/superpowers/specs/2026-09-11-canonical-ordering-operand-symmetry-fix-design.md`
§11 regression D: "Re-run `S2[k=100:typical:clearance]` under the full, unrelaxed §6.4 comparator,
N ≥ 10 clean runs. §6.4 is not edited, and the `TIME_BUDGET_DIAGNOSTIC_DIVERGENCE` carve-out must not
be invoked — if it fires, that is a finding."

**Scope:** execution/measurement only. No production code, no comparator code
(`test/performance/m4/correctness-comparator.mjs`), and no gate harness code
(`test/performance/run-gate-m4.mjs`) was modified. Only this results doc was added.

**Disposition: PASS — full, unrelaxed §6.4 parity held on every one of 10 clean repetitions.
`TIME_BUDGET_DIAGNOSTIC_DIVERGENCE` did not fire anywhere in the run.**

---

## 0. Headline

Over 10 clean, counterbalanced harness repetitions of `S2[k=100:typical:clearance]` (both `cold` and
`warm` states, both `broadPhase` arms), the TLAS and linear paths agreed on **every** §6.4 field every
time: pair set, bit-identical `distance`, witness within the strict per-pair-partition
`1e-9 × max(sourceWorldDiagonal, targetWorldDiagonal)` tolerance, all six compared `statistics`
fields, and the full diagnostics multiset. Zero capacity rejections, zero NOT_EXERCISED outcomes, and
zero `TIME_BUDGET_DIAGNOSTIC_DIVERGENCE` findings touched this tuple. This closes design §11
regression D and the citation it carries forward from
`m4-hard-clash-precheck-parity-blocker-investigation.md:374` (the original wall-clock-nondeterminism
blocker, since fixed by `db64324`).

---

## 1. Provenance

| | |
|---|---|
| Base commit (`HEAD`) | `8c69e48cc2075f5eab7a94be99a40500b3f82597` |
| Branch | `feature/m4-performance-worker-decision-design` |
| Working tree | clean at start and end (only this doc added) |
| Phase B′ gate | `docs/research/phase-b-prime-checkpoint.md`: `Classification: CAUTION`, `Milestone-owner decision: N/A` — re-verified per Step 0, satisfied |

---

## 2. Scoping investigation

The task brief asserts "there is no CLI flag to select only the `k=100:typical:clearance` tuple" —
**true**, verified directly: `run-gate-m4.mjs`'s `main()` only recognizes `--cases=`, `--runtimes=`,
and `--repetitions=` (`parseListFlag`, `run-gate-m4.mjs:2853-2882`); none reaches variant-level
granularity within a case (S2's 24 variants — 4 instance levels × 3 density bands × 2 modes — are
generated internally by `caseVariantsFor('S2', ...)`, `:1803-1829`, with no corresponding flag).

However, the brief's broader premise ("no way to scope the run at all") is **not fully accurate**, and
this was verified rather than assumed:

- `--cases=S2` restricts the matrix to just the S2 case (24 variants), skipping R1–R6, S1, S3, S4, and
  S2T entirely — a real reduction from the full 11-case matrix (`M4_CASE_LIST`,
  `counterbalancing-schedule.mjs:11`).
- `--runtimes=multi-process` restricts to the single authoritative runtime
  (`RUNTIME_CONFIGS.multiProcess.authoritative === true`), skipping the non-authoritative `historical`
  tier for the baseline matrix.
- `--repetitions=10` sets the harness's own internal repetition count directly, so the N ≥ 10
  requirement is satisfied **inside one invocation** — no external looping was needed, and the run's
  own counterbalancing schedule (`counterbalancing-schedule.mjs`) alternates arm order (`tlas>linear`
  / `linear>tlas`) and case order repetition-to-repetition, which is a stronger independence property
  than a naive fixed-order repeat.

This exact command was independently identified as the correct approach in a prior investigation in
this same plan, cited as the mandatory regression test for a different (now-fixed) defect:
`docs/research/m4-three-mesh-bvh-correctness-blocker-adjudication.md:627`
(`node test/performance/run-gate-m4.mjs --cases=S2 --runtimes=multi-process --repetitions=1`). This
task used the same scoped invocation with `--repetitions=10` to satisfy Design §11's own N ≥ 10
requirement in one run.

**What is NOT avoided by this scoping**, confirmed by reading `main()`: cohort profiling (§5.4, one
unmeasured pass per runtime, computed for R-cohorts and all four S2 instance levels regardless of
`--cases`) and the §17 S1′/S3′/S4′ spikes (`run-gate-m4.mjs:3207-3266`) are **unconditional** —
`runS1PrimeSpike`/`runS3S4PrimeSpike` are called with `Object.values(RUNTIME_CONFIGS)` directly, never
gated on `selectedRuntimes` or `selectedCases`. These ran regardless and are reported in §6 below as
an orthogonal finding, per the brief's own header comment ("cheap and unconditional").

Two earlier tasks in this plan (C2, C3b) chose to avoid `run-gate-m4.mjs` entirely by building small
standalone scripts, because their assertions (pair-level disposition stability) did not need the
file's own §6.4 comparator. That option does not apply here: Design §11 regression D specifically
requires the gate's own canonical comparator output (`compareRunsAtPairScale`,
`correctness-comparator.mjs`), which exists only inside `run-gate-m4.mjs` and is not duplicated
anywhere else. Running the real gate, scoped, was the only way to satisfy this task's actual
requirement.

---

## 3. Execution

Dev server started via `npm start` (port 8080, `.env` present, confirmed with an HTTP 200 to
`localhost:8080` before the gate run).

Command, run as a **real background process** (`nohup … &`, not foreground) since duration was
unknown ahead of time:

```
node test/performance/run-gate-m4.mjs --cases=S2 --runtimes=multi-process --repetitions=10
```

Progress was monitored via a filtered `tail -f` on the process's own stdout log (repetition
boundaries, the target tuple's own per-repetition line, `Baseline matrix complete`, and the final
`evidence report written` marker) rather than by blocking in the foreground.

**Duration:** `startedAt` `2026-09-11T15:56:19.806Z` → `finishedAt` `2026-09-11T17:57:41.895Z` =
**121.4 minutes** (≈2 hours) for the full scoped run (24 S2 variants × 10 repetitions × 2 states × 2
arms, plus the unconditional S1′/S3′/S4′ spikes). This was assessed as tractable partway through
(repetition 0 completed in ~12 minutes, giving a clean linear extrapolation to ~2 hours total,
comfortably short of the "many hours" threshold that would have warranted stopping to escalate) and
was let run to completion under periodic background monitoring rather than foreground polling.

Process exited cleanly (report written, no thrown error, no non-zero `process.exitCode` path taken).

---

## 4. N ≥ 10 confirmation

The harness's own `--repetitions=10` flag drove exactly 10 internal repetitions (`rep0`–`rep9`) of
the full S2 matrix in one invocation — this is the harness looping N times internally, not 10
external process invocations. Each repetition rebuilds a fresh `CollisionWorld` per `(runtime, case,
broadPhase, repetition)` tuple (§6.1.4) and alternates arm order per `counterbalancing-schedule.mjs`,
so the 10 samples are 10 clean, freshly-built repetitions rather than 10 identical repeats of one
cached result — not a claim of formal statistical independence, which this run does not establish.

Per-repetition console output for the target tuple (all identical `pairs=258`, both states clean):

| Rep | Arm order | `cold` parity | `warm` parity |
|---|---|---|---|
| 0 | tlas>linear | OK | OK |
| 1 | linear>tlas | OK | OK |
| 2 | tlas>linear | OK | OK |
| 3 | linear>tlas | OK | OK |
| 4 | tlas>linear | OK | OK |
| 5 | linear>tlas | OK | OK |
| 6 | tlas>linear | OK | OK |
| 7 | linear>tlas | OK | OK |
| 8 | tlas>linear | OK | OK |
| 9 | linear>tlas | OK | OK |

**All 10 repetitions clean. N ≥ 10 satisfied.**

---

## 5. §6.4 parity — field by field, unrelaxed

Verified two ways: (a) the live per-repetition console line (`parity cold:OK warm:OK`), which
`logTupleLine` derives directly from `parity[state].valid` — itself `compareRunsAtPairScale`'s
`valid` flag, the logical AND of pairSet/statistics/diagnostics/distances/witnesses (§5.1 below); and
(b) the written evidence report's aggregated `correctnessGate` per `(broadPhase, state)`, which is
`'PASSED'` only if **every** one of the 10 repetitions' `parity[state].valid` (or `.tolerated`, never
needed here) was true.

### 5.1 The comparator actually applied (unrelaxed, confirmed by reading the code, not assumed)

- **Pair set** — `sigEqual`, full sorted `(sourceModelTag, sourceDbId, targetModelTag, targetDbId,
  type)` tuple equality. Part of `compareRuns.fields.pairSet`.
- **`distance`** — `distancesEqual` with the **default `tolerance = 0`** (bit-identical), never the
  `1e-9`-relaxed worker-arm variant. `compareRunsAtPairScale` never passes a `distanceTolerance`
  override.
- **`witness`** — computed via the **strict per-`(sourceModelTag,targetModelTag)`-partition** scale,
  not the more permissive federation-wide maximum (`compareRunsAtPairScale`,
  `run-gate-m4.mjs:901-946`): for every partition present in the pair set, `scale =
  Math.max(sourceWorldDiagonal, targetWorldDiagonal)` for that exact pair of models, and
  `fields.witnesses` (the field that gates `valid`) is the AND over every partition's own
  `witnessesEqual` result at `1e-9 × scale`. The design doc explicitly names the federation-wide
  shortcut as a regression risk (a strictly more permissive tolerance); this run used the stricter
  per-partition form.
- **`statistics`** — `statisticsEqual` over exactly the six named fields:
  `clearanceExactAabbSurvivors`, `narrowPhasePairs`, `clearanceOverlapPrechecksRun`,
  `clearanceHardClashExclusions`, `clearanceDistanceQueriesRun`, `clearanceHits`.
- **`diagnostics`** — `diagnosticsMultisetEqual`, keyed on `{reason, scope, role, fragment,
  sourceFragment, targetFragment}` (fragment references expanded to `(modelTag, dbId, fragId)`), true
  multiset equality, not count-only.
- **A run is `valid`** iff pairSet ∧ statistics ∧ diagnostics ∧ distances ∧ witnesses (all five). This
  is exactly `compareRunsAtPairScale`'s `valid` field, unmodified by this task.

### 5.2 Result

**All five fields held on every repetition, both states, no exceptions and no tolerated divergence
invoked.** Confirmed by:

- 20/20 individual parity checks (10 reps × {cold, warm}) reporting `valid: true` (console `OK`).
- The written evidence report's four aggregated `correctnessGate` records for this tuple —
  `(tlas,cold)`, `(tlas,warm)`, `(linear,cold)`, `(linear,warm)` — **all `PASSED`**, each aggregating
  all 10 repetitions (`totalRepetitionCount: 10` in every record).

**Representative persisted `statistics`** — each of the four evidence records above stores one
representative repetition's statistics (`buildRuntimeEvidence`'s `representative` selection, by
largest `narrowPhasePairs` workload — `run-gate-m4.mjs:2238-2240`), not all 10 repetitions' raw
values; the JSON does not itself carry a per-repetition statistics array for direct cross-repetition
comparison. The `correctnessGate: PASSED` aggregation is what proves TLAS/linear statistics equality
held on **every** repetition (§5.2's four records each aggregate `totalRepetitionCount: 10`); the
table below is the representative record's values, shown identical across all four
`(broadPhase, state)` combinations (from `report.evidenceRecords`,
`test/performance/results/m4-gate-1789149463301.json`):

| Field | Representative value (tlas & linear, cold & warm — identical) |
|---|---|
| `clearanceExactAabbSurvivors` | 1319 |
| `narrowPhasePairs` | 1319 |
| `clearanceOverlapPrechecksRun` | 1034 |
| `clearanceHardClashExclusions` | 347 |
| `clearanceDistanceQueriesRun` | 286 |
| `clearanceHits` | 258 |

(`broadPhasePairs` and `tlasBuilds` differ between arms as expected — `broadPhasePairs`: 1319 (tlas)
vs. 744673 (linear); `tlasBuilds`: 3 (tlas/cold) vs. 0 elsewhere — but neither is part of §6.4's
`STATISTICS_FIELDS` list, so this is not a divergence.)

Witness tolerance actually applied for this tuple's federation
(`report.provenance.runtimes[0].worldDiagonalsByTag`): `arch ≈ 315.71`, `structure ≈ 314.15`,
`mechanical ≈ 286.81` world-diagonal units, giving a per-partition tolerance on the order of `3×10⁻⁷`
units for the tightest relevant pair — not relaxed to a federation-wide maximum.

### 5.3 `TIME_BUDGET_DIAGNOSTIC_DIVERGENCE`

**Did not fire — for this tuple, or anywhere else in the run.** `report.timeBudgetDiagnosticDivergences`
is `[]` (empty array) for the whole 24-variant × 10-repetition matrix. This is the named exception
Design §11 regression D explicitly forbids invoking to reach a pass; it was never reached, so no
work-around was needed and none was applied.

### 5.4 Overall run disposition

`report.disposition === 'MEASURED'` (not `FAILED_VALIDATION`, not `FAILED`).
`report.failedValidation === null`. `report.harnessFailures.length === 0`.
`report.setupFailures.length === 0`. `report.capacityRejected` and `report.notExercised` contain zero
entries referencing `k=100:typical:clearance` (100 capacity rejections occurred elsewhere in the S2
matrix — 20 each on `k=50:high:*`, `k=100:high:*`, `k=183:low:*`, `k=183:typical:*`, and
`k=183:high:*`, confirmed by grouping `report.capacityRejected` directly — all unrelated variants
whose broad-phase instance-pair count exceeds `maxBroadPhaseInstancePairs` on the `linear` arm by
construction; expected, and orthogonal to this task's tuple). This is also why the run's `health`
counter reports 860 measured windows rather than a nominal 960 (24 variants × 2 states × 2 arms × 10
reps): a capacity-rejected `cold` state skips its paired `warm` window for that tuple.

---

## 6. Orthogonal findings (not acted on — outside this task's scope)

The unconditional S1′ (module-resolution) and S3′/S4′ (worker cold-start/lifecycle) spikes, which run
regardless of `--cases`/`--runtimes` scoping, surfaced two pre-existing, already-structured negative
results, **neither of which is an infrastructure failure or an assertion failure**
(`s1PrimeSpike.infrastructureFailures: []`, `s3s4PrimeSpike.infrastructureFailures: []`,
`s3s4PrimeSpike.assertionFailures: []` — all empty, consistent with the disposition staying
`MEASURED`):

- S1′: every module-resolution worker variant threw `S1 worker error: (no message)` on
  `w.onerror` — a genuine negative experimental result for that spike's own question (§8.6 module-
  worker specifier resolution), not a harness defect.
- S3′/S4′: the worker-side Metric H sample is `UNAVAILABLE` because `performance.memory` is not
  exposed inside a dedicated Worker realm in this Chromium build (`MemoryInfo` is defined on `Window`
  only) — a platform constraint, recorded as such, not a defect.

Both are **out of scope for Task D1** (Files: none; no production code changes), reported here only
for completeness per the brief's "report exactly what you found" instruction. No action was taken on
either.

---

## 7. Files changed

- `docs/research/m4-s2-k100-post-canonical-ordering-fix-parity.md` (new — this document)

No production code, comparator code, or gate harness code was modified. The raw gate output
(`test/performance/results/m4-gate-1789149463301.json`, ~1 MB) is gitignored
(`test/performance/results/` in `.gitignore:487`) and was not committed, matching this plan's
established convention for prior gate-run artifacts.

---

## 8. Self-review

- **Completeness:** Step 0 gate re-checked and satisfied; scoping genuinely investigated (not assumed
  from the brief's own claim) and the finer flags that do exist were used; N ≥ 10 confirmed via the
  harness's own internal loop; full, unrelaxed §6.4 parity checked field by field, not just via the
  summary `disposition`.
- **Quality:** results doc follows the structural convention of prior gate/investigation write-ups in
  `docs/research/` (headline, provenance table, field-by-field detail, explicit disposition line).
- **Discipline:** no production code, no comparator code, and no gate harness code touched — this
  task's own file list ("Files: none") honored exactly. §6.4 itself was not edited.
- **Honesty:** the two orthogonal spike findings (§6 above) are reported plainly rather than omitted,
  even though they don't affect this task's own pass/fail outcome, per the brief's explicit
  instruction to report exactly what was found.

## Concerns

None substantive. The run took ~2 hours (bounded, not "many hours") — this was assessed as tractable
early (a clean linear extrapolation from repetition 0's ~12-minute duration) and was run to completion
under background monitoring rather than escalated. The dev server was started solely for this task and
was confirmed stopped afterward (connection refused on a follow-up `curl`).

## Dev server

Started via `npm start` for this task's gate run; confirmed running (HTTP 200) before the run started
and confirmed stopped afterward (`kill`, then a follow-up `curl` to `localhost:8080` returned no
connection). No dev server was left running.
