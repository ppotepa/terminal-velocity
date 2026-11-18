import type { FixtureAircraft } from '../domain/fixture-aircraft.ts';
import type { DemoStateStore } from '../ports/demo-state-store.ts';
import type { ApiResult, MessageView } from '../public/types.ts';
import { assembleMessageView } from './assemble-message-view.ts';
import { apiError } from './api-error.ts';
export function createGetMessages(fleet: readonly FixtureAircraft[], store: DemoStateStore) {
  return (id: string): ApiResult<readonly MessageView[]> => {
    if (!fleet.some(aircraft => aircraft.aircraftId === id))
      return apiError('NOT_FOUND', 'The synthetic aircraft was not found.');
    const messages = [...store.read().messages.values()].filter(item =>
      item.decision.status === 'MATCHED' && item.decision.aircraftId === id)
      .sort((a, b) => b.canonical.observedAt - a.canonical.observedAt ||
        a.canonical.messageId.localeCompare(b.canonical.messageId));
    return { ok: true, value: messages.map(assembleMessageView) };
  };
}
