# Round 19 — Critical-only invariant fix pass: disposition

Type: system-level fix pass, Critical findings only (not a Codex review round — no `codex-review spec` pass
was run on the whole document, per explicit instruction). Source of truth: the adjudication of
`docs/superpowers/specs/invariant-audit-v2.md`'s Critical section, completed immediately before this pass
in the same working session (four independent verification agents, one per Critical, each re-checking the
audit's claims against current spec text, running source-level Viewer verification or `git diff` history
checks where needed, and consulting `codex-advisor` once each on the repair-direction judgment call).
Target: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (3851 lines before this
pass, 3935 after — 779 insertions / 144 deletions net, per `git diff --stat`).

Method: four parallel drafting agents (sonnet), one per Critical, each scoped to a textually distinct
region of the file to avoid edit collisions (extraction/fanout enforcement; `GeometryRecord` lifecycle;
`anyComponentInside` stage wording; room-cache rejection semantics). Each agent re-verified its own
Critical's current-text quotes before editing (line numbers had drifted since the audit was written), made
the edit directly via the `Edit` tool, updated or added the directly-required fixture(s), and reported back
a summary of what changed. The coordinating session verified there were no scope collisions (grep for
residual stale patterns after all four landed) and added one consistency edit not delegated to any agent:
a "Round 19" Revision Notes entry in the spec itself, matching the document's own established per-round
changelog convention.

## What was fixed

**C-1 (extraction / sync-work budget) — `maxChildrenPerNode` fanout enforcement.**
Round 18's two-layer mechanism credited `getChildCount(node)` as a cheap early-reject layer ahead of an
in-callback abort inside `enumNodeChildren`. The audit found, and this pass's own re-verification against
the pinned 7.124.2 bundle confirmed at the source level (`getNumChildren`/`enumNodeChildren`), that
`getChildCount` is O(1) only for a fragment-free node; for a node that owns fragments (the ordinary "mixed"
case) it linearly scans the identical `children[]` slots `enumNodeChildren` walks, with no early-exit hook
of its own — strictly worse than the bounded call it was meant to gate, since it pays the full unbounded
cost with zero interrupt capability. No public API offers an O(1) "is this node mixed" signal
(`getInstanceCount`/`getFragmentCount` have the identical negated/linear-scan shape). Per an independent
`codex-advisor` consult, the minimum correct fix is not "make the preflight conditional" (the audit's
candidate direction) but to **remove `getChildCount` from the enforcement path entirely** — a conditional
preflight can't discover cheapness without paying the same unbounded cost. Fixed: the in-callback abort
inside non-recursive `enumNodeChildren(node, cb, false)` is now the sole enforcement mechanism, for every
node shape alike, capping any single call at `maxChildrenPerNode + 1` callbacks. Edited: the Components
section's primitive list, the atomic-operations table's `maxChildrenPerNode` row (and the `maxFragmentsPerDbId`
row's cross-reference to it), Data Flow step 3, the Risks section, and the Testing fixtures (removed the
now-unreachable "or the node is mixed" disjunct; added fixtures pinning the abort firing identically for
fragment-free and mixed nodes, and a companion fixture for a node at exactly the ceiling). One node's direct
`enumNodeFragments(node, cb, false)` call remains untouched as the separate, already-accepted atomic risk
from Round 17 — explicitly not merged with or reasoned about identically to this fix, per instruction.

**C-2 (geometry / lifecycle boundary) — `GeometryRecord` cancellation ownership.**
Round 18's entry-scoped cancellation signal (letting `evictModel`/`dispose()` find and reject in-flight
builds) was scoped to `'building'`-state entries at every normative site, but Round 18's own `'ready'`
semantics allow a record to reach `buildState: 'ready'` (weld+BVH resolved) while its connectivity slot is
still unresolved and built lazily, on demand, by a later caller against that same entry — a fixture already
pinned this as required behavior. Both release paths' sweep text claimed to walk every entry regardless of
build state, but only settled the cancellation signal for `'building'` ones, so a `'ready'` entry's
in-flight connectivity build could have its registry entry deleted while any promise a caller held for that
slot was never rejected — the literal recurrence, one call deeper, of the "clearing a map does not by
itself settle a pending promise" failure the whole mechanism was built to close. An independent
`codex-advisor` consult confirmed this is a proven release-guarantee violation regardless of whether a
literal permanent hang follows (which depends on unstated scheduler-progress guarantees during teardown),
and validated the repair model. Fixed: the cancellation signal is now entry-lifetime-scoped, not
`buildState`-scoped — created once at entry insertion, kept unchanged across `'building' → 'ready'`, raced
by every phase slot the entry ever hosts (including a later lazy connectivity build), and settled
unconditionally by both `evictModel` and `dispose()` for every entry they remove, in the same operation,
regardless of build state. One signal per entry suffices (phases are sequential and single-flight per
entry, so at most one is ever unresolved at a time) — no per-phase signal registry was introduced. Edited:
the signal-introduction passage, `evictModel`'s settlement step, `dispose()`'s settlement step, and the
definitional "unresolved phase slots hanging off `'building'` entries" statement (corrected to cover either
build state); added an identity-guarded-removal corollary so a late-resolving cancelled continuation can't
republish state after the entry is gone. Added two new regression fixtures: `evictModel` and `dispose()`
each called while lazy connectivity is suspended on an otherwise-`'ready'` entry, both requiring the
connectivity promise to reject rather than hang.

