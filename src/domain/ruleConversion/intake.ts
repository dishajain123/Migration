import type { SqlFileAnalysis, UploadedSql } from '@/types';
import { analyzeProcSql } from '../sqlParse';

/** Upload limits and checks for CrisMac SQL files. Pure: the caller supplies already-decoded text. */
export const MAX_SQL_BYTES = 5 * 1024 * 1024;
export const SQL_EXTENSIONS = ['.sql'];

export function checkSqlFileMeta(name: string, size: number): string | null {
  if (!SQL_EXTENSIONS.some((e) => name.toLowerCase().endsWith(e))) return `${name} is not a .sql file.`;
  if (size === 0) return `${name} is empty.`;
  if (size > MAX_SQL_BYTES) return `${name} is ${(size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_SQL_BYTES / 1024 / 1024} MB.`;
  return null;
}

/** Procedure name from CREATE [OR ALTER] PROC[EDURE] [schema.]name, else from the file name. */
export function procedureName(fileName: string, sql: string): { name: string; fromHeader: boolean } {
  const m = /CREATE\s+(?:OR\s+ALTER\s+)?PROC(?:EDURE)?\s+(?:\[?\w+\]?\s*\.\s*)?\[?(\w+)\]?/i.exec(sql);
  if (m) return { name: m[1], fromHeader: true };
  const base = fileName.replace(/\.sql$/i, '').replace(/\.StoredProcedure$/i, '');
  return { name: base.split('.').pop() || base, fromHeader: false };
}

export function analyzeSqlFile(file: UploadedSql, folder = '(uploaded)'): SqlFileAnalysis {
  const metaError = checkSqlFileMeta(file.fileName, file.size);
  if (metaError) return { fileName: file.fileName, size: file.size, procedure: null, warnings: [], error: metaError };
  const warnings: string[] = [];
  const { name, fromHeader } = procedureName(file.fileName, file.content);
  if (!fromHeader) warnings.push('No CREATE PROCEDURE statement found; the file is read as a plain script and named after the file.');
  try {
    const procedure = analyzeProcSql({ name, folder, file: file.fileName }, file.content);
    if (procedure.steps.length === 0) warnings.push('No INSERT, UPDATE, MERGE, DELETE or SELECT INTO statements were recognised.');
    if (/\bEXEC(?:UTE)?\s*\(\s*@|\bsp_executesql\b/i.test(file.content)) warnings.push('Dynamic SQL (EXEC(@sql) / sp_executesql) is present; statements built at run time are not analysed.');
    if (/\bCURSOR\b/i.test(file.content)) warnings.push('A CURSOR is declared; row-by-row loops are not analysed.');
    return { fileName: file.fileName, size: file.size, procedure, warnings };
  } catch (e) {
    return { fileName: file.fileName, size: file.size, procedure: null, warnings, error: `Could not analyse ${file.fileName}: ${e instanceof Error ? e.message : String(e)}` };
  }
}
