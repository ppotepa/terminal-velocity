import type { SqlExecutor } from '../../../../contracts/database/index.ts';
import { epochMillis } from '../../../../kernel/time/epoch-millis.ts';
import type { StoredDecision } from '../../../aircraft-correlation/public/index.ts';
import { classifyAge, type FreshnessPolicy } from '../../../message-availability/public/index.ts';

export async function projectPrivateDecision(sql: SqlExecutor, stored: StoredDecision): Promise<void> {
  const id = stored.decision.messageId;
  const facts = await sql.query<{ observed_at: string }>(`SELECT canonical #>> '{observation,observedAt,at}' AS observed_at
    FROM source_ingestion.message_revisions WHERE message_id=$1 AND revision=1`, [id]);
  if (!facts.rows[0]) throw new Error('Missing private message facts.');
  const observed = Number(facts.rows[0].observed_at);
  if (!epochMillis(observed).ok) throw new Error('Invalid private observation time.');
  const aircraft = stored.decision.status === 'MATCHED' ? stored.decision.aircraftId : null;
  await sql.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, ['private-contribution:' + id]);
  const current = await sql.query<{ decision_revision: string; aircraft_id: string | null; observed_at_ms: string }>(
    `SELECT * FROM source_ingestion.private_contributions WHERE message_id=$1`, [id]);
  const previous = current.rows[0];
  if (previous && Number(previous.decision_revision) >= stored.revision) {
    if (Number(previous.decision_revision) === stored.revision
      && (previous.aircraft_id !== aircraft || Number(previous.observed_at_ms) !== observed))
      throw new Error('Private contribution revision collision.');
    return;
  }
  await sql.query(`INSERT INTO source_ingestion.private_contributions(message_id,decision_revision,aircraft_id,observed_at_ms)
    VALUES ($1,$2,$3,$4) ON CONFLICT (message_id) DO UPDATE SET decision_revision=EXCLUDED.decision_revision,
      aircraft_id=EXCLUDED.aircraft_id,observed_at_ms=EXCLUDED.observed_at_ms`, [id, stored.revision, aircraft, observed]);
}

/** Internal SQL use only. No REST route or public availability reader uses this table. */
export async function readPrivateAvailability(sql: SqlExecutor, aircraftId: string, now: number, policy: FreshnessPolicy) {
  const time = epochMillis(now);
  if (!time.ok) throw new Error('Invalid private availability clock.');
  const rows = await sql.query<{ message_id: string; decision_revision: string; observed_at_ms: string;
    source_delivery_id: string; provenance: unknown }>(`SELECT c.message_id,c.decision_revision,c.observed_at_ms,
      m.source_delivery_id,d.provenance FROM source_ingestion.private_contributions c
      JOIN source_ingestion.message_revisions m ON m.message_id=c.message_id AND m.revision=c.message_revision
      JOIN source_ingestion.deliveries d ON d.delivery_id=m.source_delivery_id
      WHERE c.aircraft_id=$1 ORDER BY c.observed_at_ms DESC,c.message_id`, [aircraftId]);
  const latest = rows.rows[0] ? epochMillis(Number(rows.rows[0].observed_at_ms)) : null;
  if (latest && !latest.ok) throw new Error('Invalid stored private observation time.');
  return { freshness: classifyAge(latest?.ok ? latest.value : null, time.value, policy), contributions: rows.rows };
}
