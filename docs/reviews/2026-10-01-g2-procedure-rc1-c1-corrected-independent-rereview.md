# Independent re-review — corrected G2 RC1-C1 procedure

**Date:** 2026-10-01  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD:** `main` @ `68ef222f097d5ff34b475fdb3980fe662574ac3d` = `origin/main`  
**Primary artifact:** [`docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md`](../research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md)  
**Scope:** corrected RC1-C1 areas only: C15(e), HTTP/request provenance, X4/NRDB, dependency ids, global C1 gate, authorization binding, and dormant-harness impact.

## Verdict

**0 Critical / 1 High / 2 Medium / 1 Low.**

The C15(e) correction is fully closed. The request-fatality and provenance model is fail-closed and mechanically specified. The NRDB policy and record schemas are sound, but X4/NRDB is not fully closed because the global C1 gate contains a literal contradiction about the synthetic downstream check records. The procedure is **not ready to commit** and the harness follow-up is **not ready for authorization** until H1 and M1 are corrected; M2 should be corrected in the same bounded pass.

No production, Core, Viewer Adapter, M4, Panel, OQ-1, host-integration, G3, H1, or H2 dependency appeared.

## Verified repository state

- `main` and `origin/main` both resolve to `68ef222f097d5ff34b475fdb3980fe662574ac3d`.
- The dormant harness is unchanged from HEAD; `LIVE_PATH_WIRED = false` at `test/acceptance/clashpanel-viewerbridge.acceptance.mjs:100`.
- No G2 result, journal, closeout, or commit artifact exists under the searched result/evidence paths. No live G2 attempt was run.
- Current working tree before this review: modified procedure and handoff; untracked two prompt files, the prior independent RC1 review, and the RC1-C1 internal review.
- Procedure digests verified from bytes: committed v5 `940d525fdb2fd17ac4737bcdffe5668afc6956e59c0009b18cc257e222ff1d2e`; prior RC1 `6a94713c4b475f752c2bda214812a0d4dc2ce4d7be799a870bedfd4ae3d44fdf` (recorded/reconstruction-verified by the internal review); current corrected working-tree digest `a1dbbd8f57bc1d2bd0c871fd098c62239d9d54799458de4621b45164556b8722`.
- `git diff --check` passed. The targeted Table T/dependency test passed **7/7**. This test does not exercise the new RC1-C1 semantics.

## Findings

### High — H1: the closed global C1 gate both requires and forbids downstream check records

**Where:** procedure §7, “Global C1 gate”.

For `CLOSED_DEPENDENCY_BLOCKED` and `CLOSED_OTHER`, the procedure requires the harness to record C2–C20 after `gateSeq` as `{verdict:'BLOCKED', reason:'dependency:C1'}`. The mandatory gate equations then state that, for a closed gate, no P2–P11 “check record” exists. These statements cannot both be satisfied literally, and `validateResultSchema` cannot mechanically distinguish the required synthetic terminal check records from prohibited evidence that a downstream check actually started.

**Failure mode:** a correct dependency-blocked run is either rejected by the closeout validator, or an implementation weakens the prohibition ad hoc and can admit real downstream execution after a closed gate.

**Minimum correction:** preserve the required synthetic C2–C20 terminal records and replace the prohibition with an exact ban on downstream **start/action/evidence** records (check-start events, Viewer calls, spy records, non-cleanup operation-ledger entries, control starts, or live-check evidence). Add a cross-field rule that each synthetic C2–C20 record has its terminal sequence after `gateSeq`, before cleanup, and no start/action/evidence reference. Update X28 and the gate tests to cover both the allowed synthetic records and a prohibited downstream-start mutation.

### Medium — M1: N8's exact `dependencyIds` omits two declared execution prerequisites

**Where:** procedure §5 dependency table and §7 “Control dependency ids”.

