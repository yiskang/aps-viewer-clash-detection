# CLAUDE.md

Persistent Claude Code collaboration rules for this Clash Detection repository.

## Agent Handoff Convention

`docs/handoffs/latest.md` is the canonical operational handoff entry point for agents.

### When to update

- Update it at the end of any substantial task that materially changes project state.
- Do not update it for trivial edits.

### How to build handoff state

- Derive it from the actual repository, git history, governing specs/plans, implementation, tests, research, reviews, and roadmap — not from conversational memory alone.
- Keep it concise. Link to authoritative repository-relative artifacts instead of duplicating them.

### Artifact roles

Keep these roles separate:

| Path | Role |
| --- | --- |
| `docs/research/` | Research, experiments, benchmarks, decision evidence, closeout analysis |
| `docs/research/*-final-report.md` | Substantial package completion / implementation / research / validation / remediation closeout report, owned by the responsible package agent |
| `docs/reviews/*-independent-work-review.md` | Independent Work Review Report: the complete, authoritative independent Work review |
| `docs/reviews/` (other) | Internal reviews, audits, adjudication results, verification reviews |
| `docs/handoffs/` | Operational handoff state: a concise current-state/index artifact |
| `docs/superpowers/specs/` | Design/specification artifacts |
| `docs/superpowers/plans/` | Implementation plans |

Do not move or rename historical artifacts just to match this convention unless explicitly requested.

### Minimum handoff state

Keep `docs/handoffs/latest.md` current with at least:

- branch and HEAD
- working-tree state
- current milestone/task context and status
- governing spec/plan and latest status authority
- explicitly unresolved or deferred work
- next authorized action, or explicitly `awaiting owner authorization`
- work that must not begin without explicit authorization

### Before declaring a substantial task complete

1. Verify actual repository state.
2. Update the task-specific artifact if required.
3. Run required verification.
4. Update `docs/handoffs/latest.md` from the verified final state.
5. Report exact verification results.
6. Report branch, HEAD, and final git status.

Do not create a commit solely because the handoff was updated unless explicitly authorized.

## Milestone and phase transition authorization

Repository consistency does not itself authorize a transition.

A roadmap entry, closed milestone, suggested next action, or independent review recommendation may identify the likely next step, but must not be treated as authorization to begin a new milestone, phase, or abstraction level.

Before advancing from:

- research → design/specification
- design/specification → implementation planning
- implementation planning → implementation
- one milestone → the next milestone
- a conditional phase → execution

the agent must verify that the transition is explicitly authorized by one of:

1. the user / milestone owner in the current task;
2. the latest authoritative repository artifact that explicitly grants that transition; or
3. a reviewed handoff entry that explicitly records the action as authorized.

If the latest closeout or status is `D`, `blocked`, `conditional`, `deferred`, or otherwise leaves work unresolved, do not infer that the next roadmap milestone is automatically authorized.

Instead:

- report the candidate next action;
- identify the artifact or roadmap basis for it;
- distinguish `recommended next action` from `authorized next action`;
- stop and request milestone-owner confirmation when authorization is not explicit.

An independent ChatGPT Work review may recommend a transition, but recommendation alone does not authorize execution unless the user explicitly accepts it or the repository already records that authorization.

Do not reinterpret a closed milestone as permission to reopen skipped or conditional phases unless explicitly authorized.

## Internal review loop

For specification, design, plan, or implementation work that requires review:

- Use the configured Codex review workflow as the internal reviewer.
- Resolve blocking findings without requiring the user to manually relay each review round.
- Internal review is a convergence tool, not an instruction to expand the artifact indefinitely.

### Review boundary

After each remediation pass:

- Re-review the changed areas and their directly affected invariants first.
- Do not restart unrestricted full-artifact defect discovery on every round.
- Run a new full review only when:
  - the task explicitly requires one,
  - the remediation materially changed architecture or externally observable contracts, or
  - a prior independent gate requested it.

- Respect an explicit convergence/freeze adjudication from an independent gate. Once an artifact or architectural core is declared frozen, do not reopen it through internal review unless:
  - a genuine correctness contradiction is discovered,
  - the implementation plan exposes an architectural impossibility, or
  - the user explicitly authorizes reopening it.

If later review findings are primarily about machinery introduced by earlier remediation rather than the original architecture, stop the loop and perform a convergence/adjudication pass instead of continuing automatic expansion.

Classify remaining concerns as one of:

- design/spec correctness blocker
- implementation-plan requirement
- verification/calibration gate
- product/integration decision
- deferred/non-goal

Do not keep adding implementation-level detail to a design spec merely to eliminate every possible review finding.

### Ready for independent gate

A stable checkpoint is reached when:

- no known Critical/High correctness blocker remains in the artifact's intended abstraction level;
- remaining Medium/Low findings are dispositioned;
- unresolved research, measurement, product, or integration questions are explicitly recorded as gates rather than guessed closed;
- the artifact is internally consistent enough to be considered for the next appropriate phase, subject to transition authorization.

At that point:

- update `docs/handoffs/latest.md`;
- mark the artifact ready for independent ChatGPT Work review;
- stop the internal review loop.

If an independent Work review later finds blockers:

- remediate the specific blocking findings;
- run targeted internal verification/review of the affected areas;
- do not automatically restart an unrestricted full-artifact review unless the independent review explicitly requires it.

## Independent review adjudication

When ChatGPT Work completes an independent phase/checkpoint review:

