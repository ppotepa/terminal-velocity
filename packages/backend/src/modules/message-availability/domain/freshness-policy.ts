import { err, ok, type Result } from '../../../kernel/result.ts';
export interface FreshnessPolicy { readonly recentWithinMs: number; readonly staleWithinMs: number; }
export function freshnessPolicy(recentWithinMs: number, staleWithinMs: number):
Result<FreshnessPolicy, { readonly code: 'INVALID_FRESHNESS_POLICY' }> {
  return Number.isSafeInteger(recentWithinMs) && Number.isSafeInteger(staleWithinMs) &&
    recentWithinMs > 0 && staleWithinMs > recentWithinMs
    ? ok({ recentWithinMs, staleWithinMs }) : err({ code: 'INVALID_FRESHNESS_POLICY' });
}
