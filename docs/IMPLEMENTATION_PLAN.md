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
| 8 Source procedure SQL + TRAQ traceability | `domain/{sqlParse,procTrace}`, `services/procSource`, `features/procedures/SourceProcedures`, rules C8, chatbot knowledge | Written, **unverified**; `dd_export.csv` now present for all 14 sample procedures under `public/data/latest dd output/` |
| 7 Guidance chatbot + sidebar | Real AI RAG assistant: `server/src/chatbot` (orchestrator, grounded prompt, streaming) + `server/src/retrieval` (BM25 + exact-name match, embeddings when a key is configured), `src/services/chat/assistant.ts` (gateway sync), `src/domain/{knowledge,retrieval}`, `components/chat`, `stores/{chatStore,layoutStore}`, `Layout` sidebar collapse and drag-resize. The earlier template pipeline (`pipeline.ts`, `mockPipeline.ts`, `mock/chat.ts`) is kept only for suggested questions and tests. | Written, **unverified** (typecheck, build, tests and browser checks pending) |
| 7b AI gateway, guardrails, voice | `server/` local gateway process (per-user key storage, encrypted at rest, `server/src/crypto.ts`), Agents 1-5 opt-in AI features (`src/services/ai/agentAi.ts`, `AiInsightPanel`, prompts in `src/domain/aiPrompts.ts`), deterministic input/output guardrails (`server/src/guardrails/`), browser-native voice input/output (`src/services/voice/{speechToText,textToSpeech}.ts`) and Voice Conversation Mode toggle in `ChatPanel.tsx`. See `docs/AI_GATEWAY.md`. | Written, **unverified** |
| 9 Agent 2 column-level flow explorer | `domain/lineageFlow`, `services/*/lineage` (`getCatalog`, `getFlow`), `features/lineage/{LineagePage,TablePicker,FlowCanvas,TableNode,FlowDetails,ColumnTrace,flowStyle}`, `components/InfoTip`, motion CSS in `index.css` | Written, **unverified** (no shell: not compiled or run) |
| 10 CrisMac SQL -> TRAQ rule migration (Agent 5, linked from Agent 3) | `domain/ruleConversion/{intake,sqlExpr,resolve,translate,convert,templates,views}`, `domain/sqlParse` (MERGE, JOIN/WHERE, unclipped expressions, structured guards), `services/{mock/ruleConversion,fileRead}`, `stores/conversionStore`, `features/rules/conversion/*`, `components/Dialog`, `lib/download` | Written; **type-checked via the editor's TypeScript diagnostics (0 errors)**, tests written but not run (no shell) |
| 11 Application-wide UX pass | InfoTip and tooltips on every screen, empty/loading states, confirmation dialogs, motion | **Started** - a read-only audit (not vague impressions; concrete file:line findings) covered the Dashboard, auth/shell, Agent 1 (Data Model), AI Settings, Agent 2 (Lineage), Agent 3 (Procedures), the chatbot/sidebar, Agent 4 (Mapping) and Agent 5 (Rules + rule conversion); the concrete, low-risk findings were implemented (content moved into `InfoTip`s instead of always-visible paragraphs on Dashboard/Mapping/Procedures/AI Settings; a missing confirmation dialog added to Agent 4's bulk-approve; a misleading same-color badge, a stale "no AI service is called" sidebar claim, and several overflow/accessibility gaps fixed - see backlog for the full list and what's still open). Login/Signup and Reports/Export screens were not yet audited. |

## Enhancement backlog: priorities and acceptance criteria
Requested as one enhancement; delivered one phase per cycle (CLAUDE.md). Priority order: P1 lineage (done, pending verification), P2 SQL-to-CSV conversion, P3 UX pass on remaining screens.

