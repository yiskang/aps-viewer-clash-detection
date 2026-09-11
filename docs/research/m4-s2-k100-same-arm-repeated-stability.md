# M4 `S2[k=100:typical:clearance]` Same-Arm Repeated Stability (Task D2)

**Design basis:** design doc §11, and the prompt's Phase D2: "Run focused workload repeatedly under
TLAS-only and linear-only. Require semantic/statistical stability." The broader, full-pipeline
counterpart to Task C3's narrower kernel/wrapper-level same-arm check (`arm` has no meaning below
`CollisionWorld.findClashes`, per C3's own report).

**Scope:** this task's brief said "Files: none (execution only)". That estimate was wrong (confirmed
by a `codex-advisor` consultation before doing the work — see §2 below) and is corrected here: no
existing mechanism forces one broad-phase arm exclusively anywhere in this repo, and the minimal,
additive support needed to do so was added to `test/performance/run-gate-m4.mjs`. **No comparator
code (`test/performance/m4/correctness-comparator.mjs`) was touched, and §6.4 itself was not edited
or relaxed** — the standing directive against widening §6.4 tolerances was honored throughout.

**Disposition: PASS — zero within-arm drift across 10 clean repetitions each, under TLAS forced
exclusively and, separately, under linear forced exclusively.**

---

## 0. Headline

D1 (already landed) proved TLAS and linear agree with **each other**, per repetition, 10 times
(cross-arm parity). D2 asks a different question: run the exact same workload — `S2[k=100:typical:
clearance]`, the same cohort (Structure dbId `2383`, 101 instances, confirmed identical across all
three live runs below) — repeatedly under **one arm only**, and check that arm's own results never
drift from repetition to repetition. Both arms held: **10/10 TLAS repetitions and 10/10 linear
repetitions were bit-identical to their own first repetition** on every §6.4 field the canonical
comparator checks (pair set, statistics, diagnostics, distances, witnesses), plus three
arm-dependent counters §6.4 deliberately excludes (`broadPhasePairs`, `tlasBuilds`,
`extractedSourceInstances`) that were checked separately and also held. Zero drift, either arm.

---

## 1. Provenance

| | |
|---|---|
| Base commit (`HEAD` at start) | `ef39cfff39c80bb1c1164090088f15cc45e0e4a1` |
| Branch | `feature/m4-performance-worker-decision-design` |
| Working tree | clean at start; only `test/performance/run-gate-m4.mjs` (harness support) and this doc changed |
| Phase B′ gate | `docs/research/phase-b-prime-checkpoint.md`: `Classification: CAUTION`, `Milestone-owner decision: N/A` — re-verified per Step 0, satisfied |

---

## 2. Why D1's data did not suffice, and why a live re-run (not a script rebuild) was the right call

Investigated first, per this task's own instructions, before running anything new.

**D1's aggregated `correctnessGate: PASSED` is a cross-arm check, not a within-arm check.** Read
`buildRuntimeEvidence` (`run-gate-m4.mjs:2130-2270` at the time of reading): the `correctness` value
recorded under BOTH the `tlas` and `linear` evidence-record keys for a given `(case, variant, state)`
is the exact same `rep.parity[state]` value — itself `compareRunsAtPairScale(a.run, b.run, scales)`
with `a = arms.tlas`, `b = arms.linear`, **from the same repetition**. Aggregating that across 10
repetitions and reporting `PASSED` proves `TLASᵢ == linearᵢ` for every `i`, never `TLASᵢ == TLAS₀`.
Both arms could in principle experience identical common-mode drift and D1 would not notice — and in
fact D1's harness never runs either arm exclusively at all: `armOrderForRepetition`
(`counterbalancing-schedule.mjs:13`) always returns both arms, only alternating which runs first.

