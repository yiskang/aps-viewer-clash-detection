# Invariant Audit v7 — System 2: Geometry ownership / build pipeline

**Target**: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (4712 lines).
**Model**: `invariant-audit-v7-model.md` §2, with §1 / §5 cross-reads.
**Method**: every line citation below was read directly out of the current file during this pass. No prior
disposition document (`round-18-*` … `round-29-*`, `invariant-audit-v1` … `v6*`) was used as evidence that
anything is currently fixed; prior docs are cited only to establish *where past discussion happened* and to
label findings NEW vs. PRE-EXISTING.
**Changelog discipline**: `## Revision Notes (post-review)` (lines 40–799) is historical past-tense
narration. Nothing in that range is treated as a current invariant. All normative citations below are from
lines 801–4712 or the Status header.

---

## Verification of the four assigned invariants (all four: INTACT)

| Invariant | Status | Current-text evidence |
|---|---|---|
| **`(loadEpoch, geometryIndex)` ownership** | **INTACT** | 1222–1224 ("one `GeometryRecord` per unique `(loadEpoch, geometryIndex)` — keyed by the owning `Model` object's admitted load epoch, not its numeric `modelId`"); the dedup-key derivation at 1130–1139 ("the key must always be `(loadEpoch, geometryIndex)` — never `(modelId, geometryIndex)`, and never the bare index"); `modelId` demoted to display/diagnostic metadata at 1241–1244; the structural-disjointness argument at 3349–3357; `evictModel`'s restatement at 3138–3145; pinned by fixtures 4069, 4073–4074, 4271, 4301. |
| **Sequencing: active-range count → gate → compaction → weld → connectivity-when-required → BVH** | **INTACT as an ordering claim** | 1460–1482: compaction inserted "before welding and before anything is handed to `mergeVertices` — but only once the ceiling check below has passed"; `activeTriangleCount := Σ floor(ranges[i].count / 3)` at 1466–1470; "**`maxSyncTriangleCount` is checked against `activeTriangleCount` before any copying happens**" at 1476–1478; "Welding, connectivity, and BVH construction … all run over this **same** compacted buffer; none of the three ever sees a triangle outside the active ranges" at 1481–1482. Slot order at 1379–1383 ("weld first, then connectivity if it is needed, then the BVH"). Narrow-phase restatement at 2944–2947. Operator is strictly `>` (1476–1477, 3640), pinned at 4144–4148. **But see H7-G1: the first term of this chain has no specified producer.** |
| **Entry-lifetime cancellation signal (`GeometryRecord` cancellation ownership)** | **INTACT** | 1425–1443: created once at insertion in `'building'`, "kept alive, unchanged, for the entry's entire lifetime — the signal is *not* discarded or replaced when the entry transitions to `'ready'`"; every unresolved slot races it "including a lazy connectivity build started later against an already-`'ready'` entry"; both release paths reject it "exactly once … unconditionally, for every entry they remove regardless of whether its `buildState` is `'building'` or `'ready'`"; one-signal-per-entry justified by strict sequentiality (1436–1439); removal identity-guarded (1439–1443). Mirrored without drift at `evictModel` 3124–3134 and at `dispose()` 3236–3241 **and** in the parallel "Race safety" prose at 3436–3441. Pinned by fixtures 4086–4100 and 4114–4123. |
| **Oversized-marker carve-out** | **INTACT** | 1444–1452: three registry entry kinds; an oversized marking "carries no `buildState`", "every pair needing it is skipped", and "never has the entry-scoped cancellation signal … created for it at all — that signal is created exactly once, at insertion, for a `'building'` entry, a trigger an oversized marking never undergoes"; both sweeps still enumerate and remove it, "there is no signal on them to reject — removal is the entire cleanup". Carve-out restated at all four release sites: `evictModel` 3116–3120 and 3130–3131, `dispose()` code comment 3239–3241, `dispose()` prose 3439–3441. Single-flight participation stated at 1384–1388. Diagnostic scope/dedup at 2937–2944. Pinned by fixtures 4101–4113. |

---

## Critical findings

**None.**

---

## High findings

