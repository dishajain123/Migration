---
name: sql-procedure-analysis
description: Analyse procedures/views/DI mappings and the 14 sample procedure SQL files. Use for Agent 3 and procedure-to-TRAQ traceability.
---
- The workbook contains NO SQL bodies. Catalogue only referenced objects (E_TRAQ_* views, RECP.PRC_FCT_BUYOUT_DETAIL_LOAD, m_TRAQ_*_NPA_4X mappings, wf_* workflows) with the documented source/target/operation from banners and REMARKs.
- Exception: 14 sample CrisMac procedures ship as SQL beside the workbook in `public/data/latest dd output/<proc>/` (listed in `manifest.json`, execution order from the `NN_SXX_` file prefix). Add a procedure by adding its folder entry to `manifest.json`.
- SQL is analysed in `src/domain/sqlParse.ts` (regex + state machine, deterministic, not AI): statements, target tables, columns assigned with their expressions, tables read, enclosing IF/ELSE conditions, header, parameters, dated change comments. It reports only what the text says; never guess dynamic SQL or invent logic.
- TRAQ traceability (`src/domain/procTrace.ts`) uses only (1) written column names equal to TRAQ column names (case and underscores ignored, names under 5 characters ignored) and (2) FPM_DA_RULES rows that name the procedure or a written column. Label links "derived (name match)". Do NOT generate TRAQ/Oracle SQL; no source exists for it. Procedures with no link are reported as having no documented TRAQ target (their outputs may be NPA/SMA tables, which are out of scope).
- Linked assignments become Agent 5 `derivation` rules (origin `derived`, provenance = SQL file and line); check C8 reports traceability per procedure. The chatbot indexes the same data.
- `dd_export.xlsx` is binary and never parsed in the browser: export it to `dd_export.csv` in the same folder. The viewer shows the header and rows as found.
- Display embedded expressions that ARE in the workbook (DATEDIFF/CASE/GREATEST forms) verbatim, with a plain-language explanation labelled `Simulated`.
- Operation type for workbook-only objects is shown only when stated (e.g. "delete the period, read, write"); else "Not specified".
- Keep the paste-SQL analyzer (client-side only, no external calls).
