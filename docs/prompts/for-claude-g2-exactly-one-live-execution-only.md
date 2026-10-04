# For Claude — G2 Exactly-One Live Execution Only

I explicitly authorize **exactly one live G2 execution** using the final independently verified authorization record.

This authorization permits **one and only one** real harness execution attempt.

It does **not** authorize retries, record replacement, additional attempts, unrelated implementation changes, or any second live run.

Use the repository as the source of truth.

---

## 1. Final authorized baseline

Before executing anything, independently verify all of the following:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- committed HEAD:
  `75a3ccb9ba160f8afcf3c9b39a301f352b273c08`
- `main == origin/main`
- tracked tree clean
- only the previously verified allowed untracked files under `docs/prompts/`
- committed activated harness SHA:
  `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`
- accepted procedure SHA:
  `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- `LIVE_PATH_WIRED=true`
- `G2_DUAL_COUNTER_GATE.resolved=true`

Final active authorization record:

- authorization ID:
  `g2-live-20261004-75a3ccb9`
- path:
  `docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-75a3ccb9.md`
- SHA-256:
  `f68436dfbab09ad32a2ba248cf6ab63ce652b5615e82f8232f77aae9409c33c6`

Expected historical records:

- `g2-live-20261004-8a8d49f6`
  - SHA:
    `b520bc712fbf85ad848a234e0472c3f6da9f0fa724c9fe8682c657dc759db461`
- `g2-live-20261004-dbd97137`
  - SHA:
    `0f339d964794ceb54d84e3a3c13d1655cce6aac2b9796cf4c4deb3c243baa4ae`

If any baseline fact differs, **do not run the harness**. Stop and report.

---

## 2. Terminal clean-window rule remains active

Until the live attempt reaches a terminal outcome:

- do not modify any repository file;
- do not create/update `docs/handoffs/`;
- do not create/update `docs/reviews/`;
- do not edit prompts;
- do not edit plan/spec/source/tests;
- do not commit or push;
- do not mutate/delete/move any authorization record.

Only read-only verification is allowed before the actual live command.

After the single live attempt reaches a terminal state, repository writes may resume for evidence/review/handoff closeout.

---

## 3. Explicit runtime selection

Before the live command:

1. run:
   `nvm use 22.23.1`
2. verify:
   `node -v`

Required:

`v22.23.1`

Also verify:

- `playwright` `1.62.1`
- `playwright-core` `1.62.1`
- Chromium headless-shell revision `1234`
- Chromium headless-shell version `151.0.7922.34`
- Viewer envelope:
  - Viewer `7.124.2`
  - env `AutodeskProduction2`
  - API `streamingV2`

Do not proceed under Node `v26.10.0` or any other mismatch.

---

## 4. Final read-only pre-run checklist

Immediately before the live harness command, verify:

### Repository identity
- HEAD exactly:
  `75a3ccb9ba160f8afcf3c9b39a301f352b273c08`
- `main == origin/main`
- tracked tree clean
- no staged changes

### Allowed untracked files only
Expected allowed files under `docs/prompts/`:

- final active record
- the two historical superseded records
- `for-claude-g2-final-authorization-record-issuance-only.md`

If any unexpected untracked file exists, stop.

Run/read the same effective `classifyGitTreeState()` logic if available without mutating state.

Expected:
- zero blocking paths

### Record
- final record SHA exact:
  `f68436dfbab09ad32a2ba248cf6ab63ce652b5615e82f8232f77aae9409c33c6`
- exactly one active candidate
- both older records superseded
- native validator still returns `ok:true`

### Identities
Recompute and confirm:
- harness SHA
- procedure SHA
- Model A URN SHA
- Model B URN SHA

### Attempt state
Confirm:
- attempts directory absent
- no reservation
- no journal
- no `AUTH_BOUND`
- no `ATTEMPT_CONSUMED`
- no prior retained live evidence for the final record

If any pre-run check fails, **do not execute**.

---

## 5. Exactly-one execution rule

This owner authorization permits exactly one invocation of the accepted real live command.

You may run the accepted live harness command **once**.

Do not:
- rerun after PASS;
- rerun after PARTIAL;
- rerun after FAIL;
- rerun after BLOCKED;
- rerun after timeout;
- rerun after browser/Viewer failure;
- rerun after evidence-write failure;
- rerun after cleanup failure;
- rerun after crash;
- rerun after manual interruption.

A second invocation is not authorized under any circumstance.

If the command starts and reaches the accepted reservation/authorization boundary, treat the single-use authorization as spent according to the procedure even if execution later fails.

---

## 6. Do not alter command semantics

Use the exact command/invocation contract defined by the accepted governing plan and harness.

Do not:
- add debug flags;
- change fixture IDs/URNs;
- change browser mode;
- change Viewer environment;
- change runtime versions;
- change timeouts;
- disable checks;
- weaken fail-closed gates;
- bypass authorization validation;
- bypass reservation;
- bypass Phase 0;
- bypass evidence capture;
- bypass cleanup.

If the accepted command cannot be reconstructed unambiguously from the repository, stop before execution.

---

## 7. Expected execution ordering

Allow the harness to execute its accepted sequence without manual intervention:

`activation interlock`
→ `record validation/discovery`
→ `startup scan`
→ `runtime hard gates`
→ `reservation / AUTH_BOUND`
→ `Phase 0 clean-tree/browser preflight`
→ `ATTEMPT_CONSUMED`
→ `first model load`
→ live G2 checks
→ cleanup
→ evidence finalization
→ terminal verdict

Do not manually invoke individual checks outside the harness.

Do not manually load Viewer/models first.

---

## 8. Live test scope

Run only the authorized G2 live verification defined by the accepted procedure/plan.

Do not broaden into:

- G3;
- new product testing;
- host integration;
- OQ-1;
- unrelated Viewer experiments;
- additional fixtures;
- extra browser sessions;
- exploratory retries.

The goal is to execute the accepted exactly-one G2 attempt and capture its authoritative result.

---

## 9. During execution

Do not modify repo files manually while the harness is running.

Do not:
- edit the authorization record;
- edit source/tests;
- clean/remove attempt state;
- alter generated evidence;
- restart the process manually;
- restart browser/Viewer independently;
- intervene to "fix" a failing check.

Let the harness terminate according to its accepted failure/timeout/cleanup semantics.

---

## 10. Terminal outcomes

Accept the harness's procedure-conformant terminal outcome.

Possible terminal classes include only those defined by the accepted procedure, such as:

- PASS
- PARTIAL
- FAIL
- BLOCKED

Do not reinterpret or upgrade a verdict manually.

In particular:

- unresolved cleanup ownership must remain fail-closed according to the accepted procedure;
- C20 `NOT_EVIDENCED` semantics remain as accepted;
- evidence-write or cleanup failures must follow the accepted verdict precedence;
- no retry is allowed.

---

## 11. Crash / interruption semantics

If the harness crashes, the browser crashes, the terminal closes, the machine sleeps/reboots, or execution is interrupted:

- do not rerun;
- do not delete attempts/journals;
- do not reset the record;
- do not replace the record;
- preserve all durable state exactly as left;
- move directly to post-attempt forensic/evidence closeout.

The exactly-one authorization is consumed/spent according to the accepted procedure state reached before interruption.

---

## 12. After the attempt terminates

Once the single attempt has definitively terminated, the terminal clean-window restriction ends.

At that point:

1. do **not** run the harness again;
2. inspect the generated durable evidence;
3. verify reservation/journal/attempt state;
4. verify R1/R2/R3/K/result/summary/evidence artifacts required by the procedure;
5. verify final verdict consistency;
6. verify cleanup evidence;
7. verify authorization record disposition;
8. preserve all evidence.

Do not manually edit generated live evidence.

---

## 13. Post-attempt internal review

After the attempt only, perform one focused internal review of the actual live result.

Review:

- authorization/attempt lifecycle;
- runtime identity;
- fixture identity;
- C1–C20;
- N1–N8;
- request/fatal ledgers;
- C20 rendering evidence;
- cleanup;
- R1/R2/R3/K;
- final verdict;
- evidence completeness;
- any crash/timeout/failure condition.

Classify:

- Critical
- High
- Medium
- Low

Do not fix production/harness behavior during this review.

Persist under:

`docs/reviews/`

Update:

`docs/handoffs/latest.md`

only after the attempt is over.

---

## 14. Handoff after the live attempt

After the attempt, update the handoff with:

- branch / HEAD;
- working-tree state;
- authorization ID;
- attempt ID;
- final record SHA;
- committed harness/procedure SHAs;
- runtime versions;
- final live verdict;
- whether attempt was consumed;
- evidence artifact paths;
- cleanup status;
- any blocker/failure;
- next action:
  **independent Work review of live G2 evidence and verdict**.

Do not authorize another live attempt.

---

## 15. Commit / push policy after the attempt

Do not automatically commit or push live evidence/reviews/handoff unless the governing repository workflow already explicitly requires it and doing so cannot overwrite/generated evidence semantics.

If commit/push authorization is not already explicit, leave the post-attempt artifacts uncommitted and report that they are ready for independent Work review.

The single live execution authorization does not implicitly authorize unrelated commits/pushes.

---

## 16. Stop gate

After the single live attempt terminates and post-attempt evidence/review/handoff work is complete:

- stop;
- do not rerun;
- do not issue a new record;
- do not authorize a second attempt.

The next gate is:

**Independent Work review of the exactly-one live G2 evidence and terminal verdict**

---

## Final report

Report:

- exact live command used;
- Node/runtime versions;
- authorization ID;
- record SHA;
- attempt/reservation ID;
- whether `AUTH_BOUND` occurred;
- whether `ATTEMPT_CONSUMED` occurred;
- whether Viewer/models loaded;
- final terminal verdict;
- exact verification counts/results;
- evidence artifact paths;
- cleanup status;
- internal review findings;
- working-tree state after closeout;
- confirmation that no second live execution occurred.

Explicitly confirm:

- exactly one live harness invocation was made;
- no retry occurred;
- no second authorization record was issued;
- no manual evidence mutation occurred;
- next gate is independent Work review only.
