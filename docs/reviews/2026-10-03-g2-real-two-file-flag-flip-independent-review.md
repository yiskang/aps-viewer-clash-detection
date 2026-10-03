# G2 real two-file flag flip — independent review

- **Date:** 2026-10-03
- **Baseline:** `main` = `origin/main` = `99029ff7be4ce4e2b502918a5ed975f73879f93e`
- **Scope:** uncommitted real activation diff, its single documentation-anchor restoration, directly affected tests/reviews/handoff, and activation-boundary safety
- **Verdict:** **0 Critical / 0 High / 0 Medium / 0 Low**
- **Readiness:** **ready for activation checkpoint commit/push**; authorization-record preparation and live execution remain separate, unauthorized gates

## Repository state and scope

The expected baseline is verified. The working tree before this review contained exactly:

- the two authorized implementation/test activation edits;
- one documentation-only plan-anchor restoration;
- the authorizing prompt, internal review, and handoff update.

There is no accepted-procedure diff and no change to production, Core, Viewer Adapter, M4, Panel, OQ-1, or host-integration code. No authorization record exists, the attempts directory is absent, and no Viewer/fixture/live-G2 evidence exists. Nothing after `99029ff…` has been committed or pushed.

The codebase-memory graph and direct source inspection agree on the relevant call chain. Coverage checks report no recorded issue for the harness, affected test, governing documents, or relevant activation/authorization/runtime-gate/preflight/journal/CLI/gate tests; direct source and test execution were used as the deciding evidence.

## Findings

### Critical

None.

### High

None.

### Medium

None.

### Low

None.

## 1. Exact activation diff — accepted

The implementation/test diff is exactly two files:

1. `test/acceptance/clashpanel-viewerbridge.acceptance.mjs`: the sole change is `const LIVE_PATH_WIRED = false;` to `true;`.
2. `test/acceptance/clashpanel-viewerbridge.acceptance.live-path-isolation.test.mjs`: only the single deliberate real-state pin changed—its title and both assertions now expect `true`.

No third implementation or test edit exists. Git change detection finds only those two code/test files plus documentation/review/prompt/handoff records.

## 2. Plan-anchor restoration — accepted

`docs/research/2026-10-02-g2-live-execution-plan.md` changes one paragraph lead from `Activation-preparation tests` back to `Required activation-preparation tests` while retaining `implemented in 7ae4147` and all following normative content.

This is documentation-only and restores the existing `T-same-target` plan/test anchor. It does not change runtime, authorization, attempt, verdict, or evidence semantics. Editing the test would have weakened an existing plan-contract guard and was unnecessary. No additional plan drift was introduced.

## 3. Independent non-live verification

All verification was run under exact Node `v22.23.1`:

- activation `11/11`; authorization `26/26`; preflight `7/7`; journal `35/35`;
- CLI `11/11`; gate `19/19`; runtime-gates `60/60`; live-path-isolation `11/11`;
- full focused G2: **903/903 pass**;
- aggregate offline: **5,149 total / 5,148 pass / 0 fail / 1 existing TODO**;
- `git diff --check`: clean.

The first restricted-sandbox focused run denied four tests permission to create their temporary mutation module in the repository. Re-running the identical suite with its normal temporary-file permission produced 903/903 and left no artifact. This was an execution-environment restriction, not a repository failure.

The suites use isolated temporary-root harness copies and fakes. They did not create a real authorization record or attempts directory, launch APS Viewer, load either fixture, run live G2, or escape their intended isolation.

## 4. Runtime envelope — accepted

The independently observed environment is:

- Node `v22.23.1`;
- `playwright` `1.62.1`;
- `playwright-core` `1.62.1`;
- `chromium-headless-shell` revision `1234`, browser version `151.0.7922.34`, with no revision override.

The runtime-gate tests retain strict rejection of Node mismatch/unavailability and the accepted Playwright/headless-shell fail-closed checks.

## 5. Missing-authorization refusal — accepted

With real `LIVE_PATH_WIRED=true`, live entry still requires the W0 triplet: `--execute-live-g2`, exact `G2_LIVE_AUTHORIZED=YES`, and an authorization-record path. If that triplet is supplied without a valid record, `validateAuthorizationRecord` rejects at W1 before runtime gates, directory establishment, reservation, `AUTH_BOUND`, browser import, Viewer access, or fixture access.

The activated-copy CLI test proves the missing-record path returns `record-not-found`, creates nothing, and remains confined to its isolated root. The real harness was not invoked.

## 6. Activation-boundary safety — accepted

The source order remains:

1. W0 activation parsing;
2. `LIVE_PATH_WIRED` and resolved dual-counter gates;
3. W1 authorization-record validation and startup scan;
4. hard runtime gates;
5. W2a directory establishment and W2b reservation/`AUTH_BOUND`;
6. only then post-reservation Phase 0 and the dynamic Playwright import.

No path bypasses W1 or reaches durable/runtime/live work without a valid record. The flag flip removes only the deliberate dormant gate; every later safeguard remains unchanged.

## 7. Identity verification

- **Activated harness SHA-256:** `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`
- **Accepted procedure SHA-256:** `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`

The recomputed harness digest matches the reported activated digest, and its change from the dormant digest is attributable to the single harness literal. No record binds it. Recompute the harness digest and HEAD after the activation checkpoint commit and after any intervening edit.

## 8. Internal-review quality — accepted as supporting evidence

The internal review's **0 Critical / 0 High / 0 Medium / 1 Low fixed** result is accurate in this bounded scope. The fixed Low was the plan-anchor regression. No unresolved Critical, High, Medium, or Low finding remains.

## 9. Preserved scope and contracts

The activation does not change the accepted procedure, authorization semantics, reservation/attempt semantics, runtime-gate behavior, cleanup/PARTIAL behavior, `T-same-target`, credential redaction, evidence schema, executable-SHA disposition, or any production subsystem. The only implementation/test changes are the two accepted activation edits.

## 10. Gate readiness

### Activation checkpoint

The working tree is ready for an **activation checkpoint commit and push**. That checkpoint may contain the exact two-file activation, the one plan-anchor restoration, and the directly associated prompt/review/handoff records. It must not contain an authorization record or attempt/live evidence.

### Authorization-record preparation after checkpoint

After the activation checkpoint is committed and pushed, the repository is technically ready to enter a separately owner-authorized authorization-record preparation/issuance gate. Required inputs are:

- clean committed `main == origin/main` and the final activation HEAD;
- recomputed activated harness SHA plus the unchanged accepted procedure SHA;
- exact Node `v22.23.1` and the accepted runtime/fixture identity bindings;
- a new unique, untracked authorization record under `docs/prompts/`, the sole non-superseded candidate, bound to the final HEAD and hashes;
- explicit owner authorization for record issuance.

No technical or product decision remains before that gate, but the owner authorization itself is mandatory.

### Live G2 boundary

Successful activation is not live-execution authorization. Before live G2: commit/push and independently verify the activated checkpoint; recompute final identities; separately prepare and issue the single-use record; recheck the clean-tree/runtime prerequisites; then obtain a separate owner authorization for exactly one live execution. Reservation, attempt consumption, Viewer launch, fixture load, and live G2 remain prohibited until that final authorization.

## Recommended next authorized action

Authorize one activation checkpoint commit and push containing the reviewed activation, plan-anchor restoration, prompt/review records, and updated handoff. Do not combine it with authorization-record issuance or live execution.