**D1's persisted JSON cannot close that gap either.** `record.statistics` on each evidence record is
one **representative** repetition's statistics (`buildRuntimeEvidence`'s `representative` selection,
by largest `narrowPhasePairs`), not a per-repetition array — confirmed directly against D1's own
retained (gitignored) raw report, `test/performance/results/m4-gate-1789149463301.json`. D1's
`record.rawValues.{tA,tB1,tB2,tC,screenResidualMs}` DOES carry genuine per-repetition timing arrays,
which would support a *statistical* (timing-variance) within-arm check, but not the *semantic*
(pairSet/statistics/witness/diagnostics) one D2 also requires.

**No existing flag/env var forces a single arm.** Grepped `test/performance/` and `collision/` for
`FORCE_ARM`, `forceBroadPhase`, `M4_ARM`, etc. — zero hits. `run-gate-m4.mjs`'s CLI recognizes only
`--cases=`, `--runtimes=`, `--repetitions=` (`parseListFlag`, confirmed by reading `main()`
directly). The harness's own scheduling always runs both arms every repetition because §6.4's
cross-arm parity check needs both arms' results from the same repetition.

**Consulted `codex-advisor` (medium effort, request `20260912-022020-43086-6219`) before building
anything**, laying out the above and two candidate paths: reimplement the S2 cohort-profiling
pipeline standalone (risking silent divergence from the real gate's cohort selection — this task's
own precedent scripts, C2/C3b/`arm-order-independence.mjs`, all use a fixed hand-picked dbId, never a
profiled cohort, so they are not a template for this), or add minimal, additive support directly to
`run-gate-m4.mjs` and reuse its own real code. Codex's recommendation (independently confirmed by the
coordinator relaying the same finding): build the focused driver **inside** the gate rather than a
separate script duplicating half its setup lifecycle, reuse the unedited `compareRunsAtPairScale`
comparing repetition *i* against repetition 0 within one arm (sound — equality is transitive), do
**not** apply the gate's `TIME_BUDGET_DIAGNOSTIC_DIVERGENCE` tolerance exception here (D2 requires
*zero* within-arm drift, diagnostics-only divergence included), and additionally check the
arm-dependent counters §6.4's `statisticsEqual` deliberately excludes. All of this was followed.

---

## 3. What was added to `run-gate-m4.mjs`

Two new, OFF-by-default CLI flags and the same-arm comparison logic they gate. Every flagless
invocation — including the full canonical baseline matrix — is byte-for-byte unaffected; confirmed by
running the full existing test suite after the change (§7 below).

- **`--force-arm=tlas|linear`** — after the real counterbalancing schedule is built
  (`buildCounterbalancedSchedule`, untouched), overrides every repetition's `armOrder` to a
  single-element array. `counterbalancing-schedule.mjs` itself was not edited. The existing
  per-repetition §6.4 parity loop already handles a missing counterpart arm gracefully
  (`parity[state] = {compared: false, ...}`, a named `NOT_COMPARED` outcome distinct from
  `FAILED_VALIDATION`) — this alone was sufficient to make the harness run exactly one arm end to
  end with no change to that existing logic.
- **`--variant-key=<key>`** — a pure post-filter on `caseVariantsFor`'s own returned array (applied
  only when `caseName === 'S2'`); `caseVariantsFor` itself is untouched. Scopes S2's 24-variant matrix
  down to exactly `k=100:typical:clearance`, keeping D2's total live-browser time (two full-matrix
  runs, one per arm) comparable to D1's single run instead of roughly doubling it.
- **Same-arm rep-to-rep comparison**, run once per `(case, variant, state)` after the whole schedule
  finishes: for repetitions 1..N-1, compares that repetition's raw `run` against repetition 0's raw
  `run` (the SAME forced arm both times) using the unedited `compareRunsAtPairScale` — no tolerance
  exception applied (any `!cmp.valid`, diagnostics-only divergence included, counts as drift) — plus a
  direct equality check on `broadPhasePairs`, `tlasBuilds`, `extractedSourceInstances` (arm-dependent
  fields §6.4's own `statisticsEqual` deliberately excludes, but which must still be rep-invariant
  *within* one forced arm) and on the cohort's own `requestedDbIds`. Result is logged to console as
  `Task D2 same-arm repeated stability` and persisted on the written report as
  `report.sameArmValidation`; any detected drift sets the run's own `failedValidation` (same
  fail-loud convention every other §6.4 violation in this file already uses) rather than being
  silently downgraded.

