# Targeted Independent Work Re-Review Prompt — CTM8-P0-v3

## Scope

Perform a **targeted Independent Work re-review only** of the corrected CTM8-P0-v3 protocol package in:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

This is review-only.

Do **not** modify production code.
Do **not** modify tests.
Do **not** modify the protocol, reports, spec, plan, or handoff except for the required new Work review artifact and concise handoff update.
Do **not** create calibration harnesses, fixture generators, observation seams, headed instrumentation, or support code.
Do **not** execute calibration.
Do **not** commit or push.

If any defect remains, record the finding, minimum correction, blocker status, and responsible upstream package. Work must not remediate it.

## Primary artifacts

Review:

- `docs/research/2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md`
- `docs/research/2026-10-11-ctm-8-p0-v2-correction-final-report.md`
- `docs/research/2026-10-11-ctm-8-p0-calibration-protocol-remediation-final-report.md`
- `docs/research/2026-10-11-ctm-8-p0-calibration-protocol-final-report.md`
- `docs/reviews/2026-10-11-ctm-8-p0-v2-targeted-independent-work-review.md`
- `docs/reviews/2026-10-11-ctm-8-p0-calibration-protocol-independent-work-review.md`
- `docs/handoffs/latest.md`

Also read:

- `CLAUDE.md`
- current CTM governing spec
- current CTM implementation plan
- `docs/reviews/2026-10-11-ctm-8-entry-gate-independent-work-review.md`

Treat Claude's completion report, upstream final reports, and handoff as claims/evidence, not proof.

## First: independently verify repository state

Claude reported:

- `main == origin/main == ac5bcb4`
- no calibration/tests run
- no harness/generator/seam/support code
- no commit/push
- `git diff --check` clean
- every changed path under `docs/`

Verify independently:

- repository path;
- branch;
- HEAD;
- full SHA;
- `origin/main`;
- ahead/behind;
- working tree;
- every modified/untracked path;
- all current changes are docs-only;
- CTM-7 remains closed;
- Addendum B checkpoint remains intact;
- no CTM-8 execution/support code exists;
- no calibration/evidence run exists.

Expected prior checkpoint to verify, not assume:

`ac5bcb42b00e668442ce3add9764cba96d883309`

If repo state materially differs, record that before protocol readiness.

## Claude's latest claims to verify

Claude reports the corrected protocol is now **CTM8-P0-v3** and that:

- H-01, H-02, and M-01 are fixed;
- an additional read-only agent found 1 Medium + 2 Low inconsistencies;
- Claude fixed those too;
- that agent was **not re-run after the final 1 Medium + 2 Low fixes**.

Therefore this Work review is the first authoritative verification of the final v3 state.

Do not assume the final fixes are correct because Claude says they are.

## Final owner decisions that must remain frozen

### Family M mandatory headless

Scenarios:
- M-BASE
- M-REC
- M-HIT

Scale:
- 100 / 1,000 / 5,000 / 10,000 test records
- 1 / 2 / 3 referenced models per test record

### Family R mandatory headless

Scenarios:
- R-BASE
- R-WARM
- R-GROUP-WARM
- R-COLD

Scale:
- 100 / 1,000 / 5,000 / 10,000 clash-result records
- 1 / 2 / 3 models
- **UNIFORM only**

`SKEWED` remains optional targeted refinement only.

### `-PULL`

All `-PULL` variants remain optional and outside the mandatory campaign.

### Launch / repetition policy

- 3 launches
- 30 measured repetitions for warm cells
- 15 measured repetitions for cold cells
- 5 warm-ups per warm cell

### Timeout / failure policy

- 30 seconds per sample
- safety bound only, not performance budget
- after 3 consecutive failures/timeouts in one cell:
  - stop that cell only
  - retain collected samples
  - mark failed/inconclusive
  - continue remaining campaign
- global harness/runtime failure may stop the run and must be recorded separately

### Headed Family M corroboration

- 5 / 25 / 100 test records
- 1 / 3 models

### Observability

- public sentinel-based cold/warm classification only
- no observation seam
- exact label-index commit sub-phase unavailable

## Targeted closure review

### 1. H-01 closure — Family R mandatory scope

Verify every normative section of the current protocol states:

