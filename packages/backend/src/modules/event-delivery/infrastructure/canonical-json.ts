/** Stable JSON for the persisted event envelope; object property order is immaterial. */
export function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 64) throw new TypeError('The event payload is too deeply nested.');
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item, depth + 1)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalJson(record[key], depth + 1)}`).join(',')}}`;
  }
  throw new TypeError('The event payload is not valid JSON.');
}