### H7-G1 — The active-range gate's own input has no specified producer, no specified cache, and no position in any pipeline the spec defines. NEW.

The gate is the first term of the assigned sequencing invariant, and its data source is unresolved.

- The gate reads `activeTriangleCount = Σ floor(ranges[i].count / 3)` (1466–1470, 2933–2936, 3637–3640).
- `ranges: TriangleRange[]` is produced by **`ViewerGeometryAdapter`**, whose only stated input is
  `viewer.impl.getRenderProxy(model, fragId).geometry` (1141).
- **`getRenderProxy` appears exactly twice in the whole document**: at 1141 (the component definition) and
  at 4568 (a Viewer-private-API-drift risk). **No pipeline step anywhere invokes `ViewerGeometryAdapter`.**
  Data Flow step 3's extraction walk (2730–2849) collects child ids, fragment ids, and
  `worldMatrix`/`worldBounds` only; the capacity-admission phase-1 capture list at 2856–2859 enumerates
  "`fragmentId`, `GeometryIdentity` (`loadEpoch` + `geometryIndex`), and this call's own
  `worldMatrix`/`worldBounds` snapshot" — geometry normalization is not in it.
- 1463–1465 nevertheless refers to the ranges as "already-normalized … (computed during **the earlier
  layout-normalization pass** — free, no per-triangle work)". **No such pass is defined anywhere in the
  document.** Fixture 4124–4126 uses the same undefined hand-wave ("whose `ranges: TriangleRange[]` (from
  normalization) …").
- The narrow phase reads the count **per candidate pair, for both operands, ahead of any registry access**:
  "for each candidate pair, check both geometries' **active-range triangle counts** … against
  `maxSyncTriangleCount` … **first** … **Otherwise** lazily get/build the `GeometryRecord`" (2933–2944).
  On the literal reading that is one `getRenderProxy` call plus one layout-normalization pass **per
  operand per candidate pair**, since no cache for the normalized output is named anywhere.

Consequences, each independently citable:

1. **Unimplementable as written at the boundary this invariant guards.** An implementer cannot tell whether
   normalization runs once per fragment during extraction, once per `(loadEpoch, geometryIndex)` on first
   registry touch, or once per candidate pair. The three differ by up to `O(candidate pairs)` Viewer calls.
2. **The gate is deliberately un-budgeted.** 1460–1461 states compaction's phase is "**not gated by
   `frameBudgetMs`** but by the ceiling itself", and the ceiling check itself has no checkpoint of its own
   in the phase list (1379–1383 begins at `weldPromise`). Whatever work the gate's input actually costs is
   therefore outside the checkpoint discipline and appears in **no** row of the atomic-operations table
   (1940–1952) and in **no** term of the worst-case-span formula (2049–2138). "Free, no per-triangle work"
   (1464) is true of the range *arithmetic* and says nothing about `getRenderProxy` or the layout branch
   detection at 1147–1216.
3. **The same silence extends to the normalization-failure path.** 3630–3636 says a fragment whose layout
   cannot be detected is "skip[ped]" with a fragment diagnostic — but with no stated stage, and with no
   registry entry kind to record the failure (1444–1446 enumerates exactly three: oversized marking,
   `'building'`, `'ready'`). See M7-G3.

**Partially resolvable sub-question (do not double-count).** The v7 model's `[AMBIGUOUS] 2.4.8` also asks
whether a `'building'` entry is ever inserted for a geometry that turns out oversized. That half **is**
resolvable, by inference, from 1446–1449: an oversized marking "never has the entry-scoped cancellation
signal … created for it at all — that signal is created exactly once, **at insertion, for a `'building'`
entry, a trigger an oversized marking never undergoes**." Insertion in `'building'` therefore cannot precede
the gate. It is never stated directly, and fixture 4133–4137 pins only that compaction is never called (zero
calls on the compaction spy), not that no entry was inserted — but the inference is sound. Rated Low-value
residual, folded into this finding rather than listed separately.

