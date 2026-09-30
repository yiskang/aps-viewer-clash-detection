# For Claude — G2 Procedure Remediation v4 Only

I explicitly authorize **one bounded documentation-only remediation** of the G2 ViewerBridge / DockingPanel live-verification procedure based on the latest independent Work v3 re-review.

This authorization is limited to:

- H1 — first-time attempts-directory durability
- H2a — R1/R2/R3 closeout-manifest circularity / future-fact dependency
- H2b — ambiguous `COMPLETED` verification losing the durable FAIL witness
- M1 — Table T2 global CA rule contradiction with C4/T15
- L1 — N6 out-of-range / non-finite boundary coverage

It does **not** authorize:

- G2 harness implementation
- live G2 execution
- G3
- H1/H2 host integration
- OQ-1
- production host composition
- Core / Viewer Adapter / M4 / Viewer Clash Panel production changes
- G1 F7 probe or calibration changes
- commit or push unless separately authorized

Use the latest independent Work review as the governing remediation input.

## 1. H1 — First-time attempts-directory durability

The first creation of the attempts directory must be crash-durable under the procedure's stated local-POSIX durability model.

Correct the create/write sequence so that, when the attempts directory does not yet exist:

1. create the directory;
2. synchronize the new directory entry as required by the chosen POSIX durability model;
3. `fsync` the parent directory containing the newly created attempts directory;
4. only then proceed to create/bind the authorization reservation.

Define exactly:

- which directory/file descriptors are opened;
- which `fsync` operations are required;
- ordering of `mkdir`, file create/write, rename/link if used, file `fsync`, directory `fsync`, and parent-directory `fsync`;
- behavior when the directory already exists;
- behavior if any durability step fails;
- crash semantics before and after each durability boundary.

Preserve the current claim scope:

- local POSIX filesystem durability only;
- no stronger power-loss guarantee than can be supported.

A crash must not be able to erase the only durable indication that an authorization was reserved/consumed in a way that silently permits reuse.

## 2. H2a — Remove R1/R2/R3 closeout circularity

The current R1 closeout manifest must not require:

- its own final hash; or
- facts that only exist in future R2/R3 steps.

Redesign the closeout sequence so every artifact can be produced and verified from facts already available at that step.

Use an acyclic dependency model.

A valid structure could be:

- `R1` — payload/evidence manifest containing hashes of already-written result artifacts only;
- `R2` — closeout-verification record containing the verified R1 hash and verification outcomes;
- `R3` — terminal journal transition referring only to already-existing R1/R2 identities/hashes.

The exact structure may differ, but it must satisfy:

- no artifact includes its own final digest;
- no record depends on a hash/fact that cannot exist until a later step;
- all required hashes are independently recomputable;
- the final terminal state depends only on artifacts that already exist and have been verified.

Document the dependency graph explicitly.

## 3. H2b — Preserve a durable FAIL witness when `COMPLETED` verification is ambiguous

A failed or ambiguous verification of the terminal `COMPLETED` state must not destroy or obscure the only durable evidence that closeout failed.

Define a fail-safe terminalization protocol.

Required properties:

- `COMPLETED` is never the only durable terminal witness until its verification succeeds;
- if `COMPLETED` write/rename/fsync/read-back verification is ambiguous, a durable failure/non-PASS witness remains;
- a reader can deterministically conclude FAIL from surviving artifacts;
- no recovery path may reinterpret an ambiguous closeout as PASS;
- no contradictory later terminal state may make authoritative state unclear.

Prefer a structure where:

1. a durable closeout-status record indicates closeout-in-progress / fail-safe state;
2. `COMPLETED` is written only after every required evidence/manifest verification succeeds;
3. terminal completion is verified;
4. if verification is ambiguous, the prior durable non-PASS witness remains authoritative.

Define reader precedence for:

- verified `COMPLETED`;
- explicit `FAILED`;
- ambiguous/missing terminal transition after consumed attempt;
- crash during closeout.

The reader must conservatively select the worse valid state.

## 4. M1 — Resolve Table T2 global CA rule vs C4/T15

Work found the global CA rule in Table T2 contradicts the specific C4/T15 behavior.

