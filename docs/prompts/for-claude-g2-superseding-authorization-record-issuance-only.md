# For Claude — G2 Superseding Authorization-Record Issuance Only

I explicitly authorize **one bounded G2 authorization-record preparation / issuance task only**, bound to the new committed activation baseline.

This authorization does **not** include attempt reservation/consumption, Viewer/fixture loading, or live G2 execution.

Use the repository as the source of truth.

## Baseline
Verify:
- `main == origin/main == 8a8d49f6293e9be1bd858ed76ad991319c1e9f8c`
- tracked tree clean
- only untracked file is the old historical record
- harness SHA `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`
- procedure SHA `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- `LIVE_PATH_WIRED=true`
- `G2_DUAL_COUNTER_GATE.resolved=true`
- no attempts directory/state
- no Viewer/fixture/live evidence

Old record:
- ID `g2-live-20261004-dbd97137`
- path `docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-dbd97137.md`
- SHA `0f339d964794ceb54d84e3a3c13d1655cce6aac2b9796cf4c4deb3c243baa4ae`
- bound HEAD `dbd97137a53890c43a5b89010a73f3dc39f0dc67`
- historical only; not valid for current HEAD

## Runtime
Select and verify:
- `nvm use 22.23.1`
- `node -v` => `v22.23.1`
- playwright `1.62.1`
- playwright-core `1.62.1`
- headless-shell revision `1234`
- version `151.0.7922.34`

## Recompute identities
From repo state, recompute:
- HEAD
- harness SHA
- procedure SHA
- Model A URN + SHA
- Model B URN + SHA
- runtime envelope
- any accepted record-schema identities

Do not invent missing IDs/digests.

## Preserve old record
Recompute old record SHA and confirm unchanged.
Do not edit, rename, move, delete, stage, or commit it.

## Critical supersession/discovery check
Before writing a second real record, inspect actual discovery logic and accepted procedure.

Determine how discovery handles:
- multiple marked records
- superseded records
- `Supersedes:` metadata
- active/inactive status
- archive locations
- sole-candidate ambiguity

### Hard stop
If both old and new marked files would remain active candidates, **do not issue a second real record**.

Do not assume free-text `Supersedes: g2-live-20261004-dbd97137` deactivates the old record unless code/procedure explicitly supports it.

If no supported supersession mechanism exists, stop and report.

## Prepare replacement
Only if supersession is natively supported:
- use a new authorization ID
- bind new HEAD `8a8d49f6293e9be1bd858ed76ad991319c1e9f8c`
- bind harness/procedure/fixture/runtime identities
- preserve single-use semantics
- include `Supersedes: g2-live-20261004-dbd97137` only if supported/tolerated by accepted schema

Prepare first in memory/scratch, not in production discovery path.

## Recheck clean tree
Before issuance:
- tracked tree clean
- only allowed untracked files
- old historical record in supported non-active state/location if required
- no attempts directory
- no live evidence

Do not weaken rules.

## Issue exactly one active record
Only if all gates pass and exactly one active candidate will exist afterward.

Do not create backups/alternate candidates in the active discovery directory.

## Static verification only
After issuance:
- reread bytes
- compute new record SHA
- verify HEAD/harness/procedure/fixture/runtime bindings
- verify new ID
- verify supersession linkage if supported
- verify exactly one active candidate
- verify old record bytes unchanged
- verify no attempt/reservation/live state

Do not run the real harness.

## Focused internal review
Review:
- supersession semantics
- active-candidate uniqueness
- historical preservation
- clean-tree compliance
- identity/runtime/schema bindings
- accidental attempt-consumption risk

Classify Critical/High/Medium/Low.
If implementation/procedure changes would be required, stop and report.

Persist review under `docs/reviews/`.
Update `docs/handoffs/latest.md` only after determining success/block.

## Handoff
If success, record:
- current HEAD/hashes/runtime
- old ID/path/SHA and historical/non-active disposition
- new ID/path/SHA
- supersession relationship
- exactly one active candidate
- no attempt/live activity
- next: independent Work verification of new record

If blocked, record exact blocker and confirm no new real record was written.

## Prohibited
Do not:
- reserve/consume attempt
- run real harness
- launch browser/Viewer
- load fixtures
- run live G2
- commit/push
- mutate/delete old record

## Stop gate
Stop after supersession verification, optional issuance, static verification, internal review, and handoff update.

Next gate after successful issuance:
**Independent Work verification of the superseding authorization record → explicit owner authorization of exactly one live G2 execution**
