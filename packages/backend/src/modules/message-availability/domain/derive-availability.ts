import { ok, type Result } from '../../../kernel/result.ts';
import type { AircraftId, Revision } from '../../../contracts/identity/index.ts';
import type { EpochMillis } from '../../../kernel/time/epoch-millis.ts';
import type { ContributionLedger } from './contribution-ledger.ts';
import type { FreshnessPolicy } from './freshness-policy.ts';
import type { AvailabilitySnapshot } from './availability-snapshot.ts';
import { latestEligibleContribution } from './latest-eligible-contribution.ts';
import { classifyAge } from './classify-age.ts';
import { nextTransitionAt, type DeadlineError } from './next-transition-at.ts';
export function deriveAvailability(ledger: ContributionLedger, aircraftId: AircraftId,
  now: EpochMillis, policy: FreshnessPolicy, revision: Revision): Result<AvailabilitySnapshot, DeadlineError> {
  const last = latestEligibleContribution(ledger, aircraftId, now);
  const freshness = classifyAge(last, now, policy);
  const deadline = nextTransitionAt(last, freshness, policy);
  if (!deadline.ok) return deadline;
  return ok({ aircraftId, revision, freshness, lastEligibleMessageAt: last, calculatedAt: now,
    nextTransitionAt: deadline.value });
}
