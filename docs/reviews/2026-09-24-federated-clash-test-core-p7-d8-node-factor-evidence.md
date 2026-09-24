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

## 9. Applied (owner-approved erratum A11, 2026-09-24)

The owner approved §7 and directed a reconciliation of the `maxResultsPerRun` hard ceiling (derived maximum 956,824 unless disproved). Both were applied. The erratum is recorded as row **A11** in the spec's §25 errata table.

- **Commits:** `e016796` — `fix(clashtest): D-8 — …` (code and tests). The spec, plan and record edits are in the `docs(spec): D-8 erratum A11 …` commit `ab01fcd`, with a docs follow-up `03fdf52` (missed `p0` l.73 formula; softened §10 wording).
- **Final constants** (`clashtest/options.js`):
  - `SCHEMA_NODE_FACTORS = { result: 35, ledger: 12, diagnostic: 12, slack: 65_536 }` (result was 24).
  - `RUN_OPTION_SPECS.maxResultsPerRun = int(1, 956_824, 100_000)` (the ceiling was 1,000,000; the default is unchanged).
  - `SCHEMA_MAX_NODES = 35 × 956,824 + 12 × 20,000,000 + 12 × 100,000 + 65,536 = 274,754,376` (was 265,265,536). It is still the `maxCapturedNodes` ceiling.
  - Provisional-default worst case: `35 × 100,000 + 12 × 1,000,000 + 12 × 10,000 + 65,536 = 15,685,536 ≤ 16,000,000`. No §17.1 default changes.
