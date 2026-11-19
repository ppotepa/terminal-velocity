import type { Brand } from '../../../kernel/brand.ts';
import { err, ok, type Result } from '../../../kernel/result.ts';

export type UtcTimestamp = Brand<string, 'UtcTimestamp'>;
export const POSITION_TIME_PRECISIONS = ['MILLISECOND', 'SECOND', 'MINUTE', 'HOUR', 'UNKNOWN'] as const;
export type PositionTimePrecision = typeof POSITION_TIME_PRECISIONS[number];
export const POSITION_OBSERVED_AT_BASES = [
  'SOURCE_TIMESTAMP', 'SOURCE_AGE_FROM_REFERENCE', 'RECEIVER_TIMESTAMP',
] as const;
export type PositionObservedAtBasis = typeof POSITION_OBSERVED_AT_BASES[number];

export type InvalidPositionTime = {
  readonly code: 'INVALID_POSITION_TIME';
  readonly field: 'observedAt' | 'ingestedAt' | 'precision' | 'uncertaintyMs' | 'observedAtBasis' | 'sourceAgeSeconds';
};

const UTC_TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/u;
const MAX_TIMESTAMP_UNCERTAINTY_MS = 31_536_000_000;

/** Parses a real UTC calendar instant and normalizes it to millisecond precision. */
export function utcTimestamp(input: unknown, field: 'observedAt' | 'ingestedAt'):
Result<UtcTimestamp, InvalidPositionTime> {
  if (typeof input !== 'string') return err({ code: 'INVALID_POSITION_TIME', field });
  const match = UTC_TIMESTAMP.exec(input);
  if (!match) return err({ code: 'INVALID_POSITION_TIME', field });
  const normalized = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== normalized)
    return err({ code: 'INVALID_POSITION_TIME', field });
  return ok(normalized as UtcTimestamp);
}

export function positionTimePrecision(input: unknown): Result<PositionTimePrecision, InvalidPositionTime> {
  return typeof input === 'string' && POSITION_TIME_PRECISIONS.some(value => value === input)
    ? ok(input as PositionTimePrecision)
    : err({ code: 'INVALID_POSITION_TIME', field: 'precision' });
}

export function positionObservedAtBasis(input: unknown): Result<PositionObservedAtBasis, InvalidPositionTime> {
  return typeof input === 'string' && POSITION_OBSERVED_AT_BASES.some(value => value === input)
    ? ok(input as PositionObservedAtBasis)
    : err({ code: 'INVALID_POSITION_TIME', field: 'observedAtBasis' });
}

export function sourceAgeSeconds(input: unknown): Result<number, InvalidPositionTime> {
  return typeof input === 'number' && Number.isFinite(input) && input >= 0
    ? ok(input)
    : err({ code: 'INVALID_POSITION_TIME', field: 'sourceAgeSeconds' });
}

export function timestampUncertainty(input: unknown): Result<number | null, InvalidPositionTime> {
  if (input === null) return ok(null);
  return typeof input === 'number' && Number.isSafeInteger(input) && input >= 0
    && input <= MAX_TIMESTAMP_UNCERTAINTY_MS
    ? ok(input)
    : err({ code: 'INVALID_POSITION_TIME', field: 'uncertaintyMs' });
}
