# G2 Node-authoritative partial-result transfer — focused internal review

**Date:** 2026-10-02 · **Base:** `main` @ `c0f877aee82c078564efdb504bcbe695522b4ed4` (uncommitted) · **Provisional procedure SHA-256:** `59c27e186911074393323816532ddc5da3c35267e07408700844c5d4cc9d7b34` (supersedes stale `7f681889…`)

Scope: closes independent re-review H1 (completed post-C1 results lost when the attribution-clear fence and cleanup-entry fence both refuse). Reviewer: opus subagent, read-only.

## Design as implemented
- Node: `createRunAuthority.retainPageSnapshot`/`retained()` ingest pending ordinals like `drain` (no `incoming` attribution), remap the snapshot through the existing ordinal→seq map and keep the latest copy; any refusal records exactly one violation and keeps the prior snapshot. New `'retain'` action in the sync binding. No second sequence authority.
- Page: `runPhase` awaits an optional `sync.retain()` after the merge and **before** the clear fence (fail-closed; a refusal is the phase-run failure). `g2NodeSync().retainSnapshot` / `g2RetainSnapshot` build the snapshot; `g2RunPhases` wires it.
- Node transport-failure branch passes `retained: authority.retained()` to `applyPhaseRunFailureToState`; used only for `node-phase-run-transport` and only for `post-c1` (gate OPEN and retained C1 agrees with Node's gate). A normal page failure transfer wins (no duplicate history). `failureSeq` is Node-allocated after retained seqs. Retained `activeCheck`/`activeControl` already completed are nulled (schema rule `failed-run-active-control-already-terminal`; truthful because retain fires after the driver returned and merged).
- Procedure: limitation sentence removed; normative §9 "Node-authoritative completed-result retention" clause and §9.1 consistency edits.
- Tests: `…acceptance.node-partial-transfer.test.mjs` (11; real `main()` on a wired sandbox copy, real page bundle in `node:vm`), all 12 required cases plus ordering, incl. mutation test (old rethrow-before-transfer + Node ignoring snapshot ⇒ history loss caught). One existing `final-transfer` M1 test's fixed 150 ms sleep became a bounded 2 s wait.

## Findings: 0 Critical / 0 High / 1 Medium / 4 Low
- **Medium M1:** on the transport branch the retained `eventLog`/`spyLedger`/`stateSnapshots` are placed in R1 but `pageEvidenceProblems`/`assertAllocated` run only when `runApplied` is true, so completeness of that retained evidence is unverified; a phase's baseline snapshot is taken after that phase's retain (e.g. P3 retained, its failing baseline snapshot absent). Run still FAILs; truthfulness-of-detail, not a PASS path. Left for independent gate disposition (fixing means changing the retain/baseline ordering or extending evidence verification).
- **Low L1:** driver-catch / fatal-skip paths return before any retain; if a later failure is untransferred, their reasons become `BLOCKED(phase-run-threw)`.
- **Low L2:** P1's retain precedes `finalizeC1`; a failure at P2's start fence after an OPEN gate yields `post-c1-untransferred` (no fabrication).
- **Low L3:** cumulative payload resent per phase (bounded by the T9 deadline).
- **Low L4:** transport `phase` may be `'cleanup'` when only the final transfer fails (pre-existing).
- Subagent note (out of scope): C13 runs in P8 but is owned by P7, so a live driver `beginCheck('C13')` would be refused; live drivers untouched.
- Late retain after decision can add violation entries (authority not sealed) — Low, no R1 effect.

## Verification (non-live)
Focused 797/797; aggregate 5,043 total / 5,042 PASS / 0 FAIL / 1 TODO; binding 8/8; `git diff --check` clean (re-run independently by controller).
