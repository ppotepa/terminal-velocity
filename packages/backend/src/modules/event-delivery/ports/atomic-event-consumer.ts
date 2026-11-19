import type { DecisionEvent } from '../../aircraft-correlation/public/index.ts';
import type { DeliveryLease } from '../domain/delivery-lease.ts';
import type { ConsumeOutcome } from '../domain/delivery-results.ts';

export type EventProjector<Writes> = (writes: Writes, event: DecisionEvent) => Promise<void>;

/** The adapter binds inbox, effects, and acknowledgment to the same transaction. */
export interface AtomicEventConsumer<Writes> {
  consume(lease: DeliveryLease, project: EventProjector<Writes>): Promise<ConsumeOutcome>;
}
