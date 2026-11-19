import { randomUUID } from 'node:crypto';
import type { SqlPool } from '../../../../contracts/database/index.ts';
import { runSqlTransaction } from '../../../database-transactions/public/index.ts';
import { fingerprint, normalizedFingerprint, normalizedFactsFingerprint } from './acceptance-fingerprint.ts';
import type { CanonicalSourceObservation } from '../../domain/normalized-observation.ts';
import type { SourceAcceptanceTransaction } from '../../ports/source-acceptance-transaction.ts';
import { postgresSourceDeliveryStore } from './postgres-source-delivery-store.ts';

export function postgresSourceAcceptanceTransaction(pool: SqlPool, nextEventId: () => string = randomUUID,
  syntheticInput?: CanonicalSourceObservation): SourceAcceptanceTransaction {
  return {
    run(observation, origin, work) {
      const snapshot = syntheticInput ? structuredClone(syntheticInput) : undefined;
      const identity = observation.sourceDeliveryId;
      const key = { sourceId: observation.sourceId, identity };
      const lock = JSON.stringify(['source-ingestion', observation.sourceId, identity.provider,
        identity.accountScope, identity.sourceEpoch, identity.externalId]);
      // This option is used only by the explicit synthetic fixture composition. Live acceptance stays metadata-only.
      if (snapshot && (observation.sourceId !== 'src_synthetic' || identity.provider !== 'synthetic'
        || JSON.stringify(snapshot.observation) !== JSON.stringify(observation)))
        throw new Error('Synthetic retention requires the matching synthetic observation.');
      const sha256 = fingerprint(observation, origin.parserVersion);
      return runSqlTransaction(pool, async sql => {
        await sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [lock]);
        const store = postgresSourceDeliveryStore(sql);
        return work({
          async readPrevious() {
            const previous = await store.findDelivery(key);
            if (!previous) return null;
            const event = await sql.query<{ canonical_v1_sha256: string | null; normalized_v1_sha256: string | null; canonical: CanonicalSourceObservation | null }>(`
              SELECT o.canonical_v1_sha256,o.normalized_v1_sha256,s.canonical FROM source_ingestion.outbox o
              LEFT JOIN source_ingestion.synthetic_inputs s USING (delivery_id) WHERE o.delivery_id=$1 AND stream_revision=1 AND event_type='source.delivery-accepted.v1'`, [previous.deliveryId]);
            return {
              deliveryId: previous.deliveryId,
              matches: previous.disposition.state === 'ACCEPTED' && event.rows[0]?.canonical_v1_sha256 === sha256
                && (!snapshot || (!!event.rows[0]?.canonical
                  && normalizedFactsFingerprint(event.rows[0].canonical) === normalizedFactsFingerprint(snapshot))),
              origin: { pageUrl: previous.pageUrl, parserVersion: previous.parserVersion,
                retrievedAt: previous.retrievedAt, ingestedAt: previous.ingestedAt },
            };
          },
          async append() {
            const deliveryId = await store.appendDelivery(observation, origin, { state: 'ACCEPTED' });
            await sql.query(`INSERT INTO source_ingestion.outbox
              (event_id,delivery_id,stream_revision,event_type,payload,canonical_v1_sha256,normalized_v1_sha256)
              VALUES ($1,$2,1,'source.delivery-accepted.v1',jsonb_build_object('deliveryId',$2::uuid),$3,$4)`,
            [nextEventId(), deliveryId, sha256, snapshot ? normalizedFingerprint(snapshot) : null]);
            if (snapshot) await sql.query(`INSERT INTO source_ingestion.synthetic_inputs(delivery_id,canonical)
              VALUES ($1,$2::jsonb)`, [deliveryId, JSON.stringify(snapshot)]);
            return { deliveryId, origin };
          },
        });
      });
    },
  };
}
