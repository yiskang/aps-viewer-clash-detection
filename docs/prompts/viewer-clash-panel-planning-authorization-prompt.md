# Prompt — Authorize Viewer Clash Panel Planning / Design Only

I explicitly authorize **Viewer Clash Panel planning/design only**.

This authorization does **not** include implementation.

## Repository-first verification

Before planning:

1. Identify the repository currently in scope.
2. Read:
   - `docs/handoffs/latest.md`
   - repository-level instructions such as `CLAUDE.md`
   - the accepted Federated Clash Test & Results design/spec artifacts
   - the completed Viewer Adapter implementation/closeout artifacts
   - the latest independent implementation and T3 verification reviews
3. Independently verify:
   - branch
   - HEAD
   - working-tree state
   - `main` / `origin/main` state
   - Viewer Adapter milestone closeout state
   - current authorization boundary

Treat the repository as the source of truth. Do not rely only on conversational summaries.

## Current milestone boundary

The Viewer Adapter milestone is complete, independently reviewed, T3-verified, merged to `main`, and pushed.

The next authorized activity is:

**Viewer Clash Panel planning/design only.**

Do not:

- write production Viewer Clash Panel code;
- create the Panel implementation branch unless planning workflow explicitly requires a planning-only branch and repository governance permits it;
- start implementation tasks;
- modify Viewer Adapter production code;
- modify Federated Clash Test Core Engine behavior;
- reopen M4;
- fix the frozen-Core lease-dead discrepancy;
- fix duplicate `owner-mapping-mismatch`;
- add the four optional walk-helper entry checkpoints;
- start OQ-1 / host integration work;
- investigate the reload digest discrepancy except where needed to determine whether it is a Panel prerequisite;
- start remote persistence or annotation work;
- invent new public resource limits.

If planning proves that one of these is a prerequisite, record it as a dependency/decision. Do not implement it.

---

# Planning goal

Design the first Viewer-facing **Clash Detection Panel** that consumes the completed Federated Clash Test Core + Viewer Adapter.

The Panel should make the existing collision capabilities usable as a coherent Viewer workflow:

**configure test → run/stop → inspect progress/results → navigate clashes → filter/group results → focus/isolate/highlight → restore Viewer state**

This milestone is UI/application-layer planning. It must not reimplement collision logic already provided by Core or Viewer integration primitives already provided by the Viewer Adapter.

---

# UI reference

Use the previously discussed Clash Detection panel screenshot as **UX inspiration only**.

Useful concepts from the reference include:

- clash mode selector;
- tolerance input;
- self-clash toggle;
- group-by-element option;
- run / stop action;
- run status and result count;
- result filtering;
- result list;
- paging or virtualization;
- current clash navigation;
- selected-row state;
- source ↔ target element display;
- focus / isolate / highlight behavior;
- back-to-all / restore behavior.

Do **not** import architecture assumptions from the reference.

Specifically:

- our implementation does not use WASM;
- do not design around WASM heap telemetry;
- do not copy CPU/RAM/runtime telemetry unless there is an independently justified product requirement;
- do not treat the reference sample as a contract for our implementation.

---

# Required planning scope

## 1. Test setup

Define the UX and contract mapping for:

- clash/query mode;
- tolerance;
- source model scope;
- target model scope;
- self-clash;
- whole-model vs selected/explicit scopes where supported;
- test identity/name if needed;
- validation before run.

For every control, identify which existing Core/Test Definition field or API it maps to.

Do not invent UI options that the current Core cannot represent without clearly marking them as deferred.

## 2. Run lifecycle

Design:

- Run Clash;
- Stop/Cancel;
- planning state;
- running state;
- completed state;
- failed state;
- cancelled state;
- incomplete/partial states where applicable;
- progress/status presentation;
- whether partial results are browseable during execution.

Map UI states to actual Core result/run contracts.

## 3. Results

Define:

- result list structure;
- clash/result identity;
- source ↔ target presentation;
- model display name;
- element identifier/display label;
- gap/tolerance/distance information where valid;
- result count;
- filtered count;
- selected result;
- empty state;
- failed/incomplete state.

Do not make the Panel derive durable identity itself if the Core/Adapter already provides the required mapping.

## 4. Navigation and Viewer interaction

Use Viewer Adapter capabilities for:

- resolving result identity back to Viewer model/dbId;
- focus;
- fit-to-view;
- isolate;
- highlight/theming;
- clearing current visualization;
- restoring prior/all-model state.

Define the interaction contract between Panel and Viewer Adapter.

The Panel should not directly duplicate Viewer-internal model lifecycle logic.

## 5. Filtering

Plan the first supported filtering UX, including as applicable:

- tolerance/gap filtering;
- model filtering;
- clash mode/status filtering;
- text/element filtering;
- hide overlaps / clearance-gap behavior if supported by result semantics.

Clarify whether filtering is:

