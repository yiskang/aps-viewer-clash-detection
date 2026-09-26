# Prompt — Remediate Viewer Adapter Implementation Plan After Independent Work Review

Open the existing **Federated Clash Test Viewer Adapter planning session** or a fresh Claude session if needed.

This is a **plan-remediation task only**.

Do **not** implement production code.
Do **not** create `clashtest/viewer/`.
Do **not** run Task 13 live acceptance.
Do **not** reopen accepted Core Engine behavior.
Do **not** reopen M4.
Do **not** start Viewer Clash Panel/UI work.

Use as source of truth:

- `docs/superpowers/plans/2026-09-26-federated-clash-test-viewer-adapter-implementation.md`
- `docs/reviews/2026-09-26-federated-clash-test-viewer-adapter-plan-internal-codex-review.md`
- current `docs/handoffs/latest.md`
- accepted Federated Clash Test & Results design spec
- accepted Core Engine implementation/tests
- the independent ChatGPT Work review findings below
- actual current source where needed to verify signatures/limits

The independent Work review found:

- 0 Critical
- 3 High
- 3 Medium
- 1 Low

Implementation is **not authorized** until these findings are remediated and independently re-reviewed.

Write changes directly into the existing implementation plan and handoff.

Do not create a replacement plan unless the existing file is structurally unusable.

---

# Owner decisions — already resolved

Do not re-open these as questions.

## D-V6 — tree-reachable not-loaded / owner-unresolvable / out-of-range fragments

**Owner disposition: accept fail-closed planning for the current evidenced envelope.**

If a tree-reachable fragment is:

- not loaded,
- owner-unresolvable,
- or out of valid fragment-id range,

planning fails for the run.

Do **not** introduce a durable partial/incomplete carrier in this milestone.

Do **not** reopen the accepted Core port/result contract.

This is intentionally conservative and may be revisited in a future explicitly-authorized design if partial planning across these cases becomes a product requirement.

The plan must state this as an explicit owner-approved policy, not as an unresolved D-V6 decision.

---

## D-V9 — bounded planning

**Owner disposition: planning itself must be bounded before Core execution begins.**

Do not build an unbounded full-tree index and rely on Core extraction limits afterward.

Use the existing collision limits as the planning boundary:

- `maxFragmentsPerDbId`
- `maxChildrenPerNode`
- existing whole-model population limit / `maxCollisionInstancesPerEpoch` where applicable

The adapter must fail closed during planning when those existing bounds are exceeded.

For whole-model planning:

- perform bounded population/count validation before constructing the full retained planning index;
- do not allocate/retain the entire tree first and only then discover that the model exceeds the limit.

For explicit root scopes:

- enforce existing per-root fragment/children bounds while traversing/planning.

Do not invent a new public resource-limit policy.
Do not change the Core limits.
Do not add a new per-unit durable gap representation.

If exact implementation mechanics require a bounded streaming/counting pass followed by a second traversal, specify that explicitly in the plan.

This is a prerequisite correctness/resource-safety requirement, not a new Core feature.

---

# Required remediation

## High 1 — resource-bounded planning

Revise D-V4 / D-V9 and all affected tasks so planning cannot perform unbounded allocation or synchronous traversal before hitting existing limits.

The plan must define:

### Explicit scopes

For each requested root:

- enforce `maxFragmentsPerDbId`;
- enforce `maxChildrenPerNode`;
- fail planning deterministically if either bound is exceeded;
- do not retain an unbounded subtree before detecting the excess.

### Whole-model scope

Before building the full retained index:

- perform a bounded population/count pass;
- stop/fail when the existing whole-model population ceiling is exceeded;
- only construct the retained index after bounded eligibility is established.

If the Viewer tree API forces callback-based enumeration, specify how the counter abort/fail path works without retaining already-unbounded data.

Add RED → GREEN tests for:

- root over fragment limit;
- node/root over children limit;
- whole-model population over limit;
- exact-at-limit success;
- no partial retained index survives failed planning.

Keep Core unchanged.

---

## High 2 — every committed task checkpoint must be green

The plan's global rule already requires each task checkpoint to leave the suite green.

Fix Tasks 1–3 so no task intentionally commits a known failing scaffold state.

Preferred correction:

- Task 1 may add directory/module scaffolding and tests that are valid for an empty/non-production scaffold;
- move the “production modules must be non-empty/present” assertion to the task that actually creates them;
- or combine/reorder Tasks 1–3 if that is cleaner.

Requirements:

- every task commit is green;
- no “expected red until Task 3” committed state;
- RED may exist inside the task execution before implementation, but the task's final committed checkpoint must be GREEN.

Update task dependencies/commit boundaries accordingly.

---

## High 3 — D-V6 must no longer be unresolved

Apply the owner disposition above.

Update:

- decision table / D-V6 section;
- implementation tasks;
- tests;
- acceptance criteria;
- unresolved-owner-decisions section;
- handoff.

Remove wording that says the owner still needs to decide D-V6.

Add tests proving tree-reachable N/U/out-of-range conditions fail planning deterministically and do not produce a misleading partial run.

