# For Claude — G2 Live Planning Only

I explicitly authorize **G2 live-planning artifacts and non-live verification only**.

This task prepares for a later, separately authorized single-use live G2 execution. It does **not** authorize activation or execution.

## Authoritative baseline

Verify first:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- expected HEAD: `996305c3efc30021180e04099e6007cc1d9afa5f`
- `main == origin/main`
- working tree clean
- accepted procedure SHA-256:
  `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- `G2_DUAL_COUNTER_GATE.resolved=true`
- `LIVE_PATH_WIRED=false`
- no live G2 attempt/evidence exists
- no single-use authorization record exists

Read:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- accepted G2 procedure
- latest independent G2 reviews
- current G2 harness
- current activation/preflight/authorization tests
- fixture-screening evidence

Treat repository state as authoritative.

If any baseline item differs materially, stop and report.

## 1. Recompute and record clean-tree identities

From the clean committed tree, recompute and record:

- repository HEAD
- procedure SHA-256
- harness file SHA-256
- any additional harness/module digest required by the accepted procedure
- relevant test/preflight version identities

Do not rely on stale values from conversation or prior handoffs.

Do **not** issue an authorization record.

## 2. Fixture identity binding

Bind the accepted fixture pair:

- `Audubon_Mechanical_clash_test.rvt`
- `Audubon_Structure_clash_test.rvt`

Verify both against committed evidence.

For Model B, preserve the independently verified encoded Structure URN:

```text
dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fU3RydWN0dXJlX2NsYXNoX3Rlc3QucnZ0
```

Required `Model-B-URN-SHA256`:

```text
806f99964bb937085874557ec2b03101a612db26031469a063446796d7ebb53d
```

Also verify Model A identity/digest from repository evidence.

Do not load either model.

## 3. Runtime envelope

Define the exact proposed live runtime envelope without launching it.

At minimum pin:

- APS Viewer `7.124.2`
- `env: 'AutodeskProduction2'`
- `api: 'streamingV2'`
- expected `isOTG() === true`
- expected `isSVF2() === true`
- Node version
- Playwright version
- Chromium version
- operating system/platform assumptions
- local-POSIX filesystem assumption used by the accepted D2 closeout protocol

Resolve actual Node/Playwright/Chromium versions from the current environment/repo tooling.

Do not start Playwright against APS Viewer.

## 4. Single-use authorization-record schema

Define the exact schema for the future live authorization record, but **do not create or issue a real authorization record**.

The schema must bind, at minimum:

- owner authorization statement/id
- exact repository HEAD
- accepted procedure SHA
- harness SHA/digest
- fixture identities / URN digests
- runtime envelope
- live command identity
- exactly-one-attempt policy
- issuance timestamp
- expiration/supersession semantics if defined
- unique authorization id
- required phrase/fields used by preflight validation

Define deterministic selection, stale/superseded rejection, ambiguity rejection, byte-hash binding, and how preflight proves it is using the intended record.

Do not make the record valid/issuable in this task.

## 5. Attempt journal / preflight rehearsal

Verify the accepted attempt-journal/preflight semantics **without consuming an attempt**.

Confirm:

- attempts/results directory creation rules
- authorization reservation semantics
- `AUTH_BOUND`
- `ATTEMPT_CONSUMED`
- exactly-one-attempt reuse prevention
- crash/orphan handling
- clean-tree requirement
- accepted HEAD/SHA binding
- fixture digest checks
- runtime envelope checks
- no live action before consumption boundary
- no attempt consumption during planning/preflight rehearsal

If existing preflight code cannot be exercised without creating durable attempt state, use a dry-run/static path only.

Do not create real reservation/journal artifacts.

## 6. Exact live command / operator runbook

Define the exact future live command line and runbook, but do not execute it.

The runbook must state:

1. required environment variables
2. required authorization-record path
3. fixture identity requirements
4. expected baseline HEAD/SHA
5. preflight checks
6. point where authorization becomes consumed
7. exact live command
8. expected timeout budget
9. expected artifact paths
10. cleanup behavior
11. exit-code/verdict mapping
12. what to do after PASS / PARTIAL / FAIL / BLOCKED
13. explicit no-retry rule
14. crash-recovery adjudication

Do not include any command that would be accidentally executable without future explicit owner authorization.

## 7. Evidence plan

Define exact future evidence artifacts and locations, including:

- attempt/reservation journal
- R1 / R2 / R3
- authoritative K
- result JSON
- summary/report
- optional/raw log status
- browser/runtime metadata
- fixture identity evidence
- Viewer identity/version evidence
- C1–C20 evidence
- N1–N8 evidence
- cleanup evidence
- error/fatal ledger
- request/response evidence
- C20 rendering evidence
- final verdict

Specify which artifact is authoritative for each category.

Do not generate live evidence now.

## 8. Timeout / cleanup / verdict expectations

Document accepted behavior for:

- global runtime cap
- per-check timeouts
- model-load timeout
- cleanup timeouts
- page/context/browser shutdown bounds
- evidence-write failure
- crash before/after attempt consumption
- K commit semantics
- C20 `NOT_EVIDENCED` → overall `PARTIAL`
- fail-first precedence
- BLOCKED conditions
- no-retry semantics

Use the accepted procedure exactly.

## 9. Interlocks

Verify and document:

- `G2_DUAL_COUNTER_GATE.resolved=true`
- `LIVE_PATH_WIRED=false`

Planning must **not** change `LIVE_PATH_WIRED`.

Define the exact future owner-authorized action required to activate the live path.

Do not flip any activation flag in this task.

## 10. Offline/non-APS verification

Run only non-live checks needed to validate the plan.

At minimum:

- focused G2 suite
- aggregate offline suite
- `npm run test:g2:binding`
- activation/preflight tests
- authorization-schema/preflight tests
- digest verification
- `git diff --check`

Do not load APS Viewer.
Do not load fixtures.
Do not create a live authorization record.
Do not consume a live attempt.

Report exact commands/results.

## 11. Live-plan artifact

Create a durable planning artifact under the established repository structure, for example:

`docs/research/2026-10-02-g2-live-execution-plan.md`

or the repository-conventional equivalent.

It must contain:

- accepted baseline identities
- fixture bindings
- runtime envelope
- authorization-record schema
- preflight/attempt semantics
- exact future live command/runbook
- evidence plan
- timeout/cleanup/verdict mapping
- no-retry policy
- remaining prerequisites
- explicit activation boundary

This is a live-execution **plan**, not execution authorization.

## 12. Focused internal review

After the plan is written:

1. perform one focused internal review against:
   - accepted procedure
   - current harness
   - D2 authorization/attempt semantics
   - fixture/runtime evidence
2. classify Critical / High / Medium / Low
3. fix genuine Critical/High planning defects within this planning-only scope
4. do not modify production code
5. do not activate live

Persist the review under `docs/reviews/`.

Update `docs/handoffs/latest.md`.

The handoff must state:

- live-planning status
- clean-tree identities
- proposed runtime envelope
- proposed authorization-record requirements
- no authorization record issued
- `LIVE_PATH_WIRED=false`
- no live attempt consumed
- next action: none / awaiting independent Work review and explicit owner authorization for activation/execution

## 13. Commit policy

Do not commit or push unless separately authorized.

Leave the planning artifacts available for independent Work review.

## 14. Stop gate

Stop after:

- live planning artifact
- non-live verification
- focused internal review
- handoff update

Do not:

- set `LIVE_PATH_WIRED=true`
- issue an authorization record
- reserve/consume a live attempt
- launch APS Viewer
- load Mechanical/Structure
- run Playwright live acceptance
- run real-Viewer failure injection
- run G2 live
- start G3/H1/H2/OQ-1/host integration
- modify production code
- commit or push

The next gate is:

**independent ChatGPT Work review of the live plan → explicit owner authorization for activation + single-use authorization-record issuance + exactly-one live G2 execution**

## 15. Final report

Report:

- branch / HEAD / origin relation
- working-tree state
- recomputed procedure/harness/HEAD identities
- fixture identities/digests
- runtime envelope
- authorization-record schema
- dry-run/preflight verification results
- exact proposed live command
- evidence paths
- timeout/cleanup/verdict expectations
- internal review findings/fixes
- remaining prerequisites
- explicit confirmation:
  - `G2_DUAL_COUNTER_GATE.resolved=true`
  - `LIVE_PATH_WIRED=false`
  - no authorization record created
  - no live attempt reserved/consumed
  - no APS Viewer/fixture load
  - no live G2
  - no production/downstream changes
  - nothing committed or pushed
