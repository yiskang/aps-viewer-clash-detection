# Federated Clash Test core — P1 independent review: targeted adjudication

- **Date:** 2026-09-21
- **Adjudicated artifact:** [`2026-09-21-federated-clash-test-core-p1-independent-review.md`](2026-09-21-federated-clash-test-core-p1-independent-review.md) (0 Critical, 0 High, 1 Medium, 1 Low; verdict `P1 checkpoint ready for targeted adjudication; P2 remains unauthorized …`)
- **Repository state adjudicated:** branch `feature/federated-clash-test-core-engine`, P1 checkpoint `fbe09cd7c25c4c5840d1098f3cd3ebe04efa16c2` (HEAD).
- **Method:** `CLAUDE.md` "Independent review adjudication". Scope limited to the review's two cited findings, checkpoint boundary, test evidence and gate verdict. Read-only: no production code, test, plan or spec modified. Direct probes plus one `codex-advisor` consult (`20260921-171214-81247-7944`, low) on the severity/contract questions.

## Result

**Work review and adjudication AGREE that both findings are real and that neither is Critical/High or blocks P1's core identity behavior; they AGREE on the boundary, the test evidence and that P2 is not authorized by any review.** They differ on **one severity label only** (registry finding: Work = Medium; adjudication = Low under the current reconciled plan, Medium if host-registry adoption returns). That is not a disagreement on a blocking finding or on the gate verdict, so no owner-decision escalation is triggered; the owner is asked only to disposition the two findings (below).

## Finding dispositions

| # | Review claim | Adjudication | Evidence |
| --- | --- | --- | --- |
| Medium (Work) | `assertRegistryBelongsToWorld` (`ModelRegistry.js`, `REGISTRY_METHODS` + function) accepts an incomplete object: checks only 5 methods + string `registrySessionId` + matching `world` | **CONFIRMED as a real defect; severity adjusted to Low (current plan state)** | Probe: an object with exactly those 5 methods, a string session id and the matching `world` → **accepted**. A real `ModelRegistry` additionally has `keyOf`, `isBindingCurrent`, `invalidateModelPlacement` (functions) and numeric `registryRevision`, none checked. Root cause is a **plan-vs-interface-summary gap**: P1.8's literal recipe lists exactly the five methods, while the phase interface summary (and P6/P7 consumers) needs the full surface — the implementer followed the plan verbatim. Severity: P7 (`p7-engine-integration.md:275`) calls `assertRegistryBelongsToWorld(registry, world)` on a host-supplied registry but the reconciled P6/P7 design creates/uses `coordinator.registry` rather than adopting the supplied one, so the delayed-failure path the review describes is not realized today. P1's own cross-phase note still says P6 *may* adopt a first host registry; **if adoption is (re)introduced the finding is Medium.** |
| Low (Work) | `bindingsEquivalent` treats nullish/empty operands as valid equal bindings | **CONFIRMED, severity Low retained** | Probe: `bindingsEquivalent(undefined, null)`, `({}, {})` and `(undefined, undefined)` all `true`. The committed snapshot test (`ModelRegistry.snapshot.test.mjs:139`, verbatim from the plan) blesses `undefined`/`null` equality — again plan-derived. Fail-closed is safe for the planned caller: P6's boundary comparison (`p6-run-lifecycle.md:~2558`) reads positionally aligned snapshot arrays, handles `null` before calling `bindingsEquivalent`, and only calls it with two non-null bindings; an out-of-range `undefined` would be a violated snapshot contract that must not read as "unchanged". P3 does not call it. |

## Checkpoint boundary, evidence, gate — CONFIRMED

- **Boundary:** `fbe09cd` = 14 files (`clashtest/identity/{ids,ModelRegistry}.js`, 7 `test/clashtest/identity/*.test.mjs`, `test/clashtest/support/leaseWorld{,.contract.test}.mjs`, the P1 internal review, the P1 plan, the handoff). No change to any P0 file, `clashtest/errors.js`, the frozen spec, `collision/`, `wwwroot/`, `package.json`. No P2 files. `git diff --check 3b73d45 fbe09cd` clean.
- **Tests:** `node --test test/clashtest/identity/*.test.mjs test/clashtest/support/leaseWorld.contract.test.mjs` → 78 pass / 0 fail / 0 todo (reproduced). The review's full-runner figure (1,312 pass + 3 sandbox `EPERM` server-bind failures, 1 todo) matches the known environment difference recorded for P0 (unrestricted: 1,315 pass / 0 fail / 1 todo); no P1 failure either way.
- **Gate verdict:** the Work review's `P1 checkpoint ready for targeted adjudication; P2 remains unauthorized until the Medium and Low findings and this gate verdict are adjudicated` is **consistent** with the evidence. Codex's suggestion to "authorize P2" is **not adopted**: authorizing a phase transition belongs to the owner (`CLAUDE.md`, transition authorization), not to an adjudicator.

## Recommended disposition (RECOMMENDED, NOT authorized)

