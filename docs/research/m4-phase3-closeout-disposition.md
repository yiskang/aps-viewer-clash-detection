# M4 Phase 3 closeout / disposition report

**Status: CLOSED — Verdict D, accepted by the milestone owner.**
**Phase 4: NOT started. This document does not authorize it.**

This is the formal closeout of M4's Phase 3→4 decision checkpoint, following the
canonical-ordering / operand-symmetry fix (`docs/superpowers/plans/2026-09-11-canonical-ordering-operand-symmetry-fix-implementation.md`,
merged as commits `31fcd1e..b6a0787` on `feature/m4-performance-worker-decision-design`).
It records the milestone owner's decision on the evidence produced by that plan's Phase E,
not a new evidence-gathering pass — no gate was re-run to produce this document.

## Evidence source (VALID population only)

Exactly as scoped by Task E2 of the canonical-ordering-fix plan:

- **Used:** `test/performance/results/m4-gate-1789180565018.json` — the sole fresh, full,
  valid canonical-matrix run (`isFullCanonicalMatrix: true`, `disposition: MEASURED`,
  both `historical` and `multi-process` runtimes, 5 repetitions/tuple, Task E1,
  2026-09-11T23:59:45Z → 2026-09-12T02:36:03Z).
- **Excluded:** `test/performance/results/m4-gate-1789057417429.json` — a prior full-matrix
  attempt predating this whole plan (`disposition: FAILED_VALIDATION`), diagnostic-only,
  never merged into any figure below.
- **Derived checkpoint:** `docs/research/m4-phase3-checkpoint-post-canonical-ordering-fix.md`
  (Task E3, reviewed and Approved, 0 blocking findings) — this closeout report accepts that
  document's Steps 1-7 findings as given and does not re-derive them; only Step 8's
  provisional verdict is formally ratified here as the milestone owner's decision.

## Verdict: D

**Accepted by the milestone owner on 2026-09-20.** Three independent, unconditional causes,
none contingent on R6's confirmation status:

| Cause | Basis | Evidence |
|---|---|---|
| **§7.5.1** | Responsiveness target not externally confirmed | §7.2's target remains provisional; no product-approved figure exists in the repository (design doc lines 414-416, 531) |
| **§7.5.8** | Representative device/browser scope not externally established | Provenance records OS/browser/runtime, but nothing in the repository establishes this machine as a representative product device class (design doc §23, line 1189) |
| **§7.5.9** | No-full-query-evidence for the T-a-pass / T-b2-fail tuples | Proven unconditionally at 3 multi-process tuples with `Ta:true`/`Tb2:false`: `R1/tlas/cold`, `R1/linear/cold`, `R2/linear/cold` (design doc lines 463-465, 539 — one such tuple is sufficient) |

Per §7.5's own rule, a D verdict names every applicable condition, not only the first
sufficient one — hence all three are recorded together, and none is treated as redundant
once another is satisfied.

## S6′: not run, and correctly not run

S6′'s activation predicate (S1′ passes AND §18's C1 is not already analytically refuted) is
**technically true** on the current evidence: S1′ passed via its permitted build-variant route
(Task E1), and C1 has not been analytically refuted — the design doc's own §18 "Evaluation
order" instead calls for measuring it first ("C1 first (measure it — the only option with no
memory cost)", design doc lines 1020-1028), not for treating it as already resolved.

**Ruling (milestone owner, 2026-09-20): do not run it.** S6′ measures per-message
`postMessage` overhead for a per-pair worker-transfer topology — it is explanatory evidence
feeding the `Hᵢ(w,τ)` bound used only in Verdict C's own discriminator (design doc lines 496,
1022, 1152: *"S6′ is explanatory evidence only... and is never itself C's discriminator"*).
It has no bearing on any of the three causes above:

- It cannot confirm an external responsiveness target (§7.5.1) — that requires a product
  decision, not a measurement.
- It cannot establish representative device/browser scope (§7.5.8) — same reason.
- It cannot supply full-query evidence for the R1/R2 tuples §7.5.9 already names — S6′
  measures message overhead, not query completeness at those tuples.

Running S6′ would gather real data at real cost with **no path to changing the verdict** —
none of the three causes are inputs S6′ could ever move. This is not a scope-narrowing of
what S6′ is for; it is exactly what the design doc's own text already says it is for.

## R6 no-boundary finding: separate, conditional, not counted toward the verdict

Recorded exactly as `m4-phase3-checkpoint-post-canonical-ordering-fix.md` Step 5 states it,
not merged into the three unconditional causes above:

