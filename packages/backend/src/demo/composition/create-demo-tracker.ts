import { freshnessPolicy } from '../../modules/message-availability/public/index.ts';
import { createFixtureFleet } from '../infrastructure/fixture-fleet.ts';
import { createFixtureCandidateDirectory } from '../infrastructure/fixture-candidate-directory.ts';
import { createMemoryDemoState } from '../infrastructure/memory-demo-state.ts';
import { createAsyncMutex } from '../infrastructure/async-mutex.ts';
import { createIngestMessage } from '../application/ingest-message.ts';
import { createListAircraft } from '../application/list-aircraft.ts';
import { createGetAircraft } from '../application/get-aircraft.ts';
import { createGetMessage } from '../application/get-message.ts';
import { createGetMessages } from '../application/get-messages.ts';
import { parseMessageInput } from '../application/parse-message-input.ts';
import { guardOperation } from '../application/guard-operation.ts';
import type { DemoTracker, DemoTrackerOptions } from '../public/types.ts';
export function createDemoTracker(options: DemoTrackerOptions = {}): DemoTracker {
  const now = options.now ?? Date.now;
  const fleet = createFixtureFleet(), directory = createFixtureCandidateDirectory(fleet);
  const store = createMemoryDemoState(), mutex = createAsyncMutex();
  const policy = freshnessPolicy(600_000, 3_600_000);
  if (!policy.ok) throw new Error('Invalid fixed demo freshness policy');
  const ingest = createIngestMessage(store, directory, policy.value, now);
  const listAircraft = createListAircraft(fleet, store, policy.value, now);
  const getAircraft = createGetAircraft(fleet, store, policy.value, now);
  const getMessage = createGetMessage(store), getMessages = createGetMessages(fleet, store);
  return Object.freeze<DemoTracker>({
    ingest(input) {
      // Capture validated canonical primitives immediately, before asynchronous serialization.
      const parsed = parseMessageInput(input);
      if (!parsed.ok) return Promise.resolve(parsed);
      return guardOperation(() => mutex.run(() => ingest(parsed.value)));
    },
    listAircraft: () => guardOperation(() => mutex.run(listAircraft)),
    getAircraft: id => guardOperation(() => mutex.run(() => getAircraft(id))),
    getMessages: id => guardOperation(() => mutex.run(() => getMessages(id))),
    getMessage: id => guardOperation(() => mutex.run(() => getMessage(id))),
  });
}
