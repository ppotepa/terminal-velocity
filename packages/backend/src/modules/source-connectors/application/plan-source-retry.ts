import type { ReplayFailure, ReplayPolicy } from '../ports/source-replay-checkpoint.ts';

/** Deterministic delay; scheduling may add positive jitter but cannot shorten Retry-After. */
export function planSourceRetry(failure: ReplayFailure, attempt: number, policy: ReplayPolicy):
  { kind: 'RETRY'; delayMs: number } | { kind: 'QUARANTINE' } {
  if (!['RETRY_AFTER', 'TRANSIENT_FAILURE'].includes(failure.code) || attempt >= policy.maxAttempts
    || (failure.status !== undefined && !policy.retryStatuses.includes(failure.status))) return { kind: 'QUARANTINE' };
  const after = failure.retryAfterMs ?? 0;
  if (!Number.isFinite(after) || after < 0 || after > policy.maxRetryMs) return { kind: 'QUARANTINE' };
  const delayMs = Math.max(policy.minIntervalMs, 1000 * 2 ** (attempt - 1), after);
  return delayMs <= policy.maxRetryMs ? { kind: 'RETRY', delayMs } : { kind: 'QUARANTINE' };
}
