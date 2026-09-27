# Prompt — Bounded Plan Remediation for G1 SVF2 F1–F8 Harness

I explicitly authorize **one bounded plan-only remediation** of the G1 SVF2 F1–F8 harness build plan.

This authorization does **not** include:

- implementing the harness;
- creating/modifying the harness code;
- running F1–F8;
- changing production Viewer initialization;
- changing Viewer version;
- uploading or retranslating models;
- modifying Viewer Adapter, Core, Viewer Clash Panel production code, M4, OQ-1, or host integration;
- starting G2/G3/H1/H2;
- committing or pushing unless separately authorized.

Use the latest independent Work re-review as the governing remediation input.

## 1. Fix H1 — Viewer-load timeout cleanup must be same-realm and realizable

The current plan incorrectly crosses browser/Playwright realms during Viewer-load timeout cleanup and lacks a realizable terminal transition.

Revise the plan so timeout handling is explicit about which realm owns each resource and action:

- Playwright/Node realm owns browser, context, page, outer timers, and process-level evidence/logging.
- Browser/Viewer realm owns Viewer instance, Viewer model/document callbacks, Viewer event listeners, in-page timers/tokens, and Viewer/model cleanup actions that must execute inside `page.evaluate` or equivalent.
- Do not pass live Viewer/browser objects across realms.

Define a realizable terminal-state machine for:
- timeout before `Document.load` settles;
- late document arrival after timeout;
- `loadDocumentNode` timeout and late model arrival;
- unrecoverable/contaminated session state.

For every case, specify:
- exact state transition;
- owning realm;
- cleanup action;
- evidence record;
- whether the page/context/session must be abandoned.

The plan must prove that a timed-out or late load cannot later become PASS or contaminate subsequent F1–F8 phases.

## 2. Fix H2 — Viewer-script hash must gate PASS

Make critical Viewer executable identity mandatory for G1 PASS.

Require the plan to:
- retain final resolved Viewer JS URL;
- retain response status and relevant redirect chain;
- compute SHA-256 from the actual fetched bytes of the critical Viewer JS asset;
- compare against the documented expected/known-good digest;
- prevent PASS on hash absence, fetch failure, redirect ambiguity, or digest mismatch.

Define whether each condition is FAIL or BLOCKED and why.

Do not overclaim executable identity for resources that cannot be byte-bound.

## 3. Fix M1 — F8 must not double-count loaded-but-unreachable fragments

Rework F8 coverage math so all population classes are disjoint.

For each F8 relationship, define:
- authoritative F2 population source;
- numerator;
- denominator;
- explicit exclusion classes;
- proof exclusions are disjoint;
- partition equation that sums exactly to the authoritative F2 population.

Loaded-but-unreachable fragments must not be counted both in the denominator and as an exclusion.

No “full census” claim is allowed unless the equations close exactly.

## 4. Fix M2 — re-derive F7 bounds tolerance from the actual numeric path

Do not rely on the previously cited numeric precedent unless the actual data path justifies it.

The plan must identify:
- actual Viewer 7.124.2 APIs used;
- numeric representation at each comparison point;
- where Float32 rounding is introduced, if anywhere;
- where Float64 remains;
- transforms/matrix operations between source and compared bounds;
- coordinate space used.

Then define a deterministic, scale-aware tolerance rule grounded in that path.

Explain why:
- legitimate roundoff passes;
- materially wrong bounds fail.

Add a sensitivity control that perturbs bounds clearly beyond tolerance and must fail.

## 5. Fix M3 — classifier-stop controls must use the exhaustive control enum

Unify classifier-stop handling with the mandatory-control result schema.

Every control must use one exhaustive enum.

Do not invent a one-off state only for classifier-stop handling.

If classifier precondition blocks F1–F8:
- specify which controls were required before the stop;
- specify which are `NOT_EXECUTABLE` or equivalent within the single enum;
- ensure the overall verdict rules remain exhaustive and mechanically checkable;
- ensure no undefined state can produce PASS or PARTIAL accidentally.

## 6. Fix L1 — distinguish restoration from synthetic non-interference

Correct the universal wording that says every synthetic control restores shared state.

For each mandatory control, classify it as:
- shared-state perturbation → restoration required;
- isolated synthetic perturbation → non-interference proof required.

Record:
- state perturbed;
- whether restoration is required;
- restoration oracle or non-interference oracle.

Any shared-state perturbation that is not restored must still prevent PASS.

## 7. Preserve already resolved items

Do not reopen:
- F3 readiness behavior;
- F5 real-fixture within-limits rule;
- F6 coherent-session characterization;
- F7/F8 deterministic census requirement;
- fatal console/page/runtime policy;
- classifier-stop diagnostic record;
- separate owner gates for harness implementation and live F1–F8 execution;
- no production/Core/Adapter/host dependency.

`getAggregateHiddenNodes()` return-shape confirmation remains an implementation-time technical check unless this remediation proves the plan is currently wrong about it.

## 8. Internal verification

After editing:

1. Run a targeted internal plan review only over:
   - H1 timeout/realm/state-machine correction;
   - H2 Viewer-script hash gating;
   - M1 F8 partition math;
   - M2 bounds-tolerance derivation;
   - M3 control-enum consistency;
   - L1 restoration/non-interference wording;
   - directly affected verdict/evidence schema.
2. Fix genuine Critical/High findings.
3. Do not restart a broad unrelated review loop unless a true architectural contradiction appears.
4. Update `docs/handoffs/latest.md`.

The handoff must state:
- bounded plan remediation complete;
- harness implementation remains unauthorized;
- live F1–F8 execution remains unauthorized;
- production initializer remains unchanged;
- G2/G3/H1/H2/OQ-1/host remain unauthorized;
- next action = bounded independent Work re-review.

## Stop gate

Stop after plan remediation and targeted internal review.

Do not implement or run anything.

## Final report

Report:
- exact sections changed;
- H1 disposition and terminal timeout state machine;
- H2 Viewer-script hash gate;
- F8 partition/denominator rule;
- F7 bounds-tolerance derivation;
- control-enum correction;
- restoration/non-interference clarification;
- targeted internal review findings/fixes;
- branch / HEAD / git status;
- explicit confirmation that no harness code was written, no F1–F8 run occurred, no production initializer changed, and no G2/G3/H1/H2/OQ-1/host work started.
