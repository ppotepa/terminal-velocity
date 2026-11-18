import type { DemoState } from '../application/demo-state.ts';
/** Only use while holding the tracker's mutex. A swap is the sole commit point. */
export interface DemoStateStore { read(): DemoState; commit(next: DemoState): void; }
