# For Claude — G2 Diagnostic Instrumentation Checkpoint Commit + Push Only

I explicitly authorize **one scoped checkpoint commit and push** for the accepted G2 diagnostic-instrumentation package.

The latest independent Work re-review found:

- Critical: 0
- High: 0
- Medium: 0
- Low: 3 non-blocking
- checkpoint readiness: **ready to checkpoint**

This authorization is limited to checkpointing the already-reviewed diagnostic-instrumentation research package and its durable review/provenance artifacts.

It does **not** authorize:
- live diagnostic execution;
- Viewer/browser execution;
- G2 retry;
- runtime remediation;
- accepted procedure changes;
- real T4/C6/C8 behavior changes;
- new authorization-record issuance;
- attempt reset;
- G3/downstream work.

Use the repository as the source of truth.

## 1. Verify baseline

Before staging, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD: `06980ee1e17b1268d4028ed9951c5f8462016cd2`
- `main == origin/main`
- committed harness SHA unchanged:
  `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`
- accepted procedure SHA unchanged:
  `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- immutable evidence unchanged
- D2 checkpoint unchanged
- historical G2 remains `FAIL (row 3)`
- C6 remains `NOT_EVIDENCED`
- C8 remains unresolved
- real T4/C6/C8 runtime behavior unchanged
- no Viewer/browser/live run
- no retry
- no new authorization record
- no attempt reset

Current accepted diagnostic state:

- diagnostic tests: `72/72`
- D2 tests: `55/55`
- offline suite: `5,155 total / 5,154 pass / 0 fail / 1 existing todo`
- diagnostic digest:
  `fe42e53e0e12c19fd9c321b7b038998c1fbe09b42ab1f5c556de71d247a52c35`
- summary: `197,416 B`
- summary SHA-256:
  `410c637d79e4d78801dcbb98fa75b3f4ce0c56e9cdc12ce1b684b1c8ccb21d47`
- witnesses: `109 B`
- witnesses SHA-256:
  `83548e8b37e49ea980e8d1444c970b86b636677480770b76ab0606ddbeaff0d3`
- spec SHA-256:
  `385993ba1b5bdb30687ab3235c01f651bca5be2690e5ccdfa6fecd9ed7be594e`

Accepted contract/state:

- `diag-summary.json` schemaVersion = 3
- `diag-witnesses.json` schemaVersion = 2
- bounded `ablation` carrier accepted
- NV limit = 406 B
- unique minimum:
  `ID-ON + P-FRM + P-TC + V-PEND + V-EDGE`
- P-XS redundant
- OPEN coverage = `2/13`
- assumption coverage = `3/13`
- only `3/13` questions have any sound procedure
- all 2,048 configs wrong-label count = 0
- public-only sound owner/subject/attribution definite labels = 0
- residual ambiguity = 5,063 ACTIVE0/pre-motion schedules
- historical C8 remains unresolved

If baseline differs materially, stop and report.

## 2. Inspect working tree before staging

List all modified and untracked files and classify each by role.

The checkpoint should include only the accepted diagnostic-instrumentation package and its durable governance/provenance artifacts.

Expected in-scope categories:

### Research/spec/prototype
- diagnostic research document
- diagnostic spec
- prototype implementation
- tests
- README
- retained results

### Reviews
- diagnostic internal review(s)
- independent Work review(s)
- corrected-package re-review
- schema-v3 targeted independent re-review

### Handoff
- `docs/handoffs/latest.md`

### Related prompts
- directly related diagnostic-instrumentation prompts for:
  - research-to-ready package
  - bounded offline correction
  - schema-v3 bounded correction
  - independent review/re-review prompts
  - checkpoint prompt itself, if present in the repo workspace

Do not include unrelated historical artifacts.

## 3. Explicit exclusions

Do **not** stage or commit these three historical authorization records:

- `docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-75a3ccb9.md`
- `docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-8a8d49f6.md`
- `docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-dbd97137.md`

They must remain:
- untracked
- unstaged
- uncommitted
- byte-identical
- unmoved
- undeleted

Also exclude the unrelated historical prompt:

`docs/prompts/for-claude-g2-historical-live-artifacts-docs-checkpoint-commit-push-only.md`

unless there is an already-established repository decision that changes its disposition.

Do not use broad commands such as:

`git add docs`

Stage only reviewed/in-scope artifacts explicitly or by tightly bounded path after inspection.

## 4. Verify protected paths

Before staging, verify there are no changes under:

- `src/`
- `test/`
- `wwwroot/`
- production runtime/config paths
- accepted procedure paths
- immutable evidence:
  `docs/research/evidence/g2-live-20261004-75a3ccb9/`

Also verify no change to:

- real G2 harness
- T4 runtime behavior
- C6/N2 runtime behavior
- C8 runtime/oracle behavior
- D2 checkpoint contents

If any protected change exists, stop.

## 5. Final verification before staging

Run:

### Diagnostic tests
`node --test docs/research/2026-10-05-g2-diagnostic-instrumentation/*.diag-test.mjs`

Expected:
`72/72`

### D2 tests
`node --test docs/research/2026-10-04-g2-d2-synthetic-transition/*.d2-test.mjs`

Expected:
`55/55`

### Offline suite
`npm run test:offline`

Expected:
- `5,155 total`
- `5,154 pass`
- `0 fail`
- `1 existing todo`

### Diff check
`git diff --check`

Expected clean.

Do not regenerate diagnostic outputs unless current retained results fail hash/digest verification.

Verify retained outputs match:

- diagnostic digest:
  `fe42e53e0e12c19fd9c321b7b038998c1fbe09b42ab1f5c556de71d247a52c35`
- summary hash:
  `410c637d79e4d78801dcbb98fa75b3f4ce0c56e9cdc12ce1b684b1c8ccb21d47`
- witnesses hash:
  `83548e8b37e49ea980e8d1444c970b86b636677480770b76ab0606ddbeaff0d3`
- spec hash:
  `385993ba1b5bdb30687ab3235c01f651bca5be2690e5ccdfa6fecd9ed7be594e`

## 6. Verify checkpoint artifact set

The staged checkpoint should include, as applicable:

### Diagnostic package
- `docs/research/2026-10-05-g2-diagnostic-instrumentation-research.md`
- `docs/research/2026-10-05-g2-diagnostic-instrumentation-spec.md`
- `docs/research/2026-10-05-g2-diagnostic-instrumentation/`

including prototype source, tests, README, and retained results.

### Reviews
Include all diagnostic-instrumentation review artifacts that are part of the durable audit trail, including:

- internal review
- initial independent review
- corrected-package independent re-review
- schema-v3 targeted independent re-review

### Handoff
- `docs/handoffs/latest.md`

### Related prompts
Include only directly related diagnostic-instrumentation prompts that document this package's authorization/review chain.

Do not include unrelated live-execution history.

## 7. Staged-diff inspection

Before committing:

- inspect staged file list;
- inspect staged diff summary;
- confirm no authorization record;
- confirm no protected path;
- confirm no unrelated historical prompt;
- confirm no runtime/production change.

If anything unexpected is staged, unstage it and stop/report if disposition is unclear.

## 8. Handoff checkpoint state

Before commit, ensure the handoff accurately records:

- diagnostic-instrumentation package accepted for checkpoint;
- 0 Critical / 0 High / 0 Medium blocking findings;
- 3 non-blocking Lows;
- schema-v3 contract accepted;
- bounded ablation carrier accepted;
- diagnostic digest:
  `fe42e53e0e12c19fd9c321b7b038998c1fbe09b42ab1f5c556de71d247a52c35`
- unique minimum:
  `ID-ON + P-FRM + P-TC + V-PEND + V-EDGE`
- public-only remains insufficient for sound live attribution;
- residual 5,063 ACTIVE0/pre-motion ambiguity remains;
- historical C8 unresolved;
- live diagnostics remain unauthorized;
- next gate after checkpoint:
  **separate owner authorization for future live-diagnostic design/preparation package only**

If the handoff already states this accurately, do not make gratuitous edits.

The handoff does not need to contain the future commit hash before the commit exists.

## 9. Commit

Create exactly **one scoped checkpoint commit**.

Suggested semantic intent:

`checkpoint G2 diagnostic instrumentation research package`

Use repository convention for exact wording.

After commit, verify:

- only intended research/reviews/prompts/handoff files entered the commit;
- no authorization record entered the commit;
- no protected source/test/procedure/evidence file entered the commit.

Report the full commit hash.

## 10. Push

Push that single commit to `origin/main`.

After push verify:

- `main == origin/main == <new checkpoint commit>`
- ahead/behind `0/0`
- tracked tree clean
- harness SHA unchanged
- procedure SHA unchanged
- immutable evidence unchanged
- D2 checkpoint unchanged
- historical G2 state unchanged
- C6 historical state unchanged
- C8 historical state unchanged
- T4 unchanged

## 11. Remaining untracked files

After push, list every remaining untracked file.

Expected to remain untracked:

- the three historical authorization records
- the unrelated historical-live-artifacts checkpoint prompt

If any diagnostic-instrumentation artifact remains untracked unexpectedly, report it instead of silently ignoring it.

Do not delete/move anything.

## 12. Prohibited

Do not:

- alter diagnostic package behavior during checkpointing;
- change accepted G2 procedure;
- modify harness/product runtime behavior;
- modify T4/C6/C8 runtime behavior;
- run Viewer/browser/live diagnostic;
- retry G2;
- issue a new authorization record;
- reset attempt state;
- mutate immutable evidence;
- begin G3;
- perform future live-diagnostic design work in this task.

## 13. Stop gate

Stop immediately after:

- one checkpoint commit;
- one push;
- post-push verification.

The next gate is:

**Separate owner authorization for a future live-diagnostic design/preparation package only**

No live execution is authorized.

## Final report

Report:

- new checkpoint commit hash;
- exact files committed;
- push result;
- final `main` / `origin/main` relation;
- diagnostic test result;
- D2 test result;
- offline-suite result;
- retained diagnostic digest;
- summary/witness/spec hashes;
- final tracked/untracked working-tree state;
- remaining untracked files;
- harness SHA;
- procedure SHA;
- immutable-evidence unchanged confirmation;
- D2 checkpoint unchanged confirmation;
- historical G2/C6/C8/T4 unchanged confirmation;
- confirmation no live/retry/new record/reset occurred;
- exact next gate.