**Relative to prior dispositions**: Round 27's Cluster 1 closed the *ordering transposition* ("Before
welding, before the ceiling check…" vs. "before any copying happens") and Round 27 Cluster 3 named
`GeometryRegistry` as the marker and the diagnostic's dedup store. Neither touched *where the count comes
from*. `invariant-audit-v6-geometry.md` does not raise it either. **NEW.**

---

## Medium findings

### M7-G1 — No keyspace-relationship statement exists for `BlasCache` / cached `GeometryConnectivity` relative to `GeometryRegistry`. PRE-EXISTING (never dispositioned). **Overlaps system 5 (cache ownership) — flagged for that auditor.**

This is the `[SILENT]` the model-builder asked to be chased (model 2.6.4 / 5.3.2). **It is a real gap in the
current text, though narrower than the model states.**

What the current text *does* say (partial mitigation the model did not credit):

- 1308–1309: `ThreeMeshBvhBackend`/`BlasCache` "builds **one `MeshBVH` per `GeometryRecord`**, lazily, on
  first use."
- 1735–1736: `GeometryConnectivity` is "Computed **once per unique `GeometryRecord`** and cached alongside
  the BLAS (not per query, not per pair)."
- 1504–1512: the BLAS lives behind `accelerationPromise`, "one of that entry's single-flight phase slots";
  `BlasCache` "owns building the `MeshBVH` and caching it **behind that phase slot**"; it "owns no dedup
  mechanism of its own" (1389).

Those three establish a **per-record** relationship. They do **not** establish a keyspace, and the document
simultaneously maintains the opposite framing at three normative sites:

- `dispose()` "wholesale-clears **all four caches** — `GeometryRegistry`, `BlasCache`, every cached
  `GeometryConnectivity`, and the `CollisionInstance` identity cache — **each in its own single clear
  operation**" (3224–3227), repeated verbatim at 3429–3432. A structure that is purely the resolved value of
  a slot on a registry entry does not need its own clear operation, and would be emptied by the registry
  clear alone.
- `evictModel`'s release of these two is **derived from the registry sweep**: it drops each swept entry
  "together with its cached BLAS and cached connectivity where it has any" (3118–3120). A derived release is
  complete only if these keyspaces are subsets of the registry's — never stated.
- The atomic-operations sweep-cost row (1951) explicitly partitions the sweep into exactly **two** halves —
  "only the `GeometryRegistry` half" plus "an independent deletion over the `CollisionInstance` cache's own
  keyspace" — with **no third term** for `BlasCache`/connectivity. That is consistent with the
  slot-on-the-record reading and inconsistent with the four-independent-caches reading.

The asymmetry the model flags is real and sharp: the `CollisionInstance` cache received an explicit
keyspace argument for exactly this question — its keyspace is "built from every collected fragment, **a
strict superset of `GeometryRegistry`'s lazily-built candidate-pair keyspace**", which is why its release
must **not** be derived from a registry scan (1276–1280, restated at 3120–3124). No corresponding sentence
exists for `BlasCache` or connectivity. The only statement in the document about how those two are keyed is
**past-tense and describes the pre-Round-14 state**: "`GeometryRegistry`, `BlasCache`, and
`GeometryConnectivity` caches **were** keyed by `(modelId, geometryIndex)`" (3335–3336). The fix sentence
that follows updates only one of the three: "`GeometryRegistry` **now** keys every `GeometryRecord` by
`(loadEpoch, geometryIndex)`" (3350–3352).

**Severity rationale**: not High, because 1308/1735/1504–1512 make the intended design recoverable and no
release path is demonstrably incomplete under the recoverable reading. Medium, because a reader taking the
`dispose()` four-caches framing at face value gets a `BlasCache` with its own unspecified keys whose
`evictModel` release is derived from a different map with no stated subset relation — precisely the shape
that produced the Round-14 aliasing Critical.

**Relative to prior dispositions**: Round 27 Cluster 3 touched the *vacuousness* of the "together with its
cached BLAS and cached connectivity" clause for an oversized marking (fixed at 3118–3120), but not the
clause's keyspace premise. Round 25 (cache/concurrency) addressed the sweep-cost row's `CollisionInstance`
half. Neither addressed this. **PRE-EXISTING and never dispositioned.**

