import type { MessageId } from '../../../contracts/identity/index.ts';
import type { EpochMillis } from '../../../kernel/time/epoch-millis.ts';
import type { StrongIdentifier } from './strong-identifier.ts';
export interface CorrelationInput {
  readonly messageId: MessageId;
  /** Czas dotyczy wiadomości/obserwacji, nie chwili przetworzenia backfillu. */
  readonly effectiveAt: EpochMillis;
  readonly identifiers: readonly StrongIdentifier[];
  readonly callsign: string | null;
}
