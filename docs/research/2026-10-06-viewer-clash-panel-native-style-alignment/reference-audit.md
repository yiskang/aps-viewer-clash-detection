# Native Autodesk Viewer panel style reference audit

Date: 2026-10-06. Research only; no repo source edited. Live app at `http://localhost:8080/?clashPanelDemo=1` (SVF2 Structure + Mechanical demo, 2 models loaded), headed Playwright, 1280x800 unless noted.

Sources: live computed styles; the Viewer stylesheet `https://developer.api.autodesk.com/modelderivative/v2/viewers/7.124.2/style.css` (cross-origin, so `document.styleSheets` throws; it was fetched with curl and read as data, ~465 KB, 987 rules, no CSS custom properties). Screenshots (not in repo): scratchpad `side-by-side.png`, `native-model-browser.png`, `native-settings.png`, `our-clash-panel-before.png` in `/private/tmp/claude-501/-Users-kangea-Workspace-Codes-aps-viewer-clash-detection/6541388d-1786-4f7a-89db-89c148ad65a9/scratchpad/`. Historical snapshots of the prior Clash Panel state are referenced, not copied: `docs/research/2026-10-06-viewer-clash-panel-product-facing-continuation-ii/snapshots/` (e.g. `02-panel-open.png`, `08-group-expanded.png`).

## 1. Version and theme

| Item | Value |
| --- | --- |
| Viewer version | 7.124.2 (from script URLs; `Autodesk.Viewing.getVersion` does not exist in this build; the settings panel footer also shows `v7.124.2`) |
| Container classes | `adsk-viewing-viewer notouch light-theme` (`body` has no class) |
| Theme set by app | `wwwroot/viewer.js:45` `viewer.setTheme('light-theme')` right after `viewer.start()`. No other theme config in `viewerOptions.js` / `main.js`. |
| Oddity | `viewer.theme` reads `dark-theme` (stale default) while the container really carries `light-theme`. Trust the container class. All CSS below is therefore `.adsk-viewing-viewer.light-theme ...`. |
| Font | `ArtifaktElement, "Helvetica Neue", "Segoe UI Semilight", sans-serif`, base 14px, color `#0a131c` (rgb 10,19,28), inherited by everything inside `.adsk-viewing-viewer` |
| Other themes that exist | `dark-theme`, `bim-theme`, `acs-theme` (bim/acs: title bg `#EDF0F2`, shadow `0 0 12px 0 rgba(0,0,0,.3)`) |

## 2. Native panel anatomy (computed, light theme)

Shared shell (Model Browser `#ViewerModelStructurePanel`, Settings `#ViewerSettingsPanel0-0`, our `#clash-detection-panel` all share it):

```html
<div class="docking-panel [panel-specific]" style="resize:none; display:block; ...">
  <div class="docking-panel-title">Title</div>
  <div class="docking-panel-close"></div>
  <div class="docking-panel-footer"><div class="docking-panel-footer-resizer"></div></div>
  <div class="docking-panel-scroll docking-panel-container-solid-color-a" style="height:calc(100% - 104px);overflow-x:hidden"> ...body... </div>
</div>
```

| Part | Class | Computed / rule |
| --- | --- | --- |
| Panel | `.docking-panel` | `position:absolute; z-index:20; overflow:hidden (visible computed on model panel); border:none; background:transparent; border-radius:5px (settings: 6px); box-shadow:1px 3px 10px 0 rgba(0,0,0,.4); min-width:250px`; panel itself has no background, the title and scroll area paint it |
| Title bar | `.docking-panel-title` | `padding:11px 0 11px 14px; font-size:20px; font-weight:300; line-height:27px; height 27px (content) => 49px box + 1px border = 50px; color:#0a131c; background:#ffffff; border-bottom:1px solid rgba(0,0,0,.2); border-radius:5px 5px 0 0; text-transform:capitalize; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:move; position:relative; z-index:1` |
| Close button | `.docking-panel-close` | `position:absolute; top:0; right:0; width:25px; height:50px; background-position:0 19px; background-repeat:no-repeat; cursor:pointer; z-index:1`; icon is an 11x11 SVG X, fill `#4A555B`, set via `.light-theme .docking-panel-close{background-image:url(data:svg...)}` plus a `:hover` image. Reuse by class, do not copy the data URI. |
| Footer | `.docking-panel-footer` | `height:20px; width:100%; position:absolute; bottom:0; background:#ffffff; border-top:1px solid rgba(0,0,0,.2)`; holds the resizer |
| Scroll body A | `.docking-panel-scroll.docking-panel-container-solid-color-a` | `overflow:auto; width/height:100%; position:relative; background-color:rgba(255,255,255,.94)`. Model browser body adds `top:34px` (search box 34px). Settings: `.docking-panel-scroll.right{top:90px;height:calc(100% - 60px)}` |
| Surface B | `.docking-panel-container-solid-color-b` | `background-color:rgba(255,255,255,.98)` (used for settings tab strip, search results, small popups) |
| Surface C | `.docking-panel-container-solid-color-c` | `background-color:#ecf0f3` |
| Gradient zebra | `.docking-panel-container-gradient` | `repeating-linear-gradient(rgba(242,247,250,.7), rgba(242,247,250,.7) 36px, rgba(242,247,250,0) 36px, rgba(242,247,250,0) 72px)` (36px row pitch; used by tree) |
| Delimiter | `.docking-panel-delimiter-shadow` | `box-shadow:0 3px 5px 0 rgba(0,0,0,.1)` (tab strip under title) |

