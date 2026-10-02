# Internal Review — G2 Cleanup Phase / Transfer-Stage (M1) Fix

**Date:** 2026-10-02 · **Baseline:** `main == origin/main == b33b7a94eaaefd4b3c7f097a4c743a5bb5abf80a`; procedure SHA-256 `5f9c4c7e124751d09406f07eab63f844fec53add006bd12ad676ecaca3732abb` (unchanged).
**Authority:** `docs/prompts/for-claude-g2-cleanup-phase-transfer-stage-m1-fix-only.md`; input: [independent re-review](2026-10-02-g2-cleanup-event-provenance-independent-rereview.md). Harness/tests only; both gates unchanged; nothing committed; operation-refusal and the single allocator untouched.

## Semantic phase vs transport stage

- **Transport stage** = which transfer carried the ordinal (`run` ≤ phase-result high-water, `cleanup` = cleanup drain range, else null) — fixed only by `rewritePageRun(…,{stage})`.
- **Semantic phase** = the page-registered attribution of the ordinal (and the event's own `phase`). A `phase:'cleanup'` event is a mandatory cleanup event whether it was carried by the cleanup drain **or** by the tail of the run transfer past the cleanup marker (forward check: stage `cleanup` OR stage `run` with phase `cleanup`).

## Cleanup-marker boundary proof (run-carried cleanup events only)

Valid only when ALL hold: ev.phase/source phase `cleanup`; source is a `run`-stage `event` ordinal; **exactly one** authoritative `cleanup` marker whose source is an ingested run-stage `alloc` ordinal, phase `cleanup` and **identity label `marker:cleanup`** (the runner's `mark()` now allocates `marker:<name>`); `ev.seq > marker seq` (ingestion order = ordinal order, so this is the post-marker proof); identity label matches the event kind; seq appears exactly once (a delta re-sending a run-carried event is a `merge-duplicate`). Otherwise fail closed: `cleanup-event-boundary-unproven` (zero/two markers, unqualified or substituted marker), `cleanup-event-before-boundary`, `cleanup-event-outside-drain` (only post-drain / unstaged ordinals now), `cleanup-event-phase-mismatch`, `cleanup-event-identity-mismatch`, `cleanup-event-duplicate`, `cleanup-event-unsourced`, `cleanup-event-missing`, `cleanup-event-leaked-ordinal`. An arbitrary run-stage event (any non-cleanup phase) is never treated as cleanup; a run-carried cleanup-source event whose authoritative phase/kind is rewritten stays under validation (`semanticCleanupSrc`).

## Review round (Codex focused: 0 Critical / 2 High / 2 Medium) and dispositions

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | High | Unlabeled event sources bypassed identity validation (null label exempt) | **Fixed**: ingest rejects any `event`-kind ordinal without a non-empty string label (fence: one `ingest-entry-invalid`; early: deferred); identity check unconditional |
| 2 | High | A cleanup callback allocating while the drain fence is in flight could escape provenance | **Fixed**: `g2CleanupDrain` is a bounded (8-round) stable-fence loop; returns only when the page high-water did not move; else `ok:false` "did not stabilize" ⇒ one `cleanup-evidence:drain-refused` fatal |
| 3 | Medium | Marker was shape-qualified, not identity-bound | **Fixed**: marker label `marker:cleanup` required; substitution tests |
| 4 | Medium | Final run-result `eventLog` is snapshotted before the final drain: an event recorded during that last drain would be reported missing (conservative false-FAIL, never false-PASS) | **Deferred / recorded** (needs run-result eventLog from the live recorder at return) |

Incidental: the previous pass's documented conservative false-FAIL (cleanup event inside the run result ⇒ `outside-drain`) is **removed**; its pinning tests were flipped to PASS. Independent regression found by a test agent (phase-rewritten run-carried event skipped by the reverse loop) was fixed (`semanticCleanupSrc`).

## Verification (non-live)

Focused G2 suite **693/693** (prior 652); aggregate `npm run test:offline` **4939 total / 4938 pass / 0 fail / 1 existing todo** (prior 4898/4897); `npm run test:g2:binding` **8/8**; `git diff --check` clean. Required cases 1–8 plus identity, marker substitution, stable drain and non-vacuity mutations covered (cleanup-evidence 50, mainflow 98, crossrealm 40, sequencing-guards 16).

## Readiness

Cleanup provenance appears fully closed (bidirectional, identity- and boundary-bound, drain-stable); **H1 appears technically closed pending independent confirmation**; operation-refusal remains closed. `G2_DUAL_COUNTER_GATE.resolved=false`, `LIVE_PATH_WIRED=false`. Preserved: Medium failed-phase cleanup retention, Medium durable op-refusal detail, Medium broader local-counter static guards, and the Lows recorded by Work.
