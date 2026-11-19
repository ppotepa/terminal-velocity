import { createHash } from 'node:crypto';
import type { SqlExecutor } from '../../../../contracts/database/index.ts';
import { messageId, type MessageId } from '../../../../contracts/identity/index.ts';
import type { CanonicalSourceObservation } from '../../domain/normalized-observation.ts';
import { parseSourceObservation } from '../../domain/source-observation.ts';
import { fingerprint, normalizedFingerprint } from './acceptance-fingerprint.ts';

export interface AcceptedSourceEvent {
  readonly sourceDeliveryId: string;
  readonly messageId: MessageId;
  readonly canonical: CanonicalSourceObservation | null;
}
function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  })).digest('hex');
}

export async function readSourceEvent(sql: SqlExecutor, id: string): Promise<{ event: AcceptedSourceEvent; digest: string }> {
  const result = await sql.query<{ event_id: string; delivery_id: string; event_type: string; stream_revision: string;
    payload: unknown; canonical_v1_sha256: string | null; normalized_v1_sha256: string | null; source_id: string; provider_id: string;
    account_scope: string; source_epoch: string; external_id: string; provenance: { parserVersion: string };
    canonical: CanonicalSourceObservation | null }>(`SELECT o.event_id,o.delivery_id,o.event_type,o.stream_revision,
      o.payload,o.canonical_v1_sha256,o.normalized_v1_sha256,d.source_id,d.provider_id,d.account_scope,d.source_epoch,d.external_id,
      d.provenance,s.canonical FROM event_delivery.events e
      JOIN source_ingestion.outbox o ON o.event_id=e.source_event_id
      JOIN source_ingestion.deliveries d ON d.delivery_id=o.delivery_id AND d.state='ACCEPTED'
      LEFT JOIN source_ingestion.synthetic_inputs s ON s.delivery_id=d.delivery_id WHERE e.event_id=$1`, [id]);
  const row = result.rows[0];
  if (!row || id !== 'evt_source-' + row.event_id || row.event_type !== 'source.delivery-accepted.v1'
    || String(row.stream_revision) !== '1') throw new Error('Invalid source event envelope.');
  const canonical = row.canonical;
  if (canonical) {
    if (normalizedFingerprint(canonical) !== row.normalized_v1_sha256) throw new Error('Normalized evidence mismatch.');
    const obs = canonical.observation;
    const wireTime = (t: typeof obs.receivedAt) => ({ at: t.iso, basis: t.basis, precision: t.precision, uncertaintyMs: t.uncertaintyMs });
    const parsed = parseSourceObservation({ ...obs, receivedAt: wireTime(obs.receivedAt),
      ...(obs.observedAt ? { observedAt: wireTime(obs.observedAt) } : {}) });
    if (!parsed.ok || fingerprint(parsed.value, row.provenance.parserVersion) !== row.canonical_v1_sha256
      || obs.sourceId !== row.source_id || obs.sourceDeliveryId.provider !== row.provider_id
      || obs.sourceDeliveryId.accountScope !== row.account_scope || obs.sourceDeliveryId.sourceEpoch !== row.source_epoch
      || obs.sourceDeliveryId.externalId !== row.external_id || canonical.schemaVersion !== 1)
      throw new Error('Canonical source evidence mismatch.');
  }
  const parsedId = messageId('msg_' + hash(['provider-message/1', row.source_id, row.provider_id,
    row.account_scope, row.source_epoch, canonical?.provenance.originalSourceId ?? row.external_id]));
  if (!parsedId.ok) throw new Error('Invalid deterministic provider identity.');
  return { event: { messageId: parsedId.value, sourceDeliveryId: row.delivery_id, canonical },
    digest: hash({ transformation: 'provider-message/1', event: row }) };
}
