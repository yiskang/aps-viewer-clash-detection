# For Claude — G2 Headless-Shell Runtime Plan Fix Only

I explicitly authorize **one bounded live-plan/documentation correction only** for the Chromium runtime binding issue identified by the latest independent Work re-review.

This authorization is limited to:

- correcting the live plan so the pre-reservation Chromium gate binds the **actual Playwright headless runtime** used by `chromium.launch()`;
- resolving `chromium-headless-shell` cache/executable discovery;
- defining `PLAYWRIGHT_BROWSERS_PATH` resolution and precedence;
- updating directly affected runbook/preflight wording;
- focused internal review and handoff update.

It does **not** authorize:

- harness changes;
- procedure changes;
- production/Core/Viewer Adapter/M4/Panel changes;
- `LIVE_PATH_WIRED=true`;
- activation preparation;
- authorization-record issuance;
- attempt reservation or consumption;
- APS Viewer launch;
- fixture load;
- live G2;
- G3/H1/H2/OQ-1/host integration;
- commit or push.

Use repository state as the source of truth.

## 1. Verify baseline first

Before editing, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- expected HEAD: `996305c3efc30021180e04099e6007cc1d9afa5f`
- `main == origin/main`
- accepted procedure SHA unchanged
- harness SHA unchanged
- `G2_DUAL_COUNTER_GATE.resolved=true`
- `LIVE_PATH_WIRED=false`
- no authorization record
- no attempt reserved/consumed
- no APS Viewer/fixture load
- no production/downstream changes

Read:

- `docs/research/2026-10-02-g2-live-execution-plan.md`
- `docs/reviews/2026-10-02-g2-live-plan-remediation-targeted-independent-rereview.md`
- `docs/handoffs/latest.md`
- current Playwright package metadata / installed browser layout as read-only evidence

If baseline differs materially, stop and report.

## 2. Correct the actual Chromium runtime target

The current plan checks a headed Chromium cache/bundle, but the future live command uses `chromium.launch()` in its default headless mode.

Therefore the pre-reservation runtime gate must validate the **actual browser artifact that Playwright will launch**, namely the installed `chromium-headless-shell` runtime for Playwright 1.62.1.

Do not assume the headed Chromium bundle is sufficient.

## 3. Define exact Playwright browser-path resolution

The plan must define how the future preflight resolves the expected browser installation root.

Account for:

- `PLAYWRIGHT_BROWSERS_PATH` when explicitly set;
- repository/local Playwright installation defaults when the env var is unset;
- platform-specific cache root on macOS;
- the Playwright revision recorded in installed package metadata;
- the actual headless-shell directory/executable selected by Playwright 1.62.1.

Define deterministic precedence.

If multiple candidate roots exist, the plan must fail closed rather than guess.

## 4. Pre-reservation headless-shell check

Before reservation / `AUTH_BOUND` / `ATTEMPT_CONSUMED`, the future activated harness must validate via file inspection only:

- expected Playwright package version is `1.62.1`;
- expected `playwright-core` version is `1.62.1`;
- expected Chromium revision/runtime entry corresponds to the installed headless-shell;
- expected headless-shell executable/bundle exists at the resolved path;
- the installed browser version resolves to `151.0.7922.34`.

Do not launch Playwright or Chromium before reservation.

Do not use `chromium.launch()` for the pre-reservation check.

## 5. `PLAYWRIGHT_BROWSERS_PATH` semantics

Document:

- accepted unset/default behavior;
- accepted explicit absolute path behavior;
- whether relative values are allowed;
- whether `0` or special Playwright values are permitted;
- how the exact resolved root is recorded in evidence;
- how mismatch between configured root and discovered headless-shell causes preflight rejection.

The rule must match actual Playwright resolution semantics used by the current repo/runtime.

Do not invent unsupported path behavior.

## 6. Post-launch verification

Preserve the future post-launch check:

- after the live attempt is already consumed and browser launches,
- `browser.version()` must equal `151.0.7922.34`.

If it does not:

- verdict/preflight path fails closed according to the accepted procedure;
- the record remains spent;
- no retry is permitted.

The plan must clearly distinguish:

- pre-reservation file-level headless-shell identity check;
- post-launch runtime version check.

## 7. Runbook correction

Update the live runbook so the operator:

- checks/records `PLAYWRIGHT_BROWSERS_PATH` before execution;
- knows the exact headless-shell installation path that will be validated;
- does not confuse headed Chromium with headless-shell;
- does not manually launch Chromium during pre-check;
- understands that any mismatch blocks execution before reservation.

## 8. Preserve prior accepted dispositions

Do not reopen:

- PARTIAL verdict correction;
- exact Node `v22.23.1` hard preflight requirement;
- exact Playwright/playwright-core `1.62.1` hard preflight requirement;
- no separate preflight-only mode;
- Model-A URN digest sufficiency;
- optional authorization issuance/expiry/version metadata;
- fixed R1–R3 filename disposition;
- authorization TOCTOU Low;
- cleanup-timeout Low.

Do not modify harness/procedure in this task.

## 9. Non-live verification

Perform only read-only/non-live verification needed to support the corrected plan.

At minimum:

- inspect current installed `playwright` / `playwright-core` package versions;
- inspect current Playwright browser metadata/cache layout;
- resolve the current headless-shell path under the actual environment;
- verify the expected browser version from file metadata where available;
- `git diff --check`.

Do not launch Playwright/Chromium.
Do not reserve/consume an attempt.
Do not create an authorization record.

## 10. Focused internal review

After correcting the plan:

1. review only:
   - headless-shell runtime targeting;
   - browser-path resolution;
   - `PLAYWRIGHT_BROWSERS_PATH` semantics;
   - pre-reservation vs post-launch runtime checks;
2. classify Critical / High / Medium / Low;
3. fix genuine Critical/High planning defects within this docs-only scope;
4. do not modify harness/procedure/production code.

Persist the review under `docs/reviews/`.

Update `docs/handoffs/latest.md`.

## 11. Stop gate

Stop after:

- plan-only correction;
- read-only/non-live verification;
- focused internal review;
- handoff update.

Do not:

- modify harness/tests/procedure;
- set `LIVE_PATH_WIRED=true`;
- start activation preparation;
- issue an authorization record;
- reserve/consume an attempt;
- launch Playwright/Chromium;
- run live G2;
- commit or push.

Next gate:

**targeted independent Work re-review → owner decision on live-plan checkpoint commit and later activation-preparation authorization**

## 12. Final report

Report:

- branch / HEAD / origin relation;
- plan sections changed;
- resolved Playwright browser root;
- resolved `chromium-headless-shell` path;
- exact pre-reservation checks now required;
- exact `PLAYWRIGHT_BROWSERS_PATH` semantics;
- post-launch version check behavior;
- non-live verification performed/results;
- internal review findings/fixes;
- whether the plan appears ready for independent acceptance;
- explicit confirmation:
  - `G2_DUAL_COUNTER_GATE.resolved=true`
  - `LIVE_PATH_WIRED=false`
  - no authorization record created
  - no attempt reserved/consumed
  - no Playwright/Chromium launch
  - no APS Viewer/fixture load
  - no live G2
  - no harness/procedure/production changes
  - nothing committed or pushed.
