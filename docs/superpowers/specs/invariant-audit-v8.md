# Invariant-driven consistency audit — Round 8 (post-Round-30, including in-session remediation)

Type: invariant-model audit (not a Codex review round), replicating v1–v7's methodology exactly. Input:
`docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`, post-Round-30 (the High-only fix
pass targeting `invariant-audit-v7.md`'s 5 Highs — see `round-30-high-only-fix-pass-disposition.md`). **No
prior disposition doc was trusted as evidence anything is currently fixed** — every claim below was
re-verified against live spec text, exactly as v1–v7 always have.

**Method:** one agent (opus) built a fresh consolidated invariant model from a complete sequential read of
the full current spec (`invariant-audit-v8-model.md`, 1546 lines, 29 markers). Five parallel agents (opus)
then audited the full spec text against that model, one system each — lifecycle, geometry pipeline, query
semantics, synchronous-work/budget, cache ownership — independently re-verifying every Round-30 claim
against current text rather than trusting `round-30-high-only-fix-pass-disposition.md`, and specifically
probing the 5 fixes that pass claims to have made. Several `codex-advisor` consults happened across the
model-build and system audits, all independently re-verified against primary text before acceptance (see
each per-system report for its own consults).

**Unlike v1–v7, this round found genuine self-inflicted High-severity regressions from the fix pass it was
auditing — 6 of them, all now fixed within this same session**, following the precedent this lineage set in
Round 21/`invariant-audit-v5.md` (fix self-inflicted regressions immediately, before finalizing the audit
document, rather than deferring them to a future round). See §4, "Remediation," below for the full account.

Per-system detail lives in `invariant-audit-v8-lifecycle.md`, `-geometry.md`, `-query.md`, `-syncwork.md`,
and `-cache.md`.

---

## 1. Independent verdict on Round 30's 5 claimed fixes

Re-derived from live text by the model-builder and cross-checked by all 5 system auditors, not assumed:

| Round-30 fix | Verdict (pre-remediation) | Verdict (post-remediation) |
|---|---|---|
| H-1 — `containment`/`non-manifold-component` contradiction | **FIXED, clean.** All 6 occurrences mutually consistent (query auditor independently re-derived soundness, including for non-manifold as well as open sources). | Unchanged — clean. |
| H-2 — "budgets bound the worst case" contradiction | **FIXED**, but introduced a dangling cross-reference to a section name that doesn't exist anywhere in the document (both rewritten sites). | **Fixed** — both sites now cite the correct existing section. |
| H-3 — `CollisionInstance` capacity-admission span | **FIXED and SOUND.** Independently re-derived by three separate auditors (syncwork, cache, and the geometry auditor's own cross-check): `\|U\| > ceiling ⟹` the existing bucket-capacity check would reject anyway, for every bucket state including empty. No premature rejections, no new race. | Unchanged — sound. One new regression found and fixed: the fixture's own stated *rationale* was factually false (see §4). |
| H-4 — geometry gate's input classification | **ONLY HALF FIXED at first.** Provenance/call-frequency genuinely closed, but the sizing cost was silently folded into the compaction+welding phase's bounded (`12_000`-valued) table row while that row's own text admitted the cost was "not itself ceilinged" — v7's "unclassified unceilinged span inside a self-declared-exhaustive taxonomy" was **relocated, not removed**. Two further regressions found in the same area (see §4). | **Fixed.** Reclassified as a third accepted non-preemptible atomic risk, with its own table row, stripped out of the compaction+welding row; propagated to the exclusion list, gate criterion 1, the measurement-gap list, and a new gate-criterion bullet. |
| H-5 — `SurfaceIntersectionQuery` in the taxonomy | **FIXED.** Named in all four previously-silent passages; uniqueness claim correctly reframed at the protocol level (verified independently at spec lines ~1927–1930: the private-clock trigger fires at callback entry, so it applies unchanged to a probe-loop-free traversal). `SurfaceCrossingWitness` stays distinct at five sites. | Unchanged — clean. One downstream regression found and fixed (a stale traversal-count ordinal, and a phrase-reuse ambiguity — see §4). |

---

## 2. Critical findings

**None**, across all five systems, independently confirmed by five separate auditors plus the coordinating
session's own line-by-line diff review. No case produces a wrong boolean result or an unrecoverable state.

---

## 3. High findings (pre-remediation) — all found by v8, all fixed within this session

Six distinct High-severity regressions, all introduced by Round 30's own edits (none pre-existing, none
carried from v7), found independently by the five parallel v8 system auditors and fixed immediately by two
coordinated fix-forks plus the coordinating session's own direct edits, before this document was finalized.

**H8-1 — Dangling cross-reference to a nonexistent section** (syncwork, corroborated by query). Both sites
Round 30's H-2 fix touched now cite a section, "Budget enforcement and yield points," that appears nowhere
in the document (`git log -S` confirms it was never committed text — pure Round-30 working-tree invention).
**Fixed**: both sites now cite the correct, pre-existing section, "Atomic operations and what remains
non-preemptible."

**H8-2 — New regression fixture's own stated rationale is factually false** (syncwork, independently
corroborated by cache as H-8C2). The fixture Round 30 added to test the new capacity-admission precheck
claimed "an empty bucket never trips a combined-total check no matter how large the query's own unique set
is" — the exact negation of the arithmetic (`0 + U > ceiling` is trivially possible) the whole precheck fix
depends on. The fixture's spy assertions were correct; only the stated reasoning was wrong. **Fixed**:
rewritten to state the real distinguishing property — the precheck rejects *before* any bucket lookup,
which is a timing/ordering difference from the bucket-capacity check, not an outcome difference (both would
eventually reject this case).

