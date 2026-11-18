import type { EventId } from '../../../contracts/identity/index.ts';
import type { StoredDecision } from './stored-decision.ts';
export interface DecisionEvent {
  readonly eventId: EventId;
  readonly type: 'correlation.aircraft-decision-revised.v1';
  readonly payload: StoredDecision;
}
