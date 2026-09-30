# For Claude — G2 Dormant Harness Checkpoint Commit Only

I explicitly authorize **one dormant checkpoint commit** for the current G2 ViewerBridge / DockingPanel harness implementation.

This authorization is limited to committing the already-reviewed, offline-verified, live-disabled harness checkpoint and its associated tests/reviews/handoff.

It does **not** authorize:

- any G2 procedure amendment;
- fixing C15(e);
- reconciling X4;
- changing request-fatality policy;
- enabling the live path;
- changing `LIVE_PATH_WIRED=false`;
- issuing a live authorization record;
- any live G2 execution;
- any real-Viewer failure injection;
- G3;
- H1/H2 host integration;
- OQ-1;
- host integration;
- production/Core/Viewer Adapter/M4/Panel changes;
- push, unless separately authorized.

Use the latest independent Work harness review as the governing checkpoint review.

## 1. Verify repository state

Before staging anything, independently verify:

- repository in scope;
- branch: `main`;
- expected HEAD: `82dab8244d8d83f3cb824b05199d7a2ce5b0f2e0`;
- `main == origin/main`;
- working tree contains only the current G2 harness/tests/review/prompt/handoff changes;
- no production/Core/Viewer Adapter/M4/Panel file changed;
- no live G2 run occurred;
- no APS fixture was loaded;
- no Playwright live acceptance run occurred;
- no real-Viewer failure injection occurred;
- `LIVE_PATH_WIRED=false`.

Read:

- `CLAUDE.md`;
- `docs/handoffs/latest.md`;
- accepted G2 procedure;
- `docs/reviews/2026-10-01-g2-harness-implementation-internal-review.md`;
- `docs/reviews/2026-10-01-g2-harness-implementation-independent-review.md`.

Treat repository state as authoritative.

If any unexpected implementation outside the authorized harness scope exists, stop and report before committing.

## 2. Preserve the reviewed harness exactly

Do not fix or redesign the harness in this task.

The checkpoint must preserve the exact reviewed implementation state, including:

- `test/acceptance/clashpanel-viewerbridge.acceptance.mjs`;
- all sibling `clashpanel-viewerbridge.acceptance.*.test.mjs` files;
- D2 journal/reservation/closeout implementation;
- R1/R2/R3 chain;
- fail-closed reader;
- synchronous non-yielding gate → `fs.linkSync(Kc, K)`;
- AST/static critical-block guards;
- N6 boundary/property tests;
- C20/N8 implementation;
- D4 dormant failure-injection hooks;
- `LIVE_PATH_WIRED=false`.

Do not activate dormant code.

## 3. Preserve known live blockers

Record and preserve these as unresolved **live-planning blockers**, not checkpoint blockers.

### C15(e) — procedure defect

Latest independent Work disposition:

- after marker cleanup, `ViewerBridge.inspectLedger()` necessarily returns `null`;
- the harness correctly implements the literal accepted procedure;
- the procedure requires an impossible post-clear observable;
- no production change is required;
- C15(e) must be amended before live execution planning/authorization.

Do not fix C15(e) in this task.

### X4 — procedure contradiction

Latest independent Work disposition:

- Model-B loss makes mandatory controls non-acceptable;
- row-4 `FAIL` wins before row-6 `BLOCKED`;
- current X4 expectation is contradictory.

Do not reconcile X4 in this task.

### Request-fatality policy

Latest independent Work disposition:

- `console.error` fatality matches the accepted empty allow-list;
- treating every `requestfailed` as required-resource failure is broader than the accepted procedure;
- expected unload cancellation/noise could be misclassified.

Do not change this policy in this task.

## 4. Preserve accepted implementation findings

Record these as accepted:

- H1 deadline fix accepted — the 20-minute-cap PASS race is closed;
- H2 C20/N8 fix accepted — oversized evidence no longer produces false control failure;
- N8 discrimination risk is a fixture/camera-dependent limitation, not a harness blocker;
- D2 closeout implementation is correct;
- live interlock is effective while `LIVE_PATH_WIRED=false`.

## 5. Preserve Model-B authoritative identity

Record the independently verified Model-B requirement for later live preflight.

Encoded Structure URN:

```text
dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fU3RydWN0dXJlX2NsYXNoX3Rlc3QucnZ0
```

Required `Model-B-URN-SHA256`:

```text
806f99964bb937085874557ec2b03101a612db26031469a063446796d7ebb53d
```

Do not load the model.

Do not add a second runtime Model-B URN input if the reviewed harness does not already require one.

## 6. Verify offline test baseline

Before commit, rerun only the already-authorized offline/non-live checks needed to confirm the checkpoint has not changed.

At minimum:

```text
node --test test/acceptance/clashpanel-viewerbridge.acceptance.*.test.mjs
node scripts/run-tests.mjs
```

Expected reviewed baseline:

- focused G2 harness suite: 361 pass / 0 fail;
- aggregate suite: 4607 total / 4606 pass / 0 fail / 1 existing TODO.

If results differ, stop and report rather than fixing in this checkpoint task.

Do not run any live command.

## 7. Handoff update

Update `docs/handoffs/latest.md` to state:

- G2 harness implementation checkpoint is complete and dormant;
- checkpoint is offline-verified;
- `LIVE_PATH_WIRED=false`;
- no live G2 attempt exists;
- no real-Viewer failure injection occurred;
- harness is accepted for checkpoint commit but **not live-ready**;
- C15(e), X4, and request-fatality reconciliation are required before live planning/authorization;
- H1/H2 implementation fixes are accepted;
- Model-B URN/digest are independently verified;
- next authorized action after this commit: none / awaiting explicit owner authorization for bounded procedure reconciliation;
- live G2 remains unauthorized;
- G3/H1/H2/OQ-1/host remain unauthorized.

Keep the handoff concise and link to the authoritative review artifacts.

## 8. Pre-commit checks

Before committing:

- verify only authorized G2 harness/test/docs/prompt/handoff files are staged;
- run `git diff --check`;
- confirm no production/Core/Viewer Adapter/M4/Panel files are staged;
- confirm `LIVE_PATH_WIRED=false`;
- confirm no live evidence/result/attempt artifacts exist;
- confirm no procedure amendment is staged.

## 9. Commit

Create one dormant-checkpoint commit with a concise message indicating:

- G2 harness implementation checkpoint;
- offline verified;
- live disabled.

After committing:

- require clean `git status`;
- report the new commit hash;
- report exact files committed;
- report final branch / HEAD;
- report relation to `origin/main`.

Do **not push** unless separately authorized.

## Stop gate

Stop after the dormant checkpoint commit.

Do not:

- amend the G2 procedure;
- fix C15(e);
- reconcile X4;
- change request-fatality policy;
- enable `LIVE_PATH_WIRED`;
- run live G2;
- issue live authorization;
- execute real-Viewer failure injection;
- start G3/H1/H2/OQ-1/host integration;
- modify production code;
- push.

## Final report

Report:

- branch / HEAD before and after;
- checkpoint commit hash;
- exact files committed;
- offline test results;
- final `git status`;
- `origin/main` relationship;
- confirmation `LIVE_PATH_WIRED=false`;
- confirmation no live attempt/evidence exists;
- unresolved blockers:
  - C15(e)
  - X4
  - request-fatality policy
- confirmation that nothing was pushed.
