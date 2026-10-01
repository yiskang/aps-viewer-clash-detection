# Internal Review — G2 Live-Readiness Remediation (H1 / H2 / M1 / L1–L4)

**Date:** 2026-10-01 · **Scope:** uncommitted harness-only remediation on `main @ d07dea0`; offline only; no live G2.
**Authority:** `docs/prompts/for-claude-g2-live-readiness-remediation-only.md`. Accepted procedure SHA-256 `5f9c4c7e…2abb` unchanged. Files changed: `test/acceptance/clashpanel-viewerbridge.acceptance.mjs`; tests: `…mainflow.test.mjs`, `…prefix.test.mjs` (adapted), new `…crossrealm.test.mjs` (30), `…finalization.test.mjs` (10).

## Design delivered
- **H1 — one composite sequence.** `seq = major·2^20 + minor`. The page allocates only minor 0 (`createPageSeqSource`); Node allocates minors ≥ 1 under the highest page major it has ingested (`createRunSeqCounter.ingestPage`). Realms cannot collide; each is strictly monotone; `realmOfSeq` derives the realm without a schema change. Minor exhaustion reuses one reserved minor ⇒ guaranteed `seq-not-unique` (row 5), plus an explicit fatal. The `seqBase` seeding is removed.
- **H1 — attribution.** `createRunAuthority.syncPage` validates (hw never regresses; phase in enum and never backwards; activeCheck owned by phase; activeControl valid) and adopts phase/activeCheck/activeControl as the Node attribution read by the network instrumentation. The runner awaits `sync.attribution` at every marker, C1 finalization, `beginCheck`/`beginControl` (26 driver call sites now `await`) and clear-after-driver; a refusal throws before the attributed action. The seq a change introduces is allocated *before* the fence so the reported high-water includes it. Operation begin/end and page-fatal forwards piggyback `hw`; an op `begin` whose phase differs from the authoritative phase is refused once synced. Hide/unload/teardown therefore get P9/cleanup instead of stale P1.
- **H2 — authoritative gate.** New awaited `__g2NodeSync` binding. `gate`: Node, synchronously, ingests hw → reconciles page fatals → `prepareC1Gate` on `state.errorLedger` (finalize provisional responses, rebuild witnesses, count, `gateSeq`). The page validates the record (`authoritativeGateProblems`); live mode without `sync` refuses (`node-sync-missing`). The page fatal mirror is demoted to an abort-latch hint. Page-origin fatals carry contiguous ids; `reconcilePageFatals` (at gate, `drain` fence and after the run) fails closed once on any gap/duplicate/late transfer. A `drain` fence precedes the result return.
- **M1 — item 24.** Gate finalization now runs on the authoritative ledger; `responseRules` is resolved once and passed to instrumentation, load-window close, gate and closeout finalization (fixes internal-review finding below).
- **Preserved unchanged:** C15(e)/H_iso, global C1 gate semantics, synthetic dispositions, effective-state accessor, NRDB L1–L4, N7/N8, one-witness-per-identity, HTTP ≥ 400 default-fatal, prefix provenance, operation ledgers, closeout K, `LIVE_PATH_WIRED=false`, `G2_DUAL_COUNTER_GATE.resolved=false`.

## Low dispositions
| Low | Disposition |
|---|---|
| L1 `requestfinished` swallowed | **Fixed** (`failClosed('requestfinished')`; entry `network-instrumentation:requestfinished`; tested). |
| L2 teardown C-e cleanup-marker proxy | **Preserved Low.** The classifier (`classifyRequestFailure`) receives only ledger slices; at event time check records do not exist, and event-time/closeout results must stay deep-equal (R1 `agree`). A direct check needs a classifier-signature + accepted-procedure semantic change, or procedure wording reconciliation (“final verdict” vs marker) — out of scope. Causally bounded; slightly more permissive than the literal wording. |
| L3 C15(e) contradiction → FAIL via R1 | **Preserved Low.** Procedure says “evidence contradiction (§8 row 5)” without mandating the path; R1 verification failure is closeout-failure row 5; verdict-safe (PASS impossible). |
| L4 `T_iso` source | **Preserved Low.** Spy records store only capped summaries (`argSummaries` depth 2/8 items; digest), not the `[{model,ids}]` argument; reading it needs a recorder/wrapper change (evidence-schema widening). Ledger target remains the consistency source; divergence blocks (never passes). |

## Findings of this pass
- Codex review (`codex-review code`, medium) of the harness diff: **0 Critical / 0 High / 1 Medium / 1 test-gap.**
  - **Medium — response rules applied inconsistently** (`deps.responseRules` not passed to load-window/closeout finalization): **fixed**, static test added.
  - **Test gap — real Playwright binding scheduling untested** (VM + delayed-channel stand-in only): **open, recorded as before-live work** (one browser integration test: P9 sync, acknowledged hide/unload + overlapping abort, page fatal racing the gate, drain reconciliation/uniqueness).
- Subagent findings: (a) `mark()/finalizeC1` fence ordering — **fixed** (allocate then sync); (b) `peek()` after overflow — **fixed**; (c) `syncPage` does not check control-vs-phase ownership — design limitation, accepted.
- Documented limitation: order across realms is authoritative at the fences; inside one fence epoch a Node event sorts after the page's last *reported* allocation only. CDP-vs-binding arrival order is not guaranteed by Playwright; unverified live.

## Classification
Critical 0 · High 0 · Medium 0 open (1 fixed) · Low: L2, L3, L4 preserved; limitation + live-integration-test gap recorded as before-live work.

## Verification
Focused: `node --test test/acceptance/clashpanel-viewerbridge.acceptance.*.test.mjs` **542/542** (baseline 502). Aggregate: `npm run test:offline` **4788 total / 4787 pass / 0 fail / 1 todo** (baseline 4748/4747/0/1). `git diff --check` clean. No file outside `test/acceptance/` and `docs/` changed.
