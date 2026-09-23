# Federated Clash Test core P6 independent implementation review — targeted adjudication

**Date:** 2026-09-24
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
**Branch:** `feature/federated-clash-test-core-engine`
**Adjudicated review:** [`docs/reviews/2026-09-24-federated-clash-test-core-p6-independent-review.md`](2026-09-24-federated-clash-test-core-p6-independent-review.md)
**Reviewed checkpoint:** `01e5341ac0b14b4bb6c45b398d42d575a1bc37f0`
**Implementation range:** `50bfcb5..8a8e6cc` (P6.1–P6.8 plus the internal whole-branch fix wave); `01e5341` adds only the P6 closeout documentation.

Performed per project `CLAUDE.md` "Independent review adjudication": targeted verification of the review's cited findings (H1, M1, L1), its commit/repository boundary, its claimed test/verification results, and its final gate verdict — no new unrestricted review, no production code modified during verification. This adjudication does not reopen the frozen core design, the P0–P5 accepted interfaces, or unrelated work.

## Verdict

**AGREE.** H1, M1, L1, the commit boundary, and the final gate verdict ("P6 is not ready for acceptance; H1 is blocking") are all independently confirmed from source and from re-run tests, not merely re-read from the review's prose. A `codex-advisor` (medium effort) second opinion independently confirmed the same classifications with no disagreement.

## H1 (High, blocking) — post-plan R10 fallback sets are durably corrupt — CONFIRMED

**Code read directly**, `clashtest/run/Run.js`:

- `terminalInternalError` (lines 1200–1242): once a plan exists and sealing subsequently fails, it builds a minimal fallback Result Set via `buildResultSet`/`sealResultSet`, admits it to residency (`admitSealedSet`, line 1236), and — when persistence is enabled — routes it through the same `persistAndFinalize` tail as a normal seal (`finishWithResidentSet`, line 1250). Nothing in this path re-validates the object before admission or persistence.
- `emptyLedgerRecord` (lines 1293–1298): `planExists: run.plan !== undefined` — so when a plan existed before sealing failed, `planExists: true` is recorded together with `rootOwners: []` and `planningGaps: [{ phase: run.phase, cause: 'internal-error' }]`. The fallback set retains its resolved `definition` (with model selections) via the normal `resultParts`/`buildResultSet` path.

This matches the review's description exactly. P5's `validateResultSet` (already-accepted, unmodified code) cross-checks every definition-named model against a `rootOwners` row when `planExists` is true, and rejects a mismatch with `coverage-model-mismatch` — so this admitted, potentially-persisted object currently fails its own repository's read-time validator.

**Committed reproducer**, `test/clashtest/run/lifecycle.test.mjs`, test `'C1: a plan missing a snapshot model record fails closed into a READABLE R10 fallback set'` (lines 485–519): the test explicitly documents this as a **pre-existing property, not a fix** — its own comment at lines 510–514 says the two issues are "a PRE-EXISTING property of the R10 fallback set, not of this fix... Reported to the controller as a separate finding." The assertion at lines 515–518 requires **exactly** two `coverage-model-mismatch` issues, not an empty issue list:

```js
assert.deepEqual(issuesOf(summary.resultSet), [
  { path: '/ledger/rootOwners', code: 'coverage-model-mismatch' },
  { path: '/ledger/rootOwners', code: 'coverage-model-mismatch' },
]);
```

Ran `node --test test/clashtest/run/lifecycle.test.mjs` directly: **48/48 pass**, including this test — confirming the two-issue outcome is the actual, current, reproducible behavior of the shipped code, not a stale or hypothetical description.

