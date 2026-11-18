import type { EventId } from '../../../contracts/identity/index.ts';
export interface EventIdGenerator { next(): EventId; }
