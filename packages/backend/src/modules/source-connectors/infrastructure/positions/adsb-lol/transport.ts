import { err, ok, type Result } from '../../../../../kernel/result.ts';
import type { PositionParseError, PositionSourceId } from '../../../../flight-tracking/public/index.ts';
import {
  processPositionRequestBudget, type PositionRequestBudget,
} from './request-budget.ts';
import type { AdsbLolPositionQuery } from './query.ts';
import { adsbLolPointUrl, adsbLolPositionQuery } from './query.ts';
import { parseAdsbLolPositionSnapshot, type AdsbLolPositionBatch, type AdsbLolSnapshotError } from './parse-snapshot.ts';

export const ADSB_LOL_REQUEST_TIMEOUT_MS = 8_000;
export const ADSB_LOL_MAX_RESPONSE_BYTES = 1_000_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export type AdsbLolTransportError =
  | { readonly code: 'MINIMUM_INTERVAL'; readonly retryAfterMs: number }
  | { readonly code: 'REQUEST_BUDGET_EXHAUSTED'; readonly retryAfterMs: number }
  | { readonly code: 'RATE_LIMITED'; readonly retryAfterMs: number }
  | { readonly code: 'TEMPORARY_FAILURE'; readonly retryAfterMs: number; readonly status?: number }
  | { readonly code: 'TIMEOUT'; readonly retryAfterMs: number }
  | { readonly code: 'HTTP_FAILURE'; readonly status: number }
  | { readonly code: 'AUTHENTICATION_FAILURE'; readonly status: 401 | 403 }
  | { readonly code: 'INVALID_RESPONSE'; readonly field: string }
  | { readonly code: 'SOURCE_REPORTED_FAILURE'; readonly message: string }
  | { readonly code: 'INVALID_AIRCRAFT'; readonly index: number; readonly error: PositionParseError }
  | { readonly code: 'DUPLICATE_OBSERVATION_ID'; readonly index: number }
  | { readonly code: 'ABORTED' };

export interface AdsbLolPositionTransport {
  fetchNext(signal?: AbortSignal): Promise<Result<AdsbLolPositionBatch, AdsbLolTransportError>>;
}

export interface AdsbLolTransportOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly maximumResponseBytes?: number;
}

/** Offline contract tests may replace the process budget; never pass this from a live composition root. */
export interface AdsbLolTransportTestOptions extends AdsbLolTransportOptions {
  readonly requestBudget: PositionRequestBudget;
}

function retryAfterMs(header: string | null, nowMs: number): number {
  if (header === null) return 60_000;
  if (/^\d+$/u.test(header.trim())) {
    const seconds = Number(header.trim());
    if (Number.isSafeInteger(seconds)) return Math.min(Number.MAX_SAFE_INTEGER, seconds * 1000);
    return Number.MAX_SAFE_INTEGER;
  }
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, date - nowMs)) : 60_000;
}

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Result<unknown, string>> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) {
      cancelResponseBody(response);
      return err('invalid content-length');
    }
    if (length > maximumBytes) {
      cancelResponseBody(response);
      return err('response body exceeds the configured byte limit');
    }
  }
  if (!response.body) return err('response body is empty');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await new Promise<
        | { readonly kind: 'read'; readonly done: boolean; readonly value?: Uint8Array }
        | { readonly kind: 'aborted' }
        | { readonly kind: 'failed' }
      >(resolve => {
        if (signal.aborted) {
          resolve({ kind: 'aborted' });
          return;
        }
        const onAbort = () => {
          signal.removeEventListener('abort', onAbort);
          resolve({ kind: 'aborted' });
        };
        signal.addEventListener('abort', onAbort, { once: true });
        reader.read().then(
          ({ done, value }) => {
            signal.removeEventListener('abort', onAbort);
            resolve({ kind: 'read', done, ...(value ? { value } : {}) });
          },
          () => {
            signal.removeEventListener('abort', onAbort);
            resolve({ kind: 'failed' });
          },
        );
      });
      if (next.kind === 'aborted') return err('response body read was aborted');
      if (next.kind === 'failed') return err('response body could not be read');
      const { done, value } = next;
      if (done) break;
      if (!value) return err('response body chunk is empty');
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return err('response body exceeds the configured byte limit');
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return err('response body could not be read');
  } finally {
    if (signal.aborted) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return ok(JSON.parse(text) as unknown);
  } catch {
    return err('response body is not valid UTF-8 JSON');
  }
}

function toUtcIso(nowMs: number): string | null {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return null;
  try {
    const iso = new Date(nowMs).toISOString();
    return Date.parse(iso) === nowMs ? iso : null;
  } catch {
    return null;
  }
}

