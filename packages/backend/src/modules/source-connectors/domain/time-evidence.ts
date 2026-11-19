import { epochMillis, type EpochMillis } from '../../../kernel/time/epoch-millis.ts';
import { err, ok, type Result } from '../../../kernel/result.ts';
import { hasOnlyKeys, plainRecord } from './input-validation.ts';

export const TIME_PRECISIONS = ['MILLISECOND', 'SECOND', 'MINUTE', 'HOUR', 'DAY', 'UNKNOWN'] as const;
export type TimePrecision = typeof TIME_PRECISIONS[number];
export const TIME_BASES = ['OBSERVED', 'RECEIVED', 'PROVIDER', 'INGESTED'] as const;
export type TimeBasis = typeof TIME_BASES[number];

export interface ObservationTimeEvidence {
  /** Canonical UTC instant with millisecond precision. */
  readonly at: EpochMillis;
  readonly iso: string;
  readonly basis: TimeBasis;
  readonly precision: TimePrecision;
  /** Absolute clock uncertainty in milliseconds. Zero is a declared value, not an omission. */
  readonly uncertaintyMs: number;
}

export type InvalidTimeEvidence = {
  readonly code: 'INVALID_TIME_EVIDENCE';
  readonly field: 'at' | 'basis' | 'precision' | 'uncertaintyMs' | 'object';
};

const utcTimestamp = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/u;
const maximumUncertaintyMs = 31_536_000_000;

function parseUtcTimestamp(input: unknown): Result<{ readonly at: EpochMillis; readonly iso: string }, InvalidTimeEvidence> {
  if (typeof input !== 'string') return err({ code: 'INVALID_TIME_EVIDENCE', field: 'at' });
  const match = utcTimestamp.exec(input);
  if (!match) return err({ code: 'INVALID_TIME_EVIDENCE', field: 'at' });
  const normalized = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
  const milliseconds = Date.parse(normalized);
  const timestamp = epochMillis(milliseconds);
  if (!timestamp.ok || new Date(milliseconds).toISOString() !== normalized)
    return err({ code: 'INVALID_TIME_EVIDENCE', field: 'at' });
  return ok({ at: timestamp.value, iso: normalized });
}

export function observationTimeEvidence(input: unknown): Result<ObservationTimeEvidence, InvalidTimeEvidence> {
  const record = plainRecord(input);
  if (!record || !hasOnlyKeys(record, ['at', 'basis', 'precision', 'uncertaintyMs']))
    return err({ code: 'INVALID_TIME_EVIDENCE', field: 'object' });
  const parsedTime = parseUtcTimestamp(record['at']);
  if (!parsedTime.ok) return parsedTime;
  if (typeof record['basis'] !== 'string' || !TIME_BASES.some(value => value === record['basis']))
    return err({ code: 'INVALID_TIME_EVIDENCE', field: 'basis' });
  if (typeof record['precision'] !== 'string' || !TIME_PRECISIONS.some(value => value === record['precision']))
    return err({ code: 'INVALID_TIME_EVIDENCE', field: 'precision' });
  const uncertaintyMs = record['uncertaintyMs'];
  if (typeof uncertaintyMs !== 'number' || !Number.isSafeInteger(uncertaintyMs)
    || uncertaintyMs < 0 || uncertaintyMs > maximumUncertaintyMs)
    return err({ code: 'INVALID_TIME_EVIDENCE', field: 'uncertaintyMs' });
  return ok(Object.freeze({
    ...parsedTime.value,
    basis: record['basis'] as TimeBasis,
    precision: record['precision'] as TimePrecision,
    uncertaintyMs,
  }));
}
