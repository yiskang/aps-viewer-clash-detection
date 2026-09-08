# M4 Design Spec — Final Focused Review Prompt

You are reviewing the finalized M4 design spec for the APS Viewer collision library:

`docs/superpowers/specs/2026-09-08-collision-library-milestone4-performance-worker-decision-design.md`

The current spec is already considered design-complete enough to enter implementation planning, subject to one final focused review.

This is not a brainstorming pass.
This is not a request to redesign M4.
This is not a request to pre-decide the A/B/C/D architecture verdict.

Your job is to find only issues that would make the spec unsafe, contradictory, mechanically unimplementable, or unsuitable as the direct basis for an implementation plan.

## Review objective

Determine whether the spec is structurally ready for `/superpowers:writing-plans`.

Review specifically for:
1. contradictions between sections;
2. unreachable or circular decision logic;
3. missing implementation-critical definitions;
4. task-order dependencies that are underspecified or impossible;
5. measurement requirements that cannot actually be implemented with the allowed instrumentation;
6. conditional spikes whose trigger conditions are ambiguous;
7. lifecycle / concurrency / stale-result semantics that could still create unresolved promises, contract regressions, or global-vs-per-call ambiguity;
8. correctness gates that conflict with the permitted M4 scope;
9. memory or performance acceptance rules that cannot be evaluated mechanically;
10. scope leaks that would accidentally authorize worker implementation, new public APIs, Federated Clash Test functionality, UI work, or unrelated architecture changes;
11. anything in the spec that would force the implementation plan to invent new product or architecture decisions rather than simply plan the work already specified.

## Important context

The spec has already gone through a pre-draft framing review and an independent `codex-review`.

That review found:
- 5 Critical
- 6 High
- 1 Medium

All findings were fixed in the current document.

Do not re-report a previously fixed issue unless the current text still contains the defect.

The current design intentionally establishes:

### M4 is a decision experiment

`benchmark → evidence → architecture decision`

It does not pre-pick A/B/C/D. A/B/C/D are the output of the experiment.

### B/C are justification verdicts, not implementation-parity verdicts

M4 does not build a real worker collision implementation.

Therefore:
- B/C mean that a named worker boundary is justified strongly enough to authorize a later implementation milestone.
- Full synchronous-vs-worker correctness parity belongs to that later implementation milestone's adoption prerequisites.
- Do not reintroduce a requirement that would make B/C impossible without violating M4's non-goals.

### D is a legitimate experiment result

A mandatory-D condition does not mean the design spec itself is incomplete.

Examples include:
- target not product-confirmed;
- representative device/browser scope not confirmed;
- realistic workload not confirmed;
- memory multiplier not confirmed;
- decision-driving evidence statistically inconclusive.

Those may correctly result in verdict D after the M4 gate runs.

Do not reject the design merely because D is currently the likely provisional outcome.

### Gate before worker spikes

The intended dependency is approximately:

```text
instrumentation
    ↓
M4 measurement gate
    ↓
main-only / transferable partition
    ↓
baseline responsiveness evaluation
    ↓
cheap unconditional worker feasibility spikes
    ↓
conditional worker vertical spikes only if justified by baseline evidence
```

The implementation plan must not blindly implement every spike up front.

### Closed instrumentation list

The spec deliberately permits exactly the additive instrumentation listed in §16.4.

It does not authorize unrelated production architecture work.

Treat any implementation requirement that cannot be satisfied with that closed list as a serious issue.

### Existing public contracts remain authoritative

M4 must not silently alter:
- `CollisionWorld` public behavior;
- concurrent `findClashes` semantics;
- placement-revision arming behavior;
- lifecycle error precedence;
- `evictModel` synchrony / never-throw expectations;
- diagnostic reason strings;
- public statistics semantics;
- the synchronous implementation as correctness oracle.

## Focused checks

### A. Can an implementation plan be written directly from the spec?

Inspect the spec as if you were about to write the implementation plan.

Ask:
- Can the work be decomposed without inventing new architecture?
- Are prerequisites and ordering explicit enough?
- Are there tasks that appear independent but actually depend on measurement output?
- Are conditional tasks clearly gated?
- Are all required files / surfaces / hooks identifiable?
- Is there any task whose success criterion is undefined?

If implementation planning would require making a new design decision, identify exactly where.

### B. Verify the gate-first dependency structure

Check that the spec consistently enforces:
1. additive instrumentation first;
2. baseline measurement / causal attribution;
3. main-only vs transferable partition;
4. target evaluation;
5. only then the worker spikes whose prerequisites are satisfied.

Look especially at §6, §7, §16, and §17.

Flag any section that would allow or require S7′ / S8′ before the baseline establishes the trigger.

### C. Verify conditional spike mechanics

For S1′, S3′, S4′, S5′, S6′, S7′, and S8′, confirm:
- exact prerequisite;
- whether it is unconditional or conditional;
- whether its output feeds a specific decision condition;
- whether its implementation bound is narrow enough to remain a spike;
- whether it accidentally becomes a real worker collision implementation.

Pay special attention to S7′.

The spec says it is a stage-scoped batched vertical measurement with stub result mapping, not a production worker collision path.

If the current wording still leaves enough ambiguity that an implementer could reasonably build a real worker path, flag it.

### D. Verify instrumentation sufficiency

