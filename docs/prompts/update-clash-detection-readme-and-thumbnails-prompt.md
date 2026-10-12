# Claude/Codex Prompt — Refresh Repository README and Thumbnails

## Scope

Update the README for:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

The current README is still positioned as a generic **Simple Viewer**. Replace that stale framing so the repository reflects the sample/product capabilities that now actually exist.

This is a **README/assets-only** package.

Do not modify production code.
Do not modify tests.
Do not change product behavior.
Do not commit or push.

## Before editing

Independently verify:

- repository path
- branch / HEAD / origin
- working-tree state
- `CLAUDE.md`
- `docs/handoffs/latest.md`
- current `README.md`
- existing README/image/thumbnail assets
- current implemented feature names from source/docs

Use the repository as the source of truth.

Do not invent unsupported features or rename implemented concepts casually.

## README goal

Replace the old **Simple Viewer** identity with the current sample identity centered on the major user-facing capabilities.

At minimum, the README should prominently cover the repo-verified equivalents of:

1. **Clash Test / Clash Tests Manager**
2. **Clash Detection / Clash Results**
3. **Find Room**

If the repository uses more exact product/feature names, use those exact names.

The README should make it obvious to an external developer that this repository is now a Viewer-based clash/coordination sample rather than a generic Viewer starter.

## Recommended README structure

Use the existing README style where reasonable, but aim for a structure similar to:

### Title / short description

A concise project title and one-paragraph description focused on:

- APS Viewer
- clash test management
- clash detection/results exploration
- room-finding workflow

Avoid internal milestone language such as CTM-7/CTM-8 in the public README.

### Feature thumbnails near the top

Add a compact visual overview for the three major feature areas.

Preferred options:

- a 3-image thumbnail/gallery row, or
- one hero screenshot plus three feature cards/thumbnails

Feature labels should correspond to the actual repo terminology, for example:

- Clash Tests
- Clash Detection / Results
- Find Room

Use descriptive alt text and stable repo-relative image paths.

### Features

For each major capability, describe what users can actually do today.

#### Clash Tests / Manager

Describe only repo-supported behavior, such as applicable:

- create/manage clash tests
- choose model/set inputs
- run tests
- manage active tests
- inspect test status/results

Do not claim unsupported Model Coordination parity.

#### Clash Detection / Results

Describe current capabilities based on the implemented panel, such as applicable:

- inspect individual clashes
- grouped results
- group-by modes
- filtering/search
- select a clash or group
- aggregate group presentation
- Focus / Isolate
- Back to All
- federated/multi-model result handling

Use only behavior verified in the repository.

#### Find Room

Describe the actual current Find Room workflow from the implementation/docs.

Do not invent room-analysis capabilities that are not present.

### Getting started / run instructions

Keep existing prerequisites/setup/run instructions only if still accurate.

Fix stale names, screenshots, file paths, commands, or Simple Viewer language where necessary.

Do not rewrite working setup instructions just for style.

### Notes / limitations

Keep useful public-facing limitations if already relevant, but avoid exposing internal review debt, milestone names, calibration details, or owner-decision artifacts.

## Thumbnail / screenshot work

Inspect existing assets first.

Prefer, in order:

1. existing stable README screenshots already in the repo;
2. existing product screenshots that accurately represent the current UI;
3. suitable headed/manual evidence screenshots already in the repo, copied into a stable README asset directory if appropriate.

Do not link the README directly to deep calibration/evidence paths if those are intended as internal evidence.

If an evidence screenshot is suitable for public README use:

- copy it into a stable README asset location such as:
  - `docs/images/`
  - `docs/assets/`
  - or the repository's existing image convention;
- use a clean descriptive filename;
- do not modify the historical evidence original.

Avoid screenshots that expose:

- debug overlays
- test-only instrumentation
- local filesystem paths
- secrets/tokens
- calibration-only annotations
- obvious internal review artifacts

If there is no suitable image for one feature, do not fabricate a screenshot. Report the missing thumbnail instead.

## README tone

Target external developers evaluating the sample.

Keep it concise and practical:

- what the sample demonstrates
- major features
- screenshots/thumbnails
- how to run it

Do not turn the README into internal design documentation.

## Verification

After editing:

- run `git diff --check`
- inspect the README rendering/relative image paths
- verify all referenced thumbnail files exist
- verify changed paths are README/docs/assets only
- verify no production/test file changed

## Output / stop condition

Report:

- exact files changed
- which thumbnails/screenshots were used
- any feature for which no suitable thumbnail existed
- whether `git diff --check` passed

Do not commit.
Do not push.

Stop after the README/assets update.
