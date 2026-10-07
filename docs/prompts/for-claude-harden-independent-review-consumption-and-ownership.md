# For Claude — Harden Independent Review Consumption + Ownership Boundaries in `CLAUDE.md`

This is a **workflow-policy hardening task only**.

Do not advance product scope, implementation scope, G2/C6/C8, G3, or any milestone.

The goal is to close the remaining asymmetry between:

- Claude/package-agent durable final reports
- Work independent review reports
- how Claude consumes Work's independent review before continuing

Use the current repository `CLAUDE.md` as the source to edit.

---

## 1. Preserve the existing workflow

Do not rewrite `CLAUDE.md` wholesale.

Keep the current structure and existing rules unless a small wording change is needed to remove ambiguity.

In particular, preserve:

- Agent Handoff Convention
- Milestone and phase transition authorization
- Internal review loop
- Independent review adjudication
- Durable Package Completion Reports

This task should make targeted edits only.

---

## 2. Make the Work review artifact explicit

The current `CLAUDE.md` refers generically to persisted `docs/reviews/` artifacts.

Harden that contract so the expected primary Work artifact is explicit:

`docs/reviews/<date>-<scope>-independent-work-review.md`

Define it as:

**Independent Work Review Report**

Clarify that:

- it is the authoritative durable artifact produced by substantial ChatGPT Work independent reviews;
- it is not replaced by Work chat;
- it is not replaced by an upstream package final report;
- `docs/handoffs/latest.md` should link to it when applicable.

Do not require historical review files to be renamed or migrated.

---

## 3. Add an Independent Review Consumption rule

Add a targeted subsection in or immediately after `## Independent review adjudication`, for example:

`### Independent review consumption`

The rule must require Claude/package agents, before continuing a reviewed package or beginning the next authorized step, to:

1. read `docs/handoffs/latest.md`;
2. identify the latest applicable:
   `docs/reviews/*-independent-work-review.md`;
3. read that Independent Work Review Report before making changes;
4. independently verify current repository state rather than treating the review as proof;
5. respect blocking findings and the exact next authorized action recorded by the review.

Required behavior:

- If the latest applicable independent review contains unresolved Critical/High/Medium blockers, do not advance beyond that gate until they are corrected, waived by the owner, or superseded by a later authoritative review.
- If the review specifies an exact next authorized action, do not broaden scope beyond it without explicit authorization.
- If a substantial independent review is expected but no durable Independent Work Review Report exists, treat that as a workflow gap; do not silently rely on Work chat as the substitute.
- If the handoff and independent review disagree, identify the discrepancy and verify actual repository state before proceeding.

Do not make an independent review itself automatic authorization for a new milestone; preserve the existing transition-authorization rules.

---

## 4. Add an independent-review ownership boundary

The current `CLAUDE.md` durable-reporting section says missing reports should be backfilled, but it does not distinguish the responsible package agent from an independent reviewer.

Add a subsection such as:

`### Independent-review ownership boundary`

Required semantics:

When acting in an **independent review role**:

- treat upstream package final reports under
  `docs/research/*-final-report.md`
  as read-only review inputs;
- do not edit, rewrite, normalize, silently correct, backfill, replace, or make the independent reviewer the author of an upstream package final report unless the owner explicitly authorizes it;
- if the upstream final report is wrong, incomplete, inconsistent, or contradicted by repository evidence:
  - preserve it unchanged;
  - record the discrepancy in the independent review;
  - state what repository evidence supports;
  - identify the minimum correction required from the responsible upstream package/agent;
- if the upstream final report is missing:
  - record the workflow defect;
  - identify the responsible upstream package/agent that must backfill it;
  - do not author the missing upstream report as the independent reviewer unless explicitly authorized.

Clarify that this ownership boundary applies to the **review role**, not to the package owner correcting its own final report.

---

## 5. Fix the current Missing-report behavior wording

The current rule effectively says:

> if a substantial completed package has no durable final report, backfill it before advancing when practical

That is too role-ambiguous.

Replace it with role-aware behavior:

- The responsible package/implementation/research agent owns creation or correction of its package final report.
- If that responsible agent discovers its own missing final report, it should backfill it before advancing when practical.
- An independent reviewer that discovers the missing report must record the gap and require the responsible upstream package/agent to backfill it.
- The independent reviewer must not become the upstream report author unless the owner explicitly authorizes that.
- Chat must never be treated as the authoritative replacement for the missing report.

---

## 6. Harden artifact roles without migrating history

Update the current Artifact roles table/section only as needed so the durable roles are clear.

Target semantics:

- `docs/research/*-final-report.md`
  = substantial package completion / implementation / research / validation / remediation closeout

- `docs/reviews/*-independent-work-review.md`
  = complete authoritative independent Work review

- other `docs/reviews/`
  = internal reviews, audits, adjudication, verification reviews

- `docs/handoffs/latest.md`
  = concise current-state/index artifact

Preserve historical artifact locations and names.

Do not rename existing files merely to match the convention.

---

## 7. Preserve current adjudication behavior

The existing `## Independent review adjudication` requires targeted adjudication of Work findings.

Keep that behavior.

The intended sequence should become explicitly coherent:

```text
Claude/package agent
  -> writes docs/research/*-final-report.md
  -> updates handoff
  -> stops for Work review

Work
  -> reads upstream package report + repo evidence
  -> writes docs/reviews/*-independent-work-review.md
  -> updates handoff
  -> final chat is only a summary

Claude/package agent
  -> reads handoff
  -> reads latest applicable Independent Work Review Report
  -> performs targeted adjudication
  -> remediates only authorized findings / proceeds only through authorized next gate
```

Do not weaken the rule that an independent Work recommendation alone does not authorize a milestone transition.

---

## 8. No product changes

This task is documentation/workflow policy only.

Do not modify:

- production code
- tests
- collision behavior
- UI
- acceptance procedures
- authorization records
- G2/C6/C8
- G3
- product scope

Do not commit or push unless separately authorized.

---

## 9. Verification

Before stopping:

- show the exact `CLAUDE.md` sections changed;
- verify the file now explicitly covers:
  1. `Independent Work Review Report`
  2. the `docs/reviews/<date>-<scope>-independent-work-review.md` naming convention
  3. Claude reading the latest applicable independent review before continuing
  4. upstream package final reports being read-only for independent reviewers
  5. independent reviewers not backfilling upstream reports by default
  6. role-aware missing-report behavior
  7. no conflict with milestone authorization
  8. no requirement to rename historical review artifacts
- run `git diff --check`;
- report exact branch / HEAD / working-tree state.

If `docs/handoffs/latest.md` needs a small update because this workflow policy materially changes project state, update it concisely and link to the relevant policy location. Otherwise do not churn the handoff.

Stop after the workflow hardening is complete.
