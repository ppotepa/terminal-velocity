import type { MessageId } from '../../../contracts/identity/index.ts';
import type { EpochMillis } from '../../../kernel/time/epoch-millis.ts';
import type { StrongIdentifier } from './strong-identifier.ts';
export interface CorrelationInput {
  readonly messageId: MessageId;
  /** The timestamp belongs to the message/observation, not to the time when backfill is processed. */
  readonly effectiveAt: EpochMillis;
  readonly identifiers: readonly StrongIdentifier[];
  readonly callsign: string | null;
}
