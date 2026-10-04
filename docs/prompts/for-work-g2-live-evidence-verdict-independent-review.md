# For Work — Independent Review of Exactly-One Live G2 Evidence and Verdict

Independently review the **completed exactly-one live G2 attempt**, its raw evidence, attempt lifecycle, cleanup, and terminal verdict.

Use the repository and generated live evidence as the source of truth.

## Current execution state

The exactly-one live attempt has already occurred.

No retry is authorized.
No new authorization record is authorized.
No harness/procedure/production fix is authorized in this review.

Expected baseline:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- committed HEAD:
  `75a3ccb9ba160f8afcf3c9b39a301f352b273c08`
- committed activated harness SHA:
  `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`
- accepted procedure SHA:
  `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- final authorization ID:
  `g2-live-20261004-75a3ccb9`
- final record SHA:
  `f68436dfbab09ad32a2ba248cf6ab63ce652b5615e82f8232f77aae9409c33c6`
- exactly one live harness invocation occurred
- no retry occurred
- `AUTH_BOUND` occurred
- `ATTEMPT_CONSUMED` occurred
- both models loaded
- exit code was `1`
- terminal verdict reported by Claude:
  `FAIL` (procedure row 3)

Do not assume that verdict is correct; independently verify it.

## Evidence sources

Inspect the raw live evidence under:

`test/acceptance/results/`

Also inspect:

- `docs/reviews/2026-10-04-g2-exactly-one-live-execution-internal-review.md`
- `docs/handoffs/latest.md`
- accepted G2 procedure
- governing live plan
- current harness source only as needed to interpret evidence and verdict rules

Do **not** delete, clean, regenerate, overwrite, or mutate any live evidence.

Do not rerun live G2.

---

## 1. Reconstruct the attempt lifecycle

Independently reconstruct the actual live lifecycle from durable evidence.

Verify:

- authorization record selected;
- record valid at W1;
- `AUTH_BOUND` occurred;
- attempt/reservation identifier;
- Phase 0 outcome;
- `ATTEMPT_CONSUMED` occurred;
- first model load occurred only after consumption;
- both expected models loaded;
- live checks executed;
- cleanup executed;
- evidence finalization executed;
- final process exit code `1`.

Determine whether any lifecycle stage is missing, contradictory, or only inferred.

---

## 2. Verify single-attempt integrity

Confirm:

- only one live harness invocation occurred;
- no second attempt/reservation exists;
- no retry occurred after FAIL/BLOCKED/NOT_EVIDENCED;
- no replacement authorization record was issued after the attempt;
- no attempt-state reset occurred;
- evidence does not show multiple live execution starts.

Any sign of a second invocation is Critical.

---

## 3. Verify final authorization disposition

Confirm:

- final record was active before execution;
- record became spent/bound according to accepted semantics;
- no record reuse occurred;
- superseded historical records remained non-active;
- no alternate candidate was selected.

Determine whether the final record lifecycle is internally consistent with the attempt journal.

---

## 4. Verify reported overall check results

Claude reported:

- 16 / 20 checks passing
- C3: FAIL — repetitions
- C8: FAIL — element outside frustum, excess about `5.86`
- C6: `NOT_EVIDENCED` — N2 control not discriminating
- C20: BLOCKED — dependency on C8

Independently verify these outcomes from raw evidence.

Do not rely on the internal review summary alone.

For every non-PASS item, identify:

- authoritative evidence artifact;
- exact observed value/state;
- expected oracle/threshold;
- why the check produced FAIL / BLOCKED / NOT_EVIDENCED;
- whether the harness result matches its defined oracle.

---

## 5. C3 — repetitions FAIL

Independently analyze C3.

Determine:

- exact repetition count/pattern observed;
- expected invariant/oracle;
- whether repetitions indicate:
  - a real ViewerBridge behavior defect;
  - duplicate event/listener behavior;
  - test/harness instrumentation duplication;
  - fixture-specific behavior;
  - timing/race behavior;
  - another cause.

Trace the evidence back to the relevant harness/oracle.

Classify the finding as:

- product/implementation defect;
- harness/oracle defect;
- fixture/environment issue;
- inconclusive.

Do not propose a fix beyond the minimum diagnostic conclusion unless the evidence clearly supports it.

---

## 6. C8 — frustum FAIL

Claude reported:

- element outside frustum;
- excess approximately `5.86`.

Independently verify:

- which model/element/dbId/geometry was involved;
- exact frustum/oracle values;
- how excess was computed;
- coordinate/frame basis used;
- tolerance/threshold;
- camera/navigation state;
- whether measurement happened at the correct phase.

Determine whether C8 represents:

- a genuine Viewer/navigation defect;
- incorrect test fixture expectation;
- coordinate-space/bounds/oracle defect;
- timing/state-stabilization issue;
- another issue.

Check whether the magnitude `~5.86` is materially outside tolerance or could be explained by an accepted numerical margin.

Classify severity independently.

---

## 7. C6 — NOT_EVIDENCED

Claude reported:

`C6 NOT_EVIDENCED` because `N2` was not discriminating.

Independently verify:

- what C6 is intended to prove;
- what N2 control is intended to discriminate;
- actual positive/control outputs;
- why the control failed to discriminate;
- whether the check correctly maps to `NOT_EVIDENCED`;
- whether this means:
  - evidence design gap;
  - control design gap;
  - fixture limitation;
  - implementation ambiguity.

Determine whether C6 should remain Medium, be lower/higher, or affect overall verdict more strongly.

Do not silently convert `NOT_EVIDENCED` to PASS or FAIL.

---

## 8. C20 — BLOCKED

Claude reported C20 BLOCKED because it depends on C8.

Verify:

- exact dependency rule;
- whether C20 started;
- whether blocking occurred before any unsafe/invalid interpretation;
- whether any partial C20 evidence exists;
- whether BLOCKED is the correct outcome rather than FAIL/NOT_EVIDENCED.

Determine whether C20 carries an independent finding or is solely derivative of C8.

---

## 9. Verify C1–C20 and N1–N8 comprehensively

Review all check/control results, not only failures.

Confirm:

- all expected checks exist;
- all expected controls exist;
- no check silently skipped without a defined disposition;
- dependencies were respected;
- effective-state calculations are consistent;
- control-run/gate-disposition records are coherent;
- no cyclic dependency artifact occurred;
- verdict-bearing C20 logic remained consistent.

Report any unexpected PASS that lacks sufficient evidence.

---

## 10. Ledgers / request integrity

Claude reported:

- fatal ledger empty;
- request ledger empty;
- response ledger empty.

Independently verify this is expected and not evidence loss.

Confirm:

- no fatal request/response witness was expected for this run;
- no network failure was hidden;
- no request capture silently failed;
- no browser/page fatal event went unrecorded.

If an empty ledger is valid, state why.

If it indicates instrumentation failure, classify accordingly.

---

## 11. Cleanup / ownership

Claude reported:

- all cleanup steps ran;
- no unresolved ownership;
- no crash.

Independently verify from cleanup evidence:

- all required cleanup phases executed;
- expected cleanup ownership resolved;
- no indeterminate ownership remained;
- no retained hidden/theming/selection/navigation state remained unexpectedly;
- browser/context/server cleanup behaved as specified;
- K semantics are correct.

Confirm the final cleanup outcome is compatible with the reported row-3 FAIL.

---

## 12. Evidence completeness

Verify all required authoritative artifacts exist and are internally consistent, including as applicable:

- attempt/reservation journal
- R1
- R2
- R3
- K
- final result JSON
- summary
- raw/operator log if applicable
- runtime identity
- fixture identity
- Viewer identity
- check/control records
- cleanup evidence
- rendering evidence
- authorization-record identity
- exit code / terminal verdict

Identify any missing required artifact.

Missing authoritative evidence may alter readiness/closeout even if the FAIL verdict itself is correct.

---

## 13. Recompute terminal verdict

Using the accepted procedure only, independently recompute the final verdict.

Do not inherit Claude's verdict.

Determine:

- applicable verdict row;
- precedence among FAIL / BLOCKED / PARTIAL / NOT_EVIDENCED;
- effect of C3 FAIL;
- effect of C8 FAIL;
- effect of C6 NOT_EVIDENCED;
- effect of C20 BLOCKED;
- cleanup/evidence completeness interaction.

State explicitly whether:

`FAIL (row 3)`

is correct.

If not, provide the correct verdict and exact procedure basis.

---

## 14. Root-cause classification

For each substantive non-PASS result, classify the most likely ownership:

### C3
- production/ViewerBridge implementation
- harness/oracle
- fixture
- environment/timing
- unresolved

### C8
same categories

### C6
same categories

### C20
independent vs derivative

Clearly distinguish:

- evidence-supported fact;
- inference;
- unresolved hypothesis.

Do not overstate causality.

---

## 15. Severity adjudication

Claude's internal review proposed:

- High: C3
- High: C8
- Medium: C6
- Low: C20

Independently determine final severity.

Use Critical / High / Medium / Low.

For each finding include:

- affected check;
- concrete failure mode;
- why severity is justified;
- whether it blocks G2 acceptance/closeout;
- minimum correction/investigation needed before any future run could be considered.

---

## 16. Extra untracked prompt deviation

Claude reported one deviation:

- the execution-authorization prompt itself was an additional untracked file under `docs/prompts/`;
- the owner prompt's expected-file list did not mention it;
- the harness clean-tree classifier allows the whole `docs/prompts/` prefix;
- Phase 0 passed.

Adjudicate whether this is:

- harmless documentation mismatch;
- governance/process issue;
- execution-integrity issue;
- evidence-integrity issue.

Determine whether it affects validity of this live attempt.

Do not retrofit the checklist after the fact.

---

## 17. Retry / future-run disposition

No retry is currently authorized.

Determine whether evidence supports any future run **in principle**, and under what gate.

Possible conclusions:

- no retry justified; close G2 as FAIL;
- bounded remediation/investigation required before any future owner decision;
- harness/oracle defect must be fixed and re-reviewed first;
- fixture issue must be corrected first;
- product defect must be corrected first;
- evidence insufficient to justify another run.

Do **not** authorize a retry.

If a future attempt could ever be justified, identify the minimum prerequisites and whether a new authorization record would be required.

---

## 18. G2 closeout readiness

Determine whether G2 should now be considered:

- closed as FAIL with actionable findings;
- blocked pending remediation;
- incomplete because evidence is insufficient;
- ready for bounded remediation planning;
- another disposition supported by the procedure.

Do not advance to G3 or downstream work unless repository governance explicitly permits it.

---

## 19. Repository/evidence preservation

Confirm current live evidence should remain untouched.

Do not:

- delete `test/acceptance/results/`;
- regenerate evidence;
- normalize/rename raw artifacts;
- rerun the harness;
- issue a new record;
- reset attempt state.

If evidence should be copied/persisted to a tracked closeout location, recommend it only; do not perform the copy unless separately authorized.

---

## Final output

Persist the substantive independent review under:

`docs/reviews/`

Update:

`docs/handoffs/latest.md`

Report:

- Critical / High / Medium / Low findings
- attempt-lifecycle verdict
- single-attempt-integrity verdict
- final-record disposition
- C3 adjudication
- C8 adjudication
- C6 adjudication
- C20 adjudication
- C1–C20/N1–N8 consistency
- ledger verdict
- cleanup verdict
- evidence-completeness verdict
- independently recomputed terminal verdict
- root-cause ownership classification
- extra-untracked-prompt disposition
- retry/future-run disposition
- G2 closeout readiness
- exact recommended next authorized action

## Prohibited

Do not:

- modify harness/tests/procedure/production code
- mutate/delete live evidence
- issue a new authorization record
- reserve/consume another attempt
- rerun live G2
- commit or push unless separately authorized
