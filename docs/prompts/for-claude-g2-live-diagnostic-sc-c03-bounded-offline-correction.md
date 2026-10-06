# For Claude — G2 Live-Diagnostic SC-C03 Bounded Offline Correction

I explicitly authorize one **bounded offline-only correction** for the current uncommitted G2 future live-diagnostic design/preparation package.

The latest independent Work review found:

- Critical: 0
- High: 0
- Medium: 1 — checkpoint blocker
- Low: 2
- readiness: bounded correction required

The prior design areas are accepted. This task is limited to fixing the `SC-C03` withheld-closeout contradiction, correcting stale P5.11 references, re-running verification, performing a targeted internal review, updating the handoff, and stopping for targeted independent Work re-review.

Do not stop for owner approval between those in-scope steps.

## 1. Verify baseline

Before editing, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD: `f3bab74f460eacd6b6f69bc8fb90110455ceeb68`
- `main == origin/main`
- historical authorization records remain tracked and non-executable
- no active authorization exists
- harness SHA unchanged: `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`
- procedure SHA unchanged: `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- immutable evidence unchanged
- D2 checkpoint unchanged
- diagnostic-instrumentation checkpoint unchanged
- historical G2 remains `FAIL (row 3)`
- C6 remains `NOT_EVIDENCED`
- C8 remains unresolved
- no Viewer/browser/live run
- no G2 retry
- no new authorization record
- no attempt reset
- no G3 work
- nothing committed or pushed

Current accepted verification baseline:

- package tests: `113/113`
- D2 tests: `55/55`
- diagnostic instrumentation tests: `72/72`
- offline suite: `5,155 total / 5,154 pass / 0 fail / 1 existing todo`
- preparation prototype: two fresh runs byte-identical
- gates: `13/13`
- retained digests match current package state
- verdict: `B — prepared, currently not worthwhile`

Read the latest independent Work review, latest handoff, `docs/research/2026-10-06-g2-live-diagnostic-preparation/spec-part2-controls-envelope-verdict-runbook.md`, package README, prototype/tests/results, and internal review.

If baseline differs materially, stop and report.

## 2. Fix the SC-C03 contradiction

Work found:

> When scratch analyses A and B differ, A cannot be published “marked withheld” without changing the bytes that were just compared.

The fix must be structural, not prose-only.

Requirements:

- scratch analysis A remains byte-identical to the compared bytes;
- scratch analysis B remains byte-identical to the compared bytes;
- neither A nor B is rewritten/annotated after comparison;
- a separate deterministic SC-C03 closeout artifact records the withheld decision.

## 3. Dedicated SC-C03 closeout artifact

Design and specify a separate closeout artifact that records:

- SC-C03 outcome;
- A/B mismatch;
- SHA-256 of A;
- SHA-256 of B;
- comparison result;
- reason code;
- terminal verdict;
- promotion eligibility;
- run/session identity;
- provenance;
- bounded deterministic serialization.

Use a deterministic path/name under the preparation results/evidence design.

Do not mutate A/B to encode withheld status.

## 4. Publication/promotion semantics

Clarify:

- raw scratch analysis;
- compared artifact;
- promoted/published derived artifact;
- SC-C03 closeout record.

For SC-C03 mismatch:

- A and B remain preserved raw artifacts;
- neither becomes authoritative promoted analysis;
- the closeout artifact is authoritative for why promotion was withheld;
- any summary references A/B hashes instead of modifying A/B.

## 5. Evidence-freeze ordering

Correct the mismatch path ordering to:

1. write A;
2. write B;
3. hash A/B;
4. compare A/B;
5. generate deterministic SC-C03 closeout artifact;
6. write/update manifest entries;
7. finalize END/terminal metadata;
8. compute final manifest/stream hashes;
9. freeze evidence directory.

No mutation of A/B after comparison.
No freeze before closeout + manifest finalization.

## 6. Verdict semantics

Define exact SC-C03 behavior:

- which terminal verdict applies;
- promotion prohibited;
- evidence preserved;
- future attempt-consumption implications, without changing current authorization semantics;
- retry remains unauthorized unless separately approved.

Keep this design-only.

## 7. Prototype support

Update the offline preparation prototype so SC-C03 mismatch scenarios emit the separate closeout artifact/path and prove:

- A unchanged;
- B unchanged;
- deterministic closeout;
- correct hashes;
- manifest references;
- promotion blocked;
- deterministic terminal state.

Do not touch real harness/product code.

## 8. Regression tests

Add research-local tests for:

### A. A/B identical
- comparison succeeds;
- normal promotion path works;
- no mismatch closeout unless intentionally specified.

### B. A/B differ
- A bytes unchanged;
- B bytes unchanged;
- closeout emitted;
- closeout hashes match A/B;
- promotion blocked;
- manifest complete;
- fail-closed terminal state.

### C. Mutation detection
- post-comparison mutation of A/B causes validation failure.

### D. Determinism
- repeated mismatch produces byte-identical closeout and manifest.

### E. Bounds
- closeout remains within declared size limits.

## 9. Fix stale P5.11 references

Search the whole package for `P5.11` and related phase references.

Work says the commit record is correctly at `P5.12` elsewhere.

Correct stale references so phase numbering is internally consistent.

Do not renumber unrelated phases.

## 10. Preserve accepted design

Do not disturb:

- Part 1 v5 / Part 2 v4;
- minimum instrumentation `ID-ON + P-FRM + P-TC + V-PEND + V-EDGE`;
- event cap `24,576`;
- byte cap `6,400,000`;
- capture semantics;
- pending-gap handling;
- controls;
- VB-3 limitation;
- target-plan binding;
- ordinary freeze ordering;
- verdict B;
- OD recommendations;
- historical G2/C6/C8/T4 state.

If any accepted area changes unexpectedly, stop and explain.

## 11. Verification

Run package tests:

`node --test docs/research/2026-10-06-g2-live-diagnostic-preparation/prototype/*.prep-test.mjs`

Baseline: `113/113`. Report new exact count.

Run D2 tests:

`node --test docs/research/2026-10-04-g2-d2-synthetic-transition/*.d2-test.mjs`

Expected: `55/55`.

Run diagnostic tests:

`node --test docs/research/2026-10-05-g2-diagnostic-instrumentation/*.diag-test.mjs`

Expected: `72/72`.

Run:

`npm run test:offline`

Expected:
- `5,155 total`
- `5,154 pass`
- `0 fail`
- `1 existing todo`

Run `git diff --check`.

## 12. Deterministic prototype runs

Run the preparation prototype twice from clean output directories.

Verify:

- byte-identical runs;
- all gates pass;
- retained `results/` matches final fresh run;
- SC-C03 closeout artifact deterministic;
- A/B raw hashes stable;
- verdict semantics unchanged except corrected representation.

Record final:
- `results.json` SHA-256;
- `SHA256SUMS` SHA-256;
- SC-C03 closeout artifact SHA-256;
- final fixture/verdict counts.

## 13. Targeted internal review

Perform one targeted internal review with explicit:

- Critical
- High
- Medium
- Low

Review:

1. A/B immutability;
2. closeout artifact;
3. determinism;
4. hash/manifest correctness;
5. promotion-withheld semantics;
6. freeze ordering;
7. terminal verdict semantics;
8. P5.12 phase consistency;
9. accepted-design preservation;
10. owner-boundary compliance.

Fix all in-scope Critical/High/Medium findings.

If substantial changes follow, run a targeted re-review.

## 14. Handoff

Update `docs/handoffs/latest.md` with:

- baseline `f3bab74...`;
- SC-C03 correction status;
- dedicated closeout artifact/path;
- A/B byte-preservation invariant;
- P5.12 correction;
- package test count;
- supporting-suite results;
- deterministic hashes;
- verdict B unchanged;
- OD recommendations unchanged unless explicitly affected;
- no live diagnostic/retry/new record/reset;
- next action:
  **targeted independent Work re-review of SC-C03 correction package**.

## 15. Commit policy

Do not commit or push.

## 16. Hard boundaries

Do not:

- run Viewer/browser/live diagnostic;
- retry G2;
- issue/reset authorization;
- change real harness/product/procedure;
- change T4/C6/C8 runtime behavior;
- mutate immutable evidence;
- begin G3;
- commit;
- push.

## 17. Stop gate

Continue autonomously until:

- SC-C03 contradiction is structurally fixed;
- A/B remain byte-identical after comparison;
- deterministic closeout artifact exists;
- stale P5.11 references are corrected;
- tests pass;
- deterministic runs pass;
- targeted internal review has no unresolved in-scope Critical/High/Medium;
- handoff updated.

Then stop at:

**Ready for targeted independent Work re-review**

## Final report

Report:

- branch / HEAD / origin relation;
- exact files changed;
- SC-C03 closeout design;
- closeout artifact path/schema;
- A/B immutability verification;
- manifest/hash behavior;
- P5.12 corrections;
- new package test count;
- D2 test result;
- diagnostic test result;
- offline-suite result;
- deterministic result hashes;
- SC-C03 closeout hash;
- verdict distribution;
- targeted internal review C/H/M/L;
- working-tree state;
- exact next gate.

Explicitly confirm:

- no checkpoint commit/push;
- no Viewer/browser/live run;
- no G2 retry;
- no new authorization record;
- no attempt reset;
- no real harness/product/procedure change;
- no real T4/C6/C8 runtime change;
- immutable evidence unchanged.
