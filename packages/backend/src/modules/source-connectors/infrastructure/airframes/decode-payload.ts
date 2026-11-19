import { createHash } from 'node:crypto';
/** Hash normalized JSON keys, never incidental object insertion order. */
export function evidenceDigest(value: unknown): string {
  function ordered(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(ordered);
    if (input !== null && typeof input === 'object') return Object.fromEntries(
      Object.entries(input).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, item]) => [key, ordered(item)]));
    return input;
  }
  return createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
}
