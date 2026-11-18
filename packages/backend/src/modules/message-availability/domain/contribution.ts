import type { AircraftId, MessageId, Revision } from '../../../contracts/identity/index.ts';
import type { EpochMillis } from '../../../kernel/time/epoch-millis.ts';
import type { Bearer } from './bearer.ts';
export interface MessageContribution {
  readonly messageId: MessageId;
  readonly aircraftId: AircraftId;
  readonly observedAt: EpochMillis;
  readonly bearer: Bearer;
  readonly publicEligible: boolean;
}
/** Rewizja dotyczy message contribution, nie globalnego kolejnego numeru zdarzenia. */
export type ContributionChange =
  | { readonly type: 'ASSIGNED'; readonly revision: Revision; readonly contribution: MessageContribution }
  | { readonly type: 'RETRACTED'; readonly revision: Revision; readonly messageId: MessageId };
