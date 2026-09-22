# P5 (Result Set) — Owner Decision Brief: 4 Residual Final-Review Findings

**Scope of this document.** Bounded to exactly the four items below, surfaced by the internal final whole-branch review of Phase P5 (`.superpowers/sdd/p5-result-set/progress.md`, "Final whole-branch review" section) after all nine P5 tasks (P5.1–P5.9) landed and were individually reviewed. Two other findings from that same review (a missing `model-not-in-provenance` field, and a missing frozen-argument check in `admitSealedSet`) were already fixed in this session (commit `fea4886`) because they completed already-existing, already-authorized rules/contracts and required no plan change; they are not repeated here. This document performs no new review of P5 — every citation below is to already-existing, already-committed code and the already-frozen spec/plan. No production code, test, spec, or plan file is modified by this document. P6 has not started.

**How to use this document.** Each item states the current behavior, the governing frozen text, the concrete failure mode, a classification, the smallest viable options with their cost and blast radius, and a clearly-labeled recommendation. The recommendation is the controller's opinion, not a decision — nothing below is acted on until the owner rules on it.

---

## Item 1 — Read-time validation checks only one of `RunOutcome`'s three axes; a tampered set can support a false no-clash claim

**Current behavior.** `deriveRunOutcome` (the writer, `clashtest/results/resultSet.js:175-197`) computes all three axes — `coverage`, `integrity`, `environmentSensitive`(+`Causes`) — from a run's own facts (leaf outcomes/scopeProof for `coverage`; `diagnostics.completenessAffectingUpperBound` and `results[].flags.duplicateEvidenceConflict` for `integrity`; diagnostic occurrence counts for `environmentSensitive`). At read time, `checkCrossField` (`clashtest/results/validateResultSet.js:222-248`) re-derives and cross-checks **only `coverage`** (line 234: `if (outcome.coverage === 'full' && !derivedFull) add('/outcome/coverage', 'coverage-not-full');`). `integrity` and `environmentSensitive`/`environmentSensitiveCauses` are checked only for correct *shape* by the structural schema (`resultSetSchema.js:105-114`: `integrity: enm(['clean', 'caveated'])`, etc.) — never re-derived from or cross-checked against the same set's own recorded facts. The claim predicate then reads the recorded (never re-derived) value directly: `clashtest/results/claim.js:54`, `clean: outcome.integrity === 'clean'`, one of the conjuncts of `assessNoClashClaim`.

