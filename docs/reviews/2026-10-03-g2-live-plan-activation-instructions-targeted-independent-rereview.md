# G2 live-plan activation instructions correction — targeted independent re-review

- **Date:** 2026-10-03
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Baseline:** `main` = `origin/main` = `7ae4147b726e20b8183f0522ffabf61ab75895d6`
- **Scope:** only the documentation-only activation-instructions correction and its directly affected plan/handoff cross-references
- **Result:** **0 Critical / 0 High / 1 Medium / 2 Low**
- **Verdict:** the exact two-edit migration, G-2 correction, CLI-isolation correction, vendor setup, and Node prerequisite are sound. The plan is not yet ready to authorize the flip because §9 step 0 and its G-7/G-8/G-9/§12 cross-references still describe already-completed activation-preparation work as pending.

## Verified repository and authorization state

The repository is on `main` at `7ae4147b726e20b8183f0522ffabf61ab75895d6`; `origin/main` resolves to the same commit. Tracked changes are documentation-only (`docs/research/2026-10-02-g2-live-execution-plan.md` and `docs/handoffs/latest.md`), with the disclosed untracked prompt/review artifacts.

| Item | Verified value |
| --- | --- |
| Harness SHA-256 | `d34d470cf51f5f74c5cf3cfa8380944822af2ce6c2e07d27f4117ea71fd19c39` |
| Procedure SHA-256 | `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75` |
| Dual-counter gate | `G2_DUAL_COUNTER_GATE.resolved=true` at harness line 3716 |
| Live gate | `LIVE_PATH_WIRED=false` at harness line 119 |
| Live state | no authorization record, attempt/reservation state, Viewer/fixture load, or live-G2 evidence found |

No harness, test, procedure, runtime gate, `T-same-target`, cleanup/PARTIAL, authorization, evidence-schema, executable-SHA, or attempt/reservation implementation changed.

## Findings

### Critical

None.

### High

None.

### Medium

#### M1 — §9 still requires already-completed activation-preparation implementation

The corrected §9 now says the real activation is “exactly two repository edits,” but its immediately preceding step 0 still instructs a future implementer to:

- implement the G-8 cleanup/PARTIAL conformance fix;
- implement the hard Node/Playwright/headless-shell runtime gates;
- implement `T-same-target` tests; and
- independently review and rebind that work.

Those items are already present and independently accepted in committed checkpoint `7ae4147`:

- `runCleanup` makes missing/throwing ownership probes indeterminate and fail-closed through `cleanupUnresolvedOwnership=true`;
- the G-8 cleanup tests exercise timeout, throw, indeterminate, unresolved, and resolved/PARTIAL-eligible cases;
- `main()` invokes `checkG2HardRuntimeGates` after W1 and before W2a/reservation/import;
- runtime tests exercise exact Node/Playwright/headless-shell gates and the `T-same-target` registry oracle.

The contradiction is repeated in directly affected plan text:

- §3/§3.1 says the gates are “currently recorded only” and “NOT implemented”;
- §8 says the dormant harness still has the G-8 defect;
- G-7 says conformance has not landed;
- G-8 remains a High pending implementation;
- G-9 says the dormant harness does not enforce the gates; and
- §12 says G-8/runtime-gate implementation remains a prerequisite.

This is not merely historical context: these are current, normative prerequisites inside the operator-facing activation plan. They conflict with both the actual committed harness and the new “exactly two edits” instruction, and could cause an implementer to reopen accepted code before activation.

**Minimum correction:** mark §9 step 0 as satisfied by the committed `7ae4147` activation-preparation checkpoint and its accepted reviews; reconcile only its directly coupled §3/§3.1, §8, G-7/G-8/G-9/G-14, and §12 wording from pending to closed/current. Preserve residual limitations such as G-7's timeout-plumbing Low and G-14's fail-safe harness/procedure differences without restating the closed G-8 defect. Do not change the harness, tests, or procedure.

This remains a documentation/governance blocker to authorizing the real flip, not an implementation defect.

### Low

#### L1 — the `g2-live-authorization.md` filename prohibition is no longer technically supported

The untracked-record and sole-live-candidate requirements remain supported:

- the clean-tree policy permits the untracked `docs/prompts/` exception; and
- W1 enumerates authorization candidates and requires exactly one non-superseded candidate matching the passed record.

The filename itself has no production semantic. Current tests use `g2-live-authorization.md` only inside isolated temporary roots, explicitly refuse real-harness/repository access, and never scan or execute against the real repository. Removing the old “do not run npm test while a record exists” warning is therefore correct. Retaining “must not be named `g2-live-authorization.md`” is an unsupported conservative restriction, not a live-safety control.

