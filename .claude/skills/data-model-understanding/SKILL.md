---
name: data-model-understanding
description: Parse and present CrisMAC/TRAQ schemas from the workbook. Use for Agent 1 and for any metadata extraction.
---
- Read docs/DATA_DICTIONARY.md first; sheet shapes A/B/C define how to parse columns.
- Extract with `scripts/extract-workbook.ts` into `src/data/generated/*.json`; keep `sheet` and `rowNo` on every record.
- Distinguish MART DIM_* (live) from DH2.0 Dim_* (dictionary); do not merge by case.
- Declared column count (banner) vs listed rows can differ: show both, never silently reconcile.
- Keys/relationships: only those stated in banners/remarks; mark the rest "not documented".
- Compare CrisMac (SQL Server types) vs TRAQ (Oracle types) using a documented type-equivalence table.
