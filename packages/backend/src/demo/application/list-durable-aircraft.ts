import type { AvailabilityReader, FreshnessPolicy } from '../../modules/message-availability/public/index.ts';
import type { FixtureAircraft } from '../domain/fixture-aircraft.ts';
import type { AircraftView, ApiResult } from '../public/types.ts';
import { readClock } from './read-clock.ts';
import { assembleAircraftSummary } from './assemble-aircraft-summary.ts';
export function createListDurableAircraft(fleet: readonly FixtureAircraft[], reader: AvailabilityReader,
  policy: FreshnessPolicy, now: () => number) {
  return async (): Promise<ApiResult<readonly AircraftView[]>> => {
    const lastTimes = await reader.lastMessageTimes();
    const time = readClock(now); if (!time.ok) return time;
    return { ok: true, value: fleet.map(item => assembleAircraftSummary(item, lastTimes.get(item.aircraftId) ?? null, time.value, policy)) };
  };
}
