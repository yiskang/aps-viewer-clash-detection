# Round 25 — Medium/Low pass: close the cache/concurrency cluster from `invariant-audit-v6-cache.md`

Scope: **M-6C1, M-6C2, M-6C3, M-6C4, M-6C5, L-6C1, L-6C2 only**, from `invariant-audit-v6-cache.md`.
No Critical or High architecture was touched. No lifecycle/query/budget/geometry findings were touched.
No Round-23 housekeeping items were touched. No Codex *review* was run — an independent subagent
re-audit was used for verification, per this pass's own instructions; the standing repo preference for
`codex-advisor`/`codex-review` over the native `advisor` tool was communicated to that subagent as a hard
constraint, and it did not need to invoke either.

---

## Findings addressed, grouped by invariant

### Cluster 1 — cache-declaration prose staleness (M-6C1, M-6C2)

**M-6C1: CLOSED.** `ViewerModelAdapter`'s heading (`## Components`, "raw ingredients for a
`CollisionInstance`") named two fields (`worldMatrix`, `worldBounds`) that `CollisionInstance` is now
defined never to hold post-Round-21. Fixed by naming both destination objects in the heading —
`CollisionInstance` **and** its call-local `PlacedCollisionInstance` — with a pointer to the
"`CollisionInstance` identity cache" section, which already states the routing precisely. No mechanism
change; this was a summary-heading staleness, not a contradiction anything depended on.

**M-6C2: CLOSED.** "Retention is explicitly bounded" overstated the mechanism: `maxCollisionInstancesPerEpoch`
bounds one epoch's retained count, but the design explicitly supports multiple simultaneously-live epochs
(two objects sharing a reused `modelId`, both live) and nothing ceilings how many. Fixed by retitling the
heading "Retention is bounded per epoch, not in total" and adding the explicit
`maxCollisionInstancesPerEpoch × (live epochs)`, unceilinged, formula — cross-referencing the
atomic-operations table's own already-hedged retained-*count* language rather than duplicating it. Gate
criterion 10's per-epoch-only measurement scope was left untouched, per the task's "prefer
cross-referencing over introducing a second parallel description" instruction — the finding was about
spec-text precision, not a demand to change what the gate measures.

### Cluster 2 — release-path sweep/dispose prose (M-6C3, M-6C4, M-6C5)

**M-6C3: CLOSED** (with one self-caught follow-up, see below). The atomic-operations table's sweep-cost
row described only the `GeometryRegistry` half of `releaseEpochScopedState`/`dispose()`'s sweep, omitting
the second, independent `CollisionInstance`-cache bucket deletion entirely. Fixed by adding a clause
stating that second deletion's cost, keyed to the cache's stated physical partitioning
(`Map<loadEpoch, Map<fragmentId, CollisionInstance>>`).

*Follow-up caught by the independent re-audit subagent, fixed in the same pass:* the first draft of this
clause claimed the `CollisionInstance`-cache deletion is "O(1)" for **both** `evictModel` (one
`Map.delete(loadEpoch)` — genuinely O(1) regardless of that epoch's fragment count) **and** `dispose()`
(one `Map.clear()` over every live epoch's bucket at once) — but `dispose()`'s clear spans every live
epoch, and M-6C2's own new text (same pass) declares live-epoch count unceilinged, so a flat "O(1)" claim
for `dispose()` was in tension with M-6C2. Corrected: `evictModel`'s single-epoch delete keeps its O(1)
claim; `dispose()`'s whole-map clear is now stated as **unmeasured** with respect to live-epoch count,
cross-referenced to M-6C2's own unceilinged-epoch language, the same honest gap this row already carries
for the `GeometryRegistry` half. No new mechanism, no new cache — a wording correction only.

**M-6C4: CLOSED.** `dispose()`'s own contract (the `world.dispose()` code-comment block) stated no
non-throwing requirement for its wholesale clear, even though the atomic-operations table's sweep row
already claims one ("required to be non-throwing … `dispose()`'s equivalent"), and `evictModel`'s own
contract states one for `releaseEpochScopedState`. Fixed by adding the same non-throwing statement to
`dispose()`'s own contract, with reasoning that mirrors `evictModel`'s (a version that could throw
partway through would leave `disposed` set but the release incomplete and unretriable — substituting the
correct retry-blocking mechanism for each: a missing epoch on the evicted tombstone for `evictModel`, a
`WorldDisposedError` on any second `dispose()` call for `dispose()`).

**M-6C5: CLOSED.** `dispose()`'s clear enumerates four caches (`GeometryRegistry`, `BlasCache`, every
cached `GeometryConnectivity`, the `CollisionInstance` identity cache) at both sites that describe it, but
both still closed with the singular "the entire cache" — confusing after a four-item list. Fixed at both
sites (the code-comment block and the "`world.dispose()` is terminal" prose block) with mutually
consistent plural phrasing ("all four caches … each in its own single clear operation" /
"all four caches in full"). Confirmed via `grep` that no singular "the entire cache" phrasing survives
anywhere in the file.

### Cluster 3 — gate/error-handling completeness (L-6C1, L-6C2)

**L-6C1: CLOSED.** Gate criterion 1 mixed vocabulary — "the corrected worst-case-span bound" established,
then one measurement called "above the **band**" (pre-Round-22 term) while the parallel clause one line
later said "above the **corrected bound**." Fixed the stray "band" occurrence to match; confirmed no
"band" usage remains inside criterion 1 (the two surviving "band" references elsewhere in the file are
unrelated historical-narration passages outside this finding's scope).

**L-6C2: CLOSED.** `maxCollisionInstancesPerEpoch`'s rejection had no **Error Handling & Edge Cases**
bullet, unlike its three siblings (`maxFragmentsPerDbId`, `maxChildrenPerNode`,
`maxBroadPhaseInstancePairs`). Added a bullet in the same style and position (after the
`maxBroadPhaseInstancePairs` bullet), describing the call-level pre-mutation rejection contract
(consistent with the Round-24-fixed four-phase capacity-admission ordering) and naming the shared
`[SILENT]` gap its three siblings already carry.

---

## What was deliberately not touched

- H-6C1's closed four-phase capacity-admission ordering (Data Flow step 3, the cache declaration, the
  atomic-operations table row, the fixture) — re-verified unchanged, not re-litigated.
- The frozen-identity / call-local-placement split for `CollisionInstance` and epoch-scoped
  ownership/release semantics — re-verified unchanged, not re-litigated.
- Gate criterion 10's per-epoch-only retained-size measurement scope (noted by M-6C2, not required to
  fix it — see above).
