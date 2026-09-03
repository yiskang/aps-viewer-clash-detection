# Invariant Audit v8 — System 5: Cache ownership / cleanup / concurrency

**Target**: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (**4812 lines**,
current working tree — Round 30's 25-hunk fix pass is present but **uncommitted**; HEAD still holds the
4712-line post-Round-29 text).
**Model consulted**: `invariant-audit-v8-model.md` §5, with §1/§2/§4 and §6(d) cross-references.
**Method**: every line citation below was verified against the current working-tree spec in this pass —
the High section, M-8C1/M-8C2/M-8C3/M-8C5 and the non-defect list by direct sequential read, and every
carried-forward Medium/Low anchor (M-8C4's 1308 / 1416–1424, M-8C6's 4158–4172 / 4186–4195 / 4417–4432,
L-8C4's 1303–1306, L-8C6's 3709–3720 / 3745–3751, L-8C8's 2641–2647 / 3529–3553, and the sweep-cost and
gate-criterion anchors 1967 / 4527–4532 / 4619–4631) by targeted re-read of the live lines, **not** carried
on the v8 model's or v7's authority. `round-30-high-only-fix-pass-disposition.md` was read for orientation
only and **treated as evidence of nothing** — each of its H-3-related claims was re-derived from live text, and `git diff -U8` was used to
establish exactly which regions Round 30 did and did not touch (rather than trusting either the disposition
doc's or the v8 model's account of that). Where this audit disagrees with the v8 model, the disagreement is
stated explicitly.

**Changelog discipline**: lines 40–799 are the past-tense `## Revision Notes (post-review)` changelog and
are **not** cited as invariants anywhere below. All citations are to the normative body (801–4812) or the
Status header (1–38).

**Counts: 0 Critical, 2 High, 6 Medium, 10 Low.**

**Headline verdict on H-3**: the *mechanism* is sound and the atomicity/zero-mutation guarantee v7 verified
is **undisturbed** — but the fix is **incompletely propagated** (H-8C1) and its own new regression fixture
carries a rationale that **asserts the negation of the fix's central soundness property** (H-8C2). Both are
Round-30 regressions, and neither appears in `invariant-audit-v8-model.md`, whose §6(d) rates H-3
"HOLDS (fixed)".

---

## Critical

None.

---

## High

### H-8C1 — Round 30's precheck was added to Data Flow but **not** to the `CollisionInstance` cache's own canonical statement in Components, which still describes an unbounded four-step sequence — and the tier passage that consumes the new bound cross-references Components *for the precheck*, where it does not exist

**NEW — a Round-30 regression.** Verified by `git diff -U8`: the hunk list contains **no hunk anywhere in
1222–1306**. The nearest edits are at 1455–1483 (H-4's gate-input provenance) and 1950–1969 (the
atomic-operations table). The Components-section statement of the admission sequence is byte-identical to
its post-Round-29 form.

The spec states the same admission rule at three sites. v7's historical observation #4 recorded them as
mutually consistent. Round 30 updated two and left the third:

| Site | Precheck present? |
|---|---|
| **Data Flow** step 3, 2894–2939 | **yes** — new step 2 at 2903–2911 |
| Atomic-operations table row, 1969 | **yes** — "via the call-wide precheck (see **Data Flow** step 3)" |
| **Components**, `CollisionInstance` identity cache, 1289–1306 | **no** |

`grep -n "precheck"` over the whole file returns 1969, 2094, 2109, 2907, 2921, 4368, 4370, 4602, 4606 —
**nothing in 1222–1306**.

What Components still says, verbatim (1289–1297):

> "After every requested dbId's extraction walk completes — not per dbId, per node, or per fragment — and
> after the walk's last possible yield, `findClashes` **looks up the affected epoch's bucket without
> creating it** if absent, and recomputes which ids from the call's complete unique fragment-id set are
> still missing against that bucket's *current* contents… It then, in that same synchronous step … checks
> `currentBucketSize + uniqueMissingCount` against the limit for the affected epoch."

This is an exhaustive-sounding account of everything that happens between the walk's completion and the
commit, and it names the **bucket lookup** as the first post-walk action. Data Flow now says the first
post-walk action is the precheck, "**Before touching any cache bucket**" (2903). An implementer working
from Components alone builds exactly "a design that only implements the bucket-capacity check" — which the
spec's own new fixture at 4372–4373 says **must fail**. The zero-mutation guarantee's scope is also
un-updated: Components 1301 says "specific to a capacity rejection" where Data Flow 2937 now says
"specific to a capacity rejection (step 2's or step 4's)".

**Why this is High rather than Medium (stated precisely, since one of the two candidate cross-references
turns out to be fine).**

