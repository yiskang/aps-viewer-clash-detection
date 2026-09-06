# Collision Library M2 — I-3 target-eligibility policy disposition

Source: Batch 2 (Tasks 5-8) whole-batch review finding I-3 (see
`.superpowers/sdd/2026-09-06-collision-library-milestone2-implementation/progress.md`, "Whole-batch
review (Batch 2, d764283..de3439c) findings and ruling"). Deferred at the time as a product-policy
question, not fixed. This document records the plan owner's (user's) resolution and the narrow
corrections it requires. It also resolves the separate, previously-parked §3.3 "culled" spec-text
defect flagged during Task 2 (same ledger, "Task 2: parked" entry) — both defects share the same root
cause (the original §3.3 text's erroneous "hidden/culled" pairing) and are resolved together.

## Finding (I-3, recap)

`extractFragments` (M1, protected, unchanged — per-dbId subtree walk) and `extractAllFragments` (new
M2, whole-model enumeration, Task 5) applied **different eligibility policies**: `extractAllFragments`
excluded and diagnosed a hidden fragment (`instanceTree.isNodeHidden(ownerDbId) === true`,
`fragment-hidden` diagnostic reason); `extractFragments` never checks hidden state at all and always
includes a hidden fragment's fragments in its walk. A caller could get a pair result for a fragment
via an explicit-dbIds target, and a diagnostic claiming that same fragment was excluded via a
whole-model target — for what the spec's own §3.3 called the same "whole-model scope."

Related, previously-parked defect: the original §3.3 text literally required a diagnostic for a
"hidden/culled" fragment, but the evidence note
(`docs/superpowers/specs/m2-extractAllFragments-viewer-evidence.md`) confirmed during Task 2 that no
stored per-fragment/per-node state for camera-frustum culling exists anywhere in this Viewer build —
the literal text was unimplementable. Task 5 correctly declined to fabricate a `fragment-culled`
diagnostic, but the spec text itself was left uncorrected pending a plan-owner decision (out of scope
for an implementation task to edit).

## Policy decision (plan owner, 2026-09-06)

- Whole-model scope means every collision-eligible model fragment, not every currently-visible
  fragment.
- Hidden fragments remain eligible for clash detection if otherwise structurally valid.
- Viewer/render-time culling is **not** an M2 collision-eligibility state and must not have a
  fabricated diagnostic requirement.
- Fragment holes are excluded and diagnosed.
- Fragments whose owning dbId cannot be resolved are excluded and diagnosed.
- Transient geometry availability continues through the established collision pipeline/diagnostics
  (`geometry-not-yet-available`, §10) rather than a separate whole-model-only eligibility rule.
- The explicit-dbIds and whole-model `targets` extraction paths must converge on the same M2
  target-eligibility semantics, so `targets: [{model}]` and `targets: [{model, dbIds}]` never disagree
  merely because they used different extraction primitives.

Rationale: `extractFragments`'s hidden-inclusive behavior is protected M1 behavior and is not being
reopened. Since the two extraction primitives must converge, `extractAllFragments` is the one that
moves to match — it was the new (M2) primitive, and it is not a protected M1 behavior. This also
retires the "hidden/culled" pairing that produced the unimplementable culled-diagnostic requirement:
hidden and culled are not symmetric (the evidence note's own point), and neither should gate
collision-eligibility.

## Corrections made

1. **Design spec** (`docs/superpowers/specs/2026-09-05-collision-library-milestone2-design.md`, §3.3):
   the "handling for a fragment index with no live fragment (holes), a hidden/culled fragment, and a
   fragment whose owning dbId cannot be resolved — each must produce a diagnostic" bullet is replaced
   with the corrected eligibility policy above, explicitly binding and tagged `[I-3 disposition]`. No
   other section of §3.3 (accessor names, capacity ceiling, enumeration discipline) is reopened.
2. **Evidence note** (`docs/superpowers/specs/m2-extractAllFragments-viewer-evidence.md`): the "Resolved
   for Task 5" hidden-fragment row is marked superseded by this disposition (hidden is no longer
   excluded/diagnosed), with a pointer to this document. The underlying evidence itself (`isNodeHidden`
   is real, public, documented; culled has no stored state) is unchanged and still correct — only the
   POLICY built on top of that evidence changes.
3. **Code** (`collision/viewer/ViewerModelAdapter.js`, `extractAllFragments`): the hidden-fragment
   exclusion branch is removed. A hidden fragment now flows through to record construction exactly
   like any other structurally-valid fragment, producing no diagnostic. `model.getObjectTree()` is no
   longer called by this function (it was read only to obtain `instanceTree.isNodeHidden`).
   `extractFragments` itself is untouched, per this session's protected-M1-behavior constraint.
4. **Tests**:
   - `test/viewer/ViewerModelAdapter.extractAllFragments.test.mjs`: the "a hidden fragment is excluded
     from records and diagnosed" test is replaced with a test proving a hidden fragment is INCLUDED in
     records with no diagnostic, and a new convergence test proving `extractFragments` and
     `extractAllFragments` agree on the same hidden fragment for the same model.
   - `test/CollisionWorld.findClashes.crossModel.test.mjs`: the I-2 dedup regression test used a hidden
     fragment as its example "real diagnostic" fixture; since hidden fragments no longer produce a
     diagnostic, it is switched to a not-loaded fragment (a different diagnosable condition), which
     equally exercises the diagnostic-dedup mechanism I-2 fixed. A new end-to-end test is added
     proving `targets:[{model}]` and `targets:[{model,dbIds}]` agree (same pair, no diagnostic) for a
     hidden target fragment through the real `findClashes` API, not just the raw extraction
     primitives.
5. **Ledger** (`.superpowers/sdd/2026-09-06-collision-library-milestone2-implementation/progress.md`):
   I-3 marked resolved by this disposition; Task 2's parked "culled" spec-defect item marked resolved
   by the same disposition.

## Convergence scope (codex-advisor consult, 2026-09-06)

A codex-advisor review of this disposition's first draft correctly flagged that the "explicit-dbIds
and whole-model paths must converge" requirement, read maximally broadly, is not fully satisfied:
`extractAllFragments` still excludes+diagnoses a **not-loaded** fragment (`fragment-not-loaded`) and
an **owner-unresolvable** fragment (`fragment-owner-unresolvable`), while `extractFragments`'s own
per-dbId tree walk never checks `isNotLoaded` at all (it would include a not-loaded fragment's
record unconditionally) and cannot structurally produce an "owner-unresolvable" fragment in the
first place (a fragment `extractFragments` can reach is, by construction, attached to the very node
it was requested under). A caller COULD in principle request the same not-loaded fragment once via
`targets:[{model,dbIds}]` (included) and once via `targets:[{model}]` (excluded+diagnosed).

**Ruling: this is a real, pre-existing asymmetry, but it is a DIFFERENT, already-tracked gap — not
part of what this disposition's policy decision addresses, and not fixed here.** The policy decision
recorded above is scoped, point for point, to the same four conditions the original (defective)
§3.3 bullet enumerated: holes, unresolvable owner (as `extractAllFragments`'s own accessor-based
check defines it), hidden, and culled. It does not instruct extending `extractFragments` (protected,
explicitly not to be touched this session) to check `isNotLoaded`, nor instruct
`extractAllFragments` to stop diagnosing not-loaded/owner-unresolvable fragments (the decision
explicitly keeps holes and unresolvable-owner excluded+diagnosed). The not-loaded asymmetry
specifically is the SAME pre-existing `extractFragments` gap already flagged, independently, during
Task 5's own review (`progress.md`, "Task 5: flagged for whole-branch/plan-owner review... a
codex-review pass surfaced two High-severity resource-safety findings in extractFragments's own
pre-existing body") — carried forward there as a spec discrepancy requiring a plan-owner decision,
not silently missed here. Resolving it would mean either changing protected `extractFragments`
behavior (out of this session's explicit scope) or relaxing `extractAllFragments`'s not-loaded/
owner-unresolvable diagnostics (not requested by the policy decision as given). Cost if this ruling
is wrong: a caller requesting a not-loaded fragment through the two `targets` shapes can still see
one shape include it and the other exclude+diagnose it, exactly the same shape of issue as the
now-fixed hidden-fragment case — low residual cost since it is explicitly flagged here (not a silent
gap) and was already independently on the plan owner's radar via Task 5's own carried-forward
finding.

**What IS fixed and verified end-to-end:** hidden-fragment eligibility, the one condition the policy
decision explicitly changes, converges through the real `findClashes`/`targets` API, not just at the
primitive level — see `test/CollisionWorld.findClashes.crossModel.test.mjs`'s new I-3 end-to-end
test (`targets:[{model}]` vs `targets:[{model,dbIds}]` produce the same pair, no diagnostic, for a
hidden target fragment).

## Scope discipline

This is a narrow, targeted correction. It does not reopen any other §3.3 provision (accessor names,
enumeration-capacity-bound discipline, 2D-array `ownerDbId` handling), any other Batch 2 finding
(I-1, I-2, M-1, M-2, M-3 — already fixed, commit `a1f724a`), or any earlier design-resolution
disposition (`collision-library-m2-targeted-design-resolution-disposition.md`). No comprehensive spec
review was run.
