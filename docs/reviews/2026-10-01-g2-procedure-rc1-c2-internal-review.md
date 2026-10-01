# Internal Review — G2 Procedure RC1 final bounded correction (RC1-C2)

**Date:** 2026-10-01
**Branch / HEAD:** `main` @ `68ef222f097d5ff34b475fdb3980fe662574ac3d` (= `origin/main`)
**Artifact:** [`docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md`](../research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md) (uncommitted; RC1 + RC1-C1 + RC1-C2)
**Authority:** `docs/prompts/for-claude-g2-rc1-final-bounded-correction-only.md`; governing input [corrected RC1-C1 independent re-review](2026-10-01-g2-procedure-rc1-c1-corrected-independent-rereview.md) (H1, M1, M2). Prior internal review: [RC1-C1](2026-10-01-g2-procedure-rc1-c1-internal-review.md).
**Scope:** C1 gate record semantics; NRDB legality / X4; N8 dependency graph; request fatal-witness correlation/counting; directly affected schemas/examples/matrix. Documentation only.

## Baseline

Procedure `a1dbbd8f57bc1d2bd0c871fd098c62239d9d54799458de4621b45164556b8722` (RC1-C1) verified before editing; dormant harness unchanged; `LIVE_PATH_WIRED=false`.

## Corrections applied

| Finding | Correction |
|---|---|
| H1 gate contradiction | Every `checks`/`controls` entry has a `recordType`: `check-run`, `control-run` (executed), or `gate-disposition` (synthetic: `executed:false`, `synthetic:true`, `gateGenerated:true`, null start fields, exact `disposition` enum, `blockingReason`, `dependencyBlockedBy`, `evidenceRefs` exactly `['/gates/C1','/checks/C1']`, rules G-a…G-f). Required for every C2–C20 and N1–N8 under a closed gate; never read as a check verdict; no downstream run record may coexist with a closed gate. Old `BLOCKED(dependency:C1)` downstream encoding removed. NRDB legal only inside a gate-disposition record. |
| M1 N8 | `N8.dependencyIds = [C1,C4,C7,C8]`; N7 stays `[C1,C16]`; C20 excluded (acyclic); dependency-table test. |
| M2 one-to-one witness | Raw events (`rawEventId`, `identityKey`, `duplicateOf`, `reqIdValid`) → `correlatedRequests[]` (one per identity, severity order, ownership conflict ⇒ `unknown-fatal`) → `fatalWitnesses[]` (exactly one per fatal identity) → `fatalCount` incremented only at witness creation; bijection invariant; invalid `reqId` ⇒ one witness per raw event (fail-safe); closeout recomputation ⇒ `fatal-witness-mismatch` (row 5). Tests (18)–(24). |

## Focused internal review (one Codex `spec` pass, medium; request `20261001-105945-88999-24414`)

Verdict: **requires major revision** → 0 Critical / 2 High / 3 Medium. All five findings were genuine and were fixed in **one minimal remediation pass**; **no second Codex pass** (CLAUDE.md review boundary: the findings concern machinery introduced by earlier remediation, so the loop stops here).

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | High | `reqIdValid` had no persisted source of truth | **Fixed:** exact `errorLedger.requestObservations[]` (one per Playwright `request`; `reqId := 'q:'+startSeq` via Request-object identity map); every valid raw event references exactly one observation; `prefixSourceLedger` references observations; closeout recomputes `reqIdValid`/`identityKey`; test (23). |
| 2 | High | Closed-gate execution ban depended on undefined "attribution" | **Fixed:** closed enumerated predicates CG-1…CG-7 over named collections, one added attribution field set (`seq/phase/activeCheck/activeControl`) where missing, exhaustive legal-record list, one mutation test per CG predicate. No universal envelope introduced. |
| 3 | Med | NRDB L5 retroactive / inconsistent | **Fixed:** record legality = L1–L4 only; rows 1–3 are verdict precedence (former L5). |
| 4 | Med | §10 control schema had incompatible shapes | **Fixed:** discriminated unions (`check-run`\|`gate-disposition`, `control-run`\|`gate-disposition`); effective state by `recordType`. |
| 5 | Med | Gate-time provisional finalization had no sequence boundary | **Fixed:** atomic gate preparation (finalize → rebuild witnesses → recompute invariant → allocate `gateSeq`); `finalizedSeq ≤ witnessSeq < gateSeq`; test (25) both orderings. |

No Critical/High finding remains known at this abstraction level. Remaining items are **implementation-plan requirements** (harness follow-up) or **verification gates** (offline tests).

## Judgement calls for Work re-review to confirm

