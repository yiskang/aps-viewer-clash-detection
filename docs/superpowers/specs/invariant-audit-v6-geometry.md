# Invariant audit v6 — GEOMETRY PIPELINE system

Type: per-system invariant audit (one of five parallel v6 auditors), replicating
`invariant-audit-v5.md`'s method and severity bar. Input:
`docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`, read **in full and
sequentially**. Reference baseline: `docs/superpowers/specs/invariant-audit-v6-model.md`. Prior-round
context read but not trusted for any claim about the current text: `invariant-audit-v5.md`,
`round-22-h2-derivation-pass-disposition.md`.

**Assigned system:** `GeometryRegistry`, `ThreeMeshBvhBackend`/`BlasCache`, `GeometryConnectivity`,
active-range gating/compaction/weld/connectivity/BVH ownership, extraction's accepted atomic-risk
boundaries, and the `CollisionInstance` identity cache's structural side.

**Severity bar (inherited):** Critical = unsatisfiable **by construction**; High = a real contradiction
or an unsound claim; Medium/Low = wording/completeness gaps.

**Second opinion:** `codex-advisor` (effort `high`, request `20260902-235905-22906-3015`) was consulted
on both Highs and independently corroborated them, corrected three details now folded in below, and
recommended promoting a third finding to High. The native `advisor` tool was not used.

---

## Reading note — the design file moved TWICE during this audit

1. **4429 → 4431 lines.** The v6 model was built at 4429 lines; Round 22 then applied its own post-model
   edit #5 (`round-22-h2-derivation-pass-disposition.md` lines 84–93), rewriting the two stale live
   `~16ms` gate references the model's §4.7 residue sweep found. **This closes v6-model appendix items
   17 and 19:** line 1797–1799 now reads "the performance gate's own tolerance band (**Round 22:
   ≈24ms** …)", and gate criterion 6 (now 4236) reads "says nothing about the **tolerance criterion**
   above". Item 20 is deliberately retained (1857 and 2714 keep `~16ms` as Round-18 historical
   narration, per the doc's own no-rewriting-history convention).
2. **4431 → 4446 lines, mid-audit.** A concurrent edit rewrote the abort-only bullet (now 1899–1920) and
   the abort-only tier line (now 1962–1967) to reclassify `SurfaceCrossingWitness` out of the abort-only
   tier and into the cooperative tier — i.e. someone acted on the v6 model's appendix item 4 (the
   `bvhcast` clock-basis contradiction). **That is the sync-work/query auditors' territory, not this
   one.** Every claim this report analyses was re-read against the 4446-line state afterwards and is
   substantively unchanged; **all line numbers below are verified against 4446 lines.**

**Offset table for anyone cross-reading the v6 model (built at 4429) against the live file (4446):**
lines below ~1797 are unchanged; ~1797–1898 are `+2`; ~1899–1961 are `+11`…`+13`; everything from ~1988
on is `+15`. Concretely: the atomic-operations table `1845–1857` → **1847–1859**; the general
conditional-checkpoint rule `1923–1927` → **1936–1940**; the only-one-unit paragraph `1954–1959` →
**1969–1974**; the performance gate `4177–4266` → **4194–4283**. The whole
`ThreeMeshBvhBackend`/`BlasCache` block, including Round 22's correction at **1278–1290**, is unmoved.

---

# Critical

**None.** All three of this system's protected Critical invariants were re-read against the live text
and are intact:

