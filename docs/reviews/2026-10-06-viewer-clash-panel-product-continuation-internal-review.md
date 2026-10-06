# Viewer Clash Panel product-facing continuation — internal review

Scope: close independent-review Lows L1–L11 (`2026-10-06-viewer-clash-panel-demo-ready-independent-visual-product-review.md`). No new features.

**Result: 0 Critical / 0 High / 0 Medium / 3 Low.**

| ID | Finding | Disposition |
|---|---|---|
| L-a | L6 fix patches `globalThis.crypto.randomUUID` from the host only when missing (plain-HTTP LAN); the no-`getRandomValues` branch uses `Math.random`. Ids are correlation ids, not secrets. | Accepted; call sites in `clashtest/engine.js` and `clashpanel/core/controller.js` deliberately untouched. |
| L-b | At 700 px the 460 px panel leaves ~240 px canvas; Viewer toolbar clips and a horizontal page scrollbar appears (observed headed). | Deferred responsive polish; not occlusion of the whole canvas. |
| L-c | Partial-run count on Stop is timing dependent (394 earlier, 472 in this run); screenshot 13 is mid-Stop (INCONCLUSIVE), 13b authoritative. | Not a defect. |

Fidelity: no Core/Adapter/G2/harness change; Group By/persistence/Viewer selection/framing untouched; L9 documented only. L1 also covers the panel's X button via controller subscription (headed PASS). Tests: offline 5,185/5,184/0/1 todo; DOM 83/83.
