import type { AircraftId } from '../../../contracts/identity/index.ts';
import type { TemporalAlias } from './temporal-alias.ts';
export interface AircraftCandidate {
  readonly aircraftId: AircraftId;
  readonly aliases: readonly TemporalAlias[];
}
