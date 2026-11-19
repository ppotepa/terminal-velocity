import { Pool } from 'pg';
import { postgresSourceReplayStore } from '../../packages/backend/src/modules/source-connectors/infrastructure/postgres/source-replay-store.ts';
import { inspectSourceReplay } from '../../packages/backend/src/modules/source-connectors/infrastructure/postgres/source-health-reader.ts';
import { adminOptions, localDatabaseUrl } from './admin-options.mjs';

let pool;
try {
  const { scope } = adminOptions(process.argv.slice(2), 'inspect');
  pool = new Pool({ connectionString: localDatabaseUrl(process.env.DATABASE_URL), max: 1, connectionTimeoutMillis: 3000 });
  console.log(JSON.stringify(await inspectSourceReplay(postgresSourceReplayStore(pool), scope, Date.now())));
} catch {
  console.error('SOURCE_INSPECTION_FAILED: exact scope and a local database are required.');
  process.exitCode = 1;
} finally { await pool?.end(); }
