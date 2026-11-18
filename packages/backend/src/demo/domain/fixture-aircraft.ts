import type { AircraftId } from '../../contracts/identity/index.ts';
export interface FixtureAircraft {
  readonly aircraftId: AircraftId;
  readonly icao24: string;
  readonly registration: string;
  readonly callsign: string;
  readonly position: {
    readonly latitude: number;
    readonly longitude: number;
    readonly altitudeFt: number;
    readonly headingDeg: number;
    readonly observedAt: string;
  };
}