| Invariant | Verified at | Status |
|---|---|---|
| `GeometryRecord` entry-lifetime cancellation ownership | 1342–1361 (signal created once at insertion, carried unchanged across `'building' → 'ready'`, raced by every phase slot including a later lazy connectivity build, settled exactly once by both release paths, identity-guarded), 1362–1370 (oversized-marking carve-out), 2929–2939 (`releaseEpochScopedState`), 3040–3045 (`dispose()`), fixtures 3856–3883 | **intact** |
| Active-range gating / compaction / weld / connectivity / BVH ownership | 1254–1290 (three separately-checkpointed phases), 1291–1370 (publish-on-start, single-flight slots, `'ready'` = weld+BVH and mode-independent, no `'failed'` state, owner-only checkpoint validation), 1372–1402 (`activeTriangleCount := Σ floor(ranges[i].count / 3)`, compaction gated by the ceiling at 1393–1395, all three phases over the same compacted buffer), 1404–1429 (owned buffer; `BlasCache` owns no dedup), 2753–2765 (narrow phase), fixtures 3889–3908 | **intact** — Round 22 changed only what the pre-phase checkpoint is claimed to guarantee about *spans*; it touched no phase ordering, no ownership, no gating |
| Extraction's accepted atomic-risk boundaries | 1027–1069 (`ViewerModelAdapter`: no recursive `enumNodeFragments`, `getChildCount` not a walk primitive, coverage-equivalence + its two conditions), 1855–1856 (table rows), 2575–2694 (the walk), 3434–3462 (error handling), 4244–4264 (gate) | **intact** — one `enumNodeFragments(node, cb, false)` call is still the accepted ceiling-less risk; `maxFragmentsPerDbId` still bounds cumulative work only; the in-callback abort is still the sole `maxChildrenPerNode` mechanism; Round 22 kept both ceiling-less rows excluded from the formula (1976–1987) |

All three Highs below were explicitly weighed for Critical and rejected — see each finding's
*Why not Critical* note. `codex-advisor` independently agreed with all three severity calls.

---

# High

## H6-G1 (NEW — caused by Round 22's own edits). The corrected per-phase-checkpoint claim's justification is false for the connectivity phase, and the "the three phases never compound with each other in one span" claim Round 22 explicitly preserved is therefore false.

**The claims.** Round 22's corrected passage states (1283–1290):

> "So the *first* phase whose checkpoint finds the accumulator not yet due can still share one
> uninterrupted synchronous span with up to `frameBudgetMs` of prior work — **only every phase *after* it
> is guaranteed a checkpoint that actually yields, because that first phase's own cost alone already
> exceeds `frameBudgetMs`.** … The per-phase discipline still does what it was introduced for — **the
> three phases never compound *with each other* in one span**…"

The same premise is asserted twice more:

- **1884–1885** (the lead-in Round 22 left un-annotated, immediately before its own correction): "…gives
  each phase its own hard ceiling on *its own* cost, **so no phase ever compounds with another build
  phase in the same span**."
