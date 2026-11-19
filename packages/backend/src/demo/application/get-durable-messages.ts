import type { FixtureAircraft } from '../domain/fixture-aircraft.ts';
import type { MessageReader } from '../ports/message-reader.ts';
import type { ApiResult, MessageView } from '../public/types.ts';
import { apiError } from './api-error.ts';
import { assembleMessageView } from './assemble-message-view.ts';
export function createGetDurableMessages(fleet: readonly FixtureAircraft[], reader: MessageReader) {
  return async (id: string): Promise<ApiResult<readonly MessageView[]>> => {
    const aircraft = fleet.find(item => item.aircraftId === id);
    if (!aircraft) return apiError('NOT_FOUND', 'The synthetic aircraft was not found.');
    return { ok: true, value: (await reader.readAircraftMessages(aircraft.aircraftId)).map(assembleMessageView) };
  };
}
