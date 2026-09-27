# G1 SVF2 — Agent Kit knowledge validation + initializer diagnosis (read-only; G1 remains BLOCKED)

- **Date:** 2026-09-27
- **Authorization:** [`docs/prompts/g1-svf2-agent-kit-and-initializer-diagnosis-authorization.md`](../prompts/g1-svf2-agent-kit-and-initializer-diagnosis-authorization.md) — read-only Agent Kit validation + read-only G1 initializer diagnosis only. Does not authorize any fix, initializer/env/api change, retranslation, upload, F1–F8 rerun, or G2/G3/H1/H2/OQ-1/host work.
- **Predecessor:** [`docs/research/2026-09-27-viewer-clash-panel-g1-svf2-prerequisite-check.md`](2026-09-27-viewer-clash-panel-g1-svf2-prerequisite-check.md) — the blocked G1 attempt this diagnosis investigates.
- **Not committed.** This authorization's stop gate withholds commit/push unless separately authorized (unlike the prior G1 task). This file and the `docs/handoffs/latest.md` update are written to disk, per the authorization's own "persist"/"update" instructions, but left as uncommitted working-tree changes.

## Part A — Viewer Agent Kit knowledge validation

Performed by a dedicated read-only subagent scoped strictly to `/Users/kangea/Workspace/Codes/aps-viewer-agent-kit` (a separate git repository — branch `main`, HEAD `c00dff4702af589b4eca3f08fd69477a00f03a06`). Nothing in that repo was modified.

### A1/A2 — source and search

Five skills exist under `skills/`: `aps-viewer-api-evidence-investigation`, `aps-viewer-implementation-research`, `aps-viewer-knowledge-reconciliation`, `aps-viewer-source-ingestion`, `viewer-extension-lifecycle-audit`. Routing is driven entirely by each skill's own frontmatter `description:` — no separate central dispatch document exists.

Searched the whole repo (`knowledge/`, `patterns/`, `cases/`, `skills/`, `docs/`, `tests/`) for `AutodeskProduction2`, `streamingV2`, `SVF2`/`svf2`, `OTG`/`otg`, `Initializer`, `isOTG`/`isOTG()`, `isSVF2`/`isSVF2()`, `outputType`, and "derivative"+"fallback/selection":

- **`AutodeskProduction2`, `streamingV2`, `isSVF2`, `outputType`, "derivative"+"fallback/selection": zero hits** anywhere in the formal knowledge tree.
- **`SVF2`/`OTG`/`isOTG` hits exist, but all are about an unrelated topic**: internal fragment-geometry disposal/refcounting mechanics (`knowledge/viewer-fragment-geometry.md`: `GeometryList` vs. an internal `OtgResourceCache`), and a same-named-but-different internal `FragmentList` **constructor parameter** called `isOTG` (`docs/research/collision-detection-m1-*.md`) — not the public `Model.prototype.isOTG()` runtime-check method this diagnosis is about.
- **`Initializer` hits (3, all in `viewer-extension-lifecycle-audit`)** are purely mechanical call-site-finding regexes for lifecycle auditing; none discuss the `env`/`api` options object or SVF2/OTG negotiation.
- **The (a)/(b)/(c) distinction the task asked about — (a) manifest/translation metadata, (b) Viewer runtime `Initializer` env/api configuration, (c) a live model's actual format via `isOTG()`/`isSVF2()` — is never discussed anywhere, individually or together.** This is an absence, not a conflation.