**H8-3 — Gate criterion 1's stale "one provisional exception" count** (syncwork). Round 30 added a second
provisional member (capacity-admission) to the enforceably-bounded tier, but the gate criterion that
excepts provisional members from strict pass/fail still said "one." **Fixed**: now names both provisional
members (`enumNodeChildren` and capacity-admission) as the tier's fourth and fifth members.

**H8-4 — Stale duplicate description of the capacity-admission sequence** (cache, rated High; the same
underlying gap independently found by syncwork as a Medium — this pass adjudicates High, per the cache
auditor's reasoning that an implementer working from the untouched copy would build exactly the design the
new H8-2 fixture asserts must fail). The `CollisionInstance` identity cache's admission steps are described
in two places; Round 30 updated the canonical Data Flow copy with the new precheck but left a second copy
under Components byte-identical to its pre-Round-30 text, despite the Data Flow copy explicitly
cross-referencing Components "for its own precheck." **Fixed**: the Components copy now defers to the
canonical Data Flow sequence by cross-reference, per this document's own established
duplicate-description convention (the same shape H-1's and Round 21's H-Q1's fixes used).

**H8-5 — Geometry gate's classification cost relocated, not removed** (geometry, corroborated
independently by syncwork as its own H3). Confirmed accurate by the geometry auditor's own re-read: H-4's
fix folded the `ViewerGeometryAdapter` sizing sub-step's admittedly-unceilinged cost into a
`12_000`-valued, bounded table row, and no gate criterion measured or excluded it. **Fixed** (see §4 for
the full remediation, including a `codex-advisor` consult on the remedy shape): reclassified as a third
accepted non-preemptible atomic risk, given its own table row, and propagated through every dependent site
(worst-case-span exclusion list, gate criterion 1, the measurement-gap list, a new gate-criterion bullet).

