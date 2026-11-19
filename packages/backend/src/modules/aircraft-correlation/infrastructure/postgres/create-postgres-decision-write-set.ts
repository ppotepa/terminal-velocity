import type { SqlExecutor } from '../../../../contracts/database/index.ts';
import { eventId, messageId, nextRevision, type MessageId, type Revision } from '../../../../contracts/identity/index.ts';
import { decodeStoredDecision } from '../../application/decode-stored-decision.ts';
import type { DecisionWriteSet } from '../../ports/decision-transaction.ts';
import { appendDecisionEvent } from './append-decision-event.ts';
import { createPostgresDecisionReader } from './create-postgres-decision-reader.ts';
import { lockMessage } from './lock-message.ts';
import { writeDecisionRevision } from './write-decision-revision.ts';

/** Bind to one existing transaction. The SQL capability owns its lifetime. */
export function createPostgresDecisionWriteSet(sql: SqlExecutor): DecisionWriteSet {
  const reader = createPostgresDecisionReader(sql);
  const revisions = new Map<MessageId, Revision | null>();
  const pending = new Map<string, string>();
  return {
    async read(id) {
      if (!messageId(id).ok) throw new Error('Invalid message ID for a decision read.');
      if (!revisions.has(id)) await lockMessage(sql, id);
      const current = await reader.readCurrent(id);
      revisions.set(id, current?.revision ?? null);
      return current;
    },
    async put(input) {
      const stored = decodeStoredDecision(input);
      const id = stored.decision.messageId;
      const previous = revisions.get(id);
      if (previous === undefined) throw new Error('Read and lock the message before writing its decision.');
      if (stored.revision !== nextRevision(previous)) throw new Error('Decision revisions must be consecutive.');
      await writeDecisionRevision(sql, stored, previous);
      revisions.set(id, stored.revision);
      pending.set(`${id}:${stored.revision}`, JSON.stringify(stored));
    },
    async appendOutbox(input) {
      const id = eventId(input.eventId);
      if (!id.ok || input.type !== 'correlation.aircraft-decision-revised.v1')
        throw new Error('Invalid decision event envelope.');
      const payload = decodeStoredDecision(input.payload);
      const key = `${payload.decision.messageId}:${payload.revision}`;
      if (pending.get(key) !== JSON.stringify(payload))
        throw new Error('The outbox payload must match a decision written in this transaction.');
      await appendDecisionEvent(sql, { eventId: id.value, type: input.type, payload });
      pending.delete(key);
    },
  };
}
