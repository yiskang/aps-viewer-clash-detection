# D-8 — bounded evidence check of `SCHEMA_NODE_FACTORS.result` (spec §13.6)

- **Date:** 2026-09-24
- **Branch / base:** `feature/federated-clash-test-core-engine`, base HEAD `1abd6d9`
- **Scope:** read-only on production code and the frozen spec. Owner instruction D-8 (SDD ledger `.superpowers/sdd/p7-engine-integration/progress.md`, D-8 entries): derive the capture-meter charge of a ClashResult, find its legal min/max and shape-dependence, prove the worst-case bound at the schema ceilings, show the run-option/read-back contradiction with a targeted test, and propose the smallest normative correction as an erratum **for owner approval**. The spec and `clashtest/options.js` are **not** edited.
- **Evidence test:** `test/clashtest/integration/nodeFactor.evidence.test.mjs` (8 tests, all pass today by pinning the current, contradictory behavior; every such assertion carries `// EVIDENCE: documents D-8; flips when the spec erratum lands`). Runtime about 3.2 s.

## 1. Summary and verdict

**Is factor 24 unsound? Yes.** The capture meter (`clashtest/util/capture.js`, `captureData`) charges **one node per value**: every object, every array, every primitive (string, number, boolean, `null`). Property keys and string length cost nothing. With that rule, a ClashResult costs **20 to 35 nodes**. The cost depends on the mode and on which flags are present. It does not depend on any run option.

- **Minimum is 20.** A `containment` or `surface-intersection` result with no flags.
- **Maximum is 35.** A `clearance` result with all four flags. This is the maximum the schema and validator accept, and it is attained by a set that passes the full `validateResultSet`, not just the structural walk. The current producer reaches at most 34, because it only sets `witnessUnavailable` on volume-overlap results with a null witness (spec l.672 describes the flag in those volume-overlap terms).
- **An ordinary result already exceeds 24.** A volume-overlap result with a witness costs 26. Every clearance result costs at least 31.

**Proven bound.** A legal result set's `results` array costs at most `1 + 35 × R` nodes, where `R ≤ maxResultsPerRun`. The formula charges `24 × R`, so it under-counts by up to `11 × R`:

- 11,000,000 nodes at the §17.1.1 ceiling;
- 1,100,000 nodes at the provisional default, which is 17 times the 65,536 slack.

`resolveRunOptions` therefore accepts results-heavy options whose legal sets the same engine then refuses with `ResultSetTooLargeError`. That violates R21-2. The test reproduces it at 40,000 results with a validator-clean, producer-shaped set (built by the P7.9 synthesizer, not by an executed run): the formula allows 1,039,936 nodes and the set measures 1,043,336.

**Recommended correction.** Change `SCHEMA_NODE_FACTORS.result` from `24` to **`35`**. This is the smallest fixed factor that covers every set the schema and validator accept. Nothing else in the schema or interface changes (§7).

**Other factors: both are unsound as well.** These are findings, not fixes (§6).

- **`diagnostic: 12`.** A single retained pair-scope diagnostic costs 20 to 83 nodes.
- **`ledger: 12`.** The budget record count does not track node cost proportionally, because range records expand into id arrays.

The `result` erratum alone therefore does not make R21-2, or the claim that `SCHEMA_MAX_NODES` covers every valid set, fully sound.

## 2. Derivation table: meter charge of one ClashResult

Sources: `TYPES.ClashResult` and its dependent types (`clashtest/results/resultSetSchema.js:214-232`), `EVIDENCE_BY_MODE` (`:269`), and the producer `projectUnitPairs` and `reconcile` (`clashtest/results/resultSet.js:30-114`). Every number was measured with P0's meter in the evidence test.

