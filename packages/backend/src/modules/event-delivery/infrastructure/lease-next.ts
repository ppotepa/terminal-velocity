import { randomUUID } from 'node:crypto';
import type { SqlPool } from '../../../contracts/database/index.ts';
import { eventId } from '../../../contracts/identity/index.ts';
import type { DeliveryLease } from '../domain/delivery-lease.ts';
import { boundedInteger, validateConsumerId } from '../domain/validate-delivery-input.ts';
import { readSafeInteger } from './read-safe-integer.ts';

interface LeaseRow extends Record<string, unknown> {
  event_id: string;
  attempts: number;
  expires_at_ms: unknown;
}

export async function leaseNext(pool: SqlPool, consumerId: string, leaseDurationMs: number,
  maxAttempts: number): Promise<DeliveryLease | null> {
  validateConsumerId(consumerId);
  boundedInteger(leaseDurationMs, 1, 300_000, 'The lease duration');
  const token = randomUUID();
  // A lower retry budget after restart must not strand already-exhausted READY work.
  // Retire at most one such row while independently claiming one eligible delivery.
  const claimed = await pool.query<LeaseRow>(`
    WITH exhausted AS (
      SELECT consumer_id, event_id FROM event_delivery.deliveries
      WHERE consumer_id = $1 AND state = 'READY' AND attempts >= $4
      ORDER BY next_attempt_at, event_id
      LIMIT 1 FOR UPDATE SKIP LOCKED
    ), quarantined AS (
      UPDATE event_delivery.deliveries AS delivery
      SET state = 'QUARANTINED', last_failure_code = 'RETRY_BUDGET_EXHAUSTED'
      FROM exhausted
      WHERE delivery.consumer_id = exhausted.consumer_id AND delivery.event_id = exhausted.event_id
    ), next_delivery AS (
      SELECT consumer_id, event_id FROM event_delivery.deliveries
      WHERE consumer_id = $1 AND state = 'READY'
        AND next_attempt_at <= clock_timestamp() AND attempts < $4
      ORDER BY next_attempt_at, event_id
      LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    UPDATE event_delivery.deliveries AS delivery
    SET state = 'LEASED', attempts = delivery.attempts + 1,
        lease_token = $2::uuid,
        lease_until = clock_timestamp() + ($3::integer * interval '1 millisecond')
    FROM next_delivery
    WHERE delivery.consumer_id = next_delivery.consumer_id AND delivery.event_id = next_delivery.event_id
    RETURNING delivery.event_id, delivery.attempts,
      floor(extract(epoch FROM delivery.lease_until) * 1000)::bigint AS expires_at_ms`,
  [consumerId, token, leaseDurationMs, maxAttempts]);
  const row = claimed.rows[0];
  if (!row) return null;
  const parsedId = eventId(row.event_id);
  if (!parsedId.ok) throw new TypeError('The stored delivery event ID is invalid.');
  return Object.freeze({
    consumerId, eventId: parsedId.value, token,
    attempt: readSafeInteger(row.attempts, 1, 'delivery attempt'),
    expiresAt: readSafeInteger(row.expires_at_ms, 0, 'lease expiry'),
  });
}
