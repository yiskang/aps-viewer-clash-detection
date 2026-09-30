# For Claude — Bounded G2 Final Gate → K Commit Correction Only

I explicitly authorize **one bounded documentation-only correction** to the G2 ViewerBridge / DockingPanel live-verification procedure based on the latest independent Work v5 re-review.

This authorization is limited to:

1. the High finding on the final verdict gate → authoritative `K` commit race;
2. the Low truth-table placeholder cleanup;
3. the Low O1 wording correction.

It does **not** authorize:

- G2 harness implementation;
- live G2 execution;
- G3;
- H1/H2 host integration;
- OQ-1;
- production host composition;
- Core / Viewer Adapter / M4 / Viewer Clash Panel production changes;
- G1 F7 probe or calibration changes;
- commit or push unless separately authorized.

Use the latest independent Work v5 review as the governing remediation input.

## 1. High — Make final verdict gate → `K` commit race-free

The current procedure permits a race between the final verdict re-check and authoritative creation of exact-name `K`.

That race must be eliminated.

### Required invariant

> Once the final PASS gate has completed, no callback, timeout, promise continuation, queued task, or later fatal event may execute before the authoritative `K` commit either succeeds or definitively fails.

### Preferred model — synchronous non-yielding commit

Immediately after the final PASS gate, execute the local filesystem hard-link syscall synchronously:

`link(Kc, K)`

Requirements:

- no `await`;
- no timer;
- no timeout wrapper;
- no event-loop yield;
- no promise boundary;
- no callback dispatch between the final gate and the syscall result;
- no verdict-bearing asynchronous work remains pending at this point.

The result of that syscall is authoritative:

- success => `K` exists and PASS is committed;
- reported failure => `K` does not exist and the run is FAIL/non-PASS.

### Alternative model — fully settled async commit

Only if synchronous hard-link creation is not the chosen implementation contract:

- the asynchronous link operation must be awaited to actual completion;
- it must not use a timeout that can select FAIL while the underlying link continues;
- no cancellation model may leave the operation running after verdict selection;
- success/failure must be determined only after the filesystem operation is fully settled.

Do not permit a pattern such as `Promise.race(link(), timeout())` or any equivalent where timeout/failure can be selected while the link may later create `K`.

### Quiescence before final gate

Before the final verdict gate:

- all verdict-bearing async Viewer/page/runtime callbacks are drained, quiesced, or explicitly disabled;
- all required cleanup is complete;
- all required R1/R2/R3 evidence is durable and verified;
- all timeout-owned work is settled;
- no later callback can introduce a new fatal event.

The sequence must be mechanically explicit:

1. finish all required checks/controls/cleanup/evidence;
2. quiesce verdict-bearing asynchronous sources;
3. perform final PASS eligibility evaluation;
4. immediately perform authoritative `K` commit under the selected non-racy model;
5. after successful `K`, perform no operation capable of changing verdict or exit code.

### Crash / timeout semantics

Document:

- crash before `K` commit => no PASS;
- `link()` reported failure => no PASS;
- timeout before entering the final gate => FAIL/non-PASS;
- no timeout may wrap authoritative `K` creation in a way that allows later success;
- crash after successful `K` but before directory fsync may lose `K`, which conservatively degrades reader evidence to FAIL while authorization remains consumed.

### Reader/harness agreement

Reconfirm:

- exact-name `K` is the only verdict-authoritative PASS artifact;
- if harness reports PASS, valid `K` must exist;
- if `K` does not exist, reader cannot return PASS;
- harness must never report FAIL after successful authoritative `K` commit.

## 2. Low — Remove stale truth-table placeholder row

Correct the table so:

- every listed row is real and distinct;
- row count matches the text;
- no placeholder/merged row remains;
- references to row numbers remain correct.

Do not change verdict semantics while cleaning the table.

## 3. Low — Correct O1 wording

O1 is externally captured.

Remove any statement claiming the harness records or owns O1 write status.

The procedure must consistently distinguish:

- harness-owned evidence;
- externally captured O1 evidence;
- optional/non-authoritative stdout or logs.

O1 must not become part of authoritative verdict reconstruction unless the governing procedure explicitly says so.

## 4. Preserve already-closed areas

Do not reopen unless this correction directly reveals a contradiction:

- H1 durability is technically closed;
- H2 acyclic R1/R2/R3 structure and reader totality are closed except for this final gate→K race;
- H3/C20 is technically closed;
- D7 constants are technically ready for owner acceptance;
- R1 freeze/cutoff is closed;
- N6 uses `2^897`; C4 uses distinct `2^900`;
- C7/C18 ownership is closed;
- C17 is closed;
- C2 title lookup is closed;
- D3/D5 are technically closed;
- D6 remains deferred/non-blocking.

## 5. Owner decisions

Do not silently approve owner decisions.

Preserve:

- **D1** — owner acceptance required: Mechanical + Structure;
- **D2** — owner acceptance not ready until this High correction is independently re-reviewed;
- **D4** — owner execution-risk acceptance required: bounded real-Viewer failure injection;
- **D7** — technically ready for owner acceptance.

## 6. Targeted internal review

After editing:

1. Run one targeted internal review only over:
   - final gate quiescence;
   - final gate → `K` commit sequence;
   - timeout/cancellation semantics;
   - post-`K` invariant;
   - truth-table cleanup;
   - O1 wording.
2. Fix genuine Critical/High findings within this bounded scope.
3. Do not implement the harness.
4. Persist the review under `docs/reviews/`.
5. Update `docs/handoffs/latest.md`.

The handoff must state:

- bounded final gate→K remediation complete;
- D2 remains pending independent Work confirmation;
- harness implementation remains unauthorized;
- live G2 remains unauthorized;
- G3/H1/H2/OQ-1/host remain unauthorized;
- next action = targeted independent Work re-review, then owner decisions D1/D2/D4/D7.

## Stop gate

Stop after the documentation correction and targeted internal review.

Do not:

- implement `test/acceptance/clashpanel-viewerbridge.acceptance.mjs`;
- run G2;
- start G3/H1/H2/OQ-1/host integration;
- modify production code;
- commit or push unless separately authorized.

## Final report

Report:

- branch / HEAD / git status;
- exact sections changed;
- selected final gate→K commit model;
- proof that no yield/timeout race remains;
- quiescence rule before the final gate;
- timeout/cancellation semantics;
- truth-table cleanup;
- O1 wording correction;
- targeted internal review findings/fixes;
- remaining D1/D2/D4/D7 owner decisions;
- explicit confirmation that no harness code or live execution occurred.