| Field | JSON shape | Meter charge | Required? | volume-overlap | surface-intersection | containment | clearance |
|---|---|---|---|---|---|---|---|
| (the result object) | `{}` | 1 | yes | 1 | 1 | 1 | 1 |
| `resultId` | string (cap 256) | 1 | yes | 1 | 1 | 1 | 1 |
| `pair` | `{first:{modelKey,dbId}, second:{modelKey,dbId}}` | 1 + 2×3 = 7 | yes | 7 | 7 | 7 | 7 |
| `mode` | enum string | 1 | yes | 1 | 1 | 1 | 1 |
| `evaluatedAs` | `{source:{…}, target:{…}}` | 7 | yes | 7 | 7 | 7 | 7 |
| `unitId` | string | 1 | yes | 1 | 1 | 1 | 1 |
| **fixed frame** | | **18** | | 18 | 18 | 18 | 18 |
| `evidence` | per mode (`EVIDENCE_BY_MODE`) | see right | yes | `{witness:null}` = 2, or `{witness:{kind, point:[x,y,z]}}` = 1+1+(1+1+4) = 7 | `{}` = 1 | `{}` = 1 | `{distance, clearance, closestPoints:{first:[3], second:[3]}}` = 1+1+1+(1+4+4) = 12 |
| `flags` | `{}` plus up to 4 optional literal-`true` keys | 1 + k (k = 0…4) | yes (object), keys optional | producer: `witnessUnavailable` iff witness is null; `unreachableOwner` / `mixedOwnerProvenance` from plan owner data; `duplicateEvidenceConflict` when witness kinds disagree | producer: `unreachableOwner`, `mixedOwnerProvenance` (evidence always agrees, so no conflict flag) | same as surface | producer: `unreachableOwner`, `mixedOwnerProvenance`, `duplicateEvidenceConflict` (distances disagree); schema and validator also admit `witnessUnavailable` |

**Variable-length members inside a ClashResult: none.**

- `point` and `closestPoints.first/second` are `point3()`, exactly 3 entries. Any other length is `array-length-invalid` (asserted).
- A string costs 1 node whatever its length. `STRING_CAPS` bounds bytes, not nodes.
- `ClashResult`, `PairId`, `EvaluatedAs`, `ElementRef`, `Flags` and the three evidence types are all **closed**. They are not in §13.6's five open types (`OPEN_TYPE_FIELDS`), so an extra key anywhere is `unknown-field-closed-type` (asserted for the top level, `flags` and `evidence`).
- The per-result charge is therefore bounded by the schema alone, with no dependence on any run option.

## 3. Minimum, maximum and shape-dependence

| Shape | Charge | Source |
|---|---|---|
| containment / surface-intersection, no flags | **20** (legal minimum) | producer, measured |
| volume-overlap, witness null (+ forced `witnessUnavailable`) | 22 | producer |
| volume-overlap, witness | **26** | producer (the ordinary shape, used in the D-8 reproduction) |
| clearance, no flags | **31** | producer |
| containment, all producer flags | 22 | producer (real `createResultAccumulator` path) |
| volume-overlap witness null, all producer flags | 25 | producer |
| volume-overlap witness, all producer flags | 29 | producer |
| clearance, all producer flags | **34** (producer maximum) | producer |
| clearance + all four flags | **35** (legal maximum) | schema-legal (`checkShapeAndUnknownFields`) **and** full `validateResultSet`-clean (P5 `schema-corpus` set resealed with the four flags) |

- Schema-legal minimum: 20. Under the schema alone, a volume result with a null witness and no flag costs 21, which is still above 20.
- **Shape-dependent: yes.** The charge ranges from 20 to 35 and depends on the mode (evidence 1, 2, 7 or 12 nodes) and on the flag count (0 to 4). It is **independent of every run option.**
- **Why 35 and not the producer's 34.** `SCHEMA_MAX_NODES` is defined by §13.6 as "a data-format property, so every set any conforming writer may legally produce is within it". The reader can only enforce what the schema and `validateResultSet` enforce. Both accept a clearance result carrying `witnessUnavailable`, as the test shows with a fully validator-clean sealed set.
  - **Qualification.** Spec l.672 describes `witnessUnavailable` in volume-overlap terms, and the producer sets it only there. So 34 is the demonstrated *semantic* maximum, and 35 is the *schema/validator-accepted* maximum. Whether "legally produce" means the normative prose or validator acceptance is the owner's reading.
  - **Recommendation.** Take 35 because it is the conservative factor-only choice. Choosing 34 would need a new validator invariant (`witnessUnavailable` only on volume-overlap with a null witness), which is a validation-semantics change, not a factor erratum.

