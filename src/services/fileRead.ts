import type { UploadedSql } from '@/types';
import { decode } from './procSource';

/** Browser File -> decoded text (UTF-8 or UTF-16). The only place that touches the File API. */
export async function readSqlFile(file: File): Promise<UploadedSql> {
  const buf = await file.arrayBuffer();
  return { fileName: file.name, size: file.size, content: decode(buf) };
}
