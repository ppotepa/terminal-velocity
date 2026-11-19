import type { SqlExecutor } from './sql-executor.ts';
export interface SqlClient extends SqlExecutor {
  release(error?: Error | boolean): void;
}
