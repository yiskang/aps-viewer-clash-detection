# Invariant Audit v7 — System 5: Cache ownership / cleanup / concurrency

**Target**: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (4712 lines).
**Model consulted**: `invariant-audit-v7-model.md` §5, with §1/§2/§4 cross-references.
**Method**: every line citation below was read directly from the current spec in this pass. No prior
disposition doc (`round-18-*` … `round-29-*`, `invariant-audit-v1…v6*`) was treated as evidence that
anything is currently fixed; Round 24's and Round 25's dispositions were read only to establish what was
*claimed*, and every such claim was independently re-verified against current text before being labelled
PRE-EXISTING or NEW.

**Changelog discipline**: lines 40–799 are the past-tense `## Revision Notes (post-review)` changelog and
are **not** cited as invariants anywhere below. All citations are to the normative body (801–4712) or the
Status header (1–38).

**Counts: 0 Critical, 1 High, 4 Medium, 7 Low.**

---

## Critical

None.

---

## High

### H-7C1 — The `CollisionInstance` capacity admission's recompute-and-commit is a third, unenumerated, unbounded non-preemptible synchronous span, and it structurally collides with gate criterion 1

**NEW.** Not addressed by Round 24 (which fixed the *ordering* of the four-phase admission, H-6C1) or
Round 25 (whose Cluster 2 touched only the sweep-cost row, `dispose()`'s non-throwing requirement, and
plural cache phrasing). This is the model's `[SILENT] 4.3.2` / §4.8's last row, chased from the cache side
as instructed.

**Is the step genuinely a synchronous atomic operation?** Yes, by explicit normative requirement.
Line 2865–2866: "**In that same synchronous step — no intervening `await`, no call out to any external
callback, getter, or other reentrant operation**". Restated at 1294–1295 and again at 1952 ("with no
intervening `await` between the check and committing every missing instance"). It therefore satisfies the
spec's own definition of a non-preemptible atomic operation: it admits no checkpoint by construction.

**Its real cost, from the current text.** Two O(unique-fragments) sub-steps sit inside that atomic step,
neither of which the atomic-operations table prices:

- **Phase 2, the recompute** (2860–2864, restated 1291–1293): "recompute — against that bucket's *current*
  contents, not a count carried over from earlier in the walk — which of the call's unique fragment ids
  are still missing". This is a membership test per element of the call's **complete, call-wide** unique
  fragment-id set (2853–2854), i.e. O(U) where U is that set's size. It runs **before** the capacity check,
  so even a call destined for rejection pays it in full.
- **Phase 3, the commit** (2869–2872, restated 1297–1299): "construct and publish a canonical
  `CollisionInstance` (frozen, `fragmentId` + `GeometryIdentity`, no transform state) for every missing
  fragment id". That is an allocation **plus a freeze of two objects** (the instance and its nested
  identity — 1251–1252) per missing fragment.

**U is unbounded.** `maxFragmentsPerDbId` is `5_000` and bounds **one dbId's** walk only — the table row
at 1947 says so verbatim ("Bounds **cumulative work across the walk only**") and 1948 repeats the per-dbId
scoping. The call-wide set is the union across `query.source.dbIds` and `query.target.dbIds`. Nothing in
the spec ceilings the number of requested dbIds: the only call-site literal is
`target: { model, dbIds: roomDbIds }` (2711–2712), passing an arbitrary-length room list straight through,
and no `maxRequestedDbIds`-style constant exists anywhere in the document (grep: zero occurrences). So
U ≤ `maxFragmentsPerDbId × |dbIds|` with the second factor uncapped.

