import type { AdsbLolPositionBatch } from './parse-snapshot.ts';
import {
  ADSB_LOL_MINIMUM_INTERVAL_MS,
} from './request-budget.ts';
import type { AdsbLolPositionTransport, AdsbLolTransportError } from './transport.ts';

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const DEFAULT_MAXIMUM_BACKOFF_MS = 60 * 60 * 1000;

export interface AdsbLolPollerOptions {
  /** Must be at least the conservative provider request interval. */
  readonly minimumPollIntervalMs?: number;
  /** Caps exponential retries; a larger provider Retry-After is still honored. */
  readonly maximumBackoffMs?: number;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export type AdsbLolPollerEvent =
  | { readonly type: 'snapshot'; readonly batch: AdsbLolPositionBatch }
  | { readonly type: 'error'; readonly error: AdsbLolTransportError };

export interface AdsbLolSourceHealth {
  readonly status: 'NOT_STARTED' | 'CONNECTING' | 'CONNECTED' | 'DEGRADED' | 'STOPPED';
  /** Last successful fetch time only; it is not an observation freshness guarantee. */
  readonly lastSuccessAt: string | null;
  readonly consecutiveFailures: number;
  readonly lastErrorCode: AdsbLolTransportError['code'] | null;
}

export interface AdsbLolPositionPoller {
  /** Starts immediate polling. The returned promise settles after stop or a permanent error. */
  start(onEvent: (event: AdsbLolPollerEvent) => void | Promise<void>): Promise<void>;
  /** Aborts an in-flight fetch or delay and waits for the loop to finish. */
  stop(): Promise<void>;
  /** Reports transport health independently from observation timestamps and freshness. */
  health(): AdsbLolSourceHealth;
}

function defaultWait(milliseconds: number, signal: AbortSignal): Promise<void> {
  let remaining = milliseconds;
  return new Promise(resolve => {
    const runChunk = () => {
      if (signal.aborted || remaining <= 0) {
        signal.removeEventListener('abort', onAbort);
        resolve();
        return;
      }
      const delay = Math.min(remaining, MAX_TIMER_DELAY_MS);
      remaining -= delay;
      timer = setTimeout(runChunk, delay);
    };
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    let timer: ReturnType<typeof setTimeout>;
    signal.addEventListener('abort', onAbort, { once: true });
    runChunk();
  });
}

function retryAfter(error: AdsbLolTransportError): number {
  switch (error.code) {
    case 'MINIMUM_INTERVAL':
    case 'REQUEST_BUDGET_EXHAUSTED':
    case 'RATE_LIMITED':
    case 'TEMPORARY_FAILURE':
    case 'TIMEOUT':
      return error.retryAfterMs;
    default:
      return 0;
  }
}

function canRetry(error: AdsbLolTransportError): boolean {
  switch (error.code) {
    case 'MINIMUM_INTERVAL':
    case 'REQUEST_BUDGET_EXHAUSTED':
    case 'RATE_LIMITED':
    case 'TEMPORARY_FAILURE':
    case 'TIMEOUT':
      return true;
    default:
      return false;
  }
}

/** Caller-owned, non-starting poll loop with bounded exponential retry and graceful cancellation. */
export function createAdsbLolPositionPoller(
  transport: AdsbLolPositionTransport,
  options: AdsbLolPollerOptions = {},
): AdsbLolPositionPoller {
  const minimumPollIntervalMs = options.minimumPollIntervalMs ?? ADSB_LOL_MINIMUM_INTERVAL_MS;
  const maximumBackoffMs = options.maximumBackoffMs ?? DEFAULT_MAXIMUM_BACKOFF_MS;
  const wait = options.wait ?? defaultWait;
  if (!Number.isSafeInteger(minimumPollIntervalMs) || minimumPollIntervalMs < ADSB_LOL_MINIMUM_INTERVAL_MS)
    throw new RangeError('Poll interval must be at least the provider minimum interval.');
  if (!Number.isSafeInteger(maximumBackoffMs) || maximumBackoffMs < minimumPollIntervalMs)
    throw new RangeError('Maximum retry backoff must be a safe integer at least as large as the poll interval.');

  const controller = new AbortController();
  let started = false;
  let stopped = false;
  let running: Promise<void> | undefined;
  let status: AdsbLolSourceHealth['status'] = 'NOT_STARTED';
  let lastSuccessAt: string | null = null;
  let consecutiveFailures = 0;
  let lastErrorCode: AdsbLolSourceHealth['lastErrorCode'] = null;

  return Object.freeze({
    start(onEvent: (event: AdsbLolPollerEvent) => void | Promise<void>): Promise<void> {
      if (started || stopped) throw new Error('Position poller can be started only once.');
      started = true;
      status = 'CONNECTING';
      running = (async () => {
        while (!controller.signal.aborted) {
          const result = await transport.fetchNext(controller.signal);
          if (controller.signal.aborted || (!result.ok && result.error.code === 'ABORTED')) break;
          if (result.ok) {
            consecutiveFailures = 0;
            lastSuccessAt = result.value.fetchedAt;
            lastErrorCode = null;
            status = 'CONNECTED';
            await onEvent({ type: 'snapshot', batch: result.value });
            if (controller.signal.aborted) break;
            await wait(minimumPollIntervalMs, controller.signal);
            continue;
          }

          consecutiveFailures += 1;
          lastErrorCode = result.error.code;
          status = 'DEGRADED';
          await onEvent({ type: 'error', error: result.error });
          if (controller.signal.aborted || !canRetry(result.error)) break;
          const exponent = Math.min(consecutiveFailures - 1, 52);
          const backoff = Math.min(maximumBackoffMs, minimumPollIntervalMs * 2 ** exponent);
          await wait(Math.max(minimumPollIntervalMs, backoff, retryAfter(result.error)), controller.signal);
        }
      })().finally(() => {
        stopped = true;
        status = 'STOPPED';
      });
      return running;
    },
    async stop(): Promise<void> {
      stopped = true;
      status = 'STOPPED';
      controller.abort();
      await running;
    },
    health(): AdsbLolSourceHealth {
      return Object.freeze({ status, lastSuccessAt, consecutiveFailures, lastErrorCode });
    },
  });
}
