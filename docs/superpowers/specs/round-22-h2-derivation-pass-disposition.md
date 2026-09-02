# Round 22 — H2-only worst-case-synchronous-span re-derivation pass

Type: invariant-audit-driven, single-finding re-derivation pass, not a Codex review round. Scope:
`invariant-audit-v5.md`'s single deliberately-deferred High, H2. No Medium/Low finding touched. No
query, lifecycle, cache, or extraction *behavior* changed — this is a documentation-correctness fix to a
worst-case-span claim, not a code-behavior change (there is no implementation yet; this is still a
design spec).

## The finding (H2, from `invariant-audit-v5.md`)

> The claim that each build phase (weld, connectivity, BVH) "is its own whole span" because the
> pre-phase checkpoint always starts a fresh synchronous span is false under the checkpoint's own
> conditional-yield semantics — a checkpoint only yields when the shared budget is already due — up to a
> full `frameBudgetMs` of prior narrow-phase work can share a synchronous span with a build phase, making
> the true worst case (`frameBudgetMs` + one build phase, ≈24ms) larger than the worst-case-span
> formula's stated value (≈16ms) by ~1.5×.

## Re-derivation approach

Read the current (post-Round-21) text as the sole source of truth, per the task's instruction, and
classified every operation that can appear in a synchronous span by its actual scheduling class rather
than patching the existing sentence:

1. **Cooperatively yieldable/resumable** — the broad-phase AABB scan (post-Round-18) and
   `ContainmentQuery`'s `classifyPoint` sampling loop: both can genuinely pause and resume mid-loop, so
   their own overshoot past a due checkpoint is bounded by one small atomic sub-op's cost. This tier's
   contribution to the formula (`frameBudgetMs` + one small op) was already correct and is unchanged.
2. **Enforceably bounded, non-preemptible once started** — the three `maxSyncTriangleCount` build phases
   (weld ~16.8ms measured, connectivity ~6.9ms measured, BVH ~16ms measured) and the
   `maxChildrenPerNode`-capped `enumNodeChildren` call. Each has a genuine hard ceiling on its *own* cost,
   but cannot itself be interrupted once started.
3. **Abort-only synchronous traversal** — the two `bvhcast`-native traversals (`ProperCrossingQuery`'s
   `intersectsTriangles`, `SurfaceCrossingWitness`). Self-bounded by a private, traversal-local clock
   (the deliberate, already-documented exception to the shared-accumulator convention, per Round 21's
   H-B7 fix) to ~2×`frameBudgetMs`, independent of prior work *within the traversal* — but the checkpoint
   deciding whether to *start* the traversal at all is the ordinary conditional one.
4. **Accepted non-preemptible atomic risk, no ceiling** — one `enumNodeFragments(node, cb, false)` call
   and `releaseEpochScopedState`/`dispose()`'s per-epoch registry sweep. Unchanged: these remain
   excluded from any finite worst-case-span claim, exactly as through Round 21.

The document's own text already states, in the `bvhcast` clock-basis passage, that "unlike every other
checkpoint in this design, which only yields when the shared per-call accumulator is already due and
never changes how much work happens" — i.e., the conditional-yield rule H2 flags was already stated
as the *general* rule for every checkpoint except `bvhcast`'s private clock. The build-phase claim H2
challenges, and the analogous (previously unflagged) assumption underlying the standalone `bvhcast`
self-bound passage, both silently contradicted that general rule by treating their own entry checkpoint
as an unconditional yield. Re-deriving from the general rule rather than the two exceptions' own local
framing resolves both in one pass.

## Corrected formula

`frameBudgetMs + [worst-case cost of the one non-preemptible or abort-only atomic unit, if any, that
immediately follows a checkpoint which found the accumulator not yet due]`, replacing the prior
`max(frameBudgetMs + one small atomic operation's cost, one build-phase's own cost)`.

- Cooperative tier: unchanged, negligible addend.
- Enforceably-bounded tier: `frameBudgetMs` (8) + weld's own worst case (~16.8ms) ≈ **~24ms**.
- Abort-only tier: `frameBudgetMs` (8) + `bvhcast`'s own self-bound (~2×`frameBudgetMs` ≈ 16ms) ≈
  **~24ms**.

