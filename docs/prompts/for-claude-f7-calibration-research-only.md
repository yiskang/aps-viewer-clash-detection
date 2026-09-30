# For Claude — Authorize Bounded Independent F7 Calibration Research Only

I explicitly authorize **bounded F7 calibration research only** for the current G1 Mechanical evidence set.

This authorization does **not** include:
- rerunning live G1;
- changing the F7 tolerance/envelope;
- modifying the harness;
- changing G1 PASS/PARTIAL semantics;
- changing Viewer version;
- switching fixtures;
- uploading/retranslating models;
- modifying production/Core/Adapter/M4/Panel code;
- starting G2/G3/H1/H2/OQ-1/host integration;
- starting any next milestone.

## Repository baseline

Before starting:

1. Verify the repository currently in scope.
2. Read:
   - `CLAUDE.md`
   - `docs/handoffs/latest.md`
   - the committed Mechanical live G1 report and authoritative JSON
   - the independent verification of that run
   - the accepted F7 section in the G1 harness build plan / relevant design artifacts
3. Verify:
   - branch: `main`
   - local `main` = `origin/main`
   - expected baseline HEAD: `596dab3`
   - working tree is clean
   - current verified G1 result is `PARTIAL`
   - F1–F6 and F8 are accepted
   - F7 is the only non-PASS item
   - live rerun remains unauthorized

If repository state materially differs, stop and report before doing research.

Treat repository evidence as authoritative.

## Research goal

Determine whether the current retained Mechanical F7 evidence supports a **defensible, generalizable calibration rule**, or whether the evidence is insufficient and G1 should remain closed as verified `PARTIAL`.

Do not tune the rule simply to make the current 26 `exceeds-envelope` cases pass.

The research must explicitly guard against overfitting to this one fixture/run.

## Current verified F7 evidence

Use the committed Mechanical run as the research basis:

- 873 agreements
- 26 `exceeds-envelope`
- 358 `no-reference-geometry`
- overall F7 state: `NOT_EVIDENCED`
- Work has already verified that:
  - the F7 oracle itself functions correctly;
  - the 26 exceedances are calibration-policy evidence, not proven technical defects;
  - the 358 no-reference-geometry cases are explicit exclusions tied to no-active-triangle fragments.

Do not reinterpret these facts without evidence.

## Required analysis

### 1. Characterize the 26 exceedances

For each retained exceedance, extract/derive whatever the authoritative evidence actually supports, including where available:

- root/dbId/geometry identity;
- absolute deviation;
- relative deviation;
- coordinate magnitude / model scale;
- axis/component involved;
- source/reference bounds;
- computed bounds;
- current envelope/tolerance;
- exceedance factor relative to tolerance;
- whether the case is near numerical precision boundaries;
- whether transforms/placements contribute;
- whether the case clusters with specific geometry/root patterns.

Do not invent fields not present in retained evidence.

If required fields are absent, state that limitation explicitly.

### 2. Compare exceedances vs agreements

Use the 873 agreements as the comparison population.

Analyze whether the 26 exceedances differ systematically by:

- coordinate magnitude;
- object size;
- geometry size;
- transform characteristics;
- axis;
- absolute vs relative error;
- root/category pattern;
- any other retained numeric characteristic.

The goal is to distinguish:
- plausible numeric-representation effects;
- scale-dependent effects;
- structural/path-specific behavior;
- outliers;
- or unexplained deviations.

### 3. Numeric-path review

Review the actual F7 numeric path from source, including:

- Viewer 7.124.2 APIs used;
- representation type(s) at each step;
- Float32 / Float64 transitions;
- transforms applied;
- model/world coordinate space;
- any bounding-box aggregation;
- any known precision loss introduced by Viewer APIs.

Use repository/direct-source evidence.

Do not replace missing source evidence with generic floating-point assumptions.

### 4. Candidate calibration rules

If the evidence supports it, propose one or more candidate rules such as:

- absolute tolerance;
- relative tolerance;
- scale-aware mixed absolute/relative tolerance;
- ULP/representation-derived tolerance;
- transform-aware bound.

