---
name: data-lineage-visualization
description: Build table- and column-level lineage graphs with React Flow. Use for Agent 2.
---
- Layers left to right: CrisMac source -> RECEPTION -> STAGING -> MART (dims, facts, uploads) -> FCT_PRODUCT_MASTER (stop here).
- Edges come from mapping rows (shape B/C sheets) and banners; edge label = MAP TYPE; store `sheet,rowNo`.
- Table-level graph derived by aggregating column edges; click an edge to show column mappings and transformation text (e.g. DPD expressions).
- Use a layered layout, minimap, filters by layer/source system, highlight upstream/downstream of selection. No layout library is installed: `layoutFlow` in `src/domain/lineageFlow.ts` does ranking, crossing reduction and stacking; add dagre/elk only after `npm install` works and keep it behind that function.
- Phase 9 (column-level): `buildFlow(model, FlowRequest)` returns tables with their involved columns plus column edges; `groupEdges` merges arrows per drawn handle pair; `visibleColumnMap` caps rows (10) and honours collapse/show-all. Handle ids are `s:<column>` / `t:<column>`, with `*` for the table header when a column row is not drawn, so an edge never points at a missing handle.
- Direct vs transformed is derived from MAP TYPE (DIRECT/RENAME vs the rest); never infer transformation logic beyond the remark text. Procedures on an arrow are name co-mentions, label them as such.
- Do not draw edges the workbook does not state. Out-of-scope downstream nodes are omitted.