- Family R mandatory = UNIFORM only;
- SKEWED = optional targeted refinement;
- SKEWED is outside:
  - mandatory counts
  - completeness denominator
  - execution requirement
  - headed mandatory scope
  - owner-open decisions;
- `-PULL` remains optional.

Search the full current protocol and status artifacts for stale SKEWED-mandatory wording.

Historical artifacts may retain old wording only if clearly labelled historical/superseded.

### 2. Mandatory campaign arithmetic

Recompute independently.

Expected:

#### Family M
`3 scenarios × 4 record points × 3 model points = 36 cells / launch`

#### Family R
`4 scenarios × 4 result points × 3 model points × 1 UNIFORM profile = 48 cells / launch`

#### Total
- **84 cells / launch**
- **252 cell executions / 3 launches**

Warm cells per launch:
- M = 36
- R warm = 36
- total = 72

Cold cells per launch:
- R-COLD = 12

Measured:
- warm = `72 × 30 × 3 = 6,480`
- cold = `12 × 15 × 3 = 540`
- total measured = **7,020**

Warm-ups:
- `72 × 5 × 3 = 1,080`

Total measured + warm-up operations:
- **8,100**

Verify these values are the only current mandatory totals.

Old totals:
- 132
- 396
- 10,800
- 1,620
- 12,420

may remain only in explicitly historical/superseded context.

Raise a finding if any current normative/status section still uses old totals.

### 3. H-02 closure — Family M fixture construction

Verify the protocol now defines an exact executable fixture contract.

Claude reports the real helper path is:

`test/clashpanel/core/testsManager.integration.test.mjs`

Verify the path exists.

Verify the protocol freezes an exact public-intent construction for Family M records, including:

- exact create sequence;
- deterministic activation;
- deterministic naming:
  `CTM8-M-<N>-<n>-<i>`
- Set A = `mA`
- Set B:
  - 1 referenced model: `[mA]`
  - 2 referenced models: `[mB]`
  - 3 referenced models: `[mB, mC]`
- exact public intents/payloads;
- confirmation/settling behavior;
- readiness predicates;
- per-cell disposal/reset.

Do not accept prose analogies such as “same as selectAB”; the full executable contract must be in the protocol.

### 4. Family M `n_models` semantics

Claude reports an important consequence:

- the harness catalog always contains `mA` and `mB`;
- for `n_models = 3`, catalog contains `mA`, `mB`, `mC`;
- therefore Family M `n_models` means **models referenced by each test record**, not total catalog size;
- catalog sizes are effectively 2, 2, and 3 for `n_models = 1, 2, 3`.

Independently verify:

- this matches the actual manager/editor model-selection semantics;
- the protocol states this meaning explicitly;
- no section still equates Family M `n_models` with catalog size;
- evidence schema and scenario IDs use the same meaning;
- this does not invalidate comparison across the 1/2/3 model dimension.

If this semantic choice changes what CTM-8 is actually measuring, raise an owner-decision finding rather than silently normalizing it.

### 5. Unique test-record names

Claude reports the earlier duplicate-name rule is removed and names are unique.

Verify:

- unique naming is normative;
- exact naming formula is deterministic;
- M-BASE / M-REC / M-HIT do not rely on duplicate names;
- unique names do not alter the intended rebuild workload unexpectedly;
- no stale duplicate-name requirement remains.

### 6. M-BASE / M-REC / M-HIT compatibility

Verify the final Family M fixture contract works with the already-defined transitions without redefining them.

Check:

- M-BASE exact reversible catalog mutation still applies;
- M-REC exact active-record + setup-name transition remains executable;
- forwarded editor work inclusion/exclusion remains explicit;
- M-HIT still measures the intended cache/invalidation behavior;
- no scenario requires a manager-only seam that does not exist.

If the fixture contract quietly changes the measured workload, raise a finding.

### 7. M-01 closure — owner decisions are no longer open

Verify the protocol's resolved-owner-decision section includes, as final:

- Family R UNIFORM-only mandatory;
- SKEWED optional;
- `-PULL` optional;
- 30-second safety timeout;
- cell-local 3-consecutive-failure rule;
- headed Family M 5/25/100 × 1/3;
- unreachable headed-point disposition;
- public-sentinel-only observability;
- no observation seam.

The only remaining owner decision should be:

**whether to authorize the CTM-8 execution/support-code package after this re-review passes.**

