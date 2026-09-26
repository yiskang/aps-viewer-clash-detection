# Viewer Clash Panel implementation plan — internal check of the remediation of the independent Work review

- **Date:** 2026-09-26
- **Plan:** `docs/superpowers/plans/2026-09-26-viewer-clash-panel-implementation-plan.md`
- **Governing input:** `docs/reviews/2026-09-26-viewer-clash-panel-implementation-plan-independent-review.md` (verdict *revise before implementation authorization*; 0 Critical / 2 High / 1 Medium / 2 Low)
- **Nature:** an internal convergence check, **not** an independent gate. Bounded to the changed areas and their directly affected invariants; no broad whole-plan review was run.
- **Repository state:** `main` @ `6a55b5040369d07b67f09fe31153c55eadf5694f`; nothing committed or pushed; no `clashpanel/` exists; no Core, Viewer Adapter, M4, `collision/`, `wwwroot/`, `server.js` or `package.json` change.

## What was remediated

| Finding | Where | Closure |
|---|---|---|
| **H1** allowed claim beside stale freshness | T11 `emptyStatement`; T17 `recheckFreshness`/`startFreshnessCheck`; T19 `claimGateOf` | Clearance wording only for `claim.allowed === true` ∧ `freshness.state === 'current'` over ONE pair. T11 owns the pure gate; T17 commits `freshness`+`claim` together only after both reads of the same check completed and withdraws the held claim synchronously when a re-check starts; the view-model (`claimGateOf`, T17/T19) hands the statement only a settled pair. Core unchanged. |
| **H2** default gate skips the DOM suite | Global Constraints 1/11/12/13, PL-1, file structure, T27, T28–T32 checkpoints, T32 README, T33 | `npm test` = `npm run test:offline && npm run test:clashpanel:dom`; `test:offline` = the old `node scripts/run-tests.mjs`; `domIsolation.test.mjs` guards the wiring and forbids recursion (script-graph walk + runners spawn only `process.execPath`); T33 runs `npm test` with negative controls. |
| **M1** G-OD | Owner-decision register, G-OD, tier table | Only OD-1 and OD-7 block implementation authorization; OD-10(a) and OD-13 Part 2(a) are safe reversible plan defaults; OD-12 is carried to H1/G2/G3. OD-1/OD-7 are not resolved; their alternatives are quoted in the register. |
| **L1** scratch evidence | Verification log | Recorded as plan/snippet-consistency evidence only; not independently replayable; not implementation evidence. |
| **L2** "already implemented" | G2, H2, OD-14 row | Future/planned wording. |

## Scratch verification (outside the repo; snippet consistency only — same caveat as the plan's verification log, not replayable)

- **H1:** the new claim-gate tests (T11 matrix ×1, T17 ×4, T19 ×1) fail against the pre-remediation `runReport.js`/`controller.js`/`viewModel.js` and pass against the remediated text. Core + support scratch suite: 346/346.
- **H2:** in a scratch package with the real `scripts/run-tests.mjs`, the T27 `scripts/run-dom-tests.mjs`, harness/stub/mount and the new `domIsolation.test.mjs`: `npm test` ran offline 5/5 then DOM 7/7 with exactly two `# tests` lines (exit 0); the old wiring fails the two new guard tests (RED); a false DOM assertion makes `npm test` exit 1 with the offline half green; a missing Chromium makes `npm test` exit 1 after the offline half; a `test:offline → npm test` cycle is caught by the recursion guard.
- All code blocks extracted from the final plan text pass `node --check`.

## Targeted Codex review (`codex-review code`, medium; request `20260926-210004-53961-28980`)

Verdict: **ready after minor remediation; 0 Critical / 0 High / 2 Medium.**

| # | Finding | Disposition |
|---|---|---|
| 1 (Medium) | Every freshness re-check registered an abort listener on the generation-level signal that only a generation abort removed — unbounded growth in a long-lived panel. (The registration pre-dated this remediation; the new check code inherited it.) | **Accepted, fixed.** Each check removes its listener when its reads settle or a newer check supersedes it (`freshDetach`, `outstanding` counter). New T17 test counts net listeners on the pre-burst signals over 40 completed and 40 superseded re-checks; it fails against a controller with a no-op detach. |
| 2 (Medium) | No controller-level test for a **rejected `getFreshness`** read (claim allowed + freshness read failed). | **Accepted, fixed.** New T17 test: claim `ALLOWED` + rejected freshness ⇒ `empty-nonclaim`, `unverifiable` badge (not pending), no `empty-claim` ever published; a non-empty-set case asserts the same badge. It fails if the failed read never lands. |

Positive observations recorded by the reviewer: atomic pair commit and claim withdrawal are coherent; `claimGateOf` + `emptyStatement` are two fail-closed layers; `npm test` runs both suites without a script cycle and a missing Chromium fails the gate; G-OD blocks only on OD-1/OD-7; scratch evidence is labelled and gated work uses future-tense wording.

