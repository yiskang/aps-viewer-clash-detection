# For Claude — G2 D2 Specification Checkpoint Commit + Push Only

I explicitly authorize **one documentation-only D2 specification checkpoint commit and push** for the independently accepted corrected D2 synthetic-transition specification.

This authorization does **not** include D2-OFFLINE simulator implementation, harness/test/product/procedure changes, T4/C6/C8 changes, live diagnostics, retry, new authorization-record issuance, or downstream work.

Use the repository as the source of truth.

## 1. Verify baseline before staging

Verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD:
  `dee0850b1fbcf23ff8762cf614b4cb4ca88b2836`
- `main == origin/main`
- simulator directory does not exist
- harness SHA unchanged
- procedure SHA unchanged
- immutable evidence unchanged
- historical G2 remains `FAIL (row 3)`
- C6 remains `NOT_EVIDENCED`
- C8 remains unresolved
- T4 remains unchanged
- no live retry
- no new authorization record
- no attempt reset
- `git diff --check` clean

If any material baseline differs, stop and report.

## 2. Independently accepted state

Latest Work re-review found:

- Critical: 0
- High: 0
- Medium: 0
- Low: 3

Remaining Lows are non-blocking:

- one THROW example frame number
- compact trace encoding
- runtime-version wording

Accepted:

- corrected D2 state machine
- δ=0 causal ordering
- restore/autocam modeling
- request-tagged oracle
- classifier/outcome mapping
- numeric T4 fidelity
- unified separation formulas
- D=1 and D=30 characterization
- tail-stall sensitivity
- timeout/counter semantics
- schedule recount
- THROW/settle/outcome semantics
- runtime hash checks
- geometry exactness
- bounded witness/output caps
- historical/synthetic boundary
- reproducibility
- all prior blocking findings closed

D2-OFFLINE may be separately authorized **only after a clean checkpoint**.

## 3. Commit scope

Commit only the independently reviewed D2 documentation/governance artifacts.

Expected scope includes, as applicable:

- `docs/research/2026-10-04-g2-d2-synthetic-transition-spec.md`
- `docs/reviews/2026-10-04-g2-d2-synthetic-transition-spec-internal-review.md`
- `docs/reviews/2026-10-04-g2-d2-synthetic-transition-spec-independent-review.md`
- `docs/reviews/2026-10-04-g2-d2-corrected-targeted-independent-rereview.md`
- `docs/handoffs/latest.md`
- directly related D2 spec/remediation/review prompts under `docs/prompts/`

Do not stage unrelated files.

If any simulator code, harness, tests, product code, procedure, or evidence file appears in the staged diff, stop.

## 4. Preserve code/evidence state

Confirm before commit:

- no simulator directory exists;
- harness SHA unchanged;
- procedure SHA unchanged;
- immutable evidence directory has no diff;
- no T4/C6/C8 implementation change;
- no authorization/attempt/live state change.

## 5. Pre-commit verification

Before staging:

1. run `git diff --check`;
2. inspect all changed/untracked files;
3. verify the D2 spec matches the independently reviewed version;
4. confirm only docs/research/reviews/handoff/prompt artifacts are in scope;
5. verify no code/test/procedure/evidence modifications exist.

Do not make substantive edits merely to clean up the three accepted Lows.

If a substantive difference is found, stop instead of silently correcting it.

## 6. Handoff

Before commit, ensure `docs/handoffs/latest.md` states:

- baseline `dee0850b...`;
- corrected D2 spec independently accepted;
- checkpoint commit/push authorized;
- remaining 3 Low findings are non-blocking;
- no simulator implementation exists;
- C8 unresolved;
- C6 `NOT_EVIDENCED`;
- T4 unchanged;
- no live retry/new record/attempt reset;
- next action after push:
  **separate owner authorization for D2-OFFLINE synthetic simulator implementation only**.

Do not imply simulator implementation is already authorized.

## 7. Commit

Create exactly one documentation-only D2 spec checkpoint commit.

After commit:

- verify working tree state;
- verify no simulator/code/test/procedure/evidence file entered the commit;
- verify harness SHA unchanged;
- verify procedure SHA unchanged;
- verify immutable evidence unchanged.

Report the new commit hash.

## 8. Push

Push that single checkpoint commit to `origin/main`.

After push verify:

- `main == origin/main == <new checkpoint commit>`;
- ahead/behind `0/0`;
- tracked tree clean;
- simulator still absent;
- harness SHA unchanged;
- procedure SHA unchanged;
- immutable evidence unchanged;
- no retry/new record/attempt reset occurred.

## 9. Prohibited

Do not:

- implement D2-OFFLINE simulator;
- create simulator files/directories;
- modify harness/tests/product/procedure;
- change T4/C6/C8 logic;
- run Viewer/browser/live G2;
- issue new authorization record;
- reset attempt state;
- start G3/downstream work.

## 10. Stop gate

Stop immediately after the D2 spec checkpoint is committed, pushed, and verified.

The next gate is:

**separate owner authorization for D2-OFFLINE synthetic simulator implementation only**

## Final report

Report:

- new checkpoint commit hash;
- exact files committed;
- push result;
- final `main` / `origin/main` relation;
- final working-tree state;
- simulator-absent confirmation;
- harness SHA;
- procedure SHA;
- immutable-evidence unchanged confirmation;
- confirmation C8/C6/T4 unchanged;
- confirmation no retry/new record/attempt reset occurred;
- exact next gate.
