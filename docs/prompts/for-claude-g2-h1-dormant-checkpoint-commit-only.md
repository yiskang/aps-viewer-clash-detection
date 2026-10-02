# For Claude — G2 H1 Dormant Checkpoint Commit Only

I explicitly authorize **one dormant checkpoint commit only** for the current reviewed H1 remediation state.

This authorization is limited to committing the current H1 remediation checkpoint exactly as reviewed by Work.

It does **not** authorize:

- flipping `G2_DUAL_COUNTER_GATE.resolved`;
- enabling `LIVE_PATH_WIRED`;
- starting live planning;
- authorization-record issuance;
- live G2 execution;
- real-Viewer failure injection;
- fixing the four Medium before-live hardening items;
- fixing unrelated Low findings;
- changing the accepted procedure;
- production/Core/Viewer Adapter/M4/Panel changes;
- G3;
- H1/H2 host integration;
- OQ-1;
- host integration;
- push, unless separately authorized.

Use the latest targeted independent Work review as the governing checkpoint review.

## 1. Verify baseline

Before staging anything, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- expected HEAD: `b33b7a94eaaefd4b3c7f097a4c743a5bb5abf80a`
- `main == origin/main`
- working tree contains only the current reviewed H1 remediation changes and related docs/reviews
- accepted procedure SHA unchanged
- `G2_DUAL_COUNTER_GATE.resolved=false`
- `LIVE_PATH_WIRED=false`
- no live G2 attempt/evidence exists
- no authorization record exists
- no production/Core/Viewer Adapter/M4/Panel/OQ-1/host files changed

Read:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- latest H1 internal review(s)
- `docs/reviews/2026-10-02-g2-cleanup-phase-transfer-stage-targeted-independent-rereview.md`
- current harness diff and changed tests

If baseline differs materially, stop and report.

## 2. Preserve the reviewed H1 state exactly

Do not fix or redesign anything in this task.

Preserve:

- single Node authoritative allocator;
- real Playwright binding test;
- authoritative Node fatal ledger;
- item 24 pending-response finalization;
- operation-refusal blocking;
- cleanup bidirectional provenance;
- cleanup phase/transfer-stage boundary logic;
- bounded 8-round cleanup stabilization;
- `G2_DUAL_COUNTER_GATE.resolved=false`;
- `LIVE_PATH_WIRED=false`.

Do not flip either gate.

## 3. Preserve remaining before-live hardening

Record these four Medium items as unresolved **before-live hardening**, not checkpoint blockers:

1. finalize `eventLog` after the last transfer drain;
2. retain cleanup evidence after failed phase runs;
3. persist exact operation-refusal details;
4. broaden static protection against local authoritative counters.

Do not fix them in this checkpoint task.

Preserve the remaining Low findings exactly as dispositioned in the independent review.

## 4. Offline verification

Before commit, rerun the reviewed non-live gates:

- focused G2 suite
- aggregate offline suite
- `npm run test:g2:binding`
- `git diff --check`

Expected reviewed baseline:

- focused G2: 693/693 PASS
- aggregate: 4938 PASS / 0 FAIL / 1 existing TODO
- Playwright binding: 8/8 PASS
- `git diff --check`: clean

If results differ materially, stop and report rather than fixing.

Do not run APS Viewer or live G2.

## 5. Handoff update

Update `docs/handoffs/latest.md` to record:

- H1 is technically closed;
- cleanup provenance is fully closed;
- `G2_DUAL_COUNTER_GATE.resolved=false` remains unchanged by owner choice;
- `LIVE_PATH_WIRED=false`;
- current checkpoint is dormant;
- live planning is technically unblocked but still unauthorized;
- live execution is not ready;
- the four Medium before-live hardening items remain open;
- remaining Low findings remain open/non-blocking as reviewed;
- next authorized action after this commit: none / awaiting explicit owner authorization for gate resolution and/or before-live hardening.

Keep the handoff concise and link to the authoritative independent review.

## 6. Pre-commit checks

Before committing:

- stage only the reviewed harness/tests/docs/reviews/handoff changes belonging to the H1 remediation;
- run `git diff --check`;
- confirm no production/Core/Viewer Adapter/M4/Panel/OQ-1/host files are staged;
- confirm `G2_DUAL_COUNTER_GATE.resolved=false`;
- confirm `LIVE_PATH_WIRED=false`;
- confirm no live attempt/result/evidence files exist;
- confirm no authorization record exists.

## 7. Commit

Create one concise dormant H1 checkpoint commit.

The commit message should make clear:

- H1 is technically closed;
- checkpoint is offline verified;
- both live gates remain false.

After commit:

- require clean `git status`;
- report the new commit hash;
- report exact committed files;
- report focused/aggregate/binding test results;
- report final branch / HEAD;
- report relation to `origin/main`.

Do **not push** unless separately authorized.

## Stop gate

Stop after the checkpoint commit.

Do not:

- flip `G2_DUAL_COUNTER_GATE.resolved`;
- enable `LIVE_PATH_WIRED`;
- start live planning;
- fix the four Medium hardening items;
- issue authorization records;
- run live G2;
- modify production/downstream code;
- push.

## Final report

Report:

- branch / HEAD before and after;
- checkpoint commit hash;
- exact files committed;
- offline test results;
- final `git status`;
- relation to `origin/main`;
- confirmation:
  - H1 technically closed
  - `G2_DUAL_COUNTER_GATE.resolved=false`
  - `LIVE_PATH_WIRED=false`
  - four Medium before-live hardening items remain open
  - no live attempt/evidence
  - no authorization record
  - nothing pushed