- **Independent re-derivation of the ceiling** (the owner's 956,824 is confirmed, not disproved):
  1. The byte half of R21-2 gives `maxCapturedNodes × BYTES_PER_NODE ≤ maxStoredResultBytes ≤ 1 GiB`. So every engine has `maxCapturedNodes ≤ ⌊1,073,741,824 / 32⌋ = 33,554,432`. The node ceiling `SCHEMA_MAX_NODES` is far higher and does not bind.
  2. The node half gives `35R + 12L + 12D + 65,536 ≤ maxCapturedNodes ≤ 33,554,432`.
  3. To make R as large as possible, take D = 0 (the minimum of `maxRetainedDiagnostics`) and L = 3. L = 3 is the smallest legal `maxLedgerRecords`, since `maxLedgerRecords ≥ maxPlanReferences + 2 × maxUnitsPerRun ≥ 1 + 2`.
  4. That gives `35R ≤ 33,554,432 − 36 − 65,536 = 33,488,860`, so `R ≤ 956,824.57` and **R_max = 956,824**. Check: 35 × 956,824 = 33,488,840 ≤ 33,488,860, and 35 × 956,825 = 33,488,875 > 33,488,860.
  5. The ceiling is attained. The options `{maxResultsPerRun: 956,824, maxUnitsPerRun: 1, maxPlanReferences: 1, maxLedgerRecords: 3, maxRetainedDiagnostics: 0}` have a worst case of 33,554,412 nodes. They are accepted by `resolveRunOptions` against `limits {maxCapturedNodes: 33,554,432, maxStoredResultBytes: 1 GiB}`, which is asserted in `nodeFactor.test.mjs`.
  6. On the brief's "16M reader ceiling" wording: the binding cap for the *ceiling* is the 1 GiB / 32 B = 33,554,432-node byte cap, not the 16,000,000 `maxCapturedNodes` default. The 16M default is the operational limit, and the *defaults* still satisfy it (15,685,536). An option at the ceiling needs a raised reader limit, as every results-heavy configuration always has. The ceiling moves with `BYTES_PER_NODE` (G-CAL).
- **Tests.**
  - `test/clashtest/integration/nodeFactor.evidence.test.mjs` is renamed to `nodeFactor.test.mjs`. It is now a permanent regression with 9 tests, about 3.3 s.
    - Every `// EVIDENCE` assertion is flipped: every producer shape is ≤ 35; the factor equals the attained maximum; the §5 contradiction set (40,000 results) now **reads back**, with 1,043,336 measured nodes against a formula of 1,479,936.
    - A new test pins the ceiling's reachability and maximality, and shows that 1,000,000 is unreachable.
    - The two (d) single-record findings remain, re-marked `OPEN GATE D-8b` / `OPEN GATE D-8c`.
  - The standing `test.todo` in `maximumShape.test.mjs` is promoted to a passing `test`. It runs at the **worst-case** result shape: `maximumShapeSet` gained an opt-in `resultShape: 'worst'`, which gives clearance evidence and all four flags, with mB's pair owners in `unreachablePopulation`. The test runs 50,000 results and 500 units, with `maxPlanReferences` raised to 3,000 so the set's plan tables fit. It measures 1,764,246 nodes against a formula of 1,863,536, and the engine read-back is canonical-equal to the stored set. Under factor 24 the same test failed (1,764,245 measured against 1,313,536; the later D-A `count` field adds one node).
  - `options.defaults.test.mjs`: the title and the literal changed from 24 to 35.
  - No test or fixture relied on the old 1,000,000 ceiling. The capture test of ceiling + 1 results derives the new ceiling automatically.
- **Spec edits** (`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`):
  - §13.6 (the `SCHEMA_MAX_NODES` formula and the closed-shape bound, marked "erratum **A11**");
  - §13.6 (the producer/reader invariant, marked "(A11)");
  - §17.1.1 (the `maxResultsPerRun` ceiling cell: "956,824 (was 1,000,000; erratum A11)");
  - §25 (the new A11 row).
- **Plan edits** (current-value restatements only, each marked A11):
  - `p0-foundations.md` l.16 (the quoted §13.6 invariant), l.69 (the exported `SCHEMA_NODE_FACTORS` value) and l.73 (the `worstCaseCapturedNodes` formula);
  - `interface-reconciliation.md` l.196 (S-P7-2: 274,754,376 ≈ 8.2 GiB);
  - `p7-engine-integration.md` l.1783 (15,685,536 comment) and l.2130 (the S-P7-2 arithmetic and the defaults figure).
- **Deliberately not edited.** These are historical executed-step records:
  - the P0 plan's code listing (l.1280–1281, l.1294) and its test listing (l.1587, l.1600);
  - the P0 plan's RED-step notes (l.1741–1749);
  - the P7 plan's step code at l.1792, where at-ceiling options are still refused.

  `docs/handoffs/latest.md` and the acceptance record are outside this task's scope and were not edited. Their D-8 lines, and the handoff's reference to `nodeFactor.evidence.test.mjs`, are for the controller to update. `clashtest/README.md`, `README.md` and `CHANGELOG.md` have no occurrence.

- **Internal review.** `codex-advisor` (medium, request `20260924-183147-34301-30850`) confirmed that the 956,824 derivation is correct and tight: it leaves 20 nodes of room, and 956,825 exceeds the cap by 15. It also confirmed that the promoted R21-2 test is non-vacuous and that no normative edit exceeds the erratum. It raised two findings, both applied:
  - the missed live formula at `p0-foundations.md` l.73;
  - §10's "only" wording, qualified to include the fixed `SCHEMA_MAX_NODES` bound and the absence of whole-set contradiction tests.

## 10. Separate bounded-evidence gates (D-8b, D-8c) — gates, not fixes

The erratum above does **not** touch the ledger or diagnostic factor. Each remaining item is a gate. It closes only on the evidence named below, followed by an owner decision on the term's form.

> **Update (§11, owner ruling D-8b/D-8c, 2026-09-24).** Both gates' evidence items were produced. **D-8c is closed** by erratum **A13** (diagnostic term `(24 + maxUnitIdsPerDiagnostic) × maxRetainedDiagnostics`). Items 1 and 3 below are done, and the evidence decided item 2's choice of form: the option-dependent term, because the flat 88 would push the defaults over 16,000,000. **D-8b stays open** as an owner decision on the term's *form*. Items 1 and 3 are done, with an end-to-end reproducer kept as a standing `test.todo`. Item 2 is answered in the negative: no fixed or options-only term keeps the defaults within 16,000,000. Item 4 shows that the provisional defaults themselves admit ledgers of about 100M nodes. Neither gate is a G-CAL item. See §11.

**D-8b — ledger term (unsound in form).** Closing it needs all of the following:

1. **A proven per-record node bound, or a proof that none exists in fixed-factor form.** Take every persisted ledger/plan record kind the writer can emit: unit record, source range, explicit target entry, root-table row, root-owner row, unreachable/mixed owner row, scope-digest row, taint entry, overflow reserve and planning gap. For each, give its meter charge as a function of the expanded id counts, derived from `planning/sizing.js` `unitRecordFields` and the P5 `TYPES`. Measure each on the real P3 writer, as §2 did for results.
2. **A candidate term that bounds the ledger's captured nodes by run options alone.** For example, `a × maxLedgerRecords + b × (expanded ids ≤ f(maxPlanReferences, maxUnitsPerRun, maxSourceDbIdsPerUnit, maxTargetModelsPerUnit, …))`. It needs a written proof that it covers every set `resolveRunOptions` admits, including target-root ids repeated across units.
3. **An executable contradiction test and its inversion.** Choose options that minimize ledger allowance per expanded id (for example, few ledger records but units of 500 contiguous source roots each, or many units sharing one wide explicit target). Size `maxCapturedNodes` exactly to today's formula, build a validator-clean set, and show `ResultSetTooLargeError` today. Then show that the candidate term either refuses the options or reads the set back.
4. **The impact of the candidate term** on `SCHEMA_MAX_NODES`, the provisional defaults (they must still fit 16,000,000, or a default change must be named), and the reachable ceilings. This is the same arithmetic as §9.

**D-8c — diagnostic factor (12 vs a measured 20–88).** Closing it needs:

1. **The exact per-diagnostic maximum** under the schema and `validateResultSet`, as a function of `maxUnitIdsPerDiagnostic`. §6 measured 20 / 27 / 83 for 1 / 8 / 64 unit ids and a schema maximum of 88 with `fragment` and `fragments` both present. It must also say whether the validator admits that last combination, the way §3 settled the 35-versus-34 question for results.
2. **The owner's choice of form.** Either a run-option-dependent factor (for example `24 + maxUnitIdsPerDiagnostic`, which puts `maxUnitIdsPerDiagnostic` into `worstCaseCapturedNodes`), or a fixed 88. In both cases, show the effect on the defaults (10,000 × 32 = 320,000 or 10,000 × 88 = 880,000 against the current 120,000; the defaults then total 15,885,536 or 16,445,536 — the latter exceeds 16,000,000 and would force a default change) and on `SCHEMA_MAX_NODES`.
3. **An executable contradiction test and its inversion.** Use diagnostic-heavy options (for example `maxResultsPerRun: 1`, `maxRetainedDiagnostics: 100,000`, `maxUnitIdsPerDiagnostic: 64`) with `maxCapturedNodes` sized to today's formula. Build a validator-clean retained-diagnostic set, show today's `ResultSetTooLargeError`, then show the corrected formula accepting it for read-back or refusing it up front.

**Do D-8b / D-8c independently block the P7 acceptance run?** On executable evidence, **no test fails because of them.**

- After this erratum, the full suite (`node scripts/run-tests.mjs`) passes with 2508 tests: 2505 pass, 0 fail, 3 todo. The 3 todos are D-C, D-D and an unrelated library gap.
- `maximumShape.test.mjs` with the opt-in tiers (`CLASHTEST_AC12_TIERS=all`: `scaled`, `ledger` = 200,000 ledger records, and `results` = 100,000 results) passes 10/10. So the round trips at the provisional defaults and at the configured tiers read back.
- The only D-8b/D-8c assertions in the suite are the two single-record `OPEN GATE` findings in `nodeFactor.test.mjs`, and they pass by pinning the unsound behaviour.

What they do leave unproven is the **universal** R21-2 claim ("every option set `resolveRunOptions` accepts is readable"), the AC-11/AC-12 conjunct "at each hard ceiling **that option validation accepts**", and the claim that the fixed `SCHEMA_MAX_NODES` bound covers every legal set. §6's single-record counterexamples indicate that ledger-heavy and diagnostic-heavy option sets, with a reader limit sized exactly to the formula, may be unreadable. No committed whole-set contradiction test proves this yet; producing one is part of each gate above. So the acceptance record should read AC-11/AC-12 as **satisfied for the results-dominated form and at the defaults and tiers, with a scoped caveat for D-8b/D-8c**. Whether that caveat blocks P7 acceptance is an owner decision; the executable evidence does not force it either way.

## 11. D-8b/D-8c bounded evidence

**Owner ruling (2026-09-24, verbatim):** "D-8b / D-8c: do not defer yet. Perform bounded evidence checks now. For both the ledger node factor and diagnostic node factor: derive the capture-meter charge field-by-field; identify the legal minimum and proven worst-case maximum; identify whether the charge is shape-dependent; determine whether the current factor can admit any legal option set whose persisted result later exceeds the reader bound; add a targeted reproducer if such a contradiction exists. If the current factor is unsound and the evidence yields a single conservative fixed replacement without schema/interface changes, apply the same class of bounded erratum used for D-8 and add targeted worst-case tests. Only defer to G-CAL if the remaining uncertainty is genuinely calibration-dependent rather than a deterministic accounting defect."

- **Base:** HEAD `bc432b6`. **Commits:** `a8e684c` (`fix(clashtest)`: the A13 diagnostic term), `1b986d2` (`test(clashtest)`: the evidence tests), and the `docs(spec): erratum A13 …` commit that carries this section.
- **Evidence tests:** `test/clashtest/integration/nodeFactor.ledgerDiagnostic.test.mjs`, 10 tests (9 pass, 1 standing `test.todo`), about 2 s. Every charge is measured with the capture meter on records built by the real writers. Both contradictions are reproduced **end to end**: the real engine plans, executes (the scripted executor), seals and persists; then a fresh engine reads by id.
- **Standard applied (the A11 precedent).** Record *counts* are bounded by the run's options: results by `maxResultsPerRun`, `unitIds` by `maxUnitIdsPerDiagnostic`. Per-record *shapes* are taken at the schema/`validateResultSet` maximum, because the reader cannot tell writers apart (35, not the producer's 34).
- **Verdicts:** **D-8c: UNSOUND, single fixed fix → applied (erratum A13).** **D-8b: UNSOUND, needs a form change → not applied; owner decision.** Neither verdict is calibration-dependent. Both are deterministic accounting facts of the meter, the schema and the budget code.

