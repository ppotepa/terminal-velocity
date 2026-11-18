import type { AircraftId, Revision } from '../../../contracts/identity/index.ts';
import type { EpochMillis } from '../../../kernel/time/epoch-millis.ts';
import type { Freshness } from './freshness.ts';
export interface AvailabilitySnapshot {
  readonly aircraftId: AircraftId;
  readonly revision: Revision;
  readonly freshness: Freshness;
  readonly lastEligibleMessageAt: EpochMillis | null;
  readonly calculatedAt: EpochMillis;
  readonly nextTransitionAt: EpochMillis | null;
}
