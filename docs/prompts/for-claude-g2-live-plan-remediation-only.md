# For Claude — G2 Live Plan Remediation Only

I explicitly authorize **one bounded live-plan/documentation remediation only** based on the latest independent Work review.

This authorization is limited to exactly two required corrections:

1. **High — PARTIAL verdict contradiction**
   - fix the live plan so indeterminate cleanup ownership cannot produce `PARTIAL` unless that outcome is legal under the accepted procedure;
   - align the plan's verdict mapping exactly with the accepted procedure.

2. **Medium — hard runtime preflight gates**
   - require exact runtime enforcement before any future activation/execution for:
     - Node `v22.23.1`
     - Playwright `1.62.1`
     - Chromium `151.0.7922.34`

This task is **plan/documentation only**.

It does **not** authorize:

- harness changes;
- procedure changes;
- production/Core/Viewer Adapter/M4/Panel changes;
- `LIVE_PATH_WIRED=true`;
- activation preparation;
- authorization-record issuance;
- attempt reservation or consumption;
- APS Viewer launch;
- fixture load;
- live G2;
- G3;
- H1/H2 host integration;
- OQ-1;
- host integration;
- commit or push.

Use repository state as source of truth.

---

## 1. Verify baseline first

Before editing, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- expected HEAD:
  `996305c3efc30021180e04099e6007cc1d9afa5f`
