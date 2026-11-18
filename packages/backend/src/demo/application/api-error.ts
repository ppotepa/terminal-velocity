import type { ApiErrorCode, ApiResult } from '../public/types.ts';
export function apiError(code: ApiErrorCode, message: string): ApiResult<never> {
  return { ok: false, error: { code, message } };
}
