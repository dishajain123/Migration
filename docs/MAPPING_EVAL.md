# Agent 4 mapping evaluation (Phase 1 of the mapping-engine upgrade)

Run: `npm run eval:mapping` (add `-- --misses` to list wrong/missed cases, `-- --folds=10` to change k).
Tests: `src/domain/mappingEval.test.ts` (the real-workbook test prints the same report).

## Method
- Ground truth = documented 1:1 `DIRECT`/`RENAME` workbook mappings that are the only feeding row of their target column
  (`eligibleCases`). Derived/lookup/multi-source rows have no single right answer and are excluded.
- k-fold holdout (default 5, deterministic): the fold's rows are removed from the model, the engine (`analyseTable`) is run
  on the reduced model, and its top suggestion is compared with the hidden source column. Aliases, documented pairs and
  remark evidence are therefore learned only from the remaining rows.
- Not removed: FPM_DA_RULES rows; sample procedure SQL is not passed. Reported accuracy is for the DIRECT/RENAME class only.
- Metrics: precision (correct / proposed), recall (correct / cases), recall of reachable (documented column was in the
  candidate pool), recall@3, ambiguity rate (ambiguous / proposed), coverage.

## Calibrated confidence
`mappingCalibration.ts` bins the raw score ([.35,.5), [.5,.65), [.65,.8), [.8,1]), measures precision per bin on the holdout,
smooths it, and forces it to be non-decreasing. `suggest.ts` shows that figure instead of `score x 100`. Separate curves
for clear and ambiguous suggestions; fewer than 20 holdout predictions means the raw score is shown and labelled
`uncalibrated`. Rule conversion's fallback (`suggestTraqColumnsForColumn`) is not yet calibrated. Still **Simulated**.

## Validator
`validateCandidateMapping` / `validateCandidateBatch` (`mappingValidator.ts`): target and source table/column must exist,
target must be an in-scope load-path column and not TRAQ-only, types via `compat()` (number<->date is an error unless a
transformation is stated), and conflicts are flagged (target already mapped, source feeds another column, source outside
documented lineage, ambiguous, several proposals per target/source). Heuristic suggestions that fail are dropped.

## Later phases (all opt-in; workbook-only mode is unchanged)
- **Profile input** (`docs/PROFILE_INPUT.md`): descriptions, glossary, value sets and statistics add `0.35 x similarity` to a candidate; tagged `profile_enriched`, uncalibrated.
- **Embeddings**: `POST /gateway/embeddings`; cosine above 0.6 adds up to 0.2, only when the candidate already has name, workbook or profile evidence; tagged `embedding_enriched`.
- **LLM proposes, validator checks** (`mappingProposals.ts`): the prompt lists the full candidate source schema; every pick passes `validateCandidateMapping` and invalid ones are discarded with the reason.
- **Transformations** (`transformValidator.ts`): one T-SQL value expression, read back by `sqlParse.ts` and limited to columns of the proposed source table(s); valid ones are `AI_DRAFT`. Few-shot lines come from `transformExamples.ts` (workbook REMARK, FPM_DA_RULES, sample procedure SQL, approved decisions).
- **Decisions and jobs**: see `docs/AI_GATEWAY.md` ("Agent 4 endpoints"). `npm run eval:mapping -- --decisions=<file>` reports how often the engine agrees with approved decisions and still proposes rejected ones.

## Baseline
Not yet recorded: the shell was blocked by group policy when this was written, so the evaluation has not been run.
Run `npm run eval:mapping` and paste the output here.
