import { buildExport, type ExportDoc, type ExportFormat } from '@/domain/exporters';

/** Hand bytes to the browser as a file download. */
export function saveBytes(filename: string, mime: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Encode a document and download it; returns the file name and row count for user feedback. */
export function downloadDoc(format: ExportFormat, doc: ExportDoc, baseName: string): { filename: string; rows: number } {
  const out = buildExport(format, doc, baseName);
  saveBytes(out.filename, out.mime, out.bytes);
  return { filename: out.filename, rows: out.rows };
}
