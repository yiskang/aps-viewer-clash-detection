# Round 23 — Critical-only pass: close C-L1 (pre-existing lifecycle finding)

Scope: **C-L1 only**, from `invariant-audit-v6-lifecycle.md`. No other finding from that audit
(H-6C1, M-L1, M-L2, M-L3, L-L1, L-L2) was touched. No Codex *review* was run — this pass used
`codex-advisor` (medium) once, as a second opinion on the fix approach, per this repo's standing
preference for the Codex worker over the native advisor tool.

---

## C-L1 recap

`invariant-audit-v6-lifecycle.md` found the Milestone-1 "counterpart model eviction" acceptance
fixture (then at 3869–3873) unsatisfiable by construction:

- Milestone 1 requires `source.model === target.model` — so for any query, `S === T`.
- Every `GeometryRecord` is keyed by the *owner's* `(loadEpoch, geometryIndex)`; epochs are globally
  unique, so a record has exactly one owner `O`, and the narrow phase only awaits records for the
  candidate pair's own operand geometries — so `O === S === T` always.
- The fixture required the evicted "counterpart" to simultaneously be an operand of the initiating
  query (`counterpart === S === T === O`) and not the record's owner (`counterpart !== O`). Direct
  contradiction; unreachable in Milestone 1.

The normative rule the fixture pins — a build-phase checkpoint validates only the record's *owner*,
not the calling query's other operand (design doc, "A build-phase checkpoint validates the record's
*owner*..." bullet) — was independently re-verified this pass and found internally consistent, not
broken. It is satisfied vacuously under Milestone 1 and is written for forward compatibility with a
future cross-model milestone. **The fixture was wrong, not the rule.**

## Verification performed this pass

Re-derived the `O === S === T` argument directly against the live file (line numbers had shifted
+47 since the v6 audit, from unrelated intervening edits — content unchanged):

- Same-model entry gate: design doc lines ~900–903, 2558–2559 region (cross-model rejection).
- Owner-epoch record keying: ~1173–1176.
- Narrow phase only builds/gets the candidate pair's own operand geometries.
- The unsatisfiable fixture: now at lines 3916–3919 (pre-edit).
- The rule + rationale clause it exercises: now at lines 1332–1341 (pre-edit).

Confirmed the contradiction is real and unchanged by the intervening rounds.

## Fix decision

Consulted `codex-advisor` (medium) with both fix options from the v6 audit — (1) defer the fixture
and qualify the rationale as forward-looking, vs (2) replace it with a constructible same-model
variant — before editing. Codex's assessment, accepted in full:

- A same-model eviction fixture **cannot** exercise "validate only the owner, not the caller's other
  operand" as a regression test, because under Milestone 1 the owner and both operand roles are the
  same `Model` — there is no distinguishing case to assert. Keeping such a fixture in the counterpart
  fixture's place, still framed as "regression test for coupling a shared build's fate to one caller's
  operand list," would be misleading: it would look like coverage for a claim it cannot actually test.
- The rationale clause's present-tense claim that the entry "is shared with callers that may not hold
  that operand at all" is false for Milestone 1 (no such caller can exist yet) and worth correcting
  independently of the fixture fix, since it states a currently-unreachable scenario as if reachable.
- A same-model, two-waiter, owner-evicted fixture is still worth keeping — but under its own honest
  purpose (entry-scoped cancellation broadcast to every waiter of a single-flight build), not as
  counterpart-scoping coverage.

**Fix applied — modified option (1) + retained coverage under honest framing:**

1. **Rationale clause** (design doc, "A build-phase checkpoint validates the record's *owner*..."
   bullet): replaced the sentence claiming the entry "is shared with callers that may not hold that
   operand at all" with a forward-looking qualification — the owner-scoping is intentional, a distinct
   non-owner operand is unreachable under Milestone 1's same-model restriction so the distinction is
   not yet behaviorally observable, and it's retained for a future cross-model milestone. No other
   sentence in that bullet changed.