- `main == origin/main`
- working tree contains only the current live-planning docs/review/handoff changes
- accepted procedure SHA:
  `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- `G2_DUAL_COUNTER_GATE.resolved=true`
- `LIVE_PATH_WIRED=false`
- no live G2 attempt/evidence
- no authorization record
- no reservation/attempt state
- no production/downstream changes

Read:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- `docs/research/2026-10-02-g2-live-execution-plan.md`
- `docs/reviews/2026-10-02-g2-live-execution-plan-independent-review.md`
- current accepted G2 procedure
- current activation/preflight/version-check tests as reference only

If baseline differs materially, stop and report.

---

## 2. High — correct PARTIAL verdict mapping

The current live plan permits a cleanup-ownership indeterminate condition to map to `PARTIAL`, but the accepted procedure does not allow that `PARTIAL` outcome in that state.

The live plan must not describe or authorize a verdict that the accepted procedure cannot produce.

### Required correction

Trace the accepted procedure's exact verdict rows and cleanup-ownership semantics.

Rewrite the live plan so that:

- `PARTIAL` is used **only** where the procedure explicitly permits it;
- indeterminate cleanup ownership follows the procedure's actual fail-closed / non-PARTIAL disposition;
- no plan wording invents a new verdict state;
- no operator runbook step interprets indeterminate cleanup ownership as `PARTIAL` unless ownership has reached the procedure-required resolved state;
- C20 `NOT_EVIDENCED` / `PARTIAL` semantics remain unchanged where already procedure-valid.

Do **not** amend the procedure.

If the accepted procedure itself is ambiguous, stop and report instead of silently choosing a new rule.

### Plan sections to reconcile

Update all directly affected plan sections, including as applicable:

- verdict mapping table;
- cleanup ownership handling;
- exit-code mapping;
- operator instructions after terminal verdict;
- evidence expectations;
- runbook disposition for `PASS` / `PARTIAL` / `FAIL` / `BLOCKED`.

Add a short consistency note mapping the plan's terminal outcomes to the accepted procedure rows.

---

## 3. Medium — hard runtime-version preflight gates

The plan currently records Node / Playwright / Chromium versions but does not require the future harness/preflight to reject mismatches.

Update the live plan so future activation/execution requires exact hard preflight checks for:

- Node: `v22.23.1`
- Playwright: `1.62.1`
- Chromium: `151.0.7922.34`

### Required plan contract

Before attempt reservation/consumption and before any APS/Viewer action:

- detect actual Node version;
- detect installed Playwright version;
- detect actual Chromium version used for the run;
- compare each to the accepted required value;
- reject on any mismatch;
- retain the detected values and rejection reason in non-consuming preflight evidence/logging where applicable.

A mismatch must prevent the run from reaching:

- authorization reservation;
- `AUTH_BOUND`;
- `ATTEMPT_CONSUMED`;
- APS Viewer launch;
- fixture load.

The plan must clearly state that these are **hard preflight gates**, not manual operator checks.

### OS / filesystem

Preserve Work's disposition:

- OS/platform and local APFS/POSIX assumptions may remain recorded/verified as currently accepted unless the procedure requires a harder gate;
- do not add extra hard gates without justification.

---

## 4. Preserve Work's accepted dispositions

Do not reopen these unless this remediation directly exposes a contradiction:

### No separate preflight-only mode required

Work accepted that a separate non-consuming harness preflight mode is not required.

Keep the manual/operator pre-check approach where already accepted, while ensuring the future hard runtime-version gates occur before reservation/consumption.

Do not design a new preflight-only execution mode in this task.

### Model A identity

Work accepted that the committed Model-A URN plus deterministic SHA recomputation is sufficient for the accepted identity contract.

Do not require new object/content digests.

### Authorization metadata

`issuedAt`, `expiresAt`, explicit record version, and similar metadata are optional under the current accepted schema.

Do not make them mandatory in this remediation.

You may retain them as optional recommended fields if already present in the plan.

### Fixed R1–R3 names

Preserve the current disposition that fixed R1–R3 names are a non-blocking evidence-durability limitation for this single-use gate.

Do not redesign result storage in this task.

### Other Low findings

Preserve the remaining Low findings from Work:

- authorization-record TOCTOU;
- optional issue/expiry/version metadata;
- fixed R1–R3 filenames;
- cleanup-timeout plumbing.

Do not broaden scope to fix them.

---

## 5. Activation boundary

Do not change activation mechanics.

The plan must still state:

- `G2_DUAL_COUNTER_GATE.resolved=true`
- `LIVE_PATH_WIRED=false`
- activation requires a later, separate owner authorization
- authorization-record issuance requires a later, separate owner authorization
- exactly-one live execution requires a later, separate owner authorization

This remediation must not move the project into activation preparation.

---

## 6. Authorization-record schema

Do not issue a record.

Keep the existing schema unless the two required plan fixes require a direct wording adjustment.

Preserve:

- exact HEAD binding
- accepted procedure SHA binding
- harness SHA binding
- fixture identity binding
- runtime envelope binding
- exact command identity
- single-use semantics
- ambiguity/stale-record rejection

Add the exact required runtime versions to the future record/runtime-binding description if not already explicit.

---

## 7. Non-live verification

Run only non-live checks needed to validate the corrected plan.

At minimum:

- targeted grep/schema consistency checks for verdict mapping;
- targeted checks that Node / Playwright / Chromium exact versions appear as hard preflight requirements;
- existing activation/preflight/authorization tests as read-only evidence where useful;
- `git diff --check`.

Do not:

- launch APS Viewer;
- load fixtures;
- create authorization record;
- reserve/consume an attempt.

If existing tests cannot validate the new hard-version requirements because implementation has not yet been authorized, document the future activation-preparation test work in the plan rather than modifying harness/tests now.

---

## 8. Focused internal review

After correcting the plan:

1. run one focused internal review over:
   - verdict mapping / cleanup ownership;
   - hard runtime-version gate requirements;
   - activation boundary consistency;
   - authorization/runbook cross-references;
2. classify Critical / High / Medium / Low;
3. fix genuine Critical/High **planning** defects within this documentation-only scope;
4. do not modify harness/procedure/production code.

Persist the review under `docs/reviews/`.

Update `docs/handoffs/latest.md`.

The handoff must state:

- live-plan remediation status;
- PARTIAL contradiction status;
- required hard runtime-version gates;
- `LIVE_PATH_WIRED=false`;
- no authorization record issued;
- no attempt reserved/consumed;
- live execution remains unauthorized;
- next action: none / awaiting targeted independent Work re-review.

---

## 9. Commit policy

Do not commit or push unless separately authorized.

Leave the corrected planning artifacts available for independent Work review.

---

## 10. Stop gate

Stop after:

- plan-only remediation;
- non-live verification;
- focused internal review;
- handoff update.

Do not:

- modify harness/tests/procedure;
- set `LIVE_PATH_WIRED=true`;
- start activation-preparation implementation;
- issue an authorization record;
- reserve/consume an attempt;
- launch APS Viewer;
- load fixtures;
- run live G2;
- modify production/downstream code;
- commit or push.

Next gate:

**targeted independent Work re-review of the remediated live plan → owner decision on plan checkpoint commit and later activation-preparation authorization**

---

## 11. Final report

Report:

- branch / HEAD / origin relation;
- working-tree state;
- plan sections changed;
- final cleanup-ownership / PARTIAL verdict mapping;
- exact hard runtime-version preflight requirements;
- preserved Low dispositions;
- non-live verification performed/results;
- internal review findings/fixes;
- whether the plan appears ready for independent acceptance;
- explicit confirmation:
  - `G2_DUAL_COUNTER_GATE.resolved=true`
  - `LIVE_PATH_WIRED=false`
  - no authorization record created
  - no attempt reserved/consumed
  - no APS Viewer/fixture load
  - no live G2
  - no harness/procedure/production changes
  - nothing committed or pushed.
