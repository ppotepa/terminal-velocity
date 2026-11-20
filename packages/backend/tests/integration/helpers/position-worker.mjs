import { Pool } from 'pg';
import { postgresPositionHistoryWriter } from '../../../src/modules/flight-tracking/infrastructure/postgres/append-position.ts';

const pool = new Pool({ connectionString: process.env.TEST_RUNTIME_DATABASE_URL, max: 1 });
try {
  const observation = JSON.parse(process.env.TV_SYNTHETIC_POSITION ?? 'null');
  const decision = JSON.parse(process.env.TV_SYNTHETIC_IDENTITY_DECISION ?? 'null');
  const result = await postgresPositionHistoryWriter(pool).append(observation, decision ?? undefined);
  process.stdout.write(JSON.stringify(result));
} finally {
  await pool.end();
}
