# Internal Review — G2 Procedure RC1-C1 bounded correction

**Date:** 2026-10-01
**Branch / HEAD:** `main` @ `68ef222f097d5ff34b475fdb3980fe662574ac3d` (= `origin/main`)
**Artifact:** [`docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md`](../research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md) (uncommitted; RC1 + RC1-C1)
**Authority:** `docs/prompts/for-claude-g2-rc1-bounded-correction-only.md`; governing input [independent RC1 review](2026-10-01-g2-procedure-reconciliation-independent-review.md) (H1, H2, M1–M3, Low1–2).
**Scope of this review:** C15(e) hidden-state semantics; HTTP-response fatal evidence; NRDB schemas / global C1 gate; request provenance / classifier / operation ledgers. Documentation only.

## Baseline provenance

The RC1 text audited by the independent review had been reverted by the owner (stale-prompt restore). It was reconstructed by replaying the prior session's recorded edits onto the committed procedure (`940d525f…`) and **verified byte-identical to the audited RC1 digest `6a94713c4b475f752c2bda214812a0d4dc2ce4d7be799a870bedfd4ae3d44fdf`** before any correction was applied (owner-confirmed reinstall). The old internal-review artifact was not restored; this file is new.

## Corrections applied (RC1 → RC1-C1)

| Finding | Correction |
|---|---|
| H1 C15(e) | `H_iso` captured right after the setup `present()`; clear #1 (throw-before-apply) ⇒ `failed`, isolation `== T_iso`, hidden `== H_iso`; clear #2 ⇒ `restored`, baseline-empty; clear #3 ⇒ `none`, baseline-empty, no bridge setter call. Exact `checks.C15.fields.e` evidence + validator recomputation; post-clear `inspectLedger()` diagnostic-only. Mutations P-a/P-b, M-h1..M-h6. |
| H2 HTTP | `request/response/requestfinished/requestfailed` listeners; every status ≥400 fatal by default; bootstrap/harness-endpoint always fatal; frozen empty `OPTIONAL_RESPONSE_RULES`; `responseFailures[]`; ambiguous/unbound ⇒ `unknown-fatal`; `console.error` policy unchanged. |
| M1 prefix provenance | `prefixSourceLedger[]` (per `(reqId, loadOperationId)`), pure `derivePrefixes`, `prefixDerivation` with hashes, closeout recomputation; failing candidate cannot prove its own prefix. |
| M2 classifier | `boundPrefix` in `ClassifierResult` with exact nullability; disjoint `loadOperation` / `mutationOperation` shapes; expected-cancellation binds to one mutation record; unknown keys rejected. |
| M3 NRDB | Exact `executionRecord` (two legal shapes), `dependencyBlockedBy`, normalized C1 reasons `prerequisite` / `timeout:load` (detail in `fields.blockDetail`), legality L1–L5, global C1 gate (`gates.C1`, outcomes `OPEN` / `CLOSED_DEPENDENCY_BLOCKED` / `CLOSED_OTHER`), X4/X20–X28. |
| Low1/Low2 | Header status text corrected; §12 D1/D2/D4/D7 labelled accepted. |

## Internal review (one focused Codex `spec` pass, medium; request `20261001-100401-35491-3359`)

Verdict: **requires major revision** → 0 Critical / 3 High / 3 Medium. Every finding was checked against the text/source and accepted; all were fixed in one remediation pass (no second Codex pass, per the review-boundary rule).

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | High | C15(e) `ledgerBefore:object` / undefined model key not JSON-serializable | **Fixed:** plain-JSON `LedgerDTO {markerMeshCount, isolationConfirmed}`; single `modelKey` (`===` identity → `'A'`/`'B'`), other ⇒ unreadable. |
| 2 | High | Optional-HTTP path temporally impossible (window open at event time) | **Fixed:** two-stage classifier (`immediate` vs `provisional`, finalized at window-close / gate / closeout); fatality committed at finalization; unresolved ⇒ `unknown-fatal`. Rule list stays empty, so every live response is `immediate`. |
| 3 | High | Global C1 gate lacked cross-field equations | **Fixed:** mandatory equations (verdict/reason/finalizedSeq/event match, `fatalCountAtGate`, recomputed `outcome`/`notStarted`, closed gate ⇒ no P2–P11 records); mismatch ⇒ row 5 FAIL; X28. |
| 4 | Med | Overlapping load windows: ledger attribution undefined | **Fixed:** one entry per `(reqId, loadOperationId)`, deterministic order/hash; overlap non-distinguishing ⇒ fatal-safe; test (17). |
| 5 | Med | `dependencyIds` not derivable from §5 | **Fixed:** normative N1–N8 table (execution prerequisites only). *Judgement calls to confirm at re-review:* N7→{C1,C16}; N8→{C1,C4} (not C20, which would be circular). |
| 6 | Med | `agree`/`requirement`/`modelBindingObserved`/`activeCheck` under-specified | **Fixed:** rules (i)–(v). |

