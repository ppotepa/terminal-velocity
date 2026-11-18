import type { EpochMillis } from '../../../kernel/time/epoch-millis.ts';
/** Kondycja pobierania danych; niezależna od zakresu i świeżości obserwacji. */
export interface FeedHealth {
  readonly state: 'HEALTHY' | 'DEGRADED' | 'DISCONNECTED';
  readonly assessedAt: EpochMillis;
}