---

# Medium remediation

## Medium 1 — Task 10 executable acceptance statements

Correct:

- terminal status literal:
  - use `completed`, not `complete`;
- `validateResultSet` invocation:
  - include the required `{ limits }` argument matching the actual current signature.

Check all Task 10 snippets/assertions for current-source signatures.

Do not add full test source merely to satisfy review; executable test intent/assertions are enough.

---

## Medium 2 — Task 6 explicit-scope wording contradiction

Task 6 currently says “no whole-tree index” while D-V4 / explicit normalization requires one.

Rewrite this section so it matches the chosen bounded algorithm.

If the final design is:

1. bounded preflight/count traversal;
2. then one retained full-tree index for eligible explicit-scope planning;

say exactly that.

Do not leave mutually contradictory prose.

---

## Medium 3 — live unload wiring acceptance

Strengthen Task 13 so the live acceptance actually exercises the production unload wiring.

The live characterization must, within the already-approved Viewer/OQ-4 envelope:

- install the real `wireModelUnload` path against the Viewer event;
- load/register the old model;
- trigger or observe the real unload event;
- verify unregister/evict ordering;
- load/register the replacement/new model as applicable;
- prove the old model is evicted;
- prove the new/current model survives and remains usable;
- prove a late unload for the old model cannot evict the new registration;
- dispose the listener/wiring cleanly.

Do not extend OQ-4 beyond its accepted Audubon / SVF / Viewer 7.124.2 envelope.

If a true real-event reload cannot be executed deterministically in the existing live harness, the plan must instead retain an explicit:

`LIVE_UNLOAD_INTEGRATION_UNVERIFIED`

gate and must **not** allow the adapter to be called production-ready after T3.

Prefer adding the bounded live characterization if the current Viewer harness supports it.

Remember:

- writing Task 13 is part of implementation planning;
- **executing T3 remains separately owner-authorized**.

---

# Low remediation

Correct the editorial statement in Task 1 about how many real-tree tests fail.

Do not inflate this into a structural change.

---

# Deferred items — keep independent

Do not absorb these into Viewer Adapter:

- P5 ordered-pair status-reader fix;
- broad documentation reconciliation beyond the one adapter-related README row already in scope;
- AC-19 / AC-17(d) compare-conjunct disposition;
- OQ-1 identity derivation;
- remote persistence;
- annotation work;
- new/tighter public resource limits;
- M4 Phase 4 / workers;
- Viewer Clash Panel/UI work.

If any review wording accidentally makes one of these a prerequisite, correct it.

---

# Test-source detail level

Do **not** expand Tasks 10, 11, or 13 into full test source merely because they currently list assertions instead of complete code.

The plan is sufficient if each task precisely specifies:

- fixture/setup;
- action;
- expected result;
- negative controls;
- failure conditions;
- cleanup;
- acceptance gate.

Full source belongs to implementation.

---

# Handoff update

Update `docs/handoffs/latest.md` to reflect the independent Work review and remediation state.

Before independent re-review, the handoff should say:

- Viewer Adapter planning remains the only authorized milestone activity;
- implementation is **not authorized**;
- independent Work review found 3 High blockers;
- D-V6 and D-V9 owner decisions are now resolved as stated above;
- plan has been remediated and is awaiting independent Work re-review;
- T3 live execution remains separately unauthorized;
- Viewer Clash Panel/UI remains downstream and out of scope.

Do not claim the plan is implementation-ready until Work re-review says so.

---

# Internal verification after edits

After remediation:

1. run a targeted internal Codex review only over:
   - bounded planning / D-V9;
   - D-V6 fail-closed policy;
   - Tasks 1–3 green checkpoints;
   - Task 6 wording;
   - Task 10 signatures;
   - Task 13 live unload acceptance;
   - directly affected cross-references.
2. Fix genuine Critical/High issues in those changed areas.
3. Do not restart unrestricted whole-plan review unless the targeted review finds an architectural contradiction requiring it.
4. Verify no production code was created.
5. Run the current baseline test suite only if repository files/scripts changed in a way that could affect execution; documentation-only plan edits do not require repeating the entire suite unless repository convention requires it.

---

# Stop gate

After remediation:

- do **not** implement anything;
- do **not** run T3;
- do **not** commit unless explicitly authorized;
- do **not** start a new review loop beyond the targeted internal verification.

Stop for independent ChatGPT Work re-review.

---

# Final response

Report:

- exact plan path;
- exact sections/tasks changed;
- how D-V6 was resolved;
- how D-V9 bounded planning was resolved;
- how Tasks 1–3 were made green at every commit boundary;
- Task 10 corrections;
- Task 6 correction;
- Task 13 live-unload disposition;
- targeted Codex review findings/fixes;
- unresolved owner decisions remaining;
- handoff updated: yes/no;
- branch;
- HEAD;
- final git status;
- explicit statement:
  - Viewer Adapter implementation is **not authorized**
  - T3 execution is **not authorized**
  - ready for independent Work re-review only
