---
name: sql-procedure-analysis
description: Analyse procedures/views/DI mappings. Use for Agent 3.
---
- The workbook contains NO SQL bodies. Catalogue only referenced objects (E_TRAQ_* views, RECP.PRC_FCT_BUYOUT_DETAIL_LOAD, m_TRAQ_*_NPA_4X mappings, wf_* workflows) with the documented source/target/operation from banners and REMARKs.
- Display embedded expressions that ARE in the workbook (DATEDIFF/CASE/GREATEST forms) verbatim, with a plain-language explanation labelled `Simulated`.
- Operation type (INSERT/UPDATE/MERGE) is shown only when stated (e.g. "delete the period, read, write"); else "Not specified".
- Provide a paste-SQL area for future real analysis (client-side parse only, no external calls).
