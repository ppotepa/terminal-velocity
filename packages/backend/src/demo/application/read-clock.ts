import { epochMillis, type EpochMillis } from '../../kernel/time/epoch-millis.ts';
import type { ApiResult } from '../public/types.ts';
import { apiError } from './api-error.ts';
export function readClock(now: () => number): ApiResult<EpochMillis> {
  try {
    const value = now();
    const result = epochMillis(value);
    if (!result.ok || value > 8_640_000_000_000_000)
      return apiError('INTERNAL_ERROR', 'The demo clock returned an invalid timestamp.');
    return { ok: true, value: result.value };
  } catch { return apiError('INTERNAL_ERROR', 'The demo clock could not be read.'); }
}
