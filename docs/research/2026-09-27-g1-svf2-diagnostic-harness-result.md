# G1 SVF2 — non-production diagnostic harness result: **H1, initializer confirmed as the blocker**

- **Date:** 2026-09-27
- **Authorization:** [`docs/prompts/g1-svf2-nonproduction-diagnostic-harness-authorization.md`](../prompts/g1-svf2-nonproduction-diagnostic-harness-authorization.md) — build and run a separate, non-production SVF2 diagnostic harness only. Does not authorize production changes, F1–F8, G2/G3/H1/H2, OQ-1, host integration, or new upload/translation.
- **Predecessors:** [`2026-09-27-viewer-clash-panel-g1-svf2-prerequisite-check.md`](2026-09-27-viewer-clash-panel-g1-svf2-prerequisite-check.md) (G1 blocked), [`2026-09-27-g1-svf2-agent-kit-and-initializer-diagnosis.md`](2026-09-27-g1-svf2-agent-kit-and-initializer-diagnosis.md) (Agent Kit AK-3; initializer identified as the likely cause, untested).
- **Not committed.** Per this authorization's own "Commit / push" section, nothing in this task was committed or pushed; all files remain in the working tree.

## Repository-first verification

- Branch `main`; HEAD `feeb5b3149ace650598a7cb96a7efabb6360fe29` (unchanged from the prior diagnosis task); `origin/main` still `0a58354b2b281f891fed7bc3ae199475dfaa03e7` (2 local commits from the T1–T33/G1 closeout remain unpushed, as previously reported).
- Working tree before this task matched the recorded diagnosis exactly (the prior task's uncommitted files, no other drift). Production initializer confirmed unchanged: `wwwroot/viewer.js:23` still reads `Autodesk.Viewing.Initializer({ env: 'AutodeskProduction', getAccessToken }, ...)`.
- G1 still blocked; G2/G3/H1/H2/OQ-1/host integration confirmed still unauthorized.

## Harness

New file: [`test/acceptance/g1-svf2-initializer-diagnostic.mjs`](../../test/acceptance/g1-svf2-initializer-diagnostic.mjs) — not wired into `npm test`, `server.js`, or any user-facing route; not an `*.acceptance.mjs`-style acceptance criterion (deliberately not claiming that), marked diagnostic-only in its own header banner.

- **Isolation:** serves its own bare HTML page via Playwright `page.route('**/__g1-diagnostic__', ...)`, entirely independent of `wwwroot/index.html`/`wwwroot/viewer.js` (neither is loaded; both remain untouched). The only existing app surface it consumes as a client is the unmodified, already-existing `GET /api/auth/token` endpoint (a read-only token mint, identical to what production already does) and the same pinned Viewer script URL production already loads.
- **Viewer version:** `7.124.2` — the same version already pinned by `wwwroot/index.html`; not changed.
- **Initializer under test:** `Autodesk.Viewing.Initializer({ env: 'AutodeskProduction2', api: 'streamingV2', getAccessToken }, ...)` — the only difference from production's `{ env: 'AutodeskProduction', getAccessToken }`.
- **Model:** existing model only, no upload/translation. Selected `racbasicsampleproject.rvt` (Room Locator model, URN `dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL3JhY2Jhc2ljc2FtcGxlcHJvamVjdC5ydnQ`) — chosen because its manifest already advertises a single `outputType: "svf2"` 3D derivative with no parallel legacy `"svf"` derivative (per the first G1 evidence doc), and because it previously, empirically loaded through the **production** initializer with `isOTG: false, is3d: true` — i.e. a real, already-translated fixture whose format status under the corrected initializer is exactly the open question.

## Exact command and environment

```
npm start &                                          # unmodified server, port 8080
node test/acceptance/g1-svf2-initializer-diagnostic.mjs
```

Run once. Chromium launch args identical to the repo's existing acceptance-script convention: `--no-sandbox --disable-dev-shm-usage --single-process --no-zygote`.

## Result (raw JSON retained: [`docs/research/evidence/2026-09-27-g1-svf2-initializer-diagnostic-result.json`](evidence/2026-09-27-g1-svf2-initializer-diagnostic-result.json))

| Field | Value |
|---|---|
| Viewer version / script URL | `7.124.2` / `https://developer.api.autodesk.com/modelderivative/v2/viewers/7.124.2/viewer3D.js` (unchanged) |
| Initializer `env` | `AutodeskProduction2` |
| Initializer `api` | `streamingV2` |
| Model load outcome | `success` |
| Console errors | `[]` (none) |
| Page exceptions | `[]` (none) |
| `model.isOTG()` | **`true`** |
| `model.isSVF2()` | **`true`** |
| `model.is3d()` | `true` |
| Prior result, same model, production initializer (`env: 'AutodeskProduction'`, no `api`) | `isOTG: false`, `is3d: true` |

Total run time ~11 seconds; no fallback signal observed in the load path.

## Disposition: **H1 — initializer confirmed as the blocker**

The identical model, at the identical pinned Viewer version, failed the previous legacy initializer path (`isOTG: false`) and now loads through this diagnostic harness with unambiguous SVF2/OTG runtime evidence (`isOTG: true`, `isSVF2: true`), with no other variable changed. This directly confirms the hypothesis raised (but not tested) by the prior initializer diagnosis: `env: 'AutodeskProduction'` without `api: 'streamingV2'` is sufficient by itself to prevent OTG/SVF2 negotiation for a model whose manifest already advertises a genuine SVF2 derivative — the fixture was never the problem.

**Not run, per this authorization's explicit stop gate:** F1–F8, G2, G3, H1 (host), H2 (host), OQ-1, any host integration work.

## Recommended next owner decision

G1's own entry precondition — an SVF2/OTG-loaded model with `model.isOTG() === true` — is now satisfiable **without any new upload or translation**, using this exact model, through a diagnostic-only harness of this same shape. The next decision is how G1 itself should consume this: whether to author a full G1 F1–F8 verification script built on this same isolated-harness pattern (not touching `wwwroot/viewer.js`), and whether/when the production initializer's own SVF2/OTG posture (a separate host/runtime integration question, per D2 in the prior diagnosis — this task does not reopen or resolve that) should be revisited. Neither is decided or started here.

## Confirmations

- No production Viewer initializer was changed (`wwwroot/viewer.js` untouched).
- No production code was changed.
- No model was uploaded or translated.
- No G1 F1–F8 verification was run.
- No G2/G3/H1/H2/OQ-1/host integration work was started.
- No Agent Kit skill or routing change was made.
