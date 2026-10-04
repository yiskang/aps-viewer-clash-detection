# For Claude — G2 D0/D1 Research Correction Only

I explicitly authorize **one bounded D0/D1 research-correction task only**.

This task is limited to correcting the current D0 Viewer API / D1 R1 replay research artifact and its reproducibility/portability based on the latest independent Work review.

It does **not** authorize:

- D2 implementation;
- synthetic-transition implementation;
- C8 implementation/instrumentation;
- C6/N2 implementation;
- T4 settle-rule changes;
- harness/test/product/procedure changes;
- another live G2 attempt;
- a new authorization record;
- attempt reset;
- commit or push.

Use the repository, immutable evidence, and cited Viewer 7.124.2 source/API material as the source of truth.

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
- historical G2 verdict remains:
  `FAIL (row 3)`
- no retry occurred
- no new authorization record was issued
- no attempt state was reset
- no harness/test/product/procedure implementation changes occurred

Read:

- `docs/research/2026-10-04-g2-d0-viewer-api-evidence-d1-r1-replay.md`
- `docs/research/2026-10-04-g2-d1-replay-scripts/`
- `docs/reviews/2026-10-04-g2-d0-viewer-api-evidence-d1-r1-replay-independent-review.md`
- `docs/reviews/2026-10-04-g2-d0-viewer-api-evidence-d1-r1-replay-internal-review.md`
- `docs/handoffs/latest.md`
- relevant Viewer 7.124.2 source/API references already used by the research

If baseline differs materially, stop and report.

## 2. Medium M1 — downgrade one-request-lag claim

The current research overstates the camera/request alignment as exact or strong.

Correct the research so the retained evidence supports only:

- a **moderate/partial one-request-lag pattern**;
- historical causality remains **unproved**.

Remove or downgrade wording such as:

- exact one-request lag;
- strong one-request lag;
- direct proof of stale-camera causality;
- claims that request N definitely observed request N-1.

Preserve only what the evidence actually supports.

### Required framing

Clearly distinguish:

- **Observed replay fact**:
  saved camera samples do not align with their own requested framing;
- **Pattern**:
  some samples are consistent with prior-request state;
- **Inference**:
  a one-request lag is plausible;
- **Unresolved causality**:
  queueing, start delay, active transition, fit no-op, rAF/tick ordering, fixture/state effects, or another mechanism remain possible.

Do not weaken the exact arithmetic-reproduction result.

## 3. Medium M2 — remove unsupported historical B:111 geometry dependency

The D2 proposal currently assumes historical B:111 geometry that was **not retained in R1**.

Correct D2 input requirements so they use only:

- retained U/A:104 data where available;
- explicitly synthetic missing-target geometry where historical geometry is unavailable.

Do not present synthetic geometry as historical evidence.

### Required wording

The D2 design must state:

- retained historical inputs are used only where actually present;
- missing target geometry is synthetic by construction;
- D2 tests mechanical possibility, not historical causality;
- no claim may depend on reconstructing unavailable B:111 geometry from memory/current model state.

If B:111 identity is referenced, label historical geometry as unavailable unless repository evidence proves otherwise.

## 4. Low — narrow `restoreState(..., true)` wording

The current research overstates what `restoreState(..., true)` proves.

Correct wording to the narrowest source-supported statement.

At minimum, distinguish:

- the observed/source behavior that immediate restore does not cancel the currently active transition in the inspected Viewer 7.124.2 implementation;
- any return-value observation;
- what is **not** guaranteed publicly;
- what cannot be generalized beyond the pinned implementation.

Do not state that it "always succeeds" or "always returns true" unless the inspected source path truly proves that for all relevant cases.

Prefer wording such as:

- "in the inspected Viewer 7.124.2 path, this call returns immediately and does not cancel the active transition"

if that is what the source supports.

## 5. Low — improve replay/source portability

Improve reproducibility so another agent can reproduce D0/D1 without hidden local assumptions.

Review and correct:

- replay script invocation;
- working-directory assumptions;
- file-path assumptions;
- source lookup locations;
- Viewer-source acquisition/reference assumptions;
- required Node/Python/runtime versions if applicable;
- expected inputs/outputs;
- deterministic ordering;
- any dependency on local caches or machine-specific paths.

### Required reproducibility content

The research/replay package should make explicit:

- exact commands;
- repo-relative paths;
- required environment;
- required preserved evidence inputs;
- expected output files/values;
- how Viewer source/API references are located;
- what must be fetched externally vs what is already checked in;
- what to do if an external source is unavailable.

