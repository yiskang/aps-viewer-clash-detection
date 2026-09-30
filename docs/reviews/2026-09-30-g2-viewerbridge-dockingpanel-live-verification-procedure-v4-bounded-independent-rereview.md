# Bounded independent re-review — G2 ViewerBridge / DockingPanel procedure v4

- **Date:** 2026-09-30
- **Repository state:** `main` @ `f139dda375d6aa466698207def745e94e2cc5abd`; `origin/main` equal; documentation-only uncommitted working tree; no G2 harness and no live G2 execution.
- **Scope:** the v4 H1/H2/N6/Table-T/C20 remediation and directly affected authorization, closeout, evidence, control and owner-decision cross-references only.
- **Sources:** v4 procedure; v4 remediation internal review; prior independent G2 reviews; current handoff; accepted Viewer Clash Panel design and implementation plan; actual `ViewerBridge`, marker and DockingPanel implementation where relevant.

## Verdict

**Not ready for owner acceptance or G2 harness-implementation authorization.** The local-POSIX reservation protocol, N6 construction, total reader, C20 positive-evidence gate and prior Viewer ownership/scope closures are technically sound. One High closeout contradiction remains: after an ambiguous K write, the authoritative durable reader can report PASS while the harness reports FAIL, and the proposed compensating rule depends on non-authoritative, optional operator output. One Medium Table-T inconsistency and three Low wording/schema issues should be corrected in the same bounded documentation pass.

**Findings:** 0 Critical / 1 High / 1 Medium / 3 Low.

No production, Core, Viewer Adapter, M4, Panel, server, OQ-1 or host dependency appeared. Every required correction remains confined to this procedure and its future test-only harness contract.

## High finding — blocking

### High-1 — the D2 K-ambiguity residual still permits authoritative PASS after harness FAIL

- **Procedure:** §8 authoritative-reader rule and W-1…W-6; §9.1 steps 8–11; declared residual.
- **Failure mode:** K may have landed durably while its writer/read-back result is ambiguous. The harness then declares closeout failure and attempts F plus a `FAILED` journal replacement. Under a persistent or correlated storage fault, both later writes can fail. The surviving, fully valid R1→R2→R3→`COMPLETED`→K chain makes `deriveVerdictFromArtifacts` return `COMPLETED.finalOverall`, including PASS, while step 11 prints FAIL and exits 1. The proposed reviewer rule cannot close that contradiction: §8 explicitly makes stdout/exit status non-authoritative, O1 is optional, and nothing guarantees the operator retained either signal. This is not made safe by low probability; the procedure itself classifies the storage faults as correlated and not negligible.
- **Classification:** design/procedure correctness blocker plus unresolved owner acceptance semantics under D2.
- **Minimum correction:** choose one authoritative rule and make the writer follow it. The minimum-file-scope option is: on K ambiguity, the durable reader remains authoritative; if a later read validates the complete J+K chain, treat closeout as the committed verdict rather than simultaneously calling it harness FAIL. If the chain is absent, malformed or unverifiable, the existing W-1/W-2/W-5 fail-closed paths apply. If the owner instead requires every ambiguous writer return to remain FAIL forever, the procedure needs a mandatory durable witness that cannot be lost in this branch; optional stdout/O1 is not sufficient. Add the K-landed/F-failed/FAILED-failed case to the offline closeout matrix with the selected rule.

**Disposition:** D2 cannot be accepted as written. H2's acyclic hash graph and total reader are closed, but H2 as a whole is not fully closed until this single contradiction is resolved.

## Medium finding

### M1 — the N6 allowance-source row contradicts the remediated T24 domain

- **Procedure:** §4.7 Table T row T24 and the allowance-source consistency table's N6 row.
- **Contradiction:** T24 and §7 correctly define the N6 construction domain as `|v| ≤ 2^897`, with C4 retaining the wider `2^900` cutoff. The N6 consistency row still says its domain bound is `2^900`, says it is “not a separate table row”, and cites only T21/T15. That is now false: N6 has a distinct `2^897` bound in T24.
- **Failure mode:** a harness-plan author following the mechanical consistency table can generate the wrong boundary suite and reintroduce the exact domain-escape defect v4 was meant to close.
- **Minimum correction:** change the N6 row to `|v| ≤ 2^897`, cite T24, and distinguish it from C4's `2^900` range cutoff.
- **Classification:** documentation/verification-contract inconsistency. It does not invalidate the sound proof in §7, but it must be corrected before harness implementation planning.

## Low findings

1. **R1 future-fact fields remain underspecified.** §9.1 says R1/R2 contain no later facts, but §10 still lists `attempt.journalStates[]` and `finishedAt` without stating their payload cutoff. Define `journalStates[]` to end at `CLOSEOUT_STARTED` and `finishedAt` as the pre-closeout payload cutoff. Also describe `COMPLETED.finalOverall` as provisional until K verifies. This is an implementation-plan requirement, not a current false-PASS path.
2. **The reservation boundary has two definitions.** The state table says `AUTH_BOUND` begins when the reservation is durable and the journal follows, while W2 says the reservation boundary is the completed durable `AUTH_BOUND` journal write. The actual order and crash behavior are safe; rename the two milestones unambiguously so tests know which instant they assert.
3. **Stale/table naming remains.** Rule (a) still says C20 has no FAIL outcome “in v3”, and “Table T, version T2” is repeatedly shortened to `T2`, colliding with row T2. Update the version reference and use an unambiguous table-version label. Fixed R1–R3 filenames remain a fail-safe, non-blocking implementation-plan concern because an overwrite causes hash failure rather than false PASS.

## H1 — attempts-directory and reservation durability

