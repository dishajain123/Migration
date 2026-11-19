import { describe, expect, it } from 'vitest';
import { buildExport, type ExportDoc } from './index';
import { toCsv } from './csv';
import { crc32 } from './zip';

const doc: ExportDoc = {
  title: 'Test', generatedAt: '2026-11-17T10:30:00.000Z', source: 'unit test', csvSheet: 1,
  sheets: [
    { name: 'Summary', columns: ['Item', 'Value'], rows: [['a', 1]] },
    { name: 'Data: "x"/y', columns: ['A', 'B'], rows: [['plain', 'has, comma'], ['say "hi"', 'line\nbreak → arrow'], ['<&>', 5]] },
  ],
};
const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe('exporters', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('quotes CSV fields and starts with a BOM', () => {
    const csv = toCsv(doc.sheets[1]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('plain,"has, comma"');
    expect(csv).toContain('"say ""hi"""');
    expect(csv).toContain('"line\nbreak');
  });

  it('writes the chosen sheet to CSV with a dated file name', () => {
    const out = buildExport('csv', doc, 'my lineage!');
    expect(out.filename).toBe('my_lineage_20261117-1030.csv');
    expect(out.rows).toBe(3);
    expect(text(out.bytes)).toContain('plain');
  });

  it('builds a zip-based xlsx with one worksheet per section and escaped text', () => {
    const out = buildExport('xlsx', doc, 'x');
    expect(out.bytes[0]).toBe(0x50);
    expect(out.bytes[1]).toBe(0x4b);
    const raw = text(out.bytes);
    for (const p of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) expect(raw).toContain(p);
    expect(raw).toContain('&lt;&amp;&gt;');
    expect(raw).toContain('sheetId="2"');
    expect(raw).not.toContain('name="Data: ');
  });

  it('builds a PDF whose xref offsets point at the objects', () => {
    const out = buildExport('pdf', doc, 'x');
    const s = text(out.bytes);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    const start = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(start, start + 4)).toBe('xref');
    const first = /0000000000 65535 f \n(\d{10})/.exec(s)![1];
    expect(s.slice(Number(first), Number(first) + 7)).toBe('1 0 obj');
  });

  it('writes JSON with one object per row keyed by column', () => {
    const j = JSON.parse(text(buildExport('json', doc, 'x').bytes)) as { sections: { name: string; rows: Record<string, unknown>[] }[] };
    expect(j.sections[1].rows[0]).toEqual({ A: 'plain', B: 'has, comma' });
  });
});
