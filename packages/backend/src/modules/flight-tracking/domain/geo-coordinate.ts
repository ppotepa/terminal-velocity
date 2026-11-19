import type { Brand } from '../../../kernel/brand.ts';
import { err, ok, type Result } from '../../../kernel/result.ts';

export type LatitudeDegrees = Brand<number, 'LatitudeDegrees'>;
export type LongitudeDegrees = Brand<number, 'LongitudeDegrees'>;

export type InvalidCoordinate = {
  readonly code: 'INVALID_COORDINATE';
  readonly field: 'latitude' | 'longitude';
};

export function latitudeDegrees(input: unknown): Result<LatitudeDegrees, InvalidCoordinate> {
  return typeof input === 'number' && Number.isFinite(input) && input >= -90 && input <= 90
    ? ok(input as LatitudeDegrees)
    : err({ code: 'INVALID_COORDINATE', field: 'latitude' });
}

export function longitudeDegrees(input: unknown): Result<LongitudeDegrees, InvalidCoordinate> {
  return typeof input === 'number' && Number.isFinite(input) && input >= -180 && input <= 180
    ? ok(input as LongitudeDegrees)
    : err({ code: 'INVALID_COORDINATE', field: 'longitude' });
}
