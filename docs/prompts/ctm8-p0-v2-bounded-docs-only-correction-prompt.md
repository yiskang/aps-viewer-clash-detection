# Claude/Codex Prompt — CTM8-P0-v2 Bounded Docs-Only Correction

## Owner authorization

The owner authorizes a **bounded docs-only correction** of CTM8-P0-v2 in:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

This authorization is limited to correcting the three remaining findings from:

`docs/reviews/2026-10-11-ctm-8-p0-v2-targeted-independent-work-review.md`

Findings to close:

- High H-01 — mandatory Family R scope still contradicts the final owner decision
- High H-02 — Family M deterministic fixture construction is not yet an exact executable algorithm
- Medium M-01 — final safety/headed decisions are still falsely presented as owner-open

Do not broaden scope.

## Hard boundaries

Do **not**:

- execute calibration;
- create headless calibration harnesses;
- create deterministic fixture-generator code;
- create headed instrumentation;
- create observation seams;
- modify production code;
- modify tests;
- modify CTM governing spec/plan;
- modify CTM-7 or Addendum B implementation;
- remediate unrelated deferred findings;
- commit;
- push;
- begin another CTM-8 package.

This is documentation-only remediation.

## Before editing

Independently verify:

- repository path;
- branch;
- HEAD;
- `origin/main`;
- ahead/behind;
- working tree;
- modified/untracked paths;
- CTM-7 remains closed;
- Addendum B remains checkpointed;
- CTM-8 execution/support code has not begun.

Expected checkpoint to verify, not assume:

`ac5bcb42b00e668442ce3add9764cba96d883309`

Read:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- `docs/research/2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md`
- `docs/research/2026-10-11-ctm-8-p0-calibration-protocol-remediation-final-report.md`
- `docs/reviews/2026-10-11-ctm-8-p0-v2-targeted-independent-work-review.md`
- relevant Family M source/test-support paths cited by the review

If repository state materially differs from the reviewed state, stop and report before editing.

## Final owner decisions to preserve

These are closed decisions. Do not reopen them.

### Family R mandatory profile

Mandatory Family R is **UNIFORM only**.

`SKEWED` is optional targeted refinement only.

It must not appear in:

- mandatory campaign counts;
- required execution;
- acceptance/completeness denominator;
- headed mandatory scope;
- open owner decisions.

### `-PULL`

All `-PULL` variants remain optional and outside the mandatory campaign.

### Launch / repetition policy

- 3 independent launches
- 30 measured repetitions for warm cells
- 15 measured repetitions for cold cells
- 5 warm-up repetitions for warm cells, if this is the current protocol rule

### Timeout / failure policy

- per-sample timeout = 30 seconds
- timeout is an execution safety bound only
- timeout is not a performance budget or pass/fail threshold
- after 3 consecutive failures/timeouts in one cell:
  - stop remaining repetitions for that cell only;
  - retain collected samples;
  - mark the cell failed/inconclusive as appropriate;
  - continue the rest of the campaign
- a true global harness/runtime failure may stop the overall run and must be recorded distinctly

### Headed Family M

Headed corroboration points are final:

Test records:
- 5
- 25
- 100

Models:
- 1
- 3

These are headed corroboration points only.

### Observability

- use public sentinel-based cold/warm classification only
- no observation seam
- exact label-index commit sub-phase unavailable
- no production hook

## H-01 correction — mandatory Family R scope and arithmetic

Update the protocol so the mandatory campaign is exactly:

### Family M

3 mandatory scenarios:

- M-BASE
- M-REC
- M-HIT

Scale matrix:

- 4 test-record points
- 3 model points

Therefore:

`3 × 4 × 3 = 36 cells per launch`

### Family R

4 mandatory scenarios:

- R-BASE
- R-WARM
- R-GROUP-WARM
- R-COLD

Scale matrix:

- 4 clash-result points
- 3 model points
- **UNIFORM only**

Therefore:

`4 × 4 × 3 × 1 = 48 cells per launch`

### Mandatory total

Per launch:

- Family M = 36 cells
- Family R = 48 cells
- Total = **84 cells**

Across 3 launches:

- **252 cell executions**

### Measured sample arithmetic

Warm cells per launch:

- Family M warm cells = 36
- Family R warm cells = 36
- total warm cells = 72

Cold cells per launch:

- Family R R-COLD = 12

Measured warm samples per launch:

`72 × 30 = 2,160`

Across 3 launches:

`6,480`

Measured cold samples per launch:

`12 × 15 = 180`

Across 3 launches:

`540`

Total measured samples:

`6,480 + 540 = 7,020`

Warm-ups per launch, using 5 warm-ups per warm cell:

`72 × 5 = 360`

Across 3 launches:

`1,080`

Total measured + warm-up operations:

`7,020 + 1,080 = 8,100`

Replace all stale mandatory totals from the old SKEWED-inclusive campaign, including:

- 132 cells per launch
- 396 cell executions
- 10,800 measured samples
- 1,620 warm-ups
- 12,420 total operations

Search the full protocol, remediation report, and handoff for those stale values.

### SKEWED wording

Retain `SKEWED` only as:

- optional targeted refinement;
- separately authorized follow-up;
- excluded from current mandatory completeness criteria.

Do not delete useful SKEWED fixture definitions if they remain valid as optional future methodology.

## H-02 correction — exact Family M fixture-construction algorithm

The protocol must define Family M fixture creation precisely enough that the later harness author does not invent methodology.

Correct the cited source path.

The targeted review identified the real helper at:

`test/clashpanel/core/testsManager.integration.test.mjs`

Verify the exact current path and line/function names from disk before writing them into the protocol.

Do not cite a non-existent path.

### Required deterministic Family M fixture contract

For every Family M scale cell, define the exact ordered public setup sequence.

