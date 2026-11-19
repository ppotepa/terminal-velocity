import type { DeliveryLease } from '../domain/delivery-lease.ts';
import type { QuarantineOutcome, RetryOutcome, RetryRequest } from '../domain/delivery-results.ts';

export interface DeliveryQueue {
  /** The configured consumer set must remain fixed for this fan-out generation. */
  fanOut(consumerIds: readonly string[], batchSize: number): Promise<number>;
  leaseNext(consumerId: string, leaseDurationMs: number): Promise<DeliveryLease | null>;
  retry(lease: DeliveryLease, failure: RetryRequest): Promise<RetryOutcome>;
  quarantine(lease: DeliveryLease, code: string): Promise<QuarantineOutcome>;
  recoverExpired(batchSize: number): Promise<number>;
}
