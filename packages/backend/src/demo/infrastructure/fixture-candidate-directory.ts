import { epochMillis } from '../../kernel/time/epoch-millis.ts';
import { icao24, registration, type AircraftCandidate, type CandidateDirectory } from '../../modules/aircraft-correlation/public/index.ts';
import type { FixtureAircraft } from '../domain/fixture-aircraft.ts';
export function createFixtureCandidateDirectory(fleet: readonly FixtureAircraft[]): CandidateDirectory {
  const start = epochMillis(0);
  if (!start.ok) throw new Error('Invalid fixture epoch');
  const candidates: readonly AircraftCandidate[] = fleet.map(aircraft => {
    const icao = icao24(aircraft.icao24), tail = registration(aircraft.registration);
    if (!icao.ok || !tail.ok) throw new Error('Invalid synthetic identifier fixture');
    return { aircraftId: aircraft.aircraftId, aliases: [
      { identifier: { kind: 'ICAO24', value: icao.value }, validFrom: start.value, validUntil: null },
      { identifier: { kind: 'REGISTRATION', value: tail.value }, validFrom: start.value, validUntil: null },
    ] };
  });
  return { async find() { return { revision: 'synthetic-fleet/1', completeness: 'COMPLETE', candidates: structuredClone(candidates) }; } };
}
