# For Claude — G2 C3/C2 Checkpoint Commit + Push Only

I explicitly authorize **one bounded C3/C2 checkpoint commit and push only** for the independently accepted harness-and-test correction.

This authorization does **not** include C8/C6/T4 work, another live run, a new authorization record, attempt reset, procedure changes, production changes, or downstream work.

Use the repository as the source of truth.

## 1. Verify baseline before staging

Verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD:
  `6f716bc0d0d2c1b1e61d26fe50b4dbe56266f7e4`
- `main == origin/main`
- immutable evidence snapshot remains unchanged:
  `docs/research/evidence/g2-live-20261004-75a3ccb9/`
- exactly-one live G2 remains historically closed at:
  `FAIL (row 3)`
- no retry occurred
- no new authorization record was issued
- no attempt state was reset
- procedure SHA remains:
  `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`

Expected reviewed uncommitted harness SHA:

`cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`

If any material baseline differs, stop and report.

## 2. Independently accepted state

Latest Work review found:

- Critical: 0
- High: 0
- Medium: 0
- Low: 2
  - intentionally coarse static-name guard
  - stale aggregate test count in the internal review

Accepted:

- C3 correction
- C2 correction
- regression coverage
- bounded sibling audit
- page-bundle/runtime neutrality
- procedure neutrality
- immutable evidence unchanged

Verified under Node `v22.23.1`:

- G2 acceptance suites: `917/917`
- offline aggregate: `5155 total / 5154 pass / 0 fail / 1 unrelated TODO`
- `git diff --check`: clean

## 3. Commit scope

Commit only the independently reviewed bounded C3/C2 change set.

Expected implementation/test scope includes:

- `test/acceptance/clashpanel-viewerbridge.acceptance.mjs`
- the reviewed C3/C2 oracle/regression test files
- `.oracles`
- `.op-refusal`
- `.runner`

Also include the related governance artifacts currently part of the reviewed working tree, including as applicable:

- `docs/reviews/2026-10-04-g2-c3-c2-bounded-correction-internal-review.md`
- `docs/reviews/2026-10-04-g2-c3-c2-bounded-correction-independent-review.md`
- `docs/handoffs/latest.md`
- related prompt artifact(s) under `docs/prompts/`

Do not stage unrelated files.

If any C8/C6/T4 implementation/test change appears, stop.

## 4. Preserve immutable evidence

Do not modify, stage changes to, or rewrite:

`docs/research/evidence/g2-live-20261004-75a3ccb9/`

It may already be tracked from the prior evidence checkpoint, but its content must remain byte-identical.

Confirm no evidence diff exists before committing.

## 5. Pre-commit verification

Before staging:

1. run `git diff --check`;
2. verify the implementation/test diff matches the independently reviewed C3/C2 scope;
3. recompute harness SHA and confirm:
   `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`;
4. verify procedure SHA unchanged;
5. verify immutable evidence unchanged;
6. verify no new authorization record / attempt reset / live evidence change exists;
7. verify C8/C6/T4 files/logic are untouched.

If any substantive difference is found, stop rather than silently fixing it.

## 6. Handoff

Before commit, ensure `docs/handoffs/latest.md` states:

- historical live attempt remains `FAIL (row 3)`;
- immutable evidence checkpoint remains authoritative;
- C3 deterministic harness defect corrected and independently accepted;
- C2 latent same-class defect corrected and independently accepted;
- no other same-class intent-key mismatch found in bounded audit;
- new harness SHA;
- procedure SHA unchanged;
- C8 remains unresolved;
- C6 remains `NOT_EVIDENCED`;
- T4 unchanged;
- no retry/new authorization record/attempt reset;
- C3/C2 checkpoint commit/push is authorized;
- next action after push:
  **separate owner authorization for D0 Viewer API evidence + D1 R1 replay only**.

Do not imply C8/C6 implementation is authorized.

## 7. Commit

Create exactly one bounded C3/C2 checkpoint commit.

After commit:

- verify working tree state;
- recompute harness SHA from committed state;
- verify it still equals:
  `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`;
- verify procedure SHA unchanged;
- verify immutable evidence unchanged.

Report the new commit hash.

## 8. Push

Push that single checkpoint commit to `origin/main`.

After push verify:

- `main == origin/main == <new checkpoint commit>`;
- ahead/behind `0/0`;
- tracked tree clean;
- harness SHA exact;
- procedure SHA unchanged;
- immutable evidence unchanged;
- no retry/new record/attempt reset occurred.

## 9. Prohibited

Do not:

- implement C8 diagnostics;
- implement C6/N2 redesign;
- change T4;
- rerun live G2;
- issue a new authorization record;
- reset attempt state;
- modify procedure/production code;
- start D0/D1 work;
- start G3/downstream work.

## 10. Stop gate

Stop immediately after the C3/C2 checkpoint is committed, pushed, and verified.

The next gate is:

**separate owner authorization for D0 Viewer API evidence + D1 R1 replay only**

## Final report

Report:

- new checkpoint commit hash;
- exact files committed;
- push result;
- final `main` / `origin/main` relation;
- final working-tree state;
- committed harness SHA;
- procedure SHA;
- immutable-evidence unchanged confirmation;
- confirmation no C8/C6/T4 change occurred;
- confirmation no retry/new record/attempt reset occurred;
- exact next gate.