### P1 - Phase 9 Lineage (acceptance criteria)
1. Table picker lists every table that appears in a documented mapping (count equals `tableCatalog` length) with search and layer/system filters; filters never change the selection.
2. Selecting a table draws it plus all upstream and downstream tables to the chosen depth (1-4 or All); with Upstream off no upstream table appears, likewise Downstream.
3. Every drawn arrow is one or more workbook mapping rows; its detail shows source table/column, target table/column, MAP TYPE, remark verbatim (or "Not provided in workbook") and sheet/row.
4. Direct (DIRECT/RENAME), transformed (any other MAP TYPE) and blank MAP TYPE are visually distinct and in the legend; arrows have heads; flow runs left to right.
5. Zoom, pan, fit, minimap, collapse/expand per table and for all, show-all columns, Auto-arrange, drag a node.
6. Clicking a table highlights its upstream (blue) and downstream (green) path and dims the rest; clicking a column opens the multi-hop trace.
7. A default graph (FCT_PRODUCT_MASTER, depth 2) has at most about 10 rows per table and no overlapping nodes (layout assigns heights from visible rows).
8. Loading, error, empty (no selection, no lineage) and success states exist; a guidance card explains the four steps; `npm test` passes `lineageFlow.test.ts`; `npm run build` succeeds.

### P2 - Phase 10 SQL-to-CSV rule conversion (planned acceptance criteria)
1. First task: search the workbook for a documented TRAQ rule template. FPM_DA_RULES (columns RUN, TRAQ COLUMN, KIND, DATATYPE, RULE, IN FORCE FROM, CRISMAC, READS, LOGIC, EXPRESSION, VERSION) is the only candidate; if it is used as the target schema it is labelled "from workbook", otherwise an editable illustrative template labelled "Illustrative".
2. Upload accepts multiple `.sql` files by drag-and-drop or picker; rejects other types, empty files and files over a size limit with a visible message; shows a preview and per-file status.
3. Extraction reuses `domain/sqlParse` (no second parser) and lists per file: procedure name, source/target tables, columns written, INSERT/UPDATE/MERGE steps, JOIN and WHERE text, CASE expressions, defaults, guards and called procedures. Unsupported constructs (MERGE, dynamic SQL, cursors if not parsed) are listed, never silently dropped. Everything is labelled as parser output, not AI.
4. Mapping workspace: each extracted rule maps to template columns; unmappable fields are highlighted; manual edits persist; each row has status, a labelled-Simulated confidence and Approve/Reject.
5. Export is blocked while a mandatory template field is empty, with the offending rows listed; CSV downloads with exact template headers and correct quoting; a summary shows counts of converted, needs-review and unsupported rules.
6. All of it sits behind a `RuleConversionService` interface (mock now, FastAPI later); unit tests cover extraction-to-row mapping, validation and CSV escaping.

### P3 - Phase 11 UX pass (planned acceptance criteria)
1. Every screen header has an InfoTip (what, why, how); technical terms (MAP TYPE, staging, mart, upstream, guard) use `Term` or a tooltip; icon-only buttons have `aria-label` and a title.
2. Every async view shows loading, error with Retry, empty with a next step, and success; destructive or bulk actions (reject, reset, clear approvals) ask for confirmation in an accessible dialog.
3. Motion limited to: sidebar width, popovers/modals, tab content, expanders, toasts, graph highlight; none runs when `prefers-reduced-motion` is set. No new animation dependency unless installed and built (Framer Motion needs `npm install`; CSS is used until then).
4. Layout checked at 375, 768, 1280 px: no horizontal page scroll, controls reachable, graph and tables scroll inside their cards.

