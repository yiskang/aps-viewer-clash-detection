# For Claude — G1 Verified PARTIAL Closeout Only

I explicitly accept and authorize **G1 closeout as verified `PARTIAL`** for the current Mechanical SVF2 evidence envelope.

This authorization is limited to closeout/documentation only.

It does **not** authorize:
- any new live G1 execution;
- any F7 probe;
- any F7 tolerance/envelope change;
- any harness modification;
- G2;
- G3;
- H1;
- H2;
- OQ-1;
- host integration;
- Viewer Adapter/Core/M4/Panel production changes;
- any next milestone.

## Governing result

Record the accepted G1 closeout state exactly as independently verified:

- overall G1 verdict: `PARTIAL`
- F1: PASS
- F2: PASS
- F3: PASS
- F4: PASS
- F5: PASS
- F6: PASS
- F7: `NOT_EVIDENCED`
- F8: PASS
- all 9 mandatory controls: `DETECTED_RESTORED`
- cleanup: complete
- error ledger: clean

Do not reinterpret `PARTIAL` as PASS.

## F7 disposition

Record the accepted CAL-B disposition:

- no defensible, generalizable calibration rule can be derived from current evidence without overfitting;
- the 26 `exceeds-envelope` cases are calibration-policy evidence, not proven technical defects;
- the 358 `no-reference-geometry` roots remain justified explicit exclusions;
- the existing F7 contract denominator remains 899 scored roots plus 358 explicit exclusions;
- no additional owner decision is required to preserve that denominator.

Preserve the independently verified calibration findings:

- agreements stop below `0.08 × T_pass`;
- the 26 exceedances range from approximately `9.214×–5600.22× T_pass` per component;
- minimum deviation is approximately `252.09` float32 ULP;
- containment holds for all 26;
- `passFactor=1024` admits only one case;
- tested ULP-based rules admit none;
- approximately 15% extent-relative allowance would clear all 26 but is rejected as overfit / insufficiently generalizable.

Do not change the tolerance/envelope.

## Probe disposition

Do not implement or run the proposed F7 probe.

Record it only as an optional future research item if later G2/G3 work proves that resolving F7 is necessary.

The probe remains separately unauthorized and would require:

1. bounded probe definition/implementation;
2. independent review;
3. separate owner authorization for any live execution.

## Closeout artifacts

Finalize and commit the durable G1 closeout documentation/evidence set, including as applicable:

- `docs/research/2026-09-29-g1-f7-calibration-study.md`
- derived F7 calibration evidence under `docs/research/evidence/`
- `docs/reviews/2026-09-30-g1-f7-calibration-study-independent-review.md`
- the existing internal F7 calibration review
- `docs/handoffs/latest.md`
- directly related governance/prompt artifact if repository convention tracks it

Before committing:

- verify no harness or production code is staged;
- verify no tolerance/envelope change is staged;
- verify no live evidence was modified;
- verify no probe code exists;
- verify no G2/G3/H1/H2/OQ-1/host work is included.

## Handoff

Update `docs/handoffs/latest.md` to stable closeout wording:

- G1 is closed as verified `PARTIAL`;
- Mechanical is the accepted evidence fixture for this G1 closeout;
- F1–F6 and F8 passed;
- F7 remains `NOT_EVIDENCED` under accepted CAL-B disposition;
- no harness fix is pending;
- no F7 calibration rule is accepted;
- F7 probe is optional future research only;
- G2/G3/H1/H2/OQ-1/host remain unauthorized;
- next authorized action: none / awaiting owner decision on any downstream work.

Avoid transient wording such as:
- ahead/behind counts;
- “not pushed yet”;
- self-referential commit hashes where they would immediately become stale.

## Verification before commit

Verify:

- current branch / HEAD;
- working-tree state;
- the independent review actually recommends verified-PARTIAL closeout;
- CAL-B is accepted;
- no blocking Critical/High/Medium finding remains for G1 closeout.

Do not rerun live G1.

## Commit / push

Create the documentation/research closeout commit needed to persist this state.

Do not push unless separately authorized.

After committing:

- require clean `git status`;
- report commit hash;
- report exact files committed;
- report final branch / HEAD;
- report relation to `origin/main`;
- explicitly confirm no probe/live/downstream work was started.

## Stop gate

Stop after the G1 verified-PARTIAL closeout commit.

Do not:
- start F7 probe work;
- rerun G1;
- start G2/G3;
- start H1/H2;
- start OQ-1/host integration;
- modify Viewer Adapter/Core/M4/Panel production code;
- begin any next milestone.

## Final report

Report:

- branch / HEAD before and after;
- closeout commit hash;
- files committed;
- final git status;
- G1 final disposition;
- F7 final disposition;
- optional future probe status;
- whether anything was pushed;
- explicit confirmation that no downstream gate was started.
