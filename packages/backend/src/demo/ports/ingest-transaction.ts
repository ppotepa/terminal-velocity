import type { MessageId } from '../../contracts/identity/index.ts';
import type { EpochMillis } from '../../kernel/time/epoch-millis.ts';
import type { DecisionTransaction } from '../../modules/aircraft-correlation/public/index.ts';
import type { CanonicalMessage } from '../domain/canonical-message.ts';
import type { StoredMessage } from '../application/stored-message.ts';
export interface IngestWriteSet {
  readMessage(): Promise<StoredMessage | null>;
  insertMessage(message: CanonicalMessage, receivedAt: EpochMillis): Promise<void>;
  readonly decisions: DecisionTransaction;
}
/** Serialize one identity, then commit its immutable facts, decision and outbox together. */
export interface IngestTransaction {
  run<T>(messageId: MessageId, work: (writes: IngestWriteSet) => Promise<T>): Promise<T>;
}