Section 5 says C20 depends on C4, C7β, C8, and N8. N8 executes inside the C20 path over the captured rendering arrays. Excluding C20 itself is correct and avoids a cycle, but the exact N8 row `['C1','C4']` omits C7 and C8 even though both outcomes must already exist before the C20/N8 phase may start. The table defines `dependencyIds` as the checks whose recorded outcomes must exist before a control starts, so the row under-specifies its own stated dependency graph.

**Failure mode:** durable control evidence cannot independently prove that N8 began only after the marker/bridge and camera prerequisites that gate C20.

**Minimum correction:** set N8 to `['C1','C4','C7','C8']`, keeping C20 excluded. N7 `['C1','C16']` is correct: its pre-check runs after C16 restoration and before the C17 conclusion it validates.

### Medium — M2: fatal-event counting lacks an explicit request/response linkage invariant

**Where:** procedure §9.2 verdict effect, captured shapes, cross-field rules, and required offline tests.

The procedure correctly records HTTP responses and network failures as different event kinds. It does not say how `fatalCount` and `errorLedger.entries[]` relate when one `reqId` produces both a `response` with status ≥400 and a later `requestfailed` event (for example, headers were received and body transfer then failed). Both lists retain enough identity to audit the events, but no cross-field bijection or explicit per-event counting rule prevents an implementation from counting once, twice, or inconsistently between event time and closeout.

**Failure mode:** the overall verdict remains fail-closed, but `fatalCountAtGate`, the retained fatal ledger, and closeout recomputation can disagree for the same network request.

**Minimum correction:** define fatality accounting per finalized **event witness**: every finalized fatal `requestFailures[]` or `responseFailures[]` entry maps to exactly one `errorLedger.entries[]` record and contributes exactly one to `fatalCount`; if both event kinds occur for one `reqId`, both are retained and counted separately (or explicitly choose request-level deduplication and define its canonical witness). Add one offline test for the dual-event case and validate the count/bijection at the gate and closeout.

### Low — L1: the HTTP policy may conservatively fail on legitimate unrelated Viewer traffic

With `OPTIONAL_RESPONSE_RULES = []`, every observed HTTP status ≥400—including optional lookup, speculative/fallback, unload-time, telemetry, or unrelated Viewer-service responses—is fatal. The repository contains no retained response-level trace proving that Viewer 7.124.2 emits or does not emit such responses in this exact two-model workflow. This is safe against false PASS and technically acceptable for live planning, but it can produce a conservative false FAIL and consume the single attempt. Relief must not be invented now: it requires retained evidence and a separately reviewed exact optional-response rule.

This is non-blocking for the procedure because fail-closed behavior is the explicit policy; it is a live-execution risk to call out in the authorization record.

## C15(e) / H_iso adjudication

**Fully closed.** Source verification confirms:

- `ViewerBridge.releaseHeld()` removes marker ownership before calling `isolation.restore()` in `finally`.
- `isolation.restore()` retains its private record after a failed restore and drops it only after restoration succeeds or an external state takes ownership.
- `inspectLedger()` returns `null` once the outer marker ledger is gone, so it correctly remains diagnostic-only after every clear.

The corrected oracle captures `H_iso` immediately after the successful setup `present()`, requires clear #1 to return `failed` with isolation `T_iso` and hidden state `H_iso`, requires clear #2 to return `restored` at `E0/H0`, and requires clear #3 to return `none` at the same baseline. The retained DTOs contain only JSON primitives, arrays, plain objects, and A/B model keys; comparisons and predicates are recomputable from the retained record.

An unreadable `H_iso` during setup is correctly `BLOCKED(precondition:c15e)`. An unreadable post-clear read is correctly **FAIL**, not `NOT_EVIDENCED`: C9 and the C15(e) setup already established the public Viewer read as available and normalizable, and C15(e)'s purpose is to prove a specific post-mutation state. A wrong readable value is a state mismatch; an unreadable value is an oracle/runtime failure. Both prevent the required safety claim, but they remain separately labelled.

## Request-fatality / provenance adjudication

