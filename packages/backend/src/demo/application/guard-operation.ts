import type { ApiResult } from '../public/types.ts';
import { apiError } from './api-error.ts';
export async function guardOperation<T>(operation: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
  try { return await operation(); }
  catch { return apiError('INTERNAL_ERROR', 'The demo operation could not be completed.'); }
}