**Installment 1 (this cycle) - done:** `MappingPage`, `DashboardPage`, `ProceduresPage` and `AiSettingsPage` headers shortened to one line with the detail moved into an `InfoTip`; `MappingStep`'s `InfoTip` split into scannable bullets. Agent 4's "Approve all pending shown" bulk action now has a `ConfirmDialog` (was missing - every other bulk/destructive action already had one). `MappingBadge`'s `suggested` status no longer shares the same color as `missing` (was `'bad'`/`'bad'`, now `'info'`/`'bad'` - a reviewer can tell "a real lead" from "nothing" by color again). `Layout.tsx`'s sidebar footer no longer claims "no AI service is called" (stale since the Phase 7 chatbot shipped). Overflow/accessibility fixes: `ConversionWorkspace` step nav breakpoint (`sm:grid-cols-3` was 3-wide on mid-size laptop windows, now `md:grid-cols-5`), `ExportStep`'s preview table (every column shared one `max-w`, now only long-text fields do), `DataModelPage`'s search input (was `w-full`, forced both filter selects onto a second line), `SourceProcedures`' guard column (no wrap, could overflow), `FlowCanvas`'s top-left toolbar (`flex-wrap` safety net), `ColumnTrace`'s indent (capped at depth 4 so a deep trace doesn't run off the details panel). Accessibility: chat panel resize handles (`ChatPanel.tsx`) now match the sidebar's pattern (`role="separator"`, keyboard arrow-key resize, focus-visible highlight - previously `aria-hidden` and mouse-only); truncated-text cells that relied solely on a native `title` (lineage "Mentioned with", Agent 1's relationship remark and compatibility note, Agent 3's Joins/Conditions columns) now also show a `cursor-help` dotted-underline cue. Agent 3's Catalogue tab no longer shows a contradictory "Not provided in workbook" badge for the 14 procedures that do have SQL (now links to the fact that it's on the Source procedures tab).

**Still open for a later cycle:** Login/Signup and Reports/Export screens (not yet audited); `SourceProcedures.tsx`'s several card subtitles that explain implementation detail inline rather than in an `InfoTip`; a guided first-run onboarding tour; responsive checks at the exact 375/768/1280px breakpoints with the app actually running (no shell access this cycle, so layout changes are reasoned from the Tailwind classes, not screenshotted).

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

## Phase 9 checklist
1. `npm test`: `src/domain/lineageFlow.test.ts` (traversal, depth, direction, direct/transformed, grouping, layout) on the small fixture.
2. `/lineage`: FCT_PRODUCT_MASTER is preselected. Tick another table, change depth and direction, toggle "TRAQ tables only" and "Include NOT USED links". Check each acceptance criterion under P1.
3. Check on the real workbook: column counts per table node vs Agent 1, a known DIRECT row and a known DERIVED row (remark text matches the sheet), and that a very wide table (FCT_PRODUCT_MASTER, 186 columns) shows 10 rows plus "show all".
3b. Layout and fullscreen (`hooks/useFullscreen`, `FlowCanvas` toolbar): the diagram is full width below the picker (about 82vh). Click Fullscreen: options bar, graph, minimap, legend and details panel fill the screen; zoom, pan, expand/collapse, column and arrow clicks, and path highlighting still work; Exit fullscreen or Esc returns with the same selection, collapsed tables and pick, and the graph re-fits with no blank area. Also test with the browser Fullscreen API blocked (falls back to a fixed overlay) and at 375 px width.
3c. Export (`domain/exporters/*`, `components/ExportMenu`, `domain/lineageExport`): the Export menu in the diagram options bar downloads the current lineage as Excel (.xlsx, 4 sheets), CSV (column mappings), PDF and JSON, no libraries. `npm test` runs `exporters.test.ts`. By hand: open the .xlsx in Excel (it should open without a repair prompt; if it does prompt, report it), the PDF in a viewer, and confirm remark text matches the workbook. Other screens can reuse it by building an `ExportDoc` and rendering `ExportMenu`.
4. Known risks to look for first: React Flow handle ids with unusual column names, edge labels overlapping when many arrows share a pair, layout when a table sits in a cycle.

## Phase 10 checklist (rule migration)
1. `npm test`: `src/domain/ruleConversion/ruleConversion.test.ts` covers the parser additions (MERGE, JOINs, guards, MERGE JOIN hint), expression translation, mapping tiers, statement composition, parameter folding, failed rules, templates and export checks.
2. `/rules` opens on "CrisMac SQL → TRAQ rules". Step 1: Use the 14 sample procedures; also drag a .sql file and a .txt file (rejected with a message); preview a file.
3. Step 2: compare DPD_Calculation's statement list, joins and conditions with its SQL (line links open the preview at those lines).
4. Step 3: set @TIMEKEY (e.g. 26400) and watch rules re-convert; map one "Not mapped" column with Map and confirm it appears in Agent 4 (Mapping) as a manual mapping.
5. Step 4: open PRO.AccountCal DPD_Overdue -> FCT_PRODUCT_MASTER.OVERDUE_DPD: the expression must use FCT_PRODUCT_MASTER columns only, with the zero floor wrapping the DATEDIFF branch. Compare with `dd_export.csv` row DPD_Overdue (CrisMac names) to see the difference. Edit the expression, approve, reject, reset (confirmation).
6. Step 5: with no date set the download is blocked (Effective Start Date). Set it, approve some rules, download CSV and Excel; open both; headers must equal the dd_export header (or FPM_DA_RULES row 4). Download the conversion report.
7. Report rules whose translation reads wrongly: the translator only uses syntax seen in FPM_DA_RULES and flags the rest, but T-SQL has many forms.

## Known limitations / follow-ups
- Source procedures: `dd_export.csv` files are now present for all 14 sample procedures and are shown as raw tables exactly as exported (header + rows verbatim), since their row/column structure is workbook data, not something to reshape. The SQL parser does not follow dynamic SQL, cursors or nested procedure calls; traceability is by name, not by data flow through the PRO working tables. Steps in NPA/SMA procedures that write non-TRAQ tables stay untraced.
- Chatbot (Phase 7, superseded): the real AI RAG assistant retrieves with BM25 + exact object-name match, fused with embeddings via reciprocal-rank fusion when an OpenAI/Gemini key is configured (`server/src/retrieval/hybrid.ts`), and streams a synthesized, cited answer from the user's active provider/model (`server/src/chatbot/orchestrator.ts`). It falls back to keyword-only retrieval with no model call when nothing relevant is found and there is no history. The template pipeline (`pipeline.ts`, `mockPipeline.ts`, `mock/chat.ts`) remains only for suggested questions and tests; the live chat panel calls `services.assistant.askStream`, not the template path. See `docs/AI_GATEWAY.md`.
- shadcn/ui: components in `src/components/ui.tsx` are hand-authored in shadcn style (cva + tailwind-merge); swap for `npx shadcn add` components later if desired.
- Agent 2 now draws column-level mappings for the selected tables. "Procedures" on an arrow are workbook objects mentioned together with both tables (name co-occurrence, not a documented link). Direct vs transformed is derived from MAP TYPE only; the workbook has no SQL for the transformations, so the remark text is all that is shown.
- Rule migration: one rule per CrisMac column per procedure; the same TRAQ column derived by two procedures is flagged at export (TRAQ keeps one derivation) but not merged automatically. Columns read that were set earlier in the same procedure are flagged as an ordering dependency, not inlined. Cross-table reads use `FK_<TABLE>` links only when such a column exists in the workbook; otherwise flagged. Decision tables are not generated. Statements inside WHILE loops, cursors and dynamic SQL are flagged, not converted. Reviewer decisions persist in localStorage only.
- Framer Motion is not used: nothing could be installed here. CSS keyframes (`anim-pop`, `anim-fade`, `anim-slide-up`) cover Phase 9; revisit in Phase 11.
- Suggestion scoring thresholds (0.35, ambiguity gap 0.05) are arbitrary demo values.
- `Recp_*` sheets are treated as dictionary-only and excluded from coverage and mandatory-field validation.
- Large tables (DIM Tables unmapped list ~3,500 rows) rely on pagination, not virtualisation.
