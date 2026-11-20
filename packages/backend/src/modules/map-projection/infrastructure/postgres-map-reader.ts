import type { SqlPool } from '../../../contracts/database/index.ts';
import { runSqlTransaction } from '../../database-transactions/public/index.ts';
import { mapViewportQuery } from '../domain/map-query.ts';
import type { MapAircraft, MapReader } from '../ports/map-reader.ts';

interface MapRow extends Record<string, unknown> {
  aircraft_id: string;
  latitude: number;
  longitude: number;
  observed_at_ms: string;
  source_id: string;
  measurement_kind: 'ADS_B' | 'MLAT' | 'OTHER';
  position_status: 'CURRENT' | 'STALE' | 'UNKNOWN';
  last_message_at_ms: string | null;
  message_status: 'RECENT' | 'STALE' | 'NONE';
}

const mapSql = `WITH spatial AS (
  SELECT p.aircraft_id,p.latitude,p.longitude,p.observed_at_ms,p.source_id,
    p.measurement_kind,p.timestamp_precision,p.timestamp_uncertainty_ms
  FROM tracking.map_aircraft_positions p
  WHERE p.aircraft_id COLLATE "C" > $5
    AND (CASE WHEN $1::float8 <= $3::float8
      THEN p.position <@ box(point($1,$2),point($3,$4))
      ELSE p.position <@ box(point($1,$2),point(180,$4))
        OR p.position <@ box(point(-180,$2),point($3,$4)) END)
), ranked AS (
  SELECT spatial.*,m.last_message_at_ms,
    CASE WHEN spatial.timestamp_uncertainty_ms IS NULL OR spatial.timestamp_precision='UNKNOWN'
      OR $6::bigint-spatial.observed_at_ms < 0
      OR $6::bigint-spatial.observed_at_ms-spatial.timestamp_uncertainty_ms
        -(CASE spatial.timestamp_precision WHEN 'MILLISECOND' THEN 1 WHEN 'SECOND' THEN 1000
          WHEN 'MINUTE' THEN 60000 ELSE 3600000 END) < 0 THEN 'UNKNOWN'
      WHEN $6::bigint-spatial.observed_at_ms+spatial.timestamp_uncertainty_ms
        +(CASE spatial.timestamp_precision WHEN 'MILLISECOND' THEN 1 WHEN 'SECOND' THEN 1000
          WHEN 'MINUTE' THEN 60000 ELSE 3600000 END) < 60000 THEN 'CURRENT'
      WHEN $6::bigint-spatial.observed_at_ms-spatial.timestamp_uncertainty_ms
        -(CASE spatial.timestamp_precision WHEN 'MILLISECOND' THEN 1 WHEN 'SECOND' THEN 1000
          WHEN 'MINUTE' THEN 60000 ELSE 3600000 END) >= 60000 THEN 'STALE'
      ELSE 'UNKNOWN' END AS position_status,
    CASE WHEN m.last_message_at_ms IS NULL OR m.last_message_at_ms > $6::bigint THEN 'NONE'
      WHEN $6::bigint-m.last_message_at_ms < 600000 THEN 'RECENT'
      WHEN $6::bigint-m.last_message_at_ms < 3600000 THEN 'STALE'
      ELSE 'NONE' END AS message_status
  FROM spatial LEFT JOIN LATERAL (
    SELECT max(last_observed_at_ms) AS last_message_at_ms
    FROM tracking.map_demo_message_status s
    WHERE s.aircraft_id=spatial.aircraft_id AND ($9::text IS NULL OR s.bearer=$9)
  ) m ON true
)
SELECT aircraft_id,latitude,longitude,observed_at_ms,source_id,measurement_kind,
  position_status,last_message_at_ms,message_status FROM ranked
WHERE ($7::text IS NULL OR position_status=$7)
  AND ($8::text IS NULL OR message_status=$8)
  AND ($9::text IS NULL OR last_message_at_ms IS NOT NULL)
ORDER BY aircraft_id COLLATE "C" LIMIT $10`;

/** Reads a versioned, bounded private viewport under the map-state lock. */
export function createPostgresMapReader(pool: SqlPool, now: () => number = Date.now): MapReader {
  return { async read(input) {
    const query = mapViewportQuery(input);
    return runSqlTransaction(pool, async sql => {
      await sql.query(`SET LOCAL statement_timeout = '1000ms'`);
      const state = await sql.query<{ revision: string }>(
        'SELECT revision FROM tracking.map_state WHERE singleton FOR SHARE');
      const revision = Number(state.rows[0]?.revision);
      if (!Number.isSafeInteger(revision)) throw new Error('The map checkpoint is missing.');
      if (query.cursor && query.cursor.revision !== revision)
        throw new RangeError('STALE_MAP_CURSOR');
      const asOf = query.cursor?.asOf ?? new Date(now()).toISOString();
      const nowMs = Date.parse(asOf);
      const { west, south, east, north } = query.bbox;
      const selected = await sql.query<MapRow>(mapSql,
        [west,south,east,north,query.cursor?.after ?? '',nowMs,
          query.positionStatus ?? null,query.messageStatus ?? null,query.protocol ?? null,query.limit+1]);
      const rows = selected.rows.slice(0, query.limit);
      const data: MapAircraft[] = rows.map(row => ({
        aircraftId: row.aircraft_id,
        position: { latitude: row.latitude, longitude: row.longitude,
          observedAt: new Date(Number(row.observed_at_ms)).toISOString(),
          freshness: row.position_status, source: row.source_id,
          measurementKind: row.measurement_kind },
        messages: { freshness: row.message_status,
          lastMessageAt: row.last_message_at_ms === null ? null
            : new Date(Number(row.last_message_at_ms)).toISOString(),
          coverage: 'UNKNOWN', feedHealth: 'DISCONNECTED' },
      }));
      return { data, asOf, checkpoint: revision,
        nextCursor: selected.rows.length > query.limit && rows.length > 0
          ? { revision, after: rows[rows.length-1]!.aircraft_id, asOf, queryKey: query.queryKey }
          : null };
    });
  } };
}
