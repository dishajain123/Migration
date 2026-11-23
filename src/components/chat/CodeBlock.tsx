import { Check, Copy } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';

const SQL_KEYWORDS = new Set(['SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'ON', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'AS', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'MERGE', 'USING', 'WHEN', 'THEN', 'ELSE', 'END', 'CASE', 'GROUP', 'BY', 'ORDER', 'HAVING', 'UNION', 'ALL', 'DISTINCT', 'TOP', 'EXEC', 'EXECUTE', 'DECLARE', 'BEGIN', 'IF', 'WHILE', 'CREATE', 'ALTER', 'DROP', 'TABLE', 'PROCEDURE', 'VIEW', 'WITH', 'EXISTS', 'BETWEEN', 'LIKE', 'ISNULL', 'COALESCE', 'CAST', 'CONVERT', 'COUNT', 'SUM', 'MAX', 'MIN', 'AVG', 'ROW_NUMBER', 'OVER', 'PARTITION']);

/** Cosmetic SQL highlighting (comments, strings, keywords, numbers). Display only: the text is never altered. */
function highlightSql(code: string): ReactNode[] {
  return code.split(/(--[^\n]*|'(?:[^']|'')*'|\b\w+\b)/g).map((tok, i) => {
    if (!tok) return null;
    if (tok.startsWith('--')) return <span key={i} className="text-muted italic">{tok}</span>;
    if (tok.startsWith("'")) return <span key={i} className="text-ok">{tok}</span>;
    if (SQL_KEYWORDS.has(tok.toUpperCase())) return <span key={i} className="font-semibold text-primary">{tok}</span>;
    if (/^\d+(\.\d+)?$/.test(tok)) return <span key={i} className="text-info">{tok}</span>;
    return <Fragment key={i}>{tok}</Fragment>;
  });
}

export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };
  const isSql = /^(sql|tsql|t-sql|plsql)$/i.test(lang);
  return (
    <div className="my-1 overflow-hidden rounded-md border border-border bg-surface2">
      <div className="flex items-center justify-between border-b border-border px-2 py-1 text-[10px] uppercase tracking-wide text-muted">
        <span>{lang || 'code'}</span>
        <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 rounded px-1 py-0.5 normal-case hover:bg-surface" aria-label="Copy code">
          {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-h-72 overflow-auto p-2 font-mono text-[12px] leading-relaxed"><code>{isSql ? highlightSql(code) : code}</code></pre>
    </div>
  );
}
