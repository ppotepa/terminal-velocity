import type { EpochMillis } from '../../kernel/time/epoch-millis.ts';
import type { AvailabilityState, FreshnessPolicy } from '../../modules/message-availability/public/index.ts';
import type { FixtureAircraft } from '../domain/fixture-aircraft.ts';
import type { AircraftView } from '../public/types.ts';
import { assembleAircraftSummary } from './assemble-aircraft-summary.ts';
/** Demo expiry is calculated on every read; no production scheduler is implied. */
export function assembleAircraftView(aircraft: FixtureAircraft, availability: AvailabilityState,
  now: EpochMillis, policy: FreshnessPolicy): AircraftView {
  const last = availability.snapshots.get(aircraft.aircraftId)?.lastEligibleMessageAt ?? null;
  return assembleAircraftSummary(aircraft, last, now, policy);
}