**Notable incidental finding (not formal Agent Kit knowledge — flagged, not promoted):** `.codex-worker/` session transcripts in that repo (raw tool output, outside `knowledge/`/`patterns/`/`cases/`, excluded from the repo's own formal knowledge surface) show a Codex worker having read `/Users/kangea/Workspace/Codes/aps-model-alignment/wwwroot/viewer.js`, which initializes the Viewer with `Autodesk.Viewing.Initializer({ env: 'AutodeskProduction2', api: 'streamingV2', getAccessToken }, ...)`. This is direct evidence that the `AutodeskProduction2`/`streamingV2` pattern is already in real use in a sibling project in this same user's ecosystem — it just never made it into the Agent Kit's formal knowledge, and this diagnosis does not promote it (that would need the separate, human-gated `aps-viewer-knowledge-reconciliation` workflow, not this task).

### A3 — Classification: **AK-3 — Knowledge is absent**

No formal Agent Kit content (skills, knowledge, patterns, cases, docs, tests) documents that `Autodesk.Viewing.Initializer` needs `env: 'AutodeskProduction2'` + `api: 'streamingV2'` (or equivalent) to actually negotiate OTG/SVF2 streaming, as distinct from a model simply having an `outputType: "svf2"` manifest derivative. This is a genuine gap, not an incomplete/ambiguous treatment (which would be AK-2) — there is nothing to be ambiguous about; the topic isn't addressed.

### A4 — Routing: **ROUTING_NOT_TRIGGERED_BY_CURRENT_RULES**

The prior G1 task's actual modality — a live Playwright-driven Viewer session, loading a real model, inspecting live runtime state — is explicitly excluded by every topically-adjacent skill's own description:

- `aps-viewer-api-evidence-investigation`: "Static, read-only evidence investigation only ... never executes fetched code, runs the Viewer, creates runtime probes ... not for ... live rendering/GPU debugging."
- `aps-viewer-implementation-research`: "Not for ... live runtime/browser debugging."
- `viewer-extension-lifecycle-audit`: "no execution, mutation, reload, or teardown ... Not for ... live runtime debugging that requires executing the Viewer."
- `aps-viewer-knowledge-reconciliation` / `aps-viewer-source-ingestion`: maintainer-only, not shaped for this kind of end-user task at all.

**Nuance:** `aps-viewer-api-evidence-investigation`'s trigger language ("already-written code calls a specific named Viewer API and its exact signature ... availability ... is correctness-bearing for the change at hand") plausibly matches the *static* sub-question buried in the prior task (does `Autodesk.Viewing.Initializer({ env: 'AutodeskProduction', getAccessToken })`, as already written in `wwwroot/viewer.js`, support OTG/SVF2 negotiation?) and arguably should have been invoked as a static pre-check before falling back to a live Playwright check. But per AK-3, even if invoked, the skill would have found the Agent Kit's own knowledge base empty on this exact topic and would have had to do fresh external research anyway — routing it in would not, by itself, have closed the gap. **Net: this incident reflects both a real Agent Kit knowledge gap (AK-3) and a routing gap (no skill claims this live-runtime-verification modality at all).**

### A5 — did the previous G1 investigation use this knowledge?

No skill was invoked during the prior G1 task, and per A3/A4 above, none would have supplied the missing knowledge even if invoked. The prior G1 task's own conclusion — that manifest `outputType` is unreliable and only a live `isOTG()` check is decisive — was reached independently by direct empirical testing (comparing Audubon Structure's manifest metadata against its independently-verified historical live result), not by consulting the Agent Kit, because the Agent Kit had nothing to consult on this exact question.

## Part B — G1 SVF2 initializer diagnosis

### B1 — repository-first verification

