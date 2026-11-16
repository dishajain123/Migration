---
name: data-lineage-visualization
description: Build table- and column-level lineage graphs with React Flow. Use for Agent 2.
---
- Layers left to right: CrisMac source -> RECEPTION -> STAGING -> MART (dims, facts, uploads) -> FCT_PRODUCT_MASTER (stop here).
- Edges come from mapping rows (shape B/C sheets) and banners; edge label = MAP TYPE; store `sheet,rowNo`.
- Table-level graph derived by aggregating column edges; click an edge to show column mappings and transformation text (e.g. DPD expressions).
- Use dagre/elk layout, minimap, filters by layer/source system, highlight upstream/downstream of selection.
- Do not draw edges the workbook does not state. Out-of-scope downstream nodes are omitted.
