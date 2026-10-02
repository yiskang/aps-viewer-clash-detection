# For Claude — G2 Dual-Counter Gate Resolution Only

I explicitly authorize **one bounded gate-resolution task only** for the G2 harness.

This authorization is limited to resolving the already-reviewed H1 sequencing gate by changing:

`G2_DUAL_COUNTER_GATE.resolved = false`

to:

`G2_DUAL_COUNTER_GATE.resolved = true`

because the latest independent Work review accepted H1 as technically closed and confirmed the gate is technically ready to flip.

This authorization does **not** include:

- enabling `LIVE_PATH_WIRED`;
- live planning beyond recording the gate state;
- implementing the four Medium before-live hardening items;
- fixing Low findings;
- issuing an authorization record;
- running live G2;
- real-Viewer failure injection;
- production/Core/Viewer Adapter/M4/Panel changes;
- G3;
- H1/H2 host integration;
- OQ-1;
- host integration;
- unrelated cleanup;
- push, unless separately authorized.

Use repository state as the source of truth.

## 1. Verify baseline first

Before editing, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- expected HEAD:
  `0eb3115e915915f1791cd644042ab5a5e3eae151`
- `main == origin/main`
- working tree clean
- accepted procedure SHA unchanged
- H1 checkpoint is committed/pushed
- latest independent review states:
  - H1 technically closed
  - cleanup provenance fully closed
  - `G2_DUAL_COUNTER_GATE.resolved` technically ready to flip
- `LIVE_PATH_WIRED=false`
- no live G2 attempt/evidence exists
- no authorization record exists

Read:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- latest H1 targeted independent review
- current gate definition in the harness/tests

If baseline differs materially, stop and report.

## 2. Flip only the H1 sequencing gate

Change only the technical resolution flag:

`G2_DUAL_COUNTER_GATE.resolved = true`

Do not change `LIVE_PATH_WIRED`.

Do not change gate semantics, procedure semantics, or harness behavior beyond what is mechanically necessary to reflect the resolved state.

If tests or metadata require an expected-gate-state update, change only those directly coupled expectations.

## 3. Preserve unresolved before-live hardening

Do not implement or close the four Medium items:

1. finalize `eventLog` after the last transfer drain;
2. retain cleanup evidence after failed phase runs;
3. persist exact operation-refusal details;
4. broaden static protection against local authoritative counters.

These remain before-live-execution hardening.

Do not fix unrelated Low findings.

## 4. Handoff update

Update `docs/handoffs/latest.md` to record:

- `main == origin/main == 0eb3115...` before this task;
- the previous checkpoint was pushed;
- H1 technically closed;
- `G2_DUAL_COUNTER_GATE.resolved=true`;
- `LIVE_PATH_WIRED=false`;
- live planning may proceed only when separately authorized;
- live execution remains not ready;
- the four Medium before-live hardening items remain open;
- next authorized action: none / awaiting explicit owner authorization for before-live hardening.

This is also the appropriate place to remove the stale “not pushed” wording from the prior handoff.

## 5. Verification

Run only the minimal non-live checks needed to verify the gate-state change.

At minimum:

- targeted gate-state tests;
- focused G2 suite if the gate flag participates in those tests;
- `git diff --check`.

Do not run APS Viewer or live G2.

If changing the gate causes unexpected failures unrelated to the expected state transition, stop and report instead of broadening scope.

## 6. Commit

This task **does authorize one small gate-resolution commit**.

Stage only:

- the gate-state change;
- directly affected tests/metadata if needed;
- `docs/handoffs/latest.md`.

Do not include unrelated files.

Create one concise commit indicating:

- H1 sequencing gate resolved;
- live remains disabled.

After commit:

- require clean `git status`;
- report commit hash;
- report exact files committed;
- report tests run/results;
- report relation to `origin/main`.

Do **not push** unless separately authorized.

## Stop gate

Stop after the gate-resolution commit.

Do not:

- set `LIVE_PATH_WIRED=true`;
- start before-live hardening;
- start live planning execution work;
- issue an authorization record;
- run live G2;
- modify production/downstream code;
- push.

## Final report

Report:

- branch / HEAD before and after;
- gate-resolution commit hash;
- exact files committed;
- confirmation `G2_DUAL_COUNTER_GATE.resolved=true`;
- confirmation `LIVE_PATH_WIRED=false`;
- tests run/results;
- final `git status`;
- relation to `origin/main`;
- confirmation the four Medium before-live hardening items remain open;
- confirmation no live attempt/evidence or authorization record exists;
- confirmation nothing was pushed.
