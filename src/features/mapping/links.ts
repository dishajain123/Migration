/** Deep link into Agent 4 for one CrisMac source column that has no confirmed TRAQ column. */
export function mapSourceColumnLink(sourceTable: string, sourceColumn: string): string {
  return `/mapping?srcTable=${encodeURIComponent(sourceTable)}&srcColumn=${encodeURIComponent(sourceColumn)}`;
}