**Governing frozen text.**
- The plan's own closed "Validation rule table" (`docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:1470-1493`) has exactly one cross-field row for `RunOutcome`'s three axes — `coverage-not-full` (line 1479) — and no analogous row for `integrity` or `environmentSensitive`. This is the plan's own, already-authorized, already-implemented rule set; the implementation matches it exactly.
- Spec residual trust boundary (quoted verbatim in the phase's Global Constraints, `p5-result-set.md:15`): "validation proves a set is well-formed and self-consistent, **not that it is authentic**" (§13.6).
- `assessNoClashClaim`'s conjuncts, including `clean` (`integrity === 'clean'`), are specified as the single normative §8.3 predicate (`p5-result-set.md:38`).

**Concrete failure mode (empirically demonstrated, final review).** Starting from a `completed-clean` sealed set (`results: []`, otherwise claimable): set `diagnostics.completenessAffectingUpperBound = 5` (a real completeness-affecting gap) while leaving `outcome.integrity` at its already-recorded `'clean'`; reseal (recompute digests, since digests are the only thing sealing actually re-touches — `outcome.integrity` is not re-derived by resealing either). Result: `validateResultSet(...)` returns `{ok: true, issues: []}`, and `canClaimNoClashes(sealed, 'current')` returns `true`. A set whose own diagnostics say the run may have missed something still licenses an unqualified "no clashes" claim through the exact mechanism (§13.6 self-consistency validation → §8.3 claim predicate) that exists to prevent exactly this.

**Classification: plan gap.** The implementation faithfully matches the plan's own rule table, which genuinely has no re-derivation row for `integrity`/`environmentSensitive`. This is not an implementation defect in the P5.5 sense (nothing here contradicts what P5.5 was asked to build); it is a gap in what P5.5 was asked to build.

**Important framing correction (second-model verification, `codex-advisor`, before this brief was written):** closing this gap makes the *validator* self-consistent — it does **not** protect against a genuinely malicious or compromised store. A forger with write access to the store can fabricate an entirely self-consistent "clean" set from scratch (consistent `integrity`, consistent diagnostics, consistent digests) regardless of any re-derivation rule added here; re-deriving `integrity` only catches an *internally contradictory* set (the failure mode actually demonstrated above — a real record whose `integrity` field alone was altered or never updated, e.g. by a future producer bug), not a wholesale forgery. Do not read this item as closing an authenticity/security boundary; it closes an internal-consistency/accidental-corruption hole.

**Smallest viable options.**

| # | Option | Scope / cost | Affects |
|---|---|---|---|
| A | **No change.** Document the gap as an accepted residual risk within the already-stated "validation proves well-formed, not authentic" design boundary. | Zero implementation cost. Leaves the demonstrated failure mode open for any future producer bug or corrupted/tampered raw input that reaches `readResultSet`. | None — pure documentation. |
| B | **Claim-side guard only.** Add a narrow, defensive re-derivation of `integrity` (and/or `environmentSensitive`) inside `assessNoClashClaim` itself (`clashtest/results/claim.js`), mirroring `deriveRunOutcome`'s own predicate, as an additional conjunct — without touching `validateResultSet`'s schema or issue codes. | Small, contained to `claim.js`. Blocks the specific false-claim consequence directly at the one place it matters most. Does **not** repair `validateResultSet`'s own self-consistency promise — a corrupted-but-never-claimed set (e.g. one only ever read via `getPairStatus`/`getElementStatus`, or exported for its own sake) would still validate `{ok:true}`. `assessNoClashClaim`'s conjunct set is enumerated in the plan's own interface summary (`p5-result-set.md:38`); adding a conjunct is a plan-touching change requiring the same authorization as any other plan amendment. | P5 only (`claim.js`); P6/P7 consumers of `canClaimNoClashes`/`assessNoClashClaim` are unaffected in interface shape, only in edge-case return value. |
| C | **Full validator fix.** Add a new cross-field rule to `checkCrossField` (`validateResultSet.js`) that re-derives `integrity` and `environmentSensitive`(+`Causes`) the same way `coverage-not-full` already does, with new issue code(s) (e.g. `integrity-not-derived`, `environment-sensitive-mismatch`). | Moderate: new issue code(s) → new `resultSetSchema.js`/traceability-table rows, a new `CORRUPTIONS` regression case per code, and re-verification of the specific area touched (not a full re-review, per the project's Review boundary rule — a scoped remediation). This is P5-owned work (the validator is exclusively P5's file); would need to be authored as a P5 remediation task before P5's independent Work review, not deferred to P6. | P5 (`validateResultSet.js`, `resultSetSchema.js`); the plan's own Validation-rule-traceability table and Spec coverage table need matching updates; P7's already-known cross-file need (X5, the engine-bound claim path's own digest-version test) is a template for how a P7 test for this rule would be structured, if the owner also wants engine-level coverage. |
| D | **B + C combined.** Immediate claim-side defense-in-depth, plus full validator self-consistency. | Sum of B and C's costs. Most complete; also the most plan-touching. | Union of B and C. |

**Recommendation (not an authorization):** Option C, on the grounds that a false no-clash claim is the single most consequential thing this subsystem can get wrong, and the plan's own precedent (re-deriving `coverage`) already establishes the intended pattern for the third axis it left out — this looks more like an omission than a deliberate scope boundary. If schedule favors the smaller change, B alone is a legitimate interim step, clearly labeled as partial (validator-level self-consistency is still open until C follows). Whatever is chosen, the "not an authenticity fix" framing above should travel with the decision so it isn't later mistaken for a complete security fix.

