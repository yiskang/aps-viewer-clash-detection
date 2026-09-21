# M4 Hard-Clash Precheck TLAS/Linear Parity Blocker — Root-Cause Investigation

**Status:** root cause established, proven by direct empirical reproduction *and* by a causal intervention through an existing internal test seam.
**Scope:** read-only investigation. No source was modified, nothing was committed, §6.4 was not touched, Phase 4 was not started.
**Disposition (Step 11):** `FIX_REQUIRED_BEFORE_M4_CAN_CONTINUE`

---

## 0. One-paragraph answer

The Hard-Clash precheck's `excluded` / `inconclusive` disposition — a **correctness-bearing** verdict, not a diagnostic — is decided by a **wall-clock** budget inside `properCrossingQuery`. For any candidate pair whose crossing traversal costs approximately `frameBudgetMs` (8 ms), whether the traversal completes or aborts is decided by machine timing at that instant, and an abort *suppresses a genuine proven overlap* (`ProperCrossingQuery.js:166`, `finalCrossing = aborted ? false : crossing`). The pair then falls out of `hardClashExcludedKeys`, so `statistics.clearanceHardClashExclusions` decreases by one and one extra public `clearance-hard-clash-precheck-inconclusive` diagnostic appears. This is **not** TLAS-vs-linear divergence at all: it reproduces **run-to-run within a single arm**. The observed 346-vs-347 gate failure is one sample of a continuously nondeterministic statistic. It is **not** the already-fixed `three-mesh-bvh` blocker (that defect lives in `closestPointToGeometry`, which this code path never calls), and it is **not** accounting-only. The §6.4 named exception does not and must not cover it.

---

## 1. Context and source of truth actually read

Landed code and captured artifacts were preferred over prose throughout.

| Source | Path |
|---|---|
| M4 design spec (§6.4, §12.4, §16.4, §19.1) | `docs/superpowers/specs/2026-09-08-collision-library-milestone4-performance-worker-decision-design.md` |
| M4 implementation plan / execution ledger | `.superpowers/sdd/2026-09-09-collision-library-milestone4-performance-worker-decision-implementation/progress.md` |
| Prior (now-fixed) blocker adjudication | `docs/research/m4-three-mesh-bvh-correctness-blocker-adjudication.md`, `docs/research/m4-three-mesh-bvh-patch-provenance.md` |
| Precheck | `collision/query/ClearanceHardClashPrecheck.js` |
| Composed overlap predicate | `collision/query/VolumeOverlapQuery.js` |
| Crossing term | `collision/query/ProperCrossingQuery.js` |
| Containment terms | `collision/query/ContainmentQuery.js` (`anyComponentInside`, `classifyPoint`, `constructedInteriorWitness`) |
| Witness term (not on this path) | `collision/query/SurfaceCrossingWitness.js`, `collision/query/ContainmentModeQuery.js` |
| Budgets / clocks | `collision/constants.js`, `collision/scheduler.js`, `collision/CollisionWorld.js:433-445` (`createComposedStageScheduler`) |
| Exclusion accounting | `collision/CollisionWorld.js:1763-1811`, `:2352-2506` |
| §6.4 comparator | `test/performance/m4/correctness-comparator.mjs` |
| Failing artifact | `test/performance/results/m4-gate-1789057417429.json` |
| Gate harness | `test/performance/run-gate-m4.mjs`, `test/performance/m4/fixture-lifecycle.mjs`, `test/performance/m4/counterbalancing-schedule.mjs` |

