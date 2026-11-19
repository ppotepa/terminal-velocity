import type { SqlPool } from '../../../contracts/database/index.ts';
import type { DeliveryLease } from '../domain/delivery-lease.ts';
import type { RetryOutcome, RetryRequest } from '../domain/delivery-results.ts';
import { boundedInteger, validateFailureCode, validateLease } from '../domain/validate-delivery-input.ts';

export async function retryDelivery(pool: SqlPool, lease: DeliveryLease, failure: RetryRequest,
  maxAttempts: number): Promise<RetryOutcome> {
  validateLease(lease);
  validateFailureCode(failure.code);
  boundedInteger(failure.delayMs, 0, 86_400_000, 'The retry delay');
  const updated = await pool.query<{ state: 'READY' | 'QUARANTINED' }>(`
    UPDATE event_delivery.deliveries
    SET state = CASE WHEN attempts >= $6 THEN 'QUARANTINED' ELSE 'READY' END,
        next_attempt_at = clock_timestamp() + ($5::integer * interval '1 millisecond'),
        lease_token = NULL, lease_until = NULL, last_failure_code = $4
    WHERE consumer_id = $1 AND event_id = $2 AND state = 'LEASED'
      AND lease_token = $3::uuid AND lease_until > clock_timestamp()
    RETURNING state`, [lease.consumerId, lease.eventId, lease.token, failure.code, failure.delayMs, maxAttempts]);
  const row = updated.rows[0];
  return row ? (row.state === 'READY' ? 'RETRY_SCHEDULED' : 'QUARANTINED') : 'STALE_LEASE';
}
