# Invariant-driven consistency audit — Round 3 (post-Round-19)

Type: invariant-model audit (not a Codex review round — no `codex-review spec` pass was run on the whole
document per explicit instruction).
Input: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (3993 lines, post-Round-19
Critical-only fix pass).
Prior work this audit checks: `docs/superpowers/specs/invariant-audit-v2.md` (Round 2, 4 Critical found
against the post-Round-18 3851-line spec) and `docs/superpowers/specs/round-19-critical-fix-pass-disposition.md`
(the fix pass that closed all 4 of v2's Criticals — C-1 through C-4 — and lists what it deliberately left
untouched).

**Method, replicating v1/v2's:** one agent (opus) built a fresh consolidated invariant model of the same
five interlocking systems (model/world lifecycle, geometry ownership/build pipeline, query mode
dependencies, synchronous-work/budget model, cache ownership/cleanup) **from the current post-Round-19
text** — not reused from either prior model, to avoid falsely flagging Round 19's own fixes as new
deviations — written to `docs/superpowers/specs/invariant-audit-v3-model.md` (976 lines, kept as a separate
working artifact rather than reproduced inline here). Five parallel agents then audited the full spec text
against that model, one system each, cross-checking each other's territory where findings span systems,
using v1/v2's own findings as a severity calibration reference and explicitly distinguishing **NEW**
(introduced by Round 18 or Round 19) from **PRE-EXISTING** (unchanged, deliberately deferred) at every
finding. Several agents consulted `codex-advisor` on specific severity judgment calls (never a full review
pass). No spec edits were made in this pass — this is a report only.

---

# Critical

**One Critical was found — genuinely new, introduced by Round 19's own C-2 fix.** Two independent auditors
(geometry ownership/build pipeline, and cache ownership/cleanup) surfaced the identical defect from
opposite sides of the same boundary, each independently consulting `codex-advisor`; their consults
disagreed on severity (High vs. Critical). The coordinating session adjudicates it Critical below, for the
reasons given.

## C-5 (geometry / cache ownership boundary). Round 19's own broadened cancellation-signal wording now instructs rejecting a signal that oversized-marking entries never had

**Location:** `evictModel`'s `releaseEpochScopedState` step (lines 2577–2587) and `dispose()`'s wholesale
clear (lines 2677–2687), contradicted by the oversized-marking definition (1183–1186) and the
cancellation-signal creation trigger (1165–1167). `releaseEpochScopedState`'s own explicit non-throwing
requirement sits fifteen lines below its own contradiction (2597–2599).

Round 19's C-2 fix (this pass) deliberately widened the cancellation-signal release scope from "a
`'building'` entry" to every entry regardless of `buildState`, specifically to close v2's C-2 finding (a
`'ready'` entry's in-flight lazy connectivity build wasn't being cancelled). The widened wording:

> "`releaseEpochScopedState` sweeps `GeometryRegistry` for every entry filed under the object's own admitted
> epoch — in whichever build state, `'building'` or `'ready'`, **plus any oversized marking** — and drops
> each one together with its cached BLAS and cached connectivity. **For every entry it removes, regardless
> of `buildState`, it first rejects that entry's cancellation signal** — the same signal created once when
> the entry was first inserted..." (2577–2583)

But the same document defines an oversized marking as categorically different from a build-state-bearing
entry: "An oversized geometry ... is a distinct kind of entry, not a build state. ... an *oversized
marking* (no phase is ever started for it, it **carries no `buildState`**)" (1183–1186), and the
cancellation signal is created "once when the entry is first inserted **in `buildState: 'building'`**"
(1165–1167) — a trigger an oversized marking never undergoes, since no phase is ever started for it. The
sweep's own first sentence explicitly enumerates oversized markings into the removal set, then the second
sentence claims every removed entry's signal is rejected "regardless of `buildState`" — grammatically
reaching an entry kind that, by the document's own definition two paragraphs earlier, has no signal to
reject. `dispose()`'s parallel passage (2677–2687) repeats the identical shape.