Inspect the governing C4/T15 definitions and correct Table T2 so there is one coherent calibration/allowance rule.

Requirements:

- no global rule may override a check-specific rule unless explicitly designed to do so;
- C4/T15 tolerance semantics remain exactly as independently reviewed;
- every table row states whether its threshold/allowance is:
  - contract-derived;
  - runtime/API-derived;
  - calibration assumption;
  - diagnostic-only;
- if a shared/global constant is used, define exactly which checks consume it;
- if C4/T15 are exceptions, state that mechanically.

Add a compact consistency table mapping each affected check to its actual allowance source.

Do not change thresholds merely to make a future live run pass.

## 5. L1 — Extend N6 boundary coverage

Keep the currently accepted N6 construction.

Add explicit procedure/property-test coverage for:

- maximum in-range finite coordinates around the supported cutoff;
- just-out-of-range finite values;
- `+Infinity`;
- `-Infinity`;
- `NaN`;
- degenerate/zero-width boxes at extreme supported coordinates.

For each case define the expected outcome:

- valid/in-range and testable;
- rejected as out-of-range;
- rejected as non-finite;
- never allowed to silently count as a successful negative control.

Invalid inputs must not accidentally produce PASS evidence for N6.

## 6. Preserve already-closed areas

Do not reopen unless this remediation directly exposes a contradiction:

- H3 / C20 overlay-rendering oracle is technically closed;
- C20 missing/ambiguous rendering => `NOT_EVIDENCED`;
- G2 is capped at `PARTIAL` until C20 positively passes;
- original N6 construction is technically closed apart from the new boundary tests;
- repetition/retake rules are closed;
- C7/C18 scene ownership is closed;
- C4 containment relation is closed;
- C17 V0–V7/N7 is closed;
- model-A/model-B cleanup is closed;
- C2 title lookup is closed;
- D3 and D5 are technical dispositions;
- D6 remains deferred/non-blocking.

## 7. D1–D7 status

Do not silently approve owner decisions during this remediation.

Preserve:

- **D1** — owner/operational: Mechanical + Structure
- **D2** — owner acceptance policy: wait until H1/H2 are re-reviewed
- **D3** — technical, confirmed
- **D4** — owner execution-risk decision: bounded real-Viewer failure injection
- **D5** — technical, confirmed
- **D6** — deferred/non-blocking
- **D7** — owner acceptance of C20 verdict role, PARTIAL fallback, and PASS-granting rendering constants/capture budget

## 8. Internal review

After editing:

1. Run one targeted internal review only over:
   - first-time attempts-directory durability;
   - R1/R2/R3 dependency graph;
   - ambiguous `COMPLETED` fail-safe witness;
   - Table T2 versus C4/T15;
   - N6 out-of-range/non-finite boundary cases;
   - directly affected journal/verdict/evidence sections.
2. Fix genuine Critical/High findings within this bounded scope.
3. Do not implement the G2 harness.
4. Persist the remediation internal review under `docs/reviews/`.
5. Update `docs/handoffs/latest.md`.

The handoff must state:

- G2 procedure remediation v4 complete;
- harness implementation remains unauthorized;
- live G2 remains unauthorized;
- G3/H1/H2/OQ-1/host remain unauthorized;
- next action = bounded independent Work re-review, then owner decisions D1/D2/D4/D7.

## Stop gate

Stop after the documentation remediation and targeted internal review.

Do not:

- write or implement `test/acceptance/clashpanel-viewerbridge.acceptance.mjs`;
- run G2;
- start G3/H1/H2/OQ-1/host integration;
- modify production code;
- commit or push unless separately authorized.

## Final report

Report:

- branch / HEAD / git status;
- exact sections changed;
- attempts-directory parent-`fsync` fix;
- R1/R2/R3 acyclic closeout structure;
- durable FAIL witness for ambiguous `COMPLETED`;
- Table T2/C4/T15 reconciliation;
- N6 boundary-case additions;
- internal review findings/fixes;
- remaining D1/D2/D4/D7 owner decisions;
- explicit confirmation that no harness code or live execution occurred.
