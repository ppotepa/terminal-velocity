import type { DemoTracker } from './types.ts';
import type { MapReader } from '../../modules/map-projection/public/index.ts';
export interface PostgresDemoOptions {
  readonly connectionString: string;
  readonly now?: () => number;
  readonly onBackgroundError?: () => void;
  readonly startWorker?: boolean;
}
export interface PostgresDemoRuntime {
  readonly tracker: DemoTracker;
  readonly mapReader: MapReader;
  checkHealth(): Promise<boolean>;
  drain(): Promise<number>;
  close(): Promise<void>;
}
