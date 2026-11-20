import { Pool } from 'pg';
import { createPostgresCurrentPosition } from '@airframes/backend/flight-tracking';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required for private current-position backfill.');
  process.exitCode = 1;
} else {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2,
    connectionTimeoutMillis: 5000, application_name: 'terminal-velocity-current-position-backfill' });
  try {
    const projection = createPostgresCurrentPosition(pool);
    let queued = 0, complete = false, pages = 0;
    while (!complete && pages < 1000) {
      const page = await projection.backfillLinks(500);
      queued += page.queued;
      complete = page.complete;
      pages++;
    }
    console.log(`Current-position backfill queued ${queued} links in ${pages} pages; complete=${complete}.`);
    if (!complete) process.exitCode = 2;
  } catch (error) {
    console.error(`Current-position backfill failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
