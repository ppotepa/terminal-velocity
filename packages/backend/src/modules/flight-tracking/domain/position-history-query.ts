import { err, ok, type Result } from '../../../kernel/result.ts';
import { latitudeDegrees, longitudeDegrees, type LatitudeDegrees, type LongitudeDegrees } from './geo-coordinate.ts';
import {
  positionSourceId, sourceObservationId, type PositionSourceId, type SourceObservationId,
} from './position-identifiers.ts';

export const POSITION_HISTORY_MAX_PAGE_SIZE = 500;
export const POSITION_HISTORY_MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;

export interface PositionHistoryCursor {
  readonly observedAtMs: number;
  readonly sourceId: PositionSourceId;
  readonly sourceObservationId: SourceObservationId;
}

export interface PositionHistoryWindow {
  readonly fromObservedAtMs: number;
  readonly toObservedAtMs: number;
  readonly limit: number;
  readonly after?: PositionHistoryCursor;
}

export interface PositionGeoBounds {
  /** West/east may cross the antimeridian when west is greater than east. */
  readonly west: LongitudeDegrees;
  readonly south: LatitudeDegrees;
  readonly east: LongitudeDegrees;
  readonly north: LatitudeDegrees;
}

export interface PositionHistoryByIcao24Query extends PositionHistoryWindow {
  readonly kind: 'ICAO24';
  readonly icao24Hint: string;
}

export interface PositionHistoryWithinBoundsQuery extends PositionHistoryWindow {
  readonly kind: 'BOUNDS';
  readonly bounds: PositionGeoBounds;
}

export type PositionHistoryQuery = PositionHistoryByIcao24Query | PositionHistoryWithinBoundsQuery;

export type InvalidPositionHistoryQuery = {
  readonly code: 'INVALID_POSITION_HISTORY_QUERY';
  readonly field: 'query' | 'icao24Hint' | 'bounds' | 'west' | 'east' | 'south' | 'north'
    | 'fromObservedAtMs' | 'toObservedAtMs' | 'limit' | 'after';
};

type PlainRecord = Record<string, unknown>;

function plainRecord(input: unknown): PlainRecord | null {
  try {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const output: PlainRecord = Object.create(null) as PlainRecord;
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== 'string') return null;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !('value' in descriptor)) return null;
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    return null;
  }
}

function hasOnlyKeys(record: PlainRecord, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(record).every(key => keys.has(key));
}

function parseWindow(record: PlainRecord): Result<PositionHistoryWindow, InvalidPositionHistoryQuery> {
  const from = record['fromObservedAtMs'];
  if (typeof from !== 'number' || !Number.isSafeInteger(from) || from < 0)
    return err({ code: 'INVALID_POSITION_HISTORY_QUERY', field: 'fromObservedAtMs' });
  const to = record['toObservedAtMs'];
  if (typeof to !== 'number' || !Number.isSafeInteger(to) || to < 0 || to <= from
    || to - from > POSITION_HISTORY_MAX_RANGE_MS)
    return err({ code: 'INVALID_POSITION_HISTORY_QUERY', field: 'toObservedAtMs' });
  const limit = record['limit'];
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1
    || limit > POSITION_HISTORY_MAX_PAGE_SIZE)
    return err({ code: 'INVALID_POSITION_HISTORY_QUERY', field: 'limit' });

  let after: PositionHistoryCursor | undefined;
  if (Object.hasOwn(record, 'after')) {
    const cursor = plainRecord(record['after']);
    if (!cursor || !hasOnlyKeys(cursor, ['observedAtMs', 'sourceId', 'sourceObservationId']))
      return err({ code: 'INVALID_POSITION_HISTORY_QUERY', field: 'after' });
    const observedAtMs = cursor['observedAtMs'];
    const sourceIdText = cursor['sourceId'];
    const observationIdText = cursor['sourceObservationId'];
    if (typeof observedAtMs !== 'number' || !Number.isSafeInteger(observedAtMs)
      || observedAtMs < from || observedAtMs >= to
      || typeof sourceIdText !== 'string' || typeof observationIdText !== 'string')
      return err({ code: 'INVALID_POSITION_HISTORY_QUERY', field: 'after' });
    const sourceId = positionSourceId(sourceIdText);
    const sourceObservationIdValue = sourceObservationId(observationIdText);
    if (!sourceId.ok || !sourceObservationIdValue.ok)
      return err({ code: 'INVALID_POSITION_HISTORY_QUERY', field: 'after' });
    after = Object.freeze({
      observedAtMs,
      sourceId: sourceId.value,
      sourceObservationId: sourceObservationIdValue.value,
    });
  }

  return ok(Object.freeze({ fromObservedAtMs: from, toObservedAtMs: to, limit,
    ...(after ? { after } : {}) }));
}

/** Validates a bounded, stable history query by an unconfirmed ICAO24 hint. */
export function positionHistoryByIcao24Query(input: unknown):
Result<PositionHistoryByIcao24Query, InvalidPositionHistoryQuery> {
  const record = plainRecord(input);
  if (!record || !hasOnlyKeys(record, ['icao24Hint', 'fromObservedAtMs', 'toObservedAtMs', 'limit', 'after']))
    return err({ code: 'INVALID_POSITION_HISTORY_QUERY', field: 'query' });
  const hint = record['icao24Hint'];
  if (typeof hint !== 'string' || !/^[0-9a-fA-F]{6}$/u.test(hint))
    return err({ code: 'INVALID_POSITION_HISTORY_QUERY', field: 'icao24Hint' });
  const window = parseWindow(record);
  if (!window.ok) return window;
  return ok(Object.freeze({ kind: 'ICAO24', icao24Hint: hint.toUpperCase(), ...window.value }));
}

/** Validates a bounded spatial query; antimeridian crossing is represented by west > east. */
export function positionHistoryWithinBoundsQuery(input: unknown):
Result<PositionHistoryWithinBoundsQuery, InvalidPositionHistoryQuery> {
  const record = plainRecord(input);
  if (!record || !hasOnlyKeys(record, ['bounds', 'fromObservedAtMs', 'toObservedAtMs', 'limit', 'after']))
    return err({ code: 'INVALID_POSITION_HISTORY_QUERY', field: 'query' });
  const rawBounds = plainRecord(record['bounds']);
  if (!rawBounds || !hasOnlyKeys(rawBounds, ['west', 'south', 'east', 'north']))
    return err({ code: 'INVALID_POSITION_HISTORY_QUERY', field: 'bounds' });
  const west = longitudeDegrees(rawBounds['west']);
  if (!west.ok) return err({ code: 'INVALID_POSITION_HISTORY_QUERY', field: 'west' });
  const east = longitudeDegrees(rawBounds['east']);
  if (!east.ok || east.value === west.value)
    return err({ code: 'INVALID_POSITION_HISTORY_QUERY', field: 'east' });
  const south = latitudeDegrees(rawBounds['south']);
  if (!south.ok) return err({ code: 'INVALID_POSITION_HISTORY_QUERY', field: 'south' });
  const north = latitudeDegrees(rawBounds['north']);
  if (!north.ok || north.value <= south.value)
    return err({ code: 'INVALID_POSITION_HISTORY_QUERY', field: 'north' });
  const window = parseWindow(record);
  if (!window.ok) return window;
  return ok(Object.freeze({
    kind: 'BOUNDS',
    bounds: Object.freeze({ west: west.value, south: south.value, east: east.value, north: north.value }),
    ...window.value,
  }));
}
