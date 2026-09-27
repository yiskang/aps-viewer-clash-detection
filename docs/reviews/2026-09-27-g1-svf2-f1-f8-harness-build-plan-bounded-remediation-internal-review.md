# Internal review — G1 SVF2 F1–F8 harness build plan (bounded remediation round)

- **Date:** 2026-09-27
- **Authorization:** pasted bounded-remediation authorization, "Perform a bounded remediation of the G1 SVF2 F1–F8 harness build plan based on the latest independent Work re-review. This authorization is plan remediation only." Does not authorize implementing the harness, creating/modifying the planned harness file, running F1–F8, changing production Viewer initialization, uploading/retranslating models, modifying Viewer Adapter/Core/Viewer Clash Panel production code/M4/host integration, starting G2/G3/H1/H2/OQ-1, or committing/pushing.
- **Artifact reviewed:** [`docs/research/2026-09-27-g1-svf2-f1-f8-harness-build-plan.md`](../research/2026-09-27-g1-svf2-f1-f8-harness-build-plan.md), after applying every fix mandated by [`docs/reviews/2026-09-27-g1-svf2-f1-f8-harness-build-plan-remediation-bounded-independent-rereview.md`](2026-09-27-g1-svf2-f1-f8-harness-build-plan-remediation-bounded-independent-rereview.md) (1 Critical / 3 High / 3 Medium, all accepted per this round's own §5d disposition).
- **Method:** `codex-review` (type `spec`, effort `medium`), invoked via the `codex-review` skill against a running `codex-worker` process (heartbeat confirmed fresh immediately before dispatch), scoped per this remediation's own item 9 to exactly the areas the bounded re-review's fixes touched — C1, H1–H3, M1–M3, and their directly affected verdict/timeout/cleanup/F4/F7/F8/evidence-identity sections — not an unrestricted full-artifact pass. Request ID `20260927-204304-51441-18565`. Every finding was verified directly against repository source before being accepted, per this repo's `codex-review` skill discipline ("do not assume Codex is correct").
- **Verdict from Codex:** "Requires major revision" (3 Critical, 4 High, 1 Medium, 3 clarifying questions).
- **Disposition:** **all 8 findings accepted; none rejected.** The plan document has been corrected in place — §4.2, §4.3, §6.1 Phase 11 ledger, §6.3, §6.4, §6.4a, new §6.4b, §6.6, §7.4, §7.5, §8, and §10 now reflect the fixed design.

---

## Verification method

Before accepting, the cited repository files were read directly:

- `clashtest/identity/ModelRegistry.js:95-125` — confirmed `unregister(model)` keys off the model object via an internal `#keyByModel` map, never a string key; `registry.unregister(K)` (the plan's prior text) would silently return `false` and never release the binding.
- `collision/geometry/activeRangeCompaction.js:130-165` — confirmed `compactAndWeld` returns two distinct `{oversized:true}` reasons: `geometry-too-large-for-sync-build` (an intentional, checked-first capacity outcome for `activeTriangleCount > maxSyncTriangleCount`) and `index-references-invalid-vertex` (a genuine malformed-data defect, found only after the capacity check passes) — confirming these must not be treated identically.
- `collision/geometry/createGeometryRegistry.js:100` — confirmed the production geometry registry itself treats `geometry-too-large-for-sync-build` as a normal diagnostic path, not an error, corroborating that F4 must not fail on it.
- `clashtest/viewer/populationScan.js:1-15` — confirmed `scanPopulation` throws `CapacityExceededError('whole-model-enumeration', ...)` above `maxCollisionInstancesPerEpoch`, before any per-fragment classification — the population-level organic-breach path F5 must map to `FAIL`, not `PASS`, per the review's own conflation finding.
- This plan's own prior text for the load-timeout/`cleanupUnresolvedOwnership` interaction (§4.2 vs. this round's own new §4.3 pending-token escalation), the "model load failure" fatal wording (§6.3) vs. §4.2's own non-fatal disposition, and the "Phase-12 close" reference (§6.6) against the actual phase table (§6.1, ending at Phase 11) — each confirmed as a genuine self-contradiction introduced or exposed by this round's own C1/H1/H3 fixes, by direct re-reading.

All 3 Critical findings and all 4 High findings were confirmed as real defects, not misreadings of an unstated intent.

---

## Findings, acceptance, and the fix applied

### Critical

1. **Cleanup invokes `registry.unregister` with the wrong identity.** Accepted. Fixed: §4.3's ledger steps 11/12 and the resource table now specify `registry.unregister(modelBefore)`/`registry.unregister(modelAfter)`, never `K`.
2. **The census timeout cannot interrupt the specified loop** (a microtask yield cannot release timer/task-queue callbacks; unclear execution realm). Accepted. Fixed: §6.4a's census mechanism is redesigned around an in-page, absolute monotonic deadline (`performance.now()`) checked and enforced entirely inside the same `page.evaluate` closure, with a genuine macrotask yield (`setTimeout(resolve,0)`, not `Promise.resolve()`) between batches; the per-operation token's Node-side state is now a report of what the in-page loop already decided, never the interruption mechanism itself. Cross-referenced from §6.4 and §7.4.
3. **Load failures and timeouts have contradictory verdict paths.** Accepted. Fixed: new §6.4b gives a normative, exhaustive load-stage outcome table (`Document.load`/`loadDocumentNode` × success/rejection/timeout/late-arrival) with each outcome's token state, cleanup action, `fatalErrorObserved` effect, classifier, and overall verdict; §4.3's pending-token resource-table row is corrected to escalate to `cleanupUnresolvedOwnership` only for operations that can actually leave shared `registry`/`world`/Viewer-model-set state unresolved (F6's own unload/reload), never for a still-timed-out initial load whose one-shot late-arrival handler already gives it a safe disposition; §6.3's fatal-flag summary line is corrected to explicitly exclude a model-specific load rejection, matching §4.2's own pre-existing disposition.

### High

4. **F4 treats a supported oversized marker (`geometry-too-large-for-sync-build`) as an API failure.** Accepted. Fixed: §7.4 now splits `compactAndWeld`'s two `{oversized:true}` reasons — `geometry-too-large-for-sync-build` is an informational count, never an F4 failure, its limit-conformance verdict owned by F5; `index-references-invalid-vertex` (and a non-finite `position` component) remain genuine F4 failures.
5. **F5 reports an organically over-limit fixture as `PASS`.** Accepted. Fixed: §7.5's success criteria no longer maps a correctly-thrown `CapacityExceededError` to `PASS` — an organic breach at either the population level or the new per-geometry `maxSyncTriangleCount` dimension (fed from F4's new `maxActiveTriangleCount`/`oversizedGeometryCount` fields) is now `FAIL` with `withinLimits:false`, `enforcementObserved:true` recorded separately as a positive, non-gating fact. The mandatory `capacity-breach` control remains the sole proof that enforcement itself works.
6. **Intentional page closure is assigned to a nonexistent phase.** Accepted. Fixed: §6.6's fatal-error ledger no longer references a nonexistent "Phase-12 close" — a `closeIntent` lifecycle flag, set to `'cleanup'` immediately before each owned `close()` call, is the actual signal these listeners check.
7. **"Verbatim" error retention is not JSON-safe or secret-safe.** Accepted. Fixed: §4.2 defines a bounded, allowlisted, depth/size-capped, circular-reference-safe, credential-redacting `describeError` serializer as the normative meaning of "verbatim" everywhere an error object is retained; §8 cross-references it for the atomic evidence write.

### Medium

8. **The plan lacks offline acceptance tests for its own state machinery.** Accepted. Fixed: §5 now requires offline, browser-free tests for `computeOverall`, the control-state model, the census deadline/yield mechanism, cleanup argument identity against real API shapes, and `describeError`/`closeIntent` — before any live SVF2 run is used to validate this machinery.

### Clarifying questions

- Q1 (can F1/F2/F8 `PASS` with nonzero `N`/`U`) — resolved: yes, already the plan's own design; made explicit in §10 item 8.
- Q2 (does F4 target raw Viewer-buffer compatibility or full `CollisionWorld` orchestration) — resolved: an intentional scope boundary, raw Viewer-to-collision-consumer path only; made explicit in §10 item 9.
- Q3 (`getAggregateHiddenNodes`'s exact return schema) — genuinely still open; recorded in §10 item 10 for the implementation to confirm by source/runtime inspection.

No finding was rejected. Per this remediation's own item 9, this review did not restart an unrestricted full-artifact pass — findings already accepted in §5a–§5d of the plan and not touched by this round's own fixes were not re-litigated.
