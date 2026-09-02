# Invariant-driven consistency audit — Round 2 (post-Round-18)

Type: invariant-model audit (not a Codex review round — no `codex-review spec` pass was run on the whole
document per explicit instruction).
Input: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (3851 lines, post-Round-18
system fix pass).
Prior work this audit checks: `docs/superpowers/specs/invariant-audit-v1.md` (the first invariant audit, 5
Critical + many High/Medium/Low, run against the pre-Round-18 3300-line spec) and
`docs/superpowers/specs/round-18-invariant-fix-pass-disposition.md` (the fix pass that closed v1's 5
Criticals plus H-G1/H-B1/H-B2/H-Q3, and lists known residuals it deliberately left open).

**Method, replicating v1's:** one agent built a fresh consolidated invariant model of the same five
interlocking systems (model/world lifecycle, geometry ownership/build pipeline, query mode dependencies,
synchronous-work/budget model, cache ownership/cleanup) **from the current post-Round-18 text** — not by
reusing v1's model, which documents pre-fix state and would cause this pass to falsely flag Round 18's own
fixes as new deviations. Five parallel agents then audited the full spec text against that fresh model, one
system each, cross-checking each other's territory where findings span systems, using v1's own findings as
a severity calibration reference and explicitly distinguishing **NEW** (introduced or newly exposed by
Round 18) from **PRE-EXISTING** (a known residual Round 18 deliberately left alone, severity unchanged) at
every finding. Two agents consulted `codex-advisor` on specific severity judgment calls (never a full
review pass). No spec edits were made in this pass — this is a report only.

The full invariant model these findings were checked against is reproduced in full at the end of this file
for reference.

---

# Critical

