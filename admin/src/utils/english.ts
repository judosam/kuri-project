/**
 * English-only display names.
 * Strips any non-Latin script (Tamil, Devanagari, CJK, Arabic, Cyrillic, …)
 * from a place/record name so the UI only ever shows English / Latin text.
 */
const NON_LATIN = /[^\u0000-\u007F\u00C0-\u024F\u2018\u2019\u00B0]/g;

export function enName(
  value: string | null | undefined,
  fallback?: string | null | undefined
): string {
  const cleaned = (value ?? '').replace(NON_LATIN, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned) return cleaned;
  if (fallback) return enName(fallback);
  return '';
}
