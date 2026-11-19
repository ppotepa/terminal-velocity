import type { AircraftId } from '../../../contracts/identity/index.ts';
import type { EpochMillis } from '../../../kernel/time/epoch-millis.ts';
export interface AvailabilityReader {
  lastMessageTimes(): Promise<ReadonlyMap<AircraftId, EpochMillis>>;
}
