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

Review decisions (mapping approvals, manual mappings, rule approvals, procedures marked analysed) persist in browser `localStorage` and feed the dashboard and Agent 5's validation.

## Layout

`src/domain` (pure logic: CSV parser, lineage, suggestions, validation, rules, procedures) → `src/services` (interfaces, mock + HTTP implementations) → `src/stores` → `src/features/*` → `src/components`.

Read `CLAUDE.md`, `docs/DATA_DICTIONARY.md` (including the known workbook gaps) and `docs/ARCHITECTURE.md` first.
