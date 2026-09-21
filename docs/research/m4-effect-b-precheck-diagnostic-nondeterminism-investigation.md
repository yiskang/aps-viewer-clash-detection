# M4 Effect B — Precheck / Diagnostic Nondeterminism: Pair-Identity Investigation

**Executes:** `docs/prompts/m4-effect-b-pair-identity-investigation-prompt.md` (Steps 1–5).
**Date:** 2026-09-11
**Scope:** read-only. No file under `collision/` was modified, nothing was committed, §6.4 was not
touched, M4 verdict semantics were not changed, no new instrumentation was added, and neither the
full M2/M3 gates nor the full M4 canonical matrix nor Phase 4 was run. Every prohibition is
individually re-checked in §9.

**Step 5 disposition:**

> ## `SEMANTIC_PRECHECK_NONDETERMINISM`

---

## 0. The answer, in one paragraph

Effect B is **not** timing. It is a **non-semantic Viewer identifier leaking into a geometric
tolerance decision**. `comparePlacedCanonically` (`collision/CollisionWorld.js:189-198`) decides
which operand of a narrow-phase pair becomes `bvhA` — i.e. `L_canonical` — by comparing
`(loadEpoch, geometryIndex, fragmentId)` lexicographically, where `geometryIndex` is the Viewer's
own `FragmentList.getGeometryId(fragId)` (`collision/viewer/ViewerModelAdapter.js:117,267`).
**That id is re-assigned, in a different permutation, on every page load**: measured over the 14
independent loads of the identical fixture in which geometry ids were captured, 490 of 543 Structure
fragments received a different `geometryId`, while their stored `worldMatrix` bytes and their welded
position/index buffers were **bit-identical every time**. For a pair whose two operands live in the **same** epoch, the
permutation therefore flips which side is canonical-first, which rescales
`surfaceEpsilon = surfaceEpsilonFactor × localDiagonalA` and the whole
`offsetLadderFactors × localDiagonalA` probe ladder — and a borderline pair's `boundary`
classification flips with it. Across those 14 page loads the presence of every single one of the 36
unstable `inconclusive-crossing` diagnostics is a **perfect function of that canonical sign, with
zero exceptions** — and the mechanism is confirmed **causally, inside one page load**: replaying 106
affected pairs through the exported `properCrossingQuery` with nothing changed but which operand is
`A` flips `inconclusive` on **66 of them** (§6.5a). The effect is *not* diagnostic-only: on the
clearance path one pair
(`structure frag 537 → structure frag 427`) moves between precheck **`inconclusive`** and precheck
**`proceed`** purely as a function of the permutation, taking `conclusive`,
`inconclusiveCauses` and the §6.4-compared statistic `clearanceDistanceQueriesRun` with it. It
reproduces **identically on the pre-Phase-C `HEAD` build and on the post-Phase-C working tree**, so
it is fully independent of the wall-clock defect (Effect A) that Phase C removed.

---

## 1. Constraints honored, and what was actually run

| Prohibition (prompt) | Status |
|---|---|
| Do not modify source | **Honored.** `git status` is byte-for-byte what it was at session start; the only file this session writes inside the repo is this document. |
| Do not commit | **Honored.** No `git add`, no `git commit`. |
| Do not relax §6.4 | **Honored.** `test/performance/m4/correctness-comparator.mjs` not opened for writing; §6.4 not touched. |
| Do not change M4 verdict semantics | **Honored.** `verdict-reducer.mjs` untouched. |
| Do not run the full M2/M3 gates or the full M4 canonical matrix | **Honored.** No `run-gate*.mjs` was executed. The reproduction uses a purpose-built, throwaway harness in the session scratchpad (§3.3). |
| Do not run Phase 4 | **Honored.** Not started. |
| Do not add instrumentation | **Honored.** Everything read is either the library's own public `result.statistics.diagnostics` array or the already-landed `setDiagnosticEventRecorder` seam (`collision/scheduler.js:241`), which `test/performance/m4/structure-fragment-clearance-regression.mjs` and `test/CollisionWorld.diagnosticEvents.test.mjs` already use the same way. |

**Working-tree note.** The tree carries someone else's uncommitted Phase A + Phase C work
(`collision/constants.js`, `collision/query/ProperCrossingQuery.js`,
`collision/query/VolumeOverlapQuery.js`, `collision/README.md`, `CHANGELOG.md` and five test files).
None of it was touched, staged, reverted or committed by this investigation.

---

## 2. What Effect B is, re-derived from the archived pre-fix baseline

The "20-run pre-fix baseline" the prompt refers to is recoverable: it is the twenty
`test/performance/results/m2-gate-*.json` artifacts written between 12:16:18 and 12:29:30 local on
2026-09-11 — before the Phase C edit landed in the working tree at 12:36:08. Each artifact is one
`chromium.launch` → one page → one fixture load → **four** independent `findClashes` executions
(`tlasCold`, `tlasWarm` on one world; `linearCold`, `linearWarm` on a second, genuinely fresh world).

Read straight out of those twenty artifacts, `tlasWarm` arm:

| Statistic | Values over the 20 runs |
|---|---|
| `pairCount` | **1197**, every run |
| `broadPhasePairs` / `narrowPhasePairs` | **1913 / 1913**, every run |
| `unverified-open-component` | **44**, every run |
| `unverified-parity-operand` | **823**, every run |
| `non-manifold-component` | **241**, every run |
| `geometry-aspect-ratio-exceeds-tolerance-model` | **280**, every run |
| `inconclusive-containment` | **281**, every run |
| `crossing-budget-exhausted` | **11**, every run |
| **`inconclusive-crossing`** | **80, 110, 82, 110, 110, 90, 104, 86, 104, 80, 80, 104, 110, 82, 100, 104, 110, 74, 90, 110** |

So Effect B is one number moving, inside an otherwise perfectly reproducible result. Two further
facts from the same artifacts frame the whole investigation — stated carefully, because a looser
version of fact 1 is false:

