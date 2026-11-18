import type { EpochMillis } from '../../../kernel/time/epoch-millis.ts';
import type { Freshness } from './freshness.ts';
import type { FreshnessPolicy } from './freshness-policy.ts';
/** [0,recent) = RECENT; [recent,stale) = STALE; [stale,infinity) = NONE. */
export function classifyAge(lastAt: EpochMillis | null, now: EpochMillis, policy: FreshnessPolicy): Freshness {
  if (lastAt === null || lastAt > now) return 'NONE';
  const age = now - lastAt;
  return age < policy.recentWithinMs ? 'RECENT' : age < policy.staleWithinMs ? 'STALE' : 'NONE';
}
