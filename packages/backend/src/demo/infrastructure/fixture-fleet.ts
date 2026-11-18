import { aircraftId } from '../../contracts/identity/index.ts';
import type { FixtureAircraft } from '../domain/fixture-aircraft.ts';
export function createFixtureFleet(): readonly FixtureAircraft[] {
  const raw = [
    { id: 'ac_demo-001', icao24: 'D00001', registration: 'DEMO-001', callsign: 'DEMO101', latitude: 52.2297, longitude: 21.0122, altitudeFt: 35000, headingDeg: 270 },
    { id: 'ac_demo-002', icao24: 'D00002', registration: 'DEMO-002', callsign: 'DEMO202', latitude: 50.0647, longitude: 19.945, altitudeFt: 32000, headingDeg: 45 },
    { id: 'ac_demo-003', icao24: 'D00003', registration: 'DEMO-003', callsign: 'DEMO303', latitude: 54.352, longitude: 18.6466, altitudeFt: 36000, headingDeg: 180 },
  ];
  return Object.freeze(raw.map(item => {
    const id = aircraftId(item.id);
    if (!id.ok) throw new Error('Invalid synthetic aircraft fixture');
    return Object.freeze({ aircraftId: id.value, icao24: item.icao24, registration: item.registration, callsign: item.callsign,
      position: Object.freeze({ latitude: item.latitude, longitude: item.longitude, altitudeFt: item.altitudeFt,
        headingDeg: item.headingDeg, observedAt: '2026-11-18T12:00:00.000Z' }) });
  }));
}
