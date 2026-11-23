/** Format-neutral description of something to export. Screens build one of these; encoders turn it into files. */
export type ExportCell = string | number;

export interface ExportTable {
  /** Sheet or section name. */
  name: string;
  columns: string[];
  rows: ExportCell[][];
}

export interface ExportDoc {
  title: string;
  subtitle?: string;
  /** ISO timestamp. */
  generatedAt: string;
  /** Provenance line, e.g. "Workbook-derived". Printed in PDF footers and kept in JSON. */
  source: string;
  sheets: ExportTable[];
  /** Which sheet a single-table format (CSV) writes. Defaults to the first. */
  csvSheet?: number;
}

export type ExportFormat = 'xlsx' | 'csv' | 'pdf' | 'json';

export interface FormatInfo { id: ExportFormat; label: string; ext: string; mime: string; hint: string }
