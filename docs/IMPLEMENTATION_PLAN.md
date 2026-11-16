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

## Known limitations / follow-ups
- shadcn/ui: components in `src/components/ui.tsx` are hand-authored in shadcn style (cva + tailwind-merge); swap for `npx shadcn add` components later if desired.
- Table lineage only; column lineage is traced on demand from mapping rows.
- Suggestion scoring thresholds (0.35, ambiguity gap 0.05) are arbitrary demo values.
- `Recp_*` sheets are treated as dictionary-only and excluded from coverage and mandatory-field validation.
- Large tables (DIM Tables unmapped list ~3,500 rows) rely on pagination, not virtualisation.