### M7-G2 — `GeometryConnectivity`'s definition still describes a pre-Round-16 range-restricted traversal; applied literally to the compacted-then-welded buffer it would index the wrong buffer. NEW.

1733–1735: "`GeometryConnectivity` (new) — decomposes the welded geometry into connected components by
union-find over triangles that share an **edge** (two vertex indices), **restricted to the active triangle
ranges**."

That clause predates Round 16's compaction phase and was not updated by it. Against the current pipeline it
is not merely redundant but wrong if executed literally:

- 1481–1482 is unambiguous that connectivity runs over the compacted buffer and "never sees a triangle
  outside the active ranges" — there is nothing left to restrict.
- The `TriangleRange.start`/`.count` values are offsets into the **raw** index/position buffers (1179–1189).
  Compaction "materialize[s] a **collision-owned, compacted position/index pair containing only the
  triangles those ranges cover**" (1465–1466), and welding then runs `mergeVertices` over it (1701–1705),
  which renumbers vertices. Original `ranges` offsets are meaningless against that buffer.
- Round 16 explicitly retired the structurally identical clause on the BVH side: "Round 16 also retired the
  previous 'set `groups`/`drawRange` on the BVH input' workaround … there is no out-of-range material left
  for a missing `groups`/`drawRange` configuration to fail to exclude" (1498–1502). The connectivity
  component's own definition never received that treatment.

**Relative to prior dispositions**: Round 27 Clusters 1–5 covered compaction/ceiling ordering, `L_X`
provenance, connectivity *trigger point*, oversized handling, and cancellation wording — not
`GeometryConnectivity`'s own triangle-set definition. **NEW.**

### M7-G3 — The fragment-diagnostic dedup rule covers one of three `FragmentDiagnosticReason` values; the other two share its justification but have neither a dedup rule nor a registry entry kind to cache the failure. NEW.

`FragmentDiagnosticReason` has three members (3511–3514): `'unsupported-geometry-layout'`,
`'rejected-primitive-range'`, `'geometry-too-large-for-sync-build'`. The union's own comment scopes all
three identically: "Discovered during geometry **normalization or the size check**, **independent of any
pairing**" (3533).

Only the third has a dedup rule: it is "**fragment-scoped and deduplicated** against a fragment-keyed set
scoped to this `findClashes` call: being oversized is a property of the geometry alone, not of the pairing …
so one entry is emitted per oversized fragment no matter how many candidate pairs it appears in"
(2939–2944). That reasoning transfers verbatim to a layout that cannot be detected (3630–3633) and to a
rejected legacy `offsets` layout (1210–1216) — both are properties of the fragment's geometry, not of the
pairing.

Compounding it: the oversized case has a **persistent registry entry kind** (the oversized marking,
1444–1452) so a repeat encounter short-circuits without redoing work. Normalization failure has no entry
kind — 1444–1446 enumerates exactly three, none of which is "unsupported". So on the per-pair reading of
2933–2944 (see H7-G1) an unsupported fragment is re-normalized, re-fails, and re-diagnoses once per
candidate pair it appears in, producing duplicate `scope: 'fragment'` entries in
`statistics.diagnostics` — the array the extension is instructed to surface as a user-visible caveat
(3634–3636).

**Relative to prior dispositions**: Round 27 Cluster 3 created the dedup rule for the oversized case and
named its store; it did not consider the other two reasons. **NEW.**

---

## Low findings

### L7-G1 — The canonical operand-order sort key is stale pre-Round-14 vocabulary and names two fields defined nowhere in the document. PRE-EXISTING, open since `invariant-audit-v1.md` L3.