1. **The two *warm* arms agree exactly, in 20 of 20 runs.** `tlasWarm` and `linearWarm` report the
   identical `inconclusive-crossing` **and** the identical `crossing-budget-exhausted` (a constant
   11) in every run. This is the within-page-load invariance the rest of the document relies on.
2. **The two *Cold* arms do not always agree with them — and Effect A moves
   `inconclusive-crossing` too.** In **10 of the 20** runs at least one cold arm reports a *lower*
   `inconclusive-crossing` than the warm arms while reporting a *higher*
   `crossing-budget-exhausted` (e.g. `m2-gate-1789100299038.json`: `tlasCold` **108 + 13**,
   `tlasWarm` **110 + 11**). That is exactly `properCrossingQuery`'s own reason ladder —
   `if (aborted) 'crossing-budget-exhausted'; else if (inconclusive) 'inconclusive-crossing'`
   (post-C `ProperCrossingQuery.js:305-307`; the identical ladder sits at ~`:166-171` on `HEAD`) — so
   a timing abort **relabels** a would-be
   `inconclusive-crossing` rather than adding a new entry. **Effect A therefore perturbs
   `inconclusive-crossing` as well**, by ±1…5, in cold arms only.

The two effects are separable because their magnitudes and their scopes do not overlap: Effect A
moves the label by 1–5 and only in a cold arm; Effect B moves the **warm** base value, which every
arm of a given page load shares, across a 74 → 110 range. Two independently-loaded pages differ by up
to **36** warm `inconclusive-crossing` entries; the two warm arms inside one page differ by **zero**,
in every one of the twenty runs.

**Consequence for this document's evidence, recorded explicitly:** the archived baseline is used
here only for the warm-arm figures. Everything that rules timing out for Effect B comes from the
**same-page-load pair-identity** evidence in §4.1 and from the fact that Effect B reproduces on a
build with no wall clock in the semantic path (§6.1) — not from any cold-vs-warm comparison.

---

## 3. Step 1 — reproducing Effect B with pair identity retained

### 3.1 Why the gate artifacts alone cannot answer it

`run-gate-m2.mjs:88-92`'s `summarizeDiagnostics` keeps `{count, byReason, sample}` with
`sample = diagnostics.slice(0, 20)`. In all twenty artifacts the 20-entry sample contains **zero**
crossing diagnostics (it is filled by `unverified-parity-operand` / `unverified-open-component`
entries). **Pair identity for the crossing diagnostics is not present in any archived artifact.**
This is the same gap the earlier blocker investigation recorded as finding G1.

### 3.2 What existing telemetry *does* retain — no new instrumentation needed

It is only the *gate's own summarizer* that drops the identity, not the library. `_runNarrowPhasePair`'s
`attach()` (`collision/CollisionWorld.js:2196-2210`) pushes every query-mode diagnostic into
`statistics.diagnostics` already completed to
`{scope:'pair', reason, role?, sourceFragment:{modelId,dbId,fragId}, targetFragment:{...}}`.
Reading the returned array in the page therefore yields the full per-pair identity the prompt's
Step 1 list asks for, with no library change. On the clearance path the already-landed
`setDiagnosticEventRecorder` seam additionally carries, per pair,
`conclusive` + `inconclusiveCauses` + `containmentSamplesUsed`
(`collision/query/ClearanceHardClashPrecheck.js:31-38`) and the crossing term's full deterministic
counter state — `candidatePairsExamined`, `crossingPairsExamined`, `pointClassifications`,
`exhaustedBudget`, `timeBudgetExceeded`, `crossingElapsedMs`
(`collision/query/VolumeOverlapQuery.js:132-157`).

Against the prompt's Step 1 checklist:

| Required field | Available? | Source |
|---|---|---|
| `sourceFragmentId` / `targetFragmentId` | ✅ | `statistics.diagnostics[].{source,target}Fragment` and the recorder's `diagnosticPairContext` |
| diagnostic reason | ✅ | same |
| `conclusive` | ✅ (clearance path) | `hard-clash-precheck` / `stage:'volume-overlap-query'` event |
| precheck disposition (`excluded`/`proceed`/`inconclusive`/`skip-precheck`) | ✅ **derived, not directly emitted** | `stage:'not-run'` **with `precheckNotRunReason === 'aabb-disjoint'`** ⇒ `skip-precheck`; a `clearance-distance-query` event for the pair ⇒ `proceed`; a `clearance-hard-clash-precheck-inconclusive` diagnostic naming the pair ⇒ `inconclusive`; otherwise ⇒ `excluded` (`CollisionWorld.js:2442-2456`). **The reason must be branched on, not assumed:** `stage:'not-run'` is also emitted for `geometry-unsupported-before-precheck` (⇒ outcome `geometry-unavailable`, `CollisionWorld.js:2377,2381`) and `anisotropic-scale-before-precheck` (⇒ outcome `anisotropic-scale`, `:2404`), neither of which is `skip-precheck`. **Measured:** across the 10 clearance replays, all 650 `not-run` events (65 per session) carried `aabb-disjoint`; the other two reasons occurred **zero** times, so no pair in the A–E classification is affected either way. |
| `inconclusiveCauses` | ✅ | same event |
| contributes to `clearanceHardClashExclusions` | ✅ **at dbId granularity only** | `excluded` is the only contributing status (`CollisionWorld.js:1787-1805`); the statistic itself is a deduplicated dbId-key count and cannot attribute a fragment pair. Recorded as a limitation (§9). |
| candidate index / order | ⚠️ **not retained by any landed seam.** The `precheck-candidate-list` capture the earlier blocker investigation used is a spike-input hook, not a diagnostic event. Not needed here — §6.2 falsifies order dependence by a stronger argument. |
| local precheck / crossing timing | ✅ | per-pair `stage:'crossing'` `ms` and `crossingElapsedMs` |
| deterministic operation counters | ✅ | `candidatePairsExamined`, `crossingPairsExamined`, `pointClassifications`, `exhaustedBudget` |

