# Fix Design — `ProperCrossingQuery` Wall-Clock Correctness Nondeterminism

**Type:** fix design. **No code was written, no code was changed, nothing was committed.**
**Prompt:** `docs/prompts/proper-crossing-query-deterministic-budget-fix-design-prompt.md`
**Investigation this design answers:** `docs/research/m4-hard-clash-precheck-parity-blocker-investigation.md` (§8.1's six open decisions)
**Date:** 2026-09-11

**Constraints honored, stated up front so they can be checked rather than assumed:**

- No implementation. No M4 Phase 4 work. Phase 4 remains blocked.
- §6.4 of the M4 design spec is **not** relaxed, **not** widened, and **not** edited. Its named
  `TIME_BUDGET_DIAGNOSTIC_DIVERGENCE` carve-out is left textually unchanged (§9.4 below explains why
  it becomes vacuous rather than needing amendment).
- The M4 verdict reducer is untouched.
- `ProperCrossingQuery` is **not** workerized, and no resumable traversal is proposed — §3 proves
  resumability is unnecessary rather than merely asserting it.
- `frameBudgetMs` is not retuned.

---

## 0. The defect in one sentence, and the shape of the fix

`properCrossingQuery` lets a wall-clock deadline set `aborted`, and `aborted` forces the geometric
verdict to `false` (`ProperCrossingQuery.js:166`, `const finalCrossing = aborted ? false : crossing;`),
so a genuinely-proven crossing is suppressed whenever the machine happens to be slow at that instant —
making a correctness-bearing verdict a function of machine speed rather than geometry.

The fix removes the wall clock from the *semantic* path entirely and lets the already-existing
deterministic operation-count budgets be the sole terminators, adding one further deterministic
counter over the traversal's dominant cost driver. The 8 ms concept survives only as a
telemetry-observable flag on an already-emitted, opt-in diagnostic event.

---

## 1. The current algorithm, traced against current source

### 1.1 Call chain

```
CollisionWorld._runClearanceNarrowPhasePair  (CollisionWorld.js:2408-2445)
  └─ createComposedStageScheduler(checkpoint, this._now)          CollisionWorld.js:433-445
  └─ classifyHardClashPrecheck(src, tgt, srcBounds, tgtBounds, opts)
       ClearanceHardClashPrecheck.js:17-49
       └─ aabbMinDistance > 0 ? {status:'skip-precheck'} : ...
       └─ volumeOverlapQuery(source, target, opts)                VolumeOverlapQuery.js:48-347
            ├─ properCrossingQuery(...)                           VolumeOverlapQuery.js:120-123   ← the defect
            ├─ await scheduler.checkpointIfDue()                  VolumeOverlapQuery.js:171
            ├─ anyComponentInside(A in B)                         VolumeOverlapQuery.js:175-191
            ├─ await scheduler.checkpointIfDue()                  VolumeOverlapQuery.js:222
            └─ anyComponentInside(B in A)                         VolumeOverlapQuery.js:226-240
       └─ overlap===true → {status:'excluded'}                    ClearanceHardClashPrecheck.js:40-42
       └─ !conclusive     → {status:'inconclusive'}               ClearanceHardClashPrecheck.js:45-47
       └─ otherwise       → {status:'proceed'}
  └─ 'excluded'      → outcome 'hard-clash-excluded' → hardClashExcludedKeys.add(key)  CollisionWorld.js:1787-1790
                       → statistics.clearanceHardClashExclusions += size               CollisionWorld.js:1805
                       → and suppresses that dbId key from the public `pairs` array    CollisionWorld.js:1808-1811
  └─ 'inconclusive'  → public pair-scoped diagnostic `clearance-hard-clash-precheck-inconclusive`
```

The **second, pre-existing** caller of the same shared query is
`CollisionWorld._runNarrowPhasePair`'s `mode: 'volume-overlap'` branch
(`CollisionWorld.js:2274-2277`), which carries the same exposure. It is a declared **Protected
Invariant** (`CollisionWorld.js:2430-2432`). See §7.

### 1.2 Wall-clock check locations (exactly two, both semantic today)

| # | Site | Code | Effect |
|---|---|---|---|
| 1 | `ProperCrossingQuery.js:84` | `if (candidatePairsExamined > candidateBudget \|\| now() - traversalStart > timeBudgetMs) { aborted = true; return true; }` | callback-entry abort; **one clock read per candidate pair**, up to 50,000 reads |
| 2 | `ProperCrossingQuery.js:131` | `if (now() - traversalStart > timeBudgetMs) { aborted = true; return true; }` | probe-loop abort, checked before **every individual probe** (round-11 fix) |

`traversalStart = now()` at `:46`; `timeBudgetMs = options.frameBudgetMs ?? frameBudgetMs` (`:39`,
default 8); `now = options.now ?? (() => performance.now())` (`:40`). `frameBudgetMs` is **never**
overridden by any production caller — only by tests. `options.now` **is** overridden in production by
the clearance path (`CollisionWorld.js:2433`, `crossing: { now: this._now }`), where `this._now`
defaults to real `performance.now`.

### 1.3 `aborted` propagation

- `ProperCrossingQuery.js:166` — `finalCrossing = aborted ? false : crossing`. **This is the
  suppression.** A crossing already proven earlier in the same traversal cannot reach this line
  (proving it returns `true` from the callback at `:149` and no later abort can fire), but a crossing
  that *would* have been proven by a not-yet-executed probe is silently converted into "not a
  crossing".
- `ProperCrossingQuery.js:167` — `inconclusive = !aborted && !finalCrossing && sawBoundaryProbe`.
  `aborted` **masks** `inconclusive`; the two are mutually exclusive by construction.
- `ProperCrossingQuery.js:170-171` — `aborted` ⇒ `{reason:'crossing-budget-exhausted'}`, else
  `inconclusive` ⇒ `{reason:'inconclusive-crossing'}`.
- `VolumeOverlapQuery.js:296` — `crossingConclusive = !(crossing.aborted || crossing.inconclusive)`.
- `VolumeOverlapQuery.js:301` — `conclusive = crossingConclusive && containmentConclusive && !tainted`.
- `VolumeOverlapQuery.js:329` — `if (crossing.aborted) inconclusiveCauses.add('crossing-budget-exhausted')`.
- `ClearanceHardClashPrecheck.js:45` — `if (!overlapResult.conclusive) return {status:'inconclusive'}`.

### 1.4 Short-circuit, negative representation, scratch state, persistence

- **Crossing success short-circuits** at `ProperCrossingQuery.js:145-149`: the first probe classifying
  `inside` in both operands sets `crossing = true`, clones `_probe` into `witnessPoint`, and returns
  `true` to terminate `bvhcast`.
- **"No crossing"** is `{crossing:false, aborted:false, inconclusive:false, diagnostics:[]}` — a clean
  negative, distinguished from the two *diagnosed* negatives (`aborted`, `inconclusive`).
- **Scratch state** is nine module-level THREE objects (`ProperCrossingQuery.js:18-26`). The function
  contains **no `await`**, so two traversals can never interleave; `_line` staleness is explicitly
  guarded at `:110`; `_probe` is `.clone()`d before escaping at `:147`. No state persists across calls
  in a way that can affect a verdict — the investigation ruled this whole class out independently
  (report §5), and the frozen-clock intervention (report §3.3) rules it out again.
- **`bvhcast` is synchronous and non-resumable.** Returning truthy from `intersectsTriangles`
  *terminates* the cast; it does not suspend it. There is no continuation token in the pinned
  `three-mesh-bvh@0.9.14`. This fact is load-bearing for Decision 2.

### 1.5 Counters already available

| Counter | Cap | Constant | Deterministic? |
|---|---|---|---|
| `candidatePairsExamined` (`:81`) | 50,000 | `maxCandidatePairsExamined` | **Yes** |
| `crossingPairsExamined` (`:112`) | 64 | `maxCrossingPairsExamined` | **Yes** |
| wall clock (`:84`, `:131`) | 8 ms | `frameBudgetMs` | **No — the defect** |

There is **no counter over `classifyPoint` calls**, which is the traversal's dominant cost.

### 1.6 Current diagnostics surface

`properCrossingQuery` returns `diagnostics: [{reason}]` — at most one entry, either
`crossing-budget-exhausted` or `inconclusive-crossing`. `VolumeOverlapQuery` deliberately withholds
them from every positive path and merges them only on the final negative (`:280`). On the
**clearance** path they are then **discarded entirely** by `classifyHardClashPrecheck.js:45-47`, which
emits only the generic `clearance-hard-clash-precheck-inconclusive`. On the **volume-overlap** path
they are attached verbatim (`CollisionWorld.js:2288`, `attach(result.diagnostics)`) and therefore
reach `statistics.diagnostics`, which §6.4 compares.

**Neither `properCrossingQuery` nor `volumeOverlapQuery` is exported from `collision/index.js`** —
the public surface is `CollisionWorld` plus the error classes. `stats` never reaches a public
result: `_runNarrowPhasePair` returns only `{hit, witness}`, and the clearance precheck returns only a
status. This bounds the blast radius of every result-shape change proposed below.

---

## 2. Decision 1 — Normative semantic rule

### 2.1 The rule (adopted)

> **Wall-clock elapsed time must never directly determine the geometric semantic result of
> `properCrossingQuery`, nor of any predicate composed from it.**

Source evidence does not merely permit this; it makes it achievable with a *net reduction* in code:
§1.5 shows two deterministic budgets already terminate the traversal, so deleting the wall-clock
branches leaves a finite algorithm rather than an unbounded one.

A wall-clock threshold may produce **only**: `stats.timeBudgetExceeded`, `stats.elapsedMs`, and
whatever an opt-in diagnostic-event recorder chooses to do with them. It must never cause `aborted`,
`inconclusive`, `conclusive:false`, crossing suppression, containment suppression, or a changed
Hard-Clash exclusion decision.

### 2.2 The normative truth table

`WC` = the 8 ms wall-clock threshold was crossed at some point during the traversal.
`Cls` = **semantic** (affects the verdict) or **telemetry** (does not).

| # | Condition | `crossing` | `aborted` | `inconclusive` | `witnessPoint` | `diagnostics` | `stats.exhaustedBudget` | `stats.timeBudgetExceeded` | Cls |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Crossing proven (a probe classifies `inside` in **both** operands) | `true` | `false` | `false` | owned clone | `[]` | `null` | `WC` | **semantic** |
| 2 | Traversal ran to completion; no crossing; no boundary probe seen | `false` | `false` | `false` | `undefined` | `[]` | `null` | `WC` | **semantic** |
| 3 | Traversal ran to completion; no crossing; ≥1 boundary probe seen | `false` | `false` | `true` | `undefined` | `[{reason:'inconclusive-crossing'}]` | `null` | `WC` | **semantic** |
| 4 | **Deterministic bound exhausted** before the traversal could conclude | `false` | `true` | `false` | `undefined` | `[{reason:'crossing-budget-exhausted'}]` | `'candidate-pairs'` \| `'crossing-pairs'` \| `'point-classifications'` | `WC` | **semantic** |
| 5 | Wall-clock threshold crossed **before** completion | *(no effect — row 1–4 decide)* | *(no effect)* | *(no effect)* | *(no effect)* | *(no effect)* | *(no effect)* | `true` | **telemetry** |
| 6 | Wall-clock threshold crossed **and crossing later proven** | `true` | `false` | `false` | owned clone | `[]` | `null` | `true` | **telemetry** — *this is exactly the real failing pair* |
| 7 | Unsupported geometry (`aspectRatioExceeded` on either operand) | `false` | `false` | `true` (`skipped:true`) | `undefined` | `[{reason:'geometry-aspect-ratio-exceeds-tolerance-model', role}]` | n/a — query never called | n/a | **semantic**, unchanged |
| 8 | Callback threw (including a falsy throw) | *no result* — rethrown after `bvhcast` returns, `ProperCrossingQuery.js:162` | | | | | | | unchanged |

**Rows 1–4 and 7–8 are the complete semantic partition and are mutually exclusive.** Rows 5 and 6 add
no new semantic cell: they are annotations that may co-occur with any of rows 1–4.

**What is semantic:** the three deterministic caps of §4, `sawBoundaryProbe`, and the geometric probe
classifications. **What is telemetry-only:** `stats.elapsedMs`, `stats.timeBudgetExceeded`, and every
`reportDiagnosticEvent` payload.

### 2.3 The determinism claim, and its preconditions

With the wall clock removed, `properCrossingQuery` is a **pure function** of
`(bvhA, bvhB, matrixBtoA, localDiagonalA, localDiagonalB, budgets)`. Enumerating every candidate
nondeterminism source and its disposition:

| Source | Disposition |
|---|---|
| Wall clock | **Removed from the semantic path** — this fix |
| `bvhcast` traversal order | Deterministic given two BVHs and a matrix; independent of *how* the pair was produced, therefore identical in the TLAS and linear arms (this is why deterministic exhaustion cannot reintroduce arm divergence) |
| BVH build | Byte-identical for identical input under the pinned `three-mesh-bvh@0.9.14`; M4 §6.4's geometry-preparation criterion already asserts this |
| `MeshBVH.raycast` hit order | Not guaranteed, but `ContainmentQuery.js:101` sorts distances before parity counting |
| Module-level scratch | No `await` in the traversal ⇒ no interleaving (§1.4) |
| `Map` iteration in `anyComponentInside` | Insertion order, deterministic |
| Floating-point arithmetic | Same operations in the same order ⇒ bit-identical |
| GC / JIT / browser scheduling | Affect only `elapsedMs`, which is telemetry after this fix |

The one precondition this design does **not** own: operand identity. If two arms hand the query
different `matrixBtoA` or different BVHs, results may legitimately differ. The investigation closed
that alternative empirically (report §3.2: byte-equal 1319-candidate identity multiset in both arms).

---

## 3. Decision 2 — Continuation architecture

**Adopted: (a) synchronous deterministic traversal. No resumable traversal. No worker. No new
continuation mechanism of any kind.**

### 3.1 Proof that resumability is not strictly necessary

Decision 2's escape hatch is "only propose resumable traversal if the current algorithm cannot support
a deterministic finite work bound without it." It can:

1. Every path through the callback increments `candidatePairsExamined` **before** any other work
   (`:81`), and the cap at `:84` terminates the cast. So callback invocations ≤ 50,000, unconditionally.
2. Every confirmed intersecting pair increments `crossingPairsExamined` (`:112`) and the cap at `:113`
   terminates the cast. So pairs entering the probe ladder ≤ 64.
3. The probe ladder is a fixed `2 × 2 × 3` nest (`:120-126`) with at most two `classifyPoint` calls per
   rung (`:138`, `:143`). So `classifyPoint` calls ≤ **64 × 24 = 1,536**, structurally, today, with no
   new code at all.
4. Each `classifyPoint` is itself finite: one `closestPointToPoint` plus at most three `raycast`s over
   a triangle set bounded by the shipped `maxSyncTriangleCount = 12,000` geometry ceiling
   (`collision/geometry/createGeometryRegistry.js:100`).

Therefore the algorithm **already terminates deterministically** once the clock is removed. Resumable
traversal would buy only *preemptibility*, not correctness — and the prompt's default constraint
forbids introducing it for correctness. It is not proposed.

### 3.2 What still owns responsiveness

Unchanged and untouched:

- `VolumeOverlapQuery.js:171` and `:222` — the between-stage checkpoints, both **after** the crossing
  term returns.
- `createComposedStageScheduler` (`CollisionWorld.js:433-445`) — resets its `sinceMs` baseline on a
  real yield, so a longer crossing span simply makes the *next* checkpoint due. That is correct
  cooperative behavior, not a bug, and needs no change.
- The per-`findClashes` frame-budget accumulator (`scheduler.js:96-108`).

The crossing traversal is, and after this fix remains, **one atomic non-preemptible unit**. It is
already documented as such: the M4 spec's own §8 note reads *"Today's abort granularity is already one
atomic unit, so a worker is parity, not regression."* This fix makes that unit *larger* and *honest*,
which is precisely the input M4 exists to measure.

### 3.3 Rejected alternatives, with reasons

| Alternative | Rejected because |
|---|---|
| Fork/replace vendored `bvhcast` with a resumable cast | Not necessary (§3.1); adds a second vendor patch surface on top of the `three-mesh-bvh@0.9.14` patch set just landed; large regression surface for zero correctness gain |
| Move `properCrossingQuery` to a worker | Explicitly forbidden by the prompt; would also *pre-decide* the very question M4 is measuring, converting evidence into assumption |
| Keep the wall clock but re-run deterministically on abort | Doubles worst-case cost and still lets timing decide *whether* the second run happens |
| Raise `frameBudgetMs` for the crossing term only | The investigation showed borderline pairs sit *at* the threshold; any retune merely relocates the cliff (report §8) |

---

## 4. Decision 3 — The deterministic replacement budget

### 4.1 Choosing the work unit

The traversal has three cost tiers, measured in the source:

| Tier | Work | Unit cost | Currently counted? |
|---|---|---|---|
| A | `bvhcast` node-pair descent between callbacks | small, amortized | No (not directly countable from the callback) |
| B | Candidate triangle-pair test: 2 `ExtendedTriangle.copy` + 2 `getNormal` + coplanarity test + `intersectsTriangle` | **~0.3 µs/pair** (the code's own figure, `:82-83`) | Yes — `candidatePairsExamined` |
| C | Probe classification: `classifyPoint` = 1 `closestPointToPoint` + up to 3 full `DoubleSide` `raycast`s + a sort | **the dominant cost, unmeasured** | **No** |

Tier C is the right work unit. `classifyPoint` invocations satisfy every criterion Decision 3 sets:

| Criterion | Satisfied? |
|---|---|
| Deterministic for identical inputs | Yes — the ladder is a fixed nest over deterministic geometry |
| Monotonically related to work | Yes — it *is* the dominant work; every increment is one BVH-query-plus-raycasts |
| Cheap to count | Yes — one integer increment adjacent to a call already costing microseconds |
| Independent of machine/runtime timing | Yes — no clock is read |
| Reset at the correct semantic scope | Per traversal, at function entry, same scope as the two existing counters |
| Usable in tests without a fake clock | Yes — a synthetic fixture reaches a chosen count reproducibly; **this is the property the existing frozen-clock clearance tests could never have** (report §9) |
| Bounds pathological inputs | Yes, when capped; the structural implied bound today is 1,536 |

Tier A remains uncounted. That is a stated, bounded residual: node descent only reaches leaves that
produce counted callbacks, so its cost is `O(counted work × BVH depth)` with depth bounded by the
12,000-triangle geometry ceiling. The calibration task of §14 measures **total elapsed span**, not
just counts, precisely so this residual is captured empirically rather than argued away.

### 4.2 The counter set (three counters, each with a distinct correctness purpose)

Decision 3 prefers one global budget if one can safely cover all crossing work. One cannot, honestly:
tiers B and C differ in unit cost by roughly two orders of magnitude, so a single counter would
require **weights** — and a weight is exactly the kind of arbitrary unmeasured number Decision 3
forbids. A single weighted `workUnits` counter was considered and **rejected** on that ground, and
because it would erase the distinct *semantic* meaning each cap carries (how broad a scan we are
willing to do vs. how deep a search we are willing to run). Three counters it is, each defined below.

| | 1. `candidatePairsExamined` | 2. `crossingPairsExamined` | 3. `pointClassifications` **(new)** |
|---|---|---|---|
| **Unit** | one `intersectsTriangles` callback entry | one confirmed non-coplanar intersecting triangle pair entering the probe ladder | one `classifyPoint` invocation made by this traversal |
| **Correctness purpose** | bounds tier-B scan breadth | bounds *search breadth* — how many contact features we are willing to probe | bounds tier-C probe cost, the actual span driver |
| **Increment site** | `ProperCrossingQuery.js:81`, unchanged | `:112`, unchanged | immediately before **each** of `:138` (`inA`) and `:143` (`inB`) |
| **Reset point** | function entry (`:54`) | function entry (`:55`) | function entry, alongside the other two |
| **Cap constant** | `maxCandidatePairsExamined` | `maxCrossingPairsExamined` | `maxCrossingPointClassifications` **(new)** |
| **Cap value** | 50,000 (existing; **unchanged by this fix** — see §4.5) | 64 (existing; unchanged) | **1,536 — the structural maximum, non-binding by construction** (§4.3) |
| **Overflow behavior** | `aborted = true`; `stats.exhaustedBudget = 'candidate-pairs'`; `return true` (the existing abort protocol, which lets `bvhcast` reach its normal-completion path and clear `_active`) | same, with `'crossing-pairs'` | same, with `'point-classifications'`; checked **before** the `classifyPoint` call so the cap is never exceeded |
| **Max value** | cap + 1 (the check is strict `>` after the increment) | cap + 1 | cap (checked before increment-and-call) |
| **Reporting** | `stats.candidatePairsExamined` | `stats.crossingPairsExamined` | `stats.pointClassifications` |
| **Test seam** | `options.maxCandidatePairsExamined` (existing) | `options.maxCrossingPairsExamined` (existing) | `options.maxCrossingPointClassifications` (new, same convention) |

`stats.exhaustedBudget` is a single scalar, not a set: the first cap reached terminates the cast, so
exactly one is attributable. It is `null` on every non-aborted row.

### 4.3 The cap is the structural maximum, and is non-binding by construction

**Adopted: `maxCrossingPointClassifications = 1536`, exactly the structural maximum
`maxCrossingPairsExamined × 24` that §3.1 step 3 derives. It can therefore never censor any traversal
that today's code would have completed.**

*(This supersedes an earlier draft of this section, which left the value to calibration and permitted
a lower one. An independent architecture review — §16, Critical finding 1 — showed that a cap below
1,536 would reduce geometric search completeness for inputs the shipped algorithm supports today, and
would directly contradict this design's own "completeness strictly improves" compatibility claim. The
review's finding is accepted in full.)*

The governing principle, stated so it cannot be eroded later:

> **A correctness fix for nondeterminism must not, in the same change, narrow the geometric search
> envelope.** This fix's entire purpose is to stop trading correctness for time. Introducing a
> tighter probe budget in the same breath would be that same trade, merely made deterministic.

Counter 3 is nevertheless required, for three reasons that survive the cap being non-binding:

1. **It is a defensive terminator whose invariance is asserted rather than assumed.** The 1,536 bound
   is an *emergent* property of a nested loop today, invisible at any single site and silently broken
   by anyone adding a rung to `offsetLadderFactors` or a quadrant to the sign loops. As an explicit
   cap, it becomes a checked contract.
2. **It is the deterministic test seam for matrix items D3 and H.** Constructing geometry that
   reproducibly exhausts a *pair* budget is awkward; exhausting a *classification* budget via
   `options.maxCrossingPointClassifications` is exact and needs no clock.
3. **It is the measurement unit calibration needs** (§14), and the unit any *future* span-motivated
   retune would have to be argued in.

**Any value below 1,536 is out of scope for this fix.** If a later measurement shows span requires
one, that is a separate change: an explicit, classified reduction in search completeness, needing its
own acceptance criteria, its own compatibility classification, and its own approval. It must not be
folded into the nondeterminism bug fix, and this design does not authorize it.

### 4.4 What this means for calibration

Because the probe cap is fixed by construction, **no number in the semantic path awaits measurement.**
`maxCandidatePairsExamined` and `maxCrossingPairsExamined` keep their shipped, already-pre-registered
values; `maxCrossingPointClassifications` is derived arithmetically from one of them. "8 ms" is not
reused as an operation-count equivalent anywhere.

What still requires measurement is not a *cap* but an *envelope*: the real worst-case synchronous span
of a traversal that is no longer cut short at 8 ms. That is a responsiveness question, not a semantics
question, and §14 defines it as such. It is what this document's readiness statement reflects.

### 4.5 `maxCandidatePairsExamined` stays at 50,000

An earlier draft proposed re-registering it, on the reasoning that its value was chosen while the wall
clock backstopped it. That is dropped, for the same reason as §4.3: **lowering it would reduce the
candidate scan envelope**, which is a search-completeness reduction dressed as a span fix. It stays at
50,000 in this change.

Its span contribution is instead **measured and reported** by §14. If the measured envelope proves
unacceptable, the response is a milestone-owner decision among named options (accept the span; move
the traversal off the main thread — which is exactly what M4 exists to decide; or explicitly reduce
the envelope as a classified completeness change), never a quiet retune inside this fix.

---

## 5. Decision 4 — The return/result contract

### 5.1 Semantics after the fix

- **`aborted` means, and means only: a deterministic semantic work budget was exhausted before the
  query could conclude.** It is reproducible, attributable to one named budget, and identical across
  runs and arms for identical operands.
- **A wall-clock threshold breach never sets `aborted`.** It is telemetry.
- **`conclusive`** (computed one level up, `VolumeOverlapQuery.js:296-301`) reflects geometric and
  deterministic-budget completion only. Its formula is **unchanged** — it becomes correct for free,
  because its `crossing.aborted` input is now deterministic.

### 5.2 Exact result shape

```js
{
  crossing:      boolean,   // unchanged
  aborted:       boolean,   // MEANING NARROWED: deterministic budget exhaustion only
  inconclusive:  boolean,   // unchanged
  diagnostics:   [{ reason: 'crossing-budget-exhausted' | 'inconclusive-crossing' }],  // unchanged shape and strings
  witnessPoint:  THREE.Vector3 | undefined,  // unchanged
  stats: {
    candidatePairsExamined: number,   // unchanged
    crossingPairsExamined:  number,   // unchanged
    pointClassifications:   number,   // NEW — semantic counter
    exhaustedBudget: null | 'candidate-pairs' | 'crossing-pairs' | 'point-classifications',  // NEW — semantic attribution
    elapsedMs:      number | null,    // NEW — TELEMETRY ONLY; null when unmeasurable (§9.3)
    timeBudgetExceeded:     boolean,  // NEW — TELEMETRY ONLY, === (elapsedMs > timeBudgetMs); false when elapsedMs is null
  },
}
```

`stats` is **additive**: every existing field keeps its name, type, and meaning.

### 5.2a One normalized `stats` shape, on every path — including the skip path

*(Added per §16, High finding 3.)* `VolumeOverlapQuery.js:110-117`'s aspect-ratio skip branch
synthesizes a crossing result **without calling the query**, and today populates only
`{candidatePairsExamined: 0, crossingPairsExamined: 0}`. If §5.4's telemetry read were added naively,
an instrumented aspect-ratio-gated pair would emit four `undefined` fields, which downstream
aggregation can read as a missing record, `NaN`, or schema corruption.

**Required:** a single shared normalizer — one small exported-for-reuse factory (or a frozen default
object spread at both sites) — is the only way either path constructs `stats`, so the two can never
drift. The skip path's values are specified explicitly, not left to defaults:

| Field | Real traversal | Aspect-ratio skip (query never called) |
|---|---|---|
| `candidatePairsExamined` | measured | `0` |
| `crossingPairsExamined` | measured | `0` |
| `pointClassifications` | measured | `0` |
| `exhaustedBudget` | `null` or the cap name | `null` |
| `elapsedMs` | measured, or `null` (§9.3) | **`null`** — not `0`; the traversal did not take zero time, it did not happen |
| `timeBudgetExceeded` | derived | `false` |

`elapsedMs: null` rather than `0` is deliberate: a fabricated zero-duration measurement would pollute
any span distribution computed over these events. Consumers must treat `null` as *not measured*.
The skip case remains independently identifiable by its `geometry-aspect-ratio-exceeds-tolerance-model`
diagnostic and by `crossing.skipped === true`, both unchanged.

### 5.3 Compatibility: no public schema change; an intentional public behavioral change

*(Reworded per §16, High finding 5 — an earlier draft's heading, "Public API impact: none", conflated
schema compatibility with behavioral compatibility. They are different contracts and are now stated
separately.)*

**Schema:** unchanged. `properCrossingQuery` and `volumeOverlapQuery` are not exported from
`collision/index.js` (§1.6); `stats` is consumed only inside `VolumeOverlapQuery` and dropped by both
callers (`_runNarrowPhasePair` returns `{hit, witness}`; the clearance precheck returns a status). No
public field is added, removed, renamed, or retyped.

**Behavior:** intentionally changed, and observable through `CollisionWorld`'s public results. A
consumer that today relies on stable `volume-overlap` pair counts, on stable
`clearanceHardClashExclusions`, on stable `statistics.diagnostics` multisets, or that treats the
absence of a pair as meaningful, **will see different output** — pairs previously suppressed by timing
now appear, and false `crossing-budget-exhausted` / `clearance-hard-clash-precheck-inconclusive`
entries disappear. Every such change is in the direction of completeness, and every one of them was
previously nondeterministic (i.e. no consumer could have been relying on it safely), but "previously
nondeterministic" is a reason the change is *sound*, not a reason it is *invisible*.

Consequently this change requires a release-note entry describing the behavioral change in consumer
terms, and an M1–M3 baseline refresh (§7.1). See the Compatibility disposition section at the end for
the split between this bug fix and any future, separately-classified budget change.

### 5.4 Telemetry stays internal and diagnostic-event-only

`stats.elapsedMs` / `stats.timeBudgetExceeded` must **never** enter `result.diagnostics`. That array is
attached verbatim to `statistics.diagnostics` on the volume-overlap path (`CollisionWorld.js:2288`)
and is a §6.4-compared field — putting a timing-derived reason there would manufacture a brand-new
nondeterministic public diagnostic and require the §6.4 widening this design is forbidden to perform.

Instead, `VolumeOverlapQuery` folds both values into the **already-emitted, already-bounded**
`stage: 'crossing'` diagnostic event (`VolumeOverlapQuery.js:125-129`):

```js
reportDiagnosticEvent('hard-clash-precheck', {
  ...diagnosticPairContext, ...triangleCovariates,
  stage: 'crossing',
  ms: performance.now() - crossingStartedAt,          // unchanged
  timeBudgetExceeded: crossing.stats.timeBudgetExceeded,   // added
  crossingElapsedMs:  crossing.stats.elapsedMs,            // added
  pointClassifications: crossing.stats.pointClassifications,  // added
  exhaustedBudget:    crossing.stats.exhaustedBudget,      // added
});
```

Properties this preserves: exactly **one** event per pair (never inside a hot loop); gated on
`options.diagnosticPairContext`, which is itself gated on `isDiagnosticEventRecorderActive()`
(`CollisionWorld.js:2414`), so **zero cost and zero emission in production**, where no recorder is
installed; no new module dependency — `ProperCrossingQuery` does **not** import `scheduler.js` and
stays a pure function.

### 5.5 How the consumers change

| Consumer | Change |
|---|---|
| `VolumeOverlapQuery` `conclusive` (`:296-301`) | **No code change.** Input becomes deterministic. |
| `VolumeOverlapQuery` `inconclusiveCauses` (`:329`) | **No code change.** `crossing-budget-exhausted` now means deterministic exhaustion — which is exactly what `inconclusiveCauses` should represent, and the string need not change. |
| `VolumeOverlapQuery` crossing event (`:125-129`) | Additive payload fields only (§5.4). |
| `ClearanceHardClashPrecheck` (`:40-48`) | **No change.** Reads `overlap` and `conclusive`; both become deterministic. |
| `CollisionWorld._runClearanceNarrowPhasePair` | **No change.** `crossing: { now: this._now }` (`:2433`) is retained — it now feeds telemetry rather than a verdict, and keeping it preserves the frozen-clock test seam's behavior. |
| `CollisionWorld._runNarrowPhasePair` (Protected Invariant) | **No code change.** Behavior changes; see §7. |

### 5.6 Diagnostic-string stability

`crossing-budget-exhausted` and `inconclusive-crossing` are **retained unchanged, not renamed and not
deprecated.** Rationale: renaming would ripple into §6.4's carve-out text (forbidden to edit), into
M2/M3 gate baselines, and into `test/query/*.test.mjs`, for zero semantic gain. `crossing-budget-exhausted`
is now *more* accurate than before, since it finally always denotes an actual exhausted budget.

**Explicitly rejected:** adding a new `slow-crossing-traversal` (or similar) reason to
`result.diagnostics`. See §5.4.

---

## 6. Deterministic exhaustion semantics and composition

When any of the three caps is reached:

1. Traversal stops immediately via the existing abort protocol (`return true` from the callback, so
   `bvhcast` takes its normal-completion path and clears its module-global `_active`;
   `ProperCrossingQuery.js:61-77`).
2. `aborted = true`, `finalCrossing = false`, `inconclusive = false` (masked, as today).
3. `stats.exhaustedBudget` names which cap. Deterministic and reproducible.
4. Diagnostics: exactly `[{reason:'crossing-budget-exhausted'}]`. Byte-stable across runs.
5. Repeated identical runs produce identical exhaustion at the identical counter value.

### 6.1 Composition — an exhaustion must never be read as proven non-overlap

| Composition point | Behavior on deterministic exhaustion | Verified against source |
|---|---|---|
| `VolumeOverlapQuery` crossing term | `crossing.crossing === false` ⇒ falls through to containment; the exhaustion does **not** short-circuit a negative | `:138` |
| source-in-target containment | Runs normally. Independent, deterministic sample budget. May still prove `overlap:true` | `:175-220` |
| target-in-source containment | Same | `:226-269` |
| `VolumeOverlapQuery` negative | `crossingConclusive = false` ⇒ `conclusive = false` ⇒ returns `{overlap:false, conclusive:false, inconclusiveCauses:['crossing-budget-exhausted', …]}` | `:296-346` |
| `ClearanceHardClashPrecheck` | `overlap===false && !conclusive` ⇒ `{status:'inconclusive'}` — **never `'proceed'`** | `:45-47` |
| Hard-Clash precheck accounting | `'inconclusive'` ⇒ **no** `hardClashExcludedKeys` entry, one pair-scoped diagnostic, `clearanceHardClashExclusions` unchanged | `CollisionWorld.js:2446-2454`, `:1787-1790` |
| clearance fallback | `'inconclusive'` returns `{outcome:'inconclusive'}` and the distance query is **not** run — the pair is dropped from `pairs`, never reported as a clearance hit on unproven evidence | `CollisionWorld.js:2453`, `:1791` |

**The load-bearing property is preserved end to end:** the tri-state
`excluded / proceed / inconclusive` never collapses to a boolean, and a deterministic exhaustion lands
in `inconclusive`, never in `proceed` and never in a proven non-overlap. This is unchanged behavior —
the fix changes *when* exhaustion happens (deterministically, not by clock), never *what it means*.

---

## 7. Decision 5 — Fix scope

**Adopted: fix the shared `ProperCrossingQuery` semantics once. No clearance-only workaround.**

A clearance-only guard was considered and rejected: it would knowingly leave the identical
correctness defect live in `volume-overlap` mode, and the in-repo comment at
`CollisionWorld.js:2422-2432` already names that exposure as pre-existing and unfixed. Decision 5's
own instruction — *"Do not preserve known incorrect nondeterminism merely to avoid touching shared
code"* — is dispositive.

### 7.1 Impact assessment

| Surface | Impact | Classification |
|---|---|---|
| **`volume-overlap` mode** (`_runNarrowPhasePair`, `CollisionWorld.js:2274-2277`) | Some pairs that previously reported a *false* `crossing-budget-exhausted` now report a real overlap (`hit:true` + a `surface-crossing` witness) or a clean negative. `statistics.diagnostics` loses those false entries. Result completeness strictly improves. | **Bug fix** |
| **`clearance` Hard-Clash precheck** | `clearanceHardClashExclusions` rises to its deterministic value (**347** on the S2 fixture, measured under the frozen-clock intervention); `clearance-hard-clash-precheck-inconclusive` falls (525→522 measured). Structurally, a dbId key can now be correctly suppressed from `pairs` that previously survived by timing luck. | **Bug fix** |
| **Containment / crossing composition** | Unchanged (§6.1). Containment is already deterministic (§8). | None |
| **M1/M2/M3 unit fixtures** | Synthetic fixtures are far too small to reach an 8 ms traversal, so almost all are behaviorally unaffected. The exceptions are the **four tests that assert the defect as a contract** — `ProperCrossingQuery.test.mjs:127` and `:194`, plus the two callback-exception tests at `:144` and `:173` that inject a throwing clock on the *second* read. All four must be **re-expressed**, not merely kept green (§13 G). | Test-contract change |
| **M2/M3 performance-gate baselines** | Diagnostic counts and timing values change. Semantic/correctness contracts must hold; timing values must be re-baselined. | Re-baseline |
| **Shipped `aborted` / inconclusive semantics** | `aborted`'s *meaning* narrows (deterministic exhaustion only). Its *type, name, diagnostic string, and downstream treatment* are all unchanged. `aborted` is not on the public surface (§5.3). | **Bug fix** |
| **`SurfaceIntersectionQuery.js:75`** | Identical defect class (`now() - traversalStart > timeBudgetMs` gating `aborted`). Reachable only from `mode:'surface-intersection'`. **Not on the composed `volumeOverlapQuery` path.** | **Out of scope, knowingly deferred** — §7.3 |
| **`SurfaceCrossingWitness.js:80,108,168`** | Identical defect class via `scheduler.elapsedMs() > timeBudgetMs`. Reachable only from `ContainmentModeQuery.js:95` (`mode:'containment'`). `volumeOverlapQuery` never routes through it (`VolumeOverlapQuery.js:52`; caller grep confirms). | **Out of scope, knowingly deferred** — §7.3 |

### 7.2 The Protected Invariant

`CollisionWorld.js:2430-2432` declares the three pre-existing modes' `volumeOverlapQuery` call site
"byte-for-byte unchanged." **This design does not modify a single byte of that call site.** It changes
the *behavior* of a shared dependency that call site invokes.

Disposition: **a bug fix preserving intended semantics, not a contract change.** Three independent
grounds:

1. The intended semantics of `volume-overlap` were always geometric. Nothing in M1/M2/M3 declares
   "the result may depend on machine speed"; the wall clock was introduced as a **responsiveness**
   guard and was never a declared part of the predicate.
2. `crossing-budget-exhausted` is documented as a **truncation** diagnostic meaning *"we did not
   finish, so we do not know"* (`VolumeOverlapQuery.js:131-136`, "truncation/coverage diagnostics").
   Emitting fewer of them is completeness improving within the declared contract, not a change to it.
3. The repository already classifies this mechanism as a defect, in tracked code, in its own words
   (`CollisionWorld.js:2422-2432`).

**However** — the milestone owner must ratify this classification before implementation, because it
does change published `volume-overlap` results and `statistics.diagnostics` on a Protected-Invariant
path. The change requires a `CHANGELOG` entry and an M1–M3 compatibility re-baseline (§13 G). It does
**not** require architecture-change discipline, because no declared contract is being altered.

### 7.3 Deferred siblings — recorded, not overlooked

`SurfaceIntersectionQuery` and `SurfaceCrossingWitness` carry the same defect class. They are
deferred, with these reasons stated so the deferral is a decision rather than an omission:

- Neither is reachable from the composed `volumeOverlapQuery` predicate, so §5 of the prompt's rule
  ("do not knowingly leave the same correctness defect one call later in the same composed predicate")
  is satisfied by this scope. The only term composed *with* the crossing term — `ContainmentQuery` —
  is clean (§8).
- Neither is implicated in the M4 blocker, and M4 measures only `clearance` and `volume-overlap`.
- Widening scope to two more modes would multiply the regression surface across `M1`/`M2` acceptance
  gates while M4 is blocked.

**Required follow-up (not this fix), with an owner and a deadline so the deferral cannot become
permanent** *(§16, question 4)*: a tracked item applying the identical treatment to both, **owned by
the collision-library milestone owner**, and **due before the implementation milestone that follows
M4** — the same milestone at which §19.2 already places worker-adoption prerequisites. It must not
slip past that boundary, because both paths are known timing-dependent semantic paths and the
argument for tolerating them here is purely one of scope, not of safety.

`SurfaceCrossingWitness` is the harder of the two and should be scheduled accordingly: its clock
arrives via `scheduler.elapsedMs()` — a *shared* accumulator, not a traversal-local one — so its
abort point today depends on unrelated earlier work in the same `findClashes` call, making its
nondeterminism strictly worse than the one fixed here and its fix not a copy of this one.

Until that item lands, `mode: 'surface-intersection'` and `mode: 'containment'` are **known to carry
wall-clock semantic nondeterminism**, and that fact must be stated wherever their determinism is
otherwise implied — not left to be rediscovered.

---

## 8. Containment interactions — the full budget classification

Every budget reachable from `ClearanceHardClashPrecheck`, classified into the four categories the
prompt names:

| Budget | Location | Category | Disposition |
|---|---|---|---|
| Crossing time budget (8 ms) | `ProperCrossingQuery.js:84`, `:131` | **wall-clock and correctness-bearing** | **Fixed by this design** → demoted to *wall-clock but diagnostic-only* |
| `maxCandidatePairsExamined` = 50,000 | `ProperCrossingQuery.js:37, 84` | **sample-count deterministic** | Retained unchanged at 50,000 (§4.5) |
| `maxCrossingPairsExamined` = 64 | `ProperCrossingQuery.js:38, 113` | **sample-count deterministic** | Retained unchanged |
| `maxCrossingPointClassifications` **(new)** | `ProperCrossingQuery.js:138, 143` | **sample-count deterministic** | Added at 1,536 — the structural maximum, non-binding (§4.3) |
| `maxContainmentSamples` = 512 | `ContainmentQuery.js:172, 278, 448, 466` | **sample-count deterministic** | Unchanged |
| `samplesPerComponent` = 8, `maxWitnessTriangles` = 8 | `ContainmentQuery.js:173-174` | **sample-count deterministic** | Unchanged |
| Composed-stage scheduler `elapsedMs` | `CollisionWorld.js:433-445` | **wall-clock but diagnostic-only** (yielding only) | Unchanged |
| Per-call frame-budget accumulator | `scheduler.js:96-108` | **wall-clock but diagnostic-only** (yielding only) | Unchanged |

**Containment does not have this defect.** Verified directly in source, not inherited from the
investigation: `anyComponentInside` reads the scheduler **only** through
`await scheduler.checkpointIfDue()` (`ContainmentQuery.js:289`, `:452`) — it never reads
`scheduler.elapsedMs()`, and no verdict, `inside` flag, `unresolvedComponentCount`, or
`budgetExhausted` value derives from a clock. Its terminators are `samplesUsed >= sampleBudget`
(`:278`, `:448`, `:466`) and fixed loop bounds. `classifyPoint` reads no clock at all.

Therefore **no containment change is required**, and none is proposed. After this fix,
`volumeOverlapQuery` as a whole is a deterministic predicate — every remaining budget in it is
sample-count deterministic, and every remaining clock in it is yield-only.

**Pin it anyway.** Regression matrix item C (§13) asserts containment's clock independence directly,
so this audit is defended against future drift rather than left as a one-time reading.

---

## 9. Wall-clock telemetry behavior

### 9.1 Where the 8 ms concept survives

As a **derived, end-of-traversal observation**, not an in-loop branch:

```
entry:  traversalStart = now()
…
exit:   elapsedMs          = now() - traversalStart
        timeBudgetExceeded = elapsedMs > timeBudgetMs
```

Two clock reads per traversal, total. Both `options.now` and `options.frameBudgetMs` are **retained**
as injectable seams so the telemetry itself is deterministically testable (regression C).

### 9.1a A telemetry failure must never withhold a geometric result

*(Added per §16, High finding 7.)* Declaring the clock "telemetry-only" is not enough while a clock
call sits on the return path: if `now()` **throws**, the caller loses a geometric result that was
already fully computed — a proven crossing included. That would leave an observational dependency in
control of *availability*, which is the same defect class in a different costume. Non-finite and
backward-moving clocks are the quieter variants of the same problem.

**Required contract, normative:**

1. Both telemetry clock reads are individually fault-isolated. A throw from `now()` is caught at the
   read site and never propagates out of `properCrossingQuery`.
2. `elapsedMs` is emitted only if both reads succeeded **and** `exit - entry` is finite and `>= 0`.
   Otherwise `elapsedMs = null` and `timeBudgetExceeded = false`.
3. `timeBudgetExceeded` is never `true` on the strength of an unvalidated value.
4. The geometric fields (`crossing`, `aborted`, `inconclusive`, `diagnostics`, `witnessPoint`) and the
   three deterministic counters are computed and returned **regardless** of any telemetry failure.

This is the same degrade-to-`null` fault-tolerance contract this codebase already applies to
`toFiniteWorldArray` (`VolumeOverlapQuery.js:24-28`, "a non-finite result degrades to `null` here
rather than throwing out of this function and losing the whole `findClashes` call"), reused rather
than invented.

**Failures must stay visible, not be swallowed silently.** `elapsedMs: null` reaching the diagnostic
event *is* the signal, and a unit test must assert that a throwing / non-finite / backward clock
produces exactly `{elapsedMs: null, timeBudgetExceeded: false}` alongside an otherwise-identical
geometric result (regression C, extended).

**Consequence for the exception tests:** because the clock can no longer throw out of the query, the
two callback-containment tests must move to a different injection seam — see §13 G and §16, High
finding 4. This is a genuine coupling between the two findings, not an incidental one.

### 9.2 Why end-of-traversal measurement, not first-breach recording

The prompt offers "record first threshold crossing timestamp" as one example. This design chooses
end-of-traversal measurement instead, for reasons that are performance-material:

- **Cost.** Today the clock is read once per candidate pair and once per probe: up to ~51,500 reads
  per traversal. At a typical `performance.now()` cost of 20–50 ns that is **1–2.5 ms of pure clock
  reading** in the worst case — a meaningful fraction of the very budget being measured. Removing the
  in-loop reads is a genuine speedup that partially offsets §12's span growth.
- **Sufficiency.** Overrun magnitude is `elapsedMs − timeBudgetMs`, which end-of-traversal measurement
  gives exactly. Combined with `pointClassifications` and `exhaustedBudget`, M4 can reconstruct *how
  much* work ran past the threshold without knowing precisely *when* it crossed.
- **Simplicity.** No in-loop state, no once-only guard, no risk of a latent semantic read.

Alternative (b) — keep in-loop reads behind an `if (!timeBudgetExceeded && …)` short-circuit — was
considered and rejected: it retains nearly all the clock-read cost on the pre-breach path (the common
case) for information that is not needed.

**No repeated or unbounded telemetry is emitted inside any hot loop.** Emission remains exactly one
`reportDiagnosticEvent` per pair, at the site that already emits one (§5.4).

### 9.3 Disposition of the timing-derived diagnostic reason

`crossing-budget-exhausted` and `inconclusive-crossing` are **retained unchanged in name and shape**,
and become **fully deterministic**. They are no longer timing-derived at all. They are therefore
**not** renamed, **not** deprecated, and **not** removed from correctness comparison.

This is the disposition that keeps §6.4 unchanged, which the prompt prefers.

### 9.4 §6.4 becomes vacuous, and is deliberately left alone

§6.4's `TIME_BUDGET_DIAGNOSTIC_DIVERGENCE` exception excuses a diagnostics divergence confined to
`{crossing-budget-exhausted, inconclusive-crossing}` on the grounds that the abort "depends on machine
speed at that instant." After this fix that premise is false: the abort depends on geometry and
deterministic counts only, so the divergence the carve-out excuses **can no longer occur**.

**The carve-out is not edited.** Instead:

- The §13 regression matrix requires that a post-fix Phase 3 canonical run reports **zero**
  `TIME_BUDGET_DIAGNOSTIC_DIVERGENCE` findings. That is an expectation on the *report*, satisfied by
  the comparator exactly as it stands — no comparator change, no verdict-reducer change.
- A residual risk is recorded honestly: a vacuous carve-out could, in principle, mask a *future*
  reintroduction of timing dependence in these two reasons. Narrowing or deleting §6.4's exception is
  the clean end state (the investigation's §8 Option B notes this too), but it is a **spec change for
  the milestone owner, deliberately out of this design's scope**, and the zero-findings expectation
  above is the compensating control until then.

---

## 10. Decision 6 — Regression expectation vs. normative constant

**`clearanceHardClashExclusions = 347` may be used as a pinned fixture regression expectation, and
must never become a library normative constant.**

- `347` is the deterministic ground truth **for the federated Audubon fixture, at the model version
  the investigation measured, for the S2 `k=100:typical:clearance` query** (established under the
  frozen-clock intervention, report §3.3: 6/6 runs, constant). Nothing more.
- A fixture change, a model-version change, or a legitimate change to a shipped tolerance may change
  it. A test asserting it **must** pin the fixture version, and must assert **stability across runs**
  as its primary contract, with the literal value strictly secondary.
- `347` must not appear in `collision/constants.js`, in any library module, or in any acceptance
  threshold.

**The actual normative contract, stated explicitly and in full:**

1. Identical geometric inputs produce the same semantic precheck outcome, always.
2. The TLAS and linear arms agree semantically, for every pair.
3. Repeated runs of the same arm agree semantically, for every pair.
4. Deterministic budget exhaustion is reproducible: same input ⇒ same counter value ⇒ same
   `exhaustedBudget` ⇒ same diagnostics.

An implementation satisfying (1)–(4) is correct even if the number turns out not to be 347.

---

## 11. Performance implications

### 11.1 Expected worst atomic-span growth

Today the crossing term self-limits at ~8 ms plus one probe's overshoot (measured: **8.100 ms**,
report §2.3). After the fix its span is bounded by the deterministic caps instead:

| Component | Bound | Estimated span |
|---|---|---|
| Tier-B candidate scan at the cap | 50,000 pairs × ~0.3 µs (code's own figure) | **~15 ms** |
| Tier-C probe work at the structural implied cap | 1,536 classifications × `C_p` | **unknown** — `C_p` unmeasured |
| Tier-A node descent | uncounted residual | small; folded into the measured end-to-end span by §14 |
| Clock reads removed | −(up to ~51,500 × 20–50 ns) | **−1 to −2.5 ms** |

**The worst case is genuinely unknown and this design does not pretend otherwise.** That is the
substantive reason §14 exists and the reason this document is `BLOCKED_ON_BUDGET_CALIBRATION`.

**An additive unit-cost model must not be used to claim the ceiling is met.** *(Per §16, High finding
6.)* Multiplying a median per-classification cost by a count, and adding a scan cost measured on a
*different* fixture, would produce false precision: it ignores cost variance, cold-start and JIT/GC
effects, tier-A node descent, raycast hit-count variation, and — decisively — the possibility that
high scan cost and high probe cost **co-occur in one traversal**, which no per-fixture measurement of
either alone can reveal. The 1.5× run-to-run spread already measured on identical geometry
(`frag364`: 5.10–7.70 ms) is direct evidence that a median-based model would understate the tail.

§14 therefore measures **complete end-to-end traversal spans directly**, at a stated high percentile,
on pre-registered runtime tiers — never a derived product of unit costs.

**Typical growth, by contrast, is small and measured.** Only pairs that currently abort change at all:
**3 of 1319 candidates (~0.2%)** in the S2 fixture. Their real completion cost measured **4.8–5.1 ms**
(report §3.3) — i.e. the pairs the clock was killing at 8 ms were within ~5 ms of finishing. The
control pair `frag364→30` completed in 5.10–7.70 ms across runs without ever aborting.

An important corollary of that data: the ~1.5× run-to-run spread on identical geometry means the
current 8 ms cliff is not even protecting a stable span — it is sampling one.

### 11.2 Can `frameBudgetMs` preempt it?

**No, and it could not before this fix either.** `properCrossingQuery` contains no `await`; `bvhcast`
is synchronous with no continuation token; returning truthy from the callback *terminates* rather than
suspends. The nearest checkpoints are `VolumeOverlapQuery.js:171` and `:222`, both **after** the
crossing term has returned. The change is that the atomic unit gets larger, not that a previously
preemptible unit becomes non-preemptible.

### 11.3 Do outer scheduler checkpoints still behave correctly?

Yes, and no change is needed. `createComposedStageScheduler` (`CollisionWorld.js:433-445`) measures
elapsed time since its last real yield and resets `sinceMs` on yielding. A longer crossing span makes
the next `checkpointIfDue()` due immediately, which yields — exactly the intended cooperative
behavior. The per-call frame-budget accumulator behaves identically.

### 11.4 Does this increase the chance M4 justifies a worker boundary?

**Yes — and that is the honest, intended consequence, not a side effect to be hidden.** The crossing
term becomes a larger, genuinely atomic, genuinely transferable unit, which strengthens the
evidentiary basis for §8.2's precheck vertical. This fix is a **prerequisite** for M4 producing valid
evidence; it is **not itself evidence** for A, B, C, or D (§13).

### 11.5 Capacity ceilings

- **`frameBudgetMs = 8` is not retuned** and keeps its declared meaning: a scheduler-conformance
  convention, never a user-experience threshold (M4 spec §7.1). After this fix it stops being a
  correctness input to the crossing term entirely, which makes its declared meaning finally true of
  this code path.
- **The 24.8 ms M1 ceiling becomes the relevant reference for the crossing term for the first time.**
  Its status is fixed here, because §14 depends on it and the review asked
  *(§16, question 2)*: **it is a reference-hardware acceptance gate, not a hard cross-platform
  requirement.** Grounds, from the M4 spec itself: §7.1 declares `frameBudgetMs = 8` and the derived
  24.8 ms ceiling to be **scheduler-conformance checks, not user-experience thresholds** — "passing
  them says the library yields as designed; it says nothing about whether the Viewer stayed usable" —
  and §7.2 states plainly that **no product-approved responsiveness target exists** for this
  operation. So 24.8 ms is what §14 measures against and reports; the genuine cross-platform
  responsiveness question is M4's X-1 axis, which is exactly what M4 was chartered to answer. §14
  therefore reports a measured envelope against 24.8 ms on named tiers; it does not treat a breach as
  an automatic veto, and it does not treat conformance as proof of user-visible responsiveness.
- **`maxSyncTriangleCount = 12,000`** (enforced at `createGeometryRegistry.js:100`) is the geometry
  ceiling that bounds per-`classifyPoint` cost, and §14's worst-case span measurement must be taken
  against operands at it.
- No worker is introduced to hide any cost.

---

## 12. M4 implications

Stated explicitly, as required:

- **This is a prerequisite correctness fix discovered by M4.** It is a defect in shipped library code,
  not in M4's methodology; M4's dual-arm comparison is merely what made a pre-existing production
  nondeterminism visible.
- **It is not evidence for A, B, C, or D.** No verdict may cite it. It changes the *inputs* to the
  measurement, so all prior measurements are superseded rather than reinterpreted.
- **The prior Phase 3 canonical run remains invalid.** `m4-gate-1789057417429.json` is
  `FAILED_VALIDATION` and correctly so. Further, since the underlying statistic was nondeterministic
  run-to-run within a single arm, **no** pre-fix canonical run can be treated as valid — a run that
  happened to agree did so by luck.
- **The previous provisional D remains unusable**, for both the original reason (§19.1: the run was
  `FAILED_VALIDATION`) and the newly-established nondeterminism.
- **Phase 4 remains blocked** and must not start.
- **After the fix, focused parity must pass before a full Phase 3 rerun** — see the M4 restart
  sequence at the end of this document.

### 12.1 Should M4 instrumentation retain per-pair precheck evidence?

**Yes — bounded and diagnostic-only.** This is the investigation's item G1, and it is adopted.

The sole reason this blocker was undiagnosable from its own artifact is
`test/performance/run-gate-m4.mjs:989`:

```js
sched.setDiagnosticEventRecorder(() => { diagnosticEventCount++; });
```

The library emits everything needed — `conclusive`, `inconclusiveCauses`, `containmentSamplesUsed`,
per-stage `ms`, triangle/component covariates — and the harness throws all of it away.

**Proposed change (harness-only, no `collision/` change, no verdict-semantics change):** retain a
**bounded** projection of `hard-clash-precheck` events — for `stage:'volume-overlap-query'` and
`stage:'crossing'` only, keyed by `(sourceEpoch, sourceFragmentId, targetEpoch, targetFragmentId)`,
hard-capped at a fixed entry count per measured run (e.g. 5,000, with an explicit
`truncated: true` marker and the dropped count when the cap is hit) — written into the artifact under a
clearly diagnostic-only key.

**Constraints on it, stated so it cannot drift:** it must not be read by the comparator; it must not be
read by the verdict reducer; it must not change `diagnosticEventCount`; and it must not run in the
non-instrumented arm. It is retained evidence, nothing else.

**Ownership and safety requirements** *(added per §16, Medium finding 8; its premise was verified in
source — `run-gate-m4.mjs:1022-1024` clears all three recorders as plain statements, **not** inside a
`finally`, so a throw between installation and cleanup leaves the module-global recorder installed and
silently contaminating every later run in the same process):*

1. **Unconditional cleanup.** All three `clear*Recorder()` calls move into a `finally` wrapping the
   entire measurement window, so no projection error, transformation error, or query rejection can
   leave a recorder installed. This is a harness robustness fix worth making regardless of retention.
2. **Non-throwing callback.** The retaining recorder callback must not throw — it runs inside library
   code via `reportDiagnosticEvent` (`scheduler.js:244`), which has no guard of its own, so a throw
   there would propagate into the query under measurement and corrupt the very run being measured.
   Wrap its body and record a `projectionErrors` count instead.
3. **Run-scoped keying.** Retained records are keyed by **`(runId, sourceEpoch, sourceFragmentId,
   targetEpoch, targetFragmentId, stage)`** — `runId` identifying the
   `(runtime, case, broadPhase, state, repetition)` tuple. Keying by pair identity alone would let the
   `crossing` and `volume-overlap-query` events for one pair overwrite each other, and would let two
   runs in one process collide. Equivalently: one fixed record per pair holding a named slot per
   stage. Either shape is acceptable; an unqualified pair-keyed map is not.
4. **Exclusive ownership.** The gate is the sole installer for the window. The recorder is a
   module-global singleton (`scheduler.js:239-241`) with no generation guard, so the harness must not
   install a second recorder, nor run two measured queries concurrently, within one window.

**Item G2 (propagating `overlapResult.diagnostics` through `classifyHardClashPrecheck`) is explicitly
NOT adopted here.** Pre-fix it would launder a real correctness defect into §6.4's carve-out; post-fix
it is unnecessary and would change the public diagnostics multiset, forcing an M3 baseline change for
no correctness gain. It is a separate decision for a separate change.

---

## 13. The regression matrix (designed before implementation)

**A gap that must be closed first, or the whole matrix is theatre.** The clearance unit tests that
exercise the precheck build their world with a **frozen** clock —
`test/CollisionWorld.findClashes.clearance.test.mjs:106` (`frozenClock`, 12 call sites), and likewise
`CollisionWorld.clearanceStatistics.test.mjs` (6 sites) and
`CollisionWorld.clearanceAdmissionValidation.test.mjs` (8 sites). That is precisely the configuration
in which this defect **cannot** manifest. The two clearance files that do not freeze the clock use
geometry too small to reach 8 ms. That combination is why 1000+ green tests never caught it.

After this fix, the deterministic counters remove the need for a clock at all — which is the point.
Every test below must key off **counters**, not the clock, except C, whose entire purpose is to prove
the clock is inert.

### A. Exact real failing pair

`structure:3547/frag363 → architecture:3551/frag30`, federated Audubon fixture, both arms.

- Assert: precheck `conclusive === true`, disposition `excluded`, `inconclusiveCauses === []`.
- Assert: **stable across N ≥ 10 repeated executions** — the primary contract; the literal value is
  secondary.
- Template: `test/performance/m4/structure-fragment-clearance-regression.mjs` (same URNs, same
  `setDiagnosticEventRecorder` seam, same "not a `node --test` file" convention).
- **The live test alone is not a sufficient CI guard** — it needs a dev server, APS credentials, and
  remote model availability, so it will be skipped exactly when it would have caught a regression.
  **Pair it with a committed deterministic backstop:** a synthetic operand pair whose traversal
  reaches a chosen `pointClassifications` count, exercised in the ordinary `node --test` suite,
  asserting the same semantic invariants. (An independent review of the investigation raised this
  exact concern; it is endorsed and made mandatory here.)

### B. Pair-order independence

Same exact operands, varying only predecessor/candidate order: both arm orders (`tlas>linear`,
`linear>tlas`), both broad phases, and a direct `volumeOverlapQuery` unit call with the operands
preceded by different warm-up work.

- Assert identical: precheck disposition, `conclusive`, `inconclusiveCauses`, `containmentSamplesUsed`,
  all three crossing counters, and `exhaustedBudget`.

### C. Wall-clock independence

Unit level, no live fixture. For one operand pair that genuinely reaches the probe ladder, call
`properCrossingQuery` with four injected clocks: frozen (`() => 0`), real, a clock returning `1e9` on
its **first** read, and a clock advancing 10 s per read.

- Assert: `crossing`, `aborted`, `inconclusive`, `diagnostics`, `witnessPoint`, and all three counters
  are **identical in all four cases**.
- Assert: `stats.timeBudgetExceeded` and `stats.elapsedMs` **may** differ — the only permitted
  difference, and the test must assert that they *do* differ between the frozen and 10-s clocks, so
  the telemetry is proven live rather than dead.
- **Also cover containment** (§8's pin): assert `anyComponentInside` returns identical `inside`,
  `samplesUsed`, `unresolvedComponentCount`, `budgetExhausted`, and diagnostics under the same four
  clocks.

### D. Deterministic budget exhaustion

Three sub-cases, one per cap, each driven by lowering the cap via its `options` seam rather than by
constructing enormous geometry:

| Sub-case | Seam | Assert `exhaustedBudget` |
|---|---|---|
| D1 | `maxCandidatePairsExamined: 500` on the interleaved-comb fixture | `'candidate-pairs'` |
| D2 | `maxCrossingPairsExamined: 2` on a deep box overlap | `'crossing-pairs'` |
| D3 | `maxCrossingPointClassifications: 5` on a deep box overlap | `'point-classifications'` |

For each, over N ≥ 10 runs assert: identical counter values every run; identical
`aborted`/`crossing`/`inconclusive` every run; identical `diagnostics` every run; identical
`exhaustedBudget` every run. **No clock is injected in any of these** — that is the property being
demonstrated.

### E. TLAS vs. linear parity

Re-run `S2[k=100:typical:clearance]` through the full §6.4 comparator.

- Require: `clearanceHardClashExclusions` equality; **full §6.4 parity** — pair set, distances
  (bit-identical), witnesses, all six compared statistics, and diagnostics multiset equality.
- Require: **zero** `TIME_BUDGET_DIAGNOSTIC_DIVERGENCE` findings (§9.4). Post-fix, that finding class
  should be unreachable; a non-zero count means timing dependence survived somewhere.
- **A single passing run is not evidence.** The observed pre-fix failure rate was roughly 1 run in 6
  producing an extreme value, with intermediate values far more common. Require N ≥ 10 clean runs.

### F. Same-arm repeat stability

Run the failing tuple N ≥ 10 times under **only** TLAS and N ≥ 10 times under **only** linear.

- Assert zero semantic drift and zero statistics drift within each arm.
- This is the assertion that actually detects this defect class; arm-vs-arm equality alone (E) would
  have passed on many of the 12 pre-fix baseline runs by luck.
- Do **not** encode `exclusions + inconclusive-diagnostics = 869` as a contract: that invariant is
  empirical for this fixture, not structural (report §4).

### G. M1/M2/M3 semantic regressions

- Full `npm test`. Note the pre-existing whole-suite-only flakiness in the ledger; **re-baseline it
  after the fix rather than assuming it is unrelated.**
- Re-express, do not merely keep green:
  - `ProperCrossingQuery.test.mjs:127` — *"time budget trips before count budgets"*. This test is the
    defect written down as a contract: two `box(3,3,3)` operands at a `(0.1,0.1,0.1)` offset — an
    unambiguous deep overlap — with a mocked clock, asserting `r.crossing === false`. **Its new
    contract:** a clock trip must produce `crossing === true`, `aborted === false`, and
    `stats.timeBudgetExceeded === true`. It must fail against the current implementation.
  - `ProperCrossingQuery.test.mjs:194` — *"time budget aborts strictly mid-probe-loop"*. Re-express as
    a **`pointClassifications`** granularity test: with `maxCrossingPointClassifications` set low, the
    traversal must abort having performed exactly that many classifications, never more.
  - `ProperCrossingQuery.test.mjs:144` and `:173` — the two callback-exception tests inject a clock
    that throws on its **second** read. **These must not merely be adjusted; they must be re-anchored
    to a seam that still throws from *inside* `intersectsTriangles`** *(§16, High finding 4 — the
    sharpest catch of the review)*. After this fix there are only two clock reads, both outside the
    callback, and §9.1a additionally requires the clock's throw to be swallowed. A naively rewritten
    test would still observe an exception and a healthy subsequent traversal — while the exception
    now originates *after* `bvhcast` already completed normally. The test would pass, look correct,
    and no longer exercise the callback-containment protocol at all, leaving the vendored-BVH
    `_active` poisoning defect free to regress unnoticed.

    **Required:** an internal-only, test-only injection seam for work performed *inside* the callback
    — the natural choice being an injectable point classifier
    (`options.__classifyPoint`, defaulting to the imported `classifyPoint`), since it is called at
    `:138` / `:143`, squarely inside `intersectsTriangles`. It must be documented alongside
    `options.now` / `options.yieldToScheduler` under `collision/README.md:96-98`'s existing
    "internal test seams … not part of the supported developer API" declaration, and must never be
    supplied by production code. Both tests must then assert:
    - the thrown value originates inside the callback (assert `candidatePairsExamined > 0`, or that
      the classifier was actually invoked, so a post-`bvhcast` throw cannot satisfy the test);
    - both a **truthy** and a **falsy** (`throw null`) value propagate out of `properCrossingQuery`;
    - an immediately-following normal traversal still succeeds — proving `_active` was cleared.

    A vendored-BVH-boundary test was considered as the less invasive alternative and is **rejected as
    the primary**: it would not exercise `ProperCrossingQuery`'s own catch/return-true/rethrow code,
    which is the code at risk. It is acceptable only as an *additional* test.
  - `VolumeOverlapQuery.conclusive.test.mjs:68-74` and
    `VolumeOverlapQuery.inconclusiveCauses.test.mjs:21` pass `crossing: { frameBudgetMs: 5000 }` to
    dodge the 8 ms default. That workaround becomes unnecessary; removing it is itself a regression
    signal.
  - `test/query/ClearanceHardClashPrecheck.test.mjs:26` documents the real-8 ms exposure under
    full-suite CPU load. That comment and any tolerance built on it should be revisited.
- **Timing values are not required to remain identical** where the old value depended on a premature
  wall-clock abort. **Semantic and correctness contracts must remain intact**, including for
  `volume-overlap` mode on the Protected-Invariant path.

### H. Pathological geometry

Synthetic worst-case fixtures, each asserting **bounded completion** and identical counters across
N ≥ 10 runs, with no clock injected:

- H1: interleaved combs at increasing tooth counts (maximizes candidate pairs with zero real crossings).
- H2: two coincident dense meshes at a sub-`minPenetrationDepth` offset (maximizes confirmed pairs
  whose every probe fails).
- H3: two dense boxes in deep overlap (maximizes probe work per confirmed pair).
- H4: two operands **at the `maxSyncTriangleCount = 12,000` ceiling** in deep overlap — the shipped
  worst case, and the fixture §14's worst-case span measurement must include.

For each: assert the query returns, assert `exhaustedBudget` is whichever cap the fixture is designed
to reach, and **record the wall-clock span as reported output** (not as a pass/fail assertion — a
timing assertion in a unit test would reintroduce exactly the machine-dependence being removed).

---

## 14. The pre-implementation calibration task

Bounded, and sequenced so it is actually executable.

### 14.0 The phased rollout that removes the dependency cycle

*(Added per §16, Critical finding 2.)* An earlier draft scheduled calibration as implementation task 1
while simultaneously forbidding the counter it must record — an unexecutable order: the implementer
would arrive at task 1 unable to measure anything, and would have to either violate the stated order
or estimate the numbers outside the production traversal, measuring something other than the code
under test. The finding is accepted; the resolution is an explicit three-phase sequence.

| Phase | Content | Behavior change | Gate to proceed |
|---|---|---|---|
| **A — behavior-neutral instrumentation** | Add `pointClassifications` + its non-binding 1,536 terminator; add `exhaustedBudget`; add fault-isolated `elapsedMs` / `timeBudgetExceeded` (§9.1a); add the normalized `stats` shape incl. the skip path (§5.2a); fold the fields into the existing `stage:'crossing'` event (§5.4). **The wall-clock semantic branches stay exactly as they are.** | **None.** Proven by test: full suite green **unmodified**, including the four tests that currently encode the defect as a contract — if any of them changes behavior, Phase A was not neutral. | Suite green with zero test edits |
| **B — calibration** | Run §14.1–14.4 against **the exact Phase-A commit**, recorded by SHA in the output document. | None — measurement only | Envelope measured and reported |
| **C — the correctness fix** | Delete both wall-clock semantic branches (`:84`'s time clause, `:131` entirely); re-express the tests (§13 G); add the new regressions (§13 B–D, H). | **The intended behavioral change** (§5.3) | Milestone-owner ratification of §7.2's classification **and** of the Phase-B envelope |

Why Phase A can be behavior-neutral while adding a terminator: the 1,536 cap is the structural
maximum (§4.3), so it can never fire on a traversal today's code would complete. That is precisely
what makes this sequence possible, and is a second, independent reason the cap must not be lower.

**Why the semantic removal is nonetheless deliberately *not* deferred indefinitely.** The review
offered "or state clearly why instrumentation and semantic removal must land together." They need not
land together — hence Phase A/C — but Phase C must not be left open-ended: **M4 stays blocked for its
entire duration**, and the defect is live in production `clearance` and `volume-overlap` results
throughout. Phase B is therefore bounded to the measurement below and nothing else.

### 14.1 Exact inputs

- **I1 — shipped fixtures.** Every operand pair reaching `properCrossingQuery` from the existing
  `node --test` suites: `test/query/ProperCrossingQuery.test.mjs`, `test/query/VolumeOverlapQuery*.test.mjs`,
  `test/query/ClearanceHardClashPrecheck.test.mjs`, and the three clearance `CollisionWorld` suites.
- **I2 — the real failing pair and its cohort.** `structure:3547/frag363 → architecture:3551/frag30`,
  plus `frag364 / frag413 / frag410 → arch frag30`, plus **the full 1319-candidate list** of
  `S2[k=100:typical:clearance]`, both arms, on the federated Audubon fixture.
- **I3 — pathological synthetic geometry.** H1–H4 from §13.

Each input is run with the wall-clock semantic branches **neutralized for the measurement only** —
via the existing `options.frameBudgetMs: Infinity` seam, which needs no code change and is already
used this way at `test/query/SurfaceIntersectionQuery.test.mjs:47`. This is what makes Phase B measure
Phase C's real spans while Phase A's code is still semantically unchanged.

### 14.2 What is recorded

**Per traversal:** `candidatePairsExamined`, `crossingPairsExamined`, `pointClassifications`,
`exhaustedBudget`, the **complete end-to-end span** of the `properCrossingQuery` call measured by real
`performance.now`, and the operands' triangle and component counts.

**Per configuration:** the runtime tier (below), cold/warm state, and the repetition index.

Recording uses the **existing** `setDiagnosticEventRecorder` seam plus Phase A's `stats` fields — no
new instrumentation mechanism and no library change beyond Phase A.

**Pre-registered runtime tiers** *(per §16, High finding 6 — an envelope measured on one machine is
not an envelope)*: at minimum (i) the M4 **representative multi-process** Chromium configuration,
which §6.1.5b already designates authoritative, and (ii) the historical `--single-process`
configuration the failing artifact was produced under, so the new numbers are comparable with the
investigation's. Each tier runs the same 5 counterbalanced repetitions the gate already uses, with
**cold first**, since cold-start and JIT effects are part of the tail being characterized.

### 14.3 Exact output

A tracked document, `docs/research/proper-crossing-query-deterministic-budget-calibration.md`,
recording **the Phase-A commit SHA it was measured against** *(§16, question 3)* and containing:

1. Per-input-class, per-tier distributions of all three counters: min / median / p95 / **max**.
2. Per-input-class, per-tier distributions of the **end-to-end traversal span**: median / p95 / **max**,
   with the raw set retained (§6.1.8's convention), never a median alone.
3. `M_legit` — the maximum `pointClassifications` observed over `I1 ∪ I2`, with the pair that produced
   it. **Reported to confirm `M_legit ≤ 1536`, not to derive a cap** (§4.3). If any legitimate input
   were to reach 1,536, that is a finding about the *existing* shipped envelope and must be escalated,
   not absorbed.
4. The **worst single observed synchronous span** across every input and tier — the headline number.
5. The count of traversals whose span exceeded 8 ms and 24.8 ms respectively, per tier.
6. The measured span attributable to a saturated 50,000-candidate tier-B scan (from I3/H1),
   reported on its own so §4.5's envelope question can be answered with evidence.

**No cap is derived by arithmetic.** There is no `C_p × K` formula, and none may be introduced: the
span is measured end to end, on real traversals, at the tail — not modelled from unit costs (§11.1).

### 14.4 Decision rule (what the numbers decide, and who decides it)

The only open question is the **span envelope**, and the rule is a disposition rule, not a
cap-selection rule:

Let `S_worst` = output item 4 on the authoritative tier, and `S_ceiling = 24.8 ms` (a
reference-hardware acceptance gate, not a hard cross-platform bound — §11.5).

1. **`S_worst ≤ 8 ms`** → CONFORMANT. Phase C proceeds; record the margin.
2. **`8 ms < S_worst ≤ 24.8 ms`** → CAUTION, matching M4 §7.1's own band. Phase C proceeds; the
   figure is recorded as an M4 input and cited in the release note.
3. **`S_worst > 24.8 ms`** → **stop and escalate to the milestone owner**, who chooses explicitly among:
   (a) accept the span and proceed — legitimate, since 24.8 ms is a conformance check and not a
   product target (M4 §7.1–7.2), and since correctness is not negotiable against it;
   (b) proceed and treat the figure as direct evidence for M4's worker-boundary question — the
   outcome M4 exists to produce;
   (c) authorize a **separately classified** reduction of the search envelope (§4.3 / §4.5), with its
   own acceptance criteria and compatibility classification.
   **The implementer must not choose.** Nothing in this list is "retune a constant quietly", and
   option (c) is never folded into the correctness fix.
4. In **every** branch, `maxCandidatePairsExamined`, `maxCrossingPairsExamined`, and
   `maxCrossingPointClassifications` keep the values §4 fixes. Calibration changes no constant.
5. Phase A's `maxCrossingPointClassifications = 1536` lands in `collision/constants.js` with a comment
   deriving it as `maxCrossingPairsExamined × 24` and citing this document — the same evidence
   discipline the file already applies to `maxLocalAspectRatio`.

### 14.5 What Phase B must NOT do

Remove the wall-clock semantic branches; change any semantics; change any constant; change
`frameBudgetMs`; change §6.4; touch the verdict reducer; or run Phase 4.

---

## 15. Independent architecture/correctness review

One independent `codex-review` (`architecture`, `medium`, request `20260911-015242-96571-906`, via the
running shared `codex-worker`) was run against this document, focused on the six required areas:
semantic determinism, deterministic budget correctness, containment interaction, M1–M3 compatibility,
telemetry vs. semantic separation, and no accidental workerization.

**Overall verdict returned: "requires major revision"** — endorsing the architectural direction
(*"wall-clock time must not affect geometric correctness, and the shared `ProperCrossingQuery` is the
right boundary"*) while rejecting the first draft's replacement-budget contract and calibration
sequence. Two Critical and five High findings were returned. **All seven are accepted and applied**;
the one Medium is accepted in the part this document owns. Dispositions follow.

---

## 16. Review findings and dispositions

| # | Sev | Finding | Disposition | Where applied |
|---|---|---|---|---|
| 1 | **Critical** | The new classification cap conflates correctness and performance: `maxCrossingPairsExamined = 64` already bounds classifications to 1,536, so a new cap adds no termination role **unless it is lower** — and lower means reducing geometric search completeness for inputs supported today, contradicting this design's own "completeness strictly improves" claim | **Accepted in full.** This was a real internal contradiction: §14.4's original rule permitted `min(K_max, 1536)`, i.e. a sub-1,536 cap. The cap is now **fixed at the structural maximum 1,536, non-binding by construction**, and any lower value is explicitly out of scope for this fix and reclassified as a separate search-completeness change | §4.3 (rewritten), §4.2 table, §4.4, §4.5 |
| 2 | **Critical** | Calibration has an implementation dependency cycle: it must record counters that implementation task 1 has not yet created, while §14.5 forbids implementing them | **Accepted in full.** Genuinely unexecutable as written. Resolved with an explicit **three-phase rollout** — A: behavior-neutral instrumentation (possible *only because* finding 1 makes the cap non-binding); B: calibrate against that exact commit SHA, with the wall clock neutralized for measurement via the existing `frameBudgetMs: Infinity` seam; C: the semantic removal | §14.0 (new), implementation tasks (rewritten) |
| 3 | High | Result schema incomplete on the aspect-ratio skip path: `VolumeOverlapQuery.js:110-117` synthesizes only two counters, so four new fields would read `undefined` | **Accepted.** Verified in source. One shared `stats` normalizer is now required, with the skip path's values specified explicitly — and `elapsedMs: null`, **not** `0`, so a fabricated zero-duration reading cannot pollute span distributions | §5.2a (new) |
| 4 | High | The callback-exception regression loses its injection seam: with clock reads moved to entry/exit, a throwing clock no longer throws *inside* `intersectsTriangles`, so the vendored-BVH `_active`-poisoning containment test becomes vacuous while still appearing to pass | **Accepted — the sharpest catch of the review.** Compounded by finding 7, which additionally makes the clock's throw swallowed. Resolved with an internal, test-only injectable point classifier so both tests (truthy and falsy throw) originate inside the callback, plus an assertion that the throw actually happened there. The less invasive vendor-boundary test is **rejected as the primary** — it would not exercise this file's own catch/return-true/rethrow code | §13 G (expanded), §9.1a |
| 5 | High | "No public API impact" understates behavioral compatibility risk: schema compatibility and behavioral compatibility are different contracts | **Accepted.** The heading was doing too much work. Now stated as **"no public schema change; intentional public behavioral change"**, with the consumer-visible consequences named and the two compatibility questions split | §5.3 (rewritten), Compatibility disposition |
| 6 | High | The cap formula does not establish the 24.8 ms ceiling: median `C_p` × count plus a scan cost from a *different* fixture ignores variance, cold/JIT/GC, node descent, and co-occurrence of high scan and high probe cost in one traversal | **Accepted.** The additive model is deleted outright. Calibration now measures **complete end-to-end traversal spans** at p95/max across **pre-registered runtime tiers**, cold first, with raw sets retained. Also resolves the review's question 2: 24.8 ms is fixed as a **reference-hardware acceptance gate**, grounded in M4 §7.1 (conformance check, not UX threshold) and §7.2 (no product-approved target exists) | §14.2–14.4 (rewritten), §11.1, §11.5 |
| 7 | High | Telemetry can still withhold a geometric result: an injected `now()` that throws, returns non-finite, or moves backward can fail the whole query after a crossing was already proven | **Accepted.** A real residual of the same defect class — an observational dependency controlling *availability* rather than *verdict*. Both telemetry reads are now fault-isolated, degrading to `{elapsedMs: null, timeBudgetExceeded: false}` while the geometric result always returns — reusing this codebase's existing `toFiniteWorldArray` degrade-to-null contract rather than inventing one. Failures stay visible via `null`, asserted by test | §9.1a (new), §5.2 |
| 8 | Medium | Diagnostic recorder ownership unsafe under failure/concurrency; retained projection keys two stages by one pair identity | **Accepted for the parts this document owns.** Premise verified: `run-gate-m4.mjs:1022-1024` clears all three recorders as **plain statements, not in a `finally`**. Now required: unconditional `finally` cleanup, a non-throwing projection callback (it runs inside library code via `reportDiagnosticEvent`, which has no guard), `(runId, pair, stage)` keying, and exclusive single-installer ownership. Cross-*query* concurrency is scoped out — the gate runs one measured query at a time by construction | §12.1 (expanded) |

**Review questions, answered in the document:** (1) a limit below 1,536 is **not** authorized here —
§4.3; (2) 24.8 ms is a **reference-hardware acceptance gate** — §11.5, §14.4; (3) yes, behavior-neutral
instrumentation lands first and calibration records the Phase-A commit SHA — §14.0, §14.3;
(4) the deferred `SurfaceIntersectionQuery` / `SurfaceCrossingWitness` fixes are **owned by the
collision-library milestone owner and due before the post-M4 implementation milestone** — §7.3.

**Nothing was rejected.** No finding was scope-expanding, preference-driven, or contradicted by
source; each was checked against the code before being applied.

---

# Final design report

## Adopted decisions

1. **Decision 1 — Normative semantic rule.** Wall-clock elapsed time must never directly determine
   the geometric semantic result of `properCrossingQuery` or of any predicate composed from it. A
   wall-clock breach may set `stats.timeBudgetExceeded` / `stats.elapsedMs` and nothing else. The
   complete truth table is §2.2: rows 1–4 and 7–8 are semantic; rows 5–6 are telemetry-only
   annotations that never change a cell of rows 1–4.

2. **Decision 2 — Continuation architecture.** Synchronous deterministic traversal, unchanged
   structure. **No resumable traversal, no worker, no vendored-`bvhcast` fork.** Proof of
   sufficiency: the existing counters already bound the traversal at ≤50,000 callbacks, ≤64 probed
   pairs, and ≤1,536 `classifyPoint` calls with no new code (§3.1). Responsiveness stays with the
   existing outer checkpoints at `VolumeOverlapQuery.js:171` / `:222` and the composed-stage
   scheduler; M4 measures whether the resulting atomic span is acceptable.

3. **Decision 3 — Deterministic replacement budget.** Work unit: **`classifyPoint` invocations made by
   the traversal**, counted as `pointClassifications`, alongside the two retained existing counters.
   A single weighted counter was rejected because its weights would be unmeasured and arbitrary.
   **The cap is `maxCrossingPointClassifications = 1536`** — exactly `maxCrossingPairsExamined × 24`,
   the structural maximum the shipped algorithm can already reach — so it is **non-binding by
   construction and can never censor a traversal today's code would complete**. `maxCandidatePairsExamined`
   (50,000) and `maxCrossingPairsExamined` (64) are unchanged. **No constant in the semantic path
   awaits measurement.** A cap below 1,536 would be a search-completeness reduction and is explicitly
   **out of scope**: a correctness fix for nondeterminism must not, in the same change, narrow the
   geometric search envelope.

4. **Decision 4 — Return/result contract.** `aborted` means *deterministic work budget exhausted*,
   and only that. Wall-clock breach never sets it. `conclusive` reflects geometric and
   deterministic-budget completion only, with **no formula change** at
   `VolumeOverlapQuery.js:296-301`. `stats` gains four additive fields
   (`pointClassifications`, `exhaustedBudget`, `elapsedMs`, `timeBudgetExceeded`), produced through
   **one shared normalizer used by the real query and the aspect-ratio skip path alike**, with
   `elapsedMs: null` (never a fabricated `0`) whenever no traversal was timed. Both telemetry clock
   reads are **fault-isolated**: a throwing, non-finite, or backward clock degrades to
   `{elapsedMs: null, timeBudgetExceeded: false}` and can never withhold an already-computed
   geometric result. Telemetry travels only on the existing opt-in `hard-clash-precheck` diagnostic
   event — **never** in `result.diagnostics`, which is §6.4-compared. Diagnostic strings
   (`crossing-budget-exhausted`, `inconclusive-crossing`) are unchanged. **No public schema change:**
   neither query is exported from `collision/index.js`, and `stats` never reaches a public result.

5. **Decision 5 — Fix scope.** Fix the shared `ProperCrossingQuery` once; no clearance-only
   workaround. Both callers benefit. The Protected Invariant at `CollisionWorld.js:2430-2432` is not
   edited byte-wise; the shared dependency's behavior changes, classified as a **bug fix preserving
   intended semantics**, subject to milestone-owner ratification, a `CHANGELOG` entry, and an M1–M3
   re-baseline. `SurfaceIntersectionQuery` and `SurfaceCrossingWitness` carry the same defect class in
   *other* modes, are **not** in the composed `volumeOverlapQuery` predicate, and are **knowingly
   deferred with a tracked follow-up** (§7.3).

6. **Decision 6 — Regression expectation vs. normative constant.** `347` is a fixture-version-pinned
   regression expectation only. It must never enter `collision/constants.js` or any acceptance
   threshold. The normative contract is the four properties in §10: identical inputs ⇒ identical
   semantic outcome; TLAS and linear agree; repeated runs agree; budget exhaustion is reproducible.

## Proposed semantic truth table

| Condition | Semantic result | Wall clock's role |
|---|---|---|
| Crossing proven | `crossing:true, aborted:false, conclusive:true`, witness present | none — may set `timeBudgetExceeded` |
| Completed, no crossing, no boundary probe | `crossing:false, aborted:false, inconclusive:false` — clean negative | none — may set `timeBudgetExceeded` |
| Completed, no crossing, boundary probe seen | `inconclusive:true`, `inconclusive-crossing` | none — may set `timeBudgetExceeded` |
| Deterministic bound exhausted | `aborted:true, crossing:false`, `crossing-budget-exhausted`, `exhaustedBudget` names the cap | none — may set `timeBudgetExceeded` |
| Wall clock crossed, traversal continues | *no semantic effect whatsoever* | sets `timeBudgetExceeded`, `elapsedMs` |
| Wall clock crossed, crossing later proven | `crossing:true, conclusive:true` — the real failing pair, fixed | sets `timeBudgetExceeded`, `elapsedMs` |
| Unsupported geometry (aspect ratio) | query never called; synthetic `inconclusive` with the aspect-ratio diagnostic | none |

## Deterministic budget definition

**Work unit:** one `classifyPoint` invocation made by the traversal (`ProperCrossingQuery.js:138`
and `:143`) — the dominant cost tier, deterministic, cheap to count, reset per traversal, and testable
without a fake clock.

**Counter:** `pointClassifications`, reported in `stats`, terminating the traversal via the existing
abort protocol when it would exceed `maxCrossingPointClassifications`.

**Cap selection: arithmetic, not judgement, and not measurement.**
`maxCrossingPointClassifications = maxCrossingPairsExamined × (2 signs × 2 signs × 3 ladder rungs × 2
operands) = 64 × 24 = 1536` — the structural maximum the nested probe loop can already reach today.
It is therefore **non-binding by construction**: it terminates only a traversal that has escaped the
loop bounds that were supposed to hold, making an emergent invariant into a checked one, and it
cannot censor any input the shipped algorithm supports. `maxCandidatePairsExamined = 50,000` and
`maxCrossingPairsExamined = 64` are unchanged.

**What calibration decides is an envelope, not a cap.** §14 measures the real worst-case synchronous
span of a traversal no longer cut short at 8 ms — end to end, at p95 and max, across pre-registered
runtime tiers, cold first — and dispositions it against the 24.8 ms reference-hardware gate under
§14.4's escalation rule. It changes no constant.

## Compatibility disposition

**Bug fix, not a contract change — but with an intentional, consumer-visible behavioral change** —
requiring milestone-owner ratification. The two compatibility questions are stated separately,
because conflating them is itself a review finding (§16 #5).

**(a) Schema compatibility — unchanged.** `properCrossingQuery` / `volumeOverlapQuery` are not on the
public surface, `stats` never reaches a public result, and no public field is added, removed,
renamed, or retyped.

**(b) Behavioral compatibility — intentionally changed, in the direction of completeness.** Public
results move: `clearanceHardClashExclusions` rises to its deterministic value, false
`clearance-hard-clash-precheck-inconclusive` diagnostics disappear, and `volume-overlap` mode emits
fewer false `crossing-budget-exhausted` entries while detecting overlaps it previously suppressed. A
consumer relying on stable pair counts, stable statistics, or on the absence of a pair being
meaningful **will see different output**. That every one of those values was previously
nondeterministic is why the change is *sound* — it is not a reason it is invisible.

- The Protected-Invariant call site is not edited; its shared dependency's behavior changes. Grounds
  for the "bug fix" classification: the declared semantics of `volume-overlap` were always geometric;
  `crossing-budget-exhausted` is a declared truncation diagnostic meaning *"we do not know"*; and the
  repository already names this mechanism a defect in tracked code (`CollisionWorld.js:2422-2432`).
- **Search completeness is not reduced anywhere.** Every deterministic budget keeps or exceeds its
  shipped envelope (`maxCrossingPointClassifications = 1536` is the structural maximum;
  `maxCandidatePairsExamined` and `maxCrossingPairsExamined` are untouched). This is what keeps the
  change classifiable as a pure bug fix.
- **A future budget retune is a separate, differently-classified change.** Should §14's envelope
  prove unacceptable and the milestone owner elect §14.4 option (c), that reduction of the search
  envelope needs its own acceptance criteria, its own compatibility classification (a genuine
  contract change, not a bug fix), and its own release note. It must never ride along with this fix.
- Required alongside this fix: a `CHANGELOG` / release-note entry describing the behavioral change in
  consumer terms, an M1–M3 semantic re-baseline (timing values may move, correctness contracts may
  not), and re-expression of the four tests that currently encode the defect as a contract.
- §6.4 is unchanged and becomes vacuous; the compensating control is a zero-`TIME_BUDGET_DIAGNOSTIC_DIVERGENCE`
  expectation on post-fix runs, with narrowing/deleting the carve-out left as a separate spec decision.

## Required implementation tasks

High-level only, in the three phases §14.0 fixes. The phase boundaries are load-bearing: they are
what make the calibration executable at all.

**Phase A — behavior-neutral instrumentation** (no semantic change; suite must pass with **zero** test
edits, which is the proof of neutrality)

1. **`constants.js`** — add `maxCrossingPointClassifications = 1536`, commented as
   `maxCrossingPairsExamined × 24` and citing this design.
2. **`ProperCrossingQuery`** — add the `pointClassifications` counter and its non-binding cap check;
   add `exhaustedBudget`; add fault-isolated entry/exit `elapsedMs` and derived `timeBudgetExceeded`
   per §9.1a. **Leave both wall-clock semantic branches exactly as they are.**
3. **Shared `stats` normalizer** — one factory used by the real query *and* by
   `VolumeOverlapQuery`'s aspect-ratio skip branch, with §5.2a's explicit skip values.
4. **`VolumeOverlapQuery`** — fold the new fields into the existing `stage:'crossing'` diagnostic
   event (§5.4). No change to `conclusive` or `inconclusiveCauses`.
5. **Harness evidence retention** (§12.1, item G1) — bounded, `(runId, pair, stage)`-keyed retention
   in `run-gate-m4.mjs`, with `finally` cleanup and a non-throwing projection callback. Harness-only;
   no `collision/` change; not read by the comparator or the verdict reducer.

**Phase B — calibration** (§14; measurement only, against Phase A's exact commit SHA)

6. Run §14.1's inputs across §14.2's tiers with `frameBudgetMs: Infinity` supplied for measurement;
   publish `docs/research/proper-crossing-query-deterministic-budget-calibration.md`; apply §14.4's
   disposition rule. **No constant changes.**

**Phase C — the correctness fix** (gated on §7.2's classification and §14.4's disposition being
ratified by the milestone owner)

7. **`ProperCrossingQuery`** — delete the time clause at `:84` and the whole probe-loop check at
   `:131`. `:166`'s `aborted ? false : crossing` **stays** — it is correct once `aborted` is
   deterministic.
8. **Test re-expression** — the four tests in §13 G that encode the defect as a contract. Each must
   fail against the pre-fix implementation before it passes against the fix. The two
   callback-exception tests must be re-anchored to the internal injectable-classifier seam so their
   throw still originates inside `intersectsTriangles`.
9. **New deterministic regression tests** — matrix items B, C (including §9.1a's clock-fault cases),
   D1–D3, H1–H4, plus item A's committed synthetic backstop.
10. **Re-baseline** M1/M2/M3 gates; add the `CHANGELOG` / release-note entry (§5.3(b)).

Item G2 is explicitly excluded. No worker work, no resumable traversal, no `frameBudgetMs` retune, no
constant retune, no §6.4 edit, no verdict-reducer change.

## M4 restart sequence

1. Implement the deterministic correctness fix.
2. Focused regressions (matrix A–D, G, H).
3. `S2 k=100` TLAS/linear parity (matrix E), N ≥ 10 clean runs.
4. Same-arm repeat stability (matrix F), N ≥ 10 per arm.
5. Full Phase 3 canonical matrix.
6. VALID §6.4 checkpoint.
7. Only then evaluate Phase 4 authorization.

## Readiness — and precisely what is blocked

All six required architecture decisions are resolved, every Critical and High review finding is
applied, and **no numeric constant is left for an implementer to invent**: the cap is arithmetic
(`64 × 24 = 1536`), the other two budgets are unchanged, and Phase A is fully specified and
implementable today.

What is *not* yet in hand is the **span envelope** — the real worst-case synchronous cost of a
traversal that is no longer cut short at 8 ms — which §14's Phase B must measure before Phase C, the
semantic removal, may be authorized, and whose §14.4 disposition can legitimately escalate to the
milestone owner. That measurement is a bounded budget-calibration task on this design's critical
path, so the statement below is `BLOCKED_ON_BUDGET_CALIBRATION` rather than
`READY_FOR_IMPLEMENTATION_PLANNING`.

It is **not** `BLOCKED_ON_ARCHITECTURE_DECISION`: nothing structural remains open. The block is
evidentiary, and Phase A can begin the moment the milestone owner ratifies §7.2's compatibility
classification.

---

BLOCKED_ON_BUDGET_CALIBRATION
