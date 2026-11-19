import type { SqlExecutor } from '../../../../contracts/database/index.ts';
import type { MessageId } from '../../../../contracts/identity/index.ts';
import type { DecisionTransaction } from '../../../aircraft-correlation/public/index.ts';
import type { CanonicalSourceObservation } from '../../domain/normalized-observation.ts';
import { providerFactsFingerprint } from './acceptance-fingerprint.ts';
import type { ProviderMessageCommit } from '../../ports/provider-message-commit.ts';

export function postgresProviderMessageCommit(sql: SqlExecutor, id: MessageId, deliveryId: string,
  decisions: DecisionTransaction, incoming: CanonicalSourceObservation | null): ProviderMessageCommit {
  return {
    decisions,
    async read() {
      const decision = await decisions.run(writes => writes.read(id));
      if (!decision) return null;
      const previous = await sql.query<{ canonical: CanonicalSourceObservation }>(
        'SELECT canonical FROM source_ingestion.message_revisions WHERE message_id=$1 AND revision=1', [id]);
      return { decision, sameFacts: !!incoming && !!previous.rows[0]
        && providerFactsFingerprint(previous.rows[0].canonical) === providerFactsFingerprint(incoming) };
    },
    async link(decision) {
      await sql.query(`INSERT INTO source_ingestion.message_sources(message_id,source_delivery_id,decision_revision)
        VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [id, deliveryId, decision.revision]);
    },
    async insert(canonical) {
      await sql.query(`INSERT INTO source_ingestion.message_revisions
        (message_id,revision,source_delivery_id,transformation_id,canonical)
        VALUES ($1,1,$2,'provider-message/1',$3::jsonb)`, [id, deliveryId, JSON.stringify(canonical)]);
    },
    async quarantine(reason) {
      await sql.query(`INSERT INTO source_ingestion.import_quarantine(source_delivery_id,reason)
        VALUES ($1,$2) ON CONFLICT DO NOTHING`, [deliveryId, reason]);
    },
  };
}