---

## Item 2 — Stored `ClashResult.pair` orientation is not validated as canonical

**Current behavior.** `makePairId(mode, x, y)` (`clashtest/identity/ids.js:92-100`) computes the canonical orientation of a pair via `pairSemanticsOf(mode)` and `compareElementRefs` — this is the one place orientation is *supposed* to be decided. `makeResultId(testId, semanticDigest, pairId)` (`clashtest/identity/ids.js:122-130`) digests `pairId.first`/`.second` **exactly as given**, in whatever order the caller supplies, with no re-derivation of canonical order; its own doc comment says so explicitly (line 120: "the mode-dependent ordering is not re-derivable here"). At validation time, the two relevant checks are: (a) `checkOrderAndUniqueness` (`validateResultSet.js:402-409`), which only checks that `results[]` is strictly ascending by `comparePairIds(pair)` across the array, and relies on the schema's own `uniqueBy(resultId)` for duplicate detection; (b) the closed rule table's `result-id-mismatch` row (`p5-result-set.md:1485`): `resultId ≠ makeResultId(testRef.testId, testRef.semanticDigest, pair)` — this only checks that a result's `resultId` is **self-consistent** with whatever `pair` value is stored; it does not check that `pair` itself is the orientation `makePairId(mode, ...)` would have produced. No row in the plan's own closed Validation rule table (`p5-result-set.md:1470-1493`) checks pair orientation against the mode-derived canonical order.

**Governing frozen text.** Spec §11.3 "canonical ordering" and §11.4 "reconciliation rules 1–4" (`p5-result-set.md:3683-3684`, task-mapped to P5.1/P5.5) — both assume a stable, canonical per-physical-pair identity is what the whole reconciliation and ordering apparatus is built on. The producer/reader invariant (R21-2, "an engine never produces a set it cannot read," `p5-result-set.md:14`) is the same invariant Item 1 cites; this item is a second, independent way that invariant's *self-consistency* half can be violated.

**Concrete failure mode (empirically demonstrated, final review).** Take a valid sealed set; flip one result's `pair.first`/`pair.second`; recompute that result's `resultId` **consistently** with the now-flipped `pair` (so `result-id-mismatch` cannot fire); keep the array's ascending order intact (achievable because `comparePairIds` only compares field values, not "which physical pair this used to be"). `validateResultSet` returns `{ok: true, issues: []}`. Consequence, composed across the phase: the same physical pair can now appear in a result set under two different `resultId`s (once per orientation) without tripping `duplicate-result-id`, silently undoing whatever §11.4 reconciliation the engine performed and double-counting one clash in the result count / `pairSetDigest`; separately, P5.6's `status.js` keys its `resultByPair` lookup by exact `pair` orientation (`pairKey(r.pair)`), so §12.5 taint rule 4 (`duplicateEvidenceConflict`) can miss a flag carried on the flipped row.

**Classification: plan gap / cross-phase issue.** No single task's own brief asked for this check, and the composed consequence spans two files owned by two different P5 tasks (P5.5's validator, P5.6's status reader) — visible only from the whole-phase view, not from either task's own diff.

**Smallest viable options.**

