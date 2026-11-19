import { freshnessPolicy } from '../../modules/message-availability/public/index.ts';
import { createPostgresDecisionWriteSet } from '../../modules/aircraft-correlation/infrastructure/postgres/create-postgres-decision-write-set.ts';
import { runDecisionWork } from '../../modules/aircraft-correlation/infrastructure/postgres/run-decision-work.ts';
import { createPostgresEventDelivery } from '../../modules/event-delivery/infrastructure/postgres-event-delivery.ts';
import { createPostgresContributionWriter } from '../../modules/message-availability/infrastructure/postgres-contribution-writer.ts';
import { createPostgresAvailabilityReader } from '../../modules/message-availability/infrastructure/postgres-availability-reader.ts';
import { createFixtureFleet } from '../infrastructure/fixture-fleet.ts';
import { createFixtureCandidateDirectory } from '../infrastructure/fixture-candidate-directory.ts';
import { createPostgresPool } from '../infrastructure/postgres/create-postgres-pool.ts';
import { createPostgresIngestTransaction } from '../infrastructure/postgres/postgres-ingest-transaction.ts';
import { createPostgresMessageReader } from '../infrastructure/postgres/postgres-message-reader.ts';
import { createPostgresMessageFactsReader } from '../infrastructure/postgres/postgres-message-facts-reader.ts';
import { verifyDurableSchema } from '../infrastructure/postgres/verify-durable-schema.ts';
import { createDeliveryWorker } from '../infrastructure/delivery-worker.ts';
import { randomEventIds } from '../infrastructure/random-event-ids.ts';
import { createIngestDurableMessage } from '../application/ingest-durable-message.ts';
import { createGetDurableMessage } from '../application/get-durable-message.ts';
import { createGetDurableMessages } from '../application/get-durable-messages.ts';
import { createGetDurableAircraft } from '../application/get-durable-aircraft.ts';
import { createListDurableAircraft } from '../application/list-durable-aircraft.ts';
import { projectDecision } from '../application/project-decision.ts';
import { parseMessageInput } from '../application/parse-message-input.ts';
import { guardOperation } from '../application/guard-operation.ts';
import type { DemoTracker } from '../public/types.ts';
import type { PostgresDemoOptions, PostgresDemoRuntime } from '../public/postgres-types.ts';

export async function createPostgresDemoTracker(options: PostgresDemoOptions): Promise<PostgresDemoRuntime> {
  if (!options.connectionString.trim()) throw new Error('An explicit PostgreSQL connection URL is required.');
  const onError = options.onBackgroundError ?? (() => {});
  const pool = createPostgresPool(options.connectionString, onError);
  try {
    await verifyDurableSchema(pool);
    const now = options.now ?? Date.now;
    const fleet = createFixtureFleet(), directory = createFixtureCandidateDirectory(fleet);
    const policy = freshnessPolicy(600_000, 3_600_000);
    if (!policy.ok) throw new Error('Invalid fixed demo freshness policy.');
    const transaction = createPostgresIngestTransaction(pool, sql => {
      const writes = createPostgresDecisionWriteSet(sql);
      return { read: writes.read, run: work => runDecisionWork(writes, work) };
    });
    const messages = createPostgresMessageReader(pool), availability = createPostgresAvailabilityReader(pool);
    const ingest = createIngestDurableMessage(transaction, directory, randomEventIds(), now);
    const getMessage = createGetDurableMessage(messages), getMessages = createGetDurableMessages(fleet, messages);
    const getAircraft = createGetDurableAircraft(fleet, availability, policy.value, now);
    const listAircraft = createListDurableAircraft(fleet, availability, policy.value, now);
    const tracker: DemoTracker = Object.freeze({
      ingest(input: unknown) {
        const parsed = parseMessageInput(input);
        return parsed.ok ? guardOperation(() => ingest(parsed.value)) : Promise.resolve(parsed);
      },
      getMessage: (id: string) => guardOperation(() => getMessage(id)),
      getMessages: (id: string) => guardOperation(() => getMessages(id)),
      getAircraft: (id: string) => guardOperation(() => getAircraft(id)),
      listAircraft: () => guardOperation(listAircraft),
    });
    const delivery = createPostgresEventDelivery(pool);
    const worker = createDeliveryWorker(delivery, (sql, event) => projectDecision(event.payload,
      createPostgresMessageFactsReader(sql), createPostgresContributionWriter(sql)), onError);
    if (options.startWorker !== false) worker.start();
    let closing: Promise<void> | undefined;
    return {
      tracker,
      async checkHealth() { try { await pool.query('SELECT 1'); return true; } catch { return false; } },
      drain: worker.drain,
      close() { return closing ??= (async () => { try { await worker.stop(); } finally { await pool.end(); } })(); },
    };
  } catch (error) { await pool.end(); throw error; }
}
