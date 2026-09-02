# Invariant-driven consistency audit — Round 6 (post-Round-22, pre- and post-remediation)

Type: invariant-model audit (not a Codex review round). Input:
`docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`. Prior work this audit checks:
`docs/superpowers/specs/invariant-audit-v5.md` (Round 5, which deferred H2 as pre-existing and out of its
own High-only pass's scope) and `docs/superpowers/specs/round-22-h2-derivation-pass-disposition.md` (the
single-finding H2 re-derivation pass this audit verifies).

**Method, replicating v1–v5's:** one agent (opus) built a fresh consolidated invariant model of the same
five systems from the current post-Round-22 text, written to
`docs/superpowers/specs/invariant-audit-v6-model.md` (1362 lines, built from a complete sequential read
of the design doc). Five parallel agents (opus) then audited the full spec text against that model, one
system each — lifecycle, geometry pipeline, query semantics, synchronous-work/budget, cache ownership —
re-verifying Round 22's edits against current text, explicitly distinguishing NEW (introduced or exposed
by Round 22) from PRE-EXISTING findings. Two rounds of self-correction happened *during* this audit,
before it was finalized: the query-semantics and sync-work/budget auditors independently found a
wording contradiction in Round 22's own first-draft edit (H-Q1/H6-B3), and the geometry-pipeline and
sync-work/budget auditors independently found a substantive-but-numerically-harmless error in Round 22's
own explanatory reasoning (H6-G1/H6-B1, plus its H6-G2 and H6-G3/H6-B2 corollaries) — both were fixed in
this same pass, before this document was finalized, exactly as Round 21's own self-inflicted regressions
were fixed in v5's pass rather than deferred. See
`docs/superpowers/specs/round-22-h2-derivation-pass-disposition.md`'s own "self-correction" sections for
the full working record of both.

Per-system detail lives in `invariant-audit-v6-lifecycle.md`, `-geometry.md`, `-query.md`, `-syncwork.md`,
and `-cache.md`. This document consolidates.

---

# Critical

**One found — C-L1 (lifecycle), PRE-EXISTING, not caused by Round 22, confirmed unreachable from H2's
own edits.** The Milestone-1 acceptance fixture requiring "eviction of the *counterpart* model while a
shared build is in flight" is unsatisfiable by construction: it requires the evicted model to be an
operand of the initiating query (so that query rejects `ModelEvictedError`) **and** not the owner of the
awaited build record (so the shared phase slot doesn't itself reject) — but Milestone 1 rejects
cross-model queries outright (`source.model === target.model`), and records are keyed by the owner's
`loadEpoch`, so owner === source === target always; "counterpart" can never simultaneously satisfy both
halves of the fixture's own premise. The underlying build-phase ownership rule this fixture was meant to
regression-test stays correct (vacuously, since the scenario it describes cannot occur) — only the
fixture's own wording and one supporting rationale clause need correcting. Never recorded by v1–v5;
newly surfaced by this round's lifecycle auditor, unrelated to anything Round 22 touched (confirmed via
`git diff` isolating Round 22's edits to seven hunks, none in this fixture's region).