Scrollbar (applies to `.docking-panel-scroll` only; light theme):

```css
.adsk-viewing-viewer .docking-panel-scroll::-webkit-scrollbar { width:6px; height:6px; padding:12px; }
.adsk-viewing-viewer .docking-panel-scroll::-webkit-scrollbar-track { border-radius:0; background:none; }
.adsk-viewing-viewer .docking-panel-scroll::-webkit-scrollbar-thumb { border-radius:1px; background:rgb(190,200,210); }
.adsk-viewing-viewer.light-theme .docking-panel-scroll::-webkit-scrollbar-thumb:hover { background:rgb(147,156,165); }
.adsk-viewing-viewer.light-theme .docking-panel-scroll::-webkit-resizer { background-color:rgba(30,30,30,.8); }
```

Panel sizes seen: Model Browser 300x667 (min-width 250), Settings 400x642, ours 460x672 (viewer panels open at `top:10px;left:10px` inside the container; the container starts at y=48 so absolute y=58).

## 3. Tree / row styling (Model Browser)

Markup: `.treeview > .model-div > .group.expanded|collapsed.visible|dim > lmvheader(padding-left set inline) > icon + .visibility + label`.

| State | Declarations |
| --- | --- |
| Row (`lmvheader`) | `width:100%; margin-bottom:1px; padding:6px; box-sizing:border-box; white-space:nowrap; display:inline-block; line-height:normal`; computed height 35px (+1px margin = 36px pitch); font 14px, color `#0a131c`, weight 400 |
| Label | color `#0a131c`; `.dim` rows `#939ca5`; `pointer-events:none` |
| Hover | `.light-theme .treeview .group > lmvheader:hover { background: rgba(0,191,255,.2) !important; }` (measured `rgba(0, 191, 255, 0.2)`), `cursor:pointer` |
| Selected | `.treeview .group.selected{border-left:3px solid #999999; background:transparent; transition:all .2s ease}`; `.group.selected > lmvheader{background-color:#e7e7e7}`; `.light-theme ... .selected label{color:#1dc7f3 !important}` (cyan text). The click in this run did not leave the selected class on the row, so this comes from the stylesheet, not a live probe. |
| Category/group header | `.group.category > lmvheader{background-color:rgba(242,247,250,.7)}`, `font-weight:bold`, height 40px |
| Expander icon | `icon` background SVG chevron 6x11, `cursor:zoom-in/out`, 11px side padding |
| Visibility toggle | `div.visibility{right:0; top:0; width:35px; height:100%; background-position:6px 12px}` |
| Search box | `.adsk-searchbox input.search-box{color:#0a131c; background:#ffffff; border:solid 1px transparent}`; `:focus{border:1px solid #1DC6F2}`; height 34px |

Property panel: toolbar button `#toolbar-propertiesTool` exists (panel `#ViewerPropertyPanel.docking-panel.property-panel`) but was not opened (no element selected); its tree rows reuse `.treeview .leaf.property{font-weight:500; font-size:12px}` and `.category{font-weight:bold}` with the same hover color.

## 4. Settings panel controls (the native form vocabulary)

Tabs, rows, switch, select, button (all inside `.viewer-settings-panel`, table class `.settings-table.adsk-lmv-tftable`):

