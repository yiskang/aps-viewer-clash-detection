# For Claude — Authorize Mechanical Fixture Switch Only

I explicitly authorize **only the G1 fixture switch** to the independently accepted Mechanical model.

This authorization does **not** include any live F1–F8 execution.

## Baseline

Before changing anything, verify:

- branch: `main`
- local `main` = `origin/main`
- expected baseline HEAD: `d501edd`
- working tree is clean
- `Audubon_Mechanical_clash_test.rvt` is recorded as the accepted next G1 fixture
- `Audubon_Structure_clash_test.rvt` remains the documented fallback
- live F1–F8 remains unauthorized

If repository state materially differs, stop and report.

## Authorized change

Change only the G1 harness fixture selection / `MODEL_URN` configuration needed so that the next G1 run will use:

`Audubon_Mechanical_clash_test.rvt`

Use the already-screened existing model/URN from the committed fixture-screening evidence.

Do not:
- change Viewer version;
- change `env` / `api`;
- change production Viewer initialization;
- change G1 semantics;
- change any accepted limits;
- upload or retranslate a model;
- modify Core, Viewer Adapter, M4, Viewer Clash Panel production code, OQ-1, or host integration;
- run F1–F8.

## Verification

After the fixture switch:

1. Verify the configured URN/model corresponds exactly to the accepted Mechanical fixture.
2. Verify the fallback Structure fixture is not made active accidentally.
3. Run only non-live/static/offline checks needed to prove the configuration change is wired correctly.
4. Do not launch the real APS/Viewer F1–F8 execution.
5. Update `docs/handoffs/latest.md` to record:
   - Mechanical is now configured as the next G1 fixture;
   - Structure remains fallback;
   - live F1–F8 remains unauthorized;
   - next authorized action: none / awaiting owner decision on a fresh exactly-one live execution.

## Commit / push

Commit this fixture-switch configuration and the directly related handoff update.

Before committing:
- verify no unrelated file is staged;
- verify no live evidence file was created;
- verify no production/runtime behavior outside the G1 fixture choice changed.

After committing:
- require a clean working tree;
- report the commit hash;
- report exact files changed;
- report relation to `origin/main`;
- do not push unless separately authorized.

## Stop gate

Stop after the fixture-switch commit and clean-tree verification.

Do not run live F1–F8.

Do not start G2/G3/H1/H2/OQ-1/host integration or any next milestone.

## Final report

Report:

- branch / HEAD before and after;
- exact Mechanical fixture identifier/URN configured;
- files changed;
- non-live verification performed;
- commit hash;
- final git status;
- whether anything was pushed;
- explicit confirmation that live F1–F8 remains unauthorized and unexecuted.
