# For Claude — G2 Immutable Live-Evidence Preservation Only

I explicitly authorize **one bounded evidence-preservation task only** for the completed exactly-one live G2 attempt.

This task exists to make the authoritative live evidence durable and reviewable without changing its content or meaning.

It does **not** authorize:

- another live G2 attempt;
- a new authorization record;
- attempt reset/retry;
- harness/test/procedure/production fixes;
- C3/C8/C6 remediation;
- G3 or downstream work.

Use repository state and the raw generated evidence as the source of truth.

## 1. Verify current baseline first

Before writing anything, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- committed HEAD:
  `75a3ccb9ba160f8afcf3c9b39a301f352b273c08`
- `main == origin/main`
- exactly one live attempt occurred
- `AUTH_BOUND` occurred
- `ATTEMPT_CONSUMED` occurred
- terminal verdict:
  `FAIL (row 3)`
- no retry occurred
- no new authorization record has been issued after the attempt
- raw live evidence still exists under:
  `test/acceptance/results/`
- retained operator log still exists at its current external path if available
- no evidence file has been modified since the independent Work review

Read at minimum:

- `docs/reviews/2026-10-04-g2-live-evidence-verdict-independent-review.md`
- `docs/handoffs/latest.md`
- accepted procedure
- governing live plan
- current evidence files under `test/acceptance/results/`

If any authoritative evidence is missing or has changed unexpectedly, stop and report before copying anything.

## 2. Preservation goal

Create a **durable, immutable evidence snapshot** of the exactly-one live G2 attempt under the repository's established documentation/evidence structure.

Preferred destination:

`docs/research/evidence/g2-live-20261004-75a3ccb9/`

If that path conflicts with an existing established evidence structure, preserve repository conventions instead.

Do not move/delete the original generated evidence.

Do not rewrite or normalize original files.

## 3. Preserve authoritative evidence

Copy, byte-for-byte where possible, the complete authoritative evidence set required to reconstruct and independently verify the attempt.

Include at minimum, where they exist:

- R1
- R2
- R3
- K
- attempt/reservation journal
- final result JSON
- summary
- runtime identity
- fixture identity
- Viewer identity
- C1–C20 records
- N1–N8 control records
- cleanup evidence
- request/fatal/response ledger evidence
- rendering/C20 evidence
- authorization identity/reference
- attempt ID / reservation ID
- any terminal verdict artifact
- any generated metadata necessary to interpret hashes/relationships

If an artifact is referenced by the procedure but missing, do not invent it. Record it explicitly in the preservation manifest.

## 4. Preserve the operator log

Claude reported the raw operator log is outside the repo in a volatile `/private/tmp/...` location.

If that exact log still exists:

- copy it byte-for-byte into the durable evidence snapshot;
- record its original path;
- record its preserved path;
- compute and record SHA-256 before and after copy;
- confirm the hashes match.

If it no longer exists:

- do not recreate it;
- record that it was unavailable at preservation time;
- identify whether any retained evidence already captures its required facts.

Do not edit the log contents.

## 5. Evidence manifest

Create a manifest in the preserved evidence directory.

Suggested filename:

`MANIFEST.md`

The manifest must list:

- live attempt date/time if available from evidence;
- committed HEAD:
  `75a3ccb9ba160f8afcf3c9b39a301f352b273c08`
- authorization ID:
  `g2-live-20261004-75a3ccb9`
- final authorization record SHA:
  `f68436dfbab09ad32a2ba248cf6ab63ce652b5615e82f8232f77aae9409c33c6`
- harness SHA:
  `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`
- procedure SHA:
  `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- final terminal verdict:
  `FAIL (row 3)`
- attempt/reservation ID(s)
- each preserved artifact path
- SHA-256 for each preserved file
- original source path for each file
- whether each file is:
  - authoritative raw evidence;
  - generated summary;
  - copied operator log;
  - supporting review/governance artifact
- missing artifacts, if any
- explicit statement:
  **No preserved evidence file was modified or normalized during preservation.**

Do not put interpretations of C3/C8/C6 into the manifest beyond already authoritative verdict labels.

## 6. Immutable-copy verification

For every copied raw evidence file:

- compute source SHA-256;
- copy file;
- compute destination SHA-256;
- assert equality.

If any copy differs:

- stop;
- do not continue;
- report the mismatch.

Do not line-ending-normalize, pretty-print, rename internal fields, or reserialize JSON.

## 7. Preserve evidence relationships

Verify the preserved snapshot still allows independent reconstruction of:

- authorization record identity;
- attempt lifecycle;
- `AUTH_BOUND`;
- `ATTEMPT_CONSUMED`;
- first model load;
- both model loads;
- check/control outcomes;
- cleanup;
- R1/R2/R3 hashes against K;
- terminal verdict;
- exit code evidence if present.

Do not recompute a new verdict artifact; preserve the existing ones.

## 8. Governance artifacts

Include references, but do not copy/rename unless useful, to:

- Work independent live-evidence review
- Claude internal live review
- current handoff

The evidence snapshot should not replace `docs/reviews/` or `docs/handoffs/`.

## 9. Do not remediate findings

Do not change anything related to:

- C3 oracle mismatch;
- C8 camera/frustum settle behavior;
- C6 N2 discrimination;
- C20 dependency;
- request/ledger behavior;
- cleanup logic;
- harness comments;
- tests;
- product code.

This task is preservation only.

## 10. Verification after preservation

After copying:

- verify every preserved file hash;
- verify source files remain unchanged;
- run `git diff --check`;
- inspect the final evidence directory;
- confirm no source/test/procedure/production file changed.

Do not rerun the harness.

Do not regenerate evidence.

## 11. Focused internal review

Perform one focused internal review of the preservation operation only.

Review:

- completeness of copied evidence;
- source/destination hash equality;
- operator-log preservation;
- manifest accuracy;
- accidental normalization/mutation risk;
- whether authoritative vs supporting artifacts are clearly distinguished.

Classify Critical / High / Medium / Low.

Do not reinterpret G2 findings in this review.

Persist under:

`docs/reviews/`

Update:

`docs/handoffs/latest.md`

## 12. Handoff requirements

Update the handoff to state:

- exactly-one live G2 attempt remains closed at `FAIL (row 3)`;
- no retry/new record/remediation is authorized;
- authoritative evidence has been durably preserved;
- preserved evidence path;
- manifest path;
- operator-log preservation status;
- source evidence remains untouched;
- next action:
  **owner decision on bounded C3/C8/C6 remediation planning**.

Do not imply remediation is authorized.

## 13. Commit policy

Do not commit or push unless separately authorized.

Leave the evidence snapshot, preservation review, and handoff update uncommitted for independent Work review.

## 14. Stop gate

Stop after:

- durable evidence copy;
- hash verification;
- manifest creation;
- focused preservation review;
- handoff update.

Do not:

- rerun live G2;
- issue a new authorization record;
- reset attempt state;
- fix C3/C8/C6;
- modify harness/tests/procedure/production code;
- start remediation planning;
- commit;
- push.

Next gate:

**Independent Work review of immutable live-evidence preservation → owner decision on bounded remediation planning**

## Final report

Report:

- branch / HEAD / origin relation;
- preservation directory;
- manifest path;
- number of files preserved;
- source/destination SHA verification result;
- operator-log preservation result;
- any missing artifact;
- source evidence untouched confirmation;
- internal review findings;
- working-tree state;
- exact next gate.

Explicitly confirm:

- no retry occurred;
- no new authorization record was issued;
- no attempt state was reset;
- no harness/test/procedure/production fix occurred;
- no commit;
- no push.
