# For Claude — G2 Future Live-Diagnostic Design / Preparation Checkpoint Commit + Push Only

I explicitly authorize one scoped checkpoint commit and push for the accepted G2 future live-diagnostic design/preparation package.

Latest independent Work re-review:
- Critical: 0
- High: 0
- Medium: 0
- Low: 1 non-blocking
- readiness: ready to checkpoint
- prior SC-C03 blocker: closed

This task is checkpoint-only. It does not authorize live execution, G2 retry, runtime implementation, procedure changes, real T4/C6/C8 changes, new authorization issuance/reset, or G3.

## Baseline

Verify:
- repo `aps-viewer-clash-detection`
- branch `main`
- `main == origin/main == f3bab74f460eacd6b6f69bc8fb90110455ceeb68`
- harness SHA unchanged: `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`
- procedure SHA unchanged: `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- immutable evidence unchanged
- D2 and diagnostic-instrumentation checkpoints unchanged
- G2 remains FAIL row 3
- C6 remains NOT_EVIDENCED
- C8 remains unresolved
- T4 unchanged
- no live/retry/new record/reset/G3

Accepted verification:
- package tests 146/146
- D2 55/55
- diagnostic 72/72
- offline 5,155 total / 5,154 pass / 0 fail / 1 todo
- prototype 14/14 gates
- scenario distribution 7 SUPPORTED / 1 REJECTED / 14 INCONCLUSIVE / 47 INVALID / 1 BLOCKED

Accepted hashes:
- `results.json`: `b3fb9ef2718910a41a5fdb8fa86223a860419f97da61d6d4a449233558239cfc`
- `SHA256SUMS`: `8b1cd4e0e6b4d66e972337f9afe380ab11c09d9185ed26aec5566aea7fbf3717`
- `SC-C03-CLOSEOUT.json`: `30acf5bea173aac3ca0b2e8fed1689ed0cf3b681437a83a0938c5e35f76aa78b`

If baseline differs materially, stop.

## Inspect and stage only reviewed artifacts

Inspect all modified/untracked files first.

In scope:
- `docs/research/2026-10-06-g2-live-diagnostic-preparation/`
- related internal/independent reviews
- related authorization/review prompts for this package
- `docs/handoffs/latest.md`

Do not use broad `git add docs`.

Do not stage unrelated historical artifacts or alter tracked historical authorization records.

## Protected paths

Verify no changes to:
- `src/`
- `test/`
- `wwwroot/`
- production runtime/config
- accepted procedure
- immutable evidence
- D2 checkpoint
- diagnostic-instrumentation checkpoint
- real G2 harness
- real T4/C6/C8 behavior

If any protected change exists, stop.

## Final verification

Run:
- `node --test docs/research/2026-10-06-g2-live-diagnostic-preparation/prototype/*.prep-test.mjs` → expect 146/146
- `node --test docs/research/2026-10-04-g2-d2-synthetic-transition/*.d2-test.mjs` → expect 55/55
- `node --test docs/research/2026-10-05-g2-diagnostic-instrumentation/*.diag-test.mjs` → expect 72/72
- `npm run test:offline` → expect 5,155 total / 5,154 pass / 0 fail / 1 todo
- `git diff --check` → clean

Verify retained hashes exactly match the accepted values above. Do not regenerate outputs unless verification fails.

## Confirm SC-C03 accepted state

Before commit, verify:
- A/B remain immutable after comparison
- separate deterministic `SC-C03-CLOSEOUT.json`
- mismatch blocks promotion
- manifest uses `terminalCarrierPath`
- commit record is WITHHELD
- journal remains CLOSEOUT_STARTED
- P5.11 = freeze
- P5.12 = commit record
- INVALID-path manifestSha256 fix present
- Appendix (v) fix present
- closeout null rules present

## Deferred Low

Ensure the handoff records the one remaining Low:

> P5.10 does not equality-check manifest identity fields such as `runId` against authoritative run/closeout identity.

This is non-blocking for checkpoint but must become a requirement at any future implementation-plan/harness gate before live use.

Do not implement it now.

## Handoff state

Ensure the handoff states:
- package accepted for checkpoint
- 0 C / 0 H / 0 M / 1 L
- SC-C03 blocker closed
- tests/results above
- verdict B remains `prepared, currently not worthwhile`
- live diagnostic remains unauthorized
- OD recommendations remain deferred
- manifest-identity Low deferred to future implementation-plan/harness gate
- historical G2/C6/C8/T4 unchanged

Do not add the future commit hash before the commit exists.

## Commit

Stage only the reviewed package/reviews/prompts/handoff.

Inspect staged list/diff.

Create exactly one checkpoint commit, e.g.:
`checkpoint G2 future live-diagnostic design preparation`

After commit verify no protected path or authorization semantics changed.

## Push

Push the single commit to `origin/main`.

After push verify:
- `main == origin/main == <new commit>`
- ahead/behind 0/0
- tracked tree clean
- harness/procedure hashes unchanged
- immutable evidence unchanged
- D2/diagnostic checkpoints unchanged
- G2/C6/C8/T4 unchanged

## Working tree cleanliness

List any remaining untracked files.

Target state: completely clean working tree.

Do not leave durable Markdown/package artifacts untracked.

## Prohibited

Do not:
- run Viewer/browser/live diagnostic
- retry G2
- issue/reset authorization
- modify real harness/product/procedure
- modify T4/C6/C8 runtime behavior
- mutate immutable evidence
- start G3
- start implementation-plan/harness work

## Stop gate

Stop after one commit, one push, and post-push verification.

Next gate:

**Separate owner decision on whether to stop live-diagnostic work or authorize a future implementation-plan / authorization-format design package only.**

## Final report

Report:
- new commit hash
- exact files committed
- push result
- final main/origin relation
- package/D2/diagnostic/offline test results
- retained hashes
- final git status
- remaining untracked files
- harness/procedure hashes
- immutable evidence unchanged
- D2/diagnostic checkpoints unchanged
- historical G2/C6/C8/T4 unchanged
- SC-C03 accepted-state confirmation
- deferred manifest-identity Low confirmation
- confirmation no live/retry/new record/reset occurred
- exact next gate
