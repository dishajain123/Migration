# Agent Design

| Agent | Responsibility | Real data from workbook | Simulated |
|---|---|---|---|
| 1 Data Model | Browse tables/columns/types/keys, source vs target comparison | table & column metadata, banner PKs | type-equivalence hints |
| 2 Lineage | Internal TRAQ flow + CrisMac->TRAQ lineage, table/column level | mapping rows, flow diagram layers | none |
| 3 Procedures | Catalogue procedures/views/mappings and documented logic; analyse the 14 sample procedure SQL files and trace them to TRAQ columns | object names, expressions in REMARKs, banners, verbatim SQL of the 14 sample procedures (statements, assigned columns, conditions, change comments), FPM_DA_RULES links | plain-language explanations; name-match links are derived, not documented mappings; no SQL bodies for other objects |
| 4 Mapping | Suggest/review mappings, confidence, issues | existing mappings, MAP TYPE | confidence %, suggestions |
| 5 Rules | Extract/validate/approve rules | NULL flags, constants, lookups, FPM_DA_RULES | pass/fail/warn for undocumented checks |

Guidance assistant (not an agent screen): a floating chatbot answers questions about tables, columns, lineage, mappings, procedures, rules, known gaps and how to use the platform. Real data: every answer is assembled from workbook-derived chunks, the project docs and the platform guide, with sources listed. Simulated: the retrieval and templating itself (no AI model), so every answer carries a Simulated badge. When nothing relevant is retrieved it says so rather than guessing.

Workflow: Model (understand) -> Lineage (trace) -> Procedures (logic) -> Mapping (decide) -> Rules (validate) -> Dashboard readiness.

How the agents connect (Phase 6):
- Data Model table detail links to `/lineage?table=` and `/mapping?table=` (deep links pre-select the table).
- Approved and manually entered mappings (Agent 4, stored in `reviewStore`) are sent to Agent 5's `validate` as `reviewed`, producing check C7.
- Dashboard readiness combines column coverage, validation pass rate and review completion across agents 3-5 (formula shown on the page; not an AI score).
- Data Model > Scope & gaps can download the full structured metadata as JSON (`exportMetadata`).
