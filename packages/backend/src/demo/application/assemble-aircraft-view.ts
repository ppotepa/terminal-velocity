import type { EpochMillis } from '../../kernel/time/epoch-millis.ts';
import { classifyAge, type AvailabilityState, type FreshnessPolicy } from '../../modules/message-availability/public/index.ts';
import type { FixtureAircraft } from '../domain/fixture-aircraft.ts';
import type { AircraftView } from '../public/types.ts';
/** Demo expiry is calculated on every read; no production scheduler is implied. */
export function assembleAircraftView(aircraft: FixtureAircraft, availability: AvailabilityState,
  now: EpochMillis, policy: FreshnessPolicy): AircraftView {
  const last = availability.snapshots.get(aircraft.aircraftId)?.lastEligibleMessageAt ?? null;
  return { aircraftId: aircraft.aircraftId, icao24: aircraft.icao24, registration: aircraft.registration,
    callsign: aircraft.callsign, position: { ...aircraft.position },
    availability: { freshness: classifyAge(last, now, policy), lastMessageAt: last === null ? null : new Date(last).toISOString(),
      coverage: 'UNKNOWN', feedHealth: 'DISCONNECTED' }, mode: 'demo' };
}
