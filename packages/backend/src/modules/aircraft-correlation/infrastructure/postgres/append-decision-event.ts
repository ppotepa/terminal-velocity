import type { SqlExecutor } from '../../../../contracts/database/index.ts';
import type { DecisionEvent } from '../../application/decision-event.ts';

export async function appendDecisionEvent(sql: SqlExecutor, event: DecisionEvent): Promise<void> {
  const stored = event.payload;
  const result = await sql.query(`INSERT INTO correlation.outbox
    (event_id, event_type, schema_version, stream_key, stream_revision, occurred_at_ms, payload)
    VALUES ($1, $2, 1, $3, $4, $5, $6::jsonb)`,
  [event.eventId, event.type, stored.decision.messageId, stored.revision, stored.decidedAt, JSON.stringify(stored)]);
  if (result.rowCount !== 1) throw new Error('The decision outbox event was not appended.');
}
