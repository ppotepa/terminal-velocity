import { err, ok, type Result } from '../../../kernel/result.ts';

export const POSITION_MEASUREMENT_KINDS = ['ADS_B', 'MLAT', 'OTHER'] as const;
export type PositionMeasurementKind = typeof POSITION_MEASUREMENT_KINDS[number];

export interface PositionAltitude {
  readonly kind: 'BAROMETRIC_FT' | 'GEOMETRIC_FT';
  readonly valueFt: number;
}

export type InvalidPositionMeasurement = {
  readonly code: 'INVALID_POSITION_MEASUREMENT';
  readonly field: 'measurementKind' | 'measurementDetail' | 'altitude' | 'groundSpeedKnots' | 'trackDegrees';
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
    if (Object.keys(record).some(key => key !== 'kind' && key !== 'valueFt')
      || (record['kind'] !== 'BAROMETRIC_FT' && record['kind'] !== 'GEOMETRIC_FT')
      || typeof record['valueFt'] !== 'number' || !Number.isFinite(record['valueFt']))
      return err({ code: 'INVALID_POSITION_MEASUREMENT', field: 'altitude' });
    return ok(Object.freeze({ kind: record['kind'], valueFt: record['valueFt'] }) as PositionAltitude);
  } catch {
    return err({ code: 'INVALID_POSITION_MEASUREMENT', field: 'altitude' });
  }
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
