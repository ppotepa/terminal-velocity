import { icao24, registration } from '../../aircraft-correlation/public/index.ts';
import { err, ok, type Result } from '../../../kernel/result.ts';
import { hasOnlyKeys, plainRecord } from '../domain/input-validation.ts';
import type { AircraftHints } from '../domain/normalized-observation.ts';

export function normalizeAircraftHints(input: unknown): Result<AircraftHints, string> {
  const row = plainRecord(input);
  if (!row || !hasOnlyKeys(row, ['icao24', 'registration', 'callsign'])) return err('aircraft');
  const result: { icao24?: AircraftHints['icao24']; registration?: AircraftHints['registration']; callsign?: string } = {};
  for (const key of Object.keys(row)) {
    const value = row[key];
    if (typeof value !== 'string') return err(key);
    if (key === 'icao24') {
      const parsed = icao24(value);
      if (!parsed.ok) return err(key);
      result.icao24 = parsed.value;
    } else if (key === 'registration') {
      const parsed = registration(value);
      if (!parsed.ok) return err(key);
      result.registration = parsed.value;
    } else {
      const normalized = value.trim().toUpperCase();
      if (!/^[A-Z0-9-]{1,16}$/.test(normalized)) return err(key);
      result.callsign = normalized;
    }
  }
  return ok(Object.freeze(result) as AircraftHints);
}
