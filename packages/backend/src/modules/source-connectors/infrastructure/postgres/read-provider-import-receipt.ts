import type { SqlExecutor } from '../../../../contracts/database/index.ts';
import { decodeStoredDecision } from '../../../aircraft-correlation/public/index.ts';
import type { ImportQuarantine, ProviderImportResult } from '../../ports/provider-message-commit.ts';

/** Replay returns the original immutable import decision, even after later correlation corrections. */
export async function readProviderImportReceipt(sql: SqlExecutor, deliveryId: string): Promise<ProviderImportResult> {
  const quarantine = await sql.query<{ reason: ImportQuarantine }>(
    'SELECT reason FROM source_ingestion.import_quarantine WHERE source_delivery_id=$1', [deliveryId]);
  if (quarantine.rows[0]) return { outcome: 'QUARANTINED', sourceDeliveryId: deliveryId, reason: quarantine.rows[0].reason };
  const saved = await sql.query<{ observed_at: string; revision: string; decided_at_ms: string;
    directory_revision: string; decision: unknown }>(`SELECT m.canonical #>> '{observation,observedAt,at}' AS observed_at,
      r.revision,r.decided_at_ms,r.directory_revision,r.decision FROM source_ingestion.message_sources s
      JOIN source_ingestion.message_revisions m ON m.message_id=s.message_id AND m.revision=s.message_revision
      JOIN correlation.aircraft_link_revisions r ON r.message_id=s.message_id AND r.revision=s.decision_revision
      WHERE s.source_delivery_id=$1`, [deliveryId]);
  const row = saved.rows[0];
  if (!row) throw new Error('Completed source inbox is missing its immutable receipt.');
  const decision = decodeStoredDecision({ decision: row.decision, revision: Number(row.revision),
    decidedAt: Number(row.decided_at_ms), directoryRevision: row.directory_revision });
  return { outcome: 'DUPLICATE', sourceDeliveryId: deliveryId, messageId: decision.decision.messageId,
    messageRevision: 1, observedAt: Number(row.observed_at), decision };
}
