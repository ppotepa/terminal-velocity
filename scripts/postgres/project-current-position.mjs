import { Pool } from 'pg';
import { createPostgresCurrentPosition } from '@airframes/backend/flight-tracking';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required for private current-position projection.');
  process.exitCode = 1;
} else {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2,
    connectionTimeoutMillis: 5000, application_name: 'terminal-velocity-current-position-worker' });
  try {
    const project = createPostgresCurrentPosition(pool);
    let processed = 0, complete = false;
    while (processed < 5000) {
      const result = await project.processNext();
      if (result === null) { complete = true; break; }
      processed++;
    }
    console.log(`Current-position projection processed ${processed} jobs; queue empty=${complete}.`);
    if (!complete) process.exitCode = 2;
  } catch (error) {
    console.error(`Current-position projection failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
