# CrisMAC → TRAQ AI Migration Platform (frontend demo)

Frontend-only demonstration of five agents over the CrisMAC→TRAQ workbook, scoped up to `FCT_PRODUCT_MASTER`.
There is no backend and no AI call. Every output is either workbook-derived, a deterministic check, or explicitly labelled **Simulated**.

## Run it

1. Copy `CrisMac_to_TRAQ_Combined.csv` into **`public/data/`** (the app reads it in the browser; no Excel needed).
2. `npm install`
3. `npm run dev` and open the printed URL.
4. `npm test` runs the parser/analysis unit tests; `npm run build` type-checks then bundles.

Optional env (see `.env.example`): `VITE_USE_MOCKS`, `VITE_API_BASE_URL`, `VITE_MOCK_LATENCY_MS`, `VITE_MOCK_ERROR_RATE` (set above 0 to test error states).

## Screens

| Route | Agent |
|---|---|
| `/` | Dashboard: scope, coverage, review progress, validation, readiness score |
| `/data-model` | 1 · Tables, columns, types, keys; source-vs-target compare; scope and known gaps |
| `/lineage` | 2 · React Flow table lineage; column trace up/downstream; edge mappings |
| `/procedures` | 3 · Referenced procedures/views/DI mappings, documented expressions, pasted-SQL analyzer |
| `/mapping` | 4 · Suggestions with confidence, approve/reject, documented mappings, unmapped, manual mapping |
| `/rules` | 5 · Extracted business rules with approval; validation (pass/warn/fail) |

### Source procedures and TRAQ traceability

`public/data/latest dd output/` holds 14 sample CrisMac stored procedures (SQL) and a `manifest.json` listing them. The Procedure Analyzer's **Source procedures** tab shows each in execution order: parameters, every statement with its target table, the expression assigned to each column and the IF/ELSE conditions around it, dated change comments, and a **TRAQ traceability** view linking written columns to TRAQ columns and related `FPM_DA_RULES` rows. Links are name matches, labelled derived; procedures with no link (for example NPA/SMA outputs) say so. Linked assignments also appear as derivation rules in Agent 5 (check C8 reports traceability), and the chatbot can answer questions about them. Save each `dd_export.xlsx` as `dd_export.csv` in its folder to view it in the DD export tab.

### Guidance assistant and sidebar

- The round button at the bottom-right opens a chat panel on every screen. Ask in plain language about tables, columns, lineage, mappings, procedures, business rules, workbook gaps or how to use the app. Answers cite their sources (worksheet/row, table, procedure or doc heading) and are labelled **Simulated**: they are assembled by keyword retrieval over the workbook-derived data and the project docs, with no AI model. If the answer is not in them, it says so. Drag the panel's top-left corner to resize it; history lasts for the browser tab session.
- The sidebar collapses to icons with the arrow button (hover an icon for its name) and can be resized by dragging its right edge; dragging far left collapses it.

Review decisions (mapping approvals, manual mappings, rule approvals, procedures marked analysed) persist in browser `localStorage` and feed the dashboard and Agent 5's validation.

## Layout

`src/domain` (pure logic: CSV parser, lineage, suggestions, validation, rules, procedures) → `src/services` (interfaces, mock + HTTP implementations) → `src/stores` → `src/features/*` → `src/components`.

Read `CLAUDE.md`, `docs/DATA_DICTIONARY.md` (including the known workbook gaps) and `docs/ARCHITECTURE.md` first.