1559–1565: "the pair is **canonically ordered before evaluation** — sorted by `(modelId, geometryKey,
instanceId)` — so the classification frame is a deterministic function of the pair, not of argument order …
`L_canonical` is then simply `L_X` of whichever instance sorts first."

- **`geometryKey` and `instanceId` occur exactly once each in the entire 4712-line file — here.** The
  design's actual vocabulary is `geometryIndex` (1130–1139, 1222–1223, 1251, 3138–3139, 3351) and
  `fragmentId` (1246–1251, 1270–1272).
- `modelId` as a sort component is the last operational (non-diagnostic) use of `modelId` in the document,
  against 1241–1244's "it plays no role in cache identity" and against the design's supported state of two
  simultaneously-live `Model` objects sharing one reused `modelId` (1284–1287, 3397–3399). It is harmless
  **only** because Milestone 1 rejects `source.model !== target.model` (2726–2729), so `modelId` is
  invariant within any admissible pair — a fact this passage does not state and does not rely on
  deliberately.
- Consequence if the terms were reconciled naively to `(loadEpoch, geometryIndex, fragmentId)`: identical
  behavior in Milestone 1, correct behavior in the cross-model milestone 1410–1411 explicitly plans for. The
  current key would be non-total across a reused `modelId` in that milestone.

Flagged as L3 in `invariant-audit-v1.md:330-331` and again in `invariant-audit-v2.md:475`; still present
verbatim. **PRE-EXISTING, never dispositioned.**

### L7-G2 — An oversized marking is never said to be re-evaluated, replaced, or superseded within a live epoch. PRE-EXISTING (model 2.2.2).

1444–1452 defines the marking's creation and removal (removal only via `releaseEpochScopedState` 3116–3120
or `dispose()` 3239–3241). Nothing states whether a marking, once written for `(loadEpoch, geometryIndex)`,
is ever re-derived. In practice this is near-moot — `maxSyncTriangleCount` is a fixed constant (1517) and
`activeTriangleCount` is a property of the geometry — so no in-epoch transition is reachable. Recorded for
completeness and because 1531–1537 explicitly contemplates the gate revising `12_000` ("the gate may revise
it again"), which would be a per-session, not per-epoch, change. No action implied.

### L7-G3 — An invariant-audit marker string has leaked into normative body text. PRE-EXISTING (model 0.5). Cross-system.

3683–3684, inside Error Handling's `maxCollisionInstancesPerEpoch` bullet: "…carrying no named error class,
the same `[SILENT]` gap those three share." `[SILENT]` is invariant-audit marker vocabulary, not spec
vocabulary; the three siblings it points at are `maxFragmentsPerDbId`, `maxChildrenPerNode`, and
`maxBroadPhaseInstancePairs`. Geometry-relevant only because two of those four ceilings
(`maxFragmentsPerDbId`, `maxChildrenPerNode`) are extraction-pipeline ceilings this system owns. The
underlying substance — four call-level ceiling rejections with no named error class — is a real gap but
belongs to systems 1 (error types) and 5 (cache capacity); recorded here only to avoid it falling between
auditors.

---

## Historical-only / non-defect observations

1. **`referenceCount` is NOT a current gap.** Model item 2.1.4 flags it `[SILENT]`. Current text at
   1225–1227 reads "with a `referenceCount` (**reserved, unused in Milestone 1** — release is epoch-scoped,
   not reference-counted; see 'Ownership and release are epoch-scoped' … and this record's own release paths
   below)". "Reserved and unused, with the reason release does not need it" is a complete contract for
   Milestone 1. Round 27's Cluster 3 fix is present and sufficient. **No finding.**
2. **The Round-16 changelog bullet's inverted ordering is historical and self-correcting.** 492–500 says the
   fix worked "by inserting active-range compaction as a phase **before the ceiling check** and before
   welding", then immediately self-corrects two clauses later ("gates first; only once that passes is a
   compacted … buffer materialized"). It sits inside `## Revision Notes` (40–799) and is preserved under the
   document's no-rewriting-history convention. Round 27 deliberately left it. Creates no live contradiction
   with the normative statement at 1476–1478. **No finding.**
3. **3335–3336's `(modelId, geometryIndex)` keying statement is past-tense narrative**, inside the "Race
   safety" prose block, describing the pre-Round-14 defect. It is not a current invariant. It is cited under
   M7-G1 only because the corrective sentence that follows it (3350–3352) updates one of the three caches it
   names, which is the source of that finding's asymmetry.