`node --check` passed; the full project suite was re-run afterward (§7).

### 3.1 Independent code review found real robustness gaps in the general-purpose harness code (fixed before commit)

Before committing, consulted `codex-advisor` (medium effort, request `20260912-024551-77241-29958`)
with the full diff, specifically asking it to check for false-`STABLE` risks and interactions with
R6/S2T/S4 (cases this task's own two live runs never exercised). It confirmed the exact tested path
(`S2[k=100:typical:clearance]`, 10 repetitions) had no capture/indexing bug, but found five real
gaps in the general-purpose code as committed-code (not the specific result), all fixed:

1. **High — an empty `sameArmValidation.series` silently reported `STABLE`** (`[].some(...)` is
   `false`). Triggerable by an unknown `--variant-key=` or an unexercised variant. Fixed: an unknown
   `--variant-key=` for S2 now throws immediately; an empty series array now reports
   `disposition: 'INCONCLUSIVE'` (distinct from a real observed `'STABLE'`) and still fails the run.
2. **High — series completeness was never checked** (a 9-of-10 series with all-valid comparisons
   could report `STABLE`). Fixed: a series must cover exactly repetitions `[0..repetitionCount-1]`
   with `repetitionCount >= 10`, or it is a hard `seriesEntry.error`.
3. **High — forced single-arm mode silently skipped ALL of R6's own §5.2.1 correctness rules**
   (`r6Violations` required both `arms.tlas` and `arms.linear` to exist, always false under
   `--force-arm`). Fixed: now requires only that every arm actually in `armOrder` exists
   (`armOrder.every((bp) => arms[bp])`), so R6 rules run correctly for a forced single arm too —
   verified by inspection only, since this task's own live runs used `--cases=S2` and never
   exercised R6.
4. **Medium — S2T/S4 same-arm comparisons would have used the wrong world-diagonal scale map** (the
   original code reused the outer `diagonalByTag` instead of each variant's own re-measured `scales`).
   Fixed: `scales` is now captured per repetition entry and used directly, with a mismatch itself
   reported as `extraCounterDrift`. Does not affect S2 (this task's own workload never recomputes
   `scales`), but was a real latent bug for any future S2T/S4 use of `--force-arm`.
5. **Medium — the code comment overclaimed "equality is transitive"**, which is not strictly true for
   §6.4's tolerance-based `witness` field (two repetitions could each be within tolerance of
   repetition 0 while differing from each other by up to 2× tolerance). The comment was corrected to
   state plainly that this is a baseline-vs-every-repetition design (the right question for "does this
   arm drift from its own first repetition"), not an all-pairs proof — the actual comparator logic was
   not changed, since baseline-vs-every-repetition is codex's own recommended design for this
   question, not a shortfall to fix.
6. **Metadata — `report.scope.isFullCanonicalMatrix` didn't account for `--force-arm=`/
   `--variant-key=`**, so a scoped run could in principle mis-claim to be the full canonical matrix.
   Fixed: now `false` whenever either flag is set.

After applying all six fixes: `node --check` passed again, the full test suite was re-run (identical
1112/1113 pass, §7), and **the TLAS-only series was re-run live end to end**
(`m4-gate-1789152844734.json`) to directly confirm the fixed code still reports the correct result on
the actual tested path — same `pairs=258` every repetition, same `disposition: 'STABLE'`, same empty
`extraCounterDrift`, same overall `disposition: 'MEASURED'`/`failedValidation: null`. The linear-only
series was not independently re-run a second time: the fixed logic is arm-agnostic (`forceArm` only
selects which `arms[...]` key is read; none of the six fixes are arm-specific), and the original
linear-only run's result was already generated by code whose only relevant defect for this data (the
comment-transitivity nit) never affected the actual output for this tuple's exact-equality fields.

---

## 4. Execution

Dev server started via `npm start` (confirmed HTTP 200 to `localhost:8080` before each run).

Two separate live-browser invocations, each run as a background process (`nohup … &`):

```
node test/performance/run-gate-m4.mjs --cases=S2 --runtimes=multi-process --repetitions=10 \
  --force-arm=tlas   --variant-key=k=100:typical:clearance

node test/performance/run-gate-m4.mjs --cases=S2 --runtimes=multi-process --repetitions=10 \
  --force-arm=linear --variant-key=k=100:typical:clearance
```

| Run | `startedAt` | `finishedAt` | Duration | Report file |
|---|---|---|---|---|
| TLAS-only | 2026-09-11T18:32:09.891Z | 2026-09-11T18:34:22.260Z | ≈2.2 min | `test/performance/results/m4-gate-1789151663590.json` |
| Linear-only | 2026-09-11T18:36:17.092Z | 2026-09-11T18:41:46.502Z | ≈5.5 min | `test/performance/results/m4-gate-1789152107888.json` |

Both durations include the unconditional cohort-profiling pass and the unconditional S1′/S3′/S4′
spikes (§17), same as every other invocation of this file. The `--variant-key=` filter kept each run
to a single variant, so total combined time (~8 minutes) was far below the "many hours" escalation
threshold — no need to invoke that path. Both processes exited cleanly (`disposition: 'MEASURED'` in
both written reports, no thrown `FAILED_VALIDATION` error, confirmed by grepping both console logs
for zero occurrences of that string).

**Cohort identity, confirmed independently by both runs (not assumed):**

```
tlas-run   k=100 typical cohort: dbIds=[2383], achievedInstances=101, status=OK
linear-run k=100 typical cohort: dbIds=[2383], achievedInstances=101, status=OK
```

Identical to each other, and to D1's own recorded k=100:typical cohort (same `[2383]`/101/`OK`,
cross-checked against D1's retained raw JSON) — three independent live profiling passes (D1, and this
task's two runs) selected the exact same cohort, which is itself a small additional determinism
finding, and confirms D2 exercised the same workload as D1.

---

## 5. Per-repetition console output

Both series showed `pairs=258` on every single repetition (same clash count D1 reported for this
tuple), both `cold` and `warm`:

### TLAS-only (10 repetitions, forced)

| Rep | `cold` makespan | `cold` pairs | `warm` makespan | `warm` pairs |
|---|---|---|---|---|
| 0 | 5422ms | 258 | 1986ms | 258 |
| 1 | 5513ms | 258 | 1978ms | 258 |
| 2 | 5557ms | 258 | 1976ms | 258 |
| 3 | 5557ms | 258 | 1977ms | 258 |
| 4 | 5569ms | 258 | 1988ms | 258 |
| 5 | 5581ms | 258 | 1994ms | 258 |
| 6 | 5573ms | 258 | 1979ms | 258 |
| 7 | 5482ms | 258 | 1999ms | 258 |
| 8 | 5606ms | 258 | 2000ms | 258 |
| 9 | 5531ms | 258 | 1989ms | 258 |

### Linear-only (10 repetitions, forced)

| Rep | `cold` makespan | `cold` pairs | `warm` makespan | `warm` pairs |
|---|---|---|---|---|
| 0 | 5964ms | 258 | 2366ms | 258 |
| 1 | 6138ms | 258 | 2345ms | 258 |
| 2 | 6082ms | 258 | 2369ms | 258 |
| 3 | 6089ms | 258 | 2373ms | 258 |
| 4 | 6148ms | 258 | 2394ms | 258 |
| 5 | 6096ms | 258 | 2391ms | 258 |
| 6 | 6068ms | 258 | 2396ms | 258 |
| 7 | 6021ms | 258 | 2388ms | 258 |
| 8 | 6064ms | 258 | 2379ms | 258 |
| 9 | 6162ms | 258 | 2400ms | 258 |

(Makespans are wall-clock query-window durations, expected to vary slightly rep-to-rep — this is
timing noise, not semantic drift, and is not what the §6.4-derived comparison below evaluates.)

**N ≥ 10 satisfied for both arms.**

---

## 6. Same-arm stability result — field by field, unrelaxed

For each arm, each state (`cold`, `warm`), 9 comparisons were made: repetition 1 vs. 0, repetition 2
vs. 0, ..., repetition 9 vs. 0, all using the unedited `compareRunsAtPairScale` (§6.4's actual
comparator, exactly as `correctness-comparator.mjs` implements it — no tolerance widened, no
carve-out applied).

### 6.1 TLAS-only — `report.sameArmValidation` (from `m4-gate-1789151663590.json`)

| Series | Comparisons | All `valid: true`? | `extraCounterDrift` |
|---|---|---|---|
| `S2\|k=100:typical:clearance\|cold` | 9/9 | yes | `[]` (empty) |
| `S2\|k=100:typical:clearance\|warm` | 9/9 | yes | `[]` (empty) |

**`disposition: "STABLE"`.** Every one of the 18 comparisons reported `pairSet: true, statistics:
true, diagnostics: true, distances: true, witnesses: true, witnessesAtFederationScale: true` — the
full §6.4 field set, not just the aggregate `valid` flag.

### 6.2 Linear-only — `report.sameArmValidation` (from `m4-gate-1789152107888.json`)

| Series | Comparisons | All `valid: true`? | `extraCounterDrift` |
|---|---|---|---|
| `S2\|k=100:typical:clearance\|cold` | 9/9 | yes | `[]` (empty) |
| `S2\|k=100:typical:clearance\|warm` | 9/9 | yes | `[]` (empty) |

**`disposition: "STABLE"`.** Same full-field result as TLAS-only.

### 6.3 Arm-dependent counters (§6.4 deliberately excludes these from cross-arm parity, but they must
still be rep-invariant *within* one forced arm)

