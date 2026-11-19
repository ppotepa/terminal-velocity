import { createHash } from 'node:crypto';
import { eventId } from '../../../contracts/identity/index.ts';
import { decodeStoredDecision, type DecisionEvent } from '../../aircraft-correlation/public/index.ts';
import { canonicalJson } from './canonical-json.ts';
import { readSafeInteger } from './read-safe-integer.ts';

export interface OutboxEventRow extends Record<string, unknown> {
  readonly event_id: unknown;
  readonly event_type: unknown;
  readonly schema_version: unknown;
  readonly stream_key: unknown;
  readonly stream_revision: unknown;
  readonly occurred_at_ms: unknown;
  readonly payload: unknown;
}

export function readOutboxEvent(row: OutboxEventRow): { readonly event: DecisionEvent; readonly digest: string } {
  const parsedId = typeof row.event_id === 'string' ? eventId(row.event_id) : null;
  if (!parsedId?.ok || row.event_type !== 'correlation.aircraft-decision-revised.v1' || row.schema_version !== 1)
    throw new TypeError('The stored outbox event envelope is invalid.');
  const payload = decodeStoredDecision(row.payload);
  const streamRevision = readSafeInteger(row.stream_revision, 1, 'stream revision');
  const occurredAt = readSafeInteger(row.occurred_at_ms, 0, 'event time');
  if (row.stream_key !== payload.decision.messageId || streamRevision !== payload.revision || occurredAt !== payload.decidedAt)
    throw new TypeError('The stored event envelope does not match its decision.');
  const event: DecisionEvent = { eventId: parsedId.value, type: row.event_type, payload };
  const digest = createHash('sha256').update(canonicalJson({
    eventId: event.eventId, type: event.type, schemaVersion: 1,
    streamKey: row.stream_key, streamRevision, occurredAt, payload: row.payload,
  })).digest('hex');
  return { event, digest };
}
