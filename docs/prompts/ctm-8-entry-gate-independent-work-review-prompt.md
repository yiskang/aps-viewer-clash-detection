# Work Prompt — CTM-8 Entry Gate and Exact First Package Review

## Owner authorization

The owner has explicitly authorized **entry into CTM-8** for:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

The pre-CTM-8 Addendum B group-header aggregate-presentation correction has already been independently reviewed, checkpointed, committed, and pushed.

Current checkpoint reported by the implementation agent:

- `main == origin/main == ac5bcb42b00e668442ce3add9764cba96d883309`
- working tree clean
- CTM-7 closed
- Addendum B checkpoint complete
- CTM-8 not yet started before this authorization
- no blockers
- two non-blocking Low findings remain deferred:
  - L1: ~4 ms false `"No clashes match"` flash during cold-label refresh
  - L2: upstream final-report prose file-count mismatch

This owner authorization permits **entering the CTM-8 gate**, but it does **not** authorize Work to implement production code.

Your task is to independently determine the exact governing CTM-8 entry state, exact first package, and authorization boundary from the repository.

## Review-only boundary

This is a **Work review / gate-identification package only**.

Do not modify production code.
Do not modify tests.
Do not implement CTM-8.
Do not remediate L1/L2 or any deferred issue.
Do not commit or push.
Do not silently advance beyond the first CTM-8 gate defined by the governing artifacts.

You may update only the required Work review artifact and `docs/handoffs/latest.md` as described below.

## Repository verification

Before making any CTM-8 conclusion, independently verify:

- repository path;
- current branch;
- HEAD;
- `origin/main`;
- ahead/behind state;
- working-tree state;
- latest commit contents;
- CTM-7 closeout status;
- Addendum B checkpoint status;
- whether any CTM-8 work already exists on disk despite the prior handoff claiming it had not started.

Expected checkpoint to verify, not assume:

`ac5bcb42b00e668442ce3add9764cba96d883309`

If repository state differs materially from the reported checkpoint, stop and adjudicate the discrepancy before recommending any CTM-8 action.

## Required repository inputs

Read repository instructions and governing state directly, including at minimum:

- `CLAUDE.md` and any other repo-level instructions;
- `docs/handoffs/latest.md`;
- the current governing CTM design/specification;
- the current governing CTM implementation plan;
- any CTM-8-specific spec, plan section, addendum, task definition, acceptance criteria, experiment protocol, calibration protocol, performance budget, evidence matrix, or authorization record;
- latest CTM-7 final report/review/ratification artifacts as needed for dependency checking;
- the Addendum B final report and Independent Work Review only to confirm its checkpoint does not alter CTM-8 entry assumptions.

Treat the handoff as navigation, not proof.

## Primary question

Determine:

**What exactly is CTM-8, and what is the first authorized package now that the owner has authorized entry into CTM-8?**

Do not infer this from conversation memory if the repository says something more specific.

## Required adjudication

### 1. CTM-8 scope

State the exact CTM-8 objective as defined by the governing repository artifacts.

Identify:

- milestone/task name;
- purpose;
- required outputs;
- acceptance criteria;
- prerequisites;
- protected boundaries;
- dependencies on CTM-7;
- dependencies, if any, on the pre-CTM-8 Addendum B correction.

Clearly distinguish repository-defined CTM-8 scope from deferred observations or future work.

### 2. Entry readiness

Verify whether every prerequisite for starting CTM-8 is satisfied at checkpoint `ac5bcb42...`.

Check especially:

- CTM-7 closeout/ratification requirements;
- required checkpoint state;
- required spec/plan readiness;
- required fixtures/models/evidence inputs;
- required performance or calibration baseline;
- any owner decisions still outstanding;
- any expected upstream final report or prior Independent Work Review that must exist before CTM-8.

If anything is missing, identify it as a gate blocker rather than filling the gap from chat.

### 3. Exact first package