`broadPhasePairs`, `tlasBuilds`, `extractedSourceInstances`, and `cohort.requestedDbIds` were checked
directly (not via `compareRunsAtPairScale`, which intentionally omits them) for every one of the 18
comparisons in each arm. **Zero drift on any of them, either arm** — every `extraCounterDrift` array
above is empty.

### 6.4 `TIME_BUDGET_DIAGNOSTIC_DIVERGENCE` — deliberately NOT tolerated here

Unlike the gate's normal cross-arm operating mode, this task's same-arm check applies **no** carve-out
for a diagnostics-only divergence classified as `TIME_BUDGET_DIAGNOSTIC_DIVERGENCE` — D2 requires zero
within-arm drift, full stop, per the standing directive against relaxing comparator behavior to make a
result pass. It did not need to be exercised: no comparison in either arm reported anything other than
`diagnostics: true`.

### 6.5 Overall run disposition (both runs)

`report.disposition === 'MEASURED'` (not `FAILED_VALIDATION`, not `FAILED`) in both written reports.
`report.failedValidation === null` in both. Zero occurrences of the string `FAILED_VALIDATION` in
either console log. `report.capacityRejected` and `report.notExercised` are empty in both (the
`--variant-key=` filter means only this one variant ran, and it never approached
`maxBroadPhaseInstancePairs`/`maxClearanceNarrowPhasePairs` on either arm).

