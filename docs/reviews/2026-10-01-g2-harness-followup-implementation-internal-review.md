# Internal Review — G2 harness follow-up implementation (RC1-C1/RC1-C2 items 1–24)

**Date:** 2026-10-01
**Type:** one focused internal review, read-only for code (no code, handoff or procedure edited; no browser/Viewer launched).
**Reviewer:** Claude (internal), with one `codex-advisor` (medium) consultation on four tentative findings (request `20261001-153233-70735-25884`): it confirmed H1 (as Medium) and M1, rated L2 nonconforming-but-bounded, and found no other verdict-improving path; its points were checked against source before use.

## Baseline

| Item | Value |
|---|---|
| Branch / HEAD | `main` @ `c6d89af1991f3849a97ef8a807ea4480de43704b` |
| Work under review | uncommitted: `git diff` (10 files, +4265/−427, all under `test/acceptance/`) + untracked `clashpanel-viewerbridge.acceptance.{c15e,gate,network,nrdb,prefix}.test.mjs` |
| `git diff --name-only` | only `test/acceptance/clashpanel-viewerbridge.acceptance*.mjs` — **no production / Core / Adapter / M4 / Panel / server / docs file changed** |
| Procedure | `docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md`, SHA-256 `5f9c4c7e124751d09406f07eab63f844fec53add006bd12ad676ecaca3732abb` (recomputed; equals `ACCEPTED_PROCEDURE_SHA256`, harness line 76) |
| Follow-up list | RC1-C1 internal review items 1–14, RC1-C2 internal review items 15–24 (with the item 3/5/6/13 amendments), effective-state final re-review (accessor also for `terminalState` and `dependencyBlockedBy`) |
| Offline verification run by this review | `node --test test/acceptance/clashpanel-viewerbridge.acceptance.*.test.mjs` → **491/491 pass, 0 fail**; `git diff --check` clean. (These tests use fakes only; none imports playwright.) |

## Safety invariants

| Invariant | Result | Evidence |
|---|---|---|
| `LIVE_PATH_WIRED` stays `false` and is unreachable | **holds** | `const LIVE_PATH_WIRED = false` (harness :115); `main()` refuses right after W0 (`if (!LIVE_PATH_WIRED)` :12228); `runChecksInPhaseOrder` refuses `mode:'live'` (:9048); injection controller refuses a real target (:8899); static/CLI/activation tests assert it (activation.test :138, cli.test :88, network.test :104, prefix.test :96, gate.test :197, nrdb.test :299). No diff line touches the constant. |
| No production / Core / Adapter / M4 / Panel change | **holds** | `git diff --name-only` / `git status --porcelain -- clashpanel server.js docs` empty outside `test/acceptance`. |
| No allow-list introduced | **holds** | `OPTIONAL_RESPONSE_RULES = Object.freeze([])` declared once (:2039; network.test :104–107); static no-literal test (network.test :113); console.error still fatal with no list (:11584); blanket `requestfailed ⇒ fatal` replaced only by the classifier path (network.test :130). No `allow`/`tolerated` list found by grep. |
| Procedure SHA binding | **holds** | `ACCEPTED_PROCEDURE_SHA256` (:76) enforced in W1 (:438 `procedure-sha256-not-accepted`); c15e.test :31 hashes the on-disk procedure. |
| No live run / authorization record | **holds** | none created; no results/attempts directory touched by this review. |

## 24-item conformance

