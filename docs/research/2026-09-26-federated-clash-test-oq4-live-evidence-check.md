# Federated Clash Test — OQ-4 live evidence check (Audubon fixture)

- **Status:** evidence artifact. **Result: OQ-4 = PASS** for the criteria and fixture the spec names, with the scope-of-evidence limits in §7. It does **not** authorize Viewer-adapter planning (transition rule, project `CLAUDE.md`); that needs a separate explicit owner authorization.
- **Authorization:** owner message of this session, "Authorize the OQ-4 live evidence check only" (research-only; no `clashtest/viewer/`, no production enumerator, no core edit, no adapter design/planning, no host integration, no spec change absent a genuine contradiction).
- **Governing text:** frozen spec `docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md` §24 OQ-4 and the pre-integration prerequisite table, §6.2 (`ElementEnumerator`, owner rules, `ownerMismatch`, `unreachable`), §5.6, AC-15 (g); readiness assessment `docs/research/2026-09-26-federated-clash-test-core-post-p8-closeout-and-next-milestone-readiness.md` §5.
- **Repository state during the run:** branch `feature/federated-clash-test-core-engine`, HEAD `8f1da13`, working tree clean before and after; the only files this milestone adds are this artifact and the handoff update. The probe lives only in this artifact's Appendix A (deliberately not in the repository and not in `npm test`).
- **Who ran it:** the spec's prerequisite table says the *project owner* runs the check. Here the agent ran it, at the owner's authorization, on the owner's configured server/credentials. Whether delegated execution satisfies that wording is the owner's call; **the PASS below is therefore stated subject to the owner accepting delegated execution or re-running Appendix A** (self-contained, verbatim). An independent Codex read-only review of this artifact and probe (medium effort) found no defect in the measured owner agreement; its qualifications are folded into §4(b), §5 and §7.

## 1. Question and acceptance criteria under test

Spec §24 OQ-4: implementation planning of the Viewer adapter must not be authorized until a minimal live check on the acceptance fixture has recorded, in a `docs/research/` artifact:

| ID | Criterion | Pass rule (spec prerequisite table) |
| --- | --- | --- |
| (a) | the tree-node owner (**source rule**: the instance-tree node whose `enumNodeFragments` first produced the fragment) and the `fragList.getDbIds` owner (**whole-target rule**) **agree for every fragment** — `ownerMismatch.count === 0` (AC-15 (g)) | `ownerMismatch.count === 0` |
| (b) | the **source-side use of the already-resolved `fragList.getDbIds` mapping** (distinct-owner enumeration, `fragmentCount`) and the **tree-readiness signal** | readiness signal recorded (the table's pass rule) |
| (c) | the fixture's **`unreachablePopulation`** and **`mixedOwnerDbIds`** counts | counts recorded |

Fail path (decided in the spec): if (a) fails, planning already fails closed per affected model (`owner-mapping-mismatch`); v1 is narrowed to agreeing content with a recorded supported-content statement, or a roadmap-§8 exact-owner scope (OQ-15) if the product owner rejects the narrowing. **(a) did not fail, so no narrowed envelope and no owner stop was required.**

## 2. Environment and fixture

| Item | Value |
| --- | --- |
| Date / runs (UTC) | 2026-09-25. Final probe (Appendix A) run twice in **separate fresh browser sessions**: `run1` 12:25:11Z, `run2` 12:25:46Z; all results below are from these. Five earlier runs of intermediate probe versions (12:14Z, 12:16Z ×2, 12:23Z ×2) produced the same counts and are not relied on |
| Host | macOS Darwin 27.0.0 arm64; Node v22.23.1 |
| Browser | Chromium 151.0.7922.34 (headless) via Playwright 1.62.1, launched with the repository's acceptance-script args `--no-sandbox --disable-dev-shm-usage --single-process --no-zygote` |
| Viewer | Autodesk Viewer **7.124.2** (`https://developer.api.autodesk.com/modelderivative/v2/viewers/7.124.2/viewer3D.js`, as pinned in `wwwroot/index.html`), THREE r71 page global; all three models `is3d: true`, `isOTG: false` (SVF, not SVF2) |
| App / network | repository app via `npm start` on `localhost:8080`, live APS (token endpoint reachable; credentials are the owner's server-side configuration and were not read or recorded) |
| Library under test | the repository's `collision/viewer/ViewerModelAdapter.js` at HEAD `8f1da13` (unchanged), imported in-page for a differential |
| Fixture | the three-discipline Audubon set exactly as `test/acceptance/clash-finder.acceptance.mjs` and `collision/README.md` describe it, loaded the same way (first model via URN hash, the others via the app's "Load as additional model" checkbox + Load): **Architecture** `urn:adsk.objects:os.object:test-sandbox-lkwej7xpbgp63x4hl335y6m26oakggof/Audubon_Architecture_clash_test.rvt`; **Structure** `…/Audubon_Structure_clash_test.rvt`; **Mechanical** `…/Audubon_Mechanical_clash_test.rvt` (base64 URNs are constants in Appendix A) |
| Model sizes observed | `fragList.getCount()`: Architecture **5,435**, Structure **543**, Mechanical **1,496** — **7,474** total, equal to the counts `collision/README.md` records for the same fixture |

## 3. Method (what the probe does)

Read-only: nothing is written to any model; the only in-page mutation is the two temporary accessor perturbations of §5, restored in a `finally`.

1. **fragList side.** For every `fragId` in `0..getCount()-1`: class **N** (`isNotLoaded`), **U** (`getDbIds` undefined / array / non-number) or **L** (numeric owner) — the population classes of spec §6.2.1.
2. **Tree side.** A full iterative walk of the instance tree (`enumNodeChildren`, `enumNodeFragments`, both non-recursive), then the **whole-model roots = topmost fragment-owning nodes** (§5.6.2), then a per-root pre-order walk (own fragments first, then children) with **first-discovery-wins** across roots in ascending order — the same discovery rule as `extractFragments`.
3. **ownerMismatch (§6.2).** For every tree-reachable fragment compare tree owner against `fragList.getDbIds`; also count tree-reachable N/U fragments separately.
4. **Reconciliation / unreachable (§6.2).** Loaded, owner-resolvable fragments in **no** root subtree (`unreachable`, with `ownerDbIds`), N/U fragments in no subtree (`unattributable`), and `mixedOwnerDbIds` (owners both unreachable and in some root's owner set). Check `tree-reachable + unreachable + unattributable = fragList.getCount()`.
5. **Source-side mapping (b).** For every whole-model root compare its distinct-owner set and `fragmentCount` computed by the tree rule against the same fragment set read through `fragList.getDbIds`.
6. **Library differential.** The repository's own `extractAllFragments` (owner = `fragList.getDbIds`) and `extractFragments` (owner = tree) run over the same model and are compared with the probe: all roots in one call, each root individually (so the per-root ceilings `maxFragmentsPerDbId` 5,000 / `maxChildrenPerNode` 10,000 are exercised), and the fixture's explicit source roots Structure `2734` and `3965`.
7. **Readiness.** An in-page 5 ms sampler records, per model, when `isLoadDone()`, `getData().instanceTree` and `isObjectTreeCreated()` first become true; `MODEL_ADDED`, `OBJECT_TREE_CREATED` and `GEOMETRY_LOADED` events are timestamped; and **inside the `OBJECT_TREE_CREATED_EVENT` and `GEOMETRY_LOADED_EVENT` handlers** the probe takes a read-only snapshot (tree node count, distinct tree-reachable fragments, `fragList.getCount()`, not-loaded count) that is compared with the final measurement — i.e. enumeration is also evaluated at the earliest candidate readiness signal, not only after `isLoadDone()`.
8. **Stability and reproducibility.** Each session measures twice (5 s apart); two independent sessions are compared.
9. **Negative controls (probe sensitivity).** On the Structure model, one at a time and each restored in a `finally`: (a) make `fragList.getDbIds(0)` return a wrong owner; (b) hide fragment `1` from `enumNodeFragments`; (c) make `fragList.isNotLoaded(2)` return true (a tree-reachable not-loaded fragment); (d) make a second node re-report an already-owned fragment (duplicate discovery). The probe must report the corresponding violation each time and be clean after restore.

## 4. Observed results per criterion

Raw numbers: Appendix B. Both sessions produced **identical** measurements (excluding wall-clock durations); within each session the second measurement equalled the first for all three models.

### (a) Owner mapping — `ownerMismatch.count === 0` → **PASS**

| Model | fragList count | classes N / U / L | tree-reachable | `ownerMismatch.count` | tree-reachable N/U | library `extractAllFragments`: records / diagnostics / owner ≠ fragList | library `extractFragments` (all roots): records / missing / owner ≠ tree |
| --- | ---: | --- | ---: | ---: | ---: | --- | --- |
| Architecture | 5,435 | 0 / 0 / 5,435 | 5,435 | **0** | 0 | 5,435 / 0 / 0 | 5,435 / 0 / 0 |
| Structure | 543 | 0 / 0 / 543 | 543 | **0** | 0 | 543 / 0 / 0 | 543 / 0 / 0 |
| Mechanical | 1,496 | 0 / 0 / 1,496 | 1,496 | **0** | 0 | 1,496 / 0 / 0 | 1,496 / 0 / 0 |

Every fragment (7,474 of 7,474) has a numeric `getDbIds` owner equal to its tree owner. No fragment is discovered under two nodes or under two roots (`rediscoveries: 0`, `fragmentsUnderMultipleRoots: 0`), so first-discovery-wins never had to choose. The probe's independent tree walk and the library's own two extraction functions agree exactly. Explicit roots `2734` and `3965` (Structure): each yields exactly 1 fragment whose owner is the root itself, equal under both rules — matching the ground truth in `collision/README.md`.

### (b) Source-side mapping and tree-readiness signal → **PASS**

*Source-side mapping.* 5,969 whole-model roots compared (Architecture 4,244, Structure 468, Mechanical 1,257): **0** root owner-set mismatches between the tree rule and the `fragList.getDbIds` rule, **0** `fragmentCount`-versus-discovery mismatches. **Honest reading:** the owner-set comparison applies `getDbIds` to the same tree-derived fragment set, so once (a) holds per fragment it holds per root by construction, and `fragmentCount` here is the distinct tree-reachable fragment count, not a count derived through `getDbIds`. This is an aggregation consistency check confirming that a root's `ownerDbIds` and `fragmentCount` can be produced from the subtree's fragment ids plus `fragList.getDbIds`; it is **not** independent evidence beyond (a). It satisfies the spec table's pass rule for (b) (readiness recorded); it should not be cited as more than that. Σ root `fragmentCount` equals the population in every model (5,435 / 543 / 1,496). Largest root: 14 fragments; most distinct owners in one root: 7 — far below the library's per-root ceilings; the library's per-root `extractFragments` succeeded for **5,969 of 5,969** roots with no `ExtractionLimitExceededError`.

*Tree-readiness signal.* Observed on all six loads (two sessions × three models), in this order per model: `MODEL_ADDED` → `OBJECT_TREE_CREATED` → `GEOMETRY_LOADED` / `isLoadDone() === true`. The instance tree (`model.getData().instanceTree` non-null; `model.isObjectTreeCreated() === true`; `model.getObjectTree()` and `getInstanceTree()` return a tree) was available **at or before** `isLoadDone()` in 6/6 loads — 0 to about 4.8 s ahead at the 5 ms sampler's resolution (one load equal within a sampler tick; Appendix B.2) — and inside the `OBJECT_TREE_CREATED_EVENT` handler `isLoadDone()` was **false** for all six loads. Signals available to a future adapter, each observed working: `getData().instanceTree`, `isObjectTreeCreated()`, `OBJECT_TREE_CREATED_EVENT`, `isLoadDone()`, `GEOMETRY_LOADED_EVENT`. The header comment of `clash-finder.acceptance.mjs` reports that `instanceTree` can be momentarily absent right after `isLoadDone()`; **that was not reproduced here** (tree preceded `isLoadDone()` every time). This is an observation, not a contradiction (different observation points). *Is early presence a safe gate?* On this fixture, yes: the event-time snapshot taken inside `OBJECT_TREE_CREATED_EVENT` (loading not yet done) equals the final state in all six loads — node count, distinct tree-reachable fragments and `fragList.getCount()` identical, not-loaded count 0 (Appendix B.2 `snapshotVsFinal`). That shows only that the tree was already complete and stable at creation for this content and build; it does **not** establish which signal is sufficient in general (e.g. SVF2/OTG or streaming geometry), so the adapter plan should treat the readiness gate as an open design input to be re-validated, and must not assume tree presence alone implies enumeration-ready for other content. The *failure* path (spec §6.2: "must fail, not return a partial list, when the Viewer reports the tree unavailable") could not be induced without production code and is **not** evidenced (§7).

### (c) `unreachablePopulation` and `mixedOwnerDbIds` → **PASS (counts recorded)**

| Model | unreachable `count` (loaded, owner-resolvable, in no root subtree) | unreachable owners | `unattributable.notLoaded` | `unattributable.ownerUnresolvable` | `mixedOwnerDbIds` |
| --- | ---: | ---: | ---: | ---: | ---: |
| Architecture | 0 | 0 | 0 | 0 | 0 |
| Structure | 0 | 0 | 0 | 0 | 0 |
| Mechanical | 0 | 0 | 0 | 0 | 0 |

Reconciliation holds exactly in all three models: tree-reachable + unreachable + unattributable = `fragList.getCount()`. There is therefore **no under-enumeration of the instance tree relative to the fragment population** on this fixture, and the ledger's `unreachablePopulation` table would be empty for it.

### Additional facts recorded for later owners (not OQ-4 criteria)

- *Hierarchy (OQ-16 / AC-15 (b) inputs).* Whole-model roots containing **more than one fragment-owning node**: Architecture **4** (root `5207` owners {5207, 5211}; `8097` {8097, 8101–8104}; `8138` {8138–8142}; `8437` {8437–8443}), Structure **0**, Mechanical **0**. In each Architecture case the root itself owns fragments, so these are the parent/descendant class of spec §5.6.3; the sibling-owners-under-a-*non-owning*-root class does not arise from whole-model roots (roots are fragment-owning by construction) and is **not** exemplified here. Architecture has 4,259 fragment-owning nodes for 4,244 roots (15 nested fragment-owning descendants); Structure 468/468, Mechanical 1,257/1,257. Whether these become `ledger.hierarchyInternal` entries depends on the test (only roots in `A ∩ B` count); for the AC-15 (b) shape (`A={Structure 2734}`) the relevant root `2734` has a single owner, so an empty table is expected — **expected, not measured here**.
- *Capacity.* All three models are inside `maxCollisionInstancesPerEpoch` 20,000 (largest 5,435), so OQ-6 does not bite this fixture.

## 5. Probe validity (negative controls, repeatability)

| Check | Outcome |
| --- | --- |
| Control (a): `getDbIds(0)` perturbed on Structure | `ownerMismatch.count` **1** (fragId 0, treeOwner 3663, fragListOwner 1003663); one root owner-set mismatch — both sessions |
| Control (b): fragment 1 hidden from the tree walk | `unreachable.count` **1**, tree-reachable 542, reconciliation still sums to the population, `ownerMismatch` 0 — both sessions |
| Control (c): `isNotLoaded(2)` forced true | population N = 1, tree-reachable not-loaded = 1, numeric `ownerMismatch.count` 0, **strict** count (numeric + tree-reachable N/U, the wider reading of spec §6.2 "any disagreement") = 1 — both sessions |
| Control (d): a second node re-reports an owned fragment (fragment 2 re-reported at fragment 0's owner) | `rediscoveries` 1, `rediscoveryOwnerDiffers` 1, `fragmentsUnderMultipleRoots` 1, numeric `ownerMismatch` 1 — both sessions |
| After restore | `ownerMismatch` 0, `unreachable` 0 — both sessions |
| Same-session re-measurement after 5 s | identical for all three models (both sessions) |
| Cross-session (fresh browser) | identical measurements |
| Console / page errors | none (0 / 0) in either final session |

A probe that could not fail would prove nothing; controls (a)–(d) show it reports each violation class the criteria are about (wrong owner, missing from tree, tree-reachable N/U, duplicate discovery). Two definitional notes from the review: the reported `ownerMismatch.count` is the numeric-disagreement count; the **strict** count that also includes tree-reachable N/U fragments is recorded alongside (`strictCountIncludingTreeReachableNU`) and is **0** for every model, as is the count of non-number, non-array, non-undefined owners (`Uother` 0), so the choice of reading does not change any result here.

## 6. Verdict

| Item | Result |
| --- | --- |
| OQ-4 (a) owner agreement, `ownerMismatch.count === 0` | **PASS** (0 mismatches over 7,474 fragments) |
| OQ-4 (b) source-side mapping + readiness signal recorded | **PASS** by the spec table's rule (readiness recorded); the mapping/count part is a consistency check, not independent evidence (§4 (b)) |
| OQ-4 (c) `unreachablePopulation` / `mixedOwnerDbIds` recorded | **PASS** (all 0; recorded) |
| **OQ-4 overall** | **PASS** — for this fixture, Viewer 7.124.2, SVF, after model load, **subject to the owner accepting delegated execution** (or re-running Appendix A) |
| Narrowed content envelope required by the evidence | **None.** (a) did not fail, so neither the spec's narrowing fallback nor the OQ-15 exact-owner scope is triggered. The *evidenced* envelope is described in §7 point 3. |
| Frozen-spec contradiction found | **None.** No spec change is proposed. |
| Remaining blocker to Viewer-adapter *planning* from OQ-4 | **None on the evidence**, plus the one procedural point above (owner acceptance of who ran the check). The spec's prerequisite table names no other gate for adapter planning (OQ-1/OQ-17 gate integration acceptance; OQ-16 gates qualified-claim presentation; G-CAL/G-RESP gate defaults and claims). The one open wording question (OQ-1: spec §24 vs master §4) is recorded in the readiness assessment (F2) and is not resolved here. |
| Consequence | Adapter planning becomes **eligible**, **not authorized**. It requires an explicit owner authorization; none has been given and none is assumed. |

## 7. Scope and limits of this evidence (what PASS does and does not mean)

1. **What was measured:** agreement of the Viewer's two owner mappings and the tree/population reconciliation on **one fixture in one Viewer build**, through a throw-away probe cross-checked against the repository's own extraction functions. It is **not** a production `ElementEnumerator`; the adapter still has to implement `resolveRoots`/`digestScope`, `subtreeDigest`/population digests, cancellation checkpoints, and pass the port conformance helper. Its per-model `owner-mapping-mismatch` gate remains the runtime safeguard for content this fixture does not represent.
2. **Fixture class:** Revit-derived, 3D, **SVF (non-OTG)**, three models, all fragments loaded and owner-resolvable, no unreachable or mixed-owner population, no 2D. Behaviour for OTG/SVF2, 2D sheets, non-Revit content, models with not-loaded/owner-unresolvable fragments, or models near the 20,000-fragment ceiling is **not** evidenced. The `unreachable`/mixed-owner classes (AC-17) therefore remain covered by the core's synthetic and real-`CollisionWorld` differential tests, not by live evidence.
3. **Evidenced envelope (an input for the adapter plan, not a narrowing):** on this fixture the source rule and whole-target rule agree for every fragment and the instance tree enumerates the whole population.
4. **Not evidenced by this check:** *which* readiness signal is sufficient for safe enumeration in general (only that the tree was complete at `OBJECT_TREE_CREATED_EVENT` on this fixture); the second half of AC-15 (g) — a pair reported with the same `PairId` whichever role the planner assigned (needs the engine over an adapter); the "tree unavailable ⇒ fail, not partial" behaviour; geometry/render-proxy readiness (OQ-18); cross-reload fragment-level identity/determinism (AC-6 T3; only aggregate counts and owner maps were compared across two sessions); any calibration or responsiveness claim (durations in Appendix B are incidental and unasserted). The inherited "Mode 2" limit for **explicit** scopes (an under-enumerated subtree that still returns fragments) stays undetectable by design (spec §6.2); the whole-model reconciliation above rules it out for this fixture only.
5. **Execution note:** run by the agent rather than the project owner (see header); the owner may re-run Appendix A verbatim (`node oq4-probe.mjs run1 out.json` with the app server on port 8080; it needs the repository's `node_modules` at the path in `REPO`, adjustable).

## 8. Handoff to the owner

OQ-4 is **PASS**; nothing was narrowed; no spec contradiction was found. Viewer-adapter planning, adapter implementation, host integration, and every other item in the readiness assessment §6 "must not begin" list remain unauthorized. The next step is the owner's decision whether to authorize Viewer-adapter **planning**.

---

## Appendix A — probe source (verbatim, as run for `run1`/`run2`)

```js
// OQ-4 live evidence probe (READ-ONLY). Throw-away instrument; never part of npm test.
// Usage: node oq4-probe.mjs <runLabel>
// Loads the three Audubon fixture models exactly as test/acceptance/clash-finder.acceptance.mjs does,
// then READS the Viewer's tree-owner (instanceTree.enumNodeFragments, first-discovery-wins) and
// fragList.getDbIds mappings for every fragment of every model. Nothing is written to the Viewer.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import os from 'node:os';

const REPO = '/Users/kangea/Workspace/Codes/aps-viewer-clash-detection';
const require = createRequire(`${REPO}/package.json`);
const { chromium } = require('playwright');

const RUN = process.argv[2] || 'run1';
const OUT = process.argv[3] || `./oq4-result-${RUN}.json`;
const PORT = process.env.PORT || 8080;
const BASE_URL = `http://localhost:${PORT}`;
const URN_ARCH = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fQXJjaGl0ZWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const URN_STRUCT = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fU3RydWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const URN_MECH = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fTWVjaGFuaWNhbF9jbGFzaF90ZXN0LnJ2dA';

function resolveProxyFromEnv() {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const proxy = { server: `${url.protocol}//${url.host}` };
    if (url.username) proxy.username = decodeURIComponent(url.username);
    if (url.password) proxy.password = decodeURIComponent(url.password);
    const bypass = process.env.NO_PROXY || process.env.no_proxy;
    if (bypass) proxy.bypass = bypass;
    return proxy;
  } catch { return undefined; }
}

// ---- in-page measurement (runs inside the Viewer page; read-only) --------------------------------
const MEASURE = async ({ which, explicit }) => {
  const model = window.__probe[which];
  const fl = model.getFragmentList();
  const it = model.getData().instanceTree;
  const count = fl.getCount();
  const t0 = performance.now();

  // 1. fragList side: class per fragment (spec 6.2.1 population classes N / U / L)
  const cls = new Array(count); const flOwner = new Array(count);
  const cnt = { N: 0, Uundefined: 0, Uarray: 0, Uother: 0, L: 0 };
  for (let f = 0; f < count; f++) {
    if (fl.isNotLoaded(f)) { cls[f] = 'N'; cnt.N++; continue; }
    const o = fl.getDbIds(f);
    if (o === undefined) { cls[f] = 'U'; cnt.Uundefined++; }
    else if (Array.isArray(o)) { cls[f] = 'U'; cnt.Uarray++; }
    else if (typeof o !== 'number') { cls[f] = 'U'; cnt.Uother++; }
    else { cls[f] = 'L'; flOwner[f] = o; cnt.L++; }
  }

  // 2. tree side: full node map (own fragments + children), iterative, cycle-guarded
  const own = new Map(); const kids = new Map();
  const rootId = it.getRootId();
  const seen = new Set(); const stack = [rootId]; let cycles = 0;
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n)) { cycles++; continue; }
    seen.add(n);
    const ofr = []; it.enumNodeFragments(n, (f) => { ofr.push(f); }, false);
    const ch = []; it.enumNodeChildren(n, (c) => { ch.push(c); return false; }, false);
    own.set(n, ofr); kids.set(n, ch);
    for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i]);
  }
  const nodeCount = seen.size;
  let fragOwningNodes = 0; for (const v of own.values()) if (v.length > 0) fragOwningNodes++;

  // 3. whole-model roots = topmost fragment-owning nodes (spec 5.6.2)
  const roots = [];
  { const st = [rootId]; const vis = new Set();
    while (st.length) {
      const n = st.pop(); if (vis.has(n)) continue; vis.add(n);
      if (own.get(n).length > 0) { roots.push(n); continue; }
      const ch = kids.get(n); for (let i = ch.length - 1; i >= 0; i--) st.push(ch[i]);
    } }
  roots.sort((a, b) => a - b);

  // 4. per-root pre-order walk exactly like extractFragments (own fragments first, then children),
  //    first-discovery-wins across the whole call (roots in ascending order)
  const treeOwner = new Map();          // fragId -> node that FIRST produced it
  const rootInfo = [];
  let rediscoveries = 0, rediscoveryOwnerDiffers = 0, fragmentsUnderMultipleRoots = 0;
  const winnerRoot = new Map();
  const walkRoot = (r) => {
    const frags = new Set(); const owners = new Set(); let discoveries = 0, subtreeNodes = 0, fragOwningInSubtree = 0;
    const st = [r];
    while (st.length) {
      const n = st.pop(); subtreeNodes++;
      const ofr = own.get(n); if (ofr.length > 0) fragOwningInSubtree++;
      for (const f of ofr) {
        discoveries++;
        if (!treeOwner.has(f)) { treeOwner.set(f, n); winnerRoot.set(f, r); }
        else {
          rediscoveries++;
          if (treeOwner.get(f) !== n) rediscoveryOwnerDiffers++;
          if (winnerRoot.get(f) !== r) fragmentsUnderMultipleRoots++;
        }
        frags.add(f);
      }
      const ch = kids.get(n); for (let i = ch.length - 1; i >= 0; i--) st.push(ch[i]);
    }
    return { frags, discoveries, subtreeNodes, fragOwningInSubtree };
  };
  const rootWalks = new Map();
  for (const r of roots) rootWalks.set(r, walkRoot(r));
  // per-root owner sets (tree rule: first-discovery owner; fragList rule over the same fragment set)
  const roots_ = [];
  let rootsWithFragOwningDescendants = 0, rootsWithMultipleOwners = 0, rootOwnerSetMismatch = 0, rootFragCountMismatch = 0;
  const firstRootsWithDesc = [];
  let maxRootFragCount = 0, maxFragOwnersInRoot = 0;
  for (const r of roots) {
    const w = rootWalks.get(r);
    const tOwners = new Set(); const lOwners = new Set(); let lUnresolved = 0;
    for (const f of w.frags) {
      tOwners.add(treeOwner.get(f));
      if (cls[f] === 'L') lOwners.add(flOwner[f]); else lUnresolved++;
    }
    const tArr = [...tOwners].sort((a, b) => a - b), lArr = [...lOwners].sort((a, b) => a - b);
    const same = tArr.length === lArr.length && tArr.every((v, i) => v === lArr[i]);
    if (!same) rootOwnerSetMismatch++;
    if (w.frags.size !== w.discoveries) rootFragCountMismatch++;
    if (w.fragOwningInSubtree > 1) { rootsWithFragOwningDescendants++; if (firstRootsWithDesc.length < 20) firstRootsWithDesc.push({ rootDbId: r, rootOwnsFragments: own.get(r).length > 0, fragOwningNodes: w.fragOwningInSubtree, distinctTreeOwners: tArr.length, owners: tArr, fragmentCount: w.frags.size }); }
    if (tArr.length >= 2) rootsWithMultipleOwners++;
    maxRootFragCount = Math.max(maxRootFragCount, w.frags.size);
    maxFragOwnersInRoot = Math.max(maxFragOwnersInRoot, tArr.length);
    roots_.push({ rootDbId: r, fragmentCount: w.frags.size, distinctOwners: tArr.length, treeOwnerSetEqualsFragListOwnerSet: same, unresolvedInSubtree: lUnresolved });
  }

  // 5. ownerMismatch (spec 6.2): tree-owner vs fragList.getDbIds, every tree-reachable fragment
  let mismatchNumeric = 0, treeReachableN = 0, treeReachableU = 0; const mismatchFirst20 = []; const nuFirst20 = [];
  for (const [f, tOwn] of treeOwner) {
    if (cls[f] === 'L') { if (flOwner[f] !== tOwn) { mismatchNumeric++; if (mismatchFirst20.length < 20) mismatchFirst20.push({ fragId: f, treeOwner: tOwn, fragListOwner: flOwner[f] }); } }
    else { if (cls[f] === 'N') treeReachableN++; else treeReachableU++; if (nuFirst20.length < 20) nuFirst20.push({ fragId: f, treeOwner: tOwn, cls: cls[f] }); }
  }

  // 6. unreachable population (loaded, owner-resolvable fragments in NO root subtree) + unattributable
  let unreachableCount = 0, unattrN = 0, unattrU = 0; const unreachableOwners = new Set(); const unreachOwnerFirst = [];
  for (let f = 0; f < count; f++) {
    if (treeOwner.has(f)) continue;
    if (cls[f] === 'L') { unreachableCount++; unreachableOwners.add(flOwner[f]); }
    else if (cls[f] === 'N') unattrN++; else unattrU++;
  }
  const rootOwnerUnion = new Set(); for (const [f, o] of treeOwner) rootOwnerUnion.add(o);
  const mixed = [...unreachableOwners].filter((o) => rootOwnerUnion.has(o)).sort((a, b) => a - b);

  // 7. library differential (the library's own exported extraction functions; test-only use)
  const lib = {};
  try {
    const { extractAllFragments, extractFragments } = await import('/collision/viewer/ViewerModelAdapter.js');
    const ea = await extractAllFragments(model, 0, { checkpoint: undefined, THREE: window.THREE });
    let recOwnerDiff = 0; for (const [f, rec] of ea.records) if (flOwner[f] !== rec.ownerDbId) recOwnerDiff++;
    const diagByReason = {}; for (const d of ea.diagnostics) diagByReason[d.reason] = (diagByReason[d.reason] || 0) + 1;
    lib.extractAllFragments = { records: ea.records.size, diagnostics: ea.diagnostics.length, diagByReason, recordsOwnerDiffersFromFragList: recOwnerDiff, expectedRecords: cnt.L, expectedDiagnostics: cnt.N + cnt.Uundefined + cnt.Uarray + cnt.Uother };
  } catch (e) { lib.extractAllFragments = { threw: String(e && e.name || e), message: String(e && e.message || e) }; }
  try {
    const { extractFragments } = await import('/collision/viewer/ViewerModelAdapter.js');
    // (a) all whole-model roots in ONE call (as the planner would resolve A_m or B_m == whole)
    try {
      const ef = await extractFragments(model, roots, 0, { checkpoint: undefined, THREE: window.THREE });
      let ownerDiffTree = 0, missing = 0; for (const [f, o] of treeOwner) { const r = ef.get(f); if (!r) missing++; else if (r.ownerDbId !== o) ownerDiffTree++; }
      lib.extractFragmentsAllRoots = { records: ef.size, treeOwnerMapSize: treeOwner.size, missingVsProbe: missing, ownerDiffersFromProbeTreeOwner: ownerDiffTree, extraVsProbe: ef.size - (treeOwner.size - missing) };
    } catch (e) { lib.extractFragmentsAllRoots = { threw: String(e && e.name || e), message: String(e && e.message || e), limit: e && e.limit, requestedDbId: e && e.requestedDbId, node: e && e.node, observedCount: e && e.observedCount }; }
    // (b) per root, individually (per-requested-dbId ceilings apply per root)
    const perRootThrows = []; let perRootOk = 0;
    for (const r of roots) {
      try { await extractFragments(model, [r], 0, { checkpoint: undefined, THREE: window.THREE }); perRootOk++; }
      catch (e) { perRootThrows.push({ rootDbId: r, name: String(e && e.name || e), limit: e && e.limit, observedCount: e && e.observedCount }); }
    }
    lib.extractFragmentsPerRoot = { rootsTried: roots.length, ok: perRootOk, threw: perRootThrows.length, throws: perRootThrows.slice(0, 20) };
    // (c) explicit roots requested by the fixture (source rule), library vs probe (fragList) view
    lib.explicit = [];
    for (const dbId of explicit) {
      const rec = { dbId };
      try {
        const ef = await extractFragments(model, [dbId], 0, { checkpoint: undefined, THREE: window.THREE });
        const owners = new Set(); let flDiff = 0; let unres = 0;
        for (const [f, r] of ef) { owners.add(r.ownerDbId); if (cls[f] === 'L') { if (flOwner[f] !== r.ownerDbId) flDiff++; } else unres++; }
        rec.libraryFragments = ef.size; rec.libraryDistinctOwners = [...owners].sort((a, b) => a - b); rec.ownerDiffersFromFragList = flDiff; rec.unresolvedByFragList = unres;
      } catch (e) { rec.threw = String(e && e.name || e); }
      lib.explicit.push(rec);
    }
  } catch (e) { lib.importFailed = String(e); }

  return {
    which, fragListCount: count, populationClasses: cnt,
    tree: { rootId, nodeCount, fragOwningNodes, cyclesOrRevisits: cycles },
    wholeModelRoots: { count: roots.length, sumFragmentCount: roots_.reduce((a, r) => a + r.fragmentCount, 0), maxRootFragmentCount: maxRootFragCount, maxDistinctOwnersInRoot: maxFragOwnersInRoot, rootsWithMultipleFragOwningNodes: rootsWithFragOwningDescendants, rootsWithMultipleDistinctOwners: rootsWithMultipleOwners, examples: firstRootsWithDesc },
    treeWalk: { treeReachableFragments: treeOwner.size, rediscoveries, rediscoveryOwnerDiffers, fragmentsUnderMultipleRoots },
    ownerMismatch: { count: mismatchNumeric, strictCountIncludingTreeReachableNU: mismatchNumeric + treeReachableN + treeReachableU, first20: mismatchFirst20, treeReachableNotLoaded: treeReachableN, treeReachableOwnerUnresolvable: treeReachableU, treeReachableNUFirst20: nuFirst20 },
    sourceSideRootMapping: { rootsCompared: roots.length, rootOwnerSetMismatches: rootOwnerSetMismatch, rootFragmentCountVsDiscoveryMismatches: rootFragCountMismatch },
    unreachable: { count: unreachableCount, ownerDbIdsCount: unreachableOwners.size, unattributable: { notLoaded: unattrN, ownerUnresolvable: unattrU } },
    mixedOwnerDbIds: { count: mixed.length, first20: mixed.slice(0, 20) },
    reconciliation: { populationCount: count, treeReachable: treeOwner.size, unreachable: unreachableCount, unattributableUnreachable: unattrN + unattrU, sumEqualsPopulation: treeOwner.size + unreachableCount + unattrN + unattrU === count },
    library: lib,
    measureMs: Math.round(performance.now() - t0),
  };
};

