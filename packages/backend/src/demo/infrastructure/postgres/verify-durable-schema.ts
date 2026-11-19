import type { SqlExecutor } from '../../../contracts/database/index.ts';
/** Startup checks existing schema access; migrations require a separate administrator command. */
export async function verifyDurableSchema(sql: SqlExecutor): Promise<void> {
  await sql.query(`SELECT m.message_id FROM message_ingestion.messages m
    CROSS JOIN correlation.aircraft_link_heads h CROSS JOIN correlation.aircraft_link_revisions r
    CROSS JOIN correlation.outbox o CROSS JOIN event_delivery.deliveries d
    CROSS JOIN event_delivery.events e CROSS JOIN source_ingestion.message_revisions pm
    CROSS JOIN event_delivery.consumer_inbox i CROSS JOIN availability.contributions a LIMIT 0`);
}
