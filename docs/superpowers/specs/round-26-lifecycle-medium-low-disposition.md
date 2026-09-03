# Round 26 — Medium/Low pass: close the lifecycle cluster from `invariant-audit-v6-lifecycle.md`

Scope: **M-L1, M-L2, M-L3, L-L1, L-L2, and L-R23-2 only**, from `invariant-audit-v6-lifecycle.md` and
`round-23-c-l1-disposition.md`'s own follow-up re-audit. No Critical or High invariant was touched
(C-L1 was already closed by Round 23; no lifecycle High exists — the audit's own High section is
empty). No cache/concurrency findings already closed in Round 25 were touched. No geometry/query/budget
findings outside this cluster were touched. Second opinion used: `codex-advisor` (medium), once, for
L-L1's entry-order judgment call — the one fix in this pass that required picking a design position
rather than only reconciling existing text. No Codex *review* was run, per this pass's own instructions.

---

## Findings addressed, grouped by invariant

### Cluster 1 — checkpoint-yield vocabulary vs. Round 22's conditional-yield rule (M-L1, M-L3)

**M-L1: CLOSED.** Round 22's general rule ("every checkpoint … is this same mechanism … does not yield
at all" when the accumulator isn't due) never stated whether the *two-part lifecycle revalidation*
(`disposed` first, then model epoch) is itself accumulator-conditional, or runs unconditionally whenever
a checkpoint is reached — and both concrete examples the document gives (`ContainmentQuery`'s sampling
loop, the broad-phase scan) place the revalidation textually inside the yield branch, which can mislead
an implementer into gating it on the accumulator too. `codex-advisor`'s prior adjudication (recorded in
the audit) found one coherent implementation satisfies every existing sentence at once
(`revalidate; if due { await; revalidate again }`) and recommended a single clarifying clause at the
general-rule site rather than rewriting the concrete examples.

Fixed at the general-rule site (under **`ProperCrossingQuery`**'s budgets, "Every checkpoint named in this
document … is this same mechanism"): added that only the scheduling yield is accumulator-conditional;
the two-part revalidation runs at every checkpoint whenever it's reached, accumulator-due or not, and
runs *again* on resume after any actual `await` — including an `await` on a shared build-phase slot, not
only the accumulator-driven yield. This directly settles the claim at "Each caller separately
re-validates both of its own operands … before and after awaiting a shared phase slot" (the build-phase
rationale clause) as a normative consequence rather than an unstated assumption.

