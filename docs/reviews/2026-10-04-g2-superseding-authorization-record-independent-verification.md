# G2 superseding authorization record — independent verification

- **Date:** 2026-10-04
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Committed baseline:** `main == origin/main == 8a8d49f6293e9be1bd858ed76ad991319c1e9f8c`
- **Active record:** `g2-live-20261004-8a8d49f6`
- **Verdict:** the superseding record is technically valid, unspent, and the sole active candidate. The current tree remains ineligible for Phase 0. A terminal clean-window governance rule is required before another checkpoint/reissue can lead to live execution.

## Findings

### Critical

None.

### High

#### H1 — mandatory post-issuance repository writes systematically prevent a record from reaching live readiness

This is the second consecutive issuance in which the required internal review and handoff update made the tree Phase-0-ineligible immediately after a valid record was issued. The issuance prompts require those repository writes, while `classifyGitTreeState()` permits only untracked `docs/prompts/` entries. Running now would durably create `AUTH_BOUND`, spend the record, and then fail `git-tree` before `ATTEMPT_CONSUMED` or model loading.

The repeated behavior proves a sequencing contradiction rather than a one-off dirty-tree condition. The internal review's Medium classification is therefore elevated to High: the system remains fail-closed, but the currently mandated workflow cannot reach the live gate without either discarding durable governance artifacts or explicitly authorizing a bounded terminal clean window.

Minimum correction: before the final record is issued, commit/push every tracked governance artifact and record a repository-governance exception that, between final issuance and the one live attempt, verification is read-only and creates no tracked/disallowed repository files. The verification result and live evidence are persisted immediately after the attempt. No G2 harness or accepted-procedure change is required.

### Medium

None.

### Low

#### L1 — marker-prefix discovery remains intentionally fragile

Any other regular `docs/prompts/**/*.md` file containing a line beginning `G2-LIVE-EXECUTION:` becomes a candidate. A quoted/example marker at column zero could therefore make discovery malformed or ambiguous. Current prompt files avoid that prefix, so this is non-blocking.

#### L2 — stale pre-activation narrative remains

Some plan/header and harness comments still describe `LIVE_PATH_WIRED=false`. Committed executable state is `true`; the stale prose does not affect parsing, supersession, or runtime gates.

## 1. Repository and record identities

Verified before writing this review:

- branch `main`;
- `HEAD == main == origin/main == 8a8d49f6293e9be1bd858ed76ad991319c1e9f8c`;
- harness SHA-256 `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`;
- accepted procedure SHA-256 `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`;
- `LIVE_PATH_WIRED=true`; `G2_DUAL_COUNTER_GATE.resolved=true`.

Both records were reread from disk:

| Record | SHA-256 | Status |
|---|---|---|
| `g2-live-20261004-dbd97137` | `0f339d964794ceb54d84e3a3c13d1655cce6aac2b9796cf4c4deb3c243baa4ae` | byte-identical, historical, superseded |
| `g2-live-20261004-8a8d49f6` | `b520bc712fbf85ad848a234e0472c3f6da9f0fa724c9fe8682c657dc759db461` | byte-identical, current active record |

## 2. New-record schema and bindings

The new record contains each required marker exactly once plus exactly one supported optional marker:

- `Supersedes: g2-live-20261004-dbd97137`.

`Supersedes` is part of `AUTHORIZATION_MARKERS`, is parsed as a repeatable optional ID, and is not a free-text convention. The ordinary issuance note does not begin with a marker key and is ignored safely.

All bindings match independently recomputed repository state:

| Binding | Verified value |
|---|---|
| Baseline HEAD | `8a8d49f6293e9be1bd858ed76ad991319c1e9f8c` |
| Harness SHA-256 | `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4` |
| Procedure SHA-256 | `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75` |
| Model A URN SHA-256 | `db7efe5c237b10757c8e69fbb925facd9a1bf43c307a60702ae42fa2968dd10d` |
| Model B URN SHA-256 | `806f99964bb937085874557ec2b03101a612db26031469a063446796d7ebb53d` |
| Runtime marker | `viewer=7.124.2 env=AutodeskProduction2 api=streamingV2` |

The harness hash binds exact Node `v22.23.1`, `playwright`/`playwright-core` `1.62.1`, and headless-shell revision `1234` / version `151.0.7922.34`. These installed prerequisites match. The default shell remains Node `v26.10.0`; a live operator must explicitly select exact Node `v22.23.1`.

Single-use semantics remain the fixed first marker, unique ID, exclusive reservation, record-byte hash binding, startup scan, and no-retry state machine.

## 3. Native supersession and discovery

Direct source inspection and a read-only invocation of exported `validateAuthorizationRecord()` confirmed the production behavior:

- every regular recursive `docs/prompts/**/*.md` file with a line starting `G2-LIVE-EXECUTION:` is parsed as a candidate;
- every ID named by another candidate's `Supersedes:` marker enters `supersededIds`;
- a superseded record is rejected with `record-superseded` when passed;
- active selection requires exactly one non-superseded candidate and that candidate must be the passed record;
- multiple active candidates fail closed as `candidate-set-ambiguous`.

Observed candidate set:

1. new `g2-live-20261004-8a8d49f6`: `superseded=false`, validation `ok:true`;
2. old `g2-live-20261004-dbd97137`: `superseded=true`, direct validation `record-superseded`.

