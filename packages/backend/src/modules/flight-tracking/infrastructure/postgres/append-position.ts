import { randomUUID } from 'node:crypto';
import type { SqlPool } from '../../../../contracts/database/index.ts';
import { runSqlTransaction } from '../../../database-transactions/public/index.ts';
import { parsePositionObservation } from '../../domain/position-observation.ts';
import type { PositionHistoryWriter } from '../../ports/position-history-writer.ts';

/** The source's stable observation key is the delivery retry boundary. */
export function postgresPositionHistoryWriter(pool: SqlPool,
  nextEventId: () => string = () => `evt_${randomUUID()}`): PositionHistoryWriter {
  return {
    async append(input) {
      const parsed = parsePositionObservation(input);
      if (!parsed.ok) return { ok: false, error: { code: 'INVALID_POSITION_OBSERVATION', error: parsed.error } };
      const observation = parsed.value;
      return runSqlTransaction(pool, async sql => {
        const fact = JSON.stringify(observation);
        const inserted = await sql.query(`INSERT INTO tracking.position_observations
          (observation_id,source_id,source_observation_id,source_delivery_ref,observed_at_ms,ingested_at_ms,
           measurement_kind,quality,latitude,longitude,fact)
          VALUES ($10,$1,$2,$3,$4,$5,$6,$11::jsonb,$7,$8,$9::jsonb)
          ON CONFLICT (source_id,source_observation_id) DO NOTHING
          RETURNING source_id`, [observation.sourceId, observation.sourceObservationId,
          observation.sourceDeliveryRef ?? null, Date.parse(observation.observedAt),
          Date.parse(observation.ingestedAt), observation.measurementKind,
          observation.latitude, observation.longitude, fact, randomUUID(),
          observation.quality ? JSON.stringify(observation.quality) : null]);
        if (inserted.rowCount === 0) {
          const previous = await sql.query<{ matches: boolean; event_id: string }>(`
            SELECT p.fact = $3::jsonb AS matches,o.event_id FROM tracking.position_observations p
            JOIN tracking.position_observation_outbox o USING (source_id,source_observation_id)
            WHERE p.source_id=$1 AND p.source_observation_id=$2`,
          [observation.sourceId, observation.sourceObservationId, fact]);
          if (previous.rows.length !== 1 || !previous.rows[0]?.matches)
            return { ok: false, error: { code: 'SOURCE_OBSERVATION_CONFLICT' } };
          return { ok: true, value: { status: 'ALREADY_PRESENT',
            eventId: previous.rows[0]!.event_id, observation } };
        }
        const eventId = nextEventId();
        await sql.query(`INSERT INTO tracking.position_observation_outbox
          (event_id,event_type,schema_version,source_id,source_observation_id,occurred_at_ms,payload)
          VALUES ($1,'tracking.position-observation-recorded.v1',1,$2,$3,$4,$5::jsonb)`,
        [eventId, observation.sourceId, observation.sourceObservationId,
          Date.parse(observation.observedAt), JSON.stringify({
            eventType: 'tracking.position-observation-recorded.v1',
            sourceId: observation.sourceId, sourceObservationId: observation.sourceObservationId,
            occurredAtMs: Date.parse(observation.observedAt), observation,
          })]);
        return { ok: true, value: { status: 'INSERTED', eventId, observation } };
      });
    },
  };
}
