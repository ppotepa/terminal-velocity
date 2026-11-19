import { Pool } from 'pg';
import type { SqlPool } from '../../../contracts/database/index.ts';
export function createPostgresPool(connectionString: string, onError: () => void): SqlPool {
  const pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000, statement_timeout: 5_000, idle_in_transaction_session_timeout: 5_000,
    application_name: 'terminal-velocity', allowExitOnIdle: true });
  // Idle connection errors must not become uncaught process events or expose credentials.
  pool.on('error', onError);
  return pool;
}
