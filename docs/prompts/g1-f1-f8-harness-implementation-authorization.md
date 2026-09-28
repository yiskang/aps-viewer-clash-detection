# Prompt — Authorize G1 F1–F8 Harness Implementation Only

I explicitly authorize **implementation of the reviewed G1 SVF2 F1–F8 verification harness only**.

This authorization does **not** include live F1–F8 execution.

## Repository baseline

Before starting:

1. Verify the repository currently in scope.
2. Read:
   - `CLAUDE.md`
   - `docs/handoffs/latest.md`
   - `docs/research/2026-09-27-g1-svf2-f1-f8-harness-build-plan.md`
   - the latest independent Work reviews for that plan
   - the prior G1 initializer/fixture diagnostic artifacts
3. Verify:
   - branch: `main`
   - expected baseline: `cb2a17d`
   - `main == origin/main`
   - working tree is clean
   - harness plan is committed/pushed and technically ready for implementation authorization
   - live F1–F8 execution remains unauthorized
   - G2/G3/H1/H2/OQ-1/host integration remain unauthorized

If repository state materially differs, stop and report before implementation.

Treat repository artifacts as authoritative.

## Authorized scope

Implement the reviewed non-production G1 harness according to the accepted build plan.

Primary expected implementation file:

`test/acceptance/g1-svf2-f1-f8-verification.mjs`

Also implement only the support files/tests explicitly required by the reviewed plan.

Do not change production Viewer initialization.

Do not wire this harness into production routes or normal user-facing flows.

Do not run the live F1–F8 gate.

## Required implementation behavior

Implement the reviewed plan exactly, including:

- fail-closed SVF2 classifier;
- F1–F8 evidence plumbing;
- reviewed overall verdict precedence;
- all mandatory sensitivity controls;
- timeout/realm safety;
- reviewed cleanup/resource-ownership ledger;
- Viewer-script byte identity gating;
- F7 calibration rule as envelope-limited;
- F8 R1 based on F1 `extractFragments` ownership maps.

Do not use `resolveRoots()` as a source of per-fragment ownership rows.

## Tests allowed

You may run only non-live verification such as:

- syntax checks;
- unit/offline tests;
- fake/stub tests;
- verdict/classifier/control-state tests;
- timeout/token state-machine tests;
- cleanup tests;
- evidence-schema tests;
- hash/identity logic tests;
- static/layering checks.

Do **not** perform real SVF2 live F1–F8 execution.

## Explicitly NOT authorized

Do not:

- run G1 live F1–F8;
- start G2/G3/H1/H2;
- start OQ-1 or host integration;
- modify `wwwroot/viewer.js`;
- change production `Autodesk.Viewing.Initializer`;
- change Viewer version;
- upload or retranslate models;
- modify Viewer Adapter;
- modify Core;
- reopen M4;
- modify Viewer Clash Panel production behavior;
- modify Agent Kit skills/routing;
- start any next milestone.

If implementation appears to require one of these, stop and report.

## Review strategy

Use the reviewed plan's implementation/review boundaries.

After substantial implementation slices:
- use separate reviewing agents/subagents where appropriate;
- fix genuine Critical/High findings within this harness-only scope;
- do not let review feedback expand into live execution or production changes.

Persist substantial implementation review/status artifacts under `docs/reviews/` as repository convention requires.

## Final implementation gate

After the harness implementation is complete:

1. run all allowed offline/synthetic verification;
2. verify no live F1–F8 execution occurred;
3. verify production initializer is unchanged;
4. verify no G2/G3/H1/H2/OQ-1/host work started;
5. update `docs/handoffs/latest.md`;
6. persist the harness implementation review/status artifact.

Then stop.

Do **not** execute F1–F8.

The next gate is:

**independent ChatGPT Work review of the implemented harness → owner decision on live F1–F8 execution**

## Final report

Report:

- branch;
- starting HEAD;
- ending HEAD;
- harness implementation commit range;
- files created/modified;
- implementation status;
- offline/synthetic test totals;
- internal review findings/fixes;
- deviations from the reviewed plan, if any;
- implementation-time API checks and results;
- evidence/cleanup/verdict machinery status;
- final git status;
- whether anything was pushed.

Explicitly confirm:

- live F1–F8 was not run;
- production Viewer initializer was not changed;
- no model was uploaded/retranslated;
- G2/G3/H1/H2 were not started;
- no OQ-1/host integration work was started;
- no Viewer Adapter/Core/M4/Panel production change was made.

Stop at harness-implementation-complete.
