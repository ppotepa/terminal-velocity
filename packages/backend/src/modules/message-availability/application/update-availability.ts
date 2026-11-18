import { nextRevision } from '../../../contracts/identity/index.ts';
import { err, ok, type Result } from '../../../kernel/result.ts';
import type { EpochMillis } from '../../../kernel/time/epoch-millis.ts';
import type { ContributionChange } from '../domain/contribution.ts';
import type { FreshnessPolicy } from '../domain/freshness-policy.ts';
import { applyContributionChange } from '../domain/apply-contribution-change.ts';
import { deriveAvailability } from '../domain/derive-availability.ts';
import type { AvailabilityState } from './availability-state.ts';
/** Pure state transformation. The adapter must persist the result and events atomically. */
export function updateAvailability(state: AvailabilityState, change: ContributionChange,
  now: EpochMillis, policy: FreshnessPolicy): Result<AvailabilityState, { readonly code: 'REVISION_COLLISION' | 'FUTURE_OBSERVATION' | 'TIME_RANGE_OVERFLOW' }> {
  if (change.type === 'ASSIGNED' && change.contribution.observedAt > now)
    return err({ code: 'FUTURE_OBSERVATION' });
  const applied = applyContributionChange(state.ledger, change);
  if (!applied.ok) return applied;
  if (applied.value.outcome !== 'APPLIED') return ok(state);
  const snapshots = new Map(state.snapshots);
  for (const id of applied.value.affectedAircraft) {
    const next = nextRevision(snapshots.get(id)?.revision ?? null);
    const derived = deriveAvailability(applied.value.ledger, id, now, policy, next);
    if (!derived.ok) return derived;
    snapshots.set(id, derived.value);
  }
  return ok({ ledger: applied.value.ledger, snapshots });
}