For each candidate:
- derive it from the observed numeric path;
- explain why it should generalize;
- evaluate it against both agreements and exceedances;
- show how many cases would pass/fail;
- identify risk of admitting materially incorrect bounds;
- identify risk of overfitting this fixture.

Do not select a rule just because it makes all 26 cases pass.

### 5. No-reference-geometry exclusions

Analyze whether the 358 `no-reference-geometry` exclusions should remain excluded.

Do not change their treatment unless the retained evidence/source proves the current exclusion rule is technically wrong.

At minimum report:
- why they lack reference geometry;
- whether they belong to a separate calibration population;
- whether they affect the denominator for a future F7 PASS claim.

### 6. Generalizability test

A candidate calibration rule is only defensible if it has a rationale beyond the current Mechanical fixture.

Assess whether the rule can reasonably apply to:

- other SVF2 models;
- different coordinate magnitudes/scales;
- different geometry distributions;
- the accepted Viewer 7.124.2 runtime envelope.

If this cannot be established from existing evidence, say so.

Do not run new live models unless separately authorized.

## Allowed methods

This authorization permits:

- read-only repository/source inspection;
- offline analysis of committed JSON/evidence;
- offline scripts/notebooks for statistics or plotting;
- comparing retained F7 evidence against current source implementation;
- targeted codebase-memory / Agent Kit knowledge lookup where relevant;
- web/docs research only if needed to verify a Viewer/API numeric contract, clearly separated from repo-derived evidence.

This authorization does **not** permit:

- live Viewer execution;
- live G1 rerun;
- changing harness code;
- changing F7 tolerance;
- changing runtime/model;
- changing production code.

## Required outcome classification

End with exactly one research disposition:

### CAL-A — Defensible calibration rule identified
A technically grounded, non-overfit rule can be proposed from current evidence/source.

State:
- exact candidate rule;
- derivation;
- limitations;
- why it is generalizable enough for independent review.

Do not apply the rule to the harness yet.

### CAL-B — Evidence insufficient
Current evidence is not enough to establish a defensible calibration rule without overfitting.

State:
- exactly what evidence is missing;
- whether G1 should remain `PARTIAL`;
- the smallest future research action that would reduce uncertainty.

### CAL-C — Current F7 oracle/calibration framing is technically wrong
Only use this if source/evidence proves the calibration model itself is invalid.

State the contradiction precisely.

Do not fix it in this task.

## Evidence artifact

Persist the research under:

`docs/research/`

Suggested filename:

`docs/research/2026-09-29-g1-f7-calibration-study.md`

If useful, add machine-readable derived analysis under:

`docs/research/evidence/`

Persist a substantial internal review under:

`docs/reviews/`

Update:

`docs/handoffs/latest.md`

to record:
- F7 calibration research status;
- CAL-A / CAL-B / CAL-C disposition;
- no harness/runtime change made;
- live G1 remains unauthorized;
- G2/G3/H1/H2/OQ-1/host remain unauthorized;
- next action: independent Work review / owner decision.

## Internal review

After the research draft:

1. run one targeted internal review over:
   - evidence extraction;
   - numeric-path reasoning;
   - candidate-rule derivation;
   - overfitting/generalizability claims;
   - final CAL disposition.
2. Fix genuine Critical/High reasoning/evidence issues.
3. Do not change harness code or calibration thresholds.

## Stop gate

Stop after research, internal review, and handoff update.

Do not:
- apply a new calibration rule;
- rerun live G1;
- change F7 implementation;
- start downstream gates;
- commit or push unless separately authorized.

The next gate is:

**independent ChatGPT Work review of the F7 calibration research → owner decision**

## Final report

Report:

- branch / HEAD / git status;
- research artifact path;
- evidence analyzed;
- key statistics/distributions;
- numeric-path conclusions;
- candidate calibration rules, if any;
- treatment of 358 no-reference-geometry exclusions;
- CAL-A / CAL-B / CAL-C disposition;
- internal review findings/fixes;
- exact remaining uncertainty;
- explicit confirmation that no live rerun or calibration/harness code change occurred.
