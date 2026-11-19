import { createHash, randomUUID } from 'node:crypto';
import type { SqlPool } from '../../../../contracts/database/index.ts';
import { runSqlTransaction } from '../../../database-transactions/public/index.ts';
import type { SourceObservation } from '../../domain/source-observation.ts';
import type { SourceAcceptanceTransaction } from '../../ports/source-acceptance-transaction.ts';
import { postgresSourceDeliveryStore } from './postgres-source-delivery-store.ts';

/** V1 hashes UTF-8 JSON with sorted object keys; protocol-layer array order is significant. */
function fingerprint(observation: SourceObservation, parserVersion: string): string {
  const json = JSON.stringify([parserVersion, observation], (_key, value: unknown) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  });
  return createHash('sha256').update('source-acceptance-v1\0').update(json, 'utf8').digest('hex');
}

export function postgresSourceAcceptanceTransaction(pool: SqlPool, nextEventId: () => string = randomUUID): SourceAcceptanceTransaction {
  return {
    run(observation, origin, work) {
      const identity = observation.sourceDeliveryId;
      const key = { sourceId: observation.sourceId, identity };
      const lock = JSON.stringify(['source-ingestion', observation.sourceId, identity.provider,
        identity.accountScope, identity.sourceEpoch, identity.externalId]);
      const sha256 = fingerprint(observation, origin.parserVersion);
      return runSqlTransaction(pool, async sql => {
        await sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [lock]);
        const store = postgresSourceDeliveryStore(sql);
        return work({
          async readPrevious() {
            const previous = await store.findDelivery(key);
            if (!previous) return null;
            const event = await sql.query<{ canonical_v1_sha256: string | null }>(`
              SELECT canonical_v1_sha256 FROM source_ingestion.outbox
              WHERE delivery_id=$1 AND stream_revision=1 AND event_type='source.delivery-accepted.v1'`, [previous.deliveryId]);
            return {
              deliveryId: previous.deliveryId,
              matches: previous.disposition.state === 'ACCEPTED' && event.rows[0]?.canonical_v1_sha256 === sha256,
              origin: { pageUrl: previous.pageUrl, parserVersion: previous.parserVersion,
                retrievedAt: previous.retrievedAt, ingestedAt: previous.ingestedAt },
            };
          },
          async append() {
            const deliveryId = await store.appendDelivery(observation, origin, { state: 'ACCEPTED' });
            await sql.query(`INSERT INTO source_ingestion.outbox
              (event_id,delivery_id,stream_revision,event_type,payload,canonical_v1_sha256)
              VALUES ($1,$2,1,'source.delivery-accepted.v1',jsonb_build_object('deliveryId',$2::uuid),$3)`,
            [nextEventId(), deliveryId, sha256]);
            return { deliveryId, origin };
          },
        });
      });
    },
  };
}
