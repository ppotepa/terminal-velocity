import type { EpochMillis } from '../../../kernel/time/epoch-millis.ts';
/** Zakres dostępnych obserwacji. Nie mówi o kondycji połączenia ani emisji maszyny. */
export interface Coverage {
  readonly kind: 'UNKNOWN' | 'SAMPLED' | 'STATION_SCOPED';
  readonly assessedAt: EpochMillis;
}