**Explicitly checked and rejected: this is not the prior blocker.** The already-patched `three-mesh-bvh@0.9.14` defects are the stale module-global `obb2` in `closestPointToGeometry*` and the `max[f2] → max[f3]` typo in `OrientedBox.distanceToBox`. The failing execution path here is `ClearanceHardClashPrecheck → volumeOverlapQuery → properCrossingQuery / anyComponentInside`, which reaches `bvhcast`, `raycast`, and `closestPointToPoint` — never `closestPointToGeometry`. Independently confirmed by the artifact itself: the S2 `k=100:typical:clearance` tuple now reports `distanceDiffCount: 0` and `witnessDiffCount: 0` (the prior blocker's signature was exactly a distance/witness divergence), and by the frozen-clock intervention in §3.3 below, which removes the divergence entirely without touching geometry.

---

## 2. Step 1 — The exact failing tuple, reproduced

### 2.1 What the artifact records

`test/performance/results/m4-gate-1789057417429.json` → `failedValidation`:

- runtime `historical`, case `S2`, variant `k=100:typical:clearance`, state `cold`, repetition `1`.
- Repetition 1 ⇒ `armOrderForRepetition(1) === ['linear','tlas']` (`counterbalancing-schedule.mjs:13-15`), i.e. **reversed**: linear ran first.
- Arm **A = TLAS** (`tlasBuilds: 3`, `broadPhasePairs: 1319`); arm **B = linear** (`tlasBuilds: 0`, `broadPhasePairs: 744673`).
- `fields`: `pairSet` ✅, `distances` ✅, `witnesses` ✅, `statistics` ❌, `diagnostics` ❌.
- `diagnosticsDiff`: exactly one entry, `inA: 1, inB: 0` —
  `{reason: 'clearance-hard-clash-precheck-inconclusive', scope: 'pair', sourceFragment: structure/dbId 3547/frag 363, targetFragment: arch/dbId 3551/frag 30}`.
  Diagnostic counts `a: 523, b: 522`.
- `statisticsDiff` on a §6.4-compared field: `clearanceHardClashExclusions` `a: 346, b: 347`.
  (`broadPhasePairs` and `tlasBuilds` also appear in the diff block but are **not** in the comparator's `STATISTICS_FIELDS` — `correctness-comparator.mjs:28` — so they are reported, never failing. The comparator is faithful to §6.4; this is a real failure, not a comparator artifact.)
- Every other §6.4 statistic (`clearanceExactAabbSurvivors`, `narrowPhasePairs`, `clearanceOverlapPrechecksRun`, `clearanceDistanceQueriesRun`, `clearanceHits`) is **equal**.

That signature is internally consistent with exactly one interpretation: **one fragment pair was `excluded` in the linear arm and `inconclusive` in the TLAS arm.** `clearanceOverlapPrechecksRun` equal ⇒ the precheck ran on both sides; `clearanceDistanceQueriesRun` equal ⇒ neither arm advanced the pair to the distance query (both `excluded` and `inconclusive` return before it, `CollisionWorld.js:2443-2454`).

### 2.2 Telemetry that was missing, named exactly

Step 1 asks for candidate order, geometry identity, matrices, AABBs, triangle/component counts, precheck `conclusive`, disposition, `inconclusiveCauses`, containment samples, budget counters and elapsed time. **None of it is in the artifact.**

The single cause is `test/performance/run-gate-m4.mjs:989`:

```js
sched.setDiagnosticEventRecorder(() => { diagnosticEventCount++; });
```

The gate installs the §16.4.2 diagnostic-event recorder but **discards every payload**, keeping only a count. The library *does* emit everything Step 1 asks for — `ClearanceHardClashPrecheck.js:31-38` reports a `hard-clash-precheck` / `volume-overlap-query` event carrying `conclusive`, `inconclusiveCauses`, `containmentSamplesUsed`, and `VolumeOverlapQuery.js:125-129, 192-197, 241-246` report per-stage `crossing` / `containment-a-in-b` / `containment-b-in-a` events with `ms` and triangle/component covariates. The failing artifact simply never retained them.

**No instrumentation was added.** The reproduction below installs a payload-retaining recorder through the already-landed `setDiagnosticEventRecorder` seam (`collision/scheduler.js:241`) — exactly the mechanism `test/performance/m4/structure-fragment-clearance-regression.mjs` and `test/CollisionWorld.diagnosticEvents.test.mjs` already use.

### 2.3 The reproduction

The failing query is fully replayable from the artifact's own provenance:
`provenance.runtimes[historical].cohorts.s2ByK["100"].typical.requestedDbIds === [2383]` (one assembly dbId expanding to 101 instances), `clearance: 0.05`, `targets: all`, `groupBy: 'dbId'` (`run-gate-m4.mjs:1803-1828`, `:1004-1011`).

Reproduction harness (throwaway, session scratchpad, **never added to the repo**): Chromium launched with the historical flags `['--no-sandbox','--disable-dev-shm-usage','--single-process','--no-zygote','--js-flags=--expose-gc']` (`fixture-lifecycle.mjs:11`), the gate's own 3-step federated Audubon load + URN re-confirmation + sacrificial warm-up, then one **fresh `CollisionWorld` per arm-run**, both arm orders, N repetitions.

**Captured for `structure:3547/frag363 → arch:3551/frag30`, identical in all 12 baseline runs:**

| Quantity | Value |
|---|---|
| Candidate position | index **317** of 1319, **identical in both arms** |
| Geometry identity | `sourceEpoch 2 / frag 363`, `targetEpoch 1 / frag 30` |
| Triangle counts | source **1474**, target **150** |
| Component counts | source **1**, target **1** |
| precheck `conclusive` | **false** |
| disposition | **`inconclusive`** |
| `inconclusiveCauses` | **`['crossing-budget-exhausted', 'non-manifold-component']`** |
| containment samples | `a-in-b: 1`, `b-in-a: 1`, total **2** (of a 512 budget) |
| stage `crossing` ms | **8.100** — the traversal-local wall clock, against `frameBudgetMs = 8` |
| stage `containment-a-in-b` / `b-in-a` ms | 0.1 / 0.1 |
| stage `volume-overlap-query` ms | 12.8 |
| cache state | cold (fresh world per arm-run) |
| contribution to `clearanceHardClashExclusions` | **0 when inconclusive; +1 when excluded** |

`crossing-budget-exhausted` is `properCrossingQuery`'s own abort reason (`ProperCrossingQuery.js:170`), surfaced through `VolumeOverlapQuery.js:329`. The measured 8.100 ms is the wall-clock budget being hit — slightly over 8 ms because the check precedes a probe that then completes (`ProperCrossingQuery.js:131-134`), and because this Chromium configuration coarsens `performance.now()` to 100 µs.

---

## 3. Steps 2, 3, 5 — Arm order, direct pair-level reproduction, and the wall-clock audit

These three steps collapse together because the answer to Step 2 falsifies the framing of the whole blocker.

**Three distinct experiment series were run. They are NOT interchangeable and their tables must not be cross-read** (a reviewer correctly caught an earlier draft that conflated them):

| Series | Purpose | Config | Runs |
|---|---|---|---|
| **S-1** | Arm-order / arm-type dependence (§3.1) | real clock, focus-pair events only | 6 reps × 2 arms = 12 |
| **S-2** | Crossing-`ms` ↔ outcome correlation (§3.4) | real clock, events for **every** candidate targeting arch frag 30 | 5 reps × 2 arms = 10 |
| **S-3** | Candidate-list equality + distance-query presence (§3.2) | real clock, plus `precheck-candidate-list` capture | 3 reps × 2 arms = 6 |
| **S-4** | Causal intervention (§3.3) | **frozen clock** `now: () => 0` | 3 reps × 2 arms = 6 |

Each series is an independent set of runs on the same machine and fixture; absolute exclusion values are comparable *within* a series, not across series.

### 3.1 Step 2 — Arm order does not matter. Neither does arm type. (Series S-1)

12 baseline runs (6 repetitions × 2 arms, alternating `tlas>linear` / `linear>tlas`), identical fixture, source, clearance and cold state:

| # | rep | order | arm | `clearanceHardClashExclusions` | precheck-inconclusive diagnostics | sum |
|---|---|---|---|---|---|---|
| 0 | 0 | tlas>linear | tlas | **344** | 525 | 869 |
| 1 | 0 | tlas>linear | linear | **346** | 523 | 869 |
| 2 | 1 | linear>tlas | linear | **345** | 524 | 869 |
| 3 | 1 | linear>tlas | tlas | **346** | 523 | 869 |
| 4 | 2 | tlas>linear | tlas | **346** | 523 | 869 |
| 5 | 2 | tlas>linear | linear | **345** | 524 | 869 |
| 6 | 3 | linear>tlas | linear | **345** | 524 | 869 |
| 7 | 3 | linear>tlas | tlas | **344** | 525 | 869 |
| 8 | 4 | tlas>linear | tlas | **344** | 525 | 869 |
| 9 | 4 | tlas>linear | linear | **346** | 523 | 869 |
| 10 | 5 | linear>tlas | linear | **344** | 525 | 869 |
| 11 | 5 | linear>tlas | tlas | **346** | 523 | 869 |

Findings, each load-bearing:

1. **The statistic varies run-to-run inside a single arm.** TLAS produced 344, 346, 346, 344, 344, 346. Linear produced 346, 345, 345, 345, 346, 344. Both arms span the same range. Classification follows **neither arm type nor execution order**.
2. **`exclusions + precheck-inconclusive-diagnostics = 869` in every single run.** Every flip moves exactly one dbId key between `excluded` and `inconclusive`; nothing is created or destroyed.
3. **Public pair set, `clearanceHits` and `clearanceDistanceQueriesRun` were constant** (258 / 258 / 286) across every run at every exclusion value.

Conclusion for Step 2: **the S2 `k=100:typical:clearance` TLAS-vs-linear comparison is not measuring a broad-phase difference at all.** It is sampling a statistic that is nondeterministic within one arm. The gate caught it because §6.4 compares two independent executions; a single-arm production run has nothing to compare against and would never notice.

### 3.2 Step 3 — Factor-at-a-time isolation

| Varied factor | Method | Result |
|---|---|---|
| 1. Same operands, repeated call, same predecessor | Same arm, consecutive repetitions, fresh world each | **Outcome flips.** Non-deterministic. |
| 2. Same operands, different predecessor | Alternated arm order (`tlas>linear` vs `linear>tlas`) | No systematic effect; flips occur under both orders. |
| 3. Same operands, different candidate position/order | TLAS vs linear candidate ordering | Candidate **multiset identical** (see below); ordering differs; no systematic effect. |
| 4. Fresh query/world/cache | Fresh `CollisionWorld` per arm-run (gate discipline) | Flips persist. Not a cache-state effect. |
| 5. Warmed cache | Sacrificial warm-up + repeated runs in one page | Flips persist. |
| 6/7. Wall-clock checks disabled via an **existing** seam | `CollisionWorld.fromViewer(viewer, { now: () => 0 })` — the seam `CollisionWorld.js:550, 657` already exposes and `test/CollisionWorld.findClashes.clearance.test.mjs:106` already uses | **Divergence disappears entirely.** See §3.3. |

**Candidate-list equality (closing the "different operands" alternative).** Using the already-landed `setSpikeInputCapture` / `precheck-candidate-list` seam (`collision/scheduler.js:257`, `CollisionWorld.js:1748-1761`), both arms' candidate lists were captured and compared as full identity tuples `(sourceLoadEpoch, sourceGeometryIndex, sourceFragmentId, targetLoadEpoch, targetGeometryIndex, targetFragmentId, targetEpoch)`:

- length **1319** in every run, both arms;
- **multiset identical across all runs and both arms** (sorted signatures byte-equal);
- **order differs** between TLAS and linear (raw signature sequences differ), and is stable within each arm;
- the four pairs of interest occupy the **same candidate index in both arms** (`frag364→30` at 207, `frag363→30` at 317, `frag413→30` at 390, `frag410→30` at 433).

So neither arm omits, duplicates, or role-reverses a candidate. Both arms hand `volumeOverlapQuery` the identical operand set.

### 3.3 The causal intervention — decisive

Repeating the identical experiment with the **existing internal test-seam clock** frozen (`CollisionWorld.fromViewer(viewer, { now: () => 0 })`), 6 runs, both arms, both orders:

**Correction, caught by an independent `codex-review` pass on this document:** `options.now` (and `options.yieldToScheduler`) are documented as internal test seams, not public API — `collision/README.md:96-98` states this explicitly: "internal test seams (clock/scheduler injection for this library's own unit tests) — not part of the supported developer API, even though nothing in JavaScript prevents passing them." An earlier draft of this section called it a "public seam"; that was wrong and is corrected here. This does not change the causal finding — the seam already existed, was not added for this investigation, and its use as an intervention is exactly the point — but it does mean any eventual fix design must separately decide whether `options.now`/`options.yieldToScheduler` are preserved, replaced, or formalized into a supported contract; today they carry no such guarantee.

| Runs | `clearanceHardClashExclusions` | precheck-inconclusive | focus pair `conclusive` | focus pair `inconclusiveCauses` |
|---|---|---|---|---|
| **all 6/6** | **347** (constant) | **522** (constant) | **true** | **`[]`** |

- **347** is exactly the value the linear arm reported in the failing gate run. It is the deterministic, geometry-determined ground truth. Every observed value below 347 is a wall-clock-induced false `inconclusive`.
- The focus pair `structure:3547/frag363 → arch:3551/frag30`, which was `inconclusive` in **all 12** real-clock runs, becomes **`conclusive: true` ⇒ `excluded`** with the abort branch neutralised. Its real crossing cost measured 4.8–5.1 ms in this configuration.
- Caveat, recorded honestly: a frozen clock also disables scheduler-driven yielding (`createFrameBudgetAccumulator.isDue()` can never fire), so the query runs without checkpoints. This changes the overhead profile but not the conclusion — it removes exactly one semantic branch and the divergence goes with it.

### 3.4 The correlation, measured directly (Series S-2)

Joining each pair's `crossing` stage event (`ms`) with its later `volume-overlap-query` event (`conclusive`), for every candidate whose target is arch fragment 30. **These are Series S-2 runs — a different set of executions from the Series S-1 table in §3.1**, so the exclusion column is not row-comparable with that table.

| S-2 run | frag364→30 | frag363→30 | frag413→30 | frag410→30 | exclusions |
|---|---|---|---|---|---|
| rep0 tlas | 7.30 ✅ | **8.10 ❌** | **8.10 ❌** | **8.10 ❌** | 344 |
| rep0 linear | 5.10 ✅ | **8.10 ❌** | **5.70 ✅** | **7.30 ✅** | **346** |
| rep1 linear | 5.30 ✅ | **8.10 ❌** | **8.10 ❌** | **8.10 ❌** | 344 |
| rep1 tlas | 7.30 ✅ | **8.10 ❌** | **8.10 ❌** | **8.10 ❌** | 344 |
| rep2 tlas | 6.10 ✅ | **8.10 ❌** | **8.10 ❌** | **8.10 ❌** | 344 |
| rep2 linear | 6.60 ✅ | **8.10 ❌** | **8.10 ❌** | **8.10 ❌** | 344 |
| rep3 linear | 6.30 ✅ | **8.10 ❌** | **8.10 ❌** | **8.10 ❌** | 344 |
| rep3 tlas | 7.20 ✅ | **8.10 ❌** | **8.10 ❌** | **8.10 ❌** | 344 |
| rep4 tlas | 7.70 ✅ | **8.10 ❌** | **8.10 ❌** | **8.10 ❌** | 344 |
| rep4 linear | — | **8.10 ❌** | **8.10 ❌** | **8.10 ❌** | 344 |

(✅ = `conclusive: true` ⇒ `excluded`; ❌ = `conclusive: false` ⇒ `inconclusive`.)

The rule is exact and without exception across every observation in every series: **crossing stage `ms` < 8 ⇒ `conclusive: true` ⇒ `excluded`; crossing stage `ms` = 8.10 (budget tripped) ⇒ `conclusive: false` ⇒ `inconclusive`.**

The arithmetic closes exactly, twice, in two independent series:

- **S-2, `rep0 linear`** — the one S-2 run where two extra pairs finished under budget (`frag413` at **5.70 ms**, `frag410` at **7.30 ms**, both `conclusive: true`) is exactly the S-2 run reporting `exclusions = 346` against that series' otherwise-uniform 344. `344 + 2 = 346`.
- **S-3, `rep1 linear`** — independently, the one S-3 run where the same two pairs finished under budget (`frag413` at **5.80 ms**, `frag410` at **6.30 ms**) is exactly the S-3 run reporting `exclusions = 346` against that series' otherwise-uniform 344.

`frag364→30` is the control: identical operands, measured between **5.10 ms and 7.70 ms** across S-2 runs, `conclusive: true` throughout. A ~2.6 ms run-to-run spread on identical geometry is far more than enough to carry a nominally-8 ms traversal across the threshold in either direction. (The one S-2 row with no `frag364` entry is `rep4 linear`, where that candidate's crossing stage measured at or below the 5 ms cut-off applied when tabulating; it is a reporting threshold, not a missing evaluation.)

### 3.5 Step 5 — Full budget audit of the precheck path

Every budget reachable from `ClearanceHardClashPrecheck`:

| Budget | Where | Clock source | Injected? | Kind | Reset scope | Earlier candidates influence later? | Sensitive to JIT/GC/scheduling? | TLAS-vs-linear exposure | Affects |
|---|---|---|---|---|---|---|---|---|---|
| `frameBudgetMs = 8` **crossing time budget** | `ProperCrossingQuery.js:39-46, 84, 131` | `options.now`, supplied as `this._now` by `CollisionWorld.js:2433`; default `performance.now` | Yes (`now` only — **`frameBudgetMs` is never overridden by any caller**) | **WALL CLOCK** | Per traversal (`traversalStart = now()` at entry) | Not directly; indirectly via JIT/GC/allocation state | **Yes** | Different candidate order ⇒ different machine state at this pair | **SEMANTIC** — suppresses a proven crossing (`:166`), flips `conclusive`, flips `excluded`→`inconclusive` |
| `maxCandidatePairsExamined = 50_000` | `ProperCrossingQuery.js:37, 84` | — | Yes | Operation count | Per traversal | No | No | None | Semantic, but **deterministic** on identical operands |
| `maxCrossingPairsExamined = 64` | `ProperCrossingQuery.js:38, 113` | — | Yes | Operation count | Per traversal | No | No | None | Semantic, but **deterministic** |
| `maxContainmentSamples = 512` | `ContainmentQuery.js:172, 278, 448, 466` | — | Yes | Operation count | Per `anyComponentInside` call | No | No | None | Semantic, but **deterministic** |
| `maxWitnessTriangles = 8`, `samplesPerComponent = 8` | `ContainmentQuery.js:173-174` | — | Yes | Operation count | Per component | No | No | None | Deterministic |
| Composed-stage scheduler `elapsedMs` | `CollisionWorld.js:433-445` | `this._now` | Yes | Wall clock | Per pair, reset on real yield | Yes | Yes | Yes | **Yielding only.** `anyComponentInside` never reads `elapsedMs` — only `checkpointIfDue()`. **No verdict depends on it.** |
| Per-call frame-budget accumulator | `scheduler.js:98-108` | `this._now` | Yes | Wall clock | Per `findClashes` call | Yes | Yes | Yes | **Yielding only.** |

**Reachability check, done explicitly:** `SurfaceCrossingWitness` (`SurfaceCrossingWitness.js:80`, `timeExceeded = () => scheduler.elapsedMs() > timeBudgetMs`) is a second verdict-changing wall-clock branch, but it is called **only** from `ContainmentModeQuery.js:95` (`mode: 'containment'`). `volumeOverlapQuery` never routes through it — grep of all callers confirms, and `VolumeOverlapQuery.js:52` says so in its own comment. **It is not implicated here.**

**Verdict for Step 5, in the prompt's own terms:** the same operands produce `excluded` in one run and `inconclusive` in another purely as a function of wall-clock timing. Per the prompt's rule, this is **production correctness nondeterminism, not benchmark noise.** It is present in ordinary single-arm production use of `mode: 'clearance'`; M4's dual-arm methodology is merely what made it visible.

**Decisive in-repo corroboration.** This exact causal mechanism is already documented, verbatim, in an existing code comment at the call site that supplies `this._now` as the crossing term's clock (`CollisionWorld.js:2422-2432`, immediately above the `crossing: { now: this._now }` option at `:2433` cited in the table above):

> Task reviewer fix (Important #1, fix round): without this, ProperCrossingQuery.js's own `options.now ?? (() => performance.now())` default (ProperCrossingQuery.js:40) reads the REAL wall clock inside this precheck's own volumeOverlapQuery call, independent of this call's own injected `_now` test seam -- an 8ms real-time stall (GC, parallel test load) mid-traversal can abort the crossing term and flip a genuine proven overlap into 'inconclusive', making the Hard-Clash exclusion precheck (and anything that depends on it, e.g. clearanceHardClashExclusions) nondeterministic under a frozen/fake test clock. Reusing this call's own `this._now` here closes that gap for clearance's own precheck call site. The IDENTICAL exposure pre-exists, unfixed, in the three pre-existing modes' own volumeOverlapQuery call in _runNarrowPhasePair -- out of scope here, their code path is a Protected Invariant and must stay byte-for-byte unchanged.

This is independent, in-repo, already-committed corroboration of the causal mechanism this investigation derived empirically (§2.1, §3.3, §3.4). The comment is attached to the exact code path under investigation — the clearance mode's own call from `CollisionWorld.js` into `classifyHardClashPrecheck` → `volumeOverlapQuery` — and states, in its own words, written before this investigation began, that an 8 ms real-time stall mid-traversal can abort the crossing term and flip a genuine proven overlap into `inconclusive`, making `clearanceHardClashExclusions` nondeterministic. The fix the comment documents (forwarding this call's own `this._now` into `crossing: { now }`) closed a *test*-determinism gap only — without it, a test built on a frozen/injected clock could still have the crossing term silently read the real wall clock by its own default — it did not, and was never intended to, eliminate the underlying production nondeterminism: in production `this._now` defaults to real `performance.now`, so the exact 8 ms-stall mechanism this investigation reproduced empirically (§3.3, §3.4) is precisely what this comment already describes as live and unaddressed on this call site. The comment's own closing sentence goes further, stating the identical exposure "pre-exists, unfixed" at the three pre-existing modes' own `volumeOverlapQuery` call in `_runNarrowPhasePair` — the Protected Invariant path this document's §8/§8.1 already cite at `:2430-2432` for a related but distinct reason (scope of an eventual fix, not root cause). Because the empirical S-1…S-4 run series in §2–§3 live only in an uncommitted session-scratchpad harness that no reviewer can re-run, this tracked, already-landed comment is what makes the causal claim independently verifiable by anyone reading only tracked files.

---

## 4. Step 4 — Exclusion accounting traced

```
CollisionWorld.js:2436   precheck = await classifyHardClashPrecheck(...)
             :2442       if (status !== 'skip-precheck') statistics.clearanceOverlapPrechecksRun++
             :2443-2445  if (status === 'excluded') return { outcome: 'hard-clash-excluded' }
             :2446-2454  if (status === 'inconclusive') push pair-scoped diagnostic; return { outcome: 'inconclusive' }
             :1787-1790  if (outcome === 'hard-clash-excluded') hardClashExcludedKeys.add(key); continue
             :1805       statistics.clearanceHardClashExclusions += hardClashExcludedKeys.size
```
with `key = ${sourceEpoch}:${sourceOwnerDbId}:${targetEpoch}:${targetOwnerDbId}` (`:1786`).

Answering Step 4's questions directly:

- **Which disposition increments it?** Only `'hard-clash-excluded'`, i.e. only `classifyHardClashPrecheck` returning `{status: 'excluded'}`, i.e. only `volumeOverlapQuery` returning `overlap === true` (`ClearanceHardClashPrecheck.js:40-42`). `skip-precheck`, `proceed`, and `inconclusive` never contribute.
- **Can `conclusive: false` still increment it?** **No.** Every `overlap: true` return in `VolumeOverlapQuery.js` (`:154`, `:210`, `:259`) sets `conclusive: true` unconditionally. `excluded` and `conclusive: false` are mutually exclusive by construction.
- **Can diagnostics and exclusion count legitimately diverge?** In principle yes — exclusions are counted at **dbId-pair** granularity (a Set of keys) while `clearance-hard-clash-precheck-inconclusive` diagnostics are emitted at **fragment-pair** granularity, one per evaluation. On this fixture the two happen to move 1:1 (the `exclusions + inconclusive = 869` invariant in §3.1). That invariant is empirical, not structural — do not rely on it in a regression test.
- **Does candidate order change dedup/winner behaviour?** **No.** `hardClashExcludedKeys` is a `Set` (order-free, `.size` order-independent), and `compareClearanceCandidates` (`CollisionWorld.js:256-262`) is a total order on `(distance, comparePlacedCanonically(source), comparePlacedCanonically(target))` — explicitly designed so "the winner never depends on which fragment pair the broad phase happened to visit first".
- **Can one arm evaluate or skip a pair differently?** **No.** Verified empirically in §3.2: identical 1319-candidate multiset in both arms, and `narrowPhasePairs` / `clearanceOverlapPrechecksRun` equal in the failing artifact.

**Is this accounting-only? No — and that is provable separately.** The accounting code is correct and order-independent; it is faithfully reporting a **semantic** input that is itself nondeterministic. `hardClashExcludedKeys` is not only a counter: `CollisionWorld.js:1808-1811` uses it to **suppress dbId keys from the public `pairs` array**. So a flip in this set is structurally capable of adding or removing a public clearance pair whenever a dbId key carries both a borderline overlap-proving fragment pair and a separate clearance-hit fragment pair. That did not occur on this fixture (`pairs` was constant at 258 across every exclusion value from 344 to 347), so **the observed incident is confined to statistics + diagnostics** — but the mechanism is not.

---

## 5. Step 6 — Traversal/candidate-order dependence and shared mutable state

**Candidate position.** Identical in both arms for every pair examined (§3.2). Candidate *ordering* differs between arms overall but is stable within an arm; the flips occur within a fixed ordering, so ordering is not the mechanism.

**Explicit search for shared mutable state analogous to `obb2`:**

| Module-level scratch | File | Assessment |
|---|---|---|
| `_triA, _triB, _line, _mid, _dir, _probe, _probeInB, _nA, _nB` | `ProperCrossingQuery.js:18-26` | `properCrossingQuery` contains **no `await`** — the whole `bvhcast` is synchronous, so two uses can never interleave. `_line` staleness is already explicitly guarded (`:110`, round-4 regression). `_probe` is `.clone()`d before escaping (`:147`). **Not implicated.** |
| `_point, _wa, _wb, _wc, _wCentroid, _wNormal, _wEdge1, _wEdge2, _wProbe, _wProbeInTarget` | `ContainmentQuery.js:122-131` | Each is written and consumed within one synchronous span between `await scheduler.checkpointIfDue()` calls; `witnessPoint` is `.clone()`d (`:300`, `:478`). Only one `findClashes` runs at a time per world in the gate, so no interleaving source exists. **Not implicated.** |
| `_worldPoint` | `VolumeOverlapQuery.js:33` | Copied into an owned plain array synchronously (`:37-39`). **Not implicated.** |
| `_spanRecorder`, `_yieldRecorder`, `_diagnosticEventRecorder`, `_spikeInputCapture` | `scheduler.js:36-263` | Module-level, but generation-isolated and verdict-free; recorders only observe. Cleared in `finally` in every harness used here. **Not implicated.** |
| `three-mesh-bvh` `bvhcast` `_active` flag | vendored | Already defended against by `ProperCrossingQuery.js:61-77`'s catch-and-rethrow-after-return. **Not implicated.** |
| `obb2` in `closestPointToGeometry*` | vendored, **already patched** | Unreachable from this code path. **Not implicated.** |

The frozen-clock intervention (§3.3) independently rules the whole class out: shared mutable state would not be neutralised by changing the clock.

---

## 6. Step 7 — Crossing separated from containment

For `structure:3547/frag363 → arch:3551/frag30`, recorded independently per stage:

| Substage | Result | Inputs identical across runs? |
|---|---|---|
| `properCrossingQuery` | `aborted: true`, `crossing` forced to `false` (`:166`), diagnostic `crossing-budget-exhausted` — **8.100 ms**, wall-clock budget tripped | **Yes** — same BVHs, same `matrixBtoA`, same `localDiagonal`s, same candidate index |
| containment A-in-B | `inside: false`, `samplesUsed: 1`, `budgetExhausted: false`, 0.1 ms | Yes |
| containment B-in-A | `inside: false`, `samplesUsed: 1`, `budgetExhausted: false`, 0.1 ms | Yes |

**Matrix/AABB values, named exactly as missing.** The "same `matrixBtoA`, same `localDiagonal`s" row above asserts *equality* between arms, not the underlying numeric values — those values were not captured. The reproduction harness that produced this table was, per the read-only constraint (§12), written to the session scratchpad and never committed, and no numeric matrix/AABB dump was retained from it in this document or elsewhere in the repo; only the derived equality/identity facts (candidate index, geometry identity, triangle/component counts, and — separately, via the `precheck-candidate-list` capture in §3.2 — full identity-tuple equality of the whole 1319-candidate multiset across arms) were recorded before the harness was discarded. Per the prompt's own Step 1 instruction ("If telemetry is insufficient, state exactly what is missing"): the actual `matrixBtoA` and `localDiagonal` numeric values for `structure:3547/frag363 → arch:3551/frag30` are not available in any tracked artifact or in this document, and reproducing them would require re-running the live-viewer harness (federated Audubon fixture, real APS credentials) again, which is out of scope for this documentation-only pass. The equality claim itself is not weakened by this gap — it rests on the candidate-index/geometry-identity/triangle-count agreement above plus the independent multiset-identity proof in §3.2 — but the specific numeric values are not reproducible from what is currently recorded.

**The first substage whose result differs is `properCrossingQuery`, and its inputs are identical.** Both containment terms are deterministic, resolve in one sample each, and never approach their 512-sample budget — containment is entirely exonerated. (`non-manifold-component` also appears in `inconclusiveCauses`, but it is a *taint* evaluated only on the negative path (`VolumeOverlapQuery.js:298-301`); when the crossing term completes and finds a crossing, `volumeOverlapQuery` returns `overlap: true, conclusive: true` at `:154` before that check is ever reached. Confirmed empirically: the same pair is `conclusive: true` under a frozen clock despite the same non-manifold geometry.)

---

## 7. Step 8 — Re-evaluating the §6.4 diagnostic carve-out

The §6.4 exception (spec line 402) is confined to `crossing-budget-exhausted` and `inconclusive-crossing`, justified on the grounds that the abort "depends on machine speed at that instant, never on geometry or on which broad phase produced the pair", and treats it as diagnostic-only.

**Classification: B — genuine semantic precheck divergence.**

Three reasons, each independently sufficient:

1. **The carve-out's own precondition is violated.** Its text is explicit: "A divergence that includes even one diagnostic entry outside `{crossing-budget-exhausted, inconclusive-crossing}`, **or any difference in pair set, statistics, distances, or witnesses**, remains `FAILED_VALIDATION`." `clearanceHardClashExclusions` — a §6.4-compared statistic — differs. The carve-out does not reach this case even on its own terms.
2. **The reason string is laundered.** `classifyHardClashPrecheck` **discards `overlapResult.diagnostics` entirely** (`ClearanceHardClashPrecheck.js:45-47`) and emits only the generic `clearance-hard-clash-precheck-inconclusive`. So on the clearance path the wall-clock nondeterminism can never surface under either carve-out reason. The carve-out was written against the three pre-existing modes' `_runNarrowPhasePair`, which does `attach(result.diagnostics)` verbatim (`CollisionWorld.js:2288`) — it structurally cannot describe the clearance precheck.
3. **The abort is not diagnostic-only on this path.** It changes `conclusive`, therefore the precheck disposition, therefore `clearanceHardClashExclusions`, therefore (structurally, via `CollisionWorld.js:1808-1811`) which dbId keys may appear in the public `pairs` array.

Additionally, the carve-out's factual premise ("never on ... which broad phase produced the pair") is *weakened* by the artifact itself: 4 of the 5 recorded `TIME_BUDGET_DIAGNOSTIC_DIVERGENCE` findings in the same run put the extra `crossing-budget-exhausted` on the TLAS arm. The §3.1 within-arm data shows the real story is that arm type is irrelevant *because the statistic is nondeterministic in both arms* — which is worse for the carve-out, not better.

> **Because this is case B, the existing carve-out must NOT be widened.**

It should arguably be **narrowed** as part of the fix (see §8, option B), but that is a spec decision for the milestone owner, and nothing in this investigation changes §6.4 as it stands.

---

## 8. Step 9 — Minimum fix class (analysis only; nothing implemented)

The defect is: **a wall-clock budget gates a correctness-bearing verdict.** The fix must make the *semantic* result deterministic. Options, against the prompt's taxonomy:

### Option A — Deterministic operation/sample budget (replace the wall-clock crossing budget)
Drop `now() - traversalStart > timeBudgetMs` and rely solely on `maxCandidatePairsExamined` / `maxCrossingPairsExamined`, retuned so the worst-case traversal remains bounded.

- **Correctness:** fully deterministic; identical operands always give identical verdicts. ✅
- **Public contract:** `crossing-budget-exhausted` becomes deterministic rather than disappearing. Some pairs currently aborted would now complete (or abort at a different point), changing published results — a **behaviour change on all four modes**, including M1/M2's shipped `volume-overlap`.
- **Performance:** removes the only guard against a pathological traversal that is cheap in pair count but expensive in probe cost. The measured 8 ms spread on `frag364` shows per-candidate cost is not well predicted by count alone. **Risks a real frame-budget regression** — directly against §4's shipped `frameBudgetMs = 8` convention and M4's own X-1 axis.
- **M1–M3 impact:** high. `_runNarrowPhasePair`'s `volume-overlap` path is a **Protected Invariant** (`CollisionWorld.js:2430-2432`).
- **Scope:** library-wide behaviour change. **Regression surface:** every `ProperCrossingQuery` test, every `volume-overlap` acceptance result, M2/M3 gate baselines.

### Option B — Wall-clock breach becomes observational; the semantic verdict is decided by a deterministic bound ⭐ **recommended direction**
Stop letting the wall clock decide `conclusive`. The crossing term's verdict must be a function of the operands and of deterministic operation counts only; a wall-clock breach may be *recorded* (as a span, a covariate, or a distinct non-semantic field) but must not alter `crossing`, `aborted`, or `conclusive`.

- **Correctness:** ✅ makes the semantic result independent of machine timing, which is precisely the defect.
- **Public contract:** the `clearance-hard-clash-precheck-inconclusive` rate drops (measured: 525 → 522 on this query; exclusions rise to the deterministic 347). That is a *strict improvement in completeness* — the current behaviour reports false `inconclusive`s. Needs an explicit `CHANGELOG` note.
- **Performance:** the traversal must still be bounded, so this option is only sound combined with a deterministic bound that actually tracks cost. **Correction to an earlier draft of this section, caught in independent review:** it is *not* accurate to describe this as "wall clock decides when to pause". There is no pause. `properCrossingQuery` contains no `await`, and `three-mesh-bvh`'s `bvhcast` is synchronous with no continuation token — returning truthy from `intersectsTriangles` *terminates* the traversal, it does not suspend it (this is the same fact §5 relies on to rule out interleaved scratch state). Removing the time-based termination therefore means accepting a **longer non-preemptible synchronous span**, which collides directly with §4's inherited `frameBudgetMs = 8` / 24.8 ms conformance ceiling and with M4's own X-1 axis. That tension is real and is the single hardest part of this fix.
- **M1–M3 impact:** moderate-to-high; touches the shared `ProperCrossingQuery`, so the Protected-Invariant `volume-overlap` path changes behaviour too. That is arguably *correct* — the same nondeterminism exists there today (the artifact's 5 `TIME_BUDGET_DIAGNOSTIC_DIVERGENCE` findings are exactly it) and is merely tolerated by the carve-out — but it is a milestone-owner decision, not an implementation one.
- **Scope:** targeted at the actual defect, but **not narrow**: see §8.1 for the decisions it forces open. **Regression surface:** `ProperCrossingQuery` budget tests (`test/query/ProperCrossingQuery.test.mjs:127`, `:194` both assert the current wall-clock abort semantics and would need to be re-expressed), `VolumeOverlapQuery.conclusive.test.mjs`, the M2/M3 gates.
- **Spec consequence:** §6.4's `TIME_BUDGET_DIAGNOSTIC_DIVERGENCE` exception could then be **narrowed or deleted**, because the divergence it excuses would no longer be able to occur. That is the cleanest end state.

### Option C — Reset/isolate per-pair budget state
**Not applicable as a fix.** `traversalStart` is *already* per-traversal (`ProperCrossingQuery.js:46`) and containment budgets are already per-call. There is no leaked budget state to isolate; the nondeterminism is in the clock, not in the scope.

### Option D — Eliminate shared mutable state
**Not applicable.** §5 rules the entire class out, and the frozen-clock intervention independently disproves it.

### Option E — Statistics accounting-only fix
**Rejected — would be a cover-up.** The accounting is correct (§4). Changing how `clearanceHardClashExclusions` is derived would hide a nondeterministic *verdict* behind a stable *number*, and would not touch the structurally-reachable public-`pairs` exposure.

### Option F — Traversal/order-dependence fix
**Not applicable.** Candidate multisets are identical across arms and the flips occur within a fixed ordering (§3.2).

### Option G — Another narrow correction
Two adjacent, genuinely useful items that are **not** the fix and must not be mistaken for it:

- **G1 (harness, recommended alongside):** `run-gate-m4.mjs:989` should retain the diagnostic-event payloads for the failing tuple (or at least `conclusive` / `inconclusiveCauses` per pair). Without it, every future §6.4 precheck failure is un-diagnosable from the artifact alone, exactly as this one was. Harness-only, no `collision/` change, no verdict impact.
- **G2 (diagnostic fidelity):** `classifyHardClashPrecheck` discarding `overlapResult.diagnostics` is what let a carve-out reason surface under a non-carve-out name. Propagating the real cause would make §6.4's classification honest. **Note carefully:** doing G2 *without* the semantic fix would make the divergence eligible for the existing carve-out and would silently convert a real correctness defect into a tolerated finding. **G2 must never land before or without a real fix.**

**Recommended fix class: B (wall-clock breach becomes observational, semantic verdict decided by a deterministic bound), with G1 as a companion harness change.** Do not retune `frameBudgetMs` or any threshold to make the gate pass — the borderline pairs sit *at* 8 ms, so any retune merely relocates the cliff.

### 8.1 What Option B does NOT settle — decisions required before any implementation

Step 9 asks for a fix *class*, not a fix, and this section deliberately stops there. An independent `codex-review` of this document (§11) correctly judged that Option B as stated is **not yet an implementable specification**. That assessment is accepted. The following must be decided — by the milestone owner, in the design spec, not by an implementer — before a line is written:

1. **The normative algorithm at a wall-clock breach.** Does the traversal continue to deterministic exhaustion, or return immediately with a deterministic result? Today's text permits both, and they differ in correctness *and* in worst-case span.
2. **The continuation architecture.** Given `bvhcast` is synchronous and non-resumable, exactly one of: (a) continue synchronously and accept a longer non-preemptible span; (b) build a resumable traversal (fork or replace the vendored cast); (c) move the whole atomic traversal to a worker. (c) is not accidental — it is precisely the kind of question M4 exists to decide, and this blocker is now direct evidence for §8's worker-boundary discussion. Whether the vendored dependency may be modified must be stated.
3. **The replacement bound and its units.** `maxCandidatePairsExamined = 50_000` and `maxCrossingPairsExamined = 64` bound *pairs*, not probe cost, and this investigation shows pair count predicts elapsed cost poorly (`frag364`: identical operands, 5.10–7.70 ms). A deterministic bound that actually tracks cost — e.g. counting `classifyPoint` probes — plus its value, plus a stated maximum synchronous span on adversarial geometry, must be specified.
4. **The post-fix return contract.** A truth table over {wall-clock breach} × {deterministic exhaustion} × {crossing found} × {boundary ambiguity}, defining `crossing`, `aborted`, `inconclusive`, `conclusive`, `witnessPoint` and the emitted diagnostic reason for every cell. In particular: does a breach still set `aborted` (today it means *semantic incompleteness*, and `VolumeOverlapQuery.js:296` reads it as such), or does it need a distinct non-semantic field such as `timeBudgetExceeded`? Reusing `crossing-budget-exhausted` for a traversal that was not actually exhausted would be actively misleading.
5. **Authorized scope vs. the Protected Invariant.** `CollisionWorld.js:2430-2432` declares the three pre-existing modes' `volume-overlap` path byte-for-byte unchangeable. Either that is amended (and an M1–M4 compatibility matrix is required), or the correction is gated clearance-only (and the same nondeterminism is knowingly left in the other modes, which must then be stated as accepted rather than overlooked).
6. **The status of `347`.** It is the deterministic ground truth *for this fixture at this model version*, established in §3.3 — a regression expectation, **not** a normative constant. A fixture or model-version change may legitimately change it; a test asserting it must pin the fixture version and must assert *stability across runs* as its primary contract, with the literal value secondary.

---

## 9. Step 10 — Required deterministic regression tests

Tests must distinguish **diagnostic-only**, **semantic**, and **accounting** nondeterminism. A test that only asserts a count is not sufficient.

**A critical pre-existing gap to close first:** the clearance unit tests that exercise the precheck construct their world with a **frozen** clock — `test/CollisionWorld.findClashes.clearance.test.mjs:106` `function frozenClock() { return () => 0; }`, used at all 12 `freshWorld` call sites there, and likewise in `CollisionWorld.clearanceStatistics.test.mjs` (6 sites) and `CollisionWorld.clearanceAdmissionValidation.test.mjs` (8 sites). That is exactly the configuration in which this defect **cannot** manifest. The two clearance test files that do *not* freeze the clock (`CollisionWorld.clearanceBudget.test.mjs`, `CollisionWorld.precheckNotRunReason.test.mjs`) use synthetic geometry so small that an 8 ms crossing traversal is unreachable. That combination is why 1000+ green tests never caught it. New tests must exercise a *controlled advancing* clock against operands whose traversal cost can actually reach the budget.

1. **Exact failing pair — live regression, plus a committed deterministic backstop.** `structure:3547/frag363 → arch:3551/frag30` against the real federated Audubon fixture, both arms, asserting the pair's precheck is `conclusive: true` / `excluded`. Model it on the existing `test/performance/m4/structure-fragment-clearance-regression.mjs` (same URNs, same `setDiagnosticEventRecorder` seam, same "not a `node --test` file" convention). Ground truth established here: with the abort branch neutralised the pair is a **proven overlap**, and the query's deterministic `clearanceHardClashExclusions` is **347** — pinned to this fixture version, per §8.1 item 6. **The live test alone is not a sufficient CI guard**: it needs a live dev server, APS credentials and remote model availability, so it will be skipped exactly when it would have caught a regression. Pair it with a committed deterministic fixture — a captured operand pair (if licensing permits) or a synthetic equivalent whose crossing traversal is expensive enough to be budget-relevant — exercised under a controlled advancing clock in the ordinary `node --test` suite.
2. **Pair-level order independence.** Same operands through both TLAS and linear, and in both arm orders, asserting identical precheck disposition, identical `inconclusiveCauses`, identical `containmentSamplesUsed`. Pure unit level is achievable: build two operands and call `volumeOverlapQuery` directly with `crossing: { now }` supplying an *adversarial but deterministic* clock (the seam already exists — `ProperCrossingQuery.js:40`, exercised by `test/query/ProperCrossingQuery.test.mjs:136, 209`).
3. **S2 `k=100:typical:clearance` TLAS/linear parity.** The full §6.4 comparison on that tuple, run repeatedly, must pass every time — not once. **A single passing run is not evidence**; the failure rate observed here was roughly 1 run in 6 producing an *extreme* value, with the middle values far more common.
4. **`clearanceHardClashExclusions` equality — and stability.** Two assertions, not one: (a) equal between arms; (b) **equal across N ≥ 10 repeated runs of the same arm.** (b) is the one that actually detects this defect class; (a) alone would have passed on many of the 12 baseline runs above by luck.
5. **Deterministic diagnostic behaviour under budget exhaustion.** With a deterministic clock that trips the budget at a chosen read count, assert the emitted diagnostics and `inconclusiveCauses` are byte-stable, and — the load-bearing part — that the **semantic** disposition (`excluded` / `proceed` / `inconclusive`) is whatever the fix defines it to be, *independently of when the clock trips*.
6. **Containment budget regression — not implicated, but pin it.** Assert `anyComponentInside` has no wall-clock dependence: identical result under a frozen clock, a fast clock, and a clock that jumps by 10 s per read. Cheap, and pins the §3.5 audit against future drift.
7. **`ProperCrossingQuery` budget regression.** The existing tests at `test/query/ProperCrossingQuery.test.mjs:127` ("time budget trips before count budgets") and `:194` ("time budget aborts strictly mid-probe-loop") both currently *assert* the defective semantics. The first is worth quoting, because it is the defect written down as a contract: two `box(3,3,3)` operands offset by `(0.1, 0.1, 0.1)` — a deep, unambiguous overlap — with a mocked clock that trips on the second read, and the assertion is `assert.equal(r.crossing, false, 'time budget trips: not a crossing')`. A genuine overlap is required to report "not a crossing" purely because the clock moved. These tests must be **re-expressed**, not merely kept green, to state the post-fix contract: a time trip may truncate and diagnose, but must not change the crossing verdict for operands whose deterministic budgets were not exhausted.
8. **Full collision unit suite.** `npm test`. Note the pre-existing whole-suite-only flakiness documented in the ledger (`progress.md`, "MAJOR ADDITIONAL CORROBORATION") — re-baseline it after the fix rather than assuming it is unrelated.
9. **Phase 3 canonical matrix rerun — only after 1–8 are clean.** And per item 3, the rerun must be repeated, because a single clean canonical matrix is now known to be a weak signal for this defect class.

---

## 10. Step 11 — Final disposition

### `FIX_REQUIRED_BEFORE_M4_CAN_CONTINUE`

Required statements:

- **§6.4 remains unchanged.** It was not modified, not relaxed, and not widened. Its named `TIME_BUDGET_DIAGNOSTIC_DIVERGENCE` exception does not reach this case — by its own text (a compared statistic differs) and structurally (the clearance precheck cannot emit either carve-out reason). No existing diagnostic tolerance was widened.
- **The current Phase 3 canonical result remains invalid.** `m4-gate-1789057417429.json` is `FAILED_VALIDATION` and correctly so. Beyond that single tuple, the underlying statistic is nondeterministic run-to-run within a single arm, so **no** canonical matrix run can be treated as valid until the semantic result is made deterministic — a future run that happens to agree is luck, not evidence.
- **The previous provisional D remains unusable.** It was already labelled diagnostic-only per §19.1 because the run was `FAILED_VALIDATION`; that has not changed, and the newly-established nondeterminism gives an independent second reason.
- **Phase 4 remains blocked.** Not started, and must not start.

**Semantic vs accounting-only:** **semantic.** The exclusion accounting itself is correct and order-independent; it faithfully reports a nondeterministic upstream verdict. Precisely stated: *wall-clock-dependent precheck disposition nondeterminism, with demonstrated `statistics` and `diagnostics` divergence and a structurally reachable public-`pairs` divergence.* The observed incident did not change the public pair set, distances, or witnesses — that is recorded honestly and not overstated.

**Separation the prompt required, restated:**

| Layer | Diverges? | Cause |
|---|---|---|
| 1. Diagnostic divergence | Yes | Downstream of (2) — one extra `clearance-hard-clash-precheck-inconclusive` |
| 2. Precheck `conclusive` / exclusion divergence | **Yes — the root** | `properCrossingQuery` wall-clock abort suppressing a proven crossing |
| 3. Final clearance result divergence | **No, on this fixture** | Structurally reachable via `CollisionWorld.js:1808-1811`, not observed here |

They do **not** have independent causes: (1) is a consequence of (2), and (3) is a latent consequence of (2). But (3) not having fired is a property of this fixture, not a guarantee.

---

## 11. Independent review

An independent `codex-advisor` consult (`medium`, request `20260911-005521-18824-220`, running `codex-worker`, response retrieved) reviewed the hypothesis before the live work. It agreed the mechanism is present and that the carve-out must stay narrow, and it correctly identified that the artifact alone could not prove the pairing, that a timing correlation alone is not a causal test, and that two alternatives remained open: (a) unverified candidate-multiset equality between arms, and (b) unverified operand identity. Both were then closed empirically — candidate-multiset equality in §3.2, and the frozen-clock causal intervention in §3.3 (which it recommended). It also warned against predicting the abort would land "just under 8 ms"; the measurement is **8.100 ms**, i.e. slightly over, consistent with the last probe completing after the check — its caution was correct and is reflected above. Its framing of the classification ("semantics-bearing with demonstrated statistics divergence and a reachable public-result divergence") is adopted in §10 in preference to the stronger claim.

Two of its suggestions were **not** performed and are recorded as remaining, non-blocking gaps: welded-buffer / serialized-BLAS byte comparison between the two arms, and a captured-operand replay of `volumeOverlapQuery` at `frameBudgetMs: Infinity`. Neither is needed for the conclusion — the frozen-clock intervention removes the divergence without touching geometry, which rules out an operand difference more directly — but either would add belt-and-braces confirmation if the milestone owner wants it.

A second independent pass, `codex-review` (`spec`, `medium`, request `20260911-011003-36953-11311`), reviewed this document itself. It endorsed the root-cause diagnosis, the evidence structure, the separation of semantic/accounting/diagnostic layers, and the refusal to widen §6.4 — and returned **"requires major revision"** specifically on the *remediation* half, judging Option B not yet implementable. Four of its findings were **accepted and applied** to this document:

- **Its strongest catch:** the earlier draft's "wall clock decides when to pause" was **wrong** — `bvhcast` is synchronous and non-resumable, so there is no pause, and the draft contradicted this document's own §5. §8 Option B is corrected and now states the non-preemptible-span consequence explicitly.
- The three experiment series were conflated in the earlier draft, and one `frag410` figure (`6.30/7.30 ms`) mixed two of them. §3 now labels S-1/S-2/S-3/S-4 and §3.4 reports each series' arithmetic separately — which, as it happens, strengthens the result: the `+2 ⇒ 346` arithmetic closes independently in **two** series.
- Option B's under-specification is now stated as such in **§8.1**, with the six decisions it forces open, explicitly assigned to the milestone owner.
- The status of `347` is clarified as a fixture-version-pinned regression expectation, not a normative constant.

One point is respectfully **scoped rather than accepted**: the review holds this document to the standard of an implementation specification. It is not one — Step 9 of its brief says "do not implement yet ... classify likely remediation", and §8/§8.1 deliberately stop at a class plus its open decisions. The correct next artifact is a fix *design* that answers §8.1, not an implementation. Its remaining fixture concern (that the live Audubon regression depends on credentials and remote model availability, so a committed deterministic operand fixture would be a better CI backstop) is a genuine improvement to §9 item 1 and is endorsed here for whoever writes that design.

## 12. Reproduction assets

The reproduction harness was written to the session scratchpad and deliberately **not** added to the repository, per the read-only constraint. It is reconstructible in full from this document: the query is `{mode: 'clearance', clearance: 0.05, source: {model: structure, dbIds: [2383]}, target: {targets: all 3 models}, groupBy: 'dbId', broadPhase: 'tlas'|'linear'}` against the federated Audubon fixture, with `setDiagnosticEventRecorder` retaining `hard-clash-precheck` payloads, `setSpikeInputCapture` retaining `precheck-candidate-list`, a fresh `CollisionWorld` per arm-run, and the historical Chromium launch flags. The causal arm adds `CollisionWorld.fromViewer(viewer, { now: () => 0 })`. If this is to become a permanent regression test, `test/performance/m4/structure-fragment-clearance-regression.mjs` is the right template to follow.
