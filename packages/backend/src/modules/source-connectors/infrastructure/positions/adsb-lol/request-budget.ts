import { err, ok, type Result } from '../../../../../kernel/result.ts';

export const ADSB_LOL_MINIMUM_INTERVAL_MS = 10 * 60 * 1000;
export const ADSB_LOL_ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;
export const ADSB_LOL_MAX_REQUESTS_PER_WINDOW = 200;

export type RequestBudgetError =
  | { readonly code: 'MINIMUM_INTERVAL'; readonly retryAfterMs: number }
  | { readonly code: 'REQUEST_BUDGET_EXHAUSTED'; readonly retryAfterMs: number };

export interface PositionRequestBudget {
  tryAcquire(nowMs: number): Result<void, RequestBudgetError>;
}

export interface RequestBudgetOptions {
  readonly minimumIntervalMs?: number;
  readonly rollingWindowMs?: number;
  readonly maxRequestsPerWindow?: number;
}

/** In-process budget with conservative defaults for the unauthenticated per-IP quota. */
export function createPositionRequestBudget(options: RequestBudgetOptions = {}): PositionRequestBudget {
  const minimumIntervalMs = options.minimumIntervalMs ?? ADSB_LOL_MINIMUM_INTERVAL_MS;
  const rollingWindowMs = options.rollingWindowMs ?? ADSB_LOL_ROLLING_WINDOW_MS;
  const maxRequestsPerWindow = options.maxRequestsPerWindow ?? ADSB_LOL_MAX_REQUESTS_PER_WINDOW;
  if (!Number.isSafeInteger(minimumIntervalMs) || minimumIntervalMs < 1
    || !Number.isSafeInteger(rollingWindowMs) || rollingWindowMs < 1
    || !Number.isSafeInteger(maxRequestsPerWindow) || maxRequestsPerWindow < 1)
    throw new RangeError('Position request budget settings must be positive safe integers.');

  const requests: number[] = [];
  let previousNow = -1;
  return Object.freeze({
    tryAcquire(nowMs: number): Result<void, RequestBudgetError> {
      if (!Number.isSafeInteger(nowMs) || nowMs < 0)
        return err({ code: 'REQUEST_BUDGET_EXHAUSTED', retryAfterMs: minimumIntervalMs });
      const effectiveNow = Math.max(nowMs, previousNow);
      previousNow = effectiveNow;
      while (requests.length > 0 && effectiveNow - requests[0]! >= rollingWindowMs) requests.shift();
      const lastRequest = requests.at(-1);
      if (lastRequest !== undefined && effectiveNow - lastRequest < minimumIntervalMs)
        return err({ code: 'MINIMUM_INTERVAL', retryAfterMs: minimumIntervalMs - (effectiveNow - lastRequest) });
      if (requests.length >= maxRequestsPerWindow)
        return err({ code: 'REQUEST_BUDGET_EXHAUSTED', retryAfterMs: rollingWindowMs - (effectiveNow - requests[0]!) });
      requests.push(effectiveNow);
      return ok(undefined);
    },
  });
}

/** Shared fallback used by every transport in this process; callers can inject an isolated budget in tests. */
export const processPositionRequestBudget = createPositionRequestBudget();