Nothing in the prompt's list was missing in a way that blocked the investigation, so the
"stop and report what is missing" branch was not taken. The one genuinely absent item
(candidate index) is named above rather than improvised.

### 3.3 The harnesses

Two throwaway Playwright harnesses, written to the **session scratchpad** and never added to the
repo, both mirroring `run-gate-m2.mjs`'s fixture load (Architecture → Structure → Mechanical via
`#keep-current-models`, the same `isLoadDone()` + `instanceTree` waits, the same sacrificial
warm-up) and its query (`mode:'volume-overlap'`, `source: Structure dbId 3076`,
`target: all three models`, `groupBy:'dbId'`):

- **v1** — N repetitions in one page, each on a genuinely fresh `CollisionWorld`, alternating
  `broadPhase: 'tlas' | 'linear'`; retains the **full** `statistics.diagnostics` array (both the
  crossing entries and every other entry, as identity keys), the full public pair-signature list,
  every statistic, and a load-time fingerprint of every fragment world matrix in all three models.
- **v2** — one volume-overlap run with the world **retained** for introspection (stored
  `_placementByEpoch` world matrices, `_registry` welded position/index buffers, Viewer
  `getGeometryId`), followed by a **clearance replay** of the same source
  (`mode:'clearance'`, `clearance: 0.05`) with the diagnostic-event recorder installed, so every
  pair's precheck disposition, `conclusive`, `inconclusiveCauses` and crossing counters are captured.

### 3.4 Provenance of the two builds measured

Recorded so a future reader can identify exactly what was executed, since the post-C build is an
**uncommitted working tree** and `HEAD` will move.

| | |
|---|---|
| Base commit (`HEAD`) — and the **pre-C build** served to the Q series | `ef63f21908e162637aa672d564b2811760143ab8` |
| Branch | `feature/m4-performance-worker-decision-design` |
| Working-tree diff over tracked files, SHA-256 of `git diff` | `ffa7bb066f6cc18617aae990a0333904be72a6c8ff2d4b6e3593d1752aa2a717` |

SHA-256 of every source file whose uncommitted content defines the **post-C build** measured by the
A–G and P series:

| File | SHA-256 |
|---|---|
| `collision/constants.js` | `389e675ef7def0c6cbffa2ddff2ea5176b8b46fc5159881592c5c671cfe73a35` |
| `collision/query/ProperCrossingQuery.js` | `03bc4343b55f9be7ae12abfb884064f648e6b67aa10000132bb05de76377e954` |
| `collision/query/VolumeOverlapQuery.js` | `59375ccb1f02d5483692616ca3176a82bec77e8ae172ac13b4dde2713bffb5e7` |
| `collision/README.md` | `244148ca01d65b8749971bf2640382794991748063ef4feb45dddd67e55bdddc` |

Environment: Chromium `151.0.7922.34`, `darwin 25.6.0 (arm64)`, launch args
`--no-sandbox --disable-dev-shm-usage --single-process --no-zygote`, i.e. the M2 gate's own.

**Raw data retention — a declared gap.** Every number in this document is computed from
machine-readable per-session JSON (one file per session: full crossing-diagnostic identity, full
other-diagnostic identity, full pair signatures, all statistics, per-fragment placement/geometry/id
fingerprints, and every clearance `pairState`). Those files were written to the **session
scratchpad**, not into the repository, because this task's own write constraint limited repository
writes to this document. They therefore do **not** outlive the session. **Recommendation:** re-run
the harnesses and retain their JSON under `test/performance/results/` (gitignored, the same place
every other gate's artifacts live, and the same retention caveat the Phase B calibration document
records) before this report is cited in an M4 decision — and, better, land the deterministic
regression named in §9 item 8, which needs no live Viewer at all.

### 3.5 Runs performed

| Series | Build served | Sessions (independent browser + page + fixture load) | Per session |
|---|---|---|---|
| **A–G** (v1) | working tree, **post**-Phase-C | 7 | 4 volume-overlap runs (2× TLAS, 2× linear) |
| **P1–P10** (v2) | working tree, **post**-Phase-C | 10 | 1 volume-overlap + 1 clearance |
| **Q1–Q4** (v2) | **`git archive HEAD`**, i.e. **pre**-Phase-A/C, both wall-clock semantic branches live (verified live at `ProperCrossingQuery.js:84` and `:131` as served) | 4 | 1 volume-overlap + 1 clearance |

The pre-fix tree was extracted with `git archive HEAD | tar -x` into the scratchpad, with
`node_modules`, `.env` and `wwwroot/vendor` symlinked from the repo, and served by its **own**
`node server.js` on port 8081. **The repository working tree was never modified to obtain it.**

---

## 4. Step 2 — exact pair sets compared across runs

### 4.1 Inside one page load: perfectly stable

In every one of the 7 v1 sessions, across 4 runs alternating `broadPhase: 'tlas' | 'linear'`, each on
its own brand-new `CollisionWorld`:

- the exact `(reason, sourceFragment, targetFragment)` set of crossing diagnostics — **identical**;
- the exact identity list of **every other** diagnostic — **identical**;
- the full public pair-signature list — **identical**;
- every non-timing statistic — **identical**.

…while `wallMs` for those same four runs varied by up to **26 %** within a session (e.g. session A:
2841 / 2431 / 2360 / 2249 ms). `crossing-budget-exhausted` was a constant **11** in every run of
every session. (Cold-vs-warm agreement inside one page is covered separately, at count level, by the
archived gate artifacts — §2, fact 1.)

### 4.2 Across page loads: the pair set genuinely changes

Pooled over the **17** post-Phase-C sessions:

| | |
|---|---|
| Union of `(reason, target fragment)` entries seen in any session | **121** |
| Present in **every** session (stable core) | **65** |
| **Entering / leaving between sessions** | **56** |
| Entries whose **reason** changes for the same pair | **0** |
| Unstable entries that are `crossing-budget-exhausted` | **0** — every one is `inconclusive-crossing` |

Every crossing diagnostic on this query, stable or unstable, is **Structure → Structure**: source
model and target model are the same model, hence the same `loadEpoch`. That fact is load-bearing in
§6.5.