Legend: **I** implemented, **P** partial, **M** missing. Line numbers are harness lines unless a test file is named.

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | C15(e) three-clear driver + pure `c15eOracle` (F1–F4, S1–S3, Q1–Q5, D1–D3); P-a/P-b, M-h1..M-h6 | **I** | driver `runC15eScenario` :9303–9433; `c15eDerive` :8631; `c15eOracle` :8688; `evaluateC15` recomputes (:8725); tests c15e.test :190–297 (P-a/P-b, P-a guard, M-h1..M-h6), :366 RC1 regression guard. |
| 2 | `H0`/`H_iso` after setup `present()`; `canonicalHidden`/`hiddenEquals`; exact `fields.e` schema (LedgerDTO, modelKey); ordering; validator recomputation | **I** (one Low deviation, L4) | `H_iso` read once after `T_iso`, spy-proven no mutation (:9355–9365); canonical form :8540–8607; `c15eLedgerDTO` :8612; `validateC15eEvidence` :4028 wired into `validateResultSchema` (:3964). See L4 (T_iso compared to ledger target, not spy argument) and L3 (validator not in the §8 row path). |
| 3 | NRDB state/schema: `executionRecord` (2 shapes), `dependencyBlockedBy`, start boundary, L1–L4, unknown keys, N1–N8 dependency table | **I** | `executionRecordProblems` :1557; `dependencyBlockedByShapeProblems`/`…ReferentialProblems` :1589/:1609; `nrdbLegality` (exactly L1–L4) :3615; `CONTROL_DEPENDENCY_IDS` :1429; start boundary `beginControl` :9121 + fail-closed downgrade in `makeControlRunRecord` :7091. |
| 4 | Normalized C1 reasons (`prerequisite`/`timeout:load`), `fields.blockDetail`, `finalizedSeq/At`, one `check-finalized` | **P** | `evaluateC1` :8320; `finalizeC1Record` :7051; `checkRunProblems` coupling :1541–1547. **Gap: H1** — a P1 harness exception / node-side outer load timeout can be normalized to `prerequisite`. |
| 5 | Global C1 gate (after C1 final, before P2), equations, P2–P11 incl. P2 spies and N1 gated, not-started records, truth-table tests, atomic preparation | **I** | `prepareC1Gate` :1993 (synchronous, order finalize→rebuild→count→`gateSeq`); runner :9178–9208 (closed ⇒ no `runPhase`, no marker); `gateC1Problems` :3496 recomputes every field; gate.test :96–206, :437–507. |
| 6 | X4 / X20–X23 updated; X24–X29 | **I** | nrdb.test :440 (X4), :455 (X20), :464 (X21), :478 (X22), :490 (X23/X27), :525 (X24), :534 (X25), :547 (X26), :558 (X28), :581 (X29), §8 matrix :603. |
| 7 | `request`/`response`/`requestfinished`/`requestfailed` listeners replacing blanket `requestfailed ⇒ fatal` | **I** | `createNetworkInstrumentation` :11444; `wireFatalListeners` :11576–11590; network.test :130, :155. (Low L1: `onRequestFinished` swallows its own exception silently.) |
| 8 | HTTP ≥400: `classifyHttpResponse`, R-1..R-5, two-stage, frozen empty rules, `responseFailures[]`, row-1 wiring | **I** | `classifyHttpResponse` :2257; `isHttpRuleCandidate` :2238; immediate/provisional split :11529–11537; network.test :361, :380, :435, :468. Fatal by default incl. unreadable status (:11522). |
| 9 | Disjoint `loadOperation`/`mutationOperation` with couplings | **I** | keys :2484–2485; `opLedgerRecordProblems` :2732; `createOperationLedger` :2790; `runAcknowledgedMutation` :6603 (ack before invoke); teardown records :11805; prefix.test :149–313. |
| 10 | `prefixSourceLedger[]`, `derivePrefixes`, `prefixDerivation` + hashes, closeout recomputation | **I** | `derivePrefixes` :2555; `buildPrefixSourceLedger` :2603; freeze at later window close `finalizeLoadWindows` :2881 / :12088; recomputation `c2LedgerProblems` :3089 (`prefix-derivation-mismatch`); prefix.test :355–487. |
| 11 | `ambiguousPrefixes[]`, `bindingAvailable`/`nonDistinguishingReason`, overlap, `unknown-fatal` fallback | **I** | `prefixBindingState` :2509; `ambiguousPrefixesOf` :2588; `prefixBindingOf` :2096; prefix.test :398, :489, :521. |
| 12 | `boundPrefix` nullability for both classifiers; event-time vs closeout deep equality | **I** | `fatalClassifierResult` :2107; EC/R-3 results :2191–2201, :2290–2294; `classifierResultProblems` :3024; provenance check :3285–3294; `agree` + reclassification :3295–3300; prefix.test :540. |
| 13 | Schema + offline classifier tests §9.2 (1)–(25), §7 schema/gate, redaction, static no-allow-list | **I** | network.test (1)–(4), (6), (8), (10), (11), (14), (16)–(24); prefix.test (12)–(13), (15)–(16); gate.test (25). |
| 14 | Procedure SHA rebinding | **I** | :76, :438; c15e.test :31. |
| 15 | Synthetic gate-disposition records/schema; `recordType` on every entry; old `BLOCKED(dependency:C1)` removed; verdicts only from `check-run`; row-6 CDB clause | **I** | `makeGateDispositionRecord` :3454; `gateDispositionProblems` (G-a..G-f) :1842; `checkVerdictBase` :1283; legacy-encoding rejection :3582; row-6 clause :3717; nrdb.test :320–395. |
| 16 | NRDB only inside gate-disposition; L4 `terminalSeq = dispositionSeq`; `dependencyBlockedBy` on C2–C20 under CDB | **I** | :1576, :1546, :3645, :1875–1877. |
| 17 | `N8=[C1,C4,C7,C8]`, `N7=[C1,C16]`, dependency-table test | **I** | :1436–1437; nrdb.test :119 (exact, ascending, acyclic). |
| 18 | One-to-one witness correlation; `fatalCount` only at witness creation; `fatalCountAtGate` by `witnessSeq`; closeout ⇒ `fatal-witness-mismatch` | **I** | `correlateNetworkEvents` :2402; `syncFatalWitnesses` :2925 (only increment via `appendEntry`); `recomputeFatalCountAtGate` :1913; `networkLedgerProblems` :3323–3357; network.test (18)–(24). |
| 19 | Matrix/schema/static tests incl. record-type dimension, row 8 unreachable with dispositions | **I** | nrdb.test :603 (matrix), :581 (row 8 unreachable), :699 (static raw-`.state`). |
| 20 | `requestObservations[]`, `reqId:='q:'+startSeq` via Request-object map, recomputed identity, test (23) | **I** | :11498–11513 (WeakMap); `recomputeRequestIdentity` :2366; :3223–3238; network.test :170–257. |
| 21 | Attribution fields `seq/phase/activeCheck/activeControl`; `wrapper-install/-restore`; CG-1..CG-7 + exhaustive legal list; CG-7 nulls | **I** | `attributionFieldProblems` :1674; `closedGateEvidenceMatches` :1698; `closedGateIllegalRecords` :1773; wrapper events :6175–6224; gate.test :209–435. |
| 22 | NRDB legality refactor L1–L4 pure; rows 1–3 precedence only | **I** | `nrdbLegality` :3615; nrdb.test :423 (purity). |
| 23 | Discriminated-union schema; effective-state accessor in rows 4/7/8 **and** `terminalState` / `dependencyBlockedBy` validation | **I** | `controlEffectiveState` :1483; used by `controlDisposition` :1297, `controlRunProblems` :3542–3546, G-d :1880, `nrdbLegality` :3632, `verdictMapOf` :9009; static test nrdb.test :699. Remaining raw `.state` reads (:7080, :7959–7986, :9634) are on executed control *outcomes* that can never be gate-dispositions. |
| 24 | Atomic gate preparation; reject `finalizedBy:'gate'` with `finalizedSeq > gateSeq`; test (25) | **I** | :1993–2019; `gateFinalizationProblems` :1948; gate.test :437, :462, :479. |