- Repo: `aps-viewer-clash-detection`. Branch: `main`. HEAD at start of this task: `feeb5b3149ace650598a7cb96a7efabb6360fe29` (= local HEAD after the prior G1 task's 2 commits; `origin/main` remains `0a58354b2b281f891fed7bc3ae199475dfaa03e7`, i.e. those 2 commits are still unpushed, as reported at the end of that task).
- Working tree: only this task's own new untracked files (this authorization prompt, this diagnosis doc, the handoff edit) — no other changes.
- G1 remains BLOCKED (per the predecessor evidence doc). G2, G3, H1, H2 confirmed still unauthorized (`docs/handoffs/latest.md`).
- Read: `CLAUDE.md`, `docs/handoffs/latest.md`, the G1 evidence doc, `wwwroot/viewer.js`, `wwwroot/index.html`, `wwwroot/main.js`, `routes/models.js`, `services/aps.js`, `test/acceptance/clashtest-viewer-adapter.acceptance.mjs`. No production file was modified.

### B2 / B3 — G1 harness initializer **is** the production app initializer (same code, no separate harness exists)

The prior G1 attempt did not build a bespoke Viewer test harness. Like the historical `clashtest-viewer-adapter.acceptance.mjs` (T3) script before it, it drove the app's own real page (`http://localhost:8080/#<urn>`), so **B2 and B3 have the identical answer** — there is only one initializer in this repository, used by production, by T3, and by the prior G1 attempt alike:

```js
// wwwroot/viewer.js:23
Autodesk.Viewing.Initializer({ env: 'AutodeskProduction', getAccessToken }, function () { ... });
```

```html
<!-- wwwroot/index.html:9, :46 -->
<link rel="stylesheet" href="https://developer.api.autodesk.com/modelderivative/v2/viewers/7.124.2/style.css">
<script src="https://developer.api.autodesk.com/modelderivative/v2/viewers/7.124.2/viewer3D.js"></script>
```

- `env`: `'AutodeskProduction'` — **not** `'AutodeskProduction2'`.
- `api`: **not set at all** (no `api` key in the options object) — **not** `'streamingV2'`.
- Viewer version: pinned `7.124.2` via the loaded script URL (not passed to `Initializer` itself).
- No other initializer option relevant to derivative/streaming selection exists anywhere in this codebase — confirmed by reading `wwwroot/viewer.js` in full and grepping the repo for `Initializer`, `env:`, `api:`.

**Both `AutodeskProduction2` and `streamingV2` are exactly the two values this authorization's own Part B2 asked whether the harness uses — confirmed absent, in the one and only initializer this repo has.**

### B4 — candidate derivative evidence (citing the predecessor evidence doc; no new translation/upload/live load performed)

From the prior G1 evidence doc (§3–4 there):

- `racbasicsampleproject.rvt` and `Audubon_Structure_clash_test.rvt` manifests both report a single 3D-role derivative with `outputType: "svf2"` (plus a separate thumbnail derivative) — **no separate legacy `"svf"`-labeled derivative was observed alongside it** for either model.
- Audubon Structure's manifest says `"svf2"` while its independently-verified historical live result (T3) is `isOTG() === false` — direct, already-established proof that `outputType: "svf2"` in the manifest does **not** by itself guarantee a live `isOTG()===true` result.
- 7 of 8 sampled bucket candidates (this repo's own fixtures + 2 official Autodesk samples) loaded successfully through the app's own path and **all reported `isOTG: false`, `is3d: true`**.

No candidate model's manifest was re-inspected and no new live load was performed for this diagnosis (not needed — B5 explicitly permits citing already-collected evidence, and B1/B5 forbid retrying with changed initializer values).

### B5 — live-loaded format evidence (cited, not re-run)

Reusing the prior task's already-collected, already-permitted live loads (see B4): every successfully-loaded candidate reported `isOTG: false`; `isSVF2()` was not queried in the prior run (only `isOTG()` and `is3d()` were checked) — this diagnosis does not query it now, since that would be a new live load, which B5 does not call for ("for any minimal diagnostic live load **already permitted** by the current harness" — the prior run is that already-permitted load; no new one was taken).

### B6 — load path trace

`wwwroot/main.js` → `onModelSelected` → `wwwroot/viewer.js loadModel`:

```js
// wwwroot/viewer.js
Autodesk.Viewing.Document.load('urn:' + urn, onDocumentLoadSuccess, onDocumentLoadFailure);
// onDocumentLoadSuccess(doc):
viewer.loadDocumentNode(doc, doc.getRoot().getDefaultGeometry(true), { keepCurrentModels });
```

No explicit derivative-selection or SVF/SVF2-fallback branch exists anywhere in this app's own code (`routes/models.js`, `services/aps.js`, `wwwroot/*.js`) — derivative selection is entirely internal to the Viewer SDK's own `Document`/`loadDocumentNode` implementation, which is governed by the `Initializer`'s `env`/`api` options. Per Autodesk's own documented Viewer initialization contract (not this repo's own documentation, since per Part A the Agent Kit has none): `env: 'AutodeskProduction'` alone selects the legacy (non-streaming) code path; `env: 'AutodeskProduction2'` + `api: 'streamingV2'` is required to negotiate true OTG/SVF2 streaming. Without it, a model whose manifest advertises `outputType: "svf2"` is still loaded through Autodesk's legacy-compatible code path, which is exactly consistent with every one of the 7 empirically-observed `isOTG: false` results in this repo, without requiring any of those 7 models to actually lack a genuine SVF2 derivative.

## Part C — Diagnosis disposition

**Primary disposition: D2, with D1 identified as the untried, most promising next diagnostic step.**

- **D2 applies as a statement of current fact:** there is no separate "G1 harness" distinct from the production app's own initializer in this repository today — B2 and B3 are the same file, the same call, the same values. By definition, today's G1 evidence was gathered through what is also the production/runtime initializer, and that initializer is on the legacy (non-OTG) path. Per D2's own text, fixing this would be "a host/runtime integration issue... outside the current G1 verification scope" — i.e., changing `wwwroot/viewer.js` is a production change, not something this or a future G1-only task could do without becoming a production fix.
- **D1 is not literally applicable to what exists today** (no separate G1-only harness has ever been built — T3 and the prior G1 attempt both reused the production page), **but it names the concrete, never-yet-tried next step**: a dedicated, non-production diagnostic harness (a bare test page or script that calls `Autodesk.Viewing.Initializer` directly with `env: 'AutodeskProduction2'`, `api: 'streamingV2'`, without touching `wwwroot/viewer.js` or any production file) has never been attempted in this repository. Whether that alone would flip `isOTG()`/`isSVF2()` to true for one of the 7 already-tested models remains **untested and unconfirmed** — it is a hypothesis strongly supported by (a) the well-established Autodesk Viewer initializer contract, (b) the internal consistency of all 7 empirical `isOTG:false` results, and (c) the incidental discovery that a sibling project in this same ecosystem already uses exactly this pattern in its own `viewer.js` — but it is not proven by this read-only diagnosis, which made no initializer change and no new live load.
- **D3 (fixtures lack usable SVF2 derivatives) is not established either way** — the manifest evidence (single `outputType: "svf2"` derivative, no parallel legacy derivative) is consistent with these models having a genuine SVF2 derivative that the legacy initializer simply never requests; it is equally consistent with those derivatives being incomplete/non-OTG-capable despite the label. This diagnosis cannot distinguish the two without the untried D1 step.
- **D4 does not apply** — there is no unexplained contradiction requiring a stop-and-review; the initializer gap plausibly and fully accounts for every observed result.
- **D5 residual, stated precisely:** the smallest next action that would resolve the remaining uncertainty is exactly what D1 names — build a separate, non-production diagnostic-only Viewer harness with `env: 'AutodeskProduction2'`/`api: 'streamingV2'` and re-check `isOTG()`/`isSVF2()` on an already-known model (no new upload/translation needed). That action requires **separate owner authorization** (it was explicitly out of scope for this task) and was **not performed here**.

## Part D — Cross-result interpretation

**Combined result: `AK-3 + ROUTING_NOT_TRIGGERED_BY_CURRENT_RULES + D2(current)/D1(untried next step)`.**

This is closest to the authorization's own worked example "`AK-3 + D1`" ("Agent Kit has a real knowledge gap, and the G1 harness is also configured incorrectly"), with the added nuance that "the G1 harness" and "the production runtime" are not actually two different things in this repository — they are the same initializer, which is why the honest current-state disposition is D2 (a production/runtime fact) while D1 names the untried, non-production-touching fix path.

- **Agent Kit knowledge gap:** **yes** (AK-3).
- **Agent Kit routing gap:** **yes** (no skill's description claims live-Viewer-runtime-verification work; one skill's static-evidence trigger language plausibly should have fired for the narrower static Initializer-configuration question, but per AK-3 would have found nothing to cite even if it had).
- **Runtime/harness configuration gap:** **yes** — confirmed directly: `env: 'AutodeskProduction'`, no `api` option, in the one and only initializer this repo has, used identically by production and by every live test to date.
- **Fixture gap:** **unknown** — not established either way; distinguishing "fixtures lack real SVF2 derivatives" from "the initializer never requested them" requires the untried D1 diagnostic step.

### Recommended next owner decision

Authorize, as a narrowly-separate task, building a **non-production, diagnostic-only** Viewer harness (a bare test page/script, not `wwwroot/viewer.js`) initialized with `env: 'AutodeskProduction2'`, `api: 'streamingV2'`, loading one of the 7 already-known models (no new upload/translation), and checking `isOTG()`/`isSVF2()`. If that alone yields `true`, G1's fixture prerequisite is resolved with an existing model and no new APS object/job is needed; if it still yields `false`, that would newly support D3 (a genuine fixture gap) and justify considering fixture provisioning per the predecessor evidence doc's option 2.
