# Federated Clash Test core-engine plan — final pre-authorization verification

- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch:** `feature/m4-performance-worker-decision-design`
- **HEAD:** `e29efec23a407b002358f43d35d1a2a2704ab113`
- **Frozen design SHA-256:** `c4e31684e3f89f2fcbfa6e50b00fe70b140bb19ce3d1bbfcd59a811b954e895f`
- **Master plan SHA-256:** `19a287b178c9c4dc1a7ce0fbdcc639b3547581e2acfd6c20e5395edacc82f5ff`
- **Interface reconciliation SHA-256:** `2e9ec12133903316249a05073ad84d7f129e77ca7670288e7cc1933f7aaefa6a`
- **Verification date:** 2026-09-21

## Verdict

The design, master plan, P0–P8 phase plans, interface reconciliation, remediation review, targeted re-review closeout, and handoff agree on the substantive core-engine contracts. No unresolved Critical or High implementation-plan finding remains. However, the formal G-PLAN acceptance record is not textually self-consistent: master §6(c), §6(d), and §6(e) are checked and end with explicit owner sign-off, but each still contains earlier prose saying its checkbox is or stays unchecked. Because §6 is the authoritative, mechanically readable authorization record, this verification cannot confirm that §6(b) is the *only* remaining blocker until those three stale clauses are removed or explicitly marked historical.

No design review was reopened. No plan, phase plan, reconciliation file, or design spec was modified by this verification.

## 1. Master §6(a): plan-review evidence

**Substantive result: verified.**

- The remediation review confirms the original 1 Critical, 3 High, 3 Medium, and 2 Low findings were materially resolved, then identifies three new High and two Medium findings.
- The targeted re-review closeout covers the remediated AC-16/A1, P7.4 Step 3a, AC-19(b′) Step 17a, AC-19(d′) Step 17b, master §6(e), directly affected traceability, and the follow-up engine-wiring/public-surface changes. Its fourth round reports no findings.
- The closeout also records 94 AC-path citations with 0 missing, a clean `git diff --check`, and the absence of implementation directories. Its limits are correctly stated: it is plan-level evidence and does not authorize implementation.
- The unchanged portions remain supported by the broader remediation review; the later closeout covers the only blocking findings raised there. Together they are sufficient technical support for §6(a), and §6(a) is checked with dated owner sign-off.

No unresolved Critical/High planning defect was found in this final targeted consistency pass.

## 2. Master §6(c): OPEN-1 and OPEN-2/A9

### OPEN-1

**Contract consistency: verified.** The spec, master plan, P5, and P7 use one delivery rule:

- `startRun` is synchronous, returns a `RunHandle`, and throws before a handle exists on capture, validation, option, slot, or queue admission failure.
- `rerun` and every other Promise-returning public entry point reject their returned Promise.
- P7 uses `assert.throws` for the `startRun` side and `assert.rejects` for Promise-returning operations, including `discardRun` and `retryPersist`.
- Erratum A8 records the whole-spec wording sweep and preserves the synchronous methods that still throw.

### OPEN-2 / A9

**Contract consistency: verified.** The persisted per-root row is `{rootDbId, ownerDbIds, cls}` inside the per-model `rootOwners[].owners[]` grouping. `cls` is required, has domain `'A'|'B'|'C'`, and participates in `ledgerDigest`.

- The spec pins the v1 row and digest coverage in §5.6, §13.1, and erratum A9.
- P3 assigns `cls` from the authoritative A′/B′/C partition and emits it.
- P5 pins, validates, reads, and digests it; invalid or absent values are rejected.
- P8 consumes it only through P5's ledger/status reader.
- `schemaVersion` remains 1 because no v1 Result Set has been implemented or persisted; `pairSetDigest` is unchanged.

**Formal-record inconsistency:** master §6(c) is checked and ends with `OWNER SIGN-OFF`, but still says “box left UNCHECKED” and “The box below stays UNCHECKED.” Those statements are stale and contradict the same line's current checkbox and final sign-off.

## 3. Master §6(d): bounded errata A2–A9

