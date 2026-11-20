import type { SqlPool } from '../../../../contracts/database/index.ts';
import { parseStoredPositionObservation } from '../../domain/position-observation.ts';
import {
  positionHistoryByIcao24Query, positionHistoryWithinBoundsQuery, type PositionHistoryQuery,
} from '../../domain/position-history-query.ts';
import type { PositionHistoryPage, PositionHistoryReader } from '../../ports/position-history-reader.ts';

export function postgresPositionHistoryReader(pool: SqlPool): PositionHistoryReader {
  async function read(query: PositionHistoryQuery): Promise<PositionHistoryPage> {
    const window = {
      fromObservedAtMs: query.fromObservedAtMs, toObservedAtMs: query.toObservedAtMs,
      limit: query.limit, ...(query.after === undefined ? {} : { after: query.after }),
    };
    const validated = query.kind === 'ICAO24'
      ? positionHistoryByIcao24Query({ ...window, icao24Hint: query.icao24Hint })
      : query.kind === 'BOUNDS'
        ? positionHistoryWithinBoundsQuery({ ...window, bounds: query.bounds })
        : null;
    if (!validated?.ok) throw new RangeError(`Invalid position history query: ${validated?.error.field ?? 'query'}`);
    query = validated.value;
    const values: unknown[] = [query.fromObservedAtMs, query.toObservedAtMs,
      query.after?.observedAtMs ?? null, query.after?.sourceId ?? null,
      query.after?.sourceObservationId ?? null, query.limit + 1];
    let filter: string;
    if (query.kind === 'ICAO24') {
      values.push(query.icao24Hint);
      filter = 'icao24_hint=$7';
    } else {
      const { west, south, east, north } = query.bounds;
      values.push(west, south, east, north);
      filter = west < east
        ? 'position <@ box(point($7,$8),point($9,$10))'
        : '(position <@ box(point($7,$8),point(180,$10)) OR position <@ box(point(-180,$8),point($9,$10)))';
    }
    const result = await pool.query<{ fact: unknown; observed_at_ms: string; source_id: string;
      source_observation_id: string }>(`SELECT fact,observed_at_ms,source_id,source_observation_id
      FROM tracking.position_observations WHERE observed_at_ms >= $1 AND observed_at_ms < $2
      AND ($3::bigint IS NULL OR (observed_at_ms,source_id,source_observation_id) > ($3,$4,$5))
      AND ${filter} ORDER BY observed_at_ms,source_id,source_observation_id LIMIT $6`, values);
    const hasMore = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit);
    const observations = rows.map(row => {
      const parsed = parseStoredPositionObservation(row.fact);
      if (!parsed.ok) throw new Error('Stored position fact failed validation.');
      return parsed.value;
    });
    const last = rows.at(-1);
    return { observations, next: hasMore && last ? {
      observedAtMs: Number(last.observed_at_ms), sourceId: last.source_id as typeof observations[number]['sourceId'],
      sourceObservationId: last.source_observation_id as typeof observations[number]['sourceObservationId'],
    } : null };
  }
  return { byIcao24: read, withinBounds: read };
}
