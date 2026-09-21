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

---

## Phase B′ — Post-Orientation-Fix Recalibration (Corrected Call Seam)

**Design this executes:** `docs/superpowers/specs/2026-09-11-canonical-ordering-operand-symmetry-fix-design.md`,
§9.4's "Scope — five case families" row and finding #7. Task: `Task B′.3` of the
2026-09-11 canonical-ordering/operand-symmetry-fix implementation plan.

**Scope note carried over from Phase B, still true here:** measurement only. No constant was
changed and no semantics were changed by this task. **This document does not apply §14.4's
CONFORMANT/CAUTION/escalate disposition rule, and does not characterize whether any measured
change is an improvement, a regression, or neither — that determination is Task B′.4's job,
explicitly reserved** ("the implementer must not choose"). Every comparison below is stated as a
bare number-to-number or number-to-threshold fact; where this draft originally used evaluative
language (e.g. "reassuring," "did not make anything worse," "points away from a regression"), an
independent `codex-advisor` review flagged it as an undisclosed disposition judgment and it has been
removed.

### B′.0 The call seam this measures (read this before comparing anything to Phase B)

**Synthetic (I1/I3).** Phase B's I1/I3 loop called `properCrossingQuery` directly, with a
hardcoded `a`/`b` operand order and a hand-rolled relative matrix. Task B′.1 (commit `fe1649c`)
rewired that same loop to go through the production seam instead: `orientForCrossing(a, b)` first,
then the kernel, on whichever operand order `orientForCrossing` decides. Two spans are now
recorded per synthetic traversal:

