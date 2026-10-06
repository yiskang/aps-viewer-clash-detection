# For Claude — G2 Historical Authorization Artifact Archival Checkpoint

I explicitly authorize one narrowly scoped **historical authorization-artifact archival checkpoint**.

The goal is to eliminate the final four untracked Markdown artifacts and leave the repository in a fully tracked, fully clean state, while preserving the historical authorization records safely as **non-executable provenance**.

This task must not alter live authorization state or technical runtime behavior.

---

## 1. Baseline

Verify first:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD:
  `3a599ea744c9bd38884c4519f2803e5d60c18399`
- `main == origin/main`
- tracked tree clean
- exactly four untracked Markdown files remain:

1. `docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-75a3ccb9.md`
2. `docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-8a8d49f6.md`
3. `docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-dbd97137.md`
4. `docs/prompts/for-claude-g2-historical-live-artifacts-docs-checkpoint-commit-push-only.md`

If any other modified/untracked file exists, stop and report.

Current known record status:

- `75a3ccb9`:
  final historical record, spent/consumed by the single live G2 attempt
- `8a8d49f6`:
  superseded
- `dbd97137`:
  superseded

Known record SHA-256 values:

- `75a3ccb9`
  `f68436dfbab09ad32a2ba248cf6ab63ce652b5615e82f8232f77aae9409c33c6`
- `8a8d49f6`
  `b520bc712fbf85ad848a234e0472c3f6da9f0fa724c9fe8682c657dc759db461`
- `dbd97137`
  `0f339d964794ceb54d84e3a3c13d1655cce6aac2b9796cf4c4deb3c243baa4ae`

Recompute all three before any mutation.

---

## 2. Inspect automatic authorization-record discovery risk

Before staging or moving anything, inspect repository code, scripts, procedures, and tests for any automatic discovery of authorization records, including patterns such as:

- `g2-live-execution-authorization-record-*`
- directory scans of `docs/prompts/`
- globbing for `G2-LIVE-EXECUTION: AUTHORIZED`
- “latest authorization record” lookup
- filesystem enumeration
- shell glob
- Node/Python directory reads
- procedure logic that treats presence of a record file as active authorization

Search at minimum:

- `src/`
- `test/`
- `scripts/`
- `docs/` procedures/specs
- any G2 execution tooling

Determine whether committing the three records at their current paths could cause any active code/tooling to mistake them for executable/live grants.

---

## 3. Decision branch

### Case A — no active discovery risk

If repository inspection shows that authorization records are only used by **explicit path / explicit record ID binding**, and committed historical records at the current paths cannot be mistaken for active authorization:

- keep all three records at their current paths;
- do not change their bytes;
- stage them exactly as historical provenance;
- stage the historical checkpoint prompt;
- add or update a tracked governance/status artifact making their non-active state explicit.

Preferred status artifact location:

`docs/research/evidence/g2-live-20261004-75a3ccb9/governance/`

or another already-established governance location if clearly more appropriate.

The status artifact must explicitly state:

| Record | Status |
|---|---|
| `g2-live-20261004-75a3ccb9` | spent / consumed / non-executable historical provenance |
| `g2-live-20261004-8a8d49f6` | superseded / non-executable historical provenance |
| `g2-live-20261004-dbd97137` | superseded / non-executable historical provenance |

Also state:

> Presence in Git does not constitute authorization for execution.

### Case B — active discovery risk exists

If committed records under `docs/prompts/` could be auto-discovered or misinterpreted:

1. Do **not** commit them at the active/discoverable location.
2. Move them to an explicit historical/archive location, for example:

`docs/research/evidence/g2-live-20261004-75a3ccb9/governance/historical-authorization-records/`

or another established archival/governance path.

3. Preserve bytes exactly.
4. Preserve original filenames.
5. Record original paths and SHA-256 values in a manifest.
6. Update any tracked references that need the new archival path.
7. Ensure active scanners/globs do not include the archive location.
8. Add a clear statement that these records are:
   - spent/superseded;
   - historical only;
   - not executable authorization.

Do not weaken any execution guard.

---

## 4. Byte preservation

For the three authorization records:

- do not edit contents;
- do not normalize line endings;
- do not rewrite headers;
- do not add comments inside the records;
- do not alter filenames unless relocation is required by Case B;
- preserve SHA-256 exactly.

After staging, recompute hashes and verify they are unchanged.

After commit/push, recompute again and verify unchanged.

---

## 5. Historical prompt

Track:

`docs/prompts/for-claude-g2-historical-live-artifacts-docs-checkpoint-commit-push-only.md`

This is historical provenance only.

Do not modify it unless a path/reference update is strictly necessary due to Case B.

If modified, explain why.

---

## 6. Handoff/governance note

Update `docs/handoffs/latest.md` only if needed to record:

- historical authorization records are now tracked/archived;
- final record is spent;
- older records are superseded;
- no active authorization exists;
- repository working tree is expected to be fully clean after this checkpoint;
- next gate remains:
  **future live-diagnostic design/preparation package only**
- no live execution is authorized.

Do not duplicate the full history into the handoff.

---

## 7. Protected-state verification

Confirm no changes to:

- real G2 harness
- product code
- procedure
- T4/C6/C8 runtime behavior
- immutable live evidence contents
- D2 checkpoint
- diagnostic instrumentation checkpoint
- `src/`
- `test/`
- `wwwroot/`
- production scripts/config

No:

- Viewer/browser/live run
- G2 retry
- new authorization record
- attempt reset
- G3 work

---

## 8. Pre-commit verification

Run:

- `git diff --check`
- `git status --short`
- explicit staged file inspection

Confirm:

- only the four historical Markdown artifacts plus any narrowly required governance/manifest/handoff update are staged;
- no runtime/source/test/procedure changes;
- no active authorization semantics changed.

---

## 9. Commit

Create exactly one docs/governance checkpoint commit.

Suggested semantic intent:

`archive historical G2 authorization artifacts`

Use repository convention for exact message.

After commit:

- verify the three record hashes remain unchanged;
- verify no unrelated file entered the commit;
- verify no active authorization was created.

Report full commit hash.

---

## 10. Push

Push the single commit to `origin/main`.

After push verify:

- `main == origin/main == <new commit>`
- ahead/behind `0/0`
- `git status --short` is **completely empty**
- zero modified files
- zero untracked files
- all three authorization-record hashes unchanged
- historical statuses remain spent/superseded
- no active authorization exists

---

## 11. Hard stop

Stop immediately after commit, push, and clean-tree verification.

Do not begin future live-diagnostic design/preparation in this task.

Next gate:

**Separate owner authorization for future live-diagnostic design/preparation package only**

---

## Final report

Report:

- discovery-risk result
- Case A or Case B chosen
- exact final paths of all three authorization records
- SHA-256 before/after for each
- historical prompt final path
- any governance/manifest/handoff file added/updated
- commit hash
- push result
- final `main` / `origin/main` relation
- final `git status --short` output
- explicit confirmation:
  - zero untracked files
  - zero modified tracked files
  - final record is spent
  - older two are superseded
  - no active authorization exists
  - no live/retry/new record/reset occurred
  - no harness/product/procedure/T4/C6/C8 runtime change
- exact next gate
