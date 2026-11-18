import { epochMillis, type EpochMillis } from '../../kernel/time/epoch-millis.ts';
import type { ApiResult } from '../public/types.ts';
import { apiError } from './api-error.ts';
export function parseUtcTime(input: string): ApiResult<{ readonly value: EpochMillis; readonly iso: string }> {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(input);
  if (!match) return apiError('VALIDATION_ERROR', 'observedAt must be an ISO UTC timestamp ending in Z.');
  const normalized = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
  const milliseconds = Date.parse(normalized);
  const timestamp = epochMillis(milliseconds);
  if (!timestamp.ok || new Date(milliseconds).toISOString() !== normalized)
    return apiError('VALIDATION_ERROR', 'observedAt must represent a valid date on or after 1970-01-01.');
  return { ok: true, value: { value: timestamp.value, iso: normalized } };
}