| # | Option | Scope / cost | Affects |
|---|---|---|---|
| A | **No change.** Document as a theoretical risk: today's only real producer (`projectUnitPairs`, P5.1, already reviewed) always calls `makePairId` directly and never produces a flipped pair, so this is unreachable via the real writer path — only a hand-crafted or corrupted raw set exploits it (same trust-boundary caveat as Item 1). | Zero cost. | None. |
| B | **Add a new validation rule.** In `checkResultLinkage` or a new check function, recompute the expected orientation via `makePairId(mode, evaluatedAs.source, evaluatedAs.target)` (or re-run `pairSemanticsOf(mode)` against the stored `pair` directly) and compare to the stored `pair`; new issue code (e.g. `pair-orientation-invalid`). | Needs a new issue code (plan amendment: new schema-table row, new `p5-result-set.md` Validation-rule-table row, new traceability entry, new `CORRUPTIONS` regression case). `pairSemanticsOf` is currently a **test-only** P1 export per the interface-reconciliation register (row N14); promoting it to a production P5 dependency (or reimplementing the equivalent check without it) is a small cross-phase interface note, not a P1 code change. | P5 (`validateResultSet.js`, `resultSetSchema.js`); P1's export-visibility note for `pairSemanticsOf` (N14); P8's `derive/compareResultSets` (deferrable phase) should be told what "duplicate pair" now excludes, once this exists. |
| C | **Narrower defense: fix only the status-reader blind spot.** Make P5.6's `resultByPair` key insensitive to orientation (canonicalize the key regardless of stored `pair` order), so a flipped row is still found by taint rule 4's lookup — without adding a new top-level validation rule. | Contained to `status.js`, no plan/schema amendment needed. Does **not** close the primary defect: a corrupted set can still double-count one physical pair as two distinct results, which corrupts the result count and `pairSetDigest`'s meaning independent of whether taint rule 4 finds it. | P5.6 (`status.js`) only. |

**Recommendation (not an authorization):** Option B, as the complete fix — the composed consequence (double-counted results, corrupted reconciliation) is not something a status-reader-only patch (C) can close, and it is the kind of defect an external Work reviewer is likely to find independently given how directly it follows from reading `makeResultId`'s own doc comment next to the validator's rule table.

---

## Item 3 — `deriveRunOutcome` / `freshnessStateOf`: disposition (not an owner decision), unless the evidence below is disputed

**Current behavior.** `deriveRunOutcome` (`clashtest/results/resultSet.js:175-197`) passes its `freshness` parameter through verbatim into the returned `RunOutcome.freshness` (line 192), with no normalization through the codebase's own two-shape adapter, `freshnessStateOf` (`clashtest/results/claim.js`). It also does not de-duplicate its `reasons` output — line 195: `reasons: [...reasons].sort()` — even though the schema declares `RunOutcome.reasons` with `uniqueBy: (r) => r` (`resultSetSchema.js:113`).

