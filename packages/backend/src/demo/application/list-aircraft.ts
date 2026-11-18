import type { FreshnessPolicy } from '../../modules/message-availability/public/index.ts';
import type { FixtureAircraft } from '../domain/fixture-aircraft.ts';
import type { DemoStateStore } from '../ports/demo-state-store.ts';
import type { AircraftView, ApiResult } from '../public/types.ts';
import { assembleAircraftView } from './assemble-aircraft-view.ts';
import { readClock } from './read-clock.ts';
export function createListAircraft(fleet: readonly FixtureAircraft[], store: DemoStateStore,
  policy: FreshnessPolicy, now: () => number) {
  return (): ApiResult<readonly AircraftView[]> => {
    const time = readClock(now); if (!time.ok) return time;
    const state = store.read();
    return { ok: true, value: fleet.map(aircraft => assembleAircraftView(aircraft, state.availability, time.value, policy)) };
  };
}
