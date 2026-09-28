# For Claude — G1 Harness Bounded Completion Pass

I explicitly authorize one **bounded harness-completion pass** for the existing G1 SVF2 F1–F8 verification harness.

This authorization is limited to closing the three currently known harness-completeness gaps:

1. add the missing browser import map to the harness bare page;
2. make Phase 0 failures durably emit evidence;
3. wire the six remaining mandatory controls through the browser realm so a future authorized live run can actually reach a valid PASS/FAIL verdict.

This authorization still does **not** include live F1–F8 execution.

## Repository-first verification

Before changing anything:

1. Verify the repository currently in scope.
2. Read:
   - `CLAUDE.md`
   - `docs/handoffs/latest.md`
   - `docs/research/2026-09-27-g1-svf2-f1-f8-harness-build-plan.md`
   - the implemented harness on `feature/g1-svf2-f1-f8-harness`
   - the latest whole-branch implementation review and fix-wave/re-review artifacts
3. Verify:
   - branch is `feature/g1-svf2-f1-f8-harness`
   - expected current HEAD is `2526d76` or explain any authorized later commit
   - `main` remains the accepted baseline
   - live F1–F8 execution is still unauthorized
   - G2/G3/H1/H2/OQ-1/host integration remain unauthorized

If the actual repository state materially differs, stop and report before making changes.

Treat repository artifacts and actual implementation as authoritative.

## 1. Add the harness import map

The harness bare page currently lacks the import map required by the repo modules it dynamically imports.

Fix this by copying/reusing the existing import-map entries from the accepted production page pattern in `wwwroot/index.html`.

Use the existing entries only.

Do not:
- modify `wwwroot/index.html`;
- modify `wwwroot/viewer.js`;
- invent a new module-resolution scheme;
- broaden the import map beyond what the harness actually needs.

The harness page must remain diagnostic/test-only and isolated from production routes.

Add non-live verification proving:
- the import map is present before module loading;
- the required module specifiers resolve under the harness page;
- removing the import map causes the expected Phase 0 failure in a controlled test.

Do not perform a real live F1–F8 run.

## 2. Make Phase 0 failures durably emit evidence

Any Phase 0 failure must produce a durable machine-readable evidence artifact rather than failing before evidence creation.

This includes failures such as:
- import-map/module-resolution failure;
- required module import failure;
- harness assembly failure;
- required static resource failure;
- Viewer-script identity prerequisite failure;
- early classifier/setup prerequisite failure where the evidence writer itself is available.

The failure artifact must record at minimum:
- timestamp;
- branch/HEAD if available to the Node-side runner;
- harness version/source identity;
- phase = `PHASE_0`;
- exact failure category;
- bounded/redacted error details;
- Viewer asset identity state if already known;
- whether browser/page/context existed;
- whether cleanup ran;
- cleanup failures, if any;
- overall verdict according to the reviewed precedence.

Requirements:
- primary Phase 0 failure remains primary;
- cleanup failure must not erase the original failure;
- evidence-write failure must itself be surfaced clearly;
- partial evidence must never be labeled PASS;
- sensitive tokens/credentials must not be persisted.

Add offline/synthetic tests for:
- module import failure;
- asset identity failure;
- cleanup failure after a Phase 0 failure;
- evidence writer failure;
- redaction/bounded serialization.

## 3. Wire all six remaining mandatory controls through the browser realm

The following controls are mandatory and may not remain as live-parameter placeholders:

- wrong-owner;
- hidden-fragment;
- tree-unavailable;
- capacity-breach;
- invalid-bounds;
- bounds-beyond-tolerance.

Implement each control so its live-sensitive mutation/check runs in the correct browser/Viewer realm.

Do not pass live Viewer/Model/Document/FragmentList objects into Node.

Use serializable command/result payloads across the realm boundary.

For each control, define and implement:
- control command payload;
- browser-realm mutation or synthetic perturbation;
- detection oracle;
- restoration requirement or non-interference oracle;
- serialized result;
- timeout behavior;
- stale-token/generation behavior;
- cleanup responsibility;
- mapping to the reviewed `ControlResult` enum.

The implementation must preserve the reviewed rule:

**only `DETECTED_RESTORED` is PASS-compatible for a mandatory control.**

The following must prevent overall PASS:
- `NOT_DETECTED`
- `RESTORE_FAILED`
- `TIMED_OUT`
- `NOT_EXECUTABLE`

If a control is synthetic-only, prove non-interference rather than pretending shared Viewer state was restored.

### Wrong-owner
Exercise the actual ownership-validation path using browser-realm data. Do not fabricate a Node-only result that bypasses the Viewer/Adapter logic the control exists to test.

Verify:
- injected mismatch is detected;
- the real F1 retained record is not corrupted;
- restoration/non-interference completes.

### Hidden-fragment
Exercise the actual hidden-fragment sensitivity path required by the plan.

