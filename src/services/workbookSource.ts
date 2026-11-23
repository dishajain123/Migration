import { config } from '@/config';
import { parseWorkbookCsv } from '@/domain/parse';
import type { WorkbookModel } from '@/types';

let cache: Promise<WorkbookModel> | null = null;

async function load(): Promise<WorkbookModel> {
  const res = await fetch(config.workbookCsvUrl);
  if (!res.ok) {
    throw new Error(`Workbook CSV not found at ${config.workbookCsvUrl} (HTTP ${res.status}). Copy CrisMac_to_TRAQ_Combined.csv into public/data/.`);
  }
  const text = await res.text();
  if (!text.replace(/^﻿/, '').trimStart().startsWith('Sheet_Name')) {
    throw new Error('The file at /data/CrisMac_to_TRAQ_Combined.csv is missing or is not the combined workbook CSV (header must start with Sheet_Name).');
  }
  return parseWorkbookCsv(text);
}

/** Cached, shared workbook model. Used only by the mock service layer. */
export function getWorkbook(): Promise<WorkbookModel> {
  if (!cache) {
    cache = load().catch((e) => {
      cache = null;
      throw e;
    });
  }
  return cache;
}
