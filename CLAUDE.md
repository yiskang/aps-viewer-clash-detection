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
| `docs/reviews/` | New reviews, audits, verification reviews, adjudication results |
| `docs/handoffs/` | Operational handoff state |
| `docs/superpowers/specs/` | Design/specification artifacts |
| `docs/superpowers/plans/` | Implementation plans |

Do not move historical artifacts just to match this convention unless explicitly requested.

### Minimum handoff state

Keep `docs/handoffs/latest.md` current with at least:

- branch and HEAD
- working-tree state
- current milestone/task context and status
- governing spec/plan and latest status authority
- explicitly unresolved or deferred work
- suggested next action

### Before declaring a substantial task complete

1. Verify actual repository state.
2. Update the task-specific artifact if required.
3. Run required verification.
4. Update `docs/handoffs/latest.md` from the verified final state.
5. Report exact verification results.
6. Report branch, HEAD, and final git status.

Do not create a commit solely because the handoff was updated unless explicitly authorized.

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
- the artifact is internally consistent enough to proceed to the next appropriate phase.

At that point:

- update `docs/handoffs/latest.md`;
- mark the artifact ready for independent ChatGPT Work review;
- stop the internal review loop.

If an independent Work review later finds blockers:

- remediate the specific blocking findings;
- run targeted internal verification/review of the affected areas;
- do not automatically restart an unrestricted full-artifact review unless the independent review explicitly requires it.
