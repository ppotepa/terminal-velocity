import { messageId } from '../../contracts/identity/index.ts';
import type { MessageReader } from '../ports/message-reader.ts';
import type { ApiResult, MessageView } from '../public/types.ts';
import { apiError } from './api-error.ts';
import { assembleMessageView } from './assemble-message-view.ts';
export function createGetDurableMessage(reader: MessageReader) {
  return async (id: string): Promise<ApiResult<MessageView>> => {
    const parsed = messageId(id);
    const stored = parsed.ok ? await reader.readMessage(parsed.value) : null;
    return stored ? { ok: true, value: assembleMessageView(stored) }
      : apiError('NOT_FOUND', 'The synthetic message was not found.');
  };
}
