import type { EpochMillis } from '../../../kernel/time/epoch-millis.ts';
/** The scope of available observations. It says nothing about connection health or aircraft transmissions. */
export interface Coverage {
  readonly kind: 'UNKNOWN' | 'SAMPLED' | 'STATION_SCOPED';
  readonly assessedAt: EpochMillis;
}
