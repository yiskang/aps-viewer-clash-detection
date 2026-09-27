# Prompt — Agent Kit Knowledge Validation + G1 SVF2 Initializer Diagnosis

I explicitly authorize a **read-only Viewer Agent Kit knowledge validation followed by a read-only G1 SVF2 initializer diagnosis**.

This authorization does **not** include:

- modifying Viewer Agent Kit skills or knowledge;
- changing Viewer initializer settings;
- changing production/runtime configuration;
- changing Viewer version;
- re-translating models;
- uploading new models;
- modifying Viewer Adapter, Core, Viewer Clash Panel, M4, or host integration;
- rerunning G1 F1–F8;
- starting G2/G3/H1/H2;
- starting OQ-1;
- any production fix.

The purpose of this task is twofold:

1. determine whether the Viewer Agent Kit already contains the SVF2 loading knowledge that should have informed the previous G1 investigation;
2. diagnose whether the current G1 block is caused by Viewer initialization/load-path configuration or by the available fixtures.

Do not skip the Agent Kit validation and jump directly to runtime diagnosis.

---

# Part A — Viewer Agent Kit knowledge validation

## A1. Identify the relevant Agent Kit / skills source

Locate the Viewer Agent Kit / Viewer skills repository or installed skill source that is intended to provide Autodesk Viewer knowledge for this project.

Use the actual repository/skill artifacts as the source of truth.

Record:

- repository/path;
- branch/HEAD if local repo access exists;
- relevant skill names/files;
- any routing/invocation instructions that determine when these skills should be used.

Do not modify them.

## A2. Search specifically for SVF2 / OTG loading knowledge

Search the Viewer Agent Kit / skills for knowledge about:

- `AutodeskProduction2`
- `streamingV2`
- SVF2
- OTG
- Viewer `Initializer`
- `isOTG()`
- `isSVF2()`
- SVF vs SVF2 derivative loading
- Model Derivative `outputType: "svf2"`
- fallback / derivative selection behavior

Do not rely on memory. Inspect the actual skill/repository content.

For each relevant hit, report:

- exact skill/file;
- what the skill actually says;
- whether it distinguishes:
  - derivative translation metadata;
  - Viewer runtime initializer configuration;
  - live-loaded model format checks.

## A3. Classify the Agent Kit outcome

Classify the result as exactly one of:

### AK-1 — Knowledge exists and is correct
The Agent Kit already contains the required SVF2 loading knowledge, including the relevant initializer/runtime distinction.

Then determine whether the previous G1 workflow actually invoked/used that knowledge.

### AK-2 — Knowledge exists but is incomplete/ambiguous
The Agent Kit mentions SVF2/OTG but does not clearly cover the required initializer/runtime conditions or format verification.

Record the exact gap.

### AK-3 — Knowledge is absent
The relevant Viewer skill set does not contain the required SVF2 loading knowledge.

Record this as an Agent Kit knowledge gap.

### AK-4 — Knowledge is contradictory/outdated
The Agent Kit contains guidance that conflicts with the actual Viewer/runtime requirements or with other skill content.

Record the contradiction.

### AK-5 — Skill source cannot be determined/accessed
State exactly what is unavailable.

## A4. Invocation/routing validation

If the knowledge exists, determine whether the prior G1 investigation should reasonably have used that skill.

Classify the routing result as one of:

- `ROUTING_OK_USED`
- `ROUTING_OK_BUT_NOT_USED`
- `ROUTING_NOT_TRIGGERED_BY_CURRENT_RULES`
- `ROUTING_AMBIGUOUS`
- `ROUTING_UNVERIFIABLE`

Explain the evidence.

Do not modify routing rules or skills in this task.

## A5. Persist Agent Kit validation evidence

If the Viewer Agent Kit repository is the current repo in scope and its artifact conventions apply, persist the validation under its established `docs/research/` or `docs/reviews/` structure.

If the Agent Kit is a separate repository, do not write into it unless that repository is explicitly in scope and repository governance allows it.

At minimum, persist the result in the current Clash Detection repo research artifact so the G1 diagnosis has a durable dependency trail.

Suggested section title:

`Viewer Agent Kit knowledge/routing validation`

---

# Part B — G1 SVF2 initializer diagnosis

Only after Part A is complete, continue with the runtime diagnosis.

## B1. Repository-first verification

Verify:

- current repository;
- branch;
- HEAD;
- working-tree state;
- current G1 blocked status;
- G2/G3/H1/H2 remain unauthorized.

Read:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- G1 authorization/evidence artifacts
- current live Viewer harness/server files
- normal app Viewer initialization code
- model/document load path

Do not modify production files.

## B2. G1/live harness Viewer initializer

Locate the exact `Autodesk.Viewing.Initializer` configuration used by the current G1/live verification path.

Record actual values for:

- `env`
- `api`
- Viewer version / viewer script URL
- any initializer options relevant to derivative/streaming selection
- token/auth setup only as needed to understand the load path

Explicitly determine whether the harness uses:

```js
env: 'AutodeskProduction2'
api: 'streamingV2'
```

Do not change it.

## B3. Production/app Viewer initializer

Locate the actual Viewer initializer used by the repo's normal app/runtime.

Record:

- `env`
- `api`
- Viewer version
- model/document loading path

Determine whether the production/app path is configured for SVF2 streaming or a legacy path.

Do not change it.

