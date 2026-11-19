import { once } from 'node:events';
import { Pool } from 'pg';
import { acceptSourceDelivery } from '../../../src/modules/source-connectors/public/index.ts';
import { postgresSourceAcceptanceTransaction } from '../../../src/modules/source-connectors/infrastructure/postgres/postgres-source-acceptance-transaction.ts';

const pool = new Pool({ connectionString: process.env.TEST_RUNTIME_DATABASE_URL, max: 1 });
try {
  await pool.query('SELECT 1');
  const input = once(process, 'message');
  process.send('READY');
  const [{ scope, envelope, origin, loseReply }] = await input;
  const result = await acceptSourceDelivery(scope, postgresSourceAcceptanceTransaction(pool), envelope, origin);
  if (loseReply && result.ok && result.value.outcome === 'CREATED') process.kill(process.pid, 'SIGKILL');
  process.send(result);
} finally {
  await pool.end();
  process.disconnect();
}
