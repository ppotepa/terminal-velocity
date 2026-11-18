import type { EpochMillis } from '../../../kernel/time/epoch-millis.ts';
/** Data ingestion health; independent of observation coverage and freshness. */
export interface FeedHealth {
  readonly state: 'HEALTHY' | 'DEGRADED' | 'DISCONNECTED';
  readonly assessedAt: EpochMillis;
}