async function main() {
  const t0 = Date.now();
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote'], proxy: resolveProxyFromEnv() });
  const page = await browser.newPage({ viewport: { width: 1280, height: 2000 } });
  const consoleErrors = []; const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  const timeline = [];
  const sample = async (label) => {
    const s = await page.evaluate(() => {
      const ms = window.viewer ? window.viewer.getAllModels() : [];
      return { models: ms.length, loadDone: ms.map((m) => m.isLoadDone()), tree: ms.map((m) => !!(m.getData() && m.getData().instanceTree)), events: window.__events || [] };
    });
    timeline.push({ label, tMs: Date.now() - t0, ...s });
    return s;
  };
  const installEvents = () => page.evaluate(() => {
    window.__events = window.__events || [];
    if (window.__eventsInstalled) return; window.__eventsInstalled = true;
    const V = window.Autodesk.Viewing;
    window.__ready = {}; window.__snaps = [];
    const snap = (name, model) => {
      const urn = model.getData().urn; const fl = model.getFragmentList(); const it = model.getData().instanceTree;
      const out = { name, urn, t: performance.now(), isLoadDone: model.isLoadDone(), fragListCount: fl.getCount(), notLoaded: 0, tree: !!it };
      for (let f = 0; f < out.fragListCount; f++) if (fl.isNotLoaded(f)) out.notLoaded++;
      if (it) {
        const seen = new Set(); const st = [it.getRootId()]; const frs = new Set(); let ownSum = 0;
        while (st.length) { const n = st.pop(); if (seen.has(n)) continue; seen.add(n);
          it.enumNodeFragments(n, (f) => { ownSum++; frs.add(f); }, false);
          it.enumNodeChildren(n, (c) => { st.push(c); return false; }, false); }
        out.nodeCount = seen.size; out.ownFragmentCallbacks = ownSum; out.distinctTreeFragments = frs.size;
      }
      window.__snaps.push(out);
    };
    setInterval(() => {
      for (const m of window.viewer.getAllModels()) {
        const u = m.getData() && m.getData().urn; if (!u) continue;
        const r = (window.__ready[u] = window.__ready[u] || { firstSeen: performance.now() });
        const done = m.isLoadDone(), tree = !!(m.getData() && m.getData().instanceTree), otc = typeof m.isObjectTreeCreated === 'function' ? m.isObjectTreeCreated() : null;
        if (done && r.loadDone === undefined) r.loadDone = performance.now();
        if (tree && r.instanceTreeInData === undefined) r.instanceTreeInData = performance.now();
        if (otc && r.isObjectTreeCreated === undefined) r.isObjectTreeCreated = performance.now();
      }
    }, 5);
    for (const name of ['OBJECT_TREE_CREATED_EVENT', 'GEOMETRY_LOADED_EVENT', 'MODEL_ADDED_EVENT']) {
      if (!V[name]) { window.__events.push({ name, missing: true }); continue; }
      window.viewer.addEventListener(V[name], (ev) => {
        window.__events.push({ name, t: performance.now(), hasModel: !!(ev && ev.model), urn: ev && ev.model && ev.model.getData && ev.model.getData().urn });
        if ((name === 'OBJECT_TREE_CREATED_EVENT' || name === 'GEOMETRY_LOADED_EVENT') && ev && ev.model) { try { snap(name, ev.model); } catch (e) { window.__snaps.push({ name, error: String(e) }); } }
      });
    }
  });

  console.log(`[${RUN}] model 1 (Architecture)`);
  await page.goto(`${BASE_URL}/#${URN_ARCH}`);
  await page.waitForFunction(() => window.viewer && window.viewer.getAllModels, null, { timeout: 120_000 });
  await installEvents();
  await sample('viewer-present');
  await page.waitForFunction(() => window.viewer.model && window.viewer.model.isLoadDone(), null, { timeout: 180_000 });
  await sample('m1-loadDone');
  console.log(`[${RUN}] model 2 (Structure)`);
  await page.fill('#urn', URN_STRUCT); await page.check('#keep-current-models'); await page.click('#load');
  await page.waitForFunction(() => window.viewer.getAllModels().length === 2 && window.viewer.getAllModels().every((m) => m.isLoadDone()), null, { timeout: 180_000 });
  await sample('m2-loadDone');
  console.log(`[${RUN}] model 3 (Mechanical)`);
  await page.fill('#urn', URN_MECH); await page.check('#keep-current-models'); await page.click('#load');
  await page.waitForFunction(() => window.viewer.getAllModels().length === 3 && window.viewer.getAllModels().every((m) => m.isLoadDone()), null, { timeout: 180_000 });
  await sample('m3-loadDone');
  // tree-readiness: poll until every model has its instance tree (records how long isLoadDone() alone was insufficient)
  let polls = 0; let s;
  do { s = await sample(`tree-poll-${polls}`); if (s.tree.every(Boolean)) break; await page.waitForTimeout(50); polls++; } while (polls < 400);
  const readinessSignals = await page.evaluate(({ urns }) => {
    const ms = window.viewer.getAllModels();
    return ms.map((m) => {
      const out = { urn: m.getData().urn, isLoadDone: m.isLoadDone(), hasInstanceTreeInData: !!m.getData().instanceTree,
        hasGetObjectTree: typeof m.getObjectTree === 'function', hasIsObjectTreeCreated: typeof m.isObjectTreeCreated === 'function' };
      try { out.isObjectTreeCreated = typeof m.isObjectTreeCreated === 'function' ? m.isObjectTreeCreated() : null; } catch (e) { out.isObjectTreeCreatedThrew = String(e); }
      try { const t = m.getObjectTree(); out.getObjectTreeSyncReturnsTree = !!t; } catch (e) { out.getObjectTreeThrew = String(e); }
      try { const t = m.getInstanceTree ? m.getInstanceTree() : undefined; out.getInstanceTreeReturnsTree = !!t; } catch (e) { out.getInstanceTreeThrew = String(e); }
      return out;
    });
  }, { urns: [] });
  const events = await page.evaluate(() => window.__events);
  const fineReadiness = await page.evaluate(() => window.__ready);
  const eventSnapshots = await page.evaluate(() => window.__snaps);

  await page.evaluate(({ a, s, m }) => {
    const ms = window.viewer.getAllModels();
    window.__probe = { arch: ms.find((x) => x.getData().urn === a), struct: ms.find((x) => x.getData().urn === s), mech: ms.find((x) => x.getData().urn === m) };
  }, { a: URN_ARCH, s: URN_STRUCT, m: URN_MECH });

  const env = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    viewerScripts: [...document.scripts].map((x) => x.src).filter((x) => /viewer3D/.test(x)),
    viewerVersion: (window.Autodesk && window.Autodesk.Viewing && (window.Autodesk.Viewing.getVersion ? window.Autodesk.Viewing.getVersion() : window.Autodesk.Viewing.Private && window.Autodesk.Viewing.Private.LMV_VIEWER_VERSION)) || null,
    threeRevision: window.THREE && window.THREE.REVISION,
    modelNames: window.viewer.getAllModels().map((m) => ({ urn: m.getData().urn, loadOptions: m.getData().loadOptions ? Object.keys(m.getData().loadOptions) : null, isOTG: typeof m.isOTG === 'function' ? m.isOTG() : null, is3d: typeof m.is3d === 'function' ? m.is3d() : null })),
  }));

  const explicitStruct = [2734, 3965];
  const results = {};
  for (const [which, explicit] of [['arch', []], ['struct', explicitStruct], ['mech', []]]) {
    results[which] = await page.evaluate(MEASURE, { which, explicit });
    console.log(`[${RUN}] ${which}: fragList=${results[which].fragListCount} roots=${results[which].wholeModelRoots.count} mismatch=${results[which].ownerMismatch.count} unreachable=${results[which].unreachable.count}`);
  }
  // stability: measure a second time after 5 s idle, same session
  await page.waitForTimeout(5000);
  const second = {};
  for (const [which, explicit] of [['arch', []], ['struct', explicitStruct], ['mech', []]]) second[which] = await page.evaluate(MEASURE, { which, explicit });
  const stripT = (o) => { const c = JSON.parse(JSON.stringify(o)); delete c.measureMs; return JSON.stringify(c); };
  const stableInSession = Object.fromEntries(['arch', 'struct', 'mech'].map((k) => [k, stripT(results[k]) === stripT(second[k])]));

  // sensitivity controls (negative controls for the probe itself): temporarily perturb ONE in-page accessor,
  // re-measure the Structure model, restore. Proves the probe would have reported a violation.
  const controls = {};
  controls.ownerPerturbed = await page.evaluate(async (MEASURE_SRC) => {
    const M = eval(MEASURE_SRC); const model = window.__probe.struct; const fl = model.getFragmentList();
    const orig = fl.getDbIds; fl.getDbIds = function (f) { const o = orig.call(this, f); return f === 0 && typeof o === 'number' ? o + 1000000 : o; };
    try { const r = await M({ which: 'struct', explicit: [] }); return { ownerMismatchCount: r.ownerMismatch.count, first: r.ownerMismatch.first20, rootOwnerSetMismatches: r.sourceSideRootMapping.rootOwnerSetMismatches }; }
    finally { delete fl.getDbIds; }
  }, MEASURE.toString());
  controls.fragmentHiddenFromTree = await page.evaluate(async (MEASURE_SRC) => {
    const M = eval(MEASURE_SRC); const model = window.__probe.struct; const it = model.getData().instanceTree;
    const orig = it.enumNodeFragments; it.enumNodeFragments = function (n, cb, rec) { return orig.call(this, n, (f) => { if (f !== 1) return cb(f); }, rec); };
    try { const r = await M({ which: 'struct', explicit: [] }); return { unreachableCount: r.unreachable.count, treeReachable: r.reconciliation.treeReachable, sumEqualsPopulation: r.reconciliation.sumEqualsPopulation, ownerMismatch: r.ownerMismatch.count }; }
    finally { delete it.enumNodeFragments; }
  }, MEASURE.toString());
  controls.notLoadedPerturbed = await page.evaluate(async (MEASURE_SRC) => {
    const M = eval(MEASURE_SRC); const model = window.__probe.struct; const fl = model.getFragmentList();
    const orig = fl.isNotLoaded; fl.isNotLoaded = function (f) { return f === 2 ? true : orig.call(this, f); };
    try { const r = await M({ which: 'struct', explicit: [] }); return { populationN: r.populationClasses.N, treeReachableNotLoaded: r.ownerMismatch.treeReachableNotLoaded, ownerMismatchNumeric: r.ownerMismatch.count, ownerMismatchStrict: r.ownerMismatch.strictCountIncludingTreeReachableNU }; }
    finally { delete fl.isNotLoaded; }
  }, MEASURE.toString());
  controls.duplicateDiscovery = await page.evaluate(async (MEASURE_SRC) => {
    const M = eval(MEASURE_SRC); const model = window.__probe.struct; const it = model.getData().instanceTree; const fl = model.getFragmentList();
    const o0 = fl.getDbIds(0); let victim = -1; for (let f = 1; f < fl.getCount(); f++) if (fl.getDbIds(f) !== o0) { victim = f; break; }
    if (victim < 0) return { skipped: 'no fragment with a different owner' };
    const orig = it.enumNodeFragments; it.enumNodeFragments = function (n, cb, rec) { const r = orig.call(this, n, cb, rec); if (n === o0) cb(victim); return r; };
    try { const r = await M({ which: 'struct', explicit: [] }); return { victimFragment: victim, rediscoveries: r.treeWalk.rediscoveries, rediscoveryOwnerDiffers: r.treeWalk.rediscoveryOwnerDiffers, fragmentsUnderMultipleRoots: r.treeWalk.fragmentsUnderMultipleRoots, ownerMismatch: r.ownerMismatch.count }; }
    finally { delete it.enumNodeFragments; }
  }, MEASURE.toString());
  controls.afterRestoreClean = await page.evaluate(async (MEASURE_SRC) => { const r = await eval(MEASURE_SRC)({ which: 'struct', explicit: [] }); return { ownerMismatch: r.ownerMismatch.count, unreachable: r.unreachable.count }; }, MEASURE.toString());

  const finalByUrn = { [URN_ARCH]: results.arch, [URN_STRUCT]: results.struct, [URN_MECH]: results.mech };
  const snapshotVsFinal = eventSnapshots.map((sn) => { const f = finalByUrn[sn.urn]; return f ? { event: sn.name, model: Buffer.from(sn.urn, 'base64').toString().split('/').pop(), isLoadDoneAtEvent: sn.isLoadDone, treeAtEvent: sn.tree, nodeCountEqualsFinal: sn.nodeCount === f.tree.nodeCount, distinctTreeFragmentsEqualsFinal: sn.distinctTreeFragments === f.treeWalk.treeReachableFragments, fragListCountEqualsFinal: sn.fragListCount === f.fragListCount, notLoadedAtEvent: sn.notLoaded, notLoadedFinal: f.populationClasses.N } : { event: sn.name, unmatched: true }; });
  const browserVersion = browser.version();
  await browser.close();
  const gitHead = execSync(`git -C ${REPO} rev-parse HEAD`).toString().trim();
  const out = {
    run: RUN, startedAtUtc: new Date(t0).toISOString(), durationMs: Date.now() - t0,
    host: { node: process.version, os: `${os.type()} ${os.release()} ${os.arch()}`, chromium: browserVersion, playwright: require('playwright/package.json').version, gitHead, baseUrl: BASE_URL },
    fixtureUrns: { arch: URN_ARCH, struct: URN_STRUCT, mech: URN_MECH, decoded: { arch: Buffer.from(URN_ARCH, 'base64').toString(), struct: Buffer.from(URN_STRUCT, 'base64').toString(), mech: Buffer.from(URN_MECH, 'base64').toString() } },
    env, readinessSignals, fineReadiness, events, eventSnapshots, timeline: timeline.filter((t) => !t.label.startsWith('tree-poll-') || t.label === 'tree-poll-0' || t.tree.every(Boolean)),
    treePollsBeforeAllTreesPresent: polls,
    results, stableInSession, controls, snapshotVsFinal, consoleErrors, pageErrors,
  };
  await writeFile(OUT, JSON.stringify(out, null, 2));
  console.log(`[${RUN}] wrote ${OUT}`);
}
main().catch((e) => { console.error('PROBE FAILED', e); process.exit(1); });

