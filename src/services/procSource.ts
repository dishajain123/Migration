import Papa from 'papaparse';
import { config } from '@/config';
import { analyzeProcSql, type ProcFileInfo } from '@/domain/sqlParse';
import type { DdExport, ProcSource } from '@/types';

/*
 * Loads the sample stored-procedure SQL (and optional dd_export.csv files) that sit beside the workbook.
 * Used only by the mock services; a real backend would parse and serve these itself.
 */

interface Manifest { procedures: ProcFileInfo[] }

/** Text from bytes: UTF-16 (with or without BOM) or UTF-8, as SQL Server Management Studio saves scripts. */
export function decode(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  if (b.length > 3 && b[1] === 0 && b[3] === 0) return new TextDecoder('utf-16le').decode(b);
  return new TextDecoder('utf-8').decode(b);
}

/** The dev server answers unknown paths with index.html (HTTP 200), so HTML counts as "not found". */
async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const text = decode(await res.arrayBuffer());
  return /^\s*<(?:!doctype|html)/i.test(text) ? null : text;
}

const url = (...parts: string[]) => config.procSourcesBase + parts.map(encodeURIComponent).join('/');

let manifestCache: Promise<Manifest> | null = null;
function getManifest(): Promise<Manifest> {
  if (!manifestCache) {
    manifestCache = (async () => {
      const text = await fetchText(`${config.procSourcesBase}manifest.json`);
      if (!text) throw new Error(`Procedure manifest not found at ${config.procSourcesBase}manifest.json. Keep the "latest dd output" folder (with manifest.json) under public/data/.`);
      return JSON.parse(text) as Manifest;
    })().catch((e) => { manifestCache = null; throw e; });
  }
  return manifestCache;
}

let filesCache: Promise<{ info: ProcFileInfo; sql: string }[]> | null = null;
/** Raw text of the sample procedure files listed in manifest.json. */
export function getProcSourceFiles(): Promise<{ info: ProcFileInfo; sql: string }[]> {
  if (!filesCache) {
    filesCache = (async () => {
      const m = await getManifest();
      return Promise.all(m.procedures.map(async (p) => {
        const sql = await fetchText(url(p.folder, p.file));
        if (sql === null) throw new Error(`SQL file not found: ${p.folder}/${p.file}`);
        return { info: p, sql };
      }));
    })().catch((e) => { filesCache = null; throw e; });
  }
  return filesCache;
}

let sourcesCache: Promise<ProcSource[]> | null = null;
/** Parsed procedures in execution order. */
export function getProcSources(): Promise<ProcSource[]> {
  if (!sourcesCache) {
    sourcesCache = getProcSourceFiles()
      .then((files) => files.map((f) => analyzeProcSql(f.info, f.sql)).sort((a, b) => a.order - b.order))
      .catch((e) => { sourcesCache = null; throw e; });
  }
  return sourcesCache;
}

const FILE = 'dd_export.csv';
const ddCache = new Map<string, Promise<DdExport>>();
/** The per-procedure data-dictionary export, once saved as CSV beside its xlsx. Header layout is shown as found. */
export function getDdExport(name: string): Promise<DdExport> {
  let p = ddCache.get(name);
  if (!p) {
    p = (async () => {
      const m = await getManifest();
      const entry = m.procedures.find((x) => x.name === name);
      if (!entry) throw new Error(`Unknown procedure ${name}`);
      const text = await fetchText(url(entry.folder, FILE));
      if (text === null) {
        return { available: false, file: `${entry.folder}/${FILE}`, header: [], rows: [], note: `${FILE} was not found. Save dd_export.xlsx as CSV (UTF-8) with this name in the same folder; the app does not read .xlsx.` };
      }
      const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: true });
      const rows = parsed.data;
      return { available: true, file: `${entry.folder}/${FILE}`, header: rows[0] ?? [], rows: rows.slice(1), note: 'Shown exactly as exported; the first row is treated as the header.' };
    })();
    ddCache.set(name, p);
    p.catch(() => ddCache.delete(name));
  }
  return p;
}