### 4.3 Everything else is byte-stable across page loads

| Compared across all 17 post-C sessions | Result |
|---|---|
| Public volume-overlap pair signatures (1197) | **identical** |
| Identity list of every non-crossing diagnostic | **identical** |
| `broadPhasePairs`, `narrowPhasePairs`, all non-`*Ms` statistics | **identical** |
| Clearance public pair set incl. distances (30 pairs) | **identical** |
| `clearanceHardClashExclusions` (1197), `clearanceOverlapPrechecksRun` (1913), `clearanceHits` (30) | **identical** |
| `clearance-hard-clash-precheck-inconclusive` diagnostic **count** | **464 ↔ 465** |
| `clearanceDistanceQueriesRun` (a §6.4-compared statistic) | **129 ↔ 130** |

### 4.4 The discriminator the prompt asked for

> *Are `1762 / 1784`-style totals caused by label/count drift only, or by actual pair-level semantic
> changes?*

**Neither is the whole answer, and the totals are actively misleading.** Sessions **B** and **F**
both reported exactly **79** crossing diagnostics — and their pair sets are *different*: **12** entries
are in B and not in F, and **12** different entries are in F and not in B. An equal total is not
evidence of an equal set. Underneath the totals, 56 pairs genuinely enter and leave, and on the clearance path at
least one of them genuinely changes semantic disposition (§5).

### 4.5 Every session, both builds

One `findClashes` per session shown (the v1 sessions' other three runs are identical to the one
listed, per §4.1). `crossing-budget-exhausted` is **11 in every session of both builds** — the warm
value; no cold arm was measured in these series, which is why Effect A does not appear here.

| Session | Build | `inconclusive-crossing` | total crossing diagnostics |
|---|---|---|---|
| A | post-C | 76 | 87 |
| B | post-C | 68 | 79 |
| C | post-C | 110 | 121 |
| D | post-C | 110 | 121 |
| E | post-C | 104 | 115 |
| F | post-C | 68 | 79 |
| G | post-C | 102 | 113 |
| P1 | post-C | 110 | 121 |
| P2 | post-C | 104 | 115 |
| P3 | post-C | 100 | 111 |
| P4 | post-C | 86 | 97 |
| P5 | post-C | 86 | 97 |
| P6 | post-C | 82 | 93 |
| P7 | post-C | 106 | 117 |
| P8 | post-C | 106 | 117 |
| P9 | post-C | 92 | 103 |
| P10 | post-C | 110 | 121 |
| **Q1** | **pre-C (`HEAD`)** | 90 | 101 |
| **Q2** | **pre-C (`HEAD`)** | 90 | 101 |
| **Q3** | **pre-C (`HEAD`)** | 104 | 115 |
| **Q4** | **pre-C (`HEAD`)** | 80 | 91 |

The pre-C sessions, taken on a build where both wall-clock semantic branches are live, show the same
oscillation over the same pair population: union 115 `(reason, target)` entries, 87 present in every
session, **28 entering/leaving, none of them `crossing-budget-exhausted`, none changing reason**.
Their clearance arms carry the same precheck flip (`clearanceDistanceQueriesRun` 130 / 130 / **129** /
130; `clearance-hard-clash-precheck-inconclusive` 464 / 464 / **465** / 464) against the same stable
backdrop (`clearanceHardClashExclusions` 1197, `clearanceHits` 30 and an identical clearance pair set
in all four).

**Effect B is therefore not an artifact of Phase C, and Phase C does not fix it.**

---

## 5. Step 3 — classification of every unstable pair

Classified from the 10 post-C clearance replays, which evaluate all 1978 clearance candidate pairs
in every session. A pair can only be classified when **both** canonical orientations were actually
observed for it in that set of replays; otherwise it is honestly recorded as **E**.

| Class | Definition | Count |
|---|---|---|
| **A** — diagnostic-only | clearance precheck status *and* final clearance result stable | **35** |
| **B** — semantic precheck drift, final result stable | precheck status changes; final clearance result unchanged | **1** |
| **C** — semantic precheck drift, final result changed | — | **0** |
| **D** — accounting-only | the raw diagnostic multiset is stable and only summarization moves | **0** |
| **E** — insufficient evidence | only one canonical orientation observed in the clearance replays | **20** |