- **1969–1974** (the formula's only-one-unit paragraph): "…**any build phase or traversal at or near this
  ceiling already costs more than `frameBudgetMs` on its own**, so the very next checkpoint immediately
  after it finds the accumulator already overdue and does yield. … **only its first phase's span can
  absorb the extra `frameBudgetMs`.**"

**The document's own numbers refute the premise.** Every input is the live text's:

| Fact | Cited |
|---|---|
| `frameBudgetMs = 8` | 2397, 2783 |
| Accumulator = "accumulated synchronous time **since the last yield**"; a checkpoint yields only when it **exceeds** `frameBudgetMs` | 2782–2784; general rule 1936–1940 |
| Phase order **weld → connectivity → BVH**, each with its own checkpoint immediately before it | 1272–1276, 1305–1306, 2761–2763 |
| Weld ~**16.8 ms** / connectivity ~**6.9 ms** / BVH ~**16 ms** | 1849 / 1850 / 1851 |

**Connectivity's own measured cost, ~6.9 ms, does not exceed `frameBudgetMs` (8)** — and is strictly
smaller at the `12_000` ceiling, since 6.9 ms was measured at ~19,800 triangles (1247–1248, 1850).

**Permitted counterexample** — a first-ever `containment`/`volume-overlap` build of one
`GeometryRecord`:

1. checkpoint before weld → not due → weld runs (**16.8 ms**);
2. checkpoint before connectivity → 16.8 > 8 → **yields**, accumulator resets;
3. connectivity runs (**6.9 ms**) → accumulator 6.9;
4. checkpoint before BVH → **6.9 ≤ 8, not due → does not yield** (1938–1940: "A checkpoint that finds the
   accumulator not yet due does not yield at all; it lets whatever non-preemptible or abort-only unit
   follows it run to completion in the same span") → BVH runs (**16 ms**) in that same span.

**Result: one uninterrupted synchronous span of ≈22.9 ms containing two of the three build phases.**

This is a *permitted* execution, not a *guaranteed* one — unmodelled per-phase and per-checkpoint
overhead could push the accumulator past 8 ms before the BVH checkpoint. That is sufficient: the claims
it refutes are universal ("never", "only", "no phase ever"), and one permitted execution falsifies a
universal. (Correction adopted from `codex-advisor`.)

**Precisely what is and is not refuted** (this scoping is `codex-advisor`'s correction to my first draft
and matters for whoever fixes it):

| Claim | Status |
|---|---|
| 1285–1286 "only every phase after it is guaranteed a checkpoint that actually yields, **because that first phase's own cost alone already exceeds `frameBudgetMs`**" | **FALSE** — the premise fails for connectivity, and the phase after connectivity is guaranteed *no* yield |
| 1288–1290 "the three phases never compound *with each other* in one span" | **FALSE** |
| 1884–1885 "no phase ever compounds with another build phase in the same span" | **FALSE** |
| 1970–1971 "any build phase or traversal at or near this ceiling already costs more than `frameBudgetMs` on its own" | **FALSE** for the connectivity row of the very table it cites |
| 1974 "only its **first** phase's span can absorb the extra `frameBudgetMs`" | **FALSE** — a lazily-driven connectivity build against an already-`'ready'` entry (1345–1348, 2761–2763, fixture 3850–3855) is a non-first phase that absorbs prior cooperative work |
| 1969–1970 "Only *one* such … unit can ever be the one **absorbing** prior undischarged work in a given span" | **SURVIVES** — in the counterexample the BVH is the absorbing unit and connectivity is part of the absorbed prior work. The narrow conclusion is intact; its stated justification is not. |

**What survives numerically, and why the doc's reason is wrong.** The ≈24 ms figure survives, but via an
argument the document never makes. Because the trigger is "exceeds", a checkpoint that does not yield
observed an accumulator **≤ `frameBudgetMs`**; therefore everything preceding the *last* non-preemptible
unit in a span — cooperative work and any earlier sub-budget build phase alike — totals ≤ 8 ms, so

> span ≤ `frameBudgetMs` + max(unit cost) = 8 + 16.8 = **24.8 ms**

Note this is more naturally **≈25 ms** than ≈24 ms; the doc's ≈24 ms is defensible only as coarse
arithmetic on a rounded ~16 ms addend. Crucially, this correct proof **does not require the
only-one-unit lemma at all** — several sub-budget units may precede the final one, provided the observed
accumulator stays ≤ 8 ms. Round 22 reached a nearly-right number through a false lemma it did not need.

**Why this is a genuine High, not a wording nit.** The false lemma is the *entire* stated justification
for two things the document treats as live guarantees: (i) that the per-phase discipline still delivers
phase isolation after the Round-22 correction (1288–1290, 1884–1885) — the one claim Round 22 explicitly
set out to preserve; and (ii) the single-addend *shape* of the formula (1969–1974). The false invariant
appears in the phase contract, in the atomic-operation reasoning, and in the proof of the bound; an
implementer or test author relying on it would build the wrong scheduling model.

**Why not Critical.** A conforming implementation exists: keep the conditional checkpoints exactly as
specified and repair the prose/proof around aggregate elapsed time. Nothing is unsatisfiable by
construction; what is wrong is a claim *about* what the mechanisms compose to. Under this lineage's bar
(v5's Critical section) that is High. Corroborated by `codex-advisor`.

**Remedy shape** (not applied): re-derive 1285–1290 / 1969–1974 around the invariant "the aggregate
prefix observed by the final non-yielding checkpoint is ≤ `frameBudgetMs`", and annotate or retire the
un-annotated lead-in at 1884–1885 — the same *kind* of fix Round 22 performed, one level down.

---

## H6-G2 (NEW — exposed, not caused, by Round 22: a pre-existing fixture its correction stranded). The Round-15 build-phase-checkpoint fixture now demands three yields the corrected conditional-checkpoint rule cannot produce.

**The fixture** (3817–3824), inside a group whose preamble (3802–3803) reads "tested with the scheduling
primitive **mocked so the assertion is on *whether* a yield happened**, not on wall-clock":

> "a first-time `GeometryRecord` build, mocked so welding, connectivity, and BVH construction each report
> a distinct non-trivial synthetic cost **individually under `frameBudgetMs`** but summing well past a
> single checkpoint's tolerance — **the scheduling primitive must be invoked once *before each* of the
> three phases** (three separate checkpoint calls, not one before "the build"), asserted via a spy
> distinguishing which phase was about to run at each checkpoint."

**Why three yields are unreachable.** Under the Round-22-corrected rule (1885–1893; general statement
1936–1940) a checkpoint invokes the scheduling primitive **only** when the accumulator already exceeds
`frameBudgetMs`, and a yield resets it (2782–2784). With three synthetic phase costs each
`< frameBudgetMs` by the fixture's own construction, no two *adjacent* checkpoints can both yield.
Therefore:

- from a fresh or non-due initial accumulator: **at most one** of the three pre-phase checkpoints yields;
- from an initially overdue accumulator: **at most two** (the first and the third);
- **three is impossible.**

*Qualification adopted from `codex-advisor`:* this holds under the model that only the stated synthetic
phase costs advance the mocked clock between checkpoints. The fixture does not say that explicitly, so
unmodelled phase-transition/publication/revalidation work could in principle change the count — which is
itself a gap in the fixture, not a rescue of it.

**It also contradicts its own sibling fixture.** 3813–3816: "a query cheap enough overall to never cross
`frameBudgetMs` — must complete with **zero** yields. Pins that the checkpoint is **time-triggered, not
inserted unconditionally** at every stage or pair boundary." That is precisely the pin
`invariant-audit-v5.md`'s H2 cited as proof the checkpoint is conditional. The two fixtures now sit four
lines apart asserting incompatible checkpoint semantics for the same mechanism.

**Same shape as v5's own H5-Q1.** v5 finding 2 recorded that Round 21's `SurfaceCrossingWitness` fix
"relocated the contradiction (to text-vs-fixture) rather than closing it." Round 22 did the same at a
different site: it corrected the normative rule and left standing the fixture encoding the superseded
one. Round 22's disposition doc asserts "No **fixture** … touched" (line 95) — true as an edit record,
and exactly why this survived.

**Why not Critical.** The fixture's own parenthetical supplies a satisfiable reading: "(three separate
**checkpoint calls**, not one before 'the build'), asserted via a spy distinguishing which phase was
about to run **at each checkpoint**" — i.e. a spy on checkpoint *evaluations*, with the conditionally
required yields asserted separately. Under that reading the fixture still discriminates what Round 15
built it to discriminate (three checkpoints vs. one opaque "get/build BLAS" checkpoint). Because the
document itself admits that reading, this is not unsatisfiable by construction — the identical ground on
which v5's two auditors jointly rejected Critical for A2/H-G1/H-5C2. It is well past Medium, though: as
written it can produce a regression test demanding unconditional yielding that the normative scheduling
model forbids. `codex-advisor` independently reached the same High.

**Remedy shape** (not applied): restate the fixture in terms of checkpoint *evaluations*, and state the
expected yield count separately. Note that at the *real* measured costs (16.8 / 6.9 / 16) the honest
expectation is **one** yield — before connectivity — and **none** before the BVH, which is H6-G1's
counterexample expressed as a fixture.

---

## H6-G3 (NEW — caused by Round 22; promoted to its own High on `codex-advisor`'s recommendation). The ≈24 ms bound is instantiated over only three of its tier's four members, and the fourth is one the spec explicitly declines to bound.

Round 22 defined the enforceably-bounded tier with **four** members (1957–1959):

> "For the enforceably-bounded, non-preemptible tier (**the three `maxSyncTriangleCount` build phases;
> the `maxChildrenPerNode`-capped `enumNodeChildren` call**), the addend is that unit's own worst-case
> cost — measured at ~16.8ms for welding, **the largest of the three**, at the sync-triangle ceiling.
> `frameBudgetMs` (`8`) plus that is **≈24ms**…"

"The largest of the **three**" establishes only the maximum among the three build phases. The fourth
member's own table row says the opposite of a bound (1856):

> "`10_000` is a provisional total-work and compatibility limit … **This spec does not claim `10_000`
> callbacks fit inside `frameBudgetMs`**; that remains unmeasured, and the gate is required to measure
> it."

Yet the formula claims to cover it — "What the formula *does* bound is every span composed out of
primitives that are **actually ceilinged**: the three `maxSyncTriangleCount` build phases, **the
`maxChildrenPerNode`-capped `enumNodeChildren` call**, …" (1989–1992) — and gate criterion 1 (4196–4205)
turns ≈24 ms into a hard **pass/fail** threshold for every synchronous task except the two explicitly
excluded ceiling-less risks, of which `enumNodeChildren` is not one.

So: the **symbolic** formula (`frameBudgetMs` + max atomic-unit duration) remains valid, but the
**numeric instantiation ≈24 ms is unsupported** until one `enumNodeChildren` call at its callback
ceiling is measured at ≤ 16.8 ms — which is exactly what gate criterion 7 (4244–4256) is required to
measure and has not. `maxChildrenPerNode` is ceilinged in *callback count*, not in *time*, and this is a
*time*-span formula. If it measures higher, that value — not welding — must become the addend, or the
row must join the explicit exclusions at 1976–1987.

**Why not Critical.** An implementation may well measure within the threshold; nothing is unsatisfiable
by construction. **Why not Medium:** an unsound *established-bound* claim that a pass/fail acceptance
criterion is built on is exactly the "claimed vs. earned" defect pattern this audit lineage exists to
catch (cf. Round 19's C-1, Round 17's own Critical). This finding straddles the sync-work/budget
auditor's territory; `enumNodeChildren` is extraction's own primitive, so it is filed here — **flagged
for cross-check to avoid double-counting.**

---

# Medium

Only findings **new to this system's record** are listed; already-known Mediums are confirmed unchanged
under "Confirmed unchanged" below.

- **M6-G1 (NEW-surfaced, PRE-EXISTING; escalates to High if resolved the narrow way). Extraction's
  `frameBudgetMs` checkpoint is described two ways, and under the narrower one a single-child node chain
  gets no checkpoint at all.** 2661 states the checkpoint "fires **between sibling nodes at the same
  depth**"; 2646 states the "`frameBudgetMs` sibling checkpoint fires **between nodes**". A descent from
  a parent to its *first* child is not a sibling transition, so under the 2661 reading a deep chain of
  single-child nodes triggers **no checkpoint anywhere in the walk**, and N successive
  `enumNodeChildren` + `enumNodeFragments` calls compound into one span. That directly undercuts 2661's
  own conclusion ("composition across a large-but-under-ceiling subtree's many nodes is bounded the same
  way composition across dbIds already is") and, since Round 22, undercuts H6-G3's tier membership too:
  the formula's `frameBudgetMs + one unit` shape assumes each `enumNodeChildren` call is preceded by a
  checkpoint. Rated Medium because the broader 2646 phrasing supplies a sound reading; **rated High if
  2661 is the normative one.** Independently raised by `codex-advisor` as a coverage question worth
  verifying before relying on the symbolic formula. Not recorded in any prior audit in this lineage.
- **M6-G2 (NEW-surfaced, PRE-EXISTING, unrelated to Round 22). `L_X`'s defining geometry is unstated
  post-compaction.** 1470–1472: "Each `GeometryRecord` carries `L_X := diagonal(localBounds(X))`,
  computed once in X's own local space and cached with the BLAS." Since Round 16 the collision-owned
  geometry is the **compacted-then-welded** buffer, and "none of the three ever sees a triangle outside
  the active ranges" (1398–1399, 1404–1419). Nothing states whether `localBounds(X)` is taken over the
  raw Viewer geometry or the compacted buffer — verified: `localBounds` appears exactly once in 4446
  lines. The two differ exactly in the case Round 16 exists to handle (huge raw index, small active
  range — fixture 3889–3897), and `L_X` scales `surfaceEpsilon`, `mergeDistance`, `offsetLadder`,
  `witnessLadder` and `minPenetrationDepth` (1484–1491). A tolerance-scale definition whose meaning
  changed when compaction was introduced and was never restated.
- **M6-G3 (Medium, Round 22). The sweep row's under-described cost model is now propagated to three
  sites.** v6-model appendix item 18 records that the atomic-operations sweep row (1858) describes only
  the `GeometryRegistry` half, while `releaseEpochScopedState` also performs an independent deletion
  over the `CollisionInstance` cache's own keyspace — "a strict superset of `GeometryRegistry`'s"
  (1227–1228, 2929–2933). Round 22 propagated that row verbatim into the formula's exclusion
  (1978–1981) **and** into gate criterion 1's excepted-span list (4202–4204), so the omission now sits
  in three places rather than one. Confirmed still open.
- **M6-G4 (Low/Medium, PRE-EXISTING).** The `geometry-too-large-for-sync-build` diagnostic is justified
  geometry-level ("being oversized is a property of the geometry alone, not of the pairing") but scoped
  **fragment**-level ("one entry is emitted per oversized fragment", 2758–2760), so N fragments
  instancing one oversized `(loadEpoch, geometryIndex)` emit N diagnostics. Defensible as designed (the
  diagnostic names fragments, 3333–3334), but the stated justification does not support the stated
  scope. Distinct from v6-model items 13/14 (the unnamed dedup store; which code path creates the
  marking), both of which remain open and unchanged.
- **M6-G5 (Low/Medium, Round 22 vocabulary residue).** Gate criterion 1 states a "corrected … **bound**"
  but still calls a measurement above it "above the **band**" (4204); 1797–1799's newly-corrected
  sentence likewise reads "the performance gate's own tolerance **band** (**Round 22: ≈24ms**…)". Also:
  8 + 16.8 = 24.8, so "≈24ms" is a rounding of a rounding (see H6-G1).

---

# Low

- Status header (3–19) is now **five** fix passes stale ("seventeen rounds"; Round 18 named as current);
  no `### Round 20` entry. Unchanged from v5.
- `referenceCount` (1176) is still named exactly once in normative text with no
  increment/decrement/zero semantics; 1223 mentions "a geometry reference count" only to say the
  `CollisionInstance` release is *not* derived from one. Unchanged since v2.
- The unannotated `getChildCount` present-tense residue in Round 17's changelog **preamble** (496–498,
  "returned without enumerating those children") survives; the *bullets* at 466–470 and 507–512 are
  correctly annotated. Unchanged.
- Five finding-label namespaces are in play (v1 "C4/C5", v2 "C-1…C-4", v3 "C-5", v4 "H-*", v5 "H2"),
  with v5's "H2" now written into the **normative** text (1942) as well as the changelog. No
  disambiguating convention is stated anywhere.

---

# Explicit (a)/(b)/(c) split, as required

**(a) NEW — caused by Round 22's own edits:**
- **H6-G1** — the false "first phase's own cost alone already exceeds `frameBudgetMs`" premise; the
  consequently-false "never compound with each other in one span" (1288–1290) and "no phase ever
  compounds with another build phase in the same span" (1884–1885); and the false justification plus
  false "only its first phase" conclusion at 1969–1974 (the narrow "only one **absorbing** unit"
  statement survives).
- **H6-G3** — the ≈24 ms instantiation covers three of the tier's four members; the fourth
  (`maxChildrenPerNode`-capped `enumNodeChildren`) is one the spec explicitly declines to time-bound
  (1856) yet the formula (1989–1992) and gate criterion 1 (4196–4205) both claim.
- **M6-G3** (exclusion-list propagation of the under-described sweep row), **M6-G5** (bound/band
  vocabulary and the ≈24 vs 24.8 rounding).

**(b) PRE-EXISTING, newly surfaced by this read, unrelated to Round 22:**
- **H6-G2** — strictly, the *fixture* is pre-existing and untouched; what is new is that Round 22's
  correction inverted the rule it encodes. Classified as **exposed by** Round 22, matching how v5
  classified its own H5-Q1.
- **M6-G1** (`between sibling nodes at the same depth` vs `between nodes`; single-child chains) —
  pre-existing since Round 16, in no prior audit in this lineage, and made load-bearing by Round 22.
- **M6-G2** (`L_X` over raw vs. compacted geometry) — pre-existing since Round 16, in no prior audit.
- **M6-G4** (oversized-diagnostic scope vs. its own justification) — pre-existing.

**(c) Confirmed unchanged (already recorded; not re-litigated):**
- All three protected Critical invariants for this system — **intact**, verified against the live text,
  not assumed (see the Critical table). Round 22's own changelog entry (750–751, unmoved by either
  concurrent edit) claims "No behavior, fixture,
  query/lifecycle/cache/extraction mechanism … touched"; this read confirms that for the geometry
  pipeline.
