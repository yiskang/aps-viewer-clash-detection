# M4 Phase 3 canonical checkpoint report — post canonical-ordering/operand-symmetry fix

Task E3 of `docs/superpowers/plans/2026-09-11-canonical-ordering-operand-symmetry-fix-implementation.md`.
Produces the Phase 3→4 decision-checkpoint report described in that plan's Task E3 brief, using ONLY the
Task E1/E2-validated evidence source: **`test/performance/results/m4-gate-1789180565018.json`**
(`disposition: "MEASURED"`, `scope.isFullCanonicalMatrix: true`, all 11 cases × both runtimes × 5
repetitions, `startedAt: 2026-09-11T23:59:45.545Z`, `finishedAt: 2026-09-12T02:36:03.630Z`). The
prior, unrelated full-matrix attempt (`m4-gate-1789057417429.json`, `disposition: FAILED_VALIDATION`,
predates this plan) is **not used anywhere in this document**, per Task E2's finding and this plan's own
Phase E instructions.

**Scoping note, carried forward from the task brief verbatim (do not re-litigate):** the M4 implementation
plan's actual Phase 3→4 decision checkpoint (`docs/superpowers/plans/2026-09-09-...implementation.md:8700-8741`,
confirmed accurate — see "Line-citation confirmations" below) reads only the §6.3 partition and the §7.2
target evaluation to decide Phase 4 spike activation. The richer field set (mandatory-D conditions, T-a-failing
tuples, a reducer result) belongs to M4's own later Task 5.3 §26 final evidence report, gated on a Phase 5
reducer invocation, and `test/performance/m4/verdict-reducer.mjs` (M4 Task 2.5) **does not exist as code**.
This document is therefore a **bespoke document for this fix's own purposes** — it borrows M4's vocabulary
for legibility but does not literally invoke Task 5.3's artifact or Task 2.5's reducer anywhere below.

**Independent review:** a `codex-advisor medium` consult (request `20260912-105213-68285-1357`) reviewed an
earlier draft of this document's mechanical derivation against the evidence JSON and both spec/plan
documents, and found two real corrections and one genuine evidence-generation defect (all applied below):
(1) a T-b-only-failure tuple count was one short (`R2/linear/cold` was omitted); (2) the R6 no-boundary
finding and the §7.5.4 workload-validity condition cannot both be asserted as independent unconditional
causes without first resolving whether R6's workload is product-confirmed — they are two branches of one
open question, not two separate causes; (3) the evidence JSON's T-c aggregation silently drops
repetition-level `FAILURE` dispositions rather than surfacing them as tuple-level failures (Step 2 and the
"Known evidence-generation limitation" section below).

---

## Step 1: Fixture/runtime validity

Both runtime tiers ran to completion with no harness failure:

- `data.harnessFailures`: `[]` (empty)
- `data.setupFailures`: `[]` (empty)
- `data.failedValidation`: `null`
- `data.health` reports, per runtime: **historical** — 670 measured windows, 0 errors; **multi-process** —
  750 measured windows, 0 errors. Both show `capacityRejections: 60` (120 total, all attributable to a
  single named limit, see Step 1's capacity finding below).

**Every R-case (R1–R6), every S-case (S1–S4, S2T)** produced either a determined evidence record, a named
`CAPACITY_REJECTED` finding, or a named `NOT_EXERCISED` finding — none vanished silently. 284 evidence
records total; 52 of them are R-case (verdict-bearing candidate) records, all 52 with `correctnessGate:
"PASSED"` (confirmed by direct query — the full multiset of `correctnessGate` values across R-case records
is `{"PASSED"}`, nothing else).

**Capacity censoring is confined to S-cases, never an R-case.** All 120 `capacityRejected` entries and all
72 `NOT_COMPARED` correctness-gate outcomes are attributable to a single named limit,
`maxBroadPhaseInstancePairs` (1,000,000), on the **linear** broad-phase arm, and land exclusively in:
`S2[k=50/100/183:high/typical/low:*]` (the high-source-count, high-density sweep cells) and
`S3[whole-model:*]` (explicitly synthetic per §5.3). This matches Task E1's own characterization exactly —
no R-case tuple is capacity-censored, so §7.5's condition 3 ("Capacity censoring") does not apply to any
verdict-bearing tuple.

**Historical runtime's T-a gap is a known, pre-existing trace-parser limitation, not "expected by design."**
`health[historical].taStatus` is `{"UNEVALUABLE": 670}` with `taUnevaluableReasons:
{"measured-renderer-not-found": 670}` — every historical-runtime window's T-a is unevaluable. Design §7.2
(line ~418) evaluates T-a only on "the representative multi-process runtime (§6.1.5b)", so this gap is
correctly **excluded from the §7.2 decision** — but the underlying cause is a named, documented gap in
`parseTraceAndClock`, not an intentional non-issue: the implementation plan (lines 2131–2132) states
`findMeasuredRendererProcessAndThread` resolves only a `TracingStartedInBrowser` frame's numeric
`processId`, and "a trace shaped that way currently resolves as `measured-renderer-not-found` rather than
succeeding" for a renderer reporting a `processPseudoId` instead — plausibly triggered by the historical
runtime's `--single-process --no-zygote` launch flags. This is flagged as a standing, pre-existing gap
(not introduced by this fix) that the plan itself already named as out of scope for the task that wrote the
parser.

**S1′ and S3′/S4′ (Phase 3's two unconditional spikes) both ran and produced usable evidence** (relevant to
Step 7): `data.s1PrimeSpike` shows, under both runtimes, `bareSpecifierResult.ok: false` and
`relativePathResult.ok: false` (both fail with a worker error), but `buildVariantResult: {ok: true,
hasThree: true, hasBvh: true}` — i.e. S1′ resolved via the permitted build-variant route, case (b) of
§7.3 condition 8's three-case rule. `data.s3s4PrimeSpike` shows S3′ cold-start medians ~1.3 ms (both
runtimes) and all eight S4′ lifecycle scenarios producing their expected rejection/error outcomes
(`WorldDisposedError`, `ModelEvictedError` ×2, `ModelPlacementChangedError`, etc.) — no scenario silently
passed through un-rejected.

## Step 2: §6.4 status

**Pass, with one flagged evidence-generation limitation unrelated to §6.4 itself.**

- `data.failedValidation: null` — the run never hit `FAILED_VALIDATION`.
- `correctnessGate` distribution across all 284 records: `{"PASSED": 212, "NOT_COMPARED": 72}`. Zero
  `FAILED`. All 72 `NOT_COMPARED` are the S2/S3 capacity-censored cells named in Step 1 (correctness
  comparison is undefined where one arm never ran).
- `data.timeBudgetDiagnosticDivergences: []` — **zero** `TIME_BUDGET_DIAGNOSTIC_DIVERGENCE` findings. This
  matches design §6.4's own stated expectation post-fix (the coplanar-crossing-budget carve-out "should
  have nothing left to excuse"): the carve-out exists to protect against wall-clock nondeterminism on
  `ProperCrossingQuery`'s own private clock, and this run shows zero occurrences of it, consistent with
  (though not itself proof of) Task D4's finding that the fix's tightened coplanarity epsilon resolves more
  precheck outcomes decisively rather than leaving them wall-clock-gated.

**No genuine §6.4 correctness anomaly was found.** §6.4 governs the TLAS-vs-linear parity comparator and
per-tuple worker-arm comparisons; nothing in this run's `correctnessGate`/`timeBudgetDiagnosticDivergences`
fields shows a pair-set, distance, witness, statistics, or diagnostics mismatch anywhere.

**Flagged separately (not a §6.4 finding, but a correctness-adjacent gap worth naming per the user's
standing directive against silently smoothing anomalies into a verdict):** the evidence JSON's **T-c**
(input-handler-delay) target shows `pass: false` **nowhere** in any of the 284 records, which on its own
would read as "T-c never failed." Tracing this through `test/performance/run-gate-m4.mjs` and
`test/performance/m4/observation-envelope.mjs` shows this is not fully trustworthy as stated:

