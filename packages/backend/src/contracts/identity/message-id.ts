import type { Brand } from '../../kernel/brand.ts';
import { err, ok, type Result } from '../../kernel/result.ts';
import type { InvalidId } from './invalid-id.ts';
export type MessageId = Brand<string, 'MessageId'>;
export function messageId(input: string): Result<MessageId, InvalidId> {
  return /^msg_[a-zA-Z0-9-]{1,64}$/.test(input)
    ? ok(input as MessageId) : err({ code: 'INVALID_ID', kind: 'MessageId' });
}
