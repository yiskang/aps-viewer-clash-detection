# Round 24 — High-only pass: close H-6C1 (pre-existing cache-ownership finding)

Scope: **H-6C1 only**, from `invariant-audit-v6-cache.md`. No other finding from that audit (M-6C1
through M-6C5, L-6C1, L-6C2) or any Round-23 housekeeping item was touched. No Codex *review* was run —
this pass used `codex-advisor` (medium) once, as a second opinion on the ordering/concurrency judgment,
per this repo's standing preference for the Codex worker over the native advisor tool.

---

## H-6C1 recap

`invariant-audit-v6-cache.md` found `maxCollisionInstancesPerEpoch`'s capacity check stated at four
sites that don't agree:

- **A** (cache declaration, then 1230–1239) and **B** (atomic-operations table row, 1859) both state a
  call-level contract: collect the call's complete unique fragment-id set, check capacity once,
  synchronously, with no intervening `await`, **before** any bucket mutation or placement construction.
- **D** (fixture, then 4032–4037) pins the same contract with a spy: a rejecting call must construct
  **zero** `PlacedCollisionInstance`s for any fragment in the query.
- **C** (Data Flow step 3, then 2681–2688) prescribed the opposite order, scoped inside the per-dbId
  extraction loop: look up or create the canonical `CollisionInstance` → build the call-local
  `PlacedCollisionInstance` → **then** check capacity. Under Milestone 1's ordinary multi-target-dbId
  case (room-locator queries pass `dbIds: roomDbIds`), this let a call commit instances for dbIds
  1…*n*, yield, then reject on dbId *n+1* — leaving the epoch's bucket **permanently mutated by a call
  that rejected**, since entries are never individually evicted while their epoch stays live.

Severity was adjudicated **High, not Critical** in the audit (A's ordering is straightforwardly
implementable and satisfies A/B/D simultaneously — the contract is unsatisfiable as written under
reading C, not unsatisfiable by construction) and **not Medium** (C sits in the normative Data Flow
section and prescribes operation order; D's spy discriminates the two readings). Both adjudications were
independently corroborated by a `codex-advisor` consult recorded in the audit document itself.

## Verification performed this pass

Re-read all four sites directly against the live file before editing (no line-number drift since the
v6 audit's own citations — Round 23 touched only the lifecycle system, not this one):

- A: 1230–1239 (cache declaration, "Retention is explicitly bounded").
- B: 1859 (atomic-operations table row) — confirmed already consistent with A; not touched, per the
  audit's own "B needs no change."
- C: 2725–2732 (Data Flow step 3, the per-dbId-scoped capacity check inside the Extraction bullet).
- D: 4087–4092 (fixture) — confirmed already consistent with A/B; not touched, per the audit's own fix
  direction.

Confirmed the contradiction is real and unchanged: C's prescribed sequence (create canonical → build
placement → check capacity), scoped by the per-dbId loop whose own opening clause (now ~2561–2564)
governs its extent, still contradicts A/B's call-level, pre-mutation contract and D's zero-placement
rejection spy.

## Fix decision

Consulted `codex-advisor` (medium) on the audit's own proposed fix direction — rewrite C as an explicit
four-phase sequence lifted out of the per-dbId loop — before editing, focused specifically on the
ordering/concurrency judgment (not a general review). Codex's assessment, accepted in full, confirmed
the four-phase direction closes the contradiction and the per-epoch bound holds under concurrent calls,
and supplied two corrections the audit's fix direction hadn't stated explicitly:

- **Phase 1 must capture more than fragment ids.** It must also capture each fragment's
  `GeometryIdentity` (`loadEpoch` + `geometryIndex`) and this call's own `worldMatrix`/`worldBounds`
  snapshot — otherwise phase 3's admission (or phase 4's placement construction) could need to call back
  into `fragList` or another Viewer getter, and a synchronously reentrant getter inside the admission
  critical section would undermine the "no external callback" atomicity claim the same way an `await`
  would.
- **The recompute step must be a non-mutating lookup.** "Look up or create" must not create the bucket
  at recompute time — only create it (if absent) inside the same synchronous step that commits the first
  admitted instance, after the capacity check passes. Otherwise a capacity rejection can still leave an
  empty bucket behind, which is a smaller mutation than the audit's original finding but still violates
  A/B/D's "no bucket changes on rejection" wording literally.

