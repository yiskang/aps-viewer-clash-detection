# Clash Detection handoff

- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch:** `feature/m4-performance-worker-decision-design`
- **HEAD:** `9c65903` ("docs: refine internal review loop rules in CLAUDE.md"; parent `62aa070`). Only `CLAUDE.md` was committed in this session.
- **Working tree (uncommitted, nothing committed by the plan task):** the design spec with the bounded errata applied (1,956 lines, SHA-256 `9bee6af5f206cbcb3a00d4c12545e8dba42b0bef33805ad9bc6e62a16d5ff29c`); this handoff; the master plan, ten phase/reconciliation files under `docs/superpowers/plans/federated-clash-test-core/`; Round 10–21 internal review records, the convergence review, and two plan-review records (`docs/reviews/2026-09-20-core-engine-plan-p5-…` and `…p6-internal-codex-review.md`). Some review records are staged, others untracked. **No production code and no tests exist** (`clashtest/` and `test/clashtest/` are absent).
- **Milestone context:** M4 — Performance / Worker Decision Gate is closed (Verdict D; Phase 4 unstarted and unauthorized). Current work: **Federated Clash Test & Results** — design frozen, core-engine implementation plan authored.

## Status in one line

**Core engine: implementation plan ready for plan review (not authorized for implementation).** **Viewer adapter / integration: still gated (OQ-4 research not done; no adapter plan).**

## Governing documents

- **Frozen core design:** [`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`](../superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md). Frozen by the independent convergence adjudication [`docs/reviews/2026-09-20-federated-clash-test-and-results-convergence-review.md`](../reviews/2026-09-20-federated-clash-test-and-results-convergence-review.md). Reopening needs a genuine correctness contradiction, an architectural impossibility exposed by the plan, or explicit user authorization (project `CLAUDE.md`, Review boundary).
- **Core-engine implementation plan (master):** [`docs/superpowers/plans/2026-09-20-federated-clash-test-core-engine-implementation.md`](../superpowers/plans/2026-09-20-federated-clash-test-core-engine-implementation.md) — scope, module map, phase graph, gate register, Definition of Done, plan rulings (§8), executor rules (§9).
- **Phase files** (`docs/superpowers/plans/federated-clash-test-core/`): `p0-foundations` · `p1-identity` · `p2-definitions` · `p3-planner` · `p4-executor-diagnostics` · `p5-result-set` · `p6-run-lifecycle` · `p7-engine-integration` (owns the AC-1…AC-21 traceability table) · `p8-derivations` (deferrable) · `interface-reconciliation` (name register, duplicate-ownership decisions D1–D4, spec-issues register, post-remediation addendum).
- M4 status authority (`docs/research/m4-phase3-closeout-disposition.md`), roadmap and M4 spec/plan unchanged.

## What this session did

1. **Bounded errata applied to the spec only** (13 mechanical edits, listed in spec §25 "Errata pass (post-convergence)"): `result.type`→`mode`; `ProjectedDiagnostic` vs `NormalizedDiagnostic`; §17.1 as the single defaults source; `startRun` overload sketch, `externalId` removal, un-archive wording, AC-13 facet expression. No architecture, persistence, annotation or edge-case contract was added; no adjudicated decision reopened.
2. **Authored the core-engine plan** as a master + nine phases (P0–P8) by parallel subagents; a reconciliation pass (43 edits) resolved cross-phase interface mismatches and four duplicate-ownership pairs; two Codex plan reviews (P5, P6) found stale executable code, which a remediation pass fixed in all nine files (all 5 Critical + 4 Important findings each for P5/P6 addressed; P0/P1/P2/P4/P7/P8 conformance-checked; P3 also remediated). A residual sweep closed the last cross-file items (found and fixed one real defect: the ledger `cls` value domain).
3. **Verification actually performed (plan level only):** code blocks in each phase file were extracted and executed in a scratch directory against stubs of assumed producers (P0 94/94, P1 77/77, P2 76/76, P4 10/10, P5 22/22, P8 81/81 for P8.1–P8.7, P6 settlement/freshness blocks 20/20, P3 scopeDigest 8/8 and planSplit 4/4; P7 blocks `node --check` only). These prove internal consistency of the plan's sketches, **not** that P0–P8 integrate — nothing was run against the real `clashtest/` because it does not exist. A global grep found zero live uses of superseded names in executable code blocks.
4. `CLAUDE.md` "Internal review loop / Review boundary" rewrite and freeze-respect rule (committed as `9c65903`).

## Plan rulings and proposed spec errata (need owner awareness)

Plan-level rulings R1–R11 and OPEN-1…4 are recorded in the master §8 and the reconciliation addendum. The ones a human should confirm at the plan-review gate: `startRun` throws synchronously while Promise-returning entry points reject (OPEN-1); the sealed ledger carries a per-root class marker `cls` (OPEN-2 option a — adding it later costs a ledger `schemaVersion` bump).