The corrected model is mechanically executable:

- Prefixes derive only from successful 2xx `requestfinished` observations inside a closed, disjoint model load window. Failed, HTTP-error, unfinished, ambiguous, overlapping, and navigation candidates cannot establish model ownership.
- `prefixSourceLedger`, `prefixDerivation`, `ambiguousPrefixes`, `boundPrefix`, load operations, and mutation operations have exact disjoint JSON schemas and closeout recomputation rules.
- Expected cancellation requires a pre-existing in-flight request, exact abort text/type, a uniquely bound model prefix for hide/unload, an explicit causal mutation operation, and an open cancellation window. Temporal overlap alone is insufficient.
- Bootstrap, harness endpoints, unknown fields, ambiguous ownership, and all live HTTP ≥400 responses remain fatal. The empty optional-rule set cannot hide a required failure.

Subject to M2's counting clarification, **request-fatality is closed at the policy/classifier level**. Fatal-by-default HTTP ≥400 is acceptable for live planning, with the conservative false-FAIL risk recorded above.

## X4 / NRDB and dependency adjudication

The NRDB state, `executionRecord`, `dependencyBlockedBy`, normalized C1 reasons, legality L1–L5, fail-first precedence, and X4/X20–X28 examples are individually coherent. They ensure that only a normalized C1 prerequisite/load-timeout block can produce NRDB and that any started, tainted, timed-out, or genuinely failed control remains a FAIL path.

However, **X4/NRDB is not fully closed** until H1 removes the global-gate contradiction. The global start boundary itself is otherwise unambiguous: C1 finalizes, then `gates.C1` is written, then either P2 begins (`OPEN`) or only synthetic not-started terminal records are emitted before cleanup.

Dependency mappings:

- N7 → `{C1,C16}`: correct.
- N8 → `{C1,C4}`: incomplete; minimum exact mapping is `{C1,C4,C7,C8}`. C20 must remain excluded to avoid the cycle.

## Harness follow-up impact

The internal review's 14 items cover the main RC1-C1 implementation surface, but the final authorized list must incorporate these corrections:

1. Implement the C15(e)/`H_iso` three-clear oracle, exact JSON DTO/schema, predicate recomputation, and mutation tests.
2. Implement NRDB, normalized C1 reasons, the global gate, and X4/X20–X28 **after H1 is corrected**, with synthetic terminal records permitted but every downstream start/action/evidence record prohibited.
3. Use corrected N8 dependencies `C1,C4,C7,C8`; keep N7 `C1,C16`.
4. Implement request/response listeners, exact operation/prefix/classifier ledgers, HTTP policy, redaction, and a one-to-one fatal-witness/count invariant including a same-`reqId` response-plus-requestfailed test.
5. Complete schema/matrix/static tests and rebind the procedure SHA only from the final accepted committed bytes. Preserve M1/M2 pre-link static-guard hardening as before-live-execution work.

## Authorization binding and current state

- Committed procedure SHA `940d525f…`: stale for any future live authorization.
- Prior RC1 SHA `6a94713c…`: stale.
- Current corrected SHA `a1dbbd8f…`: provisional and will become stale after the required correction.
- A future live authorization must bind the final accepted **committed** procedure, harness, HEAD, fixtures, and other required digests. No prior SHA/HEAD binding may be reused.

**Current authorization:** this independent review and handoff update only. Procedure correction, harness edits, commit, push, `LIVE_PATH_WIRED=true`, authorization-record issuance, and live G2 remain unauthorized.

## Final gate

- **C15(e):** fully closed.
- **X4/NRDB:** policy/schema closed; global-gate contradiction remains blocking.
- **Request-fatality:** policy/classifier closed; M2 accounting clarification remains non-architectural but required before implementation.
- **Corrected RC1 procedure ready to commit:** no.
- **Further procedure correction before harness follow-up authorization:** yes — H1 and M1 are required; include M2 in the same bounded pass.