**Governing frozen text and why this is P6's concern, not P5's.** The plan's own interface summary states `deriveRunOutcome`'s `status`/`freshness`/`reasons` parameters "are supplied by P6" (`p5-result-set.md:33`, the `deriveRunOutcome` row). The plan's P6 phase file already drafts a real call site (`p6-run-lifecycle.md:3407`, per direct citation from the second-model verification below) that passes an **already-extracted bare state string** (`freshness.state`), not the two-shape `{state, reasons}` object — i.e., P6 is already specified to do the normalization *before* calling `deriveRunOutcome`, which is exactly what makes the bare-string schema declaration (`resultSetSchema.js:109`: `freshness: enm(['current', 'stale', 'unverifiable'])`) correct as written. The `freshnessStateOf` two-shape adapter is specified only for `assessNoClashClaim`/`canClaimNoClashes` (the claim helpers) and P6's own freshness-reading consumers (`p5-result-set.md:37`'s `freshnessStateOf` row: "Consumed by P6 (A16) and by both claim helpers below") — never for `deriveRunOutcome`. Separately, `reasons` de-duplication is already guaranteed upstream by P6's own `classifyUnitSettlement`/`collectReasons` machinery, which builds a `Set` before the result ever reaches `deriveRunOutcome` (per the second-model verification's citation of `interface-reconciliation.md:75`).

**Second-model verification.** This disposition was checked with an independent model (`codex-advisor`, medium effort, same session) specifically because the controller's own first-pass read of this item was wrong — the controller initially proposed normalizing `deriveRunOutcome` through `freshnessStateOf` as a "safe, in-scope P5 fix," which the verification correctly rejected as an unauthorized deviation from the plan's own already-specified P6 call-site contract. That correction is why this item is presented as a disposition rather than folded into the fix wave.

**Concrete failure mode, if this disposition is wrong.** If a future P6 implementation (or any other future caller) ever passes the two-shape `{state, reasons}` object directly into `deriveRunOutcome` instead of pre-extracting `.state`, the resulting set would fail its own schema's `freshness` enum check (`type-invalid`) the moment it's validated — a live producer/reader defect at the P5/P6 seam. Likewise, if a future caller ever supplies `reasons` with duplicates, the resulting set would fail its own schema's `duplicate-key` check.

**Classification: cross-phase disposition, not a P5 gap.** No option table is offered because no P5 action is proposed. This is recorded here so a future session (implementing P6) does not "fix" `deriveRunOutcome` incorrectly, and so the owner has visibility that the controller checked this rather than silently assumed it.

**Recommendation (not an authorization):** No P5 action. When P6 is authorized and implemented, its own task review should explicitly confirm the call site matches what `p6-run-lifecycle.md:3407` already specifies (bare state string, pre-deduplicated reasons) — a one-line check item for that future review, not a new requirement.

---

## Item 4 — Two digest-versioning schema rows appear contradictory / ambiguous

**Current behavior.** `resultSetSchema.js:147`: `ScopeProof: { fields: { method: lit('bracketed-digest'), digestVersion: lit(DIGEST_VERSION) } }` — `scopeProof.digestVersion` is pinned to a **literal**, current value; any other value is rejected structurally (`literal-invalid`) before any other check runs. `resultSetSchema.js:261-266`: `Digests: { fields: { digestVersion: int({ min: 1 }), ... } }`, with an explicit comment: "NOT pinned to `DIGEST_VERSION`: §13.6 makes an unknown version valid-but-unverifiable. The CLAIM predicate refuses it (review Critical 2); the validator must not call it corrupt." Both fields currently derive from or are compared against a single shared constant, `DIGEST_VERSION = 1` (`clashtest/util/canonical.js:14`) — there is no separate "scope-proof algorithm version" constant anywhere in the codebase today.

**Governing frozen text.** The `Digests.digestVersion` row's own comment cites §13.6's valid-but-unverifiable rule and review Critical 2 (also reflected in the claim predicate's `knownDigestVersion` conjunct, `claim.js:50,56,75-78`, and the plan's own `assessNoClashClaim` row, `p5-result-set.md:38`). No text was found (in the spec, the master plan, or this phase's plan) that explicitly states whether the *scope-proof bracketing algorithm's* version and the *Result Set digest's* version are meant to be independently versionable concepts, or a single shared version that both fields should track together.

**Concrete failure mode / ambiguity.** Because both fields currently source from the one shared `DIGEST_VERSION` constant, a hypothetical future writer built against a bumped constant (e.g. `DIGEST_VERSION = 2`) would write `2` into **both** `scopeProof.digestVersion` and `digests.digestVersion`. The literal-pinned `ScopeProof` field would then reject that entire set as structurally corrupt (`literal-invalid`) during the **structural** phase — which runs first and unconditionally, per the plan's own phase ordering (`p5-result-set.md:1468`: "the structural phase above runs first and in full") — before the `Digests` field's own designed valid-but-unverifiable tolerance ever has a chance to apply. Under today's single-constant reality, this makes the intended forward-compatibility path for `Digests.digestVersion` unreachable for a genuine forward-version writer. **Whether this is a real problem depends on unresolved intent**: if the two versions are meant to be *coupled* (one bump, one meaning), then pinning `ScopeProof` is arguably correct today and the real fix (when a v2 ever ships) is a coordinated schema update, not a live bug. If they are meant to be *independent* (scope-proof's bracketing algorithm could stay at v1 indefinitely while the Result Set's own digest format advances, or vice versa), then `ScopeProof` needs its own, separately-versionable constant and the current literal pin is a design defect, not merely a not-yet-triggered one.

**Classification: unresolved ambiguity, not a proven contradiction.** Both rows are copied verbatim from the plan's own prescribed code and are individually correct against their own cited rationale; the tension is only visible when both are read together against a design intent that isn't written down anywhere found.

**Smallest viable options.**

| # | Option | Scope / cost | Affects |
|---|---|---|---|
| A | **Leave as-is; document the coupling.** Record that any future `DIGEST_VERSION` bump requires a coordinated update — the schema's `ScopeProof` literal, `P3`'s scope-bracket producer, and a compatible reader — before a v2 set can be produced or read at all, i.e. treat it as an ordinary planned schema-version migration step, not a live gap. Both `SCHEMA_VERSION` and `DIGEST_VERSION` are still 1 today; nothing is currently broken. | Zero cost today. | None until a real version bump is planned. |
| B | **Split into two independently-versionable constants** (e.g. keep `DIGEST_VERSION` for `Digests.digestVersion`; add a new `SCOPE_PROOF_VERSION` for `ScopeProof.digestVersion`, each with its own forward-compatibility policy). | Touches P0's `util/canonical.js` (an already-accepted, frozen phase) and P3's `planning/scopeDigest.js` (the actual producer of `scopeProof`), in addition to P5's schema — a genuine cross-phase, multi-file change. Reopening P0 needs either a "genuine correctness contradiction" finding or explicit owner authorization under this repository's `CLAUDE.md` freeze rule; given Item 4's own classification as an ambiguity rather than a proven contradiction, this option likely needs the latter. | P0 (`util/canonical.js`), P3 (`planning/scopeDigest.js`), P5 (`resultSetSchema.js`). |
| C | **Relax `ScopeProof.digestVersion` to `int({min:1})`** (matching `Digests`' own already-existing pattern) and extend the same valid-but-unverifiable tolerance to it — i.e., a reader that doesn't recognize a scope-proof version treats bracketed-digest verification as unavailable rather than the whole set as corrupt. | A single schema-row change in P5 (`resultSetSchema.js`), no P0/P3 change — but changes what "corrupt" means for this field (a plan/schema amendment) and requires deciding what a reader should *do* with an unrecognized scope-proof version: does `proofMethod` become effectively unusable for that set, does `assessNoClashClaim` need a new conjunct mirroring `knownDigestVersion` (line 50/56)? | P5 (`resultSetSchema.js`, possibly `claim.js`); P7's already-known cross-file need (X5, the engine-bound digest-version claim test) is the template for an equivalent scope-proof-version test if this option is chosen. |

**Recommendation (not an authorization):** Clarify design intent first — are these two versions meant to move together or independently? — before picking B or C. Until that's answered, Option A (document the coupling, act only when a real version bump is actually planned) is the recommended default, since nothing is live-broken today and both B and C commit to an answer this brief cannot supply on its own.

---

## Owner rulings and remediation result (2026-09-22)

The milestone owner ruled on all 4 items, verbatim:

1. **Outcome-axis re-derivation: fix in P5 now.** "Read-time validation must fail closed and must
   not allow a forged or tampered Result Set to support a false no-clash claim when any governing
   outcome axis is inconsistent."
2. **Canonical pair orientation: fix in P5 now.** "Stored pairs must satisfy the existing canonical
   orientation invariant so one physical clash cannot be represented under duplicate flipped
   identities."
3. **`deriveRunOutcome`/`freshnessStateOf`: keep the current disposition.** "This remains a P6
   concern and is not a P5 owner decision."
4. **Digest-version ambiguity: defer.** "Do not guess the intended schema semantics and do not
   change the schema now. Persist it as an explicit unresolved gate that must be resolved before
   any later implementation relies on cross-version digest validation or migration semantics."

The owner authorized Option C for Item 1 and Option B for Item 2 (this document's own
recommendations), scoped strictly to the targeted changes those rulings require, with regression
tests, and with an explicit instruction not to start a new unrestricted P5 review and not to modify
the frozen spec/plan.

**Remediation implemented (task P5-REM, same session).** `clashtest/results/validateResultSet.js`:
`checkCrossField` now re-derives `outcome.integrity` and `outcome.environmentSensitive(+Causes)`
from the same ledger/diagnostics/results facts `deriveRunOutcome` uses, mirroring it exactly (new
issue codes `integrity-not-derived`, `environment-sensitive-mismatch`) — closing Item 1's
demonstrated false-negative. `checkResultLinkage` now validates each result's stored `pair` against
the canonical orientation `makePairId` would produce from that result's own `evaluatedAs` (new
issue code `pair-orientation-invalid`) — closing Item 2's demonstrated false-negative. Both are
validator-side only (no `claim.js` change, matching Item 1's Option C rather than Option B/D). No
edit was made to any frozen spec or plan file; the new issue codes and their rationale are
documented as code comments only. Regression tests were added reproducing each item's own
concretely-demonstrated failure mode. A genuine, pre-existing self-inconsistency was found and
fixed in three shared test fixtures while implementing Item 1 (their declared
`environmentSensitive`/`environmentSensitiveCauses` did not match what their own ledger content
actually derives to) — verified as a real pre-existing fixture bug, not a new derivation defect,
independently by both a second-model consult (`codex-advisor`) and the task reviewer. Full detail:
`.superpowers/sdd/p5-result-set/task-P5-REM-report.md`.

**Verification.** Task review: spec compliance PASS (both items implemented exactly as ruled,
nothing out of scope touched), code quality APPROVED, no Critical/High findings. Independent
second opinion (`codex-review`, medium): "correct and safe to merge... no current correctness
defect was found" — two non-blocking observations (duplicated-derivation-logic-by-design, and a
suggestion for broader branch coverage) were both evaluated and are not defects introduced by this
work. Full `npm test`: 2,064 total / 2,063 pass / 0 fail / 1 pre-existing unrelated todo, unchanged
from the pre-remediation baseline.

**Commit status: NOT committed.** Per explicit owner instruction ("do not commit yet"), this
remediation exists only as staged, uncommitted working-tree changes on top of `fea4886` pending a
separate, explicit commit authorization. (An earlier pass in this session committed it in error;
that commit was reverted via `git reset --soft` before this document was updated, with no content
lost.)

Item 3 required no code change (disposition confirmed as correct by the owner). Item 4 is recorded
as an explicit unresolved gate per the owner's ruling: the schema is unchanged, and no later
implementation may rely on cross-version digest validation or migration semantics for either
`Digests.digestVersion` or `ScopeProof.digestVersion` until this ambiguity is resolved.

## Summary table

| Item | Classification | Owner decision needed? | Controller recommendation |
|---|---|---|---|
| 1 — outcome axes not fully re-derived | Plan gap | **Yes** | Option C (full validator fix); B alone as a labeled interim step if schedule requires |
| 2 — pair orientation not validated | Plan gap / cross-phase | **Yes** | Option B (add the validation rule) |
| 3 — `deriveRunOutcome`/`freshnessStateOf` | Cross-phase disposition | **No** (recorded for visibility only) | No P5 action; P6's future task review should confirm the call-site contract |
| 4 — digest-version rows ambiguous | Unresolved ambiguity | **Yes** (on intent, at minimum) | Option A (document, defer) until intent is clarified |

Full supporting evidence, the final whole-branch review's complete findings (including the ~20 triaged Minor items not repeated here), and the two already-fixed findings' detail live in `.superpowers/sdd/p5-result-set/progress.md`.
