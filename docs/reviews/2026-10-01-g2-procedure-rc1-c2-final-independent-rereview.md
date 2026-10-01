# G2 Procedure RC1-C2 — Final Independent Re-review

**Date:** 2026-10-01  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD:** `main` @ `68ef222f097d5ff34b475fdb3980fe662574ac3d`  
**Remote baseline:** `origin/main` @ `68ef222f097d5ff34b475fdb3980fe662574ac3d`  
**Scope:** corrected RC1-C2 record types, NRDB legality, N7/N8 dependency graph, request identity/fatal-witness accounting, finalization boundary, and directly affected dormant-harness follow-up. Documentation review only.

## Verdict

The RC1-C2 architecture is substantially correct: the global C1 gate, synthetic gate-disposition model, N8 dependency correction, request-observation ledger, one-witness-per-trustworthy-request rule, and atomic pre-gate finalization all close the prior H1/M1/M2 failure modes.

One **Medium** normative schema inconsistency remains. Section 7's older `executionRecord` and `dependencyBlockedBy` text still refers to `controls[N].state`, although a `gate-disposition` control deliberately has no `state` field and carries its effective state in `disposition`. The later G-d rule and §10 use the correct effective-state model. This is a bounded wording correction, but the procedure is not internally exact enough to commit or authorize harness follow-up until it is reconciled.

**Findings:** 0 Critical / 0 High / 1 Medium / 0 Low.

## Findings

### Medium — M3: two normative control-schema clauses still require a field forbidden by `gate-disposition`

**Location:** §7, `executionRecord` and `dependencyBlockedBy` definitions (currently lines 425 and 427).

The exact `executionRecord` shape says `terminalState` “equals `controls[N].state`.” The following `dependencyBlockedBy` paragraph says it is null for every control “whose state is not NRDB.” Under RC1-C2, however, a closed-gate control record is a `gate-disposition` record. Its exact shape has `disposition`, not `state`; unknown keys are rejected. G-d and §10 correctly define the effective state as `state` for `control-run` and `disposition` for `gate-disposition`.

**Concrete failure mode:** a literal implementation of the earlier exact clauses must either read a missing field, add a forbidden `state` key, or special-case the later rules. That makes the supposedly unified discriminated union mechanically ambiguous and can cause a correct closed-gate result to fail schema validation or an incorrect result to be accepted by a divergent validator.

**Minimum correction:** in both clauses, replace the raw `controls[N].state` / “control whose state” references with the already-defined effective-state rule: `state` for `control-run`, `disposition` for `gate-disposition`. State explicitly that `terminalState` equals that effective state. No architecture, verdict order, owner decision, or harness behavior changes.

## RC1-C2 adjudication

### 1. Global C1 gate / record types

- `check-run`, `control-run`, and `gate-disposition` are otherwise disjoint and exhaustive.
- A closed C1 gate requires exactly one synthetic record for each C2–C20 and N1–N8, with `executed:false`, `synthetic:true`, null start fields, deterministic disposition order, and no downstream run record.
- Check verdict rows read only `check-run` records. A gate-disposition therefore cannot masquerade as an executed PASS, FAIL, BLOCKED, or NOT_EVIDENCED check.
- CG-1…CG-7 enumerate the prohibited downstream execution evidence over markers, spy/state/event ledgers, operation records, request records, run-record types, and live-check payloads. The legal closed-gate exceptions are also enumerated.

The former High gate contradiction is conceptually closed. It is **not fully mechanically closed** until M3 removes the two stale raw-`state` references.

### 2. NRDB / X4

L1–L4 correctly limit `NOT_RUN_DEPENDENCY_BLOCKED` to a synthetic gate-disposition created after a normalized C1 prerequisite/load-timeout BLOCKED result and before any dependent control starts. Later timeout, taint, started-control failure, or other C1 reason cannot use NRDB. Rows 1–3 remain verdict precedence rather than record-legality conditions, so real failures cannot be hidden.

Option B is technically sound. X4/NRDB is **not fully mechanically closed** only because M3 leaves the effective-state lookup inconsistent in the normative schema text.

### 3. Dependency graph

- N7 = `{C1,C16}`.
- N8 = `{C1,C4,C7,C8}`.
- C20 is excluded from N8, avoiding a cycle while retaining every actual pre-N8 execution prerequisite.

The prior M1 finding is fully closed.

### 4. Request identity and fatal witnesses

