# Invariant audit v6 — LIFECYCLE system

Auditor: one of five parallel per-system auditors for `invariant-audit-v6.md`, replicating the v1–v5
methodology. **System boundary:** `Model`-object identity / `loadEpoch`, disposed-first checkpoint
semantics, `tearDown()` / `unload()` / `dispose()` ordering, `world.evictModel`'s race safety, and the
mode dependency matrix's lifecycle-adjacent claims.

Input: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`, read sequentially in
full at **4431 lines** (not sampled). Reference baseline:
`docs/superpowers/specs/invariant-audit-v6-model.md` (built at 4429 lines). Known-item baselines:
`invariant-audit-v5.md` (its Medium/Low lists are **not** re-litigated here) and
`round-22-h2-derivation-pass-disposition.md`.

**Line-number note.** The live file is **two lines longer** than the text the v6 model was built from:
Round 22's edit #5 (the two stale `~16ms` cross-references) was applied *after* the model-build pass —
the disposition doc says so itself, crediting the model-build agent's §4.7 residue sweep with finding
them. All citations below are to the **live** file; from ~line 1798 onward, live numbers run **+2**
relative to the model's. Consequently v6-model Appendix items **17** (`bvhcast`'s self-bound citing a
`~16ms` gate band → now 1797–1800, reads "**Round 22: ≈24ms**") and **19** (gate criterion 6's `~16ms` →
now 4219–4222, reads "the tolerance criterion above") are **already closed in the live text** and are not
carried forward as findings.

Second opinion: `codex-advisor` (`medium`). A live `.codex-worker` queue was present and the worker was
running; the native `advisor` tool was not used. Both High candidates below were put to it as explicit
severity questions, and **it moved both** — see **Adjudication record**.

---

# Summary

| Severity | Count | Item |
|---|---|---|
| **Critical** | **1** | **C-L1** — the "counterpart model" acceptance fixture (3869–3873) is unsatisfiable under Milestone 1's own same-model entry contract. **PRE-EXISTING**, not Round-22-caused, and it reopens **none** of the six protected Critical invariants. |
| High | **0** | — |
| Medium | 3 | M-L1 (checkpoint revalidation vs. Round 22's conditional yield), M-L2 (sweep cost model still registry-only), M-L3 (post-Round-22 "yield point" vocabulary) |
| Low | 2 | L-L1 (cross-model rejection ordering/error class), L-L2 (a v5 Medium now closed in normative text) |

**Round 22 introduced no lifecycle regression.** Every site it touched was re-read for lifecycle
reachability; see the confirmation table.

---

# Protected Critical invariants — re-verified, not assumed

| Protected invariant | Re-verified against (live lines) | Verdict |
|---|---|---|
| **Model-object identity / `loadEpoch`** | `modelLifecycle` `WeakMap` + two-variant union (3061–3076); `'evicted'` carries no epoch (2898–2902, 3064–3065); tombstone permanent, never cleared or overwritten (3068–3072); `WeakMap` chosen so nothing may enumerate it (3072–3076); `nextLoadEpoch` global/monotonic/never reset (3092–3097); `(loadEpoch, geometryIndex)` keying (1173–1176, 1081–1090, 3138–3152); `CollisionInstance` cache mirrors the same keying (1194–1206) | **Intact** |
| **Disposed-first checkpoint semantics** | `dispose()` sets `disposed` first, synchronously (3003–3008, 3190–3193, 3518–3520); the two deliberate non-throwing exceptions still check `disposed` first and differ only in the action (3009–3017, 2955–2960, 2854–2860); `isModelLive` throws first (2991–2993); every checkpoint checks `disposed` before epoch (2780–2783, 3195–3207, 2219–2223, 2708–2711); a suspended query fails at its next checkpoint on the flag, not on a per-model tombstone (3036–3038) | **Intact** — the *ordering* is nowhere contradicted. M-L1 raises a question about *when* the check runs, not about its order. |

The other four protected invariants sit in other auditors' territory; nothing I read contradicts them.
The mode matrix's lifecycle-adjacent claim — both operands' records go through the same connectivity gate
in `containment`/`volume-overlap` (1267–1272) — is consistent with epoch-keyed record ownership and with
the same-model restriction.

---

# Critical

## C-L1 (PRE-EXISTING, unrelated to Round 22). The "counterpart model" acceptance fixture cannot be constructed under Milestone 1's own entry contract

**Normative rule it pins** (1323–1332, site 8 of the checkpoint table — the deliberate exception to
"revalidate both operands"):

> "A between-phases checkpoint on a shared build checks `disposed` first, then the liveness/epoch of the
> **one model that owns this geometry** — the operand whose `loadEpoch` is in the record's key — and
> nothing else. **It must not reject because the initiating query's *other* operand was evicted: the
> entry is shared with callers that may not hold that operand at all**, and every sharer of this entry
> necessarily shares its owning `(model, epoch)`, since epochs are globally unique and the key carries
> one."

**The fixture** (3869–3873, in the Milestone-1 `CollisionWorld.findClashes` fixture list):

> "**an eviction of the *counterpart* model while a shared build is in flight** — the build's own
> between-phases checkpoint must **not** reject the shared phase slot (the evicted model does not own
> this record); **the initiating query must still reject with `ModelEvictedError` at its own next
> checkpoint**, and a second caller holding only the owning model must receive the completed geometry."

**Why it is unsatisfiable by construction.** Write `S` = `query.source.model`, `T` =
`query.target.model`, `O` = the model owning the awaited `GeometryRecord`.

1. `S === T` or the call rejects before any extraction — 900–903, 2558–2559, 2805, 3489–3491.
2. Every `GeometryRecord` is keyed by `(loadEpoch, geometryIndex)`, the *owner's* epoch — 1173–1176,
   3138–3152; epochs are globally unique per admitted object, so two `Model` objects can never share an
   entry (3092–3097, 3143–3152).
3. The narrow phase only ever gets/builds records for the candidate pair's own operand geometries —
   2738–2750.

Therefore, for every record any Milestone-1 query awaits, **`O === S === T`**. The fixture requires the
evicted counterpart model to be, simultaneously:

- an operand of the initiating query (otherwise that query has no reason to reject with
  `ModelEvictedError`) ⇒ `counterpart === S === T === O`; and
- **not** the owner of the awaited record (otherwise the shared phase slot would reject, which the
  fixture forbids) ⇒ `counterpart !== O`.

`counterpart === O` and `counterpart !== O` — no concurrency interleaving, lazy admission, `modelId`
reuse, or scheduling order can reconcile them, because none of those changes object identity. The
configuration is unreachable, so the fixture cannot be written as specified.

The rationale clause at **1326–1328** ("the entry is shared with callers that may not hold that operand
at all") states the same unreachable premise as a fact about the present design. It is a sound
*forward-looking* concern for a cross-model milestone; it is false for Milestone 1, where validating the
owner necessarily validates both operands because they are the same object.

**Scope of the damage, stated honestly.** The underlying build-phase rule itself is **not** broken: it is
satisfied vacuously, it is conservative, and an implementation that follows it is correct either way. No
protected invariant is reopened, no runtime correctness property fails, and nothing else in the document
depends on the unreachable case. What is unsatisfiable is a **stated Milestone-1 acceptance fixture** —
and the realistic implementer response to "this fixture cannot be constructed" is to relax the
same-model entry check that makes it unconstructible, which is a live lifecycle guard (2558–2559,
3489–3491).

**Severity adjudication.** I first rated this High and put it to `codex-advisor`, which independently
re-derived the identity argument, confirmed it, and rated it **Critical** under this lineage's stated bar
("unsatisfiable-by-construction, not merely under-specified"). I accept that, on the lineage's own
precedent: Round 19's **C-2** and Round 20's **C-5** were both Criticals of exactly this shape — a
requirement whose literal text cannot be satisfied for a particular state (an oversized marking with no
cancellation signal to reject), pinned by fixtures at 3856–3868 — and Round 19's **C-4** was Critical
partly because a fixture pinned the un-satisfiable side of a rule. The dissenting reading, recorded for
the fix pass rather than hidden: one may argue that only *normative mechanism* text can be Critical and a
test-section defect is High. I do not think that survives contact with C-4/C-5.

**Fix options (either is cheap; neither touches a mechanism):**

1. Defer both the fixture (3869–3873) and the rationale clause (1326–1328) to the cross-model milestone,
   marking the owner-scoped rule explicitly vacuous-but-retained for forward compatibility.
2. Keep the rule and replace the fixture with a constructible same-model one: two concurrent calls
   against the same model sharing one entry, the owning model evicted mid-build — assert the shared slot
   rejects exactly once, both callers reject with `ModelEvictedError`, and the entry is removed
   identity-guarded.

**Explicitly not a fix:** relaxing `source.model === target.model` to make the fixture reachable. That
expands Milestone 1's scope (900–903) and removes a lifecycle guard.

**Not previously recorded.** `invariant-audit-v2.md` (line 953) lists the fixture as "counterpart-model
eviction does not reject the shared slot" without questioning its reachability; the v4 and v6 models
record site 8's exception and the fixture verbatim without flagging it; no round's disposition doc touches
it. It predates Round 22 by several rounds (the site-8 exception is Round-18-era).

---

# High

**None.** The one other candidate I developed — that Round 22's newly-conditional checkpoint yield leaves
the lifecycle revalidation's own timing unstated — was put to `codex-advisor` as a High/Medium question
and adjudicated **Medium**; it is recorded as M-L1 below with that reasoning.

---

# Medium

## M-L1 (PRE-EXISTING ambiguity, broadened and made visible by Round 22). Is the two-part revalidation unconditional, or only on the branch that yields?

Round 22's new general rule (1925–1929, verbatim): "**Every checkpoint named in this document — the
build-phase checkpoints and the `bvhcast`-entry checkpoints included — is this same mechanism** … A
checkpoint that finds the accumulator not yet due **does not yield at all**; it lets whatever
non-preemptible or abort-only unit follows it run to completion in the same span." Mirrored for build
phases at 1278–1290 ("each phase's checkpoint (disposed, then model epoch — see 'Race safety') … yields
only when the accumulator is already due, not unconditionally").

The lifecycle rule is the two-part revalidation, `disposed` first then epoch (2780–2783, 3161–3170,
3196–3199, 3520–3522). **Whether that revalidation is unconditional at a checkpoint, or only runs when
the checkpoint actually yields, is never stated** — and both concrete sequencings the document gives put
it inside the yield branch:

- `ContainmentQuery`, 2217–2223: "**If it exceeds `frameBudgetMs`**, the loop `await`s the same
  scheduling yield …, **then** runs the same two-part revalidation every other checkpoint runs".
- Broad-phase scan, 2707–2711: "**when the budget is due** it `await`s the same scheduling yield,
  re-validates the way every other checkpoint does …, and resumes from exactly the
  `(sourceIndex, targetIndex)` it left off at".

The claim that depends on the answer is at **1329–1332**: "Each caller separately re-validates both of
its own operands at its own checkpoints, **before and after awaiting a shared phase slot**." An await on
another caller's shared phase slot is a genuine suspension but is not an accumulator-driven checkpoint;
if revalidation only happens on the yielding branch, the checkpoint after that await may revalidate
nothing.

**Why Medium, not High** (codex-advisor's adjudication, which I accept): one coherent implementation
satisfies every sentence at once —

```text
revalidate                    # unconditional
if accumulator is due:
    await scheduling yield
    revalidate again
