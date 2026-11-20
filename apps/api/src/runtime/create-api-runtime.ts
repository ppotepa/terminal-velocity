import { createDemoTracker, createDemoMapReader, createPostgresDemoTracker, type DemoTracker } from '@airframes/backend/demo';
import type { MapReader } from '@airframes/backend/map';
import type { ObservedTrackReader } from '@airframes/backend/flight-tracking';
import type { ReadApiHealth } from '../http/api-health.ts';
import type { StorageConfig } from './storage-config.ts';
export interface ApiRuntime {
  readonly tracker: DemoTracker;
  readonly mapReader: MapReader;
  readonly trackReader: ObservedTrackReader;
  readonly readHealth: ReadApiHealth;
  close(): Promise<void>;
}
export async function createApiRuntime(config: StorageConfig): Promise<ApiRuntime> {
  if (config.driver === 'memory') {
    const tracker = createDemoTracker();
    return {
    tracker,
    mapReader: createDemoMapReader(tracker),
    trackReader: { read: async query => ({ aircraftId: query.aircraftId, projectionRevision: 0,
      segments: [], observedCount: 0, hasMore: false, next: null }) },
    readHealth: async () => ({ status: 'ok', mode: 'demo', storage: 'memory' }),
    close: async () => {},
  }; }
  const runtime = await createPostgresDemoTracker({ connectionString: config.databaseUrl,
    onBackgroundError: () => console.error('A durable delivery or database connection failed; recovery will retry eligible work.') });
  return {
    tracker: runtime.tracker,
    mapReader: runtime.mapReader,
    trackReader: runtime.trackReader,
    readHealth: async () => ({ status: await runtime.checkHealth() ? 'ok' : 'unavailable', mode: 'demo', storage: 'postgres' }),
    close: runtime.close,
  };
}
