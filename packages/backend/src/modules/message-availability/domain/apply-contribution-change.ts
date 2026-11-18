import type { AircraftId } from '../../../contracts/identity/index.ts';
import { err, ok, type Result } from '../../../kernel/result.ts';
import type { ContributionLedger } from './contribution-ledger.ts';
import type { ContributionChange } from './contribution.ts';
import { sameChange } from './same-change.ts';
export interface AppliedContribution {
  readonly ledger: ContributionLedger;
  readonly affectedAircraft: readonly AircraftId[];
  readonly outcome: 'APPLIED' | 'IGNORED_OLD' | 'IGNORED_DUPLICATE';
}
export function applyContributionChange(ledger: ContributionLedger, change: ContributionChange):
Result<AppliedContribution, { readonly code: 'REVISION_COLLISION' }> {
  const messageId = change.type === 'ASSIGNED' ? change.contribution.messageId : change.messageId;
  const old = ledger.get(messageId);
  if (old && change.revision < old.revision) return ok({ ledger, affectedAircraft: [], outcome: 'IGNORED_OLD' });
  if (old && change.revision === old.revision) return sameChange(old, change)
    ? ok({ ledger, affectedAircraft: [], outcome: 'IGNORED_DUPLICATE' }) : err({ code: 'REVISION_COLLISION' });
  const affected = new Set<AircraftId>();
  if (old?.type === 'ASSIGNED') affected.add(old.contribution.aircraftId);
  if (change.type === 'ASSIGNED') affected.add(change.contribution.aircraftId);
  // The caller may retain a mutable object despite readonly types in TS.
  // Do not share the reference stored in the projection with the caller.
  const snapshot: ContributionChange = change.type === 'ASSIGNED'
    ? Object.freeze({ ...change, contribution: Object.freeze({ ...change.contribution }) })
    : Object.freeze({ ...change });
  const next = new Map(ledger); next.set(messageId, snapshot);
  return ok({ ledger: next, affectedAircraft: [...affected], outcome: 'APPLIED' });
}
