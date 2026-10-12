# Claude/Codex Prompt — Final README Cleanup for Clash Detection Repo

## Scope

Update only the README/content presentation for:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

The README has already been refreshed away from the old generic Simple Viewer positioning and now includes current screenshots/thumbnails.

This package is a **small final README cleanup** only.

Do not modify production code.
Do not modify tests.
Do not change product behavior.
Do not add/remove functionality.
Do not commit or push.

## Before editing

Read the current:

- `README.md`
- `CLAUDE.md`
- `docs/handoffs/latest.md`

Use the current README and repo terminology as source of truth.

## Required changes

### 1. Fix Markers wording for group mode

Current README text says, in effect:

`Focus, Isolate, Markers and Back to all for the selected clash or group.`

This is inaccurate because group mode does not expose markers.

Change it to wording equivalent to:

`Focus, Isolate and Back to all for a selected clash or group. Markers are available for individual clashes.`

Keep terminology aligned with the current UI.

### 2. Rename the `Find Room` feature section

The current section heading is too narrow because the section also describes:

- Locate Room
- Find Clashes
- Find Soft Clashes

Rename the section to:

`### Context Menu Utilities`

Then structure the text so the three actions are clearly represented under the same feature area.

Keep the current behavior descriptions accurate.

Suggested structure:

- **Locate Room** — finds the containing room, isolates it/them, and fits the view.
- **Find Clashes** — hard/overlap clashes for the selected element.
- **Find Soft Clashes** — soft/clearance/nearby clashes for the selected element.

Do not invent unsupported behavior.

### 3. Normalize hard/soft terminology

Make the thumbnail captions / context-menu descriptions use consistent wording with the Clash Tests section:

- Hard = overlap clash
- Soft = clearance clash

Use phrasing equivalent to:

- `Find Clashes — hard/overlap clashes for the selected element`
- `Find Soft Clashes — soft/clearance clashes for the selected element`

Keep the existing UI command names exactly as implemented.

## Keep unchanged

Do not change these unless required for consistency:

- title
- APS Viewer Clash Detection positioning
- first two feature thumbnails:
  - Clash Tests
  - Clash Detection / Results
- 2×2 context-menu thumbnail layout
- setup/run instructions
- libraries section
- development prerequisites
- troubleshooting
- license
- author section

The existing Simple Viewer sentence may remain as historical provenance. If you touch it, only make it clearer that it is project origin, not current positioning.

## Verification

After editing:

- run `git diff --check`
- inspect the final README diff
- verify image paths still exist
- verify only `README.md` changed for this cleanup unless a truly necessary docs-only consistency edit is required
- verify no production/test files changed

## Stop condition

After the README cleanup:

**STOP.**

Do not commit.
Do not push.

Report:

- exact files changed
- `git diff --check` result
- summary of the three README wording/structure corrections