**What the table actually claims for this row.** Line 1952's cost basis is: "**A synchronous size
comparison against a bucket's current count is O(1) per affected epoch; the check itself is cheap.** What
is unmeasured is the retention this ceiling accepts…". That prices *only* phase 3's `currentBucketSize +
uniqueMissingCount` comparison. The row's entire "unmeasured" hedge is about **retained bytes/count**, not
about synchronous span. Neither phase 2's recompute nor phase 3's construct-and-freeze loop appears in
that row, in the scheduling-class taxonomy (1966–2047), or in the worst-case-span derivation (2049–2138).

**Why this is High, not Medium.** The spec does not merely omit a cost — it makes two positive claims that
the omission falsifies:

1. **The worst-case-span formula's exclusion list is stated as exhaustive.** 2110–2125 names exactly two
   ceiling-less spans — one `enumNodeFragments(node, cb, false)` call and
   `releaseEpochScopedState`/`dispose()`'s per-epoch sweep — and says "Both rows … are **explicitly
   excluded from the formula above and from any finite worst-case-span guarantee this spec makes**." The
   capacity commit is a third such span and is not among them, so it is silently inside a guarantee it
   cannot honour.
2. **Gate criterion 1 makes it an unremediable gate failure.** 4445–4450 excuses over-bound measurements
   for exactly those same two spans and then states: "a measurement above the corrected bound on any other
   synchronous task **is** a gate failure". The capacity commit is "any other synchronous task". But the
   only fix the design permits for an over-long span — an interior `frameBudgetMs` checkpoint — is
   **forbidden here by the cache's own atomicity invariant** (2865–2866; the atomicity exists so "two
   concurrent calls cannot both pass against the same stale capacity observation", 1299). There is no
   stated resolution to this conflict anywhere in the document.

Concretely reachable: a room-locator `containment` query over a few hundred rooms in an MEP model can put
U in the 10⁵ range; `Object.freeze` × 2 per missing fragment at that scale plausibly exceeds the literal
24.8ms pass/fail line at 4438–4442.

**What the omission does NOT imply for cache-ownership correctness — stated explicitly, since the task
asked.** It is **not** a cache-consistency defect. The step cannot be interrupted mid-commit by another
`findClashes` call or by a lifecycle checkpoint, because JavaScript is single-threaded and 2865–2866
forbids any `await` or reentrant call inside it. No concurrent reader can observe the bucket half-populated,
and `evictModel`/`dispose()` cannot interleave between the capacity check and the commit. The atomicity
invariant holds as written; what fails is the **scheduling model**, not the cache. (The one interruption
that *is* possible — a synchronous throw inside the commit — is L-7C3 below.)

**Cross-system**: the sync-work/budget auditor is examining the same step from the scheduling side. From
the cache side the verdict is: yes, it is genuinely atomic; yes, it belongs in the atomic-operations table;
its omission is a span-model defect, not a cache-integrity defect; and the atomicity requirement is what
makes it un-fixable by the design's usual remedy.

---

## Medium

### M-7C1 — Still no keyspace-relationship statement for `BlasCache` / cached `GeometryConnectivity` vs. `GeometryRegistry`, so `evictModel`'s derived release of both is unproven in text

**PRE-EXISTING and still open.** Round 25's Cluster 2 (M-6C3/4/5) touched the sweep-cost row, the
non-throwing requirement, and plural phrasing — none of them this. Round 24 (H-6C1) was about the capacity
admission's ordering. Verified open by direct read of current text. This is the model's
`[SILENT] 2.6.4 / 5.3.2`; the geometry auditor is checking the same silence from the pipeline side.

`evictModel`'s release of these two caches is **derived from** the registry sweep, not independent:
3116–3120 — "`releaseEpochScopedState` sweeps GeometryRegistry for every entry filed under the object's own
admitted epoch … and drops each one, **together with its cached BLAS and cached connectivity where it has
any**". A derived release is complete only if the derived-from keyspace is a superset. The spec never says
it is.

The asymmetry is the tell. The `CollisionInstance` cache received **exactly** this analysis, and received
it because the answer came out the other way: 1276–1280 argues the cache's keyspace is "built from every
collected fragment, **a strict superset of `GeometryRegistry`'s lazily-built candidate-pair keyspace**",
which is precisely why 3120–3124 makes its release "an independent operation over a different keyspace (not
derived from this `GeometryRegistry` sweep)". No corresponding sentence exists for `BlasCache` or
connectivity anywhere in the document.

**Assessment: real gap, not closed elsewhere — but a documentation gap, not a demonstrable leak.** I
traced every way a BLAS or connectivity product could outlive its registry entry and found the windows
closed by other rules: 1308 builds the BLAS "per `GeometryRecord`", so nothing is ever cached for a
geometry with no entry; the build-failure removal at 1418–1419 drops the entry "synchronously as part of
that rejection, discarding whichever intermediate buffers exist"; removal is identity-guarded on both
paths (1422–1424, 1439–1443); and the only path that could remove a `'ready'` entry with a resolved BLAS
still resident — a later lazy connectivity build rejecting — is itself triggered by the release sweep that
already removed the entry. So the subset property appears to hold *by construction*. But it holds by an
argument the spec does not make, about a property it does not state, for a release path it explicitly
flags as a "state-release/cleanup completeness concern" (3149–3150). Compounded by M-7C3 below (whether
`BlasCache` even *has* its own keyspace is unsettled), a reader cannot check the claim.

### M-7C2 — The release-path cost model and gate criterion 9 cover 2 of the 4 caches `dispose()` clears; `BlasCache`'s and the connectivity cache's own clears are uncosted and unmeasured

**NEW.** This is the *same class* of gap Round 25's M-6C3 closed for the `CollisionInstance` cache, left
open for the other two. The task asked whether any other cache's keyspace has a gap like the one an earlier
round found for `CollisionInstance` — it does.

Round 25's M-6C3 fix is **verified present** at 1951: the row now says "This cost model covers only the
`GeometryRegistry` half of the sweep — the same step also performs an independent deletion over the
`CollisionInstance` cache's own keyspace … which this row does not separately cost", then prices
`evictModel`'s as one `Map.delete(loadEpoch)` (O(1)) and `dispose()`'s as one `Map.clear()` whose scaling
with live-epoch count "is unstated and unmeasured here". That much is closed.

But `dispose()` clears **four** caches, "each in its own single clear operation" (3224–3226, restated
3429–3431). Row 1951 is the only cost model the document has for that operation, and it accounts for two of
the four. `BlasCache`'s own single clear and the cached-`GeometryConnectivity` clear are priced nowhere —
not as folded into the registry half (they are explicitly *separate* operations at 3226), and not as
independent clauses (the row names only the registry and `CollisionInstance` halves).

Gate criterion 9 inherits the same shape. 4527–4537 requires measuring the sweep from both call sites and
requires `dispose()`'s measurement to "additionally vary the number of *simultaneously live epochs* at
teardown … its wholesale `CollisionInstance`-cache clear is a single `Map.clear()` over every live epoch's
bucket at once, whose cost scaling with live-epoch count is unmeasured". `BlasCache` and
`GeometryConnectivity` are not mentioned in the criterion at all. Since row 1951 is one of the two spans
explicitly excluded from the worst-case-span guarantee (2113–2114, 4447–4448), an unpriced component of it
sits inside an already-uncapped risk with no measurement obligation attached.

### M-7C3 — `BlasCache`'s status as a cache is internally inconsistent: "storage behind a phase slot" vs. one of four independently-cleared caches

**PRE-EXISTING and still open.** Model `[AMBIGUOUS] 2.6.3`. Untouched by Rounds 24–25.

Two current-text readings, both normative and unannotated:

- **Storage behind a slot.** 1503–1512: "that dedup is **not** a mechanism `BlasCache` owns. It is the
  registry-level rule above applied to one phase … `accelerationPromise` is one of that entry's
  single-flight phase slots … `BlasCache` owns building the `MeshBVH` and **caching it behind that phase
  slot**". 1389 reinforces: `BlasCache` "owns no dedup mechanism of its own". Under this reading `BlasCache`
  has no keyspace — the BLAS lives on the registry entry, and both release paths reach it for free.
- **A distinct cache with its own clear.** 3224–3226: "`dispose()` also wholesale-clears all four caches —
  `GeometryRegistry`, `BlasCache`, every cached `GeometryConnectivity`, and the `CollisionInstance` identity
  cache — **each in its own single clear operation**"; repeated at 3429–3431. Under this reading it has its
  own keyspace, and M-7C1's missing subset statement becomes load-bearing.

The two readings are not reconcilable as written: a slot on a registry entry cannot also require its own
independent clear operation. This is not merely stylistic — which reading is correct determines whether
M-7C1 is a documentation nicety or a genuine completeness precondition, and whether M-7C2 counts one
missing cost model or two.

### M-7C4 — No fixture verifies release *completeness* for any cache; the eviction fixtures spy on the release call, not on the caches' resulting state

**NEW.** Neither Round 24 nor Round 25 added or reviewed a completeness fixture (Round 25's own
"Verification performed" list is prose re-reads and the unrelated geometry spike).

The spec identifies release completeness as its own distinct risk class — 3148–3150: "This is a
**state-release/cleanup completeness concern**, not a liveness-correctness one — the object is correctly
dead either way — but it is required for the design to actually reclaim what it claims to." Nothing in
Testing & Verification (3795–4558) tests it.

What the eviction fixtures actually assert:

- 4345–4350 (double eviction): "the first call must tombstone the entry and **release the epoch-scoped
  state (asserted via a spy)**". A spy proves `releaseEpochScopedState` was *invoked*, not that the
  registry, `BlasCache`, connectivity and `CollisionInstance` bucket for that epoch are afterwards empty.
- 4335–4344 (evict-before-admit): asserts "**no** epoch-scoped cache release is attempted (asserted via a
  spy)" — again invocation, and the negative direction.
- 4266–4277 (stale eviction): asserts the *surviving* object's entries are unchanged — the disjointness
  property, the opposite of completeness.
- 4114–4123 (entry-scoped cancellation): asserts "the evicted entry must no longer be present in
  `GeometryRegistry`" — the single closest thing to a completeness assertion, and it covers exactly one
  cache and only in the in-flight-build scenario.
- `dispose()`'s four-cache clear (3224–3226) has **no** fixture asserting all four end up empty. 4317–4318
  asserts a resumed query "must touch no BLAS/instance/geometry state released by disposal" — a
  non-observation, not an emptiness check.

Given that M-7C1 leaves the `BlasCache`/connectivity release completeness argued only by derivation, and
M-7C2 leaves two of the four clears unmodelled, the absence of any test that would catch a leak is the
compounding failure.

---

## Low

### L-7C1 — The Round-25-added capacity bullet garbles its own predicate

**NEW** — introduced by Round 25's own L-6C2 fix. 3678–3680: "if committing the call's missing
`CollisionInstance`s would push **`maxCollisionInstancesPerEpoch` over its limit**". `maxCollisionInstancesPerEpoch`
*is* the limit; the thing pushed over it is the affected epoch's bucket. Both other statements of the same
rule get it right — 1295–1296 ("checks `currentBucketSize + uniqueMissingCount` against the limit for the
affected epoch") and 1952 ("would push any affected epoch's bucket over the limit"). Wording only; no
mechanism disagreement.

### L-7C2 — The capacity-admission sequence states no lifecycle revalidation of its own, yet it creates a cache bucket

2851–2883 walks through four phases and never mentions `disposed` or the model's epoch. Phase 3 *creates a
bucket* for an epoch (2869–2870) — a write into world-owned cache state — with no stated liveness
precondition at that point.

The sequence is nonetheless **safe as written**, but only by composing two facts stated elsewhere: the
two-part revalidation runs unconditionally at every checkpoint and again on every resume (2039–2044), and
admission runs "after the walk's last possible yield" (2860) inside one step with no `await` (2865–2866) —
so no eviction or disposal can interleave between the last revalidation and the commit. A reader of
2851–2883 alone cannot see this. Worth an explicit cross-reference given that a bucket created after
`releaseEpochScopedState` had already deleted it would be a genuine resurrection.

### L-7C3 — A synchronous throw inside the commit leaves a partially-populated bucket resident, with no rollback and no error class

The zero-mutation guarantee is scoped twice, in identical words, to *capacity rejection* only: 1301–1303
and 2880–2883 — "a **later** failure in placement construction or in the broad-/narrow-phase work that
follows can still leave already-admitted canonical instances resident, and is not covered by it". Neither
statement addresses a failure **inside** phase 3 itself. Since phase 3 both creates the bucket and
constructs+freezes N instances, an allocation failure partway through leaves a bucket that exists, is
partially filled, counts toward `maxCollisionInstancesPerEpoch` for every later call, and is reclaimable
only by epoch eviction or disposal (1303–1306, "Entries are never individually evicted while their epoch
remains live"). No rollback is specified and, per L-7C4/1.6.3, no error class is named. This is the one
interruption H-7C1's atomicity does not exclude.

### L-7C4 — `maxCollisionInstancesPerEpoch` has no chosen value while a fixture and an error-handling bullet already depend on its behaviour

1952: "**provisional, value not yet chosen**". Meanwhile fixture 4287–4292 requires a test "against a model
whose epoch's `CollisionInstance` bucket is already at `maxCollisionInstancesPerEpoch` capacity", and
3678–3684 specifies the rejection contract. Gate criterion 10 (4540–4549) is what must set it. Disclosed,
not hidden — recorded because it is the only ceiling in the atomic-operations table with no number at all,
and because H-7C1's commit-cost bound depends on it.

### L-7C5 — The extension-owned room cache has no capacity ceiling and no eviction policy, and is outside `dispose()`'s four caches

`Map<Model, Promise<number[]>>` keyed by the exact `Model` object (2598–2603). `world.dispose()` "never
touches it" (3192–3193); `evictModel` does not either — "The handler must therefore drop that object's
room-cache entry unconditionally, independent of what `evictModel` does" (3192–3194). It is cleared only as
`unload()`'s third step (3462–3463) — which 3473–3478 documents as **strandable**: a repeated `unload()`
throws `WorldDisposedError` from step 1, "stranding listener removal, context-menu removal, and the
room-cache clear for that invocation". Nothing bounds how many `Model` keys accumulate. Low because a
strong `Map` key on `Model` in a per-viewer extension is a bounded-in-practice leak, and 3483–3487 already
declares `unload()`'s per-step isolation an open question.

### L-7C6 — `referenceCount` is a dangling field in the cache's record shape

1225–1227: `GeometryRecord` carries "a `referenceCount` (**reserved, unused in Milestone 1** — release is
epoch-scoped, not reference-counted…)". No increment site, decrement site, semantics, or future contract
appears anywhere else in the document. A reserved field on a cache record that the release model
explicitly does not use invites an implementer to wire it up; the spec should either state its future
contract or drop it.

### L-7C7 — A literal `[SILENT]` audit marker has leaked into normative Error Handling text, inside the capacity bullet

3683–3684: "…and carrying no named error class, **the same `[SILENT]` gap those three share**." This is
inside the `maxCollisionInstancesPerEpoch` bullet Round 25's L-6C2 added, i.e. this cache's own text. The
underlying substance (no named error class for the four call-level ceiling rejections) is a real gap the
spec is honestly disclosing; the defect is the audit-vocabulary token appearing as normative prose. Also
noted by the model as observation 0.5.

---

## Historical-only / non-defect observations

These were checked because a prior round or the model flagged them; each is **currently sound** in the text
I read. Recorded so the synthesis pass does not re-open them.

1. **Frozen `CollisionInstance` identity holds.** 1250–1253: contents are "only its `fragmentId` and an
   immutable `GeometryIdentity { loadEpoch, geometryIndex }`; both the instance and its nested identity
   value are frozen after construction. **It contains no `Model`, `GeometryRecord`, BLAS, world matrix,
   world bounds, or other call-varying or mutable state**". Reinforced from the broad-phase side at
   2923–2926. Cache hits are read-only: 1257–1258, "no `findClashes` call ever writes through a cached
   `CollisionInstance`".
2. **Call-local placement holds.** 1260–1268 defines `PlacedCollisionInstance` as per-call with "newly
   owned matrix and bounds objects"; 2923–2930 makes the same snapshot the reason mid-scan suspension is
   safe; fixture 4278–4286 pins the two-concurrent-calls-with-a-transform-mutation case. The three sites
   agree.
3. **Independent epoch sweep for this cache holds, at all three sites.** 1272–1280 (declaration),
   3120–3124 (`evictModel`), 3224–3226 + 3429–3431 (`dispose()`). The superset rationale at 1276–1280 is
   intact and is what makes the independence necessary rather than stylistic.
4. **The check-and-commit ordering is consistent across its three statements.** 2856–2876 (Data Flow),
   1289–1300 (Components), 1952 (table). Phase 2's "recompute against the bucket's *current* contents, not
   a count carried over from earlier in the walk" (2861–2864) is present at both prose sites, with the
   staleness rationale. Round 24's H-6C1 fix is verified present, not assumed.
5. **The oversized-marking carve-out is present on both release paths.** 3130–3131 (`evictModel`),
   3239–3241 (`dispose()`), declared at 1444–1452. Both say the marking is removed in the same sweep with
   nothing to reject.
6. **The entry-scoped cancellation signal's lifetime rule is consistent.** 1425–1443 (declaration),
   3124–3134 (`evictModel`), 3232–3241 (`dispose()`). All three state entry-lifetime scope across the
   `'building' → 'ready'` transition, exactly-once rejection, and identity-guarded delete.
7. **Round 25's M-6C3 is genuinely closed** — the `CollisionInstance` keyspace clause is present at 1951
   with the `evictModel`-O(1) / `dispose()`-unmeasured split. **M-6C4 is closed** — the non-throwing
   requirement now appears in `dispose()`'s own contract at 3227–3231. **M-6C5 is closed** — "all four
   caches … each in its own single clear operation" at 3226 and "all four caches in full" at 3431. All
   three verified by direct read, not from the disposition doc.
8. **No reachable orphan-BLAS window found**, per the trace in M-7C1. Recorded so the synthesis pass knows
   M-7C1 is a missing-argument finding, not an alleged leak.

---

## Cross-system composition concerns for the synthesis pass

1. **H-7C1 ↔ sync-work/budget (System 4).** The capacity commit is a scheduling-model defect discovered
   from the cache side. The two systems must be reconciled together: the cache's atomicity invariant
   (2865–2866) is what *forbids* the checkpoint that System 4's remedy pattern would insert. Any fix that
   adds an interior yield breaks 1299's concurrency guarantee; any fix that keeps atomicity must instead
   ceiling U — i.e. introduce a call-wide unique-fragment or requested-dbId ceiling, which is a new
   public-API constraint, not a prose change. Recommend the synthesis pass treat this as one joint finding.

2. **H-7C1 ↔ the existing `[CONTRADICTION] 4.5.6`.** Risks at 4628–4630 still asserts in the present tense
   that "the budgets do now bound the worst case", while 2110–2125 denies any finite guarantee. H-7C1 adds
   a third uncapped span that neither side accounts for, making the Risks claim wrong for one more reason
   and the budget section's exclusion list incomplete.

3. **M-7C1 ↔ geometry pipeline (System 2).** The geometry auditor is checking the same `BlasCache`/
   connectivity keyspace silence from the build-pipeline side. The two views should converge on M-7C3
   first: whether `BlasCache` is a keyspace at all is the prior question, and its answer decides whether
   M-7C1 needs a subset statement or a correction to 3224–3226's four-cache framing.

4. **M-7C2 ↔ System 4's excluded-span accounting.** The uncosted `BlasCache`/connectivity clears sit inside
   row 1951, which System 4's span model treats as one of exactly two accepted-unbounded rows. If those
   clears are separate keyspaces, the "accepted risk" is broader than the row states, and gate criterion 9
   (4527–4539) measures only part of what it claims to bound.

5. **L-7C2 ↔ lifecycle (System 1) checkpoint universality.** The admission step's safety rests on
   2039–2044's "the two-part revalidation … is never itself skipped" plus the no-`await` rule. That is the
   same universal claim System 1's `[SILENT] 1.5.2` shows is not honoured at the abort-only `bvhcast`
   sites. If the universal rule needs narrowing to fix 1.5.2, the narrowing must not remove the guarantee
   L-7C2 depends on.

6. **`[AMBIGUOUS] 5.2.5` (singular vs. plural "affected epoch") interacts with H-7C1.** 2860–2867 and
   1290 say "the affected epoch" (singular, consistent with `source.model === target.model`); 1952 says
   "any affected epoch's bucket … O(1) **per affected epoch**". Under a future cross-model milestone the
   commit becomes multi-epoch and the atomicity requirement extends across buckets — which multiplies
   H-7C1's span and makes the missing classification harder to add later than now.

7. **`[AMBIGUOUS] 5.4.6` ("rejects synchronously" for a `Promise`-returning method)** matters for L-7C3:
   whether a capacity or commit failure throws before the promise exists or rejects it determines whether
   an extension callback (which the Viewer invokes without try/catch — 3169–3181) can be destroyed by it.
   3727–3729 vs. 3000/2726 remain unreconciled.
