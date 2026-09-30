# For Claude — G2 Procedure and Owner-Decision Closeout Commit Only

I explicitly authorize **documentation-only closeout and commit** for the G2 ViewerBridge / DockingPanel procedure review cycle.

This authorization is limited to:
- recording accepted owner decisions D1, D2, D4, and D7;
- preserving D3/D5 as technically accepted and D6 as deferred/non-blocking;
- applying the single optional non-blocking wording cleanup from the final Work review;
- committing the complete G2 procedure/review/prompt/handoff/decision artifact set;
- leaving a clean baseline for later G2 harness implementation.

It does **not** authorize:
- G2 harness implementation;
- live G2 execution;
- G3;
- H1/H2 host integration;
- OQ-1;
- production host composition;
- Core / Viewer Adapter / M4 / Viewer Clash Panel production changes;
- G1 F7 probe or calibration changes;
- push, unless separately authorized.

## 1. Verify repository state first

Before editing or staging:
- verify repo in scope;
- branch `main`;
- expected HEAD `f139dda375d6aa466698207def745e94e2cc5abd`;
- relation to `origin/main`;
- working-tree state;
- all current uncommitted changes are docs/prompt/review/handoff artifacts only;
- no harness or implementation file exists;
- no live G2 execution occurred.

Read `CLAUDE.md`, `docs/handoffs/latest.md`, the current G2 procedure, latest final targeted Work review, latest internal review, and directly relevant prior G2 reviews as needed.

If any implementation/code file is unexpectedly modified or untracked, stop and report before committing.

## 2. Record owner decisions

### D1 — Accepted
Approve `Audubon_Mechanical_clash_test.rvt` + `Audubon_Structure_clash_test.rvt` as the bounded two-model G2 fixture pair.

### D2 — Accepted
Approve the independently reviewed fail-first verdict policy, durable closeout protocol, pre-closeout/pre-link split, synchronous non-yielding final gate → `fs.linkSync(Kc, K)` commit, exact-name K authority model, fail-closed reader semantics, and bounded local Darwin/POSIX hard-link assumptions.

OS-crash loss of K may only conservatively degrade evidence to non-PASS while authorization remains consumed.

### D4 — Accepted as a harness technique only
Approve bounded real-Viewer failure injection as part of the G2 harness design.

This does **not** authorize live execution. Live G2 remains a separate owner gate after harness implementation and independent review.

### D7 — Accepted
Approve C20 as a verdict-bearing positive-evidence oracle; missing/ambiguous rendering => `NOT_EVIDENCED`; overall G2 capped at `PARTIAL` while C20 is not evidenced; accept the reviewed PASS-granting rendering constants/capture budget within the bounded G2 envelope.

Preserve:
- D3 — technically accepted
- D5 — technically accepted
- D6 — deferred/non-blocking

## 3. Optional Low wording cleanup

If still present, fix the non-blocking wording issue:
- X1–X19 should not all be described as `computeOverall` tests;
- X15–X19 are closeout/reader behavior examples.

Do not reopen semantics or start another review cycle for this editorial cleanup.

## 4. Closeout artifact integrity

Ensure the commit includes all relevant current G2 artifacts, including as applicable:
- current G2 procedure;
- all G2 internal reviews;
- all independent Work G2 reviews/re-reviews;
- tracked G2 remediation prompts;
- owner-decision closeout artifact if repository convention uses one;
- `docs/handoffs/latest.md`.

Do not omit relevant untracked review/prompt artifacts merely because they are untracked now. Do not include unrelated files.

## 5. Handoff final state

Update `docs/handoffs/latest.md` to state:
- G2 procedure review cycle is closed;
- final procedure has 0 Critical / 0 High / 0 Medium blocking findings;
- remaining wording issue is non-blocking/editorial if not already fixed;
- D1 accepted;
- D2 accepted;
- D4 accepted as harness-design technique only;
- D7 accepted;
- D3/D5 technically accepted;
- D6 deferred/non-blocking;
- G2 harness implementation is **not authorized by this task**;
- live G2 is not authorized;
- G3/H1/H2/OQ-1/host remain unauthorized;
- next authorized action: none / awaiting explicit owner authorization for **G2 harness implementation only**.

Keep the handoff concise and link to authoritative artifacts.

## 6. Pre-commit verification

Before committing:
- verify only documentation/prompt/review/handoff files are staged;
- run `git diff --check`;
- confirm no code/harness/production file is staged;
- confirm no live evidence was generated;
- confirm no downstream gate was started.

Do not run live tests.

## 7. Commit

Create one documentation-only closeout commit with a concise message for the G2 procedure + owner-decision closeout.

After commit:
- require clean `git status`;
- report new commit hash;
- report exact committed files;
- report final branch / HEAD;
- report relation to `origin/main`.

Do **not push** unless separately authorized.

## Stop gate

Stop after the closeout commit.

Do not:
- implement the G2 harness;
- create `test/acceptance/clashpanel-viewerbridge.acceptance.mjs`;
- run live G2;
- start G3;
- start H1/H2/OQ-1/host integration;
- modify production code;
- push.

## Final report

Report:
- branch / HEAD before and after;
- closeout commit hash;
- exact files committed;
- final `git status`;
- `origin/main` relationship;
- D1/D2/D4/D7 final dispositions;
- D3/D5/D6 status;
- whether the optional wording cleanup was applied;
- explicit confirmation that no harness implementation or live execution occurred;
- explicit confirmation that nothing was pushed.