```

## Appendix B — raw evidence

### B.1 Measurements (identical in both sessions; wall-clock `measureMs` omitted)

```json
{
 "measurementsIdenticalInBothSessions": true,
 "results": {
  "arch": {"which":"arch","fragListCount":5435,"populationClasses":{"N":0,"Uundefined":0,"Uarray":0,"Uother":0,"L":5435},"tree":{"rootId":1,"nodeCount":4747,"fragOwningNodes":4259,"cyclesOrRevisits":0},"wholeModelRoots":{"count":4244,"sumFragmentCount":5435,"maxRootFragmentCount":14,"maxDistinctOwnersInRoot":7,"rootsWithMultipleFragOwningNodes":4,"rootsWithMultipleDistinctOwners":4,"examples":[{"rootDbId":5207,"rootOwnsFragments":true,"fragOwningNodes":2,"distinctTreeOwners":2,"owners":[5207,5211],"fragmentCount":2},{"rootDbId":8097,"rootOwnsFragments":true,"fragOwningNodes":5,"distinctTreeOwners":5,"owners":[8097,8101,8102,8103,8104],"fragmentCount":10},{"rootDbId":8138,"rootOwnsFragments":true,"fragOwningNodes":5,"distinctTreeOwners":5,"owners":[8138,8139,8140,8141,8142],"fragmentCount":10},{"rootDbId":8437,"rootOwnsFragments":true,"fragOwningNodes":7,"distinctTreeOwners":7,"owners":[8437,8438,8439,8440,8441,8442,8443],"fragmentCount":14}]},"treeWalk":{"treeReachableFragments":5435,"rediscoveries":0,"rediscoveryOwnerDiffers":0,"fragmentsUnderMultipleRoots":0},"ownerMismatch":{"count":0,"strictCountIncludingTreeReachableNU":0,"first20":[],"treeReachableNotLoaded":0,"treeReachableOwnerUnresolvable":0,"treeReachableNUFirst20":[]},"sourceSideRootMapping":{"rootsCompared":4244,"rootOwnerSetMismatches":0,"rootFragmentCountVsDiscoveryMismatches":0},"unreachable":{"count":0,"ownerDbIdsCount":0,"unattributable":{"notLoaded":0,"ownerUnresolvable":0}},"mixedOwnerDbIds":{"count":0,"first20":[]},"reconciliation":{"populationCount":5435,"treeReachable":5435,"unreachable":0,"unattributableUnreachable":0,"sumEqualsPopulation":true},"library":{"extractAllFragments":{"records":5435,"diagnostics":0,"diagByReason":{},"recordsOwnerDiffersFromFragList":0,"expectedRecords":5435,"expectedDiagnostics":0},"extractFragmentsAllRoots":{"records":5435,"treeOwnerMapSize":5435,"missingVsProbe":0,"ownerDiffersFromProbeTreeOwner":0,"extraVsProbe":0},"extractFragmentsPerRoot":{"rootsTried":4244,"ok":4244,"threw":0,"throws":[]},"explicit":[]}},
  "struct": {"which":"struct","fragListCount":543,"populationClasses":{"N":0,"Uundefined":0,"Uarray":0,"Uother":0,"L":543},"tree":{"rootId":1,"nodeCount":547,"fragOwningNodes":468,"cyclesOrRevisits":0},"wholeModelRoots":{"count":468,"sumFragmentCount":543,"maxRootFragmentCount":3,"maxDistinctOwnersInRoot":1,"rootsWithMultipleFragOwningNodes":0,"rootsWithMultipleDistinctOwners":0,"examples":[]},"treeWalk":{"treeReachableFragments":543,"rediscoveries":0,"rediscoveryOwnerDiffers":0,"fragmentsUnderMultipleRoots":0},"ownerMismatch":{"count":0,"strictCountIncludingTreeReachableNU":0,"first20":[],"treeReachableNotLoaded":0,"treeReachableOwnerUnresolvable":0,"treeReachableNUFirst20":[]},"sourceSideRootMapping":{"rootsCompared":468,"rootOwnerSetMismatches":0,"rootFragmentCountVsDiscoveryMismatches":0},"unreachable":{"count":0,"ownerDbIdsCount":0,"unattributable":{"notLoaded":0,"ownerUnresolvable":0}},"mixedOwnerDbIds":{"count":0,"first20":[]},"reconciliation":{"populationCount":543,"treeReachable":543,"unreachable":0,"unattributableUnreachable":0,"sumEqualsPopulation":true},"library":{"extractAllFragments":{"records":543,"diagnostics":0,"diagByReason":{},"recordsOwnerDiffersFromFragList":0,"expectedRecords":543,"expectedDiagnostics":0},"extractFragmentsAllRoots":{"records":543,"treeOwnerMapSize":543,"missingVsProbe":0,"ownerDiffersFromProbeTreeOwner":0,"extraVsProbe":0},"extractFragmentsPerRoot":{"rootsTried":468,"ok":468,"threw":0,"throws":[]},"explicit":[{"dbId":2734,"libraryFragments":1,"libraryDistinctOwners":[2734],"ownerDiffersFromFragList":0,"unresolvedByFragList":0},{"dbId":3965,"libraryFragments":1,"libraryDistinctOwners":[3965],"ownerDiffersFromFragList":0,"unresolvedByFragList":0}]}},
  "mech": {"which":"mech","fragListCount":1496,"populationClasses":{"N":0,"Uundefined":0,"Uarray":0,"Uother":0,"L":1496},"tree":{"rootId":1,"nodeCount":1366,"fragOwningNodes":1257,"cyclesOrRevisits":0},"wholeModelRoots":{"count":1257,"sumFragmentCount":1496,"maxRootFragmentCount":2,"maxDistinctOwnersInRoot":1,"rootsWithMultipleFragOwningNodes":0,"rootsWithMultipleDistinctOwners":0,"examples":[]},"treeWalk":{"treeReachableFragments":1496,"rediscoveries":0,"rediscoveryOwnerDiffers":0,"fragmentsUnderMultipleRoots":0},"ownerMismatch":{"count":0,"strictCountIncludingTreeReachableNU":0,"first20":[],"treeReachableNotLoaded":0,"treeReachableOwnerUnresolvable":0,"treeReachableNUFirst20":[]},"sourceSideRootMapping":{"rootsCompared":1257,"rootOwnerSetMismatches":0,"rootFragmentCountVsDiscoveryMismatches":0},"unreachable":{"count":0,"ownerDbIdsCount":0,"unattributable":{"notLoaded":0,"ownerUnresolvable":0}},"mixedOwnerDbIds":{"count":0,"first20":[]},"reconciliation":{"populationCount":1496,"treeReachable":1496,"unreachable":0,"unattributableUnreachable":0,"sumEqualsPopulation":true},"library":{"extractAllFragments":{"records":1496,"diagnostics":0,"diagByReason":{},"recordsOwnerDiffersFromFragList":0,"expectedRecords":1496,"expectedDiagnostics":0},"extractFragmentsAllRoots":{"records":1496,"treeOwnerMapSize":1496,"missingVsProbe":0,"ownerDiffersFromProbeTreeOwner":0,"extraVsProbe":0},"extractFragmentsPerRoot":{"rootsTried":1257,"ok":1257,"threw":0,"throws":[]},"explicit":[]}}
 }
}
```

### B.2 Run metadata, controls, readiness timelines (ms on the page clock; per run)

```json
{
 "run1": {
  "startedAtUtc": "2026-09-25T12:25:11.118Z",
  "durationMs": 34859,
  "controls": {
   "ownerPerturbed": {
    "ownerMismatchCount": 1,
    "first": [
     {
      "fragId": 0,
      "treeOwner": 3663,
      "fragListOwner": 1003663
     }
    ],
    "rootOwnerSetMismatches": 1
   },
   "fragmentHiddenFromTree": {
    "unreachableCount": 1,
    "treeReachable": 542,
    "sumEqualsPopulation": true,
    "ownerMismatch": 0
   },
   "notLoadedPerturbed": {
    "populationN": 1,
    "treeReachableNotLoaded": 1,
    "ownerMismatchNumeric": 0,
    "ownerMismatchStrict": 1
   },
   "duplicateDiscovery": {
    "victimFragment": 2,
    "rediscoveries": 1,
    "rediscoveryOwnerDiffers": 1,
    "fragmentsUnderMultipleRoots": 1,
    "ownerMismatch": 1
   },
   "afterRestoreClean": {
    "ownerMismatch": 0,
    "unreachable": 0
   }
  },
  "stableInSession": {
   "arch": true,
   "struct": true,
   "mech": true
  },
  "snapshotVsFinal": [
   {
    "event": "OBJECT_TREE_CREATED_EVENT",
    "model": "Audubon_Architecture_clash_test.rvt",
    "isLoadDoneAtEvent": false,
    "treeAtEvent": true,
    "nodeCountEqualsFinal": true,
    "distinctTreeFragmentsEqualsFinal": true,
    "fragListCountEqualsFinal": true,
    "notLoadedAtEvent": 0,
    "notLoadedFinal": 0
   },
   {
    "event": "GEOMETRY_LOADED_EVENT",
    "model": "Audubon_Architecture_clash_test.rvt",
    "isLoadDoneAtEvent": true,
    "treeAtEvent": true,
    "nodeCountEqualsFinal": true,
    "distinctTreeFragmentsEqualsFinal": true,
    "fragListCountEqualsFinal": true,
    "notLoadedAtEvent": 0,
    "notLoadedFinal": 0
   },
   {
    "event": "OBJECT_TREE_CREATED_EVENT",
    "model": "Audubon_Structure_clash_test.rvt",
    "isLoadDoneAtEvent": false,
    "treeAtEvent": true,
    "nodeCountEqualsFinal": true,
    "distinctTreeFragmentsEqualsFinal": true,
    "fragListCountEqualsFinal": true,
    "notLoadedAtEvent": 0,
    "notLoadedFinal": 0
   },
   {
    "event": "GEOMETRY_LOADED_EVENT",
    "model": "Audubon_Structure_clash_test.rvt",
    "isLoadDoneAtEvent": true,
    "treeAtEvent": true,
    "nodeCountEqualsFinal": true,
    "distinctTreeFragmentsEqualsFinal": true,
    "fragListCountEqualsFinal": true,
    "notLoadedAtEvent": 0,
    "notLoadedFinal": 0
   },
   {
    "event": "OBJECT_TREE_CREATED_EVENT",
    "model": "Audubon_Mechanical_clash_test.rvt",
    "isLoadDoneAtEvent": false,
    "treeAtEvent": true,
    "nodeCountEqualsFinal": true,
    "distinctTreeFragmentsEqualsFinal": true,
    "fragListCountEqualsFinal": true,
    "notLoadedAtEvent": 0,
    "notLoadedFinal": 0
   },
   {
    "event": "GEOMETRY_LOADED_EVENT",
    "model": "Audubon_Mechanical_clash_test.rvt",
    "isLoadDoneAtEvent": true,
    "treeAtEvent": true,
    "nodeCountEqualsFinal": true,
    "distinctTreeFragmentsEqualsFinal": true,
    "fragListCountEqualsFinal": true,
    "notLoadedAtEvent": 0,
    "notLoadedFinal": 0
   }
  ],
  "eventSnapshots": [
   {
    "name": "OBJECT_TREE_CREATED_EVENT",
    "isLoadDone": false,
    "fragListCount": 5435,
    "notLoaded": 0,
    "tree": true,
    "nodeCount": 4747,
    "ownFragmentCallbacks": 5435,
    "distinctTreeFragments": 5435,
    "model": "rchi"
   },
   {
    "name": "GEOMETRY_LOADED_EVENT",
    "isLoadDone": true,
    "fragListCount": 5435,
    "notLoaded": 0,
    "tree": true,
    "nodeCount": 4747,
    "ownFragmentCallbacks": 5435,
    "distinctTreeFragments": 5435,
    "model": "rchi"
   },
   {
    "name": "OBJECT_TREE_CREATED_EVENT",
    "isLoadDone": false,
    "fragListCount": 543,
    "notLoaded": 0,
    "tree": true,
    "nodeCount": 547,
    "ownFragmentCallbacks": 543,
    "distinctTreeFragments": 543,
    "model": "truc"
   },
   {
    "name": "GEOMETRY_LOADED_EVENT",
    "isLoadDone": true,
    "fragListCount": 543,
    "notLoaded": 0,
    "tree": true,
    "nodeCount": 547,
    "ownFragmentCallbacks": 543,
    "distinctTreeFragments": 543,
    "model": "truc"
   },
   {
    "name": "OBJECT_TREE_CREATED_EVENT",
    "isLoadDone": false,
    "fragListCount": 1496,
    "notLoaded": 0,
    "tree": true,
    "nodeCount": 1366,
    "ownFragmentCallbacks": 1496,
    "distinctTreeFragments": 1496,
    "model": "echa"
   },
   {
    "name": "GEOMETRY_LOADED_EVENT",
    "isLoadDone": true,
    "fragListCount": 1496,
    "notLoaded": 0,
    "tree": true,
    "nodeCount": 1366,
    "ownFragmentCallbacks": 1496,
    "distinctTreeFragments": 1496,
    "model": "echa"
   }
  ],
  "consoleErrors": [],
  "pageErrors": []
 },
 "run2": {
  "startedAtUtc": "2026-09-25T12:25:46.138Z",
  "durationMs": 33821,
  "controls": {
   "ownerPerturbed": {
    "ownerMismatchCount": 1,
    "first": [
     {
      "fragId": 0,
      "treeOwner": 3663,
      "fragListOwner": 1003663
     }
    ],
    "rootOwnerSetMismatches": 1
   },
   "fragmentHiddenFromTree": {
    "unreachableCount": 1,
    "treeReachable": 542,
    "sumEqualsPopulation": true,
    "ownerMismatch": 0
   },
   "notLoadedPerturbed": {
    "populationN": 1,
    "treeReachableNotLoaded": 1,
    "ownerMismatchNumeric": 0,
    "ownerMismatchStrict": 1
   },
   "duplicateDiscovery": {
    "victimFragment": 2,
    "rediscoveries": 1,
    "rediscoveryOwnerDiffers": 1,
    "fragmentsUnderMultipleRoots": 1,
    "ownerMismatch": 1
   },
   "afterRestoreClean": {
    "ownerMismatch": 0,
    "unreachable": 0
   }
  },
  "stableInSession": {
   "arch": true,
   "struct": true,
   "mech": true
  },
  "snapshotVsFinal": [
   {
    "event": "OBJECT_TREE_CREATED_EVENT",
    "model": "Audubon_Architecture_clash_test.rvt",
    "isLoadDoneAtEvent": false,
    "treeAtEvent": true,
    "nodeCountEqualsFinal": true,
    "distinctTreeFragmentsEqualsFinal": true,
    "fragListCountEqualsFinal": true,
    "notLoadedAtEvent": 0,
    "notLoadedFinal": 0
   },
   {
    "event": "GEOMETRY_LOADED_EVENT",
    "model": "Audubon_Architecture_clash_test.rvt",
    "isLoadDoneAtEvent": true,
    "treeAtEvent": true,
    "nodeCountEqualsFinal": true,
    "distinctTreeFragmentsEqualsFinal": true,
    "fragListCountEqualsFinal": true,
    "notLoadedAtEvent": 0,
    "notLoadedFinal": 0
   },
   {
    "event": "OBJECT_TREE_CREATED_EVENT",
    "model": "Audubon_Structure_clash_test.rvt",
    "isLoadDoneAtEvent": false,
    "treeAtEvent": true,
    "nodeCountEqualsFinal": true,
    "distinctTreeFragmentsEqualsFinal": true,
    "fragListCountEqualsFinal": true,
    "notLoadedAtEvent": 0,
    "notLoadedFinal": 0
   },
   {
    "event": "GEOMETRY_LOADED_EVENT",
    "model": "Audubon_Structure_clash_test.rvt",
    "isLoadDoneAtEvent": true,
    "treeAtEvent": true,
    "nodeCountEqualsFinal": true,
    "distinctTreeFragmentsEqualsFinal": true,
    "fragListCountEqualsFinal": true,
    "notLoadedAtEvent": 0,
    "notLoadedFinal": 0
   },
   {
    "event": "OBJECT_TREE_CREATED_EVENT",
    "model": "Audubon_Mechanical_clash_test.rvt",
    "isLoadDoneAtEvent": false,
    "treeAtEvent": true,
    "nodeCountEqualsFinal": true,
    "distinctTreeFragmentsEqualsFinal": true,
    "fragListCountEqualsFinal": true,
    "notLoadedAtEvent": 0,
    "notLoadedFinal": 0
   },
   {
    "event": "GEOMETRY_LOADED_EVENT",
    "model": "Audubon_Mechanical_clash_test.rvt",
    "isLoadDoneAtEvent": true,
    "treeAtEvent": true,
    "nodeCountEqualsFinal": true,
    "distinctTreeFragmentsEqualsFinal": true,
    "fragListCountEqualsFinal": true,
    "notLoadedAtEvent": 0,
    "notLoadedFinal": 0
   }
  ],
  "eventSnapshots": [
   {
    "name": "OBJECT_TREE_CREATED_EVENT",
    "isLoadDone": false,
    "fragListCount": 5435,
    "notLoaded": 0,
    "tree": true,
    "nodeCount": 4747,
    "ownFragmentCallbacks": 5435,
    "distinctTreeFragments": 5435,
    "model": "rchi"
   },
   {
    "name": "GEOMETRY_LOADED_EVENT",
    "isLoadDone": true,
    "fragListCount": 5435,
    "notLoaded": 0,
    "tree": true,
    "nodeCount": 4747,
    "ownFragmentCallbacks": 5435,
    "distinctTreeFragments": 5435,
    "model": "rchi"
   },
   {
    "name": "OBJECT_TREE_CREATED_EVENT",
    "isLoadDone": false,
    "fragListCount": 543,
    "notLoaded": 0,
    "tree": true,
    "nodeCount": 547,
    "ownFragmentCallbacks": 543,
    "distinctTreeFragments": 543,
    "model": "truc"
   },
   {
    "name": "GEOMETRY_LOADED_EVENT",
    "isLoadDone": true,
    "fragListCount": 543,
    "notLoaded": 0,
    "tree": true,
    "nodeCount": 547,
    "ownFragmentCallbacks": 543,
    "distinctTreeFragments": 543,
    "model": "truc"
   },
   {
    "name": "OBJECT_TREE_CREATED_EVENT",
    "isLoadDone": false,
    "fragListCount": 1496,
    "notLoaded": 0,
    "tree": true,
    "nodeCount": 1366,
    "ownFragmentCallbacks": 1496,
    "distinctTreeFragments": 1496,
    "model": "echa"
   },
   {
    "name": "GEOMETRY_LOADED_EVENT",
    "isLoadDone": true,
    "fragListCount": 1496,
    "notLoaded": 0,
    "tree": true,
    "nodeCount": 1366,
    "ownFragmentCallbacks": 1496,
    "distinctTreeFragments": 1496,
    "model": "echa"
   }
  ],
  "consoleErrors": [],
  "pageErrors": []
 },
 "host": {
  "node": "v22.23.1",
  "os": "Darwin 27.0.0 arm64",
  "chromium": "151.0.7922.34",
  "playwright": "1.62.1",
  "gitHead": "8f1da13eb6014a0f16b2e915ba6f6768d79eadad",
  "baseUrl": "http://localhost:8080"
 },
 "viewerScripts": [
  "https://developer.api.autodesk.com/modelderivative/v2/viewers/7.124.2/viewer3D.js"
 ],
 "threeRevision": "71",
 "modelFlags": [
  {
   "file": "Audubon_Architecture_clash_test.rvt",
   "isOTG": false,
   "is3d": true
  },
  {
   "file": "Audubon_Structure_clash_test.rvt",
   "isOTG": false,
   "is3d": true
  },
  {
   "file": "Audubon_Mechanical_clash_test.rvt",
   "isOTG": false,
   "is3d": true
  }
 ],
 "readinessSignalsPerModel": [
  {
   "file": "Audubon_Architecture_clash_test.rvt",
   "isLoadDone": true,
   "hasInstanceTreeInData": true,
   "hasGetObjectTree": true,
   "hasIsObjectTreeCreated": true,
   "isObjectTreeCreated": true,
   "getObjectTreeSyncReturnsTree": true,
   "getInstanceTreeReturnsTree": true
  },
  {
   "file": "Audubon_Structure_clash_test.rvt",
   "isLoadDone": true,
   "hasInstanceTreeInData": true,
   "hasGetObjectTree": true,
   "hasIsObjectTreeCreated": true,
   "isObjectTreeCreated": true,
   "getObjectTreeSyncReturnsTree": true,
   "getInstanceTreeReturnsTree": true
  },
  {
   "file": "Audubon_Mechanical_clash_test.rvt",
   "isLoadDone": true,
   "hasInstanceTreeInData": true,
   "hasGetObjectTree": true,
   "hasIsObjectTreeCreated": true,
   "isObjectTreeCreated": true,
   "getObjectTreeSyncReturnsTree": true,
   "getInstanceTreeReturnsTree": true
  }
 ],
 "fineReadinessMsRelativeToPageClock": {
  "run1": {
   "Audubon_Architecture_clash_test.rvt": {
    "firstSeen": 10988,
    "loadDone": 12915,
    "instanceTreeInData": 12915,
    "isObjectTreeCreated": 12915
   },
   "Audubon_Structure_clash_test.rvt": {
    "firstSeen": 17470,
    "instanceTreeInData": 20020,
    "isObjectTreeCreated": 20020,
    "loadDone": 23978
   },
   "Audubon_Mechanical_clash_test.rvt": {
    "firstSeen": 27131,
    "instanceTreeInData": 28113,
    "isObjectTreeCreated": 28113,
    "loadDone": 28840
   }
  },
  "run2": {
   "Audubon_Architecture_clash_test.rvt": {
    "firstSeen": 9124,
    "instanceTreeInData": 10820,
    "isObjectTreeCreated": 10820,
    "loadDone": 11653
   },
   "Audubon_Structure_clash_test.rvt": {
    "firstSeen": 16261,
    "instanceTreeInData": 18152,
    "isObjectTreeCreated": 18152,
    "loadDone": 22883
   },
   "Audubon_Mechanical_clash_test.rvt": {
    "firstSeen": 26198,
    "instanceTreeInData": 27246,
    "isObjectTreeCreated": 27246,
    "loadDone": 28088
   }
  }
 },
 "events": {
  "run1": [
   [
    "MODEL_ADDED_EVENT",
    9690,
    "rchi"
   ],
   [
    "OBJECT_TREE_CREATED_EVENT",
    12885,
    "rchi"
   ],
   [
    "GEOMETRY_LOADED_EVENT",
    13632,
    "rchi"
   ],
   [
    "MODEL_ADDED_EVENT",
    17432,
    "truc"
   ],
   [
    "OBJECT_TREE_CREATED_EVENT",
    20018,
    "truc"
   ],
   [
    "GEOMETRY_LOADED_EVENT",
    23984,
    "truc"
   ],
   [
    "MODEL_ADDED_EVENT",
    27126,
    "echa"
   ],
   [
    "OBJECT_TREE_CREATED_EVENT",
    28113,
    "echa"
   ],
   [
    "GEOMETRY_LOADED_EVENT",
    28842,
    "echa"
   ]
  ],
  "run2": [
   [
    "MODEL_ADDED_EVENT",
    7800,
    "rchi"
   ],
   [
    "OBJECT_TREE_CREATED_EVENT",
    10546,
    "rchi"
   ],
   [
    "GEOMETRY_LOADED_EVENT",
    12043,
    "rchi"
   ],
   [
    "MODEL_ADDED_EVENT",
    16221,
    "truc"
   ],
   [
    "OBJECT_TREE_CREATED_EVENT",
    18147,
    "truc"
   ],
   [
    "GEOMETRY_LOADED_EVENT",
    22889,
    "truc"
   ],
   [
    "MODEL_ADDED_EVENT",
    26190,
    "echa"
   ],
   [
    "OBJECT_TREE_CREATED_EVENT",
    27246,
    "echa"
   ],
   [
    "GEOMETRY_LOADED_EVENT",
    28325,
    "echa"
   ]
  ]
 }
}
```