Raise a finding if methodology choices are still falsely listed as open.

### 8. Final 1 Medium + 2 Low fixes

Claude reports a read-only agent found 1 Medium and 2 Low inconsistencies after the v3 correction, and Claude fixed them without re-running that agent.

Identify those final fixes from:

- current protocol diff;
- correction final report;
- handoff;
- any durable review notes.

Independently verify each is actually resolved.

If the exact findings are not durably recorded, state that limitation and review the changed sections directly.

Do not invent missing finding text.

### 9. Historical artifact handling

Verify:

- original P0 final report is untouched;
- prior Work reviews are untouched;
- prior remediation report is not silently rewritten except for an allowed one-line superseded pointer if repo workflow permits;
- old totals only remain in clearly historical/superseded contexts;
- the new correction report accurately describes the current state.

### 10. Protocol precision for execution

Determine whether CTM8-P0-v3 is now precise enough that the next execution agent can build/run the campaign **without inventing methodology**.

Verify exactness of:

- scenario IDs;
- fixture construction;
- action/payload;
- timing start/stop;
- async completion;
- warm/cold preparation;
- selected-group comparator;
- repetitions/warmups;
- timeout/failure rules;
- statistical estimator;
- environment capture;
- evidence schema;
- headed reachability;
- interpretation safeguards.

### 11. Execution-support authorization boundary

Verify no execution/support code is currently authorized.

The next owner gate should cover, at minimum:

- headless calibration harness;
- deterministic fixture generator under a non-production support path;
- runtime-injected headed evidence instrumentation;
- execution of the mandatory campaign;
- evidence generation;
- execution final report.

No production observation hook should be required for the minimum campaign.

### 12. Protected boundaries

Verify v3 did not pull in:

- Addendum B L1/L2;
- CTM-7 L1–L8;
- O-1…O-4;
- hide-vs-departure;
- neighboring navScope;
- GP-F1 visual polish;
- Core/collision/Viewer Adapter/host changes;
- Viewer theming/selection;
- persistence/history;
- public performance/resource limits.

## Verdict

Use Critical / High / Medium / Low findings.

For every finding include:

- affected artifact/section;
- concrete defect;
- execution-validity impact;
- minimum correction;
- blocker status;
- responsible upstream package.

Use exactly one final verdict:

- **PASS — READY FOR OWNER CTM-8 EXECUTION DECISION**
- **OWNER DECISION REQUIRED**
- **FAIL — P0 REMEDIATION REQUIRED**

Do not PASS if execution still requires inventing methodology, campaign arithmetic is inconsistent, Family M semantics are ambiguous, or any final fix is unverified.

## Required authoritative Work artifact

Produce exactly one:

`docs/reviews/2026-10-12-ctm-8-p0-v3-targeted-independent-work-review.md`

Include:

- repo / branch / HEAD / origin / tree;
- governing CTM source;
- protocol version/path;
- correction final report;
- prior failed targeted review;
- owner decisions;
- H-01 closure;
- H-02 closure;
- M-01 closure;
- final Medium/Low-fix adjudication;
- Family M `n_models` semantics;
- unique-name adjudication;
- M-BASE/M-REC/M-HIT compatibility;
- mandatory campaign arithmetic;
- historical/superseded artifact handling;
- execution-support boundary;
- findings;
- blockers;
- unresolved owner decisions;
- deferred work;
- exact next authorized action;
- work that must not begin yet.

## Handoff

Update:

`docs/handoffs/latest.md`

Keep it concise and link the new authoritative review.

Record:

- repo / branch / HEAD / tree;
- CTM-7 closed;
- Addendum B checkpoint;
- CTM-8 P0-v3 status;
- protocol path;
- correction final report;
- latest targeted Independent Work Review;
- verdict/readiness;
- blockers;
- unresolved owner decisions;
- deferred work;
- exact next gate;
- execution/support code remains unauthorized unless owner approves after PASS.

Do not rewrite upstream final reports or prior reviews.

## Stop condition

After the targeted review and handoff update:

**STOP.**

Do not execute calibration.
Do not create harness/generator/instrumentation.
Do not modify protocol/spec/plan/production/tests.
Do not commit.
Do not push.

If PASS, the next gate is:

**owner decision whether to authorize the CTM-8 execution/support-code package**.