Of the unstable pairs, **25** additionally change their clearance `inconclusiveCauses`
list — `crossing-tolerance-ambiguous` appears and disappears while `non-manifold-component` stays.
Those remain class **A** because the `non-manifold-component` taint alone already forces
`conclusive: false` (`VolumeOverlapQuery.js`'s `taintedByNonManifoldOrUnverified`), so the
disposition does not move with the cause list. **Per the prompt's own instruction, no pair was
classed "diagnostic-only" on the strength of stable aggregate distances or witnesses**: class A here
means the pair's own precheck status was observed under both orientations and did not change.

### 5.1 The class-B pair, in full

`structure dbId 3076 / frag 537 → structure frag 427`, 172 vs 72 triangles, identical stored world
matrices and identical welded geometry bytes in every session:

| Session | `geometryId` source | `geometryId` target | canonical-first | `conclusive` | `inconclusiveCauses` | `pointClassifications` | precheck status | distance query |
|---|---|---|---|---|---|---|---|---|
| P1 | 482 | 302 | **target** | `false` | `['crossing-tolerance-ambiguous']` | 147 | **`inconclusive`** | not run |
| P2 | 455 | 354 | **target** | `false` | `['crossing-tolerance-ambiguous']` | 147 | **`inconclusive`** | not run |
| P3 | 397 | 419 | **source** | `true` | `[]` | 198 | **`proceed`** | `beyond-threshold` |
| P4 | 377 | 419 | **source** | `true` | `[]` | 198 | **`proceed`** | `beyond-threshold` |
| P5 | 377 | 419 | **source** | `true` | `[]` | 198 | **`proceed`** | `beyond-threshold` |
| P6 | 363 | 399 | **source** | `true` | `[]` | 198 | **`proceed`** | `beyond-threshold` |
| P7 | 468 | 367 | **target** | `false` | `['crossing-tolerance-ambiguous']` | 147 | **`inconclusive`** | not run |
| P8 | 468 | 303 | **target** | `false` | `['crossing-tolerance-ambiguous']` | 147 | **`inconclusive`** | not run |
| P9 | 357 | 379 | **source** | `true` | `[]` | 198 | **`proceed`** | `beyond-threshold` |
| P10 | 482 | 334 | **target** | `false` | `['crossing-tolerance-ambiguous']` | 147 | **`inconclusive`** | not run |
| **Q1** (pre-C) | 356 | 392 | **source** | `true` | `[]` | n/a | **`proceed`** | `beyond-threshold` |
| **Q2** (pre-C) | 356 | 419 | **source** | `true` | `[]` | n/a | **`proceed`** | `beyond-threshold` |
| **Q3** (pre-C) | 455 | 317 | **target** | `false` | `['crossing-tolerance-ambiguous']` | n/a | **`inconclusive`** | not run |
| **Q4** (pre-C) | 350 | 419 | **source** | `true` | `[]` | n/a | **`proceed`** | `beyond-threshold` |

(`pointClassifications` reads `n/a` on the pre-C rows because that counter is a Phase A addition and
does not exist on the `HEAD` build. The rule holds in **14 of 14** sessions with no exception:
canonical-first = target ⇒ `inconclusive`; canonical-first = source ⇒ `proceed`.)

Same operands, same matrices, same geometry, same machine, same code. The only input that changed
is which integer the Viewer happened to hand each geometry on that page load. `exhaustedBudget` is
`null` in every row — no budget, deterministic or otherwise, is involved. The same flip is present
on the **pre**-Phase-C build (Q series: `clearanceDistanceQueriesRun` 130/130/**129**/130).

This is a **correctness-bearing verdict** changing: `proceed` sends the pair to
`clearanceQuery`; `inconclusive` returns early and publishes a
`clearance-hard-clash-precheck-inconclusive` diagnostic instead.

---

## 6. Step 4 — mechanism, investigated only as far as the unstable pairs justify

### 6.1 Timing — ruled out, locally and in aggregate

- **Aggregate.** No relationship between `wallMs` and the count. Session D (110 diagnostics) ran
  the whole query in ~1.9 s; session A (76) took up to 2.8 s; session F (68) took ~1.96 s.
- **Local.** Inside a single page load, four runs whose `wallMs` spans 26 % produce **byte-identical
  diagnostic identity sets**. Cold-vs-warm is covered at count level by the archived gate artifacts
  (a ~2× narrow-phase cost difference between the cold and warm arms, and `inconclusive-crossing`
  equal in all four arms in 20 of 20 runs); at identity level my own sessions cover four
  fresh-`CollisionWorld` runs alternating broad phase.
- **Structural.** The whole effect reproduces on the **post-Phase-C** build, where no wall clock can
  reach a semantic field at all (`ProperCrossingQuery.js:91-110, 267-298` — telemetry only) and
  `crossing-budget-exhausted` is a constant 11 in all 17 sessions. It equally reproduces on the
  **pre-Phase-C** build. It is therefore orthogonal to Effect A in both directions.

### 6.2 Candidate order / arm / predecessor — ruled out

TLAS and linear traverse the candidate list in demonstrably different orders, and the two `*Cold`
runs have a completely different predecessor history from the two `*Warm` runs. All four agree
exactly, in every session and in all twenty archived gate runs. Conversely, two runs with the
*identical* arm, the identical order and the identical predecessor history disagree whenever they
sit in different page loads. Order cannot be the variable.

### 6.3 Shared mutable state — ruled out

Same conclusion, same evidence: module-level scratch in `ProperCrossingQuery.js:19-27`,
`ContainmentQuery.js` and `VolumeOverlapQuery.js` is re-entered identically by four sequential runs
inside one page (`properCrossingQuery` contains no `await`, so no interleaving exists), yet those
four agree while a fresh page disagrees. A scratch-aliasing defect cannot be constant within a
process and variable between processes.

### 6.4 Placement numerics and geometry content — ruled out, by direct measurement

Measured in each of the 14 v2/pre-C sessions, from the library's **own** stored records rather than
from the Viewer:

| Fingerprint (543 Structure fragments) | Differs across sessions? |
|---|---|
| `_placementByEpoch` stored `worldMatrix` bytes | **0 / 543** |
| Welded `position` + `index` bytes actually handed to the BVH (`_registry`) | **0 / 543** |
| Viewer `globalOffset` / `placementWithOffset` / model bounding boxes (all 3 models) | identical |
| FNV digest over **every** fragment world matrix of all 3 models | identical (`3913657232`) |
| **Viewer `FragmentList.getGeometryId(fragId)`** | **490 / 543** |

So the geometry and the placement the library computes on are bit-identical across page loads. The
only thing that moves is the **identifier**.

### 6.5 Established mechanism: `comparePlacedCanonically`'s `geometryIndex` term

```js
// collision/CollisionWorld.js:189-198
function comparePlacedCanonically(a, b) {
  const idA = a.instance.geometryIdentity;
  const idB = b.instance.geometryIdentity;
  if (idA.loadEpoch !== idB.loadEpoch) return idA.loadEpoch < idB.loadEpoch ? -1 : 1;
  if (idA.geometryIndex !== idB.geometryIndex) return idA.geometryIndex < idB.geometryIndex ? -1 : 1;
  ...
}
```

`geometryIndex` is `fragList.getGeometryId(fragId)`, captured at
`collision/viewer/ViewerModelAdapter.js:117` and `:267`. The comparator's own header comment states
the premise this investigation falsifies:

> `(loadEpoch, geometryIndex, fragmentId)` compared lexicographically is total and **stable** …

It is total. It is **not stable across page loads.**

The comparator's result is threaded into `volumeOverlapQuery` as `compareCanonical`
(`CollisionWorld.js:2276-2280` on the volume-overlap path, `:2419-2421` on the clearance precheck
path), which picks `canonicalFirst`, which becomes `bvhA` / `localDiagonalA` in
`properCrossingQuery`. `localDiagonalA` is `L_canonical`, and it scales **both** tolerance knobs the
crossing term owns (`ProperCrossingQuery.js:114-115`):

```js
const ladder = offsetLadderFactors.map((f) => f * localDiagonalA);
const surfaceEpsilon = surfaceEpsilonFactor * localDiagonalA;
```

Flip the canonical side and four things change at once, all of them inputs to the `boundary` verdict:

1. **the probe ladder** — `_probe = _mid + _dir × delta` with `delta` drawn from
   `offsetLadderFactors × L_canonical`, so every probe point physically moves;
2. **the coplanarity epsilon** — `Math.abs(_nA·_triA.a − _nA·_triB.a) <= surfaceEpsilon`
   (`ProperCrossingQuery.js:180`), so which candidate triangle pairs are discarded as coplanar
   changes;
3. **which solid is probed first** — the callback classifies against `bvhA` and `continue`s on
   `boundary` before ever touching `bvhB` (`:235-247`), so the same ambiguous probe is attributed to
   a different side;
4. **the matrix direction** — `matrixBtoA` vs. its inverse, i.e. different floating-point rounding on
   the probe transform.

(Note what does *not* change: `classifyPoint`'s own surface band is `surfaceEpsilonFactor ×` **that
side's own** `localDiagonal` (`ContainmentQuery.js:51,76`), so it is symmetric under the swap. The
asymmetry is entirely in the four items above.)

A pair sitting at the edge of that band therefore flips between `sawBoundaryProbe = true`
(⇒ `inconclusive-crossing`, ⇒ `crossing-tolerance-ambiguous`, ⇒ `conclusive: false`) and a clean
resolution. The measured `pointClassifications` move with it — 147 ↔ 198, 720 ↔ 864, 780 ↔ 936 —
i.e. the traversal really does do different work, not merely report it differently.

**The correlation test.** For every unstable `inconclusive-crossing` target fragment, over every
session in which the Viewer's geometry ids were captured, the diagnostic's presence was tested
against the sign of `comparePlacedCanonically(source, target)` recomputed from that session's own
ids:

| Session set | Unstable target fragments | Presence is a perfect function of the canonical sign | Exceptions |
|---|---|---|---|
| post-Phase-C | **36** | **36 / 36** | **0** |
| pre-Phase-C (`HEAD`) | **28** | **28 / 28** | **0** |
| pooled | **36** | **36 / 36** | **0** |

Not a correlation coefficient — a **function**, with no counter-example in any session.
Additionally, 4 stable-core pairs also see their canonical sign flip yet keep their diagnostic:
those are pairs that are ambiguous under *both* orientations, which is exactly what the mechanism
predicts for a pair well inside the boundary band rather than at its edge.

### 6.5a The causal intervention — one page load, nothing but the operand order changed

Cross-session correlation, however perfect, is still correlation. So the mechanism was also tested
**causally, inside a single page load**, where no geometry id, matrix, cache or clock can differ:

1. run the production query once, and record which same-model pairs carried a crossing diagnostic;
2. for each of those pairs, pull the two operands' real records straight from the world
   (`world._registry.getOrBuildGeometry(...)` — the same call `resolveGeometryRecord` makes — plus
   the stored `_placementByEpoch` world matrix);
3. call the **already-exported** `properCrossingQuery` twice on those operands: once with the source
   fragment as canonical-first operand `A`, once with the target fragment as `A`, with
   `matrixBtoA = inverse(A.matrix) · B.matrix` each time. **Nothing else differs.**

| Result over the 106 pairs replayed | |
|---|---|
| Replays under the **production** orientation that reproduce the production diagnostic reason | **106 / 106** — the replay is faithful |
| Pairs whose `inconclusive` flag **flips** when the operand order is swapped | **66 / 106** |
| Pairs whose `pointClassifications` differ between the two orders | **106 / 106** |
| Pairs whose `crossing` verdict flips | **0 / 106** |
| Pairs whose `aborted` flag flips | **0 / 106** |

The class-B pair, replayed both ways in the same page:

| Operand order | `candidatePairsExamined` | `crossingPairsExamined` | `pointClassifications` | `crossing` | `inconclusive` | diagnostic |
|---|---|---|---|---|---|---|
| A = source (`L_canonical` = 290.969) | 78 | 11 | **198** | `false` | **`false`** | — |
| A = target (`L_canonical` = 3.918) | 78 | 11 | **147** | `false` | **`true`** | `inconclusive-crossing` |

Identical candidate and crossing-pair counts — the same geometry meeting in the same place — and a
different verdict, produced by a **74:1** difference in the diagonal that scales the probe ladder.
That ratio is the comparator's own documented hazard ("a long duct crossing a short beam, ~700:1",
`CollisionWorld.js:172-173`) arriving through the one term the comment assumed was stable.

