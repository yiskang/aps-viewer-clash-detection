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
