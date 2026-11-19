import type { AircraftId, MessageId } from '../../contracts/identity/index.ts';
import type { StoredMessage } from '../application/stored-message.ts';
export interface MessageReader {
  readMessage(id: MessageId): Promise<StoredMessage | null>;
  readAircraftMessages(id: AircraftId): Promise<readonly StoredMessage[]>;
}