function snapshotError(error: AdsbLolSnapshotError): AdsbLolTransportError {
  if (error.code === 'INVALID_AIRCRAFT') return {
    code: 'INVALID_AIRCRAFT', index: error.index, error: error.error,
  };
  return error;
}

function cancelResponseBody(response: Response): void {
  if (response.body) void response.body.cancel().catch(() => undefined);
}

/** A one-shot, bounded HTTPS snapshot transport. Creating it does not make a network request. */
export function createAdsbLolPositionTransport(
  query: AdsbLolPositionQuery,
  sourceId: PositionSourceId,
  options: AdsbLolTransportOptions = {},
): AdsbLolPositionTransport {
  if ('requestBudget' in options || 'requestBudgetOptions' in options)
    throw new TypeError('Live transport budget cannot be overridden.');
  return createTransport(query, sourceId, options, processPositionRequestBudget);
}

export function createAdsbLolPositionTransportForTest(
  query: AdsbLolPositionQuery,
  sourceId: PositionSourceId,
  options: AdsbLolTransportTestOptions,
): AdsbLolPositionTransport {
  if (!options.fetch) throw new Error('Test transport requires an injected fixture fetch.');
  return createTransport(query, sourceId, options, options.requestBudget);
}

function createTransport(
  inputQuery: AdsbLolPositionQuery,
  sourceId: PositionSourceId,
  options: AdsbLolTransportOptions,
  budget: PositionRequestBudget,
): AdsbLolPositionTransport {
  const validated = adsbLolPositionQuery(inputQuery);
  if (!validated.ok) throw new RangeError(`Invalid position query: ${validated.error.field}.`);
  const query = validated.value;
  const fetcher = options.fetch ?? globalThis.fetch;
  const clock = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? ADSB_LOL_REQUEST_TIMEOUT_MS;
  const maximumBytes = options.maximumResponseBytes ?? ADSB_LOL_MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMER_DELAY_MS)
    throw new RangeError('Request timeout must be a positive integer supported by the runtime timer.');
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1)
    throw new RangeError('Maximum response size must be a positive safe integer.');

  return Object.freeze({
    async fetchNext(signal?: AbortSignal): Promise<Result<AdsbLolPositionBatch, AdsbLolTransportError>> {
      if (signal?.aborted) return err({ code: 'ABORTED' });
      const startedAt = clock();
      const permitted = budget.tryAcquire(startedAt);
      if (!permitted.ok) return err(permitted.error);
      const controller = new AbortController();
      const onAbort = () => controller.abort(signal?.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error('request timeout'));
      }, timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetcher(adsbLolPointUrl(query), {
            method: 'GET',
            headers: { accept: 'application/json' },
            signal: controller.signal,
            redirect: 'error',
          });
        } catch {
          if (signal?.aborted) return err({ code: 'ABORTED' });
          return timedOut
            ? err({ code: 'TIMEOUT', retryAfterMs: 60_000 })
            : err({ code: 'TEMPORARY_FAILURE', retryAfterMs: 60_000 });
        }
        if (signal?.aborted) {
          cancelResponseBody(response);
          return err({ code: 'ABORTED' });
        }
        const nowMs = clock();
        if (response.status === 429) {
          cancelResponseBody(response);
          return err({ code: 'RATE_LIMITED', retryAfterMs: retryAfterMs(response.headers.get('retry-after'), nowMs) });
        }
        if (response.status === 408 || response.status >= 500) {
          cancelResponseBody(response);
          return err({ code: 'TEMPORARY_FAILURE', status: response.status,
            retryAfterMs: retryAfterMs(response.headers.get('retry-after'), nowMs) });
        }
        if (response.status === 401 || response.status === 403) {
          cancelResponseBody(response);
          return err({ code: 'AUTHENTICATION_FAILURE', status: response.status });
        }
        if (!response.ok) {
          cancelResponseBody(response);
          return err({ code: 'HTTP_FAILURE', status: response.status });
        }
        const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
        if (!contentType.includes('application/json')) {
          cancelResponseBody(response);
          return err({ code: 'INVALID_RESPONSE', field: 'content-type' });
        }
        const body = await readBoundedJson(response, maximumBytes, controller.signal);
        if (signal?.aborted) return err({ code: 'ABORTED' });
        if (timedOut) return err({ code: 'TIMEOUT', retryAfterMs: 60_000 });
        if (!body.ok) return err({ code: 'INVALID_RESPONSE', field: 'body' });
        const fetchedAt = toUtcIso(clock());
        if (!fetchedAt) return err({ code: 'INVALID_RESPONSE', field: 'local-clock' });
        const parsed = parseAdsbLolPositionSnapshot(body.value, { sourceId, fetchedAt, query });
        return parsed.ok ? ok(parsed.value) : err(snapshotError(parsed.error));
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  });
}
