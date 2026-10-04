# For Claude — G2 Immutable Evidence Checkpoint Commit + Push Only

I explicitly authorize **one immutable docs/evidence checkpoint commit and push only** for the independently accepted G2 live-evidence preservation snapshot.

This authorization does **not** include C3/C8/C6 remediation planning or implementation, another live attempt, a new authorization record, attempt reset, harness/test/procedure/production changes, or any downstream work.

Use the repository as the source of truth.

## 1. Verify baseline before staging

Verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD:
  `75a3ccb9ba160f8afcf3c9b39a301f352b273c08`
- `main == origin/main`
- staging area empty
- exactly-one live G2 remains closed at:
  `FAIL (row 3)`
- no retry occurred
- no new authorization record was issued after the live attempt
- no attempt state was reset
- harness SHA unchanged
- procedure SHA unchanged
- `git diff --check` clean

If any material baseline differs, stop and report.

## 2. Independently accepted preservation state

The latest targeted Work re-review found:

- Critical: 0
- High: 0
- Medium: 0
- Low: 0
- ignored-log staging issue: closed
- all 10 preserved evidence files + `MANIFEST.md`: stageable
- source/copy hashes: 10/10 exact match
- `g2-live.exit` manifest wording: correct
- C20/screenshots manifest wording: correct
- source evidence: untouched
- harness/procedure hashes: unchanged
- immutable evidence checkpoint: ready to commit/push

Do not alter this accepted state before commit.

## 3. Explicit commit scope

Stage and commit only the independently reviewed preservation/governance artifacts.

Expected scope includes, as applicable:

### Evidence snapshot
`docs/research/evidence/g2-live-20261004-75a3ccb9/`

including exactly the preserved evidence files and:

- `MANIFEST.md`
- R1
- R2
- R3
- reservation record
- journal
- K terminal commit
- `g2-live.log`
- `g2-live.exit`
- `server.log`
- preserved final authorization record

### Preservation metadata/governance
- `.gitignore` exact-path negations required to make the preserved `.log` files stageable
- `docs/reviews/2026-10-04-g2-live-evidence-preservation-internal-review.md`
- `docs/reviews/2026-10-04-g2-immutable-evidence-preservation-independent-review.md`
- `docs/reviews/2026-10-04-g2-evidence-preservation-correction-internal-review.md`
- `docs/reviews/2026-10-04-g2-evidence-preservation-correction-targeted-independent-rereview.md`
- `docs/handoffs/latest.md`
- directly related preservation prompt artifacts under `docs/prompts/`, if present and part of the reviewed scope

Do not stage unrelated files.

If any harness/test/procedure/production file appears in the staged diff, stop and report.

## 4. Preserve evidence bytes exactly

Before staging the evidence snapshot, independently recheck all 10 preserved evidence files:

- source SHA-256
- preserved-copy SHA-256
- exact equality

Confirm no evidence file has changed since Work review.

Do not:
- normalize line endings;
- reserialize JSON;
- rename preserved evidence;
- alter log contents;
- regenerate any artifact.

If any evidence hash differs, stop and do not commit.

## 5. Verify ignored logs are actually staged

Because `*.log` previously hid two preserved files, explicitly verify that staging includes:

- preserved `g2-live.log`
- preserved `server.log`

Use appropriate git diagnostics such as:

- `git check-ignore -v`
- `git add -n`
- staged file listing

Confirm both logs appear in the actual staged set.

Do not rely only on `.gitignore` text.

## 6. Verify manifest accuracy one final time

Before commit, confirm `MANIFEST.md` still correctly states:

- 10 preserved evidence files
- exact paths/hashes
- `g2-live.exit` exists as a separate non-authoritative exit-status companion
- C20 was BLOCKED by C8 and never ran
- no C20 rendering/screenshots existed at source
- no evidence was lost during preservation
- no evidence file was modified or normalized
- authoritative vs supporting artifact classifications are correct

Do not make substantive manifest edits in this task.

If a substantive mismatch is found, stop instead of silently fixing it.

## 7. Handoff

Before commit, ensure `docs/handoffs/latest.md` accurately records:

- exactly-one live G2 closed at `FAIL (row 3)`
- immutable evidence snapshot independently accepted
- snapshot path:
  `docs/research/evidence/g2-live-20261004-75a3ccb9/`
- manifest path
- 10/10 source-copy hashes match
- operator log preserved
- O2 absent at source and non-blocking
- no screenshots existed because C20 never ran
- no retry/new record/remediation authorized
- this immutable evidence checkpoint commit/push is authorized
- next action after push:
  **owner decision on bounded C3/C8/C6 remediation planning only**

Do not imply remediation is already authorized.

## 8. Commit

Create exactly one immutable evidence/docs checkpoint commit.

After commit, verify:

- working tree state
- no harness/test/procedure/production file entered the commit
- evidence file hashes remain unchanged
- harness SHA unchanged
- procedure SHA unchanged

Report the new commit hash.

## 9. Push

Push that single checkpoint commit to `origin/main`.

After push, verify:

- `main == origin/main == <new checkpoint commit>`
- ahead/behind `0/0`
- tracked tree clean
- no evidence bytes changed
- harness SHA unchanged
- procedure SHA unchanged
- no retry occurred
- no new authorization record was issued
- no attempt state was reset

## 10. Prohibited

Do not:

- begin C3/C8/C6 remediation planning
- modify C3/C8/C6 logic
- modify harness/tests/procedure/production code
- rerun live G2
- issue a new authorization record
- reset/clean attempt state
- delete or rewrite raw source evidence
- start G3/downstream work

## 11. Stop gate

Stop immediately after the immutable evidence checkpoint is committed, pushed, and verified.

The next gate is:

**separate owner authorization of bounded C3/C8/C6 remediation planning only**

## Final report

Report:

- new checkpoint commit hash
- exact files committed
- evidence file count
- confirmation `g2-live.log` and `server.log` were actually included
- source/copy hash recheck result
- push result
- final `main` / `origin/main` relation
- final working-tree state
- harness SHA
- procedure SHA
- confirmation no retry/new record/attempt reset/remediation occurred
- exact next gate
