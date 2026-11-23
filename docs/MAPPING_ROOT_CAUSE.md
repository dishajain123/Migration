# Agent 4: why columns stayed "Unmapped" - root cause and fix

Status: code written and type-checked through VS Code diagnostics; **not run** (shell blocked). Run `npm test` and `npm run build`, then follow the check list at the end.

## Findings (with evidence)

| # | Question | Finding | Evidence |
|---|---|---|---|
| 1 | Are submitted skills ingested? | **No, and never were.** `.claude/skills/*` are guidance for developers and the coding assistant. No file in `src/` or `server/src/` reads them (no `skill`, `.claude` or `import.meta.glob` reference). Only `docs/*.md` and `platformGuide.ts` feed the chatbot. | grep over `src` and `server/src` |
| 2 | Does the mapping agent retrieve context? | **No.** Agent 4's deterministic path (`suggest.ts`) used only the parsed workbook model. It never read remarks, `FPM_DA_RULES`, the procedure SQL, or lineage. The AI ranking (`mappingPrompt`) saw only the heuristic's own candidates, so it could not recover anything the heuristic dropped. There is no embedding/chunk step in Agent 4. | `suggest.ts` (old), `aiPrompts.ts mappingPrompt` |
| 3 | Candidate pool | **Main cause.** `poolFor` accepted only CrisMac columns from the "no TRAQ target" blocks where `u.sheet === target table name`. Those blocks exist only on the `Recp_*` sheets and `STG_ASSET_BASE`. So every other staging table had an **empty pool** (`if (pool.length === 0) return []`), and `Recp_*` columns were never candidates for any target. MART tables only saw columns of staging tables already feeding them. Other columns of the feeding CrisMac tables were never considered. | `poolFor` (old); CSV: only 6 such blocks (Recp_Collateral, Recp_Customer, Recp_Joint_Account_Holding, Recp_Party, Recp_Securities, STG_ASSET_BASE) |
| 4 | Matching logic | Whole-token Jaccard only. No abbreviation handling (`ACCT_NO` vs `ACCOUNT_NUMBER` scored 0), no plural stemming, no use of remarks, rules or procedure SQL. The workbook has no column descriptions, so none can be used ("Not provided in workbook"). | `tokens`, `jaccard` |
| 5 | Scoring/threshold | The 0.35 threshold is not the problem on its own. A type-family mismatch scored 0 and so needed 58% name overlap, while a hard number/date incompatibility was not rejected, only down-weighted. Candidates below threshold were dropped with `continue` and left no trace. | `suggestionsForTable` (old) |
| 6 | Status model | Everything collapsed into "no candidate". Empty pool, rejected near miss, and workbook-declared NOT FED looked identical. `UnfedColumn.reason` was only the workbook map type. | `unfedWithFlags`, `Unfed` tab |
| 7 | "Still unmapped after I submitted" | **Bug.** Approving a suggestion or adding a manual mapping only wrote to `reviewStore`. `fedKeySet` is built from the workbook alone and the Unmapped tab never read the store, so reviewed columns stayed unmapped. | `Unfed` (old), `reviewStore.ts` |
| 8 | Orchestration | Agents share only the parsed workbook model. Agent 3's procedure SQL reached Agent 4 nowhere; Agent 5's conversion already used Agent 4's store, but not the reverse. | `services/mock/mapping.ts` (old) |

## Fix

`src/domain/mappingEngine.ts` (new, pure) replaces the scorer; `suggest.ts` keeps the public selectors.

- **Pool from lineage**: unmapped-list columns for this sheet *or* any feeding CrisMac table, plus every other known column of each CrisMac table that already feeds the target (not already used by it), plus staging feeders for MART tables.
- **Names**: abbreviation expansion (generic naming conventions such as `ACCT`, `NO`, `DT`), plural stemming, and **aliases learned from documented one-to-one DIRECT/RENAME rows seen at least twice** in the workbook.
- **Evidence**: workbook remarks, `FPM_DA_RULES` rows and sample procedure SQL that name a source column for the target column add up to +0.10, and only when name similarity is already >= 0.20. Evidence supports a match; it never creates one.
- **Rejections are explicit**: a number/date incompatibility rejects the candidate; below-threshold candidates are kept with their score and reason.
- **Unchanged on purpose**: acceptance threshold 0.35, weights 0.6/0.25/0.15, no auto-approval, everything labelled Simulated.
- **Seven distinct outcomes** per column (`ColumnMappingStatus`): `resolved`, `suggested`, `ambiguous`, `below-threshold` (found but rejected), `no-match`, `insufficient-context`, `declared-unmapped`. A workbook NOT FED column with an acceptable candidate stays a suggestion, flagged "confirm before mapping".
- **Reviewer decisions now count**: `applyReviewed` marks approved/manual mappings `resolved` (service `getAnalysis(table, reviewed)`).
- **AI ranking** receives the pool size, evidence counts and the list of columns with no acceptable candidate, but can still only pick from engine-accepted candidates.

