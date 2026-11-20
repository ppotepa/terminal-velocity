import type { Brand } from '../../kernel/brand.ts';
import { err, ok, type Result } from '../../kernel/result.ts';
export type Icao24 = Brand<string, 'Icao24'>;
export type Registration = Brand<string, 'Registration'>;
export type StrongIdentifier =
  | { readonly kind: 'ICAO24'; readonly value: Icao24 }
  | { readonly kind: 'REGISTRATION'; readonly value: Registration };
export function icao24(input: string): Result<Icao24, { readonly code: 'INVALID_ICAO24' }> {
  const normalized = input.trim().toUpperCase();
  return /^[0-9A-F]{6}$/.test(normalized)
    ? ok(normalized as Icao24) : err({ code: 'INVALID_ICAO24' });
}
export function registration(input: string): Result<Registration, { readonly code: 'INVALID_REGISTRATION' }> {
  const normalized = input.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{2,11}$/.test(normalized)
    ? ok(normalized as Registration) : err({ code: 'INVALID_REGISTRATION' });
}
