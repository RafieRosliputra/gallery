/** Directory names skipped at any depth (case-insensitive) unless SCAN_EXCLUDE overrides. */
export const DEFAULT_SCAN_EXCLUDE = [
  'immich',
  '@eaDir',
  '#recycle',
  '.Recycle.Bin',
] as const;

export function normalizeExcludeNames(names: readonly string[]): string[] {
  return [...new Set(names.map((name) => name.trim().toLowerCase()).filter((name) => name.length > 0))];
}