### 11.1 D-8c — the diagnostic factor

**Derivation.** Sources: `TYPES.NormalizedDiagnostic` / `DiagFragment` / `DiagFragmentPair` (`clashtest/results/resultSetSchema.js:255-266`), the P4 projection and aggregator (`execution/diagnostics.js:195-225, 390-495`), and the P4 boundary validator (`execution/UnitExecutor.js:495-515`).

| Field | Shape | Nodes | Required? | Producer: fragment scope | Producer: pair scope | Schema/validator |
|---|---|---|---|---|---|---|
| (object) | `{}` | 1 | yes | 1 | 1 | 1 |
| `scope`, `reason`, `completenessAffecting`, `attribution` | primitives | 4 | yes | 4 | 4 | 4 |
| `fragment` | `{modelKey, dbId, fragId, role?}` | 4, or 5 with `role` | optional | 4–5 | absent (the P4 validator rejects it) | 5 |
| `fragments` | `{first, second}`, each a `DiagFragment` | 9, or 11 with `role` on both | optional | absent (rejected) | 9 (`role` on pair operands is rejected) | 11 |
| `ambiguousModelId` | `true` | 1 | optional | when an operand's `modelId` is ambiguous | same | 1 |
| `occurrences` | integer | 1 | yes | 1 | 1 | 1 |
| `unitIds` | `string[]`, *u* entries | 1 + *u* | yes | *u* ≤ `maxUnitIdsPerDiagnostic` (run option; aggregator `diagnostics.js:453`) | same | *u* ≤ 64 (schema ceiling) |

**Measured on the real P4 projection and aggregator** (test D-8c (a)):

- fragment scope: 11 + *u* without `role`, 12 + *u* with it;
- a diagnostic with an ambiguous operand (its `modelKey` is `null`): the §12.4 de-duplication key then carries the unit id, so it is never merged across units and *u* = 1 always. A fragment one costs 14, a pair one 18;
- pair scope: 16 + *u*. That is 17 at *u* = 1, 24 at the default 8, and **80** at the ceiling 64, which is the **producer maximum**.

**Schema/validator maximum: 24 + *u*.** It is attained by `fragment` + `fragments`, with `role` on all three operands, plus `ambiguousModelId`. That gives 25, 32 and **88** at *u* = 1, 8 and 64 (test D-8c (b)).