The protocol must specify, at minimum:

1. catalog/model setup;
2. creation of exactly `N_tests` manager records;
3. deterministic activation/order of records;
4. deterministic A/B model selections for:
   - `n_models = 1`
   - `n_models = 2`
   - `n_models = 3`
5. exact naming convention;
6. exact public intents and payloads;
7. any required confirmation/apply/settle action;
8. final fixture predicates proving the cell is ready;
9. reset/disposal behavior between cells/launches.

### Model assignment

The protocol must not say merely “use selectAB” or “same public intents as helper.”

Spell out the contract.

Use the actual available catalog model keys in a deterministic order, for example:

- `m0`, `m1`, `m2` as logical aliases to the first three deterministic catalog model keys

Then explicitly define A/B rules for each model dimension.

A valid pattern, if supported by the actual API, would be conceptually:

#### 1 model
- A = `m0`
- B = `m0`

#### 2 models
- A = `m0`
- B = `m1`

#### 3 models
- A = `m0`
- B = deterministic ordered set representing the remaining allowed model selection required by the manager contract, or another exact rule supported by the real public API

Do **not** copy this conceptual example blindly.

Inspect the real manager/editor selection contract and write the exact executable public-intent sequence that the current code supports.

If B cannot represent multiple models directly, define the correct existing public sequence/state that yields the intended 3-model workload.

The important requirement is:

**the protocol must freeze one exact supported fixture construction for each `n_models` value.**

### Record creation

Define exactly how each record is created and settled.

Specify:

- create intent;
- active record;
- setup/name intent;
- A/B selection intents/payloads;
- confirmation/update behavior;
- deterministic name such as `CTM8-M-{N_tests}-{n_models}-{recordIndex}`;
- readiness predicate before the campaign begins.

### Distribution across records

If every manager record uses the same model assignment, state that explicitly.

If assignments rotate across records, define the exact formula.

Do not leave this to harness design.

### M-BASE / M-REC / M-HIT compatibility

Confirm the frozen fixture construction works with the already-remediated exact transitions for:

- M-BASE
- M-REC
- M-HIT

Do not redefine those transitions unless the targeted review proves the current transition is impossible under the exact fixture contract.

If a contradiction is found, stop and report rather than widening remediation silently.

## M-01 correction — remove already-resolved owner decisions from open items

Update:

- protocol;
- remediation status/correction artifact;
- handoff.

Move these from open/pending owner decisions to **resolved owner decisions**:

- UNIFORM-only mandatory Family R
- SKEWED optional only
- 30-second safety timeout
- cell-local 3-consecutive-failure rule
- headed Family M `5/25/100 × 1/3`
- unreachable headed-point disposition
- public-sentinel-only observability
- no observation seam

After this correction, the only next owner decision should be:

**whether to authorize the CTM-8 execution/support-code package after a clean targeted Independent Work re-review.**

Do not leave methodology choices falsely open.

## Documentation-history discipline

Preserve historical artifacts.

Do not rewrite the original P0 final report.

Do not rewrite prior Independent Work Reviews.

For the existing remediation final report:

- preserve it if repo workflow treats it as read-only after package completion;
- create a new correction/addendum artifact if needed.

Preferred new artifact:

`docs/research/2026-10-11-ctm-8-p0-v2-correction-final-report.md`

This correction report should record:

- governing targeted review;
- H-01 correction;
- H-02 correction;
- M-01 correction;
- exact final campaign arithmetic;
- exact Family M fixture contract;
- closed owner decisions;
- remaining execution authorization boundary;
- no calibration performed;
- no harness/support code created;
- no production/test changes.

## Protocol version

Increment the protocol revision from the current CTM8-P0-v2 to a new corrected revision, for example:

`CTM8-P0-v3`

Use the repository's actual version convention if different.

The version bump must clearly identify that this is the post-targeted-review corrected protocol.

## Required outputs

### 1. Corrected protocol

Update:

`docs/research/2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md`

### 2. Correction final report

Create:

`docs/research/2026-10-11-ctm-8-p0-v2-correction-final-report.md`

or the nearest repository-conformant filename.

### 3. Handoff

Update:

`docs/handoffs/latest.md`

Keep it concise.

Record:

- repo / branch / HEAD / tree;
- CTM-7 closed;
- Addendum B checkpoint;
- CTM-8 P0 corrected protocol version;
- original P0 report;
- remediation report;
- latest targeted failed review;
- correction final report;
- H-01/H-02/M-01 status;
- exact final mandatory campaign counts;
- execution/support code still unauthorized;
- exact next gate: targeted Independent Work re-review of the corrected P0 protocol.

## Verification before stopping

Perform documentation-only verification.

At minimum:

- re-read the full corrected protocol;
- verify Family R mandatory says UNIFORM only everywhere;
- verify `SKEWED` is optional everywhere;
- verify no mandatory `-PULL`;
- verify no stale 132/396/10,800/1,620/12,420 totals;
- verify exact new totals:
  - 84 cells / launch
  - 252 cells / 3 launches
  - 7,020 measured
  - 1,080 warm-ups
  - 8,100 total operations
- verify Family M fixture source path exists;
- verify every `n_models=1/2/3` fixture sequence is explicit;
- verify no resolved owner decision remains under an “open” section;
- verify `git diff --check`;
- verify changed paths are docs-only.

Do not run calibration or test suites.

## Stop condition

After the bounded correction is complete:

**STOP.**

Do not create harness code.
Do not create fixture-generator code.
Do not execute calibration.
Do not generate calibration evidence.
Do not create observation seams.
Do not modify production/tests/spec/plan.
Do not commit.
Do not push.

The next gate is:

**targeted Independent Work re-review of the corrected CTM8-P0 protocol**.
