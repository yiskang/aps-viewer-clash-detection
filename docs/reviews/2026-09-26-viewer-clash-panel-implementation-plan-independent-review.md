# Viewer Clash Panel implementation plan — independent review

- **Review date:** 2026-09-26
- **Repository / branch / HEAD:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection` · `main` @ `6a55b5040369d07b67f09fe31153c55eadf5694f` (`origin/main` identical)
- **Plan:** `docs/superpowers/plans/2026-09-26-viewer-clash-panel-implementation-plan.md`
- **Governing baseline:** owner-accepted `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`
- **Verdict:** **revise implementation plan before implementation authorization**
- **Findings:** 0 Critical / 2 High / 1 Medium / 2 Low

This was a plan review only. No production code, Panel implementation, live Viewer/SVF2 verification, OQ-1, host integration, Core, Viewer Adapter, or M4 work was started.

## Repository state and verification

- `main` and `origin/main` both point to `6a55b5040369d07b67f09fe31153c55eadf5694f`, the owner-accepted design closeout.
- The implementation plan and its internal-review record are untracked; `docs/handoffs/latest.md` is modified. There is no `clashpanel/` or `test/clashpanel/` implementation tree.
- The current repository suite was independently rerun. The restricted run had only three local-port `listen EPERM` failures. Re-running with local ephemeral-port permission produced **2,972 total / 2,971 pass / 0 fail / 0 cancelled / 0 skipped / 1 pre-existing todo**.
- The plan contains exactly **33 executable tasks** and **5 gated, non-executable items** (G1–G3, H1–H2).

## Findings

### Critical

None.

### High

#### H1 — A stale live-freshness result can coexist with an allowed no-clash claim, and the view renders the claim

- **Plan locations:** T11 `emptyStatement`; T17 `startFreshnessCheck`; PL-4; accepted-design §7.5 / AC-P2.
- **Type:** externally observable correctness / safety wording.
- **Failure mode:** T17 starts `engine.getFreshness(runId)` and `engine.assessNoClashClaim(runId)` concurrently. Each engine method independently recomputes live freshness. A placement/model change between the two reads can therefore produce `claim.allowed === true` from the earlier assessment and `freshness.state === 'stale'` from the later read. T11's `emptyStatement` checks `claim.allowed` first and immediately emits “No clashes found…” without requiring the separately displayed freshness to be current. A false clearance sentence can therefore be shown alongside a stale badge. A later host event may schedule another refresh, but the transient claim is already contrary to the fail-closed contract, and PR-OQ17 does not guarantee that every placement invalidation produces a Panel catalog event.
- **Minimum correction:** make claim rendering require a completed pair of reads and fail closed on either result: emit a clearance sentence only when `claim.allowed === true`, `freshness.state === 'current'`, and neither read is pending. Any disagreement renders the non-claim/stale wording. Add a T11 unit case for `allowed + stale` and a T17 controller case that resolves the two reads in the unsafe order. Keeping the two Core calls is acceptable if rendering uses the stricter conjunction.

#### H2 — The default repository test command is designed to stay green while the entire DockingPanel/UI suite can fail

- **Plan locations:** Global Constraints 11–12; PL-1; T27 `domIsolation.test.mjs`; T27–T33; T33 final gate.
- **Type:** verification / regression-gate defect.
- **Failure mode:** T27 deliberately asserts that `npm test` never discovers `*.dom.mjs` and never launches Chromium. T27–T33 manually run the separate DOM command at their own checkpoints, so those commits can be green during initial execution. After the milestone, however, the repository's normal/default verification command can report success while the accepted five-region DockingPanel shell, hostile-text controls, thin-view contract, or end-to-end composition is broken. There is no CI workflow or other persisted aggregate gate in the repository that closes this gap.
- **Minimum correction:** make one repository-standard aggregate command fail when either suite fails. The smallest direct correction is to retain `node scripts/run-tests.mjs` as the explicitly offline command, keep `test:clashpanel:dom`, and change the default `npm test` script after T27 to run **both** in sequence. Update `domIsolation.test.mjs`, T27–T33 checkpoints, the file-scope allowance, and T33's expected `package.json` diff accordingly. If the project instead chooses a new aggregate command, it must be the documented and mechanically enforced default gate—not an optional second command that future checkpoints may omit.

### Medium

#### M1 — G-OD blocks all implementation on three decisions that are safely package-scoped or reversible

- **Plan location:** owner-decision register / G-OD.
- **Type:** authorization-gate precision.
- **Issue:** G-OD says OD-1, OD-7, OD-10, OD-12, and OD-13 Part 2 must all be explicitly confirmed before T1. OD-1 controls every path and guard, and OD-7 controls observable replacement/residency semantics; those must be settled before authorizing the affected implementation. OD-10 is a local helper-placement choice whose recommended duplication stays inside the frozen scope; OD-13 Part 2 is one reversible display constant; OD-12's “not simultaneous” product policy does not affect the fake/headless packages and must be settled before host/live integration, not before T1.
- **Minimum correction:** split G-OD by affected package/task. Require OD-1 before T1 and OD-7 before controller work (or confirm both in the implementation authorization). Allow OD-10(a) and OD-13 Part 2(a) to stand as explicit plan defaults unless overridden before T23/T1 respectively. Carry OD-12 to H1/G2/G3, while still implementing the accepted isolation ownership guard in T24/T25.

### Low

#### L1 — Scratch execution counts are not independently reproducible from repository artifacts

The plan and internal review consistently record **358/358** non-DOM, a **137-case** ViewerBridge matrix, and **75/75** DOM. The 75 total also agrees with T33's per-file count arithmetic, and the 137 matrix is enumerated in T25. No scratch tree, raw output, manifest, or digest was persisted, so the historical executions themselves cannot be independently verified from disk. This is correctly classified as snippet-consistency evidence only, not implementation evidence. It does not block the plan because every task repeats its RED/GREEN and full-checkpoint commands during implementation.

#### L2 — Two gated-work paragraphs incorrectly use “already implemented”

G2 says the degradation contract is “already implemented in T23/T25/T26”, and H2 says the Panel-side stance is “already implemented”. T1–T33 have not started. Replace with “planned by” or “once T1–T33 are implemented”. The gates themselves remain effective; this is status wording only.

## Architecture and task-order assessment

Except for H1, T1–T33 preserve the accepted layering:

- `clashpanel/core` owns headless state and consumes a narrowed, read-only EnginePort; it never registers, repairs bindings, derives identity, or mutates Viewer state.
- `clashpanel/viewer` is the only Viewer-mutating layer; `clashpanel/ui` receives no Viewer reference. The DockingPanel is thin and reconstructs from the controller view-model.
- Markers-only v1 is enforced statically and dynamically; no theming API is planned. Soft availability fails closed through the host-supplied basis verdict, while Hard remains usable.
- The dependency order is implementation-safe: foundations T1–T7; run/result modules T8–T15; controller T16–T21; fake ViewerBridge T22–T26; browser UI T27–T33. T20/T21 are legitimate green contract/checkpoint commits rather than feature commits.
- Every task specifies a full offline checkpoint; T27–T33 also specify the DOM suite. H2 concerns the durable default regression gate after those checkpoints, not the initial per-task command list.

The prose-only internal-review coverage for T1–T10, T15, and T19–T21 was independently sampled against their embedded interfaces and tests. Nullable `RunSummary.resultSet`, stale bindings, saved-only retention, failed-release retry state, single-slot admission, and engine-draining disposal are explicitly handled and covered by T8/T9/T15/T16/T18/T20. No additional blocker was found in those areas. H1 is the one uncovered cross-task contradiction between T11 and T17.

## Gates and unauthorized dependencies

G1–G3 and H1–H2 are real stop gates for the current plan:

- They are outside T1–T33, contain no executable RED/GREEN steps, require separate owner authorization, and have explicit entry/exit evidence.
- T1–T33 use only fake/injected Viewer and synthetic/real-Core test worlds. They do not run SVF2, derive OQ-1 identity, register/re-register models, wire unload, modify static routes, register a toolbar extension, or edit `wwwroot/`/`server.js`.
- T31 builds only the thin DockingPanel adapter against a stub; T32 exports a composition seam and README contract. Neither performs toolbar or host integration.
- G1 gates model-format evidence; G2 gates live ViewerBridge/DockingPanel behavior; G3 gates the first full live Panel run; H1/H2 own host composition and unresolved identity/basis/placement policy.

No task incorrectly crosses the SVF2/OQ-1/host boundary. No Viewer Adapter or Core extension is required by this plan. A later live failure would require separate triage and authorization.

## Owner-decision disposition

| Decision | Required before implementation authorization? | Independent disposition |
|---|---:|---|
| **OD-1** code location | **Yes** | Foundational: fixes every path and the layering guard. Confirm top-level `clashpanel/` or revise the plan. |
| **OD-7** previous-result replacement | **Yes** | Observable data/residency behavior. Confirm replace/admission-first plus the explicit-discard single-slot exception, or revise T9/T16/T20. |
| **OD-10** marker helper | No | Duplication is internal, reversible, and remains within scope. Safe plan default; an extraction override must be separately planned because it touches the existing extension. |
| **OD-12** coexistence policy | Not for T1–T33 | The ownership guard is required regardless. Carry the simultaneous-use product policy to H1/G2/G3 before host/live integration. |
| **OD-13 Part 2** unit label | No | “scene units” is one reversible constant and is displayed only after basis verification. Safe plan default. |

## Acceptance verdict

The plan is **not ready for implementation authorization**. Required revisions:

1. close H1 with a fail-closed claim/freshness conjunction and regression tests;
2. close H2 with a mechanically enforced aggregate default test gate;
3. narrow G-OD as described in M1 while touching the authorization section.

After those bounded changes, a targeted re-review of T11/T17, T27/T33, G-OD, and their directly affected cross-references is sufficient. Do not restart a broad plan review.