| Element | Class | Values |
| --- | --- | --- |
| Tab strip | `.settings-tabs.docking-panel-container-solid-color-b.docking-panel-delimiter-shadow` | height 40px, bg `rgba(255,255,255,.98)`, shadow `0 3px 5px 0 rgba(0,0,0,.1)` |
| Tab label | `.settings-tabs span` | `font-size:12px; font-weight:bold; border-bottom:3px solid transparent; top:16px; padding-bottom:2px`; color `#0a131c`, hover `#1dc6f2`, selected (`li.tabselected span`) `color:#00bfff; border-color:#00bfff` |
| Section/group row | `tr.logical-group` | bg `rgba(242,247,250,.7)` (= `#f2f7fa` @ .7); first row height 65px, others 40px; `td{font-size:14px; font-weight:bold; padding:15px 10px 0}`; label `text-transform:capitalize`, color `#0a131c` |
| Setting row | `tr.switch-slider-row` | `td{padding-top:13px; padding-bottom:13px; vertical-align:top}`; col1 name 12px/600, color `#4a555b`; col2 description 12px/300, color `#4a555b`; col3 control `padding:13px 16px 13px 59px`; no row borders, no zebra; row height ~75px with description |
| Toggle | `label.switch > input[type=checkbox] + .slider` | input is `display:none`; `.switch{width:31px;height:8px;padding:10px 0 2px}`, track `.slider{width:28px;height:2px;background:#d9e1e9}`, thumb `.slider:before{16x16px; border-radius:50%; top:3px; background:#d9e1e9; transition:.4s}`; checked: thumb `background:#00bfff; transform:translateX(12px)`. There is NO native checkbox/radio; the settings panel only uses this switch. |
| Dropdown | `select.option-drop-down` | `width:160px; font-size:11px` (computed 12px); computed `color:#4a555b; background:rgba(255,255,255,.94); border:1px solid #d5dbe1; border-radius:4px; padding:4px 8px; font-family:Arial` (note: native dropdown does NOT inherit Artifakt) |
| Table button | `.adsk-button.table-button.table-action-button` | computed `font-size:12px; color:#4a555b; border:1px solid #4a555b; border-radius:4px; padding:6px 6px 6px 10px; margin:4px; cursor:pointer`; hover `color:#00bfff; border:1px solid #00bfff`; focus/active `color:#00bfff; border-radius:3px; box-shadow:inset 0 1px 1px 0 rgba(0,0,0,.6)`; `.adsk-button.disabled{opacity:.4}` |
| Docking panel button | `.docking-panel-button` | `color:#4a555b; border:solid 1px #d5dbe1` |
| Primary button | `.docking-panel-primary-button` | `height:34px; line-height:34px; font-size:12px; font-weight:bold; letter-spacing:-.1px; margin:10px; border-radius:3px; text-align:center; cursor:pointer; color:#ffffff; background:#06a7df`; hover/focus/active `#00bfff` |
| Secondary button | `.docking-panel-secondary-button` | same box as primary; `background:#939ca5; color:#fff`; hover/focus/active `#bec8d2` |
| Tertiary button | `.docking-panel-tertiary-button` | same box; `:active{background-color:#4a555b; border:solid 1px #4a555b}` |
| Beta chip | `.switch-slider-row-beta-label` | `background:#f8dba4; border-radius:10px; color:#3c3c3c; padding:0 10px` |
| Selected cell | `.settings-cell.border-select` | `border:solid 1px #00bfff` (idle `#f2f7fa`, hover `#939ca5`) |
| Context-menu hover | `.docking-panel.menu .menu-item:hover` | `background:rgba(0,191,255,.2)`; divider `#666666` |

There is no `.docking-panel-checkbox` or `.docking-panel-dropdown` class in 7.124.2 (grep of the stylesheet finds none); the only form classes are `.switch/.slider`, `.option-drop-down`, `.adsk-button`, `.docking-panel-{button,primary-button,secondary-button,tertiary-button}`.

Palette summary (light theme): text `#0a131c`; secondary text `#4a555b`; dim `#939ca5`; accent `#00bfff` (hover `#1dc6f2`, focus ring `#1DC6F2`); primary btn `#06a7df`; row hover `rgba(0,191,255,.2)`; band `rgba(242,247,250,.7)`; selected bg `#e7e7e7`; border `#d5dbe1`/`#d4dbe1`; hairline `rgba(0,0,0,.2)`; scrollbar `rgb(190,200,210)`/`rgb(147,156,165)`; surfaces white at .94/.98.

