# For Claude — G2 Effective-State Wording Correction Only

I explicitly authorize **one tiny documentation/schema correction only** to the G2 RC1-C2 procedure.

This authorization is limited to the single remaining Medium finding from the latest independent Work review:

- `executionRecord.terminalState`
- `dependencyBlockedBy`

must both use the existing **effective-state** rule:

- for `control-run`: effective state = `state`
- for `gate-disposition`: effective state = `disposition`

It does **not** authorize:

- harness edits;
- implementation changes;
- commit or push;
- `LIVE_PATH_WIRED` activation;
- authorization-record issuance;
- live G2;
- real-Viewer failure injection;
- production/Core/Viewer Adapter/M4/Panel changes;
- G3;
- H1/H2 host integration;
- OQ-1;
- host integration.

Use the latest independent Work RC1-C2 re-review as the governing input.

## 1. Verify baseline

Verify:

- branch `main`;
- HEAD `68ef222f097d5ff34b475fdb3980fe662574ac3d`;
- `main == origin/main`;
- current RC1-C2 procedure is the one reviewed by Work;
- dormant harness unchanged;
- `LIVE_PATH_WIRED=false`;
- no live G2 attempt/evidence exists.

Read:

- current G2 procedure;
- `docs/reviews/2026-10-01-g2-procedure-rc1-c2-final-independent-rereview.md`;
- `docs/handoffs/latest.md`.

## 2. Apply only the effective-state correction

Correct the exact schema wording so that:

### `executionRecord.terminalState`

It is defined as the control/check record's **effective state**, using:

- `state` when `recordType === "control-run"`;
- `disposition` when `recordType === "gate-disposition"`.

Do not require `gate-disposition.state`.

### `dependencyBlockedBy`

Any comparison/reference to the blocking control/check state must also use the same effective-state accessor:

- `state` for `control-run`;
- `disposition` for `gate-disposition`.

Do not refer directly to a raw `.state` field when the record may be a gate disposition.

## 3. Preserve all other RC1-C2 semantics

Do not change:

- global C1 gate behavior;
- `recordType` discriminated union;
- synthetic gate-disposition semantics;
- NRDB legality;
- N7/N8 dependencies;
- fatal witness/count semantics;
- C15(e);
- HTTP >=400 policy;
- request classifier;
- prefix provenance;
- operation ledgers;
- procedure examples/matrix except where a direct wording cross-reference must be updated.

No semantic expansion is authorized.

## 4. Targeted internal check

After editing:

1. Run one targeted internal check/review only over:
   - `executionRecord.terminalState`;
   - `dependencyBlockedBy`;
   - any directly affected schema/example wording.
2. Confirm no stale direct `.state` reference remains where a `gate-disposition` may appear.
3. Fix only genuine Critical/High issues caused by this correction.
4. Update `docs/handoffs/latest.md`.

Do not start another broader remediation cycle.

## 5. Stop gate

Stop after:

- the wording/schema correction;
- targeted internal check;
- handoff update.

Do not:

- edit the harness;
- commit or push;
- enable live path;
- issue authorization records;
- run live G2;
- modify production code.

## 6. Final report

Report:

- branch / HEAD / git status;
- exact lines/sections changed;
- final effective-state definition;
- confirmation no stale raw `.state` reference remains for gate-disposition-capable fields;
- targeted review/check result;
- confirmation dormant harness unchanged;
- confirmation `LIVE_PATH_WIRED=false`;
- confirmation no live run, commit, or push occurred.

Next action after this task remains: independent Work re-review before any commit or harness follow-up authorization.