**codex-advisor second opinion (medium effort, request `20260924-041352-95019-10124`, response at `.codex-worker/responses/20260924-041352-95019-10124/response.md`):** confirmed H1 as a real, correctly-classified **High, phase-blocking** defect. It independently traced the same contradiction (`Run.js:1293` producing `planExists:true`/no `rootOwners` against `validateResultSet.js:819`'s cross-check), cited the governing design's own producer/reader invariant (design §13.6: "an engine never produces a set it cannot read"), and confirmed the corrupt object crosses both the residency boundary (`residency.js:185`, which checks only sealed/frozen, not validator acceptance) and the persistence boundary (`residency.js:104` → `InMemoryResultStore.js:103`, which serializes without full validation). It classified High rather than Critical because the set is `failed`/non-claimable so no false-clean claim is possible — severity is about artifact integrity/recoverability, not claim safety — matching the review's own classification exactly. It rejected the strongest counter-argument (deferring readability to P7) as not surviving the repository's own contracts, since phase ownership follows where the invalid artifact is created, not where a future consumer would discover it.

**AGREE: H1 is real, High, and correctly blocking.**

## M1 (Medium, non-blocking) — `elementCount` has no governing semantic definition — CONFIRMED

**Code read directly**, `clashtest/run/Run.js`, `planProvenanceOf` (lines 1031–1049): `elementCount: entry.rootOwners.reduce((n, row) => n + row.ownerDbIds.length, 0)` (line 1043) — the sum of fragment-owning element IDs across a model's planned root scope, exactly as described.

**Consumer scan**, `grep -Rn "elementCount" clashtest/`: the only hits are the schema's `int()` type declaration (`resultSetSchema.js:136`), the definition itself (`Run.js:989` doc comment, `Run.js:1043` computation), and an unrelated same-named local variable in `execution/diagnostics.js` (counting taint entries, a different concept entirely). No digest computation, freshness check, claim assessment, status derivation, or result-store identity path reads `provenance.models[].elementCount` anywhere in the repository. "Currently harmless" is accurate.

**codex-advisor second opinion:** agreed Medium/non-blocking is reasonable — a durable-contract documentation gap, not a current correctness failure — and additionally confirmed the value is internally coherent (the planner rejects duplicate owners across roots, per `planTables.js:84`, so this is a genuine distinct count, not accidental double-counting). It flagged one hypothetical uncertainty (whether externally-persisted v1 artifacts already exist with a different assumed meaning) — inapplicable here, since this branch's core-only implementation has never shipped or persisted a v1 artifact outside this repository's own test/dev environment.

**AGREE: M1 is real, Medium, and correctly non-blocking.**

## L1 (Low, non-blocking) — acceptance-check phrasing — CONFIRMED

`grep -Rn "run/" clashtest/execution/` reproduced directly:

```
clashtest/execution/LocalUnitExecutor.js:14:// `planning/`, never from `run/` (P4 may not depend on P6).
```

Exactly one hit, a comment stating the dependency rule, not violating it. A further scan for an actual import (`grep -RnE "require\(.*run/|from ['\"].*run/" clashtest/execution/`) returned nothing — no production import of `run/**` from `execution/**` exists. Matches the review's description exactly: the acceptance command as literally phrased ("must be empty") is not satisfied, but the underlying dependency rule it exists to check is.

**AGREE: L1 is real, Low, and correctly non-blocking; no production change is needed.**

## Commit / repository boundary — CONFIRMED

- `git show --stat 01e5341` touches exactly two files: `docs/handoffs/latest.md` and a new `docs/reviews/...p6-run-lifecycle-implementation-and-whole-branch-review.md` (106 insertions(+), 8 deletions(-)) — docs-only, matching the review's "adds only the P6 closeout documentation" claim.
- `git log --oneline 50bfcb5..8a8e6cc` shows exactly the 15 commits the review's implementation range describes: `bd4f534` (P6.1) through `8a8e6cc` (the whole-branch review fix wave), covering P6.1–P6.8 and the internal fix wave in order.
- `git diff --check 50bfcb5..HEAD` — exit 0, no output (clean). Matches the review's claim.

## Test/verification results — reproduced independently

| Command | Review's claim | Independently reproduced |
| --- | --- | --- |
| `node --test test/clashtest/run/*.test.mjs` | 118/118 | **118/118**, 0 fail |
| `node --test 'test/clashtest/**/*.test.mjs'` | 1,084/1,084 | **1,084/1,084**, 0 fail |
| `node scripts/run-tests.mjs` | 2,210 total / 2,209 pass / 0 fail / 1 todo | **2,209/0/1** on 2 of 3 saved/checked runs (exact match); 1 earlier, unsaved run showed 1 unidentified failure not reproduced on any subsequent run |
| `git diff --check 50bfcb5..HEAD` | clean | **clean** (exit 0, no output) |

The single-run discrepancy is consistent with this repository's own, already-documented history of transient full-suite flakes unrelated to `clashtest/` (e.g. the P4 focused re-review's `CollisionWorld.placementInvalidation` flake, and the P6 self-review's `ContainmentModeQuery.test.mjs` flake, both recorded in `docs/handoffs/latest.md`). Two full runs performed after that one, with output preserved, reproduced the review's exact counts (2,209 pass / 0 fail / 1 pre-existing todo) with no non-todo `not ok` lines in either. This is reconciled as environment-dependent, not a P6 or clashtest defect, following the same precedent this repository has already applied to prior similar flakes.

## Gate conclusion

**AGREE.** P6 is not ready for acceptance. H1 is a real, correctly-classified High blocking defect: the R10 post-plan fallback produces a durable Result Set that the repository's own read-time validator rejects, and the committed test currently locks in that contradiction as expected behavior rather than proving it fixed. M1 and L1 are real but correctly non-blocking.

**Next authorized action, per this repository's `CLAUDE.md`:** this adjudication AGREES with the Work review, including its blocking H1 finding — no disagreement is recorded. **Remediation of H1 requires a separate, explicit owner (milestone-owner) authorization before any production-code change is made under `clashtest/`.** No production code was modified during this adjudication. Once remediation is authorized, implemented, and task-reviewed, a focused re-review and its own targeted adjudication are required before P6 can be accepted — the same pattern already used for every prior phase's remediation cycle in this branch.

**Carried forward as non-blocking, informational** (do not block P6 acceptance once H1 is remediated):

- **M1:** before any future consumer relies on `provenance.models[].elementCount`, the repository's governing contract (P6/P5, and/or design §13.2) should record its exact meaning. codex-advisor's suggested wording: "the number of distinct fragment-owning elements in the reachable planned scope, excluding tree-unreachable population." No code change required now; the current calculation should be preserved as-is when this is documented.
- **L1:** the P6 acceptance checklist's `grep -Rn "run/" clashtest/execution/` command should be made import-aware (or exclude comments) so it actually returns empty on a compliant tree. No production code change is needed.

**Must not begin:** any production-code remediation of H1 without explicit owner authorization; P7 or any later phase; Viewer/OQ-4 integration; remote persistence; any reopening of the frozen core design outside the documented freeze exceptions.

## H1 remediation (2026-09-24, owner-authorized)

**Owner authorization (verbatim, this session):** "Fix the R10 post-plan fallback in Run.js so the fallback Result Set is internally self-consistent and passes the existing Result Set validator. Keep the remediation narrowly scoped to the fallback representation: do not reuse the inconsistent planExists:true / empty-rootOwners shape; represent the fallback as non-plan-backed if that is the valid contract; use empty pair-space / coverage facts consistent with that representation; record exactly one internal-error planning/execution gap as required by the existing schema and outcome rules; do not invent or preserve plan-derived records that caused the original validation failure." Plus: add a regression test driving the fallback to a sealed, validated set that cannot produce a false clean/no-clash claim; do not start P7; do not start a new unrestricted review; do not modify the frozen spec absent a genuine normative contradiction; update this record and the handoff; do not commit.

### The fix

`clashtest/run/Run.js`, `emptyLedgerRecord` (lines 1293–1298):

```diff
-const emptyLedgerRecord = (run) => Object.freeze({
-  planExists: run.plan !== undefined, pairSpaceTotal: 0, emptyOperand: false, units: [],
+const emptyLedgerRecord = (run) => Object.freeze({
+  planExists: false, pairSpaceTotal: 0, emptyOperand: false, units: [],
   rootOwners: [], unresolvedSelections: [], unreachablePopulation: [], hierarchyInternal: [],
   planningGaps: [{ phase: run.phase, cause: 'internal-error' }], exclusions: [], warnings: [],
   budgetExhausted: false, firstRefusalUnitId: null,
 });
```

`planExists` is now unconditionally `false`: this record never carries real plan facts (`rootOwners`/`pairSpaceTotal`/`units` are always the same empty stand-ins), so it must not claim a plan exists, regardless of whether `run.plan` happens to be set. Nothing else in the record changes — `pairSpaceTotal: 0`, `rootOwners: []`, `units: []` and the single `planningGaps` entry were already exactly what the correction calls for; only the field that mis-described them was wrong.

**Why this is sufficient and narrowly scoped** (independently re-derived from source before applying, not merely trusted from the prior investigation):

- `reconcileEvaluatedCoverageSteps` (`clashtest/results/validateResultSet.js:820`), the sole producer of `coverage-model-mismatch`/`coverage-root-role-invalid`/`coverage-root-uncovered`, opens with `if (definition === null || ledger.planExists !== true) return;` — confirmed by direct read. With `planExists: false`, this function is a no-op for the R10 fallback; the class of failure H1 describes cannot occur.
- `model-not-in-provenance` (`validateResultSet.js` `checkResultLinkageSteps`, ~1354–1464) builds its `mentioned` set from `ledger.units`/`ledger.rootOwners`/`unreachablePopulation`/`hierarchyInternal`/`unresolvedSelections`/`warnings`/`results[].pair` — all still `[]`/empty in this record; the `planExists` flip touches none of them, so this check stays trivially satisfied whether or not `provenance.models` is populated.
- `derivedFull` (`validateResultSet.js:606-609`, and the writer's own twin `deriveRunOutcome` in `clashtest/results/resultSet.js:177-181`) already requires `planningGaps.length === 0`; the fallback always records exactly one gap, so `derivedFull` was already `false` and `outcome.coverage` was already `'partial'` before this fix — the `planExists` flip changes nothing on that axis.
- The pre-resolution-shape rule (`validateResultSet.js:325`, `if (ledger.planExists !== false) add(..., 'pre-resolution-shape-invalid')`) only applies when `definition === null`; the R10 fallback always carries the already-resolved definition (resolution completes before planning), so this rule was never in scope and is not newly triggered.
- Repo-wide `grep -n "planExists" clashtest/ test/clashtest/` confirms no other runtime consumer (`resultSet.js`, `status.js`, `freshness.js`) branches on `planExists` for status derivation, freshness, or claim assessment in a way this flip could disturb — the field is read only inside the two `validateResultSet.js` predicates already covered above and in the digest input (`ledgerDigestInput`), which digests whatever value is present either way and has no correctness dependency on it being `true` vs `false`.

### Tests

1. **Updated** the existing committed reproducer, `test/clashtest/run/lifecycle.test.mjs`, `'C1: a plan missing a snapshot model record fails closed into a READABLE, VALID R10 fallback set'` (renamed from "...READABLE R10 fallback set"): the previously-required exact two-issue list is now required to be **empty** (`assert.deepEqual(issuesOf(summary.resultSet), [])`), and a new assertion pins `summary.resultSet.ledger.planExists === false`. All other original assertions (status `failed`, non-null resultSet, `unit:internal-error` reason, empty `provenance.models`) are unchanged and still pass — this scenario still has a broken plan (missing `mk-b` model record), so `provenanceOf(run, {planRows:false})` still yields `models: []` here.
2. **Added** a new regression test, `'H1 fix: a post-plan seal failure over a HEALTHY plan also validates clean and cannot claim clean'`, exercising the *other* class of R10 entry the review's H1 text calls out generally (not only the broken-plan case): a fully healthy plan/snapshot (`realPlannerFixture`) where `sealResultSet` itself is made to throw exactly once (`failSeal: 'sealResultSet'`, the repo's existing fixture mechanism for this — matches `Run.js:1191-1198`'s own documented "an observer hook, a report callback" deviation class), so the R10 retry's minimal ledger is what actually gets sealed and admitted. This test asserts:
   - `summary.resultSet.provenance.models.length > 0` — confirms this scenario is genuinely distinct from the broken-plan case: `run.provenance()` succeeds here with real, non-fabricated model rows, while the ledger is still the empty fallback.
   - `summary.resultSet.ledger.planExists === false`.
   - `issuesOf(summary.resultSet)` deep-equals `[]` via the real `validateResultSet` — no `coverage-model-mismatch`, no `model-not-in-provenance`, no issue of any code.
   - `assessNoClashClaim(summary.resultSet, { state: 'current', reasons: [] }).allowed === false` and `canClaimNoClashes(...) === false`, called through the repository's real `clashtest/results/claim.js` predicate (not inferred indirectly from `status`) — confirms the non-null, now-valid fallback set still cannot support a false clean/no-clash claim (it already couldn't, since `outcome.status !== 'completed'`; this test makes that guarantee explicit and directly verified for the fixed shape).
3. **Test counts, reproduced this session, all green:**

| Command | Baseline (this adjudication, pre-fix) | After H1 fix |
| --- | --- | --- |
| `node --test test/clashtest/run/lifecycle.test.mjs` | 48/48 | **49/49** |
| `node --test test/clashtest/run/*.test.mjs` | 118/118 | **119/119** |
| `node --test 'test/clashtest/**/*.test.mjs'` | 1,084/1,084 | **1,085/1,085** |
| `node scripts/run-tests.mjs` | 2,210 total / 2,209 pass / 0 fail / 1 todo | **2,211 total / 2,210 pass / 0 fail / 1 pre-existing todo** |

Every count increased by exactly +1 (the one new test), 0 failures anywhere, the same single pre-existing unrelated `ContainmentQuery.classifyPoint` todo as every prior phase.

### Second opinion (codex-review)

`codex-review code "clashtest/run/Run.js" medium`, request `20260924-042928-14796-15110`, response at `.codex-worker/responses/20260924-042928-14796-15110/response.md`:

- **No correctness regressions found. "The fallback now produces a valid, non-claimable Result Set."** Zero Critical, zero Important findings.
- Explicitly confirmed the fix's own claims: `planExists: false` "accurately describes its empty plan-derived ledger"; "Regression coverage verifies the fallback passes the real Result Set validator and cannot authorize a no-clash claim"; independently re-ran `node --test test/clashtest/run/*.test.mjs` and confirmed 119/119.
- **Overall assessment (verbatim): "The current fallback remediation is correct and ready on correctness grounds."**
- Three Medium-severity findings, all explicitly scoped by Codex itself as **pre-existing and unrelated to the one-line R10 fix**: (1) `queue.shift()`/`unshift()` in the main execution loop (`Run.js:469-488`) is O(n²) as unit count grows toward the 100,000-unit ceiling; (2) `createUnitOrder.split()`'s `renumber()` (`Run.js:98-108`) re-sorts the entire rank index on every split, similarly approaching quadratic; (3) a testing-gap finding that split/queue tests only exercise small unit counts, never scale. All three predate this session's change, are unrelated to `emptyLedgerRecord`/`terminalInternalError`, and are out of this task's authorized scope (the owner's authorization was narrowly scoped to the fallback representation only). **Not actioned here** — recorded as an explicit follow-up for a future, separately-scoped performance task, not silently dropped.

**AGREE (self-verification): the H1 fix is correct, narrowly scoped, and introduces no regression.** The three performance findings are carried forward as a new, non-blocking, informational item (see below) — they do not affect H1's correctness and do not block this remediation.

### Scope and status note

This is **task-level self-verification by the implementer/controller in the same session as the adjudication above, not a substitute for the required external Work review and its own targeted adjudication.** Per this repository's `CLAUDE.md`, P6 acceptance still requires: a focused independent Work review of this specific remediation (the `Run.js` diff and the two test changes), followed by that review's own targeted adjudication, before P6 can be accepted. No such external review has occurred yet. M1 and L1 remain open, non-blocking, informational items, untouched by this task. No git commit was made.
