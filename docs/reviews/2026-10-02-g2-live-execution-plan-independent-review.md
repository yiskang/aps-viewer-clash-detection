# G2 live-execution plan — independent review

- **Date:** 2026-10-02
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Baseline:** `main` @ `996305c3efc30021180e04099e6007cc1d9afa5f` (`main == origin/main`)
- **Subject:** [`docs/research/2026-10-02-g2-live-execution-plan.md`](../research/2026-10-02-g2-live-execution-plan.md)
- **Governing procedure:** [`docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md`](../research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md), SHA-256 `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- **Dormant harness:** `test/acceptance/clashpanel-viewerbridge.acceptance.mjs`, SHA-256 `0df40907b054811e34fe7dc55ae166a3f0be34519991193ce28c8ff8d5ce3649`
- **Result:** **0 Critical / 1 High / 1 Medium / 4 Low**
- **Verdict:** the execution plan is **not ready for owner acceptance or checkpoint commit as written**. The plan needs a bounded correction; the dormant harness then needs two bounded before-activation corrections. Live activation, authorization-record issuance, attempt reservation and live execution remain unauthorized.

## 1. Verified repository state and bindings

- `main == origin/main == 996305c3efc30021180e04099e6007cc1d9afa5f`.
- The working tree contains only the planning/review set: modified `docs/handoffs/latest.md`; untracked planning prompt, plan, internal review and this independent review. No production, procedure, harness or test file is modified.
- `G2_DUAL_COUNTER_GATE.resolved=true`; `LIVE_PATH_WIRED=false`.
- No G2 attempts directory, authorization record, live result or live evidence exists. No Viewer or fixture was loaded by this review.
- The procedure and dormant-harness hashes above match the files on disk. `package.json`, `package-lock.json`, the listed focused-test hashes, and both fixture URN hashes were independently recomputed and match the plan.
- Model A `Audubon_Mechanical_clash_test.rvt` is bound by committed URN constant and SHA-256 `db7efe5c237b10757c8e69fbb925facd9a1bf43c307a60702ae42fa2968dd10d`; Model B `Audubon_Structure_clash_test.rvt` is bound by committed URN constant and SHA-256 `806f99964bb937085874557ec2b03101a612db26031469a063446796d7ebb53d`.

The Model A identity disposition is adequate for the accepted contract: the authorization record binds the exact committed URN string through a deterministic digest, and the harness re-derives that digest from its committed constant. No repository evidence supplies a source-object byte digest, derivative manifest digest or ETag, so the plan correctly does not invent one. This proves requested URN identity, not immutable APS object/derivative content; runtime load, format classification and script-integrity gates provide the accepted live evidence.

## 2. Findings

### High H1 — an indeterminate cleanup failure can be committed as `PARTIAL`, contrary to the accepted procedure

The procedure's verdict table allows row 7 `PARTIAL` only when a cleanup step failed **and ownership resolved on re-check**. The harness does not mechanically enforce that condition:

- `runCleanup()` records `failure.ownership='indeterminate'` when there is no ownership probe or when the probe throws, but leaves `cleanupUnresolvedOwnership=false`.
- the real `closeContext` cleanup step has no `ownershipRemains` probe;
- `evaluateOverallRows()` adds row 7's `cleanup-step-failed-ownership-resolved` for every non-empty `cleanupFailures` array whenever earlier rows do not match; it does not require every failure's ownership to equal `resolved`;
- the cleanup tests explicitly assert that indeterminate ownership leaves `cleanupUnresolvedOwnership=false`.

Concrete failure mode: `closeContext` times out or throws, its ownership is recorded as `indeterminate`, no earlier row necessarily matches, and the harness can create an authoritative `PARTIAL` K even though the procedure permits only `FAIL` for unresolved ownership or `PARTIAL` after a successful resolution re-check. This is a reachable verdict-contract contradiction, not merely missing diagnostics.

The plan identifies G-8/G-14 but still permits “resolution or explicit adjudication” before activation. Mere owner adjudication cannot make the current harness produce a procedure-valid verdict. Minimum correction:

1. Change the plan to require **mechanical conformance before activation**, not acceptance of the divergence.
2. In the activation-preparation harness change, make any failed cleanup step with `ownership:'indeterminate'` fail closed as unresolved, or add a reliable context liveness probe and still treat an unavailable/throwing probe as unresolved.
3. Make row 7 require that every cleanup failure has `ownership:'resolved'`.
4. Add focused tests for `closeContext` timeout/throw, missing/throwing probes, and the row-2/row-7 boundary.

The accepted procedure does not need to change if the harness is corrected to conform. If the owner instead wants `PARTIAL` for indeterminate ownership, that is a procedure change requiring explicit amendment, re-acceptance and a new procedure SHA—not a planning disposition.

### Medium M1 — the proposed exact runtime envelope is recorded incompletely and is not mechanically gated

The accepted hard gates already cover the Viewer asset identity (`viewer3D.js` SHA), fixture URNs, initializer literals through the harness SHA, and OTG/SVF2 classification. The proposed plan additionally names exact Node `v22.23.1`, Playwright `1.62.1` and Chromium `151.0.7922.34`, but the harness only records those values and never compares them with the proposed pins. A run on different versions can therefore still produce K=`PASS`.

The plan also says OS is “recorded only”, but R1's current `runtimeEnvelope` has no OS/platform/filesystem fields. Exact macOS 27.0.1 therefore is not durable machine evidence at all.

Minimum correction:

- require exact Node, Playwright and Chromium comparisons as activation-preparation preflight gates bound by the activated harness SHA; mismatch or unavailable version must fail before model loading and cannot be PASS-compatible;
- keep Viewer `7.124.2` bound by the existing verified script digest rather than trusting the constant `runtimeEnvelope.viewerVersion` alone;
- treat macOS/arm64/local-APFS as an explicit operator precondition/attestation for the accepted local-POSIX D2 assumption, not as a mechanically recorded R1 pin, unless the procedure/schema is deliberately expanded;
- clarify that `PORT` is operational configuration, not an evidence-semantic pin.

This is harness/test work before activation, not a Core, Adapter, Panel-production, OQ-1 or host change. It does not require an authorization-record schema expansion if the exact expected versions are constants bound by the final harness SHA.

### Low findings

1. **L1 — authorization metadata:** the schema has no issuance timestamp, expiry or explicit record-schema version. This does not break single-use safety: exact HEAD/procedure/harness/fixture hashes, sole-candidate selection, unique ID and `Supersedes` provide freshness and revocation. Adding these fields is optional; a procedure/schema change is not justified solely for this run.
2. **L2 — authorization-record TOCTOU:** W1 reads/hashes the record, but the bytes are not re-hashed after validation before reservation. Local ownership and the retained record SHA make this low risk, but the file should not be edited once issued. A later hardening pass may retain the validated bytes or re-hash immediately before W2b.
3. **L3 — fixed R1–R3 names:** a future run can overwrite the fixed result/summary/manifest names. For the one current G2 gate this is acceptable only with the plan's mandatory immediate archival of R1–R3 plus ID-scoped reservation/journal/K/F and the authorization record before any later separately authorized attempt.
4. **L4 — cleanup timing plumbing:** `closePage` combines its final drain and close under one outer cleanup deadline, and `TABLE_T.T8.closeTimeoutMs` is unused. This is fail-safe rather than false-PASS-producing, but it can cause conservative failure and should remain recorded as non-blocking timing debt.

## 3. Attempt, preflight and crash semantics

The plan correctly describes the source order:

`W0 activation → W1 record/startup validation → W2a directories → W2b exclusive reservation + AUTH_BOUND → Phase 0 → W3 ATTEMPT_CONSUMED → first model RPC`.

- A surviving reservation spends the authorization record. `ATTEMPT_CONSUMED` distinguishes model-execution consumption but does not make an earlier Phase-0 failure reusable.
- A Phase-0 failure writes `PREFLIGHT_FAILED`, remains `consumed:false`, exits non-zero and still requires a fresh authorization ID for any later attempt.
- Reservation/journal files are never deleted; startup rejects earlier artifacts, same-record digests, orphan temps and ambiguous records.
- Crash states and incomplete/corrupt closeout classify fail closed. The read-only repository command was independently executed with a nonexistent review ID and returned `FAIL(no-run)` without creating artifacts.

A separate non-consuming `--check` mode is **not required** for this gate. It would create a second execution path that itself needs design, testing and binding. The appropriate contract is the existing manual/read-only precheck followed by one authorized attempt whose browser/CDN/credential/fixture preflight may spend the record. This risk must be explicit in the owner authorization.

## 4. Activation safety and test migration

The current one-line `LIVE_PATH_WIRED=false → true` switch is an adequate activation mechanism; no second build flag is necessary because live reachability already requires all of:

- compiled source flag;
- exact CLI flag;
- exact environment value;
- a valid sole authorization record;
- durable reservation and journal.

The plan correctly treats the activation change as a separate, reviewable commit and identifies the unsafe current CLI test. Once the source flag is true, that test's real harness invocation could pass W0/W1 and spend a real record. Before the activation checkpoint is accepted:

- every test that pins/replaces `LIVE_PATH_WIRED=false` must be migrated deliberately;
- real-main/CLI tests must execute only a mutated copy or isolated temporary repository whose authorization path cannot resolve to the real record;
- the future record must not use `docs/prompts/g2-live-authorization.md`;
- no aggregate test command may run while an issued candidate record exists under `docs/prompts/`.

These are mandatory activation-preparation acceptance criteria. They do not justify combining activation, record issuance and live execution into one task.

## 5. Authorization-record schema and command binding

The current schema is mature enough for a future owner to authorize **record creation as a separate task** after the activated clean checkpoint exists. Required bindings are sufficient:

- unique `Authorization-ID`, exact final `Baseline-HEAD`;
- accepted procedure SHA and final activated harness SHA;
- both fixture URN SHA-256 values;
- exact Viewer/env/api Runtime line;
- sole non-superseded candidate and optional explicit supersession.

The live command does not need its own record field: the final harness SHA plus the fixed CLI/env/record-path interlock binds the only reachable live entrypoint. `issuedAt`, `expiresAt` and a record version would improve audit ergonomics but are not required for this exactly-one local attempt.

Record creation must not happen until the plan is corrected, the cleanup/runtime harness changes and activation/test migration are independently accepted and committed, the tree is clean, and final HEAD/harness digests are recomputed. Creating the record does not itself authorize executing it.

## 6. Evidence and verdict durability

The evidence plan is sufficient for the current one-attempt gate once H1 is corrected:

- ID-scoped reservation/journal bind the authorization and lifecycle state;
- R1 is the complete result payload, R2 is derived summary, and R3 hashes the evidence set;
- only synchronous `linkSync(Kc,K)` after the pre-link gate can create verdict-authoritative K;
- F or missing/corrupt/inconsistent artifacts force reader `FAIL`;
- R1–R3 fixed names are acceptable only with immediate durable archival before any future attempt;
- failed-run closeout retains the root failure and produces schema-valid R1/R2/R3/K when closeout succeeds.

No additional production-module digest is required: the exact final Git HEAD binds repository modules, the served-module manifest records the actual served graph, and R1 retains the page-agent SHA. The plan correctly treats raw stdout as non-authoritative.

## 7. Verification

Independent non-live verification on the stated baseline:

- focused G2 suite: **818/818 pass**;
- aggregate offline suite: **5,064 total / 5,063 pass / 0 fail / 1 existing todo**;
- real local Playwright binding suite: **8/8 pass**;
- activation / authorization / preflight / journal / CLI / gate: **11 / 26 / 7 / 35 / 5 / 19**, all pass;
- `git diff --check`: clean;
- exact reader dry-validation: `FAIL(no-run)`, journal class `NOT_STARTED`, no files created.

The tests confirm the current dormant implementation; they do not resolve H1 because the cleanup tests currently encode the contradictory indeterminate-ownership behavior.

## 8. Readiness and authorization

- **Planning-document commit readiness:** **no, as written.** First make a bounded plan-only correction that removes “explicit adjudication” as a sufficient G-8 outcome and requires exact Node/Playwright/Chromium preflight gating during activation preparation.
- **Activation-preparation readiness:** technically well-scoped after the corrected plan is accepted and the owner separately authorizes it. Required work: H1 cleanup/verdict conformance, M1 runtime gates, activation flag/test migration, unsafe-CLI isolation, focused/offline/binding verification, final independent review, and recomputation of final HEAD/harness hashes.
- **Authorization-record preparation:** schema is technically sufficient, but issuance is premature until the activated checkpoint is accepted, committed and clean. Issuance and execution must remain separate owner gates.
- **Live execution readiness:** **no.** No record may be issued and no attempt may be reserved until the two blockers above are closed and independently accepted.
- **Dependencies:** no production/Core/Viewer Adapter/Panel-production/M4/OQ-1/host dependency appeared. All required correction is confined to the planning document and dormant G2 harness/tests.

## 9. Exact next authorized action

No implementation action is authorized by this review. The next action requiring owner authorization is a **bounded plan-only remediation**:

1. make G-8 mechanical harness conformance—not owner acceptance of the contradiction—a prerequisite to activation;
2. require exact Node/Playwright/Chromium hard preflight gates in the future activation-preparation change;
3. preserve the current separation of activation, record issuance and exactly-one live execution;
4. submit only those changed plan areas and the handoff for targeted independent re-review.

Commit, push, harness edits, activation, authorization-record issuance, reservation/consumption, Viewer launch and live G2 remain unauthorized.