Do not add network-fetch automation unless already justified by repo conventions.

## 6. Preserve accepted D0 technical conclusions

Do not reopen or weaken supported conclusions unless the correction reveals a contradiction.

Preserve:

- asynchronous request consumption;
- shared last-writer-wins pending slot;
- active-transition holding;
- lack of request identity in the public completion event;
- T4 gaps:
  - zero-motion window;
  - no transition-state input;
  - no request correlation;
- these gaps make premature settlement **plausible**, not proven;
- arithmetic reproduction is exact for retained finite values;
- frustum/oracle arithmetic defect is closed for the saved samples;
- C6 remains `NOT_EVIDENCED`;
- no defensible C6 margin can be derived from current evidence;
- D2 offline synthetic research remains recommended.

Do not promote implementation details into stable public API guarantees.

## 7. Preserve D2 scope boundary

The corrected research must keep D2 strictly offline/synthetic.

D2 may test:

- whether the observed partial lag pattern is mechanically possible;
- whether current T4 can settle before current-request transition ownership is established;
- candidate synthetic transition sequences;
- candidate C6 discrimination behavior.

D2 must **not** be described as proving:

- historical live causality;
- B:111 historical camera/geometry state;
- acceptance success;
- product defect.

No D2 implementation is authorized in this task.

## 8. T4 disposition

Keep T4 unchanged.

Preserve the recommendation:

- gather evidence first;
- any T4 change requires separate owner authorization and procedure re-acceptance.

Do not propose a settled new T4 algorithm in this correction task.

## 9. C6 margin disposition

Do not choose a margin.

State clearly:

- current retained evidence cannot justify a numeric margin;
- margin derivation must wait for synthetic/offline transition fixtures or other independently accepted evidence.

## 10. Replay-script verification

Re-run the D1 replay scripts after portability corrections, if needed, in read-only mode.

Confirm:

- preserved evidence inputs unchanged;
- output remains deterministic;
- C6/N2/C8 arithmetic still reproduces the historical retained values exactly;
- no evidence file is modified.

If replay output changes unexpectedly, stop and report.

## 11. Fact/inference matrix correction

Review the research's fact/inference matrix and ensure every relevant statement is correctly categorized as:

- source/API fact;
- preserved-evidence fact;
- inference;
- unresolved gap.

Specifically ensure the one-request-lag hypothesis is not in a "proven fact" category.

## 12. Internal consistency sweep

Search the research artifact for stale wording related to:

- exact/strong one-request lag;
- historical B:111 geometry;
- unconditional restoreState success;
- local-only replay paths;
- causal claims stronger than evidence supports.

Correct all coupled wording, not just one paragraph.

## 13. Focused internal review

Perform one focused internal review over only:

- M1 lag-strength correction;
- M2 D2-input correction;
- restoreState wording;
- replay/source portability;
- fact-vs-inference labeling;
- preservation of accepted D0/D1 conclusions;
- D2 boundary.

Classify Critical / High / Medium / Low.

Fix genuine Critical/High research/documentation defects within scope.

Persist under:

`docs/reviews/`

Update:

`docs/handoffs/latest.md`

## 14. Handoff requirements

Update handoff to state:

- baseline `ef436d4...`;
- C3/C2 checkpoint remains complete;
- D0/D1 research corrected;
- one-request-lag pattern is moderate/partial, causality unproved;
- D2 must use retained U/A:104 data plus explicitly synthetic missing-target geometry;
- T4 unchanged;
- C6 remains `NOT_EVIDENCED`;
- no margin selected;
- no implementation authorized;
- no retry/new record authorized;
- next action:
  **targeted independent Work re-review of corrected D0/D1 research**.

## 15. Commit policy

Do not commit or push.

Leave the corrected research, replay portability changes, internal review, and handoff update uncommitted for targeted Work re-review.

## 16. Stop gate

Stop after:

- D0/D1 research correction;
- replay/source portability correction;
- replay verification;
- internal review;
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

**Targeted independent Work re-review of corrected G2 D0/D1 research → owner decision on D0/D1 checkpoint and D2 authorization**

## Final report

Report:

- branch / HEAD / origin relation;
- research artifact changed sections;
- M1 wording correction;
- M2 D2-input correction;
- restoreState wording correction;
- replay/source portability changes;
- replay verification result;
- fact/inference matrix status;
- internal review findings;
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
