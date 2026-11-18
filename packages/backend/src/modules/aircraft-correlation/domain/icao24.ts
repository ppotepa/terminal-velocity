import type { Brand } from '../../../kernel/brand.ts';
import { err, ok, type Result } from '../../../kernel/result.ts';
export type Icao24 = Brand<string, 'Icao24'>;
export function icao24(input: string): Result<Icao24, { readonly code: 'INVALID_ICAO24' }> {
  const normalized = input.trim().toUpperCase();
  return /^[0-9A-F]{6}$/.test(normalized)
    ? ok(normalized as Icao24) : err({ code: 'INVALID_ICAO24' });
}
