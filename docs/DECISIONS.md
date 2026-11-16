# Decisions

1. **Workbook is sole source of truth; gaps shown, never filled** (see DATA_DICTIONARY section 6).
2. **Scope ends at FCT_PRODUCT_MASTER**; FPM_DA_RULES and the three *_TO_FPM sheets are included because they define FPM.
3. **Agent 3 limited to documented logic** because the workbook has no SQL bodies.
4. **Service interface per agent + `ApiResult` envelope with `simulated` flag**, mock/http swapped by env.
5. **Confidence % is a deterministic heuristic labelled Simulated**, not LLM output.
6. **Extract workbook to generated JSON at build time**, carrying sheet/row provenance.
7. Open: auth model, streaming, whether DI_WORKFLOWS belongs in scope.