`requestObservations[]` is the retained source of trustworthy request identity. A valid request identity produces one correlated request and at most one fatal witness regardless of `requestfailed`/HTTP-event order or duplication. Worse classification wins, ownership conflict fails safe, raw events remain retained, and only witness creation increments the network fatal count.

Counting duplicate events with an invalid `reqId` separately is acceptable conservative behavior. “One witness per request identity” applies only where identity is trustworthy. An invalid event receives a unique `invalid:<rawEventSeq>` fail-safe identity because merging two uncorrelatable events could suppress a fatal. This can over-count but cannot change a non-PASS into PASS; it is not a contradiction.

The prior M2 finding and request witness/count semantics are fully closed.

### 5. Provisional finalization boundary

Gate preparation is synchronous and ordered: finalize gate-bound provisional responses, rebuild correlations/witnesses, recompute the count invariant and `fatalCountAtGate`, then allocate `gateSeq`. The required `finalizedSeq = witnessSeq < gateSeq` relation makes late mutation detectable. Closeout deterministically recomputes identity, correlations, witnesses, and counts from retained observations/raw events; any mismatch is row-5 FAIL.

### 6. C15 and request-policy regression check

The RC1-C2 changes do not regress the C15(e) `H_iso` three-clear oracle, the HTTP ≥400 default-fatal policy, expected-cancellation causal checks, prefix provenance/`boundPrefix`, or disjoint load/mutation/teardown operation ledgers. The known HTTP false-FAIL risk remains conservative and does not create a false PASS.

## Exact dormant-harness follow-up after M3 is corrected and separately authorized

The RC1-C2 internal review's 24-item set is complete. It requires:

1. C15(e) three-clear driver/oracle and `H_iso` capture/schema/tests.
2. NRDB `executionRecord`/`dependencyBlockedBy`, normalized C1 reasons, and the global C1 gate.
3. X4/X20–X29 matrix updates and request/response listener instrumentation.
4. HTTP ≥400 classification, provisional finalization, operation ledgers, prefix derivation, ambiguity accounting, and `boundPrefix` validation.
5. Schema/classifier/redaction/static tests and final procedure-SHA rebinding.
6. Typed synthetic gate-disposition records and removal of the old downstream `BLOCKED(dependency:C1)` run-record encoding.
7. Corrected NRDB L1–L4 handling and exact `dependencyBlockedBy` use for closed dependency gates.
8. N7/N8 dependency-table correction and acyclicity tests.
9. Raw-event correlation, `requestObservations[]`, one-to-one fatal witnesses, witness-only counting, and closeout recomputation.
10. Gate-disposition/matrix tests, including G-a…G-f, row-8 exclusion, X28/X29, and request tests (18)–(25).
11. Closed-gate attribution fields and CG-1…CG-7 mutation/legal-record tests.
12. Discriminated-union validators with one effective-state accessor used by schema validation and verdict rows 4, 7, and 8.
13. Atomic gate preparation and the ordering negative control.
14. The previously retained M1/M2 pre-link dependency/static guards before live execution.

Items 1–14 above are a grouped restatement of the internal review's exact numbered 1–24; they add no scope. In item 12, the effective-state accessor must also implement the M3 correction consistently for `executionRecord.terminalState` and `dependencyBlockedBy` legality.

## Repository and authorization verification

- `main == origin/main == 68ef222f097d5ff34b475fdb3980fe662574ac3d`.
- Procedure working-tree SHA-256 is `20a0c98cd3fa955a4b9314a07afc17fd58b2de1a246bf4381b419697a490f741`; it is provisional and cannot bind a live authorization.
- Dormant harness has no diff, and `LIVE_PATH_WIRED = false`.
- No G2 live result/attempt evidence exists.
- Focused Table-T/dependency test: 7/7 pass. `git diff --check` passes. This test does not exercise RC1-C2 semantics.
- No production, Core, Viewer Adapter, OQ-1, host-integration, G3, H1, or H2 dependency appeared.

## Status

- **H1:** conceptually closed, not fully mechanically closed because of M3.
- **M1:** fully closed.
- **M2:** fully closed.
- **X4/NRDB:** technically sound, not fully mechanically closed because of M3.
- **Request witness/count semantics:** fully closed.
- **Ready to commit:** no.
- **Further procedure correction before harness follow-up authorization:** yes — the single bounded M3 effective-state wording reconciliation.
- **Current authorization:** this independent review and handoff update only. Procedure edits, harness edits, commit, push, activation, authorization-record issuance, live G2, and downstream integration remain unauthorized.
