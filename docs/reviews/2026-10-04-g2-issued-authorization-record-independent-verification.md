# G2 issued authorization record — independent verification

- **Date:** 2026-10-04
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Committed baseline:** `main == origin/main == dbd97137a53890c43a5b89010a73f3dc39f0dc67`
- **Issued record:** `docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-dbd97137.md`
- **Authorization ID:** `g2-live-20261004-dbd97137`
- **Verdict:** the record is technically valid, uniquely discoverable, and unspent, but the current repository tree is not Phase-0 eligible. Live execution is not ready.

## Findings

### Critical

None.

### High

None.

### Medium

#### M1 — valid record, ineligible tree, and a governance/reissuance sequencing loop

The current record correctly binds committed HEAD `dbd97137...`, but the tracked handoff modification and untracked review files are blocking paths under `classifyGitTreeState()`. If the real harness were invoked now, W1 and W2 would succeed, `AUTH_BOUND` would durably spend this record, and Phase 0 `git-tree` would then fail before `ATTEMPT_CONSUMED` or model loading. No retry would be permitted with this record.

This is a live-readiness blocker, not a record-schema defect. It remains Medium because the system fails closed, no attempt/live state exists, and the issue is known before execution.

The same problem will recur if a replacement record is issued and the issuance/verification task again modifies tracked `docs/handoffs/latest.md` or creates untracked `docs/reviews/` files afterward. A future owner authorization must therefore define a terminal sequencing rule: after the final replacement record is issued, no tracked/disallowed path may change before the live attempt. Any required post-issuance verification artifact must be handled through an explicitly authorized Phase-0-allowed mechanism or deferred until after the attempt. This review does not choose or authorize that governance exception.

### Low

#### L1 — stale pre-activation prose

Some plan/header and harness comments still describe `LIVE_PATH_WIRED=false`, although committed runtime source is `true`. This is non-executable narrative and does not affect record parsing, W1, or the live gate.

#### L2 — issuance prompt is an extra allowed untracked prompt file

`docs/prompts/for-claude-g2-authorization-record-issuance-retry-only.md` is untracked, but it contains no line beginning `G2-LIVE-EXECUTION:`. It is therefore not a candidate and is allowed by the Phase-0 untracked-prefix rule. It does not create ambiguity.

## 1. Record bytes and schema

The record is a regular ASCII/UTF-8 `.md` file under the production discovery directory. Its independently recomputed SHA-256 is:

`0f339d964794ceb54d84e3a3c13d1655cce6aac2b9796cf4c4deb3c243baa4ae`

This exactly matches the issuance record and proves no post-issuance byte mutation at review time.

Each required marker appears exactly once:

1. `G2-LIVE-EXECUTION`
2. `Authorization-ID`
3. `Baseline-HEAD`
4. `Procedure-SHA256`
5. `Harness-SHA256`
6. `Model-A-URN-SHA256`
7. `Model-B-URN-SHA256`
8. `Runtime`

There is no `Supersedes` marker and no invented timestamp, expiry, or version field. The issuance scope note begins with ordinary text, not any recognized marker key. `parseAuthorizationMarkers()` ignores it, so the note is harmless and compatible with the accepted parser.

## 2. Bound identities

All record values were recomputed from the current committed repository rather than copied from conversation:

| Binding | Record / actual value | Verdict |
|---|---|---|
| Baseline HEAD | `dbd97137a53890c43a5b89010a73f3dc39f0dc67` | match; `HEAD == main == origin/main` |
| Harness SHA-256 | `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4` | match |
| Procedure SHA-256 | `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75` | match and accepted |
| Model A URN SHA-256 | `db7efe5c237b10757c8e69fbb925facd9a1bf43c307a60702ae42fa2968dd10d` | match to committed literal |
| Model B URN SHA-256 | `806f99964bb937085874557ec2b03101a612db26031469a063446796d7ebb53d` | match to committed literal |
| Runtime marker | `viewer=7.124.2 env=AutodeskProduction2 api=streamingV2` | exact accepted line |

The harness hash also binds the hard runtime constants: Node `v22.23.1`, `playwright`/`playwright-core` `1.62.1`, and headless-shell revision `1234` / version `151.0.7922.34`. Those installed versions were independently confirmed. The default shell remains Node `v26.10.0`; a future operator must explicitly select exact Node `v22.23.1`.

The fixed first marker, unique ID, exclusive per-ID reservation, startup scan, and record-byte hash carried into reservation/journal provide the reviewed exactly-one-attempt and single-use semantics. Command identity remains the fixed W0 flag/environment/path interlock, not a record field.

## 3. Discovery and uniqueness

The implementation recursively scans regular `*.md` files under `docs/prompts/`, never follows symlinks, and treats a file as a candidate only if a line begins `G2-LIVE-EXECUTION:`. The filename itself has no special semantic.

