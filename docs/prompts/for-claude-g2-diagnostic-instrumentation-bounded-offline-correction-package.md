# For Claude — G2 Diagnostic Instrumentation Bounded Offline Correction Package

I explicitly authorize one **bounded offline correction package** for the current uncommitted G2 diagnostic-instrumentation research package.

The latest independent Work review found:

- Critical: 0
- High: 1
- Medium: 2
- Low: 2
- checkpoint readiness: bounded correction required
- live diagnostics remain unauthorized

This package may autonomously correct all in-scope Critical/High/Medium findings, update tests/results/docs/reviews/handoff, and stop only when the package is ready for another independent Work review.

Do not stop for owner approval between internal remediation steps unless a protected owner-only boundary is reached.

---

## 1. Verify authoritative baseline

Before editing, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD:
  `06980ee1e17b1268d4028ed9951c5f8462016cd2`
- `main == origin/main`
- committed harness SHA unchanged:
  `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`
- accepted procedure SHA unchanged:
  `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- immutable evidence unchanged
- D2 checkpoint unchanged
- historical G2 remains:
  `FAIL (row 3)`
- C6 remains:
  `NOT_EVIDENCED`
- C8 remains unresolved
- no Viewer/browser/live run
- no retry
- no new authorization record
- no attempt reset
- nothing committed or pushed

Current diagnostic baseline:

- diagnostic tests: `44/44`
- D2 tests: `55/55`
- offline suite:
  `5,155 total / 5,154 pass / 0 fail / 1 todo`
- retained diagnostic digest:
  `d64d1535d91453f9124583d9e734cbd7a75fbaf1c1f1b4407a100bb2ea7332fe`
- public+harness synthetic schedule separation:
  `40,788 / 40,788`
- sound definite owner labels:
  `0`
- sound definite subject labels:
  `0`
- sound definite attribution labels:
  `0`
- residual ambiguity:
  `5,063`, all DH-1 `ACTIVE0` pre-motion cases
- VB-1/VB-3 source bundle SHA-256:
  `12b9fe49…02e`

Read:

- latest independent Work review;
- diagnostic research doc;
- diagnostic spec;
- prototype/tests/results;
- internal review;
- latest handoff;
- Viewer 7.124.2 source references;
- D0/D1/D2 committed artifacts as read-only context.

If baseline differs materially, stop and report.

---

# High — VB-0 version gate must fail closed

## 2. Correct VB-0 gating

Work found:

> VB-0 can enable version-bound observables when `META.vv` is not Viewer 7.124.2.

This is a High finding.

Correct all version-bound enablement logic so version-bound observables are usable **only** when the runtime/version metadata exactly satisfies the accepted Viewer 7.124.2 pinning contract.

Required behavior:

- `META.vv` must exactly identify Viewer `7.124.2` according to the spec's canonical format;
- the Viewer bundle/source digest must match the pinned expected digest where required;
- missing version → fail closed;
- malformed version → fail closed;
- wrong version → fail closed;
- unsupported version → fail closed;
- version match but source/bundle digest mismatch → fail closed;
- no version-bound observable may become active via truthy/default/fallback behavior;
- no coercion may turn unknown metadata into accepted metadata.

If the current schema permits multiple canonical encodings, define one accepted normalization path and test it explicitly.

Do not broaden version support.

---

## 3. Add VB-0 regression coverage

Add focused tests for at least:

- exact Viewer 7.124.2 → version-bound observables may be eligible;
- 7.124.1 → rejected;
- 7.125.x → rejected;
- missing `META.vv` → rejected;
- malformed `META.vv` → rejected;
- unexpected type → rejected;
- correct version + wrong bundle digest → rejected;
- wrong version + correct digest → rejected;
- no fallback to public+VB mode after rejection.

The correlator must remain fail-closed.

---

# Medium — recompute the true minimum instrumentation bundle

## 4. Re-run exhaustive ablation

Work found:

> the proposed minimum bundle is not minimal; exhaustive ablation shows `P-XS` is redundant.

Correct the research/spec/results so the claimed **minimum sufficient instrumentation set** is actually minimal under the declared synthetic diagnostic objective.

Do not simply remove `P-XS` from prose.

Perform exhaustive subset/ablation analysis over the candidate observable set.

For each subset, compute:

- sound definite owner coverage;
- sound definite subject coverage;
- sound definite attribution coverage;
- wrong-label count;
- unresolved schedules/questions;
- which of the 13 diagnostic questions are answered.

A candidate minimum must satisfy:

1. the target soundness criteria;
2. the declared coverage target;
3. removing any remaining element degrades that target.

If multiple co-minimal bundles exist:

- report all co-minimal bundles;
- distinguish canonical recommendation from equivalently minimal alternatives;
- do not claim uniqueness unless proven.

If `P-XS` is redundant, remove it from the minimum set and explain what it remains useful for, if anything.

---

## 5. Re-evaluate “3 of 13”

After recomputing the minimum bundle, recompute:

- how many of the 13 diagnostic questions are actually answered;
- which exact questions;
- which remain unresolved;
- whether `3 of 13` still holds.

Do not preserve the old number if ablation changes it.

Update:

- research;
- spec;
- prototype summary;
- README;
- retained results;
- handoff.

---

# Medium — future live cross-record integrity

## 6. Strengthen META / data / END integrity design

Work found:

> future live `META` / data / `END` cross-record integrity is insufficiently specified and validated.

This package remains offline-only, but the design for a future live diagnostic trace must define mechanically checkable record-set integrity.

Specify and prototype validation for a trace container with:

### META record
At minimum:
- schema version;
- Viewer version;
- Viewer bundle/source digest;
- harness/build digest;
- diagnostic spec/schema digest;
- session/run ID;
- expected record-count bounds;
- monotonic sequence start;
- capture start metadata;
- instrumentation capability flags;
- observable availability map.

### Data records
At minimum:
- same run/session ID;
- monotonic sequence number;
- bounded payload;
- record type;
- per-record integrity field if used;
- provenance/observable class;
- no ability to silently switch version/capability mid-stream.

### END record
At minimum:
- same run/session ID;
- terminal sequence number;
- observed record count;
- truncation/overflow state;
- terminal status;
- digest/commitment over the record stream or equivalent deterministic integrity mechanism.

---

## 7. Define cross-record validation

The offline validator must fail closed on at least:

- missing META;
- duplicate META;
- data before META;
- missing END;
- duplicate END;
- data after END;
- run/session ID mismatch;
- sequence gap;
- sequence rollback;
- duplicate sequence;
- declared count mismatch;
- capability/version mutation mid-stream;
- END count mismatch;
- stream digest/commitment mismatch;
- truncation without explicit terminal marker;
- overflow without explicit fail-closed status;
- mixed Viewer-version records;
- mixed schema versions.

Do not treat partial traces as valid positive evidence.

---

## 8. Bind version gate to record-set integrity

VB-0 eligibility must be bound to the validated META context for the entire stream.

A data record must not independently assert or override Viewer version.

Version-bound observations are valid only if:

- META passes VB-0;
- record-set integrity passes;
- data belongs to that META/END envelope.

If the envelope fails, downgrade/fail closed according to the spec.

---

# Low findings

## 9. Address non-blocking Lows where cheap

Review the two Low findings from Work.

Fix them if doing so is local and low-risk.

Otherwise document them clearly in the internal review and handoff.

Do not expand scope merely to eliminate cosmetic debt.

---

# Preserve verified conclusions

## 10. Do not drift accepted findings

The correction package must preserve unless a genuine defect is discovered:

- public+harness can separate `40,788/40,788` synthetic schedules only via closed-world D2 timeline reconstruction;
- that synthetic separability does not imply live attribution sufficiency;
- sound public-only definite owner labels remain `0`;
- sound public-only definite subject labels remain `0`;
- sound public-only definite attribution labels remain `0`;
- correlator remains conservative with zero wrong labels;
- `5,063` unresolved schedules remain the DH-1 `ACTIVE0` pre-motion class unless the corrected observable analysis genuinely changes this;
- pending-clear → active-edge gap remains fail-closed;
- historical C8 remains unresolved;
- historical G2 remains FAIL row 3;
- C6 remains NOT_EVIDENCED.

If any of these change, investigate and explain.

---

# Tests

## 11. Expand research-local tests

Add tests for:

### VB-0
- exact-version acceptance;
- wrong-version rejection;
- missing/malformed version;
- digest mismatch;
- no fallback.

### Minimum-set ablation
- `P-XS` removal does not reduce declared target;
- each element in the final minimum set is necessary;
- co-minimal alternatives handled correctly if present.

### Cross-record integrity
- valid META/data/END stream;
- missing/duplicate META;
- missing/duplicate END;
- data before META;
- data after END;
- session mismatch;
- sequence gaps/duplicates/rollback;
- count mismatch;
- version/schema mutation;
- stream digest mismatch;
- truncation/overflow fail-closed.

Keep tests research-local (`*.diag-test.mjs` or equivalent).

Do not modify production test integration.

---

# Deterministic verification

## 12. Re-run complete verification

After corrections:

1. run diagnostic tests;
2. run D2 tests;
3. run `npm run test:offline`;
4. run diagnostic prototype twice from clean output directories;
5. compare byte-for-byte;
6. verify retained results match fresh run;
7. run `git diff --check`.

Report new exact counts and digest.

The diagnostic digest may change because:
- VB-0 logic changes;
- minimum bundle changes;
- cross-record-integrity results/schema change.

Do not preserve the old digest artificially.

---

# Internal review autonomy

## 13. Perform full internal review after remediation

Unlike the prior package, perform one **full** internal review after all corrections are complete.

Use explicit:

- Critical
- High
- Medium
- Low

Review at minimum:

- VB-0 gating;
- version normalization;
- source digest binding;
- minimum-set proof;
- ablation completeness;
- 13-question coverage;
- cross-record META/data/END integrity;
- stream digest/commitment;
- fail-closed partial traces;
- version-bound envelope binding;
- correlator soundness;
- deterministic outputs;
- no historical overclaim;
- owner-boundary compliance.

Within this authorized package:

- fix all Critical;
- fix all High;
- fix all Medium that remain inside offline/research scope;
- optionally fix Low.

If substantial fixes are made after the full review, run a targeted re-review of those fixes before stopping.

Do not return to the owner for each in-scope remediation.

---

# Handoff

## 14. Update `docs/handoffs/latest.md`

Record:

- baseline `06980ee1...`;
- correction package status;
- VB-0 fix status;
- exact accepted Viewer version gate;
- minimum instrumentation set after ablation;
- whether co-minimal bundles exist;
- updated number of diagnostic questions covered;
- META/data/END integrity design status;
- diagnostic test count;
- D2/offline suite status;
- new deterministic digest;
- remaining ambiguity class;
- historical C8 unresolved;
- no live diagnostic/retry/new record/reset;
- next action:
  **independent Work re-review of corrected diagnostic instrumentation package**.

---

# Commit policy

## 15. Do not commit or push

Leave all corrections, regenerated results, reviews, and handoff edits uncommitted for independent Work review.

---

# Hard owner-only boundaries

## 16. Stop if any correction would require

- accepted G2 procedure change;
- real T4 semantics change;
- real C6/N2 behavior change;
- real C8 behavior change;
- production/harness behavior change;
- Viewer/browser/live diagnostic;
- G2 retry;
- new authorization record;
- attempt reset;
- immutable evidence mutation;
- G3/milestone transition.

These remain unauthorized.

---

# Stop gate

## 17. Stop only when review-ready

Continue autonomously until:

- all 1 High + 2 Medium blockers are fixed;
- all relevant tests pass;
- deterministic runs pass;
- full internal review has 0 unresolved Critical/High/Medium within scope;
- handoff is updated.

Then stop at:

**Ready for independent Work re-review**

---

# Final report

Report:

- branch / HEAD / origin relation;
- exact files changed;
- VB-0 correction;
- version-gate tests;
- final minimum instrumentation set;
- ablation result;
- whether `P-XS` remains anywhere and why;
- updated `x of 13` question coverage;
- META/data/END integrity design;
- integrity-validation tests;
- diagnostic test count;
- D2 test count;
- offline-suite result;
- deterministic output digest;
- public-only sound-label counts;
- version-bound sound-label counts;
- residual ambiguity count/class;
- internal full-review C/H/M/L findings;
- autonomous remediations performed;
- working-tree state;
- exact next gate.

Explicitly confirm:

- no checkpoint commit/push;
- no real harness/product/procedure change;
- no real T4/C6/C8 runtime change;
- no Viewer/browser/live run;
- no G2 retry;
- no new authorization record;
- no attempt reset;
- immutable evidence unchanged.
