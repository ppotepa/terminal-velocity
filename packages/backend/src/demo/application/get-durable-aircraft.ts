import type { AvailabilityReader, FreshnessPolicy } from '../../modules/message-availability/public/index.ts';
import type { FixtureAircraft } from '../domain/fixture-aircraft.ts';
import type { AircraftView, ApiResult } from '../public/types.ts';
import { apiError } from './api-error.ts';
import { readClock } from './read-clock.ts';
import { assembleAircraftSummary } from './assemble-aircraft-summary.ts';
export function createGetDurableAircraft(fleet: readonly FixtureAircraft[], reader: AvailabilityReader,
  policy: FreshnessPolicy, now: () => number) {
  return async (id: string): Promise<ApiResult<AircraftView>> => {
    const aircraft = fleet.find(item => item.aircraftId === id);
    if (!aircraft) return apiError('NOT_FOUND', 'The synthetic aircraft was not found.');
    const lastTimes = await reader.lastMessageTimes();
    const time = readClock(now); if (!time.ok) return time;
    return { ok: true, value: assembleAircraftSummary(aircraft, lastTimes.get(aircraft.aircraftId) ?? null, time.value, policy) };
  };
}