CSS custom properties: none defined (`:root` or container). Reuse must be by class or by copying hex values.

## 5. BEFORE state of our Clash panel (`#clash-detection-panel`)

Structure: `div#clash-detection-panel.docking-panel` > `.docking-panel-title` ("Clash Detection"), `.docking-panel-close`, `div.clash-panel-body.clash-panel-root` (inline `position:absolute; inset:40px 0 0; overflow:hidden auto; padding:6px 10px; box-sizing:border-box; background:#fff`). No `.docking-panel-scroll`, no `-container-solid-color-*`, no footer/resizer. Regions are `section.clash-region` each with `h2.clash-region-heading` + `.clash-region-body`.

Already native (inherited from the shell classes): title bar, close icon, shadow, 5px radius, font family/size/color of body text (inherits Artifakt 14px `#0a131c`).

Not native (computed, all browser defaults): `button` bg `rgb(239,239,239)`, `2px outset` black border, Arial 13.33px, padding `1px 6px`; text/search `input` Arial 13.33px, `2px inset rgb(118,118,118)`; `select` Arial 13.33px, `1px solid rgb(118,118,118)`; checkbox/radio 13x13 browser-default; `fieldset` `2px groove rgb(239,239,239)` with browser `legend`; `h2.clash-region-heading` 21px bold with `17.43px` margins (browser default h2); `ul.clash-model-list` bulleted.

Geometry defect: body `inset:40px 0 0` but the title is 50px tall (title bottom at 50px), so the first 10px of the body sits under the title (`z-index:1`). Measured: titleBottom 50, bodyTopRel 40.

Existing host CSS for results (`wwwroot/main.css:173-214`): rows `padding:4px 8px; border-bottom:1px solid #e3e5e8; font-size:12px; line-height:1.35`, hover `#eef3f8`, selected `background:#cfe8fb; font-weight:600; border-left:4px solid #0696d7`, list `max-height:260px; border:1px solid #c8ccd0`. Colors differ from native.

Scroll: body scrollHeight 1119 vs clientHeight 632 at 1280x800 (default OS scrollbar, `scrollbar-width:auto`).

### Before-state audit table

