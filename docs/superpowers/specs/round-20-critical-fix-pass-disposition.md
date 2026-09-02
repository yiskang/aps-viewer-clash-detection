# Round 20 — Critical-only invariant fix pass: disposition

Type: system-level fix pass, one Critical finding only (not a Codex review round — no `codex-review spec`
pass was run on the whole document, per explicit instruction). Source of truth:
`docs/superpowers/specs/invariant-audit-v3.md`, finding C-5. Target:
`docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (3993 lines before this pass,
4017 after — 861 insertions / 144 deletions net, per `git diff --stat`).

Method: one drafting agent (sonnet), given the pre-adjudicated fix direction directly (no independent
re-derivation needed — the repair direction was already agreed by two independent `codex-advisor` consults
in the audit that found C-5), made all four edits directly via the `Edit` tool and reported back. No
parallel-agent collision risk this round (single fix, unlike Round 19's four independent regions), so no
coordinator merge step was needed beyond a post-edit sanity grep.

## What was fixed

**C-5 (geometry / cache ownership boundary) — oversized markings vs. the entry-lifetime cancellation
signal.**

Round 19's C-2 fix widened the cancellation-signal-rejection wording in both release paths from "for a
`'building'` entry" to "for every entry it removes, regardless of `buildState`" — correct for its intended
target (a `'ready'` entry with in-flight lazy connectivity must have its signal rejected too), but this
grammatically also reached **oversized markings**, a registry-entry kind that, by the document's own
definition, never has a `buildState` and never has a cancellation signal created for it (creation is gated
strictly on insertion in `buildState: 'building'`, which an oversized marking never undergoes — no phase is
ever started for it). No conforming implementation could satisfy the literal wording for an oversized-marking
entry without either throwing (violating `releaseEpochScopedState`'s own explicit non-throwing requirement)
or silently special-casing (contradicting the "every entry ... regardless of `buildState`" claim as written).

Fixed by adding an explicit carve-out, in four places:

1. **Signal-lifetime paragraph** (~line 1165–1186): added a statement that the entry-lifetime cancellation
   signal is defined only for `'building'`/`'ready'` entries — an oversized marking never has one, since no
   phase is ever started for it and it carries no `buildState` to begin with. The oversized-marking
   definition itself was expanded to state explicitly that it's rejected before any phase starts, so the
   signal is never created for it at all, while `evictModel`/`dispose()` still enumerate and remove it in the
   same sweep as `'building'`/`'ready'` entries — removal is its entire cleanup, with no signal to reject.
2. **`evictModel`'s `releaseEpochScopedState`** (~line 2577–2595): the unconditional rejection clause is now
   explicitly scoped to "every `'building'` or `'ready'` entry it removes," with a new sentence stating an
   oversized marking carries no such signal and is removed directly in the same sweep, with nothing to
   reject.
3. **`dispose()`'s wholesale clear** (~line 2677–2698): the same scoping correction, restructured so the
   unconditional signal-rejection claim applies only to `'building'`/`'ready'` entries, with the identical
   oversized-marking carve-out sentence.
4. **Two new fixtures** (~line 3502–3514), placed immediately after the existing Round-19 C-2 pair
   ("`evictModel` called while lazy connectivity is suspended on a ready entry" / "same for `dispose()`"):
   one for `evictModel`, one for `dispose()`, each against an epoch containing an oversized marking alongside
   genuine `'building'`/`'ready'` entries — asserting removal completes without throwing and with zero
   signal-rejection calls attributed to the oversized marking, while genuine entries' signals are still
   rejected exactly once each. Both labeled as C-5 regression tests.

**What was deliberately not done:** no cancellation signal was introduced for oversized markings to make the
old universal wording literally true — that would be manufacturing a mechanism for an entry kind that, by
design, never has unresolved async work to cancel. The fix is entirely textual/definitional: state the
carve-out explicitly, don't add machinery. The entry-lifetime cancellation-signal invariant itself (one
signal per entry, created once at insertion, surviving `'building' → 'ready'`, raced by every phase slot,
rejected unconditionally by both release paths in the same operation) is preserved exactly as Round 19
established it for the entry kinds it actually applies to.

## What was deliberately not touched

Per explicit instruction: neither of the two new High findings from `invariant-audit-v3.md` — the
`getChildCount` Revision Notes residue (Round 16/17 changelog entries still asserting the removed preflight
in the present tense) or the Public API's "Requires certified closed" hard-precondition wording — was fixed
in this pass. No other High/Medium/Low finding from `invariant-audit-v3.md` was touched. `getChildCount`,
the Public API mode-description comment, `anyComponentInside` stage wording, and room-cache/`isLeaseValid`
text were confirmed untouched by grep after the edit.

## Verification

`node spike/fixtures.mjs` — **55/55 pass**, both before this pass began and after all edits landed. As with
Round 18/19's disposition docs, this is expected and not strong evidence on its own: this pass edited only
the spec's prose, and `spike/*.mjs` is a standalone algorithm prototype the spec's fixtures describe but
don't execute.

A post-edit sanity grep for "regardless of.*build.*state" found exactly two remaining occurrences: line 606
(the historical Round-19 changelog narrative describing the *pre-fix* buggy wording — correctly left
untouched as historical record) and line 3508 (the new fixture's own description of what it tests, quoting
the old flawed phrasing for contrast) — neither is a live normative claim, confirming no residual instance
of the C-5 defect remains anywhere in the document.

## Next step

A fourth invariant-driven audit, using the same five-system model methodology `invariant-audit-v1.md`
through `invariant-audit-v3.md` were built against (built fresh from this pass's own post-Round-20 text, not
reused from any prior model), is being run now, producing `invariant-audit-v4.md`. Findings — including
whether this pass's fix introduced any new inconsistency, and whether the two deliberately-untouched new
Highs from v3 remain correctly characterized — will be reported separately, with any remaining Critical
invariant contradiction distinguished explicitly from High/Medium/Low findings.
