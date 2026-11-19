import type { SqlClient } from './sql-client.ts';
import type { SqlExecutor } from './sql-executor.ts';
export interface SqlPool extends SqlExecutor {
  connect(): Promise<SqlClient>;
  end(): Promise<void>;
}