## 4. Worst-case proof at the existing ceilings

Take a valid result set with `R` results.

1. `R ≤ maxResultsPerRun`. The array ceiling is `RUN_OPTION_CEILINGS.maxResultsPerRun` (`TYPES.ResultSet.results`, enforced at capture by `arrayLimitFor`). The producer's `createResultAccumulator` refuses a whole unit past the run's `maxResultsPerRun`.
2. By §2 and §3, the `results` array costs `1 + Σ charge(r) ≤ 1 + 35R`, with equality possible. The container node is covered by the slack.
3. The formula charges `24R`. The shortfall is up to `11R`, and it is structural: the slack is a fixed 65,536, while the shortfall grows with `R`.

| Point | R | 24 × R (formula) | 35 × R (proven max) | shortfall |
|---|---|---|---|---|
| §17.1.1 ceiling | 1,000,000 | 24,000,000 | 35,000,000 | **11,000,000** |
| provisional default | 100,000 | 2,400,000 | 3,500,000 | 1,100,000 (≫ 65,536 slack) |
| D-8 reproduction | 40,000 | 960,000 | 1,400,000 (the set actually used the 26-node shape: 1,040,000) | 440,000 at the maximum; 80,000 for the 26-node set |

- **`SCHEMA_MAX_NODES` today:** `24×1,000,000 + 12×20,000,000 + 12×100,000 + 65,536 = 265,265,536`.
- **With the correction (result 35):** `276,265,536`.
- **Hard caps.** The only cap on `SCHEMA_MAX_NODES` is that it *is* the ceiling of `maxCapturedNodes` (`ENGINE_LIMIT_SPECS`). The effective operational cap is the byte half of R21-2: `maxCapturedNodes × 32 ≤ maxStoredResultBytes ≤ 1 GiB`, so `maxCapturedNodes ≤ 33,554,432`. Neither value depends on the result factor, and no other hard cap exists in the spec or the implementation.

## 5. Contradiction test

File: `test/clashtest/integration/nodeFactor.evidence.test.mjs`. It uses only the real P0 meter, the P5 producer, schema and validator, the P0 option resolvers, the engine by-id read path, and the existing P5/P7 support builders. No support file is modified.

| Test | What it proves |
|---|---|
| (a) fixed frame | The 18-node frame: `pair` = 7, `evaluatedAs` = 7. |
| (a) per-mode producer charge | The exact table in §3, from the real `projectUnitPairs` and `createResultAccumulator` (reconcile). 26 > 24 and 31 > 24. |
| (a) schema-legal max 35, closed | A 35-node result passes `checkShapeAndUnknownFields`. Extra keys at the top level, in `flags` and in `evidence` are rejected, and a 4-element point is rejected, so 35 is the maximum. |
| (a) full-validator max | P5 `schema-corpus` (clearance) resealed with all four flags on one result: `validateResultSet` gives `{ok: true, issues: []}` and the maximum charge is 35. |
| (b) arithmetic | Checks every figure in the results-term row, the `SCHEMA_MAX_NODES` line and the defaults bullet in §7, including the reachable-region figures (1,395,369 → 956,824). |
| (c) executable contradiction | Options `{maxResultsPerRun: 40,000, maxUnitsPerRun: 100, maxPlanReferences: 1,000, maxLedgerRecords: 1,200, maxRetainedDiagnostics: 0}` with `limits.maxCapturedNodes = worstCaseCapturedNodes(...) = 1,039,936` are **accepted** by `resolveRunOptions`. `maximumShapeSet` then builds a sealed set within every count the options bound; `validateResultSet` returns `{ok: true}` on it, which the test asserts. The set is producer-shaped but hand-synthesized, not the output of an executed run: 40,000 results, 100 units, ledger records ≤ 1,200, 0 diagnostics. It **measures 1,043,336 nodes (3,400 over)**, and `engine.getResultSet` rejects it with **`ResultSetTooLargeError`**. Under factor 35 the formula would be 1,479,936 ≥ the measured count. |
| (d) diagnostic, ledger | Single-record counterexamples; see §6. |