- A sealed set carrying the 88-node diagnostic passes the full `validateResultSet` with `{ok: true, issues: []}`. No cross-field check relates `scope`, `fragment` and `fragments`; it checks only the counters (`validateResultSet.js:620-690`).
- The type is closed: an extra key at the top level or inside `fragment` is `unknown-field-closed-type`. A 65th unit id is `array-too-long`. So 24 + *u* is the maximum.

**Minimum:** 12 for the producer (a fragment-scope diagnostic without `role`, *u* = 1). The schema-only minimum is 7 (no fragments and an empty `unitIds`).

**Shape-dependent: yes.** The charge depends on scope, `role`, ambiguity and *u*. The *u* part is bounded by a **run option**, not by the schema alone.

**Contradiction (test D-8c (d), a real-engine run).**

- *Setup.* 64 units (`maxSourceDbIdsPerUnit: 1`, 64 roots in mA, a whole mB target) each report the same 1,500 pair diagnostics. So all 1,500 are retained, and each carries 64 unit ids, costing 80 nodes.
- *Options.* `{maxUnitsPerRun: 64, maxPlanReferences: 388 (the exact plan-record count), maxLedgerRecords: 516, maxResultsPerRun: 1, maxRetainedDiagnostics: 1,500, maxUnitIdsPerDiagnostic: 64}`.
- *Before A13.* The formula gave 89,763 nodes, so the options were accepted by an engine with `maxCapturedNodes` = 89,763. The run completes and the set is `validateResultSet`-clean, but it measures **122,645** nodes, 32,882 over. Before the fix, the fresh engine's read threw `ResultSetTooLargeError` (observed while developing the test; the exploratory run used `maxPlanReferences` 1,000 and measured 122,837 against a formula of 97,107).
- *After A13.* The formula gives `35 + 12 × 516 + 88 × 1,500 + 65,536 = 203,763`, and the same run reads back.

**Candidates and the choice.** Both candidates are closed expressions over the existing option table, with no schema or interface change.

| Candidate | Per diagnostic | `SCHEMA_MAX_NODES` | Defaults worst case | Verdict |
|---|---|---|---|---|
| (current) flat 12 | 12 | 274,754,376 | 15,685,536 | unsound (above) |
| flat 88 (the ceiling folded in) | 88 | 282,354,376 | **16,445,536 > 16,000,000** | sound, but the defaults would violate R21-2, and it is looser for every *u* < 64 |
| **24 + `maxUnitIdsPerDiagnostic`** | 24 + *u* | 282,354,376 (at *u* = 64) | **15,885,536 ≤ 16,000,000** | sound and tight (attained for every *u*); **applied** |

The applied form follows A11's own principle: the count of `unitIds` is a run-option bound, exactly like the results count. It is the unique tight conservative bound under that standard.

- It changes no schema or type, no option, default or ceiling, no error code, and no export. `SCHEMA_NODE_FACTORS` keeps its four keys; `diagnostic` is now the 24-node per-diagnostic frame.
- The `maxResultsPerRun` ceiling (956,824, derived with no retained diagnostics) is unchanged.
- `maxRetainedDiagnostics` and `maxUnitIdsPerDiagnostic` at their ceilings remain acceptable by an engine at the byte cap (test D-8c (c)).
- An independent `codex-advisor` pass (medium, request `20260924-192203-91138-16893`) agreed on both points: the 24 + *u* bound (no validator check lowers it) and the preference over the flat 88.

**Applied (erratum A13).**

- Code, `clashtest/options.js`:
  - `SCHEMA_NODE_FACTORS.diagnostic` 12 → 24 (the frame);
  - `worstCaseCapturedNodes` diagnostic term → `(24 + maxUnitIdsPerDiagnostic) × maxRetainedDiagnostics`;
  - `SCHEMA_MAX_NODES` diagnostic term → `(24 + 64) × 100,000`.
- Spec: §13.6 (the `SCHEMA_MAX_NODES` formula, the closed-shape bound and the invariant, marked A13), and §25 row **A13**.
- Plan current-value restatements:
  - `p0-foundations.md` l.16, l.69 and l.73;
  - `interface-reconciliation.md` l.196 (282,354,376 ≈ 8.4 GiB);
  - `p7-engine-integration.md` l.1783 and l.2143.
  Historical executed-step listings are not edited (the same rule as §9).
- Tests pinning the old values:
  - `options.defaults.test.mjs`: title and literal;
  - `nodeFactor.test.mjs`: (b) now pins 282,354,376 and 15,885,536, and the (d) diagnostic test is flipped to "CLOSED by A13";
  - `maximumShape.test.mjs`: comment only.

### 11.2 D-8b — the ledger factor