Identify the **smallest exact first package** CTM-8 requires.

Determine whether the next package is, for example:

- research/experiment only;
- calibration/evidence only;
- design/spec clarification;
- implementation planning;
- production implementation;
- headed/manual validation;
- performance measurement;
- or another repository-defined package.

Do not assume CTM-8 starts with coding.

For the exact first package, identify:

- governing section/task ID;
- files/artifacts expected to change;
- files/artifacts that must remain untouched;
- required tests/evidence;
- stop condition;
- next gate after that package.

### 4. Authorization interpretation

The owner has authorized **entry into CTM-8**.

Determine whether that authorization, combined with the current governing spec/plan, is sufficient to authorize the exact first package.

If the governing artifacts require a narrower explicit authorization before production implementation, say so.

Do not reinterpret general CTM-8 entry authorization as permission to bypass an internal research/design/planning gate.

### 5. Interaction with deferred items

Adjudicate whether any of the following must be addressed before CTM-8 or remain deferred:

- Addendum B Low L1 (~4 ms false empty-state flash);
- Addendum B Low L2 (final-report prose count mismatch);
- CTM-7 L1–L8;
- hide-versus-departure ambiguity / O-1…O-4;
- neighboring single-clash transient-filter navScope behavior;
- any other deferred work referenced by the governing handoff.

Do not pull deferred work into CTM-8 unless the governing CTM-8 artifacts explicitly require it.

### 6. Historical plan wording

Check for any stale or historical wording in the governing CTM plan that may have been superseded by owner authorization, later addenda, ratification records, or checkpoint state.

If present:

- identify it;
- explain whether it blocks CTM-8;
- identify the minimum documentation correction, if any;
- do not silently edit governing artifacts unless already authorized by repository workflow.

### 7. Recommended next action

Provide one exact next action.

If CTM-8 is ready and the first package is fully specified, state:

- the exact first package;
- whether Claude/Codex or Work should execute it;
- whether it is implementation or non-implementation;
- what authorization boundary applies;
- what must not begin yet.

If a blocker exists, state the minimum correction and responsible package/agent.

## Required Work artifact

Produce exactly one authoritative Independent Work Review Report:

`docs/reviews/2026-10-11-ctm-8-entry-gate-independent-work-review.md`

The report must contain, as applicable:

- repo / branch / HEAD / origin / tree state;
- governing CTM spec/plan;
- CTM-7 dependency state;
- Addendum B checkpoint state;
- exact CTM-8 definition;
- prerequisite verification;
- readiness verdict;
- Critical / High / Medium / Low findings;
- blockers;
- deferred work;
- unresolved owner decisions;
- exact first CTM-8 package;
- exact next authorized action;
- work that must not begin yet.

This report is the authoritative Work artifact for the CTM-8 entry decision.

## Handoff update

Update:

`docs/handoffs/latest.md`

Keep it concise and link the new CTM-8 entry review.

Record:

- repo / branch / HEAD / tree state;
- CTM-7 closed;
- Addendum B checkpoint commit;
- CTM-8 entry authorization received;
- governing CTM spec/plan;
- latest CTM-8 entry review;
- readiness/verdict;
- blockers/deferred work;
- unresolved owner decisions;
- exact next authorized action;
- work that must not begin yet.

Do not rewrite historical final reports or prior Independent Work Reviews.

## Verdict

Use one of these exact readiness forms where appropriate:

- **PASS — READY FOR CTM-8 FIRST PACKAGE**
- **OWNER DECISION REQUIRED**
- **BLOCKED — PREREQUISITE CORRECTION REQUIRED**

Do not claim CTM-8 implementation has started merely because the owner authorized entry.

## Stop condition

After writing the Independent Work Review Report and updating the handoff:

**STOP.**

Do not implement CTM-8.
Do not modify production/tests.
Do not commit.
Do not push.
Do not begin a second CTM-8 package.

Return only the gate result and exact next authorized action for owner direction.