## B4. Candidate derivative evidence

For each candidate model previously tested in G1:

- identify URN/object/source where known;
- inspect available manifest/derivative metadata;
- record whether an SVF2 derivative is advertised;
- record whether legacy SVF derivatives are also available;
- record any fallback evidence visible in the app/load path.

Important:

`outputType: "svf2"` alone is **not** sufficient proof that the live-loaded Viewer model is SVF2.

Do not submit a new translation job.

## B5. Live-loaded format evidence

For any minimal diagnostic live load already permitted by the current harness, record:

- initializer `env`
- initializer `api`
- Viewer version
- model
- `model.isOTG()` if available
- `model.isSVF2()` if available

A model counts as confirmed SVF2 for this diagnosis only when the live runtime evidence supports the repository's accepted SVF2 criterion.

If the repository/API supports both checks, record both explicitly.

Do not retry with changed initializer values.

Do not begin F1–F8.

## B6. Trace the load path

Trace how the model is loaded:

- `Document.load` / equivalent;
- load options;
- derivative selection behavior if explicit;
- environment/API-dependent branches;
- fallback behavior visible in code.

Determine whether the current initializer/load path is sufficient to explain:

```js
model.isOTG() === false
```

even when manifest metadata advertises SVF2.

---

# Part C — Diagnosis disposition

End with one primary runtime disposition:

### D1 — G1 harness initializer is the blocker
The G1 harness is not using the required SVF2 environment/API path, while available derivative evidence is otherwise compatible with SVF2.

Next action would require separate owner authorization to modify only the verification harness and rerun the SVF2 format precondition before F1–F8.

### D2 — Production/runtime initializer is also legacy
The normal app/runtime also does not use the required SVF2 path.

This is a host/runtime integration issue and is outside the current G1 verification scope.

Do not fix it.

### D3 — Candidate fixtures lack usable SVF2 derivatives
Initializer/load path are correct, but no tested fixture can be live-loaded as SVF2.

Next action would require separate owner authorization for a controlled SVF2 fixture translation/upload.

### D4 — Manifest advertises SVF2 but live load still is not SVF2
Initializer appears correct and derivative metadata advertises SVF2, but the live model still does not confirm SVF2.

Record the contradiction and stop for review.

Do not change Viewer version, load semantics, or translation behavior.

### D5 — Multiple causes / insufficient evidence
State exactly what remains unresolved and the smallest next action needed.

---

# Part D — Cross-result interpretation

Combine the Agent Kit and runtime results.

Examples:

- `AK-1 + ROUTING_OK_BUT_NOT_USED + D1`
  - Agent Kit already knew the initializer requirement, but the G1 workflow failed to use it; harness configuration is the immediate runtime blocker.

- `AK-3 + D1`
  - Agent Kit has a real knowledge gap, and the G1 harness is also configured incorrectly.

- `AK-2 + D4`
  - Agent Kit knowledge is incomplete and the runtime path still has an unresolved SVF2 selection contradiction.

Explicitly state whether this incident represents:

- Agent Kit knowledge gap;
- Agent Kit routing/invocation gap;
- runtime/harness configuration gap;
- fixture gap;
- or a combination.

Do not repair any of these in this task.

---

# Evidence artifact

Persist the combined investigation in the Clash Detection repository under:

`docs/research/`

Suggested filename:

`docs/research/2026-09-27-g1-svf2-agent-kit-and-initializer-diagnosis.md`

The artifact should include:

1. Agent Kit source inspected;
2. skill files/hits;
3. AK classification;
4. routing classification;
5. G1 harness initializer;
6. production initializer;
7. derivative evidence;
8. live format evidence;
9. D1–D5 disposition;
10. recommended next owner decision.

Update:

`docs/handoffs/latest.md`

to record:

- G1 remains blocked;
- Agent Kit validation result;
- initializer diagnosis result;
- no production fix made;
- G2/G3/H1/H2 remain unauthorized;
- next authorized action: none / awaiting owner decision.

---

# Stop gate

Do not:

- modify Agent Kit skills;
- modify Agent Kit routing;
- change `env`;
- change `api`;
- change Viewer version;
- submit a translation;
- upload a model;
- rerun G1 F1–F8;
- start G2/G3/H1/H2;
- start OQ-1;
- start host integration;
- modify production code;
- commit/push unless separately authorized.

---

# Final report

Report:

## Agent Kit validation
- Agent Kit repo/path;
- relevant skill files;
- exact knowledge found;
- AK-1/AK-2/AK-3/AK-4/AK-5;
- routing classification;
- whether the previous G1 investigation used the relevant knowledge.

## Runtime diagnosis
- branch / HEAD / git status;
- G1 harness `env` / `api`;
- production app `env` / `api`;
- Viewer version(s);
- model load path;
- candidate derivative evidence;
- `isOTG()` / `isSVF2()` evidence;
- D1/D2/D3/D4/D5.

## Combined conclusion
- Agent Kit knowledge gap? yes/no;
- Agent Kit routing gap? yes/no;
- harness/runtime configuration gap? yes/no;
- fixture gap? yes/no/unknown;
- recommended next owner action.

Also confirm:
- no Agent Kit skill was modified;
- no initializer/runtime configuration was modified;
- no model was uploaded or translated;
- G1 F1–F8 was not rerun;
- no G2/G3/H1/H2/OQ-1/host work was started.
