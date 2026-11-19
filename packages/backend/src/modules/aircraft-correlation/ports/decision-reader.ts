import type { MessageId } from '../../../contracts/identity/index.ts';
import type { StoredDecision } from '../application/stored-decision.ts';

/** Read committed decisions without granting mutation or transaction capabilities. */
export interface DecisionReader {
  readCurrent(messageId: MessageId): Promise<StoredDecision | null>;
  readHistory(messageId: MessageId): Promise<readonly StoredDecision[]>;
}
