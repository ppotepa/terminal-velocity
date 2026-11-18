import type { Brand } from '../../../kernel/brand.ts';
import { err, ok, type Result } from '../../../kernel/result.ts';
export type Registration = Brand<string, 'Registration'>;
export function registration(input: string): Result<Registration, { readonly code: 'INVALID_REGISTRATION' }> {
  const normalized = input.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{2,11}$/.test(normalized)
    ? ok(normalized as Registration) : err({ code: 'INVALID_REGISTRATION' });
}