Minimum docs correction: remove the filename prohibition and downgrade G-15 to closed/informational. Keep the untracked and sole-candidate requirements under their actual clean-tree/W1 rationale.

#### L2 — the source-reference convention mixes baselines

The new symbol-first references—`const LIVE_PATH_WIRED` and `const G2_DUAL_COUNTER_GATE`, followed by “line at `7ae4147`”—are acceptable and cannot misdirect the activation operator. However, the plan header still says H line references are at `996305c`, while the new references explicitly use `7ae4147`. This is low-risk because each changed reference states its commit and the symbol is authoritative, but the next docs pass should say that H references default to the stated baseline unless individually commit-qualified, or remove the global line-reference claim.

## Targeted verdicts

### §9 activation instructions

**Partially accepted.** Steps 1–2 correctly define exactly two edits:

1. change the harness `LIVE_PATH_WIRED` literal from `false` to `true`;
2. change the single deliberate real-state pin/title/assertions in `clashpanel-viewerbridge.acceptance.live-path-isolation.test.mjs` to `true`.

The prior roughly-20-suite migration is correctly withdrawn, the independently reviewed scratch simulation supports the two-edit diff, and current helper/test architecture implies no third source/test migration. Section 9 is not internally complete until M1's stale step 0 is reconciled.

### G-2

**Accepted.** The disproved test-fallout claim is removed. The residual committed-harness requirement is real: W1 binds the record to `Baseline-HEAD` and `Harness-SHA256`, while Phase 0 rechecks the clean committed identity. G-2 is factually aligned with current behavior.

### G-15

**Partially accepted.** Withdrawal of the real-harness CLI hazard and removal of the `npm test` warning are correct. The CLI runner targets only isolated copies, rejects any real-repository target, and traps browser-package resolution. The untracked and sole-candidate precautions remain valid for independent reasons. The filename prohibition is unsupported and should be removed as L1.

### Source references

**Operationally adequate, with L2.** `H:119` and `H:3716` are correct at `7ae4147`; no `H:118`/`H:3463` remains in current governing instructions. Symbol names should remain primary. Commit-qualified line references are acceptable diagnostics but should not be the only locator.

### `build:vendor`

**Accepted.** `wwwroot/vendor` is generated/ignored and absent from `git archive HEAD`. `npm run build:vendor` copies already-installed local dependencies; `npm test` invokes it through `pretest`, while direct `node scripts/run-tests.mjs` does not. The plan correctly treats it only as fresh-archive/scratch test setup—not an activation implementation, authorization, runtime, or live-G2 prerequisite.

### Node prerequisite

**Accepted.** The plan explicitly warns that a fresh shell may select Homebrew Node `v26.10.0`, requires `nvm use 22.23.1` followed by exact `node -v` verification, and retains the in-harness strict `v22.23.1` gate before W2a/reservation/import. This is sufficiently explicit for future operator use.

### Historical handoff

**Accepted unchanged.** Older sections are clearly headed `PRIOR STATE (superseded)` and remain useful historical records. Their old roughly-20-pin statement cannot reasonably outrank the corrected top handoff and governing plan. Rewriting them would reduce provenance and is unnecessary.

### Scope discipline

**Accepted.** The correction is documentation-only. Harness and procedure hashes are unchanged. Repository/source inspection found no semantic or schema change and no live side effect.

## Readiness and sequencing

- **Real two-file flip:** technically verified, but **not yet ready for owner authorization** because M1 remains in the governing plan.
- **More scratch verification:** not required; the existing exact two-edit simulation covers this boundary.
- **Implementation correction:** not required.
- **Documentation checkpoint:** not ready until M1 is corrected; L1/L2 should be folded into the same bounded pass.
- **Authorization record/live G2:** not ready and unauthorized.

The cleanest transition remains a docs-only checkpoint **before** the source flip. Amend the plan, internal review disposition if needed, this review chain, and current handoff; independently confirm the bounded correction; then commit/push that documentation baseline. The real two-file activation remains a separate later owner authorization, review, verification, commit, and push boundary.

## Exact next action

No further action is authorized by this review. The recommended next owner authorization is one bounded docs-only correction of M1/L1/L2 and directly affected handoff/review wording. Do not change the harness/tests/procedure, flip the live flag, issue a record, reserve/consume an attempt, launch Viewer/fixtures, run live G2, commit, or push under that authorization unless separately stated.