- Compaction / ceiling-check **ordering transposition** (1379–1380 "Before welding, before the ceiling
  check" vs. 1393–1395 "checked … before any copying happens"; fixture 3898–3902 pins the latter) —
  unchanged, still Medium.
- **`>=` vs `>` boundary** (1434 "at or above" vs. 1394 / 2756–2757 / 3430 "exceeds"; fixture 3903–3908
  uses 13,000/11,000 and does not discriminate `12_000`) — unchanged, still Medium.
- **Intra-bullet cancellation-signal universality tension** (1342 "Every registry entry" vs. 1359–1361
  "defined only for `'building'`/`'ready'` entries") — unchanged, byte-identical since Round 20.
- **Residual C-5 site** in the "`world.dispose()` is terminal" prose (3229–3241: "the clear rejects each
  entry's cancellation signal as it drops the entry", universal over entries dropped, no oversized
  carve-out) — unchanged.
- **Connectivity trigger-point three-way ambiguity** (1319–1322 declines to decide; 2761–2763 places it
  inline; fixture 3850–3855 has a caller driving it against an already-`'ready'` entry) — unchanged.
- **Oversized-marking gaps**: whether a marking participates in the "caller that finds an existing entry"
  single-flight rule (1308–1311 vs. 1363 vs. 2753–2760), which code path creates it and when (1394 /
  1434–1437 / 2754–2757), the unnamed dedup store, and the vacuous "together with its cached BLAS and
  cached connectivity" clause (2929) — all unchanged.
- **`CollisionInstance` capacity-check ordering** (whole-set-first at 1232–1235 vs. per-fragment-loop at
  2701–2703; fixture 4047–4052 matches the former) — unchanged; noted only because the cache's
  structural side is in scope. Primary territory: the cache-ownership auditor.
- The `CollisionInstance` cache's structural redesign (frozen transform-free identity object,
  `Map<loadEpoch, Map<fragmentId, …>>`, independent epoch-scoped release, call-local
  `PlacedCollisionInstance`) is **consistent** across its declaration (1194–1239), Data Flow step 3
  (2696–2703), the broad phase (2743–2752), `releaseEpochScopedState` (2929–2933), `dispose()`
  (3033–3035, 3229–3232) and fixtures (4038–4052). No new finding.

