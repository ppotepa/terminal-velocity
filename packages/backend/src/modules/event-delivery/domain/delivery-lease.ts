import type { EventId } from '../../../contracts/identity/index.ts';

/** A token identifies one claim, not the lifetime of the event or worker process. */
export interface DeliveryLease {
  readonly consumerId: string;
  readonly eventId: EventId;
  readonly token: string;
  readonly attempt: number;
  /** Informational only. PostgreSQL time determines whether the lease is current. */
  readonly expiresAt: number;
}
