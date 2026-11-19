import type { SqlExecutor } from '../../../../contracts/database/index.ts';
import type { SourceDeliveryStore, StoredSourceDelivery } from '../../ports/source-delivery-store.ts';

function pageLocation(input: string): string {
  const url = new URL(input);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Invalid source page location');
  return url.origin + url.pathname;
}

/** One statement inserts the delivery and its optional subtype on the injected executor. */
export function postgresSourceDeliveryStore(sql: SqlExecutor): SourceDeliveryStore {
  return {
    async appendDelivery(observation, origin, disposition) {
      const { sourceDeliveryId: key, receivedAt, observedAt } = observation;
      const message = observation.dataLevel === 'PROVIDER_MESSAGE' ? observation : null;
      const reception = observation.dataLevel === 'RECEPTION' ? observation : null;
      const result = await sql.query<{ delivery_id: string }>(`
        WITH delivery AS (
          INSERT INTO source_ingestion.deliveries (
            source_id, provider_id, account_scope, source_epoch, external_id, payload_sha256, data_level,
            schema_version, capabilities_revision, decoder_version, received_at_ms, received_basis,
            received_precision, received_uncertainty_ms, observed_at_ms, observed_basis, observed_precision,
            observed_uncertainty_ms, retrieved_at_ms, ingested_at_ms, provenance, state, quarantine_reason
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
          RETURNING delivery_id, data_level
        ), message AS (
          INSERT INTO source_ingestion.provider_message_observations (delivery_id, direction, bearer)
          SELECT delivery_id, $24, $25 FROM delivery WHERE data_level = 'PROVIDER_MESSAGE'
        ), reception AS (
          INSERT INTO source_ingestion.receptions (delivery_id, receiver_id, frequency_hz, signal_strength_dbm)
          SELECT delivery_id, $26, $27, $28 FROM delivery WHERE data_level = 'RECEPTION'
        )
        SELECT delivery_id FROM delivery`, [
        observation.sourceId, key.provider, key.accountScope, key.sourceEpoch, key.externalId,
        observation.payloadDigest, observation.dataLevel, observation.schemaVersion, observation.capabilitiesRevision,
        observation.decoderVersion ?? null, receivedAt.at, receivedAt.basis, receivedAt.precision, receivedAt.uncertaintyMs,
        observedAt?.at ?? null, observedAt?.basis ?? null, observedAt?.precision ?? null, observedAt?.uncertaintyMs ?? null,
        origin.retrievedAt, origin.ingestedAt, { pageUrl: pageLocation(origin.pageUrl), parserVersion: origin.parserVersion },
        disposition.state, disposition.state === 'QUARANTINED' ? disposition.reason : null,
        message?.direction ?? null, message?.bearer ?? null, reception?.receiverId ?? null,
        reception?.frequencyHz ?? null, reception?.signalStrengthDbm ?? null,
      ]);
      const row = result.rows[0];
      if (!row) throw new Error('Delivery insert returned no identifier');
      return row.delivery_id;
    },

    async findDelivery({ sourceId, identity }) {
      const result = await sql.query<StoredSourceDelivery & Record<string, unknown>>(`
        SELECT d.delivery_id AS "deliveryId", source_id AS "sourceId",
          jsonb_build_object('provider',provider_id,'accountScope',account_scope,
            'sourceEpoch',source_epoch,'externalId',external_id) AS identity,
          payload_sha256 AS "payloadDigest", d.data_level AS "dataLevel", schema_version AS "schemaVersion",
          capabilities_revision::float8 AS "capabilitiesRevision", decoder_version AS "decoderVersion",
          jsonb_build_object('at',received_at_ms,'basis',received_basis,'precision',received_precision,
            'uncertaintyMs',received_uncertainty_ms) AS "receivedAt",
          CASE WHEN observed_at_ms IS NOT NULL THEN jsonb_build_object('at',observed_at_ms,'basis',observed_basis,
            'precision',observed_precision,'uncertaintyMs',observed_uncertainty_ms) END AS "observedAt",
          retrieved_at_ms::float8 AS "retrievedAt", ingested_at_ms::float8 AS "ingestedAt",
          provenance->>'pageUrl' AS "pageUrl", provenance->>'parserVersion' AS "parserVersion",
          retention, jsonb_strip_nulls(jsonb_build_object('state',state,'reason',quarantine_reason)) AS disposition,
          CASE WHEN m.delivery_id IS NOT NULL THEN jsonb_build_object('direction',m.direction,'bearer',m.bearer)
            END AS "providerMessage",
          CASE WHEN r.delivery_id IS NOT NULL THEN jsonb_build_object('receiverId',r.receiver_id,
            'frequencyHz',r.frequency_hz,'signalStrengthDbm',r.signal_strength_dbm) END AS reception
        FROM source_ingestion.deliveries d
        LEFT JOIN source_ingestion.provider_message_observations m USING (delivery_id)
        LEFT JOIN source_ingestion.receptions r USING (delivery_id)
        WHERE source_id=$1 AND provider_id=$2 AND account_scope=$3 AND source_epoch=$4 AND external_id=$5`,
      [sourceId, identity.provider, identity.accountScope, identity.sourceEpoch, identity.externalId]);
      return result.rows[0] ?? null;
    },
  };
}