> **Update (§12, owner ruling #5, 2026-09-24).** D-8b is **closed** by erratum **A14** ("Proposed forms" #1 below: `unit-range` charged per expanded id). The "OPEN GATE" facts and the standing `test.todo` described in this section were flipped or promoted; see §12.

> Review note (Task A review, minor 6): §11.2(b) bounds unit records by what the *producer* writes (≤ 8 secondary causes, etc.). By the *schema* maximum, `secondaryCauses` can reach 20M and id arrays 10M, so even bound (b) is unsound — this strengthens the D-8b verdict. Review minors 3–5 (old-factor read-back assertion at `maxCapturedNodes` 89,763; the "6,599 refused plan-too-large" claim not asserted; `worstCaseCapturedNodes` (`options.js:226`) yields NaN — failing open — if handed a partial options object lacking `maxUnitIdsPerDiagnostic`, latent only since production passes fully resolved options) are deferred.

**What `maxLedgerRecords` counts** (`planning/ledger.js` `createRecordBudget`; `LEDGER_RECORD_CLASSES`). There is one run-wide counter, `used = planRecords + reserved + discretionary ≤ maxLedgerRecords`, and it has four parts:

- **Planning records** (also ≤ `maxPlanReferences`):
  - `rootResolution.js:258`: `scope-digest` (1 per root + 1 per population), `unresolved-selection` (1 per row + 1 per dbId), `unreachable-population` (1 + |owners| + |mixed|), `hierarchy-internal` (1 per row + 1 per example);
  - `planTables.js:66`: `root-table` (1 per root), `root-owner` (1 per owner id);
  - `planner.js:360`: `unit-record` (1 per unit), `unit-range` (1 per **range**: `sizing.js:97` `rangeRecordCount`), `planning-gap` (1 per warning).
- **Reserve:** `maxUnitsPerRun` overflow slots.
- **Runtime records:** `split` (2 + the children's range count), and one per taint entry (element, target-model or unit).
- **Not charged at all:** the ledger frame, per-model wrapper rows, `secondaryCauses` (≤ 8 per unit), `ledger.planningGaps` (closed-enum pairs, de-duplicated), `exclusions`, and `outcome.reasons`.

**Charge per record kind** (test D-8b (a), measured on the real writers):

| Persisted form | Nodes | Budget records charged | Nodes per record |
|---|---|---|---|
| `rootOwners[m]` wrapper `{modelKey, owners}` | 3 per model | 0 | slack (≤ 20,000 models) |
| `RootOwnerRow {rootDbId, ownerDbIds, cls}` | 4 + *o* | 1 root-table + *o* root-owner | ≤ 2.5 |
| provenance `RootDigest` / `population` | 3 / 3 | 1 scope-digest | 3 |
| `UnresolvedSelection` | 5 + *n* | 1 + *n* | ≤ 3 |
| `UnreachablePopulation` | 8 + *o* + *m* | 1 + *o* + *m* | ≤ 8 |
| `HierarchyInternal` row / example | 5 / 3 + *k* (*k* ≤ 8 by the producer, `MAX_EXAMPLE_OWNERS`) | 1 / 1 | ≤ 11 (see note) |
| `Warning` / `ledger.planningGaps` row | 2 / 3 | 1 planning-gap / 0 | ≤ 2 / slack |
| `Taint` (incl. `taint-overflow` in its reserved slot) | 6 | 1 | 6 |
| **`UnitRecord`** | **17 + \|sourceRootDbIds\| + Σ targets (3 for `model`, 4 + *n* for `roots`) + \|secondaryCauses\| (≤ 8) + 6 × taints** | 1 unit-record + *r* unit-range + 1 reserved slot, where *r* = source ranges + explicit target ranges + whole sentinels | **unbounded** |
| split children | two full `UnitRecord`s, each copying the parent's targets (`splitting.js:45`) | 2 + children's ranges | **unbounded** |

- *Measured unit records:* 21 (1 source id, a model-scope target), 23 (1 source id, 1 target root), and 2,521 (500 source ids × 2,000 target ids, **2 ranges**). Adding 8 secondary causes gives +8; each taint gives +6.
- *Note on hierarchy examples.* The schema and validator admit any `ownerDbIds` length up to 10,000,000 on a hierarchy example; only the producer caps it at 8. That is the same form gap in a planning row, but no fix is proposed for it independently.

**Minimum and maximum; shape-dependence.**

- *Minimum.* The smallest producer unit record is 21 nodes for 3 records.
- *Maximum per unit.* It is a function of **expanded ids**, not of records:
  - an issued unit carries ≤ `maxSourceDbIdsPerUnit` source ids (`packSource`), ≤ `maxTargetModelsPerUnit` entries, and ≤ `maxTargetFragmentsPerUnit` explicit target ids (each root has ≥ 1 fragment);
  - a `target-too-large` gap unit carries **all** oversize roots of one model, bounded only by the plan size (`sizing.js:238`), and that gap is repeated for every source chunk;
  - split children copy the targets.
- *Why the ratio is unbounded.* The ids live in shared ranges, while the charge is per range. **Many units carry the same target root ids**: cell 1 gives every source chunk the same target slices. So persisted nodes grow as roughly *units × target ids*, while budget records grow as *units + target ids*. `maxUnitsPerRun` caps the unit count; nothing caps the product (`codex-advisor` confirmed there is no hidden cap).
- **Shape-dependent: yes, and not bounded by any per-record constant.**

**Contradiction, end to end (test D-8b (d); standing `test.todo`).**

- *Setup.* mA has 100 one-fragment roots and mB has 2,000. Selection A is the explicit list of the mA roots; selection B is the explicit list of the mB roots.
- *Options.* `{maxSourceDbIdsPerUnit: 1, maxUnitsPerRun: 100, maxPlanReferences: 6,600, maxLedgerRecords: 6,800, maxResultsPerRun: 1, maxRetainedDiagnostics: 0}`.
  - 6,600 is the **exact** plan-record count: 3 × 2,100 roots + 100 unit records + 200 ranges. 6,599 is refused as `plan-too-large`.
  - 6,800 is the cross-field minimum.
- *Result.* The options are accepted with `maxCapturedNodes` = formula = **147,171**. The run completes. The set passes `validateResultSet` with `{ok: true}`. Every unit record costs 2,022 nodes against 4 charged records (48 nodes of allowance), and the set measures **221,236** nodes.
- *Read-back.* The fresh engine's by-id read throws **`ResultSetTooLargeError`**. R21-2 is violated.
- *How it is kept in the suite.* The facts are pinned in a passing test marked `OPEN GATE D-8b`. The invariant itself is a standing `test.todo` whose real body fails today with `measured 221236 <= formula 147171` (the R-P7-24 precedent).

**The provisional defaults are themselves unsound** (test D-8b (c), computed with the real sizer and the real record budget at `RUN_OPTION_DEFAULTS`).

- *Scenario.* Selection A is 10,000 whole-model roots of 101 fragments each. Each root exceeds half of `maxSourceFragmentsPerUnit` (200), so it forms a source chunk alone. Selection B is 10,000 explicit one-fragment roots, the default `maxExplicitElementsPerSelection`.
- *Sizing and admission.* The plan sizes to 10,000 units, exactly `maxUnitsPerRun`. The real budget admits it with `planRecords` = 90,001 ≤ 500,000, and the reserve fits.
- *Node count.* Every unit persists 1 + 10,000 ids, which is **10,022 nodes** (two units measured in full, the rest counted by ranges). The unit records alone total **100,220,000 nodes**.
- *Against the limits.* That is more than six times both the defaults' formula (15,885,536) and the default reader limit (16,000,000). It also exceeds the byte cap: 33,554,432 nodes at 1 GiB / 32 B.
- *Consequence.* A run at **default options** can therefore seal a set that no engine configuration can read or store within the byte ceiling. Lighter inputs reach 16,000,000 too: for example, 1,600 source chunks against 10,000 target roots.
- *At the ceilings.* The same product (≤ 100,000 units × up to 100,000 target ids) far exceeds `SCHEMA_MAX_NODES`. So a legal set can also be misclassified as **corrupt**, contrary to §13.6's "every set any conforming writer may legally produce is within it".

**Is there a single fixed replacement? No.**

- *(a) A fixed per-record factor.* It cannot exist, because nodes per charged record are unbounded (above).
- *(b) An options-only closed expression.* A sound one exists, for example `12 × maxLedgerRecords + maxUnitsPerRun × (maxSourceDbIdsPerUnit + 4 × maxTargetModelsPerUnit + max(maxTargetFragmentsPerUnit, maxPlanReferences) + 8)`. The last term is needed for gap units. As `codex-advisor` noted, the non-unit sections still need their own proof on top. At the defaults this term is about 10,000 × 500,524 ≈ **5.0 × 10⁹ nodes**, some 300 times the 16,000,000 reader default. Even the tighter unit-only product 10,000 × 20,524 ≈ 2.1 × 10⁸ is 13 times over. By the owner's defaults rule this is an owner-decision fact, so it was **not applied**.
- *(c) Classification.* The defect is an accounting mismatch between the budget unit (a range) and the persisted unit (an expanded id). It is deterministic and has nothing to do with calibration: no G-CAL measurement can change it.

**Proposed forms (owner decision needed, D-8b):**

1. **Charge expanded ids.** The planner charges `unit-range` by id count rather than range count, and `split` likewise. `12 × maxLedgerRecords` then covers unit records, after a small frame adjustment: the 17 + 8 + 3 frame needs ≥ 3 records per unit, and 2 are charged today plus the reserve.
   - *Cost:* `plan-too-large` arrives much earlier. At the defaults, 1,000,000 records would cover about 1,000,000 persisted ids.
   - *Scope:* no schema change; the §6.5.1 accounting rule changes.
2. **Persist ranges, not expanded ids.** The sealed ledger carries the root tables plus `{table, start, end}` ranges.
   - *Cost:* a schema change, plus changes to `ledgerDigest` and every sealed-ledger consumer (P5 validator, P8 derivations).
3. **A new RunOption cap** on total persisted ledger ids (for example `maxLedgerIds`), with its own formula term and a producer-side `plan-too-large` / split refusal.
   - *Cost:* an interface change (a new option).
4. **Accept a huge sound term, per (b).** This forces far larger reader defaults, beyond the byte ceiling, so it is not viable.

**Owner decision needed.** Choose the D-8b form (1, 2 or 3 above, or another). Until then:

- R21-2's universal claim is **false for ledger-heavy option sets, including the provisional defaults**;
- AC-11/AC-12's conjunct "at each hard ceiling that option validation accepts" holds only for the results-dominated and diagnostic-dominated forms and for the measured tiers;
- the D-8b `test.todo` stands.

**Incidental finding (not investigated further).** The schema caps `rootOwners[].owners` and `provenance.models[].scopeDigests.roots` at 10,000 per model, which is the `maxEntriesPerSelection` ceiling. No producer-side guard limits the roots of a *whole-model* selection to that number. A whole-model scope with more than 10,000 roots would therefore seal a set whose own reader rejects it as `array-too-long` (corrupt): a producer/reader mismatch of the same R21-2 class. It was found by reading the code and not reproduced. It should be triaged separately.

### 11.3 Verification

- The new file runs in about 2 s: 10 tests, 9 pass, 1 todo. `nodeFactor.test.mjs`, `options.defaults.test.mjs`, `options.test.mjs` and `maximumShape.test.mjs` all pass.
- `CLASHTEST_AC12_TIERS=all node --test test/clashtest/integration/maximumShape.test.mjs` passes 10/10.
- The full suite (`node scripts/run-tests.mjs`) gives **2524 total / 2522 pass / 0 fail / 2 todo** (baseline 2514 / 2513 / 0 / 1). The new todo is the D-8b reproducer.

## 12. D-8b applied (owner ruling #5)

**Owner ruling #5 (2026-09-24):** fix the accounting by charging per **expanded** root id ("Proposed forms" #1 of §11.2). No persisted-schema change, no new cap option; the minimum accounting correction so that `plan-too-large` (the existing budget refusal path) fires before the persisted ledger can exceed `SCHEMA_NODE_FACTORS.ledger (12) × maxLedgerRecords`. Recorded as spec erratum **A14**.

- **Base:** HEAD `200f745`. **Commits:** `f3685ab` (`fix(clashtest)`, production), `5855a2b` (`test(clashtest)`), the `docs(spec): erratum A14 …` commit (spec §6.5.1 and §25), and the `docs(reviews): …` commit that carries this section.

### 12.1 The change

`clashtest/planning/sizing.js` `rangeRecordCount(unit)` — the one function that computes the `unit-range` charge — now returns

`|source root ids| + Σ over targets (1 for a whole-model sentinel, |root ids| for an explicit entry)`

instead of `|sourceRanges| + Σ (1 | |target ranges|)`. Every production path supplies a charge derived through it, so nothing else changed:

- initial units and `target-too-large` gaps: `planner.js` `assembleSteps` → `admitPlanBlock([['unit-record', n], ['unit-range', total], …])` (step 4);
- split children: `splitting.js` `planSplit` → `unitRecordFields(plan, child).ranges` → `ledger.tryRecordSplit` → `admitRuntime('split', 2 + c0.ranges + c1.ranges)`. A child copies its parent's targets (`splitting.js` `child`), and its copied target ids are charged again, exactly as they are persisted again.

`ranges` is a transient field (`normalizeUnitFields` validates and drops it), so no persisted field or serialization changes. A run whose runtime admissions are unaffected seals a byte-identical ledger; only the budget counters (`planRecords`, `used`) differ. A plan that still fits but sits nearer the budget has less discretionary runtime capacity, so it may collapse taints into `taint-overflow`, refuse a split, or set `budgetExhausted` / `firstRefusalUnitId` earlier; those are the §6.5.1 conservative fallbacks. The unit-record and reserved-slot classes are unchanged. `ledger.tryRecordSplit` itself trusts the caller's `children[].ranges`; its only production caller (`planSplit`) derives them through `unitRecordFields`.

### 12.2 Proof: every persisted unit record is ≤ 12 nodes per charged record

Take any unit record the writer persists (initial unit, gap, split parent or child). Let *s* = its source root ids, *m* = its whole-model target entries, and *r* explicit target entries with *n*₁ … *n*ᵣ root ids. By §11.2 (measured on the real writers) its meter charge is

`N = 17 + s + 3m + Σᵢ (4 + nᵢ) + k + 6t`,

with *k* ≤ 8 secondary causes (`MAX_SECONDARY_CAUSES`) and *t* taint entries. The budget charges it

- `1` (`unit-record`, or its share of the split block's `2`) + `R` (`unit-range`) with `R = s + m + Σ nᵢ` (A14);
- one record per non-overflow taint entry (`admitRuntime`), 6 nodes each;
- its `taint-overflow` entry, if any (6 nodes), in its reserved slot (one per possible unit record, `maxUnitsPerRun`).

Taints are covered by their own records (6 ≤ 12). For the rest:

`12 (1 + R) − (17 + 8 + s + 3m + Σ (4 + nᵢ)) = 11s + 9m + 11 Σ nᵢ − 4r − 13 ≥ 11s + 9m + 7r − 13` (each *n*ᵢ ≥ 1).

Every writer-produced unit has *s* ≥ 1 (`packSource` chunks and bisected halves are non-empty) and *m* + *r* ≥ 1 (a slice, a gap entry and each half of a target cut hold at least one entry, and each explicit entry at least one root). So the difference is ≥ 11 + min(9, 7) − 13 = **5 > 0**. The tightest shape is one source id against one whole-model sentinel with 8 causes: 29 nodes for 3 records (36). The reserved slot is not needed for the frame, so it remains free for the overflow taint.

- **Scope.** The proof covers the live planner and split writer paths. The low-level exported ledger methods accept empty id arrays and an arbitrary `ranges` from a direct caller; no production code does that.
- **Split children** are unit records in their own right and are charged the same way, including their copied target ids. The split parent keeps its record, which was charged when it was admitted.
- **Gap units** (`target-too-large`) carry all oversize roots of one model and are repeated per source chunk; each gap record is charged its own ids, so the repetition is charged too.
- **Plain per-id charging (one per sentinel) is a simple sufficient rule, as the ruling selected; it is not claimed to be the mathematical minimum.** It closes the proof without the reserved slot and without any extra per-entry frame charge. Some sentinel-sensitive charge is necessary: without it, a unit with several whole-model sentinels would exceed its allowance. A single sentinel would still fit if the reserved slot were counted (36 ≥ 29 + 6).

Together with §11.2's per-kind table (every other charged kind ≤ 11 nodes per record under producer shapes) and the uncharged per-model wrappers and frame in the slack, the persisted ledger is bounded by `12 × used ≤ 12 × maxLedgerRecords` plus slack. The scope is the same as §11.2's: producer shapes. The schema maxima of `secondaryCauses` and of hierarchy-example `ownerDbIds` (Task A review note, §11.2) are not addressed by this ruling.

### 12.3 Before / after

| Case | Before (per range) | After (A14, per id) |
|---|---|---|
| One unit, 500 source ids × 2,000 target ids in 2 ranges | `unit-range` 2; planRecords 7,503; 2,521 nodes for 3 records | `unit-range` 2,500; planRecords **10,001** (exact boundary admitted, 10,000 refused `plan-too-large` / `unit-range`, 7,503 refused) |
| D-8b (c), `RUN_OPTION_DEFAULTS`: 10,000 source chunks × the same 10,000 target ids | `unit-range` 20,000; planRecords 90,001, **admitted**; ledger ≈ 100,220,000 nodes | `unit-range` 100,010,000; **refused** `plan-too-large` (`unit-range`), nothing charged |
| D-8b (d) options `{maxPlanReferences 6,600, maxLedgerRecords 6,800, maxUnitsPerRun 100, maxSourceDbIdsPerUnit 1}` | admitted; formula 147,171; set measures 221,236 → `ResultSetTooLargeError` | **refused** `plan-too-large`; the plan-less sealed set reads back |
| Same scenario, re-derived exact boundary | — | cost = 3 × 2,100 + 100 + 100 × (1 + 2,000) = **206,500**; `maxLedgerRecords` 206,700; formula **2,545,971**; the set measures 221,236 and **reads back**. 206,499 is refused `plan-too-large`. |
| D-8c (d) diagnostic reproducer (1 source id × a whole-model target per unit) | 388 | 388 (ids = ranges; unchanged) |

- **Defaults and ceilings.** No option, default, ceiling or cross-field rule changed, and `worstCaseCapturedNodes` / `SCHEMA_MAX_NODES` are unchanged (15,885,536 and 282,354,376). The `maxLedgerRecords ≥ maxPlanReferences + 2 × maxUnitsPerRun` rule and the reserve proof of §6.5.1 are untouched: they bound record counts, whatever a record stands for.
- **Cost.** At the defaults a run can now persist about 500,000 unit-record ids (`maxPlanReferences`), minus the table rows. Plans with wide shared targets are refused earlier. This is the ruling's accepted cost.

### 12.4 Tests

`test/clashtest/integration/nodeFactor.ledgerDiagnostic.test.mjs` (12 tests, 0 todo, about 2.5 s):

- (a) the 500 × 2,000 unit's charge is 2,500 (was 2);
- (b) flipped: five producer shapes (with 8 secondary causes) are each ≤ 12 × (1 + charge), and the charge equals ids + sentinels;
- (c) flipped: at `RUN_OPTION_DEFAULTS` the real sizer and record budget refuse the plan (`unit-range`, 100,010,000), and `planRecords` is unchanged by the refused block;
- (e) new: the real `createPlan`, 500 × 2,000 in two ranges, admitted at exactly 10,001, refused at 10,000 and at the old 7,503; the persisted unit is ≤ 12 × its records;
- (d) flipped: the old 6,600 options are refused `plan-too-large` end to end, and the sealed set reads back;
- the former `test.todo` "D-8b R21-2 …" is promoted to a passing test at the exact boundary 206,500 (measured 221,236 ≤ 2,545,971; read-back by a fresh engine);
- new: 206,499 is refused `plan-too-large` end to end.

Expectations changed because they encoded the per-range rule:

- `nodeFactor.test.mjs` D-8 (d): the `OPEN GATE D-8b` assertion (`520 > 12 × 4`) is flipped to `≤ 12 × (1 + 501)`, and pins `rangeRecordCount` = 501.
- `planning/planner.test.mjs` "unit records and ranges are charged as blocks": 14 → 15 (2 source ids + 1 sentinel = 3, was 2).
- `planning/sizing.test.mjs` "unitRecordFields is the P5 self-describing form": `ranges` 2 → 4 and 2 → 3.
- `planning/splitting.test.mjs` "the admission charges 2 + the children's range records": block 6 → 8 (each child: 1 source id + 2 copied target ids).
- `support/syntheticModels.mjs`: comment only.

No other assertion changed. Small plans whose ranges each hold one root (for example the D-8c reproducer, and every test with single-root sources against whole-model targets) are charged exactly as before. No persisted field changed, so every ledger-digest and sealed-set fixture passes unchanged.

### 12.5 Spec and plans

- Spec §6.5.1: the `maxPlanReferences` class list, the `maxLedgerRecords` class list and the split row of the runtime-class table (each marked A14), plus the §25 row **A14**. Nothing else in the spec was edited.
- Plans: no plan file restates the per-range rule. `p3-planner.md` says "range records" and `rangeRecordCount` only in historical executed-step listings, which follow the rule of §9 and are not edited. No `p4`/`p6`/`p7` plan or `interface-reconciliation.md` line mentions `unit-range` or range charging.
- `clashtest/options.js`: its comments do not describe the range charge, so they are not edited.

### 12.6 Internal review

`codex-advisor` (medium, request `20260924-204840-87839-30424`) verified the §12.2 inequality and its premises (*s* ≥ 1, *m* + *r* ≥ 1, *n*ᵢ ≥ 1, *k* ≤ 8, the overflow taint in the reserved slot) on every live writer path, and found no production charge path that bypasses `rangeRecordCount`. It raised three wording corrections, all applied:

- "every charge site" became "every production path", noting that `tryRecordSplit` trusts its caller's `ranges`;
- "byte-identical for plans that still fit" is now conditioned on unchanged runtime admissions (in the spec's A14 row as well);
- "per-id is the minimum" became "a simple sufficient rule".

### 12.7 Verification

- `nodeFactor.ledgerDiagnostic.test.mjs` 12/12, `nodeFactor.test.mjs` 9/9; planning, options and node-factor suites together 364/364.
- `CLASHTEST_AC12_TIERS=all node --test test/clashtest/integration/maximumShape.test.mjs`: 10/10, about 61 s.
- Full suite (`node scripts/run-tests.mjs`): **2535 total / 2533 pass / 0 fail / 2 todo**. Baseline at `200f745`: 2530 / 2526 / 1 fail / 3 todo. The baseline failure was `test/CollisionWorld.findClashes.test.mjs` "active-range compaction end-to-end", the pre-existing wall-clock flake (see `56d591a`); it did not recur. The removed todo is D-8b's; the remaining two are D-10 and the unrelated library gap.
