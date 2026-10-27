/** Read only well-formed saved controls; damaged browser storage falls back to defaults. */
export function readRecordState<T extends object>(key: string, defaults: T): T {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || 'null');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return defaults;
    const result = { ...defaults } as Record<string, unknown>;
    for (const [name, fallback] of Object.entries(defaults)) {
      const value = stored[name];
      if (value == null) continue;
      if (Array.isArray(fallback)) {
        if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
          result[name] = value;
        } else if (typeof value === 'string' && value.trim()) {
          result[name] = value.split(',').map(s => s.trim()).filter(Boolean);
        }
        continue;
      }
      if (typeof value !== typeof fallback) continue;
      if (typeof fallback === 'number' && (!Number.isFinite(value) || (name === 'page' && (!Number.isInteger(value) || value < 1)))) continue;
      if (typeof fallback === 'object' && (Array.isArray(value) || !Object.values(value).every(choices => Array.isArray(choices) && choices.every(choice => typeof choice === 'string')))) continue;
      if (['dateFrom', 'dateTo', 'customStartDate', 'customEndDate'].includes(name) && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
      result[name] = value;
    }
    return result as T;
  } catch { return defaults; }
}
export function saveRecordState(key: string, value: object) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Browsing still works when storage is unavailable. */ }
}