**Seven items are recorded as PROPOSED SPEC ERRATUM — needs user authorization to reopen** (each has a plan-level workaround, none blocks P0): S-P2-1 (`TestSummary` has two closed shapes), S-P3-2 (cell-1 sentinel over-covers), S-P4-1 (`omittedReasonOccurrences` illegal in a closed DTO), S-P4-4 (taint rule 1 vs benign `witness-unavailable`), S-P5-2 (`structuredClone` store vs byte guard), S-P6-C3 (doc-only), S-P7-1 (`rerun` "throws" vs rejects). Full text in `interface-reconciliation.md`.

## Gates — each blocks only the named work

| Gate | Blocks | Does not block |
| --- | --- | --- |
| **G-PLAN** plan review passed and "core-only" scope recorded by the milestone owner | Start of P0 implementation | Authoring / plan review |
| **G-OQ4** Viewer owner-mapping/enumeration evidence | Viewer-adapter work package (no plan yet) | P0–P8 (fake `ElementEnumerator`) |
| **G-OQ1** `modelKey`/`modelVersion` witness derivation | Viewer/Panel wiring | Core |
| **G-OQ17** placement-invalidation owner | Host integration | Core |
| **G-OQ16** hierarchy-internal acceptance | Enabling a *qualified* claim in a Host build | Core (`hierarchyInternalAcceptance` defaults `null`) |
| **G-OQ19** bracketed-proof tightening | Nothing (non-gating) | — |
| **G-CAL** AC-12 memory/stall measurement + confirmed browser budget | Promoting provisional caps/schema ceilings to deployable defaults | All functional work |
| **G-REMOTE** remote persistence in v1? | The (unwritten) remote-persistence follow-up | Core (local transactional store only) |
| **G-RESP** responsiveness target/device scope (carried from M4) | Any responsiveness claim | Functional work |

## Explicitly not in the core plan

Viewer adapter and OQ-4 research; remote-persistence reconciliation/disposal machinery; annotation layer (§14.5, incl. R21-C3 source-map bound); P8 derivations are planned but **deferrable** and not required for core Definition of Done; product decisions and calibration values above; Panel UI; M4 Phase 4 / workers. Open Low findings from the original review (L2, L4 for AC-15 (d)–(g)) and all provisional/unmeasured caps remain. Carried over from M4: no external confirmation of the responsiveness target; R6's ~10-instance workload needs product confirmation; three non-blocking closeout follow-ups.

## Review status of the plan (honest scope)

- **Independent review coverage:** Codex reviewed **only P6 and P5** (two rounds each: `docs/reviews/2026-09-20-core-engine-plan-p5-internal-codex-review.md`, `…p5-reverification-codex-review.md`, `…p6-internal-codex-review.md`, `…p6-reverification-codex-review.md`). P0–P4, P7 and P8 received conformance sweeps and scratch execution of their code blocks but **no independent review**.
- **Trend that matters:** round 1 found the P5/P6 executable steps still on pre-reconciliation APIs (5 Critical each); round 2 found 4 further Critical in P6 and 3 in P5 (retry-protocol mismatch with P4, pre-resolution seal, dispose control path, transactional unit commit; unknown-field budget charged after allocation, digest-version claim conjunct, closed structural schema). All were remediated in a final targeted round (P0 `openFieldBudget`, P5, P6, P7). **No further Codex round was run after that remediation** — the Review boundary rule says stop and hand to the independent gate rather than iterate. Expect the independent review to find more; the plan is a *reviewable draft*, not a verified implementation-ready plan.
- **Verification performed:** plan code blocks were extracted and run in scratch against stubs (last counts: P0 102/102, P1 77/77, P2 76/76, P4 10/10, P6 settlement/freshness/dispose logic green, P5 22/22 before the final round plus new table-driven checks, P7 21/21 blocks `node --check`, dispose block executed). These check internal consistency only; **nothing has run against real code** (`clashtest/` does not exist).
- **Known low residuals (not blocking):** P5 reads an optional `limits.maxUnknownFieldBytes ?? UNKNOWN_FIELD_BYTES` although P0 defines no such engine-limit key (falls back to the constant — drop the optional key or add it to P0); `interface-reconciliation.md` addendum and its N4 row predate the final round (P0 capture failure shape now carries `nodes`/`openFieldBytes`; `p2-definitions.md` ~line 97 shows the older shape); P6's optional read-time `unverifiable` for an unknown digest version is not implemented there (the P5 claim predicate owns the rule).

## Suggested next action

1. Independent ChatGPT Work review of the plan (start with the master §3–§9, then P6, P5, P3, P7; P0–P2, P4, P8 have had no independent pass).
2. In parallel, commission the OQ-4 Viewer research artifact and capture the product decisions (OQ-1, OQ-16, OQ-17, memory budget, remote-vs-local persistence).
3. Only after G-PLAN: begin P0, then P1 → P2 → (P3 ∥ P4 ∥ P5) → P6 → P7. No commit is authorized yet for any of the uncommitted work.