- One witness per request identity (not one per raw event); a runtime `BLOCKED` check that never started after an OPEN gate stays a `check-run` record.
- `targets` and `screenshots` are excluded from CG-7 (writing phase not fixed by the procedure; `targets` may be computed in P1); `activeControl` not added to raw network events (control-driven Viewer actions are caught via the spy ledger under CG-2).
- Passive P1 network/fatal events between the gate and cleanup are legal only with `phase:'P1'` and null attribution.
- A duplicate event with an invalid `reqId` is counted twice (fail-safe), not merged.
- Fatal-by-default HTTP ≥400 retains its known conservative false-FAIL risk (unchanged, accepted).

## Exact harness follow-up (NOT performed; unauthorized; `LIVE_PATH_WIRED` stays false)

Items 1–14 are unchanged from the [RC1-C1 internal review](2026-10-01-g2-procedure-rc1-c1-internal-review.md), with these amendments: item 3 now reads "legality **L1–L4** (former L5 = verdict precedence; NRDB only inside a `gate-disposition` record)"; item 5 includes the atomic gate preparation; item 6 reads "X4 / X20–X23 updates and new X24–X29"; item 13 reads "§9.2 tests (1)–(25)".

15. **Synthetic C1 gate-disposition records/schema:** `recordType` discriminator on every `checks`/`controls` entry; one `gate-disposition` per C2–C20 and N1–N8 under a closed gate (G-a…G-f); remove the old `BLOCKED(dependency:C1)` encoding; `computeOverall` reads check verdicts only from `check-run` records; row-6 `CLOSED_DEPENDENCY_BLOCKED` clause.
16. **Corrected NRDB handling:** NRDB only inside `gate-disposition`; L4 `terminalSeq = dispositionSeq`; `dependencyBlockedBy` on C2–C20 dispositions under `CLOSED_DEPENDENCY_BLOCKED`; X4/X20–X24/X28/X29 encodings.
17. **Corrected N8 dependencies:** `N8 = [C1,C4,C7,C8]` (C20 ∉ N8); `N7 = [C1,C16]`; dependency-table test (exact rows, ascending, acyclic).
18. **One-to-one fatal-witness correlation/counting:** raw-event fields, `correlatedRequests[]`, `fatalWitnesses[]`, witness-creation-only `fatalCount` increment, `witnessCount` invariant, `fatalCountAtGate` by `witnessSeq`, closeout recomputation ⇒ `fatal-witness-mismatch`.
19. **Matrix/schema/static tests:** gate-disposition accept/reject (G-a…G-f, `verdict` key, `executed:true`, run records under closed gate, disposition under OPEN); row 8 unreachable with dispositions present; X28/X29; record-type matrix dimension; §9.2 tests (18)–(25); N7/N8 dependency tests.
20. **Request-observation ledger:** `errorLedger.requestObservations[]`; `reqId := 'q:'+startSeq` through a Request-object identity map with lookup on response/requestfinished/requestfailed; `prefixSourceLedger` references observations; recompute `reqIdValid`/`identityKey`; `witnessCount.requestObservations`; test (23).
21. **Closed-gate evidence predicates:** add `seq/phase/activeCheck/activeControl` to every `spyLedger`/`eventLog`/`stateSnapshots` entry; `wrapper-install`/`wrapper-restore` event kinds; CG-1…CG-7 + exhaustive legal-record list in `validateResultSchema`; under a closed gate `c17`/`c20`/`n6` null and `c4Table` `[]`; one mutation test per CG predicate plus legal cleanup/closeout acceptance tests.
22. **NRDB legality refactor:** L1–L4 pure function; rows 1–3 by precedence only.
23. **Discriminated-union schema:** `checks`/`controls` union validators; effective-state accessor used by rows 4, 7, 8.
24. **Atomic gate preparation:** synchronous finalize → rebuild witnesses → recompute invariant/`fatalCountAtGate` → allocate `gateSeq`; reject `finalizedBy:'gate'` with `finalizedSeq > gateSeq`; test (25).

**Before live execution only (unchanged):** M1/M2 static-guard hardening over the pre-link dependency graph and full live closeout consumers; commit final procedure/harness/tests/reviews; clean tree; recompute digests; issue a new single-use authorization record.

## Verification

- Procedure SHA-256: `20a0c98cd3fa955a4b9314a07afc17fd58b2de1a246bf4381b419697a490f741` (RC1-C1 `a1dbbd8f…`; not final).
- `git diff --check` clean; `node --test test/acceptance/clashpanel-viewerbridge.acceptance.tablet.test.mjs` **7/7** (does not exercise the new semantics).
- `git diff --name-only HEAD -- test clashpanel`: **0 files**; `LIVE_PATH_WIRED = false`.
- No live G2, Playwright/Viewer execution, real-Viewer injection, commit, push, or authorization record.

## Status

Ready for **independent Work re-review** targeted to H1/M1/M2 and the five internal-review fixes. Not ready to commit; harness follow-up, live planning and live G2 remain unauthorized.