**Deliberately not fixed in this pass** — out of H2's explicitly bounded scope (a single-finding
worst-case-span re-derivation, not a lifecycle fix pass) and unrelated to any invariant this pass's own
edits could have reopened. Recorded here for a dedicated future round, matching the lineage's own
convention (v5's own H2 was deferred from a High-only pass on the same "surfaced but out of this pass's
bounded scope" ground).

All other protected Critical invariants — Model-object identity/`loadEpoch`, disposed-first checkpoint
semantics, `GeometryRecord` entry-lifetime cancellation ownership, active-range gating/compaction/weld/
connectivity/BVH ownership, extraction's accepted atomic-risk boundaries, the mode dependency matrix —
were independently re-read and confirmed intact by all five auditors.

---

# High

**Four findings, all caused by or exposed by Round 22's own edits, all fixed in this same pass before
this document was finalized** (see the disposition doc's two self-correction sections for full detail):

1. **H-Q1 / H6-B3 (query semantics / sync-work, independently found by both auditors).** Round 22's first
   draft claimed both `bvhcast`-native traversals (`ProperCrossingQuery`'s `intersectsTriangles` and
   `SurfaceCrossingWitness`) use the private, traversal-local clock exception. `SurfaceCrossingWitness`'s
   own (unchanged) passage states its abort checks the *shared* accumulator instead — a direct
   contradiction. Fixed by restricting the abort-only-tier treatment to `ProperCrossingQuery`'s traversal
   only, with `SurfaceCrossingWitness`'s actual shared-accumulator, fine-per-probe-granularity mechanism
   correctly folded into the cooperative-composition tier instead. The deeper, separate question of
   whether `SurfaceCrossingWitness` reading the shared accumulator inside a permanent, result-altering
   abort reproduces the pre-Round-21 scheduling-position-dependent-verdict defect is flagged as a genuine,
   pre-existing, unresolved determinism question — explicitly not decided by this pass.
2. **H6-G1 / H6-B1 (geometry pipeline / sync-work, independently found by both auditors).** Round 22's
   first draft claimed "only one non-preemptible/abort-only unit can ever be the one absorbing prior
   undischarged work in a given span," and, as a retained corollary, that "the three build phases never
   compound with each other in one span." Both are false at the document's own measured figures:
   connectivity (~6.9ms) is itself below `frameBudgetMs` (8ms), so connectivity and the BVH build can
   share one ~22.9ms span. `codex-advisor` (effort `high`) confirmed the **numeric** ≈24.8ms bound
   survives unchanged — the general proof only requires the aggregate cost *before the span's last unit*
   to be below `frameBudgetMs`, regardless of how many earlier units contributed to that prefix — so this
   was an error in the explanation, not the value. Fixed by replacing both claims with the general
   prefix-plus-final-unit argument and a corrected, figure-scoped statement of which phases can and
   cannot compound.
3. **H6-G2 (geometry pipeline).** A pre-existing Round-15 regression-test description, read literally,
   demands three actual scheduling yields for a mocked three-phase build whose costs are each
   individually under `frameBudgetMs`; `codex-advisor` confirmed this is impossible under the corrected
   conditional-checkpoint model (real yield count is at most one, for any costs meeting the fixture's own
   stated constraints). Fixed by rewording the fixture to assert three checkpoint *evaluations* (which is
   what the regression it guards against actually requires), not three yields.
4. **H6-G3 / H6-B2 (geometry pipeline / sync-work, independently found by both auditors).** The ≈24ms
   figure is computed from three of the enforceably-bounded tier's four members (weld/connectivity/BVH);
   the fourth, one `enumNodeChildren` call at the `maxChildrenPerNode` ceiling, is explicitly unmeasured
   elsewhere in the document. Fixed by stating ≈24ms as provisional for that member specifically, in both
   the formula passage and the performance-gate pass criterion, pending its own gate measurement.

**One found, PRE-EXISTING, not caused by Round 22, confirmed via `git diff`, deliberately not fixed:**

5. **H-6C1 (cache ownership).** `maxCollisionInstancesPerEpoch`'s capacity check is specified at three
   mutually exclusive granularities across the doc (Data Flow step 3's ordering contradicts the
   call-level contract and its own fixture), plus a related `uniqueMissingCount` staleness gap
   `codex-advisor` surfaced during adjudication. Confirmed unrelated to Round 22 — `git diff` isolates
   Round 22's edits to seven hunks, none in any cache region. Out of this pass's scope (H2 is a
   sync-work/budget-system finding; this is cache ownership); recorded here for a dedicated future round.

---

# Medium (highlights; full detail in each auditor's own report)

- **Lifecycle.** M-L1/M-L3: the corrected conditional-yield wording didn't restate whether the two-part
  `disposed`-then-epoch revalidation applies identically after a *non*-yielding checkpoint, and
  "per-yield checkpoint"/"yield point" vocabulary elsewhere now reads inconsistently with "checkpoints
  don't always yield." M-L2 (pre-existing): the release-path sweep's cost model still omits the
  `CollisionInstance` cache's keyspace.
- **Query semantics.** M-Q1 (new): the `bvhcast` clock-basis passage's "sits within the tolerance band"
  support is now self-referential, since the band it cites is partly derived from this same traversal's
  own bound.
- **Sync-work/budget.** Residual imprecision the auditors flagged and this pass judged Medium, not
  High, and left deliberately unfixed (consistent with the pass's High-only mandate): the unexplained
  `2×frameBudgetMs` factor is now a normative input rather than a stated derivation; "~16.8ms … at the
  sync-triangle ceiling" cites a 19,800-triangle measurement against a 12,000-triangle provisional
  ceiling (pre-existing, previously recorded in v5's own M1–M9); "the same clock" cross-reference
  language is unchanged and still slightly loose.
- **Cache ownership.** Pre-existing, not worsened by Round 22: the `ViewerModelAdapter` heading still
  calls world matrix/bounds "ingredients for a `CollisionInstance`," which the cache's own redesigned
  contract says it never holds; "retention is explicitly bounded" reads as global when it's per-epoch;
  the sweep's cost model still names only the `GeometryRegistry` half of what it walks.

**Confirmed unchanged, as instructed:** every Medium/Low finding from `invariant-audit-v5.md` not listed
above — none of Round 22's edits touched query, lifecycle, cache, or extraction behavior, and all five
auditors independently verified this via direct re-read and, for the cache and geometry-pipeline systems,
a targeted `git diff` check.

---

# Low (highlights)

Two genuinely historical "~16ms" mentions (Round 18's and Round 21's own contemporaneous reasoning,
inside their own changelog narration) were confirmed correctly left unrewritten, matching this document's
existing convention for not editing history. Status header staleness (unchanged since v5's own Low
finding, deliberately not touched — out of scope for both a High-only and this H2-only pass). Full detail
in each auditor's own report.

---

# Remediation

All four Round-22-caused/exposed High findings (H-Q1/H6-B3, H6-G1/H6-B1, H6-G2, H6-G3/H6-B2) were fixed in
this same pass, immediately after the five audits reported them, before this document was finalized —
regressions this pass introduced or exposed while fixing v5's H2, resolved before completion rather than
deferred. See `round-22-h2-derivation-pass-disposition.md`'s two self-correction sections for the full
before/after text and the `codex-advisor` consult (effort `high`) that adjudicated both.

`node spike/fixtures.mjs` — **55/55 pass**, before and after every edit in this pass (expected: this pass
edits only the spec's prose; `spike/*.mjs` is a standalone prototype the fixtures describe but don't
execute).

**Deliberately deferred, with rationale:**

- **C-L1 (lifecycle)** and **H-6C1 (cache ownership)** are both genuine, previously-unflagged findings —
  but both are PRE-EXISTING, confirmed unrelated to Round 22's edits (`git diff`), and closing either is
  outside this pass's explicitly bounded mandate: re-derive and fix the worst-case-synchronous-span
  formula (`invariant-audit-v5.md`'s H2), not expand into newly-surfaced pre-existing findings in
  unrelated systems. Recorded here for dedicated future rounds, distinct from the four self-inflicted
  regressions this pass closed because it introduced or exposed them.
- **Every Medium and Low finding** listed above remains deliberately unfixed, per this pass's own scope
  (a single High finding, not a Medium/Low cleanup pass).

---

# Answer to the specific question this round was run to settle

**Zero Critical regressions caused by Round 22** — the one Critical found (C-L1) is confirmed
pre-existing and unrelated, independently verified by the lifecycle auditor and by `git diff` isolating
Round 22's edits to seven hunks outside that fixture's region. **Four High-severity regressions were
introduced or exposed by Round 22's own first-draft edits** — an expected cost of re-deriving a
central, widely-cross-referenced formula in one sitting, not a sign the methodology failed: every one was
caught by the same five-system audit discipline this lineage has used since v1 (two of the four
independently caught by two auditors apiece, from different system angles), verified against the
document's own primary evidence (measured figures in the atomic-operations table, the general
conditional-checkpoint rule already stated elsewhere in the text) and against `codex-advisor` (effort
`high`), and fixed before this document was finalized. **H2 itself is resolved**: no live claim states
the superseded `max(...)` form or the ≈16ms figure as a current bound; the corrected additive formula
(`frameBudgetMs` + one covered atomic unit's own worst-case cost, ≈24ms at the currently-measured
figures, explicitly provisional pending the one still-unmeasured tier member) is stated consistently at
every site that references it, including the two sites this pass itself introduced. One further Critical
(C-L1) and one further High (H-6C1) were surfaced but are pre-existing and out of this pass's scope,
deferred with explicit rationale to dedicated future rounds. **Current state, after remediation: 0
Critical caused by this pass (1 pre-existing, deferred), 0 unresolved Round-22-caused High (1
pre-existing, deferred), the full set of already-known Medium/Low findings carried forward unchanged.**
