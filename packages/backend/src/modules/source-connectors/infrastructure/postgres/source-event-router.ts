import type { SqlPool } from '../../../../contracts/database/index.ts';
import { runSqlTransaction } from '../../../database-transactions/public/index.ts';

export const SOURCE_IMPORT_CONSUMER = 'provider-message-import-v1';
export const PRIVATE_AVAILABILITY_CONSUMER = 'provider-private-availability-v1';

/** One producer checkpoint belongs to one fixed subscription set in this stage. */
export async function routeSourceEvents(pool: SqlPool): Promise<number> {
  return runSqlTransaction(pool, async sql => {
    const sources = await sql.query<{ event_id: string }>(`SELECT event_id FROM source_ingestion.outbox
      WHERE fanout_completed_at IS NULL ORDER BY recorded_at,event_id LIMIT 100 FOR UPDATE SKIP LOCKED`);
    for (const row of sources.rows) {
      const id = 'evt_source-' + row.event_id;
      await sql.query(`INSERT INTO event_delivery.events(event_id,source_event_id)
        VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, row.event_id]);
      const registered = await sql.query(`SELECT event_id FROM event_delivery.events
        WHERE event_id=$1 AND source_event_id=$2`, [id, row.event_id]);
      if (registered.rows.length !== 1) throw new Error('Source producer event identity conflict.');
      await sql.query(`INSERT INTO event_delivery.deliveries(consumer_id,event_id)
        VALUES ($1,$2) ON CONFLICT DO NOTHING`, [SOURCE_IMPORT_CONSUMER, id]);
      await sql.query(`UPDATE source_ingestion.outbox SET fanout_completed_at=clock_timestamp() WHERE event_id=$1`, [row.event_id]);
    }
    const decisions = await sql.query<{ event_id: string }>(`SELECT o.event_id FROM correlation.outbox o
      WHERE fanout_completed_at IS NULL AND EXISTS
        (SELECT 1 FROM source_ingestion.message_revisions m WHERE m.message_id=o.stream_key)
      ORDER BY recorded_at,event_id LIMIT 100 FOR UPDATE OF o SKIP LOCKED`);
    for (const row of decisions.rows) {
      await sql.query(`INSERT INTO event_delivery.events(event_id,correlation_event_id)
        VALUES ($1,$1) ON CONFLICT DO NOTHING`, [row.event_id]);
      const registered = await sql.query(`SELECT event_id FROM event_delivery.events
        WHERE event_id=$1 AND correlation_event_id=$1`, [row.event_id]);
      if (registered.rows.length !== 1) throw new Error('Correlation producer event identity conflict.');
      await sql.query(`INSERT INTO event_delivery.deliveries(consumer_id,event_id)
        VALUES ($1,$2) ON CONFLICT DO NOTHING`, [PRIVATE_AVAILABILITY_CONSUMER, row.event_id]);
      await sql.query(`UPDATE correlation.outbox SET fanout_completed_at=clock_timestamp() WHERE event_id=$1`, [row.event_id]);
    }
    return sources.rows.length + decisions.rows.length;
  });
}
