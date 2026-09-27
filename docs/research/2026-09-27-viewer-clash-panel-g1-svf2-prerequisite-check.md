# Viewer Clash Panel — G1 SVF2/OTG verification: prerequisite check (BLOCKED, F1–F8 not run)

- **Date:** 2026-09-27
- **Authorization:** [`docs/prompts/viewer-clash-panel-g1-svf2-verification-authorization.md`](../prompts/viewer-clash-panel-g1-svf2-verification-authorization.md) — G1 (bounded SVF2/OTG verification of F1–F8) only. Does not authorize G2, G3, H1, H2, production changes, or fixture provisioning.
- **Branch / HEAD:** `main` @ `00d2f875d5e6b97296fa8ad0f5b11268bd39555e` (governance commit persisting the G1 authorization prompt; no other change).
- **Result: G1 is BLOCKED at its own entry precondition.** No SVF2/OTG-loaded model (`model.isOTG() === true`) could be established in the app's existing live harness. **F1–F8 were not run** — there is nothing to run them against yet. This is a prerequisite-missing report, not a PASS, FAIL, or partial F1–F8 result.

## 1. Repository baseline verified before starting

- Branch `main`; `main` HEAD = `origin/main` HEAD = `0a58354b2b281f891fed7bc3ae199475dfaa03e7` before this task; working tree was **not** clean (the authorization prompt file itself was untracked).
- Per this repo's own convention for owner-authorization prompts (the T1–T33 milestone's `a0134bb` did the same for its authorization), the prompt was committed as a governance-only record: `00d2f875d5e6b97296fa8ad0f5b11268bd39555e` "docs(prompts): persist G1 SVF2 verification authorization". No implementation content. This is the only commit made in this task.
- Confirmed: T1–T33 accepted, merged, pushed (per `docs/handoffs/latest.md`); G1 is the currently authorized action; G2, G3, H1, H2, SVF2 Panel live acceptance, OQ-1 and host integration remain unauthorized.

## 2. Consultation before live work

