import type { Brand } from '../../../kernel/brand.ts';
import { err, ok, type Result } from '../../../kernel/result.ts';
import { isOpaqueText } from './input-validation.ts';

export type ReceiverId = Brand<string, 'ReceiverId'>;
export type InvalidReceiverId = { readonly code: 'INVALID_RECEIVER_ID' };

/** Parses an identifier assigned to a real receiver by its operator or provider. */
export function receiverId(input: string): Result<ReceiverId, InvalidReceiverId> {
  return isOpaqueText(input, 128)
    ? ok(input as ReceiverId)
    : err({ code: 'INVALID_RECEIVER_ID' });
}
