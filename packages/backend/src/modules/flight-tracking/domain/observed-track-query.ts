import { aircraftId, type AircraftId } from '../../../contracts/identity/aircraft-id.ts';
import { err, ok, type Result } from '../../../kernel/result.ts';
import { positionSourceId, type PositionSourceId } from './position-identifiers.ts';

export const OBSERVED_TRACK_MAX_PAGE_SIZE = 500;
export const OBSERVED_TRACK_MAX_RANGE_MS = 7 * 86_400_000;

export interface ObservedTrackCursor {
  readonly aircraftId: AircraftId;
  readonly fromObservedAtMs: number;
  readonly toObservedAtMs: number;
  readonly projectionRevision: number;
  readonly observedAtMs: number;
  readonly sourceId: PositionSourceId;
  readonly observationId: string;
}

export interface ObservedTrackQuery {
  readonly aircraftId: AircraftId;
  readonly fromObservedAtMs: number;
  readonly toObservedAtMs: number;
  readonly limit: number;
  readonly pointBudget: number;
  readonly zoom: number;
  readonly after?: ObservedTrackCursor;
}

export type InvalidObservedTrackQuery = { readonly code: 'INVALID_OBSERVED_TRACK_QUERY'; readonly field: string };

function record(input: unknown): Record<string, unknown> | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  try {
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const value: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== 'string') return null;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !('value' in descriptor)) return null;
      value[key] = descriptor.value;
    }
    return value;
  } catch { return null; }
}

const safe = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function observedTrackQuery(input: unknown): Result<ObservedTrackQuery, InvalidObservedTrackQuery> {
  const value = record(input);
  if (!value || Object.keys(value).some(key => ![
    'aircraftId', 'fromObservedAtMs', 'toObservedAtMs', 'limit', 'pointBudget', 'zoom', 'after',
  ].includes(key))) return err({ code: 'INVALID_OBSERVED_TRACK_QUERY', field: 'query' });
  if (typeof value['aircraftId'] !== 'string')
    return err({ code: 'INVALID_OBSERVED_TRACK_QUERY', field: 'aircraftId' });
  const id = aircraftId(value['aircraftId']);
  if (!id.ok) return err({ code: 'INVALID_OBSERVED_TRACK_QUERY', field: 'aircraftId' });
  const from = value['fromObservedAtMs'];
  const to = value['toObservedAtMs'];
  if (!safe(from) || !safe(to) || to <= from || to - from > OBSERVED_TRACK_MAX_RANGE_MS)
    return err({ code: 'INVALID_OBSERVED_TRACK_QUERY', field: 'timeWindow' });
  const limit = value['limit'];
  if (!safe(limit) || limit < 1 || limit > OBSERVED_TRACK_MAX_PAGE_SIZE)
    return err({ code: 'INVALID_OBSERVED_TRACK_QUERY', field: 'limit' });
  const budget = value['pointBudget'];
  if (!safe(budget) || budget < 1 || budget > OBSERVED_TRACK_MAX_PAGE_SIZE)
    return err({ code: 'INVALID_OBSERVED_TRACK_QUERY', field: 'pointBudget' });
  const zoom = value['zoom'];
  if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom < 0 || zoom > 22)
    return err({ code: 'INVALID_OBSERVED_TRACK_QUERY', field: 'zoom' });
  const output: { aircraftId: AircraftId; fromObservedAtMs: number; toObservedAtMs: number;
    limit: number; pointBudget: number; zoom: number; after?: ObservedTrackCursor } = {
      aircraftId: id.value, fromObservedAtMs: from, toObservedAtMs: to,
      limit, pointBudget: budget, zoom,
    };
  if (value['after'] !== undefined && value['after'] !== null) {
    const after = record(value['after']);
    if (!after || Object.keys(after).sort().join(',') !== [
      'aircraftId','fromObservedAtMs','observationId','observedAtMs',
      'projectionRevision','sourceId','toObservedAtMs',
    ].sort().join(',')) return err({ code: 'INVALID_OBSERVED_TRACK_QUERY', field: 'after' });
    if (typeof after['sourceId'] !== 'string')
      return err({ code: 'INVALID_OBSERVED_TRACK_QUERY', field: 'after' });
    const source = positionSourceId(after['sourceId']);
    if (after['aircraftId'] !== id.value || after['fromObservedAtMs'] !== from
      || after['toObservedAtMs'] !== to || !safe(after['projectionRevision'])
      || !safe(after['observedAtMs']) || after['observedAtMs'] < from
      || after['observedAtMs'] >= to || !source.ok
      || typeof after['observationId'] !== 'string' || !uuid.test(after['observationId']))
      return err({ code: 'INVALID_OBSERVED_TRACK_QUERY', field: 'after' });
    output.after = { aircraftId: id.value, fromObservedAtMs: from, toObservedAtMs: to,
      projectionRevision: after['projectionRevision'], observedAtMs: after['observedAtMs'],
      sourceId: source.value, observationId: after['observationId'] };
  }
  return ok(Object.freeze(output));
}