**Technical consistency: verified.** The accepted corrections are present across the current spec and their owning phase plans:

| Erratum | Current contract | Plan owner / verification |
|---|---|---|
| A2 | `TestSummary` is the four-field closed shape `{testId, latestRevision, archived, name}` | P2 validation and listing tests |
| A3 | Cell-1 whole-model sentinel also requires `A_n = ∅` | P3 decomposition/exact-cover work |
| A4 | Engine aggregation owns `maxDistinctReasons` and `omittedReasonOccurrences`; executor owns only whole-array caps | P4/P7 aggregation split |
| A5 | Completeness filtering is verdict-only; ledger taints remain unfiltered | P4 records, P5 status logic filters |
| A6 | Reference store holds canonical JSON and parses a fresh copy | P5 store and byte-bound tests |
| A7 | `secondaryCauses` is the first 8 distinct canonical causes; `RunOutcome.reasons` remains complete | P6 settlement and reasons tests |
| A8 | `startRun` throws synchronously; Promise-returning entry points reject | P5/P7 API and lifecycle tests |
| A9 | Required `cls` is emitted, validated, read, and included in `ledgerDigest` | P3/P5/P8 contract tests |

These are bounded reconciliations of contradictory or incomplete wording. They do not add a new subsystem, persistence backend, public abstraction, or Viewer dependency, and they do not reopen the frozen architecture.

**Formal-record inconsistency:** master §6(d) is checked and ends with `OWNER SIGN-OFF`, but still says its box was “left UNCHECKED for owner sign-off.”

## 4. Master §6(e): accepted owner dispositions

**Technical consistency: verified.**

- **AC-16 Option 2 / A1:** no durable field-level issue carrier exists or is required. Stored-reference failures remain bounded and fail closed before planning/execution; sealed and persisted sets contain no invalid definition, offending value, path, or issue-code detail. `PlanningGap` remains exactly `{phase, cause}`.
- **AC-19(b′):** P7.8 Step 17a owns the real-`CollisionWorld` 20,000-instance equal-count/different-membership test, with a baseline-only-oracle negative control. Runtime cost is calibration input, not grounds to weaken the test.
- **AC-19(d′):** P7.8 Step 17b owns four real-world tests covering repeated foreign growth, a clearing retry, direct invalidation equivalence, and host-signalled invalidation discrimination.
- **`migration-failed`:** it remains a distinct reserved planning cause but has no reachable producer at definition schema v1. Coverage is explicitly deferred until a real older-schema migration path and owner exist; no artificial migration seam is introduced. The deferral does not block P7.11 or G-PLAN.

None of these dispositions remains a substantive blocker to core-only P0–P7 implementation.

**Formal-record inconsistency:** master §6(e) is checked and ends with `OWNER SIGN-OFF`, but still says “This checkbox nevertheless stays UNCHECKED.”

## 5. Scope boundary

The current plan keeps the following outside a core-only P0–P7 authorization:

- Viewer adapter work and OQ-4 live Viewer evidence;
- remote persistence and ambiguous-commit reconciliation;
- annotation and derivation follow-up work, with P8 explicitly deferrable;
- calibration/default promotion and responsiveness claims;
- unresolved Host/product integration decisions and M4 Phase 4/workers.

The gate register correctly limits each external gate to its named package. None of these gates blocks functional core work after G-PLAN is validly completed, and none is silently pulled into P0–P7.

## 6. Authorization state

The intended state is clear: §6(a), §6(c), §6(d), and §6(e) are checked with dated owner sign-off; §6(b) is unchecked, and production implementation has not started. Repository governance therefore still forbids starting P0.

The requested stronger statement — that §6(b) is the *only* remaining blocker — is not yet mechanically safe because the checked §6(c)/(d)/(e) lines retain contradictory “unchecked” prose. Minimum correction: remove only those three stale pre-sign-off clauses (or label them explicitly as historical), preserving the checked boxes, dated owner sign-offs, and all technical dispositions. Then §6(b) will be the sole remaining gate, and the owner can separately authorize core-only P0–P7 work.

`owner sign-off state still inconsistent`
