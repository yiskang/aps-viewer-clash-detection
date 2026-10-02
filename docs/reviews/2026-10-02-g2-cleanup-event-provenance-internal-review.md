# Internal Review — G2 Cleanup Event Provenance Fix

**Date:** 2026-10-02 · **Baseline:** `main == origin/main == b33b7a94eaaefd4b3c7f097a4c743a5bb5abf80a`; procedure SHA-256 `5f9c4c7e124751d09406f07eab63f844fec53add006bd12ad676ecaca3732abb` (unchanged).
**Authority:** `docs/prompts/for-claude-g2-cleanup-event-provenance-fix-only.md`; governing input: [independent re-review](2026-10-02-g2-h1-cleanup-operation-refusal-remediation-independent-rereview.md) M1 (cleanup `eventLog` provenance not checked in the reverse direction). Harness/tests only; both gates unchanged; nothing committed. Operation-refusal behaviour untouched (Work-closed).

## Provenance model (no second sequencing authority)

The Node-assigned authoritative `seq` remains the only ordering. The Node authority keeps a provenance table, one row per ingested page ordinal: `{seq, ord, realm:'page', kind, label, phase, activeCheck, activeControl, stage}` (`authority.provenance()`), where `stage` is `run` (ordinal ≤ phase-result high-water), `cleanup` (inside the cleanup drain range `(runBoundary, drain hw]`) or `null` (`stageOfOrdinal`). The stage boundary is fixed only by `rewritePageRun(run, {stage:'run'})` and `rewritePageRun(delta, {stage:'cleanup'})` (a second cleanup stage ⇒ violation `cleanup-drain-repeated`). Page ordinals now carry a `label` (the eventLog entry's own `kind`, e.g. `wrapper-restore`) registered at allocation, so source record identity is verifiable. Authoritative `eventLog` entries are unchanged (no schema change).

## Reverse validation (`authority.pageEvidenceProblems`, reached through the existing `cleanup-evidence:` fatal)

Existing forward/spy/snapshot checks unchanged. New cleanup-event labels (stable, distinct):

| Label | Detects |
|---|---|
| `cleanup-event-missing:<seq>` | ingested cleanup-drain `event` ordinal with no authoritative eventLog entry |
| `cleanup-event-duplicate:<seq>` | more than one authoritative entry for one cleanup source / merged twice (also duplicate unsourced entries) |
| `cleanup-event-unsourced:<seq>` | phase-`cleanup` (or drain-sourced) entry whose seq is not an ingested page `event` ordinal |
| `cleanup-event-outside-drain:<seq>` | cleanup event sourced by an ordinal outside the cleanup drain range (run stage, post-drain, or no range) |
| `cleanup-event-phase-mismatch:<seq>` | drain-sourced event whose phase / source phase is not `cleanup` |
| `cleanup-event-identity-mismatch:<seq>` | drained event whose `kind` differs from the label registered for its ordinal (substituted payload) |
| `cleanup-event-leaked-ordinal:<seq>` | event seq still a page-local ordinal (`page-ordinal-leaked` also still reported) |
| `cleanup-drain-repeated` (violation) | second `{stage:'cleanup'}` rewrite |
| `cleanup-evidence:merge-duplicate:<n>` (fatal) | `mergeCleanupDelta` now returns `{duplicates}`; any already-present seq in a cleanup delta is a failed merge, never a silent dedup |

Labels are de-duplicated (`[...new Set(out)]`), one fatal per root cause (`first (+n)`).

## Tests (non-live)

- Focused G2 suite **652/652** (prior 613): cleanup-evidence 31, mainflow 77, crossrealm 39, sequencing-guards 16 (plus op-refusal 22 etc.). Required cases 1–8 of the prompt covered at unit and full-`main()` level, each with a non-vacuity mutation of the harness text (pre-fix block removed ⇒ the unsourced / phase-mismatch / identity worlds PASS).
- Aggregate `npm run test:offline`: **4898 total / 4897 pass / 0 fail / 1 existing todo** (prior 4858/4857). `npm run test:g2:binding`: **8/8** (real chromium, outside the offline suite by repo policy). `git diff --check` clean.

## Findings (Codex focused review + agents)

Critical none, High none; Codex: **0 Critical / 0 High / 3 Medium** → disposition:

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | Medium | A phase-`cleanup` event captured inside the RUN result (recorded during the await after `mark('cleanup')`, before the snapshot) fails closed as `cleanup-event-outside-drain` | **Accepted, documented, pinned by tests** as a conservative false-FAIL (never a false PASS), per the owner invariant that every cleanup event must be drain-sourced. Work may relax it (accept run-stage sources with consistent `cleanup` phase) |
| 2 | Medium | Provenance did not bind event identity (a substituted payload with the same seq passed) | **Fixed**: page-registered `label` + `cleanup-event-identity-mismatch` (unlabeled ordinals are exempt — a documented limit; the recorder always labels events) |
| 3 | Medium | Duplicate merge was silently deduplicated | **Fixed**: `mergeCleanupDelta` returns `{duplicates}`; drain treats `>0` as `merge-duplicate` failure |
| 4 | Low | Repeated/inflated labels; missing duplicate label for duplicate unsourced seqs | **Fixed** (set-dedupe; duplicate check independent of source) |
| 5 | Low (open) | `mergeCleanupDelta` counts non-object entries as duplicates (label slightly misleading, fails closed); duplicates *within one delta* are not counted by the merge (caught by `pageEvidenceProblems` as `page-evidence-duplicate`/`cleanup-event-duplicate`) | Accepted |
| 6 | Low | Misplaced JSDoc / stale field lists | **Fixed** |

Preserved dispositions: Medium — static guards cannot detect every consumer-local counter; Lows — active-control phase validation, teardown C-e proxy, C15(e) FAIL routing, `T_iso` evidence authority, refused `ops.end` leaves record unsettled, thrown drain RPC lacks exact error name; deferred failure-path Mediums from the previous pass (cleanup evidence not drained when the phase run throws; exact op-begin failure message retained only in the page `phaseLog`).

## Readiness

Cleanup `eventLog` provenance is now mechanically one-to-one in both directions with source identity and drain-range provenance. **H1 appears technically closed** pending independent confirmation; the operation-refusal High remains closed; `G2_DUAL_COUNTER_GATE.resolved=false` and `LIVE_PATH_WIRED=false`.