```

Nothing forbids it, 1329–1332 and 2780–2783 *do* supply a normative mechanism, and the fault is that the
concrete example at 2217–2223 can mislead an implementer into placing revalidation only inside the yield
branch. My original framing ("the claim has no mechanism") overstated it. The blast radius is small
independently: if the record's *owner* is evicted or the world disposed during that await, the release
path rejects the entry's own cancellation signal (1342–1361, 2918–2928, 3025–3030) and the awaited slot
rejects, so the caller fails regardless; and the only uncovered case — a *non-owner* operand evicted
during the await — is exactly the configuration C-L1 shows is unreachable in Milestone 1.

**Attribution:** codex-advisor's point stands — the conditional branch at 2217–2223 and the
before/after-shared-slot requirement both predate Round 22 (they are in the committed text), and Round 22
claims no lifecycle behavior change (745–751), which is true. Round 22 **broadened** the "same mechanism"
language to cover every checkpoint, which is what makes the ambiguity newly conspicuous. Recorded as
pre-existing, not Round-22-caused.

**Fix:** one clause at 1925–1929 — the two-part revalidation runs whenever a checkpoint is reached; only
the scheduling yield is accumulator-conditional; and any actual `await` (including one on a shared phase
slot) is followed by a second revalidation.

## M-L2 (PRE-EXISTING; a v5 known item whose *status* has changed)

The atomic-operations row for the per-epoch sweep (1858) still describes only the `GeometryRegistry`
half — "enumerating every `GeometryRegistry` entry filed under one epoch … cost scales with the number of
live entries under that epoch, which nothing in this design ceilings" — while `releaseEpochScopedState`
also performs an **independent** deletion over the `CollisionInstance` cache's own keyspace, explicitly
"a strict superset of the registry's lazily-built candidate-pair keyspace" (1227–1228, 2914–2918). The
worst-case-span exclusion (1963–1974) and both gate criteria (4187, 4250–4258) inherit the omission.
`invariant-audit-v5.md` records this as "addressed by this document's Remediation pass"; the row did gain
the `'building'`/`'ready'` carve-out, but the second keyspace is still unaccounted for. Flagged only
because the known item's status differs from what v5 recorded; the cost model itself is the
cache-ownership / sync-work auditors' territory. (= v6-model Appendix item 18.)

## M-L3 (NEW wording consequence of Round 22, cosmetic if M-L1 is resolved)

The lifecycle vocabulary now contradicts Round 22's conditional-yield rule wherever it names these sites:
"every **per-yield** checkpoint" (3004, 3196), "every **yield point** inside `findClashes`" (3161), "at
its next **yield** checkpoint" (3520), and the still-live "a **yield-and-revalidate** checkpoint sits
before each phase" (1295) — each names a site that, post-Round-22, frequently does not yield. Harmless
once M-L1's clause lands; actively misleading until then, since 1295 is the exact sentence Round 22's own
correction (1278–1290) was written to supersede and it was left standing four lines above the
publication rule.

---

# Low

- **L-L1 (PRE-EXISTING).** The **ordering** between `findClashes`'s cross-model rejection and its
  lifecycle entry checks is unstated: the Public API comment (2799–2805) puts disposal/eviction first,
  Data Flow step 3 (2558–2559) lists the cross-model rejection first. Combined with the already-recorded
  `[SILENT]` on the cross-model rejection's error type (v6-model Appendix item 6), a cross-model query
  naming an evicted model has no determined error class.
- **L-L2 (status change on a v5 known item — now closed).** v5's Medium "`dispose()`'s 'wholesale-clears
  three caches' framing is now numerically stale at four" is **resolved in normative text**: 3018–3020 and
  3214–3216 both enumerate four caches, including the `CollisionInstance` identity cache. The "three"
  wording survives only at line 414, inside Round 15's historical changelog entry, which this document's
  own convention leaves unrewritten. No action needed.

---

# Confirmation: Round 22 introduced no lifecycle regression

| Round-22 site (live lines) | Lifecycle claim it carries | Verdict |
|---|---|---|
| `ThreeMeshBvhBackend`/`BlasCache` per-phase-checkpoint correction, 1278–1290 | "(disposed, then model epoch — see 'Race safety')" | Two-part protocol and its ordering preserved verbatim; the record-owner scoping at 1323–1330 untouched. **No regression**; the only residue is M-L1's timing question, adjudicated pre-existing. |
| Per-atomic-operation bullet + Round-22 correction, 1885–1893 | none | No lifecycle claim. |
| New abort-only bullet, 1899–1909 | names "the ordinary pair/stage checkpoint under `CollisionWorld`" | Consistent with the canonical checkpoint enumeration at 2762–2767. No lifecycle claim. |
| Corrected formula + per-tier addends + only-one-unit argument, 1931–1961 | none | No lifecycle claim; disposal ordering not referenced. Eviction/disposal are synchronous and can only land while a call is suspended, so a *longer span between checkpoints* cannot let stale state be read within it. |
| Ceiling-less exclusions, 1963–1974 | names `releaseEpochScopedState`/`dispose()`'s per-epoch registry sweep | Matches the atomic-ops row (1858) and gate criteria (4187, 4250–4258). The sweep's own lifecycle contract — non-throwing, runs inside the Viewer's unguarded `BEFORE_MODEL_UNLOAD_EVENT`/`dispose()` frames (2939–2945, 2961–2976) — is unchanged and uncontradicted. **No regression** (M-L2's omission predates Round 22). |
| Performance gate criterion 1, 4181–4192 | excludes exactly the two spans §4.5 excludes; invents no new exception | Consistent. No lifecycle claim beyond naming the sweep. **No regression.** |
| Post-model edit, `bvhcast` self-bound, 1797–1800 | none | Stale `~16ms` gate reference replaced by "**Round 22: ≈24ms**"; arithmetic still holds (~16 ≤ ≈24). Closes v6-model item 17. |
| Post-model edit, gate criterion 6, 4219–4222 | none | Now "says nothing about the tolerance criterion above". Closes v6-model item 19. |
| Round 22 changelog entry, 732–751 | "No behavior, fixture, query/**lifecycle**/cache/extraction mechanism … touched" | **Verified true for lifecycle**: no lifecycle mechanism, method contract, error type, state shape, or fixture changed. |

---

# Confirmed unchanged (known items, deliberately not re-argued)

The `tearDown()`-path proviso's scope ambiguity (v5's A3; live at 2417–2424, re-punctuated by Round 21
and stable since, with the 7.124.2 bundle citations present at 2425–2431); `load()`'s "only calls
`fromViewer`" staleness (2388 vs. the registration-ordering paragraph at 3234–3244); `load()`/`unload()`
TS return types unstated; `unload()`'s two documented throw hazards and the explicitly-open per-step
isolation / listener-ordering question (3245–3270); `world.dispose()`'s own contract lacking an explicit
non-throwing requirement; the Milestone-1 wiring gap stated only in Data Flow step 1 (2397–2431) and
narrowed at 4416–4427; `locateElementByRoom`'s deferred model-resolution question (2436–2441);
`referenceCount` still dead (1176); the Status header five passes stale (3–19); no Round-20 changelog
entry. All verified present and byte-stable in the live text.

---

# Adjudication record

One `codex-advisor` (`medium`) consult, submitted as a background call against the running
`.codex-worker` queue (response `20260902-235511-15400-5047`). It was given both candidates with the
lineage's severity definitions and asked to check the cited line ranges directly and to say where I was
wrong. Outcome — **it moved both**, in opposite directions:

- **Candidate 1 → Medium (mine: High).** It supplied the satisfying implementation shape
  (`revalidate; if due { await; revalidate }`), pointed out that 1329–1332 + 2780–2783 *do* constitute a
  normative mechanism, and judged my "no mechanism" framing too strong. It also rejected my attribution
  to Round 22, on the ground that the conditional branch at 2217–2223 and the before/after-shared-slot
  requirement are both in the committed pre-Round-22 text. Accepted in full → **M-L1**.
- **Candidate 2 → Critical (mine: High).** It independently re-derived the `O === S === T` identity
  argument from the cited lines, confirmed the fixture requires `counterpart === O` **and**
  `counterpart !== O`, checked for an escape hatch (a prefetch/build API letting a call await an
  unrelated model's record — none exists in this design), and rated it Critical under the stated bar,
  adding "do not downgrade it merely because its intended future behavior is reasonable." Accepted →
  **C-L1**, with the dissenting reading recorded in that section.

It also noted, as an uncertainty, that Round 22 is currently uncommitted, so its attribution work was
against the working-tree diff rather than an authored commit. That matches the repo state
(`git status` shows the design doc modified and both Round-22 docs untracked).
