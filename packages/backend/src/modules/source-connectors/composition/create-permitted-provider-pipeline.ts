import { randomUUID } from 'node:crypto';
import type { SqlPool, SqlExecutor } from '../../../contracts/database/index.ts';
import { eventId } from '../../../contracts/identity/index.ts';
import type { CandidateDirectory, DecisionTransaction } from '../../aircraft-correlation/public/index.ts';
import { createPostgresDecisionWriteSet } from '../../aircraft-correlation/infrastructure/postgres/create-postgres-decision-write-set.ts';
import { runDecisionWork } from '../../aircraft-correlation/infrastructure/postgres/run-decision-work.ts';
import { createPostgresEventDelivery } from '../../event-delivery/infrastructure/postgres-event-delivery.ts';
import { consumeRegisteredEvent } from '../../event-delivery/infrastructure/consume-event.ts';
import { EventIdentityConflict, type DeliveryLease } from '../../event-delivery/public/index.ts';
import { acceptSourceDelivery, type VerifiedSourceScope } from '../application/accept-source-delivery.ts';
import { normalizeSourceObservation, type NormalizationContext } from '../application/normalize-source-observation.ts';
import { importProviderMessage } from '../application/import-provider-message.ts';
import type { SourceDeliveryOrigin } from '../ports/source-delivery-store.ts';
import type { ProviderImportResult } from '../ports/provider-message-commit.ts';
import { postgresSourceAcceptanceTransaction } from '../infrastructure/postgres/postgres-source-acceptance-transaction.ts';
import { postgresProviderMessageCommit } from '../infrastructure/postgres/postgres-provider-message-commit.ts';
import { readProviderImportReceipt } from '../infrastructure/postgres/read-provider-import-receipt.ts';
import { readSourceEvent, type AcceptedSourceEvent } from '../infrastructure/postgres/read-source-event.ts';
import { routeSourceEvents, SOURCE_IMPORT_CONSUMER, PRIVATE_AVAILABILITY_CONSUMER } from '../infrastructure/postgres/source-event-router.ts';
import { projectPrivateDecision, readPrivateAvailability } from '../infrastructure/postgres/private-availability.ts';

import { permitsRetention, type RetentionPermission } from '../domain/retention-permission.ts';

/** Private durable composition. Permission must come from trusted operator configuration. */
export function createPermittedProviderPipeline(pool: SqlPool, directory: CandidateDirectory, permission: RetentionPermission, now: () => number = Date.now) {
  const grant = structuredClone(permission);
  const queue = createPostgresEventDelivery(pool);
  const events = { next() { const id = eventId('evt_' + randomUUID()); if (!id.ok) throw new Error('Invalid event ID'); return id.value; } };
  const decisions = (sql: SqlExecutor): DecisionTransaction => ({
    run: work => runDecisionWork(createPostgresDecisionWriteSet(sql), work),
  });
  async function consumeSource(lease: DeliveryLease) {
    if (lease.consumerId !== SOURCE_IMPORT_CONSUMER) throw new Error('Wrong source consumer.');
    let result: ProviderImportResult | undefined;
    let source: AcceptedSourceEvent | undefined;
    const outcome = await consumeRegisteredEvent(pool, lease, async (sql, id) => {
      const read = await readSourceEvent(sql, id); source = read.event; return read;
    }, async (sql, event) => {
      result = await importProviderMessage({ ...event, now: now() },
        postgresProviderMessageCommit(sql, event.messageId, event.sourceDeliveryId, decisions(sql), event.canonical), directory, events);
    });
    if (outcome === 'DUPLICATE' && source) result = await readProviderImportReceipt(pool, source.sourceDeliveryId);
    return { outcome, result };
  }
  async function consumePrivate(lease: DeliveryLease) {
    if (lease.consumerId !== PRIVATE_AVAILABILITY_CONSUMER) throw new Error('Wrong private consumer.');
    return queue.consume(lease, (sql, event) => projectPrivateDecision(sql, event.payload));
  }
  return {
    queue, route: () => routeSourceEvents(pool), consumeSource, consumePrivate,
    async accept(input: unknown, context: NormalizationContext, scope: VerifiedSourceScope, origin: SourceDeliveryOrigin) {
      const normalized = normalizeSourceObservation(input, context, scope.capabilities);
      if (!normalized.ok) return normalized;
      const canonical = normalized.value;
      if (!permitsRetention(grant, canonical.observation)) throw new Error('Retention permission is missing or outside its scope.');
      return acceptSourceDelivery(scope, postgresSourceAcceptanceTransaction(pool, randomUUID, { canonical, permission: grant }), canonical.observation, origin);
    },
    async drain() {
      await queue.recoverExpired(100);
      let processed = 0;
      for (const consumer of [SOURCE_IMPORT_CONSUMER, PRIVATE_AVAILABILITY_CONSUMER]) {
        await routeSourceEvents(pool);
        for (let i = 0; i < 100; i++) {
          const lease = await queue.leaseNext(consumer, 30_000);
          if (!lease) break;
          try {
            const result = consumer === SOURCE_IMPORT_CONSUMER ? (await consumeSource(lease)).outcome : await consumePrivate(lease);
            if (result !== 'STALE_LEASE') processed++;
          } catch (error) {
            if (error instanceof EventIdentityConflict) await queue.quarantine(lease, 'EVENT_ID_CONFLICT');
            else await queue.retry(lease, { code: 'PROVIDER_PROCESSING_FAILED', delayMs: 1000 });
            throw error;
          }
        }
      }
      return processed;
    },
    readPrivateStatus: (aircraftId: string) => readPrivateAvailability(pool, aircraftId, now(), { recentWithinMs: 600_000, staleWithinMs: 3_600_000 }),
  };
}
