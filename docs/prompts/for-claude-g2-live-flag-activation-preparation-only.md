# For Claude — G2 Live-Flag Activation Preparation Only

I explicitly authorize **one bounded live-flag activation-preparation / verification task only**.

Baseline:
- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD: `7ae4147b726e20b8183f0522ffabf61ab75895d6`
- `main == origin/main`
- working tree clean
- committed harness SHA:
  `d34d470cf51f5f74c5cf3cfa8380944822af2ce6c2e07d27f4117ea71fd19c39`
- accepted procedure SHA:
  `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- `G2_DUAL_COUNTER_GATE.resolved=true`
- `LIVE_PATH_WIRED=false`

Use repository state as source of truth. This does **not** authorize real activation.

## 1. Verify baseline

Before work, verify:
- branch / HEAD / origin relation
- clean tree
- handoff
- accepted live plan and latest independent reviews
- procedure and harness hashes
- `G2_DUAL_COUNTER_GATE.resolved=true`
- `LIVE_PATH_WIRED=false`
- no authorization record
- no attempt/reservation state
- no Viewer/fixture/live evidence

If materially different, stop and report.

## 2. Authorized scope

Do only:
1. scratch/temp-copy simulation of `LIVE_PATH_WIRED=false -> true`;
2. determine the exact future real activation diff;
3. verify offline isolation after the simulated flip;
4. verify future runtime prerequisites, especially Node `v22.23.1`;
5. focused internal review;
6. docs/review/handoff updates if warranted.

Do not change the real live flag.

## 3. Scratch-copy flip simulation

Create an isolated scratch/temp copy of relevant harness/tests.

In the scratch copy only:
- flip `LIVE_PATH_WIRED=false` to `true`;
- make only the known deliberate test-pin adjustment(s);
- run relevant activation/pinning/live-path-isolation/CLI/runtime-gate/focused G2 tests and offline aggregate if practical.

Determine exactly:
- which files a real flip would require;
- whether literal flip + known pin is sufficient;
- whether any other tests fail;
- whether any test enters real validation;
- whether auth-shaped fixtures can escape temp root;
- whether any attempt state can be created;
- whether CLI can touch the real harness;
- whether offline suites remain offline.

Do not copy scratch changes back to the real repo.

If more than the expected bounded changes are needed, stop and report the delta.

## 4. Real-repo immutability

The real repo must remain:
- `LIVE_PATH_WIRED=false`
- no authorization record
- no attempt/reservation state
- no Viewer/fixture/live evidence

After simulation, verify the real tree changed only by explicitly authorized docs/review/handoff artifacts, if any.

## 5. Runtime prerequisites

Verify future activation requires exactly:
- Node `v22.23.1`
- `playwright` `1.62.1`
- `playwright-core` `1.62.1`
- Chromium headless-shell `151.0.7922.34`

Determine the currently available Node runtime(s).

If the current shell is not exactly `v22.23.1`:
- do not install or switch Node in this task;
- identify the exact operator action/version-manager command needed later to select `v22.23.1`;
- verify the committed hard gate rejects the current mismatch;
- document the prerequisite.

Do not launch Viewer or run live G2.

## 6. Exact future activation diff

Based on the scratch simulation, define the future real-repo activation change set:
- exact file containing `LIVE_PATH_WIRED`;
- exact literal/value change;
- exact deliberate test pin/update;
- any additional required file change proven by simulation.

Do not apply those changes now.

If larger than expected, classify whether:
- activation-preparation checkpoint was incomplete;
- a new bounded correction is needed;
- or it is only test expectation migration.

## 7. Activation-boundary safety

Confirm that after a future real flip but before authorization issuance:
- offline tests cannot consume a live authorization;
- tests cannot create real attempt state;
- Viewer/fixture path does not start automatically;
- missing authorization still prevents live execution;
- runtime hard gates still run before reservation/import;
- CLI tests remain isolated;
- a coincidental filename cannot trigger the production live path.

Any violation is a blocker.

## 8. Authorization-record boundary

Do not create or prepare a real authorization record.

Only determine whether, after a separately authorized real flag flip and clean review/commit, prerequisites for authorization-record preparation would be satisfied.

List prerequisites, including:
- clean committed activation hash;
- exact Node `v22.23.1`;
- recomputed harness SHA;
- clean-tree identity binding;
- any remaining schema/evidence prerequisite.

## 9. Hash handling

The real committed harness SHA must remain:

`d34d470cf51f5f74c5cf3cfa8380944822af2ce6c2e07d27f4117ea71fd19c39`

during this task.

Scratch-copy hashes are diagnostic only.

If real source/test files change unexpectedly, stop and report.

## 10. Focused internal review

Review:
- scratch flip simulation;
- exact future activation diff;
- offline/auth isolation;
- Node/runtime prerequisite;
- whether a real flip can safely be separately authorized;
- whether any plan/harness/test correction remains.

Classify Critical / High / Medium / Low.

Persist under `docs/reviews/`.

Update `docs/handoffs/latest.md` only if this task creates a meaningful durable project-state conclusion.

## 11. Handoff

If updated, include:
- baseline commit/hashes;
- scratch flip result;
- exact future activation diff;
- runtime prerequisite status;
- whether real activation is ready for separate owner authorization;
- `LIVE_PATH_WIRED=false`;
- no auth record;
- no attempt consumed;
- no Viewer/fixture/live G2;
- next action: independent Work review.

Do not state that activation is authorized.

## 12. Commit policy

Do not commit or push.

Leave any docs/review/handoff changes uncommitted for Work review.

## 13. Stop gate

Stop after:
- scratch simulation;
- runtime prerequisite verification;
- future activation diff definition;
- internal review;
- handoff update if warranted.

Do not:
- flip real `LIVE_PATH_WIRED`;
- edit real activation literal;
- issue/prepare authorization record;
- reserve/consume attempt;
- switch Node/runtime environment;
- launch Viewer/load fixtures;
- run live G2;
- commit/push.

Next gate:

**Independent Work review of G2 live-flag activation preparation → owner decision on whether to authorize the real flag flip**

## 14. Final report

Report:
- branch / HEAD / origin relation;
- real working-tree state;
- scratch-copy location/type;
- exact scratch diff;
- simulation test results;
- whether literal flip + known pin was sufficient;
- any additional required change;
- current Node version;
- exact future Node `v22.23.1` selection prerequisite;
- whether hard runtime gates remain sound;
- exact future real activation diff;
- internal review findings;
- whether real flag flip appears ready for independent review.

Explicitly confirm:
- `G2_DUAL_COUNTER_GATE.resolved=true`
- real `LIVE_PATH_WIRED=false`
- no authorization record
- no attempt reserved/consumed
- no Viewer/fixture load
- no live G2
- committed harness SHA unchanged
- procedure SHA unchanged
- no commit
- no push
