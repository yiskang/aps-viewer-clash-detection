# Owner brief — Clash Tests Manager (session-scoped v1)

Date: 2026-10-10. Source: owner instruction in the current Claude Code session (recorded verbatim in substance).

## Authorization

The owner authorizes **Clash Tests Manager — session-scoped v1** as the next product package. The goal is a manager layer for multiple Clash Tests within the current Viewer session, while the existing Clash Test Panel stays the editor/runner for one test.

## Initial v1 scope

- create a new Clash Test;
- list/manage multiple tests in the current Viewer session;
- test name; Set A / Set B summary; Hard / Soft mode;
- run status; result count;
- open/edit an existing test; duplicate a test;
- delete/reset semantics with appropriate safeguards;
- current/active test state;
- model readiness/stale state when loaded models change.

## Explicitly out of scope

Persistence across reloads; run history; New / Existing / Resolved clash comparison; issue lifecycle / issue management; cloud/server storage; multi-level grouping; unrelated Low remediation; G2 / C6 / C8 / G3; reflected-fragment or R20-1 work.

## Instruction on gating

Inspect governing specs/plans and determine the correct design/planning gate. Do not skip into implementation unless repository artifacts already authorize it. Persist package state and stop at the next required review/owner gate.

## Gate determination (verified at HEAD `ea53399`, clean tree)

- Governing spec: `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md` (822 lines, last section §25). Plan: `docs/superpowers/plans/2026-09-26-viewer-clash-panel-implementation-plan.md`.
- A Clash Tests manager is an **explicit spec non-goal**: §0 Q9 (line 37, "multi-test suites" deferred), §18 (line 690), §25.1 (line 804). This brief is the owner decision that reopens that non-goal for a session-scoped manager only; it does not by itself amend the spec.
- Architecture the manager touches (single-test today): controller closure state `clashpanel/core/controller.js` (draft/run/displayed/residency/gen); one-slot residency `clashpanel/core/residency.js` and spec §7.6; single-owner Viewer bridge (isolation/selection/markers); spec §6.2 ("one test" = one Panel draft), §11.2 stale/unload table, §23.5 New-test reset.
- Because this is a new abstraction level (per-test record, multi-test residency, Viewer ownership), the correct gate is **design spec addendum §26 → internal Codex spec review (bounded) → independent Work review → separate implementation plan → separate owner authorization to implement**. Implementation is not authorized.

## Design questions §26 must decide

1. Where result sets/residency live for multiple tests (spec §7.6 allows one held set).
2. Which test may own the Viewer visualization (the active one only).
3. How "stale on model change" maps to `getFreshness` and §11.2.
4. Whether open/edit reuses the existing editor unchanged.
5. Whether delete/reset reuses the existing `heldUnsaved` confirm.