| Area | Visible mismatch (ours) | Native reference |
| --- | --- | --- |
| Header | Title bar already native, but body overlaps it by 10px (`inset:40px` vs 50px title) | `.docking-panel-title` 50px total incl. 1px border; body must start at `top:50px` or use native `.docking-panel-scroll` layout (`height:calc(100% - 104px)`) |
| Body background | Flat inline `#fff` | `.docking-panel-scroll.docking-panel-container-solid-color-a` = `rgba(255,255,255,.94)` |
| Border / shadow | Shell shadow native; inner fieldsets use `2px groove` boxes, results list `1px solid #c8ccd0` | No boxes around groups; separation via band `rgba(242,247,250,.7)`, hairline `rgba(0,0,0,.2)`, `.docking-panel-delimiter-shadow` (`0 3px 5px rgba(0,0,0,.1)`) |
| Typography | `h2` 21px/700 browser default; controls Arial 13.33px | Group heading 14px bold `#0a131c` capitalize (`tr.logical-group`); labels 12px 600 `#4a555b`; descriptions 12px 300 `#4a555b`; controls inherit Artifakt (`font-family:inherit`) |
| Section hierarchy | Five 21px h2 headings dominate; no band | `logical-group` band: bg `rgba(242,247,250,.7)`, 40px high, 14px bold, padding `15px 10px 0`/`0 10px` |
| Rhythm | Browser margins (17.43px h2, 14px p) uneven | Row pitch 36px (tree) / 13px vertical padding per setting row; 10px horizontal gutter (`settings-table left:10px; width:calc(100% - 20px)`) |
| Control density | Default controls 21-22px high; fieldset padding 5/10/9 | Native 12px controls: select padding `4px 8px`, button padding `6px 6px 6px 10px` (~30px high incl. border) |
| Checkbox / radio | Browser-default 13px checkbox and radio | Native has no checkbox: `label.switch` toggle (track `#d9e1e9`, thumb 16px, checked `#00bfff`). For radios use a restrained custom/accent (`accent-color:#00bfff`) since no native radio exists |
| Buttons | Gray `rgb(239,239,239)` `2px outset` | Secondary: `.adsk-button.table-button` (`1px solid #4a555b`, radius 4px, 12px, hover `#00bfff`); primary action: `.docking-panel-primary-button` (`#06a7df`, hover `#00bfff`, 34px high, bold 12px, radius 3px); disabled `opacity:.4` |
| Selects / inputs | Arial 13.33px, `2px inset` / `1px #767676` | `select.option-drop-down`: `border:1px solid #d5dbe1; border-radius:4px; padding:4px 8px; color:#4a555b; background:rgba(255,255,255,.94); font-size:12px`; search input: white, `1px solid transparent`, focus `1px solid #1DC6F2`, 34px high |
| Selected row | `#cfe8fb` + 4px `#0696d7` left bar, weight 600 | Native: `border-left:3px solid #999`, bg `#e7e7e7`, label `#1dc7f3`; hover `rgba(0,191,255,.2)` |
| Group row | Same look as rows | `.group.category > lmvheader`: bg `rgba(242,247,250,.7)`, bold, 40px; expander chevron 6x11 |
| Status / checklist area | Plain `p` with unicode glyphs (`✖ Not ready`) and bullet list | Description-text style (12px/300 `#4a555b`); dim `#939ca5`; keep semantic color only for error/warn text (native uses plain red `color:red` for reload messages) |
| Action buttons (Run/Stop/Use selection/New test) | Four unstyled gray buttons, wrap unevenly | One primary (Run, `docking-panel-primary-button`), others `table-button` outlines; `margin:10px` / `4px` spacing |
| Scrollbars | OS default (`scrollbar-width:auto`), wide | Use the class `docking-panel-scroll` for the 6px thumb `rgb(190,200,210)` / hover `rgb(147,156,165)`, transparent track |
| Width | 460px | Native panels 300 (browser) and 400 (settings); min-width 250. 400 matches settings; 460 is the widest in the viewer |
| Narrow viewport | See section 6 | Native panels are fixed-width absolute; no responsive behavior |
| Contrast | Black `#000` control text vs native `#0a131c`/`#4a555b`; blue left bar `#0696d7` on `#cfe8fb` | Native secondary text `#4a555b` on white is ~7.9:1; dim `#939ca5` on white ~2.9:1 (avoid for essential text); accent `#00bfff` text on white ~2.1:1 (native uses it only for tab/hover; do not use for body text) |

## 6. Narrow viewport (700x800)

| Measurement | Value |
| --- | --- |
| `window.innerWidth` | 700 |
| `documentElement.scrollWidth` | 720 (horizontal overflow of 20px) |
| `body.scrollWidth` | 685 |
| Our panel rect | x10 y58 w460 h657, right 470, bottom 715 (fits; 230px spare; toolbar sits at y720-775 below it) |
| Elements with right edge > innerWidth | exactly one: `label` ("Load as additional model", child of `#header`), right 720, width 77. `#header` itself is 685 wide with scrollWidth 720; `#urn` right 462; viewer toolbar right 675. |

Conclusion: the page overflow is pre-existing header chrome (the `#keep-current-models` label in `wwwroot/index.html:21`), not the Clash panel. The panel at 460px stays inside 700px but covers 66% of the width; at <= ~480px viewport it would overflow right.

## 7. Recommended mapping: our element -> native class / values

