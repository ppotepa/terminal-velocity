import type { SqlExecutor, SqlPool } from '../../../contracts/database/index.ts';
import { boundedInteger } from '../domain/validate-delivery-input.ts';
import type { AtomicEventConsumer } from '../ports/atomic-event-consumer.ts';
import type { DeliveryQueue } from '../ports/delivery-queue.ts';
import { consumeEvent } from './consume-event.ts';
import { fanOut } from './fan-out.ts';
import { leaseNext } from './lease-next.ts';
import { quarantineDelivery } from './quarantine-delivery.ts';
import { recoverExpired } from './recover-expired.ts';
import { retryDelivery } from './retry-delivery.ts';

export interface PostgresDeliveryOptions { readonly maxAttempts?: number; }
export type PostgresEventDelivery = DeliveryQueue & AtomicEventConsumer<SqlExecutor>;

/** PostgreSQL-specific wiring remains outside the module's public domain contract. */
export function createPostgresEventDelivery(pool: SqlPool,
  options: PostgresDeliveryOptions = {}): PostgresEventDelivery {
  const maxAttempts = boundedInteger(options.maxAttempts ?? 8, 1, 100, 'The maximum attempt count');
  return {
    fanOut: (consumers, batchSize) => fanOut(pool, consumers, batchSize),
    leaseNext: (consumer, duration) => leaseNext(pool, consumer, duration, maxAttempts),
    consume: (lease, project) => consumeEvent(pool, lease, project),
    retry: (lease, failure) => retryDelivery(pool, lease, failure, maxAttempts),
    quarantine: (lease, code) => quarantineDelivery(pool, lease, code),
    recoverExpired: batchSize => recoverExpired(pool, batchSize, maxAttempts),
  };
}
