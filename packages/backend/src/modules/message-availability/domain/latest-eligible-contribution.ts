import type { AircraftId } from '../../../contracts/identity/index.ts';
import type { EpochMillis } from '../../../kernel/time/epoch-millis.ts';
import type { ContributionLedger } from './contribution-ledger.ts';
import type { Bearer } from './bearer.ts';
export function latestEligibleContribution(
  ledger: ContributionLedger, aircraftId: AircraftId, now: EpochMillis, bearer: Bearer | null = null,
): EpochMillis | null {
  let last: EpochMillis | null = null;
  for (const change of ledger.values()) {
    if (change.type !== 'ASSIGNED') continue;
    const item = change.contribution;
    if (item.aircraftId !== aircraftId || !item.publicEligible || item.observedAt > now ||
      (bearer !== null && item.bearer !== bearer)) continue;
    if (last === null || item.observedAt > last) last = item.observedAt;
  }
  return last;
}