Implementation-time technical check:
- confirm the real Viewer 7.124.2 return shape/API involved, including `getAggregateHiddenNodes()` if used.

If the API shape differs from the reviewed plan:
- make the smallest harness-only correction;
- record the deviation;
- do not modify production Viewer/Adapter code.

### Tree-unavailable
Exercise the actual readiness/tree-unavailable behavior in browser realm.

Do not permanently damage the real session.

If the reviewed control is synthetic, keep it synthetic and prove it cannot mutate the retained real F3 evidence.

### Capacity-breach
Use the reviewed synthetic breach mechanism.

Do not change Core/public capacity limits.

The control must prove that the harness detects a breach while the real fixture's F5 result remains separately attributable.

### Invalid-bounds
Perturb only the test/control path required to prove invalid bounds are detected.

Do not corrupt the real F7 retained result.

Use the reviewed restoration/non-interference model.

### Bounds-beyond-tolerance
Perturb bounds by clearly more than the current envelope-limited calibration tolerance.

The control must:
- fail the bounds oracle when active;
- preserve the actual F7 result after restoration/non-interference;
- retain the applied perturbation magnitude and tolerance in serialized evidence.

## Realm-boundary requirements

Maintain strict realm separation.

### Node/Playwright realm
May own:
- browser;
- context;
- page;
- outer orchestration;
- file/evidence writing;
- serialized command/result transport;
- process-level timers.

### Browser/Viewer realm
May own:
- Viewer;
- Document/Model objects;
- fragment/object-tree access;
- Viewer event listeners;
- in-page control mutation;
- in-page operation tokens/generations;
- Viewer/model cleanup actions.

Never serialize or pass live Viewer objects across realms.

Add static/offline tests that fail if the harness attempts to return obvious live Viewer/model objects through `page.evaluate`.

## Preserve the reviewed verdict model

Do not change the reviewed precedence except where a mechanical implementation correction is required.

The final harness must preserve:

1. fatal runtime/page/console failure → FAIL
2. unresolved cleanup failure → FAIL
3. any Fi failure → FAIL
4. any mandatory-control non-PASS-compatible state → FAIL
5. Viewer executable identity mismatch/contradiction → FAIL
6. Viewer executable identity unavailable/ambiguous, with no earlier failure → BLOCKED
7. other non-failing missing evidence → PARTIAL
8. PASS only when every required condition is satisfied

No new shortcut to PASS is authorized.

## Tests allowed in this pass

You may run only non-live/offline/synthetic verification needed to prove the harness implementation itself.

Allowed:
- syntax checks;
- Node/offline unit tests;
- fake/stub tests;
- Playwright against local synthetic/bare pages that do not perform real APS model F1–F8 execution;
- realm-boundary tests;
- import-map resolution tests;
- evidence-writing failure tests;
- control command/result serialization tests;
- timeout/token tests;
- cleanup tests;
- verdict tests.

Not allowed:
- real SVF2 F1–F8 execution against the APS model;
- G2 live ViewerBridge/DockingPanel verification;
- G3 Panel live acceptance.

If a test would load the real accepted SVF2 fixture and begin collecting actual F1–F8 evidence, stop: that requires the later live-execution authorization.

## Review requirements

After implementing the three bounded areas:

1. Run the allowed offline/synthetic tests.
2. Run a focused internal implementation review covering only:
   - import-map completeness;
   - Phase 0 durable evidence;
   - six mandatory browser-realm controls;
   - realm boundaries;
   - cleanup/verdict integration.
3. Fix genuine Critical/High issues within this authorized scope.
4. Do not begin another broad feature cycle.
5. Persist the substantial review/status artifact under `docs/reviews/`.
6. Update `docs/handoffs/latest.md`.

## Stop gate

Stop when the harness is **implementation-complete and reviewable**, but before any real F1–F8 execution.

Do not:
- run live F1–F8;
- start G2;
- start G3;
- start H1;
- start H2;
- start OQ-1;
- start host integration;
- modify production Viewer initialization;
- modify Viewer Adapter;
- modify Core;
- modify M4;
- modify Viewer Clash Panel production behavior;
- upload/retranslate models;
- modify Agent Kit skills/routing;
- push unless separately authorized.

The next gate is:

**independent ChatGPT Work review of the completed harness implementation → owner decision on live F1–F8 execution**

## Final report

Report:
- branch;
- starting HEAD;
- ending HEAD;
- commits created;
- exact files changed;
- import-map fix;
- Phase 0 evidence behavior;
- implementation status of each of the six mandatory controls;
- offline/synthetic test totals;
- internal review findings/fixes;
- any mechanical deviations from the reviewed plan;
- final git status;
- whether anything was pushed.

Explicitly confirm:
- live F1–F8 was not run;
- production initializer was not changed;
- no model was uploaded/retranslated;
- G2/G3/H1/H2 were not started;
- no OQ-1/host integration work was started;
- no Viewer Adapter/Core/M4/Panel production change was made.

Stop after the bounded harness-completion pass.
