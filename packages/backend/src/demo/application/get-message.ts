import { messageId } from '../../contracts/identity/index.ts';
import type { DemoStateStore } from '../ports/demo-state-store.ts';
import type { ApiResult, MessageView } from '../public/types.ts';
import { assembleMessageView } from './assemble-message-view.ts';
import { apiError } from './api-error.ts';
export function createGetMessage(store: DemoStateStore) {
  return (id: string): ApiResult<MessageView> => {
    const parsed = messageId(id);
    const stored = parsed.ok ? store.read().messages.get(parsed.value) : undefined;
    return stored ? { ok: true, value: assembleMessageView(stored) }
      : apiError('NOT_FOUND', 'The synthetic message was not found.');
  };
}
