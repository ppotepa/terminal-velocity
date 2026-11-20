import { err, ok, type Result } from '../../../kernel/result.ts';

/** Raw, source-reported position quality indicators; never used as message freshness. */
export interface PositionQuality {
  readonly nic?: number | null;
  readonly nacP?: number | null;
  readonly containmentRadiusMeters?: number | null;
}

export type InvalidPositionQuality = {
  readonly code: 'INVALID_POSITION_QUALITY';
  readonly field: 'quality' | 'nic' | 'nacP' | 'containmentRadiusMeters';
};

function parseIndicator(input: unknown, field: 'nic' | 'nacP'): Result<number | null, InvalidPositionQuality> {
  if (input === null) return ok(null);
  return typeof input === 'number' && Number.isSafeInteger(input) && input >= 0
    ? ok(input)
    : err({ code: 'INVALID_POSITION_QUALITY', field });
}

export function positionQuality(input: unknown): Result<PositionQuality, InvalidPositionQuality> {
  try {
    if (input === null || typeof input !== 'object' || Array.isArray(input))
      return err({ code: 'INVALID_POSITION_QUALITY', field: 'quality' });
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null)
      return err({ code: 'INVALID_POSITION_QUALITY', field: 'quality' });
    const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== 'string') return err({ code: 'INVALID_POSITION_QUALITY', field: 'quality' });
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !('value' in descriptor))
        return err({ code: 'INVALID_POSITION_QUALITY', field: 'quality' });
      record[key] = descriptor.value;
    }
    const allowed = new Set(['nic', 'nacP', 'containmentRadiusMeters']);
    const keys = Object.keys(record);
    if (keys.length === 0 || keys.some(key => !allowed.has(key)))
      return err({ code: 'INVALID_POSITION_QUALITY', field: 'quality' });
    const output: { nic?: number | null; nacP?: number | null; containmentRadiusMeters?: number | null } = {};
    for (const field of ['nic', 'nacP'] as const) {
      if (!Object.hasOwn(record, field)) continue;
      const parsed = parseIndicator(record[field], field);
      if (!parsed.ok) return parsed;
      output[field] = parsed.value;
    }
    if (Object.hasOwn(record, 'containmentRadiusMeters')) {
      const radius = record['containmentRadiusMeters'];
      if (radius !== null && (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0))
        return err({ code: 'INVALID_POSITION_QUALITY', field: 'containmentRadiusMeters' });
      output.containmentRadiusMeters = radius as number | null;
    }
    return ok(Object.freeze(output));
  } catch {
    return err({ code: 'INVALID_POSITION_QUALITY', field: 'quality' });
  }
}
