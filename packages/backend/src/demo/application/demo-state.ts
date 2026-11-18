import type { MessageId } from '../../contracts/identity/index.ts';
import type { AvailabilityState } from '../../modules/message-availability/public/index.ts';
import type { StoredMessage } from './stored-message.ts';
export interface DemoState {
  readonly messages: ReadonlyMap<MessageId, StoredMessage>;
  readonly availability: AvailabilityState;
}
