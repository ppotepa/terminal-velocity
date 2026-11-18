import { epochMillis, type EpochMillis } from '../../../kernel/time/epoch-millis.ts';
import { err, ok, type Result } from '../../../kernel/result.ts';
import type { Freshness } from './freshness.ts';
import type { FreshnessPolicy } from './freshness-policy.ts';
export type DeadlineError = { readonly code: 'TIME_RANGE_OVERFLOW' };
export function nextTransitionAt(last: EpochMillis | null, freshness: Freshness, policy: FreshnessPolicy): Result<EpochMillis | null, DeadlineError> {
  if (last === null || freshness === 'NONE') return ok(null);
  const at = epochMillis(last + (freshness === 'RECENT' ? policy.recentWithinMs : policy.staleWithinMs));
  return at.ok ? ok(at.value) : err({ code: 'TIME_RANGE_OVERFLOW' });
}
