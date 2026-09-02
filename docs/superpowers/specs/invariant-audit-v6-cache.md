# Invariant-driven consistency audit v6 — CACHE OWNERSHIP

Type: per-system invariant audit, one of five parallel system audits comprising `invariant-audit-v6.md`.
System boundary (same as v5's cache-ownership auditor): `GeometryRegistry`'s `CollisionInstance` identity
cache, `maxCollisionInstancesPerEpoch`, `PlacedCollisionInstance`, `evictModel`/`dispose()`'s release-path
sweeps, `releaseEpochScopedState`.

Input: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`, read **in full and
sequentially, all 4431 lines**, post-Round-22. Reference baseline:
`docs/superpowers/specs/invariant-audit-v6-model.md`. Severity bar per `invariant-audit-v5.md`: Critical =
unsatisfiable **by construction**; High = a real contradiction or unsound claim; Medium/Low =
wording/completeness gaps.

**Method note — Round 22's edits were isolated mechanically, not inferred.** Round 22 is uncommitted, so
`git diff` against `9c6a846` (the Round-21 commit) yields exactly its edit set: **7 hunks, 119 insertions,
33 deletions**, at lines 732, 1278, 1797, 1884, 1925, 4181, 4221. **No hunk falls inside any
cache-ownership region.** Every NEW/PRE-EXISTING classification below rests on that diff, not on the
Round-22 disposition doc's own claims.

**Line-numbering note for the coordinating session and the other four auditors.**
`invariant-audit-v6-model.md` was built against a **4429-line** file; the file is now **4431 lines**. The
2-line delta is Round 22's hunk at 1797. **Every line ≥ 1799 in the model is +2 in the current file**
(model's sweep row 1856 → 1858; model's exclusion 1961–1972 → 1963–1974; model's gate criterion 1
4179–4190 → 4181–4192). All citations below are **current-file** numbers.

---

# Critical

**None.** All cache-ownership-adjacent Critical invariants re-read directly against current text and
confirmed intact:

| Protected invariant | Cache-side manifestation | Verified at |
|---|---|---|
| Model-object identity / `loadEpoch` | cache is `Map<loadEpoch, Map<fragmentId, CollisionInstance>>`, **never** `modelId`; epoch disjointness is structural | 1219, 1223, 3143–3146 |
| disposed-first checkpoint semantics | `evictModel` returns before touching any bucket on a disposed world; `dispose()` clears every bucket | 2903, 3018–3020, 3214–3216 |
| geometry ownership / release-path completeness | cache release is an operation **of its own**, not derived from a `GeometryRegistry` scan | 1218–1228, 2914–2918 |

**Round 21's redesign text is present and internally consistent — the two v5 items it closed stay
closed.**

- **H-5C1 / H-G1** (cache release was subordinate to `GeometryRegistry`'s sweep, leaking the superset
  keyspace) — closed. The independence claim is stated at **all four** sites that describe a release path,
  with no site reverting to the subordinate framing: 1218–1228 (cache declaration: "as an operation of
  their own … **not** derived from a `GeometryRegistry` scan, a geometry reference count, a numeric
  `modelId`, or `liveModelByModelId`"), 2914–2918 (`evictModel`: "as an independent operation over a
  different keyspace (not derived from this GeometryRegistry sweep …)"), 3018–3020 and 3214–3216
  (`dispose()`, both sites now enumerate the cache explicitly). The superset relation is stated
  identically in both places it appears (1226–1228, 2915–2917).
- **H-5C2 / A2** (cross-call mutable instance breaking the per-call snapshot guarantee) — closed
  **structurally**, and the two sides agree verbatim in shape: the cache's own statement (1208–1216) and
  the Broad-phase statement (2728–2735) both say placement state is per-call and call-owned and that the
  canonical instance "carries no transform state at all". `CollisionWorld`'s facade line was updated to
  match (2377–2379: the scan is over `PlacedCollisionInstance.worldBounds`). Pinned by fixtures 4014–4022
  (stale eviction: same canonical references) and 4023–4031 (two interleaved calls, transform mutated
  between them).

No reading of any cache-ownership passage is unsatisfiable by construction. The one High below is
unsatisfiable **as written under one of two available readings** — the same bar on which v5 adjudicated
A2/H-5C2 down from Critical.

---

# High — 1 finding

## H-6C1 — `maxCollisionInstancesPerEpoch`'s capacity check is specified at three mutually exclusive granularities; Data Flow step 3's ordering contradicts the call-level atomic-admission contract and the fixture that pins it, and lets a rejecting call permanently mutate the cache

**Classification: (b) PRE-EXISTING, newly surfaced — NOT caused by Round 22.** `git diff` confirms Round
22 touched none of the four sites. This text was written by `invariant-audit-v5.md`'s own **Remediation**
section, i.e. *after* v5's five auditors had already reported; **v6 is the first five-system audit pass to
read it.** The v6 model recorded it as `[AMBIGUOUS]` (Appendix #27) without severity; this audit
adjudicates it.

### The four statements

| # | Site | What it says |
|---|---|---|
| A | Cache declaration, **1232–1236** | "**After collecting a call's complete unique fragment-id set**, but **before constructing or publishing any missing instance**, `findClashes` checks `currentBucketSize + uniqueMissingCount` … exceeding it **rejects the entire call before any bucket changes or broad-/narrow-phase work starts**. Otherwise all missing instances are committed **without an intervening `await`**." |
| B | Atomic-operations table row, **1859** | "Rejects the whole `findClashes` call, before any cache bucket changes or broad-/narrow-phase work starts … — **checked once per call, synchronously, with no intervening `await` between the check and committing every missing instance, so two concurrent calls cannot both pass against the same stale capacity observation.**" |
| C | Data Flow step 3, **2681–2688** | "For each fragment **this walk** collected …, look up or create the epoch's canonical `CollisionInstance` …, **then build a fresh, call-local `PlacedCollisionInstance`** … **Before publishing any newly-created instance**, check the affected epoch's `maxCollisionInstancesPerEpoch` capacity …; exceeding it **rejects the call before this step's cache/placement construction completes**." |
| D | Fixture, **4032–4037** | "the entire call must reject before any bucket changes or broad-/narrow-phase work starts (asserted via a spy: **no `PlacedCollisionInstance` is constructed for any fragment in the query**)." |

### The defects that follow

*(This sub-section was revised after the `codex-advisor` consult recorded at the end of this document,
which confirmed High but corrected one of my sub-claims and supplied a fourth defect I had missed. The
corrections are marked.)*

**(i) C prescribes an operation order that conflicts with A/B and with fixture D.** C's sequence is
explicit: look up **or create** the canonical instance → **then** build the `PlacedCollisionInstance` →
**then** check capacity. A/B both put the check strictly *ahead* of any construction. C's closing clause
("rejects the call **before this step's cache/placement construction completes**") then *permits*
placements to exist at rejection time, which fixture D forbids outright — its spy asserts **zero**
`PlacedCollisionInstance` constructions for **any** fragment in the query.

*Correction from the consult:* I originally called this an outright logical contradiction. It is slightly
weaker than that — "before construction *completes*" permits partial construction without strictly
requiring it, and A's more precise rule sitting elsewhere lets C be read loosely. **The load-bearing
conflict is C's prescribed sequence order, not that one clause.** The defect stands; the phrasing of it
was overstated.

**(ii) C is scoped by a per-dbId loop, which contradicts B's "checked once per call" and permits partial
cache mutation before a later rejection.** Indentation was checked directly: 2681–2688 is a 5-space
continuation paragraph of the `- **Extraction**` bullet (3-space `- `, content at 5), not a new bullet —
the next bullet, `- **Broad phase**`, begins at 2689. That Extraction bullet's own scope is stated in its
opening clause (**2561–2564**): "**for each requested dbId (source, then every target dbId)**, before
beginning that dbId's own extraction, check the accumulated `frameBudgetMs` accumulator … and **yield if
due**." C's "this walk" is likewise singular — one dbId's walk. So the literal reading puts the capacity
check **once per requested dbId**, inside a loop with a documented `frameBudgetMs` yield before each dbId
(2561–2564) and a further one between sibling nodes (2646–2648). A room-locator query passes
`dbIds: roomDbIds` (2546–2548), i.e. many target dbIds per call, so this is the ordinary case, not an edge
case.

What that actually breaks:
- **B's "checked once per call"** — flatly false under C; it is checked once per dbId.
- **A's and B's "rejects the entire call before any bucket changes"** — false under C: a call can commit
  the instances missing for dbIds 1…*n*, yield, and then reject on dbId *n+1*, **leaving the epoch's
  bucket permanently mutated by a call that rejected.** Since entries "are never individually evicted
  while their epoch remains live" (1236–1239), that mutation is unreclaimable for the life of the epoch.

*Correction from the consult:* I originally claimed the per-dbId reading also lets **two concurrent calls
both pass against a stale capacity observation and overrun the ceiling**. That is wrong, and I am
recording it as wrong rather than quietly dropping it: JavaScript's single-threaded serialization means
each *local* check-and-commit that itself contains no `await` is atomic, so no commit ever observes a
stale count — even per-dbId. **The real defect is partial mutation on a rejecting call, not ceiling
overrun.** B's concurrency-safety consequence survives; B's "once per call" and A/B's "before any bucket
changes" do not.

**(iii) `uniqueMissingCount` has no stated recompute point — a defect present under reading A too.**
*(Supplied by the consult; I had missed it.)* The extraction walk yields (2561–2564, 2646–2648), and A
computes `currentBucketSize + uniqueMissingCount` from "a call's complete unique fragment-id set". A
concurrent call can commit overlapping fragment ids during any of those yields, so a missing-count derived
from observations accumulated *during* the walks is stale by the time the check runs — it can over-count
missing instances and reject a call that would in fact fit. A must say the missing set is recomputed
against the **current** bucket after the final extraction yield, immediately before the atomic
check-and-commit. It does not.

**(iv) A minor wording feature makes reading C plausible rather than obviously wrong.** B and A say
"**any**/**every** affected epoch", presupposing more than one epoch per call — but `findClashes`
requires `source.model === target.model` (2558–2559, 2805), so **exactly one** epoch is ever affected in
Milestone 1. Not a correctness issue (the consult agrees a singular rewording is precision, not
required), but it is what lets C's per-fragment / per-dbId phrasing read as consistent with A and B rather
than as the conflict it is.

### Severity adjudication

**High, not Critical.** A's ordering is straightforwardly implementable (collect the whole call's unique
fragment-id set across all requested dbIds, run one check, then construct), and satisfies A, B and D
simultaneously. So the contract is unsatisfiable **as written under reading C**, not unsatisfiable **by
construction** — precisely the distinction on which v5 adjudicated A2/H-5C2 and H-G1 down from Critical.
The consult reached the same verdict independently.

**Not Medium.** A Medium rating would be defensible only by treating A as authoritative and C as
non-normative summary prose — which is hard to sustain, since C sits in the **Data Flow** section and
prescribes operation order, and D's spy discriminates between the two readings. The concrete harm is a
mechanism failure, not a phrasing one: a rejecting call can leave the epoch's bucket permanently mutated,
which A, B and D each separately say cannot happen.

Consult's recommended formulation, adopted:

> The normative Data Flow ordering permits per-dbId construction and capacity admission, contradicting the
> explicit call-level atomic admission contract in A/B and the zero-placement rejection fixture in D. It
> can cause partial cache mutation before a later capacity rejection, although it does not inherently
> allow the bucket to exceed capacity.

### Fix direction (rewrite C only; A needs one added clause)

Restate 2681–2688 as an explicit four-phase step, lifted out of the per-dbId loop:

1. Complete **every** requested dbId's extraction walk, collecting the call-wide unique fragment-id set
   and the raw `worldMatrix`/`worldBounds` snapshots.
2. **After the final possible yield**, recompute the missing ids against the epoch bucket's *current*
   contents.
3. Synchronously check capacity and commit all missing canonical instances, with no intervening `await`.
4. **Only after admission succeeds**, construct every call-local `PlacedCollisionInstance`.

B needs no change. **A needs step 2's recompute point stated** (defect (iii)) — as written it implies the
missing count may be carried over from during the walks. Rewording "any/every affected epoch" to singular
would improve Milestone-1 precision but is not required for correctness.

Two implementation ambiguities the consult flagged, worth closing in the same edit: whether "**create**"
in C means constructing the frozen object or merely staging an id, and an explicit statement that the
check-and-commit section performs only internal map/object operations — no external callbacks or
caller-supplied getters — since synchronous reentrancy inside it would weaken the atomicity B claims.

---

# Medium

Numbered `M-6C*`. **M-6C3 through M-6C5 are already-known items carried forward** and are recorded only
to confirm their state; they are not re-litigated.

**M-6C1 (NEW to this lineage; pre-existing rel. Round 22).** `ViewerModelAdapter`'s own contract heading
(**1025–1026**) still says the component "turns a `(model, dbId)` into the raw ingredients for a
`CollisionInstance`", and two of its four bullets are "World matrix: `fragList.getWorldMatrix(...)`" and
"World bounds: `fragList.getWorldBounds(...)`" (**1078–1080**) — while **1200–1201** states a
`CollisionInstance` "contains no `Model`, `GeometryRecord`, BLAS, **world matrix, world bounds**, or other
call-varying or mutable state". Round-21 redesign residue: the adapter's heading names as `CollisionInstance`
ingredients two fields the object is now defined never to hold. Nothing depends on it — extraction routes
both to the call-local placement at 2684–2686 — so this is a heading/summary staleness, not a mechanism
conflict. Suggested: "…the raw ingredients for a `CollisionInstance` **and its call-local
`PlacedCollisionInstance`**".

**M-6C2 (NEW to this lineage; pre-existing rel. Round 22).** The heading "**Retention is explicitly
bounded**" (**1230**) overstates what the mechanism bounds. The body is precise — "limits the number of
canonical instances retained for **one live epoch**" (1231–1232) — but the design explicitly supports
multiple simultaneously-live epochs (3079–3083, 3547–3555: two objects sharing a reused `modelId` both
live is "a state round 14's own epoch-keying fix made supported and tested"), and nothing ceilings the
number of live epochs. Total retained instance count is therefore
`maxCollisionInstancesPerEpoch × (live epochs)`, unbounded — the same shape as the sweep row's own honest
admission that entry count per epoch "nothing in this design ceilings" (1858). Gate criterion 10
(**4259–4268**) measures "retained size, **per epoch**" only, so the gate will not surface it either. The
row at 1859 already hedges one axis ("bounds worst-case retained *count*, not retained *bytes*"); the
per-epoch-vs-global axis is unhedged.

**M-6C3 (PRE-EXISTING, in v5's Medium list — confirmed unchanged, and confirmed NOT worsened by Round
22).** The sweep row's cost model (**1858**) still describes only the `GeometryRegistry` half:
"enumerating every `GeometryRegistry` entry filed under one epoch … cost scales with the number of live
entries under that epoch". Since Round 21, `releaseEpochScopedState` performs a **second, independent**
deletion over the `CollisionInstance` cache's own keyspace — explicitly "a strict superset of the
registry's lazily-built candidate-pair keyspace" (1226–1228, 2915–2917) — which the row does not account
for. Round 22's rewritten exclusion paragraph inherits the same framing ("one epoch accumulates a
pathological number of live **`GeometryRegistry`** entries", 1970–1972). **`git diff` confirms that
sentence is unchanged context, not Round-22-authored** — Round 22 rewrote only the framing sentence above
it. Stays Medium rather than High because the second operation is plausibly O(1) given the cache's stated
physical partitioning (`Map<loadEpoch, Map<fragmentId, …>>`, 1219 — one outer-`Map` delete for
`evictModel`, one clear for `dispose()`); the text nowhere says so, which is the actual gap.

**M-6C4 (PRE-EXISTING, recorded in v5 as a lifecycle Medium — cross-referenced here).** The sweep row
(**1858**) states the non-throwing requirement for "`releaseEpochScopedState`'s (**and `dispose()`'s
equivalent**) per-epoch registry sweep" and cites `world.evictModel` for it. At that target the
requirement is stated only for `releaseEpochScopedState` (**2939–2944**: "This step must be
non-throwing"); `world.dispose()`'s own contract (**3002–3038**) states no non-throwing requirement at
all. So the table row asserts a requirement covering `dispose()`'s clear and cites a passage that does not
make it for `dispose()`. Unchanged by Round 22.

**M-6C5 (PRE-EXISTING; the current form of v4/v5's "wholesale-clears three caches" Medium).**
`dispose()`'s clear now enumerates **four** caches at both sites but still closes with the singular "the
entire cache, in one operation" (**3020**) / "the entire cache" (**3216**) — a singular referent after a
four-item list. Unchanged by Round 22.

---

# Low

- **L-6C1 (Round-22-authored).** Gate criterion 1 mixes vocabulary: it establishes "the **corrected
  worst-case-span bound**" and then calls one measurement "above the **band**" (**4189**) while the
  parallel clause one line later says "above the **corrected bound**" (**4190**). "Band" is the
  pre-Round-22 term. Cosmetic; noted because it is inside Round 22's own new text and sits in this
  auditor's territory (the sweep's exclusion clause is the sentence it governs).
- **L-6C2.** `maxCollisionInstancesPerEpoch`'s rejection has **no `Error Handling & Edge Cases` bullet at
  all**. That section covers each sibling call-level rejection — `maxFragmentsPerDbId` (**3419**),
  `maxChildrenPerNode` (**3429**), `maxBroadPhaseInstancePairs` (**3448**) — and this is the only one
  missing. It also carries no named error class, the same `[SILENT]` its three siblings carry (v6 model
  Appendix #6), but the absent Edge-Cases entry is a step sharper than that shared gap.
- **L-6C3.** The cache section is repeatedly cross-referenced as the "`CollisionInstance` identity cache"
  *under* `GeometryRegistry` (2379, 2683, 2730, 2918, 3019, 3216, 4262; the table row at 1859 says "see
  **`GeometryRegistry`**"), though it is a sibling top-level **Components** entry sitting between
  `GeometryRegistry`/`GeometryIdentity` (1173–1192) and `ThreeMeshBvhBackend` (1241), not a subsection of
  it. Consistent everywhere, so harmless; noted only because it is uniform enough to look deliberate.

---

# Explicit re-verification the task required

## (a) Is `releaseEpochScopedState`/`dispose()`'s sweep still described identically everywhere? — **Yes. No drift.**

| Site | Names both paths | No ceiling | Non-preemptible | Non-throwing | Excluded from the span guarantee |
|---|---|---|---|---|---|
| Atomic-ops table row, **1858** | "`releaseEpochScopedState`'s (and `dispose()`'s equivalent) per-epoch registry sweep" | "— (no ceiling; accepted atomic risk)" | "**Non-preemptible**, same category as one `enumNodeFragments` call and the three `maxSyncTriangleCount` phases" | "required to be non-throwing (see `world.evictModel`), **not preemptible**" | gate must measure it "rather than assumed negligible" |
| Worst-case-span exclusion, **1963–1974** (framing rewritten by R22) | "`releaseEpochScopedState`/`dispose()`'s own per-epoch registry sweep" | "rows with **no ceiling at all**"; "this spec **claims no bound**" | inherited from the row it cites | not restated | "**explicitly excluded from the formula above and from any finite worst-case-span guarantee this spec makes**" |
| Gate criterion 1, **4181–4192** (rewritten by R22) | same phrasing, verbatim | — | — | — | "**except the two synchronous spans this spec explicitly excludes** … a measurement above the band is a **required recorded finding, not a gate failure**" |
| Gate criterion 9, **4250–4258** | same phrasing, verbatim | "second **accepted non-preemptible atomic risk**" | yes | — | measured from **both** `evictModel` and `dispose()` |

**The exclusion's scope is byte-identical carryover, verified mechanically.** In the diff, the sentence
naming the two ceiling-less risks ("one non-recursive `enumNodeFragments(node, cb, false)` call, and
`releaseEpochScopedState`/`dispose()`'s own per-epoch registry sweep") appears as an **unchanged context
line**; Round 22 rewrote only the framing sentence above it ("**This corrected formula is still not a
finite worst-case-span guarantee for the whole design, and Round 22 does not claim it is one**"). The
exception clause in gate criterion 1 is likewise carried over verbatim from the pre-Round-22 criterion —
only "`frameBudgetMs`'s tolerance band around ~16ms" → "the corrected worst-case-span bound … ≈24ms"
changed around it, plus one of the two "above the band" occurrences (see L-6C1).

**Conclusion: the two ceiling-less accepted atomic risks are named identically, scoped identically, and
excluded identically at all four sites after Round 22.** Round 22's rewrite of two of those four sites did
not widen, narrow, or invent an exception. The only residual imprecision shared across them is M-6C3
(cost model names only the `GeometryRegistry` half), which predates Round 22.

## (b) Are the `CollisionInstance` cache's structural guarantees unaffected and unchanged? — **Yes, confirmed rather than assumed.**

Confirmed two ways: `git diff` (no hunk in any cache region) **and** direct re-read of every occurrence
(`grep` over `CollisionInstance`, `PlacedCollisionInstance`, `maxCollisionInstancesPerEpoch`,
`releaseEpochScopedState` — 60 sites, all read).

| Guarantee | Stated at | State |
|---|---|---|
| frozen, transform-free identity object (`fragmentId` + immutable `GeometryIdentity`; "both the instance and its nested identity value are frozen after construction"; "contains no `Model`, `GeometryRecord`, BLAS, world matrix, world bounds…") | 1194–1206 | unchanged |
| stable object references across calls ("the **same object reference** for a given fragment"; "remains strongly resident for its admitted epoch, so reference identity is stable across calls"; "no `findClashes` call ever writes through a cached `CollisionInstance`") | 1196–1206, 1219–1220 | unchanged; pinned by 4014–4022, 4023–4031 |
| `PlacedCollisionInstance` never cached, never mutated; call-owned; unchanged across yields | 1208–1216, 2377–2379, 2684–2686, 2728–2735 | unchanged |
| `maxCollisionInstancesPerEpoch` capacity check | 1230–1239, 1859, 2686–2688, 4032–4037, 4259–4268 | unchanged **but internally inconsistent — see H-6C1** |

**No stale pre-redesign wording survives anywhere** — no passage anywhere in 4431 lines describes a
`CollisionInstance` as carrying a transform, or as released via a `GeometryRegistry` scan. The single
residue is M-6C1's adapter heading.

---

# NEW vs PRE-EXISTING vs unchanged — the explicit split

**(a) NEW findings caused by Round 22's edits: none.** Round 22's 7 hunks touch the changelog, the
`ThreeMeshBvhBackend` per-phase-checkpoint claim, `bvhcast`'s clock-basis parenthetical, the three
composition-tier bullets, the span formula, and two performance-gate sentences. None is in this system.
The only Round-22-authored item in this report is **L-6C1** (a one-word vocabulary residue inside the
sentence that governs the sweep's gate exclusion).

**(b) PRE-EXISTING findings newly surfaced by this read, unrelated to Round 22:** **H-6C1**, **M-6C1**,
**M-6C2**, **L-6C2**, **L-6C3**. All five live in text authored by the Round-21 remediation that
`invariant-audit-v5.md`'s own Remediation section applied **after** its five auditors reported — text no
five-system audit had read until now. That is the structural reason a High surfaced in a system Round 22
did not touch, and it is worth recording for the lineage: **a remediation applied after an audit round's
auditors report is unaudited text until the next round.**

**(c) Confirmation that prior known items are unchanged:**
- **Residual C-5 site (3217–3224)** — "the clear rejects **each entry's cancellation signal** as it drops
  the entry", universally quantified over dropped entries in a clear that also drops oversized markings.
  Present, and **byte-identical**: no diff hunk touches it. Known Round-20 wording Medium, deliberately
  preserved by instruction; not re-litigated.
- **The v5 cache/geometry Medium set (M-1/M-G1 … M-G8, M5's M-1 … M-12)** — the ones inside this system
  boundary are unchanged: the sweep cost-model re-scoping (M-6C3 above), `dispose()`'s
  "wholesale-clears N caches" numeric staleness (M-6C5), `referenceCount` still dead (named once at 1176,
  and only at 1223 to say the cache release is **not** derived from one).
- **Two v6-model findings are already CLOSED in the current file and should not be re-reported by the
  other four auditors.** The model records both as open, but the file has moved since it was built
  (4429 → 4431 lines):
  - model Appendix **#17** — 1797–1798's "the performance gate's own **~16ms** tolerance band" now reads
    "the performance gate's own tolerance band (**Round 22: ≈24ms** — `frameBudgetMs` plus one
    non-preemptible/abort-only unit's own worst case…)" (**1797–1800**);
  - model Appendix **#19** — gate criterion 6's "says nothing about the **~16ms** criterion" now reads
    "says nothing about the **tolerance criterion above**" (**4221–4222**).
  Both are Round 22's edit #5, applied after the model build. Model Appendix **#20** (1857, 2699 —
  "~60× the gate's own ~16ms") **does** survive, deliberately, as Round-18 historical narration.

---

# Second opinion — `codex-advisor`, request `20260903-000019-26508-12379`

Consulted on **H-6C1's severity adjudication**, deliberately framed to invite *lowering* the finding ("Be
willing to tell me the finding is weaker than I claim") and to attack its two load-bearing sub-claims: the
markdown-nesting read of passage C, and whether C could legitimately be read as running after all dbIds'
walks. The native `advisor` tool was **not** used, per the standing repository preference. Full response
at `.codex-worker/responses/20260903-000019-26508-12379/response.md`.

**Verdict: keep High, narrow the rationale.** Not Critical, for the reason I gave. Not Medium — a Medium
rating "would be defensible only if A is treated as authoritative and C as non-normative summary prose,"
which is "difficult to justify because C appears in the normative Data Flow section and prescribes
operation order."

**Confirmed:** the nesting analysis (defect (ii)) is sound — "'This walk' most naturally means the current
dbId's walk"; and that reading does contradict B's "checked once per call" and A's complete-call union
requirement.

**Three changes it forced, all applied above:**
1. **Defect (i) was overstated** — "before construction completes" *permits* but does not *require*
   partial construction; the load-bearing conflict is C's prescribed sequence order.
2. **My concurrency claim in defect (ii) was wrong.** I had claimed the per-dbId reading lets two
   concurrent calls both pass against a stale observation and overrun the ceiling. It does not: each local
   check-and-commit containing no `await` is atomic under JS serialization. The real defect is **partial
   cache mutation on a rejecting call**. This is recorded as an error rather than quietly dropped, since
   the lineage's value depends on knowing which claims were re-derived and which were corrected.
3. **A fourth defect I missed** — `uniqueMissingCount` has no stated recompute point, so it can be stale
   even under reading A. Added as defect (iii); it is the one part of this finding that indicts A rather
   than C, and it changes the fix from three phases to four.

**Methodological caveat, stated for the coordinator.** The consult received the four passages and the
indentation fact as **quoted text**, not the file, so it could check my reasoning but not independently
re-verify the nesting. That claim was verified here directly against the file's leading whitespace
(2681–2688 at 5 spaces, continuing the 3-space `- **Extraction**` bullet; `- **Broad phase**` resumes at
2689). Its two open uncertainties — whether "create" in C means constructing the object or staging an id,
and reentrancy during check-and-commit — are folded into the fix direction above.

---

# Verdict for this system

**0 Critical. 1 High (H-6C1, pre-existing, not caused by Round 22 — severity independently corroborated
by `codex-advisor`, which confirmed High while correcting one sub-claim and adding a fourth defect).
5 Medium, 3 Low.**

Round 22 introduced no cache-ownership regression, and the two ceiling-less accepted atomic risks —
including `releaseEpochScopedState`/`dispose()`'s sweep — are still stated identically, and excluded
identically, at all four sites, two of which Round 22 rewrote. Round 21's `CollisionInstance` redesign
(closing v5's H-5C1/H-G1 and H-5C2/A2) is present, complete, and internally consistent across every site
that describes it. The one High is in the capacity-check *ordering* that same redesign added — the
smallest and least-reviewed piece of it, and the only piece of it no prior audit round ever read.