4. **Round 27's own claimed re-verification holds.** All three invariants Round 27 declared protected —
   entry-lifetime cancellation ownership, active-range gating/compaction/weld/connectivity/BVH phase order,
   and `(loadEpoch, geometryIndex)` identity with `modelId` as metadata — were independently re-derived from
   current text in the table at the top of this document and are intact. No geometry regression from Rounds
   28 or 29 was found.
5. **The `>` vs. `>=` boundary is settled and pinned.** 1476–1477, 2936, 3640 all read "exceeds"; fixture
   4144–4148 pins `activeTriangleCount == 12_000` as *must build*. Round 27 Cluster 1's fix is present.
6. **The owner-scoped build-phase checkpoint's Milestone-1 vacuity is disclosed, not hidden.** 1407–1411
   states the distinction "is not yet behaviorally observable" and is retained for a future cross-model
   milestone; fixture 4119–4123 says the same. Correct as written.

---

## Cross-system composition concerns (for the synthesis pass)

1. **M7-G1 is jointly owned with system 5 (cache ownership).** The question "what keyspace does `BlasCache`
   have, and is it a subset of `GeometryRegistry`'s" determines whether `evictModel`'s derived release
   (3118–3120) is complete. System 5 owns the `CollisionInstance` half of the same sentence (3120–3124) and
   the sweep-cost row's two-way partition (1951). **The two auditors must not converge on different answers
   about whether `dispose()` really clears four caches or two-plus-two-slot-sets.** Recommend the synthesis
   pass treat 3224–3227 / 3429–3432 ("four caches, each in its own single clear operation") and 1504–1512
   ("caching it behind that phase slot") as one reconciliation item, not two.

2. **H7-G1 crosses into system 4 (budget/scheduling).** The gate is stated to be outside `frameBudgetMs`
   governance by design (1460–1461), and its input-production cost is in no atomic-operations-table row
   (1940–1952) and no worst-case-span term (2049–2138). This is structurally the same shape as the model's
   `[SILENT] 4.3.2` (the `CollisionInstance` capacity admission's own O(unique-fragments) commit step, also
   unclassified) and `[SILENT] 4.2.4` (`SurfaceIntersectionQuery`'s traversal, also unclassified). Three
   independent unclassified synchronous units is a pattern the synthesis pass should weigh as one systemic
   finding about the taxonomy's completeness, rather than three isolated ones.

3. **H7-G1 crosses into system 1 (lifecycle).** If layout normalization happens lazily at narrow-phase time
   rather than during extraction, it is a Viewer call (`getRenderProxy`, 1141) made *after* the
   capacity-admission commit (2865–2872) and *after* the extraction walk's last yield (2860). Whether a
   checkpoint's two-part revalidation (2039–2047) is required before it — and what happens to
   already-committed canonical instances if it fails, which 1301–1303 / 2880–2883 explicitly declines to
   cover — is unaddressed. System 1 owns the checkpoint enumeration at 2962–2969, which does not list the
   normalization step.

4. **M7-G3 crosses into system 3 (query semantics/diagnostics).** The diagnostic-union comment at 3533
   scopes all three fragment reasons identically as pairing-independent, while only one has a dedup rule.
   System 3 owns the diagnostics taxonomy (3500–3626) and should confirm whether `ClashStatistics.diagnostics`
   is specified anywhere as a set rather than an append-only array — this audit found no such statement.

5. **L7-G1 crosses into system 3.** `L_canonical` and `minPenetrationDepth` (1564–1565, 1573, 1576) are
   defined off the canonical order whose sort key is the stale one. System 3 owns `ProperCrossingQuery`'s
   `offsetLadder` (1829–1844); the determinism claim at 1562–1563 ("Swapping the caller's arguments now runs
   the identical computation") is only sound because Milestone 1 forbids cross-model pairs.

---

## Counts

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | — |
| High | 1 | H7-G1 (NEW) |
| Medium | 3 | M7-G1 (PRE-EXISTING, never dispositioned), M7-G2 (NEW), M7-G3 (NEW) |
| Low | 3 | L7-G1 (PRE-EXISTING, open since v1), L7-G2 (PRE-EXISTING), L7-G3 (PRE-EXISTING, cross-system) |

**Spec not modified by this pass.** Audit-only.
