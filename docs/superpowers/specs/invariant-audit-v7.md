# Invariant-driven consistency audit — Round 7 (post-Round-29, pre-remediation)

Type: invariant-model audit (not a Codex review round). Input:
`docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (4712 lines). Prior work this
audit checks: the full v1–v6 audit lineage and, most immediately, `round-24` through
`round-29-budget-scheduling-medium-low-disposition.md` (the five system-specific Medium/Low fix passes that
followed v6). **No prior disposition doc was trusted as evidence anything is currently fixed** — every claim
below was re-verified against the live spec text during this pass.

**Method, replicating v1–v6's:** one agent (opus) built a fresh consolidated invariant model of the same
five systems from the current post-Round-29 text, written to `invariant-audit-v7-model.md` (built from a
complete sequential read of all 4712 lines, ~278K tokens of agent work). Five parallel agents (opus) then
audited the full spec text against that model, one system each — lifecycle, geometry pipeline, query
semantics, synchronous-work/budget, cache ownership — re-verifying Rounds 24–29's claimed fixes against
current text rather than trusting the disposition docs, and chasing every `[CONTRADICTION]`/`[SILENT]`
marker the model-builder flagged as relevant to their system. Two consults with `codex-advisor` happened
during this pass (lifecycle: one severity adjudication, moved a finding High→Medium; query: one adjudication
of the containment-diagnostic contradiction), both independently re-verified by the consulting auditor before
being accepted — no other consults were needed.

Per-system detail lives in `invariant-audit-v7-lifecycle.md`, `-geometry.md`, `-query.md`, `-syncwork.md`, and
`-cache.md`. This document consolidates, merging findings independently discovered by two auditors from
different sides of the same defect, and adjudicating the one place two auditors disagreed on severity.

**Nothing in the spec was modified by this pass or by the audit that produced `invariant-audit-v7-model.md`.**

---

# 1. Fresh consolidated invariant model

Built fresh from the current 4712-line text (see `invariant-audit-v7-model.md` for full detail; this section
summarizes). **23 markers total: 3 `[CONTRADICTION]`, 7 `[AMBIGUOUS]`, 13 `[SILENT]`.**

**The stabilized invariants from Rounds 19–29 were re-verified, not assumed — all hold**, with two caveats
recorded as findings below (H7-G1 on the geometry gate's input provenance; H2/H-7C1 on an unclassified
atomic step):

| Invariant | Verdict |
|---|---|
| Exact `Model`-object identity (never `modelId`) as the lifecycle key | **HOLDS** |
| Monotonic `loadEpoch` | **HOLDS** |
| Permanent eviction tombstones | **HOLDS** |
| Disposed-first checkpoint behavior | **HOLDS** (M-L1 gap on abort-only `bvhcast` checkpoints specifically) |
| Non-throwing Viewer unload-event path | **HOLDS** |
| Settled `WorldDisposedError`/`ModelEvictedError` semantics | **HOLDS** |
| `(loadEpoch, geometryIndex)` ownership | **HOLDS** |
| Gate → compaction → weld → connectivity-when-required → BVH sequencing | **HOLDS as an ordering claim** (H7-G1: the gate's own *input* is unspecified) |
| Entry-lifetime cancellation signal semantics | **HOLDS** |
| Oversized-marker carve-out | **HOLDS** |
| Canonical query-mode contracts (surface-intersection / containment / volume-overlap) | **HOLD** |
| Containment remains source-surface-only | **HOLDS** |
| Stage-3 constructed witness remains volume-overlap-only | **HOLDS** |
| `SurfaceCrossingWitness` semantics | **HOLD** (tier-assignment seam with budget/scheduling — cross-system concern, not a defect) |
| Parity/closure diagnostics and role mapping | **HOLD apart from `non-manifold-component`**, which is absent from three of the four enumerations that are supposed to be exhaustive (H-Q1, M-Q1, M-Q2) |
| Canonical four-class scheduling taxonomy | **Holds structurally, not exhaustively** — three synchronous units fall in no class (H7-G1, H2/H-7C1, H-Q2/M2 below) |
| `frameBudgetMs` bounds cooperative composition only | **HOLDS** |
| Traversal-local `bvhcast` clock exception stays deliberate and scoped | **HOLDS for the two named traversals**; a third (`SurfaceIntersectionQuery`) is unclassified — H-Q2/M2 |
| Accepted atomic risks not falsely described as bounded | **VIOLATED at one site** — H1 |
| Worst-case-span derivation internally consistent | **Arithmetic holds**; the controlling-term identification does not — M3 |
| Performance-gate criteria match guarantees made elsewhere | **Mostly holds**, two mismatches — M1, M3 |
| Frozen `CollisionInstance` identity + call-local placement | **HOLDS** |
| Epoch-scoped capacity/check-and-commit ordering | **HOLDS as an ordering claim**; its cost is unclassified — H2/H-7C1 |
| Eviction/disposal release completeness | **HOLDS for `GeometryRegistry` and `CollisionInstance`**; unproven-but-probably-sound for `BlasCache`/connectivity (M7-G1/M-7C1), and untested for all four caches (M-7C4) |

**Structural staleness (non-defect):** the Status header enumerates rounds only through 27; Rounds 28–29
exist and aren't named (self-hedged at 26–30, so not a finding).

---

# 2. Critical findings

**None.** Zero Critical findings across all five systems, all five independently re-verified. One
codex-advisor-adjudicated candidate (query's initial "silent false negative" reading of the
containment-diagnostic contradiction) was withdrawn after re-verification showed `SurfaceCrossingWitness`
closes the gap on every case analysis. One self-flagged candidate for promotion (H1, below) was kept at High
by its own auditor with an explicit note that a synthesis-level promotion to Critical would not be
unreasonable; this pass concurs it is defensible but keeps it at High per the auditor's own analysis that no
behavior is left undetermined and nothing depends on the wrong clause.

---

# 3. High findings

Five, after merging two pairs independently found from different sides.

## H-1 — `containment` mode's `non-manifold-component` diagnostic scope is self-contradictory (query system, NEW/Round-28-introduced)

Three normative sites (2269–2272, 1647, 3022–3023) say `containment` mode never diagnoses
`non-manifold-component` for its own source; one (3692–3696, added by Round 28) says it does. **Adjudicated:
the three-site "never diagnosed" reading is the document's intended and defensible contract** — it has
weight/canonicality, matches Round 28's own stated (but misexecuted) intent, and is the only reading
consistent with the mode split's measured motivating scenario (the bathtub/14-open-components case, whose
entire purpose was eliminating per-query noise that the four-site reading would reintroduce on every negative
pair). The Error Handling parenthetical at 3692–3696 is the defect; fixing it must also touch fixture
3895–3898 (currently mode-silent) and the `non-manifold-component` union comment at 3524 (missing the
mode-scope annotation its sibling diagnostic carries at 3527), or the contradiction relocates rather than
closes. Rated High, not Critical: no boolean-correctness failure exists on either branch (a prior "silent
false negative" reading was investigated and withdrawn — `SurfaceCrossingWitness`'s composition closes it on
every case). See `invariant-audit-v7-query.md` H-Q1.

## H-2 — Risks section asserts, present-tense, exactly the worst-case bound the budget section spends 16 lines disclaiming (sync-work/budget system, PRE-EXISTING)

Line 4628–4630: "the budgets do now bound the worst case." Lines 2110–2125: "still not a finite
worst-case-span guarantee… this spec claims no bound." **Adjudicated: the budget section (2110–2125)
reflects the document's actual, currently-intended guarantee.** Five independent, mutually consistent
normative sites back it, decisively including the performance gate itself, which carves the two ceiling-less
spans out as "a required recorded finding, not a gate failure" (4445–4450) and adds criteria 8/9 specifically
to measure them — machinery that only makes sense if no bound exists. The Risks bullet's first clause is
stale round-5/6 narration ("added *this round*") left unannotated, against the document's own convention of
annotating superseded claims in place. A weaker secondary instance at 1772–1773 needs the same correction.
Rated High: the auditor's own analysis is that no behavior is left undetermined by the contradiction and
nothing depends on the wrong clause, though a Critical promotion (a spec asserting and disclaiming the same
guarantee, on a claim the document twice records as previously false and once names as a root cause) is
explicitly flagged as defensible. See `invariant-audit-v7-syncwork.md` H1.

## H-3 — The `CollisionInstance` capacity admission's recompute-and-commit is a mandatory-non-preemptible, unbounded synchronous span present in no scheduling class, no atomic-operations-table row, and no gate criterion (cache + sync-work systems, NEW; merged finding)

**Independently discovered from both sides** — the cache auditor (H-7C1) and the budget/scheduling auditor
(H2) each traced the identical step and reached the same verdict, so this is one finding, not two. The
capacity-admission step's "recompute which fragments are still missing, then construct-and-freeze a
`CollisionInstance` for each" runs with "no intervening `await`... no reentrant operation" (2865–2866) — a
mandatory atomicity requirement (it is what makes "two concurrent calls cannot both pass against the same
stale capacity observation" true, 1299). Its cost is O(U), U = the call's complete unique fragment-id set,
bounded only by `maxFragmentsPerDbId × |requested dbIds|` — and **nothing in the spec ceilings the number of
requested dbIds** (grep-confirmed zero occurrences of any such constant). Table row 1952 costs only the O(1)
size comparison, not the recompute or the construct-and-freeze loop. Two positive claims this falsifies: (1)
the worst-case-span formula's exclusion list is stated as exhaustive at exactly two rows (2110–2125), and
this is an unenumerated third; (2) gate criterion 1 treats any synchronous task outside those two rows as an
unconditional gate failure (4445–4450) — with **no permitted remedy**, since an interior checkpoint (the
design's only fix for an over-long span) is forbidden by this exact step's own atomicity invariant. Cache
side confirms this is *not* a cache-consistency defect (the atomicity holds; nothing can observe a
half-populated bucket) — purely a scheduling-model gap. Both auditors flag the likely fix as "ceiling the
requested-dbId count," a new public-API constraint, not a prose change, since adding a checkpoint would break
the concurrency guarantee. See `invariant-audit-v7-cache.md` H-7C1 and `invariant-audit-v7-syncwork.md` H2.

## H-4 — The active-range gate's own input has no specified producer, cache, or pipeline position (geometry system, NEW)

The gate — the first term of the compaction→weld→connectivity→BVH sequencing invariant — reads
`activeTriangleCount`, derived from `ranges: TriangleRange[]`, produced by `ViewerGeometryAdapter`, whose only
stated input is `getRenderProxy` (1141). **`getRenderProxy` appears exactly twice in the whole 4712-line
document** (the component definition and an unrelated Viewer-API-drift risk); no pipeline step anywhere
invokes `ViewerGeometryAdapter`. The text hand-waves the ranges as "already-normalized... computed during the
earlier layout-normalization pass" (1463–1465) — **no such pass is defined anywhere**, and a fixture repeats
the same undefined reference. The narrow phase reads this count per candidate pair, per operand, with no
named cache for the normalized output — on a literal reading this is one Viewer call plus one undefined
normalization pass per operand per candidate pair. Consequences: unimplementable as written (three plausible
call-frequency readings differ by up to O(candidate pairs) Viewer calls); the gate is explicitly outside
`frameBudgetMs` governance (1460–1461) yet its actual cost appears in no atomic-operations-table row and no
worst-case-span term — the same "unclassified synchronous span" shape as H-3 and H-5 below. See
`invariant-audit-v7-geometry.md` H7-G1.

## H-5 — `SurfaceIntersectionQuery`'s `bvhcast` traversal is absent from the entire scheduling taxonomy, falsifying a stated uniqueness claim (query + sync-work systems; independently found, severity split, adjudicated High)

**Independently found by both the query auditor (rated High, H-Q2) and the budget/scheduling auditor (rated
Medium, M2).** Same underlying fact pattern: `SurfaceIntersectionQuery` genuinely runs a real, budgeted,
abort-capable `bvhcast` traversal — "the *same* `bvhcast` traversal `ProperCrossingQuery` uses... the same
abort protocol" (1775–1779), dispatched from the narrow phase (2949), fixture-pinned (3807–3813) — yet it is
named in none of the four scheduling passages (the abort-only tier at 1996–2018, the span formula's addends
at 2084–2093, "what the formula does bound" at 2127–2132, or the clock-basis reconciliation at 2150–2154).
**Adjudicated High**, siding with the query auditor's reasoning: the document makes a *uniqueness* claim
twice, in normative text — "this is **the one** documented, deliberate exception to the shared-accumulator
convention" (2001–2003, repeated 2151–2154) — and this traversal's clock basis is genuinely undetermined
between two readings, each of which falsifies or under-determines that normative claim (either there are two
such exceptions, not one; or it falls under the document's own unresolved verdict-determinism question,
bracketed at 2014–2018, for a public mode nothing else records). The budget auditor's Medium rating is not
wrong on its own terms (no behavioral hazard results — the substituted checkpoint unit is strictly cheaper
than the one the formula assumes, so the ≈24ms/24.8ms headline bound is unaffected) but weighs the
correctness-hazard axis over the falsified-normative-claim axis; this pass follows the query auditor's
weighting because H-1 and H-2 above were both rated by exactly that standard (a false present-tense normative
claim, independent of behavioral consequence). See `invariant-audit-v7-query.md` H-Q2 and
`invariant-audit-v7-syncwork.md` M2.

**Systemic pattern across H-3, H-4, and H-5** (flagged explicitly by the sync-work auditor): three
independent synchronous units — the geometry gate's input, the capacity-admission commit, and
`SurfaceIntersectionQuery`'s traversal — are each individually unclassified by a taxonomy that asserts its
own exhaustiveness ("every checkpoint named in this document," 2034–2035). The synthesis pass weighs this as
one systemic finding about the taxonomy's completeness, not three isolated ones: a fix pass should audit the
*entire* scheduling taxonomy for exhaustiveness against every synchronous unit the current document defines,
rather than patching three call sites individually.

---

# 4. Medium findings

Fifteen, after merging one pair. Grouped by system; full detail and citations in each per-system report.

**Lifecycle** (`invariant-audit-v7-lifecycle.md`):
- **M-L1** (NEW, Round-26-introduced). The universal two-part revalidation rule (2034–2047) now quantifies
  over abort-only `bvhcast` checkpoints, which specify no lifecycle check, precedence, or propagation
  mechanism — and whose one specified exit (`aborted` → diagnosed negative) directly contradicts the result
  shape a lifecycle failure requires (3383–3387 forbids a diagnosed result for a lifecycle failure). Carried
  at High through this auditor's first draft; a codex-advisor consult supplied a concrete
  record-a-reason-then-return-`true` counterexample (under-determination, not impossibility) and confirmed
  via the pinned `three-mesh-bvh@0.9.14` source that the *obvious* fix (throwing from the callback) is unsafe
  — the module-level `_active` guard has no `try`/`finally` and would permanently break the traversal
  primitive. Cross-system with budget/scheduling (2034–2047 is jointly owned).
- **M-L2** (NEW). `dispose()`'s cleanup contract enumerates four caches cleared and never states that
  `liveModelByModelId` — the one remaining world-owned structure holding strong `Model` references — is
  cleared. Undermines the `WeakMap`-is-free-not-a-leak argument (3284–3286) for exactly this map.
- **M-L3** (open question in the spec; corroborated by the `viewer-extension-lifecycle-audit` skill's formal
  Pattern `viewer-tool-and-extension-lifecycle`). `unload()`'s three steps have no per-step isolation; a
  repeated `unload()` call's first step throws, stranding the other two. The spec explicitly declines to
  settle reachability; formal kit guidance (reproduced across two independent architectures) already settles
  the general shape ("wrap each independently-disposable step in its own try/catch").

**Geometry** (`invariant-audit-v7-geometry.md`):
- **M-G1** (merged with cache's M-7C1 below — see Cache).
- **M7-G2** (NEW). `GeometryConnectivity`'s definition (1733–1736) still describes a pre-Round-16
  range-restricted traversal; applied literally to the compacted-then-welded buffer (whose vertex numbering
  the original `ranges` offsets no longer index) it is wrong, not merely redundant. Round 16 retired the
  structurally identical clause on the BVH side but not here.
- **M7-G3** (NEW). Of `FragmentDiagnosticReason`'s three members, only the oversized case has a dedup rule
  and a persistent registry-entry kind; the other two (undetectable layout, rejected legacy layout) share the
  identical pairing-independent justification but have neither, so an unsupported fragment can be
  re-diagnosed once per candidate pair it appears in.

**Query** (`invariant-audit-v7-query.md`):
- **M-Q1** (PRE-EXISTING). `non-manifold-component` is absent from the completeness/soundness reconciliation
  (3602–3619) that presents itself as exhaustive over every diagnostic.
- **M-Q2** (PRE-EXISTING, Round-28-aggravated). `non-manifold-component`'s `role` field is unspecified in
  both role-requirement enumerations; Round 28 made the diagnostic operand-specific in `volume-overlap`
  without adding a rule for it.
- **M-Q3** (PRE-EXISTING). "Certified closed manifold" is asserted at operand granularity but the flag
  actually consulted is per-component, with no aggregation rule — not hypothetical, since the doc's own
  headline hollow-pipe justification (1606–1610) is a two-component operand after welding.
- **M-Q4** (PRE-EXISTING). `maxCrossingPairsExamined = 64`'s scope (per traversal / per pair / per call) is
  unstated, unlike its sibling counter which is explicitly traversal-local at both sites it appears.

**Sync-work/budget** (`invariant-audit-v7-syncwork.md`):
- **M-SW1** (PRE-EXISTING; Round 29 claimed to fix it). Round 29's M6-B2 fix updated only the
  atomic-operations table's gate-comparison figure (1950, now correctly annotated ~40×/≈24ms); the identical,
  unannotated comparison in Data Flow (2893–2898) still reads "~60× the ...~16ms pass criterion" as a live,
  present-tense fact — a figure the gate section itself names as retired. Correct figure per the document's
  own derivation: 24.8ms literal, ~40× ratio, matching the already-fixed table row. Cross-referenced by the
  lifecycle auditor independently (as cross-system concern #3), who found the same stale site while verifying
  the checkpoint enumeration — direct evidence for this pass's governing rule that a disposition doc's claimed
  fix must be re-verified, not trusted.
- **M-SW3** (NEW/Round-29-aggravated). "Welding is the largest [build phase], at ~16.8ms" does not survive
  the ceiling-normalization argument Round 29 itself introduced for the weld figure specifically: applying the
  identical as-measured-to-ceiling scaling to the BVH row's own measurement (1944) makes BVH (~10.7ms), not
  welding (~10.2ms), the controlling term at the ceiling. The numeric ≈24ms/24.8ms bound is unaffected
  (unscaled figures remain conservative), but the clock-basis passage's admission argument (1888–1893) and
  the per-phase compounding argument (1355–1360) both lean on welding specifically and would need restating.
  Separately, the formula's revision trigger is stated in as-measured units while gate criterion 5 measures in
  ceiling-normalized units, with no stated reconciliation.

**Cache** (`invariant-audit-v7-cache.md`):
- **M-G1/M-7C1** (merged — geometry's M7-G1 and cache's M-7C1 are the same finding, independently reached).
  No keyspace-relationship statement exists for `BlasCache`/cached `GeometryConnectivity` relative to
  `GeometryRegistry`, so `evictModel`'s derived release of both ("together with its cached BLAS and cached
  connectivity where it has any," 3118–3120) is unproven in text — a derived release is complete only if the
  derived-from keyspace is a superset, and no such statement exists for these two, unlike the explicit
  superset argument the `CollisionInstance` cache received (1276–1280). Both auditors independently traced
  every orphan-release window and found them closed by other rules (this is a missing-argument gap, not a
  demonstrable leak) — but it's compounded by M-7C3 below, since whether `BlasCache` even *has* its own
  keyspace is itself unsettled.
- **M-7C2** (NEW; same class of gap Round 25 closed for `CollisionInstance`, left open here). The release-path
  cost model (row 1951) and gate criterion 9 cover 2 of the 4 caches `dispose()` clears; `BlasCache`'s and the
  connectivity cache's own clears are priced and measured nowhere.
- **M-7C3** (PRE-EXISTING, `[AMBIGUOUS]`). `BlasCache`'s status is internally inconsistent between two
  unannotated normative readings: "storage behind a registry-entry phase slot, no keyspace of its own"
  (1503–1512, 1389) vs. "one of four independently-cleared caches" (3224–3227, 3429–3432) — mutually
  irreconcilable as written, and the answer determines whether M-7C1 is a documentation nicety or a genuine
  completeness precondition.
- **M-7C4** (NEW). No fixture verifies release *completeness* for any cache — every eviction/disposal fixture
  spies on whether the release call was invoked, never on whether the caches' resulting state is actually
  empty.

---

# 5. Low findings

Nineteen, after merging one trio. Grouped by system.

**Cross-system merge — L-marker (lifecycle's L-L1 + geometry's L7-G3 + cache's L-7C7).** All three auditors
independently flagged the identical defect: this audit lineage's own `[SILENT]` marker vocabulary has leaked
into normative Error Handling body text at line 3683–3684 ("...carrying no named error class, the same
`[SILENT]` gap those three share"). Verified: one occurrence in the entire 4712-line file, attributed via
`git log -S` to commit `ccaa75e` (Round 24). The underlying substance (four call-level ceiling rejections with
no named error class) is a real, honestly-disclosed gap; the defect is that it's recorded in the audit's
private vocabulary inside text a reader outside this lineage cannot resolve.

**Lifecycle:**
- **L-L2** (PRE-EXISTING). No constructor signature or payload shape is stated for `WorldDisposedError`
  anywhere, though the spec tells callers they "may branch on which error class they got."
- **L-L3** (NEW). `ModelEvictedError`'s "naming the evicted `modelId`" payload is ambiguous under the design's
  own supported reused-`modelId` state — the identifier the error carries is precisely the one the
  round-12→14 redesign established is insufficient to identify a load.
- **L-L4** (PRE-EXISTING, self-disclosed by the spec). The intra-`tearDown()` step-ordering claim is
  source-cited to a Viewer bundle absent from this repository; the `viewer-extension-lifecycle-audit` skill
  corroborated the surrounding claims against a pinned 7.124.2 bundle but could not corroborate the specific
  internal step-ordering (which the spec itself already marks `needs-runtime-validation`, revalidate-on-upgrade).

**Geometry:**
- **L7-G1** (PRE-EXISTING, open since `invariant-audit-v1.md`). The canonical operand-order sort key
  (1559–1565) names `geometryKey`/`instanceId`, fields that occur nowhere else in the document (actual
  vocabulary is `geometryIndex`/`fragmentId`), and includes `modelId` as a sort component against the design's
  own "plays no role in cache identity" statement — harmless only because Milestone 1 rejects cross-model
  pairs.
- **L7-G2** (PRE-EXISTING). An oversized marking is never stated to be re-evaluated within a live epoch;
  near-moot in practice since the inputs that would trigger re-evaluation are constant per epoch.

**Query:**
- **L-Q1** (PRE-EXISTING). `crossing-budget-exhausted`'s definition (three trigger types) doesn't fit
  `surface-intersection` mode, which has no crossing concept and for which only one of the three triggers
  demonstrably applies.
- **L-Q2** (PRE-EXISTING). The mode table's "never diagnosed" cells read as blanket claims but scope only to
  parity/closure diagnostics, not the other diagnostics the mode can still emit — a scoping imprecision, not a
  substantive conflict (fixture-pinned narrow reading), but part of the surface area H-1 turns on.
- **L-Q3** (PRE-EXISTING). "The second term establishes the antecedent" (2522–2526) overclaims for the case
  where the second composition term itself fails by abort or unproducible probe — those cases are correctly
  *diagnosed*, not silently wrong, but the prose's unqualified "establishes" overstates what the algorithm
  guarantees.

**Sync-work/budget:**
- **L-SW1** (PRE-EXISTING). A third, distinct sense of "~16ms" (a per-phase cost allowance) coexists with the
  retired span-bound sense and the abort-only tier's composed-span sense; the doc's own measured weld figure
  (~16.8ms) actually exceeds the "~16ms ceiling" this sense claims each phase respects.
- **L-SW2** (PRE-EXISTING). Both accepted-risk descriptions place themselves "in the same category as" the
  three ceilinged build phases — correct for "non-preemptible," misleading for "bounded," though each carries
  an adjacent "(no ceiling; accepted atomic risk)" annotation.
- **L-SW3** (PRE-EXISTING). Unannotated `~16ms` narration inside the gate section (line 4432, distinct from
  M-SW1: this one narrates the figure, M-SW1 asserts it as current).
- **L-SW4** (PRE-EXISTING). Two `ProperCrossingQuery` fixtures assert a `frameBudgetMs`-scaled wall-clock
  bound without naming the Round-29-corrected derived figure, so a regression of the correction wouldn't be
  caught by them.

**Cache:**
- **L-7C1** (NEW, Round-25-introduced). A capacity bullet garbles its own predicate (says the *ceiling* gets
  pushed over the limit, when it's the bucket that does) — wording only, both sibling statements of the same
  rule get it right.
- **L-7C2** (open question, safe by composition of facts stated elsewhere but not cross-referenced). The
  capacity-admission sequence creates a cache bucket with no stated liveness precondition at that point in the
  prose; safety depends on composing the universal revalidation rule with the no-`await` rule, neither cited
  at the site itself.
- **L-7C3** (open question). A synchronous throw inside the commit phase (not covered by the zero-mutation
  guarantee, which is scoped only to capacity *rejection*) leaves a partially-populated, un-rollback-able
  bucket resident — the one interruption H-3's atomicity analysis doesn't rule out.
- **L-7C4** (disclosed, not hidden). `maxCollisionInstancesPerEpoch` has no chosen value while a fixture and
  an error-handling bullet already depend on its behavior; gate criterion 10 is what must set it.
- **L-7C5** (PRE-EXISTING). The extension-owned room cache has no capacity ceiling or eviction policy and sits
  outside `dispose()`'s four caches — bounded-in-practice (strong `Model` keys in a per-viewer extension), and
  its clear-on-`unload()` inherits M-L3's strandability.
- **L-7C6** (PRE-EXISTING). `referenceCount` is a dangling reserved-but-unused field with no future contract
  stated.

---

# 6. Historical-only / non-defect observations

Selected highlights; full lists in each per-system report.

- **Status header staleness is self-disclosed**, not a live defect — the header itself tells readers to check
  the disposition docs rather than trust its own round-count enumeration.
- **Round 25's cache-concurrency closures verified genuinely closed**: the `CollisionInstance` keyspace clause
  (M-6C3), the non-throwing wholesale-clear requirement (M-6C4), and the four-caches-explicit-count wording
  (M-6C5) are all present in current text, independently re-derived by the cache auditor rather than assumed.
- **Round 27's three protected geometry invariants re-verified intact** — no geometry regression from Rounds
  28 or 29 was found.
- **`referenceCount`'s Milestone-1 contract (reserved/unused, epoch-scoped release doesn't need it) is
  complete and sufficient** — flagged by the model as `[SILENT]` but resolved on direct re-read (distinct from
  L-7C6 above, which is about the *cache-record* field having no forward contract for a future milestone —
  both true simultaneously, not a contradiction).
- **The `>` vs `>=` gate-threshold boundary is settled and fixture-pinned.**
- **The structural worst-case-span prefix argument (2102–2108) is sound**, independently re-derived by the
  budget auditor, and correctly does not depend on how many units share a span — the exact Round-22 error the
  current text names and retracts.
- **`SurfaceCrossingWitness`'s core semantics are internally consistent** across five independent citation
  sites; its *tier assignment* is a cross-system seam with scheduling (noted as a composition concern, not a
  defect in either system's own text).
- **Round 28's disposition doc is inaccurate about its own edit** (claims it left containment's source
  exemption untouched; the diff shows otherwise) — recorded as provenance for H-1, not as an independent spec
  defect.

---

# 7. Cross-system composition concerns carried into this synthesis (beyond the merges above)

- **M-L1 (lifecycle) and the abort-only tier's clock-basis question (budget/scheduling, H-5) should be
  adjudicated together**, per both the lifecycle and query auditors: whichever system resolves
  `SurfaceCrossingWitness`'s/`SurfaceIntersectionQuery`'s tier membership and clock basis will move M-L1's
  scope with it, since the carve-out at line 2035 is phrased in clock terms.
- **M-7C3 (is `BlasCache` a keyspace at all?) is upstream of M-G1/M-7C1** (does its keyspace relate correctly
  to `GeometryRegistry`'s?) — the synthesis pass should treat these as one ordered pair, not two independent
  items, when scoping a fix.
- **H-2's contradiction and H-3's newly-found unbounded span compound**: H-3 adds a third uncapped
  synchronous span that H-2's own exclusion-list reasoning (2110–2125) doesn't account for, making the
  "budgets bound it" claim (already adjudicated false) wrong for one more reason.
- **L-7C2's safety argument and M-L1's gap are in tension**: the capacity-admission bucket-creation step's
  safety depends on the universal two-part revalidation "never itself skipped" — the exact universal claim
  M-L1 shows is not actually honored at the abort-only `bvhcast` sites. Any narrowing of the universal rule to
  fix M-L1 must not remove the guarantee L-7C2 is quietly relying on.

---

# 8. Verdict

**Not yet ready for a final comprehensive Codex review.**

Zero Critical findings and the "0 Critical" success target is met. The "0 High" target is not: **5 High
findings**, two of which are outright present-tense normative contradictions (H-1, H-2) and three of which
share one systemic root cause — a scheduling taxonomy that asserts its own exhaustiveness while omitting at
least three real synchronous units (H-3, H-4, H-5). None of the five is Critical (no case produces a wrong
boolean result or an unrecoverable state), but all five are the kind of defect a comprehensive review would
either get stuck re-litigating (the two contradictions — a reviewer has no way to know which side is
"current" without doing exactly the adjudication work this pass already did) or systematically miss (the
taxonomy gaps, because each individual site reads locally coherent and the gap is only visible in aggregate,
which is exactly why this pass's explicit synthesis step is what surfaced the three-way pattern).

**Recommended before a comprehensive review**: one more targeted fix pass — call it Round 30 — addressing
the 5 High findings as roughly three units of work: (1) the two contradictions, H-1 and H-2, each a
adjudication-plus-edit at 1–3 sites; (2) the systemic taxonomy-completeness gap, H-3/H-4/H-5 together,
which likely wants one pass over the *entire* scheduling section auditing for exhaustiveness against every
synchronous unit the document defines, rather than three independent patches (H-3 additionally needs a
product decision — a new requested-dbId ceiling — not just a prose fix, since the obvious "add a checkpoint"
remedy is forbidden by the cache's own atomicity invariant). The Medium findings, particularly M-7C3
(upstream of M-G1/M-7C1) and M-L1 (which interacts with the H-5 clock-basis resolution), are worth folding
into the same pass since they share root causes with the Highs above; the remaining Mediums and all Lows are
explicitly non-blocking and can wait for a dedicated cleanup round in this lineage's established pattern
(Rounds 24–29).

---

# Method notes

- Per-system detail, full citations, fixture cross-references, and each auditor's own severity rationale live
  in `invariant-audit-v7-lifecycle.md`, `-geometry.md`, `-query.md`, `-syncwork.md`, `-cache.md`.
- Fresh invariant model: `invariant-audit-v7-model.md`.
- The `viewer-extension-lifecycle-audit` skill was invoked by the lifecycle auditor and independently
  corroborated two spec claims against the formal Agent Kit's Pattern `viewer-tool-and-extension-lifecycle`
  and against a digest-pinned Viewer 7.124.2 bundle (see M-L3, L-L4).
- Two `codex-advisor` consults total, both `medium` effort, both for genuine ambiguity the auditor could not
  resolve from text alone, both independently re-verified before acceptance: lifecycle's M-L1 severity
  (High→Medium, with a source-verified counterexample), query's H-Q1 "silent false negative" framing
  (withdrawn after re-verification against the composition's own case analysis). No `codex-review` was run,
  per the pass's own scope.
- **No spec text was modified anywhere in this pass or its five constituent audits.**