| Our element | Reuse native | Notes / copy-pasteable |
| --- | --- | --- |
| `#clash-detection-panel` | keep `.docking-panel` (already) | add nothing; shadow/radius inherited |
| `.docking-panel-title` / close | already native | keep |
| `.clash-panel-root` (body) | add `docking-panel-scroll docking-panel-container-solid-color-a`; drop inline `background:#fff`; fix `inset:50px 0 0` or move to `top:50px` | gives 0.94 white + 6px scrollbar for free |
| `h2.clash-region-heading` | mimic `tr.logical-group` | `margin:0; padding:15px 10px 8px; font-size:14px; font-weight:700; text-transform:capitalize; background:rgba(242,247,250,.7); color:#0a131c` |
| `.clash-region-body` | settings-table gutter | `padding:0 10px 12px` |
| field label text | settings name/description | `font-size:12px; font-weight:600; color:#4a555b` / secondary `font-weight:300` |
| `fieldset` / `legend` | remove box | `border:0; padding:0; margin:0`; legend styled like field label (12px/600 `#4a555b`) |
| `button` (secondary) | `.adsk-button.table-button.table-action-button` look | `font:inherit; font-size:12px; color:#4a555b; background:transparent; border:1px solid #4a555b; border-radius:4px; padding:6px 10px; cursor:pointer` hover `color:#00bfff;border-color:#00bfff`; `:disabled{opacity:.4;cursor:default}` |
| Run clash test (primary) | `.docking-panel-primary-button` | `height:34px; line-height:34px; padding:0 16px; font-size:12px; font-weight:700; letter-spacing:-.1px; border:0; border-radius:3px; color:#fff; background:#06a7df` hover/focus `#00bfff` |
| Stop | `.docking-panel-secondary-button` | `background:#939ca5` hover `#bec8d2` (same box as primary) |
| `input[type=text|search]` | native searchbox | `font:inherit; font-size:12px; color:#0a131c; background:#fff; border:1px solid #d5dbe1; border-radius:4px; padding:4px 8px` `:focus{outline:0;border-color:#1DC6F2}` |
| `select` | `.option-drop-down` | `font:inherit; font-size:12px; color:#4a555b; background:rgba(255,255,255,.94); border:1px solid #d5dbe1; border-radius:4px; padding:4px 8px` |
| checkbox / radio | no native equivalent; use native accent | `accent-color:#00bfff; margin:0 6px 0 0` (or build `label.switch`-style toggle for boolean filters: track 28x2 `#d9e1e9`, thumb 16px, on `#00bfff`) |
| `.clash-row` | tree row | `padding:6px 10px; margin-bottom:1px; font-size:14px (or 12px); border:0; background:transparent` hover `rgba(0,191,255,.2)` |
| `.clash-row-selected` | tree selected | `background:#e7e7e7; border-left:3px solid #999; padding-left:7px; font-weight:400`; optional label color `#1dc7f3` |
| group row (Element group) | `group.category > lmvheader` | `background:rgba(242,247,250,.7); font-weight:700; min-height:40px` |
| `.clash-rows` list box | remove outer border | `border:0`; separation by 1px row gap, not hairlines; scrolling via `.docking-panel-scroll` |
| `.clash-validation`, `.clash-status`, `.clash-run-state` | settings description | `font-size:12px; font-weight:300; color:#4a555b; margin:6px 0`; dim `#939ca5`; error text keep semantic red |
| section separators | delimiter | `box-shadow:0 3px 5px 0 rgba(0,0,0,.1)` under a sticky header, or 1px `rgba(0,0,0,.2)` hairline |
| panel width | native settings width | 400px (min 250) |

Minimal copy-pasteable token block (scope under `.clash-panel-root` so nothing leaks to the host):

```css
.clash-panel-root {
  --nv-text:#0a131c; --nv-text-2:#4a555b; --nv-dim:#939ca5; --nv-accent:#00bfff; --nv-accent-focus:#1dc6f2;
  --nv-primary:#06a7df; --nv-border:#d5dbe1; --nv-band:rgba(242,247,250,.7);
  --nv-row-hover:rgba(0,191,255,.2); --nv-row-selected:#e7e7e7; --nv-hairline:rgba(0,0,0,.2);
  font-family:inherit; color:var(--nv-text);
}
.clash-panel-root button,.clash-panel-root input,.clash-panel-root select { font-family:inherit; }
```

(Native defines no CSS variables; the `--nv-*` names above are a suggested local token layer, not Viewer API.)

## 8. Caveats

- Selected-row and checked-toggle values come from the 7.124.2 stylesheet, not from a live visual probe (the click did not leave `.selected` on the row; forcing `input.checked` did not change computed colors because the toggle is `display:none` and styled via `input:checked + .slider:before`).
- Stylesheet classes are Viewer-internal (not a public API) and are pinned to 7.124.2; reuse of `.docking-panel-*` shell classes is already in use by our panel, button/toggle classes are only valid inside `.adsk-viewing-viewer` and some rules are scoped to `.viewer-settings-panel` or `.adsk-lmv-tftable`, so copy the declarations rather than relying on the class names for form controls.
- Property panel was not opened (needs a selected element).
- Browser left at 1280x800 on `http://localhost:8080/?clashPanelDemo=1` (700x800 session reloaded and reset).
