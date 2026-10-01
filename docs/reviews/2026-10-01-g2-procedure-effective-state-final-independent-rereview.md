# G2 RC1-C2 Effective-State Correction — Final Independent Re-review

**Date:** 2026-10-01  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD:** `main` @ `68ef222f097d5ff34b475fdb3980fe662574ac3d`  
**Remote baseline:** `origin/main` @ `68ef222f097d5ff34b475fdb3980fe662574ac3d`  
**Scope:** `executionRecord.terminalState`, `dependencyBlockedBy`, and directly affected effective-state wording only.

## Verdict

The effective-state inconsistency identified by the prior independent RC1-C2 review is fully closed. The correction is mechanical, internally consistent, and introduces no semantic expansion.

**Findings:** 0 Critical / 0 High / 0 Medium / 0 Low.

## Verification

### 1. Effective-state rule

Section 7 now defines one record-type-discriminated rule:

- `control-run` → effective state is `state`.
- `gate-disposition` → effective state is `disposition`.

The procedure explicitly states that a `gate-disposition` has no `state` field and is not required to have one. This agrees with the exact `recordType` union in G-a…G-f and with the §10 evidence schema.

### 2. `executionRecord.terminalState`

The exact `executionRecord` schema now requires `terminalState` to equal the enclosing control record's effective state. Therefore:

- a `control-run` compares `terminalState` with `state`;
- a `gate-disposition` compares `terminalState` with `disposition`.

G-d remains consistent: a control gate-disposition has a not-started execution record with `terminalState === disposition` and `terminalSeq === dispositionSeq`.

### 3. `dependencyBlockedBy`

The exact clause now makes `dependencyBlockedBy` non-null iff the **effective state** is `NOT_RUN_DEPENDENCY_BLOCKED`. It expressly prohibits a raw `.state` read where the record may be a gate-disposition. Check gate-dispositions under `CLOSED_DEPENDENCY_BLOCKED` retain their already-defined exception because they have no control effective state and carry the C1 dependency object directly.

The L1–L4 NRDB legality test, X-rows, verdict rows, evidence schema, and directly affected tests therefore share the same lookup rule.

### 4. Stale-reference sweep

A whole-procedure search found no remaining `controls[N].state`, “whose state,” or equivalent raw `.state` requirement on a gate-disposition-capable record. Remaining uses are either:

- the new effective-state definition itself;
- explicitly scoped to `control-run`;
- the general explanation that a control's state is `control-run.state` or `gate-disposition.disposition`.

### 5. Regression check

The correction does not alter:

- the global C1 gate, closed-gate evidence predicates, or `recordType` union;
- NRDB L1–L4 or N7/N8 dependencies;
- fatal request witness/count semantics or gate-finalization ordering;
- C15(e), request/HTTP classification, prefix provenance, or operation ledgers;
- Table T, deadlines, verdict precedence, examples, or authorization semantics.

## Harness follow-up

The RC1-C2 internal review's 24-item harness follow-up remains complete. Item 23's discriminated-union/effective-state accessor must be used not only by verdict rows 4, 7, and 8, but also by:

- `executionRecord.terminalState` validation;
- `dependencyBlockedBy` presence and legality validation.

No additional harness item or production dependency is required. Harness follow-up remains a separate, unauthorized implementation transition.

## Repository state and verification

- `main == origin/main == 68ef222f097d5ff34b475fdb3980fe662574ac3d`.
- Procedure working-tree SHA-256: `5f9c4c7e124751d09406f07eab63f844fec53add006bd12ad676ecaca3732abb`; still provisional until the accepted documentation set is committed and rebound.
- Dormant harness has no diff; `LIVE_PATH_WIRED = false`.
- No live G2 attempt/evidence exists.
- Focused Table-T/dependency test: 7/7 pass.
- `git diff --check`: pass.
- No production, Core, Viewer Adapter, M4, Panel, G3, H1/H2, OQ-1, or host-integration change appeared.

## Status

- **Effective-state inconsistency:** fully closed.
- **Corrected procedure:** ready to commit as documentation.
- **Further procedure correction before harness follow-up authorization:** none known in this bounded scope.
- **Current authorization:** this review and handoff update only. Harness edits, commit, push, activation, authorization-record issuance, and live G2 remain unauthorized.
