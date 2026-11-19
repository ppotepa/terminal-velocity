import type { SqlExecutor, SqlPool } from '../../../contracts/database/index.ts';
import { runSqlTransaction } from '../../database-transactions/public/index.ts';
import type { DeliveryLease } from '../domain/delivery-lease.ts';
import type { ConsumeOutcome } from '../domain/delivery-results.ts';
import { EventIdentityConflict } from '../domain/event-identity-conflict.ts';
import { snapshotLease } from '../domain/validate-delivery-input.ts';
import type { EventProjector } from '../ports/atomic-event-consumer.ts';
import { readOutboxEvent, type OutboxEventRow } from './read-outbox-event.ts';

/** Throwing, rather than returning, is essential after a projector has written effects. */
class StaleLeaseAbort extends Error {}

export async function consumeEvent(pool: SqlPool, lease: DeliveryLease,
  project: EventProjector<SqlExecutor>): Promise<ConsumeOutcome> {
  const claim = snapshotLease(lease);
  try {
    return await runSqlTransaction(pool, async sql => {
      const selected = await sql.query<OutboxEventRow>(`
        SELECT outbox.event_id, outbox.event_type, outbox.schema_version,
          outbox.stream_key, outbox.stream_revision, outbox.occurred_at_ms, outbox.payload
        FROM event_delivery.deliveries AS delivery
        JOIN correlation.outbox AS outbox ON outbox.event_id = delivery.event_id
        WHERE delivery.consumer_id = $1 AND delivery.event_id = $2
          AND delivery.state = 'LEASED' AND delivery.lease_token = $3::uuid
          AND delivery.lease_until > clock_timestamp()
        FOR UPDATE OF delivery`, [claim.consumerId, claim.eventId, claim.token]);
      const row = selected.rows[0];
      if (!row) return 'STALE_LEASE';
      const { event, digest } = readOutboxEvent(row);
      const inserted = await sql.query(`
        INSERT INTO event_delivery.consumer_inbox (consumer_id, event_id, payload_digest)
        VALUES ($1, $2, $3)
        ON CONFLICT (consumer_id, event_id) DO NOTHING RETURNING event_id`,
      [claim.consumerId, claim.eventId, digest]);
      const outcome = inserted.rowCount === 1 ? 'APPLIED' : 'DUPLICATE';
      if (outcome === 'APPLIED') await project(sql, event);
      else {
        // A separate READ COMMITTED statement sees the winner of a concurrent INSERT.
        const existing = await sql.query<{ payload_digest: string }>(`
          SELECT payload_digest FROM event_delivery.consumer_inbox
          WHERE consumer_id = $1 AND event_id = $2`, [claim.consumerId, claim.eventId]);
        if (existing.rows[0]?.payload_digest !== digest) throw new EventIdentityConflict();
      }
      const completed = await sql.query(`
        UPDATE event_delivery.deliveries
        SET state = 'DONE', completed_at = clock_timestamp(), lease_token = NULL, lease_until = NULL
        WHERE consumer_id = $1 AND event_id = $2 AND state = 'LEASED'
          AND lease_token = $3::uuid AND lease_until > clock_timestamp()`,
      [claim.consumerId, claim.eventId, claim.token]);
      if (completed.rowCount !== 1) throw new StaleLeaseAbort();
      return outcome;
    });
  } catch (error) {
    if (error instanceof StaleLeaseAbort) return 'STALE_LEASE';
    throw error;
  }
}
