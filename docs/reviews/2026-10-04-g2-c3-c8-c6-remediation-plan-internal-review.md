# G2 C3/C8/C6 Remediation Plan — Focused Internal Review

**Artifact:** `docs/research/2026-10-04-g2-c3-c8-c6-remediation-plan.md`
**Reviewer:** Codex (`codex-review spec`, effort `medium`, request `20261004-132013-79322-13935`), one pass, per CLAUDE.md internal review loop. Findings adjudicated independently against the plan and repository.
**Baseline:** `main == origin/main == 6f716bc0d0d2c1b1e61d26fe50b4dbe56266f7e4`.
**Scope:** planning artifact only. No harness/test/production/procedure change; evidence snapshot untouched.

## Result: 3 Critical / 4 High / 1 Medium / 0 Low raised → all dispositioned; 0 Critical/High remain open at plan level

Codex's initial verdict was "requires major revision". After remediation the remaining items are explicitly classified as implementation-plan requirements or owner decisions, not planning defects.

| # | Sev | Finding | Disposition | Where addressed |
| --- | --- | --- | --- | --- |
| 1 | Critical | D4 (diagnostic live) required by the gate that must pass before D4 can run (circular) | **Accepted, fixed** — split into 7.0 diagnostic-live gate and 7.1 remediation-retry gate | plan §7 |
| 2 | Critical | Phase A "no code change" contradicted by D1/D2 fixture/test additions | **Accepted, fixed** — A0 read-only (temp scratchpad tooling only, non-retained) vs A1 separately-authorized offline implementation | plan §6 |
| 3 | Critical | `CONTROL_INVALID` not in accepted N2 state contract; "BLOCKED or NOT_DETECTED" ambiguous | **Accepted, fixed** — ambiguity replaced with one mapping (settle timeout/missing signal → BLOCKED via existing H:8493 path); invalid-control state made an explicit owner decision M1 (reuse `NOT_DISCRIMINATING` + new reason, recommended) vs M2 (new enum, enumerated procedure/schema blast radius incl. full re-acceptance) | plan §4.3 S2, §9 Q5 |
| 4 | High | No executable H1–H5 experiment matrix (sequence, initial state, repetitions, timeouts, placement context) | **Accepted, fixed** — D4 experiment table E1–E5 with quiescence, listener-before-call, timeout→BLOCKED, ambiguity clause; placement/global offset retained-or-justified (currently UNVERIFIED) | plan §4.5 |
| 5 | High | S2/S3/S4 predicates not mechanical ("moved", "tight", "≥~1") | **Accepted as requirement, not expanded here** — classified implementation-plan requirement/calibration gate; valid no-op explicitly allowed; numeric constants require owner approval. Inventing tolerances in a research plan would be the unbounded expansion CLAUDE.md warns against. | plan §4.5 |
| 6 | High | Instrumentation (D3) lacks lifecycle/schema/size-budget contract | **Accepted as requirement** — bounds (4 KiB/field, 2 MiB ledger), listener ownership/teardown, truncatable non-verdict-critical, C19/N1 residue check, evidence-cap tests | plan §4.5 |
| 7 | High | Future record must supersede existing record (`candidate-set-ambiguous` otherwise) | **Accepted, fixed** | plan §7.1 gate 10 |
| 8 | Medium | "All offline suites" not concrete; no seam for drift test to reach harness constants | **Accepted, partially** — suites named by category under `test/acceptance/`; exact commands deferred to implementation plan; export seam + page-agent-bundle/SHA check specified | plan §7.1 gate 7, §4.5 |

## Planning-scope checks requested by the prompt

- **C3 defect correctness:** independently re-confirmed by direct citation (H:9155-9156 vs `intents.js:34`); Codex agreed the C2/C3 claim matches product and harness.
- **C2 sibling audit scope:** bounded to name/value class; two sites; residual unread internals flagged UNVERIFIED rather than claimed clean.
- **C8 hypothesis separation:** H3 contradicted, H1 not supported, H4 open, H2/H5 supported **[INFERRED]**; the review accepted the confirmed/inferred/unverified separation as a strength. Camera-lag reconstruction is explicitly a claim for Work adjudication.
- **C8 evidence capture sufficiency:** D3 list + E1–E5 table + §4.5 contract.
- **C6 control discrimination:** S1–S5; the plan flags that S1–S4 change C6/N2 semantics (procedure-touching), not a harness-only fix.
- **C20:** derivative, no standalone workstream.
- **Scope discipline / silent procedure alteration:** C3/C2 fix requires no procedure text change (procedure line 247 symbolic). Any settle-rule (T4) or control change is stated to alter accepted-procedure semantics and require explicit owner decision plus re-acceptance. Nothing in the plan silently alters the procedure.
- **Retry gate strictness:** two gate sets; retry gate requires supersession record, new HEAD/harness/procedure bindings, independent Work acceptance, exactly-one owner authorization.

## Residual items (not planning defects)

- Owner decisions: T4 revision acceptable? control-invalid mapping M1/M2? S3 margin constant? D4 vehicle? authorize C3/C2 as a separate earlier step? (plan §9)
- **[UNVERIFIED]** Viewer 7.124.2 semantics of `cameraTransitionCompleted`, `restoreState(immediate)`, fits during active transition, and whether `getNodeBox` is world-space → gate D0.
- Camera-lag explanation is inference from reconstructed cameras; not proven.

## Review boundary

One pass only; no automatic re-review. The plan is at a stable checkpoint for independent Work review. Per CLAUDE.md, no further internal expansion should be done before that gate.
