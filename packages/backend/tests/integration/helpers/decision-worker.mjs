import { Pool } from 'pg';
import { commitDecision } from '../../../src/modules/aircraft-correlation/public/index.ts';
import { createPostgresDecisionTransaction } from '../../../src/modules/aircraft-correlation/infrastructure/postgres/create-postgres-decision-transaction.ts';

const pool = new Pool({ connectionString: process.env.TEST_RUNTIME_DATABASE_URL, max: 1,
  connectionTimeoutMillis: 3_000, statement_timeout: 8_000 });
pool.on('error', () => {});
await pool.query('SELECT 1');
process.send({ type: 'READY' });
process.once('message', async input => {
  try {
    const result = await commitDecision(input.decision, input.expectedRevision,
      'integration-worker/1', input.decidedAt, createPostgresDecisionTransaction(pool),
      { next: () => input.eventId });
    process.send({ type: 'RESULT', result });
  } finally {
    await pool.end();
    process.disconnect();
  }
});