---

# Second-opinion record

`codex-advisor`, effort `high`, request `20260902-235905-22906-3015`
(`.codex-worker/responses/20260902-235905-22906-3015/response.md`). Verdict: **file all three as High;
none is Medium; none is Critical.** Three corrections adopted verbatim above:

1. The only-one-**absorbing**-unit statement at 1969–1970 survives my counterexample (the BVH absorbs;
   connectivity is part of the absorbed prior work) — only its justification and the "only its first
   phase" conclusion fail. My first draft over-claimed here.
2. The non-yielding checkpoint observes `≤ frameBudgetMs`, not `< frameBudgetMs` (the trigger is
   "exceeds"), so the general bound is 8 + 16.8 = **24.8 ms ≈ 25 ms**; the doc's ≈24 ms is coarse
   arithmetic on a rounded addend. The proof also does not require the only-one-unit lemma.
3. H6-G2's "three yields unreachable" needs the explicit mocked-clock assumption (only the stated
   synthetic phase costs advance the accumulator between checkpoints), which the fixture never states.

It also recommended promoting the `enumNodeChildren` tier gap from a sub-item of H6-G1 to its own High
(now **H6-G3**), and independently raised the extraction sibling-checkpoint coverage question (now
**M6-G1**). It separately observed the design file changing from 4431 to 4446 lines during its read —
see the Reading note.

---

# Verdict

**0 Critical. 3 High** (2 caused by Round 22's edits, 1 exposed by them). 5 Medium, 4 Low. All three
protected Critical invariants for the geometry pipeline are intact and were re-verified line by line
rather than assumed. All three Highs are documentation-soundness defects in the same Round-22 passage
family — the corrected span claim's justification, the numeric bound's tier coverage, and the fixture
that encoded the superseded claim. None reopens a mechanism; all three are repairable by re-derivation
and re-wording, with no change to any ceiling, phase order, ownership rule, or cancellation contract.
