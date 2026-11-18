import type { Brand } from '../brand.ts';
import { err, ok, type Result } from '../result.ts';
export type EpochMillis = Brand<number, 'EpochMillis'>;
export type InvalidTime = { readonly code: 'INVALID_TIME'; readonly input: number };
export function epochMillis(input: number): Result<EpochMillis, InvalidTime> {
  return Number.isSafeInteger(input) && input >= 0
    ? ok(input as EpochMillis) : err({ code: 'INVALID_TIME', input });
}
