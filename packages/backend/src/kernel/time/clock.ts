import type { EpochMillis } from './epoch-millis.ts';
export interface Clock { now(): EpochMillis; }
