import { createDemoTracker, createPostgresDemoTracker, type DemoTracker } from '@airframes/backend/demo';
import type { ReadApiHealth } from '../http/api-health.ts';
import type { StorageConfig } from './storage-config.ts';
export interface ApiRuntime {
  readonly tracker: DemoTracker;
  readonly readHealth: ReadApiHealth;
  close(): Promise<void>;
}
export async function createApiRuntime(config: StorageConfig): Promise<ApiRuntime> {
  if (config.driver === 'memory') return {
    tracker: createDemoTracker(),
    readHealth: async () => ({ status: 'ok', mode: 'demo', storage: 'memory' }),
    close: async () => {},
  };
  const runtime = await createPostgresDemoTracker({ connectionString: config.databaseUrl,
    onBackgroundError: () => console.error('A durable delivery or database connection failed; recovery will retry eligible work.') });
  return {
    tracker: runtime.tracker,
    readHealth: async () => ({ status: await runtime.checkHealth() ? 'ok' : 'unavailable', mode: 'demo', storage: 'postgres' }),
    close: runtime.close,
  };
}
