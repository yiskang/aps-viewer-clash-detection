# M2.1 Agent Kit Routing Audit Prompt

Perform a **read-only routing audit / postmortem** of the completed M2.1 Clash Witness Marker work.

Do NOT modify any Agent Kit skill, Agent Kit Knowledge/Pattern file, clash-detection code, M2.1 implementation, branch state, or SDD workspace. Do not merge, finish, clean, or commit anything.

The purpose is to determine whether APS Viewer Agent Kit skills were **actually invoked during M2.1**, especially the planning-stage task reported as:

> `Agent "Verify Viewer overlay API evidence" finished`

Do not infer skill use merely because the resulting research looked like a skill workflow.

## Repositories / paths

Target implementation repository:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/`

Agent Kit repository:

`/Users/kangea/Workspace/Codes/aps-viewer-agent-kit/`

M2.1 execution ledger/workspace:

`.superpowers/sdd/2026-09-07-collision-library-m2.1-clash-witness-marker-implementation/`

Primary M2.1 documents:

- `docs/superpowers/specs/2026-09-07-collision-library-m2.1-clash-witness-marker-design.md`
- `docs/superpowers/plans/2026-09-07-collision-library-m2.1-clash-witness-marker-implementation.md`

Write the final report directly to:

`/Users/kangea/Workspace/Codes/aps-viewer-agent-kit/docs/research/collision-detection-m2.1-agent-kit-routing-audit.md`

If sandbox restrictions prevent reading the Agent Kit repository directly, state that explicitly and continue using whatever session/global-skill evidence is actually available. Do not claim filesystem access you did not have.

## Core question

For every Viewer-specific research or implementation moment in M2.1, determine whether it was:

1. confirmed Agent Kit skill invocation,
2. generic subagent/research without Agent Kit,
3. plan-forced / explicitly instructed skill use,
4. autonomous skill trigger,
5. downstream handoff from another skill,
6. ambiguous / insufficient evidence.

The audit must distinguish these categories carefully.

## Skills to check

At minimum investigate whether any of these were actually invoked:

- `aps-viewer-implementation-research`
- `aps-viewer-api-evidence-investigation`
- `viewer-extension-lifecycle-audit`

Do not assume that a task named “Viewer API evidence” means `aps-viewer-api-evidence-investigation` ran.

## Important environment distinction

This Claude session/repository may have been running in a sandbox that could not freely read external directories, while Agent Kit skills were installed as **global skills**.

Explicitly distinguish:

### A. Skill invocation through Claude's global-skill mechanism

A skill can potentially be invoked even if the target repository sandbox cannot directly browse the Agent Kit repo.

### B. Direct filesystem access to the Agent Kit repository

Determine whether the session/subagent actually read files from the Agent Kit repository during M2.1.

### C. Knowledge/provenance bundled or injected through the skill system

The M2.1 plan says the pinned Viewer bundle hash was “matching this Agent Kit's existing provenance record.” Determine how that provenance became available:

- direct Agent Kit filesystem read,
- globally-installed skill context,
- prior session context,
- copied/embedded provenance already available elsewhere,
- or unknown.

### D. Generic repo-local research

A generic research agent could independently inspect:

- the pinned `viewer3D.js` bundle,
- typings,
- official docs,
- the current clash repo,

and produce a result that looks like an Agent Kit evidence investigation without invoking any skill.

Keep this category separate.

## Evidence hierarchy

Use the strongest available evidence in this order:

1. explicit skill invocation / tool trace / skill-load record,
2. subagent transcript or execution log naming the skill,
3. SDD progress ledger recording the invoked skill,
4. generated research artifact clearly attributable to a skill workflow,
5. session trace showing a handoff from one Viewer skill to another,
6. wording/style similarity only,
7. inference.

Items 6–7 are **not sufficient** to classify an invocation as confirmed.

If direct invocation evidence is unavailable, classify the result as ambiguous rather than guessing.

## M2.1 moments to inspect

### 1. M2.1 design pass

The design touched Viewer-specific claims including overlay assumptions, Viewer r71 vs collision r185 runtime isolation, marker lifecycle, and through-occlusion behavior. Determine whether any Viewer skill fired here.

### 2. M2.1 implementation-plan research

This is the most important case.

The final plan states:

- five parallel research passes,
- “a sourced Viewer-API evidence investigation against the pinned `viewer3D.js` 7.124.2 bundle,”
- “matching this Agent Kit's existing provenance record,”
- Task 7 marked “Viewer overlay API evidence (already resolved by planning-stage research).”

The user also observed:

> `Agent "Verify Viewer overlay API evidence" finished`

Determine whether this specific agent:

- invoked `aps-viewer-api-evidence-investigation`,
- invoked another Viewer skill,
- was a generic subagent,
- or cannot be determined.

### 3. Batch 2 Viewer marker implementation

Inspect the work involving:

- `viewer.overlays.*`,
- `window.THREE` r71,
- `depthTest` / `depthWrite`,
- overlay add/remove signatures,
- lifecycle cleanup.

Two Critical real-Viewer contract bugs survived the first implementation:

- `viewer.overlays.addMesh/removeMesh` argument order reversed,
- `mesh.scale.setScalar(radius)` unavailable in Viewer r71.

Determine whether any Viewer skill was used before these mistakes, during the fix pass, or not at all. Distinguish Agent Kit evidence from generic pinned-bundle inspection.

### 4. Batch 3 live acceptance

Inspect whether Viewer-specific runtime behavior such as `viewer.impl.setPlacementTransform`, live overlay rendering, enclosed-marker visibility, and model-unload cleanup triggered any Viewer skill or was ordinary implementation/debugging.

## Compare against earlier M2 field observations

Use these only as comparison context:

### Earlier negative observation 1 — M2 design

Federated design initially missed `getSelection()` vs `getAggregateSelection()` and missing `keepCurrentModels`. Prior postmortem classified this as an autonomous-trigger negative observation.

### Earlier likely negative observation 2 — M2 Batch 5

Viewer UI/federation implementation touched `getAggregateSelection()`, `getAllModels()`, `loadDocumentNode(...,{keepCurrentModels})`, `isolate` / `fitToView`, and extension lifecycle. The session report did not visibly mention Agent Kit usage, but correctness was recovered via Codex/live Viewer verification. Do not classify this as confirmed negative unless archived evidence supports it.

### M2.1 planning candidate positive observation

This is the case under audit. Do not promote it to positive unless invocation is confirmed.

## Required classification table

Produce a table with at least:

| M2.1 moment | Viewer-specific need | Skill that ideally applies | Confirmed invocation? | Evidence | Trigger type | Outcome |
|---|---|---|---|---|---|---|

`Trigger type` must be one of:

- `autonomous`
- `plan-forced`
- `handoff`
- `generic-agent`
- `ambiguous`
- `not-applicable`

## Skill-by-skill verdict

For each skill, answer whether it was invoked, where, what proves it, and whether it should have triggered elsewhere.

### `aps-viewer-implementation-research`

Determine whether M2.1 ever invoked it, and whether the planning task was already bounded enough that API-evidence was the better first skill.

### `aps-viewer-api-evidence-investigation`

Determine whether Task 7's overlay investigation actually invoked it. If yes, state whether the trigger was autonomous and whether it materially changed the plan (for example, choosing public `viewer.overlays.*` instead of `viewer.impl.*`).

### `viewer-extension-lifecycle-audit`

Determine whether it ran during marker lifecycle design/implementation/fix review. If not, assess whether that was a routing miss and whether its current checks likely would have caught unload/model-unload cleanup issues earlier.

## Sandbox vs Global Skill Availability

Include this exact section heading and answer:

1. Could the M2.1 session access the Agent Kit repository filesystem directly?
2. Were Viewer skills nevertheless available globally?
3. If a skill was invoked, what content was available to it?
4. Was the provenance record read directly from Agent Kit, injected through skill context, or otherwise supplied?
5. Did sandbox restrictions materially affect autonomous routing or skill usefulness?

If any answer cannot be established, say `not established`.

## Overall routing classification

Choose exactly one:

### A. Confirmed autonomous-trigger positive
Only if direct evidence proves an applicable Viewer skill fired without explicit user/plan instruction.

### B. Confirmed autonomous-trigger negative
Only if direct logs clearly show an applicable skill did not fire.

### C. Mixed
Some Viewer moments triggered correctly and others did not.

### D. Ambiguous / insufficient trace evidence
Research quality is clear but actual skill invocation cannot be proven.

Do not choose A merely because the research followed good evidence discipline.

## Modification recommendation

Using the combined evidence from:

- prior M2 natural-trigger postmortem,
- M2 Batch 5 field behavior,
- this M2.1 routing audit,

recommend one of:

1. No Agent Kit change yet
2. Narrow trigger-description change
3. Cross-cutting Viewer-claim verification rule
4. Both 2 and 3
5. Another minimal change, precisely described

If recommending a modification:

- identify the exact skill/file area,
- explain what natural prompt/task shape currently fails to trigger,
- avoid broadening the skill so much that every Viewer-adjacent task invokes it,
- propose 2–4 minimal natural-trigger regression prompts.

Do NOT make any modification in this pass.

## Required report footer

End with:

### Routing Verdict

A concise verdict covering:

- whether M2.1 truly used Agent Kit,
- whether Task 7 was skill-backed or generic research,
- whether any autonomous trigger was confirmed,
- whether sandbox restrictions mattered,
- whether Agent Kit should now be modified.

### Evidence Confidence

Use `High`, `Medium`, or `Low`, and explain why in 2–4 sentences.

## Output constraints

Write the report directly to:

`/Users/kangea/Workspace/Codes/aps-viewer-agent-kit/docs/research/collision-detection-m2.1-agent-kit-routing-audit.md`

Do not ask the user to copy the report.

Do not modify or commit anything else.
Do not merge/finish the M2.1 branch.
Do not clean the SDD workspace.

Stop after the report is written.
