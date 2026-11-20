export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
  }
}

export interface ApiClient {
  request<T>(route: string, query: Readonly<Record<string, string>>,
    signal: AbortSignal): Promise<T>;
}

export function createApiClient(fetcher: typeof fetch = fetch,
  baseUrl: string = window.location.origin): ApiClient {
  return { async request<T>(route: string,
    query: Readonly<Record<string, string>>, signal: AbortSignal): Promise<T> {
    if (route !== '/api/v1/internal/map/aircraft'
      && !/^\/api\/v1\/internal\/aircraft\/ac_[A-Za-z0-9-]{1,64}\/observed-track$/.test(route))
      throw new TypeError('Unsupported private API route.');
    const url = new URL(route, baseUrl);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await fetcher(url, { signal, headers: { Accept: 'application/json' } });
    let body: unknown;
    try { body = await response.json(); }
    catch { throw new ApiClientError('INVALID_RESPONSE', 'The server returned an unreadable response.', response.status); }
    if (!body || typeof body !== 'object')
      throw new ApiClientError('INVALID_RESPONSE', 'The server returned an invalid response.', response.status);
    if (!response.ok) {
      const error = 'error' in body && body.error && typeof body.error === 'object' ? body.error : null;
      const code = error && 'code' in error && typeof error.code === 'string' ? error.code : 'REQUEST_FAILED';
      const message = error && 'message' in error && typeof error.message === 'string'
        ? error.message : 'The request could not be completed.';
      throw new ApiClientError(code, message, response.status);
    }
    if (!('data' in body))
      throw new ApiClientError('INVALID_RESPONSE', 'The server response is missing data.', response.status);
    return body as T;
  } };
}