**`crossing` flipping 0/106 is a genuine, reportable negative**, and it is why the public pair set
holds still (§4.3). It bounds the observed damage on this fixture without licensing the general
claim: `crossing: true` short-circuits to `overlap: true` ⇒ `excluded`, so a pair that *did* flip
would move `clearanceHardClashExclusions` and could suppress a dbId key from the public `pairs`
array. Nothing structural prevents it; this fixture simply did not produce one in 106 replayed
pairs.

### 6.6 Why only same-model pairs moved here

`loadEpoch` is compared **first**, and epochs are assigned by `admitModel` order, which is fixed
(Architecture, Structure, Mechanical) in every run. A cross-epoch pair's canonical order is
therefore decided before `geometryIndex` is ever read, and is stable. Every crossing diagnostic on
this query happens to be Structure → Structure, i.e. same-epoch, which is why the whole of Effect B
lands there. Note honestly: this fixture produced **no** cross-model crossing diagnostics at all, so
cross-model immunity is a **structural** consequence of the comparator, not an independent
observation from this data.

### 6.7 Cache state — examined only as far as the evidence pointed, and it does not reach

Cold-vs-warm was already answered as far as this harness reaches (§4.1, §6.1): in the archived gate
artifacts a cold world and a warm world inside one page report the identical `inconclusive-crossing`
count in 20 of 20 runs. "Fresh world" is likewise not the variable — every repetition in every session used a
brand-new `CollisionWorld` with its own `GeometryRegistry`/`BlasCache`/`TlasCache`, and repetitions
inside a page still agree. The dependence is on the **page load**, i.e. on the Viewer's geometry-id
assignment, not on any collision-library cache. No further cache investigation was warranted and
none was done.

