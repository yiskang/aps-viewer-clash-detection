# README / thumbnail refresh — package final report (backfill)

**Date:** 2026-10-12
**Role:** upstream package completion report written by the responsible README package. It is **not** an independent review. It was missing when the package was reviewed and is backfilled here.
**Status:** README refresh pushed and owner-ratified; one further README wording cleanup is **uncommitted**; awaiting targeted Independent Work verification of the ratification + this backfill.

## 1. Repository state

| Item | Value |
| --- | --- |
| Repository | `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection` |
| Branch | `main` |
| HEAD / origin | `ef790ad14be29bbd1bc379337efa0f749dd5d4cc` / same (`0/0`) |
| Already-pushed README commits | `8f7bed5` (`docs(readme): reposition as clash detection sample with feature thumbnails`), `ef790ad` (`docs(readme): lay out context-menu and Find thumbnails as 2x2`) |
| Working tree | Uncommitted: `README.md` wording cleanup (§8); `docs/handoffs/latest.md`; this report; the owner ratification record; the Independent Work Review (untracked); three prompt files under `docs/prompts/` (untracked). |

## 2. Package objective

Replace the stale generic "Simple Viewer" README positioning with the current **APS Viewer Clash Detection** sample identity, with feature thumbnails near the top. Owner prompt: [`update-clash-detection-readme-and-thumbnails-prompt.md`](../prompts/update-clash-detection-readme-and-thumbnails-prompt.md); follow-up cleanup prompt: [`final-readme-cleanup-prompt.md`](../prompts/final-readme-cleanup-prompt.md).

## 3. README scope (public-facing coverage)

- **Clash Tests / Clash Tests Manager**
- **Clash Detection / Results**
- **Context Menu Utilities** (heading as of the uncommitted cleanup; the pushed text calls it "Find Room")
  - **Locate Room**
  - **Find Clashes**
  - **Find Soft Clashes**

The Simple Viewer reference is retained only as project provenance ("The sample started from the Simple Viewer tutorial"). Setup/run text kept, with the clone URL and folder name corrected to `yiskang/aps-viewer-clash-detection`. A Libraries section links `collision/`, `clashtest/` and `clashpanel/` READMEs.

## 4. Thumbnail assets (all in `docs/images/`)

| File | Role | Source / capture |
| --- | --- | --- |
| `clash-tests-manager.png` | Clash Tests manager with two tests | Copy of existing evidence `docs/research/evidence/2026-10-11-ctm-7-headed-svf2/CT-05-A-manager-two-tests.png` |
| `clash-detection-results.png` | Results grouped by model pair, Focus/Isolate/Back to all | Copy of existing evidence `docs/research/evidence/2026-10-11-pre-ctm8-clash-group-header-aggregate-headed/GP-04-aggregate-isolate-ArchMech.png` |
| `context-menu.png` | Right-click menu with Locate Room / Find Clashes / Find Soft Clashes | New capture (below) |
| `find-room.png` | Master Bath 207 isolated after Locate Room | New capture; camera dollied back 1.5× after the action |
| `find-clashes-hard.png` | Find Clashes result for one structural beam | New capture; camera re-fitted to the source element, then dollied back 5× |
| `find-clashes-soft.png` | Find Soft Clashes result for one structural column | New capture |

The two copied images are copies; the historical evidence originals were not modified. The four new images were captured from the real running app (local `node server.js`), driven by a throw-away headless-Chromium Playwright script kept outside the repository: select an element, right-click at its projected position, click the real context-menu item, screenshot. Room case: RAC sample model, bathtub `[420270]`, isolated room reported `Master Bath 207 [857194]`. Clash cases: the three Audubon models (Architecture, Structure, Mechanical) loaded as SVF2; Hard source ElementId `272782` (1 clash reported), Soft source ElementId `681589` (2 clashes reported). Alerts raised by the actions ("result may be incomplete" diagnostics for Room and Hard) were dismissed and are not in the images.

## 5. README layout

Three GitHub-flavored Markdown tables, each two columns (image row + caption row):

1. Clash Tests | Clash Detection / Results
2. Context menu | Find Room
3. Find Clashes (hard) | Find Soft Clashes

(The pushed history shows the intermediate states: a single 3-column row, then 4 columns, then this 2×2 arrangement in `ef790ad`.)

## 6. Verification performed

- `git diff --check`: clean at each step (including the uncommitted cleanup).
- All six `docs/images/*.png` paths referenced in `README.md` exist (checked with a file-exists loop).
- The four captures were each viewed after capture; the isolated room name and clash counts above came from the live run.
- **Not performed by this package:** Markdown rendering in GitHub or a renderer; a full check of every local README link beyond the image paths (the Independent Work Review reports its own link check).
- No production or test file changed in the package commits (`8f7bed5`: `README.md` + six PNGs; `ef790ad`: `README.md`).

## 7. Deviations / workflow history

- `8f7bed5` and `ef790ad` were committed and pushed **before** the required Independent Work review and owner checkpoint decision; the package prompts said no commit/push. The commits followed the user's in-session "commit and push" instructions, which did not clear the repository gate.
- The owner later **ratified** both commits ([ratification record](../reviews/2026-10-12-readme-thumbnail-refresh-owner-ratification.md)). No history rewrite, amend, revert or force-push is performed or authorized.
- This upstream final report was missing initially; it is being backfilled here.

## 8. Current uncommitted README cleanup (NOT committed, NOT pushed)

Present in the working tree only; `README.md` is the sole tracked file changed by it:

- Group **Markers** wording: "Focus, Isolate and Back to all for a selected clash or group. Markers are available for individual clashes."
- Section `### Find Room` renamed `### Context Menu Utilities`, restructured as three bullets (Locate Room, Find Clashes, Find Soft Clashes) plus a closing line that each action isolates its result in the Viewer and an alert appears if a result may be incomplete.
- Hard/soft terminology normalized: "Find Clashes — hard/overlap clashes for the selected element", "Find Soft Clashes — soft/clearance clashes for the selected element"; Locate Room caption reads "Locate Room — isolates the containing room".

No other README change is present.

## 9. Independent Work review disposition

[README / Thumbnail Refresh Independent Work Review](../reviews/2026-10-12-readme-thumbnail-refresh-independent-work-review.md): **OWNER DECISION REQUIRED; 0 Critical / 2 High / 0 Medium / 2 Low.**

- Content technically acceptable; visual total **5 PASS / 0 FAIL / 1 INCONCLUSIVE**.
- **H1** (gate bypassed): resolved by owner ratification.
- **H2** (missing final report): addressed by this backfill, pending targeted Independent Work verification.
- **L1** hard-clash thumbnail visually weak: non-blocking, deferred, not remediated.
- **L2** screenshots show `Simple Viewer` app chrome: non-blocking, deferred, not remediated.

## 10. Protected boundaries confirmed unchanged

No production code, no tests, no CTM-7/CTM-8 state, no prior evidence or review rewritten, and no image replacement or Low-finding remediation in this backfill package.

## 11. Commit/push state

The two README commits are pushed and ratified. Everything in §1 "Working tree" is uncommitted and unpushed.

## 12. Exact next gate

**Targeted Independent Work verification of the ratification + upstream final-report backfill package.** This report does not authorize commit/push of the uncommitted README cleanup; that requires that verification and a further owner decision.