2. **Fixture** (previously "an eviction of the *counterpart* model while a shared build is in
   flight..."): replaced with a constructible same-model fixture — two concurrent `findClashes` calls
   against the *same* model, interleaved onto the same unresolved phase slot, followed by
   `world.evictModel(model)`. Asserts: the entry-scoped cancellation signal rejects exactly once, both
   `findClashes` promises reject with `ModelEvictedError` (neither hangs), the entry is removed from
   `GeometryRegistry`, and build spies show the shared phase started only once. Framed explicitly as a
   regression test for cancellation-broadcast, not for owner-vs-counterpart scoping — the fixture text
   itself states that the scoping distinction is untestable under Milestone 1 and points to the
   rationale clause for why the rule is retained anyway.

**Explicitly not done:** relaxing `source.model === target.model` (would expand Milestone 1's scope
and remove a lifecycle guard — ruled out by the original audit and not reconsidered).

## Verification after the edit

- `node spike/fixtures.mjs`: **55 passed, 0 failed.** (The spike covers only geometry classification —
  `classifyPoint`, connectivity, containment, volume-overlap, surface-intersection — and has no
  lifecycle/eviction/registry machinery; this run is a regression sanity check that the unrelated
  geometry spike is undisturbed, not a direct test of the lifecycle prose change.)
- Targeted re-read of the two edited sites plus everything Round 22's confirmation table and the v6
  lifecycle audit's "Confirmed unchanged" list depend on: no other passage asserts the "callers that
  may not hold that operand" scenario as reachable; no other fixture references the removed
  counterpart-model fixture by name or relies on it; the six protected Critical invariants (model
  identity/`loadEpoch`, disposed-first checkpoint semantics, and the other four outside this system's
  boundary) are untouched by either edit — both edits are confined to one rationale clause and one
  fixture bullet.
- `codex-advisor` (medium) consulted once on the fix approach itself (not run again after editing —
  the edit matches its recommendation verbatim in substance).

## Disposition

**C-L1: CLOSED.** The fixture is now constructible and its assertions are satisfiable under Milestone
1's actual entry contract; the rationale clause no longer states an unreachable scenario as present
fact; the normative owner-scoping rule is unchanged (it was never broken) and is now explicitly marked
forward-looking where the fixture can't yet exercise it.

**0 Critical invariant contradictions** found or introduced by this pass. No new High/Medium/Low
findings surfaced during this targeted pass (see the follow-up lifecycle re-audit below for the
system-level check).

H-6C1 and all Medium/Low findings from `invariant-audit-v6-lifecycle.md` remain open, untouched, out
of scope for this pass.

## Follow-up: targeted lifecycle re-audit

A second pass (subagent, read-only) independently re-derived the `O === S === T` argument against the
post-edit file, re-verified all protected Critical invariants byte-stable outside the two edited
hunks, and confirmed the new fixture's every assertion matches the entry-scoped-cancellation mechanism
text elsewhere in the doc. **C-L1 independently confirmed closed. Zero Critical regressions.**
H-6C1/M-L1/M-L2/M-L3/L-L1/L-L2 confirmed untouched.

Two new Low findings surfaced, both self-inflicted by this pass's own edit, not pre-existing:

- **L-R23-1** — the new fixture cited the rationale clause by hardcoded line range ("at 1332–1341"),
  the only such citation in the whole document (every other internal reference uses a named anchor) and
  already stale by one line at the moment it was written. **Fixed in this pass**: replaced with a named
  anchor ("A build-phase checkpoint validates the record's *owner*... above").
- **L-R23-2** — no Round 23 Revision Notes / changelog entry exists yet for this fix, matching the
  document's own convention (every other round has one) and the already-tracked "no Round-20 changelog
  entry" known item. **Not fixed** — out of this pass's stated scope (only C-L1's own two sites), left
  for whoever next updates the changelog/Revision Notes section, alongside the pre-existing Round-20 gap.