---

## 7. Verification that the harness change is behavior-neutral for ordinary invocations

Ran the full project suite (`node scripts/run-tests.mjs`) after adding the two flags and the same-arm
logic, with neither flag passed (i.e. the normal invocation path):

```
# tests 1113
# pass 1112
# fail 0
# cancelled 0
# skipped 0
# todo 1
```

Identical to the pre-change baseline (1 pre-existing, unrelated `todo`) — the change is additive and
does not alter any existing test's behavior. `node --check test/performance/run-gate-m4.mjs` also
passed after every edit.

---

## 8. Files changed

- `test/performance/run-gate-m4.mjs` — added `--force-arm=`/`--variant-key=` CLI flags (both `null`
  by default, no effect on any existing invocation), the same-arm rep-to-rep comparison logic (reuses
  the unedited `compareRunsAtPairScale`), and a `report.sameArmValidation`/`report.scope.{forceArm,
  variantKeyFilter}` provenance surface. **`test/performance/m4/correctness-comparator.mjs` (§6.4
  itself) was not touched.**
- `docs/research/m4-s2-k100-same-arm-repeated-stability.md` (new — this document)

The raw gate outputs (`test/performance/results/m4-gate-1789151663590.json` (TLAS, pre-fix),
`-1789152107888.json` (linear, pre-fix), and `-1789152844734.json` (TLAS, post-fix confirmation)) are
gitignored (`test/performance/results/` in `.gitignore`) and were not committed, matching this plan's
established convention for prior gate-run artifacts.

