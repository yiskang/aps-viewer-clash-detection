Analyze the M2 design-spec episode as a natural autonomous-trigger failure case for the APS Viewer Agent Kit.

This is a postmortem / routing analysis only.

Do NOT modify:
- any skill,
- any Knowledge/Pattern file,
- any collision-library file,
- the M2 design spec,
- validation fixtures.

Do NOT commit.

You may create exactly ONE research report at the path specified below.

Case under analysis:

During creation of the Collision Library Milestone-2 design spec, the agent was NOT explicitly told to use any Viewer skill.

The task was Viewer-specific and included a federated multi-model UI workflow.

The first draft failed to independently catch two load-bearing Viewer facts:

1. `viewer.getSelection()` is insufficient for a multi-model selection because it returns dbIds without model provenance; the correct federated selection API is `viewer.getAggregateSelection()`.

2. The current application does not already support simultaneous loaded models; its `loadDocumentNode(...)` path does not pass `keepCurrentModels: true`.

These were caught only later by an independent Codex review and then fixed in:

`docs/superpowers/specs/2026-09-05-collision-library-milestone2-design.md`

Treat this as a real natural-use observation of the UPDATED Agent Kit after the evidence-driven skill modifications.

Questions to answer:

1. Which Agent Kit skill(s) should ideally have triggered during the original M2 design task?

Evaluate at least:
- `aps-viewer-implementation-research`
- `aps-viewer-api-evidence-investigation`
- `viewer-extension-lifecycle-audit`

Distinguish:
- initial trigger,
- downstream handoff,
- cases that should not trigger.

2. At what exact point in the M2 design workflow should the trigger have occurred?

For example:
- when the prompt first introduced federated multi-model Viewer behavior,
- when inspecting current app model-loading code,
- when deciding how to resolve the selected source element,
- when asserting that the existing app already supports multiple loaded models.

3. Why did autonomous routing likely fail?

Inspect the CURRENT post-modification skill descriptions / trigger language / routing rules and determine whether the failure is best explained by:

- trigger wording too narrow,
- “implementation research” being interpreted as code implementation only rather than design/spec work,
- Viewer API verification not being mandatory enough during architecture/spec tasks,
- handoff conditions not reached because the initial research skill never triggered,
- skill discovery / invocation mechanics,
- another cause supported by evidence.

Do not guess from memory; inspect the current skill files directly.

4. Was this a skill-design problem, an agent-behavior problem, or both?

Separate:
- the skill being correct/useful when invoked,
from
- the agent failing to invoke it autonomously.

5. Would the updated skills, if invoked correctly, have caught these two facts?

For each fact:
- identify the likely skill path,
- identify what evidence/workflow step should have surfaced it,
- state whether the current skill text actually requires that verification.

6. Does this case justify modifying skill trigger/routing text again?

Possible conclusions:
- no change needed; this is only one autonomous miss,
- narrow trigger wording change justified,
- cross-skill routing guidance needs improvement,
- project/system prompt guidance should change instead of the skill,
- more natural observations are needed before modifying anything.

Do NOT make the change in this pass.

7. Propose a minimal natural-trigger regression scenario

Define one or two short future prompts that:
- should autonomously trigger the appropriate Viewer skill,
- do NOT explicitly name the skill,
- exercise this exact multi-model/federated API verification scenario.

Do not run them now.

8. Record this case separately from controlled A/B evidence.

This is NOT another correctness/usefulness benchmark.

Classify it as:
- autonomous-trigger positive/negative observation,
- routing observation,
- natural field-test evidence.

End with:

## Trigger Verdict

For each relevant skill:
- Should have triggered? yes/no
- Actually triggered? yes/no
- Miss severity
- Recommended action

## Modification Recommendation

State:
- modify now / do not modify now
- exact reason
- if modification is recommended, list only the minimal trigger/routing areas to revisit later

Write the final report to exactly:

`/Users/kangea/Workspace/Codes/aps-viewer-agent-kit/docs/research/collision-detection-m2-natural-trigger-postmortem.md`

Do not create or modify any other file.