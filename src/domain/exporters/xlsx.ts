import type { ExportDoc, ExportTable } from './types';
import { zipStore, type ZipEntry } from './zip';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAX_CELL = 32000; // Excel's limit is 32,767 characters

const esc = (s: string) =>
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colLetter(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Excel sheet names: max 31 chars, none of []:*?/\ , unique ignoring case. */
function sheetNames(sheets: ExportTable[]): string[] {
  const used = new Set<string>();
  return sheets.map((s, i) => {
    const base = (s.name.replace(/[[\]:*?/\\]/g, ' ').trim() || `Sheet${i + 1}`).slice(0, 31);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - String(n).length - 1)}_${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

function textCell(ref: string, v: string, style: number): string {
  const t = v.length > MAX_CELL ? `${v.slice(0, MAX_CELL)}...` : v;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(t)}</t></is></c>`;
}

function sheetXml(t: ExportTable): string {
  const widths = t.columns.map((c, ci) => {
    const longest = Math.max(c.length, ...t.rows.slice(0, 200).map((r) => String(r[ci] ?? '').length));
    return Math.min(60, Math.max(10, longest + 2));
  });
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const head = `<row r="1">${t.columns.map((c, ci) => textCell(`${colLetter(ci)}1`, c, 1)).join('')}</row>`;
  const body = t.rows.map((r, ri) => {
    const cells = r.map((v, ci) => {
      const ref = `${colLetter(ci)}${ri + 2}`;
      return typeof v === 'number' && Number.isFinite(v) ? `<c r="${ref}"><v>${v}</v></c>` : textCell(ref, String(v), 2);
    });
    return `<row r="${ri + 2}">${cells.join('')}</row>`;
  }).join('');
  const lastCol = colLetter(Math.max(0, t.columns.length - 1));
  return `${XML_HEAD}<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `<cols>${cols}</cols><sheetData>${head}${body}</sheetData>`
    + `<autoFilter ref="A1:${lastCol}${Math.max(1, t.rows.length + 1)}"/></worksheet>`;
}

const STYLES = `${XML_HEAD}<styleSheet xmlns="${NS}">`
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFE8E8FB"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>'
  + '</styleSheet>';

/** A real .xlsx workbook (one sheet per ExportTable), built without any library. */
export function toXlsx(doc: ExportDoc): Uint8Array {
  const enc = new TextEncoder();
  const names = sheetNames(doc.sheets);
  const n = doc.sheets.length;
  const sheetIdx = Array.from({ length: n }, (_, i) => i + 1);
  const entries: ZipEntry[] = [
    {
      path: '[Content_Types].xml',
      data: enc.encode(`${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + sheetIdx.map((i) => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
    },
    {
      path: '_rels/.rels',
      data: enc.encode(`${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    },
    {
      path: 'xl/workbook.xml',
      data: enc.encode(`${XML_HEAD}<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>`
        + sheetIdx.map((i) => `<sheet name="${esc(names[i - 1])}" sheetId="${i}" r:id="rId${i}"/>`).join('')
        + '</sheets></workbook>'),
    },
    {
      path: 'xl/_rels/workbook.xml.rels',
      data: enc.encode(`${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + sheetIdx.map((i) => `<Relationship Id="rId${i}" Type="${REL}/worksheet" Target="worksheets/sheet${i}.xml"/>`).join('')
        + `<Relationship Id="rId${n + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`),
    },
    { path: 'xl/styles.xml', data: enc.encode(STYLES) },
    ...doc.sheets.map((s, i) => ({ path: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s)) })),
  ];
  return zipStore(entries);
}
