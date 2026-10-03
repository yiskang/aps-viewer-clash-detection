# For Claude — G2 Final Live-Plan Drift Correction Only

I explicitly authorize **one final bounded documentation-only correction** to the governing G2 live execution plan before any real flag flip may be authorized.

This task exists only to remove the remaining plan drift identified by the latest independent Work re-review.

## Baseline

Verify first:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD:
  `7ae4147b726e20b8183f0522ffabf61ab75895d6`
- `main == origin/main`
- real `LIVE_PATH_WIRED=false`
- committed harness SHA unchanged:
  `d34d470cf51f5f74c5cf3cfa8380944822af2ce6c2e07d27f4117ea71fd19c39`
- accepted procedure SHA unchanged:
  `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- no authorization record
- no attempt/reservation state
- no Viewer/fixture/live-G2 evidence

Read:

- `docs/research/2026-10-02-g2-live-execution-plan.md`
- `docs/reviews/2026-10-03-g2-live-plan-activation-instructions-targeted-independent-rereview.md`
- `docs/handoffs/latest.md`
- latest activation-preparation and live-flag reviews

If the baseline differs materially, stop and report.

## Authorized correction

Update only the governing live plan and directly related documentation needed to resolve the latest independent review.

Do not modify harness/tests/procedure/production code.

### 1. Fix §9 step 0

The current §9 step 0 still lists already-completed G-8/runtime-gate work as pending.

Remove or rewrite those items so §9 reflects current repository state.

The plan must clearly distinguish:

- work already completed and independently accepted;
- work still pending before the real flag flip;
- work still pending after the real flag flip.

Do not leave completed runtime-gate implementation presented as a future prerequisite.

Preserve the already accepted technical behavior of the runtime gates.

### 2. Remove unsupported G-15 record-filename prohibition

The latest Work review found the retained record-filename prohibition unsupported.

Remove that unsupported prohibition from G-15.

Do not replace it with a new precaution unless current source/tests/procedure provide direct evidence for it.

Preserve the accepted G-15 disposition:

- CLI tests use isolated temp-root copies;
- CLI tests do not spawn/touch the real harness;
- offline tests do not enter real validation;
- authorization-shaped test fixtures remain isolated.

### 3. Reconcile current-baseline wording

Review mixed references to:

- `996305c`
- `7ae4147`

Correct current activation instructions so they clearly use the current authoritative baseline:

`7ae4147b726e20b8183f0522ffabf61ab75895d6`

Preserve older commit references only where they are explicitly historical/evidentiary and cannot be mistaken for the current activation baseline.

Prefer wording such as:

- "historical checkpoint ..."
- "at prior review commit ..."
- "current activation baseline ..."

Do not rewrite valid historical evidence unnecessarily.

### 4. Preserve the accepted two-edit activation diff

Do not change the already accepted future real activation diff.

It remains exactly:

1. `test/acceptance/clashpanel-viewerbridge.acceptance.mjs`
   - `LIVE_PATH_WIRED=false -> true`

2. `test/acceptance/clashpanel-viewerbridge.acceptance.live-path-isolation.test.mjs`
   - update the single deliberate real-state pin/title/assertions to expect `true`

Do not add a third implementation/test edit unless current repository evidence contradicts the independent review.

### 5. Preserve accepted dispositions

Do not reopen or change:

- G-2 accepted disposition;
- `build:vendor` as fresh-archive/scratch setup only;
- Node `v22.23.1` operator prerequisite;
- Playwright/playwright-core/headless-shell gates;
- `T-same-target`;
- cleanup-ownership/PARTIAL conformance;
- `SELENIUM_REMOTE_URL` redaction;
- evidence schema;
- executable-SHA disposition;
- authorization semantics;
- attempt/reservation semantics;
- post-launch `browser.version()` behavior;
- procedure verdict mapping;
- scratch-flip result;
- CLI isolation architecture.

### 6. Real activation remains unauthorized

The plan must still state:

- real `LIVE_PATH_WIRED=false`;
- this docs correction does not authorize the flag flip;
- no authorization record may be created;
- no attempt may be reserved/consumed;
- no Viewer/fixture/live G2 may run;
- after targeted Work acceptance, the docs correction should be checkpointed before any separate owner authorization of the real two-file flip.

## Verification

Perform documentation-only verification:

- inspect §9 step 0 for stale completed-runtime-gate wording;
- inspect G-15 for unsupported filename prohibition;
- grep/check current-baseline references for ambiguous `996305c` vs `7ae4147`;
- confirm exact two-edit activation diff remains unchanged;
- confirm G-2, `build:vendor`, and Node prerequisite remain unchanged in meaning;
- run `git diff --check`.

Do not rerun scratch simulation.
Do not modify harness/tests.

## Focused internal review

Perform one focused internal review covering only:

- §9 step 0;
- G-15;
- baseline wording;
- preservation of the two-edit activation diff;
- consistency with latest independent Work re-review.

Classify Critical / High / Medium / Low.

Fix genuine Critical/High documentation defects within scope.

Persist the review under:

`docs/reviews/`

Update:

`docs/handoffs/latest.md`

## Handoff requirements

Record concisely:

- final governing-plan drift correction status;
- §9 completed-work wording corrected;
- unsupported G-15 filename prohibition removed;
- current activation baseline is `7ae4147...`;
- future real activation diff remains exactly two edits;
- `build:vendor` disposition unchanged;
- Node `v22.23.1` prerequisite unchanged;
- `G2_DUAL_COUNTER_GATE.resolved=true`;
- real `LIVE_PATH_WIRED=false`;
- no authorization record;
- no attempt reserved/consumed;
- no Viewer/fixture/live G2;
- next action: targeted independent Work re-review;
- real flag activation remains unauthorized.

## Commit policy

Do not commit or push.

Leave the docs correction, review, and handoff changes uncommitted for independent Work review.

## Stop gate

Stop after:

- final docs-only correction;
- documentation verification;
- focused internal review;
- handoff update.

Do not:

- modify harness/tests/procedure;
- flip real `LIVE_PATH_WIRED`;
- prepare/issue an authorization record;
- reserve/consume an attempt;
- switch Node/runtime;
- launch Viewer/load fixtures;
- run live G2;
- commit;
- push.

Next gate:

**Targeted independent Work re-review of final governing-plan drift correction → owner decision on docs-only checkpoint commit/push → separate owner decision on the real two-file flag flip**

## Final report

Report:

- branch / HEAD / origin relation;
- working-tree state;
- exact plan sections changed;
- §9 step-0 correction;
- G-15 correction;
- baseline-reference reconciliation;
- confirmation that the exact two-edit activation diff is unchanged;
- internal review findings/fixes;
- `git diff --check` result;
- whether the plan appears ready for final independent acceptance.

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