Summary: 23 implemented, 1 partial (item 4, finding H1), 0 missing.

## Findings

### Critical
None.

### High

**H1 — A P1 harness exception (or node-side load-deadline expiry) can be normalized to `prerequisite`, making NRDB legal and turning a required `FAIL` into `BLOCKED`.**
*Evidence.* `evaluateC1` (:8320–8338) classifies every not-loaded model whose page-side `loadStatus` is not `timed-out`/`failed`/`rejected` as `cause:'model-not-loaded'` ⇒ `reason:'prerequisite'`. `loadStatus` is derived page-side only (`g2CollectModelFacts` :10464–10466) from `g.loads[doc:X]`, `g.loads[node:X]` and readiness. In `runPostReservation` (:12075–12090) a load that **threw** node-side (RPC rejection, harness bug) yields `loadCompletionOutcome = 'harness-exception'` (:11791) and a node-side outer `withDeadline` expiry yields `'timeout:load'` (:11792) — but these outcomes are recorded only in the `opLedger`; neither is fed into C1, and no validator cross-checks `opLedger[load].completionOutcome` against `checks.C1.reason` / `fields.blockDetail`. Consequently: (a) a harness exception before the page recorded its load ⇒ `loadStatus:null` ⇒ `BLOCKED(prerequisite)` ⇒ `CLOSED_DEPENDENCY_BLOCKED` ⇒ legal NRDB ⇒ row 6 `BLOCKED`; (b) an outer T2 expiry while the page record is still `active` ⇒ `prerequisite` instead of the precedence-winning `timeout:load`.
*Why High.* (Codex independently confirmed the path and found no compensating check; it rated it Medium because it needs a transient RPC failure followed by recovering RPCs and yields BLOCKED, not PASS. This review keeps High because it is the only path found by which the implementation yields a better verdict category than the procedure allows, and item 4 is incomplete without it.) The procedure (§7 L1, C1 reason contract, line 421/423) makes this distinction normative: "a P1 harness exception, a driver error … carries its own reason (e.g. `harness-exception`) and makes L1 false", and lists "the absence of any journal/harness exception for P1" as the evidence that distinguishes dependency loss from a harness defect. (a) is a fail-open relative to the verdict contract (FAIL ⇒ BLOCKED; not a false PASS). (b) is a reason-precedence error only (same verdict).
*Recommended fix (harness only).* Feed the node-side load outcomes into C1 (or add a closeout equation): if any P1 `loadOperation.completionOutcome === 'harness-exception'` (or the load wrapper threw), C1 must be `BLOCKED('harness-exception')` (non-normalized ⇒ `CLOSED_OTHER`); if any is `'timeout:load'`, C1's reason must be `'timeout:load'`; a mismatch between `opLedger` load outcomes and C1's normalized reason / `blockDetail` ⇒ row 5. Add an X-row test for both cases.