**H8-6 — Narrow-phase restructuring risked reopening a duplicate-build race window** (geometry). Round 30's
H-4 fix restructured the narrow phase to run normalization and the size-ceiling check *before* inserting
the registry entry, on a lookup miss — apparently in tension with the document's own "Insert first, then
build" rule, whose own explanatory prose describes the exact historical race this ordering exists to
prevent, and the document never explicitly stated the intervening normalization sequence is synchronous and
non-reentrant. **Fixed** via a `codex-advisor` consult (the geometry fork's own account, in its final
report): rejected the consult's own heavier recommendation (a new provisional pre-`'building'` registry
state) because it would have required the oversized-marking invariant — "a distinct entry kind, never
derived from `'building'`, never carrying a cancellation signal" — to be reopened, which the task's
constraints (don't reopen stabilized lifecycle/cache architecture unless strictly required) rule out absent
a stronger justification. Took the lighter alternative the consult itself offered instead: an explicit
atomicity assertion — classification, the registry-lookup-miss, and entry-insertion now run as one
synchronous unit, no intervening yield, mirroring the pattern the `CollisionInstance` capacity-admission
step already established — plus an honestly disclosed, filed-under-Viewer-API-drift assumption that
`getRenderProxy` and its property accesses are synchronous and non-reentrant, since this spec cannot verify
that from documentation. This preserves "insert before any yield" without inventing new registry
architecture, at the cost of one explicitly named residual assumption — consistent with this document's own
established convention for this shape of gap (e.g. H-B9's precedent, cited by the fork).

**A seventh related item, found by the geometry auditor as H8-G3, was intentionally narrowed rather than
architecturally fixed**: the restructured narrow phase's "never repeats normalization or the ceiling check"
claim didn't hold for the two `FragmentDiagnosticReason` values other than the size-ceiling outcome
(`unsupported-geometry-layout`, `rejected-primitive-range` — normalization-failure diagnoses, which settle
no persistent registry-entry state and so can still recur per candidate pair). This is the same shape as
v7's pre-existing Medium finding M7-G3, newly exposed rather than newly created by Round 30's restructuring.
**Deliberately not architecturally closed** — doing so is real new work, correctly out of scope for a
High-only pass. **Fixed only to the extent of removing the overclaim**: the "never repeats" sentence now
explicitly scopes itself to the ceiling outcome and names the two diagnoses it doesn't cover, so the text no
longer asserts something false.

---

## 4. Remediation — full account

All 6 regressions in §3, plus the incidental scope-narrowing in the paragraph above, were fixed within this
same session, before this document was finalized, following Round 21's precedent
(`round-21-high-only-fix-pass-disposition.md`'s own addendum: "All five self-inflicted regressions were
fixed within this same session, before `invariant-audit-v5.md` was finalized"). Two coordinated fix-forks
handled the work in parallel (one for H8-1/H8-2/H8-3/H8-4, one for H8-5/H8-6 and the FragmentDiagnosticReason
scope-narrowing), with the coordinating session directly fixing two smaller, independently-found Medium
items in the same pass since they were trivial, directly Round-30-caused, and immediately adjacent to work
already under review: a stale "second `bvhcast`-native traversal" ordinal (now "third," since
`SurfaceIntersectionQuery`'s admission to the private-clock exception makes `SurfaceCrossingWitness` the
third such traversal, not the second — query auditor's M-Q6, syncwork's M4) and a phrase-reuse ambiguity in
`SurfaceCrossingWitness`'s own passage (query auditor's M-Q5, where "the same abort protocol" — newly
defined by H-5's fix to specifically mean the private-clock mechanism — was ambiguously applied to a
shared-clock traversal on the exact axis the taxonomy separates them by; disambiguated to name the shared
flag-and-callback-return mechanism specifically, not the clock basis).

Two `codex-advisor` consults happened during remediation (both `medium` effort, both independently
re-verified against primary spec text before acceptance): the geometry fork's consult on H8-6's remedy
shape (described in §3 above — the consult's own heavier recommendation was declined with explicit
reasoning, its lighter alternative taken instead), and an earlier consult during the original Round-30 pass
on H8-5's classification (also declined once, refined, and accepted on re-verification — see
`invariant-audit-v8-geometry.md` for the full transcript-level account).

`node spike/fixtures.mjs` — **55/55 pass**, re-verified by the coordinating session after every remediation
edit, not only trusted from fork reports.

---

## 5. Medium findings (all carried forward, undeferred, per the task's explicit High-only scope)

Full detail and citations in each per-system report; counts by system (post-remediation, since the two
Medium items fixed incidentally above are no longer open):

- **Lifecycle** (`invariant-audit-v8-lifecycle.md`): 3 — M-L1 (scope now covers a third traversal,
  `SurfaceIntersectionQuery`, but severity unchanged), M-L2, M-L3, all carried from v7 unchanged in substance.
- **Geometry** (`invariant-audit-v8-geometry.md`): 4 — carried from v7 (M-G1/M7-C1, M7-G2, M7-G3, plus one
  new item the auditor's own report details).
- **Query** (`invariant-audit-v8-query.md`): 6 — M-Q1 through M-Q4 carried (M-Q1 marginally aggravated,
  M-Q2 incidentally narrowed — both by Round 30's H-1 fix, neither touched intentionally, consistent with
  the pass's own no-Medium-fixes instruction), plus M-Q6 was fixed incidentally (see §4) so the live count
  is 5 substantive items plus one already-resolved.
- **Sync-work/budget** (`invariant-audit-v8-syncwork.md`): 4 — M-SW1/M-SW3 carried from v7 (M-SW1 was
  Round-30's own explicit re-check target and is now fully fixed at both sites), one new item (M-8C2-adjacent
  dual-purpose-constant tension), M2 (the Components duplicate) resolved via H8-4's fix.
- **Cache** (`invariant-audit-v8-cache.md`): 6 — M-7C1 through M-7C4 carried (M-7C3 remains upstream of
  M-7C1/M-G1 exactly as v7 recorded), plus M-8C2 (new: `maxCollisionInstancesPerEpoch` now serves two
  purposes whose gate criteria push its value in opposite directions, unreconciled).

None of these were fixed, per the task's explicit instruction not to touch Medium/Low findings in this pass
— the two Medium items that did get fixed (M-Q5/M-Q6-shape items) were direct, trivial, single-sentence
consequences of Round-30's own High-level edits, not independent Medium-finding remediation.

## 6. Low findings

Carried forward from v7 with two new additions the lifecycle auditor found (L-L5, L-L6, both consequences of
M-L1's widened scope) — full detail in `invariant-audit-v8-lifecycle.md`. Not touched, consistent with scope.

---

## 7. Verdict

**0 Critical, 0 unresolved High** — the task's stated success criteria, met.

The 5 original Highs from `invariant-audit-v7.md` are confirmed fixed by independent re-derivation (§1). The
6 additional High-severity regressions this same fix pass introduced (§3) were caught by this v8 audit and
fixed within this session before finalizing this document (§4), following this lineage's own established
Round-21 precedent for self-inflicted regressions. All Medium and Low findings — both carried from v7 and
newly found by v8 — are deliberately deferred, consistent with this pass's explicit High-only scope; none
block the stated success criteria.

**No High finding was intentionally deferred.** Every High this audit found, across both the original v7
set and the regressions v8 itself surfaced, was fixed before this document was finalized.

---

## Method notes

- Per-system detail, full citations, fixture cross-references, and each auditor's own severity rationale
  live in `invariant-audit-v8-lifecycle.md`, `-geometry.md`, `-query.md`, `-syncwork.md`, `-cache.md`.
- Fresh invariant model: `invariant-audit-v8-model.md` (1546 lines, complete sequential read of the current
  ~4900-line spec, 29 markers: 4 `[CONTRADICTION]`, 8 `[AMBIGUOUS]`, 17 `[SILENT]`).
- `node spike/fixtures.mjs`: 55/55, both before this audit began and after all remediation landed.
- **All 6 self-inflicted regressions this pass found were fixed within this same session, before this
  document was finalized** — see §4.
