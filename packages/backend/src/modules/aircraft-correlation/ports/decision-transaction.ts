import type { MessageId } from '../../../contracts/identity/index.ts';
import type { DecisionEvent } from '../application/decision-event.ts';
import type { StoredDecision } from '../application/stored-decision.ts';
/** Only the capabilities needed to persist the decision and outbox atomically. */
export interface DecisionWriteSet {
  read(messageId: MessageId): Promise<StoredDecision | null>;
  put(decision: StoredDecision): Promise<void>;
  appendOutbox(event: DecisionEvent): Promise<void>;
}
/**
 * Adapter guarantees:
 * 1. put + appendOutbox commit atomically or both roll back.
 * 2. The read -> expectedRevision comparison -> put sequence is serialized per MessageId
 *    (or the adapter provides equivalent CAS), including when the record does not yet exist.
 *    Two callbacks cannot both commit from the same expectedRevision.
 * 3. A conflict on the initial INSERT must not produce two decisions/outbox entries.
 * 4. The writes capability expires with the callback; no calls after commit/rollback.
 *
 * BEGIN/COMMIT alone under PostgreSQL READ COMMITTED does not guarantee item 2.
 * The SQL adapter requires actual locking/CAS/serialization and integration tests.
 */
export interface DecisionTransaction {
  run<T>(work: (writes: DecisionWriteSet) => Promise<T>): Promise<T>;
}
