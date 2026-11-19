import type { DemoTracker } from './types.ts';
export interface PostgresDemoOptions {
  readonly connectionString: string;
  readonly now?: () => number;
  readonly onBackgroundError?: () => void;
  readonly startWorker?: boolean;
}
export interface PostgresDemoRuntime {
  readonly tracker: DemoTracker;
  checkHealth(): Promise<boolean>;
  drain(): Promise<number>;
  close(): Promise<void>;
}