## Traceability

- UI: Agent 4, "Unmapped & ambiguous" tab: context card (source tables, pool size, evidence counts, learned aliases) and, per column, a candidate table with name/type/context scores, accept/reject reason.
- Console: `localStorage.mappingTrace = '1'`, reload. One group per target column: workbook status, pool, retrieved context, candidate table, final decision.

## Follow-up: TIMEKEY (CrisMac) vs BUSINESS_DATE (TRAQ)

Evidence in the workbook and code:

- `TIMEKEY` is never a column on its own. The D2K time keys are `EffectiveFromTimeKey` / `EffectiveToTimeKey` (int) on the DIM sheets and CrisMac feeds; `@TIMEKEY` is a procedure parameter. The calendar table is `SysDayMatrix(TimeKey int, Date datetime)`, and the DPD sample procedure resolves it with `SELECT Date FROM SysDayMatrix WHERE TimeKey=@TIMEKEY`.
- TRAQ `BUSINESS_DATE` is a column only on the `Recp_*` dictionary tables (sourced from `DATE_OF_DATA`, not from a time key; "NOT in the load path") and a Temporary run-date variable in FPM_DA_RULES row 6 (`TODATE(PERIOD_ID)`). The load-path tables carry the business date as `PERIOD_ID` (YYYYMMDD number) and `RECORD_START_DATE` / `RECORD_END_DATE`, which the workbook documents as `DERIVED` from `EffectiveFromTimeKey` / `EffectiveToTimeKey` (FCT_BUYOUT_DETAIL rows 6-7).
- So the workbook does **not** document a TIMEKEY -> BUSINESS_DATE column mapping, and BUSINESS_DATE is never an Agent 4 target. The engine does not invent one. For a load-path DATE column the engine now finds the relationship (below).

Where it was lost, exactly:

1. `tokens()` split `TimeKey` into `time, key` but left all-caps `TIMEKEY` as one token, so equivalent names never overlapped (`mappingEngine.ts` / old `suggest.ts`).
2. No semantic role: an `int` source and a `DATE` target hit the number->date "incompatible" rule, so the documented key-to-date conversion was rejected before scoring (`typeUtils.compat`, the type gate in `scoreCandidate`).
3. The Phase 10 fallback `suggestTraqColumnsForColumn` scored every TRAQ column with a flat type score and plain tokens, with no notion of a date key or of the conversion needed.
4. Documented pairs (the same source column already feeding a same-named target elsewhere) were not reused as evidence.

Fix (`src/domain/mappingSemantics.ts`, wired into `mappingEngine.ts` and `suggest.ts`; no column pair is hard-coded):

- Vocabulary learned from the workbook's own column names splits run-together names (`TIMEKEY` -> `time, key`).
- A **calendar lookup** is recognised from metadata (integer key column + a column named `Date`, e.g. SysDayMatrix). A numeric column whose name contains that key is a **date key**.
- A date key is compared to DATE targets as the date it stands for (key words replaced by `date`), with a type score of 0.75 (convertible, below a same-type match) and a **transformation** taken from the lookup table. It is reported as `warn`, flagged "Requires transformation", and never auto-approved.
- A documented precedent (key -> DATE) is shown as evidence; a documented identical source->target pair elsewhere adds the existing +0.10 evidence bonus.
- Without the calendar table the same columns are not matched (test), and ties stay `ambiguous` for human review.

Tests: `src/domain/mappingSemantics.test.ts`.

## Not done (and why)

- Skills are not injected into the app: they describe how to *build* it. If the team wants runtime guidance, add it as workbook-backed data or `docs/` content that the engine reads explicitly.
- No column descriptions or synonym lists exist in the workbook; the abbreviation list is generic and small. Extend `ABBREVIATIONS` only with conventions, never bank mappings.
- Procedure SQL context covers the 14 sample procedures only.

## Check after running

1. `npm test` (`src/domain/mappingEngine.test.ts`) and `npm run build`.
2. Agent 4 > pick STG_BILLS, STG_PC or STG_TRANSACTIONS > Unmapped tab: previously empty pool, now a non-zero "candidates compared" count and per-column outcomes.
3. Approve a suggestion, open the Unmapped tab: that column is Resolved.
