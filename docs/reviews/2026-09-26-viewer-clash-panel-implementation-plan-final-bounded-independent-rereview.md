# Viewer Clash Panel implementation plan — final bounded independent re-review

- **Review date:** 2026-09-26
- **Repository / branch / HEAD:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection` · `main` @ `6a55b5040369d07b67f09fe31153c55eadf5694f` (`origin/main` identical)
- **Plan:** `docs/superpowers/plans/2026-09-26-viewer-clash-panel-implementation-plan.md`
- **Scope:** only the final T27/T33 README/default-gate remediation, OD-1(a)/OD-7(a), G-OD closure, and directly affected file lists, guards and authorization wording
- **Verdict:** **ready for owner implementation authorization**
- **Findings:** 0 Critical / 0 High / 0 Medium / 0 Low

This verdict is an acceptance-gate recommendation, not authorization. No production code, Panel implementation, live Viewer/SVF2 verification, OQ-1, host integration, Core, Viewer Adapter or M4 work was started.

## T27 README and default-gate documentation

**Complete and internally consistent.** T27 now includes both required documentation files in its Modify list, exact Step 3 diffs, Step 4 verification and commit boundary:

- `test/README.md` says `npm test` is the canonical aggregate gate: the browser-free offline suite followed by the Viewer Clash Panel DOM suite; either half failing fails the gate.
- It states that `npm test` requires the installed Playwright Chromium and that a missing browser is a failure, not a skip.
- It states that `npm run test:offline` remains browser-free and notes that directly invoking it does not run `pretest`, so vendor sync is required on a fresh checkout.
- It states that the Panel DOM suite uses a fake Viewer, DockingPanel stub, fake engine and fake catalog; it requires no server, APS credentials or network and never loads a live APS Viewer.
- `test/acceptance/README.md` separates the fake-based Panel DOM suite, which is included in `npm test`, from the named live acceptance/performance scripts, which remain explicitly excluded. It also states that live Viewer/SVF2 acceptance is never part of the default gate.

The planned text does not blur headless-browser UI verification with live Viewer acceptance.

## Documentation and script guards

**Sufficient for this plan.** `test/clashpanel/domIsolation.test.mjs` is planned with seven tests. Its two documentation tests pin the required aggregate/offline/Chromium/fake/live distinctions. The acceptance-README guard additionally permits exactly one “included in npm test” statement and requires every “part of npm test” statement to be negated, preventing a live acceptance script from being silently described as part of the default gate.

The script guards remain sound: they assert the exact three npm scripts, exact unchanged `pretest`, an acyclic graph from `test`, both suite edges, and Node-only runner spawning. T27 Step 4 also requires the two README diffs to match the Step 3 hunks exactly and preserves the existing Viewer Adapter T3 “Not part of npm test” bullet. The manual hunk comparison closes the possibility that presence-only matches coexist with stale prose in `test/README.md`.

The recorded scratch checks are correctly limited to snippet consistency: edited scratch README copies passed the seven offline guards; unedited/stale/contradictory mutations failed. They are not implementation evidence and do not replace T27 execution.

## T33 change-set boundary

**Closed.** T33 permits the two test README changes because they belong to T27, while its `docs/` allowlist is restricted to `docs/handoffs/`, `docs/reviews/` and `docs/research/`. It separately requires:

```text
git diff --quiet "$BASE"..HEAD -- docs/superpowers/specs docs/superpowers/plans
```

Therefore implementation closeout cannot treat a governing design-spec or implementation-plan edit as an allowed documentation change. T33 also requires the README hunks to be reviewed against T27's exact planned diffs rather than accepting file/count presence alone.

## Owner decisions and G-OD

**G-OD is satisfied and contains no remaining implementation-blocking owner decision.** The plan consistently records:

- **OD-1(a), owner-approved:** the implementation location is top-level `clashpanel/`; the header, tier table, owner-decision row, G-OD paragraph, file structure and authorization boundary agree.
- **OD-7(a), owner-approved:** a new run replaces previous results using the reviewed admission-first behavior. The confirmed-discard/single-slot exception remains explicit: an unsaved prior result requiring confirmation is released before `startRun` only through the reviewed T9/T16 flow.
- **OD-10(a):** duplicate the marker helper. This remains a safe, reversible internal default; extracting shared code would require separate scope because it would touch the existing extension.
- **OD-13 Part 2(a):** “scene units” remains a one-constant, reversible presentation default.
- **OD-12:** simultaneous-use policy remains deferred to H1/G2/G3 host/live integration; the T24/T25 isolation ownership guard remains required independently.

No text reviewed in this bounded scope still labels OD-1 or OD-7 unresolved. G-OD closure does not authorize implementation; the plan consistently requires a separate explicit owner authorization.

## Extension and authorization assessment

No Viewer Adapter or Core extension is required by these changes. They add only plan-time documentation, tests/guards and owner-decision closure. The existing SVF2, OQ-1 and host-integration gates remain unchanged.

The implementation plan is **ready for owner implementation authorization**. Current authorization remains planning-only: T1–T33, a Panel branch, Panel code/tests, SVF2 verification, OQ-1, host integration and Viewer Adapter/Core/M4 changes must not begin without their applicable explicit owner authorization.
