import type { Brand } from '../../kernel/brand.ts';
import { err, ok, type Result } from '../../kernel/result.ts';
import type { InvalidId } from './invalid-id.ts';
export type EventId = Brand<string, 'EventId'>;
export function eventId(input: string): Result<EventId, InvalidId> {
  return /^evt_[a-zA-Z0-9-]{1,100}$/.test(input)
    ? ok(input as EventId) : err({ code: 'INVALID_ID', kind: 'EventId' });
}
