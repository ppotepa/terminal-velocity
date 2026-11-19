import { Pool } from 'pg';
import { replaySourceRange, reviewSourceQuarantine } from '../../packages/backend/src/modules/source-connectors/public/index.ts';
import { postgresSourceReplayStore } from '../../packages/backend/src/modules/source-connectors/infrastructure/postgres/source-replay-store.ts';
import { inspectSourceReplay } from '../../packages/backend/src/modules/source-connectors/infrastructure/postgres/source-health-reader.ts';
import { adminOptions, localDatabaseUrl } from './admin-options.mjs';
import { syntheticReplay } from './synthetic-replay.mjs';

let pool;
try {
  const { scope, request, resolution } = adminOptions(process.argv.slice(2), 'replay');
  pool = new Pool({ connectionString: localDatabaseUrl(process.env.DATABASE_URL), max: 3, connectionTimeoutMillis: 3000 });
  const store = postgresSourceReplayStore(pool), deps = syntheticReplay(pool, request);
  if (resolution) await reviewSourceQuarantine(store, scope, request.checkpoint, resolution, deps.authorized);
  else await replaySourceRange(request, { ...deps, store });
  console.log(JSON.stringify(await inspectSourceReplay(store, scope, Date.now())));
} catch {
  console.error('SOURCE_REPLAY_FAILED: check local scope, checkpoint, permission and database availability.');
  process.exitCode = 1;
} finally { await pool?.end(); }
