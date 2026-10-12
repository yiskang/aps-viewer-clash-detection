# CTM-8 headed reachability (CTM8-P0-v4 §9.2)

Every count below comes from a **real engine run started from the real Clash Panel UI** (Run button) on the three real SVF2 Audubon models, all loaded together for the whole session. No records were injected or seeded.

- **Configured `maxResultsPerRun`:** 100,000 (options.js default, source-derived; not observable via public VM). The panel calls `engine.startRun(definition)` without run options (`clashpanel/core/controller.js:361`).
- **Produced = retained:** no run hit the result limit. Every headline was `Completed — N clashes`, with no "stopped at the result limit" headline and no banners. So in every run truncated = false and retained = produced = `run.counts.total`.

## Real result sets observed in this session (selection survey, untimed)

| n_models (in results) | Definition (Set A × Set B, mode) | Produced = retained | Truncated | Run time (ms) |
| --- | --- | --- | --- | --- |
| 1 | Mechanical self, Hard | 242 | no | ≈24,000–26,400 |
| 1 | Structure self, Hard | 271 | no | 11,239 |
| 1 | Structure self, Soft 0.25 ft | 369 | no | ≈11,500–12,800 |
| 1 | Architecture self, Hard | 4,770 | no | ≈142,400–143,000 |
| 2 | Structure × Mechanical, Soft 0.3 ft | 121 | no | ≈1,400–1,600 |
| 2 | Structure × Mechanical, Hard | 491 | no | 1,208 |
| 2 | Architecture × Mechanical, Hard | 1,211 | no | ≈3,800 |
| 2 | Architecture × Structure, Hard | 2,277 | no | ≈4,300–7,600 |
| 3 | Mechanical × (Architecture + Structure), Soft 0.1 ft | 114 | no | ≈3,200–4,000 |
| 3 | Mechanical × (Architecture + Structure), Hard | 1,702 | no | ≈3,700 |
| 3 | Architecture × (Structure + Mechanical), Soft 1.0 ft | 2,448 | no | 17,030 |
| 3 | Architecture × (Structure + Mechanical), Hard | 3,488 | no | ≈6,700 |

- Soft runs used the user-supplied `ft` basis with no verified host basis. This is the same caveat as the CTM-7 headed evidence.
- Re-runs of the same definition reproduced the same total every time: each cold generation checks `pre.sameTotal`, and all were true.

## Selected headed points

| Point | n_models | Slot | Requested | Actual (produced = retained) | Label |
| --- | --- | --- | --- | --- | --- |
| n1-low | 1 | low | 100 | 242 | NEAREST-REACHABLE (requested 100, actual 242) |
| n1-mid | 1 | middle | 1,000 | 369 | NEAREST-REACHABLE (requested 1000, actual 369) |
| n1-high | 1 | high | largest naturally reachable | 4,770 | high = largest observed for n=1 |
| n2-low | 2 | low | 100 | 121 | NEAREST-REACHABLE (requested 100, actual 121) |
| n2-mid | 2 | middle | 1,000 | 1,211 | NEAREST-REACHABLE (requested 1000, actual 1211) |
| n2-high | 2 | high | largest naturally reachable | 2,277 | high = largest observed for n=2 |
| n3-low | 3 | low | 100 | 114 | NEAREST-REACHABLE (requested 100, actual 114) |
| n3-mid | 3 | middle | 1,000 | 1,702 | NEAREST-REACHABLE (requested 1000, actual 1702) |
| n3-high | 3 | high | largest naturally reachable | 3,488 | high = largest observed for n=3 |
| — | 1, 2, 3 | 5,000 target | 5,000 | — | **NOT REACHABLE HEADED** (largest produced: 4,770 / 2,277 / 3,488) |
| — | 1, 2, 3 | 10,000 target | 10,000 | — | **NOT REACHABLE HEADED** |

**Limits of this survey:**
- "Largest naturally reachable" means the largest set among the definitions tried in this session (the table above). It is not an exhaustive search of every Set A/B/mode/clearance combination.
- Soft clearance did not scale the count up (Soft 1.0 ft gave 2,448, fewer than Hard's 3,488 for the same sets). Larger clearances were not tried.
- Mixing Hard and Soft definitions across slots is a confound for comparing points. These points are corroboration only.

## Family M (HM-REC)

All six points (`M.N_tests` ∈ {5, 25, 100} × `n_models` ∈ {1, 3}) are **UNAVAILABLE — §9.3 HM-REC predicate not executable through the public instrumentation route (manager VM/list DOM not reachable without a private-state read or production seam); owner ruling required**. See `blockers.md`. Nothing was timed and no records were created.
