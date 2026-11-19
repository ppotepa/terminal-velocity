import { err, ok, type Result } from '../../../kernel/result.ts';

export const POSITION_MEASUREMENT_KINDS = ['ADS_B', 'MLAT', 'OTHER'] as const;
export type PositionMeasurementKind = typeof POSITION_MEASUREMENT_KINDS[number];

export type PositionAltitude =
  | { readonly kind: 'BAROMETRIC_FT'; readonly valueFt: number }
  | { readonly kind: 'GEOMETRIC_FT'; readonly valueFt: number }
  | { readonly kind: 'SURFACE'; readonly valueFt: null };
export type PositionAltitudes = readonly PositionAltitude[];
export const POSITION_TRACK_KINDS = ['GROUND_TRACK', 'TRUE_HEADING'] as const;
export type PositionTrackKind = typeof POSITION_TRACK_KINDS[number];

export type InvalidPositionMeasurement = {
  readonly code: 'INVALID_POSITION_MEASUREMENT';
  readonly field: 'measurementKind' | 'measurementDetail' | 'altitude' | 'groundSpeedKnots' | 'trackDegrees' | 'trackKind';
};

export function positionMeasurementKind(input: unknown): Result<PositionMeasurementKind, InvalidPositionMeasurement> {
  return typeof input === 'string' && POSITION_MEASUREMENT_KINDS.some(value => value === input)
    ? ok(input as PositionMeasurementKind)
    : err({ code: 'INVALID_POSITION_MEASUREMENT', field: 'measurementKind' });
}

export function measurementDetail(input: unknown): Result<string, InvalidPositionMeasurement> {
  return typeof input === 'string' && input.length > 0 && input.length <= 128
    && input === input.trim() && !/[\u0000-\u001f\u007f-\u009f]/u.test(input)
    ? ok(input)
    : err({ code: 'INVALID_POSITION_MEASUREMENT', field: 'measurementDetail' });
}

export function positionAltitude(input: unknown): Result<PositionAltitude | null, InvalidPositionMeasurement> {
  if (input === null) return ok(null);
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    return err({ code: 'INVALID_POSITION_MEASUREMENT', field: 'altitude' });
  try {
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null)
      return err({ code: 'INVALID_POSITION_MEASUREMENT', field: 'altitude' });
    const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== 'string') return err({ code: 'INVALID_POSITION_MEASUREMENT', field: 'altitude' });
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !('value' in descriptor))
        return err({ code: 'INVALID_POSITION_MEASUREMENT', field: 'altitude' });
      record[key] = descriptor.value;
    }
    if (Object.keys(record).some(key => key !== 'kind' && key !== 'valueFt'))
      return err({ code: 'INVALID_POSITION_MEASUREMENT', field: 'altitude' });
    if (record['kind'] === 'SURFACE' && record['valueFt'] === null)
      return ok(Object.freeze({ kind: 'SURFACE', valueFt: null }));
    if ((record['kind'] === 'BAROMETRIC_FT' || record['kind'] === 'GEOMETRIC_FT')
      && typeof record['valueFt'] === 'number' && Number.isFinite(record['valueFt']))
      return ok(Object.freeze({ kind: record['kind'], valueFt: record['valueFt'] }) as PositionAltitude);
    return err({ code: 'INVALID_POSITION_MEASUREMENT', field: 'altitude' });
  } catch {
    return err({ code: 'INVALID_POSITION_MEASUREMENT', field: 'altitude' });
  }
}

/** One value per altitude datum; surface cannot coexist with an airborne altitude. */
export function positionAltitudes(input: unknown): Result<PositionAltitudes | null, InvalidPositionMeasurement> {
  if (input === null) return ok(null);
  if (!Array.isArray(input) || input.length < 1 || input.length > 2)
    return err({ code: 'INVALID_POSITION_MEASUREMENT', field: 'altitude' });
  const values: PositionAltitude[] = [];
  const kinds = new Set<PositionAltitude['kind']>();
  for (const raw of input) {
    const parsed = positionAltitude(raw);
    if (!parsed.ok || parsed.value === null || kinds.has(parsed.value.kind))
      return err({ code: 'INVALID_POSITION_MEASUREMENT', field: 'altitude' });
    kinds.add(parsed.value.kind);
    values.push(parsed.value);
  }
  if (kinds.has('SURFACE') && values.length !== 1)
    return err({ code: 'INVALID_POSITION_MEASUREMENT', field: 'altitude' });
  return ok(Object.freeze(values));
}

export function groundSpeedKnots(input: unknown): Result<number | null, InvalidPositionMeasurement> {
  return input === null ? ok(null)
    : typeof input === 'number' && Number.isFinite(input) && input >= 0
      ? ok(input)
      : err({ code: 'INVALID_POSITION_MEASUREMENT', field: 'groundSpeedKnots' });
}

/** Track is clockwise degrees from north; 360 is not accepted as a second spelling of 0. */
export function trackDegrees(input: unknown): Result<number | null, InvalidPositionMeasurement> {
  return input === null ? ok(null)
    : typeof input === 'number' && Number.isFinite(input) && input >= 0 && input < 360
      ? ok(input)
      : err({ code: 'INVALID_POSITION_MEASUREMENT', field: 'trackDegrees' });
}

export function positionTrackKind(input: unknown): Result<PositionTrackKind, InvalidPositionMeasurement> {
  return typeof input === 'string' && POSITION_TRACK_KINDS.some(value => value === input)
    ? ok(input as PositionTrackKind)
    : err({ code: 'INVALID_POSITION_MEASUREMENT', field: 'trackKind' });
}
