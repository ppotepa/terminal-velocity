import { decodeStoredDecision } from '../../application/decode-stored-decision.ts';
import type { StoredDecision } from '../../application/stored-decision.ts';
import { postgresInteger } from './postgres-integer.ts';

export type DecisionRow = {
  message_id: unknown;
  revision: unknown;
  decided_at_ms: unknown;
  directory_revision: unknown;
  decision: unknown;
};

export const decisionColumns = `r.message_id, r.revision::text AS revision,
  r.decided_at_ms::text AS decided_at_ms, r.directory_revision, r.decision`;

export function decodeDecisionRow(row: DecisionRow): StoredDecision {
  const decision = decodeStoredDecision({
    revision: postgresInteger(row.revision),
    decidedAt: postgresInteger(row.decided_at_ms),
    directoryRevision: row.directory_revision,
    decision: row.decision,
  });
  if (decision.decision.messageId !== row.message_id)
    throw new Error('Stored decision message ID does not match its database key.');
  return decision;
}
