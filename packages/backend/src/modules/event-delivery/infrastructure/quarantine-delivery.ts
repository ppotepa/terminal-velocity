import type { SqlPool } from '../../../contracts/database/index.ts';
import type { DeliveryLease } from '../domain/delivery-lease.ts';
import type { QuarantineOutcome } from '../domain/delivery-results.ts';
import { validateFailureCode, validateLease } from '../domain/validate-delivery-input.ts';

export async function quarantineDelivery(pool: SqlPool, lease: DeliveryLease, code: string): Promise<QuarantineOutcome> {
  validateLease(lease);
  validateFailureCode(code);
  const updated = await pool.query(`
    UPDATE event_delivery.deliveries
    SET state = 'QUARANTINED', lease_token = NULL, lease_until = NULL, last_failure_code = $4
    WHERE consumer_id = $1 AND event_id = $2 AND state = 'LEASED'
      AND lease_token = $3::uuid AND lease_until > clock_timestamp()`,
  [lease.consumerId, lease.eventId, lease.token, code]);
  return updated.rowCount === 1 ? 'QUARANTINED' : 'STALE_LEASE';
}