No third candidate exists. The old file can remain physically present and unchanged.

## 4. No attempt or live state

The configured attempts directory `test/acceptance/results/clashpanel-viewerbridge-g2-attempts/` is absent. No reservation, journal, `AUTH_BOUND`, `ATTEMPT_CONSUMED`, consumed attempt, Viewer/fixture-load evidence, or live result exists.

Repository evidence supports record-only issuance. No retained repository evidence indicates browser or Viewer activity. A transient external process launch cannot be proven absent solely from disk, but neither issuance nor this review invoked the live harness.

## 5. W1, reservation, Phase 0, and consumption

Graph tracing and direct source verification establish the accepted order:

1. W1 validates record discovery, supersession, HEAD, hashes, fixture identities, and startup state.
2. Exact hard runtime gates run before filesystem reservation.
3. W2 creates the attempts chain, exclusive reservation, and durable `AUTH_BOUND`; the record is now spent.
4. Phase 0 rechecks harness bytes and Git tree before Playwright import/browser launch.
5. Only after Phase 0 succeeds does W3 durably write `ATTEMPT_CONSUMED`, followed by model loading.

With the current dirty tree, the new record would be valid at W1 and become spent at W2, then Phase 0 would fail. The attempt would remain unconsumed, and the record could not be retried.

Focused offline activation/authorization/preflight/journal verification passed **79/79** under exact Node `v22.23.1`. No live entry point ran.

## 6. Exact dirty-tree classification

Before this independent review was written:

- `M docs/handoffs/latest.md` — blocking;
- `?? docs/reviews/2026-10-04-g2-superseding-authorization-record-issuance-internal-review.md` — blocking;
- `?? docs/prompts/for-claude-g2-superseding-authorization-record-issuance-only.md` — allowed;
- both untracked authorization records under `docs/prompts/` — allowed.

This independent review adds another blocking `docs/reviews/` path and updates the already modified handoff. `classifyGitTreeState()` allows an entry only when it is untracked and its path begins `docs/prompts/`; all tracked modifications and untracked reviews block.

## 7. Terminal sequencing adjudication

### Pattern A — governance checkpoint first, terminal clean window after final issuance

This is the recommended pattern, with one explicit governance clarification. Before final issuance, persist and commit/push every prompt/review/handoff governing the run. Then issue the final record against that HEAD. From issuance until the attempt finishes, perform only read-only verification and create no tracked/disallowed repository file.

The temporary deferral of the post-issuance review/handoff write conflicts with the ordinary immediate-update rule in `CLAUDE.md`, so the owner must explicitly authorize and durably record this bounded terminal clean-window exception before final issuance.

### Pattern B — temporarily external verification

This is the practical verification channel inside Pattern A, not a separate complete solution. Independent verification may be retained in the Work conversation or a non-repository scratch artifact during the terminal clean window. It must be persisted under `docs/reviews/`, together with live evidence and the updated handoff, immediately after the one attempt ends.

Without the explicit governance exception, Pattern B alone violates the repository's durable collaboration convention.

### Pattern C — existing procedure-supported alternative

None was found. The accepted procedure intentionally allows only untracked `docs/prompts/`; it does not provide an allowed post-issuance review directory, handoff exception, or second clean worktree execution contract. Introducing any of those mechanically would require separate design/review authorization and is unnecessary if the bounded terminal clean window is accepted.

## 8. Current record lifecycle

The new record remains technically valid, active, and unspent at current HEAD. It could be used only if the blocking handoff/reviews were removed or relocated without changing HEAD. Doing so would discard or displace required repository governance artifacts and is not recommended.

Because this review must be persisted, the recommended path requires another docs checkpoint. That commit changes HEAD, so `g2-live-20261004-8a8d49f6` must then become historical and be superseded by one final record with a new ID and the new HEAD. The final record should name `Supersedes: g2-live-20261004-8a8d49f6`; the existing chain already leaves `g2-live-20261004-dbd97137` superseded.

Neither current record should be mutated or deleted. Record reissuance, checkpoint commit/push, and the terminal clean-window exception each require explicit owner authorization.

## 9. Internal-review adjudication

The internal review is correct on record hashes, native supersession, candidate uniqueness, bindings, absence of attempt state, and fail-closed behavior. Its dirty-tree concern is elevated from Medium to High because this is the second occurrence caused by mandatory workflow steps and no live-ready state is reachable under the current combined rules.

The internal L1 marker fragility remains Low. Its L2 reports that no accidental-consumption path was found rather than an actual defect; the carried stale-comment issue is the second Low recorded here.

## Final disposition

- **Old record:** hash correct; byte-identical; superseded and historical.
- **New record:** hash/schema/bindings correct; sole active candidate; valid and unspent.
- **Attempt/live state:** absent.
- **Current tree:** Phase-0 ineligible.
- **Implementation/procedure change:** not required.
- **Governance correction:** required—owner-approved terminal clean-window sequencing, recorded before final issuance.
- **Live execution:** not ready and not authorized.

**Recommended next authorized action:** authorize one docs-only terminal-sequencing checkpoint that persists the current prompt/reviews/handoff and records the bounded clean-window exception, while excluding and preserving both untracked records. After that checkpoint, separately authorize one final superseding record against the new HEAD. Do not authorize live execution until that final record receives read-only independent verification without any blocking repository write.
