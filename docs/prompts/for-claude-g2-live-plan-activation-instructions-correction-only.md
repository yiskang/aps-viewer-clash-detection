# For Claude — G2 Live-Plan Activation Instructions Correction Only

I explicitly authorize **one bounded documentation-only correction** to the governing G2 live execution plan before any real flag activation is authorized.

Baseline:
- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD: `7ae4147b726e20b8183f0522ffabf61ab75895d6`
- `main == origin/main`
- committed harness SHA: `d34d470cf51f5f74c5cf3cfa8380944822af2ce6c2e07d27f4117ea71fd19c39`
- accepted procedure SHA: `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- `G2_DUAL_COUNTER_GATE.resolved=true`
- real `LIVE_PATH_WIRED=false`

Use repository state as the source of truth.

Read:
- `docs/handoffs/latest.md`
- `docs/research/2026-10-02-g2-live-execution-plan.md`
- `docs/reviews/2026-10-03-g2-live-flag-activation-preparation-independent-review.md`
- `docs/reviews/2026-10-03-g2-live-flag-activation-preparation-internal-review.md`

If the baseline differs materially, stop and report.

## Authorized correction

Update only the governing live plan and directly related documentation needed to remove stale activation instructions.

Do not modify harness/tests/procedure/production code.

### 1. Correct §9 activation instructions

Reconcile §9 with the independently verified scratch simulation.

The governing plan must state that future real activation requires exactly two repository edits:

1. `test/acceptance/clashpanel-viewerbridge.acceptance.mjs`
   - change `LIVE_PATH_WIRED=false` to `true`

2. `test/acceptance/clashpanel-viewerbridge.acceptance.live-path-isolation.test.mjs`
   - update the single deliberate real-state pin and its title to expect `true`

Remove/correct any claim that roughly 20 suites require migration or fail after the flip.

State that the scratch simulation showed the existing activation/pinning migration is sufficient.

### 2. Correct G-2 and G-15

Reconcile hazards G-2 and G-15 with verified behavior.

In particular:
- remove/correct disproved activation-fallout wording;
- remove/correct the stale claim that CLI tests spawn/touch the real harness;
- preserve only hazards still supported by current source/tests/reviews.

Verified current behavior:
- CLI tests use isolated temp-root copies;
- static guards prevent accidental real-harness execution;
- offline tests do not enter real validation;
- authorization-shaped test fixtures remain isolated.

Do not invent new hazards.

### 3. Fix stale source reference

Correct the old source-line reference for `LIVE_PATH_WIRED`.

Prefer file path + symbol/constant name over a brittle line-number-only reference where practical.

### 4. Fresh-archive setup

Document `build:vendor` as normal fresh-archive/scratch test setup because `git archive HEAD` omits generated `wwwroot/vendor`.

Do **not** misclassify it as an activation/runtime/live-G2 dependency unless independently required by the existing runbook.

### 5. Node prerequisite

Document the future operator prerequisite:

- activation/live work must use exactly Node `v22.23.1`;
- fresh shells may default to Homebrew Node `v26.10.0`;
- before future activation/live work, explicitly run:
  `nvm use 22.23.1`
- verify:
  `node -v`
- the hard runtime gate remains authoritative and rejects mismatch before reservation/import.

Do not install or switch Node during this docs-only task.

### 6. Preserve accepted semantics

Do not reopen/change:
- runtime hard-gate semantics;
- browser-root resolution;
- `T-same-target`;
- cleanup-ownership/PARTIAL conformance;
- `SELENIUM_REMOTE_URL` redaction;
- evidence schema;
- authorization-record semantics;
- executable-SHA disposition;
- attempt/reservation semantics;
- post-launch `browser.version()` check;
- procedure verdict mapping.

### 7. Real activation remains unauthorized

The corrected plan must still state:
- real `LIVE_PATH_WIRED=false`;
- no real flip is authorized by this task;
- no authorization record may be created;
- no attempt may be reserved/consumed;
- no Viewer/fixture/live G2 may run;
- separate owner authorization is required for the actual two-file flip.

## Verification

Perform only non-live/documentation verification:

- inspect corrected plan for consistency;
- grep/check that stale ~20-suite and real-CLI-harness claims are removed/corrected;
- verify plan identifies exact two-file future activation diff;
- verify Node `v22.23.1` wording matches the hard gate;
- run `git diff --check`.

Do not rerun live simulation unless required to resolve a documentation contradiction.
Do not modify harness/tests.

## Focused internal review

Perform one focused internal review of:
- §9;
- G-2;
- G-15;
- source-location references;
- `build:vendor` disposition;
- Node prerequisite;
- consistency with latest independent Work review.

Classify Critical / High / Medium / Low.

Fix genuine Critical/High documentation defects within scope.

Persist under `docs/reviews/`.
Update `docs/handoffs/latest.md`.

## Handoff

Record concisely:
- governing-plan activation instructions reconciled;
- future real activation diff is exactly two edits;
- scratch simulation passed;
- fresh archive needs normal `build:vendor` setup only;
- future operator must explicitly select Node `v22.23.1`;
- `G2_DUAL_COUNTER_GATE.resolved=true`;
- real `LIVE_PATH_WIRED=false`;
- no authorization record;
- no attempt reserved/consumed;
- no Viewer/fixture/live G2;
- next action: targeted independent Work re-review;
- real flag activation remains unauthorized.

## Commit policy

Do not commit or push.

## Stop gate

Stop after:
- docs-only plan correction;
- documentation verification;
- focused internal review;
- handoff update.

Do not:
- modify harness/tests/procedure;
- flip real `LIVE_PATH_WIRED`;
- prepare/issue authorization record;
- reserve/consume attempt;
- switch Node/runtime;
- launch Viewer/load fixtures;
- run live G2;
- commit/push.

Next gate:

**Targeted independent Work re-review of governing-plan activation instructions → owner decision on whether to authorize the real two-file flag flip**

## Final report

Report:
- branch / HEAD / origin relation;
- working-tree state;
- exact plan sections changed;
- corrected §9 activation instructions;
- corrected G-2/G-15 wording;
- source-reference correction;
- `build:vendor` disposition;
- Node `v22.23.1` prerequisite wording;
- internal review findings/fixes;
- `git diff --check` result;
- whether the plan appears ready for independent acceptance.

Explicitly confirm:
- `G2_DUAL_COUNTER_GATE.resolved=true`
- real `LIVE_PATH_WIRED=false`
- no authorization record
- no attempt reserved/consumed
- no Viewer/fixture load
- no live G2
- harness SHA unchanged
- procedure SHA unchanged
- no commit
- no push
