# Round 17 Codex review

Type: spec
Effort: high
Input: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`
Request ID: 20260902-150925-39322-7629

Do not begin implementation until the extraction blocker and the High-severity contract ambiguities are resolved.

# Executive Summary

The specification contains strong geometric analysis, but it is not implementation-ready:

- The revised fragment ceiling still does not bound a single native enumeration call or a large zero-fragment node tree.
- Several public semantics remain contradictory, including containment, disposal errors, budget boundaries, and connectivity measurement.
- Transform lifecycle, pair generation, invalid-input handling, concurrent cache publication, and geometry validation lack normative contracts.
- The required performance gate is not reproducible or objectively passable.

The existing spike passes 55/55 fixtures, but it explicitly omits Viewer adapters, production caching, diagnostics, scheduling budgets, and lifecycle behavior. No files were modified.

# Critical Issues

## Native fragment extraction remains unbounded

**Severity:** Critical

**Location or section:** Data Flow—extraction (line 1866), atomic-operation table (line 1334), `InstanceTree` typings (`index.d.ts:667`).

**Problem:** The round-16 fix checks `maxFragmentsPerDbId` after each node's non-recursive `enumNodeFragments` call. That call still exposes only a `void` callback and no cancellation mechanism. One node can therefore enumerate arbitrarily many directly owned fragments before control returns. Likewise, `enumNodeChildren(node, callback, false)` enumerates every immediate child synchronously; fragment count does not bound a wide or deep tree containing few fragments.

**Why it matters:** The specification claims extraction's synchronous work is bounded by 5,000 fragments, but neither native-call size nor node count is bounded. The principal main-thread responsiveness guarantee remains false.

**Concrete failure scenario:** A single assembly node directly owns 100,000 fragments. `enumNodeFragments(node, callback, false)` invokes the callback 100,000 times before the caller can stop. Alternatively, a root has 100,000 empty children: fragment count remains zero while `enumNodeChildren` blocks and allocates a large child list.

**Recommended specification change:** Define a verified per-native-call bound. Either specify and test a supported early-abort mechanism, use a verified constant-time node-fragment-count preflight, or explicitly classify one node enumeration as an unbounded atomic operation. Add measured `maxNodesPerDbId` and `maxDirectChildrenPerNode` ceilings, use an iterative traversal with a visited-node guard, and checkpoint after each processed node. Do not claim `maxFragmentsPerDbId` bounds extraction until the single-node case is solved.

# Important Improvements (deferred — same High findings as round 16, restated this round; one now includes an additional concrete leftover)

- The containment contract is contradictory and incomplete (High).
- Candidate generation and self-pair behavior are undefined (High).
- Model readiness and transform consistency lack a contract (High).
- Canonical operand ordering is not deterministic (High).
- Invalid dbIds cannot be distinguished from valid empty nodes (High).
- Post-normalization geometry validation is undefined (High).
- Concurrent build publication is underspecified (High).
- Disposal and extension lifecycle behavior still conflict (High).
- Budget thresholds, diagnostics, and tests contradict one another (High) — this round's restatement explicitly names the leftover: "The performance gate still refers to `volume-overlap` excluding connectivity, directly contradicting round 16." **Confirmed real and fixed this round** (see Disposition) even though the rest of this finding remains deferred.
- The performance gate is not reproducible or objectively passable (High).
- Statistics, visible behavior, and the test harness are not executable contracts (Medium).
- Viewer typings are not reproducibly pinned (Medium).

# Questions / Clarifications

1. Are diagnosed positive `volume-overlap` pairs ordinary clashes, conservative candidates, or indeterminate results callers must suppress?
2. Are tolerances and budgets immutable constants, public options, or test-only injectable values?
3. When several rooms match, should the extension highlight all of them or report ambiguity?
4. What fallback invalidates model state if `BEFORE_MODEL_UNLOAD_EVENT` is missed?
5. Which error classes or stable codes are part of the public backward-compatibility contract?

# Positive Observations

- Surface contact, directed surface containment, and positive-volume overlap are intentionally separated.
- The tolerance-frame, parity, welding, and manifold discussions are unusually rigorous.
- Epoch-keyed cache identity and object-identity tombstones address model-ID reuse well.
- Abort control flow is explicitly prevented from becoming a fabricated clash.
- `node spike/fixtures.mjs` currently passes all 55 geometry fixtures.

# Overall Readiness

**Requires major revision**

# Disposition (applied to the spec after this review)

The Critical was accepted as a real, further-granularity gap in round 16's own fix — one non-recursive
`enumNodeFragments(node, cb, false)` call is a single opaque native call with no verified way to bound or
preempt its own cost. Fixed per explicit instruction, using the `aps-viewer-implementation-research` skill
to verify the actual API surface (official Reference Guide, not typings alone) before finalizing the
contract:

- **Verified, not inferred:** `getChildCount(dbId)` is documented on both the deprecated `InstanceTree`
  class and its replacement `Autodesk.Viewing.ObjectTree` as an O(1)-shaped preflight ("get number of
  children under the specified id," no enumeration). No equivalent exists for fragments on either class —
  `ObjectTree`'s documented enumeration method is `enumNodeInstances`, not `enumNodeFragments`, and neither
  class's documentation describes any way to learn a node's direct fragment/instance count without
  enumerating them.
- **Applied, scoped to the user's explicit fix direction rather than Codex's full recommendation:**
  `getChildCount(node)` is now the normative preflight before every `enumNodeChildren` call (verified, so
  no longer "where useful"). `maxFragmentsPerDbId` and the self-driven walk are re-described for what they
  actually bound — total work across the walk via early termination between nodes — not the cost of any
  single node's own `enumNodeFragments` call. That single call is now named explicitly as an accepted,
  non-preemptible Milestone-1 atomic risk (same category as the three `maxSyncTriangleCount` phases),
  added to the atomic-operations table and the performance gate for real-cost measurement, rather than
  inventing new ceilings (`maxNodesPerDbId`, `maxDirectChildrenPerNode`) or an early-abort/preflight
  mechanism the verified API doesn't support. This follows the round-16 fix's own standing instruction:
  "if no such mechanism exists, narrow the Milestone-1 contract honestly rather than inventing an
  unenforceable hard bound."
- **`InstanceTree`'s documented deprecation** (in favor of `ObjectTree`) was recorded as a noted-but-not-
  acted-on fact — out of this fix's scope, since the installed typings this spec targets still define
  `InstanceTree`/`enumNodeFragments`, and a full API migration wasn't requested.

The one directly related stale-wording item — the performance gate still saying `volume-overlap` excludes
connectivity, contradicting round 16's fix — was also corrected this round, per explicit instruction, even
though the High finding it belongs to ("Budget thresholds, diagnostics, and tests contradict one another")
otherwise remains deferred.

All other High and Medium findings were intentionally deferred — out of scope for this pass per explicit
instruction — and remain open for a future round. Per explicit instruction, no new review round was
launched after this fix; the next pass is planned as an invariant-driven consistency review of the full
spec rather than another single-diff patch/review cycle.
