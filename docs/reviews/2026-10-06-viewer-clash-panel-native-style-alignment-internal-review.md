# Internal review — Viewer Clash Panel Native Viewer Style Alignment

- Baseline: `main == origin/main == 838bbad40f778483cc9bf082ecaddbab84e19ea2`. Only the owner prompt was untracked at start (the prompt's "completely empty tree" precondition is not literally satisfiable; same as prior checkpoints).
- Reviewers: Claude headed visual review (3 rounds) + Codex `codex-review code wwwroot/main.css medium` (request `20261006-225306-14674-26595`).
- Scope: style only (`wwwroot/main.css`, `clashpanel/ui/ClashDockingPanel.js` body classes/offset, two test files). No render/*.js, PANEL_CSS, core, or semantics change.

## Findings and disposition

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| D-A | Low | adjacent inline labels touch | fixed (inline-flex, gap/margin) |
| D-B | Low | setup toggle / Test name / legends cramped | fixed |
| D-C | Low | "Show only this element" inline against text | fixed (block) |
| D-E | Low | filter/model/sort label text wrapped per letter (side effect of D-A fix) | fixed (column layout) |
| CR-1 | Medium | disabled input opacity compounded with label (~.22) | fixed (input reset to 1 inside disabled label) |
| CR-2 | Medium | text/search/select `:focus{outline:0}` beat focus-visible ring | fixed (outline removed only on `:focus:not(:focus-visible)`) |
| CR-3 | Low | host fieldset margin overridden by PANEL_CSS | fixed (higher host specificity; panel.js untouched) |

Final: **0 Critical / 0 High / 0 Medium / 0 unresolved Low in scope.**
Residual non-blocking notes: N1 Group legend slightly tighter than Sort; N2 "Filters And Grouping" capitalization (matches native `text-transform:capitalize`); N3 body background opaque white vs native .94 (shell test requires opaque); Codex notes static CSS tests cannot catch cascade conflicts (headed computed-style checks covered it).

## Evidence
[style-alignment-evidence-report.md](../research/2026-10-06-viewer-clash-panel-native-style-alignment/style-alignment-evidence-report.md); native reference harvest: [reference-audit.md](../research/2026-10-06-viewer-clash-panel-native-style-alignment/reference-audit.md).
