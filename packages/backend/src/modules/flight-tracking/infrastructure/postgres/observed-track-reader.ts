import type { SqlExecutor, SqlPool } from '../../../../contracts/database/index.ts';
import { runSqlTransaction } from '../../../database-transactions/public/index.ts';
import { buildObservedTrack, simplifyObservedTrack, type ObservedTrackPoint } from '../../domain/observed-track.ts';
import { observedTrackQuery } from '../../domain/observed-track-query.ts';
import { parseStoredPositionObservation } from '../../domain/position-observation.ts';
import type { ObservedTrackPage, ObservedTrackReader } from '../../ports/observed-track-reader.ts';

type TrackRow = { observed_at_ms: string; source_id: string; source_observation_id: string;
  observation_id: string; fact: unknown };

export class StaleObservedTrackCursor extends Error {
  readonly code = 'STALE_OBSERVED_TRACK_CURSOR' as const;
}

function point(row: TrackRow): ObservedTrackPoint {
  const parsed = parseStoredPositionObservation(row.fact);
  if (!parsed.ok) throw new Error('Stored track fact failed validation.');
  const fact = parsed.value;
  if (Date.parse(fact.observedAt) !== Number(row.observed_at_ms)
    || fact.sourceId !== row.source_id || fact.sourceObservationId !== row.source_observation_id)
    throw new Error('Stored track row and fact disagree.');
  return { observationId: row.observation_id, sourceId: fact.sourceId,
    sourceObservationId: row.source_observation_id, observedAtMs: Number(row.observed_at_ms),
    latitude: fact.latitude, longitude: fact.longitude,
    measurementKind: fact.measurementKind, quality: fact.quality ?? null,
    timestampPrecision: fact.timestampPrecision,
    timestampUncertaintyMs: fact.timestampUncertaintyMs };
}

async function priorPoint(sql: SqlExecutor, aircraftId: string, time: number,
  sourceId: string, observationId: string): Promise<ObservedTrackPoint> {
  const result = await sql.query<TrackRow>(`SELECT c.observed_at_ms,c.source_id,
    c.source_observation_id,c.observation_id,p.fact
    FROM tracking.current_position_candidates c
    JOIN tracking.position_observations p USING (source_id,source_observation_id)
    WHERE c.aircraft_id=$1 AND c.observed_at_ms=$2 AND c.source_id=$3
      AND c.observation_id=$4::uuid`, [aircraftId, time, sourceId, observationId]);
  if (!result.rows[0]) throw new StaleObservedTrackCursor('Observed track cursor point is missing.');
  return point(result.rows[0]);
}

export function postgresObservedTrackReader(pool: SqlPool): ObservedTrackReader {
  return { async read(raw): Promise<ObservedTrackPage> {
    const parsed = observedTrackQuery(raw);
    if (!parsed.ok) throw new RangeError(`Invalid observed track query: ${parsed.error.field}`);
    const query = parsed.value;
    return runSqlTransaction(pool, async sql => {
      // The worker holds this same row FOR UPDATE until candidate and revision
      // changes commit. This read therefore sees one coherent page checkpoint.
      const state = await sql.query<{ revision: string }>(`SELECT revision
        FROM tracking.current_position_state WHERE singleton FOR SHARE`);
      const revision = Number(state.rows[0]?.revision);
      if (!Number.isSafeInteger(revision)) throw new Error('Track checkpoint is invalid.');
      if (query.after && query.after.projectionRevision !== revision)
        throw new StaleObservedTrackCursor('Observed track projection changed; start a new page.');
      const previous = query.after ? await priorPoint(sql, query.aircraftId,
        query.after.observedAtMs, query.after.sourceId, query.after.observationId) : null;
      const rows = await sql.query<TrackRow>(`SELECT c.observed_at_ms,c.source_id,
        c.source_observation_id,c.observation_id,p.fact
        FROM tracking.current_position_candidates c
        JOIN tracking.position_observations p USING (source_id,source_observation_id)
        WHERE c.aircraft_id=$1 AND c.observed_at_ms >= $2 AND c.observed_at_ms < $3
          AND ($4::bigint IS NULL OR (c.observed_at_ms,c.source_id COLLATE "C",c.observation_id)
            > ($4,$5,$6::uuid))
        ORDER BY c.observed_at_ms,c.source_id COLLATE "C",c.observation_id LIMIT $7`,
      [query.aircraftId, query.fromObservedAtMs, query.toObservedAtMs,
        query.after?.observedAtMs ?? null, query.after?.sourceId ?? null,
        query.after?.observationId ?? null, query.limit + 1]);
      const hasMore = rows.rows.length > query.limit;
      const page = rows.rows.slice(0, query.limit).map(point);
      const segments = simplifyObservedTrack(buildObservedTrack(page, previous),
        query.pointBudget, query.zoom);
      const last = page.at(-1);
      return { aircraftId: query.aircraftId, projectionRevision: revision,
        segments, observedCount: page.length, hasMore,
        next: hasMore && last ? { aircraftId: query.aircraftId,
          fromObservedAtMs: query.fromObservedAtMs, toObservedAtMs: query.toObservedAtMs,
          projectionRevision: revision, observedAtMs: last.observedAtMs,
          sourceId: last.sourceId,
          observationId: last.observationId } : null };
    });
  } };
}
