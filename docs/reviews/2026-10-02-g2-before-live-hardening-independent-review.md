# G2 Before-Live Hardening — Independent Review (2026-10-02)

## Verdict

The normal run-transfer, operation-refusal, and sequence-source hardening is sound, and the previously closed H1 sequencing/provenance work has not regressed. The failed-phase path is not yet live-ready: it cannot produce the procedure-required schema-valid committed R1/K evidence set, and it loses earlier phase-marker/error detail on some failure paths.

**Findings:** 0 Critical / 1 High / 1 Medium / 2 Low.

The dormant working tree is not ready to be labeled a completed before-live checkpoint, is not ready for live planning/authorization binding, and must not be activated. A partial checkpoint would be mechanically safe only if explicitly labeled as blocked; the minimum recommended path is the bounded failed-run evidence correction first.

## Verified repository state

- Repository: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- Branch / HEAD: `main` @ `c0f877aee82c078564efdb504bcbe695522b4ed4`
- `origin/main`: the same commit.
- Accepted procedure SHA-256: `5f9c4c7e124751d09406f07eab63f844fec53add006bd12ad676ecaca3732abb` (unchanged).
- `G2_DUAL_COUNTER_GATE.resolved=true`; `LIVE_PATH_WIRED=false`.
- No G2 live evidence file exists under `docs/research/evidence/`; no live attempt was run in this review.
- Working-tree changes remain limited to the dormant G2 harness/tests plus documentation/prompts. No procedure, production, Core, Adapter, M4, Panel production, OQ-1, or host-integration change was found.

The required codebase-memory coverage check reported no recorded issue for every relied-on path. Because that signal is best-effort, changed and untracked source/tests were also read directly.

## Findings

### High B1 — failed phase runs cannot produce the procedure-required committed R1/K evidence set

**Where:** `applyPhaseRunFailureToState` in `test/acceptance/clashpanel-viewerbridge.acceptance.mjs`; the full-flow assertions around `phase-run-threw` in `test/acceptance/clashpanel-viewerbridge.acceptance.mainflow.test.mjs`; procedure §§8, 9.1, and 10.

After a page phase throws, `applyPhaseRunFailureToState` correctly replaces checks with `BLOCKED(phase-run-threw)`, taints the session, and prevents PASS. However, it leaves `gates.C1` absent and installs not-started control placeholders that do not satisfy the R1 schema. The closeout test confirms that R1 verification therefore fails with `r1-verify`; R1 is renamed to a diagnostic `R1.invalid-*` file, and no valid R3/K evidence set is committed.

That is fail-safe for the verdict, but it contradicts the accepted procedure's closeout contract. The procedure requires R1/R2/R3/J/K as the authoritative evidence set when closeout succeeds, specifies that `finalOverall = primaryOverall` after successful closeout even when the primary result is non-PASS, and identifies K as the sole verdict-authoritative artifact. An invalid diagnostic R1 plus commit-missing FAIL is not equivalent to a committed, schema-valid record of the primary failed run.

**Impact:** no false PASS is possible, but an ordinary primary execution failure is converted into a closeout failure and loses the procedure's authoritative, independently auditable evidence set. This blocks live execution and any final live authorization binding.

**Minimum correction:** perform a bounded procedure/harness reconciliation that defines a schema-valid failed-phase R1 representation, preserves the primary failure and cleanup evidence, and permits R2/R3/K closeout without weakening R1 validation or making an invalidated R1 authoritative. This likely needs explicit owner authorization because the current procedure does not define this failed-run record shape.

### Medium F1 — failed-phase transfer loses earlier markers and exact error fidelity on the untransferable branch

**Where:** `g2RunPhases` returns `markers: [failureMarker]`; `g2EnterCleanupAfterFailure`; the `runOut.status === 'threw'` fallback in the Node flow.

When the phase runner throws but the final transfer succeeds, only the newly created cleanup marker is returned. Earlier P1…Pn markers are lost. If the runner had already allocated its own cleanup marker before a refused fence, the new marker can also move the cleanup boundary and conservatively add `cleanup-event-before-boundary`. The outcome is already FAIL, so verdict correctness and PASS safety are unaffected, but cancellation-window reconstruction and the retained timeline are degraded.

