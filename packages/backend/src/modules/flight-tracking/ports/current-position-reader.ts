import type { AircraftId } from '../../../contracts/identity/aircraft-id.ts';
import type { PositionFreshness, PositionFreshnessPolicy } from '../domain/position-freshness.ts';
import type { PositionObservation } from '../domain/position-observation.ts';

export interface CurrentPositionView {
  readonly aircraftId: AircraftId;
  readonly revision: number;
  readonly freshness: PositionFreshness;
  readonly observation: PositionObservation | null;
  readonly calculatedAt: string | null;
}

export interface CurrentPositionReader {
  read(aircraftId: AircraftId, now: string, policy: PositionFreshnessPolicy): Promise<CurrentPositionView>;
}
