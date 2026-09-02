# Invariant-driven consistency audit — Round 5 (post-Round-21, pre- and post-remediation)

Type: invariant-model audit (not a Codex review round — no `codex-review spec` pass was run on the whole
document, per explicit instruction). Input: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`,
audited at 4217 lines (post-Round-21 High-only fix pass, before this document's own Remediation section
was applied — see that section for the final, current state at 4345 lines).
Prior work this audit checks: `docs/superpowers/specs/invariant-audit-v4.md` (Round 4, the source of truth
Round 21's fixes targeted) and `docs/superpowers/specs/round-21-high-only-fix-pass-disposition.md` (the fix
pass itself).

**Method, replicating v1–v4's:** one agent (opus) built a fresh consolidated invariant model of the same
five systems from the current post-Round-21 text, written to `docs/superpowers/specs/invariant-audit-v5-model.md`.
Five parallel agents (opus) then audited the full spec text against that model, one system each — lifecycle,
geometry pipeline, query semantics, synchronous-work/budget, cache ownership — re-verifying every Round-21
fix against current text (not trusting the disposition doc's claims), explicitly distinguishing NEW
(introduced or exposed by Round 21) from PRE-EXISTING findings, and adjudicating three items the model-build
step flagged (A1, A2, A3) plus one it found directly (a third `dispose()` clear-description site the
Round-21 addendum had missed — found and fixed by the coordinating session before the five audits ran; see
`round-21-high-only-fix-pass-disposition.md`'s own Addendum section).

---

# Critical

**None found, by any of the five auditors.** All six protected Critical invariants (Model-object identity/
`loadEpoch`, disposed-first checkpoint semantics, `GeometryRecord` entry-lifetime cancellation ownership,
active-range gating/compaction/weld/connectivity/BVH ownership, extraction's accepted atomic-risk
boundaries, the mode dependency matrix) were independently re-read and confirmed intact by the auditors
whose territory each touches. Two adjudication items (A2/H-G1, the `CollisionInstance` cache's
concurrency hazard, and its cache-ownership counterpart H-5C2) were each explicitly weighed for a
Critical rating and rejected by both auditors on the same principled ground: an unnamed synchronization
mechanism could in principle satisfy the literal wording, so the contract was unsatisfiable-as-written but
not unsatisfiable-by-construction — the lineage's established bar for Critical. Both independently
consulted `codex-advisor` and reached the same verdict.

---

# High

Five auditors converged on **8 distinct High findings**, five of them newly introduced or exposed by
Round 21's own edits, one newly surfaced but pre-existing (not caused by Round 21), and confirmation that
all thirteen of Round 21's targeted v4 Highs were substantively resolved (with residual Medium-level
wording gaps noted below, not contradictions).

**NEW — caused by Round 21's own fixes (all remediated; see Remediation section below):**

1. **H-1 (lifecycle).** The `tearDown()`-path ordering claim Round 21's H-L1/H-L2 fix added
   (`BEFORE_MODEL_UNLOAD_EVENT` fires only after `tearDown()`'s extension-unload loop already ran) shipped
   uncited, unlike every neighboring Viewer-behavior claim in the same paragraph, in a document whose
   stated practice is citing exactly what was checked.
2. **H5-Q1 (query semantics).** Round 21's H-B4 fix picked the wrong side of the `SurfaceCrossingWitness`
   scheduling-class contradiction it was meant to resolve — describing a plain, resumable JS loop — while
   a pre-existing, untouched fixture (and the executable spike) require a real `bvhcast`-native traversal
   that aborts permanently on budget exhaustion. The fix relocated the contradiction (to text-vs-fixture)
   rather than closing it.
3. **H-5C1 / H-G1 (cache ownership / geometry pipeline, same finding, independently found by both
   auditors).** Round 21's H-2/H-3 fix (`CollisionInstance` cache) scoped `evictModel`'s release of the
   cache subordinate to `GeometryRegistry` entry removal, but the cache's keyspace (every collected
   fragment) is a strict, much larger superset of the registry's (lazily-built, candidate-pairs-only)
   keyspace — most cached instances were never reachable from the sweep and leaked on eviction.
4. **H-5C2 / A2 (cache ownership / geometry pipeline, same finding, independently found and jointly
   adjudicated by both auditors, each separately consulting `codex-advisor`, converging on the same
   verdict).** The cache's declaration claimed to follow `GeometryRegistry`'s ownership discipline
   "exactly" while requiring every cache-hit caller to mutate the shared instance's transform fields —
   contradicting the write-once-after-publication pattern every other shared entry in the document
   follows, and breaking the per-call snapshot guarantee under concurrent `findClashes` calls (explicitly
   supported and fixture-pinned elsewhere).
5. **H1 (sync-work/budget, adjudication of A1).** Round 21's H-B7 fix changed `bvhcast`'s time-based abort
   trigger from a traversal-local clock to the shared per-call accumulator — intended to close a clock-basis
   ambiguity, but this makes a non-resumable traversal's permanent, result-altering abort a function of
   scheduling position (how much of the shared budget was already spent by other work in the same call)
   rather than the traversal's own cost, introducing nondeterminism the document elsewhere treats as a
   defect. Confirmed via `codex-advisor`, which independently reached the same verdict and additionally
   noted the private clock's own worst case already sat within, not beyond, the gate's tolerance band —
   so the fix traded a non-violation for a correctness regression.

**NEW — surfaced but not caused by Round 21, deliberately deferred (see rationale below):**

6. **H2 (sync-work/budget, sync-work auditor, previously unflagged in v1–v4).** The claim that each build
   phase (weld, connectivity, BVH) "is its own whole span" because the pre-phase checkpoint always starts a
   fresh synchronous span is false under the checkpoint's own conditional-yield semantics (a checkpoint only
   yields when the shared budget is already due, per fixture `3616-3619`'s own pin) — up to a full
   `frameBudgetMs` of prior narrow-phase work can share a synchronous span with a build phase, making the
   true worst case (`frameBudgetMs` + one build phase, ≈24ms) larger than the worst-case-span formula's
   stated value (≈16ms) by ~1.5×.

**Confirmed unrelated to Round 21 / already resolved:**

7–8. The geometry-pipeline and query-semantics auditors each confirmed their assigned v4 Highs
   substantively resolved with no new High of their own beyond what's listed above (see the Verdict
   tables under each system in `round-21-high-only-fix-pass-disposition.md`).

---

# Medium (highlights; full detail in each auditor's original report, retained in session record)

- **Lifecycle.** A3 (the proviso-scope ambiguity in the `tearDown()`-path paragraph) adjudicated Medium via
  `codex-advisor` — a real but narrow literal contradiction, not implementer-visible in practice. Several
  further NEW Mediums from the same paragraph's own density (M-2 through M-8 in the lifecycle auditor's
  report): `load()`'s "only calls `fromViewer`" claim now stale next to its own new registration-ordering
  paragraph; `load()`/`unload()`'s TS return types never stated; the Milestone-1 wiring gap stated in only
  one place, not cross-referenced from Risks/Open Questions; H-L4's new contract unfixtured;
  `world.dispose()`'s own contract still lacks an explicit non-throwing requirement (sharpened by H-L8).
- **Query semantics.** M5-Q1 through M5-Q9: a residual "stage" terminology overload reintroduced by H-Q2's
  own fix (distinct site from the pre-existing M-Q2); the containment guarantee's "only... once" wording
  doesn't account for the mode's early-exit positive path; the target's connectivity-build "free check"
  claim no longer literally free after H-Q4; the rewritten Public API comment omits
  `non-manifold-component` from its enumeration; two further PRE-EXISTING findings (a second
  `maxCrossingPairsExamined`-diagnostic-mapping contradiction, and the `unverified-parity-operand` role
  table's incompleteness) newly surfaced, not previously recorded in any prior round's writeup.
- **Sync-work/budget.** M1–M9 in the sync-work auditor's report: H-B7's clock-basis language landed
  inconsistently across three sentences (addressed by this document's Remediation pass revert, which also
  resolves this Medium); a fixture stranded by the same fix; the release-path sweep's non-preemptibility
  justification cites the wrong criterion; H-B8's "the two" vs. the formula's three-coordinated-item phrasing;
  H-B7's own magnitude reasoning was self-inconsistent; `crossing-budget-exhausted`'s canonical definition
  omits its time-based trigger; one unannotated `getChildCount` residue survives outside the annotated
  bullet.
- **Cache ownership / geometry pipeline.** M-1/M-G1 through M-G8, M5's own M-1 through M-12: the sweep's
  cost model needs re-scoping for both the corrected release logic and the new capacity-check row
  (addressed by this document's Remediation pass); the pre-existing v4 Medium about `dispose()`'s
  "wholesale-clears three caches" framing is now numerically stale at four; compaction/gate ordering
  transposition, `>=`/`>` boundary wording, oversized-marking creator gap, and connectivity trigger-point
  three-way ambiguity all confirmed PRE-EXISTING, unchanged, correctly still Medium.

**Confirmed unchanged, as instructed:** the two Round-20 wording Mediums (byte-identical, verified via
`git diff -U0` producing no hunk over either region) and M-Q2/M-Q3 with the v2 audit-record gap note about
them (untouched, not accidentally fixed or worsened by the adjacent H-Q2 edit).

---

# Low (highlights)

Status header now five fix passes stale (still "seventeen rounds," still names Round 18 as current); no
Round-20 Revision Notes entry (pre-existing, Round 21 at least references it); a stale `getChildCount`
present-tense sentence in the Round-17 changelog preamble (distinct from the annotated bullet);
`referenceCount` still dead; several minor formatting/cross-reference nitpicks per-auditor. Full detail
retained in the session's audit transcripts.

---

# Remediation

All five NEW, Round-21-caused High findings (1–5 above) were fixed in this same pass, immediately after
the five audits reported them, before this document was finalized — these are regressions this pass itself
introduced while fixing v4's Highs, and the pass's own stated success criteria required resolving them
before completion, not deferring them to a future round.

- **H-1**: fixed by citation. Delegated to a fresh investigation using the `aps-viewer-api-evidence-investigation`
  skill against the pinned 7.124.2 bundle: confirmed `tearDown()`'s extension-unload loop
  (`viewer3D.js:26541-26560`) completes and clears `loadedExtensions` before calling
  `unloadCurrentModel()` (`viewer3D.js:26583`), the sole caller of `unloadModel` (`viewer3D.js:34052`),
  whose first statement dispatches `BEFORE_MODEL_UNLOAD_EVENT` (`viewer3D.js:34054`) — a real, unavoidable
  code-order fact in one synchronous call stack, not probabilistic. Citation added, flagged as verified
  internal behavior, not a documented public guarantee.
- **H5-Q1**: fixed by correcting the mechanism description. A `codex-advisor` consult, grounded in the
  executable spike (`spike/geometry-core.mjs`'s `surfaceCrossingInside`, `spike/fixtures.mjs`'s own "THIRD
  traversal" fixture), confirmed `SurfaceCrossingWitness` is a real `bvhcast`-native traversal. Rewrote the
  passage to describe its actual candidate-pair enumeration, ceilings (`maxCandidatePairsExamined = 50_000`,
  `maxCrossingPairsExamined = 64`), and abort protocol — consistent with the fixture and with
  `ProperCrossingQuery`'s own established pattern — and corrected the "all three are plain JS loops"
  statement it had wrongly extended to cover this traversal.
- **H-5C1 / H-G1, H-5C2 / A2, and the related unbounded-growth finding**: fixed by redesigning the
  `CollisionInstance` cache, per a `codex-advisor` consultation (two rounds — the second correcting the
  first once a pre-existing fixture requiring cross-call object-reference stability was surfaced and fed
  back in). The cache is now a frozen, transform-free identity object (`fragmentId` + immutable
  `GeometryIdentity`), cached per `(loadEpoch, fragmentId)` with stable object references across calls
  (satisfying the pre-existing stale-eviction fixture), released as its own independent epoch-scoped sweep
  in both `evictModel` and `dispose()` (no longer subordinate to `GeometryRegistry`'s sweep — closes H-5C1/
  H-G1). World-matrix/world-bounds state moved to a new call-local `PlacedCollisionInstance`, never cached,
  never mutated on the shared object — closes H-5C2/A2 structurally rather than by disclaimer. Added an
  explicit `maxCollisionInstancesPerEpoch` capacity check (with its own atomic-operations table row and
  performance-gate measurement bullet), since strict cross-call reference stability rules out
  individual-entry eviction as a memory-bounding mechanism. Two new regression fixtures pin the concurrency
  guarantee (two interleaved calls sharing a canonical instance never observe or mutate each other's
  placement snapshots) and the capacity rejection.
- **H1**: fixed by reverting `bvhcast`'s time-based abort trigger to a traversal-local clock, explicitly
  named as the deliberate exception to every other checkpoint's shared-accumulator convention (rather than
  silently reverting), with corrected reasoning: the private clock's own worst case sits within, not
  beyond, the performance gate's ~16ms tolerance band, and ties the verdict to the traversal's own cost
  rather than its scheduling position.

`node spike/fixtures.mjs` — **55/55 pass**, both before and after the remediation edits (expected: this
pass edits only the spec's prose; `spike/*.mjs` is a standalone prototype the fixtures describe but don't
execute).

**Deliberately deferred, with rationale:**

- **H2 (sync-work/budget)** is a genuine, previously-unflagged-in-any-round finding about the worst-case-span
  formula's own soundness — but it is PRE-EXISTING, not caused by any Round-21 edit, and closing it properly
  requires re-deriving the formula's worst-case term (not a wording fix), which is outside this pass's
  explicitly bounded mandate: fix confirmed Highs remaining after `invariant-audit-v4.md`, using v4 as the
  sole source of truth, without expanding into newly-surfaced pre-existing architecture questions. Recorded
  here for a dedicated future round, distinct from the five self-inflicted regressions this pass closed
  because it introduced them.
- **Every Medium and Low finding** listed above remains deliberately unfixed, per the pass's own scope
  (High-only, and — for the two Round-20 Mediums and M-Q2/M-Q3 specifically — per explicit instruction to
  preserve them unchanged).

---

# Answer to the specific question this round was run to settle

**Zero Critical invariant regressions**, confirmed independently by five auditors covering all five
systems, with two hard adjudication calls (A1, A2/H-G1/H-5C2) each independently corroborated by
`codex-advisor`. **Five High-severity regressions were introduced by this pass's own Round-21 fixes** — an
expected cost of a High-only pass touching thirteen findings across four systems in one sitting, not a
sign the methodology failed: every one was caught by the same five-system audit discipline this lineage
has used since v1, verified against primary evidence (a pinned Viewer bundle, an executable spike, two
independent auditors converging on the same severity from opposite angles), and fixed before this document
was finalized. One further High (H2) was surfaced but is pre-existing and out of this pass's scope,
deferred with explicit rationale to a future round. The current state, after remediation: 0 Critical, 0
unresolved Round-21-introduced High, 1 explicitly deferred pre-existing High, the full set of
already-known Medium/Low findings carried forward unchanged.