The options were sized so that the set's plan-table records (about 900: 101 root-table rows, 500 root owners, 100 unit records, 200 unit ranges, 2 scope digests) fit `maxPlanReferences = 1,000`. That makes the set plausibly producible under those options, not merely count-compatible. The standing `test.todo` in `maximumShape.test.mjs` (50,000 results / 500 units: formula 1,283,536 vs measured 1,314,236) is untouched.

## 6. Other factors (findings, not fixes)

**`diagnostic: 12` is unsound.** `NormalizedDiagnostic` (`resultSetSchema.js:251-263`) has variable-length `unitIds` (≤ `maxUnitIdsPerDiagnostic`, ceiling 64) and optional `fragment`, `fragments` and `ambiguousModelId`. The real P4 producer (`execution/diagnostics.js:206-223, 453-457`) emits `fragments` for pair scope, `role` on fragments, and `ambiguousModelId`.

- A pair-scope diagnostic with one unit id costs **20**.
- At the default of 8 unit ids it costs **27**.
- At the ceiling of 64 it costs **83**.
- A fragment-scope diagnostic with `role` and one unit id costs 13.

The schema does not forbid `fragment` and `fragments` together, so the schema maximum is 88. A diagnostic factor would have to be run-option-dependent (for example `24 + maxUnitIdsPerDiagnostic`) or fixed at 88. That goes beyond this erratum and is **a separate owner decision**.

**`ledger: 12` is unsound in form, not just in value.** The ledger budget (`planning/ledger.js`) charges one `unit-range` record per **range**. The sealed `UnitRecord` stores the **expanded** ids: `planning/sizing.js:104-113` `unitRecordFields` does `sourceRanges.flatMap(readRange)`, and does the same for explicit target ranges. As a result:

- One unit with 500 contiguous source roots (one range, the default `maxSourceDbIdsPerUnit`) costs 520 nodes against about 4 budget records (unit-record, source range, target entry, overflow reserve), or 48 nodes of allowance.
- Target root ids repeat in every unit that targets them.

The ledger node count therefore does not track the record count proportionally. The hard ceilings do make the maximum finite (`ids()` ≤ `maxPlanReferences` ceiling, and targets are capped), but the per-record ratio is enormous, so 12 is unsound and a sound fixed per-record factor would be absurdly large. The term needs a different form, for example an expanded-id term tied to `maxPlanReferences`, per-unit id caps and unit count. That is a design question for the owner.

The 12 × `maxLedgerRecords` allowance is also generous for record kinds that do not materialize, such as reserve slots and root-table rows. At today's defaults the aggregate may still over-cover real sets, but **that is not proven**.

**Free-form documented fields.** `statistics`, `provenance.runOptions` and `diagnostics.countsByReason[]` rows are schema `free()`. Their node cost is bounded only by the capture ceiling itself (the comment at `resultSetSchema.js:291-293` says so). They rely on the 65,536 slack and on producer discipline, not on a closed shape. This is noted for completeness.

**Consequence.** With only the result correction, R21-2 still holds only as far as the ledger and diagnostic allowances happen to over-cover real sets. The D-8 contradiction in its **results-dominated** form (the one reproduced) is closed. Ledger-heavy and diagnostic-heavy forms remain open owner items.

## 7. Recommended erratum (for owner approval; NOT applied)

**Change:** `SCHEMA_NODE_FACTORS.result` from 24 to **35**. This is the proven, attained maximum in §3. No other value changes.