Codex also flagged that the zero-mutation guarantee is specific to a *capacity* rejection — a later
failure in placement construction or broad-/narrow-phase work can still leave already-admitted canonical
instances resident — and that this pass's rewrite should say so explicitly rather than implying a
broader transactional guarantee that was never claimed. Both corrections are incorporated below.

**Fix applied — rewrite C only; A gets the same recompute-point clause added, per the audit's own fix
direction ("A needs step 2's recompute point stated"):**

1. **Site A** (1230–1239): restated as the same four-phase ordering — recompute against the bucket's
   *current* contents after the walk's last yield, check-and-commit synchronously with no reentrant
   calls, only then build placements — and added the explicit "look up without creating" and
   "zero-mutation guarantee is specific to capacity rejection" clauses Codex's consult supplied.
2. **Site C** (now the paragraph after the fanout/tally checks, before the Broad phase bullet): replaced
   the per-fragment "look up or create → build placement → check capacity" sentence with the explicit
   four-phase sequence — (1) capture id + `GeometryIdentity` + transform snapshot per fragment during the
   walk, (2) non-mutating recompute against current bucket state after the last yield, (3) synchronous
   check-and-commit with no reentrant calls, (4) build placements only after admission succeeds — plus a
   closing clause defining "look up or create" precisely (a lookup that finds nothing stages nothing) and
   scoping the zero-mutation guarantee to capacity rejections specifically.

**B and D were not touched**, per the audit's own "B needs no change" and this pass's confirmation that
D's fixture already asserts exactly the contract both rewritten sites now state.

**Explicitly not done:**
- The audit's optional, non-required "any/every affected epoch" → singular reword (defect (iv); Milestone
  1 only ever has one affected epoch since `source.model === target.model`). The audit itself says this
  is precision, not correctness, and not required — left alone to keep this pass's diff to the smallest
  correct layer.
- No second capacity mechanism was introduced (no reservation counter, no mutex) — Codex's consult
  confirmed one is unnecessary for this single-JS-realm design and would add lifecycle/cleanup complexity
  without improving correctness over the synchronous non-reentrant admission section already specified.
- L-6C2 (missing "Error Handling & Edge Cases" bullet for this rejection) and every other Medium/Low
  finding from `invariant-audit-v6-cache.md` — out of this pass's stated scope.

## Verification after the edit

- `node spike/fixtures.mjs`: **55 passed, 0 failed.** (The spike covers only geometry classification —
  `classifyPoint`, connectivity, containment, volume-overlap, surface-intersection — and has no
  cache/registry/capacity machinery; this run is a regression sanity check that the unrelated geometry
  spike is undisturbed, not a direct test of the cache-ownership prose change.)
- Targeted re-read of both edited sites against B (1859, untouched) and D (4087–4092, untouched):
  confirmed all four sites now state one ordering (recompute → check-and-commit synchronously → build
  placements), with no remaining site prescribing per-dbId or per-fragment capacity admission.
- `codex-advisor` (medium) consulted once on the ordering/concurrency judgment before editing; the edit
  incorporates its two corrections (phase-1 input completeness, non-mutating recompute lookup) verbatim
  in substance. Not re-run after editing.
- See the follow-up cache-ownership/concurrency invariant audit below for an independent system-level
  check.

## Disposition

**H-6C1: CLOSED.** All four sites (A, B, C, D) now state one call-level admission ordering: capture
complete per-fragment inputs during the walk, recompute the missing set against current bucket state
(non-mutating) after the walk's last yield, check capacity and commit synchronously with no reentrant
calls, and only then construct call-local placements. A rejecting call creates no bucket, commits no
canonical instance, and constructs no placement. The per-epoch bound holds under concurrent calls because
each call's own recompute-check-commit critical section is synchronous and non-reentrant, so no two
calls can interleave inside it.

**0 Critical invariant contradictions** found or introduced by this pass.

M-6C1 through M-6C5, L-6C1, and L-6C2 from `invariant-audit-v6-cache.md` remain open, untouched, out of
scope for this pass. Round-23 housekeeping items (L-R23-1/2 disposition, changelog/Revision Notes gap)
were not touched.

## Follow-up: targeted cache-ownership/concurrency invariant audit

See the subagent's independent re-derivation below.