- **`kernelSpanMs`** — the raw `properCrossingQuery` call only (Phase B's own measurement scope).
- **`wrapperSpanMs`** — `orientForCrossing` + the relative-matrix invert/multiply + the kernel call
  (the *orient+kernel* seam — **not** the full `volumeOverlapQuery` wrapper: no
  `aspectRatioExceeded` skip-gate, no `options.crossing`, by the harness's own header comment).

This IS a genuine harness-level call-seam change for I1/I3: the operand order fed to the kernel can
now differ from Phase B's own hardcoded order, so even the *kernel-only* column is not a
re-measurement of Phase B's own kernel figure on the same input.

**A known, already-reviewed scope reduction from the design doc's own literal wording.** The design
doc (§9.4's own listing) calls for measuring both the kernel span and a full end-to-end
`volumeOverlapQuery` wrapper span. `wrapperSpanMs` here is neither of those in the design's own
sense — it is the reduced `orient+matrix+kernel` seam described above, not the full wrapper
lifecycle (`aspectRatioExceeded`, containment terms, diagnostics). This reduction was made and
reviewed twice in Task B′.1 (already landed, per this task's own brief), which explicitly instructs
this task to "keep that framing" rather than build a genuine full-wrapper measurement. This document
does not claim literal compliance with the design's "end-to-end `volumeOverlapQuery` span" wording —
it reports the `orient+matrix+kernel` seam Task B′.1 established, named accurately throughout.

**Live (I2) — a different situation, stated precisely rather than by analogy to I1/I3.**
`VolumeOverlapQuery.js`'s `stage:'crossing'` diagnostic event is the **same measurement boundary**
in both Phase B and Phase B′ — it has always started marginally before the query call (before the
aspect-ratio branch test and the relative-matrix computation) and ended after it. What changed
between the two measurements is **the production code inside that boundary**: this milestone
replaced the per-pair ordering scheme `VolumeOverlapQuery.js` used at Phase B's measurement time
(`comparePlacedCanonically`, keyed on the Viewer's own `geometryIndex` — the mechanism the Effect-B
investigation traced the nondeterminism to) with `orientForCrossing` (this milestone's own fix,
landed via Task A2.1). So I2's non-comparability with Phase B is **not** "a different call seam"
in the I1/I3 sense — it is: (a) the production ordering logic under test changed, which is the
milestone's own change being evaluated, and (b) the two measurements were taken in different
sessions on the same machine, with no control for session-to-session load (§B′.4 below gives a
concrete, measured example of each).

### B′.1 Provenance

| | |
|---|---|
| Commit measured against | `eedad40780a6e2fae0897423bac965c5f6eca143` (the raw JSON's own `baseCommitSha`) **plus an uncommitted 11-line harness diff** (adding the `effect-b-pinned-source` I2 variant — see §B′.2); `workingTreeDirty: true` in the raw JSON confirms the dirty state at measurement time |
| Branch | `feature/m4-performance-worker-decision-design` |
| Working-tree note | That exact diff was committed, unmodified, afterward as `b569d03ace00bf0cec2645cd4e0c715559313566`. The raw JSON does not store the dirty diff's own content or a hash of it, so this document cannot independently prove the committed tree is byte-identical to what produced the data — it records that no further edit was made to the harness between the run and the commit, which is as far as this evidence goes. This is the same class of declared deviation Phase B itself recorded for its own Phase-A-uncommitted case (§1.1 above). |
| Harness | `test/performance/m4/proper-crossing-budget-calibration.mjs` (extended across two commits this task: `eedad40` — case (e) aggregate pass, live digest-lifecycle instrumentation; `b569d03` — the pinned-pair fix above) |
| Raw data | `test/performance/results/proper-crossing-budget-calibration-1789134637415.json` (47.2 MB; gitignored, same convention as Phase B — see §1.2 above) |
| Chromium | `151.0.7922.34` on both tiers — identical to Phase B's own build |
| Run window | 2026-09-11T13:48:43.184Z – 2026-09-11T13:50:37.415Z (both tiers, all classes — under 2 minutes wall-clock) |
| Fixture cohort (`typical`) | dbId `2383`, 101 achieved instances, `weightedDensity 14.178` — identical to Phase B's own cohort selection, both tiers |
| Console errors | none, either tier |
| `maxCrossingPointClassifications` read back from the page | 1536, both tiers (unchanged) |

**Totals:** 190 I1 + 50 I3 + 29,540 I2 = **29,780 traversals per tier, 59,560 total.** I2's own count
is larger than Phase B's (10,410/tier) because this run adds the `effect-b-pinned-source` variant
(§B′.2); I1/I3 counts (190/50) are identical to Phase B's own.

### B′.2 The five case families, as covered

| Family | Coverage | Where |
|---|---|---|
| (a) boundary-heavy pairs | existing I1 catalogue (coplanar-touching, edge-vertex-contact, thin-overlap, below-min-penetration, etc.) — unchanged from Phase B | I1 |
| (b) real-model pairs incl. pinned Effect B pairs | `failing-pair-source` (dbId 3547, the real failing pair — unchanged from Phase B) **plus a new `effect-b-pinned-source` variant, added and verified this task**, querying dbId 3076 alone against all three federated models | I2 |
| (c) candidate-saturation (`H1-combs-1500`) | existing I3 | I3, unchanged from Phase B |
| (d) early-exit co-occurrence | existing I3 (`HX-combs-flush-600/1500`) | I3, unchanged from Phase B |
| (e) aggregate million-candidate pass, per-pair orientation + digest cost end to end | new this task — no prior implementation existed | I4, built this task |

**On family (b): this task's own Step 0 investigation was initially wrong about this row.** The
first draft of this document asserted the pinned Effect-B pair was "reachable through the same
cohort machinery" that forces dbId 3076 into a HIGH-quantile cohort (`COHORT_SOURCE_DB_ID` in the
harness). An independent `codex-advisor` review checked this against the source and found that the
HIGH cohort, once computed, was used **only** to feed `labelDensityUnstratified` — it was never
queried, so no traversal in the prior run ever touched dbId 3076 or fragment 537/427. This has been
corrected: `runClearanceArm` now runs a dedicated `effect-b-pinned-source` variant (dbId 3076 alone,
mirroring `failing-pair-source`'s own pattern), and the pair's actual appearance in the recorded
data is verified directly in §B′.5 below, not assumed from the variant's name.

### B′.3 The worst observed spans (§14.3 item 4 analog)

| Tier | Worst wrapper span | Input | Worst kernel span | Input |
|---|---|---|---|---|
| **multi-process (AUTHORITATIVE)** | 14.500 ms | I3 `H1-combs-1500`, rep 1, warm | 14.500 ms | same traversal |
| historical | 14.600 ms | I3 `H1-combs-1500`, rep 1, warm | 14.600 ms | same traversal |

**Wrapper and kernel spans are identical, or differ by exactly one 0.1 ms quantization tick, in
this data set.** This is consistent with Chromium's documented 0.1 ms `performance.now()`
coarsening (§4.2 above) combined with the orientation preamble's own measured cost of roughly
100 ns/decision (§B′.7) — a cost three-plus orders of magnitude below the 0.1 ms floor, so it is not
expected to move the quantized reading in most samples.

`S_worst` (wrapper-level, authoritative tier, over every input class per §14.4's own definition) =
max(I1 5.3 ms, I2 8.2 ms, I3 14.5 ms) = **14.5 ms**. Kernel-level `S_worst`, computed over I1∪I3
only (I2 has no separately-measured kernel-only figure — see §B′.0), is also **14.5 ms**, same
traversal.

**Neither figure is byte-comparable with Phase B's own 15.5 ms** (§B′.0).

### B′.4 Real-model worst, pathological-synthetic worst, and two specific counter differences observed against Phase B

| | multi-process | historical | Phase B (for reference — NOT byte-comparable, §B′.0) |
|---|---|---|---|
| Real-model worst (I2, any variant) | 8.200 ms (`failing-pair-source`, structure frag 363 → arch frag 30 — the same real failing pair Phase B measured) | 8.300 ms | 10.800 / 8.700 ms |
| Pathological-synthetic worst (I3) | 14.500 ms (`H1-combs-1500`, rep 1 warm) | 14.600 ms (`H1-combs-1500`, rep 1 warm) | 15.500 / 15.500 ms |

Two specific, checkable differences from Phase B's own recorded numbers, on the identical fixtures:

- **`H1-combs-600`/`H1-combs-1500`'s `candidatePairsExamined` reads exactly 50,001 here, on both
  tiers** — identical to Phase B's own saturation figure. `H1-combs-200` reads exactly 48,032 here
  — also identical to Phase B. For these three specific fixtures, the candidate-scan count Phase B
  measured is reproduced exactly.
- **`HX-combs-flush-600`'s `candidatePairsExamined` reads 768 here (both tiers) vs. Phase B's own
  recorded 968, and its `pointClassifications` reads 786 here vs. Phase B's 784** (both tiers,
  reproducible across all 5 repetitions in this run). `HX-combs-flush-1500` shows no such
  difference (496/791 here, identical to Phase B's own 496/791). `HX-combs-flush-600`'s own
  construction is a coplanarity-sensitive early-exit fixture (family (d)'s literal definition), and
  `orientForCrossing` can select a different operand as kernel `first` than Phase B's hardcoded
  order did, which changes the relative matrix fed to the kernel. A changed relative matrix moving
  an early-exit boundary in exactly this kind of fixture is consistent with that mechanism; this
  document does not independently isolate the cause with a controlled A/B replay, and reports the
  observation without claiming to have proven the mechanism.
- The synthetic worst-case span (I3) is lower here (14.5/14.6 ms) than Phase B's own recorded
  15.5 ms, and the real-model worst (I2) is also lower here (8.2/8.3 ms) than Phase B's 10.8/8.7 ms,
  while the underlying candidate counts for the saturating H1 fixtures are identical between the two
  measurements. Both measurements used the identical Chromium build (`151.0.7922.34`); this document
  does not have a controlled way to attribute the span difference to session/machine load versus any
  other factor, and does not attempt to.

### B′.5 The pinned Effect-B pair (structure frag 537 → frag 427), directly verified

The `effect-b-pinned-source` I2 variant (dbId 3076 alone, all three models as targets) was added
this task specifically to close the family-(b) coverage gap described in §B′.2. Its recorded
crossing events were searched directly for `sourceFragmentId === 537 && targetFragmentId === 427`
(both structure, `sourceEpoch === 2`):

| | |
|---|---|
| Occurrences found | **20 total — 10 per tier** (2 tiers × 2 broad-phase arms × 5 repetitions = 20; 1 per (tier, arm, rep) combination) |
| `sourceTriangles` / `targetTriangles` | **172 / 72** on all 20 — matches the Effect-B investigation doc's own recorded figure for this pair verbatim |
| `sourceWorldDiagonal` / `targetWorldDiagonal` | **290.969 / 3.918** on all 20 — matches the design doc's own §-table row for "Effect B class-B (F6)" (line 218) verbatim |
| `pointClassifications` | **198** on all 20 occurrences | 
| `exhaustedBudget` | `null` on all 20 occurrences — the traversal completes, it does not exhaust a budget |
| `orientationRank` | 1 (world-diagonal disparity — 290.969 vs. 3.918 — decides it outright) |

The design doc's own table (line 218) records this pair's **pre-fix** behavior as oscillating
between `inconclusive` (147 classifications) and `conclusive` (198 classifications, precheck →
`proceed`) depending on load-order-dependent `geometryIndex` permutation. Every one of the 20
occurrences measured here reads exactly **198** — the design doc's own documented "conclusive"
value. This document reports that observation as a bare fact: 20 out of 20 occurrences, identical
value, matching one specific side of the pre-fix oscillation the design doc recorded. Whether this
constitutes evidence the oscillation is closed is a disposition-adjacent question this document does
not answer.

### B′.6 Traversals exceeding 8 ms and 24.8 ms, per tier

| Tier | Traversals | > 8 ms | | > 24.8 ms | |
|---|---|---|---|---|---|
| multi-process | 29,780 | **17** | 0.057 % | **0** | 0.00 % |
| historical | 29,780 | **17** | 0.057 % | **0** | 0.00 % |

Breakdown (identical on both tiers):

| Count | Input |
|---|---|
| 5 | I3 `H1-combs-200` |
| 5 | I3 `H1-combs-600` |
| 5 | I3 `H1-combs-1500` |
| 2 | I2 `failing-pair-source` |

Both runs independently recorded zero traversals exceeding 24.8 ms.

### B′.7 Case (e) — aggregate orientation-preamble loop benchmark, with separately reported pool-construction amortization (I4)

Built this task (`MEASURE_AGGREGATE_ORIENTATION`); no prior implementation existed (Step 0's
investigation). Design reviewed via `codex-advisor` before implementation.

**What each figure measures, precisely** (an earlier draft of this section used looser labels —
"orientation only," "digest computation," "nanosecond resolution" — that an independent
`codex-advisor` review of the write-up found overstated; the labels below are the corrected ones):

1. **`buildMs`** — the time to construct a small, deliberately rank-stratified pool of 24 real
   `testInstance()` Instances. This is **pool-construction time**, not digest time in isolation: each
   `testInstance()` call performs geometry construction, `weld()`, `ThreeMeshBvhBackend.build()`
   (which computes `geometryDigest` unconditionally, exactly once, with no internal cache —
   `ThreeMeshBvhBackend.js:106`), and `computeGeometryConnectivity()`. What IS exact: 24
   `testInstance()` calls means exactly **24 digest computations** for this pass, a fact read
   directly off `ThreeMeshBvhBackend.build()`'s own unconditional call, independent of how much
   other work each `testInstance()` call also does.
2. **`orientationMs`** — the time for 1,000,000 top-level decisions, each of which runs
   `orientForCrossing(a, b)` **plus** the relative-matrix invert/multiply, **plus** schedule
   indexing, per-rank counting, and a dead-code-elimination checksum — i.e. the full loop body, not
   `orientForCrossing` in isolation. The pair schedule is precomputed outside the timed region and
   cycled inside it, so no `Math.random()` or pair-construction cost is included in `orientationMs`.

| Tier | pool size (= digest computations) | `buildMs` | `N` (top-level decisions) | `orientationMs` | ns/decision (full loop body) | amortized ns/decision incl. pool build |
|---|---|---|---|---|---|---|
| multi-process | 24 | 2.3 ms | 1,000,000 | 102.6 ms | 102.6 ns | 104.9 ns |
| historical | 24 | 2.6 ms | 1,000,000 | 105.0 ms | 105.0 ns | 107.6 ns |

**On timer resolution.** `performance.now()` remains coarsened to 0.1 ms in this configuration
(§4.2). The 102.6–105.0 ms *aggregate* totals above are each bounded by at most one such
quantization tick at their start and end points (≤ 0.1 ms out of ~103 ms, well under 0.1% relative
error), so dividing by 1,000,000 gives a per-decision estimate on the order of 100 ns — this is a
derived average from a coarse-but-large aggregate measurement, not a claim that any individual call
was measured at nanosecond resolution.

**The one comparison this pass licenses against the 8 ms budget:** the full-loop-body figure,
102.6–105.0 ns per top-level decision, is roughly **75,000–78,000× smaller** than the 8,000,000 ns
(8 ms) single-traversal budget this whole design calibrates against — a per-*pair* cost compared
against a per-*traversal* budget. This is not the same comparison as the *aggregate* loop total
(102.6–105.0 ms, before pool-build amortization) against the 8 ms threshold — the aggregate total is,
trivially, larger than 8 ms, and comparing it to the per-traversal budget directly would not be
meaningful; an earlier draft of this section made exactly that comparison and stated the wrong
aggregate figure (108 ms) while doing so. The two reported per-decision figures — 102.6–105.0 ns
(loop body only) and 104.9–107.6 ns (loop body plus amortized pool construction) — are kept
separate throughout this section and in §B′.10/§B′.11 below; neither is a single "digest cost"
figure in isolation (see the per-metric breakdown above).

Rank distribution over the 1,000,000 decisions (identical both tiers — a deterministic synthetic
schedule):

| Rank | Count | % | What actually happens at this rank |
|---|---|---|---|
| 1 (world diagonal) | 920,300 | 92.03 % | one numeric comparison; digest never touched |
| 2 (triangle count) | 36,236 | 3.62 % | two numeric comparisons; digest never touched |
| 3 (vertex count) | 0 | 0.00 % | not forced in this pool — disclosed limitation, below |
| 4 (matrix) | 36,220 | 3.62 % | a 16-element matrix scan; digest never touched |
| 5 (geometry digest) | 3,622 | 0.36 % | `compareDigest` runs and the two digests differ — decided here |
| 6 (caller role, residual) | 3,622 | 0.36 % | `compareDigest` runs (same call as rank 5's own check) and the two digests are equal — falls through to the caller-role residual |

**Digest computations vs. digest comparisons: 24 computations; 7,244 decisions (ranks 5+6
combined, 0.72% of the 1,000,000) reached `compareDigest`; zero digest recomputations during the
decision loop.** Every one of those 7,244 comparisons read an already-computed value — this is the
digest-reuse evidence this pass produces. This document does not claim a specific count of runtime
property reads (`compareDigest` accesses each side's `geometryDigest` field, and JIT behavior makes
counting individual field reads an unreliable metric); "24 computations, 7,244 comparisons" is the
precise, harness-observable figure. (An earlier draft described this as a "1,000,000 : 24 reuse
ratio," which conflated the count of orientation *decisions* with the count of digest
*comparisons*; corrected here.)

**Disclosed limitation:** rank 3 (triangle-count tie, vertex-count differs) has no natural
low-effort construction from this repo's existing fixture helpers and was not deliberately forced.
Its 0-count here is a property of this specific pool's construction; `test/query/orientForCrossing.test.mjs`
already proves rank 3 is reachable at the unit level with hand-built fixtures.

**Cross-check against the live I2 path.** The C-4 orientation-provenance telemetry (already emitted
by `VolumeOverlapQuery.js`, newly *projected* by this task's harness change — see §B′.8) shows every
one of the 29,540 real-model crossing traversals per tier resolving at **rank 1**, both tiers, across
all three I2 variants including the newly-added `effect-b-pinned-source`. **None of the live traffic
measured in this run ever reads `geometryDigest` at all** — on real Revit geometry, the fragments
compared here differ enough in world diagonal that the digest/rank-5-6 machinery is never reached.
This is a property of the specific fixtures and cohorts measured here, not a general claim about all
possible production traffic.

### B′.8 Geometry-build reuse on the live production path (I2)

New instrumentation this task, added to `runClearanceArm` (no `collision/` library file touched —
both hooks below are pre-existing, documented production diagnostic seams):

- **`bvhConstructionSpanCount`** — installs the existing `setSpanRecorder` hook (`scheduler.js`,
  Task 23) and counts `'bvh-construction'` spans. `GeometryRegistry._chainAcceleration` reports
  exactly this label once per `_buildAcceleration` call
  (`collision/geometry/GeometryRegistry.js:229-231`), which is what calls
  `ThreeMeshBvhBackend.build()` — the same unconditional, once-per-call `geometryDigest`
  computation §B′.7 relies on. This count is the digest-*computation* count for the run (it says
  nothing about how many times, if any, a computed digest is later *read* — see §B′.7's own
  distinction).
- **`readyGeometryCount`** — captures each `admitModel()` lease's `epoch` (each admitted model
  mints its own epoch — `CollisionWorld.js:716`) and sums the stable, public
  `world.getEpochGeometryDiagnostics(epoch)` accessor (Task 1.6) across all three, filtered to
  `buildState === 'ready'`, read before `dispose()`.

| Variant | `bvhConstructionSpanCount` | `readyGeometryCount` | Match? | `clearanceOverlapPrechecksRun` (pairs reaching the crossing stage) | `clearanceHardClashExclusions` |
|---|---|---|---|---|---|
| `failing-pair-source` | 10 | 10 | yes | 7 | 3 |
| `S2[k=100:typical:clearance]` | 467 | 467 | yes | 1,034 | 347 |
| `effect-b-pinned-source` | 1,461 | 1,461 | yes | 1,913 | 1,197 |

**`bvhConstructionSpanCount === readyGeometryCount` on every one of the 30 measured clearance runs
per tier (3 variants × 2 arms × 5 reps), 60 runs total, zero mismatches.** Two independently-read
production instrumentation points — one counting a span-recorder event, the other reading the
registry's own per-epoch entry count — agree exactly, on every run, on both tiers. This is
consistent with `GeometryRegistry`'s "insert first, then build" single-flight design
(`GeometryRegistry.js:58-77`) building each `(loadEpoch, geometryIndex)` at most once; it is not, on
its own, an independent proof of that property in the general case — two aggregate counters agreeing
is evidence consistent with the single-flight design, not a substitute for reading the design itself
(§B′.0's own citation of the source remains the actual argument for "at most once per key").

**What this table does and does not show about reuse.** `clearanceOverlapPrechecksRun /
readyGeometryCount` is a ratio of *crossing-stage pairs per built geometry* — 1,034/467 ≈ 2.2 for
the typical cohort, 1,913/1,461 ≈ 1.3 for the pinned-pair-source query, and 7/10 < 1 for
`failing-pair-source` (more geometries got built during broad-phase candidate resolution across all
three models than ended up reaching the narrow-phase crossing stage for that single source dbId).
None of these ratios is a "digest reuse ratio": §B′.7 already shows that on this specific measured
run, **orientation never resolved past rank 1**, so no digest value was ever read/compared on the
live path at all in this run. What these ratios do show is **geometry/BVH build reuse** — a
geometry, once built, is available to every later candidate pair in its epoch without being rebuilt
— which is the broader property the digest computation rides on top of, not a measurement of digest
comparison frequency specifically.

### B′.9 Deterministic counters — `M_legit`, and what does and does not follow from it

| | Phase B | Phase B′ (this task, both tiers) |
|---|---|---|
| `M_legit` (max `pointClassifications`, I1 ∪ I2) | 1152 | 1152 |
| Cap | 1536 | 1536 |
| Cap fired | 0 times | 0 times, both tiers, 59,560 traversals |
| Overall max across every class (incl. I3) | 1152 | 1152 |

**This is an observed-maximum match, reported as a bare fact — not evidence of per-traversal
operand-order invariance.** An earlier draft of this section argued the identical `M_legit` value
"confirms" that `properCrossingQuery`'s counters are operand-order-invariant. An independent
`codex-advisor` review pointed out that this document's own §B′.4 reports a counter that is NOT
identical between Phase B and Phase B′ on a specific fixture (`HX-combs-flush-600`'s
`candidatePairsExamined`: 968 → 768, `pointClassifications`: 784 → 786) — so a blanket
order-invariance claim is directly contradicted by this document's own data and has been removed.
What is true, narrowly: the *maximum* `pointClassifications` value observed over I1 ∪ I2 is 1152 in
both measurements, and the 1536 cap fired zero times in both. Nothing broader should be inferred
from that coincidence.

### B′.10 Side-by-side vs. Phase B's headline numbers

| | Phase B | Phase B′ (this task) | Comparable? |
|---|---|---|---|
| Synthetic worst (multi-process) | 15.500 ms | 14.500 ms (wrapper = kernel) | No — I1/I3 call-seam changed (§B′.0) |
| Real-model worst (multi-process) | 10.800 ms | 8.200 ms | No — same measurement boundary, but the ordering logic inside it changed, and the two measurements are different sessions (§B′.0, §B′.4) |
| Real-model worst (historical) | 8.700 ms | 8.300 ms | No, same reason |
| Synthetic worst (historical) | 15.500 ms | 14.600 ms | No — I1/I3 call-seam changed |
| `M_legit` | 1152 | 1152 | The two *maximum values* are identical, reported as a bare fact (§B′.9) — this is not the same as the underlying per-traversal counters being comparable in general, which §B′.4/§B′.9 show they are not always |
| Traversals > 8 ms (both tiers combined) | 35 (17 + 18) | 34 (17 + 17) | No — same reasons as above, plus I2's traversal count itself is larger this run (the new `effect-b-pinned-source` variant) |
| Traversals > 24.8 ms | 0 | 0 | Both runs independently observed zero — not stated as "seam-independent," since a large enough change in measured work could in principle move a span across that threshold |
| Orientation-preamble loop cost (aggregate, new in Phase B′) | not measured — this omission was finding #7's own critique | 102.6–105.0 ns/decision (loop body); 104.9–107.6 ns/decision (loop body + amortized pool construction) — see §B′.7 | N/A — new in Phase B′, closes finding #7 |

**Every "No" row compares numbers produced under different conditions** — a different harness call
seam for I1/I3, or the same measurement boundary over changed production ordering logic plus an
uncontrolled session difference for I2. This document reports both sets of numbers and the
differences between them; it draws no conclusion about whether those differences represent an
improvement, a regression, or neither. The one row with a genuinely new figure — the aggregate
orientation-preamble loop benchmark — is the number finding #7 asked this task to produce, and no
comparable figure existed before this task.

### B′.11 What this does and does not authorize

- It measures all five case families (a)–(e) the design's §9.4 scope row specifies, across both
  pre-registered runtime tiers, including a corrected, directly-verified measurement of the pinned
  Effect-B pair (§B′.5) that an earlier draft of this task had incorrectly claimed was already
  covered.
- It reports `M_legit`'s observed maximum as unchanged and the 1536 cap as never firing, without
  inferring general per-traversal counter invariance from that fact (§B′.9).
- It reports two specific, checkable differences from Phase B's own counters
  (`HX-combs-flush-600`'s `candidatePairsExamined`/`pointClassifications`) without asserting a
  causal mechanism beyond "consistent with" (§B′.4).
- It measures, for the first time, an aggregate orientation-preamble loop benchmark
  (102.6–105.0 ns/decision, loop body only; 104.9–107.6 ns/decision including amortized pool
  construction), closing finding #7's own critique that this cost had only ever been "declared
  negligible from operation counts" — and reports precisely what each figure does and does not
  include (§B′.7), rather than a single undifferentiated "digest cost."
- **It does not** apply §14.4's (or any) disposition rule to these numbers. Task B′.4 owns that
  decision.
- **It does not** claim the orientation fix made `properCrossingQuery` faster, slower, or otherwise
  different in effect than Phase B measured. The measurements are not on byte-comparable terms
  (§B′.0, §B′.10), and this document reports the numbers without characterizing what, if anything,
  their differences mean.

### B′.12 Disposition (Task B′.4)

Applying calibration doc §14.4's rule (reused verbatim per design doc §9.4) to §B′.10's `S_worst`
figures:

| Tier | `S_worst` (wrapper = kernel, §B′.0) | Bracket |
|---|---|---|
| multi-process (authoritative) | 14.500 ms | `8 ms < S_worst ≤ 24.8 ms` |
| historical | 14.600 ms | `8 ms < S_worst ≤ 24.8 ms` |

Both tiers' `S_worst` fall strictly inside the CAUTION bracket — neither at or under 8ms
(CONFORMANT), nor over 24.8ms (stop and escalate to the milestone owner).

### **Classification: CAUTION (§14.4 branch 2).**

Per §14.4 branch 2, CAUTION is status quo: no milestone-owner sign-off is required, and this plan's
remaining phases (C onward) may proceed. This bare classification carries no claim about *why* the
measured span is what it is (session load, real workload, or the corrected orientation seam) — §B′.9
and §B′.10 already document that these numbers are not byte-comparable with Phase B's own
15.5ms/10.8ms headline figures, for reasons unrelated to whether the fix is correct.

**Milestone-owner decision: N/A (CAUTION is status quo, proceeds without escalation).**

The checkpoint artifact enforcing this classification for later, isolated task dispatches is
`docs/research/phase-b-prime-checkpoint.md` (Task B′.4 Step 3).