### Spec §13.6 (`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`, line 976; three substitutions in the one paragraph)

1. Old: ``total captured nodes ≤ the **fixed schema node ceiling** `SCHEMA_MAX_NODES = 24 × maxResultsPerRun_ceiling + 12 × maxLedgerRecords_ceiling + 12 × maxRetainedDiagnostics_ceiling + 65,536` ``
   New: ``total captured nodes ≤ the **fixed schema node ceiling** `SCHEMA_MAX_NODES = 35 × maxResultsPerRun_ceiling + 12 × maxLedgerRecords_ceiling + 12 × maxRetainedDiagnostics_ceiling + 65,536` ``
2. Old: `(the closed shapes bound one `ClashResult` to ≤ 24 nodes and one ledger or diagnostic record to ≤ 12;`
   New: `(the closed shapes bound one `ClashResult` to ≤ 35 nodes — a clearance result with all four flags, counting every object, array and primitive as one node — and one ledger or diagnostic record to ≤ 12;`
   The ledger/diagnostic clause is left as-is. It is known to be inaccurate (§6), but correcting it is a separate owner decision.
3. Old: `` `24 × maxResultsPerRun + 12 × maxLedgerRecords + 12 × maxRetainedDiagnostics + 65,536 ≤ maxCapturedNodes` ``
   New: `` `35 × maxResultsPerRun + 12 × maxLedgerRecords + 12 × maxRetainedDiagnostics + 65,536 ≤ maxCapturedNodes` ``

Also add an erratum entry to the spec's errata register and §25 dispositions, following the repository's existing erratum convention (as used for A8). No §17.1 or §17.1.1 table value changes.

### Code (`clashtest/options.js`)

- `:38` comment. Old: `/** Closed-shape node bounds of spec 13.6 (one ClashResult <= 24 nodes; one ledger/diagnostic record <= 12). */` New: `... (one ClashResult <= 35 nodes; ...`
- `:39` constant. Old: `export const SCHEMA_NODE_FACTORS = Object.freeze({ result: 24, ledger: 12, diagnostic: 12, slack: 65_536 });` New: `... { result: 35, ledger: 12, diagnostic: 12, slack: 65_536 } ...`
- `SCHEMA_MAX_NODES`, `worstCaseCapturedNodes`, `ENGINE_LIMIT_SPECS.maxCapturedNodes.ceiling` and `validateResultSet`'s capture ceiling all derive from the constant. No other code edit is needed.

### Tests and docs that pin the value

- `test/clashtest/options.defaults.test.mjs:68`: the test title says "24 x". Update the text; the assertion is derived from the constant.
- `test/clashtest/options.defaults.test.mjs:81`: literal `24 * RUN_OPTION_DEFAULTS.maxResultsPerRun` → `35 * …`.
- `test/clashtest/integration/maximumShape.test.mjs:393` (finding comment "<= 24 nodes") and `:407` (todo title "ClashResult > 24 nodes"): rewrite once the todo is promoted.
- `test/clashtest/integration/maximumShape.test.mjs:176`: comment "14,585,536 <= 16,000,000" → "15,685,536 <= 16,000,000". The standing `test.todo` "R21-2 gap" (about line 399) then passes (1,833,536 ≥ 1,314,236) and should be promoted to a `test`.
- `test/clashtest/integration/nodeFactor.evidence.test.mjs`: every `// EVIDENCE:` assertion flips. Invert or delete them, and keep the measured-charge tables.
- Plan text (historical records; update only if the owner wants them current): `docs/superpowers/plans/federated-clash-test-core/p7-engine-integration.md:1783` (comment 14,585,536) and `:2130` (265,265,536 → 276,265,536; ×32 B ≈ 8.2 GiB). The P0 plan's `:1749` is a historical RED-step note; leave it.
- Also quoting the old formula or numbers: `docs/superpowers/plans/federated-clash-test-core/p0-foundations.md:16` (quotes the §13.6 formula), `docs/superpowers/plans/federated-clash-test-core/interface-reconciliation.md:196` (S-P7-2: 265,265,536 ≈ 7.9 GiB), and `docs/handoffs/latest.md:27` (the D-8 status line). Update these per the owner's choice for historical records; the handoff should be updated when the erratum is applied.
- Repo grep found no other occurrence of `24 ×`, `≤ 24 nodes` or `14,585,536` in the spec, `clashtest/`, README or CHANGELOG.

