import createClient from 'openapi-fetch';
import type { paths } from './generated';

export type ApiClient = ReturnType<typeof createClient<paths>>;
export type ApiClientOptions = { baseUrl?: string; fetch?: typeof fetch };

/** Shared typed transport. Fetch cancellation uses standard RequestInit.signal. */
export function createApiClient({ baseUrl = '/api/v1', fetch: fetcher }: ApiClientOptions = {}): ApiClient {
  return createClient<paths>({ baseUrl, fetch: fetcher });
}

export type ApiErrorBody = paths['/watch-rules']['post']['responses'][400]['content']['application/json'];
export type ApiErrorCode = ApiErrorBody['error']['code'];
export type ApiFailure =
  | { kind: 'offline'; message: string }
  | { kind: 'http'; status: number; code: ApiErrorCode | 'unknown'; message: string; requestId?: string }
  | { kind: 'unknown'; message: string };

/** Normalize thrown fetch errors and contract-shaped HTTP errors without retrying requests. */
export function normalizeApiFailure(error: unknown, status?: number): ApiFailure {
  if (error instanceof TypeError) return { kind: 'offline', message: 'The API could not be reached. Check that the local service is running.' };
  if (isApiError(error)) {
    return { kind: 'http', status: status ?? 0, code: error.error.code, message: error.error.message, requestId: error.error.requestId };
  }
  if (error instanceof Error) return { kind: 'unknown', message: error.message };
  return { kind: 'unknown', message: 'An unexpected error occurred.' };
}

export function isApiError(value: unknown): value is ApiErrorBody {
  if (!value || typeof value !== 'object' || !('error' in value)) return false;
  const detail = (value as { error?: unknown }).error;
  return !!detail && typeof detail === 'object' && 'code' in detail && 'message' in detail;
}

export type SourceAvailability = 'active' | 'paused' | 'disconnected' | 'error' | 'not_configured' | 'blocked' | 'unknown';
/** Source status comes from the backend contract and is never inferred from missing messages. */
export function sourceAvailability(status: string | undefined): SourceAvailability {
  switch (status) {
    case 'ok': return 'active';
    case 'inactive': return 'paused';
    case 'degraded': return 'disconnected';
    case 'error': return 'error';
    case 'not_configured': return 'not_configured';
    case 'blocked': return 'blocked';
    default: return 'unknown';
  }
}
