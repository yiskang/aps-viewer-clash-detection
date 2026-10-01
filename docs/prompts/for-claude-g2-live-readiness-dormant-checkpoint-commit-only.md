# For Claude — G2 Live-Readiness Dormant Checkpoint Commit Only

I explicitly authorize **one dormant checkpoint commit only** for the current G2 live-readiness remediation state.

This authorization is limited to committing the already-reviewed, offline-verified remediation checkpoint exactly as it stands.

It does **not** authorize:

- further remediation;
- changing H1 sequencing;
- flipping `G2_DUAL_COUNTER_GATE.resolved`;
- adding the real Playwright binding test;
- enabling `LIVE_PATH_WIRED`;
- live planning;
- authorization-record issuance;
- live G2 execution;
- real-Viewer failure injection;
- G3;
- H1/H2 host integration;
- OQ-1;
- host integration;
- production/Core/Viewer Adapter/M4/Panel changes;
- push, unless separately authorized.

Use the latest independent Work review of the G2 live-readiness remediation as the governing checkpoint review.

## 1. Verify baseline

Before staging anything, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- expected HEAD: `d07dea0045a07c3f748618f4f959195f4346db89`
- `main == origin/main`
- working tree contains only the current G2 live-readiness remediation changes and related docs/reviews
- accepted procedure SHA-256:
  `5f9c4c7e124751d09406f07eab63f844fec53add006bd12ad676ecaca3732abb`
- `LIVE_PATH_WIRED=false`
- `G2_DUAL_COUNTER_GATE.resolved=false`
- no live G2 attempt/evidence exists
- no production/Core/Viewer Adapter/M4/Panel/OQ-1/host files changed

Read:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- `docs/reviews/2026-10-01-g2-live-readiness-remediation-internal-review.md`
- `docs/reviews/2026-10-01-g2-live-readiness-remediation-independent-review.md`
- current harness diff and changed tests

If baseline differs materially, stop and report.

## 2. Preserve the reviewed remediation exactly

Do not fix or redesign anything in this task.

Preserve:

- authoritative Node fatal ledger;
- item 24 pending-response finalization integrated with that ledger;
- current composite Node/page sequence namespace;
- current phase-attribution implementation;
- fixed `requestfinished` capture behavior;
- current test coverage;
- `LIVE_PATH_WIRED=false`;
- `G2_DUAL_COUNTER_GATE.resolved=false`.

Do not modify H1 sequencing.

## 3. Preserve unresolved live-readiness findings

Record these as unresolved and **not checkpoint blockers**.

### High — H1 sequencing contract mismatch

Latest independent Work disposition:

- composite namespace is collision-free and fail-closed;
- ordering is authoritative only at synchronization fences;
- accepted procedure requires the single Node-side counter/allocator contract;
- H1 is therefore not fully closed.

Do not fix it in this checkpoint.

### Medium — real Playwright binding scheduling gap

A local/non-APS Playwright integration test is still required before resolving the dual-counter gate.

Do not implement it in this checkpoint.

### Low findings

Preserve:

- active-control phase validation;
- teardown C-e cleanup-marker proxy;
- C15(e) FAIL routing;
- `T_iso` evidence authority.

Do not fix them in this checkpoint.

## 4. Gate state

The handoff and checkpoint must explicitly preserve:

- `LIVE_PATH_WIRED=false`
- `G2_DUAL_COUNTER_GATE.resolved=false`
- live planning: not ready
- live execution: unauthorized

Do not flip either gate.

## 5. Offline verification

Before commit, rerun:

- focused G2 suite
- aggregate offline suite
- `git diff --check`

Expected reviewed baseline:

- focused G2: 542/542 PASS
- aggregate: 4788 total / 4787 PASS / 0 FAIL / 1 existing TODO
- `git diff --check`: clean

If results differ materially, stop and report instead of fixing.

Do not run Playwright live acceptance.
Do not load APS Viewer or any G2 fixture.

## 6. Handoff update

Update `docs/handoffs/latest.md` to record:

- current remediation checkpoint committed/dormant;
- H2 fully closed;
- item 24 fully integrated;
- H1 still unresolved because implementation does not yet satisfy the accepted single Node-side allocator contract;
- real Playwright binding scheduling test still required;
- `G2_DUAL_COUNTER_GATE.resolved=false`;
- `LIVE_PATH_WIRED=false`;
- four Low findings still open;
- live planning not ready;
- live execution unauthorized;
- next authorized action: none / awaiting explicit owner authorization for bounded H1 live-readiness remediation.

Keep the handoff concise and link to the independent review.

## 7. Pre-commit checks

Before committing:

- stage only authorized G2 harness/test/docs/review/handoff files from this remediation;
- run `git diff --check`;
- confirm no production/Core/Viewer Adapter/M4/Panel/OQ-1/host files are staged;
- confirm both live gates remain false;
- confirm no live attempt/result/evidence files exist;
- confirm no authorization record exists.

## 8. Commit

Create one concise dormant live-readiness checkpoint commit.

The commit message should make clear that:

- remediation is offline verified;
- live remains disabled;
- H1 remains unresolved.

After commit:

- require clean `git status`;
- report commit hash;
- report exact committed files;
- report final branch / HEAD;
- report relation to `origin/main`;
- report offline test results.

Do **not push** unless separately authorized.

## Stop gate

Stop after the checkpoint commit.

Do not:

- remediate H1;
- add the Playwright binding test;
- flip `G2_DUAL_COUNTER_GATE.resolved`;
- enable `LIVE_PATH_WIRED`;
- start live planning;
- issue authorization records;
- run live G2;
- modify production code;
- push.

## Final report

Report:

- branch / HEAD before and after;
- checkpoint commit hash;
- exact files committed;
- focused and aggregate offline test results;
- final `git status`;
- relation to `origin/main`;
- confirmation:
  - `LIVE_PATH_WIRED=false`
  - `G2_DUAL_COUNTER_GATE.resolved=false`
  - no live attempt/evidence
  - no authorization record
  - H1 unresolved
  - real Playwright test still pending
  - nothing pushed