No Critical/High finding remains known at this abstraction level. Remaining concerns are classified **implementation-plan requirements** (the harness follow-up below) or **verification gates** (offline tests); none is a design blocker.

## Risks / judgement calls recorded

- **Fatal-by-default HTTP ≥400** can cause false live FAILs if the Viewer routinely requests a resource that legitimately returns 4xx. This is the independent review's intended trade-off; relief requires a future reviewed `OPTIONAL_RESPONSE_RULES` entry.
- Unreadable hidden read after a clear ⇒ FAIL (fail-closed); unreadable `H_iso` at setup ⇒ `BLOCKED(precondition:c15e)`.
- Under `CLOSED_OTHER` unrun controls keep their already-allowed states; under `CLOSED_DEPENDENCY_BLOCKED` C2–C20 record `BLOCKED(dependency:C1)`.
- `timeout:load` takes precedence over `prerequisite` when both hold.

## Exact harness follow-up (not performed; requires separate authorization; `LIVE_PATH_WIRED` stays false)

1. **C15(e):** replace the old ledger predicate with the three-clear driver + pure `c15eOracle` (F1–F4, S1–S3, Q1–Q5, D1–D3); add mutation tests P-a/P-b and M-h1..M-h6.
2. **`H_iso`:** `H0`/`H_iso` capture after setup `present()`; `canonicalHidden` + `hiddenEquals`; exact `checks.C15.fields.e` schema (plain JSON, `LedgerDTO`, `modelKey`); ordering invariants; validator recomputation.
3. **NRDB state/schema:** `executionRecord` (both shapes) + `dependencyBlockedBy` on every control record; start-boundary recording; legality L1–L5; unknown keys rejected; the N1–N8 `dependencyIds` table.
4. **Normalized C1 reasons:** committed `evaluateC1` emits e.g. `prerequisite:model-not-loaded:B`; normalize to `prerequisite` | `timeout:load`, move detail to `fields.blockDetail`, add `finalizedSeq`/`finalizedAt` and one `check-finalized` event.
5. **Global C1 gate:** write `gates.C1` (after C1 final, before P2 marker) with the mandatory equations; gate P2–P11 incl. P2 spies and N1; not-started records; gate truth-table tests.
6. **X4 / X20–X23 updates and new X24–X28** in the `computeOverall` matrix (control-state dimension L1–L4).
7. **Listener instrumentation:** `request`/`response`/`requestfinished`/`requestfailed` (replacing the committed blanket `requestfailed` ⇒ fatal, harness ~line 8302).
8. **HTTP ≥400 handling:** `classifyHttpResponse`, R-1..R-5, two-stage provisional/immediate finalization, frozen empty `OPTIONAL_RESPONSE_RULES`, `responseFailures[]`, row-1 wiring.
9. **Operation ledgers:** disjoint `loadOperation` / `mutationOperation` with exact couplings.
10. **Prefix-source evidence:** `prefixSourceLedger[]`, `derivePrefixes`, `prefixDerivation` + hashes, closeout recomputation.
11. **Ambiguous-prefix accounting:** `ambiguousPrefixes[]`, `bindingAvailable` / `nonDistinguishingReason`, overlap handling, `unknown-fatal` fallback.
12. **`boundPrefix`:** exact `ClassifierResult` nullability for both classifiers; event-time vs closeout deep-equality.
13. **Schema + offline classifier tests:** §9.2 tests (1)–(17), §7 schema/gate tests, redaction, static no-allow-list test.
14. **Procedure SHA rebinding** after the procedure is accepted and committed (current digest is not final).

**Before live execution only (disposition unchanged):** M1/M2 static-guard hardening over the pre-link dependency graph and full live closeout consumers; commit final procedure/harness/tests/reviews; clean tree; recompute digests; issue a new single-use authorization record.

## Verification

- Procedure SHA-256: `a1dbbd8f57bc1d2bd0c871fd098c62239d9d54799458de4621b45164556b8722` (RC1 baseline `6a94713c…`; committed v5 `940d525f…`).
- `git diff --check`: clean. `node --test test/acceptance/clashpanel-viewerbridge.acceptance.tablet.test.mjs`: **7/7 pass** (Table T rev-2, deadline classes, phase order unchanged; does not exercise the new C15/NRDB/network semantics).
- `git diff --name-only HEAD -- test clashpanel`: **0 files** — dormant harness and production unchanged. `LIVE_PATH_WIRED = false` (harness line 100).
- No live G2, Playwright/Viewer execution, real-Viewer injection, commit, push, or authorization record.

## Status

Ready for **independent Work re-review** (targeted to the five RC1 findings and the six internal-review fixes). Not ready to commit; harness follow-up, live planning, and live G2 remain unauthorized.