Cross-check every required metric against §16.4.

The allowed list is:
1. yield instrumentation;
2. narrow-phase interior labels + additive inconclusive-cause enum;
3. extraction-stage bracket;
4. read-only memory diagnostic accessors;
5. structured no-op diagnostic-event recorder;
6. nothing else.

Check that the spec does not require telemetry that cannot be produced using:
- these hooks;
- CDP / Playwright;
- browser APIs;
- harness-only code;
- spike-only code.

Do not propose a new hook unless it is genuinely impossible to satisfy a binding requirement otherwise.

If a new hook truly is necessary, classify that as a blocker because it breaks the spec's closed instrumentation claim.

### E. Verify verdict mechanics

Check that A/B/C/D are mechanically reachable and mutually coherent.

In particular:
- A must not require evidence only a worker implementation could produce.
- B and C must not require full worker parity.
- D conditions must not accidentally make A/B/C impossible even after required external inputs are supplied.
- B vs C distinction must be evidence-driven rather than narrative.
- effect-rule and repetition rules must actually support the comparisons they are used for.
- capacity rejection must not accidentally count as success or silently remove a verdict-bearing case.

### F. Verify lifecycle and concurrency

Review §8–§11, especially §10.

Check:
- `requestId` remains per-call;
- concurrent calls remain independently settleable;
- duplicate responses are harmless;
- malformed responses settle the correct request;
- worker failure settles all affected requests;
- disposal / eviction / epoch replacement / placement invalidation produce the intended existing error classes;
- the linear path does not gain new placement-revision abort behavior;
- no promise can remain unresolved;
- no worker token is treated as identity authority.

Only report a defect if the current text still leaves an actual ambiguity or contradiction.

### G. Verify correctness gates vs M4 scope

Confirm that:
- TLAS-vs-linear correctness remains a hard M4 validation gate;
- stage-scoped spike comparisons are sufficient for B/C justification;
- full real-worker parity remains an adoption prerequisite for the later implementation milestone;
- no section elsewhere accidentally pulls full parity back into M4.

### H. Verify memory gate implementability

Inspect §15 for mechanical evaluability.

Check:
- Metric M can actually be computed from the specified data;
- Metric H is clearly only a cross-check;
- worker and main-thread memory are not accidentally mixed;
- peak / retained scopes are implementable;
- the provisional multiplier logic is consistent with mandatory D;
- pending-message memory has a measurable definition.

Only flag concrete implementation blockers, not preferences for a different memory methodology.

### I. Verify scope integrity

Confirm that M4 still excludes:
- production worker implementation;
- implementation plan itself;
- Federated Clash Test definitions;
- Selection A/B;
- persistent result sets;
- Group By/filtering UI;
- Viewer Clash Panel;
- issue/status workflow;
- UI progress components;
- `AbortSignal`;
- latest-call-wins;
- cross-origin isolation changes;
- `server.js` modifications;
- M1–M3 gate rewrites;
- unrelated public API work.

Flag any wording that contradicts these exclusions.

## Severity policy

Be extremely conservative with severity.

### Critical

Use only when the issue would make implementation planning unsafe or impossible, for example:
- contradictory binding requirements;
- an unreachable verdict;
- an impossible measurement requirement;
- lifecycle semantics that can leave promises pending;
- implementation scope that necessarily violates a stated non-goal;
- a missing design decision that the implementation plan would be forced to invent.

### High

Use when the spec is implementable but materially ambiguous in a way likely to cause the wrong implementation or invalid evidence.

### Medium

Use only for issues worth fixing before planning but not likely to invalidate the architecture decision.

Do not report Low / style / wording / preference findings in this pass.

## Required output

Write the review directly to:

`docs/research/m4-final-focused-review.md`

Do not only return findings in chat.

Use this structure:

```markdown
# M4 Final Focused Review

## Verdict

READY_FOR_IMPLEMENTATION_PLANNING
or
BLOCKED

## Summary

Short explanation.

## Findings

### Critical

...

### High

...

### Medium

...

## Implementation-plan readiness check

- Gate-first sequencing: PASS / FAIL
- Conditional spike gates: PASS / FAIL
- Closed instrumentation sufficiency: PASS / FAIL
- Verdict mechanics: PASS / FAIL
- Lifecycle/concurrency semantics: PASS / FAIL
- Correctness-gate scope: PASS / FAIL
- Memory gate implementability: PASS / FAIL
- Scope integrity: PASS / FAIL

## Required fixes before planning

Only include if BLOCKED.

## Planning notes

Only include concrete task-order or dependency observations useful to `/superpowers:writing-plans`.
Do not redesign the spec here.
```

## Final disposition rule

If there are no Critical findings and no High finding that materially prevents deterministic implementation planning, the verdict should be:

`READY_FOR_IMPLEMENTATION_PLANNING`

Do not block planning merely because:
- the eventual A/B/C/D outcome is unknown;
- D is currently the provisional reading;
- external inputs will later be needed for a binding A/B/C verdict;
- some spikes are conditional;
- worker architecture is intentionally not implemented in M4.

If you find a blocker, cite the exact section(s), explain the contradiction or missing decision precisely, and propose the smallest correction that preserves the current M4 direction.

Do not rewrite the whole spec.
Do not start implementation.
Do not write the implementation plan yet.