### 6.8 One further exposure this mechanism structurally implies (not observed here)

`comparePlacedCanonically` is also the final tie-break in `compareWitnessCandidates`
(`CollisionWorld.js:238-249`) and `compareClearanceCandidates` (`:255-262`), whose stated purpose is
that "the winner never depends on which fragment pair the broad phase happened to visit first." With
a page-load-dependent `geometryIndex`, that tie-break is page-load-dependent too: when two
fragment-pair candidates collapse onto one dbId key with equal distance (clearance) or equal witness
rank (volume-overlap), **which fragment pair's witness/provenance is published can change between
page loads.** This investigation did not capture witness payloads, so this is recorded as a
structurally reachable consequence, **not** as an observation. It should be checked before any fix
is designed, because it widens the blast radius beyond the crossing term.

---

## 7. Step 5 — M4 impact

### Disposition: `SEMANTIC_PRECHECK_NONDETERMINISM`

The required statements:

**1. Should §6.4 remain strict? — YES. Unchanged, un-relaxed, and it must not be widened.**
Effect B is not diagnostic-only: a precheck disposition changes (§5.1), and with it `conclusive`,
the `clearance-hard-clash-precheck-inconclusive` diagnostic set, and the **§6.4-compared statistic**
`clearanceDistanceQueriesRun` (129 ↔ 130 across page loads; `STATISTICS_FIELDS`,
`correctness-comparator.mjs:28`). The existing `TIME_BUDGET_DIAGNOSTIC_DIVERGENCE` carve-out is
**irrelevant** to it in both directions: the carve-out excuses a *wall-clock* divergence, and Effect B
reproduces unchanged on a build with no wall clock in the semantic path at all. Widening the
carve-out to cover Effect B would excuse a semantic change on the strength of a timing rationale
that provably does not apply.

**2. May Phase C focused validation proceed? — YES, with one caveat, and with one claim this
document explicitly does *not* make.**
Effect B is orthogonal to Phase C: it neither blocks Phase C nor is fixed by it, so Phase C's focused
validation is not held up by this finding. **This investigation is not evidence that Phase C removes
Effect A** — its harness runs a sacrificial warm-up and then only fresh-`CollisionWorld` (BLAS-cold,
engine-warm) runs, so it never reproduces the gate's own cold arm, which is where Effect A lives;
`crossing-budget-exhausted` read a flat 11 on **both** builds here for that reason. Effect A's
removal has to be demonstrated by Phase C's own validation, against a real cold arm.
**Caveat:** any Phase C validation that compares a *post-fix run against a pre-fix run taken in a
different browser session* will see Effect B's ±36-entry swing on top of Phase C's own delta.
Phase C validation must therefore compare **within one page load** — either two arms of the same
load, or a controlled replay that pins the operands, matrices and canonical ordering explicitly.
**Comparing only the empirically "stable core" of pairs is not an acceptable substitute** (an earlier
draft of this section suggested it; an independent review correctly rejected it). A core observed
stable over 17 loads is an observation, not a contract: it is not guaranteed to hold on the next
load, and excluding the load-dependent pairs would let a genuine Phase C regression on one of them
pass unnoticed — which is precisely the leniency §6.4 exists to refuse. Where no same-load comparison
is possible, cross-build diagnostic parity must be recorded as **UNMEASURED**, not approximated.

**3. Do M2/M3/full canonical reruns remain blocked? — YES.**
Not because the arms disagree on Effect B — they do not. The M4 gate opens exactly one browser and one
page per runtime tier and loads the fixture once (`run-gate-m4.mjs:2934`, `:2936`, `:2945`), with the
case / variant / repetition / **arm** loops all nested inside it (`:3017`, `:3055`), so the two §6.4
arms always share one geometry-id assignment; and TLAS and linear reported the identical `inconclusive-crossing` count
in 20/20 archived gate runs and the identical `inconclusive-crossing` *identity set* in 7/7 v1
sessions. (Effect A remains a separate, already-documented source of arm divergence.) They remain blocked because the canonical matrix is **not reproducible across page loads**:
a §6.4-compared statistic and the diagnostic multiset both move between fixture loads, so a passing
matrix is not evidence that a re-run will pass, and two runs of the same tuple on two days are not
comparable. Two specific hazards to record:
   - `run-gate-m4.mjs:3144`'s `attributionPoisoned` recovery path calls `page.reload()` +
     `loadFixtureAndReconfirm()` **mid-run**, which re-assigns every geometry id. Tuples measured
     before and after that rebuild are drawn from different canonical orderings.
   - Each runtime tier launches its own browser (`run-gate-m4.mjs:2934`), so the two tiers are
     already two different assignments; any cross-tier comparison of these statistics is unsound.

**4. Is a fix required before M4 can continue? — YES.**
Same class of defect as the Effect A blocker and the same disposition:
`FIX_REQUIRED_BEFORE_M4_CAN_CONTINUE`. A correctness-bearing verdict must not depend on a
non-semantic, load-order-assigned Viewer identifier. The defect is in
`comparePlacedCanonically`'s choice of key, not in the crossing term. This document deliberately
stops at naming it: the fix — whether `geometryIndex` is replaced by a content-derived key, dropped
in favour of the already-stable `(loadEpoch, fragmentId)`, or the canonical choice is made
geometry-derived (e.g. by `localDiagonal`, with a stable tie-break) — is a design decision for the
milestone owner, and it has to be weighed against the very reason `geometryIndex` is in the key at
all ("so that two fragments sharing one geometry sort together", `CollisionWorld.js:178-179`), and
against §6.8's witness/candidate tie-break surface.