Exactly one candidate currently exists: the issued record. No stale or superseded candidate exists, and no unsupported `g2-live-authorization.md` filename rule has been reintroduced. Sole-candidate semantics are satisfied.

## 4. No attempt or live state

The configured `test/acceptance/results/clashpanel-viewerbridge-g2-attempts/` directory is absent. There is no reservation, journal, `AUTH_BOUND`, `ATTEMPT_CONSUMED`, consumed attempt, or live result/evidence artifact.

Repository evidence and the issuance diff support record-only issuance: no harness, Viewer, fixture, or browser evidence exists. A transient external process launch cannot be proven absent from repository bytes alone, but no retained state indicates one and the authorized issuance workflow did not require one.

## 5. W1, spend, and Phase-0 ordering

Graph tracing and direct source verification establish:

1. W0 parses the exact activation interlock.
2. W1 validates the passed record, candidate set, HEAD, procedure/harness hashes, fixture hashes, and startup state using reads only.
3. Hard runtime gates run before any attempt directory or reservation.
4. W2 creates the exclusive reservation and durable `AUTH_BOUND`; this spends the record.
5. Phase 0 then checks harness bytes and Git tree before Playwright import/browser launch; only after all Phase-0 steps does W3 write `ATTEMPT_CONSUMED` before model loading.

A Phase-0 dirty-tree failure therefore produces `PREFLIGHT_FAILED` best-effort, leaves `consumed:false`, spends the record, and permits no retry with that record.

Focused offline tests under exact Node `v22.23.1` passed **79/79** for activation, authorization, preflight, and journal behavior. No real harness or live path was invoked.

## 6. Exact current dirty-tree state

Before this independent review was written:

- `M docs/handoffs/latest.md` — blocking;
- `?? docs/reviews/2026-10-04-g2-authorization-record-issuance-internal-review.md` — blocking;
- `?? docs/prompts/for-claude-g2-authorization-record-issuance-retry-only.md` — allowed;
- `?? docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-dbd97137.md` — allowed.

This independent review adds another blocking untracked `docs/reviews/` path and updates the handoff as explicitly required. Phase 0 would reject the resulting tree.

The current record is therefore **valid but not presently executable**. It is not stale or invalid while HEAD remains `dbd97137...`; the repository state prevents safe use.

## 7. Remediation options

### Option A — preserve current HEAD and record

Technically, reverting the handoff and removing/relocating the review artifacts would leave only allowed untracked `docs/prompts/` files and make Phase 0 eligible without changing the record binding.

This is not recommended. `CLAUDE.md` requires substantial independent reviews under `docs/reviews/` and a current durable handoff. Reverting or relocating them would remove the repository's collaboration authority and violate the established governance boundary. Temporary stash/external-only preservation has the same defect.

### Option B — checkpoint governance docs and reissue

This is the recommended path. Commit and push the issuance prompt, internal review, this independent review, and handoff in a separately owner-authorized docs-only checkpoint. Do not commit or mutate the current authorization record. The checkpoint changes HEAD, so the current record must not be used afterward.

Then, under another explicit owner authorization, issue a new record with a new authorization ID and new `Baseline-HEAD`. The procedure supports preserving the current record unchanged and having the new record contain:

`Supersedes: g2-live-20261004-dbd97137`

That keeps the historical record as evidence while leaving exactly one non-superseded candidate. Deleting the old record is unnecessary. If deletion is preferred, it is destructive and requires explicit owner authorization.

Before final reissuance, the owner must also resolve M1's terminal sequencing rule so issuance/verification does not immediately recreate tracked/disallowed dirt and repeat this cycle.

## 8. Internal-review adjudication

The internal review's `0 Critical / 0 High / 1 Medium / 2 Low` classification is supported:

- M1 remains Medium and blocks present execution;
- stale activation prose remains a non-blocking Low;
- the extra issuance prompt is allowed and non-candidate, so it remains a Low operational observation.

No elevation is required because every unsafe path fails closed before attempt consumption/model load. No downgrade is warranted because invoking the current record would irreversibly spend it.

## Final disposition

- **Record-byte/hash:** valid, exact match.
- **Schema:** valid eight-required-marker record; free-text note harmless.
- **Bound identities:** all match committed source and accepted runtime contract.
- **Discovery:** sole valid candidate; no ambiguity.
- **Attempt/live state:** absent; record unspent.
- **Technical validity:** valid.
- **Present executability:** blocked by the dirty tree.
- **Live readiness:** not ready and not authorized.

**Recommended next authorized action:** authorize one docs-only checkpoint commit/push containing the governance artifacts but excluding and preserving the current untracked authorization record. After that checkpoint, separately authorize a new superseding record against the new HEAD with a terminal clean-tree sequencing rule. Do not authorize live G2 until that replacement record has been verified without recreating a Phase-0-blocking tree.
