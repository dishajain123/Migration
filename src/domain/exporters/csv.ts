import type { ExportTable } from './types';

const needsQuote = /[",\r\n]/;

function cell(v: string | number): string {
  const s = String(v);
  return needsQuote.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV with CRLF line ends and a UTF-8 BOM so Excel reads accented text correctly. */
export function toCsv(t: ExportTable): string {
  const lines = [t.columns, ...t.rows].map((r) => r.map(cell).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