### Medium

**M1 — Node network attribution is frozen at `{phase:'P1', activeCheck:null}` for the whole in-page P2–P11 run (before-live blocker, fail-closed).**
*Evidence.* :12104–12107. `classifyRequestFailure` C-e (:2177) requires `event.phase ∈ {P9, cleanup}` for EC-hide/EC-unload, so every C16 `hideModel` / C17 unload abort in a live run is classified `fatal-required-resource` (row 1) — a certain false FAIL whenever those operations abort requests. It also records P2–P11 network events with false `phase:'P1'` evidence; under a closed gate those mislabelled events are exactly the "legal passive P1" class, so CG-5 relies entirely on the other CG predicates. Verdict effect is fail-closed (never a false PASS). The comment at :12104 ties it to the dual-counter gate, but `G2_DUAL_COUNTER_GATE.finding` (:3439) names only seq numbering.
*Recommended fix.* Before live: carry page phase/check attribution to Node (same design that resolves the single counter), and widen `G2_DUAL_COUNTER_GATE` (or add a sibling gate constant) to name the attribution defect explicitly.

**M2 — The before-live dual-counter gate is advisory only; nothing couples it to `LIVE_PATH_WIRED`, and the end-to-end offline tests hide the collision.**
*Evidence.* `G2_DUAL_COUNTER_GATE = {resolved:false, …}` (:3439) is checked only by prefix.test :100 (stays unresolved). `g2BuildEnv` seeds the page recorder at exactly `seqBase` (:10892) while Node keeps allocating from the same base during the run (network, opLedger acks, :11893–11900), so a live run with any in-run network activity will produce `seq-not-unique` (row 5) — fail-closed, but every live attempt would FAIL. The mainflow fake page avoids this by numbering from `seqBase + NODE_EVENT_GAP (1000)` (mainflow.test :101, :530), a gap the real `g2BuildEnv` does not have, so no offline test exercises the real collision.
*Recommended fix.* Add a static/runtime assertion that `LIVE_PATH_WIRED` cannot be `true` while `G2_DUAL_COUNTER_GATE.resolved === false` (and the M1 attribution gate), and one offline test that drives the real `g2BuildEnv` numbering (no gap) against concurrent node allocations and asserts row 5 `seq-not-unique` — proving the fail-closed claim instead of masking it.

### Low

**L1 — `onRequestFinished` swallows its own exception silently** (:11542–11547; comment says "as above" but there is no `failClosed`). Effect: a lost terminal makes the request `excluded:not-finished-in-window` ⇒ nothing can bind ⇒ fail-safe (false FAIL only). Fix: call `failClosed('requestfinished')` for symmetry with the other three handlers.