**5. Is the existing timing-diagnostic carve-out relevant? — NO.**
Covered in (1). It neither reaches Effect B nor should be extended to.

### What does *not* change

The observed incident did **not** change the public pair set, the clearance pair set, the distances,
`clearanceHardClashExclusions`, `clearanceHits`, or any other §6.4 statistic besides
`clearanceDistanceQueriesRun`, and the direct intervention found **0 / 106** pairs whose `crossing`
verdict flips under the swap (§6.5a). That is recorded honestly and is not to be read as "harmless":
the mechanism is structurally capable of changing the overlap verdict itself (a crossing proven under
one ladder scale and not the other ⇒ `overlap: true` ⇒ `excluded` ⇒
`clearanceHardClashExclusions` moves ⇒ a dbId key suppressed from the public `pairs` array via
`CollisionWorld.js:1808-1811`). It simply did not do so on this fixture, in 17 loads or in 106
forced-swap replays.

---

## 8. Relationship to Effect A

| | **Effect A** (the earlier blocker) | **Effect B** (this document) |
|---|---|---|
| Trigger | wall-clock budget inside `properCrossingQuery` | `geometryIndex` permuted per page load |
| Varies between | two executions on the same page, cold vs warm, run to run | **only** between page loads |
| Diagnostic touched | `crossing-budget-exhausted` | `inconclusive-crossing` / `crossing-tolerance-ambiguous` |
| Removed by Phase C | **yes**, by construction (both semantic clauses deleted) — not re-measured here, see §7.2 | **no** (reproduces identically pre- and post-C) |
| Class | semantic precheck nondeterminism | semantic precheck nondeterminism |

They are two independent defects with the same consequence. Fixing one does not fix the other, and
the §6.4 carve-out written for the first does not describe the second.

---

## 9. Limitations, declared

1. **`clearanceHardClashExclusions` cannot attribute a fragment pair.** It is a deduplicated
   dbId-key count (`CollisionWorld.js:1786-1805`), so "which pair contributes" is answered here via
   the precheck status (`excluded` is the only contributing status), not from the statistic.
2. **Candidate index/order was not captured.** No landed diagnostic-event seam carries it, and
   adding one is instrumentation. Order dependence is falsified in §6.2 by a stronger argument
   (four different orders agreeing inside one page).
3. **Witness payloads were not compared**, so §6.8's tie-break exposure is structural only.
4. **Class E pairs.** 20 of the 56 unstable pairs were observed under only one canonical
   orientation during the clearance replays and are therefore left unclassified rather than assumed
   benign.
5. **Single machine, single Chromium build** (`151.0.7922.34`, darwin arm64), single fixture,
   single source dbId. The mechanism is code-level and fixture-independent, but the *rate* at which
   the permutation changes anything is fixture-specific.
6. **Why `geometryId` is re-assigned was not investigated.** It is the Viewer's own loader-side
   numbering, outside this repository; establishing that it *is* re-assigned (490/543) while the
   geometry content is not (0/543) was sufficient, and chasing the Viewer-internal cause would have
   broadened the investigation past what the pair evidence requires.
7. **The "20-run pre-fix baseline" was re-derived from the archived artifacts**, not re-executed —
   re-executing it would have meant running the M2 gate, which the prompt forbids. The independent
   pre-fix reproduction (Q series) uses the harness, not the gate.
8. **No committed regression test exists for this yet, and one should.** The mechanism is fully
   testable **without a live Viewer**: take two fixed operands with sharply different
   `localDiagonal`s, hold geometry and matrices constant, and call `volumeOverlapQuery` twice with
   `compareCanonical` returning opposite signs — the public option the library already threads
   (`VolumeOverlapQuery`'s `options.compareCanonical`). Today that asserts the defect reproduces;
   after a fix it should assert the semantic result is **identical** under both signs. That test is
   the durable artifact this investigation's scratchpad data is not.
9. **The raw per-session JSON is not retained in the repository** (§3.4). The numbers here are not
   independently re-derivable from a tracked artifact until that is addressed or item 8 lands.

---

## 10. Reproducing this

1. `node server.js` (port 8080) against the working tree; optionally
   `git archive HEAD | tar -x -C <tmp>` + symlinked `node_modules`/`.env`/`wwwroot/vendor`, served
   on port 8081, for the pre-fix build.
2. Load the fixture exactly as `run-gate-m2.mjs:116-134` does, then run
   `findClashes({mode:'volume-overlap', source:{model: Structure, dbIds:[3076]}, target:{targets: all three models}, groupBy:'dbId'})`.
3. Keep the **whole** `result.statistics.diagnostics` array, not a 20-entry sample.
4. Repeat inside the page (expect byte-identical results) **and** in a fresh browser/page (expect the
   `inconclusive-crossing` identity set to move).
5. For each session also record `fragList.getGeometryId(fragId)` for both operands of each affected
   pair, and check the sign of `(geometryId, fragmentId)` lexicographic order. The diagnostic's
   presence is a function of that sign.
6. **The cheapest decisive step, and the one that needs no repetition at all:** in a *single* page
   load, pull each affected pair's records via `world._registry.getOrBuildGeometry(...)` plus
   `world._placementByEpoch`, then call the exported `properCrossingQuery` twice — once with the
   source fragment as operand `A`, once with the target — and compare `inconclusive`. 66 of 106 pairs
   flip (§6.5a).

### 10.1 What a durable regression should assert

Not a count. Two fixed operands with sharply different `localDiagonal`s, held constant, run through
`volumeOverlapQuery` with `compareCanonical` returning `+1` and then `−1`: today the two runs differ;
after a fix they must agree on `overlap`, `conclusive`, `inconclusiveCauses` and the emitted
diagnostic reason. No Viewer, no network, no fixture — it belongs in the ordinary `node --test`
suite.