- `R6/tlas/refresh` and `R6/linear/refresh` both fail T-a (~69.5ms vs. the 50ms screen,
  4/5 repetitions over threshold, reproduced on both arms).
- **If** R6's ~10-instance workload is product-confirmed (design doc §5.5, lines 278-283):
  R6 becomes verdict-bearing and its refresh-arm failure adds the §1.1 no-boundary cause.
- **If not:** R6 is reclassified synthetic; its residual does not independently affect the
  verdict, which already stands on the three causes above regardless.
- This branch remains genuinely open — it requires an external product-confirmation decision
  this document does not make. It is recorded here as a pending conditional finding, not as
  a fourth unconditional cause, and not as something blocking this closeout.

## Tracked follow-ups (non-blocking — explicitly not gating this closeout)

Three items are carried forward as tracked work, not resolved here and not required to be
resolved before M4 Phase 3 closes:

1. **`run-gate-m4.mjs` T-c aggregation defect.** The gate's tuple aggregator retains only
   `status === 'DETERMINED'` repetitions before computing T-c, silently dropping real
   repetition-level `FAILURE` dispositions (438 multi-process instances observed in the
   Task E1 evidence) rather than surfacing them as `Tc:false`. Pre-existing in shared test
   infrastructure, unrelated to the canonical-ordering fix. Documented in
   `m4-phase3-checkpoint-post-canonical-ordering-fix.md` Step 2 and independently confirmed
   against `run-gate-m4.mjs:1296,2188` / `test/performance/m4/observation-envelope.mjs:55-72`.
   Does not affect the D verdict above (which rests on T-b2, not T-c).
2. **M3 Criterion 6 CAUTION→NO-GO.** The already-accepted coplanarity-epsilon fix admits 3
   more previously-inconclusive fragment pairs to `clearanceQuery`'s distance function on one
   fixture, escalating its non-gating worst-single-call-span metric from 10.8ms to
   19.5-19.8ms (reproduced twice). Correctness is unaffected (`disposition: MEASURED`, all
   cross-checks true); the metric never gates a build. Already explicitly acknowledged by the
   milestone owner on 2026-09-12. Documented in
   `docs/research/m4-d4-canonical-ordering-compatibility-classification.md` item 5b.
3. **M1 gate (`run-gate.mjs`) crash.** A Playwright structured-clone failure on a circular
   `Window` reference reachable through `ClashPair.source.model`, confirmed via git-history
   archaeology and a temporary pre-fix worktree to predate the canonical-ordering-fix plan
   entirely (present since the M2.1-era live-model-reference field was added to `ClashPair`).
   Documented in `docs/research/m4-d4-canonical-ordering-compatibility-classification.md`
   item 3.

## Disposition

**M4's decision gate is complete, with Verdict D reached under the pre-registered design.**
Per §7.3's own evidence→verdict mapping, D is one of exactly four defined terminal verdicts
(A/B/C/D) — it is not a placeholder, an intermediate state, or an "inconclusive" outcome that
requires Phase 4 to finish. Reaching D closes M4's decision gate in full; M4 Phase 3 is closed
on this verdict.

Phase 4 is not started by this document and no Phase 4 spike is authorized to begin by this
closeout: Task 4.1 (S5′) is not authorized (its predicate is not met — no viable boundary
topology survives the failed no-boundary screen); Task 4.2 (S6′) has its activation predicate
technically satisfied — the same S1′-passed / C1-not-yet-refuted fact pattern described in
"S6′: not run, and correctly not run" above — but is explicitly NOT authorized to execute per
the milestone-owner ruling recorded above, for the same reason given there (it cannot resolve
§7.5.1, §7.5.8, or §7.5.9 and therefore cannot change the verdict); and Tasks 4.3-4.8 (the
S7′/S8′ family) remain conditional on R6's product-confirmation status as already recorded.
This corrects only the phrasing of Task E3 Step 7's original spike-authorization recording
(which used "authorized" loosely for 4.2, meaning its activation predicate was satisfied, not
that its execution was cleared) so it does not contradict this document's own S6′ ruling
above; Task E3's original findings are not re-evaluated or expanded.

Per the M4 restart sequence's own item 9 ("only then evaluate Phase 4 authorization"), any
decision to begin Phase 4 work is a separate, later, optional decision for the milestone
owner — this closeout does not need to make that decision, and does not need Phase 4 to run,
in order to be complete itself.

**No merge, no push.** This report and the branch state it describes (`b6a0787`) await the
milestone owner's final review before any further action.
