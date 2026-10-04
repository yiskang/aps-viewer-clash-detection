# For Claude — G2 D0/D1 Final Wording Correction Only

I explicitly authorize **one final bounded documentation-only correction** to the current D0 Viewer API / D1 R1 replay research.

This task is limited to the three wording/portability issues identified by the latest independent Work re-review.

It does **not** authorize:

- D2 research/spec implementation;
- D2 synthetic-transition implementation;
- C8 implementation/instrumentation;
- C6/N2 implementation;
- T4 settle-rule changes;
- harness/test/product/procedure changes;
- live retry;
- new authorization-record issuance;
- attempt reset;
- commit or push.

Use the repository, immutable evidence, and the latest independent Work review as the source of truth.

## 1. Verify baseline

Before editing, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD:
  `ef436d4a5632692fadbddc09fb9aa6410fadc258`
- `main == origin/main`
- harness SHA unchanged
- procedure SHA unchanged
- immutable evidence snapshot unchanged:
  `docs/research/evidence/g2-live-20261004-75a3ccb9/`
- historical G2 remains:
  `FAIL (row 3)`
- no retry
- no new authorization record
- no attempt reset
- no harness/test/product/procedure implementation changes

Read:

- `docs/research/2026-10-04-g2-d0-viewer-api-evidence-d1-r1-replay.md`
- `docs/reviews/2026-10-04-g2-d0-d1-corrected-targeted-independent-rereview.md`
- latest handoff
- replay README/instructions/scripts only as needed for wording accuracy

If baseline differs materially, stop and report.

## 2. Medium M1 — correct §10 historical overclaim

The current §10 still overstates what geometric similarity proves.

Correct §10 and all coupled wording so the research does **not** claim that retained evidence proves:

- N2 definitely examined C6's result;
- N2/C6 definitely belonged to one stale request sequence;
- a successful home-camera reset definitely occurred before N2;
- camera ownership/request ownership is historically established.

### Required evidence-safe framing

The strongest allowed wording should distinguish:

- **geometric similarity**:
  N2's saved camera/geometry is similar to the retained C6 union framing under the documented comparison;
- **pattern consistency**:
  this is consistent with a partial/moderate lag hypothesis;
- **historical ownership**:
  unproved;
- **sequence causality**:
  unproved;
- **home/reset success**:
  unproved unless directly evidenced.

Use phrases such as:

- "consistent with"
- "geometrically similar to"
- "compatible with"

and avoid:

- "is the result of"
- "belongs to"
- "proves"
- "must have followed"

unless directly supported by evidence.

## 3. Sweep coupled wording

Search the entire D0/D1 research artifact for claims that imply stronger historical ownership/sequence than the evidence supports.

Correct any coupled wording in:

- §10;
- replay discussion;
- fact/inference matrix;
- C6/N2 discussion;
- D2 motivation;
- conclusion/summary.

Do not weaken the exact finite arithmetic reproduction result.

## 4. Low L1 — fix “any cwd” wording

The documented replay command currently overstates portability.

Correct the wording so it accurately describes the command's actual path assumptions.

If the command is repository-relative, say so explicitly.

Examples of acceptable wording:

- "can be launched from any working directory **when using the documented repo-relative/absolute script path**";
- or provide an exact command that resolves the script path robustly.

Do not claim arbitrary cwd independence if a caller still needs to know the repository location.

## 5. Low L2 — replace “checked in (uncommitted)”

Replace wording like:

`checked in (uncommitted)`

with:

`present in the working tree`

or another accurate phrase.

Do not use "checked in" for uncommitted artifacts.

Sweep the research/replay docs for this wording.

## 6. Preserve accepted conclusions

Do not change these accepted dispositions:

- one-request-lag pattern remains moderate/partial;
- historical causality remains unproved;
- D2 uses retained U and A:104 plus explicitly synthetic missing-target geometry;
- `restoreState(..., true)` wording remains narrowly source-supported;
- replay portability improvements remain in place;
- exact arithmetic reproduction remains exact for retained finite values;
- C6 remains `NOT_EVIDENCED`;
- no numeric C6 margin is selected;
- T4 remains unchanged;
- D2 remains recommended but not authorized;
- official-docs animation statement remains qualified per verified APS Viewer reference.

## 7. Replay/scripts scope

Do not change replay logic unless required only to correct a documentation command that is actually invalid.

Prefer docs-only correction.

If code/script behavior must change to make the documented portability claim true, stop and report instead of broadening scope.

## 8. Verification

Perform documentation-only verification:

- grep/search for stale historical-ownership claims;
- verify "any cwd" wording matches actual command semantics;
- verify no "checked in (uncommitted)" wording remains;
- verify D2 boundaries unchanged;
- verify T4/C6 conclusions unchanged;
- run `git diff --check`.

Do not rerun live G2.

Replay execution is optional and only if needed to confirm wording; it must remain read-only.

## 9. Focused internal review

Perform one focused internal review covering only:

- §10 historical-claim correction;
- coupled ownership/sequence wording;
- cwd portability wording;
- working-tree terminology;
- preservation of accepted D0/D1 conclusions.

Classify Critical / High / Medium / Low.

Fix genuine Critical/High documentation defects within scope.

Persist under:

`docs/reviews/`

Update:

`docs/handoffs/latest.md`

## 10. Handoff requirements

Update handoff to state:

- baseline `ef436d4...`;
- D0/D1 wording correction complete;
- geometric similarity no longer treated as proof of historical ownership/sequence;
- cwd/replay wording corrected;
- uncommitted artifacts described as present in working tree;
- T4 unchanged;
- C6 remains `NOT_EVIDENCED`;
- D2 still not authorized;
- next action:
  **targeted independent Work re-review of final D0/D1 wording correction**.

## 11. Commit policy

Do not commit or push.

Leave the corrected research, internal review, and handoff update uncommitted for targeted Work re-review.

## 12. Stop gate

Stop after:

- wording correction;
- documentation verification;
- focused internal review;
- handoff update.

Do not:

- implement D2;
- modify harness/tests/product/procedure;
- change T4;
- redesign C6/N2;
- rerun live G2;
- issue a new authorization record;
- reset attempt state;
- commit;
- push.

Next gate:

**Targeted independent Work re-review of final corrected D0/D1 research → owner decision on checkpoint commit/push and later D2 spec/research authorization**

## Final report

Report:

- branch / HEAD / origin relation;
- exact sections changed;
- §10 historical-overclaim correction;
- coupled wording changes;
- cwd portability wording correction;
- working-tree terminology correction;
- internal review findings;
- `git diff --check` result;
- working-tree state;
- exact next gate.

Explicitly confirm:

- no D2 implementation occurred;
- no C8/C6/T4 implementation change;
- no harness/test/product/procedure change;
- no live retry;
- no new authorization record;
- immutable evidence unchanged;
- no commit;
- no push.
