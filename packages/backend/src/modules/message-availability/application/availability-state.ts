import type { AircraftId } from '../../../contracts/identity/index.ts';
import type { ContributionLedger } from '../domain/contribution-ledger.ts';
import type { AvailabilitySnapshot } from '../domain/availability-snapshot.ts';
export interface AvailabilityState {
  readonly ledger: ContributionLedger;
  readonly snapshots: ReadonlyMap<AircraftId, AvailabilitySnapshot>;
}
export function emptyAvailability(): AvailabilityState {
  return { ledger: new Map(), snapshots: new Map() };
}