The two Medium fixes were verified by reading and by the scratch runs above, not by a second Codex pass (convergence rule: the fixes are local to the changed area and each has a RED/GREEN test).

## Residuals (classified, none blocking)

- **PR-OQ17 placement invalidation** not reaching the Panel remains a host gate (H1/H2/G3): the Panel cannot re-check what it is never told about. *Product/integration decision.*
- **Default gate needs Chromium** (`npx playwright install chromium`): recorded as an owner-visible consequence of H2; the older "plain `npm test` never needs a browser" prose in `test/README.md` / `test/acceptance/README.md` is outside the plan's edit scope and noted, not changed. *Deferred/non-goal for this plan; handoff-time note.*
- **Wall-clock/CI cost of running Chromium in `npm test`** unmeasured (PG-3 class item; no wall-clock assertion anywhere). *Verification/calibration gate.*

## Not authorized

Implementation (T1–T33), a Panel branch, any `clashpanel/` or `test/clashpanel/` file, SVF2 live verification (G1–G3), OQ-1/host integration (H1, H2), changes to Core/Adapter/M4, another milestone, committing or pushing. Next: independent Work re-review of the changed plan sections, plus owner decisions OD-1 and OD-7.

---

## Final bounded remediation (after the bounded independent re-review; 2026-09-26)

Governing input: `docs/reviews/2026-09-26-viewer-clash-panel-implementation-plan-remediation-bounded-independent-rereview.md` (0 Critical / 0 High / 1 Medium / 0 Low: T27 changed the default test prerequisite but left `test/README.md` and `test/acceptance/README.md` stale) plus the owner's approval of **OD-1(a)** and **OD-7(a)**. Plan documentation only; no repository file outside `docs/` changed; nothing committed.

### Changes
- **T27** now lists `test/README.md` and `test/acceptance/README.md` in its Modify list, Scope note, Step 3 (exact planned diffs), Step 4 (documentation check) and commit boundary; `domIsolation.test.mjs` gains two `docs:` guard tests (5 → 7 tests) plus negative assertions. **T33** Step 2 count (7) and Step 5 scope check (both READMEs allowed; `docs/` narrowed to `handoffs|reviews|research`; frozen specs/plans must be untouched; README hunks reviewed against T27 Step 3). Global Constraints 1/11, Findings 8, the file-structure block and the remediation table were updated.
- **OD-1(a) / OD-7(a)** recorded as owner-approved in the plan header, tier table, register legend and rows, G-OD (now *satisfied*, no implementation-blocking decision), file structure and authorization boundary; the OD-7 exception (confirmed discard under single-slot admission, per T9/T16) is part of the approved decision. OD-10(a) and OD-13 Part 2(a) stay safe reversible defaults; OD-12 stays deferred to H1/G2/G3.

### Targeted Codex check (`codex-review spec`, medium; request `20260926-223415-39110-28865`) — bounded slice only
**0 Critical / 0 High / 3 Medium**, all false-positive-acceptance risks, all accepted and fixed:
1. T33 allowed every path under `docs/`, so a frozen spec/plan edit could pass → allowlist narrowed to `docs/(handoffs|reviews|research)/` plus an explicit `git diff --quiet … docs/superpowers/specs docs/superpowers/plans` check.
2. The `pretest` assertion (`!/dom/`) did not prove `pretest` unchanged → now `assert.equal(scripts.pretest, 'npm run build:vendor')`.
3. README guards were presence-only → negative guards added (only one "included in `npm test`" statement; every "part of `npm test`" in the acceptance README must be negated); T33 requires the full README diff reviewed hunk-for-hunk against T27 Step 3 (not counts).
Reviewer's positives: OD-1(a)/OD-7(a) consistent everywhere with no stale unresolved wording; T27 file list, verification and commit contents include both READMEs; README text correctly separates the fake-based Panel DOM suite from the live scripts and matches the repository (named live scripts exist and are outside `npm test`).

### Scratch verification (outside the repo; snippet consistency only, not replayable)
The planned README edits were applied to scratch copies of the real READMEs; with the plan's `domIsolation.test.mjs`, `npm test` in a scratch package ran offline 7/7 then DOM 7/7 (exit 0). The `docs:` guards fail on the unedited READMEs, on a mutation that drops the preserved T3 "Not part of `npm test`" bullet, and on an appended "live acceptance scripts are part of `npm test`"; the wiring guard fails when `pretest` is removed. All code blocks extracted from the plan pass `node --check`.

### Not authorized
Implementation (T1–T33), a Panel branch, any `clashpanel/` or `test/clashpanel/` file, editing the READMEs now (planned for T27 only), SVF2 verification, OQ-1/host integration, Core/Adapter/M4 changes, another milestone, committing or pushing. Next: final bounded independent Work re-review.