**Why Critical:** no conforming implementation can satisfy all three constraints simultaneously for a
reachable oversized-marking entry on eviction/disposal: (1) call `.reject()` on a cancellation signal that
was never created — a runtime throw; (2) special-case oversized markings to skip signal rejection, which
directly contradicts the stated "for every entry it removes, regardless of `buildState`" universal claim;
or (3) let it throw, which for `evictModel`'s path violates that same paragraph's own explicit "this step
must be non-throwing (... nothing that can itself fail)" requirement three sentences later (2597–2599). This
is the same "claimed vs. earned" pattern this audit lineage exists to catch — reproduced, one entry-kind
over, by the very fix pass that just closed the prior instance of it (v2's C-2).

**Severity adjudication (coordinator's call, since the two originating auditors' `codex-advisor` consults
disagreed):** the geometry auditor's consult called this High ("the specified failure can interrupt
teardown," reading it as a serious-but-survivable operational hazard); the cache-ownership auditor's
consult called it Critical, on the basis this lineage has used consistently — whether a conforming
implementation is possible at all, not whether a fixture currently catches the gap. **The coordinator
adopts Critical.** This matches the exact bar C-4 was held to one pass ago: C-4 was rated Critical despite
an explicitly small blast radius, because no implementer-satisfiable resolution existed without an unstated
precedence rule. The same is true here — an implementer cannot satisfy the letter of both cited passages for
an oversized-marking entry, and the two release paths' rigor is already inconsistent with each other on this
exact point (`dispose()`'s parallel passage is careful never to fold oversized markings into its own
"rejects ... signal" clause, while `evictModel`'s is not — see the geometry auditor's full comparison),
which is itself evidence the ambiguity is real, not merely a theoretical reading.

**Blast radius, stated plainly (matching this lineage's convention for low-impact Criticals):** likely small
in practice — a discriminated-union implementation will probably branch on entry kind naturally before ever
reaching a `.reject()` call, and no fixture currently exercises eviction/disposal against an epoch
containing an oversized marking to catch a literal implementation that doesn't. But the specification, as
literally written, states the opposite of a safe implicit carve-out ("regardless of `buildState`," "every
entry it removes"), so a literal-minded implementer is not led toward the safe branch by the text itself.

**NEW.** Verified via `invariant-audit-v2.md`'s own §5.2 table (post-Round-18, pre-Round-19): the
signal-rejection clause was then explicitly scoped to "a `'building'` entry," which by construction
excluded oversized markings (never `'building'`). Round 19 broadened this specifically to fix v2's C-2 —
the broadening is the correct fix for the connectivity-on-`'ready'`-entries case, and introduces this new
gap as an unintended side effect for the unrelated oversized-marking case.

**Minimal repair direction:** rewrite both release-path sites to "For every `'building'` or `'ready'` record
removed, first reject its entry-scoped cancellation signal ... Oversized markings carry no cancellation
signal and are removed directly, without a signal-rejection step" — restoring an explicit carve-out rather
than an implicit one. Add a fixture exercising eviction/disposal against an epoch containing an oversized
marking, asserting removal completes without throwing.

---

# High

Grouped by system. NEW/PRE-EXISTING and location as verified by each system's auditor against the current
file (not carried forward from v1/v2 without re-checking).

**Lifecycle**

- **H-L7 (PRE-EXISTING, confirmed unchanged).** Two Revision Notes entries (Round 12, lines 320–323; Round
  14, lines 383–385) still state a superseded disposal rule — Round 14's entry, present-tense, claims
  `isLeaseValid` is "the one" deliberate non-throwing exception, but Round 18 added a second (`evictModel`).
  Neither entry carries a superseded-annotation, unlike the analogous C-3 changelog fix this same pass
  performed elsewhere. Calibrated High per v2's own H-L7 (Revision Notes are historical and four normative
  sections supersede them, but the present-tense phrasing carries real misread risk).
- **H-L1/H-L2 (PRE-EXISTING, confirmed unregressed).** `tearDown()`/`keepCurrentModels` still never modeled
  (`keepCurrentModels`: 0 occurrences); Data Flow step 1's room-cache rationale still assumes the extension
  survives a model switch, which Viewer teardown semantics (cited elsewhere in the same document) may not
  guarantee.
- **H-L4 (PRE-EXISTING, confirmed unchanged).** `BEFORE_MODEL_UNLOAD_EVENT` listener-registration timing
  relative to `load()`/`fromViewer()` completion is unstated.
- **H-L8 (PRE-EXISTING, confirmed unchanged).** `unload()`'s ordering analysis addresses only the
  `evictModel`-no-op-on-disposed-world hazard, never the guaranteed throw from a second/repeated
  `dispose()` call, which `Viewer3D.tearDown` would catch and which would strand listener/context-menu/
  room-cache cleanup.

**Geometry pipeline**

- **H-G2/H-G5 (PRE-EXISTING, confirmed byte-identical, explicitly deferred).** Compaction-vs-size-gate
  ordering header/body transposition (1193–1196 vs. 1208–1212), fixture-pinned on the body's (correct)
  side.
- **NEW, sync-work/geometry boundary — `getChildCount` changelog residue (see also the sync-work entry
  below; both systems' auditors found this independently and disagreed on severity — the coordinator
  adopts the sync-work auditor's High, see that entry for full reasoning).**

**Query dependencies**

- **H-Q1, H-Q2, H-Q4 (all PRE-EXISTING, confirmed unchanged via direct re-read and `git diff` against
  pre-Round-18 text).** `anyComponentInside`'s caller-list omission of `ContainmentModeQuery`; the
  containment guarantee's unobtainable `ProperCrossingQuery`-false precondition; connectivity's
  undecided-trigger-point statement sitting against Data Flow's eager pre-query build order.
- **H-Q-NEW-1 (genuinely NEW this round — missed by both v1 and v2).** The Public API's mode-description
  comment (2479–2486) states `volume-overlap`/`containment` "Requires BOTH/only the TARGET certified
  closed" — phrasing that reads as a hard precondition, sitting in the same comment block as genuinely
  hard-enforced preconditions elsewhere in the same document. This directly contradicts the
  `unverified-parity-operand` degrade-gracefully mechanism established everywhere else (Error Handling
  3107–3112, the containment guarantee 1858–1862, and fixture 3328–3329, which explicitly exercises an
  open-target `containment` call and requires it to run and return a diagnosed result, not reject). An
  implementer taking "Requires" literally would reject/throw on exactly the real-world MEP-heavy-model input
  class this diagnostic was purpose-built to handle. Independently confirmed via `codex-advisor`: "the
  alternative implementation would reject common real-world geometry and defeat a deliberately designed
  degradation mechanism." Not Critical: the correct behavior is recoverable by reading the rest of the
  document, and there's no data-corruption/security exposure. The underlying text is byte-identical
  pre-Round-18 (PRE-EXISTING text), but the *finding* is new — grepped absent from both v1 and v2, which
  both explicitly claimed to have re-checked this exact territory ("found clean").
  **Correction to `invariant-audit-v3-model.md`'s own appendix item #23 ([AMBIGUOUS-7]):** it mislabels this
  finding "carried; H-Q2" — that is wrong; v2's actual H-Q2 is an unrelated finding (the unobtainable
  `ProperCrossingQuery`-false precondition). Do not let this get silently folded into H-Q2's
  already-deferred disposition in any future pass.
- **H-B4 (PRE-EXISTING, confirmed unchanged, cross-filed with sync-work budget).** `SurfaceCrossingWitness`'s
  scheduling class still stated two ways — "plain JS loop" (1974–1976) vs. "same traversal ... as the other
  two modes" (2078), i.e. an unpausable `bvhcast`.

**Synchronous-work / budget model**

- **`getChildCount` Revision Notes residue (NEW in shape, PRE-EXISTING in kind — coordinator adopts High).**
  Two Revision Notes entries (Round 16, lines 457–458; Round 17, lines 496–498) still assert, present-tense,
  that `getChildCount` is a current walk primitive / "the explicit, normative preflight before every
  `enumNodeChildren` call" — directly contradicted by the current normative text this pass's own C-1 fix
  wrote (921–922, 1654, 2272–2274) and both Testing fixtures (3550–3555), all of which state `getChildCount`
  is never called. The sync-work auditor's own `codex-advisor` consult and the geometry auditor's
  independent read disagreed on severity (High vs. Medium); the coordinator adopts **High**, matching v2's
  own H-L7 calibration for the identical shape of defect (a present-tense Revision Notes claim superseded by
  a later normative fix) — the aggravating factor here is that this same fix pass (Round 19) demonstrated
  and applied the correct annotation pattern for its own C-3 fix's analogous stale changelog entry, one
  section over, but didn't apply it here. This is a completeness gap in Round 19's own scope-grep, not a
  design defect.
- **H-B5, H-B6, H-B7, H-B8, H-B9 (all PRE-EXISTING, confirmed unchanged).** Canonical checkpoint-site
  enumeration not updated for the broad-phase per-pair checkpoint; `releaseEpochScopedState`/`dispose()`'s
  clear still unclassified in the atomic-operations table; `bvhcast`'s own-start-time vs. shared-accumulator
  clock ambiguity; the performance gate's `frameBudgetMs`-vs-~16ms-band self-contradiction; the dangling
  instance-tree-readiness forward reference to Risks.

**Cache ownership**

- **H-2/H-3 (PRE-EXISTING, confirmed unchanged).** The implied `CollisionInstance` cache — named by the
  checkpoint protocol (2822–2824) and asserted on by two fixtures (3581–3584, 3634–3637) — remains declared,
  owned, keyed, and released nowhere in the document.

---

# Medium

Grouped by system, condensed.

**Geometry pipeline**
- **M-1 (NEW wording tension, mechanism unaffected).** The stated phase order "weld, then connectivity if
  needed, then the BVH" (1175–1178, echoing older phrasing at 1086) is false as a universal temporal claim —
  the document's own state model and fixtures (3470–3490) establish connectivity can start *after* weld+BVH
  already resolved a `'ready'` record. Confirmed (via `codex-advisor`) this doesn't undermine the
  cancellation mechanism's correctness, since the signal is a broadcast every unresolved phase races,
  regardless of count or order — a wording imprecision, not a design gap.
- **M-2 (NEW completeness gap in Round 19's own hygiene work).** The Round 16/17 `getChildCount` changelog
  claims (see High, above) went unannotated despite this same pass demonstrating the correct annotation
  pattern for its own C-3 fix — filed here as the "why this happened" companion to the High-severity finding
  above.
- **M-3 (PRE-EXISTING, confirmed unchanged, = v2's M-G4/H-G3).** The oversized-marking registry entry has no
  specified creator, and the narrow phase's per-pair check (2411–2422) recomputes `activeTriangleCount` fresh
  rather than consulting a persisted marking.

**Cache ownership** (all PRE-EXISTING, confirmed unchanged in substance)
- `dispose()` never states whether `liveModelByModelId` entries are actually removed (M-L4/L5).
- `evictModel`'s "nothing left to do" justification never mentions `liveModelByModelId` (M-1/M-G5).
- `dispose()`'s "wholesale-clears three caches" framing is stale after Round 18 collapsed BLAS/connectivity
  into registry phase slots (M-2/M-G6).
- `dispose()` carries no stated non-throwing requirement, unlike `releaseEpochScopedState`'s explicit one —
  now sharper given C-5 above, since the identical signal-rejection defect in `dispose()` doesn't even
  violate an explicit written invariant there (M-3/M-G7).
- "Sweeps `GeometryRegistry`" (linear-scan-implying verb) vs. "a synchronous map/set removal" — same
  paragraph, same operation (M-4/M-G8).
- The room cache has no stated release path on `world.dispose()` — only `unload()`'s third step clears it,
  and `unload()`'s per-step isolation is still open (SILENT-13, calibrated to v1's M5/M10).

**Query dependencies**
- **Low, not Medium (downgraded from a candidate Medium by the auditor's own re-read).** The C-3 replacement
  wording ("...independent of which one does or doesn't also reach stage 3 (see the note after stage 3...)")
  is a mild regression in directness versus the old (wrong) prose, which at least gave an immediate answer.
  Doesn't rise above Low: the target section is unambiguous and nearby, and the fact is independently stated
  at 5 other sites.

**Lifecycle**
- Two extraction-walk checkpoints locally omit the two-part liveness protocol, though the global statement
  covers them (M-L1, PRE-EXISTING).
- "Every checkpoint checks `disposed` first" is technically false for the `bvhcast` abort-only checkpoint,
  harmless in practice (M-L2, PRE-EXISTING).
- Several rejection paths still name no error type, widened by Round 18's `maxChildrenPerNode` addition
  (M-L5, PRE-EXISTING).

---

# Low

- **[Lifecycle, new observation]** Checkpoints say "the model's load epoch" (singular) while `findClashes`
  has two operand fields — resolved trivially by the same-model constraint, but never stated as the reason.
  No practical risk.
- **[Lifecycle, PRE-EXISTING]** `fromViewer`'s `options.model` parameter has zero contract anywhere else in
  the document — dead/inert forward-compat surface.
- **[Lifecycle, PRE-EXISTING]** `dispose()`'s "best-effort tombstones" language doesn't specify mechanism;
  a naive loop-based implementation silently no-ops.
- **[Lifecycle, PRE-EXISTING]** `evictModel`'s justification #3 ("called ONLY from the extension's handler")
  sits in mild tension with the Purpose section's "not sized to the extension" framing.
- **[Lifecycle, PRE-EXISTING]** `isModelLive`'s doc comment still describes it as retained "for tests,
  diagnostics" after Round 18 put it on a production path.
- **[Geometry, PRE-EXISTING]** `referenceCount` declared once, never used.
- **[Geometry, PRE-EXISTING]** The instance-tree-readiness "see Risks" forward reference has no target.
- **[Geometry, PRE-EXISTING]** `>=` vs. `>` boundary wording at `maxSyncTriangleCount`.
- **[Geometry, reconciled]** "Every phase slot runs to settlement" vs. phase slots being rejectable — not a
  genuine contradiction on the more careful reading ("settles either way," not "cannot be cancelled").
- **[Cache, cosmetic]** Pseudocode variable naming drift (`thisPromise` vs. "thisCall's own promise") for
  the same referent — unambiguous from context at every site, just an inconsistent name.
- **[Sync-work, cosmetic]** Status-line line-count/round-mention drift (3993 actual lines vs. 3935 claimed
  in the Round-19 disposition doc; Status block doesn't mention Round 19).
- **[Sync-work, PRE-EXISTING]** The worst-case-span formula's ordering relative to the measurement that
  would establish it; whether the performance gate is two or three runs.

---

# Notes on scope and what was checked and found clean

- **No system found a second Critical.** Lifecycle, query dependencies, and (modulo C-5) cache ownership
  and geometry are otherwise internally consistent in their normative text.
- **All four of Round 19's fixes (C-1 through C-4) verified landed correctly** at every cited normative
  site and fixture, independently re-read by at least one system auditor each (not merely trusted from the
  disposition doc):
  - **C-1** (`getChildCount` removed from `maxChildrenPerNode` enforcement): confirmed consistent across the
    Components list, atomic-operations table, Data Flow step 3, Risks, and Testing fixtures — modulo the
    two stale Revision Notes entries reported as High above.
  - **C-2** (entry-lifetime-scoped cancellation signal): confirmed no `'building'`-only gate remains at any
    of the four originally-cited sites, and the lifecycle-level `dispose()`/`evictModel` contracts correctly
    describe the new scope — modulo the oversized-marking gap reported as Critical (C-5) above, which is a
    boundary case the original fix didn't anticipate, not an incomplete application of the intended fix.
  - **C-3** (`anyComponentInside` stage-scoping wording): confirmed clean by independent re-derivation
    against the primary text and `git diff`, including a full-document sweep of every "stage 3"-adjacent
    occurrence (11 total) — no residual inversion anywhere, including Risks and Open Questions, which the
    model-build agent didn't specifically check.
  - **C-4** (room-cache identity-guarded delete): confirmed clean, including tracing the one rejection path
    not explicitly re-quoted at the three edited sites (`admitModel`'s synchronous pre-`model.search` throw)
    back to the general umbrella rule that already covers it.
- **Every PRE-EXISTING High/Medium/Low finding named in the Round-19 disposition's "deliberately not
  touched" list was individually re-verified against current line numbers** by the relevant system
  auditor — not merely trusted from the disposition doc — and confirmed present, unchanged in substance,
  and correctly characterized.
- **The model-build agent's own extraction is confirmed accurate** where independently spot-checked, with
  one correction: appendix item #23 ([AMBIGUOUS-7]) mislabels the new H-Q-NEW-1 finding as "carried; H-Q2"
  — see that entry above.

---

# Recommended disposition

This audit found one Critical (C-5), introduced by this session's own Round 19 fix, plus two genuinely new
High findings that both v1 and v2 missed (`getChildCount` changelog residue; the Public API hard-precondition
wording). None of the four Round-19 fixes themselves need to be reopened or redesigned — C-5 is a narrow
carve-out omission in already-correct broadened wording, not a flaw in the entry-lifetime-scoped signal
model itself. A minimal Round 20 fix pass, scoped to C-5 alone (plus, at the user's discretion, the two new
Highs, which are one-paragraph annotation/wording fixes each and not architecture-level), would close this
round's findings without touching any of the pre-existing, deliberately-deferred residuals cataloged above.
