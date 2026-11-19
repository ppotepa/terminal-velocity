import type { SqlExecutor } from '../../contracts/database/index.ts';
import { EventIdentityConflict, type DeliveryQueue, type AtomicEventConsumer, type EventProjector } from '../../modules/event-delivery/public/index.ts';

export const DEMO_AVAILABILITY_CONSUMER = 'demo-availability-v1';
export interface DeliveryWorker { start(): void; drain(): Promise<number>; stop(): Promise<void>; }

/** One bounded batch at a time; competing processes coordinate through durable leases. */
export function createDeliveryWorker(delivery: DeliveryQueue & AtomicEventConsumer<SqlExecutor>,
  project: EventProjector<SqlExecutor>, onError: () => void): DeliveryWorker {
  let running = false, stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<number> | undefined;
  const drain = (): Promise<number> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      await delivery.recoverExpired(100);
      await delivery.fanOut([DEMO_AVAILABILITY_CONSUMER], 100);
      let consumed = 0;
      for (let index = 0; index < 100 && !stopping; index += 1) {
        const lease = await delivery.leaseNext(DEMO_AVAILABILITY_CONSUMER, 30_000);
        if (!lease) break;
        try {
          const result = await delivery.consume(lease, project);
          if (result !== 'STALE_LEASE') consumed += 1;
        } catch (error) {
          if (error instanceof EventIdentityConflict) await delivery.quarantine(lease, 'EVENT_ID_CONFLICT');
          else await delivery.retry(lease, { code: 'PROJECTION_FAILED', delayMs: Math.min(60_000, 1_000 * 2 ** (lease.attempt - 1)) });
          onError();
        }
      }
      return consumed;
    })().finally(() => { inFlight = undefined; });
    return inFlight;
  };
  const tick = () => {
    void drain().catch(onError).finally(() => {
      if (running) { timer = setTimeout(tick, 250); timer.unref(); }
    });
  };
  return {
    start() { if (!running && !stopping) { running = true; tick(); } },
    drain,
    async stop() { running = false; stopping = true; if (timer) clearTimeout(timer); await inFlight; },
  };
}