Six Critical contradictions were found across four of the five systems (lifecycle: zero — v1's C1/C2 and
this pass's H-L5/H-L6 are genuinely closed). Two of the six are new instances of the exact "claimed vs.
earned" defect pattern this whole audit lineage exists to catch, reproduced by Round 18's own fix for the
prior instance of that pattern (v1's C5). One is a genuinely new gap in Round 18's own C3 mechanism. Two are
pre-existing — one missed entirely by v1, one deliberately deferred by the fix pass and sharpened into a
literal contradiction by that pass's own new fixture.

## C-1 (extraction / sync-work budget). `maxChildrenPerNode`'s two-layer enforcement does not bound a *mixed* node — the C5 fix reproduces C5's own defect pattern at the layer meant to fix it

**Location:** the normative preflight-then-abort mechanism at **2183–2209**; the atomic-operations table
row at **2183–2191** and **2229–2233**; the worst-case-span formula at **1631–1648**; fixture **3422–3425**.

Round 18's C5 fix (this pass) replaced round 17's unenforced `getChildCount` "observation" with two stated
layers: (1) `getChildCount(node)` as a cheap early reject, called first; (2) an in-callback abort inside
`enumNodeChildren` that counts invocations and returns `true` at `maxChildrenPerNode`, capping that call at
`maxChildrenPerNode + 1` callbacks "regardless of the node's real fanout." The fix's own re-verification
against the pinned 7.124.2 bundle states the honest cost of layer 1: `getChildCount` "reads a precomputed
child count only for nodes that own **no fragments**; for a node that owns fragments the count is stored
**negated** and the implementation **linearly scans the child slots** to recover it — the same slots
`enumNodeChildren` walks. So it is O(1) on exactly the 'wide-but-fragment-empty' shape … and **Θ(direct
children) on a mixed node, where it saves a constant factor and bounds nothing**" (2183–2188) — and then
immediately mandates running it anyway: "**Call it first anyway**: if it reports more than
`maxChildrenPerNode`, the walk does **not** call `enumNodeChildren` on that node at all" (2188–2191).

Compose those two sentences on a node that owns ≥1 fragment (a "mixed" node — the ordinary case, not the
edge case) with a pathologically large direct-child count. `getChildCount` runs first and performs an
unbounded, non-preemptible, native linear scan of every child slot **before** the bounded layer 2 (the
in-callback abort) ever gets a chance to run — and once it returns, the walk rejects without ever calling
`enumNodeChildren`, so layer 2's bound is never exercised for this shape at all. The exact pathological span
`maxChildrenPerNode` exists to prevent still happens, relocated from `enumNodeChildren` to `getChildCount`.
This falsifies 2231–2233's claim that the abort "caps the call at `maxChildrenPerNode + 1` callbacks
**whatever the node's true fanout**" — that is only true for a fragment-free node whose count `getChildCount`
can read in O(1), or a mixed node whose `getChildCount` happens to under-report.

A companion normative statement compounds it: **1646–1648**, Round 18's own rewrite of the worst-case-span
formula (fixing v1's H-B2), states the formula "**does** bound … the `maxChildrenPerNode`-capped
`enumNodeChildren` call" — a **time** claim — while the very row it's describing (**1580**) refuses that
exact claim in the same pass's text: "**This spec does not claim `10_000` callbacks fit inside
`frameBudgetMs`**," and explicitly declines to borrow any existing measured figure as a proxy for the
per-callback cost. And a **fixture**, also new in this pass (**3422–3425**), requires testing "once where
`getChildCount`… under-reports **or the node is mixed** (the early reject **passes** and the in-callback
abort is what stops the call)" — a scenario the Data Flow text at 2183–2187 says is only possible when
`getChildCount` happens to under-report, not simply because a node "is mixed," since an accurately-reporting
mixed node's early reject *fires*, and `enumNodeChildren` — and the fixture's own asserted code path — never
runs.

**Why Critical:** three independent normative statements, all authored in this fix pass, cannot all be true
of a mixed node with a large child count: (a) the mechanism enforces a bound "whatever the node's true
fanout," (b) the mechanism's own cost analysis says the preflight is unbounded and "bounds nothing" for
exactly that shape, and (c) the worst-case-span formula claims to bound the resulting span while the same
pass's own text on the very same row refuses to. This is v1's C5 pattern — "a verified cheap observation
credited as an enforced ceiling" — reproduced one call deeper by the fix that was supposed to retire it,
inside the same document, in the same revision. An implementer following the normative pseudocode at
2176–2209 builds a design where a mixed pathological node still stalls synchronously and unboundedly, with
no enforcement action ever firing to stop it — the precise failure this whole audit lineage traces back
three rounds.

**NEW** — every passage cited is Round 18's own text; the defect did not exist in any form pre-pass (round
17's `getChildCount` had no enforcement mechanism at all, so it could not have this failure mode).

**Minimal repair direction:** either make the `getChildCount` preflight conditional on it being cheap (skip
it, or bound its own cost, for a node known to own fragments) and rely on the in-callback abort as the sole
enforcement layer for mixed nodes; or state plainly that mixed nodes are not bounded by this mechanism and
fold that cost into the same accepted-atomic-risk category as row 3 (`enumNodeFragments`), removing the
"whatever the node's true fanout" claim and the formula's inclusion of this row.

## C-2 (geometry / lifecycle boundary). The `'building'`-only cancellation-signal release gate does not cover an unresolved connectivity slot on a `'ready'` record — the exact "in-flight build survives disposal" failure C3 was raised to close

**Location:** the release mechanism's own scoping, stated three times — **1104–1108**, **2484–2488**,
**2579–2582**, and definitionally at **2770–2772** — contradicted by **1077–1084** and fixture **3360–3365**.

C3's fix (this pass) introduced an entry-scoped cancellation signal every unresolved phase slot races, so
`evictModel`/`dispose()` can find and reject in-flight builds — closing v1's C3, which was exactly "an
in-flight build that survives `dispose()` unrejected." Every statement of that mechanism scopes it to a
`'building'` entry: "**A `'building'` entry** carries an entry-scoped cancellation signal…" (1104–1105); "For
**a `'building'` entry** it first rejects that entry's cancellation signal" (2484–2486); "every entry still
in **buildState 'building'** is reachable…" (2579–2580); and, stated as a definition, "the unresolved phase
slots hanging off the registry's **`'building'` entries** *are* the in-flight builds" (2770–2772).

But the same fix's own `'ready'` semantics (1077–1084) establish that a record reaches `buildState: 'ready'`
once weld+BVH resolve, "**whether or not the connectivity slot was ever created**" — `containment`/
`volume-overlap` "additionally await connectivity's slot **on that same entry**, created on demand," and
"**Connectivity is never what makes a record un-`'ready'`**." Fixture 3360–3365 pins exactly this state as
required behavior: a `containment` caller reusing a `'ready'` record "must **drive the connectivity phase
itself against that same entry**" — meaning a `'ready'` record can, by design, carry an unresolved
connectivity phase slot in flight.

The release mechanism does not reject that slot. Under 2484's literal scope ("For a `'building'` entry…"),
`evictModel`/`dispose()` skip the cancellation step for any `'ready'` entry and drop it directly — so a
connectivity build racing that eviction is neither found nor rejected, and 2770–2772's own definitional
claim ("the unresolved slots hanging off `'building'` entries *are* the in-flight builds") is false of this
reachable state.

**Why Critical:** two normative statements are mutually exclusive — the release scoping rule and the
`'ready'`-with-pending-connectivity state the same pass's own model requires to exist — and the loser is
precisely the guarantee v1's C3 was raised to protect. C3's own stated rationale for the whole mechanism
("Clearing a map does not by itself settle a pending promise, which is what both of those guarantees
require," 1107–1108) applies word-for-word to this case and is not honored by it. A `containment` caller
awaiting that connectivity slot when the world is disposed has its `findClashes` promise left permanently
unsettled — the one outcome 1092–1094 declares impossible, declared impossible only for the case the
release mechanism actually covers.

**Hedge, stated by the auditor who found this:** if every phase is synchronous once started (consistent
with the atomic-operations table), the only suspension point inside a connectivity slot is its own
pre-phase checkpoint, whose resume path independently checks `disposed`-then-epoch and could reject the
slot on its own — in which case the harm is confined to the spec's stated guarantee being false rather than
an observable hang. But if that checkpoint alone were sufficient, the cancellation signal 1104–1108
introduces would be unmotivated by its own stated rationale; the spec cannot coherently be read as needing
the signal for `'building'` entries but not for this reachable `'ready'` state.

**NEW** — the entire mechanism, and the `'ready'`-with-lazy-connectivity model it fails to cover, is Round
18's own text.

**Minimal repair direction:** state the release trigger as "any entry carrying an unresolved phase slot" at
all four cited sites, not "a `'building'` entry" — the identity-guarded deletion logic already generalizes
without further change.

## C-3 (query dependencies). Two summary passages state `volume-overlap` skips the stage it actually runs, and `containment` runs the stage it actually skips — inverting round 9's own fix

**Location:** **1040–1041** (Components section, inside this pass's own connectivity-correction paragraph)
and **445–446** (Revision Notes, round 16). Contradicted by **1841–1849**, **1851–1852**, **1863**,
**1953–1959**, **2015**, **1230**, **196–201**, and fixture **3292–3299**.

1040–1041: "`volume-overlap` only skips `anyComponentInside`'s *stage 3* (the constructed interior witness),
never its component decomposition (stages 1–2) — so it needs connectivity exactly as much as `containment`
does." Repeated at 445–446. Both say `volume-overlap` runs stage 3 and `containment` does not (by omission,
since `containment` is the mode that would otherwise be said to skip it).

But 1841 states outright: "**This stage is scoped to `volume-overlap`; `containment` never runs it**, and
round 9 was the correction of an earlier draft that ran it in both." 1851–1852: `containment`'s use of
`anyComponentInside` "therefore stops after stage 2." 1953: the first `containment` term "uses only
`anyComponentInside`'s stages 1–2 … never its stage-3 constructed interior witness — round 9's fix." 1863:
"Only if all three stages fail (`volume-overlap`) or the first two fail (`containment`)." 1230 scopes
`witnessLadder` to "`anyComponentInside` stage 3, `volume-overlap` only." 2015 scopes the constructed-
interior-witness stage "(`volume-overlap` only)." Fixture 3292–3299 exercises stage 3 as the mechanism that
resolves an all-`boundary` component specifically in `volume-overlap` mode.

**Why Critical:** two normative statements are mutually exclusive on a basic mode-scoping fact, and the
wrong statement sits in the Components section — the section the invariant model itself treats as the
primary normative surface, and the section a Round 18 pass edited directly (1040–1041 sits inside this
pass's own H-Q3-adjacent connectivity-correction text) without noticing it inverted round 9's fix. Following
1040 literally reproduces both halves of round 9's regression at once: `containment` regains a witness stage
that steps off the source's surface (violating the surface-only contract at 1303/2386 and failing fixture
3292–3299's directedness-adjacent sibling), and `volume-overlap` loses the only stage that can resolve an
all-`boundary` component (failing fixture 3191–3192, per the geometry-pipeline finding this overlaps with).
The mitigating factor: the `anyComponentInside` algorithm section itself (1806–1866) is complete,
self-consistent, and carries round 9's own counterexample in full, so an implementer who reads that section
first gets it right — a reviewer could defensibly grade this High on that basis instead.

**PRE-EXISTING, and not previously reported.** Verified byte-identical against the pre-Round-18 revision
(lines 434 and 907) — Round 18 did not touch either site. Both v1's invariant model and this pass's fresh
model reproduce line 1040's claim verbatim in their own §3 summaries while their own mode-dependency tables
assert the opposite (table row: `containment` → stages 1–2; `volume-overlap` → stages 1–3) — which is
exactly how this survived two audits: the table is right, the prose paragraph next to it is wrong, and nine
rounds of Codex review plus this audit lineage's own model-extraction step both quoted the table and missed
the paragraph.

## C-4 (cache ownership / lifecycle boundary). Room-cache deletion on rejection is specified two mutually exclusive ways, and Round 18's own new fixture pins one side against older, still-standing prose

**Location:** **2069–2075** vs. **2100–2101**, **2130–2135**, and fixture **3570–3575**.

2069–2075, unconditional: "**A room-search promise that rejects is removed from the cache, not left
cached.** … On rejection, the handler deletes that model object's cache entry (in addition to still
rejecting the caller's in-flight call), so the next call retries `model.search` fresh rather than replaying
a stale failure." 2100–2101, the invalid-lease branch (part of this pass's own H-L5 fix): "**invalid** (the
model was evicted, or the world disposed, sometime between admission and the callback firing) → reject, and
**leave the cache untouched**." 2130–2135 extends this to the error callback: "follow the same shape …
apply the identical disposed-first mapping above," closing with "Both callbacks use one mapping; a design in
which the two callbacks classify the same invalid lease differently is a bug." Fixture 3570–3575, new in
this pass, asserts "the cache must be left untouched" for exactly this case.

A room search that rejects **because** its lease went invalid — the ordinary eviction/disposal case — sits
inside both the unconditional "always delete" rule and the "leave untouched" rule. No precedence is stated
anywhere between them.

**Why Critical:** the two statements are literally mutually exclusive for one clearly identified input, and
an implementer who builds 2069–2075 as written now **fails a shipped fixture** — the contradiction is
mechanically observable, not merely arguable. A `codex-advisor` consult independently reached Critical on
the same reasoning. **Important caveat, on the record because the auditor who found this insisted on it:**
real-world impact is far smaller than any other Critical in this audit or v1's. `isLeaseValid` returns
`false` only for a permanently-tombstoned model or a terminal disposed world, so a stale retained cache
entry can never cause an incorrect *positive* retry outcome — a fresh retry hits `admitModel` and rejects
with the identical error class the stale promise would have replayed — and the `BEFORE_MODEL_UNLOAD`
handler deletes the entry unconditionally regardless (2798–2802), so the entry doesn't even outlive the
model's actual unload. This is a rubric-satisfying, low-blast-radius Critical: it belongs at the top of the
list by the letter of the severity bar this audit lineage uses, but a reader triaging by consequence rather
than by contradiction-shape should treat it as the least urgent of the six.

**NEW vs. PRE-EXISTING — mixed, and load-bearing to know which half.** "Leave the cache untouched" is
**pre-existing** verbatim (present pre-Round-18). **New in this pass:** the fixture that converts prose into
a binding, checkable assertion (3570–3575), and 2130–2135's extension of the untouched rule to the error
callback, which pre-pass said nothing about the cache at all and is precisely the callback the unconditional
2069–2075 rule was written for. Round 18 did not create this tension but tightened both sides until they
collided and then pinned one side in a test — this was flagged as a residual in the fix-pass disposition
doc ("Room-cache deletion is inconsistent pre-existing… Preserved as-is") but its severity was not assessed
there; this audit assesses it as Critical by the stated bar, with the impact caveat above.

---

**A note on what these six do and do not have in common.** C-1 and C-2 are genuinely new, both introduced
by this fix pass's own two flagship mechanisms (the `maxChildrenPerNode` enforcement and the
`buildState`/cancellation-signal model), and both are the kind of defect this whole audit method exists to
catch — a normative claim that reads correctly in isolation but is falsified by another normative claim
elsewhere in the same pass. C-3 is a genuine miss by v1 and by this pass's own model-building step, sitting
in prose that both audits' models happened to quote without cross-checking against their own tables. C-4 is
the sharpest instance of a residual the fix pass saw and explicitly chose not to resolve, turned into an
actual contradiction by the same pass's own new test coverage. None of the five drafting/auditing agents
consulted on C-1 through C-4 with each other in real time — each surfaced independently from its own
system's territory, which is itself a data point on how load-bearing each is (C-1's mechanism was found from
both the sync-work-budget and, implicitly, the extraction side; C-2 was flagged by the geometry auditor
and is exactly the seam the lifecycle/geometry hand-merge in this fix pass touched).

---

# High

Grouped by system. NEW/PRE-EXISTING and location as verified by each system's auditor.

**Lifecycle**

- **H-L7. Two Revision-Notes entries still state the pre-Round-18 disposal rule, one calling `isLeaseValid`
  "*the one*" exception.** Line 322–323 (round 12): "`dispose()` now sets a world-level terminal flag…
  which reject/throw `WorldDisposedError`… once set" — no exception named. Lines 383–385 (round 14),
  present-tense: "Resolved by making `isLeaseValid` **the one** deliberate, documented exception…" Both
  contradicted by four normative sites (2514–2519, 2568–2576, 3054–3059, fixture 3562–3569). An
  implementer who takes the changelog as current rule reconstructs the exact C2 bug this pass fixed. Stops
  short of Critical only because Revision Notes are explicitly historical, and four normative sections
  supersede them — but 383–385's present-tense phrasing ("it stays," "now says so") reads as current rule.
  **NEW** (Round 14's entry was accurate until this pass's C2 fix made it false).
- **H-L8. `unload()`'s ordering plus the guaranteed second-`dispose()` throw strands the listener and cache
  cleanup.** The new ordering note (2784–2797) analyzes only the `evictModel`-throw hazard and concludes
  "benign" — but never considers that the spec **guarantees** exactly one throw from step 1 of `unload()`:
  a second/repeated `dispose()` throws `WorldDisposedError` (2565–2567, 3052–3054), which `Viewer3D.tearDown`
  swallows, stranding listener removal, context-menu removal, and the room-cache clear — the same room
  cache 2545–2547/2798–2802 argue `dispose()` specifically does *not* cover. Whether `dispose()` may be
  called independently of `unload()` is unstated anywhere (M10). **NEW-exposed** (the ordering note is new;
  the underlying isolation gap is the openly-deferred H-L3).
- **H-L9 (= geometry's H-2, cross-filed). "There is no `'failed'` state" is scoped to lifecycle-triggered
  rejections in the body (1095–1103) but stated generally in the heading and at changelog line 545–546
  ("a rejected phase removes the entry synchronously so no half-built record is ever observable" —
  unqualified).** See the full writeup under Geometry below; filed here too because both release paths and
  both error types are lifecycle's territory. **NEW.**
- **H-L1 / H-L2 (`tearDown()`/`keepCurrentModels` trap). PRE-EXISTING, deliberately untouched — confirmed
  unregressed, newly sharpened.** `keepCurrentModels`: zero occurrences in 3851 lines (grep-verified).
  `tearDown` appears exactly twice, both as Viewer-internal citations in this pass's own C2 evidence chain
  (2530, 2789) — the spec now *quotes* the function that unloads every extension on a model switch, using
  it only to reason about throw propagation, never about the extension's own survival, while Data Flow
  step 1 (2038–2041) still assumes the extension survives a model switch. Round 18 did not regress this;
  it made the omission harder to defend.

**Geometry pipeline**

- **H-2 (geometry). "There is no `'failed'` state" covers only lifecycle-triggered phase rejections; any
  other phase failure (a `mergeVertices` throw, a `MeshBVH` constructor failure) leaves a permanently
  poisoned `'building'` entry every future caller awaits and replays forever.** Full writeup: see Critical
  section's C-2 sibling discussion and the Cache-ownership H-2 entry below (both systems independently
  found this; cache ownership's writeup is the more complete one and is the canonical version). **NEW.**
  The fix-pass disposition doc's framing ("connectivity failing on an already-`'ready'` record") understates
  the scope — it applies to every phase slot on every entry, not just connectivity on `'ready'` records.
- **H-3 (geometry / cache). An implied `CollisionInstance` cache is named by the checkpoint protocol (2718)
  and asserted on by fixture 3496–3503 ("same object references, no rebuild triggered"), but is declared,
  owned, keyed, and released nowhere.** An implementer who builds what the fixture requires leaks
  model-scoped strong references on both release paths, falsifying `evictModel`'s own stated purpose
  (2508–2510). **PRE-EXISTING** — both references exist verbatim pre-Round-18; the model flagged only a
  bare `[SILENT]` and never connected it to the fixture.
- **H-G4. "This spec's connectivity-trigger rule" (1082–1083, new phrasing) forward-references two passages
  (2324–2326, 1033–1035) that still disagree with each other (M1) — the misdirecting singular reference is
  new even though the underlying disagreement is v1's pre-existing M1.**
- **H-G5 = H-G2 (compaction-vs-gate ordering header/body transposition, 435–436 vs. 1119–1136).
  PRE-EXISTING, verbatim unchanged, confirmed byte-identical against pre-pass text — correctly left alone
  per the fix-pass's explicit scope.**

**Query dependencies**

- **H-Q1 (`anyComponentInside`'s caller list stated three incompatible ways, 1677–1678 vs. 2021 vs.
  1035–1042). PRE-EXISTING, unchanged, confirmed byte-identical, explicitly out of Round 18's scope.**
- **H-Q2 (the containment guarantee's precondition — `ProperCrossingQuery` returned false — is unobtainable
  in `containment` mode, since that mode's composition has no `ProperCrossingQuery` term). PRE-EXISTING,
  unchanged, confirmed byte-identical, explicitly out of Round 18's scope.**
- **H-Q4. The connectivity trigger rule (1033–1035, 2324–2326) is stated purely in terms of
  `anyComponentInside`, which decomposes only the *source* — but the *target's* connectivity is separately
  consumed by the parity-closure precondition (1784, 1794–1795, "reads a cached flag rather than adding a
  pass"), which no trigger rule accounts for.** An implementer building connectivity per the stated rule
  builds it for the source only, leaving the target's manifold flag unavailable when the parity precondition
  needs it — plausible failure mode is a silently-skipped `unverified-parity-operand` diagnostic rather than
  a crash. Hedged: 2324–2326's phrasing is mode-scoped and could be read as covering both operands. **A
  sharper reading of v1's pre-existing M1, newly load-bearing under Round 18's per-slot model** (which
  explicitly declines to name the trigger point, 1080–1083) but no wording was made worse.
- **H-B4 (cross-filed with sync-work budget; both systems' auditors flagged this independently).
  `SurfaceCrossingWitness`'s scheduling class is still stated two incompatible ways — "plain JS loop, no
  native traversal in the way" (1899–1902) vs. "same traversal and budget as the other two modes" (i.e.
  `bvhcast`, which cannot be paused, 1546–1548) (2004–2005). PRE-EXISTING, unchanged, explicitly out of
  Round 18's scope — the sole remaining unclassified scheduling site after this pass made every other
  loop's class explicit.**

**Synchronous-work / budget model**

- **H-B5. The canonical checkpoint-site enumeration (2340–2344, 2352–2356) was never updated for Round 18's
  own new intra-broad-phase-scan checkpoint** — present and correct in the scan's own Data Flow bullet, the
  table row, Error Handling, and the gate, but absent from the paragraph that defines the checkpoint
  architecture as a whole, which is the paragraph an implementer builds the scheduler from. **NEW**
  (cross-reference sweep gap in the H-B1 fix).
- **H-B6. Rows 21–22 (`releaseEpochScopedState`/`dispose()`'s clear) — recommended upgrade from v1's Medium
  (M2) to High.** Round 18's C3 fix turned both from "drop some map entries" into real per-entry enumerative
  passes with per-entry promise rejection (2482–2488, 2578–2582), yet remain absent from the
  atomic-operations table and the performance gate, and the non-throwing justification still describes the
  pre-C3 operation in the singular ("a synchronous map/set removal," 2498). These are now the only
  synchronous spans in the design with neither ceiling, checkpoint, nor measurement requirement — and they
  run inside the one Viewer call frame (`BEFORE_MODEL_UNLOAD_EVENT`) whose fragility C2 spent 60 lines
  documenting. **PRE-EXISTING in substance (v1 M2), materially enlarged and newly self-inconsistent as a
  direct result of Round 18's C3 fix.**
- **H-B7. `bvhcast`'s time-based abort measures elapsed time since the *traversal's own start* (1524–1525),
  not the *shared* accumulator every other checkpoint uses ("since the last yield," 2344–2345) — so a
  traversal beginning just under the shared budget can legitimately consume a full fresh `frameBudgetMs`
  before aborting, producing a single synchronous span of up to ~2× `frameBudgetMs` plus one probe,
  defeating the stated reason `frameBudgetMs` is 8ms rather than 16ms in the first place.** Hedged — "roughly"
  at 1631 gives slack, but nothing forces a yield immediately before a `bvhcast` call. **PRE-EXISTING**
  (round 10/11 text, untouched by Round 18, and not identified by v1 or this pass's own model — found only
  by this system's auditor going beyond the model's own flagged items).
- **H-B8. The performance gate's own top pass criterion ("no single synchronous task exceeds `frameBudgetMs`'s
  tolerance band around ~16ms," 3642) directly forbids what the design, via H-B2's own rewrite, now
  explicitly accepts as out-of-guarantee (row 3's `enumNodeFragments` risk).** The gate never states what a
  measurement above 16ms on that accepted-risk row means for pass/fail. **NEW as an explicit contradiction
  (H-B2 made the exclusion normative); PRE-EXISTING as the underlying gap** (row 3 was already unbounded in
  round 17).
- **H-B9 (cross-filed with extraction/Risks). C4's coverage-equivalence argument rests on "a complete
  instance-tree snapshot," deferred twice to Risks (892, 3415–3416) — and Risks contains zero occurrences of
  `isObjectTreeCreated` or any instance-tree-readiness entry.** Both forward references are dangling. **NEW
  as dangling references; PRE-EXISTING as the underlying gap (H-G4 from v1).**

**Cache ownership**

- **H-2 (cache) — see Critical-adjacent writeup above under Geometry; canonical text also appears in the
  cache-ownership auditor's report verbatim, independently derived.**
- **H-3 (cache) — the `CollisionInstance`-cache gap; see Geometry's H-3 above, same finding, independently
  derived by two auditors.**

---

# Medium

Grouped by system, condensed — full detail (quotes, exact line ranges, hedges) is in each system auditor's
original report if a future pass needs it; every finding below was independently verified against the
current file by the coordinating session before inclusion.

**Lifecycle**
- M-L1. The two extraction-walk yield sites (2161–2165, 2238–2240) are the only checkpoints whose *local*
  text omits the two-part revalidation this pass added everywhere else; the global statement (2357–2360)
  still covers them. PRE-EXISTING, Codex-confirmed Medium not High.
- M-L2. "Every checkpoint, coarse or fine, checks `disposed` first, then re-validates load epoch" (2357–2360)
  is false for the `bvhcast` abort-only checkpoints named two lines earlier — harmless in practice (no
  eviction can land mid-traversal that matters) but a wrong universal claim. PRE-EXISTING, not previously
  flagged.
- M-L3 = C-4's sibling in cache-ownership framing (room-cache deletion two ways) — cross-filed, see Critical.
- M-L4. `dispose()` never clears `liveModelByModelId`, the design's one strong-reference cache. PRE-EXISTING
  (disposition's L5).
- M-L5. Neither `maxFragmentsPerDbId`'s nor `maxChildrenPerNode`'s plain call-level rejection has a named
  error type, while callers are told they may branch on error class (fixture 3524–3527). PRE-EXISTING,
  widened by this pass adding a second such unnamed path.

**Geometry pipeline**
- M-G1. `L_X` is a record field outside the phase-slot model (1211–1214), readable off a `'building'` record
  under the letter of the read prohibition at 1074–1076, which enumerates only three products and omits it —
  silent `NaN` risk, not a crash. NEW exposure.
- M-G2. "Removed synchronously as part of that rejection" (1097–1098) isn't literally achievable for the
  cancellation-signal path (a `Promise.race` loser resolves in a microtask) — benign in practice because the
  sweep also deletes the entry in the same synchronous step, but the wording invites a failing test. NEW,
  terminology/testability gap only.
- M-G3. Extraction has no cross-call `CollisionInstance` cache, and layout normalization re-runs per
  candidate pair since the size gate runs before any registry lookup — cheap, but it's the concrete mechanism
  behind H-G3(geometry)'s oversized-marking-creator gap. PRE-EXISTING `[SILENT]`, confirmed.
- M-G4 = H-G3 in the geometry auditor's own numbering: the oversized-marking registry entry (1109–1111, new)
  has no specified creator, and the operative narrow-phase code path (2316–2323) never consults the registry
  for an oversized fragment — aggravates pre-existing M4 from a documentation gap to a load-bearing one,
  since two *new* passages now depend on the marking existing.
- M-G5 (= M-1 in cache-ownership framing). `evictModel`'s no-op justification #2 ("nothing left to do,"
  2535–2542) is false for `liveModelByModelId` — deepens pre-existing L5. NEW second-order effect of C2.
- M-G6 (= M-2 in cache-ownership framing). `dispose()`'s "wholesale-clears three caches" framing (2577–2578)
  is stale after C3 collapsed BLAS/connectivity into registry phase slots — misleading, not contradictory;
  the safe reading is discoverable from `evictModel`'s own wording. NEW aggravation of pre-existing H-C1.
- M-G7 (= M-3 in cache-ownership framing). `dispose()` carries no non-throwing requirement while the
  symmetric `evictModel` release does, and this pass's own new `unload()`-ordering note establishes that a
  throw there permanently stops the room-cache clear from running. NEW exposure of H-L3/M5.
- M-G8 (= M-4 in cache-ownership framing). "Sweeps `GeometryRegistry`" (new verb, 2482–2483) implies a
  linear scan and contradicts "a synchronous map/set removal" sixteen lines later in the same paragraph.
  Aggravates pre-existing M2.
- M-G9. Connectivity eager-vs-lazy (M1) remains open by design — this pass's own text (1080–1084) now
  explicitly flags the gap rather than leaving it unremarked, which is a mild improvement, not a regression.
  PRE-EXISTING, unchanged in substance.

**Query dependencies**
- M-Q2. "Stage 2" is overloaded across two different decompositions in the one sentence carrying H-Q2's
  attempted repair (2007–2011) — `ContainmentModeQuery`'s term-2 vs. `anyComponentInside`'s own stage 2,
  used interchangeably elsewhere. Load-bearing because it sits on the spec's stated answer to H-Q2.
  PRE-EXISTING, byte-identical.
- M-Q3. `surface-intersection` shares the `bvhcast` abort protocol and `crossing-budget-exhausted` with
  `ProperCrossingQuery` (1431–1438) but neither the mode table nor the Public API records that a
  `surface-intersection` query can come back inconclusive; mirror gap for `containment`'s own `bvhcast` use.
  Raised from v1's Low (L7) to Medium — the `surface-intersection` half is newly identified and is the more
  likely omission for an implementer.
- M-Q4 = H-B3 from v1 (crossing-budget-exhausted vs. inconclusive-crossing, two contradictory mappings).
  PRE-EXISTING, confirmed unchanged, out of Round 18's scope.
- M-Q5 = v1's M9 (performance gate cannot exercise `surface-intersection`/`containment` runs its own pass
  criteria require). PRE-EXISTING, unchanged.

**Synchronous-work / budget model**
- M-B1. No aggregate work ceiling exists for a fragment-free tree with pathologically many nodes each under
  the per-node fanout ceiling — `maxFragmentsPerDbId`'s tally can't move on such a tree, and
  `maxChildrenPerNode` is per-node, so `findClashes` can run arbitrarily long with span bounded but total
  work unbounded. Line 1580 overstates `maxChildrenPerNode` as a "total-work" limit; it is per-call. NEW.
- M-B2. What "compatibility limit" means for `maxChildrenPerNode`'s value (1580) is never explained. NEW
  `[SILENT]`.
- M-B3. Contra the fix-pass disposition's claim that "every place the spec stated round 17's now-refuted
  justification was corrected" — the Round-17 Revision Notes entry (487–503) still states the refuted claims
  as fact verbatim, unannotated. Consistent with this document's convention of freezing revision notes as
  history (round 16's similarly-stale "hard bound" at 458 is likewise unannotated), which is why this is
  Medium rather than higher — but the disposition's own claim of completeness is inaccurate for this site.
  PRE-EXISTING text, newly mischaracterized by the disposition doc.
- M-B4 = v1's M7 (`frameBudgetMs = 8` vs. gate's "~16ms tolerance band" with no stated tolerance value).
  PRE-EXISTING, unchanged, now more load-bearing since H-B8 turns on what that criterion actually forbids.
- M-B5 = v1's M8 (extraction checkpoint fires only between siblings, never on descent). PRE-EXISTING,
  unchanged; this pass's "collect then descend after the call returns" phrasing makes the fix trivial
  without performing it.
- M-B6. Which clock intra-loop checkpoints read is stated three ways: "the shared accumulator" (2289, new
  and explicit), "elapsed time" unqualified (1880–1881, containment sampling), "elapsed time since the
  traversal's own start" (1524, `bvhcast` — see H-B7 for the case this has a numeric consequence). Mixed
  NEW/PRE-EXISTING.

**Cache ownership**
- M-1 through M-4: see the Geometry-pipeline Medium list above (M-G5 through M-G8) — same findings,
  independently derived by two auditors from opposite sides of the lifecycle/geometry boundary; listed once
  each to avoid duplication.

---

# Low

- L1 (=v1's L1). `>=` vs. `>` boundary inconsistency at `maxSyncTriangleCount = 12_000` (1175 vs. 2319–2320,
  2942, 3381). **Confirmed by two independent re-derivations to be PRE-EXISTING, byte-identical to v1's L1,
  and correctly out of Round 18's explicit scope** — one system's auditor initially flagged this as new
  before checking the diff; a second auditor caught and corrected the mislabel. Documented here to prevent a
  third recurrence: this is not new, do not re-flag it as new in a future pass without re-checking against
  `git show HEAD` first.
- L2 (=v1's L2). `referenceCount` — confirmed still dead, single occurrence at line 999, deliberately left
  per `codex-advisor`'s read during the fix pass. PRE-EXISTING.
- L3 (=v1's L3). Canonical ordering sort key still names bare `modelId`/`geometryKey` (1217), unreconciled
  with `(loadEpoch, geometryIndex)`. PRE-EXISTING, unchanged.
- L4. `dispose()`'s best-effort tombstoning silently becomes a no-op if implemented via a loop calling
  `evictModel` (since `evictModel` now returns immediately on a disposed world before reaching the tombstone
  write) — diagnostic-only consequence, but a new implementation trap. NEW, from C2.
- L5. No fixture pins the cancellation-signal mechanism directly (only the checkpoint-detected rejection
  path is tested, a different mechanism) — the sole basis for both release paths' in-flight-rejection
  guarantee is untested. NEW gap.
- L6. `evictModel`'s C2 justification #1 (2520–2534) is airtight; justification #2 ("nothing left to do") has
  a small factual hole (`liveModelByModelId`, see M-L4/M-G5); justification #3's premise ("called ONLY from
  the extension's handler," 2510–2512) sits in tension with the Purpose section's "not sized to the
  extension" framing (653–668) for a hypothetical non-extension caller — behaviorally harmless either way.
  NEW, cosmetic.
- L7. `isModelLive`'s doc comment still describes it as retained "for tests, diagnostics" (2553–2555) after
  this pass put it on a production path (the room-search callbacks' `try`/`catch`, part of H-L5's fix). NEW.
- L8. Open Questions' bullet on "the two new count ceilings" (3821–3824) predates this pass's addition of a
  third (`maxChildrenPerNode`) and was not updated — the constant itself is correctly carried everywhere else
  (table, gate). NEW, minor.
- L9. The overflow-safe broad-phase division (`sourceInstances.length > maxBroadPhaseInstancePairs /
  targetInstances.length`, 2272–2274) is undefined-adjacent for `targetInstances.length === 0` — harmless
  (check passes, scan of zero pairs) but unstated. NEW.
- L10. The `CollisionWorld` component summary (2025–2030) still describes the broad phase as "a plain linear
  AABB scan" without reflecting this pass's chunking change — the operative Data Flow/table/gate text is
  correct; only this summary blurb wasn't swept. NEW.
- L11. `dispose()`'s "the entire cache, in one operation" (2578) is immediately contradicted by the rest of
  the same sentence describing a per-entry cancellation-signal rejection pass — cosmetic, feeds into H-B6's
  cost mischaracterization. NEW.

---

# Notes on scope and what was checked and found clean

- **Lifecycle: v1's C1, C2, H-L5, H-L6 are all genuinely closed.** No normative site anywhere still states
  `evictModel` throws after disposal (34 `WorldDisposedError` occurrences read in full); the "Disposal
  mid-query" bullet correctly states round 15's mechanism; both room-search callbacks derive their error
  class the same way; `ContainmentQuery`'s checkpoint wording carries the full two-part protocol, propagated
  correctly to both sites it was missing from.
- **H-Q3 (containment's Public API wording) is fully closed** — grepped every recurrence of the round-8-
  rejected phrasing; all three remaining instances explicitly quote it as rejected, none as current rule.
- **H-G1 (triangle-count units) is fully closed** at every comparison site, corroborated against the actual
  spike code's arithmetic, not just spec prose.
- **The `(loadEpoch, geometryIndex)` key is applied consistently** everywhere in the geometry system; no
  `(modelId, geometryIndex)` residue outside labelled history.
- **The two release paths (`evictModel`/`dispose()`) are consistent with each other** on every point except
  C-2 above; epoch keying is provably non-interfering; the wholesale-clear rationale holds.
- **The broad-phase chunking fix (H-B1) is consistent across every site that mentions it** except the two
  cross-reference gaps noted (H-B5, L10) — no site still describes it as one atomic span.
- **The mode-dependency matrix itself (which mode needs weld/connectivity/BVH) remains fully consistent**
  everywhere it's stated normatively — confirmed again this round. Every query-dependency finding, including
  the new Critical C-3, is in the *rationale, caller wording, and stage-scoping prose* around that matrix,
  never in the matrix.
- **`ProperCrossingQuery`'s non-circularity, the `unverified-parity-operand` role table, and
  `admitModel`/`isLeaseValid`/`isModelLive`'s mutual consistency on check ordering** were all specifically
  re-checked for further contradictions and found clean.

---

# Full invariant model (reference)

The complete five-system invariant model this audit was checked against — built fresh from the current
post-Round-18 text rather than reused from `invariant-audit-v1.md` — follows, exactly as built, including
its own `[SILENT]`/`[AMBIGUOUS]`/`[CONTRADICTION]` markers, its Appendix of items flagged for this audit
pass, and its own section noting where its extraction disagreed with `round-18-invariant-fix-pass-
disposition.md`'s account of what that pass changed.

**Note on the reproduced model below:** two items the model itself flagged for verification were resolved
by this pass's auditors and should be read with their corrections in mind: (1) the model's §2.2
`[CONTRADICTION — new]` on the `>=`/`>` boundary is, per two independent re-derivations above, actually
**PRE-EXISTING** (v1's L1) — see Low, L1 above; (2) the model's coordinator note asking whether the
room-cache finding was missed by the disposition doc was answered — it was seen and deliberately deferred
(disposition lines 117–119), not missed; see Critical, C-4 above for the full resolution.

# Consolidated Invariant Model — Collision Library Milestone 1 (post-Round-18)

**Source of truth:** `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`
(3851 lines, post-Round-18 fix pass). Every `line N` citation below refers to that file at that
revision, and every citation in this document was verified against the current file rather than
carried over from `invariant-audit-v1.md`.

**Status of this document:** pure extraction. It records what the spec *says*, including where it says
two things. Where the spec is silent, ambiguous, or self-contradictory, that is marked `[SILENT]`,
`[AMBIGUOUS]`, or `[CONTRADICTION]` and left unresolved — resolution is the audit pass's job, not this
one's. Nothing here is a design proposal.

A reading note on the spec's own structure, re-derived at this revision: lines 23–575 are the
**Revision Notes** (a round-by-round changelog, now through Round 18 at 516–575); 577–649 **Spike
Findings**; 651–677 **Purpose**; 678–698 **Background**; 699–731 **Milestone Scope**; 732–846
**Architecture**. Normative text lives in **Components** (847–2031), **Data Flow** (2032–2365),
**Public API** (2366–2929), **Error Handling & Edge Cases** (2930–3081), **Testing & Verification**
(3082–3711), **Risks** (3712–3794), **Open Questions** (3795–3851). Where changelog prose and
normative text disagree, both are cited below.

**Note on this reproduction:** two items this model flagged for verification were resolved by this
audit's system auditors, and the sections below are left exactly as built (unedited) with the
resolution noted here rather than silently corrected in place: (1) §2.2's `[CONTRADICTION — new]` on
the `>=`/`>` boundary is, per two independent re-derivations, actually **PRE-EXISTING** (v1's L1) — see
Low, L1 above; (2) the coordinator note under §5.3 asking whether the room-cache finding was missed by
the disposition doc was answered — it was seen and deliberately deferred (disposition lines 117–119),
not missed; see Critical, C-4 above for the full resolution.

---

## 1. Model / world lifecycle

### 1.1 State machine

Two independent axes, checked in a fixed order at every site.

**World axis:** `constructed → disposed`. One-way, terminal; `disposed` set **first, synchronously,
before anything else** (2561–2563).

**Model axis (per exact `Model` *object*, never per numeric `modelId`):**

```
(no modelLifecycle entry)   -- "never been admitted or evicted — a legitimate first use, the only
                               case findClashes treats as 'admit fresh'" (2622-2623)
        │ admitModel(model)  or  findClashes entry-point lazy admission (2706-2711)
        ▼
{ state: 'live', epoch: N } -- N = nextLoadEpoch++ , assigned exactly once at first admission
                               (2412-2413, 2644-2649)
        │ evictModel(model)
        ▼
{ state: 'evicted' }        -- NO epoch field. Permanent. "nothing re-admits it, ever, because
                               nothing ever clears or overwrites it back to 'live'" (2623-2624)
```

`evictModel` on a model with **no prior entry** writes `{state:'evicted'}` unconditionally — the
round-15 fix for `BEFORE_MODEL_UNLOAD_EVENT` firing for a model loaded but never touched by
`findClashes`/room-search (2466–2478, 2617–2622; changelog 412–419). Fixture: 3546–3555.

`modelLifecycle` is a `WeakMap` deliberately, so "permanent" is free rather than a leak — and
**nothing in the design may depend on enumerating it** (2624–2628).

### 1.2 Data structures owned by `CollisionWorld`

| Structure | Type | Role | Cite |
|---|---|---|---|
| `modelLifecycle` | `WeakMap<Model, {state:'live'; epoch:number} \| {state:'evicted'}>` | **The** liveness authority. Keyed by object identity. Never deleted; tombstone permanent. Deliberately **non-enumerable** | 2613–2628 |
| `liveModelByModelId` | `Map<modelId, Model>` | **Bookkeeping/diagnostics only**, load-bearing for nothing since round 15. Structurally cannot represent two simultaneously-live objects sharing one `modelId` | 2629–2640, 2775–2777 |
| `disposed` | `boolean` | World-level terminal flag; since round 15 the **single authoritative** liveness signal, checked directly (never inferred from per-model tombstones) at every site | 2641–2643, 2741–2763 |
| `nextLoadEpoch` | `number` | Single counter, global to the `CollisionWorld` instance, monotonic, **never reset and never scoped per `modelId`** | 2644–2649 |

`ModelLease = { model, epoch }` (2405, 2662), "an opaque capture of this exact object's current
lifecycle state, valid until the object is evicted or the world is disposed" (2405–2406).

### 1.3 Public method contracts

**`world.admitModel(model): ModelLease`** (2404–2422)
- Synchronous. Idempotent: a second call on an already-live object returns a lease with the **same**
  epoch, does not re-admit, does not consume `nextLoadEpoch` (2406–2408; fixture 3489–3491).
- Three outcomes **in this order** (2408–2414):
  1. `disposed` → **throws** `WorldDisposedError`
  2. entry is `{state:'evicted'}` → **throws** `ModelEvictedError` immediately, without assigning an
     epoch — "a model that was ever evicted can never be re-leased" (2410–2411; fixture 3492–3495)
  3. otherwise → admit if not already (`epoch = nextLoadEpoch++`, record `liveModelByModelId`), return
     the (possibly pre-existing) lease.

**`world.isLeaseValid(lease): boolean`** (2424–2457) — **the FIRST of two deliberate non-throwing
exceptions.**
- "Strictly non-throwing and total … always returns a plain boolean, never throws" (2425–2426).
- Exact stated implementation (2428–2430):
  ```js
  if (disposed) return false;
  const entry = modelLifecycle.get(lease.model);
  return entry?.state === 'live' && entry.epoch === lease.epoch;
  ```
- Checks `disposed` **directly and first**, precisely because `dispose()`'s own model sweep is
  incomplete (2440–2446).
- Rationale for non-throwing: called from async Viewer callbacks; a throw there escapes uncaught and
  leaves the caller's promise permanently unsettled (2431–2439). Fixture: 3514–3520.
- Does **not** distinguish evicted-vs-disposed; a caller needing that calls `isModelLive` separately,
  inside a `try`/`catch` (2446–2457).

**`world.isModelLive(model): boolean`** (2549–2559) — **throwing contract.**
- Checks `disposed` first, directly → **throws** `WorldDisposedError` before consulting
  `modelLifecycle` at all (2550–2551). Fixture: 3521–3523.
- Otherwise `true` iff this exact object has a `{state:'live'}` entry.
- **"Never seen before → `false`"** (2552–2553). This conflation of "not yet admitted" with "evicted"
  is what broke every first-ever room search in round 12 (changelog 336–346; 2086–2090), and is why
  nothing public may still use it as a pre-admission gate (2556–2559).

**`world.evictModel(model): void`** (2459–2547) — takes the exact object, never `modelId`
(2460–2462). **The SECOND deliberate non-throwing exception (Round 18 / C2).**
- Stated body (2473–2478):
  ```js
  if (disposed) return;                                     // no-op on a disposed world
  const previous = modelLifecycle.get(model);
  if (previous?.state === 'evicted') return;                // idempotent no-op
  modelLifecycle.set(model, { state: 'evicted' });          // unconditional
  if (previous?.state === 'live') releaseEpochScopedState(previous.epoch);
  ```
- **`disposed` is checked FIRST and returns as a no-op — it does NOT throw `WorldDisposedError`**
  (2514–2519). Three stated justifications, "in descending order of force" (2519–2542):
  1. A throw is **verifiably destructive to the Viewer**: `EventDispatcher.prototype.dispatchEvent`
     (`viewer3D.js:13300–13341`) invokes listeners as a bare `callbackFn.call(this, event)` with no
     try/catch; the event is dispatched as the first statement of `Viewer3DImpl.unloadModel`
     (`34052–34054`), called from the unguarded loop in `unloadCurrentModel` (`34253–34258`). An
     uncaught throw aborts the Viewer's own multi-model teardown, skips `removeModel` for the throwing
     model, never nulls `this.model`, and propagates through `Viewer3D.tearDown` (`26583`, which wraps
     extension unloads in try/catch but **not** `unloadCurrentModel`) into `loadDocumentNode`
     (2520–2534).
  2. "There is nothing left for it to do" — `dispose()` already released everything, for every epoch
     (2535–2539).
  3. "It is the branch this method already had" — total-by-no-op for the `'evicted'` case (2540–2542).
- The no-op is **silent**; a diagnostic would fire on every normal teardown (2543–2544).
- **The extension-owned room-dbId cache is NOT covered by the no-op**: the handler must drop that
  object's entry unconditionally, independent of `evictModel` (2545–2547, 2798–2802).
- Tombstone write precedes the (conditional) state release, permanent either way (2479–2481).
- `releaseEpochScopedState(epoch)` (2482–2503) sweeps `GeometryRegistry` for every entry filed under
  the object's own epoch — **in whichever build state, `'building'` or `'ready'`, plus any oversized
  marking** — and drops each with its cached BLAS and connectivity. For a `'building'` entry it
  **first rejects that entry's cancellation signal**, which every unresolved phase slot races, so each
  in-flight build promise rejects exactly once ("clearing a map does not by itself settle a pending
  promise"); the entry is then deleted **identity-guarded** (2483–2488). This sweep can reach in-flight
  builds at all only because a record is published when its build **starts** (2488–2491).
- **No occupancy guard is needed anymore** — epoch keying makes the release provably non-interfering
  (2493–2497, 2700–2704).
- **`releaseEpochScopedState` must be non-throwing** — a partial release is unretriable once the
  now-`'evicted'` entry no longer carries the epoch (2497–2503).
- `liveModelByModelId` entry deleted only if this object is still the id's current occupant —
  explicitly "diagnostic/bookkeeping only" (2504–2507, 2637–2640).
- Fixtures: 3556–3561 (double eviction), 3562–3569 (after `dispose()`, inside a mocked dispatch —
  "A test asserting that `evictModel` throws after disposal is itself the regression").

**`world.dispose(): void`** (2561–2591, expanded 2729–2777)
- Sets `disposed` **first, synchronously, before anything else** (2562–2563); this single write is
  stated sufficient, on its own, for correctness everywhere (2741–2745, 2761–2765).
- After it returns, **every** public method — `findClashes`, `admitModel`, `isModelLive`, a second
  `dispose()` — rejects or throws `WorldDisposedError` (2564–2567). **Two** documented exceptions,
  both of which still check `disposed` directly and first (2568–2576): `isLeaseValid` returns `false`;
  `evictModel` returns as a no-op.
- **Wholesale-clears** `GeometryRegistry`, `BlasCache`, and every cached `GeometryConnectivity` — "the
  entire cache, in one operation, not a per-model sweep" — and rejects every in-flight build promise:
  every entry still in `buildState: 'building'` is reachable precisely because publication happens at
  build **start**, and the clear rejects each entry's cancellation signal exactly once, in the same
  pass that drops the entry (2577–2582, 2766–2774).
- **Explicitly no longer needs to enumerate/tombstone every live model** (2764–2765). It "best-effort
  tombstones whatever `liveModelByModelId` currently references, for diagnostic bookkeeping" only
  (2582–2587). Round 15's Critical: that map cannot reach both of two simultaneously-live objects
  sharing a reused `modelId` (2729–2739); fixture 3536–3545.
- Does **not** clear `modelLifecycle` (a `WeakMap`, non-enumerable) (2624–2628).

### 1.4 `modelId` reuse by a different `Model` object while the old one is still live

The spec treats this as a **supported, tested state**, not an error (2735–2737, 3074–3080).

- Liveness: both objects can hold `{state:'live'}` entries simultaneously (2735–2737).
- Geometry caches: structurally disjoint, every record keyed by `(loadEpoch, geometryIndex)` and the
  two objects necessarily holding different epochs (2690–2699). Round-14 Critical; fixture 3504–3513.
- `liveModelByModelId` holds **only the newer** object; the older live object is unreachable through
  it (2629–2640).
- A stale `evictModel(oldModel)` arriving after the new object was admitted: tombstones `oldModel`
  permanently, touches nothing of the new object's (3065–3073; fixture 3496–3503).
- A suspended `findClashes` holding the *old* object still rejects `ModelEvictedError` on resume; the
  new object's entry is "unrelated state the old call's check never even looks at" (3033–3036; fixture
  3452–3458).

### 1.5 Checkpoint / yield sites and what each revalidates

**Universal checkpoint protocol** (2706–2727, 2741–2760, 2357–2360):
1. check `disposed` **first**, directly → reject `WorldDisposedError`;
2. then re-check `modelLifecycle.get(model)?.state === 'live' && .epoch === capturedEpoch` → else
   reject `ModelEvictedError` naming the evicted `modelId`;
3. only then touch any cached BLAS, `GeometryRecord`, or `CollisionInstance` for that model.

A failure at *any* checkpoint aborts the **entire** `findClashes` call. "Neither returns a partial or
diagnosed `ClashResult`" — explicitly distinct from the diagnostic system (2720–2727).

| # | Site | Kind | Cite |
|---|---|---|---|
| 1 | `findClashes` **entry** — before any extraction, both operand models | validate + lazy-admit | 2376–2381, 2706–2712; fixture 3459–3466 |
| 2 | Before **each requested dbId's** extraction | yield + revalidate | 2161–2165, 2343 |
| 3 | Between **sibling nodes** at the same depth during the extraction walk | yield + revalidate | 2228–2229, 2238–2240 |
| 4 | Before the **broad-phase scan** starts | yield + revalidate | 2343 |
| 5 | **Inside the broad-phase scan, before each individual instance pair** — yields and **resumes from exactly the `(sourceIndex, targetIndex)` it left off at** | yield **and resume** + revalidate | 2286–2302; fixture 3429–3436 — **new in Round 18 / H-B1** |
| 6 | Before **each candidate pair** (cached or not) | yield + revalidate | 2342; fixture 3312–3318 |
| 7 | Between a pair's **composed sub-queries** | yield + revalidate | 2343–2344; fixture 3319–3322 |
| 8 | Before **each of the 3 build phases** (compaction+weld / connectivity / BVH) | yield + revalidate | 1043–1052, 2323–2327; fixture 3327–3334 |
| 9 | Before **each individual `classifyPoint` call** in `anyComponentInside` sampling | yield **and resume** + revalidate | 1877–1892; fixtures 3237–3252 |
| 10 | Before **each witness-triangle attempt** (stage 3, `maxWitnessTriangles = 8`) | yield and resume + revalidate | 1897–1899 |
| 11 | Before **each candidate's probe** in `SurfaceCrossingWitness` | yield and resume + revalidate | 1899–1902 |
| 12 | `bvhcast` callback entry (raw candidates) and **before each individual probe** in `ProperCrossingQuery` | **abort only, no yield, no revalidation** | 1518–1551 |

**Site 12 is categorically different and this matters.** It cannot pause — "`bvhcast` cannot be paused
and resumed mid-traversal — there is no way to `await` inside a synchronous native callback"
(1546–1548). It therefore performs **no** liveness/disposal revalidation and does **not** reject the
call — it sets an `aborted` flag, ends that pair's crossing evaluation for good, and reports
`crossing-budget-exhausted` as a **diagnostic** (1518–1522, 1546–1551). Control returns to an
`await`-capable context where sites 1–11 can act.

**Site 8's own scoping rule (new in Round 18 / C3):** "A build-phase checkpoint validates the record's
***owner***, not the building caller's whole query." It checks `disposed` first, then the liveness/epoch
of **the one model that owns this geometry** — the operand whose `loadEpoch` is in the record's key —
and nothing else. It must **not** reject because the initiating query's *other* operand was evicted.
Each caller separately re-validates both of its own operands at its own checkpoints, before and after
awaiting a shared phase slot. A caller whose own query aborts for an unrelated reason does **not**
cancel a phase already in flight: "every phase slot runs to settlement, so a `'building'` entry is
never left permanently unsettled with other callers awaiting it" (1085–1094). Fixture: 3366–3370.

Site 9's local wording now explicitly carries the full two-part protocol — "`disposed` first and
directly, then the model's load epoch" (1881–1886), propagated to sites 10–11 (1897–1902). (This is
Round 18's H-L6 fix; the v1 model recorded the pre-fix single-part wording as `[AMBIGUOUS]`.)

`[SILENT]` Site 3's local text (2238–2240) names the `frameBudgetMs` checkpoint between sibling nodes
but does not restate the two-part revalidation protocol; likewise site 2 (2161–2165). Both are covered
by the global statement at 2357–2360, but neither states it locally.

`[SILENT]` The extraction walk's checkpoint fires **between sibling nodes**, never on descent into a
child (2220–2223, 2238–2240) — the spec does not say whether descending one level constitutes a
checkpoint site.

### 1.6 Error types

| Error | Thrown / rejected where | Never thrown where |
|---|---|---|
| `WorldDisposedError` | `admitModel` (2409), `isModelLive` (2550–2551), `findClashes`/second `dispose()` (2564–2567, 3052–3054), every yield checkpoint (2748–2751), a build-phase slot whose checkpoint finds the world disposed (1095–1103), the room-search success/error callbacks via the `isModelLive` try/catch (2108–2119, 2130–2135) | `isLeaseValid` — returns `false` (2424–2427, 2570–2572); **`evictModel` — returns as a no-op** (2514–2519, 2573–2576) |
| `ModelEvictedError` | `admitModel` on a tombstoned object (2410–2411); `findClashes` entry on a tombstoned operand (2708–2709, 3037–3042); any yield checkpoint on `state!=='live'` or epoch mismatch (2717–2722); a build-phase slot whose checkpoint finds the owning model evicted (1095–1097); the room-search callbacks when `isLeaseValid` is false and `isModelLive` does not throw — `new ModelEvictedError(model.id)` (2108–2111) | `isLeaseValid`, `evictModel` |

Both release paths and both exceptions are now internally consistent: the "Disposal mid-query" bullet
(3043–3059) states the round-15 mechanism correctly — `disposed` set first, an in-flight query rejects
**`WorldDisposedError`**, "It does **not** reject `ModelEvictedError`", and `dispose()` "no longer
enumerates and tombstones every live model, and this spec no longer claims it does." (This was v1's
C1; the contradiction the v1 model recorded here is gone.)

`[AMBIGUOUS]` The `findClashes` entry check is described as rejecting `ModelEvictedError` "naming the
evicted `modelId`" (2722) while `ModelEvictedError` is constructed as `new ModelEvictedError(model.id)`
in the room-search path (2111). No error-class definition is given anywhere in the spec; the two
mentions are the only evidence of its payload.

`[SILENT]` Neither error class, nor the plain "rejects the whole call, naming the offending dbId /
node" rejections used by `maxFragmentsPerDbId` (2216–2219) and `maxChildrenPerNode` (2189–2191,
2956–2961), is given a named error type. The spec is explicit that these are "the same plain
call-level rejection … not a `ClashDiagnostic`" (2191) but never names what the rejection *is*.

### 1.7 Cross-check against the `viewer-extension-lifecycle-audit` hazard taxonomy

Listed as *categories the spec does or does not speak to* — not as adjudicated findings.

| Check | Category | Spec coverage |
|---|---|---|
| **A** — init completeness | Does `load()` await everything a consumer needs? | **Partial.** `load()` is `async` and "constructs the `CollisionWorld` only" (2782–2783, 2034–2035); `fromViewer` returns a `Promise` (2369). Spec never states that `load()` awaits it. |
| **B** — transactional load / partial init | Rollback if `load()` fails midway | **Not addressed.** No error path for a failed `fromViewer` anywhere. |
| **C** — unload isolation | Each teardown step in its own try/catch | **Named as open, not fixed.** "Per-step isolation of `unload()`'s three steps … remain open and are not settled here" (2794–2797). |
| **D** — teardown ordering | A step depending on another resource still being alive | **Addressed as of Round 18, and explicitly declared benign-by-accident.** `unload()` runs `world.dispose()` *before* unregistering the `BEFORE_MODEL_UNLOAD` listener, "leaves a window in which `BEFORE_MODEL_UNLOAD_EVENT` can still fire into this extension's handler on an already-disposed world, and the window can outlive `unload()` itself, since `Viewer3D.tearDown` catches a throw from `unload()` while leaving the listener registered. That window is benign, but only because `world.evictModel` is a no-op on a disposed world rather than a throw — **it is the method's totality that makes this ordering safe, not the ordering itself**" (2784–2797). Whether the listener should be removed before `dispose()` is stated open. |
| **E** — cross-extension reference lifetime | Cached `getExtension()` handles | **Not applicable** — extension holds no cross-extension references (2780–2807). |
| **F** — model load / replacement (`tearDown()` trap) | A second `loadDocumentNode`/`loadModel` without `keepCurrentModels` implicitly calls `tearDown()`, unloading **every** extension | **Still not addressed in 3851 lines.** `keepCurrentModels` has **zero occurrences**; `tearDown` appears only twice, both as descriptions of Viewer internals in the C2 evidence chain (2530) and the `unload()` note (2789) — never as a hazard to the extension's own survival. Meanwhile Data Flow step 1 (2038–2041) still reasons explicitly about "the user can load a different model afterward" and builds the lazy per-model room cache on the premise that **the extension survives a model switch**. Largest taxonomy category the spec is silent on. |
| **G** — lifecycle event timing | Listener attached after the event's fire point | **Partial.** Event chosen and justified (`BEFORE_MODEL_UNLOAD_EVENT`, "fires while `model` is still valid to read", 2052–2063). Attach timing relative to model loads is `[SILENT]`. Payload shape flagged unverified — typings declare `event: any` (2055–2059, 3727–3733). Whether the event can ever *fail to fire* is an acknowledged open question (3844–3847), and every race-safety guarantee is conditioned on it firing at least once per removal. |
| **H** — model/extension identity across reloads | Caches spanning an unload/reload boundary | **Extensively addressed** — the spec's core (rounds 10–15, 18). Object-identity keying, permanent tombstones, global epochs, epoch-keyed caches. |
| **I** — panel/toolbar cleanup | `DockingPanel.addVisibilityListener` has no removal counterpart | **Largely not applicable** — the UI is a context menu (2806). |
| **J** — internal/undocumented lifecycle deps | `viewer.impl.*`, `Private.*`, undocumented structures | **Addressed, and widened in Round 18.** `getRenderProxy`, `vb`/`vbstride`/`vblayout`, `getGeometryId` named untyped/internal (3720–3723); `Autodesk.Viewing.Private.THREE` proven non-existent, Viewer THREE is global `window.THREE` @ r71 (617–619, 736–746); `InstanceTree` documented deprecated in favour of `ObjectTree`, recorded at 504–508 as a fact to revisit at implementation time. **Round 18 additionally rests C5's whole bound on `enumNodeChildren`'s documented truthy-return interrupt while noting the installed typings declare both the callback and the return as `void`, "contradicting the documented contract, so the abort must be pinned by a test rather than trusted to the type surface"** (2206–2209, 3689–3691). |

---

## 2. Geometry ownership / build pipeline

### 2.1 Identity

`GeometryRecord` — one per unique **`(loadEpoch, geometryIndex)`** (996–998, 2690–2699).

- `geometryIndex` = `fragList.getGeometryId(fragId)`, confirmed **model-local only** by direct
  inspection of the shipped Viewer source (904–913, 3714–3717).
- `loadEpoch` = `modelLifecycle.get(model).epoch`, from `admitModel`/`findClashes` entry admission
  (904–906).
- **Never** `(modelId, geometryIndex)`, never the bare index (910–913). `modelId` survives on a record
  only as display/diagnostic metadata (1012–1015).
- Why: round-14's Critical is an **admission**-time bug, not an eviction-time one (2676–2688).

`GeometryRecord` contents, per the current text (996–1015):

| Field | Kind | Cite |
|---|---|---|
| `referenceCount` | named once, never used again | 999 |
| `buildState: 'building' \| 'ready'` | **explicit, new in Round 18** | 999, 1053–1054 |
| `weldPromise` | phase slot: active-range compaction + weld, resolving to the collision-owned compacted/welded position+index pair | 1000–1001, 1065–1066 |
| `accelerationPromise` | phase slot: the BLAS | 1001, 1066 |
| `connectivity`'s own promise | phase slot: the `GeometryConnectivity` decomposition | 1002, 1066 |
| entry-scoped cancellation signal | raced by every unresolved phase slot | 1104–1108 |
| `L_X := diagonal(localBounds(X))` | cached with the BLAS | 1211–1214 |
| oversized marking | a **distinct kind of entry**, not a build state | 1109–1111 |
| `modelId` | display/diagnostic metadata only | 1012–1015 |

`[SILENT]` `referenceCount` is named exactly once, at line 999, and **appears nowhere else in the
file** (verified: one occurrence). Nothing says who increments/decrements it or what reaching zero
triggers. It participates in no release path in §5.

`[SILENT]` `L_X` is described as "cached with the BLAS" (1211–1212) but is not one of the three phase
slots, and the `'building'`-record read rule at 1074–1076 says "**Nothing reads a phase's product off
a `'building'` record**" while naming only the compacted/welded buffers, the `MeshBVH`, and the
`GeometryConnectivity` decomposition. Whether `L_X` is readable off a `'building'` record is unstated.

### 2.2 Pipeline stages, in order

| # | Stage | Trigger | Keyed / cached by | Bound | Cite |
|---|---|---|---|---|---|
| 0 | **Extraction**: self-driven depth-first node-by-node walk per requested dbId; one `CollisionInstance` per fragment, deduped by fragment id | Each `findClashes` call, source dbId then every target dbId | `[SILENT]` — no cross-call cache for `CollisionInstance`s specified | `maxFragmentsPerDbId = 5_000` (cumulative, between-nodes only) **and `maxChildrenPerNode = 10_000` (per node, two-layer)** | 2161–2270 |
| 1 | **Layout normalization**: positions / index / `ranges: TriangleRange[]` | Per fragment, inside `ViewerGeometryAdapter` | — (feeds the record build) | Free — proportional to range count, never triangle count | 915–994 |
| 2 | **Active-range size gate**: `activeTriangleCount := Σ floor(ranges[i].count / 3)` vs `maxSyncTriangleCount` | Narrow phase, per candidate pair, **before** anything is materialized | Fragment-scoped, deduplicated diagnostic | Hard: `12_000` **triangles** | 1124–1136, 2316–2323, 2939–2945 |
| 3 | **Compaction**: materialize a collision-owned, compacted position/index pair containing only active-range triangles | Only after stage 2 passes | `weldPromise` slot (compaction+weld are one phase) | Bounded by the now-confirmed-under-ceiling active count | 1119–1143 |
| 4 | **Weld**: strip to position+index only, then `mergeVertices(geometry, weldEpsilon)` | Same phase/slot/checkpoint as stage 3 | `weldPromise` | `maxSyncTriangleCount` | 1348–1387, 1573 |
| 5 | **Connectivity**: union-find over triangles sharing an **edge**, restricted to active ranges; also yields manifold classification for free | **Independently lazy** — first time a mode calling `anyComponentInside` touches this record | `connectivity`'s own phase slot | `maxSyncTriangleCount` | 1389–1412, 1574 |
| 6 | **BVH build**: one `MeshBVH` over the welded geometry | First use, every mode | `accelerationPromise` slot | `maxSyncTriangleCount` | 1017–1018, 1575 |
| 7 | **Publication** to `GeometryRegistry` | **When the build *starts*, not when it finishes** — `buildState: 'building'` inserted **before the first phase's checkpoint, i.e. before any yield** | `GeometryRegistry`, key `(loadEpoch, geometryIndex)` | — | 1053–1073 |

Phase ordering: each slot "awaits its prerequisites rather than being launched in parallel — weld
first, then connectivity if it is needed, then the BVH" (1066–1069).

**H-G1 / units.** `TriangleRange.start`/`.count` are **index-element counts, not triangle counts**
(953–963). Ranges are **triangle-aligned** by normalization: a clipped range whose `count` is not a
multiple of 3 contributes `floor(count / 3)`, never a partial triangle. "Nothing downstream may
compare such a count against a triangle ceiling without converting first: the conversion is
`activeTriangleCount := Σ floor(ranges[i].count / 3)`" (958–963). Comparing the raw sum "would enforce
a ceiling roughly 3× stricter … about 4,000 real triangles, not `12_000`", and the measurements are
unambiguously in triangles — `spike/measure.mjs` sizes geometry as `index.count / 3`,
`spike/geometry-core.mjs` counts `index.length / 3` (1128–1132; both verified present in those files).
The converted form is used at every comparison site: 961–963, 1125, 1134, 2317, 2940, and fixtures
3384, 3385–3390.

Ordering statement, verbatim from the round-16 changelog header (435–436): *"Viewer geometry →
active-range compaction → size gate → weld → connectivity when required → BVH."* The **normative body
text (1119–1136) puts the size gate before compaction**: `maxSyncTriangleCount` "is checked against
`activeTriangleCount` **before any copying happens**", so a fragment over the ceiling is diagnosed
"without ever materializing a compacted buffer for it", and fixture 3380–3384 asserts **zero**
compaction calls in that case.
`[CONTRADICTION — carried, unfixed]` The round-16 changelog header's stage ordering and the normative
body's are transposed; the body + fixture are the operative pair. (Round 18 explicitly declined to fix
this — H-G2.)

`[CONTRADICTION — new]` **The size-gate boundary is stated inconsistently.** Line 1175 says "A
geometry **at or above** that triangle count is **not** built synchronously." The narrow-phase Data
Flow step (2319–2320) and Error Handling (2942) both say "if either **exceeds** it, skip the pair" /
"**exceeds** `maxSyncTriangleCount` … is skipped." At exactly `activeTriangleCount === 12_000` the two
readings give opposite answers. The new unit-boundary fixture (3385–3390) pins `13_000` (skip) and
`11_000` (build) and does not disambiguate the boundary itself. **[Resolved by this audit's system
auditors below: this is PRE-EXISTING (v1's L1), not new — see Low, L1 above.]**

**What compaction retired:** the previous "set `groups`/`drawRange` on the BVH input" workaround is
explicitly unnecessary — nothing out-of-range survives compaction (1156–1160). And
`indexOwnership: 'indirect'` is "not merely unimplemented but inapplicable": there is no shared index
left to protect at any stage (1152–1156, 3804–3806).

**Why the weld strips attributes first:** `mergeVertices` compares *all* attributes, so per-face
normals/uvs make every vertex unique and welding a full-attribute geometry silently does nothing. The
idea doc's "don't copy rendering attributes" rule — written for memory — is therefore **load-bearing
for correctness** (598–601, 1357–1361). Fixture asserts the count (24→8 for a box), not merely that
welding ran (3597–3601).

`weldEpsilon = 1e-4 m / model.getUnitScale()`, falling back to `1e-4` if unit scale is unavailable
(1379–1381). Upstream `mergeVertices(geometry, tolerance = 1e-4)` is an **absolute length in local
units** implemented as **grid quantization, not an epsilon-ball** — the guarantee is "identical
coordinates always merge," not "anything within `tolerance` merges" (1366–1377).

### 2.3 Publication, single-flight, idempotence / re-entrancy — the Round-18 C3 model

The old "publish only once every phase it needs has completed successfully" rule is **explicitly
retired**: the build is deliberately *not* atomic (a yield-and-revalidate checkpoint sits before each
phase), so under publish-when-complete nothing exists in the registry during the window — a second
concurrent caller sees a cache miss and duplicates every phase, and "neither `evictModel` nor
`dispose()` can find the in-flight build promises both are specified to reject" (1053–1062).

The stated rules (1063–1111):

| Rule | Statement | Cite |
|---|---|---|
| **Insert first, then build** | The caller whose lookup misses inserts the record with `buildState: 'building'` **before the first phase's checkpoint — that is, before any yield** | 1063–1065 |
| **Single-flight phase slots** | `weldPromise` (compaction+weld), `connectivity`'s own promise, `accelerationPromise` (BVH). "Each slot is created at most once, on demand, and awaits its prerequisites rather than being launched in parallel" | 1065–1069 |
| **No duplicate builds** | "A caller that finds an existing entry never starts a duplicate build." It awaits the phase slots its own query needs. "This single registry-level mechanism is what makes concurrent build requests dedupe, and it covers compaction/weld and connectivity exactly as it covers the BVH" | 1070–1073 |
| **`BlasCache` owns no dedup** | "see `BlasCache` below, which owns no dedup mechanism of its own"; dedup "is **not** a mechanism `BlasCache` owns. It is the registry-level rule above applied to one phase" | 1073, 1161–1170 |
| **Nothing reads a product off a `'building'` record** | The compacted/welded buffers, the `MeshBVH`, and the `GeometryConnectivity` decomposition "are only ever the resolved values of their own phase slots, never fields read straight off the record" | 1074–1076 |
| **`'ready'` is record-level and mode-independent** | It means compaction+weld **and** the BVH have both resolved. A `'ready'` record is everything `surface-intersection` needs, "and it is `'ready'` whether or not the connectivity slot was ever created"; `containment`/`volume-overlap` additionally await connectivity's slot on that same entry. "Connectivity is never what makes a record un-`'ready'`" | 1077–1084 |
| **Checkpoint validates the record's owner** | A between-phases checkpoint on a shared build checks `disposed` first, then the liveness/epoch of the one model that owns this geometry — the operand whose `loadEpoch` is in the record's key — and nothing else. Must not reject because the initiating query's *other* operand was evicted. Every phase slot runs to settlement, so a `'building'` entry is never left permanently unsettled | 1085–1094 |
| **No `'failed'` state** | On a lifecycle-triggered phase-checkpoint failure the slot rejects `ModelEvictedError`/`WorldDisposedError`, "**and the entry is removed from `GeometryRegistry` synchronously as part of that rejection**", discarding intermediate buffers. No later caller can observe a half-built record. A later valid attempt "starts the whole pipeline fresh rather than resuming." Removal is **identity-guarded** | 1095–1103 |
| **Release paths reach in-flight builds through the entry** | A `'building'` entry carries an entry-scoped cancellation signal every unresolved phase slot races; `evictModel`/`dispose()` reject that signal exactly once and drop the entry in the same step. "Clearing a map does not by itself settle a pending promise" | 1104–1108 |
| **Oversized is a third entry kind** | A registry lookup yields one of three things: an *oversized marking* (no phase ever started, no `buildState`, every pair needing it skipped), a `'building'` record, or a `'ready'` one | 1109–1111 |

Fixtures: 3345–3352 (rejection removes the entry synchronously; subsequent lookup must miss; welding
runs again, not resumed), 3353–3359 (two concurrent calls, exactly one call each to compaction /
`mergeVertices` / connectivity / `MeshBVH`), 3360–3365 (`'ready'` is record-level: a `surface-intersection`
caller and a `containment` caller share weld+BVH, only the latter drives connectivity), 3366–3370
(counterpart-model eviction does not reject the shared slot).

**[Resolved by this audit above as C-2, Critical: the release mechanism's own scoping to `'building'`
entries does not cover an unresolved connectivity slot on a `'ready'` record, which this very table's
own `'ready'`-is-mode-independent rule and fixture 3360–3365 establish as a reachable state.]**

`[SILENT]` **The trigger point for creating the connectivity slot is deliberately left open.** The
model "does not by itself decide that trigger point" (1082–1083), deferring to "this spec's
connectivity-trigger rule … see the narrow phase in **Data Flow** step 3 and 'Connectivity remains
independently lazy' above". Those two do not agree with each other — this is M1, explicitly not fixed
by Round 18.

`[SILENT]` **Only lifecycle-triggered phase rejections are covered.** The "no `'failed'` state" rule
(1095–1103) is written entirely for "a build-phase checkpoint finds the owning model evicted or the
world disposed." What happens if a phase rejects for a non-lifecycle reason — `mergeVertices` throwing,
a `MeshBVH` constructor failure, connectivity failing on an already-`'ready'` record — is not stated
anywhere. Whether such a rejection also removes the entry, and whether an already-`'ready'` record can
be un-published by a later connectivity failure, is undefined. **[Resolved by this audit above as
Critical/High C-2 and H-2 — a genuine gap, not merely a residual, applying to every phase slot on every
entry, not only connectivity on `'ready'` records.]**

`[SILENT]` The rule says a slot "is created at most once, on demand" (1066–1067) but never states what
`buildState` transition marks `'building' → 'ready'`, who performs it, or whether a caller that only
needed weld can observe an entry whose BVH slot has not yet been created. `'ready'` is defined by what
has *resolved* (1077–1078), not by a write.

`[SILENT]` No release path or lifetime is stated for the **oversized marking** itself beyond
`releaseEpochScopedState` sweeping it (2483) and `dispose()`'s wholesale clear. Whether an oversized
marking is created once per `(loadEpoch, geometryIndex)` or re-derived per call is not stated; the size
gate is described as running per candidate pair (2316–2320).

`[AMBIGUOUS]` **The size gate is enforced in two places.** The narrow phase checks
`activeTriangleCount` against `maxSyncTriangleCount` per candidate pair *before* going to
`GeometryRegistry`/`BlasCache` (2316–2323), while `ThreeMeshBvhBackend`/`BlasCache` also states
"`maxSyncTriangleCount` is checked against `activeTriangleCount` before any copying happens" and that
"`GeometryRegistry` marks the record oversized" (1134–1136, 1175–1178). Which actor creates the
oversized entry, and whether the narrow-phase check reads an existing marking or recomputes, is not
reconciled. (M4, explicitly only half-neutralized by Round 18 — this audit's system auditor upgraded
this to High, since the operative narrow-phase code path never actually reaches the registry for an
oversized fragment.)

### 2.4 Interaction with eviction / disposal

- **Checkpoint between phases finds the model evicted or the world disposed** → the phase slot rejects
  and **the entry is removed from `GeometryRegistry` synchronously as part of that rejection**,
  identity-guarded; a later valid attempt starts the **whole pipeline fresh** (1095–1103). Fixture
  3345–3352.
- **`evictModel`** sweeps `GeometryRegistry` for every entry under that one epoch — `'building'`,
  `'ready'`, or oversized — rejecting each `'building'` entry's cancellation signal first, then
  deleting identity-guarded (2482–2492).
- **`dispose()`** wholesale-clears all three caches and rejects **every** in-flight build promise,
  exactly once, in the same pass that drops each entry (2577–2582, 2766–2774).
- **Oversized records:** a geometry at/above `maxSyncTriangleCount` is *not* built; `GeometryRegistry`
  "marks the record oversized" and every pair needing it is skipped, with one fragment-scoped,
  deduplicated `geometry-too-large-for-sync-build` diagnostic (1109–1111, 1175–1181, 2320–2323).

---

## 3. Query mode dependencies

Per the spec's **current (post-round-16, round-17-reconciled, Round-18-restated)** text.

| Mode | Derived state required | `anyComponentInside`? | Parity operands needing closure | Pipeline stages executed |
|---|---|---|---|---|
| `surface-intersection` | **weld + BVH only** (`'ready'`) | **No — never calls it** (1042) | none (1302, 2393) | 0,1,2,3,4,6,7 — **no connectivity** (1574, 3342–3344) |
| `containment` | weld + **connectivity** + BVH | **Yes — stages 1–2 only** (1953–1959) | **target only** (1303, 1333–1336) | 0,1,2,3,4,**5**,6,7 |
| `volume-overlap` | weld + **connectivity** + BVH | **Yes — stages 1–3** (1841–1849, 1812–1813) | **both** (1304, 1326–1332) | 0,1,2,3,4,**5**,6,7 |

Mapped onto the Round-18 build-state model: `'ready'` (weld+BVH) is exactly what
`surface-intersection` needs; `containment`/`volume-overlap` **additionally await the connectivity slot
on the same entry** (1005–1007, 1077–1084).

**`anyComponentInside` and exactly who calls it** (1034–1042, the round-16 correction):
`ContainmentModeQuery` calls it **directly**; `VolumeOverlapQuery` calls it **through its own
containment terms, run only after `ProperCrossingQuery` returns false**. It samples per connected
component *regardless of which public mode is asking*, which is what requires `GeometryConnectivity`.
`volume-overlap` skips only **stage 3** (the constructed interior witness), never the component
decomposition (stages 1–2). **Only `surface-intersection` is genuinely connectivity-free** (1041–1042).

**[Resolved by this audit above as C-3, Critical: this exact paragraph (1040–1041) states the
stage-3 mode scoping backwards relative to five other normative sites and a fixture — round 9's fix,
inverted, in the table's own summary paragraph.]**

**Compositions:**

```
volume-overlap(A, B) :=  ProperCrossingQuery(A, B)                    // shares volume via a crossing
                      OR ContainmentQuery(anyComponentOf(A) inside B)
                      OR ContainmentQuery(anyComponentOf(B) inside A)   [lines 1918-1923]
                         — evaluated in that order, early exit; both directions required for symmetry
                                                                        [1925-1931]

containment(A, B)    :=  ContainmentQuery(anyComponentOf(A) inside B)   // a source VERTEX inside B
                      OR SurfaceCrossingWitness(A, B)                   // a point on a source TRIANGLE
                                                                        //   inside B   [lines 1944-1948]
                         — one direction only; directed, not symmetric  [1950-1951]

surface-intersection :=  first candidate pair from the shared bvhcast traversal that intersects at all
                         [lines 1414-1438]
```

**`ProperCrossingQuery` uses only `classifyPoint`, never `anyComponentInside`** (1675–1681) — which is
what keeps the containment guarantee non-circular.

**`containment`'s public definition** now matches the normative mode table: "any point on the source's
**SURFACE** lies inside the target's interior … the looser 'any part of the source' wording was
round-8-rejected because it makes the directedness fixture false" (2386–2392, matching 1300–1322 and
the directedness fixture at 3275–3283). *(This was Round 18's H-Q3; v1 recorded the mismatch — verified
fixed everywhere by this audit.)*

`[AMBIGUOUS]` **Connectivity: eager per mode, or lazy on genuine consumption?** The build-time decision
is stated **per mode** — narrow phase: "only for a mode that calls `anyComponentInside` — `containment`
or `volume-overlap`, not `surface-intersection`" (2324–2326) — and fixture 3335–3341 asserts the
connectivity checkpoint fires for `volume-overlap`. But at runtime a `volume-overlap` pair decided by
`ProperCrossingQuery`'s early `true` never reaches a containment term and never consumes connectivity;
1033–1035 says connectivity is computed "only the first time a mode that actually consumes it touches
this `GeometryRecord`". The Round-18 build-state model explicitly declines to settle this ("this state
model does not by itself decide that trigger point", 1082–1083). Unreconciled.

`[SILENT]` `SurfaceCrossingWitness` is `containment`-only (per `crossingProbeFractions` at 1231 and the
composition at 1947), and requires a **non-coplanar source-triangle/target intersection segment**. It
shares "the same traversal and budget as the other two modes" (2004–2005), i.e. a `bvhcast`. That means
`containment` also executes a `bvhcast` traversal, which the mode table (1300–1304) does not mention.
Its scheduling classification is in question — see §4 row 15.

`[SILENT]` `SurfaceIntersectionQuery` is stated to share `maxCandidatePairsExamined`, the per-candidate
`intersectsTriangle` test, and the abort protocol with `ProperCrossingQuery` (1431–1438), but the mode
table does not record that it therefore also carries the `crossing-budget-exhausted` diagnostic path,
and the closure-precondition column ("No closure precondition", 2393) says nothing about budget
outcomes.

---

## 4. Synchronous-work / budget model

**The spec's own two-tier framing** (1563–1654):
1. a **per-atomic-operation ceiling** — primitives with no internal hook to check a clock against
   (1600–1613);
2. a **cooperative-composition ceiling** — what `frameBudgetMs = 8` actually bounds (2344–2347; `8` is
   half a frame "since a checkpoint can only fire *between* primitives, not preempt one").

**Resulting stated bound, as rewritten by Round 18 (H-B2)** (1631–1654):
*"**For the cooperative-composition tier**, the resulting worst-case single synchronous span is
bounded by roughly `max(frameBudgetMs + one small atomic operation's cost, one build-phase's own
cost)`."* The spec then states, in terms, that this is **not** the design's worst-case span outright:
"a `max(…)` is a bound only when every term it ranges over has a ceiling, and the table above
deliberately contains a row that has none — one non-recursive `enumNodeFragments(node, cb, false)`
call … **explicitly excluded from the formula above and from any finite worst-case-span guarantee this
spec makes**" (1635–1644). What the formula *does* bound: "the three `maxSyncTriangleCount` build
phases, the `maxChildrenPerNode`-capped `enumNodeChildren` call, the now-chunked broad-phase scan, and
the per-primitive checkpoints" — "only as good as the table's unmeasured rows" (1646–1654).

**[Resolved by this audit above as C-1, Critical: the sentence above claiming the formula bounds "the
`maxChildrenPerNode`-capped `enumNodeChildren` call" directly contradicts row 6/7's own cell text below,
which explicitly refuses to claim that call fits inside `frameBudgetMs` — the same "claimed vs. earned"
pattern this rewrite itself exists to close, reproduced one row over.]**

Legend: **[Y]** cooperatively yieldable/resumable · **[B]** enforceably size/count bounded ·
**[A]** non-preemptible accepted atomic risk.

| # | Operation | Class | Mechanism | Earned? | Cite |
|---|---|---|---|---|---|
| 1 | Extraction walk (node-by-node, whole dbId) | **[Y]** | `frameBudgetMs` checkpoint fires **between sibling nodes at the same depth** and before each dbId | Yes — plain-JS walk under `findClashes`'s own control | 2161–2165, 2238–2240 |
| 2 | `maxFragmentsPerDbId = 5_000` as a ceiling | **[B]**, *narrowly* | Bounds "**cumulative work across the walk only**", via early termination between nodes; tally counts **callback invocations, not distinct fragment ids** | Yes, **for that narrow claim only** | 1578, 2210–2219 |
| 3 | One `enumNodeFragments(node, cb, false)` call | **[A]** — **no bound at all** | None. **Round 18 correction**: round 17's justification ("no fragment-count equivalent to `getChildCount` exists; neither class documents a way to interrupt an enumeration") is **factually wrong** — `ObjectTree.getInstanceCount(dbId)` is documented with `getFragmentCount` as its deprecated alias, and the truthy-return interrupt is documented for `enumNodeInstances`, which `enumNodeFragments` aliases | N/A — **"unbounded by choice of scope, not by API limitation"**; a follow-up pass is required either to bound it with the two named mechanisms or to state why it should not be | 1579, 2242–2267, 2946–2955 |
| 4 | Recursive `enumNodeFragments(dbId, cb, true)` | **not used** | "No code path in this design may call the recursive form" (861); `ViewerModelAdapter`'s own contract now specifies the self-driven walk | — | 851–892 |
| 5 | `getChildCount(node)` preflight | **[B]** *as an early reject only* | **Round 18 re-verification against the pinned bundle**: it reads a precomputed child count only for nodes owning **no fragments**; for a node that owns fragments the count is stored negated and the implementation **linearly scans the child slots**. So it is O(1) on the "wide-but-fragment-empty" shape and **Θ(direct children) on a mixed node, where it saves a constant factor and bounds nothing** — round 17's flat "O(1)-shaped" reading was too strong | Yes as a *cheap early reject*; explicitly **not the bound** | 1580, 2183–2191 |
| 6 | One `enumNodeChildren(node, cb, false)` call | **[B]** — **now genuinely enforced** | **The bound is the in-callback abort**: the callback "counts its own invocations and returns literal `true` the moment the count would exceed `maxChildrenPerNode`", documented by the Reference Guide as interrupting the enumeration and "confirmed in the pinned bundle at both traversal layers", so one call costs at most `maxChildrenPerNode + 1` callbacks. Three normative implementation constraints: the abort is recorded in a **local flag** (the truthy result is forwarded as a dbId, and dbId `0` is falsy); the callback **only collects child ids, never descends inline**; and the installed typings declare both callback and return as `void`, contradicting the documented contract, "so the abort must be pinned by a test rather than trusted to the type surface" | **Yes as of Round 18** — v1's "claimed but not earned" is now an enforced ceiling with a named constant and an action. **But**: "**This spec does not claim `10_000` callbacks fit inside `frameBudgetMs`**" | 1580, 2192–2209 |
| 7 | `maxChildrenPerNode = 10_000` | **[B]** | Two layers (rows 5 + 6). Either tripping **rejects the whole `findClashes` call**, naming the node, its observed child count, and the requested dbId — "the same plain call-level rejection `maxFragmentsPerDbId` uses, not a `ClashDiagnostic`" | **Reasoned, not yet measured — and deliberately not derived from any existing measurement.** "No row of this table measures a callback-driven native enumeration", and the ~0.3µs `bvhcast` figure is "a different API boundary … **not** borrowed as a proxy" | 1580, 2176–2191, 2956–2972 |
| 8 | Active-range compaction | **[A]** with a genuinely bounded worst case | Non-preemptible; folded into the `weldPromise` phase's single checkpoint. Bounded because the gate at #9 runs **first**, on a free `Σ floor(count/3)` | Yes — the gate's input is already-normalized range metadata, "free to compute … never proportional to triangle count" | 1119–1143, 1573 |
| 9 | `maxSyncTriangleCount = 12_000` gate | **[B]** | Checked against `activeTriangleCount` before any copying; oversized ⇒ pair skipped + fragment-scoped dedup'd diagnostic | Yes as a *mechanism*; **the value is "reasoned, provisional"**, not measured, since round 15 revised it down from `20_000` | 1134–1136, 1175–1195, 2316–2323 |
| 10 | Welding (`mergeVertices`) | **[A]** with size ceiling | Non-preemptible; own checkpoint immediately **before** it starts | Measured ~**16.8ms @ 19,800 tris** (round 15) | 1573, 1043–1052 |
| 11 | Connectivity construction | **[A]** with size ceiling | Non-preemptible; own checkpoint; independently lazy | Measured ~**6.9ms @ 19,800 tris** | 1574 |
| 12 | BVH build (`MeshBVH` ctor) | **[A]** with size ceiling | Non-preemptible; own checkpoint; the one phase every mode needs | Measured ~**16ms @ 18k tris** (spike) | 1575, 605–609 |
| 13 | Broad-phase `O(N×M)` AABB scan | **[B]** ceiling + **[Y]** execution — **changed by Round 18 / H-B1** | `maxBroadPhaseInstancePairs = 1_000_000` checked **before** the scan via **overflow-safe division** (`sourceCount > ceiling / targetCount`), never multiplication; remains a **pre-scan rejection, never a mid-scan cutoff**. The scan now checks the shared `frameBudgetMs` accumulator **before each individual instance pair**, `await`s the same scheduling yield, re-validates (`disposed` first, then epoch), and **resumes from exactly the `(sourceIndex, targetIndex)` it left off at**. Per-pair rather than batched is deliberate (round 11's rule); "a batch of `K` AABB tests would replace that with `K` of them" | Mechanism yes. **"Reasoned, not yet measured"**; the ceiling is **retained, unlowered** — with an inner checkpoint it now bounds total *work*, plus candidate-list memory and downstream narrow-phase work "neither of which chunking reduces". **The cost of a `performance.now()` read relative to one AABB test is unmeasured**; batching may return **only** with a measured per-batch cost and the bound restated as `frameBudgetMs + one full batch`, "never silently" | 1581, 2271–2315, 2973–2977 |
| 14 | `bvhcast` traversal (shared by `ProperCrossingQuery` **and** `SurfaceIntersectionQuery`) | **[B]** — abort-only, **not** resumable | Three abort triggers, all setting the same `aborted` flag: `maxCandidatePairsExamined = 50_000` (raw candidates, at callback entry), `maxCrossingPairsExamined = 64` (confirmed non-coplanar pairs), and **elapsed time > `frameBudgetMs` checked before each individual probe**. `bvhcast` returns `true` on abort, which **must not be read as "crossing found"** | Mechanism yes and hard-won (round 7 moved `surface-intersection` off `intersectsGeometry` because that API "accepts no budget, exposes no per-candidate callback, and offers no abort hook", 1420–1429). `maxCandidatePairsExamined` **measured** (~0.3µs/pair). **Taxonomy note:** interruptible but *not* resumable, and it degrades to a diagnostic rather than rejecting | 1505–1561, 1576 |
| 15 | `SurfaceCrossingWitness` per-candidate probe loop | **[Y]** *as classified* — but see below | 1899–1902 groups it with the plain-JS yield-and-resume loops, "checked before each candidate's probe … all three are plain JS loops with **no native traversal in the way**" | **Questionable.** Line 2004–2005 says this stage uses the *"Same traversal and budget as the other two modes"* — i.e. `bvhcast`, which by the spec's own repeated statement cannot be paused (1546–1548). Whether probing happens *inside* the callback (⇒ **[A]**/abort-only, like #14) or after candidates are collected (⇒ **[Y]**) is **`[AMBIGUOUS]` — never stated** | 1899–1902, 1971–2005 |
| 16 | `anyComponentInside` stages 1–2 sampling | **[Y]** | `performance.now()` read **before every individual `classifyPoint` call** (round 11 rejected `deadlineCheckInterval = 256`). `await`s the same scheduling yield, then runs **the same two-part revalidation — `disposed` first and directly, then the model's load epoch** — then **resumes from exactly where it left off**. Explicitly *"does not truncate the search"* | Yes — mechanism stated and fixture-pinned (3237–3252), including "the checkpoint fires **before** the sample whose elapsed time crosses the deadline is classified" | 1871–1902 |
| 17 | `maxContainmentSamples = 512` | **[B]** | Global cap across components; hitting it emits `incomplete-component-coverage` | Mechanism yes; value explicitly **provisional** (3826–3829) | 1868–1869 |
| 18 | Stage-3 constructed-witness loop (`maxWitnessTriangles = 8`) | **[Y]** + **[B]** | Plain JS, checked before each witness-triangle attempt, with the same two-part revalidation; `volume-overlap` only | Yes; value provisional | 1897–1899, 1830 |
| 19 | One `classifyPoint` call (proximity check + up to 3 raycasts) | **[A]** — no ceiling of its own | "Checked before every occurrence; the ***composition*** of many such calls is what `frameBudgetMs` bounds, **not any single call's own cost**" | **No — explicitly "Reasoned, not yet measured."** *"This spec does not claim it as fact; the performance gate below is now required to measure it"* (1611–1613). Gate requirement 3649–3656 | 1577, 1600–1613 |
| 20 | One crossing probe (up to 2 `classifyPoint` calls) | **[A]** | Overshoot past `frameBudgetMs` bounded to *one probe's* cost (round 11), down from one confirmed pair's 12 probes / 24 `classifyPoint` calls | Same as #19 — reasoned, unmeasured | 1553–1557, 1577 |
| 21 | `releaseEpochScopedState(epoch)` | **[A]**, unbounded | "A synchronous map/set removal and promise rejection" that **must be non-throwing**. Now also sweeps `'building'` entries and rejects each cancellation signal | `[SILENT]` on cost — proportional to the number of records under that epoch; never given a ceiling or a checkpoint, and **not a row in the atomic-operations table** | 2482–2503 |
| 22 | `dispose()`'s wholesale cache clear | **[A]**, unbounded | Synchronous, "the entire cache, in one operation"; also rejects every `'building'` entry's cancellation signal in the same pass | `[SILENT]` on cost; **not a row in the atomic-operations table** | 2577–2582, 2766–2774 |

**Rows the performance gate must promote from reasoned to measured** (3625–3706): each of the three
build phases individually at the ceiling (3657–3666); one `classifyPoint` and one probe (3649–3656);
extraction for the largest single dbId and the broad-phase scan at real instance counts (3667–3680) —
**with Round 18's change to what "the broad-phase scan's own cost" means**: record its **longest
uninterrupted span between two consecutive yields**, alongside the total, plus (a) the cost of one
`performance.now()` read relative to one AABB test and (b) the candidate-list size at the ceiling;
**Round 18's new requirement** — one `enumNodeChildren` call at the fanout ceiling, measured
separately, including **an assertion that the abort actually fires** (3681–3693), with the rider that
"a model whose widest node has far fewer children than the ceiling cannot exercise this at all —
recording that limitation is itself a gate finding, not a pass"; and round 17's requirement, one
`enumNodeFragments(node, cb, false)` call on a node chosen to directly own as many fragments as the
model allows (3694–3701), with the same honest rider.

The spec's own standing warning about this whole section (3771–3775): *"note that claim was made in
round 5 and was **false when written** … Treat 'the budgets bound it' as a property to re-verify
whenever a new traversal is added, not as a standing invariant."*

`[SILENT]` Rows 21–22 (`releaseEpochScopedState` / `dispose()`'s wholesale clear) remain absent from
the atomic-operations table at 1571–1581 and from the performance gate. They are the only synchronous
spans in the design with neither a ceiling nor a checkpoint nor a measurement requirement.

`[SILENT]` The `maxChildrenPerNode` row states the ceiling is "a provisional **total-work and
compatibility limit**" (1580) but the spec never says what the compatibility concern is.

`[AMBIGUOUS]` Row 6's in-callback abort caps *callbacks*, but the walk "**only collects child ids**,
never descends inline" (2202–2203) — so a node with `maxChildrenPerNode` children still materializes a
10,000-element child-id list before any checkpoint fires. The spec counts callbacks, not list growth,
and 1580 explicitly notes the ~0.3µs proxy "excludes … list growth" without giving list growth its own
treatment. **[Resolved by this audit's system auditor: list growth is not the dominant risk — the real
hole is C-1 above, the count-vs-time conflation and the unbounded preflight on mixed nodes.]**

---

## 5. Cache ownership and cleanup

### 5.1 Inventory

| Cache | Owner | Authoritative key | Contents |
|---|---|---|---|
| `GeometryRegistry` | `CollisionWorld` | **`(loadEpoch, geometryIndex)`** | one of three entry kinds (1109–1111): an **oversized marking**, a **`'building'`** record, or a **`'ready'`** record. A record carries `referenceCount`, `buildState`, `weldPromise`, `accelerationPromise`, `connectivity`'s promise, an entry-scoped cancellation signal, `L_X`, and `modelId` as metadata only (996–1015, 1053–1111, 1211–1214) |
| `BlasCache` | `CollisionWorld` | per `GeometryRecord` ⇒ effectively `(loadEpoch, geometryIndex)`; the built `MeshBVH` lives behind the `accelerationPromise` slot | one `MeshBVH` per record. **Owns no dedup mechanism of its own** — dedup is the registry-entry rule (1073, 1161–1170) |
| `GeometryConnectivity` | `CollisionWorld` | per `GeometryRecord`, its own phase slot on that entry | component decomposition + per-component manifold classification (1389–1412) |
| `modelLifecycle` | `CollisionWorld` | `Model` **object identity** (`WeakMap`) | `{state:'live',epoch}` \| `{state:'evicted'}` (2613–2628) |
| `liveModelByModelId` | `CollisionWorld` | numeric `modelId` | current live `Model` for that id — **diagnostics/bookkeeping only** (2629–2640) |
| Room-dbId cache | **`RoomLocatorExtension`, not the world** | `Map<Model, Promise<number[]>>` — **exact object**, not `model.id` (2042–2046) | resolved room dbIds per model |

The three world caches are named together as "model-owned collision state" and all three moved from
`(modelId, geometryIndex)` to `(loadEpoch, geometryIndex)` in round 14 (2676–2704).

### 5.2 What each release path does

| | `evictModel(model)` | `dispose()` |
|---|---|---|
| `GeometryRegistry` | sweeps **every entry filed under that object's own `epoch` — `'building'`, `'ready'`, or an oversized marking** — and drops each, **identity-guarded** (2482–2488) | **wholesale-clears the entire cache**, no per-model sweep (2577–2578, 2766–2768) |
| `BlasCache` | dropped together with the record, epoch-scoped (2483–2484) | wholesale-clear |
| `GeometryConnectivity` | dropped together with the record, epoch-scoped (2483–2484) | wholesale-clear ("every cached `GeometryConnectivity`") |
| In-flight build promises | for a `'building'` entry, **rejects that entry's cancellation signal first**, which every unresolved phase slot races, so each rejects **exactly once**; then deletes the entry (2484–2488) | rejects **every** `'building'` entry's cancellation signal "exactly once, in the same pass that drops the entry" (2578–2582, 2768–2772) |
| `modelLifecycle` | writes `{state:'evicted'}` unconditionally, **before** the release; never deletes (2476–2481) | **does not clear it** — a `WeakMap` cannot be enumerated (2624–2628). Best-effort tombstones only what `liveModelByModelId` happens to reference (2582–2587) |
| `liveModelByModelId` | deletes this object's entry **only if** it is still the current occupant of its `model.id` — bookkeeping hygiene (2504–2507, 2637–2640) | `[SILENT]` — not stated to clear the map itself, only to best-effort tombstone what it references (2582–2587, 2775–2777) |
| `disposed` flag | untouched (checked first, but only to decide the no-op) | set **first, synchronously, before anything else** (2562–2563) |
| Room-dbId cache | **not touched** — the extension's `BEFORE_MODEL_UNLOAD` handler must separately delete that object's entry, **unconditionally and independently of what `evictModel` does** (2545–2547, 2798–2802) | **not touched** — the extension's `unload()` separately "clears the per-model room cache" (2784–2785) |
| Can throw? | **must not** — `releaseEpochScopedState` is a stated non-throwing requirement (2497–2503); and the method as a whole is now a **no-op on a disposed world** rather than throwing (2514–2519) | `[SILENT]` |

### 5.3 Consistency between the two paths, and with §1

**Consistent:**
- Both release exactly the same three caches plus in-flight build promises, and both reach in-flight
  builds through the **same** mechanism — the `'building'` registry entry's cancellation signal — which
  works only because publication happens at build start (2488–2491, 2768–2772).
- Round 15 deliberately replaced `dispose()`'s per-model sweep with a wholesale clear because "a
  wholesale clear cannot suffer the same enumeration gap a per-model sweep can, because it never needs
  to identify *which* models were live in the first place" (2772–2774).
- Both are consistent with §1's model: after either, a suspended query fails at its next checkpoint —
  `evictModel` via the per-model epoch check, `dispose()` via the `disposed` flag checked first
  (2588–2590, 2748–2751).
- Epoch keying makes eviction's scoped release provably non-interfering (2493–2497, 2700–2704).
- Both deliberate non-throwing exceptions (`isLeaseValid`, `evictModel`) are cross-referenced
  consistently from all four places that discuss them: 2436–2439, 2514–2519, 2568–2576, 3054–3059.

**Asymmetries the spec states deliberately:**
- `evictModel` tombstones; `dispose()` does **not** (and no longer needs to).
- `evictModel` is epoch-scoped and precise; `dispose()` is indiscriminate and therefore immune to the
  enumeration gap.
- `evictModel` no-ops on a disposed world; `dispose()` is the terminal write.

**Gaps / open points, flagged not resolved:**
- `[SILENT]` `dispose()` does not release the **extension-owned room cache**; only `unload()` does
  (2784–2785). Nothing states whether `dispose()` may be called independently of `unload()`. If it can,
  that cache outlives the world. (The `evictModel` no-op note at 2545–2547 covers only the per-model
  entry on the eviction path, not the whole-cache case.)
- `[SILENT]` Nothing releases `liveModelByModelId` wholesale on disposal (2582–2587, 2775–2777). It is
  a live `Map` holding **strong `Model` references** after the world is dead — the only
  strong-reference cache in the set (`modelLifecycle` is deliberately weak, 2624–2628).
- `[SILENT]` `GeometryRecord.referenceCount` participates in no release path and is never read anywhere
  in the spec (single occurrence, line 999).
- `[SILENT]` No release path or lifetime covers per-call extraction state (`CollisionInstance`s), whose
  caching lifetime is unspecified (§2.2 row 0). **[Sharpened by this audit as H-3: the checkpoint
  protocol names this cache and a fixture asserts on it by identity, but it is declared nowhere.]**
- `[SILENT]` `L_X` has a creation site ("cached with the BLAS", 1211–1212) but no phase slot and no
  named release beyond the record being dropped. Same for the compacted/welded buffers, which now have
  a named producing slot (`weldPromise`, 1000–1001) but no release path beyond "the entry is dropped".
- `[AMBIGUOUS]` The epoch-scoped release must "sweep `GeometryRegistry` for every entry filed under the
  object's own admitted epoch" (2482–2483). `GeometryRegistry`'s key is a *tuple*, and the spec never
  says whether it is indexed to support an epoch-prefix sweep or whether the sweep is a linear scan of
  all records. That determines row 21 of §4's cost — the word "sweeps" is new in Round 18 and, if read
  literally, implies a linear scan.
- `[SILENT]` **Room-cache deletion is stated two ways.** On a *rejected* room search, "the handler
  deletes that model object's cache entry … so the next call retries `model.search` fresh"
  (2069–2075). On an *invalid lease* in the success/error callbacks, the rule is "reject, and **leave
  the cache untouched**" (2100–2101, 2130–2135, and fixture 3570–3575 asserts "the cache must be left
  untouched"). A search that rejects *because* its lease went invalid falls under both sentences; the
  spec does not say which wins. **[Resolved by this audit above as C-4, Critical — seen and deliberately
  deferred by the disposition doc, not missed; assessed here as Critical by the literal contradiction
  bar, with an explicit low-impact caveat.]**

---

## Appendix — items flagged for the audit pass

Ordered roughly by how load-bearing they look; **none is adjudicated here.**

1. **`tearDown()` trap entirely absent** (§1.7 check F). `keepCurrentModels` has zero occurrences in
   3851 lines; `tearDown` appears only as Viewer-internal evidence (2530, 2789), never as a hazard to
   the extension's own survival — while Data Flow step 1 (2038–2041) is built on the extension
   surviving a model switch. Untouched by Round 18 (H-L1/H-L2).
2. **Size-gate boundary contradiction** — "at or above" (1175) vs. "exceeds" (2320, 2942) at exactly
   `activeTriangleCount === 12_000` (§2.2). **Resolved by this audit's cross-check: PRE-EXISTING (v1's
   L1), not new** — see Low, L1 above.
3. **The coverage-equivalence fixture calls the API the component contract forbids.** Line 861: "No
   code path in this design may call the recursive form." Fixture 3406–3416 asserts the walk's set
   "**equals** the set `enumNodeFragments(dbId, cb, true)` returns for the same dbId" — i.e. the
   fixture must call it. Whether "no code path in this design" excludes test code is unstated (§2.2
   row 0 / §4 row 4).
4. **C4's forward reference points at nothing.** The coverage-equivalence argument is explicitly
   conditioned on "a complete instance-tree snapshot", and defers that to "See **Risks**; this spec
   does not claim to have closed the second" (890–892). **Risks (3712–3794) contains no instance-tree
   readiness entry**, and `isObjectTreeCreated` / "instance tree readiness" have **zero occurrences**
   in the file (§1.7 check J, §2.2 row 0). Cross-filed by this audit as H-B9.
5. **`enumNodeChildren`'s abort rests on a documented contract the installed typings contradict**
   (2206–2209) — and the same is true of the `ObjectTree`/`InstanceTree` split generally (504–508).
   The spec's mitigation is "must be pinned by a test", deferred to the gate (3689–3691).
6. **Connectivity: eager per mode, or lazy per genuine consumption?** (§3, `[AMBIGUOUS]`.) The new
   build-state model explicitly declines to settle it (1080–1084). M1, deliberately untouched.
7. **`SurfaceCrossingWitness`'s scheduling class** — "plain JS loop, no native traversal in the way"
   (1899–1902) vs. "Same traversal and budget as the other two modes" (2004–2005) (§4 row 15).
   H-B4, untouched.
8. **The size gate is enforced in two places** (§2.3 `[AMBIGUOUS]`) — narrow phase (2316–2323) and
   `ThreeMeshBvhBackend`/`BlasCache` (1134–1136, 1175–1178). M4, half-neutralized, upgraded to High by
   this audit.
9. **Non-lifecycle phase failures are undefined** (§2.3 `[SILENT]`) — the "no `'failed'` state" rule
   covers only eviction/disposal. **Resolved by this audit as Critical/High C-2/H-2.**
10. **Round-16 header vs. body ordering of size-gate and compaction** (§2.2 `[CONTRADICTION]`, 435–436
    vs. 1119–1136). H-G2, explicitly preserved unfixed.
11. **Room-cache deletion stated two ways** (§5.3) — 2069–2075 vs. 2100–2101 / 3570–3575. **Resolved by
    this audit as Critical C-4.**
12. **`dispose()` never clears `liveModelByModelId`** (§5.3). L5, raised during the fix pass, not
    fixed; second-order effect surfaced by this audit as M-1/M-G5.
13. **`referenceCount`** — declared once, never used (§2.1, §5.3). L2, deliberately left dead.
14. **Whether `dispose()` may be called independently of `unload()`** is still unstated (§5.3). M10.
15. **`releaseEpochScopedState` / `dispose()`'s clear are unclassified** in the atomic-operations table
    and the performance gate (§4 rows 21–22). M2, upgraded to High by this audit as H-B6.
16. **`BEFORE_MODEL_UNLOAD_EVENT` payload shape still unverified** (`event: any`, 2055–2059,
    3727–3733), and whether the event can ever fail to fire is an acknowledged open question
    (3844–3847) on which every race-safety guarantee is conditioned.
17. **`InstanceTree` is documented deprecated** in favour of `ObjectTree`, which exposes no
    `enumNodeFragments` at all — recorded at 504–508 as a fact to revisit at implementation time. The
    disposition additionally notes (its own residual) that `InstanceTree === ObjectTree` literally in
    the pinned bundle under `Autodesk.Viewing.Private.*`, so every "verified on both classes" claim in
    the spec (e.g. 485–488) is one verification presented as two — **the spec text still reads as two**
    (485–488, 2244–2247).
18. **`load()` init completeness / rollback** (§1.7 checks A, B) — `load()` is `async` and constructs
    the world; nothing states it awaits `fromViewer`, and no failure path exists. H-L4, untouched.
19. **`unload()` per-step isolation** is named open in the spec itself (2794–2797). H-L3, partially
    neutralized only; sharpened by this audit as H-L8.
20. **Row 3's atomic risk is now self-described as a scope choice, not an API limit** (1579,
    2242–2267) — the spec states a follow-up pass is *required*, which no milestone artifact schedules.

---

## Where the post-Round-18 model's own extraction disagreed with `round-18-invariant-fix-pass-disposition.md`

The disposition doc's account of what it changed is, in the large, accurate — every one of the five
Criticals and four Highs it claims to have fixed is present in the current text at the cited kind of
location, and no case was found where it claims a fix that is simply absent. The following are the
places where the fresh reading did not match the disposition's own description (all subsequently
incorporated into this audit's findings above):

1. Two Revision-Notes entries (Round 12's, Round 14's) still state the unqualified pre-Round-18
   disposal rule — see High, H-L7 above.
2. H-G1's unit-conversion fix did not touch, and did not need to touch, the separate `>=`/`>` boundary
   inconsistency sitting in the same sentences — correctly out of scope, but the disposition's own
   completeness framing for H-G1 doesn't mention it either way.
3. Neither `maxFragmentsPerDbId`'s nor `maxChildrenPerNode`'s "plain call-level rejection" has a named
   error type — the disposition presents C5's fix as reusing an existing mechanism; the existing
   mechanism has the same gap, so nothing was actually inherited as a *solved* problem.
4. H-B1's fix introduced a new, explicitly unmeasured quantity (one `performance.now()` read's cost
   relative to one AABB test) into the design's critical path — reported by the disposition only as a
   class change ([A]→[Y]), not as a new unmeasured dependency.
5. C3's "no half-built record is ever observable" claim holds only for lifecycle-triggered rejections —
   the disposition's own residual list understates the scope as connectivity-on-`'ready'`-records only;
   the gap is general to every phase slot on every entry (see Critical C-2 and High H-2 above).
6. C4's forward reference to Risks resolves to nothing — the disposition lists this as a residual, but
   the spec text itself asserts the cross-reference as if it were already closed ("this spec does not
   claim to have closed the second" reads as an admission of an open question, not as a pointer to a
   section that doesn't exist).
7. The `InstanceTree`/`ObjectTree` "one verification presented as two" pattern the disposition
   identifies as unfixed is also reproduced fresh in Round 18's own new text (2244–2247), not only
   carried over from before.
8. The spec's Testing section specifies eight new or revised fixtures for the Round-18 changes that no
   executable artifact (`spike/fixtures.mjs`) covers — consistent with the disposition's own "55/55
   pass… does not exercise any of the five Critical fixes," but worth stating as an inventory rather
   than leaving it implicit.
9. The spec now cites `invariant-audit-v2.md` (this file) as an existing companion document from inside
   its own Status line and Round-18 changelog entry — expected, since the disposition anticipated this
   audit being run, and no longer a dangling reference now that this file exists.
