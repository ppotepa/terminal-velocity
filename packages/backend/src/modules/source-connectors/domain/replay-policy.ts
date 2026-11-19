import type { ReplayPolicy, ReplayRequest, ReplayScope } from './replay-contracts.ts';

export const DEFAULT_REPLAY_POLICY: ReplayPolicy = Object.freeze({
  maxWindowMs: 86_400_000, maxRequests: 20, maxPageBytes: 262_144, maxPageRecords: 100,
  minIntervalMs: 1000, maxAttempts: 5, maxRetryMs: 60_000, requestTimeoutMs: 10_000,
  retryStatuses: Object.freeze([429, 500, 502, 503, 504]),
});
export function validateReplayScope(scope: ReplayScope): void {
  if (!scope || [scope.sourceId, scope.provider, scope.account, scope.sourceEpoch]
    .some(value => typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(value)))
    throw new Error('Invalid replay scope.');
}
export function validateReplayRequest(request: ReplayRequest, policy: ReplayPolicy): void {
  validateReplayScope(request);
  if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(request.checkpoint)
    || !['SYNTHETIC', 'PERMITTED'].includes(request.mode)
    || !Number.isSafeInteger(request.from) || request.from < 0
    || !Number.isSafeInteger(request.to) || request.to <= request.from
    || request.to - request.from > policy.maxWindowMs
    || !Number.isInteger(request.limit) || request.limit < 1 || request.limit > 500)
    throw new Error('Invalid bounded replay request.');
}
export function validateReplayPolicy(policy: ReplayPolicy): void {
  for (const [key, max] of Object.entries({ maxWindowMs: 86_400_000, maxRequests: 100,
    maxPageBytes: 1_048_576, maxPageRecords: 500, minIntervalMs: 60_000,
    maxAttempts: 10, maxRetryMs: 86_400_000, requestTimeoutMs: 60_000 })) {
    const value = policy[key as keyof ReplayPolicy];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max)
      throw new Error('Invalid replay policy.');
  }
  if (!policy.retryStatuses.length || policy.retryStatuses.some(status => ![429, 500, 502, 503, 504].includes(status)))
    throw new Error('Invalid retry statuses.');
}
export function sameReplay(a: ReplayRequest, b: ReplayRequest): boolean {
  return (['sourceId', 'provider', 'account', 'sourceEpoch', 'checkpoint', 'from', 'to', 'limit', 'mode'] as const)
    .every(key => a[key] === b[key]);
}
