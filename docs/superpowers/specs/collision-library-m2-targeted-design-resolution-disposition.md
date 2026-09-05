# Collision Library M2 — Targeted Design-Resolution Disposition

Source prompt: `docs/prompts/collision-library-m2-targeted-design-resolution-prompt.md`
Spec updated: `docs/superpowers/specs/2026-09-05-collision-library-milestone2-design.md`

This was a design/spec-only pass. No code was changed, no implementation plan was created, and no
settled M1 architecture, package-structure decision, or already-accepted M2 scope choice was reopened.

---

## Method

1. Drafted concrete resolutions for all three blockers directly against the current spec text and the
   real M1 source (`CollisionWorld.js`, `ViewerModelAdapter.js`, `errors.js`), citing exact
   file:line evidence for every load-bearing claim (e.g. `_modelLifecycle` as the existing model→epoch
   reverse lookup, `fragList.getWorldMatrix`/`getWorldBounds` as the only existing placement-read
   primitives, `broadPhasePairs`'s exact existing increment site and semantics).
2. Submitted the full draft — including explicit self-identified open questions on each blocker — to an
   independent `codex-advisor` consult (high effort) before writing anything into the spec, per this
   repo's standing preference for a second opinion on architecture decisions.
3. Incorporated every required correction the consult identified, then wrote the resolved designs into
   the spec.
4. Ran the narrow consistency check the source prompt specifies (placement revision / model-alignment
   invalidation; multi-model liveness interaction; TLAS candidate-budget semantics; candidate dedup;
   `Statistics` field meanings; M1 compatibility) against the edited document, catching and fixing two
   additional gaps in my own first-pass resolution before finalizing (see "Gaps found during the
   consistency check" below). No general comprehensive review was run, per instruction.

---

## 1. Placement-invalidation design adopted

**Model-level placement changes used for federated coordination (alignment, translation, rotation, and
equivalent model-level transforms) are now explicitly supported.** Explode, animation, and arbitrary
per-fragment dynamic transforms remain explicitly unsupported non-goals.

- New public method `invalidateModelPlacement(model)` (spec §6.7.1): standard `WorldDisposedError`/
  `ModelEvictedError` contract, resolved via the existing `_modelLifecycle` `WeakMap` (no new
  reverse-lookup structure needed); no-ops for a never-admitted model.
- **One canonical staleness counter** (`_placementRevisionByEpoch`, unchanged from the prior revision's
  §6.4) now also covers alignment-caused invalidation, not just new-fragment growth. A new
  `_placementInvalidatedAtRevision: Map<epoch, revision>` generational marker (not a boolean flag)
  records *which* revision an invalidation produced, which is what makes a later compare-and-publish
  step able to tell a superseded invalidation from the current one (§6.7.2).
- **Refresh is staged and published atomically**, never mutated in place: a private replacement map is
  built by re-reading `worldMatrix`/`worldBounds` via the exact same primitives `extractFragments`
  already uses, and is only swapped into the shared `_placementByEpoch` map after a synchronous,
  no-further-await compare-and-publish check confirms nothing else changed the epoch's revision/
  invalidation marker while the refresh was reading Viewer state (§6.7.3). A failed check discards the
  staged data; the next query attempt retries.
- **Extraction is corrected to be strictly write-once per fragment** in `_placementByEpoch` — only a
  genuinely new fragment is inserted; an already-present entry is never silently overwritten by
  ordinary extraction, only by the explicit refresh path above (§6.7.4). This closes a real ambiguity
  in the prior revision's §6.1 phrasing that could have been misread as "extraction refreshes on every
  touch."
- **Mid-query behavior**: a query's own captured-epoch expected-revision tracking (§6.7.5) distinguishes
  its own synchronous writes (ordinary growth it performed itself) from any externally-caused revision
  change (another concurrent caller's growth, or an explicit invalidation from anywhere) — only the
  latter aborts the query. The composite multi-model checkpoint (§9.2 point 8) now revalidates
  placement revisions at the same points it already revalidates epoch liveness, throwing a new
  `ModelPlacementChangedError` (carrying `modelId`, `loadEpoch`, `expectedRevision`, `actualRevision`)
  on mismatch. This revalidation is scoped to `broadPhase:'tlas'` operands only — a linear-mode call
  never depends on placement freshness and would gain nothing from it but spurious aborts.

## 2. Mid-query placement-change behavior

If a captured model's placement revision changes mid-query for a reason the query did not itself
cause, the **whole query aborts** with `ModelPlacementChangedError` — never a partial/possibly-stale
result — matching the existing eviction-abort contract's severity. Validation precedence at every
check point: disposed → evicted/invalid lease → placement-revision mismatch. The next query against the
same epoch re-enters the same lazy build/refresh path and succeeds normally against whatever is
current.

## 3. Candidate-budget semantics

`maxBroadPhaseInstancePairs`'s Cartesian precheck is **not applied** under `broadPhase:'tlas'` — it is
specific to the linear scan's cost model, where total work is a computable-in-advance product; a TLAS
candidate count is not knowable until traversal runs, so the model is different in kind, not just in
constant.

- New `maxTlasCandidatePairs` bounds primitive-candidate expansion (the point where a leaf/range match
  is unpacked into individual primitive candidates — before target-scope filtering and self-exclusion,
  since that expansion cost is incurred regardless of later filtering).
- **Scope: whole-`findClashes`-call**, not per-source-instance or per-`(sourceEpoch,targetEpoch)` pair —
  matching M1's own existing call-wide scope and avoiding a bound that lets aggregate cost grow as
  `limit × targetEpochCount`.
- **Checked incrementally, as-you-go** (a TLAS candidate count can't be precomputed the way M1's
  Cartesian product can); on exhaustion, reuses `CapacityExceededError` with a new
  `kind: 'tlas-candidate-budget'`, terminated via the traversal's own normal early-termination
  return-value convention rather than by throwing from inside a callback the vendored traversal
  machinery does not protect with `try/finally` (§9.3.3) — this mirrors §7.1's own existing hazard
  analysis for `bvhcast` callback exceptions.
- Explicitly scoped to **not** bound TLAS builds, internal-node visits, or empty/disjoint traversals
  (§9.3.4) — those remain the existing accepted atomic-span category (§9.1).
- **Candidate-level dedup resolved as unnecessary for M2's adopted design**: given the binding
  invariants already required elsewhere in the spec (disjoint packed-tree leaf ranges, single-shape
  per-source-instance querying only, each source instance and each distinct target epoch queried
  exactly once, fresh-array retries), the traversal pattern is structurally dedup-free by construction
  — not because a dedup mechanism was added. This would need to be revisited if the deferred
  TLAS-vs-TLAS `bvhcast` optimization (§7.2) is ever adopted.

**A genuine correctness bug in already-accepted text was found and fixed while resolving this
blocker**: §7.1a's target-scope membership filter compared a TLAS-matched primitive's `ownerDbId`
directly against a `targets` entry's requested `dbIds`. §4.4 already establishes, for the *source*
side, that a fragment's `ownerDbId` can be a child dbId different from the top-level dbId requested for
an assembly-rooted selection — the same is true on the target side, so the original filter would
silently produce false-negative exclusions for any assembly-rooted `targets` entry. Corrected to use
extracted-fragment-set membership (the same primitive §4.4 already uses for source self-exclusion), and
extended to resolve duplicate/overlapping `targets` entries for the same model via a union of their
extracted-fragment sets (whole-model scope wins over any narrower entry for the same model).

## 4. Finalized `Statistics` fields

Nine new additive fields, always present (default `0`), never conditionally omitted:
`tlasLeafRangeEmissions`, `tlasPrimitiveCandidatePairs`, `tlasExactRetestSurvivors`,
`tlasNarrowPhaseInputPairs`, `tlasBuilds`, `tlasCacheHits`, `tlasSharedBuildWaits`, `tlasBuildMs`,
`tlasQueryMs` (spec §7.5.1).

`broadPhasePairs` is generalized, **compatibly** (zero behavior change for `broadPhase:'linear'`
callers — the field's numeric value for that path is unchanged), to one canonical cross-path meaning:
count of candidates whose exact `_testBroadPhasePair` predicate was evaluated. The resulting inequality
chain formalizes how the fields relate and makes the two broad-phase paths' numbers directly
comparable without redefining any field incompatibly:

```
tlasPrimitiveCandidatePairs  >=  broadPhasePairs
broadPhasePairs              >=  tlasExactRetestSurvivors
tlasExactRetestSurvivors     ==  tlasNarrowPhaseInputPairs
tlasNarrowPhaseInputPairs    ==  narrowPhasePairs
```

An earlier draft of this resolution incorrectly claimed `broadPhasePairs == tlasPrimitiveCandidatePairs`
— caught by the `codex-advisor` consult (filtering happens between expansion and the exact retest, so
the two are not equal in the general case). Timing fields (`tlasBuildMs`/`tlasQueryMs`) are scoped to
work *this call itself* performed, distinct from `broadPhaseMs`'s existing end-to-end wall-clock
meaning, so a `0` build time can be told apart from "already warm" vs. "blocked on another caller's
build" via the new `tlasBuilds`/`tlasCacheHits`/`tlasSharedBuildWaits` counters.

## Critical/High regressions

**0 Critical, 0 High.** One genuine correctness bug was found and fixed in already-accepted text
(§7.1a's target-scope filter, described above) — this is a fix applied within this pass, not a
regression left open. No other previously-accepted design decision was found to be wrong.

## Gaps found during the required narrow consistency check (self-caught, then fixed)

Two gaps surfaced while checking the newly-written text against the "multi-model liveness interaction"
and "candidate dedup" items on the consistency-check list, both fixed in the same pass:

1. **Missing pre-insertion check in the query-self-invalidation-avoidance mechanism (§6.7.5).** The
   first draft of this mechanism updated a query's own tracked `expectedRevisionByEpoch` immediately
   after its own insertion, but did not check *before* that insertion whether the shared revision had
   already diverged from the query's own expectation. Without that check, a query could silently absorb
   a foreign revision bump into its own bookkeeping (by unconditionally syncing to whatever number
   resulted) and never actually detect that an external change had occurred. Fixed by adding an
   explicit pre-insertion compare-and-abort step.
2. **Missing mode-scoping on the new placement-revalidation checkpoint (§9.2 point 8).** As first
   written, the composite checkpoint's new placement-revision check would have run for every captured
   epoch regardless of `broadPhase` mode — meaning a pure `broadPhase:'linear'` call, which never reads
   `_placementByEpoch`/a cached TLAS and has no correctness dependency on placement freshness, could
   still be spuriously aborted by unrelated concurrent growth in a captured model. Fixed by scoping the
   revalidation to epochs the call is actually consulting via `broadPhase:'tlas'`.

## Remaining open items (unchanged, not touched by this pass)

Per the source prompt's explicit "Accepted / no longer blocking" list and its instruction not to reopen
settled choices, the following remain exactly as the prior revision left them — none of them gate
implementation planning:

- Source self-exclusion granularity's confirmation against real fixtures (§15 item 3) — the rule itself
  is accepted and was not reopened.
- Sourcing a real two-or-more-model federated fixture for §12/§13/§14 (§15 item 4).
- Whether TLAS-vs-TLAS `bvhcast` is ever actually needed (§15 item 5) — deferred by design.
- Caller-initiated cancellation (§15 item 6) — not required by the stated acceptance workflow.
- `CollisionInstanceBVH`'s contract-test mitigation (§15 item 7) — bounded, required implementation
  work, not a design gap.
- The app-side `keepCurrentModels: true` wiring change (§15 item 8) — small, specified, not blocking.

## Verdict: ready for implementation planning

**Yes.** The three items that genuinely gated implementation planning in the prior revision —
model-placement invalidation, TLAS candidate-budget semantics, and `Statistics` field finalization —
are now resolved with concrete, independently-reviewed designs, not deferred defaults or open
questions. The two remaining open items above are human/logistics confirmations that can proceed in
parallel with implementation planning and do not block its start. The architecture in §5-§9 of the spec
remains sound and was not reopened beyond these three targeted resolutions and the one correctness fix
(§7.1a) they surfaced.
