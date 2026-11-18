import type { FreshnessPolicy } from '../../modules/message-availability/public/index.ts';
import type { FixtureAircraft } from '../domain/fixture-aircraft.ts';
import type { DemoStateStore } from '../ports/demo-state-store.ts';
import type { AircraftView, ApiResult } from '../public/types.ts';
import { assembleAircraftView } from './assemble-aircraft-view.ts';
import { apiError } from './api-error.ts';
import { readClock } from './read-clock.ts';
export function createGetAircraft(fleet: readonly FixtureAircraft[], store: DemoStateStore,
  policy: FreshnessPolicy, now: () => number) {
  return (id: string): ApiResult<AircraftView> => {
    const aircraft = fleet.find(item => item.aircraftId === id);
    if (!aircraft) return apiError('NOT_FOUND', 'The synthetic aircraft was not found.');
    const time = readClock(now); if (!time.ok) return time;
    return { ok: true, value: assembleAircraftView(aircraft, store.read().availability, time.value, policy) };
  };
}