Consulted `codex-advisor` (medium effort; this repo's CLAUDE.md requires preferring it over the native advisor tool) before any live-network action. Key guidance, followed throughout:

- `GET /api/models/:urn/status` (this app's own status endpoint) cannot establish SVF2/OTG — it discards derivative format entirely (`{status, progress, messages}` only, `routes/models.js:21-43`). The only decisive signal is a live Viewer load reporting `model.isOTG() === true`.
- Uploading and translating a brand-new model via `POST /api/models` is an external-state mutation (a new persistent APS object + a billed derivative job) that G1's authorization did not clearly bless — the implementation plan treats an "SVF2-loaded fixture with `model.isOTG() === true`" as a G1 **entry precondition**, not something G1 itself is authorized to manufacture. **Recommendation followed: do not translate a new model; check for an existing one first, and stop to ask if none exists.**
- Do not split the live browser session across subagents (F3 readiness / F6 unload-reload need one coherent event history); parallelize only the surrounding read-only research.

## 3. Manifest `outputType` is not a reliable signal either (verified directly, not just inferred)

Before any browser session, queried this app's own `getManifest()` (read-only, `services/aps.js`) for two known models:

| Model | Manifest `derivatives[].outputType` | Live `isOTG()` (from the historical T3 evidence, for Structure) |
|---|---|---|
| `racbasicsampleproject.rvt` (Room Locator model) | `"svf2"` | not previously live-tested |
| `Audubon_Structure_clash_test.rvt` | `"svf2"` | **`false`** (T3, `docs/research/2026-09-26-federated-clash-test-viewer-adapter-t3-live-acceptance.md`) |

Audubon Structure's manifest says `"svf2"` even though the independently-verified T3 live acceptance run proved `isOTG() === false` for that exact model. **The manifest's `outputType` field reflects the translation job's requested type, not what a specific Viewer version actually delivers/reports at load time**, confirming codex's caution went further than expected: even the raw manifest data, not just this app's trimmed status endpoint, is unreliable for this determination. This was worth checking (it looked like a fast triage shortcut) but the result is negative — it doesn't narrow anything. The only decisive check remains a live load.

## 4. Live isOTG discovery (bounded preflight, not F1–F8)

Started the app's own dev server (`npm start`, unmodified) and drove the app's own real production loading path (`wwwroot/main.js` hash-load → `wwwroot/viewer.js loadModel` → `Autodesk.Viewing.Document.load` + `loadDocumentNode`, `env: 'AutodeskProduction'`, pinned Viewer script `7.124.2` per `wwwroot/index.html`) with Playwright, one page reused across candidates (a fresh `page.goto('about:blank')` between candidates to force a real reload, since a fragment-only navigation on an already-open page does not reinitialize `window.viewer`). This is discovery only — it records `isOTG`/`is3d` and stops; no F1–F8 assertion was made against any of them.

Bucket inventory: `GET /api/models` returned **100 objects** — a large, clearly shared/multi-purpose APS bucket (file names span many unrelated languages/projects/formats: `.rvt`, `.ifc`, `.nwd`, `.dwg`, `.dwfx`, `.zip`), not a bucket dedicated to this repository. Selected 8 candidates most likely to be usable 3D fixtures: this repo's own clash-test fixtures, the Room Locator model, and two official Autodesk reference samples.

| Candidate | Result |
|---|---|
| `racbasicsampleproject.rvt` (Room Locator model) | loaded; **`isOTG: false`**, `is3d: true` |
| `Audubon_Architecture_clash_test.rvt` | loaded; **`isOTG: false`**, `is3d: true` |
| `Audubon_Mechanical_clash_test.rvt` | loaded; **`isOTG: false`**, `is3d: true` |
| `linked_model_clash_test.rvt` | loaded; **`isOTG: false`**, `is3d: true` |
| `main_model_clash_test.rvt` | loaded; **`isOTG: false`**, `is3d: true` |
| `Snowdon Towers Sample Architectural.rvt` (official Autodesk sample) | loaded; **`isOTG: false`**, `is3d: true` |
| `rac_advanced_sample_project.rvt` (official Autodesk sample) | loaded; **`isOTG: false`**, `is3d: true` |
| `9400_Railing Test.rvt` | timed out waiting for load (90s) — not further investigated; the other 7 results already give a consistent, decisive signal |

**All 7 successfully-loaded candidates — spanning this project's own fixtures and two independent official Autodesk reference samples — report `isOTG() === false`.** The remaining 92 unexamined bucket objects were not checked individually; the sample was deliberately diverse (own fixtures + two unrelated Autodesk-authored samples) rather than exhaustive, per the "bounded preflight" instruction.

## 5. Classification (per the authorization's own vocabulary, §"No production fixes during G1")

**Classification: harness/environment — SVF2/OTG fixture prerequisite not established.**

Two distinct, non-exclusive possibilities, neither of which G1 is authorized to resolve or fix:

1. **No object in the examined portion of this bucket was translated in a way that yields true OTG delivery** (regardless of the misleading `"svf2"` manifest label — see §3).
2. **The app's own hardcoded, pinned Viewer script (`7.124.2`) and/or its `env: 'AutodeskProduction'` initializer option never negotiates OTG delivery**, independent of which model is requested — i.e. the harness itself, not the fixture, may be the limiting factor. This repo's live-acceptance convention (`test/acceptance/clashtest-viewer-adapter.acceptance.mjs`) also pins to this exact same Viewer version, so this harness limitation, if real, would affect any future SVF2 acceptance script built the same way.

Distinguishing these two would require loading the same already-confirmed-`isOTG:false` model with a **different, unpinned/newer Viewer script version** — which is an environment/harness change, explicitly out of scope for a verification-only gate that must not modify what it's checking.

## 6. F1–F8 disposition

**Not run.** There is no confirmed SVF2/OTG fixture to run them against. Recording "not evidenced" for all eight would be indistinguishable from a real failure; recording nothing would look like the check was skipped. Explicitly: **F1–F8 remain exactly as unevidenced-for-SVF2 as they were before this task.** No Viewer Adapter, collision, or Panel production code was exercised beyond the app's own existing model-loading path.

(For when a fixture is available, the exact per-item verification matrix — normative wording, APIs, PASS/FAIL/UNRESOLVED criteria, and which items have zero precedent even under SVF — was independently derived from the spec/plan/authorization by parallel research this session and is ready to reuse without re-deriving.)

## 7. What would unblock G1 (owner decision needed — not decided or acted on here)

1. **Identify an existing bucket object already known to be true OTG**, if the owner knows of one this check missed among the other 92 objects, and/or confirm whether G1 should test with a Viewer script version other than the app's pinned `7.124.2` (a scope question, since the production app itself is pinned).
2. **Explicitly authorize provisioning a new fixture** (upload + translate via this app's own `POST /api/models`, which already requests `Svf2` output) — specifying the source file, an object key, retention/cleanup expectations, and accepting the new persistent APS object + billed translation job this creates. This was not done here; it is a new-state mutation outside G1's current authorization per §2.
3. **Report this as a closed/blocked gate** if neither of the above is available, leaving G1 open until a fixture exists.

No F1–F8 verification, G2, G3, H1, H2, host integration, or Viewer Adapter/Core/Panel production change was performed or attempted.