Both are small and contract-tightening; **recommend fixing in P1 now** (same approach as P0), or, if the owner prefers, deferring both as named obligations that must land **before P6/P7 consume these contracts** (Codex's alternative). Either way, changes are production edits that adjudication may not make.

1. `assertRegistryBelongsToWorld`: keep the duck-typed/duplicate-module approach; require the full consumed surface — methods `register, unregister, keyOf, bindingFor, snapshotBindings, isBindingCurrent, notifyPlacementChanged, invalidateModelPlacement`; `world` identical to the argument; non-empty string `registrySessionId`; non-negative-integer `registryRevision` (readonly-ness cannot be proven by duck typing and stays an interface obligation); a throwing structural probe (e.g. a Proxy) normalizes to `ModelBindingError{reason:'registry-mismatch'}`. Align P1.8's recipe/test with the interface summary and add an incomplete-registry regression test.
2. `bindingsEquivalent`: `true` only for `null`/`null` or two well-formed Bindings (object with string `modelKey`, `model`, `modelVersion`, numeric generations) that are field-equal; `false` for one `null`, any nullish, or any malformed operand. Replace the test at `ModelRegistry.snapshot.test.mjs:139` with fail-closed malformed-input cases; keep the valid-binding tests unchanged.
3. Afterwards run a targeted re-check of only these two areas (no new unrestricted P1 review).

## Not adjudicated / unchanged

P2 not started and not authorized. P0.8 remains G-CAL-blocked. No spec, plan or acceptance mapping altered by this adjudication.

## Remediation (owner-authorized 2026-09-21: "Fix both findings in P1 now")

Applied and committed in the P1 remediation commit; only the two adjudicated findings; no P2 work, no plan/spec change, no new unrestricted review.

**`clashtest/identity/ModelRegistry.js`**
- `assertRegistryBelongsToWorld` now requires the full consumed surface: methods `register, unregister, keyOf, bindingFor, snapshotBindings, isBindingCurrent, notifyPlacementChanged, invalidateModelPlacement`; a non-empty string `registrySessionId`; a non-negative-integer `registryRevision`; and `registry.world === world`. Still duck-typed (duplicate-module copies pass). A structural probe that throws (hostile Proxy) is caught and reported as `ModelBindingError{reason:'registry-mismatch'}`. Read-only-ness remains an interface obligation (not provable by duck typing).
- `bindingsEquivalent` is fail-closed: `true` only for `null`/`null` or two well-formed Bindings (non-empty string `modelKey` and `modelVersion`, object `model`, non-negative safe-integer generations) that are field-equal; `false` for any nullish/malformed operand (including `undefined`, `{}`, and a malformed value compared with itself) and for a throwing Proxy (caught). Valid-`Binding|null` behavior is unchanged.

**Tests** (P1: 78 → 80)
- `ModelRegistry.snapshot.test.mjs`: the assertion `bindingsEquivalent(undefined, null) === true` was removed; new test covers `undefined`/`{}`/`[]`/primitives/hostile Proxy and each malformed-field variant in every operand position (incl. `bad, bad`), plus the valid controls.
- `identity.guards.test.mjs`: new test — the review's original five-member reproduction is now rejected; each of the 8 methods missing or non-function, empty/non-string session id, invalid `registryRevision`, foreign `world` → rejected; a hostile Proxy → `registry-mismatch`; a full duck-typed registry and a real `ModelRegistry` still accepted.
- Mutation check: restoring the pre-fix `ModelRegistry.js` from `HEAD` makes exactly the two new/replaced tests fail (19 pass / 2 fail across those two files); with the fix all pass.

**Verification (targeted, per the owner instruction):** `node --test test/clashtest/identity/*.test.mjs test/clashtest/support/leaseWorld.contract.test.mjs` → 80 pass / 0 fail; all `test/clashtest` → 192 pass / 0 fail / 0 todo (P0 112 + P1 80); `git diff --check` clean; changed code files are `clashtest/identity/ModelRegistry.js` and the two test files only. No other module in `clashtest/` calls either function yet. The full repository runner was not re-run (no file outside `clashtest/identity/` and `test/clashtest/identity/` changed).

**Notes:** the plan's P1.8 code block (five-method recipe) and its snapshot test still show the superseded text; the implementation and this record are authoritative and the plan text was intentionally not edited (out of the authorized scope). It should be aligned when the plan is next touched; P6/P7 must rely on the fixed helper behavior.

**Status:** Medium and Low findings REMEDIATED and committed (owner-authorized). P2 not started and not authorized; no independent re-review of the remediation has been requested.

## Post-remediation gate verification

Re-verified from the current repository on 2026-09-21 at `f4c05bd` without reopening P1:

- The adjudication dispositions stand: both Work findings were real; neither was Critical/High. The registry-surface finding is Low under the current no-adoption coordinator path (and would become Medium if host-registry adoption returned); the malformed-binding equality finding remains Low.
- The remediation matches the minimum corrections and the two original reproductions now fail closed. No P2, frozen-spec, plan, P0, collision-library, Viewer, or integration code was changed.
- P1 targeted suite: **80/80 pass**. All current `test/clashtest`: **192/192 pass**. The committed boundary remains limited to `ModelRegistry.js`, its two tests, review/adjudication documentation, and the handoff.
- Evidence correction: the remediation record originally said `git diff --check` was clean, but `git diff --check fbe09cd..f4c05bd` reported four trailing-space lines in the independent review and one extra blank line at the adjudication EOF. These were documentation-only and did not affect the technical verdict; they are removed by this post-remediation documentation update, after which the current diff check is clean.

**Final gate state:** the independent Work review and required targeted adjudication are complete, the two confirmed findings are remediated, and no further independent re-review is required by `CLAUDE.md`. P1 is accepted. P2 remains unstarted and requires the owner's explicit phase go-ahead.