**L2 — Teardown C-e interpretation.** "every check C1–C20 has a recorded final verdict" is implemented as "a `cleanup` marker precedes `O.startSeq`" (:2176). The runner writes `cleanup` as its last act after every record is final (:9209), and a failed/timed-out page run returns no markers (so EC-teardown is then impossible ⇒ fatal); missing records are row 5 independently (:3586). Under a closed gate C2–C20 are gate-dispositions (no `verdict`); the literal text would forbid EC-teardown there, the implementation allows it. Judgement (Codex concurs: nonconforming but bounded, Low): strictly it is *more permissive* than the literal text, not fail-safe, but the practical risk is bounded (the cleanup marker is causally after all records; EC-teardown still needs C-a, C-b, C-c, C-d) and not a correctness defect; resolve the wording mismatch either way (procedure: "final terminal record, gate-dispositions included"; or implementation: validate the terminal-record condition directly instead of only the marker) and have the independent gate confirm.

**L3 — `validateC15eEvidence` runs only in `validateResultSchema` (R1 verify), not in the §8 row path.** A C15(e) evidence contradiction therefore does not change `primaryOverall`; it fails `r1-verify` ⇒ closeout failure ⇒ final `FAIL` (R1 renamed `.invalid-*`, F witness written, :4736–4742, :4502–4517). Fail-closed; the procedure's "schema validator FAIL (row 5)" is met only at the final-verdict level. Optional fix: include the C15(e) recomputation in `recordSchemaProblems` so row 5 is selected directly.

**L4 — `T_iso` is compared with the ledger's applied target, not the spy-recorded `setAggregateIsolation` argument** (:9359, :9362) — the procedure (line 298) says "equals the argument of the bridge-origin `setAggregateIsolation` call that applied it". Mismatch only yields `BLOCKED(precondition:c15e)`; fail-closed. Fix: compare against the spy ledger argument digest (or both).

**L5 — Gate-time finalization in the live wiring is effectively dead code.** The in-page gate finalizes against a page-side mirror ledger that has no `responseFailures` (:10968); Node-side provisional entries are instead finalized at `load-windows-closed` (:12088, always reached because `endLoad` always runs) or at closeout. With the frozen empty rule set no provisional entry can exist live. Fail-safe (an unfinalized provisional would become fatal at closeout and mismatch `fatalCountAtGate` ⇒ rows 1/5). Record as part of the dual-counter/cross-process gate rather than a separate defect.

## Disposition of the implementer-recorded open items

| Open item | Fail-safe? | Classification |
|---|---|---|
| Node/page dual seq counter (`G2_DUAL_COUNTER_GATE`) | Yes — collisions ⇒ `seq-not-unique` (row 5); C-d/C-e drift ⇒ `request-classification-mismatch` (row 5). Never a false PASS, but makes every live run FAIL. | **Before-live blocker** (not Critical/High at this dormant stage). Must be extended with M1 and mechanically coupled to `LIVE_PATH_WIRED` (M2). |
| Gate-time finalization of pending responses falls through to closeout | Yes — see L5; unreachable live with empty rules; any fallthrough is counted fatal at closeout and contradicts `fatalCountAtGate`. | Before-live item (L5). |
| Teardown C-e interpretation (cleanup marker vs final check records) | Yes in practice — see L2. | Spec-ambiguity resolution for the independent gate to confirm; not a defect. |
| In-page gate counts a page-side fatal mirror | Verdict-safe — a Node fatal before the RPC has `seq < seqBase < gateSeq`; a late mirror makes the stored gate disagree with `recomputeFatalCountAtGate` (row 5) and row 1 matches regardless (`fatalCount > 0`). No path to a better verdict found. **Operationally not safe:** a lagging mirror can let the runtime gate open and execute downstream Viewer actions after a pre-gate fatal (closeout still reports FAIL). | Part of the dual-counter before-live gate; the cross-process design must make the gate read the authoritative Node ledger. |
| Other documented resolutions (fail-closed `makeControlRunRecord` downgrade when a start boundary is missing; `failClosedControlRun` NOT_DETECTED; invalid-`reqId` duplicates counted twice; unreadable status ⇒ fatal) | Yes — each can only worsen a verdict. | Accepted. |

## Checks with no finding

