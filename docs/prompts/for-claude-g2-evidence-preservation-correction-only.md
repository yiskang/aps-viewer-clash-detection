# For Claude — G2 Evidence Preservation Correction Only

I explicitly authorize **one bounded evidence-preservation correction only**.

This task is limited to the preservation defects identified by the latest independent Work review.

It does **not** authorize:
- live retry;
- new authorization record;
- attempt reset;
- C3/C8/C6 remediation planning or implementation;
- harness/test/procedure/production changes;
- commit or push.

Use the repository as the source of truth.

## 1. Verify baseline

Before editing, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD:
  `75a3ccb9ba160f8afcf3c9b39a301f352b273c08`
- `main == origin/main`
- exactly-one live G2 remains closed at:
  `FAIL (row 3)`
- no retry occurred
- no new authorization record was issued after the attempt
- no attempt state was reset
- source evidence under `test/acceptance/results/` remains present and unchanged
- preservation directory exists:
  `docs/research/evidence/g2-live-20261004-75a3ccb9/`
- manifest exists:
  `docs/research/evidence/g2-live-20261004-75a3ccb9/MANIFEST.md`
- harness/procedure SHAs unchanged

Read:
- latest independent preservation review
- preservation internal review
- manifest
- `.gitignore` / ignore rules affecting preserved logs
- `docs/handoffs/latest.md`

If baseline differs materially, stop and report.

## 2. Fix ignored-log staging risk

Work found:

- `g2-live.log`
- `server.log`

are matched by `*.log`, so normal staging can silently omit them.

Correct preservation packaging so both files are guaranteed to be included in the future immutable evidence checkpoint **without changing their bytes**.

Use the minimum repo-consistent approach.

Acceptable examples, only if consistent with repo conventions:

- narrowly scoped `.gitignore` negation rules for the preservation directory; or
- another explicit tracked-evidence mechanism that guarantees these exact preserved files are stageable.

Do not:
- rename the log files;
- edit their contents;
- recompute them from source;
- alter original volatile logs;
- weaken broader ignore rules unnecessarily.

After the correction, verify with git's ignore/staging diagnostics that both preserved log files are no longer silently excluded.

## 3. Correct MANIFEST.md — exit artifact

The manifest currently implies there is no separate exit artifact.

Correct it to explicitly state that:

- `g2-live.exit` exists;
- it is preserved as a distinct file;
- it records/represents the retained exit-status evidence as appropriate to its actual contents;
- its source and preserved paths/hashes remain those already verified.

Do not alter `g2-live.exit` itself.

## 4. Correct MANIFEST.md — C20 rendering/screenshots

Remove/correct any wording implying that C20 rendering evidence or screenshots exist.

The authoritative state is:

- C20 was BLOCKED because C8 failed;
- C20 never ran;
- no screenshots existed at source;
- no rendering/screenshot artifact was lost during preservation.

Do not invent rendering evidence.

## 5. Preserve all evidence bytes and hashes

For all 10 preserved evidence files:

- recompute source SHA-256;
- recompute preserved-copy SHA-256;
- confirm equality;
- confirm no file bytes changed as part of this correction.

The manifest and repo ignore metadata may change; preserved evidence bytes must not.

If any preserved evidence hash changes unexpectedly, stop and report.

## 6. Account for preservation prompt artifact

Latest Work review found a Low:

- the preservation authorization prompt is an additional untracked task artifact omitted from prior handoff/scope accounting.

Update handoff/scope bookkeeping so this artifact is acknowledged accurately.

Do not treat it as authoritative live evidence.

## 7. Verify repository scope

Confirm changes are limited to preservation/governance metadata, such as:

- ignore-rule metadata if needed;
- `MANIFEST.md`;
- preservation review;
- handoff;
- related prompt artifact bookkeeping.

Do not modify:
- source evidence bytes;
- harness;
- tests;
- procedure;
- production/Core/Viewer Adapter/M4/Panel/OQ-1/host code.

Run:

`git diff --check`

## 8. Focused internal review

Perform one focused internal review over only:

- ignored-log staging fix;
- manifest exit-artifact correction;
- C20/screenshots correction;
- source/copy hash preservation;
- prompt-artifact bookkeeping.

Classify Critical / High / Medium / Low.

Fix genuine Critical/High preservation defects within scope.

Persist under:

`docs/reviews/`

Update:

`docs/handoffs/latest.md`

## 9. Commit policy

Do not commit or push.

Leave the bounded preservation correction uncommitted for targeted independent Work re-review.

## 10. Stop gate

Stop after:

- ignored-log staging risk corrected;
- manifest corrected;
- hashes reverified;
- internal review;
- handoff update.

Do not:
- rerun live G2;
- issue a new authorization record;
- reset attempt state;
- start C3/C8/C6 remediation planning;
- modify harness/tests/procedure/production;
- commit;
- push.

Next gate:

**Targeted independent Work re-review of the evidence-preservation correction → owner decision on immutable evidence checkpoint commit/push**

## Final report

Report:

- branch / HEAD / origin relation;
- files changed;
- exact ignore/staging correction used;
- proof that `g2-live.log` and `server.log` are now stageable;
- manifest exit-artifact correction;
- manifest C20/screenshots correction;
- source/copy SHA verification result for all 10 evidence files;
- preservation prompt bookkeeping update;
- internal review findings;
- `git diff --check` result;
- working-tree state;
- exact next gate.

Explicitly confirm:

- no evidence bytes changed;
- no retry occurred;
- no new authorization record was issued;
- no attempt state was reset;
- no harness/test/procedure/production change occurred;
- no commit;
- no push.
