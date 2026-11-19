import type { SqlPool } from '../../../contracts/database/index.ts';
import { runSqlTransaction } from '../../database-transactions/public/index.ts';
import { boundedInteger, validateConsumerIds } from '../domain/validate-delivery-input.ts';

export async function fanOut(pool: SqlPool, consumerIds: readonly string[], batchSize: number): Promise<number> {
  const consumers = validateConsumerIds(consumerIds);
  boundedInteger(batchSize, 1, 1_000, 'The fan-out batch size');
  return runSqlTransaction(pool, async sql => {
    const selected = await sql.query<{ event_id: string }>(`
      SELECT event_id FROM correlation.outbox
      WHERE fanout_completed_at IS NULL
      ORDER BY recorded_at, event_id
      LIMIT $1 FOR UPDATE SKIP LOCKED`, [batchSize]);
    const eventIds = selected.rows.map(row => row.event_id);
    if (eventIds.length === 0) return 0;
    await sql.query(`
      INSERT INTO event_delivery.deliveries (consumer_id, event_id)
      SELECT consumers.consumer_id, events.event_id
      FROM unnest($1::text[]) AS consumers(consumer_id)
      CROSS JOIN unnest($2::text[]) AS events(event_id)
      ON CONFLICT (consumer_id, event_id) DO NOTHING`, [consumers, eventIds]);
    const marked = await sql.query(`
      UPDATE correlation.outbox SET fanout_completed_at = clock_timestamp()
      WHERE event_id = ANY($1::text[]) AND fanout_completed_at IS NULL`, [eventIds]);
    if (marked.rowCount !== eventIds.length) throw new Error('The fan-out checkpoint could not be committed.');
    return eventIds.length;
  });
}
