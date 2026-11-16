# Agent Design

| Agent | Responsibility | Real data from workbook | Simulated |
|---|---|---|---|
| 1 Data Model | Browse tables/columns/types/keys, source vs target comparison | table & column metadata, banner PKs | type-equivalence hints |
| 2 Lineage | Internal TRAQ flow + CrisMac->TRAQ lineage, table/column level | mapping rows, flow diagram layers | none |
| 3 Procedures | Catalogue procedures/views/mappings and documented logic | object names, expressions in REMARKs, banners | plain-language explanations; no SQL bodies exist |
| 4 Mapping | Suggest/review mappings, confidence, issues | existing mappings, MAP TYPE | confidence %, suggestions |
| 5 Rules | Extract/validate/approve rules | NULL flags, constants, lookups, FPM_DA_RULES | pass/fail/warn for undocumented checks |

Workflow: Model (understand) -> Lineage (trace) -> Procedures (logic) -> Mapping (decide) -> Rules (validate) -> Dashboard readiness.

How the agents connect (Phase 6):
- Data Model table detail links to `/lineage?table=` and `/mapping?table=` (deep links pre-select the table).
- Approved and manually entered mappings (Agent 4, stored in `reviewStore`) are sent to Agent 5's `validate` as `reviewed`, producing check C7.
- Dashboard readiness combines column coverage, validation pass rate and review completion across agents 3-5 (formula shown on the page; not an AI score).
- Data Model > Scope & gaps can download the full structured metadata as JSON (`exportMetadata`).