If cleanup entry/final transfer itself cannot be returned, the original exception remains the thrown exception in the page realm, but the Node fallback records only generic `phase-run-threw`; it does not durably retain the exact `runOut.error`. This does not cause false PASS, but it falls short of the requested "original failure remains authoritative" evidence property.

**Disposition:** required before live execution and best corrected in the same bounded pass as B1. Preserve accumulated markers/error data on the thrown path, reuse an already-created cleanup marker, and add a boundary test with an event between the two current marker positions. It does not reopen the normal PASS architecture.

### Low L1 — sequence static guards remain bypassable by deliberate indirection

The s0–s4 guards meaningfully reject the four authorized mutation classes: ignored injected `nextSeq`, direct local authoritative increments, a second allocator-shaped helper, and composite local ordering. A deliberately indirect local counter or delegated comparator can evade token/AST pattern checks.

This is acceptable for live readiness because runtime allocation/provenance checks remain authoritative. The `createCallRecorder|seqCounter` allowlist is count-limited to one legacy offline fallback, while live/page recorders receive the injected source. No broad allowance was found.

### Low L2 — page-only operation-begin failures do not add a duplicate Node fatal

For `begin-threw`, malformed response, empty operation id, or missing binding, the action is blocked before invocation; the durable `operation-begin-refused` event retains bounded detail; the check becomes `BLOCKED(harness-exception:P9)` and the session is tainted. A separate Node fatal is not added.

This cannot produce PASS and is evidence-detail duplication, not verdict loss. It is acceptable as implemented. Explicit Node refusal still produces exactly one Node violation.

## Hardening-item adjudication

| Item | Result | Reason |
| --- | --- | --- |
| Final eventLog transfer | **Closed** | `g2FinalizeRunTransfer` drains to bounded stability, then snapshots eventLog/spy/state/high-water synchronously. Non-stabilization throws. No final-drain event can be omitted without refusal. |
| Failed-phase cleanup | **Partially closed** | Cleanup is attempted, page verdicts are ignored, primary FAIL cannot become PASS, and cleanup problems add detail; B1 and F1 prevent live-ready durable closeout. |
| Operation-refusal detail | **Closed** | Category, realm, reason, operation fields, bounded response/error, time, and Node sequence are retained; the action remains blocked and explicit refusal remains one violation. |
| Static guards | **Closed for the authorized scope** | s0–s4 and mutations cover the named hazards; indirection is a documented Low with runtime backstops. |

All four before-live items are therefore **not collectively closed**.

## Regression and test verification

- Focused G2: **731/731 PASS**.
- Aggregate offline: **4,977 total / 4,976 pass / 0 fail / 1 existing todo**. An initial sandboxed run hit environment-only loopback permission failures; the permitted local rerun passed and did not change files.
- Real Playwright binding: **8/8 PASS** (the first sandboxed launch was denied by macOS IPC permissions; the permitted rerun passed).
- `git diff --check`: clean.
- New tests are non-vacuous for final-transfer draining, failed-phase cleanup, refusal-detail classes, and the four static-guard mutation families.
- No regression found in the prior H1 closure, dual-counter resolution, the single Node allocator, binding acknowledgment/refusal, cleanup provenance, operation blocking, item-24 finalization, C15(e), the C1 gate, request-witness counting, or ordinary K closeout.

## Readiness and authorization

- **Previously closed H1:** remains closed; this review found no sequencing/provenance regression.
- **Checkpoint commit:** not ready as a completed before-live checkpoint. A separately authorized partial/dormant snapshot would be safe only if it explicitly retains B1/F1 as blockers.
- **Live planning:** not ready for operational planning, digest binding, or authorization-record issuance because the failed-run evidence contract still requires a code/procedure decision.
- **Live execution:** not ready. After the bounded correction and targeted re-review, the tree must be committed/clean, hashes recomputed, authorization issued, and only then may activation be considered.
- **Current authorization:** only this review and handoff update were authorized. Harness/procedure edits, commit, push, gate changes, authorization-record issuance, and live G2 remain unauthorized.

## Exact next action

Obtain explicit owner authorization for one bounded procedure/harness reconciliation of failed-run R1/K closeout plus marker/error retention, followed by a targeted independent re-review.