- No second capacity path, secondary cache, or new lifecycle state was introduced anywhere in this pass.
- L-6C3 (the "sibling `Components` entry, cross-referenced as if a subsection of `GeometryRegistry`"
  finding) — explicitly out of this pass's numbered scope (only M-6C1–M-6C5, L-6C1, L-6C2 were listed);
  left open, undisturbed. It is a stylistic/cross-reference-framing observation the audit itself called
  harmless ("consistent everywhere... noted only because it looks deliberate"), not a defect with any
  concrete failure mode — deferred rather than bundled into this pass to keep the diff to the smallest
  correct layer per finding actually in scope.

---

## Verification performed

1. **Re-verification against current spec before editing**: every one of the seven findings was
   re-confirmed present, at its current (post-H-6C1-fix) line location, by direct read against the live
   file — not assumed from the audit document's now-stale line numbers (H-6C1's own fix shifted
   everything after line ~1229 by +51 net lines).
2. **`node spike/fixtures.mjs`**: **55 passed, 0 failed**, both before and after the M-6C3 follow-up fix.
   (As in Round 24: this spike covers only geometry classification, not cache/registry/capacity
   machinery — a regression sanity check that the unrelated geometry spike is undisturbed, not a direct
   test of this pass's prose changes.)
3. **Independent targeted cache-ownership/concurrency invariant re-audit**, dispatched as a fresh subagent
   with no access to this editing session — instructed to be adversarial, not to rubber-stamp the diff.
   Verdict: 6 of 7 findings cleanly CLOSED on first read; M-6C3 CLOSED per the audit's literal ask but
   flagged the `dispose()`/epoch-count tension above (moderate confidence), which was fixed in this same
   pass per the "self-correct" precedent set by Round 21. The subagent separately re-read H-6C1's
   four-phase ordering (Data Flow step 3, the fixture) and the frozen-identity/epoch-scoped-release
   passages directly — all outside every diff hunk — and confirmed both unchanged and internally
   consistent.
4. **No stale "the entire cache" / "above the band" phrasing survives** — confirmed by `grep` across the
   full file after edits.

---

## Disposition

**0 Critical regressions. 0 High regressions.** H-6C1 remains closed; the frozen-identity/
call-local-placement split and epoch-scoped ownership/release semantics are unaffected.

**M-6C1 through M-6C5: CLOSED.** **L-6C1, L-6C2: CLOSED.**

**L-6C3: explicitly deferred, out of this pass's stated numbered scope** — a harmless, self-consistent
cross-reference-framing observation with no concrete failure mode, not one of the seven findings this pass
was scoped to.

No second capacity mechanism, secondary cache, or new lifecycle state was introduced. All edits were
prose corrections or cross-references; no diff hunk touches Data Flow step 3's four-phase ordering, the
cache declaration's admission contract, the atomic-operations table's capacity row, or the fixture that
pins H-6C1's fix.
