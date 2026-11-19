import { randomUUID } from 'node:crypto';
import { eventId } from '../../contracts/identity/index.ts';
import type { EventIdGenerator } from '../../modules/aircraft-correlation/public/index.ts';
export function randomEventIds(): EventIdGenerator {
  return { next() {
    const id = eventId(`evt_${randomUUID()}`);
    if (!id.ok) throw new Error('Invalid generated event ID.');
    return id.value;
  } };
}
