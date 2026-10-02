# Internal Review — G2 H1 Cleanup Completeness + Operation-Refusal Remediation (2nd pass)

**Date:** 2026-10-02 · **Baseline:** `main == origin/main == b33b7a94eaaefd4b3c7f097a4c743a5bb5abf80a`; procedure SHA-256 `5f9c4c7e124751d09406f07eab63f844fec53add006bd12ad676ecaca3732abb` (unchanged).
**Authority:** owner prompt "G2 H1 Cleanup Completeness and Operation-Refusal Remediation Only"; governing input [independent Work review](2026-10-02-g2-h1-sequencing-remediation-independent-review.md) (H1 cleanup omission, H2 mutation-on-refusal). Harness/tests only; both gates unchanged (`G2_DUAL_COUNTER_GATE.resolved=false`, `LIVE_PATH_WIRED=false`); nothing committed.

## High 1 — cleanup-generated page records now reach authoritative state

**Mandatory (verdict-bearing) cleanup records:** every page recorder *spy record* (cleanup Viewer calls), every recorder *event* (`wrapper-install` / `wrapper-restore`, injection events) and every *state snapshot* produced after the phase result (page ordinal > `g.runResultHw`). Markers/execution seqs are `alloc`-kind and not independently mandatory.

**Design (single allocator preserved):**
- In-page `g2CleanupDrain` (new registry function) snapshots the cleanup delta and the page high-water in the same tick as an awaited `drain` fence (`g2NodeSync().drain()`), so Node ingests every unacknowledged ordinal (allocating authoritative seqs in ingestion order) before the delta is used; it returns `{ok, delta, error}` and never throws.
- Node `drainCleanup` runs **inside the `closePage` cleanup step, before the teardown op and `close()`** (`buildCleanupSteps({beforeClose})`; page-owned steps all precede `closePage`), under the T8 deadline: reconcile page fatals → `authority.rewritePageRun(delta)` (ordinal→seq map; high-water must equal the last ingested ordinal) → `mergeCleanupDelta` (exactly once per seq; eventLog merged seq-ordered, stable).
- Before the closeout marker, when the phase result was applied: a missing/failed drain ⇒ ONE fatal `cleanup-evidence:<reason>`; otherwise `authority.pageEvidenceProblems(state)` (both directions: every ingested `spy`/`event`/`snapshot` ordinal appears exactly once at its authoritative seq; every `spyLedger`/`stateSnapshots` seq comes from an ingested ordinal of that kind) ⇒ ONE fatal `cleanup-evidence:<first>(+n)`; then `assertAllocated`. A leaked/unmapped ordinal is also `page-ordinal-unmapped` / `page-ordinal-leaked`. All map to row 1 FAIL — closeout cannot PASS with missing mandatory cleanup evidence.

## High 2 — a refused/failed operation-begin now blocks hide/unload

`runAcknowledgedMutation({requireOps})` (live page sets `env.requireOps=true`; cleanup unloads pass `requireOps` through `createModelCleanupSteps`/`guardedUnloadModel`): a missing binding, thrown/rejected begin, `ok!==true`, or malformed response (no non-empty string `operationId`) **throws before any recorder activity and before `invoke()`**; no operation record exists. A cleanup unload without a ledgered model id under `requireOps` is also blocked. Node side: a refused `begin` (phase-mismatch, descriptor refused, sealed) records **exactly one** violation `op-begin-refused:<reason>` (`authority.refuseOperation`) and returns `{ok:false, reason}`; ingest refusals keep their single violation (no second one); `end` refusals unchanged (record stays not-settled). Offline callers without `requireOps` keep the old behaviour.

## Tests (non-live)

- Focused G2 suite: **613/613** (prior 558): new `op-refusal` (22), `cleanup-evidence` (10), mainflow +17 (62 total; fake page now implements `g2CleanupDrain` and cleanup evidence), crossrealm 38, sequencing-guards 14 (new guards for drain awaiting/ordering, `beforeClose`, requireOps-before-invoke, single violation per refusal, `mergeCleanupDelta`).
- `npm run test:g2:binding` (real chromium): **8/8** (prior 7; new real-binding case: refused/descriptor-refused begin blocks the page action, delayed begin acts only after the ack).
- Aggregate `npm run test:offline`: **4859 total / 4858 pass / 0 fail / 1 existing todo** (prior 4804/4803/0/1). `git diff --check` clean.
- Non-vacuity (mutated harness copies): removing the closeout completeness check, the `beforeClose` call, the requireOps throws, `refuseOperation`, the duplicate/unsourced checks or `mergeCleanupDelta`'s exactly-once filter each lets the defect through.

## Findings

Critical: none. High: none. (Codex focused review: **0 Critical / 0 High / 2 Medium**.)

| # | Sev | Finding | Disposition |
|---|---|---|---|
| M-a | Medium (failure path only; verdict already FAIL) | If the phase run throws/times out (`runApplied=false`) no cleanup drain/evidence check runs, so wrappers' cleanup records of a failed run never reach the failure artifact (blessed by an existing mainflow test) | **Deferred** — before-live hardening (drain with a failure-path boundary or a dedicated "phase result unavailable" snapshot). Not a false-PASS path |
| M-b | Medium (failure path only) | A thrown/malformed operation-begin keeps only generic `harness-exception:P9` durably (the exact message is in the page `phaseLog`, which `applyPhaseRunToState` does not retain) | **Deferred** — retain `phaseLog` or a sanitized barrier-failure entry. The mutation is blocked and one violation recorded for Node-side refusals |
| L-a | Low (fixed in this pass) | Empty-string `operationId` accepted as an acknowledgement; `requireOps` + non-A/B `modelId` fell through to an unguarded unload | **Fixed** + regression test |
| L-b | Low (disclosed) | A refused/throwing `ops.end` after a successful mutation is swallowed (record stays not-settled; end-refusal semantics unchanged per prompt) | Preserved |
| L-c | Low (disclosed) | `drain-threw` records no error name when the rpc itself throws (`withDeadline` maps it to status `threw`) | Accepted |

Remaining items from the previous review are unchanged: **Medium** static guards cannot detect every consumer-local counter (incidentally strengthened: guards now also pin that `drainCleanup`/`requireOps`/`refuseOperation` are used as designed, but a consumer ignoring its injected `nextSeq` is still not statically rejected); **Lows**: teardown C-e proxy, C15(e) FAIL routing, `T_iso` evidence authority (untouched); active-control phase validation (already tightened in the first pass; both sync and ingest paths enforce it).

## Readiness

Both High findings are closed in the offline model and the real-binding test. **H1 appears fully closed pending independent confirmation**; `G2_DUAL_COUNTER_GATE.resolved` remains `false` for the independent Work/owner decision.
