import { ok, type Result } from '../../../kernel/result.ts';
import type { DeadlineError } from '../domain/next-transition-at.ts';
import { nextRevision, type AircraftId, type Revision } from '../../../contracts/identity/index.ts';
import type { EpochMillis } from '../../../kernel/time/epoch-millis.ts';
import type { FreshnessPolicy } from '../domain/freshness-policy.ts';
import { deriveAvailability } from '../domain/derive-availability.ts';
import type { AvailabilityState } from './availability-state.ts';
export interface ExpiryCommand { readonly aircraftId: AircraftId; readonly expectedRevision: Revision; readonly dueAt: EpochMillis; }
export function expireAvailability(state: AvailabilityState, command: ExpiryCommand,
  now: EpochMillis, policy: FreshnessPolicy): Result<{ readonly state: AvailabilityState; readonly outcome: 'APPLIED' | 'STALE_TIMER' | 'NOT_DUE' }, DeadlineError> {
  const current = state.snapshots.get(command.aircraftId);
  if (!current || current.revision !== command.expectedRevision || current.nextTransitionAt !== command.dueAt)
    return ok({ state, outcome: 'STALE_TIMER' });
  if (now < command.dueAt) return ok({ state, outcome: 'NOT_DUE' });
  const snapshots = new Map(state.snapshots);
  const derived = deriveAvailability(state.ledger, command.aircraftId,
    now, policy, nextRevision(current.revision));
  if (!derived.ok) return derived;
  snapshots.set(command.aircraftId, derived.value);
  return ok({ state: { ...state, snapshots }, outcome: 'APPLIED' });
}