- **2093–2094 is a dangling pointer** — the enforceably-bounded tier, the passage from which the ≈24.8ms
  addend is derived, reads: "the `maxCollisionInstancesPerEpoch`-bounded `CollisionInstance`
  capacity-admission recompute-and-commit — see the atomic-operations table and **"`CollisionInstance`
  identity cache" under `GeometryRegistry` for its own precheck**." The named section contains no
  precheck. This is the site that actually breaks.
- **1969 is split, and its precheck pointer is correct** — the row names Components only for the *unit's*
  definition ("steps under "`CollisionInstance` identity cache," see `GeometryRegistry`"), which is a fair
  description of where the recompute-and-commit is defined, and it points at the right place for the bound
  itself: "bounded by `maxCollisionInstancesPerEpoch` … **via the call-wide precheck (see Data Flow step
  3)**". Recorded explicitly so a re-verifier does not read this finding as claiming otherwise.

So: the bound has exactly one normative home (Data Flow step 3), the tier passage that consumes the bound
sends the reader somewhere else for it, and the section it sends them to still describes an unbounded
four-step sequence whose first post-walk action is the bucket lookup. That combination is a present-tense
normative conflict about a step ordering a fixture (4366–4374) and a gate criterion (4601–4610) both pin.
It is also the cheapest finding in this document to close: Components is the section 2934–2936's
"'Look up or create' … means exactly this sequence" defines the document's vocabulary against.

**Not a correctness defect in the mechanism.** Both statements' *outcomes* agree extensionally (see M-8C1's
derivation and the non-defect list, item 2): a call rejected by step 2 would also be rejected by step 4.
What differs is (a) whether a bucket lookup happens first, which the new fixture and gate criterion 8 both
assert must not, and (b) whether the O(U) recompute is bounded at all, which is the entire H-3 fix.

### H-8C2 — The new regression fixture's stated rationale is factually false and asserts the negation of the precheck's own "never premature" / "cost, not outcome" guarantees

**NEW — a Round-30 regression.** The fixture at 4366–4374 is new in this pass (diff hunk
`@@ -4285,16 +4358,25 @@`).

Verbatim, 4370–4374:

> "Regression test distinguishing the precheck (step 2, keyed on the walk's own unique-fragment count)
> from the bucket-capacity check immediately above (step 4, keyed on the bucket's combined contents) — a
> design that only implements the bucket-capacity check passes the fixture above but fails this one,
> **since an empty bucket never trips a combined-total check no matter how large the query's own unique set
> is.**"

The bolded clause is false against the spec's own formula. Step 4's check is stated at 2918–2919 as
`currentBucketSize + uniqueMissingCount` against `maxCollisionInstancesPerEpoch`. In this fixture's own
scenario — empty bucket, `U > ceiling` — that evaluates to `0 + U = U > ceiling`, so the combined-total
check **does** trip. An empty bucket is precisely the case where the combined total *equals* the query's
own unique set.

**It contradicts two other present-tense normative statements, both added by the same pass:**

1. **2905–2907**: "a bucket capped at `maxCollisionInstancesPerEpoch` can never need more instances
   constructed in one admission than that ceiling allows, whatever the bucket's existing contents are, so
   **this rejection is never premature**." The soundness of "never premature" *depends* on step 4 rejecting
   the same call. If 4373's clause were true, step 2 would reject calls step 4 admits — i.e. the precheck
   would be premature, by exactly the case the fixture selects.
2. **2921–2925**: "**Step 2's precheck does not replace this check** … step 2 only bounds this step's own
   ***cost***, not its ***outcome***." 4373's clause asserts an outcome difference: a step-4-only design
   would (it claims) *admit* a call step 2 rejects.

So the document's own new fixture prose states that the precheck changes outcomes, three hundred lines
after the document argues at length that it does not. Exactly one of the two can be true, and the false one
is the fixture's.

**Does the fixture nevertheless test what it claims?** Partly, and by accident:

- Its **assertions** are sound and do discriminate: "asserted via spies: zero calls to the bucket-lookup
  path, zero `CollisionInstance` constructions" (4368–4369). A step-4-only design performs a bucket lookup
  at step 3, so it fails the *first* spy. The fixture's verdict ("fails this one") is therefore correct —
  but for the opposite reason to the one given. The stated reason predicts failure via a wrong *result*;
  the actual mechanism is failure via a wrong *call sequence*.
- Its spies do cover the cost property in the **rejection** direction: "zero calls to the bucket-lookup
  path, zero `CollisionInstance` constructions" means the recompute never runs at all in the oversized
  case. What it does not exercise is bounded cost **at** the ceiling — the property that actually earns
  row 1969 its "enforceably bounded" classification. That is deferred entirely to gate criterion 8
  (4601–4610), which cannot run until `maxCollisionInstancesPerEpoch` has a value (L-8C5).
- It does **not** pin the "never premature" direction in general. The nearest coverage is the sibling
  fixture's second half (4363–4365, "a repeat call querying only fragments already resident … must succeed
  normally"), which happens to be a `U ≤ ceiling` admit case. There is no fixture for the discriminating
  case — `U ≤ ceiling` with a non-empty bucket where `|B ∪ U| ≤ ceiling` — that would catch a precheck
  wrongly implemented against `|B| + |U|` instead of `U`.

**Severity.** High under this lineage's bar: a present-tense normative contradiction, in text a test author
is meant to implement from, about the exact property the round's headline fix claims to establish. It is
not Critical because no *runtime* result is wrong — the fixture's assertions still fail the design they are
meant to fail.

---

## Medium

### M-8C1 — "this rejection is never premature" is stated unconditionally, but is only provable under the singular-affected-epoch reading the same table row contradicts in the plural

**NEW as a defect; the underlying singular/plural ambiguity is PRE-EXISTING** (v7 cross-system note 6;
v8 model `[AMBIGUOUS] 5.2.5`). Round 30 made it load-bearing.

The precheck compares a **call-wide** count `U` (2903–2904, 2896–2897: "the walk's complete, call-wide
unique fragment-id set") against a **per-epoch** ceiling (2904, 2918). Its soundness argument (2905–2907)
is unqualified: "whatever the bucket's existing contents are, so this rejection is never premature."

Independently re-derived, single-epoch: let `B` be the bucket's contents, `U` the call's unique set. Step 4
rejects iff `|B| + |U \ B| > ceiling`. `B` and `U \ B` are disjoint, so `|B| + |U \ B| = |B ∪ U| ≥ |U|`.
Hence `|U| > ceiling ⟹ |B ∪ U| > ceiling ⟹` step 4 rejects. Sound in both directions, empty bucket
included. This matches the v8 model's 5.2.4 and I confirm it.

But the document maintains **both** an affected-epoch-is-singular reading (1290, 1296, 2912, 2918, 3745)
and an affected-epochs-may-be-plural reading in the atomic-operations table row that governs this very
check — 1968: "would push **any affected epoch's** bucket over the limit", "O(1) **per affected epoch**".
Under the plural reading the derivation fails: two epochs each receiving `U/2` fragments, with
`U > ceiling` but each epoch's own combined total `≤ ceiling`, is rejected by step 2 and admitted by step 4
— a **premature rejection**, i.e. a call that could have produced a correct result is refused. Milestone 1's
`source.model === target.model` restriction (2768–2772) makes this unreachable today, so it is not
Critical; but the claim as written is unqualified, and it is now the load-bearing premise of a taxonomy
classification rather than a local aside. The one-clause fix (scope the claim to "the single affected epoch
this milestone's same-model restriction guarantees") was available and not taken.

### M-8C2 — `maxCollisionInstancesPerEpoch` now serves two purposes whose gate criteria push its value in **opposite** directions, with no reconciliation stated

**NEW.** The v8 model records the dual load-bearing (5.1.9) but not the conflict.

Round 30 gave the constant a second job. It is now simultaneously:

- a **retention ceiling** — 1282–1288, "limits the number of canonical instances retained for one live
  epoch"; and
- the **only bound on a non-preemptible synchronous span** — 1969, "bounded by
  `maxCollisionInstancesPerEpoch` … via the call-wide precheck"; 2108–2109, "the fifth capped at
  `maxCollisionInstancesPerEpoch` instances constructed".

The gate's two criteria for it pull opposite ways:

- **Criterion 11** (4632–4641) pushes it **up**: record "whether `maxCollisionInstancesPerEpoch` needs to
  be set meaningfully **above** [the MEP model's full unique-fragment] population to avoid spurious
  rejections."
- **Criterion 8** (4601–4610) plus the tier arithmetic push it **down**: the span's cost is `O(ceiling)`
  allocations plus two `Object.freeze` calls each (1251–1252), and 2114–2117 requires that "if either
  measurement exceeds ~16.8ms, this tier's addend, and the ≈24ms figure everywhere it's cited, must be
  revised upward."

These are not obviously satisfiable together at realistic scale: a value large enough to cover an MEP
model's whole unique-fragment population is plausibly one to two orders of magnitude above what an
`O(ceiling)` construct-and-freeze loop can do inside ~16.8ms. The spec discloses half the problem —
2111–2114 marks ≈24ms provisional "for the fifth, until `maxCollisionInstancesPerEpoch` itself is given a
chosen value" — but nowhere states that the two criteria constrain the same number in opposite directions,
or what governs if they cannot both be met. Until that is settled, "enforceably bounded" (1969) is a
classification whose bound is not merely unmeasured but possibly unsatisfiable at the value the other
criterion requires. This is the *residue* of v7's H-7C1: Round 30 converted an unbounded span into one
bounded by an unchosen constant, which is a genuine improvement, not a closure.

### M-8C3 — `BlasCache`'s status as a cache is still internally inconsistent: "storage behind a phase slot" vs. one of four independently-cleared caches

**PRE-EXISTING and still open.** v7 M-7C3; v8 model `[AMBIGUOUS] 2.6.3`. **Confirmed untouched by Round
30** — no diff hunk falls in 1496–1546 or 3274–3316.

Two current-text readings, both normative and unannotated:

- **Storage behind a slot** — 1512–1521: "that dedup is **not** a mechanism `BlasCache` owns. It is the
  registry-level rule above applied to one phase … `accelerationPromise` is one of that entry's
  single-flight phase slots … `BlasCache` owns building the `MeshBVH` and **caching it behind that phase
  slot** — not the not-building-it-twice rule". Under this reading `BlasCache` has no keyspace at all; the
  BLAS lives on the `GeometryRecord` (1229–1231) and both release paths reach it for free.
- **A distinct cache with its own clear** — 3290–3293: "`dispose()` also wholesale-clears **all four
  caches** — `GeometryRegistry`, `BlasCache`, every cached `GeometryConnectivity`, and the
  `CollisionInstance` identity cache — **each in its own single clear operation**"; the same enumeration at
  3495–3497. Under this reading it has its own keyspace and M-8C4's missing subset statement is
  load-bearing.

A slot on a registry entry cannot also require its own independent clear operation. Which reading is
correct decides whether M-8C4 is a documentation nicety or a completeness precondition, and whether M-8C5
counts one missing cost model or two.

**Interaction with the new precheck (asked explicitly):** none — and this is worth stating positively.
The precheck reasons only about the `CollisionInstance` cache's own keyspace, which is the one cache with
an explicit keyspace-relationship argument (1278–1280). It makes no claim, implicit or otherwise, about
`BlasCache`'s or connectivity's keyspaces. It also cannot leak into them: capacity admission runs at the
end of Data Flow step 3's extraction, **before** the broad phase (2940) and therefore before the narrow
phase (2991) creates any `GeometryRegistry` entry, so a step-2 rejection leaves no registry entry, no BLAS
and no connectivity behind for this call. Round 30 introduced no new coupling here.

### M-8C4 — Still no keyspace-relationship statement for `BlasCache` / cached `GeometryConnectivity` relative to `GeometryRegistry`, so `evictModel`'s derived release of both is unproven in text

**PRE-EXISTING and still open.** v7 M-7C1; v8 model `[SILENT] 2.6.4 / 5.3` table. **Confirmed untouched by
Round 30** — no hunk in 3159–3316.

`evictModel`'s release of these two is **derived from** the registry sweep, not independent — 3182–3186:
"`releaseEpochScopedState` sweeps GeometryRegistry for every entry filed under the object's own admitted
epoch … and drops each one, **together with its cached BLAS and cached connectivity where it has any**". A
derived release is complete only if the derived-from keyspace is a superset. The spec never says it is.

The asymmetry is the tell, and it is sharper than ever after Round 30: the `CollisionInstance` cache
received exactly this analysis, twice (1278–1280; 3186–3190, "as an independent operation over a different
keyspace … a strict superset of the registry's lazily-built candidate-pair keyspace"), and Round 30 leaned
on that same keyspace vocabulary again in the precheck's justification. No corresponding sentence exists
for `BlasCache` or connectivity anywhere in the file.

**Assessment unchanged from v7 and re-verified this pass: a real documentation gap, not a demonstrable
leak.** Every window I could trace is closed by other rules — 1308 builds the BLAS "per `GeometryRecord`",
so nothing is cached for a geometry with no entry; a rejecting phase removes the entry "synchronously as
part of that rejection" (1416–1424); removal is identity-guarded on both paths (1422–1424, 3198–3200,
3304–3305); and the only path that could remove a `'ready'` entry with a resident BLAS while a lazy
connectivity build is outstanding is itself the release sweep that already removed the entry (3190–3200).
The subset property holds **by construction**, by an argument the spec does not make, about a property it
does not state, for a path it itself labels a "state-release/cleanup completeness concern" (3213–3216).

### M-8C5 — The release-path cost model and gate criterion 10 still cover 2 of the 4 caches `dispose()` clears

**PRE-EXISTING and still open.** v7 M-7C2. **Confirmed untouched by Round 30** — no hunk in 1967 or
4619–4631.

Row 1967 is the only cost model in the document for the sweep/clear, and it accounts for two of four:
it prices the `GeometryRegistry` half enumeratively, then states "This cost model covers only the
`GeometryRegistry` half of the sweep — the same step also performs an independent deletion over the
`CollisionInstance` cache's own keyspace … `evictModel` [is] one outer-`Map.delete(loadEpoch)` call, O(1)
… `dispose()` … one outer-`Map.clear()` call over *every* live epoch's bucket at once … unstated and
unmeasured here." `BlasCache`'s own single clear and the cached-`GeometryConnectivity` clear are priced
nowhere — not folded into the registry half (3292 makes them explicitly *separate* operations) and not
named as independent clauses.

Gate criterion 10 (4619–4631) inherits the same shape: it names the registry sweep and the
`CollisionInstance` clear, and neither `BlasCache` nor `GeometryConnectivity`. Since row 1967 is one of
exactly two rows the worst-case-span formula **excludes** from any finite guarantee (2151–2156,
4527–4532), an unpriced component of it sits inside an already-uncapped accepted risk with no measurement
obligation attached.

**Aggravated slightly by Round 30**, though only in relief: the pass added a whole new gate criterion (8,
4601–4610) for a span it had just bounded, demonstrating that adding criteria was in scope, while these two
uncosted clears kept none.

### M-8C6 — Still no fixture verifies release *completeness* for any cache; the new capacity fixtures continue the spy-on-the-call-path pattern

**PRE-EXISTING and still open.** v7 M-7C4; v8 model `[SILENT] 5.3.2`.

3213–3216 identifies release completeness as its own risk class ("a **state-release/cleanup completeness
concern**, not a liveness-correctness one — the object is correctly dead either way — but it is required
for the design to actually reclaim what it claims to"). Nothing in Testing & Verification (3865–4650)
tests it. Re-verified in current text:

- 4417–4432 (evict-before-admit at 4422, double eviction at 4429) assert that `releaseEpochScopedState` **was or was not
  invoked**, via a spy — never that the four caches are afterwards empty for that epoch.
- 4158–4172 / 4186–4195 assert that "the evicted entry must no longer be present in `GeometryRegistry`" —
  the closest thing to a completeness assertion, covering exactly one cache in exactly the in-flight-build
  scenario.
- `dispose()`'s four-cache clear (3290–3293) still has **no** fixture asserting all four end up empty.

Round 30's two capacity fixtures (4360–4374) are the same shape: both assert via spies on the *call path*
("no `PlacedCollisionInstance` is constructed"; "zero calls to the bucket-lookup path, zero
`CollisionInstance` constructions") rather than on resulting cache state. That is the right shape for a
*zero-mutation* property and I am not calling it wrong — but it means the pass added two fixtures to this
cache and still left the `dispose()`/`evictModel` emptiness question with no test at all, while M-8C4
leaves two of the four caches' release completeness argued only by derivation.

---

## Low

### L-8C1 — Step 2's own justification misnames the unit it bounds

2909–2911: "This is what makes **step 4's** recompute-and-commit an **enforceably bounded** … synchronous
span." The recompute is **step 3** (2912–2916); step 4 is the capacity check plus the commit. Row 1969
names the unit correctly as "the recompute-missing scan plus the construct-freeze-and-publish loop, run in
the same synchronous step". The two are one synchronous span (step 4 opens "In that same synchronous
step"), so the referent is recoverable, but the sentence names half of what it bounds — and the O(U) half
it omits (step 3's recompute) is the half whose cost was the whole point of v7's H-7C1.

### L-8C2 — Step 2's position relative to the walk's last yield, and to steps 3–4's atomic step, is unstated

Step 3 opens "**After the walk's last possible yield**" (2912); step 4 opens "**In that same synchronous
step**" (2917). Step 2 (2903–2911) carries neither qualifier — only "Before touching any cache bucket". So
the text does not say whether a yield may occur between the precheck and the lookup.

**Harmless as written, and I verified it**: `U` is fixed once the walk completes, so an intervening yield
cannot invalidate the precheck's own premise; a concurrent commit during such a yield is absorbed by step
3's recompute-against-current-contents and step 4's re-check; and a lifecycle change is caught by the
yield's own two-part revalidation (2064–2073). Recorded only because the atomicity requirement in this
sequence is stated with unusual precision everywhere else, and a reader cannot tell from 2903–2911 whether
step 2 is inside or outside the guarded step.

### L-8C3 — The capacity-admission sequence still states no lifecycle revalidation of its own, and the precheck does not add one

**PRE-EXISTING** (v7 L-7C2). 2894–2939 walks five steps and never mentions `disposed` or the model's epoch,
yet step 4 *creates a bucket* — a write into world-owned cache state. Safe only by composing two facts
stated elsewhere: the two-part revalidation is unconditional at every checkpoint and again on every resume
(2064–2073), and step 3/4 run after the walk's last yield with no `await` (2917–2918). Neither is
cross-referenced at 2917–2928.

**In tension with §1.5.4 of the v8 model**, which shows the universal-revalidation claim L-8C3 leans on is
not honored at the abort-only `bvhcast` sites — and whose scope Round 30 *widened* by admitting
`SurfaceIntersectionQuery` to that tier. Any narrowing of the universal rule to fix that must not remove
the guarantee this step silently depends on.

### L-8C4 — A synchronous throw inside the commit still leaves a partially-populated bucket resident; the precheck does not address it

**PRE-EXISTING** (v7 L-7C3). The zero-mutation guarantee is scoped, in identical words at both sites, to
*capacity rejection* only — 1301–1303 and 2936–2939. Round 30 widened the scope parenthetical to
"(step 2's or step 4's)" at 2939 but not the substance: neither statement addresses a failure **inside**
step 4's commit loop, which both creates the bucket and constructs+freezes N instances. An allocation
failure partway through leaves a bucket that exists, is partially filled, counts toward
`maxCollisionInstancesPerEpoch` for every later call, and is reclaimable only by epoch eviction or disposal
(1303–1306, "Entries are never individually evicted while their epoch remains live"). No rollback is
specified and no error class is named. This is the one interruption the atomicity requirement does not
exclude.

### L-8C5 — `maxCollisionInstancesPerEpoch` still has no chosen value, while a second classification now depends on it

**PRE-EXISTING** (v7 L-7C4), **aggravated**. "Provisional, value not yet chosen" at 1968 and 1969;
"provisional, unmeasured" at 1282. It is now the sole enforcement behind row 1969's "Enforceably bounded"
classification and behind the fifth member of the enforceably-bounded tier (2104–2117). The spec discloses
this honestly at 2111–2114; see M-8C2 for the part it does not disclose.

### L-8C6 — The Error Handling bullet still garbles its own predicate, does not describe the precheck's own path, and its self-labelled `[SILENT]` count is now stale

**PRE-EXISTING** (v7 L-7C1 / L-7C7), **now also incomplete**. 3745–3751:

> "if committing the call's missing `CollisionInstance`s would push **`maxCollisionInstancesPerEpoch` over
> its limit**, the entire `findClashes` call rejects before any bucket is created or mutated … and carrying
> no named error class, **the same `[SILENT]` gap those three share**."

Three defects in one bullet:
1. `maxCollisionInstancesPerEpoch` *is* the limit; the thing pushed over it is the bucket. Both sibling
   statements get it right (1295–1296, 1968).
2. There are now **two** rejection paths in this sequence, and this bullet describes only step 4's
   predicate. It happens to remain extensionally correct — a step-2 rejection implies committing would push
   the bucket over — but it does not state the precheck's stronger "before any bucket **lookup**"
   guarantee, which is what gate criterion 8 (4606–4608) and fixture 4368 require.
3. "those three" now undercounts: with the precheck there are **five** call-level ceiling rejections with
   no named error class (`maxFragmentsPerDbId` 3709–3720, `maxChildrenPerNode` 3721–3739,
   `maxBroadPhaseInstancePairs` 3740–3744, step 4's capacity check, step 2's precheck).

The literal `[SILENT]` audit-vocabulary token leaking into normative prose (3751, the file's only
occurrence) is the same defect v7 recorded as L-7C7; the underlying substance is honestly disclosed, the
token is not prose.

### L-8C7 — Row 1968's "checked once per call" is now inaccurate

1968: the capacity check is "**checked once per call**, synchronously, with no intervening `await` between
the check and committing every missing instance." After Round 30 the ceiling is checked **twice** per call
(step 2 against `U`, step 4 against `|B| + |U \ B|`). The clause's intent — that the check is per call
rather than per fragment or per dbId — survives; the literal count does not. Row 1968 received no edit in
this pass (the new material went into a separate row, 1969).

### L-8C8 — The extension-owned room cache has no capacity ceiling and no eviction policy, and sits outside `dispose()`'s four caches

**PRE-EXISTING** (v7 L-7C5). `Map<Model, Promise<number[]>>` keyed by the exact `Model` object
(2641–2647). `world.dispose()` never touches it and `evictModel` does not either — "The handler must
therefore drop that object's room-cache entry unconditionally, independent of what `evictModel` does"
(3258–3260, restated 3554–3558). It is cleared only as `unload()`'s third step, which 3529–3553 documents
as **strandable** on a repeated `unload()`. Nothing bounds how many `Model` keys accumulate. Low because a
strong `Map` key on `Model` in a per-viewer extension is a bounded-in-practice leak, and 3549–3553 already
declares `unload()`'s per-step isolation an open question.

### L-8C9 — `referenceCount` is still a dangling field in the cache's record shape

**PRE-EXISTING** (v7 L-7C6). 1225–1227: "a `referenceCount` (**reserved, unused in Milestone 1** — release
is epoch-scoped, not reference-counted…)". Grep-confirmed: the only other occurrence in the file is
changelog line 672. No increment site, decrement site, semantics, or forward contract. A reserved field on
a cache record that the release model explicitly does not use invites an implementer to wire it up.

### L-8C10 — Step 1's capture set is materialized for all of `U` **before** the precheck can reject, so the precheck bounds work but not allocation

Step 1 (2899–2902, unchanged by Round 30 — verified in the diff) captures, for every unique fragment the
walk collects, a `fragmentId`, a `GeometryIdentity`, **and this call's own `worldMatrix`/`worldBounds`
snapshot**. Its size is `U`, bounded only by `maxFragmentsPerDbId × |requested dbIds|`, and no
`maxRequestedDbIds`-style constant exists anywhere in the file (grep-confirmed; the only call site,
2754–2756, passes an arbitrary-length room list straight through).

No normative claim is falsified — 2907–2908 is carefully worded as `U ≤ maxCollisionInstancesPerEpoch`
"for every later step in this sequence", and step 1 is earlier. Low, not Medium, for that reason, and
because the walk producing it is cooperatively checkpointed between dbIds and between sibling nodes
(2775–2777, 2859–2861), so this is a **memory/allocation** gap rather than a synchronous-span one. Recorded
because the H-3 framing ("`U` is now bounded") reads more broadly than the fix actually is, and because two
`Float`-array snapshots per fragment at `U` in the 10⁵ range is the same order of magnitude that motivated
the finding in the first place.

---

## Historical-only / non-defect observations

Each was checked because a prior round, the v8 model, or the task brief flagged it; each is **currently
sound** in the text read this pass. Recorded so the synthesis pass does not re-open them.

1. **The step-2 precheck does not disturb the atomicity or zero-mutation guarantee v7 verified.** v7's
   H-7C1 concluded "the atomicity holds; nothing can observe a half-populated bucket." That is still true,
   and step 2 strengthens rather than weakens it: it is a pure read of call-local walk data (`U`) with no
   bucket access at all (2903–2905, "without looking up or creating any bucket"). Steps 3 and 4 remain one
   synchronous step with "no intervening `await`, no call out to any external callback, getter, or other
   reentrant operation" (2917–2918), unchanged by the diff except for the step renumbering and the
   cost-vs-outcome clause. No concurrent reader can observe a half-populated bucket; `evictModel`/
   `dispose()` cannot interleave between check and commit. **No new race is introduced.**
2. **The precheck's soundness derivation is correct** (see M-8C1's re-derivation) under the single-affected-
   epoch reading Milestone 1 guarantees. The precheck admits no call step 4 would reject and rejects no call
   step 4 would admit, for **any** bucket contents including empty, and it does bound `U` for every admitted
   call. This is the one thing the disposition doc claims that survives independent re-derivation intact.
3. **Step ordering is internally consistent.** Precheck (2) → bucket lookup without creation (3) →
   recompute-missing (3) → bucket-capacity check (4) → construct-and-commit (4) → placement (5). Each step's
   preconditions are satisfied by its predecessors; no step reads state a later step establishes.
4. **A step-2 rejection leaves no cross-cache residue.** Capacity admission runs at the end of extraction,
   before the broad phase (2940) and the narrow phase (2991), which is where any `GeometryRegistry` entry,
   BLAS, or connectivity would first be created. The new rejection path therefore cannot orphan geometry
   state, and needs no keyspace argument of its own.
5. **Frozen `CollisionInstance` identity holds.** 1250–1253 (contents are only `fragmentId` + immutable
   `GeometryIdentity`, both frozen; "**no `Model`, `GeometryRecord`, BLAS, world matrix, world bounds, or
   other call-varying or mutable state**"), reinforced from the broad-phase side at 2981–2984. Cache hits
   are read-only: 1257–1258.
6. **Call-local placement holds.** 1260–1268 / 2981–2990 / fixture 4351–4359 agree; the mid-scan suspension
   argument still rests on it.
7. **The independent epoch sweep for the `CollisionInstance` cache holds at all three sites** — 1270–1280
   (declaration, with the superset rationale), 3186–3190 (`evictModel`), 3290–3293 + 3495–3497
   (`dispose()`).
8. **The oversized-marking carve-out is present on both release paths** — 3183–3186 and 3305–3307, declared
   at 1444–1452.
9. **The entry-scoped cancellation signal's lifetime rule is consistent** across 1425–1443, 3190–3200, and
   3298–3307: entry-lifetime scope across `'building' → 'ready'`, exactly-once rejection, identity-guarded
   delete.
10. **v7's M-7C1/M-7C3/M-7C2/M-7C4 were genuinely not touched by Round 30**, as the disposition doc claims —
    established by diff, not by trusting the claim. Carried forward here as M-8C4/M-8C3/M-8C5/M-8C6.
11. **The public API's own contracts need no precheck edit — checked, and clear.** Grepped 3059–3316 (the
    whole TS block, including `findClashes`'s contract at 3066–3102) for `ceiling` / `capacity` /
    `maxCollision` / `CollisionInstance` / `reject`: the only rejections it enumerates are the three
    entry-order ones (`disposed`, cross-model, `'evicted'`), and its only `CollisionInstance` mentions are
    `evictModel`'s and `dispose()`'s release clauses. **No capacity-ceiling rejection is enumerated
    anywhere in the public API block**, so H-8C1 has exactly the two affected sites named there and no
    fourth. (That the public contract enumerates none of the five call-level ceiling rejections at all is
    the pre-existing gap L-8C6 records, not a new one.)
12. **Gate criterion numbering survives the insertion.** Criterion 8 was inserted at 4601 and the only
    numbered cross-references in the file are to "criterion 1" and "criterion 7"; `enumNodeChildren` is
    still the seventh bullet. Grep-confirmed: no stale "criterion 8"/"criterion 9" reference exists.

---

## Cross-system composition concerns for the synthesis pass

1. **H-8C1 ↔ the whole v8 pass.** `invariant-audit-v8-model.md` §5.2 transcribes the five-step sequence
   from Data Flow (2894–2939) and cites "1289–1306" in the same heading without noting that the Components
   text does not contain the precheck; its §6(d) then rates H-3 "HOLDS (fixed)". The model's §5.2.4
   derivation is correct and I confirm it, but its *propagation* check missed the third site. Synthesis
   should treat H-8C1 as an amendment to the model's §6(d) verdict, not as an independent disagreement
   about the mechanism.

2. **H-8C2 ↔ the geometry auditor's fixture review.** Round 30 added or amended fixtures in three places
   (3967–3970, 4198–4199, 4366–4374). Only one of them (4366–4374) carries a self-derived rationale, and
   that rationale is the one that is false. Worth a cross-check on whether the H-1/H-4 fixture edits carry
   similar unverified justifications.

3. **M-8C2 ↔ System 4 (budget/scheduling).** The capacity-admission span moved out of "accepted atomic
   risk" and into the enforceably-bounded tier whose addend *is* the ≈24.8ms headline. System 4's auditor
   is looking at the same tier from the span side; the two views must be reconciled on one question:
   **can `maxCollisionInstancesPerEpoch` simultaneously satisfy criterion 11 (large enough to avoid
   spurious rejections) and criterion 8 (small enough that `O(ceiling)` construct-and-freeze fits under
   ~16.8ms)?** If not, either the tier membership or the retention model has to give, and that is an
   architecture decision, not a prose fix.

4. **M-8C3 ↔ System 2 (geometry pipeline).** As in v7, the prior question is whether `BlasCache` is a
   keyspace at all. Its answer decides whether M-8C4 needs a subset statement or whether 3290–3293's
   "all four caches" framing needs correcting. Round 30's precheck gives a fresh precedent for how the
   document *does* state a keyspace-relationship argument when it wants to (2905–2907 reuses the same
   superset vocabulary as 1278–1280), which makes the two silences harder to defend as stylistic.

5. **L-8C3 ↔ System 1 (lifecycle) checkpoint universality.** Unchanged from v7's note 5, and now with a
   wider blast radius: the universal-revalidation claim at 2064–2073 that the admission step's safety rests
   on is the same claim the abort-only tier does not honor, and Round 30 added a second traversal to that
   tier. Narrowing the universal rule to fix the lifecycle gap must preserve what this step depends on.

6. **M-8C1 ↔ any future cross-model milestone.** The singular/plural "affected epoch" ambiguity is now
   load-bearing in a way it was not in v7: a call-wide count is compared against a per-epoch ceiling. Under
   the plural reading the precheck becomes premature (rejects calls the capacity check would admit), which
   converts an inert wording ambiguity into a wrong-result defect the moment `source.model !==
   target.model` is allowed. Cheapest fix now, most expensive later.

7. **L-8C6 ↔ System 1 error types.** The fifth unnamed-error-class rejection path is a cache-side symptom
   of the lifecycle system's `[SILENT]` 1.6.3/1.6.5. Any pass that names error classes for the four
   existing ceiling rejections must pick up the precheck's as a fifth, and decide whether step 2's and step
   4's rejections are distinguishable to a caller (they have different guarantees — "before any bucket
   lookup" vs. "before any bucket mutation").

---

## Method note on second opinions

One `codex-advisor` consult (medium effort, request `20260903-143150-85236-9730`) was run on H-8C2's
arithmetic and M-8C1's plural-epoch case, **after** both findings had already been derived from primary
text — i.e. as confirmation, not as their source. It agreed on both: that an empty bucket does trip the
combined-total check (`0 + U > ceiling`), that 4373's clause therefore conflicts with both 2905–2907's
"never premature" and 2921–2925's "cost, not outcome"; and that under the plural-epoch reading step 2 can
reject a call every per-epoch step 4 check would admit, so "the sequence is internally consistent only
under its singular, one-affected-epoch reading." Both conclusions were re-verified against the cited spec
lines before being reflected here, and every claim in this document is independently derivable from those
lines without the consult. No native `advisor` tool was used.

One operational note for whoever runs the next round: `.codex-worker/requests/` still holds a stale
`round24-h6c1-1788366906` entry from an earlier session (timestamp 2026-09-03 00:35) that never moved to
`working/` or `responses/`. It did not block this pass's request, but it should be cleared or diagnosed.
