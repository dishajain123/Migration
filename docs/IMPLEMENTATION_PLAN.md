# Implementation Plan

**All code below was written without being able to run it** (shell blocked by group policy). Nothing has been compiled or tested yet. First run: `npm install && npm run build`, then fix any type errors before judging behaviour.

| Phase | Scope | Status |
|---|---|---|
| 0 Foundation | CSV workbook analysis, docs, skills, Vite/Tailwind config, types, domain parser, service layer, shell, dashboard | Written, **unverified** |
| 1 Agent 1 Data Model | `features/dataModel`, `domain/selectors`, `services/mock/dataModel` | Written, unverified |
| 2 Agent 2 Lineage | `features/lineage`, `domain/lineage` | Written, unverified |
| 3 Agent 3 Procedures | `features/procedures`, `domain/procedures` | Written, unverified |
| 4 Agent 4 Mapping | `features/mapping`, `domain/suggest`, `stores/reviewStore` | Written, unverified |
| 5 Agent 5 Rules | `features/rules`, `domain/rules`, `domain/validate` | Written, unverified |
| 6 Integration | Review store feeds dashboard readiness and Agent 5 check C7; dashboard workflow cards | Written, unverified |
| 8 Source procedure SQL + TRAQ traceability | `domain/{sqlParse,procTrace}`, `services/procSource`, `features/procedures/SourceProcedures`, rules C8, chatbot knowledge | Written, **unverified**; dd_export CSV parser waits for a sample |
| 7 Guidance chatbot + sidebar | `components/chat`, `services/chat`, `domain/{knowledge,retrieval,answer}`, `stores/{chatStore,layoutStore}`, `Layout` sidebar collapse and drag-resize | Written, **unverified** (typecheck, build, tests and browser checks pending) |

## Also added
- Agent 1 Relationships tab (derived from LOOKUP/JOIN mappings; physical FKs are not in the workbook) - `domain/relationships.ts`.
- `ErrorBoundary` around every routed screen.
- Responsive shell (collapsible sidebar below `md`), metadata JSON export, cross-agent deep links, `components.json` for shadcn compatibility.
- Mapping deep link caveat: the target dropdown lists only tables that have unfed columns, so a linked table outside that list still loads but is not highlighted in the dropdown.
- Vitest suite `src/domain/parse.test.ts`: parser (shapes A and C, index, out-of-scope exclusion, rules sheet), lineage, column trace, validation, rule extraction, type utilities. Uses a small inline CSV fixture, not the real workbook.

## First-run checklist
1. Put the CSV in `public/data/`.
2. `npm install`, `npm run typecheck`, `npm test` - fix errors. The tests are the quickest check of the parser. They do not cover shape B (STG_BILLS-style, DIM Tables) or the "no TRAQ target" blocks, which only the real CSV exercises.
3. `npm run dev`; open each route; confirm the dashboard numbers are plausible vs the workbook index (e.g. FCT_COLLATERAL 53 columns, STG_BILLS 9,206 rows).
4. Check the parser: `/data-model` → Scope tab should list 34 sheets (the 32 in-scope data sheets plus `01 Index` and `FPM_DA_RULES`); FCT_PRODUCT_MASTER should show 186 listed columns.
5. Test states: set `VITE_MOCK_ERROR_RATE=0.5` to see error/retry UI; rename the CSV to see the missing-file message.

## Phase 7 checklist (run after the steps above)
1. `npm test`: `src/domain/chat.test.ts` covers grounding, citations, qualified columns, follow-ups, out-of-scope, not-found and small talk on a small fixture.
2. Chat in the browser: open the round button on each route; try a table question, `FCT_PRODUCT_MASTER.NPA_ID`, "Where does STG_BILLS get its data?", "what rules apply to it?" after a table question, "What is the weather in Paris?" (must say it cannot find it), "How do I approve a mapping?". Check each answer's sources link to the right screen and a `Simulated` badge shows. Set `VITE_MOCK_ERROR_RATE=0.5` to see the error state with Retry. Reload the tab: history stays; open a new tab: it is empty.
3. Chat panel: drag the top-left corner, left edge and top edge; use the maximise button; Esc closes; below 640px wide it fills the screen.
4. Sidebar: collapse/expand button; hover icons for tooltips; drag the right edge between 200 and 420 px; drag far left to collapse and back out to expand; double-click the edge toggles; the selected nav item stays highlighted; click nav items right after dragging; below 768px it is a drawer. Reload: collapsed state and width persist.
5. Keyword retrieval is first-pass: report any question that gets a poor or wrong answer so chunks, keywords or intents can be tuned.

## Phase 8 checklist
1. `npm test`: `src/domain/sqlParse.test.ts` covers masking, statements, INSERT/UPDATE columns and expressions, alias resolution, IF/ELSE guards, change comments and TRAQ linking on a small SQL sample.
2. Real files: open `/procedures` > Source procedures. Expect 14 procedures S00 to S13. Compare each against its SQL: statement count and targets, the IF/ELSE guards (e.g. `@TIMEKEY` cut-offs in DPD_Calculation), and the S00 test scenarios (about 30 listed in its header). Report any procedure where statements are missed, merged or mislabelled (the parser is regex based; T-SQL has unusual cases).
3. TRAQ traceability tab: see which procedures link to TRAQ columns and which show "no documented TRAQ link". Confirm FPM_DA_RULES rows appear where expected. Name matching can produce false positives or miss renamed columns: that is why links are labelled derived.
4. Rules page: derivation rules whose sheet is `SQL <file>` appear; Validation shows check C8 per procedure. Chatbot: ask "Where is DPD_Overdue set?" or "What does PRO.DPD_Calculation do?".
5. DD export: save each `dd_export.xlsx` as `dd_export.csv` (UTF-8) in its folder, then check the DD export tab; share one file's first rows so the parser can use its real structure.
6. `public/data/CrisMac_to_TRAQ_Combined.csv` must also be present (only an .xlsx was found in `public/data/`), otherwise every screen shows the missing-workbook error.

## Known limitations / follow-ups
- Source procedures: `dd_export` files are shown as raw tables until their structure is known. The SQL parser does not follow dynamic SQL, cursors or nested procedure calls; traceability is by name, not by data flow through the PRO working tables. Steps in NPA/SMA procedures that write non-TRAQ tables stay untraced.
- Chatbot: retrieval is keyword-based (no semantic matching, so paraphrases without shared words can miss), answers are template text rather than synthesized prose, and only the last few turns of history are used for pronoun follow-ups. The knowledge index (about one chunk per column) is built in the browser on the first question.
- shadcn/ui: components in `src/components/ui.tsx` are hand-authored in shadcn style (cva + tailwind-merge); swap for `npx shadcn add` components later if desired.
- Table lineage only; column lineage is traced on demand from mapping rows.
- Suggestion scoring thresholds (0.35, ambiguity gap 0.05) are arbitrary demo values.
- `Recp_*` sheets are treated as dictionary-only and excluded from coverage and mandatory-field validation.
- Large tables (DIM Tables unmapped list ~3,500 rows) rely on pagination, not virtualisation.