**M-L3: CLOSED in the same edit.** The document's other names for these sites ("every per-yield
checkpoint", "every yield point inside findClashes", "a yield-and-revalidate checkpoint", "its next
yield checkpoint") predate Round 22's conditional-yield correction and, taken literally, now contradict
it (most checkpoints frequently don't yield). Per the audit's own note ("cosmetic once M-L1 is resolved"),
added one sentence at the same site naming these phrases as historical vocabulary for the same mechanism,
not a claim that every checkpoint yields — rather than renaming ~5 scattered occurrences across the
document, which would be a much larger, higher-risk diff for a Low-severity cosmetic gap the audit itself
scoped as resolvable by cross-reference. The four Revision Notes (changelog) occurrences of this
vocabulary (lines ~246, 309, 313, 412 — Round 15's historical entry among them, not only one round as
first estimated) were deliberately left untouched, matching this document's own established convention of
not rewriting historical changelog prose (the same convention that resolved L-L2 below) — except where a
changelog claim is actually superseded, in which case the convention is to annotate it in place rather
than rewrite it (see N-1 under Independent lifecycle re-audit, below).

### Cluster 2 — release-path sweep cost model (M-L2)

**M-L2: ALREADY CLOSED, by Round 25.** The audit flagged this only because a v5 known item's *status*
had changed, not because it found new text to fix: the atomic-operations table's sweep-cost row still
described only the `GeometryRegistry` half of `releaseEpochScopedState`/`dispose()`'s release, omitting
the independent `CollisionInstance`-cache deletion. Verified against the live text: Round 25's **M-6C3**
(from `invariant-audit-v6-cache.md`, disposed of in `round-25-cache-concurrency-medium-low-disposition.md`)
already added exactly this — the second, independent `CollisionInstance`-cache deletion's cost, keyed to
the cache's `Map<loadEpoch, Map<fragmentId, CollisionInstance>>` partitioning, with `evictModel`'s
single-epoch delete kept O(1) and `dispose()`'s whole-map clear correctly left unmeasured with respect to
live-epoch count (cross-referencing M-6C2's own unceilinged-epoch language). The worst-case-span
exclusion and both gate criteria the audit flagged as inheriting the omission only ever *named* the sweep
by cross-reference to this same table row — they carry no independent description of their own to fix, so
they inherited Round 25's fix automatically. No edit made this pass; recorded here only so the lifecycle
cluster's own tracking is complete. Not a cache/concurrency finding re-touched — the M-L2 *label* belongs
to the lifecycle audit, but the prose it points at was already corrected under M-6C3's own label.

### Cluster 3 — entry-check ordering and stale-changelog housekeeping (L-L1, L-L2, L-R23-2)

**L-L1: CLOSED.** The order between `findClashes`'s cross-model rejection and its lifecycle entry checks
(`disposed`, then per-operand eviction/admission) was never stated, and the two passages that gestured at
it disagreed in emphasis: Data Flow step 3 lists the cross-model rejection as the very first action inside
`findClashes`; the Public API comment mentions the disposed/evicted rejection first, in prose, then the
cross-model constraint separately afterward. Combined with the cross-model rejection's own already-tracked
`[SILENT]` error-class gap (`invariant-audit-v6-model.md` appendix item 6, out of this pass's scope), a
cross-model query naming an evicted model had no determined error class.

Consulted `codex-advisor` (medium) before editing, since settling the order is a design judgment call, not
a reconciliation of already-stated text. My first-draft position (cross-model check first, before
`disposed`, on the reasoning that it's a cheap structural check and avoids wastefully admitting an operand
of a structurally invalid query) was **rejected**: it would contradict this document's own protected,
Critical-invariant-adjacent contract that a disposed world rejects `WorldDisposedError` for *any*
`findClashes` call regardless of query contents, checked before per-model state everywhere else in the
document (`world.dispose()` is terminal", "Disposal mid-query" in Testing). Codex's recommended order,
accepted: **`disposed` → cross-model rejection → per-operand eviction check/lazy admission.** This
preserves the disposed-first invariant exactly, still resolves the evicted-plus-cross-model ambiguity (in
favor of the cross-model rejection, since it now runs before any operand is looked up), and avoids
admitting an operand for a query that will never be processed.

Fixed at all three sites, made mutually consistent: the canonical entry-liveness passage
("`findClashes` validates liveness at its own entry…"), Data Flow step 3, and the Public API `findClashes`
doc comment. Data Flow step 3 and the Public API comment now state the order and cross-reference the
canonical passage rather than duplicating its reasoning.

**Not fixed, explicitly out of scope:** the cross-model rejection's own error class remains unnamed
(`[SILENT]`) — that is a separately-tracked, pre-existing gap shared with the capacity-rejection sites
(`maxFragmentsPerDbId`, `maxChildrenPerNode`, `maxBroadPhaseInstancePairs`, `maxCollisionInstancesPerEpoch`)
and "Invalid dbId"; naming it is a cache-ownership/error-taxonomy decision, not an ordering fix, and
touching it here would exceed this pass's stated scope. A combined-invalid-query acceptance fixture
(disposed + cross-model → `WorldDisposedError`; live world + cross-model + evicted operand → cross-model
rejection, no admission or geometry work) was suggested by `codex-advisor` as a follow-up but is **not
added in this pass** — Testing/fixture-section edits were not requested and the second fixture's assertion
would itself need the still-unnamed error class to state a concrete expected type.

**L-L2: CONFIRMED CLOSED, no edit needed.** The audit itself recorded this as already resolved: the v5
Medium about `dispose()`'s "wholesale-clears three caches" framing being numerically stale (now four,
after the `CollisionInstance` identity cache was added) is fixed in normative text at both sites that
describe the clear (`world.dispose()`'s code-comment block and its "is terminal" prose block), both now
using "all four caches" — verified present in the live text this pass, including Round 25's own M-6C5
pass over the same two sites. The "three" wording survives only inside a Round 15 historical changelog
entry, which this document's convention leaves unrewritten (the same convention M-L3's fix relied on).
No action needed, matching the audit's own disposition.

**L-R23-2: CLOSED.** Round 23's own follow-up re-audit found no Revision Notes/changelog entry existed
for its C-L1 fix, unlike every other numbered round, and explicitly deferred it as out of that pass's
scope. Added a `### Round 23` changelog entry, matching the established format of the Round 21/22 entries
immediately above it, describing the fixture-unsatisfiability finding, the two-site fix (rationale clause
+ fixture replacement), and that no mechanism or protected Critical invariant changed. The separately
tracked, pre-existing "no Round-20 changelog entry" gap (general repo convention question, not
lifecycle-specific, listed among the lifecycle audit's own "Confirmed unchanged" known items) is left
untouched — it predates this cluster and Round 20 was Critical-only, not a lifecycle finding.

---

## Deliberately not touched

- H-6C1 and every other cache-ownership finding (Round 24/25 territory).
- Every geometry/query/budget finding outside this cluster (`invariant-audit-v6-geometry.md`,
  `invariant-audit-v6-query.md`, `invariant-audit-v6-syncwork.md`).
- The protected Critical/High lifecycle invariants: Model-object identity/`loadEpoch`, disposed-first
  checkpoint semantics (both re-verified intact by the edits above, not merely left alone — see
  Verification below), and C-L1 (already closed by Round 23, untouched here).
- The cross-model rejection's unnamed error class (see L-L1 above).
- The pre-existing "no Round-20 changelog entry" gap.
- `tearDown()`-path scope ambiguity, `load()`'s stale "only calls `fromViewer`" note, `load()`/`unload()`
  TS return types, `unload()`'s per-step isolation/listener-ordering question, `world.dispose()`'s
  contract lacking an explicit non-throwing statement (**already fixed for `evictModel`'s equivalent by
  Round 25's M-6C4, but that pass's scope was cache/concurrency and did not extend to restating it as a
  general lifecycle claim** — verified this pass that `dispose()`'s own contract block already states
  non-throwing, post-Round-25; no further lifecycle action needed), `locateElementByRoom`'s deferred
  model-resolution question, dead `referenceCount`, and the stale Status-header pass count — all listed
  in the audit's own "Confirmed unchanged (known items, deliberately not re-argued)" section and left
  exactly as the audit found them.

---

## Verification performed this pass

- `node spike/fixtures.mjs`: **55 passed, 0 failed**, both before and after every edit in this pass. The
  spike covers only geometry classification and has no lifecycle/eviction/registry machinery — this is a
  regression sanity check that the unrelated geometry spike is undisturbed, not a direct test of any
  lifecycle prose change (same caveat Round 23 recorded for the same reason).
- Re-read, after editing, every site cited by M-L1/M-L3/L-L1's fixes plus the two protected Critical
  invariants' full citation list from `invariant-audit-v6-lifecycle.md`'s own re-verification table
  (Model-object identity/`loadEpoch`; disposed-first checkpoint semantics) — confirmed byte-stable outside
  the edited hunks, and confirmed the new L-L1 ordering text does not contradict "disposed-first" anywhere
  else in the document (searched every `WorldDisposedError`/`ModelEvictedError` ordering claim; all
  already say `disposed` first, which the new text now agrees with exactly).
- `codex-advisor` (medium) consulted once, on L-L1's ordering judgment call, before editing — its
  recommended order was adopted verbatim in substance (see L-L1 above for the full exchange).
- Independent lifecycle re-audit: see below.

## Independent lifecycle re-audit

A second pass (subagent, read-only, opus, `codex-advisor` consulted once as its own second opinion —
worker request `20260903-013024-14592-2120`) independently re-derived every citation from the live text
rather than trusting this document's claims, and established byte-stability from `git diff HEAD`: exactly
five hunks, `+45/-12`, everything outside them byte-identical to the pre-pass commit. Result:

- **0 Critical regressions, 0 High regressions.** Both protected Critical invariants (Model-object
  identity/`loadEpoch`; disposed-first checkpoint semantics) re-derived from `invariant-audit-v6-lifecycle.md`'s
  own table and confirmed intact — the disposed-first invariant, if anything, is stated more explicitly
  now than before this pass.
- **All six findings (M-L1, M-L2, M-L3, L-L1, L-L2, L-R23-2) independently confirmed closed** against the
  live text, including the two ("M-L2", "L-L2") this document claimed needed no edit — verified directly,
  not taken on trust.
- **L-L1's three-site entry order confirmed mutually consistent**, and checked against a broad sweep (14
  cross-model occurrences, every `WorldDisposedError`/`ModelEvictedError` ordering claim) for contradiction
  elsewhere in the document — none found. Two existing fixtures (3619–3621, 4199–4202) were found to
  *require* the chosen `disposed`-before-everything order, not merely permit it.
- **Two accuracy corrections to this document, applied above**: the M-L1/M-L3 clause sits under
  **`ProperCrossingQuery`**'s budgets, not `ContainmentQuery`'s; the checkpoint-vocabulary changelog
  occurrence is one of four (246, 309, 313, 412), not one, and the one nearest 412 is Round 15's entry,
  not Round 14's.
- **Four new Low findings surfaced, all self-inflicted by this pass's own edits, none blocking**:
  - **N-1 — CLOSED, fixed in this pass.** Round 12's changelog entry (line ~312, "`findClashes` now
    validates liveness for both operand models before doing anything else") is now stale — the cross-model
    rejection precedes per-operand liveness — and this document's own convention (an identical precedent
    ten lines below, at 323–326, for a different superseded Round-12 claim) is to annotate a superseded
    changelog claim in place, not to leave it unremarked or rewrite it. Fixed with one italic parenthetical
    modeled on that exact precedent, pointing to the new canonical three-step entry order.
  - **N-2 — NOT fixed, deferred.** The new clause's phrase "a checkpoint's `await`" (in the M-L1 fix)
    doesn't distinguish the shared build-phase slot's own owner-scoped checkpoint from the awaiting
    caller's own operand-revalidation boundary — two different actors that happen to coincide under
    Milestone 1's same-model restriction, so nothing is behaviorally wrong today. **Reason for deferring**:
    disambiguating the two actors is a real improvement but is squarely a "would matter for the future
    cross-model milestone" clarification, the same category C-L1's own fix (Round 23) explicitly scoped
    out of Milestone-1 prose; folding it into this pass would mean editing the same clause twice in one
    round. Left for the next lifecycle audit or the cross-model milestone's own hardening pass.
  - **N-3 — NOT fixed, deferred (already recorded above under L-L1).** No acceptance fixture pins the new
    entry-order precedence (disposed+cross-model → `WorldDisposedError`; live+cross-model+evicted-operand
    → cross-model rejection). **Reason for deferring**: `codex-advisor` proposed this fixture during the
    fix pass itself and it was declined then, for two reasons that still hold — Testing-section edits
    weren't requested for this pass, and the second assertion needs the still-`[SILENT]` cross-model error
    class named before it can state a concrete expected type. Re-raise the moment that class gets named.
  - **N-4 — NOT fixed, deferred (observation, not a defect).** Rounds 24, 25, and now 26 have no Revision
    Notes entry (Rounds 7–8 are covered by Round 9's entry; Round 20's absence is already acknowledged in
    place at line 653–654). **Reason for deferring**: 24 and 25 are cache/concurrency-cluster territory,
    out of this pass's scope; Round 26's own gap is symmetric with the L-R23-2 gap this pass just closed
    for Round 23, and is properly the next changelog-maintenance pass's job, not a re-opening of this one.
- **Line-number-citation check**: clean — no hunk in this pass introduced a hardcoded self-referential
  line citation; every internal reference uses a named anchor, matching the document's own convention
  (the same thing Round 23's own follow-up audit checked for and found one violation of, L-R23-1, which
  that pass fixed).
- **Spike sanity check**: `node spike/fixtures.mjs` → 55/55, independently re-run.
- **Overall verdict** (subagent's own words): "Safe to consider this pass done. Zero Critical regressions,
  zero High regressions, both protected Critical invariants intact and byte-stable outside the five hunks,
  all six tracked findings genuinely resolved in the live text … L-L1's three-site entry order is mutually
  consistent and contradicted by nothing else in the document." `codex-advisor`'s independent read reached
  the same verdict.

## Disposition summary

| Finding | Status |
|---|---|
| M-L1 | **CLOSED** — clarifying clause added at the general checkpoint-mechanism rule, under `ProperCrossingQuery`'s budgets |
| M-L2 | **ALREADY CLOSED** by Round 25's M-6C3 — no edit needed this pass, independently verified |
| M-L3 | **CLOSED** — vocabulary note added in the same edit as M-L1 |
| L-L1 | **CLOSED** — entry order stated and reconciled across all three sites (`disposed` → cross-model → per-operand eviction/admission), per `codex-advisor`'s adjudication; independently confirmed mutually consistent |
| L-L2 | **CONFIRMED CLOSED**, no edit needed — already resolved in normative text, independently verified |
| L-R23-2 | **CLOSED** — Round 23 changelog entry added |
| N-1 | **CLOSED** — self-inflicted Round-12 changelog staleness annotated in place, same pass |
| N-2, N-3, N-4 | **DEFERRED**, each with a stated reason above — none a correctness defect, none blocking |

**0 Critical regressions. 0 High regressions** — independently confirmed by a second, fresh-context
subagent pass plus a `codex-advisor` second opinion. All six tracked lifecycle Medium/Low findings from
`invariant-audit-v6-lifecycle.md` and its Round-23 follow-up are now closed or confirmed already closed.
One self-inflicted Low was caught and closed in the same pass; three more are explicitly deferred with
concrete reasons, none of them a correctness gap.
