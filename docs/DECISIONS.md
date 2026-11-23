# Decisions

1. **Workbook is sole source of truth; gaps shown, never filled** (see DATA_DICTIONARY section 6).
2. **Scope ends at FCT_PRODUCT_MASTER**; FPM_DA_RULES and the three *_TO_FPM sheets are included because they define FPM.
3. **Agent 3 limited to documented logic** because the workbook has no SQL bodies.
4. **Service interface per agent + `ApiResult` envelope with `simulated` flag**, mock/http swapped by env.
5. **Confidence % is a deterministic heuristic labelled Simulated**, not LLM output.
6. **The CSV is parsed in the browser at runtime** (Papa Parse), carrying sheet/row provenance on every row; there is no extraction script.
7. **Chatbot is a mock RAG pipeline, split into retriever, context builder and generator interfaces** so a real embeddings + vector DB + LLM stack can replace stages without UI changes. It may only restate retrieved text and must answer "not found" instead of guessing.
8. **Chatbot knowledge is generated from the existing selectors** (lineage, procedures, rules, relationships), the project docs (`?raw` imports) and a hand-written platform guide, so workbook logic is not duplicated.
9. **Sidebar and chat sizes persist in localStorage; chat history persists in sessionStorage** (tab session only).
10. **Sample procedure SQL is a second verbatim input, parsed in the browser**; "migrating the rules" means traceability to the TRAQ model (name match plus FPM_DA_RULES rows, labelled derived), not generated TRAQ SQL, because no TRAQ-side SQL or column-level mapping for these procedures exists in the inputs.
11. **All 14 procedures are shown, including NPA/SMA ones**; those with no TRAQ link are reported as such rather than hidden or mapped to out-of-scope tables.
12. **`dd_export.xlsx` is consumed as CSV** (no Excel parsing in the app), shown raw until its structure is known.
13. Open: auth model, streaming (including chat), whether DI_WORKFLOWS belongs in scope.