**Closed technically.** W2a handles `results/` and the attempts directory in order: create if absent, fsync the directory, then unconditionally fsync its parent. W2b begins only after that chain completes, uses exclusive `wx`, fsyncs the reservation and attempts directory, and durably installs the `AUTH_BOUND` journal before any browser, token, Viewer, network or Phase-0 effect. The startup scan plus the exclusive create rejects an existing reservation, journal, orphan temp or unreadable artifact; a reservation-only survivor mechanically maps to `CRASHED(reservation-only)` and spends the record. `ATTEMPT_CONSUMED` is durable before the first `loadDocumentNode`.

The claim is correctly limited to process crash and normal buffered OS crash on a local POSIX filesystem. It expressly excludes power-loss durability, network/FUSE filesystems and filesystems that falsely acknowledge fsync. The Low reservation-boundary terminology issue does not reopen this technical closure.

## H2 — closeout graph and reader

### Acyclic dependency graph

**Closed, subject to the Low payload-cutoff wording.** R1 and R2 derive from the pre-closeout in-memory state; R3 hashes already-written/verified R1 and R2; `COMPLETED` hashes R1–R3; K hashes the verified journal. No artifact contains its own digest, and every digest is independently recomputable from earlier bytes. W-5 cross-checks the exact legal transition history, the artifact hashes and the attempt identifiers.

### Durable FAIL witness and reader totality

**Closed except for High-1.** `CLOSEOUT_STARTED` is a durable non-PASS witness. W-0 rejects unknown states, malformed required fields, illegal transition order and unmapped inputs; W-1 through W-6 cover every legal last state and make malformed/contradictory combinations FAIL. `COMPLETED` without a valid matching K is FAIL. F and `FAILED` dominate a K when either lands. The remaining K-ambiguity branch is the only unresolved contradiction.

## N6 domain and boundary behavior

**Closed technically.** The mutation builder checks all twelve input coordinates before arithmetic and returns disjoint statuses for non-finite/inverted, C4-out-of-range and N6-out-of-domain inputs. Only `|v| ≤ 2^897` reaches mutation. The translated interval preserves width, including zero-width and thin boxes; the stated bound keeps the translated coordinates below `2^900`. The recomputed deficit is required to exceed the recomputed tolerance, and only the exact `FAIL(not-contained)` result counts as detection. Just-in/just-out values, `±Infinity`, `NaN`, C4-cutoff values and degenerate extremes all have explicit outcomes; rejected inputs cannot produce N6 PASS evidence. The retained inputs and derived terms are sufficient to recompute the mutation.

Independent numeric checks of the stated extremal sign patterns kept the translated maximum below `0.376 × 2^900` and retained a positive `dMax'−T'` margin. The inconsistency is only the stale consistency-table row described in M1.

## Table T / C4 / C20 and H3

- Rule (a) is correctly scoped to C20/N8; C4's CA-driven containment failure is an explicit E1 exception, its sample selection is E3, and T24 is contract/mathematics-derived.
- C20 and N8 remain independent of C4's containment tolerance. C20 can PASS only with positive, localized, stable rendering evidence; missing, unstable or ambiguous rendering is `NOT_EVIDENCED`/`BLOCKED`, never PASS.
- G2 overall cannot PASS while C20 is `NOT_EVIDENCED`; the row-7 `PARTIAL` fallback is consistent. N8 remains a non-vacuous null-change and displaced-footprint discriminator.
- The D7 constants—2 px dilation, 2 px sphere-evaluability floor, capture counts and wait/capture budget—are explicit CA values. They grant PASS/evaluability or bound observation; they do not create a C20 FAIL. They are technically ready to be presented for owner acceptance within the procedure's narrow runtime/model envelope.

H3 therefore remains technically closed. D7 is still an explicit owner calibration/acceptance-scope decision, not an unresolved technical contradiction.

## Owner decisions

| ID | Status after this review | Required disposition |
|---|---|---|
| D1 | **Owner decision remains** | Accept Mechanical + Structure as the bounded two-model fixture composition. Technically suitable; no new dependency found. |
| D2 | **Not ready for owner acceptance** | First correct High-1, then accept the single authoritative fail-first/closeout rule. The current stdout-dependent residual is not sufficient. |
| D3 | **Technical disposition closed** | Zero Panel theming calls; no foreign-theming seeding. |
| D4 | **Owner decision remains** | Permit the bounded C15 real-Viewer failure injection only after harness implementation review, with the stated restore/taint rules. |
| D5 | **Technical disposition closed** | Keep selection/model-departure checks at the bridge boundary. |
| D6 | **Deferred/non-blocking** | Exercise only the isolation guard; simultaneous extension coexistence stays host/integration work. |
| D7 | **Ready for owner decision** | Accept C20's verdict role, PARTIAL fallback and the disclosed PASS-granting CA constants/capture budget; freeze them before any run. |

## Scope and authorization result

The accepted architecture remains preserved by the actual source: `ViewerBridge` is the sole Viewer-mutating Panel layer; `createMarkerSet` removes only meshes it owns and scenes it created; `createPanelShell` remains a thin DockingPanel wrapper. G2 remains bridge/DockingPanel verification only. G3 workflow acceptance, H1/H2 host work, OQ-1, host integration, Viewer Adapter/Core/M4 changes and production changes remain outside scope.

- **Procedure v4:** not ready for owner acceptance.
- **Required correction before harness planning/authorization:** High-1 and Medium M1; fold in the three Low clarifications in the same bounded documentation pass.
- **Owner decisions after correction:** D1, corrected D2, D4 and D7.
- **Current authorization:** no next action is authorized by this review. Procedure remediation, G2 harness implementation, live execution, G3, H1/H2, OQ-1, host integration, production changes, commit and push all require explicit owner authorization.

No harness or production code was created or modified; no live run, Playwright, Chromium or Viewer session occurred.
