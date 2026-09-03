# Invariant Audit v8 — System 2: Geometry ownership / build pipeline

**Target**: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (4812 lines,
current **uncommitted working tree** — HEAD still holds the 4712-line post-Round-29 text).
**Model**: `invariant-audit-v8-model.md` §2, with §4 / §5 cross-reads (the geometry gate's cost
classification lives physically in system 4's table, so §4.3 and §4.7 were read in full).
**Method**: every line citation below was read directly out of the current file during this pass. No
disposition document (`round-18-*` … `round-30-*`) and no prior audit (`invariant-audit-v1` … `v7*`) was
used as evidence that anything is currently fixed; prior docs are cited only to establish *where past
discussion happened* and to label findings NEW vs. PRE-EXISTING. `round-30-high-only-fix-pass-disposition.md`
was read once for orientation and trusted as evidence of nothing.
**Changelog discipline**: `## Revision Notes (post-review)` (lines 40–799) is historical past-tense
narration. Nothing in that range is treated as a current invariant. All normative citations below are from
lines 801–4812 or the Status header.
**Second opinion**: one `codex-advisor` (medium) consult was run on H8-G1's classification question and
remedy space. Its two substantive corrections to this auditor's own first-draft remedy are recorded inline
under H8-G1 and were independently re-verified against spec text (2000–2005) before being accepted. It
also independently reached H8-G2 from the same two passages. No native `advisor` call was made.

---

## Verification of the four assigned invariants

| Invariant | Status | Current-text evidence |
|---|---|---|
| **`(loadEpoch, geometryIndex)` ownership** | **INTACT** | 1222–1224 ("one `GeometryRecord` per unique `(loadEpoch, geometryIndex)` — **keyed by the owning `Model` object's admitted load epoch, not its numeric `modelId`**"); dedup-key derivation 1130–1139; `modelId` demoted to display/diagnostic metadata 1241–1243; structural-disjointness argument 3415–3429 ("a different `Model` object admitted under a reused `modelId` is structurally guaranteed a disjoint epoch … before its first geometry lookup ever runs"); `evictModel`'s restatement 3182–3186; narrow phase re-cites it as "the same dedup key every phase of this record uses" (2991–2992). Untouched by Round 30. |
| **Sequencing: `ViewerGeometryAdapter` normalization → `activeTriangleCount` → `maxSyncTriangleCount` gate → compaction → weld → connectivity-when-required → BVH** | **INTACT as an ordering claim**, and the first term now has a stated producer, cache position, and call frequency | 1460–1494 (gate passage); 1464–1468 (Round 30's provenance sentence); 1475–1494 (`activeTriangleCount := Σ floor(ranges[i].count / 3)`; "**`maxSyncTriangleCount` is checked against `activeTriangleCount` before any copying happens**"; "Welding, connectivity, and BVH construction … all run over this **same** compacted buffer"); slot order 1379–1383; narrow-phase restatement 3000–3013. Strict `>` at 1485–1486, 3005–3006, 3705–3708, pinned by fixture 4217–4221. **But the first term's *cost classification* does not hold — see H8-G1 — and its *publication ordering* now conflicts with 1377–1380 — see H8-G2.** |
| **Entry-lifetime cancellation signal** | **INTACT** | 1425–1443: created once at insertion in `'building'`, "kept alive, unchanged, for the entry's entire lifetime — the signal is *not* discarded or replaced when the entry transitions to `'ready'`"; every unresolved slot races it "including a lazy connectivity build started later against an already-`'ready'` entry"; one signal per entry justified by strict sequentiality (1436–1439); removal identity-guarded (1439–1443). Mirrored without drift at `evictModel` 3182–3200 and `dispose()` 3298–3307. Pinned by fixtures 4158–4172, 4186–4195. Untouched by Round 30. |
| **Oversized-marker carve-out** | **INTACT**, and now explicitly permanent for the entry's lifetime | 1444–1452 (three entry kinds; "no phase is ever started for it, it carries no `buildState`, and every pair needing it is skipped"; "never has the entry-scoped cancellation signal … created for it at all"; "removal is the entire cleanup"). Restated at both release sites: 3182–3186 + 3196–3197 (`evictModel`), 3305–3307 (`dispose()`). Pinned by fixtures 4173–4185. **Strengthened by Round 30**: 2993–2999 now adds that an existing marking skips the pair "**without re-running `ViewerGeometryAdapter` or the ceiling check**, both of which already ran and settled this verdict the first time any pair touched this geometry." |
| *(added this round)* **The gate input's cost classification** | **DOES NOT HOLD** | 1958 + 1469–1475 vs. 1988–2012 / 2091–2099 vs. 4518–4538 / 4558–4567. See **H8-G1**. |

---

## Critical findings

**None.** H8-G2 is Critical-adjacent and would become Critical if the registry's insertion semantics were
settled the wrong way; that is stated inside the finding rather than rated here.

---

## High findings

### H8-G1 — H-4 is **relocated, not fixed**: the gate's input sub-step is now an admittedly unceilinged unit counted inside the enforceably-bounded tier's *controlling* member, from which the document's headline ≈24.8ms bound and its own gate pass/fail line are derived. NEW (Round-30-introduced), superseding half of v7 H7-G1.

**The v8 model-builder's characterization is accurate. This audit independently re-derived every element of
it from the live text and found one further element the model did not record (point 5 below).**

What Round 30 genuinely closed (re-verified, not taken on the disposition's word):

- **Provenance and call frequency.** 1464–1468: `ViewerGeometryAdapter` "runs **once per unique
  `(loadEpoch, geometryIndex)`, as the first sub-step of this same phase/checkpoint, on the registry's
  first touch of this geometry — never per candidate pair, and never re-run for an entry already present
  as an oversized marking or a `'building'`/`'ready'` record**." The narrow phase implements exactly that
  (2991–3013), the undefined "earlier layout-normalization pass" wording is gone (grep: zero occurrences
  outside `[changelog]` 498), and `getRenderProxy` now appears at four sites (1141, 1470, 1958, 4660)
  rather than two. **This half of v7 H7-G1 is closed.** (Subject to H8-G3, which shows the "never per
  candidate pair" claim is still false on one branch.)

What it did not close — each element citable independently:

1. **The row's own admission.** 1958, inside the atomic-operations table's `maxSyncTriangleCount` —
   **compaction + welding phase** row: "This phase's own checkpoint also gates `ViewerGeometryAdapter`'s
   layout-normalization and range computation … — reasoned, not measured: one `getRenderProxy` call plus
   O(ranges) work, expected small but **not itself ceilinged by this spec**." The same disclosure at
   1469–1475 ("a residual, disclosed gap, not a claimed bound"). That row's **Value** column reads
   `12_000`.
2. **The tier's own membership criterion is violated.** 1988–2012 defines the enforceably-bounded tier as
   the one where "the yield-and-revalidate-before-each-phase rule … gives each phase its own **hard ceiling
   on *its own* cost**." 2091–2094 lists the three `maxSyncTriangleCount` build phases as members and takes
   the tier's addend to be "**that unit's own worst-case cost**". A phase containing a sub-step the same
   document says it does not ceiling has no hard ceiling on its own cost.
3. **The ≈24.8ms figure excludes it by construction.** 2095–2100 derives the addend from welding's
   measured ~16.8ms — a round-15 weld-only measurement (1314–1315, 1958) taken years of revisions before
   normalization was folded into the same span. `8 + 16.8 = 24.8ms` is therefore a bound on a strict
   subset of the span it is claimed for.
4. **Gate criterion 1 neither excludes nor tolerates it.** 4527–4537 excludes exactly **two** spans (the
   `enumNodeFragments` row 1964 and the release-sweep row 1967) and names exactly **one** provisional
   exception (`enumNodeChildren`, criterion 7), then states "a measurement above the corrected bound on any
   other synchronous task **is** a gate failure." Normalization is in neither list. **No gate criterion
   measures it either**: criterion 5 (4558–4567) names "welding, connectivity, BVH construction"; the
   formula's own measurement-gap enumeration (2172–2178) names six items and not this one.
5. **NEW, not in the v8 model: the row does not even claim to cover the oversized case.** Row 1958's
   *What it bounds* cell reads "runs whenever a `GeometryRecord` is **first built**". For an oversized
   geometry **no record is ever built** — "no phase is ever started for it" (1444–1446) — yet normalization
   and the gate still run (3000–3007). So the one execution path on which the sub-step is the *entire*
   content of the span is described by **no row of the table at all**, not even the row that discloses it.
6. **The sub-step is inside *every* execution of the tier's controlling member.** The compaction+welding
   phase runs only on a geometry's first registry touch, which is exactly when normalization runs. There is
   no execution of that phase that excludes the unceilinged sub-step. So the member that supplies the
   `Cmax` in `frameBudgetMs + Cmax` — and therefore the ≈24ms/24.8ms figure cited at 2100–2102, 2126–2128,
   2951–2954, 4518–4538 and 4726 — is never actually bounded in practice, as written.

**Severity: High** by this lineage's bar (a present-tense normative contradiction and a systemic
classification gap; no wrong boolean result follows). It is *structurally the same finding* v7 raised, moved
from "unclassified and silent" to "classified into a tier whose criterion it fails, and disclosed." Honest
disclosure is a real improvement over silence and should be credited as such — but the taxonomy at
1983–2073 asserts its own exhaustiveness ("Every checkpoint named in this document … is this same
mechanism", 2060–2062) and the gate at 4518 enforces a pass/fail line derived from it, so a disclosed gap
sitting *inside* a bounded row is not a coherent resting place.

**Proposed remedy.** This auditor's first draft was: give the sub-step class-(d) treatment (its own row,
addition to the exclusion list at 2149–2164, addition to criterion 1's exclusion list at 4527–4532, and its
own gate criterion mirroring criteria 9/10), or split normalization+gate into a separately-checkpointed
phase. **Both drafts are defective, and the `codex-advisor` consult identified why; both objections were
re-verified against spec text before being accepted here:**

- *A separate row + exclusion does not restore the bound.* If normalization and welding run in one
  uninterrupted span, the formula's "one non-preemptible atomic unit that immediately follows a checkpoint"
  (2075–2079) is the **composite**. Excluding the normalization component while continuing to claim 24.8ms
  for the containing phase repeats the same accounting error one level down. An honest exclusion must name
  **the entire first-touch normalization+gate+compaction+weld span**.
- *An ordinary checkpoint between them does not separate them.* Verified at 2000–2005: "That per-phase
  checkpoint is **not a guaranteed yield** … It yields only when the accumulator is already due. A phase
  whose checkpoint finds the accumulator not yet due runs immediately, in the same span as whatever
  cooperative work already accumulated." So a fourth phase boundary of the ordinary kind leaves
  `normalize → checkpoint → weld` in one span in exactly the case that matters.

So the real choice is between two honest options, and the spec should pick one explicitly:

- **(A′) Accept the composite as an unbounded span.** Add a table row for normalization+gate, and add the
  *whole first-touch compaction+welding span* to both exclusion lists (2149–2164 and 4527–4532), plus a gate
  criterion measuring one `getRenderProxy`+normalization call. **Cost, and it should be stated plainly:
  since the compaction+welding phase only ever runs on first touch, this removes every first build from the
  24.8ms guarantee** — i.e. the headline bound would cover only warm paths. That may be acceptable (the
  spec already accepts two unbounded rows), but it must be said, not absorbed.
- **(C) Reserve first, then genuinely isolate.** Insert a registry-visible single-flight *reservation* on
  the miss, **before any possible yield** (which also fixes H8-G2); force an unconditional task boundary
  before the class-(d) normalization+gate unit and another after it; then transition the reservation to an
  oversized marking or `'building'` and continue with the existing bounded phases. This preserves dedup,
  lifecycle cancellation, honest phase accounting, and the 24.8ms bound for compaction+weld — at the cost
  of a new registry state and an unconditional-yield primitive the spec does not currently define
  (grep-confirmed: every stated yield is the conditional accumulator check).

Measurement alone does **not** fix this: the tier's criterion is an enforceable *ceiling*, and the other
four members each have one (`maxSyncTriangleCount`, `maxChildrenPerNode`, `maxCollisionInstancesPerEpoch`).
`getRenderProxy` has none available — 1469–1471 declines to claim one on purpose, cross-referenced to the
Viewer-API-drift risk at 4660–4663. Measuring it would close 4.3.4's silence, not 4.3.3's contradiction.

**Relative to prior dispositions**: v7 H7-G1's consequence 1 (unimplementable) is closed; consequence 2
(un-budgeted, in no table row and no formula term) is *relocated* into a row and a term whose contracts it
violates; consequence 3 (the normalization-failure path) is untouched and now aggravated — see H8-G3.
`invariant-audit-v6-geometry.md` did not raise any of it. **NEW in its current form.**

### H8-G2 — Round 30 inverted the publication order: the narrow phase now places a *potentially yielding* checkpoint and two Viewer-touching sub-steps between a registry miss and the entry's insertion, contradicting "insert first … before any yield" — the rule whose stated purpose is to close exactly that window. NEW (Round-30-introduced).

Two present-tense normative statements, mutually incompatible:

- **1377–1380**: "**Insert first, then build.** The caller whose lookup misses inserts the `GeometryRecord`
  for that `(loadEpoch, geometryIndex)` with `buildState: 'building'` **before** the first phase's
  checkpoint — that is, **before any yield**." Its stated rationale (1370–1376) is precisely the window:
  "nothing for that `(loadEpoch, geometryIndex)` exists in `GeometryRegistry` during that window — a second
  concurrent caller sees a cache miss and starts a duplicate build of every phase (defeating the dedup
  guarantee below), and neither `evictModel` nor `dispose()` can find the in-flight build promises both are
  specified to reject."
- **3000–3008** (Round 30): "**Only a lookup that finds no entry at all** runs, in this order, **inside that
  first-touch phase/checkpoint**: `ViewerGeometryAdapter`'s layout normalization …; the conversion to
  `activeTriangleCount` …; then the ceiling check … — over the ceiling, **the entry is inserted as an
  oversized marking** …; at or under it, **the entry is inserted `'building'`**." Reinforced at 1465
  ("as the **first sub-step** of this same phase/checkpoint").

Under 3000–3008 the insertion is a *downstream consequence* of work performed inside/after the first
phase's checkpoint, so it necessarily happens **after** that checkpoint, not before it. And that checkpoint
can yield: 1345–1352 and 2000–2005 make it the ordinary conditional accumulator check, which `await`s
whenever the accumulator is already due.

Concrete residue when it does yield (call A misses, reaches the checkpoint, yields; call B misses the same
key, does not yield, normalizes, gates, inserts, builds; A resumes):

- A re-runs `ViewerGeometryAdapter` — a second `getRenderProxy` call — for a key whose entry now exists.
  That **falsifies 1464–1466's "once per unique `(loadEpoch, geometryIndex)` … never re-run for an entry
  already present"** for the very interleaving the registry exists to serialize.
- A then reaches its own insert step for a key B already occupies, and **no insertion semantics are stated
  anywhere**: every *removal* path in this design is identity-guarded (1422–1424, 1439–1443, 3198–3200,
  3304–3305), but no insert is. Under a last-writer-wins reading, B's entry — and with it the cancellation
  signal B's in-flight phase slots race — becomes unreachable from the registry, which is the exact C-2/C-5
  shape (a promise `evictModel`/`dispose()` can no longer settle). **If the insert semantics are later
  settled as last-writer-wins, this finding is Critical, not High.**

**Partial mitigation, credited:** the *lifecycle* half of the window is covered. 2064–2073's universal rule
makes the two-part revalidation run again on resume, so a caller resuming into an evicted epoch or disposed
world aborts before inserting anything — no orphaned entry under a dead epoch. The **dedup** half is not
covered: revalidation checks liveness, never registry occupancy.

The narrowest fix consistent with both passages is remedy (C) under H8-G1 — publish a reservation
synchronously on the miss, before the first checkpoint, and decide oversized-vs-`'building'` afterward by
transitioning it. That replaces two incompatible instructions with one rule and closes this finding and
H8-G1's isolation problem together.

**Relative to prior dispositions**: v7 folded the "is a `'building'` entry ever inserted for a geometry that
turns out oversized" half of this into H7-G1 as a resolvable Low residual, and the v8 model records it as
`[AMBIGUOUS] 2.4.8` "narrowed but not closed" — **neither notices that Round 30 inverted the order and
reopened the publication window**. Round 30's own disposition does not mention 1377–1380 at all. **NEW.**

### H8-G3 — Normalization *failure* has no registry entry kind, so the narrow phase's first-touch sequence is non-exhaustive and Round 30's own "never per candidate pair" guarantee is false for two of the three `FragmentDiagnosticReason` values. PRE-EXISTING (v7 M7-G3) but **raised to High and aggravated by Round 30**, which converted an ambiguity into a falsified normative claim.

`ViewerGeometryAdapter` has three outcomes, not two. Besides "under ceiling" and "over ceiling" it can
**fail**: 3696–3702 — "if the adapter can't detect a position/index source on a fragment, or the fragment
uses a legacy `offsets` layout (explicitly rejected — see `ViewerGeometryAdapter`), **skip that fragment**
and record a `scope: 'fragment'` diagnostic" — which is where `'unsupported-geometry-layout'` and
`'rejected-primitive-range'` (3578–3579) come from.

- **The narrow phase enumerates only two of the three.** 3005–3008 covers "over the ceiling" and "at or
  under it" and stops. The failure branch has no stated outcome at the one site that now owns the adapter's
  only call.
- **No entry kind can record it.** 1444–1446 enumerates exactly three registry lookup results — oversized
  marking, `'building'`, `'ready'` — and a failed normalization is none of them. So the next candidate pair
  sharing that geometry takes the same "lookup that finds no entry at all" branch (3000–3001) and re-runs
  `ViewerGeometryAdapter` — a fresh `getRenderProxy` call — and re-fails, and re-diagnoses.
- **That makes 1464–1466 false as written.** "runs once per unique `(loadEpoch, geometryIndex)` … **never
  per candidate pair**" holds only for geometries whose normalization succeeds. For the documented failure
  cases the call frequency is `O(candidate pairs touching that geometry)` — the precise unimplementability
  H-4 was raised to eliminate, surviving on a subset of fragments.
- **Duplicate diagnostics follow.** The only dedup rule in the document is scoped to the oversized case
  (2993–2998, "**fragment-scoped and deduplicated** against a fragment-keyed set scoped to this
  `findClashes` call"); grep-confirmed there is no general set/dedup rule for `statistics.diagnostics`
  anywhere. The oversized case's own justification ("being oversized is a property of the geometry alone,
  not of the pairing") transfers verbatim to both failure reasons — the type-union comment at 3600 in fact
  scopes all three identically ("Discovered during geometry normalization or the size check, **independent
  of any pairing**") — yet only one has the rule.
- **Second-order oddity, recorded not rated:** because the adapter now provably runs only in the narrow
  phase, a fragment with an unsupported layout is nevertheless admitted a canonical `CollisionInstance`
  (2917–2932), given a placement, and scanned in the broad phase, before anything discovers its geometry is
  unusable.

**Severity: High**, not the Medium v7 gave it, on two grounds Round 30 created: the once-per-geometry claim
is now *stated normatively* and is falsified on this branch, and the enumeration at 3000–3013 now presents
itself as the complete first-touch sequence while covering two of three outcomes.

**Relative to prior dispositions**: Round 27 Cluster 3 created the oversized case's dedup rule and named its
store; Round 30 rebuilt the narrow phase around registry-lookup-first without adding a fourth outcome.
Neither considered the failure branch. **PRE-EXISTING substance, NEW severity and NEW falsified claim.**

---

## Medium findings

### M8-G1 — No keyspace-relationship statement exists for `BlasCache` / cached `GeometryConnectivity` relative to `GeometryRegistry`. PRE-EXISTING (v7 M7-G1), never dispositioned. **Jointly owned with system 5.**

Re-verified verbatim in the current text; nothing in Round 30 touched it.

- The *per-record* relationship is stated three times: "builds **one `MeshBVH` per `GeometryRecord`**"
  (1308–1309); connectivity "Computed **once per unique `GeometryRecord`** and cached alongside the BLAS"
  (1744–1746); the BLAS lives behind `accelerationPromise`, "one of that entry's single-flight phase slots",
  and `BlasCache` "owns building the `MeshBVH` and caching it **behind that phase slot**" (1512–1521), owning
  "no dedup mechanism of its own" (1389).
- The *four-independent-caches* framing is stated twice: `dispose()` "wholesale-clears **all four caches** —
  `GeometryRegistry`, `BlasCache`, every cached `GeometryConnectivity`, and the `CollisionInstance` identity
  cache — **each in its own single clear operation**" (3290–3293), repeated at 3495–3497.
- `evictModel`'s release of both is purely **derived** from the registry sweep: "drops each one, **together
  with its cached BLAS and cached connectivity where it has any**" (3183–3186). A derived release is complete
  only if the derived-from keyspace is a superset — never stated for these two.
- The sweep-cost row (1967) partitions the sweep into exactly **two** halves (the `GeometryRegistry` half
  and the `CollisionInstance` cache's own independent deletion) with **no third term** — consistent with the
  slot reading, inconsistent with the four-caches reading.
- The asymmetry is sharp: the `CollisionInstance` cache received exactly this argument, explicitly — its
  keyspace is "built from every collected fragment, **a strict superset of `GeometryRegistry`'s lazily-built
  candidate-pair keyspace**" (1278–1280, restated 3186–3190). Neither of these two received a sentence.

**Severity rationale unchanged from v7**: Medium, not High, because 1308/1744/1512–1521 make the intended
design recoverable and no release path is demonstrably incomplete under the recoverable reading.

### M8-G2 — `GeometryConnectivity`'s definition still describes a pre-Round-16 range-restricted traversal; applied literally to the compacted-then-welded buffer it would index the wrong buffer. PRE-EXISTING (v7 M7-G2), untouched by Rounds 28–30.

1742–1744, verbatim in the current text: "decomposes the welded geometry into connected components by
union-find over triangles that share an **edge** (two vertex indices), **restricted to the active triangle
ranges**."

- 1490–1491 is unambiguous that connectivity runs over the compacted buffer and "never sees a triangle
  outside the active ranges" — nothing is left to restrict.
- `TriangleRange.start`/`.count` are offsets into the **raw** index/position buffers (1179–1189); compaction
  materializes a new owned buffer (1463–1465) and welding then renumbers vertices (1498, 1701–1714). The
  original `ranges` offsets are meaningless against that buffer.
- Round 16 explicitly retired the structurally identical clause on the BVH side (1507–1511, "there is no
  out-of-range material left for a missing `groups`/`drawRange` configuration to fail to exclude"). The
  connectivity component's own definition never received that treatment.

### M8-G3 — "active-range compaction … **not gated by `frameBudgetMs`**" is stale, and Round 30 anchored a new normative claim to it. PRE-EXISTING clause, **made load-bearing by Round 30**.

1460–1461: "**The fix inserts one more phase before the three above, not gated by `frameBudgetMs` but by the
ceiling itself: active-range compaction.**" Four lines later (1464–1465), Round 30 attached
`ViewerGeometryAdapter`'s new call-frequency rule to "**this same phase/checkpoint**" — whose nearest
antecedent is the phase that sentence says is not `frameBudgetMs`-gated.

Three other present-tense sites say the opposite: row 1958 ("Own checkpoint, before it starts"; "This
phase's own checkpoint also gates `ViewerGeometryAdapter`'s layout-normalization"), 1339–1341 ("Each phase …
gets its own checkpoint immediately **before** it starts"), and 3001–3002 ("inside that first-touch
phase/checkpoint"). The row itself records the folding that makes 1460–1461 stale: "Round 16 folded
active-range compaction into this same phase/checkpoint."

Medium, not High: the three-site reading is clearly intended, and a charitable reading of 1460–1461 scopes
"not gated by `frameBudgetMs`" to the *admission decision* (ceiling, not budget) rather than to checkpoint
governance. But whether the sub-step is checkpoint-governed decides whether a lifecycle revalidation
precedes a Viewer `getRenderProxy` call, which is not a cosmetic question.

### M8-G4 — The adapter's input is fragment-keyed; its newly-stated call frequency is geometry-keyed; the equivalence that makes that sound is never stated, and one fragment-scoped diagnostic depends on it. NEW (Round-30-introduced).

`ViewerGeometryAdapter` normalizes `viewer.impl.getRenderProxy(model, **fragId**).geometry` (1141) — a
**per-fragment** call. Round 30 now caches its output per **`(loadEpoch, geometryIndex)`** (1464–1466),
which many fragments may instance ("its product reused by every fragment instancing it", 1239–1241).

Nothing states:

- **which fragment's** render proxy the first-touch normalization uses (any of them? the first pair's
  source? unstated), or
- **why the result is fragment-independent** — i.e. that `groups`/`drawRange`/`vb`/`ib`, the exact inputs
  the ranges branch reads (1177–1209), belong to the shared geometry rather than to the per-fragment proxy.
  This is very likely true for `LeanBufferGeometry`, but the spec's own habit is to state such
  Viewer-behavioral premises and cite the pinned bundle (as it does at 1148–1150, 1190–1196, 1202–1207); here
  it does not.

Consequence if it is *not* fragment-independent: two fragments sharing a `geometryIndex` but differing in
draw range would silently receive one fragment's `activeTriangleCount` and one fragment's compacted buffer —
a false-negative class this spec's diagnostics exist to make impossible (cf. 1194–1196). It also decides who
gets diagnosed: `'unsupported-geometry-layout'` is fragment-scoped (3696–3702, 3733) but is now produced by a
geometry-scoped call.

---

## Low findings

### L8-G1 — The canonical operand-order sort key is stale pre-Round-14 vocabulary naming two fields defined nowhere in the document. PRE-EXISTING, open since `invariant-audit-v1.md` L3; v7 L7-G1.

1568–1571, verbatim and unchanged: "sorted by `(modelId, geometryKey, instanceId)`". `geometryKey` and
`instanceId` occur exactly once each in the whole 4812-line file — here; the design's actual vocabulary is
`geometryIndex` and `fragmentId`. `modelId` as a sort component contradicts 1241–1243 ("it plays no role in
cache identity") and is harmless only because Milestone 1 rejects cross-model pairs (947–951, 2768–2772) — a
dependency this passage does not state.

### L8-G2 — An oversized marking is never said to be re-evaluated, replaced, or superseded within a live epoch. PRE-EXISTING (v7 L7-G2, model 2.2.2). **Narrowed by Round 30.**

2996–2999 now states the marking is consulted "**without re-running `ViewerGeometryAdapter` or the ceiling
check**, both of which already ran and settled this verdict the first time any pair touched this geometry",
and 3011–3013 adds "once the entry is settled … every later pair that shares this geometry reads that
settled entry and never repeats normalization or the ceiling check" — so the marking is now explicitly
permanent for the entry's lifetime. What remains unstated is only whether the underlying inputs *could*
change within one live epoch. Near-moot (`maxSyncTriangleCount` is a fixed constant, 1526–1546; the active
count is a property of the geometry). No action implied.

### L8-G3 — An invariant-audit marker string still leaks into normative body text. PRE-EXISTING (v7 L7-G3, model 0.5). Cross-system.

3750–3751, inside Error Handling's `maxCollisionInstancesPerEpoch` bullet: "…carrying no named error class,
the same `[SILENT]` gap those three share." Exactly one occurrence in the file. Geometry-relevant only
because two of the four ceilings it points at (`maxFragmentsPerDbId`, `maxChildrenPerNode`) are
extraction-pipeline ceilings. **Round 30 additionally made the "those three" count stale** by adding a fifth
unnamed-error-class rejection path (the step-2 precheck, 2903–2905) — that half belongs to systems 1 and 5.

### L8-G4 — Gate criterion 1's provisional-exception clause still names only the tier's **fourth** member after Round 30 made the tier five. NEW (Round-30-introduced). **Primarily system 4 — flagged here because criterion 1 is the enforcement point for H8-G1.**

4533–4537: "**with one provisional exception**: one `enumNodeChildren` call at the `maxChildrenPerNode`
ceiling (criterion 7, below) is the **fourth**, still-unmeasured member of the 24.8ms figure's own
enforceably-bounded tier … if its measured cost pushes the true bound above 24.8ms, that is this criterion's
own tolerance being corrected by measurement, not a failure of this criterion; **every other synchronous
task's 24.8ms tolerance is not provisional in the same way**."

But 2095 now says the tier has **five** members, and 2104–2117 says explicitly that "**The fourth and fifth
members** … are not among the three measured costs this ≈24ms is computed from" and that "≈24ms is
provisional for **both** specifically until the performance gate measures them." Round 30 added criterion 8
(4601–4610) to measure the fifth member but did not extend criterion 1's exception to it. As written,
criterion 1 would score a capacity-admission measurement above 24.8ms as a **gate failure** while the formula
passage says the same measurement **corrects the bound**.

---

## Historical-only / non-defect observations

1. **The Round-16 regression fixture Round 30 touched is correct.** 4196–4205: "whose `ranges:
   TriangleRange[]` (**from `ViewerGeometryAdapter`, computed once on this geometry's first registry touch —
   see the active-range gate**)". This matches the new narrow-phase text (3000–3013, "Only a lookup that
   finds no entry at all runs … `ViewerGeometryAdapter`'s layout normalization") and 1464–1468 exactly; the
   v7 hand-wave "(from normalization)" is gone. The fixture's own assertions (not skipped as
   `geometry-too-large-for-sync-build`; weld spy sized to the *active* count) are untouched and remain
   consistent with 1485–1491. **No finding.**
2. **"see the active-range gate" is not a dangling anchor.** It occurs twice (1958, 4198–4199) with no
   matching heading, but it is lowercase descriptive prose resolving to the passage at 1454–1494 (which
   bolds "active-range compaction"), the same style as "the ranges bullet under `ViewerGeometryAdapter`" and
   "the clock-basis passage". Unlike the model's 0.6 (**Budget enforcement and yield points**, 1784/4724),
   it is not styled as a section name. **No finding** — but note the 0.6 dangling anchor at 1784 sits inside
   `SurfaceIntersectionQuery`'s passage, which this system reads; it is system 3/4's to disposition.
3. **`referenceCount` is not a current gap.** 1225–1227 states "reserved, unused in Milestone 1 — release is
   epoch-scoped, not reference-counted" with a pointer to the release paths. A complete Milestone-1 contract.
   Unchanged from v7's finding. **No finding.**
4. **The Round-16 changelog bullet's inverted ordering (492–500) is historical** and self-correcting two
   clauses later; it sits inside `## Revision Notes` under the no-rewriting-history convention and creates no
   live contradiction with 1485–1486. **No finding.**
5. **3411–3413's `(modelId, geometryIndex)` keying statement is past-tense narrative** describing the
   pre-Round-14 defect, inside the "Race safety" prose. Not a current invariant.
6. **The `>` vs `>=` boundary is settled and pinned.** 1485–1486, 3005–3006, 3705–3708 all read "exceeds";
   fixtures 4211–4216 (39,000/33,000 index elements) and 4217–4221 (exactly `12_000` → must build) pin both
   the unit conversion and the strict operator.
7. **The owner-scoped build-phase checkpoint's Milestone-1 vacuity is disclosed, not hidden** (1403–1411,
   fixture 4186–4195). Correct as written.
8. **Round 27's protected geometry invariants all re-derived intact** from current text (top table). No
   geometry regression from Rounds 28 or 29 was found; the two regressions found this round (H8-G1's
   relocation, H8-G2's order inversion) are both Round 30's.

---

## Cross-system composition concerns (for the synthesis pass)

1. **H8-G1 is jointly owned with system 4 (budget/scheduling).** The contradiction lives in system 4's
   table (1958), tier prose (1988–2012, 2091–2099), formula (2075–2178) and gate (4518–4567), but its
   subject is this system's pipeline. The two auditors must not converge on different verdicts about whether
   the compaction+welding phase is bounded. **Recommend the synthesis pass treat "is the tier's controlling
   member actually ceilinged" as one item, and pair it with L8-G4** (criterion 1's stale fourth/fifth
   count), since both are failures of the same criterion to keep up with the taxonomy it enforces.
2. **H8-G2 is jointly owned with system 1 (lifecycle) and system 5 (concurrency).** The window it reopens is
   closed for lifecycle (2064–2073's universal revalidation) and open for dedup. System 5 owns single-flight
   (5.4.1) and identity-guarded removal (5.4.5); **no one currently owns *insertion* semantics** — that gap
   is what decides whether H8-G2 is High or Critical.
3. **H8-G3 crosses into system 3 (diagnostics).** System 3 owns `FragmentDiagnosticReason` (3577–3580) and
   should confirm — this audit found no such statement — whether `ClashStatistics.diagnostics` is anywhere
   specified as a set rather than an append-only array. If it is an array, the per-pair re-diagnosis is
   user-visible.
4. **M8-G1 is jointly owned with system 5 (cache ownership).** Whether `dispose()` clears "four caches" or
   "two caches plus two slot-sets" (3290–3293 vs. 1512–1521) determines whether `evictModel`'s derived
   release (3183–3186) is complete. One reconciliation item, not two.
5. **L8-G1 crosses into system 3.** `L_canonical` and `minPenetrationDepth` (1573–1574, 1582, 1585) are
   defined off the canonical order whose sort key is the stale one.

---

## Counts

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | — (H8-G2 escalates to Critical if registry insertion is last-writer-wins) |
| High | 3 | H8-G1 (NEW — H-4 relocated, not fixed), H8-G2 (NEW — Round-30 order inversion), H8-G3 (PRE-EXISTING substance, NEW severity + falsified claim) |
| Medium | 4 | M8-G1 (PRE-EXISTING, never dispositioned), M8-G2 (PRE-EXISTING), M8-G3 (PRE-EXISTING clause, made load-bearing by Round 30), M8-G4 (NEW) |
| Low | 4 | L8-G1 (PRE-EXISTING, open since v1), L8-G2 (PRE-EXISTING, narrowed), L8-G3 (PRE-EXISTING, cross-system), L8-G4 (NEW, cross-system) |

**Round 30's five claimed fixes, geometry's share**: fix (c) — the geometry gate's input provenance and
classification — **holds in part only**. Its provenance/call-frequency half is genuinely closed (with the
H8-G3 exception); its classification half is relocated, not removed (H8-G1); and the edit introduced one
new regression this audit found independently (H8-G2). The four non-geometry fixes were not re-verified
here.

**Spec not modified by this pass.** Audit-only.
