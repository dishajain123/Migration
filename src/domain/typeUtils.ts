import type { CompatLevel } from '@/types';

export type TypeFamily = 'char' | 'number' | 'date' | 'other' | 'unknown';
export interface ParsedType { family: TypeFamily; length?: number; raw: string }

const CHAR = new Set(['varchar', 'varchar2', 'char', 'nchar', 'nvarchar', 'nvarchar2', 'string', 'text', 'clob', 'sysname', 'uniqueidentifier']);
const NUM = new Set(['number', 'numeric', 'decimal', 'int', 'integer', 'bigint', 'smallint', 'tinyint', 'float', 'double', 'real', 'bit', 'money']);
const DATE = new Set(['date', 'datetime', 'datetime2', 'smalldatetime', 'timestamp']);

export function parseType(raw: string): ParsedType {
  const t = (raw ?? '').trim();
  if (!t || t === '-' || t.toLowerCase() === 'mixed') return { family: 'unknown', raw: t };
  const m = /^[a-z0-9_]+/i.exec(t);
  const word = (m ? m[0] : '').toLowerCase();
  let family: TypeFamily = 'other';
  if (CHAR.has(word)) family = 'char';
  else if (NUM.has(word)) family = 'number';
  else if (DATE.has(word)) family = 'date';
  let length: number | undefined;
  if (family === 'char') {
    const p = /\(([^)]*)\)/.exec(t);
    if (p) {
      const nums = p[1].match(/\d+/g);
      if (nums) length = Number(nums[nums.length - 1]);
    }
  }
  return { family, length, raw: t };
}

export function compat(sourceType: string, targetType: string): { level: CompatLevel; note: string } {
  const s = parseType(sourceType);
  const t = parseType(targetType);
  if (s.family === 'unknown' || t.family === 'unknown' || s.family === 'other' || t.family === 'other') {
    return { level: 'unknown', note: 'Type not comparable from workbook data' };
  }
  if (s.family === t.family) {
    if (s.family === 'char' && s.length && t.length && s.length > t.length) {
      return { level: 'warn', note: `Possible truncation: source length ${s.length} > target length ${t.length}` };
    }
    return { level: 'compatible', note: 'Same type family' };
  }
  const pair = `${s.family}->${t.family}`;
  if (pair === 'number->date' || pair === 'date->number') {
    return { level: 'incompatible', note: `Incompatible families (${pair})` };
  }
  return { level: 'warn', note: `Conversion required (${pair})` };
}
