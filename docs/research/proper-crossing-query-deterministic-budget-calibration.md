# `ProperCrossingQuery` Deterministic Budget — Phase B Calibration

**Design this executes:** `docs/superpowers/specs/2026-09-11-proper-crossing-query-deterministic-budget-fix-design.md`, §14.1–§14.4 (Phase B).
**Date:** 2026-09-11
**Scope:** measurement only. No constant was changed, no semantics were changed, `frameBudgetMs` was
not changed, §6.4 was not touched, the verdict reducer was not touched, and M4 Phase 4 was not run
(§14.5, all six prohibitions honored and individually checked at the end of this document).

**Phase C — the wall-clock semantic removal — was NOT implemented.** Both wall-clock semantic
branches (`ProperCrossingQuery.js`'s callback-entry time clause and its probe-loop check) are still
live in the code this was measured against, exactly as Phase A requires.

---

## 0. Headline, in one line

> **The worst single observed synchronous `properCrossingQuery` span, across every input class and
> both pre-registered runtime tiers, is 15.5 ms** — on the authoritative multi-process tier, on
> pathological synthetic input (I3/H1) designed to saturate the 50,000-candidate tier-B scan.
> **Zero** of 21,300 measured traversals exceeded the 24.8 ms reference-hardware ceiling.

Applying §14.4's disposition rule with `S_worst = 15.5 ms` and `S_ceiling = 24.8 ms`:

| | |
|---|---|
| **Branch** | **2 — `8 ms < S_worst ≤ 24.8 ms` → CAUTION** |
| Band | M4 §7.1's own CAUTION band |
| Rule text | *"Phase C proceeds; the figure is recorded as an M4 input and cited in the release note."* |

**This document reports the classification. It does not act on it.** Per §14.4 item 4, no constant
was changed in any branch, and per this task's own scope Phase C was not started. The decision to
proceed belongs to the milestone owner.

`M_legit` — the maximum `pointClassifications` observed over legitimate input (I1 ∪ I2) — is
**1152**, comfortably **≤ 1536**. The 1536 cap fired **zero** times across every traversal measured,
confirming §4.3's "non-binding by construction" claim empirically rather than only structurally.

---

## 1. Provenance — what exactly was measured

### 1.1 The measured implementation (§14.3's commit-SHA requirement)

**DECLARED DEVIATION.** §14.3 requires "the Phase-A commit SHA it was measured against". Phase A is
**not committed** in this working tree — the task that produced it explicitly forbade committing — so
there is no Phase-A commit SHA to record. The measured implementation is instead identified
reproducibly by the base commit plus a SHA-256 content hash of every file Phase A touched. Both
measurement runs recorded identical hashes, verified programmatically.

| | |
|---|---|
| Base commit (`HEAD`) | `ef63f21908e162637aa672d564b2811760143ab8` |
| Branch | `feature/m4-performance-worker-decision-design` |
| Working tree | dirty (Phase A uncommitted) |

| Phase-A file | SHA-256 |
|---|---|
| `collision/constants.js` | `5c51e399411ed52a74fc5f23f2fbed3eff21317ee7aecb3aaed0cbdae7fa5633` |
| `collision/query/ProperCrossingQuery.js` | `cd3aab629e98749a71c2b00a376c6afa83e138368551a06386ac5a5ebc6624a9` |
| `collision/query/VolumeOverlapQuery.js` | `9066e33b7316c86483f29de6017e8fdc09f5c4795fc341049b5957e35d0485e3` |
| `collision/README.md` | `615931e08565b7f000f3b8539aa4afdc69080652b9213c92b6e2c81b74c25c06` |
| `test/query/ProperCrossingQuery.instrumentation.test.mjs` | `4e875e3742ae1b713c2daa93ef759403ce45cfa1d5bf6730c596a2f3bf2045cd` |

`maxCrossingPointClassifications` as actually loaded inside the measured page: **1536** on both tiers
(read back from `/collision/constants.js` at measurement time, not assumed).

### 1.2 Harness and raw data

| | |
|---|---|
| Harness | `test/performance/m4/proper-crossing-budget-calibration.mjs` (not a `*.test.mjs` file — needs the live dev server) |
| Raw set — I1/I3 | `test/performance/results/proper-crossing-budget-calibration-1789094189278.json` |
| Raw set — I2 | `test/performance/results/proper-crossing-budget-calibration-1789094330065.json` |
| Chromium | `151.0.7922.34` (identical on both tiers) |
| Fixture | the same 3-discipline federated Revit host+links Audubon package every M1–M4 gate uses; URNs copied verbatim from `run-gate-m4.mjs:42-44` |

§14.3 item 2 requires the raw set be retained, never a median alone. It is: both JSON artifacts above
hold every individual traversal record (one object per traversal, 21,300 in total), and every
distribution in this document is computed from them, never from a summary.

*Caveat on retention:* `test/performance/results/` is gitignored (`.gitignore:487`), the same as every
other gate's artifacts in this repo, and the I2 artifact is 10.7 MB. The raw set therefore lives on
the measurement machine, not in version control. Every number in this document is reproducible from
the harness against the file hashes in §1.1.

### 1.3 Pre-registered runtime tiers (§14.2)

Taken verbatim from `test/performance/m4/fixture-lifecycle.mjs`'s `RUNTIME_CONFIGS` — not
re-derived, so they are literally the M4 gate's own tiers.

| Tier | Chromium args | Role |
|---|---|---|
| `multi-process` | `--no-sandbox --disable-dev-shm-usage` | **AUTHORITATIVE** (§6.1.5b); `S_worst` for §14.4 is read from this tier |
| `historical` | `--no-sandbox --disable-dev-shm-usage --single-process --no-zygote` | continuity with the investigation's own artifact |

**5 counterbalanced repetitions per tier, cold first.** Repetition 0 in a freshly launched browser is
the cold sample; repetitions 1–4 are warm. Input-class order is rotated per repetition via the gate's
own `caseOrderForRepetition`, and I2's broad-phase arm order via its own `armOrderForRepetition`
(`tlas>linear` on even repetitions, `linear>tlas` on odd).

### 1.4 Wall-clock neutralization, for the measurement only

- **I1 / I3** call `properCrossingQuery` directly and pass **`options.frameBudgetMs: Infinity`** —
  exactly the existing seam §14.1 names, already used this way at
  `test/query/SurfaceIntersectionQuery.test.mjs:47`. No code change.
- **I2** goes through `CollisionWorld`, which hardcodes `crossing: { now: this._now }`
  (`CollisionWorld.js:2433`) and plumbs **no** `frameBudgetMs` seam down to the query. §14.1's stated
  seam is therefore **unreachable on the live path without a library change Phase B forbids.** In its
  place the world is constructed with a **frozen clock** — `CollisionWorld.fromViewer(viewer, { now: () => 0 })`
  — which makes `now() - traversalStart` identically `0` and so makes both wall-clock semantic
  branches unreachable. This is the same intervention the blocker investigation itself used
  (report §3.3). See §5.2 for this substitution's declared limits.

---

## 2. Input classes as actually executed (§14.1)

| Class | §14.1 definition | As executed | Traversals recorded |
|---|---|---|---|
| **I1** | every operand pair reaching `properCrossingQuery` from the named `node --test` suites | 38 enumerated operand pairs with per-entry `file:line` provenance, rebuilt fresh each repetition | 190 per tier (38 × 5) |
| **I2** | the real failing pair + cohort + the full `S2[k=100:typical:clearance]` list, both arms, Audubon | both, both arms, 5 reps, both tiers, via the gate's own cohort profiler | 10,410 per tier |
| **I3** | H1–H4 pathological synthetic geometry from §13 | H1 (4 sizes), H2, H3, H4 (2 variants), plus 2 co-occurrence probes | 50 per tier (10 × 5) |
| | | **Total** | **21,300** |

### 2.1 I1 — the shipped-fixture catalogue

Re-derived as an explicit enumerated catalogue rather than intercepted: the operand pairs are
constructed inside test bodies, are not exported, and ESM offers no non-invasive interception seam.
Every entry in the harness names the test it came from. Coverage spans all six suites §14.1 names:
`ProperCrossingQuery.test.mjs`, `VolumeOverlapQuery{,.conclusive,.inconclusiveCauses}.test.mjs`,
`ClearanceHardClashPrecheck.test.mjs`, and the three clearance `CollisionWorld` suites (whose
fixtures are nothing but `box(1,1,1)`, `box(2,2,2)`, `box(2,6,2)` at assorted separations).

**Why enumeration is sufficient for what I1 is asked to establish.** I1's job in §14.3 is (a) to feed
`M_legit` and (b) to give a low-end span distribution. `properCrossingQuery` is deterministic in its
counters for identical operands — this document measures that directly (§4.3) — so **invocation
multiplicity cannot change `M_legit`**; only the set of *distinct* operand pairs can. Multiplicity
affects only the shape of the span distribution, which 5 repetitions per fixture already sample.
Aspect-ratio-gated pairs are deliberately **excluded** from I1: they are skip-path observations, not
traversals (the query is never called).

*Residual*: this is a per-fixture enumeration, not a per-invocation manifest of every
`volumeOverlapQuery` call in those suites. Recorded as a limitation, not claimed as completeness.

### 2.2 I2 — the live Audubon inputs

Two variants per arm per repetition:

| Variant | Source | Observed |
|---|---|---|
| `failing-pair-source` | Structure `dbId 3547` against all three models, `clearance: 0.05` | 7 crossing traversals/run, including **the exact real failing pair** `structure epoch2/frag363 → architecture epoch1/frag30` |
| `S2[k=100:typical:clearance]` | the gate's own `selectCohort(ranked, 0.5, 100)` typical cohort, `clearance: 0.05` | 1,034 crossing traversals/run |

The cohort is the gate's own, not a lookalike: the same
`window.__m4Probes.profileStructureCohortDensity` probe and the same pure
`rankByDensity`/`selectCohort`/`labelDensityUnstratified` selectors `run-gate-m4.mjs:1316-1338` uses.
Profiled 547 Structure dbIds; the k=100 typical cohort resolved to **dbId 2383**, achieving **101**
extracted source instances (`status: OK`, `weightedDensity` 14.178, `densityUnstratified: false`) —
identical on both tiers.

**On the "1319-candidate list".** The design's 1319 is the *candidate* count. 1,034 of those pairs
actually reached `volumeOverlapQuery` (`clearanceOverlapPrechecksRun = 1034`); the remainder are
`skip-precheck`, rejected by `aabbMinDistance > 0` before the query is called, and therefore are not
traversals. The harness records the 1,034 that are. The 1319 figure itself was not independently
re-confirmed here — the candidate list is not on the statistics surface this harness reads.

### 2.3 I3 — pathological synthetic geometry

| id | §13 item | Construction |
|---|---|---|
| `H1-combs-{60,200,600,1500}` | H1 | interleaved combs at increasing tooth counts — maximizes candidate pairs with zero real crossings |
| `H2-dense-coincident-1e-8` | H2 | two 4,800-triangle boxes at a sub-`minPenetrationDepth` (1e-8) offset — every probe fails |
| `H3-dense-deep-overlap` | H3 | two 4,800-triangle boxes in deep overlap |
| `H4-ceiling-deep-overlap` | H4 | two operands **at the 12,000-triangle ceiling** (11,532 = 12 × 31²) in deep overlap |
| `H4-ceiling-coincident` | H4 | same two ceiling operands at a 1e-8 offset |
| `HX-combs-flush-{600,1500}` | *added* | §11.1's own stated worry: high scan cost and high probe cost **co-occurring in one traversal** |

---

## 3. §14.3 item 1 — counter distributions, per input class, per tier

min / median / p95 / max. Percentiles by nearest rank, the same convention the M4 gate uses.

| Class | Tier | Traversals | `candidatePairsExamined` | `crossingPairsExamined` | `pointClassifications` |
|---|---|---|---|---|---|
| I1 | multi-process | 190 | 0 / 5 / 14184 / 14184 | 0 / 1 / 48 / 48 | 0 / 14 / 600 / 600 |
| I1 | historical | 190 | 0 / 5 / 14184 / 14184 | 0 / 1 / 48 / 48 | 0 / 14 / 600 / 600 |
| I2 | multi-process | 10410 | *not carried* | *not carried* | 0 / 11 / 856 / **1152** |
| I2 | historical | 10410 | *not carried* | *not carried* | 0 / 11 / 780 / **1152** |
| I3 | multi-process | 50 | 18 / 1039 / 50001 / **50001** | 0 / 1 / 65 / 65 | 0 / 14 / 936 / 936 |
| I3 | historical | 50 | 18 / 1039 / 50001 / **50001** | 0 / 1 / 65 / 65 | 0 / 14 / 936 / 936 |

***not carried*** **— a real §14 internal inconsistency, not an omission.** §14.2 requires all three
counters per traversal and says recording uses "the existing `setDiagnosticEventRecorder` seam plus
Phase A's `stats` fields — no new instrumentation mechanism and no library change beyond Phase A."
But §5.4's literal event payload adds only `timeBudgetExceeded`, `crossingElapsedMs`,
`pointClassifications` and `exhaustedBudget`; `candidatePairsExamined` and `crossingPairsExamined`
have **never** been on that event, and `CollisionWorld` drops the crossing result entirely, so the
recorder has no other route to them. On the live I2 path only `pointClassifications` and
`exhaustedBudget` are therefore observable. Adding the two counters to the same event would be
additive, zero-cost in production, and low risk — but it is a **library change**, which §14.5
forbids during Phase B, so it was deliberately **not** made. See §7, gap 2.

### 3.1 Counter observations worth calling out

- `crossingPairsExamined` maxes at **65** everywhere it saturates — the increment-then-strict-`>`
  protocol reading `budget + 1` when the 64-pair cap trips, exactly as specified.
- `candidatePairsExamined` maxes at **50001** — same protocol at the 50,000 cap.
- `pointClassifications` maxes at **1152** over all 21,300 traversals — **75.0 % of the 1536 cap**,
  with 384 of headroom. `exhaustedBudget === 'point-classifications'` occurred **0 times**.
- 1152 = 48 × 24: a traversal whose probe ladder ran to its full 24 classifications on 48 consecutive
  confirmed pairs before the *crossing-pair* cap (not the classification cap) terminated it. The two
  caps are therefore doing exactly the division of labour §4.2 assigns them.

---

## 4. §14.3 item 2 — end-to-end traversal span distributions, per input class, per tier

Complete end-to-end span of the `properCrossingQuery` call, measured by real `performance.now`.
Raw set retained (§1.2). Median / p95 / max, milliseconds.

| Class | Tier | n | median | p95 | **max** |
|---|---|---|---|---|---|
| I1 | multi-process | 190 | 0.000 | 3.700 | 6.500 |
| I1 | historical | 190 | 0.000 | 3.700 | 6.500 |
| I2 | multi-process | 10410 | 0.100 | 2.100 | **10.800** |
| I2 | historical | 10410 | 0.100 | 2.200 | 8.700 |
| I3 | multi-process | 50 | 1.900 | 14.400 | **15.500** |
| I3 | historical | 50 | 1.900 | 14.700 | 15.500 |

### 4.1 Cold vs warm (§14.2's "cold first, since cold-start and JIT effects are part of the tail")

| Class | Tier | State | n | median | p95 | max |
|---|---|---|---|---|---|---|
| I1 | multi-process | cold | 38 | 0.000 | 5.000 | 6.500 |
| I1 | multi-process | warm | 152 | 0.000 | 3.600 | 5.600 |
| I1 | historical | cold | 38 | 0.100 | 5.000 | 6.500 |
| I1 | historical | warm | 152 | 0.000 | 3.600 | 5.500 |
| I2 | multi-process | cold | 2082 | 0.100 | 2.100 | **10.800** |
| I2 | multi-process | warm | 8328 | 0.100 | 2.200 | 8.200 |
| I2 | historical | cold | 2082 | 0.100 | 2.200 | **8.700** |
| I2 | historical | warm | 8328 | 0.100 | 2.200 | 8.300 |
| I3 | multi-process | cold | 10 | 2.800 | 15.500 | 15.500 |
| I3 | multi-process | warm | 40 | 1.800 | 13.500 | 15.200 |
| I3 | historical | cold | 10 | 2.700 | 15.300 | 15.300 |
| I3 | historical | warm | 40 | 1.900 | 13.700 | 15.500 |

Cold genuinely owns the tail on the live path: the single worst I2 traversal on both tiers is a cold
one, and on multi-process the cold maximum (10.8 ms) exceeds the warm maximum (8.2 ms) by ~32 %.
On the synthetic classes the cold/warm difference is within run-to-run noise. This is exactly why
§14.2 pre-registered cold-first rather than measuring warm-only.

### 4.2 Measurement-resolution caveat

Chromium coarsens `performance.now()` to **0.1 ms** in this configuration. Every span below is
therefore quantized to 0.1 ms, which is why I1's median reads `0.000` — most shipped fixtures complete
in under 100 µs, not in literally zero time. The coarsening is immaterial at the tail (10–15 ms),
which is the only region §14.4's disposition depends on.

---

## 5. §14.3 item 3 — `M_legit`

> Reported **to confirm `M_legit ≤ 1536`**, not to derive a cap (§4.3).

| | |
|---|---|
| **`M_legit` (max `pointClassifications` over I1 ∪ I2)** | **1152** |
| Cap | 1536 |
| Headroom | 384 (cap is 33.3 % above the worst legitimate input) |
| Fraction of cap used | 75.0 % |
| **Verdict** | **`M_legit ≤ 1536` CONFIRMED.** No escalation required. |

**The pair that produced it:** `S2[k=100:typical:clearance]`, source epoch 2 / fragment 277 →
target epoch 2 / fragment 528 (Structure→Structure), 1,868 / 290 triangles, span 2.3 ms,
`exhaustedBudget: 'crossing-pairs'`. Two further pairs reached the same 1152
(`2/488→2/115`, `2/380→2/537`); the next highest are 1053 and 1028.

Top of the legitimate distribution:

| `pointClassifications` | Input |
|---|---|
| 1152 | I2 `S2[k=100:typical:clearance]` |
| 856 | I2 `failing-pair-source` (pair `2/363 → 2/537`) |
| 600 | I1 `PCQ-coplanar-touching` / `CHCP-adjacent-boxes` |
| 504 | I1 `PCQ-below-min-penetration-1e-8` |
| 294 | I1 `PCQ-edge-vertex-contact` |

Including the pathological I3 class changes nothing: the overall maximum across all 21,300 traversals
is also **1152** (I3's own worst is 936). **The 1536 terminator never fired, on any input, on any
tier.** §4.3's "non-binding by construction" now has an empirical companion to its structural proof.

### 5.1 The real failing pair, measured

`structure epoch2/frag363 → architecture epoch1/frag30` — the pair the whole blocker investigation
turns on — was captured on both tiers, in both arms, in all 5 repetitions:

| | |
|---|---|
| `pointClassifications` | **16**, identical in all 10 recorded traversals per tier |
| `exhaustedBudget` | `null` — it completes; it never exhausts a deterministic budget |
| Operand triangles | 1,474 / 150 |
| Worst span | 10.8 ms (cold, multi-process); 5.0 ms typical |

That is the substantive finding behind the defect restated in numbers: the pair needs **16**
classifications and a few milliseconds, and the only thing that was ever suppressing it is a wall
clock that happened to be over 8 ms *for reasons unrelated to this pair's own work*.

### 5.2 What the frozen-clock substitution on I2 does and does not cost

Declared, because §14.1's literal seam was unreachable (§1.4):

- **What is sound.** The frozen `_now` is a strictly *stronger* neutralization than
  `frameBudgetMs: Infinity`: `now() - traversalStart` is identically `0`, so neither semantic branch
  can fire under any circumstances. The recorded spans come from
  `VolumeOverlapQuery`'s own `performance.now()` reads, not from the injected clock — verified in
  the data: every I2 record carries `crossingElapsedMs: 0` (the frozen clock, as expected) alongside
  a real, varying `ms`. The only other value observed is `null`, on aspect-ratio-gated pairs — which
  is Phase A's §5.2a skip-path contract (`elapsedMs: null`, never a fabricated `0`) confirming itself
  live, on real geometry.
- **What it costs.** (a) `stats.elapsedMs` is unusable on I2 and the recorded span is
  `VolumeOverlapQuery`'s **crossing-stage** `ms`, which starts marginally before the query call (it
  includes the aspect-ratio branch test and one `Matrix4` invert-multiply) — a small conservative
  over-estimate, not an under-estimate. (b) Freezing `_now` also freezes the composed-stage scheduler
  and the frame-budget accumulator, so yield cadence during the measured run differs from production.
  Since the crossing traversal contains no `await` and no checkpoint (§11.2), this cannot interrupt a
  measured traversal; it can only change surrounding JIT/GC conditions.
- **Independent evidence the substitution is faithful:** it reproduces the investigation's own
  frozen-clock ground truth exactly (§6.1) — 347 exclusions, every run.

---

## 6. §14.3 item 4 — the worst single observed synchronous span (THE HEADLINE)

| Tier | **Worst span** | Input | Repetition / state | Counters |
|---|---|---|---|---|
| **multi-process (AUTHORITATIVE)** | **15.500 ms** | I3 `H1-combs-1500` | rep 0, **cold** | cand 50001, xpair 0, pointCls 0, `exhaustedBudget: 'candidate-pairs'` |
| historical | 15.500 ms | I3 `H1-combs-200` | rep 2, warm | cand 48032, xpair 0, pointCls 0, `exhaustedBudget: null` |

Top 10 spans over all 21,300 traversals — **every one of them is I3/H1**, i.e. a deliberately
pathological synthetic tier-B scan, and none is a real-model traversal:

| ms | Tier | Input | rep/state | `candidatePairsExamined` |
|---|---|---|---|---|
| 15.500 | multi-process | H1-combs-1500 | 0 / cold | 50001 |
| 15.500 | historical | H1-combs-200 | 2 / warm | 48032 |
| 15.300 | historical | H1-combs-1500 | 0 / cold | 50001 |
| 15.200 | multi-process | H1-combs-200 | 3 / warm | 48032 |
| 14.700 | historical | H1-combs-600 | 2 / warm | 50001 |
| 14.400 | multi-process | H1-combs-600 | 3 / warm | 50001 |
| 14.300 | historical | H1-combs-200 | 0 / cold | 48032 |
| 14.000 | multi-process | H1-combs-200 | 0 / cold | 48032 |
| 13.700 | historical | H1-combs-600 | 1 / warm | 50001 |
| 13.600 | historical | H1-combs-200 | 1 / warm | 48032 |

**Worst span on real model geometry (I2) is 10.8 ms** — cold, multi-process, and it is the real
failing pair itself.

The two tiers are indistinguishable at the tail (15.5 ms both). The single-process configuration the
failing artifact was produced under is **not** a materially slower environment for this operation.

### 6.1 Determinism of the live measurement — the strongest single result here

Across **20 measured clearance runs per tier** (2 variants × 2 arms × 5 repetitions), on both tiers:

| Statistic | Distinct values observed |
|---|---|
| `clearanceHardClashExclusions` (S2) | **{347}** |
| `clearance-hard-clash-precheck-inconclusive` diagnostics (S2) | **{522}** |
| Crossing traversals executed (S2) | **{1034}** |
| Reported `pairs` (S2) | **{258}** |
| `clearanceHardClashExclusions` (failing-pair source) | **{3}** |
| Projection-callback errors | **0** |

- **347** is exactly the deterministic ground truth the investigation established under its own
  frozen-clock intervention (report §3.3; design §7.1, §10). Independently reproduced here, 40 times.
- **522** matches the design's own measured post-fix figure (§7.1: "525→522 measured").
- 347 + 522 = **869**, exactly the empirical invariant §13 F names (and correctly warns must not be
  encoded as a contract — it is recorded here as a cross-check, nothing more).
- **Per-(arm, pair) `pointClassifications` stability:** 2,068 (arm, pair) keys, **0 unstable** across
  5 repetitions.
- **TLAS vs linear agreement:** 1,034 pairs present in both arms, **0 disagreeing** on
  `pointClassifications`.

Note what this is and is not: it is evidence that the *deterministic counters* and the *precheck
outcome under a neutralized clock* are reproducible and arm-independent. It is **not** a §6.4 parity
run and must not be cited as one — §13 E is Phase C's job, not Phase B's.

---

## 7. §14.3 item 5 — traversals exceeding 8 ms and 24.8 ms, per tier

| Tier | Traversals | **> 8 ms** | | **> 24.8 ms** | |
|---|---|---|---|---|---|
| multi-process | 10,650 | **17** | 0.16 % | **0** | 0.00 % |
| historical | 10,650 | **18** | 0.17 % | **0** | 0.00 % |

Breakdown of every traversal that exceeded 8 ms:

| Count | Tier | Input |
|---|---|---|
| 5 | multi-process | I3 `H1-combs-200` |
| 5 | multi-process | I3 `H1-combs-600` |
| 5 | multi-process | I3 `H1-combs-1500` |
| 2 | multi-process | I2 `failing-pair-source` |
| 5 | historical | I3 `H1-combs-200` |
| 5 | historical | I3 `H1-combs-600` |
| 5 | historical | I3 `H1-combs-1500` |
| 3 | historical | I2 `failing-pair-source` |

Read plainly: **no traversal anywhere approached the 24.8 ms reference-hardware ceiling**, and the
only traversals that crossed 8 ms at all were (a) the three pathological comb fixtures, which cross it
by construction, and (b) five real-model traversals of the one pair the defect was discovered on.
Of 20,820 real-model (I2) traversals across both tiers, **5** exceeded 8 ms — 0.024 %.

---

## 8. §14.3 item 6 — the span attributable to a saturated 50,000-candidate tier-B scan

Reported on its own so §4.5's envelope question (should `maxCandidatePairsExamined` stay at 50,000?)
can be answered with evidence rather than argument.

| Tier | Fixture | `candidatePairsExamined` | median | p95 | max |
|---|---|---|---|---|---|
| multi-process | `H1-combs-60` | 14,184 | 3.800 | 4.900 | 4.900 |
| multi-process | `H1-combs-200` | 48,032 | 12.800 | 15.200 | 15.200 |
| multi-process | **`H1-combs-600`** | **50,001 (SATURATED)** | **13.200** | **14.400** | **14.400** |
| multi-process | **`H1-combs-1500`** | **50,001 (SATURATED)** | **13.200** | **15.500** | **15.500** |
| historical | `H1-combs-60` | 14,184 | 3.800 | 5.100 | 5.100 |
| historical | `H1-combs-200` | 48,032 | 13.600 | 15.500 | 15.500 |
| historical | **`H1-combs-600`** | **50,001 (SATURATED)** | **13.500** | **14.700** | **14.700** |
| historical | **`H1-combs-1500`** | **50,001 (SATURATED)** | **13.300** | **15.300** | **15.300** |

**A fully saturated 50,000-candidate tier-B scan costs 13.2–15.5 ms.** It scales essentially linearly
with candidate count (14,184 → ~3.8 ms; 48,032 → ~13 ms; 50,001 → ~13.3 ms) and is *independent of
operand triangle count* once the cap binds — `H1-combs-600` (7,200 tris/side) and `H1-combs-1500`
(18,000 tris/side) produce the same span, because both stop at the same 50,001 callbacks.

Implied per-candidate cost: **~0.27 µs/pair**, closely matching the ~0.3 µs/pair figure the source
comment at `ProperCrossingQuery.js:82-83` already carried. §11.1's tier-B estimate of ~15 ms is
therefore **confirmed by direct measurement**, not merely modelled.

### 8.1 Do high scan cost and high probe cost co-occur? (§11.1's open worry)

§11.1 flags, as the decisive reason not to trust an additive unit-cost model, "the possibility that
high scan cost and high probe cost **co-occur in one traversal**". Two fixtures were added
specifically to try to produce that:

| Fixture | `candidatePairsExamined` | `crossingPairsExamined` | `pointClassifications` | `exhaustedBudget` | max span |
|---|---|---|---|---|---|
| `HX-combs-flush-600` | 968 | 65 | 784 | `crossing-pairs` | 2.0 ms |
| `HX-combs-flush-1500` | 496 | 65 | 791 | `crossing-pairs` | 1.7 ms |

**They cannot co-occur at saturation, and the reason is structural.** The moment a traversal starts
confirming intersecting pairs, the 64-pair `maxCrossingPairsExamined` cap terminates it long before
the 50,000-candidate scan can saturate — in these fixtures after fewer than 1,000 candidates. So the
two worst cases are *mutually exclusive by construction*: a traversal is either a wide scan that
confirms nothing (H1, ~15 ms, 0 classifications) or a narrow scan that probes hard (H2/H4/HX, ~3 ms,
≤ 936 classifications). The same pattern holds for every I3 fixture and for all 20,820 real-model
traversals. This does **not** license an additive model — §11.1's prohibition stands and this
document derived nothing from unit costs — but it does explain why the measured envelope sits well
below what a naive worst-case-plus-worst-case sum would predict.

---

## 9. §14.4 — the decision rule, applied

`S_worst` = §14.3 item 4 on the authoritative tier = **15.500 ms**.
`S_ceiling` = **24.8 ms** (reference-hardware acceptance gate, not a hard cross-platform bound, §11.5).

| Branch | Condition | Holds? |
|---|---|---|
| 1 — CONFORMANT | `S_worst ≤ 8 ms` | No (15.5 > 8) |
| **2 — CAUTION** | **`8 ms < S_worst ≤ 24.8 ms`** | **YES** |
| 3 — escalate | `S_worst > 24.8 ms` | No (15.5 ≤ 24.8) |

### **Classification: CAUTION (§14.4 branch 2).**

The rule's own text for this branch: *"Phase C proceeds; the figure is recorded as an M4 input and
cited in the release note."* Margin to the ceiling: **9.3 ms (37.5 % headroom)**.

**Qualifications the milestone owner should weigh with the number:**

1. `S_worst` is **synthetic**. The worst real-model traversal is **10.8 ms** — still in the CAUTION
   band, but 30 % lower, and it occurred once in 20,820 real traversals.
2. The 15.5 ms figure is an *upper bound the shipped caps permit*, reached only by geometry
   engineered to saturate them. It is not a distribution the fixture produces on its own.
3. Both tiers agree at the tail, so this is not an artifact of one runtime configuration.
4. Phase C is expected to *reduce* per-traversal overhead slightly — §9.2 notes it removes up to
   ~51,500 in-loop `performance.now()` reads per traversal. At the ~0.27 µs/pair measured here, a
   saturated scan is currently spending a measurable fraction of its 13–15 ms on clock reads alone.
   **This measurement was taken with those reads still present**, so it is conservative for Phase C.

**§14.4 item 4 honored:** `maxCandidatePairsExamined` (50,000), `maxCrossingPairsExamined` (64) and
`maxCrossingPointClassifications` (1536) all keep the values §4 fixes. **Calibration changed no
constant, in any branch.**

**§14.4 item 5 honored:** `maxCrossingPointClassifications = maxCrossingPairsExamined * 24` landed in
`collision/constants.js` during Phase A, with a comment deriving it and citing the design — the same
evidence discipline the file already applies to `maxLocalAspectRatio`.

**No cap was derived by arithmetic from measurement.** There is no `C_p × K` formula anywhere in this
document. Every span is a measured end-to-end traversal at the tail, per §14.3's prohibition.

---

## 10. Declared deviations from §14 as written

Recorded here rather than buried, so the disposition can be judged against what was actually done.

| # | §14 requirement | What happened | Impact on the §14.4 disposition |
|---|---|---|---|
| 1 | §14.3: "recording the **Phase-A commit SHA** it was measured against" | Phase A is uncommitted (committing was out of scope), so there is no such SHA. Substituted: base `HEAD` + per-file SHA-256, identical across both runs (§1.1). | None on the number. Reproducibility is preserved but requires the hashes, not a single SHA. |
| 2 | §14.2: record **all three counters** per traversal | Only `pointClassifications` and `exhaustedBudget` are observable on the live I2 path — §5.4's event payload never carried the other two and §14.5 forbids the library change that would add them (§3). | None. `S_worst` comes from I3, where all three are recorded; `M_legit` needs only `pointClassifications`. |
| 3 | §14.1: neutralize via `options.frameBudgetMs: Infinity` | Unreachable through `CollisionWorld` (no seam). I2 used a frozen `_now` instead — a stronger neutralization with a slightly conservative span proxy (§1.4, §5.2). Fully honored on I1/I3. | Conservative (over-estimates I2 spans marginally), so it cannot have hidden a breach. |
| 4 | §14.1 I1: "**every** operand pair reaching `properCrossingQuery`" | A 38-entry enumerated catalogue with per-entry provenance, not a per-invocation manifest (§2.1). | None on `M_legit` (counters are deterministic per operand pair, so multiplicity cannot raise it). |
| 5 | §14.1 I2: "the full **1319-candidate** list" | The cohort query was run in full; 1,034 of those candidates actually reach the query, the rest are `skip-precheck`. 1319 itself was not independently re-confirmed (§2.2). | None. |

None of the five can move `S_worst` upward, so none can change the CAUTION classification. Deviation 3
is the only one that touches a measured number, and it biases conservatively.

---

## 11. §14.5 compliance — what Phase B did NOT do

| Prohibition | Status |
|---|---|
| Remove the wall-clock semantic branches | **Not done.** Both are still live and were verified live at measurement time (I1/I3 neutralized them via the `frameBudgetMs` option, I2 via a frozen clock — neither deletes anything). |
| Change any semantics | **Not done.** No file under `collision/` was modified during Phase B. |
| Change any constant | **Not done.** All three budgets keep their §4 values; the in-page read-back confirms `maxCrossingPointClassifications === 1536`. |
| Change `frameBudgetMs` | **Not done.** Still 8. |
| Change §6.4 | **Not done.** Not opened. |
| Touch the verdict reducer | **Not done.** `test/performance/m4/verdict-reducer.mjs` untouched. |
| Run Phase 4 | **Not done.** M4 Phase 4 remains blocked. |

Files added by Phase B: this document, and the harness
`test/performance/m4/proper-crossing-budget-calibration.mjs` (plus its two JSON result artifacts).
Nothing under `collision/` was touched.

---

## 12. What this does and does not authorize

- It **does** report a §14.4 **CAUTION** classification with the evidence behind it, and confirms
  `M_legit = 1152 ≤ 1536`, closing §14.3 item 3 without escalation.
- It **does not** decide anything. §14.4 is explicit: *"The implementer must not choose."*
- It is **not** evidence for M4 verdicts A, B, C or D (§12). It changes the *inputs* to the M4
  measurement; no verdict may cite it.
- Phase C remains gated on milestone-owner ratification of §7.2's compatibility classification **and**
  of this envelope. Neither is granted by this document.