- client-side presentation filtering;
- result-query filtering;
- or requires rerunning the clash test.

Avoid unnecessary reruns.

## 6. Grouping

Plan **Group by Element / composite rollup** behavior.

Define:

- grouping key;
- source-vs-target behavior;
- count aggregation;
- expansion/collapse behavior;
- selected clash behavior inside a group;
- whether grouping is purely presentation or requires additional Core support.

Do not assume new Core behavior unless demonstrated necessary.

## 7. Large result sets

Choose and justify:

- pagination;
- virtualization;
- or another bounded rendering strategy.

The UI must not attempt to synchronously render an arbitrarily large result list.

Define how selection/navigation behaves when the selected result is outside the currently rendered window/page.

## 8. Stale model / unload / reload UX

Design how the Panel reacts when:

- a model unloads;
- a result can no longer resolve to a live Viewer model;
- the model reloads;
- the Viewer Adapter reports stale/unresolvable identity;
- the result set remains valid but visualization is unavailable.

Do not silently assume cross-reload identity stability.

The existing reload digest discrepancy belongs to OQ-1 / host integration unless this planning work proves it blocks a required Panel interaction.

If it becomes a prerequisite, document the exact blocking interaction and stop short of solving OQ-1.

## 9. Error and diagnostic UX

Define user-facing behavior for:

- enumeration failure;
- planning failure;
- extraction-limit/resource failure;
- cancellation;
- stale/unloaded model;
- Viewer Adapter resolution failure;
- partial/incomplete result conditions;
- unexpected Core failure.

Keep internal diagnostics available for debugging without exposing implementation noise unnecessarily.

## 10. Viewer state ownership

Define who owns temporary Viewer state changes produced by the Panel.

Cover:

- isolate state;
- theming/highlight state;
- selection;
- fit/navigation;
- restoring state when:
  - changing selected clash;
  - pressing Back to All;
  - starting a new run;
  - closing the Panel;
  - unloading a model.

Avoid leaving stale visualization state behind.

## 11. Panel structure

Propose the initial Panel information architecture.

At minimum consider:

- test setup section;
- run/status section;
- filter/group controls;
- results section;
- selected-clash navigation/actions.

Keep the first version coherent and practical. Avoid prematurely designing a full ACC/Model Coordination clone.

---

# Architecture questions to resolve during planning

Explicitly answer:

1. What is the minimum Panel API surface over the existing Core + Viewer Adapter?
2. Which existing Viewer Adapter capabilities are sufficient as-is?
3. Does the Panel require any Viewer Adapter additions?
   - If yes, distinguish small adapter extension from a new prerequisite milestone.
4. Is OQ-1 / reload identity a real prerequisite for the first Panel version?
5. Is Group by Element presentation-only with current result identity, or does it require additional domain support?
6. Should result browsing use pagination or virtualization for v1?
7. Should results be browseable during a running clash test?
8. What Viewer state is restored on Panel close / Back to All?
9. What is explicitly deferred from v1?

Do not silently resolve ambiguous product decisions. Record alternatives and a recommendation, then identify owner decisions.

---

# Deliverables

Create/update the repository artifacts appropriate to the established structure.

Expected primary artifact:

- a Viewer Clash Panel design/spec under:
  `docs/superpowers/specs/`

If research is needed to support a design decision, put it under:

`docs/research/`

If you perform a substantial internal review, persist it under:

`docs/reviews/`

Update:

`docs/handoffs/latest.md`

to record:

- repository / branch / HEAD / working-tree state;
- current milestone = Viewer Clash Panel planning/design;
- implementation remains unauthorized;
- governing design artifact;
- latest review/research artifact;
- unresolved decisions/dependencies;
- next authorized action;
- work that must not begin.

Do not create the implementation plan yet unless explicitly authorized after design review.

---

# Review requirement

Before claiming the design is ready:

1. Run an internal architecture/spec review.
2. Fix genuine Critical/High issues found in that review.
3. Record unresolved owner decisions explicitly.
4. Stop for independent ChatGPT Work review.

Do not proceed from design to implementation planning merely because the internal review passes.

The next gate is:

**independent Work design review → owner decision**

---

# Stop gate

At the end of this task:

- no Viewer Clash Panel production code should exist;
- no implementation task should have started;
- no Core/M4 production code should be changed;
- no OQ-1 or host-integration implementation should have started;
- no next milestone beyond Viewer Clash Panel design should have started.

Stop after producing the design artifacts, internal review, and updated handoff.

Final response should report:

- branch;
- HEAD;
- git status;
- design/spec path;
- research/review artifact paths;
- major design decisions;
- unresolved owner decisions;
- whether OQ-1/host integration is a prerequisite;
- whether any Viewer Adapter extension is proposed;
- handoff status;
- explicit confirmation that Viewer Clash Panel implementation remains unauthorized.
