# For Claude — G2 D2-OFFLINE Checkpoint Commit + Push Only

I explicitly authorize **one D2-OFFLINE docs/research checkpoint commit and push only**.

The latest independent Work review found:

- Critical: 0
- High: 0
- Medium: 0
- Low: 2 non-blocking
- Medium TOCTOU blocker: closed
- D2-OFFLINE package: ready to checkpoint

This authorization does **not** include diagnostic instrumentation, live work, G2 retry, runtime remediation, or downstream implementation.

Use the repository as the source of truth.

## 1. Verify baseline

Before staging, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD:
  `53ea0a74b215b4a3c7463b8fe7da4bf783b8c8fb`
- `main == origin/main`
- committed harness SHA unchanged:
  `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`
- accepted procedure SHA unchanged:
  `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- immutable evidence unchanged
- historical G2 remains `FAIL (row 3)`
- historical C6 remains `NOT_EVIDENCED`
- historical C8 remains unresolved
- T4 unchanged
- no Viewer/browser/live run
- no G2 retry
- no new authorization record
- no attempt reset

Accepted D2 verification state:

- D2 tests: `55/55`
- offline suite:
  `5,155 total / 5,154 pass / 0 fail / 1 existing todo`
- exhaustive schedules: `52,308`
- D=30 characterization: `36`
- deterministic output digest:
  `e1d1b815ed351e6feba3e34822ba9895e54035158e685bfbe7f628f6d10bbb06`
- two fresh simulator runs byte-identical
- D=30 model-invalid characterization accepted
- M-GAP witness coverage accepted
- owned input snapshots accepted
- 128-byte inclusive boundary tests accepted
- no protected-path drift

If baseline differs materially, stop and report.

---

## 2. Inspect working tree

List all modified/untracked files.

Classify them before staging.

The checkpoint should contain only:

- D2 simulator/research implementation under:
  `docs/research/2026-10-04-g2-d2-synthetic-transition/`
- D2 internal reviews
- D2 independent reviews
- latest D2 hardening/re-review artifacts
- `docs/handoffs/latest.md`
- directly related D2 prompts, if present and appropriate for durable provenance

Do not stage unrelated historical artifacts.

---

## 3. Explicit exclusions

Do **not** stage or commit the three historical authorization records:

- `docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-75a3ccb9.md`
- `docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-8a8d49f6.md`
- `docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-dbd97137.md`

They must remain:

- untracked
- unstaged
- byte-identical
- unmoved
- undeleted

Also do not stage unrelated old prompts merely because they are under `docs/prompts/`.

Do not use broad commands such as:

`git add docs`

Stage intended files explicitly or by tightly bounded paths after inspection.

---

## 4. Protected paths

Before staging, verify there is no change under:

- `test/`
- `src/`
- `wwwroot/`
- accepted procedure/spec paths outside the D2 research package
- immutable evidence:
  `docs/research/evidence/g2-live-20261004-75a3ccb9/`

Also verify no change to:

- real G2 harness
- T4 runtime behavior
- C6/N2 runtime behavior
- C8 runtime/oracle behavior

If any protected change is present, stop.

---

## 5. Pre-commit verification

Run and verify:

- `git diff --check`
- D2 tests:
  `node --test docs/research/2026-10-04-g2-d2-synthetic-transition/*.d2-test.mjs`
- offline suite:
  `npm run test:offline`

Expected:

- D2: `55/55`
- offline:
  `5,155 total / 5,154 pass / 0 fail / 1 existing todo`

Re-run simulator once only if needed to confirm retained results are still current.

Expected retained digest:

`e1d1b815ed351e6feba3e34822ba9895e54035158e685bfbe7f628f6d10bbb06`

Do not regenerate outputs unnecessarily if current retained results already match the independently reviewed state.

---

## 6. Verify checkpoint artifact set

The staged checkpoint should include, as applicable:

### D2 research package
- simulator source
- tests
- fixtures
- README
- retained deterministic results

### Reviews
- original D2-OFFLINE internal review
- bounded-remediation internal review
- input-snapshot-hardening internal review
- independent D2-OFFLINE implementation/results review
- targeted bounded-remediation re-review
- targeted input-snapshot-hardening re-review

### Operational state
- `docs/handoffs/latest.md`

### D2 prompts
Include only directly related D2 prompts that are intended as durable provenance.

Do not include unrelated historical live-execution records.

---

## 7. Staged diff inspection

Before committing:

- inspect staged file list;
- inspect staged diff summary;
- verify no protected path;
- verify no authorization record;
- verify no unrelated artifact.

If any unexpected file is staged, unstage it and stop/report if disposition is unclear.

---

## 8. Commit

Create exactly **one checkpoint commit** for the accepted D2-OFFLINE package.

Suggested semantic intent:

`checkpoint D2 offline synthetic transition research`

Exact commit message may follow repository convention.

After commit, verify:

- commit contains only intended docs/research/review/handoff/prompt artifacts;
- no authorization record entered the commit;
- no protected source/test/procedure/evidence file entered the commit.

Report the full commit hash.

---

## 9. Push

Push that single commit to `origin/main`.

After push, verify:

- `main == origin/main == <new checkpoint commit>`
- ahead/behind `0/0`
- tracked tree clean
- no protected-path drift
- harness SHA unchanged
- procedure SHA unchanged
- immutable evidence unchanged
- historical G2 state unchanged
- C6 historical state unchanged
- C8 historical state unchanged

---

## 10. Remaining untracked files

After push, report every remaining untracked file.

Expected historical authorization records must remain untracked.

If any non-authorization D2 artifact remains untracked unexpectedly, report it instead of silently ignoring it.

Do not delete/move anything as cleanup.

---

## 11. Handoff

The committed handoff should state:

- D2-OFFLINE checkpoint completed;
- new commit hash;
- simulator/results accepted;
- owned input snapshot hardening accepted;
- output digest:
  `e1d1b815ed351e6feba3e34822ba9895e54035158e685bfbe7f628f6d10bbb06`
- H2/H5 are synthetic mechanical support only;
- C6/N2 remains outcome E with no accepted margin;
- D=30 supports no inference;
- historical C8 remains unresolved;
- no live diagnostic/retry authorized;
- next gate:
  **separate owner authorization for diagnostic-instrumentation specification/research only**.

If the current handoff already says this accurately, do not make gratuitous edits.

---

## 12. Prohibited

Do not:

- modify D2 behavior during checkpointing;
- change D2 spec;
- modify harness/product/procedure;
- modify T4/C6/C8 runtime behavior;
- run Viewer/browser/live G2;
- perform diagnostic instrumentation;
- retry G2;
- issue new authorization record;
- reset attempt state;
- start G3/downstream work.

---

## 13. Stop gate

Stop immediately after:

- one checkpoint commit;
- push;
- post-push verification.

The next gate is:

**Separate owner authorization for diagnostic-instrumentation specification/research only**

---

## Final report

Report:

- new checkpoint commit hash;
- exact files committed;
- push result;
- final `main` / `origin/main` relation;
- D2 test result;
- offline-suite result;
- retained output digest;
- final tracked/untracked working-tree state;
- remaining untracked files;
- harness SHA;
- procedure SHA;
- immutable-evidence unchanged confirmation;
- confirmation historical G2/C6/C8/T4 state is unchanged;
- confirmation no live/retry/new record/reset occurred;
- exact next gate.