### Effect

- **`SCHEMA_MAX_NODES`:** 265,265,536 → 276,265,536. This is the `maxCapturedNodes` ceiling, so it grows with it.
- **Provisional-default worst case:** 14,585,536 → 15,685,536, still ≤ the `maxCapturedNodes` default of 16,000,000. The defaults keep satisfying R21-2, with margin shrinking from 1,414,464 to 314,464 nodes. **No default changes.**
- **Reachable region (new, for owner awareness).** Under the byte half (≤ 33,554,432 nodes at 1 GiB / 32 B), the largest acceptable `maxResultsPerRun` is computed with the smallest legal ledger (`maxLedgerRecords = 3`) and no diagnostics. The formula's byte boundary moves from 1,395,369 to **956,824**. Before, the largest acceptable value was therefore the 1,000,000 ceiling itself; after, it is 956,824, so the 1,000,000 ceiling is **no longer reachable by any engine configuration** while `bytesPerNode = 32`. That is consistent with §17.1.1's existing "ceilings are jointly unreachable" framing. The ceiling value itself is unchanged: an option of 1,000,000 stays valid-shaped and is refused as `result-unreadable`, as today for large combinations. `bytesPerNode` and the byte ceiling are G-CAL-provisional.
- **Memory and time.** The reader limit (`maxCapturedNodes`, default 16,000,000 × 32 B = 512 MiB) is unchanged, so the actual per-read memory bound is unchanged. The erratum only makes option validation honest. Option validation refuses somewhat earlier: results-heavy options need about 46% more reader headroom per result. There is no runtime cost; the formula is O(1).

## 8. Risks and what this does not change

- **No change to** the schema (`TYPES`), the ClashResult shape, any §17.1 default or §17.1.1 ceiling, `bytesPerNode`, the error taxonomy, the capture algorithm or the reader limits. Only the result factor and the values derived from it change.
- **Not sufficient for full R21-2 soundness.** The ledger (range expansion) and diagnostic (`unitIds`, `fragments`) factors are also unsound (§6), and free-form fields rely on the slack. These remain **open owner items** (suggested: D-8b ledger term form, D-8c diagnostic factor). The owner scoped the correction to `result` unless another factor was proven unsound. Both are now proven unsound by single-record counterexamples, but neither has a single fixed conservative replacement that keeps the interface unchanged (the diagnostic maximum depends on an option; the ledger's per-record ratio makes any fixed factor absurdly large). They are therefore reported, not proposed as a fixed erratum.
- **A mode-specific factor was considered and rejected.** A run has one mode, so a mode-dependent factor (for example 30 for volume-overlap, 35 for clearance, 24 otherwise) would be tighter. It would make `worstCaseCapturedNodes` depend on the definition, which `resolveRunOptions` does not see. That is an interface change, not a minimal erratum.
- **Why not 34 (the producer maximum).** It would under-cover a `validateResultSet`-clean set from another conforming writer, which `SCHEMA_MAX_NODES` must cover by §13.6's own definition.
- **Internal review.** `codex-advisor` (medium, request `20260924-145814-21487-8188`) confirmed the 20–35 derivation, the contradiction test and the arithmetic. It raised five corrections, all applied:
  - qualify 35 as the schema/validator maximum (34 is the semantic maximum);
  - assert `validateResultSet` inside test (c);
  - reword the old reachable bound;
  - add the missing pinning references;
  - soften the claim that no ledger bound exists.
- G-CAL: no default is frozen by this evidence. The measured charges are shape facts of the meter, not calibration data.