Only one such unit can ever be the one absorbing prior undischarged work in a given span: any unit at or
near this ceiling already costs more than `frameBudgetMs` on its own, so the checkpoint immediately
following it finds the accumulator overdue and does yield. A multi-phase build's total wall-clock cost
(still up to ~3× one phase's ceiling) is unchanged — only the single-span claim was wrong.

No finite worst-case-span guarantee is claimed for the whole design, unchanged from Round 21: the two
ceiling-less accepted atomic risks remain named exceptions with no stated bound.

## Edits made

1. **`ProperCrossingQuery`'s budgets, "Atomic operations and what remains non-preemptible"** — rewrote
   the per-atomic-operation-ceiling bullet to state the conditional-checkpoint rule instead of the false
   "always yields" claim; added a new "abort-only ceiling" bullet folding `bvhcast`'s traversal into the
   same composition analysis; rewrote the worst-case-span formula paragraph to the corrected additive
   form with the per-tier derivation; updated the "what the formula does bound" list to include the two
   `bvhcast` traversals.
2. **`ThreeMeshBvhBackend`/`BlasCache`** — corrected the "no single uninterrupted synchronous span
   exceeds it" claim to state the conditional-checkpoint composition gap and its ≈24ms consequence,
   while preserving the (still-true) claim that the three phases never compound with *each other*.
3. **Performance gate pass criteria** — updated the "~16ms tolerance band" pass criterion to the
   corrected ≈24ms bound, cross-referencing the re-derivation.
4. **Revision Notes** — added a `### Round 22` entry after Round 21's, in this document's established
   changelog format.
5. **Two stale live cross-references to the old ~16ms tolerance figure** — found by the invariant-audit-v6
   model-build agent's line-by-line residue sweep (its §4.7), both inside currently-normative passages
   (not historical "Round N found..." narration, which was left untouched): the `bvhcast` clock-basis
   passage's claim that its own ~2×`frameBudgetMs` worst case "sits within... the performance gate's own
   ~16ms tolerance band," and the broad-phase-scan performance-gate criterion's "a total wall-clock figure
   says nothing about the ~16ms criterion." Both updated to reference the corrected ≈24ms bound rather
   than restate the superseded number. A third flagged instance (line ~2699, "60× the performance gate's
   own ~16ms pass criterion") is genuine Round-18 historical narration describing the reasoning *at the
   time* of that round's own fix and was left unchanged, matching this document's existing convention for
   not rewriting history.

No fixture, mechanism, ceiling value, or Medium/Low finding was touched. `spike/fixtures.mjs` is
unaffected by this pass (it tests the executable geometry prototype, not the design doc's own worst-case
timing fixtures) and was run only as the standard regression check.

## Self-correction found by the invariant-audit-v6 query-semantics auditor (H-Q1)

The first draft of the new "abort-only ceiling" bullet claimed `ProperCrossingQuery`'s
`intersectsTriangles` **and** `SurfaceCrossingWitness` both use the private, traversal-local `bvhcast`
clock (Round 21's H-B7 exception). The query-semantics parallel auditor found `SurfaceCrossingWitness`'s
own passage (unchanged by this pass) states its time-based abort checks *the shared* elapsed-time
accumulator, at callback entry and before every probe — not a private clock — directly contradicting the
new bullet, and propagating into the formula's abort-only-tier term and the "what the formula does bound"
list. Adjudicated High (not Critical — satisfiable by picking either clock basis in the wording; `codex-
advisor` concurred), a wording defect this pass itself introduced, not a substantive one:
`SurfaceCrossingWitness`'s actual shared-accumulator, fine-per-probe-granularity mechanism in fact belongs
to the cooperative-composition tier (bounded overshoot: one probe's own cost), not to the abort-only tier,
so no new numeric bound was needed — corrected by restricting the abort-only bullet, the formula's
abort-only-tier term, and the "what the formula does bound" list to `ProperCrossingQuery`'s traversal
only, with an explicit note on why `SurfaceCrossingWitness` is excluded from it. Flagged, but explicitly
NOT fixed (out of this pass's scope, per instruction not to change unrelated query behavior): whether
`SurfaceCrossingWitness` reading the shared accumulator inside a permanent, result-altering `bvhcast`
abort reproduces the same scheduling-position-dependent-verdict shape Round 21's H-B7 fix moved
`ProperCrossingQuery` away from is a genuine, pre-existing, unresolved question — a determinism/
correctness concern, not a worst-case-span-bound one, and not something this H2-scoped pass decides.

## Second self-correction, found by the geometry-pipeline and sync-work/budget parallel auditors (H6-G1/H6-B1, H6-G2, H6-G3/H6-B2)

Both auditors independently found, and `codex-advisor` (effort `high`) confirmed, that the first draft's
explanatory claim **"only one such non-preemptible/abort-only unit can ever be the one absorbing prior
undischarged work in a given span"** is false — and, as a direct corollary, that the retained
`ThreeMeshBvhBackend`/`BlasCache` claim **"the three phases never compound with each other in one
span"** is also false. Counterexample using only the document's own measured figures: after welding
(~16.8ms, which alone exceeds `frameBudgetMs` and so always triggers a yield right after it) forces a
fresh span, connectivity (~6.9ms) runs in that fresh span; because 6.9ms is *itself* below
`frameBudgetMs` (8ms), the checkpoint immediately following connectivity does not necessarily find the
accumulator due, so the BVH build (~16ms) can run in the *same* span as connectivity — one ~22.9ms span
containing two build phases, not one.

Critically, `codex-advisor` confirmed the **numeric bound (≈24.8ms) survives unchanged**: the proof only
requires that the aggregate cost of every unit preceding the *last* unit in a span be below
`frameBudgetMs` (which is exactly what let the checkpoint before that last unit proceed), regardless of
how many earlier units — or which ones — contributed to that prefix. 6.9 + 16 = 22.9 < 8 + 16.8 = 24.8.
The defect was in the *explanation* ("only one absorbs"), not the *value*. Fixed by replacing the
"only one" argument with the general prefix-plus-final-unit argument, and by correcting the
`ThreeMeshBvhBackend`/`BlasCache` "phases never compound" claim to state precisely what's true: welding's
cost, *as measured*, exceeds `frameBudgetMs` and so doesn't compound with what follows it, but this is a
fact about the measured figures, not a structural guarantee — a smaller geometry whose welding cost
itself fell under `frameBudgetMs` could let more phases (or all three) share a span, still subject to the
same ≈24ms bound. Also flagged (H6-G3/H6-B2, independently confirmed by both auditors): the ≈24ms figure
is computed from three of the enforceably-bounded tier's four members (weld/connectivity/BVH); the
fourth, one `enumNodeChildren` call at the `maxChildrenPerNode` ceiling, is explicitly unmeasured
elsewhere in the document, so ≈24ms is provisional for that member specifically, not a proven bound —
both the formula passage and the performance-gate criterion now say so explicitly.

A third, related finding (H6-G2, geometry-pipeline auditor): a pre-existing (not written by this pass)
Round-15 regression-test description asserted "the scheduling primitive must be invoked... before each of
the three phases" for a mocked build whose three phase costs are each individually under `frameBudgetMs`
but sum past it — read literally ("the scheduling primitive" is elsewhere a defined term for the actual
yield/`await`, not the check), this demands three real yields, which `codex-advisor` confirmed is
impossible under the corrected conditional-checkpoint model for any costs meeting the fixture's own
stated constraints (real yield count is at most one, starting from a zero accumulator). Fixed by
rewording the fixture to spy on the checkpoint (accumulator-check) evaluation itself — asserting it runs
three times, once before each phase, which is what actually guards against the round-15 regression (one
opaque checkpoint covering all three phases) — rather than asserting the scheduling primitive fires three
times; adjacent mode fixtures reworded from "must fire"/"must not fire" to "must be evaluated"/"must not
be reached" for the same reason, per `codex-advisor`'s recommendation.

## Verification

- `node spike/fixtures.mjs`: **55/55 pass**, before and after (expected — this pass edits only the
  spec's prose).
- No `codex-worker` process was running in this repository when the initial derivation was drafted (no
  `.codex-worker/` queue present at the time); that first draft relied on the document's own
  already-stated general conditional-checkpoint rule (quoted above, from the `bvhcast` clock-basis
  passage) as the source of truth. A `codex-worker` was started partway through this pass (used
  successfully by the five parallel invariant-audit-v6 auditors below, and by this pass's own `codex-
  advisor high` consult to adjudicate the two self-corrections above) — no point in this pass silently
  substituted the native `advisor` tool.
- `invariant-audit-v6-model.md` plus five parallel per-system audits (lifecycle, geometry pipeline, query
  semantics, sync-work/budget, cache ownership — the required five-system methodology) run as the
  required follow-up against this pass's own text; see the Critical/High/Medium/Low disposition summary
  below and the individual `invariant-audit-v6-*.md` reports for full detail.
