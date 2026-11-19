import type { ExportDoc, ExportTable } from './types';

/*
 * Dependency-free PDF writer: landscape A4 tables in Helvetica (WinAnsi). Long cells wrap (capped at MAX_LINES);
 * the header row repeats on every page. Characters outside Latin-1 are replaced, so use the Excel/CSV/JSON
 * formats when exact text matters.
 */

const W = 842;
const H = 595;
const M = 32;
const SIZE = 7;
const LEAD = 9;
const PAD = 3;
const CHAR_W = SIZE * 0.56; // conservative average glyph width so text stays inside its column
const MAX_LINES = 8;
const FOOTER_Y = 18;

const REPLACE: Record<string, string> = { '→': '->', '←': '<-', '—': '-', '–': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '•': '*', ' ': ' ' };

function clean(s: string): string {
  let out = '';
  for (const ch of s) {
    const r = REPLACE[ch];
    if (r !== undefined) { out += r; continue; }
    const c = ch.charCodeAt(0);
    out += c === 9 ? ' ' : c < 32 && c !== 10 ? '' : c >= 0x80 && c <= 0x9f ? '?' : c > 0xff ? '?' : ch;
  }
  return out;
}

const pdfStr = (s: string) => `(${s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;

function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const para of clean(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > maxChars) {
        if (line) { lines.push(line); line = ''; }
        lines.push(w.slice(0, maxChars));
        w = w.slice(maxChars);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= maxChars) line += ` ${w}`;
      else { lines.push(line); line = w; }
    }
    lines.push(line);
  }
  if (lines.length > MAX_LINES) {
    const kept = lines.slice(0, MAX_LINES);
    kept[MAX_LINES - 1] = `${kept[MAX_LINES - 1].slice(0, Math.max(0, maxChars - 3))}...`;
    return kept;
  }
  return lines;
}

function columnWidths(t: ExportTable): number[] {
  const weights = t.columns.map((c, ci) => {
    const lens = t.rows.slice(0, 300).map((r) => String(r[ci] ?? '').length);
    const avg = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
    return Math.min(60, Math.max(8, c.length, Math.round(avg)));
  });
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map((w) => ((W - 2 * M) * w) / total);
}

class Page {
  ops: string[] = [];
  text(x: number, y: number, s: string, size = SIZE, bold = false, grey = false) {
    this.ops.push(`BT ${grey ? '0.4 g' : '0 g'} /F${bold ? 2 : 1} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td ${pdfStr(clean(s))} Tj ET`);
  }
  fill(x: number, y: number, w: number, h: number, rgb: string) {
    this.ops.push(`${rgb} rg ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f 0 g`);
  }
  line(x1: number, y: number, x2: number) {
    this.ops.push(`0.85 G 0.4 w ${x1.toFixed(1)} ${y.toFixed(1)} m ${x2.toFixed(1)} ${y.toFixed(1)} l S`);
  }
}

export function toPdf(doc: ExportDoc): Uint8Array {
  const pages: Page[] = [];
  const newPage = () => { const p = new Page(); pages.push(p); return p; };

  doc.sheets.forEach((t, si) => {
    const widths = columnWidths(t);
    const xs = widths.reduce<number[]>((acc, w, i) => { acc.push(i === 0 ? M : acc[i - 1] + widths[i - 1]); return acc; }, []);
    const maxChars = widths.map((w) => Math.max(3, Math.floor((w - 2 * PAD) / CHAR_W)));
    let page = newPage();
    let y = H - M;
    page.text(M, y - 10, si === 0 ? doc.title : t.name, 13, true);
    y -= 16;
    if (si === 0 && doc.subtitle) { page.text(M, y - 8, doc.subtitle, 8, false, true); y -= 12; }
    if (si !== 0 || doc.sheets.length > 1) { page.text(M, y - 9, si === 0 ? `Section: ${t.name}` : doc.title, 8, false, true); y -= 14; }
    y -= 4;

    const header = (p: Page) => {
      const lines = t.columns.map((c, ci) => wrap(c, maxChars[ci]));
      const h = Math.max(...lines.map((l) => l.length), 1) * LEAD + 2 * PAD;
      p.fill(M, y - h, W - 2 * M, h, '0.91 0.91 0.98');
      lines.forEach((ls, ci) => ls.forEach((l, li) => p.text(xs[ci] + PAD, y - PAD - SIZE - li * LEAD, l, SIZE, true)));
      y -= h;
    };
    header(page);

    if (t.rows.length === 0) page.text(M + PAD, y - PAD - SIZE, 'No rows.', SIZE, false, true);
    for (const row of t.rows) {
      const cells = t.columns.map((_, ci) => wrap(String(row[ci] ?? ''), maxChars[ci]));
      const h = Math.max(...cells.map((l) => l.length), 1) * LEAD + 2 * PAD;
      if (y - h < M + 14) { page = newPage(); y = H - M; header(page); }
      cells.forEach((ls, ci) => ls.forEach((l, li) => page.text(xs[ci] + PAD, y - PAD - SIZE - li * LEAD, l)));
      y -= h;
      page.line(M, y, W - M);
    }
  });

  pages.forEach((p, i) => {
    p.text(M, FOOTER_Y, `${doc.title} · ${doc.source} · generated ${doc.generatedAt.slice(0, 16).replace('T', ' ')}`, 6.5, false, true);
    p.text(W - M - 40, FOOTER_Y, `Page ${i + 1} of ${pages.length}`, 6.5, false, true);
  });

  // Objects: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, then (content, page) pairs.
  const objs: string[] = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${6 + 2 * i} 0 R`).join(' ')}] >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  pages.forEach((p, i) => {
    const content = p.ops.join('\n');
    objs[5 + 2 * i] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    objs[6 + 2 * i] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`;
  });

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  // Every character is <= 0xFF (see clean), so one char is one byte.
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