**C-3 (query dependencies) — `anyComponentInside` stage-scoping wording.**
Two passages predating Round 18 (a Components-section paragraph and a Round-16 Revision Notes entry) stated
`volume-overlap` skips `anyComponentInside`'s stage 3 and, by contrast/omission, that `containment` runs it
— the exact inverse of the rule established by at least eight other passages in the same document,
including the algorithm section itself and Round 9's own fix, verified byte-identical against the
pre-Round-18 revision via `git diff` (confirming this predates Round 18 and was missed by both the v1 and
v2 audits' own model-extraction steps, which quoted the wrong paragraph while their own tables stated the
opposite). Per instruction, the fix does not restate the stage matrix a third/fourth time — it removes the
stage-attribution claim from both passages and replaces it with a cross-reference to the algorithm section
(the single source of truth). The Round-16 Revision Notes entry, being historical changelog text, was
annotated rather than rewritten, matching this document's existing pattern for flagging a superseded
historical claim without erasing the historical record. No fixture change was needed — the existing
regression fixture for this exact invariant was already correct.

**C-4 (cache ownership / lifecycle boundary) — room-cache rejection semantics.**
One passage stated every room-search rejection deletes its cache entry unconditionally; the invalid-lease
branch (and its extension to the error callback) stated the opposite — "leave the cache untouched" — with a
Round-18 fixture pinning the untouched side for exactly the input (a lease-invalidity rejection) the
unconditional rule also covered, making the contradiction mechanically observable rather than merely
arguable. An independent `codex-advisor` consult confirmed unconditional deletion is the more coherent
contract (a tombstoned/evicted or post-disposal `Model` object can never be re-admitted, so retaining its
cache entry has no correctness value) and recommended an identity guard to make the delete safe against a
newer promise occupying the same slot. Fixed: unified to one rule — every rejection path applies an
identity-guarded delete (`if (roomCache.get(model) === thisPromise) roomCache.delete(model)`) — removing the
"leave the cache untouched" exception from both the success and error callback descriptions. The fixture now
pins deletion (identity-guarded) instead of untouched, plus an explicit retry-after-rejection assertion for
the invalid-lease branch specifically.

## What was deliberately not touched

Per explicit instruction: no High/Medium/Low finding from `invariant-audit-v2.md` was fixed in this pass,
and no new architecture was introduced beyond what the four Criticals required. Still open, unchanged:
`tearDown()`/`keepCurrentModels` (H-L1/H-L2), listener-registration timing (H-L4), the two stale
pre-Round-18 Revision Notes disposal-rule entries (H-L7), `unload()`'s per-step isolation (H-L8), the
`CollisionInstance`-cache gap (H-2/H-3 cache-adjacent), `anyComponentInside`'s caller-list staleness
(H-Q1), the unobtainable containment precondition (H-Q2), the connectivity-trigger/parity-precondition gap
(H-Q4), `SurfaceCrossingWitness`'s scheduling-class ambiguity (H-B4), the broad-phase checkpoint-enumeration
gap (H-B5), `releaseEpochScopedState`/`dispose()`'s clear remaining unclassified in the atomic-operations
table (H-B6), the `bvhcast` shared-vs-own-clock abort timing (H-B7), the performance gate's own
pass-criterion self-contradiction (H-B8), the dangling instance-tree-readiness forward reference (H-B9),
the compaction-vs-gate ordering header/body transposition (H-G2/H-G5), and the full Medium/Low list
(including `referenceCount`, the `>=`/`>` boundary wording, and the `Round 18` disposition doc's own
"six Criticals" miscount in `invariant-audit-v2.md`, which is a defect in that audit document, not in the
design spec, and is explicitly out of scope for a spec fix pass).

## Verification

`node spike/fixtures.mjs` — **55/55 pass**, both before this pass began and after all four edits landed.
As with Round 18's disposition, this is expected and not strong evidence on its own: this pass edited only
the spec's prose (Milestone 1 has no implementation yet), and `spike/*.mjs` is a standalone algorithm
prototype the spec's fixtures describe but don't execute. It confirms this pass didn't touch or destabilize
the one executable artifact in the repo; it does not exercise any of the four Critical fixes, which live
entirely in normative spec text pending implementation.

A post-merge sanity grep confirmed no residual stale patterns from any of the four fixes: no `getChildCount`
occurrence outside historical/explanatory context (18 remaining occurrences, all either Revision Notes
history, the corrected table row explaining its removal, or fixture assertions that it is *never* called),
no `For a 'building' entry` gating language remaining at any of C-2's four cited sites, no unqualified
"leave the cache untouched" phrasing remaining (the two remaining occurrences are the new sentences
explicitly stating that exception no longer exists), and no stale stage-3 attribution outside the canonical
`anyComponentInside` algorithm section.

## Next step

A third invariant-driven audit, using the same five-system model methodology `invariant-audit-v1.md` and
`invariant-audit-v2.md` were built against (built fresh from this pass's own post-Round-19 text, not reused
from either prior model, to avoid falsely flagging this pass's own fixes as new deviations), is being run
now, producing `invariant-audit-v3.md`. Findings from that audit — including whether any of the four fixes
above introduced a new inconsistency, and whether the deliberately-untouched residuals listed here remain
correctly characterized — will be reported separately, Critical contradictions distinguished from
High/Medium/Low.
