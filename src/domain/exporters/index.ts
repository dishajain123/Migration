import { toCsv } from './csv';
import { toPdf } from './pdf';
import type { ExportDoc, ExportFormat, FormatInfo } from './types';
import { toXlsx } from './xlsx';

export type { ExportCell, ExportDoc, ExportFormat, ExportTable, FormatInfo } from './types';

export const EXPORT_FORMATS: FormatInfo[] = [
  { id: 'xlsx', label: 'Excel workbook', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', hint: 'One sheet per section, with header row, filters and wrapped text.' },
  { id: 'csv', label: 'CSV', ext: 'csv', mime: 'text/csv;charset=utf-8', hint: 'The main table only, UTF-8, opens in Excel and any data tool.' },
  { id: 'pdf', label: 'PDF report', ext: 'pdf', mime: 'application/pdf', hint: 'Printable landscape tables. Long text is shortened and non-Latin characters replaced.' },
  { id: 'json', label: 'JSON', ext: 'json', mime: 'application/json', hint: 'Every section as structured data, for scripts or a future backend.' },
];

const stamp = (iso: string) => iso.slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'export';

export interface BuiltExport { filename: string; mime: string; bytes: Uint8Array; rows: number }

/** Encode a document. Pure: returns bytes, never touches the DOM. */
export function buildExport(format: ExportFormat, doc: ExportDoc, baseName: string): BuiltExport {
  const info = EXPORT_FORMATS.find((f) => f.id === format) as FormatInfo;
  const enc = new TextEncoder();
  let bytes: Uint8Array;
  let rows = doc.sheets.reduce((a, s) => a + s.rows.length, 0);
  if (format === 'xlsx') bytes = toXlsx(doc);
  else if (format === 'pdf') bytes = toPdf(doc);
  else if (format === 'csv') {
    const sheet = doc.sheets[doc.csvSheet ?? 0] ?? doc.sheets[0];
    rows = sheet?.rows.length ?? 0;
    bytes = enc.encode(sheet ? toCsv(sheet) : '');
  } else {
    bytes = enc.encode(JSON.stringify({
      title: doc.title, subtitle: doc.subtitle, generatedAt: doc.generatedAt, source: doc.source,
      sections: doc.sheets.map((s) => ({
        name: s.name,
        rows: s.rows.map((r) => Object.fromEntries(s.columns.map((c, i) => [c, r[i] ?? '']))),
      })),
    }, null, 2));
  }
  return { filename: `${safe(baseName)}_${stamp(doc.generatedAt)}.${info.ext}`, mime: info.mime, bytes, rows };
}
