import type { SqlPool } from '../../../contracts/database/index.ts';
import { boundedInteger } from '../domain/validate-delivery-input.ts';

export async function recoverExpired(pool: SqlPool, batchSize: number, maxAttempts: number): Promise<number> {
  boundedInteger(batchSize, 1, 1_000, 'The recovery batch size');
  const recovered = await pool.query(`
    WITH expired AS (
      SELECT consumer_id, event_id FROM event_delivery.deliveries
      WHERE state = 'LEASED' AND lease_until <= clock_timestamp()
      ORDER BY lease_until, consumer_id, event_id
      LIMIT $1 FOR UPDATE SKIP LOCKED
    )
    UPDATE event_delivery.deliveries AS delivery
    SET state = CASE WHEN delivery.attempts >= $2 THEN 'QUARANTINED' ELSE 'READY' END,
        next_attempt_at = clock_timestamp(), lease_token = NULL, lease_until = NULL,
        last_failure_code = 'LEASE_EXPIRED'
    FROM expired
    WHERE delivery.consumer_id = expired.consumer_id AND delivery.event_id = expired.event_id`,
  [batchSize, maxAttempts]);
  return recovered.rowCount ?? 0;
}
