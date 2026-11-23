import type { FlowKind, LineageFlow } from '@/types';
import type { ExportDoc } from './exporters';

const KIND: Record<FlowKind, string> = { direct: 'Direct copy', transformed: 'Transformed', unspecified: 'Type not stated' };

/**
 * Turns the lineage currently on screen into an exportable document. Rows are workbook mapping rows; nothing is
 * added. Column and table sections cover everything in the flow, not only the rows visible after collapsing.
 */
export function lineageExportDoc(flow: LineageFlow, generatedAt: string = new Date().toISOString()): ExportDoc {
  const r = flow.request;
  const s = flow.stats;
  const none = 'Not provided in workbook';
  return {
    title: 'Data flow and lineage',
    subtitle: `Selected: ${r.tables.join(', ') || 'none'}`,
    generatedAt,
    source: 'Workbook-derived (CrisMac to TRAQ mapping rows)',
    csvSheet: 1,
    sheets: [
      {
        name: 'Summary',
        columns: ['Item', 'Value'],
        rows: [
          ['Selected tables', r.tables.join(', ')],
          ['Upstream traced', r.upstream ? 'Yes' : 'No'],
          ['Downstream traced', r.downstream ? 'Yes' : 'No'],
          ['Depth', r.depth === 0 ? 'All levels' : r.depth],
          ['TRAQ tables only', r.internalOnly ? 'Yes' : 'No'],
          ['NOT USED links included', r.includeNotUsed ? 'Yes' : 'No'],
          ['Tables in flow', flow.tables.length],
          ['Upstream tables', s.upstream],
          ['Downstream tables', s.downstream],
          ['Table-to-table links', flow.tableEdges.length],
          ['Column mappings', flow.columnEdges.length],
          ['Direct copies', s.direct],
          ['Transformed', s.transformed],
          ['Type not stated', s.unspecified],
          ['Without documented lineage', flow.untraceable.join(', ') || 'None'],
          ['Classification', 'Direct = MAP TYPE DIRECT or RENAME; Transformed = any other MAP TYPE; derived from MAP TYPE only'],
        ],
      },
      {
        name: 'Column mappings',
        columns: ['Source table', 'Source column', 'Target table', 'Target column', 'Kind', 'MAP TYPE', 'Transformation logic', 'Workbook sheet', 'Row'],
        rows: flow.columnEdges.map((e) => [
          e.sourceTable, e.sourceColumn || '(no source column)', e.targetTable, e.targetColumn, KIND[e.kind], e.mapType,
          e.transformation || (e.kind === 'direct' ? '' : none), e.sheet, e.rowNo,
        ]),
      },
      {
        name: 'Table links',
        columns: ['Source table', 'Target table', 'Column mappings', 'Mentioned together with (name match, not a documented link)'],
        rows: flow.tableEdges.map((e) => [e.source, e.target, e.count, e.procedures.map((p) => p.name).join(', ')]),
      },
      {
        name: 'Tables',
        columns: ['Table', 'System', 'Layer', 'Role', 'Level (0 = origin)', 'Columns in flow', 'Total columns'],
        rows: [...flow.tables]
          .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
          .map((t) => [t.name, t.system, t.layer, t.role === 'selected' ? 'Selected' : t.role === 'upstream' ? 'Upstream' : 'Downstream', t.rank, t.columns.length, t.columnCount || '']),
      },
    ],
  };
}
