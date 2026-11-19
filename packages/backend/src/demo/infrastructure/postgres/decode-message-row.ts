import { decodeStoredDecision } from '../../../modules/aircraft-correlation/public/index.ts';
import type { StoredMessage } from '../../application/stored-message.ts';
import { decodeCanonicalMessage } from './decode-canonical-message.ts';
export const messageColumns = `m.message_id, m.canonical, r.revision::text AS revision,
  r.decided_at_ms::text AS decided_at_ms, r.directory_revision, r.decision`;
export const messageJoins = `FROM message_ingestion.messages m
  JOIN correlation.aircraft_link_heads h ON h.message_id = m.message_id
  JOIN correlation.aircraft_link_revisions r ON r.message_id = h.message_id AND r.revision = h.revision`;

export function decodeMessageRow(row: Record<string, unknown>): StoredMessage {
  if (typeof row['message_id'] !== 'string' || typeof row['revision'] !== 'string' || typeof row['decided_at_ms'] !== 'string')
    throw new Error('Invalid stored message row.');
  const canonical = decodeCanonicalMessage(row['canonical'], row['message_id']);
  const stored = decodeStoredDecision({ revision: Number(row['revision']), decidedAt: Number(row['decided_at_ms']),
    directoryRevision: row['directory_revision'], decision: row['decision'] });
  if (stored.decision.messageId !== canonical.messageId) throw new Error('Message and decision identities differ.');
  return { canonical, decision: stored.decision };
}