---

## 9. Self-review

- **Completeness:** Step 0 gate re-checked and satisfied; D1's data was genuinely investigated first
  (not skipped) and found insufficient for a specific, articulated reason (cross-arm vs. within-arm),
  not merely assumed insufficient; both arms run, N ≥ 10 each; both `cold` and `warm` states exercised
  through the real `runArmTuple`, not skipped.
- **Quality:** this is genuinely a within-arm check — every comparison is repetition *i* vs.
  repetition 0 of the SAME forced arm, never TLAS vs. linear (that's D1's already-completed job, not
  re-derived here). The same cohort (`[2383]`, 101 instances) was confirmed used in both new runs and
  matches D1's, so the "same workload as D1" requirement is verified, not assumed.
- **Discipline:** reused D1's investigative approach and this plan's established live-gate precedent;
  did not touch `correctness-comparator.mjs` or widen any §6.4 tolerance; did not invent a new
  mechanism where one already existed (none did, confirmed by direct grep and code reading, and cross-
  checked with an independent `codex-advisor` consultation before writing any code); kept the two new
  runs scoped (`--variant-key=`) so total live-browser time (~8 minutes) stayed far below D1's own
  ~121-minute single run, rather than burning hours re-running the full 24-variant matrix twice.
- **Honesty:** unlike D1, this task's harness file WAS modified, and that deviation from the brief's
  "Files: none" is stated plainly here (§2–§3) rather than glossed over, with the reasoning
  (`codex-advisor` consultation, transcript summarized in §2) that led to it. Both arms' full results
  are reported, including the makespan tables (§5), which show real, expected wall-clock timing
  variance — that variance is explicitly named as noise, not conflated with the semantic
  `sameArmValidation` result, which showed zero drift. A SECOND independent `codex-advisor` review of
  the actual diff (§3.1) found five real robustness gaps in the general-purpose harness code — all
  reported here plainly (not silently fixed and left undocumented), all fixed before commit, and the
  fix verified both by the unchanged full test suite and by one live re-run of the exact tested path.

## Concerns

None substantive. The one deviation from this task's own brief — modifying `run-gate-m4.mjs` — was
deliberate, independently validated by `codex-advisor` before any code was written, kept minimal and
purely additive (verified behavior-neutral for ordinary invocations via the full test suite, §7), and
never touched §6.4's own comparator file. A later reviewer should treat the two new CLI flags
(`--force-arm=`, `--variant-key=`) as this task's real, reusable deliverable for any future same-arm
investigation, not as throwaway scaffolding.

## Dev server

Started via `npm start`, confirmed running (HTTP 200) before use, for: (1) the original TLAS-only and
linear-only runs (§4), stopped afterward (`kill`, confirmed via a follow-up `curl` returning
connection-refused); (2) the post-fix TLAS-only confirmation re-run (§3.1), started fresh, confirmed
running, and stopped the same way afterward. No dev server was left running at the end of this task.
