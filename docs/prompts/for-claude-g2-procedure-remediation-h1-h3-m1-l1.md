# For Claude — Bounded G2 Procedure Remediation Only

I explicitly authorize **documentation/procedure remediation only** for the G2 ViewerBridge / DockingPanel live-verification procedure.

This authorization is limited to correcting the latest independent Work findings:

- H1–H3
- M1
- L1

It does **not** authorize:
- G2 harness implementation;
- any live G2 execution;
- G3;
- H1/H2 host integration;
- OQ-1;
- production host composition;
- Core / Viewer Adapter / M4 / Viewer Clash Panel production changes;
- any F7 probe or calibration change;
- any next milestone.

Use the latest independent Work review as the governing remediation input.

## H1 — Close the crash/reuse window before `AUTH_BOUND`

Redesign the authorization/journal sequence so durable authorization binding happens before any action that can consume or reserve the live attempt.

Define a mechanically realizable state machine and write order covering:

- NOT_STARTED
- AUTH_BOUND
- ATTEMPT_CONSUMED
- COMPLETED
- FAILED
- inferred/recovered CRASHED

Specify:

- exact authorization artifact selection;
- artifact SHA-256;
- repo HEAD;
- procedure hash/version;
- fixture/runtime envelope;
- attempt id;
- durable journal write order;
- what constitutes the consumption boundary;
- what happens after a crash before/after consumption;
- how a second run is rejected when prior durable state exists.

Do not make durability claims stronger than the implementation can realistically provide.

## H2 — Required evidence-write failure must force non-PASS

Make evidence durability a mandatory PASS condition.

Define:

- required artifacts;
- write order;
- write-success verification;
- partial-artifact handling;
- journal finalization;
- how evidence-write failure interacts with primary check/cleanup failure.

Required behavior:

- all checks PASS + required JSON/report write failure => FAIL
- all checks PASS + journal finalization failure => FAIL
- primary check FAIL + evidence-write failure => FAIL with both causes retained
- optional raw log absence follows only the explicitly documented optional rule

`COMPLETED` must mean the run reached a terminal verdict and all required closeout/evidence conditions succeeded.

## H3 — PG-1 overlay rendering cannot remain unevidenced while G2 PASSes

Trace the exact accepted PG-1 requirement in the governing Viewer Clash Panel design/plan.

Then make the procedure internally consistent:

- if G2 owns PG-1 overlay-rendering acceptance, define a mechanically executable live rendering oracle;
- if PG-1 belongs to a later gate, G2 must not claim it is satisfied and must reflect the missing required evidence in its verdict/status.

If G2 owns it, define:

- exact overlay/scene objects;
- deterministic setup/camera preconditions;
- action;
- observable signal;
- PASS/FAIL rule;
- timeout;
- cleanup;
- retained evidence;
- negative control.

No purely manual/visual oracle.

Any numeric threshold that gates PASS must be justified and frozen before harness implementation.

## M1 — Make N6 executable for thin/degenerate boxes

Redefine N6 so the mutation is mathematically guaranteed to violate C4 containment for every valid finite reference box.

Specify:

- exact face/component changed;
- reference/candidate values;
- tolerance + margin formula;
- behavior for zero-width/thin/degenerate boxes;
- large/negative coordinates;
- retained evidence sufficient to recompute the failure.

Avoid extent scaling that can become zero.

## L1 — Complete Table T repetition/retake counts

Replace vague repetition wording with exact rules.

For each repeated diagnostic/rendering action, record:

- exact count;
- whether identical rerender, camera retake, or different selection;
- gating vs characterization-only;
- aggregation/failure rule;
- what conclusion is not justified beyond that sample.

Remove wording like “a few”, “several”, or “retake if needed” unless another exact rule is referenced.

## Preserve verified closures

Do not reopen unless this remediation directly exposes a contradiction:

- C7/C18 Panel-owned vs foreign scene ownership;
- fail-first check/control/cleanup precedence;
- C4 containment relation;
- C17 V0–V7/N7 executable oracle;
- model-A/model-B cleanup;
- C2 title lookup via `createTitleBar`;
- D3 technical no-theming scope;
- D5 bridge-boundary scope;
- D6 OD-12 coexistence deferred.

## D1–D7 status

Do not silently approve owner decisions.

Preserve:

- D1 — owner/operational: Mechanical + Structure
- D2 — owner acceptance policy: defer until H1–H3 are corrected/re-reviewed
- D3 — technical scope
- D4 — owner execution-risk decision: bounded failure injection
- D5 — technical scope
- D6 — deferred host/integration
- D7 — technical/calibration: overlay-rendering disposition/thresholds must be corrected and re-reviewed

After remediation, report which of D1/D2/D4/D7 still require explicit owner acceptance before harness implementation.

## Internal review

After editing:

1. Run one targeted internal procedure review only over H1–H3, M1, L1, and directly affected verdict/journal/evidence sections.
2. Fix genuine Critical/High findings within scope.
3. Do not start harness implementation.
4. Persist the remediation internal review under `docs/reviews/`.
5. Update `docs/handoffs/latest.md`.

## Stop gate

Stop after docs remediation and targeted internal review.

Do not:
- implement `test/acceptance/clashpanel-viewerbridge.acceptance.mjs`;
- run G2;
- start G3/H1/H2/OQ-1/host;
- modify production code;
- commit/push unless separately authorized.

## Final report

Report:

- branch / HEAD / git status;
- sections changed;
- H1 journal/crash-reuse fix;
- H2 evidence-write gate;
- H3 PG-1 rendering disposition/oracle;
- N6 construction;
- Table T repetition rules;
- internal review findings/fixes;
- remaining D1/D2/D4/D7 owner decisions;
- explicit confirmation that no G2 harness code or live execution occurred.
