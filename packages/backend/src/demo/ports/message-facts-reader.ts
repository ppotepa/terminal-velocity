import type { MessageId } from '../../contracts/identity/index.ts';
import type { CanonicalMessage } from '../domain/canonical-message.ts';
export interface MessageFactsReader {
  readFacts(id: MessageId): Promise<CanonicalMessage | null>;
}
