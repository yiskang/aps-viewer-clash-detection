# For Claude — G2 Diagnostic Instrumentation Schema-v3 Bounded Correction Package

I explicitly authorize one **bounded package-only schema/documentation correction** for the current uncommitted G2 diagnostic-instrumentation package.

The latest independent Work re-review found:

- Critical: 0
- High: 0
- Medium: 1
- Low: 2
- checkpoint readiness: bounded correction still required
- prior High and both prior Medium findings: closed
- no further offline research required

This task is limited to reconciling the normative schema/documentation with the already-implemented schema v3 package, regenerating spec-bound results/hashes deterministically, re-running verification, updating review/handoff artifacts, and stopping for targeted independent Work re-review.

Do not stop for owner approval between those in-scope correction steps.

## 1. Verify baseline

Before editing, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD: `06980ee1e17b1268d4028ed9951c5f8462016cd2`
- `main == origin/main`
- committed harness SHA unchanged: `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`
- accepted procedure SHA unchanged: `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- immutable evidence unchanged
- D2 checkpoint unchanged
- historical G2 remains `FAIL (row 3)`
- historical C6 remains `NOT_EVIDENCED`
- historical C8 remains unresolved
- real T4/C6/C8 runtime behavior unchanged
- no Viewer/browser/live run
- no G2 retry
- no new authorization record
- no attempt reset
- nothing committed or pushed

Current verified package state:

- diagnostic tests: `67/67`
- D2 tests: `55/55`
- offline suite: `5,155 total / 5,154 pass / 0 fail / 1 existing todo`
- diagnostic digest: `cbde203c886cc233cae7ad806798ed77efb0dd91e6ac37f818c05cf151cce7c2`
- summary: `197,416 B`
- summary SHA-256: `6d93283a…9458`
- witnesses: `109 B`
- witnesses SHA-256: `83548e8b…f0d3`
- unique minimum: `ID-ON + P-FRM + P-TC + V-PEND + V-EDGE`
- P-XS redundant for two-window objective
- OPEN coverage: `2/13`
- assumption-mode coverage: `3/13`
- only `3/13` questions have any sound procedure
- all `2,048` configs wrong-label count: `0`
- residual ambiguity: `5,063`, all ACTIVE_WITHOUT_VISIBLE_STEP / ACTIVE0 pre-motion

Read the latest independent Work re-review, current research doc, spec, README, prototype/results, latest internal review, and latest handoff.

If baseline differs materially, stop and report.

## 2. Fix schemaVersion

Work found that spec §7.4 still declares `diag-summary.json` as `schemaVersion: 2`, while actual implementation/results use schema v3.

Correct all stale schema-version references so the normative contract is:

`schemaVersion: 3`

Update as needed in:
- spec
- README
- research doc
- internal-review wording
- result-schema commentary

Do not change runtime behavior to match stale docs.

## 3. Document the bounded `ablation` carrier

The spec currently omits the bounded `ablation` carrier and incorrectly says no per-subset table is retained.

Correct the normative output contract to describe the actual bounded ablation representation.

Document at minimum:

- field/container name: `ablation`
- purpose
- exact/bounded structure
- retained subset/configuration data
- cardinality bounds
- deterministic ordering
- relation to the 2,048-configuration exhaustive ablation
- why retention remains bounded
- distinction between bounded ablation results and prohibited unbounded raw per-schedule traces

Remove/replace any stale statement claiming no per-subset table is retained.

## 4. Reconcile README

Update README to match schema v3 exactly, including:

- schema version
- `ablation` carrier
- result structure
- retained-output interpretation
- deterministic behavior
- bounds
- current hashes/digests after regeneration

No stale v2 wording may remain.

## 5. Fix Appendix A NV limit

Correct stale current-limit references:

`400 B` → `406 B`

where they refer to the current normative/tested NV bound.

Check consistency across:
- spec normative section
- Appendix A
- README
- bounds implementation comments
- tests
- research doc
- result metadata if applicable

Do not alter the implemented 406 B behavior.

## 6. Preserve VB-3 positive-control limitation

Keep the post-capture VB-3 control explicitly described as:

- not historical proof
- not established as representative of the historical live run
- a future live-design gate

Do not strengthen this claim.

## 7. Preserve accepted technical conclusions

Do not change unless a genuine inconsistency is discovered:

- VB-0 exact gate
- unique minimum: `ID-ON + P-FRM + P-TC + V-PEND + V-EDGE`
- P-XS redundancy
- OPEN `2/13`
- assumption `3/13`
- only `3/13` sound procedures
- META/data/END integrity
- all `2,048` configs wrong-label = `0`
- public-only sound definite owner/subject/attribution labels = `0`
- residual ambiguity = `5,063` ACTIVE0/pre-motion cases
- pending-clear gap fail-closed behavior
- historical C8 unresolved
- G2 FAIL row 3
- C6 NOT_EVIDENCED

If any of these change after the schema/doc correction, stop and investigate.

## 8. Regenerate spec-bound results

Because the normative spec changes and result metadata/hashes are spec-bound, regenerate the diagnostic results from the corrected final package.

Run the diagnostic prototype twice from clean output directories.

Verify:

- runs are byte-identical
- retained `results/` matches the final fresh run
- schemaVersion is `3`
- `ablation` carrier appears as specified
- accepted conclusions/counts remain unchanged
- output remains bounded

Record the new:

- overall diagnostic digest
- `diag-summary.json` size
- `diag-summary.json` SHA-256
- `diag-witnesses.json` size
- `diag-witnesses.json` SHA-256

The digest may legitimately change because spec-bound metadata/hashes change.

## 9. Verification

Run diagnostic tests:

`node --test docs/research/2026-10-05-g2-diagnostic-instrumentation/*.diag-test.mjs`

Baseline: `67/67`. Report final exact count.

If natural and useful, add research-local tests for:

- `schemaVersion === 3`
- `ablation` carrier presence/shape/bounds
- deterministic ordering
- NV limit `406 B`
- stale schema-v2 output rejection where appropriate

Run D2 tests:

`node --test docs/research/2026-10-04-g2-d2-synthetic-transition/*.d2-test.mjs`

Expected: `55/55`.

Run:

`npm run test:offline`

Expected:
- `5,155 total`
- `5,154 pass`
- `0 fail`
- `1 existing todo`

Run:

`git diff --check`

Expected clean.

## 10. Targeted internal re-review

Perform one targeted internal review after all corrections/regeneration.

Use explicit:
- Critical
- High
- Medium
- Low

Review:

1. schemaVersion 3 consistency
2. `ablation` carrier normative definition
3. no stale “no per-subset table” statement
4. boundedness of ablation output
5. README/spec/result alignment
6. 406 B NV consistency
7. regenerated hashes/digests
8. deterministic output
9. preservation of accepted technical conclusions
10. VB-3 positive-control limitation
11. no protected-boundary change

Fix all in-scope Critical/High/Medium findings.

If substantial fixes are made, run a targeted re-review of those fixes.

## 11. Update handoff

Update `docs/handoffs/latest.md` with:

- baseline `06980ee1...`
- schema-v3 correction status
- spec/README reconciled to actual schema v3
- bounded `ablation` carrier documented
- NV bound corrected to 406 B
- final diagnostic test count
- D2/offline suite results
- final deterministic digest/hashes
- accepted technical conclusions unchanged
- VB-3 representativeness limitation remains
- historical C8 unresolved
- no live diagnostic/retry/new record/reset
- next action: **targeted independent Work re-review of schema-v3 correction package**

## 12. Commit policy

Do not commit or push.

Checkpoint remains unauthorized until Work re-review.

## 13. Hard boundaries

Do not:

- perform additional offline research beyond what is needed to verify schema correction
- change accepted G2 procedure
- change real T4/C6/C8 behavior
- change production/harness runtime behavior
- run Viewer/browser/live diagnostics
- retry G2
- issue/reset authorization records
- mutate immutable evidence
- begin G3
- commit
- push

## 14. Stop gate

Continue autonomously until:

- schema v3 is normative everywhere
- ablation carrier is correctly documented
- stale per-subset wording removed
- NV limit is 406 B everywhere relevant
- results regenerated twice deterministically
- all tests pass
- targeted internal review has no unresolved in-scope Critical/High/Medium
- handoff updated

Then stop at:

**Ready for targeted independent Work re-review**

## Final report

Report:

- branch / HEAD / origin relation
- exact files changed
- schemaVersion correction
- ablation-carrier correction
- stale wording removed
- NV 406 B correction
- VB-3 limitation status
- diagnostic test result
- D2 test result
- offline-suite result
- final diagnostic digest
- summary size/hash
- witnesses size/hash
- deterministic rerun result
- confirmation accepted technical conclusions did not drift
- targeted internal review C/H/M/L
- working-tree state
- exact next gate

Explicitly confirm:

- no new offline research beyond schema verification
- no checkpoint commit/push
- no real harness/product/procedure change
- no real T4/C6/C8 runtime change
- no Viewer/browser/live run
- no G2 retry
- no new authorization record
- no attempt reset
- immutable evidence unchanged
