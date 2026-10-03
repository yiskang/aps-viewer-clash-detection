# For Claude — G2 Activation Preparation Only

I explicitly authorize **one bounded G2 activation-preparation implementation task only**.

Baseline:
- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD: `87dac9d63feab7b13e9b2dba2d9e7cba20d266ea`
- `main == origin/main`
- working tree clean

Use repository state as source of truth. Read `CLAUDE.md`, `docs/handoffs/latest.md`, the accepted live plan, latest independent reviews, accepted procedure, dormant harness, and relevant activation/authorization/preflight/journal/CLI/gate tests before editing.

If baseline differs materially, stop and report.

## Authorized scope

Implement only the activation-preparation work required by the accepted plan/reviews:

1. exact hard runtime preflight gates;
2. Playwright browser-root/headless-shell resolution;
3. `T-same-target`;
4. dormant harness cleanup-ownership/PARTIAL conformance;
5. activation/pinning test migration needed for a future flag flip;
6. offline verification;
7. focused internal review;
8. handoff update;
9. recompute relevant hashes.

Do **not** activate the live path.

## Hard runtime preflight gates

Implement exact rejection-before-reservation checks for:

- Node `v22.23.1`
- `playwright` `1.62.1`
- `playwright-core` `1.62.1`
- Chromium headless-shell `151.0.7922.34`

All must be validated before:

- reservation
- `AUTH_BOUND`
- `ATTEMPT_CONSUMED`
- browser launch
- Viewer launch
- fixture load

Mismatch/unreadable value => fail closed before reservation, record unspent.

The Chromium pre-reservation gate must target the actual default headless runtime:

- `chromium-headless-shell`
- revision `1234`
- version `151.0.7922.34`

Do not gate on headed `chromium-1234`. Do not launch Chromium for the pre-reservation gate.

## Browser-root/path resolution

Implement the accepted semantics for:

- `PLAYWRIGHT_BROWSERS_PATH`
- `npm_config_playwright_browsers_path`
- `npm_package_config_playwright_browsers_path`
- default Playwright cache root when unset/empty

Preserve fail-closed rules from the plan, including conflicts/invalid paths/special values.

Also enforce the accepted environment guards:

- `PWDEBUG`
- `npm_config_pwdebug`
- `npm_package_config_pwdebug`
- `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE`

Do not guess between multiple plausible roots.

If an accepted evidence schema cannot carry a proposed field, stop rather than silently extending procedure semantics.

## `T-same-target`

Use the corrected oracle from the pushed checkpoint.

For accepted environments:
- resolve the executable through the same effective preflight logic;
- obtain Playwright's headless-shell oracle via the internal executable registry, equivalent to:
  `registry.findExecutable('chromium-headless-shell').executablePath()`;
- assert path equality.

Do **not** use public `chromium.executablePath()` as the oracle.

For rejected environments:
- do not do path-equality checks;
- assert refusal before reservation.

Explicitly classify every existing case as accepted or rejected.

## Fix dormant harness PARTIAL divergence

Make harness verdict behavior conform to the accepted procedure/plan:

- unresolved cleanup ownership after re-check => `FAIL`
- `PARTIAL` only where procedure explicitly permits resolved ownership
- C20 `NOT_EVIDENCED` semantics unchanged

Add/update targeted tests proving unresolved ownership cannot produce `PARTIAL`.
Do not amend the procedure and do not introduce new verdict states.

## Activation/pinning test migration

Prepare tests for a future separately authorized live flag flip while keeping:

`LIVE_PATH_WIRED=false`

Address the known pinning fallout and CLI accidental-live risk so that:

- offline suites stay offline;
- no test consumes a real authorization;
- no coincidental authorization filename can enter real validation;
- activation behavior can be tested without enabling the live path;
- future `LIVE_PATH_WIRED=true` becomes a deliberate bounded change.

Use isolated temp fixtures/paths where authorization-shaped test data is needed.

## Authorization safety

Tests must not:

- create a real live authorization record in the production repo location;
- reserve a real attempt;
- create durable live attempt state;
- launch APS Viewer;
- load Model A or Model B;
- run live G2.

## Post-launch version check

Preserve the future definitive check:

`browser.version() === 151.0.7922.34`

Mismatch remains fail-closed after the accepted consumption boundary; the record is spent and no retry is allowed.

Do not alter attempt semantics.

## No live activation

This task must leave:

- `G2_DUAL_COUNTER_GATE.resolved=true`
- `LIVE_PATH_WIRED=false`

Do not:
- flip the live flag;
- issue a real authorization record;
- reserve/consume an attempt;
- launch APS Viewer;
- load fixtures;
- run live G2.

## Verification

Run the strongest relevant non-live/offline verification, including at minimum:

- runtime-gate tests;
- `T-same-target` accepted/rejected tests;
- cleanup-ownership/PARTIAL tests;
- activation/pinning tests;
- authorization/preflight/journal/CLI/gate focused suites;
- focused G2 suite;
- aggregate offline suite if practical;
- `git diff --check`.

Confirm tests create no real repo attempt/evidence artifacts.
Report exact pass counts.

## Hashes

After the final implementation state, recompute:

- accepted procedure SHA (expected unchanged);
- harness SHA (expected changed);
- any additional implementation digest required by the accepted plan.

Do not create an authorization record using the new hash.

## Internal review

Perform one focused internal review over the activation-preparation diff.

Review:
- runtime hard gates;
- browser/path/env resolution;
- `T-same-target`;
- cleanup-ownership verdict conformance;
- activation/pinning test safety;
- accidental authorization consumption;
- accidental live-path entry;
- procedure consistency;
- journal/evidence side effects.

Classify Critical / High / Medium / Low.
Fix genuine Critical/High issues within this authorized scope.

Persist the review under `docs/reviews/`.
Update `docs/handoffs/latest.md`.

## Handoff

The handoff must state concisely:

- repo / branch / HEAD / working-tree state;
- accepted plan and latest independent review;
- activation-preparation status;
- exact runtime gates implemented;
- `T-same-target` status;
- cleanup-ownership/PARTIAL conformance status;
- new harness SHA;
- verification results;
- remaining blockers/deferred items;
- `G2_DUAL_COUNTER_GATE.resolved=true`;
- `LIVE_PATH_WIRED=false`;
- no auth record;
- no attempt reserved/consumed;
- no live G2;
- next action: **independent Work review of activation preparation**;
- still unauthorized: live flag flip, authorization-record issuance, live execution.

## Commit policy

Do **not** commit or push unless separately authorized.

## Stop gate

Stop after:

- activation-preparation implementation;
- non-live verification;
- internal review;
- handoff update;
- hash recomputation.

Do not proceed to:

- `LIVE_PATH_WIRED=true`;
- authorization-record preparation/issuance;
- attempt reservation/consumption;
- Viewer/fixture load;
- live G2;
- commit/push.

Next gate:

**Independent Work review of G2 activation preparation → owner decision on checkpoint commit / later activation authorization**

## Final report

Report:

- branch / HEAD / origin relation;
- working-tree state;
- files changed;
- runtime gates implemented;
- browser-path/env semantics implemented;
- `T-same-target` case classification;
- cleanup-ownership/PARTIAL correction;
- activation/pinning test migration;
- exact verification results;
- new harness SHA;
- internal review findings/fixes;
- remaining Low/deferred items;
- readiness for independent review.

Explicitly confirm:
- `G2_DUAL_COUNTER_GATE.resolved=true`
- `LIVE_PATH_WIRED=false`
- no authorization record created
- no attempt reserved/consumed
- no APS Viewer/fixture load
- no live G2
- procedure unchanged
- no commit
- no push