- **NRDB / gate-disposition masking:** a disposition under an OPEN gate, a run record under a closed gate, any started `executionRecord`, any CG-1..CG-7 match, or any record outside the exhaustive legal list ⇒ row 5 (:3577, :3602–3605, :1863–1866) and, for NRDB, L2 false ⇒ row 4. Taint and fatal precedence are untouched (rows 1/6 evaluated independently, :3664–3718). Apart from H1 (which corrupts the *input* to L1), no masking path found.
- **Raw `.state` reads:** none on a gate-disposition-capable path (accessor :1483; static test nrdb.test :699).
- **Witness counting:** one witness per `req:` identity, one per raw event for invalid identities (`invalid:<rawEventSeq>`, :2374); `fatalCount` increments only through `appendEntry` at witness creation (:2931, :2957–2963); bijection and `witnessCount` recomputed (:3326–3357). Missing `reqId` ⇒ unknown-fatal, never suppressed.
- **Expected cancellation:** requires C-a ∧ C-b ∧ in-flight mutation (C-c) ∧ C-c′ (unique prefix binding for hide/unload) ∧ C-d ∧ C-e, latest satisfying op, and the closeout check that the named op is a `mutation` whose stored `cancellationWindow` contains `failSeq` (:2181–2201, :3314–3318). Not bound by temporal overlap alone; teardown has no binding by procedure design.
- **Vacuous tests / fixture bypass:** the gate, C1-finalization and disposition paths are exercised through the real `runChecksInPhaseOrder` (gate.test :96–206, nrdb.test :737) and the network path through the real listener wiring (network.test :361); the truth table uses an independent oracle (network.test :244–281). X-row tests use hand-built states (nrdb.test `closeGate` :84), acceptable because the same shapes are also produced by the real runner; the one realism gap is M2.

## Verdict

**Requires targeted remediation before acceptance: 0 Critical / 1 High / 2 Medium / 5 Low.**

The implementation conforms to 23 of 24 follow-up items, and to item 4 except for H1. All safety invariants hold: `LIVE_PATH_WIRED=false` and unreachable, no production change, no allow-list, SHA bound to `5f9c4c7e…`. Remediate H1 (harness only, inside the authorized item-4 scope) and add the M2 coupling/test; M1 and L1–L5 may be recorded as before-live items or fixed in the same pass. After remediation, a targeted re-review of the C1 reason/`opLedger` coupling and the gate coupling test is enough; no full re-review is needed. Live execution, `LIVE_PATH_WIRED=true` and any authorization record stay unauthorized; the dual-counter/attribution gate (M1/M2) blocks live in any case.

## Remediation (same task, after the review above)

- **H1 — fixed (harness only).** Node-side load outcomes now feed C1 (`withNodeLoadOutcomes`): a `harness-exception` load gives `BLOCKED('harness-exception')` (not a normalized reason, so L1 is false, gate `CLOSED_OTHER`, row 4 FAIL); a Node-side load timeout counts as `timeout:load`. Backstop `c1LoadLedgerProblems` in `recordSchemaProblems` fails row 5 on any C1-reason/load-ledger mismatch. Choice beyond the procedure text (which orders only `timeout:load` over `prerequisite`): `harness-exception` also beats `timeout:load`, so a harness exception can never make NRDB legal. Tests fail with the fix disabled (3 failures).
- **M2 — fixed.** `main()` and live-mode `runChecksInPhaseOrder` refuse with `dual-counter-gate-unresolved` while `G2_DUAL_COUNTER_GATE.resolved !== true`; test with the real `seqBase+1` numbering shows row 5 `seq-not-unique`.
- **M1 — comment only.** Documented in `G2_DUAL_COUNTER_GATE`; the cross-process counter redesign remains **before-live-execution** work.
- **L1–L5 — not fixed; recorded as before-live / independent-gate items** (L2 teardown C-e wording and L4 `T_iso` source are for the independent gate to confirm).
- **Final verification:** focused `502/502`; aggregate `4748 total / 4747 pass / 0 fail / 1 todo`; `git diff --check` clean; procedure SHA `5f9c4c7e…` unchanged; `LIVE_PATH_WIRED=false`; no non-`test/acceptance` file changed.
- **Revised status:** 0 Critical / 0 High (H1 fixed) / 1 Medium open before live (M1) / 5 Low. Ready for independent ChatGPT Work review; not ready for live.
