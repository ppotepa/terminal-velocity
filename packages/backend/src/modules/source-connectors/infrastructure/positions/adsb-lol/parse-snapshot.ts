import { err, ok, type Result } from '../../../../../kernel/result.ts';
import type {
  PositionObservation, PositionParseError, PositionSourceId, UtcTimestamp,
} from '../../../../flight-tracking/public/index.ts';
import { adsbLolPositionAdapter } from './parse-aircraft.ts';
import type { AdsbLolPositionQuery } from './query.ts';
import { ADSB_LOL_MAX_RADIUS_NM } from './query.ts';
import {
  ADSB_LOL_MAX_REQUESTS_PER_WINDOW, ADSB_LOL_MINIMUM_INTERVAL_MS, ADSB_LOL_ROLLING_WINDOW_MS,
} from './request-budget.ts';

export interface AdsbLolPositionBatch {
  readonly provider: 'adsb.lol';
  readonly sourceId: PositionSourceId;
  readonly fetchedAt: UtcTimestamp;
  readonly dataGeneratedAt: UtcTimestamp;
  readonly cachedAt: UtcTimestamp;
  readonly query: AdsbLolPositionQuery;
  readonly coverage: {
    readonly kind: 'SAMPLED';
    readonly completeness: 'UNKNOWN';
    readonly description: string;
  };
  readonly requestBudget: {
    readonly minimumIntervalMs: typeof ADSB_LOL_MINIMUM_INTERVAL_MS;
    readonly maximumRequestsPerRollingWindow: typeof ADSB_LOL_MAX_REQUESTS_PER_WINDOW;
    readonly rollingWindowMs: typeof ADSB_LOL_ROLLING_WINDOW_MS;
    readonly maximumRadiusNm: typeof ADSB_LOL_MAX_RADIUS_NM;
  };
  readonly aircraftReturned: number;
  readonly noPositionCount: number;
  readonly observations: readonly PositionObservation[];
}

export type AdsbLolSnapshotError =
  | { readonly code: 'INVALID_RESPONSE'; readonly field: string }
  | { readonly code: 'SOURCE_REPORTED_FAILURE'; readonly message: string }
  | { readonly code: 'INVALID_AIRCRAFT'; readonly index: number; readonly error: PositionParseError }
  | { readonly code: 'DUPLICATE_OBSERVATION_ID'; readonly index: number };

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

function utcIsoFromMilliseconds(input: unknown): UtcTimestamp | null {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) return null;
  try {
    const value = new Date(input).toISOString();
    return Date.parse(value) === input ? value as UtcTimestamp : null;
  } catch {
    return null;
  }
}

export interface ParseAdsbLolSnapshotContext {
  readonly sourceId: PositionSourceId;
  readonly fetchedAt: string;
  readonly query: AdsbLolPositionQuery;
}

/** Parses the documented v2 envelope; unknown provider fields are tolerated for forward compatibility. */
export function parseAdsbLolPositionSnapshot(
  input: unknown,
  context: ParseAdsbLolSnapshotContext,
): Result<AdsbLolPositionBatch, AdsbLolSnapshotError> {
  const record = plainRecord(input);
  if (!record) return err({ code: 'INVALID_RESPONSE', field: 'envelope' });
  const aircraft = record['ac'];
  const now = record['now'];
  const cachedAtMs = record['ctime'];
  const total = record['total'];
  if (!Array.isArray(aircraft)) return err({ code: 'INVALID_RESPONSE', field: 'ac' });
  if (!Number.isSafeInteger(total) || (total as number) < 0 || total !== aircraft.length)
    return err({ code: 'INVALID_RESPONSE', field: 'total' });
  const dataGeneratedAt = utcIsoFromMilliseconds(now);
  if (!dataGeneratedAt) return err({ code: 'INVALID_RESPONSE', field: 'now' });
  const cachedAt = utcIsoFromMilliseconds(cachedAtMs);
  if (!cachedAt) return err({ code: 'INVALID_RESPONSE', field: 'ctime' });
  if (typeof record['msg'] !== 'string') return err({ code: 'INVALID_RESPONSE', field: 'msg' });
  if (record['msg'] !== 'No error')
    return err({ code: 'SOURCE_REPORTED_FAILURE', message: record['msg'] });
  if (typeof record['ptime'] !== 'number' || !Number.isSafeInteger(record['ptime']) || record['ptime'] < 0)
    return err({ code: 'INVALID_RESPONSE', field: 'ptime' });
  const fetchedAtMs = Date.parse(context.fetchedAt);
  if (!Number.isFinite(fetchedAtMs) || new Date(fetchedAtMs).toISOString() !== context.fetchedAt)
    return err({ code: 'INVALID_RESPONSE', field: 'fetchedAt' });

  const observations: PositionObservation[] = [];
  const observationIds = new Set<string>();
  let noPositionCount = 0;
  for (let index = 0; index < aircraft.length; index += 1) {
    const raw = aircraft[index];
    const item = plainRecord(raw);
    if (!item) return err({ code: 'INVALID_AIRCRAFT', index, error: { code: 'INVALID_INPUT', field: 'aircraft' } });
    const hasLat = Object.hasOwn(item, 'lat') && item['lat'] !== null && item['lat'] !== undefined;
    const hasLon = Object.hasOwn(item, 'lon') && item['lon'] !== null && item['lon'] !== undefined;
    if (!hasLat && !hasLon) {
      noPositionCount += 1;
      continue;
    }
    const parsed = adsbLolPositionAdapter.parse(raw, {
      sourceId: context.sourceId,
      snapshotNowMs: now as number,
      ingestedAt: context.fetchedAt,
    });
    if (!parsed.ok) return err({ code: 'INVALID_AIRCRAFT', index, error: parsed.error });
    if (observationIds.has(parsed.value.sourceObservationId))
      return err({ code: 'DUPLICATE_OBSERVATION_ID', index });
    observationIds.add(parsed.value.sourceObservationId);
    observations.push(parsed.value);
  }

  return ok(Object.freeze({
    provider: 'adsb.lol',
    sourceId: context.sourceId,
    fetchedAt: context.fetchedAt as UtcTimestamp,
    dataGeneratedAt,
    cachedAt,
    query: Object.freeze({ ...context.query }),
    coverage: Object.freeze({
      kind: 'SAMPLED',
      completeness: 'UNKNOWN',
      description: `Provider receiver network positions within ${context.query.radiusNm} NM of configured center; completeness is unknown.`,
    }),
    requestBudget: Object.freeze({
      minimumIntervalMs: ADSB_LOL_MINIMUM_INTERVAL_MS,
      maximumRequestsPerRollingWindow: ADSB_LOL_MAX_REQUESTS_PER_WINDOW,
      rollingWindowMs: ADSB_LOL_ROLLING_WINDOW_MS,
      maximumRadiusNm: ADSB_LOL_MAX_RADIUS_NM,
    }),
    aircraftReturned: aircraft.length,
    noPositionCount,
    observations: Object.freeze(observations),
  }));
}