- `observation-envelope.mjs`'s `tCDispositionForRepetition` correctly classifies a repetition with a
  censored-observation-lower-bound over the 100 ms threshold as `status: 'FAILURE'` (a genuine, hard T-c
  violation per design's own censoring rule).
- `run-gate-m4.mjs:1288-1297` maps a repetition's T-c to the per-window record as
  `tC.status === 'DETERMINED' ? tC.p95Ms <= TC_THRESHOLD_MS : null` — a `FAILURE`-status repetition becomes
  `null`, not `false`, at the per-window level.
- `run-gate-m4.mjs:2188` then builds the **tuple-level** population as `perRep.map(...).filter(t => t?.status
  === 'DETERMINED').map(t => t.p95Ms)` — repetitions with `status: 'FAILURE'` are silently excluded from
  the population entirely, rather than being counted as a hard tuple-level failure. This population is fed
  into the shared `evaluatePercentileMedian` (`test/performance/m4/evidence-report.mjs`), which — seeing
  fewer values than the expected repetition count — reports `INSUFFICIENT_POPULATION`, not `false`.
- `data.health` independently confirms real T-c failures occurred at the repetition level and were
  swallowed by this filtering: **438 multi-process repetition-level T-c `FAILURE` dispositions** are
  recorded in `health[multi-process].tcStatus.FAILURE` (389 on historical).

**Conclusion on this point:** "the JSON contains no aggregated `Tc: false`" is verified and true; "T-c never
measured-and-failed" is **not** a defensible claim from this evidence — it is an artifact of a pre-existing
tuple-aggregation gap in `run-gate-m4.mjs` (not introduced by this fix's Phase A–D changes; this task's own
brief forbids touching `collision/`, `test/`, or any script, so it is reported here, not fixed). This does
not change any Step 3–8 conclusion below (none of them rest on T-c passing or failing — the D verdict
below is established entirely through T-a/T-b2), but it means T-c's clean appearance must not be cited
elsewhere as supporting evidence for anything.

## Step 3: R-case T-a/T-b/T-c target evaluation

Read directly from `evidenceRecords[].targets` (`{Ta,Tb1,Tb2,Tc}`), per the schema at
`buildEvidenceRecord({runtime, caseName, broadPhase, state, targets, correctness})` (plan line ~8792-8794,
confirmed against the live schema in `test/performance/run-gate-m4.mjs`/`evidence-report.mjs`). T-a is
evaluated on the **multi-process** runtime only (§7.2); the historical-runtime table is included for
completeness but its `Ta` column is uniformly `null` (Step 1's known limitation) and does not participate
in any verdict conclusion below.

### Multi-process runtime (representative, §6.1.5b) — all 26 R-case tuples

| Case | Arm | State | Ta | Tb1 | Tb2 | Tc |
|---|---|---|---|---|---|---|
| R1 | tlas | cold | **true** | true | **false** | null (NOT_EXERCISED) |
| R1 | tlas | warm | true | true | true | null (INSUFFICIENT_POPULATION 2/5) |
| R1 | linear | cold | true | true | **false** | null (NOT_EXERCISED) |
| R1 | linear | warm | true | true | true | null (INSUFFICIENT_POPULATION 1/5) |
| R2 | tlas | cold | true | true | true | null (INSUFFICIENT_POPULATION 1/5) |
| R2 | tlas | warm | true | true | true | **true** |
| R2 | linear | cold | true | true | **false** | null (NOT_EXERCISED) |
| R2 | linear | warm | true | true | true | null (INSUFFICIENT_POPULATION 1/5) |
| R3 | tlas | cold | true | true | true | **true** |
| R3 | tlas | warm | true | true | true | null (NOT_EXERCISED) |
| R3 | linear | cold | true | true | **false** | null (NOT_EXERCISED) |
| R3 | linear | warm | true | true | **false** | null (NOT_EXERCISED) |
| R4 | tlas | cold | true | true | true | **true** |
| R4 | tlas | warm | true | true | true | null (NOT_EXERCISED) |
| R4 | linear | cold | true | true | **false** | null (NOT_EXERCISED) |
| R4 | linear | warm | true | true | **false** | null (NOT_EXERCISED) |
| R5 | tlas | cold | true | true | true | **true** |
| R5 | tlas | warm | true | true | true | null (NOT_EXERCISED) |
| R5 | linear | cold | true | true | true | **true** |
| R5 | linear | warm | true | true | true | null (NOT_EXERCISED) |
| R6 | tlas | cold | true | true | true | **true** |
| R6 | tlas | warm | true | true | true | null (NOT_EXERCISED) |
| **R6** | **tlas** | **refresh** | **false** (worst 69.50 ms) | **false** (median 83.3, >1.5×) | **false** (worst 133.4) | null (NOT_EXERCISED) |
| R6 | linear | cold | true | true | **false** | null (NOT_EXERCISED) |
| R6 | linear | warm | true | true | **false** | null (NOT_EXERCISED) |
| **R6** | **linear** | **refresh** | **false** (worst 69.42 ms) | **false** (median 66.6, >1.5×) | **false** (worst 283.4) | null (NOT_EXERCISED) |

**Summary:** T-a fails at exactly two tuples — `R6/tlas/refresh` and `R6/linear/refresh` — and passes at
every other multi-process R-case tuple. T-b2 fails at nine tuples (see Step 6). T-b1 fails only at the
same two R6-refresh tuples T-a fails at. T-c is `null` (not measured, per Step 2's flagged gap) at all but
six tuples, and explicitly `false` nowhere in this data (with Step 2's caveat that this "never false" is
partly an aggregation artifact, not fully trustworthy as an affirmative "T-c always passes" claim).

### Historical runtime — same 26 tuples, T-a column uniformly null

Every historical-runtime R-case tuple shows `Ta: null` (`NOT_EXERCISED — empty population`, downstream of
the `measured-renderer-not-found` trace-parser gap, Step 1). Tb1/Tb2/Tc values are directionally
consistent with the multi-process table above (Tb1 fails only at R6 refresh on both arms; Tb2 fails at a
similar but not always identical set of tuples due to different absolute timings on the historical
runtime's `--single-process` configuration). Per §7.2, none of this table feeds the verdict below.

## Step 4: main-only/transferable attribution (§6.3 partition)

The gate emits both a **per-tuple** partition (`evidenceRecords[].partition`, used mechanically in Step 5/8
below) and an **aggregate-across-all-measured-windows** partition (`data.partition`, 748 windows on
multi-process). Every §6.3 row has a non-null, populated `residualMs` distribution for every boundary
(`WB-1a`, `WB-1b`, `WB-2p`, `WB-3`, `WB-2`, `WB-4`) — attribution is **not** incomplete (§7.5 condition 6
does not apply; see Step 5). Every boundary's `occupancyMs` is `null` with
`occupancyNote: "no worker in the Phase 3 baseline gate -- Hi is undefined until Phase 4 introduces a
delivery task"` — expected and correct, since Phase 4's S7′/S8′ spikes (the only source of a real `Hᵢ`
figure) were never built.

**Aggregate figures (multi-process, 748 windows), main-only residual by boundary:**

| Boundary | Class | Owned stages | p50 | p95 | max | over-50ms fraction |
|---|---|---|---|---|---|---|
| WB-1a | B | bvhConstruction | 13.2 ms | 35.4 ms | 675.4 ms | 2.4% |
| WB-1b | B | compactAndWeld, connectivity, bvhConstruction | 13.2 ms | 35.4 ms | 675.4 ms | 2.4% |
| WB-2p | B | hardClashPrecheck | 13.7 ms | 35.4 ms | 681.0 ms | 2.4% |
| WB-3 | B | clearanceDistanceQuery | 13.1 ms | 18.9 ms | 69.5 ms | 1.1% |

(WB-2/WB-4, C-class, carry the same shape over broader stage sets — full figures in the evidence file,
omitted here for brevity since C is not reached below.) These aggregate maxima (up to 675 ms) are driven
almost entirely by **cold** states across the whole matrix (including capacity-adjacent S-cases), not by
any single R-case tuple; the per-tuple figures that actually matter mechanically are in Step 5/6/8 below.

## Step 5: Active mandatory-D conditions (manual evaluation of §7.5's ten conditions)

Evaluated by hand against the fresh evidence, condition by condition, per the task brief's explicit
instruction (this plan's Task 2.5 reducer does not exist to automate it). **Three conditions are
independently active and unconditional** (do not depend on any assumption about R6); one more is active
**only in one of two mutually exclusive branches**, named explicitly rather than asserted as a fourth
unconditional cause (per the codex-advisor correction — see header).

| # | Condition (§7.5 text, abbreviated) | Active? | Basis |
|---|---|---|---|
| 1 | No confirmed responsiveness target | **ACTIVE** | §7.2 (line ~416) states plainly there is "no product-approved responsiveness target for this operation today," and confirmation is a standing, pre-registered prerequisite (§7.5.1) that no benchmark run can satisfy on its own — nothing in this repository's history shows that confirmation has happened. This condition is active regardless of what any evidence run measures. |
| 2 | No representative runtime | NOT active | `data.health[multi-process]` shows 750 measured windows, 748 T-a `DETERMINED` (2 `no-top-level-task-events`), 0 errors — §6.1.5b ran successfully and produced usable results. |
| 3 | Capacity censoring | NOT active (for R-cases) | Per Step 1, all capacity rejections are confined to S2/S3; no verdict-bearing R-case tuple is capacity-censored. |
| 4 | Workload validity (§5.5's unconfirmed ~10-instance workload; R3/R4/R6) | **CONDITIONAL — see "R6 branch" below, not asserted as a fourth unconditional cause** | §5.5 states this fires only "if the decision turns on them." The overall D verdict below is already fully established by conditions 1, 8, and 9 without invoking R3/R4/R6 at all (condition 9 fires at unconditional R1/R2 tuples that do not depend on the ~10-instance workload). Whether condition 4 is *additionally* active turns entirely on whether R6's workload is product-confirmed — a fact this task cannot determine from the repository. Reported as an explicit branch, not conflated with the no-boundary finding below (a prior draft of this document conflated the two; corrected per an independent codex-advisor review, see header). |
| 5 | Insufficient statistical confidence (§7.4.2 INCONCLUSIVE) | NOT active | Design states plainly this condition is "at present vacuous" — no M4 verdict condition currently invokes §7.4.2's effect rule at all, so it cannot be triggered by any evidence. |
| 6 | Missing causal attribution (§6.3 partition incomplete) | NOT active | Per Step 4, every §6.3 boundary row has populated, non-null `residualMs` statistics at every measured tuple; the partition is complete (only `occupancyMs`/`Hᵢ` is absent, which is expected pre-Phase-4, not a partition gap). |
| 7 | Unconfirmed memory multipliers (§15.3) | NOT active as a driver here | §15.3's 1.0×/2.0× multipliers remain provisional in the abstract, but this condition's own text ties its firing to "a B/C verdict depend[ing] on them" — since no B/C verdict is being reached (see Step 8), this condition does not independently drive the outcome. Not claimed as resolved; simply not load-bearing for this D. |
| 8 | Undetermined device/browser scope | **ACTIVE** | §7.5.8 (line ~538) states this "applies to A, B, and C alike" and fires when "the target was evaluated on a machine class not established as representative." Provenance records OS/Chromium version/launch flags for this specific run but nothing in the repository establishes this development machine as a representative product device class (§23 records this as an open question). Per §7.5's own text ("Where more than one applies, each is named separately") and §7.3's closing line ("no two of these causes are ever reported as if they were the same finding"), this is reported as an independent, coequal cause alongside 1 and 9 — not suppressed merely because D is already reached by other means. |
| 9 | No-full-query-evidence (§7.5.9) | **ACTIVE** | Fires at any verdict-bearing tuple whose only failing metrics are Tb1/Tb2/Tc with T-a passing. Proven by three **unconditional** multi-process tuples that do not depend on R3/R4/R6's workload confirmation: `R1/tlas/cold`, `R1/linear/cold`, `R2/linear/cold` (all `Ta:true`, `Tb2:false`). Design states one such tuple is sufficient to force the overall verdict to D (§7.3 lines ~463-465; §7.5.9 line ~539) — this condition alone, on R1/R2 evidence only, already forces D without needing R3/R4/R6 or R6's refresh-state T-a failure at all. |
| 10 | No-settled-boundary (§7.5.10) | Not separately invoked | This condition's scenario (a T-a-failing tuple whose screen passes but leaves no boundary SUFFICIENT) does not arise in this data: the one T-a-failing tuple pair (R6 refresh) has its screen **fail** outright (Step 6), which routes it to the distinct §1.1 no-boundary cause instead, not condition 10. |

**The distinct §1.1 *no-boundary* cause (separate from the ten §7.5 conditions, per §7.3's closing
paragraph and §1.1's own three-way distinction) — conditional on R6, reported as its own branch:**

At `R6/tlas/refresh` and `R6/linear/refresh`, §7.3 condition 3's boundary-independent screen
(`partition.screenResidualMs`, `Rᵢ(all,τ)`) is:

| Tuple | count | maxMs | over50msCount |
|---|---|---|---|
| R6 tlas refresh | 5 | 69.499 | 4/5 |
| R6 linear refresh | 5 | 69.418 | 4/5 |

Condition 3 requires this screen ≤ 50 ms as a **hard maximum across all five repetitions** (identical rule
to T-a itself); a single value over the line fails it, and here 4 of 5 repetitions exceed it at both arms.
Per design (line ~473): *"If the screen fails, no boundary in §8.2 can solve it: B and C are both
excluded ... and the verdict is D under §1.1's no-boundary cause."* **This is a decisive negative about the
architecture at these two tuples specifically** — distinct in kind from conditions 1/8/9 above, which are
evidence-scope/external-confirmation findings.

**R6 branch, stated explicitly per the codex-advisor correction (do not mix these two readings):**

- **If R6's ~10-instance workload is product-confirmed** (§5.5): R6 is verdict-bearing, its two refresh-arm
  T-a failures stand as verdict-bearing evidence, and the no-boundary cause above applies as an
  **additional**, architecture-level D finding. In this branch, §7.5 condition 4 does **not** separately
  fire (R6 is no longer "unconfirmed").
- **If R6's workload is not product-confirmed**: R6 is reclassified as a synthetic sensitivity case; its
  residual cannot independently force any verdict conclusion through §7.3, but this changes nothing about
  the overall D verdict, since D is already fully established by conditions 1/8/9 above without R6.

This task cannot determine from the repository which branch holds — product confirmation of the
~10-instance workload (§5.5, recorded as M4's own open question 3) is outside this evidence file's scope
and outside this task's authority to decide (per the user's standing directive not to change settled
semantics).

## Step 6: T-a-failing tuples; T-b/T-c-only failures

**T-a-failing tuples (multi-process, R-cases) — exactly two, both R6 refresh:**

- `R6 / tlas / refresh` — Ta worst 69.499 ms (> 50 ms)
- `R6 / linear / refresh` — Ta worst 69.418 ms (> 50 ms)

No other R-case tuple on the representative runtime fails T-a.

**T-b/T-c-only failing tuples (Ta:true, at least one of Tb1/Tb2/Tc:false) — nine tuples, all Tb2-only:**

| Case | Arm | State |
|---|---|---|
| R1 | tlas | cold |
| R1 | linear | cold |
| R2 | linear | cold |
| R3 | linear | cold |
| R3 | linear | warm |
| R4 | linear | cold |
| R4 | linear | warm |
| R6 | linear | cold |
| R6 | linear | warm |

(An earlier internal pass of this analysis miscounted this set at eight, omitting `R2/linear/cold` — caught
and corrected by the codex-advisor review cited in the header.) Of these nine, **three are unconditional**
(`R1/tlas/cold`, `R1/linear/cold`, `R2/linear/cold` — R1 and R2 are verdict-bearing unconditionally per
§5.2, no workload-confirmation question attaches to them); the remaining six (`R3`×2, `R4`×2, `R6`×2
non-refresh) share R6's §5.5 workload-confirmation dependency. None of the nine has Tb1 or Tc among its
failing metrics — every failure in this set is Tb2 alone.

## Step 7: Authorized Phase 4 spikes (reporting only — nothing built)

Applying the plan's own activation conditions (`docs/superpowers/plans/2026-09-09-...implementation.md:8716-8735`,
confirmed accurate) to the fresh evidence:

- **Task 4.1 (S5′, worker-termination spike): NOT authorized.** Its trigger requires "the topology the
  checkpoint's leading boundary candidate would use disposes of its worker by calling `terminate()`."
  There is no leading boundary candidate here at all — the one T-a-failing tuple pair already fails
  condition 3's screen outright (Step 6), which excludes every §8.2 boundary (B and C alike) at that
  tuple by construction. No topology is under consideration, so there is nothing for 4.1 to evaluate.

- **Task 4.2 (S6′, per-message overhead spike): AUTHORIZED on the current record.** Its trigger is "S1′
  passed (Phase 3.9) **and** §18's C1 cache option is not already analytically refuted." Per Step 1, S1′
  did not pass via the clean bare-specifier route, but it did pass via the explicitly permitted
  build-variant route (case (b) of §7.3 condition 8's three-case rule) — both the plan's own manual-
  verification criterion ("at least one of `bareResult`/`relativeResult`/`buildVariantResult` reports
  `{ok:true, hasThree:true, hasBvh:true}`", plan lines ~6900-6907) and design line ~488 define success this
  way. §18's own text describes C1 as "almost certainly fatal" but explicitly schedules it to be *measured
  first* (§18's evaluation order: "C1 first (measure it...)"), never as already analytically refuted — and
  §7.3 explicitly retired "C1 refuted by S6′" as a standalone narrative clause, meaning C1's status is
  settled only by actually running S6′. Both of 4.2's conditions are therefore met on this record.

- **Tasks 4.3–4.7 (S7′ verticals) and 4.8 (S8′): authorization depends on the same R6 branch named in
  Step 5, reported both ways rather than collapsed into one answer:**
  - **If R6 is product-confirmed:** the trigger ("the synchronous baseline fails §7.2's target at some
    verdict-bearing tuple with T-a among that tuple's failing metrics") is **literally met** — R6
    refresh's two tuples fail T-a. The plan's activation rule (lines 8720-8735) carries no
    residual-screen/mootness exception, so 4.3–4.7 (and, if built, 4.8) would be **literally authorized**
    by this trigger's own text. **However**, this authorization would be evidentially moot: condition 3's
    screen has already failed at both tuples where T-a fails, which per §7.3's own mapping already
    excludes B and C there outright — no S7′ evidence gathered at those tuples could change that outcome
    (a passing `Rᵢ(w,τ) + Hᵢ(w,τ) ≤ 50 ms` check for a narrower boundary `w` can never overturn a screen
    that already shows the boundary-independent, most-permissive union of every stage still exceeds 50 ms).
  - **If R6 is not product-confirmed:** no verdict-bearing tuple has T-a among its failing metrics (R6's
    tuples are reclassified synthetic; every other R-case tuple passes T-a), so 4.3–4.7's trigger is
    **not met**, and 4.8 (which additionally requires 4.3-4.7's worker to exist) is likewise not
    authorized.

**No spike was built, run, or modified for this task.** This section is reporting-only, per the brief's
explicit Step 7 instruction and this plan's Global Constraints ("no production worker architecture").

## Step 8: Provisional reducer result from the new VALID population only

**Manually derived — Task 2.5's automated reducer does not exist yet; this is not a code-invocation
result.**

Walking `evidenceRecords` (from `m4-gate-1789180565018.json` only — the sole valid, fresh, full-canonical-
matrix population per Task E1/E2) through §7.3's evidence→verdict mapping and §7.5's mandatory-D precedence
rules by hand, in the fixed precedence order §7.3 itself specifies (mandatory D first, before A/B/C are
even considered):

1. **Mandatory-D check (first, per §7.3's stated precedence — "Evaluate in this fixed order: mandatory D
   first ... before anything else"):** three unconditional conditions are active (Step 5): §7.5.1 (target
   unconfirmed — a standing external-confirmation gap, not resolvable by this or any benchmark run),
   §7.5.8 (representative device/browser scope undetermined — likewise a standing external-confirmation
   gap), and §7.5.9 (no-full-query-evidence, proven at three unconditional tuples: `R1/tlas/cold`,
   `R1/linear/cold`, `R2/linear/cold`, each `Ta:true`/`Tb2:false`). Per §7.5's own text, "Verdict D is
   required — not merely permitted — if any of the following holds," and per §7.3 lines ~463-465, a single
   such T-b-only-failing tuple already forces the overall verdict to D "even where other failing tuples
   would otherwise support B or C."

2. **Conclusion: since mandatory D fires (input: the three conditions above, rule: §7.5's "any of the
   following" clause plus §7.3's "mandatory D first" precedence), evaluation stops here.** A/B/C's own
   conditions (§7.3) are never reached for this run — not because they were checked and failed, but because
   §7.3's own precedence rule specifies mandatory D is checked "before anything else."

3. **Additional finding, reported alongside rather than substituted for the above (input: `R6 tlas/linear
   refresh`'s `Ta:false` plus `partition.screenResidualMs` showing 4/5 repetitions over 50 ms; rule:
   §7.3's condition-3 text, "If the screen fails ... the verdict is D under §1.1's no-boundary cause"):**
   **conditional** on R6's workload being product-confirmed (§5.5) — if confirmed, R6 refresh adds the
   distinct, architecture-level *no-boundary* cause to this same D verdict; if not, R6's finding stays a
   synthetic sensitivity result and does not itself add a cause (Step 5's "R6 branch").

**Provisional verdict: D.**

- **Unconditionally-supported causes:** §7.5.1 (no confirmed responsiveness target), §7.5.8 (undetermined
  representative device/browser scope), §7.5.9 (no-full-query-evidence, at `R1/tlas/cold`,
  `R1/linear/cold`, `R2/linear/cold`).
- **Conditionally-supported additional cause (branch on R6's product-confirmation status, §5.5):** if
  confirmed, add the §1.1 no-boundary cause (R6 refresh, both arms); if not confirmed, §7.5.4 (workload
  validity) would be the applicable label instead, but is not independently load-bearing since D already
  holds without it.
- **What this D means, stated per §1.2/§1.1's own framing:** this is **not** a claim that a worker
  architecture would fail to help M4's underlying question — §7.5.9's cause is explicitly "an
  evidence-scope limitation finding about M4's method, explicitly not a finding that no boundary would
  help," and §7.5.1/§7.5.8 are external-confirmation gaps unrelated to the measured architecture at all.
  Only the conditional R6 no-boundary finding (if R6 is confirmed) is a decisive architectural negative,
  and it is scoped to exactly the two `R6/refresh` tuples, not to the architecture generally.
- **What resolves it:** §7.5.1 and §7.5.8 need external product/organizational confirmation (a
  responsiveness target sign-off; a representative device/browser-class determination) that this task has
  no authority to produce. §7.5.9's gap is resolved only by the adoption milestone's own end-to-end
  measurement (§19.2), per design's own stated resolution path. R6's branch is resolved by the same §5.5
  product-confirmation process already recorded as M4's open question 3.

---

## Line-citation confirmations

Per the task brief's instruction to confirm cited line numbers before relying on them: all three
brief-cited locations were checked directly against the live files and found **accurate, no correction
needed**:

- `docs/superpowers/plans/2026-09-09-...implementation.md:8700-8741` — the Phase 3→4 decision checkpoint
  and its conditional-instantiation block, confirmed verbatim at these lines.
- `docs/superpowers/plans/2026-09-09-...implementation.md:8716-8735` — Phase 4 spike activation conditions
  (4.1 at 8716, 4.2 at 8718, 4.3–4.7 at 8720-8734, 4.8 at 8735), confirmed verbatim.
- `docs/superpowers/plans/2026-09-09-...implementation.md:8793-8794` — the `buildEvidenceRecord(...)`
  evidence-record schema, confirmed verbatim and confirmed to match the live schema actually emitted by
  `test/performance/run-gate-m4.mjs`/`test/performance/m4/evidence-report.mjs` in this evidence file.

Design-doc section citations used above (§5.2 ~178-205, §5.5 ~276-283, §6.3 ~368-387, §6.4 ~388-404, §7.2
~414-433, §7.3 ~435-502, §7.5 ~527-556) were likewise read directly rather than assumed, and matched their
described content.

## Files touched by this task

Only this document (`docs/research/m4-phase3-checkpoint-post-canonical-ordering-fix.md`). No file under
`collision/`, `test/`, or any script was read for modification purposes — `test/performance/run-gate-m4.mjs`
and `test/performance/m4/observation-envelope.mjs`/`evidence-report.mjs` were read-only, to verify the T-c
aggregation finding in Step 2 against live source rather than asserting it from the evidence JSON alone.
No gate or test was run; all evidence comes from the single pre-existing, Task E1/E2-validated JSON file
named in the header.
