import { emptyAvailability } from '../../modules/message-availability/public/index.ts';
import type { DemoState } from '../application/demo-state.ts';
import type { DemoStateStore } from '../ports/demo-state-store.ts';
export function createMemoryDemoState(): DemoStateStore {
  let current: DemoState = { messages: new Map(), availability: emptyAvailability() };
  return { read: () => current, commit: next => { current = next; } };
}