- The expected primary durable artifact is the **Independent Work Review Report**: `docs/reviews/<date>-<scope>-independent-work-review.md`. It is the authoritative durable record of a substantial Work independent review. It is not replaced by Work chat and not replaced by an upstream package final report; `docs/handoffs/latest.md` should link to it when applicable. Historical review files are not renamed or migrated to match this convention.
- Treat the persisted review artifact as a review claim, not as ground truth.
- Before advancing to the next implementation phase, perform a targeted adjudication of that review using the configured Codex workflow.
- Verify only:
  - the review's cited findings;
  - its repository/commit boundary;
  - its claimed test/verification results;
  - its final gate verdict.
- Do not start a new unrestricted review of the implementation.
- Do not modify production code during adjudication.

If Work and the adjudication agree:
- update `docs/handoffs/latest.md` with the verified gate result;
- proceed only if the next phase is already explicitly authorized by the accepted implementation plan, handoff, or milestone-owner authorization.

If they disagree on a blocking finding or gate verdict:
- persist the disagreement under `docs/reviews/`;
- update `docs/handoffs/latest.md` to `awaiting owner decision`;
- do not advance to the next phase.

### Independent review consumption

Before continuing a reviewed package or beginning the next authorized step, Claude/package agents must:

1. read `docs/handoffs/latest.md`;
2. identify the latest applicable `docs/reviews/*-independent-work-review.md`;
3. read that Independent Work Review Report before making changes;
4. independently verify current repository state rather than treating the review as proof;
5. respect its blocking findings and the exact next authorized action it records.

Required behavior:

- If the latest applicable independent review has unresolved Critical/High/Medium blockers, do not advance beyond that gate until they are corrected, waived by the owner, or superseded by a later authoritative review.
- If the review specifies an exact next authorized action, do not broaden scope beyond it without explicit authorization.
- If a substantial independent review is expected but no durable Independent Work Review Report exists, treat that as a workflow gap; do not silently rely on Work chat as the substitute.
- If the handoff and the independent review disagree, identify the discrepancy and verify actual repository state before proceeding.
- An independent review is never itself authorization for a new milestone; the transition-authorization rules above still apply.

Intended sequence: the package agent writes `docs/research/*-final-report.md`, updates the handoff and stops; Work reads that report plus repository evidence, writes the Independent Work Review Report and updates the handoff (its final chat is only a summary); the package agent then reads the handoff and that report, performs the targeted adjudication above, and remediates only authorized findings or proceeds only through an authorized next gate.

### Independent-review ownership boundary

When acting in an **independent review role**:

- treat upstream package final reports (`docs/research/*-final-report.md`) as read-only review inputs;
- do not edit, rewrite, normalize, silently correct, backfill, replace, or become the author of an upstream package final report unless the owner explicitly authorizes it;
- if an upstream final report is wrong, incomplete, inconsistent, or contradicted by repository evidence: preserve it unchanged, record the discrepancy in the independent review, state what the repository evidence supports, and identify the minimum correction required from the responsible upstream package/agent;
- if an upstream final report is missing: record the workflow defect, identify the responsible upstream package/agent that must backfill it, and do not author it unless explicitly authorized.

This boundary applies to the **review role**, not to a package owner correcting its own final report.

## Durable Package Completion Reports

Repository artifacts are the durable collaboration boundary between Claude, ChatGPT, Work, Codex, and future sessions. A substantial package completion report must not exist only in chat.

### Mandatory package final report

For every substantial package, persist a complete final/completion report in the repository **before returning the final chat response**.

- Use `docs/research/<date>-<package>-final-report.md` for implementation, product-facing, research, validation, preparation, remediation, and closeout packages.
- Use `docs/reviews/<date>-<name>-review.md` only when the task itself is an independent/internal review or audit.
- Do not use a review artifact as a substitute for a package final report when the task is primarily implementation/product/research work.

### Required final-report contents

Include, as applicable:

- repository / branch / HEAD / origin relation / working-tree state
- authorized scope and governing spec/plan
- files changed; implementation/results delivered; design/spec changes
- run/reproduction commands
- test results
- headed/live validation results; visual evidence summary and paths
- autonomous fixes/remediations
- internal review summary; unresolved findings
- remaining debt/limitations; deferred work
- owner/product decisions
- protected boundaries confirmed unchanged
- commit/push state
- exact next gate / next authorized action

### Chat must not be more authoritative than the repo

Before returning a substantive final response:

1. verify the final report exists;
2. verify substantive conclusions in chat are already represented in that report;
3. verify the handoff links to it;
4. verify relevant evidence/review artifacts are linked.

The final chat response is a concise summary of the persisted artifact, not a second source of truth.

### Handoff role

`docs/handoffs/latest.md` stays concise and includes: repo / branch / HEAD / tree state; current milestone/package status; governing spec/plan; latest package final report; latest relevant review; latest relevant evidence/research; blockers/deferred work; exact next authorized action; work that must not begin without authorization. It links to the full final report rather than duplicating it.

### Supporting artifacts do not replace the final report

- Internal reviews do not replace the package final report.
- Evidence reports do not replace the package final report.
- Handoffs do not replace the package final report.
- Chat does not replace the package final report.

### Missing-report behavior

Role-aware:

- The responsible package/implementation/research agent owns creating or correcting its package final report.
- If that agent discovers its own final report is missing, it treats that as a workflow defect and backfills it before advancing when practical, then updates the handoff to link it.
- An independent reviewer that discovers a missing report records the gap and requires the responsible upstream package/agent to backfill it; the reviewer does not become the upstream report author unless the owner explicitly authorizes it (see Independent-review ownership boundary).
- Chat is never the authoritative replacement for a missing report.
